// ─── Mobile Auth Request Payloads ──────────────────────────────────────────────

exports.mobileSignupPayload = {
  email: "alex@example.com",
  password: "StrongPassword123!",
  firstName: "Alex",
  lastName: "Smith",
  platform: "ios",
  acceptedTerms: true,
};

exports.googleSignupPayload = {
  firebaseIdToken: "eyJhbGciOiJSUzI1NiIsImtpZCI6...",
  email: "alex@example.com",
  firstName: "Alex",
  lastName: "Smith",
  platform: "android",
  acceptedTerms: true,
};

exports.googleLoginPayload = {
  firebaseIdToken: "eyJhbGciOiJSUzI1NiIsImtpZCI6...",
  platform: "android",
};

exports.appleSignupPayload = {
  firebaseIdToken: "eyJhbGciOiJSUzI1NiIsImtpZCI6...",
  firstName: "Alex",
  lastName: "Smith",
  email: "user@privaterelay.appleid.com",
  platform: "ios",
  acceptedTerms: true,
};

exports.appleLoginPayload = {
  firebaseIdToken: "eyJhbGciOiJSUzI1NiIsImtpZCI6...",
  platform: "ios",
};

exports.deleteAccountPayload = {
  reason: "User requested deletion from mobile app settings",
};

// ─── Mobile Payment Verification Payloads ────────────────────────────────────

exports.verifyApplePaymentPayload = {
  signedTransaction: "eyJhbGciOiJFUzI1NiIsIng1YyI6...",
};

exports.verifyGooglePaymentPayload = {
  productId: "io.adsgpt.app.subscription.starter.monthly",
  purchaseToken: "GPA.3311-2244-5566-77889",
  packageName: "com.adsgpt.app",
};

// ─── Mobile Webhook Payloads ──────────────────────────────────────────────────

exports.appleWebhookPayload = {
  signedPayload: "eyJhbGciOiJFUzI1NiIsIng1YyI6...",
};

exports.googleWebhookPayload = {
  message: {
    data: "ZXlKMGVYQWlPaUpLVjFRaUxDSn...",
    messageId: "1234567890",
  },
  subscription: "projects/adsgpt/subscriptions/rtdn-sub",
};

// ─── Mobile Response Schemas ──────────────────────────────────────────────────

exports.mobileAuthResponse = {
  ok: true,
  token: "eyJhbGciOiJIUzI1NiIsInR5cCI6...",
  isNewUser: false,
  user: {
    user_id: "123",
    login: "alex@example.com",
    user_email: "alex@example.com",
    firstName: "Alex",
    lastName: "Smith",
    loginProviders: ["general", "google"],
    userSubscriptionType: { "20": "2026-08-27" },
    hasActivePlan: true,
    credits: { adCopy: 5000, adCreative: 1500 },
  },
  nextAction: "OPEN_APP",
};

exports.mobilePaymentVerifyResponse = {
  ok: true,
  token: "eyJhbGciOiJIUzI1NiIsInR5cCI6...",
  subscription: {
    platform: "ios",
    store_product_id: "io.adsgpt.app.subscription.starter.monthly",
    status: "active",
    original_transaction_id: "1000000123456789",
    latest_transaction_id: "2000000987654321",
    expires_at: "2026-08-27T14:00:00.000Z",
  },
  credits: { adCopy: 5000, adCreative: 1500 },
  user: {
    user_id: "123",
    hasActivePlan: true,
    userSubscriptionType: { "20": "2026-08-27" },
  },
};

exports.mobileWebhookResponse = {
  ok: true,
};
