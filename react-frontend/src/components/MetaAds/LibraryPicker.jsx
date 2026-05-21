import React, { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import {
  Loader2,
  ChevronLeft,
  ChevronRight,
  Image as ImageIcon,
  Check,
} from 'lucide-react';
import { getMediaLibrary } from '@/apis/metaAds/metaAdsApi';

/**
 * Generated-media picker for the campaign-wizard "Select from library" tab.
 * Backed by GET /adsgpt/generated-media/library/:userId — slim payload of
 * { _id, type, model, url, createdAt } per row.
 *
 * Controlled — calls onPick(absoluteUrl, doc) when the user selects an item.
 */
const PAGE_SIZE = 24;

// Saved rows store relative paths ("/creatives/.../x.webp"); render + Meta
// upload need the absolute URL anchored at the configured S3 host.
const S3_BASE_URL = import.meta.env.VITE_S3_BASE_URL || '';
const absolutize = (path) => {
  if (!path || typeof path !== 'string') return path;
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  if (!S3_BASE_URL) return path;
  return path.startsWith('/')
    ? `${S3_BASE_URL.replace(/\/$/, '')}${path}`
    : `${S3_BASE_URL.replace(/\/$/, '')}/${path}`;
};

const LibraryPicker = ({ type = 'image', selectedUrl, onPick }) => {
  const userId = useSelector((s) => s?.socket?.userData?.user_id) || null;

  const [page, setPage] = useState(1);
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!userId) return undefined;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getMediaLibrary({ userId, type, page, limit: PAGE_SIZE })
      .then((r) => {
        if (cancelled) return;
        setItems(Array.isArray(r?.data) ? r.data : []);
        setTotal(r?.total || 0);
        setHasMore(!!r?.hasMore);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(
          e?.response?.data?.message || e.message || 'Failed to load library',
        );
        setItems([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId, type, page]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const canPrev = page > 1 && !loading;
  const canNext = hasMore && !loading;

  const goPrev = () => {
    if (!canPrev) return;
    setPage(page - 1);
  };
  const goNext = () => {
    if (!canNext) return;
    setPage(page + 1);
  };

  if (!userId) {
    return (
      <div className="rounded-2xl border border-dashed border-white/15 bg-white/2 px-4 py-10 text-center text-sm text-white/60">
        Sign in to browse your generated-media library.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <div className="rounded-xl border border-red-400/30 bg-red-400/10 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {loading && items.length === 0 ? (
        <div className="flex items-center justify-center rounded-2xl border border-dashed border-white/15 bg-white/2 px-4 py-10 text-sm text-white/60">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : !loading && items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/15 bg-white/2 px-4 py-10 text-center text-sm text-white/60">
          <ImageIcon className="mx-auto mb-2 h-6 w-6 text-white/40" />
          {`No generated ${type}s yet. Create some from Ad Studio first.`}
        </div>
      ) : (
        <div
          className={`grid grid-cols-3 gap-2 transition-opacity md:grid-cols-4 2xl:grid-cols-5 ${loading ? 'opacity-60' : ''}`}
        >
          {items.map((doc) => {
            const url = absolutize(doc?.url || null);
            if (!url) return null;
            const isSelected = url === selectedUrl;
            return (
              <button
                key={doc._id}
                type="button"
                onClick={() => onPick(url, doc)}
                title={doc.model || ''}
                className={`group relative aspect-square overflow-hidden rounded-xl border transition-all ${
                  isSelected
                    ? 'border-[#15DCFF] ring-2 ring-[#15DCFF]/40'
                    : 'border-white/10 hover:border-white/30'
                }`}
              >
                {type === 'video' ? (
                  <video
                    src={url}
                    className="h-full w-full object-cover"
                    muted
                    playsInline
                  />
                ) : (
                  <img
                    src={url}
                    alt=""
                    className="h-full w-full object-cover transition-transform group-hover:scale-[1.03]"
                    loading="lazy"
                  />
                )}
                {isSelected && (
                  <div className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-[#15DCFF] text-black">
                    <Check className="h-3 w-3" strokeWidth={3} />
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-white/55">
          <span>
            Page {page} of {totalPages} · {total} total
          </span>
          <div className="flex gap-1">
            <button
              type="button"
              disabled={!canPrev}
              onClick={goPrev}
              className="flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1 transition-all hover:border-white/25 disabled:opacity-40"
            >
              <ChevronLeft className="h-3 w-3" /> Prev
            </button>
            <button
              type="button"
              disabled={!canNext}
              onClick={goNext}
              className="flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1 transition-all hover:border-white/25 disabled:opacity-40"
            >
              Next <ChevronRight className="h-3 w-3" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default LibraryPicker;
