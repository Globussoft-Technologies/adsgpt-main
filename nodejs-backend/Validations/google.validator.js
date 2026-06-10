const Joi = require("joi");

// UI goal labels (SALES/LEADS/etc.) + raw channel types are both accepted.
// The controller maps UI labels → advertising_channel_type before calling Google.
// APP_PROMOTION maps to MULTI_CHANNEL — supported but only text/image assets, no video.
const GOOGLE_OBJECTIVES = [
  // Google Ads UI goal labels
  "SALES", "LEADS", "WEBSITE_TRAFFIC", "APP_PROMOTION", "LOCAL_STORE",
  "YOUTUBE_REACH",
  // Raw channel types (create without guidance)
  "SEARCH", "DISPLAY", "SHOPPING", "PERFORMANCE_MAX", "VIDEO",
];

const updateGoogleAdStatusSchema = Joi.object({
  level: Joi.string().valid("campaign", "adgroup", "ad").required().messages({
    "any.only": "level must be one of campaign, adgroup, ad",
    "any.required": "level is required",
  }),
  id: Joi.string().required().messages({ "any.required": "id is required" }),
  customerId: Joi.string().when(Joi.ref("adAccountId"), {
    is: Joi.exist(),
    then: Joi.optional(),
    otherwise: Joi.required().messages({ "any.required": "customerId (or adAccountId) is required" }),
  }),
  adAccountId: Joi.string().optional(),
  status: Joi.string().valid("ENABLED", "PAUSED").required().messages({
    "any.only": "status must be ENABLED or PAUSED",
    "any.required": "status is required",
  }),
});

const createCampaignSchema = Joi.object({
  adAccountId: Joi.string().optional(),
  customerId: Joi.string().optional(),

  name: Joi.string().min(2).max(120).required().messages({
    "any.required": "name is required",
    "string.min": "name must be at least 2 characters",
    "string.max": "name must be 120 characters or fewer",
  }),

  objective: Joi.string()
    .valid(...GOOGLE_OBJECTIVES)
    .default("SALES")
    .messages({
      "any.only": `objective must be one of: ${GOOGLE_OBJECTIVES.join(", ")}`,
    }),

  // 1,000,000 micros = ₹1 / $1
  dailyBudgetMicros: Joi.number()
    .integer()
    .min(10000)
    .default(5000000)
    .messages({
      "number.base": "dailyBudgetMicros must be a number",
      "number.min": "dailyBudgetMicros must be at least 10000",
    }),

  status: Joi.string()
    .valid("ENABLED", "PAUSED")
    .default("PAUSED")
    .messages({
      "any.only": "status must be ENABLED or PAUSED",
    }),

  // Scheduling
  startTime: Joi.string()
    .isoDate()
    .optional()
    .messages({
      "string.isoDate": "startTime must be a valid ISO date",
    }),

  endTime: Joi.string()
    .isoDate()
    .optional()
    .messages({
      "string.isoDate": "endTime must be a valid ISO date",
    }),

  // Campaign targeting
  targeting: Joi.object({
    countries: Joi.array()
      .items(Joi.string().length(2).uppercase())
      .optional()
      .messages({
        "string.length": "country code must be 2 characters",
      }),
  }).optional(),

})
  .or("adAccountId", "customerId")
  .messages({
    "object.missing": "adAccountId or customerId is required",
  });

const createAdGroupSchema = Joi.object({
  adAccountId: Joi.string().optional(),
  customerId: Joi.string().optional(),
  campaignId: Joi.string().required().messages({ "any.required": "campaignId is required" }),
  name: Joi.string().min(2).max(120).required().messages({
    "any.required": "name is required",
    "string.min": "name must be at least 2 characters",
    "string.max": "name must be 120 characters or fewer",
  }),
  // cpcBidMicros: max CPC bid in micros (1,000,000 = ₹1 or $1)
  cpcBidMicros: Joi.number().integer().min(10000).default(1000000),
  // bidAmount: alias for cpcBidMicros (in micros)
  bidAmount: Joi.number().integer().min(10000).optional(),
  status: Joi.string().valid("ENABLED", "PAUSED").default("PAUSED"),
  // Scheduling
  startTime: Joi.string().isoDate().optional(),
  endTime: Joi.string().isoDate().optional(),
  // Targeting
  targeting: Joi.object({
    countries: Joi.array().items(Joi.string().length(2).uppercase()).optional(),
    ageMin: Joi.number().integer().min(18).max(65).optional(),
    ageMax: Joi.number().integer().min(18).max(65).optional(),
    genders: Joi.array().items(Joi.string().valid("MALE", "FEMALE")).optional(),
  }).optional(),
}).or("adAccountId", "customerId").messages({
  "object.missing": "adAccountId is required",
});

const adItemSchema = Joi.object({
  // SEARCH fields
  headlines: Joi.array()
    .items(Joi.string().max(30).messages({ "string.max": "Each headline must be 30 characters or fewer" }))
    .min(3).max(15).optional().messages({
      "array.min": "at least 3 headlines are required for SEARCH ads",
      "array.max": "at most 15 headlines are allowed",
    }),
  descriptions: Joi.array()
    .items(Joi.string().max(90).messages({ "string.max": "Each description must be 90 characters or fewer" }))
    .min(2).max(4).optional().messages({
      "array.min": "at least 2 descriptions are required for SEARCH ads",
      "array.max": "at most 4 descriptions are allowed",
    }),
  // DISPLAY fields (max 30) / DEMAND_GEN fields (max 90)
  headline: Joi.string().max(90).optional(),
  description: Joi.string().max(90).optional(),
  businessName: Joi.string().max(25).optional(),
  // Common
  finalUrl: Joi.string().required().messages({
    "any.required": "finalUrl is required in each ad",
  }),
  imageUrl: Joi.string().optional(),
  videoUrl: Joi.string().optional(),
  logoUrl: Joi.string().optional(),
  callToAction: Joi.string().optional(),
});

const createAdSchema = Joi.object({
  adAccountId: Joi.string().optional(),
  customerId: Joi.string().optional(),
  adGroupId: Joi.string().required().messages({ "any.required": "adGroupId is required" }),
  campaignId: Joi.string().optional(),
  ads: Joi.array().items(adItemSchema).min(1).required().messages({
    "any.required": "ads array is required",
    "array.min": "at least one ad is required",
  }),
}).or("adAccountId", "customerId").messages({
  "object.missing": "adAccountId or customerId is required",
});

const deleteGoogleCampaignSchema = Joi.object({
  adAccountId: Joi.string().required().messages({ "any.required": "adAccountId is required" }),
  campaignId: Joi.string().required().messages({ "any.required": "campaignId is required" }),
});

module.exports = {
  updateGoogleAdStatusSchema,
  createCampaignSchema,
  createAdGroupSchema,
  createAdSchema,
  deleteGoogleCampaignSchema,
};
