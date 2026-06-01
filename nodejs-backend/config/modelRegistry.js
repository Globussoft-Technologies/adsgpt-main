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
 *
 *   pricing        IMAGE: { input_per_million, output_per_million, per_image? }
 *                          (per_image, when present, short-circuits token math)
 *                  VIDEO: { per_second }
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
    enabled: true,
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
    enabled: true,
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
    enabled: true,
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
    capabilities: { aspectRatios: "model1", autoAspectDefault: true, generationTimeSec: 100, qualityToggle: true },
    icon: "google",
    enabled: false,
  },
  {
    canonicalKey: "gemini-3-pro-image-preview",
    type: "image",
    label: "Nano Banana Pro",
    aliases: ["Nano Banana Pro", "gemini-3-pro-image-preview"],
    creditEnvVar: "gemini-3-pro-image-preview_IMAGE_CREDIT_DEDUCTION",
    creditDefault: 7,
    pricing: { input_per_million: 8, output_per_million: 32, per_image: 0.27 },
    capabilities: { aspectRatios: "model1", autoAspectDefault: true, generationTimeSec: 100, qualityToggle: true },
    icon: "google",
    enabled: false,
  },
  {
    canonicalKey: "gpt-image-1.5",
    type: "image",
    label: "OpenAI 1.5",
    aliases: ["OpenAI 1.5", "gpt-image-1.5"],
    creditEnvVar: "gpt-image-1.5_IMAGE_CREDIT_DEDUCTION",
    creditDefault: 7,
    pricing: { input_per_million: 8, output_per_million: 32, per_image: 0.27 },
    capabilities: { aspectRatios: "model1", autoAspectDefault: true, generationTimeSec: 100, qualityToggle: true },
    icon: "google",
    enabled: false,
  },
  {
    canonicalKey: "gpt-image-2",
    type: "image",
    label: "OpenAI 2.0",
    aliases: ["OpenAI 2.0", "gpt-image-2"],
    creditEnvVar: "gpt-image-2_IMAGE_CREDIT_DEDUCTION",
    creditDefault: 7,
    pricing: { input_per_million: 8, output_per_million: 32, per_image: 0.27 },
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
    creditDefault: 7,
    pricing: { input_per_million: 8, output_per_million: 32, per_image: 0.27 },
    capabilities: { aspectRatios: "model1", autoAspectDefault: true, generationTimeSec: 100, qualityToggle: true },
    icon: "google",
    enabled: false,
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
  const raw = parseFloat(process.env[entry.creditEnvVar]);
  return Number.isFinite(raw) ? raw : entry.creditDefault;
}

function imageEntries({ activeOnly = false } = {}) {
  return MODEL_REGISTRY.filter((e) => e.type === "image" && (!activeOnly || e.enabled !== false));
}

function videoEntries({ activeOnly = false } = {}) {
  return MODEL_REGISTRY.filter((e) => e.type === "video" && (!activeOnly || e.enabled !== false));
}

module.exports = {
  MODEL_REGISTRY,
  findModel,
  allKeysFor,
  getCreditDeduction,
  imageEntries,
  videoEntries,
};
