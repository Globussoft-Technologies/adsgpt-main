import { useState } from 'react';
import { ImageOff, Lock } from 'lucide-react';
import { Card, CardCaption } from './_atoms';
import { resolveScreenshotUrl } from './helpers';

// BLOCK 3 — Page Overview. In-card caption + browser frame (report.jsx style)
// with the full-page capture in a fixed-height, vertically-scrollable viewport.
// `bare` skips the Card wrapper so it can share a container with another panel.
// `showCaption=false` drops the in-card heading (when the heading is rendered by
// a parent container instead).
export default function PageOverview({ report, bare = false, showCaption = true }) {
  const [imgFailed, setImgFailed] = useState(false);
  const src = resolveScreenshotUrl(report?.screenshot_url);
  const showImage = src && !imgFailed;

  const content = (
    <>
      {showCaption && (
        <CardCaption hint="A snapshot of the page as seen by our crawler." className="p-6 pb-5">
          Page Overview
        </CardCaption>
      )}

      <div
        className={`flex min-h-0 flex-1 flex-col overflow-hidden ${showCaption ? 'border-t border-gray-200 dark:border-white/10' : ''}`}
      >
        {/* browser chrome */}
        <div className="flex items-center gap-3 border-b border-gray-200 px-4 py-3 dark:border-white/10">
          <div className="flex gap-2">
            <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
            <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
            <span className="h-3 w-3 rounded-full bg-[#28c840]" />
          </div>
          <div className="mx-auto flex max-w-96 flex-1 items-center justify-center gap-2 rounded-lg bg-gray-100 px-3.5 py-2 dark:bg-white/5">
            <Lock className="h-3.5 w-3.5 text-gray-400 dark:text-white/45" />
            <span className="truncate text-sm text-gray-500 dark:text-white/60">
              {report?.url}
            </span>
          </div>
        </div>

        {showImage ? (
          // The capture scrolls inside an absolutely-positioned layer so a tall
          // screenshot doesn't inflate the card's height. When stacked (below lg)
          // there's no neighbouring card to drive the height, so a fixed height
          // keeps it from collapsing; at lg+ it fills the row beside the summary.
          <div className="relative min-h-80 bg-[#0e0e12] lg:flex-1">
            <div className="absolute inset-0 overflow-y-auto scrollbar-thin">
              <img
                src={src}
                alt="Captured landing page"
                loading="lazy"
                onError={() => setImgFailed(true)}
                className="block w-full"
              />
            </div>
          </div>
        ) : (
          <div className="flex h-100 flex-1 flex-col items-center justify-center gap-2.5 bg-gray-50 text-gray-400 dark:bg-[#0e0e12] dark:text-white/40">
            <ImageOff className="h-7 w-7" />
            <span className="text-sm">No screenshot available</span>
          </div>
        )}
      </div>
    </>
  );

  if (bare) return <div className="flex h-full flex-col overflow-hidden">{content}</div>;
  return <Card className="flex h-full flex-col overflow-hidden">{content}</Card>;
}
