/**
 * Mongo aggregation helpers derived from the model registry.
 *
 * The same `effective_cost` / `effective_credits` math runs in three places
 * (generatedMedia.controller, admin/adminDashboard.controller, and any future
 * report). This module is the one place where the $switch branches are built
 * — every consumer imports from here so adding a model never means editing a
 * raw aggregation pipeline again.
 */

const { MODEL_REGISTRY, allKeysFor, imageEntries, videoEntries } = require("./modelRegistry");

/**
 * Build $switch branches that map any known model alias → its credits-per-unit.
 *
 * For images: per-image credits.
 * For videos: per-second credits (the caller multiplies by an assumed
 *   duration — historically 5s — for old records that lack credit_deduction).
 *
 * Reads env vars at call time so changes to deployment env don't require a
 * process restart.
 */
function buildCreditLookupBranches() {
  return MODEL_REGISTRY.map((entry) => {
    const raw = parseFloat(process.env[entry.creditEnvVar]);
    const value = Number.isFinite(raw)
      ? raw
      : entry.type === "video"
        ? entry.aggregationCreditDefault ?? entry.creditDefault
        : entry.creditDefault;
    return {
      case: { $in: ["$cleanModel", allKeysFor(entry)] },
      then: value,
    };
  });
}

/** Canonical keys of all video models — used by the "× 5s assumed duration" branch. */
function videoCanonicalKeys() {
  return videoEntries().map((e) => e.canonicalKey);
}

/**
 * Build $switch branches that map any known model alias → its USD cost
 * fallback. Used to back-fill `effective_cost` for OLD GeneratedMedia records
 * where the cost field is 0.
 *
 * IMAGE models: returns 0 (matches existing behaviour — historical records
 *   pre-date the per_image flat rate; new records save the real cost upfront
 *   via modelPricingConfig.getImageCost). Flip this to entry.pricing.per_image
 *   if/when you decide to back-fill historical image rows.
 * VIDEO models: pricePerSec × $duration.
 */
function buildCostFallbackBranches() {
  const branches = [];

  for (const entry of imageEntries()) {
    branches.push({
      case: { $in: ["$cleanModel", allKeysFor(entry)] },
      then: 0,
    });
  }

  for (const entry of videoEntries()) {
    const perSec = entry.pricing?.per_second ?? 0;
    branches.push({
      case: { $in: ["$cleanModel", allKeysFor(entry)] },
      then: { $multiply: ["$duration", perSec] },
    });
  }

  return branches;
}

/**
 * Standard pipeline stages that derive `effective_credits` and `effective_cost`
 * on each document, mirroring the historical math in generatedMedia.controller.
 *
 * Stages assume a `model` field is present; they emit:
 *   cleanModel         trimmed model string
 *   effective_credits  credit_deduction if > 0, else fallback × (5 for video)
 *   effective_cost     cost if > 0, else flat-image / per-sec × duration
 */
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
        // For OLD video records whose credit_deduction is 0, the fallback
        // above resolved to a per-second value — multiply by an assumed 5s.
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
