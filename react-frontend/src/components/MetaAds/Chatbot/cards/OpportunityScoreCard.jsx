import React from 'react';

const scoreColor = (score) => {
  if (score >= 70) return '#10b981';
  if (score >= 40) return '#f59e0b';
  return '#ef4444';
};

// Meta's Opportunity Score as a radial gauge (SVG ring), plus its
// recommendations below — mirrors the "health score" widgets common in ad
// platforms so the number reads at a glance instead of buried in prose.
const OpportunityScoreCard = ({ title, score = 0, recommendations = [] }) => {
  const clamped = Math.max(0, Math.min(100, score));
  const r = 30;
  const c = 2 * Math.PI * r;
  const color = scoreColor(clamped);
  return (
    <div className="rounded-xl border border-gray-200 bg-white/60 p-3 dark:border-white/10 dark:bg-white/[0.03]">
      <div className="flex items-center gap-3">
        <svg width="76" height="76" viewBox="0 0 76 76" className="shrink-0 -rotate-90">
          <circle cx="38" cy="38" r={r} fill="none" stroke="currentColor" strokeWidth="7" className="text-gray-100 dark:text-white/10" />
          <circle
            cx="38"
            cy="38"
            r={r}
            fill="none"
            stroke={color}
            strokeWidth="7"
            strokeLinecap="round"
            strokeDasharray={`${(clamped / 100) * c} ${c}`}
          />
        </svg>
        <div className="min-w-0 flex-1">
          {title && <p className="truncate text-sm font-semibold text-gray-900 dark:text-white">{title}</p>}
          <p className="text-2xl font-bold" style={{ color }}>
            {Math.round(clamped)}
            <span className="text-xs font-medium text-gray-400 dark:text-gray-500">/100</span>
          </p>
        </div>
      </div>
      {recommendations.length > 0 && (
        <div className="mt-3 flex flex-col gap-1.5 border-t border-gray-100 pt-2.5 dark:border-white/5">
          {recommendations.map((r, i) => (
            <div key={i} className="text-[12px]">
              <p className="font-medium text-gray-800 dark:text-gray-200">{r.title}</p>
              {r.detail && <p className="text-[11px] text-gray-500 dark:text-gray-400">{r.detail}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default OpportunityScoreCard;
