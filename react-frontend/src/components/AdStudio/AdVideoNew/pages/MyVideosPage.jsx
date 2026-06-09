import Masonry from 'react-masonry-css';
import { Download, Info, Heart, Pause, Play } from 'lucide-react';
import CreativeGeneratingLoader from '../../AdCreatives/CreativeChat/Loader/CreativeGeneratingLoader';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { fetchAllVideos, downloadMediaZipAction } from '@/store/actions/adVideoNew/Advideoactions';
import VideoCard from './VideoCard';
import PostAdMySpaceModal from '../PostAdMySpace/PostAdMySpaceModal';
import { readPendingPostAd } from '../PostAdMySpace/postAdPersistence';

const breakpointColumnsObj = {
  default: 4,
  1280: 3,
  1024: 3,
  700: 2,
  340: 1,
};

export default function MyVideosPage({ videoType = '', startDate = '', endDate = '' }) {
  const dispatch = useDispatch();
  const { allVideos = [], isLoading } = useSelector((state) => state.adVideoNew);
  const [fullscreenIndex, setFullscreenIndex] = useState(null);
  const displayedVideos = useMemo(() => {
    return allVideos.filter((v) => {
      if (v.status === 'pending' && v.inputs?.type === 'avatar') {
        return (
          v.generatedImage &&
          v.generatedImage !== 'failed' &&
          v.generatedScript &&
          v.generatedScript !== 'failed'
        );
      }
      return true;
    });
  }, [allVideos]);
  // console.log('allVideos', allVideos);

  const [skip, setSkip] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const limit = 10;
  const containerRef = useRef(null);
  const [selectedVideos, setSelectedVideos] = useState([]);

  // MySpace → Meta Post Ad modal. Opened from each VideoCard's Megaphone
  // button; payload carries the video URL and the prompt that produced
  // it. `autoAdvance` is set only when restoring after the Facebook
  // OAuth round-trip.
  const [postAdState, setPostAdState] = useState({
    open: false,
    payload: null,
    autoAdvance: false,
  });

  // Re-open the modal after the FB OAuth redirect. Payload was stashed
  // to sessionStorage by the modal before the redirect fired.
  useEffect(() => {
    const pending = readPendingPostAd();
    if (pending) {
      setPostAdState({ open: true, payload: pending, autoAdvance: true });
    }
  }, []);

  const toggleSelection = (url) => {
    if (!url) return;
    setSelectedVideos((prev) =>
      prev.includes(url) ? prev.filter((u) => u !== url) : [...prev, url]
    );
  };

  const handleDownloadSelected = () => {
    if (selectedVideos.length === 0) return;
    dispatch(downloadMediaZipAction(selectedVideos));
    setSelectedVideos([]);
  };

  const selectAll = () => {
    const completedVideoUrls = displayedVideos
      .filter((v) => v.status === 'completed' && v.results?.[0]?.url)
      .map((v) => v.results[0].url);

    if (selectedVideos.length === completedVideoUrls.length) {
      setSelectedVideos([]);
    } else {
      setSelectedVideos(completedVideoUrls);
    }
  };

  useEffect(() => {
    const initFetch = async () => {
      setSkip(0);
      setHasMore(true);
      const fetchedVideos = await dispatch(
        fetchAllVideos({ skip: 0, limit, type: videoType, startDate, endDate })
      );
      if (fetchedVideos.length < limit) {
        setHasMore(false);
      }
    };
    initFetch();
  }, [dispatch, videoType, startDate, endDate]);

  const handleScroll = async () => {
    const el = containerRef.current;
    if (!el || isLoading || !hasMore) return;

    const isBottom = el.scrollHeight - el.scrollTop <= el.clientHeight + 100;

    if (isBottom) {
      const newSkip = skip + limit;
      const fetchedVideos = await dispatch(
        fetchAllVideos({
          skip: newSkip,
          limit,
          append: true,
          type: videoType,
          startDate,
          endDate,
        })
      );

      if (fetchedVideos.length < limit) {
        setHasMore(false);
      }
      setSkip(newSkip);
    }
  };

  const fetchMoreForNav = async () => {
    if (isLoading || !hasMore) return [];
    const newSkip = skip + limit;
    const fetched = await dispatch(
      fetchAllVideos({ skip: newSkip, limit, append: true, type: videoType, startDate, endDate })
    );
    if (fetched.length < limit) setHasMore(false);
    setSkip(newSkip);
    return fetched;
  };

  return (
    <div
      className="relative h-full w-full overflow-y-auto px-2 py-8 sm:px-6 2xl:py-10"
      ref={containerRef}
      onScroll={handleScroll}
    >
      {/* Ultra-Minimal Floating Selection Bar */}
      {selectedVideos.length > 0 && (
        <div className="animate-in fade-in zoom-in-95 slide-in-from-bottom-4 fixed bottom-12 left-1/2 z-50 flex -translate-x-1/2 items-center gap-5 rounded-full border border-black/10 bg-white/90 px-2 py-2 text-gray-900 shadow-[0_8px_32px_rgba(0,0,0,0.5)] backdrop-blur-xl transition-all duration-500 dark:border-white/5 dark:bg-[#1a1a1a]/90 dark:text-white">
          <div className="flex items-center pr-2 pl-4">
            <span className="text-[13px] font-semibold text-gray-900 dark:text-white/90">{selectedVideos.length}</span>
            <span className="ml-1.5 text-[11px] font-medium tracking-widest text-gray-400 uppercase">
              Selected
            </span>
          </div>

          <div className="h-4 w-[1px] bg-black/10 dark:bg-white/10" />

          <div className="ml-1 flex items-center gap-2 pr-1">
            <button
              onClick={() => setSelectedVideos([])}
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
              selectedVideos.length > 0 &&
              selectedVideos.length ===
                displayedVideos.filter((v) => v.status === 'completed' && v.results?.[0]?.url)
                  .length
                ? 'border-blue-600 bg-blue-600'
                : 'border-gray-400 bg-white group-hover:border-gray-600 dark:border-gray-600 dark:bg-transparent dark:group-hover:border-gray-400'
            } flex items-center justify-center`}
          >
            {selectedVideos.length > 0 &&
              selectedVideos.length ===
                displayedVideos.filter((v) => v.status === 'completed' && v.results?.[0]?.url)
                  .length && (
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
          {selectedVideos.length > 0 &&
          selectedVideos.length ===
            displayedVideos.filter((v) => v.status === 'completed' && v.results?.[0]?.url).length
            ? 'Deselect All'
            : 'Select All'}
        </button>
      </div>

      <Masonry
        breakpointCols={breakpointColumnsObj}
        className="flex w-full gap-2"
        columnClassName="flex flex-col gap-2"
      >
        {displayedVideos.map((videoItem, index) => (
          <VideoCard
            key={videoItem._id}
            item={videoItem}
            isSelected={selectedVideos.includes(videoItem.results?.[0]?.url)}
            onSelect={() => toggleSelection(videoItem.results?.[0]?.url)}
            videoIndex={index}
            fullscreenIndex={fullscreenIndex}
            onFullscreenChange={setFullscreenIndex}
            totalVideos={displayedVideos.length}
            getVideoAt={(i) => displayedVideos[i]}
            hasMore={hasMore}
            onFetchMore={fetchMoreForNav}
            onOpenPostAdModal={(payload) =>
              setPostAdState({ open: true, payload, autoAdvance: false })
            }
          />
        ))}
      </Masonry>
      {displayedVideos.length === 0 && !isLoading && (
        <div className="flex h-full w-full items-center justify-center text-gray-400">
          No videos found.
        </div>
      )}
      {isLoading && skip > 0 && (
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
