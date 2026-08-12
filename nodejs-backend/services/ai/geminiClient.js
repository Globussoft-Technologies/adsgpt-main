/**
 * The single Gemini entry point for the Node backend.
 *
 * Everything that talks to Gemini goes through here — there is no other place
 * that constructs a client or names a model. Before this module the backend
 * had two SDKs (@google/genai and the deprecated @google/generative-ai), two
 * separate API-key resolvers, and nine call sites that each re-implemented
 * "call the model, pull the text out, JSON.parse it".
 *
 * Callers get `{ text, json, usageMetadata, resolvedModel }` and never touch an
 * SDK response object. That is deliberate: the two SDKs disagree on how the
 * text comes out (`response.text()` was a METHOD on the old one, `response.text`
 * is a GETTER here), and the old call sites all read it as `res?.text?.()`,
 * which silently yields undefined — not an error — against this SDK. Keeping
 * response-shape knowledge in exactly one file is what makes that class of
 * silent breakage impossible to reintroduce.
 *
 * ─── Gemini Central ────────────────────────────────────────────────────────
 * We do NOT hold a raw Google API key. All traffic goes through the internal
 * Gemini Central proxy, which issues per-service keys and owns quota/cost
 * control.
 *
 * `GEMINI_API_KEY` holds that ISSUED key, not a Google one — the variable name
 * is unchanged from before the proxy migration but its meaning is not. A
 * leftover `AIza…` Google key in that var will now be rejected by the proxy.
 * (The Python services call the same key `GLB_KEY`; the Node backend keeps the
 * existing name.)
 *
 * There is deliberately no direct-to-Google fallback path: a silent fallback
 * would be a hole in exactly the controls the proxy exists to enforce, so a
 * missing/invalid key fails loudly instead.
 */
const { GoogleGenAI, Type } = require("@google/genai");

// Gemini Central endpoint. Overridable per environment; this is the documented
// production URL from the integrating team's guide.
const BASE_URL =
  process.env.GEMINI_BASE_URL || "";

/**
 * Model ids live here so an upgrade is one edit, not a grep across controllers.
 * Keys describe the JOB, not the model, so swapping the underlying version
 * doesn't leave a misleading name behind at the call site.
 */
const MODELS = {
  // Tool-calling chat loop (Ads Chat). `gemini-2.5-flash` was observed
  // returning empty candidates for this tool-heavy (~30k-token) prompt, which
  // surfaced as blank chat replies; `gemini-flash-latest` handles it correctly.
  CHAT: "gemini-3.1-flash-lite",
  // Long-context reasoning over a whole ad account (Autopilot LLM audit).
  REASONING: "gemini-2.5-pro",
  // Default for schema-constrained one-shot JSON calls.
  FAST: "gemini-2.5-flash",
  // High-volume, low-stakes extraction (website scrape enrichment).
  LITE: "gemini-2.0-flash-lite",
};

/**
 * Thrown when the model's reply isn't parseable JSON — including the case
 * where it came back empty. Callers that distinguish "the model misbehaved"
 * (502) from "the call failed" (500) branch on `err.code`.
 */
class GeminiJsonError extends Error {
  constructor(message, rawText) {
    super(message);
    this.name = "GeminiJsonError";
    this.code = "GEMINI_INVALID_JSON";
    this.rawText = rawText;
  }
}

let client = null;

/**
 * The one Gemini client, pointed at Gemini Central.
 *
 * Lazy so the key is read at first use rather than at require() time — module
 * import order vs. dotenv is not something a caller should have to think about.
 *
 * `apiKey` and the Authorization header carry the same key: the SDK
 * requires an apiKey to construct (it sends it as `x-goog-api-key`), and the
 * proxy authenticates on the bearer token. Per-request `httpOptions` (the
 * `timeoutMs` option below) are merged onto these by the SDK's
 * patchHttpOptions, not substituted for them, so `baseUrl` and `headers`
 * survive every call — verified against the installed SDK. Do not "simplify"
 * a call site to pass its own `httpOptions.headers`; that would merge into
 * these rather than replace them, which is rarely what you'd mean.
 */
function getClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is not configured — it must hold the Gemini Central key " +
        "issued to this service. Raw Google API keys are not used here.",
    );
  }
  if (!client) {
    client = new GoogleGenAI({
      apiKey,
      httpOptions: {
        baseUrl: BASE_URL,
        headers: { Authorization: `Bearer ${apiKey}` },
      },
    });
  }
  return client;
}

/**
 * One-shot generation. Returns normalized fields only.
 *
 * @param {string}  model            One of MODELS.*
 * @param {string}  prompt           Prompt text (or a Content/Part array).
 * @param {string} [systemInstruction]
 * @param {number} [temperature]
 * @param {object} [responseSchema]  Enables JSON mode when set.
 * @param {number} [timeoutMs]       Per-request timeout.
 * @param {object} [config]          Escape hatch merged into the SDK config.
 * @param {string} [feature]         Set to record token usage for this call.
 * @param {string} [userId]          Required for usage attribution when
 *                                   `feature` is set.
 * @param {string} [sessionId]
 */
async function generate({
  model,
  prompt,
  systemInstruction,
  temperature,
  responseSchema,
  responseMimeType,
  timeoutMs,
  config: extraConfig,
  feature,
  userId,
  sessionId,
}) {
  if (!model) throw new Error("geminiClient.generate: `model` is required.");
  if (!prompt) throw new Error("geminiClient.generate: `prompt` is required.");

  const config = { ...extraConfig };
  if (systemInstruction) config.systemInstruction = systemInstruction;
  if (temperature !== undefined) config.temperature = temperature;
  if (responseSchema) {
    config.responseSchema = responseSchema;
    config.responseMimeType = responseMimeType || "application/json";
  } else if (responseMimeType) {
    config.responseMimeType = responseMimeType;
  }
  if (timeoutMs) config.httpOptions = { ...config.httpOptions, timeout: timeoutMs };

  const response = await getClient().models.generateContent({
    model,
    contents: prompt,
    config,
  });

  // `.text` is a getter here. Never call it.
  const text = response.text ?? "";

  if (feature) {
    // Required lazily so the schema modules that import this file only for
    // `Type` don't transitively pull in the mongoose TokenUsage model.
    const { logTokenUsage } = require("../tokenUsage");
    logTokenUsage({
      userId,
      feature,
      model,
      resolvedModel: response.modelVersion,
      // Must match the TokenUsage schema's `sdk` enum.
      sdk: "genai",
      sessionId,
      usageMetadata: response.usageMetadata,
    });
  }

  return {
    text,
    usageMetadata: response.usageMetadata,
    resolvedModel: response.modelVersion,
  };
}

/** Plain-text generation. Returns the string. */
async function generateText(options) {
  const { text } = await generate(options);
  return text;
}

/**
 * Schema-constrained generation, parsed. Returns
 * `{ json, text, usageMetadata, resolvedModel }` and throws GeminiJsonError if
 * the reply is empty or unparseable — the old `?.text?.() || ""` pattern turned
 * both of those into a silent `JSON.parse("")` failure downstream.
 */
async function generateJson(options) {
  const result = await generate(options);
  const raw = (result.text || "").trim();

  if (!raw) {
    throw new GeminiJsonError("Gemini returned an empty response.", raw);
  }

  // Defensive: JSON mode doesn't fence its output, but callers without a
  // schema (plain `responseMimeType`, or none) can still get ```json wrappers.
  const cleaned = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  try {
    return { ...result, json: JSON.parse(cleaned) };
  } catch (err) {
    throw new GeminiJsonError(
      `Gemini JSON parse failed: ${err.message}. Raw: ${cleaned.substring(0, 200)}`,
      cleaned,
    );
  }
}

module.exports = {
  getClient,
  generate,
  generateText,
  generateJson,
  GeminiJsonError,
  MODELS,
  // Re-exported so schema modules declare types without importing the SDK.
  Type,
};
