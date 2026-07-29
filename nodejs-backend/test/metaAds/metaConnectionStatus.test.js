const assert = require("assert");
process.env.ACCESS_TOKEN_SECRET ||= "meta-connection-status-test";
const {
  META_TOKEN_MIN_VALIDITY_MS,
  assertFacebookConnectionId,
  getFacebookConnectionStatus,
} = require("../../utils/metaConnection");

const now = Date.parse("2026-07-28T12:00:00.000Z");

assert.deepStrictEqual(
  getFacebookConnectionStatus(
    { tokenExpiresAt: new Date(now + META_TOKEN_MIN_VALIDITY_MS + 1) },
    now,
  ),
  { isUsable: true, connectionStatus: "connected" },
);

assert.deepStrictEqual(
  getFacebookConnectionStatus(
    { tokenExpiresAt: new Date(now + META_TOKEN_MIN_VALIDITY_MS) },
    now,
  ),
  { isUsable: false, connectionStatus: "reconnect_required" },
);

assert.deepStrictEqual(
  getFacebookConnectionStatus(
    { tokenExpiresAt: new Date(now - 1) },
    now,
  ),
  { isUsable: false, connectionStatus: "reconnect_required" },
);

assert.deepStrictEqual(
  getFacebookConnectionStatus({}, now),
  { isUsable: false, connectionStatus: "reconnect_required" },
);

assert.doesNotThrow(() =>
  assertFacebookConnectionId({ _id: "connection-a" }, "connection-a"),
);

assert.throws(
  () => assertFacebookConnectionId({ _id: "connection-a" }, "connection-b"),
  (error) =>
    error.statusCode === 403 &&
    error.code === "FACEBOOK_ACCOUNT_MISMATCH",
);

console.log("metaConnectionStatus tests passed");
