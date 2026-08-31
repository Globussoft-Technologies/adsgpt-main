import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
// eslint-disable-next-line no-unused-vars
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronRight,
  Target,
  ArrowUpDown,
  Trash2,
  Loader2,
  AlertTriangle,
  Plus,
  Pencil,
  Activity,
  DollarSign,
  Image as ImageIcon,
  Play,
  Pause,
  X,
  ExternalLink,
  RefreshCw,
  Layers,
  Search,
} from 'lucide-react';
import {
  getGoogleAdGroups,
  getGoogleAdGroupAds,
  resolveGoogleAdForEdit,
  updateGoogleAdStatus,
  deleteGoogleCampaign,
  deleteGoogleAd,
  deleteGoogleAdGroup,
  removeAssetFromAssetGroup,
} from '@/apis/googleAds/googleAdsApi';
import { globalToast } from '@/utils/globalToast';
import { Spinner, EmptyState } from '@/components/MetaAds/MetaAdsAtoms';
import {
  adCopyText,
  labelGoogleCTA,
  hasBudget,
  parseBudgetINR,
} from '@/components/GoogleAds/googleAdsUtils';

// ─── helpers ──────────────────────────────────────────────────────────────────

const fromMicros = (n) => (n ? (Number(n) / 1_000_000).toFixed(2) : null);

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const formatDisplayDate = (isoDate) => {
  const [y, m, d] = String(isoDate).split('-').map(Number);
  if (!y || !m || !d) return isoDate;
  return `${d} ${MONTH_ABBR[m - 1]} ${y}`;
};

function BudgetBar({ budget, remaining }) {
  const b = parseBudgetINR(budget);
  const r = parseBudgetINR(remaining);
  if (b == null || r == null || b <= 0) return null;
  const pct = Math.min(100, Math.max(0, ((b - r) / b) * 100));
  return (
    <div className="mt-1.5 h-1 w-full max-w-28 overflow-hidden rounded-full bg-gray-200 dark:bg-white/10">
      <div className="h-full rounded-full bg-[#4285F4]/70 transition-all" style={{ width: `${pct}%` }} />
    </div>
  );
}

// ─── Google-style serving status (campaigns, ad groups, ads) ─────────────────

const STATUS_CFG = {
  // Campaign / ad-group primary statuses
  ELIGIBLE:              { label: 'Eligible',            color: 'text-emerald-700 dark:text-emerald-400', bg: 'bg-emerald-50  dark:bg-emerald-400/10', dot: 'bg-emerald-500' },
  ELIGIBLE_LIMITED:      { label: 'Eligible (limited)',  color: 'text-amber-700  dark:text-amber-400',   bg: 'bg-amber-50    dark:bg-amber-400/10',   dot: 'bg-amber-500'  },
  LIMITED:               { label: 'Limited',             color: 'text-amber-700  dark:text-amber-400',   bg: 'bg-amber-50    dark:bg-amber-400/10',   dot: 'bg-amber-500'  },
  PAUSED:                { label: 'Paused',              color: 'text-slate-600  dark:text-slate-300',    bg: 'bg-slate-100   dark:bg-slate-500/15',    dot: 'bg-slate-500'  },
  NOT_ELIGIBLE:          { label: 'Not eligible',        color: 'text-red-600    dark:text-red-400',     bg: 'bg-red-50      dark:bg-red-500/10',      dot: 'bg-red-500'    },
  REMOVED:               { label: 'Removed',             color: 'text-red-600    dark:text-red-400',     bg: 'bg-red-50      dark:bg-red-500/10',      dot: 'bg-red-500'    },
  ENDED:                 { label: 'Ended',               color: 'text-purple-600 dark:text-purple-400',  bg: 'bg-purple-50   dark:bg-purple-500/10',   dot: 'bg-purple-500' },
  PENDING:               { label: 'Pending',             color: 'text-blue-600   dark:text-blue-400',    bg: 'bg-blue-50     dark:bg-blue-500/10',     dot: 'bg-blue-400'   },
  MISCONFIGURED:         { label: 'Misconfigured',       color: 'text-red-600    dark:text-red-400',     bg: 'bg-red-50      dark:bg-red-500/10',      dot: 'bg-red-500'    },
  // Ad-level approval statuses
  APPROVED:              { label: 'Approved',            color: 'text-emerald-700 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-400/10',  dot: 'bg-emerald-500' },
  APPROVED_LIMITED:      { label: 'Approved (limited)',  color: 'text-amber-700  dark:text-amber-400',   bg: 'bg-amber-50    dark:bg-amber-400/10',   dot: 'bg-amber-500'  },
  DISAPPROVED:           { label: 'Disapproved',         color: 'text-red-600    dark:text-red-400',     bg: 'bg-red-50      dark:bg-red-500/10',      dot: 'bg-red-500'    },
  UNDER_REVIEW:          { label: 'Under review',        color: 'text-blue-600   dark:text-blue-400',    bg: 'bg-blue-50     dark:bg-blue-500/10',     dot: 'bg-blue-400'   },
  AREA_OF_INTEREST_ONLY: { label: 'Limited reach',       color: 'text-amber-700  dark:text-amber-400',   bg: 'bg-amber-50    dark:bg-amber-400/10',   dot: 'bg-amber-500'  },
};

// Serving-status values → subtitle text (exact wording from Google Ads UI)
const SERVING_STATUS_SUBTITLE = {
  ADS_LIMITED_BY_POLICY: 'All ads limited by policy',
  ADS_DISAPPROVED:       'Most ads disapproved',
  ADS_PAUSED:            'All ads paused',
  NO_ADS:                'No ads running',
  ADS_ERROR:             'Ads have errors',
  BUDGET_PAUSED:         'Budget depleted',
  SUSPENDED:             'Account suspended',
  ACCOUNT_PAUSED:        'Account paused',
  ACCOUNT_PAUSED_VERIFICATION: 'Account paused — verification required',
  ACCOUNT_BLOCKED_UNKNOWN: 'Account paused — check Google Ads',
};

// subtitle key → what the user should do to fix it, shown on hover.
// Wording mirrors Google's own guidance so it doesn't conflict with what
// they see when they click through to Google Ads.
const STATUS_FIX_HINT = {
  'All ads limited by policy': 'Some ads may violate Google Ads policies. Open Google Ads → Ads to review and edit the flagged ads.',
  'Most ads disapproved':      'Most ads were rejected for policy violations. Open Google Ads → Ads to see the reason and fix or replace them.',
  'All ads paused':            'Every ad in this campaign is paused. Enable at least one ad in Google Ads to resume serving.',
  'Ads have errors':           'One or more ads have setup errors. Open Google Ads → Ads to see and fix the errors.',
  'Budget depleted':           "Today's budget has been spent. It resets automatically at midnight in the account's timezone, or raise the daily budget.",
  'Account suspended':         'This account was suspended by Google, usually for a policy or billing violation. Open Google Ads → Billing/Policy manager and follow the appeal steps to restore it.',
  'Account paused':            'This account is paused until advertiser identity verification is completed. Open Google Ads and click "Start here" on the verification banner to resume serving.',
  'Account paused — verification required': 'This account is paused until advertiser identity verification is completed. Open Google Ads and click "Start here" on the verification banner to resume serving.',
  'Account paused — check Google Ads': "This account is paused and isn't serving ads. We couldn't confirm the exact reason automatically — open Google Ads to see the banner and required action (often advertiser verification).",
  'Campaign is paused': 'This campaign was paused. Enable it in Google Ads (or from the pause/play button here) to resume serving.',
};

// primaryStatus → subtitle (only non-obvious ones)
const PRIMARY_STATUS_SUBTITLE = {
  ELIGIBLE_LIMITED: 'All ads limited by policy',
  LIMITED:          'Limited by policy',
  ENDED:            'Campaign has ended',
  PENDING:          'Not yet started',
  MISCONFIGURED:    'Check campaign settings',
  // Google returns this directly on asset_group.primary_status when the
  // asset group itself is enabled but can't serve for some other reason
  // (most commonly the parent campaign being paused).
  NOT_ELIGIBLE:     'Campaign is paused',
};

// approvalStatus → subtitle
const APPROVAL_STATUS_SUBTITLE = {
  APPROVED_LIMITED:      'Limited by policy',
  DISAPPROVED:           'Ad disapproved',
  UNDER_REVIEW:          'Under review',
  AREA_OF_INTEREST_ONLY: 'Limited reach',
};

function robustStatus(s) {
  if (!s) return 'PAUSED';
  const v = String(s).toUpperCase();
  if (v === 'ENABLED' || v === 'ACTIVE') return 'ENABLED';
  return 'PAUSED';
}

/**
 * Unified Google-style status badge.
 * Priority: approvalStatus (ads) → primaryStatus (campaign/adgroup) → servingStatus fallback → raw status
 */
function GoogleServingStatus({ status, primaryStatus, servingStatus, approvalStatus, parentCampaignStatus }) {
  const base = robustStatus(status);

  // ── 1. resolve badge key ──────────────────────────────────────────────────
  const clean = (v) => v && v !== 'UNKNOWN' && v !== 'UNSPECIFIED' ? String(v).toUpperCase() : null;
  const approvalKey  = clean(approvalStatus);
  const primaryKey   = clean(primaryStatus);
  const servingKey   = clean(servingStatus);

  // An ad group / asset group can be individually ENABLED while its parent
  // campaign is paused — Google's own UI keeps the row's own dot/status as
  // enabled but shows "Not eligible" (not "Paused") since nothing serves
  // until the campaign resumes.
  const parentPaused = clean(parentCampaignStatus) === 'PAUSED' && base === 'ENABLED' && (!primaryKey || primaryKey === 'ELIGIBLE');

  // Upgrade ELIGIBLE → ELIGIBLE_LIMITED when serving status indicates policy issues
  const effectivePrimaryKey = (primaryKey === 'ELIGIBLE' && servingKey && SERVING_STATUS_SUBTITLE[servingKey])
    ? 'ELIGIBLE_LIMITED'
    : primaryKey;

  const badgeKey = approvalKey || effectivePrimaryKey || (parentPaused ? 'NOT_ELIGIBLE' : (base === 'ENABLED' ? 'ELIGIBLE' : 'PAUSED'));
  const cfg = STATUS_CFG[badgeKey] || STATUS_CFG[base === 'ENABLED' ? 'ELIGIBLE' : 'PAUSED'];

  // ── 2. resolve subtitle ───────────────────────────────────────────────────
  // Account-level reasons (e.g. "Account paused") are more urgent than a
  // plain self-inflicted pause, so they still win. "Campaign is paused" is
  // only a fallback label when nothing more specific is known.
  let subtitle = null;
  if (approvalKey)         subtitle = APPROVAL_STATUS_SUBTITLE[approvalKey]  ?? null;
  // For a generic NOT_ELIGIBLE, a specific reason (from servingKey) beats
  // our fallback guess — only use the fallback when no reason is known.
  if (!subtitle && effectivePrimaryKey && effectivePrimaryKey !== 'NOT_ELIGIBLE') subtitle = PRIMARY_STATUS_SUBTITLE[effectivePrimaryKey] ?? null;
  if (!subtitle && servingKey)          subtitle = SERVING_STATUS_SUBTITLE[servingKey]           ?? null;
  if (!subtitle && effectivePrimaryKey === 'NOT_ELIGIBLE') subtitle = PRIMARY_STATUS_SUBTITLE.NOT_ELIGIBLE;
  if (!subtitle && (base === 'PAUSED' || parentPaused)) subtitle = 'Campaign is paused';

  return (
    <div className="flex flex-col gap-0.5">
      <span className={`inline-flex w-fit items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold leading-none ${cfg.bg} ${cfg.color}`}>
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${cfg.dot}`} />
        {cfg.label}
      </span>
      {subtitle && (
        <span
          title={STATUS_FIX_HINT[subtitle] || 'Open Google Ads to review and fix this.'}
          className="mt-0.5 w-fit pl-0.5 text-10 leading-tight text-gray-400 dark:text-white/35"
        >
          {subtitle}
        </span>
      )}
    </div>
  );
}

function ToggleSwitch({ status, onToggle, toggling }) {
  const isActive = status === 'ENABLED';
  // Only ENABLED and PAUSED can be toggled — other statuses are controlled by Google
  const canToggle = status === 'ENABLED' || status === 'PAUSED';
  if (!canToggle) return null;
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
      disabled={toggling}
      title={isActive ? 'Pause' : 'Enable'}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors duration-200
        ${isActive ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-white/20'}
        ${toggling ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
    >
      <span
        className={`absolute top-1 left-1 h-3 w-3 rounded-full bg-white shadow transition-transform duration-200
          ${isActive ? 'translate-x-4' : 'translate-x-0'}`}
      />
    </button>
  );
}

// ─── sort hook ────────────────────────────────────────────────────────────────

function useSortedRows(rows, defaultKey) {
  const [sortKey, setSortKey] = useState(defaultKey);
  const [sortDir, setSortDir] = useState('asc');

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  };

  const sorted = [...rows].sort((a, b) => {
    const av = a[sortKey] ?? '';
    const bv = b[sortKey] ?? '';
    const an = parseFloat(String(av).replace(/[^0-9.-]/g, ''));
    const bn = parseFloat(String(bv).replace(/[^0-9.-]/g, ''));
    const cmp = !isNaN(an) && !isNaN(bn) ? an - bn : String(av).localeCompare(String(bv));
    return sortDir === 'asc' ? cmp : -cmp;
  });

  return { sorted, sortKey, sortDir, toggleSort };
}

// ─── sort header ──────────────────────────────────────────────────────────────

function SortTh({ label, colKey, sortKey, sortDir, onSort, className = '' }) {
  const active = sortKey === colKey;
  return (
    <th
      onClick={() => onSort(colKey)}
      className={`cursor-pointer select-none whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 transition-colors hover:text-gray-900 dark:text-white/70 dark:hover:text-white ${className}`}
    >
      <span className="flex items-center gap-2">
        {label}
        <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md transition-all
          ${active ? 'bg-gray-200 text-gray-900 dark:bg-white/15 dark:text-white' : 'bg-gray-100 text-gray-400 dark:bg-white/6 dark:text-white/25'}`}>
          <ArrowUpDown className={`h-3 w-3 transition-transform ${active && sortDir === 'desc' ? 'rotate-180' : ''}`} />
        </span>
      </span>
    </th>
  );
}

// ─── breadcrumb ───────────────────────────────────────────────────────────────

function Breadcrumb({ level, campaign, adGroup, onClickCampaigns, onClickCampaign }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <button
        onClick={onClickCampaigns}
        className={`font-semibold transition-colors
          ${level === 'campaigns' ? 'text-gray-900 dark:text-white' : 'text-gray-400 hover:text-gray-600 dark:text-white/35 dark:hover:text-white/70'}`}
      >
        Campaigns
      </button>
      {campaign && (
        <>
          <ChevronRight className="h-3.5 w-3.5 text-gray-300 dark:text-white/15" />
          <button
            onClick={onClickCampaign}
            className={`max-w-55 truncate font-semibold transition-colors
              ${level === 'adgroups' ? 'text-gray-900 dark:text-white' : 'text-gray-400 hover:text-gray-600 dark:text-white/35 dark:hover:text-white/70'}`}
          >
            {campaign.name}
          </button>
        </>
      )}
      {adGroup && (
        <>
          <ChevronRight className="h-3.5 w-3.5 text-gray-300 dark:text-white/15" />
          <span className="max-w-55 truncate font-semibold text-gray-900 dark:text-white">{adGroup.name}</span>
        </>
      )}
    </div>
  );
}

// ─── add button ───────────────────────────────────────────────────────────────

function AddButton({ label, onClick, busy = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="flex items-center gap-1.5 rounded-xl bg-gray-900 px-3 py-1.5 text-[11px] font-semibold text-white shadow-xs transition-all hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-black dark:hover:bg-gray-100 2xl:text-xs"
    >
      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
      {label}
    </button>
  );
}

function RefreshButton({ onClick, busy = false, title = 'Refresh' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      title={title}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-gray-100 text-gray-400 transition-all hover:border-gray-300 hover:bg-gray-200 hover:text-gray-900 disabled:opacity-50 dark:border-white/8 dark:bg-white/2 dark:text-white/40 dark:hover:border-white/20 dark:hover:bg-white/8 dark:hover:text-white"
    >
      <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />
    </button>
  );
}

// ─── delete confirm modal ─────────────────────────────────────────────────────

function DeleteModal({ item, onConfirm, onCancel, deleting }) {
  if (typeof document === 'undefined') return null;
  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={() => !deleting && onCancel()}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 8 }}
        transition={{ duration: 0.18 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl workspace-card p-6 shadow-2xl dark:border-white/8 dark:bg-[#161616]"
      >
        <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-red-50 dark:bg-red-500/10">
          <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
        </div>
        <p className="text-sm font-bold text-gray-900 dark:text-white">Delete Campaign?</p>
        <p className="mt-1.5 text-xs text-gray-500 dark:text-[#BEBEBE]">
          Are you sure you want to delete <span className="font-semibold text-gray-700 dark:text-white/80">"{item.name}"</span>?
          This will permanently remove the campaign and all its ad groups from Google Ads.
        </p>
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={deleting}
            className="rounded-xl border border-gray-200 bg-gray-100 px-4 py-2 text-xs font-medium text-gray-900 transition-all hover:bg-gray-200 dark:border-white/8 dark:bg-white/5 dark:text-white dark:hover:bg-white/10 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={deleting}
            className="flex items-center gap-1.5 rounded-xl bg-red-500/80 px-4 py-2 text-xs font-bold text-white transition-all hover:bg-red-500 disabled:opacity-50"
          >
            {deleting && <Loader2 className="h-3 w-3 animate-spin" />}
            {deleting ? 'Removing…' : 'Delete'}
          </button>
        </div>
      </motion.div>
    </motion.div>,
    document.body
  );
}

function CampaignTable({
  campaigns,
  loading,
  adAccountId,
  onDrillDown,
  onRefresh,
  onLaunchWizard,
  searchActive,
  query,
  onQueryChange,
  totalCount,
}) {
  const [statuses, setStatuses]           = useState({});
  const [primaryStatuses, setPrimaryStatuses] = useState({});
  const [toggling, setToggling]           = useState({});
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting]           = useState(false);
  const { sorted, sortKey, sortDir, toggleSort } = useSortedRows(campaigns, 'name');

  const getStatus = (c) => statuses[c.campaignId || c.id] ?? c.status;
  const getPrimaryStatus = (c) => primaryStatuses[c.campaignId || c.id] ?? c.primaryStatus;

  const handleToggle = async (c) => {
    const id = c.campaignId || c.id;
    const next = getStatus(c) === 'ENABLED' ? 'PAUSED' : 'ENABLED';
    setToggling((p) => ({ ...p, [id]: true }));
    try {
      await updateGoogleAdStatus({ level: 'campaign', id, adAccountId, status: next });
      setStatuses((p) => ({ ...p, [id]: next }));
      // Don't guess primaryStatus here — Google can take a moment to settle
      // the real derived status after a toggle. Clear any stale override
      // and let the refetch below supply the truth.
      setPrimaryStatuses((p) => { const n = { ...p }; delete n[id]; return n; });
      globalToast.success('Campaign status updated');
      // The optimistic override above only lives in this component's local
      // state — it's lost if the table unmounts (e.g. switching tabs and
      // back). Refetch so the underlying campaigns data actually reflects
      // the change, not just this session's in-memory override.
      onRefresh?.();
    } catch (err) { globalToast.error(err?.response?.data?.error || err?.response?.data?.details || 'Failed to update campaign status'); }
    finally  { setToggling((p) => ({ ...p, [id]: false })); }
  };

  const handleConfirmDelete = async () => {
    if (!pendingDelete || !adAccountId) return;
    setDeleting(true);
    try {
      await deleteGoogleCampaign({ adAccountId, campaignId: pendingDelete.campaignId || pendingDelete.id });
      globalToast.success('Campaign deleted');
      setPendingDelete(null);
      onRefresh?.();
    } catch (err) {
      globalToast.error(err?.response?.data?.error || 'Failed to delete campaign');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl workspace-card dark:border-white/10 dark:bg-[#141414]">
      {/* Top action bar inside card — matching Meta table structure */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-gray-200 p-3 dark:border-white/12">
        <div className="flex min-w-0 items-center gap-2">
          <p className="truncate text-xs font-semibold text-gray-500 dark:text-white/70">
            {totalCount ?? campaigns.length} campaign{(totalCount ?? campaigns.length) === 1 ? '' : 's'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative w-56">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-white/40" />
            <input
              type="text"
              value={query || ''}
              onChange={(e) => onQueryChange?.(e.target.value)}
              placeholder="Search campaigns…"
              className="w-full rounded-full border border-gray-300 bg-gray-100 py-1.5 pl-9 pr-9 text-xs text-gray-900 placeholder:text-gray-400 transition-colors hover:border-gray-400 focus:border-gray-400 focus:outline-none dark:border-white/10 dark:bg-[#171717] dark:text-white dark:placeholder:text-white/40 dark:hover:border-white/15 dark:focus:border-white/25"
            />
            {query && (
              <button
                type="button"
                onClick={() => onQueryChange?.('')}
                className="absolute top-1/2 right-3 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:text-white/40 dark:hover:text-white/70"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <RefreshButton onClick={onRefresh} busy={loading} title="Refresh campaigns" />
          {onLaunchWizard && (
            <button
              type="button"
              onClick={() => onLaunchWizard('create-full')}
              disabled={!adAccountId}
              className="flex items-center gap-1.5 rounded-xl bg-gray-900 px-3 py-1.5 text-[11px] font-semibold text-white shadow-xs transition-all hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-black dark:hover:bg-gray-100 2xl:text-xs"
            >
              <Plus className="h-3 w-3" />
              New Campaign
            </button>
          )}
        </div>
      </div>
      <div className="scrollbar-thin flex-1 overflow-auto">
        <table className="w-full min-w-190 border-collapse">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 dark:border-white/12 dark:bg-[#181818]">
              <SortTh label="Campaign"       colKey="name"              sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="w-[34%] pl-5" />
              <SortTh label="Status"           colKey="status"            sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              <SortTh label="Objective"        colKey="objective"         sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              <SortTh label="Daily Budget"     colKey="dailyBudgetMicros" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              <SortTh label="Budget Remaining" colKey="budget_remaining"  sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              <SortTh label="Start Date"        colKey="startDate"         sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              <SortTh label="End Date"          colKey="endDate"           sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              <th className="w-20 pr-5 pl-2 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-white/70">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr className="google-ads-table-static-row"><td colSpan={8} className="py-14"><Spinner /></td></tr>
            )}
            {!loading && sorted.length === 0 && (
              <tr className="google-ads-table-static-row"><td colSpan={8} className="py-14"><EmptyState message={searchActive ? "No campaigns match your search" : "No campaigns found for this account"} /></td></tr>
            )}
            {!loading && sorted.map((c, idx) => {
              const id        = c.campaignId || c.id;
              const status    = getStatus(c);
              const budget    = fromMicros(c.dailyBudgetMicros);
              const remaining = c.budget_remaining || (c.budgetRemainingMicros != null ? `₹${fromMicros(c.budgetRemainingMicros)}` : null);
              return (
                <motion.tr
                  key={id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: idx * 0.03 }}
                  onClick={() => onDrillDown(c)}
                  className="group cursor-pointer border-b border-gray-200 transition-colors hover:bg-gray-100 dark:border-white/10 dark:hover:bg-white/3 last:border-b-0"
                >
                  {/* name */}
                  <td className="pl-5 pr-4 py-4">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-gray-900 dark:text-white leading-tight">{c.name}</p>
                      <p className="mt-0.5 font-mono text-11 text-gray-400 dark:text-white/40">ID: {id}</p>
                    </div>
                  </td>
                  {/* status — Google-style serving status */}
                  <td className="px-4 py-4">
                    <GoogleServingStatus
                      status={status}
                      primaryStatus={getPrimaryStatus(c)}
                      servingStatus={c.servingStatus}
                    />
                  </td>
                  {/* objective */}
                  <td className="px-4 py-4">
                    <span className="flex items-center gap-1.5 text-sm text-gray-600 dark:text-white/80">
                      <Target className="h-3.5 w-3.5 shrink-0 text-gray-400 dark:text-white/30" />
                      {c.objective ?? c.channelType ?? '—'}
                    </span>
                  </td>
                  {/* budget */}
                  <td className="px-4 py-4 text-sm font-medium text-gray-600 dark:text-white/80">
                    {budget ? `₹${budget}` : <span className="text-gray-400 dark:text-white/40">—</span>}
                  </td>
                  {/* remaining */}
                  <td className="px-4 py-4 text-sm text-gray-600 dark:text-white/80">
                    {hasBudget(remaining) ? remaining : <span className="text-gray-400 dark:text-white/40">—</span>}
                  </td>
                  {/* start date */}
                  <td className="px-4 py-4 text-sm text-gray-600 dark:text-white/80">
                    {c.startDate ? formatDisplayDate(c.startDate) : <span className="text-gray-400 dark:text-white/40">—</span>}
                  </td>
                  {/* end date */}
                  <td className="px-4 py-4 text-sm text-gray-600 dark:text-white/80">
                    {c.endDate ? formatDisplayDate(c.endDate) : <span className="text-gray-400 dark:text-white/40">—</span>}
                  </td>
                  {/* actions */}
                  <td className="pr-5 pl-2 py-4">
                    <div className="flex items-center justify-end gap-1.5">
                      {(status === 'ENABLED' || status === 'PAUSED') && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleToggle(c); }}
                          disabled={!!toggling[id]}
                          title={status === 'ENABLED' ? 'Running — click to pause' : 'Paused — click to enable'}
                          className={`flex h-8 w-8 items-center justify-center rounded-lg border transition-all disabled:opacity-50 ${
                            status === 'ENABLED'
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-600 hover:border-emerald-300 hover:bg-emerald-100 dark:border-emerald-500/20 dark:bg-emerald-500/8 dark:text-emerald-400 dark:hover:bg-emerald-500/15'
                              : 'border-gray-200 bg-gray-100 text-gray-500 hover:border-gray-300 hover:bg-gray-200 hover:text-gray-900 dark:border-white/8 dark:bg-white/2 dark:text-white/40 dark:hover:border-white/20 dark:hover:bg-white/8 dark:hover:text-white'
                          }`}
                        >
                          {toggling[id] ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : status === 'ENABLED' ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                        </button>
                      )}
                      {onLaunchWizard && (
                        <button
                          onClick={(e) => { e.stopPropagation(); onLaunchWizard('edit-campaign', { campaignId: id, objective: c.objective, destination: c.channelType || c.objective, campaignName: c.name, dailyBudget: budget || '', status: c.status, startDate: c.startDate || c.start_time, endDate: c.endDate || c.end_time }); }}
                          title="Edit campaign"
                          className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-gray-100 text-gray-400 transition-all hover:border-gray-300 hover:bg-gray-200 hover:text-gray-900 dark:border-white/8 dark:bg-white/2 dark:text-white/40 dark:hover:border-white/20 dark:hover:bg-white/8 dark:hover:text-white"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); setPendingDelete(c); }}
                        title="Remove campaign"
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-red-200 bg-red-50 text-red-400 transition-all hover:border-red-300 hover:bg-red-100 hover:text-red-600 dark:border-red-500/20 dark:bg-red-500/5 dark:text-red-400/60 dark:hover:border-red-500/40 dark:hover:bg-red-500/10 dark:hover:text-red-400"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </motion.tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <AnimatePresence>
        {pendingDelete && (
          <DeleteModal
            item={pendingDelete}
            onConfirm={handleConfirmDelete}
            onCancel={() => !deleting && setPendingDelete(null)}
            deleting={deleting}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── ad group table (level 2) ─────────────────────────────────────────────────

function AdGroupTable({ campaign, adAccountId, onDrillDown, onLaunchWizard, manageNonce }) {
  const isPmax = String(campaign.objective || campaign.channelType || '').toUpperCase().includes('PERFORMANCE_MAX');
  const [adGroups,     setAdGroups]     = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [refreshing,   setRefreshing]   = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [statuses,        setStatuses]        = useState({});
  const [primaryStatuses, setPrimaryStatuses] = useState({});
  const [toggling,        setToggling]        = useState({});
  const [pendingDelete,   setPendingDelete]   = useState(null);
  const [deleting,        setDeleting]        = useState(false);
  const [adGroupSearch,   setAdGroupSearch]   = useState('');
  const filteredAdGroups = adGroupSearch.trim()
    ? adGroups.filter((g) => {
        const q = adGroupSearch.trim().toLowerCase();
        return (g.name || '').toLowerCase().includes(q) || String(g.adGroupId || g.id || '').toLowerCase().includes(q);
      })
    : adGroups;
  const { sorted, sortKey, sortDir, toggleSort } = useSortedRows(filteredAdGroups, 'name');

  const handleRefresh = () => { setRefreshing(true); setRefreshNonce((n) => n + 1); };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getGoogleAdGroups({ adAccountId, campaignId: campaign.campaignId || campaign.id, channelType: campaign.channelType || campaign.objective, refresh: true })
      .then((r) => { if (!cancelled) setAdGroups(r.adGroups || []); })
      .catch((e) => {
        if (!cancelled) {
          setAdGroups([]);
          globalToast.error(e?.response?.data?.error || e?.response?.data?.details || 'Failed to load ad groups');
        }
      })
      .finally(() => { if (!cancelled) { setLoading(false); setRefreshing(false); } });
    return () => { cancelled = true; };
  }, [campaign.campaignId, campaign.id, adAccountId, manageNonce, refreshNonce]);

  const getStatus = (g) => statuses[g.adGroupId || g.id] ?? g.status;
  const getPrimaryStatus = (g) => primaryStatuses[g.adGroupId || g.id] ?? g.primaryStatus;

  const handleToggle = async (g) => {
    const isAssetGroup = g.isPmax || g.type === 'ASSET_GROUP';
    const id = g.adGroupId || g.id;
    const next = getStatus(g) === 'ENABLED' ? 'PAUSED' : 'ENABLED';
    setToggling((p) => ({ ...p, [id]: true }));
    try {
      await updateGoogleAdStatus({ level: 'adgroup', id, adAccountId, status: next, isPmax: isAssetGroup, entityType: isAssetGroup ? 'ASSET_GROUP' : undefined });
      setStatuses((p) => ({ ...p, [id]: next }));
      // Don't guess primaryStatus here — Google derives it from the parent
      // campaign too (e.g. staying "Not eligible" while the campaign is
      // paused, even though this row's own status just changed to ENABLED).
      // Clear any stale override and let the refetch below supply the truth.
      setPrimaryStatuses((p) => { const n = { ...p }; delete n[id]; return n; });
      globalToast.success(isAssetGroup ? 'Asset group status updated' : 'Ad group status updated');
      // Local override is lost on unmount (e.g. drilling into ads and back) —
      // refetch so the underlying data reflects the real, persisted status.
      setRefreshNonce((n) => n + 1);
    } catch (err) { globalToast.error(err?.response?.data?.error || err?.response?.data?.details || `Failed to update ${isAssetGroup ? 'asset' : 'ad'} group status`); }
    finally  { setToggling((p) => ({ ...p, [id]: false })); }
  };

  const handleConfirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await deleteGoogleAdGroup({ adAccountId, adGroupId: pendingDelete.adGroupId || pendingDelete.id, campaignId: campaign.campaignId || campaign.id, isPmax });
      setAdGroups((prev) => prev.filter((g) => (g.adGroupId || g.id) !== (pendingDelete.adGroupId || pendingDelete.id)));
      globalToast.success(isPmax ? 'Asset group deleted' : 'Ad group deleted');
      setPendingDelete(null);
    } catch (err) { globalToast.error(err?.response?.data?.error || 'Failed to delete'); }
    finally { setDeleting(false); }
  };

  return (
    <>
    {pendingDelete && typeof document !== 'undefined' && createPortal(
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-4 backdrop-blur-md" onClick={() => !deleting && setPendingDelete(null)}>
        <div className="w-full max-w-sm rounded-2xl border border-gray-200/80 bg-white p-6 shadow-2xl backdrop-blur-xl dark:border-white/10 dark:bg-[#1a1a1a]" onClick={(e) => e.stopPropagation()}>
          <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-red-50 dark:bg-red-500/10">
            <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
          </div>
          <p className="text-sm font-bold text-gray-900 dark:text-white">Permanently remove this {isPmax ? 'asset group' : 'ad group'}?</p>
          <p className="mt-1.5 text-xs text-gray-500 dark:text-white/50">
            Once removed, <span className="font-semibold text-gray-700 dark:text-white/80">"{pendingDelete.name}"</span> can't be re-enabled.
            Instead of removing, you can pause it to stop accumulating new charges — paused {isPmax ? 'asset groups' : 'ad groups'} can be re-enabled at any time.
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <button onClick={() => setPendingDelete(null)} disabled={deleting} className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-white/10 dark:bg-white/4 dark:text-white/60">Cancel</button>
            <button onClick={handleConfirmDelete} disabled={deleting} className="flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-60">
              {deleting && <Loader2 className="h-3 w-3 animate-spin" />}
              {deleting ? 'Removing…' : 'Remove'}
            </button>
          </div>
        </div>
      </div>,
      document.body
    )}
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl workspace-card dark:border-white/10 dark:bg-[#141414]">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-gray-200 bg-gray-50 px-4 py-2.5 dark:border-white/10 dark:bg-[#181818]">
        <p className="truncate text-xs font-semibold text-gray-500 dark:text-white/70">
          {isPmax ? 'Asset groups' : 'Ad groups'} in <span className="text-gray-900 dark:text-white">{campaign.name}</span>
        </p>
        <div className="flex items-center gap-2">
          {isPmax && (
            <span className="inline-flex items-center rounded-full border border-[#4285F4]/30 bg-[#4285F4]/10 px-2.5 py-0.5 text-10 font-semibold text-[#4285F4]">
              Performance Max
            </span>
          )}
          <div className="relative w-56">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-white/40" />
            <input
              type="text"
              value={adGroupSearch}
              onChange={(e) => setAdGroupSearch(e.target.value)}
              placeholder={`Search ${isPmax ? 'asset' : 'ad'} groups…`}
              className="w-full rounded-full border border-gray-300 bg-gray-100 py-1.5 pl-9 pr-9 text-xs text-gray-900 placeholder:text-gray-400 transition-colors hover:border-gray-400 focus:border-gray-400 focus:outline-none dark:border-white/10 dark:bg-[#171717] dark:text-white dark:placeholder:text-white/40 dark:hover:border-white/15 dark:focus:border-white/25"
            />
            {adGroupSearch && (
              <button
                type="button"
                onClick={() => setAdGroupSearch('')}
                className="absolute top-1/2 right-3 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:text-white/40 dark:hover:text-white/70"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <RefreshButton onClick={handleRefresh} busy={refreshing} title={`Refresh ${isPmax ? 'asset' : 'ad'} groups`} />
          {onLaunchWizard && !isPmax && (
            <AddButton
              label="Add Ad Group"
              onClick={() => onLaunchWizard('create-adgroup', { campaignId: campaign.campaignId || campaign.id, objective: campaign.objective, destination: campaign.channelType || campaign.objective })}
            />
          )}
          {onLaunchWizard && isPmax && (
            <AddButton
              label="New Asset Group"
              onClick={() => onLaunchWizard('create-adgroup', { campaignId: campaign.campaignId || campaign.id, objective: campaign.objective, destination: campaign.channelType || campaign.objective })}
            />
          )}
        </div>
      </div>
      <div className="scrollbar-thin flex-1 overflow-auto">
        <table className="w-full min-w-150 border-collapse">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 dark:border-white/12 dark:bg-[#181818]">
              <SortTh label={isPmax ? 'Asset Group' : 'Ad Group'} colKey="name" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="w-[35%] pl-5" />
              <SortTh label="Status"     colKey="status"       sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              <SortTh label="Type"       colKey="type"         sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              <SortTh label="Bidding"    colKey="biddingGoal"  sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              <SortTh label="Max CPC"    colKey="cpcBidMicros" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              {onLaunchWizard && <th className="w-24 pr-5 pl-2 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-white/70">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr className="google-ads-table-static-row"><td colSpan={onLaunchWizard ? 6 : 5} className="py-14"><Spinner /></td></tr>
            )}
            {!loading && sorted.length === 0 && (
              <tr className="google-ads-table-static-row"><td colSpan={onLaunchWizard ? 6 : 5} className="py-14"><EmptyState message={adGroupSearch.trim() ? `No ${isPmax ? 'asset' : 'ad'} groups match your search` : (isPmax ? 'No asset groups in this campaign' : 'No ad groups in this campaign')} /></td></tr>
            )}
            {!loading && sorted.map((g, idx) => {
              const id     = g.adGroupId || g.id;
              const status = getStatus(g);
              const cpc    = fromMicros(g.cpcBidMicros);
              const adGroupType = (() => {
                const raw = String(g.type || '').toUpperCase();
                const MAP = {
                  SEARCH_STANDARD:       'Search',
                  DISPLAY_STANDARD:      'Display',
                  SHOPPING_SMART_ADS:    'Shopping Smart',
                  SHOPPING_PRODUCT_ADS:  'Shopping',
                  VIDEO_BUMPER:          'Video Bumper',
                  VIDEO_TRUE_VIEW_IN_STREAM: 'In-Stream',
                  VIDEO_TRUE_VIEW_IN_DISPLAY: 'In-Display',
                  VIDEO_RESPONSIVE:      'Video',
                  DEMAND_GEN_MAX_CONVERSIONS: 'Demand Gen',
                  UNKNOWN:               '—',
                  UNSPECIFIED:           '—',
                };
                return MAP[raw] || raw.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) || '—';
              })();
              const bidding = g.biddingGoal
                ? String(g.biddingGoal).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
                : g.targetCpa ? `Target CPA: ₹${g.targetCpa}`
                : g.targetRoas ? `Target ROAS: ${g.targetRoas}%`
                : 'Maximize Clicks';
              return (
                <motion.tr
                  key={id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: idx * 0.03 }}
                  onClick={() => onDrillDown(g)}
                  className="group cursor-pointer border-b border-gray-200 transition-colors hover:bg-gray-100 dark:border-white/10 dark:hover:bg-white/3 last:border-b-0"
                >
                  {/* name */}
                  <td className="pl-5 pr-4 py-4">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-gray-900 dark:text-white">{g.name}</p>
                      <p className="mt-0.5 font-mono text-11 text-gray-400 dark:text-white/40">ID: {id}</p>
                    </div>
                  </td>
                  {/* status */}
                  <td className="px-4 py-4">
                    <GoogleServingStatus
                      status={status}
                      primaryStatus={getPrimaryStatus(g)}
                      servingStatus={g.servingStatus}
                      parentCampaignStatus={g.campaignStatus || campaign?.status}
                    />
                  </td>
                  {/* type */}
                  <td className="px-4 py-4">
                    <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-100 px-2.5 py-0.5 text-10 font-semibold text-gray-600 dark:border-white/8 dark:bg-white/5 dark:text-white/60">
                      {adGroupType}
                    </span>
                  </td>
                  {/* bidding */}
                  <td className="px-4 py-4 text-xs text-gray-600 dark:text-white/80">
                    {bidding}
                  </td>
                  {/* max cpc */}
                  <td className="px-4 py-4 text-sm font-medium text-gray-600 dark:text-white/80">
                    {cpc ? (
                      <span className="flex items-center gap-1.5">
                        <DollarSign className="h-3.5 w-3.5 shrink-0 text-gray-400 dark:text-white/30" />
                        ₹{cpc}
                      </span>
                    ) : <span className="text-gray-400 dark:text-white/40">—</span>}
                  </td>
                  {onLaunchWizard && (
                    <td className="pr-5 pl-2 py-4">
                      <div className="flex items-center justify-end gap-1.5">
                        {(status === 'ENABLED' || status === 'PAUSED') && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleToggle(g); }}
                            disabled={!!toggling[id]}
                            title={status === 'ENABLED' ? 'Running — click to pause' : 'Paused — click to enable'}
                            className={`flex h-8 w-8 items-center justify-center rounded-lg border transition-all disabled:opacity-50 ${
                              status === 'ENABLED'
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-600 hover:border-emerald-300 hover:bg-emerald-100 dark:border-emerald-500/20 dark:bg-emerald-500/8 dark:text-emerald-400 dark:hover:bg-emerald-500/15'
                                : 'border-gray-200 bg-gray-100 text-gray-500 hover:border-gray-300 hover:bg-gray-200 hover:text-gray-900 dark:border-white/8 dark:bg-white/2 dark:text-white/40 dark:hover:border-white/20 dark:hover:bg-white/8 dark:hover:text-white'
                            }`}
                          >
                            {toggling[id] ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : status === 'ENABLED' ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                          </button>
                        )}
                        <button
                          onClick={(e) => { e.stopPropagation(); onLaunchWizard('edit-adgroup', isPmax
                            ? { campaignId: campaign.campaignId || campaign.id, adGroupId: id, adAccountId, adGroupName: g.name, isPmax: true, status: g.status, objective: campaign.objective, destination: campaign.channelType || campaign.objective }
                            : { campaignId: campaign.campaignId || campaign.id, adGroupId: id, adGroupName: g.name, cpcBid: cpc || '', status: g.status, objective: campaign.objective, destination: campaign.channelType || campaign.objective }); }}
                          title={isPmax ? 'Edit asset group' : 'Edit ad group'}
                          className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-gray-100 text-gray-400 transition-all hover:border-gray-300 hover:bg-gray-200 hover:text-gray-900 dark:border-white/8 dark:bg-white/2 dark:text-white/40 dark:hover:border-white/20 dark:hover:bg-white/8 dark:hover:text-white"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); setPendingDelete(g); }}
                          title={isPmax ? 'Remove asset group' : 'Remove ad group'}
                          className="flex h-8 w-8 items-center justify-center rounded-lg border border-red-200 bg-red-50 text-red-400 transition-all hover:border-red-300 hover:bg-red-100 hover:text-red-600 dark:border-red-500/20 dark:bg-red-500/5 dark:text-red-400/60 dark:hover:border-red-500/40 dark:hover:bg-red-500/10 dark:hover:text-red-400"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  )}
                </motion.tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
    </>
  );
}

// ─── ad preview drawer ────────────────────────────────────────────────────────

function GoogleAdDrawer({ ad, adAccountId, onClose, onStatusChange }) {
  const [localStatus, setLocalStatus] = useState(null);
  const [toggling, setToggling] = useState(false);
  const currentStatus = localStatus ?? ad.status;
  const ctaLabel = labelGoogleCTA(ad.callToAction);
  const headline = adCopyText(ad.longHeadline) || adCopyText(ad.headline) || adCopyText(ad.headlines?.[0]);
  const body = adCopyText(ad.description) || adCopyText(ad.descriptions?.[0]);
  const headlineVariants = (ad.headlines || []).map(adCopyText).filter(Boolean);
  const bodyVariants = (ad.descriptions || []).map(adCopyText).filter(Boolean);

  const handleToggle = async () => {
    const id = ad.adId || ad.id;
    const next = currentStatus === 'ENABLED' ? 'PAUSED' : 'ENABLED';
    setToggling(true);
    try {
      await updateGoogleAdStatus({ level: 'ad', id, adAccountId, adGroupId: ad.adGroupId, status: next });
      setLocalStatus(next);
      onStatusChange?.(id, next);
      globalToast.success('Ad status updated');
    } catch {
      globalToast.error('Failed to update ad status');
    } finally {
      setToggling(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 24 }}
      transition={{ duration: 0.22, ease: 'easeOut' }}
      className="flex w-90 shrink-0 flex-col overflow-hidden rounded-2xl workspace-card dark:border-white/10 dark:bg-[#181818]"
    >
      <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4 dark:border-white/12">
        <div>
          <p className="text-sm font-bold text-gray-900 dark:text-white">Ad Preview</p>
          <p className="mt-0.5 max-w-60 truncate text-xs text-gray-400 dark:text-[#555]">
            {headline || ad.name || `Ad ${ad.adId || ad.id}`}
          </p>
        </div>
        <button
          onClick={onClose}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-[#555] dark:hover:bg-white/8 dark:hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="scrollbar-thin flex-1 overflow-y-auto">
        <div className="relative w-full bg-gray-50 dark:bg-[#141414]">
          {/* Search ad preview — mimics Google SERP result */}
          {(ad.type === 'RESPONSIVE_SEARCH_AD' || (!ad.videoUrl && !ad.imageUrl)) && ad.type !== 'RESPONSIVE_DISPLAY_AD' ? (
            <div className="bg-white p-4 dark:bg-[#202124]">
              {/* Google search bar mockup */}
              <div className="mb-4 flex items-center gap-2 rounded-full border border-gray-300 bg-white px-4 py-2 shadow-sm dark:border-white/15 dark:bg-[#303134]">
                {/* Multicolour Google G */}
                <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                <span className="flex-1 text-xs text-gray-400 dark:text-white/40">Search preview</span>
                <svg className="h-4 w-4 text-[#4285F4]" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
                </svg>
              </div>

              {/* SERP-style ad card — matches current Google Ads search result layout */}
              <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-[#303134]">
                {/* Row 1: favicon + domain + Ad badge */}
                <div className="mb-2 flex items-center gap-2">
                  {/* Favicon placeholder */}
                  <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gray-100 dark:bg-white/10">
                    <span className="text-[8px] font-bold text-gray-500 dark:text-white/50">
                      {ad.finalUrl
                        ? (() => { try { return new URL(ad.finalUrl).hostname.replace('www.', '')[0].toUpperCase(); } catch { return 'A'; } })()
                        : 'A'}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] font-medium text-gray-800 dark:text-[#e8eaed]">
                      {ad.finalUrl
                        ? (() => { try { return new URL(ad.finalUrl).hostname.replace('www.', ''); } catch { return ad.finalUrl; } })()
                        : 'your-website.com'}
                    </p>
                    <p className="truncate text-[11px] text-gray-500 dark:text-[#bdc1c6]">
                      {ad.finalUrl
                        ? (() => { try {
                            const u = new URL(ad.finalUrl);
                            const parts = [u.hostname.replace('www.', '')];
                            if (ad.path1) parts.push(ad.path1);
                            if (ad.path2) parts.push(ad.path2);
                            return parts.join(' › ');
                          } catch { return ad.finalUrl; } })()
                        : ''}
                    </p>
                  </div>
                  {/* Google-style Ad badge: black outlined, small */}
                  <span className="shrink-0 rounded border border-gray-500 px-1 py-px text-[9px] font-medium text-gray-500 dark:border-[#bdc1c6] dark:text-[#bdc1c6]">
                    Ad
                  </span>
                </div>

                {/* Row 2: Headline (Google blue, 20px, links look) */}
                <p className="mb-1.5 text-[18px] font-normal leading-snug text-[#1558d6] hover:underline dark:text-[#8ab4f8]">
                  {headlineVariants.slice(0, 3).join(' | ') || headline || '—'}
                </p>

                {/* Row 3: Description */}
                <p className="text-13 leading-relaxed text-gray-600 dark:text-[#bdc1c6]">
                  {bodyVariants[0] || body || ''}
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2.5 border-b border-gray-200 px-4 py-2.5 dark:border-white/5">
                <div className="h-7 w-7 rounded-full bg-gray-200 dark:bg-white/10" />
                <div>
                  <p className="text-xs font-semibold text-gray-900 dark:text-white">Sponsored</p>
                  <p className="text-10 text-gray-400 dark:text-[#444]">
                    Google · {ad.type === 'RESPONSIVE_DISPLAY_AD' ? 'Display' : ad.videoUrl ? 'Video' : 'Display'}
                  </p>
                </div>
              </div>
              {ad.videoUrl ? (
                <div className="relative aspect-video w-full bg-black">
                  <iframe
                    title="Ad video"
                    src={`https://www.youtube.com/embed/${String(ad.videoUrl).split('v=').pop()}`}
                    className="h-full w-full"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                </div>
              ) : ad.imageUrl ? (
                <div className="relative aspect-video w-full">
                  <img src={ad.imageUrl} alt={headline || 'Ad preview'} className="h-full w-full object-cover" />
                </div>
              ) : (
                <div className="flex aspect-video w-full items-center justify-center">
                  <ImageIcon className="h-10 w-10 text-gray-300 dark:text-white/15" />
                </div>
              )}
            </>
          )}
          <div className="space-y-2 border-t border-gray-200 p-4 dark:border-white/8">
            {ad.businessName && (
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-white/40">{adCopyText(ad.businessName)}</p>
            )}
            <p className="text-sm font-semibold text-gray-900 dark:text-white">{headline || '—'}</p>
            {body && <p className="text-xs leading-relaxed text-gray-500 dark:text-white/60">{body}</p>}
            {ctaLabel && (
              <div className="mt-3 flex items-center justify-between">
                {ad.finalUrl ? (
                  <a href={ad.finalUrl} target="_blank" rel="noopener noreferrer"
                    className="rounded-lg border border-gray-200 bg-gray-100 px-3 py-1.5 text-xs font-semibold text-gray-900 dark:border-white/10 dark:bg-white/6 dark:text-white">
                    {ctaLabel}
                  </a>
                ) : (
                  <span className="rounded-lg border border-gray-200 bg-gray-100 px-3 py-1.5 text-xs font-semibold text-gray-900 dark:border-white/10 dark:bg-white/6 dark:text-white">
                    {ctaLabel}
                  </span>
                )}
                {ad.finalUrl && (
                  <a href={ad.finalUrl} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1 text-[11px] font-medium text-gray-400 hover:text-gray-600 dark:text-white/50 dark:hover:text-white/80">
                    Visit site <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            )}
          </div>
        </div>

        {(headlineVariants.length > 1 || bodyVariants.length > 1) && (
          <div className="border-t border-gray-200 p-5 dark:border-white/8">
            <p className="mb-2 text-10 font-bold uppercase tracking-wider text-gray-400 dark:text-white/40">Variants</p>
            {headlineVariants.length > 1 && (
              <div className="mb-2">
                <p className="text-10 text-gray-400 dark:text-white/30">Headlines</p>
                <ul className="mt-1 space-y-0.5 text-xs text-gray-600 dark:text-white/70">
                  {headlineVariants.map((h) => <li key={h}>• {h}</li>)}
                </ul>
              </div>
            )}
            {bodyVariants.length > 1 && (
              <div>
                <p className="text-10 text-gray-400 dark:text-white/30">Descriptions</p>
                <ul className="mt-1 space-y-0.5 text-xs text-gray-600 dark:text-white/70">
                  {bodyVariants.map((d) => <li key={d}>• {d}</li>)}
                </ul>
              </div>
            )}
          </div>
        )}

        <div className="space-y-3 border-t border-gray-200 p-5 dark:border-white/8">
          <p className="text-10 font-bold uppercase tracking-wider text-gray-400 dark:text-white/40">Details</p>
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-400 dark:text-white/40">Status</span>
            <div className="flex items-center gap-2">
              <GoogleServingStatus
                status={currentStatus}
                approvalStatus={ad.approvalStatus}
                reviewStatus={ad.reviewStatus}
              />
              <ToggleSwitch status={currentStatus} onToggle={handleToggle} toggling={toggling} />
            </div>
          </div>
          {ad.finalUrl && (
            <div>
              <p className="mb-1 text-xs text-gray-400 dark:text-white/40">Final URL</p>
              <p className="break-all text-xs text-gray-600 dark:text-white/70">{ad.finalUrl}</p>
            </div>
          )}
          {ad.approvalStatus && (
            <div>
              <p className="mb-1 text-xs text-gray-400 dark:text-white/40">Approval</p>
              <p className="text-xs text-gray-600 dark:text-white/70">{ad.approvalStatus}</p>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// ─── PMAX asset group detail view ─────────────────────────────────────────────

// Mirrors Google's own Asset Details table: assets aren't individually
// policy-reviewed for PMax — eligibility tracks the parent campaign's status.
function assetEligibility(campaign) {
  const status = String(campaign?.status || '').toUpperCase();
  if (status === 'PAUSED') return { eligible: false, reason: 'Campaign is paused' };
  if (status === 'ENDED') return { eligible: false, reason: 'Campaign has ended' };
  if (status === 'REMOVED') return { eligible: false, reason: 'Campaign was removed' };
  return { eligible: true, reason: null };
}

function PmaxAssetGroupDetail({ adGroup, campaign, adAccountId, manageNonce, onLaunchWizard, externalRefreshNonce, onRefreshDone, assetSearch = '' }) {
  const [data,        setData]        = useState(null);
  const [loading,     setLoading]     = useState(true);
  const [refreshing,  setRefreshing]  = useState(false);
  const [nonce,       setNonce]       = useState(0);
  const [deletingRN,  setDeletingRN]  = useState(null);
  const [pendingDeleteAsset, setPendingDeleteAsset] = useState(null);

  const agId = adGroup.adGroupId || adGroup.id;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getGoogleAdGroupAds({ adAccountId, adGroupId: agId, refresh: true })
      .then((r) => { if (!cancelled) { const item = (r.ads || [])[0] || null; setData(item); } })
      .catch(() => { if (!cancelled) setData(null); })
      .finally(() => { if (!cancelled) { setLoading(false); setRefreshing(false); onRefreshDone?.(); } });
    return () => { cancelled = true; };
  }, [agId, adAccountId, manageNonce, nonce, externalRefreshNonce]);

  const refresh = () => { setRefreshing(true); setNonce(n => n + 1); };

  const handleDeleteAsset = async () => {
    const asset = pendingDeleteAsset;
    if (!asset?.assetRN) { globalToast.error('Asset resource name not available'); return; }
    setDeletingRN(asset.assetRN);
    try {
      await removeAssetFromAssetGroup({
        adAccountId,
        assetGroupId: agId,
        assetResourceName: asset.assetRN,
        fieldType: asset.fieldType,
      });
      globalToast.success('Asset removed');
      setPendingDeleteAsset(null);
      refresh();
    } catch (e) {
      globalToast.error(e?.response?.data?.message || e?.response?.data?.error || e?.response?.data?.details || e?.message || 'Failed to remove asset');
    } finally {
      setDeletingRN(null);
    }
  };

  if (loading) return <div className="flex items-center justify-center py-16"><Spinner /></div>;
  if (!data) return (
    <div className="flex flex-col items-center justify-center py-16 text-gray-400 dark:text-white/30">
      <Layers className="mb-2 h-8 w-8 opacity-40" />
      <p className="text-sm">No assets found in this asset group</p>
    </div>
  );

  const allRows = [
    ...(data.headlines || []).map((h) => ({ kind: 'Headline', text: typeof h === 'object' ? h.text : h, ...h })),
    ...(data.descriptions || []).map((d) => ({ kind: 'Description', text: typeof d === 'object' ? d.text : d, ...d })),
    ...(data.images || []).map((img) => ({ kind: img.fieldType === 'SQUARE_MARKETING_IMAGE' ? 'Square image' : 'Image', ...img })),
    ...(data.logos || []).map((logo) => ({ kind: 'Logo', ...logo })),
  ];
  const rows = assetSearch.trim()
    ? allRows.filter((row) => {
        const q = assetSearch.trim().toLowerCase();
        return (row.text || '').toLowerCase().includes(q) || row.kind.toLowerCase().includes(q) || String(row.assetId || '').toLowerCase().includes(q);
      })
    : allRows;
  const effCampaign = data.campaignStatus ? { status: data.campaignStatus } : campaign;
  const { eligible, reason } = assetEligibility(effCampaign);

  const renderAssetTable = () => (
    <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-white/8">
      <div className="scrollbar-thin overflow-x-auto">
        <table className="w-full min-w-220 border-collapse">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 dark:border-white/10 dark:bg-[#181818]">
              <th className="py-2.5 pl-4 pr-3 text-left text-10 font-semibold uppercase tracking-wider text-gray-500 dark:text-white/60">Asset</th>
              <th className="px-3 py-2.5 text-left text-10 font-semibold uppercase tracking-wider text-gray-500 dark:text-white/60">Type</th>
              <th className="px-3 py-2.5 text-left text-10 font-semibold uppercase tracking-wider text-gray-500 dark:text-white/60">Status</th>
              <th className="px-3 py-2.5 text-right text-10 font-semibold uppercase tracking-wider text-gray-500 dark:text-white/60">Impr.</th>
              <th className="px-3 py-2.5 text-right text-10 font-semibold uppercase tracking-wider text-gray-500 dark:text-white/60">Clicks</th>
              <th className="px-3 py-2.5 text-right text-10 font-semibold uppercase tracking-wider text-gray-500 dark:text-white/60">Cost</th>
              <th className="px-3 py-2.5 text-right text-10 font-semibold uppercase tracking-wider text-gray-500 dark:text-white/60">Conversions</th>
              {onLaunchWizard && <th className="w-36 pr-5 pl-3 py-2.5 text-right text-10 font-semibold uppercase tracking-wider text-gray-500 dark:text-white/60">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const m = row.metrics || { impressions: 0, clicks: 0, cost: 0, conversions: 0 };
              // Individual PMax assets have no enable/pause state of their own
              // in Google Ads — eligibility is purely inherited from the
              // asset group / campaign above.
              return (
                <tr key={row.assetRN || i} className="group border-b border-gray-100 last:border-b-0 dark:border-white/6">
                  <td className="py-2.5 pl-4 pr-3">
                    {row.url ? (
                      <img src={row.url} alt={row.kind} className="h-10 w-14 rounded-md border border-gray-200 object-cover dark:border-white/10" />
                    ) : (
                      <span className="text-xs font-medium text-gray-700 dark:text-white/80">{row.text}</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-gray-500 dark:text-white/50">{row.kind}</td>
                  <td className="px-3 py-2.5 text-xs">
                    <span className={eligible ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}>
                      {eligible ? 'Eligible' : 'Not eligible'}
                    </span>
                    {reason && <div className="text-10 text-gray-400 dark:text-white/35">{reason}</div>}
                  </td>
                  <td className="px-3 py-2.5 text-right text-xs text-gray-600 dark:text-white/70">{m.impressions.toLocaleString()}</td>
                  <td className="px-3 py-2.5 text-right text-xs text-gray-600 dark:text-white/70">{m.clicks.toLocaleString()}</td>
                  <td className="px-3 py-2.5 text-right text-xs text-gray-600 dark:text-white/70">₹{m.cost.toFixed(2)}</td>
                  <td className="px-3 py-2.5 text-right text-xs text-gray-600 dark:text-white/70">{m.conversions.toFixed(2)}</td>
                  {onLaunchWizard && (
                    <td className="pr-4 pl-2 py-2.5">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => onLaunchWizard('edit-adgroup', {
                            campaignId: campaign?.campaignId || campaign?.id,
                            adGroupId: agId,
                            adAccountId,
                            adGroupName: data.name || adGroup.name,
                            isPmax: true,
                            status: campaign?.status,
                            objective: campaign?.objective,
                            destination: campaign?.channelType || campaign?.objective,
                          })}
                          title="Edit"
                          className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-gray-100 text-gray-400 transition-all hover:border-gray-300 hover:bg-gray-200 hover:text-gray-900 dark:border-white/8 dark:bg-white/2 dark:text-white/40 dark:hover:border-white/20 dark:hover:bg-white/8 dark:hover:text-white"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        {row.assetRN && (
                          <button
                            onClick={() => setPendingDeleteAsset(row)}
                            disabled={deletingRN === row.assetRN}
                            title="Remove"
                            className="flex h-8 w-8 items-center justify-center rounded-lg border border-red-200 bg-red-50 text-red-400 transition-all hover:border-red-300 hover:bg-red-100 hover:text-red-600 dark:border-red-500/20 dark:bg-red-500/5 dark:text-red-400/60 dark:hover:border-red-500/40 dark:hover:bg-red-500/10 dark:hover:text-red-400 disabled:opacity-50"
                          >
                            {deletingRN === row.assetRN ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col gap-3 p-4">

      {rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 text-gray-400 dark:text-white/30">
          <Layers className="mb-2 h-7 w-7 opacity-40" />
          <p className="text-sm">{assetSearch.trim() ? 'No assets match your search' : 'Asset group exists but has no assets yet'}</p>
        </div>
      ) : renderAssetTable()}

      <AnimatePresence>
        {pendingDeleteAsset &&
          typeof document !== 'undefined' &&
          createPortal(
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-4 backdrop-blur-md"
              onClick={() => !deletingRN && setPendingDeleteAsset(null)}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 8 }}
                transition={{ duration: 0.18 }}
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-sm rounded-2xl border border-gray-200/80 bg-white p-6 shadow-2xl backdrop-blur-xl dark:border-white/10 dark:bg-[#161616]"
              >
                <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-red-50 dark:bg-red-500/10">
                  <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
                </div>
                <h2 className="mb-1 text-sm font-bold text-gray-900 dark:text-white">Remove this asset?</h2>
                <p className="mb-6 text-xs text-gray-500 dark:text-[#BEBEBE]">
                  <span className="font-semibold text-gray-900 dark:text-white">{pendingDeleteAsset.text || pendingDeleteAsset.kind}</span> will
                  be removed from this asset group. This cannot be undone.
                </p>
                <div className="flex items-center justify-end gap-2">
                  <button
                    onClick={() => setPendingDeleteAsset(null)}
                    disabled={!!deletingRN}
                    className="rounded-xl border border-gray-200 bg-gray-100 px-4 py-2 text-xs font-medium text-gray-900 transition-all hover:bg-gray-200 dark:border-white/8 dark:bg-white/5 dark:text-white dark:hover:bg-white/10 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDeleteAsset}
                    disabled={!!deletingRN}
                    className="flex items-center gap-1.5 rounded-xl bg-red-500/80 px-4 py-2 text-xs font-bold text-white transition-all hover:bg-red-500 disabled:opacity-50"
                  >
                    {deletingRN && <Loader2 className="h-3 w-3 animate-spin" />}
                    {deletingRN ? 'Removing…' : 'Remove'}
                  </button>
                </div>
              </motion.div>
            </motion.div>,
            document.body
          )}
      </AnimatePresence>
    </div>
  );
}

// ─── ads table (level 3) ──────────────────────────────────────────────────────

function AdsTable({ adGroup, campaign, adAccountId, onLaunchWizard, manageNonce }) {
  const [assetRefreshNonce, setAssetRefreshNonce] = useState(0);
  const [assetRefreshing, setAssetRefreshing] = useState(false);
  const [assetSearch, setAssetSearch] = useState('');

  if (adGroup.isPmax || adGroup.type === 'ASSET_GROUP') {
    const agId = adGroup.adGroupId || adGroup.id;
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl workspace-card dark:border-white/10 dark:bg-[#141414]">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-gray-200 bg-gray-50 px-4 py-2.5 dark:border-white/10 dark:bg-[#181818]">
          <div className="flex items-center gap-2">
            <Layers className="h-3.5 w-3.5 text-[#4285F4]" />
            <p className="text-xs font-semibold text-gray-500 dark:text-white/70">
              Assets in <span className="text-gray-900 dark:text-white">{adGroup.name}</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div
              className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 dark:border-white/10 dark:bg-white/4"
              title="Search assets by name or type"
            >
              <Search className="h-3 w-3 shrink-0 text-gray-400 dark:text-white/40" />
              <input
                type="text"
                value={assetSearch}
                onChange={(e) => setAssetSearch(e.target.value)}
                placeholder="Search by name or ID…"
                title="Search assets by name or type"
                className="w-36 bg-transparent text-xs text-gray-700 outline-none placeholder:text-gray-400 dark:text-white/90 dark:placeholder:text-white/40 2xl:w-44"
              />
            </div>
            {onLaunchWizard && (
              <button
                onClick={() => onLaunchWizard('edit-adgroup', {
                  campaignId: campaign?.campaignId || campaign?.id,
                  adGroupId: agId,
                  adAccountId,
                  adGroupName: adGroup.name,
                  isPmax: true,
                  status: campaign?.status,
                  objective: campaign?.objective,
                  destination: campaign?.channelType || campaign?.objective,
                })}
                className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 transition-all hover:bg-gray-50 dark:border-white/10 dark:bg-white/4 dark:text-white/60 dark:hover:bg-white/8">
                <Pencil className="h-3 w-3" />
                Edit assets
              </button>
            )}
            <button
              onClick={() => { setAssetRefreshing(true); setAssetRefreshNonce((n) => n + 1); }}
              disabled={assetRefreshing}
              className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 transition-all hover:bg-gray-50 dark:border-white/10 dark:bg-white/4 dark:text-white/60 dark:hover:bg-white/8 disabled:opacity-50">
              <RefreshCw className={`h-3 w-3 ${assetRefreshing ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>
        <div className="scrollbar-thin flex-1 overflow-y-auto">
          <PmaxAssetGroupDetail
            adGroup={adGroup}
            campaign={campaign}
            adAccountId={adAccountId}
            manageNonce={manageNonce}
            onLaunchWizard={onLaunchWizard}
            externalRefreshNonce={assetRefreshNonce}
            onRefreshDone={() => setAssetRefreshing(false)}
            assetSearch={assetSearch}
          />
        </div>
      </div>
    );
  }
  return <AdsTableInner adGroup={adGroup} campaign={campaign} adAccountId={adAccountId} onLaunchWizard={onLaunchWizard} manageNonce={manageNonce} />;
}

function AdsTableInner({ adGroup, campaign, adAccountId, onLaunchWizard, manageNonce }) {
  const [ads,          setAds]          = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [refreshing,   setRefreshing]   = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [statuses,     setStatuses]     = useState({});
  const [toggling,     setToggling]     = useState({});
  const [selectedAd,   setSelectedAd]   = useState(null);
  const [editingId,    setEditingId]    = useState(null);
  const [pendingDeleteAd, setPendingDeleteAd] = useState(null);
  const [deletingAd,   setDeletingAd]   = useState(false);
  const [adSearch,     setAdSearch]     = useState('');
  const filteredAds = adSearch.trim()
    ? ads.filter((a) => {
        const q = adSearch.trim().toLowerCase();
        const name = adCopyText(a.longHeadline) || adCopyText(a.headline) || adCopyText(a.headlines?.[0]) || a.name || '';
        return name.toLowerCase().includes(q) || String(a.adId || a.id || '').toLowerCase().includes(q);
      })
    : ads;
  const { sorted, sortKey, sortDir, toggleSort } = useSortedRows(filteredAds, 'headline');

  const handleRefresh = () => {
    setRefreshing(true);
    setRefreshNonce((n) => n + 1);
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getGoogleAdGroupAds({ adAccountId, adGroupId: adGroup.adGroupId || adGroup.id, refresh: true })
      .then((r) => { if (!cancelled) setAds(r.ads || r.data || []); })
      .catch((e) => {
        if (!cancelled) {
          setAds([]);
          globalToast.error(e?.response?.data?.error || e?.response?.data?.details || 'Failed to load ads');
        }
      })
      .finally(() => { if (!cancelled) { setLoading(false); setRefreshing(false); } });
    return () => { cancelled = true; };
  }, [adGroup.adGroupId, adGroup.id, adAccountId, manageNonce, refreshNonce]);

  const getStatus = (a) => statuses[a.adId || a.id] ?? a.status;

  const handleToggle = async (a) => {
    const id = a.adId || a.id;
    const next = getStatus(a) === 'ENABLED' ? 'PAUSED' : 'ENABLED';
    setToggling((p) => ({ ...p, [id]: true }));
    try {
      await updateGoogleAdStatus({ level: 'ad', id, adAccountId, adGroupId: adGroup.adGroupId || adGroup.id, status: next });
      setStatuses((p) => ({ ...p, [id]: next }));
      globalToast.success('Ad status updated');
      setRefreshNonce((n) => n + 1);
    } catch (err) { globalToast.error(err?.response?.data?.error || err?.response?.data?.details || 'Failed to update ad status'); }
    finally  { setToggling((p) => ({ ...p, [id]: false })); }
  };

  const handleEdit = async (e, a) => {
    e.stopPropagation();
    const id = a.adId || a.id;
    setEditingId(id);
    try {
      const res = await resolveGoogleAdForEdit({ adId: id, adAccountId });
      const normHeadlines = (res.headlines || []).map((h) => adCopyText(h)).filter(Boolean);
      const normDescriptions = (res.descriptions || []).map((d) => adCopyText(d)).filter(Boolean);
      onLaunchWizard?.('edit-ad', {
        campaignId:     campaign.campaignId || campaign.id,
        adGroupId:      adGroup.adGroupId || adGroup.id,
        objective:      campaign.objective,
        destination:    campaign.channelType || campaign.objective,
        adId:           res.adId || id,
        headlines:      normHeadlines.length ? normHeadlines : ['', '', ''],
        descriptions:   normDescriptions.length ? normDescriptions : ['', ''],
        headline:       adCopyText(res.headline),
        description:    adCopyText(res.description),
        finalUrl:       res.finalUrl,
        imageUrl:       res.imageUrl || res.previewUrl,
        callToAction:   res.callToAction,
        path1:          res.path1,
        path2:          res.path2,
        trackingUrlTemplate: res.trackingUrlTemplate,
        previewUrl:     res.previewUrl || res.imageUrl,
        mediaType:      res.mediaType,
        videoUrl:       res.videoUrl,
      });
    } catch {
      globalToast.error('Failed to load ad details');
    } finally {
      setEditingId(null);
    }
  };

  const handleConfirmDeleteAd = async () => {
    if (!pendingDeleteAd || !adAccountId) return;
    setDeletingAd(true);
    try {
      await deleteGoogleAd({ adAccountId, adGroupId: adGroup.adGroupId || adGroup.id, adId: pendingDeleteAd.adId || pendingDeleteAd.id });
      setAds((prev) => prev.filter((a) => (a.adId || a.id) !== (pendingDeleteAd.adId || pendingDeleteAd.id)));
      if ((selectedAd?.adId || selectedAd?.id) === (pendingDeleteAd.adId || pendingDeleteAd.id)) setSelectedAd(null);
      globalToast.success('Ad deleted');
      setPendingDeleteAd(null);
    } catch { globalToast.error('Failed to delete ad'); }
    finally { setDeletingAd(false); }
  };

  return (
    <div className="flex min-h-0 flex-1 gap-3">
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl workspace-card dark:border-white/10 dark:bg-[#141414]">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-gray-200 bg-gray-50 px-4 py-2.5 dark:border-white/10 dark:bg-[#181818]">
        <p className="truncate text-xs font-semibold text-gray-500 dark:text-white/70">
          Ads in <span className="text-gray-900 dark:text-white">{adGroup.name}</span>
        </p>
        <div className="flex items-center gap-2">
          <div className="relative w-56">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-white/40" />
            <input
              type="text"
              value={adSearch}
              onChange={(e) => setAdSearch(e.target.value)}
              placeholder="Search ads…"
              className="w-full rounded-full border border-gray-300 bg-gray-100 py-1.5 pl-9 pr-9 text-xs text-gray-900 placeholder:text-gray-400 transition-colors hover:border-gray-400 focus:border-gray-400 focus:outline-none dark:border-white/10 dark:bg-[#171717] dark:text-white dark:placeholder:text-white/40 dark:hover:border-white/15 dark:focus:border-white/25"
            />
            {adSearch && (
              <button
                type="button"
                onClick={() => setAdSearch('')}
                className="absolute top-1/2 right-3 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:text-white/40 dark:hover:text-white/70"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <RefreshButton onClick={handleRefresh} busy={refreshing} title="Refresh ads" />
          {onLaunchWizard && (
            <AddButton
              label="Add Ad"
              onClick={() => onLaunchWizard('create-ad', { campaignId: campaign.campaignId || campaign.id, adGroupId: adGroup.adGroupId || adGroup.id, objective: campaign.objective })}
            />
          )}
        </div>
      </div>
      <div className="scrollbar-thin flex-1 overflow-auto">
        <table className="w-full min-w-160 border-collapse">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 dark:border-white/12 dark:bg-[#181818]">
              <th className="w-16 py-3 pl-5 pr-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-white/70">Preview</th>
              <SortTh label="Ad Name"   colKey="headline"      sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="w-[30%]" />
              <SortTh label="Status"    colKey="status"        sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              <SortTh label="Ad Type"   colKey="type"          sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              <SortTh label="Final URL" colKey="finalUrl"      sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              <SortTh label="CTA"       colKey="callToAction"  sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              {onLaunchWizard && <th className="w-24 pr-5 pl-2 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-white/70">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr className="google-ads-table-static-row"><td colSpan={onLaunchWizard ? 7 : 6} className="py-14"><Spinner /></td></tr>
            )}
            {!loading && sorted.length === 0 && (
              <tr className="google-ads-table-static-row"><td colSpan={onLaunchWizard ? 7 : 6} className="py-14"><EmptyState message={adSearch.trim() ? 'No ads match your search' : 'No ads in this ad group'} /></td></tr>
            )}
            {!loading && sorted.map((a, idx) => {
              const id     = a.adId || a.id;
              const status = getStatus(a);
              const isSelected = selectedAd?.adId === id || selectedAd?.id === id;
              return (
                <motion.tr
                  key={id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: idx * 0.03 }}
                  onClick={() => setSelectedAd((p) => ((p?.adId || p?.id) === id ? null : a))}
                  className={`group cursor-pointer border-b border-gray-200 transition-colors last:border-b-0 dark:border-white/10
                    ${isSelected ? 'bg-gray-100 dark:bg-white/5' : 'hover:bg-gray-100 dark:hover:bg-white/3'}`}
                >
                  {/* preview thumbnail */}
                  <td className="py-3 pl-5 pr-3">
                    <div className="relative h-11 w-16 overflow-hidden rounded-lg border border-gray-200 bg-gray-100 dark:border-white/10 dark:bg-[#1e1e1e]">
                      {(() => {
                        const ytId = a.youtubeVideoId || (a.videoUrl ? (a.videoUrl.match(/[?&]v=([A-Za-z0-9_-]{11})/) || a.videoUrl.match(/youtu\.be\/([A-Za-z0-9_-]{11})/))?.[1] : null);
                        if (ytId) return (
                          <a href={`https://www.youtube.com/watch?v=${ytId}`} target="_blank" rel="noopener noreferrer" className="block h-full w-full">
                            <img
                              src={`https://i.ytimg.com/vi/${ytId}/mqdefault.jpg`}
                              alt={a.headline || 'Ad'}
                              className="h-full w-full object-cover"
                              onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
                            />
                            <div style={{display:'none'}} className="absolute inset-0 items-center justify-center bg-[#1e1e1e]">
                              <Play className="h-4 w-4 fill-white/40 text-white/40" />
                            </div>
                            <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                              <Play className="h-4 w-4 fill-white text-white" />
                            </div>
                          </a>
                        );
                        if (a.imageUrl) return <img src={a.imageUrl} alt={a.headline || 'Ad'} className="h-full w-full object-cover" />;
                        if (a.type === 'RESPONSIVE_SEARCH_AD') return (
                          <div className="flex h-full w-full flex-col items-center justify-center gap-0.5">
                            <div className="h-0.5 w-8 rounded bg-[#4285F4]/60" />
                            <div className="h-0.5 w-6 rounded bg-gray-300 dark:bg-white/20" />
                            <div className="h-0.5 w-7 rounded bg-gray-300 dark:bg-white/20" />
                          </div>
                        );
                        return (
                          <div className="flex h-full w-full items-center justify-center">
                            <ImageIcon className="h-4 w-4 text-gray-400 dark:text-white/20" />
                          </div>
                        );
                      })()}
                    </div>
                  </td>
                  {/* ad name */}
                  <td className="px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-gray-900 dark:text-white">
                        {adCopyText(a.headline) || adCopyText(a.headlines?.[0]) || `Ad ${id}`}
                      </p>
                      {adCopyText(a.descriptions?.[0]) && (
                        <p className="truncate text-xs text-gray-400 dark:text-white/40">{adCopyText(a.descriptions[0])}</p>
                      )}
                    </div>
                  </td>
                  {/* status */}
                  <td className="px-4 py-3">
                    <GoogleServingStatus
                      status={status}
                      approvalStatus={a.approvalStatus}
                      reviewStatus={a.reviewStatus}
                    />
                  </td>
                  {/* ad type */}
                  <td className="px-4 py-3">
                    {(() => {
                      const AD_TYPE_LABEL = {
                        RESPONSIVE_SEARCH_AD:              'Responsive Search',
                        RESPONSIVE_DISPLAY_AD:             'Responsive Display',
                        IMAGE_AD:                          'Image',
                        TEXT_AD:                           'Text',
                        EXPANDED_TEXT_AD:                  'Expanded Text',
                        VIDEO_RESPONSIVE_AD:               'Video Responsive',
                        DEMAND_GEN_VIDEO_RESPONSIVE_AD:    'Demand Gen Video',
                        DEMAND_GEN_MULTI_ASSET_AD:         'Demand Gen',
                        DEMAND_GEN_CAROUSEL_AD:            'Demand Gen Carousel',
                        SHOPPING_PRODUCT_AD:               'Shopping',
                        SHOPPING_SMART_AD:                 'Smart Shopping',
                        APP_AD:                            'App',
                        CALL_AD:                           'Call',
                        LEGACY_RESPONSIVE_DISPLAY_AD:      'Display (Legacy)',
                      };
                      const raw = (a.type || '').toUpperCase();
                      const label = AD_TYPE_LABEL[raw] || raw.replace(/_AD$/, '').replace(/_/g, ' ') || 'Ad';
                      return (
                        <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-100 px-2 py-0.5 text-10 font-semibold text-gray-500 dark:border-white/8 dark:bg-white/5 dark:text-white/50">
                          {label}
                        </span>
                      );
                    })()}
                  </td>
                  {/* final url */}
                  <td className="px-4 py-3 text-sm text-gray-600 dark:text-white/80">
                    {a.finalUrl ? (
                      <span className="max-w-40 truncate block text-xs text-gray-500 dark:text-white/50">{a.finalUrl}</span>
                    ) : <span className="text-gray-400 dark:text-white/40">—</span>}
                  </td>
                  {/* cta */}
                  <td className="px-4 py-3 text-xs text-gray-600 dark:text-white/80">
                    {labelGoogleCTA(a.callToAction) ?? '—'}
                  </td>
                  {/* actions */}
                  {onLaunchWizard && (
                    <td className="pr-5 pl-2 py-3">
                      <div className="flex items-center justify-end gap-1.5">
                        {/* pause / enable toggle */}
                        {(status === 'ENABLED' || status === 'PAUSED') && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleToggle(a); }}
                            disabled={!!toggling[id]}
                            title={status === 'ENABLED' ? 'Running — click to pause' : 'Paused — click to enable'}
                            className={`flex h-8 w-8 items-center justify-center rounded-lg border transition-all disabled:opacity-50 ${
                              status === 'ENABLED'
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-600 hover:border-emerald-300 hover:bg-emerald-100 dark:border-emerald-500/20 dark:bg-emerald-500/8 dark:text-emerald-400 dark:hover:bg-emerald-500/15'
                                : 'border-gray-200 bg-gray-100 text-gray-500 hover:border-gray-300 hover:bg-gray-200 hover:text-gray-900 dark:border-white/8 dark:bg-white/2 dark:text-white/40 dark:hover:border-white/20 dark:hover:bg-white/8 dark:hover:text-white'
                            }`}
                          >
                            {toggling[id] ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : status === 'ENABLED' ? (
                              <Pause className="h-3.5 w-3.5" />
                            ) : (
                              <Play className="h-3.5 w-3.5" />
                            )}
                          </button>
                        )}
                        {/* edit — hidden for removed ads */}
                        {status !== 'REMOVED' && (
                          <button
                            onClick={(e) => handleEdit(e, a)}
                            disabled={editingId === id}
                            title="Edit ad"
                            className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-gray-100 text-gray-400 transition-all hover:border-gray-300 hover:bg-gray-200 hover:text-gray-900 dark:border-white/8 dark:bg-white/2 dark:text-white/40 dark:hover:border-white/20 dark:hover:bg-white/8 dark:hover:text-white disabled:opacity-50"
                          >
                            {editingId === id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Pencil className="h-3.5 w-3.5" />
                            )}
                          </button>
                        )}
                        {/* delete */}
                        <button
                          onClick={(e) => { e.stopPropagation(); setPendingDeleteAd(a); }}
                          title="Remove ad"
                          className="flex h-8 w-8 items-center justify-center rounded-lg border border-red-200 bg-red-50 text-red-400 transition-all hover:border-red-300 hover:bg-red-100 hover:text-red-600 dark:border-red-500/20 dark:bg-red-500/5 dark:text-red-400/60 dark:hover:border-red-500/40 dark:hover:bg-red-500/10 dark:hover:text-red-400"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  )}
                </motion.tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>

    <AnimatePresence>
      {selectedAd && (
        <GoogleAdDrawer
          ad={{ ...selectedAd, status: getStatus(selectedAd) }}
          adAccountId={adAccountId}
          onClose={() => setSelectedAd(null)}
          onStatusChange={(id, next) => { setStatuses((p) => ({ ...p, [id]: next })); setRefreshNonce((n) => n + 1); }}
        />
      )}
    </AnimatePresence>

    <AnimatePresence>
      {pendingDeleteAd && (
        <DeleteModal
          item={{ name: pendingDeleteAd.headline || pendingDeleteAd.headlines?.[0] || `Ad ${pendingDeleteAd.adId || pendingDeleteAd.id}`, id: pendingDeleteAd.adId || pendingDeleteAd.id, _adLabel: true }}
          onConfirm={handleConfirmDeleteAd}
          onCancel={() => !deletingAd && setPendingDeleteAd(null)}
          deleting={deletingAd}
        />
      )}
    </AnimatePresence>
    </div>
  );
}

// ─── root export ──────────────────────────────────────────────────────────────

export default function GoogleAdsCampaignsTable({ campaigns = [], loading, adAccountId, onRefresh, onLaunchWizard, manageNonce, campaignSearch: externalSearch, onCampaignSearchChange, onLevelChange }) {
  const [level,            setLevel]            = useState('campaigns');
  const [selectedCampaign, setSelectedCampaign] = useState(null);
  const [selectedAdGroup,  setSelectedAdGroup]  = useState(null);
  const [internalSearch,   setInternalSearch]   = useState('');

  const query = onCampaignSearchChange ? (externalSearch ?? '') : internalSearch;
  const setQuery = onCampaignSearchChange || setInternalSearch;

  useEffect(() => { onLevelChange?.(level); }, [level, onLevelChange]);

  const drillToCampaign = (c) => { setSelectedCampaign(c); setSelectedAdGroup(null); setLevel('adgroups'); };
  const drillToAdGroup  = (g) => { setSelectedAdGroup(g);                             setLevel('ads'); };
  const goToCampaigns   = ()  => { setLevel('campaigns'); setSelectedCampaign(null); setSelectedAdGroup(null); };
  const goToAdGroups    = ()  => { setLevel('adgroups');                              setSelectedAdGroup(null); };

  const filteredCampaigns = (query || '').trim()
    ? campaigns.filter((c) => {
        const q = (query || '').trim().toLowerCase();
        return (c.name || '').toLowerCase().includes(q) || String(c.campaignId || c.id || '').toLowerCase().includes(q);
      })
    : campaigns;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* breadcrumb nav */}
      <div className="flex shrink-0 items-center">
        <Breadcrumb
          level={level}
          campaign={selectedCampaign}
          adGroup={selectedAdGroup}
          onClickCampaigns={goToCampaigns}
          onClickCampaign={goToAdGroups}
        />
      </div>

      {/* content */}
      <div className="flex min-h-0 flex-1 flex-col">
        <AnimatePresence mode="wait">
          {level === 'campaigns' && (
            <motion.div key="campaigns" className="flex min-h-0 flex-1 flex-col" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.18 }}>
              <CampaignTable
                campaigns={filteredCampaigns}
                totalCount={campaigns.length}
                query={query}
                onQueryChange={setQuery}
                loading={loading}
                adAccountId={adAccountId}
                onDrillDown={drillToCampaign}
                onRefresh={onRefresh}
                onLaunchWizard={onLaunchWizard}
                searchActive={!!(query || '').trim()}
              />
            </motion.div>
          )}
          {level === 'adgroups' && selectedCampaign && (
            <motion.div key="adgroups" className="flex min-h-0 flex-1 flex-col" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.18 }}>
              <AdGroupTable
                campaign={selectedCampaign}
                adAccountId={adAccountId}
                onDrillDown={drillToAdGroup}
                onLaunchWizard={onLaunchWizard}
                manageNonce={manageNonce}
              />
            </motion.div>
          )}
          {level === 'ads' && selectedAdGroup && (
            <motion.div key="ads" className="flex min-h-0 flex-1 flex-col" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.18 }}>
              <AdsTable
                adGroup={selectedAdGroup}
                campaign={selectedCampaign}
                adAccountId={adAccountId}
                onLaunchWizard={onLaunchWizard}
                manageNonce={manageNonce}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
