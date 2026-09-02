const mongoose = require("mongoose");

const ipAccessRuleSchema = new mongoose.Schema(
  {
    value: { type: String, required: true, trim: true, lowercase: true, unique: true },
    kind: { type: String, enum: ["address", "cidr"], required: true },
    ipVersion: { type: Number, enum: [4, 6], required: true },
    action: { type: String, enum: ["allow", "block"], required: true },
    status: { type: String, enum: ["active", "inactive"], default: "active" },
    label: { type: String, required: true, trim: true, maxlength: 100 },
    notes: { type: String, trim: true, maxlength: 500, default: "" },
    createdBy: { type: String, trim: true, default: "admin" },
    updatedBy: { type: String, trim: true, default: "admin" },
  },
  { timestamps: true },
);

ipAccessRuleSchema.index({ status: 1, action: 1 });
ipAccessRuleSchema.index({ updatedAt: -1 });

module.exports = mongoose.model("IpAccessRule", ipAccessRuleSchema);
