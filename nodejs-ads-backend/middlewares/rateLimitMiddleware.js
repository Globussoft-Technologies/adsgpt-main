const rateLimit = require("express-rate-limit");

// Global limiter for the /ads and /explorer surface. Kept generous since
// /ads/get-ads and /ads/vector-search back live ad-serving/search UI.
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 2000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
});

module.exports = { apiLimiter };
