const { formatBudget } = require("../utils/googleHelpers");

const googleRules = [
  /* =========================
   🔴 CRITICAL RULES
   ========================= */

  {
    id: "GAUD-01",
    severity: "critical",
    entity: "campaign",
    check: (d) => d.status === "ACTIVE" && d.conversions === 0 && d.spend > 50,
    message: (d) =>
      `${d.campaign_name} has spent ${formatBudget(d.spend * 1e6, d.currency)} with zero conversions in 14 days`,
  },

  {
    id: "GAUD-02",
    severity: "critical",
    entity: "campaign",
    check: (d) => d.budget_pacing > 1.2,
    message: (d) =>
      `${d.campaign_name} is overpacing — will exhaust budget by ${d.pacing_date}`,
  },

  {
    id: "GAUD-03",
    severity: "critical",
    entity: "campaign",
    check: (d) => d.spend > 200 && d.roas < 0.5,
    message: (d) =>
      `${d.campaign_name} spent ${formatBudget(d.spend * 1e6, d.currency)} with very poor ROAS (${d.roas.toFixed(2)})`,
  },

  {
    id: "GAUD-04",
    severity: "critical",
    entity: "campaign",
    check: (d) => d.spend > 100 && d.ctr < 0.5,
    message: (d) =>
      `${d.campaign_name} CTR is extremely low at ${d.ctr.toFixed(2)}%`,
  },

  {
    id: "GAUD-05",
    severity: "critical",
    entity: "campaign",
    check: (d) => d.conversion_rate < 0.5 && d.clicks > 200,
    message: (d) =>
      `${d.campaign_name} is getting traffic but almost no conversions`,
  },

  {
    id: "GAUD-06",
    severity: "critical",
    entity: "campaign",
    check: (d) =>
      d.prev_cpm != null &&
      d.prev_cpm > 0 &&
      (d.cpm - d.prev_cpm) / d.prev_cpm > 0.5,
    message: (d) =>
      `${d.campaign_name} CPM surged from ${formatBudget(d.prev_cpm * 1e6, d.currency)} to ${formatBudget(d.cpm * 1e6, d.currency)}`,
  },

  {
    id: "GAUD-07",
    severity: "critical",
    entity: "campaign",
    check: (d) => d.status === "ACTIVE" && d.impressions === 0,
    message: (d) =>
      `${d.campaign_name} is active but receiving no impressions`,
  },

  {
    id: "GAUD-08",
    severity: "critical",
    entity: "adgroup",
    check: (d) => d.status === "ACTIVE" && d.impressions === 0,
    message: (d) =>
      `${d.adgroup_name} ad group is active but receiving no impressions`,
  },

  {
    id: "GAUD-09",
    severity: "critical",
    entity: "ad",
    check: (d) => d.review_status === "DISAPPROVED",
    message: (d) => `${d.ad_name} is disapproved and not delivering`,
  },

  /* =========================
   🟠 WARNING RULES
   ========================= */

  {
    id: "GAUD-10",
    severity: "warning",
    entity: "campaign",
    check: (d) =>
      d.prev_ctr != null &&
      d.prev_ctr > 0 &&
      (d.prev_ctr - d.ctr) / d.prev_ctr > 0.3,
    message: (d) =>
      `${d.campaign_name} CTR fell ${(((d.prev_ctr - d.ctr) / d.prev_ctr) * 100).toFixed(1)}% vs prior period`,
  },

  {
    id: "GAUD-11",
    severity: "warning",
    entity: "adgroup",
    check: (d) =>
      d.prev_cpa != null &&
      d.prev_cpa > 0 &&
      (d.cpa - d.prev_cpa) / d.prev_cpa > 0.25,
    message: (d) =>
      `${d.adgroup_name} CPA rose from ${formatBudget(d.prev_cpa * 1e6, d.currency)} to ${formatBudget(d.cpa * 1e6, d.currency)}`,
  },

  {
    id: "GAUD-12",
    severity: "warning",
    entity: "campaign",
    check: (d) =>
      d.prev_cpc != null &&
      d.prev_cpc > 0 &&
      (d.cpc - d.prev_cpc) / d.prev_cpc > 0.3,
    message: (d) =>
      `${d.campaign_name} CPC rose from ${formatBudget(d.prev_cpc * 1e6, d.currency)} to ${formatBudget(d.cpc * 1e6, d.currency)}`,
  },

  {
    id: "GAUD-13",
    severity: "warning",
    entity: "campaign",
    check: (d) =>
      d.prev_cpm != null &&
      d.prev_cpm > 0 &&
      (d.cpm - d.prev_cpm) / d.prev_cpm > 0.25,
    message: (d) => `${d.campaign_name} CPM increased significantly`,
  },

  {
    id: "GAUD-14",
    severity: "warning",
    entity: "campaign",
    check: (d) =>
      d.prev_conversion_rate != null &&
      d.prev_conversion_rate > 0 &&
      (d.prev_conversion_rate - d.conversion_rate) / d.prev_conversion_rate > 0.3,
    message: (d) => `${d.campaign_name} conversion rate dropped sharply`,
  },

  {
    id: "GAUD-15",
    severity: "warning",
    entity: "campaign",
    check: (d) =>
      d.prev_spend != null &&
      d.spend > d.prev_spend &&
      d.conversions === d.prev_conversions,
    message: (d) =>
      `${d.campaign_name} spend increased but conversions didn't`,
  },

  {
    id: "GAUD-16",
    severity: "warning",
    entity: "campaign",
    check: (d) =>
      d.prev_roas != null &&
      d.prev_roas > 0 &&
      (d.prev_roas - d.roas) / d.prev_roas > 0.4,
    message: (d) => `${d.campaign_name} ROAS dropped significantly`,
  },

  {
    id: "GAUD-17",
    severity: "warning",
    entity: "campaign",
    check: (d) => d.account_avg_cpa > 0 && d.cpa > d.account_avg_cpa * 2,
    message: (d) =>
      `${d.campaign_name} CPA is far above account average`,
  },

  {
    id: "GAUD-18",
    severity: "warning",
    entity: "ad",
    check: (d) => d.ctr < 0.5 && d.impressions > 500,
    message: (d) =>
      `${d.ad_name} has low CTR of ${d.ctr.toFixed(2)}% — review ad copy`,
  },

  /* =========================
   🟢 OPPORTUNITY RULES
   ========================= */

  {
    id: "GAUD-19",
    severity: "opportunity",
    entity: "campaign",
    check: (d) => d.roas > 3 && d.budget_pacing < 0.7,
    message: (d) =>
      `${d.campaign_name} is a top performer at ${d.roas.toFixed(2)}x ROAS — consider increasing budget`,
  },

  {
    id: "GAUD-20",
    severity: "opportunity",
    entity: "adgroup",
    check: (d) => d.status === "PAUSED" && d.historical_roas > 2,
    message: (d) =>
      `${d.adgroup_name} previously performed well — review for reactivation`,
  },

  {
    id: "GAUD-21",
    severity: "opportunity",
    entity: "ad",
    check: (d) => d.ctr > 5,
    message: (d) =>
      `${d.ad_name} has excellent CTR at ${d.ctr.toFixed(2)}% — use as creative template`,
  },

  {
    id: "GAUD-22",
    severity: "opportunity",
    entity: "campaign",
    check: (d) => d.account_avg_cpa > 0 && d.cpa < d.account_avg_cpa * 0.5,
    message: (d) =>
      `${d.campaign_name} CPA significantly lower than account average`,
  },

  {
    id: "GAUD-23",
    severity: "opportunity",
    entity: "campaign",
    check: (d) => d.roas > 4,
    message: (d) =>
      `${d.campaign_name} is a strong scaling candidate at ${d.roas.toFixed(2)}x ROAS`,
  },

  {
    id: "GAUD-24",
    severity: "opportunity",
    entity: "ad",
    check: (d) =>
      d.ad_spend_share != null &&
      d.ad_spend_share < 0.3 &&
      d.is_top_performer === true,
    message: (d) =>
      `${d.ad_name} is best performer but underfunded — reallocate budget`,
  },
];

module.exports = googleRules;
