import React from 'react';
import { Play } from 'lucide-react';

const CreativeGalleryCard = ({ title, items = [] }) => (
  <div className="rounded-xl border border-gray-200 bg-white/60 p-3 dark:border-white/10 dark:bg-white/[0.03]">
    {title && <p className="mb-2.5 text-sm font-semibold text-gray-900 dark:text-white">{title}</p>}
    <div className="grid grid-cols-3 gap-2">
      {items.map((item, i) => (
        <div
          key={i}
          className="relative aspect-square overflow-hidden rounded-lg border border-gray-100 bg-gray-100 dark:border-white/5 dark:bg-white/5"
        >
          {item.thumbnailUrl ? (
            <img src={item.thumbnailUrl} alt={item.name || ''} className="h-full w-full object-cover" />
          ) : null}
          {item.type === 'video' && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/25">
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-white/90">
                <Play className="h-3 w-3 fill-gray-900 text-gray-900" />
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
    {items.length === 0 && (
      <p className="py-3 text-center text-[12px] text-gray-400 dark:text-gray-500">No creatives found</p>
    )}
  </div>
);

export default CreativeGalleryCard;
