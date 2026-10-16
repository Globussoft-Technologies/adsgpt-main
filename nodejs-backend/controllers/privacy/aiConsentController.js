const UserProfile = require("../../Module/user/userProfileModel");
const AiConsentHistory = require("../../Module/privacy/aiConsentHistoryModel");
const AiConsentDisclosure = require("../../Module/privacy/aiConsentDisclosureModel");
const { PLATFORMS } = AiConsentDisclosure;
const logger = require("../../utils/logger");

// ---- Versions ---------------------------------------------------------------

// Compares "1.2" vs "1.10.1" numerically, part by part ("1.1" == "1.1.0").
const compareVersions = (a, b) => {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
};
const byVersionDesc = (a, b) => compareVersions(b.version, a.version);

// Current row among one platform's rows: the one marked is_current, else the
// highest version (rows saved before is_current existed are all unmarked).
const currentOf = (rows) => rows.find((r) => r.is_current) || [...rows].sort(byVersionDesc)[0] || null;

// Oldest version a user may have agreed to and still count as agreed: the
// newest version up to the current one that asked everyone again
// (ask_again missing counts as true). Small wording fixes don't move it.
const requiredVersionOf = (rows) => {
  const current = currentOf(rows);
  if (!current) return null;
  const upToCurrent = rows.filter((r) => compareVersions(r.version, current.version) <= 0).sort(byVersionDesc);
  return (upToCurrent.find((r) => r.ask_again !== false) || upToCurrent[upToCurrent.length - 1]).version;
};

// Does a user who agreed to `agreed` need to see the consent screen again?
const needsConsentFor = (agreed, required) => !!required && (!agreed || compareVersions(agreed, required) < 0);

const rowsFor = (platform) => AiConsentDisclosure.find({ platform }).lean();

// ---- Content ----------------------------------------------------------------
// content = { title, intro: [paragraph], sections: [{ heading, paragraphs }] }
// The plain-text form older app builds read: title line, intro lines, then
// each section as a "Heading:" line followed by its lines.

const cleanLines = (value) =>
  (Array.isArray(value) ? value : String(value ?? "").split("\n"))
    .map((l) => String(l ?? "").trim())
    .filter(Boolean);

// Text -> content, for rows published before content was stored.
const parseText = (text) => {
  const [title = "", ...rest] = cleanLines(text);
  const content = { title, intro: [], sections: [] };
  for (const line of rest) {
    if (line.endsWith(":")) content.sections.push({ heading: line.slice(0, -1).trim(), paragraphs: [] });
    else if (content.sections.length) content.sections[content.sections.length - 1].paragraphs.push(line);
    else content.intro.push(line);
  }
  return content;
};

// "OpenAI: ad copy and images" is a labelled list item; anything else is a
// paragraph. Long or sentence-like prefixes are not labels.
const LABELLED = /^([^:]{1,40}):\s+(.+)$/;
const toBlock = (p) => {
  const m = p.match(LABELLED);
  return m ? { type: "item", label: m[1].trim(), text: m[2].trim() } : { type: "paragraph", text: p };
};

// Content as the apps get it, with render-ready blocks next to the strings.
const contentOf = (disclosure) => {
  const { title, intro = [], sections = [] } = disclosure?.content?.title
    ? disclosure.content
    : parseText(disclosure?.text || "");
  return {
    title,
    intro,
    introBlocks: intro.map(toBlock),
    sections: sections.map((s) => ({ heading: s.heading, paragraphs: s.paragraphs, blocks: s.paragraphs.map(toBlock) })),
  };
};

// ---- Handlers ---------------------------------------------------------------

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

// consent.* describes the decision for the requested platform only.
// needsConsent tells the app whether to show the consent screen: something is
// published, and the user hasn't agreed, withdrew, or agreed to a version
// older than requiredVersion.
const toPayload = (p, platform, rows) => {
  const version = p.ai_consent_versions?.[platform] ?? null;
  const decidedAt = p.ai_consent_decided_at?.[platform] ?? null;
  const status = p.ai_consent_withdrawn ? "withdrawn" : version ? "granted" : "none";
  const requiredVersion = requiredVersionOf(rows);
  return {
    ok: true,
    currentVersion: currentOf(rows)?.version ?? null,
    requiredVersion,
    // Nothing published on this platform yet = nothing to show.
    needsConsent: !!requiredVersion && (status !== "granted" || needsConsentFor(version, requiredVersion)),
    consent: { status, version, decidedAt, platform: decidedAt ? platform : null },
  };
};

// GET /adsgpt/privacy/ai-consent?platform=ios
const getAiConsent = async (req, res) => {
  try {
    const { platform } = req.query;
    if (!PLATFORMS.includes(platform)) return badPlatform(res);

    const profile = await findProfile(req);
    if (!profile) return fail(res, 404, "USER_NOT_FOUND", "User not found.");
    return res.json(toPayload(profile, platform, await rowsFor(platform)));
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

    const rows = await rowsFor(platform);
    const currentVersion = currentOf(rows)?.version ?? null;
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

    return res.json(toPayload(profile, platform, rows));
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

    const rows = await rowsFor(platform);
    const disclosure = version ? rows.find((r) => r.version === String(version)) : currentOf(rows);
    if (!disclosure) {
      return fail(res, 404, "DISCLOSURE_NOT_FOUND", "No disclosure found for that platform and version.");
    }
    return res.json({
      ok: true,
      platform: disclosure.platform,
      version: disclosure.version,
      currentVersion: currentOf(rows)?.version ?? null,
      text: disclosure.text,
      content: contentOf(disclosure),
      publishedAt: disclosure.created_at,
    });
  } catch (error) {
    logger.error("[getAiConsentDisclosure] error:", error);
    return fail(res, 500, "INTERNAL_ERROR", "Failed to read the disclosure.");
  }
};

module.exports = {
  getAiConsent,
  recordAiConsent,
  getAiConsentDisclosure,
  // Shared with the admin disclosure API and the tests.
  toPayload,
  compareVersions,
  currentOf,
  requiredVersionOf,
  needsConsentFor,
  cleanLines,
  parseText,
  toBlock,
  contentOf,
};
