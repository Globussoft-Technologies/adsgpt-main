const axios = require("axios");
const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");
dayjs.extend(utc);
dayjs.extend(timezone);
// ── Suppress Harmless MetadataLookupWarning ────────────────────────────────
const originalEmitWarning = process.emitWarning;
process.emitWarning = (warning, ...args) => {
  if (warning?.name === 'MetadataLookupWarning' || (typeof warning === 'string' && warning.includes('MetadataLookupWarning'))) {
    return;
  }
  return originalEmitWarning.call(process, warning, ...args);
};
// ───────────────────────────────────────────────────────────────────────────

const { GoogleAdsApi } = require("google-ads-api");
const { redisClient } = require("../../db/redis");
const GoogleUsers = require("../../Module/adPosting/googleUsers");
const GooglePostedAd = require("../../Module/adPosting/googlePostedAds");
const Campaign = require("../../Module/adFactory/adFactory");
const { encrypt, decrypt } = require("../../utils/crypto");
const logger = require("../../utils/logger");
const {
  formatBudget,
  formatStatus,
  formatAccountStatus,
  formatBiddingStrategy,
  formatChannelType,
  deriveGoogleBillingType,
  sanitizeId,
} = require("../../utils/googleHelpers");
const {
  buildAdImageMapFromAssetResults,
  buildImageAssetGaql,
  collectEmbeddedAssetRefs,
  fetchGoogleAssetUrlMap,
  fetchStandardAdResults,
  mapGoogleStandardAdRow,
} = require("../../utils/googleAdMapping");

function wantsCacheRefresh(req) {
  const v = String(req.query?.refresh || "").toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

function normalizeCampaignsResponse(parsed, adAccountId) {
  if (!adAccountId || !parsed) return parsed;
  if (!parsed.campaigns?.length && Array.isArray(parsed.data)) {
    parsed.campaigns = parsed.data.flatMap((d) => d.campaigns || []);
    parsed.count = parsed.campaigns.length;
  }
  return parsed;
}

const normalizeCustomerId = (id) => {
  if (!id) return null;
  const digits = String(id).replace(/-/g, "").trim();
  return /^\d{1,15}$/.test(digits) ? digits : null;
};

const INVALID_AD_ACCOUNT_ID_MESSAGE = "Invalid ad account id";

function respondInvalidAdAccountId(res) {
  return res.status(400).json({
    status: false,
    error: INVALID_AD_ACCOUNT_ID_MESSAGE,
    message: INVALID_AD_ACCOUNT_ID_MESSAGE,
  });
}

function normalizeRequestCustomerId(res, id) {
  const tid = normalizeCustomerId(id);
  if (!tid) {
    respondInvalidAdAccountId(res);
    return null;
  }
  return tid;
}

function getQueryParam(query, names) {
  for (const name of names) {
    if (query[name] != null) return query[name];
  }
  return undefined;
}
const googleRules = require("../../config/googleAuditRulesConfig");
const { getGoogleCtas, GOOGLE_CTA_MAP } = require("../../config/googleCtaConfig");
const { updateGoogleAdStatusSchema, createCampaignSchema, createAdGroupSchema, createAdSchema, deleteGoogleCampaignSchema } = require("../../Validations/google.validator");

const REDIS_TTL = 7200;
const VOLATILE_TTL = 900;

// Cache key prefixes whose payloads embed status — invalidated on status change.
const STATUS_CACHE_PREFIXES = [
  "googleCampaigns",
  "googleAdGroups",
  "googleCampaignAds",
  "googleAdGroupAds",
  "googleDashboard",
];

const ALL_CACHE_PREFIXES = [
  ...STATUS_CACHE_PREFIXES,
  "googleAdAccounts",
  "googleCampaignsAll",
  "googleCampaignsAll:v2",
  "googleCampaignsAll:v3",
  "googleCampaignsAll:v4",
  "googleAnalytics",
  "googleInsights",
  "googleAudit",
  "googleAccessToken",
  "googleManagerMap",
];

// ─── Google API error → plain English ────────────────────────────────────────
const GOOGLE_ERROR_MESSAGES = {
  // Asset group
  NOT_ENOUGH_HEADLINE_ASSET:            "Please add at least 3 headlines.",
  NOT_ENOUGH_LONG_HEADLINE_ASSET:       "Please add a long headline (required by Google).",
  NOT_ENOUGH_DESCRIPTION_ASSET:         "Please add at least 2 descriptions.",
  NOT_ENOUGH_MARKETING_IMAGE_ASSET:     "Please upload a landscape image (1.91:1 ratio).",
  NOT_ENOUGH_SQUARE_MARKETING_IMAGE_ASSET: "Please upload a square image (1:1 ratio).",
  NOT_ENOUGH_LOGO_ASSET:                "Please upload a logo image.",
  DUPLICATE_ASSETS_WITH_DIFFERENT_FIELD_VALUE: "One of your assets already exists with different settings. Try using slightly different text.",
  ASSET_GROUP_MUST_BE_PART_OF_CAMPAIGN: "The asset group must be linked to a valid campaign.",
  INVALID_FINAL_URL:                    "The landing page URL is invalid. Make sure it starts with https://.",
  MISMATCHING_FINAL_URL_AND_FINAL_MOBILE_URL: "The mobile URL must match the landing page domain.",
  // Campaign
  DUPLICATE_CAMPAIGN_NAME:              "A campaign with this name already exists. Please choose a different name.",
  INVALID_CAMPAIGN_NAME:                "Campaign name contains invalid characters.",
  BIDDING_STRATEGY_NOT_SUPPORTED_IN_DRAFTS: "This bidding strategy is not supported. Try a different one.",
  INVALID_BUDGET_AMOUNT:                "The budget amount is invalid. Please enter a valid number.",
  // Ad group
  DUPLICATE_ADGROUP_NAME:               "An ad group with this name already exists in this campaign.",
  INVALID_ADGROUP_NAME:                 "Ad group name contains invalid characters.",
  // Ads
  DISALLOWED_TEXT_APPLIES_TO_ALL_MATCHING_ADS: "Your ad text was rejected by Google's policy. Please revise the content.",
  LINE_TOO_WIDE:                        "One of your headlines or descriptions is too long. Please shorten it.",
  // Auth / account
  CUSTOMER_NOT_FOUND:                   "Google Ads account not found. Please check your account ID.",
  NOT_ADS_USER:                         "This Google account is not linked to a Google Ads account.",
  OAUTH_TOKEN_INVALID:                  "Your Google session has expired. Please reconnect your Google account.",
  // Generic
  RESOURCE_EXHAUSTED:                   "Google API rate limit reached. Please wait a moment and try again.",
  PERMISSION_DENIED:                    "You don't have permission to perform this action in Google Ads.",
  INVALID_ARGUMENT:                     "Google rejected the request due to invalid data. Please check your inputs.",
  // Budget
  BUDGET_BELOW_PER_DAY_MINIMUM:         "Your daily budget is too low for this campaign type. Please increase it and try again.",
  BUDGET_AMOUNT_MUST_EXCEED_MINIMUM_AMOUNT_PER_CLICK: "Your budget is too low. Please increase it and try again.",
  BUDGET_CANNOT_BE_ZERO:                "Budget cannot be zero. Please enter a valid daily budget.",
};

/**
 * Extracts a human-readable error message from a Google Ads API axios error.
 * Falls back to a generic message if the error is not recognized.
 */
function parseGoogleError(e, fallback = "Something went wrong. Please try again.") {
  try {
    const googleErrors = e?.response?.data?.error?.details?.[0]?.errors || [];
    if (googleErrors.length > 0) {
      const messages = googleErrors.map((err) => {
        const codeObj = err.errorCode || {};
        const code = Object.values(codeObj)[0];
        // Use our friendly map first, then fall back to Google's own message (still readable)
        return GOOGLE_ERROR_MESSAGES[code] || err.message || fallback;
      });
      return [...new Set(messages)].join(" ");
    }
    // No specific errors — check HTTP-level status message from Google
    const httpMsg = e?.response?.data?.error?.message || "";
    if (httpMsg) {
      if (httpMsg.includes("UNAUTHENTICATED") || httpMsg.includes("invalid_grant"))
        return "Your Google session has expired. Please reconnect your Google account.";
      if (httpMsg.includes("PERMISSION_DENIED"))
        return "You don't have permission to perform this action in Google Ads.";
      if (httpMsg.includes("RESOURCE_EXHAUSTED"))
        return "Google API rate limit reached. Please wait a moment and try again.";
      // Return Google's message rather than the generic axios "Request failed with status code 400"
      return httpMsg;
    }
  } catch (_) { /* ignore parse errors */ }
  return fallback;
}

const robustFormatStatus = (status) => {
  if (typeof status === "string") return status;
  return formatStatus(status);
};

const robustFormatChannelType = (type) => {
  if (typeof type === "string") return type;
  return formatChannelType(type);
};

const robustFormatBiddingStrategy = (type) => {
  if (typeof type === "string") return type;
  return formatBiddingStrategy(type);
};

// Maps Google Ads channel type to objective label (VIDEO excluded at query level)
function deriveObjective(channelType) {
  const ch = typeof channelType === "string" ? channelType : (formatChannelType(channelType) || "");
  const map = {
    SEARCH: "SEARCH",
    DISPLAY: "DISPLAY",
    SHOPPING: "SHOPPING",
    PERFORMANCE_MAX: "PERFORMANCE_MAX",
    MULTI_CHANNEL: "APP_PROMOTION",
    DEMAND_GEN: "DEMAND_GEN",
    VIDEO: "VIDEO",
  };
  return map[ch] || ch || null;
}

async function scanKeys(pattern) {
  const keys = [];
  const stream = redisClient.scanStream({ match: pattern, count: 100 });
  for await (const batch of stream) {
    if (batch.length) keys.push(...batch);
  }
  return keys;
}

async function invalidateGoogleCacheByPrefixes(userId, prefixes) {
  if (!redisClient) return;
  const patterns = [];
  for (const prefix of prefixes) {
    patterns.push(
      `${prefix}:${userId}:*`,
      `${prefix}:v2:${userId}:*`,
      `${prefix}:v3:${userId}:*`,
      `${prefix}:v4:${userId}:*`,
      `${prefix}:*:${userId}:*`,
    );
  }
  const results = await Promise.all(patterns.map(p => scanKeys(p)));
  const keysToDelete = results.flat();
  for (const prefix of prefixes) keysToDelete.push(`${prefix}:${userId}`);
  if (keysToDelete.length) await redisClient.del(...keysToDelete);
}

async function invalidateUserGoogleCache(userId) {
  return invalidateGoogleCacheByPrefixes(userId, STATUS_CACHE_PREFIXES);
}

async function invalidateAllUserGoogleCache(userId) {
  return invalidateGoogleCacheByPrefixes(userId, ALL_CACHE_PREFIXES);
}

function formatGoogleError(error) {
  // Try the nested Google Ads API error structure first
  const apiErrors = error?.response?.data?.error?.details?.[0]?.errors || error?.errors || [];
  const firstApiError = apiErrors[0] || {};
  const errorCode = firstApiError?.errorCode
    ? Object.entries(firstApiError.errorCode).find(([, v]) => v != null)
    : null;

  // Google Ads API top-level message
  const apiMessage =
    error?.response?.data?.error?.message ||
    firstApiError?.message ||
    error?.message ||
    "Unknown Google Ads API error";

  return {
    message: apiMessage,
    reason: errorCode?.[0] || error?.response?.data?.error?.status || null,
    details: firstApiError || error?.response?.data?.error || null,
  };
}

function mapGoogleAccountErrorStatus(err) {
  const statusCode = err.response?.status;
  const errorPayload = err.response?.data?.error || {};
  const errorStatus = errorPayload.status || errorPayload.code || "";
  const errorCode = getGoogleAdsErrorReason(err);

  // Account is deactivated/not yet enabled — not a token problem
  if (errorCode === "CUSTOMER_NOT_ENABLED") return "DISABLED";

  const isRestricted =
    (statusCode === 403 && errorCode !== "CUSTOMER_NOT_ENABLED") ||
    errorStatus === "DEVELOPER_TOKEN_NOT_APPROVED" ||
    errorStatus === "ACCESS_DENIED" ||
    errorCode === "DEVELOPER_TOKEN_PROBATION_ORDER_ERROR" ||
    errorCode === "DEVELOPER_TOKEN_PROHIBITED" ||
    errorCode === "DEVELOPER_TOKEN_NOT_APPROVED" ||
    errorCode === "QUOTA_ERROR";

  return isRestricted ? "PRODUCTION_BLOCKED" : "INACCESSIBLE";
}

function getGoogleAdsErrorReason(err) {
  const googleAdsErrors =
    err.response?.data?.error?.details?.flatMap((detail) => detail.errors || []) || [];
  const firstErrorCode = googleAdsErrors[0]?.errorCode || {};
  const nestedReason = Object.values(firstErrorCode).find(Boolean);
  const topLevelStatus = err.response?.data?.error?.status;
  return nestedReason || topLevelStatus || null;
}

function isGoogleAdsPermissionRestricted(err) {
  const statusCode = err.response?.status;
  const reason = getGoogleAdsErrorReason(err);
  return (
    statusCode === 403 &&
    [
      "PERMISSION_DENIED",
      "DEVELOPER_TOKEN_PROHIBITED",
      "DEVELOPER_TOKEN_NOT_APPROVED",
      "DEVELOPER_TOKEN_PROBATION_ORDER_ERROR",
      "ACCESS_DENIED",
    ].includes(reason)
  );
}

function isPostableGoogleAccount(account) {
  return (
    account?.status === "ENABLED" &&
    formatAccountStatus(account?.rawStatus) === "ENABLED" &&
    account?.isManager !== true &&
    account?.isTestAccount !== true &&
    account?.status !== "PRODUCTION_BLOCKED" &&
    account?.errorReason == null &&
    account?.hierarchyLocked !== true
  );
}

function isGoogleTokenRestrictedMessage(message) {
  const text = String(message || "").toLowerCase();
  return (
    text.includes("developer token") ||
    text.includes("test accounts") ||
    text.includes("permission denied") ||
    text.includes("not approved") ||
    text.includes("probation") ||
    text.includes("quota")
  );
}

async function getBlockedGoogleAccounts(userId) {
  const cacheKey = `googleAdAccounts:${userId}`;

  try {
    const cached = await redisClient.get(cacheKey);

    if (!cached) return new Set();

    const parsed = JSON.parse(cached);

    const blockedAccounts =
      parsed?.adAccounts
        ?.filter(
          (acc) =>
            acc.status === "PRODUCTION_BLOCKED" ||
            acc.errorReason === "DEVELOPER_TOKEN_NOT_APPROVED"
        )
        .map((acc) => String(acc.id)) || [];

    return new Set(blockedAccounts);
  } catch (err) {
    // Silent fallback if blocked accounts fetch fails

    return new Set();
  }
}

// Resolve Google user by JWT userId (e.g. "GPT-123") — mirrors how Meta Ads
// resolves the FB user, so callers never pass a MongoDB _id in query params.
async function initGoogleApiForUser(userId) {
  // Check Redis for a cached valid access token first (avoids DB + refresh roundtrip)
  const tokenCacheKey = `googleAccessToken:${userId}`;
  if (redisClient) {
    try {
      const cached = await redisClient.get(tokenCacheKey);
      if (cached) {
        const { accessToken: cachedToken, client: _c } = JSON.parse(cached);
        if (cachedToken) {
          const client = new GoogleAdsApi({
            client_id: process.env.GOOGLE_CLIENT_ID,
            client_secret: process.env.GOOGLE_CLIENT_SECRET,
            developer_token: process.env.GOOGLE_DEVELOPER_TOKEN,
          });
          // Still need refreshToken for getCustomerClient — fetch from DB lean (fast)
          const googleUser = await GoogleUsers.findOne({ userId }).lean();
          const refreshToken = googleUser ? decrypt(googleUser.refreshToken) : null;
          return { client, accessToken: cachedToken, refreshToken, googleUser };
        }
      }
    } catch (_) { /* fall through */ }
  }

  // Sort by updatedAt descending to ensure we pick the most recent connection if duplicates exist
  const googleUser = await GoogleUsers.findOne({ userId }).sort({ updatedAt: -1 });
  if (!googleUser) {
    const err = new Error("Google account not connected. Please connect your Google Ads account first.");
    err.statusCode = 404;
    throw err;
  }

  let accessToken = decrypt(googleUser.accessToken);
  const refreshToken = decrypt(googleUser.refreshToken);
  if (!refreshToken) {
    const err = new Error("Google access token is missing. Please reconnect your Google account.");
    err.statusCode = 401;
    throw err;
  }

  // Refresh the access token if it is expired or expires within 5 minutes
  const isExpired = !googleUser.tokenExpiresAt || new Date(googleUser.tokenExpiresAt) <= new Date(Date.now() + 5 * 60 * 1000);
  if (isExpired) {
    try {
      const refreshResponse = await axios.post("https://oauth2.googleapis.com/token", {
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      });
      accessToken = refreshResponse.data.access_token;
      const expiresIn = refreshResponse.data.expires_in || 3600;
      googleUser.accessToken = encrypt(accessToken);
      googleUser.tokenExpiresAt = new Date(Date.now() + expiresIn * 1000);
      await googleUser.save();
      // Cache the fresh token in Redis — expire 5 min before actual expiry to be safe
      if (redisClient) {
        redisClient.set(tokenCacheKey, JSON.stringify({ accessToken }), "EX", Math.max(expiresIn - 300, 60)).catch(() => {});
      }
    } catch (refreshErr) {
      const oauthError = refreshErr.response?.data?.error || "";
      const httpStatus = refreshErr.response?.status;
      logger.error(`Google token refresh failed for userId ${userId}: ${oauthError || refreshErr.message} (http=${httpStatus || "n/a"})`);

      // Distinguish a genuinely dead grant from a transient refresh failure.
      // Google returns `invalid_grant` (usually HTTP 400) ONLY when the refresh
      // token is actually revoked/expired — that's a real "please reconnect"
      // and must surface as 401. A network blip, timeout, or Google 5xx while
      // refreshing does NOT mean the account is disconnected; classifying those
      // as 401 made the Ads Factory Autopilot falsely auto-pause a healthy job
      // with "google account not connected". Surface transient failures as 503
      // so callers (and the autopilot connection probe) treat them as retryable,
      // not as a broken connection.
      const isRevokedGrant =
        /invalid_grant|invalid_rapt|token has been expired or revoked|unauthorized_client/i.test(
          oauthError,
        );
      const err = new Error(
        isRevokedGrant
          ? "Google access token expired. Please reconnect your Google account."
          : "Could not refresh Google access token right now (temporary). Please try again shortly.",
      );
      err.statusCode = isRevokedGrant ? 401 : 503;
      throw err;
    }
  } else if (redisClient && accessToken) {
    // Token still valid — cache it for remaining TTL
    const ttl = Math.max(Math.floor((new Date(googleUser.tokenExpiresAt) - Date.now()) / 1000) - 300, 60);
    redisClient.set(tokenCacheKey, JSON.stringify({ accessToken }), "EX", ttl).catch(() => {});
  }

  if (!accessToken) {
    const err = new Error("Google access token is missing. Please reconnect your Google account.");
    err.statusCode = 401;
    throw err;
  }

  const client = new GoogleAdsApi({
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    developer_token: process.env.GOOGLE_DEVELOPER_TOKEN,
    use_proto_plus: true,
    version: "v23",
  });

  return { googleUser, accessToken, refreshToken, client };
}

function getCustomerClient(client, customerId, loginCustomerId, refreshToken) {
  return client.Customer({
    customer_id: String(customerId),
    login_customer_id: loginCustomerId ? String(loginCustomerId) : undefined,
    refresh_token: refreshToken,
  });
}

// Map Google Ads GAQL datePreset → date range
function datePresetToRange(preset, timeZone) {
  let today;
  try {
    today = timeZone ? dayjs().tz(timeZone) : dayjs();
  } catch {
    today = dayjs();
  }
  const quarter = Math.floor(today.month() / 3);
  const thisQStart = today.startOf("year").add(quarter * 3, "month");
  const lastQStart = thisQStart.subtract(3, "month");
  const lastQEnd = thisQStart.subtract(1, "day");
  // lifetime / maximum: Google Ads data is available from 2001-01-01
  const epochStart = "2001-01-01";
  const map = {
    today: [today.format("YYYY-MM-DD"), today.format("YYYY-MM-DD")],
    yesterday: [today.subtract(1, "day").format("YYYY-MM-DD"), today.subtract(1, "day").format("YYYY-MM-DD")],
    last_3d: [today.subtract(2, "day").format("YYYY-MM-DD"), today.format("YYYY-MM-DD")],
    last_7d: [today.subtract(6, "day").format("YYYY-MM-DD"), today.format("YYYY-MM-DD")],
    last_14d: [today.subtract(13, "day").format("YYYY-MM-DD"), today.format("YYYY-MM-DD")],
    last_28d: [today.subtract(27, "day").format("YYYY-MM-DD"), today.format("YYYY-MM-DD")],
    last_30d: [today.subtract(29, "day").format("YYYY-MM-DD"), today.format("YYYY-MM-DD")],
    last_90d: [today.subtract(89, "day").format("YYYY-MM-DD"), today.format("YYYY-MM-DD")],
    this_month: [today.startOf("month").format("YYYY-MM-DD"), today.format("YYYY-MM-DD")],
    last_month: [today.subtract(1, "month").startOf("month").format("YYYY-MM-DD"), today.subtract(1, "month").endOf("month").format("YYYY-MM-DD")],
    this_quarter: [thisQStart.format("YYYY-MM-DD"), today.format("YYYY-MM-DD")],
    last_quarter: [lastQStart.format("YYYY-MM-DD"), lastQEnd.format("YYYY-MM-DD")],
    this_year: [today.startOf("year").format("YYYY-MM-DD"), today.format("YYYY-MM-DD")],
    last_year: [today.subtract(1, "year").startOf("year").format("YYYY-MM-DD"), today.subtract(1, "year").endOf("year").format("YYYY-MM-DD")],
    lifetime: [epochStart, today.format("YYYY-MM-DD")],
    maximum: [epochStart, today.format("YYYY-MM-DD")],
  };
  return map[preset] || map["last_30d"];
}

async function resolveManagerForAccount(customerId, accessToken, userId = null) {
  const tid = normalizeCustomerId(customerId);
  const cacheKey = `googleManagerMap:${tid}`;

  try {
    // 1. Redis cache (fastest)
    if (redisClient) {
      const cachedManager = await redisClient.get(cacheKey);
      if (cachedManager) return cachedManager === "SELF" ? tid : cachedManager;
    }

    // 2. MongoDB cache (survives Redis restart)
    if (userId) {
      const dbUser = await GoogleUsers.findOne({ userId }).lean();
      const dbManager = dbUser?.managerMap?.[tid];
      if (dbManager) {
        const resolved = dbManager === "SELF" ? tid : dbManager;
        if (redisClient) await redisClient.set(cacheKey, dbManager, "EX", 86400);
        return resolved;
      }
    }

    // 3. Parallel: check accessible customers to find manager
    const accessibleResp = await axios.get("https://googleads.googleapis.com/v23/customers:listAccessibleCustomers", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "developer-token": process.env.GOOGLE_DEVELOPER_TOKEN,
      },
    });
    const candidates = (accessibleResp.data.resourceNames || []).map(rn => rn.split("/").pop());

    const checkTasks = candidates.map(async (managerId) => {
      try {
        const checkResp = await axios.post(
          `https://googleads.googleapis.com/v23/customers/${managerId}/googleAds:searchStream`,
          { query: `SELECT customer_client.id FROM customer_client WHERE customer_client.id = ${tid} AND customer_client.level <= 1` },
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "developer-token": process.env.GOOGLE_DEVELOPER_TOKEN,
              "login-customer-id": managerId,
              "Content-Type": "application/json",
            },
            timeout: 5000,
          }
        );
        return (checkResp.data?.[0]?.results || []).length > 0 ? managerId : null;
      } catch (e) {
        return null;
      }
    });

    const results = await Promise.all(checkTasks);
    const foundManager = results.find(m => m !== null) || null;
    const cacheValue = foundManager && foundManager !== tid ? foundManager : "SELF";

    // Persist to both Redis and MongoDB
    if (redisClient) await redisClient.set(cacheKey, cacheValue, "EX", 86400);
    if (userId) {
      GoogleUsers.findOneAndUpdate(
        { userId },
        { $set: { [`managerMap.${tid}`]: cacheValue } }
      ).catch(() => {});
    }

    return foundManager || null;
  } catch (err) {
    return null;
  }
}

class GoogleAdController {
  constructor() {
    this.getAdAccountsList = this.getAdAccountsList.bind(this);
    this.checkGoogleAdsAccount = this.checkGoogleAdsAccount.bind(this);
    this.getDashboardData = this.getDashboardData.bind(this);
    this.getAnalyticsData = this.getAnalyticsData.bind(this);
    this.getCampaignsByCustomer = this.getCampaignsByCustomer.bind(this);
    this.getAdGroupsByCampaignId = this.getAdGroupsByCampaignId.bind(this);
    this.getAdsByCampaignId = this.getAdsByCampaignId.bind(this);
    this.getAdsByAdGroupId = this.getAdsByAdGroupId.bind(this);
    this.getInsights = this.getInsights.bind(this);
    this.runAudit = this.runAudit.bind(this);
    this.updateStatus = this.updateStatus.bind(this);
    this.createCampaignAPI = this.createCampaignAPI.bind(this);
    this.createAdGroupAPI = this.createAdGroupAPI.bind(this);
    this.createAdAPI = this.createAdAPI.bind(this);
    this.updateAdAPI = this.updateAdAPI.bind(this);
    this.deleteAdAPI = this.deleteAdAPI.bind(this);
    this.getAd = this.getAd.bind(this);
    this.resolveAdForEdit = this.resolveAdForEdit.bind(this);
    this.uploadMediaAPI = this.uploadMediaAPI.bind(this);
    this.uploadVideoAPI = this.uploadVideoAPI.bind(this);
    this.deleteCampaignAPI = this.deleteCampaignAPI.bind(this);
    this.deleteAdGroupAPI = this.deleteAdGroupAPI.bind(this);
    this.addAssetToAssetGroupAPI = this.addAssetToAssetGroupAPI.bind(this);
    this.removeAssetFromAssetGroupAPI = this.removeAssetFromAssetGroupAPI.bind(this);
    this.getWizardSchema = this.getWizardSchema.bind(this);
    this.getCtaOptions = this.getCtaOptions.bind(this);
  }
  // * 1. GET all Google Ads accounts
  async getAdAccountsList(req, res) {
    /* #swagger.tags = ['Google Ads']
       #swagger.summary = 'Get ad accounts'
       #swagger.description = 'Get all accessible Google Ads customer accounts for the authenticated user'
       #swagger.security = [{ "BearerAuth": [] }]
    */
    try {
      const userId = req.user.user_id;

      const cacheKey = `googleAdAccounts:${userId}:postable`;
      const cached = await redisClient.get(cacheKey);
      if (cached) return res.status(200).json(JSON.parse(cached));

      const { client, refreshToken, accessToken, googleUser } = await initGoogleApiForUser(userId);

      // List accessible customers to find manager + client accounts
      let tokenResp;
      try {
        tokenResp = await axios.get("https://googleads.googleapis.com/v23/customers:listAccessibleCustomers", {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "developer-token": process.env.GOOGLE_DEVELOPER_TOKEN,
          },
        });
      } catch (axiosErr) {
        const status = axiosErr.response?.status;
        const detail = JSON.stringify(axiosErr.response?.data || axiosErr.message);
        logger.error(`Google listAccessibleCustomers failed [${status}]: ${detail}`);
        if (isGoogleAdsPermissionRestricted(axiosErr)) {
          const storedIds = googleUser.customerIds || [];
          if (storedIds.length > 0) {
            tokenResp = { data: { resourceNames: storedIds.map((id) => `customers/${id}`) } };
          } else {
            const response = {
              status: true,
              adAccounts: [],
              count: 0,
              hasNoAccount: true,
              noAccountReason: "google_ads_developer_token_restricted",
              message: "Google Ads is connected, but no accessible accounts found. Please reconnect your Google account.",
            };
            await redisClient.set(cacheKey, JSON.stringify(response), "EX", VOLATILE_TTL);
            return res.status(200).json(response);
          }
        } else {
          return res.status(status || 500).json({
            status: false,
            error: status === 401 ? "Google access token expired. Please reconnect your Google account." : "Failed to fetch ad accounts from Google",
            details: detail,
          });
        }
      }

      const resourceNames = tokenResp.data?.resourceNames || [];
      if (!resourceNames.length) {
        const response = {
          status: true,
          adAccounts: [],
          count: 0,
          hasNoAccount: true,
          noAccountReason: "no_google_ads_account",
          message: "Your Google account is not linked to any Google Ads account.",
          createAccountUrl: "https://ads.google.com/home/",
        };
        await redisClient.set(cacheKey, JSON.stringify(response), "EX", REDIS_TTL);
        return res.status(200).json(response);
      }

      const accounts = [];
      const seen = new Set();

      // All candidate customer IDs — used as fallback login-customer-id for Basic access
      const allCandidateIds = resourceNames.map((rn) => normalizeCustomerId(rn.replace("customers/", "")));

      const customerQuery = `
        SELECT
          customer.id,
          customer.descriptive_name,
          customer.currency_code,
          customer.time_zone,
          customer.status,
          customer.manager,
          customer.test_account
        FROM customer
        LIMIT 1
      `;

      // Helper: query a customer's own details, retrying with each MCC candidate as login-customer-id
      const queryCustomerDetails = async (customerId) => {
        const loginIds = [customerId, ...allCandidateIds.filter((id) => id !== customerId)];
        let lastErr = null;
        for (const loginId of loginIds) {
          try {
            const resp = await axios.post(
              `https://googleads.googleapis.com/v23/customers/${customerId}/googleAds:searchStream`,
              { query: customerQuery },
              {
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                  "developer-token": process.env.GOOGLE_DEVELOPER_TOKEN,
                  "login-customer-id": loginId,
                  "Content-Type": "application/json",
                },
                timeout: 10000,
              }
            );
            return resp;
          } catch (err) {
            lastErr = err;
            // Always continue to next candidate on 4xx — only bail on network/timeout errors
            if (err?.response?.status >= 400 && err?.response?.status < 500) continue;
            throw err;
          }
        }
        throw lastErr;
      };

      // Use searchStream REST for all queries in parallel
      const accountTasks = resourceNames.map(async (rn) => {
        const customerId = normalizeCustomerId(rn.replace("customers/", ""));
        try {
          // Query this account's own details + whether it's a manager
          const selfResp = await queryCustomerDetails(customerId);

          const rows = selfResp.data?.[0]?.results || [];
          if (!rows.length) return [];

          const c = rows[0].customer;
          const cid = normalizeCustomerId(c.id);
          const results = [];

          results.push({
            id: cid,
            name: c.descriptiveName || `Google Ads Account ${cid}`,
            status: formatAccountStatus(c.status),
            rawStatus: c.status,
            currency: c.currencyCode,
            timezone: c.timeZone,
            isManager: c.manager || false,
            isTestAccount: c.testAccount || false,
            loginCustomerId: c.manager ? cid : customerId,
          });

          // Fetch children if MCC
          if (c.manager) {
            try {
              const childResp = await axios.post(
                `https://googleads.googleapis.com/v23/customers/${cid}/googleAds:searchStream`,
                {
                  query: `
                    SELECT
                      customer_client.id,
                      customer_client.descriptive_name,
                      customer_client.currency_code,
                      customer_client.time_zone,
                      customer_client.status,
                      customer_client.manager,
                      customer_client.test_account
                    FROM customer_client
                    WHERE customer_client.level <= 1
                  `,
                },
                {
                  headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "developer-token": process.env.GOOGLE_DEVELOPER_TOKEN,
                    "login-customer-id": cid,
                    "Content-Type": "application/json",
                  },
                  timeout: 10000,
                }
              );
              const children = childResp.data?.[0]?.results || [];
              for (const row of children) {
                const cc = row.customerClient;
                const childId = normalizeCustomerId(cc.id);
                results.push({
                  id: childId,
                  name: cc.descriptiveName || childId,
                  status: formatAccountStatus(cc.status),
                  rawStatus: cc.status,
                  currency: cc.currencyCode,
                  timezone: cc.timeZone,
                  isManager: cc.manager || false,
                  isTestAccount: cc.testAccount || false,
                  loginCustomerId: cid,
                });
              }
            } catch (childErr) {
              const managerAcc = results[0];
              if (managerAcc) {
                managerAcc.hierarchyLocked = true;
                managerAcc.lockReason = childErr.response?.data?.error?.status || "CHILDREN_INACCESSIBLE";
              }
            }
          }
          return results;
        } catch (err) {
          return [{
            id: customerId,
            name: `Google Ads Account (${customerId})`,
            status: mapGoogleAccountErrorStatus(err),
            rawStatus: "UNSPECIFIED",
            currency: "Unknown",
            timezone: "Unknown",
            isManager: false,
            loginCustomerId: customerId,
            errorReason: getGoogleAdsErrorReason(err) || err.response?.data?.error?.status || "API_ERROR",
          }];
        }
      });

      const taskResults = await Promise.all(accountTasks);
      taskResults.flat().forEach(acc => {
        if (!seen.has(acc.id)) {
          seen.add(acc.id);
          accounts.push(acc);
        }
      });

      const postableAccounts = accounts.filter(isPostableGoogleAccount);
      const hasProductionBlockedAccounts = accounts.some((a) => a.status === "PRODUCTION_BLOCKED");

      const response = {
        status: true,
        adAccounts: postableAccounts,
        count: postableAccounts.length,
        hasNoAccount: postableAccounts.length === 0,
        allDeactivated: postableAccounts.length === 0 && accounts.length > 0,
        hasProductionBlockedAccounts,
        message: postableAccounts.length > 0
          ? "Google Ads accounts fetched successfully."
          : "No postable Google Ads accounts found for this user."
      };

      // Write postable response under the `:postable` key (served to callers)
      // and write the full account list under the bare key so getBlockedGoogleAccounts
      // can find PRODUCTION_BLOCKED entries without re-fetching.
      await Promise.all([
        redisClient.set(cacheKey, JSON.stringify(response), "EX", REDIS_TTL),
        redisClient.set(`googleAdAccounts:${userId}`, JSON.stringify({ adAccounts: accounts }), "EX", REDIS_TTL),
      ]);
      return res.status(200).json(response);
    } catch (error) {
      const m = formatGoogleError(error);
      logger.error(`Google get ad accounts error: ${m.message}`);
      return res.status(error.statusCode || 500).json({
        status: false,
        error: "Failed to fetch ad accounts",
        details: m.message,
        reason: m.reason,
      });
    }
  }
  // * 5. GET campaigns by customer
  async getCampaignsByCustomer(req, res) {
    /* #swagger.tags = ['Google Ads']
       #swagger.summary = 'Get campaigns'
       #swagger.description = 'Get all campaigns and ad groups for a Google Ads customer account. Use adType to filter campaigns by supported ad format.'
       #swagger.security = [{ "BearerAuth": [] }]
       #swagger.parameters['adAccountId'] = { description: 'Google Ads customer ID (required)', type: 'string' }
       #swagger.parameters['adType'] = {
         in: 'query',
         description: 'Filter campaigns by supported ad type(s). Pass one or multiple: ?adType=text&adType=image. text → SEARCH. image → DISPLAY + PERFORMANCE_MAX + SHOPPING + APP_PROMOTION + MULTI_CHANNEL. video → VIDEO + YOUTUBE_REACH + DEMAND_GEN. Omit for all.',
         type: 'array',
         items: { type: 'string', enum: ['text', 'image', 'video'] },
         collectionFormat: 'multi'
       }
       #swagger.parameters['group'] = {
         in: 'query',
         description: 'Filter campaigns by structure group. ads → campaigns that use ad groups + ads (every channel type except PERFORMANCE_MAX). assets → PERFORMANCE_MAX campaigns, which use asset groups + assets instead of ad groups/ads. Omit for all. Composes with adType (both filters apply together).',
         type: 'array',
         items: { type: 'string', enum: ['ads', 'assets'] },
         collectionFormat: 'multi'
       }
       #swagger.parameters['refresh'] = {
         in: 'query',
         description: 'Set to true to bypass cache and fetch fresh data',
         type: 'string',
         enum: ['true']
       }
    */
    try {
      const userId = req.user.user_id;
      const adAccountId = sanitizeId(getQueryParam(req.query, ["adAccountId", "customerId"]));
      // adType can be a single string or array: ?adType=text&adType=image
      const adTypeRaw = req.query.adType;
      const adTypes = adTypeRaw
        ? (Array.isArray(adTypeRaw) ? adTypeRaw : [adTypeRaw]).map(t => t.toLowerCase())
        : [];

      // Same three-bucket mapping used for Google template filtering
      // (googleCampaignTemplate.controller.js deriveMediaType) — keeps the
      // vocabulary consistent between saved templates and live campaigns.
      const AD_TYPE_CHANNEL_MAP = {
        text:  ["SEARCH"],
        image: ["DISPLAY", "PERFORMANCE_MAX", "SHOPPING", "APP_PROMOTION", "MULTI_CHANNEL"],
        video: ["VIDEO", "YOUTUBE_REACH", "DEMAND_GEN"],
      };
      let allowedChannelTypes = adTypes.length
        ? [...new Set(adTypes.flatMap(t => AD_TYPE_CHANNEL_MAP[t] || []))]
        : null;

      // group=ads|assets — structural filter. Only PERFORMANCE_MAX campaigns
      // use asset groups + assets; every other channel type uses ad groups +
      // ads. Composes with adType by intersecting the two allow-lists.
      // Defaults to "ads" when omitted — PERFORMANCE_MAX campaigns are
      // excluded unless the caller explicitly asks for group=assets.
      const groupRaw = req.query.group;
      const groups = groupRaw
        ? (Array.isArray(groupRaw) ? groupRaw : [groupRaw]).map(g => g.toLowerCase())
        : ["ads"];
      const GROUP_CHANNEL_MAP = {
        assets: ["PERFORMANCE_MAX"],
        ads:    ["SEARCH", "DISPLAY", "VIDEO", "YOUTUBE_REACH", "DEMAND_GEN", "SHOPPING", "APP_PROMOTION", "MULTI_CHANNEL"],
      };
      const allowedGroupTypes = [...new Set(groups.flatMap(g => GROUP_CHANNEL_MAP[g] || []))];
      allowedChannelTypes = allowedChannelTypes
        ? allowedChannelTypes.filter(ct => allowedGroupTypes.includes(ct))
        : allowedGroupTypes;

      const adTypeKey = adTypes.length ? `:${adTypes.sort().join(',')}` : '';
      const groupKey  = groups.length ? `:g${groups.sort().join(',')}` : '';
      const cacheKey = `googleCampaignsAll:v5:${userId}:${adAccountId || "all"}${adTypeKey}${groupKey}`;
      if (!wantsCacheRefresh(req)) {
        const cached = await redisClient.get(cacheKey);
        if (cached) {
          const parsed = normalizeCampaignsResponse(JSON.parse(cached), adAccountId);
          const hasError = parsed?.data?.some((d) => d.error);
          const staleEmpty = adAccountId && !parsed?.campaigns?.length && parsed?.data?.some((d) => d.error);
          if (!hasError && !staleEmpty) {
            if (allowedChannelTypes) {
              parsed.data = (parsed.data || []).map(d => ({
                ...d,
                campaigns: (d.campaigns || []).filter(c => allowedChannelTypes.includes(c.channelType)),
              }));
              if (parsed.campaigns) parsed.campaigns = parsed.campaigns.filter(c => allowedChannelTypes.includes(c.channelType));
              parsed.totalCampaigns = (parsed.data || []).reduce((sum, d) => sum + (d.campaigns?.length || 0), 0);
              parsed.count = parsed.campaigns?.length ?? parsed.totalCampaigns;
            }
            return res.status(200).json(parsed);
          }
          await redisClient.del(cacheKey);
        }
      }

      const { accessToken } = await initGoogleApiForUser(userId);

      let accountsToFetch = [];

      if (adAccountId) {
        // Mode A: Specific Account — skip listAccessibleCustomers entirely
        const tid = normalizeRequestCustomerId(res, adAccountId);
        if (!tid) return;
        let resolvedMcc = await resolveManagerForAccount(tid, accessToken, userId);
        const mccId = normalizeCustomerId(resolvedMcc || tid);
        accountsToFetch.push({ id: tid, loginCustomerId: mccId });

        // If it's a manager, try fetching children
        try {
          const childResp = await axios.post(
            `https://googleads.googleapis.com/v23/customers/${tid}/googleAds:searchStream`,
            {
              query: "SELECT customer_client.id, customer_client.manager FROM customer_client WHERE customer_client.level = 1"
            },
            {
              headers: {
                Authorization: `Bearer ${accessToken}`,
                "developer-token": process.env.GOOGLE_DEVELOPER_TOKEN,
                "login-customer-id": mccId,
                "Content-Type": "application/json",
              },
            }
          );
          const children = childResp.data?.[0]?.results || [];
          children.forEach(r => {
            if (!r.customerClient.manager) {
              accountsToFetch.push({ id: normalizeCustomerId(r.customerClient.id), loginCustomerId: tid });
            }
          });
        } catch (e) {

        }
      } else {
        // Mode B: Discovery Mode (All accounts + children)
        const tokenResp = await axios.get("https://googleads.googleapis.com/v23/customers:listAccessibleCustomers", {
          headers: { Authorization: `Bearer ${accessToken}`, "developer-token": process.env.GOOGLE_DEVELOPER_TOKEN },
        });
        const accessibleCustomers = (tokenResp.data?.resourceNames || []).map(r =>
          normalizeCustomerId(r.replace("customers/", ""))
        );

        const discoveryTasks = accessibleCustomers.map(async (cid) => {
          const accs = [{ id: cid, loginCustomerId: cid }]; // Use itself as loginCustomerId for discovery
          try {
            const selfResp = await axios.post(
              `https://googleads.googleapis.com/v23/customers/${cid}/googleAds:searchStream`,
              { query: "SELECT customer.manager FROM customer LIMIT 1" },
              {
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                  "developer-token": process.env.GOOGLE_DEVELOPER_TOKEN,
                  "login-customer-id": cid,
                  "Content-Type": "application/json",
                },
              }
            );

            const isManager = selfResp.data?.[0]?.results?.[0]?.customer?.manager;
            
            if (isManager) {

              const childResp = await axios.post(
                `https://googleads.googleapis.com/v23/customers/${cid}/googleAds:searchStream`,
                {
                  query: `
                    SELECT customer_client.id, customer_client.manager, customer_client.status
                    FROM customer_client
                    WHERE customer_client.level = 1 
                      AND customer_client.manager = false
                  `
                },
                {
                  headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "developer-token": process.env.GOOGLE_DEVELOPER_TOKEN,
                    "login-customer-id": cid,
                    "Content-Type": "application/json",
                  },
                }
              );
              
              const children = childResp.data?.[0]?.results || [];

              children.forEach(row => {
                accs.push({ id: normalizeCustomerId(row.customerClient.id), loginCustomerId: cid });
              });
            }
          } catch (e) {
            const m = formatGoogleError(e);
              logger.error(`Discovery failed for ${cid}: ${m.message}`);
          }
          return accs;
        });

        const discoveryResults = await Promise.all(discoveryTasks);
        accountsToFetch = discoveryResults.flat();
      }

      // Deduplicate
      const seen = new Set();
      accountsToFetch = accountsToFetch.filter(a => {
        const key = `${a.id}_${a.loginCustomerId}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      // 2. Fetch data in parallel
      const dataResults = await Promise.all(accountsToFetch.map(async (acc) => {
        const fetchCampaigns = async (targetId, loginId) => {
          const headers = {
            Authorization: `Bearer ${accessToken}`,
            "developer-token": process.env.GOOGLE_DEVELOPER_TOKEN,
            "login-customer-id": loginId,
            "Content-Type": "application/json",
          };
          // Full query — primary_status + serving_status + budget period
          const fullCampaignGaql = `
            SELECT
              campaign.id,
              campaign.name,
              campaign.status,
              campaign.primary_status,
              campaign.primary_status_reasons,
              campaign.serving_status,
              campaign.advertising_channel_type,
              campaign.bidding_strategy_type,
              campaign.start_date_time,
              campaign.end_date_time,
              campaign_budget.amount_micros,
              campaign_budget.period
            FROM campaign
            WHERE campaign.status != 'REMOVED'
            ORDER BY campaign.id DESC
          `;
          // Base fallback — minimal safe fields guaranteed on all v23 accounts
          const baseCampaignGaql = `
            SELECT
              campaign.id,
              campaign.name,
              campaign.status,
              campaign.advertising_channel_type,
              campaign.bidding_strategy_type,
              campaign_budget.amount_micros
            FROM campaign
            WHERE campaign.status != 'REMOVED'
            ORDER BY campaign.id DESC
          `;

          let results = [];
          let spendByCampaign = {};
          const campUrl = `https://googleads.googleapis.com/v23/customers/${targetId}/googleAds:searchStream`;

          try {
            const campResp = await axios.post(campUrl, { query: fullCampaignGaql }, { headers });
            results = campResp.data?.[0]?.results || [];
          } catch (campErr) {
            logger.warn(`Campaign full GAQL failed for ${targetId}, falling back to base: ${formatGoogleError(campErr).message}`);
            try {
              const campResp = await axios.post(campUrl, { query: baseCampaignGaql }, { headers });
              results = campResp.data?.[0]?.results || [];
            } catch (baseErr) {
              logger.error(`Campaign base GAQL also failed for ${targetId}: ${formatGoogleError(baseErr).message}`);
            }
          }

          try {
            const spendResp = await axios.post(campUrl, {
              query: `
                SELECT campaign.id, metrics.cost_micros
                FROM campaign
                WHERE segments.date DURING TODAY AND campaign.status != 'REMOVED'
              `,
            }, { headers });
            (spendResp.data?.[0]?.results || []).forEach((r) => {
              const cid = String((r.campaign || {}).id || "");
              const cost = Number(r.metrics?.costMicros || r.metrics?.cost_micros || 0);
              if (cid) spendByCampaign[cid] = (spendByCampaign[cid] || 0) + cost;
            });
          } catch (_) { /* budget remaining is optional */ }
          return results.map(r => {
            const c = r.campaign;
            const channelType = robustFormatChannelType(c.advertisingChannelType || c.advertising_channel_type);
            const rawPrimaryStatus = c.primaryStatus || c.primary_status;
            const rawServingStatus = c.servingStatus || c.serving_status;
            const biddingStrategyType = c.biddingStrategyType || c.bidding_strategy_type;
            const budget = r.campaignBudget || r.campaign_budget;
            const cid = String(c.id);
            const dailyMicros = Number(budget?.amountMicros || budget?.amount_micros || 0);
            const spentToday = spendByCampaign[cid] || 0;
            const budgetPeriod = budget?.period || "DAILY";
            const remainingMicros = budgetPeriod === "DAILY" && dailyMicros
              ? Math.max(0, dailyMicros - spentToday)
              : null;

            // Derive serving status from reasons + raw serving_status
            const campReasons = c.primaryStatusReasons || c.primary_status_reasons || [];
            const campReasonList = Array.isArray(campReasons) ? campReasons : [campReasons];
            let derivedServingStatus = (rawServingStatus && rawServingStatus !== "UNKNOWN" && rawServingStatus !== "UNSPECIFIED" && rawServingStatus !== "SERVING") ? rawServingStatus : null;
            if (!derivedServingStatus) {
              if (campReasonList.some(r => /DISAPPROVED/i.test(String(r)))) derivedServingStatus = 'ADS_DISAPPROVED';
              else if (campReasonList.some(r => /POLICY/i.test(String(r)))) derivedServingStatus = 'ADS_LIMITED_BY_POLICY';
              else if (campReasonList.some(r => /BUDGET/i.test(String(r)))) derivedServingStatus = 'BUDGET_PAUSED';
            }
            // Upgrade ELIGIBLE → ELIGIBLE_LIMITED when policy reasons exist
            let primaryStatus = (rawPrimaryStatus && rawPrimaryStatus !== "UNKNOWN" && rawPrimaryStatus !== "UNSPECIFIED") ? rawPrimaryStatus : null;
            if (primaryStatus === "ELIGIBLE" && derivedServingStatus === "ADS_LIMITED_BY_POLICY") {
              primaryStatus = "ELIGIBLE_LIMITED";
            }
            if (primaryStatus === "ELIGIBLE" && derivedServingStatus === "ADS_DISAPPROVED") {
              primaryStatus = "ELIGIBLE_LIMITED";
            }
            return {
              id: cid,
              campaignId: cid,
              name: c.name,
              status: robustFormatStatus(c.status),
              primaryStatus,
              servingStatus: derivedServingStatus,
              channelType: (channelType && channelType !== "UNKNOWN") ? channelType : null,
              objective: deriveObjective(c.advertisingChannelType || c.advertising_channel_type),
              biddingStrategy: robustFormatBiddingStrategy(biddingStrategyType),
              startDate: (c.startDateTime || c.start_date_time || '').slice(0, 10) || null,
              endDate: (c.endDateTime || c.end_date_time || '').slice(0, 10) || null,
              dailyBudgetMicros: dailyMicros,
              budgetMicros: dailyMicros,
              budget: formatBudget(dailyMicros),
              budgetPeriod,
              budgetRemainingMicros: remainingMicros,
              budget_remaining: remainingMicros != null ? formatBudget(remainingMicros) : null,
            };
          });
        };

        const fetchAdGroups = async (targetId, loginId) => {
          const adGroupUrl = `https://googleads.googleapis.com/v23/customers/${targetId}/googleAds:searchStream`;
          const adGroupHeaders = {
            Authorization: `Bearer ${accessToken}`,
            "developer-token": process.env.GOOGLE_DEVELOPER_TOKEN,
            "login-customer-id": loginId,
            "Content-Type": "application/json",
          };
          const fullAdGroupGaql = `
            SELECT
              ad_group.id,
              ad_group.name,
              ad_group.status,
              ad_group.primary_status,
              ad_group.primary_status_reasons,
              ad_group.type,
              ad_group.target_cpa_micros,
              ad_group.target_roas,
              campaign.id,
              campaign.name
            FROM ad_group
            WHERE campaign.advertising_channel_type IN ('SEARCH', 'DISPLAY', 'SHOPPING', 'MULTI_CHANNEL', 'DEMAND_GEN', 'VIDEO')
          `;
          const baseAdGroupGaql = `
            SELECT
              ad_group.id,
              ad_group.name,
              ad_group.status,
              ad_group.type,
              ad_group.target_cpa_micros,
              ad_group.target_roas,
              campaign.id,
              campaign.name
            FROM ad_group
            WHERE campaign.advertising_channel_type IN ('SEARCH', 'DISPLAY', 'SHOPPING', 'MULTI_CHANNEL', 'DEMAND_GEN', 'VIDEO')
          `;
          try {
            let agResults = [];
            try {
              const resp = await axios.post(adGroupUrl, { query: fullAdGroupGaql }, { headers: adGroupHeaders });
              agResults = resp.data?.[0]?.results || [];
            } catch (_) {
              const resp = await axios.post(adGroupUrl, { query: baseAdGroupGaql }, { headers: adGroupHeaders });
              agResults = resp.data?.[0]?.results || [];
            }
            return agResults.map(r => {
              const ag = r.adGroup || r.ad_group;
              const agid = String(ag.id);
              const rawPrimaryStatus = ag.primaryStatus || ag.primary_status;
              const reasons = ag.primaryStatusReasons || ag.primary_status_reasons || [];
              const reasonList = Array.isArray(reasons) ? reasons : [reasons];
              // Derive serving-status-like string from reasons for UI subtitle
              let derivedServingStatus = null;
              if (reasonList.some(r => /DISAPPROVED/i.test(String(r)))) derivedServingStatus = 'ADS_DISAPPROVED';
              else if (reasonList.some(r => /POLICY_VIOLATION|POLICY/i.test(String(r)))) derivedServingStatus = 'ADS_LIMITED_BY_POLICY';
              else if (reasonList.some(r => /AD_GROUP_AD.*PAUSED|ALL_ADS_PAUSED/i.test(String(r)))) derivedServingStatus = 'ADS_PAUSED';
              // Upgrade ELIGIBLE → ELIGIBLE_LIMITED when reasons indicate policy limits
              let primaryStatus = (rawPrimaryStatus && rawPrimaryStatus !== "UNKNOWN" && rawPrimaryStatus !== "UNSPECIFIED") ? rawPrimaryStatus : null;
              if (primaryStatus === "ELIGIBLE" && derivedServingStatus === "ADS_LIMITED_BY_POLICY") {
                primaryStatus = "ELIGIBLE_LIMITED";
              }
              return {
                id: agid,
                adGroupId: agid,
                name: ag.name,
                status: robustFormatStatus(ag.status),
                primaryStatus,
                servingStatus: derivedServingStatus,
                type: ag.type,
                cpcBidMicros: ag.cpcBidMicros || ag.cpc_bid_micros || null,
                targetCpa: (ag.targetCpaMicros || ag.target_cpa_micros) ? (ag.targetCpaMicros || ag.target_cpa_micros) / 1e6 : null,
                targetRoas: ag.targetRoas || ag.target_roas || null,
                campaignId: String(r.campaign.id),
                campaignName: r.campaign.name,
                isPmax: false,
              };
            });
          } catch (e) {
            logger.error(`fetchAdGroups failed: ${e?.response?.data ? JSON.stringify(e.response.data) : e.message}`);
            return [];
          }
        };

        const fetchAssetGroups = async (targetId, loginId) => {
          try {
            const resp = await axios.post(
              `https://googleads.googleapis.com/v23/customers/${targetId}/googleAds:searchStream`,
              {
                query: `
                  SELECT
                    asset_group.id,
                    asset_group.name,
                    asset_group.status,
                    asset_group.primary_status,
                    campaign.id,
                    campaign.name,
                    campaign.status
                  FROM asset_group
                  WHERE campaign.advertising_channel_type = 'PERFORMANCE_MAX'
                `,
              },
              {
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                  "developer-token": process.env.GOOGLE_DEVELOPER_TOKEN,
                  "login-customer-id": loginId,
                  "Content-Type": "application/json",
                },
              }
            );
            const results = resp.data?.[0]?.results || [];
            return results.map(r => {
              const ag = r.assetGroup || r.asset_group;
              const primaryStatus = ag.primaryStatus || ag.primary_status;
              return {
                id: String(ag.id),
                name: ag.name,
                status: robustFormatStatus(ag.status),
                primaryStatus: (primaryStatus && primaryStatus !== "UNKNOWN" && primaryStatus !== "UNSPECIFIED") ? primaryStatus : null,
                type: "ASSET_GROUP",
                campaignId: String(r.campaign.id),
                campaignName: r.campaign.name,
                campaignStatus: robustFormatStatus(r.campaign.status),
                isPmax: true,
              };
            });
          } catch (e) {
            logger.error(`fetchAssetGroups failed: ${e?.response?.data ? JSON.stringify(e.response.data) : e.message}`);
            return [];
          }
        };

        try {
          const tid = normalizeCustomerId(acc.id);
          const lid = normalizeCustomerId(acc.loginCustomerId || acc.id);

          // Parallel fetch campaigns, ad groups, and asset groups (PMax)
          let [campaigns, adGroups, assetGroups] = await Promise.all([
            fetchCampaigns(tid, lid),
            fetchAdGroups(tid, lid),
            fetchAssetGroups(tid, lid),
          ]);

          // If no campaigns found with MCC, try with account itself as login customer
          if (!campaigns.length && lid !== tid) {
            try {
              const [retryCampaigns, retryAdGroups, retryAssetGroups] = await Promise.all([
                fetchCampaigns(tid, tid),
                fetchAdGroups(tid, tid),
                fetchAssetGroups(tid, tid),
              ]);
              if (retryCampaigns.length) {
                assetGroups = retryAssetGroups;
                campaigns = retryCampaigns;
                adGroups = retryAdGroups;
                acc.loginCustomerId = tid; // Update login customer ID for the response
              }
            } catch (retryErr) {
              logger.error(`Retry fetch failed for ${tid}: ${retryErr.message}`);
            }
          }

          // Merge ad groups + asset groups (PMax) into one map keyed by campaignId
          const adGroupsByCampaign = {};
          [...adGroups, ...assetGroups].forEach(ag => {
            if (!adGroupsByCampaign[ag.campaignId]) adGroupsByCampaign[ag.campaignId] = [];
            adGroupsByCampaign[ag.campaignId].push(ag);
          });

          campaigns.forEach(c => {
            c.adGroups = adGroupsByCampaign[c.id] || [];
          });

          // Only hit IdentityVerificationService when a campaign looks blocked
          // account-wide — serving_status=SUSPENDED is ambiguous (could be a
          // real policy/billing suspension OR a routine verification pause),
          // so we resolve it with the one API that actually knows which.
          const hasSuspendedCampaign = campaigns.some(c => c.servingStatus === 'SUSPENDED');
          let identityVerification = null;
          let identityVerificationUnknown = false;
          if (hasSuspendedCampaign) {
            try {
              const ivResp = await axios.get(
                `https://googleads.googleapis.com/v23/customers/${tid}/getIdentityVerification`,
                { headers: { Authorization: `Bearer ${accessToken}`, "developer-token": process.env.GOOGLE_DEVELOPER_TOKEN, "login-customer-id": acc.loginCustomerId || tid } }
              );
              const programs = ivResp.data?.identityVerification || [];
              const advertiserProgram = programs.find(p => p.verificationProgram === 'ADVERTISER_IDENTITY_VERIFICATION') || programs[0];
              identityVerification = advertiserProgram?.verificationProgress?.programStatus || null;
            } catch (ivErr) {
              // Google restricts this endpoint to monthly-invoicing accounts
              // (identityVerificationError: BILLING_NOT_ON_MONTHLY_INVOICING) —
              // most self-serve/card-billed accounts can't be checked at all.
              identityVerificationUnknown = true;
              logger.warn(`Identity verification check failed for ${tid}: ${formatGoogleError(ivErr).message} | raw: ${JSON.stringify(ivErr?.response?.data)}`);
            }
          }

          if (identityVerification && identityVerification !== 'SUCCESS') {
            campaigns.forEach(c => {
              if (c.servingStatus === 'SUSPENDED') c.servingStatus = 'ACCOUNT_PAUSED_VERIFICATION';
            });
          } else if (identityVerificationUnknown) {
            // We genuinely don't know whether this is a policy/billing suspension
            // or a verification pause — say so honestly instead of guessing.
            campaigns.forEach(c => {
              if (c.servingStatus === 'SUSPENDED') c.servingStatus = 'ACCOUNT_BLOCKED_UNKNOWN';
            });
          }

          return {
            accountId: tid,
            loginCustomerId: acc.loginCustomerId || tid,
            campaigns,
            campaignCount: campaigns.length,
          };
        } catch (err) {
          const m = formatGoogleError(err);
          logger.error(`Campaign fetch failed for ${acc.id}: ${m.message} | reason: ${m.reason} | detail: ${JSON.stringify(m.details)} | raw: ${JSON.stringify(err?.response?.data || err?.message)}`);
          return {
            accountId: acc.id,
            campaigns: [],
            campaignCount: 0,
            error: m.message,
            reason: m.reason,
            isLocked: isGoogleTokenRestrictedMessage(m.message),
          };
        }
      }));

      const response = {
        status: true,
        data: dataResults,
        totalAccounts: dataResults.length,
        totalCampaigns: dataResults.reduce((sum, d) => sum + (d.campaignCount || 0), 0),
        totalAdGroups: dataResults.reduce((sum, d) => sum + (d.campaigns || []).reduce((s, c) => s + (c.adGroups?.length || 0), 0), 0),
      };

      if (allowedChannelTypes) {
        response.data = response.data.map(d => ({
          ...d,
          campaigns: (d.campaigns || []).filter(c => allowedChannelTypes.includes(c.channelType)),
        }));
        response.totalCampaigns = response.data.reduce((sum, d) => sum + (d.campaigns?.length || 0), 0);
      }

      if (adAccountId) {
        response.campaigns = dataResults.flatMap(d => d.campaigns || []).filter(c =>
          allowedChannelTypes ? allowedChannelTypes.includes(c.channelType) : true
        );
        response.count = response.campaigns.length;
      }

      await redisClient.set(cacheKey, JSON.stringify(response), "EX", REDIS_TTL);
      return res.status(200).json(response);
    } catch (error) {
      const m = formatGoogleError(error);
      logger.error(`Google get campaigns error: ${m.message}`);
      return res.status(500).json({ status: false, error: "Failed to fetch campaigns", details: m.message });
    }
  }

  // * 6. GET ad groups by campaign
  async getAdGroupsByCampaignId(req, res) {
    /* #swagger.tags = ['Google Ads']
       #swagger.summary = 'Get ad groups by campaign'
       #swagger.description = 'Get all ad groups for a specific campaign'
       #swagger.security = [{ "BearerAuth": [] }]
       #swagger.parameters['adAccountId'] = { description: 'Google Ads customer ID', type: 'string', required: true }
       #swagger.parameters['campaignId'] = { description: 'Campaign ID to filter ad groups', type: 'string', required: true }
    */
    try {
      const userId = req.user.user_id;
      const adAccountId = getQueryParam(req.query, ["adAccountId", "customerId"]);
      const { campaignId } = req.query;

      if (!adAccountId || !campaignId) {
        return res.status(400).json({ status: false, error: "adAccountId and campaignId are required" });
      }

      const tid = normalizeRequestCustomerId(res, adAccountId);
      if (!tid) return;
      const cacheKey = `googleAdGroups:v6:${userId}:${tid}:${campaignId}`;
      if (!wantsCacheRefresh(req)) {
        const cached = await redisClient.get(cacheKey);
        if (cached) return res.status(200).json(JSON.parse(cached));
      }

      const { accessToken } = await initGoogleApiForUser(userId);
      const resolvedLoginCustomerId = await resolveManagerForAccount(tid, accessToken, userId);
      const lid = normalizeCustomerId(resolvedLoginCustomerId || tid);

      const cleanCampaignId = sanitizeId(campaignId);
      const headers = { Authorization: `Bearer ${accessToken}`, "developer-token": process.env.GOOGLE_DEVELOPER_TOKEN, "login-customer-id": lid, "Content-Type": "application/json" };

      // Use channelType hint from frontend if provided, else detect from API
      const channelTypeHint = String(req.query.channelType || '').toUpperCase();
      let isPmax = channelTypeHint === 'PERFORMANCE_MAX';

      if (!channelTypeHint) {
        const campaignTypeResp = await axios.post(
          `https://googleads.googleapis.com/v23/customers/${tid}/googleAds:searchStream`,
          { query: `SELECT campaign.id, campaign.advertising_channel_type FROM campaign WHERE campaign.id = ${cleanCampaignId}` },
          { headers }
        ).catch((err) => { logger.error(`getAdGroups campaign type query failed: ${err?.response?.data ? JSON.stringify(err.response.data) : err.message}`); return { data: [] }; });
        const campResults = Array.isArray(campaignTypeResp.data)
          ? campaignTypeResp.data.flatMap(b => b?.results || [])
          : [];
        const detectedType = (campResults[0]?.campaign?.advertisingChannelType || campResults[0]?.campaign?.advertising_channel_type || '').toUpperCase();
        isPmax = detectedType === 'PERFORMANCE_MAX';
      }

      // Note: ad_group.start_date / end_date are NOT valid Google Ads API fields — removed
      const [adGroupResp, assetGroupResp] = await Promise.all([
        isPmax
          ? Promise.resolve({ data: [] })
          : axios.post(`https://googleads.googleapis.com/v23/customers/${tid}/googleAds:searchStream`,
              { query: `SELECT ad_group.id, ad_group.name, ad_group.status, ad_group.primary_status, ad_group.primary_status_reasons, ad_group.type, ad_group.cpc_bid_micros, ad_group.target_cpa_micros, ad_group.target_roas, campaign.id, campaign.name, campaign.status, campaign.bidding_strategy_type FROM ad_group WHERE campaign.id = ${cleanCampaignId}` },
              { headers }
            ).catch((err) => { logger.error(`getAdGroups ad_group query failed: ${err?.response?.data ? JSON.stringify(err.response.data) : err.message}`); return { data: [] }; }),
        isPmax
          ? axios.post(`https://googleads.googleapis.com/v23/customers/${tid}/googleAds:searchStream`,
              { query: `SELECT asset_group.id, asset_group.name, asset_group.status, asset_group.primary_status, asset_group.primary_status_reasons, campaign.id, campaign.name, campaign.status FROM asset_group WHERE campaign.id = ${cleanCampaignId}` },
              { headers }
            ).catch((err) => { logger.error(`getAdGroups asset_group query failed: ${err?.response?.data ? JSON.stringify(err.response.data) : err.message}`); return { data: [] }; })
          : Promise.resolve({ data: [] }),
      ]);

      const flatResults = (respData) =>
        Array.isArray(respData) ? respData.flatMap(batch => batch?.results || []) : [];
      const agResults    = flatResults(adGroupResp.data);
      const assetResults = flatResults(assetGroupResp.data);

      const adGroups = isPmax
        ? assetResults.map(r => {
            const ag = r.assetGroup || r.asset_group || {};
            const camp = r.campaign || {};
            const primaryStatus = ag.primaryStatus || ag.primary_status;
            const agid = String(ag.id || "");
            const agReasons = ag.primaryStatusReasons || ag.primary_status_reasons || [];
            const agReasonList = Array.isArray(agReasons) ? agReasons : [agReasons];
            let agServingStatus = null;
            if (agReasonList.some(r => /DISAPPROVED/i.test(String(r)))) agServingStatus = 'ADS_DISAPPROVED';
            else if (agReasonList.some(r => /POLICY/i.test(String(r)))) agServingStatus = 'ADS_LIMITED_BY_POLICY';
            else if (agReasonList.some(r => /CAMPAIGN_PAUSED|PAUSED/i.test(String(r)))) agServingStatus = 'ADS_PAUSED';
            return {
              id: agid,
              adGroupId: agid,
              name: ag.name || "",
              status: robustFormatStatus(ag.status),
              primaryStatus: (primaryStatus && primaryStatus !== "UNKNOWN" && primaryStatus !== "UNSPECIFIED") ? primaryStatus : null,
              servingStatus: agServingStatus,
              type: "ASSET_GROUP",
              campaignId: String(camp.id || ""),
              campaignName: camp.name || "",
              campaignStatus: robustFormatStatus(camp.status),
              isPmax: true,
            };
          })
        : agResults.map(r => {
            const ag = r.adGroup || r.ad_group || {};
            const camp = r.campaign || {};
            const agid = String(ag.id || "");
            const biddingStrategyType = camp.biddingStrategyType || camp.bidding_strategy_type;
            const optimizationGoal = robustFormatBiddingStrategy(biddingStrategyType);
            const billingEvent = deriveGoogleBillingType(biddingStrategyType, ag.type);

            // primaryStatus + reasons → derive badge key and subtitle
            const rawPs = ag.primaryStatus || ag.primary_status;
            const agReasons = ag.primaryStatusReasons || ag.primary_status_reasons || [];
            const agReasonList = Array.isArray(agReasons) ? agReasons : [agReasons];
            let agServingStatus = null;
            if (agReasonList.some(r => /DISAPPROVED/i.test(String(r)))) agServingStatus = 'ADS_DISAPPROVED';
            else if (agReasonList.some(r => /POLICY/i.test(String(r)))) agServingStatus = 'ADS_LIMITED_BY_POLICY';
            else if (agReasonList.some(r => /PAUSED/i.test(String(r)))) agServingStatus = 'ADS_PAUSED';
            let agPrimaryStatus = (rawPs && rawPs !== "UNKNOWN" && rawPs !== "UNSPECIFIED") ? rawPs : null;
            if (agPrimaryStatus === "ELIGIBLE" && agServingStatus === "ADS_LIMITED_BY_POLICY") agPrimaryStatus = "ELIGIBLE_LIMITED";
            if (agPrimaryStatus === "ELIGIBLE" && agServingStatus === "ADS_DISAPPROVED") agPrimaryStatus = "ELIGIBLE_LIMITED";

            return {
              id: agid,
              adGroupId: agid,
              name: ag.name || "",
              status: robustFormatStatus(ag.status),
              primaryStatus: agPrimaryStatus,
              servingStatus: agServingStatus,
              type: ag.type || "",
              cpcBidMicros: ag.cpcBidMicros || ag.cpc_bid_micros || null,
              targetCpa: ag.targetCpaMicros ? ag.targetCpaMicros / 1e6 : (ag.target_cpa_micros ? ag.target_cpa_micros / 1e6 : null),
              targetRoas: ag.targetRoas || ag.target_roas || null,
              optimizationGoal,
              optimization_goal: optimizationGoal,
              billingEvent,
              billing_event: billingEvent,
              campaignId: String(camp.id || ""),
              campaignName: camp.name || "",
              campaignStatus: robustFormatStatus(camp.status),
              isPmax: false,
            };
          });

      const response = {
        status: true,
        adGroups,
        count: adGroups.length,
        accountId: tid,
        campaignId: String(campaignId),
        loginCustomerId: lid,
      };

      await redisClient.set(cacheKey, JSON.stringify(response), "EX", REDIS_TTL);
      return res.status(200).json(response);
    } catch (error) {
      const m = formatGoogleError(error);
      logger.error(`Google get ad groups error: ${m.message}`);
      return res.status(error.statusCode || 500).json({
        status: false,
        error: "Failed to fetch ad groups",
        details: m.message,
        isLocked: isGoogleTokenRestrictedMessage(m.message),
      });
    }
  }

  // * 7. GET ads by campaign
  async getAdsByCampaignId(req, res) {
    /* #swagger.tags = ['Google Ads']
       #swagger.summary = 'Get ads by campaign'
       #swagger.description = 'Get all ads for a specific campaign'
       #swagger.security = [{ "BearerAuth": [] }]
       #swagger.parameters['adAccountId'] = { description: 'Google Ads customer ID', type: 'string', required: true }
       #swagger.parameters['campaignId'] = { description: 'Campaign ID to filter ads', type: 'string', required: true }
    */
    try {
      const userId = req.user.user_id;
      const adAccountId = getQueryParam(req.query, ["adAccountId", "customerId"]);
      const { campaignId } = req.query;

      if (!adAccountId || !campaignId) {
        return res.status(400).json({ status: false, error: "adAccountId and campaignId are required" });
      }

      const tid = normalizeRequestCustomerId(res, adAccountId);
      if (!tid) return;
      const cacheKey = `googleCampaignAds:v3:${userId}:${tid}:${campaignId}`;
      if (!wantsCacheRefresh(req)) {
        const cached = await redisClient.get(cacheKey);
        if (cached) return res.status(200).json(JSON.parse(cached));
      }

      const { accessToken } = await initGoogleApiForUser(userId);
      const resolvedLoginCustomerId = await resolveManagerForAccount(tid, accessToken, userId);
      const lid = normalizeCustomerId(resolvedLoginCustomerId || tid);

      const cleanCampaignId = sanitizeId(campaignId);
      const headers = { Authorization: `Bearer ${accessToken}`, "developer-token": process.env.GOOGLE_DEVELOPER_TOKEN, "login-customer-id": lid, "Content-Type": "application/json" };

      // Run PMax, standard ads, and display image asset queries in parallel
      const [pmaxResp, standardResp, imageAssetResp] = await Promise.all([
        axios.post(`https://googleads.googleapis.com/v23/customers/${tid}/googleAds:searchStream`, {
          query: `
            SELECT
              asset_group_asset.field_type, asset_group_asset.status,
              asset_group.id, asset_group.name, asset_group.status, asset_group.final_urls,
              asset.id, asset.name, asset.type,
              asset.text_asset.text, asset.image_asset.full_size.url, asset.image_asset.mime_type,
              campaign.id, campaign.name
            FROM asset_group_asset
            WHERE campaign.id = ${cleanCampaignId} AND asset_group_asset.status != 'REMOVED'
          `,
        }, { headers }).catch(() => ({ data: [] })),
        fetchStandardAdResults(tid, headers, `campaign.id = ${cleanCampaignId}`, {
          onError: (msg) => logger.error(`Google getAdsByCampaignId: ${msg}`),
        }).then((results) => ({ data: [{ results }] })),
        axios.post(`https://googleads.googleapis.com/v23/customers/${tid}/googleAds:searchStream`, {
          query: buildImageAssetGaql(`campaign.id = ${cleanCampaignId}`),
        }, { headers }).catch(() => ({ data: [] })),
      ]);

      const flatR = (respData) =>
        Array.isArray(respData) ? respData.flatMap(batch => batch?.results || []) : [];
      const pmaxResults      = flatR(pmaxResp.data);
      const standardResults  = flatR(standardResp.data);
      const imageAssetResults = flatR(imageAssetResp.data);
      const isPmax = pmaxResults.length > 0;

      const adImageMap = buildAdImageMapFromAssetResults(imageAssetResults);
      const assetUrlMap = await fetchGoogleAssetUrlMap(
        tid,
        headers,
        collectEmbeddedAssetRefs(standardResults),
      );

      let ads = [];

      if (isPmax) {
        const results = pmaxResults;
        const byGroup = {};
        results.forEach(r => {
          const ag = r.assetGroup || r.asset_group || {};
          const asset = r.asset || {};
          const aga = r.assetGroupAsset || r.asset_group_asset || {};
          const fieldType = aga.fieldType || aga.field_type || "";
          const gid = String(ag.id || "");
          const agFinalUrls = ag.finalUrls || ag.final_urls || [];
          if (!byGroup[gid]) {
            byGroup[gid] = {
              id: gid,
              name: ag.name || "",
              status: robustFormatStatus(ag.status),
              type: "ASSET_GROUP",
              isPmax: true,
              campaignId: String((r.campaign || {}).id || ""),
              campaignName: (r.campaign || {}).name || "",
              finalUrls: agFinalUrls,
              headlines: [],
              descriptions: [],
              images: [],
              logos: [],
            };
          }
          if (!byGroup[gid].finalUrls.length && agFinalUrls.length) {
            byGroup[gid].finalUrls = agFinalUrls;
          }
          const assetRN = asset.resourceName || asset.resource_name || null;
          const assetId = String(asset.id || "");
          const text = (asset.textAsset || asset.text_asset)?.text;
          const imgData = asset.imageAsset || asset.image_asset;
          const imageUrl = imgData?.fullSize?.url || imgData?.full_size?.url;
          const mimeType = imgData?.mimeType || imgData?.mime_type || "";
          if (fieldType === "HEADLINE" && text) byGroup[gid].headlines.push({ text, assetRN, assetId, fieldType });
          else if ((fieldType === "DESCRIPTION" || fieldType === "LONG_HEADLINE") && text) byGroup[gid].descriptions.push({ text, assetRN, assetId, fieldType });
          else if ((fieldType === "MARKETING_IMAGE" || fieldType === "SQUARE_MARKETING_IMAGE" || fieldType === "PORTRAIT_MARKETING_IMAGE") && imageUrl) {
            byGroup[gid].images.push({ url: imageUrl, mimeType, fieldType, assetRN, assetId });
          } else if ((fieldType === "LOGO" || fieldType === "LANDSCAPE_LOGO") && imageUrl) {
            byGroup[gid].logos.push({ url: imageUrl, mimeType, fieldType, assetRN, assetId });
          }
        });
        ads = Object.values(byGroup);
      } else {
        ads = standardResults.map((r) => mapGoogleStandardAdRow(r, {
          adImageMap,
          assetUrlMap,
          formatStatus: robustFormatStatus,
        }));
      }

      const response = {
        status: true,
        ads,
        count: ads.length,
        accountId: tid,
        campaignId: String(campaignId),
        loginCustomerId: lid,
        isPmax,
      };

      await redisClient.set(cacheKey, JSON.stringify(response), "EX", REDIS_TTL);
      return res.status(200).json(response);
    } catch (error) {
      const m = formatGoogleError(error);
      logger.error(`Google get ads by campaign error: ${m.message}`);
      return res.status(error.statusCode || 500).json({
        status: false,
        error: "Failed to fetch ads",
        details: m.message,
        isLocked: isGoogleTokenRestrictedMessage(m.message),
      });
    }
  }
  // * 8. GET ads by ad group
  async getAdsByAdGroupId(req, res) {
    /* #swagger.tags = ['Google Ads']
       #swagger.summary = 'Get ads by ad group'
       #swagger.description = 'Get all ads for a specific ad group'
       #swagger.security = [{ "BearerAuth": [] }]
       #swagger.parameters['adAccountId'] = { description: 'Google Ads customer ID', type: 'string', required: true }
       #swagger.parameters['adGroupId'] = { description: 'Ad Group ID to filter ads', type: 'string', required: true }
    */
    try {
      const userId = req.user.user_id;
      const adAccountId = getQueryParam(req.query, ["adAccountId", "customerId"]);

      const { adGroupId } = req.query;

      if (!adAccountId || !adGroupId) {
        return res.status(400).json({ status: false, error: "adAccountId and adGroupId are required" });
      }

      const tid = normalizeRequestCustomerId(res, adAccountId);
      if (!tid) return;
      const cacheKey = `googleAdGroupAds:v4:${userId}:${tid}:${adGroupId}`;
      if (!wantsCacheRefresh(req)) {
        const cached = await redisClient.get(cacheKey);
        if (cached) return res.status(200).json(JSON.parse(cached));
      }

      const { accessToken } = await initGoogleApiForUser(userId);
      const resolvedLoginCustomerId = await resolveManagerForAccount(tid, accessToken, userId);
      const lid = normalizeCustomerId(resolvedLoginCustomerId || tid);

      const cleanAdGroupId = sanitizeId(adGroupId);
      const headers = { Authorization: `Bearer ${accessToken}`, "developer-token": process.env.GOOGLE_DEVELOPER_TOKEN, "login-customer-id": lid, "Content-Type": "application/json" };

      // Run PMax, standard ads, and display image asset queries in parallel
      const [pmaxResp, standardResp, imageAssetResp, pmaxMetricsResp] = await Promise.all([
        axios.post(`https://googleads.googleapis.com/v23/customers/${tid}/googleAds:searchStream`, {
          query: `
            SELECT
              asset_group_asset.field_type, asset_group_asset.status,
              asset_group.id, asset_group.name, asset_group.status, asset_group.final_urls,
              asset.id, asset.name, asset.type,
              asset.text_asset.text, asset.image_asset.full_size.url, asset.image_asset.mime_type,
              campaign.id, campaign.name, campaign.status
            FROM asset_group_asset
            WHERE asset_group.id = ${cleanAdGroupId} AND asset_group_asset.status != 'REMOVED'
          `,
        }, { headers }).catch((e) => { logger.warn(`PMax asset_group_asset GAQL failed for adGroupId=${cleanAdGroupId}: ${formatGoogleError(e).message}`); return { data: [] }; }),
        fetchStandardAdResults(tid, headers, `ad_group.id = ${cleanAdGroupId}`, {
          onError: (msg) => logger.error(`Google getAdsByAdGroupId: ${msg}`),
        }).then((results) => ({ data: [{ results }] })),
        axios.post(`https://googleads.googleapis.com/v23/customers/${tid}/googleAds:searchStream`, {
          query: buildImageAssetGaql(`ad_group.id = ${cleanAdGroupId}`),
        }, { headers }).catch(() => ({ data: [] })),
        // Separate query — metrics.* on asset_group_asset requires segments.date,
        // which the plain asset-listing query above doesn't need/want.
        axios.post(`https://googleads.googleapis.com/v23/customers/${tid}/googleAds:searchStream`, {
          query: `
            SELECT
              asset_group_asset.asset, asset_group_asset.field_type,
              metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions
            FROM asset_group_asset
            WHERE asset_group.id = ${cleanAdGroupId}
              AND asset_group_asset.status != 'REMOVED'
              AND segments.date DURING LAST_30_DAYS
          `,
        }, { headers }).catch((e) => { logger.warn(`PMax asset metrics GAQL failed for adGroupId=${cleanAdGroupId}: ${formatGoogleError(e).message}`); return { data: [] }; }),
      ]);

      const pmaxResults = pmaxResp.data?.[0]?.results || [];
      const standardResults = standardResp.data?.[0]?.results || [];
      const imageAssetResults = imageAssetResp.data?.[0]?.results || [];
      const pmaxMetricsResults = pmaxMetricsResp.data?.[0]?.results || [];
      const assetMetricsMap = {};
      pmaxMetricsResults.forEach(r => {
        const aga = r.assetGroupAsset || r.asset_group_asset || {};
        const assetRN = aga.asset || null;
        if (!assetRN) return;
        const m = r.metrics || {};
        const prev = assetMetricsMap[assetRN] || { impressions: 0, clicks: 0, cost: 0, conversions: 0 };
        assetMetricsMap[assetRN] = {
          impressions: prev.impressions + Number(m.impressions || 0),
          clicks: prev.clicks + Number(m.clicks || 0),
          cost: prev.cost + Number(m.costMicros || m.cost_micros || 0) / 1e6,
          conversions: prev.conversions + Number(m.conversions || 0),
        };
      });
      // Only treat as PMax if asset group results exist AND no standard ads returned
      // (prevents misidentifying a regular ad group ID that coincidentally matches an asset group ID)
      const isPmax = pmaxResults.length > 0 && standardResults.length === 0;
      logger.info(`Google getAdsByAdGroupId: adGroupId=${cleanAdGroupId} pmaxResults=${pmaxResults.length} standardResults=${standardResults.length} isPmax=${isPmax}`);

      const adImageMap = buildAdImageMapFromAssetResults(imageAssetResults);
      const assetUrlMap = await fetchGoogleAssetUrlMap(
        tid,
        headers,
        collectEmbeddedAssetRefs(standardResults),
      );

      let ads = [];

      if (isPmax) {
        const results = pmaxResults;
        const grouped = { id: String(adGroupId), type: "ASSET_GROUP", isPmax: true, finalUrls: [], headlines: [], descriptions: [], images: [], logos: [] };
        results.forEach(r => {
          const asset = r.asset || {};
          const aga = r.assetGroupAsset || r.asset_group_asset || {};
          const fieldType = aga.fieldType || aga.field_type || "";
          const ag = r.assetGroup || r.asset_group || {};
          const campaignRow = r.campaign || {};
          grouped.name = ag.name || "";
          grouped.status = robustFormatStatus(ag.status);
          grouped.campaignId = String(campaignRow.id || "");
          grouped.campaignName = campaignRow.name || "";
          // Mirrors Google's own Asset Details table: an asset is only
          // "Not eligible" while its parent campaign isn't actively serving —
          // there's no separate per-asset policy check for PMax assets.
          grouped.campaignStatus = robustFormatStatus(campaignRow.status);
          const agFinalUrls = ag.finalUrls || ag.final_urls || [];
          if (!grouped.finalUrls.length && agFinalUrls.length) grouped.finalUrls = agFinalUrls;
          const assetRN = asset.resourceName || asset.resource_name || null;
          const assetId = String(asset.id || "");
          const text = (asset.textAsset || asset.text_asset)?.text;
          const imgData = asset.imageAsset || asset.image_asset;
          const imageUrl = imgData?.fullSize?.url || imgData?.full_size?.url;
          const mimeType = imgData?.mimeType || imgData?.mime_type || "";
          const assetMetrics = assetMetricsMap[assetRN] || { impressions: 0, clicks: 0, cost: 0, conversions: 0 };
          const assetStatus = robustFormatStatus(aga.status);
          if (fieldType === "HEADLINE" && text) grouped.headlines.push({ text, assetRN, assetId, fieldType, status: assetStatus, metrics: assetMetrics });
          else if ((fieldType === "DESCRIPTION" || fieldType === "LONG_HEADLINE") && text) grouped.descriptions.push({ text, assetRN, assetId, fieldType, status: assetStatus, metrics: assetMetrics });
          else if (fieldType === "BUSINESS_NAME" && text) grouped.businessName = { text, assetRN, assetId, fieldType, status: assetStatus, metrics: assetMetrics };
          else if ((fieldType === "MARKETING_IMAGE" || fieldType === "SQUARE_MARKETING_IMAGE" || fieldType === "PORTRAIT_MARKETING_IMAGE") && imageUrl) {
            grouped.images.push({ url: imageUrl, mimeType, fieldType, assetRN, assetId, status: assetStatus, metrics: assetMetrics });
          } else if ((fieldType === "LOGO" || fieldType === "LANDSCAPE_LOGO") && imageUrl) {
            grouped.logos.push({ url: imageUrl, mimeType, fieldType, assetRN, assetId, status: assetStatus, metrics: assetMetrics });
          }
        });
        ads = results.length ? [grouped] : [];
      } else {
        ads = standardResults.map((r) => mapGoogleStandardAdRow(r, {
          adImageMap,
          assetUrlMap,
          formatStatus: robustFormatStatus,
        }));
      }

      const response = {
        status: true,
        ads,
        count: ads.length,
        accountId: tid,
        adGroupId: String(adGroupId),
        loginCustomerId: lid,
        isPmax,
      };

      await redisClient.set(cacheKey, JSON.stringify(response), "EX", REDIS_TTL);
      return res.status(200).json(response);
    } catch (error) {
      const m = formatGoogleError(error);
      logger.error(`Google get ads by ad group error: ${m.message}`);
      return res.status(error.statusCode || 500).json({
        status: false,
        error: "Failed to fetch ads",
        details: m.message,
        isLocked: isGoogleTokenRestrictedMessage(m.message),
      });
    }
  }
  // * 2. Lightweight account check
  async checkGoogleAdsAccount(req, res) {
    /* #swagger.tags = ['Google Ads']
       #swagger.summary = 'Check Google Ads account'
       #swagger.description = 'Lightweight check — is a Google account connected and does it have any Ads accounts'
       #swagger.security = [{ "BearerAuth": [] }]
    */
    try {
      const userId = req.user.user_id;

      const googleUser = await GoogleUsers.findOne({ userId });
      if (!googleUser) {
        return res.status(200).json({
          hasAccount: false,
          isConnected: false,
          noAccountReason: "not_connected",
          message: "Google account not connected yet.",
          connectUrl: "/api/auth/google",
        });
      }

      const { accessToken } = await initGoogleApiForUser(userId);

      let tokenResp;
      try {
        tokenResp = await axios.get("https://googleads.googleapis.com/v23/customers:listAccessibleCustomers", {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "developer-token": process.env.GOOGLE_DEVELOPER_TOKEN,
          },
        });
      } catch (axiosErr) {
        // If listAccessibleCustomers itself fails, it's usually an expired token or major API issue
        const status = axiosErr.response?.status;
        const detail = JSON.stringify(axiosErr.response?.data || axiosErr.message);
        logger.error(`Google checkAccount listAccessibleCustomers failed [${status}]: ${detail}`);
        
        // If Google rejects the developer token/project, the user may still be connected.
        if (isGoogleAdsPermissionRestricted(axiosErr)) {
           return res.status(200).json({
             hasAccount: true,
             isConnected: true,
             connectedEmail: googleUser.email,
             connectedName: googleUser.name,
           });
        }

        return res.status(status || 500).json({
          status: false,
          // Only a 401 is a genuine "reconnect" case; a 5xx/429/network error is
          // transient and must NOT read as disconnected (callers key off
          // isConnected, and a false `false` here auto-pauses a healthy autopilot
          // job). Leave isConnected undefined on transient errors so the caller
          // falls through to its status-based transient handling.
          ...(status === 401 ? { isConnected: false } : {}),
          error: status === 401 ? "Google access token expired. Please reconnect your Google account." : "Failed to check Google Ads account",
          details: detail,
        });
      }

      const count = tokenResp.data?.resourceNames?.length || 0;
      if (count === 0) {
        return res.status(200).json({
          hasAccount: false,
          isConnected: true,
          connectedEmail: googleUser.email,
          connectedName: googleUser.name,
          count: 0,
          noAccountReason: "no_google_ads_account",
          message: "Your Google account has no Google Ads account linked to it.",
          createAccountUrl: "https://ads.google.com/home/",
        });
      }

      return res.status(200).json({
        hasAccount: true,
        isConnected: true,
        connectedEmail: googleUser.email,
        connectedName: googleUser.name,
        count,
      });
    } catch (error) {
      const m = formatGoogleError(error);
      logger.error(`Google check account error: ${m.message}`);
      return res.status(error.statusCode || 500).json({
        status: false,
        error: "Failed to check account",
        details: m.message,
      });
    }
  }

  // * 3. GET dashboard data
  async getDashboardData(req, res) {
    /* #swagger.tags = ['Google Ads']
       #swagger.summary = 'Get dashboard data'
       #swagger.description = 'Get dashboard overview statistics and performance chart data'
       #swagger.security = [{ "BearerAuth": [] }]
       #swagger.parameters['adAccountId'] = { description: 'Google Ads customer ID', type: 'string', required: true }
       #swagger.parameters['datePreset'] = { description: 'Date preset for data range', type: 'string', default: 'last_7d' }
    */
    try {
      const userId = req.user.user_id;
      const adAccountId = getQueryParam(req.query, ["adAccountId", "customerId"]);

      const { datePreset = "last_7d" } = req.query;
      if (!adAccountId) {
        return res.status(400).json({ status: false, error: "adAccountId is required" });
      }

      const cacheKey = `googleDashboard:${userId}:${adAccountId}:${datePreset}`;
      const cached = await redisClient.get(cacheKey);
      if (cached) return res.status(200).json(JSON.parse(cached));

      const { accessToken } = await initGoogleApiForUser(userId);
      const tid = normalizeRequestCustomerId(res, adAccountId);
      if (!tid) return;
      const resolvedLoginCustomerId = await resolveManagerForAccount(adAccountId, accessToken, userId);
      const lid = normalizeCustomerId(resolvedLoginCustomerId || tid);
      const headers = { Authorization: `Bearer ${accessToken}`, "developer-token": process.env.GOOGLE_DEVELOPER_TOKEN, "login-customer-id": lid, "Content-Type": "application/json" };

      const [startDate, endDate] = datePresetToRange(datePreset);

      const search = (query) => axios.post(
        `https://googleads.googleapis.com/v23/customers/${tid}/googleAds:searchStream`,
        { query },
        { headers }
      ).then(r => r.data?.[0]?.results || []);

      const [summaryRows, dailyRows, campaignRows] = await Promise.all([
        search(`SELECT metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions FROM campaign WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'`),
        search(`SELECT segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions FROM campaign WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'`),
        search(`SELECT campaign.id, campaign.name, campaign.status FROM campaign WHERE campaign.status != 'REMOVED'`),
      ]);

      let totalSpend = 0, totalImpressions = 0, totalClicks = 0, totalConversions = 0;
      summaryRows.forEach((r) => {
        const m = r.metrics || {};
        totalSpend += (m.costMicros || m.cost_micros || 0) / 1e6;
        totalImpressions += m.impressions || 0;
        totalClicks += m.clicks || 0;
        totalConversions += m.conversions || 0;
      });

      const activeCampaigns = campaignRows.filter(r => {
        const s = r.campaign?.status;
        return s === "ENABLED" || s === 2;
      }).length;

      const dailyMap = {};
      dailyRows.forEach((r) => {
        const date = r.segments?.date;
        if (!date) return;
        if (!dailyMap[date]) dailyMap[date] = { spend: 0, impressions: 0, clicks: 0, conversions: 0 };
        const m = r.metrics || {};
        dailyMap[date].spend += (m.costMicros || m.cost_micros || 0) / 1e6;
        dailyMap[date].impressions += m.impressions || 0;
        dailyMap[date].clicks += m.clicks || 0;
        dailyMap[date].conversions += m.conversions || 0;
      });

      const chartData = Object.keys(dailyMap)
        .sort()
        .map((date) => ({
          name: dayjs(date).format("DD MMM"),
          fullDate: date,
          spend: parseFloat(dailyMap[date].spend.toFixed(2)),
          impressions: dailyMap[date].impressions,
          clicks: dailyMap[date].clicks,
          conversions: Math.round(dailyMap[date].conversions),
          ctr: dailyMap[date].impressions > 0 ? parseFloat(((dailyMap[date].clicks / dailyMap[date].impressions) * 100).toFixed(2)) : 0,
          cpa: dailyMap[date].conversions > 0
            ? parseFloat((dailyMap[date].spend / dailyMap[date].conversions).toFixed(2))
            : 0,
        }));

      const ctr = totalImpressions > 0 ? parseFloat(((totalClicks / totalImpressions) * 100).toFixed(2)) : 0;
      const cpc = totalClicks > 0 ? parseFloat((totalSpend / totalClicks).toFixed(2)) : 0;
      const cpm = totalImpressions > 0 ? parseFloat(((totalSpend / totalImpressions) * 1000).toFixed(2)) : 0;

      const response = {
        status: true,
        stats: {
          totalSpend: parseFloat(totalSpend.toFixed(2)),
          totalImpressions,
          totalClicks,
          totalConversions: Math.round(totalConversions),
          ctr,
          cpc,
          cpm,
          avgCpa: totalConversions > 0 ? parseFloat((totalSpend / totalConversions).toFixed(2)) : 0,
          activeCampaigns,
          totalCampaigns: campaignRows.length,
        },
        chartData,
      };

      await redisClient.set(cacheKey, JSON.stringify(response), "EX", VOLATILE_TTL);
      return res.status(200).json(response);
    } catch (error) {
      const m = formatGoogleError(error);
      logger.error(`Google dashboard error: ${m.message}`);
      return res.status(error.statusCode || 500).json({
        status: false,
        error: "Failed to fetch dashboard data",
        details: m.message,
        reason: m.reason,
      });
    }
  }

  // * 4. GET analytics data with period comparison
  async getAnalyticsData(req, res) {
    /* #swagger.tags = ['Google Ads']
       #swagger.summary = 'Get analytics data'
       #swagger.description = 'Get detailed analytics statistics with period comparison (spend, impressions, clicks, CTR, CPC, CPM)'
       #swagger.security = [{ "BearerAuth": [] }]
       #swagger.parameters['adAccountId'] = { description: 'Google Ads customer ID', type: 'string', required: true }
       #swagger.parameters['datePreset'] = { description: 'Date preset for data range', type: 'string', default: 'last_30d' }
    */
    try {
      const userId = req.user.user_id;
      const adAccountId = getQueryParam(req.query, ["adAccountId", "customerId"]);

      const { datePreset = "last_30d" } = req.query;
      if (!adAccountId) {
        return res.status(400).json({ status: false, error: "adAccountId is required" });
      }

      const cacheKey = `googleAnalytics:v3:${userId}:${adAccountId}:${datePreset}`;
      const cached = await redisClient.get(cacheKey);
      if (cached && !wantsCacheRefresh(req)) return res.status(200).json(JSON.parse(cached));

      const { accessToken } = await initGoogleApiForUser(userId);
      const tid = normalizeRequestCustomerId(res, adAccountId);
      if (!tid) return;
      const resolvedLoginCustomerId = await resolveManagerForAccount(adAccountId, accessToken, userId);
      const lid = normalizeCustomerId(resolvedLoginCustomerId || tid);
      const headers = { Authorization: `Bearer ${accessToken}`, "developer-token": process.env.GOOGLE_DEVELOPER_TOKEN, "login-customer-id": lid, "Content-Type": "application/json" };

      let [startDate, endDate] = datePresetToRange(datePreset);

      const search = async (query) => {
        const { data } = await axios.post(
          `https://googleads.googleapis.com/v23/customers/${tid}/googleAds:searchStream`,
          { query },
          { headers },
        );
        return (Array.isArray(data) ? data : [data]).flatMap((batch) => batch?.results || []);
      };

      const accountRows = await search(
        "SELECT customer.currency_code, customer.time_zone FROM customer LIMIT 1",
      );
      const account = accountRows[0]?.customer || {};
      [startDate, endDate] = datePresetToRange(datePreset, account.timeZone || account.time_zone);
      const prevEnd = dayjs(startDate).subtract(1, "day");
      const periodDays = dayjs(endDate).diff(dayjs(startDate), "day");
      const prevStart = prevEnd.subtract(periodDays, "day");

      const audienceMetricsAllowed = dayjs(endDate).diff(dayjs(startDate), "day") <= 91;
      const audienceMetricsFields = audienceMetricsAllowed ? ", metrics.unique_users, metrics.average_impression_frequency_per_user" : "";
      const metricsQuery = (start, end) => `
        SELECT metrics.cost_micros, metrics.impressions, metrics.clicks,
               metrics.conversions, metrics.all_conversions, metrics.conversions_value,
               metrics.all_conversions_value, metrics.view_through_conversions${audienceMetricsFields}
        FROM campaign
        WHERE segments.date BETWEEN '${start}' AND '${end}'
      `;

      const [currRows, prevRows, dailyRows, actionRows] = await Promise.all([
        search(metricsQuery(startDate, endDate)),
        ["lifetime", "maximum"].includes(datePreset)
          ? Promise.resolve([])
          : search(metricsQuery(prevStart.format("YYYY-MM-DD"), prevEnd.format("YYYY-MM-DD"))),
        search(`SELECT segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions FROM campaign WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'`),
        search(`SELECT segments.conversion_action_name, segments.conversion_action_category,
                      metrics.conversions, metrics.all_conversions, metrics.conversions_value
               FROM campaign
               WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'`),
      ]);

      const metricNumber = (value) => Number(value) || 0;

      const aggregate = (rows) => rows.reduce((acc, r) => {
        const m = r.metrics || {};
        return {
          spend: acc.spend + metricNumber(m.costMicros ?? m.cost_micros) / 1e6,
          impressions: acc.impressions + metricNumber(m.impressions),
          clicks: acc.clicks + metricNumber(m.clicks),
          conversions: acc.conversions + metricNumber(m.conversions),
          allConversions: acc.allConversions + metricNumber(m.allConversions ?? m.all_conversions),
          conversionsValue: acc.conversionsValue + metricNumber(m.conversionsValue ?? m.conversions_value),
          allConversionsValue: acc.allConversionsValue + metricNumber(m.allConversionsValue ?? m.all_conversions_value),
          viewThroughConversions: acc.viewThroughConversions + metricNumber(m.viewThroughConversions ?? m.view_through_conversions),
        };
      }, { spend: 0, impressions: 0, clicks: 0, conversions: 0, allConversions: 0, conversionsValue: 0, allConversionsValue: 0, viewThroughConversions: 0 });

      const curr = aggregate(currRows);
      const prev = aggregate(prevRows);

      const change = (c, p) => c == null || p == null || p === 0 ? null : parseFloat((((c - p) / p) * 100).toFixed(1));

      const currCtr = curr.impressions > 0 ? parseFloat(((curr.clicks / curr.impressions) * 100).toFixed(2)) : null;
      const prevCtr = prev.impressions > 0 ? parseFloat(((prev.clicks / prev.impressions) * 100).toFixed(2)) : null;
      const currCpc = curr.clicks > 0 ? parseFloat((curr.spend / curr.clicks).toFixed(2)) : null;
      const prevCpc = prev.clicks > 0 ? parseFloat((prev.spend / prev.clicks).toFixed(2)) : null;
      const currCpm = curr.impressions > 0 ? parseFloat(((curr.spend / curr.impressions) * 1000).toFixed(2)) : null;
      const prevCpm = prev.impressions > 0 ? parseFloat(((prev.spend / prev.impressions) * 1000).toFixed(2)) : null;
      const currCostPerConversion = curr.conversions > 0 ? parseFloat((curr.spend / curr.conversions).toFixed(2)) : null;
      const prevCostPerConversion = prev.conversions > 0 ? parseFloat((prev.spend / prev.conversions).toFixed(2)) : null;
      const metricPrecision = (value) => value == null ? null : parseFloat(metricNumber(value).toFixed(2));
      const currReach = currRows.length === 1 ? (currRows[0].metrics?.uniqueUsers ?? currRows[0].metrics?.unique_users ?? null) : null;
      const prevReach = prevRows.length === 1 ? (prevRows[0].metrics?.uniqueUsers ?? prevRows[0].metrics?.unique_users ?? null) : null;
      const currFrequency = currReach > 0 ? parseFloat((curr.impressions / Number(currReach)).toFixed(2)) : null;
      const prevFrequency = prevReach > 0 ? parseFloat((prev.impressions / Number(prevReach)).toFixed(2)) : null;


      const stats = {
        spend: { val: parseFloat(curr.spend.toFixed(2)), change: change(curr.spend, prev.spend) },
        impressions: { val: curr.impressions, change: change(curr.impressions, prev.impressions) },
        clicks: { val: curr.clicks, change: change(curr.clicks, prev.clicks) },
        reach: { val: currReach, change: change(currReach, prevReach) },
        conversions: { val: metricPrecision(curr.conversions), change: change(curr.conversions, prev.conversions) },
        ctr: { val: currCtr, change: change(currCtr, prevCtr) },
        cpc: { val: currCpc, change: change(currCpc, prevCpc) },
        cpm: { val: currCpm, change: change(currCpm, prevCpm) },
        frequency: { val: currFrequency, change: change(currFrequency, prevFrequency) },
        costPerConversion: { val: currCostPerConversion, change: change(currCostPerConversion, prevCostPerConversion) },
        conversionValue: { val: metricPrecision(curr.conversionsValue), change: change(curr.conversionsValue, prev.conversionsValue) },
        allConversions: { val: metricPrecision(curr.allConversions), change: change(curr.allConversions, prev.allConversions) },
        viewThroughConversions: { val: metricPrecision(curr.viewThroughConversions), change: change(curr.viewThroughConversions, prev.viewThroughConversions) },
      };

      const dailyMap = {};
      dailyRows.forEach((r) => {
        const date = r.segments?.date;
        if (!date) return;
        if (!dailyMap[date]) dailyMap[date] = { spend: 0, impressions: 0, clicks: 0, conversions: 0 };
        const m = r.metrics || {};
        dailyMap[date].spend += metricNumber(m.costMicros ?? m.cost_micros) / 1e6;
        dailyMap[date].impressions += metricNumber(m.impressions);
        dailyMap[date].clicks += metricNumber(m.clicks);
        dailyMap[date].conversions += metricNumber(m.conversions);
      });

      const chartSpanDays = dayjs(endDate).diff(dayjs(startDate), "day");
      if (chartSpanDays <= 366) {
        for (
          let cursor = dayjs(startDate);
          !cursor.isAfter(dayjs(endDate), "day");
          cursor = cursor.add(1, "day")
        ) {
          const date = cursor.format("YYYY-MM-DD");
          if (!dailyMap[date]) dailyMap[date] = { spend: 0, impressions: 0, clicks: 0, conversions: 0 };
        }
      }

      const chartData = Object.keys(dailyMap).sort().map((date) => ({
        name: dayjs(date).format("DD MMM"),
        fullDate: date,
        spend: parseFloat(dailyMap[date].spend.toFixed(2)),
        impressions: dailyMap[date].impressions,
        clicks: dailyMap[date].clicks,
        conversions: metricPrecision(dailyMap[date].conversions),
        ctr: dailyMap[date].impressions > 0 ? parseFloat(((dailyMap[date].clicks / dailyMap[date].impressions) * 100).toFixed(2)) : 0,
      }));
      const actionMap = new Map();
      actionRows.forEach((row) => {
        const segments = row.segments || {};
        const name = segments.conversionActionName || segments.conversion_action_name;
        if (!name) return;
        const metrics = row.metrics || {};
        const current = actionMap.get(name) || {
          name,
          category: segments.conversionActionCategory || segments.conversion_action_category || "UNSPECIFIED",
          conversions: 0,
          allConversions: 0,
          conversionValue: 0,
        };
        current.conversions += metricNumber(metrics.conversions);
        current.allConversions += metricNumber(metrics.allConversions ?? metrics.all_conversions);
        current.conversionValue += metricNumber(metrics.conversionsValue ?? metrics.conversions_value);
        actionMap.set(name, current);
      });
      const actions = [...actionMap.values()]
        .map((action) => ({
          ...action,
          conversions: metricPrecision(action.conversions),
          allConversions: metricPrecision(action.allConversions),
          conversionValue: metricPrecision(action.conversionValue),
        }))
        .sort((a, b) => b.conversions - a.conversions || b.allConversions - a.allConversions);

      const response = {
        status: true, stats, chartData, actions,
        currencyCode: account.currencyCode || account.currency_code || null,
        timeZone: account.timeZone || account.time_zone || null,
        dateRange: { startDate, endDate },
      };


      await redisClient.set(cacheKey, JSON.stringify(response), "EX", VOLATILE_TTL);
      return res.status(200).json(response);
    } catch (error) {
      const m = formatGoogleError(error);
      logger.error(`Google analytics error: ${m.message}`);
      return res.status(error.statusCode || 500).json({
        status: false,
        error: "Failed to fetch analytics data",
        details: m.message,
        reason: m.reason,
      });
    }
  }



  // * 9. GET insights
  async getInsights(req, res) {
    /* #swagger.tags = ['Google Ads']
       #swagger.summary = 'Get performance insights'
       #swagger.description = 'Get performance insights by account, campaign, adgroup or ad level'
       #swagger.security = [{ "BearerAuth": [] }]
       #swagger.parameters['adAccountId'] = { description: 'Google Ads customer ID', type: 'string', required: true }
       #swagger.parameters['level'] = { description: 'Aggregation level', type: 'string', enum: ['account', 'campaign', 'adgroup', 'ad'], default: 'account' }
       #swagger.parameters['datePreset'] = { description: 'Date preset', type: 'string', enum: ['today','yesterday','last_7d','last_14d','last_30d','last_90d','this_month','last_month'], default: 'last_30d' }
       #swagger.parameters['campaignId'] = { description: 'Filter by campaign ID', type: 'string' }
       #swagger.parameters['adGroupId'] = { description: 'Filter by ad group ID', type: 'string' }
    */
    try {
      const userId = req.user.user_id;
      const adAccountId = getQueryParam(req.query, ["adAccountId", "customerId"]);

      const { datePreset = "last_30d", level = "account", campaignId, adGroupId } = req.query;
      if (!adAccountId) {
        return res.status(400).json({ status: false, error: "adAccountId is required" });
      }

      const cacheKey = `googleInsights:${userId}:${adAccountId}:${datePreset}:${level}:${campaignId || "none"}:${adGroupId || "none"}`;
      const cached = await redisClient.get(cacheKey);
      if (cached) return res.status(200).json(JSON.parse(cached));

      const { accessToken } = await initGoogleApiForUser(userId);
      const tid = normalizeRequestCustomerId(res, adAccountId);
      if (!tid) return;
      const resolvedLoginCustomerId = await resolveManagerForAccount(adAccountId, accessToken, userId);
      const lid = normalizeCustomerId(resolvedLoginCustomerId || tid);
      const headers = { Authorization: `Bearer ${accessToken}`, "developer-token": process.env.GOOGLE_DEVELOPER_TOKEN, "login-customer-id": lid, "Content-Type": "application/json" };

      const [startDate, endDate] = datePresetToRange(datePreset);

      let fromClause, selectFields, whereExtra = "";
      if (level === "ad") {
        fromClause = "ad_group_ad";
        selectFields = "ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.status, campaign.id,";
        if (campaignId) whereExtra += ` AND campaign.id = ${sanitizeId(campaignId)}`;
        if (adGroupId) whereExtra += ` AND ad_group.id = ${sanitizeId(adGroupId)}`;
      } else if (level === "adgroup") {
        fromClause = "ad_group";
        selectFields = "ad_group.id, ad_group.name, campaign.id, campaign.name,";
        if (campaignId) whereExtra += ` AND campaign.id = ${sanitizeId(campaignId)}`;
        if (adGroupId) whereExtra += ` AND ad_group.id = ${sanitizeId(adGroupId)}`;
      } else {
        fromClause = "campaign";
        selectFields = "campaign.id, campaign.name,";
        if (campaignId) whereExtra += ` AND campaign.id = ${sanitizeId(campaignId)}`;
      }

      const resp = await axios.post(
        `https://googleads.googleapis.com/v23/customers/${tid}/googleAds:searchStream`,
        { query: `SELECT ${selectFields} segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value, metrics.view_through_conversions FROM ${fromClause} WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'${whereExtra}` },
        { headers }
      );
      const rows = resp.data?.[0]?.results || [];

      const insights = rows.map((r) => {
        const m = r.metrics || {};
        const camp = r.campaign || {};
        const ag = r.adGroup || r.ad_group || {};
        const aga = r.adGroupAd || r.ad_group_ad || {};
        const spend = (m.costMicros || m.cost_micros || 0) / 1e6;
        const convs = m.conversions || 0;
        const imps = m.impressions || 0;
        const clicks = m.clicks || 0;
        return {
          date: r.segments?.date,
          spend: parseFloat(spend.toFixed(2)),
          impressions: imps,
          clicks,
          ctr: imps > 0 ? parseFloat(((clicks / imps) * 100).toFixed(2)) : 0,
          cpc: clicks > 0 ? parseFloat((spend / clicks).toFixed(2)) : 0,
          cpm: imps > 0 ? parseFloat(((spend / imps) * 1000).toFixed(2)) : 0,
          conversions: convs,
          conversionValue: parseFloat((m.conversionsValue || m.conversions_value || 0).toFixed(2)),
          cpa: convs > 0 ? parseFloat((spend / convs).toFixed(2)) : 0,
          viewThroughConversions: m.viewThroughConversions || m.view_through_conversions || 0,
          ...(camp.id ? { campaignId: String(camp.id), campaignName: camp.name } : {}),
          ...(ag.id ? { adGroupId: String(ag.id), adGroupName: ag.name } : {}),
          ...(aga.ad?.id ? { adId: String(aga.ad?.id) } : {}),
        };
      });

      const response = { status: true, level, insights };
      await redisClient.set(cacheKey, JSON.stringify(response), "EX", VOLATILE_TTL);
      return res.status(200).json(response);
    } catch (error) {
      const m = formatGoogleError(error);
      logger.error(`Google insights error: ${m.message}`);
      return res.status(error.statusCode || 500).json({
        status: false,
        error: "Failed to fetch insights",
        details: m.message,
        reason: m.reason,
      });
    }
  }

  // * 10. Run rule-based audit
  async runAudit(req, res) {
    /* #swagger.tags = ['Google Ads']
       #swagger.summary = 'Run account audit'
       #swagger.description = 'Run 24-rule automated audit engine across campaigns, ad groups and ads (last 14 days)'
       #swagger.security = [{ "BearerAuth": [] }]
       #swagger.parameters['adAccountId'] = { description: 'Google Ads customer ID', type: 'string', required: true }
    */
    try {
      const userId = req.user.user_id;
      const adAccountId = getQueryParam(req.query, ["adAccountId", "customerId"]);

      if (!adAccountId) {
        return res.status(400).json({ status: false, error: "adAccountId is required" });
      }

      const cacheKey = `googleAudit:${userId}:${adAccountId}`;
      const cached = await redisClient.get(cacheKey);
      if (cached) return res.status(200).json(JSON.parse(cached));

      const { accessToken } = await initGoogleApiForUser(userId);
      const tid = normalizeRequestCustomerId(res, adAccountId);
      if (!tid) return;
      const resolvedLoginCustomerId = await resolveManagerForAccount(adAccountId, accessToken, userId);
      const lid = normalizeCustomerId(resolvedLoginCustomerId || tid);

      const [endDate] = datePresetToRange("today");
      const startDate = dayjs(endDate).subtract(14, "day").format("YYYY-MM-DD");

      const fetchAuditData = async (targetId, loginId) => {
        const campaignResp = await axios.post(
          `https://googleads.googleapis.com/v23/customers/${targetId}/googleAds:searchStream`,
          {
            query: `
              SELECT
                campaign.id,
                campaign.name,
                campaign.status,
                campaign_budget.amount_micros
              FROM campaign
            `,
          },
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "developer-token": process.env.GOOGLE_DEVELOPER_TOKEN,
              "login-customer-id": loginId,
              "Content-Type": "application/json",
            },
          }
        );

        const adGroupResp = await axios.post(
          `https://googleads.googleapis.com/v23/customers/${targetId}/googleAds:searchStream`,
          {
            query: `
              SELECT
                ad_group.id,
                ad_group.name,
                ad_group.status,
                campaign.id
              FROM ad_group
            `,
          },
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "developer-token": process.env.GOOGLE_DEVELOPER_TOKEN,
              "login-customer-id": loginId,
              "Content-Type": "application/json",
            },
          }
        );

        const adResp = await axios.post(
          `https://googleads.googleapis.com/v23/customers/${targetId}/googleAds:searchStream`,
          {
            query: `
              SELECT
                ad_group_ad.ad.id,
                ad_group_ad.ad.name,
                ad_group_ad.status,
                ad_group_ad.policy_summary.approval_status
              FROM ad_group_ad
            `,
          },
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "developer-token": process.env.GOOGLE_DEVELOPER_TOKEN,
              "login-customer-id": loginId,
              "Content-Type": "application/json",
            },
          }
        );

        return {
          campaignRows: campaignResp.data?.[0]?.results || [],
          adGroupRows: adGroupResp.data?.[0]?.results || [],
          adRows: adResp.data?.[0]?.results || [],
        };
      };

      const { campaignRows, adGroupRows, adRows } = await fetchAuditData(tid, lid);

      const findings = [];

      // Aggregate campaign metrics (Handling missing metrics gracefully)
      const campaignMap = {};
      campaignRows.forEach((r) => {
        const campaign = r.campaign || {};
        const budget = r.campaignBudget || r.campaign_budget || {};
        const metrics = r.metrics || {};
        const id = String(campaign.id || "");
        if (!id) return;

        if (!campaignMap[id]) {
          campaignMap[id] = {
            campaign_name: campaign.name,
            status: formatStatus(campaign.status),
            spend: 0, impressions: 0, clicks: 0, conversions: 0,
            ctr: 0, cpc: 0, cpm: 0, roas: 0,
            budget: (budget?.amountMicros || budget?.amount_micros || 0) / 1e6,
            count: 0,
          };
        }
        const d = campaignMap[id];
        d.spend += (metrics.cost_micros || 0) / 1e6;
        d.impressions += metrics.impressions || 0;
        d.clicks += metrics.clicks || 0;
        d.conversions += metrics.conversions || 0;
        d.ctr += metrics.ctr || 0;
        d.cpc += (metrics.average_cpc || 0) / 1e6;
        d.cpm += (metrics.average_cpm || 0) / 1e6;
        d.count++;
      });

      Object.entries(campaignMap).forEach(([id, d]) => {
        d.ctr = d.count > 0 ? d.ctr / d.count : 0;
        d.cpc = d.count > 0 ? d.cpc / d.count : 0;
        d.cpm = d.count > 0 ? d.cpm / d.count : 0;
        d.roas = d.spend > 0 ? (d.conversions * 10) / d.spend : 0;
        d.conversion_rate = d.clicks > 0 ? (d.conversions / d.clicks) * 100 : 0;
        d.budget_pacing = d.budget > 0 ? (d.spend / 14) / (d.budget / 30) : 0;

        const campaignRules = googleRules.filter((r) => r.entity === "campaign");
        campaignRules.forEach((rule) => {
          if (rule.check(d)) {
            findings.push({
              rule_id: rule.id,
              severity: rule.severity,
              entity_type: "campaign",
              entity_id: id,
              entity_name: d.campaign_name,
              message: rule.message(d),
            });
          }
        });
      });

      // Aggregate adgroup metrics
      const adGroupMap = {};
      adGroupRows.forEach((r) => {
        const ag = r.adGroup || r.ad_group || {};
        const id = String(ag.id || "");
        if (!id) return;
        if (!adGroupMap[id]) {
          adGroupMap[id] = {
            adgroup_name: ag.name,
            status: formatStatus(ag.status),
            impressions: 0, conversions: 0, spend: 0, cpa: 0, count: 0,
          };
        }
        const d = adGroupMap[id];
        d.impressions += r.metrics.impressions || 0;
        d.conversions += r.metrics.conversions || 0;
        d.spend += (r.metrics.cost_micros || 0) / 1e6;
        d.count++;
      });

      Object.entries(adGroupMap).forEach(([id, d]) => {
        d.cpa = d.conversions > 0 ? d.spend / d.conversions : 0;

        const adGroupRules = googleRules.filter((r) => r.entity === "adgroup");
        adGroupRules.forEach((rule) => {
          if (rule.check(d)) {
            findings.push({
              rule_id: rule.id,
              severity: rule.severity,
              entity_type: "adgroup",
              entity_id: id,
              entity_name: d.adgroup_name,
              message: rule.message(d),
            });
          }
        });
      });

      // Ad-level metrics
      adRows.forEach((r) => {
        const aga = r.adGroupAd || r.ad_group_ad || {};
        const ad = aga.ad || {};
        const metrics = r.metrics || {};
        const policy = aga.policySummary || aga.policy_summary || {};
        const d = {
          ad_name: ad.name || String(ad.id || ""),
          status: formatStatus(aga.status),
          review_status: policy.approvalStatus === 4 || policy.approval_status === 4 ? "DISAPPROVED" : "APPROVED",
          impressions: metrics.impressions || 0,
          clicks: metrics.clicks || 0,
          ctr: parseFloat(((metrics.ctr || 0) * 100).toFixed(2)),
          spend: (metrics.costMicros || metrics.cost_micros || 0) / 1e6,
        };

        const adRules = googleRules.filter((rule) => rule.entity === "ad");
        adRules.forEach((rule) => {
          if (rule.check(d)) {
            findings.push({
              rule_id: rule.id,
              severity: rule.severity,
              entity_type: "ad",
              entity_id: String(ad.id || ""),
              entity_name: d.ad_name,
              message: rule.message(d),
            });
          }
        });
      });

      const summary = findings.reduce(
        (acc, f) => { acc[f.severity] = (acc[f.severity] || 0) + 1; return acc; },
        { critical: 0, warning: 0, opportunity: 0 },
      );

      const response = { status: true, summary, findings };
      await redisClient.set(cacheKey, JSON.stringify(response), "EX", 1800);
      return res.status(200).json(response);
    } catch (error) {
      const m = formatGoogleError(error);
      logger.error(`Google audit error: ${m.message}`);
      return res.status(error.statusCode || 500).json({
        status: false,
        error: "Failed to run audit",
        details: m.message,
        reason: m.reason,
      });
    }
  }

  // * 11. PATCH update status
  async updateStatus(req, res) {
    /* #swagger.tags = ['Google Ads']
       #swagger.summary = 'Update entity status'
       #swagger.description = 'Enable or pause a campaign, ad group or ad'
       #swagger.security = [{ "BearerAuth": [] }]
       #swagger.requestBody = {
         required: true,
         content: {
           "application/json": {
             schema: {
               type: "object",
               required: ["level", "id", "customerId", "status"],
               properties: {
                 level: { type: "string", enum: ["campaign", "adgroup", "ad"], example: "campaign" },
                 id: { type: "string", example: "12345678901" },
                 customerId: { type: "string", example: "7984091200" },
                 status: { type: "string", enum: ["ENABLED", "PAUSED"], example: "ENABLED" }
               }
             }
           }
         }
       }
    */
    try {
      const { error, value } = updateGoogleAdStatusSchema.validate(req.body);
      if (error) {
        return res.status(400).json({ status: false, error: error.details[0].message });
      }

      const { level, id, status } = value;
      const customerId = value.adAccountId || value.customerId;
      const userId = req.user.user_id;

      const { accessToken } = await initGoogleApiForUser(userId);
      const tid = normalizeRequestCustomerId(res, customerId);
      if (!tid) return;

      // Fast path: resolve loginCustomerId from Redis only (set by resolveManagerForAccount on first campaign load)
      let loginCustomerId = tid;
      try {
        const cacheKey = `googleManagerMap:${tid}`;
        const cached = redisClient ? await redisClient.get(cacheKey) : null;
        if (cached && cached !== "SELF") loginCustomerId = normalizeCustomerId(cached);
        // If not in Redis yet, fall back to MongoDB and warm Redis
        if (!cached) {
          const dbUser = await GoogleUsers.findOne({ userId }, { [`managerMap.${tid}`]: 1 }).lean();
          const dbVal = dbUser?.managerMap?.[tid] || "SELF";
          if (redisClient) redisClient.set(cacheKey, dbVal, "EX", 86400).catch(() => {});
          if (dbVal !== "SELF") loginCustomerId = normalizeCustomerId(dbVal);
        }
      } catch (_) { /* fall through — use tid as loginCustomerId */ }

      const numericId = sanitizeId(id);

      if (level === "campaign") {
        const cleanCustomerId = sanitizeId(customerId);
        const adHeaders = {
          Authorization: `Bearer ${accessToken}`,
          "developer-token": process.env.GOOGLE_DEVELOPER_TOKEN,
          "login-customer-id": loginCustomerId,
          "Content-Type": "application/json",
        };
        await axios.post(
          `https://googleads.googleapis.com/v23/customers/${cleanCustomerId}/campaigns:mutate`,
          {
            operations: [{
              updateMask: "status",
              update: {
                resourceName: `customers/${cleanCustomerId}/campaigns/${numericId}`,
                status: status === "ENABLED" ? "ENABLED" : "PAUSED",
              },
            }],
          },
          { headers: adHeaders }
        );
      } else if (level === "adgroup") {
        const entityType = value.entityType || req.body.entityType || "";
        const isAssetGroup = entityType === "ASSET_GROUP" || value.isPmax === true || req.body.isPmax === true;
        const cleanCustomerId = sanitizeId(customerId);
        const adHeaders = {
          Authorization: `Bearer ${accessToken}`,
          "developer-token": process.env.GOOGLE_DEVELOPER_TOKEN,
          "login-customer-id": loginCustomerId,
          "Content-Type": "application/json",
        };
        if (isAssetGroup) {
          // asset_group.status is independently mutable — Google Ads Scripts'
          // AssetGroup.pause()/enable() wrap this same mutate operation.
          await axios.post(
            `https://googleads.googleapis.com/v23/customers/${cleanCustomerId}/assetGroups:mutate`,
            {
              operations: [{
                updateMask: "status",
                update: {
                  resourceName: `customers/${cleanCustomerId}/assetGroups/${numericId}`,
                  status: status === "ENABLED" ? "ENABLED" : "PAUSED",
                },
              }],
            },
            { headers: adHeaders }
          );
        } else {
          await axios.post(
            `https://googleads.googleapis.com/v23/customers/${cleanCustomerId}/adGroups:mutate`,
            {
              operations: [{
                updateMask: "status",
                update: {
                  resourceName: `customers/${cleanCustomerId}/adGroups/${numericId}`,
                  status: status === "ENABLED" ? "ENABLED" : "PAUSED",
                },
              }],
            },
            { headers: adHeaders }
          );
        }
      } else if (level === "ad") {
        const adGroupId = value.adGroupId || req.body.adGroupId;
        if (!adGroupId) {
          return res.status(400).json({ status: false, error: "adGroupId is required for ad-level status updates" });
        }
        const cleanCustomerId = sanitizeId(customerId);
        const cleanAdGroupId  = sanitizeId(adGroupId);
        const cleanAdId       = sanitizeId(numericId);
        const resource = `customers/${cleanCustomerId}/adGroupAds/${cleanAdGroupId}~${cleanAdId}`;
        const adHeaders = {
          Authorization: `Bearer ${accessToken}`,
          "developer-token": process.env.GOOGLE_DEVELOPER_TOKEN,
          "login-customer-id": loginCustomerId,
          "Content-Type": "application/json",
        };
        await axios.post(
          `https://googleads.googleapis.com/v23/customers/${cleanCustomerId}/adGroupAds:mutate`,
          {
            operations: [{
              updateMask: "status",
              update: { resourceName: resource, status: status === "ENABLED" ? "ENABLED" : "PAUSED" },
            }],
          },
          { headers: adHeaders }
        );
      }

      // Fire-and-forget — don't block response on cache invalidation
      invalidateUserGoogleCache(userId).catch(() => {});

      return res.status(200).json({
        status: true,
        message: `${level} ${status.toLowerCase()}d successfully`,
      });
    } catch (error) {
      const m = formatGoogleError(error);
      const detail = error?.response?.data ? JSON.stringify(error.response.data) : (error?.message || String(error));
      logger.error(`Google update status error: ${m.message} | detail: ${detail}`);
      return res.status(error.statusCode || error?.response?.status || 500).json({
        status: false,
        error: m.message || "Failed to update status",
        details: detail,
        reason: m.reason,
      });
    }
  }

  // * 12. PATCH update campaign (name, budget, dates, status)
  async updateCampaignAPI(req, res) {
    try {
      const { adAccountId, campaignId, name, dailyBudgetMicros, status, startTime, endTime } = req.body;
      if (!adAccountId) return res.status(400).json({ status: false, error: "adAccountId is required" });
      if (!campaignId)  return res.status(400).json({ status: false, error: "campaignId is required" });

      const userId = req.user.user_id;
      const { client, refreshToken, accessToken } = await initGoogleApiForUser(userId);
      const tid = normalizeRequestCustomerId(res, adAccountId);
      if (!tid) return;
      const resolvedLoginCustomerId = await resolveManagerForAccount(tid, accessToken);
      const loginCustomerId = normalizeCustomerId(resolvedLoginCustomerId || tid);
      const mccId = loginCustomerId;
      const customerId = sanitizeId(adAccountId);
      const campaignResource = `customers/${customerId}/campaigns/${sanitizeId(campaignId)}`;

      const headers = {
        Authorization: `Bearer ${accessToken}`,
        "developer-token": process.env.GOOGLE_DEVELOPER_TOKEN,
        "login-customer-id": mccId,
        "Content-Type": "application/json",
      };

      const updateBody = { resource_name: campaignResource };
      const updateFields = [];

      if (name) { updateBody.name = name; updateFields.push("name"); }
      if (status) {
        const statusMap = { ENABLED: 2, PAUSED: 3, REMOVED: 4 };
        updateBody.status = statusMap[status] || 3;
        updateFields.push("status");
      }
      if (startTime) {
        const sd = dayjs(startTime);
        const today = dayjs();
        updateBody.start_date_time = (sd.isBefore(today) ? today : sd).format("YYYY-MM-DD 00:00:00");
        updateFields.push("start_date_time");
      }
      if (endTime) {
        updateBody.end_date_time = dayjs(endTime).format("YYYY-MM-DD 23:59:59");
        updateFields.push("end_date_time");
      }

      if (updateFields.length > 0) {
        const doMutate = (body, fields) => axios.post(
          `https://googleads.googleapis.com/v23/customers/${customerId}/googleAds:mutate`,
          { mutateOperations: [{ campaignOperation: { update: body, update_mask: fields.join(",") } }] },
          { headers }
        );
        try {
          await doMutate(updateBody, updateFields);
        } catch (mutateErr) {
          const isStartDateLocked = /CANNOT_MODIFY_START_DATE_IF_ALREADY_STARTED/i.test(JSON.stringify(mutateErr?.response?.data || ""));
          if (isStartDateLocked && updateFields.includes("start_date_time")) {
            const retryBody = { ...updateBody };
            delete retryBody.start_date_time;
            const retryFields = updateFields.filter((f) => f !== "start_date_time");
            if (retryFields.length > 0) await doMutate(retryBody, retryFields);
          } else {
            throw mutateErr;
          }
        }
      }

      // Budget update requires separate campaignBudget mutate
      if (dailyBudgetMicros) {
        const customer = getCustomerClient(client, adAccountId, loginCustomerId, refreshToken);
        // Fetch existing budget resource name
        const campaignRows = await customer.query(
          `SELECT campaign_budget.resource_name FROM campaign WHERE campaign.resource_name = '${campaignResource}' LIMIT 1`
        );
        const budgetResource = campaignRows?.[0]?.campaign_budget?.resource_name;
        if (budgetResource) {
          await axios.post(
            `https://googleads.googleapis.com/v23/customers/${customerId}/googleAds:mutate`,
            {
              mutateOperations: [{
                campaignBudgetOperation: {
                  update: { resource_name: budgetResource, amount_micros: String(dailyBudgetMicros) },
                  update_mask: "amount_micros",
                },
              }],
            },
            { headers }
          );
        }
      }

      await invalidateUserGoogleCache(userId);
      return res.status(200).json({ status: true, message: "Campaign updated successfully", campaignId });
    } catch (error) {
      const m = formatGoogleError(error);
      const safeMsg = String(m.message || "Google update campaign error");
      const safeReason = m.reason ? String(m.reason) : null;
      logger.error(`Google update campaign error: ${safeMsg}`);
      return res.status(error.response?.status || 500).json({ status: false, error: safeMsg, reason: safeReason });
    }
  }

  // * 12b. GET find campaign by exact name — used by Autopilot to recover
  // from DUPLICATE_CAMPAIGN_NAME after an interrupted run (e.g. a server
  // restart mid-poll) tries to recreate a campaign it already made.
  async findCampaignByNameAPI(req, res) {
    try {
      const { adAccountId, name } = req.body;
      if (!adAccountId) return res.status(400).json({ status: false, error: "adAccountId is required" });
      if (!name)        return res.status(400).json({ status: false, error: "name is required" });

      const userId = req.user.user_id;
      const { accessToken } = await initGoogleApiForUser(userId);
      const tid = normalizeRequestCustomerId(res, adAccountId);
      if (!tid) return;
      const resolvedLoginCustomerId = await resolveManagerForAccount(tid, accessToken);
      const loginCustomerId = normalizeCustomerId(resolvedLoginCustomerId || tid);
      const customerId = sanitizeId(adAccountId);

      const headers = {
        Authorization: `Bearer ${accessToken}`,
        "developer-token": process.env.GOOGLE_DEVELOPER_TOKEN,
        "login-customer-id": loginCustomerId,
        "Content-Type": "application/json",
      };

      // GAQL string literals escape embedded quotes by doubling them.
      const safeName = String(name).replace(/'/g, "\\'");
      const query = `SELECT campaign.id, campaign.name FROM campaign WHERE campaign.name = '${safeName}' AND campaign.status != 'REMOVED' LIMIT 1`;
      const resp = await axios.post(
        `https://googleads.googleapis.com/v23/customers/${customerId}/googleAds:searchStream`,
        { query },
        { headers }
      );
      const row = resp.data?.[0]?.results?.[0];
      const campaignId = row?.campaign?.id ? String(row.campaign.id) : null;
      return res.status(200).json({ status: true, campaignId });
    } catch (error) {
      const m = formatGoogleError(error);
      logger.error(`Google find campaign by name error: ${m.message}`);
      return res.status(error.response?.status || 500).json({ status: false, error: m.message, reason: m.reason });
    }
  }

  // * 13. PATCH update ad group (name, cpc bid, status)
  async updateAdGroupAPI(req, res) {
    try {
      const { adAccountId, adGroupId, campaignId, name, cpcBidMicros, status } = req.body;
      if (!adAccountId) return res.status(400).json({ status: false, error: "adAccountId is required" });
      if (!adGroupId)   return res.status(400).json({ status: false, error: "adGroupId is required" });

      const userId = req.user.user_id;
      const { client, refreshToken, accessToken } = await initGoogleApiForUser(userId);
      const tid = normalizeRequestCustomerId(res, adAccountId);
      if (!tid) return;
      const resolvedLoginCustomerId = await resolveManagerForAccount(tid, accessToken);
      const loginCustomerId = normalizeCustomerId(resolvedLoginCustomerId || tid);
      const mccId = loginCustomerId;
      const customerId = sanitizeId(adAccountId);
      const adGroupResource = `customers/${customerId}/adGroups/${sanitizeId(adGroupId)}`;

      const headers = {
        Authorization: `Bearer ${accessToken}`,
        "developer-token": process.env.GOOGLE_DEVELOPER_TOKEN,
        "login-customer-id": mccId,
        "Content-Type": "application/json",
      };

      const updateBody = { resource_name: adGroupResource };
      const updateFields = [];

      if (name) { updateBody.name = name; updateFields.push("name"); }
      if (cpcBidMicros) { updateBody.cpc_bid_micros = String(cpcBidMicros); updateFields.push("cpc_bid_micros"); }
      if (status) {
        const statusMap = { ENABLED: 2, PAUSED: 3, REMOVED: 4 };
        updateBody.status = statusMap[status] || 3;
        updateFields.push("status");
      }

      if (updateFields.length > 0) {
        await axios.post(
          `https://googleads.googleapis.com/v23/customers/${customerId}/googleAds:mutate`,
          { mutateOperations: [{ adGroupOperation: { update: updateBody, update_mask: updateFields.join(",") } }] },
          { headers }
        );
      }

      await invalidateUserGoogleCache(userId);
      return res.status(200).json({ status: true, message: "Ad group updated successfully", adGroupId });
    } catch (error) {
      const m = formatGoogleError(error);
      logger.error(`Google update ad group error: ${m.message}`);
      return res.status(error.response?.status || 500).json({ status: false, error: m.message, reason: m.reason });
    }
  }

  async deleteAdGroupAPI(req, res) {
    try {
      const { adAccountId, adGroupId, campaignId, isPmax } = req.body;
      if (!adAccountId) return res.status(400).json({ status: false, error: "adAccountId is required" });
      if (!adGroupId)   return res.status(400).json({ status: false, error: "adGroupId is required" });

      const userId = req.user.user_id;
      const { accessToken } = await initGoogleApiForUser(userId);
      const tid = normalizeRequestCustomerId(res, adAccountId);
      if (!tid) return;
      const resolvedMcc = await resolveManagerForAccount(tid, accessToken, userId);
      const mccId = normalizeCustomerId(resolvedMcc || tid);
      const customerId = sanitizeId(adAccountId);
      const headers = {
        Authorization: `Bearer ${accessToken}`,
        "developer-token": process.env.GOOGLE_DEVELOPER_TOKEN,
        "login-customer-id": mccId,
        "Content-Type": "application/json",
      };

      if (isPmax) {
        // Delete PMAX asset group via assetGroupOperation remove
        const assetGroupResource = `customers/${customerId}/assetGroups/${sanitizeId(adGroupId)}`;
        await axios.post(
          `https://googleads.googleapis.com/v23/customers/${customerId}/googleAds:mutate`,
          { mutateOperations: [{ assetGroupOperation: { remove: assetGroupResource } }] },
          { headers }
        );
      } else {
        // Delete regular ad group by setting status to REMOVED
        const adGroupResource = `customers/${customerId}/adGroups/${sanitizeId(adGroupId)}`;
        await axios.post(
          `https://googleads.googleapis.com/v23/customers/${customerId}/googleAds:mutate`,
          { mutateOperations: [{ adGroupOperation: { update: { resource_name: adGroupResource, status: 4 }, update_mask: "status" } }] },
          { headers }
        );
      }

      await invalidateUserGoogleCache(userId);
      return res.status(200).json({ status: true, message: isPmax ? "Asset group deleted" : "Ad group deleted" });
    } catch (error) {
      const detail = error.response?.data ? JSON.stringify(error.response.data) : error.message;
      logger.error(`deleteAdGroupAPI failed: ${detail}`);
      return res.status(error.response?.status || 500).json({ status: false, error: parseGoogleError(error, isPmax ? "Failed to delete asset group" : "Failed to delete ad group") });
    }
  }

  async addAssetToAssetGroupAPI(req, res) {
    try {
      const { adAccountId, assetGroupId, fieldType, text, imageAssetRN, imageUrl } = req.body;
      if (!adAccountId || !assetGroupId || !fieldType) {
        return res.status(400).json({ status: false, error: "adAccountId, assetGroupId and fieldType are required" });
      }
      const userId = req.user.user_id;
      const { accessToken } = await initGoogleApiForUser(userId);
      const tid = normalizeRequestCustomerId(res, adAccountId);
      if (!tid) return;
      const resolvedMcc = await resolveManagerForAccount(tid, accessToken, userId);
      const mccId = normalizeCustomerId(resolvedMcc || tid);
      const customerId = sanitizeId(adAccountId);
      const headers = {
        Authorization: `Bearer ${accessToken}`,
        "developer-token": process.env.GOOGLE_DEVELOPER_TOKEN,
        "login-customer-id": mccId,
        "Content-Type": "application/json",
      };
      const agResource = `customers/${customerId}/assetGroups/${sanitizeId(assetGroupId)}`;

      let assetRN = imageAssetRN || null;

      if (!assetRN && imageUrl) {
        const uploaded = await this._uploadImageFromUrl(accessToken, mccId, customerId, imageUrl);
        assetRN = fieldType === 'SQUARE_MARKETING_IMAGE' || fieldType === 'LOGO'
          ? (uploaded?.square || uploaded?.landscape)
          : (uploaded?.landscape || uploaded?.square);
      }

      if (!assetRN && text) {
        const assetResp = await axios.post(
          `https://googleads.googleapis.com/v23/customers/${customerId}/googleAds:mutate`,
          { mutateOperations: [{ assetOperation: { create: { text_asset: { text: String(text).slice(0, fieldType === 'HEADLINE' ? 30 : 90) } } } }] },
          { headers }
        );
        assetRN = assetResp.data?.mutateOperationResponses?.[0]?.assetResult?.resourceName;
      }

      if (!assetRN) return res.status(400).json({ status: false, error: "No asset content provided" });

      await axios.post(
        `https://googleads.googleapis.com/v23/customers/${customerId}/googleAds:mutate`,
        { mutateOperations: [{ assetGroupAssetOperation: { create: { asset_group: agResource, asset: assetRN, field_type: fieldType } } }] },
        { headers }
      );

      await invalidateUserGoogleCache(userId);
      return res.status(201).json({ status: true, message: "Asset added", assetResourceName: assetRN });
    } catch (e) {
      const detail = e.response?.data ? JSON.stringify(e.response.data) : e.message;
      logger.error(`addAssetToAssetGroupAPI failed: ${detail}`);
      return res.status(e.response?.status || 500).json({ status: false, error: parseGoogleError(e, "Failed to add asset") });
    }
  }

  async removeAssetFromAssetGroupAPI(req, res) {
    try {
      const { adAccountId, assetGroupId, assetResourceName, fieldType } = req.body;
      if (!adAccountId || !assetGroupId || !assetResourceName || !fieldType) {
        return res.status(400).json({ status: false, error: "adAccountId, assetGroupId, assetResourceName and fieldType are required" });
      }
      const userId = req.user.user_id;
      const { accessToken } = await initGoogleApiForUser(userId);
      const tid = normalizeRequestCustomerId(res, adAccountId);
      if (!tid) return;
      const resolvedMcc = await resolveManagerForAccount(tid, accessToken, userId);
      const mccId = normalizeCustomerId(resolvedMcc || tid);
      const customerId = sanitizeId(adAccountId);
      const headers = {
        Authorization: `Bearer ${accessToken}`,
        "developer-token": process.env.GOOGLE_DEVELOPER_TOKEN,
        "login-customer-id": mccId,
        "Content-Type": "application/json",
      };
      // Official AssetFieldTypeEnum.AssetFieldType values (Google Ads API v23) —
      // do not hand-guess these; 0/1 are reserved for UNSPECIFIED/UNKNOWN.
      const FIELD_TYPE_ENUM = {
        HEADLINE: 2, DESCRIPTION: 3, MANDATORY_AD_TEXT: 4, MARKETING_IMAGE: 5,
        MEDIA_BUNDLE: 6, YOUTUBE_VIDEO: 7, BOOK_ON_GOOGLE: 8, LEAD_FORM: 9,
        PROMOTION: 10, CALLOUT: 11, STRUCTURED_SNIPPET: 12, SITELINK: 13,
        MOBILE_APP: 14, HOTEL_CALLOUT: 15, CALL: 16, LONG_HEADLINE: 17,
        BUSINESS_NAME: 18, SQUARE_MARKETING_IMAGE: 19, PORTRAIT_MARKETING_IMAGE: 20,
        LOGO: 21, LANDSCAPE_LOGO: 22, VIDEO: 23, PRICE: 24,
        CALL_TO_ACTION_SELECTION: 25, AD_IMAGE: 26, BUSINESS_LOGO: 27,
        HOTEL_PROPERTY: 28, DEMAND_GEN_CAROUSEL_CARD: 30, BUSINESS_MESSAGE: 31,
        TALL_PORTRAIT_MARKETING_IMAGE: 32, RELATED_YOUTUBE_VIDEOS: 33,
        LANDING_PAGE_PREVIEW: 38, LONG_DESCRIPTION: 39, CALL_TO_ACTION: 40,
      };
      const fieldTypeNum = FIELD_TYPE_ENUM[fieldType];
      if (!fieldTypeNum) {
        return res.status(400).json({ status: false, error: `Unknown fieldType: ${fieldType}` });
      }

      // asset_group_asset resource name format: customers/{cid}/assetGroupAssets/{agId}~{assetId}~{fieldTypeNum}
      const assetId = assetResourceName.split('/').pop();
      const assetGroupAssetRN = `customers/${customerId}/assetGroupAssets/${sanitizeId(assetGroupId)}~${assetId}~${fieldTypeNum}`;

      await axios.post(
        `https://googleads.googleapis.com/v23/customers/${customerId}/googleAds:mutate`,
        { mutateOperations: [{ assetGroupAssetOperation: { remove: assetGroupAssetRN } }] },
        { headers }
      );

      await invalidateUserGoogleCache(userId);
      return res.status(200).json({ status: true, message: "Asset removed" });
    } catch (e) {
      const detail = e.response?.data ? JSON.stringify(e.response.data) : e.message;
      logger.error(`removeAssetFromAssetGroupAPI failed: ${detail}`);
      return res.status(e.response?.status || 500).json({ status: false, error: parseGoogleError(e, "Failed to remove asset") });
    }
  }


  // ─── CRUD ─────────────────────────────────────────────────────────────────────

  // * Delete campaign (sets status to REMOVED)
  async deleteCampaignAPI(req, res) {
    /* #swagger.tags = ['Google Ads']
       #swagger.summary = 'Delete campaign'
       #swagger.description = 'Delete a Google Ads campaign (marks as REMOVED)'
       #swagger.security = [{ "BearerAuth": [] }]
       #swagger.requestBody = {
         required: true,
         content: {
           "application/json": {
             schema: {
               type: "object",
               required: ["adAccountId", "campaignId"],
               properties: {
                 adAccountId: { type: "string", example: "7984091200" },
                 campaignId: { type: "string", example: "1234567890" }
               }
             }
           }
         }
       }
    */
    try {
      const { error, value } = deleteGoogleCampaignSchema.validate(req.body);
      if (error) {
        return res.status(400).json({ status: false, error: error.details[0].message });
      }

      const { adAccountId, campaignId } = value;
      const userId = req.user.user_id;

      const { accessToken } = await initGoogleApiForUser(userId);
      const tid = normalizeRequestCustomerId(res, adAccountId);
      if (!tid) return;
      const resolvedMcc = await resolveManagerForAccount(tid, accessToken, userId);
      const mccId = normalizeCustomerId(resolvedMcc || tid);
      const cleanCustomerId = sanitizeId(adAccountId);
      const adHeaders = {
        Authorization: `Bearer ${accessToken}`,
        "developer-token": process.env.GOOGLE_DEVELOPER_TOKEN,
        "login-customer-id": mccId,
        "Content-Type": "application/json",
      };
      await axios.post(
        `https://googleads.googleapis.com/v23/customers/${cleanCustomerId}/campaigns:mutate`,
        {
          operations: [{
            remove: `customers/${cleanCustomerId}/campaigns/${sanitizeId(campaignId)}`,
          }],
        },
        { headers: adHeaders }
      );

      invalidateUserGoogleCache(userId).catch(() => {});

      return res.status(200).json({
        status: true,
        message: "Campaign deleted",
        campaignId,
        adAccountId,
      });
    } catch (error) {
      const m = formatGoogleError(error);
      logger.error(`Delete campaign error: ${m.message}`);
      return res.status(error.statusCode || 500).json({
        status: false,
        error: "Failed to delete campaign",
        details: m.message,
      });
    }
  }

  // * 13. POST create campaign
  async createCampaignAPI(req, res) {
    /* #swagger.tags = ['Google Ads']
       #swagger.summary = 'Create campaign'
       #swagger.description = 'Create a Google Ads campaign. MCC resolved automatically.'
       #swagger.security = [{ "BearerAuth": [] }]
       #swagger.requestBody = {
         required: true,
         content: {
           "application/json": {
             schema: {
               type: "object",
               required: ["adAccountId", "name"],
               properties: {
                 adAccountId: { type: "string", example: "7984091200" },
                 name: { type: "string", example: "My Search Campaign" },
                 objective: {
                   type: "string",
                   enum: ["SALES", "LEADS", "WEBSITE_TRAFFIC", "DISPLAY", "YOUTUBE_REACH", "PERFORMANCE_MAX"],
                   example: "SALES"
                 },
                 dailyBudgetMicros: { type: "integer", example: 5000000 },
                 status: { type: "string", enum: ["PAUSED", "ENABLED"], example: "PAUSED" },
                 startTime: { type: "string", format: "date-time", example: "2026-05-11T10:00:00Z" },
                 endTime: { type: "string", format: "date-time", example: "2026-12-31T23:59:59Z" },
                 targeting: {
                   type: "object",
                   properties: {
                     countries: { type: "array", items: { type: "string" }, example: ["US", "IN"] }
                   }
                 }
               }
             }
           }
         }
       }
    */
    try {
      const { error, value } = createCampaignSchema.validate(req.body, { abortEarly: true });
      if (error) {
        return res.status(400).json({
          status: false,
          error: error.details[0].context?.message || error.details[0].message,
        });
      }

      const userId = req.user.user_id;
      const adAccountId = value.adAccountId || value.customerId;
      const {
        name,
        objective = "SALES",
        dailyBudgetMicros,
        lifetimeBudgetMicros,
        budgetType = "DAILY",
        status = "PAUSED",
        startTime,
        endTime,
        targeting,
        objectiveExtras = {},
      } = value;

      const resolvedDailyBudgetMicros = budgetType === 'CAMPAIGN_TOTAL'
        ? (lifetimeBudgetMicros || 5000000)
        : (dailyBudgetMicros || 5000000);

      // ── Init ──────────────────────────────────────────────────────────────
      const { accessToken } = await initGoogleApiForUser(userId);
      const tid = normalizeRequestCustomerId(res, adAccountId);
      if (!tid) return;
      const resolvedMcc = await resolveManagerForAccount(tid, accessToken);
      const mccId = normalizeCustomerId(resolvedMcc || tid);
      const customerId = tid;

      const headers = {
        Authorization: `Bearer ${accessToken}`,
        "developer-token": process.env.GOOGLE_DEVELOPER_TOKEN,
        "login-customer-id": mccId,
        "Content-Type": "application/json",
      };

      // ── Objective → channel type ──────────────────────────────────────────
      const channelTypeMap = {
        SALES: "SEARCH", LEADS: "SEARCH", WEBSITE_TRAFFIC: "SEARCH", LOCAL_STORE: "SEARCH",
        APP_PROMOTION: "MULTI_CHANNEL",
        YOUTUBE_REACH: "DEMAND_GEN",
        SEARCH: "SEARCH", DISPLAY: "DISPLAY", SHOPPING: "SHOPPING",
        PERFORMANCE_MAX: "PERFORMANCE_MAX", VIDEO: "DEMAND_GEN", DEMAND_GEN: "DEMAND_GEN",
      };
      const channelType = channelTypeMap[String(objective).toUpperCase().replace(/ /g, "_")] || "SEARCH";

      // Pull extra objective-specific fields from objectiveExtras
      const {
        appSubtype,         // APP_INSTALLS | APP_ENGAGEMENT | APP_PRE_REGISTRATION
        appPlatform,        // ANDROID | IOS
        appId,              // app package name or store URL
        videoGoal,          // VIDEO_VIEWS | REACH | YOUTUBE_SUBSCRIPTIONS (YouTube reach objective)
        videoSubtype,       // VIDEO_VIEWS | EFFICIENT_REACH | NON_SKIPPABLE_REACH | TARGET_FREQUENCY
        merchantCenterId,   // Shopping campaigns
        finalUrl,           // Performance Max — where people go after clicking
        storeAddress,       // LOCAL_STORE proximity targeting
        locationRadius,     // LOCAL_STORE proximity radius
        finalUrlSuffix,     // PERFORMANCE_MAX suffix
        assetGroupName,      // PERFORMANCE_MAX asset group name
        businessDescription, // PERFORMANCE_MAX asset copy hint
        pmaxBusinessName,    // PERFORMANCE_MAX business name asset
        pmaxHeadlines,       // PERFORMANCE_MAX custom headlines array
        pmaxLongHeadline,    // PERFORMANCE_MAX long headline
        pmaxDescriptions,    // PERFORMANCE_MAX custom descriptions array
        pmaxImageUrl,           // PERFORMANCE_MAX landscape image URL (paste)
        pmaxImageAssetRN,       // PERFORMANCE_MAX landscape image already uploaded (resource name)
        pmaxSquareImageAssetRN, // PERFORMANCE_MAX square image already uploaded (resource name)
        pmaxLogoUrl,            // PERFORMANCE_MAX logo URL
        pmaxLogoAssetRN,        // PERFORMANCE_MAX logo already uploaded (resource name)
        pmaxVideoUrl,        // PERFORMANCE_MAX YouTube video URL or ID
      } = objectiveExtras;

      // ── Bidding strategy per channel type (snake_case for REST API) ──────
      let biddingStrategy;
      if (channelType === "DISPLAY") {
        biddingStrategy = { target_spend: {} };
      } else if (channelType === "DEMAND_GEN") {
        biddingStrategy = { maximize_conversions: {} };
      } else if (channelType === "PERFORMANCE_MAX") {
        biddingStrategy = { maximize_conversion_value: {} };
      } else if (channelType === "MULTI_CHANNEL") {
        // App campaigns use target_cpa or maximize_conversions
        biddingStrategy = { maximize_conversions: {} };
      } else if (channelType === "SHOPPING") {
        biddingStrategy = { target_spend: {} };
      } else {
        biddingStrategy = { manual_cpc: { enhanced_cpc_enabled: false } };
      }

      // ── Step 1: Create campaign budget ────────────────────────────────────
      const budgetResp = await axios.post(
        `https://googleads.googleapis.com/v23/customers/${customerId}/googleAds:mutate`,
        {
          mutateOperations: [{
            campaignBudgetOperation: {
              create: {
                name: `${name} Budget`,
                amount_micros: String(resolvedDailyBudgetMicros),
                delivery_method: "STANDARD",
                explicitly_shared: false,
                period: budgetType === 'CAMPAIGN_TOTAL' ? 'CAMPAIGN_TOTAL' : 'DAILY',
              },
            },
          }],
        },
        { headers }
      );
      const budgetResource = budgetResp.data?.mutateOperationResponses?.[0]?.campaignBudgetResult?.resourceName;
      if (!budgetResource) throw new Error("Campaign budget creation failed — no resourceName returned");

      // ── Step 2a: For PMAX — resolve business name for use in Step 7 asset group ─
      if (channelType === "PERFORMANCE_MAX") {
        let resolvedBusinessName = pmaxBusinessName || name || "Brand";
        if (!pmaxBusinessName) {
          try {
            const custResp = await axios.post(
              `https://googleads.googleapis.com/v23/customers/${customerId}/googleAds:searchStream`,
              { query: `SELECT customer.descriptive_name FROM customer LIMIT 1` },
              { headers }
            );
            const dn = custResp.data?.[0]?.results?.[0]?.customer?.descriptiveName
              || custResp.data?.[0]?.results?.[0]?.customer?.descriptive_name;
            if (dn) resolvedBusinessName = String(dn).slice(0, 25);
          } catch (e) {
            logger.warn(`PMAX: could not fetch account name (non-fatal): ${e.message}`);
          }
        }
        objectiveExtras._resolvedBusinessName = String(resolvedBusinessName).slice(0, 25);
      }

      // ── Step 2: Create campaign ───────────────────────────────────────────
      const campaignBody = {
        name,
        status,
        advertising_channel_type: channelType,
        campaign_budget: budgetResource,
        contains_eu_political_advertising: 'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING',
        ...biddingStrategy,
      };

      // App campaigns — set advertising_channel_sub_type from appSubtype
      if (channelType === "MULTI_CHANNEL" && appSubtype) {
        const appSubtypeMap = {
          APP_INSTALLS:         "APP_CAMPAIGN",
          APP_ENGAGEMENT:       "APP_CAMPAIGN_FOR_ENGAGEMENT",
          APP_PRE_REGISTRATION: "APP_CAMPAIGN_FOR_PRE_REGISTRATION",
        };
        const subType = appSubtypeMap[String(appSubtype).toUpperCase()];
        if (subType) campaignBody.advertising_channel_sub_type = subType;
      }

      // Shopping campaigns — link Merchant Center account
      if (channelType === "SHOPPING" && merchantCenterId) {
        campaignBody.shopping_setting = {
          merchant_id: String(merchantCenterId),
          feed_label: (targeting?.countries?.[0] || "US").toUpperCase(),
          campaign_priority: 0,
          enable_local: false,
        };
      }

      // ── Step 2: Create campaign ───────────────────────────────────────────────
      // PMAX: explicitly disable Brand Guidelines to avoid the logo/business-name CampaignAsset
      // requirement. Business name and logo are provided via the AssetGroup instead (Step 7).
      if (channelType === "PERFORMANCE_MAX") {
        campaignBody.brand_guidelines_enabled = false;
      }

      const campaignResp = await axios.post(
        `https://googleads.googleapis.com/v23/customers/${customerId}/googleAds:mutate`,
        { mutateOperations: [{ campaignOperation: { create: campaignBody } }] },
        { headers }
      );
      const campaignResource = campaignResp.data?.mutateOperationResponses?.[0]?.campaignResult?.resourceName;
      const campaignId = campaignResource?.split("/").pop();
      if (!campaignId) throw new Error("Campaign creation failed — no resourceName returned");

      // ── Step 3: Apply start/end dates via update mutate ───────────────────
      if (startTime || endTime) {
        try {
          const updateBody = { resource_name: campaignResource };
          const updateFields = [];
          if (startTime) {
            const sd = dayjs(startTime);
            const today = dayjs();
            updateBody.start_date_time = (sd.isBefore(today) ? today : sd).format("YYYY-MM-DD 00:00:00");
            updateFields.push("start_date_time");
          }
          if (endTime) {
            updateBody.end_date_time = dayjs(endTime).format("YYYY-MM-DD 23:59:59");
            updateFields.push("end_date_time");
          }
          const doDateMutate = (body, fields) => axios.post(
            `https://googleads.googleapis.com/v23/customers/${customerId}/googleAds:mutate`,
            { mutateOperations: [{ campaignOperation: { update: body, update_mask: fields.join(",") } }] },
            { headers }
          );
          try {
            await doDateMutate(updateBody, updateFields);
          } catch (dateErr) {
            const isStartDateLocked = /CANNOT_MODIFY_START_DATE_IF_ALREADY_STARTED/i.test(JSON.stringify(dateErr?.response?.data || ""));
            if (isStartDateLocked && updateFields.includes("start_date_time")) {
              const retryBody = { ...updateBody };
              delete retryBody.start_date_time;
              const retryFields = updateFields.filter((f) => f !== "start_date_time");
              if (retryFields.length > 0) await doDateMutate(retryBody, retryFields);
            } else {
              throw dateErr;
            }
          }
        } catch (e) {
          logger.error(`Campaign date update failed (non-fatal): ${e.response?.data ? JSON.stringify(e.response.data) : e.message}`);
        }
      }

      // ── Step 4: Location targeting ────────────────────────────────────────
      // WW = Worldwide — skip geo restriction entirely
      const nonWorldwideCountries = (targeting?.countries || []).filter((c) => c.toUpperCase() !== "WW");
      if (nonWorldwideCountries.length) {
        try {
          const COMMON_LOCATIONS = {
            US: 2840, IN: 2356, GB: 2826, CA: 2124, AU: 2036, DE: 2276, FR: 2250,
            BR: 2076, IT: 2380, ES: 2724, JP: 2392, SG: 2702, AE: 2784,
            ZA: 2710, NG: 2566, KE: 2404, PH: 2608, ID: 2360, MX: 2484, NL: 2528,
            SA: 2682, SE: 2752, NO: 2578, DK: 2208, PL: 2616, RU: 2643,
            KR: 2410, TH: 2764, MY: 2458, BD: 2050, EG: 2818, KE: 2404,
            AR: 2032, CO: 2170, NZ: 2554, CH: 2756, TR: 2792, VN: 2704, PK: 2586,
          };
          const locOps = nonWorldwideCountries
            .map((code) => COMMON_LOCATIONS[code.toUpperCase()])
            .filter(Boolean)
            .map((locId) => ({
              campaignCriterionOperation: {
                create: {
                  campaign: campaignResource,
                  location: { geo_target_constant: `geoTargetConstants/${locId}` },
                },
              },
            }));
          if (locOps.length) {
            await axios.post(
              `https://googleads.googleapis.com/v23/customers/${customerId}/googleAds:mutate`,
              { mutateOperations: locOps },
              { headers }
            );
          }
        } catch (e) {
          logger.error(`Location targeting failed (non-fatal): ${e.message}`);
        }
      }

      // ── Step 5: LOCAL_STORE — proximity radius targeting ──────────────────
      if (objective === "LOCAL_STORE" && storeAddress && locationRadius) {
        try {
          const radiusOps = [{
            campaignCriterionOperation: {
              create: {
                campaign: campaignResource,
                proximity: {
                  address: { street_address: storeAddress },
                  radius: locationRadius,
                  radius_units: 2, // KILOMETERS
                },
              },
            },
          }];
          await axios.post(
            `https://googleads.googleapis.com/v23/customers/${customerId}/googleAds:mutate`,
            { mutateOperations: radiusOps },
            { headers }
          );
        } catch (e) {
          logger.error(`Proximity targeting failed (non-fatal): ${e.message}`);
        }
      }

      // ── Step 6: PERFORMANCE_MAX — final URL suffix and/or landing page ───────
      if (objective === "PERFORMANCE_MAX" && (finalUrlSuffix || finalUrl)) {
        try {
          const updateFields = [];
          const pmaxUpdate = { resource_name: campaignResource };
          if (finalUrlSuffix) {
            pmaxUpdate.final_url_suffix = finalUrlSuffix;
            updateFields.push("final_url_suffix");
          }
          if (updateFields.length) {
            await axios.post(
              `https://googleads.googleapis.com/v23/customers/${customerId}/googleAds:mutate`,
              {
                mutateOperations: [{
                  campaignOperation: {
                    update: pmaxUpdate,
                    update_mask: updateFields.join(","),
                  },
                }],
              },
              { headers }
            );
          }
        } catch (e) {
          logger.error(`Final URL suffix update failed (non-fatal): ${e.message}`);
        }
      }

      // Asset group for PERFORMANCE_MAX is now created by the separate create-ad-group API call
      // (same flow as Search/Display — campaign first, then ad group / asset group)

      // ── Step 9: App campaigns — link app via campaign criterion ──────────────
      if (channelType === "MULTI_CHANNEL" && appId && appPlatform) {
        try {
          const platformEnum = String(appPlatform).toUpperCase() === "IOS" ? "IOS" : "ANDROID";
          await axios.post(
            `https://googleads.googleapis.com/v23/customers/${customerId}/googleAds:mutate`,
            {
              mutateOperations: [{
                campaignCriterionOperation: {
                  create: {
                    campaign: campaignResource,
                    mobile_application: {
                      app_id: String(appId),
                      operating_system_type: platformEnum,
                    },
                  },
                },
              }],
            },
            { headers }
          );
        } catch (e) {
          logger.error(`App criterion linking failed (non-fatal): ${e.message}`);
        }
      }

      await invalidateUserGoogleCache(userId);

      return res.status(201).json({
        status: true,
        message: "Campaign created successfully with targeting and budget",
        campaign: {
          campaignId,
          customerId,
          loginCustomerId: mccId,
          name,
          objective,
          status,
          dailyBudgetMicros,
          channelType,
          startTime,
          endTime,
          ...(appSubtype && { appSubtype }),
          ...(appPlatform && { appPlatform }),
          ...(appId && { appId }),
          ...(videoGoal && { videoGoal }),
          ...(videoSubtype && { videoSubtype }),
          ...(merchantCenterId && { merchantCenterId }),
          ...(finalUrl && { finalUrl }),
          objectiveExtras,
        },
      });
    } catch (error) {
      const rawDetail = error.response?.data ? JSON.stringify(error.response.data) : error.message;
      logger.error(`GOOGLE CREATE CAMPAIGN ERROR => ${rawDetail}`);

      const googleErrors =
        error.response?.data?.error?.details?.[0]?.errors || [];

      const isMutateNotAllowed = googleErrors.some(
        (e) => e.errorCode?.mutateError === "MUTATE_NOT_ALLOWED"
      );

      const isMerchantNotFound = googleErrors.some(
        (e) => e.errorCode?.mutateError === "RESOURCE_NOT_FOUND" &&
          e.location?.fieldPathElements?.some((f) => f.fieldName === "merchant_id")
      );

      const isBudgetTooLow = googleErrors.some(
        (e) => e.errorCode?.campaignBudgetError === "BUDGET_BELOW_PER_DAY_MINIMUM"
          || e.errorCode?.campaignBudgetError === "BUDGET_AMOUNT_MUST_EXCEED_MINIMUM_AMOUNT_PER_CLICK"
          || e.errorCode?.campaignBudgetError === "BUDGET_CANNOT_BE_ZERO"
          || (e.message || "").toLowerCase().includes("per-day minimum")
      );

      // Extract the minimum amount from Google's error details if present
      // Google returns camelCase: budgetPerDayMinimumErrorDetails.budgetPerDayMinimumMicros
      const budgetMinDetails = googleErrors.find(
        (e) => e.errorCode?.campaignBudgetError === "BUDGET_BELOW_PER_DAY_MINIMUM"
          || (e.message || "").toLowerCase().includes("per-day minimum")
      );
      const budgetMinErrorDetails = budgetMinDetails?.details?.budgetPerDayMinimumErrorDetails
        || budgetMinDetails?.details?.budget_per_day_minimum_error_details
        || {};
      const budgetMinMicros = budgetMinErrorDetails.budgetPerDayMinimumMicros
        || budgetMinErrorDetails.minimum_amount_micros
        || budgetMinErrorDetails.minimumBudgetAmountMicros;
      const budgetMinReadable = budgetMinMicros
        ? `₹${Math.ceil(Number(budgetMinMicros) / 1_000_000)}`
        : null;

      const formattedErrors = googleErrors.map((e) => ({
        message: e.message,
        field: e.location?.fieldPathElements?.map((f) => f.fieldName).join(".") || null,
        code: Object.keys(e.errorCode || {})[0] || null,
      }));

      const minText = budgetMinReadable || null;

      return res.status(error.response?.status || 500).json({
        status: false,
        error: isMutateNotAllowed
          ? "This campaign type cannot be created via the API. YouTube video ads are created as Demand Gen campaigns."
          : isMerchantNotFound
            ? "Merchant Center account not found or not linked to this Google Ads account. Please link it at Google Ads → Tools → Linked accounts."
          : isBudgetTooLow
            ? `Your daily budget is too low for this campaign type.${minText ? ` The minimum required is ${minText}/day — please increase your budget and try again.` : " Please increase your daily budget and try again."}`
            : parseGoogleError(error, "Failed to create campaign"),
        validations: formattedErrors,
      });
    }
  }

  // * 15. POST create ad group
  async createAdGroupAPI(req, res) {
    /* #swagger.tags = ['Google Ads']
       #swagger.summary = 'Create ad group'
       #swagger.description = 'Create an ad group under a campaign. Ad group type auto-detected from campaign channel type. MCC resolved automatically.'
       #swagger.security = [{ "BearerAuth": [] }]
       #swagger.requestBody = {
         required: true,
         content: {
           "application/json": {
             schema: {
               type: "object",
               required: ["adAccountId", "campaignId", "name"],
               properties: {
                 adAccountId: { type: "string", example: "7984091200" },
                 campaignId: { type: "string", example: "12345678901" },
                 name: { type: "string", example: "Ad Group 1" },
                 cpcBidMicros: { type: "integer", example: 1000000, description: "Max CPC bid in micros. 1,000,000 = ₹1 or $1" },
                 status: { type: "string", enum: ["PAUSED", "ENABLED"], example: "PAUSED" },
                 startTime: { type: "string", format: "date-time", example: "2026-05-11T10:00:00Z" },
                 endTime: { type: "string", format: "date-time", example: "2026-12-31T23:59:59Z" },
                 targeting: {
                   type: "object",
                   properties: {
                     countries: { type: "array", items: { type: "string" }, example: ["US", "IN"] },
                     ageMin: { type: "integer", minimum: 18, maximum: 65, example: 18 },
                     ageMax: { type: "integer", minimum: 18, maximum: 65, example: 45 },
                     genders: { type: "array", items: { type: "string", enum: ["MALE", "FEMALE"] }, example: ["MALE", "FEMALE"] }
                   }
                 }
               }
             }
           }
         }
       }
    */
    try {
      const { error, value } = createAdGroupSchema.validate(req.body, { abortEarly: true });
      if (error) {
        return res.status(400).json({
          status: false,
          error: error.details[0].context?.message || error.details[0].message,
        });
      }

      const userId = req.user.user_id;
      const adAccountId = value.adAccountId || value.customerId;
      const {
        campaignId,
        name,
        cpcBidMicros = 1000000,
        bidAmount,
        status = "PAUSED",
        startTime,
        endTime,
        targeting,
        biddingGoal,
        targetCpaMicros,
        targetRoas,
        keywords = [],
        videoFormat,
        frequencyCap,
        // PMAX asset group fields
        assetGroupName,
        finalUrl: pmaxFinalUrl,
        businessDescription,
        pmaxBusinessName,
        pmaxHeadlines,
        pmaxLongHeadline,
        pmaxDescriptions,
        pmaxImageUrl,
        pmaxImageAssetRN,
        pmaxSquareImageAssetRN,
        pmaxLogoUrl,
        pmaxLogoAssetRN,
        pmaxVideoUrl,
      } = value;

      const actualBid = bidAmount || cpcBidMicros;

      // ── Init ──────────────────────────────────────────────────────────────
      const { client, refreshToken, accessToken } = await initGoogleApiForUser(userId);
      const tid = normalizeRequestCustomerId(res, adAccountId);
      if (!tid) return;
      const resolvedMcc = await resolveManagerForAccount(tid, accessToken);
      const mccId = normalizeCustomerId(resolvedMcc || tid);
      const customer = getCustomerClient(client, adAccountId, mccId, refreshToken);

      const customerId = tid;
      const cleanCampaignId = sanitizeId(campaignId);

      // ── Step 1: Update Campaign Scheduling & Locations if needed ──────────
      if (startTime || endTime || (targeting && targeting.countries)) {
        try {
          // Campaign date update
          if (startTime || endTime) {
            const campaignUpdate = {
              resource_name: `customers/${customerId}/campaigns/${cleanCampaignId}`,
            };

            if (startTime) {
              const startDate = dayjs(startTime);
              // Google rejects past start dates — clamp to today
              const today = dayjs();
              campaignUpdate.start_date_time = (startDate.isBefore(today) ? today : startDate).format("YYYY-MM-DD 00:00:00");
            }

            if (endTime) {
              campaignUpdate.end_date_time = dayjs(endTime).format("YYYY-MM-DD 23:59:59");
            }

            try {
              await customer.campaigns.update([campaignUpdate]);
            } catch (dateErr) {
              const isStartDateLocked = /CANNOT_MODIFY_START_DATE_IF_ALREADY_STARTED/i.test(JSON.stringify(dateErr?.errors || dateErr?.message || ""));
              if (isStartDateLocked && campaignUpdate.start_date_time) {
                const { start_date_time, ...retryUpdate } = campaignUpdate;
                if (Object.keys(retryUpdate).length > 1) await customer.campaigns.update([retryUpdate]);
              } else {
                throw dateErr;
              }
            }
          }

          // Campaign location targeting
          const nonWorldwideCountries2 = (targeting?.countries || []).filter((c) => c.toUpperCase() !== "WW");
          if (nonWorldwideCountries2.length) {
            const COMMON_LOCATIONS = {
              US: 2840, IN: 2356, GB: 2826, CA: 2124, AU: 2036, DE: 2276, FR: 2250,
              BR: 2076, IT: 2380, ES: 2724, JP: 2392, SG: 2702, AE: 2784,
              ZA: 2710, NG: 2566, KE: 2404, PH: 2608, ID: 2360, MX: 2484, NL: 2528,
              SA: 2682, SE: 2752, NO: 2578, DK: 2208, PL: 2616, RU: 2643,
              KR: 2410, TH: 2764, MY: 2458, BD: 2050, EG: 2818,
              AR: 2032, CO: 2170, NZ: 2554, CH: 2756, TR: 2792, VN: 2704, PK: 2586,
            };

            const locationCriteria = nonWorldwideCountries2
              .map((code) => COMMON_LOCATIONS[code.toUpperCase()])
              .filter(Boolean)
              .map((locId) => ({
                campaign: `customers/${customerId}/campaigns/${cleanCampaignId}`,
                location: {
                  geo_target_constant: `geoTargetConstants/${locId}`,
                },
              }));

            if (locationCriteria.length > 0) {
              await customer.campaignCriteria.create(locationCriteria);
            }
          }
        } catch (e) {
          // Silent fail for targeting update

        }
      }

      // ── Step 2: Detect campaign channel type ────────
      const campTypeResp = await axios.post(
        `https://googleads.googleapis.com/v23/customers/${customerId}/googleAds:searchStream`,
        { query: `SELECT campaign.advertising_channel_type FROM campaign WHERE campaign.id = ${cleanCampaignId} LIMIT 1` },
        { headers: { Authorization: `Bearer ${accessToken}`, "developer-token": process.env.GOOGLE_DEVELOPER_TOKEN, "login-customer-id": mccId, "Content-Type": "application/json" } }
      );
      const channelType = campTypeResp.data?.[0]?.results?.[0]?.campaign?.advertisingChannelType || "SEARCH";

      if (channelType === "PERFORMANCE_MAX") {
        return await this._createPmaxAssetGroup(req, res, {
          accessToken, mccId, customerId, cleanCampaignId,
          name, status,
          assetGroupName, pmaxFinalUrl, businessDescription, pmaxBusinessName,
          pmaxHeadlines, pmaxLongHeadline, pmaxDescriptions,
          pmaxImageUrl, pmaxImageAssetRN, pmaxSquareImageAssetRN,
          pmaxLogoUrl, pmaxLogoAssetRN, pmaxVideoUrl,
        });
      }

      const adGroupTypeMap = {
        SEARCH: "SEARCH_STANDARD",
        DISPLAY: "DISPLAY_STANDARD",
        SHOPPING: "SHOPPING_PRODUCT_ADS",
        VIDEO: "DEMAND_GEN_VIDEO_RESPONSIVE_AD",
        DEMAND_GEN: "DEMAND_GEN_VIDEO_RESPONSIVE_AD",
        MULTI_CHANNEL: "SEARCH_STANDARD",
      };
      const adGroupType = adGroupTypeMap[channelType] || "SEARCH_STANDARD";

      // ── Step 3: Create ad group ───────────────────────────
      const adGroupPayload = {
        name,
        status,
        type: adGroupType,
        cpc_bid_micros: String(actualBid),
        campaign: `customers/${customerId}/campaigns/${cleanCampaignId}`,
      };
      // Override bidding strategy at ad group level when specified
      if (biddingGoal === "TARGET_CPA" && targetCpaMicros) {
        adGroupPayload.target_cpa_micros = String(targetCpaMicros);
      } else if (biddingGoal === "TARGET_ROAS" && targetRoas) {
        adGroupPayload.target_roas = targetRoas / 100; // frontend sends %, API wants fraction
      }
      const adGroupResult = await customer.adGroups.create([adGroupPayload]);

      const adGroupResource = adGroupResult.results[0]?.resource_name;
      const adGroupId = adGroupResource?.split("/").pop();

      // ── Step 4: Create Ad Group Demographic Criteria ─────────────────────
      if (targeting && (targeting.ageMin || targeting.ageMax || targeting.genders)) {
        try {
          const demographicOps = [];

          // Age mapping
          if (targeting.ageMin || targeting.ageMax) {
            const ageRanges = [
              { min: 18, max: 24, enum: "AGE_RANGE_18_24" },
              { min: 25, max: 34, enum: "AGE_RANGE_25_34" },
              { min: 35, max: 44, enum: "AGE_RANGE_35_44" },
              { min: 45, max: 54, enum: "AGE_RANGE_45_54" },
              { min: 55, max: 64, enum: "AGE_RANGE_55_64" },
              { min: 65, max: 65, enum: "AGE_RANGE_65_UP" },
            ];

            const min = targeting.ageMin || 18;
            const max = targeting.ageMax || 65;

            // Include any range that overlaps with [min, max]
            const selectedAges = ageRanges.filter((r) => r.min <= max && r.max >= min);

            selectedAges.forEach((age) => {
              demographicOps.push({
                ad_group: adGroupResource,
                age_range: { type: age.enum },
              });
            });
          }

          // Gender mapping
          if (targeting.genders?.length) {
            targeting.genders.forEach((g) => {
              demographicOps.push({
                ad_group: adGroupResource,
                gender: { type: g.toUpperCase() },
              });
            });
          }

          if (demographicOps.length > 0) {
            await customer.adGroupCriteria.create(demographicOps);
          }
        } catch (e) {
          // Silent fail for demographic targeting

        }
      }

      // ── Step 5: Add keywords (SEARCH campaigns) ─────────────────────────────
      if (keywords.length > 0 && (channelType === "SEARCH" || channelType === "MULTI_CHANNEL")) {
        try {
          const kwMatchTypeMap = { BROAD: 4, PHRASE: 3, EXACT: 2 }; // Google v23 enum ints
          const kwCriteria = keywords
            .filter((k) => k.text?.trim())
            .map((k) => ({
              ad_group: adGroupResource,
              keyword: {
                text: k.text.trim(),
                match_type: kwMatchTypeMap[k.matchType?.toUpperCase()] || 4,
              },
            }));
          if (kwCriteria.length > 0) {
            await customer.adGroupCriteria.create(kwCriteria);
          }
        } catch (e) {
          logger.error(`Keyword creation failed (non-fatal): ${e.message}`);
        }
      }

      // ── Step 6: Frequency cap (DISPLAY campaigns) ────────────────────────────
      if (frequencyCap && channelType === "DISPLAY") {
        try {
          await axios.post(
            `https://googleads.googleapis.com/v23/customers/${customerId}/googleAds:mutate`,
            {
              mutateOperations: [{
                campaignOperation: {
                  update: {
                    resource_name: `customers/${customerId}/campaigns/${cleanCampaignId}`,
                    frequency_caps: [{
                      cap: {
                        impressions: frequencyCap,
                        time_unit: 3,   // DAILY = 3 in v23 TimeUnit enum
                        time_length: 1,
                      },
                      level: 2, // AD_GROUP_LEVEL = 2
                    }],
                  },
                  update_mask: "frequency_caps",
                },
              }],
            },
            {
              headers: {
                Authorization: `Bearer ${accessToken}`,
                "developer-token": process.env.GOOGLE_DEVELOPER_TOKEN,
                "login-customer-id": mccId,
                "Content-Type": "application/json",
              },
            }
          );
        } catch (e) {
          logger.error(`Frequency cap failed (non-fatal): ${e.message}`);
        }
      }

      await invalidateUserGoogleCache(userId);

      return res.status(201).json({
        status: true,
        message: "Ad group created successfully with targeting",
        adGroup: {
          adGroupId,
          customerId,
          loginCustomerId: mccId,
          campaignId,
          name,
          type: adGroupType,
          cpcBidMicros: actualBid,
          status,
          startTime,
          endTime,
          targeting,
          biddingGoal: biddingGoal || null,
          keywordsAdded: keywords.filter((k) => k.text?.trim()).length,
          videoFormat: videoFormat || null,
          frequencyCap: frequencyCap || null,
        },
      });
    } catch (error) {
      logger.error(`GOOGLE CREATE AD GROUP ERROR => ${error.message}`);


      const googleErrors =
        error.response?.data?.error?.details?.[0]?.errors || [];

      const formattedErrors = googleErrors.map((e) => ({
        message: e.message,
        field:
          e.location?.fieldPathElements
            ?.map((f) => f.fieldName)
            .join(".") || null,
        code: Object.keys(e.errorCode || {})[0] || null,
      }));

      return res.status(error.response?.status || 500).json({
        status: false,
        error: parseGoogleError(error, "Failed to create ad group"),
        validations: formattedErrors,
      });
    }
  }

  // * 22. POST create ad
  async createAdAPI(req, res) {
    /* #swagger.tags = ['Google Ads']
       #swagger.summary = 'Create ads'
       #swagger.description = 'Create one or more ads (SEARCH / DISPLAY / VIDEO) under an ad group. Pass campaignId so the backend auto-detects ad type. SEARCH needs headlines+descriptions. DISPLAY needs imageUrl. VIDEO needs videoUrl (MP4, auto-uploaded to YouTube).'
       #swagger.security = [{ "BearerAuth": [] }]
       #swagger.requestBody = {
         required: true,
         content: {
           "application/json": {
             schema: {
               type: "object",
               required: ["adAccountId", "adGroupId", "ads"],
               properties: {
                 adAccountId: { type: "string", example: "7138174374" },
                 adGroupId: { type: "string", example: "9988776655" },
                 campaignId: { type: "string", example: "12345678901", description: "Used to auto-detect SEARCH / DISPLAY / VIDEO ad type" },
                 ads: {
                   type: "array",
                   minItems: 1,
                   items: {
                     type: "object",
                     properties: {
                       headlines: { type: "array", items: { type: "string", maxLength: 30 }, minItems: 3, maxItems: 15, example: ["Buy Now", "Best Deals", "Shop Today"], description: "SEARCH only — 3 to 15 headlines, max 30 chars each" },
                       descriptions: { type: "array", items: { type: "string", maxLength: 90 }, minItems: 2, maxItems: 4, example: ["Shop the best deals online.", "Get started today."], description: "SEARCH only — 2 to 4 descriptions, max 90 chars each" },
                       headline: { type: "string", example: "Buy Now - Best Deals", description: "DISPLAY / VIDEO — single headline" },
                       description: { type: "string", example: "Shop the best deals online today.", description: "DISPLAY — single description" },
                       finalUrl: { type: "string", example: "https://example.com" },
                       imageUrl: { type: "string", example: "https://example.com/image.jpg", description: "DISPLAY only — landscape image URL (min 1200x628)" },
                       videoUrl: { type: "string", example: "https://example.com/video.mp4", description: "VIDEO only — direct MP4 URL, auto-uploaded to YouTube" },
                       callToAction: { type: "string", example: "LEARN_MORE", description: "DISPLAY / VIDEO — call to action" }
                     }
                   }
                 }
               }
             }
           }
         }
       }
       #swagger.responses[201] = {
         description: "Ads created successfully",
         schema: {
           status: true,
           message: "2 ads created successfully",
           adType: "SEARCH",
           ads: [{ adId: "123456", adResourceName: "customers/xxx/adGroupAds/yyy~zzz" }]
         }
       }
       #swagger.responses[400] = { description: "Bad Request — validation error or missing required field" }
       #swagger.responses[401] = { description: "Unauthorized" }
       #swagger.responses[500] = { description: "Internal Server Error" }
    */
    try {
      const { error: schemaError, value: schemaValue } = createAdSchema.validate(req.body, { abortEarly: true });
      if (schemaError) {
        return res.status(400).json({ status: false, error: schemaError.details[0].message });
      }

      const { adAccountId, customerId: customerIdAlias, adGroupId, campaignId, ads: adsArray } = schemaValue;
      const resolvedAccountId = adAccountId || customerIdAlias;

      // Pre-flight: verify all finalUrls are reachable — Google rejects with
      // DESTINATION_NOT_WORKING (PROHIBITED) if the URL returns an error or is unreachable.
      for (let i = 0; i < adsArray.length; i++) {
        const url = adsArray[i].finalUrl;
        try {
          const urlCheck = await axios.head(url, { timeout: 8000, maxRedirects: 5, validateStatus: (s) => s < 500 });
          if (urlCheck.status >= 400) {
            return res.status(400).json({
              status: false,
              error: `The destination URL for ad ${i + 1} is not reachable (HTTP ${urlCheck.status}). Please use a live, publicly accessible URL.`,
              reason: "DESTINATION_NOT_WORKING",
            });
          }
        } catch (urlErr) {
          return res.status(400).json({
            status: false,
            error: `The destination URL for ad ${i + 1} could not be reached: "${url}". Please use a live, publicly accessible URL.`,
            reason: "DESTINATION_NOT_WORKING",
          });
        }
      }

      const userId = req.user.user_id;
      const { accessToken } = await initGoogleApiForUser(userId);
      const customerId = normalizeRequestCustomerId(res, resolvedAccountId);
      if (!customerId) return;

      let resolvedLoginCustomerId = null;
      try {
        resolvedLoginCustomerId = await resolveManagerForAccount(customerId, accessToken);
      } catch (e) {}
      const loginCustomerId = normalizeCustomerId(resolvedLoginCustomerId || customerId);
      const cleanAdGroupId = sanitizeId(adGroupId);

      const headers = {
        Authorization: `Bearer ${accessToken}`,
        "developer-token": process.env.GOOGLE_DEVELOPER_TOKEN,
        "login-customer-id": loginCustomerId,
        "Content-Type": "application/json",
      };

      // ── Step 1: Detect channel type ───────────────────────────────────────
      // Try ad group query first, fall back to direct campaign query if campaignId provided
      const searchResp = await axios.post(
        `https://googleads.googleapis.com/v23/customers/${customerId}/googleAds:searchStream`,
        {
          query: `
            SELECT campaign.advertising_channel_type
            FROM ad_group
            WHERE ad_group.id = ${cleanAdGroupId}
            LIMIT 1
          `,
        },
        { headers }
      );

      const agResults = searchResp.data?.[0]?.results || [];
      let channelType = agResults[0]?.campaign?.advertisingChannelType;

      // Fallback: query campaign directly if ad group query returned nothing
      if (!channelType && campaignId) {
        const cleanCampaignId = sanitizeId(campaignId);
        const campResp = await axios.post(
          `https://googleads.googleapis.com/v23/customers/${customerId}/googleAds:searchStream`,
          { query: `SELECT campaign.advertising_channel_type FROM campaign WHERE campaign.id = ${cleanCampaignId} LIMIT 1` },
          { headers }
        );
        channelType = campResp.data?.[0]?.results?.[0]?.campaign?.advertisingChannelType;
      }

      channelType = channelType || "SEARCH";
      logger.info(`createAdAPI: adGroup=${cleanAdGroupId} campaignId=${campaignId} → channelType=${channelType}`);

      // ── DEMAND_GEN campaign: YouTube/Demand Gen ad creation ──────────────────
      if (channelType === "DEMAND_GEN" || channelType === "VIDEO") {
        const missingVideo = adsArray.findIndex((ad) => !ad.videoUrl && !ad.youtubeVideoId);
        if (missingVideo !== -1) {
          return res.status(400).json({
            status: false,
            error: `Please provide a video URL or YouTube video ID for your video ad${adsArray.length > 1 ? ` (Ad ${missingVideo + 1} is missing a video)` : ""}.`,
          });
        }

        // Auto-fetch business name from the Google Ads account descriptive_name
        let accountBusinessName = "Brand";
        try {
          const custResp = await axios.post(
            `https://googleads.googleapis.com/v23/customers/${customerId}/googleAds:searchStream`,
            { query: `SELECT customer.descriptive_name FROM customer LIMIT 1` },
            { headers }
          );
          const name = custResp.data?.[0]?.results?.[0]?.customer?.descriptiveName
            || custResp.data?.[0]?.results?.[0]?.customer?.descriptive_name;
          if (name) accountBusinessName = String(name).slice(0, 25);
        } catch (e) {
          logger.warn(`Could not fetch account name (non-fatal): ${e.message}`);
        }

        const results = [];
        for (let i = 0; i < adsArray.length; i++) {
          const ad = adsArray[i];
          const rawAd = (req.body.ads || [])[i] || {};
          // Logo is always auto-fetched from the YouTube video thumbnail — no user input needed
          let videoAssetRN;

          const ytMatch = ad.videoUrl
            ? ad.videoUrl.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/)
            : null;

          // Step 1: upload video (or extract YouTube ID) and get asset resource name
          let youtubeVideoId;
          try {
            if (ad.youtubeVideoId) {
              youtubeVideoId = ad.youtubeVideoId;
            } else if (ytMatch) {
              youtubeVideoId = ytMatch[1];
            } else {
              youtubeVideoId = await this._uploadVideoToYouTube(accessToken, ad.videoUrl, ad.headline || "Ad Video");
              await this._waitForYouTubeVideo(accessToken, youtubeVideoId);
            }

            // Check if Google Ads video asset already exists
            const existingResp = await axios.post(
              `https://googleads.googleapis.com/v23/customers/${customerId}/googleAds:searchStream`,
              { query: `SELECT asset.resource_name FROM asset WHERE asset.youtube_video_asset.youtube_video_id = '${youtubeVideoId}' LIMIT 1` },
              { headers }
            );
            const existingRN = existingResp.data?.[0]?.results?.[0]?.asset?.resourceName
              || existingResp.data?.[0]?.results?.[0]?.asset?.resource_name;

            if (existingRN) {
              videoAssetRN = existingRN;
            } else {
              const assetResp = await axios.post(
                `https://googleads.googleapis.com/v23/customers/${customerId}/googleAds:mutate`,
                { mutateOperations: [{ assetOperation: { create: { name: `yt_video_${youtubeVideoId}_${Date.now()}`, youtube_video_asset: { youtube_video_id: youtubeVideoId } } } }] },
                { headers }
              );
              videoAssetRN = assetResp.data?.mutateOperationResponses?.[0]?.assetResult?.resourceName;
              if (!videoAssetRN) throw new Error("Failed to create YouTube video asset in Google Ads");
            }
          } catch (e) {
            const detail = e.response?.data ? JSON.stringify(e.response.data) : e.message;
            logger.error(`Demand Gen video asset upload failed: ${detail}`);
            return res.status(400).json({ status: false, error: detail });
          }

          // Step 2: logo — use the YouTube suggested thumbnail of the video.
          // Fetch video snippet to get the highest-res suggested thumbnail, upload as logo asset.
          let logoAssetRN;
          try {
            const sharp = require("sharp");
            let logoBuffer;

            // Fetch YouTube suggested thumbnail via Data API v3
            try {
              const videoResp = await axios.get("https://www.googleapis.com/youtube/v3/videos", {
                params: { part: "snippet", id: youtubeVideoId },
                headers: { Authorization: `Bearer ${accessToken}` },
                timeout: 10000,
              });
              const thumbs = videoResp.data?.items?.[0]?.snippet?.thumbnails;
              const thumbUrl = thumbs?.maxres?.url || thumbs?.high?.url || thumbs?.medium?.url || thumbs?.default?.url;
              if (thumbUrl) {
                const thumbResp = await axios.get(thumbUrl, { responseType: "arraybuffer", timeout: 15000 });
                if (thumbResp.status === 200 && thumbResp.data?.byteLength > 1000) {
                  logoBuffer = await sharp(Buffer.from(thumbResp.data))
                    .resize({ width: 128, height: 128, fit: "cover", position: "centre" })
                    .jpeg({ quality: 90 })
                    .toBuffer();
                  logger.info(`Demand Gen: logo from YouTube suggested thumbnail videoId=${youtubeVideoId} url=${thumbUrl}`);
                }
              }
            } catch (ytApiErr) {
              logger.warn(`Demand Gen: YouTube suggested thumbnail fetch failed (${ytApiErr.message}) — falling back to i.ytimg.com`);
            }

            // Fallback: i.ytimg.com CDN thumbnails (no API key needed)
            if (!logoBuffer) {
              const thumbnailCandidates = [
                `https://i.ytimg.com/vi/${youtubeVideoId}/hqdefault.jpg`,
                `https://i.ytimg.com/vi/${youtubeVideoId}/mqdefault.jpg`,
                `https://i.ytimg.com/vi/${youtubeVideoId}/default.jpg`,
              ];
              for (const url of thumbnailCandidates) {
                try {
                  const resp = await axios.get(url, { responseType: "arraybuffer", timeout: 10000 });
                  if (resp.status === 200 && resp.data?.byteLength > 5000) {
                    logoBuffer = await sharp(Buffer.from(resp.data))
                      .resize({ width: 128, height: 128, fit: "cover", position: "centre" })
                      .jpeg({ quality: 90 })
                      .toBuffer();
                    logger.info(`Demand Gen: logo fallback from i.ytimg.com ${url}`);
                    break;
                  }
                } catch (_) {}
              }
            }

            // Last resort: solid dark-blue square
            if (!logoBuffer) {
              logoBuffer = await sharp({ create: { width: 128, height: 128, channels: 3, background: { r: 15, g: 23, b: 42 } } })
                .jpeg({ quality: 90 })
                .toBuffer();
              logger.info("Demand Gen: using generated fallback logo image");
            }

            logoAssetRN = await this._uploadSingleImageBuffer(accessToken, loginCustomerId, customerId, logoBuffer, "logo");
          } catch (e) {
            logger.error(`Demand Gen logo upload failed: ${e.message}`);
            return res.status(400).json({ status: false, error: `Failed to create logo asset for Demand Gen ad: ${e.message}` });
          }

          const demandGenAd = {
            business_name: { text: accountBusinessName },
            headlines: [{ text: String(ad.headline || "Watch Now").slice(0, 30) }],
            long_headlines: [{ text: String(ad.longHeadline || ad.headline || "Watch our video").slice(0, 90) }],
            descriptions: [{ text: String(ad.description || "Check it out").slice(0, 90) }],
            videos: [{ asset: videoAssetRN }],
          };
          if (logoAssetRN) demandGenAd.logo_images = [{ asset: logoAssetRN }];
          // AdCallToActionAsset.asset must be a resource name of a pre-created CTA asset.
          // We must first mutate an asset with call_to_action_asset.call_to_action_type, then reference it.
          if (ad.callToAction) {
            try {
              const ctaType = String(ad.callToAction).toUpperCase().replace(/ /g, "_");
              const ctaAssetResp = await axios.post(
                `https://googleads.googleapis.com/v23/customers/${customerId}/googleAds:mutate`,
                { mutateOperations: [{ assetOperation: { create: { name: `cta_${ctaType}_${Date.now()}`, call_to_action_asset: { call_to_action: ctaType } } } }] },
                { headers }
              );
              const ctaAssetRN = ctaAssetResp.data?.mutateOperationResponses?.[0]?.assetResult?.resourceName;
              if (ctaAssetRN) demandGenAd.call_to_actions = [{ asset: ctaAssetRN }];
            } catch (e) {
              logger.warn(`Demand Gen CTA asset creation failed (non-fatal): ${e.response?.data ? JSON.stringify(e.response.data) : e.message}`);
            }
          }

          const adPayload = {
            name: `DemandGen_${cleanAdGroupId}_${Date.now()}`,
            demand_gen_video_responsive_ad: demandGenAd,
            final_urls: [ad.finalUrl],
          };

          logger.info(`Demand Gen ad payload: ${JSON.stringify(adPayload)}`);

          let mutateResp;
          try {
            mutateResp = await axios.post(
              `https://googleads.googleapis.com/v23/customers/${customerId}/googleAds:mutate`,
              {
                mutateOperations: [{
                  adGroupAdOperation: {
                    create: {
                      adGroup: `customers/${customerId}/adGroups/${cleanAdGroupId}`,
                      status: ad.status === "ENABLED" ? "ENABLED" : "PAUSED",
                      ad: adPayload,
                    },
                  },
                }],
              },
              { headers }
            );
          } catch (mutateErr) {
            const detail = mutateErr.response?.data ? JSON.stringify(mutateErr.response.data) : mutateErr.message;
            logger.error(`Demand Gen ad mutate failed: ${detail}`);
            return res.status(mutateErr.response?.status || 400).json({ status: false, error: detail });
          }

          const adResource = mutateResp.data?.mutateOperationResponses?.[0]?.adGroupAdResult?.resourceName;
          const entry = {
            adId: adResource?.split("~").pop(),
            adResourceName: adResource,
            youtubeVideoId,
            headline: ad.headline || null,
            description: ad.description || null,
            finalUrl: ad.finalUrl,
            status: ad.status === "ENABLED" ? "ENABLED" : "PAUSED",
          };
          if (ad.callToAction) entry.callToAction = ad.callToAction;
          results.push(entry);
        }

        return res.status(201).json({
          status: true,
          message: `${results.length} video ad${results.length > 1 ? "s" : ""} created successfully`,
          customerId,
          adGroupId: cleanAdGroupId,
          ads: results,
        });
      }

      if (channelType === "DISPLAY") {
        const missingImage = adsArray.findIndex((ad) => !ad.imageUrl && !ad.assetResourceName);
        if (missingImage !== -1) {
          return res.status(400).json({
            status: false,
            error: `An image is required for Display ads${adsArray.length > 1 ? ` (missing in ad ${missingImage + 1})` : ""}. Upload an image or provide an image URL.`,
          });
        }
      }

      // ── Step 2: Build helpers ─────────────────────────────────────────────
      const buildHeadlines = (h) => {
        const primary = String(h).slice(0, 30);
        const todaySuffix = " Today";
        const withToday = (primary.length + todaySuffix.length <= 30) ? primary + todaySuffix : null;
        const candidates = [primary, withToday, "Get Started", "Learn More", "Discover More"].filter(Boolean);
        // Deduplicate case-insensitively — Google rejects duplicate asset text
        const seen = new Set();
        const unique = [];
        for (const text of candidates) {
          const key = text.toLowerCase();
          if (!seen.has(key)) { seen.add(key); unique.push({ text }); }
        }
        return unique.slice(0, 5);
      };
      const buildDescriptions = (d) => {
        const primary = String(d).slice(0, 90);
        const fallback = "Trusted by thousands. Get started today.";
        if (primary.toLowerCase() === fallback.toLowerCase()) return [{ text: primary }];
        return [{ text: primary }, { text: fallback }];
      };

      const businessName = req.body.businessName || "Brand";
      // responsive_display_ad.call_to_action_text expects a human-readable label string
      // (e.g. "Learn more"), NOT the enum key ("LEARN_MORE").
      // Map enum keys → labels using GOOGLE_CTA_LABELS; fall back to null so the field is omitted.
      const { GOOGLE_CTA_LABELS: CTA_LABELS } = require("../../config/googleCtaConfig");
      const buildAdPayload = (h, d, url, callToAction, assetResourceName, squareAssetResourceName) => {
        if (channelType === "DISPLAY") {
          const enumKey = callToAction ? String(callToAction).toUpperCase().replace(/ /g, "_") : null;
          const ctaText = enumKey ? (CTA_LABELS[enumKey] || null) : null;
          return {
            responsiveDisplayAd: {
              headlines: buildHeadlines(h).slice(0, 5),
              descriptions: buildDescriptions(d).slice(0, 5),
              longHeadline: { text: String(h) },
              businessName,
              ...(ctaText && { callToActionText: ctaText }),
              marketingImages: assetResourceName ? [{ asset: assetResourceName }] : [],
              squareMarketingImages: squareAssetResourceName ? [{ asset: squareAssetResourceName }] : [],
            },
            finalUrls: [url],
          };
        }
        return {
          responsiveSearchAd: {
            headlines: buildHeadlines(h),
            descriptions: buildDescriptions(d),
          },
          finalUrls: [url],
        };
      };

      // ── Step 2.5: Upload images if needed ─────────────────────────────────
      const assetResourceNames = [];
      const squareAssetResourceNames = [];
      for (const ad of adsArray) {
        if (channelType === "DISPLAY") {
          // If both landscape and square assets provided, use them directly
          if (ad.assetResourceName && ad.squareAssetResourceName) {
            assetResourceNames.push(ad.assetResourceName);
            squareAssetResourceNames.push(ad.squareAssetResourceName);
          } else if (ad.imageUrl && ad.imageUrl.startsWith('http')) {
            // Only fetch from URL if it's a real HTTP URL (not a blob: URL)
            try {
              const uploadResult = await this._uploadImageFromUrl(accessToken, loginCustomerId, customerId, ad.imageUrl);
              if (!uploadResult) {
                return res.status(400).json({ status: false, error: "Image upload failed. Please check the image URL and try again." });
              }
              const { landscape, square } = uploadResult;
              assetResourceNames.push(landscape);
              squareAssetResourceNames.push(square);
            } catch (uploadErr) {
              return res.status(400).json({ status: false, error: uploadErr.message });
            }
          } else if (ad.assetResourceName && !ad.squareAssetResourceName) {
            // Old upload — only landscape asset, no square. Cannot recover without re-upload.
            return res.status(400).json({ status: false, error: "Please re-upload your image — both landscape and square variants are required for Display ads." });
          } else {
            assetResourceNames.push(null);
            squareAssetResourceNames.push(null);
          }
        } else {
          assetResourceNames.push(null);
          squareAssetResourceNames.push(null);
        }
      }

      // ── Step 3: Build mutate operations ───────────────────────────────────
      // ── Step 4: One mutate per ad (avoids DUPLICATE_ASSET when same image used) ──
      const createdAds = [];
      for (let i = 0; i < adsArray.length; i++) {
        const { headline: h, description: d, headlines: headlinesArr, descriptions: descriptionsArr, finalUrl: url, callToAction, imageUrl, status: adStatus } = adsArray[i];
        const resolvedAdStatus = adStatus === "ENABLED" ? "ENABLED" : "PAUSED";

        let adPayload;
        if (channelType === "SEARCH") {
          // SEARCH: deduplicate case-insensitively — Google rejects DUPLICATE_ASSET
          const dedup = (arr, maxLen) => {
            const seen = new Set();
            return (arr || []).filter(Boolean).filter((t) => {
              const key = String(t).trim().toLowerCase();
              if (seen.has(key)) return false;
              seen.add(key);
              return true;
            }).slice(0, maxLen);
          };
          const safeHeadlines = dedup(headlinesArr, 15);
          const safeDescriptions = dedup(descriptionsArr, 4);
          if (safeHeadlines.length < 3) return res.status(400).json({ status: false, error: "At least 3 unique headlines are required for Search ads. Remove any duplicate headlines and try again." });
          if (safeDescriptions.length < 2) return res.status(400).json({ status: false, error: "At least 2 unique descriptions are required for Search ads. Remove any duplicate descriptions and try again." });
          adPayload = {
            responsiveSearchAd: {
              headlines: safeHeadlines.map((t) => ({ text: String(t).slice(0, 30) })),
              descriptions: safeDescriptions.map((t) => ({ text: String(t).slice(0, 90) })),
            },
            finalUrls: [url],
          };
        } else {
          adPayload = buildAdPayload(h, d, url, callToAction, assetResourceNames[i], squareAssetResourceNames[i]);
        }

        const adResponse = await axios.post(
          `https://googleads.googleapis.com/v23/customers/${customerId}/googleAds:mutate`,
          {
            mutateOperations: [{
              adGroupAdOperation: {
                create: {
                  adGroup: `customers/${customerId}/adGroups/${cleanAdGroupId}`,
                  status: resolvedAdStatus,
                  ad: adPayload,
                },
              },
            }],
          },
          { headers }
        );

        const adResource = adResponse.data?.mutateOperationResponses?.[0]?.adGroupAdResult?.resourceName;
        const adId = adResource?.split("~").pop();

        await GooglePostedAd.create({
          userId,
          googleAdId: String(adId),
          adAccountId: resolvedAccountId,
          campaignId: campaignId || "",
          adGroupId,
          status: resolvedAdStatus,
          content: channelType === "SEARCH"
            ? { headlines: headlinesArr, descriptions: descriptionsArr, finalUrl: url, adType: channelType }
            : { headline: h, description: d, finalUrl: url, imageUrl: imageUrl || null, callToAction: callToAction || null, adType: channelType },
        });

        const adEntry = {
          adId: String(adId),
          adResourceName: adResource,
          finalUrl: url,
          status: resolvedAdStatus,
        };
        if (channelType === "DISPLAY") {
          if (h) adEntry.headline = h;
          if (d) adEntry.description = d;
          if (imageUrl) adEntry.imageUrl = imageUrl;
          if (callToAction) adEntry.callToAction = callToAction;
        }
        createdAds.push(adEntry);
      }

      await invalidateUserGoogleCache(userId);

      return res.status(201).json({
        status: true,
        message: `${createdAds.length} ad${createdAds.length > 1 ? "s" : ""} created successfully`,
        customerId,
        loginCustomerId,
        adGroupId,
        ads: createdAds,
      });
    } catch (error) {
      logger.error(`GOOGLE CREATE AD ERROR => ${error.message}`);
      const m = formatGoogleError(error);

      let friendlyError = m.message;
      if (m.reason === "OPERATION_NOT_PERMITTED_FOR_REMOVED_RESOURCE") {
        friendlyError = "The selected campaign or ad group has been deleted in Google Ads. Please select an active one.";
      } else if (m.reason === "TOO_LONG") {
        const violations = error.response?.data?.error?.details?.flatMap((d) => d.fieldViolations || []) || [];
        const tooLongMsg = violations.find((v) => v.description?.includes("characters"))?.description;
        if (tooLongMsg) {
          const match = tooLongMsg.match(/\"([^\"]+)\" .* (\d+) characters.*currently (\d+)/i);
          if (match) {
            friendlyError = `Your ${match[1]} is too long — maximum ${match[2]} characters, but you entered ${match[3]}. Please shorten it and try again.`;
          } else {
            friendlyError = tooLongMsg;
          }
        } else {
          friendlyError = "One of your text fields exceeds Google's character limit. Please shorten your headline (max 30) or description (max 90) and try again.";
        }
      }

      return res.status(error.response?.status || 500).json({
        status: false,
        error: friendlyError,
        details: error.response?.data || m.message,
        reason: m.reason,
      });
    }
  }


  // * PATCH update ad — Google Ads does not support in-place RSA/Display ad mutation;
  // the standard approach is remove the existing adGroupAd then create a replacement.
  async updateAdAPI(req, res) {
    try {
      const { adAccountId, adGroupId, adId, campaignId, headlines, descriptions, finalUrl, headline, description, imageUrl, callToAction } = req.body;
      if (!adAccountId) return res.status(400).json({ status: false, error: "adAccountId is required" });
      if (!adGroupId)   return res.status(400).json({ status: false, error: "adGroupId is required" });
      if (!adId)        return res.status(400).json({ status: false, error: "adId is required" });
      if (!finalUrl)    return res.status(400).json({ status: false, error: "finalUrl is required" });

      // Validate finalUrl reachability
      try {
        const urlCheck = await axios.head(finalUrl, { timeout: 8000, maxRedirects: 5, validateStatus: (s) => s < 500 });
        if (urlCheck.status >= 400) {
          return res.status(400).json({ status: false, error: `The destination URL is not reachable (HTTP ${urlCheck.status}). Please use a live, publicly accessible URL.`, reason: "DESTINATION_NOT_WORKING" });
        }
      } catch (urlErr) {
        return res.status(400).json({ status: false, error: `The destination URL could not be reached: "${finalUrl}". Please use a live, publicly accessible URL.`, reason: "DESTINATION_NOT_WORKING" });
      }

      const userId = req.user.user_id;
      const { accessToken } = await initGoogleApiForUser(userId);
      const customerId = normalizeRequestCustomerId(res, adAccountId);
      if (!customerId) return;
      const resolvedLoginCustomerId = await resolveManagerForAccount(customerId, accessToken).catch(() => null);
      const loginCustomerId = normalizeCustomerId(resolvedLoginCustomerId || customerId);
      const cleanAdGroupId = sanitizeId(adGroupId);
      const cleanAdId = sanitizeId(adId);
      const adGroupAdResource = `customers/${customerId}/adGroupAds/${cleanAdGroupId}~${cleanAdId}`;

      const headers = {
        Authorization: `Bearer ${accessToken}`,
        "developer-token": process.env.GOOGLE_DEVELOPER_TOKEN,
        "login-customer-id": loginCustomerId,
        "Content-Type": "application/json",
      };

      // Detect channel type
      const searchResp = await axios.post(
        `https://googleads.googleapis.com/v23/customers/${customerId}/googleAds:searchStream`,
        { query: `SELECT campaign.advertising_channel_type FROM ad_group WHERE ad_group.id = ${cleanAdGroupId} LIMIT 1` },
        { headers }
      );
      let channelType = searchResp.data?.[0]?.results?.[0]?.campaign?.advertisingChannelType;
      if (!channelType && campaignId) {
        const campResp = await axios.post(
          `https://googleads.googleapis.com/v23/customers/${customerId}/googleAds:searchStream`,
          { query: `SELECT campaign.advertising_channel_type FROM campaign WHERE campaign.id = ${sanitizeId(campaignId)} LIMIT 1` },
          { headers }
        );
        channelType = campResp.data?.[0]?.results?.[0]?.campaign?.advertisingChannelType;
      }
      channelType = channelType || "SEARCH";

      // Step 1: remove existing adGroupAd
      await axios.post(
        `https://googleads.googleapis.com/v23/customers/${customerId}/googleAds:mutate`,
        { mutateOperations: [{ adGroupAdOperation: { remove: adGroupAdResource } }] },
        { headers }
      );

      // Step 2: build new ad payload
      let newAdPayload;
      if (channelType === "SEARCH") {
        const dedup = (arr, maxLen) => {
          const seen = new Set();
          return (arr || []).filter(Boolean).filter((t) => {
            const key = String(t).trim().toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          }).slice(0, maxLen);
        };
        const safeHeadlines = dedup(headlines, 15);
        const safeDescriptions = dedup(descriptions, 4);
        if (safeHeadlines.length < 3) return res.status(400).json({ status: false, error: "At least 3 unique headlines are required for Search ads." });
        if (safeDescriptions.length < 2) return res.status(400).json({ status: false, error: "At least 2 unique descriptions are required for Search ads." });
        newAdPayload = {
          responsiveSearchAd: {
            headlines: safeHeadlines.map((t) => ({ text: String(t).slice(0, 30) })),
            descriptions: safeDescriptions.map((t) => ({ text: String(t).slice(0, 90) })),
          },
          finalUrls: [finalUrl],
        };
      } else if (channelType === "DISPLAY") {
        let landscapeAsset = null;
        let squareAsset = null;
        if (imageUrl) {
          const uploadResult = await this._uploadImageFromUrl(accessToken, loginCustomerId, customerId, imageUrl);
          if (!uploadResult) return res.status(400).json({ status: false, error: "Image upload failed. Please check the image URL and try again." });
          landscapeAsset = uploadResult.landscape;
          squareAsset = uploadResult.square;
        }
        const { GOOGLE_CTA_LABELS: CTA_LABELS } = require("../../config/googleCtaConfig");
        const enumKey = callToAction ? String(callToAction).toUpperCase().replace(/ /g, "_") : null;
        const ctaText = enumKey ? (CTA_LABELS[enumKey] || null) : null;
        newAdPayload = {
          responsiveDisplayAd: {
            headlines: [{ text: String(headline || "").slice(0, 30) }],
            descriptions: [{ text: String(description || "").slice(0, 90) }],
            longHeadline: { text: String(headline || "").slice(0, 90) },
            businessName: "Brand",
            ...(ctaText && { callToActionText: ctaText }),
            marketingImages: landscapeAsset ? [{ asset: landscapeAsset }] : [],
            squareMarketingImages: squareAsset ? [{ asset: squareAsset }] : [],
          },
          finalUrls: [finalUrl],
        };
      } else {
        return res.status(400).json({ status: false, error: `In-place ad update is not supported for channel type ${channelType}. Please delete and recreate the ad.` });
      }

      // Step 3: create replacement ad
      const createResp = await axios.post(
        `https://googleads.googleapis.com/v23/customers/${customerId}/googleAds:mutate`,
        {
          mutateOperations: [{
            adGroupAdOperation: {
              create: {
                adGroup: `customers/${customerId}/adGroups/${cleanAdGroupId}`,
                status: "PAUSED",
                ad: newAdPayload,
              },
            },
          }],
        },
        { headers }
      );

      const newAdResource = createResp.data?.mutateOperationResponses?.[0]?.adGroupAdResult?.resourceName;
      const newAdId = newAdResource?.split("~").pop();

      // Update DB record if exists
      await GooglePostedAd.findOneAndUpdate(
        { googleAdId: String(cleanAdId), adAccountId },
        { googleAdId: String(newAdId), content: { headline, description, finalUrl, imageUrl: imageUrl || null, callToAction: callToAction || null, adType: channelType } },
        { new: true }
      ).catch(() => {});

      await invalidateUserGoogleCache(userId);
      return res.status(200).json({ status: true, message: "Ad updated successfully", adId: newAdId, adResourceName: newAdResource });
    } catch (error) {
      logger.error(`Google update ad error: ${error.message}`);
      const m = formatGoogleError(error);
      return res.status(error.response?.status || 500).json({ status: false, error: m.message, reason: m.reason });
    }
  }

  // * DELETE ad — removes the adGroupAd (sets status to REMOVED)
  async deleteAdAPI(req, res) {
    try {
      const { adAccountId, adGroupId } = req.body;
      const { id: adId } = req.params;
      if (!adAccountId) return res.status(400).json({ status: false, error: "adAccountId is required" });
      if (!adGroupId)   return res.status(400).json({ status: false, error: "adGroupId is required" });
      if (!adId)        return res.status(400).json({ status: false, error: "adId is required" });

      const userId = req.user.user_id;
      const { accessToken } = await initGoogleApiForUser(userId);
      const customerId = normalizeRequestCustomerId(res, adAccountId);
      if (!customerId) return;
      const resolvedLoginCustomerId = await resolveManagerForAccount(customerId, accessToken).catch(() => null);
      const loginCustomerId = normalizeCustomerId(resolvedLoginCustomerId || customerId);
      const cleanAdGroupId = sanitizeId(adGroupId);
      const cleanAdId = sanitizeId(adId);
      const adGroupAdResource = `customers/${customerId}/adGroupAds/${cleanAdGroupId}~${cleanAdId}`;

      const headers = {
        Authorization: `Bearer ${accessToken}`,
        "developer-token": process.env.GOOGLE_DEVELOPER_TOKEN,
        "login-customer-id": loginCustomerId,
        "Content-Type": "application/json",
      };

      await axios.post(
        `https://googleads.googleapis.com/v23/customers/${customerId}/googleAds:mutate`,
        { mutateOperations: [{ adGroupAdOperation: { remove: adGroupAdResource } }] },
        { headers }
      );

      await GooglePostedAd.findOneAndDelete({ googleAdId: String(cleanAdId), adAccountId }).catch(() => {});
      await invalidateUserGoogleCache(userId);
      return res.status(200).json({ status: true, message: "Ad deleted successfully", adId: cleanAdId });
    } catch (error) {
      logger.error(`Google delete ad error: ${error.message}`);
      const m = formatGoogleError(error);
      return res.status(error.response?.status || 500).json({ status: false, error: m.message, reason: m.reason });
    }
  }

  async _fetchMappedGoogleAd({ userId, adAccountId, adId }) {
    const tid = normalizeCustomerId(adAccountId);
    if (!tid) {
      const error = new Error(INVALID_AD_ACCOUNT_ID_MESSAGE);
      error.statusCode = 400;
      throw error;
    }
    const { accessToken } = await initGoogleApiForUser(userId);
    const resolvedLoginCustomerId = await resolveManagerForAccount(tid, accessToken, userId);
    const lid = normalizeCustomerId(resolvedLoginCustomerId || tid);
    const cleanAdId = sanitizeId(adId);
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      "developer-token": process.env.GOOGLE_DEVELOPER_TOKEN,
      "login-customer-id": lid,
      "Content-Type": "application/json",
    };

    const [standardResults, imageAssetResp] = await Promise.all([
      fetchStandardAdResults(tid, headers, `ad_group_ad.ad.id = ${cleanAdId}`, {
        onError: (msg) => logger.error(`Google _fetchMappedGoogleAd: ${msg}`),
      }),
      axios.post(`https://googleads.googleapis.com/v23/customers/${tid}/googleAds:searchStream`, {
        query: buildImageAssetGaql(`ad_group_ad.ad.id = ${cleanAdId}`),
      }, { headers }).catch(() => ({ data: [] })),
    ]);
    if (!standardResults.length) return null;

    const imageAssetResults = imageAssetResp.data?.[0]?.results || [];
    const adImageMap = buildAdImageMapFromAssetResults(imageAssetResults);
    const assetUrlMap = await fetchGoogleAssetUrlMap(
      tid,
      headers,
      collectEmbeddedAssetRefs(standardResults),
    );

    return mapGoogleStandardAdRow(standardResults[0], {
      adImageMap,
      assetUrlMap,
      formatStatus: robustFormatStatus,
    });
  }

  // * 23. GET single ad
  async getAd(req, res) {
    /* #swagger.tags = ['Google Ads']
       #swagger.summary = 'Get ad by ID'
       #swagger.description = 'Get a single ad by ID including headlines, descriptions and final URLs'
       #swagger.security = [{ "BearerAuth": [] }]
       #swagger.parameters['id'] = { in: 'path', description: 'Google Ad ID', type: 'string', required: true }
       #swagger.parameters['adAccountId'] = { description: 'Google Ads customer ID', type: 'string', required: true }
    */
    try {
      const userId = req.user.user_id;
      const adAccountId = getQueryParam(req.query, ["adAccountId", "customerId"]);
      const adId = sanitizeId(req.params.id);
      if (!adAccountId || !adId) {
        return res.status(400).json({ status: false, error: "adAccountId and ad id are required" });
      }

      const mapped = await this._fetchMappedGoogleAd({ userId, adAccountId, adId });
      if (!mapped) return res.status(404).json({ status: false, error: "Ad not found" });

      return res.status(200).json({
        status: true,
        ...mapped,
        ad: mapped,
      });
    } catch (error) {
      const m = formatGoogleError(error);
      logger.error(`Google get ad error: ${m.message}`);
      return res.status(error.statusCode || 500).json({
        status: false, error: "Failed to fetch ad", details: m.message, reason: m.reason,
      });
    }
  }

  // * 23b. GET resolve ad for edit (Meta /v2/resolve-ad parity)
  async resolveAdForEdit(req, res) {
    try {
      const userId = req.user.user_id;
      const adAccountId = getQueryParam(req.query, ["adAccountId", "customerId"]);
      const adId = sanitizeId(req.query.adId || req.params.id);
      if (!adAccountId || !adId) {
        return res.status(400).json({ status: false, error: "adAccountId and adId are required" });
      }

      const mapped = await this._fetchMappedGoogleAd({ userId, adAccountId, adId });
      if (!mapped) return res.status(404).json({ status: false, error: "Ad not found" });

      return res.status(200).json({
        status: true,
        ...mapped,
        mediaType: mapped.videoUrl ? "video" : "image",
      });
    } catch (error) {
      const m = formatGoogleError(error);
      logger.error(`Google resolve ad error: ${m.message}`);
      return res.status(error.statusCode || 500).json({
        status: false, error: "Failed to resolve ad", details: m.message, reason: m.reason,
      });
    }
  }

  // * 24. POST upload media asset to Google Ads
  async uploadMediaAPI(req, res) {
    /* #swagger.tags = ['Google Ads']
       #swagger.summary = 'Upload media asset'
       #swagger.description = 'Upload an image asset to Google Ads; returns assetResourceName. Accepts multipart file or imageUrl.'
       #swagger.security = [{ "BearerAuth": [] }]
       #swagger.requestBody = {
         required: true,
         content: {
           "multipart/form-data": {
             schema: {
               type: "object",
               required: ["adAccountId"],
               properties: {
                 adAccountId: { type: "string", example: "7984091200" },
                 image: { type: "string", format: "binary" },
                 imageUrl: { type: "string", example: "https://example.com/image.jpg" }
               }
             }
           }
         }
       }
    */
    try {
      const userId = req.user.user_id;
      const { adAccountId, imageUrl } = req.body;
      const file = req.file;

      if (!adAccountId) return res.status(400).json({ status: false, error: "adAccountId is required" });
      if (!file && !imageUrl) {
        return res.status(400).json({ status: false, error: "Provide either an image file or imageUrl" });
      }

      const { client, refreshToken, accessToken } = await initGoogleApiForUser(userId);
      const tid = normalizeRequestCustomerId(res, adAccountId);
      if (!tid) return;
      const resolvedMcc = await resolveManagerForAccount(tid, accessToken);
      const mccId = normalizeCustomerId(resolvedMcc || tid);
      const customer = getCustomerClient(client, adAccountId, mccId, refreshToken);
      const customerId = sanitizeId(adAccountId);

      let rawBuffer;
      try {
        if (file) {
          rawBuffer = file.buffer;
        } else {
          const downloaded = await axios.get(imageUrl, { responseType: "arraybuffer", timeout: 15000 });
          rawBuffer = Buffer.from(downloaded.data);
        }
      } catch (dlErr) {
        return res.status(400).json({ status: false, error: "Failed to download image: " + dlErr.message });
      }

      // Upload both landscape (1.91:1 → 1200×628) and square (1:1 → 1200×1200) variants
      const sharp = require("sharp");
      const ts = Date.now();
      const [landscapeBuffer, squareBuffer] = await Promise.all([
        sharp(rawBuffer).resize({ width: 1200, height: 628, fit: "cover", position: "centre" }).jpeg({ quality: 90 }).toBuffer(),
        sharp(rawBuffer).resize({ width: 1200, height: 1200, fit: "cover", position: "centre" }).jpeg({ quality: 90 }).toBuffer(),
      ]);

      const uploadAsset = async (buffer, name) => {
        const resp = await axios.post(
          `https://googleads.googleapis.com/v23/customers/${customerId}/googleAds:mutate`,
          {
            mutateOperations: [{
              assetOperation: {
                create: { name, type: "IMAGE", image_asset: { data: buffer.toString("base64") } },
              },
            }],
          },
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "developer-token": process.env.GOOGLE_DEVELOPER_TOKEN,
              "login-customer-id": mccId,
              "Content-Type": "application/json",
            },
          }
        );
        return resp.data?.mutateOperationResponses?.[0]?.assetResult?.resourceName;
      };

      const [assetResourceName, squareAssetResourceName] = await Promise.all([
        uploadAsset(landscapeBuffer, `img_land_${ts}`),
        uploadAsset(squareBuffer, `img_sq_${ts}`),
      ]);

      if (!assetResourceName) throw new Error("Could not get asset resource name from Google Ads");

      return res.status(201).json({ status: true, assetResourceName, squareAssetResourceName });
    } catch (error) {
      logger.error(`GOOGLE UPLOAD MEDIA ERROR => ${error.message}`);
      const m = formatGoogleError(error);
      return res.status(error.response?.status || 500).json({
        status: false, error: "Failed to upload media", details: error.response?.data || m.message,
      });
    }
  }

  // ─── Upload video to YouTube ──────────────────────────────────────────────────

  async uploadVideoAPI(req, res) {
    try {
      const userId = req.user.user_id;
      const { adAccountId } = req.body;
      const file = req.file;

      if (!adAccountId) return res.status(400).json({ status: false, error: "adAccountId is required" });
      if (!file) return res.status(400).json({ status: false, error: "Video file is required" });

      const { accessToken } = await initGoogleApiForUser(userId);

      const title = (file.originalname || "Ad Video").replace(/\.[^.]+$/, "").slice(0, 100);
      const contentType = file.mimetype || "video/mp4";
      const fileSize = file.buffer.length;

      // Initiate YouTube resumable upload session
      const initResp = await axios.post(
        "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
        {
          snippet: { title, description: "Ad video uploaded via AdsGPT", categoryId: "22" },
          status: { privacyStatus: "unlisted" },
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            "X-Upload-Content-Type": contentType,
            "X-Upload-Content-Length": String(fileSize),
          },
        }
      );

      const uploadUrl = initResp.headers.location;
      if (!uploadUrl) throw new Error("YouTube upload session URL not returned");

      // Upload the file buffer directly
      const uploadResp = await axios.put(uploadUrl, file.buffer, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": contentType,
          "Content-Length": String(fileSize),
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      });

      const youtubeVideoId = uploadResp.data?.id;
      if (!youtubeVideoId) throw new Error("YouTube upload succeeded but no video ID returned");

      // Wait for video to be processed
      await this._waitForYouTubeVideo(accessToken, youtubeVideoId);


      logger.info(`uploadVideoAPI: uploaded videoId=${youtubeVideoId} for user=${userId}`);
      return res.status(201).json({
        status: true,
        youtubeVideoId,
        youtubeUrl: `https://www.youtube.com/watch?v=${youtubeVideoId}`,
      });
    } catch (error) {
      logger.error(`GOOGLE UPLOAD VIDEO ERROR => ${error.message}`);
      return res.status(500).json({ status: false, error: error.message || "Failed to upload video to YouTube" });
    }
  }

  // ─── Private helpers ─────────────────────────────────────────────────────────

  async _createCampaign(accessToken, loginCustomerId, customerId, name, objective, dailyBudgetMicros) {
    const channelTypeMap = {
      SALES: "SEARCH", LEADS: "SEARCH", WEBSITE_TRAFFIC: "SEARCH", SEARCH: "SEARCH",
      DISPLAY: "DISPLAY", VIDEO: "DEMAND_GEN", YOUTUBE_REACH: "DEMAND_GEN", DEMAND_GEN: "DEMAND_GEN",
      SHOPPING: "SHOPPING", PERFORMANCE_MAX: "PERFORMANCE_MAX",
    };
    const channelType = channelTypeMap[(objective || "SEARCH").toUpperCase()] || "SEARCH";

    const headers = {
      Authorization: `Bearer ${accessToken}`,
      "developer-token": process.env.GOOGLE_DEVELOPER_TOKEN,
      "login-customer-id": loginCustomerId,
      "Content-Type": "application/json",
    };

    const budgetResp = await axios.post(
      `https://googleads.googleapis.com/v23/customers/${customerId}/googleAds:mutate`,
      {
        mutateOperations: [{
          campaignBudgetOperation: {
            create: {
              name: `${name} Budget`,
              amountMicros: String(dailyBudgetMicros),
              deliveryMethod: "STANDARD",
              explicitlyShared: false,
            },
          },
        }],
      },
      { headers }
    );
    const budgetResource = budgetResp.data?.mutateOperationResponses?.[0]?.campaignBudgetResult?.resourceName;

    const biddingField = channelType === "DISPLAY" ? { targetSpend: {} }
      : channelType === "DEMAND_GEN" ? { maximizeConversions: {} }
      : channelType === "PERFORMANCE_MAX" ? { maximizeConversionValue: {} }
      : { manualCpc: { enhancedCpcEnabled: false } };

    const campResp = await axios.post(
      `https://googleads.googleapis.com/v23/customers/${customerId}/googleAds:mutate`,
      {
        mutateOperations: [{
          campaignOperation: {
            create: {
              name, status: "PAUSED",
              advertisingChannelType: channelType,
              campaignBudget: budgetResource,
              containsEuPoliticalAdvertising: 'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING',
              ...biddingField,
            },
          },
        }],
      },
      { headers }
    );

    const campaignId = campResp.data?.mutateOperationResponses?.[0]?.campaignResult?.resourceName?.split("/").pop();
    return { campaignId };
  }

  async _createAdGroup(accessToken, loginCustomerId, customerId, campaignId, name, cpcBidMicros) {
    const resp = await axios.post(
      `https://googleads.googleapis.com/v23/customers/${customerId}/googleAds:mutate`,
      {
        mutateOperations: [{
          adGroupOperation: {
            create: {
              name, status: "PAUSED",
              type: "SEARCH_STANDARD",
              cpcBidMicros: String(cpcBidMicros),
              campaign: `customers/${customerId}/campaigns/${campaignId}`,
            },
          },
        }],
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "developer-token": process.env.GOOGLE_DEVELOPER_TOKEN,
          "login-customer-id": loginCustomerId,
          "Content-Type": "application/json",
        },
      }
    );
    const adGroupId = resp.data?.mutateOperationResponses?.[0]?.adGroupResult?.resourceName?.split("/").pop();
    return { adGroupId };
  }

  async _createAdByType(accessToken, loginCustomerId, customerId, adGroupId, adData, objective) {
    const { headlines = [], descriptions = [], finalUrl, callToAction, imageUrl } = adData;

    const padHeadlines = (arr) => {
      const fallbacks = ["Discover More", "Shop Now", "Learn More", "Get Started", "Try Today"];
      const result = [...arr];
      let i = 0;
      while (result.length < 3) result.push(fallbacks[i++] || `Headline ${result.length + 1}`);
      return result.slice(0, 15).map((text) => ({ text: String(text) }));
    };
    const padDescriptions = (arr) => {
      const fallbacks = ["Experience the best service.", "Trusted by thousands worldwide."];
      const result = [...arr];
      let i = 0;
      while (result.length < 2) result.push(fallbacks[i++] || `Description ${result.length + 1}`);
      return result.slice(0, 4).map((text) => ({ text: String(text) }));
    };

    const hl = padHeadlines(Array.isArray(headlines) ? headlines : [headlines]);
    const dl = padDescriptions(Array.isArray(descriptions) ? descriptions : [descriptions]);

    let assetResourceName = null;
    if (objective === "DISPLAY" && imageUrl) {
      assetResourceName = await this._uploadImageFromUrl(accessToken, loginCustomerId, customerId, imageUrl);
    }

    let adPayload;
    if (objective === "DISPLAY") {
      const { GOOGLE_CTA_LABELS: _CTA_LABELS } = require("../../config/googleCtaConfig");
      const _enumKey = callToAction ? String(callToAction).toUpperCase().replace(/ /g, "_") : null;
      const _ctaText = _enumKey ? (_CTA_LABELS[_enumKey] || null) : null;
      adPayload = {
        responsiveDisplayAd: {
          headlines: hl.slice(0, 5),
          descriptions: dl.slice(0, 5),
          longHeadline: { text: String(hl[0]?.text || "Discover More") },
          businessName: "Brand",
          ...(_ctaText && { callToActionText: _ctaText }),
          ...(assetResourceName && { marketingImages: [{ asset: assetResourceName }] }),
        },
        finalUrls: [finalUrl],
      };
    } else {
      adPayload = {
        responsiveSearchAd: {
          headlines: hl,
          descriptions: dl,
        },
        finalUrls: [finalUrl],
      };
    }

    const resp = await axios.post(
      `https://googleads.googleapis.com/v23/customers/${customerId}/googleAds:mutate`,
      {
        mutateOperations: [{
          adGroupAdOperation: {
            create: {
              adGroup: `customers/${customerId}/adGroups/${adGroupId}`,
              status: "PAUSED",
              ad: adPayload,
            },
          },
        }],
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "developer-token": process.env.GOOGLE_DEVELOPER_TOKEN,
          "login-customer-id": loginCustomerId,
          "Content-Type": "application/json",
        },
      }
    );

    const adId = resp.data?.mutateOperationResponses?.[0]?.adGroupAdResult?.resourceName?.split("~").pop();
    return adId;
  }

  // Download a video from URL and upload it to YouTube — returns the YouTube videoId
  async _uploadVideoToYouTube(accessToken, videoUrl, title = "Ad Video") {
    try {
      // Step 1: Download video into buffer
      const downloaded = await axios.get(videoUrl, { responseType: "arraybuffer", timeout: 180000 });
      const videoBuffer = Buffer.from(downloaded.data);
      const rawContentType = downloaded.headers["content-type"] || "video/mp4";
      // Normalize application/mp4 → video/mp4 (YouTube rejects application/mp4)
      const contentType = rawContentType.replace("application/mp4", "video/mp4").split(";")[0].trim();
      const fileSize = videoBuffer.length;

      // Step 2: Initiate YouTube resumable upload session
      const initResp = await axios.post(
        "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
        {
          snippet: {
            title: String(title).slice(0, 100),
            description: "Ad video uploaded via AdsGPT",
            categoryId: "22",
          },
          status: { privacyStatus: "unlisted" },
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            "X-Upload-Content-Type": contentType,
            "X-Upload-Content-Length": String(fileSize),
          },
        }
      );

      const uploadUrl = initResp.headers.location;
      if (!uploadUrl) throw new Error("YouTube upload session URL not returned");

      // Step 3: Upload the buffered video
      const uploadResp = await axios.put(uploadUrl, videoBuffer, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": contentType,
          "Content-Length": String(fileSize),
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      });

      const videoId = uploadResp.data?.id;
      if (!videoId) throw new Error("YouTube upload succeeded but no video ID returned");

      logger.info(`YouTube video uploaded successfully: videoId=${videoId}`);
      return videoId;
    } catch (e) {
      const detail = e.response?.data ? JSON.stringify(e.response.data) : e.message;
      logger.error(`Failed to upload video to YouTube from URL ${videoUrl}: ${detail}`);

      // youtubeSignupRequired = the Google account has no YouTube channel
      const errors = e.response?.data?.error?.errors || [];
      const isNoChannel = errors.some((err) => err.reason === 'youtubeSignupRequired');
      if (isNoChannel) {
        throw new Error(
          'The connected Google account does not have a YouTube channel. ' +
          'Please visit youtube.com, sign in with the same account, and create a channel before uploading video ads.'
        );
      }

      throw new Error(`Video upload to YouTube failed: ${detail}`);
    }
  }

  // Upload a single image buffer to Google Ads and return its resourceName
  async _uploadSingleImageBuffer(accessToken, loginCustomerId, customerId, imageBuffer, label) {
    const assetResp = await axios.post(
      `https://googleads.googleapis.com/v23/customers/${customerId}/googleAds:mutate`,
      {
        mutateOperations: [{
          assetOperation: {
            create: {
              name: `${label}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
              type: "IMAGE",
              image_asset: { data: imageBuffer.toString("base64") },
            },
          },
        }],
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "developer-token": process.env.GOOGLE_DEVELOPER_TOKEN,
          "login-customer-id": loginCustomerId,
          "Content-Type": "application/json",
        },
      }
    );
    return assetResp.data?.mutateOperationResponses?.[0]?.assetResult?.resourceName || null;
  }

  // Download imageUrl and upload two variants:
  //   landscape → marketingImages     (min 600×314, ratio 1.91:1)
  //   square    → squareMarketingImages (min 300×300, ratio 1:1)
  // Returns { landscape, square } resource names.
  // Poll YouTube until the video status is not "uploaded" (i.e. processing done or failed)
  async _waitForYouTubeVideo(accessToken, videoId, maxWaitMs = 120000) {
    const interval = 3000;
    const deadline = Date.now() + maxWaitMs;
    while (Date.now() < deadline) {
      try {
        const resp = await axios.get(
          `https://www.googleapis.com/youtube/v3/videos?part=status&id=${videoId}`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        const uploadStatus = resp.data?.items?.[0]?.status?.uploadStatus;
        logger.info(`YouTube video ${videoId} uploadStatus=${uploadStatus}`);
        if (uploadStatus && uploadStatus !== "uploaded") break;
      } catch (e) {
        logger.error(`YouTube status poll failed for ${videoId}: ${e.message}`);
        break;
      }
      await new Promise((r) => setTimeout(r, interval));
    }
  }

  async _createPmaxAssetGroup(req, res, {
    accessToken, mccId, customerId, cleanCampaignId,
    name, status,
    assetGroupName, pmaxFinalUrl, businessDescription, pmaxBusinessName,
    pmaxHeadlines, pmaxLongHeadline, pmaxDescriptions,
    pmaxImageUrl, pmaxImageAssetRN, pmaxSquareImageAssetRN,
    pmaxLogoUrl, pmaxLogoAssetRN, pmaxVideoUrl,
  }) {
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      "developer-token": process.env.GOOGLE_DEVELOPER_TOKEN,
      "login-customer-id": mccId,
      "Content-Type": "application/json",
    };
    const campaignResource = `customers/${customerId}/campaigns/${cleanCampaignId}`;
    const agName = String(assetGroupName || name).slice(0, 128);

    const dedup = (arr) => {
      const seen = new Set();
      return (arr || []).filter(Boolean).filter((t) => {
        const k = String(t).trim().toLowerCase();
        if (seen.has(k)) return false;
        seen.add(k); return true;
      });
    };
    const rawHeadlines    = (pmaxHeadlines    || []).filter(Boolean);
    const rawDescriptions = (pmaxDescriptions || []).filter(Boolean);
    const headlines    = dedup(rawHeadlines.length >= 3 ? rawHeadlines : ["Shop Now", "Get Started", "Learn More", ...rawHeadlines]).slice(0, 5);
    let descriptions   = dedup(rawDescriptions.length   ? rawDescriptions : [
      businessDescription ? String(businessDescription).slice(0, 90) : "Trusted by thousands. Get started today.",
      "Shop the best deals online.",
    ]).slice(0, 4);
    // Google requires at least 2 descriptions
    if (descriptions.length < 2) {
      const fallbacks = ["Trusted by thousands. Get started today.", "Shop the best deals online.", "Discover amazing offers today."];
      for (const fb of fallbacks) {
        if (descriptions.length >= 2) break;
        if (!descriptions.includes(fb)) descriptions.push(fb);
      }
    }
    const accountBusinessName = String(pmaxBusinessName || agName || "Brand").slice(0, 25);


    // Helper: fetch image URL from a Google Ads asset RN (works for any customer this token has access to)
    const fetchAssetImageUrl = async (rn) => {
      if (!rn) return null;
      const match = rn.match(/^customers\/(\d+)\//);
      if (!match) return null;
      const cid = match[1];
      // Try both the target MCC and the source customer as login-customer-id
      const loginIds = [mccId, cid];
      for (const lid of loginIds) {
        try {
          const resp = await axios.post(
            `https://googleads.googleapis.com/v23/customers/${cid}/googleAds:searchStream`,
            { query: `SELECT asset.image_asset.full_size.url FROM asset WHERE asset.resource_name = '${rn}' LIMIT 1` },
            { headers: { Authorization: `Bearer ${accessToken}`, "developer-token": process.env.GOOGLE_DEVELOPER_TOKEN, "login-customer-id": lid, "Content-Type": "application/json" } }
          );
          const url = resp.data?.[0]?.results?.[0]?.asset?.imageAsset?.fullSize?.url
            || resp.data?.[0]?.results?.[0]?.asset?.image_asset?.full_size?.url;
          if (url) { logger.info(`PMAX: fetched asset URL from ${cid} (login=${lid}): ${url}`); return url; }
        } catch (_) {}
      }
      logger.warn(`PMAX: could not fetch image URL for ${rn}`);
      return null;
    };

    // Resolve image assets — if RN belongs to a different customer, fetch its URL and re-upload
    let imageAssetRN = null;
    let squareImageAssetRN = null;
    const imgMatch = pmaxImageAssetRN?.match(/^customers\/(\d+)\//);
    if (imgMatch && imgMatch[1] === String(customerId)) {
      // Same account — use as-is
      imageAssetRN = pmaxImageAssetRN;
      const sqMatch = pmaxSquareImageAssetRN?.match(/^customers\/(\d+)\//);
      squareImageAssetRN = (sqMatch && sqMatch[1] === String(customerId)) ? pmaxSquareImageAssetRN : null;
    } else if (pmaxImageAssetRN) {
      // Different account — fetch image URL and re-upload to target account
      try {
        const imageUrl = await fetchAssetImageUrl(pmaxImageAssetRN);
        if (imageUrl) {
          logger.info(`PMAX: re-uploading image from source account to ${customerId}`);
          const r = await this._uploadImageFromUrl(accessToken, mccId, customerId, imageUrl);
          imageAssetRN = r?.landscape || null;
          squareImageAssetRN = r?.square || null;
        }
      } catch (e) { logger.warn(`PMAX: cross-account image copy failed: ${e.message}`); }
    }
    if (!imageAssetRN && pmaxImageUrl) {
      try {
        const r = await this._uploadImageFromUrl(accessToken, mccId, customerId, pmaxImageUrl);
        imageAssetRN       = r?.landscape || null;
        squareImageAssetRN = squareImageAssetRN || r?.square || null;
      } catch (e) { logger.warn(`PMAX image upload failed: ${e.message}`); }
    }
    let logoAssetRN = null;
    if (pmaxLogoAssetRN) {
      const lMatch = pmaxLogoAssetRN.match(/^customers\/(\d+)\//);
      if (lMatch && lMatch[1] === String(customerId)) {
        logoAssetRN = pmaxLogoAssetRN;
      } else {
        try {
          const logoUrl = await fetchAssetImageUrl(pmaxLogoAssetRN);
          if (logoUrl) {
            const r = await this._uploadImageFromUrl(accessToken, mccId, customerId, logoUrl);
            logoAssetRN = r?.square || r?.landscape || null;
          }
        } catch (e) { logger.warn(`PMAX: cross-account logo copy failed: ${e.message}`); }
      }
    }
    if (!logoAssetRN && pmaxLogoUrl) {
      try {
        const r = await this._uploadImageFromUrl(accessToken, mccId, customerId, pmaxLogoUrl);
        logoAssetRN = r?.square || r?.landscape || null;
      } catch (e) { logger.warn(`PMAX logo upload failed: ${e.message}`); }
    }
    // Auto-use the square image as logo if no dedicated logo was provided.
    // Google allows the same asset resource name for both SQUARE_MARKETING_IMAGE and LOGO.
    if (!logoAssetRN && squareImageAssetRN) logoAssetRN = squareImageAssetRN;

    // Resolve YouTube video asset
    let videoAssetRN = null;
    if (pmaxVideoUrl) {
      try {
        const ytMatch = pmaxVideoUrl.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
        const ytId = ytMatch ? ytMatch[1] : (pmaxVideoUrl.length === 11 ? pmaxVideoUrl : null);
        if (ytId) {
          const existingResp = await axios.post(
            `https://googleads.googleapis.com/v23/customers/${customerId}/googleAds:searchStream`,
            { query: `SELECT asset.resource_name FROM asset WHERE asset.youtube_video_asset.youtube_video_id = '${ytId}' LIMIT 1` },
            { headers }
          );
          videoAssetRN = existingResp.data?.[0]?.results?.[0]?.asset?.resourceName || null;
          if (!videoAssetRN) {
            const assetResp = await axios.post(
              `https://googleads.googleapis.com/v23/customers/${customerId}/googleAds:mutate`,
              { mutateOperations: [{ assetOperation: { create: { name: `yt_${ytId}_${Date.now()}`, youtube_video_asset: { youtube_video_id: ytId } } } }] },
              { headers }
            );
            videoAssetRN = assetResp.data?.mutateOperationResponses?.[0]?.assetResult?.resourceName || null;
          }
        }
      } catch (e) { logger.warn(`PMAX video asset failed: ${e.message}`); }
    }

    // Google requires at least one marketing image, square image, and logo
    if (!imageAssetRN || !squareImageAssetRN || !logoAssetRN) {
      logger.warn(`_createPmaxAssetGroup: missing assets — imageRN=${imageAssetRN} squareRN=${squareImageAssetRN} logoRN=${logoAssetRN} — proceeding without them (Google will validate)`);
    }

    try {
      logger.info(`_createPmaxAssetGroup: agName="${agName}" headlines=${headlines.length} descriptions=${descriptions.length} imageRN=${imageAssetRN} squareRN=${squareImageAssetRN} logoRN=${logoAssetRN}`);

      // Step 1: Create text assets
      // Google requires at least 1 LONG_HEADLINE — fall back to first headline if not provided
      const resolvedLongHeadline = (pmaxLongHeadline || headlines[0] || "").slice(0, 90);
      const textAssetDefs = [
        ...headlines.map((text) => ({ text: String(text).slice(0, 30), fieldType: "HEADLINE" })),
        { text: resolvedLongHeadline, fieldType: "LONG_HEADLINE" },
        ...descriptions.map((text) => ({ text: String(text).slice(0, 90), fieldType: "DESCRIPTION" })),
        { text: accountBusinessName, fieldType: "BUSINESS_NAME" },
      ];
      const textAssetResp = await axios.post(
        `https://googleads.googleapis.com/v23/customers/${customerId}/googleAds:mutate`,
        {
          mutateOperations: textAssetDefs.map((def, i) => ({
            assetOperation: { create: { text_asset: { text: def.text } } },
          })),
        },
        { headers }
      );
      const textAssetRNs = (textAssetResp.data?.mutateOperationResponses || []).map((r) => r?.assetResult?.resourceName);
      logger.info(`_createPmaxAssetGroup: text assets created ${textAssetRNs.filter(Boolean).length}/${textAssetDefs.length}`);

      // Step 2: Create asset group + link all assets in one mutate
      const agTempRN = `customers/${customerId}/assetGroups/-1`;
      const agResp = await axios.post(
        `https://googleads.googleapis.com/v23/customers/${customerId}/googleAds:mutate`,
        {
          mutateOperations: [
            {
              assetGroupOperation: {
                create: {
                  resource_name: agTempRN,
                  campaign: campaignResource,
                  name: agName,
                  status: status || "PAUSED",
                  ...(pmaxFinalUrl ? { final_urls: [pmaxFinalUrl] } : {}),
                },
              },
            },
            ...textAssetRNs.map((rn, i) => rn ? ({
              assetGroupAssetOperation: { create: { asset_group: agTempRN, asset: rn, field_type: textAssetDefs[i].fieldType } },
            }) : null).filter(Boolean),
            ...(imageAssetRN       ? [{ assetGroupAssetOperation: { create: { asset_group: agTempRN, asset: imageAssetRN,       field_type: "MARKETING_IMAGE"        } } }] : []),
            ...(squareImageAssetRN ? [{ assetGroupAssetOperation: { create: { asset_group: agTempRN, asset: squareImageAssetRN, field_type: "SQUARE_MARKETING_IMAGE"  } } }] : []),
            ...(logoAssetRN        ? [{ assetGroupAssetOperation: { create: { asset_group: agTempRN, asset: logoAssetRN,        field_type: "LOGO"                    } } }] : []),
            ...(videoAssetRN       ? [{ assetGroupAssetOperation: { create: { asset_group: agTempRN, asset: videoAssetRN,       field_type: "YOUTUBE_VIDEO"           } } }] : []),
          ],
        },
        { headers }
      );
      const createdAgRN = agResp.data?.mutateOperationResponses?.[0]?.assetGroupResult?.resourceName;
      const assetGroupId = createdAgRN?.split("/").pop();
      logger.info(`_createPmaxAssetGroup: asset group created ${agName} → ${createdAgRN}`);

      return res.status(201).json({
        status: true,
        message: "Asset group created successfully",
        adGroup: { adGroupId: assetGroupId, name: agName, type: "ASSET_GROUP", resourceName: createdAgRN },
      });
    } catch (e) {
      const detail = e.response?.data ? JSON.stringify(e.response.data) : e.message;
      logger.error(`_createPmaxAssetGroup failed: ${detail}`);
      return res.status(e.response?.status || 500).json({
        status: false,
        error: parseGoogleError(e, "Failed to create asset group"),
      });
    }
  }

  async _uploadImageFromUrl(accessToken, loginCustomerId, customerId, imageUrl) {
    try {
      const sharp = require("sharp");
      const downloaded = await axios.get(imageUrl, { responseType: "arraybuffer", timeout: 15000 });
      const rawBuffer = Buffer.from(downloaded.data);

      // Decode original dimensions
      const meta = await sharp(rawBuffer).metadata();
      const origW = meta.width || 1200;
      const origH = meta.height || 628;

      // ── Landscape variant (1.91:1) ──────────────────────────────────────────
      // Target: 1200×628. Crop to 1.91:1 from center then resize.
      const landscapeW = 1200;
      const landscapeH = 628;
      const landscapeBuffer = await sharp(rawBuffer)
        .resize({
          width: landscapeW,
          height: landscapeH,
          fit: "cover",
          position: "centre",
        })
        .jpeg({ quality: 90 })
        .toBuffer();

      // ── Square variant (1:1) ────────────────────────────────────────────────
      // Target: 1200×1200. Crop to 1:1 from center then resize.
      const squareSize = 1200;
      const squareBuffer = await sharp(rawBuffer)
        .resize({
          width: squareSize,
          height: squareSize,
          fit: "cover",
          position: "centre",
        })
        .jpeg({ quality: 90 })
        .toBuffer();

      const [landscape, square] = await Promise.all([
        this._uploadSingleImageBuffer(accessToken, loginCustomerId, customerId, landscapeBuffer, "img_land"),
        this._uploadSingleImageBuffer(accessToken, loginCustomerId, customerId, squareBuffer, "img_sq"),
      ]);

      return { landscape, square };
    } catch (e) {
      logger.error(`Failed to upload image from URL ${imageUrl}: ${e.message}`);
      return null;
    }
  }
  // * GET /v2/wizard-schema
  // Returns the full Google Ads wizard schema: objectives list, CTA map per
  // objective, ad-type mapping. Frontend uses this on mount — nothing is
  // hardcoded in the wizard component.
  async getWizardSchema(req, res) {
    try {
      const { GOOGLE_OBJECTIVES, GOOGLE_CTA_MAP, GOOGLE_CTA_LABELS } = require("../../config/googleCtaConfig");
      const {
        WIZARD_OBJECTIVE_KEYS,
        OBJECTIVE_DESTINATIONS,
        OBJECTIVE_GOALS,
        GOAL_DESTINATIONS,
        getDestinationsForObjective,
        getGoalsForObjective,
      } = require("../../config/googleWizardDestinations");

      const OBJECTIVE_DESCRIPTIONS = {
        SALES:           "Drive conversions and purchases",
        LEADS:           "Collect leads for your business",
        WEBSITE_TRAFFIC: "Bring more visitors to your site",
        DISPLAY:         "Visually engaging banner ads",
        YOUTUBE_REACH:   "Drive awareness and consideration of your product or brand",
        APP_PROMOTION:   "Get more installs, engagement and pre-registration for your app",
        LOCAL_STORE:     "Drive visits to local shops, including restaurants and dealerships",
        PERFORMANCE_MAX: "AI-driven multi-channel campaigns",
        SEARCH:          "Drive action on Google Search with text ads",
        DEMAND_GEN:      "Drive demand and conversions on YouTube, Google Display Network and more",
        SHOPPING:        "Promote your products from Merchant Center on Google Search with Shopping ads",
        VIDEO:           "Drive action on YouTube with your video ads",
      };

      const AD_TYPE_MAP = {
        SALES:           "SEARCH",
        LEADS:           "SEARCH",
        WEBSITE_TRAFFIC: "SEARCH",
        LOCAL_STORE:     "SEARCH",
        SEARCH:          "SEARCH",
        PERFORMANCE_MAX: "PERFORMANCE_MAX",
        DISPLAY:         "DISPLAY",
        YOUTUBE_REACH:   "DEMAND_GEN",
        APP_PROMOTION:   "MULTI_CHANNEL",
        VIDEO:           "DEMAND_GEN",
        DEMAND_GEN:      "DEMAND_GEN",
        SHOPPING:        "SHOPPING",
        MULTI_CHANNEL:   "MULTI_CHANNEL",
      };

      const objectives = WIZARD_OBJECTIVE_KEYS.map((value) => ({
        value,
        label: GOOGLE_OBJECTIVES[value] || value,
        description: OBJECTIVE_DESCRIPTIONS[value] || "",
        adType: AD_TYPE_MAP[value] || "SEARCH",
        destinations: getDestinationsForObjective(value),
        goals: getGoalsForObjective(value),
        ctas: (GOOGLE_CTA_MAP[value] || []).map((v) => ({ value: v, label: GOOGLE_CTA_LABELS[v] || v })),
      }));

      // Flat map of objective → goals for quick lookup on the frontend
      const objectiveGoals = Object.fromEntries(
        WIZARD_OBJECTIVE_KEYS.map((k) => [k, getGoalsForObjective(k)])
      );

      const COUNTRY_OPTIONS = [
        // Worldwide — no geo restriction
        { code: "WW", label: "Worldwide" },
        // Top markets
        { code: "US", label: "United States" },
        { code: "IN", label: "India" },
        { code: "GB", label: "United Kingdom" },
        { code: "CA", label: "Canada" },
        { code: "AU", label: "Australia" },
        { code: "DE", label: "Germany" },
        { code: "FR", label: "France" },
        { code: "JP", label: "Japan" },
        { code: "BR", label: "Brazil" },
        { code: "SG", label: "Singapore" },
        { code: "AE", label: "UAE" },
        { code: "SA", label: "Saudi Arabia" },
        { code: "ZA", label: "South Africa" },
        { code: "NG", label: "Nigeria" },
        { code: "MX", label: "Mexico" },
        { code: "ID", label: "Indonesia" },
        { code: "PK", label: "Pakistan" },
        { code: "PH", label: "Philippines" },
        { code: "VN", label: "Vietnam" },
        { code: "TR", label: "Turkey" },
        { code: "IT", label: "Italy" },
        { code: "ES", label: "Spain" },
        { code: "NL", label: "Netherlands" },
        { code: "SE", label: "Sweden" },
        { code: "NO", label: "Norway" },
        { code: "DK", label: "Denmark" },
        { code: "PL", label: "Poland" },
        { code: "RU", label: "Russia" },
        { code: "KR", label: "South Korea" },
        { code: "TH", label: "Thailand" },
        { code: "MY", label: "Malaysia" },
        { code: "BD", label: "Bangladesh" },
        { code: "EG", label: "Egypt" },
        { code: "KE", label: "Kenya" },
        { code: "AR", label: "Argentina" },
        { code: "CO", label: "Colombia" },
        { code: "NZ", label: "New Zealand" },
        { code: "CH", label: "Switzerland" },
      ];

      const GENDER_OPTIONS = [
        { value: "MALE",        label: "Male" },
        { value: "FEMALE",      label: "Female" },
        { value: "UNDETERMINED", label: "Unknown" },
      ];

      const STATUS_OPTIONS = [
        { value: "PAUSED",  label: "Paused (recommended)" },
        { value: "ENABLED", label: "Enabled" },
      ];

      const BIDDING_GOAL_OPTIONS = [
        { value: "MAXIMIZE_CLICKS",       label: "Maximize clicks" },
        { value: "MAXIMIZE_CONVERSIONS",  label: "Maximize conversions" },
        { value: "TARGET_CPA",            label: "Target CPA (₹ per conversion)" },
        { value: "TARGET_ROAS",           label: "Target ROAS (% return)" },
      ];

      const KEYWORD_MATCH_TYPES = [
        { value: "BROAD",  label: "Broad" },
        { value: "PHRASE", label: "Phrase" },
        { value: "EXACT",  label: "Exact" },
      ];

      const VIDEO_FORMAT_OPTIONS = [
        { value: "SKIPPABLE_IN_STREAM",     label: "Skippable in-stream",     desc: "Viewers can skip after 5s. Best for reach." },
        { value: "NON_SKIPPABLE_IN_STREAM", label: "Non-skippable in-stream", desc: "Max 15s. Ensures full message delivery." },
        { value: "BUMPER",                  label: "Bumper",                  desc: "6-second non-skippable. Best for brand awareness." },
      ];

      const APP_PLATFORM_OPTIONS = [
        { value: "ANDROID", label: "Android" },
        { value: "IOS",     label: "iOS" },
      ];

      // App campaign subtypes (screenshot 1)
      const APP_SUBTYPE_OPTIONS = [
        { value: "APP_INSTALLS",          label: "App installs",          desc: "Get new people to install your app" },
        { value: "APP_ENGAGEMENT",        label: "App engagement",        desc: "Get existing users to take actions in your app (Minimum 50K installs required)" },
        { value: "APP_PRE_REGISTRATION",  label: "App pre-registration",  desc: "Get new users to pre-register for your app before launch (Android only)" },
      ];

      // Video campaign goals (screenshot 2 — YouTube reach objective)
      const VIDEO_GOAL_OPTIONS = [
        { value: "VIDEO_VIEWS",               label: "Video views",                  desc: "Get people to watch your video ads" },
        { value: "REACH",                     label: "Reach",                        desc: "Reach the maximum number of people" },
        { value: "YOUTUBE_SUBSCRIPTIONS",     label: "YouTube subscriptions and engagements", desc: "Get people to subscribe and engage with your YouTube channel" },
      ];

      // Video campaign subtypes / formats (screenshot 3 — create without guidance → Video)
      const VIDEO_SUBTYPE_OPTIONS = [
        { value: "VIDEO_VIEWS",               label: "Video views",            desc: "Get TrueView views and engagement from people who are more likely to consider your products or brand. You only pay when someone chooses to watch your ad." },
        { value: "EFFICIENT_REACH",           label: "Efficient reach",        desc: "Get the most reach for your budget using bumper, skippable in-stream, in-feed and Shorts ads." },
        { value: "NON_SKIPPABLE_REACH",       label: "Non-skippable reach",    desc: "Reach people using bumper, standard non-skippable and 30-second non-skippable in-stream ads." },
        { value: "TARGET_FREQUENCY",          label: "Target frequency",       desc: "Reach the same people multiple times using skippable in-stream, non-skippable in-stream, in-feed and Shorts ads." },
      ];

      // Which objectives require extra fields
      const OBJECTIVE_EXTRAS = {
        APP_PROMOTION:   { requiresAppSubtype: true, requiresAppPlatform: true, requiresAppId: true },
        YOUTUBE_REACH:   { requiresVideoGoal: true },
        VIDEO:           { requiresVideoSubtype: true },
        DEMAND_GEN:      { requiresVideoSubtype: true },
        SHOPPING:        { requiresMerchantCenterId: true },
        PERFORMANCE_MAX: { requiresFinalUrl: true },
      };

      const destinations = Object.keys(OBJECTIVE_DESTINATIONS)
        .flatMap((obj) => getDestinationsForObjective(obj))
        .filter((d, i, arr) => arr.findIndex((x) => x.value === d.value) === i);

      return res.json({
        status: true,
        schema: {
          objectives,
          destinations,
          objectiveDestinations: OBJECTIVE_DESTINATIONS,
          objectiveGoals,
          goalDestinations: GOAL_DESTINATIONS,
          adTypeMap: AD_TYPE_MAP,
          ctaMap: Object.fromEntries(
            Object.entries(GOOGLE_CTA_MAP).map(([obj, ctas]) => [
              obj,
              ctas.map((v) => ({ value: v, label: GOOGLE_CTA_LABELS[v] || v })),
            ])
          ),
          countryOptions:      COUNTRY_OPTIONS,
          genderOptions:       GENDER_OPTIONS,
          statusOptions:       STATUS_OPTIONS,
          biddingGoalOptions:  BIDDING_GOAL_OPTIONS,
          keywordMatchTypes:   KEYWORD_MATCH_TYPES,
          videoFormatOptions:  VIDEO_FORMAT_OPTIONS,
          appPlatformOptions:  APP_PLATFORM_OPTIONS,
          appSubtypeOptions:   APP_SUBTYPE_OPTIONS,
          videoGoalOptions:    VIDEO_GOAL_OPTIONS,
          videoSubtypeOptions: VIDEO_SUBTYPE_OPTIONS,
          objectiveExtras:     OBJECTIVE_EXTRAS,
        },
      });
    } catch (error) {
      logger.error(`Google getWizardSchema error: ${error.message}`);
      return res.status(500).json({ status: false, error: "Failed to load wizard schema" });
    }
  }

  // * GET /cta-options?objective=SEARCH
  async getCtaOptions(req, res) {
    /* #swagger.tags = ['Google Ads']
       #swagger.summary = 'Get CTA options by objective'
       #swagger.description = 'Returns allowed call-to-action values for a given Google Ads campaign objective. Pass the objective as a query param.'
       #swagger.security = [{ "BearerAuth": [] }]
       #swagger.parameters['objective'] = {
         in: 'query',
         required: true,
         type: 'string',
         description: 'Google Ads campaign objective',
         enum: ['SALES', 'LEADS', 'WEBSITE_TRAFFIC', 'APP_PROMOTION', 'LOCAL_STORE', 'SEARCH', 'DISPLAY', 'PERFORMANCE_MAX', 'SHOPPING', 'MULTI_CHANNEL'],
         example: 'SALES'
       }
       #swagger.responses[200] = {
         description: 'List of allowed CTAs for the given objective',
         schema: {
           type: 'object',
           properties: {
             success: { type: 'boolean', example: true },
             objective: { type: 'string', example: 'SALES' },
             data: {
               type: 'array',
               items: {
                 type: 'object',
                 properties: {
                   value: { type: 'string', example: 'SHOP_NOW' },
                   label: { type: 'string', example: 'Shop now' }
                 }
               }
             }
           }
         }
       }
       #swagger.responses[400] = { description: 'Missing or unknown objective' }
    */
    const objective = String(req.query.objective || "").toUpperCase().replace(/ /g, "_");

    if (!objective) {
      return res.status(400).json({ status: false, error: "objective query param is required" });
    }

    const ctas = getGoogleCtas(objective);
    if (!ctas) {
      return res.status(400).json({ success: false, error: `Unknown objective "${objective}". Valid values: ${Object.keys(GOOGLE_CTA_MAP).join(", ")}` });
    }

    return res.json({ success: true, objective, data: ctas });
  }
}

module.exports = new GoogleAdController();
module.exports.invalidateAllUserGoogleCache = invalidateAllUserGoogleCache;
