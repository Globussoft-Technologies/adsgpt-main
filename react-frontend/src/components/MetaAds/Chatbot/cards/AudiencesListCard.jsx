import React from 'react';
import { Users } from 'lucide-react';

const AudiencesListCard = ({ title, audiences = [] }) => (
  <div className="rounded-xl border border-gray-200 bg-white/60 p-3 dark:border-white/10 dark:bg-white/[0.03]">
    {title && <p className="mb-2.5 text-sm font-semibold text-gray-900 dark:text-white">{title}</p>}
    <div className="flex flex-col gap-2">
      {audiences.map((a, i) => (
        <div
          key={i}
          className="flex items-center gap-2.5 rounded-lg border border-gray-100 bg-gray-50/70 px-2.5 py-2 dark:border-white/5 dark:bg-white/[0.02]"
        >
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-400 dark:bg-white/5 dark:text-white/40">
            <Users className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium text-gray-900 dark:text-white">{a.name}</p>
            <p className="text-[11px] text-gray-500 dark:text-gray-400">{a.type}</p>
          </div>
          <div className="shrink-0 text-right">
            {a.size != null && (
              <p className="text-[13px] font-semibold text-gray-900 dark:text-white">
                {Number(a.size).toLocaleString()}
              </p>
            )}
            {a.status && <p className="text-[10px] text-gray-400 dark:text-gray-500">{a.status}</p>}
          </div>
        </div>
      ))}
      {audiences.length === 0 && (
        <p className="py-3 text-center text-[12px] text-gray-400 dark:text-gray-500">No audiences found</p>
      )}
    </div>
  </div>
);

export default AudiencesListCard;
