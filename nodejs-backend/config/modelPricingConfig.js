/**
 * Runtime model pricing facade.
 *
 * MongoDB-backed AI model configuration is the only runtime source of model
 * pricing. The seed registry is intentionally not imported here.
 */

const modelConfigurationService = require("../services/modelConfigurationService");

function resolve(model) {
  return modelConfigurationService.getRuntimeModel(model);
}

const modelPricingConfig = {
  getImageCost(model, inputTokens = 0, outputTokens = 0) {
    return modelConfigurationService.getRuntimeImagePrice(
      resolve(model),
      undefined,
      inputTokens,
      outputTokens,
    );
  },

  getImageCostByQuality(model, quality, inputTokens = 0, outputTokens = 0) {
    return modelConfigurationService.getRuntimeImagePrice(
      resolve(model),
      quality,
      inputTokens,
      outputTokens,
    );
  },

  getVideoCost(model, durationSeconds = 0) {
    return modelConfigurationService.getRuntimeVideoPrice(resolve(model), durationSeconds);
  },
};

module.exports = modelPricingConfig;
