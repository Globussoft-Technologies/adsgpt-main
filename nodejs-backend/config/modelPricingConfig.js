/**
 * IMAGE: cost per image (USD) — flat per_image rate or token-based.
 * VIDEO: cost per second of video (USD/sec).
 *
 * The actual price tables and aliases live in ./modelRegistry.js — this file
 * is just the public read API. Adding a model = ONE entry there.
 *
 * `imagePricing` and `videoPricing` are exposed as derived maps for callers
 * that look up by string key (e.g. existing aggregation code).
 */

const { MODEL_REGISTRY, findModel, imageEntries, videoEntries } = require("./modelRegistry");

function buildImagePricingMap() {
  const map = {};
  for (const entry of imageEntries()) {
    for (const key of [entry.canonicalKey, ...(entry.aliases || [])]) {
      map[key] = entry.pricing;
    }
  }
  return map;
}

function buildVideoPricingMap() {
  const map = {};
  for (const entry of videoEntries()) {
    const perSec = entry.pricing?.per_second ?? 0;
    for (const key of [entry.canonicalKey, ...(entry.aliases || [])]) {
      map[key] = perSec;
    }
  }
  return map;
}

const modelPricingConfig = {
  // Derived once at module-load. Registry is module-scope constant data, so
  // these maps are safe to cache.
  imagePricing: buildImagePricingMap(),
  videoPricing: buildVideoPricingMap(),

  /**
   * Get actual cost (USD) for an image generation.
   * Flat per_image rate short-circuits the token math.
   */
  getImageCost(model, inputTokens = 0, outputTokens = 0) {
    const entry = findModel(model);
    const pricing = entry?.pricing;
    if (!pricing) return 0;

    if (pricing.per_image != null) return pricing.per_image;

    const inputCost = (inputTokens / 1_000_000) * (pricing.input_per_million || 0);
    const outputCost = (outputTokens / 1_000_000) * (pricing.output_per_million || 0);
    return parseFloat((inputCost + outputCost).toFixed(6));
  },

  /**
   * Get actual cost (USD) for a video generation.
   */
  getVideoCost(model, durationSeconds = 0) {
    const entry = findModel(model);
    const pricePerSec = entry?.pricing?.per_second ?? 0;
    return parseFloat((pricePerSec * durationSeconds).toFixed(4));
  },
};

module.exports = modelPricingConfig;

// Re-export the registry from a stable path so callers can `require("../config/modelPricingConfig").registry`
// if they need to introspect the full table without a second require.
modelPricingConfig.registry = MODEL_REGISTRY;
