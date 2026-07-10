import React from 'react';

// Spend vs. budget meter — mirrors the dashboard's own BudgetBar
// (MetaAdsTableView.jsx) but themed for the chat card style.
const BudgetPacingCard = ({ title, period, spent = 0, budget = 0, unit = '' }) => {
  const pct = budget > 0 ? Math.min(100, (spent / budget) * 100) : 0;
  const over = spent > budget;
  return (
    <div className="rounded-xl border border-gray-200 bg-white/60 p-3 dark:border-white/10 dark:bg-white/[0.03]">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="min-w-0">
          {title && <p className="truncate text-sm font-semibold text-gray-900 dark:text-white">{title}</p>}
          {period && <p className="text-[11px] text-gray-500 dark:text-gray-400">{period}</p>}
        </div>
        <p className={`shrink-0 text-[13px] font-semibold ${over ? 'text-red-500' : 'text-gray-900 dark:text-white'}`}>
          {Math.round(pct)}%
        </p>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-white/5">
        <div
          className={`h-full rounded-full transition-all ${
            over ? 'bg-red-500' : 'bg-gradient-to-r from-[#15DCFF] to-[#6b72f8]'
          }`}
          style={{ width: `${Math.max(pct, 2)}%` }}
        />
      </div>
      <div className="mt-1.5 flex items-center justify-between text-[11px] text-gray-500 dark:text-gray-400">
        <span>
          {unit}{spent.toLocaleString()} spent
        </span>
        <span>
          {unit}{budget.toLocaleString()} budget
        </span>
      </div>
    </div>
  );
};

export default BudgetPacingCard;
