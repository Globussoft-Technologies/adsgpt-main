const express = require("express");
const router = express.Router();
const {
  getAiConsent,
  recordAiConsent,
  getAiConsentDisclosure,
} = require("../controllers/privacy/aiConsentController");

// Mounted under /privacy with authenticateJWT applied at the mount point
// (see MainRouter.js), so req.user is always populated here.
router.get("/ai-consent", getAiConsent);
router.post("/ai-consent", recordAiConsent);
router.get("/ai-consent/disclosure", getAiConsentDisclosure);

module.exports = router;
