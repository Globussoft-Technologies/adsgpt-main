/**
 * metaApiUsage — one document per (user, ad account, source, hour).
 *
 * WHY THIS EXISTS. When Meta answers "Application request limit reached" the
 * only question that matters is *which* meter filled and *who* filled it, and
 * neither is answerable after the fact today: the usage headers Meta returns
 * on every response are read for self-throttling and then discarded. This
 * collection is those headers, kept.
 *
 * TWO KINDS OF NUMBER, AND THEY ANSWER DIFFERENT QUESTIONS.
 *
 *   `calls` / `failures` / `throttles` are OURS — a count of requests we made.
 *   Answers "how much is this account costing us", which is the question an
 *   admin asks.
 *
 *   `peak.*` are META'S — utilisation percentages lifted straight off the
 *   response headers. Answers "how close to refusal were we", which is the
 *   question an outage asks. These are not derivable from a request count:
 *   the BUC bucket meters CPU time, so ten expensive insights calls can sit
 *   at 80% while a thousand cheap reads sit at 2%.
 *
 * Keeping both is the point. A count without the percentages can't explain a
 * throttle; percentages without a count can't attribute one.
 *
 * WHY HOURLY BUCKETS. Meta's windows are rolling and roughly hourly, so an
 * hour is the smallest grain where a peak means anything, and the largest
 * where "which hour did we break" is still answerable. Writes are `$inc` and
 * `$max` upserts, so concurrent workers on the same bucket compose instead of
 * racing — nothing here needs a read-modify-write.
 *
 * PEAKS, NOT AVERAGES. A mean utilisation of 40% across an hour tells you
 * nothing about the minute you were refused at 100%. `$max` keeps the moment
 * that mattered; the average would hide exactly the event this collection is
 * for.
 */
const mongoose = require("mongoose");

// Long enough to investigate a throttle that happened "sometime last month",
// short enough that a per-hour-per-account collection stays small. Overridable
// because a busy install may want less, not because anyone needs more.
const RETENTION_DAYS = Number(process.env.META_USAGE_RETENTION_DAYS) || 30;

// Utilisation percentages, 0-100, as Meta reports them. Every field is a
// separate meter that can throttle us independently — collapsing them to one
// number is what made the AstroLive failure unreadable, so they stay split.
const PeakSchema = new mongoose.Schema(
  {
    app: { type: Number, default: 0 }, // x-app-usage — shared by ALL accounts
    buc: { type: Number, default: 0 }, // x-business-use-case-usage
    insightsApp: { type: Number, default: 0 }, // x-fb-ads-insights-throttle, app-wide
    insightsAcc: { type: Number, default: 0 }, // x-fb-ads-insights-throttle, this account
    acc: { type: Number, default: 0 }, // x-ad-account-usage
    reach: { type: Number, default: 0 }, // x-fb-ads-insights-reach-throttle
  },
  { _id: false },
);

const metaApiUsageSchema = new mongoose.Schema(
  {
    // Null when a code path has no user context (a partner-API key, a
    // system job). Kept nullable rather than required so an unattributed
    // call is still counted — an uncounted call is worse than an
    // unattributed one, because the totals stop reconciling.
    userId: { type: String, default: null, index: true },

    // Digits only, no `act_` prefix — normalised at write time so the same
    // account can never split across two buckets.
    adAccountId: { type: String, default: null, index: true },

    // Which part of the product spent this. The whole reason the admin page
    // is worth building: Autopilot's draw is steady and predictable, a user
    // browsing Ads Manager is neither, and today they are indistinguishable.
    source: { type: String, default: "unknown", index: true },

    // Truncated to the top of the hour, UTC.
    hourStart: { type: Date, required: true },

    // ── our counters ────────────────────────────────────────────────────
    calls: { type: Number, default: 0 },
    failures: { type: Number, default: 0 },
    // Requests Meta refused for rate limiting specifically. A subset of
    // `failures`, split out because it is the only failure kind that says
    // anything about capacity.
    throttles: { type: Number, default: 0 },

    // WHY the failures failed: Meta error code -> count within this hour.
    //
    // `failures` alone answers "how many", which is never the question. An
    // account failing 100% of its requests is a dead token, a revoked
    // permission or a disabled account, and those have three different
    // owners and three different fixes — but they arrive as the same
    // increment to the same counter. Investigating act_1125685999756619
    // (161/161 failures over 13 days) took six ad-hoc queries and still
    // could not name the code, because the code was never written down.
    //
    // A Map, not a sub-document: the key space belongs to Meta, which adds
    // codes without telling us, and a fixed schema would silently drop every
    // code it did not already know about — reproducing this exact gap.
    //
    // Keyed on the CODE ALONE, not code/subcode — subcodes would multiply the
    // cardinality of a per-hour-per-account field, and the code is enough to
    // separate the causes that have different OWNERS: capacity, access,
    // a temporary block, a malformed request.
    //
    // It is not enough to separate every cause. Meta's `100` and `200` are
    // catch-alls whose specific meaning lives in the subcode, and negative
    // codes are internal Meta errors that report their real failure there
    // too. Those rows narrow the question rather than answering it. A subcode
    // breakdown is additive — a second field, not a change to this one — and
    // is worth adding once this column shows which of them we actually hit.
    byCode: { type: Map, of: Number, default: () => new Map() },

    // ── Meta's meters ───────────────────────────────────────────────────
    peak: { type: PeakSchema, default: () => ({}) },

    // Worst `estimated_time_to_regain_access` seen this hour, in ms. Non-zero
    // means Meta actually blocked us rather than merely warned.
    maxBlockedMs: { type: Number, default: 0 },

    // `ads_api_access_tier` as reported — "standard_access" vs "development".
    // Worth storing because it is the first thing questioned during an
    // incident and the answer is otherwise a guess.
    tier: { type: String, default: null },
  },
  { timestamps: true },
);

// The upsert key. Unique so two workers writing the same bucket in the same
// millisecond produce one document, not two.
metaApiUsageSchema.index(
  { userId: 1, adAccountId: 1, source: 1, hourStart: 1 },
  { unique: true },
);

// The admin drill-down: one user's accounts over time, newest first.
metaApiUsageSchema.index({ userId: 1, hourStart: -1 });
// The platform view: everything in an hour, regardless of who.
metaApiUsageSchema.index({ hourStart: -1 });

// Operational telemetry, not an audit trail — expire it.
metaApiUsageSchema.index(
  { hourStart: 1 },
  { expireAfterSeconds: RETENTION_DAYS * 24 * 60 * 60 },
);

module.exports = mongoose.model("MetaApiUsage", metaApiUsageSchema);
module.exports.RETENTION_DAYS = RETENTION_DAYS;
