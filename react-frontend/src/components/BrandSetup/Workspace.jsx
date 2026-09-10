// Workspace — where onboarding lands.
//
// ── Shape of the screen ──────────────────────────────────────────────────────
// Full bleed, three regions, and nothing scrolls except what is explicitly told
// to:
//
//   header   52px, the app bar — logo left, controls right
//   aside    296px, the brand profile, its own scroller
//   main     the storyboards, with the templates dock OVER them
//
// The dock is `position:absolute; bottom:0` INSIDE main, not a flex sibling of
// the storyboards. That distinction is the whole behaviour: dragging it up
// covers the ideas rather than squashing them, so the cards keep their size and
// the keyframes stay readable no matter how much of the template library you
// have pulled into view. The ideas section pays for the overlay with a
// `padding-bottom` equal to the dock's height, so its last row can always be
// scrolled clear of it.
//
// ── The rails ────────────────────────────────────────────────────────────────
// Both are LIVE. Node fires storyboards and templates server-side the moment
// onboarding succeeds, so they are usually finished before this screen opens.
//
// They are read from `session`, not `result`: `result` is the brand context
// alone, and an earlier version of this file rendered permanent skeletons
// labelled "not started" because it had nothing else to look at — long after
// both rails were completing successfully.
//
// Storyboard frames arrive with ROOT-RELATIVE links (`/creatives/…webp`,
// `/api/v1/storyboards/images/…`). Node resolves them to absolute `src` before
// they reach here; putting the raw value in an `<img>` resolves it against our
// own origin and renders nothing, which is the other half of why this was empty.
//
// Everything else is real, straight from the run:
//   Python SSE → Node bridge → socket `aiJobUpdate` → brandSetupSlice → here.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import AdsGPTLogo from '@/assets/layouts/adsgpt-logo.webp';
import creditIcon from '@/assets/layouts/profile/adcreative.svg';
import CustomVideoPlayer from '../AdStudio/AdVideo/AdVideoChats/CustomVideoPlayer';
import FreeAdBanner from './FreeAdBanner';
import MosaicLoader from './MosaicLoader';
import RetryCountdownButton from './RetryCountdownButton';

/* ── tokens ───────────────────────────────────────────────────────────────────
   Named here rather than scattered through the markup, because every surface on
   this screen is one of four greys and getting one of them wrong is the kind of
   mistake that is invisible in isolation and obvious in a screenshot.          */
const BG = '#0f0f0f'; // the page
const SURF = '#1B1B21'; // cards, the dock
const SURF2 = '#232329'; // a control sitting on a card
const CHROME = '#131317'; // header and sidebar
const LINE = 'rgba(255,255,255,0.09)';
const LINE_STRONG = 'rgba(255,255,255,0.16)';

/* ── chrome ─────────────────────────────────────────────────────────────────*/

/**
 * The app bar.
 *
 * This screen renders outside Layout, so it has never had chrome above it. The
 * theme control is deliberately inert: the product is dark-only right now and
 * every other toggle in the app is switched off for the same reason. It is here
 * so the bar does not read as unfinished.
 */
/**
 * @param onSkip  Leave onboarding without finishing it. Quieter than the other
 *   two on purpose: it is always available, and an always-available control
 *   that shouts competes with the thing the screen is actually for. Distinct
 *   from `onFinish` — skipping leaves the free render unspent, so the offer bar
 *   stays up and comes back to this same session.
 */
export function Header({ onStartOver, onFinish, onSkip }) {
  return (
    <header
      className="flex h-13 shrink-0 items-center justify-between border-b border-white/[0.07] px-4"
      style={{ background: CHROME }}
    >
      <img src={AdsGPTLogo} alt="AdsGPT" className="block h-6.5 w-auto" />

      <div className="flex items-center gap-2">
        {/* Temporary — until the workspace has its own navigation. */}
        {onStartOver && (
          <button
            type="button"
            onClick={onStartOver}
            className="rounded-lg border border-white/10 bg-white/[0.06] px-2.5 py-1.5 text-xs font-medium text-white/60 transition hover:border-[#15DCFF]/50 hover:text-white"
          >
            Start over
          </button>
        )}
        {onSkip && (
          <button
            type="button"
            onClick={onSkip}
            className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-white/40 transition hover:text-white/75"
          >
            Skip for now
          </button>
        )}
        {onFinish && (
          <button
            type="button"
            onClick={onFinish}
            className="inline-flex items-center gap-2 whitespace-nowrap rounded-lg border px-2.5 py-1.5 text-xs font-semibold text-white/80 transition hover:border-[#15DCFF]/50 hover:text-white"
            style={{ background: SURF2, borderColor: LINE_STRONG }}
          >
            End onboarding
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M5 12h13M13 6l6 6-6 6" />
            </svg>
          </button>
        )}
        {/* The theme toggle used to sit here. It was inert — the product is
            dark-only — and a control that cannot do anything is worse than no
            control, so it is gone from onboarding entirely. This Header is
            shared with ClipView, so removing it here removes it from both. */}
      </div>
    </header>
  );
}

/* ── the brand profile ──────────────────────────────────────────────────────*/

/**
 * One field: a small caps label and its value.
 *
 * The label carries a 2px gradient tick on the brand ramp. Six identical grey
 * captions stacked down a column read as a dump of metadata; a repeated accent
 * turns the same six into a list somebody designed. It costs one element and no
 * vertical space — the tick sits inside the label's own line box.
 */
function Field({ label, children, divided = true }) {
  return (
    // Every size in the sidebar is `em`, so the one font-size on its container
    // scales the whole panel — see `useFitScale`. Fixed px here would mean the
    // text shrinking while the gaps around it did not, which looks worse than
    // either extreme on its own.
    <div className={cn('py-[0.62em]', divided && 'border-t border-white/[0.055]')}>
      <div className="mb-[0.15em] flex items-center gap-[0.45em]">
        <span className="h-[0.8em] w-[2px] shrink-0 rounded-full bg-linear-to-b from-[#15DCFF] to-[#5E66F5]" />
        <span className="text-[0.8em] leading-none font-semibold tracking-[0.14em] text-white/55 uppercase">
          {label}
        </span>
      </div>
      {children}
    </div>
  );
}

function Empty({ children = '—' }) {
  return <span className="text-[0.92em] text-white/30">{children}</span>;
}

/**
 * A value, in full.
 *
 * Nothing here is clamped. The sidebar is its own scroller, so spending its
 * height on the whole sentence is better than spending it on whitespace under a
 * truncated one.
 */
function Line({ children, bright = false }) {
  if (!children) return <Empty />;
  return (
    <p
      className={cn(
        'text-[1em] leading-relaxed text-pretty',
        bright ? 'text-white/90' : 'text-white/75'
      )}
    >
      {children}
    </p>
  );
}

/**
 * Every item, wrapping freely.
 *
 * `tone` tints the row on the brand ramp: audience cyan, products indigo. The
 * two lists sit directly under one another and were previously indistinguishable
 * at a glance — same grey pill, same size — so the eye had to read the labels to
 * tell a customer from a product. Colour does that work instead.
 */
function Chips({ items, tone = 'cyan', max }) {
  const list = items || [];
  if (!list.length) return <Empty />;
  const shown = Number.isFinite(max) ? list.slice(0, max) : list;
  const extra = list.length - shown.length;
  return (
    <div className="flex flex-wrap items-center gap-[0.3em]">
      {shown.map((item) => (
        <span
          key={item}
          className={cn(
            'rounded-md border px-[0.45em] py-[0.08em] text-[0.8em] leading-normal',
            tone === 'cyan'
              ? 'border-[#15DCFF]/25 bg-[#15DCFF]/10 text-[#9FEEFF]'
              : 'border-[#5E66F5]/30 bg-[#5E66F5]/12 text-[#BFC2FF]'
          )}
        >
          {item}
        </span>
      ))}
      {extra > 0 && <span className="self-center text-[0.8em] text-white/35">+{extra}</span>}
    </div>
  );
}

/**
 * The brand's colours, as scraped.
 *
 * Six hex codes in a row is the one field here worth more as a picture than as
 * text — nobody reads `#006DFF`, everybody recognises Nike blue. The value stays
 * on the `title` for the times somebody does need to copy it.
 */
function Palette({ colors = [] }) {
  const shown = colors.filter(Boolean).slice(0, 8);
  if (!shown.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {shown.map((color) => (
        <span
          key={color}
          title={color}
          className="h-5 w-5 rounded-md border border-white/15 shadow-[inset_0_2px_4px_rgba(0,0,0,0.35)]"
          style={{ backgroundColor: color }}
        />
      ))}
    </div>
  );
}

/**
 * The brand's own imagery, scraped from its site.
 *
 * Broken URLs are dropped from the list rather than hidden in place: a scrape
 * collects whatever the page linked and some of it will 404, and hiding each one
 * individually still left an empty strip with a "+2" counter pointing at
 * nothing. Dropping them means the row disappears with its last image — label
 * included, since the label lives in here too.
 */
function ImageStrip({ urls = [], max = 6, label }) {
  const [broken, setBroken] = useState(() => new Set());
  // The one that is open, not a boolean — a click on a DIFFERENT thumbnail while
  // the modal is up should swap the picture, not close-then-reopen it.
  const [openUrl, setOpenUrl] = useState(null);

  useEffect(() => {
    if (!openUrl) return undefined;
    const onKey = (e) => e.key === 'Escape' && setOpenUrl(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openUrl]);

  const alive = urls.filter((url) => !broken.has(url));
  if (!alive.length) return null;

  const shown = alive.slice(0, max);
  const extra = alive.length - shown.length;

  return (
    <Field label={label}>
      <div className="flex flex-wrap items-center gap-2">
        {shown.map((url) => (
          <button
            key={url}
            type="button"
            onClick={() => setOpenUrl(url)}
            aria-label="Open image full size"
            className="h-13 w-13 shrink-0 cursor-zoom-in overflow-hidden rounded-lg border border-white/10 bg-white/[0.06] transition hover:border-[#15DCFF]/50"
          >
            <img
              src={url}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover"
              onError={() => setBroken((prev) => new Set(prev).add(url))}
            />
          </button>
        ))}
        {extra > 0 && <span className="text-[10px] text-white/35">+{extra}</span>}

        {/* Portalled to `document.body` — the sidebar clips its own overflow, so
            a modal rendered in place would be cut by the very panel it needs to
            escape. Click rather than hover: hover cannot be reached on touch,
            and a preview that vanishes when the pointer drifts is hard to read. */}
        {openUrl &&
          createPortal(
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6 backdrop-blur-sm"
              onClick={() => setOpenUrl(null)}
            >
              <figure
                className="relative max-h-full max-w-full"
                onClick={(e) => e.stopPropagation()}
              >
                <img
                  src={openUrl}
                  alt=""
                  className="max-h-[88vh] max-w-[88vw] rounded-xl border border-white/15 object-contain shadow-[0_40px_120px_-20px_rgba(0,0,0,0.95)]"
                />
                <CloseButton onClick={() => setOpenUrl(null)} />
              </figure>
            </div>,
            document.body
          )}
      </div>
    </Field>
  );
}

function CloseButton({ onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Close"
      className="absolute -top-3 -right-3 grid h-9 w-9 place-items-center rounded-full border border-white/15 bg-[#16161c] text-white/80 shadow-lg transition hover:border-[#15DCFF]/50 hover:text-white"
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        aria-hidden
      >
        <path d="M18 6 6 18M6 6l12 12" />
      </svg>
    </button>
  );
}

/**
 * The brand's mark — its logo, or its initial.
 *
 * A logo only exists when the run actually scraped a site: a prompt of "chatgpt"
 * with no URL produces `logo_urls: null`, which is a correct outcome and not a
 * missing asset. The same applies when the URL dies — these point at the brand's
 * own servers and can 404 or be hotlink-blocked at any time. Either way the row
 * keeps its shape by falling back to a letter tile rather than collapsing, so
 * the brand's name never sits alone against the panel edge.
 */
function BrandMark({ src, name }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);

  if (src && !failed) {
    return (
      <img
        src={src}
        alt=""
        className="h-9 w-9 shrink-0 rounded-[10px] border border-white/10 bg-white/90 object-contain p-1"
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-[#f4f4f5] text-base font-bold text-[#111]">
      {(name || '?').trim().charAt(0).toUpperCase()}
    </div>
  );
}

/**
 * Shrinks a panel's type until its content fits, without ever scrolling it.
 *
 * The brand profile is as long as the brand is interesting: a retailer with six
 * audiences and eight product lines overflows a viewport that a two-line brand
 * leaves half empty. A scrollbar is the usual answer and is the wrong one here
 * — the panel is a profile you take in at a glance, and half of it below the
 * fold is half of it unread.
 *
 * So the font size comes down instead, in small steps, until the content fits
 * or the floor is reached. Everything inside is sized in `em`, so one number
 * moves the text, the gaps and the chips together.
 *
 * The floor is not negotiable: below it the panel would be unreadable, which is
 * a worse failure than a clipped last row. Content that cannot fit at the floor
 * is left clipped, deliberately.
 */
const FIT_MAX = 13; // px — the size the panel was designed at
const FIT_MIN = 9.5; // px — below this it stops being readable
const FIT_STEP = 0.25;

function useFitScale(deps) {
  const ref = useRef(null);
  const [size, setSize] = useState(FIT_MAX);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;

    const fit = () => {
      // Always measured from the top down. Starting from the CURRENT size would
      // make the result depend on what was on screen before — a panel that had
      // shrunk for a long brand would stay small for the next short one.
      let next = FIT_MAX;
      el.style.fontSize = `${next}px`;
      while (next > FIT_MIN && el.scrollHeight > el.clientHeight + 1) {
        next -= FIT_STEP;
        el.style.fontSize = `${next}px`;
      }
      setSize(next);
    };

    fit();
    // The viewport is the other half of the equation: the same profile fits at
    // full size on a tall screen and not on a short one.
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return [ref, size];
}

/* ── storyboards ────────────────────────────────────────────────────────────*/

/**
 * One storyboard concept.
 *
 * The two keyframes run as a strip with the transition drawn between them, the
 * way a storyboard is actually read — first frame, arrow, last frame. Under it
 * sit the two things a person judges a concept by: what it is called, and the
 * line that will be spoken. One line each; the whole card is a glance, and the
 * detail lives behind Generate.
 *
 * HEIGHT drives the frames and width follows from `aspect-9/16`. Sizing them
 * from width instead made a wide card produce very tall portraits, which then
 * stretched the card to hold them. Capped at `calc(50% - 4px)` the pair adds up
 * to exactly the strip available, so the card's padding survives on both edges.
 */
function ConceptCard({ board, index, onGenerate, onOpen, videoState, anchorId, framesExhausted }) {
  const frames = (board.images || [])
    .filter((img) => img.status === 'ready' && img.src)
    .slice(0, 2);

  // Watch plays the clip HERE, in the strip the two keyframes were in. The
  // storyboard is a promise of a video and the clip is that video; sending the
  // user to another screen to see whether the promise was kept breaks the one
  // comparison the card exists to support.
  const [watching, setWatching] = useState(false);
  const clip = videoState?.video?.video || null;
  const clipSrc = clip?.src || clip?.url || clip?.local_url || '';

  return (
    <article
      id={anchorId}
      className="flex h-full min-h-0 w-full min-w-0 flex-col gap-2.5 rounded-2xl border p-3"
      style={{ background: SURF, borderColor: LINE }}
    >
      {/* `overflow-visible` so the transition badge can sit over both frames. */}
      <div className="relative flex min-h-20 flex-1 basis-0 items-center justify-center overflow-visible">
        {watching && clipSrc ? (
          <InlineClip src={clipSrc} onClose={() => setWatching(false)} onOpen={onOpen} />
        ) : frames.length ? (
          <>
            <Frame img={frames[0]} label="First frame" badge="First" />
            {/* An 8px channel between the frames with the badge centred over it.
                The badge is absolute, so the channel is what actually reserves
                the space it sits in. */}
            <div className="z-[3] w-2 shrink-0">
              {frames[1] && (
                <span
                  aria-hidden
                  className="absolute top-1/2 left-1/2 grid h-11 w-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border text-white shadow-[0_4px_14px_rgba(0,0,0,0.7)]"
                  style={{ background: 'rgba(14,14,17,0.9)', borderColor: LINE_STRONG }}
                >
                  <svg
                    width="22"
                    height="22"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M5 12h13M13 6l6 6-6 6" />
                  </svg>
                </span>
              )}
            </div>
            {frames[1] && <Frame img={frames[1]} label="Last frame" badge="Last" />}
          </>
        ) : (
          // No picture YET is the normal case, not a failure: the script arrives
          // from one job and the frames from a second one that runs after it.
          <>
            {/* Still loading, not failed — unless the backend has run out of
                retries. A keyframe that failed upstream is usually recovered by
                the retry it triggers, so showing "failed" the moment the first
                attempt reports one would be wrong more often than not. */}
            <FramePlaceholder badge="First" seed={index * 2} failed={framesExhausted} />
            <div className="w-2 shrink-0" />
            <FramePlaceholder badge="Last" seed={index * 2 + 1} failed={framesExhausted} />
          </>
        )}
      </div>

      <div className="flex min-w-0 shrink-0 items-center gap-2">
        <span className="shrink-0 text-xs font-semibold text-white/50 tabular-nums">{index}</span>
        <h3 className="min-w-0 truncate text-sm font-semibold tracking-tight text-white 2xl:text-base">
          {board.title}
        </h3>
        {board.recommended && (
          <span className="shrink-0 rounded border border-[#15DCFF]/30 bg-[#15DCFF]/10 px-1.5 py-0.5 text-[10px] font-semibold tracking-wider text-[#15DCFF] uppercase">
            Pick
          </span>
        )}
      </div>

      <VoiceoverLine text={board.voiceover} />

      <ConceptAction
        board={board}
        state={videoState}
        onGenerate={onGenerate}
        onWatch={() => setWatching(true)}
        // Only used by the exhausted-retry state, to send the user somewhere
        // that is not this concept.
        onOpen={onOpen}
      />
    </article>
  );
}

/**
 * The clip, playing where the keyframes were.
 *
 * The transition is the point. Two stills sit side by side promising a motion
 * between them; the clip is that motion. Cutting to another screen loses the
 * comparison, and a hard swap in place loses it too — so the pair scales down
 * and fades as the video scales up over it, which reads as the storyboard
 * BECOMING the video rather than being replaced by it.
 *
 * A plain `<video controls>`, not the app's player: this is a 200px-wide tile
 * in a grid of three, and a full control bar at that size is unusable. The
 * proper player is one click away on the clip screen.
 */
function InlineClip({ src, onClose, onOpen }) {
  return (
    <div className="absolute inset-0 animate-[clipRise_320ms_cubic-bezier(0.16,1,0.3,1)]">
      {/* The app's own player, the same one the clip screen uses, filling the
          strip the keyframes were in. `ASPECT_FILL` rather than the portrait
          preset: locking the player to 9:16 in a landscape slot left the
          control bar ~180px wide, with the timestamp wrapped over three lines.
          The clip letterboxes; the controls are usable. */}
      {/* Autoplays: the user pressed Watch, so making them press Play again
          inside the thing that just opened is one click too many. */}
      <CustomVideoPlayer src={src} aspect="ASPECT_FILL" autoPlay />

      {/* Above the player's own overlays, and in the strip's empty margin beside
          the portrait rather than over the picture. */}
      <div className="absolute top-1.5 right-1.5 z-30 flex gap-1">
        {onOpen && (
          <button
            type="button"
            onClick={onOpen}
            title="Open the full clip"
            className="grid h-7 w-7 place-items-center rounded-full border text-white/80 backdrop-blur-md transition hover:text-white"
            style={{ background: 'rgba(10,10,13,0.72)', borderColor: LINE_STRONG }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M15 3h6v6M10 14 21 3M21 14v7H3V3h7" />
            </svg>
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          title="Back to the storyboard"
          className="grid h-7 w-7 place-items-center rounded-full border text-white/80 backdrop-blur-md transition hover:text-white"
          style={{ background: 'rgba(10,10,13,0.72)', borderColor: LINE_STRONG }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      <style>{`
        @keyframes clipRise {
          from { opacity: 0; transform: scale(0.92) }
          to   { opacity: 1; transform: none }
        }
      `}</style>
    </div>
  );
}

/**
 * The card's one control, in whichever of its three states this concept is in.
 *
 * The price only makes sense on the first press. Once a render is under way the
 * button's job is to say so and to lead back to it, and once a clip exists it is
 * a way in, not a way to buy another one — the backend refuses a second render
 * for a board that already has one, and a button still offering it would be a
 * promise nothing keeps.
 */
function ConceptAction({ board, state, onGenerate, onWatch, onOpen }) {
  const status = state?.status;
  const open = () => onGenerate?.(board);

  // One retry, then the advice changes. Pressing the same failed concept a
  // third time is not a plan, and each attempt costs a credit freeze — so past
  // that point the card points at the other concepts instead. The count is the
  // server's (`videos.boards.<id>.attempts`), so a reload does not reopen it.
  if (status === 'failed') {
    if (Number(state?.attempts) >= 2) {
      return (
        <div className="flex shrink-0 flex-col items-end gap-1 self-end">
          <p className="text-right text-[11.5px] leading-tight text-white/40">
            Didn&rsquo;t render. Try another storyboard.
          </p>
          {onOpen && (
            <button
              type="button"
              onClick={onOpen}
              className="rounded-[7px] border px-[11px] py-1.5 text-[12px] font-semibold text-white/70 transition hover:text-white"
              style={{ background: SURF2, borderColor: LINE_STRONG }}
            >
              Open board
            </button>
          )}
        </div>
      );
    }
    return (
      <div className="flex shrink-0 flex-col items-end gap-1 self-end">
        <p className="text-right text-[11.5px] leading-tight text-white/40">
          Didn&rsquo;t render.
        </p>
        <RetryCountdownButton onClick={open} />
      </div>
    );
  }

  if (status === 'running') {
    return (
      <button
        type="button"
        onClick={open}
        className="inline-flex shrink-0 items-center gap-2 self-end rounded-[7px] border px-[11px] py-1.5 text-[12.5px] font-bold text-white/80 transition hover:text-white"
        style={{ background: SURF2, borderColor: LINE_STRONG }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" className="shrink-0 animate-spin" aria-hidden>
          <circle cx="12" cy="12" r="9" fill="none" strokeWidth="3" stroke="rgba(255,255,255,0.18)" />
          <path d="M21 12a9 9 0 0 0-9-9" fill="none" strokeWidth="3" strokeLinecap="round" stroke="rgba(255,255,255,0.75)" />
        </svg>
        <span className="whitespace-nowrap">Rendering</span>
      </button>
    );
  }

  if (status === 'ready') {
    return (
      <button
        type="button"
        onClick={onWatch}
        // The same solid build as Generate, in green. An outlined variant read
        // as the lesser button, when finishing a render is the moment the card
        // has the most to offer.
        className="inline-flex shrink-0 items-center gap-2 self-end rounded-[7px] bg-[linear-gradient(180deg,#5FE39A_0%,#34C776_46%,#1E9A57_100%)] px-[11px] py-1.5 text-[13px] font-bold text-[#062616] shadow-[inset_0_1px_0_rgba(255,255,255,0.45),inset_0_-1px_0_rgba(0,0,0,0.22),0_1px_0_rgba(0,0,0,0.5),0_4px_10px_-4px_rgba(0,0,0,0.75)] transition hover:brightness-110 active:translate-y-px active:shadow-[inset_0_2px_4px_rgba(0,0,0,0.35)]"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="shrink-0" aria-hidden>
          <path d="M8 5v14l11-7z" />
        </svg>
        <span className="whitespace-nowrap">Watch</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={open}
      className="inline-flex shrink-0 items-center gap-2 self-end rounded-[7px] bg-[linear-gradient(180deg,#9176ff_0%,#7c5cff_46%,#6148c7_100%)] px-[11px] py-1.5 text-[12.5px] font-bold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.42),inset_0_-1px_0_rgba(0,0,0,0.28),0_1px_0_rgba(0,0,0,0.5),0_4px_10px_-4px_rgba(0,0,0,0.75)] transition hover:brightness-110 active:translate-y-px active:shadow-[inset_0_2px_4px_rgba(0,0,0,0.4)]"
    >
      <span className="shrink-0 whitespace-nowrap" style={{ textShadow: '0 1px 0 rgba(0,0,0,0.22)' }}>
        Generate
      </span>
      {/* The price, struck through, then what it actually costs. The icon was
          14px on a dark gradient and simply did not read; the struck number was
          smaller again. Both are up a size and the icon sits on its own lighter
          disc so it has an edge to be seen against. */}
      <span className="flex shrink-0 items-center gap-[6px]">
        {/* 20px, not 14. This is the same `adcreative.svg` the profile page
            uses — but it renders it at 28, and the artwork is a 1879px PNG with
            fine detail in it. At half that size the detail did not survive the
            downscale and the coin read as a smudge, which looked like a missing
            icon rather than a small one. No backing plate: the plate was there
            to rescue a size that was simply too small. */}
        <img src={creditIcon} alt="" className="h-5 w-5 shrink-0" />
        <s className="shrink-0 text-[13px] font-semibold opacity-75">32</s>
        <span className="shrink-0 rounded-[5px] bg-black/30 px-[7px] py-[1px] text-[13px] font-bold">
          Free
        </span>
      </span>
    </button>
  );
}

/** A keyframe that has not been drawn yet — same box, shimmering. */
/**
 * A keyframe that is not there yet.
 *
 * Two states, and which one shows is the backend's call. Upstream reports a run
 * `succeeded` with frames still failed, and most of those are recovered by the
 * retry Node fires in response — so a frame that is absent right now is far more
 * often "being redrawn" than "gone". The mosaic stays until the retries are
 * spent (`failed`), and only then does the card admit the gap.
 */
function FramePlaceholder({ badge, seed = 0, failed = false }) {
  return (
    <div
      // No `animate-pulse`. A box fading in and out as one says "placeholder",
      // and the box is not a placeholder — a picture is being composed for it.
      // The mosaic says that instead: pieces settling at different rates.
      className="relative h-full min-w-0 flex-1 overflow-hidden rounded-lg border bg-white/[0.03]"
      style={{ borderColor: LINE }}
    >
      {failed ? (
        <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 px-2 text-center">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" className="text-white/25" aria-hidden>
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="m3 16 5-4 4 3 3-2 6 4M4 4l16 16" />
          </svg>
          <span className="text-[10px] leading-snug font-medium text-white/35">
            Frame didn’t render
          </span>
        </div>
      ) : (
        /* `seed` differs per frame, so the first and last placeholders on a card
           are not the same pattern twice. */
        <MosaicLoader offset={seed} />
      )}
      <FrameBadge>{badge}</FrameBadge>
    </div>
  );
}

function FrameBadge({ children }) {
  return (
    <span
      className="pointer-events-none absolute top-[7px] left-[7px] max-w-[calc(100%-14px)] overflow-hidden rounded border px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap text-white"
      style={{ background: 'rgba(8,10,12,0.8)', borderColor: LINE_STRONG }}
    >
      {children}
    </span>
  );
}

/**
 * The script, on one line.
 *
 * A single row so it sits beside its icon the way a caption does, and so every
 * card's footer is the same height however much a brand's voiceover has to say.
 * The full line stays reachable on the `title`.
 */
function VoiceoverLine({ text }) {
  if (!text) return <div className="h-[19px] shrink-0" />;
  return (
    <div className="flex min-w-0 shrink-0 items-center gap-[7px]" title={text}>
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        className="shrink-0 text-white/50"
        aria-hidden
      >
        <path d="M3 14v-2a9 9 0 0 1 18 0v2" />
        <rect x="2" y="14" width="4" height="7" rx="2" fill="currentColor" stroke="none" />
        <rect x="18" y="14" width="4" height="7" rx="2" fill="currentColor" stroke="none" />
        <path d="M9 11v6M12 9v10M15 11v6" />
      </svg>
      <span className="min-w-0 truncate text-xs leading-relaxed text-[#b6bcc3] 2xl:text-sm">
        {text}
      </span>
    </div>
  );
}

/**
 * One keyframe, clickable to full size.
 *
 * `object-cover`, not `contain`. The frames come back at 293x512 — 9:15.7, a
 * hair off the 9:16 the box is — and `contain` turned that rounding error into
 * visible letterbox bars, so every scene sat in an obvious black box instead of
 * filling its frame. Cover crops about a pixel and the box disappears.
 */
function Frame({ img, label, badge }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div
      // `flex-1` rather than an aspect lock. The pair used to be sized from
      // HEIGHT at 9:16, so on any card wider than two portraits the leftover
      // width showed as a gap down both edges and between them. Filling the row
      // and letting `object-cover` crop the odd pixel removes the gap without
      // making anything smaller.
      className="relative h-full min-h-0 min-w-0 flex-1 overflow-hidden rounded-lg border bg-black/35 transition-colors duration-300 hover:border-[#15DCFF]/50"
      style={{ borderColor: LINE }}
    >
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="block h-full w-full cursor-zoom-in"
        aria-label={`Open ${label} full size`}
      >
        <img src={img.src} alt={label} loading="lazy" className="h-full w-full object-cover" />
      </button>

      <FrameBadge>{badge}</FrameBadge>

      {/* Portalled to `document.body` — every panel on this screen clips its own
          overflow, so a modal rendered in place would be cut by the very card it
          is meant to escape. */}
      {open &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          >
            <figure className="relative max-h-full max-w-full" onClick={(e) => e.stopPropagation()}>
              <img
                src={img.src}
                alt={label}
                className="max-h-[88vh] max-w-[88vw] rounded-xl border border-white/15 object-contain shadow-[0_40px_120px_-20px_rgba(0,0,0,0.95)]"
              />
              <figcaption className="absolute right-3 bottom-3 rounded bg-black/65 px-2 py-1 text-[10px] tracking-[0.08em] text-white/70 uppercase backdrop-blur-sm">
                {label}
              </figcaption>
              <CloseButton onClick={() => setOpen(false)} />
            </figure>
          </div>,
          document.body
        )}
    </div>
  );
}

/**
 * What a concept looks like before it exists.
 *
 * Shaped like the card it becomes — two portrait frames, a title line, a script
 * line, a button — because a skeleton's whole job is to tell you what is coming.
 * Three grey rectangles would have said "something is loading"; this says "three
 * concepts, each with two frames and a voiceover".
 */
/**
 * The concepts rail when the run never started.
 *
 * Distinct from the skeletons, and the distinction is the whole point: a
 * skeleton says "this is coming", and saying that about work that was never
 * accepted is a shimmer that never ends. A generator that refused the request
 * is the one failure nothing else can correct — no job exists, so no callback
 * is ever coming.
 */
function ConceptsUnavailable({ message }) {
  return (
    <div className="col-span-full grid place-items-center rounded-xl border border-dashed border-white/[0.09] px-8 py-12 text-center">
      <div>
        <p className="text-[13.5px] font-semibold text-white/80">
          We couldn&rsquo;t generate video ideas
        </p>
        <p className="mx-auto mt-1.5 max-w-md text-[12.5px] leading-relaxed text-white/45">
          {message || 'The generator did not respond. Your brand profile is saved — nothing here is lost.'}
        </p>
      </div>
    </div>
  );
}

function ConceptSkeleton({ delay = 0 }) {
  const pulse = { animationDelay: `${delay}ms` };
  return (
    <article
      className="flex h-full min-h-0 w-full min-w-0 flex-col gap-2.5 rounded-2xl border p-3"
      style={{ background: SURF, borderColor: LINE }}
    >
      {/* The two frame slots carry the same mosaic the real placeholders do —
          this is the same wait one step earlier, and a plain pulsing rectangle
          here followed by a mosaic a few seconds later looked like two
          different loading states for one continuous thing.

          `flex-1`, not an aspect lock, so these fill the strip exactly as the
          real frames do and the layout does not jump when they arrive. */}
      <div className="flex min-h-20 flex-1 basis-0 items-center justify-center">
        {[0, 1].map((i) => (
          <div
            key={i}
            className={cn(
              'h-full min-w-0 flex-1 overflow-hidden rounded-lg bg-white/[0.03]',
              i === 1 && 'ml-2'
            )}
          >
            <MosaicLoader offset={delay / 140 + i * 7} />
          </div>
        ))}
      </div>
      <div className="h-4 w-2/3 shrink-0 animate-pulse rounded bg-white/[0.07]" style={pulse} />
      <div className="h-3.5 w-full shrink-0 animate-pulse rounded bg-white/[0.05]" style={pulse} />
      <div
        className="h-7 w-32 shrink-0 animate-pulse rounded-[7px] bg-white/[0.05]"
        style={pulse}
      />
    </article>
  );
}

/* ── the templates dock ─────────────────────────────────────────────────────*/

/**
 * Tag colours, on the corpus's own vocabulary.
 *
 * A tone is the one thing on a template tile that can be read at thumbnail size,
 * so each gets its own hue rather than a uniform grey pill — "energetic" and
 * "sophisticated" should not look like the same fact. Unknown tones fall back to
 * a stable hash into the same set, so a tone we have never seen still gets a
 * consistent colour rather than an odd-one-out grey.
 */
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

function tagColor(tone) {
  const key = String(tone || '')
    .trim()
    .toLowerCase();
  if (TAG_COLORS[key]) return TAG_COLORS[key];
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return TAG_FALLBACK[hash % TAG_FALLBACK.length];
}

/**
 * How wide a template tile should be, per unit of height.
 *
 * ── Why this is measured and not declared ────────────────────────────────────
 * The match payload carries no dimensions. `template_id`, `score`, `domain`,
 * `content_type`, `video_kind`, `tone`, `one_line_summary`, `duration_sec`,
 * `preview_path`, `source_url` — and that is the whole of it. So there is
 * nothing to READ the shape of a reference ad from before its file arrives.
 *
 * The first version of this assumed 9:16 for everything, which was wrong in the
 * one way that shows: the corpus is reference ads scraped from YouTube, so a
 * large share of them are landscape, and forcing a 16:9 frame through a
 * portrait box `object-cover`s away most of the shot. A row of identically
 * cropped tiles is also what made the strip look flat — the design's own tiles
 * were 9:16, 16:9, 1:1 and 4:5 together, and that variety is doing real work.
 *
 * `loadedmetadata` gives us `videoWidth`/`videoHeight` from the file itself,
 * which is the truth and costs one metadata range request per tile — already
 * paid, since `preload="metadata"` was fetching it anyway. `aspect_ratio` is
 * still honoured first, so the day DS adds it to the payload this stops
 * measuring and starts reading.
 */
const DEFAULT_ASPECT = 4 / 5;

function declaredAspect(template) {
  const raw = template.aspect_ratio || template.ratio;
  if (typeof raw === 'string' && raw.includes(':')) {
    const [w, h] = raw.split(':').map(Number);
    if (w > 0 && h > 0) return w / h;
  }
  if (Number.isFinite(template.width) && Number.isFinite(template.height) && template.height > 0) {
    return template.width / template.height;
  }
  return null;
}

function aspectOf(template) {
  const declared = declaredAspect(template);
  if (declared) return declared;
  // A YouTube tile can never measure itself — an iframe reports no dimensions —
  // so the one shape we can be reasonably sure of is the one YouTube itself
  // letterboxes everything into. Its thumbnails are 16:9 too, so the poster and
  // the embed agree.
  if (!videoSources(template).length && youtubeId(template.source_url)) return 16 / 9;
  return DEFAULT_ASPECT;
}

/**
 * Everywhere a tile could get a video from, best first.
 *
 * ── Why there is more than one ───────────────────────────────────────────────
 * `preview_path` — the service's own cached copy — is present on only about one
 * template in seven, and the copies that do exist are not currently reachable:
 * the path resolves to a 404 on the onboarding origin and a 403 on the media
 * CDN. So relying on it alone means almost nothing ever plays.
 *
 * `source_url` is the original the copy was made FROM, and for a good share of
 * the corpus it is a direct file on a public CDN — the cached name
 * `…_057207687c9386e2802d447e676a7362_720w.mp4` is the same file as the
 * Pinterest URL ending in exactly those characters, and that original answers
 * `200 video/mp4` with range requests today. Where it is a file, it plays.
 *
 * Where it is a YouTube watch page it is not a video at all and is left out —
 * `<video>` cannot render an HTML page, and a source that can only fail is
 * worse than no source, because it costs the tile its honest "no preview".
 */
// `.cmfv` earns its place here by measurement, not by looking like a video.
// Pinterest serves a slice of its corpus as CMAF under an `hls/` path, and the
// obvious reading — "HLS means a manifest, and Chrome cannot play those without
// a library" — is wrong for these: each file is a SELF-CONTAINED fragmented
// MP4, answers `content-type: video/mp4`, and decodes to 360x640 in a plain
// `<video>`. Six tiles in a twenty-template rail were showing "no preview" on
// the strength of their extension alone.
//
// `.m3u8` is deliberately NOT here. That one really is a manifest and really
// does need hls.js.
const VIDEO_FILE = /\.(mp4|webm|ogv|mov|m4v|cmfv)$/i;

function videoSources(template) {
  const direct = String(template.source_url || '').split('?')[0];
  return [template.preview_url, VIDEO_FILE.test(direct) ? template.source_url : null].filter(
    Boolean
  );
}

/**
 * The eleven characters YouTube identifies a video by, from any of the shapes
 * the corpus stores: `watch?v=`, `youtu.be/`, `/shorts/`, `/embed/`, `/v/`.
 *
 * Most of this corpus is YouTube — 22 of the 30 source URLs in a recent run —
 * so "it is a page, not a file, therefore no preview" was writing off the
 * majority of the rail. A page cannot go in a `<video>`, but it can go in an
 * iframe, and that is the whole difference between a dead tile and a playing
 * one.
 */
const YOUTUBE_ID =
  /(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/;

function youtubeId(url) {
  const match = String(url || '').match(YOUTUBE_ID);
  return match ? match[1] : null;
}

/** The embed a hovered YouTube tile mounts. Muted, so autoplay is permitted. */
const youtubeEmbed = (id) =>
  `https://www.youtube-nocookie.com/embed/${id}?` +
  [
    'autoplay=1',
    'mute=1',
    // No chrome at all: the tile is a thumbnail that moves, not a player.
    'controls=0',
    'disablekb=1',
    'fs=0',
    'modestbranding=1',
    'rel=0',
    'playsinline=1',
    // No auto-captions and no annotations. A muted 15-second ad playing at
    // thumbnail size does not need "[Music]" written across it.
    'cc_load_policy=0',
    'iv_load_policy=3',
    // A single video only loops if it is also its own one-item playlist.
    'loop=1',
    `playlist=${id}`,
  ].join('&');

/** Poster for a YouTube tile. `maxres` is missing on older uploads; `mq` never is. */
const youtubeThumbs = (id) => [
  `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`,
  `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
];

/**
 * One reference template, as a tile.
 *
 * The preview IS the card — no caption, because at this size a caption would
 * take the half of the tile that is actually telling you something. What a
 * template is called and how long it runs live on the `title`; what it FEELS
 * like is the thing worth spending pixels on, so the tones sit on the picture
 * and the picture plays on hover.
 *
 * Tiles whose match shipped no `preview_path` — the corpus is inconsistent —
 * show their summary in the frame's place. A tile with an empty grey box says
 * the picture failed; a tile with the description in it says what the ad is.
 *
 * `maxTags` comes from the dock because it is a function of how wide the tile
 * has ended up, which is a function of the dock's height. Two chips on a 65px
 * tile is two clipped chips, and a clipped word is worse than an absent one.
 */
function TemplateTile({ template: t, expanded, slot = 0 }) {
  const video = useRef(null);
  const [hover, setHover] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  // Which of the tile's candidate sources is in play. Advanced by `onError`,
  // never reset, so a dead source is tried once and then left behind.
  const [srcIndex, setSrcIndex] = useState(0);
  // Same idea for the YouTube poster: `maxresdefault` first, `mqdefault` after.
  const [thumbIndex, setThumbIndex] = useState(0);
  // Starts at whatever the payload claims (nothing, today) and is corrected the
  // moment the file's own metadata lands.
  const [aspect, setAspect] = useState(() => aspectOf(t));

  const name = t.content_type || t.video_kind_label || 'Reference ad';

  // No `title` on the tile. A native tooltip fires on a delay, lands wherever
  // the pointer happens to be, and cannot be dismissed — so on a rail you scrub
  // across to watch things play, it spends most of its time covering the tile
  // next to the one you are looking at.

  // How wide THIS tile ends up. Expanded it is the column; collapsed the strip's
  // height buys width at the tile's own ratio, so a 16:9 tile is nearly three
  // times the width of the 9:16 beside it and can hold three times the text.
  //
  // Deliberately measured from `aspectOf(t)` — what the payload says — and NOT
  // from the `aspect` STATE that a loaded video corrects. The state arrives
  // asynchronously, so keying the chip count to it made tiles render two chips
  // and then drop to one the moment the video reported its dimensions, which
  // reads as the UI twitching. A stable answer that is occasionally a little
  // generous is better than an exact one that changes under you.
  const width = expanded ? slot : Math.round(slot * aspectOf(t));
  // Two chips need room for the two longest labels side by side. Where the
  // estimate above turns out generous, the row below truncates rather than
  // wrapping, so being wrong costs an ellipsis rather than a second line.
  const maxTags = width < 190 ? 1 : 2;

  // "Recommended" is back among the chips, and it has to be: the cyan edge that
  // was carrying it is gone, so a chip is the only thing left that can say it.
  // It was moved out to the border in the first place because the word did not
  // fit a 65px tile — tiles start at 138px now, so the reason expired.
  const tags = [
    ...(t.recommended ? [{ label: 'Recommended', accent: true }] : []),
    ...(t.tone || []).map((tone) => ({ label: tone })),
  ].slice(0, maxTags);

  // Best source first, with the next one taking over if it fails — see
  // `videoSources`. The index only ever moves forward, so a source that dies
  // cannot be retried in a loop.
  const sources = videoSources(t);
  const src = sources[srcIndex];
  // Only when there is no file to play: a real video always beats an embed,
  // because it is ours to control and carries no third-party frame.
  const ytId = src ? null : youtubeId(t.source_url);
  const playable = Boolean(src) || Boolean(ytId);

  // The embed is mounted ONLY while hovered, and that is not a detail — twenty
  // YouTube iframes on one screen is twenty third-party players booting at once.
  // Unmounting on leave is also what stops playback: there is no `pause()` to
  // call without pulling in the IFrame API.
  const showingVideo = playing || (Boolean(ytId) && hover);

  // The pointer IS the control — there is no glyph and nothing to press, so
  // these two handlers are the whole of the interaction.
  const onEnter = () => {
    setHover(true);
    video.current?.play().catch(() => {});
  };
  const onLeave = () => {
    setHover(false);
    setProgress(0);
    const el = video.current;
    if (el) {
      el.pause();
      el.currentTime = 0;
    }
  };

  return (
    // A div, not a link. The tile used to open the reference ad in a new tab,
    // which is the wrong thing to happen when the reference ad is already
    // playing inside it — and a click has a better job waiting for it (choosing
    // the template), so it does nothing at all rather than doing the old thing.
    <div
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      className={cn(
        // No border, in any state. The tile is a picture, and a picture does not
        // need a frame drawn round it — the accent ones in particular were
        // announcing "hovered" and "recommended" louder than the ad they were
        // drawn around, on a rail where a dozen are visible at once. The rounding
        // is kept minimal for the same reason: enough to soften the corner,
        // little enough that the crop reads as the edge of the video.
        'group relative block shrink-0 overflow-hidden rounded-sm bg-[#121216]',
        expanded ? 'w-full' : 'h-full w-auto'
      )}
      style={{ aspectRatio: String(aspect), transition: 'aspect-ratio 180ms ease' }}
    >
      {src ? (
        <video
          ref={video}
          // Keyed on the source so a fallback actually remounts the element.
          // Swapping `src` alone leaves the failed media state in place and the
          // second source never loads.
          key={src}
          src={src}
          muted
          loop
          playsInline
          preload="metadata"
          onError={() => setSrcIndex((i) => i + 1)}
          onLoadedMetadata={(e) => {
            const { videoWidth: w, videoHeight: h } = e.currentTarget;
            // Only when the payload did not already tell us, and only for a
            // real decode — a failed one reports 0x0.
            if (!declaredAspect(t) && w > 0 && h > 0) setAspect(w / h);
          }}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onTimeUpdate={(e) => {
            const el = e.currentTarget;
            if (el.duration) setProgress((el.currentTime / el.duration) * 100);
          }}
          className="h-full w-full object-cover"
        />
      ) : ytId ? (
        // ── The YouTube tile ────────────────────────────────────────────────
        // A poster at rest and a player on hover. The poster is what makes the
        // swap survivable: an iframe takes a moment to boot, and without an
        // image already in place the tile would flash black on every hover.
        <>
          {hover && (
            <iframe
              src={youtubeEmbed(ytId)}
              title={name}
              allow="autoplay; encrypted-media"
              referrerPolicy="strict-origin-when-cross-origin"
              // `pointer-events-none` keeps the tile in charge of its own hover.
              // An interactive iframe swallows the pointer, so YouTube's own
              // chrome would answer clicks we have deliberately made inert.
              className="pointer-events-none absolute inset-0 h-full w-full border-0"
            />
          )}
          {/* The poster sits OVER the embed and fades out on a delay. YouTube
              spends its first second or so showing a title bar and a control
              strip before settling into the video, and holding the still image
              over that turns a flash of someone else's chrome into a crossfade
              into the ad. It is painted after the iframe so it wins without
              needing a stacking context of its own. */}
          <img
            key={youtubeThumbs(ytId)[thumbIndex]}
            src={youtubeThumbs(ytId)[thumbIndex]}
            alt=""
            loading="lazy"
            // `maxresdefault` 404s on older uploads and YouTube answers with a
            // 120x90 placeholder rather than an error, so a failed load is not
            // always an `onError` — but when it is, `mqdefault` always exists.
            onError={() => setThumbIndex((i) => Math.min(i + 1, youtubeThumbs(ytId).length - 1))}
            className={cn(
              'absolute inset-0 h-full w-full object-cover transition-opacity duration-500',
              hover ? 'opacity-0 delay-1000' : 'opacity-100'
            )}
          />
        </>
      ) : (
        // Many matches ship no preview at all — the corpus is inconsistent — and
        // a portrait tile filled with a clipped paragraph was the thing that
        // made this row look broken: five columns of grey text cut off
        // mid-sentence, none of it readable at 112px. What a template IS fits on
        // two lines and is the only part worth showing at this size; the
        // sentence moves to the tooltip, where there is room for it.
        <div
          className={cn(
            'flex h-full w-full flex-col items-center justify-center gap-2 px-2 text-center',
            tags.length > 0 && 'pb-6'
          )}
          style={{ background: 'linear-gradient(155deg,#22222b,#141419 62%,#101014)' }}
        >
          {/* A film strip with a line through it. The plain strip read as "this
              is a video" on a tile that is the one thing in the rail that
              cannot play — so the tile looked broken rather than empty, and the
              missing play button looked like a bug instead of an absence. */}
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="shrink-0 text-white/25"
            aria-hidden
          >
            <rect x="2" y="4" width="20" height="16" rx="2.5" />
            <path d="M7 4v16M17 4v16M2 12h20" />
            <path d="M3 21L21 3" className="text-white/40" />
          </svg>
          <span className="line-clamp-2 text-[10px] leading-snug font-semibold text-white/60 2xl:text-xs">
            {name}
          </span>
          {/* Said outright. "Why is there no play button on this one" is a
              question the tile should answer by itself. */}
          <span className="text-[10px] font-medium tracking-wider text-white/30 uppercase">
            No preview
          </span>
        </div>
      )}

      {/* The chips carry their own dark, blurred backing, so the tile-wide scrim
          that used to sit under them is gone — it dimmed the bottom two-fifths
          of every thumbnail to protect two small labels. */}
      {tags.length > 0 && (
        <>
          <div
            className={cn(
              // `flex-nowrap`: one row, always. Wrapping was the one failure
              // mode that actually looked broken — a second line of chips
              // climbing up the tile's face — and it could be provoked by any
              // tone long enough. Now a chip that does not fit is shortened
              // instead, which is a word that ran out of room rather than a
              // layout that gave way.
              'pointer-events-none absolute right-1.5 bottom-1.5 left-1.5 flex flex-nowrap gap-1 transition-opacity',
              showingVideo && 'opacity-0'
            )}
          >
            {tags.map(({ label, accent }) => {
              // The recommendation takes the brand cyan rather than a hashed
              // tone colour, so it reads as a different KIND of fact from the
              // tones beside it.
              const [color, bg, border] = accent
                ? ['#9FEEFF', 'rgba(21,220,255,.16)', 'rgba(21,220,255,.4)']
                : tagColor(label);
              return (
                <span
                  key={label}
                  // `max-w-full truncate`: one long tone on a narrow tile is
                  // wider than the tile, and a word sheared off by the tile's
                  // own `overflow-hidden` reads as a rendering fault. An
                  // ellipsis reads as a word that did not fit.
                  className="min-w-0 shrink truncate rounded-sm px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap capitalize backdrop-blur-md"
                  style={{ color, background: bg, border: `1px solid ${border}` }}
                >
                  {label}
                </span>
              );
            })}
          </div>
        </>
      )}

      {/* Appears with the preview. The tile plays on hover and there is nothing
          to press while it does — this is the one thing you would want to do
          with a reference ad you like, in the same build as the concept cards'
          Generate so the two read as the same offer.

          Inert for now, deliberately: what "recreate" turns a template into is
          not decided, and a button that navigates somewhere arbitrary is harder
          to correct later than one that does nothing yet. */}
      <button
        type="button"
        onClick={(e) => e.stopPropagation()}
        className={cn(
          'absolute right-2 bottom-2 z-[3] inline-flex items-center gap-1.5 rounded-[7px]',
          'bg-[linear-gradient(180deg,#9176ff_0%,#7c5cff_46%,#6148c7_100%)] px-2.5 py-1.5',
          'text-[12px] font-bold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.42),inset_0_-1px_0_rgba(0,0,0,0.28),0_4px_10px_-4px_rgba(0,0,0,0.75)]',
          // Opacity, not mount/unmount: a button that appears on hover should
          // not also be a layout change, and fading keeps the pointer from
          // chasing something that popped into existence under it.
          'opacity-0 transition duration-200 group-hover:opacity-100 hover:brightness-110 active:translate-y-px'
        )}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M3 12a9 9 0 0 1 15.5-6.2L21 8M21 12a9 9 0 0 1-15.5 6.2L3 16" />
          <path d="M21 4v4h-4M3 20v-4h4" />
        </svg>
        Recreate
      </button>

      {/* Only the `<video>` path has a timeline to report. Reading playback
          position out of a YouTube iframe means loading their IFrame API, which
          is a lot of third-party JavaScript for a 2px bar. */}
      {playing && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-white/[0.12]">
          <div className="h-full bg-[#7c5cff]" style={{ width: `${progress}%` }} />
        </div>
      )}
    </div>
  );
}

/**
 * The next page, arriving.
 *
 * Not a button — the rail fetches as you reach the end of it, so there is
 * nothing to press. This is the placeholder that occupies the slot the tile is
 * about to fill, which is also what keeps the scroll position from lurching
 * when the page lands: the space was already there.
 */
function LoadingTile({ expanded }) {
  return (
    <div
      aria-hidden
      className={cn(
        'flex shrink-0 flex-col items-center justify-center gap-2 rounded-sm border border-dashed border-white/[0.12] bg-white/[0.02] text-white/40',
        expanded ? 'aspect-4/5 w-full' : 'aspect-4/5 h-full w-auto'
      )}
    >
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-white/60" />
      <span className="px-2 text-center text-[10px] leading-[1.3] font-medium">Finding more…</span>
    </div>
  );
}

/**
 * The dock.
 *
 * Two modes, one control. Collapsed it is a single row that scrolls sideways —
 * the band is wide and short, and a vertical list in a 200px strip would show
 * one and a half tiles. Dragged (or expanded) past 340px it becomes a masonry of
 * columns instead, because at that height a single row is mostly empty space
 * above and below the tiles.
 *
 * The height is owned by the PARENT, not by this component: the storyboards
 * behind it need the same number to pad themselves with, or the last row of
 * cards would sit permanently under the dock with no way to scroll it clear.
 */
function TemplateDock({ items, pending, failed, height, onResize, onLoadMore, canLoadMore }) {
  const strip = useRef(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(true);
  const [overflowing, setOverflowing] = useState(false);
  // Local, because the server's own `queued` takes a round trip to arrive and
  // the rail has to show it is working immediately. It clears when the row
  // actually grows — the page landing is the real end of the wait — with a
  // failsafe so a page that never arrives cannot leave a spinner up forever.
  const [busy, setBusy] = useState(false);

  const expanded = height > DOCK_EXPANDED_AT;

  useEffect(() => setBusy(false), [items.length]);
  useEffect(() => {
    if (!busy) return undefined;
    const timer = setTimeout(() => setBusy(false), 45_000);
    return () => clearTimeout(timer);
  }, [busy]);

  const loadMore = useCallback(async () => {
    setBusy(true);
    try {
      await onLoadMore?.();
    } catch {
      setBusy(false);
    }
  }, [onLoadMore]);

  // ── Infinite scroll, on whichever axis the dock is currently using ─────────
  //
  // The strip scrolls sideways when collapsed and downwards when expanded, and
  // "near the end" is the same idea on both — it is only the axis that changes.
  // One measurement covers them because the scroller is the same element in
  // both modes.
  //
  // The list is also topped up when it does NOT overflow. Five tiles on a
  // 1900px rail leave room for six more and no way to scroll to them, so
  // waiting for a scroll that cannot happen would strand the row at five — the
  // state this was built to fix. Filling the visible space and then continuing
  // on scroll is the whole behaviour.
  //
  // `requestedAt` is what stops that from becoming a loop. It records the list
  // length that each automatic request was made at, and refuses to ask again
  // until the length changes — so a page that comes back empty, or one the
  // server declines, costs exactly one request rather than a retry storm.
  const requestedAt = useRef(-1);

  const maybeLoadMore = useCallback(() => {
    const el = strip.current;
    if (!el || !canLoadMore || busy) return;
    if (requestedAt.current === items.length) return;

    const THRESHOLD = 260;
    const nearEnd = expanded
      ? el.scrollTop >= el.scrollHeight - el.clientHeight - THRESHOLD
      : el.scrollLeft >= el.scrollWidth - el.clientWidth - THRESHOLD;

    if (!nearEnd) return;
    requestedAt.current = items.length;
    loadMore();
  }, [canLoadMore, busy, expanded, items.length, loadMore]);

  useLayoutEffect(() => {
    const el = strip.current;
    if (!el) return undefined;
    const measure = () => setBox({ width: el.clientWidth, height: el.clientHeight });
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    measure();
    return () => observer.disconnect();
  }, []);

  const measureScroll = useCallback(() => {
    const el = strip.current;
    if (!el) return;
    setAtStart(el.scrollLeft <= 4);
    setAtEnd(el.scrollLeft >= el.scrollWidth - el.clientWidth - 4);
    setOverflowing(el.scrollWidth > el.clientWidth + 4);
  }, []);

  const onScroll = useCallback(() => {
    measureScroll();
    maybeLoadMore();
  }, [measureScroll, maybeLoadMore]);

  useEffect(() => {
    measureScroll();
    // Also on every relayout, not only on scroll: a page landing, the dock
    // being dragged taller, or the window widening all change whether the end
    // of the list is in view without the user touching the scrollbar.
    maybeLoadMore();
  }, [measureScroll, maybeLoadMore, items.length, expanded, box.width, box.height, height]);

  const startDrag = (e) => {
    e.preventDefault();
    document.body.style.cursor = 'ns-resize';
    const onMove = (ev) => onResize(window.innerHeight - ev.clientY);
    const onUp = () => {
      document.body.style.cursor = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const toggle = () => onResize(expanded ? DOCK_MIN_H : Math.round(window.innerHeight * 0.72));

  const scrollBy = (dir) =>
    strip.current?.scrollBy({
      left: dir * Math.round(strip.current.clientWidth * 0.85),
      behavior: 'smooth',
    });

  // Columns, packed shortest-first. The corpus DOES carry mixed aspect ratios —
  // YouTube tiles are 16:9, Pinterest ones 9:16 — so this is doing real work
  // rather than a round robin.
  //
  // The target width is what decides how big everything is in this mode, and
  // 230 was set when every tile was portrait. A 16:9 ad in a 230px column is
  // 129px tall, which is a letterbox slot rather than a picture. At 300 it is
  // ~170, and the portrait tiles that share the grid grow with it. 390 is that
  // again with another third on top.
  const columnCount = Math.max(2, Math.min(5, Math.round((box.width || 1100) / 390)));

  // The slot each tile has to fill. Expanded that is the column's width and the
  // tile takes all of it; collapsed it is the strip's HEIGHT, and the tile's own
  // aspect ratio decides how much width that buys — which is why the tile works
  // this out for itself rather than being handed a width. Assuming one ratio for
  // everything here was putting two chips on portrait tiles far too narrow to
  // hold them, and they wrapped into a second row.
  const slot = expanded
    ? Math.round((box.width || 1100) / columnCount)
    : Math.round(box.height || 130);
  const columns = [];
  if (expanded) {
    for (let i = 0; i < columnCount; i += 1) columns.push({ items: [], weight: 0 });
    items.forEach((t) => {
      const shortest = columns.reduce((a, b) => (b.weight < a.weight ? b : a));
      shortest.items.push(t);
      shortest.weight += 1 / aspectOf(t);
    });
  }

  const scrollable = !expanded && items.length > 0;

  return (
    <section
      className="absolute inset-x-0 bottom-0 z-[5] flex min-h-0 flex-col border-t shadow-[0_-20px_46px_rgba(0,0,0,0.5)]"
      style={{ height, background: SURF, borderColor: LINE }}
    >
      <div
        onMouseDown={startDrag}
        onDoubleClick={toggle}
        title="Drag to resize"
        className="grid h-3.5 shrink-0 cursor-ns-resize place-items-center bg-[#101317] transition-colors hover:bg-[#151a1f]"
      >
        <span className="h-[3px] w-11 rounded-[2px] bg-[#3a4149]" />
      </div>

      <div className="flex shrink-0 items-center justify-between gap-4 px-[18px] pt-2 pb-1.5">
        <h2 className="shrink-0 text-sm font-semibold text-white 2xl:text-base">
          Templates from your industry
        </h2>
        <button
          type="button"
          onClick={toggle}
          className="flex items-center gap-1.5 rounded-[7px] border px-2.5 py-[5px] text-xs font-semibold text-[#c3c9cf] transition hover:border-[#7c5cff]/45 hover:text-[#c3a8ff]"
          style={{ background: SURF2, borderColor: LINE }}
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
            className={cn('transition-transform', expanded && 'rotate-180')}
            aria-hidden
          >
            <path d="M7 15l5-5 5 5" />
          </svg>
          {expanded ? 'Collapse' : 'Expand all'}
        </button>
      </div>

      <div className="relative flex min-h-0 flex-1">
        {/* The fades stop above the strip's own bottom padding, so they shade the
            tiles and not the gap under them. */}
        {scrollable && !atStart && (
          <div
            className="pointer-events-none absolute top-0 bottom-3.5 left-0 z-[2] w-9"
            style={{ background: `linear-gradient(to right, ${SURF}, rgba(27,27,33,0))` }}
          />
        )}
        {scrollable && !atEnd && (
          <div
            className="pointer-events-none absolute top-0 right-0 bottom-3.5 z-[2] w-[46px]"
            style={{ background: `linear-gradient(to left, ${SURF}, rgba(27,27,33,0))` }}
          />
        )}
        {scrollable && !atStart && <ScrollButton side="left" onClick={() => scrollBy(-1)} />}
        {scrollable && !atEnd && <ScrollButton side="right" onClick={() => scrollBy(1)} />}

        <div
          ref={strip}
          onScroll={onScroll}
          className={cn(
            'no-scrollbar min-h-0 min-w-0 flex-1 scroll-smooth px-[18px] pt-0.5 pb-3.5',
            expanded
              ? 'flex gap-1.5 overflow-x-hidden overflow-y-auto'
              : 'flex items-start gap-2.5 overflow-x-auto overflow-y-hidden',
            // A brand that matched five templates left them huddled against the
            // left edge of a 1600px band, which reads as a layout that failed
            // rather than a short list. Centred, a short row is composed.
            // Only ever when the row FITS: `justify-center` on an overflowing
            // scroller pushes the first items off the left edge, out of reach of
            // both the scrollbar and the arrows.
            !expanded && !overflowing && 'justify-center'
          )}
        >
          {items.length ? (
            expanded ? (
              columns.map((column, i) => (
                <div key={i} className="flex min-w-0 flex-1 basis-0 flex-col gap-1.5">
                  {column.items.map((t) => (
                    <TemplateTile key={t.template_id} template={t} expanded slot={slot} />
                  ))}
                  {/* In the LAST column, where the grid's ragged bottom edge
                      already is — dropping it in a full column would push that
                      column longer than the rest for no reason. */}
                  {busy && i === columns.length - 1 && <LoadingTile expanded />}
                </div>
              ))
            ) : (
              <>
                {items.map((t) => (
                  <TemplateTile key={t.template_id} template={t} slot={slot} />
                ))}
                {/* At the END of the row, shaped like a tile, because that is
                    where you arrive having looked at all of them — a control in
                    the header would be asking you to go back for it. */}
                {busy && <LoadingTile />}
              </>
            )
          ) : pending ? (
            [0, 1, 2, 3, 4, 5, 6].map((i) => (
              <div
                key={i}
                className="aspect-9/16 h-full shrink-0 animate-pulse rounded-sm border border-white/[0.06] bg-white/[0.035]"
                style={{ animationDelay: `${i * 110}ms` }}
                aria-hidden
              />
            ))
          ) : (
            // Something has to occupy the band or it is a lit panel with nothing
            // in it — worse than the row it replaced, because the emptiness looks
            // like a bug.
            <div className="flex h-full w-full items-center justify-center rounded-sm border border-dashed border-white/[0.08] text-xs text-white/30">
              {/* Two different facts, and telling them apart matters: one says
                  the match ran and this brand has nothing yet, the other says
                  the match never ran. Reporting a service failure as "no
                  templates for this brand" is a quiet lie about the brand. */}
              {failed
                ? 'We couldn’t load templates right now.'
                : 'No reference templates for this brand yet.'}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function ScrollButton({ side, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={side === 'left' ? 'Scroll left' : 'Scroll right'}
      className={cn(
        'absolute top-1/2 z-[3] grid h-6.5 w-6.5 -translate-y-1/2 place-items-center rounded-full border text-[#c3c9cf] transition hover:border-[#7c5cff]/50 hover:text-white',
        side === 'left' ? 'left-1.5' : 'right-1.5'
      )}
      style={{ background: 'rgba(12,15,18,0.92)', borderColor: LINE }}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d={side === 'left' ? 'M15 6l-6 6 6 6' : 'M9 6l6 6-6 6'} />
      </svg>
    </button>
  );
}

/* ── status ─────────────────────────────────────────────────────────────────*/

/**
 * A rail's status line.
 *
 * Sections are `idle` until something starts them, which is a real state and not
 * a failure — "not started" was previously hardcoded and stayed on screen even
 * after both rails had completed.
 */
/* ── the row ──────────────────────────────────────────────────────────────────
   The recommendation takes the MIDDLE slot rather than the first. On the left it
   read as an ordered list, with the badge looking like a note about item one; in
   the centre it reads as "this is the pick, these are the alternatives either
   side of it".                                                                */
function orderWithLeadInMiddle(boards) {
  const lead = boards.find((b) => b.recommended) || boards[0];
  const rest = boards.filter((b) => b !== lead);
  const middle = Math.floor((boards.length - 1) / 2);
  const ordered = [...rest];
  ordered.splice(middle, 0, lead);
  return ordered;
}

/* ── the page ───────────────────────────────────────────────────────────────*/

// Collapsed, the dock is one row of portrait tiles plus its own chrome. Below
// this the tiles are too short to read; the ceiling leaves the storyboards a
// sliver so the dock can never take the screen outright.
// A collapsed tile is as tall as the strip and as wide as its aspect ratio makes
// it, so the dock's height IS the tile's width — and portrait tiles feel it
// worst, because 9:16 spends the height on almost none of it. At 190 a portrait
// tile was 53px across; at 264 it was ~112px and the tone chip fitted; here it
// is ~137px, which is legible without the dock taking a third of the screen to
// stand still in. Landscape tiles get wider still, which is free: the strip
// scrolls.
//
// The EXPANDED view is sized separately, by column width, and is deliberately
// more generous — that is the mode you are in when you have come to browse.
//
// Everything below is derived from this rather than tuned separately.
// Dropped from 318: the dock sat high enough to crowd the concepts, which are
// the screen's actual subject. A portrait tile is ~118px across here, still wide
// enough for its tone chip, and the concepts get the height back.
const DOCK_MIN_H = 272;
// Far enough above the minimum that dragging has somewhere to go before the
// strip flips into the masonry — at 340 a nudge on the handle changed the mode,
// and it has to keep clearing the minimum or the same thing happens again.
const DOCK_EXPANDED_AT = 420;
// What the storyboards reserve for the dock: its collapsed height plus the drag
// handle. Fixed on purpose — see the note on the section that uses it.
const DOCK_PAD = DOCK_MIN_H + 14;
const dockCeiling = () => Math.max(DOCK_MIN_H, window.innerHeight - 160);

// The furthest item the template contract can address: `skip` tops out at 15
// and `limit` at 20, so the highest legal window ends at the 35th. Past that
// there is no next page, and the rail stops asking rather than asking and being
// refused. Mirrors MAX_SKIP + MAX_LIMIT in services/onboarding/templateBridge.js.
//
// It was 15 here — the `skip` ceiling alone — which is why the rail stopped
// dead at twenty: Node was still willing to widen the window and reach the
// tail, and the client had already stopped asking it to.
const TEMPLATE_MAX_ITEMS = 35;

export default function Workspace({
  result = {},
  session = {},
  onStartOver,
  // Leave without finishing. The free render stays unspent, so the offer bar
  // keeps this session reachable — see OnBoardHome's `skipOnboarding`.
  onSkip,
  // Per-concept action. Not wired to a backend yet — `video.generate` exists in
  // the webhook contract but has no Node route — so the button is inert until a
  // handler is passed rather than pretending to start a render.
  onGenerateVideo,
  // `{ [boardId]: { status, … } }` — one entry per concept a render was started
  // for. Not part of `session`, because it is live client state: the section
  // read tells you what the SERVER has, and this also holds the click that has
  // not been answered yet.
  videosByBoard = {},
  // Asks for the next page of templates. Absent in the preview harness, which
  // has no session to page against — the control hides rather than failing.
  onLoadMoreTemplates,
}) {
  // The two rails come off the SESSION, not the brand result. `result` is the
  // brand context alone — templates and storyboards live in their own sections
  // and are invisible to anything reading only the context.
  const storyboards = session.storyboards || {};
  const templates = session.templates || {};
  const allBoards = storyboards.result?.storyboards || [];
  const templateItems = templates.result?.templates || [];

  // Owned here because the storyboards behind the dock pad themselves with it.
  const [dockH, setDockH] = useState(DOCK_MIN_H);
  const resizeDock = useCallback(
    (next) => setDockH(Math.min(Math.max(next, DOCK_MIN_H), dockCeiling())),
    []
  );
  // A window that shrinks can leave the dock taller than its own ceiling.
  useEffect(() => {
    const onResize = () => setDockH((h) => Math.min(h, dockCeiling()));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const templatesPending = ['queued', 'running'].includes(templates.status);

  // The brand panel sizes itself to its own content. Re-measured whenever the
  // context changes, because that is the only thing that changes its length.
  const [fitRef, fitSize] = useFitScale([result, session.brand?.status]);

  // Node retries a failed keyframe up to three times before giving up. Until it
  // has, a missing frame is work in progress and the card says so; after it has,
  // the gap is real and worth admitting. The flag is the backend's, because the
  // attempt count lives on the session — a reload must not reset it.
  const framesExhausted = Boolean(storyboards.imageRetry?.exhausted);

  // The concepts rail has never read its own status — it decided purely on
  // whether boards had arrived, so "failed" and "still coming" looked identical
  // and both shimmered for ever.
  const storyboardsFailed = storyboards.status === 'failed';

  // ── Concepts whose keyframes never arrived ───────────────────────────────
  //
  // Node re-requests missing keyframes three times before setting
  // `imageRetry.exhausted`. Until then a frameless card is work in progress and
  // says so. After it, the frames are not coming — and a concept with no frames
  // cannot be rendered into a clip, so leaving the card on screen offers the
  // user a button that can only fail.
  //
  // Dropped only once the retries are spent, and only for the boards that are
  // actually empty: a board that got one of its two frames is still renderable
  // and still shows. See ONBOARDING_FAILURE_HANDLING.md §3.
  const boards = framesExhausted
    ? allBoards.filter((b) => (b.images || []).some((img) => img?.status === 'ready' && img?.src))
    : allBoards;

  // Node records where the cursor got to and whether upstream ran out. Offering
  // "load more" past `exhausted` would be a button whose only outcome is
  // `accepted: false`, and the contract's `skip` ceiling is 15 — beyond that
  // there is no next page to ask for.
  const templatePaging = templates.pagination || {};
  const canLoadMoreTemplates =
    Boolean(onLoadMoreTemplates) &&
    templateItems.length > 0 &&
    !templatePaging.exhausted &&
    (Number(templatePaging.loaded) || templateItems.length) < TEMPLATE_MAX_ITEMS;
  // `context` is the merged brand profile; provenance (source_urls, citations)
  // sits one level up on the result beside it.
  const context = result.context || {};
  const logos = context.logo_urls || [];
  // The scrape often returns the logo inside `image_urls` as well; showing it
  // twice makes the strip look padded rather than found.
  const images = (context.image_urls || []).filter((url) => !logos.includes(url));
  const site = String((result.source_urls || [])[0] || '')
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '');
  const industry = [context.industry_major, context.industry_sub].filter(Boolean).join(' · ');
  const brandName = context.brand_name || site || 'Your brand';

  return (
    // `dark` is asserted here because this screen renders outside Layout, which
    // is what normally carries it.
    <div
      className="dark flex h-screen w-full flex-col overflow-hidden text-white"
      style={{ background: BG, fontFamily: "'Public Sans', sans-serif" }}
    >
      {/* The same offer bar the rest of the app carries, but with no button.
          Elsewhere it is a way IN; here the user is already inside it, and the
          button did nothing but scroll — an invitation to a place you are
          standing in. The line itself still earns its space: it is what tells
          the user the render they are about to start costs them nothing. */}
      <FreeAdBanner available />
      <Header onStartOver={onStartOver} onSkip={onSkip} />

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[296px_1fr]">
        {/* ═══ the brand ═══ */}
        <aside
          className="hidden min-h-0 flex-col overflow-hidden border-r lg:flex"
          style={{ background: CHROME, borderColor: LINE }}
        >
          {/* The header sits in a lit band rather than on the flat panel. The
              brand's name is the one thing on this screen that is the user's
              own, and it was rendering as small grey text against the same
              surface as everything under it. */}
          <div className="shrink-0 border-b border-white/[0.07] bg-linear-to-b from-white/[0.06] to-transparent px-4 pt-4 pb-3.5">
            <div className="flex items-center gap-3">
              <BrandMark src={logos[0]} name={brandName} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-base leading-tight font-bold tracking-tight text-white">
                  {brandName}
                </div>
                {site && <div className="mt-0.5 truncate text-xs text-[#15DCFF]/85">{site}</div>}
              </div>
            </div>
          </div>

          {/* Hairline-separated rows, spread down the column. The fields are a
              profile, so they read as one; `justify-between` lands the hairlines
              at even intervals so a brand with little to say does not finish
              two-thirds of the way down and leave a void under it. When the
              content IS taller than the panel the free space is negative and
              `space-between` degrades to packing from the start — the same
              layout, still scrolling, nothing pushed above the scroll origin. */}
          <div
            ref={fitRef}
            // `overflow-hidden`, not `auto`: the type shrinks to fit instead of
            // scrolling — see `useFitScale`. The clip is the last resort at the
            // floor, not the normal behaviour.
            className="flex min-h-0 flex-1 flex-col justify-between overflow-hidden px-4 pb-1.5"
            style={{ fontSize: `${fitSize}px` }}
          >
            <Field label="Industry" divided={false}>
              <Line>{industry}</Line>
            </Field>

            <Field label="What it is">
              <Line>{context.description}</Line>
            </Field>

            <Field label="Core idea">
              <Line bright>{context.core_idea}</Line>
            </Field>

            <Field label="Audience">
              <Chips items={context.target_audience} tone="cyan" max={5} />
            </Field>

            <Field label="Products">
              <Chips items={context.key_products} tone="indigo" max={6} />
            </Field>

            {(context.color_palette || []).length > 0 && (
              <Field label="Colours">
                <Palette colors={context.color_palette} />
              </Field>
            )}

            <ImageStrip urls={images} label="From your site" max={6} />
          </div>
        </aside>

        {/* ═══ what comes next ═══ */}
        <main className="relative flex min-w-0 flex-col overflow-hidden">
          {/* The reserved strip under the cards is a CONSTANT, not the dock's
              live height, and that is the whole reason dragging the dock up no
              longer squashes the storyboards.

              The cards are `flex-1 basis-0` of this section's CONTENT box, so
              anything that changes the padding changes their height too — tying
              the padding to `dockH` meant every pixel the dock grew was a pixel
              taken off the keyframes, which is exactly the behaviour the overlay
              exists to avoid. Pinned at the collapsed dock's height, the cards
              are sized once and the dock simply covers them on its way up. */}
          <section
            className="flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto px-[18px] pt-2.5"
            style={{ paddingBottom: DOCK_PAD }}
          >
            {/* Tighter than it was, on purpose. The heading names the section
                once; the concepts under it are what the screen is for, and the
                row is height-driven — every pixel the title gives back makes
                three keyframe strips taller. */}
            <div className="mb-2 flex shrink-0 items-baseline justify-between">
              <h1 className="text-[15px] leading-none font-bold tracking-tight text-white 2xl:text-base">
                Video ideas
              </h1>
            </div>

            {/* Three concepts is what the contract promises TODAY, and a row of
                three is what this section is proportioned for: `flex-1 basis-0`
                so the row divides the height available and the keyframes are as
                large as they can be.

                `minmax(280px, 1fr)` is what keeps that honest in every other
                case. A single row takes the `1fr` and fills the section, but the
                moment there is a second row — five concepts, or three at a width
                narrow enough to wrap to two columns — `1fr` alone would halve
                the height and hand back two rows of cards whose keyframes are
                too small to read. The floor wins instead and the section, which
                is already a scroller, scrolls. */}
            <div className="grid min-h-0 flex-1 basis-0 auto-rows-[minmax(280px,1fr)] grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
              {boards.length
                ? orderWithLeadInMiddle(boards).map((board, i) => (
                    <ConceptCard
                      key={board.id}
                      anchorId={i === 0 ? 'first-concept' : undefined}
                      board={board}
                      index={i + 1}
                      onGenerate={onGenerateVideo}
                      // The expand control on the inline player. Same handler:
                      // the board already has a clip, so it opens the screen
                      // rather than starting anything.
                      onOpen={() => onGenerateVideo?.(board)}
                      // Per concept, so a tile that is rendering says so while
                      // the others still offer the price.
                      videoState={videosByBoard[board.id]}
                      framesExhausted={framesExhausted}
                    />
                  ))
                : storyboardsFailed
                  ? <ConceptsUnavailable message={storyboards.error} />
                  : [0, 1, 2].map((i) => <ConceptSkeleton key={i} delay={i * 140} />)}
            </div>
          </section>

          <TemplateDock
            items={templateItems}
            pending={templatesPending}
            failed={templates.status === 'failed'}
            height={dockH}
            onResize={resizeDock}
            onLoadMore={onLoadMoreTemplates}
            canLoadMore={canLoadMoreTemplates}
          />
        </main>
      </div>
    </div>
  );
}
