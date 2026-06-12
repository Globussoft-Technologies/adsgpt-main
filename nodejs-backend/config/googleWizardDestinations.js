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

module.exports = {
  WIZARD_OBJECTIVE_KEYS,
  OBJECTIVE_DESTINATIONS,
  DESTINATION_META,
  CHANNEL_TYPES,
  BUSINESS_GOALS,
  buildDestinationOption,
  getDestinationsForObjective,
  isAllowedDestination,
  splitChannelToWizardForm,
  resolveCampaignObjectiveFromForm,
};
