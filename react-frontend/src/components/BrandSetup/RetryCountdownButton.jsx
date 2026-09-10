/**
 * Retry, but not yet.
 *
 * A render that just failed is very often a service having a bad minute, and
 * the worst thing a user can do about that is press the button again
 * immediately — each attempt freezes credits, queues work upstream, and comes
 * back with the same answer. So the button exists straight away (the offer is
 * visible, nothing is hidden) but refuses to be pressed for twenty seconds.
 *
 * The wait is drawn INSIDE the button as a ring that empties, rather than as a
 * separate countdown label. A number ticking down next to a dead button reads
 * as two controls arguing; a button that visibly fills up reads as one control
 * getting ready. When the ring is gone the button is live.
 *
 * Used from two places — the concept card in the workspace and the failed clip
 * screen — because it is the same decision in both, and duplicating a timer is
 * how the two drift into disagreeing about how long the wait is.
 */

import { useEffect, useRef, useState } from 'react';

// Twenty seconds. Long enough that a transient upstream failure has usually
// cleared, short enough that a user who is watching does not go and do
// something else.
const WAIT_MS = 20_000;

// Geometry for the ring. Small enough to sit inside a 12.5px-text button
// without changing its height.
const R = 7;
const CIRCUMFERENCE = 2 * Math.PI * R;

export default function RetryCountdownButton({ onClick, label = 'Retry', waitMs = WAIT_MS }) {
  // Fraction of the wait still to go, 1 → 0. Animated rather than counted in
  // whole seconds so the ring moves smoothly instead of jumping in twentieths.
  const [remaining, setRemaining] = useState(1);
  const startedAt = useRef(Date.now());

  useEffect(() => {
    startedAt.current = Date.now();
    let frame = 0;

    const tick = () => {
      const elapsed = Date.now() - startedAt.current;
      const left = Math.max(0, 1 - elapsed / waitMs);
      setRemaining(left);
      // Stop the loop at zero. An rAF that runs for the life of the screen
      // keeps the tab awake for a button that is already enabled.
      if (left > 0) frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [waitMs]);

  const waiting = remaining > 0;
  // Ceil, so the label reads "20" for the whole first second rather than
  // flicking to 19 immediately.
  const secondsLeft = Math.ceil((remaining * waitMs) / 1000);

  return (
    <button
      type="button"
      onClick={waiting ? undefined : onClick}
      disabled={waiting}
      // `aria-disabled` alongside the real `disabled`: a screen reader should
      // hear that the control exists and is temporarily unavailable, not skip
      // past it as if the offer were never made.
      aria-disabled={waiting}
      aria-label={waiting ? `${label} — available in ${secondsLeft} seconds` : label}
      className={
        waiting
          ? 'inline-flex shrink-0 cursor-not-allowed items-center gap-2 rounded-[7px] border border-white/10 bg-white/[0.06] px-3 py-1.5 text-[12px] font-bold text-white/40'
          : 'inline-flex shrink-0 items-center gap-2 rounded-[7px] bg-[linear-gradient(180deg,#9176ff_0%,#7c5cff_46%,#6148c7_100%)] px-3 py-1.5 text-[12px] font-bold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.4),inset_0_-1px_0_rgba(0,0,0,0.28)] transition hover:brightness-110 active:translate-y-px'
      }
    >
      {waiting && (
        <svg width="16" height="16" viewBox="0 0 18 18" className="shrink-0" aria-hidden>
          {/* The track, so the ring reads as "emptying" rather than as a stray
              arc floating on the button. */}
          <circle cx="9" cy="9" r={R} fill="none" strokeWidth="2" stroke="rgba(255,255,255,0.14)" />
          <circle
            cx="9"
            cy="9"
            r={R}
            fill="none"
            strokeWidth="2"
            strokeLinecap="round"
            stroke="rgba(255,255,255,0.6)"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={CIRCUMFERENCE * (1 - remaining)}
            // Twelve o'clock start. Without this the arc begins at three, which
            // reads as already part-spent.
            transform="rotate(-90 9 9)"
          />
        </svg>
      )}
      <span className="whitespace-nowrap">{waiting ? `${label} in ${secondsLeft}s` : label}</span>
    </button>
  );
}

export { WAIT_MS };
