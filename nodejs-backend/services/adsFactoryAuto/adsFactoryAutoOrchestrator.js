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
    isConfigured: (target) => !!(target?.adAccountId && target?.pageId && target?.adSetId?.length > 0),

    post: async (target, job, creatives, campaign) => {
      const { adAccountId, pageId, leadFormId, campaignId: metaCampaignId } = target;

      const adSetIds = target.adSetId && target.adSetId.length > 0 ? target.adSetId : [];
      if (adSetIds.length === 0) throw new Error("No ad set configured on this job — set targets.meta.adSetId");

      const creative = creatives.find((c) => c.imageUrl) || creatives[0];
      if (!creative) throw new Error("No creative available");
      if (!creative.imageUrl) throw new Error("No image was generated for this cycle — ad cannot be posted without an image");

      // ── FB user + access token ────────────────────────────────────────────
      const fbUser = await FBUsers.findOne({ userId: job.userId });
      if (!fbUser) throw new Error(`No Facebook account linked for user ${job.userId}`);
      const accessToken = decrypt(fbUser.accessToken);
      if (!accessToken) throw new Error("Facebook access token is missing");

      const api = bizSdk.FacebookAdsApi.init(accessToken);
      bizSdk.FacebookAdsApi.setDefaultApi(api);
      const account = new AdAccount(`act_${adAccountId}`);

      // ── Fetch Meta campaign + first ad set → infer cell ──────────────────
      const metaCampaign = await new bizSdk.Campaign(metaCampaignId).get(["id", "objective", "name", "status"]);
      const firstAdSet   = await new bizSdk.AdSet(adSetIds[0]).get(["id", "destination_type", "promoted_object", "optimization_goal", "name"]);
      const campaignData = metaCampaign?._data || metaCampaign || {};
      const firstAdSetData = firstAdSet?._data || firstAdSet || {};

      const cellInfo = inferCellForMetaCampaign(campaignData, firstAdSetData);
      if (cellInfo.error) throw new Error(cellInfo.error);
      const { objective, conversionLocation, cell } = cellInfo;

      const promotedObject = firstAdSetData.promoted_object || {};
      const applicationId  = promotedObject.application_id  || null;
      const objectStoreUrl = promotedObject.object_store_url || null;

      // ── Upload image ──────────────────────────────────────────────────────
      logger.info(`[adsFactoryAuto:meta] uploading image — ${(creative.imageUrl || "").slice(0, 120)}`);
      const imageHash = await uploadImageFromUrl(account, creative.imageUrl);
      logger.info(`[adsFactoryAuto:meta] image hash: ${imageHash}`);

      const ctaType = (creative.callToAction || "LEARN_MORE").toUpperCase().replace(/\s+/g, "_");
      const adName  = `Automation Ads — ${new Date().toISOString().slice(0, 10)}`;

      const objectStorySpec = buildObjectStorySpec(cell.ad.objectStorySpecShape, {
        pageId,
        imageHash,
        headline:       creative.headline    || "",
        primaryText:    creative.message     || "",
        description:    creative.description || "",
        callToAction:   ctaType,
        linkUrl:        creative.linkUrl     || undefined,
        leadFormId:     leadFormId           || undefined,
        objectStoreUrl: objectStoreUrl       || undefined,
        applicationId:  applicationId       || undefined,
      });

      const adCreative = await account.createAdCreative([], {
        name: `${adName} — creative`,
        object_story_spec: objectStorySpec,
      });

      // ── Try each ad set in order, rotate on 50-ad limit ──────────────────
      let startIndex = target.activeAdSetIndex || 0;
      if (startIndex >= adSetIds.length) startIndex = 0;

      let ad = null;
      let usedAdSetId = null;

      for (let i = startIndex; i < adSetIds.length; i++) {
        const candidateAdSetId = adSetIds[i];
        try {
          ad = await account.createAd([], {
            name:     adName,
            adset_id: candidateAdSetId,
            creative: { creative_id: adCreative.id },
            status:   "ACTIVE",
          });
          usedAdSetId = candidateAdSetId;

          // If we advanced the index, persist it so next run starts here
          if (i !== startIndex) {
            await AdsFactoryJob.updateOne(
              { _id: job._id },
              { $set: { "targets.meta.activeAdSetIndex": i } }
            );
            logger.info(`[adsFactoryAuto:meta] rotated to ad set index ${i} (${candidateAdSetId})`);
          }
          break;
        } catch (err) {
          const isLimitError = err?.message?.includes("Too many ads") ||
                               JSON.stringify(err).includes("1487809");
          if (isLimitError) {
            logger.warn(`[adsFactoryAuto:meta] ad set ${candidateAdSetId} is full (50 ads limit), trying next`);
            continue;
          }
          throw err; // any other error — surface it
        }
      }

      // All ad sets full — pause the job
      if (!ad) {
        await AdsFactoryJob.updateOne({ _id: job._id }, { $set: { status: "paused" } });
        const { cancelJob } = require("./adsFactoryAutoQueue");
        await cancelJob(job._id.toString());
        throw new Error("All ad sets are full (50 ads limit reached on every ad set) — job paused");
      }

      // ── Persist PostedAd + invalidate cache ──────────────────────────────
      await PostedAd.create({
        userId:       fbUser._id.toString(),
        facebookAdId: ad.id,
        adAccountId,
        campaignId:   metaCampaignId,
        adSetId:      usedAdSetId,
        creativeId:   adCreative.id,
        pageId,
        status:       "ACTIVE",
        content: {
          headline:     creative.headline,
          message:      creative.message,
          linkUrl:      creative.linkUrl,
          callToAction: ctaType,
          imageUrl:     creative.imageUrl || null,
        },
        metaData: { objective, conversionLocation, campaignId: metaCampaignId, adSetId: usedAdSetId, leadFormId: leadFormId || undefined },
        adFactoryCampaignId: campaign._id.toString(),
      });

      try {
        await invalidateAfterCreate(fbUser.userId, { adAccountId, campaignId: metaCampaignId, adSetId: usedAdSetId });
      } catch (e) {
        logger.warn(`[adsFactoryAuto:meta] cache invalidation failed (non-fatal): ${e.message}`);
      }

      logger.info(`[adsFactoryAuto:meta] ad created: ${ad.id} in ad set ${usedAdSetId}`);
      return { adId: ad.id };
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
    const callToAction   = job.callToAction   || []; // array
    const destinationUrl = job.destinationUrl || "";
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
        { $set: { "results.status": "error" } }
      );
      throw err;
    }

    newCreatives = buildCreativesFromResults(completedCampaign, callToAction, destinationUrl, pairsPerCycle);
    rawTexts  = completedCampaign.results?.text?.slice(-pairsPerCycle)  || [];
    rawImages = completedCampaign.results?.image?.slice(-pairsPerCycle) || [];

    // Save the newly assembled creatives to the campaign in MongoDB immediately so they are visible on the frontend
    if (newCreatives && newCreatives.length > 0) {
      try {
        await Campaign.updateOne(
          { "metadata.campaignId": campaign.metadata.campaignId },
          { 
            $push: { creatives: { $each: newCreatives } },
            $set: { "results.status": "success" }
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
            const { logMetaError } = metaLauncher();
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
