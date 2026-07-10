const rateLimit = require("express-rate-limit");

// Default global limiter for the /adsgpt API surface and OAuth routes.
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
  skip: (req) => req.path === "/telegram/webhook",
});

// Looser limiter for the Telegram webhook — inbound traffic is already
// gated by the secret-token header inside the handler, this just caps abuse.
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = { apiLimiter, webhookLimiter };
