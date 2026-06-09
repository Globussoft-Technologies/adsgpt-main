import React from 'react';

const CompetitorAdCardLoader = () => {
  return (
    <div className="relative z-10 w-full max-w-full animate-pulse overflow-hidden rounded-xl bg-gradient-to-br from-slate-800 to-slate-900 shadow-lg">
      {/* Header */}
      <div className="flex items-center justify-between p-2 2xl:p-3">
        <div className="flex items-center gap-3">
          <div className="h-7 w-7 rounded-full bg-slate-600/80 2xl:h-9 2xl:w-9" />
          <div className="h-6 w-24 rounded bg-slate-600/80" />
        </div>
        <div className="flex items-center gap-2">
          <div className="h-6 w-6 rounded-full bg-slate-600/80 2xl:h-7 2xl:w-7" />
          <div className="h-6 w-6 rounded-full bg-slate-600/80 2xl:h-7 2xl:w-7" />
        </div>
      </div>

      {/* Image Placeholder with shimmer */}
      <div className="relative h-52 w-full overflow-hidden bg-slate-700/50 2xl:h-72">
        <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/10 to-transparent" />
      </div>

      {/* Text placeholders */}
      <div className="space-y-2 p-3.5 2xl:space-y-3 2xl:p-4">
        <div className="h-2.5 w-full rounded bg-slate-600/80 2xl:h-3.5" />
        <div className="h-2.5 w-2/3 rounded bg-slate-600/80 2xl:h-3.5" />
      </div>
    </div>
  );
};

export default CompetitorAdCardLoader;
