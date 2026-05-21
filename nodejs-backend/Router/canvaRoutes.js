const express = require("express");
const {
  checkAuth,
  oauthRedirect,
  uploadImage,
  createDesign,
} = require("../controllers/canva");
const { authenticateJWT } = require("../services/authService");

const router = express.Router();

router.post("/check-auth", authenticateJWT, checkAuth);
router.get("/oauth/redirect", oauthRedirect);
router.get("/edit-in-canva/upload", uploadImage);
router.get("/edit-in-canva/create-design", createDesign);

module.exports = router;
