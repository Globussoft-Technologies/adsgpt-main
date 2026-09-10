/**
 * Autopilot runs — what the hourly cron is doing right now, and what every
 * previous tick cost.
 *
 * WHY POLLING AND NOT A WEBSOCKET. Autopilot fires once an hour and runs for
 * minutes. At human scale a 3-second poll and a push socket are
 * indistinguishable, and polling has a property push does not: it is
 * process-agnostic. The worker writes to Mongo and this page reads Mongo, so
 * the feature survives Autopilot moving into its own process. A socket would
 * not — a worker has no `global.io` and would need a Redis bridge designed in
 * lockstep with that move.
 *
 * THE SERVER DICTATES THE INTERVAL. `pollMs` comes back in the payload: fast
 * while a cycle is in flight, slow when idle. Hard-coding 3s here would mean
 * polling a once-hourly job every three seconds for the fifty-seven minutes it
 * is doing nothing.
 *
 * "RUNNING" IS NOT THE SAME AS "ALIVE". A cycle that dies mid-flight never
 * gets to write `status: failed`, so it stays `running` forever while its lock
 * blocks the next hour. The server therefore also reports heartbeat age, and
 * this page surfaces a stalled run as its own state — that specific confusion
 * is what the page exists to remove.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  Lock,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  Timer,
} from "lucide-react";
import StatCard from "@/components/StatCard.jsx";
import Badge from "@/components/Badge.jsx";
import MetaOpsTabs from "@/components/MetaOpsTabs.jsx";
import DateRangePicker from "@/components/DateRangePicker.jsx";
import { getStoredDateRange, setStoredDateRange } from "@/lib/dateRangeStore";
import { adminApi } from "@/lib/api";
import { formatNumber } from "@/lib/utils";

const IDLE_POLL_MS = 30000;

function fmtDuration(ms) {
  if (ms == null || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s % 60);
  return `${m}m ${String(rem).padStart(2, "0")}s`;
}

function fmtClock(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function fmtAgo(ms) {
  if (ms == null) return "—";
  if (ms < 1000) return "just now";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s ago`;
}

/**
 * "2 paused" / "2 would pause" for one account or run.
 *
 * Live and dry-run counts are separate fields, so a rehearsal shows what it
 * WOULD do instead of the zeroes an idle cycle shows. Returns null when
 * nothing happened, so callers can render a dash rather than "0 paused".
 */
function actionSummary(src) {
  if (!src) return null;
  const live = [
    [src.paused, "paused"],
    [src.resumed, "resumed"],
    [src.scaled, "scaled"],
  ].filter(([n]) => n > 0);
  const dry = [
    [src.wouldPause, "pause"],
    [src.wouldResume, "resume"],
    [src.wouldScale, "scale"],
  ].filter(([n]) => n > 0);
  if (live.length) {
    return { dry: false, text: live.map(([n, w]) => `${n} ${w}`).join(" · ") };
  }
  if (dry.length) {
    return { dry: true, text: dry.map(([n, w]) => `would ${w} ${n}`).join(" · ") };
  }
  return null;
}

const STATUS_TONE = {
  running: "sky",
  complete: "emerald",
  failed: "rose",
  skipped: "slate",
};

const OUTCOME_TONE = {
  ok: "emerald",
  failed: "rose",
  timeout: "amber",
  "rate-limited": "violet",
};

function StatusBadge({ run }) {
  if (!run) return null;
  if (run.stalled) return <Badge tone="rose">stalled</Badge>;
  return <Badge tone={STATUS_TONE[run.status] || "slate"}>{run.status}</Badge>;
}

/** The in-flight run, or an explicit idle state. */
function LivePanel({ live, onOpen }) {
  const running = live?.running;
  const lock = live?.lock;

  if (!running) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <PauseCircle className="h-5 w-5 text-slate-400" />
          <div>
            <div className="text-sm font-medium text-slate-900">No run in flight</div>
            <div className="mt-0.5 text-xs text-slate-500">
              {lock === null
                ? "Lock state unavailable — Redis unreachable."
                : lock?.held
                  ? `Lock is held by ${lock.runId?.slice(0, 8)} with no matching run row. A cycle may have died before recording itself.`
                  : "Lock is free. The next tick will start on schedule."}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const pct = running.progressPct;
  return (
    <div className="rounded-xl border border-sky-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="relative flex h-3 w-3">
            {!running.stalled ? (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-75" />
            ) : null}
            <span
              className={`relative inline-flex h-3 w-3 rounded-full ${running.stalled ? "bg-rose-500" : "bg-sky-500"}`}
            />
          </span>
          <div>
            <div className="flex items-center gap-2 text-sm font-medium text-slate-900">
              Run in flight
              <StatusBadge run={running} />
              {running.dryRun ? <Badge tone="amber">dry run</Badge> : null}
            </div>
            <button
              type="button"
              onClick={() => onOpen(running.runId)}
              className="mt-0.5 font-mono text-xs text-slate-500 underline-offset-2 hover:text-slate-900 hover:underline"
            >
              {running.runId}
            </button>
          </div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-semibold tabular-nums text-slate-900">
            {fmtDuration(running.elapsedMs)}
          </div>
          <div className="text-xs text-slate-500">
            started {fmtClock(running.startedAt)}
          </div>
        </div>
      </div>

      {running.stalled ? (
        <div className="mt-4 flex items-start gap-2 rounded-lg bg-rose-50 p-3 text-xs text-rose-800 ring-1 ring-inset ring-rose-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <strong>No account has completed in {fmtAgo(running.heartbeatAgeMs)}.</strong>{" "}
            This cycle is most likely dead. It will keep holding{" "}
            <code className="font-mono">autopilot:lock</code> — and blocking the next
            tick — until the lock&rsquo;s TTL expires.
          </div>
        </div>
      ) : null}

      <div className="mt-5">
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>
            {formatNumber(running.accountsDone || 0)} of{" "}
            {formatNumber(running.totalAccounts || 0)} accounts
            {running.totalUsers ? ` · ${formatNumber(running.totalUsers)} users` : ""}
          </span>
          <span className="tabular-nums">{pct == null ? "—" : `${pct}%`}</span>
        </div>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className={`h-full rounded-full transition-all duration-500 ${running.stalled ? "bg-rose-400" : "bg-sky-500"}`}
            style={{ width: `${pct ?? 0}%` }}
          />
        </div>
        <div className="mt-1.5 text-xs text-slate-400">
          last account completed {fmtAgo(running.heartbeatAgeMs)}
        </div>
      </div>

      {running.accounts?.length ? (
        <div className="mt-5 max-h-64 overflow-y-auto rounded-lg border border-slate-100">
          <table className="w-full text-left text-xs">
            <tbody className="divide-y divide-slate-100">
              {[...running.accounts]
                .slice()
                .reverse()
                .map((a, i) => (
                  <tr key={`${a.adAccountId}-${i}`} className="hover:bg-slate-50">
                    <td className="px-3 py-2">
                      <div className="font-medium text-slate-800">
                        {a.adAccountName || a.adAccountId}
                      </div>
                      <div className="font-mono text-[11px] text-slate-400">
                        {a.ownerUserId}
                      </div>
                    </td>
                    <td className="px-3 py-2 tabular-nums text-slate-500">
                      {fmtDuration(a.durationMs)}
                    </td>
                    <td className="px-3 py-2 text-slate-500">
                      {actionSummary(a)?.text || "—"}
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={OUTCOME_TONE[a.outcome] || "slate"}>{a.outcome}</Badge>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

export default function AutopilotRunsPage() {
  const [range, setRange] = useState(() => getStoredDateRange());
  // Bumped by the Refresh button. Both loaders depend on it, so one click
  // re-fetches the live panel and the history table together rather than
  // leaving half the page stale.
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [live, setLive] = useState(null);
  const [history, setHistory] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const timerRef = useRef(null);

  const loadHistory = useCallback(async () => {
    try {
      const res = await adminApi.autopilotRuns({
        limit: 100,
        from: range.from,
        to: range.to,
      });
      setHistory(res.data?.data || null);
    } catch (err) {
      setError(err?.response?.data?.message || err.message || "Failed to load runs");
    }
  }, [range.from, range.to]);

  const loadLive = useCallback(async () => {
    try {
      const res = await adminApi.autopilotRunLive();
      const data = res.data?.data || null;
      setLive(data);
      setError("");
      return data?.pollMs || IDLE_POLL_MS;
    } catch (err) {
      setError(err?.response?.data?.message || err.message || "Failed to load run state");
      // Back off rather than hammering a failing endpoint at 3s.
      return IDLE_POLL_MS;
    } finally {
      setLoading(false);
    }
  }, []);

  // Self-rescheduling rather than setInterval: the cadence changes with the
  // response, and an interval set at 3s would keep firing at 3s after the run
  // finished. Also avoids overlapping requests if one is slow.
  useEffect(() => {
    let cancelled = false;
    let lastRunId;

    const tick = async () => {
      const nextMs = await loadLive();
      if (cancelled) return;
      timerRef.current = setTimeout(tick, nextMs);
    };
    tick();
    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      void lastRunId;
    };
  }, [loadLive]);

  // Refresh history when a run finishes — cheap, and it keeps the table honest
  // without polling it on its own schedule.
  const runningId = live?.running?.runId || null;
  useEffect(() => {
    loadHistory();
  }, [loadHistory, runningId, refreshNonce]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      // Await both so the spinner reflects the slower of the two rather than
      // stopping while the table is still loading.
      await Promise.all([loadLive(), loadHistory()]);
    } finally {
      setRefreshing(false);
    }
    setRefreshNonce((n) => n + 1);
  }, [loadLive, loadHistory]);

  const openDetail = useCallback(async (runId) => {
    setDetail({ loading: true, runId });
    try {
      const res = await adminApi.autopilotRunDetail(runId);
      setDetail({ loading: false, run: res.data?.data || null });
    } catch (err) {
      setDetail({
        loading: false,
        error: err?.response?.data?.message || err.message || "Failed to load run",
      });
    }
  }, []);

  const stats = history?.stats;

  return (
    <div className="space-y-6">
      <MetaOpsTabs />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Autopilot Runs
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            What the hourly cycle is doing now, and what each tick costs. Accounts
            that produce no actions appear here — they never reach the action log.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DateRangePicker
            preset={range.preset}
            from={range.from}
            to={range.to}
            onChange={(r) => {
              setRange(r);
              setStoredDateRange(r);
            }}
            ariaLabel="Run history date range"
          />
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-60"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`}
            />
            Refresh
          </button>
          <span className="text-xs text-slate-400">
            {loading ? "loading" : `auto ${Math.round((live?.pollMs || IDLE_POLL_MS) / 1000)}s`}
          </span>
        </div>
      </div>

      {error ? (
        <div className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800 ring-1 ring-inset ring-rose-200">
          {error}
        </div>
      ) : null}

      <LivePanel live={live} onOpen={openDetail} />

      {stats ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Avg cycle"
            value={fmtDuration(stats.avgDurationMs)}
            hint={`over ${stats.runs} completed runs`}
            icon={Timer}
            accent="indigo"
          />
          <StatCard
            label="Slowest cycle"
            value={fmtDuration(stats.maxDurationMs)}
            hint="worst in this window"
            icon={Clock}
            accent={stats.maxDurationMs > 30 * 60 * 1000 ? "rose" : "slate"}
          />
          <StatCard
            label="Per account"
            value={fmtDuration(stats.avgMsPerAccount)}
            hint="the number that sizes concurrency"
            icon={Activity}
            accent="sky"
          />
          <StatCard
            label="Audits / account"
            value={stats.avgAuditsPerAccount ?? "—"}
            hint="one per distinct lookback window"
            icon={PlayCircle}
            accent="emerald"
          />
        </div>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 px-5 py-3">
          <span className="text-sm font-medium text-slate-900">Recent runs</span>
          <span className="text-xs text-slate-400">
            {range.from} to {range.to} &middot; the live panel above always shows now
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-2.5 font-medium">Started</th>
                <th className="px-5 py-2.5 font-medium">Status</th>
                <th className="px-5 py-2.5 font-medium">Duration</th>
                <th className="px-5 py-2.5 font-medium">Accounts</th>
                <th className="px-5 py-2.5 font-medium">Problems</th>
                <th className="px-5 py-2.5 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(history?.runs || []).map((r) => {
                const problems =
                  (r.accountsFailed || 0) +
                  (r.accountsTimedOut || 0) +
                  (r.accountsRateLimited || 0);
                return (
                  <tr
                    key={r.runId}
                    onClick={() => openDetail(r.runId)}
                    className="cursor-pointer hover:bg-slate-50"
                  >
                    <td className="px-5 py-3">
                      <div className="text-slate-800">{fmtClock(r.startedAt)}</div>
                      <div className="font-mono text-[11px] text-slate-400">
                        {r.runId.slice(0, 8)}
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-1.5">
                        <StatusBadge run={r} />
                        {r.dryRun ? <Badge tone="amber">dry</Badge> : null}
                      </div>
                      {r.skipReason ? (
                        <div className="mt-1 text-[11px] text-slate-400">
                          {r.skipReason}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-5 py-3 tabular-nums text-slate-600">
                      {fmtDuration(r.durationMs)}
                    </td>
                    <td className="px-5 py-3 tabular-nums text-slate-600">
                      {formatNumber(r.accountsDone || 0)}
                      {r.totalAccounts ? (
                        <span className="text-slate-400">
                          {" "}
                          / {formatNumber(r.totalAccounts)}
                        </span>
                      ) : null}
                      {/* A gap between done and planned is normal when a user
                          was skipped whole -- no Facebook token, disabled in
                          settings. Naming it stops "1 / 12" reading as a bug. */}
                      {r.accountsSkippedByUser ? (
                        <div className="mt-0.5 text-[11px] font-normal text-amber-600">
                          {formatNumber(r.accountsSkippedByUser)} skipped with{" "}
                          {r.usersSkipped?.length || 0} user
                          {(r.usersSkipped?.length || 0) === 1 ? "" : "s"}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-5 py-3">
                      {problems ? (
                        <div className="flex flex-wrap gap-1">
                          {r.accountsFailed ? (
                            <Badge tone="rose">{r.accountsFailed} failed</Badge>
                          ) : null}
                          {r.accountsTimedOut ? (
                            <Badge tone="amber">{r.accountsTimedOut} timeout</Badge>
                          ) : null}
                          {r.accountsRateLimited ? (
                            <Badge tone="violet">
                              {r.accountsRateLimited} limited
                            </Badge>
                          ) : null}
                        </div>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
                          <CheckCircle2 className="h-3.5 w-3.5" /> clean
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-xs">
                      {(() => {
                        const act = actionSummary({
                          paused: r.totalPaused,
                          resumed: r.totalResumed,
                          scaled: r.totalScaled,
                          wouldPause: r.totalWouldPause,
                          wouldResume: r.totalWouldResume,
                          wouldScale: r.totalWouldScale,
                        });
                        if (!act) return <span className="text-slate-300">—</span>;
                        return (
                          <span className={act.dry ? "text-amber-700" : "text-slate-600"}>
                            {act.text}
                          </span>
                        );
                      })()}
                    </td>
                  </tr>
                );
              })}
              {history && !history.runs?.length ? (
                <tr>
                  <td colSpan={6} className="px-5 py-10 text-center text-sm text-slate-400">
                    No runs recorded yet. Rows appear from the next cycle onward.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {detail ? (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:p-8"
          onClick={() => setDetail(null)}
        >
          <div
            className="w-full max-w-3xl rounded-xl bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {detail.loading ? (
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading run…
              </div>
            ) : detail.error ? (
              <div className="text-sm text-rose-700">{detail.error}</div>
            ) : (
              <>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-base font-semibold text-slate-900">Run detail</h2>
                      <StatusBadge run={detail.run} />
                    </div>
                    <div className="mt-1 font-mono text-xs text-slate-500">
                      {detail.run.runId}
                    </div>
                  </div>
                  <div className="text-right text-xs text-slate-500">
                    <div>{fmtClock(detail.run.startedAt)}</div>
                    <div className="mt-0.5 tabular-nums">
                      {fmtDuration(detail.run.durationMs ?? detail.run.elapsedMs)}
                    </div>
                    {detail.run.host ? (
                      <div className="mt-0.5 flex items-center justify-end gap-1">
                        <Lock className="h-3 w-3" />
                        {detail.run.host}:{detail.run.pid}
                      </div>
                    ) : null}
                  </div>
                </div>

                {detail.run.error ? (
                  <div className="mt-4 rounded-lg bg-rose-50 p-3 text-xs text-rose-800 ring-1 ring-inset ring-rose-200">
                    <strong>The cycle itself failed:</strong> {detail.run.error}
                  </div>
                ) : null}

                {detail.run.usersSkipped?.length ? (
                  <div className="mt-4 rounded-lg bg-amber-50 p-3 text-xs text-amber-900 ring-1 ring-inset ring-amber-200">
                    <div className="font-medium">
                      {detail.run.usersSkipped.length} user
                      {detail.run.usersSkipped.length === 1 ? "" : "s"} skipped
                      before any account was reached
                      {detail.run.accountsSkippedByUser
                        ? ` (${detail.run.accountsSkippedByUser} accounts)`
                        : ""}
                    </div>
                    <ul className="mt-1.5 space-y-0.5">
                      {detail.run.usersSkipped.map((u) => (
                        <li key={u.userId} className="font-mono text-[11px]">
                          {u.userId} &mdash; {u.reason}
                          {u.accounts ? ` (${u.accounts} accounts)` : ""}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <div className="mt-5 max-h-[55vh] overflow-y-auto rounded-lg border border-slate-100">
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-3 py-2 font-medium">Account</th>
                        <th className="px-3 py-2 font-medium">Duration</th>
                        <th className="px-3 py-2 font-medium">Audits</th>
                        <th className="px-3 py-2 font-medium">Actions</th>
                        <th className="px-3 py-2 font-medium">Outcome</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(detail.run.accounts || []).map((a, i) => (
                        <tr key={`${a.adAccountId}-${i}`}>
                          <td className="px-3 py-2">
                            <div className="font-medium text-slate-800">
                              {a.adAccountName || a.adAccountId}
                            </div>
                            <div className="font-mono text-[11px] text-slate-400">
                              {a.ownerUserId} · {a.adAccountId}
                            </div>
                            {a.error ? (
                              <div className="mt-1 text-[11px] text-rose-600">
                                {a.error}
                              </div>
                            ) : null}
                          </td>
                          <td className="px-3 py-2 tabular-nums text-slate-600">
                            {fmtDuration(a.durationMs)}
                          </td>
                          <td className="px-3 py-2 tabular-nums text-slate-600">
                            {a.auditCount ?? "—"}
                          </td>
                          <td className="px-3 py-2">
                            {(() => {
                              const act = actionSummary(a);
                              if (!act) return <span className="text-slate-300">—</span>;
                              return (
                                <span
                                  className={
                                    act.dry ? "text-amber-700" : "text-slate-700"
                                  }
                                >
                                  {act.text}
                                </span>
                              );
                            })()}
                          </td>
                          <td className="px-3 py-2">
                            <Badge tone={OUTCOME_TONE[a.outcome] || "slate"}>
                              {a.outcome}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                      {!detail.run.accounts?.length ? (
                        <tr>
                          <td colSpan={5} className="px-3 py-8 text-center text-slate-400">
                            No accounts recorded for this run.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>

                <div className="mt-4 flex justify-end">
                  <button
                    type="button"
                    onClick={() => setDetail(null)}
                    className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700"
                  >
                    Close
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
