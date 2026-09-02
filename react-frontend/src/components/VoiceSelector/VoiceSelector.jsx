import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, X, Mic2, Search, Play, Pause, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import {
  getLanguages,
  getGenders,
  getAccents,
  getAges,
  getVoices,
  searchVoices,
  labelForLanguage,
  getSarvamLanguages,
  getSarvamGenders,
  getSarvamVoices,
} from '@/apis/voiceSelector/voiceSelectorApi';
import ChipDropdown from './ChipDropdown';

// ElevenLabs uses the full 5-chip cascade; Sarvam only has language → gender →
// voice (no accent/age, no free-text search). FIELDS is chosen per provider.
const EL_FIELDS = ['language', 'gender', 'accent', 'age', 'voice'];
const SARVAM_FIELDS = ['language', 'gender', 'voice'];

// Each provider's catalog is strongest in a different place, and the choice is
// invisible from the labels alone — so the recommendation travels with them.
const PROVIDERS = [
  { id: 'elevenlabs', label: 'ElevenLabs', hint: 'Best for global languages' },
  { id: 'sarvam', label: 'Sarvam', hint: 'Recommended for Indian languages only' },
];

export const PROVIDER_RECOMMENDATION =
  'Sarvam is tuned best for Indian languages';

const DEFAULT_PROVIDER = 'elevenlabs';

// Sentinel language code for the "Other" option. Picking it swaps the cascade
// for a free-text search box (→ /search) so users can find voices for
// languages we don't surface in the language list (Telugu, Kannada, …).
const OTHER_LANG = '__other__';

const prettify = (s) =>
  String(s)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * VoiceSelector — cascading chips for picking a narrator voice, with a leftmost
 * provider selector (ElevenLabs / Sarvam).
 *   • ElevenLabs (default): 5 chips — language → gender → accent → age → voice.
 *   • Sarvam: 3 chips — language → gender → voice (no accent/age, no search).
 *
 * Props
 *   value         { provider, language, gender, accent, age, voiceId, voiceName, languageLabel }
 *   onChange      (next) => void   — fired whenever the provider or any chip updates
 *   error         string|undefined — render in red if present
 *
 * NOTE: `value.provider` still needs to be threaded into the generation payload
 * as `voiceProvider` (Advideoactions.jsx voicePayload + videoModel.js schema)
 * once the Python team confirms the exact key/values — see integration notes.
 */
const VoiceSelector = ({ value = {}, onChange, error, rightSlot, compactHeader = false }) => {
  // Which TTS provider's catalog to browse. Persisted on `value.provider` so a
  // resumed/saved selection reopens on the right provider; defaults to
  // ElevenLabs so existing behaviour is unchanged when nothing is set.
  const provider = value.provider || DEFAULT_PROVIDER;
  const isSarvam = provider === 'sarvam';
  const FIELDS = isSarvam ? SARVAM_FIELDS : EL_FIELDS;
  const [providerOpen, setProviderOpen] = useState(false);
  const providerRef = useRef(null);

  const [openChip, setOpenChip] = useState(null);
  const [options, setOptions] = useState({
    language: [], gender: [], accent: [], age: [], voice: [],
  });
  const [loading, setLoading] = useState({});
  const [errors, setErrors] = useState({});

  // Free-text search ("Other") state. Tracked explicitly via `searchMode` so
  // that `value.language` can hold the picked voice's REAL ISO code (hi/en)
  // instead of the OTHER_LANG sentinel — the sentinel only seeds initial mode
  // for older saved data.
  const [searchMode, setSearchMode] = useState(value.language === OTHER_LANG);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [searchPlayingId, setSearchPlayingId] = useState(null);
  const searchAudioRef = useRef(null);
  const searchRef = useRef(null);

  const isOtherLanguage = searchMode;

  const anchors = {
    language: useRef(null),
    gender:   useRef(null),
    accent:   useRef(null),
    age:      useRef(null),
    voice:    useRef(null),
  };

  // Cascade filtering: each chip fetches options scoped to the upstream picks
  // already made (language → gender → accent → age → voice). The backend reads
  // these as query params (see voiceSelectorController.js / voiceSelectorApi.js).
  // Changing any upstream filter auto-clears downstream selections + cached
  // options via handleSelect, so the next open refetches with the new params.
  const load = useCallback(
    async (field) => {
      setLoading((s) => ({ ...s, [field]: true }));
      setErrors((s) => ({ ...s, [field]: '' }));
      try {
        // Pass only the filters that sit upstream of the field being loaded.
        // value.language now holds a real ISO code (or '' in search mode before a
        // voice is picked), so it can be forwarded directly.
        const upstream = {
          language: value.language || '',
          gender: value.gender || '',
          accent: value.accent || '',
          age: value.age || '',
        };
        let data = [];
        if (isSarvam) {
          // ── Sarvam cascade: language → gender → voice ──────────────────────
          // Sarvam ships its own {code,label} language list (BCP-47 codes like
          // "hi-IN"), a static gender list, and a voice catalog keyed by `lang`
          // + `gender`. Voices carry `voice_name`; map it to `name` so the
          // shared ChipDropdown / chip-label code (which reads `.name`) works
          // unchanged across both providers.
          if (field === 'language') {
            const all = await getSarvamLanguages();
            data = all.map((l) => ({
              code: l?.code || l,
              label: l?.label || labelForLanguage(l?.code || l),
            }));
          } else if (field === 'gender') {
            data = await getSarvamGenders();
          } else if (field === 'voice') {
            const voices = await getSarvamVoices({
              lang: upstream.language,
              gender: upstream.gender,
            });
            data = voices.map((v) => ({ ...v, name: v.voice_name || v.name }));
          }
          setOptions((s) => ({ ...s, [field]: data }));
          return;
        }

        if (field === 'language') {
          // Show every language the catalog returns as a direct pick, then
          // append the "Other" escape hatch (free-text /search) at the end for
          // any locale not surfaced in the list (Telugu, Kannada, …).
          // Normalize each label via labelForLanguage so codes the API sends raw
          // (e.g. "BG", "FIL", "HU") render as proper names (Bulgarian, …).
          const all = await getLanguages();
          data = all.map((l) => {
            const code = l?.code || l;
            return { code, label: labelForLanguage(code) };
          });
          // "Other" (free-text /search) option disabled — no longer offered.
          // data = [...data, { code: OTHER_LANG, label: 'Other' }];
        }
        else if (field === 'gender') data = await getGenders({ language: upstream.language });
        else if (field === 'accent') data = await getAccents({ language: upstream.language, gender: upstream.gender });
        else if (field === 'age') data = await getAges({ language: upstream.language, gender: upstream.gender, accent: upstream.accent });
        else if (field === 'voice') data = await getVoices(upstream);
        setOptions((s) => ({ ...s, [field]: data }));
      } catch (e) {
        setErrors((s) => ({ ...s, [field]: 'Failed to load. Try again.' }));
      } finally {
        setLoading((s) => ({ ...s, [field]: false }));
      }
    },
    [value.language, value.gender, value.accent, value.age, isSarvam]
  );

  // Lazy-load each chip's options the first time it opens.
  useEffect(() => {
    if (!openChip) return;
    load(openChip);
  }, [openChip, load]);

  const handleSelect = (field, val, meta) => {
    // Picking "Other" swaps the cascade for the search box: clear every
    // downstream filter + voice and reset cached options so nothing stale shows.
    if (field === 'language' && val === OTHER_LANG) {
      const next = {
        ...value,
        language: '',           // real code gets filled when a search voice is picked
        languageLabel: 'Other',
        gender: '', accent: '', age: '',
        voiceId: '', voiceName: '',
      };
      setOptions((s) => ({ ...s, gender: [], accent: [], age: [], voice: [] }));
      setSearchMode(true);
      onChange?.(next);
      setOpenChip(null);
      setSearchOpen(true);
      return;
    }

    const next = { ...value };
    if (field === 'language') {
      // Picking a real language (or clearing) exits search mode.
      setSearchMode(false);
      next.language = val;
      next.languageLabel = meta?.label || (val ? val.toUpperCase() : '');
    } else if (field === 'voice') {
      next.voiceId = val;
      next.voiceName = meta?.name || '';
    } else {
      next[field] = val;
    }
    // Any filter change above invalidates downstream picks.
    if (field !== 'voice') {
      const order = ['language', 'gender', 'accent', 'age'];
      const idx = order.indexOf(field);
      order.slice(idx + 1).forEach((f) => { next[f] = ''; });
      next.voiceId = '';
      next.voiceName = '';
      // Reset cached downstream options so they refetch with new params
      setOptions((s) => {
        const cleared = { ...s };
        order.slice(idx + 1).forEach((f) => { cleared[f] = []; });
        cleared.voice = [];
        return cleared;
      });
    }
    onChange?.(next);
    setOpenChip(null);
  };

  const clearChip = (field, e) => {
    e.stopPropagation();
    handleSelect(field, '');
  };

  // Switching provider wipes the current voice + all cascade picks — voice IDs
  // and language codes don't carry across ElevenLabs ↔ Sarvam. Also exits
  // search mode and clears cached options so the new provider refetches clean.
  // Language is non-clearable, so it must keep a valid default per provider:
  // ElevenLabs uses ISO "en", Sarvam uses BCP-47 "en-IN" — both "English".
  const handleProviderChange = (nextProvider) => {
    setProviderOpen(false);
    if (nextProvider === provider) return;
    setSearchMode(false);
    setOpenChip(null);
    setOptions({ language: [], gender: [], accent: [], age: [], voice: [] });
    const defaultLang = nextProvider === 'sarvam' ? 'en-IN' : 'en';
    onChange?.({
      provider: nextProvider,
      language: defaultLang, languageLabel: 'English',
      gender: '', accent: '', age: '',
      voiceId: '', voiceName: '',
    });
  };

  // Close the provider dropdown on outside click.
  useEffect(() => {
    if (!providerOpen) return undefined;
    const onClick = (e) => {
      if (providerRef.current?.contains(e.target)) return;
      setProviderOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [providerOpen]);

  // ── Free-text search (Other language) ──────────────────────────────────
  const stopSearchPreview = useCallback(() => {
    if (searchAudioRef.current) {
      searchAudioRef.current.pause();
      searchAudioRef.current = null;
    }
    setSearchPlayingId(null);
  }, []);

  // Reset all search state whenever we leave "Other" mode.
  useEffect(() => {
    if (!isOtherLanguage) {
      setSearchOpen(false);
      setSearchQuery('');
      setSearchResults([]);
      setSearchError('');
      stopSearchPreview();
    }
  }, [isOtherLanguage, stopSearchPreview]);

  // Close the search popover on outside click — but ignore clicks on the Voice
  // chip itself, which toggles the popover (see its onClick below).
  useEffect(() => {
    if (!(isOtherLanguage && searchOpen)) return undefined;
    const onClick = (e) => {
      if (searchRef.current?.contains(e.target)) return;
      if (anchors.voice.current?.contains(e.target)) return;
      setSearchOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [isOtherLanguage, searchOpen, anchors.voice]);

  // Auto-search as the user types — debounced 400ms so we don't fire a request
  // per keystroke. `ignore` guards against a slow response landing after a newer
  // query has already started.
  useEffect(() => {
    if (!isOtherLanguage) return undefined;
    const q = searchQuery.trim();
    if (!q) {
      setSearchResults([]);
      setSearchError('');
      setSearchLoading(false);
      return undefined;
    }
    let ignore = false;
    setSearchLoading(true);
    setSearchError('');
    const handle = setTimeout(() => {
      searchVoices(q)
        .then((data) => { if (!ignore) setSearchResults(data); })
        .catch(() => { if (!ignore) setSearchError('Search failed. Try again.'); })
        .finally(() => { if (!ignore) setSearchLoading(false); });
    }, 400);
    return () => { ignore = true; clearTimeout(handle); };
  }, [searchQuery, isOtherLanguage]);

  // Selecting a search result sets the voice and back-fills the gender / accent
  // chips from the voice's own metadata (the /search payload carries both), so
  // the picker reflects what was actually chosen. Language stays "Other" so the
  // search box remains available, but languageLabel becomes the term the user
  // searched (e.g. "Punjabi") instead of a hardcoded "Other" — that's what they
  // actually intended. Closes the popover (re-open via the Voice chip).
  const selectSearchVoice = (v) => {
    const term = searchQuery.trim();
    onChange?.({
      ...value,
      language: v.language || '',                 // real ISO code the voice is cataloged under (hi/en)
      languageLabel: term ? prettify(term) : value.languageLabel || 'Other',
      voiceId: v.voice_id,
      voiceName: v.name,
      gender: v.gender || '',
      accent: v.accent || '',
    });
    stopSearchPreview();
    setSearchOpen(false);
  };

  const toggleSearchPreview = (v) => {
    const id = v.voice_id;
    if (searchAudioRef.current && searchPlayingId === id) {
      stopSearchPreview();
      return;
    }
    stopSearchPreview();
    if (!v.preview_url) return;
    const a = new Audio(v.preview_url);
    a.onended = () => stopSearchPreview();
    a.onerror = () => stopSearchPreview();
    searchAudioRef.current = a;
    setSearchPlayingId(id);
    a.play().catch(() => stopSearchPreview());
  };

  const chipLabel = (field) => {
    if (field === 'language') {
      // In search mode show the searched term (e.g. "Punjabi"), falling back to
      // "Other" before a voice is picked; otherwise the normal language label.
      if (searchMode) return value.languageLabel || 'Other';
      if (value.language) return value.languageLabel || value.language.toUpperCase();
      return null;
    }
    if (field === 'voice' && value.voiceId) return value.voiceName || 'Voice selected';
    if (value[field]) return prettify(value[field]);
    return null;
  };

  const isSelected = (field) => {
    if (field === 'voice') return !!value.voiceId;
    if (field === 'language') return searchMode || !!value.language;
    return !!value[field];
  };

  return (
    <div className="w-full">
      <div
        className={`mb-1.5 sm:mb-2 ${
          compactHeader ? 'flex flex-wrap items-center gap-x-2 gap-y-0.5' : ''
        }`}
      >
        <label className="flex items-center gap-1.5 text-xs font-medium text-gray-500 dark:text-[#afafaf] sm:text-sm">
          <Mic2 className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
          Narrator Voice <span className="text-red-400">*</span>
        </label>
        <p
          className={`text-[10px] text-gray-500 dark:text-white/40 sm:text-[11px] ${
            compactHeader ? '' : 'mt-0.5'
          }`}
        >
          Pick the AI voice for the audio narration in your video
        </p>
        <p
          className={`text-[10px] text-gray-500 dark:text-white/40 sm:text-[11px] ${
            compactHeader ? '' : 'mt-0.5'
          }`}
        >
          {PROVIDER_RECOMMENDATION}
        </p>
      </div>

      <div className="relative flex items-start justify-between gap-3">
        <div className="flex flex-1 flex-wrap items-center gap-2">
        {/* Provider selector — leftmost. Picking Sarvam swaps the cascade to
            language → gender → voice against the Sarvam catalog; ElevenLabs
            keeps the full 5-chip cascade. Defaults to ElevenLabs. */}
        <div ref={providerRef} className="relative">
          <button
            type="button"
            onClick={() => setProviderOpen((o) => !o)}
            className="group flex items-center gap-1.5 rounded-full border border-transparent bg-gray-200 px-3 py-1 text-[12px] font-medium text-gray-900 transition dark:bg-[#3A3A3A] dark:text-white sm:text-13"
          >
            <ChevronUp className="h-3 w-3" />
            <span>
             Voice Model
              <span className="ml-1 text-gray-500 dark:text-white/60">
                : {PROVIDERS.find((p) => p.id === provider)?.label || 'ElevenLabs'}
              </span>
            </span>
          </button>
          {providerOpen && (
            <div className="absolute left-0 bottom-full z-50 mb-2 w-52 overflow-hidden rounded-xl border border-black/10 bg-white py-1 shadow-2xl dark:border-white/10 dark:bg-[#1A1A1A]">
              {PROVIDERS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handleProviderChange(p.id)}
                  className={`flex w-full flex-col items-start px-3 py-2 text-left text-13 transition ${
                    p.id === provider
                      ? 'bg-black/5 text-gray-900 dark:bg-white/10 dark:text-white'
                      : 'text-gray-700 hover:bg-black/5 dark:text-white/80 dark:hover:bg-white/5'
                  }`}
                >
                  {p.label}
                  <span className="text-[10px] text-gray-500 dark:text-white/45">{p.hint}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {FIELDS.map((field) => {
          const selected = isSelected(field);
          const label = chipLabel(field);
          return (
            <div key={field} className="relative">
              <button
                ref={anchors[field]}
                type="button"
                onClick={() => {
                  // In "Other" mode the Voice chip toggles the search popover
                  // instead of the cascade dropdown.
                  if (field === 'voice' && isOtherLanguage) {
                    setOpenChip(null);
                    setSearchOpen((o) => !o);
                    return;
                  }
                  setOpenChip((cur) => (cur === field ? null : field));
                }}
                className={`group flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] font-medium transition sm:text-[13px] ${
                  field === 'voice'
                    ? selected
                      ? 'border-emerald-400/50 bg-emerald-400/10 text-gray-900 dark:text-white shadow-[0_0_8px_rgba(52,211,153,0.2)]'
                      : 'border-emerald-400/25 bg-emerald-400/5 text-emerald-700 dark:text-emerald-100 shadow-[0_0_4px_rgba(52,211,153,0.12)] hover:border-emerald-400/60 hover:text-black dark:hover:text-white'
                    : selected
                      ? 'border-transparent bg-gray-200 text-gray-900 dark:bg-[#3A3A3A] dark:text-white'
                      : 'border-black/10 bg-gray-100 text-gray-500 hover:text-black dark:border-white/10 dark:bg-[#909294]/15 dark:text-white/70 dark:hover:text-white'
                }`}
              >
                {/* Language is the root of the cascade — clearing it would leave
                    the voice list with no filter and return nothing, so it's not
                    clearable (always keeps a value; defaults to English). */}
                {field === 'language' ? null : selected ? (
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => clearChip(field, e)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') clearChip(field, e);
                    }}
                    className="inline-flex h-3.5 w-3.5 cursor-pointer items-center justify-center rounded-full text-gray-500 hover:text-black dark:text-white/70 dark:hover:text-white"
                    aria-label={`Clear ${field}`}
                  >
                    <X className="h-3 w-3" />
                  </span>
                ) : (
                  <Plus className="h-3 w-3" />
                )}
                <span>
                  {prettify(field === 'voice' ? 'voice' : field)}
                  {selected && label && (
                    <span className="ml-1 text-gray-500 dark:text-white/60">: {label}</span>
                  )}
                </span>
              </button>

              <ChipDropdown
                field={field}
                open={openChip === field}
                anchorRef={anchors[field]}
                loading={!!loading[field]}
                error={errors[field]}
                options={options[field] || []}
                value={
                  field === 'voice'
                    ? value.voiceId
                    : field === 'language' && searchMode
                      ? OTHER_LANG
                      : value[field]
                }
                onSelect={(val, meta) => handleSelect(field, val, meta)}
                onClose={() => setOpenChip(null)}
              />
            </div>
          );
        })}
        </div>
        {rightSlot && <div className="shrink-0">{rightSlot}</div>}

        {/* Free-text search — a floating dropdown sized like the chip dropdowns
            and positioned upward so it never clips. Auto-searches /search as you type;
            picking a result sets the voice exactly like the Voice chip does. */}
        {isOtherLanguage && searchOpen && (
          <div
            ref={searchRef}
            className="absolute left-0 bottom-full z-[99] mb-2 w-64 overflow-hidden rounded-2xl border border-black/10 bg-white/95 p-1.5 shadow-2xl backdrop-blur-xl dark:border-white/10 dark:bg-[#1C1C1E]/95"
          >
            {/* Single capped scroll container */}
            <div className="mb-1 px-1 pt-0.5">
              <div className="flex items-center gap-2 rounded-lg border border-black/10 bg-gray-100/80 px-2.5 py-1.5 dark:border-white/10 dark:bg-white/5">
                <Search className="h-3.5 w-3.5 shrink-0 text-gray-400 dark:text-white/40" />
                <input
                  type="text"
                  placeholder="Search language…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-transparent text-[12px] text-gray-700 outline-none placeholder:text-gray-400 dark:text-white/90 dark:placeholder:text-white/40"
                  autoFocus
                />
              </div>
            </div>

            <div className="max-h-[190px] overflow-y-auto pr-0.5 [scrollbar-width:thin]">
              {searchLoading && (
                <div className="flex items-center justify-center gap-2 py-4 text-[12px] text-gray-500 dark:text-white/50">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Searching…
                </div>
              )}
              {!searchLoading && searchError && (
                <div className="px-3 py-3 text-[12px] text-red-400">{searchError}</div>
              )}
              {!searchLoading && !searchError && searchResults.length === 0 && searchQuery.trim() && (
                <div className="py-3 text-center text-[12px] text-gray-500 dark:text-white/40">No voices found</div>
              )}
              {!searchLoading && !searchError &&
                searchResults.map((v) => {
                  const selected = value.voiceId === v.voice_id;
                  const isPlaying = searchPlayingId === v.voice_id;
                  return (
                    <div
                      key={v.voice_id}
                      className={`flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-[12px] transition-colors ${
                        selected ? 'bg-black/5 dark:bg-white/10 font-medium' : 'hover:bg-black/5 dark:hover:bg-white/5'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => selectSearchVoice(v)}
                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      >
                        <span
                          className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border ${
                            selected ? 'border-[#02C8C4] dark:border-[#15DCFF]' : 'border-gray-300 dark:border-white/30'
                          }`}
                        >
                          {selected && <span className="h-1.5 w-1.5 rounded-full bg-[#02C8C4] dark:bg-[#15DCFF]" />}
                        </span>
                        <span className="min-w-0 truncate text-gray-700 dark:text-white/90">
                          {v.name}
                        </span>
                      </button>
                      {v.preview_url ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleSearchPreview(v);
                          }}
                          className="shrink-0 rounded-full bg-black/5 p-1 text-gray-500 hover:bg-black/10 hover:text-black dark:bg-white/10 dark:text-white/80 dark:hover:bg-white/20 dark:hover:text-white"
                          title={isPlaying ? 'Pause preview' : 'Play preview'}
                        >
                          {isPlaying ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                        </button>
                      ) : (
                        <span className="shrink-0 text-[10px] text-gray-400 dark:text-white/30">
                          no preview
                        </span>
                      )}
                    </div>
                  );
                })}
            </div>
          </div>
        )}
      </div>

      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
    </div>
  );
};

export default VoiceSelector;
