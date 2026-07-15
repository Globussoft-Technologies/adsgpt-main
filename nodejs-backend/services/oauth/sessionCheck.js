/**
 * sessionCheck — server-side helpers for reading and verifying the AdsGPT
 * session (access-token cookie) during the OAuth flow.
 *
 * The AdsGPT web app already sets an `access-token` cookie on the shared root
 * domain (`.poweradspy.com` in dev, `.adsgpt.io` in prod) at sign-in time, so
 * both the frontend (dashboard.adsgpt.io) and the AS backend
 * (socket.adsgpt.io) receive it on every request.
 *
 * We parse Cookie manually here — cookie-parser isn't installed and adding a
 * new dep for one line is not worth it.
 */

const jwt = require("jsonwebtoken");

function parseCookies(header) {
  const out = {};
  if (typeof header !== "string" || !header) return out;
  for (const pair of header.split(";")) {
    const idx = pair.indexOf("=");
    if (idx < 0) continue;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    if (!k) continue;
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Verify the AdsGPT session cookie. Returns the decoded JWT payload (with
 * `user_id` normalized to `GPT-*`/`PAS-*` prefix, matching authenticateJWT
 * in services/authService.js) on success, or null on any failure.
 *
 * Never throws — a null return means "not signed in" and callers should
 * redirect to login.
 */
function verifyAdsGptSession(req) {
  const cookies = parseCookies(req.headers?.cookie);
  const token = cookies["access-token"];
  if (!token) return null;

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET_KEY, {
      algorithms: ["HS512"],
    });
    // Mirror the prefix normalization from authenticateJWT so downstream
    // code sees the same shape it does elsewhere in the app.
    if (decoded?.created_from === "PAS") decoded.user_id = `PAS-${decoded.user_id}`;
    if (decoded?.created_from === "GPT") decoded.user_id = `GPT-${decoded.user_id}`;
    return decoded;
  } catch {
    return null;
  }
}

module.exports = { parseCookies, verifyAdsGptSession };
