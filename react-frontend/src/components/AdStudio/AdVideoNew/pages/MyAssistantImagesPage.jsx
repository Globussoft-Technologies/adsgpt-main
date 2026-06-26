import Masonry from 'react-masonry-css';
import { Download, Loader2, Sparkles } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';

import { getMediaLibrary } from '@/apis/metaAds/metaAdsApi';
import { getUserId } from '@/components/AdStudio/AdCreativeNew/ai-creatives/apiClient';
import toMediaUrl from '@/utils/mediaUrl';

// AI Assistant ("Sherry") image library. Reads the same GeneratedMedia rows the
// credit-finalize already persists (model: "agent"), via the existing
// /generated-media/library/:userId endpoint — so no backend change is needed to
// surface chat-generated images here in My Space.

const breakpointColumnsObj = { default: 4, 1280: 3, 1024: 3, 700: 2, 340: 1 };
const PAGE_SIZE = 24;

const downloadImage = async (url, name) => {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = name || 'assistant-image.webp';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(href);
  } catch {
    // Cross-origin or network hiccup → fall back to opening the asset.
    window.open(url, '_blank', 'noopener,noreferrer');
  }
};

const AssistantImageCard = ({ item }) => {
  const src = toMediaUrl(item.url);
  const name = (item.url || '').split('/').pop() || 'assistant-image';
  return (
    <div className="group relative mb-4 overflow-hidden rounded-2xl border border-white/10 bg-black/30">
      <a href={src} target="_blank" rel="noreferrer">
        <img src={src} alt="AI Assistant generation" loading="lazy" className="w-full object-cover" />
      </a>
      <button
        type="button"
        onClick={() => downloadImage(src, name)}
        title="Download"
        className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white opacity-0 backdrop-blur-sm transition-opacity hover:bg-black/80 group-hover:opacity-100"
      >
        <Download className="h-4 w-4" />
      </button>
    </div>
  );
};

export default function MyAssistantImagesPage() {
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const loadingRef = useRef(false);

  const load = useCallback(async (nextPage, replace) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const userId = getUserId();
      const data = await getMediaLibrary({
        userId,
        type: 'image',
        page: nextPage,
        limit: PAGE_SIZE,
      });
      const payload = data?.data ?? data;
      const rows = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.items)
          ? payload.items
          : [];
      setItems((prev) => (replace ? rows : [...prev, ...rows]));
      setHasMore(rows.length === PAGE_SIZE);
      setPage(nextPage);
    } catch (err) {
      const msg = err?.response?.data?.message || err?.message || 'Failed to load images';
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
      loadingRef.current = false;
    }
  }, []);

  useEffect(() => {
    load(1, true);
  }, [load]);

  if (!loading && !error && items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-24 text-center text-white/60">
        <Sparkles className="h-8 w-8 opacity-50" />
        <p className="text-sm">
          No AI Assistant images yet. Generate an ad in the assistant and it&apos;ll show up here.
        </p>
      </div>
    );
  }

  return (
    <div className="px-4 pb-10">
      <Masonry
        breakpointCols={breakpointColumnsObj}
        className="flex w-auto gap-4"
        columnClassName="bg-clip-padding"
      >
        {items.map((item) => (
          <AssistantImageCard key={item._id || item.url} item={item} />
        ))}
      </Masonry>

      <div className="mt-4 flex justify-center">
        {loading ? (
          <Loader2 className="h-6 w-6 animate-spin text-white/50" />
        ) : hasMore && items.length > 0 ? (
          <button
            type="button"
            onClick={() => load(page + 1, false)}
            className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-1.5 text-[12.5px] font-medium text-white/70 transition-colors hover:border-white/25 hover:text-white"
          >
            Load more
          </button>
        ) : null}
      </div>
    </div>
  );
}
