/**
 * Validate the minimum ad-group fields specific to TikTok App Promotion.
 * This module intentionally has no service dependencies so it can be tested
 * without initializing database or token infrastructure.
 */
function validateAppPromotionPayload(payload = {}) {
  if (
    ["APP_ANDROID", "APP_IOS"].includes(payload.promotion_type) &&
    !String(payload.app_id || "").trim()
  ) {
    return "Select a TikTok app for App promotion.";
  }
  return null;
}

module.exports = { validateAppPromotionPayload };
