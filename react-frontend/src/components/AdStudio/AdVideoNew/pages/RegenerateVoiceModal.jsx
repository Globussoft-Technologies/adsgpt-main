import { useEffect, useMemo, useState } from 'react';
import { useDispatch } from 'react-redux';
import { Mic, Languages, PenLine } from 'lucide-react';
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
import { regenerateAiAdsVoiceAction } from '@/store/actions/adVideoNew/Advideoactions';
import { setAiAdsRegenState } from '@/store/reducers/adStudio/adVideoNewSlice';

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

/**
 * Regenerate-voice panel for a completed AI Ads video. Three modes:
 *  - voice     : pick any voice via the shared <VoiceSelector> (same script)
 *  - translate : pick a target language; Python keeps the same voice
 *  - rewrite   : one-click, new script in the same language + same voice
 * Submits the delta to POST /ai-ads/regenerate-voice; the new version arrives
 * via socket 'aiAdsVoiceReady'. Forwards the 400 already_in_language guard inline.
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
  const [submitting, setSubmitting] = useState(false);
  const [langError, setLangError] = useState('');
  const [voiceError, setVoiceError] = useState('');

  // Re-seed each time the modal opens (or the source version changes).
  useEffect(() => {
    if (!open) return;
    setMode('voice');
    setVoice(seedVoice(currentVoice));
    setTranslateLang('');
    setLangError('');
    setVoiceError('');
  }, [open, currentVoice]);

  const currentLang = currentVoice?.language || '';
  const currentLangLabel = currentLang ? labelForLanguage(currentLang) : 'the original language';

  // Offer every curated language except the one the ad is already in.
  const langOptions = useMemo(
    () =>
      TRANSLATE_LANG_CODES.filter((c) => c !== currentLang).map((c) => ({
        value: c,
        label: labelForLanguage(c),
      })),
    [currentLang],
  );
  const selectedLangObj = translateLang
    ? { value: translateLang, label: labelForLanguage(translateLang) }
    : null;

  const buildInputs = () => {
    if (mode === 'voice') {
      const provider = voice.provider || 'elevenlabs';
      const hasVoice = provider === 'sarvam' ? !!voice.voiceName : !!voice.voiceId;
      if (!hasVoice) {
        setVoiceError('Please pick a voice.');
        return null;
      }
      return {
        voiceProvider: provider,
        voiceId: provider === 'elevenlabs' ? voice.voiceId || '' : '',
        voiceName: voice.voiceName || '',
        regenType: 'voice',
        translateLang: '',
      };
    }

    // translate + rewrite keep the current voice (Python re-uses it).
    const keepVoice = {
      voiceProvider: currentVoice?.provider || 'elevenlabs',
      voiceId: currentVoice?.voiceId || '',
      voiceName: currentVoice?.voiceName || '',
    };

    if (mode === 'translate') {
      if (!translateLang) {
        setLangError('Please select a language.');
        return null;
      }
      return { ...keepVoice, regenType: 'translate', translateLang };
    }

    return { ...keepVoice, regenType: 'rewrite', translateLang: '' };
  };

  const submit = async () => {
    const inputs = buildInputs();
    if (!inputs) return;
    try {
      setSubmitting(true);
      setLangError('');
      // Set the overlay BEFORE awaiting: a fast regen can deliver the socket
      // 'aiAdsVoiceReady' (which flips regenState back to 'idle') before this
      // await resolves — setting 'processing' afterwards would clobber the
      // completion and leave the overlay stuck forever.
      dispatch(setAiAdsRegenState({ sessionId, regenState: 'processing' }));
      await dispatch(regenerateAiAdsVoiceAction(sessionId, inputs));
      onOpenChange(false);
    } catch (e) {
      // Firing failed — clear the overlay we optimistically set.
      dispatch(setAiAdsRegenState({ sessionId, regenState: 'idle' }));
      // The backend forwards Python's 400 verbatim — show it inline.
      if (e?.code === 'already_in_language') setLangError(e.message);
      // other errors are already toasted by the thunk
    } finally {
      setSubmitting(false);
    }
  };

  const submitLabel =
    mode === 'translate' ? 'Translate' : mode === 'rewrite' ? 'Rewrite script' : 'Apply new voice';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
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
                onClick={() => setMode(m.id)}
                className={`flex flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm transition ${
                  active
                    ? 'border-blue-500 bg-blue-500/10 text-blue-600 dark:text-blue-400'
                    : 'border-black/10 text-zinc-600 hover:bg-black/5 dark:border-white/10 dark:text-zinc-300 dark:hover:bg-white/5'
                }`}
              >
                <Icon size={16} />
                {m.label}
              </button>
            );
          })}
        </div>

        {/* Mode content */}
        <div className="min-h-[96px] py-1">
          {mode === 'voice' && (
            <VoiceSelector value={voice} onChange={setVoice} error={voiceError} />
          )}

          {mode === 'translate' && (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Currently in <span className="font-medium">{currentLangLabel}</span>. Pick a
                different language — the same voice is kept.
              </p>
              <CommonDropdown
                label="Language"
                options={langOptions}
                value={selectedLangObj}
                onChange={(v) => {
                  setTranslateLang(v);
                  setLangError('');
                }}
                side="bottom"
              />
              {langError && <p className="text-xs text-red-500">{langError}</p>}
            </div>
          )}

          {mode === 'rewrite' && (
            <p className="text-sm text-zinc-600 dark:text-zinc-300">
              We&apos;ll write a fresh script in{' '}
              <span className="font-medium">{currentLangLabel}</span> and keep the current voice.
            </p>
          )}
        </div>

        <DialogFooter>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
            className="rounded-lg border border-black/10 px-4 py-2 text-sm text-zinc-600 transition hover:bg-black/5 disabled:opacity-50 dark:border-white/10 dark:text-zinc-300 dark:hover:bg-white/5"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? 'Starting…' : submitLabel}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
