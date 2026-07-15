/**
 * POST /oauth/register — Dynamic Client Registration (RFC 7591).
 *
 * Claude Code and other MCP clients call this on first connect to obtain a
 * client_id (+ client_secret for confidential clients). Anonymous — the
 * request itself is not authenticated. Abuse is contained by:
 *
 *   1. A dedicated rate limiter (see dcrLimiter in middlewares/rateLimitMiddleware).
 *   2. Optional allowlist of client_name prefixes via OAUTH_DCR_ALLOWED_NAMES.
 *   3. redirect_uri hygiene checks (HTTPS, no wildcards, loopback exception).
 *   4. Scope allowlist — clients cannot self-grant scopes they didn't ask for
 *      and we cap the requested scope set at what the AS supports.
 *
 * Response is exactly the RFC 7591 shape. client_secret is returned ONCE in
 * plaintext; we never echo it again.
 */

const Joi = require("joi");
const OAuthClient = require("../../Module/oauth/oauthClientModel");
const OAuthAuditLog = require("../../Module/oauth/oauthAuditLogModel");
const {
  generateClientId,
  generateRandomToken,
  hashClientSecret,
} = require("../../services/oauth/clientSecretService");
const {
  validateRedirectUri,
} = require("../../services/oauth/redirectUriValidator");
const {
  _internal: discoveryInternal,
} = require("./discoveryController");

const SUPPORTED_SCOPES = discoveryInternal.SUPPORTED_SCOPES;

// Grants + auth methods we allow a client to self-declare via DCR. Anything
// outside these lists gets replaced with the default.
const ALLOWED_GRANT_TYPES = new Set(["authorization_code", "refresh_token"]);
const ALLOWED_RESPONSE_TYPES = new Set(["code"]);
const ALLOWED_AUTH_METHODS = new Set([
  "client_secret_post",
  "client_secret_basic",
  "none",
]);

const registerSchema = Joi.object({
  client_name: Joi.string().trim().max(200).optional(),
  client_uri: Joi.string().uri().max(2048).optional(),
  logo_uri: Joi.string().uri().max(2048).optional(),
  redirect_uris: Joi.array().items(Joi.string()).min(1).max(10).required(),
  grant_types: Joi.array().items(Joi.string()).max(10).optional(),
  response_types: Joi.array().items(Joi.string()).max(10).optional(),
  token_endpoint_auth_method: Joi.string()
    .valid(...ALLOWED_AUTH_METHODS)
    .optional(),
  scope: Joi.string().max(1024).optional(),
  // Ignore any RFC 7591 fields we don't use — DCR is designed to be forward-
  // compatible, so unknown fields shouldn't 400.
}).unknown(true);

function dcrError(res, status, error, description) {
  return res.status(status).json({ error, error_description: description });
}

function parseScopeString(scope) {
  if (!scope) return null;
  return scope
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function writeAudit(event, req, detail) {
  try {
    await OAuthAuditLog.create({
      event,
      client_id: detail?.client_id || null,
      ip: req.ip,
      user_agent: req.headers["user-agent"] || null,
      detail: detail || {},
    });
  } catch (err) {
    console.error("[oauth] audit write failed:", err.message);
  }
}

exports.register = async (req, res) => {
  const { value: body, error: validationError } = registerSchema.validate(
    req.body,
    { abortEarly: false, stripUnknown: false },
  );
  if (validationError) {
    return dcrError(
      res,
      400,
      "invalid_client_metadata",
      validationError.details.map((d) => d.message).join("; "),
    );
  }

  // ----- redirect_uris -----
  for (const uri of body.redirect_uris) {
    const check = validateRedirectUri(uri);
    if (!check.ok) {
      return dcrError(
        res,
        400,
        "invalid_redirect_uri",
        `${uri}: ${check.reason}`,
      );
    }
  }

  // ----- grant_types / response_types -----
  const grantTypes =
    Array.isArray(body.grant_types) && body.grant_types.length
      ? body.grant_types.filter((g) => ALLOWED_GRANT_TYPES.has(g))
      : ["authorization_code", "refresh_token"];
  if (grantTypes.length === 0) {
    return dcrError(
      res,
      400,
      "invalid_client_metadata",
      "no supported grant_types requested",
    );
  }

  const responseTypes =
    Array.isArray(body.response_types) && body.response_types.length
      ? body.response_types.filter((r) => ALLOWED_RESPONSE_TYPES.has(r))
      : ["code"];
  if (
    grantTypes.includes("authorization_code") &&
    !responseTypes.includes("code")
  ) {
    return dcrError(
      res,
      400,
      "invalid_client_metadata",
      "authorization_code grant requires response_type=code",
    );
  }

  // ----- token endpoint auth method -----
  // MCP clients like Claude Code are public (native/CLI), so they'll declare
  // "none" and use PKCE. If none is declared, force PKCE and issue no secret.
  const authMethod =
    body.token_endpoint_auth_method &&
    ALLOWED_AUTH_METHODS.has(body.token_endpoint_auth_method)
      ? body.token_endpoint_auth_method
      : "none";
  const isPublic = authMethod === "none";

  // ----- scope allowlist -----
  const requestedScopes = parseScopeString(body.scope);
  let allowedScopes;
  if (requestedScopes && requestedScopes.length) {
    const bad = requestedScopes.filter((s) => !SUPPORTED_SCOPES.includes(s));
    if (bad.length) {
      return dcrError(
        res,
        400,
        "invalid_client_metadata",
        `unsupported scope(s): ${bad.join(", ")}`,
      );
    }
    allowedScopes = requestedScopes;
  } else {
    // If the client didn't ask for anything, default to identity-only.
    allowedScopes = ["openid", "profile", "email"];
  }

  // ----- optional name allowlist (soft gate against random name-hijacks) -----
  // OAUTH_DCR_ALLOWED_NAMES is a comma-separated list of case-insensitive
  // prefixes. If set and non-empty, client_name must start with one of them.
  const nameGate = (process.env.OAUTH_DCR_ALLOWED_NAMES || "").trim();
  if (nameGate) {
    const prefixes = nameGate
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const name = (body.client_name || "").toLowerCase();
    if (!prefixes.some((p) => name.startsWith(p))) {
      return dcrError(
        res,
        403,
        "access_denied",
        "client_name not on DCR allowlist",
      );
    }
  }

  // ----- create -----
  const clientId = generateClientId();
  let plaintextSecret = null;
  let secretHash = null;
  if (!isPublic) {
    plaintextSecret = generateRandomToken(32);
    secretHash = hashClientSecret(plaintextSecret);
  }

  const doc = await OAuthClient.create({
    client_id: clientId,
    client_secret_hash: secretHash,
    client_name: body.client_name || "",
    client_uri: body.client_uri || "",
    logo_uri: body.logo_uri || "",
    redirect_uris: body.redirect_uris,
    grant_types: grantTypes,
    response_types: responseTypes,
    token_endpoint_auth_method: authMethod,
    allowed_scopes: allowedScopes,
    registered_via: "dcr",
    status: "active",
  });

  await writeAudit("client_registered", req, {
    client_id: clientId,
    client_name: doc.client_name,
    redirect_uris: doc.redirect_uris,
    auth_method: authMethod,
    scopes: allowedScopes,
  });

  // RFC 7591 response
  const nowSec = Math.floor(Date.now() / 1000);
  const response = {
    client_id: doc.client_id,
    client_id_issued_at: nowSec,
    client_secret_expires_at: 0,
    client_name: doc.client_name,
    redirect_uris: doc.redirect_uris,
    grant_types: doc.grant_types,
    response_types: doc.response_types,
    token_endpoint_auth_method: doc.token_endpoint_auth_method,
    scope: allowedScopes.join(" "),
  };
  if (plaintextSecret) {
    response.client_secret = plaintextSecret;
  }

  return res.status(201).json(response);
};
