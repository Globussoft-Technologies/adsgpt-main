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
    // Per-platform campaign/ad-group/ad-set IDs from this run, used to build
    // deep links straight to the created ad in each platform's UI —
    // { meta: { campaignId, adSetId }, google: { campaignId, adGroupId } }
    platformContext: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    error: { type: String, default: null }, // error message if status = "failed"

    // Storing the creatives generated during this run locally (avoids polluting campaign.creatives)
    automationCreatives: {
      type: [new mongoose.Schema(
        {
          creativeId:   { type: String, required: true },
          imageUrl:     { type: String, default: "", trim: true },
          headline:     { type: String, default: "", trim: true },
          message:      { type: String, default: "", trim: true },
          linkUrl:      { type: String, default: "", trim: true },
          callToAction: { type: String, default: "", trim: true },
          description:  { type: String, default: "", trim: true },
          platform:     { type: String, default: "", trim: true },
          // The real ad ID created for this specific creative on each
          // platform it was posted to — { meta: "1202...", google: "789..." }
          postedAdIds:  { type: Map, of: String, default: () => new Map() },
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
    // Meta campaign created on this job's first successful run — reused by
    // every subsequent run so all runs post ad sets/ads under one campaign.
    createdCampaignId: { type: String, default: null },
  },
  { _id: false }
);


// ─── GoogleTargetSchema ───────────────────────────────────────────────────────

const GoogleTargetSchema = new mongoose.Schema(
  {
    template: {
      name:               { type: String, required: true, trim: true },
      objective:          { type: String, default: "" },
      conversionLocation: { type: String, default: "" },
      customerId:         { type: String, default: "" },
      payload:            { type: mongoose.Schema.Types.Mixed, required: true },
    },
    // Google campaign created on this job's first successful run — reused by
    // every subsequent run so all runs post ad groups/ads under one campaign.
    createdCampaignId: { type: String, default: null },
  },
  { _id: false }
);

// ─── AlertsSchema ─────────────────────────────────────────────────────────────

// Per-job alert config. After every run cycle finishes (success/partial/failed)
// the orchestrator emails a cycle summary to these recipients. emailTo is a
// comma-separated list (up to 5) stored as a single string — same convention as
// the Meta Autopilot's autopilotSettings.alerts.emailTo, split at send-time by
// adsFactoryAlertService.parseEmailRecipients. Empty/unset → no email is sent.
const AlertsSchema = new mongoose.Schema(
  {
    emailTo: { type: String, default: "", trim: true },
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
      meta:   { type: MetaTargetSchema },
      google: { type: GoogleTargetSchema },
    },

    // Per-job alert config — cycle-complete email recipients (see AlertsSchema)
    alerts: { type: AlertsSchema, default: () => ({}) },

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
