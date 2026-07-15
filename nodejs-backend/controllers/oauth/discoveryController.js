/**
 * OAuth 2.1 / OpenID Connect discovery documents.
 *
 * Three endpoints:
 *   GET /.well-known/openid-configuration        → OIDC discovery
 *   GET /.well-known/oauth-authorization-server  → OAuth 2.0 AS metadata (RFC 8414)
 *   GET /.well-known/jwks.json                   → public signing keys (RFC 7517)
 *
 * MCP clients (Claude Code and friends) fetch one of the discovery docs to
 * auto-configure the flow, then fetch JWKS on demand to verify tokens.
 *
 * Issuer:
 *   The AS base URL, e.g. https://socket.adsgpt.io. Configurable via
 *   OAUTH_ISSUER_URL — must be HTTPS in prod and match the `iss` claim we
 *   emit on JWTs. Do not include a trailing slash.
 */

const signingKeyService = require("../../services/oauth/signingKeyService");

function getIssuer() {
  const raw = process.env.OAUTH_ISSUER_URL || "https://socket.adsgpt.io";
  return raw.replace(/\/+$/, "");
}

function baseUrls() {
  const issuer = getIssuer();
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    userinfo_endpoint: `${issuer}/oauth/userinfo`,
    registration_endpoint: `${issuer}/oauth/register`,
    revocation_endpoint: `${issuer}/oauth/revoke`,
    introspection_endpoint: `${issuer}/oauth/introspect`,
    jwks_uri: `${issuer}/.well-known/jwks.json`,
  };
}

// Scopes we currently issue. Keep in sync with the scope allowlist enforced
// at /authorize and with what MCPs advertise in their protected-resource docs.
const SUPPORTED_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "plan",
  "mcp:meta-2",
];

exports.openidConfiguration = async (_req, res) => {
  const u = baseUrls();
  res.set("Cache-Control", "public, max-age=300");
  res.json({
    ...u,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["RS256"],
    token_endpoint_auth_methods_supported: [
      "client_secret_post",
      "client_secret_basic",
      "none",
    ],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: SUPPORTED_SCOPES,
    claims_supported: ["sub", "email", "email_verified", "name", "plan"],
    // Whether Dynamic Client Registration is open. MCP clients rely on this.
    // See /oauth/register handler for the actual policy (rate-limited, but
    // otherwise open).
    registration_endpoint_auth_methods_supported: ["none"],
  });
};

exports.oauthAuthorizationServer = async (_req, res) => {
  // OAuth 2.0 AS Metadata (RFC 8414). Superset of OIDC discovery minus a few
  // OIDC-specific fields. Kept as a separate handler so we can tune each
  // independently as spec drift happens.
  const u = baseUrls();
  res.set("Cache-Control", "public, max-age=300");
  res.json({
    issuer: u.issuer,
    authorization_endpoint: u.authorization_endpoint,
    token_endpoint: u.token_endpoint,
    registration_endpoint: u.registration_endpoint,
    revocation_endpoint: u.revocation_endpoint,
    introspection_endpoint: u.introspection_endpoint,
    jwks_uri: u.jwks_uri,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: [
      "client_secret_post",
      "client_secret_basic",
      "none",
    ],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: SUPPORTED_SCOPES,
  });
};

exports.jwks = async (_req, res) => {
  try {
    const doc = await signingKeyService.getJwks();
    res.set("Cache-Control", "public, max-age=300");
    res.json(doc);
  } catch (err) {
    console.error("[oauth] JWKS build failed:", err.message);
    res.status(500).json({ error: "server_error" });
  }
};

exports._internal = { getIssuer, baseUrls, SUPPORTED_SCOPES };
