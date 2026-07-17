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
              trend: {
                type: "array",
                items: { type: "number" },
                description:
                  "Optional recent history for a tiny inline sparkline, oldest first (e.g. last 7 " +
                  "days of this metric). Omit if you only have the current value.",
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
  {
    name: "show_trend_chart",
    description:
      "Render a line/area chart of one or more metrics over time. Use this for 'how has spend/CTR/" +
      "clicks trended' questions — call ads_get_insights with time_increment (e.g. 1 for daily) to " +
      "get the series, then pass the exact per-day values here. This is the ONLY tool for genuinely " +
      "time-series data; show_bar_breakdown/show_comparison are for a single snapshot across entities.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        unit: { type: "string", description: "Optional unit shown in the tooltip, e.g. '₹' or '%'" },
        series: {
          type: "array",
          description: "One or more named lines, e.g. 'Spend' and 'Clicks'.",
          items: {
            type: "object",
            properties: {
              label: { type: "string", description: "Line name, e.g. 'Spend'" },
              points: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    date: { type: "string", description: "e.g. '2026-07-01' or a short label" },
                    value: { type: "number" },
                  },
                  required: ["date", "value"],
                },
              },
            },
            required: ["label", "points"],
          },
        },
      },
      required: ["title", "series"],
    },
  },
  {
    name: "show_audience_breakdown",
    description:
      "Render a donut chart showing how a total splits by a demographic/placement dimension (age, " +
      "gender, device, platform, region). Call ads_get_insights with the relevant `breakdowns` value " +
      "first, then pass the exact returned shares here. For a ranked list across entities (e.g. " +
      "campaigns) use show_bar_breakdown instead — this is specifically for one entity's composition.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "e.g. 'Audience by age' or 'Spend by placement'" },
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              label: { type: "string" },
              value: { type: "number", description: "Numeric magnitude used for the slice size" },
              valueLabel: { type: "string", description: "Optional display string, e.g. '42%'" },
            },
            required: ["label", "value"],
          },
        },
      },
      required: ["title", "items"],
    },
  },
  {
    name: "show_budget_pacing",
    description:
      "Render a budget pacing meter — spend so far vs. the budget for a campaign/ad set. Use exact " +
      "spend/budget figures from ads_get_campaign_details, ads_get_ad_set_details, or ads_get_insights.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "e.g. the campaign/ad set name" },
        period: { type: "string", description: "e.g. 'Daily budget' or 'Lifetime budget'" },
        spent: { type: "number", description: "Amount spent so far, in the account's currency" },
        budget: { type: "number", description: "The budget amount, in the account's currency" },
        unit: { type: "string", description: "Currency symbol, e.g. '₹'" },
      },
      required: ["title", "spent", "budget"],
    },
  },
  {
    name: "show_leads_table",
    description:
      "Render a table of captured leads. Use exact field values returned by ads_get_leads — never " +
      "invent a lead's contact details.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "e.g. the lead form or campaign name" },
        leads: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              email: { type: "string" },
              phone: { type: "string" },
              submittedAt: { type: "string", description: "e.g. '2026-07-08' or a datetime string" },
              source: { type: "string", description: "Optional: which ad/campaign this lead came from" },
            },
          },
        },
      },
      required: ["leads"],
    },
  },
  {
    name: "show_audiences_list",
    description:
      "Render a list of custom/lookalike audiences with their type and size. Use exact data from " +
      "ads_get_custom_audiences (its results include lookalikes, website, customer-list, and " +
      "engagement audiences distinguished by subtype).",
    parametersJsonSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        audiences: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              type: { type: "string", description: "e.g. 'Lookalike', 'Website', 'Customer list'" },
              size: { type: "number", description: "Approximate audience size, if known" },
              status: { type: "string", description: "e.g. 'Ready', 'Populating'" },
            },
            required: ["name", "type"],
          },
        },
      },
      required: ["audiences"],
    },
  },
  {
    name: "show_creative_gallery",
    description:
      "Render a grid of ad creative thumbnails (images and/or videos). Use exact URLs from " +
      "ads_get_ad_images, ads_get_ad_videos, or ads_get_ad_creatives — never invent a thumbnail URL.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              thumbnailUrl: { type: "string", description: "Image URL, or video thumbnail/poster URL" },
              type: { type: "string", enum: ["image", "video"] },
            },
            required: ["thumbnailUrl", "type"],
          },
        },
      },
      required: ["items"],
    },
  },
  {
    name: "show_opportunity_score",
    description:
      "Render Meta's Opportunity Score (0-100 account/campaign health signal) as a gauge, with any " +
      "recommendations. Use the exact score and recommendations from ads_get_opportunity_score.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "e.g. the account or campaign name" },
        score: { type: "number", description: "0-100" },
        recommendations: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              detail: { type: "string" },
            },
            required: ["title"],
          },
        },
      },
      required: ["score"],
    },
  },
  {
    name: "show_pixel_health",
    description:
      "Render a pixel/dataset health summary — last fired time, match rate, status. Use exact data " +
      "from ads_get_dataset_quality (and ads_get_pixel_details for the pixel's name/id).",
    parametersJsonSchema: {
      type: "object",
      properties: {
        pixelName: { type: "string" },
        lastFiredAt: { type: "string" },
        matchRate: { type: "string", description: "e.g. '87%'" },
        status: { type: "string", enum: ["good", "warning", "bad"] },
        notes: { type: "string", description: "Optional 1-line note, e.g. what's misconfigured" },
      },
      required: ["status"],
    },
  },
  {
    name: "show_diagnostics",
    description:
      "Render a technical issues list — rejected ads, delivery issues, account restrictions, error " +
      "codes. Use exact data from ads_get_errors or ads_diagnose_underperformance. This is more " +
      "technical than show_findings (which is for audit narrative + one-tap fixes) — use this when " +
      "the user wants the raw error/issue list itself.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        issues: {
          type: "array",
          items: {
            type: "object",
            properties: {
              code: { type: "string", description: "Error code, if any" },
              subcode: { type: "string", description: "Error subcode, if any" },
              message: { type: "string" },
              entity: { type: "string", description: "Which campaign/ad set/ad this affects" },
            },
            required: ["message"],
          },
        },
      },
      required: ["issues"],
    },
  },
  {
    name: "show_ad_rules",
    description:
      "Render a list of an account's automated rules (condition → action). Use exact data from " +
      "ads_get_ad_rules.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        rules: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              condition: { type: "string", description: "e.g. 'CPC > ₹50 for 3 days'" },
              action: { type: "string", description: "e.g. 'Pause ad set'" },
              status: { type: "string", description: "e.g. 'Enabled', 'Disabled'" },
            },
            required: ["name", "condition", "action"],
          },
        },
      },
      required: ["rules"],
    },
  },
  {
    name: "show_ab_test_results",
    description:
      "Render A/B test (split test) results comparing variants on one metric, with the winner " +
      "highlighted. Use exact data from ads_get_ad_studies.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        metricLabel: { type: "string", description: "e.g. 'Cost per result'" },
        confidence: { type: "string", description: "Optional, e.g. '95% confidence'" },
        variants: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              value: { type: "string", description: "Display-ready value for metricLabel" },
              isWinner: { type: "boolean" },
            },
            required: ["name", "value"],
          },
        },
      },
      required: ["variants"],
    },
  },
  {
    name: "show_billing_summary",
    description:
      "Render account billing/payment info — funding source, amount due, next bill date. Use exact " +
      "data from ads_get_billing_info / ads_get_invoices.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        paymentMethod: { type: "string" },
        amountDue: { type: "string", description: "Display-ready, e.g. '₹4,582.00'" },
        nextBillDate: { type: "string" },
        accountStatus: { type: "string" },
      },
    },
  },
  {
    name: "show_activity_timeline",
    description:
      "Render a vertical timeline of recent account changes/events. Only use this when you can " +
      "actually attribute a sequence of real events (e.g. from tool results you've read this " +
      "conversation, or a tool that returns an activity/change log) — never fabricate a timeline.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        events: {
          type: "array",
          items: {
            type: "object",
            properties: {
              time: { type: "string" },
              actor: { type: "string", description: "Optional, e.g. who/what made the change" },
              description: { type: "string" },
            },
            required: ["time", "description"],
          },
        },
      },
      required: ["events"],
    },
  },
  {
    // Input-required tool (NOT a render tool): it has no handler and is not
    // auto-executed. The gateway intercepts it by name (see INPUT_REQUIRED_TOOLS
    // + geminiMcpBridge.sendAndProcess) and pauses the turn so the user can pick
    // or upload creative media in-chat; the chosen media's public URL comes back
    // as this call's function-response.
    name: "pick_creative_media",
    description:
      "Open an in-chat picker for the user to choose the image or video for an ad creative — they " +
      "select from their media library or upload a file. Call this when you need creative media to " +
      "build an ad and the user has NOT already given you a usable media URL earlier in the " +
      "conversation. Do NOT ask the user to paste a media URL in text — call this instead. After " +
      "they pick, you receive the media's public URL as this tool's result; use that EXACT URL to " +
      "build the creative (for an image: pass it as image_url to ads_create_ad_creative; for a " +
      "video: first call ads_upload_ad_video with file_url set to that URL to get a video_id, then " +
      "ads_create_ad_creative with that video_id plus an image thumbnail). If the user already gave " +
      "you a direct media URL, use it directly and do NOT call this.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        media_type: {
          type: "string",
          enum: ["image", "video"],
          description: "Which kind of media the ad needs.",
        },
        purpose: {
          type: "string",
          description:
            "Optional short note shown to the user about what the media is for, e.g. 'the main ad " +
            "image for Summer Sale 2026'.",
        },
      },
      required: ["media_type"],
    },
  },
];

// Tools the model can call that require USER INPUT before they can be answered
// (as opposed to render tools, which run instantly, or MCP write tools, which
// just need a yes/no confirmation). The gateway intercepts these by name and
// pauses the turn — they have no handler and are never auto-executed.
const INPUT_REQUIRED_TOOLS = new Set(["pick_creative_media"]);

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
  [
    "show_trend_chart",
    async (args, ctx) => {
      ctx.onEvent("card", { kind: "trend", ...args });
      return { rendered: true, note: "Trend chart shown to the user." };
    },
  ],
  [
    "show_audience_breakdown",
    async (args, ctx) => {
      ctx.onEvent("card", { kind: "donut", ...args });
      return { rendered: true, note: "Audience breakdown shown to the user." };
    },
  ],
  [
    "show_budget_pacing",
    async (args, ctx) => {
      ctx.onEvent("card", { kind: "budget_pacing", ...args });
      return { rendered: true, note: "Budget pacing meter shown to the user." };
    },
  ],
  [
    "show_leads_table",
    async (args, ctx) => {
      ctx.onEvent("card", { kind: "leads", ...args });
      return { rendered: true, note: "Leads table shown to the user." };
    },
  ],
  [
    "show_audiences_list",
    async (args, ctx) => {
      ctx.onEvent("card", { kind: "audiences", ...args });
      return { rendered: true, note: "Audiences list shown to the user." };
    },
  ],
  [
    "show_creative_gallery",
    async (args, ctx) => {
      ctx.onEvent("card", { kind: "gallery", ...args });
      return { rendered: true, note: "Creative gallery shown to the user." };
    },
  ],
  [
    "show_opportunity_score",
    async (args, ctx) => {
      ctx.onEvent("card", { kind: "opportunity_score", ...args });
      return { rendered: true, note: "Opportunity score shown to the user." };
    },
  ],
  [
    "show_pixel_health",
    async (args, ctx) => {
      ctx.onEvent("card", { kind: "pixel_health", ...args });
      return { rendered: true, note: "Pixel health shown to the user." };
    },
  ],
  [
    "show_diagnostics",
    async (args, ctx) => {
      ctx.onEvent("card", { kind: "diagnostics", ...args });
      return { rendered: true, note: "Diagnostics shown to the user." };
    },
  ],
  [
    "show_ad_rules",
    async (args, ctx) => {
      ctx.onEvent("card", { kind: "ad_rules", ...args });
      return { rendered: true, note: "Ad rules shown to the user." };
    },
  ],
  [
    "show_ab_test_results",
    async (args, ctx) => {
      ctx.onEvent("card", { kind: "ab_test", ...args });
      return { rendered: true, note: "A/B test results shown to the user." };
    },
  ],
  [
    "show_billing_summary",
    async (args, ctx) => {
      ctx.onEvent("card", { kind: "billing", ...args });
      return { rendered: true, note: "Billing summary shown to the user." };
    },
  ],
  [
    "show_activity_timeline",
    async (args, ctx) => {
      ctx.onEvent("card", { kind: "timeline", ...args });
      return { rendered: true, note: "Activity timeline shown to the user." };
    },
  ],
]);

// Synthetic annotations so the gateway classifies these as auto-exec reads
// (readOnlyHint:true = never gated by the write-confirmation flow). Excludes
// input-required tools, which are neither reads nor writes — the gateway
// intercepts them by name and must never treat them as auto-exec.
const LOCAL_TOOL_ANNOTATIONS = new Map(
  LOCAL_TOOL_DECLARATIONS.filter((d) => !INPUT_REQUIRED_TOOLS.has(d.name)).map((d) => [
    d.name,
    { readOnlyHint: true },
  ])
);

module.exports = {
  LOCAL_TOOL_DECLARATIONS,
  localHandlers,
  LOCAL_TOOL_ANNOTATIONS,
  INPUT_REQUIRED_TOOLS,
};
