const mongoose = require("mongoose");

/**
 * OAuthAuthorizationCode — short-lived, single-use grant issued after user
 * consent and exchanged at /oauth/token for an access + refresh token pair.
 *
 * Lifecycle:
 *   issued at /oauth/consent  → status: unused
 *   redeemed at /oauth/token  → used_at set; row kept ~10 min for replay
 *                               detection, then TTL-purged.
 *
 * Replay protection: any /oauth/token call for a code with used_at != null
 * is a replay attack. Response: 400 invalid_grant + revoke any tokens issued
 * from this code (family invalidation upstream).
 */
const oauthAuthCodeSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, index: true },

    client_id: { type: String, required: true, index: true },
    user_id: { type: String, required: true, index: true },

    // MUST match the redirect_uri presented at /oauth/token — exact string.
    redirect_uri: { type: String, required: true },

    scopes: { type: [String], default: [] },

    // PKCE — S256 is the only method we accept.
    code_challenge: { type: String, required: true },
    code_challenge_method: {
      type: String,
      enum: ["S256"],
      default: "S256",
    },

    // OIDC replay protection — echoed into id_token if present.
    nonce: { type: String, default: null },

    // Optional resource indicator (RFC 8707) — the specific MCP the token is
    // intended for. Copied into access_token `aud` claim.
    resource: { type: String, default: null },

    expires_at: { type: Date, required: true },
    used_at: { type: Date, default: null },
  },
  { timestamps: true },
);

// Auto-purge 10 min after expiry so replay-detection window survives past exp.
oauthAuthCodeSchema.index(
  { expires_at: 1 },
  { expireAfterSeconds: 600 },
);

module.exports = mongoose.model("OAuthAuthorizationCode", oauthAuthCodeSchema);
