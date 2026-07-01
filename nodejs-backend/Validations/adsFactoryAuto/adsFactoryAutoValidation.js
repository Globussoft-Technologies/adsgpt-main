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
  template: Joi.object({
    name: Joi.string().trim().required(),
    objective: Joi.string().allow("", null).optional(),
    conversionLocation: Joi.string().allow("", null).optional(),
    pageId: Joi.string().allow("", null).optional(),
    payload: Joi.object().required(),
  }).optional(),
});

const googleTargetSchema = Joi.object({
  template: Joi.object({
    name: Joi.string().trim().required(),
    objective: Joi.string().allow("", null).optional(),
    conversionLocation: Joi.string().allow("", null).optional(),
    customerId: Joi.string().allow("", null).optional(),
    payload: Joi.object().required(),
  }).optional(),
});

const targetsSchema = Joi.object({
  meta:   metaTargetSchema.optional(),
  google: googleTargetSchema.optional(),
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

  targets: targetsSchema.optional(),
});

// ─── updateJobSchema ──────────────────────────────────────────────────────────

const updateJobSchema = Joi.object({
  campaignId:     Joi.string().pattern(/^[a-f\d]{24}$/i).messages({ "string.pattern.base": "campaignId must be a valid MongoDB ObjectId" }),
  schedule:       scheduleSchema,
  pairsPerCycle:  Joi.number().integer().min(1).max(200),
  model:          Joi.string().allow("", null),
  targets:        targetsSchema,
}).min(1);

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  createJobSchema,
  updateJobSchema,
};
