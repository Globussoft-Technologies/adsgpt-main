const assert = require("node:assert/strict");
const {
  parseAllowedMobileReturnUrls,
  safeFacebookReturnUrl,
  buildFacebookReturnUrl,
} = require("../../utils/oauthReturnUrl");

const fallback = "https://app.example.com/dashboard";
const mobileReturnUrl = "io.adsgpt.app://meta-connected";

assert.equal(
  safeFacebookReturnUrl("https://app.example.com/meta-ads?tab=accounts", fallback),
  "https://app.example.com/meta-ads?tab=accounts",
);
assert.equal(
  safeFacebookReturnUrl(mobileReturnUrl, fallback, mobileReturnUrl),
  mobileReturnUrl,
);
assert.equal(
  buildFacebookReturnUrl(
    mobileReturnUrl,
    { auth: "success", facebookId: "123" },
    fallback,
    mobileReturnUrl,
  ),
  "io.adsgpt.app://meta-connected?auth=success&facebookId=123",
);

for (const unsafeUrl of [
  "https://evil.example.com/callback",
  "javascript:alert(1)",
  "io.adsgpt.app://other-screen",
  "io.adsgpt.app://meta-connected/other-screen",
  "io.adsgpt.app://meta-connected?next=evil",
]) {
  assert.equal(
    safeFacebookReturnUrl(unsafeUrl, fallback),
    fallback,
    `${unsafeUrl} should fall back to the web app`,
  );
}

assert.equal(
  buildFacebookReturnUrl(
    "https://evil.example.com/callback",
    { error: "auth_failed" },
    fallback,
  ),
  "https://app.example.com/dashboard?error=auth_failed",
);

assert.deepEqual(
  [...parseAllowedMobileReturnUrls(
    "io.adsgpt.app://meta-connected, io.adsgpt.app.dev://meta-connected",
  )],
  [
    "io.adsgpt.app://meta-connected",
    "io.adsgpt.app.dev://meta-connected",
  ],
);
assert.equal(
  safeFacebookReturnUrl(mobileReturnUrl, fallback, undefined),
  fallback,
  "mobile redirects must fail closed when the allowlist is absent",
);

console.log("Facebook OAuth return URL tests passed");
