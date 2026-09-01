import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
  const [coords, setCoords] = useState({ top: 0, left: 0, scrollMaxHeight: 180 });
  const audioRef = useRef(null);

  // Compute fixed screen coordinates and clamp height to available viewport space
  useEffect(() => {
    if (!open || !anchorRef?.current) return;
    const updatePosition = () => {
      const rect = anchorRef.current?.getBoundingClientRect();
      if (!rect) return;
      const dropdownWidth = 260;

      const dialogEl = anchorRef.current?.closest('[role="dialog"]');
      const containerRect = dialogEl ? dialogEl.getBoundingClientRect() : null;
      const rightBoundary = containerRect ? containerRect.right - 16 : window.innerWidth - 12;
      const leftBoundary = containerRect ? containerRect.left + 16 : 12;

      let left = rect.left;
      if (field === 'voice' || left + dropdownWidth > rightBoundary) {
        left = rect.right - dropdownWidth;
      }

      // Keep within boundaries
      if (left + dropdownWidth > rightBoundary) {
        left = rightBoundary - dropdownWidth;
      }
      if (left < leftBoundary) {
        left = leftBoundary;
      }

      // Calculate available space between button bottom and window bottom (leaving 24px margin)
      const spaceBelow = window.innerHeight - rect.bottom - 24;
      const headerOffset = field === 'voice' ? 44 : 8;
      const scrollMaxHeight = Math.max(90, Math.min(180, spaceBelow - headerOffset));

      setCoords({
        top: rect.bottom + 6,
        left,
        scrollMaxHeight,
      });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open, anchorRef, field]);

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

  // Shared row layout for non-voice options (language, gender, accent, age)
  const renderSimpleRow = (key, label, isSelected, onClick) => (
    <div
      key={key}
      className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12px] transition-colors ${
        isSelected ? 'bg-black/5 dark:bg-white/10 font-medium' : 'hover:bg-black/5 dark:hover:bg-white/5'
      }`}
    >
      <button
        type="button"
        onClick={onClick}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
      >
        <span
          className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border ${
            isSelected ? 'border-[#02C8C4] dark:border-[#15DCFF]' : 'border-gray-300 dark:border-white/30'
          }`}
        >
          {isSelected && <span className="h-1.5 w-1.5 rounded-full bg-[#02C8C4] dark:bg-[#15DCFF]" />}
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
          className={`flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-[12px] transition-colors ${
            isSelected ? 'bg-black/5 dark:bg-white/10 font-medium' : 'hover:bg-black/5 dark:hover:bg-white/5'
          }`}
        >
          <button
            type="button"
            onClick={() => onSelect(opt.voice_id, opt)}
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
          >
            <span
              className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border ${
                isSelected ? 'border-[#02C8C4] dark:border-[#15DCFF]' : 'border-gray-300 dark:border-white/30'
              }`}
            >
              {isSelected && <span className="h-1.5 w-1.5 rounded-full bg-[#02C8C4] dark:bg-[#15DCFF]" />}
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
              className="shrink-0 rounded-full bg-black/5 p-1 text-gray-500 hover:bg-black/10 hover:text-black dark:bg-white/10 dark:text-white/80 dark:hover:bg-white/20 dark:hover:text-white"
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

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          ref={ref}
          initial={{ opacity: 0, y: -4, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -4, scale: 0.98 }}
          transition={{ duration: 0.12 }}
          style={{
            position: 'fixed',
            top: `${coords.top}px`,
            left: `${coords.left}px`,
            zIndex: 999999,
          }}
          className="w-64 overflow-hidden rounded-2xl border border-black/10 bg-white/95 p-1.5 shadow-[0_20px_50px_rgba(0,0,0,0.35)] backdrop-blur-2xl dark:border-white/10 dark:bg-[#1C1C1E]/95 dark:shadow-[0_20px_50px_rgba(0,0,0,0.7)]"
        >
          {field === 'voice' && (
            <div className="mb-1 px-1 pt-0.5">
              <div className="flex items-center gap-2 rounded-lg border border-black/10 bg-gray-100/80 px-2.5 py-1.5 dark:border-white/10 dark:bg-white/5">
                <Search className="h-3.5 w-3.5 shrink-0 text-gray-400 dark:text-white/40" />
                <input
                  type="text"
                  placeholder="Search voices…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="w-full bg-transparent text-[12px] text-gray-700 outline-none placeholder:text-gray-400 dark:text-white/90 dark:placeholder:text-white/40"
                  autoFocus
                />
              </div>
            </div>
          )}

          <div
            style={{ maxHeight: `${coords.scrollMaxHeight}px` }}
            className="overflow-y-auto pr-0.5 [scrollbar-width:thin]"
          >
            {loading && (
              <div className="flex items-center justify-center gap-2 py-4 text-[12px] text-gray-500 dark:text-white/50">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
              </div>
            )}
            {!loading && error && (
              <div className="px-3 py-3 text-[12px] text-red-400">{error}</div>
            )}
            {!loading && !error && filtered.length === 0 && (
              <div className="py-3 text-center text-[12px] text-gray-500 dark:text-white/40">No options found</div>
            )}
            {!loading && !error && filtered.map(renderOption)}
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
};

export default ChipDropdown;
