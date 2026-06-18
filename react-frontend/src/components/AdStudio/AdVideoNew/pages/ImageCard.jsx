import { useEffect, useRef, useState } from 'react';
import {
  Download,
  Edit,
  Info,
  ChevronLeft,
  ChevronRight,
  Megaphone,
} from 'lucide-react';
import CreativeGeneratingLoader from '../../AdCreatives/CreativeChat/Loader/CreativeGeneratingLoader';
import { downloadMediaFromUrl } from '@/store/actions/adVideoNew/Advideoactions';
import { useDispatch, useSelector } from 'react-redux';
import { setImageRecreateInputs } from '@/store/reducers/image/imageSlice';
import {
  setActiveAdStudioTab,
  setAdCreativeNewActivePage,
} from '@/store/reducers/adStudio/adStudioTabsSlice';
import { checkCanvaAuth } from '@/apis/canva/canvaApi';
import canvaIconLogo from '@/assets/layouts/Canva Icon logo_32x32.png';

const CANVA_CLIENT_ID = import.meta.env.VITE_CANVA_CLIENT_ID;
const CANVA_REDIRECT_URI = import.meta.env.VITE_CANVA_REDIRECT_URI;
const CANVA_SCOPES = import.meta.env.VITE_CANVA_SCOPES;
const CANVA_ENABLED = import.meta.env.VITE_ENABLE_CANVA === 'true';
const BACKEND_URL = import.meta.env.VITE_SOCKET_URL;

// HIDE-MARK — Post Ad nav (Megaphone) is intentionally hidden. Named flag
// avoids a literal `false &&` (no-constant-binary-expression); flip to re-enable.
const SHOW_POST_AD_NAV = false;

// Backend `inputs.type` → AdCreativeNewLayout route key. NOTE:
// `recreate_ads` is intentionally NOT in this map — recreating one of
// those re-opens the AdLibrary RecreateAdModal (handled separately below).
const IMAGE_TYPE_TO_ROUTE = {
  ai_ads: 'ai-creatives',
  lifestyle: 'lifestyle',
  product_shot: 'product-shot',
  apps_saas: 'apps-saas',
  brand_awareness: 'brand-awareness',
};

// A record's `inputs.aspectRatioPerImage` may carry several entries (e.g.
// 1×"1:1" + 1×"2:3"). MyImagesPage fans the record out one card per result;
// this helper finds the aspect entry that produced THIS card. Tries a
// direct _id match first (in case the backend stamps the entry's _id onto
// the result), then falls back to expanding the array by numberOfImages and
// indexing by the card's _resultIndex.
function findAspectEntryForCard(item) {
  const arpi = item?.inputs?.aspectRatioPerImage;
  if (!Array.isArray(arpi) || arpi.length === 0) return null;

  const result = item?.results?.[0];
  const resultId =
    result?._id || result?.aspectRatioId || result?.aspectId || null;
  if (resultId) {
    const direct = arpi.find((a) => a?._id === resultId);
    if (direct) return direct;
  }

  const idx = typeof item?._resultIndex === 'number' ? item._resultIndex : 0;
  let acc = 0;
  for (const entry of arpi) {
    const count = Number(entry?.numberOfImages) || 0;
    if (idx < acc + count) return entry;
    acc += count;
  }
  return null;
}

const S3_BASE_URL = import.meta.env.VITE_S3_BASE_URL;

const resolveImageUrl = (url) => {
  if (!url) return '';
  return url.startsWith('http') ? url : `${S3_BASE_URL}${url}`;
};

export default function ImageCard({
  item,
  isSelected,
  onSelect,
  imageIndex,
  fullscreenIndex,
  onFullscreenChange,
  totalImages,
  getImageAt,
  hasMore,
  onFetchMore,
  onOpenRecreateAdsModal,
  onOpenPostAdModal,
}) {
  const dispatch = useDispatch();
  const userId = useSelector((state) => state.socket?.userData?.user_id);
  const containerRef = useRef(null);
  const [showInfo, setShowInfo] = useState(false);
  const infoTimeout = useRef(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [activeNavIndex, setActiveNavIndex] = useState(imageIndex);
  const [activeImageUrl, setActiveImageUrl] = useState(item?.results?.[0]?.url ?? '');
  const [canvaLoading, setCanvaLoading] = useState(false);

  const handleEditWithCanva = async (e) => {
    e.stopPropagation();
    const imageUrl = item?.results?.[0]?.url;
    if (!imageUrl) return;
    setCanvaLoading(true);
    try {
      const result = await checkCanvaAuth(imageUrl);
      if (result.status) {
        window.location.href = `${BACKEND_URL}/adsgpt/canva/v2/upload?id=${userId}&url=${encodeURIComponent(imageUrl)}`;
      } else {
        const { state, codeChallenge } = result;
        const params = new URLSearchParams({
          response_type: 'code',
          client_id: CANVA_CLIENT_ID,
          redirect_uri: CANVA_REDIRECT_URI,
          scope: CANVA_SCOPES,
          state,
          code_challenge: codeChallenge,
          code_challenge_method: 'S256',
        });
        window.location.href = `https://www.canva.com/api/oauth/authorize?${params.toString()}`;
      }
      // keep loading=true — redirect is in progress, spinner stays until page unloads
    } catch (err) {
      console.error('Canva auth error:', err);
      setCanvaLoading(false);
    }
  };

  const isThisFullscreen =
    isFullscreen && (fullscreenIndex === imageIndex || fullscreenIndex === activeNavIndex);

  const imageStatus = item?.results?.[0]?.imageStatus;
  const errorMessage =
    imageStatus === 529
      ? 'This model is currently experiencing high demand ⏳. These spikes are usually temporary. Please try again in a little while. Note: Your credits were not deducted.'
      : imageStatus === 500
        ? 'The model was unable to generate the image. Please try again. Note: Your credits were not deducted.'
        : imageStatus === 400
          ? 'This image request was restricted for safety compliance. Please revise your input and try again. Note: Your credits were not deducted.'
          : 'An error occurred during image generation.';

  useEffect(() => {
    const url = item?.results?.[0]?.url ?? '';
    if (url && !activeImageUrl) {
      setActiveImageUrl(url);
    }
  }, [item?.results?.[0]?.url]);

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
        setActiveNavIndex(imageIndex);
        setActiveImageUrl(item?.results?.[0]?.url ?? '');
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
    // item url is in deps so closing fullscreen reads the current url, not the
    // empty value captured at mount when the record was still pending.
  }, [imageIndex, onFullscreenChange, item?.results?.[0]?.url]);

  const handleFullscreen = (e) => {
    e.stopPropagation();
    const container = containerRef.current;
    if (!container) return;

    if (!document.fullscreenElement) {
      onFullscreenChange?.(imageIndex);
      setActiveNavIndex(imageIndex);
      if (container.requestFullscreen) {
        container.requestFullscreen();
      } else if (container.webkitRequestFullscreen) {
        container.webkitRequestFullscreen();
      } else if (container.msRequestFullscreen) {
        container.msRequestFullscreen();
      }
    } else if (document.exitFullscreen) {
      document.exitFullscreen();
    }
  };

  const findCompletedIndex = (from, direction) => {
    let i = from + direction;
    while (i >= 0 && i < totalImages) {
      const v = getImageAt?.(i);
      if (v?.status === 'completed' && v?.results?.[0]?.url) return i;
      i += direction;
    }
    return -1;
  };

  const navigateTo = (targetIndex, imageOverride) => {
    const targetImage = imageOverride ?? getImageAt?.(targetIndex);
    if (!targetImage) return;
    const newUrl = targetImage.results[0].url;
    setActiveNavIndex(targetIndex);
    setActiveImageUrl(newUrl);
    onFullscreenChange?.(targetIndex);
    setImageLoaded(false);
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
    let imageOverride = null;
    if (target === -1 && hasMore) {
      const fetched = await onFetchMore?.();
      if (fetched?.length) {
        for (let i = 0; i < fetched.length; i++) {
          const v = fetched[i];
          if (v?.status === 'completed' && v?.results?.[0]?.url) {
            target = totalImages + i;
            imageOverride = v;
            break;
          }
        }
      }
    }
    if (target === -1) return;
    navigateTo(target, imageOverride);
  };

  const hasPrev = isThisFullscreen && findCompletedIndex(activeNavIndex, -1) !== -1;
  const hasNext = isThisFullscreen && (findCompletedIndex(activeNavIndex, 1) !== -1 || hasMore);

  // Shared recreate flow — used by both the success-state hover bar and the
  // failed-state hover bar. Tailors inputs to one image at the card's
  // matched aspect, then either hands off to the AdLibrary RecreateAdModal
  // (for `recreate_ads`) or routes to the appropriate AdCreativeNew editor.
  const handleRecreate = (e) => {
    e.stopPropagation();
    const type = item?.inputs?.type;
    const matched = findAspectEntryForCard(item);
    const aspect = matched?.aspectRatio || item.inputs?.aspectRatio || '1:1';
    const tailored = {
      ...item.inputs,
      aspectRatio: aspect,
      numberOfImages: 1,
      aspectRatioPerImage: [{ aspectRatio: aspect, numberOfImages: 1 }],
    };
    if (type === 'recreate_ads') {
      dispatch(setImageRecreateInputs(tailored));
      onOpenRecreateAdsModal?.(tailored);
      return;
    }
    const targetRoute = IMAGE_TYPE_TO_ROUTE[type];
    if (!targetRoute) return;
    dispatch(setImageRecreateInputs(tailored));
    dispatch(setActiveAdStudioTab('adCreativeNew'));
    dispatch(setAdCreativeNewActivePage(targetRoute));
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
      <div className="relative" onMouseEnter={handleInfoEnter} onMouseLeave={handleInfoLeave}>
        <button
          className={`rounded-full p-2 text-gray-100 dark:text-white backdrop-blur hover:bg-black/60 ${showInfo ? 'bg-black/60' : ''}`}
        >
          <Info size={18} />
        </button>

        {showInfo && (
          <>
            <div className="absolute top-full right-0 h-2 w-full" />
            <div className="absolute top-[calc(100%+0.25rem)] right-0 z-50 max-h-[130px] w-52 overflow-y-auto rounded-lg border border-black/10 bg-white p-3 text-xs text-gray-900 shadow-xl dark:border-transparent dark:bg-black/90 dark:text-white">
              <p>
                <span className="text-gray-400">Type:</span>{' '}
                {item?.creativeType || item?.inputs?.type || '-'}
              </p>
              <p>
                <span className="text-gray-400">Model:</span>{' '}
                {item?.inputs?.modelLabel || item?.inputs?.model || '-'}
              </p>
              {/* //Hidden quality mark from tooltip here */}
              {/* <p>
                <span className="text-gray-400">Quality:</span>{' '}
                {(() => {
                  // Records created before the quality field existed won't
                  // carry it — fall back to the backend default of "medium".
                  const q = item?.inputs?.quality || 'medium';
                  return q.charAt(0).toUpperCase() + q.slice(1);
                })()}
              </p> */}
              {item?.inputs?.brandName && (
                <p>
                  <span className="text-gray-400">Brand:</span> {item.inputs.brandName}
                </p>
              )}
              {item?.inputs?.productName && (
                <p>
                  <span className="text-gray-400">Product:</span> {item.inputs.productName}
                </p>
              )}
              <p>
                <span className="text-gray-400">Aspect:</span>{' '}
                {findAspectEntryForCard(item)?.aspectRatio || item?.inputs?.aspectRatio || '-'}
              </p>
              {item?.inputs?.numberOfImages && (
                <p>
                  <span className="text-gray-400">Variations:</span> {item.inputs.numberOfImages}
                </p>
              )}
              {(item?.inputs?.userPrompt || item?.inputs?.prompt) && (
                <p className="mt-1">
                  <span className="text-gray-400">Prompt:</span>{' '}
                  {item.inputs.userPrompt || item.inputs.prompt}
                </p>
              )}
              {item?.inputs?.instructions && (
                <p className="mt-1">
                  <span className="text-gray-400">Instructions:</span> {item.inputs.instructions}
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
                : 'border-gray-400 bg-white hover:border-gray-600 hover:bg-black/5 dark:border-white/40 dark:bg-black/40 dark:hover:border-white dark:hover:bg-black/40'
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

      {item?.status === 'processing' || item?.status === 'pending' ? (
        <>
          <CreativeGeneratingLoader />
          {item?.promptPercentage !== undefined && (
            <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 transform flex-col items-center justify-center">
              <p className="mt-4 text-sm whitespace-nowrap text-white">{item.promptPercentage}%</p>
            </div>
          )}
        </>
      ) : item?.status === 'completed' ? (
        <div ref={containerRef} className="relative h-full w-full bg-black">
          {!imageLoaded && <div className="absolute inset-0 z-10 animate-pulse bg-gray-200 dark:bg-[#1a1a1a]" />}
          <img
            src={resolveImageUrl(activeImageUrl)}
            alt="Generated"
            onClick={!isThisFullscreen ? handleFullscreen : undefined}
            className={`h-full w-full transition-opacity duration-300 ${
              isThisFullscreen ? 'object-contain' : 'cursor-pointer object-cover'
            } ${imageLoaded ? 'opacity-100' : 'opacity-0'} ${
              !isThisFullscreen ? 'max-h-[800px] rounded-2xl' : ''
            }`}
            onLoad={() => setImageLoaded(true)}
          />

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

          {/* Controls Bar — fullscreen now lives on the image itself */}
          <div className="absolute right-0 bottom-0 left-0 z-20 flex items-center justify-end gap-1 bg-gradient-to-t from-black/90 via-black/40 to-transparent p-4 pt-10 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
            {/* HIDE-MARK — Post as ad (Megaphone) hidden via SHOW_POST_AD_NAV. */}
            {SHOW_POST_AD_NAV && onOpenPostAdModal && (
              <button
                title="Post as ad"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenPostAdModal({
                    url: item?.results?.[0]?.url,
                    isVideo: false,
                    prompt: item?.inputs?.userPrompt || item?.inputs?.prompt || '',
                    item,
                  });
                }}
                className="rounded-full p-2 text-white/90 backdrop-blur transition-colors hover:bg-white/10"
              >
                <Megaphone size={18} />
              </button>
            )}
            <button
              className="rounded-full p-2 text-white/90 backdrop-blur transition-colors hover:bg-white/10"
              onClick={handleRecreate}
              title="Recreate Image"
            >
              <Edit size={18} />
            </button>
            {CANVA_ENABLED && (
            <button
              className="group flex items-center gap-1 rounded-full px-2 py-1.5 text-xs font-medium text-white/90 backdrop-blur transition-colors hover:bg-white/10 disabled:opacity-50"
              onClick={handleEditWithCanva}
              disabled={canvaLoading}
              title="Edit in Canva"
            >
              {canvaLoading ? (
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
              ) : (
                <img src={canvaIconLogo} alt="" className="h-4 w-4 shrink-0" aria-hidden="true" />
              )}
              <span className="max-w-0 overflow-hidden whitespace-nowrap transition-all duration-300 group-hover:max-w-20">
                Edit in Canva
              </span>
            </button>
            )}
            <button
              className="rounded-full p-2 text-white/90 backdrop-blur transition-colors hover:bg-white/10"
              onClick={(e) => {
                e.stopPropagation();
                dispatch(downloadMediaFromUrl(`${item?.results?.[0]?.url}`, 'image'));
              }}
            >
              <Download size={18} />
            </button>
          </div>
        </div>
      ) : (
        // Error / failed state. Recreate is offered here too — the original
        // inputs are still on the record, so we can re-open the editor with
        // them pre-filled. Mirrors the success-state hover bar but with no
        // download / post-ad actions (no image to act on).
        <div className="relative flex h-full min-h-[250px] flex-col items-center justify-center p-4 text-center">
          <p className="mt-2 text-xs text-gray-400">{errorMessage}</p>

          <div className="absolute right-0 bottom-0 left-0 z-20 flex items-center justify-end gap-1 bg-linear-to-t from-black/90 via-black/40 to-transparent p-4 pt-10 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
            <button
              className="rounded-full p-2 text-white/90 backdrop-blur transition-colors hover:bg-white/10"
              onClick={handleRecreate}
              title="Recreate Image"
            >
              <Edit size={18} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
