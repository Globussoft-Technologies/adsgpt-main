import Masonry from 'react-masonry-css';
import { Download, Info, Megaphone, Pencil, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  downloadMediaFromUrl,
  downloadMediaZipAction,
} from '@/store/actions/adVideoNew/Advideoactions';
import {
  getAdFactoryImages,
  saveEditedAdFactoryImage,
} from '@/apis/adFactory/adFactoryImagesApi';
import { emitWhenConnected } from '@/utils/socketEmitter';
import emitter from '@/utils/eventEmitter';
import { mergeCampaignImageResults } from './adFactoryImagesMerge';
import CreativeGeneratingLoader from '../../AdCreatives/CreativeChat/Loader/CreativeGeneratingLoader';
import PostAdMySpaceModal from '../PostAdMySpace/PostAdMySpaceModal';
import { readPendingPostAd } from '../PostAdMySpace/postAdPersistence';
import MySpaceLogoEditor, { proxied as proxiedImageUrl } from './MySpaceLogoEditor';
import { useCanvaEdit } from '@/hooks/useCanvaEdit';
import canvaIconLogo from '@/assets/layouts/Canva Icon logo_32x32.png';

const breakpointColumnsObj = {
  default: 4,
  1280: 3,
  1024: 3,
  700: 2,
  340: 1,
};

const STALE_GENERATING_MS = 10 * 60 * 1000;

// Post Ad nav (Megaphone) visibility. Flip to false to hide the
// "Post as ad" trigger on MySpace cards.
const SHOW_POST_AD_NAV = true;

const S3_BASE_URL = import.meta.env.VITE_S3_BASE_URL;

const resolveImageUrl = (url) => {
  if (!url) return '';
  return url.startsWith('http') ? url : `${S3_BASE_URL}${url}`;
};

function isStaleGenerating(item, now) {
  if (item?.status !== 'generating') return false;
  const timestampMs = item?.timestamp ? new Date(item.timestamp).getTime() : 0;
  return timestampMs > 0 && now - timestampMs > STALE_GENERATING_MS;
}

function deriveDisplayItem(item, now) {
  if (!isStaleGenerating(item, now)) return item;

  return {
    ...item,
    status: 'error',
    error: item?.error || 'We could not generate this image right now. Please try again. Note: Your credits were not deducted.',
  };
}

// ── Single card ─────────────────────────────────────────────────────────────
function AdFactoryImageCard({ item, isSelected, onSelect, onFullscreen, onOpenPostAdModal, onOpenLogoEditor }) {
  const dispatch = useDispatch();
  const { editInCanva, isCanvaLoading } = useCanvaEdit();
  const [showInfo, setShowInfo] = useState(false);
  const infoTimeout = useRef(null);
  const [imageLoaded, setImageLoaded] = useState(false);

  const url = resolveImageUrl(item?.url);
  const isGenerating = item?.status === 'generating';
  const isError = item?.status === 'error';

  const handleInfoEnter = () => {
    clearTimeout(infoTimeout.current);
    setShowInfo(true);
  };
  const handleInfoLeave = () => {
    infoTimeout.current = setTimeout(() => setShowInfo(false), 150);
  };

  const InfoTooltip = () => (
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
              {item?.campaignName && (
                <p>
                  <span className="text-gray-400">Campaign:</span> {item.campaignName}
                </p>
              )}
              {(item?.modelLabel || item?.model) && (
                <p className="mt-1">
                  <span className="text-gray-400">Model:</span> {item.modelLabel || item.model}
                </p>
              )}
              {item?.aspectRatio && (
                <p className="mt-1">
                  <span className="text-gray-400">Aspect ratio:</span> {item.aspectRatio}
                </p>
              )}
              {item?.timestamp && (
                <p className="mt-1">
                  <span className="text-gray-400">Time:</span>{' '}
                  {new Date(item.timestamp).toLocaleString('en-IN', {
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
    <div className="my-space-media-card group relative min-h-[250px] overflow-hidden rounded-2xl bg-gray-100 dark:bg-[#1f1f1f]">
      <InfoTooltip />

      {/* Selection checkbox — only for completed images */}
      {!isGenerating && !isError && url && (
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
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" className="text-white">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </div>
        </div>
      )}

      {isGenerating ? (
        <CreativeGeneratingLoader />
      ) : isError || !url ? (
        <div className="relative flex h-full min-h-[250px] flex-col items-center justify-center p-4 text-center">
          <p className="mt-2 text-xs text-gray-400">
            {item?.error || 'We could not generate this image right now. Please try again. Note: Your credits were not deducted.'}
          </p>
        </div>
      ) : (
        <div className="relative h-full w-full bg-black">
          {!imageLoaded && <div className="absolute inset-0 z-10 animate-pulse bg-gray-200 dark:bg-[#1a1a1a]" />}
          <img
            src={url}
            alt="AdFactory generated"
            onClick={() => onFullscreen(url)}
            className={`h-full w-full max-h-[800px] cursor-pointer rounded-2xl object-cover transition-opacity duration-300 ${
              imageLoaded ? 'opacity-100' : 'opacity-0'
            }`}
            onLoad={() => setImageLoaded(true)}
          />
          {/* Controls bar */}
          <div className="absolute right-0 bottom-0 left-0 z-20 flex items-center justify-end gap-1 bg-gradient-to-t from-black/90 via-black/40 to-transparent p-4 pt-10 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
            {onOpenLogoEditor && (
              <button
                title="Add logo"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenLogoEditor(item, item?.url);
                }}
                className="rounded-full p-2 text-white/90 backdrop-blur transition-colors hover:bg-white/10"
              >
                <Pencil size={18} />
              </button>
            )}
            {SHOW_POST_AD_NAV && onOpenPostAdModal && (
              <button
                title="Post as ad"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenPostAdModal({
                    url: item?.url,
                    isVideo: false,
                    prompt: item?.campaignName || '',
                    item,
                  });
                }}
                className="rounded-full p-2 text-white/90 backdrop-blur transition-colors hover:bg-white/10"
              >
                <Megaphone size={18} />
              </button>
            )}
            <button
              className="group flex items-center gap-1 rounded-full px-2 py-1.5 text-xs font-medium text-white/90 backdrop-blur transition-colors hover:bg-white/10 disabled:opacity-50"
              onClick={(e) => editInCanva(url, e)}
              disabled={isCanvaLoading(url)}
              title="Edit in Canva"
            >
              {isCanvaLoading(url) ? (
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
            <button
              className="rounded-full p-2 text-white/90 backdrop-blur transition-colors hover:bg-white/10"
              onClick={(e) => {
                e.stopPropagation();
                dispatch(downloadMediaFromUrl(`${item?.url}`, 'image'));
              }}
              title="Download"
            >
              <Download size={18} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────
export default function MyAdFactoryImagesPage({ startDate = '', endDate = '' }) {
  const dispatch = useDispatch();
  const { userData } = useSelector((state) => state?.socket) || {};
  const userId = userData?.user_id;

  const [items, setItems] = useState([]);
  const [now, setNow] = useState(() => Date.now());
  const [isLoading, setIsLoading] = useState(false);
  const [skip, setSkip] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [selectedImages, setSelectedImages] = useState([]);
  // Lightbox carries both the URL (for download) and the source item
  // (for the logo-editor save handler, which records lineage onto a
  // brand-new MySpace record).
  const [fullscreen, setFullscreen] = useState(null); // { url, item } | null
  const fullscreenUrl = fullscreen?.url || null;
  const fullscreenItem = fullscreen?.item || null;
  const closeFullscreen = () => setFullscreen(null);

  // Logo editor state — opened from inside the lightbox. We close the
  // lightbox before mounting the editor so the editor's overlay isn't
  // stacked behind the lightbox.
  const [logoEditorOpen, setLogoEditorOpen] = useState(false);
  const [logoEditorItem, setLogoEditorItem] = useState(null);

  const handleOpenLogoEditor = (item, url) => {
    if (!url) return;
    closeFullscreen();
    // Preload the proxied URL so Konva's useImage hits the HTTP cache
    // on mount — same trick as the regular MySpace lightbox.
    try {
      const preload = new Image();
      preload.crossOrigin = 'anonymous';
      preload.src = proxiedImageUrl(resolveImageUrl(url));
    } catch {
      // Best-effort; if it fails the editor just resolves the image
      // on its own timeline (no regression vs. no preload).
    }
    setLogoEditorItem(item);
    setLogoEditorOpen(true);
  };

  const handleLogoSaved = async (newUrl) => {
    // Backend = `saveEditedAdImage` in nodejs-backend/controllers/adFactory.js.
    // Pushes the new image to the campaign's results AND to the saved
    // gallery so it shows up everywhere this campaign surfaces.
    if (!logoEditorItem?.campaignId || !userId) return;

    // Optimistic insert — prepend the new image to `items` so the
    // user sees it instantly. Same shape that mergeCampaignImageResults
    // produces, so the grid renders it without special-casing. If the
    // backend save fails we roll back below.
    const optimisticItem = {
      url: newUrl,
      prompt: 'Edited image',
      model: logoEditorItem.model || null,
      modelLabel: logoEditorItem.modelLabel || logoEditorItem.model || null,
      status: 'success',
      error: null,
      aspectRatio: logoEditorItem.aspectRatio || null,
      campaignId: logoEditorItem.campaignId,
      campaignName: logoEditorItem.campaignName || null,
      jobId: null,
      origin: 'live',
      timestamp: new Date().toISOString(),
    };
    setItems((prev) => [optimisticItem, ...prev]);

    try {
      await saveEditedAdFactoryImage({
        userId,
        campaignId: logoEditorItem.campaignId,
        imageUrl: newUrl,
        prompt: logoEditorItem.campaignName || 'Edited image',
        // historyId / contextType:'history' would attach to a history
        // record instead of the current campaign — not modelled on
        // these MySpace items yet, so default to current.
      });
    } catch (e) {
      console.error('saveEditedAdFactoryImage failed:', e);
      // Roll back the optimistic insert so the grid matches reality.
      setItems((prev) => prev.filter((i) => i.url !== newUrl));
    }
  };

  const limit = 20;
  const containerRef = useRef(null);

  // ESC + body-scroll lock while the lightbox is open. Mirrors the
  // ImageCard lightbox in MySpace so the two flows feel identical.
  useEffect(() => {
    if (!fullscreenUrl) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') closeFullscreen();
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener('keydown', onKey);
    };
  }, [fullscreenUrl]);

  // MySpace → Meta Post Ad modal. Opened from each card's Megaphone button;
  // the payload carries the chosen image URL. `autoAdvance` is set only when
  // restoring after the Facebook OAuth round-trip — it tells the modal to
  // skip the connect step the moment fbUser populates.
  const [postAdState, setPostAdState] = useState({
    open: false,
    payload: null,
    autoAdvance: false,
  });

  // Re-open the modal after the FB OAuth redirect. The payload was stashed to
  // sessionStorage by the modal itself before redirect.
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
    if (!userId) return;
    setIsLoading(true);
    try {
      const res = await getAdFactoryImages({ userId, skip: nextSkip, limit, startDate, endDate });
      const page = Array.isArray(res?.data) ? res.data : [];
      setItems((prev) => (replace ? page : [...prev, ...page]));
      setHasMore(page.length === limit);
      setSkip(nextSkip + page.length);
    } catch {
      setHasMore(false);
    } finally {
      setIsLoading(false);
    }
  };

  // Fresh load on mount / filter change
  useEffect(() => {
    setItems([]);
    setSkip(0);
    setHasMore(true);
    load(0, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, startDate, endDate]);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el || isLoading || !hasMore) return;
    const isBottom = el.scrollHeight - el.scrollTop <= el.clientHeight + 100;
    if (isBottom) load(skip, false);
  };

  // ── Live placeholder filling via socket ────────────────────────────────────
  // Both manual and autopilot generation flow through Python → /result-update
  // → emitCampaignResult → `adFactoryResponse` emitted to the per-campaign
  // room. We join the room of every campaign that currently has a generating
  // placeholder, then merge incoming results in place. `adsFactory:runComplete`
  // (autopilot, user room — already joined) is handled the same way.
  const joinedRoomsRef = useRef(new Set());

  // Join campaign rooms for any on-screen generating placeholders.
  useEffect(() => {
    const pending = new Set(
      items
        .filter((i) => i.status === 'generating' && !isStaleGenerating(i, now) && i.campaignId)
        .map((i) => i.campaignId)
    );
    pending.forEach((campaignId) => {
      if (!joinedRoomsRef.current.has(campaignId)) {
        joinedRoomsRef.current.add(campaignId);
        emitWhenConnected('adFactoryRequest', campaignId).catch(() => {});
      }
    });
  }, [items, now]);

  // Live placeholder filling. We listen on the app event bus rather than
  // binding our own socket listener: the global `adFactoryResponse` handler in
  // socketSlice is the single reliable socket binding and re-broadcasts every
  // result as `adfactory:imageResult`. Both manual and autopilot generation
  // flow through it (Python → /result-update → emitCampaignResult). This frees
  // the gallery from socket-mount timing and reconnect races.
  useEffect(() => {
    const onImageResult = (data) => {
      if (data?.type !== 'image' || !data?.campaignId || !Array.isArray(data?.result)) return;
      setItems((prev) => mergeCampaignImageResults(prev, data.campaignId, data.result));
    };
    emitter.on('adfactory:imageResult', onImageResult);
    return () => emitter.off('adfactory:imageResult', onImageResult);
  }, []);

  const toggleSelection = (url) => {
    if (!url) return;
    setSelectedImages((prev) =>
      prev.includes(url) ? prev.filter((u) => u !== url) : [...prev, url]
    );
  };

  const completedUrls = useMemo(
    () => items.map((item) => deriveDisplayItem(item, now)).filter((i) => i.status === 'success' && i.url).map((i) => i.url),
    [items, now]
  );

  const displayedItems = useMemo(
    () => items.map((item) => deriveDisplayItem(item, now)),
    [items, now]
  );

  const selectAll = () => {
    if (selectedImages.length === completedUrls.length) setSelectedImages([]);
    else setSelectedImages(completedUrls);
  };

  const handleDownloadSelected = () => {
    if (selectedImages.length === 0) return;
    dispatch(downloadMediaZipAction(selectedImages, 'image'));
    setSelectedImages([]);
  };

  return (
    <div
      className="relative h-full w-full overflow-y-auto px-2 py-8 sm:px-6 2xl:py-10"
      ref={containerRef}
      onScroll={handleScroll}
    >
      {/* Floating selection bar */}
      {selectedImages.length > 0 && (
        <div className="animate-in fade-in zoom-in-95 slide-in-from-bottom-4 fixed bottom-12 left-1/2 z-50 flex -translate-x-1/2 items-center gap-5 rounded-full border border-black/10 bg-white/90 px-2 py-2 text-gray-900 shadow-[0_8px_32px_rgba(0,0,0,0.5)] backdrop-blur-xl transition-all duration-500 dark:border-white/5 dark:bg-[#1a1a1a]/90 dark:text-white">
          <div className="flex items-center pr-2 pl-4">
            <span className="text-[13px] font-semibold text-gray-900 dark:text-white/90">{selectedImages.length}</span>
            <span className="ml-1.5 text-[11px] font-medium tracking-widest text-gray-400 uppercase">Selected</span>
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

      {/* Select all */}
      {completedUrls.length > 0 && (
        <div className="mb-6 flex justify-end px-2">
          <button
            onClick={selectAll}
            className="group flex items-center gap-2 text-xs font-medium text-gray-500 transition-colors hover:text-black dark:hover:text-white"
          >
            <div
              className={`flex h-4 w-4 items-center justify-center rounded border transition-colors ${
                selectedImages.length > 0 && selectedImages.length === completedUrls.length
                  ? 'border-blue-600 bg-blue-600'
                  : 'border-gray-400 bg-white group-hover:border-gray-600 group-hover:bg-black/5 dark:border-gray-600 dark:bg-transparent'
              }`}
            >
              {selectedImages.length > 0 && selectedImages.length === completedUrls.length && (
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" className="text-white">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </div>
            {selectedImages.length > 0 && selectedImages.length === completedUrls.length ? 'Deselect All' : 'Select All'}
          </button>
        </div>
      )}

      <Masonry breakpointCols={breakpointColumnsObj} className="flex w-full gap-2" columnClassName="flex flex-col gap-2">
        {displayedItems
          // The backend occasionally returns rows with a null status
          // (legacy / partial records). They have no meaningful UI state —
          // skip them entirely instead of rendering the generic error card.
          // success + generating + error keep rendering exactly as before.
          .filter((item) => item?.status != null)
          .map((item, index) => (
            <AdFactoryImageCard
              key={`${item.campaignId || 'c'}-${item.url || 'noimg'}-${index}`}
              item={item}
              isSelected={selectedImages.includes(item.url)}
              onSelect={() => toggleSelection(item.url)}
              onFullscreen={(url) => setFullscreen({ url, item })}
              onOpenPostAdModal={(payload) =>
                setPostAdState({ open: true, payload, autoAdvance: false })
              }
              onOpenLogoEditor={handleOpenLogoEditor}
            />
          ))}
      </Masonry>

      {displayedItems.filter((item) => item?.status != null).length === 0 && !isLoading && (
        <div className="flex h-full w-full items-center justify-center text-gray-400">No images found.</div>
      )}
      {isLoading && (
        <div className="mt-6 flex w-full items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-300 border-t-blue-600" />
        </div>
      )}

      {/* Fullscreen lightbox — mirrors the MySpace ImageCard lightbox.
          Top-right pill now includes Edit Logo + Download. Clicking
          Edit Logo closes the lightbox and opens the logo editor for
          the source item. */}
      {fullscreenUrl && (
        <div
          onClick={closeFullscreen}
          className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/85 backdrop-blur-xl"
        >
          {/* Close (X) — top-left, frosted-glass circle */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              closeFullscreen();
            }}
            title="Close (Esc)"
            className="absolute top-5 left-5 z-10 flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-black/45 text-white/90 shadow-lg shadow-black/50 backdrop-blur-xl transition-all hover:scale-105 hover:bg-white/15 hover:text-white"
          >
            <X size={18} strokeWidth={2.25} />
          </button>

          {/* Action pill — Edit Logo + Download */}
          <div className="absolute top-5 right-5 z-10 flex items-center gap-0 rounded-2xl border border-white/15 bg-black/45 p-1 shadow-lg shadow-black/50 backdrop-blur-xl">
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleOpenLogoEditor(fullscreenItem, fullscreenUrl);
              }}
              title="Open logo editor"
              className="flex h-9 items-center gap-2 rounded-xl px-3 text-sm font-medium text-white/85 transition-all hover:bg-white/12 hover:text-white"
            >
              <Pencil size={15} strokeWidth={2} />
              Edit Logo
            </button>
            <span className="mx-0.5 h-5 w-px bg-white/15" aria-hidden />
            <button
              onClick={(e) => {
                e.stopPropagation();
                dispatch(downloadMediaFromUrl(`${fullscreenUrl}`, 'image'));
              }}
              title="Download image"
              className="flex h-9 items-center gap-2 rounded-xl px-3 text-sm font-medium text-white/85 transition-all hover:bg-white/12 hover:text-white"
            >
              <Download size={15} strokeWidth={2} />
              Download
            </button>
          </div>

          <img
            src={resolveImageUrl(fullscreenUrl)}
            alt="AdFactory generated"
            onClick={(e) => e.stopPropagation()}
            className="max-h-[88vh] max-w-[92vw] rounded-2xl object-contain shadow-2xl ring-1 ring-white/10"
          />
        </div>
      )}

      <PostAdMySpaceModal
        open={postAdState.open}
        onOpenChange={(open) => setPostAdState((s) => ({ ...s, open }))}
        payload={postAdState.payload}
        autoAdvance={postAdState.autoAdvance}
      />

      {logoEditorOpen && logoEditorItem?.url && (
        <MySpaceLogoEditor
          baseImageUrl={resolveImageUrl(logoEditorItem.url)}
          userId={userId}
          onClose={() => {
            setLogoEditorOpen(false);
            setLogoEditorItem(null);
          }}
          onSaved={handleLogoSaved}
        />
      )}
    </div>
  );
}
