const { SURFACE_SLUGS } = require("./surfaceCatalog");

const MODEL_TYPES = ["image", "video", "text", "vision", "audio", "internal"];
const QUALITY_NAMES = new Set(["low", "medium", "high", "ultra_high"]);

function isFiniteNonNegative(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function stringArray(value, field) {
  if (value === undefined) return null;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    return `${field} must be an array of non-empty strings`;
  }
  return null;
}

function validateSurfaceMap(surfaces) {
  if (surfaces === undefined) return null;
  if (!surfaces || typeof surfaces !== "object" || Array.isArray(surfaces)) return "surfaces must be an object";
  for (const [surface, config] of Object.entries(surfaces)) {
    if (!SURFACE_SLUGS.includes(surface)) return `Unknown surface "${surface}"`;
    if (!config || typeof config !== "object" || Array.isArray(config)) return `Surface "${surface}" must be an object`;
    if (config.enabled !== undefined && typeof config.enabled !== "boolean") return `Surface "${surface}" enabled must be boolean`;
    for (const field of ["aspectRatios", "qualities"]) {
      const error = stringArray(config[field], `surfaces.${surface}.${field}`);
      if (error) return error;
    }
    if (config.durations !== undefined && (!Array.isArray(config.durations) || config.durations.some((value) => !Number.isFinite(value) || value <= 0))) {
      return `surfaces.${surface}.durations must contain positive numbers`;
    }
    if (config.qualities?.some((quality) => !QUALITY_NAMES.has(quality))) return `surfaces.${surface}.qualities contains an unknown quality`;
  }
  return null;
}

function validateExtraCharges(extraCharges) {
  if (extraCharges === undefined) return null;
  if (!Array.isArray(extraCharges)) return "extraCharges must be an array";
  for (const charge of extraCharges) {
    if (!charge || typeof charge !== "object" || Array.isArray(charge)) return "Each extra charge must be an object";
    if (typeof charge.type !== "string" || !charge.type.trim()) return "Each extra charge requires a type";
    if (charge.unit !== undefined && !["image", "second", "request"].includes(charge.unit)) return "Extra charge unit must be image, second, or request";
    for (const field of ["credits", "usdPerUnit", "costPerSecond"]) {
      if (charge[field] !== undefined && !isFiniteNonNegative(charge[field])) return `extraCharges.${field} must be a non-negative number`;
    }
  }
  return null;
}

function validateModelPayload(input, { partial = false } = {}) {
  const body = input || {};
  for (const field of ["canonicalKey", "displayName", "type"]) {
    if (!partial && (typeof body[field] !== "string" || !body[field].trim())) return `${field} is required`;
  }
  if (body.canonicalKey !== undefined && (typeof body.canonicalKey !== "string" || !body.canonicalKey.trim())) return "canonicalKey must be a non-empty string";
  if (body.displayName !== undefined && (typeof body.displayName !== "string" || !body.displayName.trim())) return "displayName must be a non-empty string";
  if (body.type !== undefined && !MODEL_TYPES.includes(body.type)) return `type must be one of: ${MODEL_TYPES.join(", ")}`;
  for (const field of ["aliases", "qualities", "aspectRatios"]) {
    const error = stringArray(body[field], field);
    if (error) return error;
  }
  if (body.durations !== undefined && (!Array.isArray(body.durations) || body.durations.some((value) => !Number.isFinite(value) || value <= 0))) return "durations must contain positive numbers";
  for (const field of ["credits", "sortOrder", "aggregationCreditDefault"]) {
    if (body[field] !== undefined && !isFiniteNonNegative(body[field])) return `${field} must be a non-negative number`;
  }
  if (body.enabled !== undefined && typeof body.enabled !== "boolean") return "enabled must be boolean";
  if (body.archived !== undefined && typeof body.archived !== "boolean") return "archived must be boolean";
  if (body.isPremium !== undefined && typeof body.isPremium !== "boolean") return "isPremium must be boolean";
  const blockedPlanIdsError = stringArray(body.blockedPlanIds, "blockedPlanIds");
  if (blockedPlanIdsError) return blockedPlanIdsError;
  if (body.aliases) {
    const aliases = body.aliases.map((alias) => alias.trim());
    if (new Set(aliases).size !== aliases.length) return "aliases must not contain duplicates";
  }
  if (body.blockedPlanIds && new Set(body.blockedPlanIds).size !== body.blockedPlanIds.length) return "blockedPlanIds must not contain duplicates";
  return validateExtraCharges(body.extraCharges) || validateSurfaceMap(body.surfaces);
}

module.exports = { MODEL_TYPES, validateModelPayload, validateSurfaceMap };
