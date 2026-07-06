/**
 * DetailedTargetingPicker.jsx — reusable picker for one of the three
 * Detailed Targeting sections (Include / Narrow / Exclude). The parent
 * `<DetailedTargeting>` mounts this three times with different value
 * slots; behaviour stays identical except for placeholder text + tone.
 *
 * Responsibilities:
 *   • Debounced typeahead against `searchDetailedTargeting`
 *   • Render results as Meta-style rows with type-badge + audience-size hint
 *   • Render the selected items as removable chips below the input
 *   • Optional "Browse" CTA that opens the categorical drawer (caller-owned)
 *
 * The component is value/onChange controlled — parent owns state. Item shape:
 *
 *   { type: 'interests' | 'behaviors' | 'demographics' | ...,  // 15 classes
 *     id: string,
 *     name: string,
 *     audienceSize?: number,                                   // when known
 *     path?: string[] }                                        // e.g. ['Interests', 'Sports', 'Yoga']
 *
 * SAC interaction (regulated SACs hide Detailed Targeting entirely) is
 * enforced one level up — this component just renders. See
 * `<DetailedTargeting>` for the gate logic.
 */

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Search, X, Loader2 } from 'lucide-react';
import { searchDetailedTargeting } from '@/apis/metaAds/metaAdsApi';
import DetailedTargetingPillarTree from './DetailedTargetingPillarTree';

// Badge color rule — derived from the item's pillar (`path[0]`), NOT a
// 14-entry class allowlist. Meta's browse / search responses already
// carry the pillar per-item; deriving here keeps any new class Meta adds
// rendering with the right color automatically.
//
// Three pillars → three colour families:
//   Interests   → sky
//   Behaviours  → amber  (UK / US spelling tolerated)
//   Demographics + sub-classes → violet
//   Anything else → gray fallback
const PILLAR_COLOR_RULES = [
  {
    test: (s) => /^interest/i.test(s),
    color: 'bg-sky-100 text-sky-700 dark:bg-sky-400/15 dark:text-sky-200',
  },
  {
    test: (s) => /^behavio/i.test(s),
    color: 'bg-amber-100 text-amber-700 dark:bg-amber-400/15 dark:text-amber-200',
  },
  {
    test: (s) => /^demographic/i.test(s),
    color: 'bg-violet-100 text-violet-700 dark:bg-violet-400/15 dark:text-violet-200',
  },
];
const FALLBACK_COLOR = 'bg-gray-200 text-gray-600 dark:bg-white/10 dark:text-white/70';

// Stable empty-Set default for the `invalidKeys` prop — a fresh `new
// Set()` literal as a default value would change identity every render
// and defeat memoization on any consumer that depends on it.
const EMPTY_SET = new Set();

// snake_case → "Title case" — derives a display label from the class
// (e.g. `education_statuses` → "Education statuses", `interests` →
// "Interests"). Plain string transform — no per-class allowlist.
function classToLabel(type) {
  if (!type) return 'Unknown';
  const spaced = String(type).replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// typeBadge — given an item (or just a class string), returns the
// label + color for its badge. Pass the full item when possible so the
// pillar can be read from `path[0]`; when only `type` is available
// (e.g. selected chips that don't carry path), the pillar is inferred
// from the demographics convention (anything that isn't "interests" or
// "behaviors" is treated as Demographics).
export function typeBadge(typeOrItem) {
  const item = typeof typeOrItem === 'object' && typeOrItem !== null ? typeOrItem : null;
  const type = item ? item.type : typeOrItem;
  const pillarHint = item?.path?.[0] || (type === 'interests' || type === 'behaviors' ? type : 'demographics');
  const rule = PILLAR_COLOR_RULES.find((r) => r.test(pillarHint));
  return {
    label: classToLabel(type),
    color: rule ? rule.color : FALLBACK_COLOR,
  };
}

// Meta-style audience-size hint. Two formatters live here:
//
//   • formatAudienceRange(lower, upper) — Meta UI's "Size: 12,857 - 15,120"
//     wording with comma-separated full numbers. Use this anywhere the
//     row has room for the full range — the dropdown / tree / search-only
//     results all do.
//
//   • formatAudienceSize(n) — compact "12K" / "1.2M" for the cramped
//     chip surface where Meta also uses a short form.
//
// Both return '' on non-finite input so callers can render nothing
// without explicit guards.
// Compact number formatter — keeps row text short in dropdowns / trees
// where full locale strings (e.g. "999,071,723") waste too much space.
//   1_234       → "1K"
//   1_234_567   → "1.2M"
//   12_345_678  → "12.3M"
//   999_000_000 → "999M"
//   1_174_000_000 → "1.2B"
function formatCompact(n) {
  if (!Number.isFinite(n)) return '';
  if (n >= 1_000_000_000) {
    return `${(n / 1_000_000_000).toFixed(n >= 10_000_000_000 ? 0 : 1)}B`;
  }
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  }
  if (n >= 1_000) {
    return `${Math.round(n / 1_000)}K`;
  }
  return String(Math.round(n));
}

function formatAudienceRange(lower, upper) {
  const lo = Number(lower);
  const hi = Number(upper);
  const haveLo = Number.isFinite(lo);
  const haveHi = Number.isFinite(hi);
  if (!haveLo && !haveHi) return '';
  if (haveLo && haveHi) {
    // Identical bounds → render the single number instead of "X - X".
    if (lo === hi) return `Size: ${formatCompact(lo)}`;
    return `Size: ${formatCompact(lo)} - ${formatCompact(hi)}`;
  }
  return `Size: ${formatCompact(haveLo ? lo : hi)}`;
}

function formatAudienceSize(n) {
  return formatCompact(n);
}

export default function DetailedTargetingPicker({
  // Required — Meta's detailed-targeting endpoints live on the ad-account
  // node (`/act_X/targetingsearch`). Without it, the backend 400s.
  adAccountId,
  value = [],
  onChange,
  placeholder = 'Add demographics, interests or behaviours',
  disabled = false,
  // Optional `classes` query — for sections that should only surface a
  // subset of classes. Default = all 14. (Meta UI uses one picker across
  // all classes; this is here for future Phase-3+ specialisations.)
  classes,
  // Set of "type:id" keys Meta has discontinued since the user picked
  // them (see DetailedTargeting.jsx's validateDetailedTargeting effect).
  // Flagged chips render in red with a "Discontinued" tag so the user
  // knows to remove them before Launch, instead of finding out from
  // Meta's opaque subcode 1870211 at publish time.
  invalidKeys = EMPTY_SET,
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  // Stable key for dedup + already-added check.
  const selectedKeys = useMemo(
    () => new Set(value.map((i) => `${i.type}:${i.id}`)),
    [value],
  );

  // Debounced search (250ms — same cadence as LocationTargeting).
  useEffect(() => {
    const q = query.trim();
    if (!q || !adAccountId) {
      setResults([]);
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await searchDetailedTargeting({ adAccountId, q, classes, limit: 25 });
        setResults(r?.results || []);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [adAccountId, query, classes]);

  // Click-outside closes the dropdown.
  useEffect(() => {
    if (!open) return undefined;
    const onClick = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const add = useCallback(
    (row) => {
      const k = `${row.type}:${row.id}`;
      if (selectedKeys.has(k)) return;
      onChange?.([
        ...value,
        {
          type: row.type,
          id: String(row.id),
          name: row.name,
          ...(row.audienceSize != null && { audienceSize: row.audienceSize }),
          ...(row.audienceSizeUpperBound != null && {
            audienceSizeUpperBound: row.audienceSizeUpperBound,
          }),
          ...(Array.isArray(row.path) && row.path.length && { path: row.path }),
        },
      ]);
      setQuery('');
      setResults([]);
    },
    [value, onChange, selectedKeys],
  );

  const remove = useCallback(
    (idx) => onChange?.(value.filter((_, i) => i !== idx)),
    [value, onChange],
  );

  // Click from the inline pillar tree — Meta UI's "tap a leaf to toggle"
  // multi-select. Add if absent, remove if already picked.
  const togglePick = useCallback(
    (item) => {
      const k = `${item.type}:${item.id}`;
      const existingIdx = value.findIndex(
        (i) => `${i.type}:${i.id}` === k,
      );
      if (existingIdx >= 0) {
        onChange?.(value.filter((_, i) => i !== existingIdx));
      } else {
        onChange?.([
          ...value,
          {
            type: item.type,
            id: String(item.id),
            name: item.name,
            ...(item.audienceSize != null && { audienceSize: item.audienceSize }),
            ...(item.audienceSizeUpperBound != null && {
              audienceSizeUpperBound: item.audienceSizeUpperBound,
            }),
            ...(Array.isArray(item.path) && item.path.length && { path: item.path }),
          },
        ]);
      }
    },
    [value, onChange],
  );

  return (
    <div ref={containerRef} className="relative flex flex-col gap-2">
      {/* Search input row */}
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-white/40" />
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          disabled={disabled}
          className="w-full rounded-full border border-gray-300 bg-gray-100 py-2.5 pl-9 pr-9 text-13 text-gray-900 placeholder:text-gray-400 transition-colors hover:border-gray-400 focus:border-gray-400 focus:outline-none disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:bg-[#171717] dark:text-white dark:placeholder:text-white/40 dark:hover:border-white/15 dark:focus:border-white/25"
        />
        {/* Loading spinner — Browse button was removed 2026-06-29 in
            favour of the inline pillar tree below (matching Meta UI). */}
        {loading && (
          <Loader2 className="absolute top-1/2 right-3 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-gray-500 dark:text-white/55" />
        )}

        {/* Dropdown — anchored below the input */}
        {open && query.trim() && (
          <div className="scrollbar-thin absolute top-full left-0 right-0 z-50 mt-1 max-h-72 overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-xl dark:border-white/10 dark:bg-[#1A1A1A]">
            {!loading && results.length === 0 ? (
              <div className="px-3 py-3 text-12 text-gray-500 dark:text-white/45">
                No matches. Try a different spelling.
              </div>
            ) : (
              results.map((r) => {
                const k = `${r.type}:${r.id}`;
                const already = selectedKeys.has(k);
                // Pass the whole row so the badge color comes from path[0]
                // (the pillar in Meta's response) instead of the legacy
                // class-name convention.
                const badge = typeBadge(r);
                const sizeText = formatAudienceRange(r.audienceSize, r.audienceSizeUpperBound);
                // Full precise audience size for the hover tooltip.
                const sizeTitle = [r.audienceSize, r.audienceSizeUpperBound]
                  .filter((n) => Number.isFinite(Number(n)))
                  .map((n) => Math.round(Number(n)).toLocaleString('en-US'))
                  .join(' - ');
                return (
                  <button
                    type="button"
                    key={k}
                    disabled={already}
                    onClick={() => add(r)}
                    className={`flex w-full items-start justify-between gap-2 border-b border-gray-200 px-3 py-2 text-left transition-colors last:border-b-0 dark:border-white/5 ${
                      already
                        ? 'cursor-not-allowed opacity-40'
                        : 'hover:bg-gray-100 dark:hover:bg-white/5'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-13 font-medium text-gray-900 dark:text-white" title={r.name}>
                        {r.name}
                      </p>
                      {Array.isArray(r.path) && r.path.length > 0 && (
                        <p
                          className="truncate text-11 text-gray-500 dark:text-white/45"
                          title={r.path.join(' > ')}
                        >
                          {r.path.join(' > ')}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {sizeText && (
                        <span
                          title={sizeTitle || undefined}
                          className="text-11 text-gray-600 dark:text-white/60"
                        >
                          {sizeText}
                        </span>
                      )}
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-10 font-semibold uppercase tracking-wide ${badge.color}`}
                      >
                        {badge.label}
                      </span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* Selected chips */}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((item, idx) => {
            // Pass the whole item — `add`/`togglePick` persist `path` when
            // it's present (search dropdown + tree both carry it), so chips
            // get pillar-accurate colors. Chips lacking `path` fall back to
            // the convention inside `typeBadge`.
            const badge = typeBadge(item);
            const isInvalid = invalidKeys.has(`${item.type}:${item.id}`);
            return (
              <span
                key={`${item.type}:${item.id}`}
                className={
                  isInvalid
                    ? 'inline-flex items-center gap-1.5 rounded-full border border-red-300 bg-red-50 px-2.5 py-1 text-12 text-red-700 dark:border-red-400/40 dark:bg-red-400/10 dark:text-red-200'
                    : 'inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-2.5 py-1 text-12 text-gray-900 dark:bg-white/5 dark:text-white'
                }
                title={
                  isInvalid
                    ? 'Discontinued by Meta — remove this before launching, Meta will reject the ad set otherwise.'
                    : undefined
                }
              >
                {isInvalid ? (
                  <span className="rounded-full bg-red-600 px-1.5 py-0.5 text-10 font-semibold uppercase tracking-wide text-white dark:bg-red-500">
                    Discontinued
                  </span>
                ) : (
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-10 font-semibold uppercase tracking-wide ${badge.color}`}
                  >
                    {badge.label}
                  </span>
                )}
                <span
                  className={`max-w-[20ch] truncate ${isInvalid ? 'line-through decoration-red-400' : ''}`}
                  title={item.name}
                >
                  {item.name}
                </span>
                {!disabled && (
                  <button
                    type="button"
                    onClick={() => remove(idx)}
                    className={
                      isInvalid
                        ? 'text-red-500 hover:text-red-700 dark:text-red-300 dark:hover:text-red-100'
                        : 'text-gray-500 hover:text-gray-700 dark:text-white/55 dark:hover:text-white'
                    }
                    aria-label={`Remove ${item.name}`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </span>
            );
          })}
        </div>
      )}

      {/* Inline pillar accordion — Meta UI parity. Three pillars
          (Demographics / Interests / Behaviours) rendered as collapsible
          rows below the input + chips. `selectedKeys` drives the leaf
          checkbox state so picks made via search also reflect here. */}
      {adAccountId && (
        <DetailedTargetingPillarTree
          adAccountId={adAccountId}
          onPick={togglePick}
          existingKeys={selectedKeys}
        />
      )}
    </div>
  );
}

// Re-export so the pillar tree + reach-estimate widget can render
// matching badges + size formatting without redefining them.
export { formatAudienceSize, formatAudienceRange };
