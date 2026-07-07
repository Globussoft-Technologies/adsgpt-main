/**
 * TikTok campaign objectives config — the single source of truth that maps
 * TikTok Ads Manager's user-facing objectives to the Marketing API
 * `objective_type` values, grouped by funnel stage, with the optimization
 * goals / CTAs / billing events valid for each.
 *
 * Drives BOTH the create wizard (which options to show) and backend validation
 * (what combinations are allowed) so the lists live in one place.
 *
 * Source: confirmed against the TikTok Ads Manager "Create campaign" UI
 * (Awareness / Consideration / Conversion groups) + Marketing API v1.3.
 *
 * ⚠️ The `objective_type` values are stable and well-established. The
 * `optimizationGoals`, `billingEvents`, and `subTypes[].objectiveType` values
 * follow API v1.3 docs and should be re-verified against the LIVE API once
 * OAuth is connected — field-level enum values are the part most likely to
 * need a small tweak.
 */

const FUNNEL_GROUPS = {
  AWARENESS: "Awareness",
  CONSIDERATION: "Consideration",
  CONVERSION: "Conversion",
};

const BUDGET_MODES = {
  DAILY: "BUDGET_MODE_DAY",
  LIFETIME: "BUDGET_MODE_TOTAL",
  INFINITE: "BUDGET_MODE_INFINITE",
};

// Standard TikTok call-to-action values used on ad creatives.
const TIKTOK_CTAS = [
  "LEARN_MORE",
  "DOWNLOAD_NOW",
  "SHOP_NOW",
  "SIGN_UP",
  "CONTACT_US",
  "APPLY_NOW",
  "BOOK_NOW",
  "PLAY_GAME",
  "WATCH_NOW",
  "READ_MORE",
  "VIEW_NOW",
  "GET_QUOTE",
  "ORDER_NOW",
  "INSTALL_NOW",
  "GET_SHOWTIMES",
  "LISTEN_NOW",
  "INTERESTED",
  "SUBSCRIBE",
  "GET_TICKETS_NOW",
  "EXPERIENCE_NOW",
  "PRE_ORDER_NOW",
  "VISIT_STORE",
];

/**
 * The 7 TikTok objectives, grouped by funnel stage (matches the TikTok UI).
 * `hasSubType: true` means the objective shows an extra sub-choice step in the
 * UI (the `>` chevron in TikTok's create flow).
 */
const TIKTOK_OBJECTIVES = [
  // ─── Awareness ───
  {
    key: "REACH",
    label: "Reach",
    group: FUNNEL_GROUPS.AWARENESS,
    objectiveType: "REACH",
    description: "Show your ad to the maximum number of people.",
    hasSubType: false,
    optimizationGoals: ["REACH"],
    billingEvents: ["CPM"],
    requiresCta: false,
    defaultBudgetMode: BUDGET_MODES.DAILY,
  },

  // ─── Consideration ───
  {
    key: "TRAFFIC",
    label: "Traffic",
    group: FUNNEL_GROUPS.CONSIDERATION,
    objectiveType: "TRAFFIC",
    description: "Send people to a destination like your website or app.",
    hasSubType: true, // destination: website / app
    subTypes: [
      { key: "WEBSITE", label: "Website", promotionType: "WEBSITE" },
      { key: "APP", label: "App", promotionType: "APP_ANDROID" },
    ],
    // "LANDING_PAGE" is not a valid v1.3 enum; CLICK works without a pixel.
    // (Landing-page-view optimization needs a pixel, so it's omitted here.)
    optimizationGoals: ["CLICK"],
    billingEvents: ["CPC", "CPM"],
    requiresCta: true,
    defaultBudgetMode: BUDGET_MODES.DAILY,
  },
  {
    key: "VIDEO_VIEWS",
    label: "Video views",
    group: FUNNEL_GROUPS.CONSIDERATION,
    objectiveType: "VIDEO_VIEWS",
    description: "Get more views and engagement for your videos.",
    hasSubType: false,
    // v1.3 no longer accepts "VIDEO_VIEW" as an ad-group optimization_goal —
    // use "ENGAGED_VIEW" (6-second focused view). CPV billing.
    optimizationGoals: ["ENGAGED_VIEW"],
    billingEvents: ["CPV", "CPM"],
    requiresCta: true,
    defaultBudgetMode: BUDGET_MODES.DAILY,
    // TikTok Ads Manager only shows "Add videos" for this objective — no
    // image upload option (confirmed in the live UI).
    videoOnly: true,
  },
  {
    key: "ENGAGEMENT",
    label: "Community interaction",
    group: FUNNEL_GROUPS.CONSIDERATION,
    objectiveType: "ENGAGEMENT",
    description: "Get more followers and engagement on your TikTok account.",
    hasSubType: false,
    // Community Interaction runs only via Spark Ads (boosting an existing
    // organic TikTok video post), which structurally excludes images.
    videoOnly: true,
    // Confirmed via TikTok's official "Create Community Interaction ads" doc:
    // FOLLOWERS (Follow, billed OCPM) and PAGE_VISIT (TikTok page visits,
    // billed CPC) are the only two valid ad-group optimization goals.
    optimizationGoals: ["FOLLOWERS", "PAGE_VISIT"],
    billingEvents: ["OCPM", "CPC"],
    requiresCta: true,
    defaultBudgetMode: BUDGET_MODES.DAILY,
  },

  // ─── Conversion ───
  {
    key: "APP_PROMOTION",
    label: "App promotion",
    group: FUNNEL_GROUPS.CONVERSION,
    objectiveType: "APP_PROMOTION",
    description: "Get people to install or take action in your app.",
    hasSubType: true, // app install vs app retargeting
    subTypes: [
      { key: "APP_INSTALL", label: "App install" },
      { key: "APP_RETARGETING", label: "App retargeting" },
    ],
    optimizationGoals: ["INSTALL", "IN_APP_EVENT", "CLICK"],
    billingEvents: ["CPC", "OCPM"],
    requiresCta: true,
    defaultBudgetMode: BUDGET_MODES.DAILY,
  },
  {
    key: "LEAD_GENERATION",
    label: "Lead generation",
    group: FUNNEL_GROUPS.CONVERSION,
    objectiveType: "LEAD_GENERATION",
    description: "Collect leads via an instant form or your website.",
    hasSubType: true, // instant form vs website
    subTypes: [
      {
        key: "INSTANT_FORM",
        label: "Instant form (TikTok)",
        promotionTargetType: "INSTANT_PAGE",
        optimizationGoal: "LEADS",
      },
      {
        key: "WEBSITE",
        label: "Website form",
        promotionTargetType: "EXTERNAL_WEBSITE",
        optimizationGoal: "CONVERT",
      },
    ],
    // "LEAD" is not valid. Website lead path → CONVERT (needs a pixel + lead
    // event); instant-form path → LEADS (needs a TikTok instant form).
    optimizationGoals: ["CONVERT", "LEADS"],
    billingEvents: ["OCPM"],
    requiresCta: true,
    defaultBudgetMode: BUDGET_MODES.DAILY,
  },
  {
    key: "PRODUCT_SALES",
    label: "Sales",
    group: FUNNEL_GROUPS.CONVERSION,
    objectiveType: "PRODUCT_SALES",
    description: "Drive purchases on your website, app, or TikTok Shop.",
    hasSubType: true, // conversion location: website / app / TikTok Shop
    subTypes: [
      { key: "WEBSITE", label: "Website", objectiveType: "WEB_CONVERSIONS" },
      { key: "APP", label: "App", objectiveType: "PRODUCT_SALES" },
      { key: "SHOP", label: "TikTok Shop", objectiveType: "PRODUCT_SALES" },
    ],
    optimizationGoals: ["CONVERT", "VALUE"],
    billingEvents: ["OCPM"],
    requiresCta: true,
    defaultBudgetMode: BUDGET_MODES.DAILY,
  },
];

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Look up one objective by its key (e.g. "TRAFFIC"). */
function getObjectiveByKey(key) {
  return TIKTOK_OBJECTIVES.find((o) => o.key === key) || null;
}

/** Group the objectives by funnel stage → { Awareness: [...], ... }. */
function getObjectivesByGroup() {
  return TIKTOK_OBJECTIVES.reduce((acc, o) => {
    (acc[o.group] = acc[o.group] || []).push(o);
    return acc;
  }, {});
}

/** True if a given API objective_type (incl. sub-type values) is recognised. */
function isValidObjectiveType(objectiveType) {
  return TIKTOK_OBJECTIVES.some(
    (o) =>
      o.objectiveType === objectiveType ||
      (o.subTypes || []).some((s) => s.objectiveType === objectiveType)
  );
}

module.exports = {
  FUNNEL_GROUPS,
  BUDGET_MODES,
  TIKTOK_CTAS,
  TIKTOK_OBJECTIVES,
  getObjectiveByKey,
  getObjectivesByGroup,
  isValidObjectiveType,
};
