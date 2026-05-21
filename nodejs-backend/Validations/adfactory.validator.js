const Joi = require("joi");

const brandInfoSchema = Joi.object({
  brandId: Joi.string().allow('').optional(),
  brandName: Joi.string().required(),
  brandDescription: Joi.string().required(),
  brandLogo: Joi.array().items(Joi.string()),
  brandVoice: Joi.array().items(Joi.string().required()).min(1).required(),
  category: Joi.string().allow('').optional(),
  brandGuidelines: Joi.object({
    toneOfVoice: Joi.string().allow('').optional(),
    dos: Joi.array().items(Joi.string().allow('')).optional(),
    donts: Joi.array().items(Joi.string().allow('')).optional(),
    colorPalette: Joi.array()
      .items(Joi.string().required())
      .min(1)
      .required(),
  }).optional(),
});

const objectivesSchema = Joi.object({
  primaryObjective: Joi.string().required(),
  promotionalInfo: Joi.array().items(Joi.string().allow('')).optional(),
  coreIdea: Joi.string().allow('').optional(),
  callToAction: Joi.array().items(Joi.string().optional()),
  additionalGuidelines: Joi.string().allow('').optional(),
  targetAudience: Joi.array().items(Joi.string().required()).min(1).required(),
});

const assetsSchema = Joi.object({
  keyVisuals: Joi.object({
    type: Joi.string().valid("image", "video", "svg", "gif").required(),
    urls: Joi.array().items(Joi.string().uri()).required(),
  }).optional(),
});

const distributionSchema = Joi.object({
  platforms: Joi.array()
    .items(
      Joi.object({
        platformName: Joi.string().required(),
        creativeRatios: Joi.array().items(Joi.string()).required(),
      })
    )
    .required(),
});

const servicesSchema = Joi.object({
  servicesSelected: Joi.array()
    .items(
      Joi.object({
        serviceName: Joi.string().valid("text", "image", "video").required(),

        serviceParams: Joi.object({
          quantity: Joi.number().required(),
          model: Joi.string().required(),
        }).required(),
      })
    )
    .min(1)
    .required(),
});
const creativesSchema = Joi.object({
  creativeId: Joi.string().required(),
  imageUrl: Joi.string().uri().required(),
  headline: Joi.string().required(),
  message: Joi.string().required(),
  linkUrl: Joi.string()
    .uri()
    .required()
    .messages({
      "string.uri": "CTA link must be a valid URL",
      "string.empty": "CTA link cannot be empty",
      "any.required": "CTA link is required"
    }),
  callToAction: Joi.string().required(),
  description: Joi.string().allow("").optional(),
  platform: Joi.string().allow("").optional(),
}).required();






exports.adFactoryValidators = {
  brandInfo: brandInfoSchema,
  objectives: objectivesSchema,
  assets: assetsSchema,
  distribution: distributionSchema,
  services: servicesSchema,
  creatives: creativesSchema,
};