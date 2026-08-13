/**
 * Mongo aggregation helpers derived from the DB-backed model catalog.
 *
 * These stages are built from the warmed runtime cache, which is refreshed at
 * startup and after every Admin model mutation. The static seed registry is
 * intentionally not used at runtime.
 */

const modelConfigurationService = require("../services/modelConfigurationService");

function runtimeModels(type) {
  return modelConfigurationService.getRuntimeModels({ type });
}

function keys(entry) {
  return modelConfigurationService.getRuntimeKeys(entry);
}

function modelMatch(entry) {
  return { $in: ["$cleanModel", keys(entry)] };
}

function qualityModelMatch(entry, quality) {
  return {
    $and: [
      modelMatch(entry),
      { $eq: [{ $toLower: { $ifNull: ["$quality", ""] } }, String(quality).toLowerCase()] },
    ],
  };
}

function buildCreditLookupBranches() {
  const branches = [];
  for (const entry of runtimeModels()) {
    const tiers = Array.isArray(entry.qualityTiers) ? entry.qualityTiers : [];
    if (entry.type === "image" && tiers.length) {
      for (const tier of tiers) {
        branches.push({
          case: qualityModelMatch(entry, tier.quality),
          then: Number(tier.credits) || 0,
        });
      }
      branches.push({
        case: modelMatch(entry),
        then: Math.max(...tiers.map((tier) => Number(tier.credits) || 0)),
      });
    } else {
      branches.push({ case: modelMatch(entry), then: Number(entry.credits) || 0 });
    }
  }
  return branches;
}

function buildCostFallbackBranches() {
  const branches = [];

  for (const entry of runtimeModels("image")) {
    const tiers = Array.isArray(entry.qualityTiers) ? entry.qualityTiers : [];
    for (const tier of tiers) {
      const price = Number(tier.pricing?.per_image) || 0;
      branches.push({ case: qualityModelMatch(entry, tier.quality), then: price });
    }
    const highestPrice = tiers.length
      ? Math.max(...tiers.map((tier) => Number(tier.pricing?.per_image) || 0))
      : Number(entry.pricing?.per_image) || 0;
    branches.push({ case: modelMatch(entry), then: highestPrice });
  }

  for (const entry of runtimeModels("video")) {
    const perSecond = Number(entry.pricing?.per_second) || 0;
    branches.push({
      case: modelMatch(entry),
      then: { $multiply: ["$duration", perSecond] },
    });
  }

  return branches;
}

function videoCanonicalKeys() {
  return runtimeModels("video").map((entry) => entry.canonicalKey);
}

function buildEffectiveCostStages() {
  return [
    { $addFields: { cleanModel: { $trim: { input: "$model" } } } },
    {
      $addFields: {
        effective_credits: {
          $cond: [
            { $gt: [{ $ifNull: ["$credit_deduction", 0] }, 0] },
            "$credit_deduction",
            { $switch: { branches: buildCreditLookupBranches(), default: 0 } },
          ],
        },
      },
    },
    {
      $addFields: {
        effective_credits: {
          $cond: [
            { $gt: [{ $ifNull: ["$credit_deduction", 0] }, 0] },
            "$effective_credits",
            {
              $cond: [
                { $in: ["$cleanModel", videoCanonicalKeys()] },
                { $multiply: ["$effective_credits", 5] },
                "$effective_credits",
              ],
            },
          ],
        },
      },
    },
    {
      $addFields: {
        effective_cost: {
          $cond: [
            { $gt: [{ $ifNull: ["$cost", 0] }, 0] },
            "$cost",
            { $switch: { branches: buildCostFallbackBranches(), default: 0 } },
          ],
        },
      },
    },
  ];
}

module.exports = {
  buildCreditLookupBranches,
  buildCostFallbackBranches,
  buildEffectiveCostStages,
  videoCanonicalKeys,
};
