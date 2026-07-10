const TokenUsage = require("../Module/tokenUsage/tokenUsage");
const logger = require("../utils/logger");

/**
 * Fire-and-forget — logging token usage must never break or slow down the
 * actual LLM response path the caller is in the middle of returning. Callers
 * do not await this.
 *
 * `usageMetadata` is passed through as returned by either Gemini SDK
 * (@google/generative-ai's UsageMetadata or @google/genai's
 * GenerateContentResponseUsageMetadata) — field names line up directly,
 * `thoughtsTokenCount`/`toolUsePromptTokenCount` simply won't be present on
 * the older SDK's shape and default to 0.
 */
function logTokenUsage({ userId, feature, model, sdk, sessionId, usageMetadata }) {
  if (!usageMetadata) return;
  TokenUsage.create({
    userId,
    feature,
    model,
    sdk,
    sessionId: sessionId || null,
    inputTokens: usageMetadata.promptTokenCount || 0,
    outputTokens: usageMetadata.candidatesTokenCount || 0,
    thinkingTokens: usageMetadata.thoughtsTokenCount || 0,
    cachedTokens: usageMetadata.cachedContentTokenCount || 0,
    toolUseTokens: usageMetadata.toolUsePromptTokenCount || 0,
    totalTokens: usageMetadata.totalTokenCount || 0,
  }).catch((err) => {
    logger.error(`token usage log failed: ${err.message}`);
  });
}

module.exports = { logTokenUsage };
