const GeneratedMedia = require("../Module/generatedMedia/generated.media");
const TokenUsage = require("../Module/tokenUsage/tokenUsage");
const AnalyticsEvent = require("../Module/analytics/AnalyticsEvent");
const Campaign = require("../Module/adFactory/adFactory");
const ManagedCampaign = require("../Module/adPosting/managedCampaign");
const History = require("../Module/newHistory/newHistory");
const BrandsList = require("../Module/brandNames/brandNamesSchema");
const MetaChatSession = require("../Module/metaChat/metaChatSession");
const GooglePostedAd = require("../Module/adPosting/googlePostedAds");

const PRODUCT_PAGE_PATTERN = /^\/(?:adstudio|assistant|adfactory|brandiq|ads-manager|meta-ads|google-ads|tiktok-ads|autopilot|my-space|ad-library|adinsights|landing-page-analyzer)(?:\/|$)/;

const defaultModels = {
  GeneratedMedia,
  TokenUsage,
  AnalyticsEvent,
  Campaign,
  ManagedCampaign,
  History,
  BrandsList,
  MetaChatSession,
  GooglePostedAd,
};

function buildDateRange(from, to) {
  if (!from && !to) return null;
  const range = {};
  if (from) range.$gte = /^\d{4}-\d{2}-\d{2}$/.test(from) ? new Date(`${from}T00:00:00.000Z`) : new Date(from);
  if (to) range.$lte = /^\d{4}-\d{2}-\d{2}$/.test(to) ? new Date(`${to}T23:59:59.999Z`) : new Date(to);
  return range;
}

function dateQuery(field, range) {
  return range ? { [field]: range } : {};
}

function idsFromGroupedRows(rows) {
  return rows.map((row) => row?._id).filter((value) => value !== null && value !== undefined);
}

function addIdentityVariants(target, value) {
  const id = String(value || "").trim();
  if (!id) return;
  target.add(id);
  const gptMatch = /^GPT-(\d+)$/.exec(id);
  if (gptMatch) target.add(gptMatch[1]);
  else if (/^\d+$/.test(id)) target.add(`GPT-${id}`);
}

function isActiveUser(row, profile, activeUserIds) {
  const candidates = new Set();
  addIdentityVariants(candidates, row?.userId);
  addIdentityVariants(candidates, profile?.user_id);
  addIdentityVariants(candidates, profile?.amember_user_id);
  return Array.from(candidates).some((candidate) => activeUserIds.has(candidate));
}

// "all" always applies. The two filtered views share one guard: a failed source
// drops its users out of the active set, which merely hides rows in the active
// view but would present genuinely active users as dormant once inverted - so
// neither runs unless every source reported.
function resolveActivityView(activityView, failedSources = []) {
  const view = ["active", "inactive"].includes(activityView) ? activityView : "all";
  const available = failedSources.length === 0;
  return {
    view,
    available,
    applied: view === "all" ? true : available,
    failedSources,
  };
}

// "active" and "inactive" partition the same population: every row lands in
// exactly one, so the two views can never both show - or both omit - a user.
function filterRowsByActivityView({ rows, profileMap, activeUserIds, view }) {
  if (view !== "active" && view !== "inactive") return rows;
  const wantActive = view === "active";
  return rows.filter(
    (row) => isActiveUser(row, profileMap?.get(row.userId), activeUserIds) === wantActive,
  );
}

function numberInRange(value, min, max) {
  const number = Number(value || 0);
  if (min !== undefined && min !== "" && number < Number(min)) return false;
  if (max !== undefined && max !== "" && number > Number(max)) return false;
  return true;
}

function dateInRange(value, from, to) {
  if (!from && !to) return true;
  if (!value) return false;
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return false;
  const start = from ? buildDateRange(from, null).$gte.getTime() : null;
  const end = to ? buildDateRange(null, to).$lte.getTime() : null;
  return (start === null || timestamp >= start) && (end === null || timestamp <= end);
}

function matchesActivityFilters(row, filters = {}) {
  return (
    numberInRange(row.generations, filters.generationsMin, filters.generationsMax) &&
    numberInRange(row.credits, filters.creditsMin, filters.creditsMax) &&
    numberInRange(row.cost, filters.costMin, filters.costMax) &&
    dateInRange(row.lastActivity, filters.lastActivityFrom, filters.lastActivityTo)
  );
}

async function findActiveUserIds({ from, to, models = defaultModels, logger = console } = {}) {
  const range = buildDateRange(from, to);
  const sources = [
    ["generated_media", () => models.GeneratedMedia.distinct("userId", dateQuery("createdAt", range))],
    ["token_usage", () => models.TokenUsage.distinct("userId", dateQuery("createdAt", range))],
    ["campaign_created", () => models.Campaign.distinct("userId", dateQuery("createdAt", range))],
    ["managed_campaign", () => models.ManagedCampaign.distinct("userId", dateQuery("createdAt", range))],
    ["ad_studio_history", () => models.History.distinct("userId", dateQuery("createdAt", range))],
    ["meta_chat", () => models.MetaChatSession.distinct("userId", dateQuery("updatedAt", range))],
    ["google_ad_posted", () => models.GooglePostedAd.distinct("userId", dateQuery("createdAt", range))],
    [
      "product_page_usage",
      async () => idsFromGroupedRows(await models.AnalyticsEvent.aggregate([
        { $unwind: "$events" },
        {
          $match: {
            "events.type": "page_view",
            "events.page": PRODUCT_PAGE_PATTERN,
            "events.time_spent": { $gt: 0 },
            ...dateQuery("events.timestamp", range),
          },
        },
        { $group: { _id: "$user_id" } },
      ])),
    ],
    [
      "brand_created",
      async () => idsFromGroupedRows(await models.BrandsList.aggregate([
        { $unwind: "$brands" },
        { $match: dateQuery("brands.createdAt", range) },
        { $group: { _id: "$user_id" } },
      ])),
    ],
  ];

  const settled = await Promise.allSettled(
    sources.map(([, load]) => Promise.resolve().then(load)),
  );
  const activeUserIds = new Set();
  const failedSources = [];

  settled.forEach((result, index) => {
    const source = sources[index][0];
    if (result.status === "rejected") {
      failedSources.push(source);
      logger.warn(`[admin users activity] ${source} unavailable:`, result.reason?.message || result.reason);
      return;
    }
    (result.value || []).forEach((userId) => addIdentityVariants(activeUserIds, userId));
  });

  return { activeUserIds, failedSources };
}

module.exports = {
  filterRowsByActivityView,
  findActiveUserIds,
  isActiveUser,
  resolveActivityView,
  matchesActivityFilters,
  _internals: {
    PRODUCT_PAGE_PATTERN,
    addIdentityVariants,
    buildDateRange,
    idsFromGroupedRows,
  },
};
