// templateAdBilling — what a Recreate costs.
//
// The reason this file exists is one specific bug it is here to keep dead:
// `renderBilling.priceFor` is a per-SECOND video formula, and the image route's
// `meta` carries no `duration_s` and no `count`. Run an image through it and
// every field it reads is absent, every fallback is wrong, and a 3-credit image
// prices as 3 x 8 x 1 = 24. Silently. These tests pin the image path to
// `rate x variations` so that can never quietly come back.
//
// Run: node test/onboarding/templateAdBilling.test.js

const assert = require("node:assert");

// Stub the credit controller BEFORE renderBilling requires it, so this runs
// with no Mongo and no model-configuration cache.
const creditPath = require.resolve("../../controllers/UnifiedCreditController");
require(creditPath);
const UnifiedCreditController = require.cache[creditPath].exports;

const TIERS = { low: 1, medium: 2, high: 3, ultra_high: 4 };
UnifiedCreditController.getModelDeductionByQuality = (model, quality) =>
  model === "gemini-3.1-flash-image" ? TIERS[quality] || 0 : 0;
UnifiedCreditController.getModelDeduction = (model) => (model === "veo-3.1-fast" ? 4 : 0);

const {
  priceForTemplateAd,
  templateAdCeiling,
  TEMPLATE_AD_IMAGE_MODEL,
  _internals,
} = require("../../services/onboarding/renderBilling");

let passed = 0;
const test = (name, fn) => {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    console.error(`  ✗ ${name}\n    ${error.message}`);
    process.exitCode = 1;
  }
};

console.log("templateAdBilling");

test("the image model and quality are the ones we charge at", () => {
  assert.strictEqual(TEMPLATE_AD_IMAGE_MODEL, "gemini-3.1-flash-image");
  assert.strictEqual(_internals.TEMPLATE_AD_IMAGE_QUALITY, "low");
});

test("one image at the low tier costs 1", () => {
  const meta = { template_id: "abc", model: "gemini-3.1-flash-image", variations: 1 };
  assert.strictEqual(priceForTemplateAd("image", meta), 1);
});

test("images are priced PER IMAGE, so variations is the only multiplier", () => {
  const meta = { model: "gemini-3.1-flash-image", variations: 3 };
  assert.strictEqual(priceForTemplateAd("image", meta), 3);
});

test("an image meta with no duration_s is NOT multiplied by a duration", () => {
  // The regression this file exists for. `meta` here is exactly what the image
  // route documents: no duration_s, no count.
  const meta = { template_id: "abc", model: "gemini-3.1-flash-image", variations: 1 };
  assert.strictEqual(priceForTemplateAd("image", meta), 1);
  // 1 x 8 is what the video formula would have made of it.
  assert.notStrictEqual(priceForTemplateAd("image", meta), 8);
});

test("an empty meta.model still prices — the route may omit it", () => {
  // The image route documents meta.model as "the request's override, OR EMPTY
  // for the configured default". Empty must not mean free.
  assert.strictEqual(priceForTemplateAd("image", { model: "", variations: 1 }), 1);
});

test("an unknown image model prices at 0, never at a guess", () => {
  assert.strictEqual(priceForTemplateAd("image", { model: "not-a-model", variations: 1 }), 0);
});

test("video keeps the per-second formula, with variations for count", () => {
  const meta = { model: "veo-3.1-fast", duration_s: 8, variations: 1 };
  assert.strictEqual(priceForTemplateAd("video", meta), 32);
});

test("a video with no duration falls back to the 8s ceiling duration", () => {
  assert.strictEqual(priceForTemplateAd("video", { model: "veo-3.1-fast", variations: 1 }), 32);
});

test("ceilings: image holds 1, video holds 32", () => {
  assert.strictEqual(templateAdCeiling("image"), 1);
  assert.strictEqual(templateAdCeiling("video"), 32);
});

test("the image ceiling covers one take at the tier we ask for", () => {
  // Erring high can only ever refund; erring low is eaten on every render.
  const ceiling = templateAdCeiling("image");
  const actual = priceForTemplateAd("image", {
    model: "gemini-3.1-flash-image",
    variations: 1,
  });
  assert.ok(ceiling >= actual, `ceiling ${ceiling} must cover actual ${actual}`);
});

console.log(`\n${passed} passed`);
