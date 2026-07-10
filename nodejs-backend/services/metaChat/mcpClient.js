const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const {
  StreamableHTTPClientTransport,
} = require("@modelcontextprotocol/sdk/client/streamableHttp.js");

const MCP_SERVER_URL = process.env.META_MCP_SERVER_URL;
const MCP_API_KEY = process.env.META_MCP_API_KEY;

/**
 * Connect a fresh MCP client to the Meta Ads MCP server for a single chat
 * turn, scoped to one user's Meta access token.
 *
 * Auth contract (byadsco meta-ads-mcp, header-only multi-tenant mode):
 *  - `X-API-Key: <MCP_API_KEY>` authenticates this backend to the server
 *    (service-to-service; the server rejects callers without it once a key
 *    is configured).
 *  - `X-Meta-Token: <user's Meta token>` supplies the per-request Meta access
 *    token, which the server scopes to the request via AsyncLocalStorage.
 *
 * Building an HTTP client per turn is cheap (not a subprocess) and keeps one
 * user's token from ever being visible to another user's request.
 */
async function createMcpClient(metaAccessToken) {
  if (!MCP_SERVER_URL) {
    throw new Error(
      "META_MCP_SERVER_URL must be set to use the Meta Ads chatbot."
    );
  }
  if (!metaAccessToken) {
    throw new Error("A Meta access token is required to create an MCP client.");
  }

  const headers = { "X-Meta-Token": metaAccessToken };
  if (MCP_API_KEY) headers["X-API-Key"] = MCP_API_KEY;

  const transport = new StreamableHTTPClientTransport(new URL(MCP_SERVER_URL), {
    requestInit: { headers },
  });

  const client = new Client({ name: "adsgpt-meta-chat", version: "1.0.0" });
  await client.connect(transport);
  return client;
}

module.exports = { createMcpClient };
