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
 * V2 covers OUTCOME_TRAFFIC, OUTCOME_LEADS, OUTCOME_APP_PROMOTION. Other
 * objectives still flow through the V1 endpoints until migrated.
 */

const { getCell, isCellImplemented } = require("../../config/wizardSchema");

// V2-migrated objectives. Anything else returns an error from the inferer.
const SUPPORTED_OBJECTIVES = new Set([
  "OUTCOME_TRAFFIC",
  "OUTCOME_LEADS",
  "OUTCOME_APP_PROMOTION",
]);

// destination_type → conversionLocation. Some destinations resolve
// per-objective (PHONE_CALL means CALLS on Leads, PHONE_CALL on Traffic —
// different cells), which is why this is a function not a map.
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
      return "INSTANT_FORM";
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
      error: `Unsupported campaign objective "${objective || "(none)"}". V2 currently supports Traffic, Leads, and App Promotion campaigns.`,
    };
  }
  const destinationType = metaAdSet?.destination_type || null;
  let conversionLocation = destinationToConversionLocation(
    objective,
    destinationType,
  );
  // Fall back to the most common cell per objective when destination_type
  // is missing — covers ad sets created without an explicit destination.
  if (!conversionLocation) {
    if (objective === "OUTCOME_TRAFFIC") conversionLocation = "WEBSITE";
    else if (objective === "OUTCOME_APP_PROMOTION") conversionLocation = "APP";
    else if (objective === "OUTCOME_LEADS") conversionLocation = "INSTANT_FORM";
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
