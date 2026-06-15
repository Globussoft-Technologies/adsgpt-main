const express = require("express");
const { checkAuth, oauthRedirect, uploadImage, createDesign, getStatus, disconnect } = require("../controllers/canvaV2");
const { authenticateJWT } = require("../services/authService");

const router = express.Router();

router.post("/v2/check-auth", authenticateJWT, checkAuth);
router.get("/v2/status", authenticateJWT, getStatus);
router.delete("/v2/disconnect", authenticateJWT, disconnect);
router.get("/v2/oauth/redirect", oauthRedirect);
router.get("/v2/upload", uploadImage);
router.get("/v2/create-design", createDesign);

module.exports = router;
