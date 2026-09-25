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

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import AdsGPTLogo from '@/assets/layouts/adsgpt-logo.webp';
import creditIcon from '@/assets/layouts/profile/adcreative.svg';
import CustomVideoPlayer from '../AdStudio/AdVideo/AdVideoChats/CustomVideoPlayer';
import PostAdMySpaceModal from '../AdStudio/AdVideoNew/PostAdMySpace/PostAdMySpaceModal';
import useOnboardingEligibility from '@/hooks/useOnboardingEligibility';
import SplitChargeDialog from './SplitChargeDialog';
import FreeAdBanner from './FreeAdBanner';
import { FrameSettleLoader, FrameStatusLine, FRAME_LINES, useRotatingCopy } from './FrameLoader';
import RetryCountdownButton from './RetryCountdownButton';
import OnboardingTour from './OnboardingTour';
import RecreateModal from './RecreateModal';

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

// What one storyboard render costs, and therefore what the allowance has to
// cover for it to be free. Mirrors `renderBilling.ceilingAmount()` —
// `rateFor('veo-3.1-fast') * 8`. Duplicated here only because `/eligibility`
// answers with the budget, not with prices; if a third copy of this number ever
// appears, that is the signal to have the server send it.
const VIDEO_RENDER_COST = 32;
/* TEMPORARY (2026-09-24, Bharath): the credit badge is hidden on every
   Generate button. The cost itself is unchanged — billing, the split
   confirmation and the offer bar all still use `VIDEO_RENDER_COST` — this only
   stops the card putting a price in front of the user before they have decided
   anything. Set to `false` to bring the badges back.

   RecreateModal carries its own copy of this flag for its Recreate button.
   Two constants rather than a shared module, because the sheet is imported BY
   this file and importing back would be a cycle. Flip BOTH. */
const HIDE_RENDER_PRICE = true;

/* ── Don't start a video the user is only scrolling past ─────────────────────

   A tile that enters view and leaves again — which is every tile in a fast
   scroll — should never begin decoding. The viewport gate alone still kicked
   one off for each tile on the way past.

   NOT paired with pausing on scroll, which was tried and reverted (2026-09-25):
   it measured faster and FELT worse. Stopping and restarting twenty decoders
   around every gesture is itself a burst of work, and a wall of ads that
   freezes the moment you touch the wheel reads as the page struggling even
   when the frame rate says otherwise.                                          */
const PLAY_DWELL_MS = 200;

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
/**
 * @param generated  At least one clip is ready. Swaps the exit for "Go to
 *   dashboard" (which calls `onFinish` — the user got their clip, so this run is
 *   completed, not skipped). Until then "Skip for now" is the only exit.
 * @param hasRenders  At least one render exists — RUNNING or ready. Distinct
 *   from `generated`, which means one has finished: a render in flight is still
 *   something to go and look at, and the clip screen is where its progress is.
 * @param onViewAds  Opens the clip screen on the newest render. Passed only
 *   from the workspace: on the clip screen the user is already standing in it,
 *   and a button that goes where you are reads as broken.
 *
 *   It REPLACES "Go to dashboard" rather than sitting beside it. Once there is
 *   something to see, that is the thing worth offering here; leaving is still
 *   possible from "Skip for now" beside it, and from the clip screen itself.
 */
export function Header({
  onStartOver,
  onFinish,
  onSkip,
  generated = false,
  hasRenders = false,
  onViewAds,
}) {
  const exit = generated ? onFinish || onSkip : onSkip;
  const showViewAds = Boolean(hasRenders && onViewAds);
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
        {/* The quiet exit. Normally it gives way to "Go to dashboard" once a
            clip exists — but when "See your ads" has taken that button's place
            it stays, or the workspace would have no way out at all. */}
        {(!generated || showViewAds) && onSkip && (
          <button
            type="button"
            onClick={onSkip}
            className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-white/40 transition hover:text-white/75"
          >
            Skip for now
          </button>
        )}
        {showViewAds && (
          <button
            type="button"
            onClick={onViewAds}
            className="inline-flex items-center gap-2 rounded-lg bg-[linear-gradient(180deg,#9176ff_0%,#7c5cff_46%,#6148c7_100%)] px-3 py-1.5 text-xs font-bold whitespace-nowrap text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.4),inset_0_-1px_0_rgba(0,0,0,0.28)] transition hover:brightness-110 active:translate-y-px"
          >
            {/* Named for what is behind it, not for the screen it opens. "See
                your ads" is a thing the user made; "Go to clip view" is a thing
                the app has. */}
            See your ads
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M5 12h13M13 6l6 6-6 6" />
            </svg>
          </button>
        )}
        {generated && exit && !showViewAds && (
          <button
            type="button"
            onClick={exit}
            className="inline-flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs font-semibold whitespace-nowrap text-white/80 transition hover:border-[#15DCFF]/50 hover:text-white"
            style={{ background: SURF2, borderColor: LINE_STRONG }}
          >
            Go to dashboard
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
function ConceptCard({ board, index, onGenerate, onOpen, videoState, anchorId, tourAnchor = false, framesExhausted, showPrice }) {
  const frames = (board.images || [])
    .filter((img) => img.status === 'ready' && img.src)
    .slice(0, 2);

  // Watch plays the clip HERE, in the strip the two keyframes were in. The
  // storyboard is a promise of a video and the clip is that video; sending the
  // user to another screen to see whether the promise was kept breaks the one
  // comparison the card exists to support.
  const [watching, setWatching] = useState(false);
  // Set once the clip has been closed, so the keyframes animate back in on
  // return — but not on the card's first paint.
  const [returned, setReturned] = useState(false);

  // ── Full voiceover, in place ─────────────────────────────────────────────
  // User decision 2026-09-15: one line collapsed; "See more" grows the text to
  // its full length and the frames give up that room — smoothly. VoiceoverLine
  // animates its own max-height; the frames row is `flex-1 basis-0`, so it is
  // re-laid out on every frame of that animation and shrinks/grows with it.
  const [voiceExpanded, setVoiceExpanded] = useState(false);

  // Keyframes still being drawn: the slots show the settle loader with a
  // rotating status, and Generate is disabled — there is nothing to render yet
  // (design handoff 5b). `framesExhausted` is the other branch: the frames are
  // not coming, which `FramePlaceholder` states outright.
  const framesPending = frames.length === 0 && !framesExhausted;
  const frameLine = useRotatingCopy(FRAME_LINES, framesPending);

  const clip = videoState?.video?.video || null;
  const clipSrc = clip?.src || clip?.url || clip?.local_url || '';

  return (
    <article
      id={anchorId}
      // The card the onboarding tour points at — chosen by Workspace, not
      // simply the first one. See `tourBoard` there.
      data-tour={tourAnchor ? 'concept' : undefined}
      className="flex h-full min-h-0 w-full min-w-0 flex-col gap-2.5 rounded-2xl border p-3"
      style={{ background: SURF, borderColor: LINE }}
    >
      {/* `overflow-visible` so the transition badge can sit over both frames.
          `flex-1 basis-0`: takes whatever the footer leaves, so it follows the
          voiceover's height animation frame by frame. */}
      <div
        className={cn(
          'relative flex min-h-20 flex-1 basis-0 items-center justify-center overflow-visible',
          // Mirror of the clip's rise: the frames settle back in rather than
          // popping into place the instant the player unmounts.
          returned && !watching && 'animate-in fade-in zoom-in-95 duration-300 ease-out'
        )}
      >
        {watching && clipSrc ? (
          <InlineClip
            src={clipSrc}
            board={board}
            onClose={() => {
              setReturned(true);
              setWatching(false);
            }}
            onOpen={onOpen}
          />
        ) : frames.length ? (
          <>
            <Frame frames={frames} index={0} />
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
            {frames[1] && <Frame frames={frames} index={1} />}
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
            {/* One status for the pair: the UI cannot tell which frame is in
                flight, so the copy never names First or Last. */}
            {framesPending && <FrameStatusLine line={frameLine} />}
          </>
        )}
      </div>

      <div className="flex min-w-0 shrink-0 items-center gap-2">
        <span className="shrink-0 text-xs font-semibold text-white/50 tabular-nums">{index}</span>
        <h3 className="min-w-0 truncate text-sm font-semibold tracking-tight text-white 2xl:text-base">
          {board.title}
        </h3>
        {/* HIDE-MARK — "Pick" badge off (user decision 2026-09-15). Restore:
            {board.recommended && (
              <span className="shrink-0 rounded border border-[#15DCFF]/30 bg-[#15DCFF]/10 px-1.5 py-0.5 text-[10px] font-semibold tracking-wider text-[#15DCFF] uppercase">
                Pick
              </span>
            )} */}
      </div>

      <VoiceoverLine
        text={board.voiceover}
        expanded={voiceExpanded}
        onToggle={() => setVoiceExpanded((v) => !v)}
      />

      <ConceptAction
        board={board}
        state={videoState}
        onGenerate={onGenerate}
        onWatch={() => setWatching(true)}
        showPrice={showPrice}
        // Nothing to render until the keyframes exist.
        disabled={framesPending}
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
function InlineClip({ src, board, onClose, onOpen }) {
  // Posting from the card, not only from the clip screen. Same modal and same
  // payload shape ClipView sends, so there is still exactly one posting path.
  // The OAuth-return reopen stays in ClipView's SidePanel only: mounting that
  // effect on every card would open the modal once per card.
  const [postOpen, setPostOpen] = useState(false);
  // Close plays the rise in reverse before unmounting. Unmounting on click was
  // what made closing feel abrupt: opening animated, closing just vanished.
  const [leaving, setLeaving] = useState(false);
  const title = board?.title || '';
  const postPayload = {
    url: src,
    isVideo: true,
    prompt: board?.voiceover || board?.premise || title,
    item: { url: src, title, aiAds: { source: 'onboarding' } },
  };

  return (
    <div
      className={cn(
        'absolute inset-0',
        leaving
          ? 'pointer-events-none animate-[clipFall_220ms_cubic-bezier(0.4,0,1,1)_forwards]'
          : 'animate-[clipRise_320ms_cubic-bezier(0.16,1,0.3,1)]'
      )}
      // Only the exit animation hands control back; the rise ending must not.
      onAnimationEnd={(e) => {
        if (leaving && e.target === e.currentTarget) onClose();
      }}
    >
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
        <button
          type="button"
          onClick={() => setPostOpen(true)}
          title="Post to ad account"
          className="grid h-7 w-7 place-items-center rounded-full border text-white/80 backdrop-blur-md transition hover:text-white"
          style={{ background: 'rgba(10,10,13,0.72)', borderColor: LINE_STRONG }}
        >
          {/* lucide `megaphone`, inline — the icon ClipView's Post button uses. */}
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="m3 11 18-5v12L3 14v-3z" />
            <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
          </svg>
        </button>
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
          onClick={() => setLeaving(true)}
          title="Back to the storyboard"
          className="grid h-7 w-7 place-items-center rounded-full border text-white/80 backdrop-blur-md transition hover:text-white"
          style={{ background: 'rgba(10,10,13,0.72)', borderColor: LINE_STRONG }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      <PostAdMySpaceModal open={postOpen} onOpenChange={setPostOpen} payload={postPayload} />

      <style>{`
        @keyframes clipRise {
          from { opacity: 0; transform: scale(0.92) }
          to   { opacity: 1; transform: none }
        }
        @keyframes clipFall {
          from { opacity: 1; transform: none }
          to   { opacity: 0; transform: scale(0.94) }
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
function ConceptAction({ board, state, onGenerate, onWatch, onOpen, showPrice = false, disabled = false }) {
  const status = state?.status;
  const open = () => onGenerate?.(board);

  // Failed: Retry (unlimited) + View. User decision 2026-09-15 — retries are no
  // longer capped at one, and a failed render is never charged (the credit hold
  // is released / the free render returned server-side), so there is nothing to
  // protect by refusing another try. "View" opens the clip screen's failure
  // state WITHOUT starting a render; the old "Open board" button started one.
  if (status === 'failed') {
    return (
      <div className="flex shrink-0 items-center gap-2 self-end">
        <p className="text-[11.5px] leading-tight text-white/60">Didn&rsquo;t render.</p>
        {onOpen && (
          <button
            type="button"
            onClick={onOpen}
            className="text-[12px] font-semibold text-white/60 underline-offset-2 transition hover:text-white hover:underline"
          >
            View
          </button>
        )}
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
      // Disabled while the keyframes are still being drawn — same button, at
      // half strength, so the card does not change shape when they land.
      disabled={disabled}
      // A disabled Generate is not something the tour should teach.
      data-tour={disabled ? undefined : 'generate'}
      className={cn(
        'inline-flex shrink-0 items-center gap-2 self-end rounded-[7px] bg-[linear-gradient(180deg,#9176ff_0%,#7c5cff_46%,#6148c7_100%)] px-[11px] py-1.5 text-[12.5px] font-bold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.42),inset_0_-1px_0_rgba(0,0,0,0.28),0_1px_0_rgba(0,0,0,0.5),0_4px_10px_-4px_rgba(0,0,0,0.75)] transition',
        disabled
          ? 'cursor-not-allowed opacity-50'
          : 'hover:brightness-110 active:translate-y-px active:shadow-[inset_0_2px_4px_rgba(0,0,0,0.4)]'
      )}
    >
      <span className="shrink-0 whitespace-nowrap" style={{ textShadow: '0 1px 0 rgba(0,0,0,0.22)' }}>
        Generate
      </span>
      {/* The price, struck through, then what it actually costs. The icon was
          14px on a dark gradient and simply did not read; the struck number was
          smaller again. Both are up a size and the icon sits on its own lighter
          disc so it has an edge to be seen against. */}
      {/* Hidden for now — see `HIDE_RENDER_PRICE` at the top of this file. The
          whole badge goes, coin and "Free" pill included: a coin with nothing
          beside it reads as a broken price. */}
      <span hidden={HIDE_RENDER_PRICE} className="flex shrink-0 items-center gap-[6px]">
        {/* 20px, not 14. This is the same `adcreative.svg` the profile page
            uses — but it renders it at 28, and the artwork is a 1879px PNG with
            fine detail in it. At half that size the detail did not survive the
            downscale and the coin read as a smudge, which looked like a missing
            icon rather than a small one. No backing plate: the plate was there
            to rescue a size that was simply too small. */}
        <img src={creditIcon} alt="" className="h-5 w-5 shrink-0" />
        {/* Once the allowance can no longer cover a render, the price is the
            price — no strike, no "Free" pill promising something the backend
            will charge for. */}
        {showPrice ? (
          <span className="shrink-0 text-[13px] font-bold">{VIDEO_RENDER_COST}</span>
        ) : (
          <>
            <s className="shrink-0 text-[13px] font-semibold opacity-75">{VIDEO_RENDER_COST}</s>
            <span className="shrink-0 rounded-[5px] bg-black/30 px-[7px] py-[1px] text-[13px] font-bold">
              Free
            </span>
          </>
        )}
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
/**
 * @param seed  shifts the loader's pattern so the First and Last slots on a
 *   card never look identical.
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
        /* Design handoff (5b), 2026-09-16. `seed` differs per frame, so the
           first and last slots on a card never show the same pattern. */
        <FrameSettleLoader seed={seed} />
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
 * The script — one line, expanding in place with a smooth height animation.
 *
 * Collapsed it is one truncated row beside its icon, with "See more" only when
 * the text actually overflows (measured, re-measured on resize). Expanded, the
 * full text wraps and the box's `max-height` animates from one line to the
 * wrapped height (VOICE_ANIM_MS). The card's frames row is `flex-1 basis-0`, so
 * it is re-laid out on every frame and shrinks/grows smoothly with this box —
 * user decision 2026-09-15.
 *
 * Collapse runs the animation first and only then re-applies the ellipsis;
 * truncating immediately would snap the text to one line mid-animation.
 */
const VOICE_ANIM_MS = 300;

function VoiceoverLine({ text, expanded = false, onToggle }) {
  const boxRef = useRef(null);
  // Two invisible measuring copies at the box's width: `plainRef` is the bare
  // text (decides whether one line overflows), `fullRef` includes the inline
  // "See less" (the expanded target height, so the link is inside the animation
  // instead of popping in as an extra row afterwards).
  const plainRef = useRef(null);
  const fullRef = useRef(null);
  const lastWidth = useRef(-1);
  const [truncated, setTruncated] = useState(false);
  const [heights, setHeights] = useState({ line: 0, full: 0 });
  // True from the moment collapse starts until its animation ends: keeps the
  // text wrapped so the height can animate down before the ellipsis returns.
  const [collapsing, setCollapsing] = useState(false);
  const wasExpanded = useRef(expanded);

  useEffect(() => {
    if (wasExpanded.current && !expanded) {
      setCollapsing(true);
      const t = setTimeout(() => setCollapsing(false), VOICE_ANIM_MS);
      wasExpanded.current = expanded;
      return () => clearTimeout(t);
    }
    wasExpanded.current = expanded;
    return undefined;
  }, [expanded]);

  // One-line height, full wrapped height, and whether the one line overflows.
  // `fullRef` is an invisible wrapped copy at the same width, so the full
  // height is known before expanding (the animation needs a real target).
  useLayoutEffect(() => {
    const box = boxRef.current;
    const plain = plainRef.current;
    const full = fullRef.current;
    if (!box || !plain || !full) return undefined;
    lastWidth.current = -1;
    const measure = () => {
      // Only a WIDTH change can change these numbers. The box's height changes
      // on every frame of its own animation; re-measuring (and setting state)
      // then re-rendered the card mid-animation — the visible shiver.
      const width = box.clientWidth;
      if (width === lastWidth.current) return;
      lastWidth.current = width;
      const line = parseFloat(getComputedStyle(plain).lineHeight) || 19;
      const fullH = full.scrollHeight;
      const overflows = plain.scrollHeight > line + 1;
      setHeights((h) => (h.line === line && h.full === fullH ? h : { line, full: fullH }));
      setTruncated((t) => (t === overflows ? t : overflows));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    measure();
    return () => observer.disconnect();
  }, [text]);

  if (!text) return <div className="h-[19px] shrink-0" />;

  // `wasExpanded.current` covers the FIRST render after "See less": `collapsing`
  // is only set in an effect, so without it that one frame rendered the text
  // truncated, then wrapped again — the fast shiver before the smooth collapse.
  const wrapped = expanded || collapsing || wasExpanded.current;
  const maxHeight = expanded ? heights.full || undefined : heights.line || undefined;

  // Inline at the end of the text, so it is part of the animated height.
  const seeLess = onToggle ? (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded
      className="ml-1.5 font-semibold whitespace-nowrap text-[#15DCFF]/85 transition hover:text-[#15DCFF]"
    >
      See less
    </button>
  ) : null;

  return (
    <div className="flex min-w-0 shrink-0 flex-col">
      <div className="flex min-w-0 items-start gap-[7px]">
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          className="mt-[2px] shrink-0 text-white/50"
          aria-hidden
        >
          <path d="M3 14v-2a9 9 0 0 1 18 0v2" />
          <rect x="2" y="14" width="4" height="7" rx="2" fill="currentColor" stroke="none" />
          <rect x="18" y="14" width="4" height="7" rx="2" fill="currentColor" stroke="none" />
          <path d="M9 11v6M12 9v10M15 11v6" />
        </svg>

        <div
          ref={boxRef}
          className="relative min-w-0 flex-1 overflow-hidden text-xs leading-relaxed text-[#b6bcc3] 2xl:text-sm"
          style={{
            maxHeight,
            transition: `max-height ${VOICE_ANIM_MS}ms cubic-bezier(.4,0,.2,1)`,
          }}
        >
          <p className={wrapped ? '' : 'truncate'}>
            {text}
            {/* Kept through the collapse animation: removing it at the first
                frame dropped a line instantly before the height animated. */}
            {wrapped && seeLess}
          </p>
          {/* Measuring copies: always wrapped, never visible, same width. */}
          <p
            ref={plainRef}
            aria-hidden
            className="pointer-events-none invisible absolute inset-x-0 top-0"
          >
            {text}
          </p>
          <p
            ref={fullRef}
            aria-hidden
            className="pointer-events-none invisible absolute inset-x-0 top-0"
          >
            {text}
            {onToggle && (
              <span className="ml-1.5 font-semibold whitespace-nowrap">See less</span>
            )}
          </p>
        </div>

        {!expanded && truncated && onToggle && (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={false}
            className="shrink-0 text-xs font-semibold whitespace-nowrap text-[#15DCFF]/85 transition hover:text-[#15DCFF] 2xl:text-sm"
          >
            See more
          </button>
        )}
      </div>

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
const FRAME_LABELS = ['First frame', 'Last frame'];
const FRAME_BADGES = ['First', 'Last'];

/**
 * @param frames  BOTH keyframes of this concept. The tile renders its own
 *   (`frames[index]`), but the full-size view steps between them: from First a
 *   right-hand arrow goes to Last, and from Last a left-hand one comes back —
 *   user request 2026-09-16. Arrow keys do the same.
 */
function Frame({ frames, index }) {
  const img = frames[index];
  const [open, setOpen] = useState(false);
  // Which frame the lightbox is showing; always re-seeded from the tile that
  // was clicked, so opening Last never starts on First.
  const [viewIndex, setViewIndex] = useState(index);
  const viewed = frames[viewIndex] || img;
  const canStep = frames.length > 1;

  const openAt = () => {
    setViewIndex(index);
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
      if (!canStep) return;
      if (e.key === 'ArrowRight') setViewIndex(1);
      if (e.key === 'ArrowLeft') setViewIndex(0);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, canStep]);

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
        onClick={openAt}
        className="block h-full w-full cursor-zoom-in"
        aria-label={`Open ${FRAME_LABELS[index]} full size`}
      >
        <img
          src={img.src}
          alt={FRAME_LABELS[index]}
          loading="lazy"
          className="h-full w-full object-cover"
        />
      </button>

      <FrameBadge>{FRAME_BADGES[index]}</FrameBadge>

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
                // Keyed so stepping between the two actually swaps the picture
                // rather than leaving the old one until the new file decodes.
                key={viewed.src}
                src={viewed.src}
                alt={FRAME_LABELS[viewIndex]}
                className="max-h-[88vh] max-w-[88vw] rounded-xl border border-white/15 object-contain shadow-[0_40px_120px_-20px_rgba(0,0,0,0.95)]"
              />
              <figcaption className="absolute right-3 bottom-3 rounded bg-black/65 px-2 py-1 text-[10px] tracking-[0.08em] text-white/70 uppercase backdrop-blur-sm">
                {FRAME_LABELS[viewIndex]}
              </figcaption>
              <CloseButton onClick={() => setOpen(false)} />
            </figure>

            {/* One arrow at a time, on the side you are travelling towards:
                right while the First frame is up, left while the Last is. At
                the screen's edge rather than on the picture, so it never covers
                the frame you came to look at. */}
            {canStep && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setViewIndex(viewIndex === 0 ? 1 : 0);
                }}
                aria-label={viewIndex === 0 ? 'Show the last frame' : 'Show the first frame'}
                className={cn(
                  'absolute top-1/2 z-[2] grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full border text-white/80 backdrop-blur-md transition hover:border-[#15DCFF]/50 hover:text-white',
                  viewIndex === 0 ? 'right-6' : 'left-6'
                )}
                style={{ background: 'rgba(14,14,17,0.9)', borderColor: LINE_STRONG }}
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  {viewIndex === 0 ? <path d="M5 12h13M13 6l6 6-6 6" /> : <path d="M19 12H6M11 18l-6-6 6-6" />}
                </svg>
              </button>
            )}
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

/**
 * The concept card before ANY of it exists — design handoff option `5b`.
 *
 * This is the state the handoff was drawn for: the frames are being generated
 * and the title and voiceover have not arrived either, so the footer is two
 * shimmering bars and Generate is present but disabled. Card chrome, badges and
 * the transition node are the live component's, so nothing moves when the real
 * card replaces this one.
 */
function ConceptSkeleton({ delay = 0, index = 1 }) {
  // One rotating status for the pair — the UI cannot know which frame is being
  // drawn, so the copy never names First or Last.
  const line = useRotatingCopy(FRAME_LINES);
  // A sweeping highlight over each bar; the second offset so they do not move
  // in lockstep. `fl-sweep` comes from the loader's own keyframes, which are
  // mounted by the frame slots above.
  const bar = (widthClass, heightClass, tint, sweepDelay) => (
    <div className={cn('relative shrink-0 overflow-hidden rounded-[3px]', widthClass, heightClass)} style={{ background: tint }}>
      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(to right, rgba(255,255,255,0) 0%, rgba(255,255,255,0.14) 50%, rgba(255,255,255,0) 100%)',
          animation: `fl-sweep 2.2s ease-in-out ${sweepDelay} infinite`,
        }}
      />
    </div>
  );

  return (
    <article
      className="flex h-full min-h-0 w-full min-w-0 flex-col gap-2.5 rounded-2xl border p-3"
      style={{ background: SURF, borderColor: LINE }}
    >
      {/* Same strip as the real card: two slots, an 8px channel, the node over
          it. `flex-1`, not an aspect lock, so the layout does not jump when the
          real frames arrive. */}
      <div className="relative flex min-h-20 flex-1 basis-0 items-center justify-center overflow-visible">
        <div
          className="relative h-full min-w-0 flex-1 overflow-hidden rounded-lg border bg-white/[0.03]"
          style={{ borderColor: LINE }}
        >
          <FrameSettleLoader seed={Math.round(delay / 140) * 2} />
          <FrameBadge>First</FrameBadge>
        </div>

        <div className="z-[3] w-2 shrink-0">
          <span
            aria-hidden
            className="absolute top-1/2 left-1/2 grid h-11 w-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border text-white shadow-[0_4px_14px_rgba(0,0,0,0.7)]"
            style={{ background: 'rgba(14,14,17,0.9)', borderColor: LINE_STRONG }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h13M13 6l6 6-6 6" />
            </svg>
          </span>
        </div>

        <div
          className="relative h-full min-w-0 flex-1 overflow-hidden rounded-lg border bg-white/[0.03]"
          style={{ borderColor: LINE }}
        >
          <FrameSettleLoader seed={Math.round(delay / 140) * 2 + 1} />
          <FrameBadge>Last</FrameBadge>
        </div>

        <FrameStatusLine line={line} />
      </div>

      {/* The footer the title and voiceover will fill. */}
      <div className="flex shrink-0 items-center gap-2">
        <span className="text-xs font-semibold text-white/50 tabular-nums">{index}</span>
        {bar('w-[58%]', 'h-[11px]', 'rgba(255,255,255,0.09)', '0s')}
      </div>
      {bar('w-[78%]', 'h-[9px]', 'rgba(255,255,255,0.07)', '.5s')}

      {/* The real Generate button, disabled: there is nothing to render yet. */}
      <button
        type="button"
        disabled
        aria-hidden
        className="inline-flex shrink-0 cursor-not-allowed items-center gap-2 self-end rounded-[7px] bg-[linear-gradient(180deg,#9176ff_0%,#7c5cff_46%,#6148c7_100%)] px-[11px] py-1.5 text-[12.5px] font-bold text-white opacity-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.42),inset_0_-1px_0_rgba(0,0,0,0.28),0_1px_0_rgba(0,0,0,0.5)]"
      >
        <span className="shrink-0 whitespace-nowrap" style={{ textShadow: '0 1px 0 rgba(0,0,0,0.22)' }}>
          Generate
        </span>
        {/* Hidden with the real one, or the placeholder would promise a badge
            the finished card does not have. */}
        <span hidden={HIDE_RENDER_PRICE} className="flex shrink-0 items-center gap-[6px]">
          <img src={creditIcon} alt="" className="h-5 w-5 shrink-0" />
          <span className="shrink-0 text-[13px] font-bold">{VIDEO_RENDER_COST}</span>
        </span>
      </button>
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
  // Image creatives carry their pixel size as `resolution`.
  const res = template.resolution;
  if (res && Number(res.width) > 0 && Number(res.height) > 0) return res.width / res.height;
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
  // Image creatives share the rail but never play.
  if (template.media_type === 'image') return [];
  const direct = String(template.source_url || '').split('?')[0];
  // `video_url` is the contract's durable playback link (retrieval service's
  // own storage) and outranks the older cached/provenance fallbacks.
  return [
    template.video_url,
    template.preview_url,
    VIDEO_FILE.test(direct) ? template.source_url : null,
  ].filter(Boolean);
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
function TemplateTile({ template: t, expanded, slot = 0, onRecreate, paused = false }) {
  const video = useRef(null);
  const [hover, setHover] = useState(false);
  const [playing, setPlaying] = useState(false);
  // The playhead bar is written straight to the DOM. It used to be state, and
  // `timeupdate` fires ~4x a second PER PLAYING TILE — twenty autoplaying tiles
  // meant ~80 React renders a second doing nothing but moving a 2px bar, which
  // is most of what made the rail feel heavy.
  const bar = useRef(null);
  // The tile's root, and whether it is actually on screen. See `useEffect`
  // below: a tile that nobody can see does not get to run a decoder.
  const root = useRef(null);
  const [inView, setInView] = useState(false);
  // Which of the tile's candidate sources is in play. Advanced by `onError`,
  // never reset, so a dead source is tried once and then left behind.
  const [srcIndex, setSrcIndex] = useState(0);
  // Same idea for the YouTube poster: `maxresdefault` first, `mqdefault` after.
  const [thumbIndex, setThumbIndex] = useState(0);
  // Starts at whatever the payload claims (nothing, today) and is corrected the
  // moment the file's own metadata lands.
  const [aspect, setAspect] = useState(() => aspectOf(t));

  // Video matches and image creatives arrive in ONE list, told apart by
  // `media_type` (set by Node from which upstream event carried the item).
  const isImage = t.media_type === 'image';
  const [imageFailed, setImageFailed] = useState(false);
  const name = isImage
    ? t.headline?.split('||')[0] || t.subcategory || 'Image ad'
    : t.content_type || t.video_kind_label || 'Reference ad';

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
    ...(isImage ? t.tags || [t.subcategory, t.network].filter(Boolean) : t.tone || []).map(
      (tone) => ({ label: tone })
    ),
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
    // Belt and braces: if autoplay was refused (some browsers hold it until the
    // page has been interacted with), a hover is that interaction. Kept as a
    // DIRECT call rather than routed through `applyPlayback`, because a
    // `setTimeout` breaks the user-gesture chain that this exists to borrow —
    // and a hover is a deliberate stop on one tile, not a scroll past it.
    if (!paused && inView) {
      video.current?.play().catch(() => {});
    }
  };
  // Video tiles keep playing on leave — they autoplay, muted and looping, from
  // the moment they load, so the rail reads as a wall of moving ads rather than
  // stills that only come alive under the pointer. Only the YouTube embed is
  // still hover-only: it is a third-party player per tile (see `showingVideo`).
  const onLeave = () => setHover(false);

  // ── Who is allowed to play ────────────────────────────────────────────────
  // Only tiles on screen. The rail is a wall of autoplaying ads by design, but
  // "the wall" is twenty-odd files and the window shows six of them: the rest
  // were decoding full-size video into a scroll region nobody was looking at.
  //
  // 300px of margin means a tile is already running by the time it is scrolled
  // to, so the wall still reads as alive rather than as tiles that wake up when
  // you arrive. Clipping counts here — a tile scrolled out of the collapsed
  // strip is out of view even though the strip itself is on screen.
  useEffect(() => {
    const el = root.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return undefined;
    }
    const io = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { rootMargin: '300px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // ── One decision, two inputs ────────────────────────────────────────────
  //
  // `paused` is the same rule from outside: the workspace sets it on the whole
  // dock while the recreate sheet is open, because those tiles are behind an
  // opaque sheet and were decoding every frame of themselves into nothing.
  // `inView` is the viewport gate.
  //
  // Pausing is IMMEDIATE and starting is DELAYED: a tile being scrolled past
  // should never have started. The dwell is cancelled on every re-decision, so
  // a tile that leaves view mid-dwell simply never plays.
  const dwell = useRef(null);

  const applyPlayback = useCallback(() => {
    const el = video.current;
    clearTimeout(dwell.current);
    if (!el) return;
    if (paused || !inView) {
      el.pause();
      return;
    }
    dwell.current = setTimeout(() => {
      // Re-read the ref: `video.current` can be gone by now.
      video.current?.play().catch(() => {});
    }, PLAY_DWELL_MS);
  }, [paused, inView]);

  useEffect(() => {
    applyPlayback();
    return () => clearTimeout(dwell.current);
  }, [applyPlayback]);

  return (
    // A div, not a link. The tile used to open the reference ad in a new tab,
    // which is the wrong thing to happen when the reference ad is already
    // playing inside it — and a click has a better job waiting for it (choosing
    // the template), so it does nothing at all rather than doing the old thing.
    <div
      ref={root}
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
      {isImage && t.image_url && !imageFailed ? (
        <img
          key={t.image_url}
          src={t.image_url}
          alt={name}
          loading="lazy"
          onError={() => setImageFailed(true)}
          onLoad={(e) => {
            const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
            if (!declaredAspect(t) && w > 0 && h > 0) setAspect(w / h);
          }}
          className="h-full w-full object-cover"
        />
      ) : src ? (
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
          // No `autoPlay` attribute: the effect above starts it, and only when
          // the tile is on screen. Offscreen tiles fetch metadata (enough for a
          // first frame and the real aspect) and nothing more.
          preload={inView ? 'auto' : 'metadata'}
          // Covers the cases the effect alone does not — a source swapped in
          // after a failure, or a tab that was hidden while the file loaded.
          // Routed through the same decision rather than calling `play()`
          // directly: a file that finishes loading mid-scroll would otherwise
          // start decoding immediately, which is the one thing the scroll gate
          // exists to prevent.
          onCanPlay={applyPlayback}
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
            if (el.duration && bar.current) {
              bar.current.style.width = `${(el.currentTime / el.duration) * 100}%`;
            }
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
                  // The tint is translucent, so on a white or green thumbnail it
                  // vanished into the picture. A near-opaque dark base under the
                  // tint keeps every chip legible on any frame.
                  style={{
                    color,
                    background: `linear-gradient(${bg}, ${bg}), rgba(10,10,13,0.82)`,
                    border: `1px solid ${border}`,
                  }}
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

          Opens the recreate sheet (`RecreateModal`). The sheet itself is still a
          mock — there is no generation endpoint in any contract we hold — but
          the shape of the ask is decided, so the button is no longer inert. */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onRecreate?.(t);
        }}
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
          <div ref={bar} className="h-full bg-[#7c5cff]" style={{ width: '0%' }} />
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
// (LoadingTile removed 2026-09-15 — replaced by the bottom-centre spinner in
// TemplateDock; see the comment there.)

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
function TemplateDock({ items, pending, failed, height, ceiling, onResize, onLoadMore, canLoadMore, onRecreate, paused }) {
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

  // `busy` = a load-more request is in flight: set when it is sent, cleared when
  // the page lands (items grow), when the server declines it (`false`), on error,
  // or when there is nothing more to load. The spinner shows only while busy.
  const loadMore = useCallback(async () => {
    setBusy(true);
    try {
      const accepted = await onLoadMore?.();
      if (accepted === false) setBusy(false);
    } catch {
      setBusy(false);
    }
  }, [onLoadMore]);
  useEffect(() => {
    if (!canLoadMore) setBusy(false);
  }, [canLoadMore]);

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
    // Vertical in both modes now that the grid is the same one either way.
    // Collapsed, the grid already overflows the short band, so this is false
    // and the dock stops topping up until it is opened — instead of pulling
    // every page for a row the user cannot scroll.
    const nearEnd = el.scrollTop >= el.scrollHeight - el.clientHeight - THRESHOLD;

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

  // The handle and the button own the height outright: stop any wheel glide
  // still running, or the two would pull against each other.
  const stopGlide = () => {
    cancelAnimationFrame(frame.current);
    frame.current = 0;
  };

  const startDrag = (e) => {
    e.preventDefault();
    stopGlide();
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

  // Expand goes to the ceiling — the same height dragging stops at. The parent's
  // `resizeDock` clamps, so asking for "as tall as possible" lands exactly there.
  // The button (and double-click) animates the dock's height; dragging does
  // not, or the dock would lag behind the pointer.
  const [animating, setAnimating] = useState(false);
  const animTimer = useRef(0);
  useEffect(() => () => clearTimeout(animTimer.current), []);
  const toggle = () => {
    stopGlide();
    setAnimating(true);
    clearTimeout(animTimer.current);
    animTimer.current = setTimeout(() => setAnimating(false), DOCK_ANIM_MS + 50);
    onResize(expanded ? DOCK_MIN_H : Number.MAX_SAFE_INTEGER);
  };

  // ── Wheel: grow the dock first, then scroll it ────────────────────────────
  // Dragging the handle was the only way to open the dock, which is tedious.
  // Now a wheel over the templates band spends its scroll on the dock's HEIGHT
  // until the ceiling, and only then on the grid's own scroll — and scrolling
  // back up past the top of the grid closes it again. `passive: false` because
  // the page behind must not scroll while the dock is eating the gesture.
  // A wheel is a burst of coarse steps (a mouse notch is ~100px, and some
  // report whole lines), so applying deltas straight to the height stutters.
  // Each wheel moves a TARGET instead, and a rAF loop eases the real height
  // towards it — one smooth glide per gesture, and no animation in flight
  // fighting the pointer the way a CSS transition would.
  const section = useRef(null);
  const heightRef = useRef(height);
  heightRef.current = height;
  const targetH = useRef(height);
  const frame = useRef(0);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  useEffect(() => {
    const el = section.current;
    if (!el) return undefined;

    const step = () => {
      const from = heightRef.current;
      const to = targetH.current;
      const diff = to - from;
      if (Math.abs(diff) < 0.5) {
        frame.current = 0;
        onResize(to);
        return;
      }
      onResize(from + diff * 0.22);
      frame.current = requestAnimationFrame(step);
    };

    const onWheel = (e) => {
      if (e.ctrlKey) return; // pinch-zoom
      // deltaMode 1 = lines, 2 = pages.
      const delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? box.height || 400 : 1);
      // Idle: the target is wherever the dock actually is. Mid-glide: keep
      // adding to it, so a fast flick travels further than a single notch.
      const base = frame.current ? targetH.current : heightRef.current;
      const down = delta > 0;
      const canGrow = down && base < ceiling - 1;
      const canShrink = !down && base > DOCK_MIN_H && (strip.current?.scrollTop ?? 0) <= 0;
      if (!canGrow && !canShrink) return; // the grid scrolls normally
      targetH.current = Math.min(Math.max(base + delta, DOCK_MIN_H), ceiling);
      e.preventDefault();
      if (!frame.current) frame.current = requestAnimationFrame(step);
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [ceiling, onResize, box.height]);

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
  // 330 (was 390): expanded tiles 15% smaller, per user decision 2026-09-15.
  const columnCount = Math.max(2, Math.min(6, Math.round((box.width || 1100) / 330)));

  // The slot each tile has to fill. Expanded that is the column's width and the
  // tile takes all of it; collapsed it is the strip's HEIGHT, and the tile's own
  // aspect ratio decides how much width that buys — which is why the tile works
  // this out for itself rather than being handed a width. Assuming one ratio for
  // everything here was putting two chips on portrait tiles far too narrow to
  // hold them, and they wrapped into a second row.
  // Collapsed now uses the SAME column width as expanded (user decision
  // 2026-09-17, Higgsfield-style): tiles keep their full size and the strip
  // crops them at the bottom edge, instead of shrinking each tile to fit the
  // strip's height — which read as cramped.
  const slot = Math.round((box.width || 1100) / columnCount);

  // ── Tile layout: one flat, keyed list, absolutely positioned ──────────────
  // Expanded and collapsed used to render different parents (columns vs a
  // row), so crossing DOCK_EXPANDED_AT remounted every tile and each <video>
  // reloaded — a black flash on resize. Now every tile stays mounted under the
  // same parent and only its transform changes, which also lets the switch
  // animate. Order is preserved: expanded packs in list order, each tile into
  // the currently shortest column (same rule as before); collapsed is a row.
  const GAP_PX = 6;
  const innerW = Math.max(0, (box.width || 1100) - 36); // strip's px-[18px]
  const tileW = Math.max(1, Math.floor((innerW - GAP_PX * (columnCount - 1)) / columnCount));

  // Real rendered heights, fed by a ResizeObserver on each wrapper. Before a
  // tile has been measured its height is estimated from the payload's aspect.
  const [heights, setHeights] = useState({});
  const tileObserver = useRef(null);
  useEffect(() => {
    const ro = new ResizeObserver((entries) => {
      setHeights((prev) => {
        let next = prev;
        entries.forEach((entry) => {
          const id = entry.target.dataset.tileId;
          const h = Math.round(entry.target.offsetHeight);
          if (id && h > 0 && prev[id] !== h) {
            if (next === prev) next = { ...prev };
            next[id] = h;
          }
        });
        return next;
      });
    });
    tileObserver.current = ro;
    return () => ro.disconnect();
  }, []);
  const observeTile = useCallback((el) => {
    if (el) tileObserver.current?.observe(el);
  }, []);

  // ONE layout for both heights. The grid always spans the full width in
  // `columnCount` equal columns, so it fills the band edge to edge and never
  // leaves a half-cut tile hanging off the right (which is what the collapsed
  // single row did once its horizontal scroll was taken away). Collapsed is
  // simply the same grid cropped by the dock's height; dragging or expanding
  // reveals more of it without moving a single tile.
  const layout = useMemo(() => {
    const pos = {};
    const heightOf = (t) => heights[t.template_id] ?? Math.round(tileW / aspectOf(t));
    const cols = Array.from({ length: columnCount }, () => 0);
    items.forEach((t) => {
      let c = 0;
      for (let i = 1; i < cols.length; i += 1) if (cols[i] < cols[c]) c = i;
      pos[t.template_id] = { x: c * (tileW + GAP_PX), y: cols[c] };
      cols[c] += heightOf(t) + GAP_PX;
    });
    return { pos, width: innerW, height: Math.max(0, Math.max(...cols) - GAP_PX) };
  }, [items, columnCount, tileW, innerW, heights]);

  // HIDE-MARK — horizontal scroll on the collapsed strip (hidden 2026-09-17).
  // The idea: collapsed, the dock is a single row of tiles the user scrolls
  // sideways through — edge fades + left/right arrow buttons show there is
  // more, and nearing the right end triggers load-more (see maybeLoadMore).
  // Now the collapsed strip is a static preview: it clips at the edge and
  // "Expand all" is the way to browse. Set to true to bring the scroll back.
  const SHOW_HORIZONTAL_SCROLL = false;
  const scrollable = SHOW_HORIZONTAL_SCROLL && !expanded && items.length > 0;

  return (
    <section
      ref={section}
      data-tour="templates"
      className="absolute inset-x-0 bottom-0 z-[5] flex min-h-0 flex-col border-t shadow-[0_-20px_46px_rgba(0,0,0,0.5)]"
      style={{
        height,
        background: SURF,
        borderColor: LINE,
        transition: animating ? `height ${DOCK_ANIM_MS}ms cubic-bezier(.4,0,.2,1)` : 'none',
      }}
    >
      {/* The resize handle. No `title`: the native tooltip appeared late, over
          the wrong spot, in OS styling. The handle explains itself instead —
          on hover the strip tints, and the grip widens and turns brand cyan,
          with the ns-resize cursor saying which way it moves. */}
      <div
        onMouseDown={startDrag}
        onDoubleClick={toggle}
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize templates panel"
        className="group/handle grid h-3.5 shrink-0 cursor-ns-resize place-items-center bg-[#101317] transition-colors duration-200 hover:bg-[#15DCFF]/[0.06]"
      >
        <span className="h-[3px] w-11 rounded-[2px] bg-[#3a4149] transition-all duration-200 group-hover/handle:w-16 group-hover/handle:bg-[#15DCFF] group-hover/handle:shadow-[0_0_10px_rgba(21,220,255,0.55)]" />
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
            className="pointer-events-none absolute top-0 bottom-0 left-0 z-[2] w-9"
            style={{ background: `linear-gradient(to right, ${SURF}, rgba(27,27,33,0))` }}
          />
        )}
        {scrollable && !atEnd && (
          <div
            className="pointer-events-none absolute top-0 right-0 bottom-0 z-[2] w-[46px]"
            style={{ background: `linear-gradient(to left, ${SURF}, rgba(27,27,33,0))` }}
          />
        )}
        {scrollable && !atStart && <ScrollButton side="left" onClick={() => scrollBy(-1)} />}
        {scrollable && !atEnd && <ScrollButton side="right" onClick={() => scrollBy(1)} />}

        <div
          ref={strip}
          onScroll={onScroll}
          className={cn(
            'no-scrollbar min-h-0 min-w-0 flex-1 overflow-x-hidden px-[18px] pt-0.5',
            // Same grid either way: expanded scrolls through it, collapsed
            // crops it at the dock's edge (no bottom padding — the cut IS the
            // look). HIDE-MARK — horizontal scroll: this used to be a
            // sideways-scrolling row when collapsed.
            expanded ? 'overflow-y-auto pb-3.5' : 'overflow-y-hidden pb-0'
          )}
        >
          {items.length ? (
            <>
              {/* ONE tree for both modes — see the layout note above. */}
              <div className="relative" style={{ width: layout.width, height: layout.height }}>
                {/* Not before the strip is measured: positions from the 1100px
                    fallback would jump once the real width arrives. */}
                {box.width > 0 && items.map((t) => {
                  const p = layout.pos[t.template_id] || { x: 0, y: 0 };
                  return (
                    <div
                      key={t.template_id}
                      ref={observeTile}
                      data-tile-id={t.template_id}
                      className="absolute top-0 left-0"
                      style={{
                        width: tileW,
                        transform: `translate3d(${p.x}px, ${p.y}px, 0)`,
                        // No transform transition: tiles do not move between
                        // the two heights any more, and animating the reflow
                        // that follows a load or a window resize is what made
                        // them slide in from the side.
                        transition: 'none',
                      }}
                    >
                      <TemplateTile template={t} expanded slot={tileW} onRecreate={onRecreate} paused={paused} />
                    </div>
                  );
                })}
              </div>
              {/* Load-more spinner, IN the scroll content: below the grid when
                  expanded, at the end of the row when collapsed. */}
              {busy && canLoadMore && (
                <div
                  role="status"
                  aria-label="Loading more templates"
                  className={expanded ? 'flex basis-full justify-center py-3' : 'grid h-full shrink-0 place-items-center px-4'}
                >
                  <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/15 border-t-[#38E1FF]" />
                </div>
              )}
            </>
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
// Duration of the dock's height animation (Expand/Collapse) and of tiles
// gliding between the row and the masonry.
const DOCK_ANIM_MS = 320;
// What the storyboards reserve for the dock: its collapsed height plus the drag
// handle. Fixed on purpose — see the note on the section that uses it.
const DOCK_PAD = DOCK_MIN_H + 14;
// How much of the storyboard area stays visible above a fully raised dock:
// just the "Video ideas" heading — the dock covers the cards (user correction
// 2026-09-15; 112px left a strip of cards showing, which matched the old
// height). Measured from `main`, not the window, so it holds regardless of the
// offer bar or header above.
const DOCK_PEEK_PX = 40;

// Brand panel widths and the localStorage key for its collapsed state.
const BRAND_PANEL_W = 296;
const BRAND_RAIL_W = 56;
const BRAND_PANEL_KEY = 'adsgpt.onboarding.brandPanelCollapsed';


export default function Workspace({
  result = {},
  session = {},
  onStartOver,
  // Leave without finishing. The free render stays unspent, so the offer bar
  // keeps this session reachable — see OnBoardHome's `skipOnboarding`.
  onSkip,
  // Leave having got a clip — shown as "Go to dashboard" once one is ready.
  onFinish,
  // Per-concept action. Not wired to a backend yet — `video.generate` exists in
  // the webhook contract but has no Node route — so the button is inert until a
  // handler is passed rather than pretending to start a render.
  onGenerateVideo,
  // Opens a concept's clip view and nothing else — never starts a render.
  onOpenVideo,
  // Opens the clip screen on the NEWEST render, from the header. Only shown
  // once something has actually been made — see `Header`.
  onViewAds,
  // `{ [boardId]: { status, … } }` — one entry per concept a render was started
  // for. Not part of `session`, because it is live client state: the section
  // read tells you what the SERVER has, and this also holds the click that has
  // not been answered yet.
  videosByBoard = {},
  // Asks for the next page of templates. Absent in the preview harness, which
  // has no session to page against — the control hides rather than failing.
  onLoadMoreTemplates,
  // A recreate was accepted: `{ jobId, boardId, template }`. The host takes the
  // user to the clip screen, exactly as it does for a storyboard render.
  onRecreateStarted,
}) {
  // The two rails come off the SESSION, not the brand result. `result` is the
  // brand context alone — templates and storyboards live in their own sections
  // and are invisible to anything reading only the context.
  const storyboards = session.storyboards || {};
  const templates = session.templates || {};
  const allBoards = storyboards.result?.storyboards || [];
  // Sticky: the last list that actually had templates in it. A session resume
  // kicks a template refresh, and while that runs the rail reads back `running`
  // with no `result` yet — which emptied the dock for a split second and then
  // filled it again. Holding the previous list until a new non-empty one lands
  // means the refresh is invisible: tiles stay put (and keep playing) and are
  // swapped only when there is something to swap in.
  //
  // Merged by `template_id`, not replaced: a refresh returns its own list, and
  // swapping the array wholesale remounted every tile it had in common with the
  // old one — each <video> reloading to black, which is the blink. Tiles
  // already on screen keep their identity and their position; only genuinely
  // new templates are appended.
  const liveTemplateItems = templates.result?.templates || [];
  const lastTemplateItems = useRef(liveTemplateItems);
  if (liveTemplateItems.length) {
    const prev = lastTemplateItems.current;
    const live = new Map(liveTemplateItems.map((t) => [t.template_id, t]));
    const kept = prev.filter((t) => live.has(t.template_id)).map((t) => live.get(t.template_id));
    const keptIds = new Set(kept.map((t) => t.template_id));
    const added = liveTemplateItems.filter((t) => !keptIds.has(t.template_id));
    const merged = [...kept, ...added];
    // Same ids in the same order: keep the old array so nothing downstream
    // sees a "new" list and re-runs on it.
    const unchanged =
      merged.length === prev.length &&
      merged.every((t, i) => t.template_id === prev[i]?.template_id);
    lastTemplateItems.current = unchanged ? prev : merged;
  }
  // Never falls back to empty once tiles have been shown. A refresh's `done`
  // arrives as `succeeded` with the result not folded in yet, so keying the
  // empty state off the status flashed "no templates" for a frame. The empty
  // state is for a session that has never had any — which is exactly a sticky
  // list that is still empty.
  const templateItems = lastTemplateItems.current;

  // Owned here because the storyboards behind the dock pad themselves with it.
  const [dockH, setDockH] = useState(DOCK_MIN_H);
  // The dock's top limit — the same for dragging and for "Expand all": main's
  // height minus the strip of storyboards that must stay in view.
  const mainRef = useRef(null);
  const dockCeiling = useCallback(() => {
    const mainH = mainRef.current?.clientHeight || window.innerHeight - 160;
    return Math.max(DOCK_MIN_H, mainH - DOCK_PEEK_PX);
  }, []);
  const resizeDock = useCallback(
    (next) => setDockH(Math.min(Math.max(next, DOCK_MIN_H), dockCeiling())),
    [dockCeiling]
  );
  // A window that shrinks can leave the dock taller than its own ceiling.
  useEffect(() => {
    const onResize = () => setDockH((h) => Math.min(h, dockCeiling()));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [dockCeiling]);

  const templatesPending = ['queued', 'running'].includes(templates.status);

  // The template whose Recreate was pressed, or null. Owned here rather than in
  // the dock because the sheet is portalled to `document.body` and the dock is
  // one of the panels it has to escape — see RecreateModal's header.
  const [recreateTemplate, setRecreateTemplate] = useState(null);

  // Is the free render still owed? Two sources: the server (a render spent in
  // an earlier visit) and this screen (a render started just now, before any
  // re-read of eligibility). A failed render is not counted — it doesn't spend
  // the free one. While eligibility is loading we assume unspent, so a new user
  // never sees the price flash in.
  const {
    eligibility,
    loading: eligibilityLoading,
    refresh: refreshEligibility,
  } = useOnboardingEligibility();

  // Re-ask the server whenever a render settles. Eligibility was read once on
  // mount — so if this screen mounted while a render was running (the free
  // render already claimed) and that render then FAILED, the server returned
  // the freebie but this screen never heard, and kept showing the price instead
  // of "Free". Keyed on the set of settled board states, so it fires once per
  // render that finishes or fails, not on every progress frame. Bug 2026-09-15.
  const settledKey = Object.entries(videosByBoard)
    .filter(([, v]) => v?.status === 'failed' || v?.status === 'ready')
    .map(([id, v]) => `${id}:${v.status}:${v.attempts || 0}`)
    .sort()
    .join('|');
  useEffect(() => {
    if (settledKey) refreshEligibility();
  }, [settledKey, refreshEligibility]);
  const renderStartedHere = Object.values(videosByBoard).some(
    (v) => v?.status && v.status !== 'failed'
  );
  // ── Is this render covered by the onboarding allowance? ─────────────────
  //
  // "Covered" still means COVERED IN FULL, and that is why this compares against
  // the whole cost rather than asking "is there any budget left". A user with 3
  // credits of budget is not getting a 32-credit video for free, and a button
  // that says "Free" to them is the exact thing D2 forbids.
  //
  // What changed in ONB-010 is what happens in the gap. The budget is no longer
  // all-or-nothing: those 3 credits now pay their share and the wallet funds the
  // other 29. Because real credits leave a wallet in that case, it is confirmed
  // first — see `askToSplit` below.
  const allowanceLeft = Number(eligibility?.allowanceRemaining) || 0;
  const allowanceKnown = renderStartedHere || (!eligibilityLoading && Boolean(eligibility));
  // `renderStartedHere` is the optimistic half: a render started in this
  // session has already spent from the budget, and eligibility has not been
  // re-read yet. Assuming it is gone errs towards showing the price, which is
  // the safe direction — the opposite would promise free and then charge.
  const coveredByAllowance =
    !renderStartedHere && !eligibilityLoading && allowanceLeft >= VIDEO_RENDER_COST;
  // What the cards read. Named for what it DOES rather than for what is true of
  // the user: "show the real price" is the instruction, and it is right whenever
  // the allowance is not covering this render — including while we do not yet
  // know, which is the case that must never render as "Free".
  const showPrice = !coveredByAllowance;
  // What the offer bar counts down. Deliberately a DIFFERENT number from
  // `allowanceLeft` above: a free-plan user has no allowance but does have
  // credits, and showing them nothing was leaving the tightest budget the
  // least informed.
  const bannerLeft = Number(eligibility?.generationLeft) || 0;

  // ── The split confirmation ───────────────────────────────────────────────
  //
  // Only for the middle case: SOME budget left, but not enough. With a full
  // budget nothing leaves the wallet and there is nothing to agree to; with no
  // budget at all this is an ordinary paid action, priced on the button like
  // every other one in the product.
  const splitNeeded =
    allowanceKnown && !coveredByAllowance && allowanceLeft > 0 && allowanceLeft < VIDEO_RENDER_COST;
  // `{ board, allowance, wallet, stale }` while the dialog is up.
  const [splitAsk, setSplitAsk] = useState(null);
  const [splitBusy, setSplitBusy] = useState(false);

  // Every route to a render goes through here, so the confirmation cannot be
  // bypassed by whichever card or button is added next.
  const requestVideo = useCallback(
    async (board, quote) => {
      const result = await onGenerateVideo?.(board, quote);
      // The budget moved between the quote and the charge. NOTHING was taken —
      // the server refused rather than charging more than was shown — so this
      // re-asks with the real numbers instead of surfacing an error.
      if (result?.priceChanged && result.quote) {
        setSplitBusy(false);
        setSplitAsk({
          board,
          allowance: Number(result.quote.allowance) || 0,
          wallet: Number(result.quote.wallet) || 0,
          stale: true,
        });
        return;
      }
      setSplitBusy(false);
      setSplitAsk(null);
    },
    [onGenerateVideo]
  );

  const handleGenerateVideo = useCallback(
    (board) => {
      if (!splitNeeded) return requestVideo(board);
      setSplitAsk({
        board,
        allowance: allowanceLeft,
        wallet: VIDEO_RENDER_COST - allowanceLeft,
        stale: false,
      });
      return undefined;
    },
    [splitNeeded, allowanceLeft, requestVideo]
  );

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
    // No item cap: keep paging until the server says upstream ran out.
    !templatePaging.exhausted;
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

  // ── Brand panel collapse ─────────────────────────────────────────────────
  // User decisions 2026-09-15: collapses to a 56px rail with the logo, toggled
  // by a chevron beside the brand name, width animated, remembered per browser.
  const [brandCollapsed, setBrandCollapsed] = useState(() => {
    try {
      return localStorage.getItem(BRAND_PANEL_KEY) === '1';
    } catch {
      return false;
    }
  });
  const toggleBrandPanel = () =>
    setBrandCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem(BRAND_PANEL_KEY, next ? '1' : '0');
      } catch {
        /* storage blocked — the toggle still works for this visit */
      }
      return next;
    });

  // ── First-visit tour ─────────────────────────────────────────────────────
  // Waits for real content: pointing at skeleton cards explains nothing.
  const tourRootRef = useRef(null);

  // Which card the tour explains. Not blindly the first: that one may still be
  // drawing its frames, have only one of two, or already be rendering / failed
  // — and the tour would light up a loader or a disabled button, or describe
  // two frames where there is one. Bug 2026-09-17.
  //
  // In on-screen order, prefer a card with both frames and an unstarted render,
  // then one frame and unstarted. Frame counting mirrors ConceptCard.
  const readyFrames = (b) =>
    Math.min((b.images || []).filter((img) => img?.status === 'ready' && img?.src).length, 2);
  const unstarted = (b) => !videosByBoard[b.id]?.status;
  // Guarded: with no boards yet, orderWithLeadInMiddle returns `[undefined]`
  // (it splices in a missing lead), which crashed the `.find`s below.
  const ordered = boards.length ? orderWithLeadInMiddle(boards) : [];
  // Sticky: once picked, keep the same card while it stays usable, so a frame
  // landing on another card mid-tour does not move the spotlight's target.
  const tourBoardId = useRef(null);
  const kept = ordered.find(
    (b) => b.id === tourBoardId.current && readyFrames(b) > 0 && unstarted(b)
  );
  const tourBoard =
    kept ||
    ordered.find((b) => readyFrames(b) === 2 && unstarted(b)) ||
    ordered.find((b) => readyFrames(b) === 1 && unstarted(b)) ||
    null;
  tourBoardId.current = tourBoard?.id ?? null;
  const tourFrames = tourBoard ? readyFrames(tourBoard) : 0;
  // Also waits while the dock is dragged up: the user is browsing templates,
  // and the dock covers the ideas the tour would point at. Bug 2026-09-17 —
  // storyboards landed mid-browse and the spotlight lit up the dock and an
  // empty patch where the hidden Generate button sat.
  // Waits for a card worth pointing at, not merely for boards to exist — a
  // failed or still-loading first board no longer starts the tour early.
  const tourReady = Boolean(tourBoard) && !templatesPending && dockH <= DOCK_MIN_H;
  // Replay can be pressed with the dock up; drop it so every target is visible.
  const collapseDockForTour = useCallback(() => setDockH(DOCK_MIN_H), []);
  const tourSteps = [
    {
      target: '[data-tour="brand"]',
      pad: 0,
      title: 'Your brand profile',
      body: 'We pulled this from your website: industry, audience, products and colours. Every idea below is built on it.',
    },
    {
      target: '[data-tour="concept"]',
      title: 'Video ideas for your brand',
      body:
        tourFrames === 2
          ? 'Each idea shows the first and last frame of the video, with the voiceover underneath.'
          : 'Each idea previews a frame from the video, with the voiceover underneath.',
    },
    {
      target: '[data-tour="concept"] [data-tour="generate"]',
      title: 'Turn an idea into a video',
      body: showPrice
        ? 'Press Generate on the idea you like and we render the full clip.'
        : 'Press Generate on the idea you like and we render the full clip — this one is on us.',
    },
    {
      target: '[data-tour="templates"]',
      pad: 0,
      title: 'Templates from your industry',
      body: 'Ads already working for businesses like yours. Drag the bar up or press Expand all to see more.',
    },
  ];

  return (
    // `dark` is asserted here because this screen renders outside Layout, which
    // is what normally carries it. `relative`: the tour overlay is positioned
    // against this root.
    <div
      ref={tourRootRef}
      className="dark relative flex h-screen w-full flex-col overflow-hidden text-white"
      style={{ background: BG, fontFamily: "'Public Sans', sans-serif" }}
    >
      {/* The same offer bar the rest of the app carries, but with no button.
          Elsewhere it is a way IN; here the user is already inside it, and the
          button did nothing but scroll — an invitation to a place you are
          standing in. The line itself still earns its space: it is what tells
          the user the render they are about to start costs them nothing. */}
      {/* `allowanceKnown` is load-bearing: a budget of zero and a budget not
          yet read back both look like "no number", and rendering the second as
          the first made the bar appear for a frame on every reload and then
          vanish. The answer has to be IN before the bar can claim anything; a
          render started on this screen settles it without waiting. */}
      <FreeAdBanner
        // Inside onboarding the bar counts down whatever pays for the next
        // render — the allowance for a paid user, their own balance for a
        // free-plan one — so it reads `generationLeft` like the dashboard bar
        // does. The FREE badges on the cards keep reading `allowanceLeft`,
        // which is the only one of the two that means "this costs nothing".
        available={allowanceKnown && bannerLeft > 0}
        remaining={bannerLeft}
        total={Number(eligibility?.allowanceTotal) || 0}
        kind={eligibility?.generationKind || 'allowance'}
      />
      <Header
        onStartOver={onStartOver}
        onSkip={onSkip}
        onFinish={onFinish}
        // A finished clip, not a started render: the exit changes meaning
        // only once the user actually has something. Hydration refills
        // `videosByBoard` on reload, so this survives a refresh.
        generated={Object.values(videosByBoard).some((v) => v?.status === 'ready')}
        // RUNNING counts here, unlike `generated`. A render in flight is worth
        // going to look at — the clip screen is the only place its progress
        // shows — so the button appears the moment one starts.
        hasRenders={Object.values(videosByBoard).some(
          (v) => v?.status === 'ready' || v?.status === 'running',
        )}
        onViewAds={onViewAds}
      />

      {/* The first column animates between the panel and the rail widths
          (`grid-template-columns` interpolates), so storyboards and templates
          widen/narrow smoothly with it. Below `lg` the panel is hidden anyway. */}
      <div
        className="grid min-h-0 flex-1 grid-cols-1 lg:[grid-template-columns:var(--brand-col)_1fr]"
        style={{
          '--brand-col': `${brandCollapsed ? BRAND_RAIL_W : BRAND_PANEL_W}px`,
          transition: 'grid-template-columns 300ms cubic-bezier(.4,0,.2,1)',
        }}
      >
        {/* ═══ the brand ═══ */}
        <aside
          data-tour="brand"
          className="relative hidden min-h-0 flex-col overflow-hidden border-r lg:flex"
          style={{ background: CHROME, borderColor: LINE }}
        >
          {/* Collapsed rail: logo + expand chevron. Fades in over the clipped
              panel so the width animation never reflows the panel's text. */}
          <div
            className={cn(
              'absolute inset-0 z-[2] flex flex-col items-center gap-3 pt-4 transition-opacity duration-200',
              brandCollapsed ? 'opacity-100 delay-100' : 'pointer-events-none opacity-0'
            )}
            style={{ background: CHROME }}
            aria-hidden={!brandCollapsed}
          >
            <BrandMark src={logos[0]} name={brandName} />
            <button
              type="button"
              onClick={toggleBrandPanel}
              aria-label="Expand brand details"
              title="Expand brand details"
              className="grid h-7 w-7 place-items-center rounded-md border text-white/70 transition hover:border-[#15DCFF]/50 hover:text-white"
              style={{ background: SURF2, borderColor: LINE_STRONG }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="m13 17 5-5-5-5M6 17l5-5-5-5" />
              </svg>
            </button>
          </div>

          {/* Collapse chevron, top-right of the brand header. */}
          {!brandCollapsed && (
            <button
              type="button"
              onClick={toggleBrandPanel}
              aria-label="Collapse brand details"
              title="Collapse brand details"
              className="absolute top-4 right-3 z-[3] grid h-7 w-7 place-items-center rounded-md border text-white/60 transition hover:border-[#15DCFF]/50 hover:text-white"
              style={{ background: SURF2, borderColor: LINE_STRONG }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="m11 17-5-5 5-5M18 17l-5-5 5-5" />
              </svg>
            </button>
          )}

          {/* The full panel keeps its own fixed width so the column's width
              animation clips it instead of squeezing and re-wrapping its text. */}
          <div
            className={cn(
              'flex h-full min-h-0 shrink-0 flex-col transition-opacity duration-200',
              brandCollapsed ? 'pointer-events-none opacity-0' : 'opacity-100 delay-100'
            )}
            style={{ width: BRAND_PANEL_W }}
            aria-hidden={brandCollapsed}
          >
          {/* The header sits in a lit band rather than on the flat panel. The
              brand's name is the one thing on this screen that is the user's
              own, and it was rendering as small grey text against the same
              surface as everything under it. */}
          {/* `pr-12`: room for the collapse chevron so long names truncate
              before reaching it. */}
          <div className="shrink-0 border-b border-white/[0.07] bg-linear-to-b from-white/[0.06] to-transparent pt-4 pr-12 pb-3.5 pl-4">
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
          </div>
        </aside>

        {/* ═══ what comes next ═══ */}
        <main ref={mainRef} className="relative flex min-w-0 flex-col overflow-hidden">
          {/* The reserved strip under the cards is a CONSTANT, not the dock's
              live height, and that is the whole reason dragging the dock up no
              longer squashes the storyboards.

              The cards are `flex-1 basis-0` of this section's CONTENT box, so
              anything that changes the padding changes their height too — tying
              the padding to `dockH` meant every pixel the dock grew was a pixel
              taken off the keyframes, which is exactly the behaviour the overlay
              exists to avoid. Pinned at the collapsed dock's height, the cards
              are sized once and the dock simply covers them on its way up. */}
          {/* `isolate`: the inline player's controls carry z-20/z-30. Without a
              stacking context here those competed with the dock's z-[5] in
              `main` and painted OVER the dock when it was dragged up. */}
          <section
            className="isolate flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto px-[18px] pt-2.5"
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
                      tourAnchor={board.id === tourBoard?.id}
                      board={board}
                      index={i + 1}
                      onGenerate={handleGenerateVideo}
                      // The expand control on the inline player. Same handler:
                      // the board already has a clip, so it opens the screen
                      // rather than starting anything.
                      // Open only. This used to call onGenerateVideo, which
                      // starts a render for a FAILED board — so opening a
                      // failed card re-rendered it. Falls back only for the
                      // preview harness, which passes no onOpenVideo.
                      onOpen={() => (onOpenVideo ? onOpenVideo(board) : handleGenerateVideo(board))}
                      // Per concept, so a tile that is rendering says so while
                      // the others still offer the price.
                      videoState={videosByBoard[board.id]}
                      framesExhausted={framesExhausted}
                      showPrice={showPrice}
                    />
                  ))
                : storyboardsFailed
                  ? <ConceptsUnavailable message={storyboards.error} />
                  : [0, 1, 2].map((i) => (
                      <ConceptSkeleton key={i} delay={i * 140} index={i + 1} />
                    ))}
            </div>
          </section>

          <TemplateDock
            items={templateItems}
            pending={templatesPending}
            failed={templates.status === 'failed'}
            height={dockH}
            ceiling={dockCeiling()}
            onResize={resizeDock}
            onLoadMore={onLoadMoreTemplates}
            canLoadMore={canLoadMoreTemplates}
            onRecreate={setRecreateTemplate}
            paused={Boolean(recreateTemplate)}
          />
        </main>
      </div>

      <OnboardingTour tourKey="workspace" rootRef={tourRootRef} steps={tourSteps} ready={tourReady} onStart={collapseDockForTour} />

      {/* Shown only when the budget covers PART of a render — see the dialog's
          own header for why that case needs confirming and the other two do
          not. Nothing is charged until Generate is pressed here. */}
      <SplitChargeDialog
        open={Boolean(splitAsk)}
        cost={VIDEO_RENDER_COST}
        allowance={splitAsk?.allowance || 0}
        wallet={splitAsk?.wallet || 0}
        stale={Boolean(splitAsk?.stale)}
        busy={splitBusy}
        onCancel={() => {
          setSplitAsk(null);
          setSplitBusy(false);
        }}
        onConfirm={() => {
          if (!splitAsk) return;
          setSplitBusy(true);
          // The wallet figure travels with the request: the server refuses to
          // charge more than the number on this screen.
          requestVideo(splitAsk.board, { maxWalletCredits: splitAsk.wallet });
        }}
      />

      {/* `TemplateTile` and `videoSources` are passed in rather than imported by
          the sheet, so the two files never import each other. */}
      {recreateTemplate && (
        <RecreateModal
          template={recreateTemplate}
          items={templateItems}
          sourcesFor={videoSources}
          aspectFor={aspectOf}
          allowanceRemaining={allowanceLeft}
          // `session_id`, snake_case: that is what `GET /onboarding/sessions/:id`
          // answers with. Reading `sessionId` here left it undefined, and the
          // sheet's submit guard returned on it — Recreate did nothing at all,
          // silently. `sessionId` is kept as a fallback for the preview harness,
          // which builds the object by hand.
          sessionId={session?.session_id || session?.sessionId || ''}
          // A started recreate has moved the budget, so the number the banner
          // and the Generate buttons show is now stale. Re-reading is cheaper
          // than tracking it locally, and it cannot drift from the server.
          onStarted={(started) => {
            // The budget has moved, so the banner and the buttons are stale.
            refreshEligibility();
            // Close the sheet and hand off. The sheet's job ends at "it
            // started"; watching it happen belongs on the clip screen, which is
            // where a storyboard render already goes.
            setRecreateTemplate(null);
            onRecreateStarted?.({ ...started, template: recreateTemplate });
          }}
          TileComponent={TemplateTile}
          onPickTemplate={setRecreateTemplate}
          onClose={() => setRecreateTemplate(null)}
        />
      )}
    </div>
  );
}
