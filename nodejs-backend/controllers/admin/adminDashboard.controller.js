const GeneratedMedia = require("../../Module/generatedMedia/generated.media");
const UserProfile = require("../../Module/user/userProfileModel");
const UnifiedCreditController = require("../UnifiedCreditController");
const { buildEffectiveCostStages } = require("../../config/modelAggregation");
const modelConfigurationService = require("../../services/modelConfigurationService");
const MetaLaunchTrace = require("../../Module/adPosting/metaLaunchTrace");
const axios = require("axios");

let amemberProductsCache = null;
let amemberProductsCacheExpiry = 0;

// Date strings of the form "YYYY-MM-DD" represent a whole calendar day. Treat
// `from` as start-of-day UTC and `to` as end-of-day UTC, otherwise a request
// for "today → today" sets both bounds to 00:00:00Z and matches nothing.
// Full ISO timestamps pass through unchanged.
function parseRangeStart(s) {
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(`${s}T00:00:00.000Z`);
  return new Date(s);
}
function parseRangeEnd(s) {
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(`${s}T23:59:59.999Z`);
  return new Date(s);
}

function buildDateMatch(from, to) {
  if (!from && !to) return {};
  const range = {};
  if (from) range.$gte = parseRangeStart(from);
  if (to) range.$lte = parseRangeEnd(to);
  return { createdAt: range };
}

async function addEffectiveGenerationCredits(media) {
  const modelCache = new Map();
  const result = [];

  for (const item of media) {
    const storedCredits = Number(item.credit_deduction) || 0;
    const storedCost = Number(item.cost) || 0;
    if (storedCredits > 0 && storedCost > 0) {
      result.push({
        ...item,
        effective_credit_deduction: storedCredits,
        effective_cost: storedCost,
      });
      continue;
    }

    const modelKey = String(item.model || "").trim();
    if (!modelCache.has(modelKey)) {
      modelCache.set(modelKey, await modelConfigurationService.resolveModelByAlias(modelKey));
    }

    const configuredModel = modelCache.get(modelKey);
    const tiers = Array.isArray(configuredModel?.qualityTiers)
      ? configuredModel.qualityTiers
      : [];
    const requestedQuality = String(item.quality || "").trim().toLowerCase();
    const selectedTier =
      tiers.find((tier) => String(tier.quality).toLowerCase() === requestedQuality) ||
      tiers.reduce(
        (highest, tier) =>
          Number(tier.credits) > Number(highest?.credits || 0) ? tier : highest,
        null,
      );

    const effectiveCredits = item.type === "image"
      ? Number(selectedTier?.credits) || 0
      : storedCredits;
    const effectiveCost = storedCost > 0
      ? storedCost
      : item.type === "image"
        ? modelConfigurationService.getRuntimeImagePrice(configuredModel, item.quality)
        : modelConfigurationService.getRuntimeVideoPrice(configuredModel, item.duration);

    result.push({ ...item, effective_credit_deduction: effectiveCredits, effective_cost: effectiveCost });
  }

  return result;
}

function parseFiniteNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function addNumberRange(match, field, min, max) {
  const range = {};
  const minValue = parseFiniteNumber(min);
  const maxValue = parseFiniteNumber(max);
  if (minValue !== null) range.$gte = minValue;
  if (maxValue !== null) range.$lte = maxValue;
  if (Object.keys(range).length) match[field] = range;
}

function addDateRange(match, field, from, to) {
  if (!from && !to) return;
  const range = {};
  if (from) range.$gte = parseRangeStart(from);
  if (to) range.$lte = parseRangeEnd(to);
  match[field] = range;
}

function toOption(value) {
  return { value, label: value };
}

function normalizeOptionKey(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function addPlanOption(map, value, meta = {}) {
  const label = String(value || "").trim().replace(/\s+/g, " ");
  if (!label) return;
  const key = normalizeOptionKey(label);
  if (!map.has(key)) {
    map.set(key, {
      value: meta.value || `label:${key}`,
      label,
      planIds: [],
      sources: [],
      ...meta,
    });
  }
  const option = map.get(key);
  if (meta.planId && !option.planIds.includes(String(meta.planId))) {
    option.planIds.push(String(meta.planId));
  }
  if (meta.source && !option.sources.includes(meta.source)) {
    option.sources.push(meta.source);
  }
}

function uniqueStringOptions(values) {
  const byLabel = new Map();
  (values || []).forEach((value) => {
    const label = String(value || "").trim().replace(/\s+/g, " ");
    if (!label) return;
    const key = normalizeOptionKey(label);
    if (!byLabel.has(key)) byLabel.set(key, label);
  });
  return Array.from(byLabel.values()).sort((a, b) => a.localeCompare(b)).map(toOption);
}

function buildModelOptionsFromCatalog() {
  return modelConfigurationService
    .getRuntimeModels({ activeOnly: true })
    .map((entry) => ({
      value: entry.canonicalKey,
      label: entry.displayName || entry.label || entry.canonicalKey,
      type: entry.type,
      aliases: modelConfigurationService.getRuntimeKeys(entry),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function modelValuesForFilter(model) {
  const selected = String(model || "").trim();
  if (!selected) return [];
  const entry = modelConfigurationService.getRuntimeModels().find(
    (candidate) =>
      candidate.canonicalKey === selected ||
      normalizeOptionKey(candidate.displayName || candidate.label) === normalizeOptionKey(selected) ||
      modelConfigurationService.getRuntimeKeys(candidate).some((key) => normalizeOptionKey(key) === normalizeOptionKey(selected)),
  );
  return entry ? modelConfigurationService.getRuntimeKeys(entry) : [selected];
}

function normalizeAmemberProducts(data) {
  if (!data) return [];
  const products = Array.isArray(data) ? data : Object.values(data);
  return products.filter((product) => product && typeof product === "object" && product.product_id);
}

async function fetchAmemberProducts() {
  if (amemberProductsCache && Date.now() < amemberProductsCacheExpiry) {
    return amemberProductsCache;
  }
  const apiHost = (process.env.AMEMBER_BASE_API_URL || "https://adsgpt-dev.poweradspy.com/amember/api").replace(/\/+$/, "");
  const apiKey = process.env.AMEMBER_API_KEY;
  const pageSize = 100;
  const allProducts = [];
  let page = 0;
  let pageProducts = [];

  do {
    const res = await axios.get(`${apiHost}/products`, {
      params: { ...(apiKey ? { _key: apiKey } : {}), _count: pageSize, _page: page },
      timeout: 10000,
    });
    pageProducts = normalizeAmemberProducts(res.data);
    allProducts.push(...pageProducts);
    page += 1;
  } while (pageProducts.length === pageSize);

  amemberProductsCache = allProducts;
  amemberProductsCacheExpiry = Date.now() + 5 * 60 * 1000;
  return allProducts;
}
// Exported so other admin controllers (planLimits.controller.js) reuse the
// same fetch + 5-min cache instead of re-implementing the aMember call.
exports.fetchAmemberProducts = fetchAmemberProducts;

function buildPlanOptionsFromProducts(products) {
  const byLabel = new Map();
  products.forEach((product) => {
    const productId = String(product.product_id);
    addPlanOption(byLabel, product.title || product.name || product.product_id, {
      value: `label:${normalizeOptionKey(product.title || product.name || product.product_id)}`,
      planId: productId,
      billingPlanId: product.default_billing_plan_id ? String(product.default_billing_plan_id) : "",
      source: "amember",
      credits: product.credit,
    });
  });
  return byLabel;
}

function addObservedPlanOptions(map, observedPlans) {
  observedPlans.forEach((plan) => {
    addPlanOption(map, plan.value, { source: "profile" });
  });
}

function buildSelectedPlanLabels(products, selectedPlan) {
  const selected = String(selectedPlan || "").trim();
  if (!selected) return new Set();
  if (selected.startsWith("label:")) {
    const selectedLabelKey = selected.slice("label:".length);
    return new Set([selectedLabelKey]);
  }
  const selectedProduct = products.find(
    (product) =>
      String(product.product_id) === selected ||
      normalizeOptionKey(product.title || product.name) === normalizeOptionKey(selected),
  );
  return new Set([
    normalizeOptionKey(selected),
    selectedProduct ? normalizeOptionKey(selectedProduct.title || selectedProduct.name || selectedProduct.product_id) : "",
  ].filter(Boolean));
}

function buildSelectedPlanIds(products, selectedPlan) {
  const selected = String(selectedPlan || "").trim();
  if (!selected) return new Set();
  if (!selected.startsWith("label:")) return new Set([selected]);
  const selectedLabelKey = selected.slice("label:".length);
  return new Set(
    products
      .filter((product) => normalizeOptionKey(product.title || product.name || product.product_id) === selectedLabelKey)
      .map((product) => String(product.product_id)),
  );
}

// GET /admin/overview?from&to
exports.overview = async (req, res) => {
  try {
    const { from, to } = req.query;
    const match = buildDateMatch(from, to);

    const [totalsAgg, byTypeAgg, byModelAgg, dailyAgg, distinctUsers] = await Promise.all([
      GeneratedMedia.aggregate([
        { $match: match },
        ...buildEffectiveCostStages(),
        {
          $group: {
            _id: null,
            generations: { $sum: 1 },
            cost: { $sum: "$effective_cost" },
            credits: { $sum: "$effective_credits" },
          },
        },
      ]),
      GeneratedMedia.aggregate([
        { $match: match },
        ...buildEffectiveCostStages(),
        {
          $group: {
            _id: "$type",
            generations: { $sum: 1 },
            cost: { $sum: "$effective_cost" },
            credits: { $sum: "$effective_credits" },
          },
        },
        { $project: { _id: 0, type: "$_id", generations: 1, cost: { $round: ["$cost", 4] }, credits: 1 } },
      ]),
      GeneratedMedia.aggregate([
        { $match: match },
        ...buildEffectiveCostStages(),
        {
          $group: {
            _id: "$model",
            generations: { $sum: 1 },
            cost: { $sum: "$effective_cost" },
            credits: { $sum: "$effective_credits" },
          },
        },
        { $project: { _id: 0, model: "$_id", generations: 1, cost: { $round: ["$cost", 4] }, credits: 1 } },
        { $sort: { cost: -1 } },
      ]),
      GeneratedMedia.aggregate([
        { $match: match },
        ...buildEffectiveCostStages(),
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
            generations: { $sum: 1 },
            cost: { $sum: "$effective_cost" },
          },
        },
        { $project: { _id: 0, date: "$_id", generations: 1, cost: { $round: ["$cost", 4] } } },
        { $sort: { date: 1 } },
      ]),
      GeneratedMedia.distinct("userId", match),
    ]);

    const totals = totalsAgg[0] || { generations: 0, cost: 0, credits: 0 };
    return res.json({
      success: true,
      range: { from: from || null, to: to || null },
      totals: {
        users: distinctUsers.length,
        generations: totals.generations,
        cost: parseFloat((totals.cost || 0).toFixed(4)),
        credits: totals.credits || 0,
      },
      byType: byTypeAgg,
      byModel: byModelAgg,
      daily: dailyAgg,
    });
  } catch (error) {
    console.error("Admin overview error:", error);
    return res.status(500).json({ success: false, message: "Internal server error", error: error.message });
  }
};

// GET /admin/users/filter-options?from&to
exports.usersFilterOptions = async (req, res) => {
  try {
    const { from, to } = req.query;
    const match = buildDateMatch(from, to);

    const [observedPlans, amemberProductsResult] = await Promise.allSettled([
      UserProfile.aggregate([
        {
          $match: {
            $or: [
              { subscription_plan_name: { $type: "string", $ne: "" } },
              { subscription_plan_id: { $type: "string", $ne: "" } },
            ],
          },
        },
        {
          $group: {
            _id: {
              $cond: [
                { $ne: ["$subscription_plan_name", ""] },
                "$subscription_plan_name",
                "$subscription_plan_id",
              ],
            },
          },
        },
        {
          $project: {
            _id: 0,
            value: "$_id",
            label: "$_id",
          },
        },
        { $sort: { label: 1 } },
      ]),
      fetchAmemberProducts(),
    ]);
    const amemberProducts = amemberProductsResult.status === "fulfilled" ? amemberProductsResult.value : [];
    const planMap = buildPlanOptionsFromProducts(amemberProducts);
    if (amemberProductsResult.status === "rejected") {
      console.warn("[admin users filter-options] aMember products unavailable:", amemberProductsResult.reason?.message || amemberProductsResult.reason);
    }
    if (planMap.size === 0 && observedPlans.status === "fulfilled") {
      addObservedPlanOptions(planMap, observedPlans.value);
    }

    return res.json({
      success: true,
      data: {
        models: buildModelOptionsFromCatalog(),
        plans: Array.from(planMap.values()).sort((a, b) => a.label.localeCompare(b.label)),
      },
    });
  } catch (error) {
    console.error("Admin users filter options error:", error);
    return res.status(500).json({ success: false, message: "Internal server error", error: error.message });
  }
};

// GET /admin/users?from&to&search&sort&page&limit&type&model&plan&generationsMin&generationsMax&creditsMin&creditsMax&costMin&costMax&lastActivityFrom&lastActivityTo
exports.usersList = async (req, res) => {
  try {
    const {
      from,
      to,
      search = "",
      type = "",
      model = "",
      plan = "",
      generationsMin,
      generationsMax,
      creditsMin,
      creditsMax,
      costMin,
      costMax,
      lastActivityFrom,
      lastActivityTo,
      sort = "cost", // cost | generations | credits | recent
      page = 1,
      limit = 20,
    } = req.query;

    const pageNumber = Math.max(1, parseInt(page));
    const limitNumber = Math.min(100, Math.max(1, parseInt(limit)));
    const skip = (pageNumber - 1) * limitNumber;

    const match = buildDateMatch(from, to);
    if (["image", "video"].includes(type)) match.type = type;
    if (model.trim()) match.model = { $in: modelValuesForFilter(model) };

    const aggregateRangeMatch = {};
    addNumberRange(aggregateRangeMatch, "generations", generationsMin, generationsMax);
    addNumberRange(aggregateRangeMatch, "credits", creditsMin, creditsMax);
    addNumberRange(aggregateRangeMatch, "cost", costMin, costMax);
    addDateRange(aggregateRangeMatch, "lastActivity", lastActivityFrom, lastActivityTo);

    const sortField = {
      cost: "cost",
      generations: "generations",
      credits: "credits",
      recent: "lastActivity",
    }[sort] || "cost";

    const aggregated = await GeneratedMedia.aggregate([
      { $match: match },
      ...buildEffectiveCostStages(),
      {
        $group: {
          _id: "$userId",
          generations: { $sum: 1 },
          cost: { $sum: "$effective_cost" },
          credits: { $sum: "$effective_credits" },
          images: { $sum: { $cond: [{ $eq: ["$type", "image"] }, 1, 0] } },
          videos: { $sum: { $cond: [{ $eq: ["$type", "video"] }, 1, 0] } },
          lastActivity: { $max: "$createdAt" },
        },
      },
      {
        $project: {
          _id: 0,
          userId: "$_id",
          generations: 1,
          cost: { $round: ["$cost", 4] },
          credits: 1,
          images: 1,
          videos: 1,
          lastActivity: 1,
        },
      },
      ...(Object.keys(aggregateRangeMatch).length ? [{ $match: aggregateRangeMatch }] : []),
    ]);

    const userIds = aggregated.map((u) => u.userId);
    const profiles = await UserProfile.find(
      { user_id: { $in: userIds } },
      {
        user_id: 1,
        login: 1,
        name: 1,
        name_f: 1,
        name_l: 1,
        email: 1,
        subscription_plan_id: 1,
        subscription_plan_name: 1,
        subscription_expiry: 1,
        created_from: 1,
      },
    ).lean();

    const profileMap = new Map(profiles.map((p) => [p.user_id, p]));
    let merged = aggregated.map((row) => {
      const profile = profileMap.get(row.userId) || {};
      const fullName =
        profile.name ||
        [profile.name_f, profile.name_l].filter(Boolean).join(" ").trim() ||
        profile.login ||
        "";
      return {
        ...row,
        login: profile.login || "",
        name: fullName,
        email: profile.email || "",
        plan: profile.subscription_plan_name || "",
        planId: profile.subscription_plan_id || "",
        createdFrom: profile.created_from || "",
      };
    });

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      merged = merged.filter(
        (r) =>
          r.userId.toLowerCase().includes(q) ||
          r.email.toLowerCase().includes(q) ||
          r.name.toLowerCase().includes(q) ||
          r.login.toLowerCase().includes(q),
      );
    }

    if (plan.trim()) {
      const q = plan.trim();
      const amemberProducts = await fetchAmemberProducts().catch((error) => {
        console.warn("[admin users list] aMember products unavailable for plan matching:", error.message);
        return [];
      });
      const selectedLabels = buildSelectedPlanLabels(amemberProducts, q);
      const selectedPlanIds = buildSelectedPlanIds(amemberProducts, q);
      merged = merged.filter(
        (r) => {
          const rowPlan = String(r.plan || "").trim();
          const rowPlanId = String(r.planId || "").trim();
          return (
            rowPlan === q ||
            rowPlanId === q ||
            selectedPlanIds.has(rowPlanId) ||
            selectedLabels.has(normalizeOptionKey(rowPlan))
          );
        },
      );
    }

    merged.sort((a, b) => {
      const av = a[sortField] ?? 0;
      const bv = b[sortField] ?? 0;
      if (sortField === "lastActivity") {
        return new Date(bv).getTime() - new Date(av).getTime();
      }
      return bv - av;
    });

    const total = merged.length;
    const pageData = merged.slice(skip, skip + limitNumber);

    return res.json({
      success: true,
      page: pageNumber,
      limit: limitNumber,
      total,
      hasMore: skip + pageData.length < total,
      data: pageData,
    });
  } catch (error) {
    console.error("Admin users list error:", error);
    return res.status(500).json({ success: false, message: "Internal server error", error: error.message });
  }
};

// GET /admin/users/:userId?from&to&type&model&page&limit
exports.userDetail = async (req, res) => {
  try {
    const { userId } = req.params;
    const { from, to, type, model, page = 1, limit = 20 } = req.query;

    if (!userId) {
      return res.status(400).json({ success: false, message: "userId is required" });
    }

    const pageNumber = Math.max(1, parseInt(page));
    const limitNumber = Math.min(100, Math.max(1, parseInt(limit)));
    const skip = (pageNumber - 1) * limitNumber;

    const filter = { userId };
    if (type) filter.type = type;
    if (model) filter.model = model;
    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = parseRangeStart(from);
      if (to) filter.createdAt.$lte = parseRangeEnd(to);
    }

    const [profile, creditStatus, media, total, byModel, totals] = await Promise.all([
      UserProfile.findOne({ user_id: userId }).lean(),
      UnifiedCreditController.getCreditStatus(userId).catch(() => null),
      GeneratedMedia.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limitNumber).lean(),
      GeneratedMedia.countDocuments(filter),
      GeneratedMedia.aggregate([
        { $match: { userId, ...(from || to ? { createdAt: filter.createdAt } : {}) } },
        ...buildEffectiveCostStages(),
        {
          $group: {
            _id: "$model",
            generations: { $sum: 1 },
            cost: { $sum: "$effective_cost" },
            credits: { $sum: "$effective_credits" },
          },
        },
        { $project: { _id: 0, model: "$_id", generations: 1, cost: { $round: ["$cost", 4] }, credits: 1 } },
        { $sort: { cost: -1 } },
      ]),
      GeneratedMedia.aggregate([
        { $match: { userId, ...(from || to ? { createdAt: filter.createdAt } : {}) } },
        ...buildEffectiveCostStages(),
        {
          $group: {
            _id: null,
            generations: { $sum: 1 },
            cost: { $sum: "$effective_cost" },
            credits: { $sum: "$effective_credits" },
            images: { $sum: { $cond: [{ $eq: ["$type", "image"] }, 1, 0] } },
            videos: { $sum: { $cond: [{ $eq: ["$type", "video"] }, 1, 0] } },
          },
        },
      ]),
    ]);

    const mediaWithEffectiveCredits = await addEffectiveGenerationCredits(media);
    const summary = totals[0] || { generations: 0, cost: 0, credits: 0, images: 0, videos: 0 };

    return res.json({
      success: true,
      user: profile
        ? {
            userId: profile.user_id,
            login: profile.login,
            name: profile.name || [profile.name_f, profile.name_l].filter(Boolean).join(" ").trim(),
            email: profile.email,
            plan: profile.subscription_plan_name,
            planId: profile.subscription_plan_id,
            planExpiry: profile.subscription_expiry,
            createdFrom: profile.created_from,
            createdAt: profile.createdAt,
          }
        : { userId },
      credits: creditStatus,
      summary: {
        generations: summary.generations,
        cost: parseFloat((summary.cost || 0).toFixed(4)),
        credits: summary.credits || 0,
        images: summary.images || 0,
        videos: summary.videos || 0,
      },
      byModel,
      generations: {
        page: pageNumber,
        limit: limitNumber,
        total,
        hasMore: skip + mediaWithEffectiveCredits.length < total,
        data: mediaWithEffectiveCredits,
      },
    });
  } catch (error) {
    console.error("Admin user detail error:", error);
    return res.status(500).json({ success: false, message: "Internal server error", error: error.message });
  }
};

// GET /admin/meta-launch-trace/:traceId
//
// Look up the exact request body + full Meta error for a failed V2 wizard
// mutation (create/update campaign, ad set, or ad) by the reference code
// shown in the wizard's error banner ("Ref LX-XXXXXXXX · Copy"). Lets
// support reproduce a user-reported launch failure from the code alone —
// see metaAdLauncherV2.js `metaErrorResponse` for the write path and
// Module/adPosting/metaLaunchTrace.js for the schema + 90-day TTL.
exports.getMetaLaunchTrace = async (req, res) => {
  try {
    const { traceId } = req.params;
    if (!traceId) {
      return res.status(400).json({ success: false, message: "traceId is required" });
    }
    const trace = await MetaLaunchTrace.findOne({ traceId }).lean();
    if (!trace) {
      return res.status(404).json({
        success: false,
        message: "No trace found for this reference code — it may have expired (90-day retention) or the code was mistyped.",
      });
    }
    return res.status(200).json({ success: true, trace });
  } catch (error) {
    console.error("Admin meta-launch-trace lookup error:", error);
    return res.status(500).json({ success: false, message: "Internal server error", error: error.message });
  }
};
