/**
 * Static Gemini pricing table (USD per 1M tokens, standard/non-batch tier),
 * keyed by exact model id — from ai.google.dev/pricing. Add a line here
 * whenever a new model is tried via GEMINI_MODEL (services/metaChat/
 * geminiMcpBridge.js); an unpriced model logs costUsd: null rather than a
 * guessed number.
 *
 * `outputPerM` already covers thinking tokens — Google bills them at the
 * same rate ("Output price (including thinking tokens)"), not separately.
 */
const GEMINI_PRICING = {
  "gemini-3.1-flash-lite": {
    inputPerM: 0.25,
    outputPerM: 1.5,
    cachedPerM: 0.025,
  },
};

/**
 * Estimated cost in USD for one API call, given the token-count fields
 * already captured in tokenUsage.js. Not a substitute for the actual Google
 * Cloud bill — no free-tier allowance, no Google Search grounding charges,
 * and no accounting for price-table staleness are reflected here.
 *
 * - input tokens net of the cached subset are priced at inputPerM
 * - cached tokens are priced at the discounted cachedPerM
 * - tool-use prompt tokens are prompt-side overhead, priced as input
 * - output + thinking tokens are priced together at outputPerM
 *
 * Returns null (not 0) when the model has no pricing entry, so "unknown"
 * and "free" are never conflated in the admin UI.
 */
function estimateCostUsd(model, { inputTokens = 0, outputTokens = 0, thinkingTokens = 0, cachedTokens = 0, toolUseTokens = 0 }) {
  const price = GEMINI_PRICING[model];
  if (!price) return null;

  const billedInputTokens = Math.max(0, inputTokens - cachedTokens) + toolUseTokens;
  const inputCost = (billedInputTokens / 1_000_000) * price.inputPerM;
  const cachedCost = (cachedTokens / 1_000_000) * price.cachedPerM;
  const outputCost = ((outputTokens + thinkingTokens) / 1_000_000) * price.outputPerM;

  return inputCost + cachedCost + outputCost;
}

module.exports = { GEMINI_PRICING, estimateCostUsd };
