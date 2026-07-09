const bizSdk = require("facebook-nodejs-business-sdk");
const Ad = bizSdk.Ad;
const AdSet = bizSdk.AdSet;
const Campaign = bizSdk.Campaign;
const { formatBudget } = require("./formatBudget");

function getAdFields() {
  return [
    Ad.Fields.id,
    Ad.Fields.name,
    Ad.Fields.status,
    Ad.Fields.effective_status,
    Ad.Fields.adset_id,
    Ad.Fields.campaign_id,
    Ad.Fields.account_id,
    Ad.Fields.created_time,
    Ad.Fields.updated_time,
    Ad.Fields.creative +
      "{id,name,account_id,object_type,thumbnail_url,thumbnail_id,image_url,image_hash,video_id,body,title,call_to_action_type,object_story_spec,asset_feed_spec,link_url,effective_object_story_id,url_tags,instagram_permalink_url}",
    Ad.Fields.bid_amount,
    Ad.Fields.ad_active_time,
    Ad.Fields.ad_schedule_start_time,
    Ad.Fields.ad_schedule_end_time,
    Ad.Fields.bid_info,
    Ad.Fields.bid_type,
    Ad.Fields.conversion_specs,
  ];
}

function getAdSetFields() {
  return [
    AdSet.Fields.id,
    AdSet.Fields.name,
    AdSet.Fields.status,
    AdSet.Fields.daily_budget,
    AdSet.Fields.lifetime_budget,
    AdSet.Fields.budget_remaining,
    AdSet.Fields.start_time,
    AdSet.Fields.end_time,
    AdSet.Fields.billing_event,
    AdSet.Fields.optimization_goal,
  ];
}

function getCampaignFields() {
  return [
    Campaign.Fields.id,
    Campaign.Fields.name,
    Campaign.Fields.status,
    Campaign.Fields.objective,
    Campaign.Fields.daily_budget,
    Campaign.Fields.lifetime_budget,
    Campaign.Fields.budget_remaining,
    Campaign.Fields.start_time,
    Campaign.Fields.stop_time,
    // Needed by the management "Add Ad Set" flow so the new ad set inherits
    // the campaign's bid strategy (a CBO campaign with a capped strategy
    // requires a bid_amount on its ad sets) and special ad categories
    // (which constrain ad-set targeting).
    Campaign.Fields.bid_strategy,
    Campaign.Fields.special_ad_categories,
  ];
}

function getInsightsFields() {
  return [
    "account_id",
    "campaign_id",
    "campaign_name",
    "adset_id",
    "adset_name",
    "ad_id",
    "ad_name",

    "impressions",
    "reach",
    "frequency",

    "clicks",
    "unique_clicks",
    "ctr",
    "unique_ctr",
    "cpc",

    "spend",
    "cpm",
    "cpp",

    "actions",
    "action_values",
    "cost_per_action_type",

    "conversions",
    "conversion_values",

    "video_play_actions",
    "video_p25_watched_actions",
    "video_p50_watched_actions",
    "video_p75_watched_actions",
    "video_p95_watched_actions",
    "video_p100_watched_actions",
    "video_avg_time_watched_actions",

    "outbound_clicks",
    "outbound_clicks_ctr",

    "cost_per_outbound_click",

    "purchase_roas",
    "website_purchase_roas",

    "date_start",
    "date_stop",
  ];
}

// formatBudget is re-exported from ./formatBudget for backward compat; the
// canonical implementation lives there so modules that want only the
// formatter don't have to pull the Meta SDK transitively.

// Cursor-pagination helper for the Meta SDK. Meta's edges default to 25
// items per call — accounts routinely have more campaigns / ad sets / ads
// than that, so a single SDK call truncates the list. Pass the first-page
// cursor (e.g. `account.getCampaigns(fields, { limit: 100 })`) and this
// walks the rest. 50-page safety cap (= 5000 items) prevents a malformed
// cursor from looping forever.
async function fetchAllPaged(firstPageCursor) {
  let cursor = await firstPageCursor;
  const items = [...cursor];
  let pages = 1;
  while (
    typeof cursor?.hasNext === "function" &&
    cursor.hasNext() &&
    pages < 50
  ) {
    cursor = await cursor.next();
    items.push(...cursor);
    pages += 1;
  }
  return items;
}

module.exports = {
  formatBudget,
  getAdFields,
  getAdSetFields,
  getCampaignFields,
  getInsightsFields,
  fetchAllPaged,
};
