/**
 * Gateway-side behaviour of the Ads Chat bridge.
 *
 * The gateway couples to the MCP tool catalogue by SHAPE, not by import, so the
 * two drift apart with no compile-time or runtime signal. A 2026-09-07 fork sync
 * (97 → 127 tools) broke four things at once and nothing threw. These tests are
 * the signal that was missing.
 */
const assert = require("assert");

const ENV_KEYS = ["META_MCP_MODE", "META_MCP_OFFICIAL_USER_IDS", "META_MCP_SERVER_URL"];
const saved = {};
for (const k of ENV_KEYS) saved[k] = process.env[k];
for (const k of ENV_KEYS) delete process.env[k];
process.env.META_MCP_SERVER_URL = "http://127.0.0.1:3000/mcp";

const { getProfile, LOCAL, OFFICIAL } = require("../../services/metaChat/mcpMode");
const {
  isReadOnly,
  loadTools,
  resolveCampaignIdForWrite,
  executeCall,
  sendAndProcess,
  MAX_TOOL_ROUNDS,
} = require("../../services/metaChat/geminiMcpBridge");

// A stub MCP client carrying a profile, exactly as createMcpClient stamps it.
function stubClient(profile, tools) {
  return { mcpProfile: profile, listTools: async () => ({ tools }) };
}

const TOOLS = [
  { name: "ads_get_campaigns", description: "d", inputSchema: {}, annotations: { readOnlyHint: true } },
  { name: "ads_create_campaign", description: "d", inputSchema: {}, annotations: { destructiveHint: false } },
  { name: "whatsapp_get_templates", description: "d", inputSchema: {}, annotations: { readOnlyHint: true } },
  { name: "whatsapp_send_message", description: "d", inputSchema: {}, annotations: { destructiveHint: false } },
];

(async () => {
  // ── read/write classification must FAIL CLOSED ────────────────────────────
  // An unannotated tool treated as a read would execute against a live ad
  // account with no confirmation card.
  assert.strictEqual(isReadOnly({ readOnlyHint: true }), true);
  assert.strictEqual(isReadOnly({ readOnlyHint: false }), false);
  assert.strictEqual(isReadOnly({ destructiveHint: true }), false);
  assert.strictEqual(isReadOnly({}), false, "un-annotated tools must be treated as writes");
  assert.strictEqual(isReadOnly(undefined), false, "unknown tools must be treated as writes");

  // ── local mode: whatsapp_* never reaches the model ────────────────────────
  {
    const local = getProfile("u1");
    assert.strictEqual(local.mode, LOCAL);
    const { toolMap, functionDeclarations } = await loadTools(stubClient(local, TOOLS));
    const names = functionDeclarations.map((d) => d.name);

    assert.ok(names.includes("ads_get_campaigns"), "ads_* tools stay declared");
    assert.ok(
      !names.some((n) => n.startsWith("whatsapp_")),
      "whatsapp_* must not be declared while the scope is unapproved",
    );
    assert.ok(
      !toolMap.has("whatsapp_send_message"),
      "a filtered tool must also leave the annotation map, or it could still be classified",
    );
    // The 20 in-process render tools are merged in alongside the MCP catalogue.
    assert.ok(names.includes("show_stat_card"), "local render tools survive");
    assert.ok(names.includes("show_leads_table"), "local mode keeps the leads card");
    assert.strictEqual(new Set(names).size, names.length, "no duplicate declarations");
  }

  // ── official mode: cards with no data source are withheld ─────────────────
  {
    process.env.META_MCP_MODE = "official";
    const official = getProfile("u1");
    assert.strictEqual(official.mode, OFFICIAL);

    const officialTools = [
      { name: "ads_get_ad_entities", description: "d", inputSchema: {}, annotations: { readOnlyHint: true } },
      { name: "ads_update_entity", description: "d", inputSchema: {}, annotations: { destructiveHint: false } },
    ];
    const { toolMap, functionDeclarations } = await loadTools(stubClient(official, officialTools));
    const names = functionDeclarations.map((d) => d.name);

    assert.ok(names.includes("ads_get_ad_entities"));
    for (const t of ["show_leads_table", "show_billing_summary", "show_ad_rules"]) {
      assert.ok(!names.includes(t), `${t} has no data source in official mode`);
      assert.ok(!toolMap.has(t), `${t} must not be classifiable either`);
    }
    assert.ok(names.includes("show_stat_card"), "generic render tools remain");

    // Every declared description must name tools that exist on THIS server.
    // A description still carrying a token, or naming a fork-only tool, would
    // send the model after something absent from its own declarations.
    const FORK_ONLY = [
      "ads_get_insights",
      "ads_get_campaign_details",
      "ads_get_ad_set_details",
      "ads_create_ad_creative",
      "ads_upload_ad_video",
      "ads_get_ad_creatives",
      "ads_get_custom_audiences",
      "ads_get_pixel_details",
      "ads_get_ad_studies",
      "ads_get_leads",
      "ads_get_ad_rules",
      "ads_get_billing_info",
      "ads_get_invoices",
      "ads_diagnose_underperformance",
      "ads_generate_preview",
    ];
    for (const d of functionDeclarations) {
      const desc = d.description || "";
      assert.ok(!desc.includes("{{tool:"), `${d.name} has an unresolved tool token`);
      for (const forkName of FORK_ONLY) {
        assert.ok(
          !desc.includes(forkName),
          `${d.name} names ${forkName}, which the official server does not declare`,
        );
      }
    }
    delete process.env.META_MCP_MODE;
  }

  // Local mode keeps the fork's names — the mapping must not leak the other way.
  {
    const local = getProfile("u1");
    const { functionDeclarations } = await loadTools(stubClient(local, TOOLS));
    const gallery = functionDeclarations.find((d) => d.name === "show_creative_gallery");
    assert.ok(
      gallery.description.includes("ads_get_ad_creatives"),
      "local mode must still name the fork's creative tool",
    );
    const trend = functionDeclarations.find((d) => d.name === "show_trend_chart");
    assert.ok(trend.description.includes("ads_get_insights"), "local keeps ads_get_insights");
    for (const d of functionDeclarations) {
      assert.ok(!(d.description || "").includes("{{tool:"), `${d.name} has an unresolved token`);
    }
  }

  // ── the tool catalogue is cached per endpoint ─────────────────────────────
  // listTools pulls ~583 KB and costs ~1s, and a fresh MCP client is built every
  // turn, so without this every message paid that before the user saw anything.
  {
    process.env.META_MCP_SERVER_URL = "http://cache-probe-1/mcp";
    const profile = getProfile("u1");
    let calls = 0;
    const counting = (tools) => ({
      mcpProfile: profile,
      listTools: async () => {
        calls += 1;
        return { tools };
      },
    });

    await loadTools(counting(TOOLS));
    await loadTools(counting(TOOLS));
    assert.strictEqual(calls, 1, "a second turn against the same endpoint must reuse the catalogue");

    // A different endpoint is a different catalogue — the two modes must never
    // share an entry, or a local user could be handed the official tool list.
    // The official profile ignores META_MCP_SERVER_URL, so give it its own
    // probe URL rather than reusing a key an earlier test already cached.
    process.env.META_MCP_OFFICIAL_URL = "http://cache-probe-2/ads";
    process.env.META_MCP_MODE = "official";
    const officialProfile = getProfile("u1");
    let officialCalls = 0;
    const officialTools = [
      { name: "ads_get_ad_entities", description: "d", inputSchema: {}, annotations: { readOnlyHint: true } },
    ];
    const officialClient = {
      mcpProfile: officialProfile,
      listTools: async () => {
        officialCalls += 1;
        return { tools: officialTools };
      },
    };
    const { functionDeclarations: officialDecls } = await loadTools(officialClient);
    assert.strictEqual(officialCalls, 1, "a different endpoint fetches its own catalogue");
    assert.ok(
      officialDecls.some((d) => d.name === "ads_get_ad_entities"),
      "official mode must get the official catalogue, not a cached local one",
    );
    assert.ok(
      !officialDecls.some((d) => d.name === "ads_get_campaigns"),
      "the local catalogue must not leak into official mode",
    );
    delete process.env.META_MCP_MODE;
    process.env.META_MCP_SERVER_URL = "http://127.0.0.1:3000/mcp";
  }

  // ── plan gate resolves the campaign a write targets ───────────────────────
  {
    const local = getProfile("u1");
    assert.strictEqual(
      await resolveCampaignIdForWrite(local, { campaign_id: "c1" }, "tok"),
      "c1",
      "a direct campaign id needs no lookup",
    );

    process.env.META_MCP_MODE = "official";
    const official = getProfile("u1");
    assert.strictEqual(
      await resolveCampaignIdForWrite(official, { entity_id: "c9", entity_type: "campaign" }, "tok"),
      "c9",
      "official writes carry entity_id + entity_type, never campaign_id",
    );
    delete process.env.META_MCP_MODE;

    // Fail open in every ambiguous case — this is a commercial limit, not a
    // security boundary, and a throw here would break the whole chat turn.
    assert.strictEqual(await resolveCampaignIdForWrite(local, { name: "x" }, "tok"), null);
    assert.strictEqual(await resolveCampaignIdForWrite(local, { ad_set_id: "s1" }, null), null);
    assert.strictEqual(await resolveCampaignIdForWrite(local, {}, "tok"), null);
    assert.strictEqual(await resolveCampaignIdForWrite(local, undefined, "tok"), null);
  }

  // ── a failing tool must not kill the turn ─────────────────────────────────
  // A rejected call (bad parameter, rate limit, timeout) used to throw straight
  // out of the turn, ending the whole exchange with an error banner. Observed
  // live against the official server: "MCP error -32603: Invalid parameter"
  // aborted a question the model then answered fine once handed the error back.
  {
    const local = getProfile("u1");
    const events = [];
    const ctx = {
      userId: "u1",
      onEvent: (type, data) => events.push([type, data]),
      localHandlers: new Map(),
      mcpClient: {
        mcpProfile: local,
        callTool: async () => {
          throw new Error("MCP error -32603: Invalid parameter");
        },
      },
    };

    const part = await executeCall({ id: "1", name: "ads_get_ad_entities", args: {} }, ctx);
    const response = part.functionResponse.response;
    assert.ok(response.error, "a failed call comes back as an error response, not a throw");
    assert.ok(/Invalid parameter/.test(response.error), "the real cause reaches the model");
    assert.ok(
      /do not repeat an identical/i.test(response.error),
      "the model is told not to loop on the same failing call",
    );
    assert.ok(
      events.some(([t, d]) => t === "tool_result" && d.result?.error),
      "the failure is still surfaced in the thinking trace",
    );
  }

  // A successful call is normalised on the way out.
  {
    process.env.META_MCP_MODE = "official";
    const official = getProfile("u1");
    const ctx = {
      userId: "u1",
      onEvent: () => {},
      localHandlers: new Map(),
      mcpClient: {
        mcpProfile: official,
        callTool: async (params, _schema, options) => {
          assert.ok(options && options.timeout > 0, "a per-tool timeout is always passed");
          return {
            content: [
              { type: "text", text: JSON.stringify({ ad_entities: JSON.stringify([{ name: "C1" }]) }) },
            ],
          };
        },
      },
    };
    const part = await executeCall({ id: "2", name: "ads_get_ad_entities", args: {} }, ctx);
    const text = part.functionResponse.response.result.content[0].text;
    assert.ok(
      Array.isArray(JSON.parse(text).ad_entities),
      "official results are unwrapped before the model sees them",
    );
    delete process.env.META_MCP_MODE;
  }

  // ── creative images reach the model, but never the session ────────────────
  // ads_get_creative_media returns base64 images. They must arrive as Gemini
  // inlineData parts (which the model can see) on the LIVE message only — the
  // function-response parts are persisted onto the session when a turn pauses,
  // and base64 there pushes the Mongo document toward its 16MB ceiling.
  {
    const local = getProfile("u1");
    const sent = [];
    let asked = false;
    const chat = {
      sendMessageStream: async (req) => {
        sent.push(req.message);
        const first = !asked;
        asked = true;
        return (async function* () {
          if (first) {
            yield { functionCalls: [{ id: "img", name: "ads_get_creative_media", args: {} }] };
          } else {
            yield { text: "That creative shows a red banner." };
          }
        })();
      },
      getHistory: () => [],
    };
    const ctx = {
      userId: "u1",
      onEvent: () => {},
      localHandlers: new Map(),
      mcpClient: {
        mcpProfile: local,
        callTool: async () => ({
          content: [
            { type: "text", text: "1 image" },
            { type: "image", data: "QUJDREVG", mimeType: "image/png" },
          ],
        }),
      },
    };
    const toolMap = new Map([["ads_get_creative_media", { readOnlyHint: true }]]);

    const outcome = await sendAndProcess({ chat, toolMap, message: "show me the creative", ctx });
    assert.strictEqual(outcome.status, "done");

    const followUp = sent[1];
    assert.ok(Array.isArray(followUp), "the tool responses go back as a parts array");
    const inline = followUp.filter((p) => p.inlineData);
    assert.strictEqual(inline.length, 1, "the image is attached as a real inlineData part");
    assert.strictEqual(inline[0].inlineData.mimeType, "image/png");

    const responseParts = followUp.filter((p) => p.functionResponse);
    assert.ok(
      !JSON.stringify(responseParts).includes("QUJDREVG"),
      "base64 must NOT be in the function-response parts — those get persisted",
    );
    assert.ok(
      JSON.stringify(responseParts).includes("attached to this message"),
      "the response tells the model an image is attached",
    );
    assert.strictEqual(ctx.imageParts, null, "the transient image channel is cleared after the batch");
  }

  // ── the tool loop is bounded ──────────────────────────────────────────────
  // Without a cap, a model that keeps retrying a failing call spins until the
  // request times out, billing every round.
  assert.ok(MAX_TOOL_ROUNDS > 0 && MAX_TOOL_ROUNDS <= 25, "round cap is set and sane");
  {
    const local = getProfile("u1");
    let rounds = 0;
    // A chat that never stops asking for the same tool.
    const chat = {
      sendMessageStream: async () => {
        rounds += 1;
        return (async function* () {
          yield { functionCalls: [{ id: String(rounds), name: "ads_get_campaigns", args: {} }] };
        })();
      },
      getHistory: () => [],
    };
    const ctx = {
      userId: "u1",
      onEvent: () => {},
      localHandlers: new Map(),
      mcpClient: {
        mcpProfile: local,
        callTool: async () => ({ content: [{ type: "text", text: "{}" }] }),
      },
    };
    const toolMap = new Map([["ads_get_campaigns", { readOnlyHint: true }]]);

    const outcome = await sendAndProcess({ chat, toolMap, message: "loop forever", ctx });
    assert.strictEqual(outcome.status, "done", "the turn ends rather than spinning");
    assert.ok(outcome.text, "the user gets a reply, not an empty response");
    assert.ok(
      rounds <= MAX_TOOL_ROUNDS + 1,
      `the loop stopped after ${rounds} rounds (cap ${MAX_TOOL_ROUNDS})`,
    );
  }

  for (const k of ENV_KEYS) {
    delete process.env[k];
    if (saved[k] !== undefined) process.env[k] = saved[k];
  }
  console.log("metaChat bridge tests passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
