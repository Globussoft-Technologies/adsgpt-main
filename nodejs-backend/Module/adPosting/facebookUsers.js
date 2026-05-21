const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    facebookId: {
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
    tokenExpiresAt: {
      type: Date,
    },
    userId: {
      type: String,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("FacebookUsers", userSchema);
