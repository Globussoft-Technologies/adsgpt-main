/**
 * Human-readable metadata for the audit rules — used by:
 *   GET /meta-ads/autopilot/audit-rules     (UI rule-overrides editor)
 *   PATCH /meta-ads/autopilot/settings      (validator: rejects unknown
 *                                            rule ids / threshold keys)
 *
 * Kept here, separate from auditRulesConfig.js, so the rule-evaluation file
 * stays a pure list of `{ id, defaults, check, message }`. This module adds
 * the "what is this rule for" + "what does each threshold mean" layer.
 *
 * If you add a new threshold key in auditRulesConfig.js, also add it to
 * THRESHOLD_META below — otherwise the validator will reject any user
 * override using that key, and the UI won't render an editor for it.
 */

// auditRulesConfig.js exports the rule array as module.exports directly.
const rules = require("./auditRulesConfig");

// Per-rule plain-English descriptions. The `message: (d) => "..."` functions
// in auditRulesConfig.js produce row-specific messages at audit time; users
// editing thresholds need a stable description that doesn't depend on a row.
const RULE_DESCRIPTIONS = {
  "AUD-01": "Pause campaigns spending without producing any purchases.",
  "AUD-02": "Pause campaigns whose budget pacing is overshooting.",
  "AUD-03": "Warn when ad-set frequency is creeping toward fatigue.",
  "AUD-04": "Warn when CTR drops sharply week-over-week.",
  "AUD-05": "Warn when CPA rises sharply week-over-week.",
  "AUD-06": "Surface top-ROAS campaigns that still have budget headroom.",
  "AUD-07": "Surface paused ad-sets with strong historical ROAS for review.",
  "AUD-08": "Pause campaigns with very low ROAS after meaningful spend.",
  "AUD-09": "Pause campaigns with very low CTR after meaningful spend.",
  "AUD-10": "Pause campaigns where most spend is being wasted on wrong audiences.",
  "AUD-11": "Pause campaigns whose CPM has surged abnormally.",
  "AUD-12": "Pause ad-sets whose frequency is dangerously high.",
  "AUD-13": "Pause ads that have been disapproved.",
  "AUD-14": "Pause ad-sets stuck in 'Learning Limited' after meaningful spend.",
  "AUD-15": "Pause campaigns that are active but receiving zero impressions.",
  "AUD-16": "Warn when CPC rises sharply week-over-week.",
  "AUD-17": "Warn when CPM rises sharply week-over-week.",
  "AUD-18": "Warn when conversion-rate drops sharply.",
  "AUD-19": "Warn when spend grows but conversions don't.",
  "AUD-20": "Warn when ROAS drops significantly.",
  "AUD-21": "Warn when traffic generates clicks but no add-to-cart.",
  "AUD-22": "Warn when an ad's relevance / quality ranking is below average.",
  "AUD-23": "Warn when CPA is far above account average.",
  "AUD-24": "Warn when ad-set audience size is too small.",
  "AUD-25": "Highlight ads with excellent CTR (potential winners).",
  "AUD-26": "Highlight campaigns with a much-better-than-average CPA.",
  "AUD-27": "Highlight ad-sets with low frequency — room to scale.",
  "AUD-28": "Highlight under-spent campaigns with strong engagement.",
  "AUD-29": "Highlight underfunded top-performing ads.",
  "AUD-30": "Highlight strong scaling candidates by ROAS.",
  "AUD-31": "Highlight checkout drop-off (ATC without purchases).",
  "AUD-32": "Scale campaigns whose ROAS is multiples of target.",
  "AUD-33": "Scale ad-sets with low frequency and healthy CPA.",
  "AUD-34": "Scale ads that are top CTR performers in their campaign.",
  "AUD-35": "Per-entity 7-day cap on cumulative budget scale-up (policy).",
  "AUD-36": "Detect creative fatigue: meaningful CTR drop week-over-week.",
  "AUD-37": "Account-level cap on per-cycle total budget scale-up (policy).",
};

// Per-threshold-key metadata. The same key is reused across many rules
// (e.g. `min_spend` appears in AUD-01, AUD-08, AUD-09, AUD-32, ...) so we
// store the meta once and surface it to the UI in the rules endpoint.
//
// type === 'currency' means the value is in the account's smallest currency
// unit (paise / cents). The UI should display it as ₹/$ × 100. type ===
// 'ratio' means 0–1 unitless. type === 'percent' means 0–100 unit. type ===
// 'count' means a positive integer. type === 'multiplier' is unitless × N.
const THRESHOLD_META = {
  min_spend: {
    type: "currency",
    label: "Minimum spend",
    hint: "Spend floor before this rule evaluates (in paise / cents — ₹100 = 10000).",
    min: 0,
    step: 100,
  },
  max_spend: {
    type: "currency",
    label: "Maximum spend",
    hint: "Spend ceiling above which this rule no longer applies.",
    min: 0,
    step: 100,
  },
  max_pacing: {
    type: "ratio",
    label: "Max budget pacing",
    hint: "Pace ratio (1.0 = on track, >1 = overpacing).",
    min: 0,
    step: 0.05,
  },
  max_roas: {
    type: "multiplier",
    label: "Max ROAS",
    hint: "ROAS ceiling — fires below this.",
    min: 0,
    step: 0.1,
  },
  min_roas: {
    type: "multiplier",
    label: "Min ROAS",
    hint: "ROAS floor — fires above this.",
    min: 0,
    step: 0.1,
  },
  min_roas_multiple: {
    type: "multiplier",
    label: "Min ROAS multiple of target",
    hint: "Multiple of your target ROAS at which to scale.",
    min: 1,
    step: 0.1,
  },
  min_historical_roas: {
    type: "multiplier",
    label: "Min historical ROAS",
    hint: "Past ROAS threshold for surfacing reactivation candidates.",
    min: 0,
    step: 0.1,
  },
  max_ctr: {
    type: "percent",
    label: "Max CTR (low-performance threshold)",
    hint: "CTR below this (in %) triggers the rule.",
    min: 0,
    step: 0.05,
  },
  min_ctr: {
    type: "percent",
    label: "Min CTR (high-performance threshold)",
    hint: "CTR above this (in %) marks a strong performer.",
    min: 0,
    step: 0.05,
  },
  surge_ratio: {
    type: "ratio",
    label: "Surge ratio",
    hint: "Relative jump (0.5 = +50% vs prior period).",
    min: 0,
    step: 0.05,
  },
  max_frequency: {
    type: "multiplier",
    label: "Max frequency",
    hint: "Impressions per user above which the rule fires.",
    min: 0,
    step: 0.1,
  },
  drop_ratio: {
    type: "ratio",
    label: "Drop ratio",
    hint: "Relative decline (0.3 = 30% drop vs prior period).",
    min: 0,
    max: 1,
    step: 0.05,
  },
  rise_ratio: {
    type: "ratio",
    label: "Rise ratio",
    hint: "Relative rise (0.25 = 25% increase vs prior period).",
    min: 0,
    step: 0.05,
  },
  min_engagement_rate: {
    type: "percent",
    label: "Min engagement rate",
    hint: "Engagement rate floor (in %).",
    min: 0,
    step: 0.5,
  },
  max_spend_share: {
    type: "ratio",
    label: "Max spend share",
    hint: "Maximum share of campaign spend before considered underfunded.",
    min: 0,
    max: 1,
    step: 0.05,
  },
  min_atc: {
    type: "count",
    label: "Min add-to-cart count",
    hint: "ATC count floor before checkout-dropoff fires.",
    min: 0,
    step: 1,
  },
  purchase_ratio: {
    type: "ratio",
    label: "Purchase / ATC ratio",
    hint: "Purchases as fraction of ATC; below this = drop-off.",
    min: 0,
    max: 1,
    step: 0.05,
  },
  cap_7d_pct: {
    type: "percent",
    label: "7-day per-entity cap",
    hint: "Max cumulative budget increase per entity over 7 days (%).",
    min: 0,
    step: 5,
  },
  cap_pct_per_run: {
    type: "percent",
    label: "Per-run account cap",
    hint: "Max budget increase across the account per single cycle (%).",
    min: 0,
    step: 1,
  },
  ctr_drop_ratio: {
    type: "ratio",
    label: "CTR drop ratio (fatigue)",
    hint: "CTR drop ratio that flags creative fatigue (0.3 = 30%).",
    min: 0,
    max: 1,
    step: 0.05,
  },
  cpa_ratio: {
    type: "ratio",
    label: "CPA / account-avg ratio",
    hint: "CPA below account avg × this ratio = strong opportunity.",
    min: 0,
    step: 0.05,
  },
  cpa_multiplier: {
    type: "multiplier",
    label: "CPA / account-avg multiplier",
    hint: "CPA above account avg × this = warning.",
    min: 1,
    step: 0.1,
  },
  min_clicks: {
    type: "count",
    label: "Min clicks",
    hint: "Clicks floor before low-intent rule fires.",
    min: 0,
    step: 1,
  },
  max_audience: {
    type: "count",
    label: "Max audience size",
    hint: "Audience size below which adset is flagged as too small.",
    min: 0,
    step: 1000,
  },
  max_conversion_rate: {
    type: "percent",
    label: "Max conversion rate (low-performance threshold)",
    hint: "Conversion rate below this (in %) triggers the rule.",
    min: 0,
    step: 0.05,
  },
};

/**
 * Build the rules-metadata payload returned by GET /audit-rules.
 *
 * Rules with `defaults: {}` (e.g. AUD-13 disapproved-ad, AUD-19 spend-up
 * w/o conversions, AUD-22 below-avg quality) are still returned so users
 * can see them — they just have an empty `tunable` array.
 */
function listAuditRulesForUI() {
  return rules.map((r) => {
    const tunable = Object.keys(r.defaults || {}).map((key) => {
      const meta = THRESHOLD_META[key] || {
        type: "number",
        label: key,
        hint: "",
      };
      return {
        key,
        default: r.defaults[key],
        ...meta,
      };
    });
    return {
      id: r.id,
      severity: r.severity,
      entity: r.entity,
      action: r.action || null, // 'scale', 'rotate_creative', 'scale_cap', etc.
      description: RULE_DESCRIPTIONS[r.id] || "",
      defaults: r.defaults || {},
      tunable,
    };
  });
}

/**
 * Lookup table for the validator: { 'AUD-01': Set('min_spend'), ... }.
 * A user override `{ 'AUD-01': { min_spend: 10000 } }` is valid only when
 * 'AUD-01' is a known rule and 'min_spend' is in its defaults.
 */
function buildAllowedOverrides() {
  const out = new Map();
  for (const r of rules) {
    out.set(r.id, new Set(Object.keys(r.defaults || {})));
  }
  return out;
}

module.exports = {
  RULE_DESCRIPTIONS,
  THRESHOLD_META,
  listAuditRulesForUI,
  buildAllowedOverrides,
};
