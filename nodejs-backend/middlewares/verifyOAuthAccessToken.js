/**
 * verifyOAuthAccessToken — Express middleware that authenticates a request
 * via an OAuth Bearer JWT.
 *
 * On success, attaches:
 *   req.oauth = {
 *     userId, clientId, scopes: string[], jti, aud, exp, iat, resource,
 *     token: rawJwt,
 *   }
 *
 * On failure, returns 401 with the RFC 6750 WWW-Authenticate header set so
 * clients (Claude Code, other MCP consumers) get a well-formed error.
 *
 * This is the single place all OAuth-protected endpoints — userinfo, revoke's
 * access-token path, and eventually each MCP resource server — will call.
 * MCPs that live in a different process import the same verification logic
 * or (preferably) fetch JWKS themselves and reuse the token-scope shape.
 *
 * `requireScope(scope)` returns a follow-on middleware that enforces the
 * token carries a specific scope. Chain it after this one.
 */

const jwt = require("jsonwebtoken");
const signingKeyService = require("../services/oauth/signingKeyService");
const accessTokenBlocklist = require("../services/oauth/accessTokenBlocklist");
const {
  _internal: discoveryInternal,
} = require("../controllers/oauth/discoveryController");

function bearerError(res, error, description, status = 401) {
  const parts = [`Bearer`];
  if (error) parts.push(`error="${error}"`);
  if (description) parts.push(`error_description="${description}"`);
  res.set("WWW-Authenticate", parts.join(", "));
  return res.status(status).json({ error, error_description: description });
}

function extractBearer(req) {
  const h = req.headers?.authorization || "";
  if (!h.toLowerCase().startsWith("bearer ")) return null;
  const token = h.slice(7).trim();
  return token || null;
}

async function verifyOAuthAccessToken(req, res, next) {
  const token = extractBearer(req);
  if (!token) {
    return bearerError(res, "invalid_request", "missing Bearer access token");
  }

  // Peek at the header to find `kid` — we don't trust the payload yet.
  let header;
  try {
    const seg = token.split(".");
    if (seg.length !== 3) throw new Error("malformed");
    header = JSON.parse(Buffer.from(seg[0], "base64url").toString("utf8"));
  } catch {
    return bearerError(res, "invalid_token", "malformed JWT");
  }
  if (header.alg !== "RS256") {
    return bearerError(res, "invalid_token", "unsupported JWT alg");
  }

  const keys = await signingKeyService.getVerificationKeys();
  if (!keys.length) {
    return bearerError(res, "invalid_token", "no verification keys available", 503);
  }
  const key = header.kid
    ? keys.find((k) => k.kid === header.kid)
    : keys[0];
  if (!key) {
    return bearerError(res, "invalid_token", "unknown signing key");
  }

  let claims;
  try {
    claims = jwt.verify(token, key.public_key_pem, {
      algorithms: ["RS256"],
      issuer: discoveryInternal.getIssuer(),
    });
  } catch (e) {
    const kind = e?.name === "TokenExpiredError" ? "invalid_token" : "invalid_token";
    return bearerError(res, kind, e?.message || "verification failed");
  }

  if (claims.jti && accessTokenBlocklist.isBlocked(claims.jti)) {
    return bearerError(res, "invalid_token", "token has been revoked");
  }

  req.oauth = {
    userId: claims.sub,
    clientId: claims.client_id || claims.azp,
    scopes: (claims.scope || "").split(/\s+/).filter(Boolean),
    jti: claims.jti,
    aud: claims.aud,
    exp: claims.exp,
    iat: claims.iat,
    resource: claims.aud,
    token,
  };
  return next();
}

function requireScope(scope) {
  return (req, res, next) => {
    const scopes = req.oauth?.scopes || [];
    if (!scopes.includes(scope)) {
      return bearerError(
        res,
        "insufficient_scope",
        `required scope: ${scope}`,
        403,
      );
    }
    return next();
  };
}

module.exports = { verifyOAuthAccessToken, requireScope };
