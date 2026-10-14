const UserProfile = require("../../Module/user/userProfileModel");
const AiConsentHistory = require("../../Module/privacy/aiConsentHistoryModel");
const AiConsentDisclosure = require("../../Module/privacy/aiConsentDisclosureModel");
const { PLATFORMS } = AiConsentDisclosure;
const logger = require("../../utils/logger");

// Each platform's current version is the highest disclosure published for it
// from the admin panel (POST /adsgpt/admin/ai-consent/disclosures). null until
// the first one is published.
const getCurrentVersion = async (platform) =>
  (await AiConsentDisclosure.findCurrent(platform))?.version ?? null;

const fail = (res, status, code, error) =>
  res.status(status).json({ ok: false, code, error });

const badPlatform = (res) =>
  fail(res, 400, "INVALID_PLATFORM", `platform must be one of: ${PLATFORMS.join(", ")}.`);

const findProfile = async (req) => {
  const id = String(req.user?.user_id || "").replace(/^GPT-/, "");
  if (!id) return null;
  const profile = await UserProfile.findOne({ amember_user_id: id });
  return profile && !profile.is_deleted ? profile : null;
};

const toPayload = (p, currentVersion) => ({
  ok: true,
  currentVersion,
  consent: {
    status:
      p.ai_consent === true ? "granted" : p.ai_consent === false ? "withdrawn" : "none",
    version: p.ai_consent_version ?? null,
    decidedAt: p.ai_consent_decided_at ?? null,
    platform: p.ai_consent_platform ?? null,
  },
});

// GET /adsgpt/privacy/ai-consent?platform=ios
const getAiConsent = async (req, res) => {
  try {
    const { platform } = req.query;
    if (!PLATFORMS.includes(platform)) return badPlatform(res);

    const profile = await findProfile(req);
    if (!profile) return fail(res, 404, "USER_NOT_FOUND", "User not found.");
    return res.json(toPayload(profile, await getCurrentVersion(platform)));
  } catch (error) {
    logger.error("[getAiConsent] error:", error);
    return fail(res, 500, "INTERNAL_ERROR", "Failed to read AI consent.");
  }
};

// POST /adsgpt/privacy/ai-consent  { action, version, platform, appVersion }
const recordAiConsent = async (req, res) => {
  try {
    const { action, version, platform, appVersion } = req.body || {};
    if (action !== "grant" && action !== "withdraw") {
      return fail(res, 400, "INVALID_ACTION", 'action must be "grant" or "withdraw".');
    }
    if (!PLATFORMS.includes(platform)) return badPlatform(res);

    const currentVersion = await getCurrentVersion(platform);
    if (action === "grant" && (currentVersion === null || String(version) !== currentVersion)) {
      return fail(res, 400, "STALE_DISCLOSURE", `Current ${platform} disclosure version is ${currentVersion}.`);
    }

    const profile = await findProfile(req);
    if (!profile) return fail(res, 404, "USER_NOT_FOUND", "User not found.");

    const grant = action === "grant";
    const decidedAt = new Date();

    profile.ai_consent = grant;
    if (grant) profile.ai_consent_version = currentVersion;
    profile.ai_consent_decided_at = decidedAt;
    profile.ai_consent_platform = platform;
    await profile.save();

    await AiConsentHistory.create({
      user_id: profile.amember_user_id,
      action,
      version: profile.ai_consent_version,
      platform,
      app_version: appVersion || "",
      decided_at: decidedAt,
      user_agent: req.get("user-agent") || "",
    });

    return res.json(toPayload(profile, currentVersion));
  } catch (error) {
    logger.error("[recordAiConsent] error:", error);
    return fail(res, 500, "INTERNAL_ERROR", "Failed to record AI consent.");
  }
};

// GET /adsgpt/privacy/ai-consent/disclosure?platform=ios&version=1.1
// version is optional and defaults to the platform's current one.
const getAiConsentDisclosure = async (req, res) => {
  try {
    const { platform, version } = req.query;
    if (!PLATFORMS.includes(platform)) return badPlatform(res);

    const disclosure = version
      ? await AiConsentDisclosure.findOne({ platform, version: String(version) }).lean()
      : await AiConsentDisclosure.findCurrent(platform);
    if (!disclosure) {
      return fail(res, 404, "DISCLOSURE_NOT_FOUND", "No disclosure found for that platform and version.");
    }
    return res.json({
      ok: true,
      platform: disclosure.platform,
      version: disclosure.version,
      currentVersion: await getCurrentVersion(platform),
      text: disclosure.text,
      publishedAt: disclosure.created_at,
    });
  } catch (error) {
    logger.error("[getAiConsentDisclosure] error:", error);
    return fail(res, 500, "INTERNAL_ERROR", "Failed to read the disclosure.");
  }
};

module.exports = { getAiConsent, recordAiConsent, getAiConsentDisclosure };
