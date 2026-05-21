/**
 * Curated user-rule templates for the v4 Autopilot UI.
 *
 * Each template lands in the form pre-filled when the user clicks "Use
 * this template" in the templates gallery. Users edit any field before
 * saving — templates are starting points, not enforced policy.
 *
 * The shape matches the Joi `createRuleSchema` (minus `attachments`,
 * which the user picks per-rule) so the frontend can drop the template
 * straight into the create form without transformation.
 *
 * Categories drive grid grouping in the gallery:
 *   Performance — outcome-driven (conversions, ROAS)
 *   Cost       — spend / pacing / cost ratios
 *   Creative   — fatigue, relevance, top performers
 *   Delivery   — disapprovals, learning state, audience
 *
 * UNITS reminder — `min_spend`-style values are in the smallest
 * currency unit (paise / cents). 50000 ≈ ₹500 / $500 on those locales.
 * The form's currency input UX (when shipped) translates between major
 * units shown to the user and minor units stored in the rule.
 */

const TEMPLATES = [
  // ─── Performance ─────────────────────────────────────────────────────────
  {
    id: "tmpl-zero-conv",
    category: "Performance",
    headline: "Pause if no conversions after spending",
    blurb: "Stop active campaigns that have spent meaningfully and produced zero purchases.",
    template: {
      name: "Zero conversions",
      description:
        "Pause active campaigns that have spent more than ₹500 with zero purchases — usually means broken targeting or a misaligned creative.",
      severity: "high",
      enabled: true,
      evaluateOn: "campaign",
      conditions: {
        operator: "AND",
        rules: [
          { field: "status", op: "==", value: "ACTIVE" },
          { field: "spend", op: ">", value: 50000 },
          { field: "purchases", op: "==", value: 0 },
        ],
      },
      action: { type: "pause" },
    },
  },
  {
    id: "tmpl-low-roas",
    category: "Performance",
    headline: "Alert on poor ROAS",
    blurb: "Get an alert when a campaign's ROAS drops below a floor after meaningful spend.",
    template: {
      name: "ROAS below 1.0",
      description:
        "Alert me when a campaign's ROAS drops below 1.0 after spending ₹2000 — losing money on every conversion.",
      severity: "high",
      enabled: true,
      evaluateOn: "campaign",
      conditions: {
        operator: "AND",
        rules: [
          { field: "status", op: "==", value: "ACTIVE" },
          { field: "spend", op: ">", value: 200000 },
          { field: "roas", op: "<", value: 1 },
        ],
      },
      action: { type: "alert" },
    },
  },
  {
    id: "tmpl-cpa-rise",
    category: "Performance",
    headline: "Alert on CPA rise week-over-week",
    blurb: "Get an alert when CPA jumps significantly versus the previous period.",
    template: {
      name: "CPA up vs last week",
      description:
        "Alert me when an ad-set's current CPA is higher than its previous-period CPA — flagging a deteriorating funnel before it bleeds budget.",
      severity: "medium",
      enabled: true,
      evaluateOn: "adset",
      conditions: {
        operator: "AND",
        rules: [
          { field: "status", op: "==", value: "ACTIVE" },
          { field: "cpa", op: ">", value: 0 },
          { field: "prev_cpa", op: ">", value: 0 },
        ],
      },
      action: { type: "alert" },
    },
  },
  {
    id: "tmpl-traffic-no-intent",
    category: "Performance",
    headline: "Pause traffic with no conversion intent",
    blurb: "Pause campaigns generating clicks but virtually no add-to-cart or purchase events.",
    template: {
      name: "Clicks without intent",
      description:
        "Pause campaigns with > 200 clicks but conversion-rate below 0.5% — landing-page or audience mismatch.",
      severity: "high",
      enabled: true,
      evaluateOn: "campaign",
      conditions: {
        operator: "AND",
        rules: [
          { field: "status", op: "==", value: "ACTIVE" },
          { field: "clicks", op: ">", value: 200 },
          { field: "conversion_rate", op: "<", value: 0.5 },
        ],
      },
      action: { type: "pause" },
    },
  },

  // ─── Cost ────────────────────────────────────────────────────────────────
  {
    id: "tmpl-low-ctr-spend",
    category: "Cost",
    headline: "Pause low-CTR campaigns after spend",
    blurb: "Stop campaigns whose CTR is well below 0.5% after meaningful spend.",
    template: {
      name: "Low CTR despite spend",
      description:
        "Pause active campaigns with CTR below 0.5% after spending ₹1000 — creative isn't earning its keep.",
      severity: "medium",
      enabled: true,
      evaluateOn: "campaign",
      conditions: {
        operator: "AND",
        rules: [
          { field: "status", op: "==", value: "ACTIVE" },
          { field: "spend", op: ">", value: 100000 },
          { field: "ctr", op: "<", value: 0.5 },
        ],
      },
      action: { type: "pause" },
    },
  },
  {
    id: "tmpl-high-frequency",
    category: "Cost",
    headline: "Pause runaway frequency",
    blurb: "Stop ad-sets where the same person sees the ad too many times — diminishing returns + audience burnout.",
    template: {
      name: "Frequency cap reached",
      description:
        "Pause ad-sets when frequency exceeds 6× — same users seeing the ad over and over wastes budget.",
      severity: "medium",
      enabled: true,
      evaluateOn: "adset",
      conditions: {
        operator: "AND",
        rules: [
          { field: "status", op: "==", value: "ACTIVE" },
          { field: "frequency", op: ">", value: 6 },
        ],
      },
      action: { type: "pause" },
    },
  },

  // ─── Creative ────────────────────────────────────────────────────────────
  {
    id: "tmpl-low-relevance",
    category: "Creative",
    headline: "Alert on below-average ad relevance",
    blurb: "Surface ads where Meta's relevance ranking is BELOW_AVERAGE — usually means low engagement.",
    template: {
      name: "Below-average relevance",
      description:
        "Alert me when an ad's quality_ranking is BELOW_AVERAGE — Meta is signaling poor audience fit and your CPM will rise.",
      severity: "low",
      enabled: true,
      evaluateOn: "ad",
      conditions: {
        operator: "AND",
        rules: [
          { field: "status", op: "==", value: "ACTIVE" },
          { field: "relevance_score", op: "==", value: "BELOW_AVERAGE" },
        ],
      },
      action: { type: "alert" },
    },
  },
  {
    id: "tmpl-top-ctr-ad",
    category: "Creative",
    headline: "Highlight top-CTR winners",
    blurb: "Get an alert when a single ad's CTR is exceptional — candidate for scaling.",
    template: {
      name: "Top-CTR ad",
      description:
        "Alert me when an active ad's CTR exceeds 3% — strong winners worth scaling.",
      severity: "low",
      enabled: true,
      evaluateOn: "ad",
      conditions: {
        operator: "AND",
        rules: [
          { field: "status", op: "==", value: "ACTIVE" },
          { field: "ctr", op: ">", value: 3 },
          { field: "impressions", op: ">", value: 1000 },
        ],
      },
      action: { type: "alert" },
    },
  },

  // ─── Delivery ────────────────────────────────────────────────────────────
  {
    id: "tmpl-disapproved",
    category: "Delivery",
    headline: "Pause disapproved ads",
    blurb: "Auto-pause ads Meta has disapproved — they aren't delivering anyway.",
    template: {
      name: "Ad disapproved",
      description:
        "Pause ads with review_status = DISAPPROVED — they're already not delivering, but pausing keeps your account tidy and reportable.",
      severity: "high",
      enabled: true,
      evaluateOn: "ad",
      conditions: {
        operator: "AND",
        rules: [
          { field: "review_status", op: "==", value: "DISAPPROVED" },
        ],
      },
      action: { type: "pause" },
    },
  },
  {
    id: "tmpl-learning-stuck",
    category: "Delivery",
    headline: "Alert on stuck-learning ad-sets",
    blurb: "Get notified when an ad-set is stuck in LEARNING_LIMITED after meaningful spend.",
    template: {
      name: "Learning Limited after spend",
      description:
        "Alert me when an ad-set's learning_status is LEARNING_LIMITED after spending ₹1000 — Meta can't optimise it without intervention.",
      severity: "high",
      enabled: true,
      evaluateOn: "adset",
      conditions: {
        operator: "AND",
        rules: [
          { field: "learning_status", op: "==", value: "LEARNING_LIMITED" },
          { field: "spend", op: ">", value: 100000 },
        ],
      },
      action: { type: "alert" },
    },
  },
  {
    id: "tmpl-zero-impressions",
    category: "Delivery",
    headline: "Pause active-but-silent campaigns",
    blurb: "Pause campaigns that are ACTIVE but receiving zero impressions — usually a delivery or budget setup issue.",
    template: {
      name: "Active but no impressions",
      description:
        "Pause active campaigns with zero impressions — Meta isn't serving them, so the spend reserved on Meta's side is doing nothing.",
      severity: "high",
      enabled: true,
      evaluateOn: "campaign",
      conditions: {
        operator: "AND",
        rules: [
          { field: "status", op: "==", value: "ACTIVE" },
          { field: "impressions", op: "==", value: 0 },
        ],
      },
      action: { type: "pause" },
    },
  },
  {
    id: "tmpl-tiny-audience",
    category: "Delivery",
    headline: "Alert on too-small audiences",
    blurb: "Alert when an ad-set's audience is below a useful learning threshold.",
    template: {
      name: "Audience too small",
      description:
        "Alert me when an ad-set's audience size is below 100,000 — too narrow for Meta's algorithm to optimise efficiently.",
      severity: "low",
      enabled: true,
      evaluateOn: "adset",
      conditions: {
        operator: "AND",
        rules: [
          { field: "audience_size", op: "<", value: 100000 },
        ],
      },
      action: { type: "alert" },
    },
  },
];

/**
 * Returns the catalog as a plain array for the GET /rule-templates
 * endpoint. Public to logged-in users — no per-user data.
 */
function listTemplates() {
  return TEMPLATES.map((t) => ({ ...t }));
}

module.exports = { listTemplates, TEMPLATES };
