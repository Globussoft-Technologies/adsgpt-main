import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';

// ── The template dock on the Ad Creative / Ad Video home screens ─────────────
//
// A port of the onboarding dock (`TemplateDock` + `TemplateTile` in
// components/BrandSetup/Workspace.jsx), per user request 2026-10-01: same
// handle, drag, double-click, wheel glide, Expand all / Collapse, cropped
// collapsed preview, tile look, chips and violet Recreate button. Dark mode
// uses onboarding's exact colours; light mode is the same structure on our
// white/cream tokens.
//
// Deliberate differences from onboarding (user decisions in brackets):
// - Videos play on hover only, not autoplay-when-on-screen [user, 2026-10-01].
// - Columns are filled row-first (item i → column i % N), not shortest-first.
//   DS templates carry no dimensions, so shortest-first re-packs every time an
//   image loads and the top row reshuffles (the 2026-09-30 bug in the old
//   gallery). Column width, gap and tile look are onboarding's.
// - The whole tile opens Recreate (as before on Ad Studio); onboarding tiles
//   only respond to their Recreate button.
// - Header keeps Ad Studio's title, "• Matched to {brand}", subtitle and ↻.
// - The wheel listener covers the whole home screen, not just the dock, so a
//   wheel over the tool tiles still opens the templates (as before).
//
// Height is owned by `useStudioDock` (below), which measures the screen: the
// collapsed dock's top sits DOCK_REST_GAP under the tool row, and a raised dock
// stops just under the "Create an … ad" heading.

// Side padding shared by the home screen's tools and the dock's header + grid,
// so the templates line up with the tool cards. The home root bleeds out over
// the app shell's 16px gutter (`-mx-4` on the root) so the dock runs edge to
// edge — sidebar to window — like onboarding's, instead of floating as a
// square panel with page background showing at its sides.
export const STUDIO_GUTTER = 'px-9 sm:px-14 2xl:px-[72px]';
export const STUDIO_BLEED = '-mx-4 w-[calc(100%+2rem)]';

const DOCK_ANIM_MS = 320; // onboarding DOCK_ANIM_MS
const GAP_PX = 6; // onboarding GAP_PX
const COLUMN_TARGET_PX = 330; // onboarding: round(width / 330), 2..6 columns
// Gap between the bottom of the tool stage and the collapsed dock's top, as a
// share of the screen's height so it scales with the window. The stage's tab
// bar already separates tools from templates, so it is 4% (28–48px). (The old
// tile row used 11%, 64–110px.)
const restGapFor = (rootH) => Math.round(Math.min(48, Math.max(28, rootH * 0.04)));
// Fully raised, the dock reaches the top of the home screen (just under the Ad
// Studio header) and covers the heading too (user, 2026-10-07: "max expanded
// height up to here"). It used to stop 12px under the heading block.
const DOCK_TOP_GAP = 0;
// Never collapse shorter than this, even on a short window.
const DOCK_FLOOR_H = 180;
// onboarding: expanded once the dock is 148px (420 − 272) above its minimum.
const EXPAND_DELTA = 148;

// Server error codes that retrying cannot fix — the brand itself needs editing.
const NON_RETRYABLE = new Set(['NO_CONTEXT', 'NO_DESCRIPTION', 'BRAND_NOT_FOUND']);
// Video matching often takes the full 30s upstream; say so after a while.
const SLOW_VIDEO_NOTICE_MS = 8000;
const SKELETON_HEIGHTS = [260, 200, 320, 240, 180, 300, 220, 280, 190, 250, 310, 210];

// Chip colours, copied from onboarding (Workspace.jsx TAG_COLORS / tagColor):
// [text, tint, border]. Unknown tags hash onto the same palette.
const TAG_COLORS = {
  energetic: ['#c3a8ff', 'rgba(124,92,255,.22)', 'rgba(124,92,255,.4)'],
  authentic: ['#3ecf8e', 'rgba(62,207,142,.16)', 'rgba(62,207,142,.34)'],
  cool: ['#5aa9ff', 'rgba(90,169,255,.16)', 'rgba(90,169,255,.34)'],
  nostalgic: ['#b48cff', 'rgba(180,140,255,.16)', 'rgba(180,140,255,.34)'],
  sophisticated: ['#e88ec0', 'rgba(232,142,192,.16)', 'rgba(232,142,192,.34)'],
  atmospheric: ['#63d8dd', 'rgba(99,216,221,.16)', 'rgba(99,216,221,.34)'],
  confident: ['#ff7a5c', 'rgba(255,122,92,.16)', 'rgba(255,122,92,.34)'],
  relatable: ['#9fd356', 'rgba(159,211,86,.16)', 'rgba(159,211,86,.34)'],
  athletic: ['#ffb84d', 'rgba(255,184,77,.16)', 'rgba(255,184,77,.34)'],
  clean: ['#c8d0d8', 'rgba(200,208,216,.14)', 'rgba(200,208,216,.3)'],
};
const TAG_FALLBACK = Object.values(TAG_COLORS);

function tagColor(tag) {
  const key = String(tag || '')
    .trim()
    .toLowerCase();
  if (TAG_COLORS[key]) return TAG_COLORS[key];
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return TAG_FALLBACK[hash % TAG_FALLBACK.length];
}

/**
 * Geometry + height state for the dock. Callers put `rootRef` on the home
 * screen's root (the dock is absolutely positioned at its bottom), `headRef` on
 * the heading block (kept for callers; no longer sets the ceiling — the dock
 * rises to the root's top) and `toolsRef` on the wrapper around the tool row, then
 * spread `dockProps` onto <StudioTemplateDock>. `wheelRef` = root, so the
 * wheel works anywhere on the screen.
 */
export function useStudioDock() {
  const rootRef = useRef(null);
  const headRef = useRef(null);
  const toolsRef = useRef(null);
  const [geo, setGeo] = useState({ minH: DOCK_FLOOR_H, ceiling: DOCK_FLOOR_H });
  // null = resting at the collapsed height, so it follows `minH` when the
  // window (or the tool row) changes size instead of keeping a stale pixel value.
  const [dockH, setDockH] = useState(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    // Layout position (offsetTop chain), not getBoundingClientRect: the heading
    // and tiles enter with a framer-motion fade-up, and a rect measured mid-
    // animation includes that translateY (it put the dock 32px too low).
    const bottomOf = (el) => {
      if (!el) return 0;
      let y = el.offsetHeight;
      for (let n = el; n && n !== root; n = n.offsetParent) y += n.offsetTop;
      return y;
    };
    const measure = () => {
      const rootH = root.clientHeight;
      const toolsBottom = bottomOf(toolsRef.current);
      const minH = Math.max(DOCK_FLOOR_H, Math.round(rootH - toolsBottom - restGapFor(rootH)));
      const ceiling = Math.max(minH, Math.round(rootH - DOCK_TOP_GAP));
      setGeo((g) => (g.minH === minH && g.ceiling === ceiling ? g : { minH, ceiling }));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    if (toolsRef.current) observer.observe(toolsRef.current);
    measure();
    return () => observer.disconnect();
  }, []);

  const { minH, ceiling } = geo;
  const height = dockH == null ? minH : Math.min(Math.max(dockH, minH), ceiling);
  const onResize = useCallback(
    (next) => {
      const clamped = Math.min(Math.max(next, minH), ceiling);
      setDockH(clamped <= minH ? null : clamped);
    },
    [minH, ceiling]
  );

  return {
    rootRef,
    headRef,
    toolsRef,
    dockProps: { height, minH, ceiling, onResize, wheelRef: rootRef },
  };
}

// While loading, media sits invisibly on top of a 4:5 placeholder (so it has a
// size and lazy-loading fires); once loaded it joins the flow. Without this an
// <img>/<video> of unknown size is 0px tall and heights jump as media arrives.
const PENDING_MEDIA = 'absolute inset-0 h-full w-full opacity-0';

// ── Video stills (perf, 2026-10-01) ─────────────────────────────────────────
// A resting video tile used to be a live <video preload="metadata">: 10–20
// media players each holding a decoded frame. Under that load Chrome painted
// tiles blank/black and blinked while the dock moved. Now each tile grabs ONE
// frame into a <canvas> and releases its player; a real <video> mounts only
// while the tile is hovered. Grabs start when a tile nears the screen and run
// at most GRAB_CONCURRENCY at a time. Drawing a cross-origin video into a
// canvas is allowed (the canvas is only "tainted" for reading, not display).
const GRAB_CONCURRENCY = 3;
const GRAB_TIMEOUT_MS = 15000;
const grabQueue = [];
let grabsRunning = 0;

function pumpGrabs() {
  while (grabsRunning < GRAB_CONCURRENCY && grabQueue.length) {
    const job = grabQueue.shift();
    if (job.cancelled) continue;
    grabsRunning += 1;
    job.run().finally(() => {
      grabsRunning -= 1;
      pumpGrabs();
    });
  }
}

// Queue a frame grab; returns a cancel function (for unmounted tiles).
function queueGrab(run) {
  const job = { run, cancelled: false };
  grabQueue.push(job);
  pumpGrabs();
  return () => {
    job.cancelled = true;
  };
}

// Load `url` in a detached <video>, seek to 0.1s, draw that frame into
// `canvas` at most `maxW` px wide, then unload the video.
function grabFrame(url, canvas, maxW) {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    let timer = 0;
    const finish = (ok) => {
      clearTimeout(timer);
      v.removeAttribute('src');
      v.load(); // releases the decoder
      if (ok) resolve();
      else reject(new Error('frame grab failed'));
    };
    timer = setTimeout(() => finish(false), GRAB_TIMEOUT_MS);
    v.addEventListener('error', () => finish(false), { once: true });
    v.addEventListener(
      'loadedmetadata',
      () => {
        v.currentTime = Math.min(0.1, v.duration || 0.1);
      },
      { once: true }
    );
    v.addEventListener(
      'seeked',
      () => {
        if (!canvas || !v.videoWidth) {
          finish(false);
          return;
        }
        const w = Math.min(v.videoWidth, maxW);
        const h = Math.round(v.videoHeight * (w / v.videoWidth));
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(v, 0, 0, w, h);
        finish(true);
      },
      { once: true }
    );
    v.src = url;
  });
}

/**
 * One template. Onboarding's TemplateTile look: no border, minimal rounding,
 * chips on the picture, violet Recreate on hover, playhead while a video plays.
 * Memoized: the dock re-renders when it settles, and 20–40 tiles re-rendering
 * with it is wasted work (props are stable: template objects come from the
 * store, the handlers are stable callbacks).
 */
const TemplateTile = React.memo(function TemplateTile({ template: t, media, width, onSelect, onBroken }) {
  const root = useRef(null);
  const canvas = useRef(null);
  const bar = useRef(null);
  const [loaded, setLoaded] = useState(false);
  const [near, setNear] = useState(false);
  const [hover, setHover] = useState(false);
  const [playing, setPlaying] = useState(false);
  const isVideo = media === 'video';
  const clickable = Boolean(onSelect);
  // Read at grab time only; a resize must not re-grab every tile.
  const widthRef = useRef(width);
  widthRef.current = width;

  // onboarding: two chips need ~190px of tile.
  const maxTags = width < 190 ? 1 : 2;
  const tags = (t.tags || []).filter(Boolean).slice(0, maxTags);

  // Video tiles: start the still-frame grab once the tile is within 400px of
  // the screen (images use the browser's own loading="lazy").
  useEffect(() => {
    if (!isVideo || near) return undefined;
    const el = root.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setNear(true);
      return undefined;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setNear(true);
          io.disconnect();
        }
      },
      { rootMargin: '400px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [isVideo, near]);

  useEffect(() => {
    if (!isVideo || !near) return undefined;
    let alive = true;
    const maxW = Math.ceil(widthRef.current * Math.min(window.devicePixelRatio || 1, 2));
    const cancel = queueGrab(() =>
      grabFrame(t.url, canvas.current, maxW).then(
        () => alive && setLoaded(true),
        () => alive && onBroken(t.template_id)
      )
    );
    return () => {
      alive = false;
      cancel();
    };
  }, [isVideo, near, t.url, t.template_id, onBroken]);

  const onEnter = () => {
    if (isVideo) setHover(true);
  };
  const onLeave = () => {
    setHover(false);
    setPlaying(false);
  };

  return (
    <div
      ref={root}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onClick={clickable ? () => onSelect(t) : undefined}
      className={`group relative block w-full overflow-hidden rounded-sm bg-[#EAE5DC] dark:bg-[#121216] ${clickable ? 'cursor-pointer' : ''} ${loaded ? '' : 'aspect-4/5 animate-pulse'}`}
    >
      {isVideo ? (
        <>
          <canvas ref={canvas} aria-hidden className={loaded ? 'block h-auto w-full' : PENDING_MEDIA} />
          {/* Hover-only player over the still; shown once it is actually
              playing, so the still never flashes to black. */}
          {hover && loaded && (
            <video
              src={t.url}
              autoPlay
              muted
              loop
              playsInline
              onPlaying={() => setPlaying(true)}
              onTimeUpdate={(e) => {
                // Straight to the DOM, as in onboarding: state would re-render ~4×/s.
                const el = e.currentTarget;
                if (el.duration && bar.current) bar.current.style.width = `${(el.currentTime / el.duration) * 100}%`;
              }}
              className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-150 ${playing ? 'opacity-100' : 'opacity-0'}`}
            />
          )}
        </>
      ) : (
        <img
          src={t.url}
          alt={(t.tags || []).join(', ') || 'Ad template'}
          loading="lazy"
          onLoad={() => setLoaded(true)}
          onError={() => onBroken(t.template_id)}
          className={`${loaded ? 'block h-auto w-full' : PENDING_MEDIA} object-cover`}
        />
      )}

      {/* Chips sit on a near-opaque dark base so they read on any frame
          (onboarding also blurred behind them; dropped — 40 live backdrop
          filters over video were a large part of the scroll cost). Hidden
          while the video plays, as in onboarding. */}
      {loaded && tags.length > 0 && (
        <div
          className={`pointer-events-none absolute right-1.5 bottom-1.5 left-1.5 flex flex-nowrap gap-1 transition-opacity ${playing ? 'opacity-0' : ''}`}
        >
          {tags.map((label) => {
            const [color, bg, border] = tagColor(label);
            return (
              <span
                key={label}
                className="min-w-0 shrink truncate rounded-sm px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap capitalize"
                style={{
                  color,
                  background: `linear-gradient(${bg}, ${bg}), rgba(10,10,13,0.88)`,
                  border: `1px solid ${border}`,
                }}
              >
                {label}
              </span>
            );
          })}
        </div>
      )}

      {clickable && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onSelect(t);
          }}
          className="absolute right-2 bottom-2 z-[3] inline-flex items-center gap-1.5 rounded-[7px] bg-[linear-gradient(180deg,#9176ff_0%,#7c5cff_46%,#6148c7_100%)] px-2.5 py-1.5 text-[12px] font-bold text-white opacity-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.42),inset_0_-1px_0_rgba(0,0,0,0.28),0_4px_10px_-4px_rgba(0,0,0,0.75)] transition duration-200 group-hover:opacity-100 hover:brightness-110 active:translate-y-px"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M3 12a9 9 0 0 1 15.5-6.2L21 8M21 12a9 9 0 0 1-15.5 6.2L3 16" />
            <path d="M21 4v4h-4M3 20v-4h4" />
          </svg>
          Recreate
        </button>
      )}

      {playing && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-white/[0.12]">
          <div ref={bar} className="h-full bg-[#7c5cff]" style={{ width: '0%' }} />
        </div>
      )}
    </div>
  );
});

// Row-first columns: item i → column i % count (see the header note).
function Columns({ items, count, renderItem, getKey }) {
  const buckets = Array.from({ length: count }, () => []);
  items.forEach((item, i) => buckets[i % count].push(item));
  return (
    <div className="flex items-start" style={{ gap: GAP_PX }}>
      {buckets.map((bucket, c) => (
        <div key={c} className="flex min-w-0 flex-1 flex-col" style={{ gap: GAP_PX }}>
          {bucket.map((item) => (
            <React.Fragment key={getKey(item)}>{renderItem(item)}</React.Fragment>
          ))}
        </div>
      ))}
    </div>
  );
}

// Onboarding's empty/failed box (dashed), with Ad Studio's messages + Retry.
function StatusBox({ children, action }) {
  return (
    <div className="flex h-full min-h-32 w-full flex-col items-center justify-center gap-3 rounded-sm border border-dashed border-black/10 px-4 text-center text-xs text-zinc-500 dark:border-white/[0.08] dark:text-white/40">
      <p className="max-w-md">{children}</p>
      {action}
    </div>
  );
}

const CONTROL =
  'flex items-center gap-1.5 rounded-[7px] border border-black/[0.07] bg-[#F6F2EC] text-xs font-semibold text-zinc-600 transition hover:border-[#7c5cff]/45 hover:text-[#6b4fe0] disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.09] dark:bg-[#232329] dark:text-[#c3c9cf] dark:hover:border-[#7c5cff]/45 dark:hover:text-[#c3a8ff]';

export default function StudioTemplateDock({
  title,
  subtitle = '',
  brandName = '',
  media = 'image',
  view,
  items = [],
  error = null,
  onRetry,
  onSelectTemplate,
  onRefresh,
  isRefreshing = false,
  refreshDisabled = false,
  hasMore = false,
  onLoadMore,
  isLoadingMore = false,
  loadMoreError = null,
  height,
  minH,
  ceiling,
  onResize,
  wheelRef,
}) {
  const section = useRef(null);
  const strip = useRef(null);
  const [boxWidth, setBoxWidth] = useState(0);
  // Above this height the grid scrolls; below it the collapsed preview is cropped.
  const expandAt = minH + Math.min(EXPAND_DELTA, (ceiling - minH) / 2);
  const expanded = height > expandAt;

  // DS links occasionally 404; drop those tiles instead of showing a hole.
  const [broken, setBroken] = useState(() => new Set());
  const markBroken = useCallback((id) => setBroken((prev) => new Set(prev).add(id)), []);
  const visible = items.filter((t) => !broken.has(t.template_id));

  useLayoutEffect(() => {
    const el = strip.current;
    if (!el) return undefined;
    // Content width (padding is responsive now, so read it rather than assume).
    const measure = () => {
      const cs = getComputedStyle(el);
      setBoxWidth(el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    measure();
    return () => observer.disconnect();
  }, []);

  const columnCount = Math.max(2, Math.min(6, Math.round((boxWidth || 1100) / COLUMN_TARGET_PX)));
  const innerW = Math.max(0, boxWidth || 1100);
  const tileW = Math.max(1, Math.floor((innerW - GAP_PX * (columnCount - 1)) / columnCount));

  // ── Infinite scroll (video), onboarding's rule ─────────────────────────────
  // Ask for the next page when within 260px of the end, re-checked on scroll and
  // on every relayout. `requestedAt` records the list length each automatic
  // request was made at, so an empty or declined page costs one request, not a
  // retry storm. Collapsed, the strip is cropped and does not scroll, so it
  // only tops up when opened (same as onboarding).
  const requestedAt = useRef(-1);
  const canLoadMore = Boolean(onLoadMore) && hasMore && !loadMoreError;
  const maybeLoadMore = useCallback(() => {
    const el = strip.current;
    if (!el || !canLoadMore || isLoadingMore) return;
    if (requestedAt.current === items.length) return;
    if (el.scrollTop < el.scrollHeight - el.clientHeight - 260) return;
    requestedAt.current = items.length;
    onLoadMore();
  }, [canLoadMore, isLoadingMore, items.length, onLoadMore]);
  useEffect(() => {
    maybeLoadMore();
  }, [maybeLoadMore, expanded, boxWidth, height]);

  // ── Moving the dock without re-rendering (perf, 2026-10-01) ────────────────
  // The dock is always laid out at its full (ceiling) height and slid with a
  // GPU transform: `translateY(ceiling − height)`; the root's overflow:hidden
  // crops what is below. Onboarding animated `height`, which re-laid-out the
  // whole grid every frame. During a wheel glide or a drag, `setLive` writes the
  // transform straight to the DOM and React state (`onResize`, which re-renders
  // the whole home screen) is committed ONCE when the gesture ends. Measured on
  // Ad Video at 1440: wheel pull went from 63ms avg / 1.2s worst frame to ~16ms.
  const clampH = useCallback((h) => Math.min(Math.max(h, minH), ceiling), [minH, ceiling]);
  const heightRef = useRef(height); // the LIVE height (DOM), not just the state
  // Also flips the grid's scrollability LIVE (not at commit): a wheel notch that
  // landed after the glide reached the top but before React committed hit an
  // overflow:hidden grid and did nothing (user report, 2026-10-01).
  const setLive = useCallback(
    (h) => {
      heightRef.current = h;
      if (section.current) section.current.style.transform = `translate3d(0, ${ceiling - h}px, 0)`;
      if (strip.current) strip.current.style.overflowY = h > expandAt ? 'auto' : 'hidden';
    },
    [ceiling, expandAt]
  );
  // A committed height (or new geometry) is the new live height.
  useLayoutEffect(() => {
    heightRef.current = height;
  }, [height, ceiling]);
  const targetH = useRef(height);
  const frame = useRef(0);
  // Wheel distance owed to the GRID: the part of a notch past the ceiling, and
  // any notch that arrives while the dock is still gliding up to it. Applied
  // when the glide lands, so every notch moves something (no dead scrolls).
  const pendingScroll = useRef(0);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  const stopGlide = () => {
    cancelAnimationFrame(frame.current);
    frame.current = 0;
  };
  useEffect(() => {
    const el = wheelRef?.current || section.current;
    if (!el) return undefined;
    const step = () => {
      const from = heightRef.current;
      const to = targetH.current;
      const diff = to - from;
      if (Math.abs(diff) < 0.5) {
        frame.current = 0;
        setLive(to);
        onResize(to); // commit once, at the end of the glide
        if (pendingScroll.current && strip.current) {
          strip.current.scrollBy({ top: pendingScroll.current, behavior: 'smooth' });
        }
        pendingScroll.current = 0;
        return;
      }
      // Nearly at the top: start paying the grid now rather than after the
      // easing tail (~0.4s), which read as a pause between notches.
      if (pendingScroll.current && to >= ceiling && Math.abs(diff) < 24 && strip.current) {
        strip.current.scrollBy({ top: pendingScroll.current, behavior: 'smooth' });
        pendingScroll.current = 0;
      }
      setLive(from + diff * 0.22);
      frame.current = requestAnimationFrame(step);
    };
    const onWheel = (e) => {
      if (e.ctrlKey) return; // pinch-zoom
      const delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? strip.current?.clientHeight || 400 : 1);
      const base = frame.current ? targetH.current : heightRef.current;
      const down = delta > 0;
      const canGrow = down && base < ceiling - 1;
      const canShrink = !down && base > minH && (strip.current?.scrollTop ?? 0) <= 0;
      if (!canGrow && !canShrink) {
        // Still gliding up to the ceiling: owe this notch to the grid.
        if (down && frame.current) {
          pendingScroll.current += delta;
          e.preventDefault();
          return;
        }
        // Over the tools (outside the grid) the wheel would otherwise do
        // nothing once the dock is at its ceiling — hand it to the grid.
        if (strip.current && !strip.current.contains(e.target)) strip.current.scrollTop += delta;
        return; // over the grid: native scrolling
      }
      if (canGrow && base + delta > ceiling) pendingScroll.current += base + delta - ceiling;
      if (canShrink) pendingScroll.current = 0;
      targetH.current = clampH(base + delta);
      e.preventDefault();
      if (!frame.current) frame.current = requestAnimationFrame(step);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [wheelRef, ceiling, minH, onResize, setLive, clampH]);

  // ── Drag + toggle (onboarding) ─────────────────────────────────────────────
  // Dragging tracks the pointer 1:1 (no animation, no snap); the button and a
  // double-click animate the height over DOCK_ANIM_MS.
  const startDrag = (e) => {
    e.preventDefault();
    stopGlide();
    // The root's bottom: the dock is bottom-anchored there (the transform only
    // slides it), so the dock's top sits at the pointer as in onboarding.
    const bottom = section.current.parentElement.getBoundingClientRect().bottom;
    document.body.style.cursor = 'ns-resize';
    const onMove = (ev) => setLive(clampH(bottom - ev.clientY));
    const onUp = () => {
      document.body.style.cursor = '';
      onResize(heightRef.current); // commit once, on release
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const [animating, setAnimating] = useState(false);
  const animTimer = useRef(0);
  useEffect(() => () => clearTimeout(animTimer.current), []);
  const toggle = () => {
    stopGlide();
    setAnimating(true);
    clearTimeout(animTimer.current);
    animTimer.current = setTimeout(() => setAnimating(false), DOCK_ANIM_MS + 50);
    if (expanded) strip.current?.scrollTo({ top: 0 });
    onResize(expanded ? minH : Number.MAX_SAFE_INTEGER);
  };

  // ── Body by state ──────────────────────────────────────────────────────────
  const [slow, setSlow] = useState(false);
  const loading = view === 'brands-loading' || view === 'loading';
  useEffect(() => {
    setSlow(false);
    if (!loading || media !== 'video') return undefined;
    const timer = setTimeout(() => setSlow(true), SLOW_VIDEO_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [loading, media]);

  let body;
  if (loading) {
    body = (
      <>
        <p className="mb-2 text-center text-xs text-zinc-500 dark:text-white/40" aria-live="polite">
          {slow
            ? 'Still matching videos, this can take up to 30 seconds…'
            : `Finding templates for ${brandName || 'your brand'}…`}
        </p>
        <Columns
          items={SKELETON_HEIGHTS.map((h, i) => ({ h, i }))}
          count={columnCount}
          getKey={(s) => s.i}
          renderItem={(s) => (
            <div
              aria-hidden
              className="animate-pulse rounded-sm border border-black/[0.05] bg-black/[0.04] dark:border-white/[0.06] dark:bg-white/[0.035]"
              style={{ height: s.h, animationDelay: `${(s.i % columnCount) * 110}ms` }}
            />
          )}
        />
      </>
    );
  } else if (view === 'no-brand') {
    body = <StatusBox>Pick a brand (top right) to see templates matched to it.</StatusBox>;
  } else if (view === 'error') {
    const canRetry = !NON_RETRYABLE.has(error?.code) && onRetry;
    body = (
      <StatusBox
        action={
          canRetry ? (
            <button type="button" onClick={onRetry} className={`${CONTROL} px-2.5 py-[5px]`}>
              <RefreshCw className="h-3.5 w-3.5" />
              Retry
            </button>
          ) : null
        }
      >
        {error?.message || 'We couldn’t load templates right now.'}
      </StatusBox>
    );
  } else if (!visible.length) {
    body = <StatusBox>No templates matched this brand yet. Try refreshing in a little while.</StatusBox>;
  } else {
    body = (
      <>
        <Columns
          items={visible}
          count={columnCount}
          getKey={(t) => t.template_id}
          renderItem={(t) => (
            <TemplateTile template={t} media={media} width={tileW} onSelect={onSelectTemplate} onBroken={markBroken} />
          )}
        />
        {isLoadingMore && (
          <div role="status" aria-label="Loading more templates" className="flex justify-center py-3">
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-black/10 border-t-[#0c9fbd] dark:border-white/15 dark:border-t-[#38E1FF]" />
          </div>
        )}
        {loadMoreError && !isLoadingMore && (
          <div className="flex justify-center py-3">
            <button
              type="button"
              onClick={() => {
                requestedAt.current = -1;
                onLoadMore?.();
              }}
              className={`${CONTROL} px-2.5 py-[5px]`}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Couldn&apos;t load more — retry
            </button>
          </div>
        )}
      </>
    );
  }

  return (
    <section
      ref={section}
      aria-label={title}
      className="absolute inset-x-0 bottom-0 z-20 flex min-h-0 flex-col overflow-hidden rounded-t-2xl border-t border-black/[0.07] bg-white shadow-[0_-20px_40px_-24px_rgba(24,24,27,0.18)] dark:border-white/[0.09] dark:bg-[#1B1B21] dark:shadow-[0_-20px_46px_rgba(0,0,0,0.5)]"
      style={{
        height: ceiling,
        transform: `translate3d(0, ${ceiling - height}px, 0)`,
        willChange: 'transform',
        transition: animating ? `transform ${DOCK_ANIM_MS}ms cubic-bezier(.4,0,.2,1)` : 'none',
      }}
    >
      {/* The resize handle (onboarding): on hover the strip tints and the grip
          widens and turns brand cyan; ns-resize says which way it moves. */}
      <div
        onMouseDown={startDrag}
        onDoubleClick={toggle}
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize templates panel"
        className="group/handle grid h-3.5 shrink-0 cursor-ns-resize place-items-center bg-[#F8F5EF] transition-colors duration-200 select-none hover:bg-[#0c9fbd]/[0.06] dark:bg-[#101317] dark:hover:bg-[#15DCFF]/[0.06]"
      >
        <span className="h-[3px] w-11 rounded-[2px] bg-[#C8C1B4] transition-all duration-200 group-hover/handle:w-16 group-hover/handle:bg-[#0c9fbd] group-hover/handle:shadow-[0_0_10px_rgba(12,159,189,0.45)] dark:bg-[#3a4149] dark:group-hover/handle:bg-[#15DCFF] dark:group-hover/handle:shadow-[0_0_10px_rgba(21,220,255,0.55)]" />
      </div>

      <div className={`flex shrink-0 items-center justify-between gap-4 pt-2 pb-1.5 select-none ${STUDIO_GUTTER}`}>
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <h2 className="shrink-0 text-sm font-semibold text-zinc-900 2xl:text-base dark:text-white">{title}</h2>
            {brandName && (
              <span className="hidden text-xs text-zinc-500 sm:inline dark:text-white/45">• Matched to {brandName}</span>
            )}
          </div>
          {subtitle && <p className="text-xs text-zinc-500 dark:text-white/45">{subtitle}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              disabled={refreshDisabled || isRefreshing}
              aria-label="Refresh templates"
              title="Refresh templates"
              className={`${CONTROL} h-[27px] w-[27px] justify-center`}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>
          )}
          <button
            type="button"
            onClick={toggle}
            aria-label={expanded ? 'Collapse templates drawer' : 'Expand templates drawer'}
            className={`${CONTROL} px-2.5 py-[5px]`}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={`transition-transform ${expanded ? 'rotate-180' : ''}`}
              aria-hidden
            >
              <path d="M7 15l5-5 5 5" />
            </svg>
            {expanded ? 'Collapse' : 'Expand all'}
          </button>
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1">
        <div
          ref={strip}
          onScroll={maybeLoadMore}
          // The dock is laid out at the ceiling height, so when it rests partly
          // raised its last (ceiling − height)px are below the screen edge; pad
          // the scroll by that much so the end of the grid can still be reached.
          // Same grid either way: expanded scrolls through it, collapsed crops it
          // at the dock's edge. overflowY is inline because setLive also flips it
          // mid-gesture.
          style={{
            overflowY: expanded ? 'auto' : 'hidden',
            paddingBottom: expanded ? ceiling - height + 14 : 0,
          }}
          className={`no-scrollbar min-h-0 min-w-0 flex-1 overflow-x-hidden pt-0.5 ${STUDIO_GUTTER}`}
        >
          {body}
        </div>
      </div>
    </section>
  );
}
