import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useSelector } from 'react-redux';
import {
  Search,
  Loader2,
  Check,
  FolderOpen,
  Sparkles,
  RefreshCw,
  Image as ImageIcon,
  Layers,
  ChevronLeft,
  ChevronRight,
  X,
  Play,
} from 'lucide-react';
import { getMySpaceImages } from '@/apis/image/imageApi';
import { getMediaLibrary } from '@/apis/metaAds/metaAdsApi';

const S3_BASE_URL = import.meta.env.VITE_S3_BASE_URL || '';

const absolutize = (path) => {
  if (!path || typeof path !== 'string') return path;
  if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('blob:')) return path;
  if (!S3_BASE_URL) return path;
  return path.startsWith('/')
    ? `${S3_BASE_URL.replace(/\/$/, '')}${path}`
    : `${S3_BASE_URL.replace(/\/$/, '')}/${path}`;
};

const SOURCE_TABS = [
  { id: 'all', label: 'All', icon: Layers },
  { id: 'adCreative', label: 'AdCreative', icon: Sparkles },
  { id: 'adFactory', label: 'AdFactory', icon: FolderOpen },
];

export default function MySpaceInlinePicker({
  selectedUrl,
  onPick,
  mediaType = 'image', // 'image' | 'video'
  pageSize = 12,
}) {
  const userId = useSelector((s) => s?.socket?.userData?.user_id) || null;
  const [selectedSource, setSelectedSource] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (mediaType === 'video') {
        if (userId) {
          const libRes = await getMediaLibrary({
            userId,
            type: 'video',
            page: 1,
            limit: 50,
          });
          const libItems = Array.isArray(libRes?.data) ? libRes.data : [];
          const valid = libItems
            .map((doc) => ({
              id: doc._id,
              url: absolutize(doc.url),
              source: 'library',
              sourceLabel: doc.model ? `Ad Studio (${doc.model})` : 'My Space Video',
              prompt: doc.prompt || doc.title || doc.model || 'Generated Video',
              aspectRatio: doc.aspectRatio || '16:9',
              createdAt: doc.createdAt,
              isVideo: true,
            }))
            .filter((item) => Boolean(item.url));
          setItems(valid);
        } else {
          setItems([]);
        }
        return;
      }

      // Image mode: fetch all sources so 'All' tab has everything
      const [res, libRes] = await Promise.allSettled([
        getMySpaceImages({
          source: 'all',
          skip: 0,
          limit: 300,
        }),
        userId ? getMediaLibrary({ userId, type: 'image', page: 1, limit: 100 }) : Promise.resolve({ data: [] }),
      ]);

      let rawData = [];
      if (res.status === 'fulfilled' && Array.isArray(res.value?.data)) {
        rawData = [...res.value.data];
      }

      if (libRes.status === 'fulfilled' && Array.isArray(libRes.value?.data)) {
        const libItems = libRes.value.data.map((doc) => ({
          id: doc._id,
          url: doc.url,
          source: 'library',
          sourceLabel: doc.model ? `Ad Studio (${doc.model})` : 'Ad Studio',
          prompt: doc.model || doc.title || 'Generated Image',
          aspectRatio: doc.aspectRatio || '1:1',
          createdAt: doc.createdAt,
          timestamp: doc.createdAt,
        }));
        rawData = [...rawData, ...libItems];
      }

      // Deduplicate by URL
      const seenUrls = new Set();
      const valid = rawData
        .filter((item) => {
          const url = item?.url || item?.generatedImageUrl;
          if (!url || typeof url !== 'string' || item?.status === 'failed') return false;
          const absUrl = absolutize(url);
          if (seenUrls.has(absUrl)) return false;
          seenUrls.add(absUrl);
          return true;
        })
        .map((item) => ({
          ...item,
          url: absolutize(item.url || item.generatedImageUrl),
        }));

      // Sort newest first
      valid.sort((a, b) => {
        const timeA = new Date(a.createdAt || a.timestamp || 0).getTime();
        const timeB = new Date(b.createdAt || b.timestamp || 0).getTime();
        return timeB - timeA;
      });

      setItems(valid);
    } catch (err) {
      console.error('Failed to load My Space media:', err);
      if (userId) {
        try {
          const libRes = await getMediaLibrary({
            userId,
            type: mediaType,
            page: 1,
            limit: 50,
          });
          const libItems = Array.isArray(libRes?.data) ? libRes.data : [];
          const valid = libItems
            .map((doc) => ({
              id: doc._id,
              url: absolutize(doc.url),
              source: 'library',
              sourceLabel: 'Ad Studio',
              prompt: doc.model || (mediaType === 'video' ? 'Generated Video' : 'Generated Image'),
              aspectRatio: mediaType === 'video' ? '16:9' : '1:1',
              createdAt: doc.createdAt,
              isVideo: mediaType === 'video',
            }))
            .filter((item) => Boolean(item.url));
          setItems(valid);
          setLoading(false);
          return;
        } catch {
          // Ignore
        }
      }
      setError(err?.response?.data?.message || err?.message || 'Failed to load My Space media.');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [mediaType, selectedSource, userId]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  const [visibleCount, setVisibleCount] = useState(24);
  const gridRef = React.useRef(null);

  const filteredItems = useMemo(() => {
    let list = items;

    // 1. Filter by source (AdCreative vs AdFactory vs All)
    if (mediaType !== 'video' && selectedSource !== 'all') {
      list = list.filter((item) => {
        const src = (item.source || '').toLowerCase();
        const label = (item.sourceLabel || '').toLowerCase();
        if (selectedSource === 'adCreative') {
          return src.includes('adcreative') || label.includes('adcreative');
        }
        if (selectedSource === 'adFactory') {
          return src.includes('adfactory') || label.includes('adfactory');
        }
        return true;
      });
    }

    // 2. Search ranking: Direct prompt/brand/campaign matches at the very top (first)
    if (!searchQuery.trim()) {
      return list;
    }

    const q = searchQuery.toLowerCase().trim();
    const scored = [];

    for (const item of list) {
      const campaign = (item.metadata?.campaignName || '').toLowerCase();
      const brand = (item.metadata?.brandName || item.brandName || '').toLowerCase();
      const prompt = (item.prompt || item.title || '').toLowerCase();
      const model = (item.model || item.modelLabel || '').toLowerCase();

      let score = 0;

      // Tier 1: Exact or direct Brand / Campaign Name match (e.g. "Nike", "Nike Running")
      if (brand === q || campaign === q) {
        score = 10000;
      } else if (brand.startsWith(q) || campaign.startsWith(q)) {
        score = 8000;
      } else if (new RegExp(`\\b${q}\\b`, 'i').test(brand) || new RegExp(`\\b${q}\\b`, 'i').test(campaign)) {
        score = 6000;
      } else if (brand.includes(q) || campaign.includes(q)) {
        score = 4000;
      }
      // Tier 2: Prompt starts with or contains exact keyword
      else if (prompt.startsWith(q)) {
        score = 2000;
      } else if (new RegExp(`\\b${q}\\b`, 'i').test(prompt)) {
        score = 1000;
      } else if (prompt.includes(q)) {
        score = 200;
      } else if (model.includes(q)) {
        score = 50;
      }

      if (score > 0) {
        scored.push({ item, score });
      }
    }

    // Sort by highest relevance score first, then newest timestamp
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const timeA = new Date(a.item.createdAt || a.item.timestamp || 0).getTime();
      const timeB = new Date(b.item.createdAt || b.item.timestamp || 0).getTime();
      return timeB - timeA;
    });

    return scored.map((s) => s.item);
  }, [items, selectedSource, mediaType, searchQuery]);

  const visibleItems = useMemo(() => {
    return filteredItems.slice(0, visibleCount);
  }, [filteredItems, visibleCount]);

  const handleScroll = (e) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    if (scrollHeight - scrollTop - clientHeight < 60) {
      if (visibleCount < filteredItems.length) {
        setVisibleCount((prev) => Math.min(prev + 18, filteredItems.length));
      }
    }
  };

  const handleSourceChange = (id) => {
    setSelectedSource(id);
    setVisibleCount(24);
    if (gridRef.current) gridRef.current.scrollTop = 0;
  };

  const handleSearchChange = (val) => {
    setSearchQuery(val);
    setVisibleCount(24);
    if (gridRef.current) gridRef.current.scrollTop = 0;
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Top Filter Bar: Source tabs + Search */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* Source Filter Tabs */}
        {mediaType !== 'video' ? (
          <div className="flex items-center gap-1">
            {SOURCE_TABS.map(({ id, label, icon: Icon }) => {
              const active = selectedSource === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => handleSourceChange(id)}
                  className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition-all ${
                    active
                      ? 'bg-gray-900 text-white shadow-sm dark:bg-white dark:text-black'
                      : 'border border-gray-200 bg-gray-50 text-gray-500 hover:border-gray-300 hover:text-gray-900 dark:border-white/10 dark:bg-white/5 dark:text-white/60 dark:hover:text-white'
                  }`}
                >
                  <Icon className="h-3 w-3" />
                  {label}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <span className="rounded-lg bg-[#4285F4]/10 px-2 py-0.5 text-xs font-bold text-[#4285F4]">
              My Space Videos
            </span>
          </div>
        )}

        {/* Search Input & Refresh */}
        <div className="flex items-center gap-1.5">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-gray-400 dark:text-white/40" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder={mediaType === 'video' ? "Search videos…" : "Search..."}
              className="w-32 rounded-lg border border-gray-200 bg-white py-1 pl-7 pr-2 text-xs text-gray-800 placeholder:text-gray-400 focus:border-[#4285F4] focus:outline-none dark:border-white/10 dark:bg-white/5 dark:text-white dark:placeholder:text-white/30 sm:w-44"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => handleSearchChange('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:text-white/40 dark:hover:text-white"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={fetchItems}
            title="Refresh"
            disabled={loading}
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500 transition-colors hover:border-gray-300 hover:text-gray-900 disabled:opacity-50 dark:border-white/10 dark:bg-white/5 dark:text-white/60 dark:hover:text-white"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Grid of Items with Infinite Scroll */}
      {loading && items.length === 0 ? (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
          {Array.from({ length: 12 }).map((_, i) => (
            <div
              key={i}
              className="aspect-square animate-pulse rounded-xl bg-gray-200/70 dark:bg-white/5"
            />
          ))}
        </div>
      ) : error && items.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-gray-200 py-6 text-center dark:border-white/10">
          <p className="text-xs font-medium text-red-500 dark:text-red-400">{error}</p>
          <button
            type="button"
            onClick={fetchItems}
            className="rounded-lg bg-[#4285F4] px-3 py-1 text-xs font-semibold text-white"
          >
            Retry
          </button>
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-1.5 rounded-2xl border border-dashed border-gray-200 py-8 text-center dark:border-white/10">
          {mediaType === 'video' ? (
            <Play className="h-6 w-6 text-gray-300 dark:text-white/20" />
          ) : (
            <ImageIcon className="h-6 w-6 text-gray-300 dark:text-white/20" />
          )}
          <p className="text-xs font-semibold text-gray-700 dark:text-white/70">
            {searchQuery ? 'No matching media' : (mediaType === 'video' ? 'No My Space videos found yet' : 'No My Space ads found yet')}
          </p>
          <p className="text-[11px] text-gray-400 dark:text-white/40">
            {searchQuery ? 'Try another keyword.' : (mediaType === 'video' ? 'Generate videos in Ad Studio or AI Assistant to see them here.' : 'Generate ads from Ad Creative or Ad Factory to see them here.')}
          </p>
        </div>
      ) : (
        <div
          key={`${selectedSource}-${searchQuery}`}
          ref={gridRef}
          onScroll={handleScroll}
          className="grid max-h-[200px] grid-cols-3 gap-2 overflow-y-auto pr-1 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 [scrollbar-width:thin]"
        >
          {visibleItems.map((item, idx) => {
            const isSelected = selectedUrl === item.url;
            const sourceLabel = item.sourceLabel || (item.source === 'adCreative' ? 'AdCreative' : item.source === 'adFactory' ? 'AdFactory' : 'My Space');
            const isVideo = item.isVideo || mediaType === 'video' || item.url?.match(/\.(mp4|webm|ogg|mov|avi)($|\?)/i);

            return (
              <button
                key={item.id || item.url || idx}
                type="button"
                onClick={() => onPick?.(item.url, item)}
                className={`group relative aspect-square overflow-hidden rounded-xl border text-left transition-all duration-200 cursor-pointer ${
                  isSelected
                    ? 'border-[#4285F4] ring-2 ring-[#4285F4] shadow-sm'
                    : 'border-gray-200/80 bg-gray-100 hover:border-[#4285F4]/60 hover:shadow-md dark:border-white/10 dark:bg-white/5 dark:hover:border-[#4285F4]/60'
                }`}
              >
                {isVideo ? (
                  <>
                    <video
                      src={item.url}
                      muted
                      playsInline
                      preload="metadata"
                      className="h-full w-full object-cover transition-transform duration-300 ease-out group-hover:scale-105"
                      onMouseEnter={(e) => e.target.play().catch(() => {})}
                      onMouseLeave={(e) => { e.target.pause(); e.target.currentTime = 0; }}
                    />
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none group-hover:opacity-0 transition-opacity">
                      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm">
                        <Play className="h-3 w-3 fill-white ml-0.5" />
                      </div>
                    </div>
                  </>
                ) : (
                  <img
                    src={item.url}
                    alt="Ad thumbnail"
                    loading="lazy"
                    className="h-full w-full object-cover transition-transform duration-300 ease-out group-hover:scale-105"
                  />
                )}

                {/* Subtle source badge */}
                <div className="absolute left-1 top-1 max-w-[85%] truncate rounded bg-black/60 px-1 py-0.5 text-[8px] font-semibold text-white backdrop-blur-sm pointer-events-none">
                  {sourceLabel}
                </div>

                {/* Selection checkmark */}
                {isSelected && (
                  <div className="absolute bottom-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-[#4285F4] text-white shadow">
                    <Check className="h-2.5 w-2.5 stroke-[3]" />
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Info indicator */}
      {filteredItems.length > 0 && (
        <div className="flex items-center justify-between text-[10px] text-gray-400 dark:text-white/40">
          <span>{filteredItems.length} {mediaType === 'video' ? 'videos' : 'creatives'} available</span>
          {visibleItems.length < filteredItems.length && (
            <span>Scroll down for more</span>
          )}
        </div>
      )}
    </div>
  );
}
