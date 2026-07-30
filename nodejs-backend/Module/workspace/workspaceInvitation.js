const mongoose = require("mongoose");
const {
  WORKSPACE_FEATURE_VALUES,
} = require("../../services/workspace/workspaceConfig");

const workspaceInvitationSchema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Workspace",
      required: true,
      index: true,
    },
    invitedByUserId: { type: String, required: true },
    inviteeEmail: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      index: true,
    },
    features: {
      type: [{ type: String, enum: WORKSPACE_FEATURE_VALUES }],
      required: true,
    },
    tokenHash: { type: String, required: true, unique: true, index: true },
    openKey: { type: String, default: undefined },
    status: {
      type: String,
      enum: ["pending", "accepting", "accepted", "revoked", "expired"],
      default: "pending",
      index: true,
    },
    expiresAt: { type: Date, required: true, index: true },
    acceptanceAttemptId: { type: String, default: null },
    acceptanceStartedAt: { type: Date, default: null },
    acceptedByUserId: { type: String, default: null },
    acceptedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

workspaceInvitationSchema.index(
  { openKey: 1 },
  {
    unique: true,
    partialFilterExpression: { openKey: { $type: "string" } },
  },
);

module.exports = mongoose.model("WorkspaceInvitation", workspaceInvitationSchema);
