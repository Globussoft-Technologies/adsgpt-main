/**
 * POST /oauth/consent — form submission from the consent page rendered by
 * /oauth/authorize (see authorizeController + consentHtml).
 *
 * The consent HTML has two submit buttons that POST here with:
 *   ticket    — HS256-signed payload from /oauth/authorize (immutable proof
 *               that the client + redirect_uri + scopes + PKCE challenge were
 *               validated on the way in)
 *   decision  — "approve" | "deny"
 *
 * Auth: the AdsGPT session cookie (access-token). We reverify it here — the
 * browser might have logged out between /authorize and /consent, and we
 * can't trust the ticket alone to imply an active user session.
 *
 * Response is an HTTP 302 back to the client's redirect_uri:
 *   approve → ?code=<...>&state=<...>
 *   deny    → ?error=access_denied&state=<...>
 *
 * No JSON, no frontend involvement.
 */

const crypto = require("node:crypto");
const {
  verifyTicket,
} = require("../../services/oauth/authorizeTicketService");
const { verifyAdsGptSession } = require("../../services/oauth/sessionCheck");
const OAuthUserConsent = require("../../Module/oauth/oauthUserConsentModel");
const OAuthAuthorizationCode = require("../../Module/oauth/oauthAuthCodeModel");
const OAuthAuditLog = require("../../Module/oauth/oauthAuditLogModel");

const AUTH_CODE_TTL_SECONDS = Number(
  process.env.OAUTH_AUTH_CODE_TTL_SECONDS || 60,
);

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

function buildRedirect(redirectUri, params) {
  const u = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
  }
  return u.toString();
}

function inlineError(res, status, message) {
  // Reached when we can't safely redirect back — e.g. tampered ticket, so we
  // don't know the redirect_uri to send the error to.
  res.status(status).type("html").send(`<!doctype html>
<html><head><meta charset="utf-8"><title>Authorization error</title></head>
<body style="font-family:system-ui,sans-serif;max-width:640px;margin:64px auto;padding:0 16px;color:#111">
  <h1 style="font-size:20px">Authorization error</h1>
  <p>${String(message).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)}</p>
  <p style="color:#666;font-size:13px">Restart the sign-in from the application that sent you here.</p>
</body></html>`);
}

/**
 * POST /oauth/consent  — form-encoded body: { ticket, decision }
 */
exports.decide = async (req, res) => {
  const body = req.body || {};
  const ticket = typeof body.ticket === "string" ? body.ticket : "";
  const decision = typeof body.decision === "string" ? body.decision : "";

  if (!ticket) return inlineError(res, 400, "Missing ticket. Restart the sign-in.");
  if (decision !== "approve" && decision !== "deny") {
    return inlineError(res, 400, "Missing or invalid decision. Restart the sign-in.");
  }

  const payload = verifyTicket(ticket);
  if (!payload) {
    return inlineError(
      res,
      400,
      "Your sign-in session expired. Restart from the application that sent you here.",
    );
  }

  const session = verifyAdsGptSession(req);
  if (!session) {
    // Session vanished between /authorize and this POST. Send them back
    // through the front door — that flow will bounce to aMember if needed
    // and preserve the OAuth params.
    return inlineError(
      res,
      401,
      "You are no longer signed in. Restart from the application that sent you here.",
    );
  }
  const userId = session.user_id;

  const {
    client_id,
    redirect_uri,
    scopes,
    state,
    code_challenge,
    code_challenge_method,
    nonce,
    resource,
    prompt,
  } = payload;

  // ---- Deny ----
  if (decision === "deny") {
    await writeAudit("consent_denied", req, {
      client_id,
      user_id: userId,
      scopes,
    });
    return res.redirect(
      302,
      buildRedirect(redirect_uri, {
        error: "access_denied",
        error_description: "user denied consent",
        state,
      }),
    );
  }

  // ---- Approve ----
  // Union the granted scopes with any prior grant so consent memory is
  // monotonic across reconnects.
  const existing = await OAuthUserConsent.findOne({
    user_id: userId,
    client_id,
  }).lean();
  const mergedScopes = Array.from(
    new Set([...(existing?.granted_scopes || []), ...scopes]),
  );
  await OAuthUserConsent.updateOne(
    { user_id: userId, client_id },
    {
      $set: {
        granted_scopes: mergedScopes,
        granted_at: new Date(),
        last_used_at: new Date(),
        revoked_at: null,
      },
    },
    { upsert: true },
  );

  const code = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + AUTH_CODE_TTL_SECONDS * 1000);
  await OAuthAuthorizationCode.create({
    code,
    client_id,
    user_id: userId,
    redirect_uri,
    scopes,
    code_challenge,
    code_challenge_method: code_challenge ? code_challenge_method || "S256" : "S256",
    nonce: nonce || null,
    resource: resource || null,
    expires_at: expiresAt,
    used_at: null,
  });

  await writeAudit("consent_granted", req, {
    client_id,
    user_id: userId,
    scopes,
    prompt: prompt || null,
  });
  await writeAudit("code_issued", req, {
    client_id,
    user_id: userId,
    scopes,
  });

  res.set("Cache-Control", "no-store");
  return res.redirect(
    302,
    buildRedirect(redirect_uri, {
      code,
      state,
    }),
  );
};
