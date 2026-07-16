import Masonry from 'react-masonry-css';
import { Download, Sparkles } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch } from 'react-redux';
import toast from 'react-hot-toast';

import { getMediaLibrary } from '@/apis/metaAds/metaAdsApi';
import { getUserId } from '@/components/AdStudio/AdCreativeNew/ai-creatives/apiClient';
import { downloadMediaZipAction } from '@/store/actions/adVideoNew/Advideoactions';
import toMediaUrl from '@/utils/mediaUrl';
import ImageCard from './ImageCard';
import PostAdMySpaceModal from '../PostAdMySpace/PostAdMySpaceModal';
import { readPendingPostAd } from '../PostAdMySpace/postAdPersistence';

// Claude AI image library — creatives the user generated through the Claude
// connector (claude.ai calling our MCP tools over OAuth). Rendered through the
// SAME MySpace card as every other image source (ImageCard) so preview,
// edit-logo, Canva, download, multi-select ZIP, and fullscreen nav all behave
// identically — this is a filter over the shared feed, NOT a parallel surface.
//
// Data comes from the slim /generated-media/library endpoint scoped to
// source=claudeAI (the MCP credit-finalize path tags connector media with that
// source). Those rows are slim — no generation `inputs`/prompt/status — so we
// adapt each into the { status, results:[{url}] } shape ImageCard reads, and
// opt out of Info + Recreate (nothing to show / nowhere to route). Mirrors
// MyAssistantImagesPage exactly (source is the only functional difference).

// Match the conventional MyImagesPage grid exactly.
const breakpointColumnsObj = {
  default: 4,
  1280: 3,
  1024: 3,
  700: 2,
  340: 1,
};

const PAGE_SIZE = 24;

// Slim library row → the record shape ImageCard/MyImagesPage consume. URLs are
// resolved to absolute here (mirroring the conventional history normalisation)
// so display, download, and ZIP all see a ready-to-use URL.
const adaptRow = (row) => {
  const abs = toMediaUrl(row?.url);
  return {
    _id: row?._id || abs,
    status: 'completed',
    model: row?.model,
    createdAt: row?.createdAt,
    // Connector rows carry no generation inputs; keep an empty object so
    // ImageCard's optional reads (prompt for post-as-ad) stay safe.
    inputs: {},
    url: abs,
    results: [{ url: abs, imageStatus: 200, aspectRatio: null }],
  };
};

export default function MyClaudeImagesPage() {
  const dispatch = useDispatch();
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [didInitialLoad, setDidInitialLoad] = useState(false);
  const loadingRef = useRef(false);
  const containerRef = useRef(null);

  const [fullscreenIndex, setFullscreenIndex] = useState(null);
  const [selectedImages, setSelectedImages] = useState([]);

  // MySpace → Meta Post Ad modal, same wiring as MyImagesPage: opened from each
  // card's Megaphone button; re-opened after the Facebook OAuth round-trip.
  const [postAdState, setPostAdState] = useState({
    open: false,
    payload: null,
    autoAdvance: false,
  });

  useEffect(() => {
    const pending = readPendingPostAd();
    if (pending) {
      setPostAdState({ open: true, payload: pending, autoAdvance: true });
    }
  }, []);

  const fetchPage = useCallback(async (nextPage, replace) => {
    if (loadingRef.current) return [];
    loadingRef.current = true;
    setIsLoading(true);
    try {
      const userId = getUserId();
      const data = await getMediaLibrary({
        userId,
        type: 'image',
        source: 'claudeAI',
        page: nextPage,
        limit: PAGE_SIZE,
      });
      const payload = data?.data ?? data;
      const rows = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.items)
          ? payload.items
          : [];
      const adapted = rows.map(adaptRow);
      setItems((prev) => (replace ? adapted : [...prev, ...adapted]));
      const more =
        typeof data?.hasMore === 'boolean' ? data.hasMore : rows.length === PAGE_SIZE;
      setHasMore(more);
      setPage(nextPage);
      return adapted;
    } catch (err) {
      const msg = err?.response?.data?.message || err?.message || 'Failed to load images';
      toast.error(msg);
      return [];
    } finally {
      setIsLoading(false);
      setDidInitialLoad(true);
      loadingRef.current = false;
    }
  }, []);

  useEffect(() => {
    fetchPage(1, true);
  }, [fetchPage]);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el || loadingRef.current || !hasMore) return;
    const isBottom = el.scrollHeight - el.scrollTop <= el.clientHeight + 100;
    if (isBottom) fetchPage(page + 1, false);
  };

  // Fullscreen "next" beyond the loaded set: fetch the next page and hand the
  // freshly-added cards back so ImageCard can advance into them.
  const fetchMoreForNav = async () => {
    if (loadingRef.current || !hasMore) return [];
    return fetchPage(page + 1, false);
  };

  // Logo editor "Save as new". The editor already uploaded the composite to
  // S3, so we surface it immediately by prepending an adapted card. Connector
  // media isn't stored with generation metadata, so the default save-edited
  // endpoint can't persist it as a re-fetchable record — the edited copy shows
  // for this session; a fresh generation is what repopulates the feed.
  const handleLogoSaved = (newUrl) => {
    if (!newUrl) return;
    const adapted = adaptRow({ url: newUrl, model: 'claudeAI' });
    setItems((prev) => [adapted, ...prev]);
  };

  const toggleSelection = (url) => {
    if (!url) return;
    setSelectedImages((prev) =>
      prev.includes(url) ? prev.filter((u) => u !== url) : [...prev, url]
    );
  };

  const handleDownloadSelected = () => {
    if (selectedImages.length === 0) return;
    dispatch(downloadMediaZipAction(selectedImages, 'image'));
    setSelectedImages([]);
  };

  const completedImageUrls = useMemo(
    () => items.filter((v) => v.results?.[0]?.url).map((v) => v.results[0].url),
    [items]
  );

  const selectAll = () => {
    if (selectedImages.length === completedImageUrls.length) {
      setSelectedImages([]);
    } else {
      setSelectedImages(completedImageUrls);
    }
  };

  if (didInitialLoad && !isLoading && items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-24 text-center text-gray-500 dark:text-white/60">
        <Sparkles className="h-8 w-8 opacity-50" />
        <p className="text-sm">
          No Claude AI images yet. Generate one through the Claude connector and it&apos;ll show up here.
        </p>
      </div>
    );
  }

  return (
    <div
      className="relative h-full w-full overflow-y-auto px-2 py-8 sm:px-6 2xl:py-10"
      ref={containerRef}
      onScroll={handleScroll}
    >
      {/* Floating Selection Bar */}
      {selectedImages.length > 0 && (
        <div className="animate-in fade-in zoom-in-95 slide-in-from-bottom-4 fixed bottom-12 left-1/2 z-50 flex -translate-x-1/2 items-center gap-5 rounded-full border border-black/10 bg-white/90 text-gray-900 shadow-[0_8px_32px_rgba(0,0,0,0.5)] dark:border-white/5 dark:bg-[#1a1a1a]/90 dark:text-white px-2 py-2 backdrop-blur-xl transition-all duration-500">
          <div className="flex items-center pr-2 pl-4">
            <span className="text-[13px] font-semibold text-gray-900 dark:text-white/90">{selectedImages.length}</span>
            <span className="ml-1.5 text-[11px] font-medium tracking-widest text-gray-400 uppercase">
              Selected
            </span>
          </div>

          <div className="h-4 w-[1px] bg-black/10 dark:bg-white/10" />

          <div className="ml-1 flex items-center gap-2 pr-1">
            <button
              onClick={() => setSelectedImages([])}
              className="rounded-full px-3 py-1.5 text-[11px] font-bold text-gray-400 transition-all hover:bg-black/5 hover:text-black dark:hover:bg-white/5 dark:hover:text-white"
            >
              CLEAR
            </button>
            <button
              onClick={handleDownloadSelected}
              className="flex items-center gap-2 rounded-full bg-blue-600 px-5 py-2 text-[11px] font-bold text-white transition-all hover:bg-blue-500 hover:shadow-[0_0_20px_rgba(37,99,235,0.4)] active:scale-95"
            >
              <Download size={13} />
              DOWNLOAD ZIP
            </button>
          </div>
        </div>
      )}

      {/* Select All Toggle */}
      <div className="mb-6 flex justify-end px-2">
        <button
          onClick={selectAll}
          className="group flex items-center gap-2 text-xs font-medium text-gray-500 transition-colors hover:text-black dark:hover:text-white"
        >
          <div
            className={`h-4 w-4 rounded border transition-colors ${
              selectedImages.length > 0 && selectedImages.length === completedImageUrls.length
                ? 'border-blue-600 bg-blue-600'
                : 'border-gray-400 bg-white group-hover:border-gray-600 group-hover:bg-black/5 dark:border-gray-600 dark:bg-transparent dark:group-hover:border-gray-400 dark:group-hover:bg-transparent'
            } flex items-center justify-center`}
          >
            {selectedImages.length > 0 && selectedImages.length === completedImageUrls.length && (
              <svg
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="4"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-white"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </div>
          {selectedImages.length > 0 && selectedImages.length === completedImageUrls.length
            ? 'Deselect All'
            : 'Select All'}
        </button>
      </div>

      <Masonry
        breakpointCols={breakpointColumnsObj}
        className="flex w-full gap-2"
        columnClassName="flex flex-col gap-2"
      >
        {items.map((imageItem, index) => (
          <ImageCard
            key={imageItem._id || index}
            item={imageItem}
            isSelected={selectedImages.includes(imageItem.results?.[0]?.url)}
            onSelect={() => toggleSelection(imageItem.results?.[0]?.url)}
            imageIndex={index}
            fullscreenIndex={fullscreenIndex}
            onFullscreenChange={setFullscreenIndex}
            totalImages={items.length}
            getImageAt={(i) => items[i]}
            hasMore={hasMore}
            onFetchMore={fetchMoreForNav}
            onOpenPostAdModal={(payload) =>
              setPostAdState({ open: true, payload, autoAdvance: false })
            }
            // Connector rows have no generation inputs to power these.
            enableInfo={false}
            enableRecreate={false}
            onLogoSaved={handleLogoSaved}
          />
        ))}
      </Masonry>

      {isLoading && (
        <div className="mt-6 flex w-full items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-300 border-t-blue-600"></div>
        </div>
      )}

      <PostAdMySpaceModal
        open={postAdState.open}
        onOpenChange={(open) => setPostAdState((s) => ({ ...s, open }))}
        payload={postAdState.payload}
        autoAdvance={postAdState.autoAdvance}
      />
    </div>
  );
}
