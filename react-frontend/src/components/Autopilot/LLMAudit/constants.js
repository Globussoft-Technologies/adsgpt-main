import {
  ShieldAlert,
  AlertTriangle,
  Lightbulb,
  Pause,
  Play,
  DollarSign,
  Target,
  Users,
  Calendar,
  Copy,
  Image as ImageIcon,
  TrendingUp,
} from 'lucide-react';

export const SEVERITY_CONFIG = {
  critical:    { icon: ShieldAlert,    color: 'text-red-400',    barColor: 'rgb(248,113,113)',  label: 'Critical',    accent: 'bg-red-400/10' },
  warning:     { icon: AlertTriangle,  color: 'text-amber-400',  barColor: 'rgb(251,191,36)',   label: 'Warning',     accent: 'bg-amber-400/10' },
  opportunity: { icon: Lightbulb,      color: 'text-[#15DCFF]',  barColor: 'rgb(21,220,255)',   label: 'Opportunity', accent: 'bg-[#15DCFF]/10' },
};

export const STATUS_CONFIG = {
  pending:   { color: 'text-white/60',   bg: 'bg-white/5',         label: 'Pending' },
  applied:   { color: 'text-emerald-400', bg: 'bg-emerald-400/10',  label: 'Applied' },
  dismissed: { color: 'text-white/40',   bg: 'bg-white/5',         label: 'Dismissed' },
  stale:     { color: 'text-amber-400',  bg: 'bg-amber-400/10',    label: 'Expired' },
  failed:    { color: 'text-red-400',    bg: 'bg-red-400/10',      label: 'Failed' },
};

export const RISK_CONFIG = {
  low:    { color: 'text-emerald-400', label: 'Low risk' },
  medium: { color: 'text-amber-400',   label: 'Medium risk' },
  high:   { color: 'text-red-400',     label: 'High risk' },
};

export const ENTITY_LABELS = { campaign: 'Campaign', adset: 'Ad Set', ad: 'Ad' };

export const ACTION_META = {
  PAUSE_ENTITY:             { label: 'Pause',                   verb: 'Pause',                     icon: Pause,       description: 'Pause this entity to stop delivery.' },
  ACTIVATE_ENTITY:          { label: 'Activate',                verb: 'Activate',                  icon: Play,        description: 'Activate this entity to resume delivery.' },
  ADJUST_BUDGET:            { label: 'Adjust budget',           verb: 'Update budget',             icon: DollarSign,  description: 'Change the daily or lifetime budget. Server clamps to 0.3×–3× current.' },
  ADJUST_BID:               { label: 'Adjust bid',              verb: 'Update bid',                icon: TrendingUp,  description: 'Change the bid amount for this ad set.' },
  NARROW_AUDIENCE:          { label: 'Narrow audience',         verb: 'Narrow audience',           icon: Users,       description: 'Merge a narrower targeting fragment into the current spec. Resets learning.' },
  BROADEN_AUDIENCE:         { label: 'Broaden audience',        verb: 'Broaden audience',          icon: Users,       description: 'Merge a broader targeting fragment into the current spec. Resets learning.' },
  EXTEND_SCHEDULE:          { label: 'Extend schedule',         verb: 'Extend end date',           icon: Calendar,    description: 'Push the end date / stop time further out.' },
  END_EARLY:                { label: 'End early',               verb: 'End earlier',               icon: Calendar,    description: 'Bring the end date / stop time forward.' },
  CHANGE_OPTIMIZATION_GOAL: { label: 'Change optimization goal', verb: 'Change optimization goal', icon: Target,      description: 'Switch the ad set optimization goal. Resets learning.' },
  DUPLICATE_AND_MODIFY:     { label: 'Duplicate & modify',      verb: 'Create duplicate',          icon: Copy,        description: 'Copy this entity and apply the overrides. Not reversible.' },
  SWAP_CREATIVE:            { label: 'Swap creative',           verb: 'Swap creative',             icon: ImageIcon,   description: 'Replace the ad creative with a different one.' },
};

export const OPTIMIZATION_GOALS = [
  'NONE',
  'APP_INSTALLS',
  'AD_RECALL_LIFT',
  'ENGAGED_USERS',
  'EVENT_RESPONSES',
  'IMPRESSIONS',
  'LEAD_GENERATION',
  'QUALITY_LEAD',
  'LINK_CLICKS',
  'OFFSITE_CONVERSIONS',
  'PAGE_LIKES',
  'POST_ENGAGEMENT',
  'QUALITY_CALL',
  'REACH',
  'LANDING_PAGE_VIEWS',
  'VISIT_INSTAGRAM_PROFILE',
  'VALUE',
  'THRUPLAY',
  'DERIVED_EVENTS',
  'APP_INSTALLS_AND_OFFSITE_CONVERSIONS',
  'CONVERSATIONS',
  'IN_APP_VALUE',
  'MESSAGING_PURCHASE_CONVERSION',
  'SUBSCRIBERS',
  'REMINDERS_SET',
  'MEANINGFUL_CALL_ATTEMPT',
  'PROFILE_VISIT',
];

// major-unit conversion helpers (Meta stores budget in minor units / cents)
export const toMinor = (major) => Math.round(parseFloat(major || 0) * 100);
export const toMajor = (minor) =>
  (parseFloat(minor || 0) / 100).toFixed(2).replace(/\.00$/, '');

// format a number as currency-like (₹ prefix, no fraction if whole)
export const fmtCurrency = (val, currency = 'INR') => {
  const n = parseFloat(val);
  if (isNaN(n)) return '—';
  const symbol = currency === 'INR' ? '₹' : currency === 'USD' ? '$' : `${currency} `;
  return `${symbol}${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
};

