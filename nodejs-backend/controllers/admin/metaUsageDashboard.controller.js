/**
 * Admin dashboard for Meta API usage — who is spending our shared quota, and
 * how close to Meta's ceilings we came.
 *
 * READ THIS BEFORE CHANGING AN AGGREGATION. Counters and meters must NEVER be
 * combined the same way:
 *
 *   calls / failures / throttles  →  $sum. They are counts of our requests.
 *   peak.*                        →  $max. They are percentages of a ceiling.
 *
 * Summing percentages is meaningless — two hours at 50% is not 100% of
 * anything — and averaging them hides the spike that caused the outage, which
 * is the only reading anyone opens this page to find. Every rollup below
 * therefore reports the WORST reading in the range, not a total or a mean.
 *
 * WHY THE APP METER IS REPORTED SEPARATELY FROM THE REST. `peak.app` is a
 * single platform-wide pool shared by every customer; the others are
 * per-account. Showing them in one column would invite the conclusion that a
 * busy account caused an app-level refusal, when the app bucket can be filled
 * by anyone. The overview keeps them apart for that reason.
 */
const MetaApiUsage = require("../../Module/metaUsage/metaApiUsage");
const {
  sharedUsageRecorder,
} = require("../../services/meta/metaUsageRecorder");

const HOUR_MS = 60 * 60 * 1000;
const DEFAULT_WINDOW_HOURS = 24;
const MAX_WINDOW_HOURS = 24 * 31;

// Counts add up; percentages take the worst. Kept as one object so a new
// field cannot accidentally be added to the wrong side.
const COUNT_SUMS = {
  calls: { $sum: "$calls" },
  failures: { $sum: "$failures" },
  throttles: { $sum: "$throttles" },
};
const PEAK_MAXES = {
  peakApp: { $max: "$peak.app" },
  peakBuc: { $max: "$peak.buc" },
  peakInsightsApp: { $max: "$peak.insightsApp" },
  peakInsightsAcc: { $max: "$peak.insightsAcc" },
  peakAcc: { $max: "$peak.acc" },
  peakReach: { $max: "$peak.reach" },
  maxBlockedMs: { $max: "$maxBlockedMs" },
};

const EMPTY_TOTALS = {
  calls: 0,
  failures: 0,
  throttles: 0,
  peakApp: 0,
  peakBuc: 0,
  peakInsightsApp: 0,
  peakInsightsAcc: 0,
  peakAcc: 0,
  peakReach: 0,
  maxBlockedMs: 0,
};

/**
 * A bare `YYYY-MM-DD` is a DAY, not an instant — and which instant it means
 * depends on which end of the range it is.
 *
 * The admin date picker sends date-only strings. Parsing the end as
 * `new Date("2026-09-01")` yields midnight UTC, so `hourStart <= that`
 * excludes everything recorded during the day the user actually selected —
 * the page renders empty while the data sits in the collection. Mirrors
 * parseRangeStart/parseRangeEnd in adminDashboard.controller.js.
 */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function parseDate(value, edge) {
  if (!value) return null;
  const raw = String(value);
  const iso = DATE_ONLY.test(raw)
    ? `${raw}T${edge === "end" ? "23:59:59.999" : "00:00:00.000"}Z`
    : raw;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Resolve the requested window, defaulting to the last 24 hours and refusing
 * to scan beyond the collection's own retention — a wider range costs a full
 * scan and can only return the same rows.
 */
function resolveRange(query = {}) {
  const to = parseDate(query.to, "end") || new Date();
  let from = parseDate(query.from, "start");
  if (!from) from = new Date(to.getTime() - DEFAULT_WINDOW_HOURS * HOUR_MS);
  const maxSpan = MAX_WINDOW_HOURS * HOUR_MS;
  if (to.getTime() - from.getTime() > maxSpan) {
    from = new Date(to.getTime() - maxSpan);
  }
  return { from, to };
}

function buildMatch(query = {}, extra = {}) {
  const { from, to } = resolveRange(query);
  const match = { hourStart: { $gte: from, $lte: to }, ...extra };
  if (query.source) match.source = query.source;
  if (query.adAccountId) {
    match.adAccountId = String(query.adAccountId).replace(/^act_/, "");
  }
  return { match, from, to };
}

/**
 * Health of the recorder in THIS process.
 *
 * Surfaced because the page must be able to say when its own numbers are
 * incomplete. The recorder drops a batch rather than retrying during a Mongo
 * outage, and a silently short total is worse than a warning. Note this
 * reflects one process — under PM2 cluster mode other workers have their own.
 */
function recorderHealth() {
  const snap = sharedUsageRecorder.snapshot();
  return {
    ...snap,
    warning: snap.droppedBatches > 0
      ? "Some usage batches were dropped (database unavailable). Totals below may be understated."
      : null,
  };
}

exports.overview = async (req, res) => {
  try {
    const { match, from, to } = buildMatch(req.query);

    const [totalsAgg, hourly, bySource, topAccounts, topUsers] =
      await Promise.all([
        MetaApiUsage.aggregate([
          { $match: match },
          { $group: { _id: null, ...COUNT_SUMS, ...PEAK_MAXES } },
        ]),
        MetaApiUsage.aggregate([
          { $match: match },
          { $group: { _id: "$hourStart", ...COUNT_SUMS, ...PEAK_MAXES } },
          { $project: { _id: 0, hour: "$_id", ...projectAll() } },
          { $sort: { hour: 1 } },
        ]),
        MetaApiUsage.aggregate([
          { $match: match },
          { $group: { _id: "$source", ...COUNT_SUMS, ...PEAK_MAXES } },
          { $project: { _id: 0, source: "$_id", ...projectAll() } },
          { $sort: { calls: -1 } },
        ]),
        MetaApiUsage.aggregate([
          { $match: { ...match, adAccountId: { $ne: null } } },
          {
            $group: {
              _id: { adAccountId: "$adAccountId", userId: "$userId" },
              ...COUNT_SUMS,
              ...PEAK_MAXES,
            },
          },
          {
            $project: {
              _id: 0,
              adAccountId: "$_id.adAccountId",
              userId: "$_id.userId",
              ...projectAll(),
            },
          },
          { $sort: { calls: -1 } },
          { $limit: 25 },
        ]),
        MetaApiUsage.aggregate([
          { $match: { ...match, userId: { $ne: null } } },
          { $group: { _id: "$userId", ...COUNT_SUMS, ...PEAK_MAXES } },
          { $project: { _id: 0, userId: "$_id", ...projectAll() } },
          { $sort: { calls: -1 } },
          { $limit: 25 },
        ]),
      ]);

    const totals = stripId(totalsAgg[0]) || { ...EMPTY_TOTALS };

    return res.json({
      range: { from, to },
      totals,
      hourly,
      bySource,
      topAccounts,
      topUsers,
      recorder: recorderHealth(),
    });
  } catch (err) {
    return res
      .status(500)
      .json({ message: "Failed to load Meta usage overview", error: err.message });
  }
};

exports.userDetail = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!userId) return res.status(400).json({ message: "userId is required" });

    const { match, from, to } = buildMatch(req.query, { userId });

    const [totalsAgg, byAccount, hourly, bySource] = await Promise.all([
      MetaApiUsage.aggregate([
        { $match: match },
        { $group: { _id: null, ...COUNT_SUMS, ...PEAK_MAXES } },
      ]),
      MetaApiUsage.aggregate([
        { $match: match },
        { $group: { _id: "$adAccountId", ...COUNT_SUMS, ...PEAK_MAXES } },
        { $project: { _id: 0, adAccountId: "$_id", ...projectAll() } },
        { $sort: { calls: -1 } },
      ]),
      MetaApiUsage.aggregate([
        { $match: match },
        {
          $group: {
            _id: { hour: "$hourStart", adAccountId: "$adAccountId" },
            ...COUNT_SUMS,
            ...PEAK_MAXES,
          },
        },
        {
          $project: {
            _id: 0,
            hour: "$_id.hour",
            adAccountId: "$_id.adAccountId",
            ...projectAll(),
          },
        },
        { $sort: { hour: 1 } },
      ]),
      MetaApiUsage.aggregate([
        { $match: match },
        { $group: { _id: "$source", ...COUNT_SUMS, ...PEAK_MAXES } },
        { $project: { _id: 0, source: "$_id", ...projectAll() } },
        { $sort: { calls: -1 } },
      ]),
    ]);

    return res.json({
      userId,
      range: { from, to },
      totals: stripId(totalsAgg[0]) || { ...EMPTY_TOTALS },
      byAccount,
      hourly,
      bySource,
      recorder: recorderHealth(),
    });
  } catch (err) {
    return res
      .status(500)
      .json({ message: "Failed to load Meta usage detail", error: err.message });
  }
};

/** Field list for a `$project` that follows one of the groups above. */
function projectAll() {
  const out = {};
  for (const key of Object.keys(COUNT_SUMS)) out[key] = 1;
  for (const key of Object.keys(PEAK_MAXES)) out[key] = 1;
  return out;
}

function stripId(doc) {
  if (!doc) return null;
  const { _id, ...rest } = doc;
  return rest;
}

exports._internals = { resolveRange, buildMatch, COUNT_SUMS, PEAK_MAXES };
