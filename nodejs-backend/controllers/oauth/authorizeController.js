/**
 * GET /oauth/authorize — the entry point of the authorization_code flow.
 *
 * Validates every OAuth param + the client registration, then:
 *   - Hard-error HTML if we can't safely redirect back (bad client_id, bad
 *     redirect_uri, suspended client).
 *   - OAuth error 302 back to redirect_uri if the redirect target is trusted
 *     (invalid_request, invalid_scope, unsupported_response_type, etc.).
 *   - If not signed in → 302 to the aMember login with a returnTo pointing
 *     back at this /authorize URL.
 *   - If signed in → RENDER THE CONSENT HTML directly. Form POSTs back to
 *     /oauth/consent.
 *
 * The consent UI is served from this backend — the frontend React app is
 * NOT involved in the OAuth flow. Rendering happens in consentHtml.js.
 *
 * Error-redirect discipline (RFC 6749 §4.1.2.1):
 *   Bad client_id / unknown redirect_uri / suspended client MUST NOT redirect
 *   back — the redirect target is untrusted. Every OTHER error condition
 *   redirects the browser back to redirect_uri with error params + state.
 */

const OAuthClient = require("../../Module/oauth/oauthClientModel");
const OAuthAuditLog = require("../../Module/oauth/oauthAuditLogModel");
const UserProfile = require("../../Module/user/userProfileModel");
const { signTicket } = require("../../services/oauth/authorizeTicketService");
const { verifyAdsGptSession } = require("../../services/oauth/sessionCheck");
const { renderConsentPage } = require("./consentHtml");
const {
  _internal: discoveryInternal,
} = require("./discoveryController");

const SUPPORTED_SCOPES = discoveryInternal.SUPPORTED_SCOPES;

function loginUrl(returnToAbsoluteUrl) {
  const base = (process.env.AMEMBER_URL || process.env.VITE_AMEMBER_URL || "").replace(/\/+$/, "");
  if (!base) return null;
  return `${base}/login?amember_redirect_url=${encodeURIComponent(returnToAbsoluteUrl)}`;
}

function absoluteAuthorizeUrl(req) {
  // Reconstruct the URL the caller is on so the login flow can return here.
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "http";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}${req.originalUrl || req.url}`;
}

function hardError(res, status, code, description) {
  res.status(status).type("text/html").send(`
    <!doctype html>
    <html><head><meta charset="utf-8"><title>Authorization error</title></head>
    <body style="font-family:system-ui,sans-serif;max-width:640px;margin:64px auto;padding:0 16px;color:#111">
      <h1 style="font-size:20px">Authorization error</h1>
      <p><strong>${escapeHtml(code)}</strong></p>
      <p>${escapeHtml(description)}</p>
      <p style="color:#666;font-size:13px">If you were sent here by an application, tell them their OAuth configuration is invalid. This request was not redirected back for security.</p>
    </body></html>`);
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function redirectError(res, redirectUri, code, description, state) {
  const u = new URL(redirectUri);
  u.searchParams.set("error", code);
  if (description) u.searchParams.set("error_description", description);
  if (state) u.searchParams.set("state", state);
  res.redirect(302, u.toString());
}

function parseScopes(raw) {
  if (!raw || typeof raw !== "string") return [];
  return raw.split(/\s+/).map((s) => s.trim()).filter(Boolean);
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

exports.authorize = async (req, res) => {
  const q = req.query || {};
  const {
    response_type,
    client_id,
    redirect_uri,
    scope,
    state,
    code_challenge,
    code_challenge_method,
    nonce,
    resource,
    prompt, // OIDC "prompt" — we honor "none" and "consent" hints
  } = q;

  // ----- 1. client_id -----
  if (!client_id || typeof client_id !== "string") {
    return hardError(res, 400, "invalid_request", "client_id is required");
  }
  const client = await OAuthClient.findOne({ client_id }).lean();
  if (!client) {
    return hardError(res, 400, "invalid_client", "unknown client_id");
  }
  if (client.status !== "active") {
    return hardError(
      res,
      403,
      "unauthorized_client",
      "client is suspended or inactive",
    );
  }

  // ----- 2. redirect_uri (exact-string match) -----
  if (!redirect_uri || typeof redirect_uri !== "string") {
    return hardError(res, 400, "invalid_request", "redirect_uri is required");
  }
  if (!client.redirect_uris.includes(redirect_uri)) {
    return hardError(
      res,
      400,
      "invalid_redirect_uri",
      "redirect_uri does not exactly match any registered URI",
    );
  }

  // From here on, redirect_uri is trusted → errors go back via redirect.

  // ----- 3. response_type -----
  if (response_type !== "code") {
    return redirectError(
      res,
      redirect_uri,
      "unsupported_response_type",
      "only response_type=code is supported",
      state,
    );
  }

  // ----- 4. state -----
  // Not strictly mandatory by RFC 6749, but effectively required for CSRF
  // resistance and required by MCP client conformance tests.
  if (!state || typeof state !== "string" || state.length > 512) {
    return redirectError(
      res,
      redirect_uri,
      "invalid_request",
      "state is required (CSRF token, echoed on callback)",
      state,
    );
  }

  // ----- 5. scope -----
  const requestedScopes = parseScopes(scope);
  if (requestedScopes.length === 0) {
    return redirectError(
      res,
      redirect_uri,
      "invalid_scope",
      "scope is required",
      state,
    );
  }
  const badScopes = requestedScopes.filter(
    (s) => !SUPPORTED_SCOPES.includes(s),
  );
  if (badScopes.length) {
    return redirectError(
      res,
      redirect_uri,
      "invalid_scope",
      `unsupported scope(s): ${badScopes.join(", ")}`,
      state,
    );
  }
  const outsideClient = requestedScopes.filter(
    (s) => !client.allowed_scopes.includes(s),
  );
  if (outsideClient.length) {
    return redirectError(
      res,
      redirect_uri,
      "invalid_scope",
      `client is not permitted these scope(s): ${outsideClient.join(", ")}`,
      state,
    );
  }

  // ----- 6. PKCE -----
  const isPublic = client.token_endpoint_auth_method === "none";
  if (isPublic || code_challenge) {
    // PKCE required for public clients; if provided by a confidential client,
    // it is honored (and MUST be S256).
    if (!code_challenge || typeof code_challenge !== "string") {
      return redirectError(
        res,
        redirect_uri,
        "invalid_request",
        "code_challenge is required (PKCE)",
        state,
      );
    }
    // S256 challenge is 43 chars of base64url of a 32-byte SHA256.
    if (
      code_challenge.length < 43 ||
      code_challenge.length > 128 ||
      /[^A-Za-z0-9\-_]/.test(code_challenge)
    ) {
      return redirectError(
        res,
        redirect_uri,
        "invalid_request",
        "code_challenge malformed (base64url, 43-128 chars)",
        state,
      );
    }
    if (
      code_challenge_method &&
      code_challenge_method !== "S256"
    ) {
      return redirectError(
        res,
        redirect_uri,
        "invalid_request",
        "code_challenge_method must be S256",
        state,
      );
    }
  }

  // ----- 7. prompt handling -----
  // "prompt=none" means "fail rather than show any UI if not signed in / not
  // consented" — we honor that below at the session check.
  const promptVal = typeof prompt === "string" ? prompt : "";

  // ----- 8. Sign the hand-off ticket (used by the consent POST) -----
  const ticket = signTicket({
    client_id: client.client_id,
    client_name: client.client_name,
    logo_uri: client.logo_uri,
    redirect_uri,
    scopes: requestedScopes,
    state,
    code_challenge: code_challenge || null,
    code_challenge_method: code_challenge ? "S256" : null,
    nonce: nonce || null,
    resource: resource || null,
    prompt: promptVal || null,
  });

  // ----- 9. Session check -----
  // The AdsGPT web app sets an `access-token` cookie on the shared root
  // domain, so the AS receives it here. If missing / invalid, bounce to
  // aMember with a returnTo pointing back at this /authorize URL — after
  // sign-in the user lands right where they started.
  const session = verifyAdsGptSession(req);
  if (!session) {
    if (promptVal === "none") {
      return redirectError(
        res,
        redirect_uri,
        "login_required",
        "user is not signed in and prompt=none",
        state,
      );
    }
    const login = loginUrl(absoluteAuthorizeUrl(req));
    if (!login) {
      return hardError(
        res,
        500,
        "server_error",
        "AMEMBER_URL is not configured on the backend — cannot redirect to sign-in",
      );
    }
    return res.redirect(302, login);
  }

  // ----- 10. Render consent HTML directly -----
  // Look up the user profile so the consent screen can show "Signed in as
  // <email>" — helps users confirm they're on the right account before
  // approving an app.
  const profile = await UserProfile.findOne({ user_id: session.user_id })
    .select({ email: 1, name: 1, name_f: 1, name_l: 1 })
    .lean();

  await writeAudit("authorize_requested", req, {
    client_id: client.client_id,
    user_id: session.user_id,
    scopes: requestedScopes,
    has_pkce: Boolean(code_challenge),
  });

  // Compute the client's callback origin so we can add it to form-action.
  // Modern browsers enforce form-action across the ENTIRE submission chain,
  // including the 302 that /oauth/consent emits back to the client. Without
  // this, `'self'` alone would allow the POST but block the redirect —
  // manifesting as "the page just reloads" after Allow.
  let redirectOrigin = "";
  try {
    redirectOrigin = new URL(redirect_uri).origin;
  } catch {
    // Already validated above — this shouldn't fail. Leave empty and CSP
    // will fall back to 'self' only.
  }

  // Compute a clean display name: trim + only accept truthy strings, so a
  // profile with name_f="" + name_l="" (which joins to " ") doesn't render
  // as a blank line under "Signed in as".
  const trimmedName = (profile?.name || "").trim();
  const joinedName =
    [profile?.name_f, profile?.name_l]
      .filter((v) => v && String(v).trim())
      .join(" ")
      .trim();

  const html = renderConsentPage({
    ticket,
    clientName: client.client_name,
    logoUri: client.logo_uri,
    scopes: requestedScopes,
    userEmail: profile?.email || "",
    userName: trimmedName || joinedName || "",
    userId: session.user_id,
  });

  res.set(
    "Content-Security-Policy",
    [
      "default-src 'none'",
      // Public Sans is loaded from Google Fonts by consentHtml. The
      // `link href="fonts.googleapis.com..."` needs style-src to include
      // that host; the woff2 files it references come from fonts.gstatic.com.
      "style-src 'unsafe-inline' https://fonts.googleapis.com",
      "font-src https://fonts.gstatic.com",
      client.logo_uri
        ? `img-src ${new URL(client.logo_uri).origin} data:`
        : "img-src data:",
      redirectOrigin
        ? `form-action 'self' ${redirectOrigin}`
        : "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; "),
  );
  res.set("Cache-Control", "no-store");
  res.type("html").send(html);
};

exports._internal = { parseScopes };
