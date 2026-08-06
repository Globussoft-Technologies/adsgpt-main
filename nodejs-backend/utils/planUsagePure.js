/**
 * Pure counting logic for planUsage.js, split out so it's unit-testable
 * without requiring metaAdLauncher.js — which pulls in db/redis.js, whose
 * ioredis clients connect eagerly at require-time (same reason
 * utils/metaTableMetrics.js's buildMetricsMap is split from its controller).
 */

// Deleting or archiving a campaign frees a slot against the plan cap — only
// ACTIVE/PAUSED count as "currently managed".
const ACTIVE_CAMPAIGN_STATUSES = new Set(["ACTIVE", "PAUSED"]);

function filterActiveCampaigns(campaigns) {
  return (campaigns || []).filter((c) => ACTIVE_CAMPAIGN_STATUSES.has(c?.status));
}

function sumCounts(counts) {
  return (counts || []).reduce((sum, n) => sum + (Number(n) || 0), 0);
}

module.exports = {
  ACTIVE_CAMPAIGN_STATUSES,
  filterActiveCampaigns,
  sumCounts,
};
