/**
 * Per-surface model catalog for the AdStudio "Ad Video" and "Ad Creative"
 * surfaces.
 *
 * Maps a `media` slug (for video, the same value the frontend persists as
 * `inputs.type` — see selectVideoType in AdVideoLayout.jsx; for images, the
 * shared `ad_creative` slug) to the set of models offered on that surface, and
 * for each model the allowed durations (video only) and aspect ratios.
 *
 * Keys are canonicalKeys from modelRegistry.js — credits/labels/enabled are
 * read from there, NOT duplicated here. This file only owns the surface-level
 * rules (which model + which durations + which aspect ratios).
 *
 *   media slug → canonicalKey → { durations: number[], aspectRatios: string[] }
 *
 * Consumed by GET /usage/model-credit-value?media=<slug> (usage.controller.js).
 */

// ugc and broll expose the identical model set — share one definition.
const UGC_BROLL = {
  "veo-3.1-fast": { durations: [8], aspectRatios: ["9:16", "16:9"] },
  veo: { durations: [8], aspectRatios: ["9:16", "16:9"] },
  veo_4k: { durations: [8], aspectRatios: ["9:16", "16:9"] },
  seedance_v2: { durations: [8, 12], aspectRatios: ["9:16", "16:9"] },
  seedance_fast: { durations: [8, 12], aspectRatios: ["9:16", "16:9"] },
  "kling_3.0": { durations: [8, 12], aspectRatios: ["9:16", "16:9", "1:1"] },
};

// Ad Creative (image). All AdCreative flows share one image model set, so a
// single slug serves them. `durations` is video-only and omitted here.
// Aspect ratios are per-model: Nano Banana 2 supports the widest set (adds the
// extreme 1:4 / 4:1 / 1:8 / 8:1 panoramas); the other four share one common
// list. Credits + per-quality tiers come from modelRegistry (qualityTiers),
// NOT duplicated here.
const ADCREATIVE_COMMON_RATIOS = ["1:1", "4:5", "9:16", "2:3", "3:4", "16:9", "21:9", "3:2", "4:3", "5:4"];

const ADCREATIVE_IMAGE = {
  "gemini-3.1-flash-image-preview": {
    aspectRatios: ["1:1", "4:5", "9:16", "2:3", "3:4", "16:9", "21:9", "3:2", "4:3", "5:4", "1:4", "4:1", "1:8", "8:1"],
  },
  "gemini-3-pro-image-preview": { aspectRatios: ADCREATIVE_COMMON_RATIOS },
  "gpt-image-1.5": { aspectRatios: ADCREATIVE_COMMON_RATIOS },
  "gpt-image-2": { aspectRatios: ADCREATIVE_COMMON_RATIOS },
  "seedream-5.0-lite": { aspectRatios: ADCREATIVE_COMMON_RATIOS },
};

const SURFACE_CATALOG = {
  ad_creative: ADCREATIVE_IMAGE,
  // Ad Factory has its own DB-controlled image model selection. The runtime
  // model catalog is stored on each model document; this empty map only
  // registers the surface slug for validation and API discovery.
  ad_factory: {},
  ai_ads: {
    "veo-3.1-fast": { durations: [8, 10, 20, 30, 40], aspectRatios: ["9:16", "16:9"] },
    veo: { durations: [8, 10, 20, 30, 40], aspectRatios: ["9:16", "16:9"] },
  },
  ugc: UGC_BROLL,
  broll: UGC_BROLL,
  avatar: {
    "veo-3.1-fast": { durations: [8, 15], aspectRatios: ["9:16", "16:9"] },
    veo: { durations: [8, 15], aspectRatios: ["9:16", "16:9"] },
    veo_4k: { durations: [8], aspectRatios: ["9:16", "16:9"] },
    "kling_3.0": { durations: [8, 12], aspectRatios: ["9:16", "16:9", "1:1"] },
  },
  clone: {
    "veo-3.1-fast": { durations: [8, 15], aspectRatios: ["9:16", "16:9"] },
    veo: { durations: [8, 15], aspectRatios: ["9:16", "16:9"] },
    veo_4k: { durations: [8, 15], aspectRatios: ["9:16", "16:9"] },
    "kling_3.0": { durations: [8, 15], aspectRatios: ["9:16", "16:9", "1:1"] },
  },
  // Clone Your Ad - distinct from `clone` above, which is Clone Yourself. Served
  // by python-backend/advideo/models/{omni_model,seedance_v2_5}/src/routers/
  // clone_your_ad at /api/v1/clone-your-ad/*.
  //
  // Two things make this surface unlike every other one here:
  //   1. These two models are exclusive to it - they appear on no other surface.
  //   2. Length is a RANGE of whole seconds, not a fixed set, so these entries
  //      carry durationRange instead of durations[]. Never express a range as
  //      durations: [4, 30] - every picker built from that array would offer
  //      exactly two choices.
  clone_video: {
    "seedance-2.5": { durationRange: { min: 4, max: 30 }, aspectRatios: ["16:9", "9:16"] },
    "google-omni": { durationRange: { min: 4, max: 10 }, aspectRatios: ["16:9", "9:16"] },
  },
};

/** Valid media slugs, e.g. for validation / error messages. */
const SURFACE_SLUGS = Object.keys(SURFACE_CATALOG);

module.exports = { SURFACE_CATALOG, SURFACE_SLUGS };
