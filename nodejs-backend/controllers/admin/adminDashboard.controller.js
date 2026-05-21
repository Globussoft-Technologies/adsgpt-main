const GeneratedMedia = require("../../Module/generatedMedia/generated.media");
const UserProfile = require("../../Module/user/userProfileModel");
const UnifiedCreditController = require("../UnifiedCreditController");
const { buildEffectiveCostStages } = require("../../config/modelAggregation");

// Date strings of the form "YYYY-MM-DD" represent a whole calendar day. Treat
// `from` as start-of-day UTC and `to` as end-of-day UTC, otherwise a request
// for "today → today" sets both bounds to 00:00:00Z and matches nothing.
// Full ISO timestamps pass through unchanged.
function parseRangeStart(s) {
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(`${s}T00:00:00.000Z`);
  return new Date(s);
}
function parseRangeEnd(s) {
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(`${s}T23:59:59.999Z`);
  return new Date(s);
}

function buildDateMatch(from, to) {
  if (!from && !to) return {};
  const range = {};
  if (from) range.$gte = parseRangeStart(from);
  if (to) range.$lte = parseRangeEnd(to);
  return { createdAt: range };
}

// GET /admin/overview?from&to
exports.overview = async (req, res) => {
  try {
    const { from, to } = req.query;
    const match = buildDateMatch(from, to);

    const [totalsAgg, byTypeAgg, byModelAgg, dailyAgg, distinctUsers] = await Promise.all([
      GeneratedMedia.aggregate([
        { $match: match },
        ...buildEffectiveCostStages(),
        {
          $group: {
            _id: null,
            generations: { $sum: 1 },
            cost: { $sum: "$effective_cost" },
            credits: { $sum: "$effective_credits" },
          },
        },
      ]),
      GeneratedMedia.aggregate([
        { $match: match },
        ...buildEffectiveCostStages(),
        {
          $group: {
            _id: "$type",
            generations: { $sum: 1 },
            cost: { $sum: "$effective_cost" },
            credits: { $sum: "$effective_credits" },
          },
        },
        { $project: { _id: 0, type: "$_id", generations: 1, cost: { $round: ["$cost", 4] }, credits: 1 } },
      ]),
      GeneratedMedia.aggregate([
        { $match: match },
        ...buildEffectiveCostStages(),
        {
          $group: {
            _id: "$model",
            generations: { $sum: 1 },
            cost: { $sum: "$effective_cost" },
            credits: { $sum: "$effective_credits" },
          },
        },
        { $project: { _id: 0, model: "$_id", generations: 1, cost: { $round: ["$cost", 4] }, credits: 1 } },
        { $sort: { cost: -1 } },
      ]),
      GeneratedMedia.aggregate([
        { $match: match },
        ...buildEffectiveCostStages(),
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
            generations: { $sum: 1 },
            cost: { $sum: "$effective_cost" },
          },
        },
        { $project: { _id: 0, date: "$_id", generations: 1, cost: { $round: ["$cost", 4] } } },
        { $sort: { date: 1 } },
      ]),
      GeneratedMedia.distinct("userId", match),
    ]);

    const totals = totalsAgg[0] || { generations: 0, cost: 0, credits: 0 };
    return res.json({
      success: true,
      range: { from: from || null, to: to || null },
      totals: {
        users: distinctUsers.length,
        generations: totals.generations,
        cost: parseFloat((totals.cost || 0).toFixed(4)),
        credits: totals.credits || 0,
      },
      byType: byTypeAgg,
      byModel: byModelAgg,
      daily: dailyAgg,
    });
  } catch (error) {
    console.error("Admin overview error:", error);
    return res.status(500).json({ success: false, message: "Internal server error", error: error.message });
  }
};

// GET /admin/users?from&to&search&sort&page&limit
exports.usersList = async (req, res) => {
  try {
    const {
      from,
      to,
      search = "",
      sort = "cost", // cost | generations | credits | recent
      page = 1,
      limit = 20,
    } = req.query;

    const pageNumber = Math.max(1, parseInt(page));
    const limitNumber = Math.min(100, Math.max(1, parseInt(limit)));
    const skip = (pageNumber - 1) * limitNumber;

    const match = buildDateMatch(from, to);

    const sortField = {
      cost: "cost",
      generations: "generations",
      credits: "credits",
      recent: "lastActivity",
    }[sort] || "cost";

    const aggregated = await GeneratedMedia.aggregate([
      { $match: match },
      ...buildEffectiveCostStages(),
      {
        $group: {
          _id: "$userId",
          generations: { $sum: 1 },
          cost: { $sum: "$effective_cost" },
          credits: { $sum: "$effective_credits" },
          images: { $sum: { $cond: [{ $eq: ["$type", "image"] }, 1, 0] } },
          videos: { $sum: { $cond: [{ $eq: ["$type", "video"] }, 1, 0] } },
          lastActivity: { $max: "$createdAt" },
        },
      },
      {
        $project: {
          _id: 0,
          userId: "$_id",
          generations: 1,
          cost: { $round: ["$cost", 4] },
          credits: 1,
          images: 1,
          videos: 1,
          lastActivity: 1,
        },
      },
    ]);

    const userIds = aggregated.map((u) => u.userId);
    const profiles = await UserProfile.find(
      { user_id: { $in: userIds } },
      {
        user_id: 1,
        login: 1,
        name: 1,
        name_f: 1,
        name_l: 1,
        email: 1,
        subscription_plan_id: 1,
        subscription_plan_name: 1,
        subscription_expiry: 1,
        created_from: 1,
      },
    ).lean();

    const profileMap = new Map(profiles.map((p) => [p.user_id, p]));
    let merged = aggregated.map((row) => {
      const profile = profileMap.get(row.userId) || {};
      const fullName =
        profile.name ||
        [profile.name_f, profile.name_l].filter(Boolean).join(" ").trim() ||
        profile.login ||
        "";
      return {
        ...row,
        login: profile.login || "",
        name: fullName,
        email: profile.email || "",
        plan: profile.subscription_plan_name || "",
        planId: profile.subscription_plan_id || "",
        createdFrom: profile.created_from || "",
      };
    });

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      merged = merged.filter(
        (r) =>
          r.userId.toLowerCase().includes(q) ||
          r.email.toLowerCase().includes(q) ||
          r.name.toLowerCase().includes(q) ||
          r.login.toLowerCase().includes(q),
      );
    }

    merged.sort((a, b) => {
      const av = a[sortField] ?? 0;
      const bv = b[sortField] ?? 0;
      if (sortField === "lastActivity") {
        return new Date(bv).getTime() - new Date(av).getTime();
      }
      return bv - av;
    });

    const total = merged.length;
    const pageData = merged.slice(skip, skip + limitNumber);

    return res.json({
      success: true,
      page: pageNumber,
      limit: limitNumber,
      total,
      hasMore: skip + pageData.length < total,
      data: pageData,
    });
  } catch (error) {
    console.error("Admin users list error:", error);
    return res.status(500).json({ success: false, message: "Internal server error", error: error.message });
  }
};

// GET /admin/users/:userId?from&to&type&model&page&limit
exports.userDetail = async (req, res) => {
  try {
    const { userId } = req.params;
    const { from, to, type, model, page = 1, limit = 20 } = req.query;

    if (!userId) {
      return res.status(400).json({ success: false, message: "userId is required" });
    }

    const pageNumber = Math.max(1, parseInt(page));
    const limitNumber = Math.min(100, Math.max(1, parseInt(limit)));
    const skip = (pageNumber - 1) * limitNumber;

    const filter = { userId };
    if (type) filter.type = type;
    if (model) filter.model = model;
    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = parseRangeStart(from);
      if (to) filter.createdAt.$lte = parseRangeEnd(to);
    }

    const [profile, creditStatus, media, total, byModel, totals] = await Promise.all([
      UserProfile.findOne({ user_id: userId }).lean(),
      UnifiedCreditController.getCreditStatus(userId).catch(() => null),
      GeneratedMedia.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limitNumber).lean(),
      GeneratedMedia.countDocuments(filter),
      GeneratedMedia.aggregate([
        { $match: { userId, ...(from || to ? { createdAt: filter.createdAt } : {}) } },
        ...buildEffectiveCostStages(),
        {
          $group: {
            _id: "$model",
            generations: { $sum: 1 },
            cost: { $sum: "$effective_cost" },
            credits: { $sum: "$effective_credits" },
          },
        },
        { $project: { _id: 0, model: "$_id", generations: 1, cost: { $round: ["$cost", 4] }, credits: 1 } },
        { $sort: { cost: -1 } },
      ]),
      GeneratedMedia.aggregate([
        { $match: { userId, ...(from || to ? { createdAt: filter.createdAt } : {}) } },
        ...buildEffectiveCostStages(),
        {
          $group: {
            _id: null,
            generations: { $sum: 1 },
            cost: { $sum: "$effective_cost" },
            credits: { $sum: "$effective_credits" },
            images: { $sum: { $cond: [{ $eq: ["$type", "image"] }, 1, 0] } },
            videos: { $sum: { $cond: [{ $eq: ["$type", "video"] }, 1, 0] } },
          },
        },
      ]),
    ]);

    const summary = totals[0] || { generations: 0, cost: 0, credits: 0, images: 0, videos: 0 };

    return res.json({
      success: true,
      user: profile
        ? {
            userId: profile.user_id,
            login: profile.login,
            name: profile.name || [profile.name_f, profile.name_l].filter(Boolean).join(" ").trim(),
            email: profile.email,
            plan: profile.subscription_plan_name,
            planId: profile.subscription_plan_id,
            planExpiry: profile.subscription_expiry,
            createdFrom: profile.created_from,
            createdAt: profile.createdAt,
          }
        : { userId },
      credits: creditStatus,
      summary: {
        generations: summary.generations,
        cost: parseFloat((summary.cost || 0).toFixed(4)),
        credits: summary.credits || 0,
        images: summary.images || 0,
        videos: summary.videos || 0,
      },
      byModel,
      generations: {
        page: pageNumber,
        limit: limitNumber,
        total,
        hasMore: skip + media.length < total,
        data: media,
      },
    });
  } catch (error) {
    console.error("Admin user detail error:", error);
    return res.status(500).json({ success: false, message: "Internal server error", error: error.message });
  }
};
