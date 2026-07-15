/**
 * POST /oauth/revoke — RFC 7009 token revocation.
 *
 * Body (form-encoded or JSON):
 *   token             the token to revoke (required)
 *   token_type_hint   "refresh_token" | "access_token" (optional; we probe)
 *
 * Client auth is required (same rules as /oauth/token — Basic or body,
 * public clients present only client_id).
 *
 * Response:
 *   200 with empty body, regardless of whether the token existed / was
 *   already revoked / belonged to a different client. RFC 7009 §2.2 mandates
 *   200 in the "unknown token" case so attackers cannot enumerate valid
 *   tokens by watching status codes.
 *
 * Behavior:
 *   - Refresh token → sha256 lookup, mark revoked. The family stays intact
 *     (this is user-initiated cleanup, not a breach signal); a subsequent
 *     rotation attempt would fail on revoked_at != null.
 *   - Access token JWT → verify signature, add jti to accessTokenBlocklist
 *     until natural expiry. Bearer middleware will reject on next use.
 *   - client_id must own the token; presenting someone else's token is a
 *     silent no-op (200 with nothing done).
 */

const jwt = require("jsonwebtoken");
const OAuthClient = require("../../Module/oauth/oauthClientModel");
const OAuthRefreshToken = require("../../Module/oauth/oauthRefreshTokenModel");
const OAuthAuditLog = require("../../Module/oauth/oauthAuditLogModel");
const signingKeyService = require("../../services/oauth/signingKeyService");
const accessTokenBlocklist = require("../../services/oauth/accessTokenBlocklist");
const {
  verifyClientSecret,
  sha256Hex,
} = require("../../services/oauth/clientSecretService");
const {
  _internal: discoveryInternal,
} = require("./discoveryController");

function parseBasicAuth(header) {
  if (!header || typeof header !== "string") return null;
  const parts = header.split(" ");
  if (parts.length !== 2 || parts[0].toLowerCase() !== "basic") return null;
  const decoded = Buffer.from(parts[1], "base64").toString("utf8");
  const idx = decoded.indexOf(":");
  if (idx < 0) return null;
  return {
    client_id: decodeURIComponent(decoded.slice(0, idx)),
    client_secret: decodeURIComponent(decoded.slice(idx + 1)),
  };
}

async function authenticateClient(req) {
  const basic = parseBasicAuth(req.headers.authorization);
  const bodyClientId = req.body?.client_id;
  const bodySecret = req.body?.client_secret;
  const clientId = basic?.client_id || bodyClientId;
  if (!clientId) throw { status: 400, error: "invalid_request" };

  const client = await OAuthClient.findOne({ client_id: clientId }).lean();
  if (!client) throw { status: 401, error: "invalid_client" };
  if (client.status !== "active") {
    throw { status: 401, error: "invalid_client" };
  }
  if (client.token_endpoint_auth_method === "none") {
    if (basic || bodySecret) throw { status: 401, error: "invalid_client" };
    return { client, clientId };
  }
  const secret = basic?.client_secret ?? bodySecret;
  if (!secret || !verifyClientSecret(secret, client.client_secret_hash)) {
    throw { status: 401, error: "invalid_client" };
  }
  return { client, clientId };
}

async function tryRevokeRefresh(token, clientId, req) {
  const hash = sha256Hex(token);
  const row = await OAuthRefreshToken.findOne({ token_hash: hash });
  if (!row) return false;
  if (row.client_id !== clientId) return false; // silent no-op
  if (row.revoked_at) return true;
  await OAuthRefreshToken.updateOne(
    { _id: row._id, revoked_at: null },
    { $set: { revoked_at: new Date() } },
  );
  await OAuthAuditLog.create({
    event: "token_revoked",
    client_id: clientId,
    user_id: row.user_id,
    ip: req.ip,
    user_agent: req.headers["user-agent"] || null,
    detail: { kind: "refresh_token" },
  }).catch(() => {});
  return true;
}

async function tryRevokeAccess(token, clientId, req) {
  // Decode without verifying first — we need `kid` from header.
  let header;
  try {
    header = JSON.parse(
      Buffer.from(token.split(".")[0], "base64url").toString("utf8"),
    );
  } catch {
    return false;
  }
  const keys = await signingKeyService.getVerificationKeys();
  const key = header.kid
    ? keys.find((k) => k.kid === header.kid)
    : keys[0];
  if (!key) return false;

  let claims;
  try {
    claims = jwt.verify(token, key.public_key_pem, {
      algorithms: ["RS256"],
      issuer: discoveryInternal.getIssuer(),
    });
  } catch {
    return false;
  }

  const tokenClient = claims.client_id || claims.azp;
  if (tokenClient !== clientId) return false; // silent no-op

  if (claims.jti && claims.exp) {
    accessTokenBlocklist.block(claims.jti, claims.exp);
    await OAuthAuditLog.create({
      event: "token_revoked",
      client_id: clientId,
      user_id: claims.sub,
      ip: req.ip,
      user_agent: req.headers["user-agent"] || null,
      detail: { kind: "access_token", jti: claims.jti },
    }).catch(() => {});
    return true;
  }
  return false;
}

exports.revoke = async (req, res) => {
  let clientId;
  try {
    ({ clientId } = await authenticateClient(req));
  } catch (e) {
    // Client auth errors DO get an error status — spec §2.2 only mandates
    // 200 for "unknown token", not "unknown client".
    res.set("Cache-Control", "no-store");
    return res
      .status(e.status || 401)
      .json({ error: e.error || "invalid_client" });
  }

  const { token, token_type_hint } = req.body || {};
  if (!token || typeof token !== "string") {
    res.set("Cache-Control", "no-store");
    return res
      .status(400)
      .json({ error: "invalid_request", error_description: "token is required" });
  }

  // Try the hinted kind first, then fall back — this is a hint, not gospel.
  const isJwt = token.split(".").length === 3;
  const order =
    token_type_hint === "access_token"
      ? [tryRevokeAccess, tryRevokeRefresh]
      : token_type_hint === "refresh_token"
        ? [tryRevokeRefresh, tryRevokeAccess]
        : isJwt
          ? [tryRevokeAccess, tryRevokeRefresh]
          : [tryRevokeRefresh, tryRevokeAccess];

  for (const attempt of order) {
    const done = await attempt(token, clientId, req);
    if (done) break;
  }

  // Always 200 — spec §2.2.
  res.set("Cache-Control", "no-store");
  return res.status(200).end();
};
