const mongoose = require("mongoose");

/**
 * tokenUsage — one row per LLM API call, mirroring generatedMedia's role for
 * image/video generation (Module/generatedMedia/generated.media.js): raw
 * per-call records that the admin dashboard aggregates, not a running total.
 *
 * One row per actual API call (not per user-visible chat turn) — a single
 * turn can involve several calls (e.g. a tool-calling loop), and each call's
 * `usageMetadata` from the SDK already reflects that call's own token count
 * accurately; summing across calls within a turn would double-count prompt
 * tokens (later calls resend the growing conversation history as context).
 *
 * `feature` is intentionally a free string, not an enum — mirrors
 * generatedMedia's `source` field, so a new feature can start logging without
 * a schema change. Currently only "meta_chat" (the Ads Chat MCP chatbot).
 */
const tokenUsageSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true },
    feature: { type: String, required: true },
    model: { type: String, required: true },
    sdk: { type: String, enum: ["genai", "generative-ai"], required: true },

    inputTokens: { type: Number, default: 0 },
    outputTokens: { type: Number, default: 0 },
    thinkingTokens: { type: Number, default: 0 },
    cachedTokens: { type: Number, default: 0 },
    toolUseTokens: { type: Number, default: 0 },
    totalTokens: { type: Number, default: 0 },

    // Correlates rows back to their conversation (e.g. MetaChatSession.sessionId).
    sessionId: { type: String, default: null },
  },
  { timestamps: true }
);

tokenUsageSchema.index({ userId: 1, createdAt: -1 });
tokenUsageSchema.index({ feature: 1, createdAt: -1 });
tokenUsageSchema.index({ model: 1, createdAt: -1 });

module.exports = mongoose.model("TokenUsage", tokenUsageSchema);
