const mongoose = require("mongoose");

const metaFixLogSchema = new mongoose.Schema(
  {
    findingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "MetaAuditFinding",
      required: true,
      index: true,
    },
    auditId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    adAccountId: { type: String, required: true },

    action_type: { type: String, required: true },
    params: { type: mongoose.Schema.Types.Mixed, default: {} },

    entity_type: {
      type: String,
      enum: ["campaign", "adset", "ad"],
      required: true,
    },
    entity_id: { type: String, required: true },

    beforeState: { type: mongoose.Schema.Types.Mixed },
    afterState: { type: mongoose.Schema.Types.Mixed },

    status: {
      type: String,
      enum: ["success", "failed", "reverted"],
      required: true,
    },
    error: { type: String },

    revertedAt: { type: Date },
  },
  { timestamps: true },
);

module.exports = mongoose.model("MetaFixLog", metaFixLogSchema);
