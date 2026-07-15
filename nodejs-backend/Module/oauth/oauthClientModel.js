const mongoose = require("mongoose");

/**
 * OAuthClient — a registered OAuth 2.1 client.
 *
 * Populated primarily via Dynamic Client Registration (RFC 7591) — Claude Code
 * or any other MCP-capable client calls POST /oauth/register on first connect
 * and gets back a fresh client_id (+ client_secret for confidential clients).
 *
 * Manually-provisioned clients (e.g. internal admin tools) can also live here
 * with registered_via = "manual".
 *
 * Public clients (native / CLI / SPA) use token_endpoint_auth_method = "none"
 * and MUST use PKCE. No client_secret is issued.
 */
const oauthClientSchema = new mongoose.Schema(
  {
    client_id: { type: String, required: true, unique: true, index: true },
    // argon2/bcrypt hash — plaintext returned ONCE from /oauth/register.
    // Absent for public clients (token_endpoint_auth_method === "none").
    client_secret_hash: { type: String, default: null },

    client_name: { type: String, default: "" },
    client_uri: { type: String, default: "" },
    logo_uri: { type: String, default: "" },

    // Exact-string match at /authorize and /token. No wildcards.
    // Localhost variants (http://127.0.0.1:*, http://localhost:*) allowed per
    // OAuth 2.1 native-app guidance for CLI clients.
    redirect_uris: { type: [String], default: [] },

    grant_types: {
      type: [String],
      default: ["authorization_code", "refresh_token"],
    },
    response_types: { type: [String], default: ["code"] },

    // "client_secret_post" | "client_secret_basic" | "none"
    // "none" ⇒ public client ⇒ PKCE required.
    token_endpoint_auth_method: {
      type: String,
      enum: ["client_secret_post", "client_secret_basic", "none"],
      default: "none",
    },

    // Whitelist of scopes this client may request. Requests for scopes outside
    // this set are rejected at /authorize.
    allowed_scopes: {
      type: [String],
      default: ["openid", "profile", "email"],
    },

    registered_via: {
      type: String,
      enum: ["dcr", "manual"],
      default: "dcr",
    },

    status: {
      type: String,
      enum: ["active", "suspended"],
      default: "active",
      index: true,
    },

    // Owner user_id when a human explicitly created the client (via developer
    // portal, if we ever add one). Null for pure DCR clients.
    owner_user_id: { type: String, default: null },
  },
  { timestamps: true },
);

module.exports = mongoose.model("OAuthClient", oauthClientSchema);
