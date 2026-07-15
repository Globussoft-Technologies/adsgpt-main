const mongoose = require("mongoose");

/**
 * OAuthAuditLog — one row per meaningful OAuth event.
 *
 * Written by every endpoint that issues, refreshes, revokes, or fails to
 * validate a token or credential. Useful for post-hoc breach investigation
 * and abuse alerting (e.g. burst of failed /oauth/register from one IP).
 *
 * Not on the hot path for correctness — writes are fire-and-forget. If Mongo
 * is down we log the failure and keep serving requests.
 */
const oauthAuditLogSchema = new mongoose.Schema(
  {
    event: {
      type: String,
      required: true,
      index: true,
      // Extend as new events surface — enum kept open on purpose.
      // Known: "client_registered", "client_suspended",
      //        "authorize_requested", "authorize_denied",
      //        "consent_granted", "consent_revoked",
      //        "code_issued", "code_redeemed", "code_replay_detected",
      //        "token_issued", "refresh_rotated", "refresh_replay_detected",
      //        "token_revoked", "signing_key_rotated"
    },
    client_id: { type: String, default: null, index: true },
    user_id: { type: String, default: null, index: true },
    ip: { type: String, default: null },
    user_agent: { type: String, default: null },

    // Free-form context — reason for failure, requested scopes, etc.
    detail: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

// Auto-purge audit rows after 90 days.
oauthAuditLogSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 90 * 24 * 60 * 60 },
);

module.exports = mongoose.model("OAuthAuditLog", oauthAuditLogSchema);
