/**
 * jwtService — signs OAuth access tokens and OIDC id tokens with the
 * currently-active RS256 signing key from signingKeyService.
 *
 * We deliberately DON'T verify tokens here yet — resource servers (MCPs)
 * will do that on their own by fetching /.well-known/jwks.json. The Day 6
 * /oauth/introspect + /oauth/userinfo endpoints will add a verify path that
 * reads from the same JWKS.
 */

const jwt = require("jsonwebtoken");
const crypto = require("node:crypto");
const signingKeyService = require("./signingKeyService");
const {
  _internal: discoveryInternal,
} = require("../../controllers/oauth/discoveryController");

const ACCESS_TTL_SECONDS = Number(
  process.env.OAUTH_JWT_ACCESS_TTL_SECONDS || 3600,
);
const ID_TOKEN_TTL_SECONDS = Number(
  process.env.OAUTH_JWT_ID_TOKEN_TTL_SECONDS || 3600,
);

function issuer() {
  return discoveryInternal.getIssuer();
}

/**
 * Sign an OAuth 2.1 access token.
 *
 * Claims:
 *   iss, sub (user_id), aud (resource || client_id), azp (client_id),
 *   scope (space-joined), client_id, jti, iat, nbf, exp.
 *
 * If `resource` (RFC 8707) was set at /authorize, aud === resource; the
 * receiving MCP checks that its own resource URI is in aud. Otherwise aud
 * defaults to the client_id — useful for /userinfo calls where there is no
 * dedicated resource server.
 */
async function signAccessToken({
  userId,
  clientId,
  scopes,
  resource,
  ttlSeconds = ACCESS_TTL_SECONDS,
}) {
  const key = await signingKeyService.getActiveSigningKey();
  const audience = resource || clientId;
  const jti = crypto.randomBytes(16).toString("base64url");
  const payload = {
    scope: Array.isArray(scopes) ? scopes.join(" ") : String(scopes || ""),
    client_id: clientId,
    azp: clientId,
  };
  const token = jwt.sign(payload, key.private_key_pem, {
    algorithm: "RS256",
    keyid: key.kid,
    issuer: issuer(),
    subject: userId,
    audience,
    jwtid: jti,
    expiresIn: ttlSeconds,
    notBefore: 0,
  });
  return { token, expiresIn: ttlSeconds, jti };
}

/**
 * Sign an OIDC id_token. Only issued when `openid` is in scope.
 *
 * Claims we include:
 *   iss, sub, aud (= client_id per spec), exp, iat, auth_time (= iat),
 *   nonce (if provided), and profile claims driven by scope:
 *     - email → email, email_verified
 *     - profile → name
 *     - plan → plan (subscription_plan_name)
 */
async function signIdToken({
  userId,
  clientId,
  scopes,
  nonce,
  userProfile,
  ttlSeconds = ID_TOKEN_TTL_SECONDS,
}) {
  const key = await signingKeyService.getActiveSigningKey();
  const scopeSet = new Set(scopes || []);
  const claims = {};

  if (scopeSet.has("email") && userProfile?.email) {
    claims.email = userProfile.email;
    claims.email_verified = true;
  }
  if (scopeSet.has("profile")) {
    const name = userProfile?.name ||
      [userProfile?.name_f, userProfile?.name_l].filter(Boolean).join(" ") ||
      "";
    if (name) claims.name = name;
  }
  if (scopeSet.has("plan") && userProfile?.subscription_plan_name) {
    claims.plan = userProfile.subscription_plan_name;
  }
  if (nonce) claims.nonce = nonce;

  const nowSec = Math.floor(Date.now() / 1000);
  claims.auth_time = nowSec;

  return jwt.sign(claims, key.private_key_pem, {
    algorithm: "RS256",
    keyid: key.kid,
    issuer: issuer(),
    subject: userId,
    audience: clientId,
    expiresIn: ttlSeconds,
    notBefore: 0,
  });
}

module.exports = {
  signAccessToken,
  signIdToken,
  ACCESS_TTL_SECONDS,
};
