/**
 * adControllerV2 — Ad Factory post-ads endpoint, v2.
 *
 * The legacy `adController.createAd` used a single `link_data` creative
 * shape for every campaign, which broke Lead Gen and App Promotion ads
 * (they need lead_gen_form / app_link object_story_specs). V2 fixes that
 * by deriving the correct (objective × conversionLocation) "cell" from
 * the existing Meta campaign + ad set, then building the creative via
 * the same cell-aware utilities the V2 wizard uses
 * (`utils/objectStorySpec.js` + `config/wizardSchema.js`).
 *
 * Scope of V2 (now): OUTCOME_TRAFFIC, OUTCOME_LEADS, OUTCOME_APP_PROMOTION.
 * Other objectives flow through the V1 endpoint until migrated.
 *
 * Flow:
 *   1. Validate body (Joi).
 *   2. Load the AdsGPT user's Facebook token, init the SDK.
 *   3. Fetch the Meta campaign + ad set so we can READ the objective +
 *      destination_type + promoted_object — no guessing.
 *   4. Infer the wizard cell from (objective, destination_type).
 *   5. For each ad: upload the image, build object_story_spec via
 *      `buildObjectStorySpec`, create the AdCreative + Ad.
 *   6. Persist to PostedAd + the AdFactory campaign doc, invalidate caches.
 */

const Joi = require("joi");
const axios = require("axios");
const bizSdk = require("facebook-nodejs-business-sdk");
const AdAccount = bizSdk.AdAccount;

const FBUsers = require("../../Module/adPosting/facebookUsers");
const PostedAd = require("../../Module/adPosting/postedAds");
const CampaignModel = require("../../Module/adFactory/adFactory");
const { decrypt } = require("../../utils/crypto");
const logger = require("../../utils/logger");
const { buildObjectStorySpec } = require("../../utils/objectStorySpec");
const { waitForVideoThumbnail } = require("../../utils/videoThumbnail");
const {
  inferCellForMetaCampaign,
  destinationToConversionLocation,
} = require("./cellInference");
const {
  invalidateAfterCreate,
  formatMetaError,
} = require("./metaAdLauncher");

// ── Joi: batch request shape ────────────────────────────────────────────
const adFactoryV2Schema = Joi.object({
  accountId: Joi.string().required(), // FBUsers _id (NOT the AdsGPT user id)
  adAccountId: Joi.string().required(),
  pageId: Joi.string().required(),
  adFactoryCampaignId: Joi.string().optional().allow("", null),
  campaignDetails: Joi.object({
    campaignId: Joi.string().required(),
  }).required(),
  adSetDetails: Joi.object({
    adSetId: Joi.string().required(),
  }).required(),
  leadFormId: Joi.string().optional().allow("", null),
  ads: Joi.array()
    .items(
      Joi.object({
        // Exactly one of imageUrl or videoUrl must be provided per ad.
        imageUrl: Joi.string().trim().uri().optional(),
        videoUrl: Joi.string().trim().uri().optional(),
        // Allow null + empty string — both mean "fetch from Meta" via
        // waitForVideoThumbnail downstream.
        videoThumbnailUrl: Joi.string().trim().uri().optional().allow("", null),
        headline: Joi.string().allow("").optional(),
        message: Joi.string().allow("").optional(),
        description: Joi.string().allow("").optional(),
        linkUrl: Joi.string().trim().uri().allow("").optional(),
        callToAction: Joi.string().optional(),
        adFactoryCreativeId: Joi.string().allow(null, "").optional(),
      }).xor("imageUrl", "videoUrl"), // exactly one required
    )
    .min(1)
    .required(),
}).unknown(true);

// Cell inference (objective × destination → wizard cell) lives in the
// shared ./cellInference module — reused by campaign management's
// resolve-cell endpoint so both stay in lockstep.

// Upload an image to the ad account from a URL.
async function uploadImageFromUrl(account, imageUrl) {
  const res = await axios.get(imageUrl, {
    responseType: "arraybuffer",
    timeout: 15000,
  });
  const bytes = Buffer.from(res.data).toString("base64");
  const out = await account.createAdImage([], { bytes, name: "ad-image.jpg" });
  if (out?.hash) return out.hash;
  if (out?.images) {
    const k = Object.keys(out.images)[0];
    if (k && out.images[k]?.hash) return out.images[k].hash;
  }
  throw new Error("Image upload succeeded but no hash was returned by Meta");
}

// Upload a video from a URL and poll until Meta finishes encoding it.
// Returns { videoId, videoThumbnailUrl }.
async function uploadVideoFromUrl(account, videoUrl) {
  const res = await axios.get(videoUrl, {
    responseType: "arraybuffer",
    timeout: 60000,
  });
  const fileBytes = Buffer.from(res.data);

  const accessToken = bizSdk.FacebookAdsApi.getDefaultApi().accessToken;
  const advideosUrl = `https://graph.facebook.com/v24.0/${account.id}/advideos`;

  // 1. Start Phase
  const startBody = new URLSearchParams({
    upload_phase: "start",
    file_size: String(fileBytes.length),
    access_token: accessToken,
  });
  const startResp = await axios.post(advideosUrl, startBody.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    timeout: 30000,
  });
  const {
    upload_session_id: sessionId,
    video_id: videoId,
    start_offset: startOffsetRaw,
    end_offset: endOffsetRaw,
  } = startResp.data || {};
  if (!sessionId || !videoId) {
    throw new Error("Meta resumable upload: start phase returned no session");
  }

  const NodeFormData = require("form-data");

  // 2. Transfer Phase
  let start = Number(startOffsetRaw);
  let end = Number(endOffsetRaw);
  while (start < end) {
    const chunk = fileBytes.subarray(start, end);
    const form = new NodeFormData();
    form.append("upload_phase", "transfer");
    form.append("upload_session_id", sessionId);
    form.append("start_offset", String(start));
    form.append("access_token", accessToken);
    form.append("video_file_chunk", chunk, { filename: `chunk-${start}.mp4`, contentType: "video/mp4" });

    const r = await axios.post(advideosUrl, form, {
      headers: form.getHeaders(),
      timeout: 60000,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });
    const nextStart = Number(r.data?.start_offset);
    const nextEnd = Number(r.data?.end_offset);
    if (Number.isNaN(nextStart) || Number.isNaN(nextEnd)) {
      throw new Error("Meta resumable upload: transfer phase returned no offsets");
    }
    if (nextStart === start && nextEnd === end) {
      throw new Error("Meta resumable upload: offsets not advancing");
    }
    start = nextStart;
    end = nextEnd;
  }

  // 3. Finish Phase
  const finishBody = new URLSearchParams({
    upload_phase: "finish",
    upload_session_id: sessionId,
    access_token: accessToken,
  });
  const finishResp = await axios.post(advideosUrl, finishBody.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    timeout: 30000,
  });
  if (finishResp.data?.success !== true) {
    throw new Error("Meta resumable upload: finish phase did not return success");
  }

  // Poll until Meta finishes encoding (status: ready).
  const MAX_POLLS = 3;
  const POLL_INTERVAL_MS = 2000;
  let thumbnailUrl = null;
  for (let attempt = 0; attempt < MAX_POLLS; attempt++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const info = await new bizSdk.AdVideo(videoId).read(["status", "thumbnails"]);
    const data = info?._data || info || {};
    const status = data?.status?.video_status || data?.status;
    if (status === "ready") {
      // Grab the first auto-generated thumbnail Meta produced.
      const thumbs = data?.thumbnails?.data || [];
      if (thumbs.length > 0) thumbnailUrl = thumbs[0].uri || thumbs[0].url || null;
      break;
    }
    if (status === "error") {
      throw new Error(`Meta video encoding failed for video id ${videoId}`);
    }
  }

  return { videoId, videoThumbnailUrl: thumbnailUrl };
}

async function createAdV2(req, res) {
  try {
    // Legacy clients sometimes JSON-stringify nested objects. Normalise.
    const parseIfString = (v) => {
      if (typeof v !== "string") return v;
      try {
        return JSON.parse(v);
      } catch {
        return v;
      }
    };
    if (req.body.campaignDetails)
      req.body.campaignDetails = parseIfString(req.body.campaignDetails);
    if (req.body.adSetDetails)
      req.body.adSetDetails = parseIfString(req.body.adSetDetails);
    if (req.body.ads) req.body.ads = parseIfString(req.body.ads);

    const { error, value } = adFactoryV2Schema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: error.details[0].context?.message || error.details[0].message,
      });
    }

    const {
      accountId,
      adAccountId,
      pageId,
      adFactoryCampaignId,
      campaignDetails: { campaignId },
      adSetDetails: { adSetId },
      leadFormId,
      ads,
    } = value;

    // ── AdFactory campaign doc (optional — only needed when adFactoryCampaignId is provided) ──
    let campaignDoc = null;
    if (adFactoryCampaignId) {
      campaignDoc = await CampaignModel.findById(adFactoryCampaignId);
      if (!campaignDoc) {
        return res
          .status(404)
          .json({ success: false, error: "AdFactory Campaign not found" });
      }
    }

    // ── Facebook user + access token ──────────────────────────────────────
    const fbUser = await FBUsers.findById(accountId);
    if (!fbUser) {
      return res
        .status(404)
        .json({ success: false, error: "Facebook user not found" });
    }
    const accessToken = decrypt(fbUser.accessToken);
    if (!accessToken) {
      return res
        .status(401)
        .json({ success: false, error: "Facebook access token is missing" });
    }

    const api = bizSdk.FacebookAdsApi.init(accessToken);
    bizSdk.FacebookAdsApi.setDefaultApi(api);
    const account = new AdAccount(`act_${adAccountId}`);

    // ── Read campaign + ad set from Meta — we need objective +
    //    destination_type + promoted_object to pick the right cell. ──
    let metaCampaign;
    let metaAdSet;
    try {
      metaCampaign = await new bizSdk.Campaign(campaignId).get([
        "id",
        "objective",
        "name",
        "status",
      ]);
      metaAdSet = await new bizSdk.AdSet(adSetId).get([
        "id",
        "destination_type",
        "promoted_object",
        "optimization_goal",
        "name",
      ]);
    } catch (err) {
      const m = formatMetaError(err);
      logger.error(
        `createAdV2 fetch-context error: ${m.message} [code=${m.code}] [subcode=${m.subcode}]`,
      );
      return res.status(400).json({
        success: false,
        error: m.title
          ? `${m.title}: ${m.message}`
          : "Couldn't load the selected campaign or ad set from Meta",
        details: m,
      });
    }

    const campaignData = metaCampaign?._data || metaCampaign || {};
    const adSetData = metaAdSet?._data || metaAdSet || {};
    const cellInfo = inferCellForMetaCampaign(campaignData, adSetData);
    if (cellInfo.error) {
      return res.status(400).json({ success: false, error: cellInfo.error });
    }
    const { objective, conversionLocation, cell } = cellInfo;

    // Production gate: posting ads to Leads campaigns needs the Meta
    // `pages_manage_ads` permission (required to attach a
    // lead_gen_form_id to a creative + read the leadgen_forms edge).
    // The permission is under Meta review for the AdsGPT app — until it
    // lands, reject Leads posts cleanly here, BEFORE any Meta call, so
    // users get a readable explanation instead of a raw permission
    // error. Flip `FEATURE_LEADS_POSTING=true` once the permission is
    // granted; no code change needed.
    const LEADS_POSTING_ENABLED =
      process.env.FEATURE_LEADS_POSTING === "true";
    if (!LEADS_POSTING_ENABLED && objective === "OUTCOME_LEADS") {
      return res.status(400).json({
        success: false,
        error: "Lead campaigns aren't available yet",
        details:
          "We're getting Lead campaign support ready and it'll be enabled soon. For now, please pick a Traffic or App Promotion campaign to post your ads.",
      });
    }

    logger.info(
      `createAdV2: ${ads.length} ad(s) under ${objective}/${conversionLocation} ` +
        `(account ${adAccountId}, page ${pageId}, adset ${adSetId})`,
    );

    // App linkage flows from the ad set's promoted_object — we re-use what
    // the original campaign was built with, so the user doesn't have to
    // re-pick the app in Ad Factory.
    const promotedObject = adSetData.promoted_object || {};
    const applicationId = promotedObject.application_id || null;
    const objectStoreUrl = promotedObject.object_store_url || null;

    // Cell-level prerequisite checks — surface clean 400s BEFORE we start
    // uploading images / creating creatives. Saves the user from a
    // half-launched batch.
    const requiredAdFields = new Set(cell.ad.requiredFields || []);
    if (requiredAdFields.has("leadFormId") && !leadFormId) {
      return res.status(400).json({
        success: false,
        error: "Lead Form is required",
        details:
          "The selected campaign uses Instant Forms — pick a Lead Form for this batch before launching.",
      });
    }
    if (
      cell.ad.objectStorySpecShape === "app_link" &&
      (!applicationId || !objectStoreUrl)
    ) {
      return res.status(400).json({
        success: false,
        error: "App linkage missing on the selected ad set",
        details:
          "Couldn't read application_id / object_store_url from the ad set's promoted_object. Pick an App Promotion ad set created with an app linkage.",
      });
    }

    // ── Per-ad loop ───────────────────────────────────────────────────────
    const createdAds = [];
    const errors = [];
    for (let i = 0; i < ads.length; i++) {
      const adData = ads[i];
      try {
        logger.info(`createAdV2: processing ad ${i + 1}/${ads.length}`);

        let mediaParams;
        if (adData.videoUrl) {
          logger.info(`createAdV2: ad ${i + 1} — uploading video...`);
          const { videoId, videoThumbnailUrl } = await uploadVideoFromUrl(account, adData.videoUrl);
          logger.info(`createAdV2: ad ${i + 1} — video ready, id: ${videoId}`);
          let resolvedThumbnailUrl =
            adData.videoThumbnailUrl || videoThumbnailUrl || null;

          // Last-chance thumbnail wait. `uploadVideoFromUrl` polls for
          // ~6s; longer clips don't always have thumbnails ready in that
          // window. The shared `waitForVideoThumbnail` retries the
          // `/{video_id}/thumbnails` edge with delays (24s ceiling) so
          // Meta has time to finish encoding. Without it, the creative
          // call fails with subcode 1443226 ("Your ad needs a video
          // thumbnail").
          if (videoId && !resolvedThumbnailUrl) {
            resolvedThumbnailUrl = await waitForVideoThumbnail(videoId);
          }

          mediaParams = {
            videoId,
            videoThumbnailUrl: resolvedThumbnailUrl || undefined,
          };
        } else {
          const imageHash = await uploadImageFromUrl(account, adData.imageUrl);
          logger.info(`createAdV2: ad ${i + 1} — image hash: ${imageHash}`);
          mediaParams = { imageHash };
        }

        const objectStorySpec = buildObjectStorySpec(
          cell.ad.objectStorySpecShape,
          {
            pageId,
            ...mediaParams,
            headline: adData.headline || "",
            primaryText: adData.message || "",
            description: adData.description || "",
            callToAction:
              adData.callToAction || cell.ctas?.default || "LEARN_MORE",
            linkUrl: adData.linkUrl || undefined,
            leadFormId: leadFormId || undefined,
            objectStoreUrl: objectStoreUrl || undefined,
            applicationId: applicationId || undefined,
          },
        );

        const creative = await account.createAdCreative([], {
          name: `Creative - ${Date.now()}-${i}`,
          object_story_spec: objectStorySpec,
        });

        const ad = await account.createAd([], {
          name: `Ad - ${Date.now()}-${i}`,
          adset_id: adSetId,
          creative: { creative_id: creative.id },
          // Ad Factory launches go live immediately — Meta still holds
          // the ad in its own review queue before serving impressions, so
          // ACTIVE here just skips the user from having to flip the
          // switch in Ads Manager after a successful post.
          status: "ACTIVE",
        });

        await PostedAd.create({
          userId: accountId,
          facebookAdId: ad.id,
          adAccountId,
          campaignId,
          adSetId,
          creativeId: creative.id,
          pageId,
          status: "ACTIVE",
          content: {
            headline: adData.headline,
            message: adData.message,
            linkUrl: adData.linkUrl,
            callToAction: adData.callToAction,
            imageUrl: adData.imageUrl || null,
            videoUrl: adData.videoUrl || null,
          },
          metaData: {
            objective,
            conversionLocation,
            campaignId,
            adSetId,
            leadFormId: leadFormId || undefined,
          },
          adFactoryCampaignId,
          adFactoryCreativeId: adData.adFactoryCreativeId || null,
        });

        createdAds.push({
          index: i,
          adId: ad.id,
          creativeId: creative.id,
          imageHash: mediaParams.imageHash || null,
          videoId: mediaParams.videoId || null,
          headline: adData.headline,
        });
      } catch (err) {
        const m = formatMetaError(err);
        logger.error(
          `createAdV2 ad ${i + 1}: ${m.message}` +
            (m.code ? ` [code=${m.code}]` : "") +
            (m.subcode ? ` [subcode=${m.subcode}]` : "") +
            (m.fbtraceId ? ` [fbtrace=${m.fbtraceId}]` : ""),
        );
        errors.push({
          index: i,
          error: m.message,
          title: m.title,
          code: m.code,
          subcode: m.subcode,
          fbtraceId: m.fbtraceId,
          adData,
        });
      }
    }

    // ── Update the AdFactory campaign doc (single write at the end) ──
    if (adFactoryCampaignId) await CampaignModel.findByIdAndUpdate(adFactoryCampaignId, {
      $set: {
        "fbMetaData.adAccountId": adAccountId,
        "fbMetaData.pageId": pageId,
        "fbMetaData.campaignId": campaignId,
        "fbMetaData.adSetId": adSetId,
        "fbMetaData.objective": objective,
        "fbMetaData.conversionLocation": conversionLocation,
        "fbMetaData.status": createdAds.length > 0 ? "success" : "failed",
        "fbMetaData.launchedAt": new Date(),
      },
    });

    // ── Cache invalidation — best-effort, never fail the request. ──
    try {
      await invalidateAfterCreate(fbUser.userId, {
        adAccountId,
        campaignId,
        adSetId,
      });
    } catch (cacheErr) {
      logger.warn(
        `createAdV2 cache invalidation failed (non-fatal): ${cacheErr.message}`,
      );
    }

    if (createdAds.length === 0 && errors.length > 0) {
      const first = errors[0];
      return res.status(400).json({
        success: false,
        error: first.title
          ? `${first.title}: ${first.error}`
          : first.error || "Failed to create ads",
        message: `Failed to create any of the ${ads.length} ads`,
        data: {
          objective,
          conversionLocation,
          campaignId,
          adSetId,
          createdAds: [],
          errors,
        },
      });
    }

    return res.json({
      success: true,
      message: `Created ${createdAds.length} out of ${ads.length} ads successfully`,
      data: {
        objective,
        conversionLocation,
        campaignId,
        adSetId,
        createdAds,
        errors: errors.length > 0 ? errors : undefined,
        status: "ACTIVE",
        note: "Ads are launched ACTIVE. Meta will start serving impressions after its own ad review passes.",
      },
    });
  } catch (err) {
    const m = formatMetaError(err);
    logger.error(
      `createAdV2 fatal: ${m.message}` +
        (m.code ? ` [code=${m.code}]` : "") +
        (m.subcode ? ` [subcode=${m.subcode}]` : "") +
        (m.fbtraceId ? ` [fbtrace=${m.fbtraceId}]` : ""),
    );
    const isClientError =
      err?.status === 400 ||
      err?.status === 401 ||
      err?.status === 403 ||
      m.type === "OAuthException";
    return res.status(isClientError ? 400 : 500).json({
      success: false,
      error: m.title ? `${m.title}: ${m.message}` : m.message,
      details: m,
    });
  }
}

module.exports = {
  createAdV2,
  uploadImageFromUrl,
  inferCellForMetaCampaign,
  destinationToConversionLocation,
};
