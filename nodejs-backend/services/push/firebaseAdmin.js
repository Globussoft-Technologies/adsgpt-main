// Firebase Admin SDK bootstrap — single source of the FCM messaging client.
//
// Credentials come from a service-account key (downloaded from the Firebase
// console → Project settings → Service accounts). To avoid the pain of putting
// raw multi-line JSON into an env var, we accept it as base64:
//
//   FIREBASE_SERVICE_ACCOUNT_BASE64 = <base64 of the service-account .json>
//
// (A raw JSON string in FIREBASE_SERVICE_ACCOUNT is also accepted as a fallback.)
//
// If neither env var is set, push is treated as "not configured": getMessaging()
// returns null and the dispatcher silently skips push (web sockets still work).
// This keeps the backend deployable before Firebase is provisioned.

let messaging = null;
let initAttempted = false;

function loadServiceAccount() {
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;

  if (b64) {
    return JSON.parse(Buffer.from(b64, "base64").toString("utf-8"));
  }
  if (raw) {
    return JSON.parse(raw);
  }
  return null;
}

// Lazily initialise on first use so importing this file never throws and never
// requires firebase-admin to be installed unless push is actually configured.
function init() {
  if (initAttempted) return;
  initAttempted = true;

  const serviceAccount = loadServiceAccount();
  if (!serviceAccount) {
    console.warn(
      "[push] FIREBASE_SERVICE_ACCOUNT(_BASE64) not set — push notifications disabled (web sockets unaffected)",
    );
    return;
  }

  try {
    // Require lazily so the dependency is only needed when push is enabled.
    // firebase-admin v14 uses the modular subpath API (admin.apps /
    // admin.credential / admin.messaging were removed from the root export).
    const { initializeApp, getApps, cert } = require("firebase-admin/app");
    const { getMessaging } = require("firebase-admin/messaging");

    const app = getApps().length
      ? getApps()[0]
      : initializeApp({ credential: cert(serviceAccount) });
    messaging = getMessaging(app);
    console.log("[push] Firebase Admin initialised — FCM push enabled");
  } catch (err) {
    console.error(`[push] Firebase Admin init failed: ${err.message}`);
    messaging = null;
  }
}

// Returns the FCM messaging client, or null if push is not configured.
function getMessaging() {
  init();
  return messaging;
}

function isPushEnabled() {
  init();
  return !!messaging;
}

module.exports = { getMessaging, isPushEnabled };
