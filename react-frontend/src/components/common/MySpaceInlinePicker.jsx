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
      const res = await getMySpaceImages({
        source: selectedSource,
        skip: 0,
        limit: 100,
      });

      let rawData = Array.isArray(res?.data) ? res.data : [];

      if (rawData.length === 0 && userId) {
        try {
          const libRes = await getMediaLibrary({
            userId,
            type: 'image',
            page: 1,
            limit: 50,
          });
          const libItems = Array.isArray(libRes?.data) ? libRes.data : [];
          if (libItems.length > 0) {
            rawData = libItems.map((doc) => ({
              id: doc._id,
              url: doc.url,
              source: 'library',
              sourceLabel: 'Ad Studio',
              prompt: doc.model || 'Generated Image',
              aspectRatio: '1:1',
              createdAt: doc.createdAt,
            }));
          }
        } catch {
          // Ignore
        }
      }

      const valid = rawData
        .filter((item) => {
          const url = item?.url || item?.generatedImageUrl;
          return Boolean(url && typeof url === 'string' && item?.status !== 'failed');
        })
        .map((item) => ({
          ...item,
          url: absolutize(item.url || item.generatedImageUrl),
        }));

      setItems(valid);
    } catch (err) {
      console.error('Failed to load My Space ads:', err);
      if (userId) {
        try {
          const libRes = await getMediaLibrary({
            userId,
            type: 'image',
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
              prompt: doc.model || 'Generated Image',
              aspectRatio: '1:1',
              createdAt: doc.createdAt,
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
  }, [selectedSource, userId]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return items;
    const q = searchQuery.toLowerCase().trim();
    return items.filter((item) => {
      const prompt = (item.prompt || '').toLowerCase();
      const source = (item.source || item.sourceLabel || '').toLowerCase();
      const brand = (item.metadata?.brandName || '').toLowerCase();
      return prompt.includes(q) || source.includes(q) || brand.includes(q);
    });
  }, [items, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const paginatedItems = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredItems.slice(start, start + pageSize);
  }, [filteredItems, page, pageSize]);

  return (
    <div className="flex flex-col gap-3">
      {/* Top Filter Bar: Source tabs + Search */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* Source Filter Tabs */}
        <div className="flex items-center gap-1">
          {SOURCE_TABS.map(({ id, label, icon: Icon }) => {
            const active = selectedSource === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setSelectedSource(id);
                  setPage(1);
                }}
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

        {/* Search Input & Refresh */}
        <div className="flex items-center gap-1.5">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-gray-400 dark:text-white/40" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(1);
              }}
              placeholder="Search..."
              className="w-32 rounded-lg border border-gray-200 bg-white py-1 pl-7 pr-2 text-xs text-gray-800 placeholder:text-gray-400 focus:border-[#4285F4] focus:outline-none dark:border-white/10 dark:bg-white/5 dark:text-white dark:placeholder:text-white/30 sm:w-44"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
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

      {/* Grid of Images */}
      {loading && items.length === 0 ? (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
          {Array.from({ length: pageSize }).map((_, i) => (
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
          <ImageIcon className="h-6 w-6 text-gray-300 dark:text-white/20" />
          <p className="text-xs font-semibold text-gray-700 dark:text-white/70">
            {searchQuery ? 'No matching images' : 'No My Space ads found yet'}
          </p>
          <p className="text-[11px] text-gray-400 dark:text-white/40">
            {searchQuery ? 'Try another keyword.' : 'Generate ads from Ad Creative or Ad Factory to see them here.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
          {paginatedItems.map((item, idx) => {
            const isSelected = selectedUrl === item.url;
            const sourceLabel = item.sourceLabel || (item.source === 'adCreative' ? 'AdCreative' : item.source === 'adFactory' ? 'AdFactory' : 'My Space');

            return (
              <button
                key={item.id || item.url || idx}
                type="button"
                onClick={() => onPick?.(item.url, item)}
                className={`group relative aspect-square overflow-hidden rounded-xl border text-left transition-all ${
                  isSelected
                    ? 'border-[#4285F4] ring-2 ring-[#4285F4] shadow-sm'
                    : 'border-gray-200 bg-gray-100 hover:border-gray-300 hover:scale-[1.02] dark:border-white/10 dark:bg-white/5 dark:hover:border-white/25'
                }`}
              >
                <img
                  src={item.url}
                  alt="Ad thumbnail"
                  loading="lazy"
                  className="h-full w-full object-cover"
                />

                {/* Subtle source badge */}
                <div className="absolute left-1 top-1 max-w-[85%] truncate rounded bg-black/60 px-1 py-0.5 text-[8px] font-semibold text-white backdrop-blur-sm">
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

      {/* Pagination row */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-1 text-[11px] text-gray-500 dark:text-white/50">
          <span>
            Page {page} of {totalPages} ({filteredItems.length} ads)
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="flex h-6 w-6 items-center justify-center rounded-md border border-gray-200 transition-colors hover:bg-gray-100 disabled:opacity-30 dark:border-white/10 dark:hover:bg-white/10"
            >
              <ChevronLeft className="h-3 w-3" />
            </button>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="flex h-6 w-6 items-center justify-center rounded-md border border-gray-200 transition-colors hover:bg-gray-100 disabled:opacity-30 dark:border-white/10 dark:hover:bg-white/10"
            >
              <ChevronRight className="h-3 w-3" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
