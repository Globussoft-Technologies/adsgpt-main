/**
 * Single source of truth for every generation model.
 *
 * Adding a new model = ONE entry in MODEL_REGISTRY + ONE env var.
 * No more parallel arrays in modelPricingConfig / UnifiedCreditController /
 * generatedMedia.controller / usage.controller / creditTrackingService /
 * utils/modelEnums.
 *
 * ENTRY SHAPE
 *   canonicalKey   Primary key. Same string the frontend sends as `model`
 *                  and what we store on GeneratedMedia.model.
 *   type           "image" | "video"
 *   label          Human-facing name. Powers /usage credit endpoint and the
 *                  upcoming /models endpoint.
 *   aliases        Other strings that resolve to this same model — provider
 *                  names ("openai", "google"), display labels Python may
 *                  echo back ("Sora 2", "Nano Banana Pro"), legacy keys.
 *   creditEnvVar   Env var read for credits-per-unit (per image / per video).
 *   creditDefault  Fallback when the env var is unset.
 *   extraDeduction Optional per-feature surcharges on top of creditEnvVar,
 *                  e.g. [{ type: "clone", envVar: "...", deduction: 5 }].
 *                  `envVar` is read first; `deduction` is the fallback.
 *
 *   pricing        IMAGE: { input_per_million, output_per_million, per_image? }
 *                          (per_image, when present, short-circuits token math)
 *                  VIDEO: { per_second }
 *
 *   qualityTiers   IMAGE ONLY, optional. Per-quality credit + price overrides.
 *                  Array of { quality, creditEnvVar, creditDefault, pricing }
 *                  — one entry per quality the model offers ("low" | "medium" |
 *                  "high", plus "ultra_high" where supported). When the
 *                  frontend sends a model+quality combo, the matching tier's
 *                  credits resolve from creditEnvVar (env, fallback
 *                  creditDefault) and cost from pricing.per_image. The
 *                  top-level creditEnvVar/creditDefault/pricing are retained as
 *                  the pre-quality fallback for callers that pass no quality.
 *
 *   aggregationCreditDefault
 *                  VIDEO ONLY. Per-second fallback used by aggregation
 *                  pipelines for OLD records where credit_deduction is 0.
 *                  Differs from creditDefault (per-video) because the legacy
 *                  pipelines multiply by an assumed 5s duration. Preserved
 *                  for behavioural compatibility — clean up later.
 *
 *   capabilities   Frontend hints — used once /models endpoint lands. Defined
 *                  here now so we don't have to revisit the registry later.
 *                  - aspectRatios:        "model1" | "model23" (frontend keys)
 *                  - autoAspectDefault:   default to AUTO ratio on selection
 *                  - generationTimeSec:   loader hint
 *                  - qualityToggle:       LOW_QUALITY_EMAILS path applies
 *
 *   icon           Frontend icon hint ("openai" | "google" | …).
 *   enabled        false = keep entry for historical lookup but hide from
 *                  user-facing pickers (frontend dropdowns, /usage endpoint).
 */

const modelConfigurationService = require("../services/modelConfigurationService");

const MODEL_REGISTRY = [
  // ───────────────────── IMAGE ─────────────────────
  {
    canonicalKey: "ADSGPT-3.0",
    type: "image",
    label: "OpenAI 1.5",
    aliases: ["openai", "OpenAI", "gpt-image-1.5"],
    creditEnvVar: "ADSGPT_3_0_CREDIT_DEDUCTION",
    creditDefault: 7,
    pricing: { input_per_million: 8, output_per_million: 32, per_image: 0.27 },
    capabilities: { aspectRatios: "model1", autoAspectDefault: true, generationTimeSec: 100, qualityToggle: true },
    icon: "openai",
    enabled: false,
  },
  // {
  //   canonicalKey: "ADSGPT-3.1",
  //   type: "image",
  //   label: "OpenAI 2.0",
  //   aliases: ["openai2", "gpt-image-2.0"],
  //   creditEnvVar: "ADSGPT_3_1_CREDIT_DEDUCTION",
  //   creditDefault: 7,
  //   pricing: { input_per_million: 8, output_per_million: 32, per_image: 0.27 },
  //   capabilities: { aspectRatios: "model1", autoAspectDefault: true, generationTimeSec: 100, qualityToggle: true },
  //   icon: "openai",
  //   enabled: true,
  // },
  {
    canonicalKey: "ADSGPT-2.0",
    type: "image",
    label: "Nano Banana Pro",
    aliases: ["google", "Nano Banana Pro", "gemini-3-pro-image-preview"],
    creditEnvVar: "ADSGPT_2_0_CREDIT_DEDUCTION",
    creditDefault: 7,
    pricing: { input_per_million: 2, output_per_million: 120, per_image: 0.27 },
    capabilities: { aspectRatios: "model23", autoAspectDefault: false, generationTimeSec: 30, qualityToggle: false },
    icon: "google",
    enabled: false,
  },
  {
    canonicalKey: "ADSGPT-1.0",
    type: "image",
    label: "Imagen",
    aliases: ["Imagen", "imagen-4.0-generate-001"],
    creditEnvVar: "ADSGPT_1_0_CREDIT_DEDUCTION",
    creditDefault: 1,
    pricing: { per_image: 0.04 },
    capabilities: { aspectRatios: "model23", autoAspectDefault: false, generationTimeSec: 30, qualityToggle: false },
    icon: "google",
    enabled: false,
  },

  // ───────────────────── VIDEO ─────────────────────
  // {
  //   canonicalKey: "sora",
  //   type: "video",
  //   label: "Sora 2",
  //   aliases: ["Sora 2"],
  //   creditEnvVar: "ADSGPT_SORA_VIDEO_CREDIT_DEDUCTION",
  //   creditDefault: 13,
  //   aggregationCreditDefault: 2,
  //   pricing: { per_second: 0.10 },
  //   enabled: true,
  // },
  // {
  //   canonicalKey: "soraPro",
  //   type: "video",
  //   label: "Sora 2 Pro",
  //   aliases: ["Sora 2 Pro"],
  //   creditEnvVar: "ADSGPT_SORA_PRO_VIDEO_CREDIT_DEDUCTION",
  //   creditDefault: 13,
  //   aggregationCreditDefault: 7,
  //   pricing: { per_second: 0.30 },
  //   enabled: true,
  // },
  // {
  //   canonicalKey: "soraPro_4k",
  //   type: "video",
  //   label: "Sora 2 Pro 4K",
  //   aliases: ["Sora 2 Pro 4K"],
  //   creditEnvVar: "ADSGPT_SORA_PRO_4K_VIDEO_CREDIT_DEDUCTION",
  //   creditDefault: 13,
  //   aggregationCreditDefault: 10,
  //   pricing: { per_second: 0.50 },
  //   enabled: true,
  // },
  {
    canonicalKey: "veo",
    type: "video",
    label: "Veo 3",
    aliases: ["Veo 3", "veo3"],
    creditEnvVar: "ADSGPT_VEO_VIDEO_CREDIT_DEDUCTION",
    creditDefault: 13,
    aggregationCreditDefault: 5,
    pricing: { per_second: 0.20 },
    enabled: true,
  },
  {
    canonicalKey: "veo-3.1-fast",
    type: "video",
    label: "Veo 3.1 fast",
    aliases: ["Veo 3.1 fast"],
    creditEnvVar: "ADSGPT_VEO_3_1_FAST_VIDEO_CREDIT_DEDUCTION",
    creditDefault: 13,
    aggregationCreditDefault: 4,
    pricing: { per_second: 0.15 },
    enabled: true,
    // Clone flow (face-detection + veo) costs more at the provider level than
    // plain veo-3.1-fast — reflect that in BOTH credits and USD reporting:
    //   deduction:      extra credits/sec charged to the user (5)
    //   costPerSecond:  extra USD/sec captured in GeneratedMedia.cost (0.21,
    //                   so total = base 0.15 + surcharge 0.21 = 0.36)
    extraDeduction: [{type: "clone", envVar: "ADSGPT_VEO_3_1_FAST_CLONE_CREDIT_SURCHARGE", deduction: 5, costPerSecond: 0.21}]
  },
  {
    canonicalKey: "veo_4k",
    type: "video",
    label: "Veo 4K",
    aliases: ["Veo 4K"],
    creditEnvVar: "ADSGPT_VEO_4K_VIDEO_CREDIT_DEDUCTION",
    creditDefault: 13,
    aggregationCreditDefault: 10,
    pricing: { per_second: 0.40 },
    enabled: true,
  },
  {
    canonicalKey: "seedance_v1",
    type: "video",
    label: "Seedance 1.5 Pro",
    aliases: ["Seedance 1.5 Pro"],
    creditEnvVar: "ADSGPT_SEEDANCE_V1_VIDEO_CREDIT_DEDUCTION",
    creditDefault: 2,
    aggregationCreditDefault: 2,
    pricing: { per_second: 0.05 },
    // Hidden from public pickers (matches existing commented-out entry in
    // usage.controller.js#getModelCreditDeduction). Lookups still work for
    // any historical records that reference it.
    enabled: false,
  },
  {
    canonicalKey: "seedance_v2",
    type: "video",
    label: "Seedance 2.0",
    aliases: ["Seedance 2.0"],
    creditEnvVar: "ADSGPT_SEEDANCE_V2_VIDEO_CREDIT_DEDUCTION",
    creditDefault: 4,
    aggregationCreditDefault: 4,
    pricing: { per_second: 0.15 },
    enabled: true,
  },
  {
    canonicalKey: "seedance_fast",
    type: "video",
    label: "Seedance 2.0 Fast",
    aliases: ["Seedance 2.0 Fast"],
    creditEnvVar: "ADSGPT_SEEDANCE_FAST_VIDEO_CREDIT_DEDUCTION",
    creditDefault: 3,
    aggregationCreditDefault: 3,
    pricing: { per_second: 0.12 },
    enabled: true,
  },
  {
    canonicalKey: "kling_3.0",
    type: "video",
    label: "Kling 3.0",
    aliases: ["Kling 3.0", "kling_3.0"],
    creditEnvVar: "ADSGPT_KLING_3_0_VIDEO_CREDIT_DEDUCTION",
    creditDefault: 5,
    aggregationCreditDefault: 5,
    pricing: { per_second: 0.17 },
    enabled: true,
  },
  {
    canonicalKey: "gemini-3.1-flash-image-preview",
    type: "image",
    label: "Nano Banana 2",
    aliases: ["Nano Banana 2", "gemini-3.1-flash-image-preview"],
    creditEnvVar: "gemini-3.1-flash-image-preview_IMAGE_CREDIT_DEDUCTION",
    creditDefault: 7,
    pricing: { input_per_million: 8, output_per_million: 32, per_image: 0.27 },
    qualityTiers: [
      { quality: "low",        creditEnvVar: "gemini-3.1-flash-image-preview_IMAGE_CREDIT_DEDUCTION_LOW",        creditDefault: 1, pricing: { per_image: 0.040 } },
      { quality: "medium",     creditEnvVar: "gemini-3.1-flash-image-preview_IMAGE_CREDIT_DEDUCTION_MEDIUM",     creditDefault: 2, pricing: { per_image: 0.067 } },
      { quality: "high",       creditEnvVar: "gemini-3.1-flash-image-preview_IMAGE_CREDIT_DEDUCTION_HIGH",       creditDefault: 3, pricing: { per_image: 0.101 } },
      { quality: "ultra_high", creditEnvVar: "gemini-3.1-flash-image-preview_IMAGE_CREDIT_DEDUCTION_ULTRA_HIGH", creditDefault: 4, pricing: { per_image: 0.151 } },
    ],
    capabilities: { aspectRatios: "model1", autoAspectDefault: true, generationTimeSec: 100, qualityToggle: true },
    icon: "google",
    enabled: true,
  },
  {
    canonicalKey: "gemini-3-pro-image-preview",
    type: "image",
    label: "Nano Banana Pro",
    aliases: ["Nano Banana Pro", "gemini-3-pro-image-preview"],
    creditEnvVar: "gemini-3-pro-image-preview_IMAGE_CREDIT_DEDUCTION",
    creditDefault: 7,
    pricing: { input_per_million: 8, output_per_million: 32, per_image: 0.27 },
    qualityTiers: [
      { quality: "low",    creditEnvVar: "gemini-3-pro-image-preview_IMAGE_CREDIT_DEDUCTION_LOW",    creditDefault: 4, pricing: { per_image: 0.134 } },
      { quality: "medium", creditEnvVar: "gemini-3-pro-image-preview_IMAGE_CREDIT_DEDUCTION_MEDIUM", creditDefault: 4, pricing: { per_image: 0.134 } },
      { quality: "high",   creditEnvVar: "gemini-3-pro-image-preview_IMAGE_CREDIT_DEDUCTION_HIGH",   creditDefault: 6, pricing: { per_image: 0.240 } },
    ],
    capabilities: { aspectRatios: "model1", autoAspectDefault: true, generationTimeSec: 100, qualityToggle: true },
    icon: "google",
    enabled: true,
  },
  {
    canonicalKey: "gpt-image-1.5",
    type: "image",
    label: "OpenAI 1.5",
    aliases: ["OpenAI 1.5", "gpt-image-1.5"],
    creditEnvVar: "gpt-image-1.5_IMAGE_CREDIT_DEDUCTION",
    creditDefault: 7,
    pricing: { input_per_million: 8, output_per_million: 32, per_image: 0.27 },
    qualityTiers: [
      { quality: "low",    creditEnvVar: "gpt-image-1.5_IMAGE_CREDIT_DEDUCTION_LOW",    creditDefault: 1, pricing: { per_image: 0.009 } },
      { quality: "medium", creditEnvVar: "gpt-image-1.5_IMAGE_CREDIT_DEDUCTION_MEDIUM", creditDefault: 1, pricing: { per_image: 0.034 } },
      { quality: "high",   creditEnvVar: "gpt-image-1.5_IMAGE_CREDIT_DEDUCTION_HIGH",   creditDefault: 4, pricing: { per_image: 0.133 } },
    ],
    capabilities: { aspectRatios: "model1", autoAspectDefault: true, generationTimeSec: 100, qualityToggle: true },
    icon: "google",
    enabled: true,
  },
  {
    canonicalKey: "gpt-image-2",
    type: "image",
    label: "OpenAI 2.0",
    aliases: ["OpenAI 2.0", "gpt-image-2"],
    creditEnvVar: "gpt-image-2_IMAGE_CREDIT_DEDUCTION",
    creditDefault: 7,
    pricing: { input_per_million: 8, output_per_million: 32, per_image: 0.27 },
    qualityTiers: [
      { quality: "low",    creditEnvVar: "gpt-image-2_IMAGE_CREDIT_DEDUCTION_LOW",    creditDefault: 1, pricing: { per_image: 0.006 } },
      { quality: "medium", creditEnvVar: "gpt-image-2_IMAGE_CREDIT_DEDUCTION_MEDIUM", creditDefault: 2, pricing: { per_image: 0.053 } },
      { quality: "high",   creditEnvVar: "gpt-image-2_IMAGE_CREDIT_DEDUCTION_HIGH",   creditDefault: 6, pricing: { per_image: 0.211 } },
    ],
    capabilities: { aspectRatios: "model1", autoAspectDefault: true, generationTimeSec: 100, qualityToggle: true },
    icon: "google",
    enabled: true,
  },
  {
    canonicalKey: "seedream-5.0-lite",
    type: "image",
    label: "Seedream 5.0 lite",
    aliases: ["Seedream 5.0 lite", "seedream-5.0-lite"],
    creditEnvVar: "seedream-5.0-lite_IMAGE_CREDIT_DEDUCTION",
    creditDefault: 1,
    pricing: { input_per_million: 8, output_per_million: 32, per_image: 0.04 },
    qualityTiers: [
      { quality: "low",    creditEnvVar: "seedream-5.0-lite_IMAGE_CREDIT_DEDUCTION_LOW",    creditDefault: 1, pricing: { per_image: 0.035 } },
      { quality: "medium", creditEnvVar: "seedream-5.0-lite_IMAGE_CREDIT_DEDUCTION_MEDIUM", creditDefault: 1, pricing: { per_image: 0.035 } },
      { quality: "high",   creditEnvVar: "seedream-5.0-lite_IMAGE_CREDIT_DEDUCTION_HIGH",   creditDefault: 1, pricing: { per_image: 0.035 } },
    ],
    capabilities: { aspectRatios: "model1", autoAspectDefault: true, generationTimeSec: 100, qualityToggle: true },
    icon: "google",
    enabled: true,
  },
];

// ─────────────────────────── helpers ────────────────────────────────────

const _byKey = new Map();
const _byAlias = new Map();
for (const entry of MODEL_REGISTRY) {
  _byKey.set(entry.canonicalKey, entry);
  for (const alias of entry.aliases || []) _byAlias.set(alias, entry);
}

/** Lookup an entry by canonical key OR alias. Trims input, returns undefined if unknown. */
function findModel(model) {
  if (!model || typeof model !== "string") return undefined;
  const key = model.trim();
  const cached = modelConfigurationService.getCachedModel(key);
  if (cached) return cached;
  return _byKey.get(key) || _byAlias.get(key);
}

/** All strings (canonical + aliases) that resolve to a single entry. */
function allKeysFor(entry) {
  return entry ? [entry.canonicalKey, ...(entry.aliases || [])] : [];
}

/** Read this model's credits-per-unit from env, fall back to registry default. */
function getCreditDeduction(model) {
  const entry = findModel(model);
  if (!entry) return 0;
  if (entry.credits != null) return Number(entry.credits) || 0;
  if (Array.isArray(entry.qualityTiers) && entry.qualityTiers.length) {
    return Math.max(...entry.qualityTiers.map((tier) => Number(tier.credits ?? tier.creditDefault) || 0));
  }
  const raw = parseFloat(process.env[entry.creditEnvVar]);
  return Number.isFinite(raw) ? raw : (entry.creditDefault ?? 0);
}

/** Read a model's extra per-unit surcharge (e.g. clone detection) from env, fall back to registry default. */
function getExtraDeduction(model, type) {
  const entry = findModel(model);
  const extra = (entry?.extraCharges || entry?.extraDeduction)?.find((d) => d.type === type);
  if (!extra) return 0;
  if (extra.credits != null) return Number(extra.credits) || 0;
  const raw = parseFloat(process.env[extra.envVar]);
  return Number.isFinite(raw) ? raw : extra.deduction;
}

/**
 * Read a model's extra USD/sec surcharge for a specific flow (e.g. "clone").
 * Returns 0 if the model has no surcharge for that type. Used to keep the
 * cost we save on GeneratedMedia.cost aligned with what the provider actually
 * bills — otherwise admin dashboards under-report clone spend.
 */
function getExtraCostPerSecond(model, type) {
  const entry = findModel(model);
  const extra = (entry?.extraCharges || entry?.extraDeduction)?.find((d) => d.type === type);
  return Number(extra?.costPerSecond) || 0;
}

function imageEntries({ activeOnly = false } = {}) {
  const cached = modelConfigurationService.getCachedModels({ type: "image", activeOnly });
  if (cached.length) return cached;
  return MODEL_REGISTRY.filter((e) => e.type === "image" && (!activeOnly || e.enabled !== false));
}

function videoEntries({ activeOnly = false } = {}) {
  const cached = modelConfigurationService.getCachedModels({ type: "video", activeOnly });
  if (cached.length) return cached;
  return MODEL_REGISTRY.filter((e) => e.type === "video" && (!activeOnly || e.enabled !== false));
}

// ─────────────────── Quality-aware helpers (image) ───────────────────
// NEW + additive. The originals above (getCreditDeduction, and the pricing
// helpers in modelPricingConfig) are intentionally left untouched — these
// parallel functions add per-quality behaviour without changing any caller.

/** Default image quality when a caller supplies no / an unknown quality.
 *  Mirrors the frontend, where the quality picker is hidden and generation
 *  is forced to "high". */
const DEFAULT_IMAGE_QUALITY = "high";

/**
 * Resolve a model's per-quality tier (see `qualityTiers` on image entries).
 * Case-insensitive; a missing/unknown quality falls back to the
 * DEFAULT_IMAGE_QUALITY ("high") tier. Returns undefined for models that
 * declare no qualityTiers (video, disabled image models).
 */
function findQualityTier(model, quality) {
  const cachedTier = modelConfigurationService.getCachedQualityTier(model, quality);
  if (cachedTier) return cachedTier;
  const entry = findModel(model);
  const tiers = entry?.qualityTiers;
  if (!Array.isArray(tiers) || tiers.length === 0) return undefined;
  const q = typeof quality === "string" ? quality.trim().toLowerCase() : "";
  return (
    tiers.find((t) => t.quality === q) ||
    tiers.find((t) => t.quality === DEFAULT_IMAGE_QUALITY) ||
    undefined
  );
}

/**
 * Credits-per-image for a (model, quality) combo. Reads the matching tier's
 * creditEnvVar from env, falling back to that tier's creditDefault. For models
 * with no qualityTiers it defers to the original getCreditDeduction, so this is
 * safe to call for any model.
 */
function getCreditDeductionByQuality(model, quality) {
  const tier = findQualityTier(model, quality);
  if (tier) {
    if (tier.credits != null) return Number(tier.credits) || 0;
    const raw = parseFloat(process.env[tier.creditEnvVar]);
    return Number.isFinite(raw) ? raw : tier.creditDefault;
  }
  return getCreditDeduction(model);
}

module.exports = {
  MODEL_REGISTRY,
  findModel,
  allKeysFor,
  findQualityTier,
  getCreditDeduction,
  getCreditDeductionByQuality,
  getExtraDeduction,
  getExtraCostPerSecond,
  imageEntries,
  videoEntries,
};
