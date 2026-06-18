import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, X, Mic2 } from 'lucide-react';
import {
  getLanguages,
  getGenders,
  getAccents,
  getAges,
  getVoices,
} from '@/apis/voiceSelector/voiceSelectorApi';
import ChipDropdown from './ChipDropdown';

const FIELDS = ['language', 'gender', 'accent', 'age', 'voice'];

const prettify = (s) =>
  String(s)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * VoiceSelector — five cascading chips for picking an ElevenLabs voice.
 *
 * Props
 *   value         { language, gender, accent, age, voiceId, voiceName, languageLabel }
 *   onChange      (next) => void   — fired whenever any chip updates
 *   error         string|undefined — render in red if present
 */
const VoiceSelector = ({ value = {}, onChange, error, rightSlot }) => {
  const [openChip, setOpenChip] = useState(null);
  const [options, setOptions] = useState({
    language: [], gender: [], accent: [], age: [], voice: [],
  });
  const [loading, setLoading] = useState({});
  const [errors, setErrors] = useState({});

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
        const upstream = {
          language: value.language || '',
          gender: value.gender || '',
          accent: value.accent || '',
          age: value.age || '',
        };
        let data = [];
        if (field === 'language') {
          // Only English and Hindi are offered for now. Every other locale the
          // catalog returns stays blocked until we support it. Remove the
          // filter below to restore the full language list.
          const ALLOWED_LANGUAGES = ['en', 'hi'];
          const all = await getLanguages();
          data = all.filter((l) => ALLOWED_LANGUAGES.includes(l?.code || l));
          // data = all;
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
    [value.language, value.gender, value.accent, value.age]
  );

  // Lazy-load each chip's options the first time it opens.
  useEffect(() => {
    if (!openChip) return;
    load(openChip);
  }, [openChip, load]);

  const handleSelect = (field, val, meta) => {
    const next = { ...value };
    if (field === 'language') {
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

  const chipLabel = (field) => {
    if (field === 'language' && value.language) return value.languageLabel || value.language.toUpperCase();
    if (field === 'voice' && value.voiceId) return value.voiceName || 'Voice selected';
    if (value[field]) return prettify(value[field]);
    return null;
  };

  const isSelected = (field) =>
    field === 'voice' ? !!value.voiceId : !!value[field];

  return (
    <div className="w-full">
      <div className="mb-1.5 sm:mb-2">
        <label className="flex items-center gap-1.5 text-xs font-medium text-gray-500 dark:text-[#afafaf] sm:text-sm">
          <Mic2 className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
          Narrator Voice <span className="text-red-400">*</span>
        </label>
        <p className="mt-0.5 text-[10px] text-gray-500 dark:text-white/40 sm:text-[11px]">
          Pick the AI voice for the audio narration in your video
        </p>
      </div>

      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-1 flex-wrap items-center gap-2">
        {FIELDS.map((field) => {
          const selected = isSelected(field);
          const label = chipLabel(field);
          return (
            <div key={field} className="relative">
              <button
                ref={anchors[field]}
                type="button"
                onClick={() =>
                  setOpenChip((cur) => (cur === field ? null : field))
                }
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
                {selected ? (
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
                value={field === 'voice' ? value.voiceId : value[field]}
                onSelect={(val, meta) => handleSelect(field, val, meta)}
                onClose={() => setOpenChip(null)}
              />
            </div>
          );
        })}
        </div>
        {rightSlot && <div className="shrink-0">{rightSlot}</div>}
      </div>

      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
    </div>
  );
};

export default VoiceSelector;
