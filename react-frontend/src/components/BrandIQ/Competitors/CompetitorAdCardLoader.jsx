import React from 'react';

// Kept visually identical to AdLibrary's AdCreativeCardLoader so both grids
// share the same skeleton look (same colors, light/dark support, no shimmer).
const HEIGHT_VARIANTS = [
  'h-64 2xl:h-80',
  'h-52 2xl:h-64',
  'h-72 2xl:h-88',
  'h-60 2xl:h-72',
  'h-80 2xl:h-96',
  'h-56 2xl:h-68',
  'h-68 2xl:h-84',
  'h-64 2xl:h-80',
  'h-52 2xl:h-64',
  'h-76 2xl:h-92',
  'h-60 2xl:h-72',
  'h-72 2xl:h-88',
  'h-56 2xl:h-68',
  'h-64 2xl:h-80',
  'h-52 2xl:h-64',
];

const CompetitorAdCardLoader = ({ index = 0 }) => {
  const imageHeightClass = HEIGHT_VARIANTS[index % HEIGHT_VARIANTS.length];

  return (
    <div className="relative z-10 w-full max-w-full animate-pulse overflow-hidden rounded-xl bg-gradient-to-br from-zinc-200 to-zinc-200 shadow-sm dark:from-slate-800 dark:to-slate-800">
      {/* Header */}
      <div className="flex items-center justify-between p-2 2xl:p-3">
        <div className="flex items-center gap-3">
          <div className="h-7 w-7 rounded-full bg-zinc-300/80 2xl:h-9 2xl:w-9 dark:bg-slate-600/80" />
          <div className="h-5 w-24 rounded bg-zinc-300/80 dark:bg-slate-600/80" />
        </div>
        <div className="flex items-center gap-2">
          <div className="h-5 w-5 rounded-full bg-zinc-300/80 2xl:h-6 2xl:w-6 dark:bg-slate-600/80" />
          <div className="h-5 w-5 rounded-full bg-zinc-300/80 2xl:h-6 2xl:w-6 dark:bg-slate-600/80" />
        </div>
      </div>

      {/* Image Placeholder */}
      <div className={`w-full bg-zinc-300/80 dark:bg-slate-600/80 ${imageHeightClass}`} />

      {/* Text placeholders */}
      <div className="space-y-2 p-3 2xl:space-y-2.5 2xl:p-3.5">
        <div className="h-2.5 w-full rounded bg-zinc-300/80 2xl:h-3.5 dark:bg-slate-600/80" />
        <div className="h-2.5 w-2/3 rounded bg-zinc-300/80 2xl:h-3.5 dark:bg-slate-600/80" />
      </div>
    </div>
  );
};

export default CompetitorAdCardLoader;
