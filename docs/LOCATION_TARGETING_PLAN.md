# Location Targeting — Meta-parity build plan

**Status:** TODO — scheduled for 2026-05-20
**Owner:** AdsGPT Meta Ads V2 wizard
**Goal:** Replace the V2 wizard's simple country picker with a Meta Ads
Manager-style **Locations** selector — search, cities with radius,
regions/states, include/exclude, free-trade-area groups, browse tree,
bulk add, and an interactive map with drop-pin.

Scope decision (confirmed): **build all 3 phases.**

---

## 1. Current state (what exists today)

- **Form state** (`CreateCampaignWizardV2.jsx` → `buildInitialForm`):
  `worldwide` (bool), `countries: ['IN']`, `useSavedAudience`,
  `savedAudienceId`.
- **UI** (`AdSetStep`): a `Worldwide` toggle + a `COMMON_COUNTRIES`
  `MultiSelectField` (~10 hard-coded countries) + a Saved-audience picker.
- **Validation** (`wizardValidation.js` → `validateAdSet`): requires at
  least one country unless `worldwide` or a saved audience is chosen.
- **Backend** (`createAdSetV2`): builds `targeting.geo_locations.countries`;
  worldwide path uses `excluded_geo_locations.countries =
  WORLDWIDE_EXCLUDED_COUNTRIES` (`["TW","SG"]`).
- **Joi** (`buildAdSetSchemaV2` → `targeting`): `countries` array,
  `worldwide` bool.

This must be replaced by a richer model — a coordinated change across
form state, `handleLaunch`, the targeting builder, Joi, and the engine.

---

## 2. Meta API mapping

| Meta UI element | Marketing API |
| --- | --- |
| Search → Country / City / Region | `GET /search?type=adgeolocation&q=…&location_types=[…]` |
| Country chip | `targeting.geo_locations.countries: ["IN", …]` |
| City "+ 40 km" | `geo_locations.cities: [{ key, radius, distance_unit }]` |
| State / Region | `geo_locations.regions: [{ key }]` |
| Include / Exclude toggle | `geo_locations` vs `excluded_geo_locations` |
| Browse → Free trade areas (EEA, ASEAN, Mercosur, GCC, NAFTA) | `geo_locations.country_groups: ["eea", …]` |
| Map → Drop Pin | `geo_locations.custom_locations: [{ latitude, longitude, radius, distance_unit }]` |
| "Reach more people likely to respond" | location-expansion targeting flag |

Notes:
- `distance_unit` accepts `"kilometer"` or `"mile"`. City radius ≈ 17–80 km;
  custom-location (pin) radius ≈ 1–80 km.
- Geo-search results include `{ key, name, type, country_code,
  country_name, region, region_id, supports_region, supports_city }`.
- Custom locations take raw lat/lng — no geocoding step needed.
- All radius/region/custom-location targeting is auction-supported; no
  extra permissions beyond `ads_management`.

---

## 3. Proposed data model

Replace `worldwide` + `countries` with a single `locations` array:

```js
locations: [
  { type: 'country',       key: 'IN',  name: 'India',           mode: 'include' },
  { type: 'city',          key: '…',   name: 'New York',        mode: 'include',
    radius: 40, distanceUnit: 'kilometer' },
  { type: 'region',        key: '…',   name: 'Maharashtra',     mode: 'include' },
  { type: 'country_group', key: 'eea', name: 'EEA',             mode: 'exclude' },
  { type: 'custom',        name: 'Pin: 19.07,72.87', mode: 'include',
    latitude: 19.07, longitude: 72.87, radius: 25, distanceUnit: 'kilometer' },
]
```

- `mode: 'include' | 'exclude'` → backend splits into `geo_locations` /
  `excluded_geo_locations`, then groups by `type` into
  countries / cities / regions / country_groups / custom_locations.
- Keep the `Worldwide` toggle separate (distinct from picking locations).
- Keep the saved-audience path as-is (a saved audience already carries geo).

---

## 4. Phase 1 — Search-driven picker (the 80%)

**Backend**
- New endpoint `GET /meta-ads/search-geo?q=…&types=country,city,region`
  proxying Meta's `adgeolocation` search. Returns normalized results.
  Add the route + a `searchGeoLocations` controller method
  (`metaAdLauncher.js`). Uses the per-user FB token (`initApiForUser`).
- Extend `createAdSetV2`'s targeting builder to emit `countries`,
  `cities` (with `radius`/`distance_unit`), `regions`, and
  `excluded_geo_locations` from the `locations` array.
- Extend `buildAdSetSchemaV2` Joi `targeting` to validate `locations[]`
  (type enum, radius bounds per type, mode enum).

**Frontend**
- New `LocationTargeting.jsx` component, used in `AdSetStep` in place of
  the Worldwide-toggle + `COMMON_COUNTRIES` block:
  - Debounced search box → `/meta-ads/search-geo` → results dropdown
    with type badges (Country / City / Region).
  - Selected-locations list — each row: name, type, **Include/Exclude**
    switch, remove button, and a **radius** control (km) for cities.
- New API client `searchGeoLocations(query, types)` in `metaAdsApi.js`.
- Migrate form state `countries`/`worldwide` → `locations` (+ keep a
  `worldwide` toggle). Update `handleLaunch` to send `locations`.
- Update `validateAdSet` — require ≥1 included location (unless
  worldwide / saved audience); validate radius bounds.

→ Delivers country + **city-with-km-radius** + **state/region** targeting.

## 5. Phase 2 — Browse + bulk

- Hierarchical **Browse** panel: continents → countries; a **Regions →
  Free trade areas** branch (`country_groups`: EEA, NAFTA, ASEAN,
  Mercosur, GCC). Continent grouping can be a static client-side map;
  free-trade-area keys are fixed.
- **Add locations in bulk** — paste a newline/comma list → resolve each
  via `/meta-ads/search-geo` → add best matches.

## 6. Phase 3 — Map + Drop Pin

- Interactive map via **react-leaflet + OpenStreetMap tiles** (free, no
  API key — preferred over Google Maps to avoid a key + billing).
- **Drop Pin** → capture lat/lng → add a `type: 'custom'` location with
  a radius slider → `custom_locations` on launch.
- Show existing selected locations as map markers.

---

## 7. Files to touch

- `react-frontend/src/components/MetaAds/CreateCampaignWizardV2.jsx`
  (form state, `AdSetStep`, `handleLaunch`, Review summary)
- `react-frontend/src/components/MetaAds/LocationTargeting.jsx` (new)
- `react-frontend/src/components/MetaAds/wizardValidation.js`
- `react-frontend/src/apis/metaAds/metaAdsApi.js`
- `nodejs-backend/controllers/adPosting/metaAdLauncher.js` (search-geo)
- `nodejs-backend/Router/adPosting/metaAdRoutes.js` (route)
- `nodejs-backend/controllers/adPosting/metaAdLauncherV2.js` (targeting builder)
- `nodejs-backend/Validations/meta.v2.validator.js` (targeting schema)
- `nodejs-backend/test/metaAds/v2.test.js` (targeting-builder + Joi tests)

## 8. Effort estimate

- Phase 1 ≈ 2–3 days · Phase 2 ≈ 1–2 days · Phase 3 ≈ 2–3 days.
- Total ≈ 6–8 days.

## 9. Open considerations

- **Map library dependency** — `react-leaflet` + `leaflet` added to the
  frontend for Phase 3. OpenStreetMap tiles are free; confirm no
  corporate restriction before adding.
- **Worldwide vs locations** — keep Worldwide as a separate toggle that,
  when on, clears/ignores the `locations` list.
- **TW / SG exclusion** — the current worldwide path excludes Taiwan +
  Singapore (unsupported regulatory declarations). With explicit
  location picking, decide whether to still block TW/SG selection or
  surface the existing regulatory warning instead.
- **Validation parity** — every new constraint (radius bounds, ≥1
  included location) goes into BOTH `wizardValidation.js` and the Joi
  schema, with a test — per the project's validation-parity rule.
