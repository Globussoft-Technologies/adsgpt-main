#!/usr/bin/env node
/**
 * Tests for services/adsFactoryAuto/templateSynthesizer.js — the pure builder
 * that produces a valid Meta campaign template from an objective + budget, so
 * scheduling no longer dead-ends on "no saved templates".
 *
 * No DB, no SDK, no stubs. Every test is a fixture in / value out.
 *
 * The centrepiece is the table-driven sweep: it walks EVERY implemented
 * (objective, conversionLocation) cell in config/wizardSchema.js and asserts
 * the synthesized payload agrees with that cell. That turns "auto-generated
 * payloads might fail Meta validation" from a hope into a CI assertion, and it
 * picks up new cells automatically as the schema grows.
 *
 * Run:  node test/adsFactoryAuto/templateSynthesizer.test.js
 */

const assert = require("node:assert/strict");

const {
  synthesizeTemplate,
  TemplateSynthesisError,
  _internals,
} = require("../../services/adsFactoryAuto/templateSynthesizer");
const { preflightTemplate } = require("../../services/adsFactoryAuto/templatePreflight");
const {
  listObjectives,
  listConversionLocations,
  getCell,
  isCellImplemented,
  getAllowedBillingEvents,
  getAllowedBidStrategies,
} = require("../../config/wizardSchema");

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

const ACCOUNT = "1234567890";
const PAGE = "9876543210";
const LINK = "https://tulsiandco.in/refill-kit";

// Build the minimum viable input for any cell: supply every conditionally
// required field so the sweep exercises the happy path for all of them.
const inputFor = (objective, conversionLocation, extra = {}) => ({
  objective,
  conversionLocation,
  adAccountId: ACCOUNT,
  budget: 800,
  pageId: PAGE,
  linkUrl: LINK,
  leadFormId: "5551112223",
  applicationId: "444555666",
  objectStoreUrl: "https://play.google.com/store/apps/details?id=io.adsgpt",
  ...extra,
});

// Every implemented cell in the schema, as [objective, conversionLocation].
const implementedCells = () => {
  const out = [];
  for (const objective of listObjectives()) {
    for (const location of listConversionLocations(objective)) {
      if (isCellImplemented(objective, location)) out.push([objective, location]);
    }
  }
  return out;
};

const CELLS = implementedCells();

// ─── Sweep — every implemented cell ──────────────────────────────────────────

group(`synthesizeTemplate — every implemented cell (${CELLS.length} found)`, () => {
  test("the schema exposes at least one implemented cell", () => {
    assert.ok(
      CELLS.length > 0,
      "no implemented cells found — the sweep below would vacuously pass",
    );
  });

  for (const [objective, location] of CELLS) {
    const cell = getCell(objective, location);

    test(`${objective} / ${location} — produces a payload that passes preflight`, () => {
      const template = synthesizeTemplate(inputFor(objective, location));
      const report = preflightTemplate(template);
      assert.deepEqual(
        report.errors,
        [],
        `preflight rejected a synthesized template: ${JSON.stringify(report.errors)}`,
      );
      assert.equal(report.ok, true);
    });

    test(`${objective} / ${location} — uses the cell's declared defaults`, () => {
      const { payload } = synthesizeTemplate(inputFor(objective, location));

      assert.equal(
        payload.optimizationGoal,
        cell.adSet.defaultOptimizationGoal,
        "optimizationGoal must be the cell's default",
      );

      const allowedBilling = getAllowedBillingEvents(cell, payload.optimizationGoal);
      assert.ok(
        allowedBilling.includes(payload.billingEvent),
        `billingEvent ${payload.billingEvent} not in allowed [${allowedBilling}]`,
      );

      const allowedBid = getAllowedBidStrategies(cell, payload.optimizationGoal);
      assert.ok(
        allowedBid.includes(payload.bidStrategy),
        `bidStrategy ${payload.bidStrategy} not in allowed [${allowedBid}]`,
      );

      assert.equal(
        payload.callToAction,
        cell.ctas.default,
        "callToAction must be the cell's default",
      );
      assert.ok(
        cell.ctas.allowed.includes(payload.callToAction),
        "the cell's own default CTA must be in its allowed list",
      );
    });

    test(`${objective} / ${location} — never emits a capped bid strategy without a bid`, () => {
      const { payload } = synthesizeTemplate(inputFor(objective, location));
      const capped = ["LOWEST_COST_WITH_BID_CAP", "COST_CAP"];
      if (capped.includes(payload.bidStrategy)) {
        assert.ok(
          Number(payload.bidAmount) > 0,
          "a capped bid strategy requires a positive bidAmount",
        );
      }
    });

    test(`${objective} / ${location} — carries objective + conversionLocation on root and payload`, () => {
      // The orchestrator reads these from BOTH places (template root for the
      // ad set / ad Joi schemas, payload for its own branching), so a
      // template missing either half fails at a different layer each time.
      const template = synthesizeTemplate(inputFor(objective, location));
      assert.equal(template.objective, objective);
      assert.equal(template.conversionLocation, location);
      assert.equal(template.payload.objective, objective);
      assert.equal(template.payload.conversionLocation, location);
    });
  }
});

// ─── Budget model ────────────────────────────────────────────────────────────

group("budget — expressed as an ad-set budget, never a root dailyBudget", () => {
  const base = inputFor("OUTCOME_TRAFFIC", "WEBSITE");

  test("emits cbo:false + adSetBudget + adSetBudgetType", () => {
    const { payload } = synthesizeTemplate(base);
    assert.equal(payload.cbo, false);
    assert.equal(payload.adSetBudget, 800);
    assert.equal(payload.adSetBudgetType, "daily");
  });

  test("does NOT emit a root dailyBudget", () => {
    // The orchestrator copies payload.dailyBudget to the CAMPAIGN without the
    // x100 minor-unit conversion it applies to adSetBudget. Emitting one here
    // would send Rs800 to Meta as 800 paise (Rs8).
    const { payload } = synthesizeTemplate(base);
    assert.equal(
      payload.dailyBudget,
      undefined,
      "a root dailyBudget bypasses the x100 conversion — see the comment in templateSynthesizer",
    );
    assert.equal(payload.lifetimeBudget, undefined);
  });

  test("budget stays in major units — conversion is the orchestrator's job", () => {
    const { payload } = synthesizeTemplate({ ...base, budget: 1250.5 });
    assert.equal(payload.adSetBudget, 1250.5);
  });

  test("accepts a numeric string budget", () => {
    const { payload } = synthesizeTemplate({ ...base, budget: "800" });
    assert.equal(payload.adSetBudget, 800);
  });

  // Labelled explicitly — JSON.stringify collapses NaN and Infinity to "null",
  // which would give three different cases the same test name.
  const badBudgets = [
    ["zero", 0],
    ["negative", -1],
    ["undefined", undefined],
    ["null", null],
    ["empty string", ""],
    ["non-numeric string", "abc"],
    ["NaN", NaN],
    ["Infinity", Infinity],
  ];
  for (const [label, bad] of badBudgets) {
    test(`rejects a ${label} budget with a named error`, () => {
      assert.throws(
        () => synthesizeTemplate({ ...base, budget: bad }),
        (err) =>
          err instanceof TemplateSynthesisError && err.field === "budget",
        "must throw TemplateSynthesisError on field 'budget'",
      );
    });
  }
});

// ─── Required inputs ─────────────────────────────────────────────────────────

group("required inputs", () => {
  const base = inputFor("OUTCOME_TRAFFIC", "WEBSITE");

  test("objective is required", () => {
    assert.throws(
      () => synthesizeTemplate({ ...base, objective: undefined }),
      (e) => e instanceof TemplateSynthesisError && e.field === "objective",
    );
  });

  test("conversionLocation is required", () => {
    assert.throws(
      () => synthesizeTemplate({ ...base, conversionLocation: undefined }),
      (e) =>
        e instanceof TemplateSynthesisError && e.field === "conversionLocation",
    );
  });

  test("adAccountId is required", () => {
    assert.throws(
      () => synthesizeTemplate({ ...base, adAccountId: "" }),
      (e) => e instanceof TemplateSynthesisError && e.field === "adAccountId",
    );
  });

  test("pageId is required when the cell requires Page identity", () => {
    const cell = getCell("OUTCOME_TRAFFIC", "WEBSITE");
    assert.ok(
      (cell.identity.required || []).includes("page"),
      "fixture assumption: TRAFFIC/WEBSITE requires a Page",
    );
    assert.throws(
      () => synthesizeTemplate({ ...base, pageId: "" }),
      (e) => e instanceof TemplateSynthesisError && e.field === "pageId",
    );
  });

  test("linkUrl is required when the cell requires it", () => {
    const cell = getCell("OUTCOME_TRAFFIC", "WEBSITE");
    assert.ok(
      cell.ad.requiredFields.includes("linkUrl"),
      "fixture assumption: TRAFFIC/WEBSITE requires linkUrl",
    );
    assert.throws(
      () => synthesizeTemplate({ ...base, linkUrl: "" }),
      (e) => e instanceof TemplateSynthesisError && e.field === "linkUrl",
    );
  });

  test("an unknown cell throws a named error, not a bare getCell throw", () => {
    assert.throws(
      () => synthesizeTemplate({ ...base, conversionLocation: "NOT_A_LOCATION" }),
      (e) =>
        e instanceof TemplateSynthesisError && e.field === "conversionLocation",
    );
  });

  test("an unknown objective throws a named error", () => {
    assert.throws(
      () => synthesizeTemplate({ ...base, objective: "OUTCOME_NONSENSE" }),
      (e) => e instanceof TemplateSynthesisError,
    );
  });
});

// ─── Caller overrides ────────────────────────────────────────────────────────

group("caller overrides are honoured or loudly rejected", () => {
  const base = inputFor("OUTCOME_TRAFFIC", "WEBSITE");
  const cell = getCell("OUTCOME_TRAFFIC", "WEBSITE");

  test("an allowed CTA override is used", () => {
    const allowed = cell.ctas.allowed.find((c) => c !== cell.ctas.default);
    const { payload } = synthesizeTemplate({ ...base, callToAction: allowed });
    assert.equal(payload.callToAction, allowed);
  });

  test("a forbidden CTA throws rather than silently falling back", () => {
    // Silent correction would hide a real mismatch until Meta rejected the
    // launch, which is exactly the failure mode this module exists to remove.
    assert.throws(
      () => synthesizeTemplate({ ...base, callToAction: "WHATSAPP_MESSAGE" }),
      (e) => e instanceof TemplateSynthesisError && e.field === "callToAction",
    );
  });

  test("an allowed optimizationGoal override is used", () => {
    const alt = cell.adSet.optimizationGoals.find(
      (g) => g !== cell.adSet.defaultOptimizationGoal,
    );
    const { payload } = synthesizeTemplate({ ...base, optimizationGoal: alt });
    assert.equal(payload.optimizationGoal, alt);
  });

  test("a forbidden optimizationGoal throws", () => {
    assert.throws(
      () => synthesizeTemplate({ ...base, optimizationGoal: "QUALITY_CALL" }),
      (e) =>
        e instanceof TemplateSynthesisError && e.field === "optimizationGoal",
    );
  });

  test("billingEvent narrows with the goal — LINK_CLICKS billing is dropped off a non-click goal", () => {
    // Meta subcode 1815117: LINK_CLICKS billing is only valid with the
    // LINK_CLICKS goal. Picking REACH must not leave LINK_CLICKS billing behind.
    const { payload } = synthesizeTemplate({
      ...base,
      optimizationGoal: "REACH",
    });
    const allowed = getAllowedBillingEvents(cell, "REACH");
    assert.ok(allowed.includes(payload.billingEvent));
    assert.notEqual(payload.billingEvent, "LINK_CLICKS");
  });

  test("an explicitly invalid goal/billing pair throws", () => {
    assert.throws(
      () =>
        synthesizeTemplate({
          ...base,
          optimizationGoal: "REACH",
          billingEvent: "LINK_CLICKS",
        }),
      (e) => e instanceof TemplateSynthesisError && e.field === "billingEvent",
    );
  });

  test("custom targeting replaces the worldwide default", () => {
    const targeting = { locations: [{ type: "country", key: "IN", mode: "include" }] };
    const { payload } = synthesizeTemplate({ ...base, targeting });
    assert.deepEqual(payload.targeting, targeting);
  });

  test("default targeting is worldwide and is a copy, not the shared constant", () => {
    const a = synthesizeTemplate(base).payload.targeting;
    const b = synthesizeTemplate(base).payload.targeting;
    assert.deepEqual(a, { worldwide: true });
    assert.notEqual(a, b, "each call must get its own targeting object");
    assert.notEqual(
      a,
      _internals.DEFAULT_TARGETING,
      "must not hand out the frozen module constant",
    );
  });

  test("campaignName is used when given, trimmed", () => {
    const { name, payload } = synthesizeTemplate({
      ...base,
      campaignName: "  Tulsi refill kit  ",
    });
    assert.equal(name, "Tulsi refill kit");
    assert.equal(payload.name, "Tulsi refill kit");
  });

  test("a blank campaignName falls back to a readable default", () => {
    const { name } = synthesizeTemplate({ ...base, campaignName: "   " });
    assert.equal(name, "AdsGPT Traffic");
  });

  test("instagramUserId is passed through under the v22 field name", () => {
    const { payload } = synthesizeTemplate({ ...base, instagramUserId: "17841400000000000" });
    assert.equal(payload.instagramUserId, "17841400000000000");
    assert.equal(payload.instagram_actor_id, undefined);
    assert.equal(payload.instagramActorId, undefined);
  });

  test("optional ids are omitted entirely when not supplied, not set to empty strings", () => {
    const { payload } = synthesizeTemplate({
      objective: "OUTCOME_TRAFFIC",
      conversionLocation: "WEBSITE",
      adAccountId: ACCOUNT,
      budget: 500,
      pageId: PAGE,
      linkUrl: LINK,
    });
    assert.ok(!("instagramUserId" in payload));
    assert.ok(!("leadFormId" in payload));
    assert.ok(!("applicationId" in payload));
  });
});

// ─── Template envelope ───────────────────────────────────────────────────────

group("template envelope", () => {
  const base = inputFor("OUTCOME_TRAFFIC", "WEBSITE");

  test("marked source:'synthesized' so Ads Manager can surface and edit it", () => {
    assert.equal(synthesizeTemplate(base).source, "synthesized");
  });

  test("saved status is PAUSED — the orchestrator overrides to ACTIVE at launch", () => {
    // The template's stored default must not start spending if a user opens
    // it in Ads Manager. Automation runs still go live: the orchestrator sets
    // status ACTIVE explicitly on campaign, ad set and ad.
    assert.equal(synthesizeTemplate(base).payload.status, "PAUSED");
  });

  test("specialAdCategories defaults to an empty array, matching the wizard", () => {
    assert.deepEqual(synthesizeTemplate(base).payload.specialAdCategories, []);
  });

  test("pageId is mirrored onto the template root", () => {
    assert.equal(synthesizeTemplate(base).pageId, PAGE);
  });

  test("ids are stringified — Mongo/Meta ids must never travel as numbers", () => {
    const { payload } = synthesizeTemplate({
      ...base,
      adAccountId: 1234567890,
      pageId: 9876543210,
    });
    assert.equal(typeof payload.adAccountId, "string");
    assert.equal(typeof payload.pageId, "string");
  });

  test("is pure — repeated calls with the same input are deep-equal", () => {
    assert.deepEqual(synthesizeTemplate(base), synthesizeTemplate(base));
  });

  test("does not mutate its input", () => {
    const input = inputFor("OUTCOME_TRAFFIC", "WEBSITE");
    const snapshot = JSON.parse(JSON.stringify(input));
    synthesizeTemplate(input);
    assert.deepEqual(input, snapshot);
  });
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log("\nFailures:");
  for (const f of FAILURES) console.log(`  ✗ ${f.name}\n    ${f.err.stack}`);
  process.exit(1);
}
