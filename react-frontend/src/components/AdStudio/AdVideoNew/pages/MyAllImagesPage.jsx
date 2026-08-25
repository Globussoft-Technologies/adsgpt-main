import Masonry from 'react-masonry-css';
import { Download, Info } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { getMySpaceImages } from '@/apis/image/imageApi';
import { saveEditedAdFactoryImage } from '@/apis/adFactory/adFactoryImagesApi';
import { downloadMediaZipAction } from '@/store/actions/adVideoNew/Advideoactions';
import { saveEditedImageAction } from '@/store/actions/image/imageActions';
import RecreateAdModal from '@/components/AdLibrary/RecreateAdModal';
import ImageCard from './ImageCard';
import PostAdMySpaceModal from '../PostAdMySpace/PostAdMySpaceModal';
import { readPendingPostAd } from '../PostAdMySpace/postAdPersistence';

const breakpointColumnsObj = {
  default: 4,
  1280: 3,
  1024: 3,
  700: 2,
  340: 1,
};

const STALE_GENERATING_MS = 10 * 60 * 1000;

function normalizeStatus(status) {
  if (status === 'success') return 'completed';
  if (status === 'generating') return 'processing';
  if (status === 'error') return 'failed';
  return status || 'failed';
}

function isStaleGenerating(item, now) {
  if (item?.status !== 'pending' && item?.status !== 'processing') return false;
  const timestamp = item?.updatedAt || item?.createdAt;
  const timestampMs = timestamp ? new Date(timestamp).getTime() : 0;
  return timestampMs > 0 && now - timestampMs > STALE_GENERATING_MS;
}

function deriveDisplayItem(item, now) {
  if (!isStaleGenerating(item, now)) return item;

  return {
    ...item,
    status: 'failed',
    results: [
      {
        ...item.results?.[0],
        status: 'failed',
        imageStatus: 500,
      },
    ],
  };
}

function normalizeToImageCardItem(row) {
  const status = normalizeStatus(row?.status);
  const url = row?.url || '';
  const inputs = {
    type: row?.type || row?.source || '',
    model: row?.model || '',
    modelLabel: row?.modelLabel || '',
    quality: row?.metadata?.quality || '',
    brandName: row?.metadata?.brandName || '',
    userPrompt: row?.prompt || '',
    prompt: row?.prompt || '',
    aspectRatio: row?.aspectRatio || '',
    numberOfImages: 1,
    aspectRatioPerImage: [
      {
        aspectRatio: row?.aspectRatio || '',
        numberOfImages: 1,
      },
    ],
  };

  return {
    _id: row?.id || `${row?.source || 'my-space'}-${url || row?.timestamp || Math.random()}`,
    _source: row?.source,
    _sourceLabel: row?.sourceLabel,
    _resultIndex: 0,
    _recordId: row?.imageId || row?.id,
    sourceMetadata: row?.metadata || {},
    status,
    creativeType: row?.type || row?.sourceLabel || row?.source,
    inputs,
    results:
      (status === 'pending' || status === 'processing') && !url
        ? []
        : [
            {
              url,
              generatedImageUrl: url,
              aspectRatio: row?.aspectRatio || '',
              prompt: row?.prompt || '',
              status,
              imageStatus: status === 'failed' ? 500 : 200,
            },
          ],
    url,
    updatedAt: row?.updatedAt || row?.timestamp || row?.createdAt,
    createdAt: row?.createdAt || row?.timestamp || row?.updatedAt,
  };
}

function AllAdFactoryInfoTooltip({ item }) {
  const [showInfo, setShowInfo] = useState(false);
  const infoTimeout = useRef(null);
  const campaignName = item?.sourceMetadata?.campaignName;
  const model = item?.inputs?.modelLabel || item?.inputs?.model;
  const timestamp = item?.updatedAt || item?.createdAt;

  const handleInfoEnter = () => {
    clearTimeout(infoTimeout.current);
    setShowInfo(true);
  };

  const handleInfoLeave = () => {
    infoTimeout.current = setTimeout(() => setShowInfo(false), 150);
  };

  return (
    <div className="absolute top-3 right-3 z-30 flex items-center gap-2 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
      <div className="relative" onMouseEnter={handleInfoEnter} onMouseLeave={handleInfoLeave}>
        <button
          className={`rounded-full p-2 text-gray-100 backdrop-blur hover:bg-black/60 dark:text-white ${showInfo ? 'bg-black/60' : ''}`}
        >
          <Info size={18} />
        </button>
        {showInfo && (
          <>
            <div className="absolute top-full right-0 h-2 w-full" />
            <div className="absolute top-[calc(100%+0.25rem)] right-0 z-50 max-h-[130px] w-52 overflow-y-auto rounded-lg border border-black/10 bg-white p-3 text-xs text-gray-900 shadow-xl dark:border-transparent dark:bg-black/90 dark:text-white">
              {campaignName && (
                <p>
                  <span className="text-gray-400">Campaign:</span> {campaignName}
                </p>
              )}
              {model && (
                <p className="mt-1">
                  <span className="text-gray-400">Model:</span> {model}
                </p>
              )}
              {timestamp && (
                <p className="mt-1">
                  <span className="text-gray-400">Time:</span>{' '}
                  {new Date(timestamp).toLocaleString('en-IN', {
                    timeZone: 'Asia/Kolkata',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: true,
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric',
                  })}
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function MyAllImagesPage({ startDate = '', endDate = '' }) {
  const dispatch = useDispatch();
  const userId = useSelector((state) => state.socket?.userData?.user_id);
  const [items, setItems] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [skip, setSkip] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [selectedImages, setSelectedImages] = useState([]);
  const [fullscreenIndex, setFullscreenIndex] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const containerRef = useRef(null);
  const limit = 20;

  const [recreateAdsState, setRecreateAdsState] = useState({
    open: false,
    sourceImage: '',
  });
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

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const load = async (nextSkip, replace) => {
    setIsLoading(true);
    try {
      const res = await getMySpaceImages({
        source: 'all',
        skip: nextSkip,
        limit,
        startDate,
        endDate,
      });
      const page = Array.isArray(res?.data) ? res.data.map(normalizeToImageCardItem) : [];
      setItems((prev) => (replace ? page : [...prev, ...page]));
      setHasMore(page.length === limit);
      setSkip(nextSkip + page.length);
    } catch (error) {
      console.error('getMySpaceImages failed:', error);
      if (replace) setItems([]);
      setHasMore(false);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    setItems([]);
    setSkip(0);
    setHasMore(true);
    load(0, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDate, endDate]);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el || isLoading || !hasMore) return;
    const isBottom = el.scrollHeight - el.scrollTop <= el.clientHeight + 100;
    if (isBottom) load(skip, false);
  };

  const fetchMoreForNav = async () => {
    if (isLoading || !hasMore) return [];
    const nextSkip = skip;
    setIsLoading(true);
    try {
      const res = await getMySpaceImages({
        source: 'all',
        skip: nextSkip,
        limit,
        startDate,
        endDate,
      });
      const page = Array.isArray(res?.data) ? res.data.map(normalizeToImageCardItem) : [];
      setItems((prev) => [...prev, ...page]);
      setHasMore(page.length === limit);
      setSkip(nextSkip + page.length);
      return page;
    } catch (error) {
      console.error('getMySpaceImages failed:', error);
      setHasMore(false);
      return [];
    } finally {
      setIsLoading(false);
    }
  };

  const toggleSelection = (url) => {
    if (!url) return;
    setSelectedImages((prev) =>
      prev.includes(url) ? prev.filter((selectedUrl) => selectedUrl !== url) : [...prev, url],
    );
  };

  const completedImageUrls = useMemo(
    () =>
      items
        .map((item) => deriveDisplayItem(item, now))
        .filter((item) => item.status === 'completed' && item.results?.[0]?.url)
        .map((item) => item.results[0].url),
    [items, now],
  );

  const displayedItems = useMemo(
    () => items.map((item) => deriveDisplayItem(item, now)),
    [items, now],
  );

  const selectAll = () => {
    if (selectedImages.length === completedImageUrls.length) {
      setSelectedImages([]);
    } else {
      setSelectedImages(completedImageUrls);
    }
  };

  const handleDownloadSelected = () => {
    if (selectedImages.length === 0) return;
    dispatch(downloadMediaZipAction(selectedImages, 'image'));
    setSelectedImages([]);
  };

  const handleLogoSaved = async (newUrl, item) => {
    if (item?._source === 'adFactory') {
      const campaignId = item?.sourceMetadata?.campaignId;
      if (!campaignId || !userId) return;

      const optimisticItem = {
        ...item,
        _id: `${item._id}-edited-${Date.now()}`,
        status: 'completed',
        url: newUrl,
        updatedAt: new Date().toISOString(),
        results: [{ ...item.results?.[0], url: newUrl, generatedImageUrl: newUrl }],
      };
      setItems((prev) => [optimisticItem, ...prev]);

      try {
        await saveEditedAdFactoryImage({
          userId,
          campaignId,
          imageUrl: newUrl,
          prompt: item?.sourceMetadata?.campaignName || 'Edited image',
        });
      } catch (error) {
        console.error('saveEditedAdFactoryImage failed:', error);
        setItems((prev) => prev.filter((current) => current._id !== optimisticItem._id));
      }
      return;
    }

    dispatch(
      saveEditedImageAction({
        url: newUrl,
        sourceImageId: item?._recordId,
        inputs: item?.inputs,
      }),
    );
  };

  return (
    <div
      className="relative h-full w-full overflow-y-auto px-2 py-8 sm:px-6 2xl:py-10"
      ref={containerRef}
      onScroll={handleScroll}
    >
      {selectedImages.length > 0 && (
        <div className="animate-in fade-in zoom-in-95 slide-in-from-bottom-4 fixed bottom-12 left-1/2 z-50 flex -translate-x-1/2 items-center gap-5 rounded-full border border-black/10 bg-white/90 px-2 py-2 text-gray-900 shadow-[0_8px_32px_rgba(0,0,0,0.5)] backdrop-blur-xl transition-all duration-500 dark:border-white/5 dark:bg-[#1a1a1a]/90 dark:text-white">
          <div className="flex items-center pr-2 pl-4">
            <span className="text-[13px] font-semibold text-gray-900 dark:text-white/90">
              {selectedImages.length}
            </span>
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

      {completedImageUrls.length > 0 && (
        <div className="mb-6 flex justify-end px-2">
          <button
            onClick={selectAll}
            className="group flex items-center gap-2 text-xs font-medium text-gray-500 transition-colors hover:text-black dark:hover:text-white"
          >
            <div
              className={`flex h-4 w-4 items-center justify-center rounded border transition-colors ${
                selectedImages.length > 0 && selectedImages.length === completedImageUrls.length
                  ? 'border-blue-600 bg-blue-600'
                  : 'border-gray-400 bg-white group-hover:border-gray-600 group-hover:bg-black/5 dark:border-gray-600 dark:bg-transparent dark:group-hover:border-gray-400 dark:group-hover:bg-transparent'
              }`}
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
      )}

      <Masonry
        breakpointCols={breakpointColumnsObj}
        className="flex w-full gap-2"
        columnClassName="flex flex-col gap-2"
      >
        {displayedItems.map((imageItem, index) => {
          const isAdFactory = imageItem._source === 'adFactory';

          return (
            <div key={imageItem._id || index} className="group relative">
              <ImageCard
                item={imageItem}
                isSelected={selectedImages.includes(imageItem.results?.[0]?.url)}
                onSelect={() => toggleSelection(imageItem.results?.[0]?.url)}
                imageIndex={index}
                fullscreenIndex={fullscreenIndex}
                onFullscreenChange={setFullscreenIndex}
                totalImages={displayedItems.length}
                getImageAt={(i) => displayedItems[i]}
                hasMore={hasMore}
                onFetchMore={fetchMoreForNav}
                enableInfo={!isAdFactory}
                enableRecreate={imageItem._source === 'adCreative'}
                showGeneratingProgress={false}
                onLogoSaved={(newUrl) => handleLogoSaved(newUrl, imageItem)}
                onOpenRecreateAdsModal={(tailored) => {
                  setRecreateAdsState({
                    open: true,
                    sourceImage:
                      tailored?.competitorAd || tailored?.competitorReferenceImage || '',
                  });
                }}
                onOpenPostAdModal={(payload) =>
                  setPostAdState({ open: true, payload, autoAdvance: false })
                }
              />
              {isAdFactory && <AllAdFactoryInfoTooltip item={imageItem} />}
            </div>
          );
        })}
      </Masonry>

      {displayedItems.length === 0 && !isLoading && (
        <div className="flex h-full w-full items-center justify-center text-gray-400">
          No images found.
        </div>
      )}
      {isLoading && (
        <div className="mt-6 flex w-full items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-300 border-t-blue-600" />
        </div>
      )}

      <RecreateAdModal
        open={recreateAdsState.open}
        onOpenChange={(open) => setRecreateAdsState((state) => ({ ...state, open }))}
        image={recreateAdsState.sourceImage}
        ad={null}
      />

      <PostAdMySpaceModal
        open={postAdState.open}
        onOpenChange={(open) => setPostAdState((state) => ({ ...state, open }))}
        payload={postAdState.payload}
        autoAdvance={postAdState.autoAdvance}
      />
    </div>
  );
}
