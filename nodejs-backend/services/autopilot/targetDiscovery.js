/**
 * Autopilot target discovery — replaces the old hardcoded `accounts` list
 * in config/autopilotConfig.js.
 *
 * Source of truth (in priority order):
 *   1. AutopilotSettings.find({enabled: true})  → set of opted-in user_ids.
 *   2. For each opted-in user, FacebookUsers.findOne({userId})  → token.
 *   3. With that token, Meta `/me/adaccounts`  → the user's ad accounts.
 *      (Redis-cached at `metaAdAccounts:${userId}` for 2h, same key the
 *      `/meta-ads/get-ad-accounts` HTTP endpoint already populates.)
 *
 * Returns a flat list of `{userId, adAccountId, accessToken, name, currency,
 * timezone}` tuples — one per (opted-in user × their ad accounts) pair.
 *
 * Skips silently with a warn log when:
 *   - User has no FacebookUsers row
 *   - Stored token is empty or expired
 *   - Meta /me/adaccounts call fails (rate-limit, revoked permission, etc.)
 *
 * Failure to discover one user's accounts NEVER blocks the cycle for other
 * users — discovery is per-user-isolated.
 */

const bizSdk = require("facebook-nodejs-business-sdk");
const FBUsers = require("../../Module/adPosting/facebookUsers");
const AutopilotSettings = require("../../Module/autopilot/autopilotSettings");
const { redisClient } = require("../../db/redis");
const { decrypt } = require("../../utils/crypto");

let _logger;
function getLogger() {
  if (_logger) return _logger;
  try {
    _logger = require("../../utils/logger");
  } catch {
    _logger = console;
  }
  return _logger;
}

const ACCOUNTS_CACHE_TTL_SECONDS = 2 * 60 * 60; // 2h, matches HTTP endpoint

/**
 * Resolve a single user's ad-account list. Hits Redis first; falls back to
 * Meta `/me/adaccounts`. Returns `[]` on any failure (logged), never throws.
 *
 * @param {Object} args
 * @param {string} args.userId       AdsGPT user_id
 * @param {string} args.accessToken  decrypted FB OAuth token
 * @returns {Promise<Array<{id, name, currency, timezone, status}>>}
 */
async function listUserAdAccounts({ userId, facebookId, accessToken }) {
  // Cron + manual cycle paths always fetch FRESH from Meta — no Redis read.
  // Caching here used to mask newly granted (or revoked) ad accounts for up
  // to 2 hours, and obscured live entity-status changes from rule
  // evaluation. We still WRITE to the cache after a fresh fetch so the
  // UI's HTTP `/get-ad-accounts` endpoint (which reads the same key) stays
  // warm — that path can keep using the cache because it only feeds picker
  // dropdowns, not action decisions.
  const cacheKey = facebookId
    ? `metaAdAccounts:${userId}:${facebookId}`
    : `metaAdAccounts:${userId}`;

  try {
    const api = bizSdk.FacebookAdsApi.init(accessToken);
    bizSdk.FacebookAdsApi.setDefaultApi(api);
    const user = new bizSdk.User("me");
    let cursor = await user.getAdAccounts(
      [
        "id",
        "name",
        "account_status",
        "currency",
        "timezone_name",
      ],
      { limit: 100 },
    );
    const accounts = [...cursor];
    let pages = 1;
    while (
      typeof cursor?.hasNext === "function" &&
      cursor.hasNext() &&
      pages < 50
    ) {
      cursor = await cursor.next();
      accounts.push(...cursor);
      pages += 1;
    }
    const formatted = accounts.map((a) => ({
      id: a.id.replace("act_", ""),
      name: a.name,
      status: a.account_status,
      currency: a.currency,
      timezone: a.timezone_name,
    }));
    // Refresh the HTTP-endpoint's cache off the back of the fresh fetch.
    try {
      await redisClient.set(
        cacheKey,
        JSON.stringify({
          status: true,
          adAccounts: formatted,
          count: formatted.length,
        }),
        "EX",
        ACCOUNTS_CACHE_TTL_SECONDS,
      );
    } catch (err) {
      getLogger().warn(
        `[autopilot] target discovery: redis cache write failed for ${userId}: ${err.message}`,
      );
    }
    return formatted;
  } catch (err) {
    getLogger().warn(
      `[autopilot] target discovery: /me/adaccounts failed for userId=${userId}: ${err.message}`,
    );
    return [];
  }
}

/**
 * Discover every (user, adAccount) pair the cron should iterate this tick.
 *
 * @param {Object} [opts]
 * @param {Array<string>} [opts.userIds]   Restrict discovery to this set of
 *                                          AdsGPT user_ids (used by tests
 *                                          and ad-hoc triggers). When omitted,
 *                                          discovers from AutopilotSettings.
 * @returns {Promise<Array<{userId, adAccountId, accessToken, name, currency, timezone, severityFloor}>>}
 */
async function discoverAutopilotTargets(opts = {}) {
  const logger = getLogger();

  // 1. Pick opted-in users + their per-user settings.
  //    Project the fields the cycle needs to operate on each target:
  //      - selectedAdAccountIds → which accounts to act on
  //      - severityFloor        → which rule severities trigger actions
  //    `opts.userIds` (set by tests / on-demand HTTP) bypasses the
  //    `enabled: true` filter but STILL respects `selectedAdAccountIds` —
  //    a user must explicitly select accounts to be acted on.
  let settingsRows;
  if (opts.userIds) {
    settingsRows = await AutopilotSettings.find(
      { userId: { $in: opts.userIds } },
      {
        userId: 1,
        selectedAdAccountIds: 1,
        severityFloor: 1,
        perAccountOverrides: 1,
      },
    ).lean();
  } else {
    settingsRows = await AutopilotSettings.find(
      { enabled: true },
      {
        userId: 1,
        selectedAdAccountIds: 1,
        severityFloor: 1,
        perAccountOverrides: 1,
      },
    ).lean();
  }
  const userIds = settingsRows.map((s) => s.userId).filter(Boolean);
  const selectedByUser = new Map(
    settingsRows.map((s) => [
      s.userId,
      // Normalise: strip any accidental `act_` prefix so comparison with
      // the bare ids returned by /me/adaccounts is symmetrical.
      new Set(
        (s.selectedAdAccountIds || []).map((id) =>
          String(id).replace(/^act_/, ""),
        ),
      ),
    ]),
  );
  const severityByUser = new Map(
    settingsRows.map((s) => [s.userId, s.severityFloor || "critical"]),
  );
  // perAccountOverrides shape: { 'act_xxx': { 'AUD-01': { min_spend: 10000 } } }.
  // Stored verbatim — we look up the inner map per-target below.
  const overridesByUser = new Map(
    settingsRows.map((s) => [s.userId, s.perAccountOverrides || {}]),
  );

  if (!userIds.length) {
    logger.info(`[autopilot] target discovery: no opted-in users`);
    return [];
  }

  // 2. Resolve each user's FB row + token.
  const fbRows = await FBUsers.find({ userId: { $in: userIds } }).lean();
  fbRows.sort(
    (a, b) =>
      new Date(b.updatedAt || 0).getTime() -
      new Date(a.updatedAt || 0).getTime(),
  );
  const connectionsByUserId = new Map();
  const byUserId = new Map();
  for (const row of fbRows) {
    if (!connectionsByUserId.has(row.userId)) {
      connectionsByUserId.set(row.userId, []);
      byUserId.set(row.userId, row);
    }
    connectionsByUserId.get(row.userId).push(row);
  }

  const targets = [];
  for (const userId of userIds) {
    const selected = selectedByUser.get(userId) || new Set();
    if (selected.size === 0) {
      logger.warn(
        `[autopilot] target discovery: userId=${userId} opted-in but selectedAdAccountIds is empty — skipped (no accounts chosen)`,
      );
      continue;
    }

    const facebookConnections = connectionsByUserId.get(userId) || [];
    if (facebookConnections.length > 1) {
      const overrides = overridesByUser.get(userId) || {};
      const resolvedAccountIds = new Set();

      // Rows are newest-first. If two identities can see the same ad
      // account, use the most recently refreshed valid token.
      for (const connection of facebookConnections) {
        if (
          connection.tokenExpiresAt &&
          connection.tokenExpiresAt < new Date()
        ) {
          continue;
        }
        let connectionToken;
        try {
          connectionToken = decrypt(connection.accessToken);
        } catch (err) {
          logger.warn(
            `[autopilot] target discovery: userId=${userId} facebookId=${connection.facebookId} token decrypt failed: ${err.message}`,
          );
          continue;
        }
        if (!connectionToken) continue;

        const connectionAccounts = await listUserAdAccounts({
          userId,
          facebookId: connection.facebookId,
          accessToken: connectionToken,
        });
        for (const acct of connectionAccounts) {
          if (!selected.has(acct.id) || resolvedAccountIds.has(acct.id)) {
            continue;
          }
          resolvedAccountIds.add(acct.id);
          const acctKey = `act_${acct.id}`;
          targets.push({
            userId,
            facebookId: connection.facebookId,
            adAccountId: acctKey,
            accessToken: connectionToken,
            name: acct.name,
            currency: acct.currency,
            timezone: acct.timezone,
            severityFloor: severityByUser.get(userId) || "critical",
            thresholdOverrides:
              (overrides && overrides[acctKey]) ||
              (overrides && overrides[acct.id]) ||
              {},
          });
        }
      }
      if (resolvedAccountIds.size === 0) {
        logger.warn(
          `[autopilot] target discovery: userId=${userId} selected accounts were not visible through any connected Facebook account`,
        );
      }
      continue;
    }

    const fbUser = byUserId.get(userId);
    if (!fbUser) {
      logger.warn(
        `[autopilot] target discovery: userId=${userId} opted-in but has no FacebookUsers row — skipped`,
      );
      continue;
    }
    if (fbUser.tokenExpiresAt && fbUser.tokenExpiresAt < new Date()) {
      logger.warn(
        `[autopilot] target discovery: userId=${userId} token expired at ${fbUser.tokenExpiresAt.toISOString()} — skipped`,
      );
      continue;
    }
    let accessToken;
    try {
      accessToken = decrypt(fbUser.accessToken);
    } catch (err) {
      logger.warn(
        `[autopilot] target discovery: userId=${userId} token decrypt failed: ${err.message} — skipped`,
      );
      continue;
    }
    if (!accessToken) {
      logger.warn(
        `[autopilot] target discovery: userId=${userId} has empty access token — skipped`,
      );
      continue;
    }

    // 3. Fetch ad accounts for this user, then intersect with their
    //    selection. An account in `selectedAdAccountIds` that no longer
    //    appears in /me/adaccounts (revoked, archived, lost permission) is
    //    silently dropped — the cron must never act on an account Meta
    //    didn't return for the caller.
    const adAccounts = await listUserAdAccounts({
      userId,
      facebookId: fbUser.facebookId,
      accessToken,
    });
    const overrides = overridesByUser.get(userId) || {};
    let matched = 0;
    for (const acct of adAccounts) {
      if (!selected.has(acct.id)) continue;
      matched += 1;
      const acctKey = `act_${acct.id}`;
      // Pluck the ruleId→thresholds map for this specific account, default
      // to {} if the user hasn't customised anything for it. Shape matches
      // the `thresholdOverrides` arg accepted by metaAuditService and
      // autoScaleService — pass-through, no transformation needed.
      const acctOverrides =
        (overrides && overrides[acctKey]) ||
        (overrides && overrides[acct.id]) ||
        {};
      targets.push({
        userId,
        ...(fbUser.facebookId ? { facebookId: fbUser.facebookId } : {}),
        adAccountId: acctKey,
        accessToken,
        name: acct.name,
        currency: acct.currency,
        timezone: acct.timezone,
        severityFloor: severityByUser.get(userId) || "critical",
        thresholdOverrides: acctOverrides,
      });
    }
    if (matched === 0) {
      logger.warn(
        `[autopilot] target discovery: userId=${userId} has ${selected.size} selected account(s) but none are visible from /me/adaccounts — skipped`,
      );
    }
  }

  logger.info(
    `[autopilot] target discovery: ${userIds.length} opted-in users → ${targets.length} (user, ad-account) targets`,
  );
  return targets;
}

module.exports = {
  discoverAutopilotTargets,
  // Exposed for tests
  _internals: { listUserAdAccounts, ACCOUNTS_CACHE_TTL_SECONDS },
};
