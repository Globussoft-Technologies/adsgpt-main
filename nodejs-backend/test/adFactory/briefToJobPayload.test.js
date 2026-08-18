#!/usr/bin/env node
/**
 * Tests for services/adFactory/briefToJobPayload.js.
 *
 * The load-bearing assertion here is that the output validates against the
 * LIVE `createJobSchema` — imported from
 * Validations/adsFactoryAuto/adsFactoryAutoValidation, not copied. If the
 * automation API's contract ever moves, this breaks the build instead of
 * breaking activation in production.
 *
 * The second one is end-to-end: the payload's synthesize block is fed through
 * the real `templateSynthesizer` and `templatePreflight`, proving a brief can
 * actually produce a launchable Meta template rather than merely a
 * schema-shaped object.
 *
 * No DB, no SDK, no network.
 *
 * Run:  node test/adFactory/briefToJobPayload.test.js
 */

const assert = require("node:assert/strict");

const {
  briefToJobPayload,
  BriefJobPayloadError,
  _internals,
} = require("../../services/adFactory/briefToJobPayload");
const {
  createJobSchema,
} = require("../../Validations/adsFactoryAuto/adsFactoryAutoValidation");
const {
  synthesizeTemplate,
} = require("../../services/adsFactoryAuto/templateSynthesizer");
const {
  preflightTemplate,
} = require("../../services/adsFactoryAuto/templatePreflight");

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

const CAMPAIGN_ID = "0123456789abcdef01234567";
const CONNECTION_ID = "89abcdef0123456789abcdef";

const connection = (extra = {}) => ({
  facebookId: "1234567890",
  connectionId: CONNECTION_ID,
  adAccountId: "9988776655",
  pageId: "5544332211",
  ...extra,
});

const brief = (extra = {}) => ({
  _id: "aaaaaaaaaaaaaaaaaaaaaaaa",
  userId: "GPT-438",
  campaignId: CAMPAIGN_ID,
  brand: { name: "Tulsi & Co." },
  offer: {
    primaryObjective: "OUTCOME_TRAFFIC",
    conversionLocation: "WEBSITE",
    cta: { button: "SHOP_NOW", url: "https://tulsiandco.in/refill-kit" },
  },
  delivery: {
    platforms: ["meta"],
    pairsPerCycle: 3,
    budget: { daily: 800, currency: "INR" },
    frequency: { preset: "weekly", hour: 9, timezone: "UTC" },
  },
  generation: { imageModel: "google", imageCount: 3, textCount: 3 },
  ...extra,
});

const validate = (payload) => createJobSchema.validate(payload, { abortEarly: false });
const msgs = (error) => (error ? error.details.map((d) => d.message).join("; ") : "");

// ─── The contract ────────────────────────────────────────────────────────────

group("output validates against the LIVE createJobSchema", () => {
  test("a complete brief produces a valid job body", () => {
    const { error } = validate(briefToJobPayload(brief(), connection()));
    assert.equal(error, undefined, msgs(error));
  });

  test("valid without a Page (cells that don't require one)", () => {
    const payload = briefToJobPayload(brief(), connection({ pageId: "" }));
    const { error } = validate(payload);
    assert.equal(error, undefined, msgs(error));
  });

  test("valid with an end date", () => {
    const b = brief();
    b.delivery.frequency.endDate = "2026-12-31";
    const { error } = validate(briefToJobPayload(b, connection()));
    assert.equal(error, undefined, msgs(error));
  });

  test("valid with alert emails", () => {
    const { error } = validate(
      briefToJobPayload(brief({ alertEmails: ["a@x.test", "b@x.test"] }), connection()),
    );
    assert.equal(error, undefined, msgs(error));
  });

  test("valid with an Instagram identity", () => {
    const { error } = validate(
      briefToJobPayload(brief(), connection({ instagramUserId: "17841400000000000" })),
    );
    assert.equal(error, undefined, msgs(error));
  });

  test("valid for every frequency preset the builder can emit", () => {
    for (const preset of _internals.FREQUENCY_PRESETS) {
      const b = brief();
      b.delivery.frequency.preset = preset;
      const payload = briefToJobPayload(b, connection());
      const { error } = validate(payload);
      assert.equal(error, undefined, `${preset}: ${msgs(error)}`);
    }
  });
});

// ─── End to end into a real template ─────────────────────────────────────────

group("the synthesize block actually produces a launchable template", () => {
  test("payload → synthesizeTemplate → preflight, clean", () => {
    // Schema-valid is not the same as launchable. This closes that gap.
    const payload = briefToJobPayload(brief(), connection());
    const template = synthesizeTemplate(payload.targets.meta.template);
    const report = preflightTemplate(template);
    assert.deepEqual(report.errors, [], JSON.stringify(report.errors));
  });

  test("the CTA the brief chose survives into the template", () => {
    const payload = briefToJobPayload(brief(), connection());
    const template = synthesizeTemplate(payload.targets.meta.template);
    assert.equal(template.payload.callToAction, "SHOP_NOW");
  });

  test("the budget arrives as an ad-set budget in major units", () => {
    const payload = briefToJobPayload(brief(), connection());
    const template = synthesizeTemplate(payload.targets.meta.template);
    assert.equal(template.payload.adSetBudget, 800);
    assert.equal(template.payload.dailyBudget, undefined);
  });

  test("a LEADS brief also produces a launchable template", () => {
    const b = brief();
    b.offer.primaryObjective = "OUTCOME_LEADS";
    b.offer.conversionLocation = "WEBSITE";
    const payload = briefToJobPayload(b, connection());
    const template = synthesizeTemplate(payload.targets.meta.template);
    assert.deepEqual(preflightTemplate(template).errors, []);
  });

  test("a CTA left stale by an objective edit is dropped, not sent", () => {
    // The mapper resolves the CTA against the cell it chose, so a fresh brief
    // is always consistent. A user can then edit the objective and leave
    // SHOP_NOW on a Leads brief — Meta rejects that pairing. Dropping it lets
    // the synthesizer apply the cell default instead of the job failing hours
    // later inside a cron worker.
    const b = brief();
    b.offer.primaryObjective = "OUTCOME_LEADS";
    b.offer.conversionLocation = "WEBSITE";
    b.offer.cta.button = "SHOP_NOW"; // not allowed for Leads/Website
    const payload = briefToJobPayload(b, connection());
    assert.equal(payload.targets.meta.template.callToAction, undefined);

    const template = synthesizeTemplate(payload.targets.meta.template);
    assert.deepEqual(preflightTemplate(template).errors, []);
    // Fell back to the cell's own default rather than being dropped entirely.
    assert.ok(template.payload.callToAction);
  });

  test("a CTA valid for the edited objective IS kept", () => {
    const b = brief();
    b.offer.primaryObjective = "OUTCOME_LEADS";
    b.offer.conversionLocation = "WEBSITE";
    b.offer.cta.button = "SIGN_UP";
    const payload = briefToJobPayload(b, connection());
    assert.equal(payload.targets.meta.template.callToAction, "SIGN_UP");
  });

  test("an unknown cell drops the CTA rather than throwing", () => {
    assert.equal(_internals.ctaValidForCell("SHOP_NOW", "OUTCOME_NONSENSE", "NOWHERE"), null);
  });
});

// ─── Defaults ────────────────────────────────────────────────────────────────

group("defaults, so nothing is asked twice", () => {
  test("frequency defaults to weekly", () => {
    const b = brief();
    delete b.delivery.frequency.preset;
    assert.equal(briefToJobPayload(b, connection()).schedule.frequency, "weekly");
  });

  test("an unrecognised preset falls back rather than emitting junk", () => {
    const b = brief();
    b.delivery.frequency.preset = "fortnightly";
    assert.equal(briefToJobPayload(b, connection()).schedule.frequency, "weekly");
  });

  test('"custom" is emitted WITH the block scheduleSchema requires', () => {
    // This used to fall back to weekly, because the brief had nowhere to hold
    // repeatEvery / repeatUnit / repeatOnDays and emitting the word without
    // them is a 400 at activation. `delivery.frequency.custom` now exists, so
    // "every 2 weeks on Tuesdays" survives instead of being downgraded.
    const b = brief();
    b.delivery.frequency.preset = "custom";
    b.delivery.frequency.custom = {
      repeatEvery: 2,
      repeatUnit: "week",
      repeatOnDays: ["tuesday"],
    };
    const payload = briefToJobPayload(b, connection());
    assert.equal(payload.schedule.frequency, "custom");
    assert.deepEqual(payload.schedule.customFrequency, {
      repeatEvery: 2,
      repeatUnit: "week",
      repeatOnDays: ["tuesday"],
    });
    const { error } = validate(payload);
    assert.equal(error, undefined, msgs(error));
  });

  test('"custom" with no block still validates — the normaliser fills it', () => {
    // The block is REQUIRED by scheduleSchema, so a half-built custom cadence
    // must not reach it. An empty repeatOnDays is legitimate: the queue
    // resolves it to the start date's own weekday.
    const b = brief();
    b.delivery.frequency.preset = "custom";
    delete b.delivery.frequency.custom;
    const payload = briefToJobPayload(b, connection());
    assert.equal(payload.schedule.frequency, "custom");
    assert.deepEqual(payload.schedule.customFrequency, {
      repeatEvery: 1,
      repeatUnit: "week",
      repeatOnDays: [],
    });
    assert.equal(validate(payload).error, undefined);
  });

  test("a non-custom frequency carries no customFrequency block", () => {
    const b = brief();
    b.delivery.frequency.preset = "daily";
    b.delivery.frequency.custom = { repeatEvery: 3, repeatUnit: "week" };
    assert.equal(briefToJobPayload(b, connection()).schedule.customFrequency, undefined);
  });

  test("short aliases map to the API's names", () => {
    assert.equal(_internals.resolveFrequency("weekday"), "every_weekday");
    assert.equal(_internals.resolveFrequency("weekend"), "every_weekend");
  });

  test("hour defaults to 9, not midnight", () => {
    const b = brief();
    delete b.delivery.frequency.hour;
    assert.equal(briefToJobPayload(b, connection()).schedule.hour, 9);
  });

  test("hour 0 is preserved — it is a real choice, not a missing value", () => {
    const b = brief();
    b.delivery.frequency.hour = 0;
    assert.equal(briefToJobPayload(b, connection()).schedule.hour, 0);
  });

  test("startDate defaults to today in the brief's timezone", () => {
    const b = brief();
    delete b.delivery.frequency.startDate;
    const { schedule } = briefToJobPayload(b, connection());
    assert.match(schedule.startDate, /^\d{4}-\d{2}-\d{2}$/);
  });

  test("pairsPerCycle defaults to 3", () => {
    const b = brief();
    delete b.delivery.pairsPerCycle;
    assert.equal(briefToJobPayload(b, connection()).pairsPerCycle, 3);
  });

  test("pairsPerCycle is clamped into the schema's range", () => {
    for (const [input, expected] of [[0, 1], [-5, 1], [500, 200], [2.6, 3]]) {
      const b = brief();
      b.delivery.pairsPerCycle = input;
      assert.equal(briefToJobPayload(b, connection()).pairsPerCycle, expected);
    }
  });

  test("the 'auto' model sentinel is omitted, not sent as a provider", () => {
    const b = brief();
    b.generation.imageModel = "auto";
    assert.equal(briefToJobPayload(b, connection()).model, undefined);
  });

  test("a real model is sent", () => {
    assert.equal(briefToJobPayload(brief(), connection()).model, "google");
  });
});

// ─── Required inputs ─────────────────────────────────────────────────────────

group("refuses to build something that would fail later", () => {
  const cases = [
    ["campaignId missing", (b) => delete b.campaignId, "campaignId"],
    ["campaignId not an ObjectId", (b) => (b.campaignId = "nope"), "campaignId"],
    ["budget missing", (b) => delete b.delivery.budget.daily, "budget.daily"],
    ["budget zero", (b) => (b.delivery.budget.daily = 0), "budget.daily"],
    ["budget negative", (b) => (b.delivery.budget.daily = -1), "budget.daily"],
    ["budget non-numeric", (b) => (b.delivery.budget.daily = "free"), "budget.daily"],
    ["objective unresolved", (b) => (b.offer.primaryObjective = ""), "offer.primaryObjective"],
    [
      "conversionLocation unresolved",
      (b) => (b.offer.conversionLocation = ""),
      "offer.primaryObjective",
    ],
  ];

  for (const [label, mutate, field] of cases) {
    test(`${label} → named error on ${field}`, () => {
      const b = brief();
      mutate(b);
      assert.throws(
        () => briefToJobPayload(b, connection()),
        (err) => err instanceof BriefJobPayloadError && err.field === field,
      );
    });
  }

  const connCases = [
    ["facebookId missing", { facebookId: "" }, "facebookId"],
    ["connectionId missing", { connectionId: "" }, "connectionId"],
    ["connectionId not hex", { connectionId: "not-a-mongo-id" }, "connectionId"],
    ["adAccountId missing", { adAccountId: "" }, "adAccountId"],
  ];

  for (const [label, patch, field] of connCases) {
    test(`${label} → named error on ${field}`, () => {
      assert.throws(
        () => briefToJobPayload(brief(), connection(patch)),
        (err) => err instanceof BriefJobPayloadError && err.field === field,
      );
    });
  }

  test("a zero budget never silently becomes a job that can't deliver", () => {
    const b = brief();
    b.delivery.budget.daily = 0;
    assert.throws(() => briefToJobPayload(b, connection()), BriefJobPayloadError);
  });
});

// ─── Purity ──────────────────────────────────────────────────────────────────

group("purity", () => {
  test("does not mutate the brief or the connection", () => {
    const b = brief();
    const c = connection();
    const bSnap = JSON.parse(JSON.stringify(b));
    const cSnap = JSON.parse(JSON.stringify(c));
    briefToJobPayload(b, c);
    assert.deepEqual(b, bSnap);
    assert.deepEqual(c, cSnap);
  });

  test("repeated calls agree", () => {
    const b = brief();
    const c = connection();
    assert.deepEqual(briefToJobPayload(b, c), briefToJobPayload(b, c));
  });

  test("handles Mongoose-style documents", () => {
    const doc = { toObject: () => brief() };
    assert.doesNotThrow(() => briefToJobPayload(doc, connection()));
  });
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log("\nFailures:");
  for (const f of FAILURES) console.log(`  ✗ ${f.name}\n    ${f.err.stack}`);
  process.exit(1);
}
