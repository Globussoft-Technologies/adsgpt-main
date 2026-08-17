#!/usr/bin/env node
/**
 * Tests for services/adFactory/briefMapper.js — the pure mapper that turns an
 * autofill response into an Ad Factory brief.
 *
 * No DB, no SDK, no stubs. Fixtures in `test/fixtures/autofill/` are shaped
 * exactly like the Python service's `AutofillResponse`, so if that contract
 * changes these fail loudly instead of silently mapping nothing.
 *
 * The mapper's contract is: degrade, never throw. Most of what's below is
 * pressure on that promise.
 *
 * Run:  node test/adFactory/briefMapper.test.js
 */

const assert = require("node:assert/strict");
const path = require("node:path");

const {
  mapAutofillToBrief,
  lowConfidenceFields,
  CONFIDENCE,
  _internals,
} = require("../../services/adFactory/briefMapper");
const { getCell } = require("../../config/wizardSchema");

const fixture = (name) =>
  require(path.join(__dirname, "..", "fixtures", "autofill", `${name}.json`));

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

const URL_TULSI = "https://tulsiandco.in/refill-kit";

// ─── Complete response ───────────────────────────────────────────────────────

group("a complete autofill response maps field-for-field", () => {
  const brief = mapAutofillToBrief(fixture("complete"), { url: URL_TULSI });

  test("brand identity", () => {
    assert.equal(brief.brand.name, "Tulsi & Co.");
    assert.match(brief.brand.description, /Ayurvedic skincare/);
    assert.equal(brief.brand.category, "beauty");
  });

  test("voice, tone, dos and donts — v1's five blocking brand fields", () => {
    assert.deepEqual(brief.brand.voice, ["warm", "grounded", "unfussy"]);
    assert.equal(brief.brand.tone, "friendly and plain-spoken");
    assert.equal(brief.brand.dos.length, 3);
    assert.equal(brief.brand.donts.length, 3);
    assert.equal(brief.brand.palette.length, 4);
  });

  test("audience — v1's other blocking field", () => {
    assert.ok(brief.offer.audience.includes("clean-beauty switchers"));
    assert.equal(brief.offer.audience.length, 3);
  });

  test("seed images replace the mandatory asset upload", () => {
    assert.equal(brief.generation.seedImages.length, 3);
  });

  test("logos are carried through", () => {
    assert.deepEqual(brief.brand.logoUrls, ["https://tulsiandco.in/static/logo.svg"]);
  });

  test("status is draft, not needs_input", () => {
    assert.equal(brief.status, "draft");
  });

  test("source records the URL it came from", () => {
    assert.deepEqual(brief.source, { type: "url", url: URL_TULSI });
  });
});

// ─── Objective heuristic ─────────────────────────────────────────────────────

group("objective heuristic", () => {
  test('"Sell refill kits" → OUTCOME_SALES', () => {
    const brief = mapAutofillToBrief(fixture("complete"), { url: URL_TULSI });
    assert.equal(brief.offer.primaryObjective, "OUTCOME_SALES");
  });

  test('"book a free consultation" → OUTCOME_LEADS', () => {
    const brief = mapAutofillToBrief(fixture("leadgen"), { url: "https://meridianfit.in" });
    assert.equal(brief.offer.primaryObjective, "OUTCOME_LEADS");
  });

  test('"learn about our blends" → OUTCOME_TRAFFIC (the default)', () => {
    const brief = mapAutofillToBrief(fixture("partial"), { url: "https://kadaifoods.in" });
    assert.equal(brief.offer.primaryObjective, "OUTCOME_TRAFFIC");
  });

  test("sales wins over leads when a page shows both signals", () => {
    // A storefront with a newsletter is a storefront.
    const { resolveObjective } = _internals;
    const r = resolveObjective({ primaryObjective: "Shop our store and sign up for offers" });
    assert.equal(r.objective, "OUTCOME_SALES");
  });

  test("nothing to go on → traffic, flagged as defaulted", () => {
    const { resolveObjective } = _internals;
    const r = resolveObjective({}, {});
    assert.equal(r.objective, "OUTCOME_TRAFFIC");
    assert.equal(r.confidence, CONFIDENCE.DEFAULTED);
  });

  test("every objective the heuristic can emit is a real implemented cell", () => {
    // A heuristic that returns a cell the synthesizer can't build is a bug
    // that would only surface at activation.
    const seen = [
      ..._internals.OBJECTIVE_RULES.map((r) => [r.objective, r.conversionLocation]),
      [_internals.DEFAULT_OBJECTIVE, _internals.DEFAULT_CONVERSION_LOCATION],
    ];
    for (const [objective, location] of seen) {
      assert.doesNotThrow(
        () => getCell(objective, location),
        `${objective}/${location} is not a real cell`,
      );
    }
  });
});

// ─── CTA ─────────────────────────────────────────────────────────────────────

group("CTA resolution never emits an enum the cell forbids", () => {
  test("page CTA text maps to an allowed enum", () => {
    const brief = mapAutofillToBrief(fixture("leadgen"), { url: "https://meridianfit.in" });
    const cell = getCell(brief.offer.primaryObjective, brief.offer.conversionLocation);
    assert.ok(
      cell.ctas.allowed.includes(brief.offer.cta.button),
      `${brief.offer.cta.button} not allowed for this cell`,
    );
  });

  test("with no page CTA, the cell's own default is used", () => {
    // The live path today — Python has callToAction commented out.
    const brief = mapAutofillToBrief(fixture("complete"), { url: URL_TULSI });
    const cell = getCell(brief.offer.primaryObjective, brief.offer.conversionLocation);
    assert.equal(brief.offer.cta.button, cell.ctas.default);
    assert.equal(brief.provenance["offer.cta.button"].confidence, CONFIDENCE.DEFAULTED);
  });

  test("a CTA the cell forbids falls back rather than being emitted", () => {
    const { resolveCta } = _internals;
    // "Install the app" → INSTALL_MOBILE_APP, which TRAFFIC/WEBSITE forbids.
    const r = resolveCta(["Install the app"], "OUTCOME_TRAFFIC", "WEBSITE");
    const cell = getCell("OUTCOME_TRAFFIC", "WEBSITE");
    assert.ok(cell.ctas.allowed.includes(r.button));
  });

  test("an unknown cell degrades to a null button instead of throwing", () => {
    const { resolveCta } = _internals;
    const r = resolveCta(["Shop now"], "OUTCOME_NONSENSE", "NOWHERE");
    assert.equal(r.button, null);
  });

  test("the CTA destination is the URL the user entered", () => {
    const brief = mapAutofillToBrief(fixture("complete"), { url: URL_TULSI });
    assert.equal(brief.offer.cta.url, URL_TULSI);
    assert.equal(brief.provenance["offer.cta.url"].source, "user");
  });
});

// ─── Degradation ─────────────────────────────────────────────────────────────

group("degrades field-by-field, never throws", () => {
  const brief = mapAutofillToBrief(fixture("partial"), { url: "https://kadaifoods.in" });

  test("keeps what is present", () => {
    assert.equal(brief.brand.name, "Kadai Foods");
    assert.deepEqual(brief.brand.voice, ["direct"]);
  });

  test('drops "N/A" sentinels rather than storing them as text', () => {
    assert.ok(!("category" in brief.brand), "N/A category must be absent");
    assert.ok(!("tone" in brief.brand), "N/A tone must be absent");
    assert.ok(!("notes" in brief.offer), "N/A guidelines must be absent");
  });

  test("omits empty collections instead of storing []", () => {
    assert.ok(!("dos" in brief.brand));
    assert.ok(!("donts" in brief.brand));
    assert.ok(!("audience" in brief.offer));
    assert.ok(!("seedImages" in brief.generation));
  });

  test("filters malformed hex out of the palette", () => {
    assert.deepEqual(brief.brand.palette, ["#8C2F1E", "#E8D9B5"]);
  });

  test("still produces a usable objective and CTA", () => {
    assert.equal(brief.offer.primaryObjective, "OUTCOME_TRAFFIC");
    assert.ok(brief.offer.cta.button);
  });

  for (const [label, input] of [
    ["undefined", undefined],
    ["empty object", {}],
    ["null members", { brandInfo: null, objectives: null }],
    ["wrong types", { brandInfo: "nope", objectives: 42 }],
    ["array members", { brandInfo: [], objectives: [] }],
  ]) {
    test(`survives ${label}`, () => {
      const b = mapAutofillToBrief(input, { url: "https://example.test" });
      assert.equal(b.status, "needs_input");
      assert.ok(b.offer.primaryObjective, "must still resolve an objective");
    });
  }

  test("needs_input when neither name nor description survived", () => {
    const b = mapAutofillToBrief(
      { brandInfo: { brandName: "N/A", brandDescription: "  " }, objectives: {} },
      { url: "https://example.test" },
    );
    assert.equal(b.status, "needs_input");
  });

  test("draft when only a description survived", () => {
    const b = mapAutofillToBrief(
      { brandInfo: { brandDescription: "A real description" }, objectives: {} },
      { url: "https://example.test" },
    );
    assert.equal(b.status, "draft");
  });
});

// ─── List hygiene ────────────────────────────────────────────────────────────

group("list hygiene", () => {
  const { list } = _internals;

  test("de-duplicates case-insensitively, preserving first-seen order", () => {
    assert.deepEqual(list(["Warm", "warm", "Grounded"]), ["Warm", "Grounded"]);
  });

  test("drops blanks and N/A entries", () => {
    assert.deepEqual(list(["a", "", "  ", "N/A", "n/a", "b"]), ["a", "b"]);
  });

  test("non-arrays become empty arrays", () => {
    assert.deepEqual(list(null), []);
    assert.deepEqual(list("warm"), []);
  });
});

// ─── Provenance ──────────────────────────────────────────────────────────────

group("provenance", () => {
  const brief = mapAutofillToBrief(fixture("complete"), { url: URL_TULSI });

  test("every inferred field carries source, confidence and evidence", () => {
    const entries = Object.entries(brief.provenance);
    assert.ok(entries.length >= 8, `expected several entries, got ${entries.length}`);
    for (const [path, meta] of entries) {
      assert.equal(typeof meta.source, "string", `${path} source`);
      assert.equal(typeof meta.confidence, "number", `${path} confidence`);
      assert.ok(meta.confidence >= 0 && meta.confidence <= 1, `${path} confidence range`);
      assert.equal(typeof meta.evidence, "string", `${path} evidence`);
    }
  });

  test("no provenance is written for a field that was dropped", () => {
    const partial = mapAutofillToBrief(fixture("partial"), { url: "https://kadaifoods.in" });
    assert.ok(!("brand.dos" in partial.provenance));
    assert.ok(!("brand.tone" in partial.provenance));
  });

  test("scraped values outrank LLM-stated ones", () => {
    assert.ok(
      brief.provenance["brand.palette"].confidence >
        brief.provenance["brand.voice"].confidence,
    );
  });

  test("our own heuristic is not passed off as the page's word", () => {
    // The objective is OUR guess; the stated goal is Python's reading.
    assert.ok(
      brief.provenance["offer.primaryObjective"].confidence <
        brief.provenance["offer.statedGoal"].confidence,
    );
  });

  test("lowConfidenceFields surfaces exactly what the UI should flag", () => {
    const flagged = lowConfidenceFields(brief);
    assert.ok(flagged.includes("offer.primaryObjective"));
    assert.ok(flagged.includes("offer.cta.button"));
    assert.ok(!flagged.includes("brand.name"));
    assert.ok(!flagged.includes("brand.palette"));
  });

  test("lowConfidenceFields on an empty brief is an empty list, not a throw", () => {
    assert.deepEqual(lowConfidenceFields({}), []);
    assert.deepEqual(lowConfidenceFields(null), []);
  });
});

// ─── Purity ──────────────────────────────────────────────────────────────────

group("purity", () => {
  test("does not mutate its input", () => {
    const input = fixture("complete");
    const snapshot = JSON.parse(JSON.stringify(input));
    mapAutofillToBrief(input, { url: URL_TULSI });
    assert.deepEqual(input, snapshot);
  });

  test("repeated calls are deep-equal", () => {
    const a = mapAutofillToBrief(fixture("complete"), { url: URL_TULSI });
    const b = mapAutofillToBrief(fixture("complete"), { url: URL_TULSI });
    assert.deepEqual(a, b);
  });

  test("imports nothing with a DB, SDK or network dependency", () => {
    // wizardSchema is pure data; anything else would make this untestable.
    const src = require("node:fs").readFileSync(
      require.resolve("../../services/adFactory/briefMapper"),
      "utf8",
    );
    const requires = [...src.matchAll(/require\((['"])(.*?)\1\)/g)].map((m) => m[2]);
    assert.deepEqual(requires, ["../../config/wizardSchema"]);
  });
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log("\nFailures:");
  for (const f of FAILURES) console.log(`  ✗ ${f.name}\n    ${f.err.stack}`);
  process.exit(1);
}
