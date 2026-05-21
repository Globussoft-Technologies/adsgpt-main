/**
 * metricsSnapshot — pure helper that picks user-facing metrics out of a
 * normalised audit-engine entity row, suitable for storing on
 * `autopilotActionLog.metricsSnapshot`.
 *
 * Strips:
 *   - underscore-prefixed internals (`_created_time`, `_age_gate_failed`,
 *     `_below_spend_floor`).
 *   - the `entity` discriminator (already captured as `level` on the log row).
 *   - id/name fields (already captured as `entityId`/`entityName`).
 *
 * Keeps everything else — spend, ctr, cpa, frequency, roas, conversions,
 * prev_* deltas, status, etc. — so the Phase 4 "why was this paused?" UI can
 * read the metrics that triggered the rule without re-querying Meta.
 *
 * Pure. Returns null for null/undefined/non-object input. Returns a NEW
 * object (does not mutate the caller's data).
 */

const ID_FIELDS = new Set([
  "campaign_id",
  "adset_id",
  "ad_id",
  "campaign_name",
  "adset_name",
  "ad_name",
]);

function pickMetricsSnapshot(data) {
  if (!data || typeof data !== "object") return null;
  const out = {};
  for (const [key, val] of Object.entries(data)) {
    if (key.startsWith("_")) continue;
    if (key === "entity") continue;
    if (ID_FIELDS.has(key)) continue;
    out[key] = val;
  }
  return out;
}

module.exports = {
  pickMetricsSnapshot,
};
