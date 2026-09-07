// ─── shared constants & helpers for MetaAds components ───────────────────────

import {
  DollarSign,
  Eye,
  MousePointerClick,
  Users,
  TrendingUp,
  Activity,
  Zap,
  Radio,
  Play,
  Clock,
  ThumbsUp,
  MessageCircle,
  Share2,
  ShoppingCart,
  UserPlus,
  Smartphone,
} from 'lucide-react';

export const DATE_PRESETS = [
              { value: "today", label: "Today" },
              { value: "yesterday", label: "Yesterday" },
              { value: "last_3d", label: "Last 3 Days" },
              { value: "last_7d", label: "Last 7 Days" },
              { value: "last_14d", label: "Last 14 Days" },
              { value: "last_28d", label: "Last 28 Days" },
              { value: "last_30d", label: "Last 30 Days" },
              { value: "last_90d", label: "Last 90 Days" },
              { value: "this_month", label: "This Month" },
              { value: "last_month", label: "Last Month" },
              { value: "this_quarter", label: "This Quarter" },
              { value: "last_quarter", label: "Last Quarter" },
              { value: "this_year", label: "This Year" },
              { value: "last_year", label: "Last Year" },
              { value: "lifetime", label: "Lifetime" },
              { value: "maximum", label: "Maximum" },
              // Sentinel — when selected, the dashboard sends since/until
              // instead of datePreset. Same pattern as BrandIQ/Competitors.
              { value: "custom", label: "Custom Range" },
            ]

// Trigger-button label for the date control. A custom range reads as
// "1 Jul – 15 Jul" rather than the useless literal "Custom Range".
export const formatDateRangeLabel = (dateRange) => {
  if (dateRange?.preset !== 'custom') {
    return DATE_PRESETS.find((d) => d.value === dateRange?.preset)?.label || 'Select dates';
  }
  if (!dateRange.since || !dateRange.until) return 'Custom Range';
  const short = (iso) => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
    });
  };
  return dateRange.since === dateRange.until
    ? short(dateRange.since)
    : `${short(dateRange.since)} – ${short(dateRange.until)}`;
};


export const CHART_COLORS = ['#15DCFF', '#6b72f8', '#f472b6', '#34d399', '#fbbf24', '#f87171'];

export const STATUS_MAP = {
  ACTIVE: {
    dot: 'bg-emerald-500 dark:bg-emerald-400',
    text: 'text-emerald-600 dark:text-emerald-400',
    bg: 'bg-emerald-400/10 border-emerald-400/30 dark:border-emerald-400/20',
  },
  PAUSED: {
    dot: 'bg-red-500 dark:bg-red-400',
    text: 'text-red-600 dark:text-red-400',
    bg: 'bg-red-400/10 border-red-400/30 dark:border-red-400/20',
  },
  DELETED: {
    dot: 'bg-red-500 dark:bg-red-400',
    text: 'text-red-600 dark:text-red-400',
    bg: 'bg-red-400/10 border-red-400/30 dark:border-red-400/20',
  },
  ARCHIVED: {
    dot: 'bg-gray-400 dark:bg-[#AFAFAF]',
    text: 'text-gray-500 dark:text-[#BEBEBE]',
    bg: 'bg-gray-200/70 border-gray-300 dark:bg-white/5 dark:border-white/10',
  },
  1: {
    dot: 'bg-emerald-500 dark:bg-emerald-400',
    text: 'text-emerald-600 dark:text-emerald-400',
    bg: 'bg-emerald-400/10 border-emerald-400/30 dark:border-emerald-400/20',
  },
};

export const fmt = (val, dec = 2) => {
  const n = parseFloat(val);
  return isNaN(n) ? '—' : n.toFixed(dec);
};
// Money formatter for the ad account's OWN currency. Insights amounts
// (spend, cpc, cpm, ROAS values) arrive in MAJOR units already — unlike the
// campaign / ad-set budget fields, which Meta returns in minor units and the
// backend pre-formats (utils/formatBudget.js). `currency` is the account's
// ISO 4217 code, threaded down from selectedAccount.currency; Intl gives it
// the right symbol AND the right decimal count (₹1,00,000, $1,000.00, ¥1000).
// A missing or unrecognised code falls back to a plain number + code rather
// than guessing a symbol — this used to hardcode ₹, which rendered every USD
// account's spend as rupees.
export const fmtMoney = (val, currency) => {
  const n = parseFloat(val);
  if (isNaN(n)) return '—';
  const code = String(currency || '').toUpperCase();
  if (code) {
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: code }).format(n);
    } catch {
      // Not a valid ISO 4217 code — fall through to the neutral form.
    }
  }
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}${code ? ` ${code}` : ''}`;
};

// Just the symbol ("$", "₹", "¥") — for input prefixes, where a fully
// formatted amount would be wrong. Empty when we have no code yet, so a
// not-yet-loaded account shows nothing instead of the wrong currency.
export const currencySymbol = (currency) => {
  const code = String(currency || '').toUpperCase();
  if (!code) return '';
  try {
    return (
      new Intl.NumberFormat(undefined, { style: 'currency', currency: code })
        .formatToParts(0)
        .find((part) => part.type === 'currency')?.value || code
    );
  } catch {
    return code;
  }
};
export const getActionVal = (actions, type) =>
  parseInt(actions?.find((a) => a.action_type === type)?.value || 0, 10);
export const getCPAVal = (list, type) =>
  parseFloat(list?.find((a) => a.action_type === type)?.value || 0);

// ─── per-plan limits ─────────────────────────────────────────────────────────
// Keys mirror nodejs-backend/config/planLimitsRegistry.js — the backend
// attaches usage as `planLimits: { "<key>": { limit, current } }` on the
// ad-account and campaign list responses. Kept in one place so a renamed or
// newly-added limit is a single edit on this side too.
export const PLAN_LIMITS = {
  metaAdAccounts: 'meta:ad_accounts',
  metaCampaigns: 'meta:campaigns',
};

// -> { allowed, managed } when the user's plan caps this limit, else null
// (unlimited, or the backend omitted it).
export const readPlanLimit = (payload, limitKey) => {
  const entry = payload?.planLimits?.[limitKey];
  if (!entry || entry.limit == null) return null;
  return { allowed: entry.limit, managed: entry.current };
};

// Campaign ids holding a plan slot, as a Set for O(1) row lookups.
// Returns null when the backend sent no managed-slot state at all, which
// means the plan is UNCAPPED — distinct from an empty Set ("capped, none
// claimed yet"). Callers must treat null as "lock nothing".
export const readManagedCampaignIds = (payload) =>
  Array.isArray(payload?.managedCampaignIds)
    ? new Set(payload.managedCampaignIds)
    : null;

// ─── selectable-metrics catalog helpers ──────────────────────────────────────
// The backend's config/metricsCatalog.js entries reference icons by string
// name (JSON can't carry a component reference) — resolve to the actual
// lucide-react component here. Shared by AnalyticsPanel (renders the KPI
// cards) and MetricsPicker (renders the picker rows) so the name→component
// map lives in exactly one place.
export const METRIC_ICONS = {
  DollarSign,
  Eye,
  MousePointerClick,
  Users,
  TrendingUp,
  Activity,
  Zap,
  Radio,
  Play,
  Clock,
  ThumbsUp,
  MessageCircle,
  Share2,
  ShoppingCart,
  UserPlus,
  Smartphone,
};

// Friendly group labels for the picker's collapsible sections — keys match
// the backend catalog's `group` field (config/metricsCatalog.js).
export const METRIC_GROUP_LABELS = {
  performance: 'Performance',
  video: 'Video',
  engagement: 'Engagement',
  messaging: 'Messaging',
  leads: 'Leads',
  commerce: 'Commerce',
  app: 'App',
  offline: 'Offline Conversions',
  roas: 'Return on Ad Spend',
};

// Format a raw numeric metric value per the catalog entry's `format` field.
// Mirrors the ad-hoc per-field formatting AnalyticsPanel used to do inline
// (fmtMoney for currency, .toLocaleString() for integers) — centralized here
// now that the set of formattable metrics isn't a fixed hardcoded list.
// `currency` is the ad account's ISO code; every caller that renders money
// must pass it, or the amount comes out as a bare number + no symbol.
export const formatMetricValue = (format, val, currency) => {
  const n = parseFloat(val);
  if (isNaN(n)) return '—';
  switch (format) {
    case 'currency':
      return fmtMoney(n, currency);
    case 'integer':
      return Math.round(n).toLocaleString();
    case 'percent':
      return `${fmt(n)}%`;
    case 'ratio':
      return `${fmt(n)}x`;
    case 'decimal2':
    default:
      return fmt(n);
  }
};

// ─── enum label maps ─────────────────────────────────────────────────────────
// Meta returns SCREAMING_SNAKE values for objectives, billing, optimization,
// bid types and CTAs. We display them in the campaign / ad set / ad tables
// and in the create wizard. Falling back to a Title Case from the underscored
// id keeps unknown future enums readable instead of leaking raw text.

const titleize = (s) =>
  String(s)
    .toLowerCase()
    .split('_')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');

const OBJECTIVE_LABELS = {
  OUTCOME_AWARENESS: 'Awareness',
  OUTCOME_TRAFFIC: 'Traffic',
  OUTCOME_ENGAGEMENT: 'Engagement',
  OUTCOME_LEADS: 'Leads',
  OUTCOME_APP_PROMOTION: 'App Promotion',
  OUTCOME_SALES: 'Sales',
};

const BILLING_EVENT_LABELS = {
  IMPRESSIONS: 'Impressions',
  LINK_CLICKS: 'Link Clicks',
  PAGE_LIKES: 'Page Likes',
  POST_ENGAGEMENT: 'Post Engagement',
  VIDEO_VIEWS: 'Video Views',
  THRUPLAY: 'ThruPlay',
};

const OPTIMIZATION_GOAL_LABELS = {
  REACH: 'Reach',
  IMPRESSIONS: 'Impressions',
  LINK_CLICKS: 'Link Clicks',
  POST_ENGAGEMENT: 'Post Engagement',
  PAGE_LIKES: 'Page Likes',
  LANDING_PAGE_VIEWS: 'Landing Page Views',
  OFFSITE_CONVERSIONS: 'Conversions',
  LEAD_GENERATION: 'Lead Generation',
  THRUPLAY: 'ThruPlay',
  VIDEO_VIEWS: 'Video Views',
  APP_INSTALLS: 'App Installs',
  VALUE: 'Value',
  QUALITY_LEAD: 'Quality Leads',
  CONVERSATIONS: 'Conversations',
};

const BID_TYPE_LABELS = {
  ABSOLUTE_OCPM: 'Absolute oCPM',
  CPC: 'CPC',
  CPM: 'CPM',
  CPP: 'CPP',
  CPA: 'CPA',
  // Strategy IDs sometimes surface here too:
  LOWEST_COST_WITHOUT_CAP: 'Lowest Cost',
  LOWEST_COST_WITH_BID_CAP: 'Lowest Cost (Bid Cap)',
  COST_CAP: 'Cost Cap',
  LOWEST_COST_WITH_MIN_ROAS: 'Lowest Cost (Min ROAS)',
};

const CTA_LABELS = {
  LEARN_MORE: 'Learn More',
  SHOP_NOW: 'Shop Now',
  SIGN_UP: 'Sign Up',
  SUBSCRIBE: 'Subscribe',
  CONTACT_US: 'Contact Us',
  DOWNLOAD: 'Download',
  BOOK_TRAVEL: 'Book Travel',
  GET_QUOTE: 'Get Quote',
  APPLY_NOW: 'Apply Now',
  GET_OFFER: 'Get Offer',
  ORDER_NOW: 'Order Now',
  DONATE_NOW: 'Donate Now',
  WATCH_MORE: 'Watch More',
  MESSAGE_PAGE: 'Send Message',
  NO_BUTTON: 'No Button',
};

const lookup = (map, value) => {
  if (value == null || value === '') return null;
  return map[value] ?? titleize(value);
};

export const labelObjective = (v) => lookup(OBJECTIVE_LABELS, v);
export const labelBillingEvent = (v) => lookup(BILLING_EVENT_LABELS, v);
export const labelOptimizationGoal = (v) => lookup(OPTIMIZATION_GOAL_LABELS, v);
export const labelBidType = (v) => lookup(BID_TYPE_LABELS, v);
export const labelCTA = (v) => lookup(CTA_LABELS, v);

// ─── delivery state ───────────────────────────────────────────────────────────
// The backend derives a `delivery` object per entity (utils/metaDelivery.js)
// from Meta's `effective_status`, because `status` alone is a lie on any
// rejected or parent-paused entity. These maps turn its `tone` into classes;
// the labels themselves come from the backend so the two never drift.

export const DELIVERY_TONES = {
  good: {
    dot: 'bg-emerald-500 dark:bg-emerald-400',
    text: 'text-emerald-600 dark:text-emerald-400',
    bg: 'bg-emerald-400/10 border-emerald-400/30 dark:border-emerald-400/20',
  },
  bad: {
    dot: 'bg-red-500 dark:bg-red-400',
    text: 'text-red-600 dark:text-red-400',
    bg: 'bg-red-400/10 border-red-400/30 dark:border-red-400/20',
  },
  warn: {
    dot: 'bg-amber-500 dark:bg-amber-400',
    text: 'text-amber-600 dark:text-amber-400',
    bg: 'bg-amber-400/10 border-amber-400/30 dark:border-amber-400/20',
  },
  neutral: {
    dot: 'bg-sky-500 dark:bg-sky-400',
    text: 'text-sky-600 dark:text-sky-400',
    bg: 'bg-sky-400/10 border-sky-400/30 dark:border-sky-400/20',
  },
  muted: {
    dot: 'bg-gray-400 dark:bg-[#AFAFAF]',
    text: 'text-gray-500 dark:text-[#BEBEBE]',
    bg: 'bg-gray-200/70 border-gray-300 dark:bg-white/5 dark:border-white/10',
  },
  unknown: {
    dot: 'bg-gray-400 dark:bg-[#AFAFAF]',
    text: 'text-gray-500 dark:text-[#BEBEBE]',
    bg: 'bg-gray-200/70 border-gray-300 dark:bg-white/5 dark:border-white/10',
  },
};

export const deliveryTone = (tone) => DELIVERY_TONES[tone] ?? DELIVERY_TONES.unknown;

// ─── table filtering ──────────────────────────────────────────────────────────
// Client-side over the already-fetched list, like the existing name search —
// these lists are one Meta page each, so filtering server-side would cost a
// round trip to narrow data we already hold.

export const TABLE_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'paused', label: 'Paused' },
  // Anything Meta is unhappy about: rejected, billing-blocked, or carrying a
  // delivery issue. This is the bucket users actually go looking for.
  { key: 'issues', label: 'Needs attention' },
];

const NOT_DELIVERING_TONES = new Set(['bad']);

/**
 * matchesTableFilter — one predicate for all three levels.
 *
 * Reads the derived `delivery` object when present and falls back to raw
 * `status`, so rows served from a cache written before the delivery fields
 * were requested still filter correctly instead of vanishing.
 */
export const matchesTableFilter = (row, filterKey) => {
  if (!filterKey || filterKey === 'all') return true;

  const delivery = row?.delivery || null;

  // Active / Paused match the USER-SET status — the same value StatusBadge
  // renders — not effective_status.
  //
  // Filtering on effective_status was a real bug: an ad the user set ACTIVE
  // that Meta is still reviewing has effective_status PENDING_REVIEW, so it
  // matched neither bucket. The table showed a green ACTIVE badge next to
  // "Active 0", which reads as the filter being broken. Same for a paused ad
  // reporting IN_PROCESS.
  //
  // Meta's own Ads Manager behaves this way too — its "Active ads" filter
  // includes in-review ads. Delivery divergence is what the delivery badge and
  // the "Needs attention" bucket below are for.
  const userStatus = row?.status || null;

  if (filterKey === 'active') return userStatus === 'ACTIVE';

  if (filterKey === 'paused') return userStatus === 'PAUSED';

  if (filterKey === 'issues') {
    if (delivery?.tone && NOT_DELIVERING_TONES.has(delivery.tone)) return true;
    if (Array.isArray(row?.issues_info) && row.issues_info.length > 0) return true;
    // Learning-limited is a delivery problem the user can act on, so it
    // belongs in this bucket even though Meta reports the ad set as ACTIVE.
    if (row?.learning?.stage === 'LEARNING_LIMITED') return true;
    if (row?.review) return true;
    return false;
  }

  return true;
};

/** Count per filter, for the pill badges. */
export const countByFilter = (rows = []) =>
  TABLE_FILTERS.reduce((acc, f) => {
    acc[f.key] = rows.filter((r) => matchesTableFilter(r, f.key)).length;
    return acc;
  }, {});
