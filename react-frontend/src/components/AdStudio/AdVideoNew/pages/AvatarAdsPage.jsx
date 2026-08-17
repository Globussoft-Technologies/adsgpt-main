import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useSelector, useDispatch } from 'react-redux';
import axios from 'axios';
import {
  setAvatars,
  setImageAndScript,
  setRecreateInputs,
  setAvatarStep,
} from '@/store/reducers/adStudio/adVideoNewSlice';
import { setFields } from '@/store/reducers/adFactoryNew/adFactoryNewSlice';
import {
  getAllAvatars,
  getAvatarFilters,
  generateImageAndScript,
  regenerateScript,
  generateAvatarVideo,
  getVideoById,
} from '@/store/actions/adVideoNew/Advideoactions';
import { fetchModelCreditsAction } from '@/store/actions/adStudio/promptActions';
import { useVideoSurfaceModels } from '@/utils/hooks/useVideoSurfaceModels';
import avatarLibraryImg from '@/assets/layouts/adVideoNew/avatarLibrary.png';
import avatarUploadImg from '@/assets/layouts/adVideoNew/avatarUpload.png';
import avatarUploadBgImg from '@/assets/layouts/adVideoNew/avatarUploadBg.png';
import webcamPlaceholderImg from '@/assets/layouts/adVideoNew/webcamImg.png';
import webcamImgGif from '@/assets/layouts/adVideoNew/webcamImgGif.gif';
import avatarFront from '@/assets/layouts/adVideoNew/avatar_front.png';
import avatarLeft from '@/assets/layouts/adVideoNew/avatar_left.png';
import avatarRight from '@/assets/layouts/adVideoNew/avatar_right.png';
import 'react-loading-skeleton/dist/skeleton.css';
import {
  ChevronLeft,
  ChevronRight,
  Search,
  Filter,
  CloudUpload,
  LinkIcon,
  RectangleHorizontal,
  RectangleVertical,
  Square,
  X,
  ListFilter,
  ImagePlus,
  Trash2,
  Loader2,
  PanelLeft,
  ChevronDown,
} from 'lucide-react';
import CommonDropdown from '@/components/common/AdPrompt/CommonDropdown';
import { estimateAdVideoCredits } from '@/utils/creditEstimator';
import SparkleDark from '@/assets/layouts/prompt/sparkle-dark.svg';
import TimerDarkLogo from '@/assets/layouts/prompt/advideo/timer.svg';
import BrandSearch from '@/components/AdFactory/BrandsDropDown/BrandSelect';
import { SiOpenai, SiBytedance } from 'react-icons/si';
import KlingIcon from '@/components/icons/KlingIcon';
import { RiGeminiFill } from 'react-icons/ri';
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from '@/components/ui/select';
import { ShadcnTooltip } from '@/components/layout/ShadcnTooltip';
import VeoGradientIcon from '@/assets/layouts/adVideoNew/icon/veo.svg';
import FaceCaptureGuide from '../FaceCaptureGuide';
import { globalToast } from '@/utils/globalToast';
import { uploadToS3 } from '@/utils/imageUpload';
import ShowLightBox from '@/components/AdFactory/Cards/Lightbox';
import UpgradeModal from '../UpgradeModal';
import { AnimatePresence } from 'framer-motion';
import emitter from '@/utils/eventEmitter';
import { toast } from 'react-toastify';
import Skeleton, { SkeletonTheme } from 'react-loading-skeleton';
import imageCompression from 'browser-image-compression';
import { vi } from 'date-fns/locale';
const SIGNUP_URL = import.meta.env.VITE_SIGNUP_URL;

const AIAvatarCommonDropdown = ({
  options = [],
  label = '',
  placeholder = '',
  icon = null,
  value = '',
  onChange,
  triggerClassName = '',
  contentClassName = '',
  align,
}) => {
  const Icon = value?.Icon;
  const triggerLabel = value?.label?.replace(/\s*\(.*?\)\s*$/, '') || placeholder || label;

  return (
    <Select value={value?.value} onValueChange={onChange}>
      <SelectTrigger
        hideIcon
        className={`prompt_selection_button_no_gradient group relative flex items-center gap-0 rounded-full py-4 text-xs shadow-none transition-all duration-200 ease-in [&_svg]:text-current! 2xl:py-5 2xl:text-sm dark:border-none dark:bg-[#2B2A2A80] dark:text-[#AFAFAF] [&>svg]:size-5 ${triggerClassName}`}
      >
        <div className="flex items-center gap-1 pr-1 capitalize">
          {Icon ? Icon : <></>}
          <span className="ml-1 font-light dark:text-[#afafaf] dark:group-data-[state=open]:text-white">
            {triggerLabel}
          </span>
        </div>
      </SelectTrigger>

      <SelectContent
        align={align}
        className={`z-[999999] min-w-fit border backdrop-blur-[100px] dark:border-white/20 dark:bg-[#0D0D0D]/50 dark:text-white ${contentClassName}`}
      >
        {label && (
          <div className="px-2 py-1 text-xs text-[#636363] dark:text-[#D9D9D9]">{label}</div>
        )}

        <div className="flex flex-col">
          {options.map(({ value: optionValue, Icon, label, credit, tier }) => (
            <SelectItem
              key={optionValue}
              value={optionValue}
              className={`group cursor-pointer text-xs text-zinc-800 2xl:text-sm hover:bg-zinc-100 hover:text-zinc-900 focus:bg-zinc-100 focus:text-zinc-900 data-highlighted:bg-zinc-100 data-highlighted:text-zinc-900 [&_svg]:text-current! dark:text-[#AFAFAF] dark:hover:bg-[#0D0D0D]/30 dark:hover:text-white dark:focus:bg-[#0D0D0D]/30 dark:focus:text-white dark:data-highlighted:bg-[#0D0D0D]/30 dark:data-highlighted:text-white ${
                value?.value === optionValue ? 'bg-zinc-100 dark:bg-[#0D0D0D]/50' : 'bg-transparent'
              }`}
            >
              {Icon}

              <div className="flex w-full items-center justify-between">
                {credit ? (
                  <ShadcnTooltip label={`${credit} `} side="right" className="z-[1000000]">
                    <span className="text-inherit">{label}</span>
                  </ShadcnTooltip>
                ) : (
                  <span className="text-inherit">{label}</span>
                )}

                {tier === 'premium' && (
                  <span className="mr-5 ml-1.5 flex items-center gap-0.5 rounded-full bg-gradient-to-r from-purple-500/20 to-cyan-500/20 px-1.5 py-0.5 text-[8px] font-semibold 2xl:text-[10px]">
                    <span className="bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent">
                      ★ Premium
                    </span>
                  </span>
                )}

                <span
                  className={`absolute right-1 flex h-4 w-4 items-center justify-center rounded-full border ${
                    value?.value === optionValue
                      ? 'border-[#575757] dark:bg-[#575757]'
                      : 'border-[#AFAFAF]'
                  }`}
                >
                  {value?.value === optionValue && (
                    <div className="h-[6px] w-[6px] rounded-full bg-gray-900 dark:bg-white" />
                  )}
                </span>
              </div>
            </SelectItem>
          ))}
        </div>
      </SelectContent>
    </Select>
  );
};

const getAvatarUrl = (avatar, { thumbnail = false } = {}) => {
  const s3BaseUrl = import.meta.env.VITE_S3_BASE_URL || '';
  const path = avatar?.s3_image_path;
  if (path) {
    const url = `${s3BaseUrl}${path}`;
    if (thumbnail && url.match(/\.(jpe?g|png|webp)$/i)) {
      // Request a smaller version via S3/CDN image resizing if available
      // Fallback: append query param for CDN resize, harmless if not supported
      return `${url}?w=300&q=75`;
    }
    return url;
  }
  return path;
};

// Cache loaded image URLs to avoid re-triggering loading states
const loadedImageCache = new Set();
const compressedImageCache = new Map();
const inProgressCompressions = new Map();

const getAvatarId = (avatar, index) => avatar?._id || avatar?.id || avatar?.avatar_id || index;

const AvatarItem = React.memo(({ avatar, onSelect }) => {
  const originalUrl = getAvatarUrl(avatar, { thumbnail: true });

  const [avatarUrl, setAvatarUrl] = useState(() => compressedImageCache.get(originalUrl) || null);
  const [isLoaded, setIsLoaded] = useState(() => loadedImageCache.has(avatarUrl));
  const [isCompressing, setIsCompressing] = useState(!avatarUrl);

  const handleLoad = useCallback(() => {
    if (avatarUrl) {
      loadedImageCache.add(avatarUrl);
      setIsLoaded(true);
    }
  }, [avatarUrl]);

  useEffect(() => {
    let isMounted = true;

    if (avatarUrl) return; // Already cached and set

    // Only compress if the url looks like an image from S3, else just use directly
    if (!originalUrl || !originalUrl.startsWith('http')) {
      setAvatarUrl(originalUrl);
      setIsCompressing(false);
      return;
    }

    const processImage = async () => {
      if (inProgressCompressions.has(originalUrl)) {
        const url = await inProgressCompressions.get(originalUrl);
        if (isMounted) {
          setAvatarUrl(url);
          setIsCompressing(false);
        }
        return;
      }

      const compressionPromise = (async () => {
        try {
          // Fetch the image as a blob
          const res = await fetch(originalUrl, { mode: 'cors' });
          if (!res.ok) throw new Error('Fetch failed');
          const blob = await res.blob();

          // Compress the blob
          const compressedBlob = await imageCompression(blob, {
            maxSizeMB: 0.1, // ~100KB target for library thumbs
            maxWidthOrHeight: 350,
            useWebWorker: true,
          });

          const objectUrl = URL.createObjectURL(compressedBlob);
          compressedImageCache.set(originalUrl, objectUrl);
          return objectUrl;
        } catch (error) {
          // If CORS fails or compression fails, fallback to a proxy or original URL
          console.warn('Library avatar compression fallback:', error);
          // Try a resizing proxy to save bandwidth and memory if fetch hits cors
          const proxyUrl = `https://wsrv.nl/?url=${encodeURIComponent(originalUrl)}&w=350&output=webp&q=70`;
          compressedImageCache.set(originalUrl, proxyUrl);
          return proxyUrl;
        }
      })();

      inProgressCompressions.set(originalUrl, compressionPromise);
      const url = await compressionPromise;

      if (isMounted) {
        setAvatarUrl(url);
        setIsCompressing(false);
      }
    };

    processImage();

    return () => {
      isMounted = false;
    };
  }, [originalUrl, avatarUrl]);

  return (
    <div
      className="group relative h-70 cursor-pointer overflow-hidden rounded-lg border border-black/10 hover:border-blue-500 2xl:h-65 dark:border-[#3a3a3a]"
      style={{
        contentVisibility: 'auto',
        containIntrinsicSize: '0 280px',
        contain: 'layout style paint',
      }}
    >
      <div className="relative h-full w-full bg-[#1c1c1c]">
        {(!isLoaded || isCompressing) && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-white border-t-transparent" />
          </div>
        )}

        {avatarUrl && (
          <img
            src={avatarUrl}
            loading="lazy"
            decoding="async"
            width={300}
            height={280}
            onLoad={handleLoad}
            className={`h-full w-full object-cover transition-opacity duration-300 ${
              isLoaded ? 'opacity-100' : 'opacity-0'
            }`}
          />
        )}
      </div>
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100" />

      <div className="pointer-events-none absolute bottom-4 left-1/2 flex -translate-x-1/2 transform items-center justify-center opacity-0 transition-opacity duration-200 group-hover:opacity-100">
        <button
          onClick={() => onSelect(avatar)}
          className="pointer-events-auto rounded-full bg-white px-6 py-1 text-xs font-semibold whitespace-nowrap text-black hover:bg-white/90 2xl:px-6 2xl:py-3 2xl:text-sm"
        >
          Use Avatar
        </button>
      </div>
    </div>
  );
});

const AvatarSkeletonGrid = ({ columns = 5, rows = 3 }) => {
  const isDark =
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
  const baseColor = isDark ? '#2A2A2A' : '#e4e4e7';
  const highlightColor = isDark ? '#3A3A3A' : '#f4f4f5';

  return (
    <div className="flex h-full flex-col gap-2">
      <SkeletonTheme baseColor={baseColor} highlightColor={highlightColor}>
        {Array.from({ length: rows }).map((_, rowIdx) => (
          <div key={rowIdx} className="flex gap-2">
            {Array.from({ length: columns }).map((_, colIdx) => (
              <div key={colIdx} className="h-70 flex-1 2xl:h-65">
                <Skeleton height="100%" containerClassName="h-full w-full block" borderRadius={8} />
              </div>
            ))}
          </div>
        ))}
      </SkeletonTheme>
    </div>
  );
};

// DB field -> filter group. `limit` truncates long lists behind "Show more".
// aspect_ratio is intentionally NOT a filter (per spec).
const AVATAR_FILTER_GROUPS = [
  { key: 'gender', label: 'Gender' },
  { key: 'age', label: 'Age' },
  { key: 'race', label: 'Ethnicity' },
  { key: 'industry', label: 'Industry', limit: 5 },
  { key: 'outfit', label: 'Outfit', limit: 4 },
  { key: 'background', label: 'Scene', limit: 5 },
  { key: 'lighting', label: 'Lighting' },
  { key: 'camera_distance', label: 'Camera distance' },
  { key: 'expression', label: 'Expression' },
  { key: 'image_size', label: 'Image size' },
];

const AVATAR_PAGE_SIZE = 20;

// Faceted-filter avatar library.
// Chips drive a server-side refetch via getAllAvatars({ field: [...] }); the
// free-text box narrows the returned set client-side. Cards reuse AvatarItem.
const AvatarLibraryFilters = ({ onBack, onSelect, avatars = [], isLoadingAvatars = false }) => {
  const dispatch = useDispatch();
  const safeAvatars = useMemo(() => (Array.isArray(avatars) ? avatars : []), [avatars]);

  const [options, setOptions] = useState({}); // { field: string[] } from backend
  const [filters, setFilters] = useState({}); // { field: string[] } selected
  const [expanded, setExpanded] = useState({}); // { field: bool }
  const [railOpen, setRailOpen] = useState(false);
  const [query, setQuery] = useState('');

  // Distinct option lists for every field (full catalog, from /avatar/filters).
  useEffect(() => {
    let mounted = true;
    dispatch(getAvatarFilters()).then((res) => {
      if (mounted) setOptions(res && typeof res === 'object' ? res : {});
    });
    return () => {
      mounted = false;
    };
  }, [dispatch]);

  // Pagination meta (page / hasMore) is set by the paginated fetch below.
  const { avatarsPagination } = useSelector((state) => state.adVideoNew);

  // Page 1 (replace) on mount and whenever the selected chips change. The first
  // load fires immediately (skeleton shows at once); chip changes are debounced.
  const isFirstRun = useRef(true);
  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false;
      dispatch(getAllAvatars(filters, { page: 1, limit: AVATAR_PAGE_SIZE }));
      return;
    }
    const t = setTimeout(() => {
      dispatch(getAllAvatars(filters, { page: 1, limit: AVATAR_PAGE_SIZE }));
    }, 250);
    return () => clearTimeout(t);
  }, [filters, dispatch]);

  // Infinite scroll: append the next page when the sentinel scrolls into view.
  const loadingMoreRef = useRef(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadMore = useCallback(() => {
    if (loadingMoreRef.current || isLoadingAvatars || !avatarsPagination?.hasMore) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    const next = (avatarsPagination?.page || 1) + 1;
    dispatch(
      getAllAvatars(filters, { page: next, limit: AVATAR_PAGE_SIZE, append: true })
    ).finally(() => {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    });
  }, [avatarsPagination, filters, dispatch, isLoadingAvatars]);

  const scrollRef = useRef(null);
  const sentinelRef = useRef(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMore();
      },
      { root: scrollRef.current, rootMargin: '300px' }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [loadMore]);

  const groups = useMemo(
    () =>
      AVATAR_FILTER_GROUPS.map((g) => ({ ...g, options: options[g.key] || [] })).filter(
        (g) => g.options.length > 0
      ),
    [options]
  );

  const toggleChip = (key, val) =>
    setFilters((prev) => {
      const cur = prev[key] || [];
      const next = cur.includes(val) ? cur.filter((v) => v !== val) : [...cur, val];
      const out = { ...prev, [key]: next };
      if (!next.length) delete out[key];
      return out;
    });

  // Add a facet (used by the search suggestions) — never toggles off.
  const addFacet = (key, val) =>
    setFilters((prev) => {
      const cur = prev[key] || [];
      if (cur.includes(val)) return prev;
      return { ...prev, [key]: [...cur, val] };
    });

  // Applied-filter pills: the inline bar stays short; "+N more" opens a floating
  // popover with the full list so the grid is never pushed down.
  const [showAllApplied, setShowAllApplied] = useState(false);
  const appliedRef = useRef(null);

  const clearAll = () => {
    setFilters({});
    setShowAllApplied(false);
  };

  const activeCount = Object.values(filters).reduce((n, v) => n + v.length, 0);
  const hasFilters = activeCount > 0;

  const appliedFilters = useMemo(
    () => Object.entries(filters).flatMap(([key, vals]) => vals.map((value) => ({ key, value }))),
    [filters]
  );
  const APPLIED_PILL_LIMIT = 8;

  useEffect(() => {
    if (!showAllApplied) return;
    const onDown = (e) => {
      if (appliedRef.current && !appliedRef.current.contains(e.target)) setShowAllApplied(false);
    };
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setShowAllApplied(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [showAllApplied]);

  const renderAppliedPill = ({ key, value }) => (
    <button
      key={`${key}:${value}`}
      onClick={() => toggleChip(key, value)}
      title="Remove filter"
      className="flex h-[26px] max-w-[180px] flex-shrink-0 items-center gap-1.5 rounded-full border border-blue-500/60 bg-blue-500/15 pr-1.5 pl-2.5 text-xs text-blue-600 transition-colors hover:bg-blue-500/25 dark:text-white"
    >
      <span className="truncate">{value}</span>
      <X size={12} className="flex-shrink-0 opacity-70" />
    </button>
  );

  // C1 search: resolve the typed text to facet values (across all groups). The
  // chosen facet becomes a chip -> server-side query, so search matches the
  // whole catalog, not just the loaded pages.
  const [searchFocused, setSearchFocused] = useState(false);
  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const out = [];
    for (const g of AVATAR_FILTER_GROUPS) {
      for (const value of options[g.key] || []) {
        if (String(value).toLowerCase().includes(q)) {
          out.push({
            groupKey: g.key,
            groupLabel: g.label,
            value,
            active: (filters[g.key] || []).includes(value),
          });
          if (out.length >= 10) return out;
        }
      }
    }
    return out;
  }, [query, options, filters]);

  const applySuggestion = (s) => {
    addFacet(s.groupKey, s.value);
    // Clear the text (this hides the dropdown) but keep focus state true — the
    // input still holds DOM focus, so onFocus won't fire again on the next
    // keystroke and the dropdown must be able to reopen from the query alone.
    setQuery('');
  };

  return (
    <div
      className="flex h-full flex-col gap-4 p-6 2xl:pb-12"
      style={{ minHeight: 'calc(100svh - 200px)' }}
    >
      <h3 className="flex items-center gap-2 text-lg font-semibold text-gray-900 2xl:text-xl dark:text-white">
        <button onClick={onBack}>
          <ChevronLeft className="h-6 w-6" />
        </button>
        Select your AI Avatar
      </h3>

      <div className="flex min-h-0 flex-1 overflow-hidden rounded-2xl border border-black/10 bg-white text-gray-900 dark:border-[#3a3a3a] dark:bg-[#1c1c1c] dark:text-white">
        {/* ===== FILTER RAIL (width-animated collapse) ===== */}
        <div
          className={`flex-shrink-0 overflow-hidden transition-[width] duration-300 ease-in-out ${
            railOpen ? 'w-[252px]' : 'w-0'
          }`}
        >
          <div className="flex h-full w-[252px] flex-col border-r border-black/10 dark:border-[#3a3a3a]">
            {/* Sticky rail header */}
            <div className="flex flex-shrink-0 items-center gap-2 px-[18px] pt-[18px] pb-3">
              <div className="text-[12.5px] font-semibold text-gray-700 dark:text-[#cfcfd6]">
                Filters
              </div>
              <div className="ml-auto flex items-center gap-2.5">
                {hasFilters && (
                  <button
                    onClick={clearAll}
                    className="text-[11.5px] text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300"
                  >
                    Clear all
                  </button>
                )}
                <button
                  title="Collapse filters"
                  onClick={() => setRailOpen(false)}
                  className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[9px] border border-black/10 bg-gray-100 text-gray-600 hover:text-gray-900 dark:border-[#3a3a3a] dark:bg-[#202020] dark:text-[#cfcfd6] dark:hover:text-white"
                >
                  <PanelLeft size={16} />
                </button>
              </div>
            </div>

            {/* Scrolling filter groups */}
            <div className="custom-scrollbar flex-1 overflow-x-hidden overflow-y-auto px-[18px] pb-7">
            {groups.map((g) => {
              const isOpen = !!expanded[g.key];
              const visible = g.limit && !isOpen ? g.options.slice(0, g.limit) : g.options;
              const hasMore = g.limit && g.options.length > g.limit;
              return (
                <div key={g.key} className="mb-5">
                  <div className="mb-2.5 text-[10.5px] tracking-[0.06em] text-gray-500 uppercase dark:text-[#6f6f78]">
                    {g.label}
                  </div>
                  <div className="flex flex-wrap gap-[7px]">
                    {visible.map((opt) => {
                      const active = (filters[g.key] || []).includes(opt);
                      return (
                        <button
                          key={opt}
                          onClick={() => toggleChip(g.key, opt)}
                          className={`rounded-lg border px-3 py-1.5 text-xs leading-[1.1] transition-all ${
                            active
                              ? 'border-blue-500/60 bg-blue-500/15 font-medium text-blue-600 dark:text-white'
                              : 'border-black/10 bg-gray-100 text-gray-600 hover:border-black/20 dark:border-[#3a3a3a] dark:bg-[#202020] dark:text-[#AFAFAF] dark:hover:border-[#4a4a4a]'
                          }`}
                        >
                          {opt}
                        </button>
                      );
                    })}
                    {hasMore && (
                      <button
                        onClick={() => setExpanded((p) => ({ ...p, [g.key]: !p[g.key] }))}
                        className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-blue-500 hover:text-blue-600 dark:text-blue-400"
                      >
                        {isOpen ? 'Show less' : 'Show more'}
                        <ChevronDown
                          size={11}
                          className="transition-transform"
                          style={{ transform: isOpen ? 'rotate(180deg)' : 'none' }}
                        />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
            </div>
          </div>
        </div>

        {/* ===== RIGHT: TOOLBAR + GRID ===== */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-3 border-b border-black/10 px-[22px] py-4 dark:border-[#3a3a3a]">
            {!railOpen && (
              <button
                onClick={() => setRailOpen(true)}
                className="flex flex-shrink-0 items-center gap-2 rounded-[10px] border border-black/10 bg-gray-100 px-3 py-[9px] text-[13px] text-gray-700 hover:text-gray-900 dark:border-[#3a3a3a] dark:bg-[#202020] dark:text-[#cfcfd6] dark:hover:text-white"
              >
                <PanelLeft size={15} />
                Filters
                {hasFilters && (
                  <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-blue-500 px-1 text-[10px] font-bold text-white">
                    {activeCount}
                  </span>
                )}
              </button>
            )}
            <div className="relative max-w-[340px] flex-1">
              <div className="flex items-center gap-[9px] rounded-[10px] border border-black/10 bg-gray-100 px-[13px] py-[9px] dark:border-[#3a3a3a] dark:bg-[#202020]">
                <Search size={15} className="flex-shrink-0 text-gray-400 dark:text-[#6f6f78]" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onFocus={() => setSearchFocused(true)}
                  onBlur={() => setTimeout(() => setSearchFocused(false), 120)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && suggestions[0]) applySuggestion(suggestions[0]);
                    if (e.key === 'Escape') {
                      setQuery('');
                      setSearchFocused(false);
                    }
                  }}
                  placeholder="e.g. female, farmer, golden hour"
                  className="w-full bg-transparent text-[13px] text-gray-900 placeholder:text-gray-400 focus:outline-none dark:text-white dark:placeholder:text-[#6f6f78]"
                />
              </div>

              {/* Facet-resolution suggestions (C1) */}
              {searchFocused && query.trim() && (
                <div
                  onMouseDown={(e) => e.preventDefault()}
                  className="custom-scrollbar absolute top-full left-0 z-50 mt-1.5 max-h-72 w-full overflow-y-auto rounded-[10px] border border-black/10 bg-white py-1.5 shadow-lg dark:border-[#3a3a3a] dark:bg-[#202020]"
                >
                  {suggestions.length > 0 ? (
                    suggestions.map((s) => (
                      <button
                        key={`${s.groupKey}:${s.value}`}
                        onClick={() => applySuggestion(s)}
                        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[13px] text-gray-700 hover:bg-gray-100 dark:text-[#cfcfd6] dark:hover:bg-[#2a2a2a]"
                      >
                        <span className="truncate">{s.value}</span>
                        <span className="flex-shrink-0 text-[10.5px] tracking-[0.04em] text-gray-400 uppercase dark:text-[#6f6f78]">
                          {s.active ? 'Added' : s.groupLabel}
                        </span>
                      </button>
                    ))
                  ) : (
                    <div className="px-3 py-2 text-[13px] text-gray-400 dark:text-[#6f6f78]">
                      No matching filters
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Applied filters — removable pills (visible regardless of rail state) */}
          {hasFilters && (
            <div
              ref={appliedRef}
              className="relative flex h-[47px] flex-shrink-0 items-center gap-3 border-b border-black/10 px-[22px] py-2.5 dark:border-[#3a3a3a]"
            >
              <div className="flex min-w-0 flex-1 flex-nowrap gap-2 overflow-hidden">
                {appliedFilters.slice(0, APPLIED_PILL_LIMIT).map(renderAppliedPill)}
              </div>
              {appliedFilters.length > APPLIED_PILL_LIMIT && (
                <button
                  onClick={() => setShowAllApplied((s) => !s)}
                  aria-expanded={showAllApplied}
                  className="flex h-[26px] flex-shrink-0 items-center text-[11.5px] font-medium text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300"
                >
                  {showAllApplied
                    ? 'Show less'
                    : `+${appliedFilters.length - APPLIED_PILL_LIMIT} more`}
                </button>
              )}
              <button
                onClick={clearAll}
                className="flex-shrink-0 text-[11.5px] text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300"
              >
                Clear all
              </button>
              {showAllApplied && (
                <div className="absolute top-full right-[22px] left-[22px] z-50 mt-2 rounded-xl border border-black/10 bg-white p-3 shadow-xl dark:border-[#3a3a3a] dark:bg-[#202020]">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div className="text-[11.5px] font-medium text-gray-500 dark:text-[#AFAFAF]">
                      {activeCount} filters selected
                    </div>
                    <button
                      onClick={() => setShowAllApplied(false)}
                      className="flex h-7 w-7 items-center justify-center rounded-full text-gray-500 hover:bg-black/5 hover:text-gray-900 dark:text-[#AFAFAF] dark:hover:bg-white/10 dark:hover:text-white"
                      title="Close"
                    >
                      <X size={14} />
                    </button>
                  </div>
                  <div className="custom-scrollbar flex max-h-[220px] flex-wrap gap-2 overflow-y-auto pr-1">
                    {appliedFilters.map(renderAppliedPill)}
                  </div>
                </div>
              )}
            </div>
          )}

          <div
            ref={scrollRef}
            className="custom-scrollbar min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-[22px] pt-5 pb-[26px]"
          >
            {isLoadingAvatars ? (
              <AvatarSkeletonGrid columns={4} rows={3} />
            ) : safeAvatars.length > 0 ? (
              <>
                <div
                  className={`grid grid-cols-2 gap-3 sm:grid-cols-3 ${
                    railOpen ? 'lg:grid-cols-3' : 'lg:grid-cols-4'
                  }`}
                >
                  {safeAvatars.map((a, i) => (
                    <AvatarItem key={getAvatarId(a, i)} avatar={a} onSelect={onSelect} />
                  ))}
                </div>
                {/* Infinite-scroll sentinel + "loading more" indicator */}
                {avatarsPagination?.hasMore && (
                  <div
                    ref={sentinelRef}
                    className="flex items-center justify-center py-6 text-gray-400 dark:text-[#6f6f78]"
                  >
                    {loadingMore && <Loader2 className="h-5 w-5 animate-spin" />}
                  </div>
                )}
              </>
            ) : (
              <div className="flex h-80 flex-col items-center justify-center gap-2.5 text-gray-400 dark:text-[#6f6f78]">
                <Search size={28} />
                <div className="text-sm">No avatars match these filters</div>
                {(hasFilters || query) && (
                  <button
                    onClick={() => {
                      clearAll();
                      setQuery('');
                    }}
                    className="mt-1 rounded-[9px] border border-black/10 bg-gray-100 px-4 py-2 text-[12.5px] text-gray-700 dark:border-[#3a3a3a] dark:bg-[#202020] dark:text-[#cfcfd6]"
                  >
                    Clear all filters
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const AvatarConfigForm = ({
  avatar,
  avatars = [],
  onAvatarChange,
  customAvatarImages = [],
  onBack,
  onGenerate,
  recreateData,
}) => {
  const isCustomAvatar = customAvatarImages.length > 0;
  const { modelCredits } = useSelector((state) => state.prompt);
  const surfaceModels = useVideoSurfaceModels('avatar');
  const availableCanonicalKeys = useMemo(
    () => new Set(surfaceModels.map((entry) => entry.canonical)),
    [surfaceModels]
  );
  const { brand_name } = useSelector((state) => state.adFactoryNew);
  const { userData, credits } = useSelector((state) => state.socket);
  const availableCredits = (credits?.totalCredits || 0) - (credits?.creditsUsed || 0);
  const dispatch = useDispatch();
  const [productUrl, setProductUrl] = useState('');
  const [videoModel, setVideoModel] = useState('');
  const [videoDuration, setVideoDuration] = useState('');
  const [aspectRatio, setAspectRatio] = useState('');
  const [promotion, setPromotion] = useState('');
  const [notes, setNotes] = useState('');
  const [hasProductImage, setHasProductImage] = useState(null);
  const [promptText, setPromptText] = useState('');
  const [uploadedImages, setUploadedImages] = useState([]);
  const [imageOrientation, setImageOrientation] = useState(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxImage, setLightboxImage] = useState(null);
  const [lightboxImages, setLightboxImages] = useState([]);
  const { isLoading } = useSelector((state) => state.adVideoNew);
  const [isUpgradeModalOpen, setIsUpgradeModalOpen] = useState(false);
  const [carouselIndex, setCarouselIndex] = useState(0);
  const [errors, setErrors] = useState({});
  const [isUploading, setIsUploading] = useState(false);

  const currentAvatarIndex = useMemo(() => {
    if (!avatar || !avatars?.length) return -1;
    return avatars.findIndex(
      (a) => (a._id || a.id) === (avatar._id || avatar.id || avatar.avatar_id)
    );
  }, [avatar, avatars]);

  const handlePrevAvatar = () => {
    if (avatars.length <= 1 || currentAvatarIndex === -1) return;
    const newIndex = (currentAvatarIndex - 1 + avatars.length) % avatars.length;
    onAvatarChange?.(avatars[newIndex]);
  };

  const handleNextAvatar = () => {
    if (avatars.length <= 1 || currentAvatarIndex === -1) return;
    const newIndex = (currentAvatarIndex + 1) % avatars.length;
    onAvatarChange?.(avatars[newIndex]);
  };

  useEffect(() => {
    if (videoModel && errors.videoModel) setErrors((prev) => ({ ...prev, videoModel: null }));
    if (videoDuration && errors.videoDuration)
      setErrors((prev) => ({ ...prev, videoDuration: null }));
    if (aspectRatio && errors.aspectRatio) setErrors((prev) => ({ ...prev, aspectRatio: null }));
    if (brand_name && errors.brandName) setErrors((prev) => ({ ...prev, brandName: null }));
    if (notes.trim() && errors.notes) setErrors((prev) => ({ ...prev, notes: null }));
    if ((productUrl.trim() || uploadedImages.length > 0) && errors.productUrl)
      setErrors((prev) => ({ ...prev, productUrl: null }));
    if (promptText.trim() && errors.promptText)
      setErrors((prev) => ({ ...prev, promptText: null }));
  }, [videoModel, videoDuration, aspectRatio, brand_name, notes, productUrl, uploadedImages, promptText, errors.videoModel, errors.videoDuration, errors.aspectRatio, errors.brandName, errors.notes, errors.productUrl, errors.promptText]);

  const videoChatModels = useMemo(
    () => [
      {
        value: 'veo-3.1-fast',
        label: 'Veo 3.1 Fast (Fast & Social-Ready)',
        tier: 'lower',
        Icon: <RiGeminiFill className="!h-3 !w-3 group-hover:text-white 2xl:!h-4 2xl:!w-4" />,
        credit: modelCredits?.videoModels?.find((m) =>
          m.label.toLowerCase().includes('veo 3.1 fast')
        )?.value,
      },
      // {
      //   value: 'sora',
      //   label: 'Sora 2 (Creative & Stylised)',
      //   tier: 'lower',
      //   Icon: <SiOpenai className="!h-3 !w-3 group-hover:text-white 2xl:!h-4 2xl:!w-4" />,
      //   credit: modelCredits?.videoModels?.find((m) => m.label.toLowerCase() === 'sora 2')?.value,
      // },
      {
        value: 'veo',
        label: 'Veo 3 (Cinematic Quality)',
        tier: 'premium',
        Icon: <RiGeminiFill className="!h-3 !w-3 group-hover:text-white 2xl:!h-4 2xl:!w-4" />,
        credit: modelCredits?.videoModels?.find((m) => m.label.toLowerCase() === 'veo 3')?.value,
      },
      // {
      //   value: 'soraPro',
      //   label: 'Sora 2 Pro (Cinematic Storytelling)',
      //   tier: 'premium',
      //   Icon: <SiOpenai className="!h-3 !w-3 group-hover:text-white 2xl:!h-4 2xl:!w-4" />,
      //   credit: modelCredits?.videoModels?.find((m) => m.label.toLowerCase() === 'sora 2 pro')
      //     ?.value,
      // },
      // {
      //   value: 'soraPro_4k',
      //   label: 'Sora Pro 4K (Premium 4K Film Quality)',
      //   tier: 'premium',
      //   Icon: <SiOpenai className="!h-3 !w-3 group-hover:text-white 2xl:!h-4 2xl:!w-4" />,
      //   credit: modelCredits?.videoModels?.find(
      //     (m) =>
      //       m.label.toLowerCase().includes('sora 2 pro 4k') ||
      //       m.label.toLowerCase().includes('sora pro 4k')
      //   )?.value,
      // },
      {
        value: 'veo_4k',
        label: 'Veo 4K (Cinematic 4K Quality)',
        tier: 'premium',
        Icon: <RiGeminiFill className="!h-3 !w-3 group-hover:text-white 2xl:!h-4 2xl:!w-4" />,
        credit: modelCredits?.videoModels?.find((m) => m.label.toLowerCase() === 'veo 4k')?.value,
      },
      // {
      //   value: 'seedance_v1',
      //   label: 'Seedance 1.5 Pro',
      //   tier: 'premium',
      //   Icon: <SiBytedance className="!h-3 !w-3 group-hover:text-white 2xl:!h-4 2xl:!w-4" />,
      //   credit: modelCredits?.videoModels?.find((m) => m.label.toLowerCase() === 'seedance v1')
      //     ?.value,
      // },
      // {
      //   value: 'seedance_v2',
      //   label: 'Seedance 2.0',
      //   tier: 'premium',
      //   Icon: <SiBytedance className="!h-3 !w-3 group-hover:text-white 2xl:!h-4 2xl:!w-4" />,
      //   credit: modelCredits?.videoModels?.find((m) => m.label.toLowerCase() === 'seedance v2')
      //     ?.value,
      // },
      {
        value: 'kling_3.0',
        label: 'Kling 3.0',
        tier: 'premium',
        Icon: <KlingIcon className="!h-3 !w-3 group-hover:text-white 2xl:!h-4 2xl:!w-4" />,
        credit: modelCredits?.videoModels?.find((m) => m.label.toLowerCase() === 'kling 3.0')
          ?.value,
      },
    ].filter((option) => availableCanonicalKeys.has(option.value)),
    [modelCredits, availableCanonicalKeys]
  );

  useEffect(() => {
    if (!videoChatModels.some((option) => option.value === videoModel)) {
      setVideoModel(videoChatModels[0]?.value || '');
    }
  }, [videoChatModels, videoModel]);

  useEffect(() => {
    dispatch(fetchModelCreditsAction());
  }, [dispatch]);

  useEffect(() => {
    if (videoModel !== 'kling_3.0' && aspectRatio === '1:1') {
      setAspectRatio('16:9');
    }

    // Kling specific ratio enforcement based on image orientation
    if (videoModel === 'kling_3.0' && imageOrientation) {
      if (imageOrientation === 'portrait' && aspectRatio !== '9:16') {
        setAspectRatio('9:16');
      } else if (imageOrientation === 'landscape' && aspectRatio !== '16:9') {
        setAspectRatio('16:9');
      } else if (imageOrientation === 'square' && aspectRatio !== '1:1') {
        setAspectRatio('1:1');
      }
    }
  }, [videoModel, aspectRatio, imageOrientation]);

  useEffect(() => {
    const rawUrl = uploadedImages.length > 0 ? uploadedImages[0].preview : productUrl.trim();
    if (rawUrl) {
      const img = new Image();
      img.src = rawUrl;
      img.onload = () => {
        if (img.height > img.width) {
          setImageOrientation('portrait');
        } else if (img.width > img.height) {
          setImageOrientation('landscape');
        } else {
          setImageOrientation('square');
        }
      };
    } else {
      setImageOrientation(null);
    }
  }, [uploadedImages, productUrl]);

  useEffect(() => {
    if (recreateData) {
      if (recreateData.model && videoChatModels.some((m) => m.value === recreateData.model)) {
        setVideoModel(recreateData.model);
      }
      if (recreateData.duration) setVideoDuration(recreateData.duration);
      if (recreateData.aspectRatio) setAspectRatio(recreateData.aspectRatio);

      const s3Base = import.meta.env.VITE_S3_BASE_URL || '';
      const rawImageUrl =
        recreateData.image ||
        recreateData.imageUrl ||
        recreateData.productUrl ||
        recreateData.productImage ||
        '';

      if (rawImageUrl) {
        const isFullUrl = rawImageUrl.startsWith('http');
        const previewUrl = isFullUrl ? rawImageUrl : s3Base + rawImageUrl;

        setHasProductImage(true);
        setPromptText('');
        setProductUrl('');
        setUploadedImages([
          {
            file: null,
            preview: previewUrl,
          },
        ]);
      } else if (recreateData.text) {
        setHasProductImage(false);
        setPromptText(recreateData.text);
        setProductUrl('');
        setUploadedImages([]);
      }

      if (recreateData.promotion) setPromotion(recreateData.promotion);
      if (recreateData.notes) setNotes(recreateData.notes);
      if (recreateData.productName) {
        dispatch(setFields({ brand_name: recreateData.productName }));
      }
    }
  }, [recreateData, dispatch, videoChatModels]);

  const handleGenerateClick = async () => {
    if (isLoading || isUploading) return;
    const newErrors = {};
    if (hasProductImage === null || hasProductImage === undefined)
      newErrors.hasProductImage = 'Please select Yes or No';
    if (!videoModel) newErrors.videoModel = 'Model is required';
    if (!videoDuration) newErrors.videoDuration = 'Duration is required';
    if (!aspectRatio) newErrors.aspectRatio = 'Aspect ratio is required';
    if (!brand_name) newErrors.brandName = 'Brand name is required';
    if (hasProductImage === true && !productUrl.trim() && uploadedImages.length === 0)
      newErrors.productUrl = 'Product Image is Required';
    if (hasProductImage === false && !promptText.trim()) newErrors.promptText = 'Prompt is required';

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    try {
      setIsUploading(true);
      const userId = userData?.user_id;
      let imageUrl = '';

      if (hasProductImage === true) {
        const rawUrl = uploadedImages.length > 0 ? uploadedImages[0].preview : productUrl.trim();
        const rawFile = uploadedImages.length > 0 ? uploadedImages[0].file : null;

        if (rawFile) {
          try {
            const uploadedUrl = await uploadToS3(rawFile, userId, true);
            globalToast.dismiss();
            if (uploadedUrl) {
              imageUrl = `${import.meta.env.VITE_S3_BASE_URL}${uploadedUrl}`;
            } else {
              globalToast.error('Image upload failed');
              setIsUploading(false);
              return;
            }
          } catch (error) {
            globalToast.dismiss();
            console.error('Upload error:', error);
            globalToast.error('Error uploading image');
            setIsUploading(false);
            return;
          }
        } else if (rawUrl && !rawUrl.startsWith('blob:')) {
          try {
            globalToast.loading('Uploading image...');
            const res = await fetch(rawUrl);
            const blob = await res.blob();
            const urlFile = new File([blob], 'image.jpg', { type: blob.type || 'image/jpeg' });
            const uploadedUrl = await uploadToS3(urlFile, userId, true);
            globalToast.dismiss();
            if (uploadedUrl) {
              imageUrl = `${import.meta.env.VITE_S3_BASE_URL}${uploadedUrl}`;
            } else {
              globalToast.error('Image upload failed');
              setIsUploading(false);
              return;
            }
          } catch (error) {
            globalToast.dismiss();
            console.error('Upload error:', error);
            globalToast.error('Error uploading image');
            setIsUploading(false);
            return;
          }
        }
      }

      // Upload custom avatar images to S3 if present
      let uploadedAvatars = [];
      if (isCustomAvatar) {
        try {
          // globalToast.loading('Uploading avatar images...');
          const uploadPromises = customAvatarImages.map(async (img) => {
            if (img.file) {
              const s3Path = await uploadToS3(img.file, userId, true);
              return s3Path ? `${import.meta.env.VITE_S3_BASE_URL}${s3Path}` : null;
            }
            // Already an S3/HTTP URL (e.g. from recreate) — use directly, no re-upload needed
            if (img.preview && img.preview.startsWith('http')) {
              return img.preview;
            }
            // base64 data URL from camera capture
            if (img.preview) {
              const blob = await fetch(img.preview).then((r) => r.blob());
              const file = new File([blob], `avatar-${Date.now()}.jpg`, { type: 'image/jpeg' });
              const s3Path = await uploadToS3(file, userId, true);
              return s3Path ? `${import.meta.env.VITE_S3_BASE_URL}${s3Path}` : null;
            }
            return null;
          });
          uploadedAvatars = (await Promise.all(uploadPromises)).filter(Boolean);
          globalToast.dismiss();

          if (uploadedAvatars.length !== customAvatarImages.length) {
            globalToast.error('Some avatar images failed to upload');
            setIsUploading(false);
            return;
          }
        } catch (error) {
          globalToast.dismiss();
          console.error('Avatar upload error:', error);
          globalToast.error('Error uploading avatar images');
          setIsUploading(false);
          return;
        }
      }

      const payload = {
        inputs: {
          type: 'avatar',
          model: videoModel,
          numberOfVideos: 1,
          duration: videoDuration,
          aspectRatio: aspectRatio,
          avatarType: isCustomAvatar ? 'custom' : 'ai_library',
          ...(isCustomAvatar
            ? { uploadedAvatars }
            : { avatarId: avatar?._id || avatar?.id || avatar?.avatar_id }),
          productName: brand_name || '',
          image: imageUrl,
          text: hasProductImage === true ? '' : promptText,
          promotion: promotion,
          notes: notes,
        },
      };

      const response = await dispatch(generateImageAndScript(payload));
      const id = response?.data?._id || response?._id;
      if (id) {
        onGenerate(id);
      }
    } catch (error) {
      console.error('Generation failed:', error);
    } finally {
      setIsUploading(false);
    }
  };

  const videoTimer = useMemo(() => {
    const hasPlan8 = Object.keys(userData?.userSubscriptionType || {}).includes('8');

    if (videoModel === 'veo_4k') {
      return [{ value: '8s', label: '8s' }];
    }
    if (videoModel === 'veo' || videoModel === 'veo-3.1-fast') {
      let options = [
        // { value: '4s', label: '4s' },
        // { value: '6s', label: '6s' },
        { value: '8s', label: '8s' },
        { value: '15s', label: '15s' },
        // { value: '22s', label: '22s' },
        // { value: '29s', label: '29s' },
        // { value: '36s', label: '36s' },
        // { value: '43s', label: '43s' },
        // { value: '50s', label: '50s' },
        // { value: '57s', label: '57s' },
      ];

      if (hasPlan8) {
        if (videoModel === 'veo-3.1-fast') {
          // limit to 8s
          options = options.filter((opt) => parseInt(opt.value) <= 8);
        }

        // if (videoModel === 'veo') {
        //   // limit to 6s
        //   options = options.filter((opt) => parseInt(opt.value) <= 6);
        // }
      }

      return options;
    }
    if (videoModel === 'soraPro_4k') {
      return [
        // { value: '4s', label: '4s' },
        { value: '8s', label: '8s' },
        { value: '12s', label: '12s' },
        { value: '16s', label: '16s' },
        { value: '21s', label: '21s' },
      ];
    }
    if(videoModel === 'kling_3.0') {
      return [
        // { value: '4s', label: '4s' },
        // { value: '6s', label: '6s' },
        { value: '8s', label: '8s' },
        { value: '12s', label: '12s' },
      ];
    }

    return [
      // { value: '4s', label: '4s' },
      { value: '8s', label: '8s' },
      { value: '12s', label: '12s' },
      { value: '16s', label: '16s' },
      { value: '20s', label: '20s' },
    ];
  }, [videoModel]);

  useEffect(() => {
    setVideoDuration(videoTimer[0].value);
  }, [videoTimer]);

  const availableRatios = [
    { value: '9:16', label: '9:16', icon: RectangleVertical },
    { value: '1:1', label: '1:1', icon: Square, onlyModels: ['kling_3.0'] },
    { value: '16:9', label: '16:9', icon: RectangleHorizontal },
  ];
  const handlePaste = async (e) => {
    const items = e.clipboardData.items;

    // 1. Handle actual image file paste
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const file = items[i].getAsFile();
        if (file) {
          const preview = {
            file,
            preview: URL.createObjectURL(file),
          };
          setUploadedImages([preview]);
          return;
        }
      }
    }

    // 2. Handle pasted URL
    const pastedText = e.clipboardData.getData('text');

    if (pastedText && pastedText.startsWith('http')) {
      const imageExtensions = /\.(jpg|jpeg|png|gif|webp|svg|bmp|avif)(\?.*)?$/i;
      if (!imageExtensions.test(pastedText)) {
        toast.error('Please paste a valid image URL');
        return;
      }
      setProductUrl(pastedText);

      // Optional: show preview for URL also
      setUploadedImages([
        {
          file: null,
          preview: pastedText,
        },
      ]);
    }
  };

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const preview = {
      file,
      preview: URL.createObjectURL(file),
    };

    setUploadedImages([preview]);
  };

  const removeImage = (index) => {
    setUploadedImages((prev) => prev.filter((_, i) => i !== index));
  };

  const isFormValid =
    (productUrl || uploadedImages.length > 0) && videoModel && videoDuration && aspectRatio;

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden rounded-3xl border border-black/10 bg-white sm:grid-cols-2 dark:border-[#3a3a3a] dark:bg-[#1c1c1c]">
      {/* Preview */}
      <div className="relative h-full min-h-[350px] w-full bg-gray-100 dark:bg-[#1c1c1c]">
        {!recreateData && (
          <button
            onClick={onBack}
            className="absolute top-6 left-6 z-10 rounded-full bg-black/40 p-2 text-white hover:bg-black/60"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        )}

        {isCustomAvatar ? (
          <>
            <img
              src={customAvatarImages[carouselIndex]?.preview}
              alt={`Custom Avatar ${carouselIndex + 1}`}
              className="h-full w-full object-cover"
            />
            {customAvatarImages.length > 1 && (
              <>
                <button
                  onClick={() =>
                    setCarouselIndex(
                      (prev) => (prev - 1 + customAvatarImages.length) % customAvatarImages.length
                    )
                  }
                  className="absolute top-1/2 left-4 z-10 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white hover:bg-black/70"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <button
                  onClick={() => setCarouselIndex((prev) => (prev + 1) % customAvatarImages.length)}
                  className="absolute top-1/2 right-4 z-10 -translate-y-1/2 rounded-full bg-black p-2 text-white hover:bg-black/70"
                >
                  <ChevronRight className="h-5 w-5" />
                </button>
                <div className="absolute bottom-6 left-1/2 z-10 flex -translate-x-1/2 gap-2 2xl:bottom-20">
                  {customAvatarImages.map((_, i) => (
                    <button
                      key={i}
                      onClick={() => setCarouselIndex(i)}
                      className={`h-2 w-2 rounded-full transition-all ${i === carouselIndex ? 'scale-125 bg-white' : 'bg-white/40'}`}
                    />
                  ))}
                </div>
              </>
            )}
          </>
        ) : (
          <>
            <img
              src={getAvatarUrl(avatar)}
              alt="Selected Avatar"
              className="h-full w-full object-cover"
            />
            {avatars?.length > 1 && (
              <>
                <button
                  onClick={handlePrevAvatar}
                  className="absolute top-1/2 left-4 z-10 -translate-y-1/2 rounded-full bg-black p-2 text-white hover:bg-black/70"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <button
                  onClick={handleNextAvatar}
                  className="absolute top-1/2 right-4 z-10 -translate-y-1/2 rounded-full bg-black p-2 text-white hover:bg-black/70"
                >
                  <ChevronRight className="h-5 w-5" />
                </button>
              </>
            )}
          </>
        )}

        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />
      </div>

      {/* Form */}
      <div className="custom-scrollbar flex flex-col gap-6 overflow-y-auto p-6 pb-10 2xl:px-6 2xl:py-8 2xl:pb-15">
        <div className="flex flex-col gap-2">
          <span className="flex w-fit items-center gap-1 rounded-full border border-[#6b72f8]/60 bg-gray-900 px-2.5 py-0.5 text-10 font-medium text-white 2xl:text-xs dark:bg-white dark:text-black">
            🌐 All regional languages supported
          </span>

          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-gray-900 2xl:text-base dark:text-white">
              Do you have a product image?
            </label>
            <div className="flex items-center gap-1 rounded-full bg-gray-100 p-1 dark:bg-[#9092941A]">
              <button
                type="button"
                onClick={() => { setHasProductImage(true); setPromptText(''); setErrors((prev) => ({ ...prev, promptText: null, hasProductImage: null })); }}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-all ${
                  hasProductImage === true
                    ? 'bg-gray-900 text-white dark:bg-white dark:text-black'
                    : 'text-gray-500 hover:text-gray-700 dark:text-white/50 dark:hover:text-white/80'
                }`}
              >
                Yes
              </button>
              <button
                type="button"
                onClick={() => { setHasProductImage(false); setProductUrl(''); setUploadedImages([]); setErrors((prev) => ({ ...prev, productUrl: null, hasProductImage: null })); }}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-all ${
                  hasProductImage === false
                    ? 'bg-gray-900 text-white dark:bg-white dark:text-black'
                    : 'text-gray-500 hover:text-gray-700 dark:text-white/50 dark:hover:text-white/80'
                }`}
              >
                No
              </button>
            </div>
          </div>

          {hasProductImage === null && errors.hasProductImage && (
            <span className="text-[12px] text-red-400">{errors.hasProductImage}</span>
          )}

          {hasProductImage === true && (
            <>
              <div className={`flex items-center gap-2 rounded-full border border-transparent bg-gray-100 p-1 dark:bg-[#9092941A] ${errors.productUrl ? 'border-red-500/50' : ''}`}>
                <input
                  value={productUrl}
                  onChange={(e) => setProductUrl(e.target.value)}
                  onPaste={handlePaste}
                  className="w-full flex-1 bg-transparent px-2 py-1.5 text-xs font-normal text-gray-900 placeholder:text-gray-500 focus:outline-none 2xl:px-4 2xl:text-sm dark:text-white dark:placeholder:text-white/40"
                  placeholder="Paste your product Image"
                />
                <LinkIcon className="size-3.5 rotate-90 text-gray-500 dark:text-white/60" />
                <label
                  htmlFor="brand-logo-2"
                  className="flex cursor-pointer items-center gap-1.5 rounded-full bg-zinc-200 px-2 py-1.5 text-10 whitespace-nowrap text-zinc-800 hover:bg-zinc-300 2xl:text-xs dark:bg-[#FFFFFF]/20 dark:text-white dark:hover:bg-white/10"
                >
                  <CloudUpload className="size-3.5 text-zinc-800 dark:text-white" />
                  Upload Image
                </label>
                <input
                  id="brand-logo-2"
                  type="file"
                  className="hidden"
                  accept="image/*"
                  onChange={handleImageUpload}
                />
              </div>

              {uploadedImages.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2 2xl:gap-3">
                  {uploadedImages.map((img, index) => (
                    <div
                      key={index}
                      className="group relative h-12 w-12 border border-black/10 2xl:h-16 2xl:w-16 dark:border-white/10"
                    >
                      <img
                        src={img.preview}
                        alt="upload"
                        className="h-full w-full cursor-pointer rounded-md object-cover"
                        onClick={() => {
                          const allImages = uploadedImages.map((i) => i.preview);
                          setLightboxImages(allImages);
                          setLightboxImage(img.preview);
                          setLightboxOpen(true);
                        }}
                      />
                      <button
                        type="button"
                        className="absolute -top-2 -right-2 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-white opacity-0 shadow-md duration-300 group-hover:opacity-100"
                        onClick={() => removeImage(index)}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {errors.productUrl && (
                <span className="text-[12px] text-red-400">{errors.productUrl}</span>
              )}
            </>
          )}

          {hasProductImage === false && (
            <>
              <textarea
                value={promptText}
                onChange={(e) => setPromptText(e.target.value)}
                className={`w-full resize-none rounded-2xl bg-gray-100 p-3 text-xs text-gray-900 placeholder:text-sm placeholder:text-gray-500 focus:outline-none 2xl:text-sm dark:bg-[#9092941A] dark:text-white dark:placeholder:text-[#AFAFAF] ${errors.promptText ? 'border border-red-500/50' : ''}`}
                placeholder="Describe your product or scene (e.g. a sleek black smartwatch on a white surface)"
                rows={3}
              />
              {errors.promptText && (
                <span className="mt-1 text-[12px] text-red-400">{errors.promptText}</span>
              )}
            </>
          )}
        </div>

        <AnimatePresence>
          {lightboxOpen && (
            <ShowLightBox
              lightboxImage={lightboxImage}
              closeLightbox={() => setLightboxOpen(false)}
              images={lightboxImages}
            />
          )}
        </AnimatePresence>

        <div className="flex gap-4">
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-gray-900 2xl:text-base dark:text-white">Model*</label>
            <AIAvatarCommonDropdown
              options={videoChatModels}
              placeholder="Choose Model"
              value={videoChatModels.find((m) => m.value === videoModel)}
              onChange={(val) => {
                const hasPlan8 = Object.keys(userData?.userSubscriptionType || {}).includes('8');
                if (hasPlan8) {
                  if (val !== 'sora' && val !== 'veo-3.1-fast') {
                    // window.location.href = 'https://adsgpt-dev.poweradspy.com/amember/signup';
                    setIsUpgradeModalOpen(true);
                    return;
                  }
                }
                setVideoModel(val);
                if (errors.videoModel) setErrors((prev) => ({ ...prev, videoModel: '' }));
              }}
              className="!border-[#3a3a3a] !bg-[#2c2c2c]"
            />
            {errors.videoModel && (
              <span className="mt-1 text-[12px] text-red-400">{errors.videoModel}</span>
            )}
          </div>
          <div className="flex flex-1 flex-col gap-2">
            <label className="text-sm font-medium text-gray-900 2xl:text-base dark:text-white">Duration*</label>
            <AIAvatarCommonDropdown
              options={videoTimer}
              value={videoTimer.find((m) => m.value === videoDuration)}
              onChange={(val) => setVideoDuration(val)}
              className="!border-[#3a3a3a] !bg-[#2c2c2c]"
            />
            {errors.videoDuration && (
              <span className="mt-1 text-[12px] text-red-400">{errors.videoDuration}</span>
            )}
          </div>
        </div>

        {['sora', 'veo-3.1-fast'].includes(videoModel) && (
          <div className="flex items-center gap-2 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-400">
            <span>⚠</span>
            <span>Lower quality model selected. Video output quality may be reduced.</span>
          </div>
        )}

        <div className="flex flex-col gap-3">
          <label className="text-sm font-medium text-gray-900 2xl:text-base dark:text-white">Aspect Ratio*</label>
          <div className="flex flex-wrap gap-3">
            {availableRatios
              .filter((r) => !r.onlyModels || r.onlyModels.includes(videoModel))
              .map((ratio) => {
                const isSelected = aspectRatio === ratio.value;
                const isKling = videoModel === 'kling_3.0';
                let isDisabled = false;

                if (isKling && imageOrientation) {
                  if (imageOrientation === 'portrait' && ratio.value !== '9:16')
                    isDisabled = true;
                  if (imageOrientation === 'landscape' && ratio.value !== '16:9')
                    isDisabled = true;
                  if (imageOrientation === 'square' && ratio.value !== '1:1')
                    isDisabled = true;
                }

                return (
                  <button
                    key={ratio.value}
                    disabled={isDisabled}
                    onClick={() => {
                      if (isDisabled) return;
                      setAspectRatio(ratio.value);
                    }}
                    className={`flex items-center gap-2 rounded-full px-4 py-2 text-xs transition-all ${
                      isSelected
                        ? 'border border-blue-500 bg-blue-500/10 text-gray-900 dark:text-white'
                        : isDisabled
                          ? 'border border-transparent bg-gray-100 text-gray-400 cursor-not-allowed opacity-40 grayscale dark:bg-[#38383840] dark:text-white/20'
                          : errors.aspectRatio
                            ? 'border border-red-500/50 bg-gray-100 text-gray-500 hover:border-black/20 dark:bg-[#38383880] dark:text-white/40 dark:hover:border-white/20'
                            : 'border border-transparent bg-gray-100 text-gray-500 hover:border-black/20 dark:bg-[#38383880] dark:text-white/40 dark:hover:border-white/20'
                    }`}
                  >
                    <ratio.icon className="h-4 w-4" />
                    {ratio.label}
                  </button>
                );
              })}
          </div>
          {errors.aspectRatio && (
            <span className="mt-1 text-[12px] text-red-400">{errors.aspectRatio}</span>
          )}
          {/* {videoModel === 'kling_3.0' && aspectRatio === '9:16' && (
            <div className="mt-1 flex w-fit items-center gap-1 rounded-md border border-blue-500/30 bg-blue-500/10 px-2 py-0.5 text-[10px] text-blue-400 2xl:text-xs">
              <span>ℹ</span>
              <span>Product image also should be in 9:16 ratio</span>
            </div>
          )} */}
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-gray-900 2xl:text-base dark:text-white">
            Brand/product Name*
          </label>
          <BrandSearch isAvatarAdsSearch={true} />
          {errors.brandName && (
            <span className="mt-1 text-[12px] text-red-400">{errors.brandName}</span>
          )}
        </div>

        {videoModel !== 'seedance_v1' && (
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-gray-900 2xl:text-base dark:text-white">Promotional Info</label>
            <input
              value={promotion}
              onChange={(e) => setPromotion(e.target.value)}
              className="w-full rounded-full bg-gray-100 p-3 px-4 text-xs text-gray-900 placeholder:text-sm placeholder:text-gray-500 focus:outline-none 2xl:text-base dark:bg-[#9092941A] dark:text-white dark:placeholder:text-[#AFAFAF]"
              placeholder="Enter your Promotional Info"
            />
          </div>
        )}

        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-gray-900 2xl:text-base dark:text-white">Prompt</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full resize-none rounded-2xl bg-gray-100 p-3 text-xs text-gray-900 placeholder:text-sm placeholder:text-gray-500 focus:outline-none 2xl:text-sm dark:bg-[#9092941A] dark:text-white dark:placeholder:text-[#AFAFAF]"
            placeholder="e.g. white background, aerial drone shot, etc"
            rows={3}
          />
        </div>

        <div className="mt-auto mb-3 flex items-center justify-end gap-2">
          {(() => {
            const est = estimateAdVideoCredits({ video_model: videoModel, video_duration: videoDuration, no_of_ads: 1, modelCredits });
            const enough = availableCredits >= est;
            const showCreditPill = videoModel && videoDuration;
            return (
              <>
                {showCreditPill && (
                  enough ? (
                    <ShadcnTooltip label={`Will use : ${est} credits, ${availableCredits - est} left after`}>
                      <span className="rounded-full bg-black/5 px-2.5 py-1 text-xs font-medium text-gray-600 dark:bg-white/20 dark:text-white/90">
                        ~{est} credits
                      </span>
                    </ShadcnTooltip>
                  ) : (
                    <span className="rounded-full border border-red-500 bg-red-500 px-2.5 py-1 text-xs font-medium text-white">
                      Not enough credits — need {est}, you have {availableCredits}
                    </span>
                  )
                )}
                <button
                  disabled={isLoading || isUploading || (showCreditPill && !enough)}
                  onClick={handleGenerateClick}
                  className={`rounded-full px-6 py-2.5 text-sm font-semibold text-white hover:opacity-90 2xl:py-3 2xl:text-base dark:text-black ${isLoading || isUploading || (showCreditPill && !enough) ? 'cursor-not-allowed bg-gray-900/30 dark:bg-white/30' : 'bg-gray-900 dark:bg-white'}`}
                >
                  {isLoading || isUploading ? (
                    <Loader2 className="h-5 w-5 animate-spin text-white dark:text-black" />
                  ) : (
                    'Generate'
                  )}
                </button>
              </>
            );
          })()}
        </div>
      </div>
      <UpgradeModal
        isOpen={isUpgradeModalOpen}
        onClose={() => setIsUpgradeModalOpen(false)}
        onUpgrade={() => {
          setIsUpgradeModalOpen(false);
          window.open(SIGNUP_URL, '_blank');
        }}
      />
    </div>
  );
};

const AvatarScriptResult = ({ avatar, onBack, generatedId, handleGenerate }) => {
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [regenerationError, setRegenerationError] = useState(null);
  const [script, setScript] = useState(null);
  const [tone, setTone] = useState('');
  const [searchParams, setSearchParams] = useSearchParams();
  const { imageAndScript, isLoading } = useSelector((state) => state.adVideoNew);
  const dispatch = useDispatch();

  const generatedData = useMemo(() => {
    return imageAndScript?.data || imageAndScript;
  }, [imageAndScript]);

  const currentDataId = useMemo(() => {
    return (
      imageAndScript?._id ||
      imageAndScript?.id ||
      imageAndScript?.data?._id ||
      imageAndScript?.data?.id ||
      generatedData?._id ||
      generatedData?.id
    );
  }, [imageAndScript, generatedData]);

  const generationError = useMemo(() => {
    if (generatedData?._id === generatedId || currentDataId === generatedId) {
      if (generatedData?.type === 'error' || generatedData?.status >= 400) {
        return generatedData?.error || 'Generation failed';
      }
    }
    return null;
  }, [generatedData, generatedId, currentDataId]);

  const isImageFailed = useMemo(() => {
    return generatedData?.generatedImage === 'failed' || generatedData?.image === 'failed';
  }, [generatedData]);

  const isScriptFailed = useMemo(() => {
    return generatedData?.generatedScript === 'failed' || generatedData?.text === 'failed';
  }, [generatedData]);

  const isImageLoading = useMemo(() => {
    if (
      generationError &&
      (generatedData?.type === 'error' || generatedData?.error?.toLowerCase().includes('image'))
    )
      return false;
    if (isImageFailed) return false;
    return (
      !(generatedData?.generatedImage || generatedData?.image) || currentDataId !== generatedId
    );
  }, [generatedData, currentDataId, generatedId, generationError, isImageFailed]);

  const isScriptLoading = useMemo(() => {
    if (
      generationError &&
      (generatedData?.type === 'error' || generatedData?.error?.toLowerCase().includes('script'))
    )
      return false;
    if (isScriptFailed) return false;
    return (
      !(generatedData?.generatedScript || generatedData?.text) || currentDataId !== generatedId
    );
  }, [generatedData, currentDataId, generatedId, generationError, isScriptFailed]);

  useEffect(() => {
    if (generatedData?._id === generatedId || currentDataId === generatedId) {
      const newScript = generatedData?.generatedScript || generatedData?.text;
      if (newScript && typeof newScript !== 'string') {
        setScript(newScript);
      }
    }
  }, [generatedData, generatedId, currentDataId]);

  const displayImage = useMemo(() => {
    if (currentDataId === generatedId) {
      const path = generatedData?.generatedImage || generatedData?.image;
      if (path && typeof path === 'string' && path !== 'failed') {
        if (path.startsWith('http')) return path;
        return `${import.meta.env.VITE_S3_BASE_URL || ''}${path}`;
      }
    }
    return getAvatarUrl(avatar);
  }, [generatedData, avatar, currentDataId, generatedId]);

  const handleToneChange = async (newTone) => {
    setTone(newTone);
    setIsRegenerating(true);
    setRegenerationError(null);
    try {
      // globalToast.loading('Generating script...');
      const response = await dispatch(regenerateScript({ id: generatedId, tone: newTone }));
      if (response?.data?.generatedScript) {
        const newScript = response.data.generatedScript;
        setScript(newScript);
        const updatedData = {
          ...(imageAndScript?.data || imageAndScript),
          generatedScript: newScript,
          type: 'both',
          status: 200,
          error: '',
        };
        dispatch(setImageAndScript(updatedData));
        globalToast.success('Script generated successfully!');
      }
    } catch (error) {
      console.error('Regeneration failed:', error);
      setRegenerationError(
        error.response?.data?.error || error.message || 'Failed to generate script'
      );
    } finally {
      setIsRegenerating(false);
    }
  };

  const handleSegmentChange = (id, newText) => {
    setScript((prev) => {
      if (!prev || typeof prev === 'string') return prev;
      return {
        ...prev,
        script: prev.script.map((s) =>
          s.id === id
            ? { ...s, text: newText, wordCount: getWordCount(newText), charCount: newText.length }
            : s
        ),
      };
    });
  };

  const getWordCount = (text) => (text?.trim() ? text.trim().split(/\s+/).length : 0);

  const scriptSegments = useMemo(() => {
    if (!script) return [];
    if (typeof script === 'string') {
      try {
        const parsed = JSON.parse(script);
        return parsed.script || [];
      } catch (e) {
        return [];
      }
    }
    return script.script || [];
  }, [script]);

  const isAnySegmentInvalid = useMemo(() => {
    return scriptSegments.some((segment) => {
      const count = getWordCount(segment.text);
      const isOver = segment.maxWords && count > segment.maxWords;
      const isUnder = segment.minWords && count < segment.minWords;
      return isOver || isUnder;
    });
  }, [scriptSegments]);

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden rounded-3xl border border-black/10 bg-white sm:grid-cols-2 dark:border-[#3a3a3a] dark:bg-[#1c1c1c]">
      {/* Preview */}
      <div className="relative h-full min-h-[350px] w-full bg-gray-100 dark:bg-[#1c1c1c]">
        <button
          onClick={onBack}
          disabled={isImageLoading || isScriptLoading || isLoading}
          className={`absolute top-6 left-6 z-10 rounded-full bg-black p-2 text-white hover:bg-black/60 ${isImageLoading || isScriptLoading || isLoading ? 'cursor-not-allowed opacity-50' : ''}`}
        >
          <ChevronLeft className="h-5 w-5" />
        </button>

        {isImageLoading && !generationError ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-4 bg-gray-100 dark:bg-[#0F0F0F]">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-black/10 border-t-gray-900 dark:border-white/20 dark:border-t-white" />
            <span className="text-xs font-medium text-gray-500 dark:text-white/60">
              Generating your avatar image...
            </span>
          </div>
        ) : isImageFailed ||
          (generationError &&
            (generatedData?.type === 'error' ||
              generatedData?.error?.toLowerCase().includes('image'))) ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-4 bg-gray-100 p-6 text-center dark:bg-[#0F0F0F]">
            <div className="rounded-full bg-red-500/10 p-3">
              <X className="h-8 w-8 text-red-500" />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-sm font-semibold text-gray-900 dark:text-white">Failed to generate Avatar</span>
              <span className="text-xs text-gray-500 dark:text-white/40">Please try again</span>
            </div>
          </div>
        ) : (
          <img src={displayImage} alt="Selected Avatar" className="h-full w-full object-cover" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />
      </div>

      {/* Script */}
      <div className="flex min-h-0 flex-col gap-2 p-5 2xl:p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Generated Script</h3>

        {isScriptLoading || isRegenerating ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 rounded-2xl bg-gray-100 dark:bg-[#9092941A]">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-black/10 border-t-gray-900 dark:border-white/20 dark:border-t-white" />
            <span className="text-xs font-medium text-gray-500 dark:text-white/60">Crafting your script...</span>
          </div>
        ) : isScriptFailed ||
          regenerationError ||
          (generationError &&
            (generatedData?.type === 'error' ||
              generatedData?.error?.toLowerCase().includes('script'))) ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 rounded-2xl border border-red-500/20 bg-red-500/10 p-6 text-center">
            <div className="rounded-full bg-red-500/10 p-3">
              <X className="h-8 w-8 text-red-500" />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-sm font-semibold text-gray-900 dark:text-white">
                {regenerationError || 'Failed to Generate Script'}
              </span>
              <span className="text-xs text-gray-500 dark:text-white/40">
                {regenerationError ? 'Please try again with a different tone' : 'please try again'}
              </span>
            </div>
          </div>
        ) : (
          <div className="custom-scrollbar flex max-h-[65vh] min-h-0 flex-1 flex-col gap-3 overflow-hidden rounded-2xl bg-gray-100 p-4 dark:bg-[#9092941A]">
            <div className="flex gap-4 px-2 text-[10px] font-bold tracking-wider text-gray-500 uppercase dark:text-white/40">
              <div className="w-24 shrink-0">Timestamp</div>
              <div className="flex-1">Script</div>
            </div>

            <div className="custom-scrollbar flex flex-1 flex-col gap-4 overflow-y-auto pr-2">
              {scriptSegments.map((item) => {
                const currentCount = getWordCount(item.text);
                const isOverLimit = currentCount > item.maxWords;

                return (
                  <div key={item.id} className="group flex items-start gap-4">
                    <div className="w-24 shrink-0 pt-3 text-xs font-medium text-gray-500 dark:text-white/50">
                      {item.start} - {item.end}
                    </div>
                    <div className="relative flex-1">
                      <textarea
                        value={item.text}
                        onChange={(e) => handleSegmentChange(item.id, e.target.value)}
                        className={`custom-scrollbar w-full resize-none rounded-xl border border-transparent bg-white p-3 text-sm text-gray-900 transition-all focus:border-black/20 focus:outline-none dark:bg-[#1C1C1C]/40 dark:text-white/80 dark:focus:border-white/20 ${
                          isOverLimit ? 'border-red-500/50 bg-red-500/5' : 'hover:bg-black/5 dark:hover:bg-[#1C1C1C]/60'
                        }`}
                        rows={2}
                      />
                      {getWordCount(item.text) > item.maxWords && (
                        <p className="mt-1 text-[12px] font-medium text-red-400 italic">
                          Word limit exceeded (Max: {item.maxWords}, Current:{' '}
                          {getWordCount(item.text)})
                        </p>
                      )}
                      {getWordCount(item.text) < item.minWords && (
                        <p className="mt-1 text-[12px] font-medium text-yellow-400 italic">
                          Too few words (Min: {item.minWords}, Current: {getWordCount(item.text)})
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {!(
          isImageLoading ||
          isScriptLoading ||
          isRegenerating ||
          generationError ||
          isImageFailed ||
          isScriptFailed
        ) && (
          <div className="mt-4 flex items-center justify-end gap-3 2xl:mb-6">
            <div className="">
              <Select value={tone} onValueChange={handleToneChange}>
                <SelectTrigger className="backdrop-blur-100 ![&>svg]:text-gray-500 dark:![&>svg]:text-white rounded-full border-none bg-gray-100 !px-5 py-[18px] text-sm !text-gray-900 hover:bg-black/5! dark:bg-[#9D9B9B80] dark:!text-white dark:hover:bg-[#9D9B9B70]! [&>svg]:size-5">
                  <SelectValue className="text-gray-900 dark:text-white" placeholder="Select Tone" />
                </SelectTrigger>

                <SelectContent className="z-[999999] min-w-fit border backdrop-blur-[100px] dark:border-white/20 dark:bg-[#0D0D0D]/50 dark:text-white">
                  <SelectItem className="text-[10px] 2xl:text-sm" value="Motivational">
                    Motivational
                  </SelectItem>
                  <SelectItem className="text-[10px] 2xl:text-sm" value="Enthusiastic">
                    Enthusiastic
                  </SelectItem>
                  <SelectItem className="text-[10px] 2xl:text-sm" value="Empathetic">
                    Empathetic
                  </SelectItem>
                  <SelectItem className="text-[10px] 2xl:text-sm" value="Casual">
                    Casual
                  </SelectItem>
                  <SelectItem className="text-[10px] 2xl:text-sm" value="Professional">
                    Professional
                  </SelectItem>
                  <SelectItem className="text-[10px] 2xl:text-sm" value="Friendly">
                    Friendly
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            {!regenerationError && (
              <button
                disabled={
                  isLoading ||
                  isImageLoading ||
                  isScriptLoading ||
                  isRegenerating ||
                  isAnySegmentInvalid
                }
                onClick={async () => {
                  try {
                    const payload = { script: scriptSegments };

                    const res = await dispatch(generateAvatarVideo(generatedId, payload));
                    if (res) {
                      setSearchParams({}, { replace: true });
                      dispatch(setImageAndScript(null));
                      dispatch(setFields({ brand_name: '', brandInfo: {}, selectedBrand: {} }));
                      handleGenerate?.();
                    }
                  } catch (err) {
                    console.error('Final generation error:', err);
                  }
                }}
                className={`rounded-full bg-gray-900 px-8 py-2 text-sm font-bold text-white hover:opacity-90 dark:bg-white dark:text-black dark:hover:bg-white/90 ${isLoading || isImageLoading || isScriptLoading || isRegenerating || isAnySegmentInvalid ? 'cursor-not-allowed opacity-50' : ''}`}
              >
                {isLoading ? <Loader2 className="h-5 w-5 animate-spin text-white dark:text-black" /> : 'Generate'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const FACE_ANGLES = ['Left', 'Front', 'Right'];
const FACE_ANGLE_IMAGES = [avatarLeft, avatarFront, avatarRight];
const FACE_ANGLE_ROTATIONS = ['-rotate-12', 'rotate-0 z-10 scale-102', 'rotate-12 mr-3'];
const FACE_ANGLE_TEXTS = [
  'Upload a photo of your face\nturned slightly to the left',
  'Upload a front-facing\nphoto of your face',
  'Upload a photo of your face\nturned slightly to the right',
];

const UploadAvatarContent = ({ onBack, onUseCamera, onUploadImages }) => {
  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <div className="mx-auto flex max-h-[80vh] w-full max-w-4xl flex-1 flex-col items-center justify-center gap-8 rounded-3xl">
        <div className="w-full text-left">
          <h2 className="flex items-center gap-3 text-lg font-semibold text-gray-900 2xl:text-2xl dark:text-white">
            <button
              onClick={onBack}
              className="rounded-full p-1 text-gray-500 transition hover:bg-black/5 hover:text-black dark:text-white/70 dark:hover:bg-white/10 dark:hover:text-white"
            >
              <ChevronLeft className="h-6 w-6" />
            </button>
            Upload Your Face Angles
          </h2>
          <p className="mt-1 ml-10 text-[11px] font-light text-gray-500 2xl:text-sm dark:text-white/80">
            Add three photos: left, center, and right for Avatar Generation
          </p>
        </div>

        <div className="grid min-h-0 w-full flex-1 grid-cols-2 gap-2">
          {/* Use Camera Card */}
          <button
            onClick={onUseCamera}
            className="group relative h-full overflow-hidden rounded-2xl border-2 bg-[#1c1c1c] transition hover:border-blue-500"
          >
            <img
              src={webcamPlaceholderImg}
              alt="Use Camera"
              className="h-[120%] w-full object-cover transition-opacity duration-300 group-hover:opacity-0"
            />
            <img
              src={webcamImgGif}
              alt="Use Camera Animation"
              className="absolute inset-0 h-[120%] w-full object-cover opacity-0 transition-opacity duration-300 group-hover:opacity-100"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
            <div className="absolute bottom-5 left-1/2 -translate-x-1/2 transform">
              <span className="rounded-full bg-white px-6 py-2 text-xs font-semibold whitespace-nowrap text-black 2xl:px-8 2xl:py-2.5 2xl:text-base">
                Use Camera
              </span>
            </div>
          </button>

          {/* Upload Your Own Image Card */}
          <button
            onClick={onUploadImages}
            className="group relative flex h-full flex-col items-center justify-center overflow-hidden rounded-2xl border-2 bg-gray-50 transition hover:border-blue-500 hover:bg-gray-100 dark:bg-[#1c1c1c] dark:hover:bg-[#1c1c1c]/80"
          >
            <img
              src={avatarUploadBgImg}
              className="absolute right-1/4 z-10 h-auto w-[250px] max-w-[70%] -translate-y-6 transform rounded-2xl object-cover"
              alt=""
            />
            <img
              src={avatarUploadImg}
              className="absolute left-1/3 z-20 h-auto w-[210px] max-w-[60%] rounded-2xl object-cover"
              alt=""
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#0f0f0f] via-[#0f0f0f]/10 to-transparent" />
            <div className="absolute bottom-5 left-1/2 -translate-x-1/2 transform font-semibold whitespace-nowrap text-white 2xl:text-xl">
              Upload your own images
            </div>
          </button>
        </div>
      </div>
    </div>
  );
};

const UploadImagesContent = ({ onBack, onUploadComplete, onUseCamera }) => {
  const [images, setImages] = useState([null, null, null]);

  const handleFileChange = (index, e) => {
    const file = e.target.files[0];
    if (!file) return;
    setImages((prev) => {
      const updated = [...prev];
      updated[index] = { file, preview: URL.createObjectURL(file) };
      return updated;
    });
  };

  const removeImage = (index) => {
    setImages((prev) => {
      const updated = [...prev];
      if (updated[index]?.preview) URL.revokeObjectURL(updated[index].preview);
      updated[index] = null;
      return updated;
    });
  };

  const allUploaded = images.every(Boolean);

  return (
    <div className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden p-6 pb-0">
      {/* Header */}
      <div className="relative z-50 mb-4 flex shrink-0 items-center justify-between gap-3">
        <button
          onClick={onBack}
          className="rounded-full p-1 text-gray-500 transition hover:bg-black/5 hover:text-black dark:text-white/70 dark:hover:bg-white/10 dark:hover:text-white"
        >
          <ChevronLeft className="h-6 w-6" />
        </button>

        <div className="flex flex-1 flex-col items-center text-center">
          <h2 className="text-lg font-semibold text-gray-900 2xl:text-2xl dark:text-white">Upload Your Face Angles</h2>
          <p className="mt-1 text-[11px] font-light text-gray-500 2xl:text-sm dark:text-white/70">
            Add three photos: left, center, and right for Avatar Generation
          </p>
        </div>
      </div>

      <div className="relative z-10 flex flex-1 flex-col items-center justify-end">
        {/* Continue Button */}
        {/* {allUploaded && (
          <div className="z-40 my-2">
            <button
              onClick={() => onUploadComplete(images)}
              className="rounded-full bg-white px-8 py-3 text-sm font-semibold text-black shadow-[0_0_20px_rgba(255,255,255,0.3)] transition-transform hover:bg-white/90 active:scale-95"
            >
              Continue
            </button>
          </div>
        )} */}

        {/* Cards Wrapper */}
        <div className="group relative flex w-full max-w-152 translate-y-8 items-end justify-center -space-x-8 px-4 sm:-space-x-12 2xl:max-w-3xl 2xl:translate-y-12">
          {FACE_ANGLES.map((angle, index) => {
            // Keep outer wrapper translational movement without rotation
            const wrapperHoverTransforms = [
              'group-hover:-translate-x-3 group-hover:translate-y-1', // Left
              'group-hover:-translate-y-3', // Center
              'group-hover:translate-x-3 group-hover:-translate-y-1', // Right
            ];

            const layoutMods = ['', 'scale-102', 'mr-3'];

            const cardRotation = [
              '-rotate-12 transition-transform duration-500 group-hover:-rotate-[14deg]',
              'rotate-0 transition-transform duration-500',
              'rotate-12 transition-transform duration-500 group-hover:rotate-[14deg]',
            ];

            return (
              <div
                key={angle}
                className={`group/card relative flex ${images[index] ? 'max-h-[400px] 2xl:max-h-[500px]' : 'max-h-[400px] 2xl:max-h-[500px]'} w-full flex-1 justify-center transition-all duration-500 ease-out ${index === 1 ? 'z-20' : 'z-10'} ${wrapperHoverTransforms[index]} ${layoutMods[index]}`}
              >
                {images[index] ? (
                  <div
                    className={`${index === 1 ? 'mt-0' : 'mt-10 2xl:mt-6'} relative aspect-[1/2] w-full overflow-hidden rounded-[2rem] border-2 bg-[#1c1c1c] shadow-2xl transition-all duration-300 group-hover/card:border-blue-500 group-hover/card:brightness-110 ${cardRotation[index]}`}
                  >
                    <img
                      src={images[index].preview}
                      alt={`${angle} angle`}
                      className="h-full w-full object-cover"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent transition-opacity" />
                    <button
                      onClick={() => removeImage(index)}
                      className="absolute top-3 right-3 rounded-full bg-black/50 p-1.5 text-white opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100 hover:bg-red-500/80 hover:opacity-100"
                    >
                      <X className="h-4 w-4" />
                    </button>
                    <div className="absolute top-4 left-1/2 z-50 -translate-x-1/2">
                      <span className="text-[10px] font-medium text-white/80 drop-shadow-md 2xl:text-xs">
                        {angle}
                      </span>
                    </div>
                  </div>
                ) : (
                  <>
                    <div
                      className={`relative aspect-[1/2] ${index === 1 ? 'mt-0' : 'mt-10 2xl:mt-6'} w-full cursor-pointer overflow-hidden rounded-[2.5rem] border border-transparent bg-[#1c1c1c] shadow-2xl transition-all duration-300 group-hover/card:border-white group-hover/card:brightness-110 ${cardRotation[index]}`}
                    >
                      {/* Angle-specific placeholder image */}
                      <img
                        src={FACE_ANGLE_IMAGES[index]}
                        alt={`${angle} angle placeholder`}
                        className="absolute inset-0 h-full w-full object-cover"
                      />
                      <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-[#0f0f0f]/90 via-[#0f0f0f]/40 to-transparent" />
                      <div className="absolute inset-x-0 top-0 h-1/3 bg-gradient-to-b from-[#0f0f0f]/80 via-[#0f0f0f]/10 to-transparent" />

                      {/* Text */}
                      <div className="absolute top-8 left-1/2 w-[85%] -translate-x-1/2 text-center text-[10px] leading-[1.3] font-medium whitespace-pre-line text-white 2xl:top-10 2xl:text-[13px]">
                        {FACE_ANGLE_TEXTS[index]}
                      </div>
                    </div>

                    {/* Upload button */}
                    <label
                      htmlFor={`avatar-upload-${index}`}
                      className="pointer-events-auto absolute bottom-12 left-1/2 z-50 flex w-max -translate-x-1/2 cursor-pointer items-center justify-center gap-1 rounded-full border border-white/60 bg-white/10 px-2 py-2.5 text-[10px] font-medium whitespace-nowrap text-white shadow-lg backdrop-blur-md transition-all hover:bg-white/30 sm:bottom-14 sm:gap-2 sm:px-6 sm:text-xs 2xl:bottom-20 2xl:px-8 2xl:py-3.5 2xl:text-[15px]"
                    >
                      <CloudUpload className="h-3 w-3 sm:h-4 sm:w-4 2xl:h-5 2xl:w-5" />
                      Upload image
                    </label>
                    <input
                      id={`avatar-upload-${index}`}
                      type="file"
                      className="hidden"
                      accept="image/*"
                      onChange={(e) => handleFileChange(index, e)}
                    />
                  </>
                )}
              </div>
            );
          })}
        </div>

        {allUploaded && (
          <button
            onClick={() => onUploadComplete(images)}
            className="absolute -right-3 bottom-3 z-20 rounded-full p-2 text-gray-900 transition hover:bg-black/5 2xl:-right-1 dark:text-white dark:hover:bg-white/20"
          >
            <ChevronRight className="h-8 w-8 2xl:h-9 2xl:w-9" />
          </button>
        )}
      </div>

      {/* Global Bottom Overlay */}
      <div className="pointer-events-none absolute bottom-0 left-0 z-40 h-10 w-full bg-gradient-to-t from-white/80 via-white/30 to-transparent 2xl:h-14 dark:from-[#1c1c1c]/80 dark:via-[#1c1c1c]/30" />
    </div>
  );
};
const AvatarAdsPage = ({ handleGenerate, onClose }) => {
  const { avatars, avatarsLoading, imageAndScript, recreateInputs, currentAvatarStep } =
    useSelector((state) => state.adVideoNew);
  const dispatch = useDispatch();
  // const [avatarStep, setAvatarStep] = useState(
  //   recreateInputs?.type === 'avatar' ? 'config' : 'options'
  // );
  const [selectedAvatar, setSelectedAvatar] = useState(null);
  const [customAvatarImages, setCustomAvatarImages] = useState([]);
  const [generatedId, setGeneratedId] = useState(
    () => new URLSearchParams(window.location.search).get('id') || null
  );
  const [localRecreateData, setLocalRecreateData] = useState(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const [showDiscardDialog, setShowDiscardDialog] = useState(false);
  const [avatarSource, setAvatarSource] = useState(null); // 'face-capture' or 'upload-images'

  // Use a helper function for setting avatarStep
  const setAvatarStepLocal = useCallback(
    (step) => {
      dispatch(setAvatarStep(step));
    },
    [dispatch]
  );

  useEffect(() => {
    if (recreateInputs && recreateInputs.type === 'avatar') {
      const inputs = recreateInputs;

      if (inputs.uploadedAvatars && inputs.uploadedAvatars.length > 0) {
        setCustomAvatarImages(
          inputs.uploadedAvatars.map((url) => ({
            file: null,
            preview: url.startsWith('http') ? url : (import.meta.env.VITE_S3_BASE_URL || '') + url,
          }))
        );
        setSelectedAvatar(null);
      } else if (inputs.avatarId) {
        // If it's a library avatar, we need the full object for the image path
        const findAndSetAvatar = (list) => {
          const found = list?.find((a) => (a._id || a.id) === inputs.avatarId);
          if (found) {
            setSelectedAvatar(found);
          } else {
            // Fallback if not found in list, at least show something if possible
            setSelectedAvatar({ _id: inputs.avatarId, s3_image_path: inputs.avatarId });
          }
        };

        if (!avatars || avatars.length === 0) {
          dispatch(getAllAvatars()).then((res) => {
            findAndSetAvatar(res);
          });
        } else {
          findAndSetAvatar(avatars);
        }
        setCustomAvatarImages([]);
      }

      setLocalRecreateData(inputs);
      setAvatarStepLocal('config');
      // Clear recreateInputs from Redux after consuming to avoid repeated jumps on navigation
      dispatch(setRecreateInputs(null));
    }
  }, [recreateInputs, avatars, dispatch, setAvatarStepLocal]);

  useEffect(() => {
    const idFromUrl = searchParams.get('id');
    if (idFromUrl) {
      setGeneratedId(idFromUrl);
      setAvatarStepLocal('script');

      const fetchVideo = async () => {
        try {
          const videoData = await dispatch(getVideoById(idFromUrl));
          if (videoData) {
            // Refill the Redux state with video data
            dispatch(setImageAndScript(videoData));

            // If we have avatars, we could try to refill selectedAvatar
            // But usually the library step is skipped for deep links
          }
        } catch (error) {
          console.error('Error fetching deep-linked video:', error);
        }
      };
      fetchVideo();
    }
  }, [searchParams, dispatch]);
  // console.log(currentAvatarStep);
  useEffect(() => {
    if (currentAvatarStep === 'script' && generatedId) {
      setSearchParams({ id: generatedId }, { replace: true });
    } else if (!generatedId) {
      setSearchParams({}, { replace: true });
    }
  }, [currentAvatarStep, generatedId, setSearchParams]);

  // Reset state when entering the Avatar Ads section
  useEffect(() => {
    const idFromUrl = new URLSearchParams(window.location.search).get('id');
    if (idFromUrl || currentAvatarStep === 'script') return; // Don't reset if deep-linking or resuming
    if (recreateInputs?.type === 'avatar') return; // Don't reset if recreating from an existing video

    dispatch(setImageAndScript(null));
    dispatch(setAvatarStep('options'));
    if (!recreateInputs) {
      dispatch(setFields({ brand_name: '', brandInfo: {}, selectedBrand: {} }));
    }
    setGeneratedId(null);
  }, [dispatch]);

  const hasAnyError = useMemo(() => {
    const data = imageAndScript?.data || imageAndScript;
    return data?.generatedImage === 'failed' || data?.generatedScript === 'failed';
  }, [imageAndScript]);

  useEffect(() => {
    const handleRequestDiscard = () => {
      if (currentAvatarStep === 'script') {
        if (hasAnyError) {
          handleConfirmDiscard();
        } else {
          setShowDiscardDialog(true);
        }
      }
    };
    emitter.on('avatar:request-discard', handleRequestDiscard);
    return () => emitter.off('avatar:request-discard', handleRequestDiscard);
  }, [currentAvatarStep]);

  const handleConfirmDiscard = () => {
    dispatch(setImageAndScript(null));
    dispatch(setFields({ brand_name: '', brandInfo: {}, selectedBrand: {} }));
    setGeneratedId(null);
    setSelectedAvatar(null);
    setCustomAvatarImages([]);
    setLocalRecreateData(null);
    setAvatarSource(null);
    setSearchParams({}, { replace: true });
    setShowDiscardDialog(false);
    setAvatarStepLocal('options');
  };

  return (
    <div className="flex h-full max-h-svh flex-col gap-6 overflow-hidden lg:max-h-[90vh] 2xl:max-h-[calc(95svh-40px)]">
      {currentAvatarStep === 'options' && (
        <div className="relative flex h-full max-h-[80vh] min-h-[400px] flex-col gap-6 p-6">
          <div>
            <div className="flex items-start justify-between">
              <h2 className="text-base font-semibold text-gray-900 2xl:text-xl dark:text-white">
                Create your AI Avatar video
              </h2>
              <button
                onClick={onClose}
                className="rounded-full p-2 text-gray-500 transition hover:bg-black/5 hover:text-black dark:text-white/50 dark:hover:bg-white/10 dark:hover:text-white"
              >
                <X className="h-6 w-6 2xl:h-8 2xl:w-8" />
              </button>
            </div>

            <p className="-mt-4 text-[10px] font-light text-gray-500 2xl:text-sm dark:text-white/70">
              Choose your preferred method for making your avatar video
            </p>
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-2 gap-3">
            {/* Avatar Library */}
            <button
              onClick={() => {
                // The advanced filter rail owns its own paginated load, so no
                // full pre-fetch is needed here.
                setAvatarStepLocal('library');
              }}
              className="group relative h-full overflow-hidden rounded-3xl border-2 border-black/10 bg-white transition hover:border-blue-500 dark:border-[#3a3a3a] dark:bg-[#1c1c1c]"
            >
              <img src={avatarLibraryImg} className="h-full w-full object-cover" />

              {/* overlay */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />

              <div className="absolute bottom-5 left-1/2 -translate-x-1/2 transform font-semibold whitespace-nowrap text-white 2xl:bottom-8 2xl:text-xl">
                Choose from Avatar Library
              </div>
            </button>

            {/* Upload */}
            <button
              onClick={() => setAvatarStepLocal('upload')}
              className="relative flex h-full flex-col items-center justify-center gap-4 overflow-hidden rounded-3xl border-2 border-black/10 bg-gray-50 hover:border-blue-500 dark:border-[#3a3a3a] dark:bg-[#303030]/50"
            >
              <img
                src={avatarUploadBgImg}
                className="absolute right-1/4 z-10 h-auto w-[290px] max-w-[70%] -translate-y-8 transform rounded-2xl object-cover"
              />
              <img
                src={avatarUploadImg}
                className="absolute left-1/3 z-20 h-auto w-[250px] max-w-[60%] rounded-2xl object-cover"
              />
              {/* overlay — light mode uses a soft zinc fade so the photo stays
                  visible, dark mode keeps the near-black fade for contrast. */}
              <div className="absolute inset-0 bg-gradient-to-t from-[#0f0f0f]/60 via-zinc-200/30 to-transparent dark:from-[#0f0f0f] dark:via-[#0f0f0f]/0" />

              <div className="absolute bottom-5 left-1/2 -translate-x-1/2 transform font-semibold whitespace-nowrap text-white 2xl:bottom-8 2xl:text-xl">
                Create your Own Avatar
              </div>
            </button>
          </div>
        </div>
      )}

      {currentAvatarStep === 'library' && (
        <AvatarLibraryFilters
          avatars={avatars}
          isLoadingAvatars={avatarsLoading}
          onBack={() => setAvatarStepLocal('options')}
          onSelect={(avatar) => {
            setSelectedAvatar(avatar);
            setAvatarStepLocal('config');
          }}
        />
      )}

      {currentAvatarStep === 'config' && (
        <AvatarConfigForm
          avatar={selectedAvatar}
          avatars={avatars}
          onAvatarChange={setSelectedAvatar}
          customAvatarImages={customAvatarImages}
          recreateData={localRecreateData}
          onBack={() => {
            if (customAvatarImages.length > 0) {
              setCustomAvatarImages([]);
              setAvatarStepLocal(avatarSource || 'upload');
            } else {
              setAvatarStepLocal('library');
            }
          }}
          onGenerate={(id) => {
            setGeneratedId(id);
            setAvatarStepLocal('script');
          }}
        />
      )}

      {currentAvatarStep === 'script' && (
        <AvatarScriptResult
          avatar={selectedAvatar}
          onBack={() => {
            if (hasAnyError) {
              handleConfirmDiscard();
            } else {
              setShowDiscardDialog(true);
            }
          }}
          generatedId={generatedId}
          handleGenerate={handleGenerate}
        />
      )}

      {currentAvatarStep === 'upload' && (
        <UploadAvatarContent
          onBack={() => setAvatarStepLocal('options')}
          onUseCamera={() => setAvatarStepLocal('face-capture')}
          onUploadImages={() => setAvatarStepLocal('upload-images')}
        />
      )}

      {currentAvatarStep === 'upload-images' && (
        <UploadImagesContent
          onBack={() => setAvatarStepLocal('upload')}
          onUseCamera={() => setAvatarStepLocal('face-capture')}
          onUploadComplete={(images) => {
            setCustomAvatarImages(images);
            setSelectedAvatar(null);
            setAvatarSource('upload-images');
            setAvatarStepLocal('config');
          }}
        />
      )}

      {currentAvatarStep === 'face-capture' && (
        <FaceCaptureGuide
          onBack={() => setAvatarStepLocal('upload')}
          onSubmit={(captures) => {
            // Convert {front, left, right} to array of {file, preview}
            const captureImages = ['front', 'left', 'right']
              .map((key) => (captures[key] ? { file: null, preview: captures[key] } : null))
              .filter(Boolean);
            setCustomAvatarImages(captureImages);
            setSelectedAvatar(null);
            setAvatarSource('face-capture');
            setAvatarStepLocal('config');
          }}
        />
      )}

      {showDiscardDialog && (
        <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-[320px] rounded-2xl border border-black/10 bg-white p-6 text-gray-900 shadow-xl dark:border-[#3a3a3a] dark:bg-[#1c1c1c] dark:text-white">
            <h3 className="mb-2 text-base font-semibold">Discard changes?</h3>
            <p className="mb-6 text-sm text-gray-500 dark:text-white/60">
              Your generated avatar image and script will be lost.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowDiscardDialog(false)}
                className="rounded-full border border-black/10 px-5 py-2 text-sm text-gray-600 hover:bg-black/5 dark:border-[#3a3a3a] dark:text-white/80 dark:hover:bg-white/10"
              >
                No
              </button>
              <button
                onClick={handleConfirmDiscard}
                className="rounded-full bg-gray-900 px-5 py-2 text-sm font-semibold text-white hover:opacity-90 dark:bg-white dark:text-black"
              >
                Yes, Discard
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AvatarAdsPage;
