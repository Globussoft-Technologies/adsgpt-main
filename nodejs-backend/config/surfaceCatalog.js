/**
 * Per-surface model catalog for the AdStudio "Ad Video" surfaces.
 *
 * Maps a `media` slug (the same value the frontend already persists as
 * `inputs.type` — see selectVideoType in AdVideoLayout.jsx) to the set of
 * models offered on that surface, and for each model the allowed durations
 * (seconds) and aspect ratios.
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

const SURFACE_CATALOG = {
  ai_ads: {
    "veo-3.1-fast": { durations: [8, 10, 20, 30, 40], aspectRatios: ["9:16", "16:9"] },
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
    "veo-3.1-fast": { durations: [8], aspectRatios: ["9:16", "16:9"] },
  },
};

/** Valid media slugs, e.g. for validation / error messages. */
const SURFACE_SLUGS = Object.keys(SURFACE_CATALOG);

module.exports = { SURFACE_CATALOG, SURFACE_SLUGS };
