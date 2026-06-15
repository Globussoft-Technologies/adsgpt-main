import { useState } from 'react';
import { Eye, ImageOff, Lock } from 'lucide-react';
import { Card, SectionTitle } from './_atoms';
import { resolveScreenshotUrl } from './helpers';

// BLOCK 3 — Page Overview. Browser frame (report.jsx style) with the full-page
// capture in a fixed-height, vertically-scrollable viewport.
export default function PageOverview({ report }) {
  const [imgFailed, setImgFailed] = useState(false);
  const src = resolveScreenshotUrl(report?.screenshot_url);
  const showImage = src && !imgFailed;

  return (
    <>
      <SectionTitle icon={Eye} hint="The page exactly as our crawler captured it.">
        Page Overview
      </SectionTitle>

      <Card className="overflow-hidden">
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
          <div className="max-h-150 overflow-y-auto scrollbar-thin bg-[#0e0e12]">
            <img
              src={src}
              alt="Captured landing page"
              loading="lazy"
              onError={() => setImgFailed(true)}
              className="block w-full"
            />
          </div>
        ) : (
          <div className="flex h-100 flex-col items-center justify-center gap-2.5 bg-gray-50 text-gray-400 dark:bg-[#0e0e12] dark:text-white/40">
            <ImageOff className="h-7 w-7" />
            <span className="text-sm">No screenshot available</span>
          </div>
        )}
      </Card>
    </>
  );
}
