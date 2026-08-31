const axios = require("axios");
const { HttpsProxyAgent } = require("https-proxy-agent");
const { redisClient } = require("../db/redis");
const TiktokUsers = require("../Module/adPosting/tiktokUsers");
const { decrypt } = require("./crypto");
const logger = require("./logger");

// Production: https://business-api.tiktok.com/open_api/v1.3
// Sandbox:    https://sandbox-ads.tiktok.com/open_api/v1.3
// Switch environments by setting TIKTOK_API_BASE in .env (sandbox tokens ONLY
// work against the sandbox domain, and vice-versa).
const TIKTOK_API_BASE =
  process.env.TIKTOK_API_BASE || "https://business-api.tiktok.com/open_api/v1.3";
const REDIS_TTL = 7200;

// If TIKTOK_PROXY_URL is set (e.g. Bright Data ISP proxy to bypass regional
// blocks), all TikTok API calls are routed through it.
// Format: http://username:password@host:port
// Example .env value:
//   TIKTOK_PROXY_URL=http://brd-customer-xxx:password@brd.superproxy.io:3335
let _proxyAgent = null;
function getTiktokProxyAgent() {
  if (!process.env.TIKTOK_PROXY_URL) return null;
  if (!_proxyAgent) {
    _proxyAgent = new HttpsProxyAgent(process.env.TIKTOK_PROXY_URL, {
      rejectUnauthorized: false,
    });
  }
  return _proxyAgent;
}


// Cache key prefixes. Used for reads; invalidated on writes / disconnect.
// NOTE: "tiktokAds" + "tiktokInsights" are included here because creating a
// campaign/ad group/ad or toggling status changes both the ad listings and
// the reporting numbers — so a write must bust them too.
const STATUS_CACHE_PREFIXES = [
  "tiktokCampaigns",
  "tiktokAdGroups",
  "tiktokAds",
  "tiktokCampaignAds",
  "tiktokAdGroupAds",
  "tiktokDashboard",
  "tiktokInsights",
];

const ALL_CACHE_PREFIXES = [
  ...STATUS_CACHE_PREFIXES,
  "tiktokAnalytics",
  "tiktokAudit",
  "tiktokAdAccounts",
  "tiktokIdentities",
  "tiktokRegions",
  "tiktokInterests",
];

async function invalidateTiktokCacheByPrefixes(userId, prefixes) {
  const keysToDelete = [];
  for (const prefix of prefixes) {
    const stream = redisClient.scanStream({
      match: `${prefix}:${userId}:*`,
      count: 100,
    });
    for await (const keys of stream) {
      if (keys.length) keysToDelete.push(...keys);
    }
    keysToDelete.push(`${prefix}:${userId}`);
  }
  if (keysToDelete.length) {
    await redisClient.del(...keysToDelete);
  }
}

async function invalidateUserTiktokCache(userId) {
  return invalidateTiktokCacheByPrefixes(userId, STATUS_CACHE_PREFIXES);
}

async function invalidateAllUserTiktokCache(userId) {
  return invalidateTiktokCacheByPrefixes(userId, ALL_CACHE_PREFIXES);
}

/**
 * Get a valid access token for a user, refreshing if close to expiry.
 * TikTok refresh tokens are long-lived (~1 year). If refresh fails,
 * the stored access token is still returned so callers can attempt the
 * request and surface a proper re-auth prompt on 40101 errors.
 */
async function getValidAccessToken(userId) {
  const user = await TiktokUsers.findOne({ userId, isActive: true });
  if (!user) {
    const err = new Error("TikTok account not connected");
    err.code = "TIKTOK_NOT_CONNECTED";
    throw err;
  }

  const accessToken = decrypt(user.accessToken);
  const refreshToken = user.refreshToken ? decrypt(user.refreshToken) : "";

  const needsRefresh =
    !user.tokenExpiresAt ||
    user.tokenExpiresAt < new Date(Date.now() + 5 * 60 * 1000);

  if (needsRefresh && refreshToken) {
    try {
      const agent = getTiktokProxyAgent();
      const res = await axios.post(
        `${TIKTOK_API_BASE}/oauth2/refresh_token/`,
        {
          app_id: user.tiktokAppId,
          secret: process.env.TIKTOK_APP_SECRET,
          refresh_token: refreshToken,
          grant_type: "refresh_token",
        },
        { ...(agent ? { httpsAgent: agent, proxy: false } : {}) }
      );

      const tokenData = res.data?.data;
      if (tokenData?.access_token) {
        const { encrypt } = require("./crypto");
        user.accessToken = encrypt(tokenData.access_token);
        if (tokenData.refresh_token) {
          user.refreshToken = encrypt(tokenData.refresh_token);
        }
        user.tokenExpiresAt = new Date(
          Date.now() + (tokenData.expires_in || 86400) * 1000
        );
        await user.save();
        return tokenData.access_token;
      }
    } catch (error) {
      logger.error(
        `[tiktok] token refresh failed for user ${userId}:`,
        error.response?.data || error.message
      );
      // fall through to return existing token
    }
  }

  return accessToken;
}

/**
 * Low-level TikTok API request helper.
 */
async function tiktokApiRequest({
  method = "GET",
  endpoint,
  accessToken,
  params = null,
  data = null,
}) {
  const url = `${TIKTOK_API_BASE}${endpoint}`;
  const headers = {
    "Access-Token": accessToken,
    "Content-Type": "application/json",
  };

  const agent = getTiktokProxyAgent();
  let response;
  try {
    response = await axios({
      method,
      url,
      headers,
      params,
      data,
      ...(agent ? { httpsAgent: agent, proxy: false } : {}),
    });
  } catch (error) {
    throw formatTiktokError(error);
  }

  // TikTok returns logical errors as HTTP 200 with a non-zero `code` in the
  // body (validation failures, account restrictions, etc.). Those must be
  // treated as errors — otherwise a failed create looks like a success with
  // empty data.
  if (
    response.data &&
    response.data.code !== undefined &&
    response.data.code !== 0
  ) {
    throw formatTiktokError({ response: { status: 400, data: response.data } });
  }

  return response.data;
}

function formatTiktokError(error) {
  const response = error.response?.data;
  const code = response?.code;
  const message = response?.message || error.message;
  const requestId = response?.request_id;

  const formatted = new Error(message);
  formatted.status = error.response?.status || 500;
  formatted.tiktokCode = code;
  formatted.requestId = requestId;
  formatted.raw = response;

  // Common TikTok error codes
  if (code === 40101 || code === 40102) {
    formatted.isAuthError = true;
    formatted.status = 401;
    formatted.userMessage = "TikTok authorization expired. Please reconnect your account.";
  } else if (code === 40001) {
    formatted.status = 400;
    formatted.userMessage = message || "Invalid request parameters.";
  } else if (code === 40301) {
    formatted.status = 403;
    formatted.userMessage = "Permission denied for this TikTok ad account.";
  } else if (code === 42901) {
    formatted.status = 429;
    formatted.userMessage = "TikTok API rate limit exceeded. Please try again shortly.";
  } else {
    formatted.userMessage = message || "TikTok API request failed.";
  }

  // Humanize common raw parameter errors from TikTok API
  if (formatted.userMessage) {
    if (
      formatted.userMessage.toLowerCase().includes("lead generation agreement") ||
      formatted.userMessage.toLowerCase().includes("agreement has not")
    ) {
      formatted.userMessage =
        "TikTok Lead Generation Terms of Service has not been accepted yet. Please log into TikTok Ads Manager and accept the Lead Generation agreement before publishing Lead Gen ads.";
    } else if (formatted.userMessage.includes("special_industries") && formatted.userMessage.includes("POLITICS")) {
      formatted.userMessage = "TikTok does not support 'Politics' under Special Industries. Only Housing, Employment, and Credit are supported.";
    } else if (formatted.userMessage.includes("special_industries") && formatted.userMessage.includes("one or more value of the param is not acceptable")) {
      formatted.userMessage = "Invalid Special Industries selection. TikTok only supports Housing, Employment, and Credit.";
    }
  }

  return formatted;
}

/**
 * Map TikTok entity statuses to a unified UI status.
 */
function mapTiktokStatus(status) {
  const statusMap = {
    // Campaign statuses
    CAMPAIGN_STATUS_ENABLE: "ACTIVE",
    CAMPAIGN_STATUS_DISABLE: "PAUSED",
    CAMPAIGN_STATUS_DELETE: "DELETED",
    CAMPAIGN_STATUS_ALL: "ALL",
    // Ad group statuses
    ADGROUP_STATUS_ENABLE: "ACTIVE",
    ADGROUP_STATUS_DISABLE: "PAUSED",
    ADGROUP_STATUS_DELETE: "DELETED",
    // Ad statuses
    AD_STATUS_ENABLE: "ACTIVE",
    AD_STATUS_DISABLE: "PAUSED",
    AD_STATUS_DELETE: "DELETED",
    // Operation statuses
    ENABLE: "ACTIVE",
    DISABLE: "PAUSED",
    DELETE: "DELETED",
  };
  return statusMap[status] || status;
}

function mapTiktokOperationStatus(uiStatus) {
  const map = {
    ACTIVE: "ENABLE",
    PAUSED: "DISABLE",
    DELETED: "DELETE",
  };
  return map[uiStatus] || uiStatus;
}

/**
 * Format budget for display. TikTok uses minor units.
 */
function formatTiktokBudget(minorAmount, currency = "USD") {
  if (minorAmount === undefined || minorAmount === null) return "-";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(minorAmount / 100);
}

module.exports = {
  TIKTOK_API_BASE,
  REDIS_TTL,
  getTiktokProxyAgent,
  STATUS_CACHE_PREFIXES,
  ALL_CACHE_PREFIXES,
  invalidateUserTiktokCache,
  invalidateAllUserTiktokCache,
  getValidAccessToken,
  tiktokApiRequest,
  formatTiktokError,
  mapTiktokStatus,
  mapTiktokOperationStatus,
  formatTiktokBudget,
};
