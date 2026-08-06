/**
 * Counts how many Meta ad accounts / campaigns a user currently manages,
 * for the per-plan caps configured on the admin Plans page (see
 * Module/admin/planLimit.js, utils/planLimits.js).
 *
 * Scope, per the locked decisions:
 *   - Summed ACROSS every Facebook connection the user has, not per-account.
 *   - Ad accounts: every account visible under each connection (whether or
 *     not the user has ever opened it in AdsGPT).
 *   - Campaigns: every campaign Meta returns for each account, filtered to
 *     ACTIVE/PAUSED only — deleting or archiving a campaign frees a slot.
 *
 * Reuses the same Redis caches the dashboard already warms
 * (metaAdAccounts:*, metaCampaigns:*, both REDIS_TTL=7200 — see
 * metaAdLauncher.js) rather than re-fetching from Meta on every gate check.
 * On a cache miss this falls back to a live, id-only Meta call — deliberately
 * NOT written back into the shared cache, because that cache's real shape
 * (name/currency/status/budget floors for accounts; full campaign fields)
 * is heavier than what a count needs, and writing a stripped-down payload
 * under the same key would silently corrupt whatever the dashboard reads
 * next.
 */
const bizSdk = require("facebook-nodejs-business-sdk");
const FBUsers = require("../Module/adPosting/facebookUsers");
const { redisClient } = require("../db/redis");
const { getFacebookConnectionStatus, metaCacheScope } = require("./metaConnection");
const { initApiForUser, fetchAllPaged } = require("../controllers/adPosting/metaAdLauncher");
const logger = require("./logger");
const { filterActiveCampaigns, sumCounts } = require("./planUsagePure");

// Ad account ids for one Facebook connection — cache hit reuses the
// dashboard's own metaAdAccounts:* entry; a miss makes an id-only Meta call
// (lighter than the full listing) purely to count.
async function listAdAccountIdsForConnection(userId, connection) {
  const cacheKey = `metaAdAccounts:${metaCacheScope(userId, connection.facebookId)}`;
  const cached = await redisClient.get(cacheKey).catch(() => null);
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      return (parsed.adAccounts || []).map((a) => a.id);
    } catch {
      // fall through to a live fetch on a corrupt cache entry
    }
  }

  if (!getFacebookConnectionStatus(connection).isUsable) return [];

  try {
    const { accessToken } = await initApiForUser(userId, connection.facebookId);
    const api = bizSdk.FacebookAdsApi.init(accessToken);
    bizSdk.FacebookAdsApi.setDefaultApi(api);
    const user = new bizSdk.User("me");
    const accounts = await fetchAllPaged(
      user.getAdAccounts(["id"], { limit: 100 }),
      "ad accounts (plan-usage count)",
    );
    return accounts.map((a) => a.id.replace("act_", ""));
  } catch (err) {
    logger.warn(
      `planUsage: failed to list ad accounts for facebookId=${connection.facebookId}: ${err.message}`,
    );
    return [];
  }
}

// Active/paused campaign count for one ad account — cache hit reuses the
// dashboard's own metaCampaigns:* entry; a miss makes an id+status-only call.
async function countActiveCampaignsForAccount(userId, connection, adAccountId) {
  const cacheKey = `metaCampaigns:${metaCacheScope(userId, connection.facebookId)}:${adAccountId}`;
  const cached = await redisClient.get(cacheKey).catch(() => null);
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      return filterActiveCampaigns(parsed.campaigns).length;
    } catch {
      // fall through to a live fetch on a corrupt cache entry
    }
  }

  if (!getFacebookConnectionStatus(connection).isUsable) return 0;

  try {
    const { accessToken } = await initApiForUser(userId, connection.facebookId);
    const api = bizSdk.FacebookAdsApi.init(accessToken);
    bizSdk.FacebookAdsApi.setDefaultApi(api);
    const account = new bizSdk.AdAccount(`act_${adAccountId}`);
    const campaigns = await fetchAllPaged(
      account.getCampaigns(["id", "status"], { limit: 100 }),
      "campaigns (plan-usage count)",
    );
    return filterActiveCampaigns(campaigns).length;
  } catch (err) {
    logger.warn(
      `planUsage: failed to count campaigns for adAccountId=${adAccountId}: ${err.message}`,
    );
    return 0;
  }
}

async function getConnections(userId) {
  return FBUsers.find({ userId });
}

/** Total ad accounts visible across every Facebook connection the user has. */
async function countUserAdAccounts(userId) {
  const connections = await getConnections(userId);
  const perConnectionCounts = await Promise.all(
    connections.map(async (connection) => {
      const ids = await listAdAccountIdsForConnection(userId, connection);
      return ids.length;
    }),
  );
  return sumCounts(perConnectionCounts);
}

/** Total active/paused campaigns across every ad account the user manages. */
async function countUserCampaigns(userId) {
  const connections = await getConnections(userId);
  const perConnectionCounts = await Promise.all(
    connections.map(async (connection) => {
      const adAccountIds = await listAdAccountIdsForConnection(userId, connection);
      const perAccountCounts = await Promise.all(
        adAccountIds.map((adAccountId) =>
          countActiveCampaignsForAccount(userId, connection, adAccountId),
        ),
      );
      return sumCounts(perAccountCounts);
    }),
  );
  return sumCounts(perConnectionCounts);
}

module.exports = {
  countUserAdAccounts,
  countUserCampaigns,
};
