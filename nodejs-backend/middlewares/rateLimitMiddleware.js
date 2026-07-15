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

module.exports = { apiLimiter, webhookLimiter, dcrLimiter, oauthTokenLimiter };
