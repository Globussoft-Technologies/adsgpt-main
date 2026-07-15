const TokenUsage = require("../../Module/tokenUsage/tokenUsage");

// Same convention as adminDashboard.controller.js's date-range parsing: a
// plain "YYYY-MM-DD" represents a whole calendar day (start/end-of-day UTC),
// a full ISO timestamp passes through unchanged.
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

const TOKEN_SUMS = {
  calls: { $sum: 1 },
  inputTokens: { $sum: "$inputTokens" },
  outputTokens: { $sum: "$outputTokens" },
  thinkingTokens: { $sum: "$thinkingTokens" },
  cachedTokens: { $sum: "$cachedTokens" },
  toolUseTokens: { $sum: "$toolUseTokens" },
  totalTokens: { $sum: "$totalTokens" },
  // $sum treats null as 0, so a model with no pricing entry just contributes
  // $0 rather than erroring — unpricedCalls flags when that makes the total
  // an undercount rather than a true $0.
  costUsd: { $sum: "$costUsd" },
  unpricedCalls: { $sum: { $cond: [{ $eq: ["$costUsd", null] }, 1, 0] } },
};

// GET /admin/token-usage/overview?from&to&feature
exports.overview = async (req, res) => {
  try {
    const { from, to, feature } = req.query;
    const match = { ...buildDateMatch(from, to), ...(feature ? { feature } : {}) };

    const [totalsAgg, byModelAgg, byFeatureAgg, dailyAgg, distinctUsers] = await Promise.all([
      TokenUsage.aggregate([{ $match: match }, { $group: { _id: null, ...TOKEN_SUMS } }]),
      TokenUsage.aggregate([
        { $match: match },
        { $group: { _id: "$model", ...TOKEN_SUMS } },
        { $project: { _id: 0, model: "$_id", ...projectFields() } },
        { $sort: { totalTokens: -1 } },
      ]),
      TokenUsage.aggregate([
        { $match: match },
        { $group: { _id: "$feature", ...TOKEN_SUMS } },
        { $project: { _id: 0, feature: "$_id", ...projectFields() } },
        { $sort: { totalTokens: -1 } },
      ]),
      TokenUsage.aggregate([
        { $match: match },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
            ...TOKEN_SUMS,
          },
        },
        { $project: { _id: 0, date: "$_id", ...projectFields() } },
        { $sort: { date: 1 } },
      ]),
      TokenUsage.distinct("userId", match),
    ]);

    const totals = totalsAgg[0] || {
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      thinkingTokens: 0,
      cachedTokens: 0,
      toolUseTokens: 0,
      totalTokens: 0,
      costUsd: 0,
      unpricedCalls: 0,
    };

    return res.json({
      success: true,
      range: { from: from || null, to: to || null },
      totals: { ...totals, users: distinctUsers.length },
      byModel: byModelAgg,
      byFeature: byFeatureAgg,
      daily: dailyAgg,
    });
  } catch (error) {
    console.error("Admin token usage overview error:", error);
    return res.status(500).json({ success: false, message: "Internal server error", error: error.message });
  }
};

// GET /admin/token-usage/users/:userId?from&to
// Model-wise and date-wise breakdown for one user — feeds the Token usage
// section on the admin Users detail page.
exports.userDetail = async (req, res) => {
  try {
    const { userId } = req.params;
    const { from, to } = req.query;
    if (!userId) {
      return res.status(400).json({ success: false, message: "userId is required" });
    }

    const match = { userId, ...buildDateMatch(from, to) };

    const [totalsAgg, byModelAgg, dailyAgg] = await Promise.all([
      TokenUsage.aggregate([{ $match: match }, { $group: { _id: null, ...TOKEN_SUMS } }]),
      TokenUsage.aggregate([
        { $match: match },
        { $group: { _id: "$model", ...TOKEN_SUMS } },
        { $project: { _id: 0, model: "$_id", ...projectFields() } },
        { $sort: { totalTokens: -1 } },
      ]),
      TokenUsage.aggregate([
        { $match: match },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
            ...TOKEN_SUMS,
          },
        },
        { $project: { _id: 0, date: "$_id", ...projectFields() } },
        { $sort: { date: -1 } },
      ]),
    ]);

    const totals = totalsAgg[0] || {
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      thinkingTokens: 0,
      cachedTokens: 0,
      toolUseTokens: 0,
      totalTokens: 0,
      costUsd: 0,
      unpricedCalls: 0,
    };

    return res.json({
      success: true,
      range: { from: from || null, to: to || null },
      totals,
      byModel: byModelAgg,
      daily: dailyAgg,
    });
  } catch (error) {
    console.error("Admin token usage user detail error:", error);
    return res.status(500).json({ success: false, message: "Internal server error", error: error.message });
  }
};

function projectFields() {
  return {
    calls: 1,
    inputTokens: 1,
    outputTokens: 1,
    thinkingTokens: 1,
    cachedTokens: 1,
    toolUseTokens: 1,
    totalTokens: 1,
    costUsd: 1,
    unpricedCalls: 1,
  };
}
