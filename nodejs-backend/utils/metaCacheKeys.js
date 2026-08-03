/**
 * Shared cache-key fragment builders for the Meta Ads insights endpoints.
 *
 * These live in one place on purpose. Several endpoints (getAnalyticsData,
 * the table-metrics endpoint) cache responses whose SHAPE depends on stored
 * user state — the selected metric keys — and whose VALUES depend on the
 * requested date range. If any of that is missing from the key, a cached
 * entry gets served for a request it doesn't actually answer.
 *
 * That has already shipped twice on this surface:
 *   - the metrics fingerprint was originally omitted, so changing your metric
 *     selection served the previous selection's `stats` and every newly
 *     picked metric rendered as an empty "—" card;
 *   - and a raw `datePreset` fragment collapses to the string "undefined"
 *     for a custom `since`/`until` request, which would make EVERY custom
 *     range share one cache entry.
 *
 * Building keys through these helpers instead of inline template literals is
 * what stops the two endpoints' key construction from drifting apart.
 */
const crypto = require("crypto");

/**
 * Stable short hash of a set of catalog metric keys. Order-insensitive (the
 * same selection in a different order must hit the same cache entry) and
 * collision-resistant enough at 10 hex chars for a per-user keyspace.
 */
function metricsFingerprint(keys) {
  return crypto
    .createHash("sha1")
    .update([...(keys || [])].sort().join(","))
    .digest("hex")
    .slice(0, 10);
}

/**
 * Cache-key fragment for a resolved date range (see utils/metaDateRange.js).
 * Accepts the object `resolveDateRange()` returns, which already carries a
 * `token`; falls back to deriving one so a caller can't accidentally key on
 * `undefined`.
 */
function dateRangeToken(range) {
  if (range && range.token) return range.token;
  if (range && range.since && range.until) return `r:${range.since}_${range.until}`;
  if (range && range.datePreset) return `p:${range.datePreset}`;
  return "p:none";
}

module.exports = { metricsFingerprint, dateRangeToken };
