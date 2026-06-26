const DeviceToken = require("../Module/deviceToken/deviceToken");

// Register (or refresh) a device's FCM token for the authenticated user.
// Idempotent: the native app calls this on launch/login and on every FCM token
// rotation. Upsert on `token` so re-registering the same device updates its
// owner/metadata instead of creating duplicate rows.
exports.registerDeviceToken = async (req, res) => {
  /* #swagger.tags = ['Device Tokens']
     #swagger.summary = 'Register or refresh an FCM device token'
     #swagger.description = 'Called by the native iOS/Android app on launch, on login, and on every FCM token rotation. Upserts on the token so re-registering the same device refreshes its owner/metadata instead of creating duplicates. Used to deliver generation-complete push notifications.'
     #swagger.security = [{ "BearerAuth": [] }]
     #swagger.requestBody = {
        required: true,
        content: {
            "application/json": {
                schema: {
                    type: "object",
                    required: ["token", "platform"],
                    properties: {
                        token: { type: "string", description: "FCM registration token from the device" },
                        platform: { type: "string", enum: ["ios", "android"] },
                        appVersion: { type: "string", description: "Optional app version" },
                        deviceModel: { type: "string", description: "Optional device model" }
                    }
                },
                example: {
                    token: "fcm_registration_token_here",
                    platform: "android",
                    appVersion: "1.0.0",
                    deviceModel: "Pixel 8"
                }
            }
        }
     }
     #swagger.responses[200] = { description: 'Token registered' }
     #swagger.responses[400] = { description: 'Missing/invalid token or platform' }
     #swagger.responses[401] = { description: 'Unauthorized' }
  */
  try {
    const userId = req.user?.user_id;
    if (!userId) {
      return res.status(401).json({ success: false, error: "Unauthorized" });
    }

    const { token, platform, appVersion, deviceModel } = req.body || {};

    if (!token || typeof token !== "string") {
      return res
        .status(400)
        .json({ success: false, error: "`token` is required" });
    }
    if (!["ios", "android"].includes(platform)) {
      return res.status(400).json({
        success: false,
        error: "`platform` must be 'ios' or 'android'",
      });
    }

    await DeviceToken.findOneAndUpdate(
      { token },
      {
        $set: {
          userId,
          platform,
          appVersion: appVersion || "",
          deviceModel: deviceModel || "",
          isActive: true,
          lastSeenAt: new Date(),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    return res.status(200).json({ success: true });
  } catch (err) {
    // A race on the unique `token` index can throw E11000; treat as success
    // since the token is registered either way.
    if (err?.code === 11000) {
      return res.status(200).json({ success: true });
    }
    console.error("Error in registerDeviceToken:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
};

// Unregister a device on logout so a shared device stops receiving this user's
// pushes. Hard-deletes the row(s).
exports.unregisterDeviceToken = async (req, res) => {
  /* #swagger.tags = ['Device Tokens']
     #swagger.summary = 'Unregister an FCM device token'
     #swagger.description = 'Called on logout so a shared device stops receiving the previous user\'s push notifications. Deletes the token row, scoped to the authenticated user.'
     #swagger.security = [{ "BearerAuth": [] }]
     #swagger.requestBody = {
        required: true,
        content: {
            "application/json": {
                schema: {
                    type: "object",
                    required: ["token"],
                    properties: {
                        token: { type: "string", description: "FCM registration token to remove" }
                    }
                },
                example: { token: "fcm_registration_token_here" }
            }
        }
     }
     #swagger.responses[200] = { description: 'Token removed' }
     #swagger.responses[400] = { description: 'Missing token' }
     #swagger.responses[401] = { description: 'Unauthorized' }
  */
  try {
    const userId = req.user?.user_id;
    if (!userId) {
      return res.status(401).json({ success: false, error: "Unauthorized" });
    }

    const { token } = req.body || {};
    if (!token) {
      return res
        .status(400)
        .json({ success: false, error: "`token` is required" });
    }

    // Scope the delete to the caller so one user can't drop another's token.
    await DeviceToken.deleteOne({ token, userId });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("Error in unregisterDeviceToken:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
};
