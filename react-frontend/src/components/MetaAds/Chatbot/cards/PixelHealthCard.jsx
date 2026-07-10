import React from 'react';
import { AlertCircle, CheckCircle2, XCircle } from 'lucide-react';

const STATUS = {
  good: { Icon: CheckCircle2, color: 'text-emerald-500', label: 'Healthy' },
  warning: { Icon: AlertCircle, color: 'text-amber-500', label: 'Needs attention' },
  bad: { Icon: XCircle, color: 'text-red-500', label: 'Issue detected' },
};

const PixelHealthCard = ({ pixelName, lastFiredAt, matchRate, status = 'warning', notes }) => {
  const s = STATUS[status] || STATUS.warning;
  const { Icon } = s;
  return (
    <div className="rounded-xl border border-gray-200 bg-white/60 p-3 dark:border-white/10 dark:bg-white/[0.03]">
      <div className="flex items-start gap-2.5">
        <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${s.color}`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold text-gray-900 dark:text-white">
              {pixelName || 'Pixel'}
            </p>
            <span className={`text-[11px] font-medium ${s.color}`}>{s.label}</span>
          </div>
          {notes && <p className="mt-0.5 text-[12px] text-gray-600 dark:text-gray-400">{notes}</p>}
          <div className="mt-2 grid grid-cols-2 gap-2">
            {matchRate && (
              <div className="rounded-lg border border-gray-100 bg-gray-50/70 px-2.5 py-1.5 dark:border-white/5 dark:bg-white/[0.02]">
                <p className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500">Match rate</p>
                <p className="text-[13px] font-semibold text-gray-900 dark:text-white">{matchRate}</p>
              </div>
            )}
            {lastFiredAt && (
              <div className="rounded-lg border border-gray-100 bg-gray-50/70 px-2.5 py-1.5 dark:border-white/5 dark:bg-white/[0.02]">
                <p className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500">Last fired</p>
                <p className="text-[13px] font-semibold text-gray-900 dark:text-white">{lastFiredAt}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default PixelHealthCard;
