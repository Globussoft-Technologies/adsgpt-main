/**
 * Google Ads wizard — business objective → allowed destination (channel) mapping.
 * Mirrors Meta's objective → conversionLocation pattern.
 */

const { GOOGLE_OBJECTIVES } = require("./googleCtaConfig");

/** Step-1 objectives only (business goals — not raw channel types). */
const WIZARD_OBJECTIVE_KEYS = [
  "SALES",
  "LEADS",
  "WEBSITE_TRAFFIC",
  "APP_PROMOTION",
  "LOCAL_STORE",
  "YOUTUBE_REACH",
];

/** Channel types used as destinations (step 2). */
const DESTINATION_META = {
  SEARCH: {
    label: "Search",
    description: "Show text ads on Google Search when people look for what you offer.",
  },
  DISPLAY: {
    label: "Display",
    description: "Reach audiences with image ads across websites, apps, and Gmail.",
  },
  YOUTUBE_REACH: {
    label: "YouTube & Demand Gen",
    description: "Video ads on YouTube, Discover, and the Google Display Network.",
  },
  PERFORMANCE_MAX: {
    label: "Performance Max",
    description: "AI-optimized ads across Search, Display, YouTube, and more.",
  },
  SHOPPING: {
    label: "Shopping",
    description: "Product ads from your Merchant Center catalog.",
  },
  APP_PROMOTION: {
    label: "App",
    description: "Drive installs and engagement for your mobile app.",
  },
};

/** Which destinations are valid for each business objective. */
const OBJECTIVE_DESTINATIONS = {
  SALES:           ["SEARCH", "PERFORMANCE_MAX", "SHOPPING"],
  LEADS:           ["SEARCH", "PERFORMANCE_MAX", "DISPLAY"],
  WEBSITE_TRAFFIC: ["SEARCH", "DISPLAY", "PERFORMANCE_MAX", "YOUTUBE_REACH"],
  APP_PROMOTION:   ["APP_PROMOTION"],
  LOCAL_STORE:     ["SEARCH", "PERFORMANCE_MAX"],
  YOUTUBE_REACH:   ["YOUTUBE_REACH"],
};

const CHANNEL_TYPES = new Set([
  "SEARCH", "DISPLAY", "SHOPPING", "PERFORMANCE_MAX",
  "VIDEO", "DEMAND_GEN", "MULTI_CHANNEL", "YOUTUBE_REACH", "APP_PROMOTION",
]);

const BUSINESS_GOALS = new Set(WIZARD_OBJECTIVE_KEYS);

/**
 * Conversion goals available per business objective.
 * These are shown on Step 3 (Goal) of the 2026 wizard flow.
 * Only objectives with meaningful goal choices get an entry — others skip Step 3.
 */
const OBJECTIVE_GOALS = {
  SALES: [
    { value: "PURCHASE",      label: "Purchase",       description: "Track completed purchases on your website or app.",  recommendedBidding: "MAXIMIZE_CONVERSIONS" },
    { value: "SUBSCRIPTION",  label: "Subscription",   description: "Drive recurring subscription sign-ups.",             recommendedBidding: "MAXIMIZE_CONVERSIONS" },
    { value: "ADD_TO_CART",   label: "Add to cart",    description: "Capture intent before the final purchase step.",     recommendedBidding: "MAXIMIZE_CONVERSIONS" },
    { value: "CHECKOUT",      label: "Checkout",       description: "Optimise for the checkout initiation event.",        recommendedBidding: "MAXIMIZE_CONVERSIONS" },
  ],
  LEADS: [
    { value: "LEAD_FORM",     label: "Lead form",      description: "Collect contact details via a Google-hosted form.",  recommendedBidding: "MAXIMIZE_CONVERSIONS" },
    { value: "PHONE_CALL",    label: "Phone call",     description: "Drive calls directly from your ad.",                 recommendedBidding: "MAXIMIZE_CONVERSIONS" },
    { value: "BOOK_DEMO",     label: "Book a demo",    description: "Encourage prospects to schedule a meeting.",         recommendedBidding: "TARGET_CPA" },
    { value: "CONTACT_FORM",  label: "Contact form",   description: "Optimise for form submissions on your site.",        recommendedBidding: "MAXIMIZE_CONVERSIONS" },
  ],
  WEBSITE_TRAFFIC: [
    { value: "PAGE_VIEW",         label: "Page view",         description: "Maximise visits to any page on your site.",           recommendedBidding: "MAXIMIZE_CLICKS" },
    { value: "LANDING_PAGE_VIEW", label: "Landing page view", description: "Focus on visitors who load the full landing page.",   recommendedBidding: "MAXIMIZE_CLICKS" },
    { value: "WEBSITE_VISIT",     label: "Website visit",     description: "Drive general site traffic.",                         recommendedBidding: "MAXIMIZE_CLICKS" },
  ],
  APP_PROMOTION: [
    { value: "INSTALL",       label: "App install",    description: "Maximise new installs of your app.",                  recommendedBidding: "MAXIMIZE_CONVERSIONS" },
    { value: "REGISTRATION",  label: "Registration",   description: "Drive in-app sign-up or registration events.",        recommendedBidding: "MAXIMIZE_CONVERSIONS" },
    { value: "IN_APP_ACTION", label: "In-app action",  description: "Optimise for a custom event inside the app.",         recommendedBidding: "TARGET_CPA" },
  ],
  YOUTUBE_REACH: [
    { value: "REACH",           label: "Reach",           description: "Maximise the number of unique users who see your ad.", recommendedBidding: "MAXIMIZE_CLICKS" },
    { value: "IMPRESSIONS",     label: "Impressions",     description: "Optimise for total ad impressions.",                  recommendedBidding: "MAXIMIZE_CLICKS" },
    { value: "BRAND_AWARENESS", label: "Brand awareness", description: "Build familiarity with your brand at scale.",         recommendedBidding: "MAXIMIZE_CLICKS" },
  ],
};

/**
 * Which campaign types (destinations) are valid per conversion goal.
 * When a goal is selected, only these destinations are shown.
 * null = no restriction (show all destinations for the objective).
 */
const GOAL_DESTINATIONS = {
  // SALES goals
  PURCHASE:      ["SEARCH", "PERFORMANCE_MAX", "SHOPPING"],
  SUBSCRIPTION:  ["SEARCH", "PERFORMANCE_MAX"],
  ADD_TO_CART:   ["SEARCH", "PERFORMANCE_MAX", "SHOPPING"],
  CHECKOUT:      ["SEARCH", "PERFORMANCE_MAX"],
  // LEADS goals
  LEAD_FORM:     ["SEARCH", "PERFORMANCE_MAX", "DISPLAY"],
  PHONE_CALL:    ["SEARCH"],
  BOOK_DEMO:     ["SEARCH", "DISPLAY"],
  CONTACT_FORM:  ["SEARCH", "PERFORMANCE_MAX", "DISPLAY"],
  // WEBSITE_TRAFFIC goals
  PAGE_VIEW:          ["SEARCH", "DISPLAY", "PERFORMANCE_MAX", "YOUTUBE_REACH"],
  LANDING_PAGE_VIEW:  ["SEARCH", "PERFORMANCE_MAX"],
  WEBSITE_VISIT:      ["SEARCH", "DISPLAY", "PERFORMANCE_MAX", "YOUTUBE_REACH"],
  // APP goals
  INSTALL:       ["APP_PROMOTION"],
  REGISTRATION:  ["APP_PROMOTION"],
  IN_APP_ACTION: ["APP_PROMOTION"],
  // YOUTUBE goals
  REACH:          ["YOUTUBE_REACH"],
  IMPRESSIONS:    ["YOUTUBE_REACH"],
  BRAND_AWARENESS:["YOUTUBE_REACH"],
};

function buildDestinationOption(value) {
  const meta = DESTINATION_META[value] || {};
  return {
    value,
    label: meta.label || GOOGLE_OBJECTIVES[value] || value,
    description: meta.description || "",
  };
}

function getDestinationsForObjective(objective) {
  const key = String(objective || "").toUpperCase().replace(/ /g, "_");
  const allowed = OBJECTIVE_DESTINATIONS[key];
  if (!allowed?.length) return [];
  return allowed.map(buildDestinationOption);
}

function isAllowedDestination(objective, destination) {
  const dests = OBJECTIVE_DESTINATIONS[String(objective || "").toUpperCase().replace(/ /g, "_")];
  if (!dests?.length) return false;
  return dests.includes(String(destination || "").toUpperCase().replace(/ /g, "_"));
}

/**
 * Map API channel objective (from campaign list) back to wizard { objective, destination }.
 */
function splitChannelToWizardForm(channelObjective) {
  const ch = String(channelObjective || "").toUpperCase().replace(/ /g, "_");
  if (!ch) return { objective: "", destination: "" };

  if (BUSINESS_GOALS.has(ch)) {
    const dests = OBJECTIVE_DESTINATIONS[ch];
    return { objective: ch, destination: dests?.[0] || "" };
  }

  if (!CHANNEL_TYPES.has(ch)) {
    return { objective: "WEBSITE_TRAFFIC", destination: "SEARCH" };
  }

  const objectiveByChannel = {
    SEARCH: "WEBSITE_TRAFFIC",
    DISPLAY: "WEBSITE_TRAFFIC",
    SHOPPING: "SALES",
    PERFORMANCE_MAX: "SALES",
    YOUTUBE_REACH: "YOUTUBE_REACH",
    VIDEO: "YOUTUBE_REACH",
    DEMAND_GEN: "YOUTUBE_REACH",
    MULTI_CHANNEL: "APP_PROMOTION",
    APP_PROMOTION: "APP_PROMOTION",
  };

  return {
    objective: objectiveByChannel[ch] || "WEBSITE_TRAFFIC",
    destination: ch === "MULTI_CHANNEL" ? "APP_PROMOTION" : ch,
  };
}

/** Value sent to create-campaign API from wizard form. */
function resolveCampaignObjectiveFromForm(form) {
  const objective = String(form?.objective || "").toUpperCase().replace(/ /g, "_");
  const destination = String(form?.destination || "").toUpperCase().replace(/ /g, "_");

  if (!destination) return objective;

  if (BUSINESS_GOALS.has(objective) && destination === "SEARCH") return objective;
  if (objective === "LOCAL_STORE" && destination === "SEARCH") return objective;

  return destination;
}

function getGoalsForObjective(objective) {
  const key = String(objective || "").toUpperCase().replace(/ /g, "_");
  return OBJECTIVE_GOALS[key] || [];
}

module.exports = {
  WIZARD_OBJECTIVE_KEYS,
  OBJECTIVE_DESTINATIONS,
  OBJECTIVE_GOALS,
  GOAL_DESTINATIONS,
  DESTINATION_META,
  CHANNEL_TYPES,
  BUSINESS_GOALS,
  buildDestinationOption,
  getDestinationsForObjective,
  getGoalsForObjective,
  isAllowedDestination,
  splitChannelToWizardForm,
  resolveCampaignObjectiveFromForm,
};
