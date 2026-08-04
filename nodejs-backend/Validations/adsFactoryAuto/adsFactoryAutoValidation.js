const Joi = require("joi");

// ─── scheduleSchema ───────────────────────────────────────────────────────────

const customFrequencySchema = Joi.object({
  repeatEvery:  Joi.number().integer().min(1).default(1),
  repeatUnit:   Joi.string().valid("day", "week").default("week"),
  repeatOnDays: Joi.array().items(Joi.string()).default([]),
});

const scheduleSchema = Joi.object({
  frequency:       Joi.string().required(),
  startDate:       Joi.date().iso().optional().allow(null),
  endDate:         Joi.date().iso().optional().allow(null),
  timezone:        Joi.string().valid(...Intl.supportedValuesOf("timeZone")).default("UTC"),
  hour:            Joi.number().integer().min(0).max(23).default(0),
  customFrequency: Joi.when("frequency", {
    is:        "custom",
    then:      customFrequencySchema.required(),
    otherwise: customFrequencySchema.optional(),
  }),
}).custom((value, helpers) => {
  if (value.startDate && value.endDate && new Date(value.endDate) <= new Date(value.startDate)) {
    return helpers.error("any.invalid", { message: "endDate must be greater than startDate" });
  }
  return value;
}).messages({ "any.invalid": "{{#message}}" });

// ─── Platform target schemas ──────────────────────────────────────────────────

const metaTargetSchema = Joi.object({
  facebookId: Joi.string().trim().required(),
  connectionId: Joi.string().length(24).hex().required(),
  template: Joi.object({
    name: Joi.string().trim().required(),
    objective: Joi.string().allow("", null).optional(),
    conversionLocation: Joi.string().allow("", null).optional(),
    pageId: Joi.string().allow("", null).optional(),
    payload: Joi.object().required(),
  }).required(),
});

const googleTargetSchema = Joi.object({
  template: Joi.object({
    name: Joi.string().trim().required(),
    objective: Joi.string().allow("", null).optional(),
    conversionLocation: Joi.string().allow("", null).optional(),
    customerId: Joi.string().allow("", null).optional(),
    payload: Joi.object().required(),
  }).required(),
});

const targetsSchema = Joi.object({
  meta:   metaTargetSchema.optional(),
  google: googleTargetSchema.optional(),
}).min(1).required();

// ─── Update-only target schemas ───────────────────────────────────────────────
// Editing a job must NOT be able to rename the campaign or swap the template
// wholesale — the campaign/ad group/ad were already created (or will be) from
// the original template. Only budget, CTA, and destination link are editable
// after the job is created; schedule and pairsPerCycle are handled separately.

// Accepts the full template shape (frontend can send back the whole job
// object it already has) — payload keys are NOT whitelisted here. The
// controller diffs incoming vs. saved values field-by-field: editable fields
// (see EDITABLE_*_PAYLOAD_FIELDS below) may change freely; any other field
// that differs from the saved value is rejected with a named error. Fields
// echoed back unchanged are silently accepted either way.
const EDITABLE_META_PAYLOAD_FIELDS   = ["dailyBudget", "lifetimeBudget", "adSetBudget", "spendCap", "callToAction", "linkUrl"];
const EDITABLE_GOOGLE_PAYLOAD_FIELDS = ["dailyBudget", "dailyBudgetMicros", "lifetimeBudget", "cpcBid", "callToAction", "linkUrl", "finalUrl"];

const updateTargetsSchema = Joi.object({
  meta: Joi.object({
    facebookId: Joi.string().trim().optional(),
    connectionId: Joi.string().length(24).hex().optional(),
    template: Joi.object({
      name:               Joi.string().trim().optional(),
      objective:          Joi.string().allow("", null).optional(),
      conversionLocation: Joi.string().allow("", null).optional(),
      pageId:             Joi.string().allow("", null).optional(),
      payload:            Joi.object().required(),
    }).required(),
  }).optional(),
  google: Joi.object({
    template: Joi.object({
      name:               Joi.string().trim().optional(),
      objective:          Joi.string().allow("", null).optional(),
      conversionLocation: Joi.string().allow("", null).optional(),
      customerId:         Joi.string().allow("", null).optional(),
      payload:            Joi.object().required(),
    }).required(),
  }).optional(),
}).min(1);

// ─── alertsSchema ─────────────────────────────────────────────────────────────
// Per-job cycle-complete email recipients. emailTo is a comma-separated list of
// up to 5 addresses, stored as a single string and split at send-time by
// adsFactoryAlertService.parseEmailRecipients. Same tokenize→trim→cap→validate
// rule as the Meta Autopilot's autopilotSettings validator. Empty = no email.
const alertsSchema = Joi.object({
  emailTo: Joi.string()
    .allow("")
    .custom((value, helpers) => {
      if (!value) return value;
      const parts = String(value)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (parts.length > 5) {
        return helpers.error("emailTo.tooMany", { count: parts.length });
      }
      const emailValidator = Joi.string().email({ tlds: false });
      for (const p of parts) {
        const { error } = emailValidator.validate(p);
        if (error) return helpers.error("emailTo.invalid", { bad: p });
      }
      return value;
    })
    .messages({
      "emailTo.invalid":
        "alerts.emailTo must be a comma-separated list of valid email addresses (invalid: {#bad})",
      "emailTo.tooMany":
        "alerts.emailTo accepts up to 5 addresses (got {#count}). Trim the list or use a distribution group.",
    }),
});

// ─── createJobSchema ──────────────────────────────────────────────────────────

const createJobSchema = Joi.object({
  campaignId: Joi.string()
    .pattern(/^[a-f\d]{24}$/i)
    .required()
    .messages({ "string.pattern.base": "campaignId must be a valid MongoDB ObjectId" }),

  schedule: scheduleSchema.required(),

  pairsPerCycle: Joi.number().integer().min(1).max(200).default(1),

  model: Joi.string().allow("", null).optional(),

  targets: targetsSchema.required(),

  alerts: alertsSchema.optional(),
});

// ─── updateJobSchema ──────────────────────────────────────────────────────────

const updateJobSchema = Joi.object({
  schedule:       scheduleSchema,
  pairsPerCycle:  Joi.number().integer().min(1).max(200),
  model:          Joi.string().allow("", null),
  // Restricted — cannot rename the campaign or replace the template. Only
  // budget, CTA, and destination link are editable; see updateTargetsSchema.
  targets:        updateTargetsSchema,
  alerts:         alertsSchema,
}).min(1);

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  createJobSchema,
  updateJobSchema,
  EDITABLE_META_PAYLOAD_FIELDS,
  EDITABLE_GOOGLE_PAYLOAD_FIELDS,
};
