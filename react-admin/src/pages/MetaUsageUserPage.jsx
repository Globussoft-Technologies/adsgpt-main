/**
 * One user's Meta API usage, broken down by ad account and by hour.
 *
 * The drill-down from the busiest-accounts table. Answers the follow-up
 * question the overview raises: this customer is expensive — is it one
 * account or all of them, and is it a schedule or a person?
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertTriangle, ArrowLeft, Ban, Gauge, Loader2, PhoneCall } from "lucide-react";
import StatCard from "@/components/StatCard.jsx";
import DateRangePicker from "@/components/DateRangePicker.jsx";
import MeterBar, { meterTone } from "@/components/MeterBar.jsx";
import { adminApi } from "@/lib/api";
import { formatNumber } from "@/lib/utils";
import { getStoredDateRange, setStoredDateRange } from "@/lib/dateRangeStore";

const SOURCE_LABELS = {
  audit: "Autopilot audit",
  autopilot: "Autopilot",
  "ads-manager": "Ads Manager",
  "ad-posting": "Ad posting",
  "ad-factory": "Ad Factory",
  "partner-api": "Partner API",
  admin: "Admin panel",
  http: "Other HTTP",
  unknown: "Unattributed",
};
const sourceLabel = (s) => SOURCE_LABELS[s] || s || "Unattributed";

function hourLabel(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit" });
}

export default function MetaUsageUserPage() {
  const { userId } = useParams();
  const [range, setRange] = useState(() => getStoredDateRange());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    setError("");
    adminApi
      .metaUsageUserDetail(userId, {
        from: range.from || undefined,
        to: range.to || undefined,
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
  }, [userId, range.from, range.to]);

  const totals = data?.totals || {};
  const byAccount = data?.byAccount || [];
  const bySource = data?.bySource || [];
  const recorder = data?.recorder;

  // The hourly series arrives split per account; the chart wants one row per
  // hour. Counts add, meters take the worst — the same rule as the backend.
  const chartData = useMemo(() => {
    const merged = new Map();
    for (const row of data?.hourly || []) {
      const key = new Date(row.hour).getTime();
      const prev = merged.get(key) || {
        hour: row.hour,
        label: hourLabel(row.hour),
        calls: 0,
        throttles: 0,
        peakApp: 0,
        peakInsightsAcc: 0,
      };
      prev.calls += row.calls || 0;
      prev.throttles += row.throttles || 0;
      prev.peakApp = Math.max(prev.peakApp, row.peakApp || 0);
      prev.peakInsightsAcc = Math.max(prev.peakInsightsAcc, row.peakInsightsAcc || 0);
      merged.set(key, prev);
    }
    return [...merged.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
  }, [data]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link
            to="/meta-usage"
            className="mb-1 inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-800"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Meta API usage
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{userId}</h1>
          <p className="text-sm text-slate-500">Meta requests and rate-limit meters for this user.</p>
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
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard
              label="Requests"
              value={formatNumber(totals.calls)}
              hint={`${byAccount.length} ad account${byAccount.length === 1 ? "" : "s"}`}
              accent="indigo"
              icon={PhoneCall}
            />
            <StatCard
              label="Refused for rate limits"
              value={formatNumber(totals.throttles)}
              accent={totals.throttles ? "rose" : "emerald"}
              icon={Ban}
            />
            <StatCard
              label="Worst account meter"
              value={`${Math.round(
                Math.max(totals.peakInsightsAcc || 0, totals.peakBuc || 0, totals.peakAcc || 0),
              )}%`}
              hint="Highest per-account reading"
              accent={
                meterTone(
                  Math.max(totals.peakInsightsAcc || 0, totals.peakBuc || 0, totals.peakAcc || 0),
                ) === "emerald"
                  ? "emerald"
                  : "rose"
              }
              icon={Gauge}
            />
          </div>

          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="text-sm font-semibold text-slate-800">Meters for this user</h2>
              <p className="text-xs text-slate-500">
                The application meter is shown for context only — it is shared platform-wide and is
                not this user&rsquo;s to fill.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-5 p-5 md:grid-cols-2">
              <MeterBar label="Business use case" scope="account" value={totals.peakBuc} />
              <MeterBar
                label="Insights (per account)"
                scope="account"
                value={totals.peakInsightsAcc}
              />
              <MeterBar label="Ad account" scope="account" value={totals.peakAcc} />
              <MeterBar label="Application" scope="app" value={totals.peakApp} />
            </div>
          </section>

          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="text-sm font-semibold text-slate-800">Requests over time</h2>
            </div>
            <div className="h-64 px-2 pt-2">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 16, right: 16, left: 0, bottom: 8 }}>
                  <defs>
                    <linearGradient id="userCallsFill" x1="0" y1="0" x2="0" y2="1">
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
                    fill="url(#userCallsFill)"
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="peakInsightsAcc"
                    name="Insights meter %"
                    stroke="#f43f5e"
                    strokeWidth={2}
                    dot={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </section>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <TableCard
              title="By ad account"
              subtitle="Which account carries the cost"
              rows={byAccount}
              nameOf={(r) => (r.adAccountId ? `act_${r.adAccountId}` : "unattributed")}
              keyOf={(r) => r.adAccountId || "_"}
            />
            <TableCard
              title="By source"
              subtitle="Scheduled work versus people using the product"
              rows={bySource}
              nameOf={(r) => sourceLabel(r.source)}
              keyOf={(r) => r.source || "_"}
            />
          </div>
        </>
      )}
    </div>
  );
}

function TableCard({ title, subtitle, rows, nameOf, keyOf }) {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-5 py-4">
        <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
        <p className="text-xs text-slate-500">{subtitle}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="px-5 py-3 font-medium">Name</th>
              <th className="px-5 py-3 text-right font-medium">Requests</th>
              <th className="px-5 py-3 text-right font-medium">Refused</th>
              <th className="px-5 py-3 text-right font-medium">Worst meter</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-5 py-8 text-center text-slate-500">
                  Nothing recorded in this window.
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const worst = Math.max(
                  r.peakInsightsAcc || 0,
                  r.peakBuc || 0,
                  r.peakAcc || 0,
                );
                const tone = meterTone(worst);
                const cls = {
                  emerald: "bg-emerald-50 text-emerald-700",
                  amber: "bg-amber-50 text-amber-700",
                  rose: "bg-rose-50 text-rose-700",
                }[tone];
                return (
                  <tr
                    key={keyOf(r)}
                    className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60"
                  >
                    <td className="px-5 py-3 font-medium text-slate-800">{nameOf(r)}</td>
                    <td className="px-5 py-3 text-right tabular-nums">{formatNumber(r.calls)}</td>
                    <td className="px-5 py-3 text-right tabular-nums">
                      {r.throttles ? (
                        <span className="font-semibold text-rose-600">
                          {formatNumber(r.throttles)}
                        </span>
                      ) : (
                        <span className="text-slate-400">0</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <span
                        className={`inline-block rounded px-2 py-0.5 text-xs font-semibold tabular-nums ${cls}`}
                      >
                        {Math.round(worst)}%
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
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
            {entry.name?.includes("%") ? `${Math.round(entry.value)}%` : formatNumber(entry.value)}
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
