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
  ArrowUpRight,
  ArrowDownRight,
  Layers,
  Radio,
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
import { CHART_COLORS, fmt, fmtINR, getActionVal } from '@/components/MetaAds/metaAdsUtils';
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

// ─── analytics panel ─────────────────────────────────────────────────────────

export default function GoogleAdsAnalyticsPanel({ analyticsData, loading }) {
  const [chartMetric, setChartMetric] = useState('spend');

  if (loading) return <Spinner />;
  if (!analyticsData)
    return <EmptyState message="No analytics data for the selected account and period" />;

  const { stats, chartData = [], actions = [] } = analyticsData;

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
      { icon: DollarSign,        label: 'Spend',       value: fmtINR(stats.spend?.val),                              change: stats.spend?.change       },
      { icon: Eye,               label: 'Impressions', value: parseInt(stats.impressions?.val ?? 0).toLocaleString(), change: stats.impressions?.change  },
      { icon: MousePointerClick, label: 'Clicks',      value: parseInt(stats.clicks?.val ?? 0).toLocaleString(),      change: stats.clicks?.change       },
      { icon: Users,             label: 'Reach',       value: parseInt(stats.reach?.val ?? 0).toLocaleString(),        change: stats.reach?.change        },
    ],
    [
      { icon: TrendingUp, label: 'CTR',       value: `${fmt(stats.ctr?.val)}%`, change: stats.ctr?.change       },
      { icon: Activity,   label: 'CPC',       value: fmtINR(stats.cpc?.val),    change: stats.cpc?.change       },
      { icon: Zap,        label: 'CPM',       value: fmtINR(stats.cpm?.val),    change: stats.cpm?.change       },
      { icon: Radio,      label: 'Frequency', value: fmt(stats.frequency?.val), change: stats.frequency?.change },
    ],
  ];

  const ACTION_LABELS = {
    video_view: 'Video Views',
    link_click: 'Link Clicks',
    landing_page_view: 'Landing Pages',
    page_engagement: 'Page Engagements',
    post_engagement: 'Post Engagements',
    'offsite_conversion.fb_pixel_custom': 'Pixel Custom',
  };
  const PIE_KEYS = ['video_view', 'link_click', 'landing_page_view', 'page_engagement'];
  const actionPieData = PIE_KEYS.map((key) => ({
    name: ACTION_LABELS[key] ?? key,
    value: getActionVal(actions, key),
  })).filter((r) => r.value > 0);

  const sortedActions = [...actions]
    .map((a) => ({
      type: (ACTION_LABELS[a.action_type] ?? a.action_type).replace(/_/g, ' '),
      value: parseInt(a.value, 10),
    }))
    .sort((a, b) => b.value - a.value);

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
            <p className="text-base font-bold text-gray-900 dark:text-white">Key Actions</p>
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
              <p className="text-base font-bold text-gray-900 dark:text-white">All Actions</p>
            </div>
          </div>
          <div className="scrollbar-thin max-h-65 p-2 pb-3 overflow-y-auto">
            {sortedActions.map((a, i) => (
              <div
                key={i}
                className="flex items-center justify-between border-b border-gray-200 px-4 py-2 last:border-b-0 hover:bg-gray-100 dark:border-white/2 dark:hover:bg-white/2"
              >
                <span className="truncate pr-4 text-sm text-gray-500 capitalize dark:text-[#BEBEBE]">{a.type}</span>
                <span className="shrink-0 text-sm font-semibold text-gray-900 dark:text-white">
                  {a.value.toLocaleString()}
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
