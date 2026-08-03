const WORKSPACE_FEATURES = Object.freeze([
  "adFactory",
  "assistant",
  "adStudio.adCopy",
  "adStudio.adCreative",
  "adStudio.adVideo",
  "adStudio.adLibrary",
  "brandIq.myBrands",
  "brandIq.competitors",
  "adsManager.meta.manager",
  "adsManager.meta.autopilot",
  "adsManager.google.manager",
  "adsManager.google.autopilot",
  "adsManager.tiktok.manager",
  "adsManager.tiktok.autopilot",
  "profile",
]);

// These values can be persisted now. The unavailable Google/TikTok Autopilot
// leaves remain valid schema values so enabling them later does not require a
// data migration, but they are not assignable in the current release.
const WORKSPACE_ASSIGNABLE_FEATURES = Object.freeze(
  WORKSPACE_FEATURES.filter(
    (feature) =>
      feature !== "adsManager.google.autopilot" &&
      feature !== "adsManager.tiktok.autopilot",
  ),
);

const LEGACY_WORKSPACE_FEATURES = Object.freeze([
  "adStudio",
  "brandIq",
  "analyzer",
  "adsManager",
  "autopilot",
]);

const WORKSPACE_FEATURE_VALUES = Object.freeze([
  ...WORKSPACE_FEATURES,
  ...LEGACY_WORKSPACE_FEATURES,
]);

const LEGACY_FEATURE_EXPANSIONS = Object.freeze({
  adStudio: [
    "adStudio.adCopy",
    "adStudio.adCreative",
    "adStudio.adVideo",
    "adStudio.adLibrary",
  ],
  brandIq: ["brandIq.myBrands", "brandIq.competitors"],
  // Analyzer is intentionally outside the workspace MVP.
  analyzer: [],
  adsManager: [
    "adsManager.meta.manager",
    "adsManager.google.manager",
    "adsManager.tiktok.manager",
  ],
  autopilot: ["adsManager.meta.autopilot"],
});

const WORKSPACE_FEATURE_LABELS = Object.freeze({
  adFactory: "Ad Factory",
  assistant: "AI Assistant",
  "adStudio.adCopy": "Ad Studio - Ad Copy",
  "adStudio.adCreative": "Ad Studio - Ad Creative",
  "adStudio.adVideo": "Ad Studio - Ad Video",
  "adStudio.adLibrary": "Ad Studio - Ad Library",
  "brandIq.myBrands": "BrandIQ - My Brands",
  "brandIq.competitors": "BrandIQ - Competitors",
  "adsManager.meta.manager": "Ads Manager - Meta",
  "adsManager.meta.autopilot": "Autopilot - Meta",
  "adsManager.google.manager": "Ads Manager - Google",
  "adsManager.google.autopilot": "Autopilot - Google",
  "adsManager.tiktok.manager": "Ads Manager - TikTok",
  "adsManager.tiktok.autopilot": "Autopilot - TikTok",
  profile: "Profile",
});

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

const WORKSPACE_PASSWORD_MIN_LENGTH = 8;
const WORKSPACE_PASSWORD_MAX_LENGTH = 128;

// Max length is an engineering bound against oversized scrypt input, not a
// policy choice — the product requirement is only the 8-character minimum.
function validatePassword(value) {
  const password = String(value ?? "");
  if (
    password.length < WORKSPACE_PASSWORD_MIN_LENGTH ||
    password.length > WORKSPACE_PASSWORD_MAX_LENGTH
  ) {
    throw workspaceError(
      "WORKSPACE_PASSWORD_INVALID",
      `Password must be at least ${WORKSPACE_PASSWORD_MIN_LENGTH} characters`,
      400,
    );
  }
  return password;
}

function normalizeFeatures(value) {
  if (!Array.isArray(value)) return [];
  const requested = new Set();
  value.forEach((feature) => {
    const normalized = String(feature || "").trim();
    if (WORKSPACE_FEATURES.includes(normalized)) requested.add(normalized);
    (LEGACY_FEATURE_EXPANSIONS[normalized] || []).forEach((leaf) =>
      requested.add(leaf),
    );
  });
  return WORKSPACE_FEATURES.filter((feature) => requested.has(feature));
}

function requireFeatures(value) {
  const features = normalizeFeatures(value).filter((feature) =>
    WORKSPACE_ASSIGNABLE_FEATURES.includes(feature),
  );
  if (!features.length) {
    throw workspaceError(
      "WORKSPACE_FEATURES_REQUIRED",
      "Select at least one workspace feature",
      400,
    );
  }
  return features;
}

function workspaceError(code, message, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

// True only for errors this module built deliberately. Anything else — Mongoose
// CastErrors, TypeErrors, driver failures — carries an internal message that
// must never be echoed to a caller, so responders fall back to a generic 500.
function isWorkspaceError(error) {
  return (
    typeof error?.code === "string" &&
    error.code.startsWith("WORKSPACE_") &&
    Number.isInteger(error?.statusCode)
  );
}

// Maps a thrown error to the response a workspace endpoint should send. Kept
// free of Express so it can be asserted directly. Unexpected failures are
// logged here — once, centrally — and described to the caller only as a 500.
function workspaceErrorResponse(error, { fallbackCode, context } = {}) {
  if (isWorkspaceError(error)) {
    return {
      statusCode: error.statusCode,
      body: { success: false, code: error.code, message: error.message },
    };
  }
  console.error(`[${context || "workspace"}] request failed`, error);
  return {
    statusCode: 500,
    body: {
      success: false,
      code: fallbackCode || "WORKSPACE_ERROR",
      message: "Workspace request failed",
    },
  };
}

module.exports = {
  LEGACY_WORKSPACE_FEATURES,
  isWorkspaceError,
  workspaceErrorResponse,
  WORKSPACE_ASSIGNABLE_FEATURES,
  WORKSPACE_FEATURE_LABELS,
  WORKSPACE_FEATURE_VALUES,
  WORKSPACE_FEATURES,
  normalizeEmail,
  normalizeFeatures,
  requireFeatures,
  validatePassword,
  WORKSPACE_PASSWORD_MIN_LENGTH,
  workspaceError,
};
