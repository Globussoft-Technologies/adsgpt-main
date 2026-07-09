const mongoose = require("mongoose");

const partnerApiKeySchema = new mongoose.Schema(
  {
    partnerName: {
      type: String,
      required: true,
    },
    // First few chars of the raw key (e.g. "pk_live_ab12"), shown in the
    // admin UI/logs so a partner can be identified without ever storing or
    // displaying the full secret again after issuance.
    keyPrefix: {
      type: String,
      required: true,
    },
    hashedKey: {
      type: String,
      required: true,
      unique: true,
    },
    status: {
      type: String,
      enum: ["active", "revoked"],
      default: "active",
    },
    lastUsedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model("PartnerApiKey", partnerApiKeySchema);
