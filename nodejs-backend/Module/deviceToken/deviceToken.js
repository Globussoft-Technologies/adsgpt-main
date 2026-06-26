const mongoose = require("mongoose");
const Schema = mongoose.Schema;

// One row per (device, user). The FCM registration token is the natural unique
// key — a single physical device has exactly one token at a time, and FCM
// rotates it. We upsert on `token` so re-registering the same device just
// refreshes its userId/lastSeenAt instead of creating duplicates.
const DeviceTokenSchema = new Schema(
  {
    // The amember-derived user id, already source-prefixed (e.g. "GPT-123",
    // "PAS-456") to match the socket room name used for emits.
    userId: { type: String, required: true, index: true },

    // FCM registration token handed to us by the native app.
    token: { type: String, required: true, unique: true },

    platform: {
      type: String,
      enum: ["ios", "android"],
      required: true,
    },

    // Optional client metadata — handy for debugging / future targeting.
    appVersion: { type: String, default: "" },
    deviceModel: { type: String, default: "" },

    // Flipped to false when FCM reports the token is no longer registered
    // (app uninstalled / token expired). We keep the row for audit rather than
    // hard-deleting, and filter on isActive when sending.
    isActive: { type: Boolean, default: true },

    lastSeenAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

// Fast lookup of a user's deliverable tokens at send time.
DeviceTokenSchema.index({ userId: 1, isActive: 1 });

module.exports = mongoose.model("DeviceToken", DeviceTokenSchema);
