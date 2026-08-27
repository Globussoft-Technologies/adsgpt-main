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
    // Delivery errors, kept separate from Meta's optimisation suggestions so
    // the UI never labels a blocking problem as a suggestion. The suggestions
    // themselves are NOT readable here — see utils/metaRecommendations.js for
    // why the per-object `recommendations` field is a silent no-op.
    Ad.Fields.issues_info,
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
    AdSet.Fields.issues_info,
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
    Campaign.Fields.issues_info,
  ];
}

// Nested Marketing API objects are sometimes returned as plain objects and
// sometimes as SDK AbstractCrudObject instances whose payload lives in `_data`.
// Keep the HTTP response stable for the frontend in both cases.
function plainMetaList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(Boolean)
    .map((item) =>
      item && typeof item === "object" && item._data ? item._data : item,
    );
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

/**
 * getAutopilotInsightsFields — the SLIM field list for the Autopilot cron.
 *
 * `getInsightsFields()` above returns ~35 fields and is shared by seven
 * consumers (Ads Manager tables, partner API, LLM audit, metrics catalog),
 * several of which genuinely need video and outbound metrics. It must not be
 * trimmed in place.
 *
 * The cron does not. `metaAuditService`'s normalisers read exactly these
 * fields and nothing else, so everything omitted here was previously fetched,
 * parsed and discarded:
 *
 *   video_play_actions, video_p25/p50/p75/p95/p100_watched_actions,
 *   video_avg_time_watched_actions, action_values, conversions,
 *   conversion_values, outbound_clicks, outbound_clicks_ctr,
 *   cost_per_outbound_click, unique_clicks, unique_ctr, reach, cpp,
 *   website_purchase_roas, account_id
 *
 * That matters because Business Use Case rate limits meter `total_cputime`,
 * not just call count — and video breakdowns plus action-value aggregation
 * are among the most expensive things Meta computes. Requesting them for data
 * nobody reads is what let a handful of calls exhaust an account's CPU budget
 * while the App Dashboard still showed the call bucket almost untouched.
 *
 * If a normaliser ever starts reading a new raw field, add it HERE too or the
 * derived value silently becomes 0/undefined — the evaluator fails conditions
 * closed on missing fields, so the symptom is a rule that quietly stops
 * matching rather than an error.
 */
function getAutopilotInsightsFields() {
  return [
    // Identity — needed to join insight rows back to entities.
    "campaign_id",
    "campaign_name",
    "adset_id",
    "adset_name",
    "ad_id",
    "ad_name",

    // Cheap scalars. Kept unconditionally even when no rule references them,
    // because they are what `metricsSnapshot` puts in the action log and the
    // alert emails ("spend Rs56.89 - ctr 1.77% - impr 283"). Dropping them to
    // save CPU would make every "why was this paused?" answer worse for no
    // meaningful saving.
    "impressions",
    "clicks",
    "ctr",
    "cpc",
    "cpm",
    "spend",
    "frequency",

    // The expensive three. `actions` and `cost_per_action_type` drive
    // purchases / installs / cpa / cpi; `purchase_roas` drives roas.
    "actions",
    "cost_per_action_type",
    "purchase_roas",
  ];
}

module.exports = {
  formatBudget,
  getAdFields,
  getAdSetFields,
  getCampaignFields,
  getInsightsFields,
  getAutopilotInsightsFields,
  fetchAllPaged,
  plainMetaList,
};
