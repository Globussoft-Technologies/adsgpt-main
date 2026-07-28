/**
 * Mobile Subscription Plans Config
 * ─────────────────────────────────────────────────────────────────────────────
 * This is the single source of truth for which in-app purchase product IDs
 * the iOS / Android apps should display on their paywall screens.
 *
 * Rules:
 *  - Array order == display order on the iOS paywall (no displayOrder field needed)
 *  - NO price / trial / credit info here — StoreKit / Google Play provide pricing
 *    at runtime; the backend verifies product IDs from the JWS receipt
 *  - `badge` can be "Popular", "Best Value", or null
 *  - `platform` controls which plans the client filters: "ios" | "android" | "both"
 *
 * To add a new plan: just push a new object into the `plans` array below.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const mobileProductsConfig = {
  ios: {
    defaultProductId: "io.adsgpt.app.subscription.starter.monthly",
    plans: [
      {
        productId: "io.adsgpt.app.subscription.starter.monthly",
        tier: "Starter",
        fallbackTitle: "Starter Monthly",
        badge: null,
        platform: "ios",
      },
      {
        productId: "io.adsgpt.app.subscription.starter.annual",
        tier: "Starter",
        fallbackTitle: "Starter Annual",
        badge: "Best Value",
        platform: "ios",
      },
      {
        productId: "io.adsgpt.app.subscription.pro.monthly",
        tier: "Pro",
        fallbackTitle: "Pro Monthly",
        badge: "Popular",
        platform: "ios",
      },
      {
        productId: "io.adsgpt.app.subscription.pro.annual",
        tier: "Pro",
        fallbackTitle: "Pro Annual",
        badge: "Best Value",
        platform: "ios",
      },
    ],
  },

  android: {
    defaultProductId: "io.adsgpt.app.subscription.starter.monthly",
    plans: [
      {
        productId: "io.adsgpt.app.subscription.starter.monthly",
        tier: "Starter",
        fallbackTitle: "Starter Monthly",
        badge: null,
        platform: "android",
      },
      {
        productId: "io.adsgpt.app.subscription.starter.annual",
        tier: "Starter",
        fallbackTitle: "Starter Annual",
        badge: "Best Value",
        platform: "android",
      },
      {
        productId: "io.adsgpt.app.subscription.pro.monthly",
        tier: "Pro",
        fallbackTitle: "Pro Monthly",
        badge: "Popular",
        platform: "android",
      },
      {
        productId: "io.adsgpt.app.subscription.pro.annual",
        tier: "Pro",
        fallbackTitle: "Pro Annual",
        badge: "Best Value",
        platform: "android",
      },
    ],
  },
};

module.exports = mobileProductsConfig;
