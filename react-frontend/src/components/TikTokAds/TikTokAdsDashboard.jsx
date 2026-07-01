import React, { useEffect, useState } from 'react';
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
} from '@/apis/tikTokAds/tikTokAdsApi';
import toast from 'react-hot-toast';

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
  <div className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-gray-200 bg-white p-4 backdrop-blur-xl transition-all duration-300 hover:border-gray-300 hover:bg-gray-50 2xl:p-5 dark:border-white/8 dark:bg-[#161616] dark:hover:border-white/15 dark:hover:bg-white/3">
    {/* top row: icon left, label right */}
    <div className="flex items-start justify-between">
      <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-gray-200 bg-gray-100 dark:border-white/8 dark:bg-white/5">
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
  const map = {
    ACTIVE: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
    PAUSED: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300',
    DELETED: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  };
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
        map[status] || 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
      }`}
    >
      {status || '—'}
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
        isActive ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-white/15'
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
      className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-900 transition hover:bg-gray-50 dark:border-white/10 dark:bg-[#1c1c1c] dark:text-white dark:hover:bg-white/5"
    >
      {Icon && <Icon className={`h-3.5 w-3.5 ${iconClass}`} />}
      <span className="max-w-44 truncate">{label}</span>
      <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
    </button>
    {open && (
      <>
        <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
        <div className="absolute right-0 z-50 mt-1 max-h-72 min-w-52 overflow-auto rounded-xl border border-gray-200 bg-white p-1 shadow-xl dark:border-white/10 dark:bg-[#1c1c1c]">
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

  const [editWizard, setEditWizard] = useState({ open: false, mode: 'create', context: null });

  const tiktokComingSoon = import.meta.env.VITE_TIKTOK_COMING_SOON === 'false';

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
      setRows(mergeInsights(res.adGroups || [], insightsRows).filter((r) => r.status !== 'DELETED'));
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to load ad groups');
      setRows([]);
    } finally {
      setLoadingRows(false);
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
      setRows(mergeInsights(res.ads || [], insightsRows).filter((r) => r.status !== 'DELETED'));
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
      {/* Header — title left, account + date pickers top-right (Meta-style) */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200 bg-white dark:border-white/20">
            <FaTiktok className="h-5 w-5 text-black" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">TikTok Ads Manager</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">Manage · Analyse · Optimise</p>
          </div>
        </div>
        {accounts.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
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
          </div>
        )}
      </div>

      {accounts.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center dark:border-white/8 dark:bg-[#161616]">
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
            <div className="mb-5 flex flex-wrap items-center justify-between gap-5 border-b border-gray-100 px-1 py-3 dark:border-white/6">
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
                    {i > 0 && <div className="h-4 w-px bg-gray-200 dark:bg-gray-700" />}
                    <div className="flex items-center gap-2 text-sm">
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
          <div className="mb-5 flex items-center gap-1 border-b border-gray-100 dark:border-white/6">
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
                      ? 'border-gray-900 text-gray-900 dark:border-white/60 dark:text-white'
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
            <div className="mb-6 rounded-xl border border-gray-200 bg-white dark:border-white/8 dark:bg-[#161616]">
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
            <div className="mb-6 rounded-2xl border border-gray-200 bg-white p-4 dark:border-white/8 dark:bg-[#161616]">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-200">
                  <TrendingUp className="h-4 w-4" /> Performance over time
                </h2>
                <div className="flex items-center gap-1 rounded-lg border border-gray-200 p-1 dark:border-white/8">
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
          <div className="rounded-xl border border-gray-200 bg-white dark:border-white/8 dark:bg-[#161616]">
            {/* Breadcrumb + Create */}
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3 text-sm dark:border-white/8">
              <div className="flex items-center gap-1">
                <button
                  onClick={() => loadCampaigns(selectedAccount)}
                  className={`font-semibold ${
                    view === 'campaigns'
                      ? 'text-gray-900 dark:text-white'
                      : 'text-gray-500 hover:underline'
                  }`}
                >
                  Campaigns
                </button>
                {selectedCampaign && (
                  <>
                    <ChevronRight size={14} className="text-gray-400" />
                    <button
                      onClick={() => loadAdGroups(selectedCampaign)}
                      className={`font-semibold ${
                        view === 'adgroups'
                          ? 'text-gray-900 dark:text-white'
                          : 'text-gray-500 hover:underline'
                      }`}
                    >
                      {selectedCampaign.name}
                    </button>
                  </>
                )}
                {selectedAdGroup && (
                  <>
                    <ChevronRight size={14} className="text-gray-400" />
                    <span className="font-semibold text-gray-900 dark:text-white">
                      {selectedAdGroup.name}
                    </span>
                  </>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    if (!selectedAccount) return;
                    if (view === 'campaigns') loadCampaigns(selectedAccount);
                    else if (view === 'adgroups' && selectedCampaign) loadAdGroups(selectedCampaign);
                    else if (view === 'ads' && selectedAdGroup) loadAds(selectedAdGroup);
                  }}
                  disabled={loadingRows}
                  className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-900 transition hover:bg-gray-100 disabled:opacity-50 dark:border-white/8 dark:bg-[#1c1c1c] dark:text-white dark:hover:bg-white/5"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${loadingRows ? 'animate-spin' : ''}`} /> Refresh
                </button>
                <button
                  onClick={() => setShowWizard(true)}
                  className="flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-gray-900 transition hover:bg-gray-100"
                >
                  <Plus className="h-3.5 w-3.5" /> Create Campaign
                </button>
              </div>
            </div>

            {loadingRows ? (
              <Spinner label={`Loading ${view}...`} />
            ) : rows.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-gray-500">
                No {view} found.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-500 dark:bg-white/[0.03] dark:text-white/50">
                    <tr>
                      <th className="px-4 py-2.5 font-semibold">{view === 'campaigns' ? 'Campaign' : view === 'adgroups' ? 'Ad Group' : 'Ad'}</th>
                      <th className="px-4 py-2.5 font-semibold">Status</th>
                      {view === 'campaigns' && <th className="px-4 py-2.5 font-semibold">Objective</th>}
                      {(view === 'campaigns' || view === 'adgroups') && <th className="px-4 py-2.5 font-semibold">Budget</th>}
                      {view === 'campaigns' && <th className="px-4 py-2.5 font-semibold">Remaining</th>}
                      {view === 'campaigns' && <th className="px-4 py-2.5 font-semibold">Start Date</th>}
                      {view !== 'campaigns' && <th className="px-4 py-2.5 font-semibold">Spend</th>}
                      {view !== 'campaigns' && <th className="px-4 py-2.5 font-semibold">Impressions</th>}
                      {view !== 'campaigns' && <th className="px-4 py-2.5 font-semibold">Clicks</th>}
                      {view === 'ads' && <th className="px-4 py-2.5 font-semibold">CTR</th>}
                      <th className="px-4 py-2.5 text-right font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-white/8">
                    {rows.map((row) => (
                      <tr
                        key={row.id}
                        onClick={() => onRowClick(row)}
                        className={`${view !== 'ads' ? 'cursor-pointer hover:bg-gray-50 dark:hover:bg-white/[0.03]' : ''}`}
                      >
                        <td className="px-4 py-3">
                          <div className="min-w-0">
                            <p className="truncate font-medium">{row.name}</p>
                            <p className="truncate text-[11px] text-gray-400">ID: {row.id}</p>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <StatusBadge status={row.status} />
                            <ToggleSwitch status={row.status} onToggle={(e) => toggleStatus(e, row)} disabled={row.status === 'DELETED'} />
                          </div>
                        </td>
                        {view === 'campaigns' && (
                          <td className="px-4 py-3 text-gray-600 dark:text-white/70">{row.objective || '—'}</td>
                        )}
                        {(view === 'campaigns' || view === 'adgroups') && (
                          <td className="px-4 py-3 text-gray-600 dark:text-white/70">
                            {row.budgetMode === 'BUDGET_MODE_INFINITE'
                              ? 'Unlimited'
                              : `${fmtCurrency(row.budget, currency)}`}
                          </td>
                        )}
                        {view === 'campaigns' && (
                          <td className="px-4 py-3 text-gray-600 dark:text-white/70">
                            {typeof budgetRemaining(row) === 'number'
                              ? fmtCurrency(budgetRemaining(row), currency)
                              : budgetRemaining(row)}
                          </td>
                        )}
                        {view === 'campaigns' && (
                          <td className="px-4 py-3 text-gray-600 dark:text-white/70">{fmtDate(row.createTime)}</td>
                        )}
                        {view !== 'campaigns' && (
                          <td className="px-4 py-3 text-gray-600 dark:text-white/70">{fmtCurrency(row.spend, currency)}</td>
                        )}
                        {view !== 'campaigns' && (
                          <td className="px-4 py-3 text-gray-600 dark:text-white/70">{fmtNum(row.impressions)}</td>
                        )}
                        {view !== 'campaigns' && (
                          <td className="px-4 py-3 text-gray-600 dark:text-white/70">{fmtNum(row.clicks)}</td>
                        )}
                        {view === 'ads' && (
                          <td className="px-4 py-3 text-gray-600 dark:text-white/70">{fmtPct(row.ctr)}</td>
                        )}
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={(e) => handleEdit(e, row)}
                              title="Edit"
                              className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-white/60 dark:hover:bg-white/10 dark:hover:text-white"
                            >
                              <Pencil size={14} />
                            </button>
                            {view !== 'ads' && <ChevronRight size={16} className="text-gray-400" />}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          )}
        </>
      )}

      {/* ── create campaign wizard ── */}
      {showWizard && selectedAccount && (
        <CreateCampaignWizard
          advertiserId={selectedAccount.id}
          currency={currency}
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
          currency={currency}
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
              className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-6 shadow-2xl dark:border-white/8 dark:bg-[#161616]"
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
    </div>
  );
};

export default TikTokAdsDashboard;
