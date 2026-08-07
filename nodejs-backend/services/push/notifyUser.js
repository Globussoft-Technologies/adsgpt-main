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

/**
 * Re-evaluate and emit live credits AND session (featureObject, plan details)
 * updates over socket to all open tabs/rooms for a given user (e.g. after aMember
 * plan updates, admin changes, or credit top-ups).
 */
async function notifyUserSessionUpdate(userId) {
  if (!userId) return;
  try {
    const UserProfile = require("../../Module/user/userProfileModel");
    const buildFeatureObject = require("../../utils/featureObjectBuilder");
    const UnifiedCreditController = require("../../controllers/UnifiedCreditController");

    const rawId = String(userId).trim();
    const gptId = rawId.startsWith("GPT-") ? rawId : `GPT-${rawId}`;
    const numericId = rawId.replace(/^GPT-/, "");

    const user = await UserProfile.findOne({
      $or: [{ user_id: gptId }, { amember_user_id: numericId }],
    }).lean();

    const featureObject = await buildFeatureObject(gptId, user);
    const creditStatus = await UnifiedCreditController.getCreditStatus(gptId);

    const roomIds = new Set([gptId, numericId]);

    if (global.io) {
      const sessionUser = {
        status: true,
        user_id: numericId,
        login: user?.login || "",
        user_name: user?.name || `${user?.name_f || ""} ${user?.name_l || ""}`.trim() || user?.login || "",
        user_email: user?.email || "",
        name_f: user?.name_f || "",
        name_l: user?.name_l || "",
        userSubscriptionType: user?.subscriptions || {},
        created_from: user?.created_from || "GPT",
        featureObject,
      };

      for (const room of roomIds) {
        global.io.to(room).emit("session", sessionUser);
        global.io.to(room).emit("credits", {
          creditsUsed: creditStatus.used_credits,
          totalCredits: creditStatus.total_credits,
          remainingCredits: creditStatus.remaining_credits,
          frozenCredits: creditStatus.frozen_credits,
          settledCredits: creditStatus.settled_credits,
          subscription: creditStatus.subscription,
          rollover: creditStatus.rollover,
          topup: creditStatus.topup,
        });
      }
    }
  } catch (err) {
    console.warn(`[notifyUserSessionUpdate] failed for ${userId}: ${err.message}`);
  }
}

module.exports = { notifyUser, sendPushToUser, notifyUserSessionUpdate };
