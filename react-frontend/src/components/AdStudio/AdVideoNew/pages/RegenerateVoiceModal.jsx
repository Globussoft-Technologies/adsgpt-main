import { useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Mic, Languages, PenLine, Loader2, Music2, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import VoiceSelector from '@/components/VoiceSelector/VoiceSelector';
import CommonDropdown from '@/components/common/AdPrompt/CommonDropdown';
import { labelForLanguage } from '@/apis/voiceSelector/voiceSelectorApi';
import {
  regenerateAiAdsVoiceAction,
  previewRegenerateScriptAction,
  finalMergeAiAdsVoiceAction,
  discardAiAdsVoicePreviewAction,
} from '@/store/actions/adVideoNew/Advideoactions';
import {
  setAiAdsRegenState,
  clearAiAdsTranslateScript,
  clearAiAdsVoicePreview,
} from '@/store/reducers/adStudio/adVideoNewSlice';

const S3_BASE_URL = (import.meta.env.VITE_S3_BASE_URL || '').replace(/\/$/, '');

const resolveMediaUrl = (url) => {
  if (!url || typeof url !== 'string') return '';
  if (/^(https?:)?\/\//i.test(url) || url.startsWith('blob:') || url.startsWith('data:')) {
    return url;
  }
  return S3_BASE_URL ? `${S3_BASE_URL}/${url.replace(/^\/+/, '')}` : url;
};

// Curated translate targets (mock's set), labelled via the shared LANGUAGE_NAMES.
const TRANSLATE_LANG_CODES = ['en', 'hi', 'ta', 'te', 'mr', 'kn', 'gu', 'ml'];

const MODES = [
  { id: 'voice', label: 'New voice', icon: Mic },
  { id: 'translate', label: 'Translate', icon: Languages },
  { id: 'rewrite', label: 'Rewrite', icon: PenLine },
];

// Map the stored per-version voice ({voiceProvider,voiceId,voiceName,language})
// into the VoiceSelector value shape.
const seedVoice = (cv) => {
  const provider = cv?.provider || 'elevenlabs';
  return {
    provider,
    language: cv?.language || (provider === 'sarvam' ? 'en-IN' : 'en'),
    languageLabel: cv?.language ? labelForLanguage(cv.language) : 'English',
    gender: '',
    accent: '',
    age: '',
    voiceId: cv?.voiceId || '',
    voiceName: cv?.voiceName || '',
  };
};

const countWords = (t) => (t && t.trim() ? t.trim().split(/\s+/).length : 0);

const formatPreviewTime = (seconds) => {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = Math.floor(safeSeconds % 60);
  return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
};

// Trim the trailing ".xx" frame fraction off "0:02.88" → "0:02" for display.
const shortTs = (ts) => (typeof ts === 'string' ? ts.replace(/\.\d+$/, '') : ts);

/**
 * Regenerate-voice panel for a completed AI Ads video. Three modes:
 *  - voice     : pick any voice via the shared <VoiceSelector> (same script), 1-step
 *  - translate : 2-step — pick a language → preview the translated script (editable)
 *                → Generate. Python keeps the same voice.
 *  - rewrite   : one-click, new script in the same language + same voice (1-step)
 *
 * Translate flow:
 *   Step 1  POST /ai-ads/preview-regenerate-script → script arrives via socket
 *           'aiAdsTranslateScriptReady' (stored in redux aiAdsTranslateScript).
 *   Step 2  POST /ai-ads/regenerate-voice with the (edited) scenes → new version
 *           via socket 'aiAdsVoiceReady'.
 * Forwards Python's 400 already_in_language guard inline.
 */
export default function RegenerateVoiceModal({
  open,
  onOpenChange,
  sessionId,
  currentVoice,
}) {
  const dispatch = useDispatch();
  const [mode, setMode] = useState('voice');
  const [voice, setVoice] = useState(() => seedVoice(currentVoice));
  const [translateLang, setTranslateLang] = useState('');
  const [previewing, setPreviewing] = useState(false); // Step-1 in flight
  const [scenes, setScenes] = useState(null); // editable copy of previewed script
  const [submitting, setSubmitting] = useState(false); // Step-2 in flight
  const [langError, setLangError] = useState('');
  const [voiceError, setVoiceError] = useState('');
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  const [previewCurrentTime, setPreviewCurrentTime] = useState(0);
  const [previewDuration, setPreviewDuration] = useState(0);
  const [awaitingVoicePreview, setAwaitingVoicePreview] = useState(false);
  const [discardingPreview, setDiscardingPreview] = useState(false);
  const videoRef = useRef(null);
  const audioRef = useRef(null);

  // Preview script for this session (populated by the socket via redux).
  const preview = useSelector(
    (s) => s.adVideoNew.aiAdsTranslateScript?.[sessionId],
  );
  const voicePreview = useSelector(
    (s) => s.adVideoNew.aiAdsVoicePreview?.[sessionId],
  );

  const resetAll = () => {
    setMode('voice');
    setVoice(seedVoice(currentVoice));
    setTranslateLang('');
    setPreviewing(false);
    setScenes(null);
    setSubmitting(false);
    setLangError('');
    setVoiceError('');
    setIsPreviewPlaying(false);
    setPreviewCurrentTime(0);
    setPreviewDuration(0);
    setAwaitingVoicePreview(false);
    dispatch(clearAiAdsTranslateScript({ sessionId }));
    dispatch(clearAiAdsVoicePreview({ sessionId }));
  };

  // Re-seed each time the modal opens (or the source version changes).
  // NOTE: depend on the PRIMITIVE identity of currentVoice, not the object
  // reference. VideoCard rebuilds `currentVoice` as a fresh object literal on
  // every render, so depending on the object would re-run resetAll() on every
  // parent re-render (e.g. right after "Preview script"), wiping mode/scenes
  // and bouncing the modal back to "New voice". Keying on the actual values
  // makes it fire only when the modal opens or the source version truly changes.
  const currentVoiceKey = `${currentVoice?.provider || ''}|${currentVoice?.voiceId || ''}|${currentVoice?.voiceName || ''}|${currentVoice?.language || ''}`;
  useEffect(() => {
    if (!open) return;
    resetAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, currentVoiceKey]);

  // While a preview is in flight, watch the redux entry the socket fills.
  useEffect(() => {
    if (!previewing) return;
    if (preview?.scenes) {
      // Deep-copy into editable local state so edits don't mutate the store.
      // Capture each line's original `charCount` as its max-char limit — Python
      // only sends the current charCount (no maxChars), and word-count alone can
      // be bypassed by typing long text without spaces (it counts as one word).
      // Pinning maxChars to the generated length blocks that char-bloat on edit.
      const copied = JSON.parse(JSON.stringify(preview.scenes)).map((s) => ({
        ...s,
        script: (s.script || []).map((ln) => ({
          ...ln,
          maxChars:
            typeof ln.charCount === 'number' && ln.charCount > 0
              ? ln.charCount
              : (ln.text ? ln.text.length : 0),
        })),
      }));
      setScenes(copied);
      setPreviewing(false);
    } else if (preview?.error) {
      setLangError(preview.error);
      setPreviewing(false);
    }
  }, [preview, previewing]);

  useEffect(() => {
    if (!awaitingVoicePreview) return;
    if (voicePreview?.preview || voicePreview?.error) {
      setAwaitingVoicePreview(false);
    }
  }, [awaitingVoicePreview, voicePreview]);

  // Offer every curated language. We can't reliably filter out the ad's current
  // SCRIPT language — the stored `language` is the VOICE language, not the
  // script's — so we show all and let Python's already_in_language guard reject
  // a same-language pick if it ever matches.
  const langOptions = useMemo(
    () =>
      TRANSLATE_LANG_CODES.map((c) => ({
        value: c,
        label: labelForLanguage(c),
      })),
    [],
  );
  const selectedLangObj = translateLang
    ? { value: translateLang, label: labelForLanguage(translateLang) }
    : null;

  const keepVoice = () => ({
    voiceProvider: currentVoice?.provider || 'elevenlabs',
    voiceId: currentVoice?.voiceId || '',
    voiceName: currentVoice?.voiceName || '',
  });

  // ── Mode switching — clear any previewed script when leaving translate ──────
  const switchMode = (next) => {
    if (next === mode) return;
    setMode(next);
    setScenes(null);
    setPreviewing(false);
    setLangError('');
    setVoiceError('');
    dispatch(clearAiAdsTranslateScript({ sessionId }));
  };

  // ── STEP 1 (translate & rewrite): fetch the new script preview ──────────────
  // translate → regenType "translate" + translateLang (new language).
  // rewrite   → regenType "rewrite" (same language, fresh script — no language pick).
  const startPreview = async () => {
    if (mode === 'translate' && !translateLang) {
      setLangError('Please select a language.');
      return;
    }
    const inputs = {
      ...keepVoice(),
      regenType: mode, // 'translate' | 'rewrite'
      ...(mode === 'translate' ? { translateLang } : {}),
    };
    try {
      setLangError('');
      setScenes(null);
      dispatch(clearAiAdsTranslateScript({ sessionId }));
      setPreviewing(true); // set before awaiting — socket may arrive fast
      await dispatch(previewRegenerateScriptAction(sessionId, inputs));
      // Script arrives via socket → the useEffect above flips previewing off.
    } catch (e) {
      setPreviewing(false);
      if (e?.code === 'already_in_language') setLangError(e.message);
      // other errors already toasted by the thunk
    }
  };

  // ── Edit a script line (word-limit aware) ───────────────────────────────────
  const updateLine = (sceneIdx, lineIdx, text) => {
    setScenes((prev) => {
      if (!prev) return prev;
      const next = prev.map((s, si) => {
        if (si !== sceneIdx) return s;
        const script = (s.script || []).map((ln, li) =>
          li === lineIdx
            ? { ...ln, text, voice: text } // keep voice in sync with edited text
            : ln,
        );
        return { ...s, script };
      });
      return next;
    });
  };

  // A line is invalid if it's empty, over its word cap, OR over its char cap.
  // The char cap (maxChars = original generated length) catches the space-bypass
  // where long text typed without spaces counts as one "word" but bloats length.
  const lineInvalid = (ln) => {
    if (!ln.text || !ln.text.trim()) return true;
    if (ln.maxWords && countWords(ln.text) > ln.maxWords) return true;
    if (ln.maxChars && ln.text.length > ln.maxChars) return true;
    return false;
  };

  // Any invalid line blocks Generate.
  const scriptHasErrors = useMemo(() => {
    if (!Array.isArray(scenes)) return true;
    for (const s of scenes) {
      for (const ln of s.script || []) {
        if (lineInvalid(ln)) return true;
      }
    }
    return false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenes]);

  // ── STEP 2 (translate & rewrite): commit the (edited) script → regen voice ──
  // ALWAYS send regenType "voice" here (NOT "translate"/"rewrite"). The script is
  // already generated in Step 1; "voice" makes regenerate_voice skip all script
  // generation and voice the submitted scenes verbatim, preserving the user's
  // edits. Re-sending "translate"/"rewrite" would re-run Gemini and paraphrase
  // over the edits.
  //   • translate → output language changed → voiced with Sarvam (forced).
  //   • rewrite   → same language → keep the original voice/provider as-is.
  const submitScript = async () => {
    if (scriptHasErrors) return;
    // Both translate & rewrite KEEP the original video's voice/provider. Python
    // supports translating with either engine (voiceProvider is honored as-is —
    // "elevenlabs" is the default, "sarvam" branches), so a video made with
    // ElevenLabs is re-voiced with ElevenLabs, and a Sarvam one with Sarvam.
    const inputs = {
      ...keepVoice(),
      regenType: 'voice',
      sourceRegenType: mode,
      ...(mode === 'translate' ? { translateLang } : {}),
      scenes,
    };
    try {
      setSubmitting(true);
      setAwaitingVoicePreview(true);
      dispatch(clearAiAdsVoicePreview({ sessionId }));
      // Optimistic overlay before awaiting (socket may beat the await).
      dispatch(setAiAdsRegenState({ sessionId, regenState: 'processing' }));
      await dispatch(regenerateAiAdsVoiceAction(sessionId, inputs));
      dispatch(clearAiAdsTranslateScript({ sessionId }));
    } catch (e) {
      setAwaitingVoicePreview(false);
      dispatch(setAiAdsRegenState({ sessionId, regenState: 'idle' }));
      if (e?.code === 'already_in_language') setLangError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  // ── voice (1-step) — pick a voice, same script, apply immediately ───────────
  const submitVoice = async () => {
    const provider = voice.provider || 'elevenlabs';
    const hasVoice = provider === 'sarvam' ? !!voice.voiceName : !!voice.voiceId;
    if (!hasVoice) {
      setVoiceError('Please pick a voice.');
      return;
    }
    const inputs = {
      voiceProvider: provider,
      voiceId: provider === 'elevenlabs' ? voice.voiceId || '' : '',
      voiceName: voice.voiceName || '',
      regenType: 'voice',
      translateLang: '',
    };
    try {
      setSubmitting(true);
      setAwaitingVoicePreview(true);
      setLangError('');
      dispatch(clearAiAdsVoicePreview({ sessionId }));
      dispatch(setAiAdsRegenState({ sessionId, regenState: 'processing' }));
      await dispatch(regenerateAiAdsVoiceAction(sessionId, inputs));
    } catch (e) {
      setAwaitingVoicePreview(false);
      dispatch(setAiAdsRegenState({ sessionId, regenState: 'idle' }));
      if (e?.code === 'already_in_language') setLangError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const acceptVoicePreview = async () => {
    if (!voicePreview?.preview) return;
    try {
      setSubmitting(true);
      dispatch(setAiAdsRegenState({ sessionId, regenState: 'processing' }));
      await dispatch(finalMergeAiAdsVoiceAction(sessionId, voicePreview.preview));
      dispatch(clearAiAdsVoicePreview({ sessionId }));
      onOpenChange(false);
    } catch {
      dispatch(setAiAdsRegenState({ sessionId, regenState: 'idle' }));
    } finally {
      setSubmitting(false);
    }
  };

  const discardVoicePreview = async () => {
    try {
      setDiscardingPreview(true);
      await dispatch(discardAiAdsVoicePreviewAction(sessionId));
      dispatch(clearAiAdsVoicePreview({ sessionId }));
      setScenes(null);
      setIsPreviewPlaying(false);
      setPreviewCurrentTime(0);
      setPreviewDuration(0);
      return true;
    } catch {
      return false;
    } finally {
      setDiscardingPreview(false);
    }
  };

  const discardAndClose = async () => {
    if (discardingPreview) return;
    const discarded = await discardVoicePreview();
    if (discarded) onOpenChange(false);
  };

  const syncAudio = () => {
    if (audioRef.current && videoRef.current) audioRef.current.currentTime = videoRef.current.currentTime;
  };

  const togglePreview = async () => {
    const player = videoRef.current || audioRef.current;
    if (!player) return;
    if (player.paused) {
      syncAudio();
      await player.play();
      if (player === videoRef.current) await audioRef.current?.play();
    } else {
      player.pause();
      audioRef.current?.pause();
    }
  };

  const seekPreview = (event) => {
    const nextTime = Number(event.target.value);
    if (!Number.isFinite(nextTime)) return;
    if (audioRef.current) audioRef.current.currentTime = nextTime;
    if (videoRef.current) videoRef.current.currentTime = nextTime;
    setPreviewCurrentTime(nextTime);
  };
  const busy = previewing || submitting || awaitingVoicePreview || discardingPreview;

  // Close policy:
  //  • Outside-click / Esc → ALWAYS blocked (user must use Cancel/✕ to leave).
  //  • While busy (preview or generate in flight) → block ALL close paths until
  //    the socket result arrives, so an in-flight request isn't abandoned.
  // Radix routes every close (✕, Esc, overlay click) through onOpenChange(false);
  // we swallow the false while busy. The interaction handlers below additionally
  // preventDefault outside-click/Esc so they never close, busy or not.
  const guardedOpenChange = (next) => {
    if (next === false) {
      if (!busy) void discardAndClose();
      return;
    }
    onOpenChange(true);
  };
  const blockOutsideClose = (e) => e.preventDefault();

  if (voicePreview?.preview) {
    const previewAsset = voicePreview.preview;
    const previewVideoUrl = resolveMediaUrl(previewAsset.videoUrl);
    const previewAudioUrl = resolveMediaUrl(previewAsset.audioUrl);
    const audioFileName = decodeURIComponent(
      String(previewAsset.audioUrl || '').split('/').pop() || 'Regenerated voice.mp3',
    );
    const totalPreviewDuration = previewDuration || Number(previewAsset.duration) || 0;
    return (
      <Dialog open={open} onOpenChange={guardedOpenChange}>
        <DialogContent
          className="flex h-[min(85vh,760px)] flex-col overflow-hidden border-black/10 bg-white text-gray-900 sm:max-w-2xl dark:border-white/10 dark:bg-[#1C1C1F] dark:text-white"
          showCloseButton={!busy}
          onPointerDownOutside={blockOutsideClose}
          onInteractOutside={blockOutsideClose}
          onEscapeKeyDown={blockOutsideClose}
        >
          <DialogHeader>
            <DialogTitle>Preview regenerated voice</DialogTitle>
            <DialogDescription>Review the new voice before creating the final video version.</DialogDescription>
          </DialogHeader>
          {previewVideoUrl ? (
            <video
              ref={videoRef}
              src={previewVideoUrl}
              muted
              playsInline
              className="min-h-0 w-full flex-1 rounded-lg bg-black object-contain"
              onPlay={() => { setIsPreviewPlaying(true); syncAudio(); audioRef.current?.play(); }}
              onPause={() => { setIsPreviewPlaying(false); audioRef.current?.pause(); }}
              onSeeked={syncAudio}
              onEnded={() => audioRef.current?.pause()}
            />
          ) : (
            <div className="flex min-h-0 flex-1 items-center justify-center rounded-lg bg-black/5 text-sm text-gray-500 dark:bg-white/5 dark:text-white/60">
              Video preview is unavailable. You can still listen to the regenerated audio.
            </div>
          )}
          <audio
            ref={audioRef}
            src={previewAudioUrl}
            onLoadedMetadata={(event) => setPreviewDuration(event.currentTarget.duration || 0)}
            onTimeUpdate={(event) => setPreviewCurrentTime(event.currentTarget.currentTime || 0)}
            onPlay={() => setIsPreviewPlaying(true)}
            onPause={() => setIsPreviewPlaying(false)}
            onEnded={() => { setIsPreviewPlaying(false); videoRef.current?.pause(); }}
          />
          <div className="rounded-lg border border-black/10 bg-black/[0.03] p-3 dark:border-white/10 dark:bg-white/5">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-900 text-white dark:bg-white dark:text-black">
                <Music2 className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-gray-500 dark:text-white/55">Regenerated voice audio</p>
                <p className="truncate text-sm font-semibold text-gray-900 dark:text-white">{audioFileName}</p>
              </div>
              <span className="shrink-0 text-xs tabular-nums text-gray-500 dark:text-white/55">
                {formatPreviewTime(previewCurrentTime)} / {formatPreviewTime(totalPreviewDuration)}
              </span>
            </div>
            <input
              type="range"
              min="0"
              max={Math.max(totalPreviewDuration, 0)}
              step="0.1"
              value={Math.min(previewCurrentTime, totalPreviewDuration || previewCurrentTime)}
              onChange={seekPreview}
              disabled={!totalPreviewDuration}
              aria-label="Voice preview position"
              className="mt-3 h-1.5 w-full cursor-pointer accent-gray-900 disabled:cursor-not-allowed dark:accent-white"
            />
          </div>
          <button type="button" onClick={togglePreview} className="rounded-md border border-black/20 px-4 py-2 text-sm font-semibold dark:border-white/20">
            {isPreviewPlaying ? 'Pause preview' : 'Preview'}
          </button>
          <DialogFooter>
            <button type="button" onClick={discardVoicePreview} disabled={busy} className="rounded-md border border-black/20 px-4 py-2 text-sm font-medium disabled:opacity-50 dark:border-white/20">Try again</button>
            <button type="button" onClick={acceptVoicePreview} disabled={busy} className="rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-black">{submitting ? 'Merging…' : 'Accept & merge'}</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }
  if (voicePreview?.error) {
    return (
      <Dialog open={open} onOpenChange={guardedOpenChange}>
        <DialogContent
          className="border-black/10 bg-white text-gray-900 sm:max-w-2xl dark:border-white/10 dark:bg-[#1C1C1F] dark:text-white"
          showCloseButton={!busy}
          onPointerDownOutside={blockOutsideClose}
          onInteractOutside={blockOutsideClose}
          onEscapeKeyDown={blockOutsideClose}
        >
          <DialogHeader>
            <DialogTitle>Voice preview failed</DialogTitle>
            <DialogDescription>{voicePreview.error}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button type="button" onClick={discardVoicePreview} className="rounded-md border border-black/20 px-4 py-2 text-sm font-medium dark:border-white/20">
              Try again
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }
  // translate & rewrite are both 2-step (preview → review/edit → generate).
  if (awaitingVoicePreview) {
    const loadingMessage =
      mode === 'translate'
        ? 'Generating the translated voice preview…'
        : mode === 'rewrite'
          ? 'Generating the rewritten voice preview…'
          : 'Generating your new voice preview…';

    return (
      <Dialog open={open} onOpenChange={guardedOpenChange}>
        <DialogContent
          className="flex h-[min(85vh,760px)] flex-col overflow-hidden border-black/10 bg-white text-gray-900 sm:max-w-2xl dark:border-white/10 dark:bg-[#1C1C1F] dark:text-white"
          showCloseButton={false}
          onPointerDownOutside={blockOutsideClose}
          onInteractOutside={blockOutsideClose}
          onEscapeKeyDown={blockOutsideClose}
        >
          <DialogHeader>
            <DialogTitle>Preparing voice preview</DialogTitle>
            <DialogDescription>{loadingMessage}</DialogDescription>
          </DialogHeader>
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            <div className="flex min-h-0 flex-1 items-center justify-center rounded-lg border border-black/10 bg-black/[0.03] dark:border-white/10 dark:bg-white/5">
              <div className="flex flex-col items-center gap-3 text-gray-500 dark:text-white/60">
                <Loader2 className="h-7 w-7 animate-spin" />
                <p className="text-sm">Video preview is being prepared…</p>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-lg border border-black/10 bg-black/[0.03] p-3 dark:border-white/10 dark:bg-white/5">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-200 dark:bg-white/10">
                <Music2 className="h-4 w-4 animate-pulse" />
              </div>
              <div className="flex-1 space-y-2">
                <div className="h-2.5 w-32 animate-pulse rounded bg-gray-200 dark:bg-white/10" />
                <div className="h-1.5 w-full animate-pulse rounded bg-gray-200 dark:bg-white/10" />
              </div>
            </div>
          </div>
          <p className="text-center text-xs text-gray-500 dark:text-white/50">
            Keep this window open. The preview will appear here automatically.
          </p>
        </DialogContent>
      </Dialog>
    );
  }

  const isScriptMode = mode === 'translate' || mode === 'rewrite';

  // Switch to the full step screen the moment the preview is fired (previewing)
  // OR once the script has arrived (scenes). This opens the card immediately on
  // click and shows a loader inside it until the socket delivers the script —
  // instead of loading on the compact view and then jarringly swapping cards.
  const scriptReady = Array.isArray(scenes);
  const onScriptStep = isScriptMode && (previewing || scriptReady);

  // Back from the script step → discard the preview, return to the pre-preview
  // view (language pick for translate, or the rewrite intro). Also cancels the
  // loading state so Back works even while the script is still being generated
  // (a late socket result is ignored because previewing is false — see the
  // preview useEffect guard).
  const backToStart = () => {
    setPreviewing(false);
    setScenes(null);
    setLangError('');
    dispatch(clearAiAdsTranslateScript({ sessionId }));
  };

  // Rewrite keeps the SAME script language — but we don't reliably know what
  // that is (voiceFilters.language is the VOICE language, not the script's), so
  // we don't name it. Translate always shows the chosen target language.
  const stepTitle =
    mode === 'translate'
      ? `Translated script — ${labelForLanguage(translateLang)}`
      : 'Rewritten script';

  // ── Full step screen: review/edit the new script, then Generate ─────────────
  if (onScriptStep) {
    return (
      <Dialog open={open} onOpenChange={guardedOpenChange}>
        <DialogContent
          className="flex max-h-[85vh] flex-col gap-0 border-black/10 bg-white p-0 text-gray-900 sm:max-w-2xl dark:border-white/10 dark:bg-[#1C1C1F] dark:text-white"
          showCloseButton={false}
          onPointerDownOutside={blockOutsideClose}
          onInteractOutside={blockOutsideClose}
          onEscapeKeyDown={blockOutsideClose}
        >
          <div className="flex items-start justify-between border-b border-black/10 px-6 py-4 dark:border-white/5">
            <div>
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">
                {stepTitle}
              </h2>
              <p className="mt-0.5 text-xs text-gray-500 dark:text-white/55">
                Review and edit the script. The same voice is kept. Then Generate the new version.
              </p>
            </div>
            {/* Custom close (✕) — always present on the step screen, disabled
                while a preview/generate is in flight (until the socket result). */}
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              disabled={busy}
              aria-label="Close"
              className="shrink-0 rounded-sm p-1 text-gray-500 opacity-70 transition hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-30 dark:text-white/70 dark:hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto px-6 py-4">
            {/* Loading state — card is open immediately on click; the script
                fills in when the socket delivers it. */}
            {!scriptReady ? (
              <div className="flex h-40 flex-col items-center justify-center gap-3 text-gray-500 dark:text-white/55">
                <Loader2 className="h-6 w-6 animate-spin" />
                <p className="text-sm">
                  {mode === 'translate'
                    ? `Generating the ${labelForLanguage(translateLang)} script…`
                    : 'Writing a fresh script…'}
                </p>
              </div>
            ) : (
              scenes.map((s, si) =>
                (s.script || []).map((ln, li) => {
                  const words = countWords(ln.text);
                  const chars = ln.text ? ln.text.length : 0;
                  const overWords = ln.maxWords && words > ln.maxWords;
                  const overChars = ln.maxChars && chars > ln.maxChars;
                  const empty = !ln.text || !ln.text.trim();
                  const invalid = empty || overWords || overChars;
                  return (
                    <div key={`${si}-${ln.id ?? li}`} className="flex gap-3">
                      {/* Show the line's time RANGE (start → end), matching the
                          socket payload, not just the start. */}
                      <span className="mt-2.5 w-20 shrink-0 text-right text-xs tabular-nums leading-tight text-gray-400 dark:text-white/40">
                        {shortTs(ln.start)}
                        {ln.end ? (
                          <>
                            {' – '}
                            {shortTs(ln.end)}
                          </>
                        ) : null}
                      </span>
                      <div className="flex-1">
                        <textarea
                          rows={2}
                          value={ln.text}
                          onChange={(e) => updateLine(si, li, e.target.value)}
                          className={`w-full resize-none rounded-lg border bg-gray-100 px-3 py-2 text-sm text-gray-900 outline-none dark:bg-[#909294]/15 dark:text-white ${
                            invalid
                              ? 'border-red-500'
                              : 'border-black/10 focus:border-black/20 dark:border-white/5 dark:focus:border-white/20'
                          }`}
                        />
                        {(ln.maxWords || ln.maxChars) && (
                          <div className="mt-1 flex gap-3 text-[11px]">
                            {ln.maxWords ? (
                              <span className={overWords ? 'text-red-500' : 'text-gray-400 dark:text-white/40'}>
                                {words}/{ln.maxWords} words
                              </span>
                            ) : null}
                            {ln.maxChars ? (
                              <span className={overChars ? 'text-red-500' : 'text-gray-400 dark:text-white/40'}>
                                {chars}/{ln.maxChars} chars
                              </span>
                            ) : null}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                }),
              )
            )}
            {langError && <p className="text-sm text-red-500">{langError}</p>}
          </div>

          <div className="flex items-center justify-between border-t border-black/10 px-6 py-4 dark:border-white/5">
            <button
              type="button"
              onClick={backToStart}
              disabled={busy}
              className="rounded-md border border-black/20 px-4 py-2 text-sm font-medium text-gray-900 transition hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/20 dark:text-white dark:hover:bg-white/5"
            >
              ← Back
            </button>
            <button
              type="button"
              onClick={submitScript}
              disabled={busy || !scriptReady || scriptHasErrors}
              className="rounded-md border border-black/20 bg-gray-900 px-5 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/20 dark:bg-white dark:text-black"
            >
              {submitting ? 'Starting…' : 'Generate'}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // ── Compact modal: mode select + (voice picker | language pick | rewrite) ────
  return (
    <Dialog open={open} onOpenChange={guardedOpenChange}>
      <DialogContent
        className="overflow-visible border-black/10 bg-white text-gray-900 sm:max-w-xl dark:border-white/10 dark:bg-[#1C1C1F] dark:text-white"
        showCloseButton={!busy}
        onPointerDownOutside={blockOutsideClose}
        onInteractOutside={blockOutsideClose}
        onEscapeKeyDown={blockOutsideClose}
      >
        <DialogHeader>
          <DialogTitle>Regenerate voice-over</DialogTitle>
          <DialogDescription>
            Redo the voice-over without re-rendering the video. Your original stays saved as a version.
          </DialogDescription>
        </DialogHeader>

        {/* Mode selector */}
        <div className="flex gap-2">
          {MODES.map((m) => {
            const Icon = m.icon;
            const active = mode === m.id;
            return (
              <button
                key={m.id}
                type="button"
                disabled={busy}
                onClick={() => switchMode(m.id)}
                className={`flex flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${
                  active
                    ? 'border-transparent bg-gray-900 text-white dark:bg-white dark:text-black'
                    : 'border-black/10 text-gray-600 hover:bg-black/5 dark:border-white/10 dark:text-white/70 dark:hover:bg-white/5 dark:hover:text-white'
                }`}
              >
                <Icon size={16} />
                {m.label}
              </button>
            );
          })}
        </div>

        {/* Mode content */}
        <div className="min-h-24 py-1">
          {mode === 'voice' && (
            <VoiceSelector value={voice} onChange={setVoice} error={voiceError} />
          )}

          {mode === 'translate' && (
            <div className="flex flex-col gap-3">
              {/* Step 1: script-language pick. Once the script arrives, the
                  component swaps to the full step screen (see onScriptStep). */}
              <p className="text-xs text-gray-500 dark:text-white/55">
                Pick the script language you want. The video and voice stay the same — only the
                spoken script changes to the chosen language.
              </p>
              <CommonDropdown
                label="Script language"
                options={langOptions}
                value={selectedLangObj}
                onChange={(v) => {
                  setTranslateLang(v);
                  setLangError('');
                }}
                side="bottom"
              />
              {langError && <p className="text-xs text-red-500">{langError}</p>}
              {previewing && (
                <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-white/55">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Generating the {labelForLanguage(translateLang)} script…
                </div>
              )}
            </div>
          )}

          {mode === 'rewrite' && (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-gray-600 dark:text-white/70">
                We&apos;ll write a fresh script in the same language and keep the current voice.
                You can review and edit it before generating.
              </p>
              {previewing && (
                <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-white/55">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Writing a fresh script…
                </div>
              )}
              {langError && <p className="text-xs text-red-500">{langError}</p>}
            </div>
          )}
        </div>

        <DialogFooter>
          <button
            type="button"
            onClick={discardAndClose}
            disabled={busy}
            className="rounded-md border border-black/20 px-4 py-2 text-sm font-medium text-gray-900 transition hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/20 dark:text-white dark:hover:bg-white/5"
          >
            Cancel
          </button>

          {/* Voice mode → 1-step apply */}
          {mode === 'voice' && (
            <button
              type="button"
              onClick={submitVoice}
              disabled={busy}
              className="rounded-md border border-black/20 bg-gray-900 px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/20 dark:bg-white dark:text-black"
            >
              {submitting ? 'Starting…' : 'Apply new voice'}
            </button>
          )}

          {/* Translate & Rewrite → Step 1: Preview script. Once the script
              arrives, the component swaps to the full step screen for
              review/edit + Generate. Translate needs a language first. */}
          {isScriptMode && (
            <button
              type="button"
              onClick={startPreview}
              disabled={busy || (mode === 'translate' && !translateLang)}
              className="rounded-md border border-black/20 bg-gray-900 px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/20 dark:bg-white dark:text-black"
            >
              {previewing ? 'Generating…' : 'Preview script'}
            </button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
