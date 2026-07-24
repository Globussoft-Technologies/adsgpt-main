const mongoose = require("mongoose");

// ─── Script line (shared by scenes + per-version result scripts) ──────────────
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

// ─── Per-version AI Ads state (voice regenerate) ──────────────────────────────
// One results[] entry == one switchable "version" of the ad. doc.version points
// at the entry My Space shows. `inputs` stays FROZEN as the original first-gen
// state; each version's *changed* inputs (voice/language) and its *output*
// (structured script) are co-located here so a version is fully self-contained —
// no parallel arrays to keep in lockstep. results[0].aiAds mirrors the original
// inputs' voice + the original script; regenerated entries carry the voice/lang/
// regenType used and the re-rendered script. Regenerate operates relative to the
// currently selected version (results[doc.version]), enabling chained flows
// (e.g. translate → then re-voice the translated script).

// Lighter per-version scene: only what changes across versions (script + timing).
const resultSceneSchema = new mongoose.Schema(
  {
    segmentNumber: { type: Number },
    durationSeconds: { type: Number },
    script: [scriptLineSchema],
  },
  { _id: false }
);

const aiAdsResultSchema = new mongoose.Schema(
  {
    // null = the original render; otherwise which regenerate flow produced it.
    regenType: {
      type: String,
      enum: ["voice", "translate", "rewrite", null],
      default: null,
    },
    // The voice this version was rendered with ("modified input", per version).
    voiceProvider: { type: String, default: null },
    voiceId: { type: String, default: null },
    voiceName: { type: String, default: null },
    // This version's language (Python owns the actual value).
    language: { type: String, default: null },
    translateLang: { type: String, default: null },
    // Structured per-version script, mirroring scenes[].script.
    scenes: [resultSceneSchema],
  },
  { _id: false }
);

const aiAdsVoicePreviewSchema = new mongoose.Schema(
  {
    audioUrl: { type: String, required: true },
    videoUrl: { type: String, default: "" },
    duration: { type: String, default: "" },
    voiceProvider: { type: String, default: null },
    regenType: { type: String, enum: ["voice", "translate", "rewrite"], required: true },
    audioStatus: { type: Number, default: 200 },
  },
  { _id: false, timestamps: true }
);

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

    // ── AI Ads per-version state (voice regenerate; null for other types) ──────
    aiAds: { type: aiAdsResultSchema, default: null },
  },
  { _id: false }
);

// ─── Sub-schemas used by AI Ads ───────────────────────────────────────────────
// (scriptLineSchema is defined above — shared with per-version result scripts.)
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

      // ── Narrator voice picker (AI Ads) ─────────────────────────────────────
      // voiceProvider selects the TTS engine ('elevenlabs' | 'sarvam') and must
      // persist so regenerate/copy/resume rebuild the Python payload with the
      // right engine. The deliverable differs by provider: ElevenLabs uses
      // voiceId, Sarvam uses voiceName (voiceId stays ''). voiceFilters is
      // picker metadata for repopulating the cascade on resume/recreate.
      voiceProvider: String,
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
    cleanVideoUrl: { type: String, default: null },

    // ── AI Ads version pointer (voice regenerate) ─────────────────────────────
    // Index into results[] that My Space displays. Defaults to 0 (the original
    // render). Only moved by an explicit "Keep this one"/revert (select-version);
    // regenerated results are appended but do NOT auto-move this pointer.
    version: { type: Number, default: 0 },
    // Guards concurrent voice regens. Main `status` stays "completed" during a
    // regen so the existing video keeps showing with a progress overlay.
    regenState: {
      type: String,
      enum: ["idle", "processing", "failed"],
      default: "idle",
    },
    // Guards an in-flight "translate/rewrite" script PREVIEW (Step 1 of the
    // 2-step translate flow). Set to "processing" when Node fires
    // preview_regenerate_script; the shared scene-result callback checks this to
    // forward the new script to the modal WITHOUT touching the committed
    // scenes/status/version. Cleared on the first callback (success or failure).
    previewState: {
      type: String,
      enum: ["idle", "processing", "failed"],
      default: "idle",
    },
    // In-flight voice-regen stash. Node captures the voice delta (+ the base
    // script as a fallback) here when firing Python, so the finished-callback
    // can stamp the new version even before Python echoes the metadata back.
    // Forward-compatible: the callback prefers Python's body fields over this
    // stash when present. Cleared (null) on completion/failure.
    pendingRegen: { type: aiAdsResultSchema, default: null },
    voicePreview: { type: aiAdsVoicePreviewSchema, default: null },

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
