const mongoose = require("mongoose");

const resultSchema = new mongoose.Schema(
  {
     model: {
      type: String,
    },
    url: {
      type: String,
    },
      waterMarkUrl: {
      type: String,
    },
    duration: {
      type: String,
    },
     error: {
      type: String,
      default: null,
    },
   videoStatus: {
      type: Number,
      enum: [200, 400, 429, 500, 529],
    },
  },
  { _id: false }
);

// ─── Sub-schemas used by AI Ads ───────────────────────────────────────────────
const scriptLineSchema = new mongoose.Schema(
  {
    id: Number,
    start: String,
    end: String,
    text: String,
    voice: String,
    wordCount: Number,
    charCount: Number,
    maxWords: Number,
    minWords: Number,
  },
  { _id: false }
);

const sceneSchema = new mongoose.Schema(
  {
    segmentNumber: { type: Number, required: true },
    // "both" = image + text, "image" = image only, "text" = text only
    type: { type: String, enum: ["both", "image", "text"], default: "both" },
    goal: { type: String }, // e.g. "HOOK", "PROBLEM", "SOLUTION"
    durationSeconds: { type: Number },
    frameImageUrl: { type: String, default: null },
    script: [scriptLineSchema],
    sceneDescription: { type: String },
    audioDirection: { type: String },
    tone: { type: String },
    indianAccent: { type: Boolean },
    imageFailed: { type: Boolean, default: false },
    imageError: { type: String, default: null },
  },
  { _id: false }
);

const videoSegmentSchema = new mongoose.Schema(
  {
    segmentNumber: { type: Number },
    videoUrl: { type: String },
    duration: { type: Number }, // in seconds
  },
  { _id: false }
);

// ─── Main VideoGeneration schema ──────────────────────────────────────────────
const videoSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
    },
    promptPercentage: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: ["pending", "processing", "completed", "failed", "copy"],
      default: "pending",
    },

    inputs: {
      type: {
        type: String,
        enum: ["ugc", "broll", "avatar", "clone", "ai_ads"],
        required: true,
      },
      model: {
        type: String,
        required: true,
      },
      numberOfVideos: {
        type: Number,
        required: true,
      },
      duration: { type: String },
      aspectRatio: {
        type: String,
        enum: ["9:16", "1:1", "16:9"],
      },
      productUrl: String,
      productName: String,
      productDescription: String,
      image: String,
      text: String,
      promotion: String,
      notes: String,
      script: String,
      avatar: String,
      avatarId: String,
      voice: String,
      videoSample: String,
      voiceClone: Boolean,
      tone: String,
      voiceSampleUrl: String,
      characterGender: String,
      uploadedAvatars: [String],

      // ── AI Ads-specific input fields (stored for re-use in regenerate) ──────
      aiAdsType: { type: String, enum: ["brand", "product"] },
      category: String,
      adStyle: String,
      ctaType: String,
      images: [String],
      logoUrl: String,
      tagline: String,
      brandName: String,
      price: String,
      productType: String,
      userPrompt: { type: String},
      // confirmed scenes sent to generate-video step
      scenes: { type: mongoose.Schema.Types.Mixed },

      // ── ElevenLabs voice picker (AI Ads) ───────────────────────────────────
      // voiceId is the deliverable forwarded to Python for TTS. voiceFilters
      // is metadata used to repopulate the picker on resume/recreate; Python
      // does not consume it.
      voiceId: String,
      voiceName: String,
      voiceFilters: {
        language:      String,
        languageLabel: String,
        gender:        String,
        accent:        String,
        age:           String,
      },
    },

    // ── Regular video outputs ─────────────────────────────────────────────────
    generatedImage: { type: String, default: null },
    generatedScript: { type: mongoose.Schema.Types.Mixed, default: null },
    videoPrompt: { type: String, default: null },
    watermark: Boolean,
    results: [resultSchema],

    // ── AI Ads outputs ────────────────────────────────────────────────────────
    // Scenes delivered by Python /callback/scene-result
    scenes: [sceneSchema],
    totalSegments: { type: Number },
    totalDuration: { type: Number },
    // Video delivered by Python /callback/video-result
    videoSegments: [videoSegmentSchema],
  },
  { timestamps: true }
);

module.exports = mongoose.model("VideoGeneration", videoSchema);
