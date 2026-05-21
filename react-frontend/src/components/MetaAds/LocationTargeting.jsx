/**
 * LocationTargeting — V2 wizard's Meta-parity Locations picker.
 *
 * Phase 1 (see docs/LOCATION_TARGETING_PLAN.md): debounced typeahead
 * against `/meta-ads/search-geo` returning countries / cities (with km
 * radius) / regions / free-trade-area country-groups. Each selected
 * location renders as a chip with Include/Exclude switch + remove; cities
 * get a km radius control.
 *
 * Stored on the wizard form as `locations: []`, each entry shaped:
 *   { type, key, name, mode: 'include' | 'exclude',
 *     radius?, distanceUnit? }   // radius/unit only meaningful on cities.
 *
 * Phase 2 will add the browse-tree + bulk add; Phase 3 the map +
 * drop-pin (a new `type: 'custom'` with lat/lng + radius).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search, X, Loader2, MapPin } from 'lucide-react';
import { searchGeoLocations } from '@/apis/metaAds/metaAdsApi';
import { FieldShell } from './wizardFields';

// City radius — Meta accepts 1–80 km on `cities[].radius` for
// distance_unit: 'kilometer'.
const CITY_RADIUS_MIN_KM = 1;
const CITY_RADIUS_MAX_KM = 80;
const CITY_RADIUS_DEFAULT_KM = 25;

// Visible badge per type — short, distinct colours so Country / City /
// Region / Area read at a glance.
const TYPE_BADGE = {
  country: { label: 'Country', color: 'bg-emerald-400/15 text-emerald-200' },
  city: { label: 'City', color: 'bg-sky-400/15 text-sky-200' },
  region: { label: 'Region', color: 'bg-violet-400/15 text-violet-200' },
  country_group: { label: 'Area', color: 'bg-amber-400/15 text-amber-200' },
};

function typeBadge(type) {
  return TYPE_BADGE[type] || { label: type, color: 'bg-white/10 text-white/70' };
}

// Friendly secondary line — for cities: "Delhi, India"; for regions:
// "Maharashtra, India"; for countries: just the name; for groups: blank.
function secondaryLine(r) {
  if (r.type === 'country') return '';
  if (r.type === 'country_group') return '';
  const bits = [r.region, r.countryName].filter(Boolean);
  return bits.join(', ');
}

export default function LocationTargeting({
  value = [],
  onChange,
  disabled = false,
  error,
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  // Existing-key set for de-dup — both modes (include/exclude) share the
  // namespace, so adding a country that's already excluded just flips
  // the mode (handled below via add()).
  const selectedKeys = useMemo(
    () => new Set(value.map((l) => `${l.type}:${l.key}`)),
    [value],
  );

  // Debounced search. 250ms — fast enough to feel responsive, slow
  // enough to avoid firing a request per keystroke.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await searchGeoLocations({ q, limit: 25 });
        setResults(r?.results || []);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  // Click-outside closes the suggestions dropdown.
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
      const k = `${row.type}:${row.key}`;
      const existingIdx = value.findIndex((l) => `${l.type}:${l.key}` === k);
      const entry = {
        type: row.type,
        key: row.key,
        name: row.name,
        mode: 'include',
      };
      // Persist the result's country code on the entry — used by the
      // wizard at launch time to derive `special_ad_category_country`
      // when a Special Ad Category is set. Countries already carry their
      // code in `key`; cities/regions/areas surface it via the search
      // response.
      if (row.countryCode) entry.countryCode = row.countryCode;
      // Cities default to a 25 km radius — Meta requires a radius when
      // `distance_unit` is set, and 25 km is a sensible mid-range default
      // matching Meta's own UI.
      if (row.type === 'city') {
        entry.radius = CITY_RADIUS_DEFAULT_KM;
        entry.distanceUnit = 'kilometer';
      }
      if (existingIdx >= 0) {
        const next = value.slice();
        next[existingIdx] = { ...next[existingIdx], ...entry };
        onChange?.(next);
      } else {
        onChange?.([...value, entry]);
      }
      setQuery('');
      setResults([]);
    },
    [value, onChange],
  );

  const remove = useCallback(
    (idx) => onChange?.(value.filter((_, i) => i !== idx)),
    [value, onChange],
  );

  const setMode = useCallback(
    (idx, mode) => {
      const next = value.slice();
      next[idx] = { ...next[idx], mode };
      onChange?.(next);
    },
    [value, onChange],
  );

  const setRadius = useCallback(
    (idx, radius) => {
      const next = value.slice();
      next[idx] = { ...next[idx], radius };
      onChange?.(next);
    },
    [value, onChange],
  );

  return (
    <FieldShell label="Locations" required error={error}>
      <div ref={containerRef} className="relative flex flex-col gap-2.5">
        {/* Search input */}
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-white/40" />
          <input
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            placeholder="Search countries, cities, regions…"
            disabled={disabled}
            className="w-full rounded-full border border-white/10 bg-[#171717] py-2.5 pl-9 pr-9 text-13 text-white placeholder:text-white/40 transition-colors hover:border-white/15 focus:border-white/25 focus:outline-none disabled:cursor-not-allowed disabled:opacity-40"
          />
          {loading && (
            <Loader2 className="absolute top-1/2 right-3 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-white/55" />
          )}
        </div>

        {/* Suggestions dropdown */}
        {open && query.trim() && (
          <div className="scrollbar-thin absolute top-full left-0 right-0 z-50 mt-1 max-h-72 overflow-y-auto rounded-xl border border-white/10 bg-[#1A1A1A] shadow-xl">
            {!loading && results.length === 0 ? (
              <div className="px-3 py-3 text-12 text-white/45">
                No matches. Try a different spelling.
              </div>
            ) : (
              results.map((r) => {
                const k = `${r.type}:${r.key}`;
                const already = selectedKeys.has(k);
                const badge = typeBadge(r.type);
                return (
                  <button
                    type="button"
                    key={k}
                    disabled={already}
                    onClick={() => add(r)}
                    className={`flex w-full items-center justify-between gap-2 border-b border-white/5 px-3 py-2 text-left transition-colors last:border-b-0 ${
                      already
                        ? 'cursor-not-allowed opacity-40'
                        : 'hover:bg-white/5'
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-13 font-medium text-white">
                        {r.name}
                      </p>
                      {secondaryLine(r) && (
                        <p className="truncate text-11 text-white/45">
                          {secondaryLine(r)}
                        </p>
                      )}
                    </div>
                    <span
                      className={`shrink-0 rounded-md px-1.5 py-0.5 text-10 font-semibold uppercase tracking-wider ${badge.color}`}
                    >
                      {badge.label}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        )}

        {/* Selected locations list */}
        {value.length > 0 && (
          <ul className="flex flex-col gap-1.5">
            {value.map((l, idx) => {
              const badge = typeBadge(l.type);
              return (
                <li
                  key={`${l.type}:${l.key}`}
                  className="flex flex-wrap items-center gap-2 rounded-xl border border-white/8 bg-white/3 px-3 py-2"
                >
                  <MapPin className="h-3.5 w-3.5 shrink-0 text-white/45" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-13 font-medium text-white">
                      {l.name || l.key}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-md px-1.5 py-0.5 text-10 font-semibold uppercase tracking-wider ${badge.color}`}
                  >
                    {badge.label}
                  </span>

                  {/* City radius control (km) */}
                  {l.type === 'city' && (
                    <label className="flex items-center gap-1.5 text-11 text-white/55">
                      <span>Radius</span>
                      <input
                        type="number"
                        min={CITY_RADIUS_MIN_KM}
                        max={CITY_RADIUS_MAX_KM}
                        value={l.radius ?? CITY_RADIUS_DEFAULT_KM}
                        disabled={disabled}
                        onChange={(e) => {
                          const n = Math.max(
                            CITY_RADIUS_MIN_KM,
                            Math.min(
                              CITY_RADIUS_MAX_KM,
                              Number(e.target.value) || CITY_RADIUS_DEFAULT_KM,
                            ),
                          );
                          setRadius(idx, n);
                        }}
                        className="w-14 rounded-md border border-white/10 bg-[#171717] px-1.5 py-0.5 text-center text-12 text-white focus:border-white/25 focus:outline-none"
                      />
                      <span>km</span>
                    </label>
                  )}

                  {/* Include / Exclude segmented */}
                  <div className="flex items-stretch overflow-hidden rounded-md border border-white/10 text-10">
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => setMode(idx, 'include')}
                      className={`px-2 py-1 font-semibold transition-colors ${
                        l.mode !== 'exclude'
                          ? 'bg-emerald-400/20 text-emerald-200'
                          : 'text-white/55 hover:bg-white/5'
                      }`}
                    >
                      Include
                    </button>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => setMode(idx, 'exclude')}
                      className={`px-2 py-1 font-semibold transition-colors ${
                        l.mode === 'exclude'
                          ? 'bg-red-400/20 text-red-200'
                          : 'text-white/55 hover:bg-white/5'
                      }`}
                    >
                      Exclude
                    </button>
                  </div>

                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => remove(idx)}
                    aria-label="Remove location"
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-white/40 transition-colors hover:bg-white/8 hover:text-white"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {value.length === 0 && !query.trim() && (
          <p className="text-11 text-white/40">
            Add at least one country, city, region, or free-trade area —
            or use the Worldwide toggle above for a global reach.
          </p>
        )}
      </div>
    </FieldShell>
  );
}
