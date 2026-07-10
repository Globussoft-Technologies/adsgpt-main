/**
 * adsFactoryAutoOrchestrator — core runner for each Auto-Pilot tick.
 *
 * Platform-driven: reads job.targets.<platform> and dispatches to the
 * matching poster in PLATFORM_POSTERS. Adding a new platform = add one
 * entry to PLATFORM_POSTERS. Nothing else changes.
 *
 * Meta posting uses the same shared functions as adControllerV2.createAdV2:
 *  uploadImageFromUrl()      → controllers/adPosting/adControllerV2.js
 *  inferCellForMetaCampaign() → controllers/adPosting/cellInference.js
 *  buildObjectStorySpec()    → utils/objectStorySpec.js
 *  invalidateAfterCreate()   → controllers/adPosting/metaAdLauncher.js
 */

const { v4: uuidv4 } = require("uuid");
const bizSdk         = require("facebook-nodejs-business-sdk");
const AdAccount      = bizSdk.AdAccount;
const Campaign       = require("../../Module/adFactory/adFactory");
const AdsFactoryJob  = require("../../Module/adsFactoryAuto/adsFactoryAutoJob");
const FBUsers        = require("../../Module/adPosting/facebookUsers");
const PostedAd       = require("../../Module/adPosting/postedAds");
const logger         = require("../../utils/logger");
const UnifiedCreditController = require("../../controllers/UnifiedCreditController");
const { buildObjectStorySpec }                   = require("../../utils/objectStorySpec");
const { inferCellForMetaCampaign }               = require("../../controllers/adPosting/cellInference");
const { invalidateAfterCreate }                  = require("../../controllers/adPosting/metaAdLauncher");
const { invalidateAllUserGoogleCache }           = require("../../controllers/adPosting/googleAdController");
const { decrypt }                                = require("../../utils/crypto");
const { uploadImageFromUrl }                     = require("../../controllers/adPosting/adControllerV2");

function adFactoryCtrl() { return require("../../controllers/adFactory"); }

const _runningJobs = new Set();

// ─── Platform Posters Registry ────────────────────────────────────────────────
// Each entry:
//   isConfigured(target) → bool   has the user filled in the required fields?
//   post(target, job, creatives)  → { adId: string }
//
// To add a new platform:
//   1. Add its target schema to the model + validation
//   2. Add one entry here — nothing else changes

const PLATFORM_POSTERS = {
  meta: {
    isConfigured: (target) => {
      const validPage = !!target?.template?.pageId || !!target?.template?.payload?.pageId;
      const validAdAccount = !!target?.template?.payload?.adAccountId;
      const hasTemplate = !!target?.template;
      return !!(validAdAccount && validPage && hasTemplate);
    },

    // isConfigured only checks the saved template has the required fields
    // filled in — it says nothing about whether the user's Facebook account
    // is actually linked right now. Checked separately (and cheaply, before
    // spending a generation cycle) so an unlinked account is skipped instead
    // of failing the whole run every single tick.
    isConnected: async (job) => {
      const rawFbUserId = job.userId?.includes("-") ? job.userId.split("-").slice(1).join("-") : job.userId;
      const fbUser = await FBUsers.findOne({ $or: [{ userId: job.userId }, { userId: rawFbUserId }] }).lean();
      if (!fbUser) return false;
      try {
        return !!decrypt(fbUser.accessToken);
      } catch {
        return false;
      }
    },

    post: async (target, job, creatives, campaign) => {
      const { template } = target;

      if (!template || !template.payload) {
        throw new Error("No template configured on this job — targets.meta.template is required");
      }

      const adAccountId = template.payload.adAccountId;
      if (!adAccountId) {
        throw new Error("Template payload is missing adAccountId");
      }

      // job.userId may be prefixed e.g. "GPT-438" — FBUsers stores the raw numeric part
      const rawFbUserId = job.userId?.includes("-") ? job.userId.split("-").slice(1).join("-") : job.userId;
      const fbUser = await FBUsers.findOne({ $or: [{ userId: job.userId }, { userId: rawFbUserId }] });
      if (!fbUser) throw new Error(`No Facebook account linked for user ${job.userId}`);
      const accessToken = decrypt(fbUser.accessToken);
      if (!accessToken) throw new Error("Facebook access token is missing");

      // We still need bizSdk for uploading images since the V2 controller doesn't handle pure image upload natively for us
      const api = bizSdk.FacebookAdsApi.init(accessToken);
      bizSdk.FacebookAdsApi.setDefaultApi(api);
      const account = new AdAccount(`act_${adAccountId}`);

      let createdAdIds = [];
      const creativeAdMap = {};
      let usedCampaignId = null;
      let usedAdSetId = null;
      let pageId = null;
      let leadFormId = null;

      // Helper to cleanly mock Express req/res and execute the V2 controllers locally
      const metaAdControllerV2 = require("../../controllers/adPosting/metaAdLauncherV2");
      const executeController = async (controllerFn, body) => {
        const req = { body, user: { user_id: job.userId } };
        let statusCode = 200;
        let responseData = null;
        const res = {
          status: (code) => { statusCode = code; return res; },
          json: (data) => { responseData = data; return res; }
        };
        await controllerFn(req, res);
        if (statusCode >= 400) {
          throw new Error(responseData?.error || responseData?.details || JSON.stringify(responseData));
        }
        return responseData;
      };

      // ── Create Campaign & AdSet from Template (Runs EVERY cycle) ──────────────
      logger.info(`[adsFactoryAuto:meta] Template mode — calling V2 create APIs internally`);
      
      // 1. Call createCampaignV2
      // Strip fields that belong to the template/wizard context but are not
      // accepted by the campaign Joi schema (conversionLocation, objective live
      // on template root, not payload; adSetId/adId are ad-level only).
      const p = template.payload || {};

      // Save ad-level / adset-level fields for later steps
      const _cl          = p.conversionLocation;
      const _pg          = p.pageId;
      const _lf          = p.leadFormId;
      const _cta         = p.callToAction;
      const _lu          = p.linkUrl;

      // Campaign schema whitelist — only these fields are accepted by createCampaignV2
      const CAMPAIGN_FIELDS = [
        "adAccountId", "name", "objective", "specialAdCategories",
        "specialAdCategoryCountries", "dailyBudget", "lifetimeBudget",
        "bidStrategy", "spendCap", "iosOptimised", "applicationId",
        "objectStoreUrl", "mobileAppStore", "status",
      ];
      const cleanPayload = Object.fromEntries(
        CAMPAIGN_FIELDS.filter((k) => p[k] !== undefined).map((k) => [k, p[k]])
      );

      // Reconstruct targeting from flat payload if necessary
      const extractedTargeting = p.targeting || {
        worldwide: p.worldwide ?? true,
        locations: p.locations || [],
        ageMin: p.ageMin,
        ageMax: p.ageMax,
        genders: p.genders,
        locales: p.locales,
        advantageAudience: p.advantageAudience,
        publisherPlatforms: p.publisherPlatforms,
        devicePlatforms: p.devicePlatforms,
      };
      // Clean up undefined fields
      Object.keys(extractedTargeting).forEach(k => extractedTargeting[k] === undefined && delete extractedTargeting[k]);

      let derivedSpecialAdCategoryCountries = cleanPayload.specialAdCategoryCountries || p.specialAdCategoryCountries || [];
      const hasRealSpecialCategory = cleanPayload.specialAdCategories?.length && !cleanPayload.specialAdCategories.includes("NONE");

      if (hasRealSpecialCategory && derivedSpecialAdCategoryCountries.length === 0) {
        // Infer from targeting locations
        const locs = extractedTargeting.locations || [];
        derivedSpecialAdCategoryCountries = locs.filter(l => l.type === "country" && l.key).map(l => l.key);
      }

      const campaignPayload = {
        ...cleanPayload,
        name: p.name || p.campaignName || "Auto",
        // If specialAdCategories is empty or not set, ensure specialAdCategoryCountries is also cleared
        // to avoid Meta rejecting the adSet for location/country mismatch
        specialAdCategories: cleanPayload.specialAdCategories?.length ? cleanPayload.specialAdCategories : ["NONE"],
        specialAdCategoryCountries: cleanPayload.specialAdCategories?.length ? derivedSpecialAdCategoryCountries : [],
        // Autopilot-created campaigns always go live — ignore the template's
        // saved status (which defaults to PAUSED for manual wizard use).
        status: "ACTIVE",
      };

      if (p.cbo && p.campaignBudget) {
        if (p.campaignBudgetType === "daily") campaignPayload.dailyBudget = Number(p.campaignBudget) * 100;
        else if (p.campaignBudgetType === "lifetime") campaignPayload.lifetimeBudget = Number(p.campaignBudget) * 100;
      }

      if (p.spendCap != null && p.spendCap !== "") {
        campaignPayload.spendCap = Number(p.spendCap) * 100;
      } else {
        delete campaignPayload.spendCap;
      }
      // Reuse the campaign created on this job's first successful run — every
      // subsequent run only adds a new ad set + ads under the same campaign.
      if (target.createdCampaignId) {
        usedCampaignId = target.createdCampaignId;
        logger.info(`[adsFactoryAuto:meta] reusing existing campaign from prior run  campaignId=${usedCampaignId}`);
      } else {
        const campaignRes = await executeController(metaAdControllerV2.createCampaignV2, campaignPayload);
        usedCampaignId = campaignRes.campaign.id;

        await AdsFactoryJob.updateOne(
          { _id: job._id },
          { $set: { "targets.meta.createdCampaignId": usedCampaignId } }
        );
        logger.info(`[adsFactoryAuto:meta] created new campaign  campaignId=${usedCampaignId}  (saved for reuse on future runs)`);
      }

      // 2. Call createAdSetV2 — whitelist only the fields accepted by buildAdSetSchemaV2
      // Base fields always accepted by buildAdSetSchemaV2 regardless of cell
      const ADSET_FIELDS = [
        "adAccountId", "instagramUserId", "dailyBudget", "lifetimeBudget",
        "dynamicCreative", "attributionWindow", "optimizationGoal", "billingEvent",
        "bidStrategy", "bidAmount", "startTime", "endTime",
        "dsaBeneficiary", "dsaPayor", "savedAudienceId", "targeting", "status",
      ];
      // Cell-specific fields — only include if the cell's additionalFields allows them
      const { getCell } = require("../../config/wizardSchema");
      const _cell = getCell(template.objective, template.conversionLocation);
      const cellExtraFields = (_cell?.adSet?.additionalFields || []).map((f) => f.name || f);
      const ALL_ADSET_FIELDS = [...ADSET_FIELDS, ...cellExtraFields];
      const adSetBase = Object.fromEntries(ALL_ADSET_FIELDS.filter((k) => p[k] !== undefined).map((k) => [k, p[k]]));
      // Coerce numeric fields that may be stored as strings in the template
      if (adSetBase.bidAmount != null)      adSetBase.bidAmount      = Math.round(Number(adSetBase.bidAmount) * 100) || undefined;
      
      // If we are NOT using CBO, grab the ad set budget from the template fields
      if (!p.cbo && p.adSetBudget) {
        if (p.adSetBudgetType === "daily") adSetBase.dailyBudget = Number(p.adSetBudget) * 100;
        else if (p.adSetBudgetType === "lifetime") adSetBase.lifetimeBudget = Number(p.adSetBudget) * 100;
      } else if (p.cbo) {
        delete adSetBase.dailyBudget;
        delete adSetBase.lifetimeBudget;
      } else {
        if (adSetBase.dailyBudget != null)    adSetBase.dailyBudget    = Number(adSetBase.dailyBudget) * 100    || undefined;
        if (adSetBase.lifetimeBudget != null) adSetBase.lifetimeBudget = Number(adSetBase.lifetimeBudget) * 100 || undefined;
      }

      if (adSetBase.spendCap != null)       adSetBase.spendCap       = Number(adSetBase.spendCap)       || undefined;
      
      // Remove empty strings for enum fields that don't support them
      ["bidStrategy", "billingEvent", "optimizationGoal"].forEach(k => {
        if (adSetBase[k] === "") delete adSetBase[k];
      });
      if (campaignPayload.bidStrategy === "") delete campaignPayload.bidStrategy;

      // Coerce date fields — ensure ISO 8601 format or drop them
      for (const dateField of ["startTime", "endTime"]) {
        if (adSetBase[dateField] != null) {
          const d = new Date(adSetBase[dateField]);
          adSetBase[dateField] = isNaN(d.getTime()) ? undefined : d.toISOString();
        }
      }

      // If specialAdCategoryCountries is present, we cannot use worldwide targeting.
      let finalTargeting = adSetBase.targeting || extractedTargeting;
      if (finalTargeting.worldwide && derivedSpecialAdCategoryCountries && derivedSpecialAdCategoryCountries.length > 0) {
        finalTargeting = { locations: derivedSpecialAdCategoryCountries.map(c => ({ type: "country", key: c, mode: "include" })) };
      }

      // Each run creates a fresh ad set under the same reused campaign, so the
      // name must be unique per run — Meta rejects/confuses duplicate ad set
      // names within the same campaign over time, same issue as Google ad groups.
      const metaRunNumber = (job.totalRuns || 0) + 1;
      const metaRunDateLabel = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
      const baseAdSetName = p.name || p.adSetName || p.campaignName || "Auto";
      const adSetPayload = {
        ...adSetBase,
        adAccountId: p.adAccountId,
        name: `${baseAdSetName} - Run ${metaRunNumber} (${metaRunDateLabel})`,
        campaignId: usedCampaignId,
        // objective + conversionLocation live on template root, not payload — required by adSet Joi schema
        objective:          template.objective          || p.objective          || undefined,
        conversionLocation: template.conversionLocation || p.conversionLocation || undefined,
        // pageId required by adSet schema
        pageId: _pg || p.pageId || undefined,
        // targeting is required by adSet Joi schema
        targeting: finalTargeting,
        // Autopilot-created ad sets always go live — overrides adSetBase's
        // status (which came from the template's saved PAUSED default).
        status: "ACTIVE",
      };
      const adSetRes = await executeController(metaAdControllerV2.createAdSetV2, adSetPayload);
      usedAdSetId = adSetRes.adSet.id;
      pageId = _pg;
      leadFormId = _lf;

      const cellInfo = {
        objective: template.objective,
        conversionLocation: template.conversionLocation,
        cell: _cell,
        applicationId: template.payload.applicationId || null,
        objectStoreUrl: template.payload.objectStoreUrl || null
      };

      // We have usedCampaignId, and cellInfo. We now create ads for creatives.
      // Loop all valid creatives.
      const creativesToProcess = creatives.filter(c => c.imageUrl);
      
      if (creativesToProcess.length === 0) {
        throw new Error("No valid creatives available (missing images)");
      }

      for (let i = 0; i < creativesToProcess.length; i++) {
        const creative = creativesToProcess[i];
        
        logger.debug(`[adsFactoryAuto:meta] creative[${i}] uploading image  url="${(creative.imageUrl || "").slice(0, 120)}"`);
        const imageHash = await uploadImageFromUrl(account, creative.imageUrl);
        logger.debug(`[adsFactoryAuto:meta] creative[${i}] image uploaded  hash=${imageHash}`);
        const adName = p.adName || p.name || p.campaignName || `Ad ${i+1}`;
        const adPayload = {
          adAccountId: p.adAccountId,
          name: adName,
          adSetId: usedAdSetId,
          objective: template.objective || p.objective || undefined,
          conversionLocation: template.conversionLocation || p.conversionLocation || undefined,
          pageId: _pg,
          // Autopilot-created ads always go live.
          status: "ACTIVE",
          ...(p.instagramUserId ? { instagramUserId: p.instagramUserId } : {}),
          imageHash: imageHash,
          headline: (creative.headline || "").slice(0, 40),
          primaryText: (creative.message || "").slice(0, 125),
          description: (creative.description || "").slice(0, 30),
          // Meta's own template CTA takes priority — creative.callToAction
          // is shared across platforms and may have been built from a
          // DIFFERENT platform's CTA vocabulary (e.g. Google's VISIT_SITE,
          // which Meta rejects since it's not in Meta's enum).
          callToAction: _cta || creative.callToAction || "LEARN_MORE",
          linkUrl: creative.linkUrl || _lu || "",
          ...((_lf) ? { leadFormId: _lf } : {}),
          ...(p.applicationId ? { applicationId: p.applicationId } : {}),
          ...(p.objectStoreUrl ? { objectStoreUrl: p.objectStoreUrl } : {}),
        };

        const adRes = await executeController(metaAdControllerV2.createAdV2, adPayload);
        const adId = adRes.ad.id;
        const creativeId = adRes.creative.id;

        createdAdIds.push(adId);
        creativeAdMap[creative.creativeId] = adId;

        // Persist PostedAd for this creative
        await PostedAd.create({
          userId:       fbUser._id.toString(),
          facebookAdId: adId,
          adAccountId,
          campaignId:   usedCampaignId,
          adSetId:      usedAdSetId,
          creativeId:   creativeId,
          pageId,
          status:       "ACTIVE",
          content: {
            headline:     creative.headline,
            message:      creative.message,
            linkUrl:      creative.linkUrl,
            callToAction: template.payload.callToAction || creative.callToAction || "LEARN_MORE",
            imageUrl:     creative.imageUrl || null,
          },
          metaData: { objective: cellInfo.objective, conversionLocation: cellInfo.conversionLocation, campaignId: usedCampaignId, adSetId: usedAdSetId, leadFormId: leadFormId || undefined },
          adFactoryCampaignId: campaign._id.toString(),
        });
      }

      try {
        await invalidateAfterCreate(fbUser.userId, { adAccountId, campaignId: usedCampaignId });
      } catch (e) {
        logger.warn(`[adsFactoryAuto:meta] cache invalidation failed (non-fatal): ${e.message}`);
      }

      logger.info(`[adsFactoryAuto:meta] created ${createdAdIds.length} ad(s).`);
      return { adId: createdAdIds.join(","), creativeAdMap, campaignId: usedCampaignId, adSetId: usedAdSetId };
    },
  },

  // ─── Google poster ────────────────────────────────────────────────────────
  // Mirrors the Meta poster pattern exactly:
  //   1. executeController mocks req/res and calls Google controller fns internally
  //   2. Campaign → Ad Group → Ads (one per creative)
  //   3. Cache invalidated after posting
  google: {
    isConfigured: (target) => {
      const validCustomer = !!(
        target?.template?.payload?.adAccountId ||
        target?.template?.customerId ||
        target?.template?.payload?.customerId
      );
      return !!(validCustomer && target?.template);
    },

    // Same rationale as Meta's isConnected — isConfigured only reflects the
    // saved template, not whether the Google account is actually linked.
    isConnected: async (job) => {
      const GoogleUsers = require("../../Module/adPosting/googleUsers");
      const googleUser = await GoogleUsers.findOne({ userId: job.userId }).lean();
      if (!googleUser) return false;
      try {
        const { decrypt: decryptToken } = require("../../utils/crypto");
        return !!decryptToken(googleUser.refreshToken);
      } catch {
        return false;
      }
    },

    post: async (target, job, creatives) => {
      const { template } = target;
      if (!template?.payload) {
        throw new Error("No template configured — targets.google.template is required");
      }

      const p          = template.payload;
      const customerId = p.adAccountId || template.customerId || p.customerId;
      if (!customerId) throw new Error("Google template payload is missing adAccountId / customerId");

      // initGoogleApiForUser looks up GoogleUsers by the full userId (e.g. "GPT-438")
      // — do NOT strip the prefix here; use the full job.userId as-is.
      const googleUserId = job.userId;
      // For invalidateAllUserGoogleCache we use the raw numeric part
      const rawGoogleUserId = job.userId?.includes("-") ? job.userId.split("-").slice(1).join("-") : job.userId;

      const googleAdController = require("../../controllers/adPosting/googleAdController");

      // Same mock-req/res helper as the Meta poster
      const executeController = async (controllerFn, body) => {
        const req = { body, user: { user_id: googleUserId } };
        let statusCode = 200;
        let responseData = null;
        const res = {
          status: (code) => { statusCode = code; return res; },
          json:   (data)  => { responseData = data; return res; },
        };
        await controllerFn.call(googleAdController, req, res);
        if (statusCode >= 400) {
          throw new Error(responseData?.error || responseData?.details || JSON.stringify(responseData));
        }
        return responseData;
      };

      logger.info(`[adsFactoryAuto:google] Template mode — calling Google create APIs internally`);

      // Resolve the effective channel type from the template.
      // payload.destination is the wizard step-2 value (SEARCH, DISPLAY, PERFORMANCE_MAX, etc.)
      // payload.objective or template.objective is the step-1 business goal (SALES, LEADS, etc.)
      // When destination is a raw channel type, use it directly. Otherwise derive from business goal.
      const destination  = (p.destination || "").toUpperCase();
      const bizObjective = (template.objective || p.objective || "").toUpperCase();

      // Map business objective → effective channel when no explicit destination set
      const BIZ_TO_CHANNEL = {
        SALES: "SEARCH", LEADS: "SEARCH", WEBSITE_TRAFFIC: "SEARCH", LOCAL_STORE: "SEARCH",
        APP_PROMOTION: "APP_PROMOTION", YOUTUBE_REACH: "YOUTUBE_REACH",
      };
      const RAW_CHANNELS = new Set([
        "SEARCH", "DISPLAY", "SHOPPING", "PERFORMANCE_MAX",
        "VIDEO", "DEMAND_GEN", "YOUTUBE_REACH", "APP_PROMOTION", "MULTI_CHANNEL",
      ]);
      const effectiveChannel = RAW_CHANNELS.has(destination)
        ? destination
        : BIZ_TO_CHANNEL[bizObjective] || "SEARCH";

      logger.info(`[adsFactoryAuto:google] effectiveChannel=${effectiveChannel}  destination="${destination}"  bizObjective="${bizObjective}"`);

      // PERFORMANCE_MAX and SHOPPING: campaign-only, no ad group / ad creation.
      // APP_PROMOTION (MULTI_CHANNEL): campaign-only — app assets handled by Google automatically.
      const isCampaignOnly = ["PERFORMANCE_MAX", "SHOPPING", "APP_PROMOTION", "MULTI_CHANNEL"].includes(effectiveChannel);

      // ── 1. Create campaign ────────────────────────────────────────────────
      const CAMPAIGN_FIELDS = [
        "adAccountId", "customerId", "name", "objective",
        "dailyBudgetMicros", "lifetimeBudgetMicros", "budgetType", "status", "startTime", "endTime",
        "targeting", "objectiveExtras", "euPoliticalAds",
      ];
      const campaignBase = Object.fromEntries(
        CAMPAIGN_FIELDS.filter((k) => p[k] !== undefined).map((k) => [k, p[k]])
      );
      const campaignPayload = {
        ...campaignBase,
        adAccountId: customerId,
        ...(p.name || p.campaignName ? { name: p.name || p.campaignName } : {}),
        // Use destination as the objective when it's a raw channel type (e.g. PERFORMANCE_MAX, SHOPPING)
        // otherwise use the business objective (SALES, LEADS, etc.) — controller maps both correctly
        ...(destination && RAW_CHANNELS.has(destination)
          ? { objective: destination }
          : bizObjective ? { objective: bizObjective } : {}),
        // Autopilot-created campaigns always go live — ignore the template's
        // saved status (which defaults to PAUSED for manual wizard use).
        status: "ENABLED",
      };

      // Reuse the campaign created on this job's first successful run — every
      // subsequent run only adds a new ad group + ads under the same campaign.
      let googleCampaignId = target.createdCampaignId;
      if (!googleCampaignId) {
        try {
          const campaignRes = await executeController(googleAdController.createCampaignAPI, campaignPayload);
          // Controller returns { campaign: { campaignId, ... } }
          googleCampaignId = campaignRes?.campaign?.campaignId || campaignRes?.campaign?.id || campaignRes?.campaignId;
          if (!googleCampaignId) throw new Error("Google campaign creation did not return a campaignId");
          logger.info(`[adsFactoryAuto:google] created new campaign  campaignId=${googleCampaignId}  (saved for reuse on future runs)`);
        } catch (createErr) {
          // A prior run for THIS job can have created the campaign but never
          // persisted createdCampaignId (e.g. the process was killed by a
          // server restart between Google confirming creation and the
          // updateOne below). The retry then tries to recreate it under the
          // same name and Google rejects the duplicate. Recover by looking
          // up the existing campaign by name and adopting it, instead of
          // failing the whole run.
          if (/campaign with this name already exists/i.test(createErr.message)) {
            logger.warn(`[adsFactoryAuto:google] campaign name collision — looking up existing campaign "${campaignPayload.name}" to recover`);
            const found = await executeController(googleAdController.findCampaignByNameAPI, {
              adAccountId: customerId,
              name: campaignPayload.name,
            });
            if (!found?.campaignId) throw createErr; // genuine collision with an unrelated campaign — surface the original error

            // Safety check: createdCampaignId is unique per job in this DB —
            // if another job already claims this campaign ID, the name
            // collision is with a genuinely different job's campaign (e.g.
            // two jobs reusing the same generic template name), not this
            // job's own lost campaign. Adopting it would silently hijack
            // another job's campaign, so refuse and surface the original error.
            const claimedByOther = await AdsFactoryJob.findOne({
              _id: { $ne: job._id },
              "targets.google.createdCampaignId": found.campaignId,
            }).select("_id").lean();
            if (claimedByOther) {
              logger.error(`[adsFactoryAuto:google] campaign ${found.campaignId} is already owned by job ${claimedByOther._id} — refusing to adopt, this is an unrelated name collision`);
              throw createErr;
            }

            googleCampaignId = found.campaignId;
            logger.info(`[adsFactoryAuto:google] recovered existing campaign  campaignId=${googleCampaignId}  (adopted after name collision)`);
          } else {
            throw createErr;
          }
        }

        await AdsFactoryJob.updateOne(
          { _id: job._id },
          { $set: { "targets.google.createdCampaignId": googleCampaignId } }
        );
      } else {
        logger.info(`[adsFactoryAuto:google] reusing existing campaign from prior run  campaignId=${googleCampaignId}`);
      }

      // Campaign-only flow — PERFORMANCE_MAX, SHOPPING, APP_PROMOTION have no ad group / ad step
      if (isCampaignOnly) {
        logger.info(`[adsFactoryAuto:google] ${effectiveChannel} campaign created (campaign-only, no ad group/ad step)  campaignId=${googleCampaignId}`);
        try { await invalidateAllUserGoogleCache(rawGoogleUserId); } catch (e) {
          logger.warn(`[adsFactoryAuto:google] cache invalidation failed (non-fatal): ${e.message}`);
        }
        return { adId: googleCampaignId, campaignId: googleCampaignId };
      }

      // ── 2. Create ad group ────────────────────────────────────────────────
      // Each run creates a fresh ad group under the same reused campaign, so
      // the name must be unique per run — Google rejects a duplicate ad group
      // name within the same campaign (DUPLICATE_ADGROUP_NAME).
      const runNumber = (job.totalRuns || 0) + 1;
      const runDateLabel = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
      const baseAdGroupName = p.adGroupName || p.name || "Ad Group";
      const adGroupPayload = {
        adAccountId: customerId,
        campaignId:  googleCampaignId,
        name: `${baseAdGroupName} - Run ${runNumber} (${runDateLabel})`,
        // Autopilot-created ad groups always go live.
        status: "ENABLED",
        // cpcBid = wizard field (₹/$ amount), cpcBidMicros = already in micros, bidAmount = alias
        ...(p.cpcBidMicros    ? { cpcBidMicros:    p.cpcBidMicros }    :
            p.cpcBid          ? { cpcBidMicros:    Math.round(Number(p.cpcBid) * 1_000_000) } :
            p.bidAmount       ? { cpcBidMicros:    Math.round(Number(p.bidAmount) * 1_000_000) } : {}),
        ...(p.targeting       ? { targeting:       p.targeting }       : {}),
        ...(() => {
          const validKeywords = (p.keywords || []).filter((k) => k?.text?.trim());
          return validKeywords.length ? { keywords: validKeywords } : {};
        })(),
        ...(p.biddingGoal     ? { biddingGoal:     p.biddingGoal }     : {}),
        ...(p.targetCpaMicros ? { targetCpaMicros: p.targetCpaMicros } : {}),
        ...(p.targetRoas      ? { targetRoas:      p.targetRoas }      : {}),
        ...(p.videoFormat     ? { videoFormat:     p.videoFormat }     : {}),
        ...(p.frequencyCap    ? { frequencyCap:    p.frequencyCap }    : {}),
      };

      const adGroupRes = await executeController(googleAdController.createAdGroupAPI, adGroupPayload);
      // Controller returns { adGroup: { adGroupId, ... } }
      const adGroupId = adGroupRes?.adGroup?.adGroupId || adGroupRes?.adGroup?.id || adGroupRes?.adGroupId;
      if (!adGroupId) throw new Error("Google ad group creation did not return an adGroupId");

      // ── 3. One ad per creative ────────────────────────────────────────────
      const creativesToProcess = creatives.filter((c) => c.imageUrl || c.headline);
      if (creativesToProcess.length === 0) throw new Error("No valid creatives for Google posting");

      // SEARCH: needs arrays of unique headlines (≥3) + descriptions (≥2)
      // DISPLAY: needs single headline + description + imageUrl
      // YOUTUBE_REACH / DEMAND_GEN: needs single headline + description + imageUrl
      //   (autopilot only generates images/text, not video — controller detects channel from campaignId)
      const isSearch = effectiveChannel === "SEARCH";

      const finalUrl = p.finalUrl || p.linkUrl || "";
      if (!finalUrl) throw new Error("Google template payload is missing finalUrl / linkUrl — required for ad destination");

      // Deduplicate case-insensitively — Google rejects DUPLICATE_ASSET on search ads
      const dedup = (arr) => {
        const seen = new Set();
        return arr.filter((t) => {
          if (!t || !String(t).trim()) return false;
          const k = String(t).trim().toLowerCase();
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });
      };

      const adsArray = creativesToProcess.map((creative) => {
        const rawHeadline = (creative.headline || "").trim();
        const rawDesc     = (creative.message || creative.description || "").trim();

        if (isSearch) {
          // Google requires ≥3 unique headlines (max 30 chars each) and ≥2 unique descriptions (max 90 chars each).
          // We build 5 candidate headlines and 3 candidate descriptions from the AI text,
          // then dedup so Google never sees duplicates — even if the AI generated short/identical text.
          const h1 = rawHeadline.slice(0, 30);
          const h2 = rawDesc.split(/\s+/).slice(0, 4).join(" ").slice(0, 30);
          const h3 = rawHeadline.split(/\s+/).slice(0, 3).join(" ").slice(0, 30);
          const headlineCandidates = dedup([h1, h2, h3, "Learn More", "Discover Now", "Get Started"]);

          const d1 = rawDesc.slice(0, 90);
          const d2 = rawHeadline.slice(0, 90);
          const descCandidates = dedup([d1, d2, "Explore our latest offers and get started today."]);

          // Guard: if we still can't meet minimums after dedup, throw a clear error
          if (headlineCandidates.length < 3) throw new Error(`Search ad requires at least 3 unique headlines — only ${headlineCandidates.length} unique produced from creative "${rawHeadline.slice(0, 40)}"`);
          if (descCandidates.length < 2)     throw new Error(`Search ad requires at least 2 unique descriptions — only ${descCandidates.length} unique produced`);

          // Autopilot-created ads always go live.
          return { headlines: headlineCandidates, descriptions: descCandidates, finalUrl, status: "ENABLED" };
        }

        // DISPLAY / YOUTUBE_REACH / DEMAND_GEN — single headline + description + imageUrl
        return {
          ...(rawHeadline               ? { headline:     rawHeadline }                          : {}),
          ...(rawDesc                   ? { description:  rawDesc.slice(0, 90) }                 : {}),
          ...(creative.imageUrl         ? { imageUrl:     creative.imageUrl }                   : {}),
          // Google's own template CTA takes priority — same cross-platform
          // CTA-vocabulary mismatch risk as Meta's poster below.
          ...(p.callToAction || creative.callToAction
                                        ? { callToAction: p.callToAction || creative.callToAction } : {}),
          finalUrl,
          // Autopilot-created ads always go live.
          status: "ENABLED",
        };
      });

      const adRes = await executeController(googleAdController.createAdAPI, {
        adAccountId: customerId,
        adGroupId,
        campaignId:  googleCampaignId,
        ads:         adsArray,
      });

      const createdAdIds = (adRes?.ads || []).map((a) => a.adId).filter(Boolean);
      logger.info(`[adsFactoryAuto:google] created ${createdAdIds.length} ad(s).`);

      const creativeAdMap = {};
      creativesToProcess.forEach((creative, i) => {
        if (createdAdIds[i] && creative.creativeId) creativeAdMap[creative.creativeId] = createdAdIds[i];
      });

      try {
        await invalidateAllUserGoogleCache(rawGoogleUserId);
      } catch (e) {
        logger.warn(`[adsFactoryAuto:google] cache invalidation failed (non-fatal): ${e.message}`);
      }

      return { adId: createdAdIds.join(","), creativeAdMap, campaignId: googleCampaignId, adGroupId };
    },
  },

};

// ─── Generation helpers ───────────────────────────────────────────────────────

async function waitForGenerationComplete(campaignId, timeoutMs = 1000_000) {
  const POLL_INTERVAL = 5_000;
  const start = Date.now();
  let tick = 0;


  while (Date.now() - start < timeoutMs) {
    tick++;
    const campaign = await Campaign.findOne({ "metadata.campaignId": campaignId }).lean();
    if (!campaign) {
      throw new Error(`Campaign ${campaignId} disappeared while polling`);
    }

    const services = campaign.services?.servicesSelected || [];
    const elapsedSec = Math.round((Date.now() - start) / 1000);
    const progress = services.map((s) => `${s.serviceName}:${s.generated || 0}/${s.serviceParams?.quantity || 0}`).join(",");
    logger.debug(`[adsFactoryAuto][poll] tick=${tick}  elapsed=${elapsedSec}s  progress=[${progress}]  results.status=${campaign.results?.status}`);

    const allDone = services.every((srv) => (srv.generated || 0) >= (srv.serviceParams?.quantity || 0));
    if (allDone) {
      logger.info(`[adsFactoryAuto][poll] generation complete after ${tick} ticks (${elapsedSec}s)`);
      return campaign;
    }
    if (campaign.results?.status === "error" || campaign.status === "error") {
      logger.error(`[adsFactoryAuto][poll] campaign status=error after tick=${tick} (${elapsedSec}s)`);
      throw new Error("Campaign generation failed (status updated to error)");
    }

    // Flag the "Python never actually started" case distinctly from "still
    // working" — zero progress after 2 minutes strongly suggests the Python
    // service silently accepted the request (allNodesSuccess=true) but never
    // produced any output, rather than being genuinely slow.
    const anyProgress = services.some((s) => (s.generated || 0) > 0);
    if (!anyProgress && elapsedSec >= 120 && elapsedSec % 60 < POLL_INTERVAL / 1000) {
      logger.warn(`[adsFactoryAuto][poll] zero progress after ${elapsedSec}s — Python may have silently failed to start generation for campaignId=${campaignId}`);
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL));
  }
  const timeoutMin = Math.round(timeoutMs / 60000);
  logger.error(`[adsFactoryAuto][poll] TIMEOUT after ${tick} ticks (${Math.round(timeoutMs / 1000)}s)  campaignId=${campaignId}`);
  throw new Error(`Timeout: generation did not complete within ${timeoutMin} minutes`);
}

// Matches known Google/Meta account- or object-level limit errors that will
// never succeed on retry (too many campaigns/ad groups/ad sets/ads). Any
// other failure (transient network error, bad creative, temp token issue)
// is left alone so the job keeps retrying on schedule as before.
const PLATFORM_LIMIT_PATTERNS = [
  /too many ad ?groups/i,
  /too many campaigns/i,
  /too many ad ?sets/i,
  /(ad ?group|ad ?set).*(limit|maximum).*(reached|exceeded)/i,
  /(limit|maximum).*(ad ?group|ad ?set|campaign).*(reached|exceeded)/i,
  /CAMPAIGN_LIMIT/i,
  /AD_GROUP_LIMIT/i,
  /RESOURCE_COUNT_LIMIT_EXCEEDED/i,
  /reached the maximum number of/i,
  /account.*(has reached|exceeded).*(limit|quota)/i,
];

// Permanent account/config problems — connecting a page/account, expired or
// missing tokens, or a naming collision the AI keeps regenerating identically.
// None of these will ever succeed on retry without the user taking action
// outside of Autopilot, so keep retrying is pure wasted credits + noise.
const PERMANENT_CONFIG_ERROR_PATTERNS = [
  /no facebook account linked/i,
  /no google account linked/i,
  /no .* account linked/i,
  /access token is missing/i,
  /access token .* (expired|invalid|revoked)/i,
  /page not found/i,
  /ad account .* not found/i,
  /(re-?connect|re-?authenticate).* (facebook|google|meta|account)/i,
  /campaign with this name already exists/i,
  /duplicate campaign name/i,
  // Meta error codes embedded as "[code=N]" / "[subcode=N]" by the meta
  // poster (see errMsg construction above) — these are well-documented
  // permanent failures per Meta's Graph API error reference:
  //   190 = invalid/expired access token
  //   200/10 = permission/capability denied (e.g. missing ads_management)
  //   270 = user not authorized for this app/page
  /\[code=190\]/,
  /\[code=200\]/,
  /\[code=10\]/,
  /\[code=270\]/,
];

function isPlatformLimitError(errorMessage) {
  if (!errorMessage) return false;
  return PLATFORM_LIMIT_PATTERNS.some((re) => re.test(errorMessage));
}

function isPermanentConfigError(errorMessage) {
  if (!errorMessage) return false;
  return PERMANENT_CONFIG_ERROR_PATTERNS.some((re) => re.test(errorMessage));
}

function buildCreativesFromResults(campaign, callToActionList, destinationUrl, pairsPerCycle) {
  const allTexts  = (campaign.results?.text  || []).filter((t) => t.status === 200 && t.data);
  const allImages = (campaign.results?.image || []).filter((i) => i.status === 200 && i.data);
  
  // Extract only the latest results to avoid duplicating old creatives
  const texts = allTexts.slice(-pairsPerCycle);
  const images = allImages.slice(-pairsPerCycle);
  
  const count = Math.min(Math.max(texts.length, images.length, 1), pairsPerCycle);

  // callToActionList is an array — rotate through it per creative, fallback to first or empty
  const ctaList = Array.isArray(callToActionList) && callToActionList.length > 0
    ? callToActionList
    : ["Learn More"];

  const creatives = [];
  for (let i = 0; i < count; i++) {
    const textData = texts[i]?.data;
    const headline =
      (typeof textData === "object" 
        ? textData?.meta?.headline || textData?.google?.headline || textData?.headline 
        : textData) ||
      campaign.brandInfo?.brandName || "New Offer";
    const message =
      (typeof textData === "object" 
        ? textData?.meta?.primary_text || textData?.google?.description || textData?.body || textData?.message 
        : null) ||
      campaign.objectives?.coreIdea || "";
    const rawImage = images[i]?.data;
    const imgData =
      (typeof rawImage === "string"
        ? rawImage
        : rawImage?.base_image || rawImage?.url || rawImage?.data) || "";

    // Convert relative URLs to absolute so MetaAdLauncher can download them
    const fullImageUrl = imgData
      ? (imgData.startsWith("http") ? imgData : `https://contents.adsgpt.io${imgData.startsWith('/') ? '' : '/'}${imgData}`)
      : "";

    creatives.push({
      creativeId:   uuidv4(),
      imageUrl:     fullImageUrl,
      headline,
      message,
      linkUrl:      destinationUrl || "",
      callToAction: ctaList[i % ctaList.length], // rotate through campaign CTAs
      description:  campaign.objectives?.additionalGuidelines || "",
      platform:     "multi",
    });
  }
  return creatives;
}

// ─── Main run ─────────────────────────────────────────────────────────────────

async function run(jobId) {
  const runId     = uuidv4();
  const startedAt = new Date();
  let runStatus   = "failed";
  let runError    = null;
  const postedAdIds = {}; // { meta: "120200..." }
  const platformContext = {}; // { meta: { campaignId, adGroupId, adSetId }, google: {...} }
  let newCreatives  = [];
  let rawImages     = [];
  let rawTexts      = [];
  let job;
  let campaign = null;

  if (_runningJobs.has(jobId)) {
    logger.warn(`[adsFactoryAuto] job ${jobId} is already running — skipping duplicate dispatch`);
    return;
  }
  _runningJobs.add(jobId);

  logger.info(`[adsFactoryAuto] ▶ run START  jobId=${jobId}  runId=${runId}`);

  try {
    // ── Step 1: Load job ──────────────────────────────────────────────────────
    logger.debug(`[adsFactoryAuto][1] loading job from DB  jobId=${jobId}`);
    job = await AdsFactoryJob.findById(jobId);
    if (!job) throw new Error(`AdsFactoryJob ${jobId} not found`);
    logger.info(`[adsFactoryAuto][1] job loaded  status=${job.status}  userId=${job.userId}  campaignId=${job.campaignId}  frequency=${job.schedule?.frequency}`);
    logger.debug(`[adsFactoryAuto][1] job detail  pairsPerCycle=${job.pairsPerCycle}  model=${job.model || "default"}  targets=${Object.keys(job.targets || {}).join(",") || "none"}  nextRunAt=${job.schedule?.nextRunAt || "null"}  lastRunAt=${job.schedule?.lastRunAt || "null"}`);

    if (job.status !== "active") {
      logger.info(`[adsFactoryAuto][1] job ${jobId} is ${job.status}, skipping`);
      // The job is not active (paused/completed/failed) but its BullMQ
      // schedule is still registered — this happens when a job was paused
      // by a path that didn't also cancel the queue entry. Cancel it now so
      // this job stops firing every tick forever just to be skipped.
      try {
        const { cancelJob } = require("./adsFactoryAutoQueue");
        await cancelJob(jobId);
      } catch (e) {
        logger.warn(`[adsFactoryAuto][1] could not cancel ${job.status} job's stale queue entry: ${e.message}`);
      }
      _runningJobs.delete(jobId);
      return;
    }

    // For does_not_repeat jobs, guard against early firing caused by BullMQ re-registration
    // on server restart (nodemon restarts, deployments). If the scheduled time hasn't arrived
    // yet, skip this tick — the correctly-delayed entry will fire at the right time.
    if (job.schedule?.frequency === "does_not_repeat") {
      const nextRunAt = job.schedule?.nextRunAt ? new Date(job.schedule.nextRunAt) : null;
      if (nextRunAt && nextRunAt > new Date()) {
        logger.warn(
          `[adsFactoryAuto][1] does_not_repeat job ${jobId} fired early — scheduled at ${nextRunAt.toISOString()} but now is ${new Date().toISOString()} — skipping stale BullMQ tick`
        );
        _runningJobs.delete(jobId);
        return;
      }
    }

    // For custom "every N weeks" schedules, BullMQ fires every week on the selected days.
    // We skip here if fewer than N weeks have elapsed since the last successful run.
    const sched = job.schedule || {};
    if (
      sched.frequency === "custom" &&
      sched.customFrequency?.repeatUnit === "week" &&
      (sched.customFrequency?.repeatEvery || 1) > 1 &&
      sched.lastRunAt
    ) {
      const weekMs = (sched.customFrequency.repeatEvery || 1) * 7 * 24 * 60 * 60 * 1000;
      const elapsed = Date.now() - new Date(sched.lastRunAt).getTime();
      if (elapsed < weekMs) {
        logger.info(
          `[adsFactoryAuto][1] job ${jobId} skipping — only ${Math.round(elapsed / 86400000)}d elapsed ` +
          `of required ${sched.customFrequency.repeatEvery * 7}d (lastRunAt=${sched.lastRunAt})`
        );
        _runningJobs.delete(jobId);
        return;
      }
    }

    // Auto-complete if endDate passed
    if (job.schedule.endDate && new Date() > new Date(job.schedule.endDate)) {
      logger.info(`[adsFactoryAuto][1] job ${jobId} reached endDate=${job.schedule.endDate}, marking completed`);
      await AdsFactoryJob.updateOne({ _id: job._id }, { $set: { status: "completed" } });
      try {
        const { cancelJob } = require("./adsFactoryAutoQueue");
        await cancelJob(job._id.toString());
      } catch (e) {
        logger.warn(`[adsFactoryAuto][1] could not cancel completed job from queue: ${e.message}`);
      }
      _runningJobs.delete(jobId);
      return;
    }

    // ── Step 2: Load campaign ─────────────────────────────────────────────────
    logger.debug(`[adsFactoryAuto][2] loading campaign  campaignId=${job.campaignId}`);
    campaign = await Campaign.findById(job.campaignId).lean();
    if (!campaign) {
      logger.warn(`[adsFactoryAuto][2] campaign ${job.campaignId} not found — pausing job ${jobId}`);
      const { cancelJob } = require("./adsFactoryAutoQueue");
      await cancelJob(job._id.toString()).catch(() => {});
      await AdsFactoryJob.updateOne({ _id: job._id }, { $set: { status: "paused" } })
        .catch((e) => logger.warn(`[adsFactoryAuto][2] could not save paused status: ${e.message}`));
      _runningJobs.delete(jobId);
      return;
    }

    if (!(campaign.services?.servicesSelected?.length)) {
      logger.warn(
        `[adsFactoryAuto][2] campaign ${campaign.metadata?.campaignId} has NO servicesSelected — ` +
        `generation will complete immediately with 0 results. Check campaign setup.`
      );
    }

    logger.info(`[adsFactoryAuto][2] campaign loaded  campaignId=${campaign.metadata?.campaignId}  status=${campaign.status}`);
    logger.debug(`[adsFactoryAuto][2] campaign detail  name="${campaign.metadata?.campaignName}"  results.status=${campaign.results?.status}  services=${(campaign.services?.servicesSelected || []).map((s) => `${s.serviceName}×${s.serviceParams?.quantity || 0}(gen=${s.generated || 0})`).join(",")}`);

    // Guard: skip if a previous tick's generation is still in-progress — avoids
    // overlapping Python runs on the same campaign when the schedule fires faster
    // than generation completes (e.g. during testing with 1-min cron).
    if (campaign.results?.status === "in-progress" || campaign.status === "in-progress") {
      logger.warn(
        `[adsFactoryAuto][2] campaign ${campaign.metadata?.campaignId} still in-progress — skipping tick to avoid overlap`
      );
      _runningJobs.delete(jobId);
      return;
    }

    const campaignId     = campaign.metadata?.campaignId;
    const userId         = job.userId;
    const pairsPerCycle  = job.pairsPerCycle  || 1;
    const model          = job.model          || null;
    logger.debug(`[adsFactoryAuto][2] resolved  campaignId=${campaignId}  userId=${userId}  pairsPerCycle=${pairsPerCycle}  model=${model || "default"}`);

    // ── Step 2b: Verify every configured platform is actually connected ───────
    // isConfigured() only checks the saved template has fields filled in — it
    // doesn't mean the underlying Facebook/Google account is still linked.
    // Checked here, before spending a generation cycle's credits, so a
    // disconnected account auto-pauses the job with a clear reason instead of
    // silently repeating the same failed attempt every single tick forever.
    const targetsForConnCheck = job.targets || {};
    const disconnectedPlatforms = [];
    for (const [platformName, poster] of Object.entries(PLATFORM_POSTERS)) {
      if (!poster.isConfigured(targetsForConnCheck[platformName])) continue;
      if (!poster.isConnected) continue;
      const connected = await poster.isConnected(job);
      if (!connected) disconnectedPlatforms.push(platformName);
    }
    if (disconnectedPlatforms.length > 0) {
      const reason = `${disconnectedPlatforms.join(", ")} account not connected — reconnect it or remove ${disconnectedPlatforms.length > 1 ? "these platforms" : "this platform"} from the automation`;
      logger.warn(`[adsFactoryAuto][2b] job ${jobId} auto-pausing — ${reason}`);
      job.status = "paused";
      job.schedule.nextRunAt = null;
      await job.save({ validateBeforeSave: false });
      try {
        const { cancelJob } = require("./adsFactoryAutoQueue");
        await cancelJob(jobId);
      } catch (e) {
        logger.warn(`[adsFactoryAuto][2b] could not cancel auto-paused job from queue: ${e.message}`);
      }
      throw new Error(reason);
    }

    // ── Step 3: Credit check ──────────────────────────────────────────────────
    logger.debug(`[adsFactoryAuto][3] validating credits  userId=${userId}`);
    let created_from = "GPT";
    let rawUserId = userId;
    if (userId && userId.includes("-")) {
      const parts = userId.split("-");
      created_from = parts[0];
      rawUserId = parts.slice(1).join("-");
    }

    const ctrl = adFactoryCtrl();
    const creditResult = await ctrl.validateCredits(
      { user_id: rawUserId, created_from },
      "autopilot",
      campaign.services
    );
    logger.info(`[adsFactoryAuto][3] credits  required=${creditResult.totalRequired}  success=${creditResult.success}`);
    logger.debug(`[adsFactoryAuto][3] credit detail  code=${creditResult.code}  available=${creditResult.available ?? "n/a"}  userId=${creditResult.userId || "n/a"}  message="${creditResult.message || ""}"`);
    if (!creditResult.success && creditResult.code === 400) {
      logger.warn(`[adsFactoryAuto][3] insufficient credits — pausing job ${jobId}`);
      job.status = "paused";
      // validateBeforeSave: false — legacy jobs missing campaignId must still
      // be pausable; full-document validation would otherwise reject this
      // save purely because of that pre-existing, unrelated field.
      await job.save({ validateBeforeSave: false });
      throw new Error(`Insufficient credits: ${creditResult.message}`);
    }

    // ── Step 4: Freeze credits ────────────────────────────────────────────────
    // Atomic freeze for the autopilot-driven generation. Receipt key is the
    // campaignId; updateGenerationResult / deleteCampaign release the hold
    // after per-batch deducts settle the actual cost.
    if (creditResult?.totalRequired > 0 && creditResult?.userId) {
      logger.debug(`[adsFactoryAuto][4] freezing ${creditResult.totalRequired} credits  userId=${creditResult.userId}  key=campaign:${campaign.metadata.campaignId}`);
      const freeze = await UnifiedCreditController.freezeCredits({
        userId: creditResult.userId,
        reservationKey: `campaign:${campaign.metadata.campaignId}`,
        amount: creditResult.totalRequired,
        meta: {
          service_type: "adfactory_campaign_autopilot",
          campaignId: campaign.metadata.campaignId,
        },
      });
      logger.debug(`[adsFactoryAuto][4] freeze result  ok=${freeze.ok}  reason=${freeze.reason || "none"}  idempotent=${freeze.idempotent}  remaining=${freeze.remaining ?? "n/a"}`);
      if (!freeze.ok && freeze.reason === "INSUFFICIENT") {
        logger.warn(`[adsFactoryAuto][4] freeze INSUFFICIENT — need ${creditResult.totalRequired}, have ${freeze.remaining} — pausing job`);
        job.status = "paused";
        await job.save({ validateBeforeSave: false });
        throw new Error(
          `Insufficient credits to reserve campaign run: need ${creditResult.totalRequired}, have ${freeze.remaining}`,
        );
      }
      if (!freeze.ok && freeze.reason !== "CONTENDED" && !freeze.idempotent) {
        // CONTENDED is transient; other reasons (NO_USER, RECEIPT_WRITE_FAILED,
        // etc.) are fatal — pause and surface for retry/manual recovery.
        logger.error(
          `[autopilot][4] campaign freeze failed (${freeze.reason}) for ${campaign.metadata.campaignId} — pausing job`,
        );
        job.status = "paused";
        await job.save({ validateBeforeSave: false });
        throw new Error(`Credit freeze failed: ${freeze.reason}`);
      }
    }

    // ── Step 5: Update campaign services ─────────────────────────────────────
    logger.debug(`[adsFactoryAuto][5] updating campaign services  campaignId=${campaignId}  pairsPerCycle=${pairsPerCycle}`);

    // If the campaign has no services configured, default to text + image.
    // This happens when the campaign was created outside the full wizard flow.
    const existingServices = campaign.services?.servicesSelected || [];
    const baseServices = existingServices.length > 0 ? existingServices : [
      { serviceName: "text",  serviceParams: { quantity: pairsPerCycle, ...(model ? { model } : {}) }, generated: 0 },
      { serviceName: "image", serviceParams: { quantity: pairsPerCycle, ...(model ? { model } : {}) }, generated: 0 },
    ];
    if (!existingServices.length) {
      logger.warn(`[adsFactoryAuto][5] no servicesSelected — defaulting to text×${pairsPerCycle} + image×${pairsPerCycle}`);
    }

    const updatedServices = baseServices.map((srv) => ({
      ...srv,
      serviceParams: {
        ...srv.serviceParams,
        quantity: srv.serviceName === "video" ? (srv.serviceParams?.quantity || 0) : pairsPerCycle,
        ...(model ? { model } : {}),
      },
      generated: 0,
    }));

    logger.info(`[adsFactoryAuto][5] services  ${updatedServices.map((s) => `${s.serviceName}×${s.serviceParams?.quantity || 0}`).join(", ")}`);

    // Force all required nodes to "success" so sendAdFactoryRequest passes its
    // node-check — a draft/new campaign may have some nodes still in "draft" status.
    // Also clear accumulated stale creatives (empty imageUrl entries from past broken runs).
    await Campaign.updateOne(
      { "metadata.campaignId": campaign.metadata.campaignId },
      {
        $set: {
          "services.servicesSelected": updatedServices,
          "brandInfo.status":    "success",
          "objectives.status":   "success",
          "assets.status":       "success",
          "distribution.status": "success",
          "services.status":     "success",
          creatives:             [],  // wipe stale accumulated creatives — history is in runHistory
        },
      }
    );
    // Append new empty slots for python to fill
    const pushUpdate = {};
    for (const srv of updatedServices) {
      const qty = srv.serviceParams?.quantity || 0;
      if (qty > 0) {
        if (srv.serviceName === "text") pushUpdate["results.text"] = { $each: Array.from({ length: qty }, () => ({})) };
        if (srv.serviceName === "image") pushUpdate["results.image"] = { $each: Array.from({ length: qty }, () => ({})) };
        if (srv.serviceName === "video") pushUpdate["results.video"] = { $each: Array.from({ length: qty }, () => ({})) };
      }
    }

    if (Object.keys(pushUpdate).length > 0) {
      logger.debug(`[adsFactoryAuto][5] pushing empty result slots  keys=${Object.keys(pushUpdate).join(",")}`);
      await Campaign.updateOne(
        { "metadata.campaignId": campaign.metadata.campaignId },
        { $push: pushUpdate, $set: { "results.status": "in-progress", status: "in-progress" } }
      );
    }

    // ── Step 6: Send to Python ────────────────────────────────────────────────
    logger.info(`[adsFactoryAuto][6] sending campaignId=${campaignId} to Python API`);
    let completedCampaign;
    try {
      const pythonResult = await ctrl.sendAdFactoryRequest(campaign.metadata.campaignId, "autopilot", "active", job._id.toString());
      logger.debug(`[adsFactoryAuto][6] Python response  allNodesSuccess=${pythonResult?.allNodesSuccess}  message="${pythonResult?.message || ""}"  error="${pythonResult?.error || ""}"`);
      if (!pythonResult?.allNodesSuccess) {
        throw new Error(`Python API rejected: ${pythonResult?.message || pythonResult?.error || "unknown"}`);
      }

      // ── Step 7: Poll for generation completion ────────────────────────────
      logger.info(`[adsFactoryAuto][7] polling for generation completion  campaignId=${campaignId}`);
      completedCampaign = await waitForGenerationComplete(campaign.metadata.campaignId);
    } catch (err) {
      logger.error(`[adsFactoryAuto][6-7] generation failed: ${err.message}`);
      // Rollback the campaign status so it isn't stuck 'in-progress' forever
      await Campaign.updateOne(
        { "metadata.campaignId": campaign.metadata.campaignId },
        { $set: { status: "error", "results.status": "error" } }
      );
      // Release the credits frozen in Step 4 above — settlement normally
      // happens via Python's completion webhook (updateGenerationResult →
      // settleAdFactoryCampaign), which never fires if generation timed out
      // or Python rejected the request outright. Without this, a timeout
      // leaves the freeze stuck indefinitely.
      try {
        const release = await UnifiedCreditController.releaseCredits(`campaign:${campaign.metadata.campaignId}`);
        logger.debug(`[adsFactoryAuto][6-7] released frozen credits on failure  ok=${release.ok}  reason=${release.reason || "none"}`);
      } catch (releaseErr) {
        logger.warn(`[adsFactoryAuto][6-7] failed to release frozen credits: ${releaseErr.message}`);
      }
      throw err;
    }

    // ── Step 7b: Build creatives ──────────────────────────────────────────────
    const metaPayload   = job.targets?.meta?.template?.payload   || {};
    const googlePayload = job.targets?.google?.template?.payload || {};
    // Use the active platform's payload (google wins if google template is set)
    const activePlatformPayload = job.targets?.google?.template ? googlePayload : metaPayload;
    const ctaList       = activePlatformPayload.callToAction
      ? (Array.isArray(activePlatformPayload.callToAction) ? activePlatformPayload.callToAction : [activePlatformPayload.callToAction])
      : [];
    const destinationUrl = activePlatformPayload.linkUrl || activePlatformPayload.finalUrl || "";
    newCreatives = buildCreativesFromResults(completedCampaign, ctaList, destinationUrl, pairsPerCycle);
    // Filter to successful (status 200 + data) entries FIRST, same as
    // buildCreativesFromResults does — the results.image/text arrays
    // accumulate one pushed slot per run across the job's entire lifetime,
    // and Python doesn't guarantee the last N raw entries are this run's
    // successful ones (a stale/empty placeholder can land at the tail).
    // Slicing the unfiltered array here previously showed "generation
    // failed" in run history even when the real image/text was generated
    // and posted successfully.
    rawTexts  = (completedCampaign.results?.text  || []).filter((t) => t.status === 200 && t.data).slice(-pairsPerCycle);
    rawImages = (completedCampaign.results?.image || []).filter((i) => i.status === 200 && i.data).slice(-pairsPerCycle);
    logger.info(`[adsFactoryAuto][7b] creatives built  count=${newCreatives.length}  withImage=${newCreatives.filter((c) => c.imageUrl).length}`);
    newCreatives.forEach((c, i) => {
      logger.debug(`[adsFactoryAuto][7b] creative[${i}]  imageUrl="${(c.imageUrl || "").slice(0, 80)}"  headline="${(c.headline || "").slice(0, 50)}"  cta="${c.callToAction}"  linkUrl="${c.linkUrl || ""}"`);
    });
    // Mark campaign back to success — creatives are stored in runHistory, not pushed to campaign.creatives
    // (pushing to campaign.creatives on every run causes unbounded accumulation)
    try {
      await Campaign.updateOne(
        { "metadata.campaignId": campaign.metadata.campaignId },
        { $set: { status: "success", "results.status": "success" } }
      );
    } catch (e) {
      logger.warn(`[adsFactoryAuto][7b] failed to reset campaign status: ${e.message}`);
    }

    // ── Step 8: Post to each configured platform ──────────────────────────────
    const targets        = job.targets || {};
    const platformErrors = [];

    const configuredPlatforms = Object.entries(PLATFORM_POSTERS).filter(([p, poster]) => poster.isConfigured(targets[p]));
    const unconfiguredPlatforms = Object.keys(PLATFORM_POSTERS).filter((p) => !PLATFORM_POSTERS[p].isConfigured(targets[p]));
    logger.info(
      `[adsFactoryAuto][8] platforms configured=[${configuredPlatforms.map(([p]) => p).join(",")}]  ` +
      `skipped=[${unconfiguredPlatforms.join(",")}]`
    );

    const postTasks = Object.entries(PLATFORM_POSTERS)
      .filter(([platformName, poster]) => poster.isConfigured(targets[platformName]))
      .map(([platformName, poster]) => {
        logger.info(`[adsFactoryAuto][8] posting to ${platformName}  creatives=${newCreatives.length}`);
        return poster.post(targets[platformName], job, newCreatives, completedCampaign)
          .then((result) => ({
            platformName,
            adId: result.adId,
            creativeAdMap: result.creativeAdMap || {},
            campaignId: result.campaignId || null,
            adGroupId: result.adGroupId || null,
            adSetId: result.adSetId || null,
            ok: true,
          }))
          .catch((platformErr) => {
            let errMsg = platformErr.message;
            if (platformName === "meta") {
              try {
                const { logMetaError } = require("../../controllers/adPosting/metaAdLauncher");
                const m = logMetaError(`AutoPilot ${platformName} post failed`, platformErr);
                // Keep the raw message (and code/subcode) in errMsg, not just
                // Meta's localized friendly title — the permanent-error
                // classifiers below match on message text/error codes, which
                // the title (e.g. "There was a problem") often doesn't contain.
                errMsg = [
                  m.message || m.title || errMsg,
                  m.code != null ? `[code=${m.code}]` : null,
                  m.subcode != null ? `[subcode=${m.subcode}]` : null,
                ].filter(Boolean).join(" ");
              } catch (_) {}
            }
            return { platformName, errMsg, ok: false };
          });
      });

    const postResults = await Promise.all(postTasks);
    for (const r of postResults) {
      if (r.ok) {
        postedAdIds[r.platformName] = r.adId;
        platformContext[r.platformName] = {
          campaignId: r.campaignId,
          adGroupId:  r.adGroupId,
          adSetId:    r.adSetId,
        };
        // Attach the real posted ad id (per-platform) onto each creative so
        // the run-history/email can link directly to the ad that was
        // actually created for it, instead of guessing by array position.
        newCreatives.forEach((creative) => {
          const adId = creative.creativeId && r.creativeAdMap[creative.creativeId];
          if (adId) {
            creative.postedAdIds = creative.postedAdIds || {};
            creative.postedAdIds[r.platformName] = adId;
          }
        });
        logger.info(`[adsFactoryAuto][8] ${r.platformName} ad posted OK  adId="${r.adId}"`);
      } else {
        logger.error(`[adsFactoryAuto][8] ${r.platformName} post FAILED: ${r.errMsg}`);
        platformErrors.push({ platformName: r.platformName, message: r.errMsg });
      }
    }

    const anyPosted = Object.keys(postedAdIds).length > 0;
    runStatus = platformErrors.length > 0
      ? (anyPosted ? "partial" : "failed")
      : "success";
    if (platformErrors.length) runError = platformErrors.map((e) => `${e.platformName}: ${e.message}`).join(" | ");

    logger.info(
      `[adsFactoryAuto][8] posting done  runStatus=${runStatus}  postedPlatforms=[${Object.keys(postedAdIds).join(",")}]  ` +
      `errors=${platformErrors.length}  runError="${runError || "none"}"`
    );

  } catch (err) {
    runError  = err.message;
    runStatus = "failed";
    logger.error(`[adsFactoryAuto:orchestrator] run ${runId} FAILED: ${err.message}`);
  }

  // ── Step 9: Save run history ─────────────────────────────────────────────────
  if (job) {
    try {
      job.runHistory.push({
        runId,
        startedAt,
        completedAt:   new Date(),
        status:        runStatus,
        metaAdId:      postedAdIds.meta   || null,
        googleAdId:    postedAdIds.google || null,
        platformAdIds: postedAdIds,
        platformContext,
        error:         runError,
        automationCreatives: newCreatives || [],
        rawImages:     rawImages,
        rawTexts:      rawTexts,
      });
      job.totalRuns          = (job.totalRuns || 0) + 1;
      job.schedule.lastRunAt = new Date();
      if (runStatus === "failed") {
        job.failedRuns = (job.failedRuns || 0) + 1;

        // Platform account/campaign limits (too many ad groups, too many ads
        // per ad set, etc.) or permanent config problems (no linked account,
        // expired token, duplicate campaign name) will never succeed on retry
        // — auto-pause instead of failing on every future tick and burning
        // credits each time.
        if (isPlatformLimitError(runError) || isPermanentConfigError(runError)) {
          job.status = "paused";
          job.schedule.nextRunAt = null;
          logger.warn(`[adsFactoryAuto][9] job ${jobId} hit a platform limit — auto-pausing: "${runError}"`);
          try {
            const { cancelJob } = require("./adsFactoryAutoQueue");
            await cancelJob(jobId);
          } catch (e) {
            logger.warn(`[adsFactoryAuto][9] could not cancel auto-paused job from queue: ${e.message}`);
          }
        }
      }

      // One-shot job — always cancel from BullMQ after any run attempt (success, partial, or failed).
      // Success/partial → mark completed. Failed → stay active so user can retry via run-now.
      // Either way the BullMQ delayed entry must be removed — otherwise it fires again on the next tick.
      if (job.schedule?.frequency === "does_not_repeat") {
        job.schedule.nextRunAt = null;
        if (runStatus === "success" || runStatus === "partial") {
          job.status = "completed";
          logger.info(`[adsFactoryAuto][9] job ${jobId} is does_not_repeat — marking completed, cleared nextRunAt`);
        } else {
          logger.info(`[adsFactoryAuto][9] job ${jobId} is does_not_repeat and failed — staying active for manual retry, removing from queue`);
        }
        try {
          const { cancelJob } = require("./adsFactoryAutoQueue");
          await cancelJob(jobId);
        } catch (e) {
          logger.warn(`[adsFactoryAuto][9] could not cancel does_not_repeat job from queue: ${e.message}`);
        }
      }

      try {
        const { getNextRunTime } = require("./adsFactoryAutoQueue");
        // Only update nextRunAt for repeating, still-active jobs — does_not_repeat
        // and auto-paused jobs already cleared/set nextRunAt above.
        const nextTime = (job.schedule?.frequency !== "does_not_repeat" && job.status !== "paused")
          ? await getNextRunTime(jobId) : null;
        if (nextTime) {
          job.schedule.nextRunAt = nextTime;
          logger.debug(`[adsFactoryAuto][9] nextRunAt=${nextTime}`);
        } else {
          logger.debug(`[adsFactoryAuto][9] nextRunAt=null (does_not_repeat or no future run)`);
        }
      } catch (e) {
        logger.warn(`[adsFactoryAuto][9] could not update nextRunAt: ${e.message}`);
      }

      // validateBeforeSave: false — legacy jobs with a missing campaignId (data
      // predates the required-field constraint) must still be able to record
      // run history and status changes; full-document validation would reject
      // the save purely because of that pre-existing, unrelated field.
      await job.save({ validateBeforeSave: false });
      logger.info(`[adsFactoryAuto][9] run history saved  totalRuns=${job.totalRuns}  failedRuns=${job.failedRuns || 0}`);

    } catch (saveErr) {
      logger.error(`[adsFactoryAuto][9] save history FAILED: ${saveErr.message}`);
    }

    // ── Step 10: Socket.IO emit ───────────────────────────────────────────────
    logger.debug(`[adsFactoryAuto][10] emitting socket  global.io=${!!global.io}  room=${job.userId}`);
    if (global.io) {
      try {
          const adsPosted = Object.keys(postedAdIds).length > 0
            ? postedAdIds
            : {};

          const imagesGenerated = newCreatives.filter((c) => c.imageUrl).length;
          const textsGenerated  = newCreatives.filter((c) => c.headline || c.message).length;
          const ppc             = job.pairsPerCycle || 1;

          // Cumulative health across ALL runs — matches getJobActivity exactly
          let totalImagesRequested = 0, totalImagesGenerated = 0;
          let totalTextsRequested = 0,  totalTextsGenerated = 0;
          let totalCreativesAssembled = 0, totalCreativesPosted = 0, totalCreativesNotPosted = 0;
          for (const r of job.runHistory) {
            const rImgs = r.rawImages || [];
            const rTxts = r.rawTexts  || [];
            totalImagesRequested += job.pairsPerCycle || 1;
            totalImagesGenerated += rImgs.filter(i => i.status === 200).length;
            totalTextsRequested  += job.pairsPerCycle || 1;
            totalTextsGenerated  += rTxts.filter(t => t.status === 200).length;
            const rCLen = (r.automationCreatives || []).length;
            totalCreativesAssembled += rCLen;
            const rPosted = r.platformAdIds && (r.platformAdIds instanceof Map ? r.platformAdIds.size > 0 : Object.keys(r.platformAdIds).length > 0);
            if (rPosted) totalCreativesPosted += rCLen;
            else         totalCreativesNotPosted += rCLen;
          }

          const generatedImages = rawImages.map((img, i) => {
            const imgUrl = typeof img.data === "string"
              ? img.data
              : (img.data?.base_image || img.data?.url || img.data?.data || null);
            const aspectRatio = typeof img.data === "object"
              ? (img.data?.aspect_ratio || img.data?.aspectRatio || img.data?.aspectRatioString || null)
              : null;
            return {
              index:       i,
              generated:   img.status === 200,
              status:      img.status,
              url:         imgUrl,
              aspectRatio,
              prompt:      img.prompt || null,
              error:       img.error  || null,
            };
          });

          const generatedTexts = rawTexts.map((txt, i) => ({
            index:       i,
            generated:   txt.status === 200,
            status:      txt.status,
            headline:    typeof txt.data === "object"
              ? txt.data?.meta?.headline || txt.data?.google?.headline || txt.data?.headline
              : txt.data || null,
            body:        typeof txt.data === "object"
              ? txt.data?.meta?.primary_text || txt.data?.google?.description || txt.data?.body || txt.data?.message
              : null,
            description: typeof txt.data === "object"
              ? txt.data?.meta?.description || txt.data?.description
              : null,
            error:       txt.error || null,
          }));

          const completedAt = new Date();
          const durationMs  = completedAt - startedAt;
          const posted      = Object.keys(adsPosted).length > 0;
          const cLen        = newCreatives.length;

          // Build platforms the same way as getJobActivity — skip empty configs
          const platformDetails = {};
          for (const [platform, cfg] of Object.entries(job.targets || {})) {
            if (!cfg || Object.keys(cfg).length === 0) continue;
            platformDetails[platform] = { config: cfg };
          }

          const socketPayload = {
            success: true,
            jobId:   job._id,
            total:   job.runHistory.length,
            skip:    0,
            limit:   1,

            // Campaign identity — matches getJobActivity shape exactly
            campaign: campaign ? {
              _id:          campaign._id,
              campaignId:   campaign.metadata?.campaignId || null,
              campaignName: campaign.metadata?.campaignName || null,
              status:       campaign.status || null,
            } : null,

            // Cumulative health across ALL runs — matches getJobActivity exactly
            generationHealth: {
              totalImagesRequested,
              totalImagesGenerated,
              totalImagesFailed:       Math.max(0, totalImagesRequested - totalImagesGenerated),
              totalTextsRequested,
              totalTextsGenerated,
              totalTextsFailed:        Math.max(0, totalTextsRequested - totalTextsGenerated),
              totalCreativesAssembled,
              totalCreativesPosted,
              totalCreativesNotPosted,
            },

            platforms: platformDetails,

            // Run detail array (single entry — this run)
            data: [
              {
                runId,
                status:      runStatus,
                startedAt,
                completedAt,
                durationMs,
                error:       runError || null,

                generationSummary: {
                  imagesRequested:    ppc,
                  imagesGenerated,
                  imagesFailed:       Math.max(0, ppc - imagesGenerated),
                  textsRequested:     ppc,
                  textsGenerated,
                  textsFailed:        Math.max(0, ppc - textsGenerated),
                  creativesAssembled: cLen,
                  nextRunAt:          job.schedule?.nextRunAt || null,
                },

                postingSummary: {
                  posted,
                  platforms: Object.keys(adsPosted),
                  adIds:     adsPosted,
                },

                generatedImages,
                generatedTexts,

                creatives: newCreatives.map((c, i) => ({
                  creativeId:  c.creativeId,
                  imageIndex:  i,
                  textIndex:   i,
                  runStatus:   runStatus,
                  runError:    runError || null,
                  ad: {
                    imageUrl:     c.imageUrl,
                    imageStatus:  c.imageUrl ? "generated" : "missing",
                    headline:     c.headline,
                    body:         c.message,
                    description:  c.description,
                    textStatus:   (c.headline || c.message) ? "generated" : "missing",
                    callToAction: c.callToAction,
                    linkUrl:      c.linkUrl,
                    platform:     c.platform,
                  },
                  posting: {
                    posted,
                    postedAdIds: adsPosted,
                    postedAt:    posted ? completedAt : null,
                  },
                })),
              },
            ],
          };

          global.io.to(job.userId).emit("adsFactory:runComplete", socketPayload);
          logger.debug(`[adsFactoryAuto][10] emitted to user room  ${job.userId}`);

          if (job.campaignId) {
            const campIdStr = job.campaignId.toString();
            global.io.to(campIdStr).emit("adsFactory:runComplete", socketPayload);
            logger.debug(`[adsFactoryAuto][10] emitted to campaign room  ${campIdStr}`);
          }
        } catch (e) {
          logger.error(`[adsFactoryAuto][10] failed to emit activity socket: ${e.message}`);
        }
      }

    // ── Step 11: Cycle-complete alert email (fire-and-forget) ─────────────────
    // Emails the job's configured alert recipients (job.alerts.emailTo) a
    // summary of THIS cycle after every run — success, partial, or failed.
    // Wrapped so a mail failure can never break the run; the alert service
    // itself also never throws (returns { sent:false, reason } instead).
    try {
      const { notifyAdsFactoryRun } = require("./adsFactoryAlertService");
      // The run entry pushed in Step 9 is the last element of runHistory and
      // carries everything the email needs (status, error, platformAdIds,
      // automationCreatives, rawImages, rawTexts).
      const lastRun = job.runHistory[job.runHistory.length - 1];
      const result = await notifyAdsFactoryRun({ job, campaign, run: lastRun });
      if (result && result.reason && result.reason !== "no-recipient") {
        logger.debug(`[adsFactoryAuto][11] alert email result: sent=${result.sent} reason=${result.reason || "ok"}`);
      }
    } catch (e) {
      logger.warn(`[adsFactoryAuto][11] alert email failed (non-fatal): ${e.message}`);
    }
  }

  _runningJobs.delete(jobId);
  logger.info(`[adsFactoryAuto] ■ run END  jobId=${jobId}  runId=${runId}  finalStatus=${runStatus}  durationMs=${Date.now() - startedAt.getTime()}`);
}

const adsFactoryOrchestrator = { run };
module.exports = { adsFactoryOrchestrator, _runningJobs };
