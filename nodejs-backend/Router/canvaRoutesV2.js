const express = require("express");
const { checkAuth, oauthRedirect, uploadImage, createDesign, getStatus, disconnect } = require("../controllers/canvaV2");
const { authenticateJWT } = require("../services/authService");

const router = express.Router();

router.post("/check-auth", authenticateJWT, checkAuth);
router.get("/status", authenticateJWT, getStatus);
router.delete("/disconnect", authenticateJWT, disconnect);
router.get("/oauth/redirect", oauthRedirect);
router.get("/upload", uploadImage);
router.get("/create-design", createDesign);

module.exports = router;
