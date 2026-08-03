/**
 * Metric values for the rows of the campaign / ad set / ad tables.
 *
 * ── Why this is a separate endpoint from the entity lists ────────────────
 * getCapaignsByAdAccount / getAdSetsByCampaignId / getAdsBy* are cached at
 * REDIS_TTL (2h) because entity lists are stable — names, budgets and
 * statuses change on user action, not continuously. Metrics are the
 * opposite: spend/impressions/actions drift minute to minute and live at
 * VOLATILE_TTL (5 min). Merging metrics into those list responses would drag
 * their cache from 2h to 5min — a 24x increase in Meta API calls on the
 * heaviest endpoints, for agencies with hundreds of campaigns.
 *
 * So: the list endpoints stay untouched and cheap, this returns just the
 * numbers keyed by entity id, and the frontend merges them per row.
 *
 * ── Why extraction happens here rather than in the browser ───────────────
 * The raw insights row is ~34 fields, of which 9 are action-list arrays that
 * can each carry dozens of {action_type, value} objects — megabytes at
 * level=ad, to render a handful of numbers. More importantly, extracting
 * client-side would mean a THIRD implementation of the MAX-across-action-
 * types dedup rule (config/metricsCatalog.js and services/metaAuditService.js
 * already implement it independently). That rule is exactly what
 * gotchas.md's first entry is about — the bug where an account showed
 * "1,262 App Installs" next to "₹0 Cost per App Install". One shared
 * implementation, server-side.
 */
const bizSdk = require("facebook-nodejs-business-sdk");
const AdAccount = bizSdk.AdAccount;
const { redisClient } = require("../../db/redis");
const {
  getFacebookIdFromRequest,
  metaCacheScope,
} = require("../../utils/metaConnection");
const { getMetricsCatalog } = require("../../config/metricsCatalog");
const {
  buildMetricsMap,
  ID_FIELD_BY_LEVEL,
} = require("../../utils/metaTableMetrics");
const {
  getVisibleMetricKeys,
  TABLE_LEVELS,
} = require("../../Module/metaAds/metaAdsPreference");
const { resolveDateRange } = require("../../utils/metaDateRange");
const {
  metricsFingerprint,
  dateRangeToken,
} = require("../../utils/metaCacheKeys");
const logger = require("../../utils/logger");

const v1 = require("./metaAdLauncher");
const { initApiForUser, fetchAllPaged, logMetaError } = v1;

// Metrics are volatile — same tier as every other metric-bearing response.
const VOLATILE_TTL = 300;

class MetaTableMetricsController {
  constructor() {
    this.getTableMetrics = this.getTableMetrics.bind(this);
  }

  /**
   * GET /meta-ads/table-metrics
   *   ?adAccountId= &level=campaign|adset|ad
   *   [&campaignId=] [&adsetId=]              scope filters
   *   [&datePreset= | &since=&until=]         window (defaults last_30d)
   *   [&refresh=true]                         bypass cache
   */
  async getTableMetrics(req, res) {
    /* #swagger.tags = ['Meta Ads Launcher']
       #swagger.description = 'Selected metric values for the rows of one entity table, keyed by entity id.'
    */
    try {
      const { adAccountId, level, campaignId, adsetId } = req.query;
      if (!adAccountId) {
        return res.status(400).json({ status: false, error: "adAccountId is required" });
      }
      if (!TABLE_LEVELS.includes(level)) {
        return res.status(400).json({
          status: false,
          error: `level must be one of: ${TABLE_LEVELS.join(", ")}`,
        });
      }

      const userId = req.user.user_id;
      const refresh = String(req.query.refresh || "").toLowerCase() === "true";

      let range;
      try {
        range = resolveDateRange(req.query);
      } catch (err) {
        if (err.statusCode === 400) {
          return res.status(400).json({ status: false, error: err.message });
        }
        throw err;
      }

      // Which metric columns this user picked for THIS level. Empty is the
      // default and a legitimate state — return immediately without touching
      // Meta or Redis, so a user who hasn't opted in costs nothing.
      const keys = await getVisibleMetricKeys(userId, level);
      if (!keys.length) {
        return res.status(200).json({ status: true, level, keys: [], metrics: {} });
      }
      const entries = getMetricsCatalog().filter((m) => keys.includes(m.key));

      // Cache key carries BOTH the metrics fingerprint and the date token —
      // the response's shape depends on the former and its values on the
      // latter. See utils/metaCacheKeys.js for what breaks without each.
      const cacheKey =
        `metaTableMetrics:${metaCacheScope(userId, getFacebookIdFromRequest(req))}` +
        `:${adAccountId}:${level}:${campaignId || "none"}:${adsetId || "none"}` +
        `:${dateRangeToken(range)}:${metricsFingerprint(keys)}`;

      if (!refresh) {
        const cached = await redisClient.get(cacheKey);
        if (cached) return res.status(200).json(JSON.parse(cached));
      }

      const { accessToken } = await initApiForUser(
        userId,
        getFacebookIdFromRequest(req),
      );
      const api = bizSdk.FacebookAdsApi.init(accessToken);
      bizSdk.FacebookAdsApi.setDefaultApi(api);
      const account = new AdAccount(`act_${adAccountId}`);

      // Only the fields the selected metrics actually read, plus the join
      // key. Derived from the catalog rather than getInsightsFields() so the
      // Meta-side payload shrinks with the selection.
      const fields = [
        ...new Set([ID_FIELD_BY_LEVEL[level], ...entries.map((e) => e.metaField)]),
      ];

      const filtering = [];
      if (campaignId) {
        filtering.push({ field: "campaign.id", operator: "EQUAL", value: campaignId });
      }
      if (adsetId) {
        filtering.push({ field: "adset.id", operator: "EQUAL", value: adsetId });
      }

      const rows = await fetchAllPaged(
        account.getInsights(fields, {
          level,
          ...range.current,
          // Without this, action-derived metrics silently under-report (often
          // to 0) versus what Ads Manager shows. See gotchas.md.
          use_unified_attribution_setting: true,
          // Meta's edges default to 25 rows; paginate or large accounts
          // silently lose everything past the first page.
          limit: 200,
          ...(filtering.length > 0 && { filtering }),
        }),
        `table metrics (${level})`,
      );

      const response = {
        status: true,
        level,
        keys,
        metrics: buildMetricsMap(rows, entries, level),
        dateRange:
          range.mode === "range"
            ? { since: range.since, until: range.until }
            : { datePreset: range.datePreset },
      };

      await redisClient.set(cacheKey, JSON.stringify(response), "EX", VOLATILE_TTL);
      return res.status(200).json(response);
    } catch (error) {
      const m = logMetaError("getTableMetrics error", error);
      return res.status(error.statusCode || 500).json({
        status: false,
        error: m.title || "Failed to load table metrics",
        details: m.message,
        meta: { code: m.code, subcode: m.subcode, fbtraceId: m.fbtraceId },
      });
    }
  }
}

module.exports = new MetaTableMetricsController();
