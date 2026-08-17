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
  AcceptMobileTerms,
  ForgotPassword,
  getMobileFreeTrial,
  getMobilePlans,
  verifyApplePayment,
  verifyGooglePayment,
  restoreApplePurchases,
  restoreGooglePurchases,
  getSubscriptionStatus,
  getMobileSubscriptionDetails,
  handleAppleWebhook,
  handleGoogleWebhook,
  // ── V2 handlers (Step 1 — PRD §API 1A·1B·1C·1D ·2.1) ────────────────────────────
  v2EmailAuth,
  v2GoogleAuth,
  v2AppleAuth,
  v2UpdateOnboardingProfile,
} = require("../../controllers/auth/mobileController");

// Auth Endpoints (Mounted at /adsgpt/mobile/*)
router.post("/signup", MobileSignup);
router.post("/google-signup", GoogleSignup);
router.post("/google-login", GoogleLogin);
router.post("/apple-signup", AppleSignup);
router.post("/apple-login", AppleLogin);
router.post("/forgot-password", ForgotPassword);
router.post("/delete-account", authenticateJWT, DeleteAccount);
router.post("/accept-terms", authenticateJWT, AcceptMobileTerms);

// Plans Config Endpoint (JWT required — shown after signup)
router.get("/free-trial", authenticateJWT, getMobileFreeTrial);
router.get("/plans", authenticateJWT, getMobilePlans);

// Payment Verification Endpoints
router.post("/payments/apple/verify", authenticateJWT, verifyApplePayment);
router.post("/payments/google/verify", authenticateJWT, verifyGooglePayment);
router.post("/payments/apple/restore", authenticateJWT, restoreApplePurchases);
router.post("/payments/google/restore", authenticateJWT, restoreGooglePurchases);
router.get("/payments/status", authenticateJWT, getSubscriptionStatus);
router.get("/payments/subscription-details", authenticateJWT, getMobileSubscriptionDetails);

// Webhook Endpoints
router.post("/webhooks/apple/notifications", handleAppleWebhook);
router.post("/webhooks/google/notifications", handleGoogleWebhook);

// ─────────────────────────────────────────────────────────────────────────────
// V2 STEP 1 ROUTES  — Mounted at /mobile/v2/* via MainRouter.js
// (Defined here so all mobile/auth handlers stay in one place.)
// ─────────────────────────────────────────────────────────────────────────────

// Auth (no JWT — these ARE the login endpoints)
router.post("/v2/auth/email",  v2EmailAuth);                           // API 1A
router.post("/v2/auth/google", v2GoogleAuth);                          // API 1B
router.post("/v2/auth/apple",  v2AppleAuth);                           // API 1C

// Onboarding profile (JWT required)
router.post("/v2/user/profile", authenticateJWT, v2UpdateOnboardingProfile); // API 2.1

module.exports = router;
