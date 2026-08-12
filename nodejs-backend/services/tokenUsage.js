const TokenUsage = require("../Module/tokenUsage/tokenUsage");
const logger = require("../utils/logger");
const { estimateCostUsd } = require("../config/geminiPricing");

/**
 * Fire-and-forget — logging token usage must never break or slow down the
 * actual LLM response path the caller is in the middle of returning. Callers
 * do not await this.
 *
 * `usageMetadata` is passed through as returned by @google/genai
 * (GenerateContentResponseUsageMetadata). Any field the model doesn't report
 * for a given call defaults to 0.
 *
 * NOTE: the `sdk` enum on the TokenUsage schema still accepts
 * "generative-ai" so historical rows written before the SDK consolidation
 * remain readable; nothing writes that value any more.
 *
 * `resolvedModel` (response.modelVersion, when the caller has it) is priced
 * in preference to `model`, since `model` may be an alias like
 * "gemini-flash-latest" whose underlying version Google can repoint.
 */
function logTokenUsage({ userId, feature, model, resolvedModel, sdk, sessionId, usageMetadata }) {
  if (!usageMetadata) return;
  const tokens = {
    inputTokens: usageMetadata.promptTokenCount || 0,
    outputTokens: usageMetadata.candidatesTokenCount || 0,
    thinkingTokens: usageMetadata.thoughtsTokenCount || 0,
    cachedTokens: usageMetadata.cachedContentTokenCount || 0,
    toolUseTokens: usageMetadata.toolUsePromptTokenCount || 0,
  };
  const costUsd = estimateCostUsd(resolvedModel || model, tokens);
  TokenUsage.create({
    userId,
    feature,
    model,
    resolvedModel: resolvedModel || null,
    sdk,
    sessionId: sessionId || null,
    ...tokens,
    totalTokens: usageMetadata.totalTokenCount || 0,
    costUsd,
  }).catch((err) => {
    logger.error(`token usage log failed: ${err.message}`);
  });
}

module.exports = { logTokenUsage };
