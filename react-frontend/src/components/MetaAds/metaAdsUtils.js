// ─── shared constants & helpers for MetaAds components ───────────────────────

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
            ]


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
