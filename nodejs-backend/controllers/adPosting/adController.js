const bizSdk = require("facebook-nodejs-business-sdk");
const axios = require("axios");
const AdAccount = bizSdk.AdAccount;
const Campaign = bizSdk.Campaign;
const AdSet = bizSdk.AdSet;
const AdCreative = bizSdk.AdCreative;
const Ad = bizSdk.Ad;
const AdImage = bizSdk.AdImage;

const FBUsers = require("../../Module/adPosting/facebookUsers");
const PostedAd = require("../../Module/adPosting/postedAds");
const { decrypt } = require("../../utils/crypto");
const logger = require("../../utils/logger");
const CampaignModel = require("../../Module/adFactory/adFactory");
const {
  invalidateAfterCreate,
  formatMetaError,
} = require("./metaAdLauncher");

class AdController {
  constructor() {
    this.createAd = this.createAd.bind(this);
    this.getAdAccounts = this.getAdAccounts.bind(this);
    this.getCampaigns = this.getCampaigns.bind(this);
    this.getAdSets = this.getAdSets.bind(this);
    this.getInsights = this.getInsights.bind(this);
    this.getDeliveryEstimate = this.getDeliveryEstimate.bind(this);
    this.getPostedAds = this.getPostedAds.bind(this);
    this.getPostedAdInsights = this.getPostedAdInsights.bind(this);
    this.createCampaignAPI = this.createCampaignAPI.bind(this);
    this.createAdSetAPI = this.createAdSetAPI.bind(this);
    this.uploadMediaAPI = this.uploadMediaAPI.bind(this);
    this.createCreativeAPI = this.createCreativeAPI.bind(this);
    this.getCampaign = this.getCampaign.bind(this);
    this.updateCampaign = this.updateCampaign.bind(this);
    this.deleteCampaign = this.deleteCampaign.bind(this);
    this.getAdSet = this.getAdSet.bind(this);
    this.updateAdSet = this.updateAdSet.bind(this);
    this.deleteAdSet = this.deleteAdSet.bind(this);
    this.getAd = this.getAd.bind(this);
    this.updateAd = this.updateAd.bind(this);
    this.deleteAd = this.deleteAd.bind(this);
    this.getCreatives = this.getCreatives.bind(this);
    this.getCreative = this.getCreative.bind(this);
    this.deleteCreative = this.deleteCreative.bind(this);
  }

  /**
   * Create multiple Facebook Ads using Facebook Business SDK
   * Accepts an array of ads, each with its own creative details
   */

  async createAd(req, res) {
    try {
      const parseIfString = (value) => {
        if (!value) return value;
        if (typeof value === "string") {
          try {
            return JSON.parse(value);
          } catch (e) {
            return value;
          }
        }
        return value;
      };

      req.body.campaignDetails = parseIfString(req.body.campaignDetails);
      req.body.adSetDetails = parseIfString(req.body.adSetDetails);
      req.body.ads = parseIfString(req.body.ads);

      const {
        accountId,
        adAccountId,
        pageId,
        campaignDetails,
        adSetDetails,
        ads,
        adFactoryCampaignId,
      } = req.body;

      if (!adFactoryCampaignId) {
        return res.status(400).json({
          error: "adFactoryCampaignId is required",
        });
      }

      if (!accountId) {
        return res.status(400).json({ error: "Account ID is required" });
      }

      if (!ads || !Array.isArray(ads) || ads.length === 0) {
        return res.status(400).json({
          error: "ads array is required and must contain at least one ad",
        });
      }

      // ------------------ FETCH CAMPAIGN ------------------
      const campaignDoc = await CampaignModel.findById(adFactoryCampaignId);
      if (!campaignDoc) {
        return res.status(404).json({
          error: "AdFactory Campaign not found",
        });
      }

      const fbUser = await FBUsers.findById(accountId);
      if (!fbUser) {
        return res.status(404).json({ error: "Facebook user not found" });
      }
      const accessToken = decrypt(fbUser?.accessToken);

      // Validation
      if (!adAccountId || !accessToken || !pageId) {
        return res.status(400).json({
          error: "Ad Account ID, Access Token, and Page ID are required",
        });
      }

      // console.log(`Creating ${ads.length} Facebook Ads...`);
      // console.log("Ad Account:", adAccountId);
      // console.log("Page:", pageId);
      logger.info(
        `Creating ${ads.length} Facebook Ads for Account: ${adAccountId}, Page: ${pageId}`
      );

      // Initialize the Facebook Ads API with the user's access token
      const api = bizSdk.FacebookAdsApi.init(accessToken);
      bizSdk.FacebookAdsApi.setDefaultApi(api);

      const actId = `act_${adAccountId}`;
      const account = new AdAccount(actId);

      // Step 1: Create or Get Campaign (shared across all ads)
      let campaign;
      if (campaignDetails?.campaignId) {
        // console.log(
        //   "Step 1: Using existing campaign:",
        //   campaignDetails?.campaignId
        // );

        logger.info(
          `Step 1: Using existing campaign: ${campaignDetails?.campaignId}`
        );
        campaign = { id: campaignDetails?.campaignId };
      } else {
        // console.log("Step 1: Creating campaign...");
        campaign = await this.createCampaign(
          account,
          campaignDetails?.campaignName,
          campaignDetails?.campaignObjective
        );
        // console.log("Campaign created:", campaign.id);
      }

      // Step 2: Create or Get Ad Set (shared across all ads)
      let adSet;
      if (adSetDetails?.adSetId) {
        // console.log("Step 2: Using existing ad set:", adSetDetails?.adSetId);
        logger.info(`Step 2: Using existing ad set: ${adSetDetails?.adSetId}`);
        adSet = { id: adSetDetails?.adSetId };
      } else {
        // console.log("Step 2: Creating ad set...");
        adSet = await this.createAdSet(
          account,
          campaign.id,
          pageId,
          adSetDetails?.dailyBudget || 1000,
          adSetDetails?.adSetName,
          {
            targeting: adSetDetails?.targeting,
            bidAmount: adSetDetails?.bidAmount,
            billingEvent: adSetDetails?.billingEvent,
            optimizationGoal: adSetDetails?.optimizationGoal,
          }
        );
        // console.log("Ad Set created:", adSet.id);
      }

      // Step 3: Loop through ads array and create each ad
      const createdAds = [];
      const errors = [];

      for (let i = 0; i < ads.length; i++) {
        const adData = ads[i];
        try {
          // console.log(`\nProcessing ad ${i + 1}/${ads.length}...`);
          logger.info(`Step 3 - Processing ad ${i + 1}/${ads.length}...`);

          // Validate ad data
          if (!adData.imageUrl && !adData.imageFile) {
            errors.push({
              index: i,
              error: "imageUrl or imageFile is required",
              adData,
            });
            continue;
          }

          // Step 3a: Upload Image
          // console.log(`  - Uploading image for ad ${i + 1}...`);
          logger.info(`  - Uploading image for ad ${i + 1}...`);
          const imageHash = await this.uploadImage(
            account,
            null, // imageFile (we'll handle this separately if needed)
            adData.imageUrl
          );
          // console.log(`  - Image uploaded, hash: ${imageHash}`);
          logger.info(`  - Image uploaded, hash: ${imageHash}`);

          // Step 3b: Create Ad Creative
          // console.log(`  - Creating creative for ad ${i + 1}...`);
          logger.info(`  - Creating creative for ad ${i + 1}...`);
          const creative = await this.createCreative(
            account,
            pageId,
            imageHash,
            adData.headline || "Check this out!",
            adData.message || "",
            adData.linkUrl || `https://facebook.com/${pageId}`,
            adData.callToAction || "LEARN_MORE",
            adData.description || ""
          );
          // console.log(`  - Creative created: ${creative.id}`);
          logger.info(`  - Creative created: ${creative.id}`);

          // Step 3c: Create Ad
          // console.log(`  - Creating ad ${i + 1}...`);
          logger.info(`  - Creating ad ${i + 1}...`);
          const ad = await this.createAdFromCreative(
            account,
            adSet.id,
            creative.id
          );
          // console.log(`  - Ad created: ${ad.id}`);
          logger.info(`  - Ad created: ${ad.id}`);

          // Step 3d: Save to MongoDB
          await PostedAd.create({
            userId: accountId,
            facebookAdId: ad.id,
            adAccountId: adAccountId,
            campaignId: campaign.id,
            adSetId: adSet.id,
            creativeId: creative.id,
            pageId: pageId,
            status: "PAUSED",
            content: {
              headline: adData.headline,
              message: adData.message,
              linkUrl: adData.linkUrl,
              callToAction: adData.callToAction,
              imageUrl: adData.imageUrl,
            },
            metaData: {
              campaignName: campaignDetails?.campaignName,
              campaignObjective: campaignDetails?.campaignObjective,
              campaignId: campaignDetails?.campaignId || campaign.id,
              adSetId: adSet.id,
              dailyBudget: adSetDetails?.dailyBudget,
            },
            adFactoryCampaignId,
            adFactoryCreativeId: adData?.adFactoryCreativeId || null,
          });

          createdAds.push({
            index: i,
            adId: ad.id,
            creativeId: creative.id,
            imageHash: imageHash,
            headline: adData.headline,
          });
        } catch (error) {
          const meta = formatMetaError(error);
          logger.error(
            `Error creating ad ${i + 1}: ${meta.message}` +
              (meta.code ? ` [code=${meta.code}]` : "") +
              (meta.subcode ? ` [subcode=${meta.subcode}]` : "") +
              (meta.fbtraceId ? ` [fbtrace=${meta.fbtraceId}]` : "")
          );
          errors.push({
            index: i,
            error: meta.message,
            title: meta.title,
            code: meta.code,
            subcode: meta.subcode,
            fbtraceId: meta.fbtraceId,
            adData,
          });
        }
      }

      // ------------------ FINAL CAMPAIGN UPDATE ------------------
      //  FINAL & ONLY METADATA WRITE
      await CampaignModel.findByIdAndUpdate(adFactoryCampaignId, {
        $set: {
          "fbMetaData.adAccountId": adAccountId,
          "fbMetaData.pageId": pageId,
          "fbMetaData.campaignId": campaign.id,
          "fbMetaData.adSetId": adSet.id,
          "fbMetaData.status": "success",
          "fbMetaData.launchedAt": new Date(),
          // status: "success",
        },
      });

      // ------------------ CACHE INVALIDATION ------------------
      // Drop campaign/adset/ad list caches so the user sees the freshly-created
      // entities on their next dashboard / campaigns / adsets / ads fetch.
      // Best-effort — failures here MUST NOT fail the request (the ads are
      // already on Meta). Cache keys are scoped by AdsGPT user_id, NOT the
      // FBUsers _id we got via `accountId`, so we use `fbUser.userId` here.
      try {
        await invalidateAfterCreate(fbUser.userId, {
          adAccountId,
          campaignId: campaign.id,
          adSetId: adSet.id,
        });
      } catch (cacheErr) {
        logger.warn(
          `Cache invalidation after createAd failed (non-fatal): ${cacheErr.message}`,
        );
      }

      // If every ad in the batch failed, surface a non-success response so the
      // frontend doesn't render this as a partial-success state. The first
      // error usually explains the whole batch (e.g. all ads share the same
      // bad campaign objective), so promote it to the top-level message.
      if (createdAds.length === 0 && errors.length > 0) {
        const first = errors[0];
        return res.status(400).json({
          success: false,
          error: first.title
            ? `${first.title}: ${first.error}`
            : first.error || "Failed to create ads",
          message: `Failed to create any of the ${ads.length} ads`,
          data: {
            campaignId: campaign.id,
            adSetId: adSet.id,
            createdAds: [],
            errors,
          },
        });
      }

      return res.json({
        success: true,
        message: `Created ${createdAds.length} out of ${ads.length} ads successfully`,
        data: {
          campaignId: campaign.id,
          adSetId: adSet.id,
          createdAds: createdAds,
          errors: errors.length > 0 ? errors : undefined,
          status: "PAUSED",
          note: "Ads are created in PAUSED state. Activate them in Facebook Ads Manager.",
        },
      });
    } catch (error) {
      const meta = formatMetaError(error);
      logger.error(
        `Create ads error: ${meta.message}` +
          (meta.code ? ` [code=${meta.code}]` : "") +
          (meta.subcode ? ` [subcode=${meta.subcode}]` : "") +
          (meta.fbtraceId ? ` [fbtrace=${meta.fbtraceId}]` : "")
      );
      // Treat OAuth/parameter errors from Meta as 4xx — they're caused by the
      // caller's input (bad token, bad creative, bad targeting) and a 500
      // would mislead the frontend into a "server is broken" message.
      const isClientError =
        error?.status === 400 ||
        error?.status === 401 ||
        error?.status === 403 ||
        meta.type === "OAuthException";
      return res.status(isClientError ? 400 : 500).json({
        success: false,
        error: meta.title ? `${meta.title}: ${meta.message}` : meta.message,
        details: {
          message: meta.message,
          title: meta.title,
          code: meta.code,
          subcode: meta.subcode,
          type: meta.type,
          fbtraceId: meta.fbtraceId,
        },
      });
    }
  }

  async downloadImageAsBuffer(url) {
    const response = await axios.get(url, {
      responseType: "arraybuffer",
      timeout: 10000,
    });
    return Buffer.from(response.data);
  }

  /**
   * Upload image to ad account using SDK
   */
  async uploadImage(account, imageFile, imageUrl) {
    try {
      if (imageFile) {
        // For file upload, we need to use bytes
        const images = await account.createAdImage([], {
          bytes: imageFile.buffer.toString("base64"),
          name: imageFile.originalname || "ad-image.jpg",
        });

        console.log("Image upload response:", JSON.stringify(images));

        // Get the hash from the response
        if (images && images.hash) {
          return images.hash;
        } else if (images && images.images) {
          // Sometimes it's nested in images object
          const imageKey = Object.keys(images.images)[0];
          return images.images[imageKey].hash;
        } else {
          throw new Error("Could not get image hash from response");
        }
      } else {
        const buffer = await this.downloadImageAsBuffer(imageUrl);
        // For URL upload
        const images = await account.createAdImage([], {
          bytes: buffer.toString("base64"),
          name: "ad-image.jpg",
        });

        console.log("Image upload response:", JSON.stringify(images));

        // Get the hash from the response
        if (images && images.hash) {
          return images.hash;
        } else if (images && images.images) {
          const imageKey = Object.keys(images.images)[0];
          return images.images[imageKey].hash;
        } else {
          throw new Error("Could not get image hash from response");
        }
      }
    } catch (error) {
      console.error("Image upload error:", error);
      throw error;
    }
  }

  /**
   * Create Campaign using SDK
   */
  async createCampaign(account, name, objective) {
    const campaign = await account.createCampaign([], {
      name: name || `Traffic Campaign - ${Date.now()}`,
      objective: objective || Campaign.Objective.outcome_traffic,
      status: Campaign.Status.paused,
      special_ad_categories: [],
      is_adset_budget_sharing_enabled: false,
    });

    return campaign;
  }

  /**
   * Create Ad Set using SDK
   */
  async createAdSet(
    account,
    campaignId,
    pageId,
    dailyBudget,
    adSetName,
    options = {}
  ) {
    const {
      targeting = {
        geo_locations: { countries: ["US"] },
        age_min: 18,
        age_max: 65,
      },
      bidAmount = 100,
      billingEvent = AdSet.BillingEvent.impressions,
      optimizationGoal = AdSet.OptimizationGoal.link_clicks,
    } = options;

    const adSet = await account.createAdSet([], {
      name: adSetName || `Ad Set - ${Date.now()}`,
      campaign_id: campaignId,
      daily_budget: dailyBudget,
      billing_event: billingEvent,
      optimization_goal: optimizationGoal,
      // bid_amount: bidAmount,
      bid_strategy: AdSet.BidStrategy.lowest_cost_without_cap,
      targeting: {
        ...targeting,
        targeting_automation: {
          advantage_audience: 1, // 1 (Recommended by Meta), 0 (Strict targeting)
        },
      },
      status: AdSet.Status.paused,
      promoted_object: { page_id: pageId },
    });

    return adSet;
  }

  /**
   * Create Ad Creative using SDK
   */
  async createCreative(
    account,
    pageId,
    imageHash,
    headline,
    message,
    linkUrl,
    callToAction,
    description
  ) {
    const creative = await account.createAdCreative([], {
      name: `Creative - ${Date.now()}`,
      object_story_spec: {
        page_id: pageId,
        link_data: {
          image_hash: imageHash,
          link: linkUrl,
          message: message, // primary text
          name: headline, // headline
          description: description, // description
          call_to_action: {
            type: callToAction,
            value: {
              link: linkUrl,
            },
          },
        },
      },
    });

    return creative;
  }

  /**
   * Create Ad from Creative using SDK
   */
  async createAdFromCreative(account, adSetId, creativeId) {
    const ad = await account.createAd([], {
      name: `Ad - ${Date.now()}`,
      adset_id: adSetId,
      creative: { creative_id: creativeId },
      status: Ad.Status.active,
    });

    return ad;
  }

  /**
   * Get Ad Accounts for a user using SDK
   */
  async getAdAccounts(req, res) {
    try {
      const accountId = req.params.accountId;

      if (!accountId) {
        return res.status(400).json({ error: "Account ID is required" });
      }

      const fbUser = await FBUsers.findById(accountId);
      if (!fbUser) {
        return res.status(404).json({ error: "Facebook user not found" });
      }
      const accessToken = decrypt(fbUser?.accessToken);

      if (!accessToken) {
        return res.status(401).json({ error: "Access token is required" });
      }

      // Initialize API with user's token
      const api = bizSdk.FacebookAdsApi.init(accessToken);
      bizSdk.FacebookAdsApi.setDefaultApi(api);

      // Get user's ad accounts
      const user = new bizSdk.User("me");
      const adAccounts = await user.getAdAccounts([
        "id",
        "name",
        "account_status",
        "currency",
        "timezone_name",
        "amount_spent",
      ]);

      const formattedAccounts = adAccounts.map((account) => ({
        id: account.id.replace("act_", ""),
        name: account.name,
        status: account.account_status,
        currency: account.currency,
        timezone: account.timezone_name,
        amountSpent: account.amount_spent,
      }));

      res.json({
        adAccounts: formattedAccounts,
        count: formattedAccounts.length,
      });
    } catch (error) {
      console.error(
        "Get ad accounts error:",
        error.response?.data || error.message
      );
      res.status(500).json({
        error: "Failed to fetch ad accounts",
        details: error.response?.data?.error?.message || error.message,
      });
    }
  }

  /**
   * Get Campaigns for an Ad Account
   */
  async getCampaigns(req, res) {
    try {
      const { adAccountId, accountId } = req.query;

      if (!accountId) {
        return res.status(400).json({ error: "Account ID is required" });
      }

      const fbUser = await FBUsers.findById(accountId);
      if (!fbUser) {
        return res.status(404).json({ error: "Facebook user not found" });
      }
      const accessToken = decrypt(fbUser?.accessToken);

      if (!adAccountId || !accessToken) {
        return res
          .status(400)
          .json({ error: "Ad Account ID and Access Token are required" });
      }

      // Initialize API
      const api = bizSdk.FacebookAdsApi.init(accessToken);
      bizSdk.FacebookAdsApi.setDefaultApi(api);

      const account = new AdAccount(`act_${adAccountId}`);
      const campaigns = await account.getCampaigns(
        [
          Campaign.Fields.id,
          Campaign.Fields.name,
          Campaign.Fields.status,
          Campaign.Fields.objective,
        ],
        { limit: 50 }
      );

      const formattedCampaigns = campaigns.map((campaign) => ({
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        objective: campaign.objective,
      }));

      res.json({
        campaigns: formattedCampaigns,
        count: formattedCampaigns.length,
      });
    } catch (error) {
      console.error("Get campaigns error:", error);
      res
        .status(500)
        .json({ error: "Failed to fetch campaigns", details: error.message });
    }
  }

  /**
   * Get Ad Sets for an Ad Account or Campaign
   */
  async getAdSets(req, res) {
    try {
      const { adAccountId, accountId, campaignId } = req.query;

      if (!accountId) {
        return res.status(400).json({ error: "Account ID is required" });
      }

      const fbUser = await FBUsers.findById(accountId);
      if (!fbUser) {
        return res.status(404).json({ error: "Facebook user not found" });
      }
      const accessToken = decrypt(fbUser?.accessToken);

      if (!adAccountId || !accessToken) {
        return res
          .status(400)
          .json({ error: "Ad Account ID and Access Token are required" });
      }

      const api = bizSdk.FacebookAdsApi.init(accessToken);
      bizSdk.FacebookAdsApi.setDefaultApi(api);

      let adSets;
      if (campaignId) {
        // Get ad sets for specific campaign
        const campaign = new Campaign(campaignId);
        adSets = await campaign.getAdSets(
          [
            AdSet.Fields.id,
            AdSet.Fields.name,
            AdSet.Fields.status,
            AdSet.Fields.daily_budget,
            AdSet.Fields.campaign_id,
          ],
          { limit: 50 }
        );
      } else {
        // Get all ad sets for account
        const account = new AdAccount(`act_${adAccountId}`);
        adSets = await account.getAdSets(
          [
            AdSet.Fields.id,
            AdSet.Fields.name,
            AdSet.Fields.status,
            AdSet.Fields.daily_budget,
            AdSet.Fields.campaign_id,
          ],
          { limit: 50 }
        );
      }

      const formattedAdSets = adSets.map((adSet) => ({
        id: adSet.id,
        name: adSet.name,
        status: adSet.status,
        dailyBudget: adSet.daily_budget,
        campaignId: adSet.campaign_id,
      }));

      res.json({
        adSets: formattedAdSets,
        count: formattedAdSets.length,
      });
    } catch (error) {
      console.error("Get ad sets error:", error);
      res
        .status(500)
        .json({ error: "Failed to fetch ad sets", details: error.message });
    }
  }

  /**
   * Get Insights (Performance Metrics)
   */
  async getInsights(req, res) {
    try {
      const { adAccountId, accountId, level, datePreset } = req.query;

      if (!accountId) {
        return res.status(400).json({ error: "Account ID is required" });
      }

      const fbUser = await FBUsers.findById(accountId);
      if (!fbUser) {
        return res.status(404).json({ error: "Facebook user not found" });
      }
      const accessToken = decrypt(fbUser?.accessToken);

      if (!adAccountId || !accessToken) {
        return res
          .status(400)
          .json({ error: "Ad Account ID and Access Token are required" });
      }

      const api = bizSdk.FacebookAdsApi.init(accessToken);
      bizSdk.FacebookAdsApi.setDefaultApi(api);

      const account = new AdAccount(`act_${adAccountId}`);

      const fields = [
        "impressions",
        "clicks",
        "spend",
        "cpc",
        "ctr",
        "reach",
        "date_start",
        "date_stop",
      ];

      const params = {
        level: level || "account", // 'account', 'campaign', 'adset', 'ad'
        date_preset: datePreset || "last_30d", // 'today', 'yesterday', 'this_month', 'last_30d'
      };

      const insights = await account.getInsights(fields, params);

      const formattedInsights = insights.map((insight) => ({
        impressions: insight.impressions,
        clicks: insight.clicks,
        spend: insight.spend,
        cpc: insight.cpc,
        ctr: insight.ctr,
        reach: insight.reach,
        dateStart: insight.date_start,
        dateStop: insight.date_stop,
      }));

      res.json({
        insights: formattedInsights,
      });
    } catch (error) {
      console.error("Get insights error:", error);
      res
        .status(500)
        .json({ error: "Failed to fetch insights", details: error.message });
    }
  }

  /**
   * Get Delivery Estimate (Reach/Impressions)
   */
  async getDeliveryEstimate(req, res) {
    try {
      const { adAccountId, accountId, targeting, optimizationGoal } = req.body;

      if (!accountId) {
        return res.status(400).json({ error: "Account ID is required" });
      }

      const fbUser = await FBUsers.findById(accountId);
      if (!fbUser) {
        return res.status(404).json({ error: "Facebook user not found" });
      }
      const accessToken = decrypt(fbUser?.accessToken);

      if (!adAccountId || !accessToken) {
        return res
          .status(400)
          .json({ error: "Ad Account ID and Access Token are required" });
      }

      const api = bizSdk.FacebookAdsApi.init(accessToken);
      bizSdk.FacebookAdsApi.setDefaultApi(api);

      const account = new AdAccount(`act_${adAccountId}`);

      const params = {
        optimization_goal: optimizationGoal || "LINK_CLICKS",
        targeting_spec: targeting || {
          geo_locations: { countries: ["US"] },
          age_min: 18,
          age_max: 65,
        },
      };

      const estimates = await account.getDeliveryEstimate([], params);

      res.json({
        estimates: estimates,
      });
    } catch (error) {
      console.error("Get delivery estimate error:", error);
      res.status(500).json({
        error: "Failed to fetch delivery estimate",
        details: error.message,
      });
    }
  }

  /**
   * Get locally saved posted ads
   */
  async getPostedAds(req, res) {
    try {
      const { accountId } = req.query;
      if (!accountId) {
        return res.status(400).json({ error: "Account ID is required" });
      }

      const ads = await PostedAd.find({ userId: accountId }).sort({
        createdAt: -1,
      });

      res.json({
        success: true,
        count: ads.length,
        ads: ads,
      });
    } catch (error) {
      console.error("Get posted ads error:", error);
      res.status(500).json({ error: "Failed to fetch posted ads" });
    }
  }

  /**
   * Get insights for a specific saved ad
   */
  async getPostedAdInsights(req, res) {
    try {
      const { id } = req.params; // MongoDB ID
      const { accountId } = req.query;

      if (!accountId) {
        return res.status(400).json({ error: "Account ID is required" });
      }

      const postedAd = await PostedAd.findById(id);
      if (!postedAd) {
        return res.status(404).json({ error: "Ad not found in history" });
      }

      const fbUser = await FBUsers.findById(accountId);
      if (!fbUser) {
        return res.status(404).json({ error: "Facebook user not found" });
      }
      const accessToken = decrypt(fbUser?.accessToken);

      const api = bizSdk.FacebookAdsApi.init(accessToken);
      bizSdk.FacebookAdsApi.setDefaultApi(api);

      const ad = new Ad(postedAd.facebookAdId);
      const fields = [
        "impressions",
        "clicks",
        "spend",
        "cpc",
        "ctr",
        "reach",
        "date_start",
        "date_stop",
      ];
      const params = { date_preset: "maximum" };

      const insights = await ad.getInsights(fields, params);

      const formattedInsights = insights.map((insight) => ({
        impressions: insight.impressions,
        clicks: insight.clicks,
        spend: insight.spend,
        cpc: insight.cpc,
        ctr: insight.ctr,
        reach: insight.reach,
        dateStart: insight.date_start,
        dateStop: insight.date_stop,
      }));

      res.json({
        adId: postedAd.facebookAdId,
        insights: formattedInsights,
      });
    } catch (error) {
      console.error("Get posted ad insights error:", error);
      res
        .status(500)
        .json({ error: "Failed to fetch insights", details: error.message });
    }
  }

  // --- Granular APIs ---

  /**
   * API: Create Campaign
   */
  async createCampaignAPI(req, res) {
    try {
      const { adAccountId, accountId, name, objective } = req.body;

      if (!accountId || !adAccountId)
        return res
          .status(400)
          .json({ error: "Account ID and Ad Account ID are required" });

      const fbUser = await FBUsers.findById(accountId);
      if (!fbUser)
        return res.status(404).json({ error: "Facebook user not found" });
      const accessToken = decrypt(fbUser?.accessToken);

      const api = bizSdk.FacebookAdsApi.init(accessToken);
      bizSdk.FacebookAdsApi.setDefaultApi(api);

      const account = new AdAccount(`act_${adAccountId}`);
      const campaign = await this.createCampaign(account, name, objective);

      res.json({ success: true, campaignId: campaign.id, name: name });
    } catch (error) {
      console.error("Create campaign error:", error);
      res
        .status(500)
        .json({ error: "Failed to create campaign", details: error.message });
    }
  }

  /**
   * API: Create Ad Set
   */
  async createAdSetAPI(req, res) {
    try {
      const {
        adAccountId,
        accountId,
        campaignId,
        pageId,
        dailyBudget,
        targeting,
        name,
        status,
      } = req.body;

      if (!accountId || !adAccountId || !campaignId)
        return res.status(400).json({ error: "Missing required fields" });

      const fbUser = await FBUsers.findById(accountId);
      if (!fbUser)
        return res.status(404).json({ error: "Facebook user not found" });
      const accessToken = decrypt(fbUser?.accessToken);

      const api = bizSdk.FacebookAdsApi.init(accessToken);
      bizSdk.FacebookAdsApi.setDefaultApi(api);

      const account = new AdAccount(`act_${adAccountId}`);

      const adSetData = {
        name: name || `Ad Set - ${Date.now()}`,
        campaign_id: campaignId,
        daily_budget: dailyBudget || 1000,
        billing_event: AdSet.BillingEvent.impressions,
        optimization_goal: AdSet.OptimizationGoal.link_clicks,
        bid_amount: 100,
        targeting: targeting || {
          geo_locations: { countries: ["US"] },
          age_min: 18,
          age_max: 65,
        },
        status: status || AdSet.Status.paused,
        promoted_object: { page_id: pageId },
      };

      const adSet = await account.createAdSet([], adSetData);

      res.json({ success: true, adSetId: adSet.id });
    } catch (error) {
      console.error("Create ad set error:", error);
      res
        .status(500)
        .json({ error: "Failed to create ad set", details: error.message });
    }
  }

  /**
   * API: Upload Media
   */
  async uploadMediaAPI(req, res) {
    try {
      const { adAccountId, accountId, imageUrl } = req.body;
      const imageFile = req.file;

      if (!accountId || !adAccountId)
        return res.status(400).json({ error: "Missing required fields" });

      const fbUser = await FBUsers.findById(accountId);
      if (!fbUser)
        return res.status(404).json({ error: "Facebook user not found" });
      const accessToken = decrypt(fbUser?.accessToken);

      const api = bizSdk.FacebookAdsApi.init(accessToken);
      bizSdk.FacebookAdsApi.setDefaultApi(api);

      const account = new AdAccount(`act_${adAccountId}`);
      const imageHash = await this.uploadImage(account, imageFile, imageUrl);

      res.json({ success: true, imageHash: imageHash });
    } catch (error) {
      console.error("Upload media error:", error);
      res
        .status(500)
        .json({ error: "Failed to upload media", details: error.message });
    }
  }

  /**
   * API: Create Ad Creative
   */
  async createCreativeAPI(req, res) {
    try {
      const {
        adAccountId,
        accountId,
        pageId,
        imageHash,
        headline,
        message,
        linkUrl,
        callToAction,
        name,
      } = req.body;

      if (!accountId || !adAccountId || !pageId || !imageHash)
        return res.status(400).json({ error: "Missing required fields" });

      const fbUser = await FBUsers.findById(accountId);
      if (!fbUser)
        return res.status(404).json({ error: "Facebook user not found" });
      const accessToken = decrypt(fbUser?.accessToken);

      const api = bizSdk.FacebookAdsApi.init(accessToken);
      bizSdk.FacebookAdsApi.setDefaultApi(api);

      const account = new AdAccount(`act_${adAccountId}`);

      const creativeData = {
        name: name || `Creative - ${Date.now()}`,
        object_story_spec: {
          page_id: pageId,
          link_data: {
            image_hash: imageHash,
            link: linkUrl || `https://facebook.com/${pageId}`,
            message: message || "",
            name: headline || "Headline",
            call_to_action: { type: callToAction || "LEARN_MORE" },
          },
        },
      };

      const creative = await account.createAdCreative([], creativeData);

      res.json({ success: true, creativeId: creative.id });
    } catch (error) {
      console.error("Create creative error:", error);
      res
        .status(500)
        .json({ error: "Failed to create creative", details: error.message });
    }
  }

  /**
   * API: Create Final Ad
   */
  async createAdAPI(req, res) {
    try {
      const {
        adAccountId,
        accountId,
        adSetId,
        creativeId,
        name,
        status,
        pageId,
        campaignId,
        metaData,
        content,
      } = req.body;

      if (!accountId || !adAccountId || !adSetId || !creativeId)
        return res.status(400).json({ error: "Missing required fields" });

      const fbUser = await FBUsers.findById(accountId);
      if (!fbUser)
        return res.status(404).json({ error: "Facebook user not found" });
      const accessToken = decrypt(fbUser?.accessToken);

      const api = bizSdk.FacebookAdsApi.init(accessToken);
      bizSdk.FacebookAdsApi.setDefaultApi(api);

      const account = new AdAccount(`act_${adAccountId}`);

      const adData = {
        name: name || `Ad - ${Date.now()}`,
        adset_id: adSetId,
        creative: { creative_id: creativeId },
        status: status || Ad.Status.paused,
      };

      const ad = await account.createAd([], adData);

      // Save to MongoDB if context is provided
      if (pageId && campaignId) {
        await PostedAd.create({
          userId: accountId,
          facebookAdId: ad.id,
          adAccountId: adAccountId,
          campaignId: campaignId,
          adSetId: adSetId,
          creativeId: creativeId,
          pageId: pageId,
          status: status || "PAUSED",
          content: content || {},
          metaData: metaData || {},
        });
      }

      res.json({ success: true, adId: ad.id });
    } catch (error) {
      console.error("Create ad error:", error);
      res
        .status(500)
        .json({ error: "Failed to create ad", details: error.message });
    }
  }

  // --- CRUD Operations ---

  // Campaign
  async getCampaign(req, res) {
    try {
      const { id } = req.params;
      const { accountId } = req.query;
      if (!accountId)
        return res.status(400).json({ error: "Account ID is required" });

      const fbUser = await FBUsers.findById(accountId);
      if (!fbUser)
        return res.status(404).json({ error: "Facebook user not found" });
      const accessToken = decrypt(fbUser?.accessToken);

      const api = bizSdk.FacebookAdsApi.init(accessToken);
      bizSdk.FacebookAdsApi.setDefaultApi(api);

      const campaign = new Campaign(id);

      const CAMPAIGN_FIELDS = [
        "id",
        "name",
        "objective",
        "status",
        "effective_status",
        "daily_budget",
        "lifetime_budget",
        "start_time",
        "stop_time",
        "created_time",
      ];

      const ADSET_FIELDS = [
        "id",
        "name",
        "status",
        "effective_status",
        "daily_budget",
        "optimization_goal",
        "billing_event",
        "bid_strategy",
        "targeting",
        "promoted_object",
        "start_time",
        "end_time",
      ];
      const AD_FIELDS = [
        "id",
        "name",
        "status",
        "effective_status",
        "creative",
        "adset_id",
        "campaign_id",
        "created_time",
      ];
      const INSIGHT_FIELDS = [
        "impressions",
        "clicks",
        "spend",
        "reach",
        "ctr",
        "cpc",
        "date_start",
        "date_stop",
      ];

      // 1. Get Campaign Details
      const campaignData = await campaign.get(CAMPAIGN_FIELDS);

      // 2. Get Ad Sets
      const adSets = await campaign.getAdSets(ADSET_FIELDS);

      // 3. Get Ads
      const ads = await campaign.getAds(AD_FIELDS);

      // 4. Get Insights for each Ad
      const adsWithInsights = await Promise.all(
        ads.map(async (ad) => {
          try {
            const insights = await ad.getInsights(INSIGHT_FIELDS, {
              date_preset: "lifetime",
            });

            return {
              ...ad._data,
              insights: insights.length > 0 ? insights[0]._data : null,
            };
          } catch (err) {
            console.error(`Failed to fetch insights for ad ${ad.id}`, err);
            return {
              ...ad._data,
              insights: null,
              error: "Failed to fetch insights",
            };
          }
        })
      );

      // Construct final response
      const result = {
        ...campaignData._data,
        adSets: adSets.map((set) => set._data),
        ads: adsWithInsights,
      };

      res.json(result);
    } catch (error) {
      console.error("Get campaign full details error:", error);
      res.status(500).json({
        error: "Failed to get campaign details",
        details: error.message,
      });
    }
  }

  async updateCampaign(req, res) {
    try {
      const { id } = req.params;
      const { accountId, name, status } = req.body;
      if (!accountId)
        return res.status(400).json({ error: "Account ID is required" });

      const fbUser = await FBUsers.findById(accountId);
      if (!fbUser)
        return res.status(404).json({ error: "Facebook user not found" });
      const accessToken = decrypt(fbUser?.accessToken);

      const api = bizSdk.FacebookAdsApi.init(accessToken);
      bizSdk.FacebookAdsApi.setDefaultApi(api);

      const campaign = new Campaign(id);
      const params = {};
      if (name) params[Campaign.Fields.name] = name;
      if (status) params[Campaign.Fields.status] = status;

      const result = await campaign.update([], params);
      res.json({ success: true, result });
    } catch (error) {
      res
        .status(500)
        .json({ error: "Failed to update campaign", details: error.message });
    }
  }

  async deleteCampaign(req, res) {
    try {
      const { id } = req.params;
      const { accountId } = req.query;
      if (!accountId)
        return res.status(400).json({ error: "Account ID is required" });

      const fbUser = await FBUsers.findById(accountId);
      if (!fbUser)
        return res.status(404).json({ error: "Facebook user not found" });
      const accessToken = decrypt(fbUser?.accessToken);

      const api = bizSdk.FacebookAdsApi.init(accessToken);
      bizSdk.FacebookAdsApi.setDefaultApi(api);

      const campaign = new Campaign(id);
      const result = await campaign.delete();
      res.json({ success: true, result });
    } catch (error) {
      res
        .status(500)
        .json({ error: "Failed to delete campaign", details: error.message });
    }
  }

  // Ad Set
  async getAdSet(req, res) {
    try {
      const { id } = req.params;
      const { accountId } = req.query;
      if (!accountId)
        return res.status(400).json({ error: "Account ID is required" });

      const fbUser = await FBUsers.findById(accountId);
      if (!fbUser)
        return res.status(404).json({ error: "Facebook user not found" });
      const accessToken = decrypt(fbUser?.accessToken);

      const api = bizSdk.FacebookAdsApi.init(accessToken);
      bizSdk.FacebookAdsApi.setDefaultApi(api);

      const adSet = new AdSet(id);
      const result = await adSet.get([
        AdSet.Fields.name,
        AdSet.Fields.status,
        AdSet.Fields.daily_budget,
        AdSet.Fields.targeting,
      ]);
      res.json(result);
    } catch (error) {
      res
        .status(500)
        .json({ error: "Failed to get ad set", details: error.message });
    }
  }

  async updateAdSet(req, res) {
    try {
      const { id } = req.params;
      const { accountId, name, status, dailyBudget } = req.body;
      if (!accountId)
        return res.status(400).json({ error: "Account ID is required" });

      const fbUser = await FBUsers.findById(accountId);
      if (!fbUser)
        return res.status(404).json({ error: "Facebook user not found" });
      const accessToken = decrypt(fbUser?.accessToken);

      const api = bizSdk.FacebookAdsApi.init(accessToken);
      bizSdk.FacebookAdsApi.setDefaultApi(api);

      const adSet = new AdSet(id);
      const params = {};
      if (name) params[AdSet.Fields.name] = name;
      if (status) params[AdSet.Fields.status] = status;
      if (dailyBudget) params[AdSet.Fields.daily_budget] = dailyBudget;

      const result = await adSet.update([], params);
      res.json({ success: true, result });
    } catch (error) {
      res
        .status(500)
        .json({ error: "Failed to update ad set", details: error.message });
    }
  }

  async deleteAdSet(req, res) {
    try {
      const { id } = req.params;
      const { accountId } = req.query;
      if (!accountId)
        return res.status(400).json({ error: "Account ID is required" });

      const fbUser = await FBUsers.findById(accountId);
      if (!fbUser)
        return res.status(404).json({ error: "Facebook user not found" });
      const accessToken = decrypt(fbUser?.accessToken);

      const api = bizSdk.FacebookAdsApi.init(accessToken);
      bizSdk.FacebookAdsApi.setDefaultApi(api);

      const adSet = new AdSet(id);
      const result = await adSet.delete();
      res.json({ success: true, result });
    } catch (error) {
      res
        .status(500)
        .json({ error: "Failed to delete ad set", details: error.message });
    }
  }

  // Ad
  async getAd(req, res) {
    try {
      const { id } = req.params;
      const { accountId } = req.query;
      if (!accountId)
        return res.status(400).json({ error: "Account ID is required" });

      const fbUser = await FBUsers.findById(accountId);
      if (!fbUser)
        return res.status(404).json({ error: "Facebook user not found" });
      const accessToken = decrypt(fbUser?.accessToken);

      const api = bizSdk.FacebookAdsApi.init(accessToken);
      bizSdk.FacebookAdsApi.setDefaultApi(api);

      const ad = new Ad(id);
      const result = await ad.get([
        Ad.Fields.name,
        Ad.Fields.status,
        Ad.Fields.creative,
      ]);
      res.json(result);
    } catch (error) {
      res
        .status(500)
        .json({ error: "Failed to get ad", details: error.message });
    }
  }

  async updateAd(req, res) {
    try {
      const { id } = req.params;
      const { accountId, name, status } = req.body;
      if (!accountId)
        return res.status(400).json({ error: "Account ID is required" });

      const fbUser = await FBUsers.findById(accountId);
      if (!fbUser)
        return res.status(404).json({ error: "Facebook user not found" });
      const accessToken = decrypt(fbUser?.accessToken);

      const api = bizSdk.FacebookAdsApi.init(accessToken);
      bizSdk.FacebookAdsApi.setDefaultApi(api);

      const ad = new Ad(id);
      const params = {};
      if (name) params[Ad.Fields.name] = name;
      if (status) params[Ad.Fields.status] = status;

      const result = await ad.update([], params);
      res.json({ success: true, result });
    } catch (error) {
      res
        .status(500)
        .json({ error: "Failed to update ad", details: error.message });
    }
  }

  async deleteAd(req, res) {
    try {
      const { id } = req.params;
      const { accountId } = req.query;
      if (!accountId)
        return res.status(400).json({ error: "Account ID is required" });

      const fbUser = await FBUsers.findById(accountId);
      if (!fbUser)
        return res.status(404).json({ error: "Facebook user not found" });
      const accessToken = decrypt(fbUser?.accessToken);

      const api = bizSdk.FacebookAdsApi.init(accessToken);
      bizSdk.FacebookAdsApi.setDefaultApi(api);

      const ad = new Ad(id);
      const result = await ad.delete();
      res.json({ success: true, result });
    } catch (error) {
      res
        .status(500)
        .json({ error: "Failed to delete ad", details: error.message });
    }
  }

  // Creative
  async getCreatives(req, res) {
    try {
      const { adAccountId, accountId } = req.query;
      if (!accountId || !adAccountId)
        return res
          .status(400)
          .json({ error: "Account ID and Ad Account ID are required" });

      const fbUser = await FBUsers.findById(accountId);
      if (!fbUser)
        return res.status(404).json({ error: "Facebook user not found" });
      const accessToken = decrypt(fbUser?.accessToken);

      const api = bizSdk.FacebookAdsApi.init(accessToken);
      bizSdk.FacebookAdsApi.setDefaultApi(api);

      const account = new AdAccount(`act_${adAccountId}`);
      const creatives = await account.getAdCreatives([
        AdCreative.Fields.name,
        AdCreative.Fields.id,
        AdCreative.Fields.object_story_spec,
      ]);

      const formattedCreatives = creatives.map((c) => ({
        id: c.id,
        name: c.name,
        thumbnail: c.thumbnail_url,
      }));

      res.json({ creatives: formattedCreatives });
    } catch (error) {
      res
        .status(500)
        .json({ error: "Failed to get creatives", details: error.message });
    }
  }

  async getCreative(req, res) {
    try {
      const { id } = req.params;
      const { accountId } = req.query;
      if (!accountId)
        return res.status(400).json({ error: "Account ID is required" });

      const fbUser = await FBUsers.findById(accountId);
      if (!fbUser)
        return res.status(404).json({ error: "Facebook user not found" });
      const accessToken = decrypt(fbUser?.accessToken);

      const api = bizSdk.FacebookAdsApi.init(accessToken);
      bizSdk.FacebookAdsApi.setDefaultApi(api);

      const creative = new AdCreative(id);
      const result = await creative.get([
        AdCreative.Fields.name,
        AdCreative.Fields.object_story_spec,
      ]);
      res.json(result);
    } catch (error) {
      res
        .status(500)
        .json({ error: "Failed to get creative", details: error.message });
    }
  }

  async deleteCreative(req, res) {
    try {
      const { id } = req.params;
      const { accountId } = req.query;
      if (!accountId)
        return res.status(400).json({ error: "Account ID is required" });

      const fbUser = await FBUsers.findById(accountId);
      if (!fbUser)
        return res.status(404).json({ error: "Facebook user not found" });
      const accessToken = decrypt(fbUser?.accessToken);

      const api = bizSdk.FacebookAdsApi.init(accessToken);
      bizSdk.FacebookAdsApi.setDefaultApi(api);

      const creative = new AdCreative(id);
      const result = await creative.delete();
      res.json({ success: true, result });
    } catch (error) {
      res
        .status(500)
        .json({ error: "Failed to delete creative", details: error.message });
    }
  }
}

module.exports = new AdController();
