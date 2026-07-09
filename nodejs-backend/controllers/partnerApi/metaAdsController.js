const bizSdk = require("facebook-nodejs-business-sdk");
const AdAccount = bizSdk.AdAccount;
const { redisClient } = require("../../db/redis");
const logger = require("../../utils/logger");
const {
  formatBudget,
  getCampaignFields,
  getInsightsFields,
  fetchAllPaged,
} = require("../../utils/metaHelpers");

const PARTNER_CACHE_TTL = 900; // 15 min

// Cache key is scoped by req.partner.id (set by requirePartnerApiKey), not
// just adAccountId — two different partners querying the same account ID
// never share a cache entry.

const partnerMetaAdsController = {
  // 1. GET all ad accounts visible to the partner's Meta System User token
  async getAdAccounts(req, res) {
    /* #swagger.tags = ['Partner API']
       #swagger.description = 'List Meta ad accounts visible to the partner-supplied System User token'
       #swagger.parameters['x-api-key'] = {
           in: 'header',
           required: true,
           type: 'string',
           description: 'AdsGPT-issued partner API key (see /admin/partner-api-keys)'
       }
       #swagger.parameters['x-meta-system-user-token'] = {
           in: 'header',
           required: true,
           type: 'string',
           description: 'Meta System User access token supplied by the partner'
       }
       #swagger.security = [{ "PartnerApiKey": [], "MetaSystemUserToken": [] }]
    */
    try {
      const accessToken = req.metaAccessToken;

      const cacheKey = `partnerMetaAdAccounts:${req.partner.id}`;
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        return res.status(200).json(JSON.parse(cached));
      }

      const api = bizSdk.FacebookAdsApi.init(accessToken);
      bizSdk.FacebookAdsApi.setDefaultApi(api);

      const user = new bizSdk.User("me");
      const FIELDS = [
        "id",
        "name",
        "account_status",
        "currency",
        "timezone_name",
        "amount_spent",
      ];

      const adAccounts = await fetchAllPaged(
        user.getAdAccounts(FIELDS, { limit: 100 }),
      );

      const formattedAccounts = adAccounts.map((account) => ({
        id: account.id.replace("act_", ""),
        name: account.name,
        status: account.account_status,
        currency: account.currency,
        timezone: account.timezone_name,
        amountSpent: formatBudget(account.amount_spent, account.currency),
      }));

      const response = {
        status: true,
        adAccounts: formattedAccounts,
        count: formattedAccounts.length,
      };

      await redisClient.set(
        cacheKey,
        JSON.stringify(response),
        "EX",
        PARTNER_CACHE_TTL,
      );

      return res.status(200).json(response);
    } catch (error) {
      logger.error(
        `[partner-api] Get ad accounts error: ${error.response?.data ? JSON.stringify(error.response.data) : error.message}`,
      );
      return res.status(502).json({
        status: false,
        error: "Failed to fetch ad accounts from Meta",
        details: error.response?.data?.error?.message || error.message,
      });
    }
  },

  // 2. GET campaigns for a given ad account
  async getCampaigns(req, res) {
    /* #swagger.tags = ['Partner API']
       #swagger.description = 'List campaigns for a Meta ad account'
       #swagger.parameters['adAccountId'] = { description: 'Meta Ad Account ID (without the act_ prefix)', type: 'string' }
       #swagger.parameters['x-api-key'] = {
           in: 'header',
           required: true,
           type: 'string',
           description: 'AdsGPT-issued partner API key (see /admin/partner-api-keys)'
       }
       #swagger.parameters['x-meta-system-user-token'] = {
           in: 'header',
           required: true,
           type: 'string',
           description: 'Meta System User access token supplied by the partner'
       }
       #swagger.security = [{ "PartnerApiKey": [], "MetaSystemUserToken": [] }]
    */
    try {
      const { adAccountId } = req.query;

      if (!adAccountId) {
        return res
          .status(400)
          .json({ status: false, error: "adAccountId is required" });
      }

      const accessToken = req.metaAccessToken;

      const cacheKey = `partnerMetaCampaigns:${req.partner.id}:${adAccountId}`;
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        return res.status(200).json(JSON.parse(cached));
      }

      const api = bizSdk.FacebookAdsApi.init(accessToken);
      bizSdk.FacebookAdsApi.setDefaultApi(api);

      const account = new AdAccount(`act_${adAccountId}`);
      const { currency } = await account.read(["currency"]);

      const campaigns = await fetchAllPaged(
        account.getCampaigns(getCampaignFields(), { limit: 100 }),
      );

      const formattedCampaigns = campaigns.map((campaign) => ({
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        objective: campaign.objective,
        dailyBudget: formatBudget(campaign.daily_budget, currency),
        lifetimeBudget: formatBudget(campaign.lifetime_budget, currency),
        budgetRemaining: formatBudget(campaign.budget_remaining, currency),
        startTime: campaign.start_time,
        stopTime: campaign.stop_time,
      }));

      const response = {
        status: true,
        campaigns: formattedCampaigns,
        count: formattedCampaigns.length,
      };

      await redisClient.set(
        cacheKey,
        JSON.stringify(response),
        "EX",
        PARTNER_CACHE_TTL,
      );

      return res.status(200).json(response);
    } catch (error) {
      logger.error(
        `[partner-api] Get campaigns error: ${error.response?.data ? JSON.stringify(error.response.data) : error.message}`,
      );
      return res.status(502).json({
        status: false,
        error: "Failed to fetch campaigns from Meta",
        details: error.response?.data?.error?.message || error.message,
      });
    }
  },

  // 3. GET spend for one campaign, or a per-campaign breakdown for the
  // whole account when campaignId is omitted.
  async getCampaignSpend(req, res) {
    /* #swagger.tags = ['Partner API']
       #swagger.description = 'Get spend for a specific campaign, or a per-campaign spend breakdown for the whole ad account if campaignId is omitted'
       #swagger.parameters['adAccountId'] = { description: 'Meta Ad Account ID (without the act_ prefix)', type: 'string' }
       #swagger.parameters['campaignId'] = { description: 'Optional: limit to a single campaign', type: 'string' }
       #swagger.parameters['datePreset'] = { description: 'Date preset for the spend window (default last_30d). One of: today, yesterday, last_3d, last_7d, last_14d, last_28d, last_30d, last_90d, this_month, last_month, this_quarter, last_quarter, this_year, last_year, lifetime, maximum', type: 'string' }
       #swagger.parameters['x-api-key'] = {
           in: 'header',
           required: true,
           type: 'string',
           description: 'AdsGPT-issued partner API key (see /admin/partner-api-keys)'
       }
       #swagger.parameters['x-meta-system-user-token'] = {
           in: 'header',
           required: true,
           type: 'string',
           description: 'Meta System User access token supplied by the partner'
       }
       #swagger.security = [{ "PartnerApiKey": [], "MetaSystemUserToken": [] }]
    */
    try {
      const { adAccountId, campaignId, datePreset } = req.query;

      if (!adAccountId) {
        return res
          .status(400)
          .json({ status: false, error: "adAccountId is required" });
      }

      const accessToken = req.metaAccessToken;
      const resolvedDatePreset = datePreset || "last_30d";

      const cacheKey = `partnerMetaSpend:${req.partner.id}:${adAccountId}:${campaignId || "all"}:${resolvedDatePreset}`;
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        return res.status(200).json(JSON.parse(cached));
      }

      const api = bizSdk.FacebookAdsApi.init(accessToken);
      bizSdk.FacebookAdsApi.setDefaultApi(api);

      const account = new AdAccount(`act_${adAccountId}`);

      const filtering = campaignId
        ? [{ field: "campaign.id", operator: "EQUAL", value: campaignId }]
        : [];

      const insights = await fetchAllPaged(
        account.getInsights(getInsightsFields(), {
          level: "campaign",
          date_preset: resolvedDatePreset,
          limit: 100,
          ...(filtering.length > 0 && { filtering }),
        }),
      );

      const formattedInsights = insights.map((row) => ({
        campaignId: row.campaign_id,
        campaignName: row.campaign_name,
        spend: row.spend || "0",
        impressions: row.impressions || "0",
        clicks: row.clicks || "0",
        cpm: row.cpm || null,
        cpc: row.cpc || null,
        dateStart: row.date_start,
        dateStop: row.date_stop,
      }));

      const response = {
        status: true,
        datePreset: resolvedDatePreset,
        campaigns: formattedInsights,
        count: formattedInsights.length,
      };

      await redisClient.set(
        cacheKey,
        JSON.stringify(response),
        "EX",
        PARTNER_CACHE_TTL,
      );

      return res.status(200).json(response);
    } catch (error) {
      logger.error(
        `[partner-api] Get campaign spend error: ${error.response?.data ? JSON.stringify(error.response.data) : error.message}`,
      );
      return res.status(502).json({
        status: false,
        error: "Failed to fetch campaign spend from Meta",
        details: error.response?.data?.error?.message || error.message,
      });
    }
  },
};

module.exports = partnerMetaAdsController;
