/**
 * One concept, rendering into a clip.
 *
 * The screen a Generate click opens. A full view rather than a modal because
 * the wait is the content: a render takes the better part of a minute and there
 * is nothing useful to do behind it.
 *
 * ── The side panel ──────────────────────────────────────────────────────────
 * Download and post — the things you do with a finished clip — plus, for an
 * image, the Edit block.
 *
 * Posting is not reimplemented here: it opens `PostAdMySpaceModal`, the exact
 * flow MySpace uses, with the clip as its payload. A second posting path would
 * be a second set of bugs about connected accounts.
 *
 * An IMAGE gets an Edit block (`ImageEditPanel`): logo,
 * crop, adjust, filters, text, resize — all in the browser. Each saved edit is a
 * new image filed in MySpace and a new card in the strip; this one is untouched.
 *
 * Versions is gone for both kinds (user decision 2026-09-25). Regeneration is
 * switched off in `videoClient`, so it could only ever list one entry — the
 * clip already on the stage. Resize exports for video are absent too (the
 * render is fixed at 9:16 server-side). A control a user cannot make work is
 * worse than no control.
 *
 * ── The waiting sequence ────────────────────────────────────────────────────
 * Three stages, and each exists because the one before it stops being honest:
 *
 *   0-20s   a shimmer with a line of copy that changes.
 *           A render has nothing to show yet. Copy that moves is the difference
 *           between "working" and "hung".
 *
 *   20-50s  the blurred loader GIF, looping.
 *           Built from THIS concept's own keyframes, so the placeholder is made
 *           of the scene it stands in for. Twenty seconds of shimmer is where a
 *           generic placeholder starts reading as a stall.
 *
 *   50s+    a single pill that keeps moving, and nothing else.
 *           The GIF loop is a ten-second idea; watching it a fourth time is
 *           worse than a quiet, obviously-alive control. This stage has no end
 *           time on purpose — it runs until the clip arrives, however long that
 *           takes, because inventing a deadline we cannot keep is worse than
 *           admitting we do not know.
 *
 * Every stage is skippable and none is load-bearing. The GIF is built by a call
 * that is allowed to fail; when it does, stage 1 runs straight into stage 3.
 * The clip arriving at any moment abandons the sequence wherever it is.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Megaphone } from 'lucide-react';
import { handleDownload } from '@/utils/download';
import CustomVideoPlayer from '../AdStudio/AdVideo/AdVideoChats/CustomVideoPlayer';
import PostAdMySpaceModal from '../AdStudio/AdVideoNew/PostAdMySpace/PostAdMySpaceModal';
import { readPendingPostAd } from '../AdStudio/AdVideoNew/PostAdMySpace/postAdPersistence';
import { Header } from './Workspace';
import { ClipSettleLoader, CLIP_LINES } from './FrameLoader';
import RetryCountdownButton from './RetryCountdownButton';
import OnboardingTour from './OnboardingTour';
import ClipStrip from './ClipStrip';
import ImageEditPanel from './ImageEditPanel';
import { canvasToBlob, downloadBlob, loadCanvasImage } from './QuickImageTools';

const SURF2 = '#232329';
const LINE = 'rgba(255,255,255,0.09)';
const LINE_STRONG = 'rgba(255,255,255,0.16)';
const CHROME = '#131317';

/** When each stage takes over, in ms from the moment Generate was pressed. */
const LOADER_GIF_AT = 20_000;
const PULSE_AT = 50_000;

/**
 * The lines shown during the shimmer, one every few seconds.
 *
 * Written about THIS render rather than about waiting in general — they name
 * what the model is doing with the two keyframes, so a person reading them
 * learns something instead of being kept busy.
 */
// Design handoff `design_handoff_frame_loaders` (4b), 2026-09-16: three lines,
// 4.2s apart, each rising into place over 0.9s.
const SHIMMER_LINES = CLIP_LINES;

const LINE_EVERY = 4_200;

/* ── the waiting stages ──────────────────────────────────────────────────── */

/** Which stage the clock is in. `gif` collapses into `pulse` when there is none. */
function useLoadingStage(startedAt, hasLoader) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    // One second is enough: the boundaries are twenty seconds apart, and a
    // faster tick would re-render the whole view for nothing.
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const elapsed = startedAt ? now - startedAt : 0;
  if (elapsed >= PULSE_AT || (elapsed >= LOADER_GIF_AT && !hasLoader)) return 'pulse';
  if (elapsed >= LOADER_GIF_AT) return 'gif';
  return 'shimmer';
}

/** The rotating line under the shimmer. */
function useRotatingLine(active) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(() => setIndex((i) => (i + 1) % SHIMMER_LINES.length), LINE_EVERY);
    return () => clearInterval(id);
  }, [active]);
  return SHIMMER_LINES[index];
}

/** A pill in the top-left of the frame — the same place through every stage. */
function StatusPill({ children, tone = 'neutral' }) {
  return (
    <span
      className="absolute top-3 left-3 z-[2] inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12px] font-semibold backdrop-blur-md"
      style={{
        background: 'rgba(14,14,17,0.78)',
        borderColor: tone === 'live' ? 'rgba(190,255,90,0.35)' : LINE_STRONG,
        color: tone === 'live' ? '#D6FF6E' : 'rgba(255,255,255,0.82)',
      }}
    >
      <Spinner tone={tone} />
      {children}
    </span>
  );
}

function Spinner({ tone }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" className="shrink-0 animate-spin" aria-hidden>
      <circle
        cx="12"
        cy="12"
        r="9"
        fill="none"
        strokeWidth="3"
        stroke={tone === 'live' ? 'rgba(214,255,110,0.25)' : 'rgba(255,255,255,0.18)'}
      />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        fill="none"
        strokeWidth="3"
        strokeLinecap="round"
        stroke={tone === 'live' ? '#D6FF6E' : 'rgba(255,255,255,0.75)'}
      />
    </svg>
  );
}

/** The 9:16 box every stage fills, so nothing shifts when one replaces another. */
function Frame({ children, ratio = 'aspect-9/16' }) {
  return (
    <div
      // A storyboard clip is always 9:16; an image is whatever the template was.
      // Forcing the clip's ratio on it would make the loading box a different
      // shape from the picture that replaces it, which reads as the layout
      // jumping at the end of the render.
      className={`relative ${ratio} h-full max-h-full w-auto overflow-hidden rounded-2xl border`}
      style={{ background: '#1B1B21', borderColor: LINE }}
    >
      {children}
    </div>
  );
}

/**
 * Stage 1 — the settle loader from the design handoff (option 4b).
 *
 * Glow orbs behind a dim mosaic behind a blurred scrim, with a "Working" chip
 * top-left and, at the foot, the rotating line over an indeterminate rule. It
 * carries its own ground (`#0f1017`) and its own status, so the shared
 * `StatusPill` is not used here.
 */
function ShimmerStage({ line }) {
  return <ClipSettleLoader line={line} />;
}

function GifStage({ loader }) {
  return (
    <>
      <img
        src={loader.url}
        alt=""
        // The GIF is encoded at 360p and blurred on purpose; letting it fill the
        // box is the whole effect. `cover` rather than `contain` so no letterbox
        // appears if the encoded ratio came back a pixel off 9:16.
        className="absolute inset-0 h-full w-full object-cover"
        draggable={false}
      />
      {/* The top of the frame is where the pill would otherwise fight the image
          for contrast. */}
      <div
        className="absolute inset-0"
        style={{ background: 'linear-gradient(180deg,rgba(0,0,0,0.35) 0%,transparent 35%)' }}
      />
      <StatusPill>Processing</StatusPill>
    </>
  );
}

/**
 * The whole loading state for an image recreate.
 *
 * The three-stage machine above — settle mosaic, then the loader GIF, then the
 * glow — is built for a render that takes about a minute and has boundary
 * keyframes to tease. An image lands in roughly fifteen seconds and has none of
 * that: the mosaic is a video's mosaic, no loader GIF is ever built for a
 * recreate, and the glow announces "Generating video" for something that is not
 * one. Three wrong answers in a row, and the last of them says the wrong word.
 *
 * So a still gets one quiet state instead, and it says what is actually
 * happening.
 */
function StillStage() {
  return (
    <>
      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(100deg, rgba(255,255,255,0.03) 20%, rgba(255,255,255,0.075) 40%, rgba(255,255,255,0.03) 60%)',
          backgroundSize: '260% 100%',
          animation: 'clipStillSheen 1600ms ease-in-out infinite',
        }}
      />
      <StatusPill tone="live">Generating image</StatusPill>
      <style>{`
        @keyframes clipStillSheen {
          from { background-position: 160% 0; }
          to   { background-position: -60% 0; }
        }
      `}</style>
    </>
  );
}

function PulseStage() {
  return (
    <>
      <div className="absolute inset-0 animate-[clipGlow_3.5s_ease-in-out_infinite]" />
      <StatusPill tone="live">Generating video</StatusPill>
      <style>{`
        @keyframes clipGlow {
          0%, 100% { background: radial-gradient(120% 80% at 20% 0%, rgba(214,255,110,0.10), transparent 60%) }
          50%      { background: radial-gradient(120% 80% at 80% 10%, rgba(120,200,255,0.10), transparent 60%) }
        }
      `}</style>
    </>
  );
}

/**
 * A render error, in words a user can act on.
 *
 * `state.error` is either copy this app already wrote for users (the
 * `videoRejected` reasons in brandSetupSlice — credits, plan, service down…) or
 * DS's raw internal message, e.g. "no clips could be rendered; check that each
 * concept has generated keyframes". The raw text is never shown (user decision
 * 2026-09-15): known causes get a specific friendly line, anything else a
 * general one. The original is logged for debugging.
 */
const RENDER_ERROR_FALLBACK =
  'Something went wrong while making this video. Try again, or pick another idea from the board.';

// Our own user-facing messages from brandSetupSlice.videoRejected — shown as-is.
const USER_FACING_RENDER_ERRORS = [
  /enough credits/i,
  /active plan/i,
  /not switched on/i,
  /not responding/i,
  /already been rendered/i,
  /could not find this concept/i,
  /could not start this render/i,
];

function friendlyRenderError(error) {
  const raw = String(error || '').trim();
  if (!raw) return RENDER_ERROR_FALLBACK;
  if (USER_FACING_RENDER_ERRORS.some((re) => re.test(raw))) return raw;
  if (/keyframe|no clips could be rendered/i.test(raw)) {
    return 'Some images for this storyboard weren’t ready, so the video couldn’t be made. Try again, or pick another idea from the board.';
  }
  return RENDER_ERROR_FALLBACK;
}

/**
 * The one failure screen.
 *
 * Back to the board lives HERE and nowhere else. On the way to a clip there is
 * nothing to go back for — the render is running and leaving would only hide
 * it. A failure is the one state where the board is genuinely the better place
 * to be, because the other concepts are still there to try.
 */
/**
 * @param attempts  How many renders have been started for this board. One retry
 *   is offered; past that the honest advice is a different concept, not the
 *   same one again. See ONBOARDING_FAILURE_HANDLING.md §2.
 */
function FailedStage({ error, onRetry, onBack, attempts = 1 }) {
  // Retries are unlimited (user decision 2026-09-15); `attempts` is kept only
  // for callers and no longer gates anything.
  const message = friendlyRenderError(error);

  // The raw error, for debugging — once per distinct error, not per render (the
  // view re-renders every second on its loading clock).
  useEffect(() => {
    // eslint-disable-next-line no-console
    if (error) console.warn('[onboarding] render failed (raw error):', error);
  }, [error]);

  return (
    <div className="absolute inset-0 grid place-items-center px-8 text-center">
      <div>
        <p className="text-[13.5px] font-semibold text-white/90">We couldn&rsquo;t create this video</p>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-white/70">{message}</p>
        {/* A failed render releases its credit hold and never spends the free
            render (renderBilling), so this is always true on this screen. */}
        <p className="mt-2 text-[12px] font-medium text-[#5CE08A]/90">You haven&rsquo;t been charged.</p>
        <div className="mt-4 flex items-center justify-center gap-2">
          {onRetry && <RetryCountdownButton onClick={onRetry} />}
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="rounded-lg border px-3 py-1.5 text-[12px] font-semibold text-white/70 transition hover:text-white"
              style={{ background: SURF2, borderColor: LINE_STRONG }}
            >
              Back to board
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * An edited image, with a before/after slider against the image it came from.
 *
 * Off by default — the stage is the ad, and a slider across it all the time
 * would be in the way of simply looking at it. In compare mode both images are
 * `object-contain` in the same box, so an edit that changed the SHAPE (a crop,
 * fit-to-placement) still lines up on its centre instead of jumping. The
 * dragging is a native range input stretched over the stage, invisible: it gets
 * pointer, touch and keyboard for free.
 */
function CompareStill({ src, before }) {
  const [on, setOn] = useState(false);
  const [pct, setPct] = useState(50);

  return (
    <div className="relative flex h-full w-full items-center justify-center">
      {on ? (
        <div className="absolute inset-0 overflow-hidden rounded-xl">
          <img
            src={src}
            alt="After"
            className="absolute inset-0 h-full w-full object-contain"
            draggable={false}
          />
          <div
            className="absolute inset-0"
            // The page ground behind BEFORE, so its letterbox does not show the
            // AFTER image through it when the two differ in shape.
            style={{ background: '#0f0f0f', clipPath: `inset(0 ${100 - pct}% 0 0)` }}
          >
            <img
              src={before}
              alt="Before"
              className="absolute inset-0 h-full w-full object-contain"
              draggable={false}
            />
          </div>
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-[#15DCFF]"
            style={{ left: `${pct}%` }}
          >
            <span className="absolute top-1/2 left-1/2 grid h-8 w-8 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 border-[#15DCFF] bg-[#0f0f0f] text-[11px] font-bold text-[#15DCFF]">
              ⇆
            </span>
          </div>
          <span className="pointer-events-none absolute bottom-3 left-3 rounded-full bg-black/70 px-2.5 py-1 text-[11px] font-semibold text-white/85">
            Before
          </span>
          <span className="pointer-events-none absolute right-3 bottom-3 rounded-full bg-black/70 px-2.5 py-1 text-[11px] font-semibold text-white/85">
            After
          </span>
          <input
            type="range"
            min={0}
            max={100}
            value={pct}
            onChange={(e) => setPct(Number(e.target.value))}
            aria-label="Compare before and after"
            className="absolute inset-0 h-full w-full cursor-ew-resize opacity-0"
          />
        </div>
      ) : (
        <img
          src={src}
          alt="Your edited ad"
          className="max-h-full max-w-full rounded-xl object-contain"
        />
      )}
      <button
        type="button"
        onClick={() => setOn((v) => !v)}
        className="absolute top-0 left-1/2 z-[2] -translate-x-1/2 rounded-full border px-3 py-1.5 text-[12px] font-semibold backdrop-blur-md transition"
        style={{
          background: 'rgba(14,14,17,0.78)',
          borderColor: on ? 'rgba(21,220,255,0.45)' : LINE_STRONG,
          color: on ? '#15DCFF' : 'rgba(255,255,255,0.85)',
        }}
      >
        {on ? 'Done comparing' : 'Compare with before'}
      </button>
    </div>
  );
}

/* ── the side panel ──────────────────────────────────────────────────────── */

/** A block heading, in the panel's own small-caps voice. */
function PanelLabel({ children, action }) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="text-[11px] font-semibold tracking-[0.08em] text-white/60 uppercase">
        {children}
      </h2>
      {action}
    </div>
  );
}

/**
 * The panel's buttons.
 *
 * Flat, on the panel's own surface, with one accent border for the primary —
 * the workspace's raised gradient button belongs on a card in a grid, where it
 * has to win attention against two others. In a column of three actions on a
 * dark panel it just reads as a different product.
 */
function PanelButton({ children, onClick, primary = false, icon: Icon }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-lg border px-3 py-2.5 text-[13px] font-semibold transition"
      style={{
        background: primary ? 'rgba(21,220,255,0.09)' : SURF2,
        borderColor: primary ? 'rgba(21,220,255,0.35)' : LINE_STRONG,
        color: primary ? '#15DCFF' : 'rgba(255,255,255,0.8)',
      }}
    >
      {Icon && <Icon size={15} className="shrink-0" />}
      {children}
    </button>
  );
}

/** One label/value pair in the details row. */
function Meta({ label, children }) {
  return (
    <div className="flex min-w-0 items-baseline gap-1.5">
      <dt className="shrink-0 text-white/50">{label}</dt>
      <dd className="min-w-0 truncate font-medium text-white/80">{children}</dd>
    </div>
  );
}

/**
 * Download for an image, in the format the user picks.
 *
 * A video's download is the file as rendered. An image can be re-encoded in the
 * browser for free, and people genuinely need different ones: PNG to keep it
 * crisp, JPG because an ad account or a colleague wants one, WebP for size.
 * The image is redrawn on a canvas (through the CORS proxy) and exported; JPG
 * has no transparency, so it is painted onto white rather than black.
 */
const DOWNLOAD_FORMATS = [
  { value: 'png', label: 'PNG', mime: 'image/png' },
  { value: 'jpg', label: 'JPG', mime: 'image/jpeg' },
  { value: 'webp', label: 'WebP', mime: 'image/webp' },
];

function ImageDownload({ src }) {
  const [format, setFormat] = useState('png');
  const [busy, setBusy] = useState(false);

  const download = async () => {
    if (busy) return;
    setBusy(true);
    const f = DOWNLOAD_FORMATS.find((x) => x.value === format) || DOWNLOAD_FORMATS[0];
    try {
      const img = await loadCanvasImage(src);
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (f.value === 'jpg') {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      ctx.drawImage(img, 0, 0);
      const blob = await canvasToBlob(canvas, f.mime, 0.92);
      downloadBlob(blob, `adsgpt-ad-${Date.now()}.${f.value}`);
    } catch (err) {
      // The proxy being down should not cost the user their download: fall back
      // to the file as stored, in whatever format that is.
      console.warn('[onboarding] format download failed, downloading original:', err);
      handleDownload(src);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <PanelButton primary icon={Download} onClick={download}>
        {busy ? 'Preparing…' : `Download ${DOWNLOAD_FORMATS.find((x) => x.value === format)?.label}`}
      </PanelButton>
      <div className="flex gap-1" role="radiogroup" aria-label="Download format">
        {DOWNLOAD_FORMATS.map((x) => {
          const on = x.value === format;
          return (
            <button
              key={x.value}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setFormat(x.value)}
              className="flex-1 rounded-md border py-1 text-[11.5px] font-semibold transition"
              style={{
                background: on ? 'rgba(21,220,255,0.09)' : 'transparent',
                borderColor: on ? 'rgba(21,220,255,0.35)' : LINE,
                color: on ? '#15DCFF' : 'rgba(255,255,255,0.55)',
              }}
            >
              {x.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Everything you do with the clip, and what it is.
 *
 * The title lives here rather than in a strip above the stage: a bar carrying
 * one label and one button was mostly empty space, and it pushed the player
 * down for no reason. The panel already had to exist.
 */
function SidePanel({
  title,
  angle,
  status,
  ready,
  src,
  clip,
  board,
  message,
  isStill = false,
  onEdited,
}) {
  const [postAd, setPostAd] = useState({ open: false, payload: null, autoAdvance: false });

  /**
   * Reopen the modal after the Facebook OAuth round-trip.
   *
   * The redirect returns to `window.location.href`, which tears this whole page
   * down and builds it again — no close handler runs, which is exactly why the
   * modal was able to persist its payload on the way out. This is the other
   * half of that, and it is the same three lines every MySpace page has.
   *
   * `autoAdvance` skips the connect step: the account the user just linked is
   * the reason they were sent away, so showing them the connect screen again
   * would be asking them to do the thing they have already done.
   */
  useEffect(() => {
    const pending = readPendingPostAd();
    if (pending) setPostAd({ open: true, payload: pending, autoAdvance: true });
  }, []);

  const openPostAd = () =>
    setPostAd({
      open: true,
      autoAdvance: false,
      // The same payload shape MySpace's own cards send, so the modal's connect
      // → select → compose machine behaves identically here.
      payload: {
        url: src,
        // The post modal renders a player or a picture off this. Saying `true`
        // for a still would hand an image to a `<video>`.
        isVideo: !isStill,
        prompt: board?.voiceover || board?.premise || title,
        item: { url: src, title, aiAds: { source: 'onboarding' } },
      },
    });

  return (
    <>
      <aside
        className="flex w-[300px] shrink-0 flex-col gap-6 overflow-y-auto border-l p-5"
        style={{ background: CHROME, borderColor: LINE }}
      >
        <div data-tour="send">
          <PanelLabel>Send it out</PanelLabel>
          {ready ? (
            <div className="mt-3 flex flex-col gap-2">
              {isStill ? (
                <ImageDownload src={src} />
              ) : (
                <PanelButton primary icon={Download} onClick={() => handleDownload(src)}>
                  Download MP4
                </PanelButton>
              )}
              <PanelButton icon={Megaphone} onClick={openPostAd}>
                Post to ad account
              </PanelButton>
            </div>
          ) : (
            <p className="mt-2.5 text-[12.5px] leading-relaxed text-white/70">
              {status === 'failed'
                ? 'Nothing to send — this concept didn’t render.'
                : message || (isStill ? 'Ready in about fifteen seconds.' : 'Ready in about a minute.')}
            </p>
          )}
        </div>

        {/* An image's next step is touching it up — see `ImageEditPanel`. Only
            once it exists: there is nothing to edit while it renders. */}
        {isStill && ready && onEdited && (
          <div data-tour="edit">
            <PanelLabel>Edit</PanelLabel>
            <p className="mt-1 text-[11.5px] text-white/55">
              Every edit is saved as a new image. This one stays as it is.
            </p>
            <ImageEditPanel src={src} model={clip?.model} prompt={title} onEdited={onEdited} />
          </div>
        )}

        {/* The concept, straight under the blocks above. It used to be pinned
            to the foot (`mt-auto`) to fill the space under Versions; with
            Versions gone that left a column of nothing between "Send it out"
            and the concept on every video, so it now just follows. */}
        <div data-tour="concept" className="border-t pt-5" style={{ borderColor: LINE }}>
          <PanelLabel>This concept</PanelLabel>

          <h2 className="mt-2.5 text-[14px] leading-snug font-semibold text-white">{title}</h2>

          {angle && (
            <p className="mt-1.5 text-[12px] leading-relaxed text-white/70">{angle}</p>
          )}

          {board?.voiceover && (
            // The spoken line, marked as speech rather than as another
            // paragraph — it is the one piece of the concept a viewer HEARS.
            <p className="mt-3 border-l-2 pl-2.5 text-[12.5px] leading-relaxed text-white/65 italic"
               style={{ borderColor: 'rgba(21,220,255,0.4)' }}>
              “{board.voiceover}”
            </p>
          )}

          {board?.transition && (
            <p className="mt-3 text-[12px] leading-relaxed text-white/65">
              <span className="text-white/50">Camera · </span>
              {board.transition}
            </p>
          )}

          <dl className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 text-[11px]">
            <Meta label="Status">
              <span
                style={{
                  color: ready
                    ? '#5CE08A'
                    : status === 'failed'
                      ? '#FF7A7A'
                      : 'rgba(255,255,255,0.55)',
                }}
              >
                {ready ? 'ready' : status === 'failed' ? 'failed' : 'rendering'}
              </span>
            </Meta>
            {/* A clip is always 9:16; a still is whatever the template was, and
                we are not told which. Claiming a ratio we do not know is worse
                than not showing one. */}
            {!isStill && <Meta label="Ratio">9:16</Meta>}
            {clip?.duration_s ? <Meta label="Length">{clip.duration_s}s</Meta> : null}
            {clip?.model ? <Meta label="Model">{clip.model}</Meta> : null}
          </dl>
        </div>
      </aside>

      <PostAdMySpaceModal
        open={postAd.open}
        onOpenChange={(open) => setPostAd((s) => ({ ...s, open }))}
        payload={postAd.payload}
        autoAdvance={postAd.autoAdvance}
      />
    </>
  );
}

/* ── the view ────────────────────────────────────────────────────────────── */

/**
 * @param board       the storyboard concept, for its title
 * @param index       its position on the board, for the eyebrow
 * @param state       this board's entry from `brandSetup.videos.byBoard`
 * @param onBack      return to the workspace while preserving the current run
 * @param onRetry     start the render again, after a failure
 * @param onStartOver the header's own control, same as the workspace's
 * @param onFinish    leave onboarding for the studio, having got a clip
 * @param onSkip      leave before the clip is ready
 */
export default function ClipView({
  board,
  index,
  state = {},
  // Every render this onboarding has produced, for the strip under the stage.
  // Empty (or a single entry) renders nothing — see `ClipStrip`.
  stripItems = [],
  onSelectClip,
  onBack,
  onRetry,
  onStartOver,
  onFinish,
  onSkip,
  // `(url) => void` — an image edit was saved. The host adds it to the strip as
  // a card of its own; absent, the Edit block is not shown.
  onEdited,
  // The image an edited card was made from, for the before/after slider.
  // Empty for anything that is not an edit.
  compareSrc = '',
}) {
  const status = state.status || 'running';
  const clip = state.video?.video || null;

  // `src` is resolved server-side — durable media store first, this API's own
  // 24h copy as the fallback, and never a link that claims to be an image — so
  // the player does not have to know which of the two exists.
  const src = clip?.src || clip?.url || clip?.local_url || '';

  // A recreate from an IMAGE template renders a picture, not a clip. Everything
  // else — the progress copy, the failure states, the exits — is identical,
  // because Node normalises an image result into the same board shape a video
  // carries (`templateAdResult.asBoardVideo`).
  //
  // Read from the BOARD first and the result second, and that order is the
  // point: while the render is running there is no result yet, so a check on
  // `mime_type` alone would show the video loading stages for the whole wait and
  // only correct itself at the very end. The board knows from the 202.
  const isStill =
    board?.kind === 'image' || String(clip?.mime_type || '').startsWith('image/');

  const loader = useMemo(() => {
    if (!state.loader?.url) return null;
    // A loader link is dead ten minutes after it was built. Showing an expired
    // one is worse than showing none: a broken image in the middle of a render
    // reads as the render itself having broken.
    if (state.loader.expiresAt && new Date(state.loader.expiresAt) <= new Date()) return null;
    return state.loader;
  }, [state.loader]);

  const stage = useLoadingStage(state.startedAt, Boolean(loader));
  const line = useRotatingLine(status === 'running' && stage === 'shimmer');

  // The storyboard is the better source — it also carries the voiceover and the
  // camera move. But the clip payload carries `title` and `angle` of its own,
  // and it is the one thing guaranteed to be here: a session opened straight
  // onto this screen may have the clip before the board has been matched to it.
  const title = board?.title || state.video?.title || `Idea ${index}`;
  const angle = board?.angle || state.video?.angle || '';
  const ready = status === 'ready' && Boolean(src);

  // First-visit tour, only once there is a clip to talk about. `relative` on
  // the root below: the overlay is positioned against it.
  const tourRootRef = useRef(null);
  // An image gets its own words and an Edit step — the video copy ("play it",
  // "the MP4") is wrong for it. A video has no third step since Versions went.
  const tourSteps = [
    {
      // The player itself, not the whole stage it is centred in.
      target: '[data-tour="clip-stage"] > *',
      title: isStill ? 'Your ad is ready' : 'Your video is ready',
      body: isStill
        ? 'This is your finished image ad.'
        : 'Play it here, scrub through it, or open it full screen.',
    },
    {
      target: '[data-tour="send"]',
      title: 'Send it out',
      body: isStill
        ? 'Download the image, or post it straight to your connected ad account.'
        : 'Download the MP4, or post it straight to your connected ad account.',
    },
    isStill && {
      target: '[data-tour="edit"]',
      title: 'Edit your ad',
      body: 'Add your logo, crop, adjust or add text. Each edit is saved as a new image in My Space.',
    },
    {
      target: '[data-tour="concept"]',
      title: 'The idea behind it',
      body: 'The concept, voiceover and camera move this clip was made from.',
    },
  ].filter(Boolean);

  return (
    <div ref={tourRootRef} className="relative flex h-screen flex-col" style={{ background: '#0f0f0f' }}>
      {/* "Go to dashboard" once this clip is ready; "Skip for now" while it is
          still rendering (or failed), since nothing has been generated yet. */}
      <Header onStartOver={onStartOver} onFinish={onFinish} onSkip={onSkip} generated={ready} />

      <div className="flex min-h-0 flex-1">
        {/* Back link lives in the stage column (not full width) so the side
            panel runs flush from the header down, with no empty strip above it. */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="shrink-0 px-5 py-3">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-2 rounded text-xs font-medium text-white/60 transition hover:text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#15DCFF]"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M19 12H5m6 6-6-6 6-6" />
            </svg>
            Back to Board
          </button>
        </div>
        {/* FLEX, not grid, and that is load-bearing. `max-h-full` on the image
            below is a percentage, so it only constrains anything when its
            containing block has a DEFINITE height. A grid row is sized by its
            content, so the percentage resolved against the image's own height
            and constrained nothing: a tall still rendered at natural size and
            ran straight off the bottom of the screen. This element already has
            a definite height (`flex-1` + `min-h-0` inside a flex column), and
            in a flex container the percentage resolves against it. */}
        {/* KEYED ON THE BOARD, so switching clips from the strip replays the
            entry animation instead of swapping the frame instantly. The remount
            is wanted for its own sake too: it resets the player rather than
            pointing the running one at a different file mid-playback. */}
        <div
          key={board?.id || 'stage'}
          data-tour="clip-stage"
          className="clip-stage flex min-h-0 flex-1 items-center justify-center p-5"
        >
          {ready && isStill && compareSrc ? (
            <CompareStill src={src} before={compareSrc} />
          ) : ready && isStill ? (
            // `object-contain`, never `cover`: an ad is the whole composition,
            // and cropping the thing the user just paid to have made is the one
            // thing this must not do. The ratio is the image's own.
            <img
              src={src}
              alt="Your recreated ad"
              className="max-h-full max-w-full rounded-xl object-contain"
            />
          ) : ready ? (
            // The app's player, not a bare `<video>`: play, scrub, speed, PiP,
            // fullscreen and its own download, identical to every other clip in
            // the product.
            <CustomVideoPlayer src={src} aspect="ASPECT_9_16_FULL" />
          ) : (
            <Frame ratio={isStill ? 'aspect-square' : 'aspect-9/16'}>
              {status === 'failed' ? (
                <FailedStage
                  error={state.error}
                  onRetry={onRetry}
                  onBack={onBack}
                  attempts={state.attempts}
                />
              ) : isStill ? (
                // One state, start to finish — see `StillStage`.
                <StillStage />
              ) : stage === 'gif' && loader ? (
                <GifStage loader={loader} />
              ) : stage === 'pulse' ? (
                <PulseStage />
              ) : (
                <ShimmerStage line={line} />
              )}
            </Frame>
          )}
        </div>

        <style>{`
          .clip-stage { animation: clipStageIn 320ms cubic-bezier(0.22,1,0.36,1) both; }
          @keyframes clipStageIn {
            from { opacity: 0; transform: scale(0.985); }
            to   { opacity: 1; transform: none; }
          }
          @media (prefers-reduced-motion: reduce) {
            .clip-stage { animation: none; }
          }
        `}</style>

        {/* Under the stage and inside the same column, so it sits beneath the
            ad rather than beside it and the side panel keeps its full height. */}
        <ClipStrip items={stripItems} activeId={board?.id || ''} onSelect={onSelectClip} />
        </div>

        <SidePanel
          isStill={isStill}
          title={title}
          angle={angle}
          status={status}
          ready={ready}
          src={src}
          clip={clip}
          board={board}
          message={state.message}
          onEdited={onEdited}
        />
      </div>

      <footer
        className="flex h-14 shrink-0 items-center justify-between border-t px-5"
        style={{ background: CHROME, borderColor: LINE }}
      >
        <p className="text-[12.5px] text-white/70">
          {ready
            ? isStill
              ? 'Your ad is ready.'
              : 'Your first clip is ready.'
            : status === 'failed'
              ? 'Nothing rendered for this concept.'
              : state.message ||
                (isStill
                  ? 'Rendering — this usually takes about fifteen seconds.'
                  : 'Rendering — this usually takes about a minute.')}
        </p>
      </footer>

      <OnboardingTour tourKey="clip" rootRef={tourRootRef} steps={tourSteps} ready={ready} />
    </div>
  );
}
