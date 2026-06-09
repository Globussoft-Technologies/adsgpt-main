const axios = require("axios");
const dayjs = require("dayjs");
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
  sanitizeId,
} = require("../../utils/googleHelpers");

const normalizeCustomerId = (id) => {
  if (!id) return null;
  return String(id).replace(/-/g, "").trim();
};

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
  "googleAnalytics",
  "googleInsights",
  "googleAudit",
];

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
  };
  return map[ch] || ch || null;
}

async function invalidateGoogleCacheByPrefixes(userId, prefixes) {
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
  if (keysToDelete.length) await redisClient.del(...keysToDelete);
}

async function invalidateUserGoogleCache(userId) {
  return invalidateGoogleCacheByPrefixes(userId, STATUS_CACHE_PREFIXES);
}

async function invalidateAllUserGoogleCache(userId) {
  return invalidateGoogleCacheByPrefixes(userId, ALL_CACHE_PREFIXES);
}

function formatGoogleError(error) {
  const details = error?.errors?.[0] || {};
  const errorCode = details?.errorCode
    ? Object.entries(details.errorCode).find(([, v]) => v != null)
    : null;
  return {
    message:
      details?.message ||
      error?.message ||
      "Unknown Google Ads API error",
    reason: errorCode?.[0] || null,
    details: details?.details || null,
  };
}

function mapGoogleAccountErrorStatus(err) {
  const statusCode = err.response?.status;
  const errorPayload = err.response?.data?.error || {};
  const errorStatus = errorPayload.status || errorPayload.code || "";
  const errorCode = getGoogleAdsErrorReason(err);

  const isRestricted =
    statusCode === 403 ||
    errorStatus === "PERMISSION_DENIED" ||
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
  const hasName = account?.name && account.name !== String(account?.id);
  return (
    account?.status === "ENABLED" &&
    formatAccountStatus(account?.rawStatus) === "ENABLED" &&
    account?.isManager !== true &&
    account?.isTestAccount !== true &&
    account?.status !== "PRODUCTION_BLOCKED" &&
    account?.errorReason == null &&
    account?.hierarchyLocked !== true &&
    hasName
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
      googleUser.accessToken = encrypt(accessToken);
      googleUser.tokenExpiresAt = new Date(Date.now() + (refreshResponse.data.expires_in || 3600) * 1000);
      await googleUser.save();

    } catch (refreshErr) {
      logger.error(`Google token refresh failed for userId ${userId}: ${refreshErr.response?.data?.error || refreshErr.message}`);
      const err = new Error("Google access token expired. Please reconnect your Google account.");
      err.statusCode = 401;
      throw err;
    }
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
function datePresetToRange(preset) {
  const today = dayjs();
  const quarter = Math.floor(today.month() / 3);
  const thisQStart = today.startOf("year").add(quarter * 3, "month");
  const lastQStart = thisQStart.subtract(3, "month");
  const lastQEnd = thisQStart.subtract(1, "day");
  // lifetime / maximum: Google Ads data is available from 2001-01-01
  const epochStart = "2001-01-01";
  const map = {
    today: [today.format("YYYY-MM-DD"), today.format("YYYY-MM-DD")],
    yesterday: [today.subtract(1, "day").format("YYYY-MM-DD"), today.subtract(1, "day").format("YYYY-MM-DD")],
    last_3d: [today.subtract(3, "day").format("YYYY-MM-DD"), today.format("YYYY-MM-DD")],
    last_7d: [today.subtract(7, "day").format("YYYY-MM-DD"), today.format("YYYY-MM-DD")],
    last_14d: [today.subtract(14, "day").format("YYYY-MM-DD"), today.format("YYYY-MM-DD")],
    last_28d: [today.subtract(28, "day").format("YYYY-MM-DD"), today.format("YYYY-MM-DD")],
    last_30d: [today.subtract(30, "day").format("YYYY-MM-DD"), today.format("YYYY-MM-DD")],
    last_90d: [today.subtract(90, "day").format("YYYY-MM-DD"), today.format("YYYY-MM-DD")],
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
    this.createAd = this.createAd.bind(this);
    this.createAdAPI = this.createAdAPI.bind(this);
    this.getAd = this.getAd.bind(this);
    this.uploadMediaAPI = this.uploadMediaAPI.bind(this);
    this.deleteCampaignAPI = this.deleteCampaignAPI.bind(this);
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
          // Basic access requires login-customer-id. Retry using stored customerIds.
          const storedIds = googleUser.customerIds || [];
          if (storedIds.length > 0) {
            tokenResp = { data: { resourceNames: storedIds.map((id) => `customers/${id}`) } };
          } else {
            // No stored IDs and PERMISSION_DENIED — truly locked, can't list accounts
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

      // Use searchStream REST for all queries in parallel
      const accountTasks = resourceNames.map(async (rn) => {
        const customerId = normalizeCustomerId(rn.replace("customers/", ""));
        try {
          // Query this account's own details + whether it's a manager
          const selfResp = await axios.post(
            `https://googleads.googleapis.com/v23/customers/${customerId}/googleAds:searchStream`,
            {
              query: `
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
              `,
            },
            {
              headers: {
                Authorization: `Bearer ${accessToken}`,
                "developer-token": process.env.GOOGLE_DEVELOPER_TOKEN,
                "login-customer-id": customerId,
                "Content-Type": "application/json",
              },
              timeout: 10000,
            }
          );

          const rows = selfResp.data?.[0]?.results || [];
          if (!rows.length) return [];

          const c = rows[0].customer;
          const cid = normalizeCustomerId(c.id);
          const results = [];

          results.push({
            id: cid,
            name: c.descriptiveName || cid,
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
            errorReason: err.response?.data?.error?.status || (err.response?.status === 403 ? "DEVELOPER_TOKEN_NOT_APPROVED" : "API_ERROR"),
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

      await redisClient.set(cacheKey, JSON.stringify(response), "EX", REDIS_TTL);
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
// * 5. GET campaigns by customer
// * 5. GET campaigns by customer
// * 5. GET campaigns by customer
  async getCampaignsByCustomer(req, res) {
    /* #swagger.tags = ['Google Ads']
       #swagger.summary = 'Get campaigns'
       #swagger.description = 'Get all campaigns and ad groups for a Google Ads customer account'
       #swagger.security = [{ "BearerAuth": [] }]
       #swagger.parameters['adAccountId'] = { description: 'Google Ads customer ID (required)', type: 'string' }
    */
    try {
      const userId = req.user.user_id;
      const adAccountId = sanitizeId(getQueryParam(req.query, ["adAccountId", "customerId"]));

      const cacheKey = `googleCampaignsAll:${userId}:${adAccountId || "all"}`;
      const cached = await redisClient.get(cacheKey);
      if (cached) return res.status(200).json(JSON.parse(cached));

      const { accessToken } = await initGoogleApiForUser(userId);

      let accountsToFetch = [];

      if (adAccountId) {
        // Mode A: Specific Account — skip listAccessibleCustomers entirely
        const tid = normalizeCustomerId(adAccountId);
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
          const resp = await axios.post(
            `https://googleads.googleapis.com/v23/customers/${targetId}/googleAds:searchStream`,
            {
              query: `
                SELECT
                  campaign.id,
                  campaign.name,
                  campaign.status,
                  campaign.primary_status,
                  campaign.serving_status,
                  campaign.advertising_channel_type,
                  campaign.bidding_strategy_type,
                  campaign_budget.amount_micros,
                  campaign_budget.period,
                  customer.test_account
                FROM campaign
                WHERE campaign.status != 'REMOVED'
                  AND customer.test_account = FALSE
                ORDER BY campaign.id DESC
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
            const c = r.campaign;
            const channelType = robustFormatChannelType(c.advertisingChannelType || c.advertising_channel_type);
            const primaryStatus = c.primaryStatus || c.primary_status;
            const servingStatus = c.servingStatus || c.serving_status;
            const biddingStrategyType = c.biddingStrategyType || c.bidding_strategy_type;
            const budget = r.campaignBudget || r.campaign_budget;
            return {
              id: String(c.id),
              name: c.name,
              status: robustFormatStatus(c.status),
              primaryStatus: (primaryStatus && primaryStatus !== "UNKNOWN" && primaryStatus !== "UNSPECIFIED") ? primaryStatus : null,
              servingStatus: (servingStatus && servingStatus !== "UNKNOWN" && servingStatus !== "UNSPECIFIED") ? servingStatus : null,
              channelType: (channelType && channelType !== "UNKNOWN") ? channelType : null,
              objective: deriveObjective(c.advertisingChannelType || c.advertising_channel_type),
              biddingStrategy: robustFormatBiddingStrategy(biddingStrategyType),
              budgetMicros: budget?.amountMicros || budget?.amount_micros || 0,
              budget: formatBudget(budget?.amountMicros || budget?.amount_micros),
              budgetPeriod: budget?.period || "DAILY",
            };
          });
        };

        const fetchAdGroups = async (targetId, loginId) => {
          try {
            const resp = await axios.post(
              `https://googleads.googleapis.com/v23/customers/${targetId}/googleAds:searchStream`,
              {
                query: `
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
                  WHERE campaign.advertising_channel_type IN ('SEARCH', 'DISPLAY', 'SHOPPING', 'MULTI_CHANNEL')
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
              const ag = r.adGroup || r.ad_group;
              return {
                id: String(ag.id),
                name: ag.name,
                status: robustFormatStatus(ag.status),
                type: ag.type,
                targetCpa: (ag.targetCpaMicros || ag.target_cpa_micros) ? (ag.targetCpaMicros || ag.target_cpa_micros) / 1e6 : null,
                targetRoas: ag.targetRoas || ag.target_roas || null,
                campaignId: String(r.campaign.id),
                campaignName: r.campaign.name,
                isPmax: false,
              };
            });
          } catch (e) {
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
                    campaign.name
                  FROM asset_group
                  WHERE campaign.advertising_channel_type = 'PERFORMANCE_MAX'
                    AND asset_group.status != 'REMOVED'
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
                isPmax: true,
              };
            });
          } catch (e) {
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

          return {
            accountId: tid,
            loginCustomerId: acc.loginCustomerId || tid,
            campaigns,
            campaignCount: campaigns.length,
          };
        } catch (err) {
          const m = formatGoogleError(err);
          logger.error(`Campaign fetch failed for ${acc.id}: ${m.message}`);
          return {
            accountId: acc.id,
            campaigns: [],
            campaignCount: 0,
            error: m.message,
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

      if (adAccountId) {
        response.campaigns = dataResults.flatMap(d => d.campaigns || []);
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

      const tid = normalizeCustomerId(adAccountId);
      const cacheKey = `googleAdGroups:${userId}:${tid}:${campaignId}`;
      const cached = await redisClient.get(cacheKey);
      if (cached) return res.status(200).json(JSON.parse(cached));

      const { accessToken } = await initGoogleApiForUser(userId);
      const resolvedLoginCustomerId = await resolveManagerForAccount(tid, accessToken, userId);
      const lid = normalizeCustomerId(resolvedLoginCustomerId || tid);

      const cleanCampaignId = sanitizeId(campaignId);
      const headers = { Authorization: `Bearer ${accessToken}`, "developer-token": process.env.GOOGLE_DEVELOPER_TOKEN, "login-customer-id": lid, "Content-Type": "application/json" };

      // Run both ad_group and asset_group queries in parallel — no pre-detection call needed
      const [adGroupResp, assetGroupResp] = await Promise.all([
        axios.post(`https://googleads.googleapis.com/v23/customers/${tid}/googleAds:searchStream`,
          { query: `SELECT ad_group.id, ad_group.name, ad_group.status, ad_group.type, ad_group.target_cpa_micros, ad_group.target_roas, campaign.id, campaign.name FROM ad_group WHERE campaign.id = ${cleanCampaignId}` },
          { headers }
        ).catch(() => ({ data: [] })),
        axios.post(`https://googleads.googleapis.com/v23/customers/${tid}/googleAds:searchStream`,
          { query: `SELECT asset_group.id, asset_group.name, asset_group.status, asset_group.primary_status, campaign.id, campaign.name FROM asset_group WHERE campaign.id = ${cleanCampaignId} AND asset_group.status != 'REMOVED'` },
          { headers }
        ).catch(() => ({ data: [] })),
      ]);

      const agResults = adGroupResp.data?.[0]?.results || [];
      const assetResults = assetGroupResp.data?.[0]?.results || [];
      const isPmax = assetResults.length > 0 && agResults.length === 0;

      const adGroups = isPmax
        ? assetResults.map(r => {
            const ag = r.assetGroup || r.asset_group || {};
            const camp = r.campaign || {};
            const primaryStatus = ag.primaryStatus || ag.primary_status;
            return {
              id: String(ag.id || ""),
              name: ag.name || "",
              status: robustFormatStatus(ag.status),
              primaryStatus: (primaryStatus && primaryStatus !== "UNKNOWN" && primaryStatus !== "UNSPECIFIED") ? primaryStatus : null,
              type: "ASSET_GROUP",
              campaignId: String(camp.id || ""),
              campaignName: camp.name || "",
              isPmax: true,
            };
          })
        : agResults.map(r => {
            const ag = r.adGroup || r.ad_group || {};
            const camp = r.campaign || {};
            return {
              id: String(ag.id || ""),
              name: ag.name || "",
              status: robustFormatStatus(ag.status),
              type: ag.type || "",
              targetCpa: ag.targetCpaMicros ? ag.targetCpaMicros / 1e6 : (ag.target_cpa_micros ? ag.target_cpa_micros / 1e6 : null),
              targetRoas: ag.targetRoas || ag.target_roas || null,
              campaignId: String(camp.id || ""),
              campaignName: camp.name || "",
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

      const tid = normalizeCustomerId(adAccountId);
      const cacheKey = `googleCampaignAds:${userId}:${tid}:${campaignId}`;
      const cached = await redisClient.get(cacheKey);
      if (cached) return res.status(200).json(JSON.parse(cached));

      const { accessToken } = await initGoogleApiForUser(userId);
      const resolvedLoginCustomerId = await resolveManagerForAccount(tid, accessToken, userId);
      const lid = normalizeCustomerId(resolvedLoginCustomerId || tid);

      const cleanCampaignId = sanitizeId(campaignId);
      const headers = { Authorization: `Bearer ${accessToken}`, "developer-token": process.env.GOOGLE_DEVELOPER_TOKEN, "login-customer-id": lid, "Content-Type": "application/json" };

      // Run both PMax and standard ad queries in parallel — no pre-detection call
      const [pmaxResp, standardResp] = await Promise.all([
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
        axios.post(`https://googleads.googleapis.com/v23/customers/${tid}/googleAds:searchStream`, {
          query: `
            SELECT
              ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.status, ad_group_ad.ad.type,
              ad_group_ad.ad.final_urls,
              ad_group_ad.ad.responsive_search_ad.headlines, ad_group_ad.ad.responsive_search_ad.descriptions,
              ad_group_ad.ad.responsive_display_ad.headlines, ad_group_ad.ad.responsive_display_ad.descriptions,
              ad_group_ad.ad.responsive_display_ad.marketing_images, ad_group_ad.ad.responsive_display_ad.logo_images,
              ad_group_ad.ad.responsive_display_ad.business_name,
              ad_group.id, ad_group.name, campaign.id, campaign.name
            FROM ad_group_ad
            WHERE campaign.id = ${cleanCampaignId} AND ad_group_ad.status != 'REMOVED'
          `,
        }, { headers }).catch(() => ({ data: [] })),
      ]);

      const pmaxResults = pmaxResp.data?.[0]?.results || [];
      const standardResults = standardResp.data?.[0]?.results || [];
      const isPmax = pmaxResults.length > 0;

      let ads = [];

      if (isPmax) {
        const resp = { data: pmaxResp.data };
        const results = resp.data?.[0]?.results || [];
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
          const text = (asset.textAsset || asset.text_asset)?.text;
          const imgData = asset.imageAsset || asset.image_asset;
          const imageUrl = imgData?.fullSize?.url || imgData?.full_size?.url;
          const mimeType = imgData?.mimeType || imgData?.mime_type || "";
          if (fieldType === "HEADLINE" && text) byGroup[gid].headlines.push(text);
          else if (fieldType === "DESCRIPTION" && text) byGroup[gid].descriptions.push(text);
          else if ((fieldType === "MARKETING_IMAGE" || fieldType === "SQUARE_MARKETING_IMAGE" || fieldType === "PORTRAIT_MARKETING_IMAGE") && imageUrl) {
            byGroup[gid].images.push({ url: imageUrl, mimeType, fieldType });
          } else if ((fieldType === "LOGO" || fieldType === "LANDSCAPE_LOGO") && imageUrl) {
            byGroup[gid].logos.push({ url: imageUrl, mimeType, fieldType });
          }
        });
        ads = Object.values(byGroup);
      } else {
        ads = standardResults.map((r) => {
          const aga = r.adGroupAd || r.ad_group_ad || {};
          const ad = aga.ad || {};
          const ag = r.adGroup || r.ad_group || {};
          const camp = r.campaign || {};
          const rsa = ad.responsiveSearchAd || ad.responsive_search_ad || {};
          const rda = ad.responsiveDisplayAd || ad.responsive_display_ad || {};
          const adType = ad.type || "";
          const headlines = adType === "RESPONSIVE_SEARCH_AD"
            ? (rsa.headlines || []).map(h => h.text)
            : (rda.headlines || []).map(h => h.text);
          const descriptions = adType === "RESPONSIVE_SEARCH_AD"
            ? (rsa.descriptions || []).map(d => d.text)
            : (rda.descriptions || []).map(d => d.text);
          const finalUrls = ad.finalUrls || ad.final_urls || [];
          return {
            id: String(ad.id || ""),
            status: robustFormatStatus(aga.status),
            headline: headlines[0] || "",
            description: descriptions[0] || "",
            finalUrl: finalUrls[0] || "",
          };
        });
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

      const tid = normalizeCustomerId(adAccountId);
      const cacheKey = `googleAdGroupAds:${userId}:${tid}:${adGroupId}`;
      const cached = await redisClient.get(cacheKey);
      if (cached) return res.status(200).json(JSON.parse(cached));

      const { accessToken } = await initGoogleApiForUser(userId);
      const resolvedLoginCustomerId = await resolveManagerForAccount(tid, accessToken, userId);
      const lid = normalizeCustomerId(resolvedLoginCustomerId || tid);

      const cleanAdGroupId = sanitizeId(adGroupId);
      const headers = { Authorization: `Bearer ${accessToken}`, "developer-token": process.env.GOOGLE_DEVELOPER_TOKEN, "login-customer-id": lid, "Content-Type": "application/json" };

      // Run both PMax and standard queries in parallel — no pre-detection call
      const [pmaxResp, standardResp] = await Promise.all([
        axios.post(`https://googleads.googleapis.com/v23/customers/${tid}/googleAds:searchStream`, {
          query: `
            SELECT
              asset_group_asset.field_type, asset_group_asset.status,
              asset_group.id, asset_group.name, asset_group.status, asset_group.final_urls,
              asset.id, asset.name, asset.type,
              asset.text_asset.text, asset.image_asset.full_size.url, asset.image_asset.mime_type,
              campaign.id, campaign.name
            FROM asset_group_asset
            WHERE asset_group.id = ${cleanAdGroupId} AND asset_group_asset.status != 'REMOVED'
          `,
        }, { headers }).catch(() => ({ data: [] })),
        axios.post(`https://googleads.googleapis.com/v23/customers/${tid}/googleAds:searchStream`, {
          query: `
            SELECT
              ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.status, ad_group_ad.ad.type,
              ad_group_ad.ad.final_urls,
              ad_group_ad.ad.responsive_search_ad.headlines, ad_group_ad.ad.responsive_search_ad.descriptions,
              ad_group_ad.ad.responsive_display_ad.headlines, ad_group_ad.ad.responsive_display_ad.descriptions,
              ad_group_ad.ad.responsive_display_ad.marketing_images, ad_group_ad.ad.responsive_display_ad.logo_images,
              ad_group_ad.ad.responsive_display_ad.business_name,
              ad_group.id, ad_group.name
            FROM ad_group_ad
            WHERE ad_group.id = ${cleanAdGroupId} AND ad_group_ad.status != 'REMOVED'
          `,
        }, { headers }).catch(() => ({ data: [] })),
      ]);

      const pmaxResults = pmaxResp.data?.[0]?.results || [];
      const standardResults = standardResp.data?.[0]?.results || [];
      const isPmax = pmaxResults.length > 0;

      let ads = [];

      if (isPmax) {
        const results = pmaxResults;
        const grouped = { id: String(adGroupId), type: "ASSET_GROUP", isPmax: true, finalUrls: [], headlines: [], descriptions: [], images: [], logos: [] };
        results.forEach(r => {
          const asset = r.asset || {};
          const aga = r.assetGroupAsset || r.asset_group_asset || {};
          const fieldType = aga.fieldType || aga.field_type || "";
          const ag = r.assetGroup || r.asset_group || {};
          grouped.name = ag.name || "";
          grouped.status = robustFormatStatus(ag.status);
          grouped.campaignId = String((r.campaign || {}).id || "");
          grouped.campaignName = (r.campaign || {}).name || "";
          const agFinalUrls = ag.finalUrls || ag.final_urls || [];
          if (!grouped.finalUrls.length && agFinalUrls.length) grouped.finalUrls = agFinalUrls;
          const text = (asset.textAsset || asset.text_asset)?.text;
          const imgData = asset.imageAsset || asset.image_asset;
          const imageUrl = imgData?.fullSize?.url || imgData?.full_size?.url;
          const mimeType = imgData?.mimeType || imgData?.mime_type || "";
          if (fieldType === "HEADLINE" && text) grouped.headlines.push(text);
          else if (fieldType === "DESCRIPTION" && text) grouped.descriptions.push(text);
          else if ((fieldType === "MARKETING_IMAGE" || fieldType === "SQUARE_MARKETING_IMAGE" || fieldType === "PORTRAIT_MARKETING_IMAGE") && imageUrl) {
            grouped.images.push({ url: imageUrl, mimeType, fieldType });
          } else if ((fieldType === "LOGO" || fieldType === "LANDSCAPE_LOGO") && imageUrl) {
            grouped.logos.push({ url: imageUrl, mimeType, fieldType });
          }
        });
        ads = results.length ? [grouped] : [];
      } else {
        ads = standardResults.map((r) => {
          const aga = r.adGroupAd || r.ad_group_ad || {};
          const ad = aga.ad || {};
          const ag = r.adGroup || r.ad_group || {};
          const rsa = ad.responsiveSearchAd || ad.responsive_search_ad || {};
          const rda = ad.responsiveDisplayAd || ad.responsive_display_ad || {};
          const adType = ad.type || "";
          const headlines = adType === "RESPONSIVE_SEARCH_AD"
            ? (rsa.headlines || []).map(h => h.text)
            : (rda.headlines || []).map(h => h.text);
          const descriptions = adType === "RESPONSIVE_SEARCH_AD"
            ? (rsa.descriptions || []).map(d => d.text)
            : (rda.descriptions || []).map(d => d.text);
          const finalUrls = ad.finalUrls || ad.final_urls || [];
          return {
            id: String(ad.id || ""),
            status: robustFormatStatus(aga.status),
            headline: headlines[0] || "",
            description: descriptions[0] || "",
            finalUrl: finalUrls[0] || "",
          };
        });
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
      const tid = normalizeCustomerId(adAccountId);
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

      const cacheKey = `googleAnalytics:${userId}:${adAccountId}:${datePreset}`;
      const cached = await redisClient.get(cacheKey);
      if (cached) return res.status(200).json(JSON.parse(cached));

      const { accessToken } = await initGoogleApiForUser(userId);
      const tid = normalizeCustomerId(adAccountId);
      const resolvedLoginCustomerId = await resolveManagerForAccount(adAccountId, accessToken, userId);
      const lid = normalizeCustomerId(resolvedLoginCustomerId || tid);
      const headers = { Authorization: `Bearer ${accessToken}`, "developer-token": process.env.GOOGLE_DEVELOPER_TOKEN, "login-customer-id": lid, "Content-Type": "application/json" };

      const [startDate, endDate] = datePresetToRange(datePreset);
      const prevEnd = dayjs(startDate).subtract(1, "day");
      const prevStart = prevEnd.subtract(dayjs(endDate).diff(dayjs(startDate), "day"), "day");

      const search = (query) => axios.post(
        `https://googleads.googleapis.com/v23/customers/${tid}/googleAds:searchStream`,
        { query },
        { headers }
      ).then(r => r.data?.[0]?.results || []);

      const metricsQuery = (start, end) => `
        SELECT metrics.cost_micros, metrics.impressions, metrics.clicks,
               metrics.conversions, metrics.conversions_value, metrics.view_through_conversions
        FROM campaign
        WHERE segments.date BETWEEN '${start}' AND '${end}'
      `;

      const [currRows, prevRows, dailyRows] = await Promise.all([
        search(metricsQuery(startDate, endDate)),
        search(metricsQuery(prevStart.format("YYYY-MM-DD"), prevEnd.format("YYYY-MM-DD"))),
        search(`SELECT segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions FROM campaign WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'`),
      ]);

      const aggregate = (rows) => rows.reduce((acc, r) => {
        const m = r.metrics || {};
        return {
          spend: acc.spend + (m.costMicros || m.cost_micros || 0) / 1e6,
          impressions: acc.impressions + (m.impressions || 0),
          clicks: acc.clicks + (m.clicks || 0),
          conversions: acc.conversions + (m.conversions || 0),
          conversionsValue: acc.conversionsValue + (m.conversionsValue || m.conversions_value || 0),
          viewThroughConversions: acc.viewThroughConversions + (m.viewThroughConversions || m.view_through_conversions || 0),
        };
      }, { spend: 0, impressions: 0, clicks: 0, conversions: 0, conversionsValue: 0, viewThroughConversions: 0 });

      const curr = aggregate(currRows);
      const prev = aggregate(prevRows);

      const change = (c, p) => p === 0 ? 0 : parseFloat((((c - p) / p) * 100).toFixed(1));

      const currCtr = curr.impressions > 0 ? parseFloat(((curr.clicks / curr.impressions) * 100).toFixed(2)) : 0;
      const prevCtr = prev.impressions > 0 ? parseFloat(((prev.clicks / prev.impressions) * 100).toFixed(2)) : 0;
      const currCpc = curr.clicks > 0 ? parseFloat((curr.spend / curr.clicks).toFixed(2)) : 0;
      const prevCpc = prev.clicks > 0 ? parseFloat((prev.spend / prev.clicks).toFixed(2)) : 0;
      const currCpm = curr.impressions > 0 ? parseFloat(((curr.spend / curr.impressions) * 1000).toFixed(2)) : 0;
      const prevCpm = prev.impressions > 0 ? parseFloat(((prev.spend / prev.impressions) * 1000).toFixed(2)) : 0;

      const stats = {
        spend: { val: parseFloat(curr.spend.toFixed(2)), change: change(curr.spend, prev.spend) },
        impressions: { val: curr.impressions, change: change(curr.impressions, prev.impressions) },
        clicks: { val: curr.clicks, change: change(curr.clicks, prev.clicks) },
        conversions: { val: Math.round(curr.conversions), change: change(curr.conversions, prev.conversions) },
        ctr: { val: currCtr, change: change(currCtr, prevCtr) },
        cpc: { val: currCpc, change: change(currCpc, prevCpc) },
        cpm: { val: currCpm, change: change(currCpm, prevCpm) },
        conversionsValue: { val: parseFloat(curr.conversionsValue.toFixed(2)), change: change(curr.conversionsValue, prev.conversionsValue) },
        viewThroughConversions: { val: Math.round(curr.viewThroughConversions), change: change(curr.viewThroughConversions, prev.viewThroughConversions) },
      };

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

      const chartData = Object.keys(dailyMap).sort().map((date) => ({
        name: dayjs(date).format("DD MMM"),
        fullDate: date,
        spend: parseFloat(dailyMap[date].spend.toFixed(2)),
        impressions: dailyMap[date].impressions,
        clicks: dailyMap[date].clicks,
        conversions: Math.round(dailyMap[date].conversions),
        ctr: dailyMap[date].impressions > 0 ? parseFloat(((dailyMap[date].clicks / dailyMap[date].impressions) * 100).toFixed(2)) : 0,
      }));

      const response = { status: true, stats, chartData };

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
      const tid = normalizeCustomerId(adAccountId);
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
      const tid = normalizeCustomerId(adAccountId);
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

      const { client, refreshToken, accessToken } = await initGoogleApiForUser(userId);
      const tid = normalizeCustomerId(customerId);
      const resolvedLoginCustomerId = await resolveManagerForAccount(tid, accessToken);
      const loginCustomerId = normalizeCustomerId(resolvedLoginCustomerId || tid);
      const customer = getCustomerClient(client, customerId, loginCustomerId, refreshToken);

      const statusEnum = status === "ENABLED" ? 2 : 3;
      const numericId = sanitizeId(id);

      if (level === "campaign") {
        await customer.campaigns.update([{
          resource_name: `customers/${sanitizeId(customerId)}/campaigns/${numericId}`,
          status: statusEnum,
        }]);
      } else if (level === "adgroup") {
        await customer.adGroups.update([{
          resource_name: `customers/${sanitizeId(customerId)}/adGroups/${numericId}`,
          status: statusEnum,
        }]);
      } else if (level === "ad") {
        return res.status(400).json({
          status: false,
          error: "Ad-level status updates are not supported via this endpoint. Use PATCH /ads/:id instead.",
        });
      }

      await invalidateUserGoogleCache(userId);

      return res.status(200).json({
        status: true,
        message: `${level} ${status.toLowerCase()}d successfully`,
      });
    } catch (error) {
      const m = formatGoogleError(error);
      logger.error(`Google update status error: ${m.message}`);
      return res.status(error.statusCode || 500).json({
        status: false,
        error: "Failed to update status",
        details: m.message,
        reason: m.reason,
      });
    }
  }

  // * 12. GET factory campaigns picker
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

      const { client, refreshToken, accessToken } = await initGoogleApiForUser(userId);
      const tid = normalizeCustomerId(adAccountId);
      const resolvedMcc = await resolveManagerForAccount(tid, accessToken);
      const mccId = normalizeCustomerId(resolvedMcc || tid);
      const customer = getCustomerClient(client, adAccountId, mccId, refreshToken);

      // Status 4 = REMOVED
      await customer.campaigns.update([{
        resource_name: `customers/${sanitizeId(adAccountId)}/campaigns/${sanitizeId(campaignId)}`,
        status: 4,
      }]);

      await invalidateUserGoogleCache(userId);

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
        dailyBudgetMicros = 5000000,
        status = "PAUSED",
        startTime,
        endTime,
        targeting,
      } = value;

      // ── Init ──────────────────────────────────────────────────────────────
      const { accessToken } = await initGoogleApiForUser(userId);
      const tid = normalizeCustomerId(adAccountId);
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
        YOUTUBE_REACH: "VIDEO",
        SEARCH: "SEARCH", DISPLAY: "DISPLAY", SHOPPING: "SHOPPING",
        PERFORMANCE_MAX: "PERFORMANCE_MAX", VIDEO: "VIDEO",
      };
      const channelType = channelTypeMap[String(objective).toUpperCase().replace(/ /g, "_")] || "SEARCH";

      // ── Bidding strategy per channel type (snake_case for REST API) ──────
      const biddingStrategy =
        channelType === "DISPLAY"           ? { target_spend: {} }
        : channelType === "VIDEO"           ? { target_cpv: {} }
        : channelType === "PERFORMANCE_MAX" ? { maximize_conversion_value: {} }
        : { manual_cpc: { enhanced_cpc_enabled: false } };

      // ── Step 1: Create campaign budget ────────────────────────────────────
      const budgetResp = await axios.post(
        `https://googleads.googleapis.com/v23/customers/${customerId}/googleAds:mutate`,
        {
          mutateOperations: [{
            campaignBudgetOperation: {
              create: {
                name: `${name} Budget`,
                amount_micros: String(dailyBudgetMicros),
                delivery_method: "STANDARD",
                explicitly_shared: false,
              },
            },
          }],
        },
        { headers }
      );
      const budgetResource = budgetResp.data?.mutateOperationResponses?.[0]?.campaignBudgetResult?.resourceName;
      if (!budgetResource) throw new Error("Campaign budget creation failed — no resourceName returned");

      // ── Step 2: Create campaign ───────────────────────────────────────────
      const campaignBody = {
        name,
        status,
        advertising_channel_type: channelType,
        campaign_budget: budgetResource,
        contains_eu_political_advertising: 2,  // NOT_EU_POLITICAL_ADVERTISING = 2 in v23 proto
        ...biddingStrategy,
      };

      const campaignResp = await axios.post(
        `https://googleads.googleapis.com/v23/customers/${customerId}/googleAds:mutate`,
        {
          mutateOperations: [{
            campaignOperation: { create: campaignBody },
          }],
        },
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
            updateBody.start_date = (sd.isBefore(today) ? today : sd).format("YYYYMMDD");
            updateFields.push("start_date");
          }
          if (endTime) {
            updateBody.end_date = dayjs(endTime).format("YYYYMMDD");
            updateFields.push("end_date");
          }
          await axios.post(
            `https://googleads.googleapis.com/v23/customers/${customerId}/googleAds:mutate`,
            {
              mutateOperations: [{
                campaignOperation: {
                  update: updateBody,
                  update_mask: updateFields.join(","),
                },
              }],
            },
            { headers }
          );
        } catch (e) {
          logger.error(`Campaign date update failed (non-fatal): ${e.response?.data ? JSON.stringify(e.response.data) : e.message}`);
        }
      }

      // ── Step 4: Location targeting ────────────────────────────────────────
      if (targeting?.countries?.length) {
        try {
          const COMMON_LOCATIONS = {
            US: 2840, IN: 2356, GB: 2826, CA: 2124, AU: 2036, DE: 2276, FR: 2250,
            BR: 2076, IT: 2380, ES: 2724, JP: 2392, SG: 2702, AE: 2784,
          };
          const locOps = targeting.countries
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

      const formattedErrors = googleErrors.map((e) => ({
        message: e.message,
        field: e.location?.fieldPathElements?.map((f) => f.fieldName).join(".") || null,
        code: Object.keys(e.errorCode || {})[0] || null,
      }));

      return res.status(error.response?.status || 500).json({
        status: false,
        error: isMutateNotAllowed
          ? "YouTube/VIDEO campaign creation requires Google Ads API Standard Access. Your account currently has Basic Access. Please apply for Standard Access at: Google Ads → MCC account → Tools & Settings → API Center → Apply for Standard Access."
          : formattedErrors[0]?.message ||
            error.response?.data?.error?.message ||
            error.message ||
            "Failed to create campaign",
        validations: formattedErrors,
        details: error.response?.data || null,
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
      } = value;

      const actualBid = bidAmount || cpcBidMicros;

      // ── Init ──────────────────────────────────────────────────────────────
      const { client, refreshToken, accessToken } = await initGoogleApiForUser(userId);
      const tid = normalizeCustomerId(adAccountId);
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
              campaignUpdate.start_date = (startDate.isBefore(today) ? today : startDate).format("YYYYMMDD");
            }

            if (endTime) {
              campaignUpdate.end_date = dayjs(endTime).format("YYYYMMDD");
            }

            await customer.campaigns.update([campaignUpdate]);
          }

          // Campaign location targeting
          if (targeting?.countries?.length) {
            const COMMON_LOCATIONS = {
              US: 2840, IN: 2356, GB: 2826, CA: 2124, AU: 2036, DE: 2276, FR: 2250,
              BR: 2076, IT: 2380, ES: 2724, JP: 2392, SG: 2702, AE: 2784,
            };

            const locationCriteria = targeting.countries
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
        return res.status(400).json({
          status: false,
          error: "Performance Max campaigns do not support ad groups. Create a Search or Display campaign to use ad groups.",
        });
      }

      const adGroupTypeMap = {
        SEARCH: "SEARCH_STANDARD",
        DISPLAY: "DISPLAY_STANDARD",
        SHOPPING: "SHOPPING_PRODUCT_ADS",
        VIDEO: "VIDEO_TRUE_VIEW_IN_STREAM",
        MULTI_CHANNEL: "SEARCH_STANDARD",
      };
      const adGroupType = adGroupTypeMap[channelType] || "SEARCH_STANDARD";

      // ── Step 3: Create ad group ───────────────────────────
      const adGroupResult = await customer.adGroups.create([{
        name,
        status,
        type: adGroupType,
        cpc_bid_micros: String(actualBid),
        campaign: `customers/${customerId}/campaigns/${cleanCampaignId}`,
      }]);

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
        error:
          formattedErrors[0]?.message ||
          error.response?.data?.error?.message ||
          error.message ||
          "Failed to create ad group",
        validations: formattedErrors,
      });
    }
  }


  // * 21. POST create ad — one-shot: campaign + adgroup + ads
  async createAd(req, res) {
    /* #swagger.tags = ['Google Ads']
       #swagger.summary = 'Create ad (one-shot)'
       #swagger.description = 'One-shot AdFactory launch: creates campaign + ad group + ads. MCC resolved automatically.'
       #swagger.security = [{ "BearerAuth": [] }]
       #swagger.requestBody = {
         required: true,
         content: {
           "application/json": {
             schema: {
               type: "object",
               required: ["adAccountId", "adFactoryCampaignId", "ads"],
               properties: {
                 adAccountId: { type: "string", example: "7984091200" },
                 adFactoryCampaignId: { type: "string", example: "" },
                 campaignDetails: { type: "object", example: { campaignName: "My Campaign", campaignObjective: "SEARCH", dailyBudgetMicros: 5000000 } },
                 adGroupDetails: { type: "object", example: { adGroupName: "Ad Group 1", cpcBidMicros: 1000000 } },
                 ads: { type: "array", example: [{ headlines: ["Headline 1", "Headline 2", "Headline 3"], descriptions: ["Desc 1", "Desc 2"], finalUrl: "https://example.com", imageUrl: "https://example.com/img.png", callToAction: "SHOP_NOW" }] }
               }
             }
           }
         }
       }
    */
    try {
      const userId = req.user.user_id;
      const adAccountId = getQueryParam(req.body, ["adAccountId", "customerId"]);
      const {
        adFactoryCampaignId,
        campaignDetails = {}, adGroupDetails = {}, ads = [],
      } = req.body;

      if (!adAccountId || !adFactoryCampaignId || !ads.length) {
        return res.status(400).json({
          status: false,
          error: "adAccountId, adFactoryCampaignId and ads are required",
        });
      }

      const { accessToken } = await initGoogleApiForUser(userId);
      const tid = normalizeCustomerId(adAccountId);
      let resolvedLoginCustomerId = null;
      try {
        resolvedLoginCustomerId = await resolveManagerForAccount(tid, accessToken);
      } catch (e) {

      }
      const loginCustomerId = normalizeCustomerId(resolvedLoginCustomerId || tid);
      const customerId = normalizeCustomerId(adAccountId);

      // --- Campaign ---
      let campaignId = campaignDetails.campaignId ? sanitizeId(campaignDetails.campaignId) : null;
      if (!campaignId) {
        const { campaignId: newCampaignId } = await this._createCampaign(
          accessToken, loginCustomerId, customerId,
          campaignDetails.campaignName || `Campaign ${dayjs().format("M/D/YYYY")}`,
          campaignDetails.campaignObjective || "SEARCH",
          campaignDetails.dailyBudgetMicros || 5000000,
        );
        campaignId = newCampaignId;
      }

      // --- Ad Group ---
      let adGroupId = adGroupDetails.adGroupId ? sanitizeId(adGroupDetails.adGroupId) : null;
      if (!adGroupId) {
        const { adGroupId: newAdGroupId } = await this._createAdGroup(
          accessToken, loginCustomerId, customerId, campaignId,
          adGroupDetails.adGroupName || "Ad Group 1",
          adGroupDetails.cpcBidMicros || 1000000,
        );
        adGroupId = newAdGroupId;
      }

      // --- Ads ---
      const objective = (campaignDetails.campaignObjective || "SEARCH").toUpperCase();
      const createdAds = [];
      const errors = [];

      for (let i = 0; i < ads.length; i++) {
        const adData = ads[i];
        try {
          if (!adData.finalUrl) throw new Error("finalUrl is required for each ad");

          const headlines = Array.isArray(adData.headlines) ? adData.headlines : [adData.headlines].filter(Boolean);
          const descriptions = Array.isArray(adData.descriptions) ? adData.descriptions : [adData.descriptions].filter(Boolean);
          const tooLongHeadline = headlines.find((h) => String(h).length > 30);
          if (tooLongHeadline) throw new Error(`headline "${tooLongHeadline}" exceeds 30 characters (${String(tooLongHeadline).length})`);
          const tooLongDesc = descriptions.find((d) => String(d).length > 90);
          if (tooLongDesc) throw new Error(`description "${tooLongDesc}" exceeds 90 characters (${String(tooLongDesc).length})`);

          const adId = await this._createAdByType(
            accessToken, loginCustomerId, customerId, adGroupId, adData, objective,
          );

          const postedAd = await GooglePostedAd.create({
            userId: req.user.user_id,
            googleAdId: adId,
            adAccountId,
            campaignId: String(campaignId),
            adGroupId: String(adGroupId),
            status: "PAUSED",
            content: {
              headline: Array.isArray(adData.headlines) ? adData.headlines[0] : adData.headlines,
              description: Array.isArray(adData.descriptions) ? adData.descriptions[0] : adData.descriptions,
              finalUrl: adData.finalUrl,
              imageUrl: adData.imageUrl || null,
              callToAction: adData.callToAction || null,
              adType: objective,
            },
            metaData: {
              campaignName: campaignDetails.campaignName,
              campaignObjective: objective,
              dailyBudgetMicros: campaignDetails.dailyBudgetMicros,
              campaignId: String(campaignId),
              adGroupId: String(adGroupId),
            },
            adFactoryCampaignId,
          });

          createdAds.push({
            index: i,
            adId: String(adId),
            adType: objective,
            headline: Array.isArray(adData.headlines) ? adData.headlines[0] : adData.headlines,
          });
        } catch (adErr) {
          errors.push({ index: i, error: adErr.message, adData });
        }
      }

      // Update AdFactory campaign with Google metadata
      await Campaign.findByIdAndUpdate(adFactoryCampaignId, {
        "googleMetaData.adAccountId": adAccountId,
        "googleMetaData.campaignId": String(campaignId),
        "googleMetaData.adGroupId": String(adGroupId),
        "googleMetaData.status": "success",
        "googleMetaData.launchedAt": new Date(),
      });

      await invalidateUserGoogleCache(userId);

      return res.status(201).json({
        status: true,
        message: `Created ${createdAds.length} out of ${ads.length} ads successfully`,
        data: {
          campaignId: String(campaignId),
          adGroupId: String(adGroupId),
          createdAds,
          ...(errors.length && { errors }),
          status: "PAUSED",
          note: "Ads are created in PAUSED state. Activate them in Google Ads Manager.",
        },
      });
    } catch (error) {
      logger.error(`GOOGLE CREATE AD (one-shot) ERROR => ${error.message}`);
      const m = formatGoogleError(error);

      let friendlyError = "Failed to create ads";
      if (m.reason === "OPERATION_NOT_PERMITTED_FOR_REMOVED_RESOURCE") {
        friendlyError = "The selected campaign or ad group has been deleted in Google Ads. Please select an active one.";
      } else if (m.reason === "TOO_LONG") {
        friendlyError = "One of the generated headlines or descriptions is too long for Google Ads. Try using shorter text.";
      }

      return res.status(error.response?.status || 500).json({
        status: false, 
        error: friendlyError, 
        details: error.response?.data || m.message,
        reason: m.reason
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

      const userId = req.user.user_id;
      const { accessToken } = await initGoogleApiForUser(userId);
      const customerId = normalizeCustomerId(resolvedAccountId);

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

      // ── VIDEO campaign: YouTube ad creation (channelType derived from campaignId via ad group query) ──
      if (channelType === "VIDEO") {
        const missingVideo = adsArray.findIndex((ad) => !ad.videoUrl);
        if (missingVideo !== -1) {
          return res.status(400).json({
            status: false,
            error: `videoUrl is required for YouTube/VIDEO ads${adsArray.length > 1 ? ` (missing in ad ${missingVideo + 1})` : ""}.`,
          });
        }

        const results = [];
        for (const ad of adsArray) {
          let videoId;

          // videoUrl — upload to YouTube first
          try {
            videoId = await this._uploadVideoToYouTube(accessToken, ad.videoUrl, ad.headline || "Ad Video");
          } catch (uploadErr) {
            return res.status(400).json({ status: false, error: uploadErr.message });
          }

          // adType derived from channelType (VIDEO) — client can optionally override with VIDEO_DISCOVERY
          const adType = ad.adType === "VIDEO_DISCOVERY" ? "VIDEO_DISCOVERY" : "IN_STREAM";
          let adPayload;
          if (adType === "VIDEO_DISCOVERY") {
            adPayload = {
              videoAd: {
                video: { resourceName: `customers/${customerId}/videos/${videoId}` },
                videoDiscovery: {
                  headline: String(ad.headline || "").slice(0, 100),
                  description1: String(ad.description1 || ad.description || "").slice(0, 35),
                  description2: String(ad.description2 || "").slice(0, 35),
                },
              },
              finalUrls: [ad.finalUrl],
            };
          } else {
            adPayload = {
              videoAd: {
                video: { resourceName: `customers/${customerId}/videos/${videoId}` },
                inStream: {
                  actionButtonLabel: String(ad.callToAction || "LEARN_MORE").toUpperCase().replace(/ /g, "_").slice(0, 15),
                  actionHeadline: String(ad.headline || "").slice(0, 15),
                },
              },
              finalUrls: [ad.finalUrl],
            };
          }

          const mutateResp = await axios.post(
            `https://googleads.googleapis.com/v23/customers/${customerId}/googleAds:mutate`,
            {
              mutateOperations: [{
                adGroupAdOperation: {
                  create: {
                    adGroup: `customers/${customerId}/adGroups/${cleanAdGroupId}`,
                    status: "PAUSED",
                    ad: adPayload,
                  },
                },
              }],
            },
            { headers }
          );

          const adResource = mutateResp.data?.mutateOperationResponses?.[0]?.adGroupAdResult?.resourceName;
          results.push({
            adId: adResource?.split("~").pop(),
            adResourceName: adResource,
            videoId,
            adType,
          });
        }

        return res.status(201).json({
          status: true,
          message: `${results.length} YouTube ad${results.length > 1 ? "s" : ""} created successfully`,
          ads: results,
        });
      }

      if (channelType === "DISPLAY") {
        const missingImage = adsArray.findIndex((ad) => !ad.imageUrl);
        if (missingImage !== -1) {
          return res.status(400).json({
            status: false,
            error: `imageUrl is required for Display ads${adsArray.length > 1 ? ` (missing in ad ${missingImage + 1})` : ""}.`,
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
      // Google Ads API v23 responsive_display_ad call_to_action_text valid values
      // Source: https://developers.google.com/google-ads/api/reference/rpc/v23/ResponsiveDisplayAdInfo
      const VALID_DISPLAY_CTA = new Set([
        "LEARN_MORE", "GET_QUOTE", "APPLY_NOW", "BOOK_NOW", "DOWNLOAD",
        "GET_OFFER", "ORDER_NOW", "VISIT_SITE", "SUBSCRIBE", "CONTACT_US",
      ]);
      const buildAdPayload = (h, d, url, callToAction, assetResourceName, squareAssetResourceName) => {
        if (channelType === "DISPLAY") {
          const ctaInput = callToAction ? String(callToAction).toUpperCase().replace(/ /g, "_") : null;
          const cta = ctaInput && VALID_DISPLAY_CTA.has(ctaInput) ? ctaInput : null;
          return {
            responsiveDisplayAd: {
              headlines: buildHeadlines(h).slice(0, 5),
              descriptions: buildDescriptions(d).slice(0, 5),
              longHeadline: { text: String(h) },
              businessName,
              ...(cta && { callToActionText: cta }),
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
        if (channelType === "DISPLAY" && ad.imageUrl) {
          try {
            const { landscape, square } = await this._uploadImageFromUrl(accessToken, loginCustomerId, customerId, ad.imageUrl);
            assetResourceNames.push(landscape);
            squareAssetResourceNames.push(square);
          } catch (uploadErr) {
            return res.status(400).json({ status: false, error: uploadErr.message });
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
        const { headline: h, description: d, finalUrl: url, callToAction, imageUrl } = adsArray[i];
        const adPayload = buildAdPayload(h, d, url, callToAction, assetResourceNames[i], squareAssetResourceNames[i]);

        const adResponse = await axios.post(
          `https://googleads.googleapis.com/v23/customers/${customerId}/googleAds:mutate`,
          {
            mutateOperations: [{
              adGroupAdOperation: {
                create: {
                  adGroup: `customers/${customerId}/adGroups/${cleanAdGroupId}`,
                  status: "PAUSED",
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
          status: "PAUSED",
          content: { headline: h, description: d, finalUrl: url, imageUrl: imageUrl || null, callToAction: callToAction || null, adType: channelType },
        });

        createdAds.push({ adId: String(adId), headline: h, description: d, finalUrl: url, imageUrl: imageUrl || null, status: "PAUSED" });
      }

      await invalidateUserGoogleCache(userId);

      return res.status(201).json({
        status: true,
        message: `${createdAds.length} ad(s) created successfully`,
        customerId,
        loginCustomerId,
        adGroupId,
        adType: channelType,
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

      const tid = normalizeCustomerId(adAccountId);
      const { accessToken } = await initGoogleApiForUser(userId);
      let resolvedLoginCustomerId = null;
      if (!resolvedLoginCustomerId) {
        resolvedLoginCustomerId = await resolveManagerForAccount(tid, accessToken);
      }
      const lid = normalizeCustomerId(resolvedLoginCustomerId || tid);

      const resp = await axios.post(
        `https://googleads.googleapis.com/v23/customers/${tid}/googleAds:searchStream`,
        {
          query: `
            SELECT
              ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.status,
              ad_group_ad.ad.type, ad_group_ad.ad.final_urls,
              ad_group_ad.ad.responsive_search_ad.headlines,
              ad_group_ad.ad.responsive_search_ad.descriptions,
              ad_group.id, campaign.id
            FROM ad_group_ad
            WHERE ad_group_ad.ad.id = ${adId}
            LIMIT 1
          `,
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "developer-token": process.env.GOOGLE_DEVELOPER_TOKEN,
            "login-customer-id": lid,
            "Content-Type": "application/json",
          },
        }
      );

      const results = resp.data?.[0]?.results || [];
      if (!results.length) return res.status(404).json({ status: false, error: "Ad not found" });

      const row = results[0];
      const aga = row.adGroupAd || row.ad_group_ad || {};
      const ad = aga.ad || {};
      const rsa = ad.responsiveSearchAd || ad.responsive_search_ad || {};
      const ag = row.adGroup || row.ad_group || {};
      const camp = row.campaign || {};
      return res.status(200).json({
        status: true,
        ad: {
          id: String(ad.id || ""),
          name: ad.name || "",
          status: robustFormatStatus(aga.status),
          type: ad.type || "",
          finalUrls: ad.finalUrls || ad.final_urls || [],
          headlines: rsa.headlines || [],
          descriptions: rsa.descriptions || [],
          adGroupId: String(ag.id || ""),
          campaignId: String(camp.id || ""),
        },
      });
    } catch (error) {
      const m = formatGoogleError(error);
      logger.error(`Google get ad error: ${m.message}`);
      return res.status(error.statusCode || 500).json({
        status: false, error: "Failed to fetch ad", details: m.message, reason: m.reason,
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
      const tid = normalizeCustomerId(adAccountId);
      const resolvedMcc = await resolveManagerForAccount(tid, accessToken);
      const mccId = normalizeCustomerId(resolvedMcc || tid);
      const customer = getCustomerClient(client, adAccountId, mccId, refreshToken);
      const customerId = sanitizeId(adAccountId);

      let imageData;
      if (file) {
        imageData = file.buffer.toString("base64");
      } else {
        const downloaded = await axios.get(imageUrl, { responseType: "arraybuffer", timeout: 15000 });
        imageData = Buffer.from(downloaded.data).toString("base64");
      }

      const assetResp = await axios.post(
        `https://googleads.googleapis.com/v23/customers/${customerId}/googleAds:mutate`,
        {
          mutateOperations: [{
            assetOperation: {
              create: {
                name: `img_${Date.now()}`,
                type: "IMAGE",
                imageAsset: { data: imageData },
              },
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

      const assetResourceName = assetResp.data?.mutateOperationResponses?.[0]?.assetResult?.resourceName;
      if (!assetResourceName) throw new Error("Could not get asset resource name from Google Ads");

      return res.status(201).json({ status: true, assetResourceName });
    } catch (error) {
      logger.error(`GOOGLE UPLOAD MEDIA ERROR => ${error.message}`);
      const m = formatGoogleError(error);
      return res.status(error.response?.status || 500).json({
        status: false, error: "Failed to upload media", details: error.response?.data || m.message,
      });
    }
  }

  // ─── Private helpers ─────────────────────────────────────────────────────────

  async _createCampaign(accessToken, loginCustomerId, customerId, name, objective, dailyBudgetMicros) {
    const channelTypeMap = {
      SALES: "SEARCH", LEADS: "SEARCH", WEBSITE_TRAFFIC: "SEARCH", SEARCH: "SEARCH",
      DISPLAY: "DISPLAY", VIDEO: "VIDEO", YOUTUBE_REACH: "VIDEO",
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
      : channelType === "VIDEO" ? { maximizeConversions: {} }
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
              containsEuPoliticalAdvertising: 2,
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
      adPayload = {
        responsiveDisplayAd: {
          headlines: hl.slice(0, 5),
          descriptions: dl.slice(0, 5),
          longHeadline: { text: String(hl[0]?.text || "Discover More") },
          businessName: "Brand",
          ...(callToAction && { callToActionText: callToAction }),
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
      const contentType = downloaded.headers["content-type"] || "video/mp4";
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
              imageAsset: { data: imageBuffer.toString("base64") },
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
