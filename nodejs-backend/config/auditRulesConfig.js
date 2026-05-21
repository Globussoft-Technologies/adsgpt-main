const { formatBudget } = require("../utils/formatBudget");

/**
 * Each rule:
 *   { id, severity, entity, defaults, check(d, t), message(d, t) }
 *
 * `defaults` declares named thresholds this rule uses. Per-account overrides
 * (see config/autopilotConfig.js) replace named keys; missing keys fall back
 * to these defaults. Rules with no configurable thresholds declare `defaults: {}`.
 *
 * UNITS — IMPORTANT
 * -----------------
 * Meta's Insights API returns `spend` (and cost_per_action_type, action_values,
 * etc.) as strings in the account's SMALLEST CURRENCY UNIT. For INR accounts
 * that means paise (₹1 = 100 paise); for USD, cents; etc. Confirmed against
 * live dev data 2026-04-24 — spend="41500" displayed as ₹415.00 after
 * formatBudget()'s /100 divide.
 *
 * So all `min_spend` / `max_spend` thresholds in this file are in smallest
 * currency units. `min_spend: 5000` means ₹50 on an INR account, $50 on a
 * USD account. Pre-2026-04-24 these were mis-calibrated (min_spend: 50 =
 * ₹0.50, so AUD-01 fired on any active zero-conv campaign).
 *
 * Percentage / ratio thresholds (drop_ratio, rise_ratio, max_frequency,
 * min_ctr, min_roas, surge_ratio, purchase_ratio, cpa_multiplier, etc.) are
 * unit-less and unchanged.
 */

const rules = [
  /* =========================
   🔴 CRITICAL RULES
   ========================= */

  {
    id: "AUD-01",
    severity: "critical",
    entity: "campaign",
    defaults: { min_spend: 5000 }, // ₹50 / $50
    check: (d, t) =>
      d.status === "ACTIVE" && d.purchases === 0 && d.spend > t.min_spend,
    message: (d) =>
      `${d.campaign_name} has spent ${formatBudget(d.spend, d.currency)} with zero conversions in 14 days`,
  },

  {
    id: "AUD-02",
    severity: "critical",
    entity: "campaign",
    defaults: { max_pacing: 1.2 },
    check: (d, t) => d.budget_pacing > t.max_pacing,
    message: (d) =>
      `${d.campaign_name} is overpacing — will exhaust budget by ${d.pacing_date}`,
  },

  {
    id: "AUD-08",
    severity: "critical",
    entity: "campaign",
    defaults: { min_spend: 20000, max_roas: 0.5 }, // ₹200 / $200
    check: (d, t) => d.spend > t.min_spend && d.roas < t.max_roas,
    message: (d) =>
      `${d.campaign_name} spent ${formatBudget(d.spend, d.currency)} with very poor ROAS (${d.roas})`,
  },

  {
    id: "AUD-09",
    severity: "critical",
    entity: "campaign",
    defaults: { min_spend: 10000, max_ctr: 0.5 }, // ₹100 / $100
    check: (d, t) => d.spend > t.min_spend && d.ctr < t.max_ctr,
    message: (d) => `${d.campaign_name} CTR is extremely low at ${d.ctr.toFixed(2)}%`,
  },

  {
    id: "AUD-10",
    severity: "critical",
    entity: "campaign",
    defaults: { max_conversion_rate: 0.5, min_clicks: 200 },
    check: (d, t) =>
      d.conversion_rate < t.max_conversion_rate && d.clicks > t.min_clicks,
    message: (d) =>
      `${d.campaign_name} is getting traffic but almost no conversions`,
  },

  {
    id: "AUD-11",
    severity: "critical",
    entity: "campaign",
    defaults: { surge_ratio: 0.5 },
    // Guard: only fire if prev_cpm is non-null AND non-zero
    check: (d, t) =>
      d.prev_cpm != null &&
      d.prev_cpm > 0 &&
      (d.cpm - d.prev_cpm) / d.prev_cpm > t.surge_ratio,
    message: (d) =>
      `${d.campaign_name} CPM surged from ${formatBudget(d.prev_cpm, d.currency)} to ${formatBudget(d.cpm, d.currency)}`,
  },

  {
    id: "AUD-12",
    severity: "critical",
    entity: "adset",
    defaults: { max_frequency: 6 },
    check: (d, t) => d.frequency > t.max_frequency,
    message: (d) =>
      `${d.adset_name} frequency is dangerously high at ${d.frequency}x`,
  },

  {
    id: "AUD-13",
    severity: "critical",
    entity: "ad",
    defaults: {},
    // effective_status === "DISAPPROVED" is the current Meta API equivalent
    check: (d) => d.review_status === "DISAPPROVED",
    message: (d) => `${d.ad_name} is disapproved and not delivering`,
  },

  {
    id: "AUD-14",
    severity: "critical",
    entity: "adset",
    defaults: { min_spend: 10000 }, // ₹100 / $100
    check: (d, t) =>
      d.learning_status === "LEARNING_LIMITED" && d.spend > t.min_spend,
    message: (d) =>
      `${d.adset_name} stuck in learning limited after spending ${formatBudget(d.spend, d.currency)}`,
  },

  {
    id: "AUD-15",
    severity: "critical",
    entity: "campaign",
    defaults: {},
    check: (d) => d.status === "ACTIVE" && d.impressions === 0,
    message: (d) => `${d.campaign_name} is active but receiving no impressions`,
  },

  /* =========================
   🟠 WARNING RULES
   ========================= */

  {
    id: "AUD-03",
    severity: "warning",
    entity: "adset",
    defaults: { max_frequency: 3.5 },
    check: (d, t) => d.frequency > t.max_frequency,
    message: (d) =>
      `${d.adset_name} creative frequency is ${d.frequency}x — expect CTR drop`,
  },

  {
    id: "AUD-04",
    severity: "warning",
    entity: "campaign",
    defaults: { drop_ratio: 0.3 },
    check: (d, t) =>
      d.prev_ctr != null &&
      d.prev_ctr > 0 &&
      (d.prev_ctr - d.ctr) / d.prev_ctr > t.drop_ratio,
    message: (d) =>
      `${d.campaign_name} CTR fell ${(((d.prev_ctr - d.ctr) / d.prev_ctr) * 100).toFixed(1)}% last week vs prior week`,
  },

  {
    id: "AUD-05",
    severity: "warning",
    entity: "adset",
    defaults: { rise_ratio: 0.25 },
    check: (d, t) =>
      d.prev_cpa != null &&
      d.prev_cpa > 0 &&
      (d.cpa - d.prev_cpa) / d.prev_cpa > t.rise_ratio,
    message: (d) =>
      `${d.adset_name} CPA rose from ${formatBudget(d.prev_cpa, d.currency)} to ${formatBudget(d.cpa, d.currency)}`,
  },

  {
    id: "AUD-16",
    severity: "warning",
    entity: "campaign",
    defaults: { rise_ratio: 0.3 },
    check: (d, t) =>
      d.prev_cpc != null &&
      d.prev_cpc > 0 &&
      (d.cpc - d.prev_cpc) / d.prev_cpc > t.rise_ratio,
    message: (d) =>
      `${d.campaign_name} CPC rose from ${formatBudget(d.prev_cpc, d.currency)} to ${formatBudget(d.cpc, d.currency)}`,
  },

  {
    id: "AUD-17",
    severity: "warning",
    entity: "campaign",
    defaults: { rise_ratio: 0.25 },
    check: (d, t) =>
      d.prev_cpm != null &&
      d.prev_cpm > 0 &&
      (d.cpm - d.prev_cpm) / d.prev_cpm > t.rise_ratio,
    message: (d) => `${d.campaign_name} CPM increased significantly`,
  },

  {
    id: "AUD-18",
    severity: "warning",
    entity: "campaign",
    defaults: { drop_ratio: 0.3 },
    check: (d, t) =>
      d.prev_conversion_rate != null &&
      d.prev_conversion_rate > 0 &&
      (d.prev_conversion_rate - d.conversion_rate) / d.prev_conversion_rate >
        t.drop_ratio,
    message: (d) => `${d.campaign_name} conversion rate dropped sharply`,
  },

  {
    id: "AUD-19",
    severity: "warning",
    entity: "campaign",
    defaults: {},
    // Guard: prev_spend must be non-null
    check: (d) =>
      d.prev_spend != null &&
      d.spend > d.prev_spend &&
      d.conversions === d.prev_conversions,
    message: (d) => `${d.campaign_name} spend increased but conversions didn't`,
  },

  {
    id: "AUD-20",
    severity: "warning",
    entity: "campaign",
    defaults: { drop_ratio: 0.4 },
    check: (d, t) =>
      d.prev_roas != null &&
      d.prev_roas > 0 &&
      (d.prev_roas - d.roas) / d.prev_roas > t.drop_ratio,
    message: (d) => `${d.campaign_name} ROAS dropped significantly`,
  },

  {
    id: "AUD-21",
    severity: "warning",
    entity: "campaign",
    defaults: { min_clicks: 100 },
    check: (d, t) => d.clicks > t.min_clicks && d.add_to_cart === 0,
    message: (d) =>
      `${d.campaign_name} generating traffic but no purchase intent`,
  },

  {
    id: "AUD-22",
    severity: "warning",
    entity: "ad",
    defaults: {},
    // Meta's modern equivalent of relevance_score is quality_ranking
    // Possible values: ABOVE_AVERAGE, AVERAGE, BELOW_AVERAGE
    check: (d) => d.relevance_score === "BELOW_AVERAGE",
    message: (d) => `${d.ad_name} has poor relevance ranking`,
  },

  {
    id: "AUD-23",
    severity: "warning",
    entity: "campaign",
    defaults: { cpa_multiplier: 2 },
    check: (d, t) =>
      d.account_avg_cpa > 0 && d.cpa > d.account_avg_cpa * t.cpa_multiplier,
    message: (d) => `${d.campaign_name} CPA is far above account average`,
  },

  {
    id: "AUD-24",
    severity: "warning",
    entity: "adset",
    defaults: { max_audience: 100000 },
    // audience_size is null unless enriched via delivery_estimate API
    check: (d, t) => d.audience_size != null && d.audience_size < t.max_audience,
    message: (d) => `${d.adset_name} audience may be too small`,
  },

  /* =========================
   🟢 OPPORTUNITY RULES
   ========================= */

  {
    id: "AUD-06",
    severity: "opportunity",
    entity: "campaign",
    defaults: { min_roas: 3, max_pacing: 0.7 },
    check: (d, t) => d.roas > t.min_roas && d.budget_pacing < t.max_pacing,
    message: (d) =>
      `${d.campaign_name} is your top performer at ${d.roas}x — increase budget`,
  },

  {
    id: "AUD-07",
    severity: "opportunity",
    entity: "adset",
    defaults: { min_historical_roas: 2 },
    check: (d, t) =>
      d.status === "PAUSED" && d.historical_roas > t.min_historical_roas,
    message: (d) =>
      `${d.adset_name} previously performed well — review for reactivation`,
  },

  {
    id: "AUD-25",
    severity: "opportunity",
    entity: "ad",
    defaults: { min_ctr: 3 },
    check: (d, t) => d.ctr > t.min_ctr,
    message: (d) => `${d.ad_name} has excellent CTR at ${d.ctr.toFixed(2)}%`,
  },

  {
    id: "AUD-26",
    severity: "opportunity",
    entity: "campaign",
    defaults: { cpa_ratio: 0.5 },
    check: (d, t) =>
      d.account_avg_cpa > 0 && d.cpa < d.account_avg_cpa * t.cpa_ratio,
    message: (d) =>
      `${d.campaign_name} CPA significantly lower than account average`,
  },

  {
    id: "AUD-27",
    severity: "opportunity",
    entity: "adset",
    defaults: { max_frequency: 1.2 },
    check: (d, t) => d.frequency < t.max_frequency,
    message: (d) => `${d.adset_name} audience still fresh — room to scale`,
  },

  {
    id: "AUD-28",
    severity: "opportunity",
    entity: "campaign",
    defaults: { min_engagement_rate: 5, max_spend: 5000 }, // ₹50 / $50
    check: (d, t) =>
      d.engagement_rate > t.min_engagement_rate && d.spend < t.max_spend,
    message: (d) => `${d.campaign_name} engagement strong — consider scaling`,
  },

  {
    id: "AUD-29",
    severity: "opportunity",
    entity: "ad",
    defaults: { max_spend_share: 0.3 },
    check: (d, t) =>
      d.ad_spend_share != null &&
      d.ad_spend_share < t.max_spend_share &&
      d.is_top_performer === true,
    message: (d) => `${d.ad_name} is best performer but underfunded`,
  },

  {
    id: "AUD-30",
    severity: "opportunity",
    entity: "campaign",
    defaults: { min_roas: 4 },
    check: (d, t) => d.roas > t.min_roas,
    message: (d) => `${d.campaign_name} is a strong scaling candidate`,
  },

  {
    id: "AUD-31",
    severity: "opportunity",
    entity: "campaign",
    defaults: { min_atc: 50, purchase_ratio: 0.2 },
    check: (d, t) =>
      d.add_to_cart > t.min_atc &&
      d.purchases < d.add_to_cart * t.purchase_ratio,
    message: (d) => `${d.campaign_name} checkout dropoff detected`,
  },

  /* =========================
   🚀 SCALE-WINNER RULES (Phase 6)
   =========================
   These fire "opportunity" findings that autoScaleService reads to issue
   budget-up actions. They are evaluated but NOT paused by autoPauseService
   (it filters on critical/warning). They're tagged with `action: 'scale'`
   so the scaler picks them up specifically and ignores the regular
   opportunity rules above (which are informational only).
   */

  {
    id: "AUD-32",
    severity: "opportunity",
    entity: "campaign",
    action: "scale",
    // min_spend in smallest currency unit — guard against scaling under-spent
    // campaigns whose ROAS is noise (e.g. 2 purchases on ₹300 spend).
    defaults: { min_roas_multiple: 2, min_spend: 500000 }, // 2× target ROAS; ₹5000
    check: (d, t) =>
      d.roas > t.min_roas_multiple && d.spend > t.min_spend,
    message: (d) =>
      `${d.campaign_name} ROAS ${d.roas.toFixed(2)} is 2× target — scale budget`,
  },

  {
    id: "AUD-33",
    severity: "opportunity",
    entity: "adset",
    action: "scale",
    // CPA is unit-agnostic (ratio) but we still need a spend floor.
    defaults: { max_frequency: 2, min_spend: 500000 }, // ₹5000
    check: (d, t) =>
      d.cpa > 0 &&
      d.frequency < t.max_frequency &&
      d.spend > t.min_spend,
    message: (d) =>
      `${d.adset_name} low frequency (${d.frequency.toFixed(2)}x) & healthy CPA — room to scale`,
  },

  {
    id: "AUD-34",
    severity: "opportunity",
    entity: "ad",
    action: "scale",
    defaults: { min_spend: 500000 }, // ₹5000 — spend floor before we trust "best ad"
    // is_top_performer is pre-computed by the normaliser: highest CTR in the
    // campaign AND campaign has >1 ad (so ties of 1-ad campaigns don't fire).
    check: (d, t) =>
      d.is_top_performer === true && d.ctr > 0 && d.spend > t.min_spend,
    message: (d) =>
      `${d.ad_name} is the best-CTR ad in its campaign (${d.ctr.toFixed(2)}%) — scale parent adset budget`,
  },

  /* =========================
   🛡  POLICY / SAFETY RULES (Phase 6+)
   =========================
   AUD-35 is a "policy rule" — it never fires from the audit engine
   (`check` always returns false). Its purpose is to live in the catalog
   so the cap is:
     - greppable by id,
     - overridable per-account via autopilotConfig.accounts[].overrides,
     - observable in the action log: when autoScaleService skips an entity
       because the cumulative 7d cap is reached, it stamps the skip row
       with `ruleId: 'AUD-35'`.
   Defaults are read by autoScaleService via getEffectiveThresholds() so
   per-account overrides apply automatically. The env var
   AUTOPILOT_SCALE_PCT_CAP_7D remains as a fallback for backward compat.
   */
  {
    id: "AUD-35",
    severity: "opportunity",
    entity: "campaign", // arbitrary — never evaluated; entity_type cited by autoScaleService at log time
    action: "scale_cap",
    defaults: { cap_7d_pct: 100 },
    check: () => false, // policy rule, not entity-driven
    message: (_d, t) =>
      `Per-entity 7d budget scale cap: max ${t.cap_7d_pct}% cumulative change`,
  },

  /* =========================
   🎨  FATIGUE / ROTATION RULES (Phase 9 input)
   =========================
   AUD-36 fires on individual ads that show meaningful CTR decline week-
   over-week with non-trivial spend. It produces findings with action
   `rotate_creative`; until the Phase 9 rotation service ships, no action
   service consumes these — they appear in /meta-ads/audit responses and
   in autopilotActionLog only when the rotation service is wired in.
   */
  {
    id: "AUD-36",
    severity: "warning",
    entity: "ad",
    action: "rotate_creative",
    // ctr_drop_ratio: 0.3 = 30% relative drop (e.g. 1.0% → 0.7%).
    // min_spend in smallest currency unit. Floor avoids flagging fresh ads
    // that haven't accumulated enough impressions to judge trend.
    defaults: { ctr_drop_ratio: 0.3, min_spend: 5000 }, // 30% drop, ₹50 spend
    check: (d, t) => {
      if (!d.prev_ctr || d.prev_ctr <= 0) return false;
      if (!d.spend || d.spend < t.min_spend) return false;
      if (d.status && d.status !== "ACTIVE") return false; // only flag active ads
      const drop = (d.prev_ctr - d.ctr) / d.prev_ctr;
      return drop > t.ctr_drop_ratio;
    },
    message: (d, t) => {
      const dropPct = ((d.prev_ctr - d.ctr) / d.prev_ctr) * 100;
      return `${d.ad_name} CTR dropped ${dropPct.toFixed(0)}% WoW (${d.prev_ctr.toFixed(2)}% → ${d.ctr.toFixed(2)}%, threshold ${(t.ctr_drop_ratio * 100).toFixed(0)}%) — fatigue, consider rotating creative`;
    },
  },

  /* =========================
   🛡️  ACCOUNT-LEVEL SCALE CAP POLICY (Phase 6 hardening, PRD §6)
   =========================
   AUD-37 is a no-op rule like AUD-35 — its purpose is to carry the
   per-cycle account-level budget cap as a configurable threshold so
   per-account overrides flow through `getEffectiveThresholds`. Defaults to
   capping any single Autopilot cycle to a +10% increase in total account
   daily_budget. autoScaleService reads this via resolveCapAccountPctPerRun()
   and stamps cap-skip log rows with `ruleId: 'AUD-37'`.
   The env var AUTOPILOT_SCALE_PCT_CAP_ACCOUNT_PER_RUN remains as a fallback
   for backward compat.
   */
  {
    id: "AUD-37",
    severity: "opportunity",
    entity: "campaign", // arbitrary — never evaluated; entity_type cited by autoScaleService at log time
    action: "scale_account_cap",
    defaults: { cap_pct_per_run: 10 },
    check: () => false, // policy rule, not entity-driven
    message: (_d, t) =>
      `Account-level per-cycle scale cap: max ${t.cap_pct_per_run}% of account total daily_budget`,
  },
];

module.exports = rules;
