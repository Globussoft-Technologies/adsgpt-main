/**
 * Joi schemas for the TikTok Campaign Template endpoints. The `payload` field
 * is intentionally loose (any object) — it mirrors the wizard's `form`
 * snapshot, which varies per objective. The wizard's own per-cell validator
 * runs on apply (when the user launches from a template), so structural
 * correctness is enforced at the point it matters, not on save.
 */
const Joi = require("joi");

const createTemplateSchema = Joi.object({
  name: Joi.string().trim().min(1).max(120).required(),
  // The wizard `form` snapshot. Loose by design — see file comment above.
  payload: Joi.object().unknown(true).required(),
  // Denormalized from payload for the picker — optional, the controller fills
  // them from payload if missing.
  objective: Joi.string().optional().allow(""),
  conversionLocation: Joi.string().optional().allow(""),
});

module.exports = {
  createTemplateSchema,
};
