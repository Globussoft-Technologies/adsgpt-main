/**
 * LocationTargeting — V2 wizard's Meta-parity Locations picker.
 *
 * Phase 1 (see docs/LOCATION_TARGETING_PLAN.md): debounced typeahead
 * against `/meta-ads/search-geo` returning countries / cities (with km
 * radius) / regions / free-trade-area country-groups. Each selected
 * location renders as a chip with Include/Exclude switch + remove; cities
 * and ZIPs get a km radius control (confirmed against live Meta Ads
 * Manager 2026-07-01 — Region does NOT support radius, City and ZIP do).
 *
 * Stored on the wizard form as `locations: []`, each entry shaped:
 *   { type, key, name, mode: 'include' | 'exclude',
 *     radius?, distanceUnit?, countryCode? }  // radius/unit on city + zip.
 *
 * Phase 2 (Browse + bulk) was reverted — a revised plan is pending.
 * Phase 3 will add the map + drop-pin (a new `type: 'custom'`).
 */

import React, {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Search, X, Loader2, MapPin } from 'lucide-react';
import { searchGeoLocations, geocodeLocation, reverseGeocodeLocation } from '@/apis/metaAds/metaAdsApi';
import { FieldShell } from './wizardFields';
import { globalToast } from '@/utils/globalToast';

// Lazy — keeps Leaflet (~150 KB + CSS) out of the main bundle until the
// user opens the map.
const PinMap = lazy(() => import('./PinMap'));

// City radius — Meta accepts 1–80 km on `cities[].radius` for
// distance_unit: 'kilometer'.
const CITY_RADIUS_MIN_KM = 1;
const CITY_RADIUS_MAX_KM = 80;
const CITY_RADIUS_DEFAULT_KM = 25;

// Visible badge per type — short, distinct colours so Country / City /
// Region / Area read at a glance. Each badge needs both a light-mode and
// a dark-mode treatment: in light mode the previous `text-emerald-200`
// style was washed out against the white wizard surface and the COUNTRY
// chip read as invisible. Light = solid pale fill + ~700 text; dark =
// translucent fill + ~200 text (the original look).
const TYPE_BADGE = {
  country: {
    label: 'Country',
    color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-200',
  },
  city: {
    label: 'City',
    color: 'bg-sky-100 text-sky-700 dark:bg-sky-400/15 dark:text-sky-200',
  },
  region: {
    label: 'Region',
    color: 'bg-violet-100 text-violet-700 dark:bg-violet-400/15 dark:text-violet-200',
  },
  // subregion ≈ county-equivalent — share the region palette (visual
  // siblings; the user reads "Region" vs "Subregion" off the label).
  subregion: {
    label: 'Subregion',
    color: 'bg-violet-100 text-violet-700 dark:bg-violet-400/15 dark:text-violet-200',
  },
  country_group: {
    label: 'Area',
    color: 'bg-amber-100 text-amber-700 dark:bg-amber-400/15 dark:text-amber-200',
  },
  // subcity = Meta's "Borough" badge in Ads Manager — boroughs / districts
  // within a city.
  subcity: {
    label: 'Borough',
    color: 'bg-blue-100 text-blue-700 dark:bg-blue-400/15 dark:text-blue-200',
  },
  neighborhood: {
    label: 'Neighborhood',
    color: 'bg-teal-100 text-teal-700 dark:bg-teal-400/15 dark:text-teal-200',
  },
  // place = POI-style results surfaced by Meta's place_fallback search
  // (e.g. "Varthur"). They render like a city/region in the dropdown but
  // are targeted as a radius pin (custom_location) once selected.
  place: {
    label: 'Place',
    color: 'bg-sky-100 text-sky-700 dark:bg-sky-400/15 dark:text-sky-200',
  },
  subneighborhood: {
    label: 'Sub-neighborhood',
    color: 'bg-teal-100 text-teal-700 dark:bg-teal-400/15 dark:text-teal-200',
  },
  zip: {
    label: 'ZIP',
    color: 'bg-pink-100 text-pink-700 dark:bg-pink-400/15 dark:text-pink-200',
  },
  geo_market: {
    label: 'Market',
    color: 'bg-orange-100 text-orange-700 dark:bg-orange-400/15 dark:text-orange-200',
  },
  // electoral_district — UK constituencies, US districts, etc.
  electoral_district: {
    label: 'District',
    color: 'bg-rose-100 text-rose-700 dark:bg-rose-400/15 dark:text-rose-200',
  },
  // Meta's *_geo_area buckets — granular area layers Meta added for
  // newer geo-targeting; less common but renderable when surfaced.
  large_geo_area: {
    label: 'Area',
    color: 'bg-amber-100 text-amber-700 dark:bg-amber-400/15 dark:text-amber-200',
  },
  medium_geo_area: {
    label: 'Area',
    color: 'bg-amber-100 text-amber-700 dark:bg-amber-400/15 dark:text-amber-200',
  },
  small_geo_area: {
    label: 'Area',
    color: 'bg-amber-100 text-amber-700 dark:bg-amber-400/15 dark:text-amber-200',
  },
  metro_area: {
    label: 'Metro',
    color: 'bg-orange-100 text-orange-700 dark:bg-orange-400/15 dark:text-orange-200',
  },
  custom: {
    label: 'Pin',
    color: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-400/15 dark:text-cyan-200',
  },
};

function typeBadge(type) {
  return (
    TYPE_BADGE[type] || {
      label: type,
      color: 'bg-gray-200 text-gray-600 dark:bg-white/10 dark:text-white/70',
    }
  );
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
  // Map auto-reveals once the user focuses search (Meta's behaviour) or as
  // soon as anything pinnable exists. `mapDismissed` lets them collapse it.
  const [mapTouched, setMapTouched] = useState(false);
  const [mapDismissed, setMapDismissed] = useState(false);
  const containerRef = useRef(null);

  // Latest value in a ref — async geocode results resolve after add()'s
  // onChange, so patching coords must read the current array, not the
  // stale closure captured when the request fired.
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  // Everything we can place on the map: custom pins + any city/region we've
  // geocoded (lat/lng present). Drives the markers + radius circles.
  const mapPins = useMemo(
    () =>
      value.filter(
        (l) =>
          Number.isFinite(l.latitude) && Number.isFinite(l.longitude),
      ),
    [value],
  );

  const mapVisible = !mapDismissed && (mapTouched || mapPins.length > 0);

  // Meta rejects overlapping included locations (subcode 1487756) — every
  // sub-country type inside an included country is redundant (the country
  // covers it). Backend `dropOverlappingIncludes` in utils/targetingGeo.js
  // drops these at launch; we flag them here so the user sees why their
  // radius won't apply. Must stay in lockstep with backend
  // COUNTRY_REDUNDANT_TYPES — expand together when a new sub-country type
  // is added to the search endpoint.
  const SUB_COUNTRY_TYPES = useMemo(
    () =>
      new Set([
        'city',
        'region',
        'subregion',
        'subcity',
        'neighborhood',
        'subneighborhood',
        'zip',
        'geo_market',
        'electoral_district',
        'large_geo_area',
        'medium_geo_area',
        'small_geo_area',
        'metro_area',
        // Radius pins (from a dropped map pin OR a `place`/POI search pick
        // like "Whitefield" or "Varthur") are redundant the same way when
        // their reverse-geocoded countryCode matches an included country.
        'custom',
      ]),
    [],
  );
  const subsumedKeys = useMemo(() => {
    const includedCountries = new Set(
      value
        .filter((l) => l.type === 'country' && l.mode !== 'exclude')
        .map((l) => String(l.key).toUpperCase()),
    );
    const out = new Set();
    if (!includedCountries.size) return out;
    for (const l of value) {
      if (
        l.mode !== 'exclude' &&
        SUB_COUNTRY_TYPES.has(l.type) &&
        l.countryCode &&
        includedCountries.has(String(l.countryCode).toUpperCase())
      ) {
        out.add(`${l.type}:${l.key}`);
      }
    }
    return out;
  }, [value, SUB_COUNTRY_TYPES]);

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

  // Patch a location entry (matched by key) with geocoded coordinates so
  // it appears as a pin on the map. Reads valueRef to survive the async gap.
  const patchCoords = useCallback(
    (k, latitude, longitude) => {
      const cur = valueRef.current;
      const idx = cur.findIndex((l) => `${l.type}:${l.key}` === k);
      if (idx < 0) return; // removed before geocode resolved
      const next = cur.slice();
      next[idx] = { ...next[idx], latitude, longitude };
      onChange?.(next);
    },
    [onChange],
  );

  // Meta's search has no coordinates, so geocode a chosen city/region and
  // drop it on the map. Best-effort: a failure just leaves it unpinned (it
  // still targets correctly — radius rides on cities[].radius).
  const geocodeAndPin = useCallback(
    async (row) => {
      try {
        const named = [row.name, row.region, row.countryName]
          .filter(Boolean)
          .join(', ');
        const resp = await geocodeLocation({
          q: named || row.name,
          countryCode: row.countryCode || undefined,
        });
        const r = resp?.result;
        if (r && Number.isFinite(r.latitude) && Number.isFinite(r.longitude)) {
          patchCoords(`${row.type}:${row.key}`, r.latitude, r.longitude);
        }
      } catch {
        /* leave unpinned — targeting is unaffected */
      }
    },
    [patchCoords],
  );

  const add = useCallback(
    async (row) => {
      // Places (POI results) have no direct `geo_locations.*` bucket in
      // Meta's targeting spec. We turn them into radius pins
      // (custom_locations) using the centroid Meta returns, or fall back
      // to Nominatim geocoding if the search response has no coordinates.
      if (row.type === 'place') {
        let latitude = row.latitude;
        let longitude = row.longitude;
        // Places rarely carry a country_code from Meta's search directly;
        // the geocode round-trip below (when it fires) returns one from
        // Nominatim's addressdetails. Without either, this pin has no
        // country info and can't be recognised as redundant with an
        // included country at launch (Meta subcode 1487756) — the
        // backend's launch-time reverse-geocode backfill is the fallback.
        let countryCode = row.countryCode || null;
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
          try {
            const named = [row.name, row.region, row.countryName]
              .filter(Boolean)
              .join(', ');
            const resp = await geocodeLocation({
              q: named || row.name,
              countryCode: row.countryCode || undefined,
            });
            const r = resp?.result;
            if (
              r &&
              Number.isFinite(r.latitude) &&
              Number.isFinite(r.longitude)
            ) {
              latitude = r.latitude;
              longitude = r.longitude;
              if (!countryCode && r.countryCode) countryCode = r.countryCode;
            }
          } catch {
            /* fall through — if geocoding fails we bail below */
          }
        }
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
          globalToast.error(
            'Could not locate that place on the map — try a nearby city.',
          );
          return;
        }
        const entry = {
          type: 'custom',
          key: `custom:${latitude},${longitude}`,
          name: row.name,
          latitude,
          longitude,
          radius: CITY_RADIUS_DEFAULT_KM,
          distanceUnit: 'kilometer',
          mode: 'include',
          ...(countryCode && { countryCode }),
        };
        onChange?.([...value, entry]);
        setQuery('');
        setResults([]);
        setMapDismissed(false);
        return;
      }

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
      // Cities and ZIPs default to a 25 km radius — Meta requires a radius
      // when `distance_unit` is set, and 25 km is a sensible mid-range
      // default matching Meta's own UI. Confirmed against live Meta Ads
      // Manager 2026-07-01: City and ZIP both support a radius extension
      // around the centroid; Region does not (whole administrative area
      // only) and is intentionally excluded here.
      if (row.type === 'city' || row.type === 'zip') {
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
      // Auto-pin point-like geo entries on the map (Meta-style).
      // Countries / country-groups / electoral districts are too broad —
      // coordinate-pin would be misleading. Cities, ZIPs (both
      // radius-extendable per Meta's UI), regions, subcities (boroughs),
      // neighborhoods pin sensibly via Nominatim's centroid.
      const PIN_AUTO_TYPES = new Set([
        'city',
        'zip',
        'region',
        'subregion',
        'subcity',
        'neighborhood',
        'subneighborhood',
      ]);
      if (PIN_AUTO_TYPES.has(row.type)) {
        setMapDismissed(false);
        geocodeAndPin(row);
      }
    },
    [value, onChange, geocodeAndPin],
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

  // Drop a pin → add a `custom` location (radius around the point).
  // First reverse-geocodes the click to make sure it's on LAND — Meta's
  // own Ads Manager won't let you pin in water, and a custom location in
  // the middle of the ocean delivers to nobody. The backend's Nominatim
  // proxy returns `result: null` for ocean / no-match; we surface that
  // to the user and bail. If Nominatim is down the backend marks the
  // response `degraded: true` and we fail open (let the user drop the
  // pin) — better than blocking work over a transient outage.
  const addPin = useCallback(
    async (lat, lng) => {
      const latitude = Number(lat.toFixed(6));
      const longitude = Number(lng.toFixed(6));
      const key = `custom:${latitude},${longitude}`;
      if (value.some((l) => l.key === key)) return; // already dropped here

      let displayName = null;
      // Also captured here — without it, this pin has no country info and
      // can't be recognised as redundant with an included country at
      // launch (Meta subcode 1487756). Backend backfills on launch/edit
      // too, but capturing it now avoids a second network round-trip.
      let countryCode = null;
      try {
        const r = await reverseGeocodeLocation({ lat: latitude, lng: longitude });
        if (r?.result) {
          displayName = r.result.displayName || null;
          countryCode = r.result.countryCode || null;
        } else if (!r?.degraded) {
          globalToast.error(
            'Pick a point on land — that location has no addressable audience.',
          );
          return;
        }
      } catch {
        // Network blip: fail open so the user isn't blocked by our
        // dependency. Backend Joi + Meta still bound-check at launch.
      }

      onChange?.([
        ...value,
        {
          type: 'custom',
          key,
          // Use the reverse-geocoded place name when available; fall back
          // to the bare coordinates so the chip is always readable.
          name: displayName || `Pin @ ${latitude.toFixed(3)}, ${longitude.toFixed(3)}`,
          latitude,
          longitude,
          radius: CITY_RADIUS_DEFAULT_KM,
          distanceUnit: 'kilometer',
          mode: 'include',
          ...(countryCode && { countryCode }),
        },
      ]);
    },
    [value, onChange],
  );

  return (
    <FieldShell label="Locations" required error={error}>
      <div ref={containerRef} className="relative flex flex-col gap-2.5">
        {/* Search input */}
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-white/40" />
          <input
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => {
              setOpen(true);
              setMapTouched(true);
              setMapDismissed(false);
            }}
            placeholder="Search countries, cities, regions…"
            disabled={disabled}
            className="w-full rounded-full border border-gray-300 bg-gray-100 py-2.5 pl-9 pr-9 text-13 text-gray-900 placeholder:text-gray-400 transition-colors hover:border-gray-400 focus:border-gray-400 focus:outline-none disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:bg-[#171717] dark:text-white dark:placeholder:text-white/40 dark:hover:border-white/15 dark:focus:border-white/25"
          />
          {loading && (
            <Loader2 className="absolute top-1/2 right-3 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-gray-500 dark:text-white/55" />
          )}

          {/* Suggestions dropdown — anchored to the input so it drops just
              below it; z above Leaflet's panes/controls so the map can't
              cover it. */}
          {open && query.trim() && (
            <div className="scrollbar-thin absolute top-full left-0 right-0 z-1200 mt-1 max-h-72 overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-xl dark:border-white/10 dark:bg-[#1A1A1A]">
            {!loading && results.length === 0 ? (
              <div className="px-3 py-3 text-12 text-gray-500 dark:text-white/45">
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
                    className={`flex w-full items-center justify-between gap-2 border-b border-gray-200 px-3 py-2 text-left transition-colors last:border-b-0 dark:border-white/5 ${
                      already
                        ? 'cursor-not-allowed opacity-40'
                        : 'hover:bg-gray-100 dark:hover:bg-white/5'
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-13 font-medium text-gray-900 dark:text-white">
                        {r.name}
                      </p>
                      {secondaryLine(r) && (
                        <p className="truncate text-11 text-gray-500 dark:text-white/45">
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
        </div>

        {/* Map — auto-reveals on search focus / first pin (Meta-style).
            Selected cities & regions land here automatically; click the
            map to drop a custom radius pin anywhere. */}
        {mapVisible && (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="text-11 text-gray-400 dark:text-white/40">
                Click the map to drop a custom radius pin.
              </span>
              <button
                type="button"
                onClick={() => setMapDismissed(true)}
                className="text-11 text-gray-500 transition-colors hover:text-gray-900 dark:text-white/45 dark:hover:text-white"
              >
                Hide map
              </button>
            </div>
            <Suspense
              fallback={
                <div className="flex h-70 items-center justify-center gap-2 rounded-xl border border-gray-200 bg-gray-100 text-12 text-gray-500 dark:border-white/10 dark:bg-[#171717] dark:text-white/50">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading map…
                </div>
              }
            >
              <PinMap pins={mapPins} onAdd={addPin} />
            </Suspense>
          </div>
        )}

        {/* Selected locations list */}
        {value.length > 0 && (
          <ul className="flex flex-col gap-1.5">
            {value.map((l, idx) => {
              const badge = typeBadge(l.type);
              const subsumed = subsumedKeys.has(`${l.type}:${l.key}`);
              return (
                <li
                  key={`${l.type}:${l.key}`}
                  className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 dark:border-white/8 dark:bg-white/3"
                >
                  <MapPin className="h-3.5 w-3.5 shrink-0 text-gray-400 dark:text-white/45" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-13 font-medium text-gray-900 dark:text-white">
                      {l.name || l.key}
                    </p>
                    {subsumed && (
                      <p className="truncate text-11 text-amber-600 dark:text-amber-300/80">
                        Already covered by a country you’ve added — radius
                        won’t apply.
                      </p>
                    )}
                  </div>
                  <span
                    className={`shrink-0 rounded-md px-1.5 py-0.5 text-10 font-semibold uppercase tracking-wider ${badge.color}`}
                  >
                    {badge.label}
                  </span>

                  {/* Radius control (km) — cities, ZIPs + map pins. Slider
                      like Meta, with a live readout. Confirmed against live
                      Meta Ads Manager 2026-07-01: City and ZIP both support
                      a radius extension; Region does not. Stays visible
                      when the location is subsumed by an included country,
                      but is disabled + dimmed (the note explains it won't
                      apply until the country is removed) — so it never
                      just vanishes on the user. */}
                  {(l.type === 'city' || l.type === 'zip' || l.type === 'custom') && (
                    <label
                      className={`flex items-center gap-2 text-11 text-gray-500 dark:text-white/55 ${
                        subsumed ? 'opacity-40' : ''
                      }`}
                    >
                      <input
                        type="range"
                        min={CITY_RADIUS_MIN_KM}
                        max={CITY_RADIUS_MAX_KM}
                        step={1}
                        value={l.radius ?? CITY_RADIUS_DEFAULT_KM}
                        disabled={disabled || subsumed}
                        onChange={(e) =>
                          setRadius(idx, Number(e.target.value))
                        }
                        className="h-1 w-24 cursor-pointer appearance-none rounded-full bg-gray-200 accent-sky-400 disabled:cursor-not-allowed dark:bg-white/15"
                      />
                      <span className="w-12 shrink-0 tabular-nums text-gray-600 dark:text-white/70">
                        {l.radius ?? CITY_RADIUS_DEFAULT_KM} km
                      </span>
                    </label>
                  )}

                  {/* Include / Exclude segmented */}
                  <div className="flex items-stretch overflow-hidden rounded-md border border-gray-200 text-10 dark:border-white/10">
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => setMode(idx, 'include')}
                      className={`px-2 py-1 font-semibold transition-colors ${
                        l.mode !== 'exclude'
                          ? 'bg-emerald-400/20 text-emerald-600 dark:text-emerald-200'
                          : 'text-gray-500 hover:bg-gray-100 dark:text-white/55 dark:hover:bg-white/5'
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
                          ? 'bg-red-400/20 text-red-600 dark:text-red-200'
                          : 'text-gray-500 hover:bg-gray-100 dark:text-white/55 dark:hover:bg-white/5'
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
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-white/40 dark:hover:bg-white/8 dark:hover:text-white"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {value.length === 0 && !query.trim() && (
          <p className="text-11 text-gray-400 dark:text-white/40">
            Add at least one country, city, region, or free-trade area —
            or use the Worldwide toggle above for a global reach.
          </p>
        )}
      </div>
    </FieldShell>
  );
}
