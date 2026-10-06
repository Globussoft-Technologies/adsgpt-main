import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';

// ── Tool stage: the V2 Ad Creative / Ad Video tools (VITE_FEATURE_ADSTUDIO_UI_V2) ──
//
// Why not the carousel: it hid 3–4 of the tools at any moment, so people had to
// wait or click arrows to discover them. The stage keeps the motion but shows
// every tool at once:
//
//   ┌──────────────── stage ────────────────┐
//   │ AD VIDEO · 02 / 06                    │  ← text blurs in word by word
//   │ AI UGC Ads            ▣▣▣  card deck  │  ← portrait cards shuffle like a deck
//   │ Creator-style UGC…                    │     (front card plays its GIF/mp4)
//   │ [Create →]                            │
//   └───────────────────────────────────────┘
//   [ ◉ AI Ads | ◉ AI UGC Ads | … ]          ← tab bar: sliding pill + progress line
//
// Motion ideas from Motion-Primitives (built on Motion, like our framer-motion):
// Animated Background (the sliding pill), Transition Panel (content swap),
// Text Effect (blur-in per word). The deck shuffle is our own.
//
// Behaviour
// - Auto-advances every AUTO_MS; the gradient line in the active tab shows the
//   time left. Pauses on hover/focus, when the tab is hidden, and never runs
//   under prefers-reduced-motion.
// - Desktop: hovering a tab previews it; clicking it (or the stage) opens the
//   tool. Touch: first tap selects, second tap opens.
// - ←/→ move between tools, Enter opens.
// - Each tab keeps the tour id (tour_ad-creative-module_* / tour_ad-video-card_*).
// - Assets are the existing ones: `img` (still) and `gif` (gif or mp4). The
//   cards are 4:5 and object-cover, which also crops the white side bars that
//   are baked into b-rolls-gif-1.gif.
//
// `tools`: [{ key, tourId, title, desc, img, gif, onOpen, disabled, badge }]

const AUTO_MS = 5000;
const EASE = [0.22, 0.8, 0.2, 1];
const isVideo = (url) => typeof url === 'string' && /\.(mp4|webm|mov)(\?.*)?$/i.test(url);

// Deck slots by distance from the active card (0 = front). The deck fans out
// to BOTH sides (next tools on the right, previous ones on the left), so it
// fills the stage instead of leaving an empty band between the text and the
// cards (user feedback 2026-10-05). A card leaving the front swings left; the
// next one comes in from the right.
const DECK = {
  0: { x: 0, y: 0, rotate: 0, scale: 1, opacity: 1, zIndex: 40, veil: 0 },
  1: { x: 100, y: 0, rotate: 7, scale: 0.88, opacity: 1, zIndex: 30, veil: 0.45 },
  2: { x: 185, y: 0, rotate: 13, scale: 0.76, opacity: 1, zIndex: 20, veil: 0.65 },
  left1: { x: -100, y: 0, rotate: -7, scale: 0.88, opacity: 1, zIndex: 30, veil: 0.45 },
  left2: { x: -185, y: 0, rotate: -13, scale: 0.76, opacity: 1, zIndex: 20, veil: 0.65 },
  rest: { x: 0, y: 0, rotate: 0, scale: 0.7, opacity: 0, zIndex: 5, veil: 0.8 },
};
const slotFor = (rel, count) =>
  DECK[rel] || (rel === count - 1 ? DECK.left1 : rel === count - 2 ? DECK.left2 : DECK.rest);

// ── Responsive fan (2026-10-05) ──────────────────────────────────────────────
// The DECK offsets are tuned for a ~960px stage. In a narrower deck column the
// left cards (−100 / −185px, tilted) reached into the text column. So the fan is
// scaled to the room actually there: each left card's outer edge — its rotated
// half-width plus the lean of its top corner (cards scale and rotate around
// their bottom centre) — must stay FAN_GAP inside the deck column. Both sides
// use the same factor so the fan stays symmetric; a left card that would need
// to be squashed below ~half its spread is hidden instead. Below `sm` the deck
// is not shown at all (the tab bar still has every tool's thumbnail).
const FAN_GAP = 12;
// Width budget for the text block: the description's own max-width (34ch,
// read from the page so it follows the font) or TEXT_MIN, whichever is wider —
// titles are shorter. The left cards may use the text column's EMPTY right
// side beyond it, as the original fan did on wide stages, so desktop keeps the
// designed spread and only narrow stages compress. (A fixed 270px let a card
// touch "Apps / SaaS" at 1024px; the 34ch line is ~290px.)
const TEXT_MIN = 260;
const CARD_H = 0.88; // card height / deck height (the h-[88%] box below)
const DECK_CX = 0.46; // card centre / deck width (left-[46%] below)
const leanOut = (slot, cardW, cardH) => {
  const t = (Math.abs(slot.rotate) * Math.PI) / 180;
  return ((cardW * slot.scale) / 2) * Math.cos(t) + cardH * slot.scale * Math.sin(t);
};
function fanLayout(w, h, textSpare = 0) {
  if (!w || !h) return { f: 1, left1: true, left2: true };
  const cardH = CARD_H * h;
  const cardW = cardH * 0.8; // aspect 4:5
  const cx = DECK_CX * w;
  const room = (slot) => cx + textSpare - leanOut(slot, cardW, cardH) - FAN_GAP;
  const f1 = room(DECK.left1) / Math.abs(DECK.left1.x);
  const f2 = room(DECK.left2) / Math.abs(DECK.left2.x);
  const left1 = f1 >= 0.45;
  const left2 = left1 && f2 >= 0.55;
  const f = Math.max(0, Math.min(1, left2 ? Math.min(f1, f2) : left1 ? f1 : 1));
  return { f, left1, left2 };
}

function Media({ url, playing = false, className = '' }) {
  const ref = useRef(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (playing) v.play().catch(() => {});
    else v.pause();
  }, [playing]);
  if (isVideo(url)) {
    return (
      <video
        ref={ref}
        src={`${url}#t=2`}
        muted
        loop
        playsInline
        preload="metadata"
        className={`absolute inset-0 h-full w-full object-cover ${className}`}
      />
    );
  }
  return <img src={url} alt="" draggable={false} className={`absolute inset-0 h-full w-full object-cover ${className}`} />;
}

// `onPick`: click on this card — the stage decides (front opens, others come
// forward with the normal deck animation).
function DeckCard({ tool, rel, count, fan, onPick }) {
  const base = slotFor(rel, count);
  const hide = (base === DECK.left1 && !fan.left1) || (base === DECK.left2 && !fan.left2);
  const slot = { ...base, x: base.x * fan.f, opacity: hide ? 0 : base.opacity };
  const front = rel === 0;
  return (
    // Outer box centres the card (CSS transform); the inner motion.div owns the
    // deck motion (x/y/rotate/scale), so the two transforms never fight.
    // aria-hidden: the tab bar is the accessible control for the same tools.
    <div
      aria-hidden="true"
      onClick={onPick}
      className="absolute top-1/2 left-[46%] aspect-4/5 h-[88%] -translate-x-1/2 -translate-y-1/2 cursor-pointer"
      style={{ zIndex: slot.zIndex, pointerEvents: slot.opacity === 0 ? 'none' : undefined }}
    >
    <motion.div
      className="absolute inset-0 origin-bottom overflow-hidden rounded-2xl bg-[#0f0f0f] shadow-[0_18px_40px_-16px_rgba(24,24,27,0.45),0_0_0_1px_rgba(0,0,0,0.06)] dark:shadow-[0_24px_50px_-18px_rgba(0,0,0,0.85),0_0_0_1px_rgba(255,255,255,0.08)]"
      initial={false}
      animate={{ x: slot.x, y: slot.y, rotate: slot.rotate, scale: slot.scale, opacity: slot.opacity }}
      transition={{ duration: 0.8, ease: EASE }}
    >
      <Media url={tool.img} />
      {/* The moving preview mounts on the front card only: one animating asset at a time. */}
      {front && tool.gif && (
        <motion.div className="absolute inset-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }}>
          <Media url={tool.gif} playing />
        </motion.div>
      )}
      <motion.div
        className="pointer-events-none absolute inset-0 bg-black"
        initial={false}
        animate={{ opacity: slot.veil }}
        transition={{ duration: 0.6 }}
      />
    </motion.div>
    </div>
  );
}

// Text Effect–style blur-in, one word at a time.
function BlurWords({ text, delay = 0, reduce }) {
  if (reduce) return text;
  return text.split(' ').map((w, k) => (
    <motion.span
      key={`${w}-${k}`}
      className="inline-block"
      initial={{ opacity: 0, filter: 'blur(8px)', y: 6 }}
      animate={{ opacity: 1, filter: 'blur(0px)', y: 0 }}
      transition={{ duration: 0.55, ease: EASE, delay: delay + k * 0.04 }}
    >
      {w}
      {k < text.split(' ').length - 1 ? ' ' : ''}
    </motion.span>
  ));
}

export default function StudioToolStage({ tools = [], kindLabel = 'Ad video', label = 'Tools' }) {
  const count = tools.length;
  const reduce = useReducedMotion();
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hidden, setHidden] = useState(() => typeof document !== 'undefined' && document.hidden);
  const [round, setRound] = useState(0); // restarts the progress line
  // Deck column size → how far the fan may spread (see fanLayout).
  const deckRef = useRef(null);
  const textRef = useRef(null);
  const [deckBox, setDeckBox] = useState({ w: 0, h: 0, spare: 0 });
  useLayoutEffect(() => {
    const el = deckRef.current;
    const text = textRef.current;
    if (!el || !text) return undefined;
    const measure = () => {
      const padL = parseFloat(getComputedStyle(text).paddingLeft) || 0;
      const desc = text.querySelector('p');
      const budget = Math.max(TEXT_MIN, desc ? parseFloat(getComputedStyle(desc).maxWidth) || 0 : 0);
      setDeckBox({ w: el.clientWidth, h: el.clientHeight, spare: Math.max(0, text.clientWidth - padL - budget) });
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    ro.observe(text);
    measure();
    return () => ro.disconnect();
  }, []);
  const fan = fanLayout(deckBox.w, deckBox.h, deckBox.spare);
  // Last pointer position over the tab bar (see the tab's onPointerMove).
  const lastPt = useRef({ x: -1, y: -1 });
  const canHover = useRef(typeof window !== 'undefined' && window.matchMedia?.('(hover: hover)').matches);

  const select = useCallback((i) => {
    setActive(((i % count) + count) % count);
    setRound((r) => r + 1);
  }, [count]);

  useEffect(() => {
    const onVis = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  // ── Deck interaction (user request 2026-10-05) ───────────────────────────
  // Cards area, click only (drag was tried and removed at the user's request):
  // a card that is not in the centre comes to the centre with the normal deck
  // animation; the centre card opens the tool. Empty deck space opens nothing.
  const pickCard = (k) => (e) => {
    e.stopPropagation();
    if (k === active) open(active);
    else select(k);
  };

  const running = !paused && !hidden && !reduce && count > 1;
  const open = (i) => {
    const t = tools[i];
    if (t && !t.disabled) t.onOpen?.();
  };

  const tool = tools[active];
  if (!tool) return null;
  const glow = isVideo(tool.img) ? null : tool.img;

  return (
    <div
      role="region"
      aria-roledescription="carousel"
      aria-label={label}
      className="mx-auto w-full max-w-[960px]"
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') { e.preventDefault(); select(active + 1); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); select(active - 1); }
      }}
      onFocus={() => setPaused(true)}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setPaused(false); }}
    >
      <style>{'@keyframes studio-stage-progress{from{transform:scaleX(0)}to{transform:scaleX(1)}}'}</style>

      {/* ── Stage ── */}
      <div
        role="link"
        tabIndex={0}
        aria-label={`Open ${tool.title}`}
        aria-disabled={tool.disabled || undefined}
        onClick={() => open(active)}
        onKeyDown={(e) => { if (e.key === 'Enter') open(active); }}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        className={`group relative isolate grid h-[clamp(220px,28vh,264px)] grid-cols-1 overflow-hidden sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] rounded-[22px] border outline-none
          border-black/[0.07] bg-white shadow-[0_1px_2px_rgba(24,24,27,0.04),0_20px_40px_-24px_rgba(24,24,27,0.25)]
          dark:border-white/[0.07] dark:bg-[#121215] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_30px_60px_-30px_rgba(0,0,0,0.8)]
          focus-visible:ring-2 focus-visible:ring-[#6b72f8]/50 ${tool.disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
      >
        {/* Ambient glow from the active tool's own still */}
        <AnimatePresence initial={false}>
          <motion.div
            key={tool.key}
            aria-hidden="true"
            className="pointer-events-none absolute -inset-[30%] -z-10"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.7 }}
          >
            <div
              className="h-full w-full bg-cover bg-center opacity-[0.18] blur-[70px] saturate-150 dark:opacity-30"
              style={{ backgroundImage: glow ? `url("${glow}")` : 'linear-gradient(135deg,#15DCFF,#6b72f8)' }}
            />
          </motion.div>
        </AnimatePresence>

        {/* Text */}
        <div ref={textRef} className="relative flex min-w-0 flex-col justify-center gap-2.5 py-7 pr-6 pl-6 sm:pr-0 sm:pl-8 md:pl-12">
          <div className="text-[11px] font-semibold tracking-[0.16em] text-zinc-500 tabular-nums uppercase dark:text-zinc-400">
            {kindLabel} · {String(active + 1).padStart(2, '0')} / {String(count).padStart(2, '0')}
          </div>
          <h3 key={`t-${tool.key}`} className="m-0 text-[clamp(24px,2.3vw,32px)] leading-[1.05] font-bold tracking-[-0.03em] text-zinc-900 dark:text-white">
            <BlurWords text={tool.title} delay={0.06} reduce={reduce} />
          </h3>
          <p key={`d-${tool.key}`} className="m-0 max-w-[34ch] text-sm leading-normal text-zinc-500 dark:text-zinc-400">
            <BlurWords text={tool.desc} delay={0.18} reduce={reduce} />
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2.5">
            {!tool.disabled && (
              <span className="inline-flex h-[38px] items-center gap-1.5 rounded-[11px] bg-zinc-900 px-4 text-[13.5px] font-semibold text-white shadow-[0_8px_24px_-10px_#5057d6] dark:bg-white dark:text-[#0b0b0d] dark:shadow-[0_8px_24px_-10px_#6b72f8]">
                Create
                <ArrowRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-[3px]" />
              </span>
            )}
            {tool.badge}
          </div>
        </div>

        {/* Deck (hidden on phones; spread fitted to its column, see fanLayout) */}
        <div
          ref={deckRef}
          // Empty deck space must not open the tool (only the centre card does).
          onClick={(e) => e.stopPropagation()}
          className="relative hidden select-none sm:block"
        >
          {tools.map((t, k) => (
            <DeckCard
              key={t.key}
              tool={t}
              count={count}
              fan={fan}
              rel={((k - active) % count + count) % count}
              onPick={pickCard(k)}
            />
          ))}
        </div>
      </div>

      {/* ── Tab bar ── */}
      <div
        role="tablist"
        aria-label={label}
        onMouseLeave={() => setPaused(false)}
        className="mx-auto mt-3.5 flex w-max max-w-full gap-1 overflow-x-auto rounded-2xl border border-black/[0.06] bg-black/[0.035] p-[5px] scrollbar-none dark:border-white/[0.06] dark:bg-white/[0.035]"
      >
        {tools.map((t, i) => {
          const on = i === active;
          return (
            <button
              key={t.key}
              id={t.tourId}
              type="button"
              role="tab"
              aria-selected={on}
              aria-disabled={t.disabled || undefined}
              // Hover preview on REAL pointer movement only. With onMouseEnter, the
              // pill leaving a tab under a resting pointer fired a fresh mouseover,
              // which re-selected that tab and undid ←/→ (found by test, 2026-10-05).
              // A move to the same coordinates (what a layout change produces) is
              // ignored; `movementX/Y` is not used — it is 0 on some setups.
              onPointerMove={(e) => {
                if (!canHover.current || e.pointerType !== 'mouse') return;
                if (e.clientX === lastPt.current.x && e.clientY === lastPt.current.y) return;
                lastPt.current = { x: e.clientX, y: e.clientY };
                setPaused(true);
                if (!on) select(i);
              }}
              onClick={() => (on ? open(i) : select(i))}
              className={`group relative flex h-10 shrink-0 items-center gap-2 rounded-[11px] pr-3 pl-1.5 text-[13px] font-medium whitespace-nowrap transition-colors duration-200 ${
                on ? 'text-zinc-900 dark:text-white' : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white'
              }`}
            >
              {/* Animated Background: one pill that slides between tabs */}
              {on && (
                <motion.span
                  layoutId={`${label}-pill`}
                  className="absolute inset-0 overflow-hidden rounded-[11px] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.06),0_4px_12px_-6px_rgba(24,24,27,0.18)] dark:bg-white/[0.09] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
                  transition={{ duration: 0.45, ease: EASE }}
                >
                  {/* Progress line: time until the next tool */}
                  {!reduce && count > 1 && (
                    <span className="absolute right-2.5 bottom-[3px] left-2.5 h-0.5 overflow-hidden rounded-full bg-zinc-500/15">
                      {/* No `scale-x-0` class here: Tailwind v4 maps it to the CSS `scale`
                          property, which multiplies with the keyframes' transform and
                          kept the bar at 0px for the whole run. The keyframes already
                          start at scaleX(0). */}
                      <span
                        key={round}
                        className="absolute inset-0 origin-left bg-linear-to-r from-[#0c9fbd] to-[#5057d6] dark:from-[#15DCFF] dark:to-[#6b72f8]"
                        style={{
                          animation: `studio-stage-progress ${AUTO_MS}ms linear forwards`,
                          animationPlayState: running ? 'running' : 'paused',
                        }}
                        onAnimationEnd={() => select(active + 1)}
                      />
                    </span>
                  )}
                </motion.span>
              )}
              <span
                className={`relative h-7 w-7 shrink-0 overflow-hidden rounded-lg bg-[#0f0f0f] transition-[filter,opacity] duration-300 ${
                  on ? '' : 'opacity-75 grayscale-[0.6] group-hover:opacity-100'
                }`}
              >
                <Media url={t.img} />
              </span>
              <span className="relative">{t.title}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
