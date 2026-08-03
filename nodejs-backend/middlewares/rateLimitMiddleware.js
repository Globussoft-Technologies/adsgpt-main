const rateLimit = require("express-rate-limit");

// Default global limiter for the /adsgpt API surface and OAuth routes.
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
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
