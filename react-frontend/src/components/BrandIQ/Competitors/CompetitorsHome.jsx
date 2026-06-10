import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { useWindowSize } from '@react-hook/window-size';
import Masonry from 'react-masonry-css';
import { Loader, RefreshCcw, AlertCircle, Filter, ChevronDown, Calendar, X, ArrowLeft } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { getCompetitorAds, refreshCompetitorAds } from '@/apis/brandIQ/competitorAdsApi';
import CompetitorAdCard from './CompetitorAdCard';
import CompetitorAdCardLoader from './CompetitorAdCardLoader';
import CategoryFilter from './CategoryFilter';
import { getAllCategories } from './categoryHelpers';
import { toast } from 'react-hot-toast';

const allCategories = getAllCategories();
import { setActiveBrandIQTab } from '@/store/reducers/brandIQ/brandIQTabsSlice';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const PAGE_SIZE = 10;

const sortOptions = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
];

const datePresets = [
  { key: 'last7', label: 'Last 7 days' },
  { key: 'last30', label: 'Last 30 days' },
  { key: 'last90', label: 'Last 90 days' },
  { key: 'all', label: 'All time' },
];

const platformPills = [
  { key: 'all', label: 'All', platforms: [] },
  { key: 'facebook', label: 'Facebook', platforms: ['facebook'] },
  { key: 'instagram', label: 'Instagram', platforms: ['instagram'] },
  { key: 'google', label: 'Google', platforms: ['google'] },
  { key: 'youtube', label: 'YouTube', platforms: ['youtube'] },
];

// AdsGPT brand gradient classes
const ADSGPT_GRADIENT = 'bg-gradient-to-r from-[#02C8C4] to-[#5867EB]';
const ADSGPT_GRADIENT_HOVER = 'hover:from-[#02B8B4] hover:to-[#4A57D8]';
const ADSGPT_TEXT = 'text-[#02C8C4]';
const ADSGPT_BORDER = 'border-[#02C8C4]/50';
const ADSGPT_BG_SOFT = 'bg-[#02C8C4]/10';

// Helper: format YYYY-MM-DD for display label (e.g. "May 5")
const fmtDisplay = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

// Helper: YYYY-MM-DD → DD/MM/YYYY for input display
const toDisplayDate = (iso) => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

// Helper: DD/MM/YYYY → YYYY-MM-DD for internal state
const toISODate = (display) => {
  const [d, m, y] = display.split('/');
  if (!d || !m || !y) return '';
  return `${y}-${m}-${d}`;
};

// Helper: validate DD/MM/YYYY
const isValidDisplayDate = (str) => {
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(str)) return false;
  const [d, m, y] = str.split('/').map(Number);
  const date = new Date(y, m - 1, d);
  return date.getDate() === d && date.getMonth() === m - 1 && date.getFullYear() === y;
};

// Helper: check if date is not in future (returns true if valid and <= today)
const isNotFutureDate = (displayStr) => {
  if (!isValidDisplayDate(displayStr)) return false;
  const [d, m, y] = displayStr.split('/').map(Number);
  const inputDate = new Date(y, m - 1, d, 23, 59, 59);
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  return inputDate <= today;
};

// Today's date as DD/MM/YYYY
const getTodayDisplay = () => {
  const now = new Date();
  const d = String(now.getDate()).padStart(2, '0');
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const y = now.getFullYear();
  return `${d}/${m}/${y}`;
};

const CompetitorsHome = () => {
  const dispatch = useDispatch();
  const [width] = useWindowSize();
  const userData = useSelector((state) => state.socket.userData);
  const selectedBrand = useSelector((state) => state.brandIQTabs.selectedCompetitorBrand);

  const [ads, setAds] = useState([]);
  const [status, setStatus] = useState(null); // null | PENDING | READY | EMPTY | FAILED
  const [totalCount, setTotalCount] = useState(0);
  const [filtersAvailable, setFiltersAvailable] = useState({ platforms: [], categories: [] });

  // Filters
  const [activePlatform, setActivePlatform] = useState('all');
  const [activeCategoryId, setActiveCategoryId] = useState('');
  const [activeSubCategoryId, setActiveSubCategoryId] = useState('');
  const [activeSort, setActiveSort] = useState('newest');

  // Date range picker states — initialize synchronously to prevent race condition
  const getInitialDateRange = useCallback(() => {
    // Default: All time (no date constraints)
    return {
      dateFrom: '',
      dateTo: '',
      datePreset: 'all',
    };
  }, []);

  const initialDates = useMemo(() => getInitialDateRange(), [getInitialDateRange]);

  const [dateFrom, setDateFrom] = useState(initialDates.dateFrom);
  const [dateTo, setDateTo] = useState(initialDates.dateTo);
  const [datePreset, setDatePreset] = useState(initialDates.datePreset);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const datePickerRef = useRef(null);

  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [selectedAd, setSelectedAd] = useState(null);

  const pollIntervalRef = useRef(null);
  const pollCountRef = useRef(0);
  const MAX_POLL_COUNT = 24; // 2 minutes @ 5s intervals

  // Infinite scroll refs
  const gridContainerRef = useRef(null);
  const loadingMoreRef = useRef(loadingMore);
  const hasMoreRef = useRef(hasMore);
  const loadingRef = useRef(loading);
  const adsLengthRef = useRef(ads.length);

  // Date input refs for programmatic picker open
  const fromDateRef = useRef(null);
  const toDateRef = useRef(null);

  // Request deduplication: ignore stale responses
  const latestRequestRef = useRef(0);

  // Apply preset and set date inputs
  const applyDatePreset = useCallback((preset) => {
    const now = new Date();
    if (preset === 'all') {
      setDateFrom('');
      setDateTo('');
      setDatePreset('all');
      return;
    }
    let days = 30;
    if (preset === 'last7') days = 7;
    if (preset === 'last90') days = 90;
    const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    setDateFrom(from.toISOString().split('T')[0]);
    setDateTo(now.toISOString().split('T')[0]);
    setDatePreset(preset);
  }, []);

  // Close date picker on click outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (datePickerRef.current && !datePickerRef.current.contains(e.target)) {
        setShowDatePicker(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Fetch ads function — kept as ref to avoid effect re-runs on recreation
  const fetchAdsRef = useRef();
  const fetchAds = useCallback(async (isPolling = false, isAppend = false, overridePage = null) => {
    if (!selectedBrand?.id || !userData?.user_id) return;

    if (isAppend) {
      setLoadingMore(true);
    } else if (!isPolling) {
      setLoading(true);
    }

    // Increment request ID for deduplication
    const requestId = ++latestRequestRef.current;

    try {
      const selectedPill = platformPills.find((p) => p.key === activePlatform);
      const platformFilter = activePlatform === 'all' ? '' : selectedPill?.platforms;

      const targetPage = overridePage !== null ? overridePage : (isAppend ? page + 1 : page);

      const params = {
        userId: userData.user_id,
        page: targetPage,
        pageSize: PAGE_SIZE,
        sort: activeSort,
        ...(platformFilter && platformFilter.length > 0 && { platform: platformFilter.join(',') }),
        ...(activeCategoryId && { categoryId: activeCategoryId }),
        ...(activeSubCategoryId && { subCategoryId: activeSubCategoryId }),
        ...(dateFrom && { dateFrom: new Date(dateFrom).toISOString(), dateTo: dateTo ? new Date(dateTo + 'T23:59:59').toISOString() : new Date().toISOString() }),
      };

      const data = await getCompetitorAds(selectedBrand.id, params);

      // Ignore stale responses — a newer request was made
      if (requestId !== latestRequestRef.current) return;

      setStatus(data.status);
      setAds((prev) => {
        const newAds = isAppend ? [...prev, ...(data.ads || [])] : [...(data.ads || [])];
        setHasMore(newAds.length < (data.totalCount || 0));
        return newAds;
      });
      if (isAppend || overridePage !== null) {
        setPage(targetPage);
      }
      setTotalCount(data.totalCount || 0);
      setFiltersAvailable(data.filtersAvailable || { platforms: [], categories: [] });
    } catch {
      // console.error('fetchAds error');
      // Ignore stale responses for errors too
      if (requestId !== latestRequestRef.current) return;
      if (!isPolling) {
        setStatus('FAILED');
        toast.error('Failed to fetch competitor ads');
      }
    } finally {
      if (isAppend) {
        setLoadingMore(false);
      } else if (!isPolling) {
        setLoading(false);
      }
    }
  }, [selectedBrand, userData, activePlatform, activeCategoryId, activeSubCategoryId, activeSort, dateFrom, dateTo, page]);

  // Keep ref always pointing to latest fetchAds
  fetchAdsRef.current = fetchAds;

  // Effect 1: When selected brand changes → reset state and fetch immediately
  useEffect(() => {
    if (selectedBrand?.id) {
      setStatus(null);
      setPage(1);
      setAds([]);
      setTotalCount(0);
      setFiltersAvailable({ platforms: [], categories: [] });
      setHasMore(true);
      setLoading(true);
      fetchAdsRef.current(false, false, 1);
    }
  }, [selectedBrand?.id]);

  // Effect 2: When filters change on same brand → reset to page 1 + fetch
  useEffect(() => {
    if (selectedBrand?.id && status !== 'PENDING') {
      setPage(1);
      setAds([]);
      setTotalCount(0);
      setFiltersAvailable({ platforms: [], categories: [] });
      setHasMore(true);
      setLoading(true);
      fetchAdsRef.current(false, false, 1);
    }
  }, [activePlatform, activeCategoryId, activeSubCategoryId, activeSort, dateFrom, dateTo]);

  // Polling while PENDING
  useEffect(() => {
    if (status !== 'PENDING') {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      return;
    }

    pollCountRef.current = 0;
    pollIntervalRef.current = setInterval(() => {
      pollCountRef.current += 1;
      if (pollCountRef.current >= MAX_POLL_COUNT) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
        return;
      }
      fetchAdsRef.current(true);
    }, 5000);

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [status, fetchAds]);

  // Keep infinite-scroll refs in sync with state (avoid stale closures)
  useEffect(() => { loadingMoreRef.current = loadingMore; }, [loadingMore]);
  useEffect(() => { hasMoreRef.current = hasMore; }, [hasMore]);
  useEffect(() => { loadingRef.current = loading; }, [loading]);
  useEffect(() => { adsLengthRef.current = ads.length; }, [ads.length]);

  // Infinite scroll — React-managed sentinel + viewport observer (avoids DOM reconciliation issues)
  const observerRef = useRef(null);
  const sentinelRef = useCallback((node) => {
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (
          entries[0].isIntersecting &&
          !loadingMoreRef.current &&
          hasMoreRef.current &&
          !loadingRef.current &&
          adsLengthRef.current > 0
        ) {
          fetchAdsRef.current(false, true);
        }
      },
      {
        root: null,
        rootMargin: '400px 0px',
        threshold: 0,
      }
    );

    observer.observe(node);
    observerRef.current = observer;
  }, []);

  // Handle refresh
  const handleRefresh = async () => {
    if (!selectedBrand?.id || !userData?.user_id) return;
    setRefreshing(true);
    setStatus('PENDING');
    setAds([]);
    setTotalCount(0);
    setFiltersAvailable({ platforms: [], categories: [] });
    setHasMore(true);

    try {
      await refreshCompetitorAds(selectedBrand.id, userData.user_id);
      toast.success('Refreshing competitor ads...');
      setPage(1);
      // Polling will start automatically since status is now PENDING
    } catch {
      toast.error('Failed to refresh');
      setStatus('FAILED');
    } finally {
      setRefreshing(false);
    }
  };

  // Handle ad click (lightbox)
  const handleAdClick = (ad) => {
    setSelectedAd(ad);
    setLightboxOpen(true);
  };

  // Date picker label — DD/MM/YYYY format
  const dateLabel = useMemo(() => {
    const preset = datePresets.find((p) => p.key === datePreset);
    if (preset && datePreset !== 'custom') return preset.label;
    if (!dateFrom && !dateTo) return 'All time';
    if (dateFrom && dateTo) return `${toDisplayDate(dateFrom)} - ${toDisplayDate(dateTo)}`;
    return 'Custom';
  }, [dateFrom, dateTo, datePreset]);

  // Masonry breakpoints
  const columnCount = useMemo(() => {
    if (width < 500) return 1;
    if (width < 750) return 2;
    if (width < 1100) return 3;
    return 4;
  }, [width]);

  const masonryBreakpoints = {
    default: columnCount,
    1100: 4,
    750: 3,
    500: 2,
  };

  // ─── PENDING STATE (discovery running) ─────────────────────────────────
  if (status === 'PENDING' && ads.length === 0) {
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center">
        <div className="relative mb-6">
          <div className="h-12 w-12 animate-spin rounded-full p-[2px]" style={{ background: 'conic-gradient(from 0deg, #02C8C4, #5867EB, transparent 75%)' }}>
            <div className="h-full w-full rounded-full bg-[#0d0d0d]"></div>
          </div>
          <div className="absolute inset-0 h-12 w-12 animate-pulse rounded-full bg-gradient-to-r from-[#02C8C4]/10 to-[#5867EB]/10"></div>
        </div>
        <h3 className="mb-2 text-lg font-medium text-white">Analyzing competitors...</h3>
        <p className="max-w-md text-center text-sm text-white/50">
          We're discovering your competitors and fetching their ads from across platforms.
          This may take a minute.
        </p>
        {/* <div className="mt-6 flex items-center gap-2 text-xs text-white/30">
          <Loader className="h-3 w-3 animate-spin text-[#02C8C4]" />
          <span>Gemini AI + ElasticSearch working...</span>
        </div> */}
      </div>
    );
  }

  // ─── FAILED STATE ──────────────────────────────────────────────────────
  if (status === 'FAILED') {
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-500/10">
          <AlertCircle className="h-8 w-8 text-red-400" />
        </div>
        <h3 className="mb-2 text-lg font-medium text-white">Discovery failed</h3>
        <p className="mb-6 max-w-md text-center text-sm text-white/50">
          We couldn't fetch competitor ads for this brand. This might be due to a temporary issue.
        </p>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className={`flex items-center gap-2 rounded-full ${ADSGPT_GRADIENT} px-6 py-2.5 text-sm font-medium text-white transition-all ${ADSGPT_GRADIENT_HOVER} disabled:opacity-50`}
        >
          <RefreshCcw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          Try Again
        </button>
      </div>
    );
  }

  // ─── MAIN VIEW ─────────────────────────────────────────────────────────
  return (
    <div className="flex h-full flex-col">
      {/* Header Stats */}
      <div className="mb-4 flex items-center justify-between px-1">
        <div className="flex items-center gap-3">
          {/* <h2 className="text-xl font-semibold text-white">
            {totalCount} <span className="text-white/50">competitor ads</span>
          </h2>
          <span className="text-sm text-white/30">
            across {filtersAvailable.platforms.length} platforms
          </span> */}
          {status === 'PENDING' && (
            <span className={`flex items-center gap-1.5 rounded-full ${ADSGPT_BG_SOFT} px-3 py-1 text-xs ${ADSGPT_TEXT}`}>
              <Loader className="h-3 w-3 animate-spin" />
              Updating...
            </span>
          )}
        </div>
        {/* Refresh button — hidden for now; page switch already re-fetches from ES */}
        {/* <button
          onClick={handleRefresh}
          disabled={refreshing || status === 'PENDING'}
          className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/70 transition-all hover:bg-white/10 hover:text-white disabled:opacity-50"
        >
          <RefreshCcw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </button> */}
      </div>

      {/* Filters Bar */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        {/* Platform Pills */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-medium uppercase tracking-wide text-white/40">Platform</span>
          <div className="flex flex-wrap items-center gap-1.5">
            {platformPills.map((pill) => {
              const isActive = activePlatform === pill.key;
              return (
                <button
                  key={pill.key}
                  onClick={() => setActivePlatform(pill.key)}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium transition-all ${
                    isActive
                      ? `${ADSGPT_GRADIENT} text-white`
                      : 'border border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  {pill.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Category Filter */}
        <CategoryFilter
          categories={allCategories}
          activeCategoryId={activeCategoryId}
          activeSubCategoryId={activeSubCategoryId}
          onChange={({ categoryId, subCategoryId }) => {
            setActiveCategoryId(categoryId);
            setActiveSubCategoryId(subCategoryId);
          }}
        />

        {/* Date Range Picker */}
        <div className="relative flex items-center gap-2" ref={datePickerRef}>
          <span className="text-[10px] font-medium uppercase tracking-wide text-white/40">Date</span>
          <button
            onClick={() => setShowDatePicker(!showDatePicker)}
            className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/80 transition-all hover:bg-white/10"
          >
            <Calendar className="h-3.5 w-3.5 text-white/50" />
            <span>{dateLabel}</span>
            <ChevronDown className={`h-3 w-3 text-white/40 transition-transform ${showDatePicker ? 'rotate-180' : ''}`} />
          </button>

          {showDatePicker && (
            <motion.div
              initial={{ opacity: 0, y: -5 }}
              animate={{ opacity: 1, y: 0 }}
              className="absolute top-full left-0 z-30 mt-2 w-80 rounded-xl border border-white/10 bg-[#1a1a1a] p-4 shadow-2xl"
            >
              {/* Presets */}
              <div className="mb-3 grid grid-cols-2 gap-2">
                {datePresets.map((preset) => (
                  <button
                    key={preset.key}
                    onClick={() => {
                      applyDatePreset(preset.key);
                      setShowDatePicker(false);
                    }}
                    className={`rounded-lg px-3 py-2 text-xs font-medium transition-all ${
                      datePreset === preset.key
                        ? `${ADSGPT_GRADIENT} text-white`
                        : 'bg-white/5 text-white/70 hover:bg-white/10'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>

              {/* Divider */}
              <div className="mb-3 border-t border-white/10"></div>

              {/* Custom Date Inputs — Native picker with DD/MM/YYYY display */}
              <div className="mb-1 flex items-center gap-2">
                <div className="flex-1">
                  <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-white/40">From</label>
                  <div
                    className="relative cursor-pointer"
                    onClick={() => {
                      if (fromDateRef.current?.showPicker) {
                        fromDateRef.current.showPicker();
                      } else {
                        fromDateRef.current?.click();
                      }
                    }}
                  >
                    <input
                      ref={fromDateRef}
                      type="date"
                      className="sr-only"
                      max={getInitialDateRange().dateTo}
                      value={dateFrom}
                      onChange={(e) => {
                        setDateFrom(e.target.value);
                        setDatePreset('custom');
                      }}
                    />
                    <div className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white">
                      {toDisplayDate(dateFrom) || 'DD/MM/YYYY'}
                    </div>
                  </div>
                </div>
                <span className="mt-5 text-white/30">-</span>
                <div className="flex-1">
                  <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-white/40">To</label>
                  <div
                    className="relative cursor-pointer"
                    onClick={() => {
                      if (toDateRef.current?.showPicker) {
                        toDateRef.current.showPicker();
                      } else {
                        toDateRef.current?.click();
                      }
                    }}
                  >
                    <input
                      ref={toDateRef}
                      type="date"
                      className="sr-only"
                      max={getInitialDateRange().dateTo}
                      value={dateTo}
                      onChange={(e) => {
                        setDateTo(e.target.value);
                        setDatePreset('custom');
                      }}
                    />
                    <div className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white">
                      {toDisplayDate(dateTo) || 'DD/MM/YYYY'}
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </div>

        {/* Sort */}
        <div className="ml-auto">
          <Select value={activeSort} onValueChange={(val) => setActiveSort(val)}>
            <SelectTrigger className="h-8 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs text-white/80 transition-all hover:bg-white/10 focus:ring-0 focus:ring-offset-0 [&>svg]:text-white/40">
              <SelectValue placeholder="Sort">
                Sort: {sortOptions.find((o) => o.value === activeSort)?.label || 'Newest'}
              </SelectValue>
            </SelectTrigger>
            <SelectContent className="rounded-xl border-white/10 bg-[#1a1a1a] text-white">
              {sortOptions.map((opt) => (
                <SelectItem
                  key={opt.value}
                  value={opt.value}
                  className="text-xs text-white/70 outline-none hover:bg-white/10 hover:text-white data-[state=checked]:bg-gradient-to-r data-[state=checked]:from-[#02C8C4] data-[state=checked]:to-[#5867EB] data-[state=checked]:text-white"
                >
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Ads Grid */}
      <div ref={gridContainerRef} className="flex-1 overflow-y-auto pb-20">
        {(loading || status === null) && ads.length === 0 ? (
          <Masonry
            breakpointCols={masonryBreakpoints}
            className="my-masonry-grid outline-none"
            columnClassName="my-masonry-grid_column"
          >
            {Array.from({ length: PAGE_SIZE }).map((_, index) => (
              <div key={index} className="mb-4">
                <CompetitorAdCardLoader />
              </div>
            ))}
          </Masonry>
        ) : (
          <>
            <Masonry
              breakpointCols={masonryBreakpoints}
              className="my-masonry-grid outline-none"
              columnClassName="my-masonry-grid_column"
            >
              {ads.map((ad, index) => (
                <div key={ad.adId || index} className="mb-4">
                  <CompetitorAdCard
                    ad={ad}
                    onClick={() => handleAdClick(ad)}
                  />
                </div>
              ))}
            </Masonry>

            {/* Infinite scroll loader */}
            {loadingMore && (
              <div className="flex items-center justify-center py-6">
                <Loader className="h-8 w-8 animate-spin text-[#5867EB]" />
              </div>
            )}

            {/* Empty state */}
            {(status === 'EMPTY' || (status === 'READY' && ads.length === 0 && !loading)) && (
              <div className="flex h-[50vh] flex-col items-center justify-center">
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-white/5">
                  <Filter className="h-8 w-8 text-white/30" />
                </div>
                <h3 className="mb-2 text-lg font-medium text-white">No competitor ads found</h3>
                <p className="mb-6 max-w-md text-center text-sm text-white/50">
                  We couldn't find any ads matching your brand's competitors. Try refreshing or adjusting your filters.
                </p>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => dispatch(setActiveBrandIQTab('myBrands'))}
                    className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-6 py-2.5 text-sm font-medium text-white/80 transition-all hover:bg-white/10 hover:text-white"
                  >
                    <ArrowLeft className="h-4 w-4" />
                    Back to My Brands
                  </button>
                  <button
                    onClick={handleRefresh}
                    disabled={refreshing}
                    className={`flex items-center gap-2 rounded-full ${ADSGPT_GRADIENT} px-6 py-2.5 text-sm font-medium text-white transition-all ${ADSGPT_GRADIENT_HOVER} disabled:opacity-50`}
                  >
                    <RefreshCcw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
                    Refresh Discovery
                  </button>
                </div>
              </div>
            )}

            {/* End of results message */}
            {!hasMore && ads.length > 0 && (
              <div className="py-6 text-center text-sm text-white/30">
                You've reached the end
              </div>
            )}

            {/* Infinite scroll sentinel */}
            <div ref={sentinelRef} className="h-2.5 shrink-0" />
          </>
        )}
      </div>

      {/* Lightbox */}
      <AnimatePresence>
        {lightboxOpen && selectedAd && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm"
            onClick={() => setLightboxOpen(false)}
          >
            <motion.div
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.9 }}
              className="relative max-h-[90vh] max-w-[90vw] overflow-hidden rounded-xl"
              onClick={(e) => e.stopPropagation()}
            >
              {selectedAd.adType === 'VIDEO' && selectedAd.videoUrl ? (
                <video
                  src={selectedAd.videoUrl}
                  poster={selectedAd.thumbnailUrl}
                  controls
                  autoPlay
                  className="max-h-[80vh] max-w-full object-contain"
                />
              ) : (
                <img
                  src={selectedAd.thumbnailUrl || selectedAd.creativeUrl || ''}
                  alt={selectedAd.adTitle || 'Ad'}
                  className="max-h-[80vh] max-w-full object-contain"
                />
              )}
              {/* Bottom text overlay removed — clean image view */}
              <button
                onClick={() => setLightboxOpen(false)}
                className="absolute top-4 right-4 flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm"
              >
                <X className="h-4 w-4" />
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default CompetitorsHome;
