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
  "OUTCOME_SALES",
  "OUTCOME_AWARENESS",
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
      error: `Unsupported campaign objective "${objective || "(none)"}". V2 currently supports Awareness, Traffic, Leads, App Promotion, Engagement, and Sales campaigns.`,
    };
  }
  const destinationType = metaAdSet?.destination_type || null;
  const optimizationGoal = String(metaAdSet?.optimization_goal || "").toUpperCase();
  let conversionLocation = destinationToConversionLocation(
    objective,
    destinationType,
  );
  // Engagement video-views vs post-engagement disambiguation. We now send
  // granular destination_types (ON_VIDEO for VIDEO_VIEWS, ON_POST for
  // POST_ENGAGEMENT) — these match Meta's SDK enum and pair with the
  // surface-specific goals. Reverse-inference handles:
  //   • Current path: ON_VIDEO → VIDEO_VIEWS, ON_POST → POST_ENGAGEMENT
  //   • Legacy null-destination ad sets — disambiguate by optimization_goal
  //   • Legacy ON_AD ad sets — same goal-based disambiguation
  if (
    !conversionLocation &&
    objective === "OUTCOME_ENGAGEMENT"
  ) {
    if (destinationType === "ON_VIDEO") {
      conversionLocation = "VIDEO_VIEWS";
    } else if (destinationType === "ON_POST") {
      conversionLocation = "POST_ENGAGEMENT";
    } else if (
      (destinationType === "ON_AD" || !destinationType) &&
      (optimizationGoal === "POST_ENGAGEMENT" ||
        optimizationGoal === "THRUPLAY" ||
        optimizationGoal === "TWO_SECOND_CONTINUOUS_VIDEO_VIEWS")
    ) {
      conversionLocation =
        optimizationGoal === "POST_ENGAGEMENT" ? "POST_ENGAGEMENT" : "VIDEO_VIEWS";
    }
  }
  // Engagement messaging consolidation (Phase 3, 2026-06-18) — mirror of
  // the Sales pattern below. Three legacy cells (MESSENGER + WHATSAPP +
  // INSTAGRAM) were consolidated into MESSAGE_DESTINATIONS to match Meta
  // UI. Any ad set with destination_type=MESSENGER/WHATSAPP/INSTAGRAM_DIRECT
  // on an OUTCOME_ENGAGEMENT campaign — including legacy ad sets created
  // under the per-platform cells — collapses to MESSAGE_DESTINATIONS.
  if (
    objective === "OUTCOME_ENGAGEMENT" &&
    (destinationType === "MESSENGER" ||
      destinationType === "WHATSAPP" ||
      destinationType === "INSTAGRAM_DIRECT")
  ) {
    conversionLocation = "MESSAGE_DESTINATIONS";
  }
  // Engagement/INSTAGRAM_OR_FACEBOOK disambiguation (Phase 3 restoration) —
  // the cell uses destination_type=WEBSITE (same as Traffic/INSTAGRAM_OR_
  // FACEBOOK) but the optimization_goal distinguishes profile-visit campaigns
  // (PAGE_LIKES / VISIT_INSTAGRAM_PROFILE) from generic Engagement/WEBSITE.
  // Without this branch a profile-visit ad set would resolve to WEBSITE and
  // the wizard would render the wrong fields (Pixel + conversion event,
  // neither of which the profile-visit cell uses).
  if (
    objective === "OUTCOME_ENGAGEMENT" &&
    (optimizationGoal === "PAGE_LIKES" ||
      optimizationGoal === "VISIT_INSTAGRAM_PROFILE")
  ) {
    conversionLocation = "INSTAGRAM_OR_FACEBOOK";
  }
  // Sales/CATALOG disambiguation — the catalog cell shares the WEBSITE
  // destination_type's "no value sent" pattern (we omit destination_type
  // and let Meta infer from `promoted_object.product_set_id`). For
  // reverse-inference, `product_set_id` presence in the ad set's
  // promoted_object is the cleanest signal that the cell is CATALOG;
  // checked BEFORE the destination-based fall-through.
  if (
    !conversionLocation &&
    objective === "OUTCOME_SALES" &&
    metaAdSet?.promoted_object?.product_set_id
  ) {
    conversionLocation = "CATALOG";
  }
  // Awareness disambiguation — Meta has no destination_type for Awareness
  // (we omit it on launch; Meta infers from optimization_goal). Reverse-
  // inference reads optimization_goal directly: video goals → VIDEO_VIEWS
  // cell; everything else (REACH / IMPRESSIONS / AD_RECALL_LIFT) → STANDARD.
  if (objective === "OUTCOME_AWARENESS") {
    conversionLocation =
      optimizationGoal === "THRUPLAY" ||
      optimizationGoal === "TWO_SECOND_CONTINUOUS_VIDEO_VIEWS"
        ? "VIDEO_VIEWS"
        : "STANDARD";
  }
  // Sales messaging consolidation — Meta Ads Manager surfaces Messenger /
  // IG Direct / WhatsApp as ONE "Message destinations" location for Sales
  // (same as Traffic), not as 3 separate cells (the Engagement pattern).
  // Reverse-inference: any messaging destination_type on a Sales ad set
  // collapses to the single MESSAGE_DESTINATIONS cell.
  if (
    objective === "OUTCOME_SALES" &&
    (destinationType === "MESSENGER" ||
      destinationType === "WHATSAPP" ||
      destinationType === "INSTAGRAM_DIRECT")
  ) {
    conversionLocation = "MESSAGE_DESTINATIONS";
  }
  // Fall back to the most common cell per objective when destination_type
  // is missing — covers ad sets created without an explicit destination.
  if (!conversionLocation) {
    if (objective === "OUTCOME_TRAFFIC") conversionLocation = "WEBSITE";
    else if (objective === "OUTCOME_APP_PROMOTION") conversionLocation = "APP";
    else if (objective === "OUTCOME_LEADS") conversionLocation = "INSTANT_FORM";
    else if (objective === "OUTCOME_ENGAGEMENT") conversionLocation = "VIDEO_VIEWS";
    else if (objective === "OUTCOME_SALES") conversionLocation = "WEBSITE";
    else if (objective === "OUTCOME_AWARENESS") conversionLocation = "STANDARD";
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
