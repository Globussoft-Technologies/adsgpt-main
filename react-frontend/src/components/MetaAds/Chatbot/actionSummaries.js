// Translates a raw MCP write-tool call (tool name + args, straight off the
// zod schemas in mcps/meta/src/tools/*.ts) into a plain-English summary for
// the confirmation card — nobody approving "pause my campaign" should have to
// read `{"status":"PAUSED"}` JSON to know what they're approving. Falls back
// to a humanized (not raw) rendering for any write tool without a dedicated
// summarizer below, so nothing regresses to a JSON dump.

// Fields that are always Meta "amount in cents" integers, wherever they appear.
const CENTS_FIELDS = new Set([
  'daily_budget',
  'lifetime_budget',
  'bid_amount',
  'spend_cap',
  'amount_spent',
  'amount',
]);

const ENUM_OVERRIDES = {
  OUTCOME_AWARENESS: 'Awareness',
  OUTCOME_ENGAGEMENT: 'Engagement',
  OUTCOME_LEADS: 'Leads',
  OUTCOME_SALES: 'Sales',
  OUTCOME_TRAFFIC: 'Traffic',
  OUTCOME_APP_PROMOTION: 'App promotion',
  LOWEST_COST_WITHOUT_CAP: 'Lowest cost (no cap)',
  LOWEST_COST_WITH_BID_CAP: 'Lowest cost (with bid cap)',
  LOWEST_COST_WITH_MIN_ROAS: 'Lowest cost (min. ROAS)',
  COST_CAP: 'Cost cap',
  ACTIVE: 'Active',
  PAUSED: 'Paused',
  DELETED: 'Deleted',
  ARCHIVED: 'Archived',
};

const humanizeEnum = (value) => {
  if (value == null) return undefined;
  const s = String(value);
  if (ENUM_OVERRIDES[s]) return ENUM_OVERRIDES[s];
  return s
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
};

const humanizeKey = (key) =>
  key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

// The ad account's ISO currency code (e.g. 'INR', 'USD'), set once per
// summarizeAction() call. Read by formatCurrency below. Safe as call-scoped
// module state: summarizeAction and its whole summarizer tree run
// synchronously (no await), and every action in one confirmation batch shares
// the same account currency.
let _activeCurrency = 'USD';

// Meta returns money amounts in the currency's MINOR unit (paise for INR,
// cents for USD, whole yen for JPY — which has no minor unit). Intl gives each
// currency's decimal count, which is both the divisor exponent AND the display
// precision, so this is correct for 2-decimal and 0-decimal currencies alike,
// and renders the right symbol/grouping (₹1,00,000, $1,000.00, ¥1000).
const formatCurrency = (minorUnits) => {
  const code = String(_activeCurrency || 'USD').toUpperCase();
  let fmt;
  try {
    fmt = new Intl.NumberFormat(undefined, { style: 'currency', currency: code });
  } catch {
    // Unknown/invalid code — fall back to a plain number + code, never a wrong symbol.
    return `${(Number(minorUnits) / 100).toFixed(2)} ${code}`;
  }
  const digits = fmt.resolvedOptions().maximumFractionDigits ?? 2;
  return fmt.format(Number(minorUnits) / 10 ** digits);
};

// [{id, name}] -> "Fashion accessories, Online shopping" (falls back to id
// when the model didn't resolve a name for it).
const namesOrIds = (arr) =>
  Array.isArray(arr) && arr.length
    ? arr.map((item) => (typeof item === 'object' ? item?.name || item?.id : item)).join(', ')
    : undefined;

const row = (label, value) => (value === undefined || value === null || value === '' ? null : { label, value });

function summarizeTargeting(targeting) {
  if (!targeting || typeof targeting !== 'object') return [];
  const rows = [];
  const ageMin = targeting.age_min;
  const ageMax = targeting.age_max;
  if (ageMin || ageMax) rows.push(row('Age range', `${ageMin ?? 13}–${ageMax ?? 65}`));
  const genderMap = { 0: 'All', 1: 'Men', 2: 'Women' };
  if (targeting.genders?.length) {
    rows.push(row('Genders', targeting.genders.map((g) => genderMap[g] ?? g).join(', ')));
  }
  const countries = targeting.geo_locations?.countries;
  if (countries?.length) rows.push(row('Locations', countries.join(', ')));
  if (namesOrIds(targeting.interests)) rows.push(row('Interests', namesOrIds(targeting.interests)));
  if (namesOrIds(targeting.behaviors)) rows.push(row('Behaviors', namesOrIds(targeting.behaviors)));
  if (namesOrIds(targeting.custom_audiences)) rows.push(row('Custom audiences', namesOrIds(targeting.custom_audiences)));
  if (namesOrIds(targeting.excluded_custom_audiences)) {
    rows.push(row('Excluding audiences', namesOrIds(targeting.excluded_custom_audiences)));
  }
  if (targeting.publisher_platforms?.length) {
    rows.push(row('Platforms', targeting.publisher_platforms.map(humanizeEnum).join(', ')));
  }
  return rows.filter(Boolean);
}

const OPERATOR_SYMBOLS = {
  GREATER_THAN: '>',
  LESS_THAN: '<',
  EQUAL: '=',
  NOT_EQUAL: '≠',
  IN_RANGE: 'in range',
  NOT_IN_RANGE: 'not in range',
};

function summarizeRuleFilters(filters) {
  if (!Array.isArray(filters) || !filters.length) return undefined;
  return filters
    .map((f) => `${humanizeKey(f.field)} ${OPERATOR_SYMBOLS[f.operator] || f.operator} ${f.value}`)
    .join(' AND ');
}

function budgetRows(args) {
  const rows = [];
  if (args.daily_budget !== undefined) rows.push(row('Daily budget', `${formatCurrency(args.daily_budget)}/day`));
  if (args.lifetime_budget !== undefined) rows.push(row('Lifetime budget', formatCurrency(args.lifetime_budget)));
  return rows.filter(Boolean);
}

// promoted_object is a free-form record whose shape depends on the
// objective/destination — cover the common shapes (pixel conversions, Page
// engagement, app installs) and fall back to raw JSON only for the rest.
function summarizePromotedObject(obj) {
  if (!obj || typeof obj !== 'object') return undefined;
  if (obj.pixel_id) return `Pixel ${obj.pixel_id}${obj.custom_event_type ? ` — ${humanizeEnum(obj.custom_event_type)}` : ''}`;
  if (obj.page_id) return `Facebook Page ${obj.page_id}`;
  if (obj.application_id) return `App ${obj.application_id}`;
  return JSON.stringify(obj);
}

// Each summarizer returns { title, rows: [{label, value}] }. `args` matches
// the zod inputSchema for that tool 1:1 (see mcps/meta/src/tools/*.ts).
const SUMMARIZERS = {
  ads_create_campaign: (args) => ({
    title: `Create campaign — "${args.name}"`,
    rows: [
      row('Objective', humanizeEnum(args.objective)),
      row('Status', humanizeEnum(args.status) || 'Paused'),
      ...budgetRows(args),
      row('Bid strategy', humanizeEnum(args.bid_strategy)),
      row(
        'Special ad category',
        args.special_ad_categories?.length && !(args.special_ad_categories.length === 1 && args.special_ad_categories[0] === 'NONE')
          ? args.special_ad_categories.map(humanizeEnum).join(', ')
          : undefined,
      ),
      row('Buying type', args.buying_type && args.buying_type !== 'AUCTION' ? humanizeEnum(args.buying_type) : undefined),
    ].filter(Boolean),
  }),
  ads_update_campaign: (args) => ({
    title: `Update campaign ${args.campaign_id}`,
    rows: [
      row('New name', args.name),
      row('New status', humanizeEnum(args.status)),
      ...budgetRows(args),
      row('Bid strategy', humanizeEnum(args.bid_strategy)),
    ].filter(Boolean),
  }),
  ads_delete_campaign: (args) => ({
    title: `Delete campaign ${args.campaign_id}`,
    rows: [row('Effect', 'Stops serving — soft-deleted, can still be viewed')].filter(Boolean),
  }),

  ads_create_ad_set: (args) => ({
    title: `Create ad set — "${args.name}"`,
    rows: [
      row('Campaign', args.campaign_id),
      row('Destination', humanizeEnum(args.destination_type)),
      row('Status', humanizeEnum(args.status) || 'Paused'),
      ...budgetRows(args),
      row('Optimizing for', humanizeEnum(args.optimization_goal)),
      row('Billing event', humanizeEnum(args.billing_event)),
      row('Bid amount', args.bid_amount !== undefined ? formatCurrency(args.bid_amount) : undefined),
      ...summarizeTargeting(args.targeting),
      row('Starts', args.start_time),
      row('Ends', args.end_time),
      row('Promoted', summarizePromotedObject(args.promoted_object)),
    ].filter(Boolean),
  }),
  ads_update_ad_set: (args) => ({
    title: `Update ad set ${args.ad_set_id ?? args.adset_id ?? ''}`,
    rows: [
      row('New name', args.name),
      row('New status', humanizeEnum(args.status)),
      ...budgetRows(args),
      row('Optimizing for', humanizeEnum(args.optimization_goal)),
      ...summarizeTargeting(args.targeting),
    ].filter(Boolean),
  }),
  ads_delete_ad_set: (args) => ({
    title: `Delete ad set ${args.ad_set_id ?? args.adset_id}`,
    rows: [],
  }),
  ads_clone_ad_set_bundle: (args) => ({
    title: `${args.dry_run ? 'Preview clone of ad set' : 'Clone ad set'}${args.target_ad_set?.name ? ` — "${args.target_ad_set.name}"` : ''}`,
    rows: [
      row('Mode', args.dry_run ? 'Dry run — nothing will actually be created' : undefined),
      row('Source ad set', args.source_ad_set_id),
      row('New name', args.target_ad_set?.name),
      row('Status', humanizeEnum(args.target_ad_set?.status) || 'Paused'),
      ...budgetRows(args.target_ad_set || {}),
      row('Creative overrides', args.creative_overrides?.length ? `${args.creative_overrides.length} ad(s)` : undefined),
    ].filter(Boolean),
  }),

  ads_create_ad: (args) => ({
    title: `Create ad — "${args.name}"`,
    rows: [
      row('Ad set', args.ad_set_id),
      row('Creative', args.creative_id),
      row('Status', humanizeEnum(args.status) || 'Paused'),
      row('Tracking specs', args.tracking_specs?.length ? JSON.stringify(args.tracking_specs) : undefined),
    ].filter(Boolean),
  }),
  ads_update_ad: (args) => ({
    title: `Update ad ${args.ad_id}`,
    rows: [
      row('New name', args.name),
      row('New status', humanizeEnum(args.status)),
      row('New creative', args.creative_id),
    ].filter(Boolean),
  }),
  ads_delete_ad: (args) => ({
    title: `Delete ad ${args.ad_id}`,
    rows: [],
  }),

  ads_create_ad_creative: (args) => {
    const mode = args.source_instagram_media_id
      ? 'Promote existing Instagram post'
      : args.object_story_id
        ? 'Boost existing Facebook post'
        : 'Build from image/video + text';
    return {
      title: `Create ad creative — "${args.name}"`,
      rows: [
        row('Mode', mode),
        row('Facebook Page', args.page_id),
        row('Instagram account', args.instagram_actor_id),
        row('Image', args.image_url || (args.image_hash ? `uploaded image (${args.image_hash})` : undefined)),
        row('Video', args.video_id),
        row('Destination link', args.link_url),
        row('Headline', args.headline),
        row('Primary text', args.message),
        row('Description', args.description),
        row('Button', humanizeEnum(args.call_to_action_type)),
        row('URL tracking params', args.url_tags),
      ].filter(Boolean),
    };
  },
  ads_update_ad_creative: (args) => ({
    title: `Rename ad creative ${args.creative_id}`,
    rows: [row('New name', args.name)].filter(Boolean),
  }),

  ads_create_custom_audience: (args) => ({
    title: `Create audience — "${args.name}"`,
    rows: [
      row('Built from', args.rule ? 'Website/pixel activity' : humanizeEnum(args.subtype) || 'Customer list'),
      row('Source data', args.customer_file_source ? humanizeEnum(args.customer_file_source) : undefined),
      row('Retention', args.retention_days !== undefined ? `${args.retention_days} days` : undefined),
      row('Description', args.description),
    ].filter(Boolean),
  }),
  ads_create_lookalike_audience: (args) => ({
    title: `Create lookalike audience — "${args.name}"`,
    rows: [
      row('Source audience', args.origin_audience_id),
      row('Country', args.country),
      row('Similarity', args.ratio !== undefined ? `Top ${Math.round(args.ratio * 100)}%` : undefined),
      row('Description', args.description),
    ].filter(Boolean),
  }),
  ads_share_custom_audience: (args) => ({
    title: `Share audience ${args.audience_id}`,
    rows: [row('With account(s)', Array.isArray(args.ad_account_ids) ? args.ad_account_ids.join(', ') : args.ad_account_ids)].filter(Boolean),
  }),
  ads_unshare_custom_audience: (args) => ({
    title: `Unshare audience ${args.audience_id}`,
    rows: [row('From account(s)', Array.isArray(args.ad_account_ids) ? args.ad_account_ids.join(', ') : args.ad_account_ids)].filter(Boolean),
  }),
  ads_delete_custom_audience: (args) => ({
    title: `Delete audience ${args.audience_id}`,
    rows: [],
  }),

  ads_activate_entity: (args) => ({
    title: `${humanizeEnum(args.status) || 'Change status of'} ${humanizeEnum(args.entity_type)} ${args.entity_id}`,
    rows: [],
  }),
  ads_update_spend_cap: (args) => ({
    title: `Update account spend cap`,
    rows: [row('New spend cap', args.spend_cap !== undefined ? formatCurrency(args.spend_cap) : undefined)].filter(Boolean),
  }),
  ads_create_budget_schedule: (args) => ({
    title: `Schedule a temporary budget change`,
    rows: [
      row('Campaign', args.campaign_id),
      row(
        'New budget',
        args.budget_value_type === 'MULTIPLIER'
          ? `×${args.budget_value} current budget`
          : args.budget_value !== undefined
            ? formatCurrency(Number(args.budget_value))
            : undefined,
      ),
      row('Starts', args.time_start),
      row('Ends', args.time_end),
    ].filter(Boolean),
  }),

  ads_create_ad_rule: (args) => ({
    title: `Create automated rule — "${args.name}"`,
    rows: [
      row('Checked', args.evaluation_spec?.evaluation_type === 'SCHEDULE' ? 'On a schedule' : 'In real time'),
      row('When', summarizeRuleFilters(args.evaluation_spec?.filters)),
      row('Then', humanizeEnum(args.execution_spec?.execution_type)),
    ].filter(Boolean),
  }),
  ads_update_ad_rule: (args) => ({
    title: `Update automated rule ${args.rule_id}`,
    rows: [
      row('New name', args.name),
      row('New status', humanizeEnum(args.status)),
      row('When', summarizeRuleFilters(args.evaluation_spec?.filters)),
      row('Then', humanizeEnum(args.execution_spec?.execution_type)),
    ].filter(Boolean),
  }),
  ads_delete_ad_rule: (args) => ({
    title: `Delete automated rule ${args.rule_id}`,
    rows: [],
  }),

  ads_reply_comment: (args) => ({
    title: `Reply to comment ${args.comment_id}`,
    rows: [row('Reply', args.message)].filter(Boolean),
  }),
  ads_hide_comment: (args) => ({
    title: `${args.is_hidden === false ? 'Unhide' : 'Hide'} comment ${args.comment_id}`,
    rows: [],
  }),
  ads_delete_comment: (args) => ({
    title: `Delete comment ${args.comment_id}`,
    rows: [],
  }),
};

// Fallback for any write tool without a dedicated summarizer above — still
// humanized labels + smart-formatted values, never a raw JSON dump.
function genericSummary(toolName, args) {
  const rows = Object.entries(args || {})
    .map(([key, value]) => {
      if (value === undefined || value === null || value === '') return null;
      if (CENTS_FIELDS.has(key) && typeof value === 'number') return row(humanizeKey(key), formatCurrency(value));
      if (Array.isArray(value)) {
        const joined = namesOrIds(value) ?? value.map((v) => (typeof v === 'object' ? JSON.stringify(v) : v)).join(', ');
        return row(humanizeKey(key), joined);
      }
      if (typeof value === 'boolean') return row(humanizeKey(key), value ? 'Yes' : 'No');
      if (typeof value === 'object') return row(humanizeKey(key), JSON.stringify(value));
      if (/status|goal|event|strategy|objective|type|destination/.test(key) && typeof value === 'string') {
        return row(humanizeKey(key), humanizeEnum(value));
      }
      return row(humanizeKey(key), String(value));
    })
    .filter(Boolean);
  return {
    title: humanizeKey(toolName.replace(/^ads_/, '')),
    rows,
  };
}

export function summarizeAction(toolName, args, currency) {
  // Set the currency for this synchronous call before any summarizer runs, so
  // formatCurrency renders the account's real currency (₹ for INR, etc.) rather
  // than a hardcoded $.
  _activeCurrency = currency || 'USD';
  const summarizer = SUMMARIZERS[toolName];
  try {
    if (summarizer) return summarizer(args || {});
  } catch {
    // fall through to the generic summary if a tool's args don't match what
    // the dedicated summarizer expected (e.g. a schema changed upstream)
  }
  return genericSummary(toolName, args || {});
}
