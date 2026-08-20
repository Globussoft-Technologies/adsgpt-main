import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Loader2, Search } from 'lucide-react';

import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import ImageCard from '../CompetitorVisualsModal/ImageCard';
import { fetchCompetitorAds } from '@/store/actions/feature/competitorSearchActions';
import {
  resetCompetitorSearch,
  setSearchTerm,
  setSearchType,
} from '@/store/reducers/feature/competitorSearchSlice';

const NAS_BASE_URL = import.meta.env.VITE_NAS_BASE_URL || '';

const getImageUrl = (ad, idx) => {
  const rawUrl = ad?.postImage || ad?.media_url || ad?.image_url || ad?.data || '';
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  return rawUrl.startsWith('http') ? rawUrl : `${NAS_BASE_URL}${rawUrl}`;
};

export default function CompetitorVisualsPicker({
  open,
  onOpenChange,
  currentImages = [],
  onSave,
  max = 5,
}) {
  const dispatch = useDispatch();
  const { ads, loading, hasMore, onScrollLoading } = useSelector((state) => state.competitorSearch);
  const [query, setQuery] = useState('');
  const [searchType, setSearchTypeState] = useState('competitor');
  const [selectedUrls, setSelectedUrls] = useState([]);
  const containerRef = useRef(null);

  const existingImages = useMemo(
    () => (Array.isArray(currentImages) ? currentImages.filter(Boolean) : []),
    [currentImages],
  );
  const selectedCount = existingImages.length + selectedUrls.length;

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setSearchTypeState('competitor');
    setSelectedUrls([]);
    dispatch(setSearchTerm(''));
    dispatch(setSearchType('competitor'));
    dispatch(resetCompetitorSearch());
    dispatch(fetchCompetitorAds());
  }, [open, dispatch]);

  useEffect(() => {
    const container = containerRef.current;
    if (!open || !container) return undefined;

    const onScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      if (scrollTop + clientHeight >= scrollHeight - 200 && !onScrollLoading && hasMore) {
        dispatch(fetchCompetitorAds());
      }
    };

    container.addEventListener('scroll', onScroll, { passive: true });
    return () => container.removeEventListener('scroll', onScroll);
  }, [open, dispatch, onScrollLoading, hasMore]);

  const runSearch = (nextQuery = query, nextType = searchType) => {
    dispatch(setSearchTerm(nextQuery.trim()));
    dispatch(setSearchType(nextType));
    dispatch(resetCompetitorSearch());
    dispatch(fetchCompetitorAds());
  };

  const toggleSelected = (url) => {
    if (!url || existingImages.includes(url)) return;
    setSelectedUrls((prev) => {
      if (prev.includes(url)) return prev.filter((item) => item !== url);
      if (existingImages.length + prev.length >= max) return prev;
      return [...prev, url];
    });
  };

  const handleSave = () => {
    const next = [...existingImages];
    for (const url of selectedUrls) {
      if (next.length >= max) break;
      if (!next.includes(url)) next.push(url);
    }
    onSave?.(next);
    onOpenChange?.(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[min(1100px,96vw)] overflow-hidden rounded-[28px] border border-white/10 bg-[#262626] text-white shadow-2xl dark:bg-[#262626]">
        <DialogHeader>
          <DialogTitle className="text-center text-xl font-semibold tracking-[-0.018em]">
            Add competitor visualss
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 pt-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-white/60">
              Select up to {max} visuals total. Selected: {selectedCount}/{max}
            </p>
            <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
              <Search className="h-4 w-4 text-white/50" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    runSearch();
                  }
                }}
                placeholder="Search competitors or keywords"
                className="w-64 bg-transparent text-sm outline-none placeholder:text-white/35"
              />
              <button
                type="button"
                onClick={() => runSearch()}
                className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-black"
              >
                Search
              </button>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {['competitor', 'keyword'].map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => {
                  setSearchTypeState(type);
                  runSearch(query, type);
                }}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  searchType === type ? 'bg-white text-black' : 'bg-white/8 text-white/70'
                }`}
              >
                {type === 'competitor' ? 'Competitor' : 'Keyword'}
              </button>
            ))}
          </div>

          <div
            ref={containerRef}
            className="max-h-[55vh] overflow-y-auto rounded-2xl border border-white/10 bg-white/4 p-2"
          >
            {loading && ads.length === 0 ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-6 w-6 animate-spin text-white/50" />
              </div>
            ) : ads.length > 0 ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {ads.map((ad, idx) => {
                  const url = getImageUrl(ad, idx);
                  const image = { ...ad, id: ad?.id || idx, url };
                  const isSelected = existingImages.includes(url) || selectedUrls.includes(url);

                  return (
                    <div
                      key={image.id}
                      className={`rounded-xl ${existingImages.includes(url) ? 'opacity-70' : ''}`}
                    >
                      <ImageCard
                        image={image}
                        isSelected={isSelected}
                        onSelect={() => toggleSelected(url)}
                      />
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex items-center justify-center py-16 text-sm text-white/50">
                No results found
              </div>
            )}

            {onScrollLoading && (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-5 w-5 animate-spin text-white/50" />
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="pt-2">
          <div className="flex w-full items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => onOpenChange?.(false)}
              className="rounded-lg border border-white/20 px-5 py-2 text-sm text-white/80"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={selectedUrls.length === 0}
              className="rounded-lg bg-white px-5 py-2 text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-50"
            >
              Save selected
            </button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
