const mongoose = require("mongoose");

/**
 * OAuthSigningKey — RS256 keypair used to sign JWT access + id tokens.
 *
 * Rotation policy:
 *   - Every ~90 days a cron generates a new key, marks it is_active=true, and
 *     leaves the previous key is_active=true for one JWT max-lifetime window
 *     (60 min) so already-issued tokens keep verifying. After that window the
 *     old key flips is_active=false but stays in JWKS for one more window,
 *     then is removed.
 *   - JWKS endpoint publishes every non-retired key so verifiers can pick by
 *     kid.
 *
 * private_key_pem storage:
 *   - Ideally KMS-encrypted at rest. For MVP we hold the plaintext PEM in the
 *     document and rely on Mongo-at-rest encryption + tight DB ACLs.
 *   - Rotate via ops/rotate-oauth-signing-key.js (TODO — cron will call the
 *     same underlying service function).
 */
const oauthSigningKeySchema = new mongoose.Schema(
  {
    // JWK "kid" — used to select the right public key at verify time.
    kid: { type: String, required: true, unique: true, index: true },

    alg: { type: String, default: "RS256" },

    public_key_pem: { type: String, required: true },
    private_key_pem: { type: String, required: true },

    // is_active === true → eligible for SIGNING new tokens.
    // is_active === false but still in JWKS → verification-only (grace window).
    is_active: { type: Boolean, default: true, index: true },

    // Present in JWKS while this is set — after removed_at is set (or reached),
    // exclude from JWKS. Rotation cron manages this.
    published_until: { type: Date, default: null },

    activated_at: { type: Date, default: Date.now },
    retired_at: { type: Date, default: null },
  },
  { timestamps: true },
);

module.exports = mongoose.model("OAuthSigningKey", oauthSigningKeySchema);
