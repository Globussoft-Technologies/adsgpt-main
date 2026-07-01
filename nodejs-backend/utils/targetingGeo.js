/**
 * targetingGeo.js — pure geo-targeting transformations between our flat
 * `locations[]` model and Meta's nested `geo_locations` / `excluded_geo_locations`
 * payload shape.
 *
 * Pure module: no SDK, no env vars, no I/O. Safe to import from tests
 * without dragging the controller's Redis / DB / Facebook-SDK chain in.
 *
 * Adding a new geo-type requires touching FOUR places (kept tight on
 * purpose so additions can't silently drop a type):
 *   1. `metaAdLauncher.searchGeoLocations` ALLOWED_TYPES — accept it from the typeahead.
 *   2. `KEYED_LIST_TYPES` below — route includes/excludes into Meta's plural field.
 *   3. `KEYED_LIST_INVERSE` below — read it back on the edit flow.
 *   4. `LocationTargeting.jsx` TYPE_BADGE — render a friendly badge.
 *
 * The `subregion` → `regions` mapping is intentional — Meta's payload
 * schema treats subregions as a sub-bucket of the `regions` array.
 *
 * Radius-extendable types are the EXCEPTION to the generic KEYED_LIST_TYPES
 * map — `city` and `zip` each get a dedicated branch in
 * `groupLocationsByType` / `reverseGeoToLocations` carrying `radius` +
 * `distance_unit`, because Meta's own Ads Manager supports a radius
 * extension for exactly these two types (confirmed against live Meta UI
 * 2026-07-01 — Country/Region: no radius; City/ZIP: radius around the
 * centroid; Neighborhood/Subcity: radius ONLY when Meta recognises the
 * pick as a `place`, which our picker converts to a `custom` pin rather
 * than attaching radius to the original entry — see gotchas.md #1487756).
 * If Meta adds radius support to another type, mirror the `city`/`zip`
 * pattern rather than bolting radius onto the generic KEYED_LIST_TYPES path.
 */

// Geo-types that send `{ key }` entries to Meta. Listed in a map so
// adding a new type is one line.
//
// `zip` is NOT here — it gets its own branch in `groupLocationsByType`
// (like `city`) because Meta's own Ads Manager supports a radius extension
// around a ZIP's centroid ("Radius can be adjusted around the postal code
// center") — confirmed against Meta's live UI 2026-07-01. Region does NOT
// get this treatment: Meta's UI has no radius option for regions (targets
// the whole administrative area only).
const KEYED_LIST_TYPES = {
  region: "regions",
  subregion: "regions",
  subcity: "subcities",
  neighborhood: "neighborhoods",
  subneighborhood: "subneighborhoods",
  geo_market: "geo_markets",
  electoral_district: "electoral_districts",
  large_geo_area: "large_geo_areas",
  medium_geo_area: "medium_geo_areas",
  small_geo_area: "small_geo_areas",
  metro_area: "metro_areas",
};

// Inverse of KEYED_LIST_TYPES — used on the edit flow to read Meta's
// payload back into our flat locations model. Note: regions can hold
// both `region` and `subregion`; on read we default to `region` since
// we can't distinguish from the response. `zips` is handled by its own
// dedicated block in `reverseGeoToLocations` (radius read-back), same
// reasoning as KEYED_LIST_TYPES above.
const KEYED_LIST_INVERSE = {
  subcities: "subcity",
  neighborhoods: "neighborhood",
  subneighborhoods: "subneighborhood",
  geo_markets: "geo_market",
  electoral_districts: "electoral_district",
  large_geo_areas: "large_geo_area",
  medium_geo_areas: "medium_geo_area",
  small_geo_areas: "small_geo_area",
  metro_areas: "metro_area",
};

// Sub-country granular types — any of these inside an INCLUDED country
// is redundant and gets dropped by `dropOverlappingIncludes` to avoid
// subcode 1487756.
//
// `custom` (lat/lng radius pins) is included: Meta's `adgeolocation`
// search sometimes surfaces a well-known area (e.g. "Whitefield",
// "Varthur" in Bangalore) as a `place` (POI) result instead of a formal
// subcity/neighborhood entity — the frontend converts `place` picks into
// a `custom` pin (see LocationTargeting.jsx `add()`). Meta's own API
// unconditionally rejects a same-country pin + country combo with
// 1487756 regardless of whether the pin's radius could technically cross
// a border, so dropping on countryCode match mirrors Meta's real
// behaviour. The frontend now backfills countryCode via reverse-geocode
// when a pin is placed; the backend's `backfillLocationCountryCodes`
// covers pins loaded from an existing ad set on edit (Meta's
// `custom_locations` read-back never includes a country code at all).
const COUNTRY_REDUNDANT_TYPES = new Set([
  "city",
  "region",
  "subregion",
  "subcity",
  "neighborhood",
  "subneighborhood",
  "zip",
  "geo_market",
  "electoral_district",
  "large_geo_area",
  "medium_geo_area",
  "small_geo_area",
  "metro_area",
  "custom",
]);

// Group our normalised location entries into Meta's per-type sub-objects.
function groupLocationsByType(items) {
  const out = {};
  for (const l of items) {
    if (l.type === "country") {
      out.countries = out.countries || [];
      out.countries.push(l.key);
    } else if (l.type === "city") {
      out.cities = out.cities || [];
      const city = { key: l.key };
      if (l.radius != null) {
        city.radius = l.radius;
        city.distance_unit = l.distanceUnit || "kilometer";
      }
      out.cities.push(city);
    } else if (l.type === "zip") {
      // Radius-extendable, same shape as city — Meta's UI supports
      // extending a ZIP beyond its own boundary around the postal code
      // centroid. See KEYED_LIST_TYPES comment for why this isn't in the
      // generic map.
      out.zips = out.zips || [];
      const zip = { key: l.key };
      if (l.radius != null) {
        zip.radius = l.radius;
        zip.distance_unit = l.distanceUnit || "kilometer";
      }
      out.zips.push(zip);
    } else if (l.type === "country_group") {
      out.country_groups = out.country_groups || [];
      out.country_groups.push(l.key);
    } else if (l.type === "custom") {
      out.custom_locations = out.custom_locations || [];
      out.custom_locations.push({
        latitude: l.latitude,
        longitude: l.longitude,
        radius: l.radius,
        distance_unit: l.distanceUnit || "kilometer",
      });
    } else if (KEYED_LIST_TYPES[l.type]) {
      const field = KEYED_LIST_TYPES[l.type];
      out[field] = out[field] || [];
      out[field].push({ key: l.key });
    }
    // Unknown types silently skipped — defensive against future search
    // additions that aren't yet wired here. The backend search's
    // ALLOWED_TYPES set is the source of truth for what we promise to ship.
  }
  return out;
}

// Meta rejects overlapping *included* locations (subcode 1487756).
// Only drops entries that are themselves includes — excluding a
// neighborhood inside an included country is a meaningful "target India
// but exclude this neighborhood" expression that we must preserve.
// Callers typically pass includes-only (the pipeline filters by mode
// before calling), but the explicit mode check makes the function safe
// against mixed-mode inputs.
function dropOverlappingIncludes(items) {
  const includedCountryCodes = new Set(
    items
      .filter((l) => l.type === "country" && (l.mode || "include") === "include")
      .map((l) => String(l.key).toUpperCase()),
  );
  if (!includedCountryCodes.size) return items;
  return items.filter((l) => {
    if ((l.mode || "include") !== "include") return true; // never drop excludes
    if (COUNTRY_REDUNDANT_TYPES.has(l.type)) {
      const cc = String(l.countryCode || "").toUpperCase();
      if (cc && includedCountryCodes.has(cc)) return false;
    }
    return true;
  });
}

// Inverse of groupLocationsByType: turn Meta's geo_locations /
// excluded_geo_locations sub-objects back into our flat `locations[]`
// model (names filled in later via the Meta adgeolocationmeta lookup
// in the controller, which has the SDK + auth).
function reverseGeoToLocations(geo, mode) {
  const out = [];
  if (!geo) return out;
  for (const c of geo.countries || []) {
    out.push({
      type: "country",
      key: String(c),
      countryCode: String(c).toUpperCase(),
      mode,
    });
  }
  for (const c of geo.cities || []) {
    out.push({
      type: "city",
      key: String(c.key),
      radius: c.radius,
      distanceUnit: c.distance_unit || "kilometer",
      mode,
    });
  }
  for (const z of geo.zips || []) {
    out.push({
      type: "zip",
      key: String(z.key),
      radius: z.radius,
      distanceUnit: z.distance_unit || "kilometer",
      mode,
    });
  }
  for (const r of geo.regions || []) {
    out.push({ type: "region", key: String(r.key), mode });
  }
  for (const g of geo.country_groups || []) {
    if (g !== "worldwide") {
      out.push({ type: "country_group", key: String(g), mode });
    }
  }
  for (const [field, type] of Object.entries(KEYED_LIST_INVERSE)) {
    for (const entry of geo[field] || []) {
      out.push({ type, key: String(entry.key), mode });
    }
  }
  for (const cl of geo.custom_locations || []) {
    const lat = Number(cl.latitude);
    const lng = Number(cl.longitude);
    out.push({
      type: "custom",
      key: `custom:${lat},${lng}`,
      latitude: lat,
      longitude: lng,
      radius: cl.radius,
      distanceUnit: cl.distance_unit || "kilometer",
      name: `Pin @ ${lat.toFixed(3)}, ${lng.toFixed(3)}`,
      mode,
    });
  }
  return out;
}

// Type → Meta `adgeolocationmeta` plural param / response bucket.
// Used by the controller's `resolveLocationNames` to fetch friendly
// names + country_code on the edit flow. Exported here so the mapping
// stays single-sourced with the routing maps above.
const TYPE_TO_META_BUCKET = {
  country: "countries",
  city: "cities",
  region: "regions",
  subregion: "regions",
  country_group: "country_groups",
  subcity: "subcities",
  neighborhood: "neighborhoods",
  subneighborhood: "subneighborhoods",
  zip: "zips",
  geo_market: "geo_markets",
  electoral_district: "electoral_districts",
  large_geo_area: "large_geo_areas",
  medium_geo_area: "medium_geo_areas",
  small_geo_area: "small_geo_areas",
  metro_area: "metro_areas",
};

// Types whose Meta response carries a `country_code` worth caching on
// the entry (for SAC-country derivation on the edit flow). `country`
// itself doesn't need it — its key IS the country code.
const COUNTRY_CODE_CARRYING_TYPES = new Set([
  "city",
  "region",
  "subregion",
  "subcity",
  "neighborhood",
  "subneighborhood",
  "zip",
  "geo_market",
  "electoral_district",
  "large_geo_area",
  "medium_geo_area",
  "small_geo_area",
  "metro_area",
]);

module.exports = {
  KEYED_LIST_TYPES,
  KEYED_LIST_INVERSE,
  COUNTRY_REDUNDANT_TYPES,
  TYPE_TO_META_BUCKET,
  COUNTRY_CODE_CARRYING_TYPES,
  groupLocationsByType,
  dropOverlappingIncludes,
  reverseGeoToLocations,
};
