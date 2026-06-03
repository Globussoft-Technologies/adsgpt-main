const Joi = require("joi");

const updateAdStatusSchema = Joi.object({
  level: Joi.string().valid("campaign", "adset", "ad").required().messages({
    "any.only": "level must be one of campaign, adset, ad",
    "any.required": "level is required",
  }),

  id: Joi.string().required().messages({
    "any.required": "id is required",
  }),

  status: Joi.string().valid("ACTIVE", "PAUSED").required().messages({
    "any.only": "status must be ACTIVE or PAUSED",
    "any.required": "status is required",
  }),
});

const applyFixSchema = Joi.object({
  confirmed: Joi.boolean().valid(true).required().messages({
    "any.only": "confirmed must be true to apply a fix",
    "any.required": "confirmed flag is required",
  }),
  acknowledgeRisk: Joi.boolean().default(false),
  paramOverrides: Joi.object().default({}),
});

// Modern Meta objectives. The legacy set (`LINK_CLICKS`, `CONVERSIONS`, …) is
// rejected by Meta on new campaigns, so we restrict to the outcome-based set.
const META_OBJECTIVES = [
  "OUTCOME_AWARENESS",
  "OUTCOME_TRAFFIC",
  "OUTCOME_ENGAGEMENT",
  "OUTCOME_LEADS",
  "OUTCOME_APP_PROMOTION",
  "OUTCOME_SALES",
];

const SPECIAL_AD_CATEGORIES = [
  "EMPLOYMENT",
  "HOUSING",
  "CREDIT",
  "ISSUES_ELECTIONS_POLITICS",
  "ONLINE_GAMBLING_AND_GAMING",
  "FINANCIAL_PRODUCTS_SERVICES",
];

const BID_STRATEGIES = [
  "LOWEST_COST_WITHOUT_CAP",
  "LOWEST_COST_WITH_BID_CAP",
  "COST_CAP",
  "LOWEST_COST_WITH_MIN_ROAS",
];

const createCampaignSchema = Joi.object({
  adAccountId: Joi.string().required(),
  name: Joi.string().min(2).max(120).required(),
  objective: Joi.string()
    .valid(...META_OBJECTIVES)
    .required(),
  specialAdCategories: Joi.array().items(Joi.string().valid(...SPECIAL_AD_CATEGORIES)).default([]),
  // Campaign Budget Optimization (CBO) — when set, the daily/lifetime budget
  // lives on the campaign and adsets cannot define their own. Both fields are
  // in the account's minor currency unit.
  dailyBudget: Joi.number().integer().min(100).optional(),
  lifetimeBudget: Joi.number().integer().min(100).optional(),
  bidStrategy: Joi.string()
    .valid(...BID_STRATEGIES)
    .optional(),
  status: Joi.string().valid("ACTIVE", "PAUSED").default("PAUSED"),
}).custom((value, helpers) => {
  if (value.dailyBudget && value.lifetimeBudget) {
    return helpers.error("any.invalid", {
      message: "Provide dailyBudget OR lifetimeBudget, not both",
    });
  }
  return value;
});

const createAdSetSchema = Joi.object({
  adAccountId: Joi.string().required(),
  campaignId: Joi.string().required(),
  pageId: Joi.string().required(),
  // Optional Instagram Business/creator account id used to deliver IG
  // placements. When omitted Meta falls back to a shadow account derived
  // from the page.
  instagramActorId: Joi.string().optional().allow(""),
  name: Joi.string().min(2).max(120).required(),
  // dailyBudget / lifetimeBudget are mutually exclusive AND only valid when
  // the campaign is NOT using CBO. Both are in minor currency units.
  dailyBudget: Joi.number().integer().min(100).optional(),
  lifetimeBudget: Joi.number().integer().min(100).optional(),
  billingEvent: Joi.string()
    .valid("IMPRESSIONS", "LINK_CLICKS", "PAGE_LIKES", "POST_ENGAGEMENT", "VIDEO_VIEWS", "THRUPLAY")
    .default("IMPRESSIONS"),
  optimizationGoal: Joi.string()
    .valid(
      "REACH",
      "IMPRESSIONS",
      "LINK_CLICKS",
      "POST_ENGAGEMENT",
      "PAGE_LIKES",
      "LANDING_PAGE_VIEWS",
      "OFFSITE_CONVERSIONS",
      "LEAD_GENERATION",
      "THRUPLAY",
      "VIDEO_VIEWS",
      "APP_INSTALLS",
      "VALUE",
      "QUALITY_LEAD",
      "CONVERSATIONS",
    )
    .default("LINK_CLICKS"),
  bidStrategy: Joi.string()
    .valid(...BID_STRATEGIES)
    .default("LOWEST_COST_WITHOUT_CAP"),
  // Bid amount in minor currency units. Required by Meta whenever
  // bid_strategy is anything other than LOWEST_COST_WITHOUT_CAP — the
  // wizard validates and surfaces this before submit.
  bidAmount: Joi.number().integer().min(1).optional(),
  // destination_type — relevant for Traffic / Engagement / Sales objectives
  // when the conversion location is something other than the default website
  // flow (e.g. MESSENGER, WHATSAPP, CALLS).
  destinationType: Joi.string()
    .valid("WEBSITE", "APP", "MESSENGER", "WHATSAPP", "INSTAGRAM_DIRECT", "PHONE_CALL", "ON_AD")
    .optional(),
  startTime: Joi.date().iso().optional(),
  endTime: Joi.date().iso().optional(),
  // When provided, the saved audience replaces the explicit targeting block.
  savedAudienceId: Joi.string().optional().allow(""),
  targeting: Joi.object({
    countries: Joi.array().items(Joi.string().length(2).uppercase()).default([]),
    worldwide: Joi.boolean().default(false),
    ageMin: Joi.number().integer().min(13).max(65).default(18),
    ageMax: Joi.number().integer().min(13).max(65).default(65),
    // 1 = male, 2 = female. Empty/omit → all genders.
    genders: Joi.array().items(Joi.number().valid(1, 2)).default([]),
    // Meta locale numeric ids (e.g. 6 = English (US), 24 = French, 5 = German).
    locales: Joi.array().items(Joi.number().integer()).default([]),
    advantageAudience: Joi.boolean().default(true),
  }).required(),
  status: Joi.string().valid("ACTIVE", "PAUSED").default("PAUSED"),
}).custom((value, helpers) => {
  if (value.dailyBudget && value.lifetimeBudget) {
    return helpers.error("any.invalid", {
      message: "Provide dailyBudget OR lifetimeBudget, not both",
    });
  }
  if (
    !value.savedAudienceId &&
    !value.targeting.worldwide &&
    (!value.targeting.countries || value.targeting.countries.length === 0)
  ) {
    return helpers.error("any.invalid", {
      message: "Pick at least one country, enable Worldwide, or supply savedAudienceId",
    });
  }
  return value;
});

const deleteCampaignSchema = Joi.object({
  adAccountId: Joi.string().required(),
  campaignId: Joi.string().required(),
});

const createAdSchema = Joi.object({
  adAccountId: Joi.string().required(),
  adSetId: Joi.string().required(),
  pageId: Joi.string().required(),
  instagramActorId: Joi.string().optional().allow(""),
  name: Joi.string().min(2).max(120).required(),
  imageHash: Joi.string().required(),
  headline: Joi.string().allow("").max(255).default(""),
  primaryText: Joi.string().allow("").max(2000).default(""),
  description: Joi.string().allow("").max(255).default(""),
  linkUrl: Joi.string().uri().required(),
  // Optional URL params string (e.g. "utm_source=fb&utm_campaign=spring") —
  // appended by Meta on click via the creative's url_tags.
  urlTags: Joi.string().allow("").max(2000).default(""),
  callToAction: Joi.string()
    .valid(
      "LEARN_MORE",
      "SHOP_NOW",
      "SIGN_UP",
      "SUBSCRIBE",
      "CONTACT_US",
      "DOWNLOAD",
      "BOOK_TRAVEL",
      "GET_QUOTE",
      "APPLY_NOW",
      "GET_OFFER",
      "ORDER_NOW",
      "DONATE_NOW",
      "WATCH_MORE",
      "MESSAGE_PAGE",
      "NO_BUTTON",
    )
    .default("LEARN_MORE"),
  status: Joi.string().valid("ACTIVE", "PAUSED").default("PAUSED"),
});


const generateAdCopySchema = Joi.object({
  prompt: Joi.string().trim().min(3).max(2000).required().messages({
    "string.empty": "prompt is required",
    "string.min": "prompt must be at least 3 characters",
    "string.max": "prompt must be 2000 characters or fewer",
    "any.required": "prompt is required",
  }),
});


module.exports = {
  updateAdStatusSchema,
  applyFixSchema,
  createCampaignSchema,
  createAdSetSchema,
  createAdSchema,
  deleteCampaignSchema,
  generateAdCopySchema,
  META_OBJECTIVES,
  SPECIAL_AD_CATEGORIES,
};
