/**
 * Ads Chat MCP mode switch — `META_MCP_MODE = local | official`.
 *
 * Ads Chat can talk to either MCP server:
 *
 *   local     the self-hosted byadsco fork (`mcps/meta`), authenticated with a
 *             service API key plus a per-user Meta token header. What ships today.
 *   official  Meta's hosted server at https://mcp.facebook.com/ads, authenticated
 *             with the SAME per-user Meta token as an OAuth bearer. Requires the
 *             `ads_mcp_management` permission, which only accounts holding a role
 *             on the app can grant until App Review approves it.
 *
 * The two servers differ in six ways (endpoint, auth headers, which tools are
 * worth declaring, result shape, which args identify a campaign, and how long a
 * call may take). Branching on the env var at each of those six sites would
 * spread one conditional across two files and guarantee the next change updates
 * five of them. So this module is the ONLY place that reads the env var, and it
 * hands out a profile; every caller takes the profile.
 *
 * Adding a third server means adding a profile here and nothing else.
 *
 * Env is read per call rather than captured at module load so tests (and a
 * restart-free config reload) see changes without re-requiring the module.
 */

const LOCAL = "local";
const OFFICIAL = "official";

const OFFICIAL_URL_DEFAULT = "https://mcp.facebook.com/ads";

/** Per-tool MCP call timeouts, in ms, keyed by tool name. */
const DEFAULT_TOOL_TIMEOUT_MS = 60_000;

// The MCP SDK's own default is 60s, which is SHORTER than the slowest fork tools
// legitimately take: ads_bulk_create_video_ads budgets 180s for its batch and
// waits up to 120s per video for Meta to finish processing, and
// ads_get_creative_media downloads several images. Neither server sends progress
// notifications, so resetTimeoutOnProgress cannot extend the window — without an
// explicit timeout the client aborts at 60s WHILE THE SERVER KEEPS WORKING, so a
// bulk call reports failure after it has already created ads and a retry
// duplicates them. Raised per-tool rather than globally so a genuinely hung read
// still fails in 60s instead of stalling the chat turn for four minutes.
const LOCAL_TOOL_TIMEOUTS = {
  ads_bulk_create_video_ads: 240_000,
  ads_get_creative_media: 120_000,
};

// The official server exposes no comparably long-running tool today; its slowest
// are media uploads. Kept as its own map so the two never drift into each other.
const OFFICIAL_TOOL_TIMEOUTS = {
  ads_creative_upload_video: 180_000,
  ads_creative_upload_media: 180_000,
  ads_creative_upload_local_image: 120_000,
};

/**
 * Local-only render tools whose data source does not exist on the official
 * server. `show_leads_table` needs lead tools (the official server has none, and
 * `leads_retrieval` is not even in its supported scopes); `show_billing_summary`
 * needs invoices/billing; `show_ad_rules` needs automated rules. Declaring a card
 * the model can never populate just invites it to promise output it cannot produce.
 */
const OFFICIAL_DISABLED_LOCAL_TOOLS = new Set([
  "show_leads_table",
  "show_billing_summary",
  "show_ad_rules",
]);

/** Trim + drop empties from a comma-separated env list. */
function parseList(raw) {
  return String(raw || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Which mode applies to this user.
 *
 * `META_MCP_OFFICIAL_USER_IDS` is a canary allowlist: those users get official
 * mode whatever `META_MCP_MODE` says, so the team can exercise the official
 * server on production data while every customer stays on local.
 *
 * Anything other than the exact string "official" resolves to local. A typo must
 * be inert, never a silent migration of every user onto a different backend.
 */
function resolveMode(userId) {
  const canary = parseList(process.env.META_MCP_OFFICIAL_USER_IDS);
  if (userId && canary.includes(String(userId))) return OFFICIAL;
  return process.env.META_MCP_MODE === OFFICIAL ? OFFICIAL : LOCAL;
}

// ── result normalisation ────────────────────────────────────────────────────

// Caps on how much image data we hand Gemini in one message. ads_get_creative_media
// already bounds itself at 5 images / 8MB each / 20MB total, which sits at the
// edge of what a single Gemini request accepts, so re-cap here rather than
// trusting the tool's budget.
const MAX_INLINE_IMAGES = 5;
const MAX_INLINE_IMAGE_BYTES = 7 * 1024 * 1024;

/**
 * local: lift base64 `image` blocks out of a tool result and into real Gemini
 * `inlineData` parts.
 *
 * MCP returns images as base64 inside the result body. Serialized into a
 * functionResponse that base64 arrives as TEXT, which the model cannot decode —
 * so ads_get_creative_media could never do the one thing it exists for, while
 * costing roughly 170k tokens for a single 500KB creative. The same body is
 * persisted into session.pendingAction/pendingInput, where it would push the
 * Mongo document toward its 16MB ceiling.
 *
 * So the result keeps a short marker and the image travels separately as an
 * `inlineData` part, which the model CAN see. The caller attaches those parts to
 * the live message only — never to the parts that get persisted.
 */
function splitImageBlocks(result) {
  const content = result?.content;
  if (!Array.isArray(content)) return { result, imageParts: [] };
  if (!content.some((b) => b?.type === "image")) return { result, imageParts: [] };

  const imageParts = [];
  let bytes = 0;

  const kept = content.map((block) => {
    if (block?.type !== "image" || typeof block.data !== "string") return block;

    const size = Math.floor((block.data.length * 3) / 4);
    if (imageParts.length >= MAX_INLINE_IMAGES || bytes + size > MAX_INLINE_IMAGE_BYTES) {
      return {
        type: "text",
        text:
          "[image omitted — per-message image budget reached; request fewer images " +
          "or image_size 'small']",
      };
    }

    bytes += size;
    imageParts.push({
      inlineData: { mimeType: block.mimeType || "image/jpeg", data: block.data },
    });
    return {
      type: "text",
      text: `[image ${imageParts.length} is attached to this message — look at it directly]`,
    };
  });

  return { result: { ...result, content: kept }, imageParts };
}

/**
 * official: unwrap double-encoded JSON payloads.
 *
 * The official server returns its data as a JSON *string* nested inside a text
 * block, e.g. {"ad_entities":"[{\"name\":\"…\"}]"}. Left as-is the model reads a
 * wall of escapes: in testing it retrieved correct data and then re-queried four
 * more times without ever answering. Parsing the nested string here fixes it for
 * every tool at once, rather than relying on a system-prompt instruction that
 * only helps when the model remembers it.
 */
function unwrapEncodedJson(result) {
  const content = result?.content;
  if (!Array.isArray(content)) return { result, imageParts: [] };

  let changed = false;
  const kept = content.map((block) => {
    if (block?.type !== "text" || typeof block.text !== "string") return block;

    let parsed;
    try {
      parsed = JSON.parse(block.text);
    } catch {
      return block; // not JSON — a summary line, leave it alone
    }
    if (!parsed || typeof parsed !== "object") return block;

    let touched = false;
    for (const [key, value] of Object.entries(parsed)) {
      // Only unwrap strings that are themselves JSON arrays/objects.
      if (typeof value !== "string") continue;
      const trimmed = value.trim();
      if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) continue;
      try {
        parsed[key] = JSON.parse(trimmed);
        touched = true;
      } catch {
        /* leave the raw string in place */
      }
    }
    if (!touched) return block;
    changed = true;
    return { ...block, text: JSON.stringify(parsed) };
  });

  // The official server has no inline-image tool, so there is never anything to
  // lift out here — the shape is shared so callers need no per-mode branch.
  return { result: changed ? { ...result, content: kept } : result, imageParts: [] };
}

// ── campaign identification (for the managed-campaign plan gate) ─────────────

const CAMPAIGN_ID_ARG_KEYS = ["campaign_id", "campaignId"];
const AD_SET_ID_ARG_KEYS = ["ad_set_id", "adset_id", "adSetId"];
const AD_ID_ARG_KEYS = ["ad_id", "adId"];

function firstArg(args, keys) {
  for (const key of keys) {
    if (args?.[key]) return String(args[key]);
  }
  return null;
}

/**
 * local: the fork names the object directly (campaign_id / ad_set_id / ad_id).
 * Returns a descriptor the caller resolves; `campaignId` is authoritative, the
 * other two need a parent lookup against Meta.
 */
function localTargetFromArgs(args = {}) {
  return {
    campaignId: firstArg(args, CAMPAIGN_ID_ARG_KEYS),
    adSetId: firstArg(args, AD_SET_ID_ARG_KEYS),
    adId: firstArg(args, AD_ID_ARG_KEYS),
  };
}

/**
 * official: there is no `campaign_id` argument anywhere in its 97 tools. Writes
 * carry `entity_id` plus `entity_type` ("campaign" | "ad_set" | "ad"). Ported
 * unchanged, the local extractor finds nothing here and the managed-campaign
 * limit stops enforcing SILENTLY — no error, just an unenforced billing cap.
 */
function officialTargetFromArgs(args = {}) {
  const entityId = firstArg(args, ["entity_id", "entityId"]);
  const rawType = String(args?.entity_type || args?.entityType || "").toLowerCase();

  if (entityId) {
    if (rawType === "campaign") return { campaignId: entityId, adSetId: null, adId: null };
    if (rawType === "ad_set" || rawType === "adset") {
      return { campaignId: null, adSetId: entityId, adId: null };
    }
    if (rawType === "ad") return { campaignId: null, adSetId: null, adId: entityId };
  }

  // Creates name their parent rather than an entity: ads_create_ad takes an
  // ad set, ads_create_ad_set takes a campaign.
  return {
    campaignId: firstArg(args, CAMPAIGN_ID_ARG_KEYS),
    adSetId: firstArg(args, AD_SET_ID_ARG_KEYS),
    adId: firstArg(args, AD_ID_ARG_KEYS),
  };
}

// ── tool aliases ────────────────────────────────────────────────────────────

/**
 * The system prompt and the render-tool descriptions name MCP tools directly —
 * "call ads_get_insights with time_increment", "leads from ads_get_leads". The
 * two servers use different names for the same capability, and the official one
 * folds ~10 of the fork's read tools into a single generic `ads_get_ad_entities`.
 * Telling the model to call a tool that is not in its declarations is worse than
 * saying nothing: it burns a turn on a call that cannot resolve.
 *
 * So prompt text refers to CAPABILITIES by logical key, and each profile maps
 * those to the real name. `null` means the active server has no equivalent — the
 * sentence referring to it is dropped rather than left pointing at nothing.
 *
 * Names verified against a live `tools/list` of both servers on 2026-09-11.
 */
const TOOL_ALIASES = {
  [LOCAL]: {
    insights: "ads_get_insights",
    campaignDetails: "ads_get_campaign_details",
    adSetDetails: "ads_get_ad_set_details",
    createCreative: "ads_create_ad_creative",
    uploadVideo: "ads_upload_ad_video",
    adImages: "ads_get_ad_images",
    adVideos: "ads_get_ad_videos",
    adCreatives: "ads_get_ad_creatives",
    customAudiences: "ads_get_custom_audiences",
    opportunityScore: "ads_get_opportunity_score",
    datasetQuality: "ads_get_dataset_quality",
    pixelDetails: "ads_get_pixel_details",
    errors: "ads_get_errors",
    adPreview: "ads_get_ad_preview",
    generatePreview: "ads_generate_preview",
    adStudies: "ads_get_ad_studies",
    leads: "ads_get_leads",
    adRules: "ads_get_ad_rules",
    billingInfo: "ads_get_billing_info",
    invoices: "ads_get_invoices",
    diagnose: "ads_diagnose_underperformance",
  },
  [OFFICIAL]: {
    // One generic reader replaces the fork's per-level tools; it carries metrics,
    // breakdowns, filtering, sorting and time ranges via `level` + `fields`.
    insights: "ads_get_ad_entities",
    campaignDetails: "ads_get_ad_entities",
    adSetDetails: "ads_get_ad_entities",
    createCreative: "ads_create_creative",
    uploadVideo: "ads_creative_upload_video",
    adImages: "ads_get_ad_images",
    adVideos: "ads_get_ad_videos",
    adCreatives: "ads_get_creatives",
    customAudiences: "ads_get_ad_account_custom_audiences",
    opportunityScore: "ads_get_opportunity_score",
    datasetQuality: "ads_get_dataset_quality",
    pixelDetails: "ads_get_dataset_details",
    errors: "ads_get_errors",
    adPreview: "ads_get_ad_preview",
    generatePreview: null, // merged into ads_get_ad_preview
    adStudies: "ads_experiment_list_tests",
    // No counterpart on the official server, and in the case of leads not even a
    // supported scope (`leads_retrieval` is absent from its scope set).
    leads: null,
    adRules: null,
    billingInfo: null,
    invoices: null,
    diagnose: null,
  },
};

/**
 * Replace `{{tool:key}}` tokens in a description with this mode's real tool name.
 *
 * A token for a capability the active server lacks resolves to a neutral phrase
 * rather than a dangling name — such a description belongs to a render tool that
 * is itself withheld in that mode, so this is a backstop, not the main path.
 */
function renderToolRefs(text, profile) {
  if (typeof text !== "string" || !text.includes("{{tool:")) return text;

  // Unavailable tools become a sentinel first, so the connector that introduced
  // them ("X or Y", "X / Y") can be removed with them — otherwise a dropped tool
  // leaves dangling prose like "from ads_get_errors or ".
  const GONE = " ";
  let out = text.replace(/\{\{tool:([a-zA-Z]+)\}\}/g, (_m, key) => profile.tool(key) || GONE);

  const SEP = "\\s*(?:,\\s*)?(?:or\\s+|\\/\\s*)?";
  out = out
    .replace(new RegExp(SEP + GONE, "g"), "")
    .replace(new RegExp(GONE + SEP, "g"), "")
    // A source that exists nowhere on this server: keep the sentence readable.
    .replace(new RegExp(GONE, "g"), "the relevant read tool");

  // Several fork tools collapse to ONE tool on the official server, so a sentence
  // listing alternatives can render as "X, X, or X". Fold a run of the same name
  // back down to a single mention.
  return out.replace(
    new RegExp("\\b(ads_[a-z_]+)((?:" + SEP + "\\1\\b)+)", "g"),
    (_m, name) => name
  );
}

// ── profiles ────────────────────────────────────────────────────────────────

const PROFILES = {
  [LOCAL]: {
    mode: LOCAL,
    url: () => process.env.META_MCP_SERVER_URL,
    urlEnvVar: "META_MCP_SERVER_URL",
    headers(metaAccessToken) {
      const headers = { "X-Meta-Token": metaAccessToken };
      if (process.env.META_MCP_API_KEY) {
        headers["X-API-Key"] = process.env.META_MCP_API_KEY;
      }
      return headers;
    },
    // The fork's 27 whatsapp_* tools need `whatsapp_business_management` on the
    // user's token; our OAuth requests only ads/pages/leads scopes (see
    // authController.js), so every one of them fails on permissions. Declaring
    // them anyway is a fifth of the catalogue that can only ever error, steering
    // the model into guaranteed failures on a surface users do ask about.
    //
    // Unconditional on purpose: there is no configuration that makes these work,
    // only an App Review approval, and that would land with a scope change here
    // rather than an env flag someone has to remember to flip.
    includeTool: (name) => !String(name).startsWith("whatsapp_"),
    normalizeResult: splitImageBlocks,
    targetFromArgs: localTargetFromArgs,
    tool: (key) => TOOL_ALIASES[LOCAL][key] ?? null,
    campaignNameLookup: (campaignId) => ({
      name: TOOL_ALIASES[LOCAL].campaignDetails,
      arguments: { campaign_id: campaignId, fields: ["id", "name"] },
    }),
    timeoutFor: (name) => LOCAL_TOOL_TIMEOUTS[name] ?? DEFAULT_TOOL_TIMEOUT_MS,
    disabledLocalTools: new Set(),
  },

  [OFFICIAL]: {
    mode: OFFICIAL,
    url: () => process.env.META_MCP_OFFICIAL_URL || OFFICIAL_URL_DEFAULT,
    urlEnvVar: "META_MCP_OFFICIAL_URL",
    // Same per-user Meta token as local mode, presented as an OAuth bearer.
    // Confirmed against the live server: it accepts a standard Graph user access
    // token, so no separate OAuth flow or token store is needed.
    headers: (metaAccessToken) => ({ Authorization: `Bearer ${metaAccessToken}` }),
    includeTool: () => true,
    normalizeResult: unwrapEncodedJson,
    targetFromArgs: officialTargetFromArgs,
    tool: (key) => TOOL_ALIASES[OFFICIAL][key] ?? null,
    // The official server has one generic reader, addressed by level + ids, and
    // it needs the ad account the entity lives in.
    campaignNameLookup: (campaignId, args = {}) => {
      const adAccountId = args.ad_account_id || args.account_id;
      if (!adAccountId) return null;
      return {
        name: TOOL_ALIASES[OFFICIAL].campaignDetails,
        arguments: {
          ad_account_id: adAccountId,
          level: "campaign",
          object_ids: [campaignId],
          fields: ["name"],
        },
      };
    },
    timeoutFor: (name) => OFFICIAL_TOOL_TIMEOUTS[name] ?? DEFAULT_TOOL_TIMEOUT_MS,
    disabledLocalTools: OFFICIAL_DISABLED_LOCAL_TOOLS,
  },
};

/** The profile for this user's mode. Never returns undefined. */
function getProfile(userId) {
  return PROFILES[resolveMode(userId)];
}

module.exports = {
  LOCAL,
  OFFICIAL,
  DEFAULT_TOOL_TIMEOUT_MS,
  resolveMode,
  getProfile,
  // exported for tests
  renderToolRefs,
  splitImageBlocks,
  unwrapEncodedJson,
  localTargetFromArgs,
  officialTargetFromArgs,
};
