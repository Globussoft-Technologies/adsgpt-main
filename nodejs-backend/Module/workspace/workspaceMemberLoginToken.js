const mongoose = require("mongoose");

const workspaceMemberLoginTokenSchema = new mongoose.Schema(
  {
    memberAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "WorkspaceMemberAccount",
      required: true,
      index: true,
    },
    tokenHash: { type: String, required: true, unique: true, index: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

workspaceMemberLoginTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model(
  "WorkspaceMemberLoginToken",
  workspaceMemberLoginTokenSchema,
);
