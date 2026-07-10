const mongoose = require("mongoose");

/**
 * metaChatSession — one row per Meta Ads chatbot conversation.
 *
 * `history` stores the raw @google/genai Content[] (chat.getHistory()) so a
 * session can be rehydrated with `ai.chats.create({ ..., history })` without
 * replaying earlier tokens or tool calls. It's trimmed to the last N turns on
 * every save (see geminiMcpBridge.trimHistory) so it can't grow unbounded.
 *
 * `transcript` is the frontend-shaped conversation ({role, text, cards, ts}
 * per turn) — a separate, independent record of what the user actually saw,
 * used to restore the chat panel's UI when a session is resumed (see
 * GET /meta-ads/chat/history/:sessionId). Kept apart from `history` because
 * the two serve different consumers (Gemini vs. the chat UI) and are trimmed
 * independently.
 *
 * `pendingAction` is set while a write-tool call is awaiting user
 * confirmation (see services/metaChat/geminiMcpBridge.js) and cleared once
 * resolved. Only one pending action per session at a time — the chat loop
 * pauses on the first non-read-only tool call it encounters.
 */
const metaChatSessionSchema = new mongoose.Schema(
  {
    sessionId: { type: String, required: true, unique: true, index: true },
    userId: { type: String, required: true, index: true },
    adAccountId: { type: String, required: true },
    currency: { type: String },

    // Which campaign/ad set/ad the dashboard is currently drilled into —
    // resent on every turn (see metaChatController.streamChat) so the system
    // prompt's "current view" scoping stays in sync as the user navigates
    // underneath an open chat, without starting a new conversation.
    campaignId: { type: String, default: null },
    adSetId: { type: String, default: null },
    adId: { type: String, default: null },

    history: { type: mongoose.Schema.Types.Mixed, default: [] },
    transcript: { type: [mongoose.Schema.Types.Mixed], default: [] },

    pendingAction: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
  },
  { timestamps: true }
);

metaChatSessionSchema.index({ userId: 1, updatedAt: -1 });
metaChatSessionSchema.index({ adAccountId: 1, userId: 1, updatedAt: -1 });

// Retention: a session with no activity for this long is dropped entirely
// (history, transcript, pendingAction — all of it). MongoDB's TTL monitor
// evaluates this in the background, not on every query. Configurable since
// "30 days" is a judgment call, not a hard requirement.
const SESSION_TTL_SECONDS = (Number(process.env.META_CHAT_SESSION_TTL_DAYS) || 30) * 86400;
metaChatSessionSchema.index({ updatedAt: 1 }, { expireAfterSeconds: SESSION_TTL_SECONDS });

module.exports = mongoose.model("MetaChatSession", metaChatSessionSchema);
