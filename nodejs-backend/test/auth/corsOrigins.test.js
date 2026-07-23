const assert = require("node:assert/strict");
const {
  parseAllowedOrigins,
  isOriginAllowed,
} = require("../../utils/corsOrigins");

const origins = parseAllowedOrigins(
  "http://localhost:*, https://app.example.com",
);

assert.equal(isOriginAllowed("http://localhost:5173", origins), true);
assert.equal(isOriginAllowed("http://localhost:3000", origins), true);
assert.equal(isOriginAllowed("http://localhost", origins), true);
assert.equal(isOriginAllowed("https://localhost:5173", origins), false);
assert.equal(isOriginAllowed("http://127.0.0.1:5173", origins), false);
assert.equal(isOriginAllowed("https://app.example.com", origins), true);
assert.equal(isOriginAllowed("https://evil.example.com", origins), false);

console.log("corsOrigins tests passed");
