import React, { useEffect, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import {
  ChevronRight,
  RefreshCw,
  Pause,
  Play,
  LogOut,
  Loader2,
  Plus,
  DollarSign,
  Eye,
  MousePointerClick,
  TrendingUp,
  Activity,
  Zap,
  Target,
  Receipt,
  ChevronDown,
  Calendar,
  Radio,
  Layers,
  Pencil,
  X,
  Search,
  SlidersHorizontal,
  ArrowUpDown,
  AlertTriangle,
  Check,
  CheckCheck,
  RotateCcw,
  Image as ImageIcon,
} from 'lucide-react';
import { FaTiktok } from 'react-icons/fa6';
import CreateCampaignWizard from './CreateCampaignWizard';
import {
  getTiktokAdAccounts,
  getTiktokCampaigns,
  getTiktokAdGroups,
  getTiktokAds,
  getTiktokDashboardData,
  getTiktokInsights,
  updateTiktokStatus,
  disconnectTiktokUser,
  checkTiktokAccount,
  getTiktokAdGroupReviewInfo,
  getTiktokAdReviewInfo,
} from '@/apis/tikTokAds/tikTokAdsApi';
import toast from 'react-hot-toast';
import { GA4Events } from '@/utils/ga4';
import AdsManagerModeSwitcher from '@/components/AdsManager/AdsManagerModeSwitcher';
import WorkspaceSwitcher from '@/components/workspace/WorkspaceSwitcher';
import ThemeToggle from '@/components/layout/header/ThemeToggle';

// ─── formatting helpers ────────────────────────────────────────────────────
// NOTE: TikTok's reporting `spend`/cpc/cpm/cpa come back in the account's main
// currency unit (e.g. dollars), NOT minor units — so we format as-is, no ÷100.
const fmtNum = (n) =>
  new Intl.NumberFormat('en-US').format(Math.round(Number(n) || 0));

const fmtCurrency = (n, currency) => {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'USD',
      maximumFractionDigits: 2,
    }).format(Number(n) || 0);
  } catch {
    return `${currency || ''} ${(Number(n) || 0).toFixed(2)}`;
  }
};

const fmtPct = (n) => `${(Number(n) || 0).toFixed(2)}%`;

const fmtDate = (d) => {
  if (!d) return '—';
  const date = new Date(d);
  return isNaN(date.getTime()) ? '—' : date.toLocaleDateString('en-GB');
};

// Budget remaining = budget − spend (only meaningful when budget is finite).
const budgetRemaining = (row) => {
  if (row.budgetMode === 'BUDGET_MODE_INFINITE') return 'Unlimited';
  const budget = Number(row.budget) || 0;
  const spend = Number(row.spend) || 0;
  return budget - spend;
};

// "STATUS_CONTRACT_PENDING" → "Contract Pending"
const prettyStatus = (s) =>
  (s || '')
    .replace(/^STATUS_/, '')
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase()) || '—';

const DATE_PRESETS = [
  { label: 'Today', value: 'today' },
  { label: 'Yesterday', value: 'yesterday' },
  { label: 'Last 3 days', value: 'last3' },
  { label: 'Last 7 days', value: 'last7' },
  { label: 'Last 14 days', value: 'last14' },
  { label: 'Last 28 days', value: 'last28' },
  { label: 'Last 30 days', value: 'last30' },
  { label: 'Last 90 days', value: 'last90' },
  { label: 'This month', value: 'thisMonth' },
  { label: 'Last month', value: 'lastMonth' },
  { label: 'This quarter', value: 'thisQuarter' },
  { label: 'Last quarter', value: 'lastQuarter' },
  { label: 'This year', value: 'thisYear' },
  { label: 'Last year', value: 'lastYear' },
  { label: 'Lifetime', value: 'lifetime' },
  { label: 'Maximum', value: 'maximum' },
];

const fmtDateStr = (d) => {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

function rangeForPreset(value) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  switch (value) {
    case 'today':
      return { startDate: fmtDateStr(today), endDate: fmtDateStr(today) };
    case 'yesterday':
      return { startDate: fmtDateStr(yesterday), endDate: fmtDateStr(yesterday) };
    case 'last3': {
      const s = new Date(today);
      s.setDate(s.getDate() - 2);
      return { startDate: fmtDateStr(s), endDate: fmtDateStr(today) };
    }
    case 'last7': {
      const s = new Date(today);
      s.setDate(s.getDate() - 6);
      return { startDate: fmtDateStr(s), endDate: fmtDateStr(today) };
    }
    case 'last14': {
      const s = new Date(today);
      s.setDate(s.getDate() - 13);
      return { startDate: fmtDateStr(s), endDate: fmtDateStr(today) };
    }
    case 'last28': {
      const s = new Date(today);
      s.setDate(s.getDate() - 27);
      return { startDate: fmtDateStr(s), endDate: fmtDateStr(today) };
    }
    case 'last30': {
      const s = new Date(today);
      s.setDate(s.getDate() - 29);
      return { startDate: fmtDateStr(s), endDate: fmtDateStr(today) };
    }
    case 'last90': {
      const s = new Date(today);
      s.setDate(s.getDate() - 89);
      return { startDate: fmtDateStr(s), endDate: fmtDateStr(today) };
    }
    case 'thisMonth': {
      const s = new Date(today.getFullYear(), today.getMonth(), 1);
      return { startDate: fmtDateStr(s), endDate: fmtDateStr(today) };
    }
    case 'lastMonth': {
      const s = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const e = new Date(today.getFullYear(), today.getMonth(), 0);
      return { startDate: fmtDateStr(s), endDate: fmtDateStr(e) };
    }
    case 'thisQuarter': {
      const q = Math.floor(today.getMonth() / 3);
      const s = new Date(today.getFullYear(), q * 3, 1);
      return { startDate: fmtDateStr(s), endDate: fmtDateStr(today) };
    }
    case 'lastQuarter': {
      const currentQ = Math.floor(today.getMonth() / 3);
      const q = currentQ - 1;
      const year = q < 0 ? today.getFullYear() - 1 : today.getFullYear();
      const qIdx = q < 0 ? 3 : q;
      const s = new Date(year, qIdx * 3, 1);
      const e = new Date(year, qIdx * 3 + 3, 0);
      return { startDate: fmtDateStr(s), endDate: fmtDateStr(e) };
    }
    case 'thisYear': {
      const s = new Date(today.getFullYear(), 0, 1);
      return { startDate: fmtDateStr(s), endDate: fmtDateStr(today) };
    }
    case 'lastYear': {
      const s = new Date(today.getFullYear() - 1, 0, 1);
      const e = new Date(today.getFullYear() - 1, 11, 31);
      return { startDate: fmtDateStr(s), endDate: fmtDateStr(e) };
    }
    case 'lifetime':
    case 'maximum':
      return { startDate: null, endDate: null, lifetime: true };
    default:
      return { startDate: fmtDateStr(today), endDate: fmtDateStr(today) };
  }
}

const LEVEL_BY_VIEW = { campaigns: 'campaign', adgroups: 'adgroup', ads: 'ad' };

// Merge insight metrics into entity rows by id. Metrics are reported in the
// account's main currency unit (no ÷100).
const mergeInsights = (rows, insightsRows = []) => {
  const map = new Map(insightsRows.map((r) => [String(r.id), r.metrics || {}]));
  return rows.map((r) => {
    const m = map.get(String(r.id)) || {};
    return {
      ...r,
      spend: Number(m.spend || 0),
      impressions: Number(m.impressions || 0),
      clicks: Number(m.clicks || 0),
      conversions: Number(m.conversion || 0),
      ctr: Number(m.ctr || 0),
      cpc: Number(m.cpc || 0),
      cpm: Number(m.cpm || 0),
      cpa: Number(m.cost_per_conversion || 0),
    };
  });
};

// ─── small atoms ────────────────────────────────────────────────────────────
const KpiCard = ({ icon: Icon, label, value }) => (
  <div className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-gray-200 p-4 transition-all duration-300 hover:border-gray-300 2xl:p-5 dark:border-white/10 dark:bg-[#161616] dark:hover:border-white/20 dark:hover:bg-white/3">
    {/* top row: icon left, label right */}
    <div className="flex items-start justify-between">
      <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-gray-200 bg-gray-100 dark:border-white/10 dark:bg-white/5">
        {Icon && <Icon className="h-4 w-4 text-gray-400 dark:text-white/50" />}
      </div>
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-gray-400 dark:text-white/35">
        {label}
      </p>
    </div>
    {/* value */}
    <p className="mt-4 text-xl font-bold leading-none text-gray-900 2xl:text-2xl dark:text-white">
      {value}
    </p>
  </div>
);

const StatusBadge = ({ status }) => {
  const isAct = status === 'ACTIVE';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
        isAct
          ? 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:border-emerald-500/20 dark:text-emerald-400'
          : 'border border-red-500/30 bg-red-500/10 text-red-600 dark:border-red-500/20 dark:text-red-400'
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${isAct ? 'bg-emerald-500' : 'bg-red-500'}`} />
      {status === 'ACTIVE' ? 'Active' : status === 'PAUSED' ? 'Paused' : status || '—'}
    </span>
  );
};

// Shows why TikTok's review rejected (or partially rejected) an ad group/ad —
// only rendered when reviewInfo indicates a problem, so it stays invisible
// for normal paused-by-choice rows.
const RejectionWarning = ({ reviewInfo }) => {
  const [open, setOpen] = useState(false);
  if (!reviewInfo || reviewInfo.isApproved !== false) return null;

  const reasons = (reviewInfo.rejectInfo || []).flatMap((r) => r.reasons || []);
  const suggestion = reviewInfo.rejectInfo?.[0]?.suggestion;
  const forbidden = [
    reviewInfo.forbiddenPlacements?.length && `Placements: ${reviewInfo.forbiddenPlacements.join(', ')}`,
    reviewInfo.forbiddenLocations?.length && `Locations: ${reviewInfo.forbiddenLocations.join(', ')}`,
    reviewInfo.forbiddenAges?.length && `Ages: ${reviewInfo.forbiddenAges.join(', ')}`,
  ].filter(Boolean);

  return (
    <span className="relative inline-flex" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        title="Review rejected — click for details"
        className="flex h-5 w-5 items-center justify-center rounded-full text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-500/10"
      >
        <AlertTriangle className="h-4 w-4" />
      </button>
      {open && (
        <div className="absolute left-0 top-6 z-20 w-72 rounded-lg border border-gray-200 bg-white p-3 text-xs shadow-lg dark:border-white/10 dark:bg-[#1A1A1A]">
          <p className="mb-1 font-semibold text-amber-600 dark:text-amber-400">
            {reviewInfo.reviewStatus === 'UNAVAILABLE' ? 'Rejected — cannot deliver' : 'Partially rejected'}
          </p>
          {reasons.length > 0 && (
            <ul className="mb-1.5 list-disc space-y-0.5 pl-4 text-gray-600 dark:text-white/70">
              {reasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          )}
          {forbidden.length > 0 && (
            <p className="mb-1.5 text-gray-500 dark:text-white/50">{forbidden.join(' · ')}</p>
          )}
          {suggestion && <p className="text-gray-500 dark:text-white/50">{suggestion}</p>}
        </div>
      )}
    </span>
  );
};

const ToggleSwitch = ({ status, onToggle, disabled = false }) => {
  const isActive = status === 'ACTIVE';
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors duration-200 ${
        isActive ? 'bg-emerald-500' : 'bg-red-500'
      } ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
    >
      <span
        className={`absolute top-1 left-1 h-3 w-3 rounded-full bg-white shadow transition-transform duration-200 ${
          isActive ? 'translate-x-4' : 'translate-x-0'
        }`}
      />
    </button>
  );
};

function SortTh({ label, colKey, sortKey, sortDir, onSort, className = '', align = 'left' }) {
  const active = sortKey === colKey;
  return (
    <th
      onClick={() => onSort && onSort(colKey)}
      className={`cursor-pointer select-none whitespace-nowrap px-4 py-3 ${
        align === 'right' ? 'text-right' : 'text-left'
      } text-xs font-semibold uppercase tracking-wider text-gray-500 transition-colors hover:text-gray-900 dark:text-white/70 dark:hover:text-white ${className}`}
    >
      <span className={`flex items-center gap-2 ${align === 'right' ? 'justify-end' : ''}`}>
        {label}
        <span
          className={`flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-md transition-all ${
            active
              ? 'bg-gray-200 text-gray-900 dark:bg-white/15 dark:text-white'
              : 'bg-gray-100 text-gray-400 dark:bg-white/6 dark:text-white/25'
          }`}
        >
          <ArrowUpDown
            className={`h-2.5 w-2.5 transition-transform ${
              active && sortDir === 'desc' ? 'rotate-180' : ''
            }`}
          />
        </span>
      </span>
    </th>
  );
}

const TIKTOK_COLUMNS_CATALOG = [
  {
    group: 'performance',
    label: 'Performance',
    items: [
      { key: 'spend', label: 'Spend', icon: DollarSign, default: true },
      { key: 'impressions', label: 'Impressions', icon: Eye, default: true },
      { key: 'clicks', label: 'Clicks', icon: MousePointerClick, default: true },
      { key: 'reach', label: 'Reach', icon: Radio, default: false },
      { key: 'ctr', label: 'CTR', icon: TrendingUp, default: true },
      { key: 'cpc', label: 'CPC', icon: Activity, default: false },
      { key: 'cpm', label: 'CPM', icon: Zap, default: false },
      { key: 'conversions', label: 'Conversions', icon: Target, default: false },
      { key: 'cpa', label: 'Cost per Conversion', icon: Receipt, default: false },
      { key: 'conversionRate', label: 'Conversion Rate', icon: TrendingUp, default: false },
    ],
  },
  {
    group: 'settings',
    label: 'Campaign Details',
    items: [
      { key: 'status', label: 'Status', icon: Activity, default: true },
      { key: 'objective', label: 'Objective', icon: Target, default: true },
      { key: 'budget', label: 'Daily Budget', icon: DollarSign, default: true },
      { key: 'remaining', label: 'Budget Remaining', icon: Receipt, default: true },
      { key: 'startDate', label: 'Start Date', icon: Calendar, default: true },
    ],
  },
  {
    group: 'video',
    label: 'Video',
    items: [
      { key: 'videoPlays', label: 'Video Plays', icon: Play, default: false },
      { key: 'videoViews2s', label: '2-Second Video Views', icon: Eye, default: false },
      { key: 'videoViews6s', label: '6-Second Video Views', icon: Eye, default: false },
      { key: 'avgWatchTime', label: 'Average Watch Time', icon: Activity, default: false },
      { key: 'likes', label: 'Likes', icon: Zap, default: false },
      { key: 'comments', label: 'Comments', icon: Layers, default: false },
      { key: 'shares', label: 'Shares', icon: TrendingUp, default: false },
    ],
  },
];

function TikTokCustomizeColumnsModal({
  open,
  onClose,
  visibleKeys,
  onChange,
}) {
  const [selectedKeys, setSelectedKeys] = useState(visibleKeys || []);
  const [query, setQuery] = useState('');
  const [openGroups, setOpenGroups] = useState(new Set(['performance', 'settings', 'video']));

  useEffect(() => {
    if (open) {
      setSelectedKeys(visibleKeys || []);
      setQuery('');
    }
  }, [open, visibleKeys]);

  const allItems = useMemo(() => {
    return TIKTOK_COLUMNS_CATALOG.flatMap((g) => g.items);
  }, []);

  const defaultKeys = useMemo(() => {
    return allItems.filter((i) => i.default).map((i) => i.key);
  }, [allItems]);

  const filteredGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return TIKTOK_COLUMNS_CATALOG;
    return TIKTOK_COLUMNS_CATALOG.map((group) => {
      const matched = group.items.filter(
        (i) => i.label.toLowerCase().includes(q) || i.key.toLowerCase().includes(q)
      );
      return { ...group, items: matched };
    }).filter((g) => g.items.length > 0);
  }, [query]);

  const filteredKeys = useMemo(() => {
    return filteredGroups.flatMap((g) => g.items).map((i) => i.key);
  }, [filteredGroups]);

  const toggleGroup = (groupId) => {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  const toggleKey = (key) => {
    setSelectedKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  const selectAll = () => {
    setSelectedKeys((prev) => Array.from(new Set([...prev, ...filteredKeys])).slice(0, 20));
  };

  const resetToDefault = () => {
    setSelectedKeys(defaultKeys);
  };

  const handleDone = () => {
    onChange(selectedKeys);
    onClose();
  };

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-300 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={handleDone}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-white/10 dark:bg-[#161616]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-5 py-4 dark:border-white/8">
          <div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Customize columns</h3>
            <p className="mt-0.5 text-xs text-gray-500 dark:text-[#BEBEBE]">
              {selectedKeys.length} / 20 selected · shown for the selected date range
            </p>
          </div>
          <button
            type="button"
            onClick={handleDone}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-white/45 dark:hover:bg-white/8 dark:hover:text-white"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* search & action buttons */}
        <div className="border-b border-gray-200 px-5 py-3 dark:border-white/8">
          <div className="flex items-center gap-2 rounded-full border border-gray-200 bg-gray-50 px-3 py-2 dark:border-white/10 dark:bg-white/4">
            <Search className="h-3.5 w-3.5 shrink-0 text-gray-400 dark:text-white/45" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search metrics…"
              className="w-full bg-transparent text-xs text-gray-900 placeholder:text-gray-400 focus:outline-none dark:text-white dark:placeholder:text-white/40"
            />
          </div>
          <div className="mt-2 flex items-center gap-1.5">
            <button
              type="button"
              onClick={selectAll}
              className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-200 dark:border-white/10 dark:bg-white/5 dark:text-white/70 dark:hover:bg-white/10"
            >
              <CheckCheck className="h-3 w-3" />
              Select all{query ? ` (${filteredKeys.length})` : ''}
            </button>
            <button
              type="button"
              onClick={resetToDefault}
              className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-200 dark:border-white/10 dark:bg-white/5 dark:text-white/70 dark:hover:bg-white/10"
            >
              <RotateCcw className="h-3 w-3" />
              Reset to default
            </button>
          </div>
        </div>

        {/* grouped accordion list */}
        <div className="scrollbar-thin flex-1 overflow-y-auto px-2 py-2">
          {filteredGroups.length === 0 && (
            <div className="px-3 py-8 text-center text-xs text-gray-500 dark:text-white/50">
              No metrics match "{query}".
            </div>
          )}
          {filteredGroups.map(({ group, label, items }) => {
            const isOpen = openGroups.has(group);
            const selectedInGroup = items.filter((m) => selectedKeys.includes(m.key)).length;
            return (
              <div key={group} className="mb-1">
                <button
                  type="button"
                  onClick={() => toggleGroup(group)}
                  className="flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left transition-colors hover:bg-gray-100 dark:hover:bg-white/5"
                >
                  <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-white/55">
                    {label} <span className="font-normal normal-case text-gray-400 dark:text-white/35">({selectedInGroup}/{items.length})</span>
                  </span>
                  <ChevronDown
                    className={`h-3.5 w-3.5 shrink-0 text-gray-400 transition-transform dark:text-white/45 ${isOpen ? 'rotate-180' : ''}`}
                  />
                </button>
                {isOpen && (
                  <div className="flex flex-col gap-0.5 px-1 pb-1">
                    {items.map((entry) => {
                      const Icon = entry.icon;
                      const checked = selectedKeys.includes(entry.key);
                      return (
                        <button
                          type="button"
                          key={entry.key}
                          onClick={() => toggleKey(entry.key)}
                          className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors hover:bg-gray-100 dark:hover:bg-white/5 ${
                            checked ? 'bg-gray-50 dark:bg-white/[0.03]' : ''
                          }`}
                        >
                          <span
                            className={`flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-md border transition-colors ${
                              checked
                                ? 'border-transparent bg-gradient-to-r from-[#02C8C4] to-[#5867EB]'
                                : 'border-gray-300 dark:border-white/20'
                            }`}
                          >
                            {checked && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
                          </span>
                          {Icon && <Icon className="h-3.5 w-3.5 shrink-0 text-gray-400 dark:text-white/50" />}
                          <span className="truncate text-xs text-gray-900 dark:text-white">{entry.label}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* footer */}
        <div className="flex items-center justify-between border-t border-gray-200 px-5 py-3 dark:border-white/8">
          <span className="text-xs text-gray-500 dark:text-white/60">
            {selectedKeys.length} column{selectedKeys.length === 1 ? '' : 's'} enabled
          </span>
          <button
            type="button"
            onClick={handleDone}
            className="rounded-full bg-gradient-to-r from-[#02C8C4] to-[#5867EB] px-5 py-1.5 text-xs font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
          >
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

const Spinner = ({ label }) => (
  <div className="flex items-center justify-center py-10 text-gray-500">
    <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-[#15DCFF]" />
    {label && <span className="ml-3 text-sm">{label}</span>}
  </div>
);

// Meta-style pill dropdown (button + menu, closes on backdrop click)
const PillDropdown = ({ icon: Icon, iconClass = 'text-emerald-500', label, open, setOpen, children }) => (
  <div className="relative">
    <button
      onClick={() => setOpen(!open)}
      className="flex items-center gap-2 rounded-xl border border-[#DDD7CD] bg-[#FCFAF7] px-3 py-2 text-xs font-medium text-[#24211D] shadow-xs backdrop-blur-xl transition-all hover:border-[#DDD7CD] hover:bg-[#EAE5DC] dark:border-white/[0.06] dark:bg-[#171717] dark:text-white dark:hover:border-white/10"
    >
      {Icon && <Icon className={`h-3 w-3 ${iconClass}`} />}
      <span className="max-w-44 truncate">{label}</span>
      <ChevronDown className="h-3 w-3 text-[#7A7369] dark:text-[#BEBEBE]" />
    </button>
    {open && (
      <>
        <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
        <div className="absolute right-0 z-50 mt-1 max-h-72 min-w-52 overflow-auto rounded-xl border border-[#DDD7CD] bg-white p-1 shadow-xl dark:border-white/10 dark:bg-[#171717]">
          {children}
        </div>
      </>
    )}
  </div>
);

const TikTokAdsDashboard = () => {
  const { userData } = useSelector((state) => state.socket);
  const navigate = useNavigate();

  const [accounts, setAccounts] = useState([]);
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [loading, setLoading] = useState(true);
  const [connectionChecked, setConnectionChecked] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [showDisconnectModal, setShowDisconnectModal] = useState(false);
  // Ad whose creative is open in the preview modal (parity with the
  // Meta/Google ad tables, where the thumbnail opens the creative).
  const [previewAd, setPreviewAd] = useState(null);
  const [showWizard, setShowWizard] = useState(false);
  const [campaignCount, setCampaignCount] = useState(0);
  const [activeCount, setActiveCount] = useState(0);
  const [tab, setTab] = useState('analytics');
  const [accountOpen, setAccountOpen] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);
  const [chartMetric, setChartMetric] = useState('spend');

  const [rangeKey, setRangeKey] = useState('last7');
  const [stats, setStats] = useState(null);
  const [chartData, setChartData] = useState([]);
  const [loadingStats, setLoadingStats] = useState(false);

  const [view, setView] = useState('campaigns');
  const [rows, setRows] = useState([]);
  const [loadingRows, setLoadingRows] = useState(false);
  const [selectedCampaign, setSelectedCampaign] = useState(null);
  const [selectedAdGroup, setSelectedAdGroup] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState([
    'status',
    'objective',
    'budget',
    'remaining',
    'startDate',
    'spend',
    'impressions',
    'clicks',
    'ctr',
    'preview',
    'actions',
  ]);

  const toggleColumn = (key) => {
    setVisibleColumns((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  const allColumnsForView = useMemo(() => {
    if (view === 'campaigns') {
      return [
        { key: 'status', label: 'Status' },
        { key: 'objective', label: 'Objective' },
        { key: 'budget', label: 'Daily Budget' },
        { key: 'remaining', label: 'Budget Remaining' },
        { key: 'startDate', label: 'Start Date' },
      ];
    }
    if (view === 'adgroups') {
      return [
        { key: 'status', label: 'Status' },
        { key: 'budget', label: 'Budget' },
        { key: 'spend', label: 'Spend' },
        { key: 'impressions', label: 'Impressions' },
        { key: 'clicks', label: 'Clicks' },
      ];
    }
    return [
      { key: 'preview', label: 'Preview' },
      { key: 'status', label: 'Status' },
      { key: 'spend', label: 'Spend' },
      { key: 'impressions', label: 'Impressions' },
      { key: 'clicks', label: 'Clicks' },
      { key: 'ctr', label: 'CTR' },
    ];
  }, [view]);

  const [sortKey, setSortKey] = useState('name');
  const [sortDir, setSortDir] = useState('asc');

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const sortedAndFilteredRows = useMemo(() => {
    let list = rows;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (r) =>
          (r.name && r.name.toLowerCase().includes(q)) ||
          (r.id && String(r.id).toLowerCase().includes(q)) ||
          (r.objective && r.objective.toLowerCase().includes(q)) ||
          (r.budgetMode && r.budgetMode.toLowerCase().includes(q))
      );
    }
    return [...list].sort((a, b) => {
      let av = a[sortKey] ?? '';
      let bv = b[sortKey] ?? '';
      if (sortKey === 'budget') {
        av = Number(a.budget) || 0;
        bv = Number(b.budget) || 0;
      } else if (sortKey === 'remaining') {
        av = budgetRemaining(a);
        bv = budgetRemaining(b);
        if (typeof av !== 'number') av = 999999999;
        if (typeof bv !== 'number') bv = 999999999;
      } else if (sortKey === 'startDate') {
        av = new Date(a.createTime || 0).getTime();
        bv = new Date(b.createTime || 0).getTime();
      } else if (sortKey === 'spend') {
        av = Number(a.spend) || 0;
        bv = Number(b.spend) || 0;
      } else if (sortKey === 'impressions') {
        av = Number(a.impressions) || 0;
        bv = Number(b.impressions) || 0;
      } else if (sortKey === 'clicks') {
        av = Number(a.clicks) || 0;
        bv = Number(b.clicks) || 0;
      } else if (sortKey === 'reach') {
        av = Number(a.reach || a.impressions) || 0;
        bv = Number(b.reach || b.impressions) || 0;
      } else if (sortKey === 'ctr') {
        av = Number(a.ctr) || 0;
        bv = Number(b.ctr) || 0;
      } else if (sortKey === 'cpc') {
        av = a.spend && a.clicks ? Number(a.spend) / Number(a.clicks) : 0;
        bv = b.spend && b.clicks ? Number(b.spend) / Number(b.clicks) : 0;
      } else if (sortKey === 'cpm') {
        av = a.spend && a.impressions ? (Number(a.spend) / Number(a.impressions)) * 1000 : 0;
        bv = b.spend && b.impressions ? (Number(b.spend) / Number(b.impressions)) * 1000 : 0;
      } else if (sortKey === 'conversions') {
        av = Number(a.conversions) || 0;
        bv = Number(b.conversions) || 0;
      } else if (sortKey === 'cpa') {
        av = a.spend && a.conversions ? Number(a.spend) / Number(a.conversions) : 0;
        bv = b.spend && b.conversions ? Number(b.spend) / Number(b.conversions) : 0;
      } else if (sortKey === 'conversionRate') {
        av = Number(a.conversionRate) || 0;
        bv = Number(b.conversionRate) || 0;
      } else if (sortKey === 'videoPlays') {
        av = Number(a.videoPlayCount || a.videoPlays) || 0;
        bv = Number(b.videoPlayCount || b.videoPlays) || 0;
      } else if (sortKey === 'videoViews2s') {
        av = Number(a.videoWatched2s) || 0;
        bv = Number(b.videoWatched2s) || 0;
      } else if (sortKey === 'videoViews6s') {
        av = Number(a.videoWatched6s) || 0;
        bv = Number(b.videoWatched6s) || 0;
      } else if (sortKey === 'avgWatchTime') {
        av = Number(a.averageVideoPlay) || 0;
        bv = Number(b.averageVideoPlay) || 0;
      } else if (sortKey === 'likes') {
        av = Number(a.likes) || 0;
        bv = Number(b.likes) || 0;
      } else if (sortKey === 'comments') {
        av = Number(a.comments) || 0;
        bv = Number(b.comments) || 0;
      } else if (sortKey === 'shares') {
        av = Number(a.shares) || 0;
        bv = Number(b.shares) || 0;
      }
      const an = parseFloat(av);
      const bn = parseFloat(bv);
      const cmp = !isNaN(an) && !isNaN(bn) ? an - bn : String(av).localeCompare(String(bv));
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [rows, searchQuery, sortKey, sortDir]);

  const [editWizard, setEditWizard] = useState({ open: false, mode: 'create', context: null });

  const tiktokComingSoon = import.meta.env.VITE_TIKTOK_COMING_SOON !== 'true';

  const currency = selectedAccount?.currency || 'USD';

  // ── gate: redirect to picker if TikTok is coming soon or not connected ──
  useEffect(() => {
    if (tiktokComingSoon) {
      navigate('/ads-manager');
      return;
    }
    (async () => {
      try {
        const res = await checkTiktokAccount();
        if (!res?.isConnected || !res?.hasAccount) {
          navigate('/ads-manager');
          return;
        }
        setConnectionChecked(true);
        fetchAccounts();
      } catch {
        navigate('/ads-manager');
      }
    })();
  }, []);

  // ── reload reporting when account, date range, or active tab changes ──
  useEffect(() => {
    if (selectedAccount && tab === 'analytics') loadStats(selectedAccount, rangeKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAccount, rangeKey, tab]);

  // ── reload campaign table when account changes ──
  useEffect(() => {
    if (selectedAccount) loadCampaigns(selectedAccount);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAccount]);

  // ── reload table rows when date range changes ──
  useEffect(() => {
    if (!selectedAccount) return;
    if (view === 'campaigns') loadCampaigns(selectedAccount);
    else if (view === 'adgroups' && selectedCampaign) loadAdGroups(selectedCampaign);
    else if (view === 'ads' && selectedAdGroup) loadAds(selectedAdGroup);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeKey]);

  const fetchAccounts = async () => {
    try {
      setLoading(true);
      const res = await getTiktokAdAccounts();
      const list = res.accounts || [];
      setAccounts(list);
      if (list.length > 0) setSelectedAccount(list[0]);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to load TikTok accounts');
    } finally {
      setLoading(false);
    }
  };

  const loadStats = async (account, key) => {
    setLoadingStats(true);
    setStats(null);
    setChartData([]);
    try {
      const { startDate, endDate, lifetime } = rangeForPreset(key);
      const res = await getTiktokDashboardData({
        advertiserId: account.id,
        startDate,
        endDate,
        lifetime,
      });
      setStats(res.stats || null);
      setChartData(res.chartData || []);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to load performance data');
      setStats(null);
      setChartData([]);
    } finally {
      setLoadingStats(false);
    }
  };

  const loadCampaigns = async (account) => {
    setView('campaigns');
    setSelectedCampaign(null);
    setSelectedAdGroup(null);
    setLoadingRows(true);
    try {
      const { startDate, endDate, lifetime } = rangeForPreset(rangeKey);
      const res = await getTiktokCampaigns(account.id);
      let insightsRows = [];
      try {
        const insights = await getTiktokInsights({
          advertiserId: account.id,
          level: 'campaign',
          startDate,
          endDate,
          lifetime,
          pageSize: 100,
        });
        insightsRows = insights.rows || [];
      } catch {
        // Reporting permission may not be granted yet; still show campaigns.
      }
      const camps = mergeInsights(res.campaigns || [], insightsRows).filter(
        (c) => c.status !== 'DELETED'
      );
      setRows(camps);
      setCampaignCount(camps.length);
      setActiveCount(camps.filter((c) => c.status === 'ACTIVE').length);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to load campaigns');
      setRows([]);
    } finally {
      setLoadingRows(false);
    }
  };

  const loadAdGroups = async (campaign) => {
    setView('adgroups');
    setLoadingRows(true);
    try {
      const { startDate, endDate, lifetime } = rangeForPreset(rangeKey);
      const res = await getTiktokAdGroups(selectedAccount.id, campaign.id);
      let insightsRows = [];
      try {
        const insights = await getTiktokInsights({
          advertiserId: selectedAccount.id,
          level: 'adgroup',
          startDate,
          endDate,
          lifetime,
          pageSize: 100,
        });
        insightsRows = insights.rows || [];
      } catch {
        // Reporting permission may not be granted yet.
      }
      const merged = mergeInsights(res.adGroups || [], insightsRows).filter((r) => r.status !== 'DELETED');
      setRows(merged);
      attachAdGroupReviewInfo(merged);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to load ad groups');
      setRows([]);
    } finally {
      setLoadingRows(false);
    }
  };

  // Paused ad groups are frequently paused because TikTok's review rejected
  // them (fully or partially) — fetch the reason so users don't have to guess
  // why delivery stopped. Best-effort: silently skip if the call fails.
  const attachAdGroupReviewInfo = async (rowsToCheck) => {
    const pausedIds = rowsToCheck.filter((r) => r.status === 'PAUSED').map((r) => r.id).slice(0, 20);
    if (!pausedIds.length) return;
    try {
      const res = await getTiktokAdGroupReviewInfo(selectedAccount.id, pausedIds);
      const byId = new Map((res.adGroups || []).map((info) => [info.adgroupId, info]));
      setRows((prev) => prev.map((r) => (byId.has(r.id) ? { ...r, reviewInfo: byId.get(r.id) } : r)));
    } catch {
      // Review info is a nice-to-have — don't block the row list on it.
    }
  };

  // Same idea at the ad level.
  const attachAdReviewInfo = async (rowsToCheck) => {
    const pausedIds = rowsToCheck.filter((r) => r.status === 'PAUSED').map((r) => r.id).slice(0, 100);
    if (!pausedIds.length) return;
    try {
      const res = await getTiktokAdReviewInfo(selectedAccount.id, pausedIds);
      const byId = new Map((res.ads || []).map((info) => [info.adId, info]));
      setRows((prev) => prev.map((r) => (byId.has(r.id) ? { ...r, reviewInfo: byId.get(r.id) } : r)));
    } catch {
      // Review info is a nice-to-have — don't block the row list on it.
    }
  };

  const loadAds = async (adgroup) => {
    setView('ads');
    setLoadingRows(true);
    try {
      const { startDate, endDate, lifetime } = rangeForPreset(rangeKey);
      const res = await getTiktokAds(selectedAccount.id, adgroup.id);
      let insightsRows = [];
      try {
        const insights = await getTiktokInsights({
          advertiserId: selectedAccount.id,
          level: 'ad',
          startDate,
          endDate,
          lifetime,
          pageSize: 100,
        });
        insightsRows = insights.rows || [];
      } catch {
        // Reporting permission may not be granted yet.
      }
      const merged = mergeInsights(res.ads || [], insightsRows).filter((r) => r.status !== 'DELETED');
      setRows(merged);
      attachAdReviewInfo(merged);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to load ads');
      setRows([]);
    } finally {
      setLoadingRows(false);
    }
  };

  const onRowClick = (row) => {
    if (view === 'campaigns') {
      setSelectedCampaign(row);
      loadAdGroups(row);
    } else if (view === 'adgroups') {
      setSelectedAdGroup(row);
      loadAds(row);
    }
  };

  const updateRowStatus = (id, status) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)));

  const toggleStatus = async (e, row) => {
    e?.stopPropagation?.();
    if (row.status === 'DELETED') return;
    const level = LEVEL_BY_VIEW[view];
    const next = row.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
    updateRowStatus(row.id, next); // optimistic
    try {
      await updateTiktokStatus({
        advertiserId: selectedAccount.id,
        level,
        ids: [row.id],
        status: next,
      });
      if (level === 'campaign') {
        if (next === 'ACTIVE') {
          GA4Events.adFactoryCampaignStarted(['tiktok'], { source: 'ads_manager', campaignId: row.id });
        } else {
          GA4Events.adFactoryCampaignStopped(['tiktok'], { source: 'ads_manager', campaignId: row.id });
        }
      }
      toast.success(`${level} ${next === 'ACTIVE' ? 'activated' : 'paused'}`);
    } catch (err) {
      updateRowStatus(row.id, row.status); // revert
      toast.error(err.response?.data?.error || 'Failed to update status');
    }
  };

  const handleEdit = (e, row) => {
    e.stopPropagation();
    const type = LEVEL_BY_VIEW[view];
    const mode = type === 'campaign' ? 'edit-campaign' : type === 'adgroup' ? 'edit-adgroup' : 'edit-ad';
    setEditWizard({ open: true, mode, context: row });
  };

  const closeEditWizard = () => setEditWizard({ open: false, mode: 'create', context: null });

  const onEditWizardSaved = () => {
    closeEditWizard();
    if (view === 'campaigns') loadCampaigns(selectedAccount);
    else if (view === 'adgroups' && selectedCampaign) loadAdGroups(selectedCampaign);
    else if (view === 'ads' && selectedAdGroup) loadAds(selectedAdGroup);
  };

  const handleDisconnect = async () => {
    setShowDisconnectModal(false);
    setDisconnecting(true);
    try {
      const res = await disconnectTiktokUser(userData?.user_id);
      toast.success(res?.message || 'TikTok account disconnected');
      navigate('/ads-manager');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to disconnect TikTok account');
      setDisconnecting(false);
    }
  };

  const kpis = stats
    ? [
        { icon: DollarSign, label: 'Spend', value: fmtCurrency(stats.totalSpend, currency) },
        { icon: Eye, label: 'Impressions', value: fmtNum(stats.totalImpressions) },
        { icon: MousePointerClick, label: 'Clicks', value: fmtNum(stats.totalClicks) },
        { icon: TrendingUp, label: 'CTR', value: fmtPct(stats.ctr) },
        { icon: Activity, label: 'CPC', value: fmtCurrency(stats.cpc, currency) },
        { icon: Zap, label: 'CPM', value: fmtCurrency(stats.cpm, currency) },
        { icon: Target, label: 'Conversions', value: fmtNum(stats.totalConversions) },
        { icon: Receipt, label: 'CPA', value: fmtCurrency(stats.cpa, currency) },
      ]
    : [];

  const disconnectBtn = (
    <button
      onClick={() => setShowDisconnectModal(true)}
      disabled={disconnecting}
      className="flex items-center gap-1.5 rounded-xl border border-red-500/20 bg-red-500/5 px-3 py-1.5 text-xs font-bold text-red-600 transition-all hover:border-red-500/40 hover:bg-red-500/10 disabled:opacity-50 dark:text-red-400"
    >
      {disconnecting ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <LogOut className="h-3 w-3" />
      )}
      {disconnecting ? 'Disconnecting…' : 'Disconnect'}
    </button>
  );

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-gray-900 dark:text-white">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-300 border-t-[#15DCFF]" />
        <span className="ml-3">Loading TikTok accounts...</span>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col overflow-auto p-6 text-gray-900 dark:text-white">
      {/* Header — title left, account + date pickers and theme toggle top-right (Meta-style) */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#DDD7CD] pb-3 dark:border-white/10">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-[#DDD7CD] bg-[#FCFAF7] shadow-xs 2xl:h-12 2xl:w-12 dark:border-white/10 dark:bg-white">
              <FaTiktok className="h-6 w-6 text-black 2xl:h-7 2xl:w-7" />
            </div>
            <AdsManagerModeSwitcher activeMode="manager" platform="TikTok" />
          </div>
          <p className="px-1 text-xs font-medium text-[#7A7369] dark:text-[#BEBEBE]">
            Manage · Analyse · Optimise
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <WorkspaceSwitcher />
          {accounts.length > 0 && (
            <>
              <PillDropdown
                icon={Radio}
                label={selectedAccount?.name || 'Account'}
                open={accountOpen}
                setOpen={setAccountOpen}
              >
                {accounts.map((acc) => (
                  <button
                    key={acc.id}
                    onClick={() => {
                      setSelectedAccount(acc);
                      setAccountOpen(false);
                    }}
                    className={`block w-full rounded-lg px-3 py-2 text-left text-xs transition hover:bg-gray-100 dark:hover:bg-white/5 ${
                      selectedAccount?.id === acc.id ? 'text-[#15DCFF]' : 'text-gray-900 dark:text-white'
                    }`}
                  >
                    {acc.name} ({acc.currency})
                  </button>
                ))}
              </PillDropdown>
              <PillDropdown
                icon={Calendar}
                iconClass="text-gray-400"
                label={DATE_PRESETS.find((p) => p.value === rangeKey)?.label || 'Date range'}
                open={dateOpen}
                setOpen={setDateOpen}
              >
                {DATE_PRESETS.map((p) => (
                  <button
                    key={p.value}
                    onClick={() => {
                      setRangeKey(p.value);
                      setDateOpen(false);
                    }}
                    className={`block w-full rounded-lg px-3 py-2 text-left text-xs transition hover:bg-gray-100 dark:hover:bg-white/5 ${
                      rangeKey === p.value ? 'text-[#15DCFF]' : 'text-gray-900 dark:text-white'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </PillDropdown>
            </>
          )}
          <div className="ml-1 2xl:ml-2">
            <ThemeToggle />
          </div>
        </div>
      </div>

      {accounts.length === 0 ? (
        <div className="rounded-xl border border-[#DDD7CD] bg-white p-8 text-center dark:border-white/10 dark:bg-[#161616]">
          <p className="text-lg font-medium">No TikTok ad accounts found</p>
          <p className="mt-2 text-sm text-gray-500">
            Make sure your TikTok Business account has at least one ad account.
          </p>
          <div className="mt-4 flex justify-center">{disconnectBtn}</div>
        </div>
      ) : (
        <>
          {/* Account summary strip — metadata left, Disconnect right (Meta-style) */}
          {selectedAccount && (
            <div className="mb-3 flex flex-wrap items-center justify-between gap-5 border-b border-[#DDD7CD] px-1 py-3 dark:border-white/10">
              <div className="flex flex-wrap items-center gap-5">
                {[
                  { label: 'Account', value: selectedAccount.name },
                  {
                    label: 'Campaigns',
                    value: (
                      <>
                        {campaignCount}
                        {activeCount > 0 && (
                          <span className="ml-1 text-emerald-500">({activeCount} active)</span>
                        )}
                      </>
                    ),
                  },
                  { label: 'Currency', value: selectedAccount.currency },
                  { label: 'Status', value: prettyStatus(selectedAccount.status) },
                ].map((item, i) => (
                  <React.Fragment key={item.label}>
                    {i > 0 && <div className="h-3.5 w-px self-center bg-gray-300 dark:bg-white/20" />}
                    <div className="flex items-center gap-2 text-sm leading-none">
                      <span className="text-xs font-medium uppercase tracking-wider text-gray-400">
                        {item.label}
                      </span>
                      <span className="font-semibold">{item.value}</span>
                    </div>
                  </React.Fragment>
                ))}
              </div>
              {disconnectBtn}
            </div>
          )}

          {/* Tabs (Analytics | Campaigns) — matches Meta Ads Manager */}
          <div className="mb-4 flex items-center gap-1 border-b border-[#DDD7CD] dark:border-white/10">
            {[
              { id: 'analytics', label: 'Analytics', icon: TrendingUp },
              { id: 'campaigns', label: 'Campaigns', icon: Layers },
            ].map((t) => {
              const TabIcon = t.icon;
              return (
                <button
                  key={t.id}
                  onClick={() => {
                    if (t.id === tab) return;
                    if (t.id === 'analytics' && selectedAccount) {
                      setLoadingStats(true);
                      setStats(null);
                      setChartData([]);
                    }
                    setTab(t.id);
                  }}
                  className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition ${
                    tab === t.id
                      ? 'border-gray-900 text-gray-900 dark:border-white dark:text-white'
                      : 'border-transparent text-gray-400 hover:text-gray-600 dark:hover:text-gray-200'
                  }`}
                >
                  <TabIcon className="h-3.5 w-3.5" /> {t.label}
                </button>
              );
            })}
          </div>

          {/* ── Analytics tab ── */}
          {tab === 'analytics' && (
            <>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-bold">Account Analytics</h2>
                <button
                  onClick={() => selectedAccount && loadStats(selectedAccount, rangeKey)}
                  className="flex items-center gap-2 rounded-xl border border-gray-300 px-3 py-1.5 text-xs font-medium hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-800"
                >
                  <RefreshCw size={13} /> Refresh
                </button>
              </div>

          {/* KPI cards */}
          {loadingStats ? (
            <div className="mb-6 rounded-xl border border-gray-200 dark:border-white/10 dark:bg-[#161616]">
              <Spinner label="Loading performance..." />
            </div>
          ) : (
            kpis.length > 0 && (
              <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
                {kpis.map((k) => (
                  <KpiCard key={k.label} icon={k.icon} label={k.label} value={k.value} />
                ))}
              </div>
            )
          )}

          {/* Performance over time (matches Meta Ads Manager) */}
          {!loadingStats && (
            <div className="mb-6 rounded-2xl border border-gray-200 p-4 dark:border-white/10 dark:bg-[#161616]">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-200">
                  <TrendingUp className="h-4 w-4" /> Performance over time
                </h2>
                <div className="flex items-center gap-1 rounded-lg border border-gray-200 p-1 dark:border-white/10">
                  {['spend', 'clicks'].map((m) => (
                    <button
                      key={m}
                      onClick={() => setChartMetric(m)}
                      className={`rounded-md px-3 py-1 text-xs font-medium capitalize transition ${
                        chartMetric === m
                          ? 'bg-gray-100 text-[#15DCFF] dark:bg-white/5'
                          : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>
              <div className="h-64 w-full">
                {chartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="ttChart" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#15DCFF" stopOpacity={0.4} />
                          <stop offset="95%" stopColor="#15DCFF" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#88888822" />
                      <XAxis
                        dataKey="date"
                        tickFormatter={(d) => (d ? String(d).slice(5, 10) : '')}
                        tick={{ fontSize: 11, fill: '#888' }}
                      />
                      <YAxis tick={{ fontSize: 11, fill: '#888' }} />
                      <Tooltip
                        formatter={(value) =>
                          chartMetric === 'spend'
                            ? [fmtCurrency(value, currency), 'Spend']
                            : [fmtNum(value), 'Clicks']
                        }
                      />
                      <Area
                        type="monotone"
                        dataKey={chartMetric}
                        stroke="#15DCFF"
                        fill="url(#ttChart)"
                        strokeWidth={2}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full flex-col items-center justify-center text-center">
                    <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                      No data for this period
                    </p>
                    <p className="mt-1 max-w-md text-xs text-gray-400">
                      There were no impressions, clicks, or spend recorded for the selected date
                      range. Try a different date preset or account.
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
            </>
          )}

          {/* ── Campaigns tab ── */}
          {tab === 'campaigns' && (
            <div className="flex min-h-0 flex-1 flex-col gap-3">
              {/* Header Title + Subtitle (matching Meta Ads Manager) */}
              <div className="shrink-0">
                <h1 className="text-base font-bold text-gray-900 2xl:text-xl dark:text-white">Campaigns</h1>
                <p className="text-xs 2xl:text-sm text-gray-500 dark:text-[#BEBEBE]">
                  Build and manage TikTok Ads Manager campaigns end-to-end
                </p>
              </div>

              {/* Breadcrumb row */}
              <div className="flex shrink-0 items-center">
                <div className="flex items-center gap-1.5 text-sm font-semibold">
                  <button
                    onClick={() => {
                      setSearchQuery('');
                      loadCampaigns(selectedAccount);
                    }}
                    className={`transition ${
                      view === 'campaigns'
                        ? 'text-gray-900 dark:text-white font-bold'
                        : 'text-gray-500 hover:text-gray-900 dark:hover:text-white'
                    }`}
                  >
                    Campaigns
                  </button>
                  {selectedCampaign && (
                    <>
                      <ChevronRight size={14} className="text-gray-400" />
                      <button
                        onClick={() => {
                          setSearchQuery('');
                          loadAdGroups(selectedCampaign);
                        }}
                        className={`transition ${
                          view === 'adgroups'
                            ? 'text-gray-900 dark:text-white font-bold'
                            : 'text-gray-500 hover:text-gray-900 dark:hover:text-white'
                        }`}
                      >
                        {selectedCampaign.name}
                      </button>
                    </>
                  )}
                  {selectedAdGroup && (
                    <>
                      <ChevronRight size={14} className="text-gray-400" />
                      <span className="font-bold text-gray-900 dark:text-white">
                        {selectedAdGroup.name}
                      </span>
                    </>
                  )}
                </div>
              </div>

              {/* Campaigns Table Card with fixed internal scroll container */}
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-gray-200 dark:border-white/10 dark:bg-[#141414]">
                {/* Card Header Toolbar — Count on left, Search, Refresh, Columns, Create on right */}
                <div className="flex shrink-0 items-center justify-between gap-2 border-b border-gray-200 p-3 dark:border-white/12">
                  <div className="flex min-w-0 items-center gap-2">
                    <p className="truncate text-xs font-semibold text-gray-500 dark:text-white/70">
                      {view === 'campaigns'
                        ? `${sortedAndFilteredRows.length} ${sortedAndFilteredRows.length === 1 ? 'campaign' : 'campaigns'}`
                        : view === 'adgroups' && selectedCampaign
                          ? `Ad groups in ${selectedCampaign.name}`
                          : view === 'ads' && selectedAdGroup
                            ? `Ads in ${selectedAdGroup.name}`
                            : `${sortedAndFilteredRows.length} ${view}`}
                    </p>
                  </div>

                  {/* Actions Right */}
                  <div className="flex items-center gap-2">
                    {/* Search input */}
                    <div className="relative w-48 sm:w-56">
                      <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-white/40" />
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder={
                          view === 'campaigns'
                            ? 'Search campaigns…'
                            : view === 'adgroups'
                              ? 'Search ad groups…'
                              : 'Search ads…'
                        }
                        className="w-full rounded-full border border-gray-300 bg-gray-100 py-1.5 pl-9 pr-8 text-xs text-gray-900 placeholder:text-gray-400 transition-colors hover:border-gray-400 focus:border-gray-400 focus:outline-none dark:border-white/10 dark:bg-[#171717] dark:text-white dark:placeholder:text-white/40 dark:hover:border-white/15 dark:focus:border-white/25"
                      />
                      {searchQuery && (
                        <button
                          type="button"
                          onClick={() => setSearchQuery('')}
                          className="absolute top-1/2 right-2.5 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:text-white/40 dark:hover:text-white/70"
                          aria-label="Clear search"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>

                    {/* Refresh button */}
                    <button
                      type="button"
                      onClick={() => {
                        if (!selectedAccount) return;
                        if (view === 'campaigns') loadCampaigns(selectedAccount);
                        else if (view === 'adgroups' && selectedCampaign) loadAdGroups(selectedCampaign);
                        else if (view === 'ads' && selectedAdGroup) loadAds(selectedAdGroup);
                      }}
                      disabled={loadingRows}
                      title="Refresh"
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-gray-100 text-gray-400 transition-all hover:border-gray-300 hover:bg-gray-200 hover:text-gray-900 disabled:opacity-50 dark:border-white/8 dark:bg-white/2 dark:text-white/40 dark:hover:border-white/20 dark:hover:bg-white/8 dark:hover:text-white"
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${loadingRows ? 'animate-spin' : ''}`} />
                    </button>

                    {/* Columns Button */}
                    <button
                      type="button"
                      onClick={() => setColumnsOpen(true)}
                      className="flex items-center gap-1.5 rounded-xl border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-100 dark:border-white/10 dark:bg-white/5 dark:text-white/80 dark:hover:bg-white/10"
                    >
                      <SlidersHorizontal className="h-3.5 w-3.5" />
                      Columns
                      {visibleColumns.length > 0 && (
                        <span className="ml-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-gray-200 px-1 text-[10px] font-semibold text-gray-700 dark:bg-white/15 dark:text-white">
                          {visibleColumns.length}
                        </span>
                      )}
                    </button>

                    {/* Dynamic Action Button (+ New Campaign / + Add Ad Group / + Add Ad) */}
                    <button
                      type="button"
                      onClick={() => {
                        if (view === 'campaigns') {
                          setShowWizard(true);
                        } else if (view === 'adgroups') {
                          setEditWizard({ open: true, mode: 'add-adgroup', context: selectedCampaign });
                        } else if (view === 'ads') {
                          setEditWizard({ open: true, mode: 'add-ad', context: selectedAdGroup });
                        }
                      }}
                      className="flex items-center gap-1.5 rounded-full bg-white px-3.5 py-1.5 text-xs font-semibold text-black transition-all hover:bg-gray-100 dark:bg-white dark:text-black shadow-xs"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      {view === 'campaigns'
                        ? 'New Campaign'
                        : view === 'adgroups'
                          ? 'Add Ad Group'
                          : 'Add Ad'}
                    </button>
                  </div>
                </div>

                {/* Table Scrollable Container with scrollbar inside the card */}
                <div className="scrollbar-thin flex-1 overflow-auto">
                  {loadingRows ? (
                    <Spinner label={`Loading ${view}...`} />
                  ) : sortedAndFilteredRows.length === 0 ? (
                    <div className="px-4 py-12 text-center text-sm text-gray-500">
                      {searchQuery ? `No ${view} matching "${searchQuery}"` : `No ${view} found.`}
                    </div>
                  ) : (
                    <table className="w-full text-left text-sm border-collapse">
                      <thead className="sticky top-0 z-10 border-b border-gray-200 bg-gray-50 dark:border-white/12 dark:bg-[#181818]">
                        <tr>
                          {view === 'ads' && visibleColumns.includes('preview') && (
                            <th className="w-20 px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-white/70">Preview</th>
                          )}
                          <SortTh
                            label={view === 'campaigns' ? 'Campaign' : view === 'adgroups' ? 'Ad Group' : 'Ad'}
                            colKey="name"
                            sortKey={sortKey}
                            sortDir={sortDir}
                            onSort={toggleSort}
                            className="w-[36%] pl-5"
                          />
                          {visibleColumns.includes('status') && (
                            <SortTh label="Status" colKey="status" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                          )}
                          {view === 'campaigns' && visibleColumns.includes('objective') && (
                            <SortTh label="Objective" colKey="objective" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                          )}
                          {view === 'adgroups' && visibleColumns.includes('objective') && (
                            <SortTh label="Optimization Goal" colKey="optimizationGoal" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                          )}
                          {(view === 'campaigns' || view === 'adgroups') && visibleColumns.includes('budget') && (
                            <SortTh label={view === 'campaigns' ? 'Daily Budget' : 'Daily Budget'} colKey="budget" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                          )}
                          {view === 'campaigns' && visibleColumns.includes('remaining') && (
                            <SortTh label="Budget Remaining" colKey="remaining" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                          )}
                          {(view === 'campaigns' || view === 'adgroups') && visibleColumns.includes('startDate') && (
                            <SortTh label="Start Date" colKey="startDate" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                          )}
                          {visibleColumns.includes('spend') && (
                            <SortTh label="Spend" colKey="spend" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                          )}
                          {visibleColumns.includes('impressions') && (
                            <SortTh label="Impressions" colKey="impressions" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                          )}
                          {visibleColumns.includes('clicks') && (
                            <SortTh label="Clicks" colKey="clicks" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                          )}
                          {visibleColumns.includes('reach') && (
                            <SortTh label="Reach" colKey="reach" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                          )}
                          {visibleColumns.includes('ctr') && (
                            <SortTh label="CTR" colKey="ctr" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                          )}
                          {visibleColumns.includes('cpc') && (
                            <SortTh label="CPC" colKey="cpc" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                          )}
                          {visibleColumns.includes('cpm') && (
                            <SortTh label="CPM" colKey="cpm" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                          )}
                          {visibleColumns.includes('conversions') && (
                            <SortTh label="Conversions" colKey="conversions" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                          )}
                          {visibleColumns.includes('cpa') && (
                            <SortTh label="Cost / Conv" colKey="cpa" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                          )}
                          {visibleColumns.includes('conversionRate') && (
                            <SortTh label="CVR" colKey="conversionRate" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                          )}
                          {visibleColumns.includes('videoPlays') && (
                            <SortTh label="Video Plays" colKey="videoPlays" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                          )}
                          {visibleColumns.includes('videoViews2s') && (
                            <SortTh label="2s Views" colKey="videoViews2s" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                          )}
                          {visibleColumns.includes('videoViews6s') && (
                            <SortTh label="6s Views" colKey="videoViews6s" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                          )}
                          {visibleColumns.includes('avgWatchTime') && (
                            <SortTh label="Avg Watch" colKey="avgWatchTime" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                          )}
                          {visibleColumns.includes('likes') && (
                            <SortTh label="Likes" colKey="likes" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                          )}
                          {visibleColumns.includes('comments') && (
                            <SortTh label="Comments" colKey="comments" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                          )}
                          {visibleColumns.includes('shares') && (
                            <SortTh label="Shares" colKey="shares" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                          )}
                          {visibleColumns.includes('actions') && (
                            <th className="w-16 pr-5 pl-2 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-white/70">Actions</th>
                          )}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 dark:divide-white/6">
                        {sortedAndFilteredRows.map((row) => (
                          <tr
                            key={row.id}
                            onClick={() => onRowClick(row)}
                            className={`group border-b border-gray-200 transition-colors dark:border-white/10 last:border-b-0 ${
                              view !== 'ads'
                                ? 'cursor-pointer hover:bg-gray-100 dark:hover:bg-white/3'
                                : 'cursor-default'
                            }`}
                          >
                            {view === 'ads' && visibleColumns.includes('preview') && (
                              <td className="px-4 py-4">
                                <button
                                  type="button"
                                  title="Preview ad"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setPreviewAd(row);
                                  }}
                                  className="relative block h-11 w-16 cursor-pointer overflow-hidden rounded-lg border border-gray-200 bg-gray-100 transition hover:ring-2 hover:ring-gray-300 dark:border-white/10 dark:bg-[#1e1e1e] dark:hover:ring-white/30"
                                >
                                  {row.thumbnailUrl ? (
                                    <img
                                      src={row.thumbnailUrl}
                                      alt={row.name}
                                      loading="lazy"
                                      className="h-full w-full object-cover"
                                      onError={(e) => {
                                        e.currentTarget.style.display = 'none';
                                      }}
                                    />
                                  ) : (
                                    <div className="flex h-full w-full items-center justify-center">
                                      <ImageIcon className="h-4 w-4 text-gray-400 dark:text-white/20" />
                                    </div>
                                  )}
                                  {row.mediaType === 'video' && (
                                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/40">
                                      <Play className="h-3 w-3 fill-white text-white" />
                                    </div>
                                  )}
                                </button>
                              </td>
                            )}
                            <td className="pl-5 pr-4 py-4">
                              <div className="flex items-center gap-3">
                                <div className="h-8 w-0.5 shrink-0 rounded-full bg-gray-300 dark:bg-white/20" />
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-sm font-semibold text-gray-900 dark:text-white leading-tight">
                                    {row.name}
                                  </p>
                                  <p className="mt-0.5 font-mono text-[11px] text-gray-400 dark:text-white/40">
                                    ID: {row.id}
                                  </p>
                                </div>
                              </div>
                            </td>
                            {visibleColumns.includes('status') && (
                              <td className="px-4 py-4">
                                <div className="flex items-center gap-2.5">
                                  <StatusBadge status={row.status} />
                                  <RejectionWarning reviewInfo={row.reviewInfo} />
                                  <ToggleSwitch
                                    status={row.status}
                                    onToggle={(e) => toggleStatus(e, row)}
                                    disabled={row.status === 'DELETED'}
                                  />
                                </div>
                              </td>
                            )}
                            {view === 'campaigns' && visibleColumns.includes('objective') && (
                              <td className="px-4 py-4">
                                <span className="flex items-center gap-1.5 text-sm text-gray-600 dark:text-white/80">
                                  <Target className="h-3.5 w-3.5 shrink-0 text-gray-400 dark:text-white/30" />
                                  {prettyStatus(row.objective) || '—'}
                                </span>
                              </td>
                            )}
                            {view === 'adgroups' && visibleColumns.includes('objective') && (
                              <td className="px-4 py-4">
                                <span className="flex items-center gap-1.5 text-sm text-gray-600 dark:text-white/80">
                                  <Activity className="h-3.5 w-3.5 shrink-0 text-gray-400 dark:text-white/30" />
                                  {prettyStatus(row.optimizationGoal || row.billingEvent || row.objectiveType) || 'Conversions'}
                                </span>
                              </td>
                            )}
                            {(view === 'campaigns' || view === 'adgroups') && visibleColumns.includes('budget') && (
                              <td className="px-4 py-4 text-sm font-medium text-gray-600 dark:text-white/80">
                                {row.budgetMode === 'BUDGET_MODE_INFINITE' ? (
                                  <span className="text-gray-400 dark:text-white/40">Set on campaign (CBO)</span>
                                ) : row.budget ? (
                                  fmtCurrency(row.budget, currency)
                                ) : (
                                  <span className="text-gray-400 dark:text-white/40">Set on campaign (CBO)</span>
                                )}
                              </td>
                            )}
                            {view === 'campaigns' && visibleColumns.includes('remaining') && (
                              <td className="px-4 py-4 text-sm text-gray-600 dark:text-white/80">
                                {typeof budgetRemaining(row) === 'number'
                                  ? fmtCurrency(budgetRemaining(row), currency)
                                  : budgetRemaining(row)}
                              </td>
                            )}
                            {(view === 'campaigns' || view === 'adgroups') && visibleColumns.includes('startDate') && (
                              <td className="px-4 py-4">
                                <span className="flex items-center gap-1.5 text-sm text-gray-600 dark:text-white/80">
                                  <Calendar className="h-3.5 w-3.5 shrink-0 text-gray-400 dark:text-white/30" />
                                  {fmtDate(row.createTime || row.scheduleStartTime)}
                                </span>
                              </td>
                            )}
                            {visibleColumns.includes('spend') && (
                              <td className="px-4 py-4 text-sm text-gray-600 dark:text-white/80">{fmtCurrency(row.spend, currency)}</td>
                            )}
                            {visibleColumns.includes('impressions') && (
                              <td className="px-4 py-4 text-sm text-gray-600 dark:text-white/80">{fmtNum(row.impressions)}</td>
                            )}
                            {visibleColumns.includes('clicks') && (
                              <td className="px-4 py-4 text-sm text-gray-600 dark:text-white/80">{fmtNum(row.clicks)}</td>
                            )}
                            {visibleColumns.includes('reach') && (
                              <td className="px-4 py-4 text-sm text-gray-600 dark:text-white/80">{fmtNum(row.reach || row.impressions)}</td>
                            )}
                            {visibleColumns.includes('ctr') && (
                              <td className="px-4 py-4 text-sm text-gray-600 dark:text-white/80">{fmtPct(row.ctr)}</td>
                            )}
                            {visibleColumns.includes('cpc') && (
                              <td className="px-4 py-4 text-sm text-gray-600 dark:text-white/80">
                                {row.spend && row.clicks ? fmtCurrency(Number(row.spend) / Number(row.clicks), currency) : '—'}
                              </td>
                            )}
                            {visibleColumns.includes('cpm') && (
                              <td className="px-4 py-4 text-sm text-gray-600 dark:text-white/80">
                                {row.spend && row.impressions ? fmtCurrency((Number(row.spend) / Number(row.impressions)) * 1000, currency) : '—'}
                              </td>
                            )}
                            {visibleColumns.includes('conversions') && (
                              <td className="px-4 py-4 text-sm text-gray-600 dark:text-white/80">{fmtNum(row.conversions || 0)}</td>
                            )}
                            {visibleColumns.includes('cpa') && (
                              <td className="px-4 py-4 text-sm text-gray-600 dark:text-white/80">
                                {row.spend && row.conversions ? fmtCurrency(Number(row.spend) / Number(row.conversions), currency) : '—'}
                              </td>
                            )}
                            {visibleColumns.includes('conversionRate') && (
                              <td className="px-4 py-4 text-sm text-gray-600 dark:text-white/80">{fmtPct(row.conversionRate || 0)}</td>
                            )}
                            {visibleColumns.includes('videoPlays') && (
                              <td className="px-4 py-4 text-sm text-gray-600 dark:text-white/80">{fmtNum(row.videoPlayCount || row.videoPlays || 0)}</td>
                            )}
                            {visibleColumns.includes('videoViews2s') && (
                              <td className="px-4 py-4 text-sm text-gray-600 dark:text-white/80">{fmtNum(row.videoWatched2s || 0)}</td>
                            )}
                            {visibleColumns.includes('videoViews6s') && (
                              <td className="px-4 py-4 text-sm text-gray-600 dark:text-white/80">{fmtNum(row.videoWatched6s || 0)}</td>
                            )}
                            {visibleColumns.includes('avgWatchTime') && (
                              <td className="px-4 py-4 text-sm text-gray-600 dark:text-white/80">
                                {row.averageVideoPlay ? `${Number(row.averageVideoPlay).toFixed(1)}s` : '—'}
                              </td>
                            )}
                            {visibleColumns.includes('likes') && (
                              <td className="px-4 py-4 text-sm text-gray-600 dark:text-white/80">{fmtNum(row.likes || 0)}</td>
                            )}
                            {visibleColumns.includes('comments') && (
                              <td className="px-4 py-4 text-sm text-gray-600 dark:text-white/80">{fmtNum(row.comments || 0)}</td>
                            )}
                            {visibleColumns.includes('shares') && (
                              <td className="px-4 py-4 text-sm text-gray-600 dark:text-white/80">{fmtNum(row.shares || 0)}</td>
                            )}
                            {visibleColumns.includes('actions') && (
                              <td className="pr-5 pl-2 py-4">
                                <div className="flex items-center justify-end gap-1.5">
                                  <button
                                    onClick={(e) => handleEdit(e, row)}
                                    title="Edit"
                                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-gray-100 text-gray-400 transition-all hover:border-gray-300 hover:bg-gray-200 hover:text-gray-900 dark:border-white/8 dark:bg-white/2 dark:text-white/40 dark:hover:border-white/20 dark:hover:bg-white/8 dark:hover:text-white"
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                  </button>
                                  {view !== 'ads' && <ChevronRight size={16} className="text-gray-400" />}
                                </div>
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>

              {/* Customize Columns Modal */}
              <TikTokCustomizeColumnsModal
                open={columnsOpen}
                onClose={() => setColumnsOpen(false)}
                visibleKeys={visibleColumns}
                onChange={(nextKeys) => setVisibleColumns(nextKeys)}
              />
            </div>
          )}
        </>
      )}

      {/* ── create campaign wizard ── */}
      {showWizard && selectedAccount && (
        <CreateCampaignWizard
          advertiserId={selectedAccount.id}
          accountName={selectedAccount.name || selectedAccount.advertiserName || ''}
          accounts={accounts}
          currency={currency}
          timezone={selectedAccount.timezone}
          onClose={() => setShowWizard(false)}
          onCreated={() => loadCampaigns(selectedAccount)}
          onChangeAccount={(id) => {
            const acc = accounts.find((a) => a.id === id);
            if (acc) setSelectedAccount(acc);
          }}
        />
      )}

      {/* ── edit wizard ── */}
      {editWizard.open && selectedAccount && (
        <CreateCampaignWizard
          advertiserId={selectedAccount.id}
          accountName={selectedAccount.name || selectedAccount.advertiserName || ''}
          accounts={accounts}
          currency={currency}
          timezone={selectedAccount.timezone}
          mode={editWizard.mode}
          context={editWizard.context}
          onClose={closeEditWizard}
          onCreated={onEditWizardSaved}
          onChangeAccount={(id) => {
            const acc = accounts.find((a) => a.id === id);
            if (acc) setSelectedAccount(acc);
          }}
        />
      )}

      {/* ── disconnect confirmation modal (matches Meta Ads Manager) ── */}
      <AnimatePresence>
        {showDisconnectModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-100 flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={() => setShowDisconnectModal(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 8 }}
              transition={{ duration: 0.18 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-sm rounded-2xl workspace-card p-6 shadow-2xl dark:border-white/8 dark:bg-[#161616]"
            >
              <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-red-500/10">
                <LogOut className="h-5 w-5 text-red-600 dark:text-red-400" />
              </div>
              <h2 className="mb-1 text-sm font-bold text-gray-900 dark:text-white">
                Disconnect TikTok Account?
              </h2>
              <p className="mb-6 text-xs text-gray-500 dark:text-[#BEBEBE]">
                This will remove the connection to your TikTok Ads account. You can reconnect at any
                time from the Ads Manager.
              </p>
              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={() => setShowDisconnectModal(false)}
                  className="rounded-xl border border-gray-200 bg-gray-100 px-4 py-2 text-xs font-medium text-gray-900 transition-all hover:bg-gray-200 dark:border-white/8 dark:bg-white/5 dark:text-white dark:hover:bg-white/10"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDisconnect}
                  disabled={disconnecting}
                  className="flex items-center gap-1.5 rounded-xl bg-red-500/80 px-4 py-2 text-xs font-bold text-white transition-all hover:bg-red-500 disabled:opacity-50"
                >
                  {disconnecting && <Loader2 className="h-3 w-3 animate-spin" />}
                  Disconnect
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── ad creative preview modal (parity with Meta/Google ad previews) ── */}
      <AnimatePresence>
        {previewAd && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-100 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
            onClick={() => setPreviewAd(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 8 }}
              transition={{ duration: 0.18 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-sm overflow-hidden rounded-2xl workspace-card shadow-2xl dark:border-white/8 dark:bg-[#161616]"
            >
              <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-3 dark:border-white/8">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-gray-900 dark:text-white">{previewAd.name}</p>
                  <p className="truncate text-[11px] text-gray-400">ID: {previewAd.id}</p>
                </div>
                <button
                  onClick={() => setPreviewAd(null)}
                  className="shrink-0 rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-white/60 dark:hover:bg-white/10 dark:hover:text-white"
                >
                  <X size={16} />
                </button>
              </div>
              <div className="relative flex h-[55vh] w-full items-center justify-center bg-black">
                {previewAd.previewVideoUrl ? (
                  <video
                    controls
                    autoPlay
                    muted
                    playsInline
                    src={previewAd.previewVideoUrl}
                    poster={previewAd.thumbnailUrl || undefined}
                    className="h-full w-full object-contain"
                  />
                ) : previewAd.thumbnailUrl ? (
                  <img
                    src={previewAd.thumbnailUrl}
                    alt={previewAd.name}
                    className="h-full w-full object-contain"
                  />
                ) : (
                  <div className="flex flex-col items-center gap-2 text-white/40">
                    <ImageIcon className="h-6 w-6" />
                    <span className="text-xs">No preview available</span>
                  </div>
                )}
                {previewAd.mediaType === 'video' && !previewAd.previewVideoUrl && previewAd.thumbnailUrl && (
                  <p className="absolute inset-x-0 bottom-0 bg-black/70 px-3 py-2 text-center text-[11px] text-white/80">
                    Cover preview — TikTok didn't return a playable URL for this video
                  </p>
                )}
              </div>
              {(previewAd.raw?.ad_text || previewAd.raw?.call_to_action) && (
                <div className="px-4 py-3">
                  {previewAd.raw?.ad_text && (
                    <p className="text-xs leading-relaxed text-gray-600 dark:text-[#BEBEBE]">{previewAd.raw.ad_text}</p>
                  )}
                  {previewAd.raw?.call_to_action && (
                    <p className="mt-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-white/40">
                      CTA: {String(previewAd.raw.call_to_action).replace(/_/g, ' ')}
                    </p>
                  )}
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default TikTokAdsDashboard;
