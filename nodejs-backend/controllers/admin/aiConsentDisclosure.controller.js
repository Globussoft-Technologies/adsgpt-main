const mongoose = require("mongoose");
const AiConsentDisclosure = require("../../Module/privacy/aiConsentDisclosureModel");
const AiConsentHistory = require("../../Module/privacy/aiConsentHistoryModel");
const UserProfile = require("../../Module/user/userProfileModel");
const { PLATFORMS, VERSION_RE } = AiConsentDisclosure;
const { compareVersions, currentOf, requiredVersionOf, cleanLines, parseText, contentOf } = require("../privacy/aiConsentController");
const { bareUserId, findSearchUsers, attachUsers } = require("./contentReport.controller");
const logger = require("../../utils/logger");

const HISTORY_ACTIONS = ["grant", "withdraw"];
const IN_USE_SAMPLE = 50;
const LIMITS = { title: 200, paragraph: 2000, sections: 30, paragraphs: 50 };

// ---- Rules ------------------------------------------------------------------

// Admins often type "v2"; store it as "2".
const normalizeVersion = (v) => (typeof v === "string" ? v.trim().replace(/^v/i, "") : "");

const byVersionDesc = (a, b) => compareVersions(b.version, a.version);
const highestOf = (rows) => [...rows].sort(byVersionDesc)[0] || null;

// Validates a content body from the admin panel. Returns { error } or { content }.
// intro / paragraphs may be arrays or newline-separated strings.
const normalizeContent = (raw) => {
  if (!raw || typeof raw !== "object") return { error: "content must be an object" };
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  if (!title) return { error: "content.title is required" };
  if (title.length > LIMITS.title) return { error: `content.title must be at most ${LIMITS.title} characters` };

  const intro = cleanLines(raw.intro);
  const rawSections = Array.isArray(raw.sections) ? raw.sections : [];
  if (rawSections.length > LIMITS.sections) return { error: `at most ${LIMITS.sections} sections` };

  const sections = [];
  for (const [i, s] of rawSections.entries()) {
    const heading = typeof s?.heading === "string" ? s.heading.trim().replace(/:+$/, "").trim() : "";
    const paragraphs = cleanLines(s?.paragraphs ?? s?.body);
    if (!heading && !paragraphs.length) continue; // empty section left in the form
    if (!heading) return { error: `section ${i + 1} needs a heading` };
    if (!paragraphs.length) return { error: `section "${heading}" needs some text` };
    // A line ending in ":" would read back as a heading in the text form.
    if (paragraphs.some((p) => p.endsWith(":"))) {
      return { error: `a line in "${heading}" ends with ":"; end it differently so the apps don't show it as a heading` };
    }
    if (paragraphs.length > LIMITS.paragraphs) return { error: `section "${heading}" has too many lines` };
    sections.push({ heading, paragraphs });
  }
  if (intro.some((p) => p.endsWith(":"))) {
    return { error: 'a line in the introduction ends with ":"; end it differently so the apps don\'t show it as a heading' };
  }
  if ([...intro, ...sections.flatMap((s) => s.paragraphs)].some((p) => p.length > LIMITS.paragraph)) {
    return { error: `each line must be at most ${LIMITS.paragraph} characters` };
  }
  if (!intro.length && !sections.length) return { error: "add an introduction or at least one section" };
  return { content: { title, intro, sections } };
};

// Content -> the plain-text form stored next to it.
const buildText = ({ title, intro, sections }) =>
  [title, ...intro, ...sections.flatMap((s) => [`${s.heading}:`, ...s.paragraphs])].join("\n");

// ---- Data helpers -----------------------------------------------------------

const rowsFor = (platform) => AiConsentDisclosure.find({ platform }).lean();

// Makes one row the current one for its platform.
const setCurrent = async (row) => {
  await AiConsentDisclosure.updateMany({ platform: row.platform, _id: { $ne: row._id } }, { $set: { is_current: false } });
  await AiConsentDisclosure.updateOne({ _id: row._id }, { $set: { is_current: true } });
};

// Users who agreed on this platform to a version older than `required`, and so
// see the consent screen again.
const countUsersBelow = async (platform, required) => {
  if (!required) return 0;
  const field = `ai_consent_versions.${platform}`;
  const rows = await UserProfile.find({ [field]: { $nin: [null, ""] } }).select(field).lean();
  return rows.filter((u) => compareVersions(u.ai_consent_versions[platform], required) < 0).length;
};

// ---- Handlers ---------------------------------------------------------------

// GET /adsgpt/admin/ai-consent/disclosures?platform=ios&version=1&page=1&limit=20
// Published versions (platform A-Z, newest version first), one page at a time,
// plus the current and highest version per platform. All params are optional.
// Versions compare numerically ("1.10" > "1.9"), so sorting happens in memory;
// there are only ever a handful of rows.
exports.listDisclosures = async (req, res) => {
  try {
    const { platform } = req.query;
    const version = normalizeVersion(req.query.version);
    if (platform && !PLATFORMS.includes(platform)) {
      return res.status(400).json({ success: false, message: `platform must be one of: ${PLATFORMS.join(", ")}` });
    }
    if (version && !VERSION_RE.test(version)) {
      return res.status(400).json({ success: false, message: 'version must look like "1", "1.1" or "1.1.1"' });
    }
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 20));

    const all = (await AiConsentDisclosure.find({}).lean())
      .sort((a, b) => a.platform.localeCompare(b.platform) || byVersionDesc(a, b));

    // Per platform, regardless of the filters.
    const currentVersions = {};
    const highestVersions = {};
    const requiredVersions = {};
    for (const p of PLATFORMS) {
      const rows = all.filter((d) => d.platform === p);
      if (!rows.length) continue;
      currentVersions[p] = currentOf(rows).version;
      highestVersions[p] = rows[0].version; // `all` is newest-first per platform
      requiredVersions[p] = requiredVersionOf(rows);
    }

    const matching = all.filter(
      (d) => (!platform || d.platform === platform) && (!version || compareVersions(d.version, version) === 0),
    );
    const disclosures = matching
      .slice((page - 1) * limit, page * limit)
      .map((d) => ({ ...d, content: contentOf(d) }));

    return res.json({
      success: true,
      page,
      limit,
      total: matching.length,
      currentVersions,
      highestVersions,
      requiredVersions,
      disclosures,
    });
  } catch (error) {
    logger.error("[listDisclosures] error:", error);
    return res.status(500).json({ success: false, message: "Failed to list disclosures" });
  }
};

// POST /adsgpt/admin/ai-consent/disclosures { platform, version, content, askAgain }
// content = { title, intro, sections: [{ heading, paragraphs }] }; a plain
// `text` body is still accepted and parsed into content. "v2" is stored as "2".
// The version must be higher than every version published on that platform,
// and becomes current at once. askAgain (default true) asks users who agreed
// earlier to agree again; false keeps their agreement (small wording fixes).
// Published versions can't be edited; they can be deleted.
exports.publishDisclosure = async (req, res) => {
  try {
    const { platform } = req.body || {};
    const version = normalizeVersion(req.body?.version);

    if (!PLATFORMS.includes(platform)) {
      return res.status(400).json({ success: false, message: `platform must be one of: ${PLATFORMS.join(", ")}` });
    }
    if (!VERSION_RE.test(version)) {
      return res.status(400).json({ success: false, message: 'version must look like "1", "1.1" or "1.1.1"' });
    }
    const rawText = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    const parsed = normalizeContent(req.body?.content ?? (rawText ? parseText(rawText) : null));
    if (parsed.error) {
      return res.status(400).json({ success: false, message: req.body?.content || rawText ? parsed.error : "content is required" });
    }
    const { content } = parsed;

    const highest = highestOf(await rowsFor(platform));
    if (highest && compareVersions(version, highest.version) <= 0) {
      return res.status(409).json({ success: false, message: `version must be higher than ${platform} version ${highest.version}` });
    }

    const disclosure = await AiConsentDisclosure.create({
      platform,
      version,
      text: buildText(content),
      content,
      ask_again: req.body?.askAgain !== false,
      created_by: req.admin?.username || "",
    });
    await setCurrent(disclosure);

    return res.status(201).json({ success: true, disclosure: { ...disclosure.toObject(), is_current: true } });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ success: false, message: "That version already exists for this platform" });
    }
    logger.error("[publishDisclosure] error:", error);
    return res.status(500).json({ success: false, message: "Failed to publish disclosure" });
  }
};

// GET /adsgpt/admin/ai-consent/history?platform=&action=&userId=&page=1&limit=20
// Consent decisions, newest first, plus grant/withdraw totals for the filters.
// userId is the search box: a user id ("409" / "GPT-409") or part of a name
// or email. Each item carries the user's name and email.
exports.listConsentHistory = async (req, res) => {
  try {
    const { platform, action } = req.query;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 20));

    const filter = {};
    if (PLATFORMS.includes(platform)) filter.platform = platform;
    // Decisions store the bare id ("409").
    const userIds = await findSearchUsers(req.query.userId);
    if (userIds) filter.user_id = { $in: [...new Set(userIds.map(bareUserId))] };
    const listFilter = HISTORY_ACTIONS.includes(action) ? { ...filter, action } : filter;

    const [items, total, grants, withdrawals] = await Promise.all([
      AiConsentHistory.find(listFilter).sort({ decided_at: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      AiConsentHistory.countDocuments(listFilter),
      AiConsentHistory.countDocuments({ ...filter, action: "grant" }),
      AiConsentHistory.countDocuments({ ...filter, action: "withdraw" }),
    ]);

    return res.json({
      success: true,
      page,
      limit,
      total,
      counts: { grant: grants, withdraw: withdrawals },
      items: await attachUsers(items, "user_id"),
    });
  } catch (error) {
    logger.error("[listConsentHistory] error:", error);
    return res.status(500).json({ success: false, message: "Failed to list consent history" });
  }
};

// DELETE /adsgpt/admin/ai-consent/disclosures/:id[?force=true]
// Removes a published version. If it was current, the next highest version
// becomes current. Past user decisions are kept. If users currently have this
// version agreed, answers 409 IN_USE with who they are and what happens next;
// repeat with force=true to delete anyway.
exports.deleteDisclosure = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }
    const disclosure = await AiConsentDisclosure.findById(id).lean();
    if (!disclosure) return res.status(404).json({ success: false, message: "Disclosure not found" });

    const { platform, version } = disclosure;
    const inUse = { [`ai_consent_versions.${platform}`]: version };
    const userCount = await UserProfile.countDocuments(inUse);

    if (userCount && req.query.force !== "true") {
      const rows = await rowsFor(platform);
      const current = currentOf(rows);
      const isCurrent = current?.version === version;
      const remaining = rows.filter((r) => String(r._id) !== String(disclosure._id));
      const nextCurrent = isCurrent ? highestOf(remaining)?.version || null : current?.version || null;
      const users = await UserProfile.find(inUse)
        .sort({ [`ai_consent_decided_at.${platform}`]: -1 })
        .limit(IN_USE_SAMPLE)
        .select(`user_id amember_user_id name email ai_consent_decided_at.${platform}`)
        .lean();
      return res.status(409).json({
        success: false,
        code: "IN_USE",
        message: `${userCount} user(s) have agreed to ${platform} version ${version}.`,
        platform,
        version,
        isCurrent,
        nextCurrent,
        userCount,
        users: users.map((u) => ({
          user_id: u.user_id || u.amember_user_id,
          name: u.name || "",
          email: u.email || "",
          agreed_at: u.ai_consent_decided_at?.[platform] || null,
        })),
      });
    }

    await AiConsentDisclosure.deleteOne({ _id: disclosure._id });
    const current = currentOf(await rowsFor(platform));
    return res.json({ success: true, deleted: disclosure, affectedUsers: userCount, currentVersion: current?.version || null });
  } catch (error) {
    logger.error("[deleteDisclosure] error:", error);
    return res.status(500).json({ success: false, message: "Failed to delete disclosure" });
  }
};

// PATCH /adsgpt/admin/ai-consent/disclosures/:id/current
// Makes this version the current one for its platform, e.g. to roll back to an
// older wording. usersToAsk = users whose agreement is now too old.
exports.makeCurrent = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }
    const disclosure = await AiConsentDisclosure.findById(id).lean();
    if (!disclosure) return res.status(404).json({ success: false, message: "Disclosure not found" });

    await setCurrent(disclosure);
    const { platform } = disclosure;
    const requiredVersion = requiredVersionOf(await rowsFor(platform));
    const usersToAsk = await countUsersBelow(platform, requiredVersion);
    return res.json({ success: true, platform, currentVersion: disclosure.version, requiredVersion, usersToAsk });
  } catch (error) {
    logger.error("[makeCurrent] error:", error);
    return res.status(500).json({ success: false, message: "Failed to change the current version" });
  }
};

// Shared with the tests.
Object.assign(exports, { normalizeVersion, highestOf, normalizeContent, buildText });
