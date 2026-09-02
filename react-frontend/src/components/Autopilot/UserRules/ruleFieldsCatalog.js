/**
 * Frontend mirror of the Joi validator's allowed field/op/severity enums.
 *
 * Single source of truth for what the rule builder dropdowns offer. Must
 * stay in sync with `Validations/autopilotUserRule.validator.js`. If the
 * backend grows a new field, add it here too — otherwise users won't see
 * it in the picker even though the cron would evaluate it.
 */

export const NUMERIC_FIELDS = [
  { value: "spend", label: "Spend", hint: "Spend over the lookback window. Smallest currency unit (paise / cents)." },
  { value: "ctr", label: "CTR", hint: "Click-through rate (%)." },
  { value: "cpc", label: "CPC", hint: "Cost per click (smallest currency unit)." },
  { value: "cpm", label: "CPM", hint: "Cost per 1,000 impressions." },
  { value: "cpa", label: "CPA", hint: "Cost per acquisition (per purchase)." },
  { value: "cpi", label: "CPI", hint: "Cost per app install. Only meaningful for App Promotion campaigns; 0 elsewhere." },
  { value: "roas", label: "ROAS", hint: "Return on ad spend (multiplier)." },
  { value: "frequency", label: "Frequency", hint: "Avg impressions per unique user." },
  { value: "purchases", label: "Purchases", hint: "Conversion / purchase count." },
  { value: "installs", label: "App installs", hint: "Mobile + omni app install count. Zero outside App Promotion." },
  { value: "clicks", label: "Clicks", hint: "Total clicks." },
  { value: "impressions", label: "Impressions", hint: "Total impressions." },
  { value: "conversion_rate", label: "Conversion rate", hint: "Conversions / clicks (%)." },
  { value: "engagement_rate", label: "Engagement rate", hint: "Engagement / impressions (%)." },
  { value: "budget_pacing", label: "Budget pacing", hint: "1.0 = on track, >1 overpacing." },
  { value: "add_to_cart", label: "Add-to-cart count" },
  { value: "ad_spend_share", label: "Ad spend share", hint: "Share of campaign spend." },
  { value: "historical_roas", label: "Historical ROAS" },
  { value: "prev_spend", label: "Previous-period spend" },
  { value: "prev_ctr", label: "Previous-period CTR" },
  { value: "prev_cpc", label: "Previous-period CPC" },
  { value: "prev_cpm", label: "Previous-period CPM" },
  { value: "prev_cpa", label: "Previous-period CPA" },
  { value: "prev_cpi", label: "Previous-period CPI" },
  { value: "prev_installs", label: "Previous-period installs" },
  { value: "prev_roas", label: "Previous-period ROAS" },
  { value: "prev_conversion_rate", label: "Previous-period conversion rate" },
];

export const STRING_FIELDS = [
  {
    value: "status",
    label: "Status",
    options: ["ACTIVE", "PAUSED", "DELETED", "ARCHIVED"],
  },
  {
    value: "effective_status",
    label: "Effective status",
    options: ["ACTIVE", "PAUSED", "DISAPPROVED", "PENDING_REVIEW"],
  },
  {
    value: "learning_status",
    label: "Learning status",
    options: ["LEARNING", "LEARNING_LIMITED", "ACTIVE"],
  },
  {
    value: "review_status",
    label: "Review status",
    options: ["APPROVED", "DISAPPROVED", "PENDING"],
  },
  {
    value: "relevance_score",
    label: "Quality ranking",
    options: ["ABOVE_AVERAGE", "AVERAGE", "BELOW_AVERAGE"],
  },
];

export const NUMERIC_FIELD_VALUES = new Set(NUMERIC_FIELDS.map((f) => f.value));
export const STRING_FIELD_VALUES = new Set(STRING_FIELDS.map((f) => f.value));

// `value` is the operator the validator + cron evaluator expects
// (must match Validations/autopilotUserRule.validator.js exactly).
// `label` is the human-readable text shown in the rule-builder UI.
// The two are intentionally decoupled so we can polish copy without
// touching the wire format.
export const NUMERIC_OPS = [
  { value: ">", label: "Greater than (>)" },
  { value: "<", label: "Less than (<)" },
  { value: ">=", label: "Greater than or equal (≥)" },
  { value: "<=", label: "Less than or equal (≤)" },
  { value: "==", label: "Equal to (=)" },
  { value: "!=", label: "Not equal to (≠)" },
];

export const STRING_OPS = [
  { value: "==", label: "Is" },
  { value: "!=", label: "Is not" },
];

export const SEVERITIES = [
  {
    value: "low",
    label: "Low",
    tone: "border-sky-400/30 bg-sky-400/10 text-sky-300",
    dot: "bg-sky-400",
  },
  {
    value: "medium",
    label: "Medium",
    tone: "border-amber-400/30 bg-amber-400/10 text-amber-300",
    dot: "bg-amber-400",
  },
  {
    value: "high",
    label: "High",
    tone: "border-red-400/30 bg-red-400/10 text-red-300",
    dot: "bg-red-400",
  },
];

export const ACTION_TYPES = [
  {
    value: "pause",
    label: "Pause the entity",
    hint: "Set status to PAUSED on Meta and stop delivery.",
  },
  {
    value: "alert",
    label: "Alert me",
    hint: "Just notify (Slack / email). No Meta change.",
  },
  {
    value: "scale",
    label: "Change the budget",
    hint: "Raise or lower the daily budget each time this rule fires. Budgets live on campaigns and ad sets, so an ad-level rule changes the ad's parent ad set.",
    // HIDDEN, NOT REMOVED. Budget scaling is fully built and tested end to end
    // — validator, cron, ceilings, action log — it is simply not being offered
    // to users yet. Everything behind this flag stays live: rules already
    // saved with `action.type: 'scale'` keep running on the cron, and the
    // ScaleStepEditor below still renders for anyone editing one.
    //
    // To ship it: delete this line. Nothing else needs changing.
    hidden: true,
  },
];

// The options a user may CHOOSE from. Hidden ones are still valid values —
// see `visibleActionTypes` in RuleFormModal for why an existing rule using a
// hidden action must still show it.
export const SELECTABLE_ACTION_TYPES = ACTION_TYPES.filter((a) => !a.hidden);

// Bounds on a SINGLE step. Must match MIN_RULE_STEP_PCT / MAX_RULE_STEP_PCT in
// nodejs-backend/services/autopilot/scalePolicy.js — the form and Joi are a
// unit, and a mismatch shows up as a server rejection the form said was fine.
//
// Everything above this bound is engine policy and deliberately not exposed:
// a 7-day cumulative ceiling (at most double / at most halve), a per-account
// per-cycle cap, and a per-cycle action count. A rule may ask for a step; it
// may not raise the ceiling.
export const MIN_SCALE_PCT = 1;
export const MAX_SCALE_PCT = 50;

export const SCALE_DIRECTIONS = [
  {
    value: "up",
    label: "Increase",
    hint: "Raise the daily budget. Applies every time the rule fires, so growth compounds — Autopilot will not let an entity more than double in 7 days.",
  },
  {
    value: "down",
    label: "Decrease",
    hint: "Lower the daily budget. Autopilot will not let an entity fall below half its level from 7 days ago.",
  },
];

export const EVALUATE_ON = [
  { value: "campaign", label: "Campaign", hint: "Test conditions on the attached campaign itself." },
  { value: "adset", label: "Ad set", hint: "Walk every ad set under the attached campaign." },
  { value: "ad", label: "Ad", hint: "Walk every ad under the attached campaign." },
];

/**
 * Which metrics actually exist at which level.
 *
 * NOT COSMETIC. The three audit normalizers emit three different shapes, and
 * the cron's evaluator fails a condition closed on a missing field — so a rule
 * using a field its level does not produce never matches, never errors, and
 * looks perfectly healthy here forever. That shipped: eight of one account's
 * ten enabled rules were ad-level rules on `cpa` / `purchases` and sat at zero
 * fires for weeks.
 *
 * Mirrors nodejs-backend/services/autopilot/fieldAvailability.js, which the
 * validator enforces — so an out-of-sync entry here shows up as a server
 * rejection rather than a silently dead rule.
 */
export const FIELDS_BY_LEVEL = {
  campaign: [
    "spend", "impressions", "clicks", "ctr", "cpc", "cpm", "roas", "cpa",
    "installs", "cpi", "purchases", "add_to_cart", "conversion_rate",
    "engagement_rate", "budget_pacing", "status",
    "prev_spend", "prev_installs", "prev_cpi", "prev_ctr", "prev_cpc",
    "prev_cpm", "prev_roas", "prev_conversion_rate",
  ],
  adset: [
    "spend", "impressions", "clicks", "ctr", "cpc", "cpm", "roas", "cpa",
    "installs", "cpi", "purchases", "add_to_cart", "conversion_rate",
    "engagement_rate", "frequency", "status", "historical_roas",
    "learning_status", "prev_cpa", "prev_installs", "prev_cpi",
  ],
  ad: [
    "spend", "impressions", "clicks", "ctr", "cpc", "cpm", "roas", "cpa",
    "installs", "cpi", "purchases", "add_to_cart", "conversion_rate",
    "engagement_rate", "frequency", "ad_spend_share", "status",
    "review_status", "effective_status", "relevance_score",
    "prev_spend", "prev_ctr", "prev_installs", "prev_cpi", "prev_cpc",
    "prev_cpm", "prev_roas", "prev_cpa", "prev_conversion_rate",
  ],
};

/** True when `field` is measured at `level`. Unknown level allows everything. */
export function isFieldAvailable(fieldValue, level) {
  const list = FIELDS_BY_LEVEL[level];
  if (!list) return true;
  return list.includes(fieldValue);
}

/** The numeric/string field lists filtered to what `level` can measure. */
export function fieldsForLevel(level) {
  return {
    numeric: NUMERIC_FIELDS.filter((f) => isFieldAvailable(f.value, level)),
    string: STRING_FIELDS.filter((f) => isFieldAvailable(f.value, level)),
  };
}

/**
 * Helpers for the form: pick the right ops list + value-input shape
 * based on the chosen field.
 */
export function isNumericField(fieldValue) {
  return NUMERIC_FIELD_VALUES.has(fieldValue);
}
export function isStringField(fieldValue) {
  return STRING_FIELD_VALUES.has(fieldValue);
}
export function opsForField(fieldValue) {
  if (isStringField(fieldValue)) return STRING_OPS;
  return NUMERIC_OPS;
}
export function fieldMeta(fieldValue) {
  return (
    NUMERIC_FIELDS.find((f) => f.value === fieldValue) ||
    STRING_FIELDS.find((f) => f.value === fieldValue) ||
    null
  );
}
