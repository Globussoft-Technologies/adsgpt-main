/**
 * Ads Chat MCP mode switch.
 *
 * Every assertion here guards something that fails SILENTLY if it regresses —
 * no exception, no error response, just wrong behaviour:
 *   - a typo in META_MCP_MODE quietly migrating users to another backend
 *   - the plan gate reading argument names the active server never sends, so a
 *     billing limit stops enforcing
 *   - a 60s client timeout abandoning a call the server is still executing
 *   - base64 or double-encoded payloads reaching the model unreadable
 */
const assert = require("assert");

const {
  LOCAL,
  OFFICIAL,
  DEFAULT_TOOL_TIMEOUT_MS,
  resolveMode,
  getProfile,
  splitImageBlocks,
  unwrapEncodedJson,
  localTargetFromArgs,
  officialTargetFromArgs,
  renderToolRefs,
} = require("../../services/metaChat/mcpMode");

const ENV_KEYS = [
  "META_MCP_MODE",
  "META_MCP_OFFICIAL_USER_IDS",
  "META_MCP_SERVER_URL",
  "META_MCP_OFFICIAL_URL",
  "META_MCP_API_KEY",];
const saved = {};
for (const k of ENV_KEYS) saved[k] = process.env[k];
function resetEnv() {
  for (const k of ENV_KEYS) delete process.env[k];
}

// ── mode resolution: unknown values must be INERT ───────────────────────────
resetEnv();
assert.strictEqual(resolveMode("u1"), LOCAL, "absent META_MCP_MODE defaults to local");

process.env.META_MCP_MODE = "official";
assert.strictEqual(resolveMode("u1"), OFFICIAL);

for (const bad of ["Official", "OFFICIAL", "offical", "true", "1", "yes", ""]) {
  process.env.META_MCP_MODE = bad;
  assert.strictEqual(
    resolveMode("u1"),
    LOCAL,
    `"${bad}" must resolve to local — a typo must never silently migrate every user`,
  );
}

// ── canary allowlist ────────────────────────────────────────────────────────
resetEnv();
process.env.META_MCP_MODE = "local";
process.env.META_MCP_OFFICIAL_USER_IDS = "GPT-435, GPT-112 ,";
assert.strictEqual(resolveMode("GPT-435"), OFFICIAL, "allowlisted user gets official");
assert.strictEqual(resolveMode("GPT-112"), OFFICIAL, "whitespace around ids is trimmed");
assert.strictEqual(resolveMode("GPT-999"), LOCAL, "everyone else stays on local");
assert.strictEqual(resolveMode(undefined), LOCAL, "a missing userId never matches the allowlist");
assert.strictEqual(resolveMode(""), LOCAL, "an empty userId never matches the allowlist");

// ── endpoints + auth headers ────────────────────────────────────────────────
resetEnv();
process.env.META_MCP_SERVER_URL = "http://127.0.0.1:3000/mcp";
process.env.META_MCP_API_KEY = "svc-secret";
{
  const local = getProfile("u1");
  assert.strictEqual(local.mode, LOCAL);
  assert.strictEqual(local.url(), "http://127.0.0.1:3000/mcp");
  const h = local.headers("TOKEN123");
  assert.strictEqual(h["X-Meta-Token"], "TOKEN123");
  assert.strictEqual(h["X-API-Key"], "svc-secret");
  assert.ok(!h.Authorization, "local mode must not send a bearer header");

  delete process.env.META_MCP_API_KEY;
  assert.ok(
    !("X-API-Key" in getProfile("u1").headers("T")),
    "no API key configured means the header is omitted, not sent empty",
  );
}

process.env.META_MCP_MODE = "official";
{
  const official = getProfile("u1");
  assert.strictEqual(official.mode, OFFICIAL);
  assert.strictEqual(
    official.url(),
    "https://mcp.facebook.com/ads",
    "official URL has a default so it works without extra config",
  );
  process.env.META_MCP_OFFICIAL_URL = "https://example.test/ads";
  assert.strictEqual(getProfile("u1").url(), "https://example.test/ads", "override honoured");

  const h = official.headers("TOKEN123");
  assert.strictEqual(h.Authorization, "Bearer TOKEN123");
  assert.ok(!h["X-Meta-Token"], "official mode must not send the fork's token header");
  assert.ok(!h["X-API-Key"], "the service key is meaningless to Meta");
}

// ── tool filtering ──────────────────────────────────────────────────────────
resetEnv();
process.env.META_MCP_SERVER_URL = "http://x/mcp";
{
  const local = getProfile("u1");
  // The fork's whatsapp_* tools need a scope our OAuth never requests: they can
  // only ever error. Filtered unconditionally — no env flag turns them back on,
  // because no configuration makes them work, only an App Review approval.
  assert.strictEqual(local.includeTool("whatsapp_get_templates"), false);
  assert.strictEqual(local.includeTool("whatsapp_send_message"), false);
  assert.strictEqual(local.includeTool("ads_get_campaigns"), true);
  assert.strictEqual(local.includeTool("ads_whatsapp_something"), true, "only the prefix is filtered");

  assert.strictEqual(local.disabledLocalTools.size, 0, "local keeps every render tool");
}

process.env.META_MCP_MODE = "official";
{
  const official = getProfile("u1");
  assert.strictEqual(official.includeTool("ads_get_ad_entities"), true);
  // Render tools with no data source on the official server.
  for (const t of ["show_leads_table", "show_billing_summary", "show_ad_rules"]) {
    assert.ok(official.disabledLocalTools.has(t), `${t} must be withheld in official mode`);
  }
  assert.ok(!official.disabledLocalTools.has("show_stat_card"), "generic cards stay");
}

// ── timeouts ────────────────────────────────────────────────────────────────
resetEnv();
process.env.META_MCP_SERVER_URL = "http://x/mcp";
{
  const local = getProfile("u1");
  // Budgets 180s and waits up to 120s per video; at the SDK's 60s default the
  // client abandons a call that is still creating ads, and a retry duplicates them.
  assert.ok(
    local.timeoutFor("ads_bulk_create_video_ads") > 180_000,
    "bulk video ads must outlast its own 180s batch budget",
  );
  assert.ok(local.timeoutFor("ads_get_creative_media") > DEFAULT_TOOL_TIMEOUT_MS);
  assert.strictEqual(
    local.timeoutFor("ads_get_campaigns"),
    DEFAULT_TOOL_TIMEOUT_MS,
    "ordinary tools keep 60s — a hung read must not stall the turn for minutes",
  );
}

// ── result normalisation ────────────────────────────────────────────────────
// local: base64 must never reach Gemini (unreadable as text, ~170k tokens for a
// single 500KB creative) nor the session document (16MB Mongo ceiling).
{
  const result = {
    content: [
      { type: "text", text: "summary" },
      { type: "image", data: "QUJDREVG", mimeType: "image/png" },
      { type: "text", text: "{\"meta\":1}" },
    ],
  };
  const { result: out, imageParts } = splitImageBlocks(result);
  assert.ok(!JSON.stringify(out).includes("QUJDREVG"), "base64 must not survive into the result body");
  assert.strictEqual(out.content.length, 3, "a marker replaces the image, keeping block count");
  assert.ok(/image 1/.test(out.content[1].text), "the model is told an image is attached");
  assert.strictEqual(out.content[0].text, "summary", "other blocks pass through untouched");

  // The image travels as a real Gemini part, which the model CAN see — this is
  // the whole point of ads_get_creative_media.
  assert.strictEqual(imageParts.length, 1);
  assert.deepStrictEqual(imageParts[0], {
    inlineData: { mimeType: "image/png", data: "QUJDREVG" },
  });

  // Nothing to do, nothing changed — cheap identity for the common case.
  const plain = { content: [{ type: "text", text: "hi" }] };
  assert.strictEqual(splitImageBlocks(plain).result, plain, "image-free results are returned as-is");
  assert.strictEqual(splitImageBlocks(plain).imageParts.length, 0);
  const notMcp = { rows: [1, 2] };
  assert.strictEqual(splitImageBlocks(notMcp).result, notMcp);
  assert.strictEqual(splitImageBlocks(undefined).result, undefined);

  // Budget guard: a result full of images cannot blow one Gemini request.
  const many = {
    content: Array.from({ length: 9 }, () => ({ type: "image", data: "QUJD", mimeType: "image/jpeg" })),
  };
  const big = splitImageBlocks(many);
  assert.ok(big.imageParts.length <= 5, "at most 5 images are inlined per message");
  assert.strictEqual(big.result.content.length, 9, "every image still leaves a text marker");
  assert.ok(big.result.content.some((b) => /omitted/.test(b.text)), "dropped images are declared");
}

// official: payloads arrive as a JSON STRING nested in a text block. Left raw the
// model re-queries instead of answering (observed: 4 redundant turns).
{
  const result = {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          ad_entities: JSON.stringify([{ name: "adsgpt_lead_campaign", amount_spent: "₹4,184.38" }]),
        }),
      },
    ],
  };
  const { result: out, imageParts: noImages } = unwrapEncodedJson(result);
  assert.strictEqual(noImages.length, 0, "the official server never returns inline images");
  const parsed = JSON.parse(out.content[0].text);
  assert.ok(Array.isArray(parsed.ad_entities), "the nested JSON string is parsed into an array");
  assert.strictEqual(parsed.ad_entities[0].name, "adsgpt_lead_campaign");
  assert.strictEqual(parsed.ad_entities[0].amount_spent, "₹4,184.38", "currency preserved verbatim");

  // Plain prose and ordinary string fields must be left alone.
  const prose = { content: [{ type: "text", text: "3 campaigns found." }] };
  assert.strictEqual(unwrapEncodedJson(prose).result, prose, "non-JSON text is untouched");
  const scalar = { content: [{ type: "text", text: JSON.stringify({ name: "Traffic 2.0" }) }] };
  assert.strictEqual(
    JSON.parse(unwrapEncodedJson(scalar).result.content[0].text).name,
    "Traffic 2.0",
    "a plain string field must not be mangled",
  );
  assert.strictEqual(unwrapEncodedJson({ rows: [] }).result.rows.length, 0);
}

// ── plan-gate target extraction ─────────────────────────────────────────────
// The fork names objects directly.
{
  assert.strictEqual(localTargetFromArgs({ campaign_id: "c1" }).campaignId, "c1");
  assert.strictEqual(localTargetFromArgs({ campaignId: "c2" }).campaignId, "c2");
  assert.strictEqual(localTargetFromArgs({ ad_set_id: "s1" }).adSetId, "s1");
  assert.strictEqual(localTargetFromArgs({ adset_id: "s2" }).adSetId, "s2");
  assert.strictEqual(localTargetFromArgs({ ad_id: "a1" }).adId, "a1");
  const none = localTargetFromArgs({ name: "x" });
  assert.ok(!none.campaignId && !none.adSetId && !none.adId);
}

// The official server has NO campaign_id argument anywhere in its 97 tools —
// it carries entity_id + entity_type. Reading the fork's keys here would match
// nothing and silently stop enforcing the managed-campaign limit.
{
  const camp = officialTargetFromArgs({ entity_id: "c1", entity_type: "campaign" });
  assert.strictEqual(camp.campaignId, "c1");

  for (const t of ["ad_set", "adset"]) {
    const adset = officialTargetFromArgs({ entity_id: "s1", entity_type: t });
    assert.strictEqual(adset.adSetId, "s1", `entity_type "${t}" resolves to an ad set`);
    assert.strictEqual(adset.campaignId, null, "an ad set is not its own campaign");
  }

  const ad = officialTargetFromArgs({ entity_id: "a1", entity_type: "ad" });
  assert.strictEqual(ad.adId, "a1");

  // ads_create_ad / ads_create_ad_set name the PARENT rather than an entity.
  assert.strictEqual(officialTargetFromArgs({ ad_set_id: "s9" }).adSetId, "s9");
  assert.strictEqual(officialTargetFromArgs({ campaign_id: "c9" }).campaignId, "c9");

  // An account-scoped read names no entity at all.
  const acct = officialTargetFromArgs({ ad_account_id: "act_1" });
  assert.ok(!acct.campaignId && !acct.adSetId && !acct.adId);
}

// ── tool aliases ────────────────────────────────────────────────────────────
// The prompt and render-tool descriptions name MCP tools directly. Naming a tool
// the active server does not declare burns a turn on a call that cannot resolve.
resetEnv();
process.env.META_MCP_SERVER_URL = "http://x/mcp";
{
  const local = getProfile("u1");
  process.env.META_MCP_MODE = "official";
  const official = getProfile("u1");

  assert.strictEqual(local.tool("insights"), "ads_get_insights");
  assert.strictEqual(
    official.tool("insights"),
    "ads_get_ad_entities",
    "the official server folds insights into its generic entity reader",
  );
  // Three fork readers, one official tool.
  for (const key of ["insights", "campaignDetails", "adSetDetails"]) {
    assert.strictEqual(official.tool(key), "ads_get_ad_entities", key);
  }
  assert.strictEqual(local.tool("createCreative"), "ads_create_ad_creative");
  assert.strictEqual(official.tool("createCreative"), "ads_create_creative");
  assert.strictEqual(official.tool("adCreatives"), "ads_get_creatives");
  assert.strictEqual(official.tool("adStudies"), "ads_experiment_list_tests");
  assert.strictEqual(official.tool("pixelDetails"), "ads_get_dataset_details");
  // Same name on both — must not be accidentally remapped.
  assert.strictEqual(local.tool("adImages"), official.tool("adImages"));
  assert.strictEqual(local.tool("errors"), official.tool("errors"));

  // Capabilities the official server simply does not have.
  for (const key of ["leads", "adRules", "billingInfo", "invoices", "diagnose"]) {
    assert.strictEqual(official.tool(key), null, `official has no ${key}`);
    assert.ok(local.tool(key), `local still has ${key}`);
  }
  assert.strictEqual(local.tool("nonsenseKey"), null, "unknown keys resolve to null, not undefined");
  delete process.env.META_MCP_MODE;
}

// ── description rendering ───────────────────────────────────────────────────
{
  const local = getProfile("u1");
  process.env.META_MCP_MODE = "official";
  const official = getProfile("u1");

  const list = "figures from {{tool:campaignDetails}}, {{tool:adSetDetails}}, or {{tool:insights}}.";
  assert.strictEqual(
    renderToolRefs(list, local),
    "figures from ads_get_campaign_details, ads_get_ad_set_details, or ads_get_insights.",
  );
  assert.strictEqual(
    renderToolRefs(list, official),
    "figures from ads_get_ad_entities.",
    "three names collapsing to one must not read \"X, X, or X\"",
  );

  // A dropped tool takes its connector with it — no dangling "or".
  const pair = "from {{tool:errors}} or {{tool:diagnose}}.";
  assert.strictEqual(renderToolRefs(pair, local), "from ads_get_errors or ads_diagnose_underperformance.");
  assert.strictEqual(renderToolRefs(pair, official), "from ads_get_errors.");

  const slash = "URLs from {{tool:adImages}} / {{tool:adVideos}} / {{tool:adCreatives}}.";
  assert.strictEqual(
    renderToolRefs(slash, official),
    "URLs from ads_get_ad_images / ads_get_ad_videos / ads_get_creatives.",
    "distinct names must survive the duplicate-collapsing pass",
  );

  // Untokenised text is returned untouched and cheaply.
  const plain = "Render a table of leads.";
  assert.strictEqual(renderToolRefs(plain, official), plain);
  assert.strictEqual(renderToolRefs(undefined, official), undefined);
  delete process.env.META_MCP_MODE;
}

// ── restore ─────────────────────────────────────────────────────────────────
resetEnv();
for (const k of ENV_KEYS) if (saved[k] !== undefined) process.env[k] = saved[k];

console.log("metaChat mcpMode tests passed");
