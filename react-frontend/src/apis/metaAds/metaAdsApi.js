import axios from 'axios';
import getCookies from '@/utils/getCookies';
import { facebookAccountHeader } from '@/utils/metaFacebookAccount';

const BASE_URL = import.meta.env.VITE_SOCKET_URL;

const getAuthHeaders = (facebookId) => ({
  Authorization: `Bearer ${getCookies()}`,
  ...(facebookId === undefined
    ? facebookAccountHeader()
    : facebookId
      ? { 'X-Facebook-Id': String(facebookId) }
      : {}),
});

export const getAdAccounts = async ({ refresh = false, facebookId } = {}) => {
  const { data } = await axios.get(`${BASE_URL}/adsgpt/meta-ads/get-ad-accounts`, {
    params: refresh ? { refresh: 'true' } : undefined,
    headers: getAuthHeaders(facebookId),
  });
  return data;
};

export const getCampaigns = async (
  adAccountId,
  { refresh = false, facebookId } = {},
) => {
  const { data } = await axios.get(`${BASE_URL}/adsgpt/meta-ads/get-campaigns`, {
    params: refresh ? { adAccountId, refresh: 'true' } : { adAccountId },
    headers: getAuthHeaders(facebookId),
  });
  return data;
};

// ─── managed-campaign slots ──────────────────────────────────────────────────
// On a plan that caps campaigns, the user picks WHICH campaigns their
// allowance is spent on; everything else renders locked. `limit: null` from
// the backend means the plan is uncapped and no lock UI should appear.
// See nodejs-backend/services/managedCampaigns.js.
export const getManagedCampaigns = async ({ facebookId } = {}) => {
  const { data } = await axios.get(
    `${BASE_URL}/adsgpt/meta-ads/managed-campaigns`,
    { headers: getAuthHeaders(facebookId) },
  );
  return data;
};

export const claimManagedCampaign = async (
  { campaignId, adAccountId },
  { facebookId } = {},
) => {
  const { data } = await axios.post(
    `${BASE_URL}/adsgpt/meta-ads/managed-campaigns`,
    { campaignId, adAccountId },
    { headers: getAuthHeaders(facebookId) },
  );
  return data;
};

// Releasing only stops AdsGPT managing the campaign — it is NOT deleted in
// Meta. Copy at the call site must make that clear.
export const releaseManagedCampaign = async ({ campaignId }, { facebookId } = {}) => {
  const { data } = await axios.delete(
    `${BASE_URL}/adsgpt/meta-ads/managed-campaigns`,
    { data: { campaignId }, headers: getAuthHeaders(facebookId) },
  );
  return data;
};

export const getAdSets = async (campaignId, adAccountId, { refresh = false } = {}) => {
  const { data } = await axios.get(`${BASE_URL}/adsgpt/meta-ads/get-ad-sets`, {
    params: refresh ? { campaignId, adAccountId, refresh: 'true' } : { campaignId, adAccountId },
    headers: getAuthHeaders(),
  });
  return data;
};

export const getCampaignAds = async (campaignId) => {
  const { data } = await axios.get(`${BASE_URL}/adsgpt/meta-ads/get-campaign-ads`, {
    params: { campaignId },
    headers: getAuthHeaders(),
  });
  return data;
};

export const getAdSetAds = async (adSetId, { refresh = false } = {}) => {
  const { data } = await axios.get(`${BASE_URL}/adsgpt/meta-ads/get-ad-set-ads`, {
    params: refresh ? { adSetId, refresh: 'true' } : { adSetId },
    headers: getAuthHeaders(),
  });
  return data;
};

// Powers the AdCopy "Generate" button in the MySpace → Post Ad flow.
// Backend charges 1 credit per call and returns
// `{ adCopy: { primary_text, headline, description, call_to_action } }`.
export const generateAdCopy = async ({ prompt }) => {
  const { data } = await axios.post(
    `${BASE_URL}/adsgpt/meta-ads/generate-ad-copy`,
    { prompt },
    { headers: getAuthHeaders() },
  );
  return data;
};

export const getAuditData = async (adAccountId) => {
  const { data } = await axios.get(`${BASE_URL}/adsgpt/meta-ads/audit`, {
    params: { adAccountId },
    headers: getAuthHeaders(),
  });
  return data;
};

// `refresh: true` skips the server's 5-min Redis cache — wired to the
// Analytics tab's Refresh button so it actually refetches from Meta instead
// of re-serving the same cached payload (mirrors getAdAccounts's refresh
// flag).
// Pass EITHER `datePreset` OR both `since`+`until` (custom range, YYYY-MM-DD).
export const getAnalyticsData = async ({
  adAccountId,
  datePreset,
  since,
  until,
  facebookId,
  refresh = false,
} = {}) => {
  const params = { adAccountId };
  if (since && until) {
    params.since = since;
    params.until = until;
  } else {
    params.datePreset = datePreset || 'last_30d';
  }
  if (refresh) params.refresh = 'true';
  const { data } = await axios.get(`${BASE_URL}/adsgpt/meta-ads/get-analytics-data`, {
    params,
    headers: getAuthHeaders(facebookId),
  });
  return data;
};

// Metric values for the rows of one entity table, keyed by entity id:
//   { metrics: { "<campaignId>": { spend: 123, ctr: 0.9 } } }
// Deliberately separate from the entity-list endpoints: those are cached for
// 2h because entity lists are stable, while metrics are volatile (5 min).
// Merging them would drag the list cache down 24x.
export const getTableMetrics = async ({
  adAccountId,
  level,
  campaignId,
  adsetId,
  datePreset,
  since,
  until,
  facebookId,
  refresh = false,
} = {}) => {
  const params = { adAccountId, level };
  if (campaignId) params.campaignId = campaignId;
  if (adsetId) params.adsetId = adsetId;
  if (since && until) {
    params.since = since;
    params.until = until;
  } else if (datePreset) {
    params.datePreset = datePreset;
  }
  if (refresh) params.refresh = 'true';
  const { data } = await axios.get(`${BASE_URL}/adsgpt/meta-ads/table-metrics`, {
    params,
    headers: getAuthHeaders(facebookId),
  });
  return data;
};

// ─── Selectable Analytics dashboard metrics ─────────────────────────────────
// Static catalog of every selectable metric (config/metricsCatalog.js on the
// backend) + the current user's saved selection. Global per user — not
// scoped to a specific ad account or Facebook connection.

// Full metric catalog — fetch once per session, it's a static code-committed
// list on the backend (no per-user data, safe to hold in component state).
export const getAnalyticsMetricsCatalog = async () => {
  const { data } = await axios.get(
    `${BASE_URL}/adsgpt/meta-ads/analytics/metrics-catalog`,
    { headers: getAuthHeaders() },
  );
  return data;
};

// All per-user Meta Ads UI preferences in one namespaced document:
//   { preference: { userId, analytics: { visibleMetricKeys },
//                   tables: { campaign: [], adset: [], ad: [] } } }
// Analytics falls back to catalog defaults; table columns default to empty
// (opt-in), so tables render exactly as they did before metric columns.
export const getMetaAdsPreference = async () => {
  const { data } = await axios.get(
    `${BASE_URL}/adsgpt/meta-ads/preferences`,
    { headers: getAuthHeaders() },
  );
  return data;
};

// Merge-PATCH: only the namespaces present in `patch` are touched, so the
// Analytics picker and the three table pickers can save independently
// without clobbering each other. Each namespace's key list is replaced
// wholesale (the picker always sends the complete checked list).
//   updateMetaAdsPreference({ analytics: { visibleMetricKeys: [...] } })
//   updateMetaAdsPreference({ tables: { campaign: [...] } })
export const updateMetaAdsPreference = async (patch) => {
  const { data } = await axios.patch(
    `${BASE_URL}/adsgpt/meta-ads/preferences`,
    patch,
    { headers: getAuthHeaders() },
  );
  return data;
};

// Convenience wrapper kept so MetricsPicker's default save path stays a
// one-liner for the Analytics surface.
export const updateAnalyticsMetricsPreference = async (visibleMetricKeys) =>
  updateMetaAdsPreference({ analytics: { visibleMetricKeys } });

export const getUserAdPostingInfo = async (userId, { facebookId } = {}) => {
  const { data } = await axios.get(`${BASE_URL}/adsgpt/ad-posting/users/${userId}`, {
    headers: getAuthHeaders(facebookId),
  });
  return data;
};

export const getFacebookAccounts = async (userId) => {
  const { data } = await axios.get(
    `${BASE_URL}/adsgpt/ad-posting/users/${userId}/accounts`,
    { headers: getAuthHeaders() },
  );
  return data;
};

// Cell-aware ad creation. Campaign + Ad Set must already exist; the
// backend reads the campaign objective and ad-set conversion location
// to build the right creative shape (image/video, link_data/video_data,
// app promotion, etc.). Powers the MySpace → Post Ad flow.
// Note: distinct from `createMetaAdV2` further down, which hits the
// wizard's `/meta-ads/v2/create-ad` endpoint.
export const postAdV2 = async (payload) => {
  const { data } = await axios.post(
    `${BASE_URL}/adsgpt/ad-posting/ads/v2/create`,
    payload,
    { headers: getAuthHeaders() },
  );
  return data;
};

// Cell-aware Google ad creation. Backend auto-detects the ad type
// (SEARCH / DISPLAY / DEMAND_GEN) from the campaign's channelType using
// the `campaignId` in the body. `adAccountId` rides in the body (NOT
// the URL). Powers MySpace → Post Ad for Google.
// For video ads where the body carries `videoUrl` (direct MP4), the
// backend uploads to YouTube + polls — request can hang up to ~2min.
export const postGoogleAd = async (payload) => {
  const { data } = await axios.post(
    `${BASE_URL}/adsgpt/google-ads/ads`,
    payload,
    { headers: getAuthHeaders() },
  );
  return data;
};

// `campaignId` is only needed when level is 'adset'/'ad' — it lets the
// managed-campaign plan gate identify the parent without a Meta lookup.
// Optional: omitting it means the gate allows the call through.
export const updateAdStatus = async (level, id, status, campaignId) => {
  const { data } = await axios.patch(
    `${BASE_URL}/adsgpt/meta-ads/update-status`,
    campaignId ? { level, id, status, campaignId } : { level, id, status },
    { headers: getAuthHeaders() },
  );
  return data;
};
export const metaDisconnect = async (userId, facebookId) => {
  const suffix = facebookId ? `/${encodeURIComponent(facebookId)}` : '';
  const { data } = await axios.delete(`${BASE_URL}/adsgpt/ad-posting/users/${userId}${suffix}`, {
    headers: getAuthHeaders(),
  });
  return data;
};

// ── creation flow (Meta Ads Manager-style wizard) ─────────────────────────────

// Pages assigned to THIS ad account — backend scopes to the ad account's
// owning business (or /me/accounts for personal accounts). Mirrors Meta
// Ads Manager's own picker; if a user expects to see a page that's
// missing, the fix is to assign it at Business Settings → Ad Accounts →
// Pages, not to widen the API scope.
export const getMetaPages = async (adAccountId, { facebookId } = {}) => {
  if (!adAccountId) throw new Error('getMetaPages: adAccountId is required');
  const { data } = await axios.get(`${BASE_URL}/adsgpt/meta-ads/get-pages`, {
    params: { adAccountId },
    headers: getAuthHeaders(facebookId),
  });
  return data;
};

export const getMetaSavedAudiences = async (adAccountId) => {
  const { data } = await axios.get(
    `${BASE_URL}/adsgpt/meta-ads/get-saved-audiences`,
    { params: { adAccountId }, headers: getAuthHeaders() },
  );
  return data;
};

// Geo-location typeahead — proxies Meta's `adgeolocation` search. Powers
// the V2 wizard's Location Targeting picker. Backend filters Taiwan +
// Singapore from results until per-country regulatory declarations land.
// `types` is a comma-separated subset of country/city/region/country_group.
export const searchGeoLocations = async ({ q, types, limit } = {}) => {
  const { data } = await axios.get(
    `${BASE_URL}/adsgpt/meta-ads/search-geo`,
    {
      params: { q, types, limit },
      headers: getAuthHeaders(),
    },
  );
  return data;
};

// Resolve ANY search pick's coordinates via Meta's OWN mechanism
// (adgeolocationmeta) — the same follow-up call Meta Ads Manager itself
// makes when a user clicks a result (captured directly from their network
// traffic 2026-07-06). Pass the `metaBucket` value already attached to
// the search result row (see searchGeoLocations) — the backend doesn't
// re-derive the type→bucket mapping, it just uses what it's given. Try
// this BEFORE the Nominatim fallbacks — it's Meta's own precise data,
// not a name-based guess.
// Returns: { result: { latitude, longitude, countryCode, regionId } | null }
export const resolveLocationCoordinates = async ({ bucket, key } = {}) => {
  const { data } = await axios.get(
    `${BASE_URL}/adsgpt/meta-ads/resolve-location-coordinates`,
    {
      params: { bucket, key },
      headers: getAuthHeaders(),
    },
  );
  return data;
};

// Geocode a place name → { latitude, longitude, displayName } via the
// backend's OpenStreetMap Nominatim proxy. Meta's search typeahead has no
// coordinates, so the wizard calls this to auto-pin a selected city/region
// on the map. `countryCode` (2-letter) narrows the match when known.
export const geocodeLocation = async ({ q, countryCode } = {}) => {
  const { data } = await axios.get(
    `${BASE_URL}/adsgpt/meta-ads/geocode`,
    {
      params: { q, countryCode },
      headers: getAuthHeaders(),
    },
  );
  return data;
};

// Reverse-geocode lat/lng → { displayName, countryCode } via Nominatim.
// The map-pin picker calls this to reject ocean clicks. Returns
// `result: null` for water / no-match; on Nominatim outage the backend
// returns `result: null, degraded: true` so the caller can fail open.
export const reverseGeocodeLocation = async ({ lat, lng } = {}) => {
  const { data } = await axios.get(
    `${BASE_URL}/adsgpt/meta-ads/reverse-geocode`,
    {
      params: { lat, lng },
      headers: getAuthHeaders(),
    },
  );
  return data;
};

// ─── Detailed Targeting (Demographics / Interests / Behaviours) ─────────────
//
// Wraps the four backend endpoints documented at
// `nodejs-backend/controllers/adPosting/metaAdLauncher.js`'s detailed-targeting
// section. All four cache server-side via Redis with sensible TTLs.

// Typeahead across all 15 detailed-targeting classes. `classes` is a
// comma-separated subset; when exactly one class is passed, backend sends
// it as `limit_type` to narrow Meta's results. Meta's endpoint lives on
// the ad-account node (`/act_X/targetingsearch`) so `adAccountId` is
// required — the backend rejects without it.
// Returns: { results: [{ id, name, type, path, audienceSize, description }] }
export const searchDetailedTargeting = async ({ adAccountId, q, classes, limit = 25 } = {}) => {
  const { data } = await axios.get(
    `${BASE_URL}/adsgpt/meta-ads/detailed-targeting/search`,
    {
      params: { adAccountId, q, classes, limit },
      headers: getAuthHeaders(),
    },
  );
  return data;
};

// Browse tree — Meta's categorical hierarchy of Demographics / Interests /
// Behaviours. `root` is an item id to expand (omit for the top level).
// `isExclusion: true` forwards Meta's `is_exclusion` param, which filters
// out items no longer eligible for exclude-context targeting (e.g.
// relationship-status demographics like Divorced) — NOT a general
// discontinued-item filter, only relevant when browsing for an Exclude
// bucket. No current call site (Exclude is removed from the wizard, see
// DetailedTargeting.jsx) — pass it if/when that section comes back.
// Endpoint: `/act_X/targetingbrowse` — `adAccountId` required.
// Returns: { tree: [{ id, name, type, path, leaf }] }
export const browseDetailedTargeting = async ({ adAccountId, root, classes, isExclusion } = {}) => {
  const { data } = await axios.get(
    `${BASE_URL}/adsgpt/meta-ads/detailed-targeting/browse`,
    {
      params: { adAccountId, root, classes, isExclusion: isExclusion ? "true" : undefined },
      headers: getAuthHeaders(),
    },
  );
  return data;
};

// Related-item suggestions for a set of already-picked items. POST
// because `items` is a list of {type, id} objects. Endpoint:
// `/act_X/targetingsuggestions` — `adAccountId` required.
// Returns: { suggestions: [{ id, name, type, path, audienceSize }] }
export const suggestDetailedTargeting = async ({ adAccountId, items = [] } = {}) => {
  const { data } = await axios.post(
    `${BASE_URL}/adsgpt/meta-ads/detailed-targeting/suggestions`,
    { adAccountId, items },
    { headers: getAuthHeaders() },
  );
  return data;
};

// Audience reach estimate for the current targeting spec. POST because
// the body carries the full targeting object (locations + age range +
// detailed-targeting flexible_spec + etc.).
//
// Returns: { estimate: { lowerBound, upperBound, estimateReady }, degraded?, cachedAt? }
// `degraded: true` means we're serving a stale cached value because Meta
// is rate-limiting the live call (their reachestimate endpoint is capped
// per-account/per-hour). The widget should show a clock icon + tooltip.
export const reachEstimateForTargeting = async ({
  adAccountId,
  targeting,
  optimizationGoal,
} = {}) => {
  const { data } = await axios.post(
    `${BASE_URL}/adsgpt/meta-ads/detailed-targeting/reach-estimate`,
    { adAccountId, targeting, optimizationGoal },
    { headers: getAuthHeaders() },
  );
  return data;
};

// Checks which already-picked Detailed Targeting items Meta has since
// discontinued (subcode 1870211 at publish otherwise, with no indication
// of which item is stale). Not cached server-side — call sparingly (Ad
// Set step mount + right before Launch), not on every keystroke.
// Returns: { invalid: [{ type, id }, ...], degraded? }
export const validateDetailedTargeting = async ({ adAccountId, items = [] } = {}) => {
  const { data } = await axios.post(
    `${BASE_URL}/adsgpt/meta-ads/detailed-targeting/validate`,
    { adAccountId, items },
    { headers: getAuthHeaders() },
  );
  return data;
};

// Apps promotable from THIS ad account — backend queries
// `act_<adAccountId>/applications` only (matches Meta Ads Manager's own
// scoping). Apps without a store URL (Instant Games / fb_canvas / web)
// are filtered out server-side. Response shape per app:
//   { id, name, category, appleAppStoreUrl, googlePlayUrl,
//     supportedPlatforms: ["IPHONE","IPAD","ANDROID",…] }
// The frontend further filters by mobileAppStore.
export const getPromotableApps = async (adAccountId) => {
  if (!adAccountId) throw new Error('getPromotableApps: adAccountId is required');
  const { data } = await axios.get(
    `${BASE_URL}/adsgpt/meta-ads/get-promotable-apps`,
    {
      params: { adAccountId },
      headers: getAuthHeaders(),
    },
  );
  return data;
};

// Lead Forms (Instant Forms) on a Facebook Page. Returns active forms
// the user can attach to a Leads/Instant Form ad. Each form is
// { id, name, status, createdTime, locale, leadsCount }.
export const getLeadForms = async (pageId, { facebookId } = {}) => {
  const { data } = await axios.get(
    `${BASE_URL}/adsgpt/meta-ads/get-lead-forms`,
    { params: { pageId }, headers: getAuthHeaders(facebookId) },
  );
  return data;
};

// Create a new Lead Form on a Page. Returns { form: { id, name, status } }.
// Required: pageId, name, privacyPolicyUrl. Optional everything else
// (sensible defaults applied server-side).
export const createLeadForm = async (payload) => {
  const { data } = await axios.post(
    `${BASE_URL}/adsgpt/meta-ads/create-lead-form`,
    payload,
    { headers: getAuthHeaders() },
  );
  return data;
};

// Captured leads for an Instant Form — powers the dashboard's Leads tab
// table. Returns { leads, fieldNames, count, truncated, fetchedAt }.
// `truncated` is true when the form holds more leads than the server-side
// fetch cap, so `count` must not be presented as the form's real total.
// `fetchedAt` is when these rows actually came off Meta (which, on a server
// cache hit, is earlier than this request) — it drives the freshness label.
// Needs the connected account to have granted the `leads_retrieval` scope;
// without it the call rejects 403 with `code: 'LEADS_SCOPE_MISSING'`.
//
// `refresh` bypasses the server-side cache. Reserve it for the explicit
// Refresh button — the leads edge is rate-limited by lead volume, so
// automatic loads should ride the cache.
export const getFormLeads = async ({ formId, pageId, facebookId, refresh }) => {
  const { data } = await axios.get(
    `${BASE_URL}/adsgpt/meta-ads/get-form-leads`,
    {
      params: { formId, pageId, ...(refresh ? { refresh: true } : {}) },
      headers: getAuthHeaders(facebookId),
    },
  );
  return data;
};

// Download captured leads as a CSV (opens in Excel). Fetches the file as
// a blob with auth headers — a plain <a href> can't carry the
// Authorization header — then triggers a client-side download.
export const downloadFormLeadsCsv = async ({
  formId,
  pageId,
  formName,
  facebookId,
  truncated = false,
}) => {
  try {
    const res = await axios.get(
      `${BASE_URL}/adsgpt/meta-ads/export-form-leads`,
      {
        params: { formId, pageId, formName },
        headers: getAuthHeaders(facebookId),
        responseType: 'blob',
      },
    );
    const blob = new Blob([res.data], { type: 'text/csv;charset=utf-8' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safe = String(formName || 'leads').replace(/[^a-z0-9_-]+/gi, '-');
    // The server sets a matching Content-Disposition, but a blob download
    // names the file client-side, so the "this export is partial" signal has
    // to be re-applied here or it's lost the moment the file leaves the app.
    // `truncated` comes from the same fetch that populated the table.
    a.download = `leads-${safe}${truncated ? '-partial' : ''}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  } catch (err) {
    // responseType:'blob' means a backend JSON error arrives as a Blob —
    // re-parse it so the caller's e.message shows the real reason.
    const blob = err?.response?.data;
    if (blob instanceof Blob) {
      let msg = 'Failed to download leads';
      try {
        const json = JSON.parse(await blob.text());
        msg = json.error || json.details || msg;
      } catch {
        /* not JSON — keep the default message */
      }
      throw new Error(msg);
    }
    throw err;
  }
};

// Pixels on an ad account — feeds the Pixel picker in the V2 wizard for
// Leads cells that use OFFSITE_CONVERSIONS optimisation (Website /
// Multiple). Each pixel: { id, name, lastFiredTime, creationTime }.
export const getPixels = async (adAccountId) => {
  const { data } = await axios.get(
    `${BASE_URL}/adsgpt/meta-ads/get-pixels`,
    { params: { adAccountId }, headers: getAuthHeaders() },
  );
  return data;
};

// Conversion events on a specific Pixel — feeds the Event picker beside
// the Pixel picker. Returns { eventType, lastFiredTime, count }.
export const getPixelEvents = async (pixelId) => {
  const { data } = await axios.get(
    `${BASE_URL}/adsgpt/meta-ads/get-pixel-events`,
    { params: { pixelId }, headers: getAuthHeaders() },
  );
  return data;
};

// Create a new Pixel on an ad account. Returns { pixel: { id, name },
// snippetSetupUrl } — the URL points at Meta Events Manager where the
// user installs the JS snippet that fires the events. Pixel exists in
// Meta immediately; events start flowing once the snippet is in place.
export const createPixel = async ({ adAccountId, name }) => {
  const { data } = await axios.post(
    `${BASE_URL}/adsgpt/meta-ads/create-pixel`,
    { adAccountId, name },
    { headers: getAuthHeaders() },
  );
  return data;
};

// Product Catalogs the ad account can advertise from — feeds the Catalog
// picker in the V2 wizard's Sales/CATALOG cell (Dynamic Product Ads).
// Returns `{ catalogs: [{ id, name, productCount }], count }`.
export const getCatalogs = async (adAccountId) => {
  const { data } = await axios.get(
    `${BASE_URL}/adsgpt/meta-ads/get-catalogs`,
    { params: { adAccountId }, headers: getAuthHeaders() },
  );
  return data;
};

// Product Sets inside a Catalog — feeds the Product Set picker beside the
// Catalog picker. Returns `{ productSets: [{ id, name, productCount }], count }`.
export const getProductSets = async (catalogId) => {
  const { data } = await axios.get(
    `${BASE_URL}/adsgpt/meta-ads/get-product-sets`,
    { params: { catalogId }, headers: getAuthHeaders() },
  );
  return data;
};

// Full-resolution preview media for one ad — fetched lazily when the Ad
// Preview pane opens, because the bulk getAds endpoint only returns
// `thumbnail_url` (low-res) and `object_story_spec.video_data` (no
// playable URL). Returns `{ kind: 'image' | 'video', imageUrl?,
// videoUrl?, posterUrl? }`.
export const getAdPreviewMedia = async (adId) => {
  const { data } = await axios.get(
    `${BASE_URL}/adsgpt/meta-ads/get-ad-preview-media`,
    { params: { adId }, headers: getAuthHeaders() },
  );
  return data;
};

export const createMetaCampaign = async (payload) => {
  const { data } = await axios.post(
    `${BASE_URL}/adsgpt/meta-ads/create-campaign`,
    payload,
    { headers: getAuthHeaders() },
  );
  return data;
};

export const createMetaAdSet = async (payload) => {
  const { data } = await axios.post(
    `${BASE_URL}/adsgpt/meta-ads/create-adset`,
    payload,
    { headers: getAuthHeaders() },
  );
  return data;
};

// Two paths, one endpoint:
//   1. `image` (File from <input type="file">) → multipart upload
//   2. `imageUrl` (string from the user's generated-media library) → JSON;
//      backend fetches the URL server-side and base64-uploads to Meta
// `adAccountId` is the bare id (no `act_` prefix — backend prepends it).
export const uploadMetaAdImage = async ({ adAccountId, image, imageUrl }) => {
  if (imageUrl) {
    const { data } = await axios.post(
      `${BASE_URL}/adsgpt/meta-ads/upload-image`,
      { adAccountId, imageUrl },
      { headers: getAuthHeaders() },
    );
    return data;
  }
  const form = new FormData();
  form.append('adAccountId', adAccountId);
  form.append('image', image);
  const { data } = await axios.post(
    `${BASE_URL}/adsgpt/meta-ads/upload-image`,
    form,
    { headers: { ...getAuthHeaders(), 'Content-Type': 'multipart/form-data' } },
  );
  return data;
};

// Same two-path API as uploadMetaAdImage but for video creatives.
// Returns `{ videoId }`. Meta's video pipeline is asynchronous —
// the returned id is usable immediately even though the video is
// still encoding in the background; the ad creation accepts it
// and starts delivering once encoding completes.
export const uploadMetaAdVideo = async ({ adAccountId, video, videoUrl }) => {
  if (videoUrl) {
    const { data } = await axios.post(
      `${BASE_URL}/adsgpt/meta-ads/upload-video`,
      { adAccountId, videoUrl },
      { headers: getAuthHeaders() },
    );
    return data;
  }
  const form = new FormData();
  form.append('adAccountId', adAccountId);
  form.append('video', video);
  const { data } = await axios.post(
    `${BASE_URL}/adsgpt/meta-ads/upload-video`,
    form,
    { headers: { ...getAuthHeaders(), 'Content-Type': 'multipart/form-data' } },
  );
  return data;
};

// Slim picker endpoint for the campaign wizard's "Select from library" tab.
// Returns minimal rows: { _id, type, model, url, createdAt } — backend
// resolves the right URL across legacy (string) and new (object with
// base_image_with_logo / base_image) row shapes, and drops rows that have
// no usable asset URL. No cost / credit / aggregation fields.
export const getMediaLibrary = async ({
  userId,
  type,
  source,
  page = 1,
  limit = 24,
} = {}) => {
  if (!userId) throw new Error('getMediaLibrary: userId is required');
  const params = { page, limit };
  if (type) params.type = type;
  // Optional provenance filter (e.g. source=aiAssistant → only AI Assistant
  // generations). Omitted by the campaign-wizard callers, which want everything.
  if (source) params.source = source;
  const { data } = await axios.get(
    `${BASE_URL}/adsgpt/generated-media/library/${encodeURIComponent(userId)}`,
    { params, headers: getAuthHeaders() },
  );
  return data;
};

export const createMetaAd = async (payload) => {
  const { data } = await axios.post(
    `${BASE_URL}/adsgpt/meta-ads/create-ad`,
    payload,
    { headers: getAuthHeaders() },
  );
  return data;
};

export const deleteMetaCampaign = async ({ adAccountId, campaignId }) => {
  const { data } = await axios.delete(
    `${BASE_URL}/adsgpt/meta-ads/delete-campaign`,
    {
      headers: getAuthHeaders(),
      data: { adAccountId, campaignId },
    },
  );
  return data;
};

// LLM Audit + Fix moved to @/apis/autopilot/llmAuditApi (mounted under
// /meta-ads/autopilot/llm-audit/* on the backend). Import from there.

// ── V2 wizard endpoints ───────────────────────────────────────────────────────
// Backed by config/wizardSchema.js + meta.v2.validator.js on the server.
// Side-by-side with V1 endpoints; the wizard fetches `getWizardSchemaV2`
// once at mount and renders entirely from the response.

export const getWizardSchemaV2 = async () => {
  const { data } = await axios.get(
    `${BASE_URL}/adsgpt/meta-ads/wizard-schema`,
    { headers: getAuthHeaders() },
  );
  return data;
};

export const createMetaCampaignV2 = async (payload) => {
  const { data } = await axios.post(
    `${BASE_URL}/adsgpt/meta-ads/v2/create-campaign`,
    payload,
    { headers: getAuthHeaders() },
  );
  return data;
};

// Edit an existing campaign (name / budget / spend cap). Only the provided
// fields are changed; objective + special categories are immutable.
export const updateMetaCampaignV2 = async (payload) => {
  const { data } = await axios.patch(
    `${BASE_URL}/adsgpt/meta-ads/v2/update-campaign`,
    payload,
    { headers: getAuthHeaders() },
  );
  return data;
};

export const createMetaAdSetV2 = async (payload) => {
  const { data } = await axios.post(
    `${BASE_URL}/adsgpt/meta-ads/v2/create-adset`,
    payload,
    { headers: getAuthHeaders() },
  );
  return data;
};

// Full editable shape for an existing ad set (reverse-mapped targeting +
// resolved geo names). Powers the "Edit ad set" flow.
export const resolveAdSetForEdit = async ({ adSetId } = {}) => {
  const { data } = await axios.get(
    `${BASE_URL}/adsgpt/meta-ads/v2/resolve-adset`,
    {
      params: { adSetId },
      headers: getAuthHeaders(),
    },
  );
  return data;
};

// Edit an existing ad set (name / budget / bid cap / targeting / schedule).
// Delivery + identity fields are immutable and rejected server-side.
export const updateMetaAdSetV2 = async (payload) => {
  const { data } = await axios.patch(
    `${BASE_URL}/adsgpt/meta-ads/v2/update-adset`,
    payload,
    { headers: getAuthHeaders() },
  );
  return data;
};

export const createMetaAdV2 = async (payload) => {
  const { data } = await axios.post(
    `${BASE_URL}/adsgpt/meta-ads/v2/create-ad`,
    payload,
    { headers: getAuthHeaders() },
  );
  return data;
};

// Editable shape for an existing ad (creative copy/CTA/link + existing media
// tokens). Powers the "Edit ad" flow.
export const resolveAdForEdit = async ({ adId } = {}) => {
  const { data } = await axios.get(
    `${BASE_URL}/adsgpt/meta-ads/v2/resolve-ad`,
    {
      params: { adId },
      headers: getAuthHeaders(),
    },
  );
  return data;
};

// Edit an ad (name + creative copy/CTA/link). Rebuilds the creative
// server-side (Meta won't edit one in place) and re-points the ad.
export const updateMetaAdV2 = async (payload) => {
  const { data } = await axios.patch(
    `${BASE_URL}/adsgpt/meta-ads/v2/update-ad`,
    payload,
    { headers: getAuthHeaders() },
  );
  return data;
};

// ─── Campaign Templates ──────────────────────────────────────────────────────
// Saved snapshots of the V2 wizard `form` state. Per-user. Used to stamp out
// new campaigns from a known-good setup (budget / account / name editable on
// apply). See campaignTemplate.controller.js on the backend.

// Slim list for the picker (id, name, objective, conversionLocation, dates).
export const listCampaignTemplates = async () => {
  const { data } = await axios.get(
    `${BASE_URL}/adsgpt/meta-ads/v2/templates`,
    { headers: getAuthHeaders() },
  );
  return data;
};

// Full payload for applying a template.
export const getCampaignTemplate = async (id) => {
  const { data } = await axios.get(
    `${BASE_URL}/adsgpt/meta-ads/v2/templates/${id}`,
    { headers: getAuthHeaders() },
  );
  return data;
};

// Save the current wizard form as a named template. `payload` is the wizard
// `form` object (transient File handles stripped beforehand).
export const saveCampaignTemplate = async ({ name, payload, objective, conversionLocation } = {}) => {
  const { data } = await axios.post(
    `${BASE_URL}/adsgpt/meta-ads/v2/templates`,
    { name, payload, objective, conversionLocation },
    { headers: getAuthHeaders() },
  );
  return data;
};

export const deleteCampaignTemplate = async (id) => {
  const { data } = await axios.delete(
    `${BASE_URL}/adsgpt/meta-ads/v2/templates/${id}`,
    { headers: getAuthHeaders() },
  );
  return data;
};

// Resolve the wizard cell (objective × conversionLocation) for an existing
// ad set — powers the management "Add Ad" flow so the wizard knows which
// cell schema to render. Returns { objective, conversionLocation,
// campaignId, adSetId, pageId }. 422 = campaign objective not V2-supported.
export const resolveCellForAdSet = async ({ adSetId, campaignId } = {}) => {
  const { data } = await axios.get(
    `${BASE_URL}/adsgpt/meta-ads/v2/resolve-cell`,
    {
      params: { adSetId, campaignId },
      headers: getAuthHeaders(),
    },
  );
  return data;
};

// Fresh campaign settings for the "Add Ad Set" flow. The campaign list is
// cached, so this live read ensures the wizard knows the campaign's bid
// strategy (a capped CBO campaign needs a per-ad-set bid cap), CBO state,
// and special ad categories. Returns { objective, cbo, campaignBudgetType,
// bidStrategy, specialAdCategories, existingOptimizationGoal }.
// `existingOptimizationGoal` (added 2026-07-06, subcode 1885760 fix): the
// optimization_goal of an existing ad set in this campaign, or null if the
// campaign has none yet. Meta requires every ad set in a campaign to share
// the same optimization_goal under "lowest cost" bidding — both bid
// strategies this wizard offers — so Add Ad Set uses this to lock the
// Performance goal field instead of letting a mismatch reach publish.
export const resolveCampaignForAdd = async ({ campaignId } = {}) => {
  const { data } = await axios.get(
    `${BASE_URL}/adsgpt/meta-ads/v2/resolve-campaign`,
    {
      params: { campaignId },
      headers: getAuthHeaders(),
    },
  );
  return data;
};
