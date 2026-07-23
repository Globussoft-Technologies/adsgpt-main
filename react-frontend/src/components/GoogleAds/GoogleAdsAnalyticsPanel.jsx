import React, { useState } from 'react';
import {
  TrendingUp,
  Eye,
  MousePointerClick,
  DollarSign,
  Users,
  Activity,
  Target,
  Zap,
  Radio,
  ArrowUpRight,
  ArrowDownRight,
  Layers,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as ReTooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { CHART_COLORS, fmt } from '@/components/MetaAds/metaAdsUtils';
import { Spinner, EmptyState, ChartTooltip } from '@/components/MetaAds/MetaAdsAtoms';

const ChangeChip = ({ change }) => {
  const n = parseFloat(change);
  if (isNaN(n) || n === 0) return null;
  const up = n > 0;
  return (
    <span
      className={`flex items-center gap-0.5 text-[9px] font-semibold ${up ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}
    >
      {up ? <ArrowUpRight className="h-2.5 w-2.5" /> : <ArrowDownRight className="h-2.5 w-2.5" />}
      {Math.abs(n).toFixed(1)}%
    </span>
  );
};

const formatNumber = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return '\u2014';
  return number.toLocaleString(undefined, { maximumFractionDigits: 2 });
};

const formatOptionalNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? formatNumber(number) : '\u2014';
};

const formatCurrency = (value, currencyCode) => {
  const number = Number(value);
  if (!Number.isFinite(number) || !currencyCode) return '\u2014';
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currencyCode,
      maximumFractionDigits: 2,
    }).format(number);
  } catch {
    return '\u2014';
  }
};

// ─── analytics panel ─────────────────────────────────────────────────────────

const normalizeChartData = (rows, range) => {
  if (!range?.startDate || !range?.endDate) return rows;
  const rangeStart = new Date(`${range.startDate}T00:00:00Z`);
  const rangeEnd = new Date(`${range.endDate}T00:00:00Z`);
  const rangeDays = Math.ceil((rangeEnd - rangeStart) / 86400000);
  if (rangeDays > 366) {
    const populated = rows.filter((row) => row.fullDate && (Number(row.spend) > 0 || Number(row.clicks) > 0 || Number(row.impressions) > 0)).sort((a, b) => a.fullDate.localeCompare(b.fullDate));
    if (!populated.length) return rows;
    range = { startDate: populated[0].fullDate, endDate: populated[populated.length - 1].fullDate };
  }
  const byDate = new Map(rows.map((row) => [row.fullDate, row]));
  const result = [];
  const cursor = new Date(`${range.startDate}T00:00:00Z`);
  const end = new Date(`${range.endDate}T00:00:00Z`);
  while (cursor <= end) {
    const fullDate = cursor.toISOString().slice(0, 10);
    const existing = byDate.get(fullDate) || {};
    result.push({
      ...existing,
      name: new Intl.DateTimeFormat(undefined, { day: '2-digit', month: 'short', timeZone: 'UTC' }).format(cursor),
      fullDate,
      spend: Number.isFinite(Number(existing.spend)) ? Number(existing.spend) : 0,
      impressions: Number.isFinite(Number(existing.impressions)) ? Number(existing.impressions) : 0,
      clicks: Number.isFinite(Number(existing.clicks)) ? Number(existing.clicks) : 0,
      conversions: Number.isFinite(Number(existing.conversions)) ? Number(existing.conversions) : 0,
      ctr: Number.isFinite(Number(existing.ctr)) ? Number(existing.ctr) : 0,
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
};

export default function GoogleAdsAnalyticsPanel({ analyticsData, loading, error, currencyCode }) {
  const [chartMetric, setChartMetric] = useState('spend');

  if (loading) return <Spinner />;
  if (error) return <EmptyState message={error} />;
  if (!analyticsData) return <EmptyState message="No analytics data for the selected account and period" />;

  const { stats, chartData: rawChartData = [], actions = [], dateRange } = analyticsData;
  const chartData = normalizeChartData(rawChartData, dateRange);

  const hasData = stats && Object.values(stats).some((s) => parseFloat(s?.val) > 0);
  if (!hasData) {
    return (
      <div className="flex w-full flex-col items-center justify-center px-4 py-12 text-center">
        <div className="flex flex-col items-center justify-center">
          <p className="text-sm font-semibold text-gray-900 sm:text-base dark:text-white">No data for this period</p>
          <p className="mt-2 max-w-[90%] text-xs leading-relaxed text-gray-500 sm:max-w-md sm:text-sm dark:text-[#BEBEBE]">
            There were no impressions, clicks, or spend recorded for the selected date range. Try a
            different date preset or account.
          </p>
        </div>
      </div>
    );
  }

  const kpiRows = [
    [
      { icon: DollarSign,        label: 'Spend',       value: formatCurrency(stats.spend?.val, currencyCode ?? analyticsData.currencyCode), change: stats.spend?.change },
      { icon: Eye,               label: 'Impressions', value: formatNumber(stats.impressions?.val), change: stats.impressions?.change  },
      { icon: MousePointerClick, label: 'Clicks',      value: formatNumber(stats.clicks?.val),      change: stats.clicks?.change       },
      { icon: Users,             label: 'Reach',       value: formatNumber(stats.reach?.val),                  change: stats.reach?.change       },
    ],
    [
      { icon: TrendingUp,      label: 'CTR',               value: stats.ctr?.val == null ? '�' : `${fmt(stats.ctr.val)}%`, change: stats.ctr?.change },
      { icon: Activity,        label: 'Avg. CPC',          value: formatCurrency(stats.cpc?.val, currencyCode ?? analyticsData.currencyCode), change: stats.cpc?.change },
      { icon: Zap,             label: 'CPM',               value: formatCurrency(stats.cpm?.val, currencyCode ?? analyticsData.currencyCode), change: stats.cpm?.change },
      { icon: Radio,            label: 'Frequency',    value: formatOptionalNumber(stats.frequency?.val),          change: stats.frequency?.change    },
    ],
  ];

  const sortedActions = [...actions].sort(
    (a, b) => Number(b.conversions) - Number(a.conversions) || Number(b.allConversions) - Number(a.allConversions),
  );
  const actionPieData = sortedActions
    .filter((action) => Number(action.conversions) > 0)
    .slice(0, 5)
    .map((action) => ({ name: action.name, value: Number(action.conversions) }));

  return (
    <div className="flex flex-col gap-5">
      {/* KPI rows */}
      {kpiRows.map((row, ri) => (
        <div key={ri} className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {row.map(({ icon, label, value, change }) => (
            <div
              key={label}
              className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-gray-200 bg-white p-4 backdrop-blur-xl transition-all duration-300 hover:border-gray-300 hover:bg-gray-50 2xl:p-5 dark:border-white/8 dark:bg-[#161616] dark:hover:border-white/15 dark:hover:bg-white/3"
            >
              {/* top row: icon left, label right */}
              <div className="flex items-start justify-between">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-gray-200 bg-gray-100 dark:border-white/8 dark:bg-white/5">
                  {React.createElement(icon, { className: 'h-4 w-4 text-gray-400 dark:text-white/50' })}
                </div>
                <p className="text-xs font-semibold tracking-[0.12em] uppercase text-gray-400 dark:text-white/35">{label}</p>
              </div>

              {/* bottom row: value left, change chip right */}
              <div className="mt-4 flex items-end justify-between">
                <p className="text-xl font-bold leading-none text-gray-900 2xl:text-2xl dark:text-white">{value}</p>
                <ChangeChip change={change} />
              </div>
            </div>
          ))}
        </div>
      ))}

      {/* charts row: bar chart left, pie + actions right */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[3fr_2fr]">

      {/* spend / clicks bar chart */}
      <div className="flex flex-col rounded-2xl border border-gray-200 bg-white p-5 shadow-none backdrop-blur-xl dark:border-white/10 dark:bg-[#171717]">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gray-100 dark:bg-white/5">
              <TrendingUp className="h-5 w-5 text-gray-400 dark:text-white/50" />
            </div>
            <p className="text-base 2xl:text-lg font-bold text-gray-900 dark:text-white">Performance over time</p>
          </div>
          <div className="flex items-center gap-1 rounded-xl border border-gray-200 bg-gray-50 p-1 dark:border-white/6 dark:bg-[#111]/60">
            {[
              { v: 'spend', l: 'Spend' },
              { v: 'clicks', l: 'Clicks' },
            ].map(({ v, l }) => (
              <button
                key={v}
                onClick={() => setChartMetric(v)}
                className={`rounded-lg px-3 py-1 text-10 font-semibold transition-all ${chartMetric === v ? 'bg-gray-200 text-gray-900 dark:bg-white/10 dark:text-white' : 'text-gray-400 hover:text-gray-600 dark:text-white/40 dark:hover:text-white/70'}`}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
        <ResponsiveContainer width="100%" height="100%" className="flex-1 min-h-45">
          <AreaChart data={chartData} margin={{ top: 8, right: 4, left: -16, bottom: 0 }}>
            <defs>
              <linearGradient id="areaGradSpend" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#15DCFF" stopOpacity={0.25} />
                <stop offset="100%" stopColor="#15DCFF" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="areaGradClicks" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#6b72f8" stopOpacity={0.25} />
                <stop offset="100%" stopColor="#6b72f8" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="2 4" stroke="rgba(255,255,255,0.04)" vertical={false} />
            <XAxis
              dataKey="name"
              tick={{ fill: '#BEBEBE', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              interval="preserveStartEnd"
            />
            <YAxis tick={{ fill: '#BEBEBE', fontSize: 11 }} axisLine={false} tickLine={false} />
            <ReTooltip content={<ChartTooltip />} cursor={{ stroke: 'rgba(255,255,255,0.08)', strokeWidth: 1 }} />
            <Area
              type="monotone"
              dataKey={chartMetric}
              name={chartMetric === 'spend' ? 'Spend (₹)' : 'Clicks'}
              stroke={chartMetric === 'spend' ? '#15DCFF' : '#6b72f8'}
              strokeWidth={2}
              fill={chartMetric === 'spend' ? 'url(#areaGradSpend)' : 'url(#areaGradClicks)'}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 0, fill: chartMetric === 'spend' ? '#15DCFF' : '#6b72f8' }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* right column: pie + actions stacked */}
      <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4">
        {/* action pie */}
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-none backdrop-blur-xl dark:border-white/10 dark:bg-[#171717]">
          <div className="mb-4 flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gray-100 dark:bg-white/5">
              <Target className="h-5 w-5 text-gray-400 dark:text-white/50" />
            </div>
            <p className="text-base font-bold text-gray-900 dark:text-white">Key conversion actions</p>
          </div>
          {actionPieData.length > 0 ? (
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <defs>
                      {CHART_COLORS.map((c, i) => (
                        <radialGradient key={i} id={`pg${i}`} cx="50%" cy="50%" r="50%">
                          <stop offset="0%" stopColor={c} stopOpacity={0.9} />
                          <stop offset="100%" stopColor={c} stopOpacity={0.5} />
                        </radialGradient>
                      ))}
                    </defs>
                    <Pie
                      data={actionPieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={46}
                      outerRadius={76}
                      paddingAngle={4}
                      dataKey="value"
                    >
                      {actionPieData.map((_, i) => (
                        <Cell
                          key={i}
                          fill={`url(#pg${i % CHART_COLORS.length})`}
                          stroke="transparent"
                        />
                      ))}
                    </Pie>
                    <ReTooltip content={<ChartTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-col gap-2 pr-1">
                {actionPieData.map((item, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ background: CHART_COLORS[i % CHART_COLORS.length] }}
                    />
                    <span className="text-xs whitespace-nowrap text-gray-500 dark:text-[#BEBEBE]">{item.name}</span>
                    <span className="text-xs font-semibold text-gray-900 dark:text-white">
                      {item.value.toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <EmptyState message="No action data" />
          )}
        </div>

        {/* all actions table */}
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-none backdrop-blur-xl dark:border-white/10 dark:bg-[#171717]">
          <div className="border-b border-gray-200 px-4 py-3 dark:border-white/4">
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gray-100 dark:bg-white/5">
                <Layers className="h-5 w-5 text-gray-400 dark:text-white/50" />
              </div>
              <p className="text-base font-bold text-gray-900 dark:text-white">All conversion actions</p>
            </div>
          </div>
          <div className="scrollbar-thin max-h-65 p-2 pb-3 overflow-y-auto">
            {sortedActions.length === 0 && <EmptyState message="No conversion actions recorded in this period" />}
            {sortedActions.map((a, i) => (
              <div
                key={i}
                className="flex items-center justify-between border-b border-gray-200 px-4 py-2 last:border-b-0 hover:bg-gray-100 dark:border-white/2 dark:hover:bg-white/2"
              >
                <span className="truncate pr-4 text-sm text-gray-500 dark:text-[#BEBEBE]">{a.name}</span>
                <span className="shrink-0 text-sm font-semibold text-gray-900 dark:text-white">
                  {formatNumber(a.conversions)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>   {/* end inner grid (pie + actions) */}
      </div>   {/* end right flex-col */}
      </div>   {/* end outer charts grid */}
    </div>
  );
}
