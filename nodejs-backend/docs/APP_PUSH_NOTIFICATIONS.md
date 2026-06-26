# App Push Notifications (FCM) — Phase 1 (Backend)

Generation-complete notifications now go out over **two channels**:

| Audience | Channel | Status |
| --- | --- | --- |
| Web users | WebSocket (`socket.io`) | unchanged |
| Native app **foreground** | WebSocket (app holds a live socket) | unchanged |
| Native app **background / closed** | **FCM push** (Firebase Cloud Messaging) | **new** |

One `firebase-admin` SDK delivers to **both** Android (FCM) and iOS (FCM → APNs),
so the backend stays a single code path.

## What changed in this repo

- `services/push/firebaseAdmin.js` — lazy Firebase Admin bootstrap. No env set ⇒
  push silently disabled, web sockets unaffected.
- `services/push/notifyUser.js` — dual-channel dispatcher: `global.io` emit **+**
  FCM push, each independently guarded. Retires dead FCM tokens automatically.
- `Module/deviceToken/deviceToken.js` — `DeviceToken` Mongoose model
  (`userId`, `token` (unique), `platform`, `isActive`, …).
- `controllers/deviceToken.controller.js` + `Router/deviceTokenRoutes.js` —
  register / unregister endpoints (mounted at `/device-tokens`, behind `authenticateJWT`).
- `controllers/imageController.js`, `controllers/videoController.js` — the four
  `imageCreated` / `videoCreated` emit sites now call `notifyUser()`. Socket
  payloads are byte-for-byte identical; push fires only on the first successful
  callback (duplicate-callback paths re-emit to the socket but do **not** re-push).

## Configuration (ops — one-time)

1. Firebase console → create project → register the iOS and Android apps.
2. iOS: create an APNs auth key (`.p8`) in the Apple Developer portal and upload
   it under **Firebase → Project settings → Cloud Messaging → Apple app config**.
3. Firebase → **Project settings → Service accounts → Generate new private key**
   → download the JSON.
4. Set **one** of these env vars on the backend:

   ```bash
   # preferred — base64 avoids multi-line JSON quoting issues
   FIREBASE_SERVICE_ACCOUNT_BASE64=<base64 of the service-account .json>

   # fallback — raw JSON string
   FIREBASE_SERVICE_ACCOUNT={"type":"service_account",...}
   ```

   To produce the base64 value: `base64 -w0 service-account.json`

Until an env var is set, the backend logs `push notifications disabled` and only
WebSocket notifications are sent — safe to deploy before Firebase is provisioned.

## API (for the native app teams)

All endpoints require the standard `Authorization: Bearer <jwt>` header.

### Register / refresh a device token
Call on app launch, on login, and on every FCM token rotation.

```
POST /device-tokens
{
  "token": "<fcm registration token>",
  "platform": "ios" | "android",
  "appVersion": "1.0.0",     // optional
  "deviceModel": "iPhone15,2" // optional
}
→ 200 { "success": true }
```

### Unregister a device token
Call on logout (so a shared device stops receiving this user's pushes).

```
DELETE /device-tokens
{ "token": "<fcm registration token>" }
→ 200 { "success": true }
```

### Push payload the app receives
```
notification: { title, body }
data: { type: "image" | "video", id: "<generation _id>" }
```
Use `data.type` + `data.id` to deep-link to the generated asset on tap.

## App team responsibilities (Phase 2)

The backend (Phase 1) is complete: it stores device tokens and fires FCM pushes
on generation-complete. The remaining work is owned by the native app teams.

### Shared (both platforms)
- Add the Firebase SDK and register the app in the Firebase console
  (project `adsgpt-b2c34`).
- Obtain the FCM registration token and `POST /device-tokens` with the user's
  JWT — on **app launch**, on **login**, and on **every token refresh**.
- `DELETE /device-tokens` on **logout** so a shared device stops receiving the
  previous user's pushes.
- On notification tap, read `data.type` (`"image"` | `"video"`) and `data.id`
  (the generation `_id`) and **deep-link** to that asset.
- Decide foreground behaviour: the app receives both the live socket update and
  the push, so suppress/replace the system banner while foregrounded if desired.

### iOS team (Swift / SwiftUI)
- Add the **APNs Authentication Key (`.p8`)** in the Apple Developer portal and
  confirm it is uploaded to Firebase → *Cloud Messaging → Apple app config*
  (Key ID + Team ID). FCM cannot reach iOS without this.
- Enable the **Push Notifications** capability and **Background Modes → Remote
  notifications** in Xcode.
- Request authorization via `UNUserNotificationCenter`, register with APNs
  (`registerForRemoteNotifications`), and bridge to FCM via the
  `FirebaseMessaging` SDK (`Messaging.messaging().token { ... }`).
- Handle token rotation in `MessagingDelegate.messaging(_:didReceiveRegistrationToken:)`
  and re-`POST /device-tokens`.
- Wire delivery in the `AppDelegate` (via `@UIApplicationDelegateAdaptor` for a
  SwiftUI app) and handle taps in `userNotificationCenter(_:didReceive:)`.

### Android team (Kotlin / Jetpack Compose)
- Add the `firebase-messaging` SDK and the `google-services.json` for the
  Android app.
- Request the **`POST_NOTIFICATIONS`** runtime permission on Android 13+ (API 33).
- Implement a `FirebaseMessagingService`:
  - `onNewToken(token)` → re-`POST /device-tokens`.
  - `onMessageReceived(message)` → build the notification when the app is
    foregrounded (background/closed messages are auto-displayed by the system).
- Get the initial token via `FirebaseMessaging.getInstance().token` at launch.
- Handle the tap intent / deep link using `data.type` + `data.id`.

### Definition of done (Phase 2)
On a **real device**, with the app **backgrounded or closed**: log in → run an
image/video generation → the OS notification arrives → tapping it opens the
generated asset.

## Notes / future (Phase 3)
- Foreground apps receive **both** the socket event and the push. The app can
  suppress the system banner while foregrounded, or the backend can later skip
  push when a live socket exists for the user (Redis `user:{userId}` already
  tracks this).
- Other generation events (ad copy, ad creative, ad factory) can be routed
  through `notifyUser()` the same way when needed.
