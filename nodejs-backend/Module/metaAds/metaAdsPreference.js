const mongoose = require("mongoose");
const { getDefaultVisibleKeys } = require("../../config/metricsCatalog");

/**
 * MetaAdsPreference — per-user UI configuration for the Meta Ads Manager
 * surface. One document per `userId`, global across all of that user's
 * connected Facebook accounts and ad accounts (same singleton-per-user shape
 * as autopilotSettings.js).
 *
 * Namespaced sub-objects rather than a flat bag, so this can absorb future
 * per-user Meta settings without becoming a junk drawer:
 *   analytics.visibleMetricKeys  → KPI cards on the Analytics tab
 *   tables.{campaign,adset,ad}   → metric COLUMNS on each entity table
 *
 * Both reference keys from config/metricsCatalog.js — one catalog serves
 * every surface because extractMetricValue() is level-agnostic.
 */

const TABLE_LEVELS = ["campaign", "adset", "ad"];

// Metric columns are OFF until a user opts in: the tables then render exactly
// as they did before the feature existed, and no metrics request is made at
// all while the list is empty.
const DEFAULT_TABLE_METRIC_KEYS = [];

// `default: undefined` on every array is deliberate — it preserves the
// difference between "unset" (→ fall back to defaults) and "explicitly
// empty" (the user cleared every column, a legitimate state that has to
// round-trip instead of being re-filled with defaults on the next read).
const analyticsPrefSchema = new mongoose.Schema(
  { visibleMetricKeys: { type: [String], default: undefined } },
  { _id: false },
);

const tablesPrefSchema = new mongoose.Schema(
  {
    campaign: { type: [String], default: undefined },
    adset: { type: [String], default: undefined },
    ad: { type: [String], default: undefined },
  },
  { _id: false },
);

const metaAdsPreferenceSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, unique: true, index: true },
    analytics: { type: analyticsPrefSchema, default: () => ({}) },
    tables: { type: tablesPrefSchema, default: () => ({}) },

    // DEPRECATED pre-namespacing field, kept declared so Mongoose doesn't
    // strip it while hydrating an old document. READ-ONLY — normalizePreference
    // falls back to it, and updatePreference $unsets it on the first
    // namespaced write (lazy per-user shape migration). Never write it.
    visibleMetricKeys: { type: [String], default: undefined },
  },
  {
    timestamps: true,
    // LOAD-BEARING. This model was previously registered as
    // "AnalyticsMetricsPreference", which Mongoose pluralized to
    // `analyticsmetricspreferences` — where every already-saved preference
    // still lives. Without this pin the rename would resolve to
    // `metaadspreferences` and silently orphan all of it: reads would return
    // no document and every user would look like a brand-new one with
    // default metrics, with no error anywhere. Do not "tidy" this away;
    // metaAdsPreference.test.js asserts on it.
    collection: "analyticsmetricspreferences",
  },
);

const MetaAdsPreference = mongoose.model(
  "MetaAdsPreference",
  metaAdsPreferenceSchema,
);

/**
 * Plain-JS defaults for a user with nothing saved. Used by the GET handler so
 * the UI renders without us writing a row on first read.
 */
function defaultPreference(userId) {
  return {
    userId,
    analytics: { visibleMetricKeys: getDefaultVisibleKeys() },
    tables: {
      campaign: [...DEFAULT_TABLE_METRIC_KEYS],
      adset: [...DEFAULT_TABLE_METRIC_KEYS],
      ad: [...DEFAULT_TABLE_METRIC_KEYS],
    },
  };
}

/**
 * Fill a (possibly legacy, possibly null) document out to the full shape.
 *
 * Every read path MUST go through this rather than trusting the schema:
 * reads use `.lean()`, and `.lean()` does NOT apply Mongoose defaults — a
 * lean document simply omits unset fields.
 *
 * Precedence per scope:
 *   analytics → doc.analytics.visibleMetricKeys
 *             → doc.visibleMetricKeys        (pre-namespacing legacy)
 *             → catalog defaults
 *   tables    → doc.tables[level] → [] (opt-in)
 */
function normalizePreference(doc, userId) {
  const fallback = defaultPreference(userId || doc?.userId);
  if (!doc) return fallback;

  const analyticsKeys = Array.isArray(doc.analytics?.visibleMetricKeys)
    ? doc.analytics.visibleMetricKeys
    : Array.isArray(doc.visibleMetricKeys)
      ? doc.visibleMetricKeys
      : fallback.analytics.visibleMetricKeys;

  const tables = {};
  for (const level of TABLE_LEVELS) {
    tables[level] = Array.isArray(doc.tables?.[level])
      ? doc.tables[level]
      : [...DEFAULT_TABLE_METRIC_KEYS];
  }

  return {
    userId: doc.userId || userId,
    analytics: { visibleMetricKeys: analyticsKeys },
    tables,
    ...(doc.createdAt ? { createdAt: doc.createdAt } : {}),
    ...(doc.updatedAt ? { updatedAt: doc.updatedAt } : {}),
  };
}

/**
 * The selected metric keys for one surface.
 * @param {string} userId
 * @param {'analytics'|'campaign'|'adset'|'ad'} scope
 *
 * Swallows read errors and falls back to defaults on purpose: a Mongo blip
 * should degrade the dashboard to default metrics, not 500 the whole
 * Analytics tab.
 */
async function getVisibleMetricKeys(userId, scope = "analytics") {
  let doc = null;
  try {
    doc = await MetaAdsPreference.findOne({ userId })
      .select("analytics tables visibleMetricKeys userId")
      .lean();
  } catch (err) {
    // logger is required lazily to keep this module import-light for tests.
    try {
      require("../../utils/logger").warn(
        `getVisibleMetricKeys(${scope}) failed for ${userId}, using defaults: ${err.message}`,
      );
    } catch {
      /* logger unavailable (unit test context) — defaults are still correct */
    }
  }
  const pref = normalizePreference(doc, userId);
  return scope === "analytics"
    ? pref.analytics.visibleMetricKeys
    : pref.tables[scope] || [];
}

module.exports = MetaAdsPreference;
module.exports.TABLE_LEVELS = TABLE_LEVELS;
module.exports.DEFAULT_TABLE_METRIC_KEYS = DEFAULT_TABLE_METRIC_KEYS;
module.exports.defaultPreference = defaultPreference;
module.exports.normalizePreference = normalizePreference;
module.exports.getVisibleMetricKeys = getVisibleMetricKeys;
