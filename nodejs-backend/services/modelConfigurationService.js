const AIModelConfiguration = require("../Module/aiModel/aiModelConfiguration");

const DEFAULT_IMAGE_QUALITY = "high";

function normalizeKey(value) {
  return typeof value === "string" ? value.trim() : "";
}

function toPlain(model) {
  if (!model) return model;
  return typeof model.toObject === "function" ? model.toObject() : model;
}

function surfacesObject(model) {
  const surfaces = toPlain(model)?.surfaces;
  if (!surfaces) return {};
  if (surfaces instanceof Map) return Object.fromEntries(surfaces.entries());
  return surfaces;
}

function isUsable(model) {
  return Boolean(model && model.enabled !== false && model.archived !== true);
}

function toLegacyEntry(model) {
  if (!model) return model;
  const row = toPlain(model);
  return {
    ...row,
    label: row.displayName || row.label,
    creditDefault: row.credits,
    creditEnvVar: undefined,
    qualityTiers: (row.qualityTiers || []).map((tier) => ({
      ...tier,
      creditDefault: tier.credits,
    })),
    extraDeduction: (row.extraCharges || []).map((charge) => ({
      ...charge,
      deduction: charge.credits,
      unit: charge.unit || (charge.type === "ai_ads_scene_regen_image" ? "image" : charge.costPerSecond != null ? "second" : "request"),
      usdPerUnit: charge.usdPerUnit ?? charge.costPerSecond,
    })),
  };
}

function createModelConfigurationService({ model = AIModelConfiguration } = {}) {
  let allCache = null;
  let activeCache = null;
  let syncCache = null;

  async function refreshCache() {
    const rows = await model.find({}).sort({ sortOrder: 1, canonicalKey: 1 }).lean();
    syncCache = rows.map(toLegacyEntry);
    allCache = rows;
    activeCache = rows.filter((row) => row.archived !== true);
    return syncCache;
  }

  function invalidateCache() {
    allCache = null;
    activeCache = null;
    syncCache = null;
  }

  async function getAllModels({ includeArchived = true } = {}) {
    const cacheKey = includeArchived ? "all" : "nonArchived";
    if (cacheKey === "all" && allCache) return allCache;
    if (cacheKey === "nonArchived" && activeCache) return activeCache;

    const query = includeArchived ? {} : { archived: { $ne: true } };
    const rows = await model.find(query).sort({ sortOrder: 1, canonicalKey: 1 }).lean();
    if (cacheKey === "all") allCache = rows;
    else activeCache = rows;
    return rows;
  }

  async function getEnabledModels() {
    const rows = await getAllModels({ includeArchived: false });
    return rows.filter(isUsable);
  }

  async function getModelByCanonicalKey(canonicalKey, { includeDisabled = true } = {}) {
    const key = normalizeKey(canonicalKey);
    if (!key) return null;
    const row = await model.findOne({ canonicalKey: key }).lean();
    if (!row || (!includeDisabled && !isUsable(row))) return null;
    return row;
  }

  async function resolveModelByAlias(value, options = {}) {
    const key = normalizeKey(value);
    if (!key) return null;
    const exact = await getModelByCanonicalKey(key, options);
    if (exact) return exact;
    const row = await model.findOne({ aliases: key }).lean();
    if (!row || (options.includeDisabled === false && !isUsable(row))) return null;
    return row;
  }

  async function getModelsForSurface(surface, { type, includeDisabled = false } = {}) {
    const rows = includeDisabled ? await getAllModels({ includeArchived: false }) : await getEnabledModels();
    return rows.filter((row) => {
      if (type && row.type !== type) return false;
      return surfacesObject(row)[surface]?.enabled === true;
    });
  }

  async function getQualityTier(canonicalKey, quality) {
    const row = await resolveModelByAlias(canonicalKey);
    const tiers = row?.qualityTiers || [];
    if (!tiers.length) return null;
    const requested = normalizeKey(quality).toLowerCase();
    return (
      tiers.find((tier) => tier.quality === requested) ||
      tiers.find((tier) => tier.quality === DEFAULT_IMAGE_QUALITY) ||
      null
    );
  }

  function getCachedModel(value, { includeDisabled = true } = {}) {
    const key = normalizeKey(value);
    if (!key || !syncCache) return null;
    const row = syncCache.find(
      (entry) => entry.canonicalKey === key || (entry.aliases || []).includes(key),
    );
    if (!row || (!includeDisabled && !isUsable(row))) return null;
    return row;
  }

  function getCachedModels({ type, activeOnly = false } = {}) {
    if (!syncCache) return [];
    return syncCache.filter(
      (entry) =>
        (!type || entry.type === type) &&
        (!activeOnly || isUsable(entry)),
    );
  }

  function getCachedModelsForSurface(surface, { type, activeOnly = true } = {}) {
    return getCachedModels({ type, activeOnly }).filter(
      (entry) => surfacesObject(entry)[surface]?.enabled === true,
    );
  }

  function getCachedQualityTier(canonicalKey, quality) {
    const entry = getCachedModel(canonicalKey);
    const tiers = entry?.qualityTiers || [];
    if (!tiers.length) return null;
    const requested = normalizeKey(quality).toLowerCase();
    return (
      tiers.find((tier) => tier.quality === requested) ||
      tiers.find((tier) => tier.quality === DEFAULT_IMAGE_QUALITY) ||
      null
    );
  }

  // Runtime-only helpers. These intentionally do not fall back to the seed
  // registry: after startup, MongoDB is the source of truth for all model
  // resolution, credits, pricing, aliases, and capabilities.
  function getRuntimeModel(value, { includeDisabled = true } = {}) {
    return getCachedModel(value, { includeDisabled });
  }

  function getRuntimeModels({ type, activeOnly = false } = {}) {
    return getCachedModels({ type, activeOnly });
  }

  function getRuntimeKeys(entry) {
    return entry ? [entry.canonicalKey, ...(entry.aliases || [])] : [];
  }

  function getRuntimeCredit(entry, quality) {
    if (!entry) return 0;
    const tiers = Array.isArray(entry.qualityTiers) ? entry.qualityTiers : [];
    if (entry.type === "image" && tiers.length) {
      const requested = typeof quality === "string" ? quality.trim().toLowerCase() : "";
      const tier = tiers.find((item) => String(item.quality).toLowerCase() === requested);
      if (tier) return Number(tier.credits) || 0;
      if (entry.credits != null) return Number(entry.credits) || 0;
      const fallbackTier =
        tiers.find((item) => String(item.quality).toLowerCase() === DEFAULT_IMAGE_QUALITY) ||
        tiers.reduce(
          (highest, item) => Number(item.credits) > Number(highest?.credits || 0) ? item : highest,
          null,
        );
      return Number(fallbackTier?.credits) || 0;
    }
    return Number(entry.credits) || 0;
  }

  function getRuntimeImagePrice(entry, quality, inputTokens = 0, outputTokens = 0) {
    if (!entry) return 0;
    const tiers = Array.isArray(entry.qualityTiers) ? entry.qualityTiers : [];
    const requested = typeof quality === "string" ? quality.trim().toLowerCase() : "";
    const tier = tiers.find((item) => String(item.quality).toLowerCase() === requested);
    const pricing = tier?.pricing || entry.pricing || {};
    if (!tier && entry.pricing?.per_image != null) return Number(entry.pricing.per_image) || 0;
    const fallbackTier =
      tier ||
      tiers.find((item) => String(item.quality).toLowerCase() === DEFAULT_IMAGE_QUALITY) ||
      tiers.reduce(
        (highest, item) => Number(item.credits) > Number(highest?.credits || 0) ? item : highest,
        null,
      );
    const fallbackPricing = fallbackTier?.pricing || pricing;
    if (fallbackPricing.per_image != null) return Number(fallbackPricing.per_image) || 0;
    return Number(
      ((inputTokens / 1_000_000) * Number(fallbackPricing.input_per_million || 0)) +
      ((outputTokens / 1_000_000) * Number(fallbackPricing.output_per_million || 0)),
    ).toFixed(6);
  }

  function getRuntimeVideoPrice(entry, durationSeconds = 0) {
    return Number(((Number(entry?.pricing?.per_second) || 0) * Number(durationSeconds || 0)).toFixed(4));
  }

  function getRuntimeExtra(entry, type) {
    return (entry?.extraCharges || []).find((charge) => charge.type === type) || null;
  }

  function getRuntimeExtraUnit(entry, type) {
    const charge = getRuntimeExtra(entry, type);
    return charge ? (charge.unit || (charge.type === "ai_ads_scene_regen_image" ? "image" : charge.costPerSecond != null ? "second" : "request")) : null;
  }

  function getRuntimeExtraUsdPerUnit(entry, type) {
    const charge = getRuntimeExtra(entry, type);
    return Number(charge?.usdPerUnit ?? charge?.costPerSecond) || 0;
  }

  function getRuntimeExtraCredits(entry, type, units = 1) {
    const charge = getRuntimeExtra(entry, type);
    if (!charge) return 0;
    const multiplier = getRuntimeExtraUnit(entry, type) === "request" ? 1 : Number(units) || 0;
    return (Number(charge.credits) || 0) * multiplier;
  }

  function getRuntimeExtraUsd(entry, type, units = 1) {
    return getRuntimeExtraUsdPerUnit(entry, type) * (getRuntimeExtraUnit(entry, type) === "request" ? 1 : Number(units) || 0);
  }

  return {
    getAllModels,
    getEnabledModels,
    getModelByCanonicalKey,
    resolveModelByAlias,
    getModelsForSurface,
    getQualityTier,
    refreshCache,
    invalidateCache,
    getCachedModel,
    getCachedModels,
    getCachedModelsForSurface,
    getCachedQualityTier,
    getRuntimeModel,
    getRuntimeModels,
    getRuntimeKeys,
    getRuntimeCredit,
    getRuntimeImagePrice,
    getRuntimeVideoPrice,
    getRuntimeExtra,
    getRuntimeExtraUnit,
    getRuntimeExtraUsdPerUnit,
    getRuntimeExtraCredits,
    getRuntimeExtraUsd,
    _isUsable: isUsable,
    _surfacesObject: surfacesObject,
  };
}

module.exports = createModelConfigurationService();
module.exports.createModelConfigurationService = createModelConfigurationService;
module.exports.normalizeKey = normalizeKey;
