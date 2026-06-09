/**
 * cellInference — derive the V2 wizard "cell" (objective × conversionLocation)
 * from an existing Meta campaign + ad set.
 *
 * Shared single source of truth between:
 *   - Ad Factory V2 (`adControllerV2.createAdV2`) — picks the creative shape
 *     for ads posted under a campaign the user already created.
 *   - Campaign management (`metaAdLauncherV2.resolveCellForAdSet`) — lets the
 *     "Add Ad" / edit flows know which cell schema to render for an existing
 *     ad set.
 *
 * V2 covers OUTCOME_TRAFFIC, OUTCOME_LEADS, OUTCOME_APP_PROMOTION, and
 * OUTCOME_ENGAGEMENT (MVP cells — Messenger, WhatsApp, Calls, Video views,
 * Post engagement). Other objectives still flow through the V1 endpoints
 * until migrated.
 */

const { getCell, isCellImplemented } = require("../../config/wizardSchema");

// V2-migrated objectives. Anything else returns an error from the inferer.
const SUPPORTED_OBJECTIVES = new Set([
  "OUTCOME_TRAFFIC",
  "OUTCOME_LEADS",
  "OUTCOME_APP_PROMOTION",
  "OUTCOME_ENGAGEMENT",
]);

// destination_type → conversionLocation. Some destinations resolve
// per-objective (PHONE_CALL means CALLS on Leads, PHONE_CALL on Traffic —
// different cells), which is why this is a function not a map.
//
// Engagement-specific edge: destination_type=ON_AD covers TWO Engagement
// cells (VIDEO_VIEWS + POST_ENGAGEMENT). This helper returns `null` for
// (OUTCOME_ENGAGEMENT, ON_AD) — `inferCellForMetaCampaign` does the
// optimisation_goal-based disambiguation in the same function, since the
// helper only sees the destination string.
function destinationToConversionLocation(objective, destinationType) {
  switch (destinationType) {
    case "WEBSITE":
      return "WEBSITE";
    case "APP":
      return "APP";
    case "MESSENGER":
      return "MESSENGER";
    case "WHATSAPP":
      return "WHATSAPP";
    case "INSTAGRAM_DIRECT":
      return "INSTAGRAM";
    case "ON_AD":
      // Engagement uses ON_AD for both Video views and Post engagement —
      // the caller disambiguates by optimization_goal.
      return objective === "OUTCOME_ENGAGEMENT" ? null : "INSTANT_FORM";
    case "PHONE_CALL":
      return objective === "OUTCOME_LEADS" ? "CALLS" : "PHONE_CALL";
    default:
      return null;
  }
}

// Given the Meta campaign + ad set, return the wizard cell to use. Returns
// `{ error }` when the campaign uses an objective/destination V2 doesn't
// yet support.
function inferCellForMetaCampaign(metaCampaign, metaAdSet) {
  const objective = String(metaCampaign?.objective || "").toUpperCase();
  if (!SUPPORTED_OBJECTIVES.has(objective)) {
    return {
      error: `Unsupported campaign objective "${objective || "(none)"}". V2 currently supports Traffic, Leads, App Promotion, and Engagement campaigns.`,
    };
  }
  const destinationType = metaAdSet?.destination_type || null;
  const optimizationGoal = String(metaAdSet?.optimization_goal || "").toUpperCase();
  let conversionLocation = destinationToConversionLocation(
    objective,
    destinationType,
  );
  // Engagement/ON_AD disambiguation — both VIDEO_VIEWS and POST_ENGAGEMENT
  // ride destination_type=ON_AD, so the helper returns null and we look at
  // the optimisation goal to pick the cell. THRUPLAY (or 2-sec views) →
  // VIDEO_VIEWS; POST_ENGAGEMENT → POST_ENGAGEMENT. Default to VIDEO_VIEWS
  // when neither matches (e.g. a legacy goal) so management flows still
  // resolve.
  if (
    !conversionLocation &&
    objective === "OUTCOME_ENGAGEMENT" &&
    destinationType === "ON_AD"
  ) {
    conversionLocation =
      optimizationGoal === "POST_ENGAGEMENT" ? "POST_ENGAGEMENT" : "VIDEO_VIEWS";
  }
  // Engagement/WEBSITE disambiguation — both WEBSITE (pixel-conversions
  // cell) and INSTAGRAM_OR_FACEBOOK (profile-visit cell) map to
  // destination_type=WEBSITE. The optimisation goal distinguishes:
  // profile-visit goals → INSTAGRAM_OR_FACEBOOK; everything else →
  // WEBSITE. Same disambiguation shape as the ON_AD case above.
  if (
    objective === "OUTCOME_ENGAGEMENT" &&
    destinationType === "WEBSITE" &&
    (optimizationGoal === "PAGE_LIKES" ||
      optimizationGoal === "VISIT_INSTAGRAM_PROFILE")
  ) {
    conversionLocation = "INSTAGRAM_OR_FACEBOOK";
  }
  // Fall back to the most common cell per objective when destination_type
  // is missing — covers ad sets created without an explicit destination.
  if (!conversionLocation) {
    if (objective === "OUTCOME_TRAFFIC") conversionLocation = "WEBSITE";
    else if (objective === "OUTCOME_APP_PROMOTION") conversionLocation = "APP";
    else if (objective === "OUTCOME_LEADS") conversionLocation = "INSTANT_FORM";
    else if (objective === "OUTCOME_ENGAGEMENT") conversionLocation = "VIDEO_VIEWS";
  }
  if (!isCellImplemented(objective, conversionLocation)) {
    return {
      error: `No V2 cell implementation for (${objective}, ${conversionLocation}). Try a campaign with a supported destination.`,
    };
  }
  return {
    objective,
    conversionLocation,
    cell: getCell(objective, conversionLocation),
  };
}

module.exports = {
  SUPPORTED_OBJECTIVES,
  destinationToConversionLocation,
  inferCellForMetaCampaign,
};
