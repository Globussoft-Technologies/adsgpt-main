import React from 'react';
import { AlertTriangle, Info, TriangleAlert } from 'lucide-react';

const SEVERITY = {
  high: {
    Icon: AlertTriangle,
    dot: 'text-red-500',
    badge: 'bg-red-500/10 text-red-600 dark:text-red-400',
    label: 'High',
  },
  medium: {
    Icon: TriangleAlert,
    dot: 'text-amber-500',
    badge: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    label: 'Medium',
  },
  low: {
    Icon: Info,
    dot: 'text-sky-500',
    badge: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
    label: 'Low',
  },
};

// Audit result: a list of findings. Each finding may carry a one-tap action
// chip whose prompt is sent as the next turn (the model then makes the actual
// Meta write via the MCP tool, which the user confirms). This card performs no
// Meta operations itself.
const FindingCard = ({ title, findings = [], onAction, disabled }) => (
  <div className="rounded-xl border border-gray-200 bg-white/60 p-3 dark:border-white/10 dark:bg-white/[0.03]">
    {title && (
      <p className="mb-2.5 text-sm font-semibold text-gray-900 dark:text-white">{title}</p>
    )}
    <div className="flex flex-col gap-2.5">
      {findings.map((f, i) => {
        const sev = SEVERITY[f.severity] || SEVERITY.low;
        const { Icon } = sev;
        return (
          <div
            key={i}
            className="rounded-lg border border-gray-100 bg-gray-50/70 p-2.5 dark:border-white/5 dark:bg-white/[0.02]"
          >
            <div className="flex items-start gap-2">
              <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${sev.dot}`} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-[13px] font-medium text-gray-900 dark:text-white">{f.title}</p>
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${sev.badge}`}>
                    {sev.label}
                  </span>
                </div>
                <p className="mt-0.5 text-[12px] leading-relaxed text-gray-600 dark:text-gray-400">
                  {f.detail}
                </p>
                {f.actionLabel && f.actionPrompt && (
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => onAction?.(f.actionPrompt)}
                    className="mt-2 rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-medium text-gray-700 transition-colors hover:border-[#0082FB] hover:text-[#0082FB] disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/15 dark:bg-white/5 dark:text-gray-200 dark:hover:border-[#0082FB] dark:hover:text-[#15DCFF]"
                  >
                    {f.actionLabel}
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  </div>
);

export default FindingCard;
