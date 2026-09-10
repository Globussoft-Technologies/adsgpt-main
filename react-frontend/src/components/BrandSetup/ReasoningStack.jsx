// ReasoningStack — the run's steps as a receding stack of cards.
//
// The newest step arrives at the front; everything before it slides back,
// shrinks and dims. Only the last few are drawn at all — the point is the
// current thought, with just enough history behind it to show the work is
// accumulating rather than flickering.
//
// Two structural decisions:
//
//   • Depth and entry are on SEPARATE elements. The outer div owns the depth
//     transform, which transitions whenever a card's index changes; the inner
//     div owns the entry animation. Putting both on one element means the entry
//     keyframes fight the depth transition and the card jumps.
//   • Cards are keyed by step id and never reordered in the DOM. Their depth is
//     derived from position, so React only ever appends — the browser animates
//     the rest.
//
// Styling follows the setup panel it replaces — the same glass, the same
// white-on-video type, the same cyan→indigo accent — but a shade denser. The
// panel had nothing behind it; these cards sit on top of each other, so any
// transparency compounds and the stack turns to mud over bright footage.
//
// This screen cannot use the Warm Ivory workspace tokens: it sits on video, and
// `--ws-text-primary` would render near-black on a dark ground in light mode.

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

// Four, not five. Every card is translucent glass, so each one behind the front
// is another layer the eye has to see past; over bright footage five was mud.
const DEPTH = 4;

// Depth geometry. `OPACITY_STEP` is steeper than the reference's 0.26 for the
// same reason — the reference sits on a flat surface, this sits on video.
const LIFT = 13;
const SHRINK = 0.052;
const OPACITY_STEP = 0.3;

// Every card is the same height, and the box is sized from it.
//
// Measuring the front card instead looked correct until a two-line message
// followed a one-line one: the box resized, the whole stack shifted, and the
// header appeared to bob. Text length is not something the layout should be
// able to move. Two lines of body plus the eyebrow fits in 84px; anything
// longer is clamped.
const CARD_H = 84;
const STACK_H = CARD_H + (DEPTH - 1) * LIFT;

export default function ReasoningStack({ steps = [], percent = 0, done = false, className }) {
  // The newest card animates in; every other is already settled. Tracking the
  // id rather than a boolean means a re-render for any other reason does not
  // replay the entry.
  const [entered, setEntered] = useState(null);
  const latest = steps.length ? steps[steps.length - 1].id : null;
  const frame = useRef(null);

  useEffect(() => {
    if (latest == null || entered === latest) return undefined;
    // Two frames: one to commit the "below" starting position, one to release
    // it. A single frame gets batched with the mount and the card appears
    // already in place.
    frame.current = requestAnimationFrame(() => {
      frame.current = requestAnimationFrame(() => setEntered(latest));
    });
    return () => frame.current && cancelAnimationFrame(frame.current);
  }, [latest, entered]);

  const visible = steps.slice(-DEPTH);

  return (
    <div className={cn('w-full max-w-140', className)}>
      {/* header ─ mirrors the eyebrow/count line of the reference */}
      {/* Both labels sit directly on footage with no card behind them, so they
          run brighter than they would inside the panel. */}
      <div className="mb-2.5 flex items-baseline justify-between px-1">
        <span className="flex items-center gap-2 text-[13px] font-medium text-white">
          {!done && (
            <span
              aria-hidden
              className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#15DCFF]"
            />
          )}
          {done ? 'Done' : 'Working'}
        </span>
        <span className="text-[12px] text-white/75 tabular-nums">
          {steps.length ? `${steps.length} step${steps.length === 1 ? '' : 's'}` : ''}
        </span>
      </div>

      {/* The stack is a constant box and the front card is pinned to its BOTTOM
          edge, so the newest card sits in the same place from the first step to
          the last. Older cards recede upward inside the reserved space above —
          they can never reach the labels, and nothing reflows when a message
          runs to two lines. */}
      <div className="relative" style={{ height: `${STACK_H}px` }} aria-live="polite">
        {visible.map((step, i) => {
          // 0 = newest. Depth grows toward the back of the stack.
          const depth = visible.length - 1 - i;
          const isNew = step.id === latest && entered !== latest;

          return (
            <div
              key={step.id}
              className="absolute right-0 bottom-0 left-0 will-change-transform"
              style={{
                transform: `translateY(${-depth * LIFT}px) scale(${1 - depth * SHRINK})`,
                opacity: depth >= DEPTH - 1 ? 0 : 1 - depth * OPACITY_STEP,
                zIndex: 100 - depth,
                transition:
                  'transform .75s cubic-bezier(.16,1,.3,1), opacity .75s cubic-bezier(.16,1,.3,1)',
              }}
            >
              <div
                className={cn(
                  // 96% rather than 85%. At 85% the cards stacked behind this
                  // one were legible THROUGH it, which is what made the whole
                  // stack look like overlapping text rather than depth.
                  'flex flex-col justify-center rounded-[14px] px-4 backdrop-blur-2xl',
                  // 98%, not 85%. At 85% the cards behind this one were legible
                  // THROUGH it, which is what made the stack read as overlapping
                  // text rather than depth.
                  'bg-[#0B0D10]/98',
                  // The front card carries a lit edge; the ones behind fade to
                  // a plain hairline so the eye lands on the newest.
                  depth === 0
                    ? 'border border-white/18 shadow-[0_18px_50px_-16px_rgba(0,0,0,0.9)]'
                    : 'border border-white/8',
                  'transition-[transform,opacity] duration-[750ms] ease-[cubic-bezier(.16,1,.3,1)]',
                  isNew ? 'translate-y-[26px] opacity-0' : 'translate-y-0 opacity-100'
                )}
                style={{ height: `${CARD_H}px` }}
              >
                <div
                  className={cn(
                    'mb-1 text-[11px] font-medium tracking-wide tabular-nums',
                    depth === 0 ? 'text-[#15DCFF]' : 'text-[#15DCFF]/55'
                  )}
                >
                  {step.eyebrow}
                </div>
                {/* Two lines, clamped. A card is a glance; letting it grow is
                    what made the box change size under the header. */}
                <div
                  className={cn(
                    'line-clamp-2 text-[14px] leading-[1.5]',
                    depth === 0 ? 'text-white' : 'text-white/70'
                  )}
                >
                  {step.text}
                </div>
              </div>
            </div>
          );
        })}

        {!visible.length && (
          <div className="absolute right-0 bottom-0 left-0">
            <div
              className="flex flex-col justify-center rounded-[14px] border border-white/18 bg-[#0B0D10]/98 px-4 shadow-[0_18px_50px_-16px_rgba(0,0,0,0.9)] backdrop-blur-2xl"
              style={{ height: `${CARD_H}px` }}
            >
              <div className="mb-1 text-[11px] font-medium tracking-wide text-[#15DCFF]">
                Starting
              </div>
              <div className="text-[14px] leading-[1.5] text-white/75">
                Reading what you gave us…
              </div>
            </div>
          </div>
        )}
      </div>

      {/* progress ─ a hairline in the same gradient as the Analyze button */}
      {/* 3px, not 1px. A hairline reads fine on a flat surface and disappears
          entirely over moving footage — the track needs enough body to be seen
          as an object before the fill means anything. */}
      <div className="mt-4 h-[3px] w-full overflow-hidden rounded-full bg-black/50 ring-1 ring-white/15">
        <i
          className="block h-full rounded-full transition-[width] duration-1000 ease-[cubic-bezier(.25,.8,.3,1)]"
          style={{
            width: `${percent}%`,
            backgroundImage: 'linear-gradient(90deg, #15DCFF 0%, #5E66F5 100%)',
            boxShadow: '0 0 12px rgba(21,220,255,0.55)',
          }}
        />
      </div>
    </div>
  );
}
