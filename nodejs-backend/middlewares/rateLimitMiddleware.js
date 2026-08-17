const rateLimit = require("express-rate-limit");
const jwt = require("jsonwebtoken");
const logger = require("../utils/logger");

// Token extraction, mirroring services/authService.js `requestToken`. Inlined
// rather than imported so this middleware — which index.js loads before the
// route tree, the DB connection, or anything else — stays free of the auth
// service's transitive model/session imports. Keep the two in sync.
const requestToken = (req) => {
  const authHeader = String(req.headers?.authorization || "");
  const bearer = authHeader.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (bearer && bearer !== "null" && bearer !== "undefined") return bearer;

  const cookie = String(req.headers?.cookie || "");
  const named = (name) =>
    cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`))?.[1];
  const fromCookie = named("adsgpt-session") || named("access-token") || "";
  return fromCookie ? decodeURIComponent(fromCookie) : "";
};

// Resolve who a request should be billed to, memoized per request so the
// keyGenerator and the max() below share a single JWT verification.
//
// Keying purely on IP — the express-rate-limit default, and what this limiter
// used to do — collapses every user behind a shared egress into ONE bucket:
// an office NAT, a corporate VPN, a mobile carrier's CGNAT. A handful of
// active users then exhaust the window for everyone else on that address,
// which is exactly the "I keep getting 429s" failure mode. Authenticated
// traffic is therefore keyed on the JWT subject, which is both the correct
// blast radius and immune to NAT.
//
// The token is fully VERIFIED, not merely decoded, before its user_id is
// trusted. An unverified claim would let any caller mint unlimited buckets by
// forging `user_id`, turning the limiter into a no-op.
const identityOf = (req) => {
  if (req._rateLimitIdentity) return req._rateLimitIdentity;

  let identity = { type: "ip", key: `ip:${req.ip}` };
  const token = requestToken(req);
  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET_KEY, {
        algorithms: ["HS512"],
      });
      const userId = decoded?.user_id ?? decoded?.id;
      if (userId) {
        // Namespaced by created_from to match authService, which prefixes
        // user_id with PAS-/GPT- after verifying — two identity providers can
        // otherwise issue the same numeric id.
        identity = {
          type: "user",
          key: `user:${decoded.created_from || "-"}:${userId}`,
        };
      }
    } catch {
      // Expired or invalid token: fall through to the IP bucket. Failed auth
      // SHOULD share the anonymous budget — that's the brute-force surface.
    }
  }

  req._rateLimitIdentity = identity;
  return identity;
};

// Per-user budget for signed-in app traffic. The dashboard fans out a lot of
// calls per navigation on top of its interval polls, so this is deliberately
// generous — it is an abuse ceiling, not a quota.
const PER_USER_MAX = Number(process.env.API_RATE_LIMIT_PER_USER || 3000);
// Anonymous/unauthenticated traffic keyed by IP, where NAT sharing is
// unavoidable. Unchanged from the previous global default.
const PER_IP_MAX = Number(process.env.API_RATE_LIMIT_PER_IP || 1000);

// Default global limiter for the /adsgpt API surface and OAuth routes.
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: (req) => (identityOf(req).type === "user" ? PER_USER_MAX : PER_IP_MAX),
  keyGenerator: (req) => identityOf(req).key,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
  // Nothing logged this before, which made the 429s undiagnosable from the
  // server side — you could only see them in the browser. Log the bucket that
  // tripped (never the token) so the next occurrence is traceable to a user
  // or an IP, and to whichever route is burning the budget.
  handler: (req, res, next, options) => {
    const { type, key } = identityOf(req);
    // req.rateLimit.limit is the RESOLVED number for this request; options.max
    // is still the function that produced it.
    logger.warn(
      `[rate-limit] 429 ${req.method} ${req.originalUrl} | by=${type} key=${key} limit=${req.rateLimit?.limit} window=15m`,
    );
    res.status(options.statusCode).json(options.message);
  },
  // Skip high-frequency polls and self-authed webhooks so they don't burn the
  // shared budget: the Telegram webhook (gated by its own secret token) and the
  // video/image processing-count endpoints, which the frontend polls on an interval.
  skip: (req) =>
    req.path === "/telegram/webhook" ||
    req.path.endsWith("/processing-count"),
});

// Looser limiter for the Telegram webhook — inbound traffic is already
// gated by the secret-token header inside the handler, this just caps abuse.
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
});

// Strict limiter for OAuth Dynamic Client Registration. DCR is anonymous and
// creates a durable Mongo row per call, so it's spam-attractive. 20 per hour
// per IP is generous for real MCP clients (which register once per install)
// while shutting down bulk-registration abuse.
const dcrLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: Number(process.env.OAUTH_DCR_RATE_LIMIT_PER_HOUR || 20),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "too_many_registrations",
    error_description: "Rate limit exceeded for /oauth/register",
  },
});

// Token endpoint limiter — brute-force resistance for auth code + refresh
// exchange. Applied on top of any per-client-id checks inside the handler.
const oauthTokenLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.OAUTH_TOKEN_RATE_LIMIT_PER_MIN || 60),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "too_many_requests",
    error_description: "Rate limit exceeded for /oauth/token",
  },
});

// Workspace member magic links are fully unauthenticated — possession of a
// one-time token, or just an email address, is the only credential. The shared
// apiLimiter (1000 / 15 min) is far too loose for that, so the whole surface
// gets its own per-IP cap.
const workspaceAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.WORKSPACE_AUTH_RATE_LIMIT_PER_IP || 40),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    code: "WORKSPACE_RATE_LIMITED",
    message: "Too many workspace requests. Try again in a few minutes.",
  },
});

// Stacked on top of the per-IP cap for password-login attempts. Keyed on the
// submitted mailbox rather than the caller so one account can't be
// credential-stuffed from a rotating pool of IPs; skipSuccessfulRequests
// means a legitimate login doesn't burn the same budget wrong guesses do.
const workspaceMemberLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.WORKSPACE_MEMBER_LOGIN_RATE_LIMIT_PER_EMAIL || 8),
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => {
    // Same normalization as normalizeEmail(), inlined to keep this middleware
    // free of workspace imports. Requests without a usable address share one
    // bucket: they can never succeed, so collapsing them is safe.
    const email = String(req.body?.email || "").trim().toLowerCase();
    return email
      ? `workspace-member-login:${email}`
      : "workspace-member-login:__missing__";
  },
  message: {
    success: false,
    code: "WORKSPACE_RATE_LIMITED",
    message: "Too many sign-in attempts for this email. Try again later.",
  },
});

module.exports = {
  apiLimiter,
  webhookLimiter,
  dcrLimiter,
  oauthTokenLimiter,
  workspaceAuthLimiter,
  workspaceMemberLoginLimiter,
};
