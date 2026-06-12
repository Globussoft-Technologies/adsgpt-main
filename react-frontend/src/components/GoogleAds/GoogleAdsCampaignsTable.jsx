import React, { useState, useEffect, useCallback } from 'react';
// eslint-disable-next-line no-unused-vars
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronRight,
  Target,
  Calendar,
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
  X,
  ExternalLink,
  Zap,
} from 'lucide-react';
import {
  getGoogleAdGroups,
  getGoogleAdGroupAds,
  resolveGoogleAdForEdit,
  updateGoogleAdStatus,
  deleteGoogleCampaign,
} from '@/apis/googleAds/googleAdsApi';
import { globalToast } from '@/utils/globalToast';
import { StatusBadge, Spinner, EmptyState } from '@/components/MetaAds/MetaAdsAtoms';
import {
  adCopyText,
  labelGoogleCTA,
  labelGoogleBidding,
  labelGoogleBilling,
  formatGoogleDateDisplay,
  hasBudget,
  parseBudgetINR,
} from '@/components/GoogleAds/googleAdsUtils';

// ─── helpers ──────────────────────────────────────────────────────────────────

const fromMicros = (n) => (n ? (Number(n) / 1_000_000).toFixed(2) : null);

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

function ToggleSwitch({ status, onToggle, toggling }) {
  const isActive = status === 'ENABLED';
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
      disabled={toggling}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors duration-200
        ${isActive ? 'bg-emerald-500' : 'bg-red-500'}
        ${toggling ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
    >
      <span
        className={`absolute top-1 left-1 h-3 w-3 rounded-full shadow transition-transform duration-200
          ${isActive ? 'translate-x-4 bg-white' : 'translate-x-0 bg-white'}`}
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
    const an = parseFloat(av);
    const bn = parseFloat(bv);
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
      className="flex items-center gap-1.5 rounded-xl bg-linear-to-r from-[#4285F4] to-[#34A853] px-3 py-1.5 text-[11px] font-bold text-white shadow-sm transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 2xl:text-xs"
    >
      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
      {label}
    </button>
  );
}

// ─── delete confirm modal ─────────────────────────────────────────────────────

function DeleteModal({ item, onConfirm, onCancel, deleting }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-100 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={() => !deleting && onCancel()}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 8 }}
        transition={{ duration: 0.18 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-6 shadow-2xl dark:border-white/8 dark:bg-[#161616]"
      >
        <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-red-50 dark:bg-red-500/10">
          <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
        </div>
        <h2 className="mb-1 text-sm font-bold text-gray-900 dark:text-white">Delete this campaign?</h2>
        <p className="mb-2 text-xs text-gray-500 dark:text-[#BEBEBE]">
          <span className="font-semibold text-gray-900 dark:text-white">{item.name}</span> will be permanently
          removed from Google Ads along with its ad groups and ads. This cannot be undone.
        </p>
        <p className="mb-6 font-mono text-[11px] text-gray-400 dark:text-white/40">ID: {item.campaignId || item.id}</p>
        <div className="flex items-center justify-end gap-2">
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
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── campaign table (level 1) ─────────────────────────────────────────────────

function CampaignTable({ campaigns, loading, adAccountId, onDrillDown, onRefresh, onLaunchWizard }) {
  const [statuses, setStatuses]       = useState({});
  const [toggling, setToggling]       = useState({});
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting]       = useState(false);
  const { sorted, sortKey, sortDir, toggleSort } = useSortedRows(campaigns, 'name');

  const getStatus = (c) => statuses[c.campaignId || c.id] ?? c.status;

  const handleToggle = async (e, c) => {
    e.stopPropagation();
    const id = c.campaignId || c.id;
    const next = getStatus(c) === 'ENABLED' ? 'PAUSED' : 'ENABLED';
    setToggling((p) => ({ ...p, [id]: true }));
    try {
      await updateGoogleAdStatus({ level: 'campaign', id, adAccountId, status: next });
      setStatuses((p) => ({ ...p, [id]: next }));
      globalToast.success('Campaign status updated');
    } catch { globalToast.error('Failed to update campaign status'); }
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
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-white/10 dark:bg-[#141414]">
      <div className="scrollbar-thin flex-1 overflow-auto">
        <table className="w-full min-w-190 border-collapse">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 dark:border-white/12 dark:bg-[#181818]">
              <SortTh label="Campaign"       colKey="name"              sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="w-[34%] pl-5" />
              <SortTh label="Status"         colKey="status"            sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              <SortTh label="Objective"      colKey="objective"         sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              <SortTh label="Daily Budget"     colKey="dailyBudgetMicros" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              <SortTh label="Budget Remaining" colKey="budget_remaining" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              <SortTh label="Start Date"       colKey="start_time"       sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              <th className="w-20 pr-5 pl-2 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-white/70">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={7} className="py-14"><Spinner /></td></tr>
            )}
            {!loading && sorted.length === 0 && (
              <tr><td colSpan={7} className="py-14"><EmptyState message="No campaigns found for this account" /></td></tr>
            )}
            {!loading && sorted.map((c, idx) => {
              const id     = c.campaignId || c.id;
              const status = getStatus(c);
              const budget = fromMicros(c.dailyBudgetMicros);
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
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-0.5 shrink-0 rounded-full bg-gray-300 dark:bg-white/20" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-gray-900 dark:text-white leading-tight">{c.name}</p>
                        <p className="mt-0.5 font-mono text-[11px] text-gray-400 dark:text-white/40">ID: {id}</p>
                        {budget && <BudgetBar budget={budget ? `₹${budget}` : null} remaining={remaining} />}
                      </div>
                    </div>
                  </td>
                  {/* status */}
                  <td className="px-4 py-4">
                    <div className="flex items-center gap-2.5">
                      <StatusBadge status={status === 'ENABLED' ? 'ACTIVE' : 'PAUSED'} />
                      <ToggleSwitch status={status} onToggle={(e) => handleToggle(e, c)} toggling={!!toggling[id]} />
                    </div>
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
                  <td className="px-4 py-4">
                    <span className="flex items-center gap-1.5 text-sm text-gray-600 dark:text-white/80">
                      <Calendar className="h-3.5 w-3.5 shrink-0 text-gray-400 dark:text-white/30" />
                      {formatGoogleDateDisplay(c.start_time || c.startDate)}
                    </span>
                  </td>
                  {/* actions */}
                  <td className="pr-5 pl-2 py-4">
                    <div className="flex items-center justify-end gap-1.5">
                      {onLaunchWizard && (
                        <button
                          onClick={(e) => { e.stopPropagation(); onLaunchWizard('edit-campaign', { campaignId: id, objective: c.objective, destination: c.channelType || c.objective, campaignName: c.name, dailyBudget: budget || '', status: c.status }); }}
                          title="Edit campaign"
                          className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-gray-100 text-gray-400 transition-all hover:border-gray-300 hover:bg-gray-200 hover:text-gray-900 dark:border-white/8 dark:bg-white/2 dark:text-white/40 dark:hover:border-white/20 dark:hover:bg-white/8 dark:hover:text-white"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); setPendingDelete(c); }}
                        title="Delete campaign"
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-gray-100 text-gray-400 transition-all hover:border-red-500/40 hover:bg-red-50 hover:text-red-600 dark:border-white/8 dark:bg-white/2 dark:text-white/40 dark:hover:border-red-500/40 dark:hover:bg-red-500/10 dark:hover:text-red-400"
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
  const [adGroups,  setAdGroups]  = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [statuses,  setStatuses]  = useState({});
  const [toggling,  setToggling]  = useState({});
  const { sorted, sortKey, sortDir, toggleSort } = useSortedRows(adGroups, 'name');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getGoogleAdGroups({ adAccountId, campaignId: campaign.campaignId || campaign.id, refresh: true })
      .then((r) => { if (!cancelled) setAdGroups(r.adGroups || []); })
      .catch((e) => {
        if (!cancelled) {
          setAdGroups([]);
          globalToast.error(e?.response?.data?.error || e?.response?.data?.details || 'Failed to load ad groups');
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [campaign.campaignId, campaign.id, adAccountId, manageNonce]);

  const getStatus = (g) => statuses[g.adGroupId || g.id] ?? g.status;

  const handleToggle = async (e, g) => {
    e.stopPropagation();
    const id = g.adGroupId || g.id;
    const next = getStatus(g) === 'ENABLED' ? 'PAUSED' : 'ENABLED';
    setToggling((p) => ({ ...p, [id]: true }));
    try {
      await updateGoogleAdStatus({ level: 'adgroup', id, adAccountId, status: next });
      setStatuses((p) => ({ ...p, [id]: next }));
      globalToast.success('Ad group status updated');
    } catch { globalToast.error('Failed to update ad group status'); }
    finally  { setToggling((p) => ({ ...p, [id]: false })); }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-white/10 dark:bg-[#141414]">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-gray-200 bg-gray-50 px-4 py-2.5 dark:border-white/10 dark:bg-[#181818]">
        <p className="truncate text-xs font-semibold text-gray-500 dark:text-white/70">
          Ad groups in <span className="text-gray-900 dark:text-white">{campaign.name}</span>
        </p>
        {onLaunchWizard && (
          <AddButton
            label="Add Ad Group"
            onClick={() => onLaunchWizard('create-adgroup', { campaignId: campaign.campaignId || campaign.id, objective: campaign.objective, destination: campaign.channelType || campaign.objective })}
          />
        )}
      </div>
      <div className="scrollbar-thin flex-1 overflow-auto">
        <table className="w-full min-w-150 border-collapse">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 dark:border-white/12 dark:bg-[#181818]">
              <SortTh label="Ad Group"          colKey="name"               sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="w-[30%] pl-5" />
              <SortTh label="Status"            colKey="status"             sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              <SortTh label="Billing Event"     colKey="billing_event"      sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              <SortTh label="Optimization Goal" colKey="optimization_goal"  sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              <SortTh label="Max CPC"           colKey="cpcBidMicros"       sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              <SortTh label="Start Date"        colKey="start_time"         sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              {onLaunchWizard && <th className="w-14 pr-5 pl-2 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-white/70">Edit</th>}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={onLaunchWizard ? 7 : 6} className="py-14"><Spinner /></td></tr>
            )}
            {!loading && sorted.length === 0 && (
              <tr><td colSpan={onLaunchWizard ? 7 : 6} className="py-14"><EmptyState message="No ad groups in this campaign" /></td></tr>
            )}
            {sorted.map((g, idx) => {
              const id     = g.adGroupId || g.id;
              const status = getStatus(g);
              const cpc    = fromMicros(g.cpcBidMicros);
              const startDate = g.start_time || g.startDate || campaign.start_time || campaign.startDate;
              return (
                <motion.tr
                  key={id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: idx * 0.03 }}
                  onClick={() => onDrillDown(g)}
                  className="group cursor-pointer border-b border-gray-200 transition-colors hover:bg-gray-100 dark:border-white/10 dark:hover:bg-white/3 last:border-b-0"
                >
                  <td className="pl-5 pr-4 py-4">
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-0.5 shrink-0 rounded-full bg-gray-300 dark:bg-white/20" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-gray-900 dark:text-white">{g.name}</p>
                        <p className="mt-0.5 font-mono text-[11px] text-gray-400 dark:text-white/40">ID: {id}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex items-center gap-2.5">
                      <StatusBadge status={status === 'ENABLED' ? 'ACTIVE' : 'PAUSED'} />
                      <ToggleSwitch status={status} onToggle={(e) => handleToggle(e, g)} toggling={!!toggling[id]} />
                    </div>
                  </td>
                  <td className="px-4 py-4 text-sm text-gray-600 dark:text-white/80">
                    <span className="flex items-center gap-1.5">
                      <Zap className="h-3.5 w-3.5 shrink-0 text-gray-400 dark:text-white/30" />
                      {labelGoogleBilling(g.billing_event || g.billingEvent) ?? '—'}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-sm text-gray-600 dark:text-white/80">
                    {labelGoogleBidding(g.optimization_goal || g.optimizationGoal) ?? '—'}
                  </td>
                  <td className="px-4 py-4 text-sm font-medium text-gray-600 dark:text-white/80">
                    {cpc ? (
                      <span className="flex items-center gap-1.5">
                        <DollarSign className="h-3.5 w-3.5 shrink-0 text-gray-400 dark:text-white/30" />
                        ₹{cpc}
                      </span>
                    ) : <span className="text-gray-400 dark:text-white/40">—</span>}
                  </td>
                  <td className="px-4 py-4 text-sm text-gray-600 dark:text-white/80">
                    <span className="flex items-center gap-1.5">
                      <Calendar className="h-3.5 w-3.5 shrink-0 text-gray-400 dark:text-white/30" />
                      {formatGoogleDateDisplay(startDate)}
                    </span>
                  </td>
                  {onLaunchWizard && (
                    <td className="pr-5 pl-2 py-4">
                      <div className="flex items-center justify-end">
                        <button
                          onClick={(e) => { e.stopPropagation(); onLaunchWizard('edit-adgroup', { campaignId: campaign.campaignId || campaign.id, adGroupId: id, adGroupName: g.name, cpcBid: cpc || '', status: g.status, objective: campaign.objective, destination: campaign.channelType || campaign.objective }); }}
                          title="Edit ad group"
                          className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-gray-100 text-gray-400 transition-all hover:border-gray-300 hover:bg-gray-200 hover:text-gray-900 dark:border-white/8 dark:bg-white/2 dark:text-white/40 dark:hover:border-white/20 dark:hover:bg-white/8 dark:hover:text-white"
                        >
                          <Pencil className="h-3.5 w-3.5" />
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
  );
}

// ─── ad preview drawer ────────────────────────────────────────────────────────

function GoogleAdDrawer({ ad, adAccountId, onClose }) {
  const [currentStatus, setCurrentStatus] = useState(ad.status);
  const [toggling, setToggling] = useState(false);
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
      await updateGoogleAdStatus({ level: 'ad', id, adAccountId, status: next });
      setCurrentStatus(next);
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
      className="flex w-90 shrink-0 flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-white/10 dark:bg-[#181818]"
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
          <div className="flex items-center gap-2.5 border-b border-gray-200 px-4 py-2.5 dark:border-white/5">
            <div className="h-7 w-7 rounded-full bg-gray-200 dark:bg-white/10" />
            <div>
              <p className="text-xs font-semibold text-gray-900 dark:text-white">Sponsored</p>
              <p className="text-10 text-gray-400 dark:text-[#444]">Google · Display</p>
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
              <StatusBadge status={currentStatus === 'ENABLED' ? 'ACTIVE' : 'PAUSED'} />
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

// ─── ads table (level 3) ──────────────────────────────────────────────────────

function AdsTable({ adGroup, campaign, adAccountId, onLaunchWizard, manageNonce }) {
  const [ads,     setAds]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [statuses, setStatuses] = useState({});
  const [toggling, setToggling] = useState({});
  const [selectedAd, setSelectedAd] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const { sorted, sortKey, sortDir, toggleSort } = useSortedRows(ads, 'headline');

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
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [adGroup.adGroupId, adGroup.id, adAccountId, manageNonce]);

  const getStatus = (a) => statuses[a.adId || a.id] ?? a.status;

  const handleToggle = async (e, a) => {
    e.stopPropagation();
    const id = a.adId || a.id;
    const next = getStatus(a) === 'ENABLED' ? 'PAUSED' : 'ENABLED';
    setToggling((p) => ({ ...p, [id]: true }));
    try {
      await updateGoogleAdStatus({ level: 'ad', id, adAccountId, status: next });
      setStatuses((p) => ({ ...p, [id]: next }));
      globalToast.success('Ad status updated');
    } catch { globalToast.error('Failed to update ad status'); }
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

  return (
    <div className="flex min-h-0 flex-1 gap-3">
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-white/10 dark:bg-[#141414]">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-gray-200 bg-gray-50 px-4 py-2.5 dark:border-white/10 dark:bg-[#181818]">
        <p className="truncate text-xs font-semibold text-gray-500 dark:text-white/70">
          Ads in <span className="text-gray-900 dark:text-white">{adGroup.name}</span>
        </p>
        {onLaunchWizard && (
          <AddButton
            label="Add Ad"
            onClick={() => onLaunchWizard('create-ad', { campaignId: campaign.campaignId || campaign.id, adGroupId: adGroup.adGroupId || adGroup.id, objective: campaign.objective })}
          />
        )}
      </div>
      <div className="scrollbar-thin flex-1 overflow-auto">
        <table className="w-full min-w-140 border-collapse">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 dark:border-white/12 dark:bg-[#181818]">
              <th className="w-16 py-3 pl-5 pr-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-white/70">Preview</th>
              <SortTh label="Ad Name"    colKey="headline"    sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="w-[36%]" />
              <SortTh label="Status"     colKey="status"      sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              <SortTh label="Final URL"  colKey="finalUrl"    sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              <SortTh label="CTA"        colKey="callToAction" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              {onLaunchWizard && <th className="w-14 pr-5 pl-2 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-white/70">Edit</th>}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={onLaunchWizard ? 5 : 4} className="py-14"><Spinner /></td></tr>
            )}
            {!loading && sorted.length === 0 && (
              <tr><td colSpan={onLaunchWizard ? 5 : 4} className="py-14"><EmptyState message="No ads in this ad group" /></td></tr>
            )}
            {sorted.map((a, idx) => {
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
                      {a.imageUrl ? (
                        <>
                          <img src={a.imageUrl} alt={a.headline || 'Ad'} className="h-full w-full object-cover" />
                          {a.videoUrl && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                              <Play className="h-4 w-4 fill-white text-white" />
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="flex h-full w-full items-center justify-center">
                          <ImageIcon className="h-4 w-4 text-gray-400 dark:text-white/20" />
                        </div>
                      )}
                    </div>
                  </td>
                  {/* ad name */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="h-6 w-0.5 shrink-0 rounded-full bg-gray-300 dark:bg-white/15" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-gray-900 dark:text-white">
                          {adCopyText(a.headline) || adCopyText(a.headlines?.[0]) || `Ad ${id}`}
                        </p>
                        {adCopyText(a.descriptions?.[0]) && (
                          <p className="truncate text-xs text-gray-400 dark:text-white/40">{adCopyText(a.descriptions[0])}</p>
                        )}
                      </div>
                    </div>
                  </td>
                  {/* status */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <StatusBadge status={status === 'ENABLED' ? 'ACTIVE' : 'PAUSED'} />
                      <ToggleSwitch status={status} onToggle={(e) => handleToggle(e, a)} toggling={!!toggling[id]} />
                    </div>
                  </td>
                  {/* final url */}
                  <td className="px-4 py-3 text-sm text-gray-600 dark:text-white/80">
                    {a.finalUrl ? (
                      <span className="max-w-45 truncate block text-xs text-gray-500 dark:text-white/50">{a.finalUrl}</span>
                    ) : <span className="text-gray-400 dark:text-white/40">—</span>}
                  </td>
                  {/* cta */}
                  <td className="px-4 py-3 text-sm text-gray-600 dark:text-white/80">
                    {labelGoogleCTA(a.callToAction) ?? '—'}
                  </td>
                  {/* edit */}
                  {onLaunchWizard && (
                    <td className="pr-5 pl-2 py-3">
                      <div className="flex items-center justify-end">
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
        />
      )}
    </AnimatePresence>
    </div>
  );
}

// ─── root export ──────────────────────────────────────────────────────────────

export default function GoogleAdsCampaignsTable({ campaigns, loading, adAccountId, onRefresh, onLaunchWizard, manageNonce }) {
  const [level,            setLevel]            = useState('campaigns');
  const [selectedCampaign, setSelectedCampaign] = useState(null);
  const [selectedAdGroup,  setSelectedAdGroup]  = useState(null);

  const drillToCampaign = (c) => { setSelectedCampaign(c); setSelectedAdGroup(null); setLevel('adgroups'); };
  const drillToAdGroup  = (g) => { setSelectedAdGroup(g);                             setLevel('ads'); };
  const goToCampaigns   = ()  => { setLevel('campaigns'); setSelectedCampaign(null); setSelectedAdGroup(null); };
  const goToAdGroups    = ()  => { setLevel('adgroups');                              setSelectedAdGroup(null); };

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
                campaigns={campaigns}
                loading={loading}
                adAccountId={adAccountId}
                onDrillDown={drillToCampaign}
                onRefresh={onRefresh}
                onLaunchWizard={onLaunchWizard}
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
