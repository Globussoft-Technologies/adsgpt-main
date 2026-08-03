/**
 * Per-user Meta Ads UI preferences — the metric catalog plus which metrics a
 * user has selected for each surface (Analytics KPI cards, and metric columns
 * on the campaign / ad set / ad tables).
 *
 * Kept as its own small controller rather than added to the ~1900-line
 * metaAdLauncher.js. Mounted under /meta-ads, which already applies
 * authenticateJWT once at the router mount — no per-route auth needed.
 */
const MetaAdsPreference = require("../../Module/metaAds/metaAdsPreference");
const {
  TABLE_LEVELS,
  normalizePreference,
} = MetaAdsPreference;
const { getMetricsCatalog } = require("../../config/metricsCatalog");
const {
  updatePreferenceSchema,
} = require("../../Validations/metaAdsPreference.validator");
const logger = require("../../utils/logger");

class MetaAdsPreferenceController {
  constructor() {
    this.getCatalog = this.getCatalog.bind(this);
    this.getPreference = this.getPreference.bind(this);
    this.updatePreference = this.updatePreference.bind(this);
    this.getLegacyPreference = this.getLegacyPreference.bind(this);
    this.updateLegacyPreference = this.updateLegacyPreference.bind(this);
  }

  /**
   * GET /meta-ads/analytics/metrics-catalog
   *
   * Static, code-committed catalog — no DB/Meta call, no caching needed. The
   * frontend fetches it once per session so it doesn't hardcode the
   * selectable-metrics list a second time. Level-agnostic: the same catalog
   * drives the KPI cards and every table's column picker.
   */
  async getCatalog(req, res) {
    /* #swagger.tags = ['Meta Ads Launcher']
       #swagger.description = 'Full catalog of selectable Meta Ads metrics.'
    */
    try {
      return res.status(200).json({ status: true, catalog: getMetricsCatalog() });
    } catch (err) {
      logger.error(`metaAdsPreference getCatalog error: ${err.message}`);
      return res.status(500).json({ status: false, error: "Failed to load metrics catalog" });
    }
  }

  /**
   * GET /meta-ads/preferences
   *
   * Returns the full normalized shape. No row is created on read; a user with
   * nothing saved gets catalog defaults for Analytics and empty table columns.
   */
  async getPreference(req, res) {
    /* #swagger.tags = ['Meta Ads Launcher']
       #swagger.description = "Read the current user's Meta Ads UI preferences."
    */
    try {
      const userId = req.user.user_id;
      const doc = await MetaAdsPreference.findOne({ userId }).lean();
      return res
        .status(200)
        .json({ status: true, preference: normalizePreference(doc, userId) });
    } catch (err) {
      logger.error(`metaAdsPreference getPreference error: ${err.message}`);
      return res.status(500).json({ status: false, error: "Failed to read preferences" });
    }
  }

  /**
   * PATCH /meta-ads/preferences
   * Body: { analytics?: { visibleMetricKeys }, tables?: { campaign?, adset?, ad? } }
   *
   * Merge-update: only the namespaces present in the body are touched.
   */
  async updatePreference(req, res) {
    /* #swagger.tags = ['Meta Ads Launcher']
       #swagger.description = "Update the current user's Meta Ads UI preferences."
    */
    const { error, value } = updatePreferenceSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ status: false, error: error.details[0].message });
    }
    try {
      const userId = req.user.user_id;

      // Dotted-path $set, NOT a whole-document replace. There are four
      // independently auto-saving pickers (Analytics + one per table level);
      // a read-modify-write would let a save that started before another
      // one finished clobber the other namespace. Dotted paths make each
      // namespace's write independent. Do not "simplify" this to $set: value.
      const set = {};
      if (value.analytics?.visibleMetricKeys) {
        set["analytics.visibleMetricKeys"] = value.analytics.visibleMetricKeys;
      }
      for (const level of TABLE_LEVELS) {
        if (value.tables?.[level]) set[`tables.${level}`] = value.tables[level];
      }

      const doc = await MetaAdsPreference.findOneAndUpdate(
        { userId },
        {
          $set: set,
          $setOnInsert: { userId },
          // Lazy per-user shape migration: drop the pre-namespacing field the
          // first time this user saves anything under the new shape.
          $unset: { visibleMetricKeys: 1 },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      ).lean();

      return res
        .status(200)
        .json({ status: true, preference: normalizePreference(doc, userId) });
    } catch (err) {
      logger.error(`metaAdsPreference updatePreference error: ${err.message}`);
      return res.status(500).json({ status: false, error: "Failed to save preferences" });
    }
  }

  // ─── Deprecated aliases ────────────────────────────────────────────────
  // GET|PATCH /meta-ads/analytics/metrics-preference spoke the pre-namespacing
  // `{ visibleMetricKeys }` shape. Kept for one release so a browser holding a
  // cached frontend bundle through a deploy doesn't 404 into a defaults-only
  // dashboard. Delete both once clients have rolled over.

  async getLegacyPreference(req, res) {
    try {
      const userId = req.user.user_id;
      const doc = await MetaAdsPreference.findOne({ userId }).lean();
      const pref = normalizePreference(doc, userId);
      return res.status(200).json({
        status: true,
        preference: {
          userId: pref.userId,
          visibleMetricKeys: pref.analytics.visibleMetricKeys,
        },
      });
    } catch (err) {
      logger.error(`metaAdsPreference getLegacyPreference error: ${err.message}`);
      return res.status(500).json({ status: false, error: "Failed to read metrics preference" });
    }
  }

  async updateLegacyPreference(req, res) {
    // Adapt the flat legacy body into the namespaced shape, then reuse the
    // canonical handler so validation/persistence live in exactly one place.
    req.body = { analytics: { visibleMetricKeys: req.body?.visibleMetricKeys } };
    return this.updatePreference(req, res);
  }
}

module.exports = new MetaAdsPreferenceController();
