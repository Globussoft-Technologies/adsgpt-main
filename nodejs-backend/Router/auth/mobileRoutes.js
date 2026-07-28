const express = require("express");
const router = express.Router();
const { authenticateJWT } = require("../../services/authService");

const {
  MobileSignup,
  GoogleSignup,
  GoogleLogin,
  AppleSignup,
  AppleLogin,
  DeleteAccount,
  getMobilePlans,
  verifyApplePayment,
  verifyGooglePayment,
  restoreApplePurchases,
  restoreGooglePurchases,
  getSubscriptionStatus,
  handleAppleWebhook,
  handleGoogleWebhook,
} = require("../../controllers/auth/mobileController");

// Auth Endpoints (Mounted at /adsgpt/mobile/*)
router.post("/signup", MobileSignup);
router.post("/google-signup", GoogleSignup);
router.post("/google-login", GoogleLogin);
router.post("/apple-signup", AppleSignup);
router.post("/apple-login", AppleLogin);
router.post("/delete-account", authenticateJWT, DeleteAccount);

// Plans Config Endpoint (JWT required — shown after signup)
router.get("/plans", authenticateJWT, getMobilePlans);

// Payment Verification Endpoints
router.post("/payments/apple/verify", authenticateJWT, verifyApplePayment);
router.post("/payments/google/verify", authenticateJWT, verifyGooglePayment);
router.post("/payments/apple/restore", authenticateJWT, restoreApplePurchases);
router.post("/payments/google/restore", authenticateJWT, restoreGooglePurchases);
router.get("/payments/status", authenticateJWT, getSubscriptionStatus);

// Webhook Endpoints
router.post("/webhooks/apple/notifications", handleAppleWebhook);
router.post("/webhooks/google/notifications", handleGoogleWebhook);

module.exports = router;
