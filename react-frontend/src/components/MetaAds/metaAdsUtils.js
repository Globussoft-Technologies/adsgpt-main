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
export const fmtINR = (val) => {
  const n = parseFloat(val);
  return isNaN(n) ? '—' : `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
};
export const getActionVal = (actions, type) =>
  parseInt(actions?.find((a) => a.action_type === type)?.value || 0, 10);
export const getCPAVal = (list, type) =>
  parseFloat(list?.find((a) => a.action_type === type)?.value || 0);

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
// (fmtINR for currency, .toLocaleString() for integers) — centralized here
// now that the set of formattable metrics isn't a fixed hardcoded list.
export const formatMetricValue = (format, val) => {
  const n = parseFloat(val);
  if (isNaN(n)) return '—';
  switch (format) {
    case 'currency':
      return fmtINR(n);
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
