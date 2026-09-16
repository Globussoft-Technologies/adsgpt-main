const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const {
  StreamableHTTPClientTransport,
} = require("@modelcontextprotocol/sdk/client/streamableHttp.js");
const { getProfile } = require("./mcpMode");

/**
 * Connect a fresh MCP client for a single chat turn, scoped to one user's Meta
 * access token, against whichever MCP server this user's mode selects.
 *
 * Endpoint and auth headers both come from the profile (see mcpMode.js) — this
 * file deliberately knows nothing about which server it is talking to:
 *
 *  - local     `X-API-Key` authenticates this backend to the self-hosted fork
 *              (service-to-service), and `X-Meta-Token` supplies the per-request
 *              Meta token, which that server scopes via AsyncLocalStorage.
 *  - official  `Authorization: Bearer` carries the same per-user Meta token;
 *              Meta's hosted server accepts a standard Graph user access token.
 *
 * Building an HTTP client per turn is cheap (not a subprocess) and keeps one
 * user's token from ever being visible to another user's request. It also means
 * a mode change takes effect on the next turn — nothing holds a stale connection.
 *
 * Returns the client plus the profile, so the caller does not resolve the mode a
 * second time and cannot end up with a client and profile that disagree.
 */
async function createMcpClient(metaAccessToken, userId) {
  if (!metaAccessToken) {
    throw new Error("A Meta access token is required to create an MCP client.");
  }

  const profile = getProfile(userId);
  const url = profile.url();
  if (!url) {
    throw new Error(
      `${profile.urlEnvVar} must be set to use the Meta Ads chatbot in "${profile.mode}" mode.`
    );
  }

  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: profile.headers(metaAccessToken) },
  });

  const client = new Client({ name: "adsgpt-meta-chat", version: "1.0.0" });
  await client.connect(transport);

  // Carried on the client so every downstream consumer (loadTools, executeCall,
  // the plan gate) reads the same profile this connection was built from.
  client.mcpProfile = profile;
  return client;
}

module.exports = { createMcpClient };
