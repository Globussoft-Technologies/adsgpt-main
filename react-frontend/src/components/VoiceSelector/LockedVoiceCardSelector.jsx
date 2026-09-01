import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  Loader2,
  Mic2,
  Pause,
  Play,
  Plus,
  X,
} from 'lucide-react';
import {
  getAccents,
  getAges,
  getGenders,
  getSarvamGenders,
  getSarvamVoices,
  getVoices,
  labelForLanguage,
  prettify,
} from '@/apis/voiceSelector/voiceSelectorApi';
import ChipDropdown from './ChipDropdown';
import { PROVIDER_RECOMMENDATION } from './VoiceSelector';

// Recommendation text is shared with VoiceSelector so both pickers say the
// same thing about the same two providers.
const PROVIDERS = [
  { id: 'elevenlabs', label: 'ElevenLabs', hint: 'Best for global languages' },
  { id: 'sarvam', label: 'Sarvam', hint: 'Best for Indian languages' },
];

const normalizeLanguage = (language, provider) => {
  const baseLanguage = String(language || 'en')
    .trim()
    .toLowerCase()
    .split('-')[0];
  return provider === 'sarvam' ? `${baseLanguage}-IN` : baseLanguage;
};

const languageLabel = (language, fallback) =>
  fallback || labelForLanguage(String(language || '').toLowerCase().split('-')[0]) || 'English';

const voiceDetails = (voice) =>
  [voice.gender, voice.accent, voice.age, voice.descriptive]
    .filter(Boolean)
    .map(prettify)
    .join(' · ');

export default function LockedVoiceCardSelector({
  value = {},
  onChange,
  error,
  lockedLanguage,
  lockedLanguageLabel,
}) {
  const provider = value.provider || 'elevenlabs';
  const isSarvam = provider === 'sarvam';
  const catalogLanguage = normalizeLanguage(lockedLanguage || value.language, provider);
  const displayLanguage = languageLabel(lockedLanguage || value.language, lockedLanguageLabel);
  const filterFields = isSarvam ? ['gender'] : ['gender', 'accent', 'age'];
  const providerRef = useRef(null);
  const audioRef = useRef(null);
  const filterRefs = {
    gender: useRef(null),
    accent: useRef(null),
    age: useRef(null),
  };
  const [providerOpen, setProviderOpen] = useState(false);
  const [openFilter, setOpenFilter] = useState(null);
  const [filterOptions, setFilterOptions] = useState({
    gender: [],
    accent: [],
    age: [],
  });
  const [filterLoading, setFilterLoading] = useState({});
  const [filterErrors, setFilterErrors] = useState({});
  const [voices, setVoices] = useState([]);
  const [voicesLoading, setVoicesLoading] = useState(false);
  const [voicesError, setVoicesError] = useState('');
  const [playingVoiceId, setPlayingVoiceId] = useState(null);

  const stopPreview = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setPlayingVoiceId(null);
  }, []);

  useEffect(() => stopPreview, [stopPreview]);

  useEffect(() => {
    if (!providerOpen) return undefined;
    const closeProvider = (event) => {
      if (!providerRef.current?.contains(event.target)) setProviderOpen(false);
    };
    document.addEventListener('mousedown', closeProvider);
    return () => document.removeEventListener('mousedown', closeProvider);
  }, [providerOpen]);

  const loadFilter = useCallback(
    async (field) => {
      setFilterLoading((current) => ({ ...current, [field]: true }));
      setFilterErrors((current) => ({ ...current, [field]: '' }));
      try {
        let options = [];
        if (isSarvam && field === 'gender') {
          options = await getSarvamGenders();
        } else if (field === 'gender') {
          options = await getGenders({ language: catalogLanguage });
        } else if (field === 'accent') {
          options = await getAccents({
            language: catalogLanguage,
            gender: value.gender,
          });
        } else if (field === 'age') {
          options = await getAges({
            language: catalogLanguage,
            gender: value.gender,
            accent: value.accent,
          });
        }
        setFilterOptions((current) => ({ ...current, [field]: options }));
      } catch {
        setFilterErrors((current) => ({
          ...current,
          [field]: 'Failed to load. Try again.',
        }));
      } finally {
        setFilterLoading((current) => ({ ...current, [field]: false }));
      }
    },
    [catalogLanguage, isSarvam, value.accent, value.gender],
  );

  useEffect(() => {
    if (openFilter) loadFilter(openFilter);
  }, [loadFilter, openFilter]);

  useEffect(() => {
    let ignore = false;
    setVoicesLoading(true);
    setVoicesError('');
    stopPreview();
    const request = isSarvam
      ? getSarvamVoices({
          lang: catalogLanguage,
          gender: value.gender,
        })
      : getVoices({
          language: catalogLanguage,
          gender: value.gender,
          accent: value.accent,
          age: value.age,
        });

    request
      .then((items) => {
        if (ignore) return;
        setVoices(
          items.map((voice) => ({
            ...voice,
            name: voice.voice_name || voice.name,
          })),
        );
      })
      .catch(() => {
        if (!ignore) setVoicesError('Unable to load voices. Try changing a filter.');
      })
      .finally(() => {
        if (!ignore) setVoicesLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, [
    catalogLanguage,
    isSarvam,
    provider,
    stopPreview,
    value.accent,
    value.age,
    value.gender,
  ]);

  const changeProvider = (nextProvider) => {
    if (nextProvider === provider) {
      setProviderOpen(false);
      return;
    }
    stopPreview();
    setProviderOpen(false);
    setOpenFilter(null);
    setFilterOptions({ gender: [], accent: [], age: [] });
    onChange?.({
      provider: nextProvider,
      language: normalizeLanguage(lockedLanguage || value.language, nextProvider),
      languageLabel: displayLanguage,
      gender: '',
      accent: '',
      age: '',
      voiceId: '',
      voiceName: '',
      previewUrl: '',
    });
  };

  const changeFilter = (field, nextValue) => {
    const next = {
      ...value,
      language: catalogLanguage,
      languageLabel: displayLanguage,
      [field]: nextValue,
      voiceId: '',
      voiceName: '',
      previewUrl: '',
    };
    if (field === 'gender') {
      next.accent = '';
      next.age = '';
    }
    if (field === 'accent') next.age = '';
    onChange?.(next);
    setOpenFilter(null);
  };

  const selectVoice = (selectedVoice) => {
    onChange?.({
      ...value,
      provider,
      language: catalogLanguage,
      languageLabel: displayLanguage,
      gender: selectedVoice.gender || value.gender || '',
      accent: selectedVoice.accent || value.accent || '',
      age: selectedVoice.age || value.age || '',
      voiceId: selectedVoice.voice_id || '',
      voiceName: selectedVoice.name || '',
      previewUrl: selectedVoice.preview_url || '',
    });
  };

  const togglePreview = (selectedVoice) => {
    const voiceId = selectedVoice.voice_id || selectedVoice.name;
    if (playingVoiceId === voiceId) {
      stopPreview();
      return;
    }
    stopPreview();
    if (!selectedVoice.preview_url) return;
    const audio = new Audio(selectedVoice.preview_url);
    audio.onended = stopPreview;
    audio.onerror = stopPreview;
    audioRef.current = audio;
    setPlayingVoiceId(voiceId);
    audio.play().catch(stopPreview);
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 dark:text-[#afafaf]">
          <Mic2 className="h-4 w-4" />
          Narrator Voice <span className="text-red-400">*</span>
        </label>
        <p className="mt-0.5 text-[11px] text-gray-500 dark:text-white/40">{PROVIDER_RECOMMENDATION}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div ref={providerRef} className="relative">
          <button
            type="button"
            onClick={() => setProviderOpen((current) => !current)}
            className="flex items-center gap-1.5 rounded-full border border-gray-200 bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-800 shadow-xs transition hover:bg-gray-200/80 dark:border-white/10 dark:bg-[#3A3A3A] dark:text-white"
          >
            <ChevronDown className="h-3 w-3" />
            Voice Model
            <span className="text-gray-500 dark:text-white/60">
              : {PROVIDERS.find((item) => item.id === provider)?.label}
            </span>
          </button>
          {providerOpen && (
            <div className="absolute left-0 top-full z-50 mt-2 w-52 overflow-hidden rounded-xl border border-black/10 bg-white py-1 shadow-xl dark:border-white/10 dark:bg-[#1A1A1A] dark:shadow-2xl">
              {PROVIDERS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => changeProvider(item.id)}
                  className={`flex w-full flex-col items-start px-3 py-2 text-left text-sm transition ${
                    item.id === provider
                      ? 'bg-gray-100 text-gray-900 font-medium dark:bg-white/10 dark:text-white'
                      : 'text-gray-700 hover:bg-gray-50 dark:text-white/70 dark:hover:bg-white/5 dark:hover:text-white'
                  }`}
                >
                  {item.label}
                  <span className="text-[10px] text-gray-400 dark:text-white/45">{item.hint}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <span className="rounded-full border border-gray-200 bg-gray-100 px-3 py-1.5 text-xs font-semibold text-gray-700 dark:border-white/10 dark:bg-white/[0.06] dark:text-white/80">
          Locked language: {displayLanguage}
        </span>

        {filterFields.map((field) => {
          const selected = value[field];
          return (
            <div key={field} className="relative">
              <button
                ref={filterRefs[field]}
                type="button"
                onClick={() =>
                  setOpenFilter((current) => (current === field ? null : field))
                }
                className="flex items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-100 hover:text-gray-900 dark:border-white/10 dark:bg-white/[0.06] dark:text-white/70 dark:hover:text-white"
              >
                {selected ? (
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(event) => {
                      event.stopPropagation();
                      changeFilter(field, '');
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.stopPropagation();
                        changeFilter(field, '');
                      }
                    }}
                    aria-label={`Clear ${field}`}
                  >
                    <X className="h-3 w-3" />
                  </span>
                ) : (
                  <Plus className="h-3 w-3" />
                )}
                {prettify(field)}
                {selected && <span className="text-gray-400 dark:text-white/50">: {prettify(selected)}</span>}
              </button>
              <ChipDropdown
                field={field}
                open={openFilter === field}
                anchorRef={filterRefs[field]}
                loading={!!filterLoading[field]}
                error={filterErrors[field]}
                options={filterOptions[field] || []}
                value={selected}
                onSelect={(nextValue) => changeFilter(field, nextValue)}
                onClose={() => setOpenFilter(null)}
              />
            </div>
          );
        })}
      </div>

      <div className="h-[260px] space-y-2 overflow-y-auto pr-1">
        {voicesLoading && (
          <div className="flex h-full items-center justify-center gap-2 rounded-xl border border-gray-200 text-sm text-gray-500 dark:border-white/10 dark:text-white/50">
            <Loader2 className="h-4 w-4 animate-spin text-blue-500 dark:text-blue-300" />
            Loading voices…
          </div>
        )}
        {!voicesLoading && voicesError && (
          <div className="flex h-full items-center rounded-xl border border-red-200 bg-red-50 px-4 py-5 text-sm text-red-600 dark:border-red-400/20 dark:bg-red-400/5 dark:text-red-300">
            {voicesError}
          </div>
        )}
        {!voicesLoading && !voicesError && voices.length === 0 && (
          <div className="flex h-full items-center rounded-xl border border-gray-200 px-4 py-5 text-sm text-gray-400 dark:border-white/10 dark:text-white/45">
            No voices match the locked language and selected filters.
          </div>
        )}
        {!voicesLoading &&
          !voicesError &&
          voices.map((catalogVoice) => {
            const voiceId = catalogVoice.voice_id || catalogVoice.name;
            const selected =
              provider === 'sarvam'
                ? value.voiceName === catalogVoice.name
                : value.voiceId === catalogVoice.voice_id;
            const playing = playingVoiceId === voiceId;
            return (
              <div
                key={voiceId}
                className={`flex items-center gap-3 rounded-xl border px-3 py-3 transition ${
                  selected
                    ? 'border-blue-500 bg-blue-50/70 shadow-sm dark:border-blue-400 dark:bg-blue-400/[0.07] dark:shadow-[0_0_14px_rgba(59,130,246,0.14)]'
                    : 'border-gray-200 bg-gray-50/60 hover:border-gray-300 hover:bg-gray-100/70 dark:border-white/10 dark:bg-white/[0.025] dark:hover:border-white/20'
                }`}
              >
                <button
                  type="button"
                  onClick={() => togglePreview(catalogVoice)}
                  disabled={!catalogVoice.preview_url}
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition ${
                    catalogVoice.preview_url
                      ? 'border border-blue-200 bg-blue-50 text-blue-600 hover:bg-blue-100 dark:border-transparent dark:bg-blue-400/10 dark:text-blue-300 dark:hover:bg-blue-400/20'
                      : 'cursor-not-allowed bg-gray-100 text-gray-300 dark:bg-white/5 dark:text-white/20'
                  }`}
                  aria-label={`${playing ? 'Pause' : 'Play'} ${catalogVoice.name} preview`}
                >
                  {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 fill-current" />}
                </button>
                <button
                  type="button"
                  onClick={() => selectVoice(catalogVoice)}
                  className="min-w-0 flex-1 text-left"
                >
                  <span className="block truncate text-sm font-semibold text-gray-900 dark:text-white">
                    {catalogVoice.name}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-gray-500 dark:text-white/45">
                    {voiceDetails(catalogVoice) || displayLanguage}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => selectVoice(catalogVoice)}
                  className={`shrink-0 rounded-md border px-3 py-1.5 text-xs font-semibold transition ${
                    selected
                      ? 'border-blue-500 bg-blue-500 text-white dark:border-blue-400/30 dark:bg-blue-400/10 dark:text-blue-300'
                      : 'border-gray-200 bg-white text-gray-700 shadow-xs hover:bg-gray-100 hover:text-gray-900 dark:border-white/15 dark:bg-transparent dark:text-white/75 dark:hover:bg-white/5 dark:hover:text-white'
                  }`}
                >
                  {selected ? (
                    <span className="flex items-center gap-1">
                      <Check className="h-3.5 w-3.5" />
                      Selected
                    </span>
                  ) : (
                    'Select'
                  )}
                </button>
              </div>
            );
          })}
      </div>

      {error && <p className="text-xs text-red-500 dark:text-red-400">{error}</p>}
    </div>
  );
}
