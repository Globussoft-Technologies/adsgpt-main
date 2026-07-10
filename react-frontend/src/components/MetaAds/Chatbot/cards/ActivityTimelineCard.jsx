import React from 'react';

const ActivityTimelineCard = ({ title, events = [] }) => (
  <div className="rounded-xl border border-gray-200 bg-white/60 p-3 dark:border-white/10 dark:bg-white/[0.03]">
    {title && <p className="mb-2.5 text-sm font-semibold text-gray-900 dark:text-white">{title}</p>}
    <div className="flex flex-col">
      {events.map((e, i) => (
        <div key={i} className="relative flex gap-3 pb-3 last:pb-0">
          {i < events.length - 1 && (
            <span className="absolute top-2.5 left-[3.5px] h-full w-px bg-gray-200 dark:bg-white/10" />
          )}
          <span className="relative mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[#6b72f8]" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-medium text-gray-400 dark:text-gray-500">{e.time}</span>
              {e.actor && <span className="text-[11px] text-gray-400 dark:text-gray-500">· {e.actor}</span>}
            </div>
            <p className="text-[13px] text-gray-800 dark:text-gray-200">{e.description}</p>
          </div>
        </div>
      ))}
      {events.length === 0 && (
        <p className="py-3 text-center text-[12px] text-gray-400 dark:text-gray-500">No recent activity</p>
      )}
    </div>
  </div>
);

export default ActivityTimelineCard;
