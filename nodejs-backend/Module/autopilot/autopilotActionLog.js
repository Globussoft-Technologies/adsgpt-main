const mongoose = require("mongoose");

/**
 * autopilotActionLog — source of truth for every action Autopilot takes (or
 * would take, in dry-run). Written by services/autopilot/autoPauseService.js
 * and future phase services (auto-resume, scale-winners, creative rotation…).
 *
 * Design notes
 *  - `runId` groups every action produced by a single orchestrator tick, so
 *    the UI can show "here's what happened at 14:00 UTC across all accounts."
 *  - `dryRun` is a top-level boolean so a dry-run report is a first-class log,
 *    not distinguishable only by the absence of a real outcome.
 *  - `metricsSnapshot` captures the rule-firing data in the moment. Phase 4's
 *    "why was this paused?" UI reads it; we never re-query Meta for history.
 *  - `pausedBy` = 'autopilot' on autopilot's own pauses. Phase 5 auto-resume
 *    will filter on this to avoid reversing a manual pause.
 */
const autopilotActionLogSchema = new mongoose.Schema(
  {
    runId: { type: String, required: true, index: true },

    userId: { type: String, required: true, index: true },
    adAccountId: { type: String, required: true, index: true },
    adAccountName: { type: String },

    level: {
      type: String,
      enum: ["campaign", "adset", "ad"],
      required: true,
    },
    entityId: { type: String, required: true, index: true },
    entityName: { type: String },

    // Parent-chain identity. For an ad-level row these point to the
    // owning campaign + adset; for an adset-level row only campaignId/Name
    // is set; for a campaign-level row both are left undefined (the
    // campaign IS the entity, captured by entityId/entityName).
    // Stored explicitly so email / Slack / UI rollups can show
    // "Campaign · Adset · Ad" hierarchy without a re-fetch from Meta.
    campaignId: { type: String },
    campaignName: { type: String },
    adsetId: { type: String },
    adsetName: { type: String },

    ruleId: { type: String, required: true },
    // v4 writes user-rule severities (low/medium/high). The legacy v3
    // values (critical/warning/opportunity) are kept in the enum so that
    // historical rows still pass validation when re-saved (e.g. by a
    // script) and so the LLM-audit feature — which still emits the v3
    // bucket names — can co-exist with v4 cron rows.
    ruleSeverity: {
      type: String,
      enum: [
        "low",
        "medium",
        "high",
        "critical",
        "warning",
        "opportunity",
      ],
    },
    ruleMessage: { type: String },

    metricsSnapshot: { type: mongoose.Schema.Types.Mixed },

    action: {
      type: String,
      enum: [
        "pause",
        "resume",
        "scale_budget",
        "rotate_creative",
        "generate_creative",
        "rename",
        "alert_only",
      ],
      required: true,
    },
    actionPayload: { type: mongoose.Schema.Types.Mixed },

    dryRun: { type: Boolean, default: true, index: true },
    outcome: {
      type: String,
      enum: ["success", "failed", "skipped"],
      required: true,
    },
    skipReason: { type: String },
    error: { type: String },

    metaApiLatencyMs: { type: Number },
    runAt: { type: Date, default: Date.now, index: true },

    pausedBy: { type: String, default: "autopilot" },
  },
  { timestamps: true },
);

// Compound indexes for the common read patterns (Phase 4 UI + Phase 5 lookups).
autopilotActionLogSchema.index({ userId: 1, runAt: -1 });
autopilotActionLogSchema.index({ adAccountId: 1, runAt: -1 });
autopilotActionLogSchema.index({ entityId: 1, action: 1, runAt: -1 });

module.exports = mongoose.model(
  "AutopilotActionLog",
  autopilotActionLogSchema,
);
