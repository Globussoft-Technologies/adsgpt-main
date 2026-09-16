/**
 * Confirmation-card summaries, across both MCP modes.
 *
 * actionSummaries.js turns a raw write-tool call into the plain-English text a
 * user approves. It is the last thing standing between the model and a live ad
 * account, and it renders whatever the ACTIVE MCP server sends — the two servers
 * name the same arguments differently and Meta's passes structured values as
 * JSON strings, so a mode switch can silently degrade every card to "undefined"
 * or an escaped-JSON dump without anything throwing.
 *
 * The frontend has no test runner of its own (no test script, no vitest/jest in
 * react-frontend/package.json), and adding one for a single pure module is a
 * bigger change than it earns. So this loads that ES module into the backend's
 * plain-node runner by stripping its `export` keywords and evaluating it. If the
 * file moves or its exports change shape, this fails loudly, which is the point.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "react-frontend",
  "src",
  "components",
  "MetaAds",
  "Chatbot",
  "actionSummaries.js",
);

assert.ok(fs.existsSync(SRC), `actionSummaries.js not found at ${SRC}`);
const source = fs.readFileSync(SRC, "utf8").replace(/^export\s+/gm, "");
const sandbox = { console };
vm.createContext(sandbox);
new vm.Script(`${source}\nthis.summarizeAction = summarizeAction;`).runInContext(sandbox);
const { summarizeAction } = sandbox;

const labels = (s) => s.rows.map((r) => r.label);
const valueOf = (s, label) => s.rows.find((r) => r.label === label)?.value;

// ── the official server's single most common write ──────────────────────────
// Every edit — budget, pause, rename, schedule — goes through ads_update_entity,
// whose `fields` payload is a JSON STRING. Unparsed, the card would ask someone
// to approve a wall of escaped JSON.
{
  const s = summarizeAction(
    "ads_update_entity",
    {
      ad_account_id: "act_1",
      entity_id: "120248552251470135",
      entity_type: "campaign",
      fields: JSON.stringify({ daily_budget: 250000, status: "PAUSED", name: "Summer Sale" }),
      client_conversation_id: "noise",
    },
    "INR",
  );

  assert.ok(/^Update campaign 120248552251470135/.test(s.title), s.title);
  assert.strictEqual(valueOf(s, "Daily budget"), "₹2,500.00/day", "money is formatted, not raw minor units");
  assert.strictEqual(valueOf(s, "Status"), "Paused", "enums are humanized");
  assert.strictEqual(valueOf(s, "Name"), "Summer Sale");
  assert.ok(
    !JSON.stringify(s).includes("daily_budget"),
    "no raw field key should survive into the card",
  );
  assert.ok(
    !labels(s).some((l) => /conversation|advertiser request|account id/i.test(l)),
    "model bookkeeping args must not be shown to the approver",
  );
}

// An update naming no fields must still say something honest.
{
  const s = summarizeAction("ads_update_entity", { entity_id: "1", entity_type: "ad" }, "USD");
  assert.ok(s.rows.length >= 1, "an empty change still renders a row rather than a blank card");
}

// ── the same intent from either server renders the same ─────────────────────
{
  const official = summarizeAction(
    "ads_create_campaign",
    {
      ad_account_id: "act_1",
      campaign_name: "Q4 Leads",
      objective: "OUTCOME_LEADS",
      campaign_daily_budget: 100000,
      campaign_bid_strategy: "LOWEST_COST_WITHOUT_CAP",
      special_ad_categories: JSON.stringify(["NONE"]),
    },
    "INR",
  );
  const fork = summarizeAction(
    "ads_create_campaign",
    {
      name: "Q4 Leads",
      objective: "OUTCOME_LEADS",
      daily_budget: 100000,
      bid_strategy: "LOWEST_COST_WITHOUT_CAP",
      special_ad_categories: ["NONE"],
    },
    "INR",
  );

  assert.strictEqual(official.title, 'Create campaign — "Q4 Leads"', "official spellings must not render undefined");
  assert.strictEqual(official.title, fork.title, "both servers describe the same action identically");
  assert.strictEqual(valueOf(official, "Daily budget"), "₹1,000.00/day");
  assert.deepStrictEqual(labels(official), labels(fork), "same rows regardless of which server sent it");
  assert.ok(
    !labels(official).includes("Special ad category"),
    '"NONE" means no special category and must not be shown as one',
  );
}

// ── structured values arrive as JSON strings from the official server ───────
{
  const s = summarizeAction(
    "ads_create_ad_set",
    {
      ad_account_id: "act_1",
      campaign_id: "c1",
      ad_set_name: "Bangalore 25-45",
      daily_budget: 50000,
      optimization_goal: "OFFSITE_CONVERSIONS",
      targeting: JSON.stringify({
        age_min: 25,
        age_max: 45,
        geo_locations: { countries: ["IN"] },
        genders: [1],
      }),
    },
    "INR",
  );
  assert.strictEqual(s.title, 'Create ad set — "Bangalore 25-45"');
  assert.strictEqual(valueOf(s, "Age range"), "25–45", "JSON-string targeting is expanded, not dumped");
  assert.strictEqual(valueOf(s, "Genders"), "Men");
  assert.strictEqual(valueOf(s, "Locations"), "IN");
  assert.ok(!JSON.stringify(s).includes("geo_locations"), "no raw targeting keys in the card");
}

// The official create-ad tool sends a creative SPEC, not a bare id.
{
  const s = summarizeAction(
    "ads_create_ad",
    { ad_account_id: "a", ad_set_id: "s1", ad_name: "Video ad 1", creative: JSON.stringify({ creative_id: "cr1" }) },
    "USD",
  );
  assert.strictEqual(s.title, 'Create ad — "Video ad 1"');
  assert.strictEqual(valueOf(s, "Creative"), "cr1", "the creative id is extracted from the spec");
}

// ── activate ────────────────────────────────────────────────────────────────
{
  const s = summarizeAction(
    "ads_activate_entity",
    { entity_id: "1202", entity_type: "ad_set", ignore_validation_errors: false },
    "USD",
  );
  assert.ok(/Activate/.test(s.title), s.title);
  assert.ok(/1202/.test(s.title), "the entity being activated is named");
  assert.ok(s.rows.length >= 1, "activation states its effect — it starts spending money");
}

// ── unknown tools degrade, never dump ───────────────────────────────────────
{
  const s = summarizeAction(
    "ads_catalog_create_product_set",
    {
      catalog_id: "cat1",
      name: "Shoes",
      filter: JSON.stringify({ retailer_id: { is_any: ["a"] } }),
      client_conversation_id: "noise",
    },
    "USD",
  );
  assert.strictEqual(s.title, "Catalog Create Product Set");
  assert.strictEqual(valueOf(s, "Name"), "Shoes");
  assert.ok(!labels(s).some((l) => /conversation/i.test(l)), "plumbing stays hidden on the generic path too");
}

// A summarizer that throws on unexpected args must fall back, not break the card.
{
  const s = summarizeAction("ads_create_ad_set", null, "USD");
  assert.ok(s && typeof s.title === "string", "null args still produce a card");
}

console.log("metaChat actionSummaries tests passed");
