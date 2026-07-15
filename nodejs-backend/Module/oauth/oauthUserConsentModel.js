const mongoose = require("mongoose");

/**
 * OAuthUserConsent — remembered consent so a user doesn't re-approve the same
 * client + scope set on every reconnect.
 *
 * On /oauth/authorize:
 *   - Look up (user_id, client_id).
 *   - If granted_scopes covers the requested scopes, skip the consent screen.
 *   - If requested scopes include anything not in granted_scopes, prompt the
 *     user and upsert.
 *
 * Revocation: user can hit DELETE /account/connected-apps/:client_id to nuke
 * the row + every active refresh token for that (user, client) pair.
 */
const oauthUserConsentSchema = new mongoose.Schema(
  {
    user_id: { type: String, required: true, index: true },
    client_id: { type: String, required: true, index: true },

    granted_scopes: { type: [String], default: [] },

    granted_at: { type: Date, default: Date.now },
    last_used_at: { type: Date, default: null },
    revoked_at: { type: Date, default: null },
  },
  { timestamps: true },
);

oauthUserConsentSchema.index({ user_id: 1, client_id: 1 }, { unique: true });

module.exports = mongoose.model("OAuthUserConsent", oauthUserConsentSchema);
