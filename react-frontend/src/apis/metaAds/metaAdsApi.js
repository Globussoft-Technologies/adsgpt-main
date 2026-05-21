import axios from 'axios';
import getCookies from '@/utils/getCookies';

const BASE_URL = import.meta.env.VITE_SOCKET_URL;

const getAuthHeaders = () => ({
  Authorization: `Bearer ${getCookies()}`,
});

export const getAdAccounts = async ({ refresh = false } = {}) => {
  const { data } = await axios.get(`${BASE_URL}/adsgpt/meta-ads/get-ad-accounts`, {
    params: refresh ? { refresh: 'true' } : undefined,
    headers: getAuthHeaders(),
  });
  return data;
};

export const getCampaigns = async (adAccountId) => {
  const { data } = await axios.get(`${BASE_URL}/adsgpt/meta-ads/get-campaigns`, {
    params: { adAccountId },
    headers: getAuthHeaders(),
  });
  return data;
};

export const getAdSets = async (campaignId, adAccountId) => {
  const { data } = await axios.get(`${BASE_URL}/adsgpt/meta-ads/get-ad-sets`, {
    params: { campaignId, adAccountId },
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

export const getAdSetAds = async (adSetId) => {
  const { data } = await axios.get(`${BASE_URL}/adsgpt/meta-ads/get-ad-set-ads`, {
    params: { adSetId },
    headers: getAuthHeaders(),
  });
  return data;
};

export const getAuditData = async (adAccountId) => {
  const { data } = await axios.get(`${BASE_URL}/adsgpt/meta-ads/audit`, {
    params: { adAccountId },
    headers: getAuthHeaders(),
  });
  return data;
};

export const getAnalyticsData = async ({ adAccountId, datePreset = 'last_30d' } = {}) => {
  const { data } = await axios.get(`${BASE_URL}/adsgpt/meta-ads/get-analytics-data`, {
    params: { adAccountId, datePreset },
    headers: getAuthHeaders(),
  });
  return data;
};

export const getUserAdPostingInfo = async (userId) => {
  const { data } = await axios.get(`${BASE_URL}/adsgpt/ad-posting/users/${userId}`, {
    headers: getAuthHeaders(),
  });
  return data;
};

export const updateAdStatus = async (level,id,status) => {
  const { data } = await axios.patch(`${BASE_URL}/adsgpt/meta-ads/update-status`, { level,id, status }, {
    headers: getAuthHeaders(),
  });
  return data;
};
export const metaDisconnect = async (userId) => {
  const { data } = await axios.delete(`${BASE_URL}/adsgpt/ad-posting/users/${userId}`, {
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
export const getMetaPages = async (adAccountId) => {
  if (!adAccountId) throw new Error('getMetaPages: adAccountId is required');
  const { data } = await axios.get(`${BASE_URL}/adsgpt/meta-ads/get-pages`, {
    params: { adAccountId },
    headers: getAuthHeaders(),
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
export const getLeadForms = async (pageId) => {
  const { data } = await axios.get(
    `${BASE_URL}/adsgpt/meta-ads/get-lead-forms`,
    { params: { pageId }, headers: getAuthHeaders() },
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
// table. Returns { leads, fieldNames, count }. Needs the connected
// account to have granted the `leads_retrieval` scope.
export const getFormLeads = async ({ formId, pageId }) => {
  const { data } = await axios.get(
    `${BASE_URL}/adsgpt/meta-ads/get-form-leads`,
    { params: { formId, pageId }, headers: getAuthHeaders() },
  );
  return data;
};

// Download captured leads as a CSV (opens in Excel). Fetches the file as
// a blob with auth headers — a plain <a href> can't carry the
// Authorization header — then triggers a client-side download.
export const downloadFormLeadsCsv = async ({ formId, pageId, formName }) => {
  try {
    const res = await axios.get(
      `${BASE_URL}/adsgpt/meta-ads/export-form-leads`,
      {
        params: { formId, pageId, formName },
        headers: getAuthHeaders(),
        responseType: 'blob',
      },
    );
    const blob = new Blob([res.data], { type: 'text/csv;charset=utf-8' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safe = String(formName || 'leads').replace(/[^a-z0-9_-]+/gi, '-');
    a.download = `leads-${safe}.csv`;
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
  page = 1,
  limit = 24,
} = {}) => {
  if (!userId) throw new Error('getMediaLibrary: userId is required');
  const params = { page, limit };
  if (type) params.type = type;
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

export const createMetaAdSetV2 = async (payload) => {
  const { data } = await axios.post(
    `${BASE_URL}/adsgpt/meta-ads/v2/create-adset`,
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