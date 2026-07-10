/**
 * Local tools — backend-defined tools the chat model can call ALONGSIDE the
 * Meta MCP tools. Unlike MCP tools (which hit the Meta Graph API), these run
 * in-process: the "render" tools emit a `card` event over SSE so the frontend
 * draws a rich block (stat grid, bar breakdown, comparison table, action
 * chips) instead of the model describing it in prose.
 *
 * They are declared to Gemini as ordinary functionDeclarations and executed
 * by the gateway loop (geminiMcpBridge). Each handler receives (args, ctx)
 * where ctx = { onEvent, userId, adAccountId, accessToken } and returns a
 * small ack object that becomes the tool's function-response, so the model
 * continues on to a short natural-language summary.
 *
 * All render tools are auto-exec (no confirmation) — they have no external
 * side effects. Phase 2 adds `run_ai_audit` here.
 */

// ── Gemini function declarations ────────────────────────────────────────────
const LOCAL_TOOL_DECLARATIONS = [
  {
    name: "show_stat_card",
    description:
      "Render a titled card with a grid of key metrics (e.g. a campaign's SPEND, CTR, CPC, LEADS). " +
      "Use this to highlight one entity's headline numbers instead of listing them in prose. " +
      "Pass the EXACT values returned by the read tools — do not round, estimate, or invent numbers.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Card title, e.g. the campaign name" },
        subtitle: { type: "string", description: "Optional secondary line, e.g. an ID or date range" },
        badge: {
          type: "string",
          description:
            "Optional highlight label that turns the card into a glowing hero card — use for a " +
            "clear standout, e.g. 'TOP PERFORMER' or 'BEST VALUE'. Omit for a normal stat card.",
        },
        stats: {
          type: "array",
          description: "The metric tiles, in display order.",
          items: {
            type: "object",
            properties: {
              label: { type: "string", description: "Metric label, e.g. 'SPEND' or 'CTR'" },
              value: { type: "string", description: "Display-ready value, e.g. '$10,718' or '5.70%'" },
              delta: {
                type: "number",
                description: "Optional period-over-period % change; positive = up. Omit if unknown.",
              },
              tone: {
                type: "string",
                enum: ["good", "bad"],
                description:
                  "Optional: 'good' colors the value green, 'bad' red — use when a value is clearly " +
                  "favorable/unfavorable (e.g. a strong CTR = good). Omit for neutral.",
              },
            },
            required: ["label", "value"],
          },
        },
      },
      required: ["title", "stats"],
    },
  },
  {
    name: "show_bar_breakdown",
    description:
      "Render a horizontal bar breakdown showing how a total splits across items (e.g. share of spend " +
      "across campaigns). Use exact numeric values from the read tools.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "e.g. 'Share of spend'" },
        unit: { type: "string", description: "Optional unit shown near values, e.g. '₹' or '%'" },
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              label: { type: "string" },
              value: { type: "number", description: "Numeric magnitude used for the bar width" },
              valueLabel: { type: "string", description: "Optional display string, e.g. '$10,718'" },
            },
            required: ["label", "value"],
          },
        },
      },
      required: ["title", "items"],
    },
  },
  {
    name: "show_comparison",
    description:
      "Render a comparison table across several entities (e.g. campaigns vs SPEND/CTR). Optionally " +
      "highlight the winning row. Use exact values from the read tools.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        columns: {
          type: "array",
          items: { type: "string" },
          description: "Column headers; first column is the row label (e.g. 'Campaign').",
        },
        rows: {
          type: "array",
          items: { type: "array", items: { type: "string" } },
          description: "Each row is an array of cell strings matching `columns` order.",
        },
        highlightIndex: {
          type: "number",
          description: "Optional 0-based index of the row to emphasize (the winner).",
        },
      },
      required: ["columns", "rows"],
    },
  },
  {
    name: "suggest_actions",
    description:
      "Offer the user a few one-tap follow-up actions as chips. Each chip, when tapped, sends its " +
      "`prompt` as the user's next message. Use for natural next steps like 'Compare campaigns' or " +
      "'Pause the underperformers'. Keep to 2-4 concise chips.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        actions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              label: { type: "string", description: "Short chip label the user sees" },
              prompt: { type: "string", description: "The message sent when the chip is tapped" },
            },
            required: ["label", "prompt"],
          },
        },
      },
      required: ["actions"],
    },
  },
  {
    name: "show_findings",
    description:
      "Render an audit result: a list of findings/issues you discovered, each with a severity and " +
      "a short explanation. Optionally attach a one-tap action chip per finding whose `actionPrompt` " +
      "you'll receive as the next user message (e.g. 'Pause campaign 123456') — DO NOT apply the fix " +
      "yourself here; the actual change happens only when the user taps the chip and you then call the " +
      "appropriate Meta write tool (which asks the user to confirm). Base every finding on data you " +
      "actually read from the Meta tools; never invent issues or numbers.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Optional heading, e.g. 'Account audit — last 30 days'" },
        findings: {
          type: "array",
          items: {
            type: "object",
            properties: {
              severity: {
                type: "string",
                enum: ["high", "medium", "low"],
                description: "How urgent/impactful the issue is",
              },
              title: { type: "string", description: "Short issue title" },
              detail: { type: "string", description: "1-2 sentences: what's wrong and why it matters" },
              actionLabel: { type: "string", description: "Optional chip label, e.g. 'Pause it'" },
              actionPrompt: {
                type: "string",
                description:
                  "Optional message sent when the chip is tapped, e.g. 'Pause ad set 987'. The fix is " +
                  "only carried out after you then call the Meta write tool and the user confirms.",
              },
            },
            required: ["severity", "title", "detail"],
          },
        },
      },
      required: ["findings"],
    },
  },
  {
    name: "show_ad_preview",
    description:
      "Render an ad preview embedded directly in the chat. Use this whenever you call " +
      "ads_get_ad_preview or ads_generate_preview and the result contains a 'Preview URL:' — " +
      "extract that URL and pass it here so the user sees the actual ad mockup instead of a bare " +
      "link. ALWAYS call this after generating a preview; never just paste the preview URL as " +
      "markdown text.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        previewUrl: {
          type: "string",
          description: "The exact 'Preview URL:' value from the read tool's result — do not modify it.",
        },
        title: { type: "string", description: "Optional label, e.g. the ad name" },
        format: { type: "string", description: "Optional placement format, e.g. 'MOBILE_FEED_STANDARD'" },
      },
      required: ["previewUrl"],
    },
  },
];

// ── Handlers ────────────────────────────────────────────────────────────────
// Each emits a `card` event and returns an ack. The ack tells the model the
// card is now on screen so it can write a brief summary rather than repeating
// the numbers.
const localHandlers = new Map([
  [
    "show_stat_card",
    async (args, ctx) => {
      ctx.onEvent("card", { kind: "stat", ...args });
      return { rendered: true, note: "Stat card shown to the user." };
    },
  ],
  [
    "show_bar_breakdown",
    async (args, ctx) => {
      ctx.onEvent("card", { kind: "bars", ...args });
      return { rendered: true, note: "Bar breakdown shown to the user." };
    },
  ],
  [
    "show_comparison",
    async (args, ctx) => {
      ctx.onEvent("card", { kind: "comparison", ...args });
      return { rendered: true, note: "Comparison table shown to the user." };
    },
  ],
  [
    "suggest_actions",
    async (args, ctx) => {
      ctx.onEvent("card", { kind: "actions", ...args });
      return { rendered: true, note: "Action chips shown to the user." };
    },
  ],
  [
    "show_findings",
    async (args, ctx) => {
      ctx.onEvent("card", { kind: "findings", ...args });
      return { rendered: true, note: "Findings shown to the user." };
    },
  ],
  [
    "show_ad_preview",
    async (args, ctx) => {
      ctx.onEvent("card", { kind: "ad_preview", ...args });
      return { rendered: true, note: "Ad preview embedded and shown to the user." };
    },
  ],
]);

// Synthetic annotations so the gateway classifies these as auto-exec reads
// (readOnlyHint:true = never gated by the write-confirmation flow).
const LOCAL_TOOL_ANNOTATIONS = new Map(
  LOCAL_TOOL_DECLARATIONS.map((d) => [d.name, { readOnlyHint: true }])
);

module.exports = { LOCAL_TOOL_DECLARATIONS, localHandlers, LOCAL_TOOL_ANNOTATIONS };
