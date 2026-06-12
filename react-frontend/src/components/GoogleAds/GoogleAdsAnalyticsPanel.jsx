import React, { useState } from 'react';
import {
  DollarSign, Eye, MousePointerClick, TrendingUp, Activity, Zap, Target, Layers,
} from 'lucide-react';
import {
  Area, AreaChart, XAxis, YAxis, CartesianGrid, Tooltip as ReTooltip,
  ResponsiveContainer,
} from 'recharts';
import { CHART_COLORS, fmt } from '@/components/MetaAds/metaAdsUtils';
import { Spinner, EmptyState, ChartTooltip } from '@/components/MetaAds/MetaAdsAtoms';

function ChangeChip({ change }) {
  if (change == null || change === 0) return <span className="text-xs text-gray-400 dark:text-white/30">—</span>;
  const up = change > 0;
  return (
    <span className={`flex items-center gap-0.5 rounded-lg px-1.5 py-0.5 text-[10px] font-bold ${up ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-red-500/10 text-red-600 dark:text-red-400'}`}>
      {up ? '▲' : '▼'} {Math.abs(change)}%
    </span>
  );
}

export default function GoogleAdsAnalyticsPanel({ analyticsData, loading }) {
  const [chartMetric, setChartMetric] = useState('spend');

  if (loading) return <Spinner />;
  if (!analyticsData) return <EmptyState message="No analytics data for the selected account and period" />;

  const { stats, chartData = [] } = analyticsData;

  const hasData = stats && Object.values(stats).some((s) => parseFloat(s?.val) > 0);
  if (!hasData) {
    return (
      <div className="flex w-full flex-col items-center justify-center px-4 py-12 text-center">
        <p className="text-sm font-semibold text-gray-900 dark:text-white">No data for this period</p>
        <p className="mt-2 max-w-md text-xs leading-relaxed text-gray-500 dark:text-[#BEBEBE]">
          No impressions, clicks, or spend recorded for the selected date range. Try a different period.
        </p>
      </div>
    );
  }

  const kpiRows = [
    [
      { icon: DollarSign,        label: 'Spend',       value: `$${fmt(stats.spend?.val)}`,                           change: stats.spend?.change       },
      { icon: Eye,               label: 'Impressions', value: parseInt(stats.impressions?.val ?? 0).toLocaleString(), change: stats.impressions?.change  },
      { icon: MousePointerClick, label: 'Clicks',      value: parseInt(stats.clicks?.val ?? 0).toLocaleString(),      change: stats.clicks?.change       },
      { icon: Target,            label: 'Conversions', value: parseInt(stats.conversions?.val ?? 0).toLocaleString(), change: stats.conversions?.change  },
    ],
    [
      { icon: TrendingUp, label: 'CTR',  value: `${fmt(stats.ctr?.val)}%`,    change: stats.ctr?.change  },
      { icon: Activity,   label: 'CPC',  value: `$${fmt(stats.cpc?.val)}`,    change: stats.cpc?.change  },
      { icon: Zap,        label: 'CPM',  value: `$${fmt(stats.cpm?.val)}`,    change: stats.cpm?.change  },
      { icon: Layers,     label: 'CPA',  value: `$${fmt(stats.avgCpa?.val)}`, change: stats.avgCpa?.change },
    ],
  ];

  return (
    <div className="flex flex-col gap-5">
      {kpiRows.map((row, ri) => (
        <div key={ri} className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {row.map(({ icon, label, value, change }) => (
            <div
              key={label}
              className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-gray-200 bg-white p-4 backdrop-blur-xl transition-all duration-300 hover:border-gray-300 hover:bg-gray-50 2xl:p-5 dark:border-white/8 dark:bg-[#161616] dark:hover:border-white/15 dark:hover:bg-white/3"
            >
              <div className="flex items-start justify-between">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-gray-200 bg-gray-100 dark:border-white/8 dark:bg-white/5">
                  {React.createElement(icon, { className: 'h-4 w-4 text-gray-400 dark:text-white/50' })}
                </div>
                <p className="text-xs font-semibold tracking-[0.12em] uppercase text-gray-400 dark:text-white/35">{label}</p>
              </div>
              <div className="mt-4 flex items-end justify-between">
                <p className="text-xl font-bold leading-none text-gray-900 2xl:text-2xl dark:text-white">{value}</p>
                <ChangeChip change={change} />
              </div>
            </div>
          ))}
        </div>
      ))}

      {/* chart */}
      <div className="flex flex-col rounded-2xl border border-gray-200 bg-white p-5 backdrop-blur-xl dark:border-white/10 dark:bg-[#171717]">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gray-100 dark:bg-white/5">
              <TrendingUp className="h-5 w-5 text-gray-400 dark:text-white/50" />
            </div>
            <p className="text-base 2xl:text-lg font-bold text-gray-900 dark:text-white">Performance over time</p>
          </div>
          <div className="flex items-center gap-1 rounded-xl border border-gray-200 bg-gray-50 p-1 dark:border-white/6 dark:bg-[#111]/60">
            {[{ v: 'spend', l: 'Spend' }, { v: 'clicks', l: 'Clicks' }, { v: 'impressions', l: 'Impressions' }].map(({ v, l }) => (
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
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={chartData} margin={{ top: 8, right: 4, left: -16, bottom: 0 }}>
            <defs>
              <linearGradient id="gAreaGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#4285F4" stopOpacity={0.25} />
                <stop offset="100%" stopColor="#4285F4" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="2 4" stroke="rgba(255,255,255,0.04)" vertical={false} />
            <XAxis dataKey="name" tick={{ fill: '#BEBEBE', fontSize: 11 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
            <YAxis tick={{ fill: '#BEBEBE', fontSize: 11 }} axisLine={false} tickLine={false} />
            <ReTooltip content={<ChartTooltip />} cursor={{ stroke: 'rgba(255,255,255,0.08)', strokeWidth: 1 }} />
            <Area
              type="monotone"
              dataKey={chartMetric}
              name={chartMetric}
              stroke="#4285F4"
              strokeWidth={2}
              fill="url(#gAreaGrad)"
              dot={false}
              activeDot={{ r: 4, strokeWidth: 0, fill: '#4285F4' }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
