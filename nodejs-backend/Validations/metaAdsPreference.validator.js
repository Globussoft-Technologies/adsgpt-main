/**
 * Joi schema for PATCHing a user's Meta Ads UI preferences.
 *
 * Every key is validated against the live catalog (config/metricsCatalog.js)
 * rather than accepting any string, so a stale frontend bundle can't
 * accumulate junk keys in the preference document.
 */
const Joi = require("joi");
const { getMetricsCatalog } = require("../config/metricsCatalog");
const { TABLE_LEVELS } = require("../Module/metaAds/metaAdsPreference");

const ALL_CATALOG_KEYS = getMetricsCatalog().map((m) => m.key);

// Upper bound on metric COLUMNS per table. Bounds both the rendered column
// count (past ~20 the table stops being readable) and the server-side
// extraction loop per row.
const TABLE_METRIC_CAP = 20;

const catalogKeys = () =>
  Joi.array().items(Joi.string().valid(...ALL_CATALOG_KEYS)).unique();

const tablesShape = TABLE_LEVELS.reduce((acc, level) => {
  // No `.min()` here — unlike the KPI dashboard, ZERO metric columns is a
  // perfectly valid table (it's exactly how the tables looked before this
  // feature), so the user must be able to clear them all.
  acc[level] = catalogKeys().max(TABLE_METRIC_CAP);
  return acc;
}, {});

const updatePreferenceSchema = Joi.object({
  analytics: Joi.object({
    // `.min(1)` retained: an empty KPI dashboard isn't a valid state.
    visibleMetricKeys: catalogKeys().min(1).max(80).required(),
  }),
  tables: Joi.object(tablesShape).min(1),
})
  // A PATCH must name at least one namespace — an empty body is a no-op that
  // almost certainly means the caller built the payload wrong.
  .min(1);

module.exports = {
  updatePreferenceSchema,
  TABLE_METRIC_CAP,
  ALL_CATALOG_KEYS,
};
