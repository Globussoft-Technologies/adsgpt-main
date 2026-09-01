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
const MetaAdAccountName = require("../../Module/metaUsage/metaAdAccountName");
const UserProfile = require("../../Module/user/userProfileModel");
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

/** Treat "all" and "" the same as absent — the UI sends "all" for no filter. */
function filterValue(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (!s || s === "all") return null;
  return s;
}

function buildMatch(query = {}, extra = {}) {
  const { from, to } = resolveRange(query);
  const match = { hourStart: { $gte: from, $lte: to }, ...extra };

  const source = filterValue(query.source);
  if (source) match.source = source;

  const account = filterValue(query.adAccountId);
  if (account) match.adAccountId = account.replace(/^act_/, "");

  const user = filterValue(query.userId);
  if (user && !extra.userId) match.userId = user;

  // "Show me only what Meta actually refused" — the fastest way to get from
  // an alert to the rows that caused it.
  if (String(query.onlyThrottled) === "true") match.throttles = { $gt: 0 };

  return { match, from, to };
}

const SORTABLE = new Set([
  "calls",
  "failures",
  "throttles",
  "peakApp",
  "peakBuc",
  "peakInsightsAcc",
  "peakInsightsApp",
  "peakAcc",
]);

/**
 * Sort spec for the account/user tables.
 *
 * Whitelisted rather than passed through: `$sort` takes a field path, and an
 * unchecked one from the query string lets a caller sort by anything in the
 * document — cheap to guard, awkward to notice if left open.
 */
function buildSort(query = {}) {
  const field = SORTABLE.has(String(query.sort)) ? String(query.sort) : "calls";
  const dir = String(query.order).toLowerCase() === "asc" ? 1 : -1;
  return { [field]: dir };
}

function parseLimit(value, fallback, max) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

/**
 * Attach display names to rows that only carry ids.
 *
 * Two lookups rather than a `$lookup` in each aggregation: the pipelines run
 * in parallel and would each repeat the join, and the id sets are small
 * enough (a page of rows) that one batched query per collection is cheaper
 * and far easier to read.
 */
async function decorate(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return rows;

  const accountIds = [...new Set(rows.map((r) => r.adAccountId).filter(Boolean))];
  const userIds = [...new Set(rows.map((r) => r.userId).filter(Boolean))];

  const [names, profiles] = await Promise.all([
    accountIds.length
      ? MetaAdAccountName.find({ adAccountId: { $in: accountIds } })
          .select("adAccountId name")
          .lean()
      : [],
    userIds.length
      ? UserProfile.find({ user_id: { $in: userIds } })
          .select("user_id name name_f name_l email")
          .lean()
      : [],
  ]);

  const nameById = new Map(names.map((n) => [n.adAccountId, n.name]));
  const profileById = new Map(profiles.map((p) => [p.user_id, p]));

  return rows.map((r) => {
    const p = r.userId ? profileById.get(r.userId) : null;
    const full = p
      ? p.name || [p.name_f, p.name_l].filter(Boolean).join(" ") || ""
      : "";
    return {
      ...r,
      // Empty string, not the id — the UI decides how to fall back, and
      // conflating "unnamed" with "named after its id" would be a lie.
      adAccountName: r.adAccountId ? nameById.get(r.adAccountId) || "" : "",
      userName: full,
      userEmail: p?.email || "",
    };
  });
}

/**
 * Text search across ids and names.
 *
 * Applied AFTER decoration rather than as a `$match`, because the thing being
 * searched — the account name — lives in a different collection and is
 * attached only at the end. The candidate set is one page of rollups, so
 * filtering in memory here is bounded and avoids a join in five pipelines.
 */
function applySearch(rows, term) {
  const q = filterValue(term);
  if (!q) return rows;
  const needle = q.toLowerCase().replace(/^act_/, "");
  return rows.filter((r) =>
    [r.adAccountId, r.adAccountName, r.userId, r.userName, r.userEmail, r.source]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(needle)),
  );
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
    const sort = buildSort(req.query);
    const limit = parseLimit(req.query.limit, 25, 200);

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
          { $sort: sort },
          // Over-fetch so a search term still has rows to match against
          // after the in-memory filter below narrows them.
          { $limit: Math.max(limit * 4, 100) },
        ]),
        MetaApiUsage.aggregate([
          { $match: { ...match, userId: { $ne: null } } },
          { $group: { _id: "$userId", ...COUNT_SUMS, ...PEAK_MAXES } },
          { $project: { _id: 0, userId: "$_id", ...projectAll() } },
          { $sort: sort },
          { $limit: Math.max(limit * 4, 100) },
        ]),
      ]);

    const totals = stripId(totalsAgg[0]) || { ...EMPTY_TOTALS };
    const accounts = applySearch(await decorate(topAccounts), req.query.search);
    const users = applySearch(await decorate(topUsers), req.query.search);

    return res.json({
      range: { from, to },
      totals,
      hourly,
      bySource,
      topAccounts: accounts.slice(0, limit),
      topUsers: users.slice(0, limit),
      // So the table can say "showing 25 of 140" rather than implying the
      // list is complete.
      counts: { accounts: accounts.length, users: users.length },
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

    const [profile] = await UserProfile.find({ user_id: userId })
      .select("user_id name name_f name_l email")
      .lean();

    return res.json({
      userId,
      user: profile
        ? {
            userId,
            name:
              profile.name ||
              [profile.name_f, profile.name_l].filter(Boolean).join(" ") ||
              "",
            email: profile.email || "",
          }
        : null,
      range: { from, to },
      totals: stripId(totalsAgg[0]) || { ...EMPTY_TOTALS },
      byAccount: applySearch(await decorate(byAccount), req.query.search),
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

/**
 * What the filter dropdowns should offer.
 *
 * Derived from the data rather than hardcoded: the source list grows whenever
 * a new product surface starts making Meta calls, and a fixed list would
 * quietly omit exactly the new thing someone is trying to investigate. Scoped
 * to the selected range so the options describe what is actually there.
 */
exports.filterOptions = async (req, res) => {
  try {
    const { match, from, to } = buildMatch(
      // Only the range applies — the options must not narrow themselves by
      // the filters they exist to set.
      { from: req.query.from, to: req.query.to },
    );

    const [sources, accountIds, userIds] = await Promise.all([
      MetaApiUsage.distinct("source", match),
      MetaApiUsage.distinct("adAccountId", { ...match, adAccountId: { $ne: null } }),
      MetaApiUsage.distinct("userId", { ...match, userId: { $ne: null } }),
    ]);

    const [names, profiles] = await Promise.all([
      accountIds.length
        ? MetaAdAccountName.find({ adAccountId: { $in: accountIds } })
            .select("adAccountId name")
            .lean()
        : [],
      userIds.length
        ? UserProfile.find({ user_id: { $in: userIds } })
            .select("user_id name name_f name_l email")
            .lean()
        : [],
    ]);

    const nameById = new Map(names.map((n) => [n.adAccountId, n.name]));
    const profileById = new Map(profiles.map((p) => [p.user_id, p]));

    const byLabel = (a, b) => a.label.localeCompare(b.label);

    return res.json({
      range: { from, to },
      sources: sources.filter(Boolean).sort(),
      accounts: accountIds
        .map((id) => ({
          value: id,
          label: nameById.get(id) ? `${nameById.get(id)} (act_${id})` : `act_${id}`,
        }))
        .sort(byLabel),
      users: userIds
        .map((id) => {
          const p = profileById.get(id);
          const name =
            p?.name || [p?.name_f, p?.name_l].filter(Boolean).join(" ") || "";
          return { value: id, label: name ? `${name} (${id})` : id };
        })
        .sort(byLabel),
    });
  } catch (err) {
    return res
      .status(500)
      .json({ message: "Failed to load Meta usage filters", error: err.message });
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

exports._internals = {
  resolveRange,
  buildMatch,
  buildSort,
  applySearch,
  filterValue,
  COUNT_SUMS,
  PEAK_MAXES,
};
