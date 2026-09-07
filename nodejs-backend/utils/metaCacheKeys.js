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
 *
 * CACHE_SHAPE and the invalidation patterns live here for the same reason —
 * and because this module is PURE. metaAdLauncher.js opens DB and Redis
 * connections at require time, so nothing defined in it is reachable from a
 * unit test; cache invalidation had no test at all before this file grew one,
 * which is exactly how the bug documented below survived for weeks.
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

// Bumped whenever the shape of ANY cached payload changes. Without it a
// release that adds a field keeps serving entries that predate it for the full
// TTL, so the new field reads as permanently empty. Old keys are simply
// orphaned and expire on their own.
//
// EVERY cached response shape belongs behind this, not just the entity lists.
// Real hit (2026-08-28): carousel support added `kind:"carousel"` + `cards` to
// getAdPreviewMedia, but `metaAdPreview:` had no CACHE_SHAPE segment — so a
// launched carousel kept rendering as a single image for 30 minutes, and the
// network response said `kind:"image"` with the new code deployed. Same latent
// bug in `metaRecommendations:`, whose shape also changed this cycle
// (opportunityScore + composed headline).
//
// When you add a cached endpoint, put CACHE_SHAPE in its key. When you change
// what an existing one returns, bump this.
//
// Moved out of metaAdLauncher.js (2026-09-07) so utils/planUsage.js can read
// the same value: it reuses the dashboard's own `metaCampaigns:` entries, and
// its hardcoded copy of that key silently stopped matching — falling back to a
// live Meta call per ad account on every plan-usage readout — the moment the
// shape segment landed.
const CACHE_SHAPE = "v3";

/**
 * cacheInvalidationPatterns — the SCAN patterns matching one logical cache
 * entry under BOTH key conventions.
 *
 * Meta cache keys come in two shapes, and an invalidator has to catch both:
 *
 *   shape-versioned   metaCampaigns:v3:<userId>:<facebookId>:<adAccountId>
 *   unversioned       metaDashboard:<userId>:<facebookId>:<adAccountId>:<preset>
 *
 * THE BUG THIS EXISTS TO PREVENT (found 2026-09-07, live since 2026-08-20):
 * both invalidators matched `<prefix>:<userId>:*` only. The shape segment sits
 * BEFORE the userId, so that pattern stopped matching the moment CACHE_SHAPE
 * was added to the entity-list keys — Redis found nothing to delete and every
 * versioned key survived every invalidation, including FB disconnect. Pausing
 * a campaign left the table showing the old status for the full 2-hour TTL
 * while the dashboard tiles (unversioned, still matching) updated correctly,
 * which is why it read as a flaky UI rather than a cache bug.
 *
 * Only the CURRENT shape is emitted. Entries under an older shape are orphaned
 * by definition — nothing reads them and they expire on their own — so
 * widening this to `<prefix>:*:<userId>:*` to sweep them up would buy nothing
 * and cost precision: Redis globs have no single-segment wildcard, so a `*`
 * there can absorb `:` and reach into a neighbouring user's keyspace.
 *
 * @param {string} prefix  key namespace, e.g. "metaCampaigns"
 * @param {string} tail    everything after the userId, e.g. "*" or "*:12345"
 * @returns {string[]} patterns to SCAN, unversioned first
 */
function cacheInvalidationPatterns(prefix, tail) {
  return [`${prefix}:${tail}`, `${prefix}:${CACHE_SHAPE}:${tail}`];
}

module.exports = {
  metricsFingerprint,
  dateRangeToken,
  CACHE_SHAPE,
  cacheInvalidationPatterns,
};
