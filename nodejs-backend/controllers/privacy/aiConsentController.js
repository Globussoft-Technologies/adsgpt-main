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

// consent.* describes the decision for the requested platform only, so the
// app always compares that platform's agreed version with its currentVersion.
const toPayload = (p, platform, currentVersion) => {
  const version = p.ai_consent_versions?.[platform] ?? null;
  const decidedAt = p.ai_consent_decided_at?.[platform] ?? null;
  return {
    ok: true,
    currentVersion,
    consent: {
      status: p.ai_consent_withdrawn ? "withdrawn" : version ? "granted" : "none",
      version,
      decidedAt,
      platform: decidedAt ? platform : null,
    },
  };
};

// GET /adsgpt/privacy/ai-consent?platform=ios
const getAiConsent = async (req, res) => {
  try {
    const { platform } = req.query;
    if (!PLATFORMS.includes(platform)) return badPlatform(res);

    const profile = await findProfile(req);
    if (!profile) return fail(res, 404, "USER_NOT_FOUND", "User not found.");
    return res.json(toPayload(profile, platform, await getCurrentVersion(platform)));
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

    // Grant: set only this platform's version. Withdraw: account-wide, clear
    // every platform so each asks again with its own form.
    const previousVersion = profile.ai_consent_versions?.[platform] ?? null;
    profile.ai_consent_withdrawn = !grant;
    if (grant) {
      profile.set(`ai_consent_versions.${platform}`, currentVersion);
      profile.set(`ai_consent_decided_at.${platform}`, decidedAt);
    } else {
      for (const p of PLATFORMS) {
        profile.set(`ai_consent_versions.${p}`, null);
        profile.set(`ai_consent_decided_at.${p}`, decidedAt);
      }
    }
    await profile.save();

    await AiConsentHistory.create({
      user_id: profile.amember_user_id,
      action,
      version: grant ? currentVersion : previousVersion,
      platform,
      app_version: appVersion || "",
      decided_at: decidedAt,
      user_agent: req.get("user-agent") || "",
    });

    return res.json(toPayload(profile, platform, currentVersion));
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
