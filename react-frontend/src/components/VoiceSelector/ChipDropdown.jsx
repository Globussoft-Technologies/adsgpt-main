import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Play, Pause, Loader2, Search } from 'lucide-react';

const TITLE_MAP = {
  language: 'Language',
  gender: 'Gender',
  accent: 'Accent',
  age: 'Age',
  voice: 'Voice',
};

const prettify = (s) =>
  String(s)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

const ChipDropdown = ({
  field,           // 'language' | 'gender' | 'accent' | 'age' | 'voice'
  open,
  anchorRef,
  loading,
  error,
  options,         // strings | {code,label} | {voice_id,name,preview_url}
  value,           // selected value (string for filters, voice_id for voice)
  onSelect,        // (val, meta?) => void
  onClose,
}) => {
  const ref = useRef(null);
  const [playingId, setPlayingId] = useState(null);
  const [query, setQuery] = useState('');
  const audioRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e) => {
      if (ref.current?.contains(e.target)) return;
      if (anchorRef?.current?.contains(e.target)) return;
      onClose?.();
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open, onClose, anchorRef]);

  // Stop any preview audio when the dropdown closes
  useEffect(() => {
    if (!open && audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
      setPlayingId(null);
    }
  }, [open]);

  // Reset search query when dropdown opens/closes
  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const togglePreview = (voice) => {
    const id = voice.voice_id;
    if (audioRef.current && playingId === id) {
      audioRef.current.pause();
      audioRef.current = null;
      setPlayingId(null);
      return;
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (!voice.preview_url) return;
    const a = new Audio(voice.preview_url);
    a.onended = () => {
      audioRef.current = null;
      setPlayingId(null);
    };
    a.onerror = () => {
      audioRef.current = null;
      setPlayingId(null);
    };
    audioRef.current = a;
    setPlayingId(id);
    a.play().catch(() => {
      audioRef.current = null;
      setPlayingId(null);
    });
  };

  // Shared row layout for non-voice options (language, gender, accent, age) —
  // matches the voice row layout (radio circle + label) for visual consistency,
  // minus the play button.
  const renderSimpleRow = (key, label, isSelected, onClick) => (
    <div
      key={key}
      className={`flex items-center gap-2 rounded-md px-3 py-2 text-[13px] transition ${isSelected ? 'bg-black/5 dark:bg-white/10' : 'hover:bg-black/5 dark:hover:bg-white/5'}`}
    >
      <button
        type="button"
        onClick={onClick}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
      >
        <span
          className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border ${isSelected ? 'border-emerald-400' : 'border-gray-300 dark:border-white/30'}`}
        >
          {isSelected && <span className="h-2 w-2 rounded-full bg-emerald-400" />}
        </span>
        <span className="min-w-0 truncate text-gray-700 dark:text-white/90">{label}</span>
      </button>
    </div>
  );

  const renderOption = (opt) => {
    if (field === 'language') {
      const isSelected = value === opt.code;
      return renderSimpleRow(opt.code, opt.label, isSelected, () => onSelect(opt.code, opt));
    }

    if (field === 'voice') {
      const isSelected = value === opt.voice_id;
      const isPlaying = playingId === opt.voice_id;
      return (
        <div
          key={opt.voice_id}
          className={`flex items-center justify-between gap-2 rounded-md px-3 py-2 text-[13px] transition ${isSelected ? 'bg-black/5 dark:bg-white/10' : 'hover:bg-black/5 dark:hover:bg-white/5'}`}
        >
          <button
            type="button"
            onClick={() => onSelect(opt.voice_id, opt)}
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
          >
            <span
              className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border ${isSelected ? 'border-emerald-400' : 'border-gray-300 dark:border-white/30'}`}
            >
              {isSelected && <span className="h-2 w-2 rounded-full bg-emerald-400" />}
            </span>
            <span className="min-w-0 truncate text-gray-700 dark:text-white/90">{opt.name}</span>
          </button>
          {opt.preview_url ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                togglePreview(opt);
              }}
              className="shrink-0 rounded-full bg-black/5 p-1.5 text-gray-500 hover:bg-black/10 hover:text-black dark:bg-white/10 dark:text-white/80 dark:hover:bg-white/20 dark:hover:text-white"
              title={isPlaying ? 'Pause preview' : 'Play preview'}
            >
              {isPlaying ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
            </button>
          ) : (
            <span className="shrink-0 text-[10px] text-gray-400 dark:text-white/30">no preview</span>
          )}
        </div>
      );
    }

    // gender / accent / age — plain strings
    const isSelected = value === opt;
    return renderSimpleRow(opt, prettify(opt), isSelected, () => onSelect(opt));
  };

  const filtered =
    field === 'voice' && query.trim()
      ? options.filter((opt) => opt.name?.toLowerCase().includes(query.toLowerCase()))
      : options;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={ref}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
          className={`absolute z-50 mt-2 w-52 overflow-hidden rounded-xl border border-black/10 bg-white shadow-2xl dark:border-white/10 dark:bg-[#1A1A1A] ${field === 'voice' ? 'right-0' : ''}`}
        >
          <div className="max-h-[120px] overflow-y-auto py-1">
            {loading && (
              <div className="flex items-center gap-2 px-3 py-4 text-[12px] text-gray-500 dark:text-white/50">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
              </div>
            )}
            {!loading && error && (
              <div className="px-3 py-3 text-[12px] text-red-400">{error}</div>
            )}
            {field === 'voice' && (
              <div className="px-3 py-1.5">
                <div className="flex items-center gap-2 rounded-md border border-black/10 bg-gray-100 px-2 py-1 dark:border-white/10 dark:bg-white/5">
                  <Search className="h-3 w-3 shrink-0 text-gray-400 dark:text-white/40" />
                  <input
                    type="text"
                    placeholder="Search voices…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className="w-full bg-transparent text-xs text-gray-700 outline-none placeholder:text-gray-400 dark:text-white/90 dark:placeholder:text-white/40"
                    autoFocus
                  />
                </div>
              </div>
            )}
            {!loading && !error && filtered.length === 0 && (
              <div className="px-3 py-3 text-[12px] text-gray-500 dark:text-white/40">No options</div>
            )}
            {!loading && !error && filtered.map(renderOption)}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default ChipDropdown;
