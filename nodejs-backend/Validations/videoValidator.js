const Joi = require("joi");
const objectIdRegex = /^[0-9a-fA-F]{24}$/;

const baseInputSchema = {
  type: Joi.string().valid("ugc", "broll", "avatar", "clone", "ai_ads").required(),

  model: Joi.string().required(),

  numberOfVideos: Joi.number().min(1).required(),

  duration: Joi.string().required(),

  aspectRatio: Joi.string().valid("9:16", "1:1", "16:9").required(),
};

const ugcSchema = Joi.object({
  ...baseInputSchema,
  type: Joi.valid("ugc").required(),
  productUrl: Joi.string().allow("", null),
  productName: Joi.string().required(),
  productDescription: Joi.string().required(),
  image: Joi.string().required(),
  promotion: Joi.string().allow("", null),
  notes: Joi.string().allow("", null),
});

const brollSchema = Joi.object({
  ...baseInputSchema,
  type: Joi.valid("broll").required(),
  productUrl: Joi.string().allow("", null),
  productName: Joi.string().required(),
  image: Joi.string().required(),
  promotion: Joi.string().allow("", null),
  notes: Joi.string().allow("", null),
});

const avatarSchema = Joi.object({
  ...baseInputSchema,

  type: Joi.valid("avatar").required(),

  avatarType: Joi.string().valid("ai_library", "custom").required(),

  avatarId: Joi.when("avatarType", {
    is: "ai_library",
    then: Joi.string().pattern(objectIdRegex).required(),
    otherwise: Joi.optional(),
  }),

  uploadedAvatars: Joi.when("avatarType", {
    is: "custom",
    then: Joi.array().items(Joi.string()).min(1).required(),
    otherwise: Joi.optional(),
  }),

  productName: Joi.string().required(),
  image: Joi.string().allow("", null).required(),
  text: Joi.string().allow("").required(),
  promotion: Joi.string().allow("", null),
  notes: Joi.string().allow("", null),
});

const cloneSchema = Joi.object({
  ...baseInputSchema,
  type: Joi.valid("clone").required(),
  uploadedAvatars: Joi.array().items(Joi.string()).length(3).required(),
  productName: Joi.string().required(),
  image: Joi.string().required(),
  promotion: Joi.string().allow("", null),
  notes: Joi.string().allow("", null),
  tone: Joi.string().required(),
  voiceSampleUrl: Joi.string().allow("", null),
});

// ai_ads generate-video input schema (type="ai_ads", scenes required)
const aiAdsVideoInputSchema = Joi.object({
  type: Joi.string().valid("ai_ads").required(),
  scenes: Joi.array().min(1).required(),
  model: Joi.string().required(),
  numberOfVideos: Joi.number().integer().min(1).required(),
  duration: Joi.string().required(),
}).unknown(true);

const generateVideoRequestSchema = Joi.object({
  // sessionId is only required for ai_ads (second step — generate video from scenes)
  sessionId: Joi.string().optional(),

  inputs: Joi.alternatives()
    .try(ugcSchema, brollSchema, avatarSchema, cloneSchema, aiAdsVideoInputSchema)
    .required(),
});

const updateResultSchema = Joi.object({
  model: Joi.string(),
  url: Joi.when("videoStatus", {
    is: 200,
    then: Joi.string().required(),
    otherwise: Joi.string().allow(null, ""),
  }),
  cleanVideoUrl: Joi.string().allow(null, ""),
  duration: Joi.string(),
  error: Joi.string().allow(null, ""),
  videoStatus: Joi.number().valid(200, 400, 429, 500, 529),
  userId: Joi.string().required(),
  subscription: Joi.object().required(),
  watermark: Joi.boolean().required(),
  watermarkUrl: Joi.string().allow(null, ""),
});

const updatePromptPercentageSchema = Joi.object({
  sessionId: Joi.string().required(), // This is the _id passed as sessionId
  promptPercentage: Joi.number().min(0).max(100).required(),
  stage: Joi.string().allow(null, "").optional(),
}).unknown(true);

// ─── AI Ads Schemas ──────────────────────────────────────────────────────────────────────

// Common input fields shared by brand & product
const aiAdsCommonInputFields = {
  type: Joi.string().valid("ai_ads").required(),
  aiAdsType: Joi.string().valid("brand", "product").required(),
  category: Joi.string().required(),
  adStyle: Joi.string().required(),
  tone: Joi.string().required(),
  duration: Joi.string().required(), // "24" — seconds as string
  aspectRatio: Joi.string().valid("9:16", "1:1", "16:9").required(),
  ctaType: Joi.string().required(),
  model: Joi.string().required(),
  numberOfVideos: Joi.number().integer().min(1).required(),
  images: Joi.array().items(Joi.string().uri()).min(1).required(),
  logoUrl: Joi.string().uri().optional().allow(""),
  tagline: Joi.string().optional().allow(""),
  userPrompt: Joi.string().required(),
  captionsEnabled: Joi.boolean().default(false),
};

const brandInputSchema = Joi.object({
  ...aiAdsCommonInputFields,
  aiAdsType: Joi.string().valid("brand").required(),
  brandName: Joi.string().required(),
  productDescription: Joi.string().required(),
}).unknown(true);

const productInputSchema = Joi.object({
  ...aiAdsCommonInputFields,
  aiAdsType: Joi.string().valid("product").required(),
  productName: Joi.string().required(),
  productDescription: Joi.string().required(),
  price: Joi.string().optional().allow(""),
  productType: Joi.string().optional().allow(""),
}).unknown(true);

// generate-scene
const generateSceneSchema = Joi.object({
  sessionId: Joi.string().optional(),
  userId: Joi.string().optional(),
  watermark: Joi.boolean().optional(),
  inputs: Joi.object({
    aiAdsType: Joi.string().valid("brand", "product").required(),
    captionsEnabled: Joi.boolean().default(false),
  })
    .unknown(true)
    .required(),
});

// regenerate-scene
const regenerateSceneSchema = Joi.object({
  sessionId: Joi.string().required(),
  userId: Joi.string().optional(),
  watermark: Joi.boolean().optional(),
  segments: Joi.array()
    .items(
      Joi.object({
        segmentNumber: Joi.number().required(),
        regenerate: Joi.string().valid("text", "image", "both").required(),
        // Frontend sends '' for text, actual prompt for image/both
        regeneratePrompt: Joi.string().optional().allow(""),
        // Whether the scene already had a successful image. true → billable
        // image regen; false → free retry of a never-succeeded scene. Backend
        // validates against DB before honoring (see regenerateScene).
        deduct: Joi.boolean().optional(),
      })
    )
    .min(1)
    .required()
});


// ─── AI Ads voice regenerate (voice-only re-render, no Veo) ──────────────────

// POST /video/ai-ads/regenerate-voice/:sessionId  (sessionId is a URL param).
// Client sends only the delta; Node merges it onto the stored doc.inputs before
// firing Python. Provider split: ElevenLabs uses voiceId (voiceName is a label),
// Sarvam uses voiceName (voiceId stays ""). translateLang is required only for
// regenType "translate". Language equality ("already_in_language") is enforced
// by Python and forwarded verbatim — not validated here.
const regenerateVoiceSchema = Joi.object({
  userId: Joi.string().optional(),
  watermark: Joi.boolean().optional(),
  // forward-compat: voice regen is free today, but a subscription may be
  // supplied so billing can be switched on later without a contract change.
  subscription: Joi.object().optional(),
  inputs: Joi.object({
    voiceProvider: Joi.string().valid("elevenlabs", "sarvam").required(),
    voiceId: Joi.when("voiceProvider", {
      is: "elevenlabs",
      then: Joi.string().required(),
      otherwise: Joi.string().allow("", null),
    }),
    voiceName: Joi.when("voiceProvider", {
      is: "sarvam",
      then: Joi.string().required(),
      otherwise: Joi.string().allow("", null),
    }),
    regenType: Joi.string().valid("voice", "translate", "rewrite").required(),
    sourceRegenType: Joi.string().valid("voice", "translate", "rewrite").optional(),
    translateLang: Joi.when("regenType", {
      is: "translate",
      then: Joi.string().required(),
      otherwise: Joi.string().allow("", null).optional(),
    }),
    // Edited script for translate/rewrite Step 2. When present, the controller
    // uses these scenes (user's edits) instead of the base version's script.
    // Shape is passthrough — Python owns the per-line script schema.
    scenes: Joi.array().items(Joi.object().unknown(true)).optional(),
  }).required(),
});

// NOTE: the finished voice re-render arrives on the EXISTING AI-ads video
// callback (updateAiAdsVideoResult), branched on isVoiceRegenerate. Like the
// other AI-ads callbacks it is schemaless (reads req.body directly, secret-key
// protected), so there is intentionally no Joi schema for it here.

// PATCH /video/ai-ads/select-version/:sessionId  (JWT) — the "Keep this one" /
// revert action. Range (0 <= version < results.length) is checked in the
// controller against the actual doc; here we only enforce a non-negative int.
const selectVersionSchema = Joi.object({
  version: Joi.number().integer().min(0).required(),
});

const finalMergeSchema = Joi.object({
  audioUrl: Joi.string().trim().required(),
  videoUrl: Joi.string().trim().allow("").required(),
});


// brand / product intelligence — only script or name required
const aiAdsBrandSchema = Joi.object({
  script: Joi.string().optional().allow(""),
  name: Joi.string().optional().allow(""),
}).or("script", "name");

const aiAdsProductSchema = Joi.object({
  script: Joi.string().optional().allow(""),
  name: Joi.string().optional().allow(""),
}).or("script", "name");


const validateVideoUrlsXor = (inputs, helpers) => {
  const hasSource = Boolean(inputs.sourceVideoUrl && inputs.sourceVideoUrl.trim());
  const hasGallery = Boolean(inputs.galleryVideoUrl && inputs.galleryVideoUrl.trim());

  if ((hasSource && hasGallery) || (!hasSource && !hasGallery)) {
    return helpers.message(
      "Exactly one of sourceVideoUrl or galleryVideoUrl must be provided"
    );
  }
  return inputs;
};

const baseCloneAdInputs = {
  sourceVideoUrl: Joi.string().allow("", null).optional(),
  galleryVideoUrl: Joi.string().allow("", null).optional(),
  productImageUrls: Joi.array()
    .items(
      Joi.string()
        .trim()
        .custom((value, helpers) => {
          if (
            /\.(mp4|webm|mov|m4v|avi|mkv|flv|wmv|pdf|html|php|asp)(\?.*)?$/i.test(value) ||
            /(?:youtube\.com|youtu\.be|instagram\.com|facebook\.com|fb\.watch|tiktok\.com|twitter\.com|x\.com|vimeo\.com|dailymotion\.com|linkedin\.com)/i.test(value)
          ) {
            return helpers.message("Invalid image source. Please provide valid image URLs.");
          }
          return value;
        })
        .required()
    )
    .min(1)
    .max(3)
    .required(),
  additionalInstructions: Joi.string().allow("", null).optional(),
  model: Joi.string().trim().optional(),
  targetDurationSeconds: Joi.number().integer().min(4).required(),
  aspectRatio: Joi.string().trim().required(),
};

const cloneAdAnalyzeSchema = Joi.object({
  inputs: Joi.object({
    ...baseCloneAdInputs,
    productBrandName: Joi.string().allow("", null).optional(),
    visualDescription: Joi.string().allow("", null).optional(),
    analysisSummary: Joi.string().allow("", null).optional(),
  })
    .unknown(true)
    .custom(validateVideoUrlsXor)
    .required(),
}).unknown(true);

const cloneAdGenerateSchema = Joi.object({
  sessionId: Joi.string().trim().required(),
  logoImageUrl: Joi.string().allow("", null).optional().default(null),
}).unknown(true);

const resolveMediaSchema = Joi.object({
  url: Joi.string().trim().min(5).required(),
}).unknown(true);

module.exports = {
  generateVideoRequestSchema,
  updateResultSchema,
  updatePromptPercentageSchema,
  inputSchemasByType: {
    ugc: ugcSchema,
    broll: brollSchema,
    avatar: avatarSchema,
    clone: cloneSchema,
    ai_ads: aiAdsVideoInputSchema,
  },
  // AI Ads
  brandInputSchema,
  productInputSchema,
  aiAdsBrandSchema,
  aiAdsProductSchema,
  generateSceneSchema,
  regenerateSceneSchema,
  regenerateVoiceSchema,
  selectVersionSchema,
  finalMergeSchema,
  cloneAdAnalyzeSchema,
  cloneAdGenerateSchema,
  resolveMediaSchema,
};
