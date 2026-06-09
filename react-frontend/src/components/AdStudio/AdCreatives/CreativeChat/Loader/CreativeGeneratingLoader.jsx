import React from 'react';

const CreativeGeneratingLoader = () => {
  const letters = ['G', 'e', 'n', 'e', 'r', 'a', 't', 'i', 'n', 'g'];

  return (
    <div className="container_ flex h-full w-full items-center justify-center bg-gradient-to-b from-gray-50 to-gray-100 dark:from-[#010204] dark:to-[#1D2150]">
      <div className="font-inter relative flex h-44 w-44 scale-[.7] items-center justify-center rounded-full text-lg font-light text-gray-700 select-none dark:text-white">
        {letters.map((letter, index) => (
          <span
            key={index}
            className="animate-loader-letter z-10 inline-block rounded-full opacity-40"
            style={{ animationDelay: `${index * 0.1}s` }}
          >
            {letter}
          </span>
        ))}

        <div className="animate-loader-rotate absolute top-0 left-0 z-0 aspect-square w-full rounded-full"></div>
      </div>
    </div>
  );
};

export default CreativeGeneratingLoader;

export function FilerobotEditorShimmer() {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <div className="backdrop-blur-100 m-9 flex w-full flex-col gap-4 rounded-xl border border-black/10 bg-white/80 p-7 dark:border-gray-700/20 dark:bg-[#070707]/80">
        {/* Header shimmer */}
        <div className="flex justify-between">
          <div className="backdrop-blur-100 h-10 w-24 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-800/80"></div>
          <div className="backdrop-blur-100 h-10 w-10 animate-pulse rounded-full bg-gray-200 dark:bg-gray-800/80"></div>
        </div>

        <div className="flex">
          {/* Sidebar shimmer */}
          <div className="mr-4 flex w-16 flex-col gap-3">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-10 w-10 animate-pulse rounded-md bg-gray-200 dark:bg-gray-800"></div>
            ))}
          </div>

          {/* Editor main canvas shimmer */}
          <div className="h-[70vh] flex-1 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-900"></div>
        </div>

        {/* Bottom toolbar shimmer */}
        <div className="mt-4 flex justify-center gap-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-8 w-20 animate-pulse rounded-md bg-gray-200 dark:bg-gray-800"></div>
          ))}
        </div>
      </div>
    </div>
  );
}
