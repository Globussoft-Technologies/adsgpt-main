const mongoose = require("mongoose");

const googleUserSchema = new mongoose.Schema(
  {
    googleId: {
      type: String,
      required: true,
      unique: true,
    },
    name: {
      type: String,
      required: true,
    },
    email: {
      type: String,
    },
    accessToken: {
      type: String,
      required: true,
    },
    refreshToken: {
      type: String,
      required: true,
    },
    tokenExpiresAt: {
      type: Date,
    },
    userId: {
      type: String,
      required: true,
    },
    customerIds: {
      type: [String],
      default: [],
    },
    managerMap: {
      type: Map,
      of: String,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("GoogleUsers", googleUserSchema);
