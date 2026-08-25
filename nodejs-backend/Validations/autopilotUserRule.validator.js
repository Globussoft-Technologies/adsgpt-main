const Joi = require("joi");
// Step bounds live with the rest of the scaling ceilings so the validator,
// the cron and the rule form share one number. See scalePolicy.js for why
// the ceilings above this are engine-owned and not user-editable.
const {
  MIN_RULE_STEP_PCT,
  MAX_RULE_STEP_PCT,
} = require("../services/autopilot/scalePolicy");

/**
 * Validators for the user-defined Autopilot rules feature (v4).
 *
 * Two surfaces:
 *   - createRuleSchema: every required field present (used by POST /rules).
 *   - updateRuleSchema: every field optional but if present must be valid
 *     (used by PATCH /rules/:id). Caller must send at least one field.
 *
 * The field/op enums + per-field-type op restrictions are the strict
 * gate that prevents users from constructing rules the evaluator can't
 * safely run. Adding a new field here is a one-line change but adding
 * one without matching evaluator support will silently no-op the rule.
 */

// ─── canonical surface ─────────────────────────────────────────────────────

// All fields the user can reference in a condition. Mirrors the data
// surface produced by metaAuditService's normalizers (campaign / adset /
// ad rows). When the cron evaluates a rule at a given level, the matching
// normalizer hands the entity to the evaluator; missing fields silently
// fail the condition (rather than throwing).
const NUMERIC_FIELDS = [
  "spend",
  "ctr",
  "cpc",
  "cpm",
  "cpa",
  "cpi",
  "roas",
  "frequency",
  "purchases",
  "installs",
  "clicks",
  "impressions",
  "conversion_rate",
  "engagement_rate",
  "budget_pacing",
  "audience_size",
  "add_to_cart",
  "ad_spend_share",
  "historical_roas",
  "prev_spend",
  "prev_ctr",
  "prev_cpc",
  "prev_cpm",
  "prev_cpa",
  "prev_cpi",
  "prev_installs",
  "prev_roas",
  "prev_conversion_rate",
];

const STRING_FIELDS = [
  "status", // ACTIVE | PAUSED | DELETED | ARCHIVED
  "effective_status",
  "learning_status", // LEARNING | LEARNING_LIMITED | etc.
  "review_status", // APPROVED | DISAPPROVED | PENDING
  "relevance_score", // ABOVE_AVERAGE | AVERAGE | BELOW_AVERAGE
];

const ALL_FIELDS = [...NUMERIC_FIELDS, ...STRING_FIELDS];

const NUMERIC_OPS = [">", "<", ">=", "<=", "==", "!="];
const STRING_OPS = ["==", "!="];

const SEVERITIES = ["low", "medium", "high"];
const ACTION_TYPES = ["pause", "alert", "scale"];
const EVALUATE_ON = ["campaign", "adset", "ad"];

// Hard caps — keep cron cost bounded.
const MAX_ATTACHMENTS = 50;
const MAX_CONDITION_ROWS = 8;
const MAX_NAME = 80;
const MAX_DESCRIPTION = 500;
// Lookback window the rule's metrics are rolled up over. 1 day is the
// minimum sensible window (Meta's daily aggregation); 200 days is the
// upper bound to keep insights API cost predictable. Meta itself allows
// ~37 months, so this is our cap, not theirs — the `maximum` preset is
// the escape hatch for lifetime performance.
const MIN_LOOKBACK_DAYS = 1;
const MAX_LOOKBACK_DAYS = 200;
const DEFAULT_LOOKBACK_DAYS = 14;

// ─── condition row ─────────────────────────────────────────────────────────
//
// `field` and `op` are validated first; `value`'s allowed type is decided
// by the chosen field. Numeric fields demand a finite number; string
// fields demand a non-empty string. We use Joi.alternatives + when() so
// the error message points at the actual mismatch (not a generic "value
// must be number OR string").
const conditionRowSchema = Joi.object({
  field: Joi.string()
    .valid(...ALL_FIELDS)
    .required()
    .messages({
      "any.only": `field must be one of: ${ALL_FIELDS.join(", ")}`,
    }),
  op: Joi.string()
    .when("field", {
      is: Joi.string().valid(...NUMERIC_FIELDS),
      then: Joi.string()
        .valid(...NUMERIC_OPS)
        .required(),
      otherwise: Joi.string()
        .valid(...STRING_OPS)
        .required()
        .messages({
          "any.only": `op for string fields must be one of: ${STRING_OPS.join(", ")}`,
        }),
    })
    .required(),
  value: Joi.any()
    .when("field", {
      is: Joi.string().valid(...NUMERIC_FIELDS),
      then: Joi.number()
        .required()
        .messages({
          "number.base": "value must be a number for numeric fields",
        }),
      otherwise: Joi.string()
        .min(1)
        .required()
        .messages({
          "string.base":
            "value must be a string for status / enum fields",
        }),
    })
    .required(),
});

const conditionsSchema = Joi.object({
  operator: Joi.string().valid("AND").default("AND"),
  rules: Joi.array()
    .items(conditionRowSchema)
    .min(1)
    .max(MAX_CONDITION_ROWS)
    .required()
    .messages({
      "array.min": "A rule needs at least one condition.",
      "array.max": `A rule can have at most ${MAX_CONDITION_ROWS} conditions.`,
    }),
});

const actionSchema = Joi.object({
  type: Joi.string()
    .valid(...ACTION_TYPES)
    .required(),
  // `scale` is the only action carrying a parameter: the SIGNED percent to
  // move the budget by each time the rule fires. Positive scales up,
  // negative scales down; zero is rejected because it is never what anyone
  // meant. One field rather than two action types keeps a single code path,
  // and `pct_change` in the action log carries the direction naturally.
  //
  // Required for scale, REJECTED for the others — a stray `pct` on a pause
  // rule means the author misunderstood the form and should hear about it
  // rather than have it silently ignored.
  //
  // The bound here is on a SINGLE STEP. Everything above it — the 7-day
  // cumulative ratio ceiling, the per-account per-cycle cap, the actions-
  // per-run budget — is engine policy in services/autopilot/scalePolicy.js
  // and services/autopilot/actionBudget.js, and is not user-editable.
  pct: Joi.when("type", {
    is: "scale",
    then: Joi.number()
      .integer()
      .min(-MAX_RULE_STEP_PCT)
      .max(MAX_RULE_STEP_PCT)
      .invalid(0)
      .custom((value, helpers) => {
        if (Math.abs(value) < MIN_RULE_STEP_PCT) {
          return helpers.error("number.tooSmall");
        }
        return value;
      })
      .required()
      .messages({
        "number.max": `A single scale step can be at most ${MAX_RULE_STEP_PCT}%. Autopilot applies it every time the rule fires, so growth compounds — the 7-day ceiling bounds the total.`,
        "number.min": `A single scale step can be at most -${MAX_RULE_STEP_PCT}%.`,
        "number.tooSmall": `A scale step must be at least ${MIN_RULE_STEP_PCT}% in either direction.`,
        "any.invalid": "A scale step of 0% would do nothing. Use a positive percentage to raise the budget, or a negative one to lower it.",
        "any.required": "A scale rule needs a budget change percentage.",
      }),
    otherwise: Joi.forbidden().messages({
      "any.unknown":
        "Only a 'scale' action takes a percentage. Remove it, or change the action to Scale budget.",
    }),
  }),
});

const attachmentSchema = Joi.object({
  // Accept both `act_xxx` and bare numeric forms for adAccountId; the
  // controller normalises to canonical `act_<id>` before persisting.
  adAccountId: Joi.string()
    .pattern(/^(act_)?\d+$/)
    .required()
    .messages({
      "string.pattern.base":
        "adAccountId must be a Meta ad-account id (digits, optionally `act_`-prefixed)",
    }),
  campaignId: Joi.string().pattern(/^\d+$/).required(),
  // Optional: narrow this attachment to a single ad set in that campaign.
  // Absent means the whole campaign (original behaviour).
  adsetId: Joi.string()
    .pattern(/^\d+$/)
    .allow(null)
    .optional()
    .messages({
      "string.pattern.base": "adsetId must be a Meta ad-set id (digits only)",
    }),
  // Orphan flag is set by the cron; the validator allows it to round-trip
  // on PATCH but ignores it on create.
  orphan: Joi.boolean().optional(),
  orphanedAt: Joi.date().allow(null).optional(),
});

// A campaign-level rule attached to a single ad set is a contradiction: the
// attachment says "just this ad set", the level says "score the whole
// campaign". Reject rather than silently reinterpret — a rule that doesn't do
// what its author reads it as doing is worse than one that won't save.
const rejectAdsetWithCampaignLevel = (value, helpers) => {
  if (
    value &&
    value.evaluateOn === "campaign" &&
    Array.isArray(value.attachments) &&
    value.attachments.some((a) => a && a.adsetId)
  ) {
    return helpers.error("rule.adsetWithCampaignLevel");
  }
  return value;
};

const CROSS_FIELD_MESSAGES = {
  "rule.adsetWithCampaignLevel":
    "This rule is attached to a specific ad set, so it can't evaluate at campaign level. Pick Ad set or Ad, or attach the whole campaign instead.",
};

// ─── full schemas ──────────────────────────────────────────────────────────

const createRuleSchema = Joi.object({
  name: Joi.string().trim().min(1).max(MAX_NAME).required(),
  description: Joi.string().trim().min(1).max(MAX_DESCRIPTION).required(),
  severity: Joi.string()
    .valid(...SEVERITIES)
    .required(),
  enabled: Joi.boolean().default(true),
  evaluateOn: Joi.string()
    .valid(...EVALUATE_ON)
    .required(),
  lookbackDays: Joi.number()
    .integer()
    .min(MIN_LOOKBACK_DAYS)
    .max(MAX_LOOKBACK_DAYS)
    .default(DEFAULT_LOOKBACK_DAYS),
  // Optional. Overrides `lookbackDays` with a dynamic window: this month
  // or all lifetime data available through Meta's `maximum` preset.
  lookbackPreset: Joi.string().valid("this_month", "maximum").allow(null),
  conditions: conditionsSchema.required(),
  action: actionSchema.required(),
  // Opt-in reversal of this rule's own pauses. Unlike `action.pct` this is
  // NOT forbidden on non-pause rules: it is inert rather than wrong there,
  // and keeping it lets an author flip a rule between actions without losing
  // the setting. See the model for why this is per-rule at all.
  autoResume: Joi.boolean().default(false),
  attachments: Joi.array()
    .items(attachmentSchema)
    .min(1)
    .max(MAX_ATTACHMENTS)
    .required()
    .messages({
      "array.min":
        "A rule must be attached to at least one campaign.",
      "array.max": `A rule can be attached to at most ${MAX_ATTACHMENTS} campaigns.`,
    }),
})
  .custom(rejectAdsetWithCampaignLevel)
  .messages(CROSS_FIELD_MESSAGES);

// PATCH semantics: every field optional, but body must contain at least
// one. The .min(1) on the wrapper is what enforces "no empty patches".
const updateRuleSchema = Joi.object({
  name: Joi.string().trim().min(1).max(MAX_NAME),
  description: Joi.string().trim().min(1).max(MAX_DESCRIPTION),
  severity: Joi.string().valid(...SEVERITIES),
  enabled: Joi.boolean(),
  evaluateOn: Joi.string().valid(...EVALUATE_ON),
  lookbackDays: Joi.number()
    .integer()
    .min(MIN_LOOKBACK_DAYS)
    .max(MAX_LOOKBACK_DAYS),
  lookbackPreset: Joi.string().valid("this_month", "maximum").allow(null),
  conditions: conditionsSchema,
  action: actionSchema,
  autoResume: Joi.boolean(),
  attachments: Joi.array()
    .items(attachmentSchema)
    .min(1)
    .max(MAX_ATTACHMENTS)
    .messages({
      "array.min":
        "A rule must remain attached to at least one campaign.",
    }),
})
  .min(1)
  // Only checkable when the patch carries BOTH fields; a patch that changes
  // one of them alone is validated against the stored rule in the controller.
  .custom(rejectAdsetWithCampaignLevel)
  .messages({
    "object.min":
      "PATCH body must contain at least one field to update.",
    ...CROSS_FIELD_MESSAGES,
  });

module.exports = {
  createRuleSchema,
  updateRuleSchema,
  // exported for tests + frontend metadata endpoint
  NUMERIC_FIELDS,
  STRING_FIELDS,
  NUMERIC_OPS,
  STRING_OPS,
  SEVERITIES,
  ACTION_TYPES,
  EVALUATE_ON,
  MAX_ATTACHMENTS,
  MAX_CONDITION_ROWS,
  MIN_LOOKBACK_DAYS,
  MAX_LOOKBACK_DAYS,
  DEFAULT_LOOKBACK_DAYS,
};
