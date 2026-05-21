const Joi = require("joi");

const BUDGET_MIN_MULTIPLIER = 0.3;
const BUDGET_MAX_MULTIPLIER = 3;

const LEVEL_ENUM = ["campaign", "adset", "ad"];

const OPTIMIZATION_GOALS = [
  "NONE",
  "APP_INSTALLS",
  "AD_RECALL_LIFT",
  "ENGAGED_USERS",
  "EVENT_RESPONSES",
  "IMPRESSIONS",
  "LEAD_GENERATION",
  "QUALITY_LEAD",
  "LINK_CLICKS",
  "OFFSITE_CONVERSIONS",
  "PAGE_LIKES",
  "POST_ENGAGEMENT",
  "QUALITY_CALL",
  "REACH",
  "LANDING_PAGE_VIEWS",
  "VISIT_INSTAGRAM_PROFILE",
  "VALUE",
  "THRUPLAY",
  "DERIVED_EVENTS",
  "APP_INSTALLS_AND_OFFSITE_CONVERSIONS",
  "CONVERSATIONS",
  "IN_APP_VALUE",
  "MESSAGING_PURCHASE_CONVERSION",
  "SUBSCRIBERS",
  "REMINDERS_SET",
  "MEANINGFUL_CALL_ATTEMPT",
  "PROFILE_VISIT",
];

const actions = {
  PAUSE_ENTITY: {
    risk: "low",
    reversible: true,
    entities: ["campaign", "adset", "ad"],
    paramsSchema: Joi.object({
      level: Joi.string()
        .valid(...LEVEL_ENUM)
        .required(),
      id: Joi.string().required(),
    }),
    describeForLLM:
      "PAUSE_ENTITY — params: { level: campaign|adset|ad, id: string }",
  },

  ACTIVATE_ENTITY: {
    risk: "low",
    reversible: true,
    entities: ["campaign", "adset", "ad"],
    paramsSchema: Joi.object({
      level: Joi.string()
        .valid(...LEVEL_ENUM)
        .required(),
      id: Joi.string().required(),
    }),
    describeForLLM:
      "ACTIVATE_ENTITY — params: { level: campaign|adset|ad, id: string }",
  },

  ADJUST_BUDGET: {
    risk: "medium",
    reversible: true,
    entities: ["campaign", "adset"],
    paramsSchema: Joi.object({
      level: Joi.string().valid("campaign", "adset").required(),
      id: Joi.string().required(),
      new_daily_budget: Joi.number().positive(),
      new_lifetime_budget: Joi.number().positive(),
    }).or("new_daily_budget", "new_lifetime_budget"),
    describeForLLM:
      "ADJUST_BUDGET — params: { level: campaign|adset, id, new_daily_budget (in minor units, cents) OR new_lifetime_budget }. Budget will be clamped between 0.3x and 3x the current value for safety.",
  },

  ADJUST_BID: {
    risk: "medium",
    reversible: true,
    entities: ["adset"],
    paramsSchema: Joi.object({
      adset_id: Joi.string().required(),
      new_bid_amount: Joi.number().positive().required(),
    }),
    describeForLLM:
      "ADJUST_BID — params: { adset_id, new_bid_amount (minor units) }",
  },

  NARROW_AUDIENCE: {
    risk: "high",
    reversible: true,
    entities: ["adset"],
    paramsSchema: Joi.object({
      adset_id: Joi.string().required(),
      targeting_patch: Joi.object().required(),
    }),
    describeForLLM:
      "NARROW_AUDIENCE — params: { adset_id, targeting_patch: Meta targeting spec fragment (e.g., age_min, age_max, geo_locations, interests) }",
  },

  BROADEN_AUDIENCE: {
    risk: "high",
    reversible: true,
    entities: ["adset"],
    paramsSchema: Joi.object({
      adset_id: Joi.string().required(),
      targeting_patch: Joi.object().required(),
    }),
    describeForLLM:
      "BROADEN_AUDIENCE — params: { adset_id, targeting_patch: Meta targeting spec fragment to merge }",
  },

  EXTEND_SCHEDULE: {
    risk: "low",
    reversible: true,
    entities: ["campaign", "adset"],
    paramsSchema: Joi.object({
      level: Joi.string().valid("campaign", "adset").required(),
      id: Joi.string().required(),
      new_stop_time: Joi.string().isoDate().required(),
    }),
    describeForLLM:
      "EXTEND_SCHEDULE — params: { level: campaign|adset, id, new_stop_time: ISO 8601 datetime in the future }",
  },

  END_EARLY: {
    risk: "medium",
    reversible: true,
    entities: ["campaign", "adset"],
    paramsSchema: Joi.object({
      level: Joi.string().valid("campaign", "adset").required(),
      id: Joi.string().required(),
      new_stop_time: Joi.string().isoDate().required(),
    }),
    describeForLLM:
      "END_EARLY — params: { level: campaign|adset, id, new_stop_time: ISO 8601 (must be sooner than current stop_time) }",
  },

  CHANGE_OPTIMIZATION_GOAL: {
    risk: "high",
    reversible: true,
    entities: ["adset"],
    paramsSchema: Joi.object({
      adset_id: Joi.string().required(),
      new_goal: Joi.string()
        .valid(...OPTIMIZATION_GOALS)
        .required(),
    }),
    describeForLLM: `CHANGE_OPTIMIZATION_GOAL — params: { adset_id, new_goal: one of ${OPTIMIZATION_GOALS.join(", ")} }. Resets learning phase.`,
  },

  DUPLICATE_AND_MODIFY: {
    risk: "medium",
    reversible: false,
    entities: ["campaign", "adset", "ad"],
    paramsSchema: Joi.object({
      source_level: Joi.string()
        .valid(...LEVEL_ENUM)
        .required(),
      source_id: Joi.string().required(),
      overrides: Joi.object().default({}),
    }),
    describeForLLM:
      "DUPLICATE_AND_MODIFY — params: { source_level: campaign|adset|ad, source_id, overrides: object of fields to change on the copy (e.g., { name, daily_budget }) }",
  },

  SWAP_CREATIVE: {
    risk: "medium",
    reversible: true,
    entities: ["ad"],
    paramsSchema: Joi.object({
      ad_id: Joi.string().required(),
      new_creative_id: Joi.string().required(),
    }),
    describeForLLM:
      "SWAP_CREATIVE — params: { ad_id, new_creative_id (must exist in the same ad account) }",
  },
};

const ALLOWED_ACTION_TYPES = Object.keys(actions);

function getAction(action_type) {
  return actions[action_type] || null;
}

function validateFixParams(action_type, params) {
  const action = getAction(action_type);
  if (!action) return { error: `Unknown action_type: ${action_type}` };
  const { error, value } = action.paramsSchema.validate(params, {
    abortEarly: false,
    stripUnknown: true,
  });
  if (error) return { error: error.details.map((d) => d.message).join("; ") };
  return { value };
}

function clampBudget(requested, current) {
  if (!current || current <= 0) return requested;
  const min = current * BUDGET_MIN_MULTIPLIER;
  const max = current * BUDGET_MAX_MULTIPLIER;
  return Math.max(min, Math.min(max, requested));
}

function buildLLMActionCatalog() {
  return Object.entries(actions)
    .map(([name, cfg]) => `- ${cfg.describeForLLM} [risk: ${cfg.risk}]`)
    .join("\n");
}

module.exports = {
  actions,
  ALLOWED_ACTION_TYPES,
  OPTIMIZATION_GOALS,
  BUDGET_MIN_MULTIPLIER,
  BUDGET_MAX_MULTIPLIER,
  getAction,
  validateFixParams,
  clampBudget,
  buildLLMActionCatalog,
};
