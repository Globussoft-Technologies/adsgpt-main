function parseAllowedOrigins(value) {
  return String(value || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function isOriginAllowed(origin, allowedOrigins) {
  if (!origin) return true;
  if (allowedOrigins.includes(origin)) return true;

  return allowedOrigins.some((allowed) => {
    if (
      allowed !== "http://localhost:*" &&
      allowed !== "https://localhost:*" &&
      allowed !== "http://127.0.0.1:*" &&
      allowed !== "https://127.0.0.1:*"
    ) {
      return false;
    }

    try {
      const parsed = new URL(origin);
      const expectedProtocol = allowed.startsWith("https:") ? "https:" : "http:";
      const expectedHostname = allowed.includes("127.0.0.1") ? "127.0.0.1" : "localhost";
      return parsed.protocol === expectedProtocol && parsed.hostname === expectedHostname;
    } catch {
      return false;
    }
  });
}

/**
 * Is this request same-origin — i.e. did the page that issued it come from this
 * very API host?
 *
 * The CSRF guard in index.js rejects any state-changing request whose Origin is
 * not in CORS_ALLOWED_ORIGINS. That list holds *frontend* origins, so it never
 * contains the API's own origin — which broke every "Execute" button in the
 * Swagger UI at /api-docs, since that page is served by this same app and the
 * browser therefore attaches `Origin: https://<api-host>` to its fetches.
 *
 * A same-origin request is not a CSRF vector: a browser sets Origin itself and
 * a page on evil.com can never make it say this host. (A non-browser client can
 * spoof Host, but it can also just omit Origin, which the guard already lets
 * through — so this adds no new bypass.)
 */
function isSameOriginRequest(req, origin) {
  if (!origin) return true;
  const host =
    (typeof req.get === "function" ? req.get("host") : null) ||
    (req.headers && req.headers.host);
  if (!host) return false;

  // req.protocol resolves X-Forwarded-Proto because index.js sets `trust proxy`.
  // A TLS-terminating proxy that drops that header leaves req.protocol as
  // "http" while the browser reports an https Origin, so accept https on the
  // same host too — still the same site, and the scheme is not attacker-chosen.
  return origin === `${req.protocol}://${host}` || origin === `https://${host}`;
}

module.exports = {
  parseAllowedOrigins,
  isOriginAllowed,
  isSameOriginRequest,
};
