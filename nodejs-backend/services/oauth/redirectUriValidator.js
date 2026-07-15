/**
 * Redirect URI validation for /oauth/register and /oauth/authorize.
 *
 * Rules (OAuth 2.1 §2.1 + BCP 212 §7.1):
 *   - Absolute URI, no fragment.
 *   - HTTPS is required, EXCEPT localhost / 127.0.0.1 / [::1] on any port —
 *     those are allowed with http:// per native-app guidance (CLI + desktop
 *     apps like Claude Code bind to an ephemeral loopback port).
 *   - No wildcards, no userinfo, no query-string reservations.
 *
 * Applied twice:
 *   - At /oauth/register: every entry in redirect_uris[] must pass.
 *   - At /oauth/authorize: the presented redirect_uri must EXACTLY match one
 *     of the client's registered redirect_uris (string equality). This file
 *     provides only the well-formedness check; equality is done at the call
 *     site.
 */

function isLoopbackHost(hostname) {
  if (!hostname) return false;
  const h = hostname.toLowerCase();
  return h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "::1";
}

function validateRedirectUri(raw) {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2048) {
    return { ok: false, reason: "invalid_redirect_uri_shape" };
  }

  let u;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, reason: "invalid_redirect_uri_shape" };
  }

  if (u.hash && u.hash.length > 0) {
    return { ok: false, reason: "redirect_uri_must_not_have_fragment" };
  }
  if (u.username || u.password) {
    return { ok: false, reason: "redirect_uri_must_not_have_userinfo" };
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    return { ok: false, reason: "redirect_uri_scheme_not_supported" };
  }

  const loopback = isLoopbackHost(u.hostname);
  if (u.protocol === "http:" && !loopback) {
    return { ok: false, reason: "redirect_uri_must_be_https" };
  }

  return { ok: true, loopback };
}

module.exports = { validateRedirectUri, isLoopbackHost };
