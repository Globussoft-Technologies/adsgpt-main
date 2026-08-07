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

const { resolveFacebookConnectionForRecord } = require('../../utils/metaConnection');

// Build a rich error string from a V2/Google controller's JSON error response.
//
// The controllers return { error, details, meta:{ code, subcode, fbtraceId } }.
// Previously executeController threw only `responseData.error`, which for Meta
// is often the generic fallback "Failed to create campaign" (metaErrorResponse
// uses `m.title || "Failed to ..."`, and Meta frequently returns NO title —
// e.g. an expired token sets only `message` + code 190). That dropped the one
// thing the user (and our permanent-error classifiers) actually need: Meta's
// real message + code/subcode. So the run-history card showed "Failed to create
// campaign" with no way to tell an expired token from a bad field.
//
// Now we keep the informative `details` (Meta's real message) when it adds
// signal over the generic title, and always append [code=N]/[subcode=N] so the
// isPermanentConfigError / friendlyPlatformError matchers downstream — which key
// off message text AND error codes — can classify it (e.g. code 190 → "reconnect
// your account", auto-pause instead of retrying + emailing every tick).
function buildControllerError(responseData) {
  if (!responseData) return "Unknown error";
  const title   = responseData.error;
  const details = responseData.details;
  const meta    = responseData.meta || {};
  // Prefer the specific message. If `details` exists and isn't just a copy of
  // the title, lead with it; otherwise fall back to the title. This turns a
  // blank-title 190 into "Error validating access token: ... [code=190]"
  // instead of the useless "Failed to create campaign".
  let base;
  if (details && details !== title) {
    base = title && !/^Failed to /i.test(title) ? `${title}: ${details}` : details;
  } else {
    base = title || details || JSON.stringify(responseData);
  }
  const codeTag = [
    meta.code    != null ? `[code=${meta.code}]`       : null,
    meta.subcode != null ? `[subcode=${meta.subcode}]` : null,
  ].filter(Boolean).join(" ");
  return codeTag ? `${base} ${codeTag}` : base;
}

function deriveSpecialAdCategoryCountries(locations = []) {
  const countryCodes = new Set();
  for (const location of Array.isArray(locations) ? locations : []) {
    if (!location || location.mode === "exclude") continue;
    const rawCode =
      location.type === "country" ? location.key : location.countryCode;
    const countryCode =
      typeof rawCode === "string" ? rawCode.trim().toUpperCase() : "";
    if (/^[A-Z]{2}$/.test(countryCode)) countryCodes.add(countryCode);
  }
  return Array.from(countryCodes);
}

const _runningJobs = new Set();

// Dev/testing-only override — same gate the queue's fast-cron + grace-window
// use (MODE=DEV or NODE_ENV=development). Kept local to avoid importing the
// queue module (circular dep).
const IS_DEV_MODE =
  String(process.env.MODE || "").toUpperCase() === "DEV" ||
  process.env.NODE_ENV === "development";

// Releases the in-memory in-flight marker. Every exit path from run() —
// early return or final completion — must call this.
const RUN_LOCK_LEASE_MS = Math.max(
  2 * 60 * 1000,
  Number(process.env.ADSFACTORY_RUN_LOCK_LEASE_MS) || 10 * 60 * 1000,
);

async function acquireRunLock(jobId, token) {
  const now = new Date();
  return AdsFactoryJob.findOneAndUpdate(
    {
      _id: jobId,
      status: "active",
      $or: [
        { "runLock.expiresAt": { $lte: now } },
        { "runLock.expiresAt": null },
        { "runLock.expiresAt": { $exists: false } },
      ],
    },
    {
      $set: {
        "runLock.token": token,
        "runLock.expiresAt": new Date(now.getTime() + RUN_LOCK_LEASE_MS),
      },
    },
    { new: true },
  );
}

function startRunLockHeartbeat(jobId, token) {
  const interval = setInterval(() => {
    AdsFactoryJob.updateOne(
      { _id: jobId, "runLock.token": token },
      { $set: { "runLock.expiresAt": new Date(Date.now() + RUN_LOCK_LEASE_MS) } },
    ).catch((error) => {
      logger.error(`[adsFactoryAuto] failed to renew run lock for ${jobId}: ${error.message}`);
    });
  }, Math.min(60_000, Math.floor(RUN_LOCK_LEASE_MS / 3)));
  interval.unref?.();
  return interval;
}

async function releaseRunLock(jobId, token, heartbeat) {
  if (heartbeat) clearInterval(heartbeat);
  _runningJobs.delete(jobId);
  if (!token) return;
  await AdsFactoryJob.updateOne(
    { _id: jobId, "runLock.token": token },
    { $set: { "runLock.token": null, "runLock.expiresAt": null } },
  ).catch((error) => {
    logger.error(`[adsFactoryAuto] failed to release run lock for ${jobId}: ${error.message}`);
  });
}

// ─── Platform Posters Registry ────────────────────────────────────────────────
// Each entry:
//   isConfigured(target) → bool   has the user filled in the required fields?
//   post(target, job, creatives)  → { adId: string }
//
// To add a new platform:
//   1. Add its target schema to the model + validation
//   2. Add one entry here — nothing else changes

async function resolveJobFacebookConnection(job) {
  const target = job.targets?.meta || {};
  const rawUserId = job.userId?.includes('-')
    ? job.userId.split('-').slice(1).join('-')
    : job.userId;
  const candidateUserIds = [...new Set([job.userId, rawUserId].filter(Boolean))];

  if (target.facebookId || target.connectionId) {
    let lastError;
    for (const userId of candidateUserIds) {
      try {
        return await resolveFacebookConnectionForRecord({
          userId,
          facebookId: target.facebookId,
          connectionId: target.connectionId,
        });
      } catch (error) {
        lastError = error;
        if (!['FACEBOOK_ACCOUNT_NOT_CONNECTED', 'FACEBOOK_NOT_CONNECTED'].includes(error.code)) {
          throw error;
        }
      }
    }
    throw lastError || new Error('Selected Facebook account is not connected');
  }

  // Jobs created before connection binding retain their previous fallback.
  const connection = await FBUsers.findOne({ userId: { $in: candidateUserIds } })
    .sort({ updatedAt: -1 });
  if (!connection) throw new Error(`No Facebook account linked for user ${job.userId}`);
  const accessToken = decrypt(connection.accessToken);
  if (!accessToken) throw new Error('Facebook access token is missing');
  return { connection, facebookId: connection.facebookId, accessToken };
}

// facebook-nodejs-business-sdk keeps a process-global default API instance.
// Serialize Meta posts so two jobs using different Facebook connections cannot
// replace that instance while the other job is still creating its campaign,
// ad set, creatives, or ads. Google jobs and creative generation stay parallel.
let metaPostTail = Promise.resolve();
async function acquireMetaPostLock() {
  const previous = metaPostTail;
  let release;
  metaPostTail = new Promise((resolve) => { release = resolve; });
  await previous;
  return release;
}

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
    // is actually linked right now.
    //
    // Two layers (mirrors Google's isConnected below):
    //   1) Cheap local check — a decryptable access token must exist.
    //   2) Live token probe — GET /me against the Graph API. A Meta token can
    //      be revoked/expired/de-permissioned on Facebook's side while still
    //      sitting decryptable in our DB; only a real call detects that. Doing
    //      it here (Step 2b) pauses the job BEFORE credits are frozen and
    //      creatives generated, instead of wasting a generation cycle only to
    //      fail at post time every tick.
    isConnected: async (job) => {
      if (job.targets?.meta?.facebookId || job.targets?.meta?.connectionId) {
        try {
          await resolveJobFacebookConnection(job);
          return true;
        } catch (e) {
          const permanentConnectionError = [
            'FACEBOOK_ACCOUNT_NOT_CONNECTED',
            'FACEBOOK_ACCOUNT_MISMATCH',
            'FACEBOOK_TOKEN_EXPIRED',
            'FACEBOOK_TOKEN_INVALID',
            'FACEBOOK_TOKEN_MISSING',
          ].includes(e.code);
          logger.warn(`[adsFactoryAuto][2b] selected Meta connection check failed for job ${job._id}: ${e.message}`);
          return permanentConnectionError ? false : true;
        }
      }
      const rawFbUserId = job.userId?.includes("-") ? job.userId.split("-").slice(1).join("-") : job.userId;
      const fbQuery = { $or: [{ userId: job.userId }, { userId: rawFbUserId }] };
      let fbUser;
      try {
        fbUser = await FBUsers.findOne(fbQuery).lean();
      } catch (e) {
        // A DB read error is NOT proof the account is disconnected — pausing a
        // healthy job over a transient Mongo blip is exactly the false-positive
        // we're avoiding. Treat an errored lookup as connected and let the
        // post-time classifier catch a genuine problem.
        logger.warn(`[adsFactoryAuto][2b] Meta isConnected — FBUsers lookup errored for userId="${job.userId}" (treating as connected, deferring to post-time): ${e.message}`);
        return true;
      }
      // Transient null guard: the poster uses this exact same query and has
      // succeeded for this user moments earlier, yet a later tick occasionally
      // reads null (replica lag / momentary connection hiccup). A single retry
      // distinguishes a genuinely-absent record (null twice) from a transient
      // miss (resolves on retry) — so a connected account is no longer paused
      // by a one-off empty read.
      if (!fbUser) {
        try {
          fbUser = await FBUsers.findOne(fbQuery).lean();
        } catch (_) { /* fall through to the null handling below */ }
        if (fbUser) {
          logger.warn(`[adsFactoryAuto][2b] Meta FBUsers record for userId="${job.userId}" was null on first read but present on retry — transient DB miss, treating as connected`);
        }
      }
      // These early "return false" paths previously failed SILENTLY — a run
      // would auto-pause with "meta account not connected" and no log line
      // saying WHY. Log each so a false disconnect (e.g. the FBUsers record
      // stores userId in a format neither "GPT-438" nor "438" matches) is
      // diagnosable from the logs instead of looking like a genuine reconnect.
      if (!fbUser) {
        logger.warn(`[adsFactoryAuto][2b] Meta isConnected=false — no FBUsers record for userId="${job.userId}" or raw="${rawFbUserId}" (null on two reads)`);
        return false;
      }
      let accessToken;
      try {
        accessToken = decrypt(fbUser.accessToken);
      } catch (e) {
        logger.warn(`[adsFactoryAuto][2b] Meta isConnected=false — accessToken decrypt failed for userId="${job.userId}": ${e.message}`);
        return false;
      }
      if (!accessToken) {
        logger.warn(`[adsFactoryAuto][2b] Meta isConnected=false — decrypted accessToken is empty for userId="${job.userId}"`);
        return false;
      }

      // Live token probe — /me is the cheapest Graph call that fails cleanly
      // (OAuthException) on a revoked/expired token.
      try {
        const axios = require("axios");
        await axios.get("https://graph.facebook.com/v24.0/me", {
          params: { access_token: accessToken, fields: "id" },
          timeout: 10000,
        });
        return true;
      } catch (e) {
        const status = e.response?.status;
        const fbErr  = e.response?.data?.error;
        // 400/401 with an OAuthException (type OAuthException or code 190)
        // means the token is dead — treat as disconnected so the job pauses.
        const isAuthFailure =
          status === 401 ||
          fbErr?.type === "OAuthException" ||
          fbErr?.code === 190;
        if (isAuthFailure) {
          logger.warn(`[adsFactoryAuto][2b] Meta token probe failed for ${job.userId} — status=${status} error="${fbErr?.message || e.message}"`);
          return false;
        }
        // Anything else (network blip, rate limit, transient 5xx) is ambiguous
        // — do NOT pause a healthy job on it; the Step 9 permanent-error
        // classifier remains the safety net if a real problem surfaces at post
        // time.
        logger.warn(`[adsFactoryAuto][2b] Meta token probe errored for ${job.userId} (treating as connected, will rely on post-time classifier): ${e.message}`);
        return true;
      }
    },

    post: async (target, job, creatives, campaign) => {
      const releaseMetaPost = await acquireMetaPostLock();
      try {
      const { template } = target;

      if (!template || !template.payload) {
        throw new Error("No template configured on this job — targets.meta.template is required");
      }

      const adAccountId = template.payload.adAccountId;
      if (!adAccountId) {
        throw new Error("Template payload is missing adAccountId");
      }

      // job.userId may be prefixed e.g. "GPT-438" — FBUsers stores the raw numeric part
      const resolvedConnection = await resolveJobFacebookConnection(job);
      const fbUser = resolvedConnection.connection;
      const accessToken = resolvedConnection.accessToken;

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

      // Helper to cleanly mock Express req/res and execute the V2 controllers locally.
      //
      // Pass fbUser.userId — NOT the raw job.userId — as the mock user_id. The V2
      // controllers call initApiForUser(userId), which does a STRICT
      // FBUsers.findOne({ userId }) with no prefix fallback. job.userId may be
      // prefixed ("GPT-438") while the FBUsers record is stored under the raw id
      // ("438") — a mismatch that made initApiForUser throw "Facebook user not
      // found", surfacing on the run card as the generic "Failed to create
      // campaign". fbUser was just resolved above via the $or that tolerates both
      // formats, so fbUser.userId is the EXACT value the record is stored under —
      // handing it to the controllers guarantees their strict lookup matches.
      // Keeps the fix entirely inside the autopilot flow; the shared
      // metaAdLauncher controller is untouched.
      const metaAdControllerV2 = require("../../controllers/adPosting/metaAdLauncherV2");
      const executeController = async (controllerFn, body) => {
        const req = {
          body,
          headers: { 'x-facebook-id': resolvedConnection.facebookId },
          user: { user_id: fbUser.userId },
        };
        let statusCode = 200;
        let responseData = null;
        const res = {
          status: (code) => { statusCode = code; return res; },
          json: (data) => { responseData = data; return res; }
        };
        await controllerFn(req, res);
        if (statusCode >= 400) {
          throw new Error(buildControllerError(responseData));
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

      // Use the saved Meta template as the source of truth. The wizard saves
      // [] when no Special Ad Category was selected.
      const templateSpecialAdCategories = Array.isArray(cleanPayload.specialAdCategories)
        ? cleanPayload.specialAdCategories
        : [];
      let derivedSpecialAdCategoryCountries =
        cleanPayload.specialAdCategoryCountries || [];

      if (templateSpecialAdCategories.length && derivedSpecialAdCategoryCountries.length === 0) {
        // Templates save the wizard locations, while the country list is
        // normally derived only in the wizard's live launch payload. Rebuild
        // it here for Autopilot from countries and city/region countryCode
        // metadata, ignoring excluded locations.
        derivedSpecialAdCategoryCountries =
          deriveSpecialAdCategoryCountries(extractedTargeting.locations);
      }

      const campaignPayload = {
        ...cleanPayload,
        name: p.name || p.campaignName || "Auto",
        specialAdCategories: templateSpecialAdCategories,
        specialAdCategoryCountries: templateSpecialAdCategories.length
          ? derivedSpecialAdCategoryCountries
          : [],
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

      // Normalize the schedule window per run. Autopilot ad sets reuse the
      // template's saved startTime/endTime, but both are FIXED calendar dates.
      // As real time passes two things go stale:
      //   (a) the startTime drifts into the PAST — Meta rejects an ad set whose
      //       start_time is in the past, and our own validator plus the extend
      //       math below would anchor to that past instant. Meta treats an
      //       absent start_time as "start now", so the safest fix is to DROP a
      //       past startTime and let Meta start delivery now (mirrors what the
      //       Google autopilot path does by clamping to today).
      //   (b) the endTime drifts to within (or before) 24h of the effective
      //       start — buildAdSetSchemaV2 then rejects the ad set with "Campaign
      //       schedule is too short — the run window must be at least 24 hours".
      // Do (a) first so the 24h window in (b) is measured from the real
      // effective start (now, once a past startTime is dropped).
      const nowMs = Date.now();

      // (a) Drop a past startTime → Meta starts "now".
      if (adSetBase.startTime && new Date(adSetBase.startTime).getTime() <= nowMs) {
        logger.info(
          `[adsFactoryAuto:meta] template startTime ${adSetBase.startTime} is in the past — dropping it so Meta starts delivery now`
        );
        delete adSetBase.startTime;
      }

      // (b) Ensure the run window spans at least 24h. Effective start is
      // startTime (now guaranteed future/absent) || now. Ad sets with no
      // endTime run open-ended and are left untouched. Buffer clears the
      // boundary rather than landing exactly on it.
      if (adSetBase.endTime) {
        const MIN_SCHEDULE_MS = 24 * 60 * 60 * 1000;
        const SCHEDULE_BUFFER_MS = 5 * 60 * 1000;
        const startMs = adSetBase.startTime
          ? new Date(adSetBase.startTime).getTime()
          : nowMs;
        const endMs = new Date(adSetBase.endTime).getTime();
        if (endMs - startMs < MIN_SCHEDULE_MS) {
          const extendedEnd = new Date(
            startMs + MIN_SCHEDULE_MS + SCHEDULE_BUFFER_MS
          ).toISOString();
          logger.info(
            `[adsFactoryAuto:meta] template endTime ${adSetBase.endTime} is < 24h after start ${new Date(startMs).toISOString()} — auto-extending to ${extendedEnd} to satisfy Meta's minimum schedule window`
          );
          adSetBase.endTime = extendedEnd;
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
        // Meta always uses its own generated copy — no shared/generic fallback.
        const metaText = creative.platformText?.meta;
        const metaHeadline = metaText?.headline || "";
        const metaMessage  = metaText?.message  || "";

        const imageHash = await uploadImageFromUrl(
          account,
          creative.imageUrl.startsWith("http")
            ? creative.imageUrl
            : `${(process.env.AWS_IMAGE_VIEW_URL || "").replace(/\/$/, "")}${creative.imageUrl.startsWith("/") ? "" : "/"}${creative.imageUrl}`
        );
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
          headline: (metaHeadline || "").slice(0, 40),
          primaryText: (metaMessage || "").slice(0, 125),
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
            headline:     metaHeadline,
            message:      metaMessage,
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
      } finally {
        releaseMetaPost();
      }
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
    //
    // Two layers:
    //   1) Cheap local check — a decryptable refresh token must exist. Fast
    //      fail, no network call, when the account was never connected.
    //   2) Live access check — call Google's listAccessibleCustomers (via the
    //      existing checkGoogleAdsAccount controller). This catches a token
    //      that exists in our DB but has been REVOKED or EXPIRED on Google's
    //      side, so the job auto-pauses at Step 2b BEFORE any credits are
    //      frozen or creatives generated — instead of wasting a full
    //      generation cycle only to fail at post time every tick.
    //
    // A specific-customer USER_PERMISSION_DENIED (the template's customerId is
    // no longer accessible even though the account itself is reachable) can
    // still slip past this account-level check; the permanent-error classifier
    // in Step 9 (isPermanentConfigError) remains the safety net for that.
    isConnected: async (job) => {
      const GoogleUsers = require("../../Module/adPosting/googleUsers");
      const googleUser = await GoogleUsers.findOne({ userId: job.userId }).lean();
      // Same silent-false-disconnect risk as Meta above — log WHY so a genuine
      // "reconnect" is distinguishable from a lookup/format miss in the logs.
      if (!googleUser) {
        logger.warn(`[adsFactoryAuto][2b] Google isConnected=false — no GoogleUsers record for userId="${job.userId}"`);
        return false;
      }
      try {
        const { decrypt: decryptToken } = require("../../utils/crypto");
        if (!decryptToken(googleUser.refreshToken)) {
          logger.warn(`[adsFactoryAuto][2b] Google isConnected=false — decrypted refreshToken is empty for userId="${job.userId}"`);
          return false;
        }
      } catch (e) {
        logger.warn(`[adsFactoryAuto][2b] Google isConnected=false — refreshToken decrypt failed for userId="${job.userId}": ${e.message}`);
        return false;
      }

      // Live access probe — reuse checkGoogleAdsAccount with the same mock
      // req/res pattern the poster uses below.
      try {
        const googleAdController = require("../../controllers/adPosting/googleAdController");
        const req = { body: {}, query: {}, user: { user_id: job.userId } };
        let statusCode = 200;
        let responseData = null;
        const res = {
          status: (code) => { statusCode = code; return res; },
          json:   (data)  => { responseData = data; return res; },
        };
        await googleAdController.checkGoogleAdsAccount(req, res);

        // Explicit isConnected:false from the controller (no account linked,
        // or token confirmed dead) — the ONE authoritative "disconnected"
        // signal. Pause on it.
        if (responseData && responseData.isConnected === false) {
          logger.warn(`[adsFactoryAuto][2b] Google reported not connected for ${job.userId} — reason="${responseData?.noAccountReason || responseData?.message || ""}"`);
          return false;
        }

        // A non-2xx status is NOT automatically "disconnected". checkGoogleAds-
        // Account returns the UPSTREAM status verbatim — a transient Google API
        // hiccup (500/503), a rate limit (429), or a developer-token/project
        // restriction all come back non-2xx while the user's account is
        // perfectly fine. Pausing on those produced the false "google account
        // not connected — reconnect it" auto-pause. Only a genuine AUTH failure
        // (401 / expired-revoked token) means the connection is actually dead;
        // everything else is ambiguous, so stay connected and let the post-time
        // permanent-error classifier (Step 9) catch a real problem. Mirrors the
        // Meta probe's auth-failure-vs-transient discipline above.
        if (statusCode === 401) {
          logger.warn(`[adsFactoryAuto][2b] Google token expired/revoked for ${job.userId} (401) — pausing: "${responseData?.error || ""}"`);
          return false;
        }
        if (statusCode >= 400) {
          logger.warn(`[adsFactoryAuto][2b] Google access probe returned status=${statusCode} for ${job.userId} — treating as connected (transient/restricted, not an auth failure), will rely on post-time classifier. details="${responseData?.details || responseData?.error || ""}"`);
          return true;
        }
        return true;
      } catch (e) {
        // A probe error (network blip, unexpected throw) is ambiguous — do NOT
        // pause on it. Let the run proceed; a genuine permission problem will
        // still be caught by the Step 9 permanent-error classifier. This avoids
        // pausing a healthy job because of a transient probe failure.
        logger.warn(`[adsFactoryAuto][2b] Google access probe errored for ${job.userId} (treating as connected, will rely on post-time classifier): ${e.message}`);
        return true;
      }
    },

    // Google Ads (unlike Meta) rejects a campaign whose name already exists on
    // the account. That only ever bites on the FIRST run of a job — once a
    // campaign is created, createdCampaignId is saved and reused, so the name
    // is never submitted again. So we only pre-check when no campaign has been
    // created yet.
    //
    // Returns the conflicting campaign name (string) when the name is taken by
    // a campaign this job does NOT already own — i.e. a real "please choose a
    // different name" collision that will fail at post time. Returns null when
    // there is no conflict, when the poster isn't the first run, or when the
    // existing campaign is this job's own (the post-time recovery would adopt
    // it, so it's not a hard failure). A probe error also returns null — don't
    // pause a healthy job over an ambiguous lookup failure; the post-time path
    // still handles a genuine collision.
    preflightNameConflict: async (target, job) => {
      if (target?.createdCampaignId) return null; // not the first run — name already claimed by this job

      const p = target?.template?.payload || {};
      const name = p.name || p.campaignName;
      if (!name) return null; // controller would auto-name; no user-chosen name to collide

      const customerId = p.adAccountId || target?.template?.customerId || p.customerId;
      if (!customerId) return null; // no account resolved — post-time will surface the config error

      try {
        const googleAdController = require("../../controllers/adPosting/googleAdController");
        const req = { body: { adAccountId: customerId, name }, query: {}, user: { user_id: job.userId } };
        let statusCode = 200;
        let responseData = null;
        const res = {
          status: (code) => { statusCode = code; return res; },
          json:   (data)  => { responseData = data; return res; },
        };
        await googleAdController.findCampaignByNameAPI(req, res);
        if (statusCode >= 400) return null; // lookup failed — don't pause; defer to post-time

        const foundId = responseData?.campaignId;
        if (!foundId) return null; // name is free

        // Name exists. Mirror the post-time recovery's decision (see the
        // createCampaignAPI catch block below): it ADOPTS an existing campaign
        // unless another job already owns that id, in which case it throws.
        // So a hard collision the user must rename around == owned by a
        // different job. Anything else is recoverable at post time.
        const claimedByOther = await AdsFactoryJob.findOne({
          _id: { $ne: job._id },
          "targets.google.createdCampaignId": String(foundId),
        }).select("_id").lean();
        if (claimedByOther) return name;
        return null;
      } catch (e) {
        logger.warn(`[adsFactoryAuto][2c] Google name-conflict probe errored for ${job.userId} (skipping pre-check): ${e.message}`);
        return null;
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
          throw new Error(buildControllerError(responseData));
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
      const creativesToProcess = creatives.filter((c) => c.imageUrl || c.platformText?.google?.headline);
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
        // Google always uses its own generated copy — no shared/generic fallback.
        const googleText = creative.platformText?.google;
        const rawHeadline = (googleText?.headline || "").trim();
        const rawDesc     = (googleText?.message  || creative.description || "").trim();

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
            ...(creative.imageUrl ? {
              imageUrl: creative.imageUrl.startsWith("http")
                ? creative.imageUrl
                : `${(process.env.AWS_IMAGE_VIEW_URL || "").replace(/\/$/, "")}${creative.imageUrl.startsWith("/") ? "" : "/"}${creative.imageUrl}`,
            } : {}),
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

async function waitForGenerationComplete(campaignId, timeoutMs = 15 * 60 * 1000) {
  const POLL_INTERVAL = 5_000;
  const start = Date.now();
  let tick = 0;
  let lastServices = [];

  while (Date.now() - start < timeoutMs) {
    tick++;
    const campaign = await Campaign.findOne({ "metadata.campaignId": campaignId }).lean();
    if (!campaign) {
      throw new Error(`Campaign ${campaignId} disappeared while polling`);
    }

    const services = campaign.services?.servicesSelected || [];
    lastServices = services;
    const elapsedSec = Math.round((Date.now() - start) / 1000);
    const progress = services.map((s) => `${s.serviceName}:${s.generated || 0}/${s.serviceParams?.quantity || 0}`).join(",");
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
  // Point at exactly which service stalled instead of a generic timeout —
  // e.g. "text generation finished (2/2) but image generation stalled at 0/2"
  // tells the user (and us) where to look, rather than "run did not complete
  // in time" which reads identically whether Python never started or was 99%
  // done when the clock ran out.
  const stalled = lastServices.filter((s) => (s.generated || 0) < (s.serviceParams?.quantity || 0));
  const finished = lastServices.filter((s) => (s.generated || 0) >= (s.serviceParams?.quantity || 0));
  let detail;
  if (lastServices.length === 0) {
    detail = "generation never started";
  } else {
    const stalledDesc  = stalled.map((s) => `${s.serviceName} stalled at ${s.generated || 0}/${s.serviceParams?.quantity || 0}`).join(", ");
    const finishedDesc = finished.map((s) => s.serviceName).join(", ");
    detail = [
      stalledDesc || null,
      finishedDesc ? `${finishedDesc} finished OK` : null,
    ].filter(Boolean).join(" — ");
  }
  throw new Error(`Generation timed out after ${timeoutMin} minutes (${detail})`);
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
  /allowed on your plan/i,
  /PLAN_LIMIT_REACHED/i,
  // Google Ads permission failures — the account is linked but the OAuth
  // grant no longer has access to that customer (revoked, wrong login-customer,
  // or manager-link removed). These never recover on retry, so auto-pause
  // instead of failing + emailing every tick. Kept in sync with the
  // "account isn't connected properly" branch of FRIENDLY_ERROR_PATTERNS in
  // adsFactoryAlertService.js.
  /doesn.?t have permission to access customer/i,
  /login-customer-id/i,
  /USER_PERMISSION_DENIED/i,
  /OAuthException/i,
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

  // Log Python's raw text payload as-received, before any per-platform
  // extraction below — lets us confirm from the logs alone whether Python
  // actually sent distinct meta/google variants for this run, rather than
  // inferring it indirectly from what got posted.
  logger.info(`[adsFactoryAuto][text-raw] campaignId=${campaign.metadata?.campaignId}  rawTexts=${JSON.stringify(texts.map((t) => t.data))}`);
  
  const count = Math.min(Math.max(texts.length, images.length, 1), pairsPerCycle);

  // callToActionList is an array — rotate through it per creative, fallback to first or empty
  const ctaList = Array.isArray(callToActionList) && callToActionList.length > 0
    ? callToActionList
    : ["Learn More"];

  const creatives = [];
  for (let i = 0; i < count; i++) {
    const textData = texts[i]?.data;
    const isObj = typeof textData === "object" && textData !== null;

    // Python's text generation produces distinct copy per platform
    // (textData.meta.* vs textData.google.*) — each platform's poster reads
    // its own platformText.<platform> only, no shared/generic fallback that
    // could let one platform's copy leak into another's ad.
    const metaHeadline   = isObj ? textData?.meta?.headline      : null;
    const metaMessage    = isObj ? textData?.meta?.primary_text  : null;
    const googleHeadline = isObj ? textData?.google?.headline    : null;
    const googleMessage  = isObj ? textData?.google?.description : null;

    const rawImage = images[i]?.data;
    const imgData =
      (typeof rawImage === "string"
        ? rawImage
        : rawImage?.base_image || rawImage?.url || rawImage?.data) || "";

    creatives.push({
      creativeId:   uuidv4(),
      // Store the original relative path. Resolve it only while posting or
      // returning it to a client, so database values remain environment-free.
      imageUrl:     imgData,
      linkUrl:      destinationUrl || "",
      callToAction: ctaList[i % ctaList.length], // rotate through campaign CTAs
      description:  campaign.objectives?.additionalGuidelines || "",
      platform:     "multi",
      // Each platform's own generated copy — null when that platform has no
      // dedicated copy for this text index. No shared/generic fallback here.
      platformText: {
        meta:   (metaHeadline || metaMessage)     ? { headline: metaHeadline,   message: metaMessage }   : null,
        google: (googleHeadline || googleMessage) ? { headline: googleHeadline, message: googleMessage } : null,
      },
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
  const runLockToken = uuidv4();
  let runLockHeartbeat = null;

  if (_runningJobs.has(jobId)) {
    logger.warn(`[adsFactoryAuto] job ${jobId} is already running — skipping duplicate dispatch`);
    return;
  }

  const lockedJob = await acquireRunLock(jobId, runLockToken);
  if (!lockedJob) {
    logger.warn(`[adsFactoryAuto] job ${jobId} is already leased by another worker or is no longer active â€” skipping duplicate dispatch`);
    return;
  }

  _runningJobs.add(jobId);
  runLockHeartbeat = startRunLockHeartbeat(jobId, runLockToken);

  logger.info(`[adsFactoryAuto] ▶ run START  jobId=${jobId}  runId=${runId}`);

  try {
    // ── Step 1: Load job ──────────────────────────────────────────────────────
    job = lockedJob;
    logger.info(`[adsFactoryAuto][1] job loaded  status=${job.status}  userId=${job.userId}  campaignId=${job.campaignId}  frequency=${job.schedule?.frequency}`);

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
      await releaseRunLock(jobId, runLockToken, runLockHeartbeat);
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
        await releaseRunLock(jobId, runLockToken, runLockHeartbeat);
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
        await releaseRunLock(jobId, runLockToken, runLockHeartbeat);
        return;
      }
    }

    // Auto-complete if endDate passed. The end date is INCLUSIVE at the chosen
    // run hour — a job set "21 → 23 Jul, run at 2 PM" must still run the 23rd's
    // 2 PM cycle. The raw endDate is a date-only value (midnight), so comparing
    // now > midnight would auto-complete the job the moment the end day starts,
    // killing that day's own run (the exact off-by-one the summary card showed:
    // 2 cycles instead of 3). resolveInclusiveEndDate anchors the boundary to
    // hour:00 on the end date in the job's timezone, matching the getJobSummary
    // projection so runtime and preview agree.
    let effectiveEndBoundary = null;
    if (job.schedule.endDate) {
      const { resolveInclusiveEndDate } = require("./adsFactoryAutoQueue");
      effectiveEndBoundary = resolveInclusiveEndDate(
        job.schedule.endDate,
        job.schedule.hour,
        job.schedule.timezone || "UTC"
      );
    }
    if (effectiveEndBoundary && new Date() > effectiveEndBoundary) {
      logger.info(`[adsFactoryAuto][1] job ${jobId} reached endDate=${job.schedule.endDate} (inclusive boundary ${effectiveEndBoundary.toISOString()}), marking completed`);
      await AdsFactoryJob.updateOne(
        { _id: job._id },
        { $set: { status: "completed" }, $unset: { lifecycleKey: 1 } },
      );
      try {
        const { cancelJob } = require("./adsFactoryAutoQueue");
        await cancelJob(job._id.toString());
      } catch (e) {
        logger.warn(`[adsFactoryAuto][1] could not cancel completed job from queue: ${e.message}`);
      }
      await releaseRunLock(jobId, runLockToken, runLockHeartbeat);
      return;
    }

    // ── Step 2: Load campaign ─────────────────────────────────────────────────
    campaign = await Campaign.findById(job.campaignId).lean();
    if (!campaign) {
      logger.warn(`[adsFactoryAuto][2] campaign ${job.campaignId} not found — pausing job ${jobId}`);
      const { cancelJob } = require("./adsFactoryAutoQueue");
      await cancelJob(job._id.toString()).catch(() => {});
      await AdsFactoryJob.updateOne({ _id: job._id }, { $set: { status: "paused" } })
        .catch((e) => logger.warn(`[adsFactoryAuto][2] could not save paused status: ${e.message}`));
      await releaseRunLock(jobId, runLockToken, runLockHeartbeat);
      return;
    }

    if (!(campaign.services?.servicesSelected?.length)) {
      logger.warn(
        `[adsFactoryAuto][2] campaign ${campaign.metadata?.campaignId} has NO servicesSelected — ` +
        `generation will complete immediately with 0 results. Check campaign setup.`
      );
    }

    logger.info(`[adsFactoryAuto][2] campaign loaded  campaignId=${campaign.metadata?.campaignId}  status=${campaign.status}`);

    // Guard: skip if a previous tick's generation is still in-progress — avoids
    // overlapping Python runs on the same campaign when the schedule fires faster
    // than generation completes (e.g. during testing with 1-min cron).
    if (campaign.results?.status === "in-progress" || campaign.status === "in-progress") {
      logger.warn(
        `[adsFactoryAuto][2] campaign ${campaign.metadata?.campaignId} still in-progress — skipping tick to avoid overlap`
      );
      await releaseRunLock(jobId, runLockToken, runLockHeartbeat);
      return;
    }

    const campaignId     = campaign.metadata?.campaignId;
    const userId         = job.userId;
    const pairsPerCycle  = job.pairsPerCycle  || 1;
    const model          = job.model          || null;

    const recordPreflightFailureAndAlert = async (reason) => {
      job.status = "paused";
      job.schedule.nextRunAt = null;

      // Avoid appending duplicate preflight failure runs if the last run failed with the exact same reason recently
      const lastRun = job.runHistory && job.runHistory[job.runHistory.length - 1];
      const isDupFailure =
        lastRun &&
        lastRun.status === "failed" &&
        lastRun.error === reason &&
        (!lastRun.executedAt || Date.now() - new Date(lastRun.executedAt).getTime() < 120000);

      let preflightRun = lastRun;
      if (!isDupFailure) {
        job.failedRuns = (job.failedRuns || 0) + 1;

        preflightRun = {
          runId: new (require("mongoose").Types.ObjectId)().toString(),
          executedAt: new Date(),
          status: "failed",
          error: reason,
          platformErrors: {},
          platformAdIds: {},
          automationCreatives: [],
          rawImages: [],
          rawTexts: [],
        };
        job.runHistory.push(preflightRun);
      }
      await job.save({ validateBeforeSave: false });

      try {
        const { cancelJob } = require("./adsFactoryAutoQueue");
        await cancelJob(jobId);
      } catch (e) {
        logger.warn(`[adsFactoryAuto] could not cancel auto-paused job: ${e.message}`);
      }

      try {
        const { notifyAdsFactoryRun } = require("./adsFactoryAlertService");
        await notifyAdsFactoryRun({ job, campaign, run: preflightRun });
      } catch (e) {
        logger.warn(`[adsFactoryAuto] alert email failed (non-fatal): ${e.message}`);
      }

      throw new Error(reason);
    };

    // ── Step 2b: Verify every configured platform is actually connected ───────
    // isConfigured() only checks the saved template has fields filled in — it
    // doesn't mean the underlying Facebook/Google account is still linked.
    // Checked here, before spending a generation cycle's credits, so a
    // disconnected account auto-pauses the job with a clear reason instead of
    // silently repeating the same failed attempt every single tick forever.
    const targetsForConnCheck = job.targets || {};
    const configuredTargetPlatforms = Object.entries(PLATFORM_POSTERS)
      .filter(([platformName, poster]) => poster.isConfigured(targetsForConnCheck[platformName]))
      .map(([platformName]) => platformName);
    if (configuredTargetPlatforms.length === 0) {
      const reason = "No complete platform template is configured for this automation";
      logger.warn(`[adsFactoryAuto][2b] job ${jobId} auto-pausing — ${reason}`);
      await recordPreflightFailureAndAlert(reason);
    }
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
      await recordPreflightFailureAndAlert(reason);
    }

    // ── Step 2c: Pre-flight campaign-name conflict check ─────────────────────
    // Google rejects a duplicate campaign name. Catch it here, before freezing
    // credits or generating creatives, so a name collision pauses the job with
    // an actionable "rename it" message instead of wasting a full generation
    // cycle only to fail at post time. Only platforms that expose
    // preflightNameConflict participate (Google today; Meta allows duplicate
    // names so it doesn't).
    const nameConflicts = [];
    for (const [platformName, poster] of Object.entries(PLATFORM_POSTERS)) {
      if (!poster.isConfigured(targetsForConnCheck[platformName])) continue;
      if (typeof poster.preflightNameConflict !== "function") continue;
      const conflictName = await poster.preflightNameConflict(targetsForConnCheck[platformName], job);
      if (conflictName) nameConflicts.push({ platformName, name: conflictName });
    }
    if (nameConflicts.length > 0) {
      const reason = nameConflicts
        .map((c) => `${c.platformName}: A campaign with this name already exists ("${c.name}"). Please choose a different campaign name in this automation's settings and resume it.`)
        .join(" | ");
      logger.warn(`[adsFactoryAuto][2c] job ${jobId} auto-pausing — ${reason}`);
      await recordPreflightFailureAndAlert(reason);
    }

    // ── Step 2d: Pre-flight Plan Limit Check ──────────────────────────────────
    // Check managed campaign plan limit BEFORE freezing credits or sending to Python.
    // Only checked if Meta target is configured and no Meta campaign ID has been
    // saved yet from a prior run (subsequent runs reuse createdCampaignId and consume 0 slots).
    const jobTargets = job.targets || {};
    if (jobTargets.meta && !jobTargets.meta.createdCampaignId) {
      const { checkPlanLimit } = require("../../utils/planLimits");
      const campaignLimit = await checkPlanLimit(userId, "meta:campaigns");
      if (!campaignLimit.ok) {
        const reason = `meta: ${campaignLimit.error}`;
        logger.warn(`[adsFactoryAuto][2d] job ${jobId} hit plan limit — ${reason}`);
        await recordPreflightFailureAndAlert(reason);
      }
    }

    // ── Step 3: Credit check ──────────────────────────────────────────────────
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
    if (!creditResult.success && creditResult.code === 400) {
      const reason = `Insufficient credits: ${creditResult.message}`;
      logger.warn(`[adsFactoryAuto][3] ${reason} — pausing job ${jobId}`);
      await recordPreflightFailureAndAlert(reason);
    }

    // ── Step 4: Freeze credits ────────────────────────────────────────────────
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
        const reason = `Insufficient credits to reserve campaign run: need ${creditResult.totalRequired}, have ${freeze.remaining}`;
        logger.warn(`[adsFactoryAuto][4] freeze INSUFFICIENT — ${reason} — pausing job`);
        await recordPreflightFailureAndAlert(reason);
      }
      if (!freeze.ok && freeze.reason !== "CONTENDED" && !freeze.idempotent) {
        const reason = `Credit freeze failed: ${freeze.reason}`;
        logger.error(`[autopilot][4] campaign freeze failed (${freeze.reason}) for ${campaign.metadata.campaignId} — pausing job`);
        await recordPreflightFailureAndAlert(reason);
      }
    }

    // ── Step 5: Update campaign services ─────────────────────────────────────

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

    // Rebuild distribution.platforms from this job's currently-configured
    // targets — Python's text generator only produces a platform-specific
    // copy variant for platforms listed here (see gemini_service.py), so a
    // stale/missing entry (e.g. left over from the campaign's original
    // single-platform wizard setup) silently drops that platform's variant,
    // causing both platforms to fall back to the same shared text.
    const distributionPlatforms = Object.keys(PLATFORM_POSTERS)
      .filter((p) => PLATFORM_POSTERS[p].isConfigured(jobTargets[p]))
      .map((p) => ({ platformName: p }));

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
          ...(distributionPlatforms.length ? { "distribution.platforms": distributionPlatforms } : {}),
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
      } catch (releaseErr) {
        logger.warn(`[adsFactoryAuto][6-7] failed to release frozen credits: ${releaseErr.message}`);
      }
      throw err;
    }

    // ── Step 7b: Build creatives ──────────────────────────────────────────────
    const metaPayload   = job.targets?.meta?.template?.payload   || {};
    const googlePayload = job.targets?.google?.template?.payload || {};
    // The shared creative URL is consumed by Meta; Google reads finalUrl from
    // its own template inside the Google poster. Prefer Meta here whenever it
    // is configured so a dual-platform run cannot send Meta traffic to the
    // Google landing page.
    const activePlatformPayload = PLATFORM_POSTERS.meta.isConfigured(job.targets?.meta)
      ? metaPayload
      : googlePayload;
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
          .then((result) => {
            if (!result?.adId) {
              throw new Error(`${platformName} did not return a created ad ID`);
            }
            return {
              platformName,
              adId: result.adId,
              creativeAdMap: result.creativeAdMap || {},
              campaignId: result.campaignId || null,
              adGroupId: result.adGroupId || null,
              adSetId: result.adSetId || null,
              ok: true,
            };
          })
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
    runStatus = postTasks.length === 0
      ? "failed"
      : platformErrors.length > 0
        ? (anyPosted ? "partial" : "failed")
        : (anyPosted ? "success" : "failed");
    if (postTasks.length === 0 || (!anyPosted && platformErrors.length === 0)) {
      runError = "No configured platform accepted this run for posting";
    }
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
      }

      // Platform account/campaign limits (too many ad groups, too many ads
      // per ad set, etc.) or permanent config problems (no linked account,
      // expired token, revoked Google permission, duplicate campaign name)
      // will never succeed on retry — auto-pause instead of failing on every
      // future tick and burning generation credits each time.
      //
      // Also fires on "partial" (e.g. Meta posted but Google's account
      // permission is broken): one platform being permanently misconfigured
      // still repeats the same failure + alert email every cycle, so pause the
      // whole job until the user reconnects or removes that platform.
      if (
        (runStatus === "failed" || runStatus === "partial") &&
        (isPlatformLimitError(runError) || isPermanentConfigError(runError))
      ) {
        job.status = "paused";
        job.schedule.nextRunAt = null;
        logger.warn(`[adsFactoryAuto][9] job ${jobId} hit a permanent config/limit error — auto-pausing: "${runError}"`);
        try {
          const { cancelJob } = require("./adsFactoryAutoQueue");
          await cancelJob(jobId);
        } catch (e) {
          logger.warn(`[adsFactoryAuto][9] could not cancel auto-paused job from queue: ${e.message}`);
        }
      }

      // One-shot job — always cancel from BullMQ after any run attempt (success, partial, or failed).
      // Success/partial → mark completed. Failed → stay active so user can retry via run-now.
      // Either way the BullMQ delayed entry must be removed — otherwise it fires again on the next tick.
      if (job.schedule?.frequency === "does_not_repeat") {
        job.schedule.nextRunAt = null;
        if (runStatus === "success" || runStatus === "partial") {
          job.status = "completed";
          job.lifecycleKey = undefined;
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
    // Ordering note: Step 9 already persisted this run to the DB via
    // job.save(), so GET /activity would return the new run before this emit
    // fires — a client refetching in that window sees the run "before the
    // socket". The socket is a live PUSH, not the source of truth (the DB is);
    // the emit runs as early as possible after save so the gap is minimal, and
    // it is NOT gated behind any further await. If global.io is missing (socket
    // server never attached to this process), we log loudly instead of silently
    // dropping the event — that silent drop was the "sometimes it doesn't emit"
    // symptom.
    if (!global.io) {
      logger.warn(`[adsFactoryAuto][10] SKIPPED socket emit — global.io is not set on this process (jobId=${jobId} runId=${runId}). The client will only see this run on its next GET /activity refetch.`);
    }
    if (global.io) {
      try {
          const adsPosted = Object.keys(postedAdIds).length > 0
            ? postedAdIds
            : {};

          const imagesGenerated = newCreatives.filter((c) => c.imageUrl).length;
          const textsGenerated  = newCreatives.filter((c) => c.platformText?.meta || c.platformText?.google).length;
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
            // The authoritative run count for this job is job.totalRuns (it is
            // incremented exactly once per real run in Step 9). runHistory.length
            // can DRIFT from it — reloadActiveJobs pushes synthetic
            // "interrupted-*"/"missed-*" entries into runHistory without bumping
            // totalRuns, and history can be pruned — so total is derived from
            // totalRuns (falling back to runHistory.length only if the counter is
            // somehow unset on a legacy job).
            total:   job.totalRuns || job.runHistory.length,
            skip:    0,
            limit:   1,

            // Campaign identity — matches getJobActivity shape exactly
            campaign: campaign ? {
              _id:          campaign._id,
              campaignId:   campaign.metadata?.campaignId || campaign._id,
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

                // Match GET /activity exactly: one response card per platform
                // with that platform's own copy and posting result. Previously
                // the socket emitted one "multi" card with text nested under
                // ad.meta/ad.google, while the fetched response emitted flat
                // ad.headline/ad.body fields. The frontend therefore rendered
                // mismatched live data until refresh replaced it.
                creatives: newCreatives.flatMap((c, i) => {
                  const creativePosted = c.postedAdIds instanceof Map
                    ? Object.fromEntries(c.postedAdIds)
                    : (c.postedAdIds || {});
                  const platformsForCreative = Object.keys(creativePosted).length
                    ? Object.keys(creativePosted)
                    : Object.keys(adsPosted);
                  const platforms = platformsForCreative.length
                    ? platformsForCreative
                    : Object.keys(job.targets || {}).filter((p) => job.targets[p]?.template);

                  return platforms.map((platform) => {
                    const platformText = c.platformText?.[platform] || null;
                    const headline = platformText?.headline || "";
                    const body = platformText?.message || "";
                    const platformAdId = creativePosted[platform] || (adsPosted[platform] || null);

                    return {
                      // Stable, unique card id across socket merges and the
                      // authoritative GET response. DB identity is unchanged.
                      creativeId: `${c.creativeId}:${platform}`,
                      sourceCreativeId: c.creativeId,
                      imageIndex: i,
                      textIndex: i,
                      platform,
                      runStatus,
                      runError: runError || null,
                      ad: {
                        imageUrl: c.imageUrl
                          ? (c.imageUrl.startsWith("http")
                              ? c.imageUrl
                              : `${(process.env.AWS_IMAGE_VIEW_URL || "").replace(/\/$/, "")}${c.imageUrl.startsWith("/") ? "" : "/"}${c.imageUrl}`)
                          : c.imageUrl,
                        imageStatus: c.imageUrl ? "generated" : "missing",
                        headline,
                        body,
                        description: c.description,
                        textStatus: (headline || body) ? "generated" : "missing",
                        callToAction: c.callToAction,
                        linkUrl: c.linkUrl,
                        platform,
                      },
                      posting: {
                        posted: !!platformAdId,
                        adId: platformAdId,
                        postedAt: platformAdId ? completedAt : null,
                      },
                    };
                  });
                }),
              },
            ],
          };

          // Deliver to the user room. Every socket joins a room named after its
          // userId on connect (middlewares/authMiddleware.js:
          // `socket.join(socket.user.user_id)`), UNCONDITIONALLY and for EVERY
          // tab the user has open. So `global.io.to(job.userId).emit(...)`
          // reaches all of the user's live clients — this is the room the
          // original code targeted and it works.
          //
          // The prior attempt switched to a Redis socketId lookup
          // (`user:<userId> → socketId` via saveSocketId) on the theory that no
          // socket joined the userId room. That theory was wrong (authMiddleware
          // joins it), and worse, saveSocketId only runs inside the connection
          // handler's `if (socket.user.token)` branch and stores a SINGLE
          // socketId — so it is unset for some connections and only ever points
          // at the last tab. That is exactly why the event "was never listed":
          // the lookup returned null and the emit went nowhere. The room is the
          // correct, multi-tab-safe target; the Redis socketId is kept only as a
          // best-effort secondary emit for parity with the other controllers.
          const userRoomSize = (() => {
            try { return global.io.sockets.adapter.rooms.get(job.userId)?.size || 0; }
            catch { return "?"; }
          })();
          global.io.to(job.userId).emit("adsFactory:runComplete", socketPayload);
          logger.info(`[adsFactoryAuto][10] emitted adsFactory:runComplete to user room ${job.userId} (${userRoomSize} client(s) in room)  runId=${runId}`);

          // Secondary best-effort emit to the stored socketId (if saveSocketId
          // ran for this user) — harmless duplicate for a client already in the
          // room; covers any edge case where the room membership was dropped but
          // the Redis mapping survived. Never the sole delivery path.
          try {
            const { redisGetSet } = require("../../controllers/adCopy");
            const userSocketId = await redisGetSet.get(`user:${job.userId}`);
            if (userSocketId && userSocketId !== job.userId) {
              global.io.to(userSocketId).emit("adsFactory:runComplete", socketPayload);
            }
          } catch (e) {
            logger.warn(`[adsFactoryAuto][10] secondary socketId emit skipped for ${job.userId}: ${e.message}`);
          }

          // Campaign room — clients that are actively viewing this AdFactory
          // campaign join it via the existing `adFactoryRequest` handler
          // (socket.join(campaignId)). Keep emitting here too so an open
          // campaign view updates live even across multiple tabs/clients.
          if (job.campaignId) {
            const campIdStr = job.campaignId.toString();
            const campRoomSize = (() => {
              try { return global.io.sockets.adapter.rooms.get(campIdStr)?.size || 0; }
              catch { return "?"; }
            })();
            global.io.to(campIdStr).emit("adsFactory:runComplete", socketPayload);
            logger.info(`[adsFactoryAuto][10] emitted adsFactory:runComplete to campaign room ${campIdStr} (${campRoomSize} client(s) in room)  runId=${runId}`);
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
      }
    } catch (e) {
      logger.warn(`[adsFactoryAuto][11] alert email failed (non-fatal): ${e.message}`);
    }
  }

  await releaseRunLock(jobId, runLockToken, runLockHeartbeat);
  logger.info(`[adsFactoryAuto] ■ run END  jobId=${jobId}  runId=${runId}  finalStatus=${runStatus}  durationMs=${Date.now() - startedAt.getTime()}`);
}

const adsFactoryOrchestrator = { run };
module.exports = { adsFactoryOrchestrator, _runningJobs };
