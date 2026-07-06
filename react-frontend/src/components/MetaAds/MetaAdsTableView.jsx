import React, { useState, useEffect } from 'react';
// eslint-disable-next-line no-unused-vars
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronRight,
  Target,
  Calendar,
  Activity,
  Play,
  Image as ImageIcon,
  ExternalLink,
  X,
  ArrowUpDown,
  Trash2,
  Loader2,
  AlertTriangle,
  Plus,
  Pencil,
} from 'lucide-react';
import {
  getAdSets,
  getAdSetAds,
  updateAdStatus,
  deleteMetaCampaign,
  resolveCellForAdSet,
  resolveCampaignForAdd,
  resolveAdSetForEdit,
  resolveAdForEdit,
  getAdPreviewMedia,
} from '@/apis/metaAds/metaAdsApi';
import { globalToast } from '@/utils/globalToast';
import { StatusBadge, Spinner, EmptyState } from './MetaAdsAtoms';
import {
  labelObjective,
  labelBillingEvent,
  labelOptimizationGoal,
  labelBidType,
  labelCTA,
} from './metaAdsUtils';

// ─── helpers ──────────────────────────────────────────────────────────────────

// Objectives migrated to the V2 cell engine. Add Ad Set / Add Ad are only
// offered for these. V2 now covers all 6 ODAX objectives; this set is the
// guardrail in case anyone re-introduces a V1-only objective. Mirrors
// SUPPORTED_OBJECTIVES in nodejs-backend/controllers/adPosting/cellInference.js.
const V2_SUPPORTED_OBJECTIVES = new Set([
  'OUTCOME_TRAFFIC',
  'OUTCOME_LEADS',
  'OUTCOME_APP_PROMOTION',
  'OUTCOME_ENGAGEMENT',
  'OUTCOME_SALES',
  'OUTCOME_AWARENESS',
]);

// Small toolbar button used above the Ad Set / Ads tables to launch the
// add-to-existing wizard flows.
function AddButton({ label, onClick, busy = false, disabled = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy || disabled}
      className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-[#02C8C4] to-[#5867EB] px-3 py-1.5 text-[11px] font-bold text-white shadow-sm transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 2xl:text-xs"
    >
      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
      {label}
    </button>
  );
}

function parseBudget(v) {
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

// "0" / "" / null all mean "no budget set at this level". Meta returns
// `daily_budget: 0` (or omits the field) for non-CBO campaigns and for ad sets
// inside a CBO campaign — i.e. the budget literally lives one level away.
//
// The backend pre-formats budgets as currency strings ("₹100.00", "₹0.00")
// via Intl.NumberFormat — parseFloat chokes on the leading symbol and returns
// NaN, so we strip everything except digits / dot / minus before parsing.
const hasBudget = (v) => {
  if (v == null || v === '') return false;
  const numeric = String(v).replace(/[^\d.-]/g, '');
  const n = parseFloat(numeric);
  return !isNaN(n) && n > 0;
};

function BudgetBar({ budget, remaining }) {
  const b = parseBudget(budget);
  const r = parseBudget(remaining);
  if (b == null || r == null) return null;
  const pct = Math.min(100, Math.max(0, ((b - r) / b) * 100));
  return (
    <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-white/[0.08]">
      <div
        className="h-full rounded-full bg-gray-400 dark:bg-white/40 transition-all duration-500"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function ToggleSwitch({ status, onToggle, toggling }) {
  const isActive = status === 'ACTIVE';
  return (
    <button
      onClick={onToggle}
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

function Breadcrumb({ level, campaign, adSet, onClickCampaigns, onClickCampaign }) {
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
            className={`max-w-[220px] truncate font-semibold transition-colors
              ${level === 'adsets' ? 'text-gray-900 dark:text-white' : 'text-gray-400 hover:text-gray-600 dark:text-white/35 dark:hover:text-white/70'}`}
          >
            {campaign.name}
          </button>
        </>
      )}
      {adSet && (
        <>
          <ChevronRight className="h-3.5 w-3.5 text-gray-300 dark:text-white/15" />
          <span className="max-w-[220px] truncate font-semibold text-gray-900 dark:text-white">{adSet.name}</span>
        </>
      )}
    </div>
  );
}

// ─── level pills ──────────────────────────────────────────────────────────────

function LevelPills({ level, campaign, adSet }) {
  const levels = [
    { key: 'campaigns', label: 'Campaigns', enabled: true },
    { key: 'adsets',    label: 'Ad Sets',   enabled: !!campaign },
    { key: 'ads',       label: 'Ads',       enabled: !!adSet },
  ];
  return (
    <div className="flex items-center gap-1.5">
      {levels.map(({ key, label, enabled }, i) => {
        const active = level === key;
        return (
          <React.Fragment key={key}>
            {i > 0 && <ChevronRight className="h-3 w-3 text-gray-300 dark:text-white/15" />}
            <span
              className={`rounded-full border px-3 py-1 text-xs font-semibold transition-all
                ${active
                  ? 'border-gray-300 bg-gray-100 text-gray-900 dark:border-white/20 dark:bg-white/8 dark:text-white'
                  : enabled
                  ? 'border-gray-200 text-gray-400 dark:border-white/12 dark:text-white/30'
                  : 'border-gray-200 text-gray-300 dark:border-white/4 dark:text-white/15'}`}
            >
              {label}
            </span>
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ─── table shell ──────────────────────────────────────────────────────────────

function TableShell({ toolbar, children, colSpan, loading, emptyMsg }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-white/[0.10] dark:bg-[#141414]">
      {toolbar}
      <div className="scrollbar-thin overflow-x-auto">
        <table className="w-full border-collapse">
          <tbody>
            {loading && (
              <tr><td colSpan={colSpan} className="py-14"><Spinner /></td></tr>
            )}
            {!loading && children === null && (
              <tr><td colSpan={colSpan} className="py-14"><EmptyState message={emptyMsg} /></td></tr>
            )}
          </tbody>
        </table>
        {!loading && children}
      </div>
    </div>
  );
}

// ─── campaign table ───────────────────────────────────────────────────────────

function CampaignTable({ campaigns, loading, adAccountId, onDrillDown, onRefresh, onLaunchWizard }) {
  const [statuses, setStatuses]   = useState({});
  const [toggling, setToggling]   = useState({});
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const { sorted, sortKey, sortDir, toggleSort } = useSortedRows(campaigns, 'name');

  // Edit — read FRESH campaign settings (the list is cached + budgets are
  // formatted strings, useless for editing) then open the wizard prefilled.
  const handleEdit = async (e, c) => {
    e.stopPropagation();
    setEditingId(c.id);
    try {
      const r = await resolveCampaignForAdd({ campaignId: c.id });
      const cbo = !!r.cbo;
      const minor = r.campaignBudgetType === 'lifetime' ? r.lifetimeBudget : r.dailyBudget;
      onLaunchWizard?.('edit-campaign', {
        campaignId: c.id,
        objective: r.objective || c.objective,
        cbo,
        campaignBudgetType: r.campaignBudgetType || 'daily',
        campaignName: r.name || c.name,
        // minor → major for the inputs.
        campaignBudget: cbo && minor ? String(minor / 100) : '',
        spendCap: r.spendCap ? String(r.spendCap / 100) : '',
        parentLabel: r.name || c.name,
      });
    } catch (err) {
      globalToast.error(
        err?.response?.data?.error || "Couldn't open the campaign editor.",
      );
    } finally {
      setEditingId(null);
    }
  };

  const getStatus = (c) => statuses[c.id] ?? c.status;

  const handleToggle = async (e, c) => {
    e.stopPropagation();
    const next = getStatus(c) === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
    setToggling((p) => ({ ...p, [c.id]: true }));
    try {
      const res = await updateAdStatus('campaign', c.id, next);
      setStatuses((p) => ({ ...p, [c.id]: next }));
      globalToast.success(res?.message);
    } catch { globalToast.error('Failed to update campaign status'); }
    finally  { setToggling((p) => ({ ...p, [c.id]: false })); }
  };

  const handleConfirmDelete = async () => {
    if (!pendingDelete || !adAccountId) return;
    setDeleting(true);
    try {
      const res = await deleteMetaCampaign({
        adAccountId,
        campaignId: pendingDelete.id,
      });
      globalToast.success(res?.message || 'Campaign deleted');
      setPendingDelete(null);
      onRefresh?.();
    } catch (err) {
      globalToast.error(
        err?.response?.data?.error || 'Failed to delete campaign',
      );
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-white/10 dark:bg-[#141414]">

      <div className="scrollbar-thin flex-1 overflow-auto">
        <table className="w-full min-w-[700px] border-collapse">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 dark:border-white/12 dark:bg-[#181818]">
              <SortTh label="Campaign"         colKey="name"             sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="w-[36%] pl-5" />
              <SortTh label="Status"           colKey="status"           sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              <SortTh label="Objective"        colKey="objective"        sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              <SortTh label="Daily Budget"     colKey="daily_budget"     sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              <SortTh label="Budget Remaining" colKey="budget_remaining" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              <SortTh label="Start Date"       colKey="start_time"       sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              <th className="w-16 pr-5 pl-2 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-white/70">Actions</th>
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
              const status  = getStatus(c);
              const budget  = parseBudget(c.daily_budget);
              const remaining = parseBudget(c.budget_remaining);
              return (
                <motion.tr
                  key={c.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: idx * 0.03 }}
                  onClick={() => onDrillDown(c)}
                  className="group cursor-pointer border-b border-gray-200 transition-colors hover:bg-gray-100 dark:border-white/10 dark:hover:bg-white/3 last:border-b-0"
                >
                  {/* campaign name */}
                  <td className="pl-5 pr-4 py-4">
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-0.5 shrink-0 rounded-full bg-gray-300 dark:bg-white/20" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-gray-900 dark:text-white leading-tight">{c.name}</p>
                        <p className="mt-0.5 font-mono text-[11px] text-gray-400 dark:text-white/40">ID: {c.id}</p>
                        {budget != null && <BudgetBar budget={budget} remaining={remaining} />}
                      </div>
                    </div>
                  </td>
                  {/* status */}
                  <td className="px-4 py-4">
                    <div className="flex items-center gap-2.5">
                      <StatusBadge status={status} />
                      <ToggleSwitch status={status} onToggle={(e) => handleToggle(e, c)} toggling={!!toggling[c.id]} />
                    </div>
                  </td>
                  {/* objective */}
                  <td className="px-4 py-4">
                    <span className="flex items-center gap-1.5 text-sm text-gray-600 dark:text-white/80">
                      <Target className="h-3.5 w-3.5 shrink-0 text-gray-400 dark:text-white/30" />
                      {labelObjective(c.objective) ?? '—'}
                    </span>
                  </td>
                  {/* budget — CBO campaigns set this on the campaign (daily
                      or lifetime); non-CBO campaigns push it down to adsets. */}
                  <td className="px-4 py-4 text-sm font-medium text-gray-600 dark:text-white/80">
                    {hasBudget(c.daily_budget)
                      ? c.daily_budget
                      : hasBudget(c.lifetime_budget)
                        ? <span>{c.lifetime_budget} <span className="text-gray-400 dark:text-white/40">lifetime</span></span>
                        : <span className="text-gray-400 dark:text-white/40">Set on ad set</span>}
                  </td>
                  {/* remaining */}
                  <td className="px-4 py-4 text-sm text-gray-600 dark:text-white/80">
                    {hasBudget(c.budget_remaining)
                      ? c.budget_remaining
                      : <span className="text-gray-400 dark:text-white/40">—</span>}
                  </td>
                  {/* date + analytics drill */}
                  <td className="px-4 py-4">
                    <span className="flex items-center gap-1.5 text-sm text-gray-600 dark:text-white/80">
                      <Calendar className="h-3.5 w-3.5 shrink-0 text-gray-400 dark:text-white/30" />
                      {c.start_time ? new Date(c.start_time).toLocaleDateString() : '—'}
                    </span>
                  </td>
                  {/* actions */}
                  <td className="pr-5 pl-2 py-4">
                    <div className="flex items-center justify-end gap-1.5">
                      {V2_SUPPORTED_OBJECTIVES.has(c.objective) && onLaunchWizard && (
                        <button
                          onClick={(e) => handleEdit(e, c)}
                          disabled={editingId === c.id}
                          title="Edit campaign"
                          className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-gray-100 text-gray-400 transition-all hover:border-gray-300 hover:bg-gray-200 hover:text-gray-900 dark:border-white/8 dark:bg-white/2 dark:text-white/40 dark:hover:border-white/20 dark:hover:bg-white/8 dark:hover:text-white disabled:opacity-50"
                        >
                          {editingId === c.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Pencil className="h-3.5 w-3.5" />
                          )}
                        </button>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setPendingDelete(c);
                        }}
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

      {/* delete confirmation modal */}
      <AnimatePresence>
        {pendingDelete && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-100 flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={() => !deleting && setPendingDelete(null)}
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
                <span className="font-semibold text-gray-900 dark:text-white">{pendingDelete.name}</span> will be permanently
                removed from Meta along with its ad sets and ads. This cannot be undone.
              </p>
              <p className="mb-6 font-mono text-[11px] text-gray-400 dark:text-white/40">ID: {pendingDelete.id}</p>
              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={() => setPendingDelete(null)}
                  disabled={deleting}
                  className="rounded-xl border border-gray-200 bg-gray-100 px-4 py-2 text-xs font-medium text-gray-900 transition-all hover:bg-gray-200 dark:border-white/8 dark:bg-white/5 dark:text-white dark:hover:bg-white/10 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmDelete}
                  disabled={deleting}
                  className="flex items-center gap-1.5 rounded-xl bg-red-500/80 px-4 py-2 text-xs font-bold text-white transition-all hover:bg-red-500 disabled:opacity-50"
                >
                  {deleting && <Loader2 className="h-3 w-3 animate-spin" />}
                  {deleting ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── ad-set table ─────────────────────────────────────────────────────────────

function AdSetTable({ campaign, adAccountId, onDrillDown, onLaunchWizard, manageNonce }) {
  const [adSets,  setAdSets]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [statuses, setStatuses] = useState({});
  const [toggling, setToggling] = useState({});
  const [resolvingAdd, setResolvingAdd] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const { sorted, sortKey, sortDir, toggleSort } = useSortedRows(adSets, 'name');
  // CBO campaigns own the budget — adsets show 0/empty daily_budget. We
  // surface this explicitly instead of rendering a confusing "₹0.00".
  const cboParent = hasBudget(campaign?.daily_budget) || hasBudget(campaign?.lifetime_budget);
  // Add Ad Set / Edit are only offered for V2-migrated objectives AND when
  // the V2 wizard is enabled (the buttons open it with mode/context — the
  // V1 wizard doesn't understand those, so showing the buttons without the
  // V2 wizard mounted would be a broken click).
  const canAdd = V2_SUPPORTED_OBJECTIVES.has(campaign?.objective) && !!onLaunchWizard;

  // Refetch on mount + whenever the parent signals an add (manageNonce).
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getAdSets(campaign.id, adAccountId)
      .then((r) => { if (!cancelled) setAdSets(r.adSets || []); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [campaign.id, adAccountId, manageNonce]);

  // Read FRESH campaign settings before opening the wizard — the campaign
  // list is cached, so its bid_strategy can be stale/missing. The wizard
  // needs the live bid strategy to render a bid-cap field for capped CBO
  // campaigns (and inherit special categories). Falls back to the cached
  // row if the read fails.
  const handleAddAdSet = async () => {
    setResolvingAdd(true);
    let ctx = {
      campaignId: campaign.id,
      objective: campaign.objective,
      cbo: cboParent,
      campaignBudgetType: hasBudget(campaign?.daily_budget) ? 'daily' : 'lifetime',
      bidStrategy: campaign.bid_strategy || undefined,
      specialAdCategories: campaign.special_ad_categories || [],
      parentLabel: campaign.name,
    };
    try {
      const r = await resolveCampaignForAdd({ campaignId: campaign.id });
      ctx = {
        campaignId: campaign.id,
        objective: r.objective || campaign.objective,
        cbo: !!r.cbo,
        campaignBudgetType: r.campaignBudgetType || ctx.campaignBudgetType,
        bidStrategy: r.bidStrategy || undefined,
        specialAdCategories: r.specialAdCategories || [],
        // Subcode 1885760 fix — locks the new ad set's Performance goal to
        // match the campaign's existing ad set(s) (Meta requires this
        // under "lowest cost" bidding). null when the campaign has no ad
        // sets yet.
        existingOptimizationGoal: r.existingOptimizationGoal || null,
        parentLabel: campaign.name,
      };
    } catch {
      /* fall back to cached-row context */
    } finally {
      setResolvingAdd(false);
    }
    onLaunchWizard?.('create-adset', ctx);
  };

  // Edit — read the FULL ad set fresh (reverse-mapped targeting + resolved
  // geo names), then open the wizard prefilled. Budgets/bid → major units.
  const handleEditAdSet = async (e, s) => {
    e.stopPropagation();
    setEditingId(s.id);
    try {
      const r = await resolveAdSetForEdit({ adSetId: s.id });
      const lifetime = Number(r.lifetimeBudget) > 0;
      onLaunchWizard?.('edit-adset', {
        adSetId: s.id,
        campaignId: r.campaignId,
        objective: r.objective,
        conversionLocation: r.conversionLocation,
        cbo: !!r.cbo,
        pageId: r.pageId || '',
        parentLabel: r.name || s.name,
        formOverrides: {
          adSetName: r.name || s.name,
          optimizationGoal: r.optimizationGoal,
          billingEvent: r.billingEvent,
          bidStrategy: r.bidStrategy || 'LOWEST_COST_WITHOUT_CAP',
          bidAmount: r.bidAmount ? String(r.bidAmount / 100) : '',
          adSetBudgetType: lifetime ? 'lifetime' : 'daily',
          adSetBudget: !r.cbo
            ? String(((lifetime ? r.lifetimeBudget : r.dailyBudget) || 0) / 100)
            : '',
          startTime: r.startTime || '',
          endTime: r.endTime || '',
          hasEndTime: !!r.endTime,
          worldwide: !!r.targeting?.worldwide,
          locations: r.targeting?.locations || [],
          ageMin: r.targeting?.ageMin ?? 18,
          ageMax: r.targeting?.ageMax ?? 65,
          genders: r.targeting?.genders || [],
          locales: r.targeting?.locales || [],
          advantageAudience: !!r.targeting?.advantageAudience,
          placementMode: r.targeting?.placementMode || 'advantage_plus',
          publisherPlatforms: r.targeting?.publisherPlatforms || [],
          devicePlatforms: r.targeting?.devicePlatforms || [],
          // Detailed Targeting — reverse-mapped by resolveAdSetForEdit
          // (handles modern flexible_spec AND legacy flat-array ad sets;
          // see utils/detailedTargeting.js flexibleSpecToForm). Default
          // shape preserved so a fresh ad set without detailedTargeting
          // doesn't undefine the wizard's form slot.
          detailedTargeting: r.targeting?.detailedTargeting || {
            include: [],
            narrow: [],
            exclude: [],
          },
          useSavedAudience: false,
          // Awareness/STANDARD — pass-through frequency cap from the
          // backend's resolve handler. null when Meta has no cap set (so
          // launch-payload check skips emission and existing behavior is
          // preserved); object when a cap exists (UI prefills it).
          frequencyControl: r.frequencyControl || null,
        },
      });
    } catch (err) {
      globalToast.error(
        err?.response?.data?.error || "Couldn't open the ad set editor.",
      );
    } finally {
      setEditingId(null);
    }
  };

  const getStatus = (s) => statuses[s.id] ?? s.status;

  const handleToggle = async (e, s) => {
    e.stopPropagation();
    const next = getStatus(s) === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
    setToggling((p) => ({ ...p, [s.id]: true }));
    try {
      const res = await updateAdStatus('adset', s.id, next);
      setStatuses((p) => ({ ...p, [s.id]: next }));
      globalToast.success(res?.message);
    } catch { globalToast.error('Failed to update ad set status'); }
    finally  { setToggling((p) => ({ ...p, [s.id]: false })); }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-white/10 dark:bg-[#141414]">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-gray-200 bg-gray-50 px-4 py-2.5 dark:border-white/10 dark:bg-[#181818]">
        <p className="truncate text-xs font-semibold text-gray-500 dark:text-white/70">
          Ad sets in <span className="text-gray-900 dark:text-white">{campaign.name}</span>
        </p>
        {canAdd && <AddButton label="Add Ad Set" onClick={handleAddAdSet} busy={resolvingAdd} />}
      </div>
      <div className="scrollbar-thin flex-1 overflow-auto">
        <table className="w-full min-w-[680px] border-collapse">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 dark:border-white/12 dark:bg-[#181818]">
              <SortTh label="Ad Set"            colKey="name"             sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="w-[34%] pl-5" />
              <SortTh label="Status"            colKey="status"           sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              <SortTh label="Daily Budget"      colKey="daily_budget"     sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              <SortTh label="Billing Event"     colKey="billing_event"    sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              <SortTh label="Optimization Goal" colKey="optimization_goal" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              <SortTh label="Start Date"        colKey="start_time"       sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              {canAdd && <th className="w-14 pr-5 pl-2 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-white/70">Edit</th>}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={canAdd ? 7 : 6} className="py-14"><Spinner /></td></tr>
            )}
            {!loading && sorted.length === 0 && (
              <tr><td colSpan={canAdd ? 7 : 6} className="py-14"><EmptyState message="No ad sets in this campaign" /></td></tr>
            )}
            {sorted.map((s, idx) => {
              const status = getStatus(s);
              return (
                <motion.tr
                  key={s.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: idx * 0.03 }}
                  onClick={() => onDrillDown(s)}
                  className="group cursor-pointer border-b border-gray-200 transition-colors hover:bg-gray-100 dark:border-white/10 dark:hover:bg-white/3 last:border-b-0"
                >
                  <td className="pl-5 pr-4 py-4">
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-0.5 shrink-0 rounded-full bg-gray-300 dark:bg-white/20" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-gray-900 dark:text-white">{s.name}</p>
                        <p className="mt-0.5 font-mono text-[11px] text-gray-400 dark:text-white/40">ID: {s.id}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex items-center gap-2.5">
                      <StatusBadge status={status} />
                      <ToggleSwitch status={status} onToggle={(e) => handleToggle(e, s)} toggling={!!toggling[s.id]} />
                    </div>
                  </td>
                  <td className="px-4 py-4 text-sm font-medium text-gray-600 dark:text-white/80">
                    {hasBudget(s.daily_budget)
                      ? s.daily_budget
                      : hasBudget(s.lifetime_budget)
                        ? <span>{s.lifetime_budget} <span className="text-gray-400 dark:text-white/40">lifetime</span></span>
                        : <span className="text-gray-400 dark:text-white/40">{cboParent ? 'Set on campaign (CBO)' : '—'}</span>}
                  </td>
                  <td className="px-4 py-4">
                    <span className="flex items-center gap-1.5 text-sm text-gray-600 dark:text-white/80">
                      <Activity className="h-3.5 w-3.5 shrink-0 text-gray-400 dark:text-white/30" />
                      {labelBillingEvent(s.billing_event) ?? '—'}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-sm text-gray-600 dark:text-white/80">
                    {labelOptimizationGoal(s.optimization_goal) ?? '—'}
                  </td>
                  <td className="px-4 py-4 text-sm text-gray-600 dark:text-white/80">
                    <span className="flex items-center gap-1.5">
                      <Calendar className="h-3.5 w-3.5 shrink-0 text-gray-400 dark:text-white/30" />
                      {s.start_time ? new Date(s.start_time).toLocaleDateString() : '—'}
                    </span>
                  </td>
                  {canAdd && (
                    <td className="pr-5 pl-2 py-4">
                      <div className="flex items-center justify-end">
                        <button
                          onClick={(e) => handleEditAdSet(e, s)}
                          disabled={editingId === s.id}
                          title="Edit ad set"
                          className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-gray-100 text-gray-400 transition-all hover:border-gray-300 hover:bg-gray-200 hover:text-gray-900 dark:border-white/8 dark:bg-white/2 dark:text-white/40 dark:hover:border-white/20 dark:hover:bg-white/8 dark:hover:text-white disabled:opacity-50"
                        >
                          {editingId === s.id ? (
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
  );
}

// ─── section label ────────────────────────────────────────────────────────────

function SectionLabel({ children }) {
  return (
    <p className="mb-2.5 text-10 font-bold uppercase tracking-[0.12em] text-gray-400 dark:text-[#444]">
      {children}
    </p>
  );
}

// ─── ad preview drawer ────────────────────────────────────────────────────────

function AdDrawer({ ad, onClose }) {
  const { creative, name, status } = ad;
  const [currentStatus, setCurrentStatus] = useState(status);
  const [toggling, setToggling]           = useState(false);
  const isVideo       = creative?.object_type === 'VIDEO';
  const bodyVariants  = creative?.asset_feed_spec?.bodies ?? [];
  const titleVariants = creative?.asset_feed_spec?.titles ?? [];
  const destLink      = creative?.object_story_spec?.video_data?.call_to_action?.value?.link ?? null;
  const ctaLabel      = labelCTA(creative?.call_to_action_type);

  // Lazy-fetch the full-resolution image / playable video source. The
  // bulk getAds endpoint only returns `creative.thumbnail_url` (low-res
  // ~128px — blurry when scaled to fill the preview) and
  // `creative.object_story_spec.video_data` (carries `video_id` but no
  // playable URL — Meta requires a separate AdVideo.source fetch).
  //
  // Backend: GET /meta-ads/get-ad-preview-media → { kind, imageUrl?,
  // videoUrl?, posterUrl? }. 30-min cached. Fetched once per ad when the
  // drawer opens.
  const [media, setMedia] = useState(null);
  const [mediaLoading, setMediaLoading] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setMedia(null);
    setMediaLoading(true);
    getAdPreviewMedia(ad.id)
      .then((r) => { if (!cancelled) setMedia(r); })
      .catch(() => { if (!cancelled) setMedia(null); })
      .finally(() => { if (!cancelled) setMediaLoading(false); });
    return () => { cancelled = true; };
  }, [ad.id]);

  const handleToggle = async (e) => {
    e.stopPropagation();
    const next = currentStatus === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
    setToggling(true);
    try {
      const res = await updateAdStatus('ad', ad.id, next);
      setCurrentStatus(next);
      globalToast.success(res?.message);
    } catch { globalToast.error('Failed to update ad status'); }
    finally  { setToggling(false); }
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 24 }}
      transition={{ duration: 0.22, ease: 'easeOut' }}
      className="flex w-90 shrink-0 flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-white/10 dark:bg-[#181818]"
    >
      {/* ── header ── */}
      <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4 dark:border-white/12">
        <div>
          <p className="text-sm font-bold text-gray-900 dark:text-white">Ad Preview</p>
          <p className="mt-0.5 max-w-60 truncate text-xs text-gray-400 dark:text-[#555]">{name}</p>
        </div>
        <button
          onClick={onClose}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-[#555] dark:hover:bg-white/8 dark:hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="scrollbar-thin flex-1 overflow-y-auto">

        {/* ── creative mockup ── */}
        <div className="relative w-full bg-gray-50 dark:bg-[#141414]">
          {/* simulated feed chrome — top bar */}
          <div className="flex items-center gap-2.5 border-b border-gray-200 px-4 py-2.5 dark:border-white/5">
            <div className="h-7 w-7 rounded-full bg-gray-200 dark:bg-white/10" />
            <div>
              <p className="text-xs font-semibold text-gray-900 dark:text-white">Sponsored</p>
              <p className="text-10 text-gray-400 dark:text-[#444]">Instagram · Feed</p>
            </div>
            <div className="ml-auto flex gap-1">
              <span className="h-1 w-1 rounded-full bg-gray-300 dark:bg-[#333]" />
              <span className="h-1 w-1 rounded-full bg-gray-300 dark:bg-[#333]" />
              <span className="h-1 w-1 rounded-full bg-gray-300 dark:bg-[#333]" />
            </div>
          </div>

          {/* creative media — for videos with known dimensions, match the
              container's aspect to the video so portrait reels (9:16) and
              landscape ads (16:9) don't get squashed into a square. Images
              stay aspect-square (matches Instagram feed). */}
          <div
            className="relative w-full overflow-hidden bg-gray-100 dark:bg-[#111]"
            style={{
              aspectRatio:
                isVideo && media?.width && media?.height
                  ? `${media.width} / ${media.height}`
                  : '1 / 1',
            }}
          >
            {mediaLoading && !media ? (
              <div className="flex h-full w-full items-center justify-center">
                <Spinner />
              </div>
            ) : isVideo ? (
              /* Video — preference cascade from getAdPreviewMedia:
                 1. Direct MP4 `videoUrl` → <video controls> (best UX)
                 2. `embedUrl` → Facebook's `plugins/video.php` iframe
                    (player only, no comments/reactions chrome). Backend
                    builds this from permalink_url with show_text=false.
                 3. `permalinkUrl` → poster + "Open on Facebook" button
                 4. Poster only — preserves something visual. */
              media?.videoUrl ? (
                <video
                  key={ad.id}
                  src={media.videoUrl}
                  poster={media?.posterUrl ?? undefined}
                  controls
                  playsInline
                  className="h-full w-full object-cover"
                />
              ) : media?.embedUrl ? (
                <iframe
                  key={ad.id}
                  src={media.embedUrl}
                  title={name}
                  allow="autoplay; encrypted-media; picture-in-picture; web-share"
                  allowFullScreen
                  className="h-full w-full border-0"
                />
              ) : media?.posterUrl || media?.permalinkUrl ? (
                <div className="relative h-full w-full">
                  {media?.posterUrl && (
                    <img
                      src={media.posterUrl}
                      alt={name}
                      className="h-full w-full object-cover"
                    />
                  )}
                  {media?.permalinkUrl && (
                    <a
                      href={media.permalinkUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="absolute inset-0 flex items-center justify-center bg-black/50 text-xs font-semibold text-white hover:bg-black/60"
                    >
                      Open video on Facebook
                    </a>
                  )}
                </div>
              ) : (
                <div className="flex h-full w-full flex-col items-center justify-center gap-3">
                  <ImageIcon className="h-10 w-10 text-gray-300 dark:text-[#2a2a2a]" />
                  <span className="text-xs text-gray-400 dark:text-[#333]">
                    Video preview unavailable
                  </span>
                </div>
              )
            ) : media?.imageUrl || creative?.thumbnail_url ? (
              <img
                src={media?.imageUrl || creative.thumbnail_url}
                alt={name}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center gap-3">
                <ImageIcon className="h-10 w-10 text-gray-300 dark:text-[#2a2a2a]" />
                <span className="text-xs text-gray-400 dark:text-[#333]">No creative</span>
              </div>
            )}
            {/* status chip over media */}
            <div className="absolute top-3 right-3">
              <StatusBadge status={currentStatus} />
            </div>
          </div>

          {/* simulated feed chrome — bottom bar */}
          <div className="border-t border-gray-200 px-4 py-3 dark:border-white/5">
            {creative?.title && (
              <p className="mb-0.5 text-sm font-bold leading-snug text-gray-900 dark:text-white">{creative.title}</p>
            )}
            {creative?.body && (
              <p className="line-clamp-2 text-xs leading-relaxed text-gray-500 dark:text-[#777]">{creative.body}</p>
            )}
            {ctaLabel && (
              <div className="mt-3 flex items-center justify-between">
                {destLink ? (
                  <a href={destLink} target="_blank" rel="noopener noreferrer"
                    className="rounded-lg border border-gray-200 bg-gray-100 px-3 py-1.5 text-xs font-semibold text-gray-900 transition-colors hover:border-gray-300 hover:bg-gray-200 dark:border-white/10 dark:bg-white/6 dark:text-white dark:hover:border-white/20 dark:hover:bg-white/10">
                    {ctaLabel}
                  </a>
                ) : (
                  <span className="rounded-lg border border-gray-200 bg-gray-100 px-3 py-1.5 text-xs font-semibold text-gray-900 dark:border-white/10 dark:bg-white/6 dark:text-white">
                    {ctaLabel}
                  </span>
                )}
                {creative?.instagram_permalink_url && (
                  <a href={creative.instagram_permalink_url} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1 text-[11px] font-medium text-gray-400 hover:text-gray-600 dark:text-white/50 dark:hover:text-white/80">
                    See Original <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── details ── */}
        <div className="px-5 py-4 flex flex-col gap-5">

          {/* status control */}
          <div>
            <SectionLabel>Status</SectionLabel>
            <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 dark:border-white/12 dark:bg-white/3">
              <StatusBadge status={currentStatus} />
              <ToggleSwitch status={currentStatus} onToggle={handleToggle} toggling={toggling} />
            </div>
          </div>

          {/* meta */}
          <div>
            <SectionLabel>Details</SectionLabel>
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: 'Ad ID',     value: ad.id,                                      mono: true },
                { label: 'Bid Type',  value: labelBidType(ad.bid_type)                              },
                { label: 'Created',   value: new Date(ad.created_time).toLocaleDateString()        },
                { label: 'CTA Type',  value: ctaLabel                                              },
              ].filter(({ value }) => !!value).map(({ label, value, mono }) => (
                <div key={label} className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-white/[0.07] dark:bg-white/2.5">
                  <p className="mb-1 text-10 font-semibold uppercase tracking-wider text-gray-400 dark:text-[#444]">{label}</p>
                  <p className={`truncate text-xs font-medium text-gray-900 dark:text-white ${mono ? 'font-mono text-[11px]' : ''}`}>
                    {value}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* body variants */}
          {bodyVariants.length > 1 && (
            <div>
              <SectionLabel>Body Variants · {bodyVariants.length}</SectionLabel>
              <div className="flex flex-col gap-2">
                {bodyVariants.map((b, i) => (
                  <div key={i} className="flex gap-3 rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-3 dark:border-white/12 dark:bg-white/3">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gray-200 text-10 font-bold text-gray-400 dark:bg-white/10 dark:text-white/50">
                      {i + 1}
                    </span>
                    <p className="text-xs leading-relaxed text-gray-600 dark:text-[#ccc]">{b.text}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* headline variants */}
          {titleVariants.length > 0 && (
            <div>
              <SectionLabel>Headline Variants · {titleVariants.length}</SectionLabel>
              <div className="flex flex-col gap-1.5">
                {titleVariants.map((t, i) => (
                  <div key={i} className="flex items-start gap-2.5 rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 dark:border-white/12 dark:bg-white/3">
                    <span className="mt-px text-10 font-bold text-gray-400 dark:text-white/40">{i + 1}</span>
                    <p className="text-xs font-medium leading-snug text-gray-600 dark:text-white/80">{t.text}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      </div>
    </motion.div>
  );
}

// ─── ads table ────────────────────────────────────────────────────────────────

function AdsTable({ adSet, campaign, onLaunchWizard, manageNonce }) {
  const [ads,       setAds]       = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [selectedAd, setSelectedAd] = useState(null);
  const [statuses,  setStatuses]  = useState({});
  const [toggling,  setToggling]  = useState({});
  const [resolving, setResolving] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const { sorted, sortKey, sortDir, toggleSort } = useSortedRows(ads, 'name');
  // Add Ad / Edit only when V2 wizard is on AND the campaign objective is
  // V2-supported (see AdSetTable's canAdd for the rationale).
  const canAdd = V2_SUPPORTED_OBJECTIVES.has(campaign?.objective) && !!onLaunchWizard;

  // Refetch on mount + whenever the parent signals an add (manageNonce).
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getAdSetAds(adSet.id)
      .then((r) => { if (!cancelled) setAds(r.ads || []); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [adSet.id, manageNonce]);

  // "Add Ad": the wizard's Ad step is cell-driven, so first resolve the
  // cell (objective × conversionLocation + the ad set's page) from Meta,
  // then open the wizard in create-ad mode prefilled with that context.
  const handleAddAd = async () => {
    setResolving(true);
    try {
      const r = await resolveCellForAdSet({ adSetId: adSet.id });
      onLaunchWizard?.('create-ad', {
        campaignId: r.campaignId || campaign?.id,
        adSetId: adSet.id,
        objective: r.objective,
        conversionLocation: r.conversionLocation,
        pageId: r.pageId || '',
        parentLabel: adSet.name,
      });
    } catch (err) {
      globalToast.error(
        err?.response?.data?.error ||
          "Couldn't open the ad builder for this ad set.",
      );
    } finally {
      setResolving(false);
    }
  };

  // Edit — read the ad's creative fresh, then open the wizard prefilled.
  // Media is reused as-is (v1); only name + copy/CTA/link are editable.
  const handleEditAd = async (e, a) => {
    e.stopPropagation();
    setEditingId(a.id);
    try {
      const r = await resolveAdForEdit({ adId: a.id });
      onLaunchWizard?.('edit-ad', {
        adId: a.id,
        adSetId: r.adSetId,
        campaignId: r.campaignId,
        objective: r.objective,
        conversionLocation: r.conversionLocation,
        pageId: r.pageId || '',
        parentLabel: r.name || a.name,
        formOverrides: {
          adName: r.name || a.name,
          headline: r.headline || '',
          primaryText: r.primaryText || '',
          description: r.description || '',
          linkUrl: r.linkUrl || '',
          callToAction: r.callToAction || '',
          urlTags: r.urlTags || '',
          leadFormId: r.leadFormId || '',
          objectStoreUrl: r.objectStoreUrl || '',
          applicationId: r.applicationId || '',
          mediaType: r.mediaType || 'image',
          imageHash: r.imageHash || null,
          videoId: r.videoId || null,
          videoThumbnailUrl: r.videoThumbnailUrl || null,
          previewUrl: r.previewUrl || null,
        },
      });
    } catch (err) {
      globalToast.error(
        err?.response?.data?.error || "Couldn't open the ad editor.",
      );
    } finally {
      setEditingId(null);
    }
  };

  const getStatus = (a) => statuses[a.id] ?? a.status;

  const handleToggle = async (e, a) => {
    e.stopPropagation();
    const next = getStatus(a) === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
    setToggling((p) => ({ ...p, [a.id]: true }));
    try {
      const res = await updateAdStatus('ad', a.id, next);
      setStatuses((p) => ({ ...p, [a.id]: next }));
      globalToast.success(res?.message);
    } catch { globalToast.error('Failed to update ad status'); }
    finally  { setToggling((p) => ({ ...p, [a.id]: false })); }
  };

  return (
    <div className="flex min-h-0 flex-1 gap-4">
      {/* main table */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-white/10 dark:bg-[#141414]">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-gray-200 bg-gray-50 px-4 py-2.5 dark:border-white/10 dark:bg-[#181818]">
          <p className="truncate text-xs font-semibold text-gray-500 dark:text-white/70">
            Ads in <span className="text-gray-900 dark:text-white">{adSet.name}</span>
          </p>
          {canAdd && <AddButton label="Add Ad" onClick={handleAddAd} busy={resolving} />}
        </div>
        <div className="scrollbar-thin flex-1 overflow-auto">
          <table className="w-full min-w-140 border-collapse">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 dark:border-white/12 dark:bg-[#181818]">
                <th className="w-18 py-3 pl-5 pr-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-white/70">Preview</th>
                <SortTh label="Ad Name"  colKey="name"         sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="w-[34%]" />
                <SortTh label="Status"   colKey="status"       sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortTh label="Bid Type" colKey="bid_type"     sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortTh label="CTA"      colKey="creative.call_to_action_type" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortTh label="Created"  colKey="created_time" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                {canAdd && <th className="w-14 pr-5 pl-2 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-white/70">Edit</th>}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={canAdd ? 7 : 6} className="py-14"><Spinner /></td></tr>
              )}
              {!loading && sorted.length === 0 && (
                <tr><td colSpan={canAdd ? 7 : 6} className="py-14"><EmptyState message="No ads in this ad set" /></td></tr>
              )}
              {sorted.map((a, idx) => {
                const status     = getStatus(a);
                const isSelected = selectedAd?.id === a.id;
                return (
                  <motion.tr
                    key={a.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: idx * 0.03 }}
                    onClick={() => setSelectedAd((p) => (p?.id === a.id ? null : a))}
                    className={`group cursor-pointer border-b border-gray-200 transition-colors last:border-b-0 dark:border-white/10
                      ${isSelected ? 'bg-gray-100 dark:bg-white/5' : 'hover:bg-gray-100 dark:hover:bg-white/3'}`}
                  >
                    <td className="py-3 pl-5 pr-3">
                      <div className="relative h-11 w-16 overflow-hidden rounded-lg border border-gray-200 bg-gray-100 dark:border-white/10 dark:bg-[#1e1e1e]">
                        {a.creative?.thumbnail_url ? (
                          <img src={a.creative.thumbnail_url} alt={a.name} className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center">
                            <ImageIcon className="h-4 w-4 text-gray-400 dark:text-white/20" />
                          </div>
                        )}
                        {a.creative?.object_type === 'VIDEO' && (
                          <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                            <Play className="h-3 w-3 fill-white text-white" />
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className={`h-6 w-0.5 shrink-0 rounded-full transition-colors ${isSelected ? 'bg-gray-400 dark:bg-white/50' : 'bg-gray-300 dark:bg-white/15'}`} />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-gray-900 dark:text-white">{a.name}</p>
                          {a.creative?.title && (
                            <p className="truncate text-xs text-gray-400 dark:text-white/40">{a.creative.title}</p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <StatusBadge status={status} />
                        <ToggleSwitch status={status} onToggle={(e) => handleToggle(e, a)} toggling={!!toggling[a.id]} />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 dark:text-white/80">{labelBidType(a.bid_type) ?? '—'}</td>
                    <td className="px-4 py-3 text-sm text-gray-600 dark:text-white/80">{labelCTA(a.creative?.call_to_action_type) ?? '—'}</td>
                    <td className="px-4 py-3 text-sm text-gray-600 dark:text-white/80">{new Date(a.created_time).toLocaleDateString()}</td>
                    {canAdd && (
                      <td className="pr-5 pl-2 py-3">
                        <div className="flex items-center justify-end">
                          <button
                            onClick={(e) => handleEditAd(e, a)}
                            disabled={editingId === a.id}
                            title="Edit ad"
                            className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-gray-100 text-gray-400 transition-all hover:border-gray-300 hover:bg-gray-200 hover:text-gray-900 dark:border-white/8 dark:bg-white/2 dark:text-white/40 dark:hover:border-white/20 dark:hover:bg-white/8 dark:hover:text-white disabled:opacity-50"
                          >
                            {editingId === a.id ? (
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

      {/* side drawer */}
      <AnimatePresence>
        {selectedAd && (
          <AdDrawer ad={selectedAd} onClose={() => setSelectedAd(null)} />
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── root export ──────────────────────────────────────────────────────────────

export function TableViewCampaigns({ campaigns, loadingCampaigns, adAccountId, onRefresh, onLaunchWizard, manageNonce }) {
  const [level,            setLevel]            = useState('campaigns');
  const [selectedCampaign, setSelectedCampaign] = useState(null);
  const [selectedAdSet,    setSelectedAdSet]    = useState(null);

  const drillToCampaign = (c) => { setSelectedCampaign(c); setSelectedAdSet(null); setLevel('adsets'); };
  const drillToAdSet    = (s) => { setSelectedAdSet(s);                              setLevel('ads'); };
  const goToCampaigns   = ()  => { setLevel('campaigns'); setSelectedCampaign(null); setSelectedAdSet(null); };
  const goToAdSets      = ()  => { setLevel('adsets');                               setSelectedAdSet(null); };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* nav bar */}
      <div className="flex shrink-0 items-center">
        <Breadcrumb
          level={level}
          campaign={selectedCampaign}
          adSet={selectedAdSet}
          onClickCampaigns={goToCampaigns}
          onClickCampaign={goToAdSets}
        />
      </div>

      {/* content — fills remaining height */}
      <div className="flex min-h-0 flex-1 flex-col">
        <AnimatePresence mode="wait">
          {level === 'campaigns' && (
            <motion.div key="campaigns" className="flex min-h-0 flex-1 flex-col" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.18 }}>
              <CampaignTable campaigns={campaigns} loading={loadingCampaigns} adAccountId={adAccountId} onDrillDown={drillToCampaign} onRefresh={onRefresh} onLaunchWizard={onLaunchWizard} />
            </motion.div>
          )}
          {level === 'adsets' && selectedCampaign && (
            <motion.div key="adsets" className="flex min-h-0 flex-1 flex-col" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.18 }}>
              <AdSetTable campaign={selectedCampaign} adAccountId={adAccountId} onDrillDown={drillToAdSet} onLaunchWizard={onLaunchWizard} manageNonce={manageNonce} />
            </motion.div>
          )}
          {level === 'ads' && selectedAdSet && (
            <motion.div key="ads" className="flex min-h-0 flex-1 flex-col" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.18 }}>
              <AdsTable adSet={selectedAdSet} campaign={selectedCampaign} onLaunchWizard={onLaunchWizard} manageNonce={manageNonce} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
