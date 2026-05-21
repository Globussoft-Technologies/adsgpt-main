import Masonry from 'react-masonry-css';
import { Download } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { fetchImageHistoryAction } from '@/store/actions/image/imageActions';
import { downloadMediaZipAction } from '@/store/actions/adVideoNew/Advideoactions';
import RecreateAdModal from '@/components/AdLibrary/RecreateAdModal';
import ImageCard from './ImageCard';

const breakpointColumnsObj = {
  default: 4,
  1280: 3,
  1024: 3,
  700: 2,
  340: 1,
};

export default function MyImagesPage({ imageType = '', startDate = '', endDate = '' }) {
  const dispatch = useDispatch();
  const { items: allImages = [], status } = useSelector((state) => state.image.history);
  const isLoading = status === 'loading';
  const [fullscreenIndex, setFullscreenIndex] = useState(null);

  // Records that have been `pending` for more than this long without a socket
  // completion are treated as failed — otherwise the placeholder spins
  // forever when the worker silently drops a job.
  const STALE_PENDING_MS = 10 * 60 * 1000;

  // Tick every 30s so the staleness derivation in the memo below recomputes
  // even when the user is just sitting on the page waiting.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Effective status — flips a long-stuck pending record to 'failed' so
  // ImageCard renders the error tile instead of the loader forever.
  const deriveStatus = (record, t) => {
    const s = record?.status;
    const results = Array.isArray(record?.results) ? record.results : [];
    if ((s === 'pending' || s === 'processing') && results.length === 0) {
      const createdMs = record?.createdAt ? new Date(record.createdAt).getTime() : 0;
      if (createdMs && t - createdMs > STALE_PENDING_MS) return 'failed';
    }
    return s;
  };

  // A single backend record can carry N result variations (e.g. multiple
  // aspect ratios). MySpace renders ONE card per result, so we flatten:
  // each card gets a shallow clone of the record with `results = [oneResult]`
  // so ImageCard's existing `results[0]` reads still work, and a stable
  // composite id so React keys + selection don't collide across siblings.
  // While a record is still pending/processing with no results yet, we fan
  // it out to as many placeholder cards as the user requested so the loader
  // count matches the eventual result count.
  const displayedImages = useMemo(() => {
    const out = [];
    for (const record of allImages) {
      const results = Array.isArray(record?.results) ? record.results : [];
      const effectiveStatus = deriveStatus(record, now);
      const requested = Math.max(1, Number(record?.inputs?.numberOfImages) || 1);

      const isInFlight = effectiveStatus === 'pending' || effectiveStatus === 'processing';
      if (isInFlight && results.length === 0 && requested > 1) {
        for (let i = 0; i < requested; i++) {
          out.push({
            ...record,
            status: effectiveStatus,
            _id: `${record._id ?? 'rec'}-pending-${i}`,
            _recordId: record._id,
            _resultIndex: i,
            results: [],
          });
        }
        continue;
      }

      if (results.length <= 1) {
        out.push({ ...record, status: effectiveStatus });
        continue;
      }
      results.forEach((r, i) => {
        out.push({
          ...record,
          status: effectiveStatus,
          _id: `${record._id ?? 'rec'}-${i}`,
          _recordId: record._id,
          _resultIndex: i,
          results: [r],
          // Mirror the per-result url onto the top-level too, mirroring how
          // single-result records already look post-normalisation.
          url: r?.url ?? record?.url,
        });
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allImages, now]);

  const [skip, setSkip] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const limit = 10;
  const containerRef = useRef(null);
  const [selectedImages, setSelectedImages] = useState([]);
  // RecreateAdModal opening for `recreate_ads` MySpace cards. The form
  // prefills off image.recreateInputs (already dispatched by ImageCard
  // before calling onOpenRecreateAdsModal).
  const [recreateAdsState, setRecreateAdsState] = useState({
    open: false,
    sourceImage: '',
  });

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
    () =>
      displayedImages
        .filter((v) => v.status === 'completed' && v.results?.[0]?.url)
        .map((v) => v.results[0].url),
    [displayedImages]
  );

  const selectAll = () => {
    if (selectedImages.length === completedImageUrls.length) {
      setSelectedImages([]);
    } else {
      setSelectedImages(completedImageUrls);
    }
  };

  useEffect(() => {
    const initFetch = async () => {
      setSkip(0);
      setHasMore(true);
      const fetched = await dispatch(
        fetchImageHistoryAction({ type: imageType, startDate, endDate, limit }, true)
      );
      if (!fetched || fetched.length < limit) {
        setHasMore(false);
      }
    };
    initFetch();
  }, [dispatch, imageType, startDate, endDate]);

  const handleScroll = async () => {
    const el = containerRef.current;
    if (!el || isLoading || !hasMore) return;

    const isBottom = el.scrollHeight - el.scrollTop <= el.clientHeight + 100;

    if (isBottom) {
      const newSkip = skip + limit;
      const fetched = await dispatch(
        fetchImageHistoryAction({ type: imageType, startDate, endDate, limit }, false)
      );
      if (!fetched || fetched.length < limit) {
        setHasMore(false);
      }
      setSkip(newSkip);
    }
  };

  const fetchMoreForNav = async () => {
    if (isLoading || !hasMore) return [];
    const newSkip = skip + limit;
    const fetched = await dispatch(
      fetchImageHistoryAction({ type: imageType, startDate, endDate, limit }, false)
    );
    if (!fetched || fetched.length < limit) setHasMore(false);
    setSkip(newSkip);
    return fetched || [];
  };

  return (
    <div
      className="relative h-full w-full overflow-y-auto px-2 py-8 sm:px-6 2xl:py-10"
      ref={containerRef}
      onScroll={handleScroll}
    >
      {/* Floating Selection Bar */}
      {selectedImages.length > 0 && (
        <div className="animate-in fade-in zoom-in-95 slide-in-from-bottom-4 fixed bottom-12 left-1/2 z-50 flex -translate-x-1/2 items-center gap-5 rounded-full border border-white/5 bg-[#1a1a1a]/90 px-2 py-2 text-white shadow-[0_8px_32px_rgba(0,0,0,0.5)] backdrop-blur-xl transition-all duration-500">
          <div className="flex items-center pr-2 pl-4">
            <span className="text-[13px] font-semibold text-white/90">{selectedImages.length}</span>
            <span className="ml-1.5 text-[11px] font-medium tracking-widest text-gray-400 uppercase">
              Selected
            </span>
          </div>

          <div className="h-4 w-[1px] bg-white/10" />

          <div className="ml-1 flex items-center gap-2 pr-1">
            <button
              onClick={() => setSelectedImages([])}
              className="rounded-full px-3 py-1.5 text-[11px] font-bold text-gray-400 transition-all hover:bg-white/5 hover:text-white"
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
          className="group flex items-center gap-2 text-xs font-medium text-gray-500 transition-colors hover:text-white"
        >
          <div
            className={`h-4 w-4 rounded border transition-colors ${
              selectedImages.length > 0 && selectedImages.length === completedImageUrls.length
                ? 'border-blue-600 bg-blue-600'
                : 'border-gray-600 group-hover:border-gray-400'
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
        {displayedImages.map((imageItem, index) => (
          <ImageCard
            key={imageItem._id || index}
            item={imageItem}
            isSelected={selectedImages.includes(imageItem.results?.[0]?.url)}
            onSelect={() => toggleSelection(imageItem.results?.[0]?.url)}
            imageIndex={index}
            fullscreenIndex={fullscreenIndex}
            onFullscreenChange={setFullscreenIndex}
            totalImages={displayedImages.length}
            getImageAt={(i) => displayedImages[i]}
            hasMore={hasMore}
            onFetchMore={fetchMoreForNav}
            onOpenRecreateAdsModal={(tailored) => {
              // Backend persists the source ad URL as `competitorAd`;
              // older / alt records may use `competitorReferenceImage`.
              setRecreateAdsState({
                open: true,
                sourceImage:
                  tailored?.competitorAd || tailored?.competitorReferenceImage || '',
              });
            }}
          />
        ))}
      </Masonry>
      {displayedImages.length === 0 && !isLoading && (
        <div className="flex h-full w-full items-center justify-center text-gray-400">
          No images found.
        </div>
      )}
      {isLoading && skip > 0 && (
        <div className="mt-6 flex w-full items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-300 border-t-blue-600"></div>
        </div>
      )}

      {/* AdLibrary's RecreateAdModal — opened from a `recreate_ads` image
          card. Form prefills from image.recreateInputs which ImageCard
          stashed before raising onOpenRecreateAdsModal. */}
      <RecreateAdModal
        open={recreateAdsState.open}
        onOpenChange={(open) => setRecreateAdsState((s) => ({ ...s, open }))}
        image={recreateAdsState.sourceImage}
        ad={null}
      />
    </div>
  );
}
