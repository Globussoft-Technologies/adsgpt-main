const mongoose = require("mongoose");

/**
 * autopilotSettings — per-user preferences for the Autopilot feature.
 *
 * Shape follows AUTOPILOT_PRD.md §8.1. One document per `userId`.
 *
 * Precedence at runtime (lowest to highest):
 *   rule defaults
 *   < autopilotConfig.accounts[acctId].overrides   (code-committed, per-account)
 *   < this document's perAccountOverrides          (user-editable subset)
 *   < per-request overrides from an HTTP caller
 *
 * Safety: toggling any of the `*Enabled` flags here is only advisory — the
 * global `AUTOPILOT_LIVE_ACTIONS_ALLOWED` env flag is what actually governs
 * whether writes to Meta happen. These flags control whether the orchestrator
 * runs those phases at all; flipping them to false short-circuits the
 * service call.
 */
const DEFAULTS = {
  enabled: false,
  dryRunGlobal: true,
  severityFloor: "critical",
  autoResumeEnabled: true,
  scaleWinnersEnabled: false,
  creativeRotationEnabled: false,
  creativeAutoGenerateEnabled: false,
  creativeAutoApproveGenerated: false,
  // Per-account opt-in. Empty = no accounts selected = nothing happens, even
  // when `enabled: true`. Stored as bare ids (no `act_` prefix) to match
  // what `getAdAccounts()` returns to the UI.
  selectedAdAccountIds: [],
};

const alertsSchema = new mongoose.Schema(
  {
    slackWebhookUrl: { type: String, default: "" },
    emailTo: { type: String, default: "" },
    // Telegram fan-out uses a shared bot owned by AdsGPT (token in
    // process.env.AUTOPILOT_TELEGRAM_BOT_TOKEN). Users only need to add
    // that bot to their group and paste the resulting chat id here — no
    // per-user @BotFather dance. Empty chat id => Telegram dispatch is
    // skipped for that user.
    telegramChatId: { type: String, default: "" },
    alertOn: {
      type: [String],
      default: ["high"],
    },
  },
  { _id: false },
);

const autopilotSettingsSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, unique: true, index: true },

    enabled: { type: Boolean, default: DEFAULTS.enabled },
    dryRunGlobal: { type: Boolean, default: DEFAULTS.dryRunGlobal },

    severityFloor: {
      type: String,
      enum: ["critical", "warning", "opportunity"],
      default: DEFAULTS.severityFloor,
    },

    autoResumeEnabled: {
      type: Boolean,
      default: DEFAULTS.autoResumeEnabled,
    },
    scaleWinnersEnabled: {
      type: Boolean,
      default: DEFAULTS.scaleWinnersEnabled,
    },
    creativeRotationEnabled: {
      type: Boolean,
      default: DEFAULTS.creativeRotationEnabled,
    },
    creativeAutoGenerateEnabled: {
      type: Boolean,
      default: DEFAULTS.creativeAutoGenerateEnabled,
    },
    creativeAutoApproveGenerated: {
      type: Boolean,
      default: DEFAULTS.creativeAutoApproveGenerated,
    },

    alerts: { type: alertsSchema, default: () => ({}) },

    // Per-account opt-in. The cron audits ONLY the ad accounts whose ids
    // appear in this list (bare ids, no `act_` prefix — matches the shape
    // returned by GET /meta-ads/get-ad-accounts). Empty list means
    // Autopilot does no work for this user, even with `enabled: true`. We
    // store explicit selection (rather than "all accounts") so a user is
    // never auto-included on a newly-granted ad account.
    selectedAdAccountIds: {
      type: [String],
      default: () => [],
    },

    // Subset of autopilotConfig.js overrides that users can edit from the UI.
    // Shape: { 'act_xxx': { 'AUD-01': { min_spend: 100000 } } }.
    perAccountOverrides: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
  },
  { timestamps: true },
);

/**
 * Return a plain-JS object representing the defaults for a brand-new user.
 * Used by the GET endpoint when no settings doc exists yet — lets the UI
 * render a sensible form without us having to write a row on first read.
 */
function defaultSettings(userId) {
  return {
    userId,
    ...DEFAULTS,
    alerts: {
      slackWebhookUrl: "",
      emailTo: "",
      telegramChatId: "",
      alertOn: ["high"],
    },
    perAccountOverrides: {},
    selectedAdAccountIds: [],
  };
}

module.exports = mongoose.model(
  "AutopilotSettings",
  autopilotSettingsSchema,
);
module.exports.DEFAULTS = DEFAULTS;
module.exports.defaultSettings = defaultSettings;
