/**
 * Pure transform: raw Meta insights rows -> metric values keyed by entity id.
 *
 * Lives in utils/ rather than inside metaTableMetricsController.js so it can
 * be unit-tested directly. The controller pulls in the SDK, Redis and Mongo
 * at require-time (Redis in particular opens a connection on import), so a
 * test that required the controller would hang on open handles.
 */
const { extractMetricValue } = require("../config/metricsCatalog");

// Which insights field carries the row's entity id, per table level. This is
// the join key the frontend merges each table row on.
const ID_FIELD_BY_LEVEL = {
  campaign: "campaign_id",
  adset: "adset_id",
  ad: "ad_id",
};

/**
 * @param {Array} rows      Meta insights rows (SDK objects or plain `_data`)
 * @param {Array} entries   catalog entries for the user's selected metrics
 * @param {'campaign'|'adset'|'ad'} level
 * @returns {{[entityId: string]: {[catalogKey: string]: number}}}
 *
 * Rows missing the level's id field are skipped rather than keyed under
 * `undefined`, which would collapse every such row into one bogus entry.
 * Every extraction goes through extractMetricValue so the MAX-across-
 * action-types dedup (mobile_app_install vs omni_app_install) applies here
 * exactly as it does on the Analytics tab — see gotchas.md.
 */
function buildMetricsMap(rows, entries, level) {
  const idField = ID_FIELD_BY_LEVEL[level];
  const metrics = {};
  for (const raw of rows || []) {
    const row = raw?._data || raw;
    const id = row?.[idField];
    if (!id) continue;
    const values = {};
    for (const entry of entries) {
      values[entry.key] = extractMetricValue(entry, row);
    }
    metrics[id] = values;
  }
  return metrics;
}

module.exports = { buildMetricsMap, ID_FIELD_BY_LEVEL };
