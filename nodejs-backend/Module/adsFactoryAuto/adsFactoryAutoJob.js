const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

// ─── RunHistorySchema ─────────────────────────────────────────────────────────

// One entry appended to runHistory[] at the end of every execution cycle
const RunHistorySchema = new mongoose.Schema(
  {
    runId:       { type: String, default: () => uuidv4() }, // unique trace ID for this run
    startedAt:   { type: Date,   default: Date.now },
    completedAt: { type: Date,   default: null },
    status: {
      type:    String,
      enum:    ["success", "failed", "partial", "skipped"],
      default: "failed",
    },
    metaAdId:   { type: String, default: null }, // Facebook / Instagram ad ID created this run
    googleAdId: { type: String, default: null }, // Google Ads ad ID created this run
    // Ad IDs for any other platform — { tiktok: "id", snapchat: "id", linkedin: "id", … }
    platformAdIds: { type: Map, of: String, default: () => new Map() },
    error: { type: String, default: null }, // error message if status = "failed"

    // Storing the creatives generated during this run locally (avoids polluting campaign.creatives)
    automationCreatives: {
      type: [new mongoose.Schema(
        {
          creativeId:   { type: String, required: true },
          imageUrl:     { type: String, required: true, trim: true },
          headline:     { type: String, required: true, trim: true },
          message:      { type: String, required: true, trim: true },
          linkUrl:      { type: String, required: true, trim: true },
          callToAction: { type: String, required: true, trim: true },
          description:  { type: String, default: "", trim: true },
          platform:     { type: String, default: "", trim: true },
        },
        { _id: false }
      )],
      default: []
    },

    // Storing the exact raw results (so we can show exactly which ones failed and the error messages)
    rawImages: { type: [mongoose.Schema.Types.Mixed], default: [] },
    rawTexts:  { type: [mongoose.Schema.Types.Mixed], default: [] }

  },
  { _id: false }
);

// ─── ScheduleSchema ───────────────────────────────────────────────────────────

// Maps directly to the UI Schedule modal fields
const ScheduleSchema = new mongoose.Schema(
  {
    frequency: { type: String, required: true, trim: true },

    // UI "Start date" picker
    startDate: { type: Date, default: null },

    // UI "End date (optional)" picker
    endDate: { type: Date, default: null },

    // The hour of the day (0-23) to run the automation
    hour: { type: Number, default: 0, min: 0, max: 23 },

    // ── Custom frequency fields (visible when frequency = "custom") ───────────
    customFrequency: {
      repeatEvery:  { type: Number, default: 1, min: 1 },
      repeatUnit:   { type: String, default: "week" },
      repeatOnDays: { type: [String], default: [] },
    },

    // ── Resolved cron — set by orchestrator, do not write from API ────────────

    // BullMQ cron string derived from the above fields
    cronExpression: { type: String, default: null },

    timezone: { type: String }, // IANA name e.g. "UTC"

    // Set and maintained by the orchestrator — do not write from the API layer
    nextRunAt: { type: Date, default: null },
    lastRunAt: { type: Date, default: null },
  },
  { _id: false }
);

// ─── MetaTargetSchema ─────────────────────────────────────────────────────────

// Facebook / Instagram placement IDs — must exist in the user's Meta Business Manager
const MetaTargetSchema = new mongoose.Schema(
  {
    template: {
      name:               { type: String, required: true, trim: true },
      objective:          { type: String, default: "" },
      conversionLocation: { type: String, default: "" },
      pageId:             { type: String, default: "" }, // Facebook Page the ad runs under
      payload:            { type: mongoose.Schema.Types.Mixed, required: true },
    },
  },
  { _id: false }
);


// ─── AdsFactoryJobSchema ──────────────────────────────────────────────────────

// Root document — one job = one recurring ad-creation + posting task
const AdsFactoryJobSchema = new mongoose.Schema(
  {
    userId:     { type: String, required: true, index: true }, // job owner
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: "Campaign", required: true, index: true },

    // When and how often to run — maps 1:1 to the UI Schedule modal
    schedule: { type: ScheduleSchema, required: true },

    // Number of image + copy pairs to generate and post per run cycle (UI: Min 1 · Max 50)
    pairsPerCycle: { type: Number, default: 1, min: 1, max: 200 },

    model: { type: String, default: null }, // model selected by user for this auto job
    // CTA button labels — copied from the campaign's own CTA list at job creation time


    // Platform-specific placement IDs — template is stored inside each target
    // To add a new platform: create a new *TargetSchema above and add a key here.
    targets: {
      meta: { type: MetaTargetSchema, default: () => ({}) },
    },

    // Lifecycle state of the job
    status: {
      type:    String,
      enum:    ["active", "paused", "completed", "failed", "draft", "archived"],
      default: "active",
    },

    runHistory: { type: [RunHistorySchema], default: [] }, // append-only run log
    totalRuns:  { type: Number, default: 0 }, // incremented after every run attempt
    failedRuns: { type: Number, default: 0 }, // incremented when a run ends in "failed"
  },
  { timestamps: true }
);

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = mongoose.model("AdsFactoryJob", AdsFactoryJobSchema);
