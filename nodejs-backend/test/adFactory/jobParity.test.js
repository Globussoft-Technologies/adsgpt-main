#!/usr/bin/env node
/**
 * Job parity — the invariant that lets both front doors share one engine.
 *
 * The orchestrator, the queue, the alert service and every /ads-factory-auto
 * route are unchanged by Quick setup. That is only true if a job created from a
 * brief is the same KIND of document as one created from the canvas, so
 * pause / resume / run-now / history work for both without a special case
 * anywhere.
 *
 * Two things establish it, and this file checks both:
 *
 *   1. Structural parity. Everything outside the template — campaignId,
 *      schedule, pairsPerCycle, model, alerts — is byte-identical between the
 *      two paths for the same inputs.
 *
 *   2. Template equivalence. The paths differ by design at exactly one point:
 *      the canvas sends a template the user saved, Quick setup sends
 *      `{ synthesize: true, ... }` and the backend builds one. So the check is
 *      that synthesis produces a payload which passes the same preflight a
 *      saved template must pass.
 *
 * Both payloads are validated against the LIVE createJobSchema rather than a
 * copy, so schema drift breaks this test rather than production.
 *
 * The controller path itself is shared code — `activateBrief` calls
 * `adsFactoryAutoController.createJob` rather than reimplementing it — so
 * anything past validation is identical by construction, not by copying.
 *
 * Run:  node test/adFactory/jobParity.test.js
 */

const assert = require("node:assert/strict");

const { briefToJobPayload } = require("../../services/adFactory/briefToJobPayload");
const { createJobSchema } = require("../../Validations/adsFactoryAuto/adsFactoryAutoValidation");
const { synthesizeTemplate } = require("../../services/adsFactoryAuto/templateSynthesizer");
const { preflightTemplate } = require("../../services/adsFactoryAuto/templatePreflight");

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

const CAMPAIGN_ID = "65c0000000000000000000ff";
const CONNECTION_ID = "65c0000000000000000000aa";

const connection = () => ({
  facebookId: "fb-123",
  connectionId: CONNECTION_ID,
  adAccountId: "act_998877",
  pageId: "page_5566",
});

const brief = () => ({
  _id: "65b1f2c3d4e5f60718293a4b",
  userId: "user-1",
  campaignId: CAMPAIGN_ID,
  brand: { name: "Tulsi & Co" },
  offer: {
    primaryObjective: "OUTCOME_SALES",
    conversionLocation: "WEBSITE",
    cta: { button: "SHOP_NOW", url: "https://tulsiandco.in/gift-sets" },
  },
  delivery: {
    platforms: ["meta"],
    pairsPerCycle: 3,
    budget: { daily: 800, currency: "INR" },
    frequency: { preset: "weekly", hour: 9, timezone: "Asia/Kolkata", startDate: "2026-09-01" },
  },
  generation: { imageModel: "google" },
});

/**
 * What the canvas sends for the same campaign: a template the user already
 * saved in the V2 wizard. Written out by hand rather than derived from the
 * brief, so the two paths are genuinely compared instead of tautologically.
 */
const canvasPayload = () => ({
  campaignId: CAMPAIGN_ID,
  schedule: {
    frequency: "weekly",
    startDate: "2026-09-01",
    hour: 9,
    timezone: "Asia/Kolkata",
  },
  pairsPerCycle: 3,
  model: "google",
  targets: {
    meta: {
      facebookId: "fb-123",
      connectionId: CONNECTION_ID,
      template: {
        name: "Diwali sales",
        objective: "OUTCOME_SALES",
        conversionLocation: "WEBSITE",
        pageId: "page_5566",
        payload: {
          adAccountId: "act_998877",
          dailyBudget: 800,
          callToAction: "SHOP_NOW",
          linkUrl: "https://tulsiandco.in/gift-sets",
        },
      },
    },
  },
});

const validate = (payload) => createJobSchema.validate(payload, { abortEarly: false });

// ─── 1. Both payloads are accepted by the live schema ────────────────────────

group("both front doors produce a payload createJob accepts", () => {
  test("the brief path validates against the live createJobSchema", () => {
    const { error } = validate(briefToJobPayload(brief(), connection()));
    assert.equal(error, undefined, error?.message);
  });

  test("the canvas path validates against the same schema", () => {
    const { error } = validate(canvasPayload());
    assert.equal(error, undefined, error?.message);
  });
});

group("the schedule accepts the timezones browsers actually send", () => {
  // Regression. `Intl.supportedValuesOf("timeZone")` returns whichever names
  // the linked ICU build calls canonical, so an enum built from it rejected
  // real zones — including Asia/Kolkata, which is what an Indian user's
  // browser reports and this product's primary market. Activation failed with
  // a 400 listing 417 alternatives.
  const withTz = (timezone) => {
    const b = brief();
    b.delivery.frequency.timezone = timezone;
    return validate(briefToJobPayload(b, connection()));
  };

  for (const tz of ["Asia/Kolkata", "Asia/Calcutta", "UTC", "Europe/Kyiv", "America/New_York"]) {
    test(`${tz} is accepted`, () => {
      const { error } = withTz(tz);
      assert.equal(error, undefined, error?.message?.slice(0, 120));
    });
  }

  test("a genuine nonsense timezone is still rejected", () => {
    const { error } = withTz("Mars/Olympus_Mons");
    assert.ok(error, "validation must not have become a rubber stamp");
  });

  test("the schema's own default validates against itself", () => {
    const { error, value } = createJobSchema.validate(
      { ...canvasPayload(), schedule: { frequency: "weekly", hour: 9 } },
      { abortEarly: false },
    );
    assert.equal(error, undefined, error?.message?.slice(0, 120));
    assert.equal(value.schedule.timezone, "UTC");
  });
});

// ─── 2. Structural parity outside the template ───────────────────────────────

group("everything outside the template is identical", () => {
  const fromBrief = briefToJobPayload(brief(), connection());
  const fromCanvas = canvasPayload();

  test("campaignId matches — the same campaign, whichever door was used", () => {
    assert.equal(fromBrief.campaignId, fromCanvas.campaignId);
  });

  test("schedule matches exactly", () => {
    assert.deepEqual(fromBrief.schedule, fromCanvas.schedule);
  });

  test("pairsPerCycle matches", () => {
    assert.equal(fromBrief.pairsPerCycle, fromCanvas.pairsPerCycle);
  });

  test("model matches", () => {
    assert.equal(fromBrief.model, fromCanvas.model);
  });

  test("the Facebook connection is carried identically", () => {
    assert.equal(fromBrief.targets.meta.facebookId, fromCanvas.targets.meta.facebookId);
    assert.equal(fromBrief.targets.meta.connectionId, fromCanvas.targets.meta.connectionId);
  });

  test("no key exists on one path and not the other, outside the template", () => {
    const strip = (p) => {
      const { targets, ...rest } = p;
      const { template, ...meta } = targets.meta;
      return { ...rest, targets: { meta } };
    };
    assert.deepEqual(strip(fromBrief), strip(fromCanvas));
  });
});

// ─── 3. The one deliberate difference resolves to an equivalent template ─────

group("synthesis stands in for a saved template, and passes the same gate", () => {
  const fromBrief = briefToJobPayload(brief(), connection());
  const t = fromBrief.targets.meta.template;

  test("the brief path asks for synthesis rather than naming a saved template", () => {
    assert.equal(t.synthesize, true);
    assert.equal(t.payload, undefined, "synthesize and payload are mutually exclusive");
  });

  test("it carries everything the synthesizer needs", () => {
    assert.equal(t.objective, "OUTCOME_SALES");
    assert.equal(t.conversionLocation, "WEBSITE");
    assert.equal(t.adAccountId, "act_998877");
    assert.equal(t.budget, 800);
    assert.equal(t.pageId, "page_5566");
  });

  test("budget stays in MAJOR units — pre-multiplying would overspend 100x", () => {
    assert.equal(t.budget, 800);
    assert.notEqual(t.budget, 80000);
  });

  test("the synthesized payload passes preflight, the gate saved templates pass", () => {
    const synthesized = synthesizeTemplate({
      objective: t.objective,
      conversionLocation: t.conversionLocation,
      budget: t.budget,
      adAccountId: t.adAccountId,
      pageId: t.pageId,
      linkUrl: t.linkUrl,
      cta: t.callToAction,
    });
    const result = preflightTemplate(synthesized, {
      objective: t.objective,
      conversionLocation: t.conversionLocation,
    });
    assert.equal(result.ok, true, JSON.stringify(result.errors));
  });

  test("the destination and CTA the user chose survive into the template", () => {
    assert.equal(t.linkUrl, "https://tulsiandco.in/gift-sets");
    assert.equal(t.callToAction, "SHOP_NOW");
  });

  test("synthesize + a saved payload together is rejected by the schema", () => {
    const bad = briefToJobPayload(brief(), connection());
    bad.targets.meta.template.payload = { adAccountId: "act_998877" };
    const { error } = validate(bad);
    assert.ok(error, "a template must be either synthesized or saved, never both");
  });
});

// ─── 4. Refusals the user can act on ─────────────────────────────────────────

group("activation refuses with a field, never a silent bad job", () => {
  const cases = [
    ["no campaign", { ...brief(), campaignId: undefined }, connection(), "campaignId"],
    ["no budget", { ...brief(), delivery: { ...brief().delivery, budget: {} } }, connection(), "budget.daily"],
    ["no ad account", brief(), { ...connection(), adAccountId: "" }, "adAccountId"],
    ["no facebook connection", brief(), { ...connection(), facebookId: "" }, "facebookId"],
  ];

  for (const [label, b, conn, field] of cases) {
    test(`${label} → named error on ${field}`, () => {
      assert.throws(
        () => briefToJobPayload(b, conn),
        (e) => e.field === field,
        `expected a BriefJobPayloadError on ${field}`,
      );
    });
  }

  test("a zero budget never becomes a job that cannot deliver", () => {
    const b = brief();
    b.delivery.budget.daily = 0;
    assert.throws(() => briefToJobPayload(b, connection()), (e) => e.field === "budget.daily");
  });
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log("\nFailures:");
  for (const f of FAILURES) console.log(`\n  ${f.name}\n  ${f.err.stack}`);
  process.exit(1);
}
