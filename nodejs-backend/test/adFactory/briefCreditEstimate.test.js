#!/usr/bin/env node
/**
 * Tests for services/adFactory/briefCreditEstimate.js.
 *
 * The property that matters: the estimate must be computed the same way the
 * CHARGE is. `controllers/adFactory.validateCredits` prices a campaign's
 * servicesSelected, so this prices the brief's projection of exactly that
 * shape. An estimate derived independently would drift, and a quote that
 * disagrees with the invoice is worse than showing nothing.
 *
 * Prices are injected, so these assertions are about the arithmetic and the
 * refusals — not about whatever the live registry charges this week.
 *
 * Run:  node test/adFactory/briefCreditEstimate.test.js
 */

const assert = require("node:assert/strict");

const { estimateBriefCredits, TEXT_MODEL_KEY } = require("../../services/adFactory/briefCreditEstimate");

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

const PRICES = { [TEXT_MODEL_KEY]: 2, google: 20, openai: 35, auto: 10 };
const getDeduction = (model) => PRICES[model] ?? 0;

const brief = (generation = {}) => ({
  _id: "65b1f2c3d4e5f60718293a4b",
  userId: "user-1",
  brand: { name: "Tulsi & Co" },
  offer: { primaryObjective: "OUTCOME_SALES", conversionLocation: "WEBSITE" },
  delivery: { platforms: ["meta"], budget: { daily: 800 } },
  generation: { imageModel: "google", imageCount: 3, textCount: 3, ...generation },
});

// ─── ─────────────────────────────────────────────────────────────────────────

group("the arithmetic matches validateCredits", () => {
  test("text qty x text price + image qty x image price", () => {
    const e = estimateBriefCredits(brief(), getDeduction);
    // 3 text x 2 = 6, 3 images x 20 = 60
    assert.equal(e.text, 6);
    assert.equal(e.image, 60);
    assert.equal(e.total, 66);
  });

  test("the image MODEL changes the price, not just the count", () => {
    const cheap = estimateBriefCredits(brief({ imageModel: 'google' }), getDeduction);
    const dear = estimateBriefCredits(brief({ imageModel: 'openai' }), getDeduction);
    assert.ok(dear.total > cheap.total);
    assert.equal(dear.image, 3 * 35);
  });

  test("counts are reported so the UI can say what it's pricing", () => {
    const e = estimateBriefCredits(brief({ imageCount: 5, textCount: 2 }), getDeduction);
    assert.deepEqual(e.counts, { text: 2, image: 5 });
    assert.equal(e.total, 2 * 2 + 5 * 20);
  });

  test("asking for no copy prices only the images", () => {
    const e = estimateBriefCredits(brief({ textCount: 0 }), getDeduction);
    assert.equal(e.text, 0);
    assert.equal(e.total, 60);
  });

  test("an unpriced model contributes 0 rather than NaN", () => {
    // NaN would render as "NaN credits" — a number that is wrong is worse than
    // one that is conservative.
    const e = estimateBriefCredits(brief({ imageModel: 'something-new' }), getDeduction);
    assert.equal(e.image, 0);
    assert.equal(e.total, 6);
  });
});

group("refusals are null, never a misleading zero", () => {
  test("a brief that cannot be projected is unpriceable", () => {
    // No userId -> briefToCampaignDoc throws -> null, not 0. "0 credits" reads
    // as free; null lets the UI show nothing at all.
    assert.equal(estimateBriefCredits({ ...brief(), userId: '' }, getDeduction), null);
  });

  test("a brief asking for nothing at all is unpriceable", () => {
    const b = brief({ imageCount: 0, textCount: 0 });
    assert.equal(estimateBriefCredits(b, getDeduction), null);
  });

  test("no price function is null, not a crash", () => {
    assert.equal(estimateBriefCredits(brief(), undefined), null);
    assert.equal(estimateBriefCredits(brief(), null), null);
  });
});

group("purity", () => {
  test("the brief is not mutated", () => {
    const b = brief();
    const before = JSON.stringify(b);
    estimateBriefCredits(b, getDeduction);
    assert.equal(JSON.stringify(b), before);
  });

  test("repeated calls agree", () => {
    const b = brief();
    assert.deepEqual(estimateBriefCredits(b, getDeduction), estimateBriefCredits(b, getDeduction));
  });
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log("\nFailures:");
  for (const f of FAILURES) console.log(`\n  ${f.name}\n  ${f.err.stack}`);
  process.exit(1);
}
