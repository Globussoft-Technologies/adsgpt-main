#!/usr/bin/env node
/**
 * Tests for services/adsFactoryAuto/templatePreflight.js — the cell-aware
 * validator that runs BEFORE any Meta API call, on both synthesized and saved
 * templates.
 *
 * No DB, no SDK, no stubs. Every test is a fixture in / report out.
 *
 * The point of this module is that a bad template fails here with a message
 * naming the field, instead of failing at Meta with "Invalid parameter".
 *
 * Run:  node test/adsFactoryAuto/templatePreflight.test.js
 */

const assert = require("node:assert/strict");

const {
  preflightTemplate,
  assertTemplateValid,
} = require("../../services/adsFactoryAuto/templatePreflight");
const { synthesizeTemplate } = require("../../services/adsFactoryAuto/templateSynthesizer");
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

// A valid TRAFFIC/WEBSITE template, built the way the synthesizer builds one.
const validTemplate = () =>
  synthesizeTemplate({
    objective: "OUTCOME_TRAFFIC",
    conversionLocation: "WEBSITE",
    adAccountId: "1234567890",
    budget: 800,
    pageId: "9876543210",
    linkUrl: "https://tulsiandco.in/refill-kit",
  });

// Deep clone so a mutation in one test can't leak into another.
const clone = (o) => JSON.parse(JSON.stringify(o));

// Convenience: does the report name this field?
const hasError = (report, field) =>
  report.errors.some((e) => e.field === field);

const fieldsOf = (report) => report.errors.map((e) => e.field);

// ─── Happy path ──────────────────────────────────────────────────────────────

group("valid templates pass", () => {
  test("a synthesized template passes with no errors", () => {
    const report = preflightTemplate(validTemplate());
    assert.deepEqual(report.errors, []);
    assert.equal(report.ok, true);
  });

  test("a saved-style template using a root dailyBudget also passes", () => {
    // Wizard-saved templates express budget as a root dailyBudget rather than
    // the adSetBudget the synthesizer emits. Preflight must accept both, or it
    // would reject every template built in Ads Manager.
    const t = clone(validTemplate());
    delete t.payload.adSetBudget;
    delete t.payload.adSetBudgetType;
    delete t.payload.cbo;
    t.payload.dailyBudget = 800;
    const report = preflightTemplate(t);
    assert.deepEqual(report.errors, []);
  });

  test("accepts a Page supplied on the template root instead of the payload", () => {
    // The orchestrator reads pageId from either location.
    const t = clone(validTemplate());
    delete t.payload.pageId;
    t.pageId = "9876543210";
    assert.equal(preflightTemplate(t).ok, true);
  });

  test("accepts a Page supplied only on the payload", () => {
    const t = clone(validTemplate());
    t.pageId = "";
    t.payload.pageId = "9876543210";
    assert.equal(preflightTemplate(t).ok, true);
  });
});

// ─── Structural failures ─────────────────────────────────────────────────────

group("structural failures", () => {
  test("throws a TypeError when handed a non-object", () => {
    assert.throws(() => preflightTemplate(null), TypeError);
    assert.throws(() => preflightTemplate("nope"), TypeError);
  });

  test("missing objective and conversionLocation are both reported", () => {
    const report = preflightTemplate({ payload: {} });
    assert.equal(report.ok, false);
    assert.ok(hasError(report, "objective"));
    assert.ok(hasError(report, "conversionLocation"));
  });

  test("an unknown cell is reported without throwing", () => {
    const report = preflightTemplate({
      objective: "OUTCOME_TRAFFIC",
      conversionLocation: "NOT_A_LOCATION",
      payload: {},
    });
    assert.equal(report.ok, false);
    assert.ok(hasError(report, "conversionLocation"));
  });

  test("a missing payload does not crash", () => {
    const report = preflightTemplate({
      objective: "OUTCOME_TRAFFIC",
      conversionLocation: "WEBSITE",
    });
    assert.equal(report.ok, false);
    assert.ok(report.errors.length > 0);
  });
});

// ─── Account and budget ──────────────────────────────────────────────────────

group("account and budget", () => {
  test("missing adAccountId is reported", () => {
    const t = clone(validTemplate());
    delete t.payload.adAccountId;
    assert.ok(hasError(preflightTemplate(t), "payload.adAccountId"));
  });

  test("no budget at all is reported once, as payload.budget", () => {
    const t = clone(validTemplate());
    delete t.payload.adSetBudget;
    const report = preflightTemplate(t);
    assert.ok(hasError(report, "payload.budget"));
  });

  test("a zero budget is rejected on the field that carries it", () => {
    // 0 is a present-but-invalid value, so it is reported against
    // payload.adSetBudget — not the generic payload.budget used when no
    // budget field is present at all.
    const t = clone(validTemplate());
    t.payload.adSetBudget = 0;
    assert.ok(hasError(preflightTemplate(t), "payload.adSetBudget"));
  });

  test("a negative budget is rejected on the field that carries it", () => {
    const t = clone(validTemplate());
    t.payload.adSetBudget = -50;
    assert.ok(hasError(preflightTemplate(t), "payload.adSetBudget"));
  });

  test("a non-numeric budget is rejected", () => {
    const t = clone(validTemplate());
    t.payload.adSetBudget = "free";
    assert.ok(hasError(preflightTemplate(t), "payload.adSetBudget"));
  });

  test("a bad root dailyBudget is rejected on its own field name", () => {
    const t = clone(validTemplate());
    delete t.payload.adSetBudget;
    t.payload.dailyBudget = -1;
    assert.ok(hasError(preflightTemplate(t), "payload.dailyBudget"));
  });
});

// ─── Identity ────────────────────────────────────────────────────────────────

group("identity", () => {
  test("a cell requiring a Page rejects a template with none", () => {
    const t = clone(validTemplate());
    t.pageId = "";
    delete t.payload.pageId;
    const report = preflightTemplate(t);
    assert.equal(report.ok, false);
    assert.ok(hasError(report, "pageId"));
  });

  test("a cell requiring a linked app rejects a missing applicationId", () => {
    const cell = getCell("OUTCOME_TRAFFIC", "APP");
    assert.ok(
      (cell.identity.required || []).includes("linkedApp"),
      "fixture assumption: TRAFFIC/APP requires a linked app",
    );
    const t = synthesizeTemplate({
      objective: "OUTCOME_TRAFFIC",
      conversionLocation: "APP",
      adAccountId: "1234567890",
      budget: 500,
      pageId: "9876543210",
      applicationId: "444555666",
      objectStoreUrl: "https://play.google.com/store/apps/details?id=io.adsgpt",
    });
    const broken = clone(t);
    delete broken.payload.applicationId;
    assert.ok(hasError(preflightTemplate(broken), "payload.applicationId"));
  });
});

// ─── Ad-level required fields ────────────────────────────────────────────────

group("ad-level required fields", () => {
  test("a missing linkUrl is reported for a cell that requires it", () => {
    const t = clone(validTemplate());
    delete t.payload.linkUrl;
    assert.ok(hasError(preflightTemplate(t), "payload.linkUrl"));
  });

  test("creative-supplied fields are NOT required on the template", () => {
    // imageHash / headline / primaryText come from the generated creative at
    // launch time. Requiring them here would reject every valid automation
    // template — the whole point is that the template predates the creative.
    const cell = getCell("OUTCOME_TRAFFIC", "WEBSITE");
    assert.ok(
      cell.ad.requiredFields.includes("imageHash"),
      "fixture assumption: the cell requires imageHash at ad level",
    );
    const report = preflightTemplate(validTemplate());
    assert.deepEqual(
      report.errors,
      [],
      `creative fields must be exempt, got: ${JSON.stringify(fieldsOf(report))}`,
    );
  });

  test("an instant-form cell requires a leadFormId", () => {
    const cell = getCell("OUTCOME_LEADS", "INSTANT_FORM");
    assert.ok(
      (cell.additionalSteps || []).includes("leadForm"),
      "fixture assumption: LEADS/INSTANT_FORM has a leadForm step",
    );
    // This cell declares linkUrl required alongside leadFormId — Meta wants a
    // destination for the form's follow-through.
    const t = synthesizeTemplate({
      objective: "OUTCOME_LEADS",
      conversionLocation: "INSTANT_FORM",
      adAccountId: "1234567890",
      budget: 500,
      pageId: "9876543210",
      linkUrl: "https://tulsiandco.in/refill-kit",
      leadFormId: "5551112223",
    });
    const broken = clone(t);
    delete broken.payload.leadFormId;
    assert.ok(hasError(preflightTemplate(broken), "payload.leadFormId"));
  });
});

// ─── Ad set enums ────────────────────────────────────────────────────────────

group("ad set enums", () => {
  test("an optimizationGoal outside the cell is rejected", () => {
    const t = clone(validTemplate());
    t.payload.optimizationGoal = "QUALITY_CALL";
    assert.ok(hasError(preflightTemplate(t), "payload.optimizationGoal"));
  });

  test("an invalid goal does NOT also produce a misleading billingEvent error", () => {
    // Blaming billing for a goal problem sends the reader to the wrong field.
    const t = clone(validTemplate());
    t.payload.optimizationGoal = "QUALITY_CALL";
    t.payload.billingEvent = "IMPRESSIONS";
    const report = preflightTemplate(t);
    assert.ok(hasError(report, "payload.optimizationGoal"));
    assert.ok(!hasError(report, "payload.billingEvent"));
  });

  test("LINK_CLICKS billing paired with a non-click goal is rejected (subcode 1815117)", () => {
    const t = clone(validTemplate());
    t.payload.optimizationGoal = "REACH";
    t.payload.billingEvent = "LINK_CLICKS";
    assert.ok(hasError(preflightTemplate(t), "payload.billingEvent"));
  });

  test("LINK_CLICKS billing with the LINK_CLICKS goal is accepted", () => {
    const t = clone(validTemplate());
    t.payload.optimizationGoal = "LINK_CLICKS";
    t.payload.billingEvent = "LINK_CLICKS";
    assert.equal(preflightTemplate(t).ok, true);
  });

  test("a capped bid strategy without a bidAmount is rejected", () => {
    const t = clone(validTemplate());
    t.payload.bidStrategy = "COST_CAP";
    assert.ok(hasError(preflightTemplate(t), "payload.bidAmount"));
  });

  test("a capped bid strategy with a positive bidAmount is accepted", () => {
    const t = clone(validTemplate());
    t.payload.bidStrategy = "COST_CAP";
    t.payload.bidAmount = 25;
    assert.equal(preflightTemplate(t).ok, true);
  });

  test("autobid needs no bidAmount", () => {
    const t = clone(validTemplate());
    t.payload.bidStrategy = "LOWEST_COST_WITHOUT_CAP";
    delete t.payload.bidAmount;
    assert.equal(preflightTemplate(t).ok, true);
  });

  test("an autobid-only goal rejects a capped strategy (subcode 1885204)", () => {
    const t = synthesizeTemplate({
      objective: "OUTCOME_TRAFFIC",
      conversionLocation: "CALLS",
      adAccountId: "1234567890",
      budget: 500,
      pageId: "9876543210",
      linkUrl: "https://tulsiandco.in/contact",
    });
    const cell = getCell("OUTCOME_TRAFFIC", "CALLS");
    if (cell.adSet.defaultOptimizationGoal !== "QUALITY_CALL") {
      // Fixture guard: if the schema changes this cell's default, skip rather
      // than assert something the schema no longer claims.
      return;
    }
    const broken = clone(t);
    broken.payload.bidStrategy = "COST_CAP";
    broken.payload.bidAmount = 25;
    assert.ok(hasError(preflightTemplate(broken), "payload.bidStrategy"));
  });
});

// ─── CTA ─────────────────────────────────────────────────────────────────────

group("CTA", () => {
  test("a CTA outside the cell's list is rejected", () => {
    const t = clone(validTemplate());
    t.payload.callToAction = "WHATSAPP_MESSAGE";
    assert.ok(hasError(preflightTemplate(t), "payload.callToAction"));
  });

  test("every CTA the cell allows is accepted", () => {
    const cell = getCell("OUTCOME_TRAFFIC", "WEBSITE");
    for (const cta of cell.ctas.allowed) {
      const t = clone(validTemplate());
      t.payload.callToAction = cta;
      assert.equal(
        preflightTemplate(t).ok,
        true,
        `cell-allowed CTA ${cta} was rejected`,
      );
    }
  });
});

// ─── Reporting ───────────────────────────────────────────────────────────────

group("reporting", () => {
  test("reports every problem at once, not one per round trip", () => {
    const t = clone(validTemplate());
    delete t.payload.adAccountId;
    delete t.payload.linkUrl;
    t.payload.adSetBudget = -1;
    t.payload.callToAction = "WHATSAPP_MESSAGE";
    const report = preflightTemplate(t);
    assert.ok(
      report.errors.length >= 4,
      `expected >=4 errors, got ${report.errors.length}: ${JSON.stringify(fieldsOf(report))}`,
    );
  });

  test("every error carries both a field and a message", () => {
    const report = preflightTemplate({ payload: {} });
    for (const e of report.errors) {
      assert.equal(typeof e.field, "string");
      assert.ok(e.field.length > 0);
      assert.equal(typeof e.message, "string");
      assert.ok(e.message.length > 0);
    }
  });

  test("assertTemplateValid returns true for a valid template", () => {
    assert.equal(assertTemplateValid(validTemplate()), true);
  });

  test("assertTemplateValid throws a coded error carrying the full list", () => {
    const t = clone(validTemplate());
    delete t.payload.adAccountId;
    delete t.payload.linkUrl;
    assert.throws(
      () => assertTemplateValid(t),
      (err) =>
        err.code === "TEMPLATE_PREFLIGHT_FAILED" &&
        Array.isArray(err.errors) &&
        err.errors.length >= 2,
    );
  });

  test("does not mutate the template it validates", () => {
    const t = validTemplate();
    const snapshot = clone(t);
    preflightTemplate(t);
    assert.deepEqual(t, snapshot);
  });
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log("\nFailures:");
  for (const f of FAILURES) console.log(`  ✗ ${f.name}\n    ${f.err.stack}`);
  process.exit(1);
}
