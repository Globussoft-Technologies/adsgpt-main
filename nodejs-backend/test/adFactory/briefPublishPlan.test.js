#!/usr/bin/env node
/**
 * Tests for services/adFactory/briefPublishPlan.js.
 *
 * The gap this closes: Quick setup could only ever commit you to a recurring
 * job, so the user looking at three finished ads had no way to ship those
 * three ads. v1 has had both paths since day one.
 *
 * The property that matters most here is the MONEY. Meta takes minor units and
 * everything upstream carries major units, so a missing or doubled ×100 either
 * spends 100× too little (₹800 → ₹8, campaign never delivers) or 100× too much.
 * Several tests below exist only to pin that arithmetic, including the negative
 * one — the campaign must carry NO budget at all, because a root `dailyBudget`
 * is copied to Meta unconverted.
 *
 * The generated payloads are checked against the LIVE wizardSchema cell rather
 * than hardcoded enums, so a schema change breaks the build here rather than at
 * Meta.
 *
 * Run:  node test/adFactory/briefPublishPlan.test.js
 */

const assert = require("node:assert/strict");

const {
  briefPublishPlan,
  BriefPublishError,
  _internals,
} = require("../../services/adFactory/briefPublishPlan");
const { getCell } = require("../../config/wizardSchema");

let pass = 0;
let fail = 0;
const FAILURES = [];

function test(name, fn) {
  try {
    fn();
    pass += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    fail += 1;
    FAILURES.push({ name, err });
    console.log(`  ✗ ${name}`);
    console.log(`      ${err.message}`);
  }
}
function group(label, fn) {
  console.log(`\n${label}`);
  return fn();
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

// TRAFFIC/WEBSITE — the Quick setup default, and an implemented cell.
const OBJECTIVE = "OUTCOME_TRAFFIC";
const CONVERSION_LOCATION = "WEBSITE";
const CELL = getCell(OBJECTIVE, CONVERSION_LOCATION);
// Take the CTA from the cell itself; hardcoding one would silently rot.
const LEGAL_CTA = CELL.ctas.allowed[0];

const S3 = "https://cdn.example.com";

const brief = (over = {}) => ({
  brand: { name: "PowerAdSpy", ...(over.brand || {}) },
  offer: {
    primaryObjective: OBJECTIVE,
    conversionLocation: CONVERSION_LOCATION,
    cta: { button: LEGAL_CTA, url: "https://poweradspy.com" },
    ...(over.offer || {}),
  },
  delivery: {
    budget: { daily: 800, currency: "INR" },
    ...(over.delivery || {}),
  },
  ...(over.root || {}),
});

const connection = (over = {}) => ({
  facebookId: "fb-1",
  connectionId: "conn-1",
  adAccountId: "act-123",
  pageId: "page-9",
  ...over,
});

const pairs = (n = 2) =>
  Array.from({ length: n }, (_, i) => ({
    imageUrl: `/generated/ad-${i}.png`,
    copy: {
      headline: `Headline ${i}`,
      primaryText: `Primary text ${i}`,
      description: `Desc ${i}`,
    },
  }));

const planAuto = (over = {}) =>
  briefPublishPlan(over.brief || brief(), over.connection || connection(), {
    mode: "auto",
    pairs: over.pairs || pairs(),
    s3Base: S3,
    ...(over.opts || {}),
  });

// ─── The money ───────────────────────────────────────────────────────────────

group("budget conversion at the Meta boundary", () => {
  test("the ad set carries the daily budget in MINOR units", () => {
    const { adSetPayload } = planAuto();
    assert.equal(adSetPayload.dailyBudget, 80000); // ₹800 → 80000 paise
  });

  test("the campaign carries NO budget — a root dailyBudget would go unconverted", () => {
    const { campaignPayload } = planAuto();
    assert.equal(campaignPayload.dailyBudget, undefined);
    assert.equal(campaignPayload.lifetimeBudget, undefined);
    assert.equal(campaignPayload.adSetBudget, undefined);
  });

  test("a fractional budget rounds rather than sending a float", () => {
    const b = brief({ delivery: { budget: { daily: 99.994 } } });
    const { adSetPayload } = planAuto({ brief: b });
    assert.equal(adSetPayload.dailyBudget, 9999);
    assert.equal(Number.isInteger(adSetPayload.dailyBudget), true);
  });

  test("a missing budget is refused, not defaulted to zero", () => {
    const b = brief({ delivery: { budget: {} } });
    assert.throws(() => planAuto({ brief: b }), (err) => {
      assert.ok(err instanceof BriefPublishError);
      assert.equal(err.field, "budget");
      return true;
    });
  });

  test("a zero budget is refused", () => {
    const b = brief({ delivery: { budget: { daily: 0 } } });
    assert.throws(() => planAuto({ brief: b }), /daily budget/i);
  });
});

// ─── Payload shape ───────────────────────────────────────────────────────────

group("auto mode builds a launchable campaign and ad set", () => {
  test("both go live — a one-off post that lands PAUSED has not been posted", () => {
    const { campaignPayload, adSetPayload } = planAuto();
    assert.equal(campaignPayload.status, "ACTIVE");
    assert.equal(adSetPayload.status, "ACTIVE");
  });

  test("the ad set carries the cell's own optimisation goal and billing event", () => {
    const { adSetPayload } = planAuto();
    assert.equal(adSetPayload.optimizationGoal, CELL.adSet.defaultOptimizationGoal);
    assert.ok(CELL.adSet.billingEvents.includes(adSetPayload.billingEvent));
  });

  test("objective and conversionLocation reach the ad set — its Joi schema needs both", () => {
    const { adSetPayload } = planAuto();
    assert.equal(adSetPayload.objective, OBJECTIVE);
    assert.equal(adSetPayload.conversionLocation, CONVERSION_LOCATION);
  });

  test("targeting is present — the ad set schema requires it", () => {
    const { adSetPayload } = planAuto();
    assert.ok(adSetPayload.targeting && typeof adSetPayload.targeting === "object");
  });

  test("no startTime or endTime — Meta reads absent as now, and open-ended", () => {
    const { adSetPayload } = planAuto();
    assert.equal(adSetPayload.startTime, undefined);
    assert.equal(adSetPayload.endTime, undefined);
  });

  test("the campaign is named after the brand, so it is findable in Ads Manager", () => {
    const { campaignPayload } = planAuto();
    assert.match(campaignPayload.name, /PowerAdSpy/);
  });

  test("the ad set name is dated, so a second post does not collide with the first", () => {
    const { adSetPayload, campaignPayload } = planAuto();
    assert.notEqual(adSetPayload.name, campaignPayload.name);
    assert.ok(adSetPayload.name.startsWith(campaignPayload.name));
  });

  test("specialAdCategories defaults to empty on both sides", () => {
    const { campaignPayload } = planAuto();
    assert.deepEqual(campaignPayload.specialAdCategories, []);
    assert.deepEqual(campaignPayload.specialAdCategoryCountries, []);
  });
});

// ─── The ads batch ───────────────────────────────────────────────────────────

group("the ads batch", () => {
  test("a relative image key is made absolute — createAdV2 validates it as a URI", () => {
    const { ads } = planAuto();
    assert.equal(ads[0].imageUrl, `${S3}/generated/ad-0.png`);
  });

  test("an absolute URL is left alone", () => {
    const p = [{ imageUrl: "https://other.cdn/x.png", copy: { headline: "H" } }];
    const { ads } = planAuto({ pairs: p });
    assert.equal(ads[0].imageUrl, "https://other.cdn/x.png");
  });

  test("a slot with no image is skipped, not sent as an empty ad", () => {
    const p = [...pairs(1), { imageUrl: "", copy: { headline: "orphan" } }];
    const { ads } = planAuto({ pairs: p });
    assert.equal(ads.length, 1);
  });

  test("copy is cut to Meta's limits", () => {
    const p = [
      {
        imageUrl: "https://x/y.png",
        copy: {
          headline: "H".repeat(200),
          primaryText: "P".repeat(400),
          description: "D".repeat(200),
        },
      },
    ];
    const { ads } = planAuto({ pairs: p });
    assert.equal(ads[0].headline.length, 40);
    assert.equal(ads[0].message.length, 125);
    assert.equal(ads[0].description.length, 30);
  });

  test("no finished ads is a refusal with a field, not an empty post", () => {
    assert.throws(() => planAuto({ pairs: [] }), (err) => {
      assert.equal(err.field, "ads");
      return true;
    });
  });

  test("the batch body carries the four ids createAdV2 requires", () => {
    const { adsBody } = planAuto();
    assert.equal(adsBody.accountId, "conn-1"); // FBUsers _id, NOT the user id
    assert.equal(adsBody.facebookId, "fb-1");
    assert.equal(adsBody.adAccountId, "act-123");
    assert.equal(adsBody.pageId, "page-9");
    assert.equal(adsBody.ads.length, 2);
  });

  test("campaignDetails/adSetDetails are NOT pre-filled — in auto mode they don't exist yet", () => {
    const { adsBody } = planAuto();
    assert.equal(adsBody.campaignDetails, undefined);
    assert.equal(adsBody.adSetDetails, undefined);
  });
});

// ─── The CTA guard ───────────────────────────────────────────────────────────

group("the CTA is checked against the cell that will run it", () => {
  test("a CTA the cell allows is passed through to every ad", () => {
    const { ads } = planAuto();
    assert.equal(ads[0].callToAction, LEGAL_CTA);
  });

  test("a CTA stranded by an objective change is dropped, not sent", () => {
    // The objective is editable after inference, so a button chosen under a
    // previous objective can survive into a cell that forbids it. Meta rejects
    // the whole ad for that, which is a terrible way to find out.
    const b = brief({ offer: { cta: { button: "APPLY_NOW", url: "https://x.test" } } });
    const stranded = !CELL.ctas.allowed.includes("APPLY_NOW");
    const { ads } = planAuto({ brief: b });
    if (stranded) assert.equal(ads[0].callToAction, undefined);
    else assert.equal(ads[0].callToAction, "APPLY_NOW");
  });

  test("an unknown objective never throws out of the guard", () => {
    assert.equal(_internals.ctaValidForCell("SHOP_NOW", "OUTCOME_NONSENSE", "WEBSITE"), null);
  });
});

// ─── existing mode ───────────────────────────────────────────────────────────

group("existing mode posts into what the user already runs", () => {
  const planExisting = (over = {}) =>
    briefPublishPlan(brief(), connection(), {
      mode: "existing",
      pairs: pairs(),
      s3Base: S3,
      campaignId: "23851234",
      adSetId: "23859876",
      ...over,
    });

  test("it builds NO campaign or ad set — that is the whole point", () => {
    const plan = planExisting();
    assert.equal(plan.campaignPayload, undefined);
    assert.equal(plan.adSetPayload, undefined);
    assert.equal(plan.template, undefined);
  });

  test("the chosen ids come back for the caller to attach", () => {
    const plan = planExisting();
    assert.equal(plan.campaignId, "23851234");
    assert.equal(plan.adSetId, "23859876");
  });

  test("it still builds the ads batch", () => {
    assert.equal(planExisting().adsBody.ads.length, 2);
  });

  test("a missing campaign is refused with the field", () => {
    assert.throws(() => planExisting({ campaignId: "" }), (err) => {
      assert.equal(err.field, "campaignId");
      return true;
    });
  });

  test("a missing ad set is refused with the field", () => {
    assert.throws(() => planExisting({ adSetId: "" }), (err) => {
      assert.equal(err.field, "adSetId");
      return true;
    });
  });

  test("NO budget is required — it is inherited from the ad set", () => {
    const b = brief({ delivery: { budget: {} } });
    const plan = briefPublishPlan(b, connection(), {
      mode: "existing",
      pairs: pairs(),
      campaignId: "c",
      adSetId: "a",
      s3Base: S3,
    });
    assert.equal(plan.ads.length, 2);
  });

  test("NO objective is required either — the campaign already has one", () => {
    const b = brief({ offer: { primaryObjective: "", conversionLocation: "" } });
    const plan = briefPublishPlan(b, connection(), {
      mode: "existing",
      pairs: pairs(),
      campaignId: "c",
      adSetId: "a",
      s3Base: S3,
    });
    assert.equal(plan.ads.length, 2);
  });
});

// ─── Guards ──────────────────────────────────────────────────────────────────

group("the connection is checked before anything is built", () => {
  for (const [field, patchObj] of [
    ["facebookId", { facebookId: "" }],
    ["connectionId", { connectionId: "" }],
    ["adAccountId", { adAccountId: "" }],
    ["pageId", { pageId: "" }],
  ]) {
    test(`a missing ${field} is a 400-with-a-field`, () => {
      assert.throws(
        () => planAuto({ connection: connection(patchObj) }),
        (err) => {
          assert.ok(err instanceof BriefPublishError);
          assert.equal(err.field, field);
          return true;
        },
      );
    });
  }

  test("an unknown mode is refused rather than silently treated as auto", () => {
    assert.throws(
      () => briefPublishPlan(brief(), connection(), { mode: "whenever", pairs: pairs() }),
      (err) => {
        assert.equal(err.field, "mode");
        return true;
      },
    );
  });

  test("an unresolved objective is refused in auto mode", () => {
    const b = brief({ offer: { primaryObjective: "", conversionLocation: "" } });
    assert.throws(() => planAuto({ brief: b }), (err) => {
      assert.equal(err.field, "primaryObjective");
      return true;
    });
  });

  test("a mongoose document is accepted, not just a plain object", () => {
    const doc = { ...brief(), toObject: () => brief() };
    assert.doesNotThrow(() => planAuto({ brief: doc }));
  });

  test("inputs are not mutated", () => {
    const b = brief();
    const c = connection();
    const p = pairs();
    const before = JSON.stringify({ b, c, p });
    briefPublishPlan(b, c, { mode: "auto", pairs: p, s3Base: S3 });
    assert.equal(JSON.stringify({ b, c, p }), before);
  });
});

// ─── absoluteImageUrl ────────────────────────────────────────────────────────

group("absoluteImageUrl", () => {
  const f = _internals.absoluteImageUrl;

  test("joins a leading-slash key without doubling the slash", () => {
    assert.equal(f("/a/b.png", "https://cdn.test"), "https://cdn.test/a/b.png");
  });

  test("adds the missing slash for a bare key", () => {
    assert.equal(f("a/b.png", "https://cdn.test"), "https://cdn.test/a/b.png");
  });

  test("strips a trailing slash from the base", () => {
    assert.equal(f("/a.png", "https://cdn.test/"), "https://cdn.test/a.png");
  });

  test("leaves http and https alone", () => {
    assert.equal(f("http://x/y.png", "https://cdn.test"), "http://x/y.png");
  });

  test("an empty value stays empty rather than becoming the bare base", () => {
    assert.equal(f("", "https://cdn.test"), "");
  });

  test("no base configured returns the key untouched rather than 'undefined/a.png'", () => {
    assert.equal(f("/a.png", ""), "/a.png");
  });
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log("\nFailures:");
  for (const f of FAILURES) console.log(`\n  ${f.name}\n  ${f.err.stack}`);
  process.exit(1);
}
