import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  ListFilter,
  SlidersHorizontal,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  Calendar,
  ArrowUpDown,
  Check,
  Search,
  ArrowLeft,
  Minus,
  X,
} from 'lucide-react';
import { LuLayoutGrid } from 'react-icons/lu';
import {
  FaFacebook,
  FaInstagram,
  FaPinterest,
  FaReddit,
  FaYoutube,
} from 'react-icons/fa';
import { AiFillLinkedin } from 'react-icons/ai';
import { SiGoogleads } from 'react-icons/si';
import { DateRange } from 'react-date-range';
import 'react-date-range/dist/styles.css';
import 'react-date-range/dist/theme/default.css';
import {
  setAdLibraryFilters,
  resetAdLibraryFilters,
} from '@/store/reducers/brandIQ/brandIQTabsSlice';
import { getAllCategories } from '@/components/BrandIQ/Competitors/categoryHelpers';

const PLATFORMS_CONFIG = [
  {
    id: 'facebook',
    name: 'Facebook',
    icon: <FaFacebook className="h-3.5 w-3.5 text-[#1877F2]" />,
  },
  {
    id: 'instagram',
    name: 'Instagram',
    icon: <FaInstagram className="h-3.5 w-3.5 text-[#E4405F]" />,
  },
  {
    id: 'youtube',
    name: 'YouTube',
    icon: <FaYoutube className="h-3.5 w-3.5 text-[#FF0000]" />,
  },
  {
    id: 'linkedin',
    name: 'LinkedIn',
    icon: <AiFillLinkedin className="h-3.5 w-3.5 text-[#0A66C2]" />,
  },
  {
    id: 'gdn',
    name: 'GDN',
    icon: <SiGoogleads className="h-3.5 w-3.5 text-[#4285F4]" />,
  },
  {
    id: 'pinterest',
    name: 'Pinterest',
    icon: <FaPinterest className="h-3.5 w-3.5 text-[#E60023]" />,
  },
  {
    id: 'reddit',
    name: 'Reddit',
    icon: <FaReddit className="h-3.5 w-3.5 text-[#FF4500]" />,
  },
];

const ALL_PLATFORM_IDS = PLATFORMS_CONFIG.map((platform) => platform.id);

const DATE_OPTIONS = [
  { key: 'last7', label: 'Last 7 days' },
  { key: 'last30', label: 'Last 30 days' },
  { key: 'last90', label: 'Last 90 days' },
  { key: 'all', label: 'All time' },
];

const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
];

const parseLocalDate = (value) => {
  if (!value) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? null : date;
};

const formatLocalDate = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const formatDisplayDate = (value) => {
  if (!value) return '';
  const [year, month, day] = value.split('-');
  return `${day}/${month}/${year}`;
};

export default function AdLibraryFilterDropdown({ iconOnly = false }) {
  const dispatch = useDispatch();
  const filters = useSelector((state) => state.brandIQTabs.adLibraryFilters);

  const [isOpen, setIsOpen] = useState(false);
  const [platformSectionOpen, setPlatformSectionOpen] = useState(true);
  const [currentView, setCurrentView] = useState('main'); // 'main' | 'categories'

  // Draft states initialized from Redux
  const [draftPlatforms, setDraftPlatforms] = useState(
    filters?.platforms || ALL_PLATFORM_IDS
  );
  const [draftCategoryIds, setDraftCategoryIds] = useState(
    filters?.categoryIds || []
  );
  const [draftSubCategoryIds, setDraftSubCategoryIds] = useState(
    filters?.subCategoryIds || []
  );
  const [draftDatePreset, setDraftDatePreset] = useState(
    filters?.datePreset || 'all'
  );
  const [draftDateFrom, setDraftDateFrom] = useState(filters?.dateFrom || '');
  const [draftDateTo, setDraftDateTo] = useState(filters?.dateTo || '');
  const [draftSort, setDraftSort] = useState(filters?.sort || 'newest');

  // Sub-menus inside dropdown
  const [showDateMenu, setShowDateMenu] = useState(false);
  const [catSearch, setCatSearch] = useState('');
  const [calendarPreset, setCalendarPreset] = useState('all');
  const [calendarFrom, setCalendarFrom] = useState('');
  const [calendarTo, setCalendarTo] = useState('');

  // Sync draft states whenever popover opens
  useEffect(() => {
    if (isOpen && filters) {
      setDraftPlatforms(
        Array.isArray(filters.platforms) ? filters.platforms : []
      );
      setDraftCategoryIds(filters.categoryIds || []);
      setDraftSubCategoryIds(filters.subCategoryIds || []);
      setDraftDatePreset(filters.datePreset || 'all');
      setDraftDateFrom(filters.dateFrom || '');
      setDraftDateTo(filters.dateTo || '');
      setDraftSort(filters.sort || 'newest');
      setShowDateMenu(false);
      setCurrentView('main');
    }
  }, [isOpen, filters]);

  const allCategories = useMemo(() => getAllCategories(), []);

  // Filter categories by search
  const filteredCategories = useMemo(() => {
    if (!catSearch.trim()) return allCategories;
    const q = catSearch.toLowerCase();
    return allCategories.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.subcategories?.some((s) => s.name.toLowerCase().includes(q))
    );
  }, [allCategories, catSearch]);

  const allPlatformsSelected =
    draftPlatforms.length === ALL_PLATFORM_IDS.length &&
    ALL_PLATFORM_IDS.every((id) => draftPlatforms.includes(id));
  const somePlatformsSelected = draftPlatforms.length > 0 && !allPlatformsSelected;

  const handleToggleAllPlatforms = () => {
    setDraftPlatforms(allPlatformsSelected ? [] : [...ALL_PLATFORM_IDS]);
  };

  const handleTogglePlatform = (id) => {
    setDraftPlatforms((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    );
  };

  const handleToggleCategory = (category) => {
    const subcategoryIds = (category.subcategories || []).map(({ id }) => id);
    const isSelected = draftCategoryIds.includes(category.id);

    setDraftCategoryIds((previous) =>
      isSelected
        ? previous.filter((id) => id !== category.id)
        : [...new Set([...previous, category.id])]
    );
    setDraftSubCategoryIds((previous) =>
      isSelected
        ? previous.filter((id) => !subcategoryIds.includes(id))
        : [...new Set([...previous, ...subcategoryIds])]
    );
  };

  const handleToggleSubcategory = (category, subcategoryId) => {
    const nextSubcategoryIds = draftSubCategoryIds.includes(subcategoryId)
      ? draftSubCategoryIds.filter((id) => id !== subcategoryId)
      : [...draftSubCategoryIds, subcategoryId];
    const categorySubcategoryIds = (category.subcategories || []).map(({ id }) => id);
    const everySubcategorySelected =
      categorySubcategoryIds.length > 0 &&
      categorySubcategoryIds.every((id) => nextSubcategoryIds.includes(id));

    setDraftSubCategoryIds(nextSubcategoryIds);
    setDraftCategoryIds((previous) =>
      everySubcategorySelected
        ? [...new Set([...previous, category.id])]
        : previous.filter((id) => id !== category.id)
    );
  };

  const handleSelectDatePreset = (key) => {
    setCalendarPreset(key);
    const now = new Date();
    if (key === 'all') {
      setCalendarFrom('');
      setCalendarTo('');
    } else {
      let days = 30;
      if (key === 'last7') days = 7;
      if (key === 'last90') days = 90;
      const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
      setCalendarFrom(formatLocalDate(from));
      setCalendarTo(formatLocalDate(now));
    }
  };

  const toggleDateMenu = () => {
    setShowDateMenu((previous) => {
      const next = !previous;
      if (next) {
        setCalendarPreset(draftDatePreset);
        setCalendarFrom(draftDateFrom);
        setCalendarTo(draftDateTo);
      }
      return next;
    });
  };

  const applyCalendarDraft = () => {
    setDraftDatePreset(calendarPreset);
    setDraftDateFrom(calendarPreset === 'all' ? '' : calendarFrom);
    setDraftDateTo(calendarPreset === 'all' ? '' : calendarTo);
    setShowDateMenu(false);
  };

  const handleClearAll = () => {
    setDraftPlatforms([]);
    setDraftCategoryIds([]);
    setDraftSubCategoryIds([]);
    setDraftDatePreset('all');
    setDraftDateFrom('');
    setDraftDateTo('');
    setCalendarPreset('all');
    setCalendarFrom('');
    setCalendarTo('');
    setDraftSort('newest');
    setShowDateMenu(false);
    dispatch(resetAdLibraryFilters());
  };

  const handleApply = () => {
    dispatch(
      setAdLibraryFilters({
        platforms: draftPlatforms,
        categoryIds: draftCategoryIds,
        subCategoryIds: draftSubCategoryIds,
        datePreset: draftDatePreset,
        dateFrom: draftDateFrom,
        dateTo: draftDateTo,
        sort: draftSort,
      })
    );
    setIsOpen(false);
  };

  // Categories label display
  const categoryDisplayLabel = useMemo(() => {
    const totalCount = draftCategoryIds.length + draftSubCategoryIds.length;
    if (totalCount === 0) return 'All Categories';
    if (totalCount === 1) {
      const found = allCategories.find((c) =>
        draftCategoryIds.includes(c.id)
      );
      if (found) return found.name;
      for (const c of allCategories) {
        const sub = c.subcategories?.find((s) =>
          draftSubCategoryIds.includes(s.id)
        );
        if (sub) return sub.name;
      }
    }
    return `${totalCount} Selected`;
  }, [draftCategoryIds, draftSubCategoryIds, allCategories]);

  const dateDisplayLabel = draftDatePreset === 'custom' && draftDateFrom && draftDateTo
    ? `${formatDisplayDate(draftDateFrom)} - ${formatDisplayDate(draftDateTo)}`
    : DATE_OPTIONS.find((o) => o.key === draftDatePreset)?.label || 'All time';

  const customDateRangeInvalid =
    draftDatePreset === 'custom' &&
    (!draftDateFrom || !draftDateTo || draftDateFrom > draftDateTo);

  const appliedFilterBadge = useMemo(() => {
    // When dropdown is open, track live draft selections; when closed, track applied filters
    const currentPlatforms = isOpen
      ? (Array.isArray(draftPlatforms) ? draftPlatforms : [])
      : (Array.isArray(filters?.platforms) ? filters.platforms : []);
    const currentCategoryIds = isOpen
      ? (draftCategoryIds || [])
      : (filters?.categoryIds || []);
    const currentSubCategoryIds = isOpen
      ? (draftSubCategoryIds || [])
      : (filters?.subCategoryIds || []);
    const currentDatePreset = isOpen
      ? (draftDatePreset || 'all')
      : (filters?.datePreset || 'all');
    const currentSort = isOpen
      ? (draftSort || 'newest')
      : (filters?.sort || 'newest');

    let otherCount = 0;
    const totalCategories = currentCategoryIds.length + currentSubCategoryIds.length;
    if (totalCategories > 0) otherCount += totalCategories;
    if (currentDatePreset && currentDatePreset !== 'all') otherCount += 1;
    if (currentSort && currentSort !== 'newest') otherCount += 1;

    const isAllPlatforms =
      currentPlatforms.length === ALL_PLATFORM_IDS.length &&
      ALL_PLATFORM_IDS.every((id) => currentPlatforms.includes(id));

    // When all platforms are selected, show 'All' (or total count if combined with other filters)
    if (isAllPlatforms) {
      if (otherCount === 0) {
        return { show: true, text: 'All' };
      }
      return { show: true, text: ALL_PLATFORM_IDS.length + otherCount };
    }

    const platformCount = currentPlatforms.length;
    const total = platformCount + otherCount;
    if (total > 0) {
      return { show: true, text: total };
    }

    return { show: false, text: '' };
  }, [
    isOpen,
    draftPlatforms,
    draftCategoryIds,
    draftSubCategoryIds,
    draftDatePreset,
    draftSort,
    filters,
  ]);

  const popoverContentRef = useRef(null);

  // Restrict scroll behavior when mouse/pointer is on top of filter cards
  useEffect(() => {
    const el = popoverContentRef.current;
    if (!el || !isOpen) return;

    const handleWheel = (e) => {
      let current = e.target;
      let scrollable = null;

      // Detect if target is inside an element that actually has scrollable content
      while (current) {
        if (current === el.parentElement) break;
        const style = window.getComputedStyle(current);
        const overflowY = style.overflowY;
        const overflowX = style.overflowX;
        const hasYScroll =
          (overflowY === 'auto' || overflowY === 'scroll') &&
          current.scrollHeight > current.clientHeight;
        const hasXScroll =
          (overflowX === 'auto' || overflowX === 'scroll') &&
          current.scrollWidth > current.clientWidth;

        if (hasYScroll || hasXScroll) {
          scrollable = current;
          break;
        }
        if (current === el) break;
        current = current.parentElement;
      }

      if (scrollable) {
        const { scrollTop, scrollHeight, clientHeight, scrollLeft, scrollWidth, clientWidth } =
          scrollable;
        const deltaY = e.deltaY;
        const deltaX = e.deltaX;

        const isScrollingDown = deltaY > 0;
        const isScrollingUp = deltaY < 0;
        const isScrollingRight = deltaX > 0;
        const isScrollingLeft = deltaX < 0;

        const atYBottom = Math.ceil(scrollTop + clientHeight) >= scrollHeight;
        const atYTop = scrollTop <= 0;
        const atXRight = Math.ceil(scrollLeft + clientWidth) >= scrollWidth;
        const atXLeft = scrollLeft <= 0;

        const canScrollY =
          (isScrollingDown && !atYBottom) || (isScrollingUp && !atYTop);
        const canScrollX =
          (isScrollingRight && !atXRight) || (isScrollingLeft && !atXLeft);

        // If at scroll boundary, prevent scroll chaining to the page behind it
        if (!canScrollY && !canScrollX) {
          e.preventDefault();
        }
        e.stopPropagation();
      } else {
        // Over any non-scrollable part of the filter card: prevent page scrolling completely
        e.preventDefault();
        e.stopPropagation();
      }
    };

    const handleTouchMove = (e) => {
      let current = e.target;
      let scrollable = null;

      while (current) {
        if (current === el.parentElement) break;
        const style = window.getComputedStyle(current);
        const overflowY = style.overflowY;
        if (
          (overflowY === 'auto' || overflowY === 'scroll') &&
          current.scrollHeight > current.clientHeight
        ) {
          scrollable = current;
          break;
        }
        if (current === el) break;
        current = current.parentElement;
      }

      if (!scrollable) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    el.addEventListener('touchmove', handleTouchMove, { passive: false });
    return () => {
      el.removeEventListener('wheel', handleWheel);
      el.removeEventListener('touchmove', handleTouchMove);
    };
  }, [isOpen, currentView, showDateMenu, platformSectionOpen]);

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Open Ad Library filters"
          className={
            iconOnly
              ? `relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-black/10 bg-transparent text-zinc-700 transition-all hover:bg-black/5 hover:text-zinc-950 dark:border-white/15 dark:bg-transparent dark:text-zinc-300 dark:hover:bg-white/10 dark:hover:text-white ${
                  isOpen ? 'border-black/30 bg-black/5 dark:border-white/30 dark:bg-white/10' : ''
                }`
              : `group flex h-8 items-center gap-1.5 rounded-full border border-black/10 bg-transparent pl-2 pr-1.5 py-1 text-xs font-medium text-zinc-800 shadow-xs transition-colors hover:bg-black/5 hover:text-zinc-950 2xl:h-9 2xl:pl-2.5 2xl:pr-2 2xl:text-sm dark:border-white/20 dark:bg-transparent dark:text-[#AFAFAF] dark:hover:border-white/40 dark:hover:text-white ${
                  isOpen ? 'border-[#5867EB]/60 bg-zinc-50 dark:border-[#5867EB]/60' : ''
                }`
          }
        >
          {iconOnly ? (
            <>
              <SlidersHorizontal className="h-4 w-4 stroke-[1.8]" />
              {appliedFilterBadge.show && (
                <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#5867EB] px-1 text-[8.5px] font-bold leading-none text-white shadow-2xs ring-1 ring-white dark:ring-[#18181b]">
                  {appliedFilterBadge.text}
                </span>
              )}
            </>
          ) : (
            <>
              <div className="relative flex shrink-0 items-center justify-center">
                <ListFilter className="h-3.5 w-3.5 text-zinc-700 transition-colors group-hover:text-zinc-950 dark:text-[#AFAFAF] dark:group-hover:text-white" />
                {appliedFilterBadge.show && (
                  <span className="absolute -top-1.5 -right-2 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-[#5867EB] px-1 text-[8.5px] font-bold leading-none text-white shadow-2xs ring-1 ring-white dark:ring-[#0D0D0D]">
                    {appliedFilterBadge.text}
                  </span>
                )}
              </div>

              <span>Filters</span>

              <ChevronDown
                className={`h-3.5 w-3.5 shrink-0 text-zinc-500 transition-all duration-200 stroke-[2.2] group-hover:text-zinc-800 dark:text-white/50 dark:group-hover:text-white ${
                  isOpen ? 'rotate-180 text-zinc-900 dark:text-white' : ''
                }`}
              />
            </>
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent
        ref={(node) => {
          popoverContentRef.current = node;
        }}
        align="end"
        sideOffset={8}
        className="ad-library-filter-card relative w-[324px] max-w-[calc(100vw-24px)] overscroll-contain overflow-visible rounded-2xl border border-[#E5E0D8] bg-white/95 p-4 text-[#24211D] shadow-[0_16px_44px_rgba(36,33,29,0.14)] backdrop-blur-xl dark:border-white/10 dark:bg-[#18181b]/98 dark:text-white dark:shadow-[0_16px_50px_rgba(0,0,0,0.6)]"
      >
        {currentView === 'categories' ? (
          /* Categories Sub-Panel */
          <div className="flex flex-col space-y-3">
            <div className="flex items-center justify-between border-b border-black/[0.06] pb-2.5 dark:border-white/[0.08]">
              <button
                type="button"
                onClick={() => setCurrentView('main')}
                className="flex items-center gap-1.5 text-xs font-semibold text-zinc-700 hover:text-black dark:text-white/80 dark:hover:text-white"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                <span>Categories</span>
              </button>
              {draftCategoryIds.length + draftSubCategoryIds.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setDraftCategoryIds([]);
                    setDraftSubCategoryIds([]);
                  }}
                  className="text-xs font-medium text-zinc-500 transition-colors hover:text-[#5867EB] dark:text-white/50 dark:hover:text-blue-300"
                >
                  Clear
                </button>
              )}
            </div>

            {/* Search */}
            <div className="relative flex items-center rounded-xl border border-black/10 bg-white/80 px-2.5 py-1.5 dark:border-white/10 dark:bg-black/30">
              <Search className="h-3.5 w-3.5 text-zinc-400" />
              <input
                type="text"
                value={catSearch}
                onChange={(e) => setCatSearch(e.target.value)}
                placeholder="Search categories..."
                className="ml-2 w-full border-none bg-transparent text-xs text-zinc-800 placeholder:text-zinc-400 focus:outline-none dark:text-white dark:placeholder:text-white/30"
              />
              {catSearch && (
                <X
                  onClick={() => setCatSearch('')}
                  className="h-3 w-3 cursor-pointer text-zinc-400 hover:text-black dark:hover:text-white"
                />
              )}
            </div>

            {/* Categories List */}
            <div className="max-h-60 overflow-y-auto overscroll-contain pr-1 space-y-1">
              {filteredCategories.map((category) => {
                const isChecked = draftCategoryIds.includes(category.id);
                return (
                  <div key={category.id} className="rounded-lg">
                    <button
                      type="button"
                      onClick={() => handleToggleCategory(category)}
                      className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-xs transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
                    >
                      <span className="font-medium text-zinc-800 dark:text-white/90">
                        {category.name}
                      </span>
                      <span
                        className={`flex h-4 w-4 items-center justify-center rounded transition-colors ${
                          isChecked
                            ? 'bg-[#5867EB] text-white'
                            : 'border border-gray-300 bg-transparent dark:border-white/20'
                        }`}
                      >
                        {isChecked && <Check className="h-3 w-3 stroke-[3]" />}
                      </span>
                    </button>
                    {category.subcategories?.map((subcategory) => {
                      const subcategoryChecked = draftSubCategoryIds.includes(subcategory.id);
                      return (
                        <button
                          key={subcategory.id}
                          type="button"
                          onClick={() => handleToggleSubcategory(category, subcategory.id)}
                          className="flex w-full items-center justify-between rounded-lg py-1.5 pr-2 pl-6 text-left text-[11px] transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
                        >
                          <span className="text-zinc-600 dark:text-white/65">
                            {subcategory.name}
                          </span>
                          <span
                            className={`flex h-3.5 w-3.5 items-center justify-center rounded transition-colors ${
                              subcategoryChecked
                                ? 'bg-[#5867EB] text-white'
                                : 'border border-gray-300 bg-transparent dark:border-white/20'
                            }`}
                          >
                            {subcategoryChecked && <Check className="h-2.5 w-2.5 stroke-[3]" />}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>

            {/* Back button */}
            <button
              type="button"
              onClick={() => setCurrentView('main')}
              className="mt-1 w-full rounded-xl bg-gradient-to-r from-[#02C8C4] to-[#5867EB] py-2 text-xs font-semibold text-white shadow-xs transition-opacity hover:opacity-90"
            >
              Done
            </button>
          </div>
        ) : (
          /* Main Filter Ads View */
          <div className="flex flex-col space-y-3.5">
            {/* Header: Title + Clear All */}
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold tracking-tight text-[#24211D] dark:text-white">
                Filter Ads
              </h3>
              <button
                type="button"
                onClick={handleClearAll}
                className="text-xs font-medium text-zinc-500 transition-colors hover:text-[#5867EB] dark:text-white/50 dark:hover:text-blue-300"
              >
                Clear All
              </button>
            </div>

            {/* Platform Section */}
            <div className="space-y-2">
              <div className="text-[11px] font-bold tracking-wide text-zinc-900 dark:text-white">
                Platform
              </div>

              {/* Grouped Platform Container */}
              <div className="rounded-xl border border-black/[0.07] bg-[#F7F7F5]/90 p-2 text-xs dark:border-white/5 dark:bg-white/[0.04]">
                {/* All Platforms Header */}
                <div className="flex items-center justify-between rounded-lg">
                  <button
                    type="button"
                    onClick={handleToggleAllPlatforms}
                    aria-pressed={allPlatformsSelected}
                    className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-white/80 dark:hover:bg-white/5"
                  >
                    <div
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded transition-colors ${
                        allPlatformsSelected || somePlatformsSelected
                          ? 'bg-[#5867EB] text-white'
                          : 'border border-zinc-300 bg-white/70 dark:border-white/30 dark:bg-transparent'
                      }`}
                    >
                      {allPlatformsSelected && <Check className="h-3 w-3 stroke-[3]" />}
                      {somePlatformsSelected && <Minus className="h-3 w-3 stroke-[3]" />}
                    </div>
                    <LuLayoutGrid className="h-3.5 w-3.5 text-[#5867EB]" />
                    <span className="font-semibold text-zinc-800 dark:text-white">
                      All Platforms
                    </span>
                  </button>

                  <button
                    type="button"
                    aria-label={platformSectionOpen ? 'Collapse platforms' : 'Expand platforms'}
                    onClick={() => setPlatformSectionOpen((prev) => !prev)}
                    className="mr-1 flex h-7 w-7 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-white hover:text-zinc-600 dark:hover:bg-white/5 dark:hover:text-white"
                  >
                    {platformSectionOpen ? (
                      <ChevronUp className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>

                {/* Sub-platforms List */}
                {platformSectionOpen && (
                  <div className="mt-1 space-y-0.5 pt-0.5">
                    {PLATFORMS_CONFIG.map((platform) => {
                      const isChecked = draftPlatforms.includes(platform.id);
                      return (
                        <button
                          type="button"
                          key={platform.id}
                          onClick={() => handleTogglePlatform(platform.id)}
                          aria-pressed={isChecked}
                          className={`flex w-full cursor-pointer items-center justify-between rounded-lg px-2 py-1.5 text-left transition-colors ${
                            isChecked
                              ? 'bg-white/85 shadow-[0_1px_2px_rgba(36,33,29,0.04)] dark:bg-white/[0.06]'
                              : 'hover:bg-white/70 dark:hover:bg-white/5'
                          }`}
                        >
                          <div className="flex items-center gap-2.5">
                            {platform.icon}
                            <span className="text-xs font-medium text-zinc-700 dark:text-white/85">
                              {platform.name}
                            </span>
                          </div>

                          {/* Checkbox */}
                          <div
                            className={`flex h-4 w-4 items-center justify-center rounded transition-colors ${
                              isChecked
                                ? 'bg-[#5867EB] text-white'
                                : 'border border-zinc-300 bg-transparent dark:border-white/20'
                            }`}
                          >
                            {isChecked && (
                              <Check className="h-3 w-3 stroke-[3]" />
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Categories Section */}
            <div
              onClick={() => {
                setShowDateMenu(false);
                setCurrentView('categories');
              }}
              className="flex cursor-pointer items-center justify-between border-t border-black/[0.07] pt-3 pb-1 transition-colors hover:opacity-80 dark:border-white/[0.08]"
            >
              <div className="flex items-center gap-2">
                <LuLayoutGrid className="h-4 w-4 text-zinc-700 dark:text-white/70" />
                <span className="text-xs font-semibold text-zinc-900 dark:text-white">
                  Categories
                </span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-xs text-zinc-500 dark:text-white/50">
                  {categoryDisplayLabel}
                </span>
                <ChevronRight className="h-3.5 w-3.5 text-zinc-400 dark:text-white/40" />
              </div>
            </div>

            {/* Date Range Section */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <Calendar className="h-4 w-4 text-zinc-700 dark:text-white/70" />
                  <span className="text-xs font-semibold text-zinc-900 dark:text-white">
                    Date Range
                  </span>
                </div>
                <div className="flex w-[174px] shrink-0 items-center gap-2 px-1">
                  <ArrowUpDown className="h-4 w-4 text-zinc-700 dark:text-white/70" />
                  <span className="text-xs font-semibold text-zinc-900 dark:text-white">
                    Sort By
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {/* Date selector + side calendar */}
                <div className="relative min-w-0 flex-1">
                  <button
                  type="button"
                  aria-expanded={showDateMenu}
                  onClick={toggleDateMenu}
                  className="flex w-full cursor-pointer items-center justify-between rounded-xl border border-black/10 bg-white/80 px-3 py-2 text-xs text-zinc-800 shadow-2xs transition-all hover:border-black/20 dark:border-white/10 dark:bg-black/20 dark:text-white/90 dark:hover:border-white/20"
                >
                  <div className="flex items-center gap-2">
                    <Calendar className="h-3.5 w-3.5 text-zinc-400 dark:text-white/40" />
                    <span>{dateDisplayLabel}</span>
                  </div>
                  <ChevronDown
                    className={`h-3.5 w-3.5 text-zinc-400 transition-transform ${
                      showDateMenu ? 'rotate-180' : ''
                    }`}
                  />
                  </button>

                  {showDateMenu && (
                  <div className="ad-library-date-card overscroll-contain absolute top-1/2 right-[calc(100%+28px)] z-50 w-[360px] max-w-[calc(100vw-2rem)] -translate-y-1/2 rounded-2xl border border-[#DDD7CD] bg-[#FCFBF8] p-3 shadow-[0_18px_50px_rgba(80,70,58,0.18)] max-lg:top-full max-lg:right-0 max-lg:mt-2 max-lg:translate-y-0 dark:border-white/10 dark:bg-[#1a1a1a] dark:shadow-[0_18px_55px_rgba(0,0,0,0.6)]">
                    <div className="mb-3 grid grid-cols-2 gap-2">
                      {DATE_OPTIONS.map((option) => (
                        <button
                          key={option.key}
                          type="button"
                          onClick={() => handleSelectDatePreset(option.key)}
                          className={`rounded-lg border px-3 py-2 text-xs font-medium transition-all ${
                            calendarPreset === option.key
                              ? 'border-[#5867EB] bg-[#5867EB] text-white'
                              : 'border-[#DDD7CD] bg-white/70 text-zinc-700 hover:bg-[#F1ECE4] dark:border-white/10 dark:bg-white/5 dark:text-white/75 dark:hover:bg-white/10'
                          }`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>

                    <div className="mb-3 border-t border-black/10 dark:border-white/10" />

                    <div className="adsgpt-cal-pop overflow-hidden rounded-xl">
                      <DateRange
                        editableDateInputs
                        onChange={({ selection }) => {
                          setCalendarFrom(formatLocalDate(selection.startDate));
                          setCalendarTo(formatLocalDate(selection.endDate));
                          setCalendarPreset('custom');
                        }}
                        moveRangeOnFirstSelection={false}
                        ranges={[
                          {
                            startDate: parseLocalDate(calendarFrom) || new Date(),
                            endDate:
                              parseLocalDate(calendarTo) ||
                              parseLocalDate(calendarFrom) ||
                              new Date(),
                            key: 'selection',
                          },
                        ]}
                        months={1}
                        direction="horizontal"
                        rangeColors={['#5867EB']}
                        color="#5867EB"
                        maxDate={new Date()}
                        showDateDisplay={false}
                        className="w-full bg-transparent text-zinc-900 [&_.rdrCalendarWrapper]:w-full [&_.rdrMonth]:w-full dark:text-white"
                      />
                    </div>

                    <div className="mt-2 flex items-center justify-between gap-3">
                      <span className="text-[11px] text-zinc-500 dark:text-white/45">
                        {calendarPreset === 'all'
                          ? 'All available dates'
                          : calendarFrom && calendarTo
                            ? `${formatDisplayDate(calendarFrom)} - ${formatDisplayDate(calendarTo)}`
                            : 'Select a start and end date'}
                      </span>
                      <button
                        type="button"
                        disabled={
                          calendarPreset !== 'all' &&
                          (!calendarFrom || !calendarTo || calendarFrom > calendarTo)
                        }
                        onClick={applyCalendarDraft}
                        className="shrink-0 rounded-lg bg-gradient-to-r from-[#02C8C4] to-[#5867EB] px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Apply
                      </button>
                    </div>
                  </div>
                  )}
                </div>
                <div
                  role="radiogroup"
                  aria-label="Sort competitor ads"
                  className="grid w-[174px] shrink-0 grid-cols-2 rounded-xl border border-black/10 bg-white/70 p-1 dark:border-white/10 dark:bg-black/20"
                >
                  {SORT_OPTIONS.map((option) => {
                    const isSelected = draftSort === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        role="radio"
                        aria-checked={isSelected}
                        onClick={() => {
                          setShowDateMenu(false);
                          setDraftSort(option.value);
                        }}
                        className={`flex items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-medium transition-colors ${
                          isSelected
                            ? 'bg-[#EEF0FF] text-[#5867EB] shadow-xs dark:bg-blue-500/15 dark:text-blue-300'
                            : 'text-zinc-500 hover:bg-black/[0.04] hover:text-zinc-800 dark:text-white/50 dark:hover:bg-white/5 dark:hover:text-white/80'
                        }`}
                      >
                        <span>{option.label}</span>
                        {isSelected && <Check className="h-3 w-3" aria-hidden="true" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Apply Filters Button */}
            <button
              type="button"
              onClick={handleApply}
              disabled={draftPlatforms.length === 0 || customDateRangeInvalid}
              className="mt-1 w-full cursor-pointer rounded-xl bg-gradient-to-r from-[#02C8C4] to-[#5867EB] py-2.5 text-center text-xs font-semibold text-white shadow-[0_6px_16px_rgba(88,103,235,0.22)] transition-opacity hover:opacity-90 active:opacity-80 disabled:cursor-not-allowed disabled:opacity-45 sm:text-sm"
            >
              Apply Filters
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
