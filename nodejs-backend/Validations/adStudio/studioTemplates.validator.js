const Joi = require('joi');

// GET /adsgpt/ad-studio/templates — see services/adStudio/studioTemplates.js.
const getStudioTemplatesQuery = Joi.object({
  brandId: Joi.string().trim().min(1).max(200).required(),
  media: Joi.string().valid('image', 'video').required(),
  // `refresh=1` / `refresh=true` bypasses the 10-minute cache (the ↻ button).
  refresh: Joi.boolean().truthy('1').falsy('0').default(false),
  // Video infinite scroll: how many are already loaded. Ignored for image.
  skip: Joi.number().integer().min(0).max(500).default(0),
});

const validateStudioTemplatesQuery = (req, res, next) => {
  const { error, value } = getStudioTemplatesQuery.validate(req.query, {
    abortEarly: false,
    stripUnknown: true,
  });

  if (error) {
    return res.status(400).json({
      message: 'Invalid template request',
      details: error.details.map((detail) => detail.message),
    });
  }

  req.validatedQuery = value;
  return next();
};

// POST /adsgpt/ad-studio/templates/generate — see services/adStudio/studioImageRender.js.
// Model/aspect/quality combinations are checked again in the service against
// DS's per-model lists; this only guards the shape.
const httpUrl = Joi.string().uri({ scheme: ['http', 'https'] });
// Like onboarding's Recreate: no model / ratio / quality — DS's default renders
// it and the price is fixed (ADS-R003). The brand supplies product_description.
const generateStudioImageBody = Joi.object({
  brandId: Joi.string().trim().min(1).max(200).required(),
  templateId: Joi.string().trim().min(1).max(200).required(),
  templateUrl: httpUrl.required(),
  // The product(s) — 1..3 public URLs (the client uploads files to S3 first).
  productImageUrls: Joi.array().items(httpUrl).min(1).max(3).unique().required(),
  prompt: Joi.string().allow('').trim().max(2000).default(''),
});

const validateGenerateStudioImage = (req, res, next) => {
  const { error, value } = generateStudioImageBody.validate(req.body, {
    abortEarly: false,
    stripUnknown: true,
  });
  if (error) {
    return res.status(400).json({
      message: 'Invalid generate request',
      details: error.details.map((detail) => detail.message),
      user_message: 'Please check your inputs and try again.',
    });
  }
  req.validatedBody = value;
  return next();
};

module.exports = { validateStudioTemplatesQuery, validateGenerateStudioImage };
