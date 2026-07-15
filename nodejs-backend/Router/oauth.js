/**
 * OAuth 2.1 Authorization Server routes.
 *
 * Mounted at /oauth in index.js. The .well-known/* discovery documents are
 * mounted at the app root separately (also in index.js) because their paths
 * are fixed by spec.
 *
 * All UX is backend-served — the consent screen is rendered as HTML directly
 * from /oauth/authorize (see controllers/oauth/consentHtml.js). The React
 * frontend is not involved in the OAuth flow.
 */

const express = require("express");
const registerController = require("../controllers/oauth/registerController");
const authorizeController = require("../controllers/oauth/authorizeController");
const consentController = require("../controllers/oauth/consentController");
const tokenController = require("../controllers/oauth/tokenController");
const userinfoController = require("../controllers/oauth/userinfoController");
const revokeController = require("../controllers/oauth/revokeController");
const connectedAppsController = require("../controllers/oauth/connectedAppsController");
const {
  verifyOAuthAccessToken,
} = require("../middlewares/verifyOAuthAccessToken");
const { authenticateJWT } = require("../services/authService");
const {
  dcrLimiter,
  oauthTokenLimiter,
} = require("../middlewares/rateLimitMiddleware");

const router = express.Router();

function notYetImplemented(req, res) {
  res.status(501).json({
    error: "not_implemented",
    error_description: `${req.method} ${req.originalUrl} is not implemented yet`,
  });
}

// Dynamic Client Registration (RFC 7591). Anonymous, rate-limited.
router.post("/register", dcrLimiter, registerController.register);

// Authorization endpoint. Validates OAuth params, checks the AdsGPT session
// cookie, and either bounces to aMember or renders the consent HTML.
router.get("/authorize", authorizeController.authorize);

// Consent form submission. The form is rendered by /oauth/authorize and
// submits application/x-www-form-urlencoded here. Auth is via the session
// cookie (read inside the controller) — no Authorization header needed.
router.post(
  "/consent",
  express.urlencoded({ extended: false }),
  consentController.decide,
);

router.post("/token", oauthTokenLimiter, tokenController.token);

// OIDC UserInfo — Bearer-auth'd, scope-driven claims. Spec allows GET and POST.
router.get("/userinfo", verifyOAuthAccessToken, userinfoController.userinfo);
router.post("/userinfo", verifyOAuthAccessToken, userinfoController.userinfo);

// RFC 7009 token revocation. Client-authenticated; refresh + access supported.
router.post("/revoke", revokeController.revoke);

// Introspection (RFC 7662) — stubbed for now. Not required by MCP clients.
router.post("/introspect", notYetImplemented);

// User-facing "connected apps" JSON API. Not part of the OAuth flow — kept
// so an admin or account-settings UI (backend-rendered or frontend) can list
// and revoke a user's consents. Requires the AdsGPT session JWT.
router.get(
  "/account/apps",
  authenticateJWT,
  connectedAppsController.list,
);
router.delete(
  "/account/apps/:client_id",
  authenticateJWT,
  connectedAppsController.disconnect,
);

module.exports = router;
