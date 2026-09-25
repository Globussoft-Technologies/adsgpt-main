// OnboardingTour — a first-visit coachmark tour for the onboarding screens.
//
// Used by Workspace (brand → ideas → Generate → templates) and ClipView
// (player → send it out → edit, for images → concept).
//
// ── How it finds things ─────────────────────────────────────────────────────
// Each step names a CSS selector, looked up INSIDE `rootRef`. The screens mark
// their regions with `data-tour="…"`; nothing else about them changes. A step
// whose target is missing or has no size (a card already rendered, so no
// Generate button; the brand panel hidden below `lg`) is skipped, so the tour
// never points at empty space.
//
// ── Why it is positioned inside the root, not `fixed` ───────────────────────
// Every rect is measured relative to `rootRef`, and the overlay is `absolute`
// inside it. An ancestor with a transform would otherwise become the containing
// block for `fixed` children and desync the spotlight from its target. The root
// must therefore be `position: relative`.
//
// ── Why it stays in sync ────────────────────────────────────────────────────
// The Workspace moves under the tour: the brand panel animates its width, the
// dock can be dragged, and the ideas section scrolls. A ResizeObserver on the
// target and root, plus scroll (capture) and window resize, re-measure on each.
//
// The dim is one element with a huge box-shadow, so the cut-out has real
// rounded corners. The overlay swallows clicks: pressing Next must never also
// press the Generate button sitting under the spotlight.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { IS_ONBOARDING_TOUR_ENABLED } from '@/utils/featureFlags';
import useTourSeen from './useTourSeen';

// HIDE-MARK — "Replay tour" button (kept on for testing, 2026-09-17).
// Set to false to hide it. Independent of VITE_FEATURE_ONBOARDING_TOUR, which
// only controls auto-start and the backend "seen" flag.
const SHOW_REPLAY_BUTTON = true;

const PAD = 8; // spotlight breathing room around the target
const GAP = 14; // spotlight → tooltip
const EDGE = 16; // tooltip never closer than this to the root's edge
const TT_W = 320;
const START_DELAY_MS = 600;

const SURF = '#1B1B21';
const LINE_STRONG = 'rgba(255,255,255,0.16)';

function findTarget(root, selector) {
  if (!root || !selector) return null;
  const el = root.querySelector(selector);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? el : null;
}

/** Below → above → right → left, clamped inside the root. */
function placeTooltip(spot, ttH, vw, vh) {
  const clampX = (x) => Math.min(Math.max(x, EDGE), vw - TT_W - EDGE);
  const clampY = (y) => Math.min(Math.max(y, EDGE), vh - ttH - EDGE);
  const centreX = spot.left + spot.width / 2 - TT_W / 2;

  if (spot.top + spot.height + GAP + ttH <= vh - EDGE)
    return { top: spot.top + spot.height + GAP, left: clampX(centreX) };
  if (spot.top - GAP - ttH >= EDGE) return { top: spot.top - GAP - ttH, left: clampX(centreX) };
  if (spot.left + spot.width + GAP + TT_W <= vw - EDGE)
    return { top: clampY(spot.top), left: spot.left + spot.width + GAP };
  if (spot.left - GAP - TT_W >= EDGE) return { top: clampY(spot.top), left: spot.left - GAP - TT_W };
  // Target fills the screen: float the card over its bottom-right corner.
  return { top: clampY(vh - ttH - EDGE * 2), left: clampX(vw - TT_W - EDGE * 2) };
}

/**
 * @param tourKey  'workspace' | 'clip' — which "seen" flag this tour owns
 * @param rootRef  the screen's `position: relative` root
 * @param steps    [{ target: CSS selector, title, body, pad? }] — `pad: 0` for
 *                  panels flush against the page edges
 * @param ready    auto-start only once the screen has real content to point at
 * @param onStart  lets the screen clear anything covering the targets before
 *                  the first measure (Workspace collapses its dock)
 */
export default function OnboardingTour(props) {
  // Env gate (VITE_FEATURE_ONBOARDING_TOUR). When off, the tour never auto-
  // starts and never touches the backend. Whether it can still be opened by
  // hand is the Replay button's HIDE-MARK (SHOW_REPLAY_BUTTON), not the env.
  return <OnboardingTourInner {...props} enabled={IS_ONBOARDING_TOUR_ENABLED} />;
}

function OnboardingTourInner({ tourKey, rootRef, steps, ready, onStart, enabled }) {
  const { seen, loading, markSeen } = useTourSeen(tourKey, enabled);

  // Index into `steps`, or -1 when the tour is closed.
  const [index, setIndex] = useState(-1);
  const [spot, setSpot] = useState(null);
  const [tt, setTt] = useState(null);
  const [finished, setFinished] = useState(false);
  const tooltipRef = useRef(null);
  const nextRef = useRef(null);
  const autoStarted = useRef(false);

  const active = index >= 0;
  // Only the steps whose targets are on screen right now count towards "x of n".
  const liveSteps = active
    ? steps.filter((s) => findTarget(rootRef.current, s.target))
    : [];
  const step = steps[index];
  const liveIndex = step ? liveSteps.indexOf(step) : -1;

  /** First step at or after `from` (moving by `dir`) whose target exists. */
  const seek = useCallback(
    (from, dir) => {
      for (let i = from; i >= 0 && i < steps.length; i += dir) {
        if (findTarget(rootRef.current, steps[i].target)) return i;
      }
      return -1;
    },
    [steps, rootRef]
  );

  const close = useCallback(() => {
    setIndex(-1);
    setSpot(null);
    setFinished(true);
    markSeen();
  }, [markSeen]);

  const start = useCallback(() => {
    // Same batch as setIndex, so the screen's layout change (e.g. the dock
    // collapsing) is committed before the step's layout effect measures.
    onStart?.();
    const first = seek(0, 1);
    if (first >= 0) setIndex(first);
  }, [seek, onStart]);

  const next = useCallback(() => {
    const n = seek(index + 1, 1);
    if (n < 0) close();
    else setIndex(n);
  }, [index, seek, close]);

  const back = useCallback(() => {
    const p = seek(index - 1, -1);
    if (p >= 0) setIndex(p);
  }, [index, seek]);

  // ── auto-start, once per mount ──────────────────────────────────────────
  //
  // MARKED SEEN AT THE START, not at the end. `close()` also marks it, but
  // close only runs when the user finishes the last step or presses Skip —
  // so anyone who simply walked away mid-tour (back to the board, a reload,
  // a second render) was never recorded, and the tour auto-started at them
  // all over again on their next visit.
  //
  // "Seen" is the honest reading of the field: they have been shown it. The
  // replay pill is there for a deliberate second viewing, and re-running an
  // unasked-for tour is the worse of the two mistakes.
  useEffect(() => {
    if (!enabled || !ready || loading || seen || autoStarted.current) return undefined;
    const t = setTimeout(() => {
      autoStarted.current = true;
      markSeen();
      start();
    }, START_DELAY_MS);
    return () => clearTimeout(t);
  }, [enabled, ready, loading, seen, start, markSeen]);

  // ── measure ─────────────────────────────────────────────────────────────
  const measure = useCallback(() => {
    const root = rootRef.current;
    const el = step && findTarget(root, step.target);
    if (!root || !el) {
      // The target went away mid-tour (e.g. a render started): move on.
      if (step) next();
      return;
    }
    const rr = root.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const vw = rr.width;
    const vh = rr.height;
    // Clamp each EDGE, not just the origin. Clamping only top/left while
    // keeping width = target + 2·pad pushed the far edge past the target
    // whenever the near edge hit the root (the brand panel spilled ~16px into
    // the ideas column). Panels flush with the page set `pad: 0`.
    const pad = step.pad ?? PAD;
    const x1 = Math.max(r.left - rr.left - pad, 0);
    const y1 = Math.max(r.top - rr.top - pad, 0);
    const x2 = Math.min(r.right - rr.left + pad, vw);
    const y2 = Math.min(r.bottom - rr.top + pad, vh);
    const s = { top: y1, left: x1, width: x2 - x1, height: y2 - y1 };
    setSpot(s);
    setTt(placeTooltip(s, tooltipRef.current?.offsetHeight || 190, vw, vh));
  }, [rootRef, step, next]);

  // New step: bring the target into its scroller's view, then measure.
  useLayoutEffect(() => {
    if (!active) return;
    const el = findTarget(rootRef.current, step?.target);
    el?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    measure();
    nextRef.current?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  // The tooltip's own height decides whether it fits below; re-place once known.
  useLayoutEffect(() => {
    if (active && spot) measure();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tooltipRef.current?.offsetHeight]);

  useEffect(() => {
    if (!active) return undefined;
    const root = rootRef.current;
    const el = findTarget(root, step?.target);
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    const ro = new ResizeObserver(schedule);
    if (root) ro.observe(root);
    if (el) ro.observe(el);
    window.addEventListener('resize', schedule);
    root?.addEventListener('scroll', schedule, true);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      window.removeEventListener('resize', schedule);
      root?.removeEventListener('scroll', schedule, true);
    };
  }, [active, step, measure, rootRef]);

  // ── keyboard ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!active) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') back();
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [active, next, back, close]);

  const isLast = active && seek(index + 1, 1) < 0;
  const hasBack = active && seek(index - 1, -1) >= 0;

  return (
    <>
      {active && spot && (
        <div
          className="absolute inset-0 z-[60] overflow-hidden"
          // Swallow clicks on the dimmed page AND on the highlighted target.
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          role="presentation"
        >
          {/* The cut-out: its shadow is the dim, its body is the hole. */}
          <div
            aria-hidden
            className="pointer-events-none absolute rounded-[14px] transition-all duration-300 ease-[cubic-bezier(.4,0,.2,1)]"
            style={{
              ...spot,
              boxShadow: 'inset 0 0 0 1.5px rgba(145,118,255,0.95), 0 0 0 9999px rgba(6,5,8,0.74)',
            }}
          />
          {/* Soft pulsing halo, kept separate so the dim itself never flickers. */}
          <div
            aria-hidden
            className="pointer-events-none absolute animate-pulse rounded-[14px] transition-all duration-300 ease-[cubic-bezier(.4,0,.2,1)]"
            style={{ ...spot, boxShadow: 'inset 0 0 24px 2px rgba(124,92,255,0.35)' }}
          />

          <div
            ref={tooltipRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="onboarding-tour-title"
            className="absolute flex flex-col gap-3 rounded-2xl border p-4 text-white shadow-[0_18px_48px_-8px_rgba(0,0,0,0.8)] transition-[top,left] duration-300 ease-[cubic-bezier(.4,0,.2,1)]"
            style={{
              width: TT_W,
              top: tt?.top ?? 0,
              left: tt?.left ?? 0,
              background: SURF,
              borderColor: LINE_STRONG,
            }}
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold tracking-[0.08em] text-[#b8a8ff] uppercase">
                Step {liveIndex + 1} of {liveSteps.length}
              </span>
              <button
                type="button"
                onClick={close}
                className="rounded text-xs font-medium text-white/45 transition hover:text-white/80"
              >
                Skip tour
              </button>
            </div>

            {/* key: the copy fades in fresh on every step. */}
            <div key={index} className="animate-[tourFade_220ms_ease-out]">
              <h3 id="onboarding-tour-title" className="text-[15px] leading-snug font-bold tracking-tight">
                {step.title}
              </h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-white/65">{step.body}</p>
            </div>

            <div className="mt-1 flex items-center justify-between gap-3">
              {/* Segmented progress rather than dots: reads at a glance. */}
              <div className="flex flex-1 gap-1" aria-hidden>
                {liveSteps.map((s, i) => (
                  <span
                    key={s.target}
                    className={cn(
                      'h-1 flex-1 rounded-full transition-colors duration-300',
                      i <= liveIndex ? 'bg-[#7c5cff]' : 'bg-white/12'
                    )}
                  />
                ))}
              </div>
              <div className="flex shrink-0 gap-2">
                {hasBack && (
                  <button
                    type="button"
                    onClick={back}
                    className="rounded-[7px] border px-3 py-1.5 text-[12.5px] font-semibold text-white/75 transition hover:text-white"
                    style={{ borderColor: LINE_STRONG }}
                  >
                    Back
                  </button>
                )}
                <button
                  ref={nextRef}
                  type="button"
                  onClick={next}
                  className="rounded-[7px] bg-[linear-gradient(180deg,#9176ff_0%,#7c5cff_46%,#6148c7_100%)] px-3.5 py-1.5 text-[12.5px] font-bold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.42),0_4px_10px_-4px_rgba(0,0,0,0.75)] transition outline-none hover:brightness-110 focus-visible:ring-2 focus-visible:ring-[#b8a8ff]/70"
                >
                  {isLast ? 'Got it' : 'Next'}
                </button>
              </div>
            </div>
          </div>

          <style>{'@keyframes tourFade{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}'}</style>
        </div>
      )}

      {/* Replay button — controlled ONLY by SHOW_REPLAY_BUTTON (HIDE-MARK
          above), not by the env. While on it is always shown, not just after a
          run. For "only after a run", add `&& finished`. */}
      {SHOW_REPLAY_BUTTON && !active && (
        <button
          type="button"
          onClick={start}
          className="absolute right-4 bottom-4 z-[40] inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold text-white/70 shadow-[0_8px_24px_-6px_rgba(0,0,0,0.8)] transition hover:border-[#7c5cff]/60 hover:text-white"
          style={{ background: SURF, borderColor: LINE_STRONG }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
            <path d="M3 3v5h5" />
          </svg>
          Replay tour
        </button>
      )}
    </>
  );
}
