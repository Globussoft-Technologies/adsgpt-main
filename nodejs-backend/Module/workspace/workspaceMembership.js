const mongoose = require("mongoose");
const {
  WORKSPACE_FEATURE_VALUES,
} = require("../../services/workspace/workspaceConfig");

const workspaceMembershipSchema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Workspace",
      required: true,
      index: true,
    },
    memberAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "WorkspaceMemberAccount",
      required: true,
      index: true,
    },
    features: {
      type: [{ type: String, enum: WORKSPACE_FEATURE_VALUES }],
      required: true,
    },
    status: {
      type: String,
      enum: ["active", "removed"],
      default: "active",
      index: true,
    },
    invitedByUserId: { type: String, required: true },
    joinedAt: { type: Date, default: Date.now },
    removedAt: { type: Date, default: null },
    // Internal compare-and-swap marker used while accepting an invitation.
    // Compensation may only modify a membership while it still owns this id.
    acceptanceAttemptId: { type: String, default: null },
  },
  { timestamps: true },
);

workspaceMembershipSchema.index(
  { workspaceId: 1, memberAccountId: 1 },
  { unique: true },
);
workspaceMembershipSchema.index({ memberAccountId: 1, status: 1 });

module.exports = mongoose.model("WorkspaceMembership", workspaceMembershipSchema);
