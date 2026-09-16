/**
 * The "something is being made here" loaders — design handoff
 * `design_handoff_frame_loaders` (options 4b and 5b), 2026-09-16.
 *
 * Three layers, back to front, shared by both surfaces:
 *
 *   1. two blurred glow orbs, drifting slowly (indigo top-left, violet bottom-right)
 *   2. a mosaic of cells, each settling between 0.16 and 0.42 opacity on its own
 *      delay — deliberately dim: it must read as TEXTURE, not as window panes
 *   3. a blurred scrim that darkens top and bottom so type stays legible
 *
 * It replaces `MosaicLoader` on the clip screen's first stage and inside the
 * concept cards' keyframe slots. `MosaicLoader` itself stays: the whole-card
 * skeletons (before any storyboard exists) still use it.
 *
 * Everything animates in CSS. No timers, no state, no work on the main thread
 * while the render the user is actually waiting for is in flight — the only
 * JS clock here is the copy rotation, which is one interval per surface.
 */

import { useEffect, useState } from 'react';

/* ── tokens from the handoff ─────────────────────────────────────────────── */
const CYAN = '#15DCFF';
const TINTS = [
  'rgba(21,220,255,0.55)', // cyan
  'rgba(94,102,245,0.60)', // indigo
  'rgba(124,92,255,0.55)', // violet
];
const PLAIN = 'rgba(255,255,255,0.55)';

/** Copy rotation: 4.2s between lines, 0.9s rise-and-fade on the way in. */
export const COPY_EVERY_MS = 4200;

/**
 * The rotating line. Returns the text and a key that changes with it, so the
 * caller can re-key its element and replay the enter animation.
 */
export function useRotatingCopy(lines, active = true) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (!active || lines.length < 2) return undefined;
    const id = setInterval(() => setIndex((i) => (i + 1) % lines.length), COPY_EVERY_MS);
    return () => clearInterval(id);
  }, [active, lines.length]);
  return lines[index % lines.length];
}

/** The keyframes, once per mounted loader. Cheap, and keeps this file portable. */
function LoaderKeyframes() {
  return (
    <style>{`
      @keyframes fl-bloomA {
        0%   { transform: translate(-6%, 4%) scale(1) }
        50%  { transform: translate(10%, -8%) scale(1.25) }
        100% { transform: translate(-6%, 4%) scale(1) }
      }
      @keyframes fl-bloomB {
        0%   { transform: translate(8%, -4%) scale(1.15) }
        50%  { transform: translate(-10%, 10%) scale(0.95) }
        100% { transform: translate(8%, -4%) scale(1.15) }
      }
      @keyframes fl-cellSettle { 0%, 100% { opacity: 0.16 } 50% { opacity: 0.42 } }
      @keyframes fl-softFade   { 0%, 100% { opacity: 0.18 } 50% { opacity: 0.6 } }
      @keyframes fl-rise {
        0%   { opacity: 0; transform: translateY(8px) }
        100% { opacity: 1; transform: none }
      }
      @keyframes fl-sweep {
        0%   { transform: translateX(-120%) }
        100% { transform: translateX(120%) }
      }
      /* Reduced motion: the drift and the cell pulse go; the copy rotation and a
         static rule stay, so the surface still says "working" without moving. */
      @media (prefers-reduced-motion: reduce) {
        .fl-orb  { animation: none !important }
        .fl-cell { animation: none !important; opacity: 0.28 !important }
        .fl-rule { animation: none !important; transform: none !important }
      }
    `}</style>
  );
}

/**
 * Layers 1–3.
 *
 * @param cols/rows/gap/pad  the mosaic's shape — 4×7 @10px on the clip card,
 *   3×6 @8px in a concept card's frame slot (the slots are much smaller).
 * @param seed  shifts which cells are tinted and their delays, so two frames
 *   side by side never show the same pattern.
 * @param orbs  `{ a: {...}, b: {...} }` sizes/offsets; the clip card's orbs are
 *   bigger than a frame slot's.
 */
export function SettleLayers({ cols, rows, gap, pad, seed = 0, orbs, scrim }) {
  const cells = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const i = r * cols + c;
      // Every third cell carries brand colour; the rest are plain white at low
      // opacity. Seeded so the two frames in a card differ.
      const colored = (i + seed) % 3 === 1;
      const delay = (r * 0.42 + c * 0.31 + seed * 0.7).toFixed(2);
      cells.push(
        <div
          key={i}
          className="fl-cell"
          style={{
            background: colored ? TINTS[(i + seed) % TINTS.length] : PLAIN,
            opacity: 0.16,
            animation: `fl-cellSettle 6.5s ease-in-out ${delay}s infinite`,
          }}
        />
      );
    }
  }

  return (
    <>
      <LoaderKeyframes />
      {/* 1 — the orbs */}
      <div
        aria-hidden
        className="fl-orb pointer-events-none absolute rounded-full"
        style={{
          width: orbs.a.size,
          height: orbs.a.size,
          left: orbs.a.left,
          top: orbs.a.top,
          background: 'radial-gradient(circle, rgba(94,102,245,0.34) 0%, rgba(94,102,245,0) 68%)',
          filter: `blur(${orbs.a.blur}px)`,
          animation: 'fl-bloomA 13s ease-in-out infinite',
        }}
      />
      <div
        aria-hidden
        className="fl-orb pointer-events-none absolute rounded-full"
        style={{
          width: orbs.b.size,
          height: orbs.b.size,
          right: orbs.b.right,
          bottom: orbs.b.bottom,
          background: 'radial-gradient(circle, rgba(124,92,255,0.30) 0%, rgba(124,92,255,0) 70%)',
          filter: `blur(${orbs.b.blur}px)`,
          animation: 'fl-bloomB 16s ease-in-out infinite',
        }}
      />

      {/* 2 — the mosaic */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 grid"
        style={{
          gridTemplateColumns: `repeat(${cols}, 1fr)`,
          gridTemplateRows: `repeat(${rows}, 1fr)`,
          gap: `${gap}px`,
          padding: `${pad}px`,
          boxSizing: 'border-box',
        }}
      >
        {cells}
      </div>

      {/* 3 — the scrim */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)', background: scrim }}
      />
    </>
  );
}

/**
 * 4b — the clip screen's first stage.
 *
 * Fills whatever 9:16 box it is given. The caller owns the frame; this owns
 * everything inside it, including the status chip and the footer.
 */
export function ClipSettleLoader({ line }) {
  return (
    <div className="absolute inset-0 overflow-hidden" style={{ background: '#0f1017' }}>
      <SettleLayers
        cols={4}
        rows={7}
        gap={10}
        pad={10}
        orbs={{
          a: { size: 400, left: -110, top: 50, blur: 34 },
          b: { size: 360, right: -120, bottom: 90, blur: 36 },
        }}
        scrim="linear-gradient(to bottom, rgba(15,16,23,0.66) 0%, rgba(15,16,23,0.32) 45%, rgba(15,16,23,0.92) 100%)"
      />

      {/* Status chip — a pulsing cyan square and one word. No percentage and no
          estimate anywhere on this screen: the backend cannot confirm either. */}
      <div className="absolute top-[22px] left-[22px] z-[2] flex items-center gap-[9px]">
        <span
          className="block h-1.5 w-1.5"
          style={{ background: CYAN, boxShadow: `0 0 10px ${CYAN}`, animation: 'fl-softFade 2.6s ease-in-out infinite' }}
          aria-hidden
        />
        <span className="text-[11px] tracking-[0.18em] uppercase" style={{ color: '#c3c8dd' }}>
          Working
        </span>
      </div>

      {/* Footer — the rotating line over an indeterminate rule. */}
      <div className="absolute right-[22px] bottom-6 left-[22px] z-[2] flex flex-col gap-4">
        <div
          className="min-h-16 text-[28px] leading-[1.12] font-semibold tracking-[-0.025em] text-white"
          aria-live="polite"
        >
          <span key={line} className="block" style={{ animation: 'fl-rise .9s cubic-bezier(.2,.7,.2,1) both' }}>
            {line}
          </span>
        </div>
        <div className="h-0.5 overflow-hidden" style={{ background: 'rgba(255,255,255,0.09)' }}>
          <div
            className="fl-rule h-full w-full"
            style={{
              background:
                'linear-gradient(to right, rgba(21,220,255,0) 0%, #15DCFF 40%, #7C5CFF 70%, rgba(124,92,255,0) 100%)',
              animation: 'fl-sweep 2.6s ease-in-out infinite',
            }}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * 5b — one keyframe slot in a concept card while the frames are being drawn.
 *
 * Smaller mosaic and smaller orbs than the clip card, because the slot is
 * roughly a fifth of the size. The scrim is tuned to the card's own surface
 * (`SURF`) rather than the clip card's darker ground.
 */
export function FrameSettleLoader({ seed = 0 }) {
  return (
    <SettleLayers
      cols={3}
      rows={6}
      gap={8}
      pad={8}
      seed={seed}
      orbs={{
        a: { size: 280, left: -70, top: 60, blur: 30 },
        b: { size: 260, right: -80, bottom: 40, blur: 32 },
      }}
      scrim="linear-gradient(to bottom, rgba(27,27,33,0.60) 0%, rgba(27,27,33,0.30) 50%, rgba(27,27,33,0.78) 100%)"
    />
  );
}

/**
 * The line under the frames in a concept card: a pulsing cyan dot and the
 * rotating copy. Generic on purpose — the UI cannot tell which of the two
 * frames is in flight, so it never says "First" or "Last".
 */
export function FrameStatusLine({ line }) {
  return (
    <div className="pointer-events-none absolute right-3 bottom-3 left-3 z-[4] flex items-center justify-center gap-2">
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ background: CYAN, boxShadow: `0 0 10px ${CYAN}`, animation: 'fl-softFade 2.6s ease-in-out infinite' }}
        aria-hidden
      />
      <span
        key={line}
        className="text-[11px] font-semibold tracking-[0.1em] uppercase"
        style={{
          color: 'rgba(255,255,255,0.78)',
          textShadow: '0 1px 6px rgba(0,0,0,0.8)',
          animation: 'fl-rise .9s cubic-bezier(.2,.7,.2,1) both',
        }}
      >
        {line}
      </span>
    </div>
  );
}

/** The copy each surface rotates through. Straight from the handoff. */
export const CLIP_LINES = ['Reading your brief', 'Studying the frames', 'Shaping the cut'];
export const FRAME_LINES = ['Drawing your keyframes', 'Composing the scene', 'Almost there'];
