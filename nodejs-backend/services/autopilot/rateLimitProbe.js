/**
 * rateLimitProbe — read Meta's Business Use Case rate-limit meters for one ad
 * account BEFORE spending the expensive calls on it.
 *
 * WHY THIS EXISTS. The cron was failing whole accounts with "Application
 * request limit reached" while the App Dashboard's Application-Level Rate
 * Limiting page showed 100% remaining. Those are different buckets:
 *
 *   - Application-level limits are app-wide (200 x users/hour) and are what
 *     that dashboard page graphs.
 *   - MARKETING API calls are governed by BUSINESS USE CASE limits, which are
 *     scoped per app PER AD ACCOUNT and appear nowhere in the dashboard —
 *     only in the `x-business-use-case-usage` response header.
 *
 * Which is why only one account in a run failed while the others succeeded:
 * app-wide limits cannot do that.
 *
 * The meters matter more than the call count. BUC tracks THREE percentages —
 * `call_count`, `total_cputime`, `total_time` — and insights queries are
 * expensive server-side, so `total_cputime` can hit 100% on a handful of
 * calls. That is exactly the shape of "dashboard says 42 calls, we're
 * throttled".
 *
 * A dedicated probe rather than reading headers off the audit responses,
 * because the point is to learn the state BEFORE committing to ~9 expensive
 * requests. The probe reads a single field on the account node — about the
 * cheapest call the Graph API offers — and every rate-limited response
 * carries the header too, so one trivial call buys the whole picture.
 *
 * Fails OPEN: any error here returns null and the caller proceeds as before.
 * A broken probe must never be the reason Autopilot stops working.
 */

const axios = require("axios");

const GRAPH_VERSION = "v24.0";
const GRAPH = "https://graph.facebook.com";

// Percentage at which we consider an account too hot to run a full audit
// against. Meta throttles at 100; leaving headroom matters because our own
// audit is what would consume the remainder, and being throttled mid-run
// fails the account anyway — just after paying for it.
const DEFAULT_DEFER_THRESHOLD = 80;

/**
 * Parse the `x-business-use-case-usage` header.
 *
 * Shape is `{ "<ad_account_id>": [ { type, call_count, total_cputime,
 * total_time, estimated_time_to_regain_access, ... } ] }` — an ARRAY per
 * account, one entry per use-case type (e.g. "ads_management",
 * "ads_insights"), each with its own independent meters.
 *
 * Returns the WORST entry across types, since being throttled on any one of
 * them is enough to fail the run.
 */
function parseBucHeader(headerValue, adAccountId) {
  if (!headerValue) return null;
  let parsed;
  try {
    parsed = typeof headerValue === "string" ? JSON.parse(headerValue) : headerValue;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;

  // Header keys are bare numeric ids; callers may hold `act_<id>`.
  const bare = String(adAccountId).replace(/^act_/, "");
  const entries = parsed[bare] || parsed[String(adAccountId)];
  if (!Array.isArray(entries) || entries.length === 0) return null;

  let worst = null;
  for (const e of entries) {
    const callCount = Number(e.call_count) || 0;
    const totalCputime = Number(e.total_cputime) || 0;
    const totalTime = Number(e.total_time) || 0;
    const peak = Math.max(callCount, totalCputime, totalTime);
    const candidate = {
      type: e.type || "unknown",
      callCount,
      totalCputime,
      totalTime,
      // Minutes Meta says we must wait. Non-zero means already blocked.
      estimatedTimeToRegainAccess: Number(e.estimated_time_to_regain_access) || 0,
      peak,
    };
    if (!worst || candidate.peak > worst.peak) worst = candidate;
    // A blocked entry outranks a merely-hot one regardless of percentages.
    if (candidate.estimatedTimeToRegainAccess > 0) {
      if (!worst.estimatedTimeToRegainAccess || candidate.peak > worst.peak) {
        worst = candidate;
      }
    }
  }
  return worst;
}

/**
 * Fetch current BUC usage for one ad account.
 *
 * @returns {Promise<Object|null>} worst-meter usage, or null when unavailable
 *          (no header, network error, bad token — all fail open)
 */
async function probeAccountUsage({ adAccountId, accessToken }) {
  if (!adAccountId || !accessToken) return null;
  const bare = String(adAccountId).replace(/^act_/, "");
  try {
    const res = await axios.get(`${GRAPH}/${GRAPH_VERSION}/act_${bare}`, {
      params: { fields: "id", access_token: accessToken },
      timeout: 10000,
      // A 4xx still carries the usage header — often the most interesting
      // case, since that's when we're already blocked.
      validateStatus: () => true,
    });
    return parseBucHeader(
      res.headers?.["x-business-use-case-usage"],
      bare,
    );
  } catch {
    return null;
  }
}

/**
 * Should we skip this account this tick?
 *
 * Two independent reasons:
 *   - Meta has already blocked us (`estimated_time_to_regain_access > 0`).
 *     Running now guarantees failure.
 *   - Any meter is above the threshold. Our own audit would consume the rest,
 *     and being throttled mid-run fails the account anyway — after paying the
 *     cost. Deferring an hour is strictly cheaper.
 */
function shouldDefer(usage, threshold = DEFAULT_DEFER_THRESHOLD) {
  if (!usage) return { defer: false };
  if (usage.estimatedTimeToRegainAccess > 0) {
    return {
      defer: true,
      reason: `blocked by Meta for another ${usage.estimatedTimeToRegainAccess} min`,
    };
  }
  if (usage.peak >= threshold) {
    return {
      defer: true,
      reason: `usage at ${usage.peak}% (${usage.type}: calls ${usage.callCount}%, cpu ${usage.totalCputime}%, time ${usage.totalTime}%) — above the ${threshold}% threshold`,
    };
  }
  return { defer: false };
}

/** One-line form for logs. */
function formatUsage(usage) {
  if (!usage) return "usage unknown";
  return (
    `${usage.type}: calls ${usage.callCount}% cpu ${usage.totalCputime}% ` +
    `time ${usage.totalTime}%` +
    (usage.estimatedTimeToRegainAccess
      ? ` BLOCKED ${usage.estimatedTimeToRegainAccess}min`
      : "")
  );
}

module.exports = {
  probeAccountUsage,
  parseBucHeader,
  shouldDefer,
  formatUsage,
  DEFAULT_DEFER_THRESHOLD,
};
