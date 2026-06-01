import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Check, Search, Globe } from 'lucide-react';

// ----------------------------------------------------------------------------
// TimezoneSelect — searchable IANA-timezone dropdown.
//
// Behaviour:
//   • Reads the full IANA list from `Intl.supportedValuesOf('timeZone')`.
//   • Trigger button shows a compact "(GMT±H:MM) Region/City" label.
//   • Panel has a typeahead search input that filters by either the IANA
//     name OR the GMT offset string.
//   • Click-outside / Escape closes the panel.
//
// No scheduling math is touched — the parent form just stores the value;
// the eventual backend cron worker is the authoritative scheduler.
// ----------------------------------------------------------------------------

const SAFE_FALLBACK = ['UTC'];

export function getBrowserTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function getOffsetLabel(tz) {
  try {
    const parts = new Intl.DateTimeFormat('en', {
      timeZone: tz,
      timeZoneName: 'longOffset',
    }).formatToParts(new Date());
    return parts.find((p) => p.type === 'timeZoneName')?.value || 'GMT';
  } catch {
    return 'GMT';
  }
}

export function describeTimezone(tz) {
  if (!tz) return '';
  return `(${getOffsetLabel(tz)}) ${tz}`;
}

export default function TimezoneSelect({ value, onChange, disabled }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef(null);
  const inputRef = useRef(null);

  const timezones = useMemo(() => {
    try {
      const list = Intl.supportedValuesOf('timeZone');
      return Array.isArray(list) && list.length ? list : SAFE_FALLBACK;
    } catch {
      return SAFE_FALLBACK;
    }
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return timezones;
    return timezones.filter(
      (tz) =>
        tz.toLowerCase().includes(q) || getOffsetLabel(tz).toLowerCase().includes(q)
    );
  }, [query, timezones]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return undefined;
    const handle = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return undefined;
    const handle = (e) => {
      if (e.key === 'Escape') {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('keydown', handle);
    return () => document.removeEventListener('keydown', handle);
  }, [open]);

  // Focus the search input when the panel opens.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const handleSelect = (tz) => {
    onChange?.(tz);
    setOpen(false);
    setQuery('');
  };

  const triggerOffset = value ? getOffsetLabel(value) : '';
  const triggerName = value || 'Select timezone';

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={`flex h-10 w-full items-center justify-between gap-2 rounded-full bg-[#383838]/50 px-4 text-sm backdrop-blur-md transition outline-none disabled:cursor-not-allowed disabled:opacity-50 ${
          value ? 'text-white' : 'text-[#AFAFAF]'
        }`}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <Globe className="size-3.5 shrink-0 text-[#AFAFAF]" />
          {value ? (
            <span className="truncate">
              <span className="text-[#AFAFAF]">{triggerOffset}</span>
              <span className="mx-1 text-[#666]">·</span>
              <span>{triggerName}</span>
            </span>
          ) : (
            <span className="truncate">{triggerName}</span>
          )}
        </span>
        <ChevronDown
          className={`size-4 shrink-0 text-[#AFAFAF] transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.12 }}
            className="absolute top-full right-0 z-50 mt-1 flex w-[min(22rem,90vw)] flex-col overflow-hidden rounded-xl border border-white/15 bg-[#0D0D0D]/95 shadow-2xl backdrop-blur-xl"
          >
            <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
              <Search className="size-3.5 shrink-0 text-[#AFAFAF]" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search timezone or offset…"
                className="h-7 w-full bg-transparent text-sm text-white outline-none placeholder:text-[#666]"
              />
            </div>

            <ul className="max-h-72 overflow-y-auto py-1">
              {filtered.length === 0 ? (
                <li className="px-3 py-4 text-center text-xs text-[#AFAFAF]">
                  No matches for "{query}"
                </li>
              ) : (
                filtered.map((tz) => {
                  const active = tz === value;
                  return (
                    <li key={tz}>
                      <button
                        type="button"
                        onClick={() => handleSelect(tz)}
                        className={`flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-sm transition hover:bg-white/5 ${
                          active ? 'bg-white/5 text-white' : 'text-[#E3E3E3] hover:text-white'
                        }`}
                      >
                        <span className="truncate">
                          <span className="text-[#AFAFAF]">({getOffsetLabel(tz)})</span>{' '}
                          <span>{tz}</span>
                        </span>
                        {active && <Check className="size-3.5 shrink-0 text-[#15DCFF]" />}
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
