import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, RefreshCw, Sparkles } from 'lucide-react';

// Template gallery pieces shared by the Ad Creative (image) and Ad Video (video)
// home screens. Data comes from DS via hooks/useStudioTemplates.js — each item
// is `{ template_id, kind, url, tags, rank }`, already ranked for the brand
// selected in the header. The old hardcoded Unsplash list and category pills
// were removed on 2026-09-29 (docs/ai/modules/adstudio, FEATURE-brand-templates).

// Server error codes that retrying cannot fix — the brand itself needs editing.
const NON_RETRYABLE = new Set(['NO_CONTEXT', 'NO_DESCRIPTION', 'BRAND_NOT_FOUND']);

// Video matching often takes the full 30s upstream; say so after a while.
const SLOW_VIDEO_NOTICE_MS = 8000;

const SKELETON_HEIGHTS = [260, 200, 320, 240, 180, 300, 220, 280, 190, 250, 310, 210];

export function AdCreativeTemplateHeader({
  title = 'Trending Image Templates',
  subtitle = '',
  brandName = '',
  onRefresh,
  isRefreshing = false,
  refreshDisabled = false,
  isExpanded = false,
  onToggleExpand,
  className = '',
}) {
  return (
    <div className={`w-full flex flex-col md:flex-row md:items-center justify-between gap-3 ${className}`}>
      {/* Title (the "PROVEN WINNERS" badge was removed 2026-09-30) */}
      <div className="flex flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <h2 className="text-base sm:text-lg 2xl:text-xl font-bold text-zinc-900 dark:text-white tracking-tight select-none">
            {title}
          </h2>
          {brandName && (
            <span className="hidden sm:inline text-xs text-zinc-500 dark:text-zinc-400 font-normal select-none">
              • Matched to {brandName}
            </span>
          )}
        </div>
        {subtitle && <p className="text-xs text-zinc-500 dark:text-zinc-400 select-none">{subtitle}</p>}
      </div>

      {/* Refresh + Expand/Collapse */}
      <div className="flex items-center gap-1.5 select-none">
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshDisabled || isRefreshing}
            aria-label="Refresh templates"
            title="Refresh templates"
            className="shrink-0 flex h-7.5 w-7.5 items-center justify-center rounded-full border border-black/10 dark:border-white/10 bg-white/80 dark:bg-[#1A1A1E] text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-[#25252A] transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>
        )}

        {onToggleExpand && (
          <button
            type="button"
            onClick={onToggleExpand}
            aria-label={isExpanded ? 'Collapse templates drawer' : 'Expand templates drawer'}
            className="shrink-0 flex items-center gap-1.5 rounded-full border border-black/10 dark:border-white/10 bg-white/80 dark:bg-[#1A1A1E] px-2.5 py-1 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-[#25252A] hover:text-zinc-900 dark:hover:text-white transition-all cursor-pointer shadow-xs"
          >
            <span>{isExpanded ? 'Collapse' : 'Expand'}</span>
            {isExpanded ? (
              <ChevronDown className="h-3.5 w-3.5 text-zinc-500 dark:text-zinc-400" />
            ) : (
              <ChevronUp className="h-3.5 w-3.5 text-zinc-500 dark:text-zinc-400" />
            )}
          </button>
        )}
      </div>
    </div>
  );
}

function StatusMessage({ children, action }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <p className="max-w-md text-sm text-zinc-600 dark:text-zinc-400">{children}</p>
      {action}
    </div>
  );
}

// Column count per viewport width — the same steps the old CSS `columns-*`
// classes used (2 / sm 3 / md 4 / lg 5 / xl 5 / 2xl 6 / ≥2000px 7).
const COLUMN_STEPS = [
  [2000, 7],
  [1536, 6],
  [1024, 5],
  [768, 4],
  [640, 3],
  [0, 2],
];
const columnsFor = (width) => COLUMN_STEPS.find(([min]) => width >= min)[1];

function useColumnCount() {
  const [count, setCount] = useState(() =>
    typeof window === 'undefined' ? 5 : columnsFor(window.innerWidth)
  );
  useEffect(() => {
    const onResize = () => setCount(columnsFor(window.innerWidth));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return count;
}

/**
 * Row-first masonry: item i goes to column i % columns.
 *
 * Replaced CSS `columns-*` (2026-09-30). That fills DOWN the first column
 * before the next, so every image that finished loading and changed height
 * pushed cards from one column into another — the top row kept reshuffling
 * while results streamed in. Fixed columns mean rank 1..N is always the first
 * row, and a late image can only grow its own column.
 */
function RowFirstMasonry({ items, renderItem, getKey, ...rest }) {
  const columns = useColumnCount();
  const buckets = Array.from({ length: columns }, () => []);
  items.forEach((item, i) => buckets[i % columns].push(item));
  return (
    <div className="flex items-start gap-2.5 2xl:gap-3" {...rest}>
      {buckets.map((bucket, c) => (
        <div key={c} className="flex min-w-0 flex-1 flex-col gap-2.5 2xl:gap-3">
          {bucket.map((item) => (
            <React.Fragment key={getKey(item)}>{renderItem(item)}</React.Fragment>
          ))}
        </div>
      ))}
    </div>
  );
}

function SkeletonGrid({ media, brandName }) {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    if (media !== 'video') return undefined;
    const timer = setTimeout(() => setSlow(true), SLOW_VIDEO_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [media]);

  return (
    <div>
      <p className="mb-3 text-center text-xs text-zinc-500 dark:text-zinc-400" aria-live="polite">
        {slow
          ? 'Still matching videos, this can take up to 30 seconds…'
          : `Finding templates for ${brandName || 'your brand'}…`}
      </p>
      <RowFirstMasonry
        aria-hidden="true"
        items={SKELETON_HEIGHTS.map((h, i) => ({ h, i }))}
        getKey={(tile) => tile.i}
        renderItem={(tile) => (
          <div style={{ height: tile.h }} className="animate-pulse rounded-xl bg-zinc-200/80 dark:bg-white/5" />
        )}
      />
    </div>
  );
}

// Shared frame, hover overlay and Recreate button for both card kinds.
// No border or tinted frame: a template reads as the ad itself (the tool tiles
// above are the framed "tools"); hover adds a violet ring.
//
// `loaded` = the media has reported its real size. Until then the card holds a
// 4:5 shimmer box: an <img>/<video> of unknown size is 0px tall, which drew
// each card as a thin bordered line and made heights jump as media arrived.
function CardFrame({ template, onSelect, loaded, children }) {
  const clickable = Boolean(onSelect);
  const tags = (template.tags || []).slice(0, 2);

  return (
    <div
      onClick={clickable ? () => onSelect(template) : undefined}
      className={`group relative overflow-hidden rounded-xl bg-zinc-200/60 dark:bg-zinc-800/50 transition-all duration-300 hover:shadow-lg hover:ring-2 hover:ring-[#8B5CF6]/60 ${clickable ? 'cursor-pointer' : ''} ${loaded ? '' : 'aspect-4/5 animate-pulse'}`}
    >
      {children}

      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/35 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />

      <div className="absolute inset-x-0 bottom-0 z-10 p-3 sm:p-3.5 flex items-end justify-between gap-2 text-white opacity-0 group-hover:opacity-100 transition-all duration-300 translate-y-1.5 group-hover:translate-y-0">
        <div className="min-w-0 flex-1 pr-1">
          {tags.map((tag) => (
            <span key={tag} className="block text-[9px] font-bold tracking-wider text-zinc-300 uppercase truncate">
              {tag}
            </span>
          ))}
        </div>

        {clickable && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onSelect(template);
            }}
            className="shrink-0 inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-[10.5px] font-semibold text-zinc-900 shadow-md backdrop-blur-md transition-all duration-150 hover:bg-zinc-100 hover:scale-105 active:scale-95 cursor-pointer"
          >
            <Sparkles className="h-3 w-3 text-amber-500" />
            <span>Recreate</span>
          </button>
        )}
      </div>
    </div>
  );
}

// While loading, the media sits invisibly on top of the placeholder box (so it
// has a size and lazy-loading still fires); once loaded it joins the flow.
const PENDING_MEDIA = 'absolute inset-0 h-full w-full opacity-0';

function ImageTemplateCard({ template, onSelect, onBroken }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <CardFrame template={template} onSelect={onSelect} loaded={loaded}>
      <img
        src={template.url}
        alt={(template.tags || []).join(', ') || 'Ad template'}
        loading="lazy"
        onLoad={() => setLoaded(true)}
        onError={() => onBroken(template.template_id)}
        className={`${loaded ? 'block w-full h-auto' : PENDING_MEDIA} object-cover transition-transform duration-300 ease-out group-hover:scale-[1.03]`}
      />
    </CardFrame>
  );
}

// Plays muted on hover only, so 30 cards don't all download video at once.
// `#t=0.1` makes browsers paint the first frame instead of a black box.
function VideoTemplateCard({ template, onSelect, onBroken }) {
  const videoRef = useRef(null);
  const [loaded, setLoaded] = useState(false);

  const play = () => {
    videoRef.current?.play().catch(() => {
      /* autoplay can be refused; the first frame stays visible */
    });
  };
  const stop = () => {
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    video.currentTime = 0.1;
  };

  return (
    <div onMouseEnter={play} onMouseLeave={stop}>
      <CardFrame template={template} onSelect={onSelect} loaded={loaded}>
        <video
          ref={videoRef}
          src={`${template.url}#t=0.1`}
          muted
          loop
          playsInline
          preload="metadata"
          onLoadedData={() => setLoaded(true)}
          onError={() => onBroken(template.template_id)}
          className={`${loaded ? 'block w-full h-auto' : PENDING_MEDIA} object-cover`}
        />
      </CardFrame>
    </div>
  );
}

/**
 * Infinite-scroll trigger under the grid (video). Asks for the next page when
 * it is within PRELOAD_PX of the bottom of the grid's scroll pane. Re-checked
 * after every page (`itemCount` in the deps), so a page too short to fill the
 * screen still pulls the next one in.
 */
// Nearest ancestor that scrolls vertically, or null (= the viewport).
function scrollParentOf(node) {
  for (let el = node?.parentElement; el; el = el.parentElement) {
    const { overflowY } = window.getComputedStyle(el);
    if (overflowY === 'auto' || overflowY === 'scroll') return el;
  }
  return null;
}

const PRELOAD_PX = 600;

function LoadMoreSentinel({ onLoadMore, isLoadingMore, error, itemCount }) {
  const ref = useRef(null);

  // A plain geometry check on the grid's own scroll container, not an
  // IntersectionObserver. The grid scrolls inside the drawer pane: with the
  // viewport as root the preload margin never applied (the pane clips first),
  // and even with the pane as root, container scrolls produced no callbacks in
  // headless Chrome — the first page loaded, then nothing. This is
  // deterministic: check on mount / after every page (fills a short screen),
  // on every pane scroll and on resize. fetchStudioTemplates' condition drops
  // repeats, so calling onLoadMore often is harmless.
  useEffect(() => {
    const node = ref.current;
    if (!node || isLoadingMore || error) return undefined;
    const root = scrollParentOf(node);
    const check = () => {
      const bottom = root ? root.getBoundingClientRect().bottom : window.innerHeight;
      if (node.getBoundingClientRect().top - bottom < PRELOAD_PX) onLoadMore();
    };
    check();
    const target = root || window;
    target.addEventListener('scroll', check, { passive: true });
    window.addEventListener('resize', check);
    return () => {
      target.removeEventListener('scroll', check);
      window.removeEventListener('resize', check);
    };
  }, [onLoadMore, isLoadingMore, error, itemCount]);

  return (
    <div ref={ref} className="flex min-h-14 items-center justify-center py-4" aria-live="polite">
      {isLoadingMore && (
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-600 dark:border-white/15 dark:border-t-white/60" aria-label="Loading more templates" />
      )}
      {error && !isLoadingMore && (
        <button
          type="button"
          onClick={onLoadMore}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-black/10 bg-white/80 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-white/10 dark:bg-[#1A1A1E] dark:text-zinc-200 dark:hover:bg-[#25252A]"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Couldn&apos;t load more — retry
        </button>
      )}
    </div>
  );
}

/**
 * The template grid and its states. `view` comes from useStudioTemplates:
 * 'brands-loading' | 'no-brand' | 'loading' | 'ready' | 'error'.
 * `onSelectTemplate(template)` is optional; without it cards are not clickable.
 * `hasMore` / `onLoadMore` / `isLoadingMore` / `loadMoreError` turn on infinite
 * scroll (the Ad Video gallery; images arrive whole).
 */
export function AdCreativeTemplateMasonry({
  media = 'image',
  view,
  items = [],
  error = null,
  brandName = '',
  onRetry,
  onSelectTemplate,
  hasMore = false,
  onLoadMore,
  isLoadingMore = false,
  loadMoreError = null,
  className = '',
}) {
  // DS links occasionally 404; drop those cards instead of showing a hole.
  const [broken, setBroken] = useState(() => new Set());
  const markBroken = (id) => setBroken((prev) => new Set(prev).add(id));
  const visible = items.filter((t) => !broken.has(t.template_id));

  let content;
  if (view === 'brands-loading' || view === 'loading') {
    content = <SkeletonGrid media={media} brandName={brandName} />;
  } else if (view === 'no-brand') {
    content = <StatusMessage>Pick a brand (top right) to see templates matched to it.</StatusMessage>;
  } else if (view === 'error') {
    const canRetry = !NON_RETRYABLE.has(error?.code);
    content = (
      <StatusMessage
        action={
          canRetry && onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-1.5 rounded-full border border-black/10 dark:border-white/10 bg-white/80 dark:bg-[#1A1A1E] px-3 py-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-[#25252A] cursor-pointer"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Retry
            </button>
          ) : null
        }
      >
        {error?.message || "Couldn't load templates right now. Please try again in a moment."}
      </StatusMessage>
    );
  } else if (!visible.length) {
    content = <StatusMessage>No templates matched this brand yet. Try refreshing in a little while.</StatusMessage>;
  } else {
    const Card = media === 'video' ? VideoTemplateCard : ImageTemplateCard;
    content = (
      <>
        <RowFirstMasonry
          items={visible}
          getKey={(template) => template.template_id}
          renderItem={(template) => (
            <Card template={template} onSelect={onSelectTemplate} onBroken={markBroken} />
          )}
        />
        {onLoadMore && (hasMore || isLoadingMore || loadMoreError) && (
          <LoadMoreSentinel
            onLoadMore={onLoadMore}
            isLoadingMore={isLoadingMore}
            error={loadMoreError}
            itemCount={items.length}
          />
        )}
      </>
    );
  }

  return <div className={`w-full ${className}`}>{content}</div>;
}
