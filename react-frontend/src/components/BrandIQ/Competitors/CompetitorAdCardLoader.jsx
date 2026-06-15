import React from 'react';

// Kept visually identical to AdLibrary's AdCreativeCardLoader so both grids
// share the same skeleton look (same colors, light/dark support, no shimmer).
const CompetitorAdCardLoader = () => {
  return (
    <div className="relative z-10 w-full max-w-full animate-pulse overflow-hidden rounded-xl bg-gradient-to-br from-zinc-200 to-zinc-200 shadow-lg dark:from-slate-800 dark:to-slate-800">
      {/* Header */}
      <div className="flex items-center justify-between p-2 2xl:p-3">
        <div className="flex items-center gap-3">
          <div className="h-7 w-7 rounded-full bg-zinc-300/80 2xl:h-9 2xl:w-9 dark:bg-slate-600/80" />
          <div className="h-6 w-24 rounded bg-zinc-300/80 dark:bg-slate-600/80" />
        </div>
        <div className="flex items-center gap-2">
          <div className="h-6 w-6 rounded-full bg-zinc-300/80 2xl:h-7 2xl:w-7 dark:bg-slate-600/80" />
          <div className="h-6 w-6 rounded-full bg-zinc-300/80 2xl:h-7 2xl:w-7 dark:bg-slate-600/80" />
        </div>
      </div>

      {/* Image Placeholder */}
      <div className="h-52 w-full bg-zinc-300/80 2xl:h-72 dark:bg-slate-600/80" />

      {/* Text placeholders */}
      <div className="space-y-2 p-3.5 2xl:space-y-3 2xl:p-4">
        <div className="h-2.5 w-full rounded bg-zinc-300/80 2xl:h-3.5 dark:bg-slate-600/80" />
        <div className="h-2.5 w-2/3 rounded bg-zinc-300/80 2xl:h-3.5 dark:bg-slate-600/80" />
      </div>
    </div>
  );
};

export default CompetitorAdCardLoader;
