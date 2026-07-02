const axios = require("axios");
const crypto = require("crypto");
const TiktokUsers = require("../../Module/adPosting/tiktokUsers");
const logger = require("../../utils/logger");
const { redisClient } = require("../../db/redis");
const {
  getValidAccessToken,
  tiktokApiRequest,
  formatTiktokError,
  mapTiktokStatus,
  mapTiktokOperationStatus,
  invalidateAllUserTiktokCache,
  invalidateUserTiktokCache,
  REDIS_TTL,
  TIKTOK_API_BASE,
  getTiktokProxyAgent,
} = require("../../utils/tiktokHelpers");
const tiktokObjectivesConfig = require("../../config/tiktokObjectives");

// Reporting numbers move fast — cache them for a short window only.
const REPORT_TTL = 900; // 15 minutes

/**
 * Format a JS Date as TikTok's expected YYYY-MM-DD.
 */
function formatTiktokDate(d) {
  return d.toISOString().slice(0, 10);
}

/**
 * Build a TikTok `schedule_start_time` ("YYYY-MM-DD HH:MM:SS") a few minutes
 * from now. TikTok interprets this string in the ad ACCOUNT's timezone and
 * rejects a start time in the past, so we format the local wall-clock time of
 * the given IANA timezone (falling back to UTC when unknown).
 */
function tiktokScheduleStartNow(timezone, bufferMinutes = 5) {
  const d = new Date(Date.now() + bufferMinutes * 60 * 1000);
  if (!timezone) return d.toISOString().slice(0, 19).replace("T", " ");
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).formatToParts(d);
    const get = (t) => parts.find((p) => p.type === t)?.value;
    let hour = get("hour");
    if (hour === "24") hour = "00"; // some runtimes emit 24 for midnight
    return `${get("year")}-${get("month")}-${get("day")} ${hour}:${get("minute")}:${get("second")}`;
  } catch {
    return d.toISOString().slice(0, 19).replace("T", " ");
  }
}

/**
 * Resolve a reporting date range. Defaults to the last 7 days (inclusive)
 * when the caller doesn't pass explicit start/end dates.
 */
function resolveDateRange(startDate, endDate) {
  if (startDate && endDate) return { start: startDate, end: endDate };
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - 6);
  return { start: formatTiktokDate(start), end: formatTiktokDate(end) };
}

class TiktokAdController {
  constructor() {
    this.checkAccount = this.checkAccount.bind(this);
    this.getAdAccountsList = this.getAdAccountsList.bind(this);
    this.getCampaigns = this.getCampaigns.bind(this);
    this.getAdGroups = this.getAdGroups.bind(this);
    this.getAds = this.getAds.bind(this);
    // ─── Tier 1 (post-OAuth) ───
    this.getIdentities = this.getIdentities.bind(this);
    this.getRegions = this.getRegions.bind(this);
    this.getInsights = this.getInsights.bind(this);
    this.getDashboardData = this.getDashboardData.bind(this);
    this.updateStatus = this.updateStatus.bind(this);
    this.createCampaign = this.createCampaign.bind(this);
    this.createAdGroup = this.createAdGroup.bind(this);
    this.createAd = this.createAd.bind(this);
    this.uploadVideo = this.uploadVideo.bind(this);
    this.getWizardSchema = this.getWizardSchema.bind(this);
    // ─── Tier 2 ───
    this.updateCampaign = this.updateCampaign.bind(this);
    this.updateAdGroup = this.updateAdGroup.bind(this);
    this.updateAd = this.updateAd.bind(this);
    this.uploadImage = this.uploadImage.bind(this);
    this.getVideoInfo = this.getVideoInfo.bind(this);
    this.getInterestCategories = this.getInterestCategories.bind(this);
    this.getPixels = this.getPixels.bind(this);
    this.createPixel = this.createPixel.bind(this);
    this.getLeadForms = this.getLeadForms.bind(this);
    this.getLeads = this.getLeads.bind(this);
  }

  /**
   * Static wizard config — objectives (grouped by funnel), CTAs and budget
   * modes. No TikTok token needed; drives the create-campaign wizard dropdowns.
   */
  getWizardSchema(req, res) {
    try {
      return res.json({
        objectives: tiktokObjectivesConfig.TIKTOK_OBJECTIVES,
        objectivesByGroup: tiktokObjectivesConfig.getObjectivesByGroup(),
        funnelGroups: tiktokObjectivesConfig.FUNNEL_GROUPS,
        ctas: tiktokObjectivesConfig.TIKTOK_CTAS,
        budgetModes: tiktokObjectivesConfig.BUDGET_MODES,
      });
    } catch (error) {
      logger.error(`TikTok getWizardSchema error: ${error.message}`);
      return res
        .status(500)
        .json({ error: "Failed to load TikTok wizard schema" });
    }
  }

  /**
   * Check if the user has a connected TikTok account with accessible ad accounts.
   * Used by the frontend PlatformPicker to decide whether to show the dashboard.
   */
  async checkAccount(req, res) {
    try {
      const userId = req.user?.user_id;
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const user = await TiktokUsers.findOne({ userId, isActive: true }).select(
        "-accessToken -refreshToken"
      );

      if (!user) {
        return res.json({ isConnected: false, hasAccount: false });
      }

      const hasAccount = Array.isArray(user.advertiserIds) && user.advertiserIds.length > 0;

      return res.json({
        isConnected: true,
        hasAccount,
        advertiserIds: user.advertiserIds || [],
        advertiserInfo: user.advertiserInfo || [],
      });
    } catch (error) {
      logger.error(`TikTok checkAccount error: ${error.message}`);
      return res.status(500).json({ error: "Failed to check TikTok account" });
    }
  }

  /**
   * List connected TikTok ad accounts. Refreshes advertiser info from TikTok API.
   */
  async getAdAccountsList(req, res) {
    try {
      const userId = req.user?.user_id;
      const { refresh } = req.query;

      const cacheKey = `tiktokAdAccounts:${userId}`;
      if (refresh !== "true") {
        const cached = await redisClient.get(cacheKey);
        if (cached) return res.json(JSON.parse(cached));
      }

      const accessToken = await getValidAccessToken(userId);
      const user = await TiktokUsers.findOne({ userId, isActive: true });

      const data = await tiktokApiRequest({
        endpoint: "/advertiser/info/",
        accessToken,
        params: {
          advertiser_ids: JSON.stringify(user.advertiserIds || []),
        },
      });

      const accounts = data?.data?.list || [];
      const normalizedAccounts = accounts.map((acc) => ({
        id: String(acc.advertiser_id || acc.id || ""),
        name: acc.name || "Unnamed Account",
        currency: acc.currency || "USD",
        timezone: acc.timezone || "",
        status: mapTiktokStatus(acc.status) || acc.status,
        raw: acc,
      }));

      // Persist latest info
      user.advertiserInfo = normalizedAccounts.map((a) => ({
        advertiserId: a.id,
        name: a.name,
        currency: a.currency,
        timezone: a.timezone,
        status: a.status,
      }));
      await user.save();

      await redisClient.setex(
        cacheKey,
        REDIS_TTL,
        JSON.stringify({ accounts: normalizedAccounts })
      );

      return res.json({ accounts: normalizedAccounts });
    } catch (error) {
      logger.error(`TikTok getAdAccountsList error: ${error.message}`);
      return res.status(error.status || 500).json({
        error: error.userMessage || "Failed to fetch TikTok ad accounts",
        tiktokCode: error.tiktokCode,
      });
    }
  }

  /**
   * List campaigns for an advertiser account.
   */
  async getCampaigns(req, res) {
    try {
      const userId = req.user?.user_id;
      const { advertiserId, page = 1, pageSize = 100 } = req.query;

      if (!advertiserId) {
        return res.status(400).json({ error: "advertiserId is required" });
      }

      const cacheKey = `tiktokCampaigns:${userId}:${advertiserId}`;
      const cached = await redisClient.get(cacheKey);
      if (cached) return res.json(JSON.parse(cached));

      const accessToken = await getValidAccessToken(userId);
      const data = await tiktokApiRequest({
        endpoint: "/campaign/get/",
        accessToken,
        params: {
          advertiser_id: advertiserId,
          page,
          page_size: pageSize,
        },
      });

      const campaigns = (data?.data?.list || []).map((c) => ({
        id: String(c.campaign_id),
        name: c.campaign_name,
        status: mapTiktokStatus(c.operation_status || c.status),
        objective: c.objective_type,
        budget: c.budget,
        budgetMode: c.budget_mode,
        createTime: c.create_time,
        modifyTime: c.modify_time,
        raw: c,
      }));

      const result = {
        campaigns,
        pageInfo: data?.data?.page_info || {},
      };

      await redisClient.setex(cacheKey, REDIS_TTL, JSON.stringify(result));
      return res.json(result);
    } catch (error) {
      logger.error(`TikTok getCampaigns error: ${error.message}`);
      return res.status(error.status || 500).json({
        error: error.userMessage || "Failed to fetch TikTok campaigns",
        tiktokCode: error.tiktokCode,
      });
    }
  }

  /**
   * List ad groups for an advertiser account, optionally filtered by campaign.
   */
  async getAdGroups(req, res) {
    try {
      const userId = req.user?.user_id;
      const { advertiserId, campaignId, page = 1, pageSize = 100 } = req.query;

      if (!advertiserId) {
        return res.status(400).json({ error: "advertiserId is required" });
      }

      const cacheKey = `tiktokAdGroups:${userId}:${advertiserId}:${campaignId || "all"}`;
      const cached = await redisClient.get(cacheKey);
      if (cached) return res.json(JSON.parse(cached));

      const accessToken = await getValidAccessToken(userId);
      const params = {
        advertiser_id: advertiserId,
        page,
        page_size: pageSize,
      };

      if (campaignId) {
        params.filtering = JSON.stringify({
          campaign_ids: [campaignId],
        });
      }

      const data = await tiktokApiRequest({
        endpoint: "/adgroup/get/",
        accessToken,
        params,
      });

      const adGroups = (data?.data?.list || []).map((g) => ({
        id: String(g.adgroup_id),
        name: g.adgroup_name,
        campaignId: String(g.campaign_id),
        campaignName: g.campaign_name,
        status: mapTiktokStatus(g.operation_status || g.status),
        budget: g.budget,
        budgetMode: g.budget_mode,
        bid: g.bid,
        optimizationGoal: g.optimize_goal,
        createTime: g.create_time,
        modifyTime: g.modify_time,
        raw: g,
      }));

      const result = {
        adGroups,
        pageInfo: data?.data?.page_info || {},
      };

      await redisClient.setex(cacheKey, REDIS_TTL, JSON.stringify(result));
      return res.json(result);
    } catch (error) {
      logger.error(`TikTok getAdGroups error: ${error.message}`);
      return res.status(error.status || 500).json({
        error: error.userMessage || "Failed to fetch TikTok ad groups",
        tiktokCode: error.tiktokCode,
      });
    }
  }

  /**
   * List ads for an advertiser account, optionally filtered by ad group.
   */
  async getAds(req, res) {
    try {
      const userId = req.user?.user_id;
      const { advertiserId, adgroupId, page = 1, pageSize = 100 } = req.query;

      if (!advertiserId) {
        return res.status(400).json({ error: "advertiserId is required" });
      }

      const cacheKey = `tiktokAds:${userId}:${advertiserId}:${adgroupId || "all"}`;
      const cached = await redisClient.get(cacheKey);
      if (cached) return res.json(JSON.parse(cached));

      const accessToken = await getValidAccessToken(userId);
      const params = {
        advertiser_id: advertiserId,
        page,
        page_size: pageSize,
      };

      if (adgroupId) {
        params.filtering = JSON.stringify({
          adgroup_ids: [adgroupId],
        });
      }

      const data = await tiktokApiRequest({
        endpoint: "/ad/get/",
        accessToken,
        params,
      });

      const ads = (data?.data?.list || []).map((a) => ({
        id: String(a.ad_id),
        name: a.ad_name,
        adgroupId: String(a.adgroup_id),
        adgroupName: a.adgroup_name,
        campaignId: String(a.campaign_id),
        campaignName: a.campaign_name,
        status: mapTiktokStatus(a.operation_status || a.status),
        createTime: a.create_time,
        modifyTime: a.modify_time,
        raw: a,
      }));

      const result = {
        ads,
        pageInfo: data?.data?.page_info || {},
      };

      await redisClient.setex(cacheKey, REDIS_TTL, JSON.stringify(result));
      return res.json(result);
    } catch (error) {
      logger.error(`TikTok getAds error: ${error.message}`);
      return res.status(error.status || 500).json({
        error: error.userMessage || "Failed to fetch TikTok ads",
        tiktokCode: error.tiktokCode,
      });
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Tier 1 — wizard pickers (TikTok-specific, required before ad creation)
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * List the advertiser's Identities. An Identity is the TikTok account an ad
   * publishes as — TikTok REQUIRES one to create any ad (no Meta/Google
   * equivalent). Feeds the "post as" picker in the create-ad step.
   * TikTok API: GET /identity/get/
   */
  async getIdentities(req, res) {
    try {
      const userId = req.user?.user_id;
      const { advertiserId } = req.query;
      if (!advertiserId) {
        return res.status(400).json({ error: "advertiserId is required" });
      }

      const cacheKey = `tiktokIdentities:${userId}:${advertiserId}`;
      const cached = await redisClient.get(cacheKey);
      if (cached) return res.json(JSON.parse(cached));

      const accessToken = await getValidAccessToken(userId);
      const data = await tiktokApiRequest({
        endpoint: "/identity/get/",
        accessToken,
        params: { advertiser_id: advertiserId },
      });

      const identities = (data?.data?.identity_list || []).map((i) => ({
        identityId: i.identity_id,
        identityType: i.identity_type,
        displayName: i.display_name,
        profileImage: i.profile_image_url || i.profile_image || "",
        raw: i,
      }));

      const result = { identities };
      await redisClient.setex(cacheKey, REDIS_TTL, JSON.stringify(result));
      return res.json(result);
    } catch (error) {
      logger.error(`TikTok getIdentities error: ${error.message}`);
      return res.status(error.status || 500).json({
        error: error.userMessage || "Failed to fetch TikTok identities",
        tiktokCode: error.tiktokCode,
      });
    }
  }

  /**
   * List valid geo/location targeting IDs for the advertiser. TikTok requires
   * these IDs to build an ad group's `location_ids` — you can't hardcode them.
   * TikTok API: GET /tool/region/
   */
  async getRegions(req, res) {
    try {
      const userId = req.user?.user_id;
      const {
        advertiserId,
        placement = "PLACEMENT_TIKTOK",
        objectiveType = "TRAFFIC",
      } = req.query;
      if (!advertiserId) {
        return res.status(400).json({ error: "advertiserId is required" });
      }

      const cacheKey = `tiktokRegions:${userId}:${advertiserId}:${placement}:${objectiveType}`;
      const cached = await redisClient.get(cacheKey);
      if (cached) return res.json(JSON.parse(cached));

      const accessToken = await getValidAccessToken(userId);
      const data = await tiktokApiRequest({
        endpoint: "/tool/region/",
        accessToken,
        params: {
          advertiser_id: advertiserId,
          placements: JSON.stringify([placement]),
          objective_type: objectiveType,
        },
      });

      const regions = (data?.data?.region_info || data?.data?.list || []).map(
        (r) => ({
          id: String(r.region_id ?? r.location_id ?? r.id ?? ""),
          name: r.name,
          level: r.level,
          parentId: r.parent_id != null ? String(r.parent_id) : null,
          raw: r,
        })
      );

      const result = { regions };
      // Region lists are extremely stable — cache for the full TTL.
      await redisClient.setex(cacheKey, REDIS_TTL, JSON.stringify(result));
      return res.json(result);
    } catch (error) {
      logger.error(`TikTok getRegions error: ${error.message}`);
      return res.status(error.status || 500).json({
        error: error.userMessage || "Failed to fetch TikTok regions",
        tiktokCode: error.tiktokCode,
      });
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Tier 1 — reporting
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Per-entity performance rows for the chosen level (account/campaign/adgroup/ad)
   * over a date range. Drives drill-down performance views.
   * TikTok API: GET /report/integrated/get/
   */
  async getInsights(req, res) {
    try {
      const userId = req.user?.user_id;
      const {
        advertiserId,
        level = "campaign",
        startDate,
        endDate,
        lifetime,
        page = 1,
        pageSize = 100,
      } = req.query;
      if (!advertiserId) {
        return res.status(400).json({ error: "advertiserId is required" });
      }

      const isLifetime = lifetime === "true";
      const dataLevelMap = {
        account: "AUCTION_ADVERTISER",
        campaign: "AUCTION_CAMPAIGN",
        adgroup: "AUCTION_ADGROUP",
        ad: "AUCTION_AD",
      };
      const idDimensionMap = {
        account: "advertiser_id",
        campaign: "campaign_id",
        adgroup: "adgroup_id",
        ad: "ad_id",
      };
      const dataLevel = dataLevelMap[level] || "AUCTION_CAMPAIGN";
      const idDim = idDimensionMap[level] || "campaign_id";
      const { start, end } = isLifetime
        ? { start: null, end: null }
        : resolveDateRange(startDate, endDate);

      const cacheKey = `tiktokInsights:${userId}:${advertiserId}:${level}:${
        isLifetime ? "lifetime" : `${start}:${end}`
      }:${page}`;
      const cached = await redisClient.get(cacheKey);
      if (cached) return res.json(JSON.parse(cached));

      const accessToken = await getValidAccessToken(userId);
      const data = await tiktokApiRequest({
        endpoint: "/report/integrated/get/",
        accessToken,
        params: {
          advertiser_id: advertiserId,
          report_type: "BASIC",
          data_level: dataLevel,
          dimensions: JSON.stringify([idDim]),
          metrics: JSON.stringify([
            "spend",
            "impressions",
            "clicks",
            "ctr",
            "cpc",
            "cpm",
            "conversion",
            "cost_per_conversion",
          ]),
          ...(isLifetime
            ? { query_lifetime: true }
            : { start_date: start, end_date: end }),
          page,
          page_size: pageSize,
        },
      });

      const rows = (data?.data?.list || []).map((row) => ({
        id: String(row.dimensions?.[idDim] ?? ""),
        metrics: row.metrics || {},
        dimensions: row.dimensions || {},
      }));

      const result = {
        level,
        startDate: start,
        endDate: end,
        rows,
        pageInfo: data?.data?.page_info || {},
      };
      await redisClient.setex(cacheKey, REPORT_TTL, JSON.stringify(result));
      return res.json(result);
    } catch (error) {
      logger.error(`TikTok getInsights error: ${error.message}`);
      return res.status(error.status || 500).json({
        error: error.userMessage || "Failed to fetch TikTok insights",
        tiktokCode: error.tiktokCode,
      });
    }
  }

  /**
   * Account-level KPI totals + a daily series for the dashboard chart.
   * TikTok API: GET /report/integrated/get/ (segmented by stat_time_day)
   */
  async getDashboardData(req, res) {
    try {
      const userId = req.user?.user_id;
      const { advertiserId, startDate, endDate, lifetime } = req.query;
      if (!advertiserId) {
        return res.status(400).json({ error: "advertiserId is required" });
      }

      const isLifetime = lifetime === "true";
      const { start, end } = isLifetime
        ? { start: null, end: null }
        : resolveDateRange(startDate, endDate);
      const cacheKey = `tiktokDashboard:${userId}:${advertiserId}:${
        isLifetime ? "lifetime" : `${start}:${end}`
      }`;
      const cached = await redisClient.get(cacheKey);
      if (cached) return res.json(JSON.parse(cached));

      const accessToken = await getValidAccessToken(userId);
      const data = await tiktokApiRequest({
        endpoint: "/report/integrated/get/",
        accessToken,
        params: {
          advertiser_id: advertiserId,
          report_type: "BASIC",
          data_level: "AUCTION_ADVERTISER",
          dimensions: JSON.stringify(["stat_time_day"]),
          metrics: JSON.stringify([
            "spend",
            "impressions",
            "clicks",
            "conversion",
          ]),
          ...(isLifetime
            ? { query_lifetime: true }
            : { start_date: start, end_date: end }),
          page: 1,
          page_size: 1000,
        },
      });

      const chartData = (data?.data?.list || []).map((row) => ({
        date: row.dimensions?.stat_time_day,
        spend: Number(row.metrics?.spend || 0),
        impressions: Number(row.metrics?.impressions || 0),
        clicks: Number(row.metrics?.clicks || 0),
        conversions: Number(row.metrics?.conversion || 0),
      }));

      const totals = chartData.reduce(
        (acc, d) => {
          acc.spend += d.spend;
          acc.impressions += d.impressions;
          acc.clicks += d.clicks;
          acc.conversions += d.conversions;
          return acc;
        },
        { spend: 0, impressions: 0, clicks: 0, conversions: 0 }
      );

      const stats = {
        totalSpend: totals.spend,
        totalImpressions: totals.impressions,
        totalClicks: totals.clicks,
        totalConversions: totals.conversions,
        ctr: totals.impressions ? (totals.clicks / totals.impressions) * 100 : 0,
        cpc: totals.clicks ? totals.spend / totals.clicks : 0,
        cpm: totals.impressions ? (totals.spend / totals.impressions) * 1000 : 0,
        cpa: totals.conversions ? totals.spend / totals.conversions : 0,
      };

      const result = { stats, chartData, startDate: start, endDate: end };
      await redisClient.setex(cacheKey, REPORT_TTL, JSON.stringify(result));
      return res.json(result);
    } catch (error) {
      logger.error(`TikTok getDashboardData error: ${error.message}`);
      return res.status(error.status || 500).json({
        error: error.userMessage || "Failed to fetch TikTok dashboard data",
        tiktokCode: error.tiktokCode,
      });
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Tier 1 — mutations (each busts the user's status caches on success)
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Enable / pause / delete one or more campaigns, ad groups, or ads.
   * Body: { advertiserId, level: "campaign"|"adgroup"|"ad", ids: [], status: "ACTIVE"|"PAUSED"|"DELETED" }
   * TikTok API: POST /{level}/status/update/
   */
  async updateStatus(req, res) {
    try {
      const userId = req.user?.user_id;
      const { advertiserId, level, status } = req.body;
      const idList = Array.isArray(req.body.ids)
        ? req.body.ids
        : req.body.id
        ? [req.body.id]
        : [];

      if (!advertiserId) {
        return res.status(400).json({ error: "advertiserId is required" });
      }
      if (!idList.length) {
        return res.status(400).json({ error: "ids (or id) is required" });
      }
      if (!status) {
        return res.status(400).json({ error: "status is required" });
      }

      const endpointMap = {
        campaign: { endpoint: "/campaign/status/update/", idField: "campaign_ids" },
        adgroup: { endpoint: "/adgroup/status/update/", idField: "adgroup_ids" },
        ad: { endpoint: "/ad/status/update/", idField: "ad_ids" },
      };
      const cfg = endpointMap[level];
      if (!cfg) {
        return res
          .status(400)
          .json({ error: "level must be one of: campaign, adgroup, ad" });
      }

      const accessToken = await getValidAccessToken(userId);
      const data = await tiktokApiRequest({
        method: "POST",
        endpoint: cfg.endpoint,
        accessToken,
        data: {
          advertiser_id: advertiserId,
          [cfg.idField]: idList.map(String),
          operation_status: mapTiktokOperationStatus(status), // ACTIVE→ENABLE etc.
        },
      });

      await invalidateUserTiktokCache(userId).catch(() => {});
      return res.json({
        success: true,
        level,
        ids: idList,
        status,
        data: data?.data || {},
      });
    } catch (error) {
      logger.error(`TikTok updateStatus error: ${error.message}`);
      return res.status(error.status || 500).json({
        error: error.userMessage || "Failed to update TikTok status",
        tiktokCode: error.tiktokCode,
      });
    }
  }

  /**
   * Create a campaign.
   * Body: { advertiserId, campaignName, objectiveType, budgetMode?, budget?, payload? }
   * `payload` lets the wizard pass any extra raw TikTok fields verbatim.
   * TikTok API: POST /campaign/create/
   */
  async createCampaign(req, res) {
    try {
      const userId = req.user?.user_id;
      const {
        advertiserId,
        campaignName,
        objectiveType,
        budgetMode = "BUDGET_MODE_INFINITE",
        budget,
      } = req.body;

      if (!advertiserId) {
        return res.status(400).json({ error: "advertiserId is required" });
      }
      if (!campaignName) {
        return res.status(400).json({ error: "campaignName is required" });
      }
      if (!objectiveType) {
        return res.status(400).json({ error: "objectiveType is required" });
      }

      const payload = {
        advertiser_id: advertiserId,
        campaign_name: campaignName,
        objective_type: objectiveType,
        budget_mode: budgetMode,
        ...(budget != null && budgetMode !== "BUDGET_MODE_INFINITE"
          ? { budget: Number(budget) }
          : {}),
        ...(req.body.payload || {}),
      };

      const accessToken = await getValidAccessToken(userId);
      const data = await tiktokApiRequest({
        method: "POST",
        endpoint: "/campaign/create/",
        accessToken,
        data: payload,
      });

      await invalidateUserTiktokCache(userId).catch(() => {});
      return res.json({
        success: true,
        campaignId: data?.data?.campaign_id,
        data: data?.data || {},
      });
    } catch (error) {
      logger.error(`TikTok createCampaign error: ${error.message}`);
      return res.status(error.status || 500).json({
        error: error.userMessage || "Failed to create TikTok campaign",
        tiktokCode: error.tiktokCode,
      });
    }
  }

  /**
   * Create an ad group. Most fields (placement, targeting, budget, schedule,
   * optimization goal, bid, billing event) are passed through `payload` since
   * TikTok's ad-group shape is large and objective-dependent.
   * Body: { advertiserId, campaignId, adgroupName, payload }
   * TikTok API: POST /adgroup/create/
   */
  async createAdGroup(req, res) {
    try {
      const userId = req.user?.user_id;
      const { advertiserId, campaignId, adgroupName } = req.body;

      if (!advertiserId) {
        return res.status(400).json({ error: "advertiserId is required" });
      }
      if (!campaignId) {
        return res.status(400).json({ error: "campaignId is required" });
      }
      if (!adgroupName) {
        return res.status(400).json({ error: "adgroupName is required" });
      }

      const incoming = req.body.payload || {};

      // TikTok requires `schedule_start_time` ("YYYY-MM-DD HH:MM:SS") on every
      // ad group, even for SCHEDULE_FROM_NOW. If the caller didn't supply one,
      // default it to ~now in the ad account's timezone.
      let scheduleStart = incoming.schedule_start_time;
      if (!scheduleStart) {
        const acctUser = await TiktokUsers.findOne({ userId, isActive: true });
        const tz = acctUser?.advertiserInfo?.find(
          (a) => String(a.advertiserId) === String(advertiserId)
        )?.timezone;
        scheduleStart = tiktokScheduleStartNow(tz);
      }

      const payload = {
        advertiser_id: advertiserId,
        campaign_id: campaignId,
        adgroup_name: adgroupName,
        schedule_type: incoming.schedule_type || "SCHEDULE_FROM_NOW",
        ...incoming,
        schedule_start_time: scheduleStart,
      };

      const accessToken = await getValidAccessToken(userId);
      const data = await tiktokApiRequest({
        method: "POST",
        endpoint: "/adgroup/create/",
        accessToken,
        data: payload,
      });

      await invalidateUserTiktokCache(userId).catch(() => {});
      return res.json({
        success: true,
        adgroupId: data?.data?.adgroup_id,
        data: data?.data || {},
      });
    } catch (error) {
      logger.error(`TikTok createAdGroup error: ${error.message}`);
      return res.status(error.status || 500).json({
        error: error.userMessage || "Failed to create TikTok ad group",
        tiktokCode: error.tiktokCode,
      });
    }
  }

  /**
   * Create one or more ads under an ad group. `creatives` is an array of TikTok
   * creative objects (each needs identity_id, ad_format, video_id/image_ids,
   * ad_text, call_to_action, etc.).
   * Body: { advertiserId, adgroupId, creatives: [], payload? }
   * TikTok API: POST /ad/create/
   */
  async createAd(req, res) {
    try {
      const userId = req.user?.user_id;
      const { advertiserId, adgroupId, creatives } = req.body;

      if (!advertiserId) {
        return res.status(400).json({ error: "advertiserId is required" });
      }
      if (!adgroupId) {
        return res.status(400).json({ error: "adgroupId is required" });
      }
      if (!Array.isArray(creatives) || creatives.length === 0) {
        return res
          .status(400)
          .json({ error: "creatives (non-empty array) is required" });
      }

      const payload = {
        advertiser_id: advertiserId,
        adgroup_id: adgroupId,
        creatives,
        ...(req.body.payload || {}),
      };

      const accessToken = await getValidAccessToken(userId);
      const data = await tiktokApiRequest({
        method: "POST",
        endpoint: "/ad/create/",
        accessToken,
        data: payload,
      });

      await invalidateUserTiktokCache(userId).catch(() => {});
      return res.json({
        success: true,
        adIds: data?.data?.ad_ids || [],
        creatives: data?.data?.creatives || [],
        data: data?.data || {},
      });
    } catch (error) {
      logger.error(`TikTok createAd error: ${error.message}`);
      return res.status(error.status || 500).json({
        error: error.userMessage || "Failed to create TikTok ad",
        tiktokCode: error.tiktokCode,
      });
    }
  }

  /**
   * Upload a video creative. Supports either a multipart file (field "video")
   * or a remote URL (body.videoUrl). Returns the TikTok video_id used by
   * createAd. Multipart is sent with native FormData/Blob (Node 18+).
   * TikTok API: POST /file/video/ad/upload/
   */
  async uploadVideo(req, res) {
    try {
      const userId = req.user?.user_id;
      const { advertiserId, videoUrl } = req.body;
      if (!advertiserId) {
        return res.status(400).json({ error: "advertiserId is required" });
      }
      if (!req.file && !videoUrl) {
        return res
          .status(400)
          .json({ error: "Provide a video file (field 'video') or videoUrl" });
      }

      const accessToken = await getValidAccessToken(userId);
      const form = new FormData();
      form.append("advertiser_id", String(advertiserId));

      if (req.file) {
        // TikTok requires an MD5 signature of the file bytes for file uploads.
        const signature = crypto
          .createHash("md5")
          .update(req.file.buffer)
          .digest("hex");
        const blob = new Blob([req.file.buffer], {
          type: req.file.mimetype || "video/mp4",
        });
        form.append("upload_type", "UPLOAD_BY_FILE");
        form.append("video_signature", signature);
        form.append(
          "video_file",
          blob,
          req.file.originalname || "video.mp4"
        );
      } else {
        form.append("upload_type", "UPLOAD_BY_URL");
        form.append("video_url", videoUrl);
      }

      // Direct axios call (not tiktokApiRequest) so axios sets the multipart
      // boundary header itself; only the Access-Token header is forced.
      const agent = getTiktokProxyAgent();
      const response = await axios.post(
        `${TIKTOK_API_BASE}/file/video/ad/upload/`,
        form,
        {
          headers: { "Access-Token": accessToken },
          ...(agent ? { httpsAgent: agent, proxy: false } : {}),
        }
      );

      const body = response.data || {};
      if (body.code && body.code !== 0) {
        // TikTok returns a non-zero code in the body on logical failures.
        throw formatTiktokError({
          response: { status: 200, data: body },
        });
      }

      const list = body?.data || [];
      const videos = (Array.isArray(list) ? list : [list]).map((v) => ({
        videoId: v.video_id,
        coverUrl: v.video_cover_url || "",
        url: v.url || "",
        width: v.width,
        height: v.height,
        duration: v.duration,
        raw: v,
      }));

      await invalidateUserTiktokCache(userId).catch(() => {});
      return res.json({ success: true, videos });
    } catch (error) {
      logger.error(`TikTok uploadVideo error: ${error.message}`);
      return res.status(error.status || 500).json({
        error: error.userMessage || "Failed to upload TikTok video",
        tiktokCode: error.tiktokCode,
      });
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Tier 2 — edits, image upload, video status, interest targeting
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Update a campaign (name / budget / budget mode). Extra raw TikTok fields
   * can be passed via `payload`.
   * TikTok API: POST /campaign/update/
   */
  async updateCampaign(req, res) {
    try {
      const userId = req.user?.user_id;
      const { advertiserId, campaignId, campaignName, budget, budgetMode } = req.body;
      if (!advertiserId) {
        return res.status(400).json({ error: "advertiserId is required" });
      }
      if (!campaignId) {
        return res.status(400).json({ error: "campaignId is required" });
      }

      const payload = {
        advertiser_id: advertiserId,
        campaign_id: campaignId,
        ...(campaignName ? { campaign_name: campaignName } : {}),
        ...(budget != null ? { budget: Number(budget) } : {}),
        ...(budgetMode ? { budget_mode: budgetMode } : {}),
        ...(req.body.payload || {}),
      };

      const accessToken = await getValidAccessToken(userId);
      const data = await tiktokApiRequest({
        method: "POST",
        endpoint: "/campaign/update/",
        accessToken,
        data: payload,
      });

      await invalidateUserTiktokCache(userId).catch(() => {});
      return res.json({
        success: true,
        campaignId: data?.data?.campaign_id || campaignId,
        data: data?.data || {},
      });
    } catch (error) {
      logger.error(`TikTok updateCampaign error: ${error.message}`);
      return res.status(error.status || 500).json({
        error: error.userMessage || "Failed to update TikTok campaign",
        tiktokCode: error.tiktokCode,
      });
    }
  }

  /**
   * Update an ad group (name / budget / budget mode, or any field via `payload`).
   * TikTok API: POST /adgroup/update/
   */
  async updateAdGroup(req, res) {
    try {
      const userId = req.user?.user_id;
      const { advertiserId, adgroupId, adgroupName, budget, budgetMode } = req.body;
      if (!advertiserId) {
        return res.status(400).json({ error: "advertiserId is required" });
      }
      if (!adgroupId) {
        return res.status(400).json({ error: "adgroupId is required" });
      }

      const payload = {
        advertiser_id: advertiserId,
        adgroup_id: adgroupId,
        ...(adgroupName ? { adgroup_name: adgroupName } : {}),
        ...(budget != null ? { budget: Number(budget) } : {}),
        ...(budgetMode ? { budget_mode: budgetMode } : {}),
        ...(req.body.payload || {}),
      };

      const accessToken = await getValidAccessToken(userId);
      const data = await tiktokApiRequest({
        method: "POST",
        endpoint: "/adgroup/update/",
        accessToken,
        data: payload,
      });

      await invalidateUserTiktokCache(userId).catch(() => {});
      return res.json({
        success: true,
        adgroupId: data?.data?.adgroup_id || adgroupId,
        data: data?.data || {},
      });
    } catch (error) {
      logger.error(`TikTok updateAdGroup error: ${error.message}`);
      return res.status(error.status || 500).json({
        error: error.userMessage || "Failed to update TikTok ad group",
        tiktokCode: error.tiktokCode,
      });
    }
  }

  /**
   * Update an ad. TikTok updates ads via the `creatives` array (each entry
   * carries the ad_id + fields to change). Extra fields can go in `payload`.
   * Body: { advertiserId, adgroupId?, creatives: [{ ad_id, ... }], payload? }
   * TikTok API: POST /ad/update/
   */
  async updateAd(req, res) {
    try {
      const userId = req.user?.user_id;
      const { advertiserId, adgroupId, creatives } = req.body;
      if (!advertiserId) {
        return res.status(400).json({ error: "advertiserId is required" });
      }
      if (!Array.isArray(creatives) && !req.body.payload) {
        return res
          .status(400)
          .json({ error: "creatives (array) or payload is required" });
      }

      const payload = {
        advertiser_id: advertiserId,
        ...(adgroupId ? { adgroup_id: adgroupId } : {}),
        ...(Array.isArray(creatives) ? { creatives } : {}),
        ...(req.body.payload || {}),
      };

      const accessToken = await getValidAccessToken(userId);
      const data = await tiktokApiRequest({
        method: "POST",
        endpoint: "/ad/update/",
        accessToken,
        data: payload,
      });

      await invalidateUserTiktokCache(userId).catch(() => {});
      return res.json({ success: true, data: data?.data || {} });
    } catch (error) {
      logger.error(`TikTok updateAd error: ${error.message}`);
      return res.status(error.status || 500).json({
        error: error.userMessage || "Failed to update TikTok ad",
        tiktokCode: error.tiktokCode,
      });
    }
  }

  /**
   * Upload an image creative (cover / carousel). Supports a multipart file
   * (field "image") or a remote URL (body.imageUrl). Returns image_id(s).
   * TikTok API: POST /file/image/ad/upload/
   */
  async uploadImage(req, res) {
    try {
      const userId = req.user?.user_id;
      const { advertiserId, imageUrl } = req.body;
      if (!advertiserId) {
        return res.status(400).json({ error: "advertiserId is required" });
      }
      if (!req.file && !imageUrl) {
        return res
          .status(400)
          .json({ error: "Provide an image file (field 'image') or imageUrl" });
      }

      const accessToken = await getValidAccessToken(userId);
      const form = new FormData();
      form.append("advertiser_id", String(advertiserId));

      if (req.file) {
        const signature = crypto
          .createHash("md5")
          .update(req.file.buffer)
          .digest("hex");
        const blob = new Blob([req.file.buffer], {
          type: req.file.mimetype || "image/jpeg",
        });
        form.append("upload_type", "UPLOAD_BY_FILE");
        form.append("image_signature", signature);
        form.append("image_file", blob, req.file.originalname || "image.jpg");
      } else {
        form.append("upload_type", "UPLOAD_BY_URL");
        form.append("image_url", imageUrl);
      }

      const agent2 = getTiktokProxyAgent();
      const response = await axios.post(
        `${TIKTOK_API_BASE}/file/image/ad/upload/`,
        form,
        {
          headers: { "Access-Token": accessToken },
          ...(agent2 ? { httpsAgent: agent2, proxy: false } : {}),
        }
      );

      const body = response.data || {};
      if (body.code && body.code !== 0) {
        throw formatTiktokError({ response: { status: 200, data: body } });
      }

      const list = body?.data || [];
      const images = (Array.isArray(list) ? list : [list]).map((i) => ({
        imageId: i.image_id,
        url: i.image_url || "",
        width: i.width,
        height: i.height,
        raw: i,
      }));

      await invalidateUserTiktokCache(userId).catch(() => {});
      return res.json({ success: true, images });
    } catch (error) {
      logger.error(`TikTok uploadImage error: ${error.message}`);
      return res.status(error.status || 500).json({
        error: error.userMessage || "Failed to upload TikTok image",
        tiktokCode: error.tiktokCode,
      });
    }
  }

  /**
   * Get info/status for one or more uploaded videos (used to poll until a
   * video is "ready" before attaching it to an ad). Not cached — status moves.
   * Query: advertiserId, videoIds (comma-separated or array)
   * TikTok API: GET /file/video/ad/info/
   */
  async getVideoInfo(req, res) {
    try {
      const userId = req.user?.user_id;
      const { advertiserId, videoIds } = req.query;
      if (!advertiserId) {
        return res.status(400).json({ error: "advertiserId is required" });
      }
      const ids = Array.isArray(videoIds)
        ? videoIds
        : String(videoIds || "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
      if (!ids.length) {
        return res.status(400).json({ error: "videoIds is required" });
      }

      const accessToken = await getValidAccessToken(userId);
      const data = await tiktokApiRequest({
        endpoint: "/file/video/ad/info/",
        accessToken,
        params: {
          advertiser_id: advertiserId,
          video_ids: JSON.stringify(ids),
        },
      });

      const videos = (data?.data?.list || []).map((v) => ({
        videoId: v.video_id,
        materialId: v.material_id,
        width: v.width,
        height: v.height,
        duration: v.duration,
        coverUrl: v.video_cover_url || "",
        url: v.url || "",
        format: v.format,
        allowedPlacements: v.allowed_placements,
        raw: v,
      }));

      return res.json({ videos });
    } catch (error) {
      logger.error(`TikTok getVideoInfo error: ${error.message}`);
      return res.status(error.status || 500).json({
        error: error.userMessage || "Failed to fetch TikTok video info",
        tiktokCode: error.tiktokCode,
      });
    }
  }

  /**
   * List interest-category targeting options for the ad-group targeting step.
   * TikTok API: GET /tool/interest_category/
   */
  async getInterestCategories(req, res) {
    try {
      const userId = req.user?.user_id;
      const {
        advertiserId,
        placement = "PLACEMENT_TIKTOK",
        objectiveType = "TRAFFIC",
      } = req.query;
      if (!advertiserId) {
        return res.status(400).json({ error: "advertiserId is required" });
      }

      const cacheKey = `tiktokInterests:v2:${userId}:${advertiserId}:${placement}:${objectiveType}`;
      const cached = await redisClient.get(cacheKey);
      if (cached) return res.json(JSON.parse(cached));

      const accessToken = await getValidAccessToken(userId);
      const data = await tiktokApiRequest({
        endpoint: "/tool/interest_category/",
        accessToken,
        params: {
          advertiser_id: advertiserId,
          placements: JSON.stringify([placement]),
          objective_type: objectiveType,
        },
      });

      const categories = (
        data?.data?.interest_categories ||
        data?.data?.list ||
        []
      ).map((c) => ({
        id: String(c.interest_category_id ?? c.id ?? ""),
        name: c.interest_category_name || c.name,
        level: c.level,
        parentId: c.parent_id != null ? String(c.parent_id) : null,
        raw: c,
      }));

      const result = { categories };
      // Stable list — cache for the full TTL.
      await redisClient.setex(cacheKey, REDIS_TTL, JSON.stringify(result));
      return res.json(result);
    } catch (error) {
      logger.error(`TikTok getInterestCategories error: ${error.message}`);
      return res.status(error.status || 500).json({
        error: error.userMessage || "Failed to fetch TikTok interest categories",
        tiktokCode: error.tiktokCode,
      });
    }
  }

  /**
   * List TikTok pixels for an ad account.
   * TikTok API: GET /pixel/list/
   */
  async getPixels(req, res) {
    try {
      const userId = req.user?.user_id;
      const { advertiserId } = req.query;
      if (!advertiserId) {
        return res.status(400).json({ error: "advertiserId is required" });
      }

      const accessToken = await getValidAccessToken(userId);
      const data = await tiktokApiRequest({
        method: "GET",
        endpoint: "/pixel/list/",
        accessToken,
        params: { advertiser_id: advertiserId },
      });

      const pixels = (data?.data?.pixels || data?.data?.list || []).map((p) => ({
        id: String(p.pixel_id || p.id || ""),
        name: p.name || p.pixel_name || String(p.pixel_id || p.id),
        status: p.status || p.pixel_status,
        raw: p,
      }));

      return res.json({ status: true, pixels });
    } catch (error) {
      logger.error(`TikTok getPixels error: ${error.message}`);
      return res.status(error.status || 500).json({
        error: error.userMessage || "Failed to fetch TikTok pixels",
        tiktokCode: error.tiktokCode,
      });
    }
  }

  /**
   * Create a TikTok pixel for an ad account.
   * TikTok API: POST /pixel/create/
   */
  async createPixel(req, res) {
    try {
      const userId = req.user?.user_id;
      const { advertiserId, name, pixelType = "TT_WEB_PIXEL" } = req.body;
      if (!advertiserId) {
        return res.status(400).json({ error: "advertiserId is required" });
      }
      if (!name || !name.trim()) {
        return res.status(400).json({ error: "name is required" });
      }

      const accessToken = await getValidAccessToken(userId);
      const data = await tiktokApiRequest({
        method: "POST",
        endpoint: "/pixel/create/",
        accessToken,
        data: {
          advertiser_id: advertiserId,
          pixel_name: name.trim(),
          pixel_type: pixelType,
        },
      });

      const p = data?.data || {};
      return res.status(201).json({
        status: true,
        pixel: {
          id: String(p.pixel_id || p.id || ""),
          name: p.pixel_name || p.name || name.trim(),
          status: p.status || p.pixel_status,
          raw: p,
        },
      });
    } catch (error) {
      logger.error(`TikTok createPixel error: ${error.message}`);
      return res.status(error.status || 500).json({
        error: error.userMessage || "Failed to create TikTok pixel",
        tiktokCode: error.tiktokCode,
      });
    }
  }

  /**
   * List TikTok Instant Forms (lead generation forms) for an ad account.
   *
   * The Lead Forms API is not part of the public Marketing API SDK, so we call
   * the community-documented /lead/form/list/ endpoint. If TikTok returns a 404
   * we surface that clearly so the caller can fall back to entering a Page ID
   * manually.
   */
  async getLeadForms(req, res) {
    try {
      const userId = req.user?.user_id;
      const { advertiserId, pageId } = req.query;
      if (!advertiserId) {
        return res.status(400).json({ error: "advertiserId is required" });
      }

      const accessToken = await getValidAccessToken(userId);
      const params = { advertiser_id: advertiserId };
      if (pageId) params.page_id = pageId;

      const data = await tiktokApiRequest({
        method: "GET",
        endpoint: "/lead/form/list/",
        accessToken,
        params,
      });

      const forms = (data?.data?.list || data?.data?.forms || []).map((f) => ({
        id: String(f.page_id || f.form_id || f.id || ""),
        pageId: String(f.page_id || f.form_id || f.id || ""),
        name: f.page_name || f.form_name || f.name || `Form ${f.page_id || f.id}`,
        status: f.status || f.form_status,
        raw: f,
      }));

      return res.json({ status: true, forms });
    } catch (error) {
      logger.error(
        `TikTok getLeadForms error: ${error.message} | status=${error.status} | tiktokCode=${error.tiktokCode} | raw=${JSON.stringify(
          error.raw
        )}`
      );

      // The Lead Form list endpoint is private/allowlist-only. If TikTok does
      // not expose it for this app, return an empty list so the wizard falls
      // back to the manual Page ID input instead of surfacing a 404.
      if (error.status === 404) {
        return res.json({
          status: true,
          forms: [],
          available: false,
          message:
            "Lead Form list endpoint is not available for this TikTok app or account. Use the manual Page ID fallback.",
        });
      }

      return res.status(error.status || 500).json({
        error:
          error.userMessage ||
          "Failed to fetch TikTok lead forms. If this endpoint does not exist for your app, enter the Page ID manually.",
        tiktokCode: error.tiktokCode,
        raw: error.raw,
      });
    }
  }

  /**
   * Retrieve lead submissions for a TikTok Instant Form.
   * TikTok API: GET /lead/get/
   */
  async getLeads(req, res) {
    try {
      const userId = req.user?.user_id;
      const {
        advertiserId,
        pageId,
        leadSource = "INSTANT_FORM",
        startTime,
        endTime,
        page = 1,
        pageSize = 100,
      } = req.query;

      if (!advertiserId) {
        return res.status(400).json({ error: "advertiserId is required" });
      }
      if (!pageId) {
        return res.status(400).json({ error: "pageId is required" });
      }

      const accessToken = await getValidAccessToken(userId);
      const params = {
        advertiser_id: advertiserId,
        lead_source: leadSource,
        page_id: pageId,
        page,
        page_size: pageSize,
      };
      if (startTime) params.start_time = startTime;
      if (endTime) params.end_time = endTime;

      const data = await tiktokApiRequest({
        method: "GET",
        endpoint: "/lead/get/",
        accessToken,
        params,
      });

      const leads = data?.data?.lead_list || data?.data?.leads || [];
      return res.json({
        status: true,
        leads,
        pageInfo: data?.data?.page_info || {},
      });
    } catch (error) {
      logger.error(`TikTok getLeads error: ${error.message}`);
      return res.status(error.status || 500).json({
        error: error.userMessage || "Failed to fetch TikTok leads",
        tiktokCode: error.tiktokCode,
      });
    }
  }
}

module.exports = new TiktokAdController();
