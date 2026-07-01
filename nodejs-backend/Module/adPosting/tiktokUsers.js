const mongoose = require("mongoose");

const tiktokUserSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      index: true,
    },
    tiktokAppId: {
      type: String,
      required: true,
    },
    accessToken: {
      type: String,
      required: true,
    },
    refreshToken: {
      type: String,
      default: "",
    },
    tokenExpiresAt: {
      type: Date,
    },
    advertiserIds: {
      type: [String],
      default: [],
    },
    advertiserInfo: [
      {
        advertiserId: String,
        name: String,
        currency: String,
        timezone: String,
        status: String,
      },
    ],
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("TiktokUsers", tiktokUserSchema);
