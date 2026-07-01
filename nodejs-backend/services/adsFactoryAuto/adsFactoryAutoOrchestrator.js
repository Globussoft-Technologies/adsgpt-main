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
      const campaignRes = await executeController(metaAdControllerV2.createCampaignV2, campaignPayload);
      usedCampaignId = campaignRes.campaign.id;

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

      const adSetPayload = {
        ...adSetBase,
        adAccountId: p.adAccountId,
        name: p.name || p.adSetName || p.campaignName || "Auto",
        campaignId: usedCampaignId,
        // objective + conversionLocation live on template root, not payload — required by adSet Joi schema
        objective:          template.objective          || p.objective          || undefined,
        conversionLocation: template.conversionLocation || p.conversionLocation || undefined,
        // pageId required by adSet schema
        pageId: _pg || p.pageId || undefined,
        // targeting is required by adSet Joi schema
        targeting: finalTargeting,
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
          ...(p.instagramUserId ? { instagramUserId: p.instagramUserId } : {}),
          imageHash: imageHash,
          headline: (creative.headline || "").slice(0, 40),
          primaryText: (creative.message || "").slice(0, 125),
          description: (creative.description || "").slice(0, 30),
          callToAction: creative.callToAction || _cta || "LEARN_MORE",
          linkUrl: creative.linkUrl || _lu || "",
          ...((_lf) ? { leadFormId: _lf } : {}),
          ...(p.applicationId ? { applicationId: p.applicationId } : {}),
          ...(p.objectStoreUrl ? { objectStoreUrl: p.objectStoreUrl } : {}),
        };

        const adRes = await executeController(metaAdControllerV2.createAdV2, adPayload);
        const adId = adRes.ad.id;
        const creativeId = adRes.creative.id;
        
        createdAdIds.push(adId);

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
            callToAction: creative.callToAction || template.payload.callToAction || "LEARN_MORE",
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
      return { adId: createdAdIds.join(",") };
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
        ...(p.status ? { status: p.status } : {}),
      };

      const campaignRes = await executeController(googleAdController.createCampaignAPI, campaignPayload);
      // Controller returns { campaign: { campaignId, ... } }
      const googleCampaignId = campaignRes?.campaign?.campaignId || campaignRes?.campaign?.id || campaignRes?.campaignId;
      if (!googleCampaignId) throw new Error("Google campaign creation did not return a campaignId");

      // Campaign-only flow — PERFORMANCE_MAX, SHOPPING, APP_PROMOTION have no ad group / ad step
      if (isCampaignOnly) {
        logger.info(`[adsFactoryAuto:google] ${effectiveChannel} campaign created (campaign-only, no ad group/ad step)  campaignId=${googleCampaignId}`);
        try { await invalidateAllUserGoogleCache(rawGoogleUserId); } catch (e) {
          logger.warn(`[adsFactoryAuto:google] cache invalidation failed (non-fatal): ${e.message}`);
        }
        return { adId: googleCampaignId };
      }

      // ── 2. Create ad group ────────────────────────────────────────────────
      const adGroupPayload = {
        adAccountId: customerId,
        campaignId:  googleCampaignId,
        ...(p.adGroupName || p.name ? { name: p.adGroupName || p.name } : {}),
        ...(p.status          ? { status:          p.status }          : {}),
        // cpcBid = wizard field (₹/$ amount), cpcBidMicros = already in micros, bidAmount = alias
        ...(p.cpcBidMicros    ? { cpcBidMicros:    p.cpcBidMicros }    :
            p.cpcBid          ? { cpcBidMicros:    Math.round(Number(p.cpcBid) * 1_000_000) } :
            p.bidAmount       ? { cpcBidMicros:    Math.round(Number(p.bidAmount) * 1_000_000) } : {}),
        ...(p.targeting       ? { targeting:       p.targeting }       : {}),
        ...(p.keywords        ? { keywords:        p.keywords }        : {}),
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

          return { headlines: headlineCandidates, descriptions: descCandidates, finalUrl };
        }

        // DISPLAY / YOUTUBE_REACH / DEMAND_GEN — single headline + description + imageUrl
        return {
          ...(rawHeadline               ? { headline:     rawHeadline }                          : {}),
          ...(rawDesc                   ? { description:  rawDesc }                              : {}),
          ...(creative.imageUrl         ? { imageUrl:     creative.imageUrl }                   : {}),
          ...(creative.callToAction || p.callToAction
                                        ? { callToAction: creative.callToAction || p.callToAction } : {}),
          finalUrl,
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

      try {
        await invalidateAllUserGoogleCache(rawGoogleUserId);
      } catch (e) {
        logger.warn(`[adsFactoryAuto:google] cache invalidation failed (non-fatal): ${e.message}`);
      }

      return { adId: createdAdIds.join(",") };
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

    await new Promise((r) => setTimeout(r, POLL_INTERVAL));
  }
  logger.error(`[adsFactoryAuto][poll] TIMEOUT after ${tick} ticks (${Math.round(timeoutMs / 1000)}s)  campaignId=${campaignId}`);
  throw new Error("Timeout: generation did not complete within 10 minutes");
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
      job.status = "completed";
      await job.save();
      const { cancelJob } = require("./adsFactoryAutoQueue");
      await cancelJob(job._id.toString());
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
      if (job.campaignId) {
        job.status = "paused";
        await job.save().catch((e) => logger.warn(`[adsFactoryAuto][2] could not save paused status: ${e.message}`));
      } else {
        logger.warn(`[adsFactoryAuto][2] job ${jobId} has no campaignId — skipping save, cancelling queue only`);
      }
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
      await job.save();
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
        await job.save();
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
        await job.save();
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
    rawTexts  = completedCampaign.results?.text?.slice(-pairsPerCycle)  || [];
    rawImages = completedCampaign.results?.image?.slice(-pairsPerCycle) || [];
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
          .then((result) => ({ platformName, adId: result.adId, ok: true }))
          .catch((platformErr) => {
            let errMsg = platformErr.message;
            if (platformName === "meta") {
              try {
                const { logMetaError } = require("../../controllers/adPosting/metaAdLauncher");
                const m = logMetaError(`AutoPilot ${platformName} post failed`, platformErr);
                errMsg = m.title || errMsg;
              } catch (_) {}
            }
            return { platformName, errMsg, ok: false };
          });
      });

    const postResults = await Promise.all(postTasks);
    for (const r of postResults) {
      if (r.ok) {
        postedAdIds[r.platformName] = r.adId;
        logger.info(`[adsFactoryAuto][8] ${r.platformName} ad posted OK  adId="${r.adId}"`);
      } else {
        logger.error(`[adsFactoryAuto][8] ${r.platformName} post FAILED: ${r.errMsg}`);
        platformErrors.push(`${r.platformName}: ${r.errMsg}`);
      }
    }

    const anyPosted = Object.keys(postedAdIds).length > 0;
    runStatus = platformErrors.length > 0
      ? (anyPosted ? "partial" : "failed")
      : "success";
    if (platformErrors.length) runError = platformErrors.join(" | ");

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
        error:         runError,
        automationCreatives: newCreatives || [],
        rawImages:     rawImages,
        rawTexts:      rawTexts,
      });
      job.totalRuns          = (job.totalRuns || 0) + 1;
      job.schedule.lastRunAt = new Date();
      if (runStatus === "failed") job.failedRuns = (job.failedRuns || 0) + 1;

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
        // Only update nextRunAt for repeating jobs — does_not_repeat already cleared it above
        const nextTime = job.schedule?.frequency !== "does_not_repeat" ? await getNextRunTime(jobId) : null;
        if (nextTime) {
          job.schedule.nextRunAt = nextTime;
          logger.debug(`[adsFactoryAuto][9] nextRunAt=${nextTime}`);
        } else {
          logger.debug(`[adsFactoryAuto][9] nextRunAt=null (does_not_repeat or no future run)`);
        }
      } catch (e) {
        logger.warn(`[adsFactoryAuto][9] could not update nextRunAt: ${e.message}`);
      }

      await job.save();
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
  }

  _runningJobs.delete(jobId);
  logger.info(`[adsFactoryAuto] ■ run END  jobId=${jobId}  runId=${runId}  finalStatus=${runStatus}  durationMs=${Date.now() - startedAt.getTime()}`);
}

const adsFactoryOrchestrator = { run };
module.exports = { adsFactoryOrchestrator, _runningJobs };
