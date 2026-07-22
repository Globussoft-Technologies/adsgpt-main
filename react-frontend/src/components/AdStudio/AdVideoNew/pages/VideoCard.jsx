import { useEffect, useRef, useState } from 'react';
import {
  Download,
  Info,
  Heart,
  Pause,
  Play,
  Maximize,
  Volume2,
  VolumeX,
  RefreshCw,
  Edit,
  Crown,
  ChevronLeft,
  ChevronRight,
  Megaphone,
} from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import CreativeGeneratingLoader from '../../AdCreatives/CreativeChat/Loader/CreativeGeneratingLoader';
import CustomVideoPlayer from '../../AdVideo/AdVideoChats/CustomVideoPlayer';
import {
  downloadMediaFromUrl,
  selectAiAdsVersionAction,
} from '@/store/actions/adVideoNew/Advideoactions';
import { useDispatch, useSelector } from 'react-redux';
import emitter from '@/utils/eventEmitter';
import {
  setActivePage,
  setRecreateInputs,
  setImageAndScript,
  setAvatarStep,
  setCloneStep,
  setAIAdsStep,
  setAiAdsSceneData,
  setAiAdsSceneLoading,
  setAiAdsPrefillInputs,
  setAiAdsPreviewVersion,
  setAiAdsVersion,
} from '@/store/reducers/adStudio/adVideoNewSlice';
import RegenerateVoiceModal from './RegenerateVoiceModal';
import VideoVersionControls from './VideoVersionControls';

const S3_BASE_URL = import.meta.env.VITE_S3_BASE_URL;
const SIGNUP_URL = import.meta.env.VITE_SIGNUP_URL;

// Post Ad nav (Megaphone) visibility. Flip to false to hide the
// "Post as ad" trigger on MySpace cards.
const SHOW_POST_AD_NAV = true;

export default function VideoCard({
  item,
  isSelected,
  onSelect,
  videoIndex,
  fullscreenIndex,
  onFullscreenChange,
  totalVideos,
  getVideoAt,
  hasMore,
  onFetchMore,
  onOpenPostAdModal,
}) {
  const videoRef = useRef();
  const pendingPlayRef = useRef(false);
  const [videoLoaded, setVideoLoaded] = useState(false);
  const [manuallyPaused, setManuallyPaused] = useState(false);
  const [showOverlay, setShowOverlay] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const videoStatus = item?.results?.[0]?.videoStatus;
  const model = item?.inputs?.model || '';
  // console.log("model",model)
  const isSeedanceModel = ['seedance_v1', 'seedance_v2', 'seedance_fast'].includes(model);

  const isCloneModel = item?.inputs?.type === 'clone';
  const rawError = item?.results?.[0]?.error;

  const errorMessage =
    (isCloneModel || isSeedanceModel) && rawError
      ? rawError
      : videoStatus === 529
        ? 'This model is currently experiencing high demand ⏳. These spikes are usually temporary. Please try again in a little while. Note: Your credits were not deducted.'
        : videoStatus === 500
          ? 'The model was unable to generate the video. Please try again. Note: Your credits were not deducted.'
          : videoStatus === 400
            ? 'This video request was restricted for safety compliance. Please revise your input and try again. Note: Your credits were not deducted.'
            : 'An error occurred during video generation.';
  // const errorMessage = 'Model was unable to generate video.';
  const overlayTimeout = useRef(null);
  const [showInfo, setShowInfo] = useState(false);
  const infoTimeout = useRef(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef(null);
  const [isMuted, setIsMuted] = useState(true);
  const [volume, setVolume] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [activeNavIndex, setActiveNavIndex] = useState(videoIndex);
  const [activeVideoUrl, setActiveVideoUrl] = useState(item?.results?.[0]?.url ?? '');
  const [showControls, setShowControls] = useState(false);

  useEffect(() => {
    const url = item?.results?.[0]?.url ?? '';
    if (url && !activeVideoUrl) {
      setActiveVideoUrl(url);
    }
  }, [item?.results?.[0]?.url]);

  const dispatch = useDispatch();
  const [searchParams, setSearchParams] = useSearchParams();
  const { userData } = useSelector((state) => state.socket);
  const hasPlan8 = Object.keys(userData?.userSubscriptionType || {}).includes('8');

  // ── AI Ads version switching (voice regenerate) ──────────────────────────
  const isAiAds = item?.inputs?.type === 'ai_ads';
  const committedVersion = typeof item?.version === 'number' ? item.version : 0;
  const shownVersion = item?.previewVersion ?? committedVersion;
  const shownResult = item?.results?.[shownVersion] || item?.results?.[0];
  // Idempotent for server results (which keep waterMarkUrl); correct for the
  // socket-appended version (raw url).
  const pickUrl = (r) => (hasPlan8 ? r?.waterMarkUrl || r?.url : r?.url);
  const [regenOpen, setRegenOpen] = useState(false);

  // Point the player at the shown version's URL when it changes.
  useEffect(() => {
    if (!isAiAds) return;
    const u = pickUrl(item?.results?.[shownVersion]);
    if (u) setActiveVideoUrl(u);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAiAds, shownVersion, item?.results, hasPlan8]);

  const handlePreviewVersion = (idx) =>
    dispatch(setAiAdsPreviewVersion({ sessionId: item._id, previewVersion: idx }));
  const handleRevertVersion = () =>
    dispatch(setAiAdsPreviewVersion({ sessionId: item._id, previewVersion: null }));
  const handleKeepVersion = async (idx) => {
    try {
      await dispatch(selectAiAdsVersionAction(item._id, idx));
      dispatch(setAiAdsVersion({ sessionId: item._id, version: idx }));
    } catch {
      /* error already toasted by the thunk */
    }
  };
  // Prefer the shown version's stamped voice; fall back to the frozen original
  // inputs so legacy videos (generated before per-version aiAds existed) still
  // carry a valid voice for translate/rewrite.
  const currentVoiceForModal = {
    provider: shownResult?.aiAds?.voiceProvider || item?.inputs?.voiceProvider,
    voiceId: shownResult?.aiAds?.voiceId || item?.inputs?.voiceId,
    voiceName: shownResult?.aiAds?.voiceName || item?.inputs?.voiceName,
    language: shownResult?.aiAds?.language || item?.inputs?.voiceFilters?.language,
  };

  const isThisFullscreen = isFullscreen && (fullscreenIndex === videoIndex || fullscreenIndex === activeNavIndex);

  useEffect(() => {
    const handleFullscreenChange = () => {
      const active = !!(
        document.fullscreenElement ||
        document.webkitFullscreenElement ||
        document.mozFullScreenElement ||
        document.msFullscreenElement
      );
      setIsFullscreen(active);
      if (!active) {
        onFullscreenChange?.(null);
        setActiveNavIndex(videoIndex);
        setActiveVideoUrl(item?.results?.[0]?.url ?? '');
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('mozfullscreenchange', handleFullscreenChange);
    document.addEventListener('MSFullscreenChange', handleFullscreenChange);

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      document.removeEventListener('mozfullscreenchange', handleFullscreenChange);
      document.removeEventListener('MSFullscreenChange', handleFullscreenChange);
    };
  }, [videoIndex, onFullscreenChange]);

  // Show controls on activity in fullscreen; auto-hide after idle.
  useEffect(() => {
    if (!isThisFullscreen) {
      setShowControls(false);
      return;
    }
    let hideTimeout;
    const handleActivity = () => {
      setShowControls(true);
      clearTimeout(hideTimeout);
      hideTimeout = setTimeout(() => setShowControls(false), 2500);
    };
    window.addEventListener('mousemove', handleActivity);
    window.addEventListener('click', handleActivity);
    window.addEventListener('touchstart', handleActivity);
    handleActivity();
    return () => {
      window.removeEventListener('mousemove', handleActivity);
      window.removeEventListener('click', handleActivity);
      window.removeEventListener('touchstart', handleActivity);
      clearTimeout(hideTimeout);
    };
  }, [isThisFullscreen]);

  const showOverlayTemporarily = () => {
    setShowOverlay(true);

    clearTimeout(overlayTimeout.current);

    overlayTimeout.current = setTimeout(() => {
      setShowOverlay(false);
    }, 1500);
  };

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;

    if (video.paused) {
      video.play();
      setIsPlaying(true);
      setManuallyPaused(false);
    } else {
      video.pause();
      setIsPlaying(false);
      setManuallyPaused(true);
    }

    showOverlayTemporarily();
  };

  const handleHoverPlay = () => {
    const video = videoRef.current;
    if (!video || manuallyPaused) return;

    video.play();
    setIsPlaying(true);
  };

  const handleHoverPause = () => {
    const video = videoRef.current;
    if (!video || manuallyPaused || isFullscreen) return;

    video.pause();
    setIsPlaying(false);
  };

  const toggleMute = (e) => {
    e.stopPropagation();
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setIsMuted(video.muted);
    if (!video.muted && volume === 0) {
      setVolume(0.5);
      video.volume = 0.5;
    }
  };

  const handleVolumeChange = (e) => {
    e.stopPropagation();
    const newVolume = parseFloat(e.target.value);
    const video = videoRef.current;
    if (!video) return;
    video.volume = newVolume;
    setVolume(newVolume);
    if (newVolume > 0) {
      video.muted = false;
      setIsMuted(false);
    } else {
      video.muted = true;
      setIsMuted(true);
    }
  };

  const handleFullscreen = (e) => {
    e.stopPropagation();
    const container = containerRef.current;
    if (!container) return;

    if (!document.fullscreenElement) {
      onFullscreenChange?.(videoIndex);
      setActiveNavIndex(videoIndex);
      if (container.requestFullscreen) {
        container.requestFullscreen();
      } else if (container.webkitRequestFullscreen) {
        container.webkitRequestFullscreen();
      } else if (container.msRequestFullscreen) {
        container.msRequestFullscreen();
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      }
    }
  };

  const findCompletedIndex = (from, direction) => {
    let i = from + direction;
    while (i >= 0 && i < totalVideos) {
      const v = getVideoAt?.(i);
      if (v?.status === 'completed' && v?.results?.[0]?.url) return i;
      i += direction;
    }
    return -1;
  };

  const navigateTo = (targetIndex, videoOverride) => {
    const targetVideo = videoOverride ?? getVideoAt?.(targetIndex);
    if (!targetVideo) return;
    const newUrl = targetVideo.results[0].url;
    setActiveNavIndex(targetIndex);
    setActiveVideoUrl(newUrl);
    onFullscreenChange?.(targetIndex);
    const video = videoRef.current;
    if (video) {
      pendingPlayRef.current = true;
      video.src = `${S3_BASE_URL}${newUrl}`;
      video.currentTime = 0;
      setCurrentTime(0);
      setDuration(0);
    }
  };

  const handleNavPrev = (e) => {
    e.stopPropagation();
    const target = findCompletedIndex(activeNavIndex, -1);
    if (target === -1) return;
    navigateTo(target);
  };

  const handleNavNext = async (e) => {
    e.stopPropagation();
    let target = findCompletedIndex(activeNavIndex, 1);
    let videoOverride = null;
    if (target === -1 && hasMore) {
      const fetched = await onFetchMore?.();
      if (fetched?.length) {
        for (let i = 0; i < fetched.length; i++) {
          const v = fetched[i];
          if (v?.status === 'completed' && v?.results?.[0]?.url) {
            target = totalVideos + i;
            videoOverride = v;
            break;
          }
        }
      }
    }
    if (target === -1) return;
    navigateTo(target, videoOverride);
  };

  const hasPrev = isThisFullscreen && findCompletedIndex(activeNavIndex, -1) !== -1;
  const hasNext = isThisFullscreen && (findCompletedIndex(activeNavIndex, 1) !== -1 || hasMore);

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration);
    }
  };

  const handleSeek = (e) => {
    const time = parseFloat(e.target.value);
    if (videoRef.current) {
      videoRef.current.currentTime = time;
      setCurrentTime(time);
    }
  };

  const formatTime = (time) => {
    if (isNaN(time)) return '0:00';
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
  };

  const handleInfoEnter = () => {
    clearTimeout(infoTimeout.current);
    setShowInfo(true);
  };

  const handleInfoLeave = () => {
    infoTimeout.current = setTimeout(() => {
      setShowInfo(false);
    }, 150);
  };

  const InfoTooltip = () => (
    <div className="absolute top-3 right-3 z-30 flex items-center gap-2 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
      {item?.status === 'completed' && hasPlan8 && (
        <button
          className="flex items-center gap-2 rounded-full border border-white/40 px-4 py-1.5 text-[10px] font-medium text-white shadow-lg backdrop-blur-md transition-all hover:scale-105 active:scale-95 sm:text-xs"
          style={{
            background:
              'linear-gradient(90deg, rgba(235,225,190,0.35) 0%, rgba(215,190,245,0.35) 100%)',
            backdropFilter: 'blur(14px)',
            boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
            border: '1px solid rgba(255,255,255,0.35)',
          }}
          onClick={(e) => {
            e.stopPropagation();
            window.open(SIGNUP_URL, '_blank');
          }}
          title="Upgrade to Unlock HD & Remove Watermark"
        >
          <Crown size={12} className="text-[#f8efc8]" fill="currentColor" />
          <span className="tracking-wide whitespace-nowrap">Unlock HD & Remove Watermark</span>
        </button>
      )}

      <div className="relative" onMouseEnter={handleInfoEnter} onMouseLeave={handleInfoLeave}>
        <button
          className={`rounded-full p-2 text-gray-500 backdrop-blur hover:bg-black/10 dark:text-white dark:hover:bg-black/60 ${showInfo ? 'bg-black/10 dark:bg-black/60' : ''}`}
        >
          <Info size={18} />
        </button>

        {showInfo && (
          <>
            <div className="absolute top-full right-0 h-2 w-full" />
            <div className="absolute top-[calc(100%+0.25rem)] right-0 z-50 max-h-[130px] w-52 overflow-y-auto rounded-lg border border-black/10 bg-white p-3 text-xs text-gray-900 shadow-xl dark:border-transparent dark:bg-black/90 dark:text-white">
              <p>
                <span className="text-gray-400">Type:</span> {item?.inputs?.type || '-'}
              </p>
              <p>
                <span className="text-gray-400">Model:</span> {item?.inputs?.model || '-'}
              </p>
              <p>
                <span className="text-gray-400">Product:</span> {item?.inputs?.productName || '-'}
              </p>
              <p>
                <span className="text-gray-400">Duration:</span> {item?.inputs?.duration || '-'}
              </p>
              <p>
                <span className="text-gray-400">Aspect:</span> {item?.inputs?.aspectRatio || '-'}
              </p>

              {item?.inputs?.promotion && (
                <p>
                  <span className="text-gray-400">Promotion:</span> {item?.inputs?.promotion}
                </p>
              )}

              {item?.inputs?.notes && (
                <p>
                  <span className="text-gray-400">Notes:</span> {item?.inputs?.notes}
                </p>
              )}

              {item?.inputs?.productDescription && (
                <p className="mt-1">
                  <span className="text-gray-400">Description:</span>{' '}
                  {item?.inputs?.productDescription}
                </p>
              )}

              {item?.updatedAt && (
                <p className="mt-1">
                  <span className="text-gray-400">Time:</span>{' '}
                  {new Date(item.updatedAt).toLocaleString('en-IN', {
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

  // Hide the card entirely while a clone/avatar job is still generating its
  // script/image (status pending, nothing generated yet, nothing failed).
  // Once the script + image finish, the RESUME card shows; failures still show
  // the error state below.
  const isCloneOrAvatar = item?.inputs?.type === 'clone' || item?.inputs?.type === 'avatar';
  const isStillGeneratingScriptOrImage =
    isCloneOrAvatar &&
    item?.status === 'pending' &&
    item?.generatedImage !== 'failed' &&
    item?.generatedScript !== 'failed' &&
    (!item?.generatedImage || !item?.generatedScript);
  if (isStillGeneratingScriptOrImage) return null;

  return (
    <div className="group relative min-h-[250px] overflow-hidden rounded-2xl bg-gray-100 dark:bg-[#1f1f1f]">
      <InfoTooltip />

      {/* Selection Checkbox */}
      {item?.status === 'completed' && (
        <div
          className={`absolute top-3 left-3 z-30 transition-opacity duration-300 ${
            isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          }`}
          onClick={(e) => {
            e.stopPropagation();
            onSelect();
          }}
        >
          <div
            className={`flex h-6 w-6 cursor-pointer items-center justify-center rounded-md border-2 transition-all ${
              isSelected
                ? 'border-blue-600 bg-blue-600'
                : 'border-gray-400 bg-white hover:border-gray-600 dark:border-white/40 dark:bg-black/40 dark:hover:border-white'
            }`}
          >
            {isSelected && (
              <svg
                width="14"
                height="14"
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
        </div>
      )}

      {item?.status === 'processing' ? (
        <>
          <CreativeGeneratingLoader />

          <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 transform flex-col items-center justify-center">
            <p className="mt-4 text-sm whitespace-nowrap text-white">{item?.promptPercentage}%</p>
          </div>
        </>
      ) : item?.inputs?.type === 'avatar' &&
        item?.status === 'pending' &&
        item?.generatedImage !== 'failed' &&
        item?.generatedScript !== 'failed' ? (
        <div className="relative h-full w-full bg-black">
          <img
            src={
              item.generatedImage.startsWith('http')
                ? item.generatedImage
                : `${S3_BASE_URL}${item.generatedImage}`
            }
            alt="Generated Avatar"
            className="h-full w-full object-cover opacity-60"
          />
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/20 backdrop-blur-[2px]">
            <div className="flex flex-col items-center gap-2">
              <span className="rounded-full border border-yellow-500/30 bg-yellow-500/20 px-3 py-1 text-[10px] font-semibold tracking-wide text-yellow-500 uppercase backdrop-blur-md">
                Pending
              </span>
              <p className="text-[11px] font-medium text-white/80">Generation Incomplete</p>
            </div>
            <button
              onClick={(e) => {
                // console.log(item._id);
                e.stopPropagation();
                setSearchParams({ id: item._id }, { replace: true });
                dispatch(setActivePage('avatar'));
                dispatch(setAvatarStep('script'));
              }}
              className="group/resume flex items-center gap-2 rounded-full bg-white px-6 py-2.5 text-xs font-bold text-black transition-all hover:bg-blue-600 hover:text-white"
            >
              <RefreshCw
                size={14}
                className="transition-transform duration-500 group-hover/resume:rotate-180"
              />
              RESUME
            </button>
          </div>
        </div>
      ) : item?.inputs?.type === 'clone' &&
        item?.status === 'pending' &&
        item?.generatedImage !== 'failed' &&
        item?.generatedScript !== 'failed' ? (
        <div className="relative h-full w-full bg-black">
          <img
            src={
              item.generatedImage.startsWith('http')
                ? item.generatedImage
                : `${S3_BASE_URL}${item.generatedImage}`
            }
            alt="Generated Clone"
            className="h-full w-full object-cover opacity-60"
          />
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/20 backdrop-blur-[2px]">
            <div className="flex flex-col items-center gap-2">
              <span className="rounded-full border border-yellow-500/30 bg-yellow-500/20 px-3 py-1 text-10 font-semibold tracking-wide text-yellow-500 uppercase backdrop-blur-md">
                Pending
              </span>
              <p className="text-[11px] font-medium text-white/80">Generation Incomplete</p>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                // Clear any stale clone recreate payload first — otherwise the
                // CloneYourselfPage recreate effect bounces the resume from the
                // generated script back to the config form.
                dispatch(setRecreateInputs(null));
                // Seed the store with the card's already-loaded data so the
                // script step renders the image + script immediately instead of
                // showing loading while CloneYourselfPage re-fetches in the bg.
                dispatch(setImageAndScript(item));
                setSearchParams({ id: item._id }, { replace: true });
                dispatch(setActivePage('clone'));
                dispatch(setCloneStep('script'));
              }}
              className="group/resume flex items-center gap-2 rounded-full bg-white px-6 py-2.5 text-xs font-bold text-black transition-all hover:bg-blue-600 hover:text-white"
            >
              <RefreshCw
                size={14}
                className="transition-transform duration-500 group-hover/resume:rotate-180"
              />
              RESUME
            </button>
          </div>
        </div>
      ) : item?.inputs?.type === 'ai_ads' &&
        item?.status === 'pending' ? (
        <div className="relative h-full w-full bg-black">
          {item?.inputs?.images?.[0] ? (
            <img
              src={item.inputs.images[0]}
              alt="AI Ads Scene"
              className="h-full w-full object-cover opacity-60"
            />
          ) : (
            <div className="h-full w-full bg-[#1a1a1a]" />
          )}
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/20 backdrop-blur-[2px]">
            <div className="flex flex-col items-center gap-2">
              <span className="rounded-full border border-yellow-500/30 bg-yellow-500/20 px-3 py-1 text-[10px] font-semibold tracking-wide text-yellow-500 uppercase backdrop-blur-md">
                Pending
              </span>
              <p className="text-[11px] font-medium text-white/80">Generation Incomplete</p>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();

                // Set ?id= in URL so refresh re-fetches via GET /video/{id}
                const url = new URL(window.location.href);
                url.searchParams.set('id', item._id);
                window.history.replaceState(null, '', url.toString());

                if (item.scenes?.length > 0) {
                  dispatch(setAiAdsSceneData({
                    _id: item._id,
                    scenes: item.scenes,
                    totalSegments: item.totalSegments || item.scenes.length,
                    totalDuration: item.totalDuration,
                  }));
                  dispatch(setAiAdsSceneLoading(false));
                } else {
                  dispatch(setAiAdsSceneData({ _id: item._id, scenes: [], totalSegments: 4 }));
                  dispatch(setAiAdsSceneLoading(true));
                }
                dispatch(setAIAdsStep('generation'));
                dispatch(setActivePage('ai-ads'));
              }}
              className="group/resume flex items-center gap-2 rounded-full bg-white px-6 py-2.5 text-xs font-bold text-black transition-all hover:bg-blue-600 hover:text-white"
            >
              <RefreshCw
                size={14}
                className="transition-transform duration-500 group-hover/resume:rotate-180"
              />
              RESUME
            </button>
          </div>
        </div>
      ) : item?.status === 'completed' ? (
        <div ref={containerRef} className="relative h-full w-full bg-black">
          {!videoLoaded && <div className="absolute inset-0 z-10 animate-pulse bg-gray-200 dark:bg-[#1a1a1a]" />}
          <video
            ref={videoRef}
            src={`${S3_BASE_URL}${activeVideoUrl}`}
            className={`h-full w-full cursor-pointer transition-opacity duration-300 ${
              isThisFullscreen ? 'object-contain' : 'object-cover'
            } ${videoLoaded ? 'opacity-100' : 'opacity-0'} ${
              !isThisFullscreen ? 'max-h-[800px] rounded-2xl' : ''
            }`}
            preload="metadata"
            muted={isMuted}
            loop={!isThisFullscreen}
            playsInline
            onLoadedData={() => setVideoLoaded(true)}
            onCanPlay={() => {
              if (pendingPlayRef.current) {
                pendingPlayRef.current = false;
                videoRef.current?.play();
                setIsPlaying(true);
              }
            }}
            onMouseEnter={handleHoverPlay}
            onMouseLeave={handleHoverPause}
            onClick={togglePlay}
            onTimeUpdate={handleTimeUpdate}
            onLoadedMetadata={handleLoadedMetadata}
            onEnded={() => {
              if (isThisFullscreen) {
                setIsPlaying(false);
                clearTimeout(overlayTimeout.current);
                setShowOverlay(true);
              }
            }}
          />

          {/* Prev / Next navigation arrows — fullscreen only */}
          {isThisFullscreen && (
            <>
              {hasPrev && (
                <button
                  onClick={handleNavPrev}
                  className="absolute top-1/2 left-4 z-30 -translate-y-1/2 rounded-2xl border-2 border-white/30 bg-white/10 p-3 text-white shadow-[0_0_18px_rgba(255,255,255,0.15)] backdrop-blur-md transition-all duration-200 hover:scale-110 hover:border-white/70 hover:bg-white/25 hover:shadow-[0_0_28px_rgba(255,255,255,0.35)] active:scale-95"
                >
                  <ChevronLeft size={28} strokeWidth={2.5} />
                </button>
              )}
              {hasNext && (
                <button
                  onClick={handleNavNext}
                  className="absolute top-1/2 right-4 z-30 -translate-y-1/2 rounded-2xl border-2 border-white/30 bg-white/10 p-3 text-white shadow-[0_0_18px_rgba(255,255,255,0.15)] backdrop-blur-md transition-all duration-200 hover:scale-110 hover:border-white/70 hover:bg-white/25 hover:shadow-[0_0_28px_rgba(255,255,255,0.35)] active:scale-95"
                >
                  <ChevronRight size={28} strokeWidth={2.5} />
                </button>
              )}
            </>
          )}

          {/* AI Ads: voice-regen overlay — the video stays visible underneath */}
          {isAiAds && item?.regenState === 'processing' && (
            <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-black/60 backdrop-blur-sm">
              <RefreshCw className="animate-spin text-white" size={28} />
              <p className="text-sm text-white">Merging video…</p>
            </div>
          )}

          {/* AI Ads: version switcher (only when more than one version exists) */}
          {isAiAds && (item?.results?.length || 0) > 1 && (
            <VideoVersionControls
              results={item.results}
              shownVersion={shownVersion}
              committedVersion={committedVersion}
              onPreview={handlePreviewVersion}
              onRevert={handleRevertVersion}
              onKeep={handleKeepVersion}
            />
          )}

          {/* Controls Bar */}
          <div
            className={`absolute right-0 bottom-0 left-0 z-20 flex flex-col gap-3 bg-gradient-to-t from-black/90 via-black/40 to-transparent p-4 pt-10 transition-opacity duration-300 ${isThisFullscreen ? (showControls ? 'opacity-100' : 'opacity-0 pointer-events-none') : 'opacity-0 group-hover:opacity-100'}`}
          >
            {isThisFullscreen && (
              <div className="flex items-center gap-3 px-2">
                <span className="min-w-[32px] text-[10px] font-medium text-white/80 tabular-nums">
                  {formatTime(currentTime)}
                </span>
                <div className="group/seek relative flex flex-grow items-center">
                  <input
                    type="range"
                    min="0"
                    max={duration || 0}
                    step="0.1"
                    value={currentTime}
                    onChange={handleSeek}
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      background: `linear-gradient(to right, #3b82f6 0%, #3b82f6 ${
                        (currentTime / (duration || 1)) * 100
                      }%, rgba(255, 255, 255, 0.2) ${
                        (currentTime / (duration || 1)) * 100
                      }%, rgba(255, 255, 255, 0.2) 100%)`,
                    }}
                    className="h-1 w-full cursor-pointer appearance-none rounded-lg accent-white transition-all group-hover/seek:h-1.5"
                  />
                </div>
                <span className="min-w-[32px] text-right text-[10px] font-medium text-white/80 tabular-nums">
                  {formatTime(duration)}
                </span>
              </div>
            )}

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4 px-2">
                <button
                  onClick={togglePlay}
                  className="p-1 text-white/90 transition-colors hover:text-white"
                >
                  {isPlaying ? (
                    <Pause size={20} fill="currentColor" />
                  ) : (
                    <Play size={20} fill="currentColor" />
                  )}
                </button>
              </div>

              <div className="flex items-center gap-1">
                {SHOW_POST_AD_NAV && item?.status === 'completed' && onOpenPostAdModal && (
                  <button
                    title="Post as ad"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenPostAdModal({
                        url: shownResult?.url,
                        isVideo: true,
                        prompt:
                          item?.inputs?.userPrompt ||
                          item?.inputs?.prompt ||
                          item?.inputs?.productDescription ||
                          '',
                        item,
                      });
                    }}
                    className="rounded-full p-2 text-white/90 backdrop-blur transition-colors hover:bg-white/10"
                  >
                    <Megaphone size={18} />
                  </button>
                )}
                {isAiAds && (
                  <button
                    title="Regenerate voice"
                    onClick={(e) => {
                      e.stopPropagation();
                      setRegenOpen(true);
                    }}
                    className="rounded-full p-2 text-white/90 backdrop-blur transition-colors hover:bg-white/10"
                  >
                    <RefreshCw size={18} />
                  </button>
                )}
                <div className="group/volume relative flex items-center">
                  <button
                    onClick={toggleMute}
                    className="rounded-full p-2 text-white/90 backdrop-blur transition-colors hover:bg-white/10"
                  >
                    {isMuted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
                  </button>
                  {/* Vertical (up/down) volume slider — same thin white slider
                      as before, just oriented vertically and floated above the
                      mute icon on hover. `pb-2` is an invisible hover bridge so
                      the slider doesn't vanish when the cursor moves up to it. */}
                  <div className="invisible absolute bottom-full left-1/2 z-20 flex -translate-x-1/2 justify-center pb-2 opacity-0 transition-opacity duration-200 group-hover/volume:visible group-hover/volume:opacity-100">
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.1"
                      value={isMuted ? 0 : volume}
                      onChange={handleVolumeChange}
                      onClick={(e) => e.stopPropagation()}
                      style={{ writingMode: 'vertical-lr', direction: 'rtl' }}
                      className="h-24 w-1 cursor-pointer appearance-none rounded-lg bg-white/30 accent-white"
                    />
                  </div>
                </div>

                <button
                  className="rounded-full p-2 text-white/90 backdrop-blur transition-colors hover:bg-white/10"
                  onClick={(e) => {
                    e.stopPropagation();
                    const type = item?.inputs?.type || 'broll';
                    let targetPage = 'b-roll';
                    if (type === 'ugc') targetPage = 'ugc';
                    else if (type === 'avatar') targetPage = 'avatar';
                    else if (type === 'clone') targetPage = 'clone';
                    else if (type === 'ai_ads') targetPage = 'ai-ads';

                    if (type === 'ai_ads') {
                      const url = new URL(window.location.href);
                      url.searchParams.delete('id');
                      window.history.replaceState(null, '', url.toString());
                      if (item.scenes?.length > 0) {
                        dispatch(setAiAdsSceneData({ _id: item._id, scenes: item.scenes }));
                      }
                      dispatch(setAIAdsStep('details'));
                      dispatch(setActivePage(targetPage));
                      dispatch(setAiAdsPrefillInputs(item.inputs));
                      return;
                    }

                    dispatch(setRecreateInputs(item.inputs));
                    dispatch(setActivePage(targetPage));
                    if (type === 'avatar') {
                      dispatch(setAvatarStep('config'));
                    }
                    if (type === 'ugc' || type === 'broll') {
                      setTimeout(() => emitter.emit('recreate-video', item.inputs), 100);
                    }
                  }}
                  title="Recreate Video"
                >
                  <Edit size={18} />
                </button>

                <button
                  onClick={handleFullscreen}
                  className="rounded-full p-2 text-white/90 backdrop-blur transition-colors hover:bg-white/10"
                >
                  <Maximize size={18} />
                </button>

                <button
                  className="rounded-full p-2 text-white/90 backdrop-blur transition-colors hover:bg-white/10"
                  onClick={() => dispatch(downloadMediaFromUrl(`${shownResult?.url}`))}
                >
                  <Download size={18} />
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="relative flex h-full min-h-[250px] flex-col items-center justify-center p-4 text-center">
          {videoStatus ? (
            <p className="mt-2 text-xs text-gray-400">{errorMessage}</p>
          ) : (
            <p className="mt-2 text-xs text-gray-400">An error occurred during video generation.</p>
          )}
          <button
            className="absolute right-3 bottom-3 rounded-full p-2 text-gray-500 backdrop-blur transition-colors hover:bg-black/5 hover:text-black dark:text-white/70 dark:hover:bg-white/10 dark:hover:text-white"
            onClick={(e) => {
              e.stopPropagation();
              const type = item?.inputs?.type || 'broll';
              let targetPage = 'b-roll';
              if (type === 'ugc') targetPage = 'ugc';
              else if (type === 'avatar') targetPage = 'avatar';
              else if (type === 'clone') targetPage = 'clone';
              else if (type === 'ai_ads') targetPage = 'ai-ads';

              if (type === 'ai_ads') {
                const url = new URL(window.location.href);
                url.searchParams.delete('id');
                window.history.replaceState(null, '', url.toString());
                if (item.scenes?.length > 0) {
                  dispatch(setAiAdsSceneData({ _id: item._id, scenes: item.scenes }));
                }
                dispatch(setAIAdsStep('details'));
                dispatch(setActivePage(targetPage));
                dispatch(setAiAdsPrefillInputs(item.inputs));
                return;
              }

              dispatch(setRecreateInputs(item.inputs));
              dispatch(setActivePage(targetPage));
              if (type === 'avatar') {
                dispatch(setAvatarStep('config'));
              }
              if (type === 'ugc' || type === 'broll') {
                setTimeout(() => emitter.emit('recreate-video', item.inputs), 100);
              }
            }}
            title="Recreate Video"
          >
            <Edit size={18} />
          </button>
        </div>
      )}

      {isAiAds && (
        <RegenerateVoiceModal
          open={regenOpen}
          onOpenChange={setRegenOpen}
          sessionId={item._id}
          currentVoice={currentVoiceForModal}
        />
      )}
    </div>
  );
}
