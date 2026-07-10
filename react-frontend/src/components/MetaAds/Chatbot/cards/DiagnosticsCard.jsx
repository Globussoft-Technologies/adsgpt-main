import React from 'react';
import { AlertTriangle } from 'lucide-react';

// Raw technical issue list (error codes/subcodes) — distinct from
// FindingCard, which is audit narrative + one-tap fixes. This is for when
// the user wants the actual error list itself.
const DiagnosticsCard = ({ title, issues = [] }) => (
  <div className="rounded-xl border border-gray-200 bg-white/60 p-3 dark:border-white/10 dark:bg-white/[0.03]">
    {title && <p className="mb-2.5 text-sm font-semibold text-gray-900 dark:text-white">{title}</p>}
    <div className="flex flex-col gap-2">
      {issues.map((issue, i) => (
        <div
          key={i}
          className="flex items-start gap-2 rounded-lg border border-red-100 bg-red-50/50 px-2.5 py-2 dark:border-red-500/10 dark:bg-red-500/[0.04]"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" />
          <div className="min-w-0 flex-1">
            <p className="text-[12px] leading-relaxed text-gray-800 dark:text-gray-200">{issue.message}</p>
            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[10px] text-gray-400 dark:text-gray-500">
              {issue.entity && <span>{issue.entity}</span>}
              {issue.code && <span className="font-mono">code {issue.code}</span>}
              {issue.subcode && <span className="font-mono">sub {issue.subcode}</span>}
            </div>
          </div>
        </div>
      ))}
      {issues.length === 0 && (
        <p className="py-3 text-center text-[12px] text-gray-400 dark:text-gray-500">No issues found</p>
      )}
    </div>
  </div>
);

export default DiagnosticsCard;
