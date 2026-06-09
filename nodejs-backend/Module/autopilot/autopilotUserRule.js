const mongoose = require("mongoose");

/**
 * autopilotUserRule — user-defined Autopilot rule (v4 architecture).
 *
 * Replaces the old "37 backend audit rules drive everything" model. Each
 * user defines their own rules from a form-based builder, attaches them
 * to specific campaigns, and the cron evaluates ONLY the attached
 * (rule × entity) pairs each tick.
 *
 * Storage shape:
 *   {
 *     userId, name, description, severity,
 *     enabled, evaluateOn,
 *     conditions: { operator: 'AND', rules: [{field, op, value}] },
 *     action: { type: 'pause' | 'alert' },
 *     attachments: [{ adAccountId, campaignId, orphan, orphanedAt }],
 *   }
 *
 * Validation: see `Validations/autopilotUserRule.validator.js`. The
 * Mongoose schema deliberately allows broader values than the validator
 * — Joi is the strict gate at the HTTP layer; Mongoose just persists.
 *
 * Indexes:
 *   { userId: 1, enabled: 1 } — drives the cron's per-user discovery.
 */
const conditionRuleSchema = new mongoose.Schema(
  {
    field: { type: String, required: true },
    op: { type: String, required: true },
    // mongoose.Schema.Types.Mixed because `value` can be number or string
    // depending on the field (numeric metrics vs status enum).
    value: { type: mongoose.Schema.Types.Mixed, required: true },
  },
  { _id: false },
);

const conditionsSchema = new mongoose.Schema(
  {
    operator: {
      type: String,
      enum: ["AND"], // 'OR' deferred to v2
      default: "AND",
    },
    rules: { type: [conditionRuleSchema], default: () => [] },
  },
  { _id: false },
);

const actionSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["pause", "alert"],
      required: true,
    },
  },
  { _id: false },
);

const attachmentSchema = new mongoose.Schema(
  {
    // Both stored canonical: `act_<id>` and bare numeric id respectively.
    adAccountId: { type: String, required: true },
    campaignId: { type: String, required: true },
    // Lazy-detected orphan flag. Cron sets this when the campaign no
    // longer appears in /me/campaigns; UI shows a badge so the user
    // knows the rule isn't acting on this campaign anymore.
    orphan: { type: Boolean, default: false },
    orphanedAt: { type: Date, default: null },
  },
  { _id: false },
);

const autopilotUserRuleSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },

    name: { type: String, required: true, trim: true, maxlength: 80 },
    description: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500,
    },
    severity: {
      type: String,
      enum: ["low", "medium", "high"],
      required: true,
    },

    enabled: { type: Boolean, default: true },

    evaluateOn: {
      type: String,
      enum: ["campaign", "adset", "ad"],
      required: true,
    },

    // How many days of Meta insights to roll up before evaluating this
    // rule. Defaults to 14 to match v3 behaviour. Rules with the same
    // lookbackDays under the same ad account share a single Meta fetch
    // per cron tick (see services/autopilot/userRuleOrchestrator.js).
    lookbackDays: {
      type: Number,
      default: 14,
      min: 1,
      max: 90,
    },

    // Optional preset that overrides the fixed `lookbackDays` window with a
    // dynamic, calendar-aware one resolved at audit time. Currently only
    // `'this_month'` is supported — it computes "days since the 1st of the
    // current month" each cron tick (so the window grows from 1 → 31 across
    // the month and resets on the 1st). Leave null/unset to use the fixed
    // `lookbackDays` value. Kept as a separate field so existing numeric
    // rules continue to validate and so future presets ('this_week',
    // 'last_month', 'ytd', …) drop in without re-encoding the type.
    lookbackPreset: {
      type: String,
      enum: ["this_month", null],
      default: null,
    },

    conditions: { type: conditionsSchema, required: true },
    action: { type: actionSchema, required: true },

    // Schema-level minimum guard. The Joi validator also enforces this
    // and provides better error messages; the schema-level check is
    // a defense-in-depth so direct .create() / .save() can't bypass.
    attachments: {
      type: [attachmentSchema],
      validate: {
        validator: (arr) => Array.isArray(arr) && arr.length >= 1,
        message: "A rule must have at least one attached campaign.",
      },
    },
  },
  { timestamps: true },
);

// Cron-side discovery: find all enabled rules for a user (or globally).
autopilotUserRuleSchema.index({ userId: 1, enabled: 1 });
// Reverse-lookup: "which rules are attached to this campaign?" — used
// when a user manages campaigns from the Ads Manager view.
autopilotUserRuleSchema.index({ "attachments.campaignId": 1 });

module.exports = mongoose.model(
  "AutopilotUserRule",
  autopilotUserRuleSchema,
);
