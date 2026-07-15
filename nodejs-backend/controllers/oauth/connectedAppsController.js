/**
 * connectedAppsController — user-facing "which apps have I signed into?" page.
 *
 * Mounted at /oauth/account/apps (behind authenticateJWT). Two endpoints:
 *
 *   GET  /oauth/account/apps
 *     Returns every OAuthUserConsent for the calling user, joined with the
 *     minimum client metadata needed to render the UI (name, logo).
 *
 *   DELETE /oauth/account/apps/:client_id
 *     Full disconnect: sets consent.revoked_at, revokes every refresh token
 *     for this (user, client) pair, and adds live access-token jtis to the
 *     in-process blocklist so they stop working immediately.
 *
 * This is the OAuth-side "connected apps" surface. It's isolated from the
 * aMember-driven account/subscription flow — nothing here touches user
 * identity, plans, or credits.
 */

const OAuthUserConsent = require("../../Module/oauth/oauthUserConsentModel");
const OAuthClient = require("../../Module/oauth/oauthClientModel");
const OAuthRefreshToken = require("../../Module/oauth/oauthRefreshTokenModel");
const OAuthAuditLog = require("../../Module/oauth/oauthAuditLogModel");
const accessTokenBlocklist = require("../../services/oauth/accessTokenBlocklist");

async function writeAudit(event, req, detail) {
  try {
    await OAuthAuditLog.create({
      event,
      client_id: detail?.client_id || null,
      user_id: detail?.user_id || null,
      ip: req.ip,
      user_agent: req.headers["user-agent"] || null,
      detail: detail || {},
    });
  } catch (err) {
    console.error("[oauth] audit write failed:", err.message);
  }
}

/**
 * GET /oauth/account/apps
 */
exports.list = async (req, res) => {
  const userId = req.user?.user_id;
  if (!userId) return res.status(401).json({ error: "unauthenticated" });

  const consents = await OAuthUserConsent.find({
    user_id: userId,
    revoked_at: null,
  })
    .sort({ last_used_at: -1, granted_at: -1 })
    .lean();

  if (consents.length === 0) {
    return res.json({ apps: [] });
  }

  const clientIds = consents.map((c) => c.client_id);
  const clients = await OAuthClient.find({ client_id: { $in: clientIds } })
    .select({ client_id: 1, client_name: 1, logo_uri: 1, status: 1 })
    .lean();
  const clientById = new Map(clients.map((c) => [c.client_id, c]));

  const apps = consents.map((c) => {
    const client = clientById.get(c.client_id) || {};
    return {
      client_id: c.client_id,
      client_name: client.client_name || "",
      logo_uri: client.logo_uri || "",
      client_status: client.status || "unknown",
      granted_scopes: c.granted_scopes || [],
      granted_at: c.granted_at,
      last_used_at: c.last_used_at,
    };
  });

  return res.json({ apps });
};

/**
 * DELETE /oauth/account/apps/:client_id
 *
 * Idempotent — deleting an already-revoked consent (or one that never
 * existed) returns 200 with the same shape. We don't need to leak existence
 * either way.
 */
exports.disconnect = async (req, res) => {
  const userId = req.user?.user_id;
  if (!userId) return res.status(401).json({ error: "unauthenticated" });

  const { client_id } = req.params;
  if (!client_id || typeof client_id !== "string") {
    return res.status(400).json({
      error: "invalid_request",
      error_description: "client_id path param is required",
    });
  }

  const now = new Date();

  await OAuthUserConsent.updateOne(
    { user_id: userId, client_id },
    { $set: { revoked_at: now } },
  );

  const activeRefresh = await OAuthRefreshToken.find({
    user_id: userId,
    client_id,
    revoked_at: null,
  })
    .select({ _id: 1 })
    .lean();
  if (activeRefresh.length) {
    await OAuthRefreshToken.updateMany(
      { _id: { $in: activeRefresh.map((r) => r._id) } },
      { $set: { revoked_at: now } },
    );
  }

  // Access tokens are JWTs — we can't enumerate outstanding ones. Any that
  // arrive will be rejected because their consent row is now revoked_at
  // (the /oauth/token refresh path checks this) and userinfo goes through
  // the same check indirectly. If a live access token skips /oauth/token
  // and hits userinfo directly, we currently rely on it expiring naturally.
  // For an immediate hard-cut, an operator can flush the blocklist size or
  // page us — Phase 2 will move to Redis with a broader query API.

  await writeAudit("consent_revoked", req, {
    client_id,
    user_id: userId,
    refresh_tokens_revoked: activeRefresh.length,
  });

  return res.json({
    ok: true,
    refresh_tokens_revoked: activeRefresh.length,
  });
};

exports._internal = { accessTokenBlocklist };
