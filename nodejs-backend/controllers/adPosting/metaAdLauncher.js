const bizSdk = require("facebook-nodejs-business-sdk");
const axios = require("axios");
const dayjs = require("dayjs");
const AdAccount = bizSdk.AdAccount;
const Campaign = bizSdk.Campaign;
const AdSet = bizSdk.AdSet;
const Ad = bizSdk.Ad;
const { redisClient } = require("../../db/redis");
const FBUsers = require("../../Module/adPosting/facebookUsers");
const { decrypt } = require("../../utils/crypto");
const logger = require("../../utils/logger");
const {
  formatBudget,
  getAdFields,
  getAdSetFields,
  getInsightsFields,
  getCampaignFields,
} = require("../../utils/metaHelpers");
const {
  updateAdStatusSchema,
  createCampaignSchema,
  createAdSetSchema,
  createAdSchema,
  deleteCampaignSchema,
} = require("../../Validations/meta.validator");
const { runAuditForAccount } = require("../../services/metaAuditService");
const {
  getAccessTokenForAccount,
} = require("../../config/autopilotConfig");
const REDIS_TTL = 7200;

// Cursor-pagination helper for the Meta SDK. Meta's edges default to 25
// items per call — agencies routinely have more campaigns / ad sets / ads
// than that, so a single SDK call truncates their list. Pass the first-
// page cursor (e.g. `account.getCampaigns(fields, { limit: 100 })`) and
// this walks the rest. 50-page safety cap (= 5000 items) prevents a
// malformed cursor from looping forever.
async function fetchAllPaged(firstPageCursor, label = "items") {
  let cursor = await firstPageCursor;
  const items = [...cursor];
  let pages = 1;
  while (
    typeof cursor?.hasNext === "function" &&
    cursor.hasNext() &&
    pages < 50
  ) {
    cursor = await cursor.next();
    items.push(...cursor);
    pages += 1;
  }
  if (pages > 1) {
    logger.info(`fetchAllPaged: ${items.length} ${label} across ${pages} pages`);
  }
  return items;
}
// Volatile metrics (spend, impressions, clicks, period summaries) drift in
// real time. A long TTL across multiple datePresets cached at different
// moments produces visibly inconsistent numbers (e.g. "today" appearing to
// exceed "last_7d" because last_7d is hours stale). 5 minutes keeps the cache
// useful while bounding the temporal skew users can observe.
const VOLATILE_TTL = 300;

// Cache key prefixes whose payloads embed status fields and therefore
// must be invalidated when a campaign/adset/ad status changes.
const STATUS_CACHE_PREFIXES = [
  "metaCampaigns",
  "metaAdsets",
  "metaCampaignAds",
  "metaAdSetAds",
  "metaDashboard",
];

// Every cache prefix this controller writes under. Used on disconnect to
// wipe any trace of the previous FB session — the access token is gone, so
// holding cached data keyed to the same userId would be both stale and
// confusing if the user reconnects with a different FB account.
const ALL_CACHE_PREFIXES = [
  ...STATUS_CACHE_PREFIXES,
  "metaAnalytics",
  "metaInsights",
  "metaAudit",
  "metaAdAccounts",
  // Sales/CATALOG pickers — 30-min TTL keys for catalog + product-set
  // lists. Clear on FB disconnect so a reconnected account doesn't see
  // the previous user's catalogues.
  "metaCatalogs",
  "metaProductSets",
  // Ad-preview media URLs (full-res image / playable video source).
  // CDN-signed URLs valid for hours; clear on disconnect so stale signed
  // URLs from a different connection don't leak across reconnects.
  "metaAdPreview",
];

async function invalidateMetaCacheByPrefixes(userId, prefixes) {
  const keysToDelete = [];
  for (const prefix of prefixes) {
    // Structured keys: prefix:userId:...
    const stream = redisClient.scanStream({
      match: `${prefix}:${userId}:*`,
      count: 100,
    });
    for await (const keys of stream) {
      if (keys.length) keysToDelete.push(...keys);
    }
    // Bare keys: prefix:userId (e.g., metaAdAccounts:userId)
    keysToDelete.push(`${prefix}:${userId}`);
  }
  if (keysToDelete.length) {
    await redisClient.del(...keysToDelete);
  }
}

async function invalidateUserMetaCache(userId) {
  return invalidateMetaCacheByPrefixes(userId, STATUS_CACHE_PREFIXES);
}

async function invalidateAllUserMetaCache(userId) {
  return invalidateMetaCacheByPrefixes(userId, ALL_CACHE_PREFIXES);
}

// Pull every drop of context out of a Meta SDK / Graph API error so the
// log + the response surface what Meta actually rejected. The bare
// `error.message` from the Node Business SDK is usually just "Invalid
// parameter", which is useless for debugging — the real story lives in
// nested fields like error_user_msg, error_subcode, and error_data.
//
// The SDK's FacebookRequestError shape varies by version. We probe every
// path Meta is known to use, then fall back to dumping the whole object so
// we never lose the trace.
function formatMetaError(error) {
  // The Node Business SDK (current versions) flattens the response body
  // straight onto `error.response`, so error_user_msg / code / error_subcode
  // live there directly — NOT under `.response.error`. Older SDK versions and
  // raw axios shapes use the nested form. Newest first, then fall back.
  const candidates = [
    error?.response, // current SDK: response IS the error body
    error?.response?.error,
    error?.response?.data?.error,
    error?.response?.body?.error,
    error?.body?.error,
    error?.error, // SDK does Object.assign(this, response.body) in some versions
    error,
  ].filter(Boolean);

  const pick = (key) => {
    for (const c of candidates) if (c?.[key] != null) return c[key];
    return undefined;
  };

  return {
    message:
      pick("error_user_msg") ||
      pick("message") ||
      error?.message ||
      "Unknown Meta API error",
    title: pick("error_user_title"),
    code: pick("code"),
    subcode: pick("error_subcode"),
    type: pick("type"),
    fbtraceId: pick("fbtrace_id"),
    data: pick("error_data"),
  };
}

// Best-effort dump of the entire error object so we can see exactly what the
// SDK threw — including non-enumerable props (status, response, etc.) that
// JSON.stringify normally drops.
function rawErrorDump(error) {
  try {
    const own = Object.getOwnPropertyNames(error || {});
    const flat = {};
    for (const k of own) {
      const v = error[k];
      if (v && typeof v === "object") {
        // One level deep — enough for response/body/error nesting.
        flat[k] = JSON.parse(JSON.stringify(v, (sk, sv) => (sk === "headers" ? undefined : sv)));
      } else {
        flat[k] = v;
      }
    }
    return JSON.stringify(flat).slice(0, 4000);
  } catch (e) {
    return `<<unstringifiable: ${e.message}>>`;
  }
}

function logMetaError(prefix, error) {
  const m = formatMetaError(error);
  logger.error(
    `${prefix}: ${m.message}` +
      (m.code ? ` [code=${m.code}]` : "") +
      (m.subcode ? ` [subcode=${m.subcode}]` : "") +
      (m.fbtraceId ? ` [fbtrace=${m.fbtraceId}]` : "") +
      (m.data ? ` data=${JSON.stringify(m.data)}` : ""),
  );
  // Until we've seen this code path land at least once in prod, also dump
  // the raw error so we can match shape vs. our extractor. Keep this until
  // we've confirmed `formatMetaError` is pulling the rich fields reliably,
  // then drop it.
  logger.error(`${prefix} [raw]: ${rawErrorDump(error)}`);
  return m;
}

// Resolve the FB OAuth token + initialize the Meta SDK for the calling user.
// Throws an Error tagged with `.statusCode` so handlers can map cleanly to HTTP.
async function initApiForUser(userId) {
  const fbUser = await FBUsers.findOne({ userId });
  if (!fbUser) {
    const err = new Error("Facebook user not found");
    err.statusCode = 404;
    throw err;
  }
  const accessToken = decrypt(fbUser?.accessToken);
  if (!accessToken) {
    const err = new Error("Access token is missing");
    err.statusCode = 401;
    throw err;
  }
  const api = bizSdk.FacebookAdsApi.init(accessToken);
  bizSdk.FacebookAdsApi.setDefaultApi(api);
  return { fbUser, accessToken };
}

// Page-scoped access token lookup. Meta's leadgen_forms edge enforces a
// Page Access Token (error #190 otherwise). We try paths in order of
// reliability:
//   1. The typed Page(id).get(['access_token']) — fastest, covers most
//      admin-style page roles.
//   2. /me/accounts — direct admin pages.
//   3. Walk /me/businesses and try each business's owned_pages + client_pages.
//      Mirrors getPages's traversal so any page reachable by the user via
//      the wizard's page picker is also reachable here.
//
// Returns the token string or null. Caller surfaces a clean 403 on null.
//
// Implemented as a module-level function (not a class method) because
// Express route handlers are invoked without `this` binding — `this`
// would be undefined inside the controller method.
async function getPageAccessToken(pageId) {
  // Path 1: typed Page node.
  try {
    const page = await new bizSdk.Page(pageId).get(["access_token"]);
    const tok = page?.access_token || page?._data?.access_token;
    if (tok) return tok;
  } catch (e) {
    logger.warn(`getPageAccessToken: Page(${pageId}).get failed: ${e.message}`);
  }

  const me = new bizSdk.User("me");

  // Path 2: /me/accounts.
  try {
    const accounts = await me.getAccounts(["id", "access_token"]);
    const match = accounts.find((p) => p.id === pageId);
    const tok = match?.access_token || match?._data?.access_token;
    if (tok) return tok;
  } catch (e) {
    logger.warn(`getPageAccessToken: /me/accounts failed: ${e.message}`);
  }

  // Path 3: walk businesses.
  try {
    const businesses = await me.getBusinesses(["id"]);
    for (const biz of businesses) {
      for (const method of ["getOwnedPages", "getClientPages"]) {
        try {
          const pages = await biz[method](["id", "access_token"]);
          const match = pages.find((p) => p.id === pageId);
          const tok = match?.access_token || match?._data?.access_token;
          if (tok) return tok;
        } catch (_) { /* per-business swallow; try next */ }
      }
    }
  } catch (e) {
    logger.warn(`getPageAccessToken: business iteration failed: ${e.message}`);
  }

  return null;
}

// ── Captured Lead submissions ───────────────────────────────────────────
// The dashboard's Leads tab reads + exports leads captured by a Page's
// Instant Forms. Meta hard-gates the form `leads` edge behind the
// leads_retrieval OAuth scope (error #200 "Requires leads_retrieval
// permission" otherwise) — see authController's scope list.

// Fields requested per lead — everything the `leads` edge will surface.
// `field_data` carries the answers the person submitted; the rest is full
// attribution + source context so the exported sheet is self-contained.
const LEAD_FIELDS =
  "id,created_time,field_data,ad_id,ad_name,adset_id,adset_name," +
  "campaign_id,campaign_name,form_id,is_organic,platform,partner_name," +
  "custom_disclaimer_responses";

// "full_name" → "Full name", "phone_number" → "Phone number" — used for
// the CSV header so the exported sheet reads cleanly in Excel.
function prettifyLeadField(name) {
  return String(name || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// Pull every lead for a form, following Meta's cursor pagination. Capped
// at `maxLeads` (and a hard page-count ceiling) so a runaway form can't
// exhaust memory or hang the request.
async function fetchAllLeadsForForm(pageApi, formId, maxLeads = 5000) {
  const out = [];
  let after = null;
  for (let page = 0; page < 100; page++) {
    const params = { fields: LEAD_FIELDS, limit: 200 };
    if (after) params.after = after;
    const result = await pageApi.call("GET", [formId, "leads"], params);
    const data = result?._data || result || {};
    const batch = data.data || [];
    out.push(...batch);
    if (out.length >= maxLeads) return out.slice(0, maxLeads);
    after = data?.paging?.cursors?.after || null;
    if (!after || !data?.paging?.next || batch.length === 0) break;
  }
  return out;
}

// Flatten a raw Meta lead into a self-contained record.
// `field_data` is an array of { name, values:[…] }; each is collapsed to a
// single string (multi-value answers joined with "; "). Custom disclaimer
// / consent checkboxes are flattened to "key: Yes/No" pairs.
function normalizeLead(raw) {
  const fields = {};
  for (const fd of raw?.field_data || []) {
    if (!fd || !fd.name) continue;
    fields[fd.name] = Array.isArray(fd.values) ? fd.values.join("; ") : "";
  }
  const disclaimers = (raw?.custom_disclaimer_responses || [])
    .map((d) => {
      const key = d?.checkbox_key || d?.key || "";
      return key ? `${key}: ${d?.is_checked ? "Yes" : "No"}` : "";
    })
    .filter(Boolean)
    .join("; ");
  return {
    id: raw?.id || "",
    createdTime: raw?.created_time || null,
    campaignId: raw?.campaign_id || null,
    campaignName: raw?.campaign_name || null,
    adsetId: raw?.adset_id || null,
    adsetName: raw?.adset_name || null,
    adId: raw?.ad_id || null,
    adName: raw?.ad_name || null,
    formId: raw?.form_id || null,
    platform: raw?.platform || null,
    isOrganic: !!raw?.is_organic,
    source: raw?.is_organic ? "Organic" : "Paid ad",
    partnerName: raw?.partner_name || null,
    disclaimerResponses: disclaimers || null,
    fields,
  };
}

// Union of all question field names across the leads, in first-seen order
// — drives the table columns / CSV header. A form can be edited over time,
// so different leads may carry different field sets.
function leadFieldNames(leads) {
  const seen = [];
  for (const l of leads) {
    for (const name of Object.keys(l.fields || {})) {
      if (!seen.includes(name)) seen.push(name);
    }
  }
  return seen;
}

// Escape one CSV cell — wrap in quotes, double any embedded quote.
function csvCell(v) {
  return `"${(v == null ? "" : String(v)).replace(/"/g, '""')}"`;
}

// Serialise normalized leads to CSV text — the answer columns plus full
// attribution + source context so the sheet is self-contained for the
// advertiser's follow-up. Prefixed with a UTF-8 BOM so Excel reads
// non-ASCII names / addresses correctly on double-click.
function leadsToCsv(leads) {
  const fieldNames = leadFieldNames(leads);
  const header = [
    "Lead ID",
    "Captured",
    ...fieldNames.map(prettifyLeadField),
    "Campaign",
    "Ad set",
    "Ad",
    "Platform",
    "Source",
    "Partner",
    "Consent responses",
    "Form ID",
  ];
  const rows = leads.map((l) => [
    l.id || "",
    l.createdTime || "",
    ...fieldNames.map((f) => l.fields?.[f] || ""),
    l.campaignName || "",
    l.adsetName || "",
    l.adName || "",
    l.platform || "",
    l.source || "",
    l.partnerName || "",
    l.disclaimerResponses || "",
    l.formId || "",
  ]);
  return (
    "﻿" +
    [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n")
  );
}

// Normalise a Meta ad account id to the `act_<digits>` form Meta's
// node-scoped endpoints expect. Accepts either bare digits or already-
// prefixed strings; rejects anything else by returning null so the
// caller can 400 the request cleanly.
function normalizeAdAccountId(v) {
  const raw = String(v || "").trim();
  if (!raw) return null;
  if (raw.startsWith("act_")) {
    return /^act_\d+$/.test(raw) ? raw : null;
  }
  return /^\d+$/.test(raw) ? `act_${raw}` : null;
}

// Fetch the Page's phone number — needed for click-to-call ads.
// The `phone` field on the Page node is the number admins set in Page
// → About → Contact info. Returns the raw string (Meta returns it in
// the same format the admin entered) or null if absent.
async function getPagePhone(pageId) {
  try {
    const page = await new bizSdk.Page(pageId).get(["phone"]);
    const phone = page?.phone || page?._data?.phone || null;
    // Verbose debug — Meta's "Invalid phone number" (subcode 2061044)
    // depends entirely on the exact string the Page stores. Log it raw
    // (JSON.stringify so whitespace / hidden chars are visible) + a
    // char-code dump so we can see exactly what we're working with.
    logger.info(
      `getPagePhone: page=${pageId} raw=${JSON.stringify(phone)} ` +
        `type=${typeof phone} ` +
        `codes=[${phone ? [...String(phone)].map((c) => c.charCodeAt(0)).join(",") : ""}]`,
    );
    return phone;
  } catch (e) {
    logger.warn(`getPagePhone failed for ${pageId}: ${e.message}`);
    return null;
  }
}

// Drop list-level cache entries that should reflect a newly-created entity.
async function invalidateAfterCreate(userId, { adAccountId, campaignId, adSetId } = {}) {
  const keys = [];
  if (adAccountId) {
    keys.push(`metaCampaigns:${userId}:${adAccountId}`);
    keys.push(`metaDashboard:${userId}:${adAccountId}:*`);
    keys.push(`metaAnalytics:${userId}:${adAccountId}:*`);
  }
  if (campaignId) {
    keys.push(`metaAdsets:${userId}:*:${campaignId}`);
    keys.push(`metaCampaignAds:${userId}:${campaignId}`);
  }
  if (adSetId) {
    keys.push(`metaAdSetAds:${userId}:${adSetId}`);
  }
  // Resolve any wildcards via SCAN, exact keys via direct DEL.
  const concrete = [];
  for (const pattern of keys) {
    if (pattern.includes("*")) {
      const stream = redisClient.scanStream({ match: pattern, count: 100 });
      for await (const batch of stream) {
        if (batch.length) concrete.push(...batch);
      }
    } else {
      concrete.push(pattern);
    }
  }
  if (concrete.length) await redisClient.del(...concrete).catch(() => {});
}

// Reverse-geocode lat/lng → { displayName, countryCode, regionId, primaryCity }.
// Extracted as a standalone helper (not a class method) so it's reusable
// from both the `reverseGeocodeLocation` HTTP endpoint AND
// metaAdLauncherV2's launch-time `backfillLocationCountryCodes` — a
// `custom` (map-pin) location Meta reads back on edit NEVER carries a
// country code (Meta's targeting.geo_locations.custom_locations only has
// lat/lng/radius), so the edit-save path needs the same lookup the
// picker uses when the pin is first dropped.
//
// Tries Meta's OWN reverse-geocode FIRST (added 2026-07-06, captured live
// from Meta Ads Manager's network traffic: dropping a map pin calls
// `GET /search?type=adgeolocationmeta&custom_locations=["(lat, lng)"]` —
// the SAME generic `/search` node as `adgeolocation`/the place-coordinate
// resolve flow, just a different bucket keyed by the raw coordinate string
// instead of an id). This returns `region_id` directly for a bare
// coordinate pair — closing a gap previously written off as unfixable
// (see the removed "known residual gap" note in backfillLocationCountryCodes
// — Nominatim structurally can't know Meta's region-id ontology; Meta's own
// endpoint doesn't have that limitation). Falls back to Nominatim only when
// Meta's call fails or has no hit (e.g. the account's Meta API access has
// an issue) — Nominatim is the ONLY source for a friendly place name in
// that fallback case, since Meta's own `name`/`address_string` for a custom
// location is just the coordinate pair re-stringified, not an address.
//
// `api` is optional — pass Meta's default API instance when the caller
// already has one initialized (both current callers do). Best-effort:
// returns null on total failure (ocean, both services down, bad input) —
// callers should treat that as "couldn't determine, leave as-is."
async function reverseGeocodeLatLng(lat, lng, api) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  if (api) {
    try {
      const { parseCustomLocationHit } = require("../../utils/targetingGeo");
      const key = `(${lat}, ${lng})`;
      const raw = await api.call("GET", ["search"], {
        type: "adgeolocationmeta",
        custom_locations: JSON.stringify([key]),
        include_headers: false,
      });
      const data = raw?.data || raw?._data?.data || raw?._data || raw;
      const hit = data?.custom_locations?.[key];
      const parsed = parseCustomLocationHit(hit);
      if (parsed?.countryCode || parsed?.regionId) return parsed;
    } catch {
      /* fall through to Nominatim below */
    }
  }

  try {
    const { data } = await axios.get(
      "https://nominatim.openstreetmap.org/reverse",
      {
        params: { lat, lon: lng, format: "jsonv2", zoom: 10, addressdetails: 1 },
        headers: {
          "User-Agent": "AdsGPT/1.0 (Meta Ads location targeting)",
          "Accept-Language": "en",
        },
        timeout: 8000,
      },
    );
    if (!data || data.error || !data.display_name) return null;
    return {
      displayName: data.display_name,
      countryCode: (data.address?.country_code || "").toUpperCase() || null,
      regionId: null,
      primaryCity: null,
    };
  } catch {
    return null; // fail open — caller treats as "couldn't determine"
  }
}

// Pick the store URL for one platform out of Meta's `object_store_urls`
// field on an Application node. Field names have varied across API
// versions/app configs — seen in the wild: `{itunes: "..."}`,
// `{ios_app_store: "..."}`, `{apple_app_store: "..."}` for iOS, and
// `{google_play: "..."}` / `{android: "..."}` for Android. Extracted
// (2026-07-07) from `getPromotableApps`'s inline normaliser so
// `resolveCellForAdSet` can reuse the SAME field-name fallback logic when
// re-deriving a fresh objectStoreUrl for the Add-Ad flow — see that
// function's docblock for why trusting the ad set's stored
// promoted_object.object_store_url isn't safe on its own.
function pickAppStoreUrl(objectStoreUrls, platform) {
  const osu = objectStoreUrls || {};
  if (platform === "ios") {
    return osu.itunes || osu.ios_app_store || osu.apple_app_store || null;
  }
  if (platform === "android") {
    return osu.google_play || osu.android || null;
  }
  return null;
}

class MetaAdLauncher {
  constructor() {
    this.getAdAccountsList = this.getAdAccountsList.bind(this);
    this.getCapaignsByAdAccount = this.getCapaignsByAdAccount.bind(this);
    this.getAdSetsByCampaignId = this.getAdSetsByCampaignId.bind(this);
    this.getAdsByCampaignId = this.getAdsByCampaignId.bind(this);
    this.getAdsByAdSetId = this.getAdsByAdSetId.bind(this);
    this.getInsights = this.getInsights.bind(this);
    this.updateStatus = this.updateStatus.bind(this);
    this.runAudit = this.runAudit.bind(this);
    this.getDashboardData = this.getDashboardData.bind(this);
    this.getAnalyticsData = this.getAnalyticsData.bind(this);
    this.getPages = this.getPages.bind(this);
    this.getSavedAudiences = this.getSavedAudiences.bind(this);
    this.searchGeoLocations = this.searchGeoLocations.bind(this);
    this.geocodeLocation = this.geocodeLocation.bind(this);
    this.createCampaign = this.createCampaign.bind(this);
    this.createAdSet = this.createAdSet.bind(this);
    this.uploadAdImage = this.uploadAdImage.bind(this);
    this.uploadAdVideo = this.uploadAdVideo.bind(this);
    this.createAd = this.createAd.bind(this);
    this.deleteCampaign = this.deleteCampaign.bind(this);
  }

  // * GET analytics data (stats with comparison and chart)
  async getAnalyticsData(req, res) {
    /* #swagger.tags = ['Meta Ads Launcher']
       #swagger.description = 'Get detailed analytics statistics with period comparison and performance velocity'
       #swagger.parameters['adAccountId'] = { description: 'Ad Account ID', type: 'string', required: true }
       #swagger.parameters['datePreset'] = { description: 'Date preset for insights', type: 'string', default: 'last_30d' }
    */
    try {
      const { adAccountId, datePreset = "last_30d" } = req.query;
      if (!adAccountId)
        return res.status(400).json({ error: "Account ID is required" });

      const userId = req.user.user_id;

      // ---------- REDIS CACHE KEY ----------
      const cacheKey = `metaAnalytics:${userId}:${adAccountId}:${datePreset}`;

      const cached = await redisClient.get(cacheKey);

      if (cached) {
        return res.status(200).json(JSON.parse(cached));
      }
      // -------------------------------------

      const fbUser = await FBUsers.findOne({ userId });
      if (!fbUser)
        return res.status(404).json({ error: "Facebook user not found" });
      const accessToken = decrypt(fbUser?.accessToken);

      const api = bizSdk.FacebookAdsApi.init(accessToken);
      bizSdk.FacebookAdsApi.setDefaultApi(api);

      const account = new AdAccount(`act_${adAccountId}`);

      // Calculate previous period preset mapping
      const prevPresets = {
        today: "yesterday",
        yesterday: "last_7d", // not perfect but okay for proxy
        last_7d: "last_7d", // will use time_range for proper prev
        last_30d: "last_30d",
        this_month: "last_month",
        last_month: "last_month",
      };

      // For more accurate comparison, we should use time_range
      // But date_preset is easier for now as a first pass.
      // Let's implement a helper for time ranges if we want precision.

      const fields = getInsightsFields();
      const [current, previous, daily] = await Promise.all([
        account.getInsights(fields, { date_preset: datePreset }),
        account.getInsights(fields, {
          date_preset: prevPresets[datePreset] || "last_30d",
        }), // Simple proxy
        account.getInsights(["spend", "clicks", "date_start"], {
          date_preset: datePreset,
          time_increment: 1,
        }),
      ]);

      const curr = current[0]?._data || {};
      const prev = previous[0]?._data || {};

      const calculateChange = (c, p) => {
        if (!p || p === 0) return 0;
        return (((c - p) / p) * 100).toFixed(1);
      };

      const stats = {
        spend: {
          val: parseFloat(curr.spend || 0),
          change: calculateChange(
            parseFloat(curr.spend || 0),
            parseFloat(prev.spend || 0),
          ),
        },
        impressions: {
          val: parseInt(curr.impressions || 0),
          change: calculateChange(
            parseInt(curr.impressions || 0),
            parseInt(prev.impressions || 0),
          ),
        },
        clicks: {
          val: parseInt(curr.clicks || 0),
          change: calculateChange(
            parseInt(curr.clicks || 0),
            parseInt(prev.clicks || 0),
          ),
        },
        ctr: {
          val: parseFloat(curr.ctr || 0),
          change: calculateChange(
            parseFloat(curr.ctr || 0),
            parseFloat(prev.ctr || 0),
          ),
        },
        cpc: {
          val: parseFloat(curr.cpc || 0),
          change: calculateChange(
            parseFloat(curr.cpc || 0),
            parseFloat(prev.cpc || 0),
          ),
        },
        cpm: {
          val: parseFloat(curr.cpm || 0),
          change: calculateChange(
            parseFloat(curr.cpm || 0),
            parseFloat(prev.cpm || 0),
          ),
        },
        reach: {
          val: parseInt(curr.reach || 0),
          change: calculateChange(
            parseInt(curr.reach || 0),
            parseInt(prev.reach || 0),
          ),
        },
        frequency: {
          val: parseFloat(curr.frequency || 0),
          change: calculateChange(
            parseFloat(curr.frequency || 0),
            parseFloat(prev.frequency || 0),
          ),
        },
      };

      const chartData = daily.map((d) => ({
        name: dayjs(d.date_start).format("DD MMM"),
        spend: parseFloat(d.spend || 0),
        clicks: parseInt(d.clicks || 0),
      }));

      // Conversion funnel (actions)
      const actions = curr.actions || [];

      const response = {
        status: true,
        stats,
        chartData,
        actions,
      };

      // ---------- STORE IN REDIS ----------
      await redisClient.set(
        cacheKey,
        JSON.stringify(response),
        "EX",
        VOLATILE_TTL,
      );
      // -----------------------------------

      return res.status(200).json(response);
    } catch (error) {
      logger.error(`Analytics data error: ${error.message}`);
      return res.status(500).json({
        status: false,
        error: "Failed to fetch analytics data",
        details: error.message,
      });
    }
  }

  // * 0. GET dashboard data (stats and chart)
  async getDashboardData(req, res) {
    /* #swagger.tags = ['Meta Ads Launcher']
     #swagger.description = 'Get dashboard overview statistics and performance chart data'
  */

    try {
      const { adAccountId, datePreset = "last_7d" } = req.query;
      const userId = req.user.user_id;

      // -------- REDIS CACHE --------
      const cacheKey = `metaDashboard:${userId}:${adAccountId || "all"}:${datePreset}`;

      const cached = await redisClient.get(cacheKey);

      if (cached) {
        return res.status(200).json(JSON.parse(cached));
      }
      // -----------------------------

      const fbUser = await FBUsers.findOne({ userId });

      if (!fbUser)
        return res.status(404).json({ error: "Facebook user not found" });

      const accessToken = decrypt(fbUser?.accessToken);

      if (!accessToken)
        return res.status(401).json({ error: "Access token is required" });

      const api = bizSdk.FacebookAdsApi.init(accessToken);
      bizSdk.FacebookAdsApi.setDefaultApi(api);

      let accountsToFetch = [];

      if (adAccountId) {
        accountsToFetch = [adAccountId];
      } else {
        const user = new bizSdk.User("me");
        const adAccounts = await user.getAdAccounts(["id"]);
        accountsToFetch = adAccounts.map((a) => a.id.replace("act_", ""));
      }

      const targetAccounts = adAccountId
        ? accountsToFetch
        : accountsToFetch.slice(0, 5);

      const results = await Promise.all(
        targetAccounts.map(async (id) => {
          try {
            const account = new AdAccount(`act_${id}`);

            const [summary, daily, campaigns] = await Promise.all([
              account.getInsights(["spend", "actions"], {
                date_preset: datePreset,
              }),
              account.getInsights(["spend", "actions", "date_start"], {
                date_preset: datePreset,
                time_increment: 1,
              }),
              // Paginated — agencies with >100 campaigns previously got an
              // undercount on the dashboard tile.
              fetchAllPaged(
                account.getCampaigns(["id", "status"], { limit: 100 }),
                `campaigns (dashboard, ${id})`,
              ),
            ]);

            return { summary, daily, campaigns };
          } catch (err) {
            logger.error(`Error fetching account ${id}: ${err.message}`);
            return null;
          }
        }),
      );

      let totalSpend = 0;
      let totalConversions = 0;
      let activeCampaignsCount = 0;

      const dailyMap = {};

      results.forEach((res) => {
        if (!res) return;

        if (res.summary && res.summary[0]) {
          const data = res.summary[0]._data;

          totalSpend += parseFloat(data.spend || 0);

          const purchaseAction = data.actions?.find(
            (a) =>
              a.action_type === "purchase" ||
              a.action_type === "offsite_conversion.fb_pixel_purchase",
          );

          totalConversions += parseFloat(purchaseAction?.value || 0);
        }

        res.campaigns.forEach((c) => {
          if (c.status === "ACTIVE") activeCampaignsCount++;
        });

        res.daily.forEach((d) => {
          const data = d._data;
          const date = data.date_start;

          const purchaseAction = data.actions?.find(
            (a) =>
              a.action_type === "purchase" ||
              a.action_type === "offsite_conversion.fb_pixel_purchase",
          );

          if (!dailyMap[date]) {
            dailyMap[date] = { spend: 0, conversions: 0 };
          }

          dailyMap[date].spend += parseFloat(data.spend || 0);
          dailyMap[date].conversions += parseFloat(purchaseAction?.value || 0);
        });
      });

      const avgCpa = totalConversions > 0 ? totalSpend / totalConversions : 0;

      const chartData = Object.keys(dailyMap)
        .sort()
        .map((date) => ({
          name: dayjs(date).format("DD MMM"),
          fullDate: date,
          spend: parseFloat(dailyMap[date].spend.toFixed(2)),
          conversions: parseInt(dailyMap[date].conversions),
          cpa:
            dailyMap[date].conversions > 0
              ? parseFloat(
                  (dailyMap[date].spend / dailyMap[date].conversions).toFixed(
                    2,
                  ),
                )
              : 0,
        }));

      const response = {
        status: true,
        stats: {
          totalSpend: Math.round(totalSpend),
          totalConversions: Math.round(totalConversions),
          avgCpa: parseFloat(avgCpa.toFixed(2)),
          activeCampaigns: activeCampaignsCount,
        },
        chartData,
      };

      // -------- STORE IN REDIS --------
      await redisClient.set(
        cacheKey,
        JSON.stringify(response),
        "EX",
        VOLATILE_TTL,
      );
      // --------------------------------

      return res.status(200).json(response);
    } catch (error) {
      logger.error(`Dashboard data error: ${error.message}`);

      return res.status(500).json({
        status: false,
        error: "Failed to fetch dashboard data",
        details: error.message,
      });
    }
  }

  // * 1. GET all ad accounts list
  async getAdAccountsList(req, res) {
    /* #swagger.tags = ['Meta Ads Launcher']
     #swagger.description = 'Get all Meta ad accounts list for the authenticated user'
  */
    try {
      const userId = req.user.user_id;

      if (!userId)
        return res.status(400).json({ error: "User ID is required" });

      // ---------- REDIS CACHE ----------
      const cacheKey = `metaAdAccounts:${userId}`;
      const refresh = String(req.query.refresh || "").toLowerCase() === "true";

      if (!refresh) {
        const cached = await redisClient.get(cacheKey);
        if (cached) {
          return res.status(200).json(JSON.parse(cached));
        }
      } else {
        // Force-refresh: drop the cached entry so the rest of this handler
        // re-populates it from Meta.
        await redisClient.del(cacheKey).catch(() => {});
      }
      // --------------------------------

      const fbUser = await FBUsers.findOne({ userId });

      if (!fbUser)
        return res.status(404).json({ error: "Facebook user not found" });

      const accessToken = decrypt(fbUser?.accessToken);

      if (!accessToken)
        return res.status(401).json({ error: "Access token is required" });

      const api = bizSdk.FacebookAdsApi.init(accessToken);
      bizSdk.FacebookAdsApi.setDefaultApi(api);

      const user = new bizSdk.User("me");

      const FIELDS = [
        "id",
        "name",
        "account_status",
        "currency",
        "timezone_name",
        "amount_spent",
        // Meta's per-currency floors (minor currency units). The V2 wizard
        // validates the campaign spending limit + budgets against these
        // before launch — e.g. an INR account's campaign spend-cap
        // minimum is ₹5,000 (= 500000 paise).
        "min_campaign_group_spend_cap",
        "min_daily_budget",
      ];
      // Page size 100 (Meta's max for /me/adaccounts) so the typical agency
      // portfolio fits in one call. Then walk pagination via the SDK cursor
      // so an agency with >100 accounts still gets every account back.
      // Safety cap of 50 pages (= 5000 accounts) so a malformed cursor
      // can't loop forever.
      let cursor = await user.getAdAccounts(FIELDS, { limit: 100 });
      const adAccounts = [...cursor];
      let pages = 1;
      while (
        typeof cursor?.hasNext === "function" &&
        cursor.hasNext() &&
        pages < 50
      ) {
        cursor = await cursor.next();
        adAccounts.push(...cursor);
        pages += 1;
      }
      logger.info(
        `getAdAccountsList: fetched ${adAccounts.length} ad accounts across ${pages} page(s)`,
      );

      const formattedAccounts = adAccounts.map((account) => ({
        id: account.id.replace("act_", ""),
        name: account.name,
        status: account.account_status,
        currency: account.currency,
        timezone: account.timezone_name,
        amountSpent: formatBudget(account.amount_spent, account.currency),
        // Raw minor-unit minimums — the frontend converts to major units
        // for display + validation. 0 when Meta doesn't report a floor.
        minCampaignSpendCap: Number(account.min_campaign_group_spend_cap) || 0,
        minDailyBudget: Number(account.min_daily_budget) || 0,
      }));

      const response = {
        status: true,
        adAccounts: formattedAccounts,
        count: formattedAccounts.length,
      };

      // ---------- STORE IN REDIS ----------
      await redisClient.set(
        cacheKey,
        JSON.stringify(response),
        "EX",
        REDIS_TTL,
      );
      // -----------------------------------

      return res.status(200).json(response);
    } catch (error) {
      logger.error(
        `Get ad accounts error: ${error.response?.data || error.message}`,
      );

      return res.status(500).json({
        status: false,
        error: "Failed to fetch ad accounts",
        details: error.response?.data?.error?.message || error.message,
      });
    }
  }

  // * 2. GET campaigns list by ad account
  async getCapaignsByAdAccount(req, res) {
    /* #swagger.tags = ['Meta Ads Launcher']
     #swagger.description = 'Get campaigns list for a specific Meta ad account'
     #swagger.parameters['adAccountId'] = { description: 'Meta Ad Account ID', type: 'string' }
  */

    try {
      const { adAccountId } = req.query;

      if (!adAccountId)
        return res.status(400).json({ error: "Account ID is required" });

      const userId = req.user.user_id;

      // -------- REDIS CACHE --------
      const cacheKey = `metaCampaigns:${userId}:${adAccountId}`;

      const cached = await redisClient.get(cacheKey);

      if (cached) {
        return res.status(200).json(JSON.parse(cached));
      }
      // -----------------------------

      const fbUser = await FBUsers.findOne({ userId });

      if (!fbUser)
        return res.status(404).json({ error: "Facebook user not found" });

      const accessToken = decrypt(fbUser?.accessToken);

      if (!accessToken)
        return res.status(400).json({ error: "Access Token are required" });

      const api = bizSdk.FacebookAdsApi.init(accessToken);
      bizSdk.FacebookAdsApi.setDefaultApi(api);

      const account = new AdAccount(`act_${adAccountId}`);

      const accountInfo = await account.read(["currency"]);
      const currency = accountInfo.currency;

      const campaigns = await fetchAllPaged(
        account.getCampaigns(getCampaignFields(), { limit: 100 }),
        "campaigns",
      );

      const formattedCampaigns = campaigns.map((campaign) => ({
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        objective: campaign.objective,
        daily_budget: formatBudget(campaign.daily_budget, currency),
        lifetime_budget: formatBudget(campaign.lifetime_budget, currency),
        budget_remaining: formatBudget(campaign.budget_remaining, currency),
        start_time: campaign.start_time,
        stop_time: campaign.stop_time,
        // For the management "Add Ad Set" flow (see getCampaignFields).
        bid_strategy: campaign.bid_strategy || null,
        special_ad_categories: campaign.special_ad_categories || [],
      }));

      const response = {
        status: true,
        campaigns: formattedCampaigns,
        count: formattedCampaigns.length,
      };

      // -------- STORE IN REDIS --------
      await redisClient.set(
        cacheKey,
        JSON.stringify(response),
        "EX",
        REDIS_TTL,
      );
      // --------------------------------

      return res.status(200).json(response);
    } catch (error) {
      logger.error(`Get campaigns error: ${error.message}`);

      return res.status(500).json({
        status: false,
        error: "Failed to fetch campaigns",
        details: error.message,
      });
    }
  }

  // * 3. GET ad sets list by campaign ID
  async getAdSetsByCampaignId(req, res) {
    /* #swagger.tags = ['Meta Ads Launcher']
     #swagger.description = 'Get ad sets list for a specific campaign ID or entire ad account'
  */

    try {
      const { campaignId, adAccountId } = req.query;

      if (!adAccountId || !campaignId) {
        return res
          .status(400)
          .json({ error: "Ad Account ID and Campaign ID are required" });
      }

      const userId = req.user.user_id;

      // ---------- REDIS CACHE ----------
      const cacheKey = `metaAdsets:${userId}:${adAccountId}:${campaignId || "all"}`;

      const cached = await redisClient.get(cacheKey);

      if (cached) {
        return res.status(200).json(JSON.parse(cached));
      }
      // --------------------------------

      const fbUser = await FBUsers.findOne({ userId });

      if (!fbUser) {
        return res.status(404).json({ error: "Facebook user not found" });
      }

      const accessToken = decrypt(fbUser?.accessToken);

      const api = bizSdk.FacebookAdsApi.init(accessToken);
      bizSdk.FacebookAdsApi.setDefaultApi(api);

      const account = new AdAccount(`act_${adAccountId}`);

      const accountInfo = await account.read(["currency"]);
      const currency = accountInfo.currency;

      let adSets;

      if (campaignId) {
        const campaign = new Campaign(campaignId);
        adSets = await fetchAllPaged(
          campaign.getAdSets(getAdSetFields(), { limit: 100 }),
          "ad sets (by campaign)",
        );
      } else {
        adSets = await fetchAllPaged(
          account.getAdSets(getAdSetFields(), { limit: 100 }),
          "ad sets (account-wide)",
        );
      }

      const formattedAdSets = adSets.map((adSet) => ({
        id: adSet.id,
        name: adSet.name,
        status: adSet.status,
        daily_budget: formatBudget(adSet?.daily_budget, currency),
        lifetime_budget: formatBudget(adSet.lifetime_budget, currency),
        budget_remaining: formatBudget(adSet.budget_remaining, currency),
        start_time: adSet.start_time,
        end_time: adSet.end_time,
        billing_event: adSet.billing_event,
        optimization_goal: adSet.optimization_goal,
      }));

      const response = {
        status: true,
        adSets: formattedAdSets,
        count: formattedAdSets.length,
      };

      // ---------- STORE CACHE ----------
      await redisClient.set(
        cacheKey,
        JSON.stringify(response),
        "EX",
        REDIS_TTL,
      );
      // --------------------------------

      return res.status(200).json(response);
    } catch (error) {
      logger.error(`Get ad sets error: ${error.message}`);

      return res.status(500).json({
        status: false,
        error: "Failed to fetch ad sets",
        details: error.message,
      });
    }
  }

  // * 4. GET ads list by campaign ID
  async getAdsByCampaignId(req, res) {
    /* #swagger.tags = ['Meta Ads Launcher']
     #swagger.description = 'Get ads list for a specific campaign ID or entire ad account'
     #swagger.parameters['campaignId'] = { description: 'Campaign ID (Optional)', type: 'string' }
     #swagger.parameters['adAccountId'] = { description: 'Ad Account ID (Required if no campaignId)', type: 'string' }
  */

    try {
      const { campaignId } = req.query;
      const userId = req.user.user_id;

      if (!campaignId) {
        return res.status(400).json({ error: "Campaign ID is required" });
      }

      // ---------- REDIS CACHE ----------
      const cacheKey = `metaCampaignAds:${userId}:${campaignId}`;

      const cached = await redisClient.get(cacheKey);

      if (cached) {
        return res.status(200).json(JSON.parse(cached));
      }
      // --------------------------------

      const fbUser = await FBUsers.findOne({ userId });

      if (!fbUser) {
        return res.status(404).json({ error: "Facebook user not found" });
      }

      const accessToken = decrypt(fbUser?.accessToken);

      const api = bizSdk.FacebookAdsApi.init(accessToken);
      bizSdk.FacebookAdsApi.setDefaultApi(api);

      const campaign = new Campaign(campaignId);
      const ads = await fetchAllPaged(
        campaign.getAds(getAdFields(), { limit: 100 }),
        "ads (by campaign)",
      );

      const formattedAds = ads.map((ad) => ad?._data);

      const response = {
        status: true,
        ads: formattedAds,
        count: formattedAds.length,
      };

      // ---------- STORE CACHE ----------
      await redisClient.set(
        cacheKey,
        JSON.stringify(response),
        "EX",
        REDIS_TTL,
      );
      // --------------------------------

      return res.status(200).json(response);
    } catch (error) {
      logger.error(`Get ads error: ${error.message}`);

      return res.status(500).json({
        status: false,
        error: "Failed to fetch ads",
        details: error.message,
      });
    }
  }

  // * 5. GET ads list by ad set ID
  async getAdsByAdSetId(req, res) {
    /* #swagger.tags = ['Meta Ads Launcher']
     #swagger.description = 'Get ads list for a specific ad set ID'
     #swagger.parameters['adSetId'] = { description: 'Ad Set ID', type: 'string' }
  */

    try {
      const { adSetId } = req.query;
      const userId = req.user.user_id;

      if (!adSetId) {
        return res.status(400).json({ error: "Ad Set ID is required" });
      }

      // -------- REDIS CACHE --------
      const cacheKey = `metaAdSetAds:${userId}:${adSetId}`;

      const cached = await redisClient.get(cacheKey);
      if (cached) {
        return res.status(200).json(JSON.parse(cached));
      }
      // -----------------------------

      const fbUser = await FBUsers.findOne({ userId });

      if (!fbUser) {
        return res.status(404).json({ error: "Facebook user not found" });
      }

      const accessToken = decrypt(fbUser?.accessToken);

      const api = bizSdk.FacebookAdsApi.init(accessToken);
      bizSdk.FacebookAdsApi.setDefaultApi(api);

      const adSet = new AdSet(adSetId);
      const ads = await fetchAllPaged(
        adSet.getAds(getAdFields(), { limit: 100 }),
        "ads (by ad set)",
      );

      const formattedAds = ads.map((ad) => ad?._data);

      const response = {
        status: true,
        ads: formattedAds,
        count: formattedAds.length,
      };

      // -------- STORE CACHE --------
      await redisClient.set(
        cacheKey,
        JSON.stringify(response),
        "EX",
        REDIS_TTL,
      );
      // -----------------------------

      return res.json(response);
    } catch (error) {
      console.log(error);
      logger.error(`Get ads by ad set error: ${error.message}`);

      res.status(500).json({
        status: false,
        error: "Failed to fetch ads",
        details: error.message,
      });
    }
  }

  // * 6. GET ad insights by ad ID/campaign ID/ad set ID
  async getInsights(req, res) {
    /* #swagger.tags = ['Meta Ads Launcher']
       #swagger.description = 'Get ad insights (performance data) by account, campaign, ad set or ad ID'
       #swagger.parameters['adAccountId'] = { description: 'Ad Account ID', type: 'string' }
       #swagger.parameters['datePreset'] = {
        in: 'query',
        description: 'Date preset for insights',
        type: 'string',
        schema: {
            "@enum": [
                "today",
                "yesterday",
                "last_3d",
                "last_7d",
                "last_14d",
                "last_28d",
                "last_30d",
                "last_90d",
                "this_month",
                "last_month",
                "this_quarter",
                "last_quarter",
                "this_year",
                "last_year",
                "lifetime",
                "maximum"
              ]
          }
        }
        #swagger.parameters['level'] = {
          in: 'query',
          description: 'Level of aggregation for insights data',
          type: 'string',
          schema: {
              "@enum": ["account", "campaign", "adset", "ad"]
            }
        }
       #swagger.parameters['adId'] = { description: 'Filter by Ad ID', type: 'string' }
       #swagger.parameters['campaignId'] = { description: 'Filter by Campaign ID', type: 'string' }
       #swagger.parameters['adsetId'] = { description: 'Filter by Ad Set ID', type: 'string' }
       
    */
    try {
      const { adAccountId, datePreset, adId, campaignId, adsetId, level } =
        req.query;

      const fbUser = await FBUsers.findOne({ userId: req.user.user_id });
      if (!fbUser)
        return res.status(404).json({ error: "Facebook user not found" });

      const accessToken = decrypt(fbUser?.accessToken);

      if (!adAccountId || !accessToken)
        return res.status(400).json({
          error: "Ad Account ID and Access Token are required",
        });

      const cacheKey = `metaInsights:${userId}:${adAccountId}:${datePreset || "last_30d"}:${level || "account"}:${campaignId || "none"}:${adsetId || "none"}:${adId || "none"}`;

      // ---------- CACHE CHECK ----------
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        return res.status(200).json(JSON.parse(cached));
      }
      // ---------------------------------

      const api = bizSdk.FacebookAdsApi.init(accessToken);
      bizSdk.FacebookAdsApi.setDefaultApi(api);

      const account = new AdAccount(`act_${adAccountId}`);

      const fields = getInsightsFields();

      const filters = [];

      if (campaignId) {
        filters.push({
          field: "campaign.id",
          operator: "EQUAL",
          value: campaignId,
        });
      }

      if (adsetId) {
        filters.push({
          field: "adset.id",
          operator: "EQUAL",
          value: adsetId,
        });
      }

      if (adId) {
        filters.push({
          field: "ad.id",
          operator: "EQUAL",
          value: adId,
        });
      }

      const params = {
        level: level || "account",
        date_preset: datePreset || "last_30d",
        ...(filters.length > 0 && { filtering: filters }),
      };

      const insights = await account.getInsights(fields, params);

      const formattedInsights = insights.map((insight) => insight?._data);

      const response = {
        status: true,
        level: params.level,
        insights: formattedInsights,
      };

      // ---------- STORE CACHE ----------
      await redisClient.set(
        cacheKey,
        JSON.stringify(response),
        "EX",
        VOLATILE_TTL,
      );
      // --------------------------------

      return res.status(200).json(response);
    } catch (error) {
      logger.error(`Get insights error: ${error.message}`);

      return res.status(500).json({
        status: false,
        error: "Failed to fetch insights",
        details: error.message,
      });
    }
  }

  // * 7. Update ad/campaign/ad set status (active, paused)
  async updateStatus(req, res) {
    try {
      const { error, value } = updateAdStatusSchema.validate(req.body);

      if (error) {
        return res.status(400).json({
          status: false,
          error: error.details[0].message,
        });
      }

      const { level, id, status } = value;

      const fbUser = await FBUsers.findOne({ userId: req.user.user_id });
      if (!fbUser)
        return res.status(404).json({ error: "Facebook user not found" });

      const accessToken = decrypt(fbUser?.accessToken);

      const api = bizSdk.FacebookAdsApi.init(accessToken);
      bizSdk.FacebookAdsApi.setDefaultApi(api);

      let object;
      let StatusField;

      if (level === "campaign") {
        object = new bizSdk.Campaign(id);
        StatusField = bizSdk.Campaign.Fields; // ✅ use SDK field constants
      } else if (level === "adset") {
        object = new bizSdk.AdSet(id);
        StatusField = bizSdk.AdSet.Fields;
      } else if (level === "ad") {
        object = new bizSdk.Ad(id);
        StatusField = bizSdk.Ad.Fields;
      } else {
        return res.status(400).json({
          error: "Invalid level. Must be campaign, adset, or ad",
        });
      }

      await object.update([StatusField.status], {
        [StatusField.status]: status,
      });

      // Invalidate cached GET responses that embed status, so the next
      // read reflects the change instead of the 2h-TTL stale payload.
      await invalidateUserMetaCache(req.user.user_id);

      return res.status(200).json({
        status: true,
        message: `${level} ${status.toLowerCase()} successfully`,
      });
    } catch (error) {
      logger.error(`Update status error: ${error.message}`);

      return res.status(500).json({
        status: false,
        error: "Failed to update status",
        details: error.message,
      });
    }
  }

  // * 7c. GET promotable apps the user can run App Promotion campaigns for.
  // Feeds the V2 wizard's App Promotion app picker (AdSet step). The
  // returned shape carries enough metadata for the frontend to filter by
  // mobile_app_store and pre-fill object_store_url without a second
  // round-trip.
  //
  // Falls back gracefully when Meta's response uses a different
  // object_store_urls field name across API versions — we surface
  // whatever URL strings come back and let the caller pick the right
  // one. Apps lacking a usable store URL are still returned (id + name)
  // so the picker can still show them with a "URL missing" warning.
  async getPromotableApps(req, res) {
    /* #swagger.tags = ['Meta Ads Launcher']
       #swagger.description = 'List apps the user can run App Promotion campaigns for'
    */
    try {
      const userId = req.user.user_id;
      const { adAccountId } = req.query;
      await initApiForUser(userId);

      // App discovery in Meta v24 — scoped strictly to the selected ad
      // account via `act_<id>/applications`. This matches what Meta's own
      // Ads Manager shows: only apps that have been assigned to THIS ad
      // account are promotable from it. Walking businesses the user belongs
      // to was rejected (pollutes the picker with unrelated apps; users
      // expect apps tied to where the campaign will run).
      //
      // Dead paths we've ruled out: `/me/promotable_apps` (Unknown path),
      // `/me/applications` (nonexisting field), and the ad-account edges
      // `promotable_apps`, `advertisable_apps`,
      // `connected_third_party_app_subjects`, `promoted_objects` (all
      // "Unknown path components" in v24).
      if (!adAccountId) {
        return res.status(400).json({
          status: false,
          error: "adAccountId is required",
        });
      }

      const api = bizSdk.FacebookAdsApi.getDefaultApi();
      const APP_FIELDS = "id,name,category,object_store_urls,link,supported_platforms";
      let rawApps = [];
      try {
        const result = await api.call(
          "GET",
          [`act_${adAccountId}`, "applications"],
          { fields: APP_FIELDS, limit: 100 },
        );
        rawApps = result?.data || result?._data?.data || [];
        logger.info(
          `getPromotableApps: act_${adAccountId}/applications → ${rawApps.length} apps`,
        );
      } catch (e) {
        logger.warn(
          `getPromotableApps: act_${adAccountId}/applications failed: ${e.message}`,
        );
      }

      // Normalise into a shape the frontend can consume directly.
      // Drop apps that don't have ANY store URL — those are Instant Games,
      // fb_canvas, or web-only apps that can't run App Promotion campaigns.
      // The frontend filters further by selected store; this just removes
      // the noise so the picker only ever shows mobile apps.
      const normalised = rawApps
        .map((a) => ({
          id: a.id,
          name: a.name,
          category: a.category || null,
          supportedPlatforms: a.supported_platforms || [],
          appleAppStoreUrl: pickAppStoreUrl(a.object_store_urls, "ios"),
          googlePlayUrl: pickAppStoreUrl(a.object_store_urls, "android"),
        }))
        .filter((a) => a.appleAppStoreUrl || a.googlePlayUrl);

      logger.info(
        `getPromotableApps: ${rawApps.length} raw → ${normalised.length} mobile apps after filter`,
      );

      return res.status(200).json({
        status: true,
        apps: normalised,
      });
    } catch (error) {
      const m = logMetaError("getPromotableApps error", error);
      return res.status(500).json({
        status: false,
        error: m.title || "Failed to load apps",
        details: m.message,
        meta: {
          code: m.code,
          subcode: m.subcode,
          fbtraceId: m.fbtraceId,
        },
      });
    }
  }

  // * 7e2. GET Meta Product Catalogs the ad account can advertise from.
  // Powers the Catalog picker in the V2 wizard's Sales/CATALOG cell
  // (Dynamic Product Ads). Catalogs are owned by a Business Manager and
  // shared with ad accounts via "owned_product_catalogs" + assigned via
  // "client_product_catalogs". We surface both — the user sees every
  // catalog they can pick from, and the response is de-duped by id.
  //
  // Returns:
  //   [{ id, name, productCount }]
  async getCatalogs(req, res) {
    /* #swagger.tags = ['Meta Ads Launcher']
       #swagger.description = 'List Meta Product Catalogs accessible from an ad account'
    */
    try {
      const { adAccountId } = req.query;
      if (!adAccountId) {
        return res.status(400).json({ status: false, error: "adAccountId is required" });
      }
      const userId = req.user.user_id;
      await initApiForUser(userId);

      // 30-min cache — catalog list rarely changes vs the volatile
      // metrics on `VOLATILE_TTL`. Standard `metaCatalogs:` prefix so a
      // disconnect-from-FB clears it.
      const cacheKey = `metaCatalogs:${userId}:${adAccountId}`;
      const cached = await redisClient.get(cacheKey);
      if (cached) return res.status(200).json(JSON.parse(cached));

      const rawCatalogs = [];
      const api = bizSdk.FacebookAdsApi.getDefaultApi();

      // Track failure modes so we can avoid caching an empty result that's
      // due to a transient API/permission error — otherwise users would
      // get stuck with an empty list for 30 min after any blip.
      let businessReadFailed = false;
      let ownedReadFailed = false;
      let clientReadFailed = false;

      // Catalog edges (owned_product_catalogs / client_product_catalogs)
      // live on the Business node, NOT on AdAccount. Traverse through
      // the ad account's business in one nested field expansion.
      // Ad accounts not tied to a Business Manager (personal accounts)
      // return business = null → empty catalog list.
      let businessId = null;
      try {
        const acctRes = await api.call("GET", [`act_${adAccountId}`], {
          fields: "business",
        });
        businessId = acctRes?.business?.id
          || acctRes?._data?.business?.id
          || null;
      } catch (e) {
        businessReadFailed = true;
        logger.warn(`getCatalogs: ad account business read failed: ${e.message}`);
      }

      if (businessId) {
        try {
          const ownedRes = await api.call("GET", [businessId], {
            fields: "owned_product_catalogs{id,name,product_count}",
          });
          const owned = ownedRes?.owned_product_catalogs?.data
            || ownedRes?._data?.owned_product_catalogs?.data
            || [];
          rawCatalogs.push(...owned);
        } catch (e) {
          ownedReadFailed = true;
          logger.warn(`getCatalogs: owned_product_catalogs read failed: ${e.message}`);
        }

        // Catalogs shared TO this Business from another Business — the
        // "client" relationship. Same fields.
        try {
          const clientRes = await api.call("GET", [businessId], {
            fields: "client_product_catalogs{id,name,product_count}",
          });
          const client = clientRes?.client_product_catalogs?.data
            || clientRes?._data?.client_product_catalogs?.data
            || [];
          rawCatalogs.push(...client);
        } catch (e) {
          clientReadFailed = true;
          logger.warn(`getCatalogs: client_product_catalogs read failed: ${e.message}`);
        }
      } else if (!businessReadFailed) {
        logger.info(`getCatalogs: ad account ${adAccountId} has no business — no catalogs`);
      }

      // Dedupe by id — a catalog can appear in both lists for accounts
      // where the same Business owns + shares.
      const seen = new Set();
      const normalised = rawCatalogs
        .filter((c) => {
          if (!c?.id || seen.has(c.id)) return false;
          seen.add(c.id);
          return true;
        })
        .map((c) => ({
          id: c.id,
          name: c.name || c.id,
          productCount: Number(c.product_count) || 0,
        }));

      const response = { status: true, catalogs: normalised, count: normalised.length };

      // Skip the cache write when the empty result is the product of a
      // transient failure rather than a real "no catalogs" state. Otherwise
      // a single API hiccup would lock the user out of catalogs for 30 min.
      // Conditions to skip:
      //   - Business read threw (couldn't even look up the BM)
      //   - Business present but BOTH catalog edge calls threw
      // A legitimately empty Business (no catalogs at all) WILL still be
      // cached — that's a stable answer worth holding.
      const transientFailure =
        businessReadFailed
        || (businessId && ownedReadFailed && clientReadFailed);
      if (!transientFailure) {
        await redisClient.set(cacheKey, JSON.stringify(response), "EX", 1800);
      } else {
        logger.info(
          `getCatalogs: skipping cache write for ${adAccountId} — transient failure (business=${businessReadFailed}, owned=${ownedReadFailed}, client=${clientReadFailed})`,
        );
      }
      return res.status(200).json(response);
    } catch (error) {
      const m = logMetaError("getCatalogs error", error);
      return res.status(500).json({
        status: false,
        error: m.title || "Failed to load catalogs",
        details: m.message,
        meta: { code: m.code, subcode: m.subcode, fbtraceId: m.fbtraceId },
      });
    }
  }

  // * 7e3. GET Product Sets inside a Meta Product Catalog.
  // After the user picks a catalog, the wizard loads its product sets so
  // the Sales/CATALOG cell can scope the Dynamic Product Ad to a subset
  // of products. The default "All products" set is always present;
  // customers create additional sets via filters in Commerce Manager.
  //
  // Returns:
  //   [{ id, name, productCount }]
  async getProductSets(req, res) {
    /* #swagger.tags = ['Meta Ads Launcher']
       #swagger.description = 'List Product Sets within a Meta Product Catalog'
    */
    try {
      const { catalogId } = req.query;
      if (!catalogId) {
        return res.status(400).json({ status: false, error: "catalogId is required" });
      }
      const userId = req.user.user_id;
      await initApiForUser(userId);

      const cacheKey = `metaProductSets:${userId}:${catalogId}`;
      const cached = await redisClient.get(cacheKey);
      if (cached) return res.status(200).json(JSON.parse(cached));

      // Page size 100 + walk pagination — catalogs CAN have hundreds of
      // product sets on larger merchants. Same `fetchAllPaged` helper
      // used for campaigns/adsets.
      const catalog = new bizSdk.ProductCatalog(catalogId);
      const sets = await fetchAllPaged(
        catalog.getProductSets(["id", "name", "product_count"], { limit: 100 }),
        `product sets (catalog ${catalogId})`,
      );

      const normalised = sets.map((s) => {
        const data = s?._data || s || {};
        return {
          id: data.id,
          name: data.name || data.id,
          productCount: Number(data.product_count) || 0,
        };
      });

      const response = { status: true, productSets: normalised, count: normalised.length };
      await redisClient.set(cacheKey, JSON.stringify(response), "EX", 1800);
      return res.status(200).json(response);
    } catch (error) {
      const m = logMetaError("getProductSets error", error);
      return res.status(500).json({
        status: false,
        error: m.title || "Failed to load product sets",
        details: m.message,
        meta: { code: m.code, subcode: m.subcode, fbtraceId: m.fbtraceId },
      });
    }
  }

  // * 7e4. GET full-resolution media URLs for an ad's creative preview.
  // The Campaigns table view's Ad Preview pane needs a playable video
  // source AND a full-resolution image — neither is in the bulk
  // getAdsByAdSetId response, which returns only `creative.thumbnail_url`
  // (Meta's tiny ~128px thumbnail) and `creative.object_story_spec`
  // (which carries `video_id` but NOT a playable `video_url`).
  //
  // Resolved here on-demand when the preview pane opens:
  //   - Video ads → fetch `AdVideo(video_id).source` (the streamable MP4)
  //   - Image ads → prefer the creative's `image_url` (full-res), fall
  //     back to AdImage(image_hash).url, fall back to thumbnail_url
  //
  // Lazy by design — eager-resolving every ad in the list would add 1
  // extra Meta call per ad with video, slowing the table dramatically
  // for large ad sets.
  //
  // Returns:
  //   { kind: 'image' | 'video', imageUrl?, videoUrl?, posterUrl? }
  async getAdPreviewMedia(req, res) {
    /* #swagger.tags = ['Meta Ads Launcher']
       #swagger.description = 'Resolve full-res image / playable video URL for an ad preview'
    */
    try {
      const { adId } = req.query;
      if (!adId) {
        return res.status(400).json({ status: false, error: "adId is required" });
      }
      const userId = req.user.user_id;
      await initApiForUser(userId);

      // 30-min cache — these URLs are CDN-signed but stable for the
      // creative's lifetime. Image URLs are valid 24h+, video source URLs
      // are valid for hours. Keep TTL conservative.
      const cacheKey = `metaAdPreview:${userId}:${adId}`;
      const cached = await redisClient.get(cacheKey);
      if (cached) return res.status(200).json(JSON.parse(cached));

      const api = bizSdk.FacebookAdsApi.getDefaultApi();
      const ad = await new bizSdk.Ad(adId).get([
        "id",
        "creative{id,image_url,image_hash,video_id,thumbnail_url,object_story_spec}",
        "account_id",
      ]);
      const adData = ad?._data || ad || {};
      const creative = adData.creative?._data || adData.creative || {};
      const oss = creative.object_story_spec || {};
      const link = oss.link_data || {};
      const video = oss.video_data || {};

      const videoId = video.video_id || creative.video_id || null;
      const imageHash = link.image_hash || creative.image_hash || null;
      const isVideo = !!videoId;

      let response;
      if (isVideo) {
        // Resolve video playback URL. Meta exposes several fields on the
        // AdVideo node; we try them in preference order because:
        //   • `source` — direct MP4 URL, but Meta restricts it on many
        //     ads-uploaded videos (returns empty / requires the asset
        //     to be owned by the app uploading the read request).
        //   • `permalink_url` — link to the Facebook video page. We build
        //     a clean `plugins/video.php` embed URL from this with
        //     show_text=false so the iframe shows ONLY the player (Meta's
        //     `embed_html` field includes comments + reactions chrome,
        //     which doesn't fit our square preview).
        let videoUrl = null;
        let permalinkUrl = null;
        let embedUrl = null;
        let fullPermalink = null;
        let posterUrl = video.image_url || null;
        let width = null;
        let height = null;
        try {
          // `format` returns an array of available encodings with their
          // dimensions — we use the first to compute aspect ratio so the
          // frontend container doesn't squash 9:16 reels into 1:1 squares.
          const vid = await api.call("GET", [videoId], {
            fields: "source,picture,permalink_url,format",
          });
          const data = vid?._data || vid || {};
          videoUrl = data.source || null;
          permalinkUrl = data.permalink_url || null;
          posterUrl = data.picture || posterUrl;
          const fmt = Array.isArray(data.format) ? data.format[0] : null;
          if (fmt) {
            width = Number(fmt.width) || null;
            height = Number(fmt.height) || null;
          }
          // permalink_url comes back as a path like `/{page_id}/videos/{id}`.
          // Build the absolute URL + the embed URL. We don't pass width/
          // height to plugins/video.php — FB respects our iframe's CSS
          // size when those are omitted, which lets us drive the size
          // from the actual video dimensions on the frontend instead.
          if (permalinkUrl) {
            fullPermalink = permalinkUrl.startsWith("http")
              ? permalinkUrl
              : `https://www.facebook.com${permalinkUrl}`;
            embedUrl =
              `https://www.facebook.com/plugins/video.php`
              + `?href=${encodeURIComponent(fullPermalink)}`
              + `&show_text=false&show_captions=false&t=0`;
          }
          logger.info(
            `getAdPreviewMedia: video ${videoId} resolved — source:${!!videoUrl} embed:${!!embedUrl} dims:${width}x${height}`,
          );
        } catch (e) {
          logger.warn(
            `getAdPreviewMedia: video ${videoId} fetch failed: ${e.message}`,
          );
        }
        response = {
          status: true,
          kind: "video",
          videoUrl,
          embedUrl,
          permalinkUrl: fullPermalink,
          posterUrl,
          width,
          height,
        };
      } else {
        // Image creative. Preference order for the URL:
        //   1. creative.image_url           — full-res permalink set when
        //                                     the creative was created
        //   2. link_data.image_url          — same shape on object_story_spec
        //   3. AdImage(image_hash).url      — fallback fetch by hash
        //   4. creative.thumbnail_url       — last resort (low-res)
        let imageUrl =
          creative.image_url
          || link.image_url
          || null;
        if (!imageUrl && imageHash && adData.account_id) {
          try {
            // adimages edge — pass the hash as a JSON-encoded array per
            // Meta's field spec. Returns one entry keyed by the hash.
            const adAccountId = String(adData.account_id);
            const acct = adAccountId.startsWith("act_")
              ? adAccountId
              : `act_${adAccountId}`;
            const img = await api.call("GET", [acct, "adimages"], {
              hashes: JSON.stringify([imageHash]),
              fields: "url,permalink_url",
            });
            const arr = img?.data || img?._data?.data || [];
            imageUrl = arr[0]?.url || arr[0]?.permalink_url || null;
          } catch (e) {
            logger.warn(`getAdPreviewMedia: adimages lookup for ${imageHash} failed: ${e.message}`);
          }
        }
        imageUrl = imageUrl || creative.thumbnail_url || null;
        response = {
          status: true,
          kind: "image",
          imageUrl,
        };
      }

      // Skip the cache when we got nothing useful — usually a transient
      // permission glitch or Meta API hiccup. Caching a dead response
      // would lock the preview as broken for 30 min.
      const isEmpty =
        response.kind === "video"
          ? !response.videoUrl && !response.embedUrl && !response.permalinkUrl
          : !response.imageUrl;
      if (!isEmpty) {
        await redisClient.set(cacheKey, JSON.stringify(response), "EX", 1800);
      } else {
        logger.info(
          `getAdPreviewMedia: skipping cache for ad ${adId} — no usable URL resolved`,
        );
      }
      return res.status(200).json(response);
    } catch (error) {
      const m = logMetaError("getAdPreviewMedia error", error);
      return res.status(500).json({
        status: false,
        error: m.title || "Failed to load preview media",
        details: m.message,
        meta: { code: m.code, subcode: m.subcode, fbtraceId: m.fbtraceId },
      });
    }
  }

  // * 7f. GET Meta Pixels (datasets) installed on an ad account.
  // Powers the Pixel picker in the V2 wizard for Leads cells that use
  // `optimization_goal: OFFSITE_CONVERSIONS` (Website / Multiple-destination
  // options). Returns a list shaped for the wizard:
  //   { id, name, lastFiredTime, status }
  async getPixels(req, res) {
    /* #swagger.tags = ['Meta Ads Launcher']
       #swagger.description = 'List Meta Pixels (datasets) on an ad account'
    */
    try {
      const { adAccountId } = req.query;
      if (!adAccountId) {
        return res.status(400).json({ status: false, error: "adAccountId is required" });
      }
      const userId = req.user.user_id;
      await initApiForUser(userId);

      const account = new AdAccount(`act_${adAccountId}`);
      // Meta renamed `adspixels` → `dataset` in recent versions; both
      // edges still resolve on the same endpoint. We use the typed
      // getter when available, raw call otherwise.
      const api = bizSdk.FacebookAdsApi.getDefaultApi();
      const result = await api.call(
        "GET",
        [`act_${adAccountId}`, "adspixels"],
        {
          fields: "id,name,last_fired_time,creation_time,is_unavailable",
          limit: 50,
        },
      );
      const raw = result?.data || result?._data?.data || [];

      const pixels = raw
        .filter((p) => !p.is_unavailable) // hide deactivated pixels
        .map((p) => ({
          id: p.id,
          name: p.name || `Pixel ${p.id}`,
          lastFiredTime: p.last_fired_time || null,
          creationTime: p.creation_time || null,
        }));

      return res.status(200).json({ status: true, pixels });
    } catch (error) {
      const m = logMetaError("getPixels error", error);
      return res.status(500).json({
        status: false,
        error: m.title || "Failed to load pixels",
        details: m.message,
        meta: { code: m.code, subcode: m.subcode, fbtraceId: m.fbtraceId },
      });
    }
  }

  // * 7h. POST create a new Meta Pixel on the ad account.
  // Mirrors the "Build new form" path for Lead Forms — removes the trip
  // to Events Manager just to create the Pixel entity. The customer still
  // needs to install the JS snippet on their website for events to fire;
  // we surface that link in the response + UI.
  async createPixel(req, res) {
    /* #swagger.tags = ['Meta Ads Launcher']
       #swagger.description = 'Create a new Meta Pixel on an ad account'
    */
    try {
      const { adAccountId, name } = req.body || {};
      if (!adAccountId) {
        return res.status(400).json({ status: false, error: "adAccountId is required" });
      }
      if (!name || name.length < 2) {
        return res.status(400).json({ status: false, error: "Pixel name is required (min 2 chars)" });
      }

      const userId = req.user.user_id;
      await initApiForUser(userId);

      const api = bizSdk.FacebookAdsApi.getDefaultApi();
      const result = await api.call(
        "POST",
        [`act_${adAccountId}`, "adspixels"],
        { name },
      );
      const pixelId = result?.id || result?._data?.id;
      if (!pixelId) {
        throw new Error("Meta did not return a pixel id");
      }

      return res.status(201).json({
        status: true,
        pixel: {
          id: pixelId,
          name,
          lastFiredTime: null,
          creationTime: new Date().toISOString(),
        },
        // Direct link to install the snippet — surfaced to the user so
        // they can finish setup after launch.
        snippetSetupUrl: `https://business.facebook.com/events_manager2/list/pixel/${pixelId}/test_events`,
      });
    } catch (error) {
      const m = logMetaError("createPixel error", error);
      return res.status(500).json({
        status: false,
        error: m.title || "Failed to create pixel",
        details: m.message,
        meta: { code: m.code, subcode: m.subcode, fbtraceId: m.fbtraceId },
      });
    }
  }

  // * 7g. GET conversion events configured on a Meta Pixel.
  // Per-pixel events come from Events Manager — when the customer has set
  // up "Lead", "CompleteRegistration", "Purchase", etc. on their pixel
  // via the JS snippet, the Events API or the Conversions API. The wizard
  // surfaces these so the user picks the right event for their
  // OFFSITE_CONVERSIONS optimisation.
  async getPixelEvents(req, res) {
    /* #swagger.tags = ['Meta Ads Launcher']
       #swagger.description = 'List conversion events fired on a Pixel (Events Manager)'
    */
    try {
      const { pixelId } = req.query;
      if (!pixelId) {
        return res.status(400).json({ status: false, error: "pixelId is required" });
      }
      const userId = req.user.user_id;
      await initApiForUser(userId);

      const api = bizSdk.FacebookAdsApi.getDefaultApi();
      // Pixel stats fires events back in the format the JS snippet used —
      // typically PascalCase ("Lead", "CompleteRegistration"). But the
      // `promoted_object.custom_event_type` field on the AdSet expects
      // SCREAMING_SNAKE_CASE enum values ("LEAD", "COMPLETE_REGISTRATION").
      // Meta's API rejects PascalCase with a clear error (subcode 100,
      // listing the valid enum values). We translate every event we
      // surface to the enum format before returning to the wizard.
      const PASCAL_TO_ENUM = {
        Lead: "LEAD",
        CompleteRegistration: "COMPLETE_REGISTRATION",
        Contact: "CONTACT",
        FindLocation: "FIND_LOCATION",
        Schedule: "SCHEDULE",
        Subscribe: "SUBSCRIBE",
        SubmitApplication: "SUBMIT_APPLICATION",
        StartTrial: "START_TRIAL",
        Purchase: "PURCHASE",
        AddToCart: "ADD_TO_CART",
        AddToWishlist: "ADD_TO_WISHLIST",
        InitiateCheckout: "INITIATED_CHECKOUT",
        AddPaymentInfo: "ADD_PAYMENT_INFO",
        ViewContent: "CONTENT_VIEW",
        Search: "SEARCH",
        Donate: "DONATE",
        CustomizeProduct: "CUSTOMIZE_PRODUCT",
      };
      const normalise = (raw) => PASCAL_TO_ENUM[raw] || raw;

      let standardEvents = [];
      try {
        const result = await api.call("GET", [pixelId, "stats"], {
          aggregation: "event",
          start_time: Math.floor(Date.now() / 1000) - 30 * 24 * 3600,
          end_time: Math.floor(Date.now() / 1000),
          limit: 100,
        });
        const raw = result?.data || result?._data?.data || [];
        const seen = new Set();
        for (const row of raw) {
          const ev = normalise(row.event || row._data?.event);
          if (ev && !seen.has(ev)) {
            seen.add(ev);
            standardEvents.push({
              eventType: ev,
              lastFiredTime: row.start_time || null,
              count: row.count || null,
            });
          }
        }
      } catch (e) {
        logger.warn(`getPixelEvents stats failed: ${e.message}`);
      }

      // Fallback / supplement — the full set of Meta STANDARD conversion
      // events (custom_event_type enums). Brand-new pixels have no fired
      // events, so we surface these so the user can still pick. The wizard
      // filters this list per objective via STANDARD_EVENT_OBJECTIVE_
      // COMPATIBILITY, mirroring Meta's Events Manager objective filter.
      // NOTE: SERVICE_BOOKING_REQUEST was removed — it is NOT a Meta standard
      // event and was rejected at launch (subcode 2446814). A genuine custom
      // event by that name still surfaces via the `stats` call above.
      const STANDARD_ENUMS = [
        "PURCHASE",
        "ADD_TO_CART",
        "INITIATED_CHECKOUT",
        "ADD_PAYMENT_INFO",
        "ADD_TO_WISHLIST",
        "CONTENT_VIEW",
        "SEARCH",
        "SUBSCRIBE",
        "START_TRIAL",
        "CUSTOMIZE_PRODUCT",
        "DONATE",
        "LEAD",
        "COMPLETE_REGISTRATION",
        "CONTACT",
        "SCHEDULE",
        "SUBMIT_APPLICATION",
        "FIND_LOCATION",
      ];
      const known = new Set(standardEvents.map((e) => e.eventType));
      for (const s of STANDARD_ENUMS) {
        if (!known.has(s)) {
          standardEvents.push({ eventType: s, lastFiredTime: null, count: 0 });
        }
      }

      return res.status(200).json({ status: true, events: standardEvents });
    } catch (error) {
      const m = logMetaError("getPixelEvents error", error);
      return res.status(500).json({
        status: false,
        error: m.title || "Failed to load pixel events",
        details: m.message,
        meta: { code: m.code, subcode: m.subcode, fbtraceId: m.fbtraceId },
      });
    }
  }

  // * 7d. GET lead forms attached to a Facebook Page.
  // Drives the V2 wizard's "Use existing form" path for Leads/Instant Form.
  // Pages typically accumulate lead forms over time (one per audience/offer),
  // and users want to attach a new ad to an existing form rather than
  // re-author the questions.
  //
  // Requires `pageId` query param. The leadgen_forms edge enforces a
  // Page Access Token (error #190 otherwise), so we swap the SDK's
  // default user token for a page-scoped token by creating a fresh
  // `FacebookAdsApi` instance bound to the page token.
  async getLeadForms(req, res) {
    /* #swagger.tags = ['Meta Ads Launcher']
       #swagger.description = 'List Instant Forms on a Page for the Leads wizard'
    */
    try {
      const userId = req.user.user_id;
      const { pageId } = req.query;
      if (!pageId) {
        return res.status(400).json({ status: false, error: "pageId is required" });
      }

      await initApiForUser(userId);

      const pageToken = await getPageAccessToken(pageId);
      if (!pageToken) {
        return res.status(403).json({
          status: false,
          error: "Couldn't resolve a Page Access Token for this Page",
          details:
            "Make sure your Facebook account has admin / advertiser access to this Page, and that the OAuth grant includes pages_show_list + pages_read_engagement scopes.",
        });
      }

      // A fresh API instance bound to the page token. The default
      // FacebookAdsApi auto-injects the user token; constructing a new
      // instance with the page token avoids the header-override ambiguity.
      const pageApi = new bizSdk.FacebookAdsApi(pageToken);
      const result = await pageApi.call("GET", [pageId, "leadgen_forms"], {
        fields: "id,name,status,created_time,locale,leads_count",
        limit: 50,
      });
      const rawForms = result?.data || result?._data?.data || [];

      // Normalise to a wizard-friendly shape and only surface ACTIVE forms
      // (archived/deleted forms can't be attached to new ads).
      const forms = rawForms
        .filter((f) => !f.status || f.status === "ACTIVE")
        .map((f) => ({
          id: f.id,
          name: f.name,
          status: f.status || "ACTIVE",
          createdTime: f.created_time || null,
          locale: f.locale || null,
          leadsCount: f.leads_count || 0,
        }));

      return res.status(200).json({ status: true, forms });
    } catch (error) {
      const m = logMetaError("getLeadForms error", error);
      return res.status(500).json({
        status: false,
        error: m.title || "Failed to load lead forms",
        details: m.message,
        meta: { code: m.code, subcode: m.subcode, fbtraceId: m.fbtraceId },
      });
    }
  }

  // * 7e. POST create a new Lead Form on a Facebook Page.
  // Used by the V2 wizard's "Build new form" path. Captures the minimum
  // viable Meta LeadGenForm: a greeting screen, prefilled standard
  // questions (email + phone are universal), a privacy policy URL, and a
  // thank-you screen. Custom multi-choice questions, conditional logic,
  // and form testing land later.
  //
  // Requires the Page admin to have accepted Meta's Lead Ads Terms (one-
  // time, per Page). If not accepted, Meta returns a clear error which
  // we surface verbatim — the user clicks the link to accept and retries.
  async createLeadForm(req, res) {
    /* #swagger.tags = ['Meta Ads Launcher']
       #swagger.description = 'Create a Meta Instant (Lead Gen) Form on a Page'
    */
    try {
      const userId = req.user.user_id;
      const {
        pageId,
        name,
        greetingTitle,
        greetingBody,
        questions, // array of standard question types; see STANDARD_QUESTIONS below
        privacyPolicyUrl,
        privacyPolicyText,
        thankYouTitle,
        thankYouBody,
        thankYouButtonText,
        thankYouLinkUrl,
        locale,
      } = req.body || {};

      if (!pageId) {
        return res.status(400).json({ status: false, error: "pageId is required" });
      }
      if (!name || name.length < 2) {
        return res.status(400).json({ status: false, error: "Form name is required (min 2 chars)" });
      }
      if (!privacyPolicyUrl) {
        return res.status(400).json({
          status: false,
          error: "Privacy policy URL is required by Meta for every Lead Form",
        });
      }

      // Standard prefilled questions — Meta accepts these `type` enums
      // and prefills from the user's Facebook profile. The wizard MVP
      // only surfaces these; custom questions are Phase 3.5.
      const STANDARD_QUESTIONS = new Set([
        "EMAIL",
        "FULL_NAME",
        "FIRST_NAME",
        "LAST_NAME",
        "PHONE",
        "CITY",
        "STATE",
        "ZIP",
        "COUNTRY",
        "POST_CODE",
        "DOB",
        "GENDER",
        "COMPANY_NAME",
        "JOB_TITLE",
      ]);
      const requested = Array.isArray(questions) && questions.length > 0
        ? questions
        : ["EMAIL", "PHONE"]; // sensible MVP default
      const invalid = requested.filter((q) => !STANDARD_QUESTIONS.has(q));
      if (invalid.length) {
        return res.status(400).json({
          status: false,
          error: `Unsupported question types: ${invalid.join(", ")}`,
        });
      }

      await initApiForUser(userId);

      const pageToken = await getPageAccessToken(pageId);
      if (!pageToken) {
        return res.status(403).json({
          status: false,
          error: "Couldn't resolve a Page Access Token for this Page",
          details:
            "Make sure your Facebook account has admin / advertiser access to this Page, and that the OAuth grant includes pages_show_list + pages_read_engagement scopes.",
        });
      }

      // Build the Meta LeadGenForm payload.
      const params = {
        name,
        questions: requested.map((type) => ({ type })),
        privacy_policy: {
          url: privacyPolicyUrl,
          link_text: privacyPolicyText || "Privacy Policy",
        },
        // Meta requires `follow_up_action_url` on every Lead Gen form — it's
        // where the lead is redirected after submitting. Use the advertiser's
        // thank-you link when supplied, otherwise fall back to the privacy
        // policy URL (always present + a valid URL). Omitting it makes Meta
        // reject the form with "Missing field(s): FollowUpActionURL".
        follow_up_action_url: thankYouLinkUrl || privacyPolicyUrl,
      };

      if (greetingTitle || greetingBody) {
        params.context_card = {
          title: greetingTitle || name,
          content: greetingBody
            ? [greetingBody]
            : ["Tell us a bit about yourself and we'll get back to you."],
          style: "PARAGRAPH_STYLE",
          button_text: "Continue",
        };
      }

      if (thankYouTitle || thankYouBody || thankYouLinkUrl) {
        params.thank_you_page = {
          title: thankYouTitle || "Thanks for your interest!",
          body: thankYouBody || "We'll be in touch soon.",
          button_type: thankYouLinkUrl ? "VIEW_WEBSITE" : "NONE",
          ...(thankYouLinkUrl
            ? {
                website_url: thankYouLinkUrl,
                button_text: thankYouButtonText || "Visit website",
              }
            : {}),
        };
      }

      if (locale) params.locale = locale;

      // Page-scoped API instance — same reason as getLeadForms.
      const pageApi = new bizSdk.FacebookAdsApi(pageToken);
      const result = await pageApi.call("POST", [pageId, "leadgen_forms"], params);
      const formId = result?.id || result?._data?.id;
      if (!formId) {
        throw new Error("Meta did not return a form id");
      }

      return res.status(201).json({
        status: true,
        form: { id: formId, name, status: "ACTIVE" },
      });
    } catch (error) {
      const m = logMetaError("createLeadForm error", error);
      return res.status(500).json({
        status: false,
        error: m.title || "Failed to create lead form",
        details: m.message,
        meta: { code: m.code, subcode: m.subcode, fbtraceId: m.fbtraceId },
      });
    }
  }

  // * 7f. GET captured lead submissions for an Instant Form.
  // Powers the dashboard's Leads tab table. Needs `formId` + `pageId`.
  // The form `leads` edge requires a Page Access Token AND the
  // leads_retrieval OAuth scope — Meta returns code 200 ("Requires
  // leads_retrieval permission") when the connected account never granted
  // it; we translate that into an actionable 403 the UI can show.
  async getFormLeads(req, res) {
    /* #swagger.tags = ['Meta Ads Launcher']
       #swagger.description = 'List captured leads for an Instant Form'
    */
    try {
      const userId = req.user.user_id;
      const { formId, pageId } = req.query;
      if (!formId || !pageId) {
        return res
          .status(400)
          .json({ status: false, error: "formId and pageId are both required" });
      }

      await initApiForUser(userId);

      const pageToken = await getPageAccessToken(pageId);
      if (!pageToken) {
        return res.status(403).json({
          status: false,
          error: "Couldn't resolve a Page Access Token for this Page",
          details:
            "Make sure your Facebook account has admin / advertiser access to this Page.",
        });
      }

      const pageApi = new bizSdk.FacebookAdsApi(pageToken);
      const leads = (await fetchAllLeadsForForm(pageApi, formId)).map(
        normalizeLead,
      );

      return res.status(200).json({
        status: true,
        leads,
        fieldNames: leadFieldNames(leads),
        count: leads.length,
      });
    } catch (error) {
      const m = logMetaError("getFormLeads error", error);
      // Meta code 200 on the leads edge == missing leads_retrieval scope.
      const scopeMissing = m.code === 200;
      return res.status(scopeMissing ? 403 : 500).json({
        status: false,
        error: scopeMissing
          ? "Leads access not granted"
          : m.title || "Failed to load leads",
        details: scopeMissing
          ? "This connected Facebook account hasn't granted the leads_retrieval permission. The Leads tab needs `leads_retrieval` enabled on the Meta App, then the user reconnects Facebook."
          : m.message,
        meta: { code: m.code, subcode: m.subcode, fbtraceId: m.fbtraceId },
      });
    }
  }

  // * 7g. GET captured leads as a downloadable CSV (opens in Excel).
  // Same data as getFormLeads, streamed as a text/csv attachment so the
  // advertiser can follow up with leads directly.
  async exportFormLeads(req, res) {
    /* #swagger.tags = ['Meta Ads Launcher']
       #swagger.description = 'Export captured leads for an Instant Form as CSV'
    */
    try {
      const userId = req.user.user_id;
      const { formId, pageId, formName } = req.query;
      if (!formId || !pageId) {
        return res
          .status(400)
          .json({ status: false, error: "formId and pageId are both required" });
      }

      await initApiForUser(userId);

      const pageToken = await getPageAccessToken(pageId);
      if (!pageToken) {
        return res.status(403).json({
          status: false,
          error: "Couldn't resolve a Page Access Token for this Page",
        });
      }

      const pageApi = new bizSdk.FacebookAdsApi(pageToken);
      const leads = (await fetchAllLeadsForForm(pageApi, formId)).map(
        normalizeLead,
      );
      const csv = leadsToCsv(leads);

      // Safe filename — strip anything HTTP headers / the OS dislike.
      const safeName =
        String(formName || `form-${formId}`)
          .replace(/[^a-z0-9_-]+/gi, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 60) || "leads";

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="leads-${safeName}.csv"`,
      );
      return res.status(200).send(csv);
    } catch (error) {
      const m = logMetaError("exportFormLeads error", error);
      const scopeMissing = m.code === 200;
      return res.status(scopeMissing ? 403 : 500).json({
        status: false,
        error: scopeMissing
          ? "Leads access not granted"
          : m.title || "Failed to export leads",
        details: scopeMissing
          ? "This connected Facebook account hasn't granted the leads_retrieval permission."
          : m.message,
      });
    }
  }

  // * 7b. GET the V2 wizard schema + FEATURE_WIZARD_V2 flag state.
  // The schema describes every (objective × conversionLocation) cell the
  // V2 wizard supports. Frontend fetches this once at wizard mount and
  // renders entirely from the response — no client-side hardcoding of
  // optimization-goal lists, CTAs, identity requirements, etc.
  //
  // No FB token needed — the schema is static config. JWT auth is still
  // enforced via the parent /meta-ads mount.
  async getWizardSchema(req, res) {
    /* #swagger.tags = ['Meta Ads Launcher']
       #swagger.description = 'Wizard V2 schema + feature-flag state + server-resolved defaults'
    */
    try {
      const wizardSchema = require("../../config/wizardSchema");
      const enabled = process.env.FEATURE_WIZARD_V2 === "true";
      // Server-resolved defaults the wizard uses to skip asking the user
      // for values that live in env. For App Promotion specifically: the
      // Meta application id comes from META_APP_PROMOTION_APP_ID (or the
      // deployment's FACEBOOK_APP_ID as a sensible fallback — that's the
      // app the FB OAuth and Marketing API run under, so it's the safest
      // default for "this stack's Meta app").
      const defaults = {
        appPromotion: {
          applicationId:
            process.env.META_APP_PROMOTION_APP_ID ||
            process.env.FACEBOOK_APP_ID ||
            null,
        },
      };
      return res.status(200).json({
        status: true,
        enabled,
        schema: wizardSchema.toJSON(),
        defaults,
      });
    } catch (error) {
      logger.error("getWizardSchema error", error);
      return res.status(500).json({
        status: false,
        error: "Failed to load wizard schema",
      });
    }
  }

  // * 8. GET pages the user can advertise from on the SELECTED ad account.
  //
  // Scoping rule (matches Meta Ads Manager's own picker):
  //   - If the ad account is owned by a business, return that business's
  //     `owned_pages` + `client_pages`. These are the pages explicitly
  //     assigned to the ad account in Business Settings; nothing else can
  //     be used as the page identity on a creative against this account.
  //   - If the ad account is personal (no business binding), fall back to
  //     `/me/accounts` (pages the user is an admin of via their personal
  //     Facebook identity).
  //
  // Walking `/me/businesses` across every business the user belongs to was
  // rejected — it pollutes the picker with pages from unrelated businesses
  // and doesn't match Meta's UI. If a page is missing, the fix is to
  // assign it to the ad account in Business Settings.
  async getPages(req, res) {
    /* #swagger.tags = ['Meta Ads Launcher']
       #swagger.description = 'List Facebook Pages assigned to the selected ad account'
       #swagger.parameters['adAccountId'] = { description: 'Ad Account ID', type: 'string', required: true }
    */
    try {
      const userId = req.user.user_id;
      const { adAccountId } = req.query;
      if (!adAccountId) {
        return res.status(400).json({
          status: false,
          error: "adAccountId is required",
        });
      }
      await initApiForUser(userId);

      const api = bizSdk.FacebookAdsApi.getDefaultApi();
      // IG account fields pulled inline so the wizard can offer a per-page
      // Instagram identity without an extra round-trip.
      const pageFields = [
        "id",
        "name",
        "access_token",
        "category",
        "fan_count",
        "picture",
        // The current user's permission tasks on this page. Creating an ad
        // needs ADVERTISE (or MANAGE) — without it Meta rejects at launch
        // even though the page is visible. We filter on this below so the
        // picker only offers pages the user can actually advertise with.
        "tasks",
        "instagram_business_account{id,username,name,profile_picture_url}",
        "connected_instagram_account{id,username}",
      ];
      const mapPage = (p, source, biz) => ({
        id: p.id,
        name: p.name,
        category: p.category,
        fanCount: p.fan_count,
        picture: p.picture?.data?.url,
        tasks: Array.isArray(p.tasks) ? p.tasks : [],
        instagramAccount: p.instagram_business_account
          ? {
              id: p.instagram_business_account.id,
              username: p.instagram_business_account.username,
              name: p.instagram_business_account.name,
              picture: p.instagram_business_account.profile_picture_url,
            }
          : p.connected_instagram_account
          ? {
              id: p.connected_instagram_account.id,
              username: p.connected_instagram_account.username,
            }
          : null,
        source,
        ...(biz ? { businessId: biz.id, businessName: biz.name } : {}),
      });

      // 1. Look up the ad account's owning business. Most accounts in our
      //    use case are business-bound, so this is the primary path.
      let bizId = null;
      let bizName = null;
      try {
        const adAccount = await api.call("GET", [`act_${adAccountId}`], {
          fields: "business{id,name}",
        });
        bizId =
          adAccount?.business?.id || adAccount?._data?.business?.id || null;
        bizName =
          adAccount?.business?.name || adAccount?._data?.business?.name || null;
        logger.info(
          `getPages: act_${adAccountId} → business ${bizId || "(personal account)"}`,
        );
      } catch (e) {
        logger.warn(
          `getPages: ad account business lookup failed: ${e.message}`,
        );
      }

      const all = [];

      if (bizId) {
        // 2a. Business-bound ad account: return only pages assigned to its
        //     owning business. owned_pages = pages the business owns;
        //     client_pages = pages other businesses have shared with it.
        for (const edge of ["owned_pages", "client_pages"]) {
          try {
            const result = await api.call("GET", [bizId, edge], {
              fields: pageFields.join(","),
              limit: 100,
            });
            const raw = result?.data || result?._data?.data || [];
            const source =
              edge === "owned_pages" ? "business_owned" : "business_client";
            for (const p of raw) {
              all.push(mapPage(p, source, { id: bizId, name: bizName }));
            }
            logger.info(
              `getPages: ${bizId}/${edge} → ${raw.length} pages`,
            );
          } catch (e) {
            logger.warn(
              `getPages: ${bizId}/${edge} failed: ${e.message}`,
            );
          }
        }
      } else {
        // 2b. Personal ad account: fall back to pages the user admins via
        //     their personal Facebook identity (/me/accounts).
        try {
          const me = new bizSdk.User("me");
          const direct = await me.getAccounts(pageFields);
          for (const p of direct) all.push(mapPage(p, "direct"));
          logger.info(`getPages: /me/accounts → ${direct.length} pages`);
        } catch (e) {
          logger.warn(`getPages: /me/accounts failed: ${e.message}`);
        }
      }

      // Dedupe by page id — owned_pages and client_pages can overlap if a
      // page was assigned through both routes. Keep the entry that carries
      // the richer task list (a page can come back with tasks on one edge
      // and without on another).
      const byId = new Map();
      for (const p of all) {
        const existing = byId.get(p.id);
        if (!existing || (p.tasks?.length || 0) > (existing.tasks?.length || 0)) {
          byId.set(p.id, p);
        }
      }
      let pagesOut = Array.from(byId.values());

      // Only offer pages the user can actually advertise with. Meta returns
      // each page's `tasks` (the user's permissions); creating an ad needs
      // ADVERTISE or MANAGE. Pages the business owns but the user isn't
      // assigned to advertise with come back WITHOUT those tasks — picking
      // one fails at launch with a page-permission error. We filter only
      // when Meta actually returned task data for at least one page (so an
      // API that omits `tasks` can never hide every page).
      const AD_TASKS = new Set(["ADVERTISE", "MANAGE"]);
      const canAdvertise = (p) =>
        Array.isArray(p.tasks) && p.tasks.some((t) => AD_TASKS.has(t));
      const anyHasTasks = pagesOut.some((p) => p.tasks?.length);
      if (anyHasTasks) {
        const before = pagesOut.length;
        pagesOut = pagesOut.filter(canAdvertise);
        logger.info(
          `getPages: filtered ${before} → ${pagesOut.length} pages with ADVERTISE/MANAGE`,
        );
      }

      return res.status(200).json({
        status: true,
        pages: pagesOut,
        count: pagesOut.length,
      });
    } catch (error) {
      const m = logMetaError("Get pages error", error);
      const status = error.statusCode || 500;
      return res.status(status).json({
        status: false,
        error: status === 500 ? "Failed to fetch pages" : error.message,
        details: m.message,
        meta: { code: m.code, subcode: m.subcode, fbtraceId: m.fbtraceId },
      });
    }
  }

  // * 9. GET saved audiences for an ad account (for the audience picker).
  async getSavedAudiences(req, res) {
    /* #swagger.tags = ['Meta Ads Launcher']
       #swagger.description = 'List Saved Audiences for an ad account'
       #swagger.parameters['adAccountId'] = { description: 'Ad Account ID', type: 'string', required: true }
    */
    try {
      const { adAccountId } = req.query;
      if (!adAccountId) {
        return res.status(400).json({ status: false, error: "adAccountId is required" });
      }

      const userId = req.user.user_id;
      await initApiForUser(userId);
      const account = new AdAccount(`act_${adAccountId}`);

      const audiences = await account.getSavedAudiences([
        "id",
        "name",
        "description",
        "approximate_count_lower_bound",
        "approximate_count_upper_bound",
      ]);

      const formatted = audiences.map((a) => {
        const d = a._data || a;
        return {
          id: d.id,
          name: d.name,
          description: d.description || "",
          // Meta returns a count range; we surface the lower bound for a
          // single human-readable size estimate.
          size: d.approximate_count_lower_bound || null,
        };
      });

      return res.status(200).json({
        status: true,
        savedAudiences: formatted,
        count: formatted.length,
      });
    } catch (error) {
      const m = logMetaError("Get saved audiences error", error);
      return res.status(500).json({
        status: false,
        error: m.title || "Failed to fetch saved audiences",
        details: m.message,
        meta: { code: m.code, subcode: m.subcode, fbtraceId: m.fbtraceId },
      });
    }
  }

  // * 9b. GET geo-location search results.
  //
  // Thin proxy over Meta's `/search?type=adgeolocation` endpoint. Drives
  // the V2 wizard's Location Targeting typeahead — the user types a few
  // characters and we return matching countries / cities / regions /
  // country-group keys (free-trade-area sets). The frontend renders the
  // result with a type badge.
  //
  // Query params:
  //   q     — search string (min 1 char).
  //   types — comma-separated subset of: country, city, region,
  //           country_group, subcity, neighborhood, zip, geo_market.
  //           Defaults to country,city,region,country_group.
  //   limit — max results, 1-50, default 25.
  //
  // Returns: { results: [{ key, name, type, countryCode, countryName, region, supportsRegion, supportsCity }] }
  //
  // Taiwan + Singapore are filtered from country / region / city results
  // because Meta requires per-country regulatory declarations
  // (`regional_regulation_identities` for TW, `SINGAPORE_UNIVERSAL` for
  // SG) that the V2 wizard doesn't yet implement — matching the same
  // exclusion the worldwide path applies via WORLDWIDE_EXCLUDED_COUNTRIES.
  async searchGeoLocations(req, res) {
    /* #swagger.tags = ['Meta Ads Launcher']
       #swagger.description = 'Search Meta geo locations (typeahead)'
    */
    try {
      const q = String(req.query.q || "").trim();
      if (!q) {
        return res
          .status(400)
          .json({ status: false, error: "q (search string) is required" });
      }
      // Full set of geo-types Meta accepts in adgeolocation search.
      // Keep this aligned with `groupLocationsByType` in metaAdLauncherV2 —
      // any type the search returns must also have a payload-routing case
      // there, else picks vanish silently at launch.
      const ALLOWED_TYPES = new Set([
        "country",
        "country_group",
        "region",
        "subregion",
        "city",
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
      const requestedTypes = String(req.query.types || "")
        .split(",")
        .map((t) => t.trim())
        .filter((t) => ALLOWED_TYPES.has(t));
      // Default to the Meta Ads Manager UI's surface set — what their
      // location autocomplete shows out-of-the-box. Excludes the very-
      // granular geo_area buckets (large/medium/small) and subneighborhood
      // to keep the dropdown noise-free; callers can request them
      // explicitly via the `?types=` query param when needed.
      const locationTypes = requestedTypes.length
        ? requestedTypes
        : [
            "country",
            "country_group",
            "region",
            "subregion",
            "city",
            "subcity",
            "neighborhood",
            "zip",
            "geo_market",
            "electoral_district",
          ];
      const limit = Math.min(
        Math.max(parseInt(req.query.limit, 10) || 25, 1),
        50,
      );

      const userId = req.user.user_id;
      await initApiForUser(userId);
      const api = bizSdk.FacebookAdsApi.getDefaultApi();

      const params = {
        type: "adgeolocation",
        qs: JSON.stringify([q]),
        place_fallback: "true",
        limit,
      };
      const raw = await api.call("GET", ["search"], params);
      const rows = raw?.data || raw?._data?.data || [];

      // Skip TW/SG until regulatory declarations are implemented (see
      // WORLDWIDE_EXCLUDED_COUNTRIES in metaAdLauncherV2.js + the
      // worldwide ad-set path).
      const isBlockedCountry = (row) =>
        row?.type === "country" &&
        (row.country_code === "TW" || row.country_code === "SG");
      const isBlockedCityOrRegion = (row) =>
        (row?.type === "city" || row?.type === "region") &&
        (row.country_code === "TW" || row.country_code === "SG");

      const { TYPE_TO_META_BUCKET } = require("../../utils/targetingGeo");
      const results = rows
        .filter((row) => !isBlockedCountry(row) && !isBlockedCityOrRegion(row))
        .map((row) => {
          // Meta returns latitude/longitude as TOP-LEVEL string fields on
          // the row itself (e.g. "12.920430") — NOT nested under a
          // `location` sub-object. Confirmed 2026-07-06 by comparing our
          // raw response against Meta's own Ads Manager network capture
          // for the identical place ("Gunjur Roller Sports Academy",
          // key 105843676490251) — Meta's UI drops a precise pin because
          // it reads these fields; we never did. `row.location` kept as a
          // defensive fallback in case some API version nests it instead.
          const loc = row.location || {};
          return {
            key: String(row.key),
            name: row.name,
            type: row.type,
            countryCode: row.country_code || null,
            countryName: row.country_name || null,
            region: row.region || null,
            // Meta's own numeric region id — the SAME value used as
            // `regions[].key` when a region is targeted directly. Lets the
            // picker detect "this pick is inside an already-included
            // region" even when there's no country entry at all (see
            // dropOverlappingIncludes in utils/targetingGeo.js). Present on
            // city/region/subcity/neighborhood/zip/place rows; absent on
            // country/country_group/geo_market/electoral_district.
            regionId: row.region_id != null ? String(row.region_id) : null,
            // The city Meta associates with a `place` row (e.g. a small
            // business's linked city) — present even when the place itself
            // has no coordinates. Lets the picker retry geocoding with a
            // broader, more Nominatim-friendly query ("Bangalore, Karnataka,
            // India") when the exact business name comes back with no
            // match — Nominatim rarely has small businesses but usually has
            // the city they're in. See LocationTargeting.jsx `add()`.
            primaryCity: row.primary_city || null,
            // Meta's `adgeolocationmeta` bucket parameter name for this
            // item's type — e.g. type 'city' → 'cities', type 'place' →
            // 'places'. Computed ONCE here (single source of truth:
            // TYPE_TO_META_BUCKET in utils/targetingGeo.js) and passed
            // straight through by the picker when it needs to resolve
            // this item's coordinates (resolveLocationCoordinates), so
            // that endpoint doesn't need its own copy of this mapping —
            // it just uses whatever bucket the search step already
            // determined. `null` for types with no adgeolocationmeta
            // lookup (e.g. `custom` never applies here — pins never come
            // from search results).
            metaBucket: TYPE_TO_META_BUCKET[row.type] || null,
            supportsRegion: !!row.supports_region,
            supportsCity: !!row.supports_city,
            // Places often come back with a centroid. Surface it so the
            // picker can turn a place selection into a radius pin without an
            // extra geocode round-trip. Top-level fields are Meta's actual
            // shape (see comment above); `loc.*` is the defensive fallback.
            latitude: row.latitude != null
              ? Number(row.latitude)
              : (loc.latitude != null ? Number(loc.latitude) : null),
            longitude: row.longitude != null
              ? Number(row.longitude)
              : (loc.longitude != null ? Number(loc.longitude) : null),
          };
        });

      return res.status(200).json({ status: true, results, count: results.length });
    } catch (error) {
      const m = logMetaError("searchGeoLocations error", error);
      return res.status(500).json({
        status: false,
        error: m.title || "Failed to search locations",
        details: m.message,
        meta: { code: m.code, subcode: m.subcode, fbtraceId: m.fbtraceId },
      });
    }
  }

  // Resolve ANY adgeolocation pick's coordinates via Meta's OWN resolution
  // mechanism — NOT a guess, NOT hardcoded to one type. Captured directly
  // from Meta Ads Manager's network traffic (2026-07-06): when a user
  // clicks a search result, Meta's own client calls a SEPARATE follow-up
  // endpoint, routing to the bucket matching the PICKED ITEM'S TYPE:
  //   GET /search?type=adgeolocationmeta&places=["<key>"]        (place)
  //   GET /search?type=adgeolocationmeta&neighborhoods=["<key>"] (neighborhood)
  //   GET /search?type=adgeolocationmeta&cities=["<key>"]        (city)
  //   ...etc, one bucket per type.
  //
  // Coordinates are never inline in the `adgeolocation` search response
  // for ANY type — Meta's own UI doesn't expect them there either, which
  // is why our raw search dumps never showed lat/lng despite Meta clearly
  // having the data (proven live: Meta's UI drops a precise pin for the
  // exact same key our search returns with no coordinates).
  //
  // `bucket` (not `type`) is the caller's input — the type→bucket
  // translation (TYPE_TO_META_BUCKET in utils/targetingGeo.js) happens
  // ONCE in `searchGeoLocations`, attached to each result row as
  // `metaBucket`. This endpoint just uses whatever bucket it's given
  // rather than re-deriving it, so the mapping isn't maintained in two
  // places. Real hit 2026-07-06: "Gunjur Village" (type=neighborhood)
  // sitting in the SAME dropdown as "Gunjur Roller Sports Academy"
  // (type=place) — an earlier version hardcoded the `places` bucket
  // regardless of the picked item's actual type.
  //
  // Query: bucket (Meta's plural param name, e.g. 'places' | 'neighborhoods' | 'cities' — from the search row's `metaBucket` field), key (Meta's `key` from the adgeolocation search row)
  // Returns: { status: true, result: { latitude, longitude, countryCode, regionId } | null }
  // `result: null` means Meta has no location on file for this item
  // (some small-business Pages never set one) — NOT an error; caller
  // should fall through to the Nominatim-based fallbacks.
  async resolveLocationCoordinates(req, res) {
    /* #swagger.tags = ['Meta Ads Launcher']
       #swagger.description = "Resolve a search pick's coordinates via Meta's adgeolocationmeta (same call Meta Ads Manager itself makes)"
    */
    try {
      const bucket = String(req.query.bucket || "").trim();
      const key = String(req.query.key || "").trim();
      if (!bucket || !key) {
        // Not an error — a row with no `metaBucket` (e.g. `custom` pins,
        // which never come from search) has nothing to resolve. Caller
        // falls through to Nominatim.
        return res.status(200).json({ status: true, result: null });
      }
      // Safety allowlist — `bucket` is client-supplied (echoed back from
      // what searchGeoLocations attached earlier), so validate it against
      // Meta's known bucket names before splicing it into the API call as
      // a dynamic param key. Prevents an arbitrary string from landing as
      // an unexpected parameter name in the Meta request.
      const { TYPE_TO_META_BUCKET } = require("../../utils/targetingGeo");
      if (!Object.values(TYPE_TO_META_BUCKET).includes(bucket)) {
        return res.status(400).json({ status: false, error: "Unrecognised bucket" });
      }

      const userId = req.user.user_id;
      await initApiForUser(userId);
      const api = bizSdk.FacebookAdsApi.getDefaultApi();

      let data;
      try {
        const raw = await api.call("GET", ["search"], {
          type: "adgeolocationmeta",
          [bucket]: JSON.stringify([key]),
          include_headers: false,
        });
        data = raw?.data || raw?._data?.data || raw?._data || raw;
      } catch (apiErr) {
        // Best-effort — an invalid/inaccessible key shouldn't 500 the
        // picker. Fall through to result: null so the caller retries via
        // Nominatim instead.
        logMetaError("resolveLocationCoordinates Meta error", apiErr);
        return res.status(200).json({ status: true, result: null });
      }

      const hit = data?.[bucket]?.[key] || data?.[bucket]?.[String(key)];
      // Defensive on shape — check both top-level and nested `location`,
      // same uncertainty as the adgeolocation search response (see the
      // field-path bug this endpoint's sibling fix corrected earlier).
      const loc = hit?.location || {};
      const lat = hit?.latitude ?? loc.latitude;
      const lng = hit?.longitude ?? loc.longitude;
      if (!hit || lat == null || lng == null) {
        return res.status(200).json({ status: true, result: null });
      }
      return res.status(200).json({
        status: true,
        result: {
          latitude: Number(lat),
          longitude: Number(lng),
          countryCode: hit.country_code ? String(hit.country_code).toUpperCase() : null,
          regionId: hit.region_id != null ? String(hit.region_id) : null,
        },
      });
    } catch (error) {
      const m = logMetaError("resolveLocationCoordinates error", error);
      return res.status(500).json({
        status: false,
        error: m.title || "Failed to resolve location coordinates",
        details: m.message,
        meta: { code: m.code, subcode: m.subcode, fbtraceId: m.fbtraceId },
      });
    }
  }

  // Geocode a place name → { latitude, longitude } via OpenStreetMap
  // Nominatim. Meta's `adgeolocation` search does NOT return coordinates,
  // so the wizard calls this to drop a selected city/region as a pin on
  // the map (display only). Radius still travels to Meta the normal way
  // (`cities[].radius`); the lat/lng are not sent for non-custom types.
  async geocodeLocation(req, res) {
    /* #swagger.tags = ['Meta Ads Launcher']
       #swagger.description = 'Geocode a place name to coordinates (OpenStreetMap Nominatim)'
    */
    try {
      const q = String(req.query.q || "").trim();
      if (!q) {
        return res
          .status(400)
          .json({ status: false, error: "q (place name) is required" });
      }
      // Nominatim usage policy requires an identifying User-Agent and a
      // single result is enough for a centroid. countrycodes narrows the
      // match when the caller knows the country (cities/regions do).
      // addressdetails:1 so we can surface country_code — without it,
      // a Meta `place` (POI) result converted to a custom radius pin
      // (see LocationTargeting.jsx `add()`) would have NO country info,
      // and a same-country pin could never be recognised as redundant
      // with an included country (Meta subcode 1487756 at launch).
      const params = {
        q,
        format: "jsonv2",
        limit: 1,
        addressdetails: 1,
      };
      const cc = String(req.query.countryCode || "").trim().toLowerCase();
      if (cc) params.countrycodes = cc;

      const { data } = await axios.get(
        "https://nominatim.openstreetmap.org/search",
        {
          params,
          headers: {
            "User-Agent": "AdsGPT/1.0 (Meta Ads location targeting)",
            "Accept-Language": "en",
          },
          timeout: 8000,
        },
      );

      const hit = Array.isArray(data) && data.length ? data[0] : null;
      if (!hit) {
        return res
          .status(200)
          .json({ status: true, result: null });
      }
      return res.status(200).json({
        status: true,
        result: {
          latitude: Number(hit.lat),
          longitude: Number(hit.lon),
          displayName: hit.display_name || q,
          countryCode: (hit.address?.country_code || "").toUpperCase() || null,
        },
      });
    } catch (error) {
      console.error("geocodeLocation error:", error?.message || error);
      return res.status(500).json({
        status: false,
        error: "Failed to geocode location",
      });
    }
  }

  // Reverse-geocode lat/lng → { displayName, countryCode, regionId, primaryCity }.
  // Used by the wizard's map-pin picker to reject ocean / uninhabited
  // clicks (Meta's own Ads Manager won't let you pin in water; mirroring
  // that here avoids "campaign delivers to nobody" surprises) AND to
  // capture Meta's own countryCode/regionId for the pin immediately.
  //
  // CORRECTED 2026-07-06: this previously duplicated a Nominatim-only call
  // inline instead of using the shared `reverseGeocodeLatLng` helper below
  // (which existed specifically to be shared — see its docblock) — the two
  // had already drifted apart. Now delegates to it, which tries Meta's own
  // `adgeolocationmeta` (custom_locations bucket) first and only falls back
  // to Nominatim on failure/no-hit. See reverseGeocodeLatLng for the full
  // rationale (captured from Meta Ads Manager's own network traffic).
  //
  // Response shape:
  //   { status: true, result: { displayName, countryCode, regionId, primaryCity } }  → land
  //   { status: true, result: null }                                                 → ocean / no match
  async reverseGeocodeLocation(req, res) {
    /* #swagger.tags = ['Meta Ads Launcher']
       #swagger.description = 'Reverse-geocode lat/lng (Meta adgeolocationmeta, Nominatim fallback) to verify a map pin lies on land'
    */
    try {
      const lat = Number(req.query.lat);
      const lng = Number(req.query.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return res
          .status(400)
          .json({ status: false, error: "lat and lng query params are required" });
      }
      let api = null;
      try {
        const userId = req.user.user_id;
        await initApiForUser(userId);
        api = bizSdk.FacebookAdsApi.getDefaultApi();
      } catch {
        /* Meta init failed — reverseGeocodeLatLng falls back to Nominatim
           when api is null, so this isn't fatal to the request. */
      }
      const result = await reverseGeocodeLatLng(lat, lng, api);
      return res.status(200).json({ status: true, result });
    } catch (error) {
      console.error("reverseGeocodeLocation error:", error?.message || error);
      // Fail open — if Nominatim is down, don't block the user. The
      // backend Joi validator + Meta API will still catch wildly invalid
      // coords at launch time.
      return res.status(200).json({ status: true, result: null, degraded: true });
    }
  }

  // ─── Detailed Targeting (Demographics / Interests / Behaviours) ────────────
  //
  // Drives the V2 wizard's Detailed Targeting picker — Meta's unified
  // typeahead + Browse tree + related-suggestion + reach-estimate surface.
  //
  // Reference: developers.facebook.com/docs/marketing-api/audiences/reference/detailed-targeting
  //
  // Five endpoints in this section:
  //   • searchDetailedTargeting     — typeahead by name across all classes
  //   • browseDetailedTargeting     — categorical hierarchy for the Browse drawer
  //   • suggestDetailedTargeting    — Meta's related-item recommendations
  //   • reachEstimateForTargeting   — audience-size + narrow/broad gauge
  //   • validateDetailedTargeting   — flags picks Meta has since discontinued
  //
  // The first four cache via Redis; validate does not (results should
  // reflect Meta's current discontinuation state, not a stale cache).
  // Caches skipped on transient failure so a single hiccup doesn't lock
  // users out (same pattern as getCatalogs).
  //
  // SAC interaction: ALL four endpoints return empty / 400 when the
  // caller's targeting spec includes a regulated SAC, mirroring Meta UI's
  // hide-the-section behaviour. The wizard frontend also hides the picker
  // under SAC — this is defence-in-depth.

  // 9c. GET detailed-targeting search results (typeahead).
  //
  // Thin proxy over Meta's `/act_<AD_ACCOUNT_ID>/targetingsearch`. Per
  // Meta's documented contract (developers.facebook.com/documentation/
  // ads-commerce/marketing-api/audiences/reference/detailed-targeting),
  // all four detailed-targeting endpoints live on the ad-account node —
  // NOT the user node (Meta returns "(#100) Tried accessing nonexisting
  // field" for user-scoped paths).
  //
  // Query params:
  //   adAccountId — required (Meta ad account id, with or without `act_` prefix).
  //   q           — search string (min 1 char).
  //   classes     — comma-separated subset of DETAILED_TARGETING_CLASSES.
  //                 When exactly one class is given, sent as `limit_type`
  //                 to narrow Meta's results. Multiple / omitted = no filter
  //                 (search across all 15 classes).
  //   limit       — max results, 1-50, default 25.
  //
  // Returns: { results: [{ id, name, type, path, audienceSize, description }] }
  async searchDetailedTargeting(req, res) {
    /* #swagger.tags = ['Meta Ads Launcher']
       #swagger.description = 'Search Meta detailed-targeting categories (typeahead — interests, behaviors, demographics)'
    */
    try {
      const q = String(req.query.q || "").trim();
      if (!q) {
        return res
          .status(400)
          .json({ status: false, error: "q (search string) is required" });
      }
      const adAccountId = normalizeAdAccountId(req.query.adAccountId);
      if (!adAccountId) {
        return res.status(400).json({
          status: false,
          error: "adAccountId is required (Meta ad account id, with or without 'act_' prefix)",
        });
      }
      const {
        CLASS_SET,
      } = require("../../utils/detailedTargeting");
      const requestedClasses = String(req.query.classes || "")
        .split(",")
        .map((c) => c.trim())
        .filter((c) => CLASS_SET.has(c));
      const limit = Math.min(
        Math.max(parseInt(req.query.limit, 10) || 25, 1),
        50,
      );

      const userId = req.user.user_id;
      // Cache scoped by ad account — same query on different accounts may
      // return different results when account region differs.
      const cacheKey = `metaDTSearch:${userId}:${adAccountId}:${q.toLowerCase()}:${requestedClasses.join(",") || "all"}:${limit}`;
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        return res.status(200).json(JSON.parse(cached));
      }

      await initApiForUser(userId);
      const api = bizSdk.FacebookAdsApi.getDefaultApi();

      // Per Meta docs: `limit_type` is the single-class filter param;
      // omit to search across all classes. Multiple classes aren't
      // expressible in one call — for that the frontend would need to
      // fan out, which we don't do today (the unified single-call default
      // matches Meta UI's picker behaviour).
      const params = { q, limit };
      if (requestedClasses.length === 1) {
        params.limit_type = requestedClasses[0];
      }
      let rows = [];
      try {
        const raw = await api.call("GET", [adAccountId, "targetingsearch"], params);
        rows = raw?.data || raw?._data?.data || [];
      } catch (apiErr) {
        logMetaError("searchDetailedTargeting Meta error", apiErr);
        rows = []; // surface as no results; don't 500
      }

      // Normalise the Meta response into a stable shape the frontend can
      // render without knowing Meta's field names. `type` here is the
      // class (interests / behaviors / etc.); `path[0]` is the pillar.
      // Frontend derives badge color from the pillar — no class allowlist.
      const results = (Array.isArray(rows) ? rows : [])
        .filter((r) => r && r.id)
        .map((r) => ({
          id: String(r.id),
          name: r.name || String(r.id),
          type: r.type || r.path?.[0] || "interests",
          path: Array.isArray(r.path) ? r.path : [],
          audienceSize: r.audience_size_lower_bound != null
            ? Number(r.audience_size_lower_bound)
            : null,
          audienceSizeUpperBound: r.audience_size_upper_bound != null
            ? Number(r.audience_size_upper_bound)
            : null,
          description: r.description || null,
        }));

      const response = { status: true, results, count: results.length };
      // 30-min cache — search results don't change within a session.
      // Skip the cache write on empty results IF the upstream call threw
      // (we logged it above) — that's a transient failure we shouldn't pin.
      if (results.length || rows.length === 0) {
        await redisClient.set(cacheKey, JSON.stringify(response), "EX", 1800);
      }
      return res.status(200).json(response);
    } catch (error) {
      const m = logMetaError("searchDetailedTargeting error", error);
      return res.status(500).json({
        status: false,
        error: m.title || "Failed to search detailed targeting",
        details: m.message,
        meta: { code: m.code, subcode: m.subcode, fbtraceId: m.fbtraceId },
      });
    }
  }

  // 9d. GET detailed-targeting browse tree.
  //
  // Drives the wizard's "Browse" drawer — Meta's categorical hierarchy of
  // Demographics / Interests / Behaviours.
  //
  // Endpoint per Meta docs: `/act_<AD_ACCOUNT_ID>/targetingbrowse`.
  // Earlier version hit `/{fb_user_id}/targetingbrowse` and Meta returned
  // "(#100) Tried accessing nonexisting field" — that path is NOT in the
  // detailed-targeting docs (developers.facebook.com/documentation/
  // ads-commerce/marketing-api/audiences/reference/detailed-targeting).
  //
  // Query params:
  //   adAccountId — required.
  //   root        — optional id of a non-leaf row to expand its children.
  //                 Omit for the top-level pillar list.
  //   classes     — optional comma-separated single class for narrowing.
  //
  // Returns: { tree: [{ id, name, type, path, leaf }] } where leaf=true
  // rows can be added directly and non-leaf rows expand via `?root=<id>`.
  async browseDetailedTargeting(req, res) {
    /* #swagger.tags = ['Meta Ads Launcher']
       #swagger.description = 'Browse Meta detailed-targeting categorical hierarchy'
    */
    try {
      const adAccountId = normalizeAdAccountId(req.query.adAccountId);
      if (!adAccountId) {
        return res.status(400).json({
          status: false,
          error: "adAccountId is required",
        });
      }
      const userId = req.user.user_id;
      const rootId = String(req.query.root || "").trim() || null;
      const { CLASS_SET } = require("../../utils/detailedTargeting");
      const requestedClasses = String(req.query.classes || "")
        .split(",")
        .map((c) => c.trim())
        .filter((c) => CLASS_SET.has(c));
      const limitType = requestedClasses.length === 1 ? requestedClasses[0] : null;
      // Meta drops items that are no longer eligible for EXCLUDE targeting
      // (e.g. `Divorced` under relationship-status demographics — confirmed
      // live 2026-07-06) when this is set, on top of Meta's broader,
      // ongoing sunset of detailed-targeting exclusions (started March
      // 2025). It does NOT signal general discontinuation — an item can
      // still be missing under `is_exclusion=true` while remaining valid
      // for Include/Narrow, so this only matters when browsing FOR an
      // exclude bucket. No call site passes this yet (the wizard's Exclude
      // section was removed 2026-06-30 — see DetailedTargeting.jsx), but
      // the endpoint accepts it now so re-enabling Exclude for a future
      // cell doesn't also require a backend change.
      const isExclusion = String(req.query.isExclusion || "").trim() === "true";

      const cacheKey = `metaDTBrowse:${userId}:${adAccountId}:${rootId || "ROOT"}:${limitType || "all"}:${isExclusion ? "excl" : "incl"}`;
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        return res.status(200).json(JSON.parse(cached));
      }

      await initApiForUser(userId);
      const api = bizSdk.FacebookAdsApi.getDefaultApi();

      // include_headers=false is Meta's recommended setting per the docs
      // (response is wrapped without the API metadata header otherwise).
      const params = { include_headers: false, limit: 1000 };
      if (rootId) params.root = rootId;
      if (limitType) params.limit_type = limitType;
      if (isExclusion) params.is_exclusion = true;
      let rows = [];
      try {
        const raw = await api.call("GET", [adAccountId, "targetingbrowse"], params);
        rows = raw?.data || raw?._data?.data || [];
      } catch (apiErr) {
        logMetaError("browseDetailedTargeting Meta error", apiErr);
        rows = [];
      }

      const tree = (Array.isArray(rows) ? rows : [])
        .filter((r) => r && r.id)
        .map((r) => ({
          id: String(r.id),
          name: r.name || String(r.id),
          type: r.type || r.path?.[0] || "interests",
          path: Array.isArray(r.path) ? r.path : [],
          audienceSize: r.audience_size_lower_bound != null
            ? Number(r.audience_size_lower_bound)
            : null,
          audienceSizeUpperBound: r.audience_size_upper_bound != null
            ? Number(r.audience_size_upper_bound)
            : null,
          // Meta tags non-leaf rows with `leaf: false`. Default-true when
          // missing (older API versions omit the field on leaves).
          leaf: r.leaf !== false,
        }));

      const response = { status: true, tree };
      // 1-hour cache — Meta's hierarchy is essentially static; we just
      // bust on logout via invalidateAllUserMetaCache.
      if (tree.length || rows.length === 0) {
        await redisClient.set(cacheKey, JSON.stringify(response), "EX", 3600);
      }
      return res.status(200).json(response);
    } catch (error) {
      const m = logMetaError("browseDetailedTargeting error", error);
      return res.status(500).json({
        status: false,
        error: m.title || "Failed to browse detailed targeting",
        details: m.message,
        meta: { code: m.code, subcode: m.subcode, fbtraceId: m.fbtraceId },
      });
    }
  }

  // 9e. POST detailed-targeting related-item suggestions.
  //
  // POST (not GET) because Meta's `targeting_list` parameter is an array
  // of {type, id} objects that we don't want to URL-encode.
  //
  // Endpoint per Meta docs: `/act_<AD_ACCOUNT_ID>/targetingsuggestions`.
  //
  // Body:
  //   { adAccountId: '...', items: [{ type: 'interests', id: '600302...' }, ...] }
  //
  // Returns: { suggestions: [{ id, name, type, audienceSize }] }
  // sorted by Meta's relevance score (higher = more related).
  async suggestDetailedTargeting(req, res) {
    /* #swagger.tags = ['Meta Ads Launcher']
       #swagger.description = 'Get Meta-recommended related detailed-targeting items'
    */
    try {
      const adAccountId = normalizeAdAccountId(req.body?.adAccountId);
      if (!adAccountId) {
        return res.status(400).json({
          status: false,
          error: "adAccountId is required",
        });
      }
      const { asTargetingValidationList } = require("../../utils/detailedTargeting");
      const items = Array.isArray(req.body?.items) ? req.body.items : [];
      const targetingList = asTargetingValidationList(items);
      if (!targetingList.length) {
        return res
          .status(200)
          .json({ status: true, suggestions: [] });
      }

      const userId = req.user.user_id;
      const sig = targetingList.map((i) => `${i.type}:${i.id}`).sort().join("|");
      const cacheKey = `metaDTSuggest:${userId}:${adAccountId}:${sig}`;
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        return res.status(200).json(JSON.parse(cached));
      }

      await initApiForUser(userId);
      const api = bizSdk.FacebookAdsApi.getDefaultApi();

      // targeting_list goes URL-encoded per Meta docs — JSON-stringify
      // serialises to the documented shape.
      const params = {
        targeting_list: JSON.stringify(targetingList),
        limit: 25,
      };
      let rows = [];
      try {
        const raw = await api.call("GET", [adAccountId, "targetingsuggestions"], params);
        rows = raw?.data || raw?._data?.data || [];
      } catch (apiErr) {
        logMetaError("suggestDetailedTargeting Meta error", apiErr);
        rows = [];
      }

      const suggestions = (Array.isArray(rows) ? rows : [])
        .filter((r) => r && r.id)
        .map((r) => ({
          id: String(r.id),
          name: r.name || String(r.id),
          type: r.type || r.path?.[0] || "interests",
          path: Array.isArray(r.path) ? r.path : [],
          audienceSize: r.audience_size_lower_bound != null
            ? Number(r.audience_size_lower_bound)
            : null,
          // Upper bound too — frontend renders the full Meta-style range
          // ("12,857 - 15,120") when both are present.
          audienceSizeUpperBound: r.audience_size_upper_bound != null
            ? Number(r.audience_size_upper_bound)
            : null,
        }));

      const response = { status: true, suggestions };
      if (suggestions.length || rows.length === 0) {
        await redisClient.set(cacheKey, JSON.stringify(response), "EX", 1800);
      }
      return res.status(200).json(response);
    } catch (error) {
      const m = logMetaError("suggestDetailedTargeting error", error);
      return res.status(500).json({
        status: false,
        error: m.title || "Failed to load suggestions",
        details: m.message,
        meta: { code: m.code, subcode: m.subcode, fbtraceId: m.fbtraceId },
      });
    }
  }

  // 9f. POST reach-estimate for a given targeting spec.
  //
  // POST because the body carries the full targeting object (locations,
  // age range, detailed-targeting flexible_spec, etc.) — too much for a
  // query string.
  //
  // Body:
  //   { adAccountId: 'act_...', targeting: { ... },
  //     optimizationGoal: 'OFFSITE_CONVERSIONS' (optional) }
  //
  // Returns: { estimate: { lowerBound, upperBound, dailyReach, currency } }
  // plus { degraded: true, cachedAt } when we're serving a stale cached
  // value due to Meta rate-limiting.
  //
  // Meta's `/act_X/reachestimate` is rate-limited PER AD ACCOUNT (Meta
  // doesn't publish the exact limit but ~30 calls/hour seems empirical).
  // Our cache is keyed by a stable hash of the targeting spec so identical
  // configs reuse the same answer.
  async reachEstimateForTargeting(req, res) {
    /* #swagger.tags = ['Meta Ads Launcher']
       #swagger.description = 'Estimate audience reach for a targeting spec'
    */
    try {
      const adAccountId = normalizeAdAccountId(req.body?.adAccountId);
      const { targeting, optimizationGoal } = req.body || {};
      if (!adAccountId || !targeting) {
        return res.status(400).json({
          status: false,
          error: "adAccountId (Meta ad account id) and targeting are required",
        });
      }

      // Convert the wizard's form-shaped targeting (camelCase, with
      // ageMin/locations/detailedTargeting/etc.) into Meta's API shape
      // (snake_case, with geo_locations/flexible_spec/etc.) — the same
      // transform we use on launch. Lazy require avoids a circular import
      // between this file and metaAdLauncherV2.js.
      const {
        buildExplicitTargeting,
      } = require("./metaAdLauncherV2");
      let metaTargeting;
      try {
        metaTargeting = buildExplicitTargeting(targeting, {
          // We don't have the campaign's SAC on this endpoint; the strip
          // is a safety net for launch, not estimate. Pass empty.
          specialAdCategories: [],
        });
      } catch (transformErr) {
        return res.status(400).json({
          status: false,
          error: "Invalid targeting payload",
          details: transformErr.message,
        });
      }

      const userId = req.user.user_id;
      // Stable cache key — hash the canonical JSON of the Meta-shaped spec
      // (post-transform) so identical configs hit the same cached estimate
      // regardless of key order on the input.
      const crypto = require("crypto");
      const targetingHash = crypto
        .createHash("sha1")
        .update(JSON.stringify(metaTargeting) + "|" + (optimizationGoal || ""))
        .digest("hex")
        .slice(0, 16);
      const cacheKey = `metaReachEstimate:${userId}:${adAccountId}:${targetingHash}`;
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        return res.status(200).json(JSON.parse(cached));
      }
      // Fallback cache — last-known estimate per (account, hash) regardless
      // of TTL. Lets us serve a stale value with `degraded: true` when
      // Meta returns rate-limit error #17.
      const fallbackKey = `metaReachEstimateLast:${userId}:${adAccountId}:${targetingHash}`;

      await initApiForUser(userId);
      const api = bizSdk.FacebookAdsApi.getDefaultApi();
      // Meta v24 /reachestimate accepts only `targeting_spec` (required)
      // and `currency` (optional). `optimize_for` belongs to the newer
      // /delivery_estimate endpoint — Meta rejects it here with
      // "Param optimize_for on field reachestimate: This param is not
      // valid". The `optimizationGoal` we accept on the request body is
      // kept in the cache key for future-proofing (delivery_estimate
      // switch) but not sent.
      const params = { targeting_spec: JSON.stringify(metaTargeting) };

      let estimate = null;
      let degraded = false;
      try {
        // Direct api.call — bypasses the SDK's `getReachEstimate` helper
        // which tries to .map() over response.data. Meta returns a single
        // object on this endpoint (`{ data: { users_lower_bound, ... } }`),
        // not an array, so the helper throws "response.data.map is not a
        // function". Calling the path ourselves returns the raw payload.
        // adAccountId is already prefixed via normalizeAdAccountId above —
        // omitting the prefix earlier produced `/<bare>/reachestimate` and
        // Meta rejected with "nonexisting field".
        const raw = await api.call("GET", [adAccountId, "reachestimate"], params);
        // Meta's payload shape is `{ data: { users_lower_bound, users_upper_bound,
        // estimate_ready, ... } }`. The SDK may unwrap `data` for us depending
        // on version — handle both shapes defensively.
        const data =
          raw?.data?.users_lower_bound != null ||
          raw?.data?.users_upper_bound != null
            ? raw.data
            : (raw?._data?.data || raw?._data || raw || {});
        estimate = {
          // Meta's response includes users_lower_bound + users_upper_bound;
          // older accounts return `users` instead. Surface whichever we get.
          lowerBound: data.users_lower_bound != null
            ? Number(data.users_lower_bound)
            : (data.users != null ? Number(data.users) : null),
          upperBound: data.users_upper_bound != null
            ? Number(data.users_upper_bound)
            : (data.users != null ? Number(data.users) : null),
          estimateReady: data.estimate_ready !== false,
        };
      } catch (apiErr) {
        const m = logMetaError("reachEstimate Meta error", apiErr);
        // Meta error code 17 = "User request limit reached" (account-level
        // rate limit on reachestimate). Fall through to the stale cache.
        const rateLimited = m?.code === 17 || /rate limit/i.test(m?.message || "");
        if (rateLimited) {
          const stale = await redisClient.get(fallbackKey);
          if (stale) {
            const staleEstimate = JSON.parse(stale);
            return res.status(200).json({
              status: true,
              estimate: staleEstimate.estimate,
              degraded: true,
              cachedAt: staleEstimate.timestamp,
              reason: "rate-limited",
            });
          }
        }
        // No fallback available — return the error envelope so the UI can
        // render an "Unavailable" pill instead of pretending we have data.
        return res.status(503).json({
          status: false,
          error: m.title || "Reach estimate unavailable",
          details: m.message,
          meta: { code: m.code, subcode: m.subcode, fbtraceId: m.fbtraceId },
        });
      }

      const response = {
        status: true,
        estimate,
        degraded,
      };

      // Cache: 5min on the hot key, 24h on the fallback key. The hot key
      // gives quick repeat-load; the fallback survives rate-limit windows.
      const timestamp = Date.now();
      await redisClient.set(
        cacheKey,
        JSON.stringify(response),
        "EX",
        300,
      );
      await redisClient.set(
        fallbackKey,
        JSON.stringify({ estimate, timestamp }),
        "EX",
        86400,
      );

      return res.status(200).json(response);
    } catch (error) {
      const m = logMetaError("reachEstimateForTargeting error", error);
      return res.status(500).json({
        status: false,
        error: m.title || "Failed to estimate reach",
        details: m.message,
        meta: { code: m.code, subcode: m.subcode, fbtraceId: m.fbtraceId },
      });
    }
  }

  // 9g. POST validate detailed-targeting items are still live on Meta.
  //
  // Real-world trigger (2026-07-06): Meta discontinued a detailed-
  // targeting option (subcode 1870211, "Some detailed targeting options
  // are being discontinued") — the option was still returned by
  // targetingsearch/targetingsuggestions, so nothing warned the user
  // until the ad set was rejected at publish time. Meta's error doesn't
  // say WHICH item is stale, so the only way to catch it ahead of launch
  // is to re-check every picked item against Meta's own validation type.
  //
  // Endpoint: `/act_<AD_ACCOUNT_ID>/targetingvalidation` — an ACT-SCOPED
  // edge, same family as `targetingsearch`/`targetingbrowse`/
  // `targetingsuggestions`, NOT the generic (non-act-scoped) `/search`
  // node used for `adgeolocation`/`adgeolocationmeta` elsewhere in this
  // file. CORRECTED 2026-07-06: shipped originally as `/search?type=
  // adTargetingValidation`, which doesn't exist — Meta rejected every
  // call with "Unsupported get request" (code 100, subcode 33) and the
  // best-effort catch below silently degraded to `invalid: []` every
  // single time, so the feature never actually validated anything from
  // day one. Confirmed against Meta's own edge reference doc
  // (`ad-account/targetingvalidation`) before this fix — `targeting_list`
  // is the correct param name and shape on the real edge too, so no
  // change needed there; only the URL path was wrong.
  //
  // Body: { adAccountId: '...', items: [{ type: 'interests', id: '600...' }, ...] }
  // Returns: { status: true, invalid: [{ type, id }, ...] } — items from
  // the input that Meta's validation did NOT return as live. Diffing
  // (rather than trusting an explicit "invalid" flag from Meta) is
  // deliberate: we don't know Meta's exact response shape for a
  // discontinued item ahead of a live failure, so "the input id simply
  // isn't in the output" is the one signal guaranteed to work regardless.
  async validateDetailedTargeting(req, res) {
    /* #swagger.tags = ['Meta Ads Launcher']
       #swagger.description = 'Check which Detailed Targeting picks are still valid on Meta'
    */
    try {
      const adAccountId = normalizeAdAccountId(req.body?.adAccountId);
      if (!adAccountId) {
        return res.status(400).json({
          status: false,
          error: "adAccountId is required",
        });
      }
      const { asTargetingValidationList, diffInvalidTargetingItems } = require("../../utils/detailedTargeting");
      const items = Array.isArray(req.body?.items) ? req.body.items : [];
      const targetingList = asTargetingValidationList(items);
      if (!targetingList.length) {
        return res.status(200).json({ status: true, invalid: [] });
      }

      const userId = req.user.user_id;
      await initApiForUser(userId);
      const api = bizSdk.FacebookAdsApi.getDefaultApi();

      let rows = [];
      try {
        const raw = await api.call("GET", [adAccountId, "targetingvalidation"], {
          targeting_list: JSON.stringify(targetingList),
        });
        rows = raw?.data || raw?._data?.data || [];
      } catch (apiErr) {
        // Best-effort — if the validation call itself fails, don't block
        // the wizard on it. The publish-time 1870211 error (with the
        // SUBCODE_HINTS message) is still the fallback safety net.
        logMetaError("validateDetailedTargeting Meta error", apiErr);
        return res.status(200).json({ status: true, invalid: [], degraded: true });
      }

      const invalid = diffInvalidTargetingItems(targetingList, rows);

      return res.status(200).json({ status: true, invalid });
    } catch (error) {
      const m = logMetaError("validateDetailedTargeting error", error);
      return res.status(500).json({
        status: false,
        error: m.title || "Failed to validate detailed targeting",
        details: m.message,
        meta: { code: m.code, subcode: m.subcode, fbtraceId: m.fbtraceId },
      });
    }
  }

  // * 10. POST create a campaign (Step 1 of the Ads Manager flow).
  async createCampaign(req, res) {
    /* #swagger.tags = ['Meta Ads Launcher']
       #swagger.description = 'Create a Meta campaign'
    */
    try {
      const { error, value } = createCampaignSchema.validate(req.body);
      if (error) {
        return res.status(400).json({
          status: false,
          error: error.details[0].context?.message || error.details[0].message,
        });
      }

      const userId = req.user.user_id;
      const {
        adAccountId,
        name,
        objective,
        specialAdCategories,
        dailyBudget,
        lifetimeBudget,
        bidStrategy,
        status,
      } = value;

      await initApiForUser(userId);
      const account = new AdAccount(`act_${adAccountId}`);

      const params = {
        name,
        objective,
        status,
        special_ad_categories: specialAdCategories,
      };
      // CBO: when a campaign-level budget is set, Meta requires a bid
      // strategy on the campaign and forbids adset-level budgets.
      if (dailyBudget) params.daily_budget = dailyBudget;
      if (lifetimeBudget) params.lifetime_budget = lifetimeBudget;
      if (dailyBudget || lifetimeBudget) {
        if (bidStrategy) params.bid_strategy = bidStrategy;
      } else {
        // Non-CBO (budget on adsets): Meta requires this flag set explicitly.
        // false = each adset keeps its own budget; true would let Meta pool
        // 20% across adsets for cross-set optimization.
        params.is_adset_budget_sharing_enabled = false;
      }

      const campaign = await account.createCampaign([], params);

      await invalidateAfterCreate(userId, { adAccountId });

      return res.status(201).json({
        status: true,
        message: "Campaign created",
        campaign: {
          id: campaign.id,
          name,
          objective,
          status,
          dailyBudget: dailyBudget || null,
          lifetimeBudget: lifetimeBudget || null,
          cbo: !!(dailyBudget || lifetimeBudget),
        },
      });
    } catch (error) {
      const m = logMetaError("Create campaign error", error);
      return res.status(500).json({
        status: false,
        error: m.title || "Failed to create campaign",
        details: m.message,
        meta: {
          code: m.code,
          subcode: m.subcode,
          fbtraceId: m.fbtraceId,
          data: m.data,
        },
      });
    }
  }

  // * 11. POST create an ad set under a campaign (Step 2).
  async createAdSet(req, res) {
    /* #swagger.tags = ['Meta Ads Launcher']
       #swagger.description = 'Create a Meta ad set under a campaign'
    */
    try {
      const { error, value } = createAdSetSchema.validate(req.body);
      if (error) {
        return res.status(400).json({
          status: false,
          error: error.details[0].context?.message || error.details[0].message,
        });
      }

      const userId = req.user.user_id;
      // `instagramActorId` is accepted by the schema for backwards-compat with
      // older clients but no longer consumed here — IG identity lives on the
      // creative.
      const {
        adAccountId,
        campaignId,
        pageId,
        name,
        dailyBudget,
        lifetimeBudget,
        billingEvent,
        optimizationGoal,
        bidStrategy,
        bidAmount,
        destinationType,
        startTime,
        endTime,
        savedAudienceId,
        targeting,
        status,
      } = value;

      // Meta rejects capped bid strategies without a bid_amount (and the
      // generic error is unhelpful). Catch this here so the user sees a
      // clean 400 instead of a Meta "Invalid parameter".
      const cappedStrategies = new Set([
        "LOWEST_COST_WITH_BID_CAP",
        "COST_CAP",
      ]);
      if (cappedStrategies.has(bidStrategy) && !bidAmount) {
        return res.status(400).json({
          status: false,
          error: `bidAmount is required when bidStrategy is ${bidStrategy}`,
        });
      }

      if (targeting.ageMin > targeting.ageMax) {
        return res.status(400).json({
          status: false,
          error: "targeting.ageMin must be less than or equal to targeting.ageMax",
        });
      }

      await initApiForUser(userId);
      const account = new AdAccount(`act_${adAccountId}`);

      // Build targeting. If a saved audience is provided we resolve its
      // targeting JSON server-side and use it as the spec — Meta accepts the
      // saved-audience id directly only on certain SDK paths, so this is the
      // most reliable approach.
      let targetingSpec;
      if (savedAudienceId) {
        try {
          const audience = new bizSdk.SavedAudience(savedAudienceId);
          const fetched = await audience.get(["targeting"]);
          targetingSpec = fetched.targeting || fetched._data?.targeting;
          if (!targetingSpec) {
            throw new Error("Saved audience has no targeting payload");
          }
        } catch (saErr) {
          return res.status(400).json({
            status: false,
            error: "Could not load the chosen saved audience",
            details: saErr.message,
          });
        }
      } else {
        const geo = targeting.worldwide
          ? { country_groups: ["worldwide"] }
          : { countries: targeting.countries };
        targetingSpec = {
          geo_locations: geo,
          age_min: targeting.ageMin,
          age_max: targeting.ageMax,
          ...(targeting.genders.length ? { genders: targeting.genders } : {}),
          ...(targeting.locales.length ? { locales: targeting.locales } : {}),
          targeting_automation: {
            advantage_audience: targeting.advantageAudience ? 1 : 0,
          },
        };
      }

      const adSetParams = {
        name,
        campaign_id: campaignId,
        billing_event: billingEvent,
        optimization_goal: optimizationGoal,
        bid_strategy: bidStrategy,
        status,
        // IG identity belongs on the creative's object_story_spec, not on
        // the ad set's promoted_object. Keeping promoted_object minimal here
        // (page_id) — the IG account flows through to placements via the
        // creative we attach later.
        promoted_object: { page_id: pageId },
        targeting: targetingSpec,
      };

      // Only one of daily/lifetime is set on an adset (and only when the
      // campaign isn't using CBO; the validator already enforces XOR).
      if (dailyBudget) adSetParams.daily_budget = dailyBudget;
      if (lifetimeBudget) adSetParams.lifetime_budget = lifetimeBudget;
      if (bidAmount) adSetParams.bid_amount = bidAmount;
      if (destinationType) adSetParams.destination_type = destinationType;
      if (startTime) adSetParams.start_time = new Date(startTime).toISOString();
      if (endTime) adSetParams.end_time = new Date(endTime).toISOString();

      const adSet = await account.createAdSet([], adSetParams);

      await invalidateAfterCreate(userId, { adAccountId, campaignId });

      return res.status(201).json({
        status: true,
        message: "Ad set created",
        adSet: { id: adSet.id, name, campaignId, status },
      });
    } catch (error) {
      const m = logMetaError("Create ad set error", error);
      return res.status(500).json({
        status: false,
        error: m.title || "Failed to create ad set",
        details: m.message,
        meta: {
          code: m.code,
          subcode: m.subcode,
          fbtraceId: m.fbtraceId,
          data: m.data,
        },
      });
    }
  }

  // * 12. POST upload an image to the ad account and return its hash.
  // Accepts a multipart `image` file OR a JSON `imageUrl` (downloaded server-side).
  async uploadAdImage(req, res) {
    /* #swagger.tags = ['Meta Ads Launcher']
       #swagger.description = 'Upload a creative image to the ad account; returns image_hash'
    */
    try {
      const { adAccountId, imageUrl } = req.body;
      const file = req.file;

      if (!adAccountId) {
        return res.status(400).json({ status: false, error: "adAccountId is required" });
      }
      if (!file && !imageUrl) {
        return res.status(400).json({
          status: false,
          error: "Provide either an `image` file or an `imageUrl`",
        });
      }

      const userId = req.user.user_id;
      await initApiForUser(userId);
      const account = new AdAccount(`act_${adAccountId}`);

      let bytes;
      let filename;
      if (file) {
        bytes = file.buffer.toString("base64");
        filename = file.originalname || "ad-image.jpg";
      } else {
        const downloaded = await axios.get(imageUrl, {
          responseType: "arraybuffer",
          timeout: 15000,
        });
        bytes = Buffer.from(downloaded.data).toString("base64");
        filename = "ad-image.jpg";
      }

      const result = await account.createAdImage([], { bytes, name: filename });

      // Meta returns the hash either at the top level or nested under `images`.
      let hash = result?.hash;
      if (!hash && result?.images) {
        const firstKey = Object.keys(result.images)[0];
        hash = result.images[firstKey]?.hash;
      }
      if (!hash) {
        throw new Error("Could not extract image hash from Meta response");
      }

      return res.status(201).json({
        status: true,
        imageHash: hash,
      });
    } catch (error) {
      const m = logMetaError("Upload ad image error", error);
      return res.status(500).json({
        status: false,
        error: m.title || "Failed to upload image",
        details: m.message,
        meta: { code: m.code, subcode: m.subcode, fbtraceId: m.fbtraceId },
      });
    }
  }

  // * 12b. POST upload a creative VIDEO to the ad account → returns video_id.
  // Same two-path API as uploadAdImage: multipart `video` file, OR JSON
  // `videoUrl` (we download the URL server-side and forward bytes to Meta).
  //
  // Meta's video pipeline is asynchronous — the `video_id` is returned
  // immediately but the video continues encoding in the background. Ads
  // created against an un-encoded video are accepted by Meta and start
  // delivering once encoding completes. The wizard treats the upload as
  // "done" as soon as `video_id` is in hand.
  async uploadAdVideo(req, res) {
    /* #swagger.tags = ['Meta Ads Launcher']
       #swagger.description = 'Upload a creative video to the ad account; returns video_id'
    */
    try {
      const { adAccountId, videoUrl } = req.body;
      const file = req.file;

      if (!adAccountId) {
        return res.status(400).json({ status: false, error: "adAccountId is required" });
      }
      if (!file && !videoUrl) {
        return res.status(400).json({
          status: false,
          error: "Provide either a `video` file or a `videoUrl`",
        });
      }

      const userId = req.user.user_id;
      await initApiForUser(userId);
      // The resumable-upload protocol below hits Meta's raw HTTP
      // endpoint directly, so we don't need an SDK `AdAccount` instance
      // here. `initApiForUser` is still required to seed the
      // FacebookAdsApi default-instance with the user's access token,
      // which we read below.

      let bytes;
      let filename;
      if (file) {
        bytes = file.buffer;
        filename = file.originalname || "ad-video.mp4";
      } else {
        const downloaded = await axios.get(videoUrl, {
          responseType: "arraybuffer",
          // Videos are heavier than images; bump the timeout. 60 s covers
          // a typical 30-60 MB creative; larger uploads should be done via
          // the multipart path where the client controls retries.
          timeout: 60000,
        });
        bytes = Buffer.from(downloaded.data);
        filename = "ad-video.mp4";
      }

      // Meta's resumable video upload protocol (3 phases: start →
      // transfer → finish). We DON'T use the SDK's `account.createAdVideo`
      // here because that's a single-request upload that hits
      // `graph.facebook.com` with aggressive server-side timeouts — even
      // tiny videos (2-3 MB) routinely fail with code 390 / subcode
      // 1363030 "Video Upload Timeout". The resumable protocol is what
      // Meta's own Ads Manager uses and is robust at any file size.
      //
      // The protocol:
      //   1. POST upload_phase=start with file_size → returns
      //      upload_session_id, video_id, start_offset, end_offset
      //   2. POST upload_phase=transfer for each [start_offset, end_offset)
      //      chunk → returns next chunk offsets. Done when start_offset
      //      reaches end_offset.
      //   3. POST upload_phase=finish to commit the upload.
      const accessToken = bizSdk.FacebookAdsApi.getDefaultApi().accessToken;
      const advideosUrl =
        `https://graph.facebook.com/v24.0/act_${adAccountId}/advideos`;
      const fileBytes = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);

      // ─── Phase 1: start ───────────────────────────────────────────
      const startBody = new URLSearchParams({
        upload_phase: "start",
        file_size: String(fileBytes.length),
        access_token: accessToken,
      });
      const startResp = await axios.post(advideosUrl, startBody.toString(), {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        timeout: 30000,
      });
      const {
        upload_session_id: sessionId,
        video_id: videoId,
        start_offset: startOffsetRaw,
        end_offset: endOffsetRaw,
      } = startResp.data || {};
      if (!sessionId || !videoId) {
        throw new Error("Meta resumable upload: start phase returned no session");
      }
      logger.info(
        `uploadAdVideo: start phase → session=${sessionId} video=${videoId} size=${fileBytes.length}`,
      );

      // ─── Phase 2: transfer chunks ─────────────────────────────────
      let start = Number(startOffsetRaw);
      let end = Number(endOffsetRaw);
      while (start < end) {
        const chunk = fileBytes.subarray(start, end);
        const form = new FormData();
        form.append("upload_phase", "transfer");
        form.append("upload_session_id", sessionId);
        form.append("start_offset", String(start));
        form.append("access_token", accessToken);
        // Built-in FormData accepts a Blob — wrap the Buffer.
        form.append(
          "video_file_chunk",
          new Blob([chunk]),
          `chunk-${start}.bin`,
        );
        // eslint-disable-next-line no-await-in-loop
        const r = await axios.post(advideosUrl, form, {
          timeout: 60000,
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
        });
        const nextStart = Number(r.data?.start_offset);
        const nextEnd = Number(r.data?.end_offset);
        if (Number.isNaN(nextStart) || Number.isNaN(nextEnd)) {
          throw new Error("Meta resumable upload: transfer phase returned no offsets");
        }
        // When Meta has all bytes, it returns start_offset === end_offset
        // (typically both = file_size). Loop exits naturally.
        if (nextStart === start && nextEnd === end) {
          throw new Error("Meta resumable upload: offsets not advancing — server didn't accept chunk");
        }
        start = nextStart;
        end = nextEnd;
      }

      // ─── Phase 3: finish ──────────────────────────────────────────
      const finishBody = new URLSearchParams({
        upload_phase: "finish",
        upload_session_id: sessionId,
        access_token: accessToken,
      });
      const finishResp = await axios.post(advideosUrl, finishBody.toString(), {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        timeout: 30000,
      });
      if (finishResp.data?.success !== true) {
        throw new Error("Meta resumable upload: finish phase did not return success");
      }
      // Silence unused-variable for filename — we logged the session above;
      // filename is only used by the SDK path which is gone now.
      void filename;

      // Auto-thumbnail — Meta extracts several thumbnail frames during
      // video encoding. For short videos (most ad creatives) the
      // preferred one is available within 1-3 s; we poll briefly so the
      // upload response can include it and the user doesn't have to
      // think about poster images. If encoding is still mid-way (longer
      // videos), thumbnailUrl comes back null and createAdV2 does a
      // last-chance fetch when the user clicks Launch.
      let thumbnailUrl = null;
      try {
        const api = bizSdk.FacebookAdsApi.getDefaultApi();
        for (let attempt = 0; attempt < 3; attempt += 1) {
          // eslint-disable-next-line no-await-in-loop
          const r = await api.call("GET", [videoId, "thumbnails"], {
            fields: "uri,is_preferred",
          });
          const thumbs = r?.data || r?._data?.data || [];
          const preferred = thumbs.find((t) => t.is_preferred) || thumbs[0];
          if (preferred?.uri) {
            thumbnailUrl = preferred.uri;
            break;
          }
          if (attempt < 2) {
            // eslint-disable-next-line no-await-in-loop
            await new Promise((resolve) => setTimeout(resolve, 1500));
          }
        }
      } catch (e) {
        // Best-effort — log and move on. createAdV2 will retry the
        // fetch at Launch time.
        logger.warn(`uploadAdVideo: thumbnail fetch failed: ${e.message}`);
      }

      return res.status(201).json({
        status: true,
        videoId,
        thumbnailUrl,
      });
    } catch (error) {
      const m = logMetaError("Upload ad video error", error);
      return res.status(500).json({
        status: false,
        error: m.title || "Failed to upload video",
        details: m.message,
        meta: { code: m.code, subcode: m.subcode, fbtraceId: m.fbtraceId },
      });
    }
  }

  // * 13. POST create an ad — bundles creative creation + ad creation in one
  // call so the wizard can hand us {pageId, imageHash, copy, link, cta} and
  // get back a launchable ad. Done in one step because a bare creative is
  // not useful on its own and forces the UI into a 5-call sequence.
  async createAd(req, res) {
    /* #swagger.tags = ['Meta Ads Launcher']
       #swagger.description = 'Create a single-image ad creative + ad under an ad set'
    */
    try {
      const { error, value } = createAdSchema.validate(req.body);
      if (error) {
        return res.status(400).json({ status: false, error: error.details[0].message });
      }

      const userId = req.user.user_id;
      const {
        adAccountId,
        adSetId,
        pageId,
        instagramActorId,
        name,
        imageHash,
        headline,
        primaryText,
        description,
        linkUrl,
        urlTags,
        callToAction,
        status,
      } = value;

      await initApiForUser(userId);
      const account = new AdAccount(`act_${adAccountId}`);

      // Only include optional copy fields when non-empty. Meta's create-ad
      // endpoint rejects `name: ""` / `message: ""` with a generic "Invalid
      // parameter" instead of letting them no-op like missing keys.
      const linkData = {
        image_hash: imageHash,
        link: linkUrl,
      };
      if (primaryText) linkData.message = primaryText;
      if (headline) linkData.name = headline;
      if (description) linkData.description = description;
      if (callToAction !== "NO_BUTTON") {
        linkData.call_to_action = {
          type: callToAction,
          value: { link: linkUrl },
        };
      }

      const objectStorySpec = { page_id: pageId, link_data: linkData };
      // `instagram_actor_id` was hard-deprecated on Sept 9, 2025 — every live
      // Marketing API version (v22+) now uses `instagram_user_id`. Sending the
      // old name returns "Invalid parameter".
      if (instagramActorId) objectStorySpec.instagram_user_id = instagramActorId;

      const creativeParams = {
        name: `${name} — creative`,
        object_story_spec: objectStorySpec,
      };
      // url_tags is the canonical place for UTM-style tracking — Meta
      // appends them to the click-through link automatically.
      if (urlTags) creativeParams.url_tags = urlTags.replace(/^\?/, "");

      const creative = await account.createAdCreative([], creativeParams);

      const ad = await account.createAd([], {
        name,
        adset_id: adSetId,
        creative: { creative_id: creative.id },
        status,
      });

      await invalidateAfterCreate(userId, { adAccountId, adSetId });

      return res.status(201).json({
        status: true,
        message: "Ad created",
        ad: { id: ad.id, name, status },
        creative: { id: creative.id },
      });
    } catch (error) {
      const m = logMetaError("Create ad error", error);
      return res.status(500).json({
        status: false,
        error: m.title || "Failed to create ad",
        details: m.message,
        meta: {
          code: m.code,
          subcode: m.subcode,
          fbtraceId: m.fbtraceId,
          data: m.data,
        },
      });
    }
  }

  // * 13a. DELETE a campaign (and Meta cascades to its ad sets + ads).
  async deleteCampaign(req, res) {
    /* #swagger.tags = ['Meta Ads Launcher']
       #swagger.description = 'Delete a Meta campaign — Meta cascades the delete to child ad sets and ads'
    */
    try {
      const { error, value } = deleteCampaignSchema.validate(req.body);
      if (error) {
        return res.status(400).json({
          status: false,
          error: error.details[0].context?.message || error.details[0].message,
        });
      }

      const { adAccountId, campaignId } = value;
      const userId = req.user.user_id;

      await initApiForUser(userId);

      const campaign = new bizSdk.Campaign(campaignId);
      await campaign.delete();

      // Deleting a campaign cascades server-side, so adset/ad list caches for
      // this user are also stale. Wipe the full status-bearing cache set
      // rather than threading specific child ids we don't have on hand.
      await invalidateUserMetaCache(userId);
      await invalidateMetaCacheByPrefixes(userId, ["metaAnalytics", "metaAudit"]);

      return res.status(200).json({
        status: true,
        message: "Campaign deleted",
        campaignId,
        adAccountId,
      });
    } catch (error) {
      const m = logMetaError("Delete campaign error", error);
      const status = error.statusCode || 500;
      return res.status(status).json({
        status: false,
        error: m.title || "Failed to delete campaign",
        details: m.message,
        meta: {
          code: m.code,
          subcode: m.subcode,
          fbtraceId: m.fbtraceId,
          data: m.data,
        },
      });
    }
  }

  // * 14. Rule-based Audit Engine
  async runAudit(req, res) {
    /* #swagger.tags = ['Meta Ads Launcher']
     #swagger.description = 'Run automated audit on campaigns, adsets and ads'
     #swagger.parameters['adAccountId'] = { description: 'Meta Ad Account ID', type: 'string' }
  */

    try {
      const { adAccountId } = req.query;
      const userId = req.user.user_id;

      if (!adAccountId)
        return res.status(400).json({ error: "Account ID is required" });

      // -------- REDIS CACHE --------
      const cacheKey = `metaAudit:${userId}:${adAccountId}`;
      const cached = await redisClient.get(cacheKey);

      if (cached) {
        return res.status(200).json(JSON.parse(cached));
      }
      // -----------------------------

      // Token resolution — caller's per-user FB OAuth token from the
      // facebookUsers collection.
      let accessToken;
      try {
        const resolved = await getAccessTokenForAccount({
          adAccountId,
          callerUserId: userId,
        });
        accessToken = resolved.accessToken;
      } catch (err) {
        return res.status(404).json({ error: err.message });
      }

      // Delegate to the extracted audit service. HTTP flow passes no options,
      // so rule defaults = historical hardcoded literals → byte-identical
      // output for accounts that already worked through the user-token path.
      const response = await runAuditForAccount({
        userId,
        adAccountId,
        accessToken,
      });

      // -------- STORE CACHE --------
      await redisClient.set(
        cacheKey,
        JSON.stringify(response),
        "EX",
        1800, // 30 minutes
      );
      // -----------------------------

      return res.status(200).json(response);
    } catch (error) {
      logger.error(`Audit error: ${error.message}`);
      return res.status(500).json({
        status: false,
        error: "Failed to run audit",
        details: error.message,
      });
    }
  }
}

module.exports = new MetaAdLauncher();
module.exports.invalidateAllUserMetaCache = invalidateAllUserMetaCache;
module.exports.invalidateAfterCreate = invalidateAfterCreate;
module.exports.formatMetaError = formatMetaError;
module.exports.logMetaError = logMetaError;
// rawErrorDump is required by metaAdLauncherV2.js's metaErrorResponse to
// persist a MetaLaunchTrace record — the same raw dump already written to
// the server log, captured alongside the request that produced it so a
// failed launch can be reproduced without re-deriving it from log files.
module.exports.rawErrorDump = rawErrorDump;
// initApiForUser is required by metaAdLauncherV2.js (the V2 wizard
// controller). Exporting keeps that file decoupled from this one's
// internals.
module.exports.initApiForUser = initApiForUser;
// getPagePhone is required by metaAdLauncherV2.js for click-to-call
// (Calls) ads — phone number comes from the Page, not the wizard form.
module.exports.getPagePhone = getPagePhone;
// reverseGeocodeLatLng is required by metaAdLauncherV2.js's launch-time
// backfillLocationCountryCodes — custom (map-pin) locations Meta reads
// back on edit never carry a country code, so the launch path needs the
// same Nominatim lookup the picker uses when a pin is first dropped.
module.exports.reverseGeocodeLatLng = reverseGeocodeLatLng;
// pickAppStoreUrl is required by metaAdLauncherV2.js's resolveCellForAdSet
// — re-derives a fresh, platform-matched objectStoreUrl for the Add-Ad flow
// instead of trusting the ad set's possibly-stale/mismatched
// promoted_object.object_store_url (subcode 1885270 fix).
module.exports.pickAppStoreUrl = pickAppStoreUrl;
