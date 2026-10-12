/**
 * StoryboardStoryPlayer — a concept's keyframes, played like a story.
 *
 * WHY THIS REPLACED THE PAIR. The card used to show exactly two frames side by
 * side with an arrow between them, because a storyboard WAS two frames: a
 * `first` and a `last`. Upstream now returns 1–8 (observed: 4), so the old
 * layout was silently throwing the middle of every concept away — the card read
 * "first → last" while the board held four scenes. Two portraits side by side
 * also cannot grow: a fifth frame has nowhere to go.
 *
 * One box that plays through them solves both. It is the same shape whatever
 * the frame count, and the count becomes a progress bar rather than a layout.
 *
 * ── Aspect ratio is the hard part ─────────────────────────────────────────
 * Frames no longer arrive in one shape. A 9:16 board and a 16:9 board can sit
 * in the same session, so the box cannot be sized from the picture and the
 * picture cannot be cropped to the box — `object-cover` on a landscape frame in
 * a portrait box throws away most of the scene. Every frame is therefore
 * `object-contain`, and the gap it leaves is filled with a blurred, scaled copy
 * of the same frame. Nothing is cropped, nothing is stretched, and there are no
 * black bars.
 *
 * The one exception is a frame that already fits (within 3%): blurring behind a
 * picture that covers the box is pure cost, so those render as a plain cover.
 *
 * ── Sharpness is a requirement, not a nicety ──────────────────────────────
 * These are the pictures the user judges a concept by. The foreground layer
 * therefore carries NO filter, NO transform, NO background-image and no resting
 * opacity below 1 — all four make a browser resample, and the result reads as
 * "the AI made a blurry image" rather than "the UI blurred it". It also never
 * upscales: once `naturalWidth` is known, a frame smaller than the box is
 * capped at its own pixel size and centred.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';

const LINE_STRONG = 'rgba(255,255,255,0.16)';

/** Upstream's ceiling. A ninth frame is a contract change, not a layout one. */
export const MAX_FRAMES = 8;

/**
 * How close a frame has to be to the box before the blur is skipped.
 *
 * 3% because the common case is a rounding error, not a different shape: the
 * frames come back 768x1376 against a 9:16 box, which is 0.4% off. Blurring
 * behind those would cost three layers to hide nothing.
 */
const RATIO_TOLERANCE = 0.03;

/**
 * How long each frame holds.
 *
 * 1200ms first, which was paced for a two-frame flick. With a board running
 * to eight that read as a flicker — the pictures changed faster than a scene
 * could be taken in, and the card looked busy rather than informative. Long
 * enough to actually take a frame in.
 */
const DEFAULT_INTERVAL_MS = 3500;

/** Opacity only. A slide or a zoom resamples the picture mid-flight. */
const FADE_MS = 200;

/*
 * There is deliberately no cross-card registry here.
 *
 * Only one card can be hovered, so on a desktop only one plays — the mutual
 * exclusion falls out of the interaction and does not need enforcing. On a
 * phone several cards can be on screen at once and all of them will cycle;
 * that is the same thing a list of autoplaying previews does everywhere else,
 * and arbitrating it would mean a module-level set of callbacks that has to
 * stay in step with derived state. Not worth it for a case nobody reported.
 */

function prefersReducedMotion() {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** The label above the picture. Named ends, numbered middles. */
function frameLabel(index, total) {
  if (total <= 1) return 'Frame';
  if (index === 0) return 'First';
  if (index === total - 1) return 'Last';
  return `Frame ${index + 1} of ${total}`;
}

/**
 * One frame, drawn as up to three layers.
 *
 * `active` drives the crossfade. A frame that is not active still renders (so
 * the fade has something to fade from, and so the next one is already decoded
 * when its turn comes) but is inert: no pointer events, nothing announced.
 */
function FrameLayers({ frame, active, alt, boxRatio, eager }) {
  // Natural size, once the browser knows it. Used for two things: deciding
  // whether this frame needs the blur, and refusing to upscale it.
  const [natural, setNatural] = useState(() =>
    frame?.width && frame?.height ? { w: frame.width, h: frame.height } : null
  );

  const onLoad = useCallback((e) => {
    const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
    if (w && h) setNatural((prev) => (prev && prev.w === w && prev.h === h ? prev : { w, h }));
  }, []);

  // Until the real shape is known, assume it fits. Guessing "needs blur" would
  // flash three layers in and then take them away again on the first paint.
  const fits = useMemo(() => {
    if (!natural || !boxRatio) return true;
    const ratio = natural.w / natural.h;
    return Math.abs(ratio - boxRatio) / boxRatio <= RATIO_TOLERANCE;
  }, [natural, boxRatio]);

  const src = frame?.src || '';
  if (!src) return null;

  // Never bigger than the file itself. Without this a 300px frame is blown up
  // to the full box and looks soft for a reason that has nothing to do with
  // the model that drew it.
  const cap = natural ? { maxWidth: `${natural.w}px`, maxHeight: `${natural.h}px` } : undefined;

  return (
    <div
      className="absolute inset-0 transition-opacity ease-out"
      style={{ opacity: active ? 1 : 0, transitionDuration: `${FADE_MS}ms` }}
      aria-hidden={!active}
    >
      {!fits && (
        <>
          {/* (a) The same picture, blurred past recognition and scaled up so its
              own soft edges fall outside the box. `thumbUrl` is welcome here —
              nobody can tell a low-res image from a high-res one through a
              28px blur, and it is the one layer that may be cheap. */}
          <img
            src={frame.thumbUrl || src}
            alt=""
            aria-hidden
            className="absolute inset-0 h-full w-full object-cover"
            style={{ filter: 'blur(28px) saturate(1.2)', transform: 'scale(1.15)' }}
          />
          {/* (b) Knocks the blur back so it reads as a surround rather than a
              second picture, and darkens the top so the bars and the label
              stay legible over a bright frame. */}
          <div className="absolute inset-0 bg-black/35" aria-hidden />
          <div
            className="absolute inset-x-0 top-0 h-16"
            style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.55), transparent)' }}
            aria-hidden
          />
        </>
      )}

      {/* (c) The picture itself. `contain` when it has to be letterboxed by the
          blur, `cover` when it already fits — see RATIO_TOLERANCE. */}
      <img
        src={src}
        alt={alt}
        width={natural?.w || undefined}
        height={natural?.h || undefined}
        decoding="async"
        loading={eager ? 'eager' : 'lazy'}
        onLoad={onLoad}
        className={cn(
          'absolute inset-0 m-auto h-full w-full',
          fits ? 'object-cover' : 'object-contain'
        )}
        style={cap}
      />
    </div>
  );
}

/**
 * The progress bars.
 *
 * The CURRENT bar is what actually drives the player: its `animationend` is
 * what advances the frame. Pausing is then a single `animationPlayState`, and
 * the bar can never disagree with the picture — which a separate `setTimeout`
 * would, every time the tab was backgrounded.
 */
function ProgressBars({ total, index, running, durationMs, onDone, onSeek, reduced }) {
  if (total <= 1) return null;

  return (
    // `top-0` with `py-2` on each button rather than `top-2` on the strip: the
    // track still paints 8px down, but the eight pixels above and below it are
    // now part of the button. A 3px-tall click target is a target nobody hits.
    //
    // The strip stays `pointer-events-none` so the GAPS between bars fall
    // through to the picture's own tap zones; only the buttons take clicks.
    <div className="pointer-events-none absolute inset-x-2 top-0 z-[2] flex gap-1">
      {Array.from({ length: total }, (_, i) => (
        <button
          key={i}
          type="button"
          onClick={(e) => {
            // Twice over: the card behind opens the concept, and the box's own
            // handler would read this as a tap zone and step by one.
            e.stopPropagation();
            onSeek(i);
          }}
          aria-label={`Show frame ${i + 1} of ${total}`}
          className="pointer-events-auto group flex-1 cursor-pointer py-2"
        >
          <span className="block h-[3px] overflow-hidden rounded-full bg-white/35 transition-colors group-hover:bg-white/55">
            {i < index && <span className="block h-full w-full bg-white" />}
            {i === index &&
              (reduced ? (
                <span className="block h-full w-full bg-white" />
              ) : (
                <span
                  // Keyed by index so stepping restarts the animation rather
                  // than resuming a bar that is already half-run.
                  key={index}
                  className="block h-full w-full origin-left bg-white"
                  style={{
                    animation: `sbsp-fill ${durationMs}ms linear forwards`,
                    animationPlayState: running ? 'running' : 'paused',
                  }}
                  onAnimationEnd={onDone}
                />
              ))}
          </span>
        </button>
      ))}
    </div>
  );
}

/**
 * Full-size view, stepping across every frame.
 *
 * Portalled to `document.body` for the reason it always was: every panel on
 * this screen clips its own overflow, so a modal rendered in place is cut by
 * the card it is meant to escape.
 */
export function FrameLightbox({ frames, startIndex = 0, onClose }) {
  const [index, setIndex] = useState(startIndex);
  const total = frames.length;
  const frame = frames[index] || frames[0];
  const canStep = total > 1;

  const step = useCallback(
    (delta) => setIndex((i) => (i + delta + total) % total),
    [total]
  );

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      if (!canStep) return;
      if (e.key === 'ArrowRight') step(1);
      if (e.key === 'ArrowLeft') step(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canStep, onClose, step]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <figure
        className="relative flex items-center justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          // Keyed so stepping actually swaps the picture rather than leaving
          // the old one up until the new file decodes.
          key={frame.src}
          src={frame.src}
          alt={frameLabel(index, total)}
          className="max-h-[88vh] max-w-[88vw] rounded-xl border border-white/15 object-contain shadow-[0_40px_120px_-20px_rgba(0,0,0,0.95)]"
        />
        {/* Top LEFT, not bottom right.
            The frames arrive with a caption strip burned into the bottom of
            the picture — upstream draws the beat ("0–2s · Ice and water splash
            into flask") into the image itself, so there is nothing on our side
            to move out of the way. A counter in the bottom-right corner lands
            squarely on the end of that sentence and neither can be read.
            Top left is the one corner the picture leaves alone, and it is
            where the card's own player already puts this same label. */}
        <figcaption className="absolute top-3 left-3 rounded bg-black/65 px-2 py-1 text-[10px] tracking-[0.08em] text-white/70 uppercase backdrop-blur-sm">
          {/* Counted, not named. "LAST FRAME" on a board of four said nothing
              about which of the four you were looking at. */}
          {total > 1 ? `Frame ${index + 1} of ${total}` : 'Frame'}
        </figcaption>
      </figure>

      {canStep && (
        <>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              step(-1);
            }}
            aria-label="Previous frame"
            className="absolute top-1/2 left-6 z-[2] grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full border text-white/80 backdrop-blur-md transition hover:border-[#15DCFF]/50 hover:text-white"
            style={{ background: 'rgba(14,14,17,0.9)', borderColor: LINE_STRONG }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M19 12H6M11 18l-6-6 6-6" />
            </svg>
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              step(1);
            }}
            aria-label="Next frame"
            className="absolute top-1/2 right-6 z-[2] grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full border text-white/80 backdrop-blur-md transition hover:border-[#15DCFF]/50 hover:text-white"
            style={{ background: 'rgba(14,14,17,0.9)', borderColor: LINE_STRONG }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M5 12h13M13 6l6 6-6 6" />
            </svg>
          </button>
        </>
      )}
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute top-6 right-6 z-[2] grid h-10 w-10 place-items-center rounded-full border text-white/80 transition hover:text-white"
        style={{ background: 'rgba(14,14,17,0.9)', borderColor: LINE_STRONG }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </div>,
    document.body
  );
}

/**
 * @param frames      1–8 ready frames, `{ src, thumbUrl?, width?, height? }`.
 * @param intervalMs  How long each frame holds.
 */
export default function StoryboardStoryPlayer({
  frames = [],
  intervalMs = DEFAULT_INTERVAL_MS,
  className,
}) {
  const shown = useMemo(() => frames.slice(0, MAX_FRAMES), [frames]);
  const total = shown.length;

  const boxRef = useRef(null);
  const [index, setIndex] = useState(0);
  // What makes the story move, and the three things that hold it still. See
  // `playingNow` below.
  const [hovered, setHovered] = useState(false);
  const [touchVisible, setTouchVisible] = useState(false);
  const [held, setHeld] = useState(false);
  const [paused, setPaused] = useState(false);
  const [open, setOpen] = useState(false);
  const [boxRatio, setBoxRatio] = useState(9 / 16);
  const [decoded, setDecoded] = useState(() => new Set());

  const reduced = prefersReducedMotion();
  // One frame is a picture, not a story. Reduced motion steps by hand.
  const canPlay = total > 1 && !reduced;

  // ── The box's own shape, measured ────────────────────────────────────────
  // Needed to decide whether a frame "already fits". Measured rather than
  // assumed because the card is fluid: the same box is a different ratio on a
  // narrow viewport, and a frame that fits at one width letterboxes at another.
  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const measure = () => {
      const { clientWidth: w, clientHeight: h } = el;
      if (w && h) setBoxRatio(w / h);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /**
   * Whether the story is moving right now.
   *
   * The card is still by default and the pointer is what starts it. Letting
   * all three play on their own was tried and taken back out: a rail of three
   * concepts cycling at once is three things moving in the corner of your eye
   * while you are trying to read one of them.
   *
   * Derived from separate flags rather than one `running` boolean, which is
   * what the flags are worth keeping. They overlap constantly — a pointer
   * resting on a card that is also half scrolled off — and with one boolean
   * whichever handler fired last won, so a card could end up stopped with
   * nothing left to start it, or running with the pointer long gone. Each flag
   * now clears itself and only itself.
   *
   *   hovered      — the pointer is on this card. This is what plays it.
   *   touchVisible — the phone's stand-in for hover: a finger cannot rest on a
   *                  card, so being on screen has to mean the same thing. Set
   *                  only on a coarse pointer, or it would fight `mouseleave`
   *                  on a desktop and replay a card just left behind.
   *   held         — pressed and holding, which is how a finger pauses.
   *   paused       — the pause button, or Space.
   *   open         — the full-size view is up; nothing should move behind it.
   *
   * What leaving does NOT do is rewind. That was the original behaviour and it
   * was wrong in the hand: the story reaches an interesting frame, you look
   * away from the moving thing to read it, and the act of looking away is what
   * takes it off the screen.
   */
  const playingNow =
    canPlay && (hovered || touchVisible) && !held && !paused && !open;

  // ── Preload the next frame or two ────────────────────────────────────────
  // `decode()` rather than `onload`: a loaded-but-undecoded image still blanks
  // for a frame when it is first painted, which at this cadence is visible.
  // The result gates the progress bar below — the story never advances onto a
  // frame that is not ready to be seen.
  useEffect(() => {
    let cancelled = false;
    const targets = [shown[index], shown[(index + 1) % total], shown[(index + 2) % total]]
      .filter((f) => f?.src)
      .map((f) => f.src);

    targets.forEach((src) => {
      if (decoded.has(src)) return;
      const img = new Image();
      img.src = src;
      const settle = () => {
        if (cancelled) return;
        setDecoded((prev) => (prev.has(src) ? prev : new Set(prev).add(src)));
      };
      // A decode failure still counts as settled: a frame whose file is broken
      // must not hold the story on the previous one for ever.
      img.decode ? img.decode().then(settle, settle) : (img.onload = settle);
    });

    return () => {
      cancelled = true;
    };
  }, [index, shown, total, decoded]);

  const nextSrc = total > 1 ? shown[(index + 1) % total]?.src : '';
  const nextReady = !nextSrc || decoded.has(nextSrc);
  const barRunning = playingNow && nextReady;

  const advance = useCallback(() => setIndex((i) => (i + 1) % total), [total]);

  const step = useCallback(
    (delta) => setIndex((i) => (i + delta + total) % total),
    [total]
  );

  // ── Touch: play what is actually on screen ───────────────────────────────
  // There is no hover on a phone, so visibility stands in for intent. 60%,
  // because a card half off the bottom of the viewport is not being looked at.
  useEffect(() => {
    const el = boxRef.current;
    if (!el || !canPlay || typeof IntersectionObserver === 'undefined') return undefined;
    // Coarse pointers only. On a desktop this would fight `mouseleave` and
    // restart a card the user had deliberately moved away from.
    if (window.matchMedia && !window.matchMedia('(pointer: coarse)').matches) return undefined;

    const io = new IntersectionObserver(
      ([entry]) => setTouchVisible(entry.isIntersecting),
      { threshold: 0.6 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [canPlay]);

  if (!total) return null;

  // Left third goes back, the rest goes forward — the proportion every story
  // player uses, because forward is the common intent.
  const onZoneClick = (e) => {
    // The card behind this box opens the concept, and the box's own job is to
    // step frames. Without this, every tap did both.
    e.stopPropagation();
    if (total <= 1) return;
    const { left, width } = e.currentTarget.getBoundingClientRect();
    step(e.clientX - left < width * 0.3 ? -1 : 1);
  };

  return (
    <div
      ref={boxRef}
      className={cn(
        // FILLS the card, rather than locking itself to 9:16. The box was
        // portrait first and the card is wide, so one 9:16 box left two thirds
        // of the row empty and the whole concept read as a thumbnail. The blur
        // is what the spare width is for — it was always going to be filled by
        // something, and a blurred copy of the frame beats dead card.
        'relative h-full min-h-0 w-full overflow-hidden rounded-lg border bg-black/35 transition-colors duration-300 hover:border-[#15DCFF]/50 focus-visible:border-[#15DCFF]/60 focus-visible:outline-none',
        className
      )}
      style={{ borderColor: LINE_STRONG }}
      // Focusable so the keyboard can reach it; `role="group"` rather than
      // `button` because it is not one action, it is a small control panel.
      tabIndex={0}
      role="group"
      aria-label={`Storyboard preview, frame ${index + 1} of ${total}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onPointerDown={() => setHeld(true)}
      onPointerUp={() => setHeld(false)}
      onPointerCancel={() => setHeld(false)}
      onClick={onZoneClick}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          step(1);
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          step(-1);
        } else if (e.key === ' ' || e.key === 'Spacebar') {
          e.preventDefault();
          setPaused((p) => !p);
        }
      }}
    >
      {/* The animation lives here rather than in a stylesheet so the component
          stays one file and can be dropped anywhere. */}
      <style>{'@keyframes sbsp-fill { from { transform: scaleX(0) } to { transform: scaleX(1) } }'}</style>

      {shown.map((frame, i) => {
        // Only what is needed: the frame on screen, the one it came from, and
        // the next two being preloaded. Mounting all eight would fetch 24
        // images across the three cards the moment the rail appeared.
        const near =
          i === index ||
          i === (index + 1) % total ||
          i === (index + 2) % total ||
          i === (index - 1 + total) % total;
        if (!near) return null;
        return (
          <FrameLayers
            key={frame.src || i}
            frame={frame}
            active={i === index}
            eager={i === 0}
            boxRatio={boxRatio}
            alt={`Storyboard frame ${i + 1} of ${total}`}
          />
        );
      })}

      <ProgressBars
        total={total}
        index={index}
        running={barRunning}
        durationMs={intervalMs}
        onDone={advance}
        // Jump straight to that frame. Playing stays playing — the bar it
        // lands on starts filling from zero, so a click reads as "start this
        // one" rather than as a pause.
        onSeek={setIndex}
        reduced={reduced}
      />

      {/* Label and the play/pause state, on the gradient the blur layer drew.
          `pointer-events-none` on the label so it never eats a tap zone. */}
      <span
        className="pointer-events-none absolute top-[11px] left-2 z-[3] rounded bg-black/55 px-1.5 py-0.5 text-[10px] font-semibold text-white backdrop-blur-sm"
      >
        {frameLabel(index, total)}
      </span>

      {canPlay && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setPaused((p) => !p);
          }}
          aria-label={playingNow ? 'Pause preview' : 'Play preview'}
          className="absolute top-[9px] right-2 z-[3] grid h-6 w-6 place-items-center rounded-full bg-black/55 text-white/85 backdrop-blur-sm transition hover:text-white"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            {playingNow ? <path d="M7 5h4v14H7zM13 5h4v14h-4z" /> : <path d="M8 5v14l11-7z" />}
          </svg>
        </button>
      )}

      {/* Full size is its own control now. The picture itself is a tap zone, so
          clicking it can no longer mean "open" as well as "next". */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          // `open` is one of the reasons in `playingNow`, so the story is
          // already held — nothing else to do here.
          setOpen(true);
        }}
        aria-label="Open frame full size"
        className="absolute right-2 bottom-2 z-[3] grid h-7 w-7 place-items-center rounded-md bg-black/55 text-white/85 backdrop-blur-sm transition hover:text-white"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
        </svg>
      </button>

      {open && (
        <FrameLightbox frames={shown} startIndex={index} onClose={() => setOpen(false)} />
      )}
    </div>
  );
}
