import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Activity, DollarSign, Image as ImageIcon, Loader2, Users, Video, Wallet, Zap } from "lucide-react";
import StatCard from "@/components/StatCard.jsx";
import DateRangePicker from "@/components/DateRangePicker.jsx";
import { adminApi } from "@/lib/api";
import { formatNumber, formatUsd } from "@/lib/utils";
import { getStoredDateRange, setStoredDateRange } from "@/lib/dateRangeStore";

const MODEL_BAR_COLORS = ["#6366f1", "#8b5cf6", "#ec4899", "#f59e0b", "#10b981", "#06b6d4", "#3b82f6", "#f43f5e"];

export default function OverviewPage() {
  const [range, setRange] = useState(() => getStoredDateRange());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    setError("");
    adminApi
      .overview({ from: range.from || undefined, to: range.to || undefined })
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
  }, [range.from, range.to]);

  const totals = data?.totals || { users: 0, generations: 0, cost: 0, credits: 0 };
  const byType = data?.byType || [];
  const byModel = data?.byModel || [];
  const daily = data?.daily || [];

  const imageStats = useMemo(() => byType.find((t) => t.type === "image") || { generations: 0, cost: 0 }, [byType]);
  const videoStats = useMemo(() => byType.find((t) => t.type === "video") || { generations: 0, cost: 0 }, [byType]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Overview</h1>
          <p className="text-sm text-slate-500">Generation activity and platform cost.</p>
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
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
      ) : null}

      {loading ? (
        <LoadingState />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Total cost (USD)" value={formatUsd(totals.cost)} accent="rose" icon={DollarSign} />
            <StatCard label="Generations" value={formatNumber(totals.generations)} accent="indigo" icon={Activity} />
            <StatCard label="Active users" value={formatNumber(totals.users)} accent="emerald" icon={Users} />
            <StatCard label="Credits deducted" value={formatNumber(totals.credits)} accent="amber" icon={Wallet} />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <StatCard
              label="Images"
              value={formatNumber(imageStats.generations)}
              hint={`${formatUsd(imageStats.cost)} cost`}
              accent="sky"
              icon={ImageIcon}
            />
            <StatCard
              label="Videos"
              value={formatNumber(videoStats.generations)}
              hint={`${formatUsd(videoStats.cost)} cost`}
              accent="indigo"
              icon={Video}
            />
          </div>

          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <div>
                <h2 className="text-sm font-semibold text-slate-800">Daily cost</h2>
                <p className="text-xs text-slate-500">USD spent per day on generations</p>
              </div>
              <Zap className="h-4 w-4 text-indigo-500" />
            </div>
            <div className="h-72 px-2 pt-2">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={daily} margin={{ top: 16, right: 16, left: 0, bottom: 8 }}>
                  <defs>
                    <linearGradient id="costFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#6366f1" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="genFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10b981" stopOpacity={0.25} />
                      <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
                  <XAxis dataKey="date" stroke="#94a3b8" fontSize={12} tickMargin={8} />
                  <YAxis stroke="#94a3b8" fontSize={12} tickMargin={4} />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Area
                    type="monotone"
                    dataKey="cost"
                    name="Cost (USD)"
                    stroke="#6366f1"
                    strokeWidth={2}
                    fill="url(#costFill)"
                  />
                  <Area
                    type="monotone"
                    dataKey="generations"
                    name="Generations"
                    stroke="#10b981"
                    strokeWidth={2}
                    fill="url(#genFill)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <div>
                <h2 className="text-sm font-semibold text-slate-800">Cost by model</h2>
                <p className="text-xs text-slate-500">Where the money goes</p>
              </div>
            </div>
            <div className="h-72 px-2 pt-2">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byModel} margin={{ top: 16, right: 16, left: 0, bottom: 32 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
                  <XAxis
                    dataKey="model"
                    stroke="#94a3b8"
                    fontSize={11}
                    angle={-25}
                    textAnchor="end"
                    interval={0}
                    height={60}
                  />
                  <YAxis stroke="#94a3b8" fontSize={12} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="cost" radius={[8, 8, 0, 0]}>
                    {byModel.map((_, idx) => (
                      <Cell key={idx} fill={MODEL_BAR_COLORS[idx % MODEL_BAR_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-5 py-3">Model</th>
                    <th className="px-5 py-3">Generations</th>
                    <th className="px-5 py-3">Credits</th>
                    <th className="px-5 py-3 text-right">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {byModel.map((row, idx) => (
                    <tr key={row.model} className="border-t border-slate-100 hover:bg-slate-50/60">
                      <td className="px-5 py-3">
                        <span className="inline-flex items-center gap-2 font-medium text-slate-800">
                          <span
                            className="h-2.5 w-2.5 rounded-full"
                            style={{ background: MODEL_BAR_COLORS[idx % MODEL_BAR_COLORS.length] }}
                          />
                          {row.model}
                        </span>
                      </td>
                      <td className="px-5 py-3 tabular-nums text-slate-700">{formatNumber(row.generations)}</td>
                      <td className="px-5 py-3 tabular-nums text-slate-700">{formatNumber(row.credits)}</td>
                      <td className="px-5 py-3 text-right font-semibold tabular-nums text-rose-600">
                        {formatUsd(row.cost)}
                      </td>
                    </tr>
                  ))}
                  {byModel.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-5 py-10 text-center text-slate-500">
                        No data in range
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-slate-200 bg-white/95 px-3 py-2 text-xs shadow-lg backdrop-blur">
      {label ? <div className="mb-1 font-medium text-slate-700">{label}</div> : null}
      <div className="space-y-0.5">
        {payload.map((p) => (
          <div key={p.dataKey} className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
            <span className="text-slate-600">{p.name || p.dataKey}</span>
            <span className="ml-auto font-semibold tabular-nums text-slate-900">
              {p.dataKey === "cost" ? formatUsd(p.value) : formatNumber(p.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-28 animate-pulse rounded-xl border border-slate-200 bg-slate-100/60" />
        ))}
      </div>
      <div className="h-72 animate-pulse rounded-xl border border-slate-200 bg-slate-100/60" />
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    </div>
  );
}
