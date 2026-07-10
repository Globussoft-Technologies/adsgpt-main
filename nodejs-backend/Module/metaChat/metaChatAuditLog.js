const mongoose = require("mongoose");

/**
 * metaChatAuditLog — one row per tool call the chatbot actually executed
 * (read or write), modeled on autopilot's AutopilotActionLog so write
 * actions taken via chat are attributable and reviewable the same way.
 *
 * Read-tool rows are logged with `confirmedBy: null` (auto-executed, no
 * confirmation needed). Write-tool rows always carry `confirmedBy` /
 * `confirmedAt` — the chat loop never executes a write without going
 * through the confirm endpoint first.
 */
const metaChatAuditLogSchema = new mongoose.Schema(
  {
    sessionId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    adAccountId: { type: String, required: true, index: true },

    toolName: { type: String, required: true },
    toolArgs: { type: mongoose.Schema.Types.Mixed },
    readOnly: { type: Boolean, required: true },

    outcome: {
      type: String,
      enum: ["success", "failed", "declined"],
      required: true,
    },
    result: { type: mongoose.Schema.Types.Mixed },
    error: { type: String },

    confirmedBy: { type: String, default: null },
    confirmedAt: { type: Date, default: null },
    executedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

metaChatAuditLogSchema.index({ userId: 1, executedAt: -1 });
metaChatAuditLogSchema.index({ adAccountId: 1, executedAt: -1 });

// Retention: audit rows are kept far longer than chat sessions (this is the
// attributable record of what actually ran against a live ad account), but
// still not forever. Configurable via env; default 180 days.
const AUDIT_TTL_SECONDS = (Number(process.env.META_CHAT_AUDIT_TTL_DAYS) || 180) * 86400;
metaChatAuditLogSchema.index({ executedAt: 1 }, { expireAfterSeconds: AUDIT_TTL_SECONDS });

module.exports = mongoose.model("MetaChatAuditLog", metaChatAuditLogSchema);
