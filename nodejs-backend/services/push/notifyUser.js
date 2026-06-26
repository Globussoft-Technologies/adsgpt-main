// Dual-channel notification dispatcher.
//
// One call delivers a generation-complete event over BOTH channels:
//   1. WebSocket  — `global.io.to(userId).emit(event, socketPayload)`
//                   (web users + any app holding a live foreground socket)
//   2. FCM push   — wakes native iOS/Android apps that are backgrounded/closed
//
// Every existing `global.io.to(userId).emit(...)` site can be replaced by a
// call to notifyUser() with the same `event`/`socketPayload`, plus an optional
// `push` block. The socket behaviour stays byte-for-byte identical, so web is
// unaffected; app users additionally get an OS push.
//
// Both channels are best-effort and independently guarded — a failure in one
// never blocks the other and never throws into the caller.

const DeviceToken = require("../../Module/deviceToken/deviceToken");
const { getMessaging, isPushEnabled } = require("./firebaseAdmin");

// FCM error codes that mean the token is permanently dead and should be
// retired so we stop trying to deliver to it.
const DEAD_TOKEN_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
  "messaging/invalid-argument",
]);

// FCM data payload values MUST be strings. Coerce everything so a numeric id or
// boolean doesn't get silently dropped by the SDK.
function stringifyData(data = {}) {
  const out = {};
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined || v === null) continue;
    out[k] = typeof v === "string" ? v : String(v);
  }
  return out;
}

// Send an FCM push to all of a user's active devices.
async function sendPushToUser(userId, push) {
  if (!isPushEnabled()) return; // push not provisioned — silently skip
  if (!push || !push.title) return;

  const docs = await DeviceToken.find({ userId, isActive: true })
    .select("token")
    .lean();
  const tokens = docs.map((d) => d.token).filter(Boolean);
  if (tokens.length === 0) return; // user has no registered app devices

  const messaging = getMessaging();
  const message = {
    tokens,
    notification: {
      title: push.title,
      body: push.body || "",
    },
    // Custom key/values the app reads on tap to deep-link to the asset.
    data: stringifyData(push.data),
    android: { priority: "high" },
    apns: {
      payload: { aps: { sound: "default", "content-available": 1 } },
    },
  };

  const resp = await messaging.sendEachForMulticast(message);

  // Retire any tokens FCM rejected as permanently invalid.
  if (resp.failureCount > 0) {
    const deadTokens = [];
    resp.responses.forEach((r, i) => {
      if (!r.success && DEAD_TOKEN_CODES.has(r.error?.code)) {
        deadTokens.push(tokens[i]);
      }
    });
    if (deadTokens.length > 0) {
      await DeviceToken.updateMany(
        { token: { $in: deadTokens } },
        { $set: { isActive: false } },
      );
      console.log(`[push] retired ${deadTokens.length} dead token(s) for ${userId}`);
    }
  }

  console.log(
    `[push] userId=${userId} sent=${resp.successCount}/${tokens.length} failed=${resp.failureCount}`,
  );
}

/**
 * Deliver a notification over websocket and (optionally) FCM push.
 *
 * @param {string} userId  Source-prefixed user id (matches the socket room).
 * @param {object} opts
 * @param {string} [opts.event]          Socket event name (e.g. "imageCreated").
 * @param {object} [opts.socketPayload]  Payload emitted to the socket room.
 * @param {object} [opts.push]           Push spec; omit to skip push entirely.
 * @param {string}   opts.push.title     Notification title.
 * @param {string}   opts.push.body      Notification body.
 * @param {object}   opts.push.data      Extra key/values for app deep-linking.
 */
async function notifyUser(userId, { event, socketPayload, push } = {}) {
  if (!userId) return;

  // 1) WebSocket — unchanged behaviour for web + foreground app sockets.
  if (event && global.io) {
    try {
      global.io.to(userId).emit(event, socketPayload);
    } catch (e) {
      console.error(`[notifyUser] socket emit failed for ${userId}: ${e.message}`);
    }
  }

  // 2) FCM push — for backgrounded/closed native apps. Never blocks the caller.
  if (push) {
    try {
      await sendPushToUser(userId, push);
    } catch (e) {
      console.error(`[notifyUser] push failed for ${userId}: ${e.message}`);
    }
  }
}

module.exports = { notifyUser, sendPushToUser };
