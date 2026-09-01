import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useSelector } from 'react-redux';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
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
  { id: 'all', label: 'All Creatives', icon: Layers },
  { id: 'adCreative', label: 'AdCreative', icon: Sparkles },
  { id: 'adFactory', label: 'AdFactory', icon: FolderOpen },
];

export default function MySpaceAdsPickerModal({
  open,
  onClose,
  onSelect,
  mediaType = 'image', // 'image' | 'video'
  title,
  subtitle,
}) {
  const resolvedTitle = title || (mediaType === 'video' ? 'Select Video from My Space' : 'Select from My Space Ads');
  const resolvedSubtitle = subtitle || (mediaType === 'video' ? 'Choose from your generated AI videos and workspace assets' : 'Choose from your generated AI creatives, campaigns, and workspace assets');
  const userId = useSelector((s) => s?.socket?.userData?.user_id) || null;
  const [selectedSource, setSelectedSource] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedUrl, setSelectedUrl] = useState(null);
  const [selectedItem, setSelectedItem] = useState(null);
  const [page, setPage] = useState(1);
  const pageSize = 24;

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
            limit: 100,
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

      // Image mode: unified My Space endpoint
      const res = await getMySpaceImages({
        source: selectedSource,
        skip: 0,
        limit: 100,
      });

      let rawData = Array.isArray(res?.data) ? res.data : [];

      // If My Space returned empty, fallback to generated media library
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
          // Ignore library fallback failure
        }
      }

      // Filter to items that have valid URLs
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
      console.error('Failed to load My Space media:', err);
      // Try fallback to media library on error
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
    if (open) {
      setSelectedUrl(null);
      setSelectedItem(null);
      setPage(1);
      fetchItems();
    }
  }, [open, fetchItems]);

  // Filter items by search query
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

  // Paginated items
  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const paginatedItems = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredItems.slice(start, start + pageSize);
  }, [filteredItems, page, pageSize]);

  const handleCardClick = (item) => {
    setSelectedUrl(item.url);
    setSelectedItem(item);
  };

  const handleCardDoubleClick = (item) => {
    setSelectedUrl(item.url);
    setSelectedItem(item);
    onSelect?.(item.url, item);
    onClose?.();
  };

  const handleConfirm = () => {
    if (selectedUrl) {
      onSelect?.(selectedUrl, selectedItem);
      onClose?.();
    }
  };

  if (!open) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[200] flex items-center justify-center p-3 sm:p-5">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 bg-black/70 backdrop-blur-sm"
          onClick={onClose}
        />

        {/* Modal Window */}
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 10 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          className="relative z-10 flex h-[88vh] max-h-[820px] w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-2xl dark:border-white/10 dark:bg-[#15171c]"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-6 py-4 dark:border-white/8">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-tr from-[#4285F4]/20 to-[#15DCFF]/20 text-[#4285F4] dark:from-[#4285F4]/30 dark:to-[#15DCFF]/30 dark:text-[#15DCFF]">
                {mediaType === 'video' ? <Play className="h-5 w-5 fill-current ml-0.5" /> : <FolderOpen className="h-5 w-5" />}
              </div>
              <div>
                <h2 className="text-base font-bold text-gray-900 dark:text-white sm:text-lg">{resolvedTitle}</h2>
                <p className="text-xs text-gray-500 dark:text-white/50">{resolvedSubtitle}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-white/40 dark:hover:bg-white/10 dark:hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Sub-header Toolbar: Source tabs + Search input */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 bg-gray-50/50 px-6 py-3 dark:border-white/5 dark:bg-white/[0.02]">
            {/* Tabs (only show for images or all) */}
            {mediaType !== 'video' ? (
              <div className="flex items-center gap-1 rounded-xl bg-gray-200/60 p-1 dark:bg-white/5">
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
                      className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                        active
                          ? 'bg-white text-gray-900 shadow-sm dark:bg-white/15 dark:text-white'
                          : 'text-gray-500 hover:text-gray-800 dark:text-white/60 dark:hover:text-white'
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {label}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="rounded-lg bg-[#4285F4]/10 px-2.5 py-1 text-xs font-bold text-[#4285F4]">
                  My Space Videos
                </span>
              </div>
            )}

            {/* Search + Refresh */}
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400 dark:text-white/40" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setPage(1);
                  }}
                  placeholder={mediaType === 'video' ? "Search videos…" : "Search prompts or brands…"}
                  className="w-48 rounded-xl border border-gray-200 bg-white py-1.5 pl-8 pr-3 text-xs text-gray-800 placeholder:text-gray-400 focus:border-[#4285F4] focus:outline-none dark:border-white/10 dark:bg-white/5 dark:text-white dark:placeholder:text-white/30 sm:w-60"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:text-white/40 dark:hover:text-white"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={fetchItems}
                title="Refresh library"
                disabled={loading}
                className="flex h-8 w-8 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-500 transition-colors hover:border-gray-300 hover:text-gray-900 disabled:opacity-50 dark:border-white/10 dark:bg-white/5 dark:text-white/60 dark:hover:text-white"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          {/* Media Grid Body */}
          <div className="flex-1 overflow-y-auto p-6">
            {loading && items.length === 0 ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div
                    key={i}
                    className="aspect-square animate-pulse rounded-2xl bg-gray-100 dark:bg-white/5"
                  />
                ))}
              </div>
            ) : error && items.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                <div className="rounded-full bg-red-50 p-3 text-red-500 dark:bg-red-500/10 dark:text-red-400">
                  <ImageIcon className="h-6 w-6" />
                </div>
                <p className="text-sm font-semibold text-gray-700 dark:text-white/70">{error}</p>
                <button
                  type="button"
                  onClick={fetchItems}
                  className="rounded-xl bg-[#4285F4] px-4 py-2 text-xs font-bold text-white shadow-sm transition-all hover:bg-[#3367D6]"
                >
                  Try Again
                </button>
              </div>
            ) : filteredItems.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 py-16 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gray-100 dark:bg-white/5">
                  {mediaType === 'video' ? (
                    <Play className="h-7 w-7 text-gray-400 dark:text-white/30" />
                  ) : (
                    <ImageIcon className="h-7 w-7 text-gray-400 dark:text-white/30" />
                  )}
                </div>
                <h3 className="mt-2 text-sm font-bold text-gray-800 dark:text-white">
                  {searchQuery ? 'No matching media found' : (mediaType === 'video' ? 'No My Space videos found yet' : 'No My Space ads found yet')}
                </h3>
                <p className="max-w-xs text-xs text-gray-500 dark:text-white/40">
                  {searchQuery
                    ? 'Try searching with different keywords or refresh the library.'
                    : (mediaType === 'video' ? 'Generate videos in Ad Studio or AI Assistant to see them here.' : 'Create and generate image ads from Ad Creative or Ad Factory, and they will automatically show up here.')}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 md:grid-cols-4">
                {paginatedItems.map((item, idx) => {
                  const isSelected = selectedUrl === item.url;
                  const sourceLabel = item.sourceLabel || (item.source === 'adCreative' ? 'AdCreative' : item.source === 'adFactory' ? 'AdFactory' : 'My Space');
                  const isVideoItem = item.isVideo || mediaType === 'video' || item.url?.match(/\.(mp4|webm|ogg|mov|avi)($|\?)/i);

                  return (
                    <div
                      key={item.id || item.url || idx}
                      onClick={() => handleCardClick(item)}
                      onDoubleClick={() => handleCardDoubleClick(item)}
                      className={`group relative flex cursor-pointer flex-col overflow-hidden rounded-2xl border transition-all duration-200 ${
                        isSelected
                          ? 'border-[#4285F4] bg-[#4285F4]/5 ring-2 ring-[#4285F4] shadow-md dark:border-[#4285F4] dark:bg-[#4285F4]/10 dark:ring-[#4285F4]'
                          : 'border-gray-200 bg-gray-50/50 hover:border-gray-300 hover:shadow-sm dark:border-white/10 dark:bg-white/[0.03] dark:hover:border-white/20'
                      }`}
                    >
                      {/* Media Container */}
                      <div className="relative aspect-square w-full overflow-hidden bg-gray-100 dark:bg-black/40">
                        {isVideoItem ? (
                          <>
                            <video
                              src={item.url}
                              className="h-full w-full object-cover"
                              muted
                              playsInline
                              preload="metadata"
                              onMouseEnter={(e) => e.target.play().catch(() => {})}
                              onMouseLeave={(e) => { e.target.pause(); e.target.currentTime = 0; }}
                            />
                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none group-hover:opacity-0 transition-opacity">
                              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-md shadow-lg">
                                <Play className="h-4 w-4 fill-white ml-0.5" />
                              </div>
                            </div>
                          </>
                        ) : (
                          <img
                            src={item.url}
                            alt={item.prompt || 'My Space Ad'}
                            loading="lazy"
                            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                          />
                        )}

                        {/* Top badges */}
                        <div className="absolute inset-x-2 top-2 flex items-center justify-between pointer-events-none">
                          <span className="rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur-md">
                            {sourceLabel}
                          </span>
                          {item.aspectRatio && (
                            <span className="rounded-full bg-black/50 px-1.5 py-0.5 text-[9px] font-medium text-white/90 backdrop-blur-md">
                              {item.aspectRatio}
                            </span>
                          )}
                        </div>

                        {/* Selection checkmark indicator */}
                        {isSelected && (
                          <div className="absolute bottom-2 right-2 flex h-6 w-6 items-center justify-center rounded-full bg-[#4285F4] text-white shadow-lg">
                            <Check className="h-3.5 w-3.5 stroke-[3]" />
                          </div>
                        )}
                      </div>

                      {/* Prompt / Meta label */}
                      <div className="p-2.5">
                        <p className="line-clamp-2 text-xs font-medium text-gray-700 dark:text-white/80" title={item.prompt || ''}>
                          {item.prompt || (isVideoItem ? 'Generated Video Ad' : 'Generated Ad Creative')}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Footer: Pagination + Actions */}
          <div className="flex shrink-0 items-center justify-between border-t border-gray-100 bg-gray-50/80 px-6 py-3.5 dark:border-white/8 dark:bg-white/[0.02]">
            {/* Pagination Controls */}
            {totalPages > 1 ? (
              <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-white/50">
                <span>
                  Page {page} of {totalPages} · {filteredItems.length} {mediaType === 'video' ? 'videos' : 'creatives'}
                </span>
                <div className="flex items-center gap-1 ml-2">
                  <button
                    type="button"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-gray-200 text-gray-600 transition-colors hover:bg-gray-100 disabled:opacity-40 dark:border-white/10 dark:text-white/60 dark:hover:bg-white/10"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-gray-200 text-gray-600 transition-colors hover:bg-gray-100 disabled:opacity-40 dark:border-white/10 dark:text-white/60 dark:hover:bg-white/10"
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ) : (
              <span className="text-xs text-gray-400 dark:text-white/40">
                {filteredItems.length} {filteredItems.length === 1 ? (mediaType === 'video' ? 'video' : 'creative') : (mediaType === 'video' ? 'videos' : 'creatives')} available
              </span>
            )}

            {/* Buttons */}
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-xs font-semibold text-gray-700 transition-colors hover:bg-gray-50 dark:border-white/10 dark:bg-white/5 dark:text-white/70 dark:hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={!selectedUrl}
                className="flex items-center gap-1.5 rounded-xl bg-[#4285F4] px-5 py-2 text-xs font-bold text-white shadow-sm transition-all hover:bg-[#3367D6] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Check className="h-3.5 w-3.5" />
                {mediaType === 'video' ? 'Use Selected Video' : 'Use Selected Ad'}
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
