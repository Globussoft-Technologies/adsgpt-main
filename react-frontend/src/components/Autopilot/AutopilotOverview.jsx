import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Zap,
  Shield,
  CheckSquare,
  FlaskConical,
  TrendingUp,
  TrendingDown,
  Clock,
  ArrowRight,
  Loader2,
  Power,
  AlertCircle,
} from 'lucide-react';
import {
  runAutopilotCycle,
  getAutopilotSummary,
  getActionLog,
  listUserRules,
} from '@/apis/autopilot/autopilotApi';
import { Section, Banner, SecondaryButton } from './_atoms';

/**
 * Overview tab — windowed activity dashboard.
 *
 * Layout (top→bottom):
 *   1. Activity summary header + window selector (7 / 14 / 30 days)
 *   2. 4 KPI cards: Actions taken (with prior-period delta) · Budget protected
 *      · Success rate · Rules active
 *   3. 3 status cards: System status · Next scheduled run · Last action
 *   4. Two-column row: stacked daily activity bar chart · top firing rules
 *   5. Per-account breakdown table with per-row drill-in
 *   6. Run-my-rules-now card with Dry-run / Live mode toggle
 *
 * Data sourcing strategy:
 *   - `/summary` called twice (current + double window) so we can derive the
 *     prior-period delta without a server change. Backend gap doc lists
 *     `prior_total` as a nice-to-have. The current-window `/summary` also
 *     carries `by_day` — the per-UTC-day rollup that feeds the activity
 *     chart (computed server-side over the whole window, so the chart is
 *     never truncated by the `/log` pagination cap).
 *   - `/log` feeds the "Last action" card and the per-account enrichment.
 *   - `/rules` feeds the active-rules KPI.
 */
const AutopilotOverview = ({
  adAccounts,
  liveActionsAllowed = false,
  // Resolved 'off' | 'dry-run' | 'live' status from the parent page.
  // Falls back to deriving from `liveActionsAllowed` for legacy callers
  // that don't pass it yet.
  autopilotStatus,
  onOpenActionLog,
} = {}) => {
  const accountList = adAccounts || [];

  // ─── window + summary ───────────────────────────────────────────────────
  const [windowDays, setWindowDays] = useState(7);
  const [summary, setSummary] = useState(null);
  const [priorTotal, setPriorTotal] = useState(null);
  const [logRows, setLogRows] = useState([]);
  const [activeRulesCount, setActiveRulesCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async (days) => {
    setLoading(true);
    setError(null);
    try {
      const fromIso = new Date(Date.now() - days * 86_400_000).toISOString();
      const [sum, sumDouble, log, rules] = await Promise.all([
        getAutopilotSummary({ windowDays: days }),
        getAutopilotSummary({ windowDays: days * 2 }).catch(() => null),
        getActionLog({ from: fromIso, page: 1, limit: 500 }).catch(() => ({
          rows: [],
        })),
        listUserRules().catch(() => null),
      ]);
      setSummary(sum);
      // Prior-period total = (doubled-window total) - (current-window total).
      // Falls back to null if the second call failed.
      if (sumDouble && typeof sumDouble.total === 'number') {
        setPriorTotal(Math.max(0, (sumDouble.total || 0) - (sum?.total || 0)));
      } else {
        setPriorTotal(null);
      }
      setLogRows(Array.isArray(log?.rows) ? log.rows : []);
      const rs = Array.isArray(rules?.rules) ? rules.rules : [];
      setActiveRulesCount(rs.filter((r) => r.enabled).length);
    } catch (e) {
      setError(e?.response?.data?.error || e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(windowDays);
  }, [load, windowDays]);

  // ─── derived stats ──────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const total = summary?.total ?? 0;
    const ba = summary?.by_action || {};
    const pauses = ba.pause?.success ?? 0;
    const alerts = ba.alert_only?.success ?? 0;
    const scales = ba.scale_budget?.success ?? 0;
    const renames = ba.rename?.success ?? 0;

    const successes =
      (ba.pause?.success || 0) +
      (ba.resume?.success || 0) +
      (ba.scale_budget?.success || 0) +
      (ba.rename?.success || 0) +
      (ba.rotate_creative?.success || 0) +
      (ba.alert_only?.success || 0);
    const successRate = total > 0 ? Math.round((successes / total) * 100) : 0;

    let deltaPct = null;
    let deltaSign = 'flat';
    if (priorTotal != null) {
      if (priorTotal === 0) {
        deltaPct = total > 0 ? 100 : 0;
        deltaSign = total > 0 ? 'up' : 'flat';
      } else {
        deltaPct = Math.round(((total - priorTotal) / priorTotal) * 100);
        deltaSign = deltaPct > 0 ? 'up' : deltaPct < 0 ? 'down' : 'flat';
      }
    }

    // Budget-protected feature — commented out per product decision.
    // Re-enable by uncommenting this block + the `budgetProtected`/`currency`
    // return fields + the `<KpiCard label="Budget protected" />` JSX below.
    // let budgetProtected = 0;
    // let currency = null;
    // for (const r of logRows) {
    //   if (r.action === 'pause' && r.metricsSnapshot?.spend) {
    //     budgetProtected += Number(r.metricsSnapshot.spend) || 0;
    //     currency = currency || r.metricsSnapshot.currency;
    //   }
    // }

    return {
      total,
      pauses,
      alerts,
      scales,
      renames,
      successes,
      successRate,
      deltaPct,
      deltaSign,
      // budgetProtected,
      // currency,
      accountCount: summary?.by_account?.length || accountList.length || 0,
    };
  }, [summary, priorTotal, logRows, accountList.length]);

  const lastAction = logRows[0] || null;

  // ─── run-now ────────────────────────────────────────────────────────────
  const [runMode, setRunMode] = useState('dry');
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState(null);
  const [cycleResult, setCycleResult] = useState(null);

  // If the global flag flips off mid-session, force back to dry-run.
  useEffect(() => {
    if (!liveActionsAllowed && runMode === 'live') setRunMode('dry');
  }, [liveActionsAllowed, runMode]);

  const runCycle = async () => {
    setRunning(true);
    setRunError(null);
    setCycleResult(null);
    try {
      const res = await runAutopilotCycle({ dryRun: runMode === 'dry' });
      setCycleResult(res);
      load(windowDays);
    } catch (e) {
      setRunError(e?.response?.data?.error || e.message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex w-full flex-col gap-4 px-4 py-5 sm:px-5 sm:py-6 lg:px-6 2xl:py-8">
      {/* Activity summary header */}
      <SummaryHeader
        accountCount={stats.accountCount}
        windowDays={windowDays}
        onWindowChange={setWindowDays}
        loading={loading}
      />

      {error && <Banner variant="error">{error}</Banner>}

      {/* KPI cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard
          icon={Zap}
          tone="cyan"
          label="Actions taken"
          value={stats.total.toLocaleString()}
          sub={
            stats.deltaPct != null ? (
              <DeltaChip sign={stats.deltaSign} pct={stats.deltaPct} />
            ) : (
              'vs prior period —'
            )
          }
        />
        {/* Budget protected — commented out per product decision. Re-enable
            by uncommenting this card + the `budgetProtected`/`currency`
            stats block above. */}
        {/*
        <KpiCard
          icon={Shield}
          tone="emerald"
          label="Budget protected"
          value={
            <span className="text-emerald-400">
              {formatCurrency(stats.budgetProtected, stats.currency, true)}
            </span>
          }
          sub={`Spend on paused entities · ${stats.pauses.toLocaleString()} pauses`}
        />
        */}
        <KpiCard
          icon={CheckSquare}
          tone="lime"
          label="Success rate"
          value={`${stats.successRate}%`}
          sub={`${stats.successes.toLocaleString()} of ${stats.total.toLocaleString()} actions completed cleanly`}
        />
        <KpiCard
          icon={FlaskConical}
          tone="indigo"
          label="Rules active"
          value={activeRulesCount.toLocaleString()}
          sub={`${(summary?.top_rules?.length || 0).toLocaleString()} fired in this window`}
        />
      </div>

      {/* Status row */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatusCard
          label="Status"
          value={(() => {
            // Resolve from the parent-supplied status when present; fall
            // back to the legacy env-only derivation otherwise.
            const status =
              autopilotStatus ||
              (liveActionsAllowed ? 'live' : 'dry-run');
            if (status === 'live') {
              return (
                <span className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-emerald-400" />
                  <span className="text-emerald-300">Live</span>
                </span>
              );
            }
            if (status === 'dry-run') {
              return (
                <span className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-amber-400" />
                  <span className="text-amber-300">Dry-run</span>
                </span>
              );
            }
            // 'off'
            return (
              <span className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-white/40" />
                <span className="text-white/65">Autopilot off</span>
              </span>
            );
          })()}
          sub={
            autopilotStatus === 'off'
              ? 'No actions will run — toggle on in Settings'
              : autopilotStatus === 'dry-run'
                ? 'Evaluating rules, not modifying Meta'
                : 'All systems operating'
          }
        />
        <NextRunCard
          lastRunAt={lastAction?.runAt || lastAction?.createdAt}
        />
        <StatusCard
          label="Last action"
          value={lastAction ? timeAgo(lastAction.runAt || lastAction.createdAt) : '—'}
          sub={
            lastAction
              ? lastAction.entityName || lastAction.adAccountName || '—'
              : 'No actions recorded yet'
          }
        />
      </div>

      {/* Activity over time + Top firing rules */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <Section>
            <ChartHeader
              title="Activity over time"
              subtitle="Daily actions, stacked by type"
              legend={[
                { label: 'Pause', color: 'bg-rose-400' },
                { label: 'Alert', color: 'bg-cyan-400' },
                { label: 'Budget +', color: 'bg-emerald-400' },
              ]}
            />
            <ActivityChart
              byDay={summary?.by_day}
              windowDays={windowDays}
            />
          </Section>
        </div>
        <div className="lg:col-span-2">
          <Section className="h-full">
            <div className="flex h-full flex-col">
              <ChartHeader
                title="Top firing rules"
                subtitle="Most-triggered in the window"
              />
              <div className="flex-1">
                <TopRulesList rules={summary?.top_rules || []} />
              </div>
            </div>
          </Section>
        </div>
      </div>

      {/* Per-account breakdown */}
      <Section className="overflow-hidden p-0!">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-4 py-3">
          <div>
            <h3 className="text-sm font-bold text-white 2xl:text-15">
              Per-account breakdown
            </h3>
            <p className="mt-0.5 text-xs text-white/70 2xl:text-13">
              What Autopilot did, by ad account
            </p>
          </div>
          {onOpenActionLog && (
            <SecondaryButton onClick={onOpenActionLog}>
              Open Action log <ArrowRight className="h-3 w-3" />
            </SecondaryButton>
          )}
        </div>
        <PerAccountTable
          accounts={summary?.by_account || []}
          logRows={logRows}
          onOpenActionLog={onOpenActionLog}
          loading={loading}
        />
      </Section>

      {/* Run my rules now */}
      <Section className="p-4!">
        <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-white 2xl:text-15">Run my rules now</h3>
            <p className="mt-0.5 text-xs text-white/70 2xl:text-13">
              Preview what Autopilot would do across every campaign right now.
              Dry-run is safe and changes nothing on Meta.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <RunModeToggle
              mode={runMode}
              onChange={setRunMode}
              liveAllowed={liveActionsAllowed}
            />
            <button
              type="button"
              onClick={runCycle}
              disabled={running}
              className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold transition-all disabled:opacity-50 2xl:px-4 2xl:py-2.5 2xl:text-13 ${
                runMode === 'live'
                  ? 'bg-linear-to-r from-emerald-400 to-emerald-500 text-black hover:opacity-90'
                  : 'bg-linear-to-r from-[#15DCFF] to-[#6b72f8] text-black hover:opacity-90'
              }`}
            >
              {running ? (
                <Loader2 className="h-3 w-3 animate-spin 2xl:h-3.5 2xl:w-3.5" />
              ) : (
                <Power className="h-3 w-3 2xl:h-3.5 2xl:w-3.5" />
              )}
              {running ? 'Running…' : 'Run now'}
            </button>
          </div>
        </div>
        {runMode === 'live' && (
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-300">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Live mode will apply real changes to Meta for every matching
              campaign. Switch to Dry-run for a safe preview.
            </span>
          </div>
        )}
        {runError && (
          <div className="mt-3">
            <Banner variant="error">{runError}</Banner>
          </div>
        )}
        {cycleResult && <CycleResultTable result={cycleResult} />}
      </Section>
    </div>
  );
};

// ─── header ─────────────────────────────────────────────────────────────────
const SummaryHeader = ({ accountCount, windowDays, onWindowChange, loading }) => {
  const options = [
    { value: 7, label: 'Last 7 days' },
    { value: 14, label: 'Last 14 days' },
    { value: 30, label: 'Last 30 days' },
  ];
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-bold text-white 2xl:text-lg">Activity summary</h2>
          {loading && (
            <Loader2 className="h-3 w-3 animate-spin text-white/40" />
          )}
        </div>
        <p className="mt-1 text-xs text-white/70 2xl:text-13">
          Across {accountCount} account{accountCount === 1 ? '' : 's'} in the
          selected window
        </p>
      </div>
      <div className="inline-flex rounded-xl border border-white/10 bg-[#1A2027] p-1">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onWindowChange(o.value)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all 2xl:px-3.5 2xl:py-2 2xl:text-13 ${
              windowDays === o.value
                ? 'bg-white/10 text-white'
                : 'text-white/70 hover:text-white'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
};

// ─── KPI card ──────────────────────────────────────────────────────────────
const KpiCard = ({ icon: Icon, tone = 'cyan', label, value, sub }) => {
  const toneCls =
    tone === 'emerald'
      ? 'text-emerald-400 bg-emerald-400/10'
      : tone === 'lime'
        ? 'text-lime-300 bg-lime-400/10'
        : tone === 'indigo'
          ? 'text-indigo-300 bg-indigo-400/10'
          : 'text-[#15DCFF] bg-[#15DCFF]/10';
  return (
    <div className="rounded-2xl border border-white/10 bg-[#14181D] p-4 backdrop-blur-xl transition-colors hover:border-white/15 2xl:p-5">
      <div className="flex items-start justify-between gap-2">
        <div className="text-10 font-bold tracking-wider text-white/55 uppercase 2xl:text-[11px]">
          {label}
        </div>
        {Icon && (
          <div className={`flex h-8 w-8 items-center justify-center rounded-lg 2xl:h-10 2xl:w-10 ${toneCls}`}>
            <Icon className="h-4 w-4 2xl:h-5 2xl:w-5" />
          </div>
        )}
      </div>
      <div className="mt-0 text-2xl font-bold text-white 2xl:text-[28px]">{value}</div>
      <div className="mt-1.5 text-10 text-white/70 2xl:text-xs">{sub}</div>
    </div>
  );
};

const DeltaChip = ({ sign, pct }) => {
  const isUp = sign === 'up';
  const isDown = sign === 'down';
  const cls = isUp
    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
    : isDown
      ? 'border-red-500/30 bg-red-500/10 text-red-400'
      : 'border-white/10 bg-white/5 text-white/55';
  const Icon = isUp ? TrendingUp : isDown ? TrendingDown : null;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-10 font-bold 2xl:text-[11px] ${cls}`}
      >
        {Icon && <Icon className="h-3 w-3" />}
        {Math.abs(pct)}%
      </span>
      <span className="text-white/70 2xl:text-xs">vs prior period</span>
    </span>
  );
};

// ─── status cards ──────────────────────────────────────────────────────────
const StatusCard = ({ label, value, sub }) => (
  <div className="rounded-2xl border border-white/10 bg-[#14181D] p-4 backdrop-blur-xl 2xl:p-5">
    <div className="text-10 font-bold tracking-wider text-white/55 uppercase 2xl:text-[11px]">
      {label}
    </div>
    <div className="mt-1.5 text-base font-bold text-white 2xl:text-[17px]">{value}</div>
    <div className="mt-1.5 truncate text-10 text-white/70 2xl:text-xs">{sub}</div>
  </div>
);

// Next scheduled run.
//
// Previously hardcoded "next run = next top of the hour", which only
// holds if AUTOPILOT_CRON env is `0 * * * *`. Production uses other
// schedules (e.g. `30 * * * *`), so the prediction was consistently
// wrong by whatever the minute-offset is.
//
// Now we derive from the most recent action-log row's `runAt`:
// next_run = lastRunAt + 1h, recomputed when `lastRunAt` rolls forward.
// This adapts to whatever hourly minute-offset the cron is configured
// for, with no backend changes. Limitation: only correct for HOURLY
// cron patterns — if cadence changes (e.g. every-15min), expose
// AUTOPILOT_CRON via /config and parse it instead.
//
// Fallback: when there's no last-run yet (fresh tenant, no actions
// recorded), fall back to the next top-of-hour as a best-effort guess.
const CRON_INTERVAL_MS = 60 * 60 * 1000; // hourly
const NextRunCard = ({ lastRunAt }) => {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  // Compute next run. If a last-run timestamp exists, roll forward by
  // CRON_INTERVAL_MS until we land in the future — guards against
  // showing a stale "next run was 3h ago" if the dashboard sat open
  // through several cron ticks without auto-refresh.
  let next;
  if (lastRunAt) {
    const last = new Date(lastRunAt);
    if (!Number.isNaN(last.getTime())) {
      next = new Date(last.getTime() + CRON_INTERVAL_MS);
      while (next.getTime() <= now.getTime()) {
        next = new Date(next.getTime() + CRON_INTERVAL_MS);
      }
    }
  }
  if (!next) {
    // No last-run reference — fall back to next top-of-hour. Wrong if
    // the cron is offset, but we have nothing better to anchor on.
    next = new Date(now);
    next.setHours(now.getHours() + 1, 0, 0, 0);
  }

  const minsUntil = Math.max(0, Math.round((next - now) / 60_000));
  const timeLabel = next.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
  return (
    <div className="rounded-2xl border border-white/10 bg-[#14181D] p-4 backdrop-blur-xl 2xl:p-5">
      <div className="text-10 font-bold tracking-wider text-white/55 uppercase 2xl:text-[11px]">
        Next scheduled run
      </div>
      <div className="mt-1.5 flex items-center gap-2 text-base font-bold text-white 2xl:text-[17px]">
        <Clock className="h-3.5 w-3.5 text-[#15DCFF] 2xl:h-4 2xl:w-4" />
        {timeLabel}
      </div>
      <div className="mt-1.5 text-10 text-white/70 2xl:text-xs">
        in {minsUntil} min · every hour
      </div>
    </div>
  );
};

// ─── chart header ──────────────────────────────────────────────────────────
const ChartHeader = ({ title, subtitle, legend }) => (
  <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
    <div>
      <h3 className="text-sm font-bold text-white 2xl:text-15">{title}</h3>
      {subtitle && <p className="mt-0.5 text-xs text-white/70 2xl:text-13">{subtitle}</p>}
    </div>
    {legend && (
      <div className="flex flex-wrap gap-3">
        {legend.map((l) => (
          <div key={l.label} className="flex items-center gap-1.5 text-10 text-white/70 2xl:text-xs">
            <span className={`h-2 w-2 rounded-full ${l.color}`} />
            {l.label}
          </div>
        ))}
      </div>
    )}
  </div>
);

// ─── activity chart (stacked daily bars) ──────────────────────────────────
// Fed by `/summary`'s `by_day` rollup — a per-UTC-day breakdown computed
// server-side over the entire window. Previously this bucketed the `/log`
// rows client-side, but `/log` is paginated + limit-capped at 100, so on
// busy accounts the chart only ever saw the most-recent few days. `by_day`
// covers every day in the window regardless of action volume.
const ActivityChart = ({ byDay, windowDays }) => {
  const buckets = useMemo(() => {
    const map = new Map();
    // Pre-seed the full window with UTC calendar days so zero-action days
    // still render as empty bars. Keys are 'YYYY-MM-DD' to match the
    // backend's UTC `by_day` keys exactly.
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    for (let i = windowDays - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setUTCDate(today.getUTCDate() - i);
      const key = d.toISOString().slice(0, 10);
      map.set(key, { date: d, pause: 0, alert: 0, budget: 0 });
    }
    for (const day of byDay || []) {
      const b = map.get(day.date);
      if (!b) continue;
      const ba = day.by_action || {};
      b.pause = ba.pause || 0;
      b.alert = ba.alert_only || 0;
      b.budget = ba.scale_budget || 0;
    }
    return Array.from(map.values());
  }, [byDay, windowDays]);

  const max = Math.max(
    1,
    ...buckets.map((b) => b.pause + b.alert + b.budget),
  );
  // Show date labels only on the first day of the window, every Nth day,
  // and the most-recent day so the axis stays readable at any window size.
  const labelStep = Math.max(1, Math.ceil(buckets.length / 7));

  return (
    <div>
      {/* `items-stretch` (default) lets each bucket fill the 11rem parent
          height, so the bar's percent-height inside resolves against the
          full chart area instead of the bucket's tiny auto content size.
          Prior `items-end` was collapsing the bars to a few pixels. */}
      <div className="flex h-44 gap-1 sm:gap-2">
        {buckets.map((b, idx) => {
          const total = b.pause + b.alert + b.budget;
          const heightPct = total ? Math.max(4, (total / max) * 100) : 0;
          const segPct = (n) => (total ? (n / total) * 100 : 0);
          return (
            <div
              key={idx}
              className="group relative flex h-full flex-1 flex-col items-center justify-end"
              title={`${b.date.toLocaleDateString()}\nPause: ${b.pause}  Alert: ${b.alert}  Budget+: ${b.budget}`}
            >
              <div
                className={`text-10 font-medium 2xl:text-[11px] ${total ? 'text-white' : 'text-white/25'}`}
              >
                {total || ''}
              </div>
              <div
                className="mt-1 flex w-full max-w-[36px] flex-col overflow-hidden rounded-md transition-transform group-hover:scale-y-[1.02]"
                style={{ height: `${heightPct}%`, minHeight: total ? 4 : 0 }}
              >
                {b.budget > 0 && (
                  <div
                    className="bg-emerald-400"
                    style={{ height: `${segPct(b.budget)}%` }}
                  />
                )}
                {b.alert > 0 && (
                  <div
                    className="bg-cyan-400"
                    style={{ height: `${segPct(b.alert)}%` }}
                  />
                )}
                {b.pause > 0 && (
                  <div
                    className="bg-rose-400"
                    style={{ height: `${segPct(b.pause)}%` }}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex gap-1 sm:gap-2">
        {buckets.map((b, idx) => {
          const showLabel =
            idx === 0 ||
            idx === buckets.length - 1 ||
            idx % labelStep === 0;
          return (
            <div
              key={idx}
              className="flex flex-1 justify-center truncate text-10 text-white/55 2xl:text-[11px]"
            >
              {showLabel
                ? b.date.toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                  })
                : ''}
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ─── top firing rules (horizontal bars) ───────────────────────────────────
const RULE_BAR_TONES = [
  'bg-amber-300',
  'bg-rose-300',
  'bg-yellow-200',
  'bg-cyan-300',
  'bg-violet-300',
  'bg-rose-400',
];

const TopRulesList = ({ rules }) => {
  if (!rules.length) {
    return (
      <div className="flex h-full min-h-45 items-center justify-center rounded-xl border border-white/10 bg-white/3 p-3 text-center text-xs text-white/55 2xl:min-h-50 2xl:text-13">
        No rules have fired in this window.
      </div>
    );
  }
  const max = Math.max(1, ...rules.map((r) => r.count || 0));
  return (
    <div className="flex flex-col gap-3">
      {rules.slice(0, 6).map((r, idx) => {
        const isObjectId = /^[a-f0-9]{24}$/i.test(r.ruleId || '');
        const label = isObjectId
          ? r.name || r.ruleMessage || 'Unnamed rule'
          : r.ruleId;
        const pct = ((r.count || 0) / max) * 100;
        return (
          <div key={`${r.ruleId}-${idx}`} className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${RULE_BAR_TONES[idx % RULE_BAR_TONES.length]}`}
                />
                <span className="truncate text-xs text-white 2xl:text-13">{label}</span>
              </div>
              <span className="shrink-0 text-xs font-bold text-white 2xl:text-13">
                {r.count}
              </span>
            </div>
            <div className="h-1 w-full overflow-hidden rounded-full bg-white/5">
              <div
                className={`h-full rounded-full ${RULE_BAR_TONES[idx % RULE_BAR_TONES.length]}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
};

// ─── per-account table ────────────────────────────────────────────────────
const PerAccountTable = ({
  accounts,
  logRows,
  onOpenActionLog,
  loading,
}) => {
  // Pre-compute per-account "saved" + "last action" from the loaded log
  // rows so we don't need another roundtrip. Backend gap doc lists these
  // as nice-to-haves on /summary.by_account.
  const enrichments = useMemo(() => {
    const map = new Map();
    for (const r of logRows) {
      const id = r.adAccountId;
      if (!id) continue;
      const e = map.get(id) || { lastAt: null, lastRow: null };
      const at = r.runAt || r.createdAt;
      if (at && (!e.lastAt || new Date(at) > new Date(e.lastAt))) {
        e.lastAt = at;
        e.lastRow = r;
      }
      map.set(id, e);
    }
    return map;
  }, [logRows]);

  if (loading && !accounts.length) {
    return (
      <div className="p-8 text-center">
        <Loader2 className="mx-auto h-4 w-4 animate-spin text-white/40" />
      </div>
    );
  }
  if (!accounts.length) {
    return (
      <div className="p-8 text-center text-xs text-white/70 2xl:text-13">
        No actions in this window. Run a dry-run below to populate.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[820px] text-xs 2xl:text-13">
        <thead>
          <tr className="border-b border-white/10 bg-white/2 text-left">
            <Th>Account</Th>
            <Th>Total</Th>
            <Th tone="rose">Pause</Th>
            <Th tone="cyan">Alert</Th>
            <Th>Last action</Th>
            <Th>{''}</Th>
          </tr>
        </thead>
        <tbody>
          {(() => {
            // Max total across accounts — TOTAL column's progress bar
            // scales relative to this so the eye can compare the heaviest
            // vs lightest account at a glance.
            const maxTotal = Math.max(1, ...accounts.map((a) => a.total || 0));
            return accounts.map((a) => {
              const total = a.total || 0;
              const pause = a.by_action?.pause || 0;
              const alert = a.by_action?.alert_only || 0;
              const pct = (n) => (total ? Math.round((n / total) * 100) : 0);
              const enrich = enrichments.get(a.adAccountId) || {};
              return (
                <tr
                  key={a.adAccountId}
                  className="border-b border-white/10 align-top last:border-b-0 hover:bg-white/3"
                >
                <td className="px-3 py-3">
                  <div className="text-xs font-bold text-white 2xl:text-13">
                    {a.adAccountName || '(unnamed)'}
                  </div>
                  <div className="font-mono text-10 text-white/55 2xl:text-[11px]">
                    {a.adAccountId}
                  </div>
                </td>
                <CountCell
                  value={total}
                  pct={Math.round((total / maxTotal) * 100)}
                  tone="cyan"
                  hidePct
                />
                <CountCell value={pause} pct={pct(pause)} tone="rose" />
                <CountCell value={alert} pct={pct(alert)} tone="cyan" />
                <td className="px-3 py-3 text-xs whitespace-nowrap text-white/85 2xl:text-13">
                  {enrich.lastAt ? (
                    <>
                      <div className="font-medium">
                        {new Date(enrich.lastAt).toLocaleString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                      </div>
                      <div className="text-10 text-white/60 2xl:text-[11px]">
                        {timeAgo(enrich.lastAt)}
                      </div>
                    </>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="px-3 py-3 text-right">
                  {onOpenActionLog && (
                    <SecondaryButton
                      onClick={() => onOpenActionLog(a.adAccountId)}
                    >
                      View <ArrowRight className="h-3 w-3" />
                    </SecondaryButton>
                  )}
                </td>
              </tr>
              );
            });
          })()}
        </tbody>
      </table>
    </div>
  );
};

const Th = ({ children, tone }) => {
  const toneCls =
    tone === 'rose'
      ? 'text-rose-300'
      : tone === 'cyan'
        ? 'text-cyan-300'
        : tone === 'emerald'
          ? 'text-emerald-300'
          : 'text-white/60';
  return (
    <th
      className={`px-3 py-2.5 text-10 font-bold tracking-wider uppercase 2xl:py-3 2xl:text-[11px] ${toneCls}`}
    >
      {children}
    </th>
  );
};

const CountCell = ({ value, pct, tone = 'white', hidePct = false }) => {
  const accent =
    tone === 'rose'
      ? { fg: 'text-rose-300', bar: 'bg-rose-400' }
      : tone === 'cyan'
        ? { fg: 'text-cyan-300', bar: 'bg-cyan-400' }
        : tone === 'emerald'
          ? { fg: 'text-emerald-300', bar: 'bg-emerald-400' }
          : { fg: 'text-white', bar: 'bg-white/60' };
  const showBar = pct != null && pct > 0;
  return (
    <td className="px-3 py-3">
      <div className="flex items-baseline gap-1.5">
        <span className={`text-base font-bold 2xl:text-[17px] ${accent.fg}`}>
          {value.toLocaleString()}
        </span>
        {!hidePct && pct != null && pct > 0 && (
          <span className="text-10 font-medium text-white/70 2xl:text-[11px]">{pct}%</span>
        )}
      </div>
      {showBar && (
        <div className="mt-1.5 h-[2px] w-full overflow-hidden rounded-full bg-white/[0.05]">
          <div
            className={`h-full ${accent.bar}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </td>
  );
};

// ─── run-mode toggle ──────────────────────────────────────────────────────
const RunModeToggle = ({ mode, onChange, liveAllowed }) => (
  <div className="inline-flex items-center rounded-xl border border-white/10 bg-[#1A2027] p-1 text-xs 2xl:text-13">
    <button
      type="button"
      onClick={() => onChange('dry')}
      className={`rounded-lg px-3 py-1.5 font-medium transition-all 2xl:px-3.5 2xl:py-2 ${
        mode === 'dry'
          ? 'border border-[#15DCFF]/30 bg-[#15DCFF]/10 text-[#15DCFF]'
          : 'border border-transparent text-white/70 hover:text-white'
      }`}
    >
      Dry-run
    </button>
    <button
      type="button"
      onClick={() => liveAllowed && onChange('live')}
      disabled={!liveAllowed}
      title={
        liveAllowed
          ? 'Apply real changes to Meta'
          : 'Live mode disabled by environment'
      }
      className={`rounded-lg px-3 py-1.5 font-medium transition-all 2xl:px-3.5 2xl:py-2 ${
        mode === 'live'
          ? 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
          : 'border border-transparent text-white/70 hover:text-white disabled:opacity-40 disabled:hover:text-white/70'
      }`}
    >
      Live
    </button>
  </div>
);

// ─── cycle result (compact summary after Run now) ────────────────────────
const CycleResultTable = ({ result }) => {
  const accounts = result?.accounts || [];
  return (
    <div className="mt-3 rounded-xl border border-white/10 bg-white/3 p-3 2xl:p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-10 text-white/65 2xl:text-[11px]">
        <span>
          run id:{' '}
          <code className="font-mono text-white/85">{result.runId || '—'}</code>
        </span>
        <span>·</span>
        <span>duration: {result.durationMs ?? '—'} ms</span>
        <span>·</span>
        <span>mode: {result.dryRun ? 'dry-run' : 'live'}</span>
      </div>
      {accounts.length === 0 ? (
        <div className="py-2 text-center text-xs text-white/70 2xl:text-13">
          No accounts processed.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-white/10">
          <table className="w-full text-xs 2xl:text-13">
            <thead>
              <tr className="border-b border-white/10 bg-white/2 text-left">
                <Th>Account</Th>
                <Th>Findings</Th>
                <Th>Would pause</Th>
                <Th>Would resume</Th>
                <Th>Failed</Th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => {
                const failed =
                  (a.pause?.failed ?? 0) + (a.resume?.failed ?? 0);
                return (
                  <tr
                    key={a.adAccountId}
                    className="border-b border-white/10 last:border-b-0 hover:bg-white/2"
                  >
                    <td className="px-3 py-2">
                      <div className={`font-medium ${a.ok ? 'text-white' : 'text-red-400'}`}>
                        {a.name || a.adAccountId}
                      </div>
                      {a.error && (
                        <div className="text-10 text-red-400 2xl:text-[11px]">{a.error}</div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-white/85">
                      {a.pause?.findings_count ?? '–'}
                    </td>
                    <td className="px-3 py-2 text-white/85">
                      {a.pause?.would_pause ?? '–'}
                    </td>
                    <td className="px-3 py-2 text-white/85">
                      {a.resume?.would_resume ?? '–'}
                    </td>
                    <td
                      className={`px-3 py-2 ${failed ? 'text-red-400' : 'text-white/85'}`}
                    >
                      {failed}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

// ─── helpers ──────────────────────────────────────────────────────────────
const timeAgo = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const secs = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
};

const formatCurrency = (v, currency, big = false) => {
  if (v == null) return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
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

export default AutopilotOverview;
