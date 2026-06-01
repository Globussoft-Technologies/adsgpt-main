import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Search,
  RefreshCw,
  RotateCcw,
  Loader2,
  Pause,
  Play,
  Bell,
  Edit2,
  ExternalLink,
  Download,
  TrendingUp,
  Sparkles,
  ClipboardList,
} from 'lucide-react';
import { getActionLog } from '@/apis/autopilot/autopilotApi';
import { getAdAccounts } from '@/apis/metaAds/metaAdsApi';
import { Dropdown } from '@/components/MetaAds/MetaAdsAtoms';
import {
  Section,
  SecondaryButton,
  Banner,
  SeverityBadge,
  DateRangeFilter,
  todayDateInput,
  firstOfMonthDateInput,
  dateInputToIsoStart,
  dateInputToIsoEnd,
} from './_atoms';

// The page-level picker emits bare ad-account IDs but every row in
// autopilotActionLog is stored with the Meta-canonical "act_" prefix.
// Normalize on ingestion so the filter and API match on first render.
const normalizeAccountId = (id) =>
  id ? (String(id).startsWith('act_') ? String(id) : `act_${id}`) : '';

/**
 * Action log — paginated, filterable, expandable view of every action
 * Autopilot has taken (or would have taken in dry-run). Fetches a sizeable
 * batch matching server-side filters (account / action / outcome / time),
 * then layers client-side severity + free-text filters and pagination.
 */
const AutopilotActionLog = ({ selectedAdAccountId } = {}) => {
  const [allRows, setAllRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [userAccounts, setUserAccounts] = useState([]);

  // Date filters use 'YYYY-MM-DD' (local) so the values plug straight into
  // <input type="date">. Default range = current calendar month → today,
  // matching the new UI requirement (no future dates, scoped to the month
  // the operator is actually triaging).
  const [filters, setFilters] = useState(() => ({
    adAccountId: normalizeAccountId(selectedAdAccountId),
    action: '',
    outcome: '',
    severity: '',
    from: firstOfMonthDateInput(),
    to: todayDateInput(),
    search: '',
  }));

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const [expandedId, setExpandedId] = useState(null);

  // Hydrate the account-filter dropdown.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await getAdAccounts();
        if (alive) setUserAccounts(r?.adAccounts || []);
      } catch {
        // Non-fatal.
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Pre-fill the account filter when the page-level picker changes.
  useEffect(() => {
    const next = normalizeAccountId(selectedAdAccountId);
    if (next !== filters.adAccountId) {
      setFilters((f) => ({ ...f, adAccountId: next }));
      setPage(1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAdAccountId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = {
        adAccountId: filters.adAccountId || undefined,
        action: filters.action || undefined,
        outcome: filters.outcome || undefined,
        page: 1,
        // Pull the entire date range so KPI cards reflect the full filter
        // scope, not just the visible page. The backend caps at 1000 — a
        // one-month date scope is well under that for any realistic account.
        limit: 1000,
      };
      // Map 'YYYY-MM-DD' to a local-day boundary ISO instant. The backend
      // filters `runAt: { $gte: from, $lte: to }`, so passing 00:00:00 local
      // and 23:59:59.999 local makes the calendar-day intent exact.
      if (filters.from) {
        params.from = dateInputToIsoStart(filters.from);
      }
      if (filters.to) {
        params.to = dateInputToIsoEnd(filters.to);
      }
      const res = await getActionLog(params);
      setAllRows(res?.rows || []);
    } catch (e) {
      setError(e?.response?.data?.error || e.message);
    } finally {
      setLoading(false);
    }
  }, [
    filters.adAccountId,
    filters.action,
    filters.outcome,
    filters.from,
    filters.to,
  ]);

  useEffect(() => {
    load();
  }, [load]);

  const setFilter = (key, value) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(1);
    setExpandedId(null);
  };

  const resetFilters = () => {
    setFilters({
      adAccountId: '',
      action: '',
      outcome: '',
      severity: '',
      from: firstOfMonthDateInput(),
      to: todayDateInput(),
      search: '',
    });
    setPage(1);
    setExpandedId(null);
  };

  // Client-side narrowing for severity + free-text search.
  const filteredRows = useMemo(() => {
    const s = filters.search.trim().toLowerCase();
    return allRows.filter((r) => {
      if (filters.severity && r.ruleSeverity !== filters.severity) return false;
      if (s) {
        const hay = [
          r.entityName,
          r.adAccountName,
          r.campaignName,
          r.adsetName,
          r.ruleMessage,
          r.ruleId,
          r.entityId,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(s)) return false;
      }
      return true;
    });
  }, [allRows, filters.severity, filters.search]);

  const total = filteredRows.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const startIdx = (page - 1) * pageSize;
  const pagedRows = filteredRows.slice(startIdx, startIdx + pageSize);

  // KPI computation off the filtered set so the cards always reflect the
  // current view, not the unfiltered backend total.
  const stats = useMemo(() => {
    const inRange = filteredRows.length;
    const pauses = filteredRows.filter((r) => r.action === 'pause').length;
    const others = inRange - pauses;
    const successes = filteredRows.filter((r) => r.outcome === 'success').length;
    const successRate = inRange > 0 ? Math.round((successes / inRange) * 100) : 0;

    const counts = new Map();
    for (const r of filteredRows) {
      const key = formatRuleLabel(r);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    let topRule = null;
    let topCount = 0;
    counts.forEach((v, k) => {
      if (v > topCount) {
        topRule = k;
        topCount = v;
      }
    });

    // Budget-protected feature — commented out per product decision.
    // Re-enable by uncommenting this block + the `budgetProtected`/`currency`
    // return fields + the `<KpiCard label="Budget protected" />` JSX below.
    // let budgetProtected = 0;
    // let currency = null;
    // for (const r of filteredRows) {
    //   if (r.action === 'pause' && r.metricsSnapshot?.spend) {
    //     budgetProtected += Number(r.metricsSnapshot.spend) || 0;
    //     currency = currency || r.metricsSnapshot.currency;
    //   }
    // }
    return {
      inRange,
      pauses,
      others,
      successRate,
      topRule,
      topCount,
      // budgetProtected,
      // currency,
    };
  }, [filteredRows]);

  const accountOptions = useMemo(
    () => [
      { value: '', label: 'All accounts' },
      ...userAccounts.map((a) => ({ value: `act_${a.id}`, label: a.name })),
    ],
    [userAccounts],
  );

  const exportCSV = () => {
    if (!filteredRows.length) return;
    const headers = [
      'When',
      'Account',
      'Entity',
      'Level',
      'Rule',
      'Action',
      'Outcome',
      'Mode',
      'SkipReason',
      'Error',
    ];
    const escape = (v) => {
      if (v == null) return '';
      const s = String(v).replace(/"/g, '""');
      return /[",\n]/.test(s) ? `"${s}"` : s;
    };
    const lines = [headers.join(',')];
    for (const r of filteredRows) {
      lines.push(
        [
          new Date(r.runAt || r.createdAt).toISOString(),
          r.adAccountName || '',
          r.entityName || '',
          r.level || '',
          r.ruleMessage || r.ruleId || '',
          r.action || '',
          r.outcome || '',
          r.dryRun ? 'dry-run' : 'live',
          r.skipReason || '',
          r.error || '',
        ]
          .map(escape)
          .join(','),
      );
    }
    const blob = new Blob([lines.join('\n')], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `autopilot-action-log-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex w-full flex-col gap-4 px-4 py-5 sm:px-5 sm:py-6 lg:px-6 2xl:py-8">
      <PageHeader loading={loading} />

      {/* KPI cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard
          label="Actions in range"
          value={stats.inRange.toLocaleString()}
          sub={`${stats.pauses.toLocaleString()} pauses · ${stats.others.toLocaleString()} other`}
        />
        {/* Budget protected — commented out per product decision. Re-enable
            by uncommenting this card + the `budgetProtected`/`currency`
            stats block above. */}
        {/*
        <KpiCard
          label="Budget protected"
          value={
            <span className="text-emerald-400">
              {formatCurrency(stats.budgetProtected, stats.currency, true) ||
                (stats.currency === 'INR' ? '₹0' : '0')}
            </span>
          }
          sub="Spend on paused entities"
        />
        */}
        <KpiCard
          label="Success rate"
          value={`${stats.successRate}%`}
          sub="Of all actions taken"
        />
        <KpiCard
          label="Most-fired rule"
          value={stats.topRule || '—'}
          valueClassName="text-sm leading-snug"
          truncateValue
          sub={
            stats.topCount > 0
              ? `Fired ${stats.topCount} time${stats.topCount === 1 ? '' : 's'}`
              : '—'
          }
        />
      </div>

      {/* Filter bar — relative+z-20 lifts dropdowns above the table below. */}
      <Section className="relative z-20 p-3!">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          {/* Search */}
          <div className="relative w-full xl:max-w-sm">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-white/45 2xl:h-4 2xl:w-4" />
            <input
              type="text"
              value={filters.search}
              onChange={(e) => setFilter('search', e.target.value)}
              placeholder="Search entity, rule, account…"
              className="h-9 w-full rounded-xl border border-white/10 bg-white/[0.06] pr-3 pl-9 text-xs text-white placeholder:text-white/45 focus:border-[#15DCFF]/40 focus:outline-none 2xl:h-10 2xl:text-13"
            />
          </div>

          {/* Filter dropdowns */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Date range — defaults to current month, today blocks future
                picks via `max={todayDateInput()}`. The end input also clamps
                its min to the start date so the range can't invert. */}
            <DateRangeFilter
              from={filters.from}
              to={filters.to}
              onChange={(key, value) => setFilter(key, value)}
            />
            <FilterDropdown
              value={filters.adAccountId}
              options={accountOptions}
              onChange={(v) => setFilter('adAccountId', v)}
              widthClass="w-44"
            />
            <FilterDropdown
              value={filters.action}
              options={[
                { value: '', label: 'All actions' },
                { value: 'pause', label: 'Pause' },
                { value: 'resume', label: 'Resume' },
                { value: 'scale_budget', label: 'Budget +' },
                { value: 'rotate_creative', label: 'Rotate' },
                { value: 'rename', label: 'Rename' },
                { value: 'alert_only', label: 'Alert' },
              ]}
              onChange={(v) => setFilter('action', v)}
              widthClass="w-36"
            />
            <FilterDropdown
              value={filters.outcome}
              options={[
                { value: '', label: 'All outcomes' },
                { value: 'success', label: 'Success' },
                { value: 'failed', label: 'Failed' },
                { value: 'skipped', label: 'Skipped' },
              ]}
              onChange={(v) => setFilter('outcome', v)}
              widthClass="w-36"
            />
            <FilterDropdown
              value={filters.severity}
              options={[
                { value: '', label: 'All severities' },
                { value: 'high', label: 'High' },
                { value: 'medium', label: 'Medium' },
                { value: 'low', label: 'Low' },
              ]}
              onChange={(v) => setFilter('severity', v)}
              widthClass="w-36"
            />
          </div>
        </div>

        {/* Result count + utility buttons */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-3">
          <div className="text-10 text-white/70 2xl:text-xs">
            Showing{' '}
            <span className="text-white">
              {Math.min(pageSize, total).toLocaleString()}
            </span>{' '}
            of <span className="text-white">{total.toLocaleString()}</span>{' '}
            action{total === 1 ? '' : 's'}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SecondaryButton onClick={load} disabled={loading}>
              {loading ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
              Refresh
            </SecondaryButton>
            <SecondaryButton onClick={resetFilters} disabled={loading}>
              <RotateCcw className="h-3 w-3" /> Reset filters
            </SecondaryButton>
            <SecondaryButton
              onClick={exportCSV}
              disabled={!filteredRows.length}
            >
              <Download className="h-3 w-3" /> Export CSV
            </SecondaryButton>
          </div>
        </div>
      </Section>

      {error && <Banner variant="error">{error}</Banner>}

      {/* Table */}
      <Section className="overflow-hidden p-0!">
        <div className="scrollbar-thin max-h-[65vh] overflow-auto">
          <table className="w-full min-w-[820px] text-xs 2xl:text-13">
            <thead className="sticky top-0 z-10 bg-[#14181D]">
              <tr className="border-b border-white/10 bg-white/2 text-left">
                <Th>Trigger</Th>
                <Th>Entity</Th>
                <Th>Rule</Th>
                <Th>When</Th>
                <Th>Outcome</Th>
              </tr>
            </thead>
            <tbody>
              {loading && pagedRows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-12 text-center">
                    <Loader2 className="mx-auto h-4 w-4 animate-spin text-white/40" />
                  </td>
                </tr>
              )}
              {!loading && pagedRows.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-3 py-12 text-center text-xs text-white/70 2xl:text-13"
                  >
                    No actions match this filter.
                  </td>
                </tr>
              )}
              {pagedRows.map((r) => (
                <LogRow
                  key={r._id}
                  row={r}
                  expanded={expandedId === r._id}
                  onToggle={() =>
                    setExpandedId(expandedId === r._id ? null : r._id)
                  }
                />
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Pagination
        page={page}
        pages={pages}
        total={total}
        pageSize={pageSize}
        onPageChange={(p) => {
          setPage(p);
          setExpandedId(null);
        }}
        onPageSizeChange={(s) => {
          setPageSize(s);
          setPage(1);
        }}
        disabled={loading}
      />
    </div>
  );
};

// ─── header ────────────────────────────────────────────────────────────────
// The header used to include a "Settings" shortcut button on the right.
// Removed — the top-level Autopilot tabs already expose a Settings tab,
// and having two entry points (one a tab, one a button two rows below)
// was redundant.
const PageHeader = ({ loading }) => (
  <div className="flex flex-wrap items-start justify-between gap-3">
    <div className="flex items-start gap-3">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-[#1A2027] 2xl:h-11 2xl:w-11">
        <ClipboardList className="h-5 w-5 text-white/85 2xl:h-5.5 2xl:w-5.5" />
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-bold text-white 2xl:text-lg">Action log</h2>
          {/* Removed the standalone "Live" pill — it was hardcoded and
              made the page look like Autopilot was running even when
              the user had it toggled OFF. Each row already shows its
              own dry-run/live mode badge in the Mode column, which is
              the source of truth. */}
          {loading && (
            <Loader2 className="h-3 w-3 animate-spin text-white/40" />
          )}
        </div>
        <p className="mt-1 text-xs text-white/70 2xl:text-13">
          Every action Autopilot has taken — what it did, why, and the result.
        </p>
      </div>
    </div>
  </div>
);

// ─── KPI card ──────────────────────────────────────────────────────────────
const KpiCard = ({ label, value, sub, valueClassName = '', truncateValue }) => (
  <div className="rounded-2xl border border-white/10 bg-[#14181D] p-4 backdrop-blur-xl transition-colors hover:border-white/15 2xl:p-5">
    <div className="text-10 font-bold tracking-wider text-white/55 uppercase 2xl:text-[11px]">
      {label}
    </div>
    <div
      className={`mt-2 font-bold text-white 2xl:text-[28px] ${valueClassName || 'text-2xl'} ${
        truncateValue ? 'line-clamp-2 break-words' : ''
      }`}
      title={typeof value === 'string' ? value : undefined}
    >
      {value}
    </div>
    <div className="mt-1.5 text-10 text-white/70 2xl:text-xs">{sub}</div>
  </div>
);

// ─── table primitives ─────────────────────────────────────────────────────
const Th = ({ children }) => (
  <th className="px-3 py-2.5 text-10 font-bold tracking-wider text-white/60 uppercase 2xl:py-3 2xl:text-[11px]">
    {children}
  </th>
);

const LogRow = ({ row, expanded, onToggle }) => {
  const accent = actionAccent(row.action);
  const isLlm = isLlmRuleId(row.ruleId);
  const isUndo = isLlmUndoRuleId(row.ruleId);
  return (
    <>
      <tr
        onClick={onToggle}
        className={`group cursor-pointer border-b border-white/10 align-top transition-colors hover:bg-white/3 ${
          expanded ? 'bg-white/4' : ''
        }`}
      >
        {/* Trigger */}
        <td className="relative px-3 py-3">
          <span
            className={`absolute top-2 bottom-2 left-0 w-0.5 rounded-full ${accent.bar}`}
          />
          <div className="flex items-start gap-2 pl-2">
            <div
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${accent.iconBg}`}
            >
              <ActionIcon
                action={row.action}
                className={`h-3.5 w-3.5 ${accent.iconFg}`}
              />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-bold text-white 2xl:text-13">
                {formatActionTitle(row)}
              </div>
              <div className="mt-0.5 truncate font-mono text-10 text-white/70 2xl:text-[11px]">
                {formatTriggerDelta(row) || '—'}
              </div>
            </div>
          </div>
        </td>

        {/* Entity */}
        <td className="px-3 py-3">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-xs font-bold text-white 2xl:text-13">
              {row.entityName || '—'}
            </span>
            <EntityLevelPill level={row.level} />
          </div>
          <ParentCrumb row={row} />
        </td>

        {/* Rule */}
        <td className="px-3 py-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {row.ruleSeverity && <SeverityBadge severity={row.ruleSeverity} />}
            {isLlm && (
              <span
                className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-10 font-bold tracking-wide uppercase ${
                  isUndo
                    ? 'border-amber-400/30 bg-amber-400/10 text-amber-300'
                    : 'border-[#15DCFF]/30 bg-[#15DCFF]/10 text-[#15DCFF]'
                }`}
              >
                {isUndo ? 'AI · Reverted' : 'AI Audit'}
              </span>
            )}
            <span className="truncate text-xs text-white/90 2xl:text-13">
              {formatRuleLabel(row)}
            </span>
          </div>
        </td>

        {/* When */}
        <td className="px-3 py-3 text-xs whitespace-nowrap text-white/90 2xl:text-13">
          <div className="font-medium">
            {formatDate(row.runAt || row.createdAt)}
          </div>
          <div className="font-mono text-10 text-white/60 2xl:text-[11px]">
            {formatTime(row.runAt || row.createdAt)}
          </div>
        </td>

        {/* Outcome */}
        <td className="px-3 py-3">
          <div className="flex items-center gap-2">
            <OutcomePill outcome={row.outcome} />
            {row.dryRun && (
              <span className="inline-flex items-center rounded-full border border-amber-500/20 bg-amber-500/10 px-1.5 py-0.5 text-10 font-bold tracking-wide text-amber-400 uppercase">
                Dry
              </span>
            )}
            <ChevronDown
              className={`h-3.5 w-3.5 text-white/40 transition-transform ${
                expanded ? 'rotate-180' : ''
              }`}
            />
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-white/10 bg-white/[0.015]">
          <td colSpan={5} className="px-4 py-4 sm:px-6 sm:py-5">
            <ExpandedDetail row={row} />
          </td>
        </tr>
      )}
    </>
  );
};

// ─── expanded detail ──────────────────────────────────────────────────────
const ExpandedDetail = ({ row }) => {
  const snap = row.metricsSnapshot || {};
  const currency = snap.currency;
  const inspectUrl = buildAdsManagerUrl(row);
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <div className="flex flex-col gap-4">
        <DetailBlock label="What happened">
          <div
            className={`relative flex items-center gap-3 overflow-hidden rounded-xl border border-white/12 bg-white/[0.04] p-3`}
          >
            <span
              className={`absolute top-2 bottom-2 left-0 w-0.5 rounded-full ${actionAccent(row.action).bar}`}
            />
            <div
              className={`ml-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${actionAccent(row.action).iconBg}`}
            >
              <ActionIcon
                action={row.action}
                className={`h-4 w-4 ${actionAccent(row.action).iconFg}`}
              />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-bold text-white">
                {formatActionTitle(row)}
              </div>
              <div className="mt-0.5 text-11 text-white/60">
                {formatActionSubtitle(row)}
              </div>
            </div>
          </div>
        </DetailBlock>

        <DetailBlock label="Rule fired">
          <div className="rounded-xl border border-white/12 bg-white/[0.04] p-3">
            <div className="text-sm font-medium text-white">
              {formatRuleLabel(row) || '—'}
            </div>
            {row.ruleMessage && row.ruleMessage !== formatRuleLabel(row) && (
              <div className="mt-1 text-11 text-white/55">
                {row.ruleMessage}
              </div>
            )}
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              {row.ruleSeverity && <SeverityBadge severity={row.ruleSeverity} />}
              {isLlmRuleId(row.ruleId) && (
                <span className="inline-flex items-center rounded-full border border-[#15DCFF]/30 bg-[#15DCFF]/10 px-1.5 py-0.5 text-10 font-bold tracking-wide text-[#15DCFF] uppercase">
                  AI Audit
                </span>
              )}
            </div>
          </div>
        </DetailBlock>
      </div>

      <div className="flex flex-col gap-4">
        <DetailBlock
          label={`${
            row.level === 'campaign'
              ? 'Campaign'
              : row.level === 'adset'
                ? 'Ad set'
                : 'Ad'
          } metrics at trigger`}
        >
          <MetricsGrid snapshot={snap} currency={currency} />
        </DetailBlock>

        <DetailBlock label="Audit">
          <AuditTable row={row} />
        </DetailBlock>

        <div className="flex flex-wrap items-center gap-2">
          {inspectUrl && (
            <ActionLinkButton href={inspectUrl}>
              <ExternalLink className="h-3.5 w-3.5" /> Inspect in Ads Manager
            </ActionLinkButton>
          )}
          {/* Undo + Edit rule hidden until the backend handlers land.
              Re-enable by uncommenting and wiring onUndo / onEditRule props
              from the parent. */}
          {/*
          <ActionButton disabled>
            <RotateCcw className="h-3.5 w-3.5" /> Undo
          </ActionButton>
          <ActionButton disabled>
            <Edit2 className="h-3.5 w-3.5" /> Edit rule
          </ActionButton>
          */}
        </div>
      </div>
    </div>
  );
};

const DetailBlock = ({ label, children }) => (
  <div>
    <div className="mb-2 text-10 font-bold tracking-[0.14em] text-white/45 uppercase">
      {label}
    </div>
    {children}
  </div>
);

// Audit detail — plain label/value rows on the section background (no
// bordered container, no row dividers). Mode is tone-colored so Live vs
// Dry-run is immediately legible.
const AuditTable = ({ row }) => {
  const rows = [
    { label: 'Actor', value: 'Autopilot' },
    row.adAccountName
      ? {
          label: 'Account',
          value: (
            <span>
              {row.adAccountName}
              {row.adAccountId && (
                <span className="ml-2 font-mono text-white/55">
                  {row.adAccountId}
                </span>
              )}
            </span>
          ),
        }
      : {
          label: 'Account',
          value: row.adAccountId || '—',
          mono: true,
        },
    { label: 'Entity ID', value: row.entityId || '—', mono: true },
    {
      label: 'Mode',
      value: row.dryRun ? 'Dry-run' : 'Live',
      tone: row.dryRun ? 'text-amber-300' : 'text-emerald-300',
    },
  ];
  // Run ID hidden from the audit table — internal-only identifier.
  // if (row.runId) rows.push({ label: 'Run ID', value: row.runId, mono: true });
  if (row.skipReason)
    rows.push({ label: 'Skip reason', value: row.skipReason });
  if (row.error)
    rows.push({ label: 'Error', value: row.error, tone: 'text-red-400' });
  return (
    <dl className="text-11">
      {rows.map((r) => (
        <div
          key={r.label}
          className="grid grid-cols-[88px_1fr] items-baseline gap-x-3 py-1"
        >
          <dt className="text-white/45">{r.label}</dt>
          <dd
            className={`min-w-0 break-all ${r.mono ? 'font-mono' : ''} ${
              r.tone || 'text-white/90'
            }`}
          >
            {r.value}
          </dd>
        </div>
      ))}
    </dl>
  );
};

// Shared button shells for the action row under Audit. Kept local so the
// muted "secondary" look stays scoped to this drilldown — the Settings
// SecondaryButton has different padding + height that don't fit here.
const ActionLinkButton = ({ href, children }) => (
  <a
    href={href}
    target="_blank"
    rel="noopener noreferrer"
    className="inline-flex items-center gap-1.5 rounded-lg border border-white/12 bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-white/85 transition-all hover:border-white/20 hover:bg-white/[0.07] hover:text-white"
  >
    {children}
  </a>
);

const ActionButton = ({ onClick, disabled, children }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className="inline-flex items-center gap-1.5 rounded-lg border border-white/12 bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-white/85 transition-all hover:border-white/20 hover:bg-white/[0.07] hover:text-white disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:border-white/12 disabled:hover:bg-white/[0.04] disabled:hover:text-white/85"
  >
    {children}
  </button>
);

const MetricsGrid = ({ snapshot, currency }) => {
  if (!snapshot || typeof snapshot !== 'object') {
    return (
      <div className="rounded-xl border border-white/12 bg-white/[0.04] p-3 text-11 text-white/45">
        No metric snapshot recorded.
      </div>
    );
  }
  const metrics = [
    {
      key: 'spend',
      label: 'Spend',
      value: formatCurrency(snapshot.spend, currency),
    },
    {
      key: 'cpi',
      label: 'CPI',
      value: formatCurrency(snapshot.cpi, currency),
    },
    { key: 'ctr', label: 'CTR', value: formatPercent(snapshot.ctr) },
    {
      key: 'installs',
      label: 'Installs',
      value: formatNumber(snapshot.installs),
    },
    {
      key: 'impressions',
      label: 'Impressions',
      value: formatNumber(snapshot.impressions),
    },
    {
      key: 'roas',
      label: 'ROAS',
      value:
        snapshot.roas != null ? `${Number(snapshot.roas).toFixed(2)}x` : null,
    },
    {
      key: 'cpc',
      label: 'CPC',
      value: formatCurrency(snapshot.cpc, currency),
    },
    {
      key: 'cpm',
      label: 'CPM',
      value: formatCurrency(snapshot.cpm, currency),
    },
    {
      key: 'cpa',
      label: 'CPA',
      value: formatCurrency(snapshot.cpa, currency),
    },
    {
      key: 'frequency',
      label: 'Frequency',
      value:
        snapshot.frequency != null
          ? Number(snapshot.frequency).toFixed(2)
          : null,
    },
    {
      key: 'purchases',
      label: 'Purchases',
      value: formatNumber(snapshot.purchases),
    },
    {
      key: 'clicks',
      label: 'Clicks',
      value: formatNumber(snapshot.clicks),
    },
  ].filter((m) => m.value != null);

  if (!metrics.length) {
    return (
      <div className="rounded-xl border border-white/12 bg-white/[0.04] p-3 text-11 text-white/45">
        No metrics recorded for this trigger.
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {metrics.map((m) => (
        <div
          key={m.key}
          className="rounded-xl border border-white/12 bg-white/[0.04] px-3 py-2.5 transition-colors hover:border-white/16 hover:bg-white/[0.06]"
        >
          <div className="text-10 font-bold tracking-[0.14em] text-white/45 uppercase">
            {m.label}
          </div>
          <div className="mt-1 font-mono text-sm font-semibold text-white">
            {m.value}
          </div>
        </div>
      ))}
    </div>
  );
};

// ─── page-size menu ───────────────────────────────────────────────────────
// Compact upward-opening menu that mirrors `FilterDropdown`'s panel styles
// so the bottom pagination bar uses the same theme as the filter row at
// the top instead of a native browser `<select>`.
const PageSizeMenu = ({ value, sizes, onChange }) => {
  const [open, setOpen] = useState(false);
  return (
    <Dropdown
      anchor="left"
      direction="up"
      open={open}
      onClose={() => setOpen(false)}
      trigger={
        <button
          type="button"
          onClick={() => setOpen((p) => !p)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/12 bg-white/[0.04] px-2.5 py-1 text-xs font-medium text-white transition-all hover:border-white/20 hover:bg-white/[0.07]"
        >
          {value}
          <ChevronDown className="h-3 w-3 text-[#BEBEBE]" />
        </button>
      }
    >
      <div className="w-20 p-1">
        {sizes.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => {
              onChange(s);
              setOpen(false);
            }}
            className={`w-full rounded-lg px-3 py-1.5 text-left text-xs transition-all hover:bg-white/5 ${
              value === s ? 'bg-white/5 text-[#15DCFF]' : 'text-white'
            }`}
          >
            {s}
          </button>
        ))}
      </div>
    </Dropdown>
  );
};

// ─── filter dropdown ──────────────────────────────────────────────────────
const FilterDropdown = ({ value, options, onChange, widthClass = 'w-44' }) => {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value) || options[0];
  return (
    <Dropdown
      anchor="left"
      open={open}
      onClose={() => setOpen(false)}
      trigger={
        <button
          type="button"
          onClick={() => setOpen((p) => !p)}
          className={`flex ${widthClass} items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 text-xs text-white transition-all hover:border-white/10`}
        >
          <span className="truncate font-medium">{selected.label}</span>
          <ChevronDown className="h-3 w-3 shrink-0 text-[#BEBEBE]" />
        </button>
      }
    >
      <div className="w-56 p-1">
        <div className="max-h-64 overflow-y-auto pr-0.5 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/20 [&::-webkit-scrollbar-track]:bg-transparent">
          {options.map((o) => (
            <button
              key={o.value}
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
              className={`w-full rounded-xl px-3 py-2 text-left text-xs transition-all hover:bg-white/5 ${
                value === o.value ? 'bg-white/5 text-[#15DCFF]' : 'text-white'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
    </Dropdown>
  );
};

// ─── pagination ───────────────────────────────────────────────────────────
const Pagination = ({
  page,
  pages,
  total,
  pageSize,
  onPageChange,
  onPageSizeChange,
  disabled,
}) => {
  const sizes = [10, 15, 25, 50];
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-[#14181D] p-3 backdrop-blur-xl">
      <div className="flex flex-wrap items-center gap-3 text-10 text-white/70 2xl:text-xs">
        <span>
          Showing{' '}
          <span className="text-white">
            {from.toLocaleString()}–{to.toLocaleString()}
          </span>{' '}
          of <span className="text-white">{total.toLocaleString()}</span>
        </span>
        <span className="flex items-center gap-1.5">
          Rows per page
          <PageSizeMenu
            value={pageSize}
            sizes={sizes}
            onChange={onPageSizeChange}
          />
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <SecondaryButton
          onClick={() => onPageChange(1)}
          disabled={disabled || page <= 1}
        >
          <ChevronsLeft className="h-3 w-3" /> First
        </SecondaryButton>
        <SecondaryButton
          onClick={() => onPageChange(page - 1)}
          disabled={disabled || page <= 1}
        >
          <ChevronLeft className="h-3 w-3" /> Prev
        </SecondaryButton>
        <span className="px-2 text-xs text-white/80 2xl:text-13">
          Page {page} of {pages}
        </span>
        <SecondaryButton
          onClick={() => onPageChange(page + 1)}
          disabled={disabled || page >= pages}
        >
          Next <ChevronRight className="h-3 w-3" />
        </SecondaryButton>
        <SecondaryButton
          onClick={() => onPageChange(pages)}
          disabled={disabled || page >= pages}
        >
          Last <ChevronsRight className="h-3 w-3" />
        </SecondaryButton>
      </div>
    </div>
  );
};

// ─── badges / pills ───────────────────────────────────────────────────────
const EntityLevelPill = ({ level }) => {
  if (!level) return null;
  const label =
    level === 'ad' ? 'AD' : level === 'adset' ? 'AD-SET' : 'CAMPAIGN';
  return (
    <span className="inline-flex items-center rounded-md border border-white/8 bg-white/5 px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-white/55 uppercase">
      {label}
    </span>
  );
};

// Parent chain breadcrumb under the entity name —
// "Campaign: <name>" + account name on the next line.
const ParentCrumb = ({ row }) => {
  const lines = [];
  if (row.level !== 'campaign' && row.campaignName) {
    lines.push(`Campaign: ${row.campaignName}`);
  }
  if (row.level === 'ad' && row.adsetName) {
    lines.push(row.adsetName);
  }
  if (row.adAccountName) {
    lines.push(row.adAccountName);
  }
  if (!lines.length) return null;
  return (
    <div className="mt-0.5 space-y-0.5">
      {lines.map((l, i) => (
        <div key={i} className="truncate text-10 text-white/65 2xl:text-[11px]">
          {l}
        </div>
      ))}
    </div>
  );
};

const OutcomePill = ({ outcome }) => {
  const map = {
    success: {
      dot: 'bg-emerald-400',
      cls: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400',
    },
    failed: {
      dot: 'bg-red-400',
      cls: 'border-red-500/20 bg-red-500/10 text-red-400',
    },
    skipped: {
      dot: 'bg-white/40',
      cls: 'border-white/15 bg-white/5 text-white/65',
    },
    pending: {
      dot: 'bg-amber-400',
      cls: 'border-amber-500/20 bg-amber-500/10 text-amber-400',
    },
  };
  const c = map[outcome] || map.skipped;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-10 font-medium ${c.cls}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${c.dot}`} />
      {prettify(outcome) || 'Unknown'}
    </span>
  );
};

// ─── derivation helpers ───────────────────────────────────────────────────
// `ruleId` shapes in autopilotActionLog:
//   - 24-char hex     → v4 user rule (Mongo ObjectId)
//   - "LLM-<...>"     → AI Audit apply (e.g. LLM-ADJUST_BUDGET)
//   - "LLM-UNDO_<...>" → AI Audit revert
//   - "AUD-NN"        → legacy v3 audit catalog rule
const isObjectIdLike = (s) =>
  typeof s === 'string' && /^[a-f0-9]{24}$/i.test(s);
const isLlmRuleId = (s) => typeof s === 'string' && s.startsWith('LLM-');
const isLlmUndoRuleId = (s) =>
  typeof s === 'string' && s.startsWith('LLM-UNDO_');

// Action-tone palette. Each entry returns three pieces:
//   bar    — the left-edge accent on the trigger column (slightly muted)
//   iconBg — the icon-tile classes (bg + border together so the tile
//            always renders with a visible outline; the target mock shows
//            every tile bordered, not just filled).
//   iconFg — icon stroke / fill color, kept one tone brighter than the bg
//            so the icon reads even when the row is hovered.
const actionAccent = (action) => {
  switch (action) {
    case 'pause':
      return {
        bar: 'bg-rose-500/45',
        iconBg: 'border border-rose-500/35 bg-rose-500/12',
        iconFg: 'text-rose-300',
      };
    case 'resume':
      return {
        bar: 'bg-emerald-500/45',
        iconBg: 'border border-emerald-500/35 bg-emerald-500/12',
        iconFg: 'text-emerald-300',
      };
    case 'scale_budget':
      return {
        bar: 'bg-emerald-500/45',
        iconBg: 'border border-emerald-500/35 bg-emerald-500/12',
        iconFg: 'text-emerald-300',
      };
    case 'alert_only':
      return {
        bar: 'bg-white/20',
        iconBg: 'border border-white/15 bg-white/[0.05]',
        iconFg: 'text-white/70',
      };
    case 'rotate_creative':
      return {
        bar: 'bg-cyan-500/45',
        iconBg: 'border border-cyan-500/35 bg-cyan-500/12',
        iconFg: 'text-cyan-300',
      };
    case 'rename':
      return {
        bar: 'bg-indigo-500/45',
        iconBg: 'border border-indigo-500/35 bg-indigo-500/12',
        iconFg: 'text-indigo-300',
      };
    default:
      return {
        bar: 'bg-white/20',
        iconBg: 'border border-white/15 bg-white/[0.05]',
        iconFg: 'text-white/60',
      };
  }
};

const ActionIcon = ({ action, className }) => {
  switch (action) {
    case 'pause':
      return <Pause className={className} fill="currentColor" />;
    case 'resume':
      return <Play className={className} fill="currentColor" />;
    case 'scale_budget':
      return <TrendingUp className={className} />;
    case 'alert_only':
      return <Bell className={className} />;
    case 'rotate_creative':
      return <RefreshCw className={className} />;
    case 'rename':
      return <Edit2 className={className} />;
    default:
      return <Sparkles className={className} />;
  }
};

const formatActionTitle = (row) => {
  const lvl =
    row.level === 'adset'
      ? 'ad set'
      : row.level === 'campaign'
        ? 'campaign'
        : 'ad';
  switch (row.action) {
    case 'pause':
      return `Pause ${lvl}`;
    case 'resume':
      return `Resume ${lvl}`;
    case 'scale_budget':
      return 'Budget +';
    case 'alert_only':
      return 'Alert sent';
    case 'rotate_creative':
      return 'Rotate creative';
    case 'rename':
      return 'Rename ad';
    default:
      return prettify(row.action);
  }
};

const formatActionSubtitle = (row) => {
  switch (row.action) {
    case 'pause':
      return 'Pausing under-performer';
    case 'resume':
      return 'Resuming recovered entity';
    case 'scale_budget':
      return 'Scaling winner';
    case 'alert_only':
      return 'Notification only';
    case 'rotate_creative':
      return 'Rotating fatigued creative';
    case 'rename':
      return 'Renaming by hook';
    default:
      return prettify(row.action);
  }
};

const prettify = (s) =>
  s
    ? s
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase())
    : '';

// Best-effort: pull the metric named in `ruleMessage` from the snapshot,
// optionally augmenting with a parsed threshold from the message. Falls
// back to the first useful metric available. The threshold parse is
// pragmatic — only fires when the message follows the catalog pattern
// "<metric> <above|below|>|<> <number>".
const parseRuleThreshold = (msg) => {
  if (!msg) return null;
  const m = msg.match(
    /(roas|ctr|cpi|cpa|cpc|cpm|spend|frequency|impressions|clicks)\s+(above|below|>=|<=|>|<)\s+([\d.,]+%?x?)/i,
  );
  if (!m) return null;
  const opWord = m[2].toLowerCase();
  const op =
    opWord === 'above' || opWord === '>'
      ? '>'
      : opWord === 'below' || opWord === '<'
        ? '<'
        : opWord;
  return { metric: m[1].toLowerCase(), op, threshold: m[3] };
};

const formatTriggerDelta = (row) => {
  const snap = row.metricsSnapshot || {};
  const currency = snap.currency;
  const msg = (row.ruleMessage || '').toLowerCase();
  const fmtFor = (k) => {
    switch (k) {
      case 'roas':
        return (v) => `${Number(v).toFixed(2)}x`;
      case 'ctr':
        return formatPercent;
      case 'frequency':
        return (v) => Number(v).toFixed(2);
      case 'cpi':
      case 'cpa':
      case 'cpc':
      case 'cpm':
      case 'spend':
        return (v) => formatCurrency(v, currency);
      case 'impressions':
      case 'clicks':
      case 'installs':
      case 'purchases':
        return formatNumber;
      default:
        return (v) => String(v);
    }
  };
  const labelFor = (k) =>
    ({
      roas: 'ROAS',
      ctr: 'CTR',
      cpi: 'CPI',
      cpa: 'CPA',
      cpc: 'CPC',
      cpm: 'CPM',
      spend: 'Spend',
      frequency: 'Frequency',
      impressions: 'Impressions',
      clicks: 'Clicks',
    })[k] || k.toUpperCase();

  // Prefer the metric named in the rule.
  let metricKey = null;
  const orderedHints = [
    'roas',
    'cpi',
    'cpa',
    'ctr',
    'frequency',
    'cpc',
    'cpm',
    'spend',
  ];
  for (const k of orderedHints) {
    if (msg.includes(k) && snap[k] != null) {
      metricKey = k;
      break;
    }
  }
  // Fallback: any useful metric.
  if (!metricKey) {
    for (const k of orderedHints) {
      if (snap[k] != null) {
        metricKey = k;
        break;
      }
    }
  }
  if (!metricKey) return '';

  const fmt = fmtFor(metricKey);
  const parsed = parseRuleThreshold(row.ruleMessage);
  if (parsed && parsed.metric === metricKey) {
    return `${labelFor(metricKey)} ${fmt(snap[metricKey])} ${parsed.op} ${parsed.threshold}`;
  }
  return `${labelFor(metricKey)} ${fmt(snap[metricKey])}`;
};

const formatRuleLabel = (row) => {
  // Prefer human-readable ruleMessage. If ruleId is the catalog "AUD-NN" or
  // similar, show it when no message is available. Hide ObjectIds and
  // LLM-* tokens — those are technical, the AI chip already calls them out.
  if (row.ruleMessage) return row.ruleMessage;
  if (
    typeof row.ruleId === 'string' &&
    !isObjectIdLike(row.ruleId) &&
    !isLlmRuleId(row.ruleId)
  ) {
    return row.ruleId;
  }
  return 'Unnamed rule';
};

// ─── formatters ───────────────────────────────────────────────────────────
const formatDate = (s) => {
  if (!s) return '—';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

const formatTime = (s) => {
  if (!s) return '';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
};

const formatCurrency = (v, currency, big = false) => {
  if (v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const symbol =
    currency === 'INR'
      ? '₹'
      : currency === 'USD'
        ? '$'
        : currency === 'EUR'
          ? '€'
          : '';
  if (big) {
    return `${symbol}${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  }
  const abs = Math.abs(n);
  const body =
    abs >= 100000
      ? `${(n / 1000).toFixed(0)}k`
      : abs >= 10000
        ? `${(n / 1000).toFixed(1)}k`
        : abs >= 100
          ? n.toFixed(0)
          : n.toFixed(2);
  return `${symbol}${body}`;
};

const formatPercent = (v) => {
  if (v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return `${n.toFixed(2)}%`;
};

const formatNumber = (v) => {
  if (v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return n.toLocaleString();
};

const buildAdsManagerUrl = (row) => {
  if (!row.adAccountId || !row.entityId) return null;
  const acct = String(row.adAccountId).replace(/^act_/, '');
  const idKey =
    row.level === 'campaign'
      ? 'selected_campaign_ids'
      : row.level === 'adset'
        ? 'selected_adset_ids'
        : 'selected_ad_ids';
  return `https://adsmanager.facebook.com/adsmanager/manage/?act=${acct}&${idKey}=${row.entityId}`;
};

export default AutopilotActionLog;
