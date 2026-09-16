/**
 * Facebook OAuth scopes that Ads Chat depends on.
 *
 * Scopes are fixed on a token at connect time, so a scope that goes missing does
 * not fail at deploy — it fails months later, for one user at a time, as a Meta
 * permission error deep inside a chat turn. And re-adding it does not fix the
 * users who already connected: every one of them has to re-consent.
 *
 * `ads_mcp_management` is the one most easily lost, because nothing in the app
 * uses it directly — it is consumed by Meta's hosted MCP server, so no local
 * code path breaks if someone drops it while tidying the list.
 *
 * Parsed from source rather than by calling initiateAuth(): requiring that
 * controller pulls in config that needs a live environment, and the assertion
 * here is about the declared list, not the redirect mechanics.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..", "..", "controllers", "adPosting", "authController.js");
const source = fs.readFileSync(SRC, "utf8");

const block = source.match(/const scope = \[([\s\S]*?)\]\.join/);
assert.ok(block, "could not find the scope array in authController.js");

// Only uncommented entries count — several scopes sit commented out in that list
// and a commented scope is not requested.
const requested = block[1]
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line.startsWith('"'))
  .map((line) => line.replace(/["',]/g, ""));

assert.ok(requested.length > 0, "no scopes parsed — the array's formatting changed");

// Required by Meta's hosted Ads MCP server. Its 401 names this in the
// WWW-Authenticate scope list; without it official mode returns
// "This resource is restricted to certain users" for every request.
assert.ok(
  requested.includes("ads_mcp_management"),
  "ads_mcp_management must stay in the OAuth scopes — official MCP mode cannot authorize without it, " +
    "and re-adding it later does not fix already-connected users (they must re-consent)",
);

// The scopes the app's own features depend on, so a tidy-up cannot quietly drop
// one and surface it as a permission error weeks later.
for (const scope of [
  "ads_management", // every read and write against the Marketing API
  "business_management", // ad accounts reachable through Business Manager
  "pages_show_list", // the wizard's Page picker
  "pages_manage_ads", // creating ads against a Page
  "leads_retrieval", // the dashboard's Leads tab + show_leads_table in chat
]) {
  assert.ok(requested.includes(scope), `${scope} must stay in the OAuth scopes`);
}

// No duplicates — Facebook tolerates them, but a duplicate is a merge artifact
// and usually means two people added the same scope in different places.
assert.strictEqual(
  new Set(requested).size,
  requested.length,
  `duplicate scope requested: ${requested.join(",")}`,
);

// Not yet requested, and deliberately so — each needs a decision, not a silent
// addition. `ads_read` and `catalog_management` are required by official MCP
// mode (catalog_management was approved 2026-07-01 and never enabled);
// `instagram_basic` is in App Review. If you enable one, move it into the block
// above so it stays enabled. See docs/META_ADS_CHATBOT.md §10.
const KNOWN_PENDING = ["ads_read", "catalog_management", "instagram_basic"];
const stillPending = KNOWN_PENDING.filter((s) => !requested.includes(s));
if (stillPending.length !== KNOWN_PENDING.length) {
  console.log(
    `note: previously-pending scope(s) now requested: ${KNOWN_PENDING.filter((s) => requested.includes(s)).join(", ")}`,
  );
}

console.log(`metaChat oauthScopes tests passed (${requested.length} scopes requested)`);
