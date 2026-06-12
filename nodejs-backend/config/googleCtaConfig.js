const GOOGLE_OBJECTIVES = {
  // ── UI goal labels ───────────────────────────────────────────────────────────
  SALES:           "Sales",
  LEADS:           "Leads",
  WEBSITE_TRAFFIC: "Website traffic",
  APP_PROMOTION:   "App promotion",
  LOCAL_STORE:     "Local store visits",
  YOUTUBE_REACH:   "YouTube reach, views and engagements",
  // ── Raw channel types ────────────────────────────────────────────────────────
  SEARCH:          "Search",
  DISPLAY:         "Display",
  PERFORMANCE_MAX: "Performance Max",
  SHOPPING:        "Shopping",
  VIDEO:           "Video",
  DEMAND_GEN:      "Demand Gen",
  MULTI_CHANNEL:   "Multi-channel",
};

// All valid values from Google Ads API v23 CallToActionTypeEnum
// Source: google/ads/googleads/v23/enums/call_to_action_type.proto
// INSTALL, GET_DIRECTIONS, CALL_NOW are NOT valid Google Ads CTA enum values — removed.
const GOOGLE_CTA_LABELS = {
  LEARN_MORE:  "Learn more",
  GET_QUOTE:   "Get quote",
  APPLY_NOW:   "Apply now",
  SIGN_UP:     "Sign up",
  CONTACT_US:  "Contact us",
  SUBSCRIBE:   "Subscribe",
  DOWNLOAD:    "Download",
  BOOK_NOW:    "Book now",
  SHOP_NOW:    "Shop now",
  BUY_NOW:     "Buy now",
  DONATE_NOW:  "Donate now",
  ORDER_NOW:   "Order now",
  PLAY_NOW:    "Play now",
  SEE_MORE:    "See more",
  START_NOW:   "Start now",
  VISIT_SITE:  "Visit site",
  WATCH_NOW:   "Watch now",
};

// Allowed CTAs per Google Ads objective.
// Only uses values present in the official v23 CallToActionTypeEnum.
const GOOGLE_CTA_MAP = {
  // ── Raw channel types ────────────────────────────────────────────────────────
  SEARCH:          ["LEARN_MORE", "GET_QUOTE", "APPLY_NOW", "SIGN_UP", "CONTACT_US", "SUBSCRIBE", "BOOK_NOW", "SHOP_NOW", "BUY_NOW", "ORDER_NOW", "DOWNLOAD", "START_NOW"],
  DISPLAY:         ["LEARN_MORE", "GET_QUOTE", "APPLY_NOW", "SIGN_UP", "CONTACT_US", "SUBSCRIBE", "BOOK_NOW", "SHOP_NOW", "BUY_NOW", "DONATE_NOW", "ORDER_NOW", "DOWNLOAD", "VISIT_SITE", "SEE_MORE"],
  PERFORMANCE_MAX: ["LEARN_MORE", "GET_QUOTE", "APPLY_NOW", "SIGN_UP", "CONTACT_US", "SUBSCRIBE", "BOOK_NOW", "SHOP_NOW", "BUY_NOW", "ORDER_NOW", "DOWNLOAD", "START_NOW"],
  SHOPPING:        ["SHOP_NOW", "BUY_NOW", "ORDER_NOW", "SEE_MORE"],
  MULTI_CHANNEL:   ["DOWNLOAD", "LEARN_MORE", "PLAY_NOW"],
  VIDEO:           ["LEARN_MORE", "WATCH_NOW", "SHOP_NOW", "SIGN_UP", "DOWNLOAD", "VISIT_SITE"],
  DEMAND_GEN:      ["LEARN_MORE", "WATCH_NOW", "SHOP_NOW", "SIGN_UP", "DOWNLOAD", "VISIT_SITE"],
  YOUTUBE_REACH:   ["LEARN_MORE", "WATCH_NOW", "VISIT_SITE", "SIGN_UP", "SUBSCRIBE"],

  // ── UI goal labels ───────────────────────────────────────────────────────────
  SALES:           ["SHOP_NOW", "BUY_NOW", "ORDER_NOW", "GET_QUOTE", "LEARN_MORE", "BOOK_NOW", "SUBSCRIBE"],
  LEADS:           ["GET_QUOTE", "APPLY_NOW", "SIGN_UP", "CONTACT_US", "SUBSCRIBE", "BOOK_NOW", "LEARN_MORE", "START_NOW", "DONATE_NOW"],
  WEBSITE_TRAFFIC: ["LEARN_MORE", "VISIT_SITE", "GET_QUOTE", "SIGN_UP", "CONTACT_US", "SEE_MORE", "START_NOW"],
  APP_PROMOTION:   ["DOWNLOAD", "PLAY_NOW", "LEARN_MORE"],
  LOCAL_STORE:     ["LEARN_MORE", "BOOK_NOW", "GET_QUOTE", "CONTACT_US", "START_NOW"],
};

// Returns [{ value, label }] for the given objective, or null if unknown.
function getGoogleCtas(objective = "") {
  const key = String(objective).toUpperCase().replace(/ /g, "_");
  const ctas = GOOGLE_CTA_MAP[key];
  if (!ctas) return null;
  return ctas.map((value) => ({ value, label: GOOGLE_CTA_LABELS[value] || value }));
}

// Returns [{ value, label }] for all objectives.
function getGoogleObjectives() {
  return Object.entries(GOOGLE_OBJECTIVES).map(([value, label]) => ({ value, label }));
}

module.exports = { GOOGLE_OBJECTIVES, GOOGLE_CTA_MAP, GOOGLE_CTA_LABELS, getGoogleCtas, getGoogleObjectives };
