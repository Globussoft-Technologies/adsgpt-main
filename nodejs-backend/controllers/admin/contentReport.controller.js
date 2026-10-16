const GeneratedMedia = require("../../Module/generatedMedia/generated.media");
const UserProfile = require("../../Module/user/userProfileModel");
const logger = require("../../utils/logger");

const MAX_SEARCH_USERS = 500;
const TYPES = ["image", "video"];
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

// Media rows and profiles may store a user as "409" or "GPT-409".
const bareUserId = (id) => String(id || "").replace(/^GPT-/, "");
const userIdForms = (ids) => [...new Set(ids.map(bareUserId).filter(Boolean).flatMap((b) => [b, `GPT-${b}`]))];

// The search box: "409" / "GPT-409" is a user id; anything else is part of a
// name or email.
const looksLikeUserId = (q) => /^(GPT-)?\d+$/i.test(q);
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Users matching the search box, or null when it is empty.
const findSearchUsers = async (q) => {
  const text = typeof q === "string" ? q.trim() : "";
  if (!text) return null;
  if (looksLikeUserId(text)) return [text];
  const re = new RegExp(escapeRegex(text), "i");
  const profiles = await UserProfile.find({ $or: [{ name: re }, { email: re }] })
    .limit(MAX_SEARCH_USERS)
    .select("user_id")
    .lean();
  return profiles.map((p) => p.user_id);
};

// Reported media, narrowed by any of
//   userIds  - users matched by the search box (null = no search)
//   type     - "image" | "video"
//   model    - exact model name
//   from/to  - "YYYY-MM-DD", inclusive, on the report date
const buildAdminFilter = ({ userIds = null, type, model, from, to } = {}) => {
  const filter = { is_reported: true };
  if (userIds) filter.userId = { $in: userIdForms(userIds) };
  if (TYPES.includes(type)) filter.type = type;
  if (typeof model === "string" && model.trim()) filter.model = model.trim();
  const range = {};
  if (DAY_RE.test(from || "")) range.$gte = new Date(`${from}T00:00:00`);
  if (DAY_RE.test(to || "")) {
    const end = new Date(`${to}T00:00:00`);
    end.setDate(end.getDate() + 1);
    range.$lt = end;
  }
  if (Object.keys(range).length) filter.reported_at = range;
  return filter;
};

// Totals across every report, ignoring the filters.
const summarize = async () => {
  const [row] = await GeneratedMedia.aggregate([
    { $match: { is_reported: true } },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        images: { $sum: { $cond: [{ $eq: ["$type", "image"] }, 1, 0] } },
        videos: { $sum: { $cond: [{ $eq: ["$type", "video"] }, 1, 0] } },
        users: { $addToSet: "$userId" },
      },
    },
  ]);
  return {
    total: row?.total || 0,
    images: row?.images || 0,
    videos: row?.videos || 0,
    users: new Set((row?.users || []).map(bareUserId)).size,
  };
};

// Adds { name, email } of each item's user, looked up by `idKey`.
const attachUsers = async (items, idKey) => {
  const profiles = await UserProfile.find({ user_id: { $in: userIdForms(items.map((i) => i[idKey])) } })
    .select("user_id name email")
    .lean();
  const byUser = new Map(profiles.map((p) => [bareUserId(p.user_id), p]));
  return items.map((i) => {
    const p = byUser.get(bareUserId(i[idKey]));
    return { ...i, user: { name: p?.name?.trim() || "", email: p?.email || "" } };
  });
};

// GET /adsgpt/admin/content-reports?q=&type=&model=&from=&to=&page=1&limit=20
//   q          user id, or part of a name or email (userId is the older name)
//   type       image | video
//   model      exact model name (the response lists the ones in use)
//   from / to  YYYY-MM-DD, inclusive, on the report date
// Reported generated media, most recently reported first, with each item's
// user name and email. `total` counts the filtered rows; `summary` covers all
// reports. Read-only: a report already hides the item for its user.
exports.listContentReports = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 20));
    const filter = buildAdminFilter({
      userIds: await findSearchUsers(req.query.q ?? req.query.userId),
      type: req.query.type,
      model: req.query.model,
      from: req.query.from,
      to: req.query.to,
    });

    const [items, total, models, summary] = await Promise.all([
      GeneratedMedia.find(filter)
        // _id breaks ties so paging never repeats or skips rows reported in the same ms.
        .sort({ reported_at: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .select("userId type model source image video report_reason reported_at createdAt")
        .lean(),
      GeneratedMedia.countDocuments(filter),
      GeneratedMedia.distinct("model", { is_reported: true }),
      summarize(),
    ]);

    return res.json({
      success: true,
      page,
      limit,
      total,
      summary,
      models: models.filter(Boolean).sort(),
      items: await attachUsers(items, "userId"),
    });
  } catch (error) {
    logger.error("[listContentReports] error:", error);
    return res.status(500).json({ success: false, message: "Failed to list content reports" });
  }
};

// Shared with the admin consent-history API and the tests.
Object.assign(exports, { bareUserId, userIdForms, looksLikeUserId, escapeRegex, findSearchUsers, buildAdminFilter, attachUsers });
