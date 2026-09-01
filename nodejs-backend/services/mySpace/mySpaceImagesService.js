const ImageGeneration = require("../../Module/imageGeneration/imageModel");
const Campaign = require("../../Module/adFactory/adFactory");
const CampaignHistory = require("../../Module/adFactory/adFactoryHistory");
const { assembleAdFactoryImages } = require("../adFactory/adFactoryImagesService");

const ACTIVE_IMAGE_SOURCES = ["adCreative", "adFactory"];

const SOURCE_LABELS = {
  adCreative: "AdCreative",
  adFactory: "AdFactory",
  aiAssistant: "AI Assistant",
  claudeAI: "Claude AI",
};

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseNonNegativeInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function dateToMs(value) {
  return value ? new Date(value).getTime() || 0 : 0;
}

function normalizeStatus(status) {
  if (status === "success") return "completed";
  if (status === "generating") return "processing";
  if (status === "error") return "failed";
  return status || "unknown";
}

function buildDateFilter({ startDate, endDate }) {
  const updatedAt = {};

  if (startDate) {
    const [day, month, year] = String(startDate).split("-");
    updatedAt.$gte = new Date(year, month - 1, day);
  }

  if (endDate) {
    const [day, month, year] = String(endDate).split("-");
    updatedAt.$lte = new Date(year, month - 1, day, 23, 59, 59, 999);
  }

  return Object.keys(updatedAt).length ? { updatedAt } : {};
}

function normalizeAdCreativeRecord(record) {
  const results = record.results || [];
  if (
    results.length === 0 &&
    (record.status === "pending" || record.status === "processing")
  ) {
    const requested = Math.max(1, Number(record.inputs?.numberOfImages) || 1);
    return Array.from({ length: requested }, (_, index) => ({
      id: `${record._id}:pending:${index}`,
      source: "adCreative",
      sourceLabel: SOURCE_LABELS.adCreative,
      imageId: String(record._id),
      resultIndex: index,
      url: "",
      status: record.status,
      prompt: record.inputs?.userPrompt || record.inputs?.prompt || "",
      model: record.inputs?.model || record.model || null,
      modelLabel: record.inputs?.modelLabel || null,
      type: record.inputs?.type || null,
      aspectRatio: record.inputs?.aspectRatio || null,
      createdAt: record.createdAt || null,
      updatedAt: record.updatedAt || null,
      timestamp: record.createdAt || record.updatedAt || null,
      metadata: {
        quality: record.inputs?.quality || null,
        brandName: record.inputs?.brandName || null,
      },
    }));
  }

  // Every result in a batch shares one clock. There are no per-result
  // timestamps on the schema (result.completedAt does not exist), so the old
  // split — record.completedAt for the successes, record.updatedAt for
  // everything else — tore a single batch apart in the sort: the failed tiles
  // outranked their own successful siblings, and any later write to an old
  // record lifted its failures above genuinely newer images.
  const batchTimestamp = record.completedAt || record.createdAt || record.updatedAt;

  return results.map((result, index) => {
    return {
      id: `${record._id}:${index}`,
      source: "adCreative",
      sourceLabel: SOURCE_LABELS.adCreative,
      imageId: String(record._id),
      resultIndex: index,
      url: result.generatedImageUrl || "",
      status: result.status || record.status,
      prompt: result.prompt || record.inputs?.userPrompt || record.inputs?.prompt || "",
      model: record.inputs?.model || record.model || null,
      modelLabel: record.inputs?.modelLabel || null,
      type: record.inputs?.type || null,
      aspectRatio: result.aspectRatio || record.inputs?.aspectRatio || null,
      createdAt: record.createdAt || null,
      updatedAt: record.updatedAt || null,
      timestamp: batchTimestamp,
      metadata: {
        quality: record.inputs?.quality || null,
        brandName: record.inputs?.brandName || null,
      },
    };
  });
}

async function getAdCreativeImages({ userId, startDate, endDate, type, model, status }) {
  const filter = {
    userId,
    ...buildDateFilter({ startDate, endDate }),
  };

  if (type) filter["inputs.type"] = type;
  if (model) filter["inputs.model"] = model;
  if (status) filter.status = status;

  const records = await ImageGeneration.find(filter)
    .sort({ updatedAt: -1 })
    .lean();

  return records.flatMap(normalizeAdCreativeRecord);
}

async function getAdFactoryImages({ userId, startDate, endDate }) {
  const [campaigns, histories] = await Promise.all([
    Campaign.find({ userId })
      .select("metadata.campaignId metadata.campaignName results.image services createdAt updatedAt")
      .lean(),
    CampaignHistory.find({ userId })
      .select("campaignId previousData.metadata.campaignName previousData.results.image previousData.services createdAt updatedAt")
      .lean(),
  ]);

  const result = assembleAdFactoryImages({
    campaigns,
    histories,
    startDate,
    endDate,
    skip: 0,
    limit: Number.MAX_SAFE_INTEGER,
    now: Date.now(),
  });

  return result.data.map((image, index) => ({
    id: `${image.campaignId || "adFactory"}:${image.jobId || image.url || index}`,
    source: "adFactory",
    sourceLabel: SOURCE_LABELS.adFactory,
    url: image.url || "",
    status: normalizeStatus(image.status),
    prompt: image.prompt || "",
    model: image.model || null,
    modelLabel: image.modelLabel || null,
    type: "ad_factory",
    aspectRatio: image.aspectRatio || null,
    createdAt: image.timestamp || null,
    updatedAt: image.timestamp || null,
    timestamp: image.timestamp || null,
    metadata: {
      campaignId: image.campaignId || null,
      campaignName: image.campaignName || null,
      jobId: image.jobId || null,
      origin: image.origin || null,
      error: image.error || null,
    },
  }));
}

const sourceAdapters = {
  adCreative: getAdCreativeImages,
  adFactory: getAdFactoryImages,
  // aiAssistant: getAiAssistantImages,
  // claudeAI: getClaudeAIImages,
};

function resolveRequestedSources(source) {
  if (!source || source === "all") return ACTIVE_IMAGE_SOURCES;
  return ACTIVE_IMAGE_SOURCES.includes(source) ? [source] : null;
}

function buildCounts(images) {
  return images.reduce(
    (acc, image) => {
      acc.bySource[image.source] = (acc.bySource[image.source] || 0) + 1;
      acc.byStatus[image.status] = (acc.byStatus[image.status] || 0) + 1;
      return acc;
    },
    { bySource: {}, byStatus: {} },
  );
}

function matchesOptionalFilters(image, { type, model, status }) {
  if (type && image.type !== type) return false;
  if (model && image.model !== model) return false;
  if (status && image.status !== normalizeStatus(status)) return false;
  return true;
}

async function getMySpaceImages({
  userId,
  source = "all",
  skip = 0,
  limit = 20,
  startDate,
  endDate,
  type,
  model,
  status,
} = {}) {
  const requestedSources = resolveRequestedSources(source);
  if (!requestedSources) {
    const allowed = ["all", ...ACTIVE_IMAGE_SOURCES].join(", ");
    const error = new Error(`Invalid source. Allowed values: ${allowed}`);
    error.statusCode = 400;
    throw error;
  }

  const safeSkip = parseNonNegativeInt(skip, 0);
  const safeLimit = parsePositiveInt(limit, 20);

  const sourceResults = await Promise.all(
    requestedSources.map(async (sourceName) => {
      const adapter = sourceAdapters[sourceName];
      const data = await adapter({
        userId,
        startDate,
        endDate,
        type,
        model,
        status,
      });
      return { source: sourceName, data };
    }),
  );

  const allImages = sourceResults
    .flatMap((result) => result.data)
    .filter((image) => matchesOptionalFilters(image, { type, model, status }));
  allImages.sort((a, b) => dateToMs(b.timestamp || b.updatedAt) - dateToMs(a.timestamp || a.updatedAt));

  return {
    source,
    sources: requestedSources,
    total: allImages.length,
    totalCount: allImages.length,
    skip: safeSkip,
    limit: safeLimit,
    counts: buildCounts(allImages),
    data: allImages.slice(safeSkip, safeSkip + safeLimit),
  };
}

module.exports = {
  ACTIVE_IMAGE_SOURCES,
  SOURCE_LABELS,
  getMySpaceImages,
};
