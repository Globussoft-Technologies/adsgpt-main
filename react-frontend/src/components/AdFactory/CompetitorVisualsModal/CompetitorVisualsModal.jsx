import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { useSidebar } from '@/components/ui/sidebar';
import { MenuIcon, Search, X, Loader2 } from 'lucide-react';
import Masonry from 'react-masonry-css';
import Skeleton from 'react-loading-skeleton';
import 'react-loading-skeleton/dist/skeleton.css';
import { useFormikContext } from 'formik';
import React, { useState, useEffect, useRef } from 'react';

import { useDispatch, useSelector } from 'react-redux';
import { fetchCompetitorAds } from '@/store/actions/feature/competitorSearchActions';
import {
  resetCompetitorSearch,
  setSearchTerm,
  setSearchType,
} from '@/store/reducers/feature/competitorSearchSlice';
import ImageCard from './ImageCard';

const NAS_BASE_URL = import.meta.env.VITE_NAS_BASE_URL || '';

const CompetitorVisualsModal = ({ setCurrentStep }) => {
  const dispatch = useDispatch();
  const { ads, loading, hasMore, onScrollLoading } = useSelector((state) => state.competitorSearch);

  const [selectedCompetitorImages, setSelectedCompetitorImages] = useState([]);

  // Local UI state for search inputs
  const [exploreCompetitor, setExploreCompetitor] = useState('');
  const [exploreSearchTerm, setExploreSearchTermState] = useState('competitor');

  const { isMobile } = useSidebar();
  const { setFieldValue, values } = useFormikContext();

  const [hasSearched, setHasSearched] = useState(false);
  const initialLoadRef = useRef(false);
  const skipAutoSearchRef = useRef(false);
  const containerRef = useRef(null);

  // ─── Initial load ────────────────────────────────────────────────────────
  useEffect(() => {
    if (initialLoadRef.current) return;
    initialLoadRef.current = true;

    // 1. Write defaults into Redux so the action reads them from state
    dispatch(setSearchTerm(''));
    dispatch(setSearchType('competitor'));
    // 2. Reset skip/ads then fetch
    dispatch(resetCompetitorSearch());
    dispatch(fetchCompetitorAds());

    return () => dispatch(resetCompetitorSearch());
  }, [dispatch]);

  // ─── Scroll handler — identical pattern to MasonryResponsiveLayout ───────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      // Trigger 200px before bottom
      if (scrollTop + clientHeight >= scrollHeight - 200) {
        if (!onScrollLoading && hasMore) {
          // No override — reads current searchTerm/searchType/page from Redux state
          dispatch(fetchCompetitorAds());
        }
      }
    };

    container.addEventListener('scroll', onScroll, { passive: true });
    return () => container.removeEventListener('scroll', onScroll);
  }, [dispatch, onScrollLoading, hasMore]);

  // ─── Clear search when input is emptied ──────────────────────────────────
  useEffect(() => {
    if (!initialLoadRef.current) return;
    if (!exploreCompetitor.trim() && hasSearched) {
      setHasSearched(false);
      // Write new values to Redux FIRST so the no-arg action reads them
      dispatch(setSearchTerm(''));
      dispatch(setSearchType('competitor'));
      dispatch(resetCompetitorSearch());
      dispatch(fetchCompetitorAds());
    }
  }, [exploreCompetitor, hasSearched, dispatch]);

  // ─── Debounced auto-search while typing (after first explicit search) ─────
  useEffect(() => {
    if (!initialLoadRef.current) return;

    const term = exploreCompetitor.trim(); //  Only trigger after 2+ characters

    if (term.length < 3) return;

    const debounce = setTimeout(() => {
      //
      setHasSearched(true);

      dispatch(setSearchTerm(term));
      dispatch(setSearchType(exploreSearchTerm));

      dispatch(resetCompetitorSearch());
      dispatch(fetchCompetitorAds());
    }, 600); // tighter UX response

    return () => clearTimeout(debounce);
  }, [exploreCompetitor, exploreSearchTerm, dispatch]);

  // ─── Search handler ───────────────────────────────────────────────────────
  const handleSearch = (term, type, isAuto = false) => {
    if (!isAuto) {
      skipAutoSearchRef.current = true;
      if (term.trim()) {
        setHasSearched(true);
      }
    }

    // Write new search values into Redux BEFORE resetting/fetching.
    // This way the no-arg action reads the correct searchTerm/searchType from state,
    // AND subsequent scroll fetches read the same values — same pattern as MasonryResponsiveLayout.
    dispatch(setSearchTerm(term.trim()));
    dispatch(setSearchType(type));
    dispatch(resetCompetitorSearch()); // resets skip → 0, but preserves searchTerm/searchType
    dispatch(fetchCompetitorAds()); // no args — reads everything from state
  };

  // ─── Masonry breakpoints ──────────────────────────────────────────────────
  const breakpointColumnsObj = {
    default: 3,
    1536: 3,
    1280: 3,
    1024: 2,
    768: 2,
    640: 1,
  };

  // ─── Image selection ──────────────────────────────────────────────────────
  const toggleCompetitorImage = (image) => {
    setSelectedCompetitorImages((prev) => {
      const exists = prev.find((img) => img.url === image.url);
      if (exists) return prev.filter((img) => img.url !== image.url);

      const existingCount = (values.assets || []).length;
      if (existingCount + prev.length >= 5) return prev;

      return [...prev, image];
    });
  };

  return (
    <div className="space-y-8 pt-5 pl-3 2xl:pt-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h3 className="text-base font-semibold text-white 2xl:text-xl">Select your visuals</h3>

        <div className="backdrop-blur-100 relative flex min-w-[150px] items-center gap-2 rounded-full border border-white/20 bg-[#0D0D0D]/50 px-3 py-1.5 text-[#AFAFAF] transition-colors sm:py-2 md:left-8 md:scale-[0.8] 2xl:inset-0 2xl:scale-100 2xl:px-5 2xl:pr-3 2xl:text-sm">
          <div className="flex flex-shrink-0 items-center">
            <Search
              className="h-4 w-4 cursor-pointer hover:text-white 2xl:h-4 2xl:w-4"
              onClick={() => handleSearch(exploreCompetitor, exploreSearchTerm)}
            />
          </div>
          <input
            type="text"
            placeholder="Search.."
            className="w-full max-w-25 border-none bg-transparent text-sm text-[#D1D1D1] placeholder:text-[#777777] focus:outline-none"
            value={exploreCompetitor}
            onChange={(e) => setExploreCompetitor(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleSearch(exploreCompetitor, exploreSearchTerm);
              }
            }}
          />
          {/* {exploreCompetitor && (
            <X
              className="h-3 w-3 cursor-pointer text-[#777777] hover:text-white"
              onClick={() => setExploreCompetitor('')}
            />
          )} */}
          <div className="ml-2 flex space-x-1">
            {!isMobile ? (
              <>
                {['competitor', 'keyword'].map((type) => (
                  <button
                    key={type}
                    className={`rounded-full px-2.5 py-0.5 text-xs transition-colors duration-200 ${
                      exploreSearchTerm === type ? 'bg-[#2A2A2A] text-white' : 'text-[#777777]'
                    }`}
                    onClick={() => {
                      setExploreSearchTermState(type);
                      handleSearch(exploreCompetitor, type);
                    }}
                  >
                    {type === 'competitor' ? 'Competitor' : 'Keyword'}
                  </button>
                ))}
              </>
            ) : (
              <Popover>
                <PopoverTrigger asChild>
                  <MenuIcon className="h-4 w-4 cursor-pointer hover:text-white 2xl:h-4 2xl:w-4" />
                </PopoverTrigger>
                <PopoverContent className="z-[1000] flex w-fit flex-col gap-2 overflow-hidden rounded-lg border border-white/10 bg-[#0D0D0D]/50 p-2 shadow-lg backdrop-blur-[50px] transition-all duration-150">
                  {['competitor', 'keyword'].map((type) => (
                    <button
                      key={type}
                      className={`rounded-full px-2.5 py-0.5 text-xs transition-colors duration-200 ${
                        exploreSearchTerm === type ? 'bg-[#2A2A2A] text-white' : 'text-[#777777]'
                      }`}
                      onClick={() => {
                        setExploreSearchTermState(type);
                        handleSearch(exploreCompetitor, type);
                      }}
                    >
                      {type === 'competitor' ? 'Competitor' : 'Keyword'}
                    </button>
                  ))}
                </PopoverContent>
              </Popover>
            )}
          </div>
        </div>
      </div>

      {selectedCompetitorImages.length > 0 && (
        <div className="mb-4 flex items-center justify-between px-1">
          <p className="text-xs font-medium text-white/90 2xl:text-sm">
            {selectedCompetitorImages.length} image{selectedCompetitorImages.length > 1 ? 's' : ''}{' '}
            selected ({(values.assets || []).length + selectedCompetitorImages.length}/5 total)
          </p>
          <button
            onClick={() => setSelectedCompetitorImages([])}
            className="text-xs text-red-400 hover:text-red-300"
          >
            Clear all
          </button>
        </div>
      )}

      {/* Masonry Grid — scroll listener attached via useEffect on containerRef */}
      <div
        ref={containerRef}
        className={`h-[50vh] flex-1 overflow-y-auto rounded-xl p-1 ${
          ads.length === 0
            ? 'flex flex-col items-center justify-center border border-dashed border-white/10'
            : 'block pr-4'
        }`}
      >
        {loading && ads.length === 0 ? (
          <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 9 }).map((_, i) => (
              <div key={i} className="w-full">
                <Skeleton
                  height={250}
                  borderRadius="0.75rem"
                  baseColor="#2A2A2A"
                  highlightColor="#3A3A3A"
                />
              </div>
            ))}
          </div>
        ) : ads.length > 0 ? (
          <Masonry
            breakpointCols={breakpointColumnsObj}
            className="flex w-full gap-4"
            columnClassName="space-y-4"
          >
            {ads.map((ad, idx) => {
              const rawUrl = ad?.postImage || ad?.media_url || ad?.image_url || ad?.data || '';
              const imageUrl =
                rawUrl && typeof rawUrl === 'string'
                  ? rawUrl.startsWith('http')
                    ? rawUrl
                    : `${NAS_BASE_URL}${rawUrl}`
                  : '';
              const imageWithId = { ...ad, url: imageUrl, id: ad.id || idx };
              const isSelected = selectedCompetitorImages.find((img) => img.url === imageUrl);

              return (
                <ImageCard
                  key={imageWithId.id}
                  image={imageWithId}
                  isSelected={isSelected}
                  onSelect={toggleCompetitorImage}
                />
              );
            })}
          </Masonry>
        ) : (
          !loading && <p className="text-sm text-gray-400 2xl:text-base">No results found</p>
        )}
        {onScrollLoading && (
          <div className="flex items-center justify-center py-3">
            <Loader2 className="h-6 w-6 animate-spin text-white/50" />
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex justify-end gap-3">
        <button
          type="button"
          onClick={() => setCurrentStep(1)}
          className="rounded-sm border border-[#efefef]/70 px-6 py-2 text-xs hover:bg-black/10 sm:min-w-32 2xl:min-w-35 2xl:text-sm"
        >
          Back
        </button>

        <button
          type="button"
          disabled={selectedCompetitorImages.length === 0}
          onClick={() => {
            const formattedImages = selectedCompetitorImages.map((img) => ({
              file: null,
              tempUrl: img.url,
              url: img.url,
              name: img.url.split('/').pop() || `image-${img.id}`,
              isUploading: false,
              isExisting: false,
              source: 'url',
            }));
            setFieldValue('assets', [...(values.assets || []), ...formattedImages]);
            setCurrentStep(1);
          }}
          className={`rounded-sm bg-white px-6 py-2 text-xs font-semibold text-black sm:min-w-32 2xl:min-w-35 2xl:text-sm ${
            selectedCompetitorImages.length === 0
              ? 'cursor-not-allowed opacity-50'
              : 'hover:opacity-80'
          }`}
        >
          Next
        </button>
      </div>
    </div>
  );
};

export default CompetitorVisualsModal;
