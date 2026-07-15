const mongoose = require("mongoose");

/**
 * OAuthRefreshToken — opaque, hashed refresh token record.
 *
 * We never store the token plaintext. On /oauth/token refresh, hash the
 * incoming token with sha256 and look up by that hash.
 *
 * Rotation: every refresh issues a NEW refresh token and revokes the old one.
 * The `family_id` links a chain of rotations back to the original issuance;
 * `parent_token_hash` points at the immediate predecessor.
 *
 * Replay detection: if a refresh token comes in with revoked_at != null, the
 * caller is presenting an old link in the chain. That means either a bug or a
 * theft — invalidate the entire family_id immediately.
 */
const oauthRefreshTokenSchema = new mongoose.Schema(
  {
    token_hash: { type: String, required: true, unique: true, index: true },

    client_id: { type: String, required: true, index: true },
    user_id: { type: String, required: true, index: true },

    scopes: { type: [String], default: [] },
    resource: { type: String, default: null },

    family_id: { type: String, required: true, index: true },
    parent_token_hash: { type: String, default: null },

    expires_at: { type: Date, required: true },
    revoked_at: { type: Date, default: null },
    last_used_at: { type: Date, default: null },
    ip_last_used: { type: String, default: null },
    ua_last_used: { type: String, default: null },
  },
  { timestamps: true },
);

// TTL: delete records 7 days after they expire (keep for audit trail briefly).
oauthRefreshTokenSchema.index(
  { expires_at: 1 },
  { expireAfterSeconds: 7 * 24 * 60 * 60 },
);

module.exports = mongoose.model("OAuthRefreshToken", oauthRefreshTokenSchema);
