import React from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { CHART_COLORS } from '@/components/MetaAds/metaAdsUtils';

const ChartTooltip = ({ active, payload, label, unit }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-gray-200 bg-white/95 px-2.5 py-1.5 text-[11px] shadow-lg dark:border-white/10 dark:bg-[#1a1a1a]/95">
      <div className="mb-0.5 font-medium text-gray-500 dark:text-gray-400">{label}</div>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: p.color }} />
          <span className="text-gray-600 dark:text-gray-300">{p.name}</span>
          <span className="ml-auto font-semibold text-gray-900 dark:text-white">
            {unit}{p.value}
          </span>
        </div>
      ))}
    </div>
  );
};

// Merges N named series (each its own points array) into one flat array
// recharts can plot together: [{ date, [seriesLabel]: value, ... }].
const mergeSeries = (series) => {
  const byDate = new Map();
  series.forEach(({ label, points = [] }) => {
    points.forEach(({ date, value }) => {
      const row = byDate.get(date) || { date };
      row[label] = value;
      byDate.set(date, row);
    });
  });
  return Array.from(byDate.values());
};

// Time-series line/area chart — the one genuinely date-wise card, for
// "how has X trended" questions. Multiple named series overlay on one chart.
const TrendChartCard = ({ title, unit = '', series = [] }) => {
  const data = mergeSeries(series);
  if (data.length === 0) return null;
  return (
    <div className="rounded-xl border border-gray-200 bg-white/60 p-3 dark:border-white/10 dark:bg-white/[0.03]">
      {title && <p className="mb-2 text-sm font-semibold text-gray-900 dark:text-white">{title}</p>}
      <div className="h-44 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <defs>
              {series.map((s, i) => (
                <linearGradient key={s.label} id={`trend-${i}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={CHART_COLORS[i % CHART_COLORS.length]} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={CHART_COLORS[i % CHART_COLORS.length]} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-gray-100 dark:text-white/5" vertical={false} />
            <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="currentColor" className="text-gray-400 dark:text-white/30" tickMargin={6} />
            <YAxis tick={{ fontSize: 10 }} stroke="currentColor" className="text-gray-400 dark:text-white/30" width={36} />
            <Tooltip content={<ChartTooltip unit={unit} />} />
            {series.map((s, i) => (
              <Area
                key={s.label}
                type="monotone"
                dataKey={s.label}
                name={s.label}
                stroke={CHART_COLORS[i % CHART_COLORS.length]}
                strokeWidth={2}
                fill={`url(#trend-${i})`}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default TrendChartCard;
