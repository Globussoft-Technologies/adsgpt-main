/**
 * Joi schemas for the Google Campaign Template endpoints.
 * `payload` is intentionally loose — the Google wizard form shape varies per
 * objective/channel. Structural validation happens on apply, not on save.
 */
const Joi = require("joi");

const createGoogleTemplateSchema = Joi.object({
  name: Joi.string().trim().min(1).max(120).required(),
  payload: Joi.object().unknown(true).required(),
  // Denormalized for the picker — controller fills from payload if missing.
  objective: Joi.string().optional().allow(""),
  conversionLocation: Joi.string().optional().allow(""),
});

module.exports = {
  createGoogleTemplateSchema,
};
