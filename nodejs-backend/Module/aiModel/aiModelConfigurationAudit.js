const mongoose = require("mongoose");

const auditSchema = new mongoose.Schema(
  {
    action: {
      type: String,
      required: true,
      enum: ["create", "update", "enable", "disable", "archive", "surface_update"],
      index: true,
    },
    canonicalKey: { type: String, required: true, index: true },
    adminUsername: { type: String, default: null },
    before: { type: mongoose.Schema.Types.Mixed, default: null },
    after: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true, minimize: false },
);

module.exports =
  mongoose.models.AIModelConfigurationAudit ||
  mongoose.model("AIModelConfigurationAudit", auditSchema);
