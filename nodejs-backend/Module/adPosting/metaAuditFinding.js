const mongoose = require("mongoose");

const fixSchema = new mongoose.Schema(
  {
    action_type: { type: String, required: true },
    params: { type: mongoose.Schema.Types.Mixed, default: {} },
    risk_level: {
      type: String,
      enum: ["low", "medium", "high"],
      default: "low",
    },
    reversible: { type: Boolean, default: true },
  },
  { _id: false },
);

const metaAuditFindingSchema = new mongoose.Schema(
  {
    auditId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    adAccountId: { type: String, required: true },

    severity: {
      type: String,
      enum: ["critical", "warning", "opportunity"],
      required: true,
    },
    entity_type: {
      type: String,
      enum: ["campaign", "adset", "ad"],
      required: true,
    },
    entity_id: { type: String, required: true },
    entity_name: { type: String },

    title: { type: String, required: true },
    reasoning: { type: String, required: true },

    fix: { type: fixSchema, required: true },

    status: {
      type: String,
      enum: ["pending", "applied", "dismissed", "stale", "failed"],
      default: "pending",
      index: true,
    },

    appliedAt: { type: Date },
    dismissedAt: { type: Date },
    expiresAt: { type: Date },

    beforeState: { type: mongoose.Schema.Types.Mixed },
    afterState: { type: mongoose.Schema.Types.Mixed },

    lastError: { type: String },
  },
  { timestamps: true },
);

metaAuditFindingSchema.index({ userId: 1, auditId: 1 });

module.exports = mongoose.model("MetaAuditFinding", metaAuditFindingSchema);
