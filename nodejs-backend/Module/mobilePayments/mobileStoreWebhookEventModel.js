const mongoose = require("mongoose");

const mobileStoreWebhookEventSchema = new mongoose.Schema(
  {
    platform: { type: String, enum: ["ios", "android"], required: true },
    event_id: { type: String, required: true, unique: true }, // Apple notificationUUID / PubSub messageId
    event_type: { type: String, required: true },
    state: { type: String, enum: ["received", "processing", "processed", "failed"], default: "processed" },
    attempts: { type: Number, default: 1 },

    // Future-Proof Raw Webhook Storage
    raw_payload: { type: mongoose.Schema.Types.Mixed, default: {} },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },

    received_at: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.model("MobileStoreWebhookEvent", mobileStoreWebhookEventSchema);
