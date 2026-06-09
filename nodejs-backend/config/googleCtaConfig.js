const GOOGLE_OBJECTIVES = {
  // ── UI goal labels ───────────────────────────────────────────────────────────
  SALES:           "Sales",
  LEADS:           "Leads",
  WEBSITE_TRAFFIC: "Website traffic",
  APP_PROMOTION:   "App promotion",
  LOCAL_STORE:     "Local store visits",
  // ── Raw channel types ────────────────────────────────────────────────────────
  SEARCH:          "Search",
  DISPLAY:         "Display",
  PERFORMANCE_MAX: "Performance Max",
  SHOPPING:        "Shopping",
  MULTI_CHANNEL:   "Multi-channel",
};

const GOOGLE_CTA_LABELS = {
  LEARN_MORE:     "Learn more",
  GET_QUOTE:      "Get quote",
  APPLY_NOW:      "Apply now",
  SIGN_UP:        "Sign up",
  CONTACT_US:     "Contact us",
  SUBSCRIBE:      "Subscribe",
  BOOK_NOW:       "Book now",
  SHOP_NOW:       "Shop now",
  DOWNLOAD:       "Download",
  VISIT_SITE:     "Visit site",
  INSTALL:        "Install",
  GET_DIRECTIONS: "Get directions",
  CALL_NOW:       "Call now",
};

// Allowed CTAs per Google Ads objective.
// UI goal labels (SALES, LEADS, etc.) and raw channel types (SEARCH, DISPLAY, etc.) are both supported.
const GOOGLE_CTA_MAP = {
  // ── Raw channel types ────────────────────────────────────────────────────────
  SEARCH:          ["LEARN_MORE", "GET_QUOTE", "APPLY_NOW", "SIGN_UP", "CONTACT_US", "SUBSCRIBE", "BOOK_NOW", "SHOP_NOW", "DOWNLOAD"],
  DISPLAY:         ["LEARN_MORE", "GET_QUOTE", "APPLY_NOW", "SIGN_UP", "CONTACT_US", "SUBSCRIBE", "BOOK_NOW", "SHOP_NOW", "DOWNLOAD", "VISIT_SITE"],
  PERFORMANCE_MAX: ["LEARN_MORE", "GET_QUOTE", "APPLY_NOW", "SIGN_UP", "CONTACT_US", "SUBSCRIBE", "BOOK_NOW", "SHOP_NOW", "DOWNLOAD"],
  SHOPPING:        ["SHOP_NOW"],
  MULTI_CHANNEL:   ["DOWNLOAD", "INSTALL", "LEARN_MORE"],

  // ── UI goal labels ───────────────────────────────────────────────────────────
  SALES:           ["SHOP_NOW", "GET_QUOTE", "LEARN_MORE", "BOOK_NOW", "SUBSCRIBE"],
  LEADS:           ["GET_QUOTE", "APPLY_NOW", "SIGN_UP", "CONTACT_US", "SUBSCRIBE", "BOOK_NOW", "LEARN_MORE"],
  WEBSITE_TRAFFIC: ["LEARN_MORE", "VISIT_SITE", "GET_QUOTE", "SIGN_UP", "CONTACT_US"],
  APP_PROMOTION:   ["DOWNLOAD", "INSTALL", "LEARN_MORE"],
  LOCAL_STORE:     ["GET_DIRECTIONS", "CALL_NOW", "LEARN_MORE", "BOOK_NOW"],
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
