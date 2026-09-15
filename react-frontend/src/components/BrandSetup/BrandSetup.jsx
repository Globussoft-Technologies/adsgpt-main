import { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Check, FileText, Link2, Loader2, Paperclip, X } from 'lucide-react';
import { initOnboarding } from '@/apis/onboarding/onboardingApi';
import AdsGPTLogo from '@/assets/layouts/adsgpt-logo.webp';
import { cn } from '@/lib/utils';
import ReasoningStack from './ReasoningStack';
import { rememberRun, clearRun } from './runStorage';
import { resetRun, runFailed } from '@/store/reducers/brandSetup/brandSetupSlice';

// ── A run that stops moving ─────────────────────────────────────────────────
// DS can hang mid-run (seen 2026-09-15 stuck at `merging`). Measured from the
// last sign of progress — a new step or a higher percent — not from the start,
// so a long but moving run never trips it. User decisions 2026-09-15:
//   SLOW_AFTER_MS   reassure: "Taking longer than usual — still working"
//   STALL_AFTER_MS  give up: "This is taking too long" + Try again / Skip
const SLOW_AFTER_MS = 90_000;
const STALL_AFTER_MS = 3 * 60_000;
// The error value that marks a stall, so the failed screen can word it apart
// from a genuine failure.
const STALLED = 'stalled';

// Served from S3, not bundled. The file is 14.4 MB — importing it made it a
// build artefact that every deploy re-uploaded and every visitor fetched from
// our own origin, for a decorative backdrop. The key is content-addressed and
// the object is immutable-cached for a year, so a new backdrop means a new key
// rather than a cache-bust.
const BackdropVideo = `${import.meta.env.VITE_S3_BASE_URL}/static/onboarding/onboarding-backdrop-7b077029.mp4`;

/**
 * Brand setup — the first screen of the creative-studio flow.
 *
 * One input, three kinds of input. The backend (`POST /onboarding/init`) accepts
 * a URL, free text, and files in any combination, so the UI does not ask the
 * user which one they are giving us — they type or paste whatever they have and
 * we sort it out on submit. That is why there is no mode switch and no "enter
 * details manually" escape hatch: the escape hatch IS the field.
 *
 * The backdrop is video under one flat film, with no gradient overlays at all —
 * every soft-edged scrim we tried left a visible band across the footage. The
 * wordmark is the real asset the sidebar uses; the accent gradient on Analyze
 * is the house cyan→indigo from Layout.jsx. Type and card are pinned
 * light-on-dark rather than themed, since they always sit over footage where a
 * themed `text-foreground` would go black in light mode.
 *
 * Wired to `POST /onboarding/init`. That endpoint takes ONE text field and runs
 * its own URL extraction over it, so a pasted link is sent as prompt text like
 * anything else. On acceptance the run ids are persisted and handed to
 * `onStarted` — the progress screen is the next piece of work.
 */

// A logo, a couple of product shots, a brand deck. Matches the multer limits on
// the onboarding route so the user is told "no" here rather than after a 32MB
// upload has already gone out.
const MAX_FILES = 15;
const MAX_FILE_BYTES = 32 * 1024 * 1024;

const ACCEPTED = 'image/*,application/pdf';
const URL_PATTERN = /https?:\/\/[^\s<>"']+/gi;

// The clip opens on a curtain-style reveal. Plain `loop` restarts at 0, so that
// reveal replays on every pass and the backdrop reads as a slideshow rather
// than continuous footage. We seek past it instead — both on first play and on
// every loop — so the motion never resets visibly. Tune if the intro changes.
const VIDEO_START_SECONDS = 2.5;

const urlsFromText = (text) => [...new Set(String(text || '').match(URL_PATTERN) || [])];

const withoutUrls = (text, urls) =>
  urls
    .reduce((remaining, url) => remaining.split(url).join(' '), String(text || ''))
    .replace(/\s{2,}/g, ' ')
    .trim();

const urlLabel = (value) => {
  try {
    const parsed = new URL(value);
    return `${parsed.hostname.replace(/^www\./, '')}${parsed.pathname === '/' ? '' : parsed.pathname}`;
  } catch {
    return value;
  }
};

function FilePreview({ file, onRemove }) {
  const [previewUrl, setPreviewUrl] = useState('');
  const isImage = file.type.startsWith('image/');

  useEffect(() => {
    if (!isImage) return undefined;
    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file, isImage]);

  return (
    // `chipIn`: the thumbnail scales and fades in, so an add is visibly registered.
    <li className="group relative h-12 w-12 shrink-0 animate-[chipIn_220ms_ease-out] overflow-hidden rounded-lg border border-white/12 bg-white/[0.06]">
      {isImage && previewUrl ? (
        <img src={previewUrl} alt={file.name} className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-1 px-1 text-white/55">
          <FileText className="h-5 w-5" />
          <span className="w-full truncate text-center text-[9px]">{file.name}</span>
        </div>
      )}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${file.name}`}
        className="absolute top-1 right-1 grid h-5 w-5 place-items-center rounded-full border border-white/15 bg-black/75 text-white/75 opacity-100 transition hover:bg-black hover:text-white sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
      >
        <X className="h-3 w-3" />
      </button>
    </li>
  );
}

/**
 * @param onFailedReset  Called when the user backs out of a failed run. The
 *   host owns `phase`, so it has to be told the screen is a form again.
 */
/**
 * Placeholder + hint for the prompt, written for what the user has ALREADY
 * given. The old static text kept asking for a link after one was pasted and
 * for images after they were attached. Typed text hides the placeholder, so
 * only links and files decide it.
 */
function promptCopy({ hasUrl, fileCount }) {
  const images = `${fileCount} ${fileCount === 1 ? 'image' : 'images'} added`;
  if (hasUrl && fileCount) {
    return { placeholder: 'Anything else we should know? ', hint: 'All set — hit Analyze' };
  }
  if (hasUrl) {
    return {
      placeholder: 'Add a few words about your brand ',
      hint: 'Got your site. Images or a short description help sharpen it',
    };
  }
  if (fileCount) {
    return {
      placeholder: 'Add your website link or describe your brand',
      hint: `${images}. A link or description helps us get it right`,
    };
  }
  return {
    placeholder: 'Paste your website, describe your brand, or attach images',
    hint: 'You can mix all three — a link, a few words, and your images',
  };
}

/**
 * @param onSkip  Leave onboarding from this first screen. The host decides how
 *   to record it (with or without a session).
 */
const BrandSetup = ({ onStarted, resumed = false, onFailedReset, onSkip }) => {
  const dispatch = useDispatch();
  const [value, setValue] = useState('');
  const [urls, setUrls] = useState([]);
  const [files, setFiles] = useState([]);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Bumped on an empty Analyze click. A counter rather than a boolean so a
  // second empty click replays the shake (it is the `key` on the card).
  const [shakeCount, setShakeCount] = useState(0);
  // Set the moment the run is accepted. Drives the handoff: the form lifts away
  // and the reasoning stack takes its place, on the same screen — the video and
  // the film never blink, so it reads as one surface changing its mind rather
  // than a navigation.
  const [handedOff, setHandedOff] = useState(resumed);
  const run = useSelector((state) => state.brandSetup);
  const fileInputRef = useRef(null);
  const videoRef = useRef(null);
  // Held across retries: a failed attempt retried with the SAME key is replayed
  // upstream instead of starting a second run. Cleared once a run is accepted.
  const idempotencyKeyRef = useRef('');

  // What that key was minted FOR. Reusing a key is only correct while the
  // request is the same request — and the commonest reason a run fails is that
  // the prompt itself was the problem, so the retry the user actually wants is
  // an EDITED one. Sending the edit under the old key made upstream replay the
  // original: the change was accepted by the form and then silently discarded.
  const attemptSignatureRef = useRef('');

  // Skip the clip's opening reveal, on the first play and on every repeat.
  const skipVideoIntro = () => {
    const video = videoRef.current;
    if (!video) return;
    // Guard against a clip shorter than the offset, which would seek past the
    // end and stall on a frozen frame.
    if (video.duration > VIDEO_START_SECONDS) video.currentTime = VIDEO_START_SECONDS;
    // `ended` only fires without the `loop` attribute, so restart by hand.
    video.play().catch(() => {});
  };

  const addFiles = (incoming) => {
    const accepted = [];
    let rejected = '';

    for (const file of incoming) {
      if (file.size > MAX_FILE_BYTES) {
        rejected = `${file.name} is larger than 32 MB`;
        continue;
      }
      // Same name and size twice is a re-drop, not a second file.
      const duplicate = files.some((f) => f.name === file.name && f.size === file.size);
      if (!duplicate) accepted.push(file);
    }

    const room = MAX_FILES - files.length;
    if (accepted.length > room) rejected = `You can attach up to ${MAX_FILES} files`;

    setFiles((prev) => [...prev, ...accepted.slice(0, Math.max(room, 0))]);
    setError(rejected);
  };

  const removeFile = (index) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
    setError('');
  };

  const removeUrl = (url) => {
    setUrls((current) => current.filter((item) => item !== url));
    setError('');
  };

  const handlePaste = (event) => {
    const imageItems = Array.from(event.clipboardData?.items || []).filter(
      (item) => item.kind === 'file' && item.type.startsWith('image/')
    );
    const clipboardText = event.clipboardData?.getData('text/plain') || '';
    const pastedUrls = imageItems.length ? [] : urlsFromText(clipboardText);
    if (!imageItems.length && !pastedUrls.length) return;

    event.preventDefault();
    const pastedAt = Date.now();
    const pastedImages = imageItems
      .map((item, index) => {
        const image = item.getAsFile();
        if (!image) return null;
        const subtype = image.type.split('/')[1]?.split('+')[0] || 'png';
        const extension = subtype === 'jpeg' ? 'jpg' : subtype;
        return new File([image], `pasted-image-${pastedAt}-${index + 1}.${extension}`, {
          type: image.type,
          lastModified: pastedAt,
        });
      })
      .filter(Boolean);

    if (pastedImages.length) addFiles(pastedImages);

    if (pastedUrls.length) {
      setUrls([pastedUrls.at(-1)]);
      const description = withoutUrls(clipboardText, pastedUrls);
      if (description) {
        const input = event.currentTarget;
        const start = input.selectionStart ?? value.length;
        const end = input.selectionEnd ?? start;
        setValue((current) =>
          [current.slice(0, start).trimEnd(), description, current.slice(end).trimStart()]
            .filter(Boolean)
            .join(' ')
        );
      }
      setError('');
    }
  };

  const separateTypedUrls = () => {
    const typedUrls = urlsFromText(value);
    if (!typedUrls.length) return;
    setUrls([typedUrls.at(-1)]);
    setValue((current) => withoutUrls(current, typedUrls));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (submitting) return;

    // The backend requires a prompt or at least one file and answers 400
    // otherwise. Saying so here costs a round trip less than letting it.
    const typedUrls = urlsFromText(value);
    const website = typedUrls.at(-1) || urls[0] || '';
    const description = withoutUrls(value, typedUrls);
    const prompt = [website, description].filter(Boolean).join(' ');
    if (!prompt && files.length === 0) {
      setError('Add a link, a description, or an image to get started');
      // The dim button is still clickable; a click answers with motion on the
      // card, so the user's eye goes to where the input belongs.
      setShakeCount((n) => n + 1);
      return;
    }

    setError('');
    setSubmitting(true);

    // One key per attempt, reused only while the attempt is genuinely the same
    // one. File identity is name+size+mtime — enough to notice a swapped file
    // without reading any bytes.
    const signature = JSON.stringify([
      prompt,
      files.map((f) => `${f.name}:${f.size}:${f.lastModified}`),
    ]);
    if (!idempotencyKeyRef.current || attemptSignatureRef.current !== signature) {
      idempotencyKeyRef.current = crypto.randomUUID();
      attemptSignatureRef.current = signature;
    }

    try {
      const accepted = await initOnboarding({
        prompt,
        files,
        idempotencyKey: idempotencyKeyRef.current,
      });

      // Persist BEFORE handing off. If the next screen throws or the tab is
      // closed on the way there, the run is still recoverable.
      const startedRun = {
        jobId: accepted.job_id,
        sessionId: accepted.session_id,
        status: accepted.status,
        startedAt: Date.now(),
      };
      rememberRun(startedRun);
      idempotencyKeyRef.current = '';
      attemptSignatureRef.current = '';

      setHandedOff(true);
      onStarted?.(startedRun);
    } catch (requestError) {
      // The backend's messages are written for users ("That file is too large",
      // "a prompt or at least one attachment is required"), so show its own
      // words and only fall back when there are none.
      setError(
        requestError?.response?.data?.error || 'We could not start the analysis. Please try again.'
      );
      setSubmitting(false);
    }
  };

  const copy = promptCopy({
    // A link still sitting in the typed text counts too — it is split out on blur.
    hasUrl: urls.length > 0 || urlsFromText(value).length > 0,
    fileCount: files.length,
  });

  // Anything Analyze could send. Drives the button's lit/dim state — before this
  // the button looked identical empty and filled, so adding a link or an image
  // gave no sign the form was now ready.
  const ready = Boolean(value.trim()) || urls.length > 0 || files.length > 0;

  // ── Stall watch ──────────────────────────────────────────────────────────
  // Only while the thinking stack is up and the run is live. The clock resets
  // on every new step or percent bump; `slow` drives the reassurance line and
  // passing STALL_AFTER_MS fails the run with `STALLED`, which lands on the
  // failed screen whose Try again keeps the form's input.
  const [slow, setSlow] = useState(false);
  const progressSignal = `${run.steps?.length || 0}:${run.percent || 0}`;
  const lastProgressAt = useRef(Date.now());
  useEffect(() => {
    lastProgressAt.current = Date.now();
    setSlow(false);
  }, [progressSignal]);
  useEffect(() => {
    if (!handedOff || run.status !== 'running') {
      setSlow(false);
      return undefined;
    }
    const id = setInterval(() => {
      const idle = Date.now() - lastProgressAt.current;
      if (idle >= STALL_AFTER_MS) {
        dispatch(runFailed(STALLED));
      } else if (idle >= SLOW_AFTER_MS) {
        setSlow(true);
      }
    }, 5000);
    return () => clearInterval(id);
  }, [handedOff, run.status, dispatch]);

  // ── Glow pulse on each add ───────────────────────────────────────────────
  // Counts links + attachments; when the count GOES UP, bump `pulseCount`,
  // which re-keys the glow overlay on the card and replays its animation.
  // Removals and typing don't pulse — only a new item is news.
  const attachedCount = urls.length + files.length;
  const prevAttachedRef = useRef(attachedCount);
  const [pulseCount, setPulseCount] = useState(0);
  useEffect(() => {
    if (attachedCount > prevAttachedRef.current) setPulseCount((n) => n + 1);
    prevAttachedRef.current = attachedCount;
  }, [attachedCount]);

  return (
    <div className="bg-background text-foreground relative flex min-h-screen w-full flex-col overflow-hidden">
      {/* TRIAL — background video. Muted + playsInline so it starts on its own
          everywhere. No `loop` attribute on purpose: looping natively replays
          the clip's opening reveal, so `onEnded` restarts it past the intro
          instead (see VIDEO_START_SECONDS). Played at full brightness — the
          film below is what buys legibility, so the footage stays clear.
          Remove this block and the film to go back to a plain canvas. */}
      {/* HIDE-MARK — backdrop video off (user decision 2026-09-15: AdsGPT glow
          instead). To restore, put back the <video> (ref={videoRef}, src
          BackdropVideo, onLoadedMetadata/onEnded={skipVideoIntro}) and the
          `bg-black/55` film that sat over it.

          The AdsGPT glow: the same cyan→indigo blurred orb the app Layout uses,
          but centred BEHIND the form rather than rising from the bottom, so the
          light sits where the user is meant to look. Fixed dark ground under it. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 z-0 overflow-hidden bg-[#0f0f0f]">
        <div className="absolute top-1/2 left-1/2 h-[42vw] w-[42vw] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[linear-gradient(0deg,_#15DCFF_0%,_#5E66F5_100%)] opacity-45 blur-[120px] 2xl:blur-[160px]" />
      </div>

      <header className="relative z-10 flex items-center justify-between px-7 py-5">
        <img src={AdsGPTLogo} alt="AdsGPT" className="h-auto w-20 2xl:w-24" />
        {onSkip && (
          <button
            type="button"
            onClick={onSkip}
            className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-white/60 transition hover:text-white"
          >
            Skip for now
          </button>
        )}
      </header>

      <main className="relative z-10 flex flex-1 flex-col items-center justify-center px-6 pb-28">
        {/* Pinned white rather than themed — this type always sits over
            footage, where `text-foreground` would go black in light mode. No
            shadows: the flat film above already provides the contrast, and
            shadowed type over video looks smudged rather than crisp. */}
        {/* The heading stays put and only its words change — moving it would
            make the handoff read as two screens instead of one. */}
        <h1 className="text-center text-[32px] leading-tight font-bold tracking-tight text-white sm:text-[38px]">
          {handedOff ? 'Building your brand' : "Let's set up your brand"}
        </h1>
        <p className="mt-3 text-center text-[15px] text-white/90">
          {handedOff ? 'Reading the web, then putting it together' : 'Tell us about your brand'}
        </p>

        {/* One grid cell holds both, so the stack occupies the exact space the
            form vacates and nothing below it shifts. */}
        <div className="mt-7 grid w-full max-w-140 grid-cols-1 grid-rows-1">
          <form
            onSubmit={handleSubmit}
            style={{ gridArea: '1 / 1' }}
            className={cn(
              'w-full transition-all duration-[600ms] ease-[cubic-bezier(.16,1,.3,1)]',
              handedOff
                ? 'pointer-events-none -translate-y-8 scale-[0.97] opacity-0 blur-[3px]'
                : 'blur-0 translate-y-0 scale-100 opacity-100'
            )}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              addFiles(Array.from(e.dataTransfer.files || []));
            }}
          >
            {/* The edge is a 1px gradient rather than a flat border: brightest
              along the top where light would land, fading down the sides. A
              uniform hairline goes muddy over moving footage — one that catches
              light reads as a raised object no matter what is behind it. The
              wrapper IS the border; the inner div is the panel. */}
            <div
              // Re-keyed per empty click so the shake animation restarts.
              key={`card-${shakeCount}`}
              className={cn(
                'relative rounded-[20px] bg-linear-to-b p-px transition-all duration-300',
                shakeCount > 0 && 'animate-[brandShake_380ms_ease-in-out]',
                // The brand edge is always lit, not a focus state — it is the one
                // thing on the screen the user is meant to act on, so it reads as
                // the target from the first frame.
                'from-[#15DCFF]/80 via-[#5E66F5]/45 to-[#5E66F5]/20',
                'shadow-[0_0_0_4px_rgba(21,220,255,0.10),0_24px_70px_-20px_rgba(0,0,0,0.85)]',
                // Focus and drag intensify the same edge rather than introducing
                // a new one.
                'focus-within:from-[#15DCFF] focus-within:via-[#5E66F5]/70 focus-within:to-[#5E66F5]/35',
                'focus-within:shadow-[0_0_0_5px_rgba(21,220,255,0.16),0_24px_70px_-20px_rgba(0,0,0,0.85)]',
                dragging && 'from-[#15DCFF] via-[#15DCFF]/70 to-[#15DCFF]/35'
              )}
            >
              {/* Brief cyan pulse on the edge each time a link or image is added.
                  Keyed on `pulseCount` so every add replays it; opacity ends at
                  0, so it leaves nothing behind. */}
              {pulseCount > 0 && (
                <span
                  key={`glow-${pulseCount}`}
                  aria-hidden
                  className="pointer-events-none absolute -inset-px rounded-[20px] opacity-0 animate-[brandGlow_600ms_ease-out]"
                  style={{
                    boxShadow: '0 0 0 1.5px #15DCFF, 0 0 28px 6px rgba(21,220,255,0.45)',
                  }}
                />
              )}
              <div className="rounded-[19px] bg-[#101014]/85 p-2.5 backdrop-blur-2xl">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={submitting}
                    aria-label="Attach logo or product images"
                    className="ml-1 shrink-0 rounded-xl p-2 text-white/55 transition hover:bg-white/10 hover:text-[#15DCFF] disabled:pointer-events-none disabled:opacity-40"
                  >
                    <Paperclip className="h-[18px] w-[18px]" />
                  </button>

                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept={ACCEPTED}
                    className="hidden"
                    onChange={(e) => {
                      addFiles(Array.from(e.target.files || []));
                      // Lets the same file be re-picked after a remove.
                      e.target.value = '';
                    }}
                  />

                  {/* The placeholder is kept short on purpose: anything longer is
                  clipped by the Analyze button at this width, and a half-word
                  placeholder reads as a bug. The line under the card carries
                  the detail. */}
                  <input
                    type="text"
                    value={value}
                    onPaste={handlePaste}
                    onBlur={separateTypedUrls}
                    onChange={(e) => {
                      setValue(e.target.value);
                      setError('');
                    }}
                    placeholder={copy.placeholder}
                    // Locked while sending: an edit made mid-request would not
                    // be part of the run the user is about to watch.
                    disabled={submitting}
                    className="min-w-0 flex-1 truncate bg-transparent py-2.5 text-sm text-white placeholder:text-white/50 focus:outline-none disabled:opacity-50"
                  />

                  {/* Dim until there is something to send, lit once there is.
                    Still clickable while dim — an empty click shakes the card
                    and explains, rather than being a dead button. The only
                    truly disabled state is "already sending". */}
                  <button
                    type="submit"
                    disabled={submitting}
                    aria-disabled={!ready}
                    className={cn(
                      'flex shrink-0 items-center gap-2 rounded-xl px-6 py-2.5 text-sm font-semibold transition-all duration-300 disabled:cursor-not-allowed',
                      ready
                        ? 'text-white shadow-[0_0_18px_rgba(21,220,255,0.35)] hover:brightness-110'
                        : 'bg-white/[0.08] text-white/45 hover:bg-white/[0.12]'
                    )}
                    style={
                      ready
                        ? { backgroundImage: 'linear-gradient(90deg, #15DCFF 0%, #5E66F5 100%)' }
                        : undefined
                    }
                  >
                    {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                    {submitting ? 'Starting…' : 'Analyze'}
                  </button>
                </div>

                {(urls.length > 0 || files.length > 0) && (
                  // No rule above the row. It was drawing a hard edge across the
                  // composer for what is really a continuation of it — the
                  // attachments belong to the prompt, not to a section of their
                  // own.
                  <ul
                    className={cn(
                      'no-scrollbar mt-2.5 flex min-w-0 flex-wrap items-center gap-2 overflow-x-auto px-1 pb-0.5 transition-opacity',
                      // Attachments can't be removed mid-send either.
                      submitting && 'pointer-events-none opacity-50'
                    )}
                  >
                    {/* Images first, links after, whatever order they were added
                        in. The thumbnails are the substantial thing here and a
                        link that happened to be pasted first was pushing them
                        along the row; a fixed order means the row looks the same
                        every time rather than recording the sequence of clicks. */}
                    {files.map((file, index) => (
                      <FilePreview
                        key={`${file.name}-${file.size}-${file.lastModified}-${index}`}
                        file={file}
                        onRemove={() => removeFile(index)}
                      />
                    ))}

                    {urls.map((url) => (
                      // Not a pill. A pill says "one of several" and there is
                      // only ever one URL — the site being analysed — so it
                      // reads as plain text with its icon, the way the line
                      // above it does. The remove control stays: it is the only
                      // way to take the URL back out.
                      <li
                        key={url}
                        className="flex h-9 max-w-full min-w-0 animate-[chipIn_220ms_ease-out] items-center gap-1.5 pl-0.5 text-xs text-white/70"
                      >
                        <Link2 className="h-3.5 w-3.5 shrink-0 text-[#15DCFF]" />
                        <span className="min-w-0 flex-1 truncate" title={url}>
                          {urlLabel(url)}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeUrl(url)}
                          aria-label={`Remove ${url}`}
                          className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-white/40 transition hover:bg-white/10 hover:text-white"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            {/* The hint reacts to what was added: a ✓ and brighter text once
                there is something to send, and a short fade whenever the words
                change (keyed on the text) so the update is noticed. */}
            {(() => {
              const hintText = error || (submitting ? 'Sending to our analyst…' : copy.hint);
              const confirmed = !error && !submitting && attachedCount > 0;
              return (
                <p
                  key={hintText}
                  className={cn(
                    'mt-3.5 flex animate-[hintFade_260ms_ease-out] items-center justify-center gap-1.5 text-center text-[13px]',
                    error ? 'text-red-400' : confirmed ? 'text-white/90' : 'text-white/75'
                  )}
                >
                  {confirmed && <Check className="h-3.5 w-3.5 shrink-0 text-[#15DCFF]" aria-hidden />}
                  {hintText}
                </p>
              );
            })()}
            <style>{`
              @keyframes brandShake {
                0%, 100% { transform: translateX(0) }
                20% { transform: translateX(-7px) }
                40% { transform: translateX(6px) }
                60% { transform: translateX(-4px) }
                80% { transform: translateX(3px) }
              }
              @keyframes chipIn {
                from { opacity: 0; transform: scale(0.9) }
                to { opacity: 1; transform: scale(1) }
              }
              @keyframes brandGlow {
                0% { opacity: 0 }
                25% { opacity: 1 }
                100% { opacity: 0 }
              }
              @keyframes hintFade {
                from { opacity: 0; transform: translateY(2px) }
                to { opacity: 1; transform: none }
              }
            `}</style>
          </form>

          {/* Delayed a beat behind the form so the two never cross mid-flight. */}
          <div
            style={{ gridArea: '1 / 1', transitionDelay: handedOff ? '220ms' : '0ms' }}
            className={cn(
              'transition-all duration-[600ms] ease-[cubic-bezier(.16,1,.3,1)]',
              handedOff
                ? 'translate-y-0 scale-100 opacity-100'
                : 'pointer-events-none translate-y-6 scale-[0.98] opacity-0'
            )}
          >
            {/* The run died after it was accepted. Nothing used to render this:
                `runFailed` set a status in the store that no screen read, so
                the stack sat on "Building your brand" for ever with the poll
                already stopped — no error, no way back, only a reload.

                Returning to the form is the recovery, and it is the right one:
                the commonest cause is the prompt, and the form still holds it
                for editing. A changed prompt mints a fresh idempotency key, so
                the edit actually takes effect. */}
            {handedOff && run.status === 'failed' && (
              <div className="mx-auto max-w-md text-center">
                <p className="text-[14px] font-semibold text-white">
                  {run.error === STALLED
                    ? 'This is taking too long'
                    : 'We couldn’t finish reading your brand'}
                </p>
                <p className="mt-2 text-[13px] leading-relaxed text-white/55">
                  {run.error === STALLED
                    ? 'Our analyst seems stuck on your brand. Try again, or skip for now and come back later.'
                    : run.error || 'The analysis stopped before it finished.'}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    // Back to the form with everything still in it. `resetRun`
                    // clears the failed run so the stack does not reappear the
                    // moment the next attempt starts.
                    dispatch(resetRun());
                    clearRun();
                    setHandedOff(false);
                    setSubmitting(false);
                    onFailedReset?.();
                  }}
                  className="mt-5 rounded-lg bg-[linear-gradient(180deg,#9176ff_0%,#7c5cff_46%,#6148c7_100%)] px-4 py-2 text-[13px] font-bold text-white transition hover:brightness-110"
                >
                  Try again
                </button>
                <p className="mt-3 text-[12px] text-white/35">
                  Your prompt is still there — edit it if something looked wrong.
                </p>
              </div>
            )}

            {handedOff && run.status !== 'failed' && (
              <>
                <ReasoningStack
                  steps={run.steps}
                  percent={run.percent}
                  done={run.status === 'succeeded' || run.status === 'failed'}
                />
                {/* Reassurance after SLOW_AFTER_MS without progress. A line
                    under the stack, not a fake step — a step would count as
                    progress and reset the very clock that raised it. */}
                {slow && run.status === 'running' && (
                  <p className="mt-3 animate-pulse text-center text-[12.5px] text-white/60">
                    Taking longer than usual — still working
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
};

export default BrandSetup;
