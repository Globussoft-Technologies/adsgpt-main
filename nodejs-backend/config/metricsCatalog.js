/**
 * Selectable-metrics catalog for the Meta Ads Analytics dashboard.
 *
 * Single source of truth — mirrors the wizardSchema.js convention (config,
 * not scattered if/else across controllers/components). getAnalyticsData()
 * and AnalyticsPanel both walk this catalog generically instead of
 * hardcoding fields.
 *
 * Two entry `kind`s:
 *   - 'scalar'      — a flat numeric field Meta returns directly on the
 *                      insights row (e.g. `spend`, `ctr`).
 *   - 'action_list' — Meta returns these fields (`actions`, `action_values`,
 *                      `cost_per_action_type`, `conversions`,
 *                      `conversion_values`, `purchase_roas`,
 *                      `website_purchase_roas`) as an ARRAY of
 *                      `{ action_type, value }` objects, not a flat number.
 *                      Each selectable "metric" here is really one
 *                      (metaField, actionType) pair extracted from that
 *                      array.
 *
 * COVERAGE: every documented Meta standard action_type (see ACTION_TYPES
 * below) is expanded — via buildActionListEntries() — into its count
 * (`actions.<id>`), value (`action_values.<id>`), and cost
 * (`cost_per_action_type.<id>`) entries, plus `conversions`/
 * `conversion_values` for conversion-trackable types and ROAS for
 * purchase-shaped types. This is deliberately generative (one small
 * ACTION_TYPES table + a loop) rather than ~200 hand-written literals — add
 * a new Meta action_type by adding ONE row to ACTION_TYPES, not by writing
 * 3-7 catalog entries by hand.
 *
 * This is a STATIC, code-committed list, not runtime discovery from a given
 * account's data — Meta's action_type taxonomy is a bounded, documented set
 * (unlike an account's campaigns, which change constantly), so a static list
 * built from that taxonomy gives full coverage without the picker's option
 * list reshuffling per account/date-range (see gotchas.md — dynamic
 * per-account discovery was considered and rejected for exactly this
 * instability).
 *
 * All fields referenced here (`metaField`) must be present in
 * utils/metaHelpers.js's getInsightsFields() — extractMetricValue() assumes
 * the raw insights row already has them.
 */

// Every Meta standard action_type we know of, grouped for the picker's
// collapsible sections. `conversionEligible` marks types that also appear
// under the `conversions`/`conversion_values` fields (pixel/CAPI-attributed
// conversions, roughly the commerce/lead/app funnel — not passive engagement
// actions like link clicks). `roasEligible` marks purchase-shaped types that
// also appear under `purchase_roas`/`website_purchase_roas`.
const ACTION_TYPES = [
  // ─── Engagement ─────────────────────────────────────────────────────────
  { id: "link_click", label: "Link Clicks", singular: "Link Click", group: "engagement", icon: "MousePointerClick" },
  { id: "landing_page_view", label: "Landing Page Views", singular: "Landing Page View", group: "engagement", icon: "Eye" },
  { id: "page_engagement", label: "Page Engagements", singular: "Page Engagement", group: "engagement", icon: "ThumbsUp" },
  { id: "post_engagement", label: "Post Engagements", singular: "Post Engagement", group: "engagement", icon: "ThumbsUp" },
  { id: "post_reaction", label: "Post Reactions", singular: "Post Reaction", group: "engagement", icon: "ThumbsUp" },
  { id: "like", label: "Page Likes", singular: "Page Like", group: "engagement", icon: "ThumbsUp" },
  { id: "comment", label: "Comments", singular: "Comment", group: "engagement", icon: "MessageCircle" },
  { id: "post", label: "Post Shares", singular: "Post Share", group: "engagement", icon: "Share2" },
  { id: "post_save", label: "Post Saves", singular: "Post Save", group: "engagement", icon: "Share2" },
  { id: "photo_view", label: "Photo Views", singular: "Photo View", group: "engagement", icon: "Eye" },
  { id: "video_view", label: "Video Views", singular: "Video View", group: "engagement", icon: "Play" },
  { id: "event_responses", label: "Event Responses", singular: "Event Response", group: "engagement", icon: "ThumbsUp" },

  // ─── Messaging ──────────────────────────────────────────────────────────
  { id: "onsite_conversion.messaging_conversation_started_7d", label: "Messaging Conversations Started", singular: "Messaging Conversation Started", group: "messaging", icon: "MessageCircle" },
  { id: "onsite_conversion.messaging_first_reply", label: "Messaging First Replies", singular: "Messaging First Reply", group: "messaging", icon: "MessageCircle" },
  { id: "onsite_conversion.messaging_welcome_message_view", label: "Messaging Welcome Views", singular: "Messaging Welcome View", group: "messaging", icon: "MessageCircle" },
  { id: "onsite_conversion.messaging_user_depth_2_message_send", label: "Messaging Deeper Conversations", singular: "Messaging Deeper Conversation", group: "messaging", icon: "MessageCircle" },
  { id: "onsite_conversion.messaging_block", label: "Messaging Blocks", singular: "Messaging Block", group: "messaging", icon: "MessageCircle" },

  // ─── Leads / Registration ───────────────────────────────────────────────
  { id: "lead", label: "Leads", singular: "Lead", group: "leads", icon: "UserPlus", conversionEligible: true },
  { id: "complete_registration", label: "Registrations Completed", singular: "Registration", group: "leads", icon: "UserPlus", conversionEligible: true },
  { id: "contact", label: "Contacts", singular: "Contact", group: "leads", icon: "UserPlus", conversionEligible: true },
  { id: "subscribe", label: "Subscriptions", singular: "Subscription", group: "leads", icon: "UserPlus", conversionEligible: true },
  { id: "submit_application", label: "Applications Submitted", singular: "Application", group: "leads", icon: "UserPlus", conversionEligible: true },
  { id: "schedule", label: "Appointments Scheduled", singular: "Appointment", group: "leads", icon: "UserPlus", conversionEligible: true },
  { id: "start_trial", label: "Trials Started", singular: "Trial", group: "leads", icon: "UserPlus", conversionEligible: true },
  { id: "find_location", label: "Location Searches", singular: "Location Search", group: "leads", icon: "UserPlus" },

  // ─── Commerce ───────────────────────────────────────────────────────────
  // NOTE the `types` arrays: Meta reports several conversions under BOTH a
  // legacy single-surface action_type AND an `omni_*` omnichannel-aware one,
  // and for most campaigns those are the SAME conversions counted twice.
  // See the max-not-sum rationale on extractMetricValue below.
  { id: "purchase", types: ["purchase", "omni_purchase"], label: "Purchases", singular: "Purchase", group: "commerce", icon: "ShoppingCart", conversionEligible: true, roasEligible: true },
  { id: "add_to_cart", types: ["add_to_cart", "omni_add_to_cart"], label: "Adds to Cart", singular: "Add to Cart", group: "commerce", icon: "ShoppingCart", conversionEligible: true },
  { id: "initiate_checkout", types: ["initiate_checkout", "omni_initiated_checkout"], label: "Checkouts Initiated", singular: "Checkout", group: "commerce", icon: "ShoppingCart", conversionEligible: true },
  { id: "add_payment_info", label: "Payment Info Added", singular: "Payment Info Add", group: "commerce", icon: "ShoppingCart", conversionEligible: true },
  { id: "add_to_wishlist", types: ["add_to_wishlist", "omni_add_to_wishlist"], label: "Adds to Wishlist", singular: "Add to Wishlist", group: "commerce", icon: "ShoppingCart", conversionEligible: true },
  { id: "view_content", types: ["view_content", "omni_view_content"], label: "Content Views", singular: "Content View", group: "commerce", icon: "Eye", conversionEligible: true },
  { id: "search", types: ["search", "omni_search"], label: "Searches", singular: "Search", group: "commerce", icon: "MousePointerClick", conversionEligible: true },
  { id: "donate", label: "Donations", singular: "Donation", group: "commerce", icon: "ShoppingCart", conversionEligible: true },
  { id: "customize_product", label: "Products Customized", singular: "Product Customization", group: "commerce", icon: "ShoppingCart" },
  // Legacy pixel-prefixed names — same funnel, older field naming Meta still
  // returns for accounts with long-running pixels.
  { id: "offsite_conversion.fb_pixel_purchase", label: "Website Purchases (Pixel)", singular: "Website Purchase (Pixel)", group: "commerce", icon: "ShoppingCart", conversionEligible: true, roasEligible: true },
  { id: "offsite_conversion.fb_pixel_lead", label: "Website Leads (Pixel)", singular: "Website Lead (Pixel)", group: "commerce", icon: "UserPlus", conversionEligible: true },
  { id: "offsite_conversion.fb_pixel_add_to_cart", label: "Website Adds to Cart (Pixel)", singular: "Website Add to Cart (Pixel)", group: "commerce", icon: "ShoppingCart", conversionEligible: true },
  { id: "offsite_conversion.fb_pixel_view_content", label: "Website Content Views (Pixel)", singular: "Website Content View (Pixel)", group: "commerce", icon: "Eye", conversionEligible: true },
  { id: "offsite_conversion.fb_pixel_initiate_checkout", label: "Website Checkouts (Pixel)", singular: "Website Checkout (Pixel)", group: "commerce", icon: "ShoppingCart", conversionEligible: true },
  { id: "offsite_conversion.fb_pixel_complete_registration", label: "Website Registrations (Pixel)", singular: "Website Registration (Pixel)", group: "commerce", icon: "UserPlus", conversionEligible: true },
  { id: "offsite_conversion.fb_pixel_search", label: "Website Searches (Pixel)", singular: "Website Search (Pixel)", group: "commerce", icon: "MousePointerClick", conversionEligible: true },
  { id: "offsite_conversion.fb_pixel_custom", label: "Website Custom Conversions (Pixel)", singular: "Website Custom Conversion (Pixel)", group: "commerce", icon: "ShoppingCart", conversionEligible: true },

  // ─── App (App Promotion objective) ──────────────────────────────────────
  // mobile_app_install + omni_app_install are the same installs reported
  // twice — this pairing is what made "Cost per App Install" read ₹0 while
  // Ads Manager showed a real number (Meta had populated the omni variant
  // only). Identical dedup logic to metaAuditService.js's getInstallCount /
  // getCpi, which hit and fixed this first.
  { id: "mobile_app_install", types: ["mobile_app_install", "omni_app_install"], label: "App Installs", singular: "App Install", group: "app", icon: "Smartphone", conversionEligible: true },
  { id: "app_custom_event", label: "App Custom Events", singular: "App Custom Event", group: "app", icon: "Smartphone", conversionEligible: true },
  { id: "app_use", label: "App Re-engagements", singular: "App Re-engagement", group: "app", icon: "Smartphone" },
  { id: "mobile_app_purchase", label: "In-App Purchases", singular: "In-App Purchase", group: "app", icon: "Smartphone", conversionEligible: true, roasEligible: true },
  { id: "mobile_app_complete_registration", label: "App Registrations", singular: "App Registration", group: "app", icon: "Smartphone", conversionEligible: true },

  // ─── Offline conversions ────────────────────────────────────────────────
  { id: "offline_conversion.purchase", label: "Offline Purchases", singular: "Offline Purchase", group: "offline", icon: "ShoppingCart", conversionEligible: true, roasEligible: true },
  { id: "offline_conversion.lead", label: "Offline Leads", singular: "Offline Lead", group: "offline", icon: "UserPlus", conversionEligible: true },
];

// Video watch metrics are action-list-shaped but effectively single-action
// (`video_view`) — no per-action-type sub-picker needed, so these stay as
// hand-written entries rather than going through the ACTION_TYPES loop.
const VIDEO_ENTRIES = [
  { key: "video_play_actions", label: "Video Plays", group: "video", kind: "action_list", metaField: "video_play_actions", actionTypes: ["video_view"], format: "integer", defaultVisible: false, icon: "Play" },
  { key: "video_p25_watched_actions", label: "Video Watched 25%", group: "video", kind: "action_list", metaField: "video_p25_watched_actions", actionTypes: ["video_view"], format: "integer", defaultVisible: false, icon: "Play" },
  { key: "video_p50_watched_actions", label: "Video Watched 50%", group: "video", kind: "action_list", metaField: "video_p50_watched_actions", actionTypes: ["video_view"], format: "integer", defaultVisible: false, icon: "Play" },
  { key: "video_p75_watched_actions", label: "Video Watched 75%", group: "video", kind: "action_list", metaField: "video_p75_watched_actions", actionTypes: ["video_view"], format: "integer", defaultVisible: false, icon: "Play" },
  { key: "video_p95_watched_actions", label: "Video Watched 95%", group: "video", kind: "action_list", metaField: "video_p95_watched_actions", actionTypes: ["video_view"], format: "integer", defaultVisible: false, icon: "Play" },
  { key: "video_p100_watched_actions", label: "Video Watched 100%", group: "video", kind: "action_list", metaField: "video_p100_watched_actions", actionTypes: ["video_view"], format: "integer", defaultVisible: false, icon: "Play" },
  { key: "video_avg_time_watched_actions", label: "Avg. Video Watch Time (s)", group: "video", kind: "action_list", metaField: "video_avg_time_watched_actions", actionTypes: ["video_view"], format: "decimal2", defaultVisible: false, icon: "Clock" },
];

const SCALAR_ENTRIES = [
  { key: "spend", label: "Spend", group: "performance", kind: "scalar", metaField: "spend", format: "currency", defaultVisible: true, icon: "DollarSign" },
  { key: "impressions", label: "Impressions", group: "performance", kind: "scalar", metaField: "impressions", format: "integer", defaultVisible: true, icon: "Eye" },
  { key: "clicks", label: "Clicks", group: "performance", kind: "scalar", metaField: "clicks", format: "integer", defaultVisible: true, icon: "MousePointerClick" },
  { key: "reach", label: "Reach", group: "performance", kind: "scalar", metaField: "reach", format: "integer", defaultVisible: true, icon: "Users" },
  { key: "ctr", label: "CTR", group: "performance", kind: "scalar", metaField: "ctr", format: "percent", defaultVisible: true, icon: "TrendingUp" },
  { key: "cpc", label: "CPC", group: "performance", kind: "scalar", metaField: "cpc", format: "currency", defaultVisible: true, icon: "Activity" },
  { key: "cpm", label: "CPM", group: "performance", kind: "scalar", metaField: "cpm", format: "currency", defaultVisible: true, icon: "Zap" },
  { key: "frequency", label: "Frequency", group: "performance", kind: "scalar", metaField: "frequency", format: "decimal2", defaultVisible: true, icon: "Radio" },
  { key: "cpp", label: "Cost per 1,000 People Reached", group: "performance", kind: "scalar", metaField: "cpp", format: "currency", defaultVisible: false, icon: "Users" },
  { key: "unique_clicks", label: "Unique Clicks", group: "performance", kind: "scalar", metaField: "unique_clicks", format: "integer", defaultVisible: false, icon: "MousePointerClick" },
  { key: "unique_ctr", label: "Unique CTR", group: "performance", kind: "scalar", metaField: "unique_ctr", format: "percent", defaultVisible: false, icon: "TrendingUp" },
  { key: "outbound_clicks_ctr", label: "Outbound CTR", group: "performance", kind: "scalar", metaField: "outbound_clicks_ctr", format: "percent", defaultVisible: false, icon: "TrendingUp" },
  { key: "cost_per_outbound_click", label: "Cost per Outbound Click", group: "performance", kind: "scalar", metaField: "cost_per_outbound_click", format: "currency", defaultVisible: false, icon: "Activity" },
];

// Expand ACTION_TYPES into the full set of action-list catalog entries —
// count / value / cost for every type, plus conversions/conversion_values
// and ROAS for the types flagged eligible. This is what gives "all possible
// metrics" coverage without hand-writing every combination.
function buildActionListEntries() {
  const entries = [];
  for (const at of ACTION_TYPES) {
    // Every generated entry carries the SAME `types` list so a metric and
    // its cost/value/conversion siblings all dedup identically — the
    // asymmetry we shipped first (count reading one action_type, cost
    // reading another) is exactly what produced "1,262 installs / ₹0 CPI".
    const actionTypes = at.types || [at.id];
    entries.push({
      key: `actions.${at.id}`, label: at.label, group: at.group, kind: "action_list",
      metaField: "actions", actionTypes, format: "integer", defaultVisible: false, icon: at.icon,
    });
    entries.push({
      key: `action_values.${at.id}`, label: `${at.label} Value`, group: at.group, kind: "action_list",
      metaField: "action_values", actionTypes, format: "currency", defaultVisible: false, icon: at.icon,
    });
    entries.push({
      key: `cost_per_action_type.${at.id}`, label: `Cost per ${at.singular}`, group: at.group, kind: "action_list",
      metaField: "cost_per_action_type", actionTypes, format: "currency", defaultVisible: false, icon: at.icon,
    });
    if (at.conversionEligible) {
      entries.push({
        key: `conversions.${at.id}`, label: `${at.label} (Conversions)`, group: at.group, kind: "action_list",
        metaField: "conversions", actionTypes, format: "integer", defaultVisible: false, icon: at.icon,
      });
      entries.push({
        key: `conversion_values.${at.id}`, label: `${at.label} Value (Conversions)`, group: at.group, kind: "action_list",
        metaField: "conversion_values", actionTypes, format: "currency", defaultVisible: false, icon: at.icon,
      });
    }
    if (at.roasEligible) {
      entries.push({
        key: `purchase_roas.${at.id}`, label: `ROAS (${at.label})`, group: "roas", kind: "action_list",
        metaField: "purchase_roas", actionTypes, format: "ratio", defaultVisible: false, icon: "TrendingUp",
      });
      entries.push({
        key: `website_purchase_roas.${at.id}`, label: `Website ROAS (${at.label})`, group: "roas", kind: "action_list",
        metaField: "website_purchase_roas", actionTypes, format: "ratio", defaultVisible: false, icon: "TrendingUp",
      });
    }
  }
  return entries;
}

// Computed once at module load — the catalog is static, no reason to rebuild
// the generated action-list entries on every call.
const CATALOG = [...SCALAR_ENTRIES, ...VIDEO_ENTRIES, ...buildActionListEntries()];

function getMetricsCatalog() {
  return CATALOG;
}

function getDefaultVisibleKeys() {
  return CATALOG.filter((m) => m.defaultVisible).map((m) => m.key);
}

// Given one catalog entry and a raw Meta insights row (`current[0]._data`
// shape), return the numeric value. Scalar entries read the field directly;
// action_list entries find the matching action_type inside the array field.
// Missing data (metric never fired, field absent) resolves to 0 rather than
// throwing — mirrors the existing `parseFloat(curr.spend || 0)` fallback
// pattern in getAnalyticsData.
//
// MAX, NOT SUM, across an entry's `actionTypes`. Meta reports several
// conversions under both a legacy action_type and an `omni_*` one, and for
// most campaigns those describe the SAME conversions — summing double-counts
// (which would halve a cost-per metric), while max handles every case:
//   - only legacy present → legacy
//   - only omni present   → omni   ← the case that made CPI read ₹0
//   - both present (equal)→ that value
//   - neither             → 0
// This is the same dedup metaAuditService.js's getInstallCount/getCpi
// arrived at independently; keep the two in sync if either changes.
function extractMetricValue(entry, row) {
  if (!row) return 0;
  if (entry.kind === "scalar") {
    const raw = row[entry.metaField];
    return raw == null ? 0 : parseFloat(raw) || 0;
  }
  const list = row[entry.metaField];
  if (!Array.isArray(list)) return 0;
  const types = entry.actionTypes || (entry.actionType ? [entry.actionType] : []);
  let best = 0;
  for (const type of types) {
    const match = list.find((a) => a.action_type === type);
    const val = match ? parseFloat(match.value) || 0 : 0;
    if (val > best) best = val;
  }
  return best;
}

module.exports = {
  getMetricsCatalog,
  getDefaultVisibleKeys,
  extractMetricValue,
};
