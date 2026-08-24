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
    this.getAdGroupReviewInfo = this.getAdGroupReviewInfo.bind(this);
    this.getAdReviewInfo = this.getAdReviewInfo.bind(this);
    this.appealAdGroup = this.appealAdGroup.bind(this);
    this.getMusicList = this.getMusicList.bind(this);
    this.uploadMusic = this.uploadMusic.bind(this);
    this.deriveVideoCoverImageId = this.deriveVideoCoverImageId.bind(this);
    this.attachAdThumbnails = this.attachAdThumbnails.bind(this);
  }

  /**
   * Static wizard config — objectives (grouped by funnel), CTAs and budget
   * modes. No TikTok token needed; drives the create-campaign wizard dropdowns.
   */
  getWizardSchema(req, res) {
    /* #swagger.tags = ['TikTok Ads']
       #swagger.summary = 'Get create-campaign wizard schema'
       #swagger.description = 'Static config that drives the TikTok create-campaign wizard dropdowns — objectives grouped by funnel stage, funnel group labels, call-to-action values, and budget modes. No TikTok token required.'
       #swagger.security = [{ "BearerAuth": [] }]
       #swagger.responses[200] = {
         description: "Wizard schema",
         schema: {
           objectives: [{ key: "TRAFFIC", label: "Traffic", group: "Consideration", objectiveType: "TRAFFIC", optimizationGoals: ["CLICK"], billingEvents: ["CPC", "CPM"], requiresCta: true, defaultBudgetMode: "BUDGET_MODE_DAY" }],
           objectivesByGroup: { Awareness: [], Consideration: [], Conversion: [] },
           funnelGroups: { AWARENESS: "Awareness", CONSIDERATION: "Consideration", CONVERSION: "Conversion" },
           ctas: ["LEARN_MORE", "SHOP_NOW", "SIGN_UP", "DOWNLOAD_NOW"],
           budgetModes: { DAILY: "BUDGET_MODE_DAY", LIFETIME: "BUDGET_MODE_TOTAL", INFINITE: "BUDGET_MODE_INFINITE" }
         }
       }
       #swagger.responses[500] = { description: "Failed to load TikTok wizard schema" }
    */
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
    /* #swagger.tags = ['TikTok Ads']
       #swagger.summary = 'Check TikTok connection status'
       #swagger.description = 'Checks whether the authenticated user has a connected, active TikTok account with at least one accessible advertiser (ad) account. Used by the frontend PlatformPicker/dashboard gate before allowing any other TikTok call.'
       #swagger.security = [{ "BearerAuth": [] }]
       #swagger.responses[200] = {
         description: "Connection status",
         schema: {
           isConnected: true,
           hasAccount: true,
           advertiserIds: ["7012345678901234567"],
           advertiserInfo: [{ advertiserId: "7012345678901234567", name: "My Brand Ads", currency: "USD", timezone: "America/Los_Angeles", status: "STATUS_ENABLE" }]
         }
       }
       #swagger.responses[401] = { description: "Unauthorized" }
       #swagger.responses[500] = { description: "Failed to check TikTok account" }
    */
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
    /* #swagger.tags = ['TikTok Ads']
       #swagger.summary = 'List TikTok ad accounts'
       #swagger.description = 'Lists the advertiser (ad) accounts connected during OAuth, refreshed from TikTok. Proxies TikTok Marketing API GET /advertiser/info/. Cached for REDIS_TTL (2h) unless refresh=true is passed.'
       #swagger.security = [{ "BearerAuth": [] }]
       #swagger.parameters['refresh'] = { in: 'query', description: 'Pass true to bypass the cache and refetch from TikTok', type: 'string', example: 'true' }
       #swagger.responses[200] = {
         description: "Ad accounts",
         schema: {
           accounts: [{ id: "7012345678901234567", name: "My Brand Ads", currency: "USD", timezone: "America/Los_Angeles", status: "ACTIVE" }]
         }
       }
       #swagger.responses[401] = { description: "Unauthorized / TikTok token expired" }
       #swagger.responses[500] = { description: "Failed to fetch TikTok ad accounts" }
    */
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
    /* #swagger.tags = ['TikTok Ads']
       #swagger.summary = 'List campaigns'
       #swagger.description = 'Lists campaigns for an advertiser account. Proxies TikTok Marketing API GET /campaign/get/. Cached for REDIS_TTL (2h) per advertiser.'
       #swagger.security = [{ "BearerAuth": [] }]
       #swagger.parameters['advertiserId'] = { in: 'query', required: true, description: 'TikTok advertiser (ad account) ID', type: 'string', example: '7012345678901234567' }
       #swagger.parameters['page'] = { in: 'query', description: 'Page number', type: 'integer', example: 1 }
       #swagger.parameters['pageSize'] = { in: 'query', description: 'Page size', type: 'integer', example: 100 }
       #swagger.responses[200] = {
         description: "Campaigns",
         schema: {
           campaigns: [{ id: "1789012345678901", name: "Summer Sale", status: "ACTIVE", objective: "TRAFFIC", budget: 100, budgetMode: "BUDGET_MODE_DAY", createTime: "2026-06-01 10:00:00", modifyTime: "2026-06-02 09:00:00" }],
           pageInfo: { page: 1, page_size: 100, total_number: 1, total_page: 1 }
         }
       }
       #swagger.responses[400] = { description: "advertiserId is required" }
       #swagger.responses[500] = { description: "Failed to fetch TikTok campaigns" }
    */
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
    /* #swagger.tags = ['TikTok Ads']
       #swagger.summary = 'List ad groups'
       #swagger.description = 'Lists ad groups for an advertiser account, optionally filtered by campaign. Proxies TikTok Marketing API GET /adgroup/get/. Cached for REDIS_TTL (2h).'
       #swagger.security = [{ "BearerAuth": [] }]
       #swagger.parameters['advertiserId'] = { in: 'query', required: true, description: 'TikTok advertiser (ad account) ID', type: 'string', example: '7012345678901234567' }
       #swagger.parameters['campaignId'] = { in: 'query', description: 'Filter to ad groups under this campaign', type: 'string', example: '1789012345678901' }
       #swagger.parameters['page'] = { in: 'query', description: 'Page number', type: 'integer', example: 1 }
       #swagger.parameters['pageSize'] = { in: 'query', description: 'Page size', type: 'integer', example: 100 }
       #swagger.responses[200] = {
         description: "Ad groups",
         schema: {
           adGroups: [{ id: "1789012345678902", name: "US - 18-34", campaignId: "1789012345678901", campaignName: "Summer Sale", status: "ACTIVE", budget: 50, budgetMode: "BUDGET_MODE_DAY", bid: 1.2, optimizationGoal: "CLICK", createTime: "2026-06-01 10:05:00", modifyTime: "2026-06-02 09:00:00" }],
           pageInfo: { page: 1, page_size: 100, total_number: 1, total_page: 1 }
         }
       }
       #swagger.responses[400] = { description: "advertiserId is required" }
       #swagger.responses[500] = { description: "Failed to fetch TikTok ad groups" }
    */
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
        status: mapTiktokStatus(g.operation_status || g.secondary_status),
        budget: g.budget,
        budgetMode: g.budget_mode,
        bid: g.bid_price,
        optimizationGoal: g.optimization_goal,
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
   * Get review status + rejection reasons for up to 20 ad groups (and their
   * ads) in one call. Surfaces WHY a rejected ad group/ad can't deliver —
   * forbidden placements/ages/locations, content-specific reject reasons and
   * fix suggestions — so the wizard can show actionable feedback instead of
   * just a generic "rejected" status.
   */
  async getAdGroupReviewInfo(req, res) {
    /* #swagger.tags = ['TikTok Ads']
       #swagger.summary = 'Get ad group + ad review info'
       #swagger.description = 'Proxies TikTok Marketing API GET /adgroup/review_info/. Returns review status and rejection reasons for up to 20 ad groups, plus a per-ad breakdown for ads within them (ad_review_map + ad_group_review_map).'
       #swagger.security = [{ "BearerAuth": [] }]
       #swagger.parameters['advertiserId'] = { in: 'query', required: true, description: 'TikTok advertiser (ad account) ID', type: 'string', example: '7012345678901234567' }
       #swagger.parameters['adgroupIds'] = { in: 'query', required: true, description: 'Comma-separated ad group IDs (max 20)', type: 'string', example: '1789012345678902,1789012345678903' }
       #swagger.responses[200] = {
         description: "Review info",
         schema: {
           status: true,
           adGroups: [{ adgroupId: "1789012345678902", isApproved: false, reviewStatus: "PART_AVAILABLE", containsRejectedAds: true, forbiddenPlacements: ["PLACEMENT_TIKTOK"], forbiddenAges: [], forbiddenLocations: ["RU"], rejectInfo: [{ suggestion: "Please add background audio...", reasons: ["The ad or video has no background audio..."] }] }],
           ads: [{ adId: "1789012345678999", adgroupId: "1789012345678902", isApproved: true, reviewStatus: "PART_AVAILABLE", forbiddenPlacements: [], rejectInfo: [] }]
         }
       }
       #swagger.responses[400] = { description: "advertiserId and adgroupIds are required" }
       #swagger.responses[500] = { description: "Failed to fetch TikTok ad group review info" }
    */
    try {
      const userId = req.user?.user_id;
      const { advertiserId, adgroupIds } = req.query;
      if (!advertiserId || !adgroupIds) {
        return res.status(400).json({ error: "advertiserId and adgroupIds are required" });
      }

      const ids = String(adgroupIds)
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean)
        .slice(0, 20);

      const accessToken = await getValidAccessToken(userId);
      const data = await tiktokApiRequest({
        method: "GET",
        endpoint: "/adgroup/review_info/",
        accessToken,
        params: {
          advertiser_id: advertiserId,
          adgroup_ids: JSON.stringify(ids),
        },
      });

      const adGroupReviewMap = data?.data?.ad_group_review_map || {};
      const adReviewMap = data?.data?.ad_review_map || {};

      const adGroups = Object.entries(adGroupReviewMap).map(([adgroupId, info]) => ({
        adgroupId,
        isApproved: info.is_approved,
        reviewStatus: info.review_status,
        appealStatus: info.appeal_status,
        containsRejectedAds: info.contains_rejected_ads || info.contain_rejected_ads,
        forbiddenPlacements: info.forbidden_placements || [],
        forbiddenAges: info.forbidden_ages || [],
        forbiddenLocations: info.forbidden_locations || [],
        forbiddenOperatingSystems: info.forbidden_operation_systems || [],
        lastAuditTime: info.last_audit_time,
        rejectInfo: (info.reject_info || []).map((r) => ({
          suggestion: r.suggestion,
          reasons: r.reasons || [],
          forbiddenAges: r.forbidden_ages || [],
          forbiddenLocations: r.forbidden_locations || [],
          forbiddenPlacements: r.forbidden_placements || [],
        })),
      }));

      const ads = [];
      Object.entries(adReviewMap).forEach(([adgroupId, adsInGroup]) => {
        Object.entries(adsInGroup || {}).forEach(([adId, info]) => {
          ads.push({
            adId,
            adgroupId,
            isApproved: info.is_approved,
            reviewStatus: info.review_status,
            forbiddenPlacements: info.forbidden_placements || [],
            forbiddenAges: info.forbidden_ages || [],
            forbiddenLocations: info.forbidden_locations || [],
            forbiddenOperatingSystems: info.forbidden_operation_systems || [],
            rejectInfo: (info.reject_info || []).map((r) => ({
              suggestion: r.suggestion,
              reasons: r.reasons || [],
            })),
          });
        });
      });

      return res.json({ status: true, adGroups, ads });
    } catch (error) {
      logger.error(`TikTok getAdGroupReviewInfo error: ${error.message}`);
      return res.status(error.status || 500).json({
        error: error.userMessage || "Failed to fetch TikTok ad group review info",
        tiktokCode: error.tiktokCode,
      });
    }
  }

  /**
   * Get review status + rejection reasons for up to 100 ads in one call.
   */
  async getAdReviewInfo(req, res) {
    /* #swagger.tags = ['TikTok Ads']
       #swagger.summary = 'Get ad review info'
       #swagger.description = 'Proxies TikTok Marketing API GET /ad/review_info/. Returns review status and rejection reasons (with fix suggestions) for up to 100 ads.'
       #swagger.security = [{ "BearerAuth": [] }]
       #swagger.parameters['advertiserId'] = { in: 'query', required: true, description: 'TikTok advertiser (ad account) ID', type: 'string', example: '7012345678901234567' }
       #swagger.parameters['adIds'] = { in: 'query', required: true, description: 'Comma-separated ad IDs (max 100)', type: 'string', example: '1789012345678999' }
       #swagger.responses[200] = {
         description: "Ad review info",
         schema: { status: true, ads: [{ adId: "1789012345678999", isApproved: true, reviewStatus: "PART_AVAILABLE", forbiddenPlacements: ["PLACEMENT_HELO"], rejectInfo: [{ suggestion: "Please add background audio...", reasons: ["The ad or video has no background audio..."] }] }] }
       }
       #swagger.responses[400] = { description: "advertiserId and adIds are required" }
       #swagger.responses[500] = { description: "Failed to fetch TikTok ad review info" }
    */
    try {
      const userId = req.user?.user_id;
      const { advertiserId, adIds } = req.query;
      if (!advertiserId || !adIds) {
        return res.status(400).json({ error: "advertiserId and adIds are required" });
      }

      const ids = String(adIds)
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean)
        .slice(0, 100);

      const accessToken = await getValidAccessToken(userId);
      const data = await tiktokApiRequest({
        method: "GET",
        endpoint: "/ad/review_info/",
        accessToken,
        params: {
          advertiser_id: advertiserId,
          ad_ids: JSON.stringify(ids),
        },
      });

      const adReviewMap = data?.data?.ad_review_map || {};
      const ads = Object.entries(adReviewMap).map(([adId, info]) => ({
        adId,
        isApproved: info.is_approved,
        reviewStatus: info.review_status,
        forbiddenPlacements: info.forbidden_placements || [],
        forbiddenAges: info.forbidden_ages || [],
        forbiddenLocations: info.forbidden_locations || [],
        forbiddenOperatingSystems: info.forbidden_operation_systems || [],
        rejectInfo: (info.reject_info || []).map((r) => ({
          suggestion: r.suggestion,
          reasons: r.reasons || [],
        })),
      }));

      return res.json({ status: true, ads });
    } catch (error) {
      logger.error(`TikTok getAdReviewInfo error: ${error.message}`);
      return res.status(error.status || 500).json({
        error: error.userMessage || "Failed to fetch TikTok ad review info",
        tiktokCode: error.tiktokCode,
      });
    }
  }

  /**
   * Appeal a rejected ad group's review decision.
   */
  async appealAdGroup(req, res) {
    /* #swagger.tags = ['TikTok Ads']
       #swagger.summary = 'Appeal an ad group rejection'
       #swagger.description = 'Proxies TikTok Marketing API POST /adgroup/appeal/. Requests re-evaluation of a rejected ad group. After appealing, poll GET /adgroup/review_info/ to see the updated appeal_status.'
       #swagger.security = [{ "BearerAuth": [] }]
       #swagger.requestBody = {
         required: true,
         content: {
           "application/json": {
             schema: {
               type: "object",
               required: ["advertiserId", "adgroupId"],
               properties: {
                 advertiserId: { type: "string", example: "7012345678901234567" },
                 adgroupId: { type: "string", example: "1789012345678902" },
                 adId: { type: "string", example: "1789012345678999", description: "Optional — scope the appeal to a specific ad" },
                 appealReason: { type: "string", example: "The flagged audio issue has been fixed in the re-uploaded video." },
                 attachmentList: { type: "array", items: { type: "string" }, example: ["https://example.com/proof.png"] }
               }
             }
           }
         }
       }
       #swagger.responses[200] = { description: "Appeal submitted", schema: { status: true } }
       #swagger.responses[400] = { description: "advertiserId and adgroupId are required" }
       #swagger.responses[500] = { description: "Failed to submit TikTok ad group appeal" }
    */
    try {
      const userId = req.user?.user_id;
      const { advertiserId, adgroupId, adId, appealReason, attachmentList } = req.body;
      if (!advertiserId || !adgroupId) {
        return res.status(400).json({ error: "advertiserId and adgroupId are required" });
      }

      const accessToken = await getValidAccessToken(userId);
      await tiktokApiRequest({
        method: "POST",
        endpoint: "/adgroup/appeal/",
        accessToken,
        data: {
          advertiser_id: advertiserId,
          adgroup_id: adgroupId,
          ...(adId ? { ad_id: adId } : {}),
          ...(appealReason ? { appeal_reason: appealReason } : {}),
          ...(Array.isArray(attachmentList) && attachmentList.length
            ? { attachment_list: attachmentList }
            : {}),
        },
      });

      return res.json({ status: true });
    } catch (error) {
      logger.error(`TikTok appealAdGroup error: ${error.message}`);
      return res.status(error.status || 500).json({
        error: error.userMessage || "Failed to submit TikTok ad group appeal",
        tiktokCode: error.tiktokCode,
      });
    }
  }

  /**
   * List ads for an advertiser account, optionally filtered by ad group.
   */
  async getAds(req, res) {
    /* #swagger.tags = ['TikTok Ads']
       #swagger.summary = 'List ads'
       #swagger.description = 'Lists ads for an advertiser account, optionally filtered by ad group. Proxies TikTok Marketing API GET /ad/get/. Cached for REDIS_TTL (2h).'
       #swagger.security = [{ "BearerAuth": [] }]
       #swagger.parameters['advertiserId'] = { in: 'query', required: true, description: 'TikTok advertiser (ad account) ID', type: 'string', example: '7012345678901234567' }
       #swagger.parameters['adgroupId'] = { in: 'query', description: 'Filter to ads under this ad group', type: 'string', example: '1789012345678902' }
       #swagger.parameters['page'] = { in: 'query', description: 'Page number', type: 'integer', example: 1 }
       #swagger.parameters['pageSize'] = { in: 'query', description: 'Page size', type: 'integer', example: 100 }
       #swagger.responses[200] = {
         description: "Ads",
         schema: {
           ads: [{ id: "1789012345678903", name: "Ad Creative 1", adgroupId: "1789012345678902", adgroupName: "US - 18-34", campaignId: "1789012345678901", campaignName: "Summer Sale", status: "ACTIVE", createTime: "2026-06-01 10:10:00", modifyTime: "2026-06-02 09:00:00", mediaType: "video", thumbnailUrl: "https://p16-ad-sg.tiktokcdn.com/poster.jpeg" }],
           pageInfo: { page: 1, page_size: 100, total_number: 1, total_page: 1 }
         }
       }
       #swagger.responses[400] = { description: "advertiserId is required" }
       #swagger.responses[500] = { description: "Failed to fetch TikTok ads" }
    */
    try {
      const userId = req.user?.user_id;
      const { advertiserId, adgroupId, page = 1, pageSize = 100 } = req.query;

      if (!advertiserId) {
        return res.status(400).json({ error: "advertiserId is required" });
      }

      // v3: rows now carry thumbnailUrl/mediaType/previewVideoUrl — keep
      // older-shaped cache entries from being served for up to REDIS_TTL
      // after deploy. The version segment sits AFTER userId so the
      // invalidation scan (`tiktokAds:${userId}:*`) still matches on writes.
      const cacheKey = `tiktokAds:${userId}:v3:${advertiserId}:${adgroupId || "all"}`;
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

      // Resolve creative thumbnails for the dashboard's Preview column.
      // Nice-to-have — a failure here must never block the ad list itself.
      try {
        await this.attachAdThumbnails(advertiserId, ads, accessToken);
      } catch (thumbErr) {
        logger.warn(`TikTok getAds: thumbnail enrichment skipped — ${thumbErr.message}`);
      }

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
    /* #swagger.tags = ['TikTok Ads']
       #swagger.summary = 'List identities'
       #swagger.description = 'Lists the advertiser Identities (the TikTok account an ad publishes as). TikTok requires one to create any ad — no Meta/Google equivalent. Feeds the "post as" picker in the create-ad step. Proxies TikTok Marketing API GET /identity/get/. Cached for REDIS_TTL (2h).'
       #swagger.security = [{ "BearerAuth": [] }]
       #swagger.parameters['advertiserId'] = { in: 'query', required: true, description: 'TikTok advertiser (ad account) ID', type: 'string', example: '7012345678901234567' }
       #swagger.responses[200] = {
         description: "Identities",
         schema: {
           identities: [{ identityId: "70123456789ID001", identityType: "CUSTOMIZED_USER", displayName: "My Brand", profileImage: "https://p16-sign-va.tiktokcdn.com/example.jpeg" }]
         }
       }
       #swagger.responses[400] = { description: "advertiserId is required" }
       #swagger.responses[500] = { description: "Failed to fetch TikTok identities" }
    */
    try {
      const userId = req.user?.user_id;
      const { advertiserId } = req.query;
      if (!advertiserId) {
        return res.status(400).json({ error: "advertiserId is required" });
      }

      // v2 segment busts any stale cache so the authorizedBcId field takes
      // effect on the next fetch. It sits AFTER userId so the invalidation
      // scan pattern (`tiktokIdentities:${userId}:*`) still matches — with
      // the version first, disconnect/OAuth would never bust this key.
      const cacheKey = `tiktokIdentities:${userId}:v2:${advertiserId}`;
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
        // A BC-authorized TikTok account (BC_AUTH_TT) requires its authorizing
        // Business Center id (identity_authorized_bc_id) in the ad creative,
        // or /ad/create/ fails with "Identity_type and Identity_bc_ID don't
        // match". TikTok returns it right here on the identity object.
        authorizedBcId: i.identity_authorized_bc_id || null,
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
    /* #swagger.tags = ['TikTok Ads']
       #swagger.summary = 'List geo/location targeting options'
       #swagger.description = 'Lists valid geo/location targeting IDs for the advertiser, used to build an ad group location_ids field — these IDs cannot be hardcoded and must be fetched per objective/placement. Proxies TikTok Marketing API GET /tool/region/. Cached for REDIS_TTL (2h) per placement+objectiveType.'
       #swagger.security = [{ "BearerAuth": [] }]
       #swagger.parameters['advertiserId'] = { in: 'query', required: true, description: 'TikTok advertiser (ad account) ID', type: 'string', example: '7012345678901234567' }
       #swagger.parameters['placement'] = { in: 'query', description: 'TikTok placement', type: 'string', example: 'PLACEMENT_TIKTOK' }
       #swagger.parameters['objectiveType'] = { in: 'query', description: 'TikTok campaign objective type — refetch when the objective changes', type: 'string', example: 'TRAFFIC' }
       #swagger.responses[200] = {
         description: "Regions",
         schema: {
           regions: [{ id: "6252001", name: "United States", level: "COUNTRY", parentId: null }]
         }
       }
       #swagger.responses[400] = { description: "advertiserId is required" }
       #swagger.responses[500] = { description: "Failed to fetch TikTok regions" }
    */
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
    /* #swagger.tags = ['TikTok Ads']
       #swagger.summary = 'Get per-entity performance insights'
       #swagger.description = 'Per-entity performance rows for the chosen level (account/campaign/adgroup/ad) over a date range. Drives drill-down performance views. Proxies TikTok Marketing API GET /report/integrated/get/. Spend/CPC/CPM values are already in the account main currency unit (do NOT divide by 100). Cached for REPORT_TTL (15m).'
       #swagger.security = [{ "BearerAuth": [] }]
       #swagger.parameters['advertiserId'] = { in: 'query', required: true, description: 'TikTok advertiser (ad account) ID', type: 'string', example: '7012345678901234567' }
       #swagger.parameters['level'] = { in: 'query', description: 'Reporting level', type: 'string', example: 'campaign', schema: { type: 'string', enum: ['account', 'campaign', 'adgroup', 'ad'] } }
       #swagger.parameters['startDate'] = { in: 'query', description: 'Start date (YYYY-MM-DD). Defaults to 7 days ago.', type: 'string', example: '2026-06-30' }
       #swagger.parameters['endDate'] = { in: 'query', description: 'End date (YYYY-MM-DD). Defaults to today.', type: 'string', example: '2026-07-06' }
       #swagger.parameters['lifetime'] = { in: 'query', description: 'Pass true to query lifetime totals instead of a date range', type: 'string', example: 'false' }
       #swagger.parameters['page'] = { in: 'query', description: 'Page number', type: 'integer', example: 1 }
       #swagger.parameters['pageSize'] = { in: 'query', description: 'Page size', type: 'integer', example: 100 }
       #swagger.responses[200] = {
         description: "Insights rows",
         schema: {
           level: "campaign",
           startDate: "2026-06-30",
           endDate: "2026-07-06",
           rows: [{ id: "1789012345678901", metrics: { spend: "125.40", impressions: "10234", clicks: "310", ctr: "3.03", cpc: "0.40", cpm: "12.25", conversion: "12", cost_per_conversion: "10.45" }, dimensions: { campaign_id: "1789012345678901" } }],
           pageInfo: { page: 1, page_size: 100, total_number: 1, total_page: 1 }
         }
       }
       #swagger.responses[400] = { description: "advertiserId is required" }
       #swagger.responses[500] = { description: "Failed to fetch TikTok insights" }
    */
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
    /* #swagger.tags = ['TikTok Ads']
       #swagger.summary = 'Get dashboard KPI totals and daily chart series'
       #swagger.description = 'Account-level KPI totals (spend, impressions, clicks, conversions, CTR, CPC, CPM, CPA) plus a daily time series for the dashboard chart. Proxies TikTok Marketing API GET /report/integrated/get/ segmented by stat_time_day. Values are in the account main currency unit. Cached for REPORT_TTL (15m).'
       #swagger.security = [{ "BearerAuth": [] }]
       #swagger.parameters['advertiserId'] = { in: 'query', required: true, description: 'TikTok advertiser (ad account) ID', type: 'string', example: '7012345678901234567' }
       #swagger.parameters['startDate'] = { in: 'query', description: 'Start date (YYYY-MM-DD). Defaults to 7 days ago.', type: 'string', example: '2026-06-30' }
       #swagger.parameters['endDate'] = { in: 'query', description: 'End date (YYYY-MM-DD). Defaults to today.', type: 'string', example: '2026-07-06' }
       #swagger.parameters['lifetime'] = { in: 'query', description: 'Pass true to query lifetime totals instead of a date range', type: 'string', example: 'false' }
       #swagger.responses[200] = {
         description: "Dashboard stats + chart data",
         schema: {
           stats: { totalSpend: 452.8, totalImpressions: 38210, totalClicks: 980, totalConversions: 41, ctr: 2.56, cpc: 0.46, cpm: 11.85, cpa: 11.04 },
           chartData: [{ date: "2026-07-01", spend: 60.1, impressions: 5100, clicks: 130, conversions: 5 }],
           startDate: "2026-06-30",
           endDate: "2026-07-06"
         }
       }
       #swagger.responses[400] = { description: "advertiserId is required" }
       #swagger.responses[500] = { description: "Failed to fetch TikTok dashboard data" }
    */
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
    /* #swagger.tags = ['TikTok Ads']
       #swagger.summary = 'Enable/pause/delete campaigns, ad groups, or ads'
       #swagger.description = 'Enables, pauses, or deletes one or more campaigns, ad groups, or ads. Maps the friendly status (ACTIVE/PAUSED/DELETED) to the TikTok operation_status enum (ENABLE/DISABLE/DELETE). Proxies TikTok Marketing API POST /{level}/status/update/. Busts the user status caches on success.'
       #swagger.security = [{ "BearerAuth": [] }]
       #swagger.requestBody = {
         required: true,
         content: {
           "application/json": {
             schema: {
               type: "object",
               required: ["advertiserId", "level", "status"],
               properties: {
                 advertiserId: { type: "string", example: "7012345678901234567" },
                 level: { type: "string", example: "campaign", description: "campaign | adgroup | ad" },
                 ids: { type: "array", items: { type: "string" }, example: ["1789012345678901"] },
                 id: { type: "string", description: "Single-ID convenience alias for ids", example: "1789012345678901" },
                 status: { type: "string", example: "PAUSED", description: "ACTIVE | PAUSED | DELETED" }
               }
             }
           }
         }
       }
       #swagger.responses[200] = {
         description: "Status updated",
         schema: { success: true, level: "campaign", ids: ["1789012345678901"], status: "PAUSED", data: {} }
       }
       #swagger.responses[400] = { description: "advertiserId / ids / status missing, or invalid level" }
       #swagger.responses[500] = { description: "Failed to update TikTok status" }
    */
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
    /* #swagger.tags = ['TikTok Ads']
       #swagger.summary = 'Create a campaign'
       #swagger.description = 'Creates a TikTok campaign. `payload` lets the wizard pass any extra raw TikTok fields verbatim, merged on top of the mapped fields. Proxies TikTok Marketing API POST /campaign/create/. Busts the user status caches on success.'
       #swagger.security = [{ "BearerAuth": [] }]
       #swagger.requestBody = {
         required: true,
         content: {
           "application/json": {
             schema: {
               type: "object",
               required: ["advertiserId", "campaignName", "objectiveType"],
               properties: {
                 advertiserId: { type: "string", example: "7012345678901234567" },
                 campaignName: { type: "string", example: "Summer Sale" },
                 objectiveType: { type: "string", example: "TRAFFIC", description: "One of the TikTok objective_type enum values, e.g. REACH, TRAFFIC, VIDEO_VIEWS, ENGAGEMENT, APP_PROMOTION, LEAD_GENERATION, PRODUCT_SALES" },
                 budgetMode: { type: "string", example: "BUDGET_MODE_INFINITE", description: "BUDGET_MODE_DAY | BUDGET_MODE_TOTAL | BUDGET_MODE_INFINITE" },
                 budget: { type: "number", example: 100, description: "Required unless budgetMode is BUDGET_MODE_INFINITE" },
                 budgetOptimizeOn: { type: "boolean", example: false },
                 specialIndustries: { type: "array", items: { type: "string" }, example: [] },
                 appPromotionType: { type: "string", example: "APP_INSTALL", description: "Required when objectiveType is APP_PROMOTION. APP_INSTALL | APP_RETARGETING" },
                 payload: { type: "object", description: "Raw extra TikTok /campaign/create/ fields merged verbatim", example: {} }
               }
             }
           }
         }
       }
       #swagger.responses[200] = {
         description: "Campaign created",
         schema: { success: true, campaignId: "1789012345678901", data: { campaign_id: "1789012345678901" } }
       }
       #swagger.responses[400] = { description: "advertiserId / campaignName / objectiveType is required" }
       #swagger.responses[500] = { description: "Failed to create TikTok campaign" }
    */
    try {
      const userId = req.user?.user_id;
      const {
        advertiserId,
        campaignName,
        objectiveType,
        budgetMode = "BUDGET_MODE_INFINITE",
        budget,
        budgetOptimizeOn,
        specialIndustries,
        appPromotionType,
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

      let finalObjectiveType = objectiveType;
      if (
        (objectiveType === "PRODUCT_SALES" || req.body.objectiveKey === "PRODUCT_SALES") &&
        (req.body.productSalesSubType === "WEBSITE" || req.body.salesDestination === "WEBSITE" || (!req.body.campaignProductSource && !req.body.campaign_product_source))
      ) {
        finalObjectiveType = "WEB_CONVERSIONS";
      }

      const payload = {
        advertiser_id: advertiserId,
        campaign_name: campaignName,
        objective_type: finalObjectiveType,
        budget_mode: budgetMode,
        ...(budget != null && budgetMode !== "BUDGET_MODE_INFINITE"
          ? { budget: Number(budget) }
          : {}),
        ...(budgetOptimizeOn ? { budget_optimize_on: true } : {}),
        ...(Array.isArray(specialIndustries) && specialIndustries.length
          ? { special_industries: specialIndustries }
          : {}),
        // Required by TikTok's Marketing API when objective_type is
        // APP_PROMOTION (App install vs App retargeting).
        ...(finalObjectiveType === "APP_PROMOTION" && appPromotionType
          ? { app_promotion_type: appPromotionType }
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
    /* #swagger.tags = ['TikTok Ads']
       #swagger.summary = 'Create an ad group'
       #swagger.description = 'Creates an ad group under a campaign. Most fields (placement, targeting, budget, schedule, optimization goal, bid, billing event) are passed through `payload` since TikTok ad-group shape is large and objective-dependent. Defaults schedule_start_time to ~5 minutes from now in the ad account timezone if not supplied. Proxies TikTok Marketing API POST /adgroup/create/. Busts the user status caches on success.'
       #swagger.security = [{ "BearerAuth": [] }]
       #swagger.requestBody = {
         required: true,
         content: {
           "application/json": {
             schema: {
               type: "object",
               required: ["advertiserId", "campaignId", "adgroupName"],
               properties: {
                 advertiserId: { type: "string", example: "7012345678901234567" },
                 campaignId: { type: "string", example: "1789012345678901" },
                 adgroupName: { type: "string", example: "US - 18-34" },
                 payload: {
                   type: "object",
                   description: "Raw TikTok /adgroup/create/ fields — placement, location_ids, age, gender, budget, budget_mode, schedule_type, schedule_start_time, schedule_end_time, optimization_goal, billing_event, bid_price",
                   example: {
                     placement_type: "PLACEMENT_TYPE_AUTOMATIC",
                     location_ids: ["6252001"],
                     age_groups: ["AGE_18_24", "AGE_25_34"],
                     gender: "GENDER_UNLIMITED",
                     budget_mode: "BUDGET_MODE_DAY",
                     budget: 50,
                     schedule_type: "SCHEDULE_FROM_NOW",
                     optimization_goal: "CLICK",
                     billing_event: "CPC",
                     bid_price: 1.2
                   }
                 }
               }
             }
           }
         }
       }
       #swagger.responses[200] = {
         description: "Ad group created",
         schema: { success: true, adgroupId: "1789012345678902", data: { adgroup_id: "1789012345678902" } }
       }
       #swagger.responses[400] = { description: "advertiserId / campaignId / adgroupName is required" }
       #swagger.responses[500] = { description: "Failed to create TikTok ad group" }
    */
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

      // Sanitize device_type to TikTok's operating_systems field ("ANDROID", "IOS")
      if (incoming.device_type && !incoming.operating_systems) {
        incoming.operating_systems = (
          Array.isArray(incoming.device_type) ? incoming.device_type : [incoming.device_type]
        ).map((d) => String(d).replace(/^DEVICE_/, ""));
        delete incoming.device_type;
      }
      if (Array.isArray(incoming.operating_systems)) {
        incoming.operating_systems = incoming.operating_systems.map((d) =>
          String(d).replace(/^DEVICE_/, "")
        );
      }

      // Sanitize promotion_type for App Promotion: TikTok API requires APP_ANDROID or APP_IOS
      if (incoming.promotion_type === "APP" || incoming.promotion_type === "APP_PROMOTION") {
        const isIos = (incoming.operating_systems || []).includes("IOS") && !(incoming.operating_systems || []).includes("ANDROID");
        incoming.promotion_type = isIos ? "APP_IOS" : "APP_ANDROID";
      }
      if (incoming.promotion_type === "APP_ANDROID") {
        incoming.operating_systems = ["ANDROID"];
      } else if (incoming.promotion_type === "APP_IOS") {
        incoming.operating_systems = ["IOS"];
      }

      // Sanitize promotion_type for Lead Generation
      if (incoming.promotion_target_type && !incoming.promotion_type) {
        incoming.promotion_type = "LEAD_GENERATION";
      }

      // Map standard/Meta event names to TikTok Marketing API valid optimization_event enum
      const eventMap = {
        COMPLETE_PAYMENT: "ON_WEB_ORDER",
        PURCHASE: "ON_WEB_ORDER",
        INITIATE_CHECKOUT: "INITIATE_ORDER",
        ADD_PAYMENT_INFO: "ADD_BILLING",
        ADD_TO_CART: "ON_WEB_CART",
        VIEW_CONTENT: "ON_WEB_DETAIL",
        ADD_TO_WISHLIST: "ON_WEB_ADD_TO_WISHLIST",
        SEARCH: "ON_WEB_SEARCH",
        SUBMIT_FORM: "FORM",
        LEAD: "FORM",
        COMPLETE_REGISTRATION: "ON_WEB_REGISTER",
        SUBSCRIBE: "ON_WEB_SUBSCRIBE",
        CONTACT: "CONSULT",
        DOWNLOAD: "DOWNLOAD_FINISH",
      };
      if (incoming.optimization_event && eventMap[incoming.optimization_event]) {
        incoming.optimization_event = eventMap[incoming.optimization_event];
      }

      // TikTok requires billing_event = "CPC" when optimization_goal is "CLICK"
      if (incoming.optimization_goal === "CLICK" && (!incoming.billing_event || incoming.billing_event === "CPM")) {
        incoming.billing_event = "CPC";
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
    /* #swagger.tags = ['TikTok Ads']
       #swagger.summary = 'Create one or more ads'
       #swagger.description = 'Creates one or more ads under an ad group. `creatives` is an array of TikTok creative objects (each needs identity_id, ad_format, video_id/image_ids, ad_text, call_to_action, etc). Proxies TikTok Marketing API POST /ad/create/. Busts the user status caches on success.'
       #swagger.security = [{ "BearerAuth": [] }]
       #swagger.requestBody = {
         required: true,
         content: {
           "application/json": {
             schema: {
               type: "object",
               required: ["advertiserId", "adgroupId", "creatives"],
               properties: {
                 advertiserId: { type: "string", example: "7012345678901234567" },
                 adgroupId: { type: "string", example: "1789012345678902" },
                 creatives: {
                   type: "array",
                   minItems: 1,
                   items: {
                     type: "object",
                     properties: {
                       ad_name: { type: "string", example: "Ad Creative 1" },
                       ad_format: { type: "string", example: "SINGLE_VIDEO" },
                       identity_id: { type: "string", example: "70123456789ID001" },
                       identity_type: { type: "string", example: "CUSTOMIZED_USER" },
                       video_id: { type: "string", example: "v1023abc456def" },
                       image_ids: { type: "array", items: { type: "string" }, example: ["i1023abc456def"] },
                       ad_text: { type: "string", example: "Shop the summer sale now!" },
                       call_to_action: { type: "string", example: "SHOP_NOW" },
                       landing_page_url: { type: "string", example: "https://example.com/summer-sale" }
                     }
                   }
                 },
                 payload: { type: "object", description: "Raw extra TikTok /ad/create/ fields merged verbatim", example: {} }
               }
             }
           }
         }
       }
       #swagger.responses[200] = {
         description: "Ads created",
         schema: { success: true, adIds: ["1789012345678903"], creatives: [{ ad_id: "1789012345678903" }], data: {} }
       }
       #swagger.responses[400] = { description: "advertiserId / adgroupId is required, or creatives is missing/empty" }
       #swagger.responses[500] = { description: "Failed to create TikTok ad" }
    */
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
   * Derive a usable cover IMAGE ID for a just-uploaded video, so a
   * SINGLE_VIDEO ad can pass it as creative.image_ids (TikTok requires an
   * image there — a video ad without a cover fails with "You must upload an
   * image").
   *
   * There is no /file/video/suggestcover/ in v1.3. The documented path is:
   *   1. Obtain the video's auto-generated poster URL (from the upload
   *      response's video_cover_url, or /file/video/ad/info/ if absent).
   *   2. Upload that poster URL as an ad image (UPLOAD_BY_URL) — the response
   *      `data.id` is the image id usable in image_ids.
   * Using the video's own poster guarantees the cover matches the video's
   * aspect ratio, avoiding "Unsupported image size".
   *
   * @returns {Promise<string>} the cover image id, or "" if none could be derived
   */
  async deriveVideoCoverImageId(advertiserId, video, accessToken) {
    // Prefer the cover URL already returned by the video upload; only call
    // /file/video/ad/info/ if it wasn't present.
    let posterUrl = video.coverUrl || "";
    if (!posterUrl) {
      const info = await tiktokApiRequest({
        endpoint: "/file/video/ad/info/",
        accessToken,
        params: {
          advertiser_id: String(advertiserId),
          video_ids: JSON.stringify([video.videoId]),
        },
      });
      const infoList = info?.data?.list || [];
      posterUrl = infoList[0]?.poster_url || infoList[0]?.video_cover_url || "";
    }
    if (!posterUrl) {
      logger.warn(
        `TikTok cover: no poster_url for video ${video.videoId} — cannot derive cover image id`
      );
      return "";
    }

    // Upload the poster URL as an ad image → data.id is the usable image id.
    const upload = await tiktokApiRequest({
      method: "POST",
      endpoint: "/file/image/ad/upload/",
      accessToken,
      data: {
        advertiser_id: String(advertiserId),
        upload_type: "UPLOAD_BY_URL",
        image_url: posterUrl,
        file_name: `cover_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.jpg`,
      },
    });
    return upload?.data?.image_id || upload?.data?.id || "";
  }

  /**
   * Attach a creative thumbnail to each ad row for the dashboard's Preview
   * column (same UX as the Meta/Google ad tables). /ad/get/ returns only
   * media IDs — the CDN URLs live behind GET /file/video/ad/info/
   * (poster_url, ≤60 ids/request) and GET /file/image/ad/info/
   * (image_url, ≤100 ids/request) — so the IDs are batch-resolved here.
   * Mutates each ad in place: adds `mediaType` ("video"|"image"|"carousel")
   * and `thumbnailUrl` ("" when no lookup succeeds — the UI then falls back
   * to a placeholder icon). Never throws for a single failed batch.
   */
  async attachAdThumbnails(advertiserId, ads, accessToken) {
    const chunk = (arr, size) => {
      const out = [];
      for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
      return out;
    };

    const videoIds = [...new Set(ads.map((a) => a.raw?.video_id).filter(Boolean))];
    // First image of image/carousel ads; for video ads image_ids[0] is the
    // cover image, kept as a fallback when the video lookup yields no poster.
    const imageIds = [...new Set(ads.map((a) => a.raw?.image_ids?.[0]).filter(Boolean))];
    if (!videoIds.length && !imageIds.length) return;

    const posterByVideoId = new Map();
    const playableByVideoId = new Map();
    const urlByImageId = new Map();

    await Promise.all([
      ...chunk(videoIds, 60).map((ids) =>
        tiktokApiRequest({
          endpoint: "/file/video/ad/info/",
          accessToken,
          params: {
            advertiser_id: String(advertiserId),
            video_ids: JSON.stringify(ids),
          },
        })
          .then((info) => {
            for (const v of info?.data?.list || []) {
              posterByVideoId.set(v.video_id, v.poster_url || v.video_cover_url || "");
              // Playable source when TikTok returns one (field availability
              // varies by account/API version) — passed through defensively;
              // the UI only renders a player when this is non-empty.
              playableByVideoId.set(v.video_id, v.preview_url || v.url || "");
            }
          })
          .catch((err) =>
            logger.warn(`TikTok ad-thumbnail video batch failed: ${err.message}`)
          )
      ),
      ...chunk(imageIds, 100).map((ids) =>
        tiktokApiRequest({
          endpoint: "/file/image/ad/info/",
          accessToken,
          params: {
            advertiser_id: String(advertiserId),
            image_ids: JSON.stringify(ids),
          },
        })
          .then((info) => {
            // Same normalization as uploadImage — image endpoints return both
            // `data.list` and a bare `data` array/object shapes.
            const list = info?.data?.list || info?.data || [];
            for (const i of Array.isArray(list) ? list : [list]) {
              if (i?.image_id) urlByImageId.set(i.image_id, i.image_url || "");
            }
          })
          .catch((err) =>
            logger.warn(`TikTok ad-thumbnail image batch failed: ${err.message}`)
          )
      ),
    ]);

    for (const ad of ads) {
      const raw = ad.raw || {};
      ad.mediaType =
        raw.ad_format === "SINGLE_VIDEO" || raw.video_id
          ? "video"
          : raw.ad_format === "CAROUSEL_ADS"
          ? "carousel"
          : raw.image_ids?.length
          ? "image"
          : "";
      ad.thumbnailUrl =
        (raw.video_id && posterByVideoId.get(raw.video_id)) ||
        (raw.image_ids?.[0] && urlByImageId.get(raw.image_ids[0])) ||
        "";
      ad.previewVideoUrl =
        (raw.video_id && playableByVideoId.get(raw.video_id)) || "";
    }
  }

  /**
   * Upload a video creative. Supports either a multipart file (field "video")
   * or a remote URL (body.videoUrl). Returns the TikTok video_id used by
   * createAd. Multipart is sent with native FormData/Blob (Node 18+).
   * TikTok API: POST /file/video/ad/upload/
   */
  async uploadVideo(req, res) {
    /* #swagger.tags = ['TikTok Ads']
       #swagger.summary = 'Upload a video creative'
       #swagger.description = 'Uploads a video creative via multipart file (field "video") or a remote URL (videoUrl). Computes an MD5 signature of the file bytes as TikTok requires. Returns the TikTok video_id(s) used by createAd. Proxies TikTok Marketing API POST /file/video/ad/upload/. Busts the user status caches on success.'
       #swagger.security = [{ "BearerAuth": [] }]
       #swagger.requestBody = {
         required: true,
         content: {
           "multipart/form-data": {
             schema: {
               type: "object",
               required: ["advertiserId"],
               properties: {
                 advertiserId: { type: "string", example: "7012345678901234567" },
                 videoUrl: { type: "string", example: "https://example.com/video.mp4", description: "Used instead of a file upload — TikTok fetches it by URL" },
                 video: { type: "string", format: "binary", description: "Video file (multipart), max 500MB" }
               }
             }
           }
         }
       }
       #swagger.responses[200] = {
         description: "Video uploaded",
         schema: { success: true, videos: [{ videoId: "v1023abc456def", coverImageId: "img1023abc", coverUrl: "https://p16.tiktokcdn.com/cover.jpeg", url: "", width: 1080, height: 1920, duration: 15.2 }] }
       }
       #swagger.responses[400] = { description: "advertiserId is required, or neither a file nor videoUrl was provided" }
       #swagger.responses[500] = { description: "Failed to upload TikTok video" }
    */
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
        const origName = req.file.originalname || "video.mp4";
        const dotIdx = origName.lastIndexOf(".");
        const base = (dotIdx !== -1 ? origName.slice(0, dotIdx) : origName).replace(/[^a-zA-Z0-9_-]/g, "_");
        const ext = dotIdx !== -1 ? origName.slice(dotIdx) : ".mp4";
        const uniqueFileName = `${base.slice(0, 50)}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}${ext}`;

        form.append("upload_type", "UPLOAD_BY_FILE");
        form.append("video_signature", signature);
        form.append("file_name", uniqueFileName);
        form.append(
          "video_file",
          blob,
          uniqueFileName
        );
      } else {
        const uniqueFileName = `video_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.mp4`;
        form.append("upload_type", "UPLOAD_BY_URL");
        form.append("video_url", videoUrl);
        form.append("file_name", uniqueFileName);
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

      // A SINGLE_VIDEO ad requires a cover IMAGE ID in the creative's
      // image_ids — the upload only returns a cover URL, not a usable id.
      // There is NO /file/video/suggestcover/ endpoint in v1.3; the documented
      // flow is: read the video's auto-generated poster_url, then upload THAT
      // url as an ad image to get a usable image id. Using the video's own
      // poster guarantees the cover matches the video's aspect ratio (a
      // mismatched cover triggers "Unsupported image size"). Best-effort: a
      // failure here shouldn't fail the whole upload — the caller can still
      // upload a matching image manually.
      for (const video of videos) {
        if (!video.videoId) continue;
        try {
          video.coverImageId = await this.deriveVideoCoverImageId(
            advertiserId,
            video,
            accessToken
          );
        } catch (coverErr) {
          logger.warn(
            `TikTok cover-image derivation failed for ${video.videoId}: ${coverErr.message}`
          );
          video.coverImageId = "";
        }
      }

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
    /* #swagger.tags = ['TikTok Ads']
       #swagger.summary = 'Update a campaign'
       #swagger.description = 'Updates a campaign name, budget, and/or budget mode. Extra raw TikTok fields can be passed via `payload`. Proxies TikTok Marketing API POST /campaign/update/. Busts the user status caches on success.'
       #swagger.security = [{ "BearerAuth": [] }]
       #swagger.requestBody = {
         required: true,
         content: {
           "application/json": {
             schema: {
               type: "object",
               required: ["advertiserId", "campaignId"],
               properties: {
                 advertiserId: { type: "string", example: "7012345678901234567" },
                 campaignId: { type: "string", example: "1789012345678901" },
                 campaignName: { type: "string", example: "Summer Sale - Updated" },
                 budget: { type: "number", example: 150 },
                 budgetMode: { type: "string", example: "BUDGET_MODE_DAY" },
                 payload: { type: "object", description: "Raw extra TikTok /campaign/update/ fields merged verbatim", example: {} }
               }
             }
           }
         }
       }
       #swagger.responses[200] = {
         description: "Campaign updated",
         schema: { success: true, campaignId: "1789012345678901", data: {} }
       }
       #swagger.responses[400] = { description: "advertiserId / campaignId is required" }
       #swagger.responses[500] = { description: "Failed to update TikTok campaign" }
    */
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
    /* #swagger.tags = ['TikTok Ads']
       #swagger.summary = 'Update an ad group'
       #swagger.description = 'Updates an ad group name, budget, and/or budget mode (or any field via `payload`). Proxies TikTok Marketing API POST /adgroup/update/. Busts the user status caches on success.'
       #swagger.security = [{ "BearerAuth": [] }]
       #swagger.requestBody = {
         required: true,
         content: {
           "application/json": {
             schema: {
               type: "object",
               required: ["advertiserId", "adgroupId"],
               properties: {
                 advertiserId: { type: "string", example: "7012345678901234567" },
                 adgroupId: { type: "string", example: "1789012345678902" },
                 adgroupName: { type: "string", example: "US - 18-34 - Updated" },
                 budget: { type: "number", example: 75 },
                 budgetMode: { type: "string", example: "BUDGET_MODE_DAY" },
                 payload: { type: "object", description: "Raw extra TikTok /adgroup/update/ fields merged verbatim", example: {} }
               }
             }
           }
         }
       }
       #swagger.responses[200] = {
         description: "Ad group updated",
         schema: { success: true, adgroupId: "1789012345678902", data: {} }
       }
       #swagger.responses[400] = { description: "advertiserId / adgroupId is required" }
       #swagger.responses[500] = { description: "Failed to update TikTok ad group" }
    */
    try {
      const userId = req.user?.user_id;
      const { advertiserId, adgroupId, adgroupName, budget, budgetMode } = req.body;
      if (!advertiserId) {
        return res.status(400).json({ error: "advertiserId is required" });
      }
      if (!adgroupId) {
        return res.status(400).json({ error: "adgroupId is required" });
      }

      const incoming = req.body.payload || {};
      if (incoming.device_type && !incoming.operating_systems) {
        incoming.operating_systems = (
          Array.isArray(incoming.device_type) ? incoming.device_type : [incoming.device_type]
        ).map((d) => String(d).replace(/^DEVICE_/, ""));
        delete incoming.device_type;
      }
      if (Array.isArray(incoming.operating_systems)) {
        incoming.operating_systems = incoming.operating_systems.map((d) =>
          String(d).replace(/^DEVICE_/, "")
        );
      }

      // Sanitize promotion_type for App Promotion: TikTok API requires APP_ANDROID or APP_IOS
      if (incoming.promotion_type === "APP" || incoming.promotion_type === "APP_PROMOTION") {
        const isIos = (incoming.operating_systems || []).includes("IOS") && !(incoming.operating_systems || []).includes("ANDROID");
        incoming.promotion_type = isIos ? "APP_IOS" : "APP_ANDROID";
      }
      if (incoming.promotion_type === "APP_ANDROID") {
        incoming.operating_systems = ["ANDROID"];
      } else if (incoming.promotion_type === "APP_IOS") {
        incoming.operating_systems = ["IOS"];
      }

      // Sanitize promotion_type for Lead Generation
      if (incoming.promotion_target_type && !incoming.promotion_type) {
        incoming.promotion_type = "LEAD_GENERATION";
      }

      const eventMap = {
        COMPLETE_PAYMENT: "ON_WEB_ORDER",
        PURCHASE: "ON_WEB_ORDER",
        INITIATE_CHECKOUT: "INITIATE_ORDER",
        ADD_PAYMENT_INFO: "ADD_BILLING",
        ADD_TO_CART: "ON_WEB_CART",
        VIEW_CONTENT: "ON_WEB_DETAIL",
        ADD_TO_WISHLIST: "ON_WEB_ADD_TO_WISHLIST",
        SEARCH: "ON_WEB_SEARCH",
        SUBMIT_FORM: "FORM",
        LEAD: "FORM",
        COMPLETE_REGISTRATION: "ON_WEB_REGISTER",
        SUBSCRIBE: "ON_WEB_SUBSCRIBE",
        CONTACT: "CONSULT",
        DOWNLOAD: "DOWNLOAD_FINISH",
      };
      if (incoming.optimization_event && eventMap[incoming.optimization_event]) {
        incoming.optimization_event = eventMap[incoming.optimization_event];
      }

      const payload = {
        advertiser_id: advertiserId,
        adgroup_id: adgroupId,
        ...(adgroupName ? { adgroup_name: adgroupName } : {}),
        ...(budget != null ? { budget: Number(budget) } : {}),
        ...(budgetMode ? { budget_mode: budgetMode } : {}),
        ...incoming,
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
    /* #swagger.tags = ['TikTok Ads']
       #swagger.summary = 'Update an ad'
       #swagger.description = 'Updates one or more ads. TikTok updates ads via the `creatives` array (each entry carries the ad_id plus fields to change). Extra fields can go in `payload`. Proxies TikTok Marketing API POST /ad/update/. Busts the user status caches on success.'
       #swagger.security = [{ "BearerAuth": [] }]
       #swagger.requestBody = {
         required: true,
         content: {
           "application/json": {
             schema: {
               type: "object",
               required: ["advertiserId"],
               properties: {
                 advertiserId: { type: "string", example: "7012345678901234567" },
                 adgroupId: { type: "string", example: "1789012345678902" },
                 creatives: {
                   type: "array",
                   items: {
                     type: "object",
                     required: ["ad_id"],
                     properties: {
                       ad_id: { type: "string", example: "1789012345678903" },
                       ad_name: { type: "string", example: "Ad Creative 1 - Updated" },
                       ad_text: { type: "string", example: "Updated ad copy" },
                       call_to_action: { type: "string", example: "SHOP_NOW" }
                     }
                   }
                 },
                 payload: { type: "object", description: "Raw extra TikTok /ad/update/ fields merged verbatim", example: {} }
               }
             }
           }
         }
       }
       #swagger.responses[200] = {
         description: "Ad updated",
         schema: { success: true, data: {} }
       }
       #swagger.responses[400] = { description: "advertiserId is required, or neither creatives nor payload was provided" }
       #swagger.responses[500] = { description: "Failed to update TikTok ad" }
    */
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
    /* #swagger.tags = ['TikTok Ads']
       #swagger.summary = 'Upload an image creative'
       #swagger.description = 'Uploads an image creative (cover / carousel) via multipart file (field "image") or a remote URL (imageUrl). Computes an MD5 signature of the file bytes as TikTok requires. Returns image_id(s). Proxies TikTok Marketing API POST /file/image/ad/upload/. Busts the user status caches on success.'
       #swagger.security = [{ "BearerAuth": [] }]
       #swagger.requestBody = {
         required: true,
         content: {
           "multipart/form-data": {
             schema: {
               type: "object",
               required: ["advertiserId"],
               properties: {
                 advertiserId: { type: "string", example: "7012345678901234567" },
                 imageUrl: { type: "string", example: "https://example.com/cover.jpg", description: "Used instead of a file upload — TikTok fetches it by URL" },
                 image: { type: "string", format: "binary", description: "Image file (multipart), max 10MB" }
               }
             }
           }
         }
       }
       #swagger.responses[200] = {
         description: "Image uploaded",
         schema: { success: true, images: [{ imageId: "i1023abc456def", url: "https://p16.tiktokcdn.com/image.jpeg", width: 1200, height: 628 }] }
       }
       #swagger.responses[400] = { description: "advertiserId is required, or neither a file nor imageUrl was provided" }
       #swagger.responses[500] = { description: "Failed to upload TikTok image" }
    */
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
        const origName = req.file.originalname || "image.jpg";
        const dotIdx = origName.lastIndexOf(".");
        const base = (dotIdx !== -1 ? origName.slice(0, dotIdx) : origName).replace(/[^a-zA-Z0-9_-]/g, "_");
        const ext = dotIdx !== -1 ? origName.slice(dotIdx) : ".jpg";
        const uniqueFileName = `${base.slice(0, 50)}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}${ext}`;

        form.append("upload_type", "UPLOAD_BY_FILE");
        form.append("image_signature", signature);
        form.append("file_name", uniqueFileName);
        form.append("image_file", blob, uniqueFileName);
      } else {
        const uniqueFileName = `image_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.jpg`;
        form.append("upload_type", "UPLOAD_BY_URL");
        form.append("image_url", imageUrl);
        form.append("file_name", uniqueFileName);
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
    /* #swagger.tags = ['TikTok Ads']
       #swagger.summary = 'Get uploaded video info/status'
       #swagger.description = 'Gets info/status for one or more uploaded videos, used to poll until a video is "ready" before attaching it to an ad. Not cached — status moves. Proxies TikTok Marketing API GET /file/video/ad/info/.'
       #swagger.security = [{ "BearerAuth": [] }]
       #swagger.parameters['advertiserId'] = { in: 'query', required: true, description: 'TikTok advertiser (ad account) ID', type: 'string', example: '7012345678901234567' }
       #swagger.parameters['videoIds'] = { in: 'query', required: true, description: 'Comma-separated video IDs (or repeated array param)', type: 'string', example: 'v1023abc456def,v1023abc456ghi' }
       #swagger.responses[200] = {
         description: "Video info",
         schema: {
           videos: [{ videoId: "v1023abc456def", materialId: "m1023abc456def", width: 1080, height: 1920, duration: 15.2, coverUrl: "https://p16.tiktokcdn.com/cover.jpeg", url: "", format: "mp4", allowedPlacements: ["PLACEMENT_TIKTOK"] }]
         }
       }
       #swagger.responses[400] = { description: "advertiserId / videoIds is required" }
       #swagger.responses[500] = { description: "Failed to fetch TikTok video info" }
    */
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
   * List music available to the ad account for use in ad creatives (music_id).
   * Covers TikTok's Commercial Music Library plus anything the account has
   * uploaded. Used by the Carousel / Reach-image creative flows, which require
   * a music track. TikTok API: GET /file/music/get/
   * Query: advertiserId, page, pageSize
   */
  async getMusicList(req, res) {
    /* #swagger.tags = ['TikTok Ads']
       #swagger.summary = 'List available music for ad creatives'
       #swagger.description = 'Lists music tracks available to the ad account (Commercial Music Library + uploaded music) for use as the music_id on Carousel and Reach image ads. Proxies TikTok Marketing API GET /file/music/get/. Cached for REDIS_TTL (2h).'
       #swagger.security = [{ "BearerAuth": [] }]
       #swagger.parameters['advertiserId'] = { in: 'query', required: true, description: 'TikTok advertiser (ad account) ID', type: 'string', example: '7012345678901234567' }
       #swagger.parameters['page'] = { in: 'query', required: false, type: 'integer', example: 1 }
       #swagger.parameters['pageSize'] = { in: 'query', required: false, type: 'integer', example: 100 }
       #swagger.responses[200] = {
         description: "Music list",
         schema: { music: [{ musicId: "m1023abc456def", name: "More Than Yesterday", author: "Dj Nil Alex", duration: 28, url: "" }] }
       }
       #swagger.responses[400] = { description: "advertiserId is required" }
       #swagger.responses[500] = { description: "Failed to fetch TikTok music" }
    */
    try {
      const userId = req.user?.user_id;
      const { advertiserId, page, pageSize } = req.query;
      if (!advertiserId) {
        return res.status(400).json({ error: "advertiserId is required" });
      }

      const cacheKey = `tiktokMusic:${userId}:${advertiserId}:${page || 1}:${pageSize || 100}`;
      const cached = await redisClient.get(cacheKey);
      if (cached) return res.json(JSON.parse(cached));

      const accessToken = await getValidAccessToken(userId);
      const data = await tiktokApiRequest({
        endpoint: "/file/music/get/",
        accessToken,
        params: {
          advertiser_id: advertiserId,
          page: Number(page) || 1,
          page_size: Number(pageSize) || 100,
        },
      });

      // TikTok's response shape for this endpoint isn't fully documented in the
      // public SDK, so accept the common containers (list / musics / music).
      const rawList =
        data?.data?.list || data?.data?.musics || data?.data?.music || [];
      const music = (Array.isArray(rawList) ? rawList : []).map((m) => ({
        musicId: m.music_id || m.id,
        name: m.name || m.title || m.music_name || "",
        author: m.author || m.author_name || m.singer || "",
        duration: m.duration,
        url: m.url || m.play_url || "",
        raw: m,
      }));

      const payload = { music };
      await redisClient
        .setex(cacheKey, REDIS_TTL, JSON.stringify(payload))
        .catch(() => {});
      return res.json(payload);
    } catch (error) {
      logger.error(`TikTok getMusicList error: ${error.message}`);
      return res.status(error.status || 500).json({
        error: error.userMessage || "Failed to fetch TikTok music",
        tiktokCode: error.tiktokCode,
      });
    }
  }

  /**
   * Upload a music/audio file to the Asset Library for use as an ad creative's
   * music_id. TikTok API: POST /file/music/upload/
   * Multipart field "music" (file). Busts the user's music caches on success.
   */
  async uploadMusic(req, res) {
    /* #swagger.tags = ['TikTok Ads']
       #swagger.summary = 'Upload a music track for ad creatives'
       #swagger.description = 'Uploads a music/audio file (multipart field "music") to the Asset Library and returns a music_id usable on Carousel and Reach image ads. Computes an MD5 signature of the file bytes as TikTok requires. Proxies TikTok Marketing API POST /file/music/upload/. Busts the user status + music caches on success.'
       #swagger.security = [{ "BearerAuth": [] }]
       #swagger.requestBody = {
         required: true,
         content: {
           "multipart/form-data": {
             schema: {
               type: "object",
               required: ["advertiserId", "music"],
               properties: {
                 advertiserId: { type: "string", example: "7012345678901234567" },
                 music: { type: "string", format: "binary", description: "Music file (mp3/wav/m4a/flac), max 10MB" }
               }
             }
           }
         }
       }
       #swagger.responses[200] = {
         description: "Music uploaded",
         schema: { success: true, music: { musicId: "m1023abc456def", name: "my-track.mp3", url: "" } }
       }
       #swagger.responses[400] = { description: "advertiserId is required, or no music file provided" }
       #swagger.responses[500] = { description: "Failed to upload TikTok music" }
    */
    try {
      const userId = req.user?.user_id;
      const { advertiserId } = req.body;
      if (!advertiserId) {
        return res.status(400).json({ error: "advertiserId is required" });
      }
      if (!req.file) {
        return res
          .status(400)
          .json({ error: "Provide a music file (field 'music')" });
      }

      const accessToken = await getValidAccessToken(userId);
      const form = new FormData();
      form.append("advertiser_id", String(advertiserId));

      const signature = crypto
        .createHash("md5")
        .update(req.file.buffer)
        .digest("hex");
      const blob = new Blob([req.file.buffer], {
        type: req.file.mimetype || "audio/mpeg",
      });
      form.append("upload_type", "UPLOAD_BY_FILE");
      form.append("music_signature", signature);
      form.append("music_file", blob, req.file.originalname || "music.mp3");

      const agent2 = getTiktokProxyAgent();
      const response = await axios.post(
        `${TIKTOK_API_BASE}/file/music/upload/`,
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

      const m = Array.isArray(body?.data) ? body.data[0] : body?.data || {};
      const music = {
        musicId: m.music_id || m.id,
        name: m.name || m.music_name || req.file.originalname || "",
        url: m.url || m.play_url || "",
        raw: m,
      };

      await invalidateUserTiktokCache(userId).catch(() => {});
      return res.json({ success: true, music });
    } catch (error) {
      logger.error(`TikTok uploadMusic error: ${error.message}`);
      return res.status(error.status || 500).json({
        error: error.userMessage || "Failed to upload TikTok music",
        tiktokCode: error.tiktokCode,
      });
    }
  }

  /**
   * List interest-category targeting options for the ad-group targeting step.
   * TikTok API: GET /tool/interest_category/
   */
  async getInterestCategories(req, res) {
    /* #swagger.tags = ['TikTok Ads']
       #swagger.summary = 'List interest-category targeting options'
       #swagger.description = 'Lists interest-category targeting options for the ad-group targeting step. Proxies TikTok Marketing API GET /tool/interest_category/. Cached for REDIS_TTL (2h) per placement+objectiveType — refetch when the objective changes.'
       #swagger.security = [{ "BearerAuth": [] }]
       #swagger.parameters['advertiserId'] = { in: 'query', required: true, description: 'TikTok advertiser (ad account) ID', type: 'string', example: '7012345678901234567' }
       #swagger.parameters['placement'] = { in: 'query', description: 'TikTok placement', type: 'string', example: 'PLACEMENT_TIKTOK' }
       #swagger.parameters['objectiveType'] = { in: 'query', description: 'TikTok campaign objective type', type: 'string', example: 'TRAFFIC' }
       #swagger.responses[200] = {
         description: "Interest categories",
         schema: {
           categories: [{ id: "10000595", name: "Food & Beverage", level: 1, parentId: null }]
         }
       }
       #swagger.responses[400] = { description: "advertiserId is required" }
       #swagger.responses[500] = { description: "Failed to fetch TikTok interest categories" }
    */
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

      // Version segment sits AFTER userId so the disconnect invalidation scan
      // (`tiktokInterests:${userId}:*`) still matches this key.
      const cacheKey = `tiktokInterests:${userId}:v2:${advertiserId}:${placement}:${objectiveType}`;
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
    /* #swagger.tags = ['TikTok Ads']
       #swagger.summary = 'List pixels'
       #swagger.description = 'Lists TikTok pixels for an ad account, used to power conversion-tracking / optimization-event pickers in the wizard. Proxies TikTok Marketing API GET /pixel/list/.'
       #swagger.security = [{ "BearerAuth": [] }]
       #swagger.parameters['advertiserId'] = { in: 'query', required: true, description: 'TikTok advertiser (ad account) ID', type: 'string', example: '7012345678901234567' }
       #swagger.responses[200] = {
         description: "Pixels",
         schema: { status: true, pixels: [{ id: "PIXEL0001", name: "Website Pixel", status: "PIXEL_STATUS_ACTIVE" }] }
       }
       #swagger.responses[400] = { description: "advertiserId is required" }
       #swagger.responses[500] = { description: "Failed to fetch TikTok pixels" }
    */
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
    /* #swagger.tags = ['TikTok Ads']
       #swagger.summary = 'Create a pixel'
       #swagger.description = 'Creates a TikTok pixel for an ad account so the wizard can offer it immediately for conversion-event optimization. Proxies TikTok Marketing API POST /pixel/create/.'
       #swagger.security = [{ "BearerAuth": [] }]
       #swagger.requestBody = {
         required: true,
         content: {
           "application/json": {
             schema: {
               type: "object",
               required: ["advertiserId", "name"],
               properties: {
                 advertiserId: { type: "string", example: "7012345678901234567" },
                 name: { type: "string", example: "Website Pixel" },
                 pixelType: { type: "string", example: "TT_WEB_PIXEL", description: "Defaults to TT_WEB_PIXEL" }
               }
             }
           }
         }
       }
       #swagger.responses[201] = {
         description: "Pixel created",
         schema: { status: true, pixel: { id: "PIXEL0001", name: "Website Pixel", status: "PIXEL_STATUS_ACTIVE" } }
       }
       #swagger.responses[400] = { description: "advertiserId / name is required" }
       #swagger.responses[500] = { description: "Failed to create TikTok pixel" }
    */
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
   * Confirmed via TikTok's official Marketing API docs ("Create a Lead
   * Generation ad with optimization location as Instant Form"): call
   * /page/get/ with business_type=LEAD_GEN to obtain Instant Form page IDs.
   * The form's CONTENT still has to be authored in TikTok's Instant Page
   * Editor (no public API exists for that) — this only discovers/reads pages
   * that already exist. If the account has none yet, or the call fails, fall
   * back to a manual Page ID input instead of erroring.
   */
  async getLeadForms(req, res) {
    /* #swagger.tags = ['TikTok Ads']
       #swagger.summary = 'List Instant Forms (lead generation)'
       #swagger.description = 'Lists TikTok Instant Forms for an ad account, used by the Lead Generation objective in the wizard. Calls the official Marketing API GET /page/get/ endpoint with business_type=LEAD_GEN. The form content itself must still be authored in TikTok Instant Page Editor — no public API exists for creating/editing form content — this only reads existing pages. If TikTok returns 404 or an empty list, responds 200 with an empty list and available:false so the frontend falls back to a manual Page ID input.'
       #swagger.security = [{ "BearerAuth": [] }]
       #swagger.parameters['advertiserId'] = { in: 'query', required: true, description: 'TikTok advertiser (ad account) ID', type: 'string', example: '7012345678901234567' }
       #swagger.parameters['pageId'] = { in: 'query', description: 'Filter to forms on this TikTok Page', type: 'string', example: '70123456789PAGE1' }
       #swagger.responses[200] = {
         description: "Lead forms (or empty list w/ available:false if TikTok returns 404)",
         schema: { status: true, forms: [{ id: "70123456789PAGE1", pageId: "70123456789PAGE1", name: "Contact Us Form", status: "ENABLE" }] }
       }
       #swagger.responses[400] = { description: "advertiserId is required" }
       #swagger.responses[500] = { description: "Failed to fetch TikTok lead forms" }
    */
    try {
      const userId = req.user?.user_id;
      const { advertiserId, pageId } = req.query;
      if (!advertiserId) {
        return res.status(400).json({ error: "advertiserId is required" });
      }

      const accessToken = await getValidAccessToken(userId);
      const params = { advertiser_id: advertiserId, business_type: "LEAD_GEN" };
      if (pageId) params.page_id = pageId;

      const data = await tiktokApiRequest({
        method: "GET",
        endpoint: "/page/get/",
        accessToken,
        params,
      });

      const forms = (data?.data?.list || data?.data?.pages || data?.data?.forms || []).map((f) => ({
        id: String(f.page_id || f.form_id || f.id || ""),
        pageId: String(f.page_id || f.form_id || f.id || ""),
        name: f.page_name || f.form_name || f.name || `Form ${f.page_id || f.id}`,
        status: f.status || f.form_status || f.page_status,
        raw: f,
      }));

      return res.json({ status: true, forms });
    } catch (error) {
      logger.error(
        `TikTok getLeadForms error: ${error.message} | status=${error.status} | tiktokCode=${error.tiktokCode} | raw=${JSON.stringify(
          error.raw
        )}`
      );

      // /page/get/ may 404 for accounts with no Instant Forms yet, or if the
      // app doesn't have this scope enabled. Fall back to the manual Page ID
      // input rather than erroring — the user can still paste an ID created
      // directly in TikTok Ads Manager's Instant Page Editor.
      if (error.status === 404) {
        return res.json({
          status: true,
          forms: [],
          available: false,
          message:
            "No Instant Forms found via /page/get/ for this ad account. Create one in TikTok Ads Manager, then use the manual Page ID fallback.",
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
    /* #swagger.tags = ['TikTok Ads']
       #swagger.summary = 'Get lead submissions'
       #swagger.description = 'Retrieves lead submissions for a TikTok Instant Form (or website lead source). Proxies TikTok Marketing API GET /lead/get/.'
       #swagger.security = [{ "BearerAuth": [] }]
       #swagger.parameters['advertiserId'] = { in: 'query', required: true, description: 'TikTok advertiser (ad account) ID', type: 'string', example: '7012345678901234567' }
       #swagger.parameters['pageId'] = { in: 'query', required: true, description: 'TikTok Page ID the Instant Form belongs to', type: 'string', example: '70123456789PAGE1' }
       #swagger.parameters['leadSource'] = { in: 'query', description: 'Lead source', type: 'string', example: 'INSTANT_FORM' }
       #swagger.parameters['startTime'] = { in: 'query', description: 'Start of the lead submission time range', type: 'string', example: '2026-06-30 00:00:00' }
       #swagger.parameters['endTime'] = { in: 'query', description: 'End of the lead submission time range', type: 'string', example: '2026-07-06 23:59:59' }
       #swagger.parameters['page'] = { in: 'query', description: 'Page number', type: 'integer', example: 1 }
       #swagger.parameters['pageSize'] = { in: 'query', description: 'Page size', type: 'integer', example: 100 }
       #swagger.responses[200] = {
         description: "Leads",
         schema: {
           status: true,
           leads: [{ lead_id: "LEAD0001", create_time: "2026-07-01 12:00:00", field_data: [{ name: "email", value: "jane@example.com" }] }],
           pageInfo: { page: 1, page_size: 100, total_number: 1, total_page: 1 }
         }
       }
       #swagger.responses[400] = { description: "advertiserId / pageId is required" }
       #swagger.responses[500] = { description: "Failed to fetch TikTok leads" }
    */
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
