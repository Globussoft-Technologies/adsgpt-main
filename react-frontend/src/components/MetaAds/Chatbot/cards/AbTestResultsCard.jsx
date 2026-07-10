import React from 'react';
import { Trophy } from 'lucide-react';

const AbTestResultsCard = ({ title, metricLabel, confidence, variants = [] }) => (
  <div className="rounded-xl border border-gray-200 bg-white/60 p-3 dark:border-white/10 dark:bg-white/[0.03]">
    <div className="mb-2.5 flex items-center justify-between gap-2">
      {title && <p className="text-sm font-semibold text-gray-900 dark:text-white">{title}</p>}
      {confidence && <span className="text-[11px] text-gray-400 dark:text-gray-500">{confidence}</span>}
    </div>
    {metricLabel && (
      <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">
        {metricLabel}
      </p>
    )}
    <div className="flex flex-col gap-2">
      {variants.map((v, i) => (
        <div
          key={i}
          className={`flex items-center justify-between gap-2 rounded-lg border px-2.5 py-2 ${
            v.isWinner
              ? 'border-[#15DCFF]/30 bg-[#15DCFF]/[0.06] dark:border-[#15DCFF]/20'
              : 'border-gray-100 bg-gray-50/70 dark:border-white/5 dark:bg-white/[0.02]'
          }`}
        >
          <div className="flex items-center gap-1.5">
            {v.isWinner && <Trophy className="h-3.5 w-3.5 text-[#0a8fb0] dark:text-[#15DCFF]" />}
            <span className="text-[13px] font-medium text-gray-900 dark:text-white">{v.name}</span>
          </div>
          <span
            className={`text-[13px] font-semibold ${
              v.isWinner ? 'text-[#0a8fb0] dark:text-[#15DCFF]' : 'text-gray-700 dark:text-gray-300'
            }`}
          >
            {v.value}
          </span>
        </div>
      ))}
    </div>
  </div>
);

export default AbTestResultsCard;
