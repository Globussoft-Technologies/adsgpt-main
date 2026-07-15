/**
 * POST /oauth/token — the OAuth 2.1 token endpoint.
 *
 * Two grant types supported:
 *   grant_type=authorization_code — exchanges an auth code (+ PKCE verifier) for
 *     an access_token, refresh_token, and (if openid scope) an id_token.
 *   grant_type=refresh_token — rotates a refresh token, issuing a new pair.
 *
 * Client authentication:
 *   - Confidential clients present client_secret via HTTP Basic OR request body.
 *   - Public clients present only client_id + PKCE proof.
 *
 * Replay + theft signals:
 *   - Auth code reused → invalid_grant + revoke every refresh token issued
 *     from that code's session.
 *   - Refresh token already revoked → same family invalidated (RFC 6749 §10.4).
 *
 * Body may arrive JSON-encoded or urlencoded (RFC form). We just read
 * req.body — Express is configured with both parsers upstream.
 */

const crypto = require("node:crypto");
const OAuthClient = require("../../Module/oauth/oauthClientModel");
const OAuthAuthorizationCode = require("../../Module/oauth/oauthAuthCodeModel");
const OAuthRefreshToken = require("../../Module/oauth/oauthRefreshTokenModel");
const OAuthUserConsent = require("../../Module/oauth/oauthUserConsentModel");
const OAuthAuditLog = require("../../Module/oauth/oauthAuditLogModel");
const UserProfile = require("../../Module/user/userProfileModel");
const {
  signAccessToken,
  signIdToken,
  ACCESS_TTL_SECONDS,
} = require("../../services/oauth/jwtService");
const {
  verifyClientSecret,
  sha256Hex,
  generateRandomToken,
} = require("../../services/oauth/clientSecretService");

const REFRESH_TTL_SECONDS = Number(
  process.env.OAUTH_REFRESH_TOKEN_TTL_SECONDS || 30 * 24 * 60 * 60,
);

// ─── error helpers ─────────────────────────────────────────────────────────

function tokenError(res, status, error, description) {
  return res.status(status).set("Cache-Control", "no-store").json({
    error,
    error_description: description,
  });
}

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

// ─── client authentication ─────────────────────────────────────────────────

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

/**
 * Returns { client, clientId } or throws { status, error, description }.
 * Handles all three token_endpoint_auth_methods.
 */
async function authenticateClient(req) {
  const basic = parseBasicAuth(req.headers.authorization);
  const bodyClientId = req.body?.client_id;
  const bodySecret = req.body?.client_secret;

  const clientId = basic?.client_id || bodyClientId;
  if (!clientId || typeof clientId !== "string") {
    throw { status: 400, error: "invalid_request", description: "client_id is required" };
  }
  const client = await OAuthClient.findOne({ client_id: clientId }).lean();
  if (!client) {
    throw { status: 401, error: "invalid_client", description: "unknown client_id" };
  }
  if (client.status !== "active") {
    throw {
      status: 401,
      error: "invalid_client",
      description: "client is suspended",
    };
  }

  const method = client.token_endpoint_auth_method;
  if (method === "none") {
    // Public client — no secret expected. PKCE will do the auth work.
    if (basic || bodySecret) {
      throw {
        status: 401,
        error: "invalid_client",
        description: "public client MUST NOT present client_secret",
      };
    }
    return { client, clientId };
  }

  // Confidential — verify secret.
  const secret = basic?.client_secret ?? bodySecret;
  if (!secret) {
    throw {
      status: 401,
      error: "invalid_client",
      description: "client_secret is required for confidential clients",
    };
  }
  if (!verifyClientSecret(secret, client.client_secret_hash)) {
    throw {
      status: 401,
      error: "invalid_client",
      description: "client_secret is invalid",
    };
  }
  return { client, clientId };
}

// ─── PKCE verification ─────────────────────────────────────────────────────

function verifyPkce(codeVerifier, storedChallenge) {
  if (!codeVerifier || typeof codeVerifier !== "string") return false;
  if (codeVerifier.length < 43 || codeVerifier.length > 128) return false;
  if (/[^A-Za-z0-9\-_.~]/.test(codeVerifier)) return false;
  const computed = crypto
    .createHash("sha256")
    .update(codeVerifier)
    .digest();
  const expectedBuf = Buffer.from(storedChallenge, "base64url");
  if (expectedBuf.length !== computed.length) return false;
  return crypto.timingSafeEqual(computed, expectedBuf);
}

// ─── refresh token issuance / rotation ────────────────────────────────────

async function issueRefreshToken({
  userId,
  clientId,
  scopes,
  resource,
  familyId,
  parentTokenHash,
  req,
}) {
  const plaintext = generateRandomToken(32);
  const hash = sha256Hex(plaintext);
  const expiresAt = new Date(Date.now() + REFRESH_TTL_SECONDS * 1000);
  await OAuthRefreshToken.create({
    token_hash: hash,
    client_id: clientId,
    user_id: userId,
    scopes,
    resource: resource || null,
    family_id: familyId,
    parent_token_hash: parentTokenHash || null,
    expires_at: expiresAt,
    ip_last_used: req.ip || null,
    ua_last_used: req.headers["user-agent"] || null,
    last_used_at: new Date(),
  });
  return plaintext;
}

async function revokeFamily(familyId, reason) {
  await OAuthRefreshToken.updateMany(
    { family_id: familyId, revoked_at: null },
    { $set: { revoked_at: new Date() } },
  );
  console.warn(`[oauth] refresh family revoked ${familyId}: ${reason}`);
}

// ─── grant handlers ────────────────────────────────────────────────────────

async function handleAuthorizationCode(req, res, client, clientId) {
  const { code, redirect_uri, code_verifier } = req.body || {};

  if (!code || typeof code !== "string") {
    return tokenError(res, 400, "invalid_request", "code is required");
  }
  if (!redirect_uri || typeof redirect_uri !== "string") {
    return tokenError(res, 400, "invalid_request", "redirect_uri is required");
  }

  // ATOMIC single-use claim: only succeed if the row exists, is unused, and
  // not expired. If claim fails we do a follow-up read to differentiate
  // replay from expiry.
  const now = new Date();
  const claimed = await OAuthAuthorizationCode.findOneAndUpdate(
    { code, used_at: null, expires_at: { $gt: now } },
    { $set: { used_at: now } },
    { new: false },
  ).lean();

  if (!claimed) {
    // Not claimable. Was it used already, or just gone?
    const existing = await OAuthAuthorizationCode.findOne({ code }).lean();
    if (existing?.used_at) {
      // REPLAY. Any tokens issued from this code's session (family_id
      // seeded off the code) get invalidated.
      const family = sha256Hex(code);
      await revokeFamily(family, "auth code replay");
      await writeAudit("code_replay_detected", req, {
        client_id: clientId,
        code_hint: code.slice(0, 8) + "…",
      });
    }
    return tokenError(res, 400, "invalid_grant", "authorization code is invalid or expired");
  }

  if (claimed.client_id !== clientId) {
    // Very suspicious — someone stole a code and is trying to redeem it as
    // a different client. Nuke the family too.
    const family = sha256Hex(code);
    await revokeFamily(family, "auth code presented to wrong client");
    await writeAudit("code_wrong_client", req, {
      client_id: clientId,
      code_owner: claimed.client_id,
    });
    return tokenError(res, 400, "invalid_grant", "code was not issued to this client");
  }

  if (claimed.redirect_uri !== redirect_uri) {
    return tokenError(res, 400, "invalid_grant", "redirect_uri does not match the one used at /authorize");
  }

  // PKCE. Public clients always required PKCE at /authorize, so a challenge
  // must be present on `claimed`. Confidential clients may or may not have.
  if (claimed.code_challenge) {
    if (!code_verifier) {
      return tokenError(res, 400, "invalid_grant", "code_verifier is required (PKCE)");
    }
    if (!verifyPkce(code_verifier, claimed.code_challenge)) {
      return tokenError(res, 400, "invalid_grant", "PKCE verification failed");
    }
  }

  // Consent must still be valid — user could have revoked between /authorize and now.
  const consent = await OAuthUserConsent.findOne({
    user_id: claimed.user_id,
    client_id: clientId,
  }).lean();
  if (!consent || consent.revoked_at) {
    return tokenError(res, 400, "invalid_grant", "user consent has been revoked");
  }

  // Look up user for id_token claims.
  const profile = await UserProfile.findOne({ user_id: claimed.user_id }).lean();

  // Sign tokens.
  const { token: accessToken, expiresIn } = await signAccessToken({
    userId: claimed.user_id,
    clientId,
    scopes: claimed.scopes,
    resource: claimed.resource,
  });

  // Refresh: family_id is derived from the auth code so replay detection can
  // find the family without looking up the RT record.
  const familyId = sha256Hex(claimed.code);
  const refreshToken = await issueRefreshToken({
    userId: claimed.user_id,
    clientId,
    scopes: claimed.scopes,
    resource: claimed.resource,
    familyId,
    parentTokenHash: null,
    req,
  });

  const response = {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: expiresIn,
    refresh_token: refreshToken,
    scope: claimed.scopes.join(" "),
  };
  if (claimed.scopes.includes("openid")) {
    response.id_token = await signIdToken({
      userId: claimed.user_id,
      clientId,
      scopes: claimed.scopes,
      nonce: claimed.nonce,
      userProfile: profile,
    });
  }

  await OAuthUserConsent.updateOne(
    { user_id: claimed.user_id, client_id: clientId },
    { $set: { last_used_at: new Date() } },
  );
  await writeAudit("token_issued", req, {
    client_id: clientId,
    user_id: claimed.user_id,
    grant: "authorization_code",
    scopes: claimed.scopes,
  });

  res.set("Cache-Control", "no-store");
  return res.json(response);
}

async function handleRefreshToken(req, res, client, clientId) {
  const { refresh_token: presented, scope: scopeRestrict } = req.body || {};

  if (!presented || typeof presented !== "string") {
    return tokenError(res, 400, "invalid_request", "refresh_token is required");
  }

  const hash = sha256Hex(presented);
  const row = await OAuthRefreshToken.findOne({ token_hash: hash }).lean();
  if (!row) {
    return tokenError(res, 400, "invalid_grant", "refresh_token not recognized");
  }

  // Replay: presented token was already rotated out. Invalidate the family.
  if (row.revoked_at) {
    await revokeFamily(row.family_id, "revoked refresh token presented (replay)");
    await writeAudit("refresh_replay_detected", req, {
      client_id: clientId,
      user_id: row.user_id,
      family_id: row.family_id,
    });
    return tokenError(res, 400, "invalid_grant", "refresh_token has been revoked");
  }

  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
    return tokenError(res, 400, "invalid_grant", "refresh_token has expired");
  }

  if (row.client_id !== clientId) {
    // Never trust a cross-client presentation. Revoke family.
    await revokeFamily(row.family_id, "refresh presented to wrong client");
    await writeAudit("refresh_wrong_client", req, {
      client_id: clientId,
      family_id: row.family_id,
    });
    return tokenError(res, 400, "invalid_grant", "refresh_token was not issued to this client");
  }

  // Consent revocation kills all refreshes.
  const consent = await OAuthUserConsent.findOne({
    user_id: row.user_id,
    client_id: clientId,
  }).lean();
  if (!consent || consent.revoked_at) {
    await revokeFamily(row.family_id, "user consent revoked");
    return tokenError(res, 400, "invalid_grant", "user consent has been revoked");
  }

  // Optional scope narrowing (RFC 6749 §6). Must be subset of original.
  let newScopes = row.scopes;
  if (scopeRestrict && typeof scopeRestrict === "string") {
    const requested = scopeRestrict.split(/\s+/).filter(Boolean);
    const outside = requested.filter((s) => !row.scopes.includes(s));
    if (outside.length) {
      return tokenError(res, 400, "invalid_scope", `scope(s) not in original grant: ${outside.join(", ")}`);
    }
    newScopes = requested;
  }

  const profile = await UserProfile.findOne({ user_id: row.user_id }).lean();

  // Rotate: revoke old, issue new access + new refresh chained via family_id.
  await OAuthRefreshToken.updateOne(
    { _id: row._id, revoked_at: null },
    { $set: { revoked_at: new Date() } },
  );

  const { token: accessToken, expiresIn } = await signAccessToken({
    userId: row.user_id,
    clientId,
    scopes: newScopes,
    resource: row.resource,
  });
  const newRefresh = await issueRefreshToken({
    userId: row.user_id,
    clientId,
    scopes: newScopes,
    resource: row.resource,
    familyId: row.family_id,
    parentTokenHash: hash,
    req,
  });

  const response = {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: expiresIn,
    refresh_token: newRefresh,
    scope: newScopes.join(" "),
  };
  if (newScopes.includes("openid")) {
    response.id_token = await signIdToken({
      userId: row.user_id,
      clientId,
      scopes: newScopes,
      userProfile: profile,
    });
  }

  await writeAudit("refresh_rotated", req, {
    client_id: clientId,
    user_id: row.user_id,
    family_id: row.family_id,
  });

  res.set("Cache-Control", "no-store");
  return res.json(response);
}

// ─── entry point ───────────────────────────────────────────────────────────

exports.token = async (req, res) => {
  let client, clientId;
  try {
    ({ client, clientId } = await authenticateClient(req));
  } catch (e) {
    return tokenError(
      res,
      e.status || 400,
      e.error || "invalid_client",
      e.description || "client authentication failed",
    );
  }

  const grantType = req.body?.grant_type;
  if (grantType === "authorization_code") {
    return handleAuthorizationCode(req, res, client, clientId);
  }
  if (grantType === "refresh_token") {
    return handleRefreshToken(req, res, client, clientId);
  }
  return tokenError(
    res,
    400,
    "unsupported_grant_type",
    `grant_type "${grantType}" is not supported`,
  );
};
