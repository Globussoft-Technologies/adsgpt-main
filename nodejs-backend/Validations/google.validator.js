const Joi = require("joi");

// UI goal labels (SALES/LEADS/etc.) + raw channel types are both accepted.
// The controller maps UI labels → advertising_channel_type before calling Google.
// APP_PROMOTION maps to MULTI_CHANNEL — supported but only text/image assets, no video.
const GOOGLE_OBJECTIVES = [
  // Google Ads UI goal labels
  "SALES", "LEADS", "WEBSITE_TRAFFIC", "APP_PROMOTION", "LOCAL_STORE",
  "YOUTUBE_REACH",
  // Raw channel types (create without guidance)
  "SEARCH", "DISPLAY", "SHOPPING", "PERFORMANCE_MAX", "VIDEO", "DEMAND_GEN", "MULTI_CHANNEL",
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
  adGroupId: Joi.string().optional(),
  entityType: Joi.string().optional(),
  isPmax: Joi.boolean().optional(),
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
  dailyBudgetMicros: Joi.number().integer().min(10000).optional().messages({
    "number.base": "Daily budget must be a valid number.",
    "number.min": "Daily budget must be at least ₹0.01 per day.",
  }),
  lifetimeBudgetMicros: Joi.number().integer().min(10000).optional().messages({
    "number.base": "Lifetime budget must be a valid number.",
    "number.min": "Lifetime budget must be at least ₹0.01.",
  }),
  budgetType: Joi.string().valid("DAILY", "CAMPAIGN_TOTAL").default("DAILY"),

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

  // EU Political Advertising Transparency Regulation compliance flag
  euPoliticalAds: Joi.boolean().default(false),

  // Objective-specific extras (stored + passed to Google API where supported)
  objectiveExtras: Joi.object({
    // SHOPPING
    merchantCenterId:    Joi.string().optional(),
    productCategory:     Joi.string().optional(),
    // APP_PROMOTION
    appStoreUrl:         Joi.string().uri().optional(),
    appPlatform:         Joi.string().valid("ANDROID", "IOS").optional(),
    appId:               Joi.string().optional(),
    appSubtype:          Joi.string().valid("APP_INSTALLS", "APP_ENGAGEMENT", "APP_PRE_REGISTRATION").optional(),
    // LOCAL_STORE
    storeAddress:        Joi.string().optional(),
    locationRadius:      Joi.number().min(1).optional(),
    // PERFORMANCE_MAX
    assetGroupName:      Joi.string().optional(),
    businessDescription: Joi.string().optional(),
    finalUrlSuffix:      Joi.string().optional(),
    finalUrl:            Joi.string().uri().optional(),
    pmaxBusinessName:    Joi.string().optional(),
    pmaxHeadlines:       Joi.array().items(Joi.string().allow('')).optional(),
    pmaxLongHeadline:    Joi.string().optional(),
    pmaxDescriptions:    Joi.array().items(Joi.string().allow('')).optional(),
    pmaxImageUrl:        Joi.string().optional(),
    pmaxImageAssetRN:       Joi.string().optional(),
    pmaxSquareImageAssetRN: Joi.string().optional(),
    pmaxLogoUrl:         Joi.string().optional(),
    pmaxLogoAssetRN:     Joi.string().optional(),
    pmaxVideoUrl:        Joi.string().optional(),
    pmaxSearchThemes:    Joi.alternatives().try(Joi.array().items(Joi.string()), Joi.string()).optional(),
    // VIDEO / YOUTUBE_REACH / DEMAND_GEN
    videoGoal:           Joi.string().valid("VIDEO_VIEWS", "REACH", "YOUTUBE_SUBSCRIPTIONS").optional(),
    videoSubtype:        Joi.string().valid("VIDEO_VIEWS", "EFFICIENT_REACH", "NON_SKIPPABLE_REACH", "TARGET_FREQUENCY").optional(),
  }).unknown(true).optional(),

})
  .or("adAccountId", "customerId")
  .messages({
    "object.missing": "adAccountId or customerId is required",
  })
  .custom((value, helpers) => {
    const { objective, objectiveExtras } = value;
    if (objective === "SHOPPING" && !objectiveExtras?.merchantCenterId) {
      return helpers.error("any.custom", { message: "merchantCenterId is required for SHOPPING campaigns" });
    }
    if (objective === "APP_PROMOTION") {
      if (!objectiveExtras?.appStoreUrl) {
        return helpers.error("any.custom", { message: "appStoreUrl is required for APP_PROMOTION campaigns" });
      }
      try { new URL(objectiveExtras.appStoreUrl); } catch {
        return helpers.error("any.custom", { message: "appStoreUrl must be a valid URI" });
      }
    }
    if (objective === "LOCAL_STORE" && !objectiveExtras?.storeAddress) {
      return helpers.error("any.custom", { message: "storeAddress is required for LOCAL_STORE campaigns" });
    }
    if (objective === "PERFORMANCE_MAX" && !objectiveExtras?.assetGroupName) {
      return helpers.error("any.custom", { message: "assetGroupName is required for PERFORMANCE_MAX campaigns" });
    }
    return value;
  })
  .messages({ "any.custom": "{{#message}}" });

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
    genders: Joi.array().items(Joi.string().valid("MALE", "FEMALE", "UNDETERMINED")).optional(),
  }).optional(),

  // Bidding goal (SEARCH / LEADS / SALES campaigns)
  biddingGoal: Joi.string()
    .valid("MAXIMIZE_CLICKS", "MAXIMIZE_CONVERSIONS", "TARGET_CPA", "TARGET_ROAS")
    .optional(),
  targetCpaMicros: Joi.number().integer().min(1).optional(),
  targetRoas:      Joi.number().min(0).optional(),

  // Keywords (SEARCH type campaigns)
  keywords: Joi.array().items(
    Joi.object({
      text:      Joi.string().min(1).required(),
      matchType: Joi.string().valid("BROAD", "PHRASE", "EXACT").default("BROAD"),
    })
  ).optional(),

  // Video format (DEMAND_GEN / VIDEO campaigns)
  videoFormat: Joi.string()
    .valid("SKIPPABLE_IN_STREAM", "NON_SKIPPABLE_IN_STREAM", "BUMPER")
    .optional(),

  // Frequency cap (DISPLAY campaigns)
  frequencyCap: Joi.number().integer().min(1).optional(),

  // PERFORMANCE_MAX asset group fields
  assetGroupName:         Joi.string().optional(),
  finalUrl:               Joi.string().uri().optional(),
  businessDescription:    Joi.string().optional(),
  pmaxBusinessName:       Joi.string().optional(),
  pmaxHeadlines:          Joi.array().items(Joi.string().allow('')).optional(),
  pmaxLongHeadline:       Joi.string().optional(),
  pmaxDescriptions:       Joi.array().items(Joi.string().allow('')).optional(),
  pmaxImageUrl:           Joi.string().optional(),
  pmaxImageAssetRN:       Joi.string().optional(),
  pmaxSquareImageAssetRN: Joi.string().optional(),
  pmaxLogoUrl:            Joi.string().optional(),
  pmaxLogoAssetRN:        Joi.string().optional(),
  pmaxVideoUrl:           Joi.string().optional(),
}).or("adAccountId", "customerId")
  .messages({ "object.missing": "adAccountId is required" })
  .custom((value, helpers) => {
    if (value.biddingGoal === "TARGET_CPA" && (value.targetCpaMicros == null)) {
      return helpers.error("any.custom", { message: "targetCpaMicros is required when biddingGoal is TARGET_CPA" });
    }
    if (value.biddingGoal === "TARGET_ROAS" && (value.targetRoas == null)) {
      return helpers.error("any.custom", { message: "targetRoas is required when biddingGoal is TARGET_ROAS" });
    }
    return value;
  })
  .messages({ "any.custom": "{{#message}}" });

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
  headline:     Joi.string().max(90).optional().messages({ "string.max": "Headline must be 90 characters or fewer" }),
  longHeadline: Joi.string().max(90).optional().messages({ "string.max": "Long headline must be 90 characters or fewer" }),
  description:  Joi.string().max(90).optional().messages({ "string.max": "Description must be 90 characters or fewer. Please shorten your description and try again." }),
  businessName: Joi.string().max(25).optional().messages({ "string.max": "Business name must be 25 characters or fewer" }),
  // Common
  finalUrl: Joi.string().required().messages({
    "any.required": "finalUrl is required in each ad",
  }),
  imageUrl:            Joi.string().optional(),
  assetResourceName:   Joi.string().optional(),
  squareAssetResourceName: Joi.string().optional(),
  videoUrl:            Joi.string().optional(),
  youtubeVideoId:      Joi.string().max(11).optional(),
  logoUrl:             Joi.string().optional(),
  callToAction:        Joi.string().optional(),
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
