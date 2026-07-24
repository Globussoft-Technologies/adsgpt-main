import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  AlertTriangle,
  Check,
  Info,
  Languages,
  Loader2,
  Music2,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  X,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import LockedVoiceCardSelector from '@/components/VoiceSelector/LockedVoiceCardSelector';
import CommonDropdown from '@/components/common/AdPrompt/CommonDropdown';
import {
  getSarvamVoices,
  getVoices,
  labelForLanguage,
} from '@/apis/voiceSelector/voiceSelectorApi';
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
const GLASS_DIALOG_CLASS =
  "border border-blue-300/20 bg-[radial-gradient(circle_at_78%_0%,rgba(47,86,145,0.28),transparent_42%),linear-gradient(145deg,rgba(25,27,31,0.90),rgba(8,11,16,0.84))] text-white shadow-[0_28px_100px_rgba(0,0,0,0.62),0_0_38px_rgba(59,130,246,0.08),inset_0_1px_0_rgba(255,255,255,0.09)] backdrop-blur-2xl backdrop-saturate-125";

const resolveMediaUrl = (url) => {
  if (!url || typeof url !== 'string') return '';
  if (/^(https?:)?\/\//i.test(url) || url.startsWith('blob:') || url.startsWith('data:')) {
    return url;
  }
  return S3_BASE_URL ? `${S3_BASE_URL}/${url.replace(/^\/+/, '')}` : url;
};

// Curated translate targets (mock's set), labelled via the shared LANGUAGE_NAMES.
const TRANSLATE_LANG_CODES = ['en', 'hi', 'ta', 'te', 'mr', 'kn', 'gu', 'ml'];

const normalizeTranslateLanguageCode = (language) => {
  const normalized = String(language || '')
    .trim()
    .toLowerCase();
  if (!normalized) return '';

  const baseCode = normalized.split(/[-_]/)[0];
  if (TRANSLATE_LANG_CODES.includes(baseCode)) return baseCode;

  const languageName = normalized.replace(/\s*\(.*\)\s*$/, '');
  return (
    TRANSLATE_LANG_CODES.find(
      (code) => labelForLanguage(code).toLowerCase() === languageName,
    ) || baseCode
  );
};

const ACTIONS = [
  {
    id: 'rewrite',
    number: 1,
    label: 'Recreate Script',
    description: 'Generate a fresh script using the current video context.',
    impact: 'Changes: script + voice-over',
    icon: RotateCcw,
  },
  {
    id: 'translate',
    number: 2,
    label: 'Translate Script',
    description: 'Translate the current script and create matching audio.',
    impact: 'Changes: language + voice-over',
    icon: Languages,
  },
  {
    id: 'voice',
    number: 3,
    label: 'Change Voice',
    description: 'Keep the exact script and choose a different narrator voice.',
    impact: 'Changes: voice only',
    icon: Music2,
  },
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

const normalizeVoiceLanguage = (language, provider) => {
  const baseLanguage = String(language || 'en')
    .trim()
    .toLowerCase()
    .split('-')[0];
  return provider === 'sarvam' ? `${baseLanguage}-IN` : baseLanguage;
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

const timestampToSeconds = (timestamp) => {
  if (typeof timestamp === 'number') return Number.isFinite(timestamp) ? timestamp : 0;
  if (typeof timestamp !== 'string' || !timestamp.trim()) return 0;
  const parts = timestamp.split(':').map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return 0;
  return parts.reduce((total, part) => total * 60 + part, 0);
};

/**
 * Regenerate-voice panel for a completed AI Ads video. Three modes:
 *  - voice     : shared voice selection → audio/video preview → merge
 *  - translate : language setup → editable script review → shared voice selection
 *                → audio/video preview → merge
 *  - rewrite   : recreate setup → editable script review → shared voice selection
 *                → audio/video preview → merge
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
  currentScenes = [],
  currentScriptLanguage = '',
}) {
  const dispatch = useDispatch();
  const [showActionSelector, setShowActionSelector] = useState(true);
  const [showVoiceSelection, setShowVoiceSelection] = useState(false);
  const [mode, setMode] = useState('voice');
  const [voice, setVoice] = useState(() => seedVoice(currentVoice));
  const [translateLang, setTranslateLang] = useState('');
  const [previewing, setPreviewing] = useState(false); // Step-1 in flight
  const [scenes, setScenes] = useState(null); // editable copy of previewed script
  const [submitting, setSubmitting] = useState(false); // Step-2 in flight
  const [langError, setLangError] = useState('');
  const [voiceError, setVoiceError] = useState('');
  const [defaultVoiceLoading, setDefaultVoiceLoading] = useState(false);
  const [translateVoiceAutoSelected, setTranslateVoiceAutoSelected] = useState(false);
  const [voiceSamplePlaying, setVoiceSamplePlaying] = useState(false);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  const [previewCurrentTime, setPreviewCurrentTime] = useState(0);
  const [previewDuration, setPreviewDuration] = useState(0);
  const [awaitingVoicePreview, setAwaitingVoicePreview] = useState(false);
  const [discardingPreview, setDiscardingPreview] = useState(false);
  const videoRef = useRef(null);
  const audioRef = useRef(null);
  const voiceSampleRef = useRef(null);

  const stopVoiceSample = useCallback(() => {
    const sample = voiceSampleRef.current;
    if (sample) {
      sample.pause();
      sample.currentTime = 0;
      sample.onended = null;
      sample.onerror = null;
      voiceSampleRef.current = null;
    }
    setVoiceSamplePlaying(false);
  }, []);

  // Preview script for this session (populated by the socket via redux).
  const preview = useSelector(
    (s) => s.adVideoNew.aiAdsTranslateScript?.[sessionId],
  );
  const voicePreview = useSelector(
    (s) => s.adVideoNew.aiAdsVoicePreview?.[sessionId],
  );
  const currentScriptLines = useMemo(
    () =>
      (currentScenes || []).flatMap((scene) =>
        (scene.script || []).map((line, lineIndex) => ({
          ...line,
          key: `${scene.segmentNumber ?? 'scene'}-${line.id ?? lineIndex}`,
        })),
      ),
    [currentScenes],
  );
  const approvedScriptLines = useMemo(
    () =>
      (scenes || []).flatMap((scene) =>
        (scene.script || []).map((line, lineIndex) => ({
          ...line,
          key: `${scene.segmentNumber ?? 'scene'}-${line.id ?? lineIndex}`,
        })),
      ),
    [scenes],
  );
  const reviewWordCount = useMemo(
    () =>
      approvedScriptLines.reduce(
        (total, line) => total + countWords(line.text || line.voice || ''),
        0,
      ),
    [approvedScriptLines],
  );
  const reviewDurationSeconds = useMemo(() => {
    const retainedTiming = approvedScriptLines.reduce(
      (maximum, line) => Math.max(maximum, timestampToSeconds(line.end)),
      0,
    );
    return Math.max(1, Math.round(retainedTiming || reviewWordCount / 2.4));
  }, [approvedScriptLines, reviewWordCount]);

  const resetAll = () => {
    stopVoiceSample();
    setShowActionSelector(true);
    setShowVoiceSelection(false);
    setMode('voice');
    setVoice(seedVoice(currentVoice));
    setTranslateLang('');
    setPreviewing(false);
    setScenes(null);
    setSubmitting(false);
    setLangError('');
    setVoiceError('');
    setDefaultVoiceLoading(false);
    setTranslateVoiceAutoSelected(false);
    setVoiceSamplePlaying(false);
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

  useEffect(() => {
    if (!open || mode !== 'translate' || !translateLang) return undefined;

    let cancelled = false;
    const provider = currentVoice?.provider || 'elevenlabs';
    const language = normalizeVoiceLanguage(translateLang, provider);

    setDefaultVoiceLoading(true);
    setTranslateVoiceAutoSelected(false);
    setVoiceError('');
    setVoice({
      provider,
      language,
      languageLabel: labelForLanguage(translateLang),
      gender: '',
      accent: '',
      age: '',
      voiceId: '',
      voiceName: '',
      previewUrl: '',
    });

    const request =
      provider === 'sarvam'
        ? getSarvamVoices({ lang: language })
        : getVoices({ language });

    request
      .then((items) => {
        if (cancelled) return;
        const defaultVoice = items[0];
        if (!defaultVoice) {
          setVoiceError(`No ${labelForLanguage(translateLang)} voices are available.`);
          return;
        }
        setVoice({
          provider,
          language,
          languageLabel: labelForLanguage(translateLang),
          gender: defaultVoice.gender || '',
          accent: defaultVoice.accent || '',
          age: defaultVoice.age || '',
          voiceId: defaultVoice.voice_id || '',
          voiceName: defaultVoice.voice_name || defaultVoice.name || '',
          previewUrl: defaultVoice.preview_url || '',
        });
        setTranslateVoiceAutoSelected(true);
      })
      .catch(() => {
        if (!cancelled) {
          setVoiceError(`Unable to load ${labelForLanguage(translateLang)} voices.`);
        }
      })
      .finally(() => {
        if (!cancelled) setDefaultVoiceLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [currentVoice?.provider, mode, open, translateLang]);

  useEffect(() => {
    stopVoiceSample();
    return () => {
      voiceSampleRef.current?.pause();
      voiceSampleRef.current = null;
    };
  }, [stopVoiceSample, voice.previewUrl]);

  const toggleVoiceSample = () => {
    if (voiceSamplePlaying) {
      stopVoiceSample();
      return;
    }
    if (!voice.previewUrl) return;
    const sample = new Audio(resolveMediaUrl(voice.previewUrl));
    sample.onended = () => {
      voiceSampleRef.current = null;
      setVoiceSamplePlaying(false);
    };
    sample.onerror = sample.onended;
    voiceSampleRef.current = sample;
    setVoiceSamplePlaying(true);
    sample.play().catch(sample.onended);
  };

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

  const currentScriptLanguageCode = normalizeTranslateLanguageCode(
    currentScriptLanguage || currentVoice?.language,
  );
  const langOptions = useMemo(
    () =>
      TRANSLATE_LANG_CODES.filter((code) => code !== currentScriptLanguageCode).map(
        (code) => ({
          value: code,
          label: labelForLanguage(code),
        }),
      ),
    [currentScriptLanguageCode],
  );

  useEffect(() => {
    if (translateLang && translateLang === currentScriptLanguageCode) {
      setTranslateLang('');
      setLangError('');
    }
  }, [currentScriptLanguageCode, translateLang]);

  const selectedLangObj = translateLang
    ? { value: translateLang, label: labelForLanguage(translateLang) }
    : null;
  const activeVoiceLanguage =
    (mode === 'translate' && translateLang) ||
    currentScriptLanguage ||
    voice.language ||
    'en';
  const activeVoiceLanguageLabel = activeVoiceLanguage
    ? labelForLanguage(String(activeVoiceLanguage).toLowerCase().split('-')[0])
    : 'Current script language';
  const hasSelectedVoice =
    (voice.provider || 'elevenlabs') === 'sarvam'
      ? Boolean(voice.voiceName)
      : Boolean(voice.voiceId);
  const currentScriptLanguageLabel = currentScriptLanguage
    ? labelForLanguage(String(currentScriptLanguage).toLowerCase().split('-')[0])
    : 'Current script language';

  const keepVoice = () => ({
    voiceProvider: currentVoice?.provider || 'elevenlabs',
    voiceId: currentVoice?.voiceId || '',
    voiceName: currentVoice?.voiceName || '',
  });

  const selectedVoiceInputs = () => {
    const provider = voice.provider || 'elevenlabs';
    const hasVoice = provider === 'sarvam' ? !!voice.voiceName : !!voice.voiceId;
    if (!hasVoice) return null;
    return {
      voiceProvider: provider,
      voiceId: provider === 'elevenlabs' ? voice.voiceId || '' : '',
      voiceName: voice.voiceName || '',
    };
  };

  // ── Mode switching — clear any previewed script when leaving translate ──────
  const switchMode = (next) => {
    if (next === mode) return;
    stopVoiceSample();
    setMode(next);
    setScenes(null);
    setPreviewing(false);
    setLangError('');
    setVoiceError('');
    dispatch(clearAiAdsTranslateScript({ sessionId }));
  };

  const chooseAction = (next) => {
    switchMode(next);
    setShowActionSelector(false);
    setShowVoiceSelection(next === 'voice');
  };

  const backToActionSelector = () => {
    stopVoiceSample();
    setScenes(null);
    setPreviewing(false);
    setLangError('');
    setVoiceError('');
    dispatch(clearAiAdsTranslateScript({ sessionId }));
    setShowVoiceSelection(false);
    setShowActionSelector(true);
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
  // The shared voice-selection screen supplies the selected provider/voice for
  // both translated and recreated scripts.
  const submitScript = async () => {
    if (scriptHasErrors) return;
    const selectedVoice = selectedVoiceInputs();
    if (!selectedVoice) {
      setVoiceError('Please pick a voice.');
      return;
    }
    stopVoiceSample();
    const inputs = {
      ...selectedVoice,
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
    const selectedVoice = selectedVoiceInputs();
    if (!selectedVoice) {
      setVoiceError('Please pick a voice.');
      return;
    }
    stopVoiceSample();
    const inputs = {
      ...selectedVoice,
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
    stopVoiceSample();
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
          className={`${GLASS_DIALOG_CLASS} flex h-[min(85dvh,760px)] max-h-[calc(100dvh-2rem)] flex-col overflow-hidden sm:max-w-2xl sm:scale-100 lg:max-h-[calc(100dvh-2rem)]`}
          showCloseButton={!busy}
          onPointerDownOutside={blockOutsideClose}
          onInteractOutside={blockOutsideClose}
          onEscapeKeyDown={blockOutsideClose}
        >
          {submitting && (
            <div role="status" aria-live="polite" className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-[#111]/90 backdrop-blur-sm">
              <RefreshCw aria-hidden="true" className="h-7 w-7 animate-spin text-blue-300" />
              <p className="text-sm font-semibold text-white">Starting final merge…</p>
              <p className="text-xs text-white/45">Your approved preview is being prepared.</p>
            </div>
          )}
          <DialogHeader>
            <div className="flex flex-wrap items-center gap-2">
              <DialogTitle>Preview voice-over</DialogTitle>
              <span className="rounded-full bg-blue-400/10 px-2.5 py-1 text-[11px] font-semibold text-blue-300">
                Preview
              </span>
            </div>
            <DialogDescription className="text-white/55">
              Review the synchronized video and audio before creating the final version.
            </DialogDescription>
          </DialogHeader>
          {previewVideoUrl ? (
            <video
              ref={videoRef}
              src={previewVideoUrl}
              muted
              playsInline
              aria-label="Muted video used with the regenerated voice-over preview"
              className="min-h-0 w-full flex-1 rounded-xl border border-white/10 bg-black object-contain"
              onPlay={() => { setIsPreviewPlaying(true); syncAudio(); audioRef.current?.play(); }}
              onPause={() => { setIsPreviewPlaying(false); audioRef.current?.pause(); }}
              onSeeked={syncAudio}
              onEnded={() => audioRef.current?.pause()}
            />
          ) : (
            <div className="flex min-h-0 flex-1 items-center justify-center rounded-xl border border-white/10 bg-black text-sm text-white/55">
              Video preview is unavailable. You can still review the regenerated audio.
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
          <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={togglePreview}
                aria-pressed={isPreviewPlaying}
                aria-label={isPreviewPlaying ? 'Pause synchronized preview' : 'Play synchronized preview'}
                title={isPreviewPlaying ? 'Pause synchronized preview' : 'Play synchronized preview'}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-400/10 text-blue-300 transition hover:bg-blue-400/20"
              >
                {isPreviewPlaying ? (
                  <Pause className="h-4 w-4 fill-current" />
                ) : (
                  <Play className="h-4 w-4 fill-current" />
                )}
              </button>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-white/45">Regenerated voice audio</p>
                <p className="truncate text-sm font-semibold text-white">{audioFileName}</p>
              </div>
              <span className="shrink-0 text-xs tabular-nums text-white/45">
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
              className="mt-3 h-1.5 w-full cursor-pointer accent-blue-400 disabled:cursor-not-allowed"
            />
          </div>
          <DialogFooter>
            <button type="button" onClick={discardVoicePreview} disabled={busy} className="rounded-md border border-white/20 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/5 disabled:opacity-50">Try again</button>
            <button type="button" onClick={acceptVoicePreview} disabled={busy} className="rounded-md bg-white px-4 py-2 text-sm font-semibold text-black transition hover:bg-white/90 disabled:opacity-50">{submitting ? 'Starting merge…' : 'Accept & merge'}</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }
  if (voicePreview?.error) {
    return (
      <Dialog open={open} onOpenChange={guardedOpenChange}>
        <DialogContent
          className={`${GLASS_DIALOG_CLASS} sm:max-w-xl`}
          showCloseButton={!busy}
          onPointerDownOutside={blockOutsideClose}
          onInteractOutside={blockOutsideClose}
          onEscapeKeyDown={blockOutsideClose}
        >
          <DialogHeader>
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-red-500/10 text-red-300">
                <AlertTriangle className="h-4 w-4" />
              </span>
              <DialogTitle>Voice preview failed</DialogTitle>
            </div>
            <DialogDescription role="alert" className="text-white/55">{voicePreview.error}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button type="button" onClick={discardVoicePreview} className="rounded-md border border-white/20 bg-white px-4 py-2 text-sm font-semibold text-black transition hover:bg-white/90">
              Try again
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }
  if (awaitingVoicePreview) {
    const loadingMessage =
      mode === 'translate'
        ? 'Preparing the translated voice-over…'
        : mode === 'rewrite'
          ? 'Preparing the recreated voice-over…'
          : 'Preparing the new voice-over…';

    return (
      <Dialog open={open} onOpenChange={guardedOpenChange}>
        <DialogContent
          className={`${GLASS_DIALOG_CLASS} flex h-[min(85vh,760px)] flex-col overflow-hidden sm:max-w-2xl`}
          showCloseButton={false}
          onPointerDownOutside={blockOutsideClose}
          onInteractOutside={blockOutsideClose}
          onEscapeKeyDown={blockOutsideClose}
        >
          <DialogHeader>
            <div className="flex flex-wrap items-center gap-2">
              <DialogTitle>Preparing voice preview</DialogTitle>
              <span className="rounded-full bg-blue-400/10 px-2.5 py-1 text-[11px] font-semibold text-blue-300">
                Generating audio
              </span>
            </div>
            <DialogDescription className="text-white/55">{loadingMessage}</DialogDescription>
          </DialogHeader>
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            <div role="status" aria-live="polite" className="flex min-h-0 flex-1 items-center justify-center rounded-xl border border-white/10 bg-black">
              <div className="flex flex-col items-center gap-3 text-white/55">
                <Loader2 aria-hidden="true" className="h-7 w-7 animate-spin text-blue-300" />
                <p className="text-sm">Preparing synchronized video preview…</p>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] p-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-400/10 text-blue-300">
                <Music2 className="h-4 w-4 animate-pulse" />
              </div>
              <div className="flex-1 space-y-2">
                <div className="h-2.5 w-32 animate-pulse rounded bg-white/10" />
                <div className="h-1.5 w-full animate-pulse rounded bg-white/10" />
              </div>
            </div>
          </div>
          <p className="text-center text-xs text-white/45">
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
    stopVoiceSample();
    setPreviewing(false);
    setScenes(null);
    setShowVoiceSelection(false);
    setLangError('');
    dispatch(clearAiAdsTranslateScript({ sessionId }));
  };

  const continueToVoiceSelection = () => {
    if (!scriptReady || scriptHasErrors) return;
    stopVoiceSample();
    setVoiceError('');
    setShowVoiceSelection(true);
  };

  const backFromVoiceSelection = () => {
    stopVoiceSample();
    setVoiceError('');
    setShowVoiceSelection(false);
    if (mode === 'voice') setShowActionSelector(true);
  };

  const confirmTranslateVoiceSelection = () => {
    if (!selectedVoiceInputs()) {
      setVoiceError('Please pick a voice.');
      return;
    }
    setVoiceError('');
    setShowVoiceSelection(false);
  };

  // Rewrite keeps the SAME script language — but we don't reliably know what
  // that is (voiceFilters.language is the VOICE language, not the script's), so
  // we don't name it. Translate always shows the chosen target language.
  const stepTitle =
    mode === 'translate'
      ? 'Review translation'
      : 'Review new script';
  const voiceSelectionScriptLines =
    mode === 'voice' ? currentScriptLines : approvedScriptLines;
  const voiceSelectionScriptText = voiceSelectionScriptLines
    .map((line) => line.text || line.voice || '')
    .filter(Boolean)
    .join(' ');
  const voiceSelectionScriptLabel =
    mode === 'translate'
      ? `Approved translated script · ${activeVoiceLanguageLabel}`
      : mode === 'rewrite'
        ? `Approved recreated script · ${activeVoiceLanguageLabel}`
        : `Current script · ${activeVoiceLanguageLabel}`;

  const renderEditableScriptLines = () =>
    scenes.map((scene, sceneIndex) =>
      (scene.script || []).map((line, lineIndex) => {
        const words = countWords(line.text);
        const chars = line.text ? line.text.length : 0;
        const overWords = line.maxWords && words > line.maxWords;
        const overChars = line.maxChars && chars > line.maxChars;
        const empty = !line.text || !line.text.trim();
        const invalid = empty || overWords || overChars;
        const timingLabel =
          line.start || line.end
            ? `, ${shortTs(line.start) || 'start'} to ${shortTs(line.end) || 'end'}`
            : '';

        return (
          <div key={`${sceneIndex}-${line.id ?? lineIndex}`} className="flex gap-3">
            <span className="mt-2.5 w-20 shrink-0 text-right text-xs tabular-nums leading-tight text-white/40">
              {shortTs(line.start)}
              {line.end ? (
                <>
                  {' – '}
                  {shortTs(line.end)}
                </>
              ) : null}
            </span>
            <div className="min-w-0 flex-1">
              <textarea
                rows={2}
                value={line.text}
                onChange={(event) => updateLine(sceneIndex, lineIndex, event.target.value)}
                aria-label={`Script line ${line.id ?? lineIndex + 1}${timingLabel}`}
                className={`w-full resize-none rounded-lg border bg-white/[0.06] px-3 py-2 text-sm text-white outline-none ${
                  invalid
                    ? 'border-red-500'
                    : 'border-white/10 focus:border-blue-400/35'
                }`}
              />
              {(line.maxWords || line.maxChars) && (
                <div className="mt-1 flex gap-3 text-[11px]">
                  {line.maxWords ? (
                    <span className={overWords ? 'text-red-500' : 'text-white/40'}>
                      {words}/{line.maxWords} words
                    </span>
                  ) : null}
                  {line.maxChars ? (
                    <span className={overChars ? 'text-red-500' : 'text-white/40'}>
                      {chars}/{line.maxChars} chars
                    </span>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        );
      }),
    );

  // ── Full step screen: review/edit the new script, then Generate ─────────────
  if (onScriptStep && !showVoiceSelection) {
    return (
      <Dialog open={open} onOpenChange={guardedOpenChange}>
        <DialogContent
          className={`${GLASS_DIALOG_CLASS} flex max-h-[85vh] flex-col gap-0 p-0 ${
            mode === 'rewrite' ? 'sm:max-w-4xl' : 'sm:max-w-2xl'
          }`}
          showCloseButton={false}
          onPointerDownOutside={blockOutsideClose}
          onInteractOutside={blockOutsideClose}
          onEscapeKeyDown={blockOutsideClose}
        >
          <div className="flex items-start justify-between border-b border-white/10 px-6 py-4">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-semibold text-white">
                  {stepTitle}
                </h2>
                <span className="rounded-full bg-blue-400/10 px-2.5 py-1 text-[11px] font-semibold text-blue-300">
                  Script step 2 of 2
                </span>
              </div>
              <p className="mt-0.5 text-xs text-white/55">
                {mode === 'rewrite'
                  ? 'Compare and edit the recreated script before generating its voice-over.'
                  : 'Review and edit the translated script before generating its voice-over.'}
              </p>
            </div>
            {/* Custom close (✕) — always present on the step screen, disabled
                while a preview/generate is in flight (until the socket result). */}
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              disabled={busy}
              aria-label="Close"
              className="shrink-0 rounded-sm p-1 text-white/70 opacity-70 transition hover:text-white hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-30"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto px-6 py-4">
            {mode === 'translate' && scriptReady && (
              <div className="flex flex-wrap items-center gap-2 pb-1">
                <span className="rounded-full bg-white/[0.06] px-3 py-1.5 text-xs font-medium text-white/55">
                  {currentScriptLanguageLabel}
                </span>
                <span className="text-sm text-white/35">→</span>
                <span className="rounded-full bg-blue-400/10 px-3 py-1.5 text-xs font-semibold text-blue-300">
                  {labelForLanguage(translateLang)}
                </span>
              </div>
            )}
            {/* Loading state — card is open immediately on click; the script
                fills in when the socket delivers it. */}
            {!scriptReady ? (
              <div className="flex h-40 flex-col items-center justify-center gap-3 text-white/55">
                <Loader2 className="h-6 w-6 animate-spin" />
                <p className="text-sm">
                  {mode === 'translate'
                    ? `Generating the ${labelForLanguage(translateLang)} script…`
                    : 'Writing a fresh script…'}
                </p>
              </div>
            ) : mode === 'rewrite' ? (
              <div className="grid gap-4 md:grid-cols-2">
                <section className="min-w-0 rounded-xl border border-white/5 bg-white/[0.025] p-4">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <span className="rounded-full bg-white/[0.06] px-2.5 py-1 text-[11px] font-semibold tracking-wide text-white/55">
                      CURRENT
                    </span>
                    <span className="text-[11px] text-white/35">Read only</span>
                  </div>
                  <div className="space-y-3">
                    {currentScriptLines.length ? (
                      currentScriptLines.map((line) => (
                        <div key={line.key} className="rounded-lg bg-white/[0.035] p-3">
                          {(line.start || line.end) && (
                            <p className="mb-1.5 text-[11px] tabular-nums text-white/35">
                              {shortTs(line.start)}
                              {line.end ? ` – ${shortTs(line.end)}` : ''}
                            </p>
                          )}
                          <p className="text-sm leading-relaxed text-white/60">
                            {line.text || line.voice || 'No script text available.'}
                          </p>
                        </div>
                      ))
                    ) : (
                      <p className="rounded-lg bg-white/[0.035] p-3 text-sm text-white/45">
                        The current script is unavailable for this legacy version.
                      </p>
                    )}
                  </div>
                </section>

                <section className="min-w-0 rounded-xl border border-blue-400/35 bg-blue-400/[0.035] p-4">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <span className="rounded-full bg-blue-400/10 px-2.5 py-1 text-[11px] font-semibold tracking-wide text-blue-300">
                      NEW · EDITABLE
                    </span>
                    <span className="text-[11px] text-white/35">Timing retained</span>
                  </div>
                  <div className="space-y-3">{renderEditableScriptLines()}</div>
                </section>
              </div>
            ) : (
              <section className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-white/80">
                    Translated script · editable
                  </p>
                  <span className="text-[11px] text-white/35">
                    Video timing retained
                  </span>
                </div>
                {renderEditableScriptLines()}
              </section>
            )}
            {scriptReady && (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <span className="rounded-full bg-blue-400/10 px-3 py-1.5 text-xs font-semibold text-blue-300">
                  {reviewWordCount} words
                </span>
                <span className="rounded-full bg-blue-400/10 px-3 py-1.5 text-xs font-semibold text-blue-300">
                  ≈ {reviewDurationSeconds} sec
                </span>
                <span className="rounded-full bg-white/[0.06] px-3 py-1.5 text-xs font-medium text-white/60">
                  {mode === 'translate'
                    ? labelForLanguage(translateLang)
                    : currentScriptLanguageLabel}
                </span>
              </div>
            )}
            {mode === 'translate' && scriptReady && (
              <section className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.025] p-3">
                <button
                  type="button"
                  onClick={toggleVoiceSample}
                  disabled={defaultVoiceLoading || !voice.previewUrl}
                  aria-label={voiceSamplePlaying ? 'Pause narrator preview' : 'Play narrator preview'}
                  title={
                    voice.previewUrl
                      ? voiceSamplePlaying
                        ? 'Pause narrator preview'
                        : 'Play narrator preview'
                      : 'Preview unavailable'
                  }
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-400/10 text-blue-300 transition hover:bg-blue-400/20 disabled:cursor-not-allowed disabled:text-white/25"
                >
                  {voiceSamplePlaying ? (
                    <Pause className="h-4 w-4 fill-current" />
                  ) : (
                    <Play className="h-4 w-4 fill-current" />
                  )}
                </button>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-white">
                    {defaultVoiceLoading
                      ? `Selecting a ${activeVoiceLanguageLabel} narrator…`
                      : voice.voiceName || `Choose a ${activeVoiceLanguageLabel} narrator`}
                  </p>
                  <p className="mt-0.5 truncate text-xs capitalize text-white/45">
                    {mode === 'translate'
                      ? `${activeVoiceLanguageLabel} script · ${
                          defaultVoiceLoading
                            ? 'Loading compatible voices'
                            : translateVoiceAutoSelected
                              ? 'Default narrator'
                              : 'Selected narrator'
                        }`
                      : [
                          voice.gender && voice.gender.replace(/_/g, ' '),
                          voice.accent && voice.accent.replace(/_/g, ' '),
                          voice.age && voice.age.replace(/_/g, ' '),
                          activeVoiceLanguageLabel,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={continueToVoiceSelection}
                  disabled={busy || defaultVoiceLoading}
                  className="shrink-0 rounded-md border border-white/15 px-3 py-2 text-xs font-semibold text-white/80 transition hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Change voice
                </button>
              </section>
            )}
            {mode === 'translate' && voiceError && (
              <p className="text-sm text-red-400">{voiceError}</p>
            )}
            {langError && <p className="text-sm text-red-500">{langError}</p>}
          </div>

          <div className="flex items-center justify-between border-t border-white/10 px-6 py-4">
            <button
              type="button"
              onClick={backToStart}
              disabled={busy}
              className="rounded-md border border-white/20 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
            >
              ← Back
            </button>
            <button
              type="button"
              onClick={mode === 'translate' ? submitScript : continueToVoiceSelection}
              disabled={
                busy ||
                !scriptReady ||
                scriptHasErrors ||
                (mode === 'translate' && (defaultVoiceLoading || !hasSelectedVoice))
              }
              className="rounded-md border border-white/20 bg-white px-5 py-2 text-sm font-semibold text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting
                ? 'Starting…'
                : mode === 'translate'
                  ? 'Use translation & generate voice-over'
                  : 'Continue to voice-over'}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  if (showVoiceSelection) {
    return (
      <Dialog open={open} onOpenChange={guardedOpenChange}>
        <DialogContent
          className={`${GLASS_DIALOG_CLASS} overflow-visible sm:max-w-2xl`}
          showCloseButton={!busy}
          onPointerDownOutside={blockOutsideClose}
          onInteractOutside={blockOutsideClose}
          onEscapeKeyDown={blockOutsideClose}
        >
          <DialogHeader>
            <div className="flex flex-wrap items-center gap-2">
              <DialogTitle>Change voice</DialogTitle>
              <span className="rounded-full bg-blue-400/10 px-2.5 py-1 text-[11px] font-semibold text-blue-300">
                Regenerate voice-over
              </span>
            </div>
            <DialogDescription className="text-white/55">
              {mode === 'translate'
                ? 'Choose a narrator, then return to the translation review before generating.'
                : 'Choose a narrator for the approved script before generating its audio preview.'}
            </DialogDescription>
          </DialogHeader>

          <section className="rounded-xl border border-white/5 bg-white/[0.035] p-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="rounded-full bg-white/[0.06] px-2.5 py-1 text-[11px] font-semibold text-white/55">
                LOCKED
              </span>
              <span className="truncate text-xs font-medium text-white/65">
                {voiceSelectionScriptLabel}
              </span>
            </div>
            <p className="line-clamp-3 text-sm leading-relaxed text-white/50">
              {voiceSelectionScriptText || 'Script preview is unavailable for this legacy version.'}
            </p>
          </section>

          <LockedVoiceCardSelector
            value={voice}
            onChange={(nextVoice) => {
              setVoice(nextVoice);
              setVoiceError('');
              setTranslateVoiceAutoSelected(false);
            }}
            error={voiceError}
            lockedLanguage={activeVoiceLanguage}
            lockedLanguageLabel={activeVoiceLanguageLabel}
          />

          {/* <div className="flex items-start gap-2 rounded-lg border border-white/10 bg-white/[0.035] px-3 py-2 text-xs text-white/60">
            <Languages className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-300" />
            <p>
              {mode === 'translate'
                ? 'This only updates the selected narrator. Generation starts from the translation review.'
                : 'The approved script and video stay unchanged. Only the selected narrator voice is used to generate the next preview.'}
            </p>
          </div> */}

          <DialogFooter>
            <button
              type="button"
              onClick={backFromVoiceSelection}
              disabled={busy}
              className="rounded-md border border-white/20 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Back
            </button>
            <button
              type="button"
              onClick={
                mode === 'voice'
                  ? submitVoice
                  : mode === 'translate'
                    ? confirmTranslateVoiceSelection
                    : submitScript
              }
              disabled={busy}
              className="rounded-md border border-white/20 bg-white px-4 py-2 text-sm font-semibold text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting
                ? 'Starting…'
                : mode === 'translate'
                  ? 'Use this voice'
                  : 'Generate new voice-over'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  if (showActionSelector) {
    return (
      <Dialog open={open} onOpenChange={guardedOpenChange}>
        <DialogContent
          className={`${GLASS_DIALOG_CLASS} max-h-[90vh] overflow-y-auto p-0 sm:max-w-2xl`}
          showCloseButton={!busy}
          onPointerDownOutside={blockOutsideClose}
          onInteractOutside={blockOutsideClose}
          onEscapeKeyDown={blockOutsideClose}
        >
          <DialogHeader className="border-b border-blue-300/10 bg-[linear-gradient(90deg,transparent,rgba(59,130,246,0.05))] px-4 pt-6 pb-5 sm:px-6">
            <DialogTitle className="text-xl">What would you like to change?</DialogTitle>
            <DialogDescription className="text-white/55">
              Choose one option. You can review all changes before applying them.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 px-4 sm:px-6">
            {ACTIONS.map((action) => {
              const Icon = action.icon;
              return (
                <button
                  key={action.id}
                  type="button"
                  disabled={busy}
                  onClick={() => chooseAction(action.id)}
                  className="group flex w-full items-start gap-3 rounded-xl border border-white/12 bg-[#25282E]/60 p-3 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] backdrop-blur-md transition duration-200 hover:-translate-y-0.5 hover:border-blue-300/40 hover:bg-[#293141]/75 hover:shadow-[0_12px_30px_rgba(59,130,246,0.09),inset_0_1px_0_rgba(255,255,255,0.08)] disabled:cursor-not-allowed disabled:opacity-50 sm:gap-4 sm:p-4"
                >
                  <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-blue-300/15 bg-blue-400/15 text-blue-300 shadow-[0_0_22px_rgba(59,130,246,0.10)]">
                    <Icon className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="flex h-6 min-w-6 items-center justify-center rounded-full border border-blue-300/10 bg-blue-400/15 px-2 text-xs font-semibold text-blue-300">
                        {action.number}
                      </span>
                      <span className="text-base font-semibold text-white">{action.label}</span>
                    </span>
                    <span className="mt-2 block text-sm text-white/55">{action.description}</span>
                    <span className="mt-3 inline-flex rounded-full border border-white/10 bg-black/15 px-2.5 py-1 text-xs font-medium text-white/60">
                      {action.impact}
                    </span>
                  </span>
                  <span aria-hidden="true" className="mt-0.5 hidden shrink-0 rounded-lg border border-white/20 bg-white/[0.07] px-4 py-2 text-sm font-semibold text-white transition group-hover:border-blue-300/50 group-hover:bg-blue-300/10 group-hover:text-blue-100 sm:inline-flex">
                    Choose
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mx-4 mb-6 flex items-center gap-2 rounded-lg border border-blue-300/15 bg-[#172033]/70 px-3 py-3 text-xs text-blue-50/70 backdrop-blur-md sm:mx-6">
            <Info aria-hidden="true" className="h-4 w-4 shrink-0 text-blue-300" />
            Nothing changes until you review and confirm.
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  const modeHeader = {
    translate: {
      title: 'Translate script',
      description: 'Choose a new language for both the script and voice-over.',
    },
    rewrite: {
      title: 'Recreate script',
      description: 'Generate a fresh script using the current video context.',
    },
  }[mode];

  // ── Selected action setup: existing working content and API flow ─────────────
  return (
    <Dialog open={open} onOpenChange={guardedOpenChange}>
      <DialogContent
        className={`${GLASS_DIALOG_CLASS} overflow-visible sm:max-w-xl`}
        showCloseButton={!busy}
        onPointerDownOutside={blockOutsideClose}
        onInteractOutside={blockOutsideClose}
        onEscapeKeyDown={blockOutsideClose}
      >
        <DialogHeader className={mode === 'translate' ? 'border-b border-white/10 pb-4 pr-10' : ''}>
          <div className="flex items-center justify-between gap-3">
            <DialogTitle>{modeHeader.title}</DialogTitle>
            {mode === 'translate' && (
              <span className="shrink-0 rounded-full bg-blue-400/10 px-2.5 py-1 text-[11px] font-semibold text-blue-300">
                Script step 1 of 2
              </span>
            )}
          </div>
          <DialogDescription>{modeHeader.description}</DialogDescription>
        </DialogHeader>

        {/* Mode content */}
        <div className="min-h-24 pb-1">
          {mode === 'translate' && (
            <div className="flex flex-col gap-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <p className="text-xs font-medium text-white/70">
                    Current language
                  </p>
                  <div className="flex min-h-10 items-center rounded-lg border border-white/10 bg-white/[0.035] px-3 text-sm text-white/70">
                    {currentScriptLanguageLabel}
                  </div>
                </div>
                <div className="space-y-2">
                  <p className="text-xs font-medium text-white/70">
                    Translate to
                  </p>
                  <CommonDropdown
                    label="Select a language"
                    options={langOptions}
                    value={selectedLangObj}
                    onChange={(value) => {
                      setTranslateLang(value);
                      setLangError('');
                    }}
                    side="bottom"
                    triggerVariant="field"
                    className="!border-blue-400/55 !bg-blue-400/[0.06] shadow-[0_0_0_1px_rgba(96,165,250,0.08)] hover:!bg-blue-400/[0.09] focus-visible:!border-blue-400/70 focus-visible:!ring-blue-400/20"
                  />
                </div>
              </div>

              <div className="flex items-start gap-2 rounded-lg border border-blue-400/20 bg-blue-400/[0.06] px-3 py-3 text-xs text-blue-100">
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-400" />
                <p>The meaning, tone, and video timing will be preserved.</p>
              </div>

              {langError && <p className="text-xs text-red-500">{langError}</p>}
              {previewing && (
                <div className="flex items-center gap-2 text-xs text-white/55">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Generating the {labelForLanguage(translateLang)} script…
                </div>
              )}
            </div>
          )}

          {mode === 'rewrite' && (
            <div className="flex flex-col gap-4">
              <div className="flex justify-end">
                <span className="rounded-full bg-blue-400/10 px-2.5 py-1 text-[11px] font-semibold text-blue-300">
                  Script step 1 of 2
                </span>
              </div>
              <div className="flex items-start gap-3 rounded-xl border border-white/5 bg-white/[0.035] p-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-white/65">
                  <RotateCcw className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-sm font-medium text-white">Language stays the same</p>
                  <p className="mt-1 text-xs text-white/45">
                    {currentScriptLanguageLabel} · Video timing retained
                  </p>
                </div>
              </div>
              {/* <div className="flex items-center gap-2 rounded-md border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-200">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                <span>The video visuals will remain unchanged.</span>
              </div> */}
              {previewing && (
                <div className="flex items-center gap-2 text-xs text-white/55">
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
            onClick={backToActionSelector}
            disabled={busy}
            className="rounded-md border border-white/20 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Back
          </button>

          {/* Translate & Rewrite → Step 1: Preview script. Once the script
              arrives, the component swaps to the full step screen for
              review/edit + Generate. Translate needs a language first. */}
          {isScriptMode && (
            <button
              type="button"
              onClick={startPreview}
              disabled={busy || (mode === 'translate' && !translateLang)}
              className="rounded-md border border-white/20 bg-white px-4 py-2 text-sm font-semibold text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {previewing
                ? 'Generating…'
                : mode === 'translate'
                  ? 'Translate script'
                  : 'Generate new script'}
            </button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
