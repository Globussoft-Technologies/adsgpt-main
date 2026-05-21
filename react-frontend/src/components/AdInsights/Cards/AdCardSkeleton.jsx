import React from 'react';

const AdCardSkeleton = () => {
  return (
    <div className="w-full animate-pulse overflow-hidden rounded-xl border border-white/10 bg-[#0D0D0D] text-white shadow-[0_0_25px_rgba(0,0,0,0.45)]">
      {/* Header Skeleton */}
      <div className="flex h-12 items-center justify-between border-b border-white/5 bg-[#141414] px-3">
        <div className="flex items-center gap-3">
          <div className="h-7 w-7 rounded-full bg-gray-700/70"></div>
          <div className="h-3.5 w-28 rounded-md bg-gray-700/60"></div>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-5 w-5 rounded-full bg-gray-700/70"></div>
          <div className="h-4 w-4 rounded bg-gray-700/70"></div>
        </div>
      </div>

      {/* Image / Media Skeleton */}
      <div className="aspect-[4/3] w-full bg-gray-800/60"></div>

      {/* Content Skeleton */}
      <div className="flex flex-col gap-4 p-4">
        {/* Text / Description */}
        <div className="space-y-2">
          <div className="h-3.5 w-full rounded-md bg-gray-700/60"></div>
          <div className="h-3.5 w-5/6 rounded-md bg-gray-700/60"></div>
          <div className="h-3.5 w-3/5 rounded-md bg-gray-700/60"></div>
        </div>

        {/* Divider */}
        <div className="h-px w-full bg-gray-700/40"></div>

        {/* Footer / Buttons */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="h-7 w-28 rounded-full bg-gray-700/70"></div>
          <div className="flex items-center gap-2">
            <div className="h-4 w-4 rounded bg-gray-700/70"></div>
            <div className="h-3.5 w-24 rounded-md bg-gray-700/70"></div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdCardSkeleton;
