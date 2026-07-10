import React from 'react';
import { CHART_COLORS } from '@/components/MetaAds/metaAdsUtils';

// Horizontal share breakdown (e.g. share of spend across campaigns). CSS bars
// — lighter than recharts at sidebar width. Bar width is value / max.
const BarBreakdownCard = ({ title, unit, items = [] }) => {
  const max = Math.max(...items.map((i) => Number(i.value) || 0), 1);
  return (
    <div className="rounded-xl border border-gray-200 bg-white/60 p-3 dark:border-white/10 dark:bg-white/[0.03]">
      {title && (
        <p className="mb-2.5 text-sm font-semibold text-gray-900 dark:text-white">{title}</p>
      )}
      <div className="flex flex-col gap-2.5">
        {items.map((item, i) => {
          const pct = Math.max(((Number(item.value) || 0) / max) * 100, 2);
          const color = CHART_COLORS[i % CHART_COLORS.length];
          return (
            <div key={i}>
              <div className="mb-1 flex items-center justify-between text-[12px]">
                <span className="truncate text-gray-700 dark:text-gray-300">{item.label}</span>
                <span className="ml-2 shrink-0 font-medium text-gray-900 dark:text-white">
                  {item.valueLabel ?? `${unit ?? ''}${item.value}`}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-white/5">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${pct}%`,
                    background: `linear-gradient(90deg, ${color}, ${color}99)`,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default BarBreakdownCard;
