import React from 'react';
import { Zap } from 'lucide-react';

const AdRulesCard = ({ title, rules = [] }) => (
  <div className="rounded-xl border border-gray-200 bg-white/60 p-3 dark:border-white/10 dark:bg-white/[0.03]">
    {title && <p className="mb-2.5 text-sm font-semibold text-gray-900 dark:text-white">{title}</p>}
    <div className="flex flex-col gap-2">
      {rules.map((rule, i) => (
        <div
          key={i}
          className="rounded-lg border border-gray-100 bg-gray-50/70 px-2.5 py-2 dark:border-white/5 dark:bg-white/[0.02]"
        >
          <div className="flex items-center gap-2">
            <Zap className="h-3.5 w-3.5 shrink-0 text-[#6b72f8]" />
            <p className="min-w-0 flex-1 truncate text-[13px] font-medium text-gray-900 dark:text-white">
              {rule.name}
            </p>
            {rule.status && (
              <span className="shrink-0 text-[10px] font-medium text-gray-400 dark:text-gray-500">
                {rule.status}
              </span>
            )}
          </div>
          <p className="mt-1 text-[12px] text-gray-600 dark:text-gray-400">
            <span className="text-gray-400 dark:text-gray-500">If</span> {rule.condition}{' '}
            <span className="text-gray-400 dark:text-gray-500">then</span> {rule.action}
          </p>
        </div>
      ))}
      {rules.length === 0 && (
        <p className="py-3 text-center text-[12px] text-gray-400 dark:text-gray-500">No automated rules</p>
      )}
    </div>
  </div>
);

export default AdRulesCard;
