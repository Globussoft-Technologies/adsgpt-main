/**
 * One concept, rendering into a clip.
 *
 * The screen a Generate click opens. A full view rather than a modal because
 * the wait is the content: a render takes the better part of a minute and there
 * is nothing useful to do behind it.
 *
 * ── The side panel ──────────────────────────────────────────────────────────
 * Download, post, and the version history — the three things you do with a
 * finished clip, in the panel the design puts them in.
 *
 * Posting is not reimplemented here: it opens `PostAdMySpaceModal`, the exact
 * flow MySpace uses, with the clip as its payload. A second posting path would
 * be a second set of bugs about connected accounts.
 *
 * Two things from the design are still absent, and deliberately: resize exports
 * (the render is fixed at 9:16 server-side, so the buttons would do nothing)
 * and the "+" that starts a new version (regeneration is switched off in
 * `videoClient`). A control a user cannot make work is worse than no control.
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

import { useEffect, useMemo, useState } from 'react';
import { Check, Download, Megaphone } from 'lucide-react';
import { handleDownload } from '@/utils/download';
import CustomVideoPlayer from '../AdStudio/AdVideo/AdVideoChats/CustomVideoPlayer';
import PostAdMySpaceModal from '../AdStudio/AdVideoNew/PostAdMySpace/PostAdMySpaceModal';
import { readPendingPostAd } from '../AdStudio/AdVideoNew/PostAdMySpace/postAdPersistence';
import { Header } from './Workspace';
import MosaicLoader from './MosaicLoader';
import RetryCountdownButton from './RetryCountdownButton';

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
const SHIMMER_LINES = [
  'Reading your storyboard…',
  'Studying the first and last frames…',
  'Working out the motion between them…',
  'Directing the camera move…',
  'Laying in the voiceover…',
];

const LINE_EVERY = 4_000;

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
function Frame({ children }) {
  return (
    <div
      className="relative aspect-9/16 h-full max-h-full w-auto overflow-hidden rounded-2xl border"
      style={{ background: '#1B1B21', borderColor: LINE }}
    >
      {children}
    </div>
  );
}

function ShimmerStage({ line }) {
  return (
    <>
      {/* The same mosaic the storyboard placeholders use, so the wait for a
          keyframe and the wait for a clip look like the same kind of work. A
          travelling band said "loading over the wire"; nothing is loading, an
          image is being composed elsewhere, piece by piece. */}
      <div className="absolute inset-0 overflow-hidden">
        <MosaicLoader />
      </div>
      <StatusPill>Processing</StatusPill>
      <p
        // `key` on the text so React remounts it and the fade replays; without
        // it the line swaps hard and reads as a glitch.
        key={line}
        className="absolute inset-x-6 bottom-8 animate-[clipFade_600ms_ease-out] text-center text-[13px] font-medium text-white/45"
      >
        {line}
      </p>
      <style>{`
        @keyframes clipFade { from { opacity: 0; transform: translateY(4px) } to { opacity: 1; transform: none } }
      `}</style>
    </>
  );
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
  const retriesSpent = Number(attempts) >= 2;

  return (
    <div className="absolute inset-0 grid place-items-center px-8 text-center">
      <div>
        <p className="text-[13.5px] font-semibold text-white/85">
          {retriesSpent ? 'This concept still didn’t render' : 'This concept didn’t render'}
        </p>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-white/45">
          {retriesSpent
            ? 'We tried twice. Try another storyboard — the other concepts are unaffected.'
            : error || 'Something went wrong on the way to a clip.'}
        </p>
        <div className="mt-4 flex items-center justify-center gap-2">
          {onRetry && !retriesSpent && <RetryCountdownButton onClick={onRetry} />}
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

/* ── the side panel ──────────────────────────────────────────────────────── */

/** A block heading, in the panel's own small-caps voice. */
function PanelLabel({ children, action }) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="text-[11px] font-semibold tracking-[0.08em] text-white/35 uppercase">
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
      <dt className="shrink-0 text-white/25">{label}</dt>
      <dd className="min-w-0 truncate font-medium text-white/60">{children}</dd>
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
function SidePanel({ title, angle, status, ready, src, clip, board, message }) {
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
        isVideo: true,
        prompt: board?.voiceover || board?.premise || title,
        item: { url: src, title, aiAds: { source: 'onboarding' } },
      },
    });

  // Only versions that actually produced something are listed. `version` is
  // upstream's own counter, so this is the truth about the clip rather than a
  // count of how many times somebody pressed a button.
  const versions = clip?.version ? [clip] : [];

  return (
    <>
      <aside
        className="flex w-[300px] shrink-0 flex-col gap-6 overflow-y-auto border-l p-5"
        style={{ background: CHROME, borderColor: LINE }}
      >
        <div>
          <PanelLabel>Send it out</PanelLabel>
          {ready ? (
            <div className="mt-3 flex flex-col gap-2">
              <PanelButton primary icon={Download} onClick={() => handleDownload(src)}>
                Download MP4
              </PanelButton>
              <PanelButton icon={Megaphone} onClick={openPostAd}>
                Post to ad account
              </PanelButton>
            </div>
          ) : (
            <p className="mt-2.5 text-[12.5px] leading-relaxed text-white/40">
              {status === 'failed'
                ? 'Nothing to send — this concept didn’t render.'
                : message || 'Ready in about a minute.'}
            </p>
          )}
        </div>

        <div>
          <PanelLabel>Versions</PanelLabel>
          <p className="mt-1 text-[11.5px] text-white/30">A new version never destroys this cut.</p>
          <div className="mt-3 flex flex-col gap-2">
            {versions.length ? (
              versions.map((v) => (
                <div
                  key={v.id || v.version}
                  className="flex items-center gap-2.5 rounded-lg border px-3 py-2.5"
                  style={{ background: SURF2, borderColor: 'rgba(21,220,255,0.3)' }}
                >
                  <Check size={14} className="shrink-0 text-[#15DCFF]" />
                  <span className="text-[12.5px] font-semibold text-[#15DCFF]">
                    v{v.version} · current
                  </span>
                  {v.model && (
                    <span className="ml-auto truncate font-mono text-[9.5px] text-white/25">
                      {v.model}
                    </span>
                  )}
                </div>
              ))
            ) : (
              <p className="text-[12.5px] text-white/40">No cut yet.</p>
            )}
          </div>
        </div>

        {/* The concept itself, in the space the two blocks above leave behind.
            `mt-auto` rather than a fixed position: on a short viewport it sits
            straight under Versions, and on a tall one it settles at the bottom
            instead of leaving a column of nothing. */}
        <div className="mt-auto border-t pt-5" style={{ borderColor: LINE }}>
          <PanelLabel>This concept</PanelLabel>

          <h2 className="mt-2.5 text-[14px] leading-snug font-semibold text-white">{title}</h2>

          {angle && (
            <p className="mt-1.5 text-[12px] leading-relaxed text-white/40">{angle}</p>
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
            <p className="mt-3 text-[12px] leading-relaxed text-white/35">
              <span className="text-white/25">Camera · </span>
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
            <Meta label="Ratio">9:16</Meta>
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
 * @param onFinish    leave onboarding for the studio
 */
export default function ClipView({
  board,
  index,
  state = {},
  onBack,
  onRetry,
  onStartOver,
  onFinish,
}) {
  const status = state.status || 'running';
  const clip = state.video?.video || null;

  // `src` is resolved server-side — durable media store first, this API's own
  // 24h copy as the fallback, and never a link that claims to be an image — so
  // the player does not have to know which of the two exists.
  const src = clip?.src || clip?.url || clip?.local_url || '';

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

  return (
    <div className="flex h-screen flex-col" style={{ background: '#0f0f0f' }}>
      <Header onStartOver={onStartOver} onFinish={onFinish} />

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

      <div className="flex min-h-0 flex-1">
        <div className="grid min-h-0 flex-1 place-items-center p-5">
          {ready ? (
            // The app's player, not a bare `<video>`: play, scrub, speed, PiP,
            // fullscreen and its own download, identical to every other clip in
            // the product.
            <CustomVideoPlayer src={src} aspect="ASPECT_9_16_FULL" />
          ) : (
            <Frame>
              {status === 'failed' ? (
                <FailedStage
                  error={state.error}
                  onRetry={onRetry}
                  onBack={onBack}
                  attempts={state.attempts}
                />
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

        <SidePanel
          title={title}
          angle={angle}
          status={status}
          ready={ready}
          src={src}
          clip={clip}
          board={board}
          message={state.message}
        />
      </div>

      <footer
        className="flex h-14 shrink-0 items-center justify-between border-t px-5"
        style={{ background: CHROME, borderColor: LINE }}
      >
        <p className="text-[12.5px] text-white/35">
          {ready
            ? 'Your first clip is ready.'
            : status === 'failed'
              ? 'Nothing rendered for this concept.'
              : state.message || 'Rendering — this usually takes about a minute.'}
        </p>
      </footer>
    </div>
  );
}
