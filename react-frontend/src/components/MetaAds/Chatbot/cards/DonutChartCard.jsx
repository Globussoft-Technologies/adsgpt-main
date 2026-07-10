import React from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { CHART_COLORS } from '@/components/MetaAds/metaAdsUtils';

// One entity's composition by a single dimension (age, gender, placement,
// device...) — a donut, distinct from show_bar_breakdown's ranked list
// across entities. Legend doubles as the numeric readout (donut labels get
// cramped fast at sidebar width).
const DonutChartCard = ({ title, items = [] }) => {
  if (items.length === 0) return null;
  return (
    <div className="rounded-xl border border-gray-200 bg-white/60 p-3 dark:border-white/10 dark:bg-white/[0.03]">
      {title && <p className="mb-2 text-sm font-semibold text-gray-900 dark:text-white">{title}</p>}
      <div className="flex items-center gap-3">
        <div className="h-28 w-28 shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={items} dataKey="value" nameKey="label" innerRadius="60%" outerRadius="100%" strokeWidth={0}>
                {items.map((_, i) => (
                  <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                formatter={(value, name) => [value, name]}
                contentStyle={{ fontSize: 11, borderRadius: 8 }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          {items.map((item, i) => (
            <div key={i} className="flex items-center gap-1.5 text-[12px]">
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: CHART_COLORS[i % CHART_COLORS.length] }}
              />
              <span className="min-w-0 flex-1 truncate text-gray-700 dark:text-gray-300">{item.label}</span>
              <span className="shrink-0 font-medium text-gray-900 dark:text-white">
                {item.valueLabel ?? item.value}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default DonutChartCard;
