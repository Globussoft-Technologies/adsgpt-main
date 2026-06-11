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
  // Engagement video-views vs post-engagement disambiguation. Meta rejects
  // destination_type=ON_AD for OUTCOME_ENGAGEMENT (subcode 1815715), so
  // we OMIT destination_type for these cells — Meta infers from
  // optimization_goal. That means reverse-inference has nothing on
  // destination_type to go on either. Use optimization_goal directly:
  // POST_ENGAGEMENT → POST_ENGAGEMENT cell; THRUPLAY / 2-sec views →
  // VIDEO_VIEWS cell. (Legacy ad sets that carry destination_type=ON_AD
  // — created before this fix — still hit this branch via the empty
  // destinationType fallthrough.)
  if (
    !conversionLocation &&
    objective === "OUTCOME_ENGAGEMENT" &&
    (destinationType === "ON_AD" || !destinationType) &&
    (optimizationGoal === "POST_ENGAGEMENT" ||
      optimizationGoal === "THRUPLAY" ||
      optimizationGoal === "TWO_SECOND_CONTINUOUS_VIDEO_VIEWS")
  ) {
    conversionLocation =
      optimizationGoal === "POST_ENGAGEMENT" ? "POST_ENGAGEMENT" : "VIDEO_VIEWS";
  }
  // (Engagement/INSTAGRAM_OR_FACEBOOK disambiguation was removed along with
  // the cell — see wizardSchema.js. Profile-visit goals PAGE_LIKES and
  // VISIT_INSTAGRAM_PROFILE were rejected by Meta with subcode 2490408,
  // making the cell unusable. Engagement/WEBSITE now resolves directly.)
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
