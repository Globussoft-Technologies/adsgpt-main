const mongoose = require("mongoose");
const Schema = mongoose.Schema;

// Audit log of every AI data-sharing consent decision. Add-only: the code
// only ever creates rows here, never edits or deletes them.
const AiConsentHistorySchema = new Schema(
  {
    user_id: { type: String, required: true, index: true },
    action: { type: String, enum: ["grant", "withdraw"], required: true },
    version: { type: String, default: null },
    platform: { type: String, default: "" },
    app_version: { type: String, default: "" },
    decided_at: { type: Date, required: true },
    user_agent: { type: String, default: "" },
  },
  { collection: "ai_consent_history", versionKey: false },
);

module.exports = mongoose.model("AiConsentHistory", AiConsentHistorySchema);
