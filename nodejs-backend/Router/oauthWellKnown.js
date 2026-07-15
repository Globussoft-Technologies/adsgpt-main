/**
 * OAuth / OIDC well-known discovery routes.
 *
 * Mounted at the app root (NOT under /oauth) because the spec fixes these
 * paths at the host root:
 *   /.well-known/openid-configuration        — RFC 8414 / OIDC Discovery
 *   /.well-known/oauth-authorization-server  — RFC 8414
 *   /.well-known/jwks.json                   — RFC 7517
 */

const express = require("express");
const discoveryController = require("../controllers/oauth/discoveryController");

const router = express.Router();

router.get(
  "/.well-known/openid-configuration",
  discoveryController.openidConfiguration,
);
router.get(
  "/.well-known/oauth-authorization-server",
  discoveryController.oauthAuthorizationServer,
);
router.get("/.well-known/jwks.json", discoveryController.jwks);

module.exports = router;
