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

      const fbUser = await FBUsers.findOne({ userId: job.userId });
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
      
      const tsName = `Auto — ${new Date().toISOString().slice(0, 10)}`;
      
      // 1. Call createCampaignV2
      const campaignPayload = {
        ...template.payload,
        name: `${template.payload.name} — ${tsName}`
      };
      const campaignRes = await executeController(metaAdControllerV2.createCampaignV2, campaignPayload);
      usedCampaignId = campaignRes.campaign.id;

      // 2. Call createAdSetV2
      const adSetPayload = {
        ...template.payload,
        name: `${template.payload.name} — ${tsName}`,
        campaignId: usedCampaignId
      };
      const adSetRes = await executeController(metaAdControllerV2.createAdSetV2, adSetPayload);
      usedAdSetId = adSetRes.adSet.id;
      pageId = template.payload.pageId;
      leadFormId = template.payload.leadFormId;

      const { getCell } = require("../../config/wizardSchema");
      const cellInfo = {
        objective: template.objective,
        conversionLocation: template.conversionLocation,
        cell: getCell(template.objective, template.conversionLocation),
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
        
        logger.info(`[adsFactoryAuto:meta] uploading image — ${(creative.imageUrl || "").slice(0, 120)}`);
        const imageHash = await uploadImageFromUrl(account, creative.imageUrl);
        logger.info(`[adsFactoryAuto:meta] image hash: ${imageHash}`);
        const adName = `Automation Ad ${i+1} — ${tsName}`;
        const adPayload = {
          ...template.payload,
          name: adName,
          adSetId: usedAdSetId,
          imageHash: imageHash,
          headline: creative.headline || "",
          primaryText: creative.message || "",
          description: creative.description || "",
          // Use creative's explicit CTA if available, otherwise fall back to the template's CTA
          callToAction: creative.callToAction || template.payload.callToAction || "LEARN_MORE",
          // Use creative's linkUrl if available, otherwise fall back to template's linkUrl
          linkUrl: creative.linkUrl || template.payload.linkUrl,
          // Clear any explicit media URLs so the V2 controller relies solely on our pre-uploaded imageHash
          imageUrl: undefined,
          videoId: undefined,
          videoThumbnailUrl: undefined,
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
      return { adId: createdAdIds.join(",") }; // Returns comma separated string for platformAdIds
    },
  },

};

// ─── Generation helpers ───────────────────────────────────────────────────────

async function waitForGenerationComplete(campaignId, timeoutMs = 1000_000) {
  const POLL_INTERVAL = 5_000;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const campaign = await Campaign.findOne({ "metadata.campaignId": campaignId }).lean();
    if (!campaign) {
      throw new Error(`Campaign ${campaignId} disappeared while polling`);
    }

    const allDone = (campaign.services?.servicesSelected || []).every(
      (srv) => (srv.generated || 0) >= (srv.serviceParams?.quantity || 0)
    );
    if (allDone) return campaign;
    if (campaign.results?.status === "error" || campaign.status === "error") {
      throw new Error("Campaign generation failed (status updated to error)");
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL));
  }
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

  try {
    // 1. Load job
    job = await AdsFactoryJob.findById(jobId);
    if (!job) throw new Error(`AdsFactoryJob ${jobId} not found`);
    if (job.status !== "active") {
      logger.info(`[adsFactoryAuto] job ${jobId} is ${job.status}, skipping`);
      _runningJobs.delete(jobId);
      return;
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
        logger.info(`[adsFactoryAuto] job ${jobId} skipping — only ${Math.round(elapsed / 86400000)}d elapsed of required ${sched.customFrequency.repeatEvery * 7}d`);
        _runningJobs.delete(jobId);
        return;
      }
    }

    // Auto-complete if endDate passed
    if (job.schedule.endDate && new Date() > new Date(job.schedule.endDate)) {
      job.status = "completed";
      await job.save();
      const { cancelJob } = require("./adsFactoryAutoQueue");
      await cancelJob(job._id.toString());
      logger.info(`[adsFactoryAuto] job ${jobId} reached endDate, completed`);
      _runningJobs.delete(jobId);
      return;
    }

    // 2. Load campaign
    campaign = await Campaign.findById(job.campaignId).lean();
    if (!campaign) throw new Error(`Campaign ${job.campaignId} not found`);

    // Guard: skip if a previous tick's generation is still in-progress — avoids
    // overlapping Python runs on the same campaign when the schedule fires faster
    // than generation completes (e.g. during testing with 1-min cron).
    if (campaign.results?.status === "in-progress" || campaign.status === "in-progress") {
      logger.warn(`[adsFactoryAuto] job ${jobId} campaign ${campaign.metadata?.campaignId} still generating — skipping tick`);
      _runningJobs.delete(jobId);
      return;
    }

    const campaignId     = campaign.metadata?.campaignId;
    const userId         = job.userId;
    const pairsPerCycle  = job.pairsPerCycle  || 1;
    const model          = job.model          || null;

    // 3. Credit check
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
    if (!creditResult.success && creditResult.code === 400) {
      job.status = "paused";
      await job.save();
      throw new Error(`Insufficient credits: ${creditResult.message}`);
    }

    // Atomic freeze for the autopilot-driven generation. Receipt key is the
    // campaignId; updateGenerationResult / deleteCampaign release the hold
    // after per-batch deducts settle the actual cost.
    if (creditResult?.totalRequired > 0 && creditResult?.userId) {
      const freeze = await UnifiedCreditController.freezeCredits({
        userId: creditResult.userId,
        reservationKey: `campaign:${campaign.metadata.campaignId}`,
        amount: creditResult.totalRequired,
        meta: {
          service_type: "adfactory_campaign_autopilot",
          campaignId: campaign.metadata.campaignId,
        },
      });
      if (!freeze.ok && freeze.reason === "INSUFFICIENT") {
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
          `[autopilot] campaign freeze failed (${freeze.reason}) for ${campaign.metadata.campaignId}`,
        );
        job.status = "paused";
        await job.save();
        throw new Error(`Credit freeze failed: ${freeze.reason}`);
      }
    }

    // 4. Update the ORIGINAL CAMPAIGN to avoid duplicate campaigns
    // We update the services parameters and append new slots to the results array.
    const updatedServices = (campaign.services?.servicesSelected || []).map((srv) => ({
      ...srv,
      serviceParams: {
        ...srv.serviceParams,
        quantity: srv.serviceName === "video" ? (srv.serviceParams?.quantity || 0) : pairsPerCycle,
        ...(model ? { model } : {}),
      },
      generated: 0,
    }));

    // Force all required nodes to "success" so sendAdFactoryRequest passes its
    // node-check — a draft/new campaign may have some nodes still in "draft" status.
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
      await Campaign.updateOne(
        { "metadata.campaignId": campaign.metadata.campaignId },
        { $push: pushUpdate, $set: { "results.status": "in-progress", status: "in-progress" } }
      );
    }

    // 5. Send to Python (targeting the original campaign)
    let completedCampaign;
    try {
      const pythonResult = await ctrl.sendAdFactoryRequest(campaign.metadata.campaignId, "autopilot", "active", job._id.toString());
      if (!pythonResult?.allNodesSuccess) {
        throw new Error(`Python API rejected: ${pythonResult?.message || pythonResult?.error || "unknown"}`);
      }

      // 6. Poll until Python writes results back
      completedCampaign = await waitForGenerationComplete(campaign.metadata.campaignId);
    } catch (err) {
      // Rollback the campaign status so it isn't stuck 'in-progress' forever
      await Campaign.updateOne(
        { "metadata.campaignId": campaign.metadata.campaignId },
        { $set: { status: "error", "results.status": "error" } }
      );
      throw err;
    }

    const metaPayload = job.targets?.meta?.template?.payload || {};
    const ctaList = metaPayload.callToAction ? [metaPayload.callToAction] : [];
    newCreatives = buildCreativesFromResults(completedCampaign, ctaList, metaPayload.linkUrl || "", pairsPerCycle);
    rawTexts  = completedCampaign.results?.text?.slice(-pairsPerCycle)  || [];
    rawImages = completedCampaign.results?.image?.slice(-pairsPerCycle) || [];

    // Save the newly assembled creatives to the campaign in MongoDB immediately so they are visible on the frontend
    if (newCreatives && newCreatives.length > 0) {
      try {
        await Campaign.updateOne(
          { "metadata.campaignId": campaign.metadata.campaignId },
          { 
            $push: { creatives: { $each: newCreatives } },
            $set: { status: "success", "results.status": "success" }
          }
        );
        logger.info(`[adsFactoryAuto] Saved ${newCreatives.length} generated creatives to campaign ${campaign.metadata.campaignId}`);
      } catch (saveCreativesErr) {
        logger.error(`[adsFactoryAuto] failed to save creatives to campaign: ${saveCreativesErr.message}`);
      }
    }

    // 8. Post to each configured platform
    const targets        = job.targets || {};
    const platformErrors = [];

    for (const [platformName, poster] of Object.entries(PLATFORM_POSTERS)) {
      const target = targets[platformName];

      if (!poster.isConfigured(target)) continue; // not configured — skip silently

      try {
        const result = await poster.post(target, job, newCreatives, completedCampaign);
        postedAdIds[platformName] = result.adId;
        logger.info(`[adsFactoryAuto] ${platformName} ad posted: ${result.adId}`);
      } catch (platformErr) {
        let errMsg = platformErr.message;
        if (platformName === "meta") {
          try {
            const { logMetaError } = require("../../controllers/adPosting/metaAdLauncher");
            const m = logMetaError(`AutoPilot ${platformName} post failed`, platformErr);
            errMsg = m.title || errMsg;
          } catch (_) {}
        }
        logger.error(`[adsFactoryAuto:${platformName}] post failed: ${errMsg}`);
        platformErrors.push(`${platformName}: ${errMsg}`);
      }
    }

    const anyPosted = Object.keys(postedAdIds).length > 0;
    runStatus = platformErrors.length > 0
      ? (anyPosted ? "partial" : "failed")
      : "success";
    if (platformErrors.length) runError = platformErrors.join(" | ");

  } catch (err) {
    runError  = err.message;
    runStatus = "failed";
    logger.error(`[adsFactoryAuto:orchestrator] run ${runId} failed: ${err.message}`);
  }

  // 9. Save run history
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

      try {
        const { getNextRunTime } = require("./adsFactoryAutoQueue");
        const nextTime = await getNextRunTime(jobId);
        if (nextTime) job.schedule.nextRunAt = nextTime;
      } catch (e) {
        logger.warn(`[adsFactoryAuto] could not update nextRunAt: ${e.message}`);
      }

      await job.save();

    } catch (saveErr) {
      logger.error(`[adsFactoryAuto:orchestrator] save history failed: ${saveErr.message}`);
    }

    // 10. Real-time notification via Socket.IO — always fires, even if save failed
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
          logger.info(`[adsFactoryAuto] emitted adsFactory:runComplete to user ${job.userId}`);

          if (job.campaignId) {
            const campIdStr = job.campaignId.toString();
            global.io.to(campIdStr).emit("adsFactory:runComplete", socketPayload);
            logger.info(`[adsFactoryAuto] emitted adsFactory:runComplete to campaign room ${campIdStr}`);
          }
        } catch (e) {
          logger.error(`[adsFactoryAuto] failed to emit activity socket: ${e.message}`);
        }
      }
  }

  _runningJobs.delete(jobId);
}

const adsFactoryOrchestrator = { run };
module.exports = { adsFactoryOrchestrator };
