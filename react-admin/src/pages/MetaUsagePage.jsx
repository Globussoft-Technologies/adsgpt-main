/**
 * Meta API usage — who spends our shared Meta quota, and how close to Meta's
 * ceilings we came.
 *
 * THE QUESTION THIS PAGE EXISTS TO ANSWER. When Meta answers "Application
 * request limit reached", two things need settling fast: which meter filled,
 * and whose traffic filled it. Neither was answerable before — the usage
 * headers Meta returns on every response were read for self-throttling and
 * then discarded.
 *
 * WHY THE APP METER IS SEPARATED FROM EVERYTHING ELSE. `peak.app` is one
 * platform-wide pool shared by every customer; the rest are per-account.
 * Putting them in the same row would invite the conclusion that a busy
 * account caused an app-level refusal, when the app bucket can be filled by
 * anyone at all. That misreading is exactly what happened the first time, so
 * the layout is built to prevent it.
 *
 * COUNTS AND PERCENTAGES ARE NEVER MIXED. Calls are totals; meters are
 * worst-readings. They are shown in different components for that reason —
 * see MeterBar.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertTriangle,
  Ban,
  Gauge,
  Loader2,
  PhoneCall,
  ShieldAlert,
} from "lucide-react";
import StatCard from "@/components/StatCard.jsx";
import DateRangePicker from "@/components/DateRangePicker.jsx";
import MeterBar, { meterTone } from "@/components/MeterBar.jsx";
import UsageFilterBar, {
  EMPTY_FILTERS,
  hasActiveFilters,
  sourceLabel,
} from "@/components/UsageFilterBar.jsx";
import { adminApi } from "@/lib/api";
import { formatNumber } from "@/lib/utils";
import { getStoredDateRange, setStoredDateRange } from "@/lib/dateRangeStore";

/** Scheduled work is predictable; people clicking is not. */
const SCHEDULED_SOURCES = new Set(["audit", "autopilot", "ad-factory"]);

function hourLabel(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit" });
}

export default function MetaUsagePage() {
  const [range, setRange] = useState(() => getStoredDateRange());
  const [filters, setFilters] = useState({ ...EMPTY_FILTERS });
  const [options, setOptions] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Options depend only on the range: a dropdown must not narrow itself by
  // the filter it exists to set.
  useEffect(() => {
    let cancel = false;
    adminApi
      .metaUsageFilterOptions({ from: range.from || undefined, to: range.to || undefined })
      .then((res) => !cancel && setOptions(res.data))
      .catch(() => !cancel && setOptions(null));
    return () => {
      cancel = true;
    };
  }, [range.from, range.to]);

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    setError("");
    adminApi
      .metaUsageOverview({
        from: range.from || undefined,
        to: range.to || undefined,
        search: filters.search || undefined,
        source: filters.source,
        adAccountId: filters.adAccountId,
        userId: filters.userId,
        sort: filters.sort,
        onlyThrottled: filters.onlyThrottled ? "true" : undefined,
      })
      .then((res) => {
        if (!cancel) setData(res.data);
      })
      .catch((err) => {
        if (!cancel) setError(err?.response?.data?.message || err.message);
      })
      .finally(() => !cancel && setLoading(false));
    return () => {
      cancel = true;
    };
  }, [
    range.from,
    range.to,
    filters.search,
    filters.source,
    filters.adAccountId,
    filters.userId,
    filters.sort,
    filters.onlyThrottled,
  ]);

  const totals = data?.totals || {};
  const hourly = data?.hourly || [];
  const bySource = data?.bySource || [];
  const topAccounts = data?.topAccounts || [];
  const recorder = data?.recorder;
  const counts = data?.counts || {};

  const chartData = useMemo(
    () =>
      hourly.map((h) => ({
        ...h,
        label: hourLabel(h.hour),
      })),
    [hourly],
  );

  const sourceChart = useMemo(
    () =>
      bySource.map((s) => ({
        ...s,
        label: sourceLabel(s.source),
        scheduled: SCHEDULED_SOURCES.has(s.source),
      })),
    [bySource],
  );

  // The single most useful sentence on the page: was this us on a timer, or
  // people using the product? Those have completely different fixes.
  const split = useMemo(() => {
    let scheduled = 0;
    let interactive = 0;
    for (const s of sourceChart) {
      if (s.scheduled) scheduled += s.calls || 0;
      else interactive += s.calls || 0;
    }
    const total = scheduled + interactive;
    return {
      scheduled,
      interactive,
      pctScheduled: total ? Math.round((scheduled / total) * 100) : 0,
    };
  }, [sourceChart]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Meta API usage</h1>
          <p className="text-sm text-slate-500">
            Requests made against Meta&rsquo;s shared per-app quota, and how full its meters got.
          </p>
        </div>
        <DateRangePicker
          from={range.from}
          to={range.to}
          onChange={(r) => {
            setRange(r);
            setStoredDateRange(r);
          }}
        />
      </header>

      <UsageFilterBar filters={filters} onChange={setFilters} options={options} />

      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      {recorder?.warning ? (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{recorder.warning}</span>
        </div>
      ) : null}

      {loading ? (
        <LoadingState />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Requests"
              value={formatNumber(totals.calls)}
              hint={`${split.pctScheduled}% from scheduled jobs`}
              accent="indigo"
              icon={PhoneCall}
            />
            <StatCard
              label="Refused for rate limits"
              value={formatNumber(totals.throttles)}
              hint={
                totals.throttles
                  ? "Meta declined these on purpose"
                  : "No throttling in this window"
              }
              accent={totals.throttles ? "rose" : "emerald"}
              icon={Ban}
            />
            <StatCard
              label="Peak app meter"
              value={`${Math.round(totals.peakApp || 0)}%`}
              hint="Shared by every customer"
              accent={meterTone(totals.peakApp) === "emerald" ? "emerald" : "rose"}
              icon={Gauge}
            />
            <StatCard
              label="Failed requests"
              value={formatNumber(totals.failures)}
              hint="All causes, throttles included"
              accent="amber"
              icon={ShieldAlert}
            />
          </div>

          {/* The meters. Separated from the counts above because a percentage
              of a ceiling and a count of requests are not the same kind of
              number, and reading one as the other is how the first
              investigation went wrong. */}
          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="text-sm font-semibold text-slate-800">Worst meter readings</h2>
              <p className="text-xs text-slate-500">
                Highest utilisation seen in this window. Meta refuses at 100%; the marker at 75% is
                where we start slowing ourselves down.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-5 p-5 md:grid-cols-2">
              <MeterBar
                label="Application"
                scope="app"
                value={totals.peakApp}
                hint="One pool for the whole platform. A busy account does not cause this on its own."
              />
              <MeterBar
                label="Insights (app-wide)"
                scope="app"
                value={totals.peakInsightsApp}
                hint="Insights have their own ceiling, separate from the application one."
              />
              <MeterBar
                label="Business use case"
                scope="account"
                value={totals.peakBuc}
                hint="Meters CPU time, not just call count — expensive queries fill this fast."
              />
              <MeterBar
                label="Insights (per account)"
                scope="account"
                value={totals.peakInsightsAcc}
                hint="Usually the first to fill for an insights-heavy workload."
              />
              <MeterBar label="Ad account" scope="account" value={totals.peakAcc} />
              <MeterBar label="Reach & breakdowns" scope="account" value={totals.peakReach} />
            </div>
            {totals.maxBlockedMs > 0 ? (
              <div className="border-t border-slate-100 bg-rose-50 px-5 py-3 text-sm text-rose-700">
                Meta reported a block of up to{" "}
                <strong>{Math.round(totals.maxBlockedMs / 60000)} minutes</strong> during this
                window.
              </div>
            ) : null}
          </section>

          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="text-sm font-semibold text-slate-800">Requests over time</h2>
              <p className="text-xs text-slate-500">
                Request volume against the application meter. A meter that climbs without volume
                climbing means someone else spent the quota.
              </p>
            </div>
            <div className="h-72 px-2 pt-2">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 16, right: 16, left: 0, bottom: 8 }}>
                  <defs>
                    <linearGradient id="metaCallsFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#6366f1" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
                  <XAxis dataKey="label" stroke="#94a3b8" fontSize={11} tickMargin={8} />
                  <YAxis yAxisId="left" stroke="#94a3b8" fontSize={12} tickMargin={4} />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    domain={[0, 100]}
                    unit="%"
                    stroke="#94a3b8"
                    fontSize={12}
                  />
                  <Tooltip content={<UsageTooltip />} />
                  <Area
                    yAxisId="left"
                    type="monotone"
                    dataKey="calls"
                    name="Requests"
                    stroke="#6366f1"
                    strokeWidth={2}
                    fill="url(#metaCallsFill)"
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="peakApp"
                    name="App meter %"
                    stroke="#f43f5e"
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="throttles"
                    name="Refused"
                    stroke="#f59e0b"
                    strokeWidth={2}
                    dot={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="text-sm font-semibold text-slate-800">Where the requests come from</h2>
              <p className="text-xs text-slate-500">
                {formatNumber(split.scheduled)} from scheduled jobs,{" "}
                {formatNumber(split.interactive)} from people using the product. Only the first kind
                can be fixed by changing a schedule.
              </p>
            </div>
            <div className="h-64 px-2 pt-2">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={sourceChart} margin={{ top: 16, right: 16, left: 0, bottom: 40 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
                  <XAxis
                    dataKey="label"
                    stroke="#94a3b8"
                    fontSize={11}
                    angle={-25}
                    textAnchor="end"
                    height={60}
                    interval={0}
                  />
                  <YAxis stroke="#94a3b8" fontSize={12} tickMargin={4} />
                  <Tooltip content={<UsageTooltip />} />
                  <Bar dataKey="calls" name="Requests" fill="#6366f1" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="text-sm font-semibold text-slate-800">Busiest ad accounts</h2>
              <p className="text-xs text-slate-500">
                The per-account meters say whether that volume actually put the account near a
                ceiling.
                {counts.accounts > topAccounts.length
                  ? ` Showing ${topAccounts.length} of ${counts.accounts}.`
                  : ""}
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-5 py-3 font-medium">Ad account</th>
                    <th className="px-5 py-3 font-medium">User</th>
                    <th className="px-5 py-3 text-right font-medium">Requests</th>
                    <th className="px-5 py-3 text-right font-medium">Refused</th>
                    <th className="px-5 py-3 text-right font-medium">Insights peak</th>
                    <th className="px-5 py-3 text-right font-medium">BUC peak</th>
                  </tr>
                </thead>
                <tbody>
                  {topAccounts.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-5 py-8 text-center text-slate-500">
                        {hasActiveFilters(filters)
                          ? "No accounts match these filters."
                          : "No Meta traffic recorded in this window."}
                      </td>
                    </tr>
                  ) : (
                    topAccounts.map((row) => (
                      <tr
                        key={`${row.userId || "_"}:${row.adAccountId}`}
                        className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60"
                      >
                        <td className="px-5 py-3">
                          <div className="font-medium text-slate-800">
                            {row.adAccountName || (
                              <span className="text-slate-400">Unnamed account</span>
                            )}
                          </div>
                          <div className="text-xs text-slate-500 tabular-nums">
                            act_{row.adAccountId}
                          </div>
                        </td>
                        <td className="px-5 py-3">
                          {row.userId ? (
                            <>
                              <Link
                                to={`/meta-usage/users/${encodeURIComponent(row.userId)}`}
                                className="block"
                              >
                                <div className="font-medium text-indigo-600 hover:underline">
                                  {row.userName || row.userId}
                                </div>
                                {row.userEmail ? (
                                  <div className="text-xs text-slate-500">{row.userEmail}</div>
                                ) : null}
                              </Link>
                              {row.userCount > 1 ? (
                                <span className="mt-0.5 inline-block text-xs text-slate-500">
                                  +{row.userCount - 1} other user
                                  {row.userCount > 2 ? "s" : ""}
                                </span>
                              ) : null}
                              {row.hasUnattributed ? (
                                <span
                                  title="Some of this account's traffic was recorded before requests carried a user."
                                  className="mt-0.5 inline-block text-xs text-slate-400"
                                >
                                  + unattributed traffic
                                </span>
                              ) : null}
                            </>
                          ) : (
                            <span className="text-slate-400">unattributed</span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-right tabular-nums">
                          {formatNumber(row.calls)}
                        </td>
                        <td className="px-5 py-3 text-right tabular-nums">
                          {row.throttles ? (
                            <span className="font-semibold text-rose-600">
                              {formatNumber(row.throttles)}
                            </span>
                          ) : (
                            <span className="text-slate-400">0</span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <MeterPill value={row.peakInsightsAcc} />
                        </td>
                        <td className="px-5 py-3 text-right">
                          <MeterPill value={row.peakBuc} />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function MeterPill({ value }) {
  const pct = Math.round(Number(value) || 0);
  const tone = meterTone(pct);
  const cls = {
    emerald: "bg-emerald-50 text-emerald-700",
    amber: "bg-amber-50 text-amber-700",
    rose: "bg-rose-50 text-rose-700",
  }[tone];
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-semibold tabular-nums ${cls}`}>
      {pct}%
    </span>
  );
}

function UsageTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
      <div className="mb-1 font-semibold text-slate-700">{label}</div>
      {payload.map((entry) => (
        <div key={entry.dataKey} className="flex items-center gap-2 text-slate-600">
          <span className="h-2 w-2 rounded-full" style={{ background: entry.color }} />
          <span>{entry.name}</span>
          <span className="ml-auto font-medium tabular-nums text-slate-800">
            {entry.name?.includes("%")
              ? `${Math.round(entry.value)}%`
              : formatNumber(entry.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex h-64 items-center justify-center rounded-xl border border-slate-200 bg-white">
      <Loader2 className="h-5 w-5 animate-spin text-indigo-500" />
    </div>
  );
}
