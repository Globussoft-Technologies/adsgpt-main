#!/usr/bin/env node
/**
 * Regression coverage for App Promotion ad-group preflight validation.
 * Run with: node test/tiktokAds/appPromotionPayload.test.js
 */

const assert = require("node:assert/strict");
const { validateAppPromotionPayload } = require("../../utils/tiktokAppPromotion");

let passed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  PASS ${name}`);
  } catch (error) {
    console.error(`  FAIL ${name}: ${error.message}`);
    process.exitCode = 1;
  }
}

console.log("TikTok App Promotion payload validation");

test("rejects Android app promotion without app_id", () => {
  assert.equal(
    validateAppPromotionPayload({ promotion_type: "APP_ANDROID" }),
    "Select a TikTok app for App promotion."
  );
});

test("rejects iOS app promotion with a blank app_id", () => {
  assert.equal(
    validateAppPromotionPayload({ promotion_type: "APP_IOS", app_id: "  " }),
    "Select a TikTok app for App promotion."
  );
});

test("accepts app promotion with an app_id", () => {
  assert.equal(
    validateAppPromotionPayload({ promotion_type: "APP_ANDROID", app_id: "1874470099026097" }),
    null
  );
});

test("does not require app_id for website promotion", () => {
  assert.equal(validateAppPromotionPayload({ promotion_type: "WEBSITE" }), null);
});

console.log(`\n${passed} passed`);
