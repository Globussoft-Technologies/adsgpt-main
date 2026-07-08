import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { BRAND_CATEGORIES } from '@/utils/brandCategories';

// Searchable category field: the input itself filters the 45 categories as you
// type, with a chevron button to open/close the full list. `triggerClassName`
// styles the field container to match each form. `value` is a category name
// string ('' = none selected).
export default function CategoryCombobox({
  value,
  onChange,
  placeholder = 'Search or select a category…',
  triggerClassName = '',
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapperRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return BRAND_CATEGORIES;
    return BRAND_CATEGORIES.filter((c) => c.toLowerCase().includes(q));
  }, [query]);

  // Show the live search text while open; the committed value when closed.
  const displayValue = open ? query : value || '';

  const commit = (c) => {
    onChange(c);
    setQuery('');
    setOpen(false);
  };

  return (
    <div ref={wrapperRef} className="relative w-full">
      <div className={`flex items-center gap-2 ${triggerClassName}`}>
        <input
          ref={inputRef}
          type="text"
          value={displayValue}
          placeholder={placeholder}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!open) setOpen(true);
          }}
          onFocus={() => {
            setQuery('');
            setOpen(true);
          }}
          className="w-full min-w-0 bg-transparent outline-none placeholder:text-gray-500 dark:placeholder:text-[#AFAFAF]"
        />
        <button
          type="button"
          tabIndex={-1}
          aria-label="Toggle category list"
          onClick={() => {
            setOpen((o) => !o);
            if (!open) inputRef.current?.focus();
          }}
          className="shrink-0"
        >
          <ChevronDown
            size={16}
            className={`opacity-60 transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </button>
      </div>

      {open && (
        <div className="absolute top-full left-0 z-9999 mt-1 max-h-60 w-full overflow-auto rounded-xl border border-black/10 bg-white p-1 shadow-lg dark:border-white/20 dark:bg-[#0D0D0D]">
          {filtered.length === 0 ? (
            <div className="py-3 text-center text-sm text-zinc-500 dark:text-[#AFAFAF]">
              No category found.
            </div>
          ) : (
            filtered.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => commit(c)}
                className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-sm text-zinc-800 hover:bg-zinc-100 dark:text-white/90 dark:hover:bg-white/10 ${
                  value === c ? 'bg-zinc-100 dark:bg-white/10' : ''
                }`}
              >
                {c}
                {value === c && (
                  <Check size={14} className="shrink-0 text-cyan-600 dark:text-cyan-300" />
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
