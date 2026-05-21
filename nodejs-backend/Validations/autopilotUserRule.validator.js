const Joi = require("joi");

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
const ACTION_TYPES = ["pause", "alert"];
const EVALUATE_ON = ["campaign", "adset", "ad"];

// Hard caps — keep cron cost bounded.
const MAX_ATTACHMENTS = 50;
const MAX_CONDITION_ROWS = 8;
const MAX_NAME = 80;
const MAX_DESCRIPTION = 500;
// Lookback window the rule's metrics are rolled up over. 1 day is the
// minimum sensible window (Meta's daily aggregation); 90 days is the
// upper bound to keep insights API cost predictable.
const MIN_LOOKBACK_DAYS = 1;
const MAX_LOOKBACK_DAYS = 90;
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
  // Orphan flag is set by the cron; the validator allows it to round-trip
  // on PATCH but ignores it on create.
  orphan: Joi.boolean().optional(),
  orphanedAt: Joi.date().allow(null).optional(),
});

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
  conditions: conditionsSchema.required(),
  action: actionSchema.required(),
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
});

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
  conditions: conditionsSchema,
  action: actionSchema,
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
  .messages({
    "object.min":
      "PATCH body must contain at least one field to update.",
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
