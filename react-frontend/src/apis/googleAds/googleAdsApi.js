import axios from 'axios';
import getCookies from '@/utils/getCookies';

const BASE_URL = import.meta.env.VITE_SOCKET_URL;

const authHeaders = () => ({ Authorization: `Bearer ${getCookies()}` });

export const getGoogleAdAccounts = async () => {
  const { data } = await axios.get(`${BASE_URL}/adsgpt/google-ads/get-ad-accounts`, {
    headers: authHeaders(),
  });
  return data;
};

// adType: 'text' | 'image' | 'video' | string[] | undefined (all)
// group: 'ads' | 'assets' | string[] | undefined — defaults to BOTH so this
// general campaigns list includes PERFORMANCE_MAX (asset-group) campaigns
// alongside regular ad-group campaigns. The backend itself defaults to
// "ads" only when group is omitted entirely, so callers that want the full
// list (like the Campaigns table) must pass both explicitly.
export const getGoogleCampaigns = async (adAccountId, { refresh = false, adType, group = ['ads', 'assets'] } = {}) => {
  const adTypes = adType ? (Array.isArray(adType) ? adType : [adType]) : [];
  const groups = group ? (Array.isArray(group) ? group : [group]) : [];
  const { data } = await axios.get(`${BASE_URL}/adsgpt/google-ads/get-campaigns`, {
    params: {
      adAccountId,
      ...(refresh ? { refresh: 'true', _t: Date.now() } : {}),
      ...(adTypes.length ? { adType: adTypes } : {}),
      ...(groups.length ? { group: groups } : {}),
    },
    paramsSerializer: (p) => {
      const parts = [];
      Object.entries(p).forEach(([k, v]) => {
        if (Array.isArray(v)) v.forEach(i => parts.push(`${k}=${encodeURIComponent(i)}`));
        else parts.push(`${k}=${encodeURIComponent(v)}`);
      });
      return parts.join('&');
    },
    headers: authHeaders(),
  });
  return data;
};

/** Normalize campaign list from get-campaigns API (supports legacy `data[]` shape). */
export const parseGoogleCampaignsResponse = (res) => {
  if (!res) return [];
  if (Array.isArray(res.campaigns)) return res.campaigns;
  if (Array.isArray(res.data)) return res.data.flatMap((d) => d.campaigns || []);
  return [];
};

export const getGoogleAnalyticsData = async ({ adAccountId, datePreset = 'last_30d', refresh = false } = {}) => {
  const { data } = await axios.get(`${BASE_URL}/adsgpt/google-ads/get-analytics-data`, {
    params: { adAccountId, datePreset, ...(refresh ? { refresh: 'true', _t: Date.now() } : {}) },
    headers: authHeaders(),
  });
  return data;
};

export const getGoogleDashboardData = async ({ adAccountId, datePreset = 'last_7d' } = {}) => {
  const { data } = await axios.get(`${BASE_URL}/adsgpt/google-ads/get-dashboard-data`, {
    params: { adAccountId, datePreset },
    headers: authHeaders(),
  });
  return data;
};

export const runGoogleAudit = async ({ adAccountId } = {}) => {
  const { data } = await axios.get(`${BASE_URL}/adsgpt/google-ads/audit`, {
    params: { adAccountId },
    headers: authHeaders(),
  });
  return data;
};

export const updateGoogleAdStatus = async ({ level, id, adAccountId, adGroupId, status, entityType, isPmax }) => {
  const { data } = await axios.patch(
    `${BASE_URL}/adsgpt/google-ads/update-status`,
    { level, id, adAccountId, adGroupId, status, entityType, isPmax },
    { headers: authHeaders() },
  );
  return data;
};

export const disconnectGoogleAccount = async (userId) => {
  const { data } = await axios.delete(`${BASE_URL}/adsgpt/google-ads/users/${userId}`, {
    headers: authHeaders(),
  });
  return data;
};

// Alias used by Profile UI to disconnect the connected Google account.
export const googleDisconnect = disconnectGoogleAccount;

export const checkGoogleAccount = async () => {
  const { data } = await axios.get(`${BASE_URL}/adsgpt/google-ads/check-account`, {
    headers: authHeaders(),
  });
  return data;
};

// Fetch the connected Google user for a given app user id (null when not connected).
export const getGoogleUser = async (userId) => {
  const { data } = await axios.get(`${BASE_URL}/adsgpt/google-ads/users/${userId}`, {
    headers: authHeaders(),
  });
  return data;
};

export const getGoogleWizardSchema = async () => {
  const { data } = await axios.get(`${BASE_URL}/adsgpt/google-ads/wizard-schema`, {
    headers: authHeaders(),
  });
  return data;
};

export const getGoogleCtaOptions = async (objective) => {
  const { data } = await axios.get(`${BASE_URL}/adsgpt/google-ads/cta-options`, {
    params: { objective },
    headers: authHeaders(),
  });
  return data;
};

export const getGoogleAdGroups = async ({ adAccountId, campaignId, channelType, refresh = false }) => {
  const { data } = await axios.get(`${BASE_URL}/adsgpt/google-ads/get-ad-groups`, {
    params: { adAccountId, campaignId, ...(channelType ? { channelType } : {}), ...(refresh ? { refresh: 'true', _t: Date.now() } : {}) },
    headers: { ...authHeaders(), 'Cache-Control': 'no-cache' },
  });
  return data;
};

export const getGoogleCampaignAds = async ({ adAccountId, campaignId }) => {
  const { data } = await axios.get(`${BASE_URL}/adsgpt/google-ads/get-campaign-ads`, {
    params: { adAccountId, campaignId, _t: Date.now() },
    headers: { ...authHeaders(), 'Cache-Control': 'no-cache' },
  });
  return data;
};

export const getGoogleAdGroupAds = async ({ adAccountId, adGroupId, refresh = false }) => {
  const { data } = await axios.get(`${BASE_URL}/adsgpt/google-ads/get-ad-group-ads`, {
    params: { adAccountId, adGroupId, ...(refresh ? { refresh: 'true', _t: Date.now() } : {}) },
    headers: { ...authHeaders(), 'Cache-Control': 'no-cache' },
  });
  return data;
};

export const getGoogleAd = async (adId, adAccountId) => {
  const { data } = await axios.get(`${BASE_URL}/adsgpt/google-ads/ads/${adId}`, {
    params: { adAccountId },
    headers: authHeaders(),
  });
  return data;
};

export const resolveGoogleAdForEdit = async ({ adId, adAccountId }) => {
  const { data } = await axios.get(`${BASE_URL}/adsgpt/google-ads/resolve-ad`, {
    params: { adId, adAccountId },
    headers: authHeaders(),
  });
  return data;
};

export const createGoogleCampaign = async (body) => {
  const { data } = await axios.post(`${BASE_URL}/adsgpt/google-ads/create-campaign`, body, {
    headers: authHeaders(),
  });
  return data;
};

export const updateGoogleCampaign = async (body) => {
  const { data } = await axios.patch(`${BASE_URL}/adsgpt/google-ads/update-campaign`, body, {
    headers: authHeaders(),
  });
  return data;
};

export const createGoogleAdGroup = async (body) => {
  const { data } = await axios.post(`${BASE_URL}/adsgpt/google-ads/create-ad-group`, body, {
    headers: authHeaders(),
  });
  return data;
};

export const updateGoogleAdGroup = async (body) => {
  const { data } = await axios.patch(`${BASE_URL}/adsgpt/google-ads/update-ad-group`, body, {
    headers: authHeaders(),
  });
  return data;
};

export const uploadGoogleImage = async ({ adAccountId, imageUrl, imageFile }) => {
  if (imageFile) {
    const form = new FormData();
    form.append('adAccountId', adAccountId);
    form.append('image', imageFile);
    const { data } = await axios.post(`${BASE_URL}/adsgpt/google-ads/upload-image`, form, {
      headers: authHeaders(), // no Content-Type override — let axios set multipart boundary automatically
    });
    return data;
  }
  const { data } = await axios.post(
    `${BASE_URL}/adsgpt/google-ads/upload-image`,
    { adAccountId, imageUrl },
    { headers: authHeaders() },
  );
  return data;
};

export const uploadGoogleVideo = async ({ adAccountId, videoFile }) => {
  const form = new FormData();
  form.append('adAccountId', adAccountId);
  form.append('video', videoFile);
  const { data } = await axios.post(`${BASE_URL}/adsgpt/google-ads/upload-video`, form, {
    headers: authHeaders(), // no Content-Type override — let axios set multipart boundary automatically
  });
  return data;
};

export const createGoogleAd = async (body) => {
  const { data } = await axios.post(`${BASE_URL}/adsgpt/google-ads/ads`, body, {
    headers: authHeaders(),
  });
  return data;
};

export const updateGoogleAd = async (body) => {
  const { data } = await axios.patch(`${BASE_URL}/adsgpt/google-ads/ads`, body, {
    headers: authHeaders(),
  });
  return data;
};

export const deleteGoogleAd = async ({ adAccountId, adGroupId, adId }) => {
  const { data } = await axios.delete(`${BASE_URL}/adsgpt/google-ads/ads/${adId}`, {
    data: { adAccountId, adGroupId },
    headers: authHeaders(),
  });
  return data;
};

export const addAssetToAssetGroup = async (body) => {
  const { data } = await axios.post(`${BASE_URL}/adsgpt/google-ads/asset-group-asset`, body, { headers: authHeaders() });
  return data;
};

export const removeAssetFromAssetGroup = async (body) => {
  const { data } = await axios.delete(`${BASE_URL}/adsgpt/google-ads/asset-group-asset`, {
    data: body,
    headers: authHeaders(),
  });
  return data;
};

export const deleteGoogleAdGroup = async ({ adAccountId, adGroupId, campaignId, isPmax }) => {
  const { data } = await axios.delete(`${BASE_URL}/adsgpt/google-ads/delete-ad-group`, {
    data: { adAccountId, adGroupId, campaignId, isPmax },
    headers: authHeaders(),
  });
  return data;
};

export const deleteGoogleCampaign = async ({ adAccountId, campaignId }) => {
  const { data } = await axios.delete(`${BASE_URL}/adsgpt/google-ads/delete-campaign`, {
    data: { adAccountId, campaignId },
    headers: authHeaders(),
  });
  return data;
};

// ─── Campaign Templates ────────────────────────────────────────────────────────

// group defaults to BOTH so the template picker includes PERFORMANCE_MAX
// (asset-group) templates alongside regular ad-group templates — the
// backend itself defaults to "ads" only when group is omitted entirely.
export const listGoogleCampaignTemplates = async ({ group = ['ads', 'assets'] } = {}) => {
  const groups = group ? (Array.isArray(group) ? group : [group]) : [];
  const { data } = await axios.get(`${BASE_URL}/adsgpt/google-ads/templates`, {
    params: groups.length ? { group: groups } : undefined,
    paramsSerializer: (p) => {
      const parts = [];
      Object.entries(p || {}).forEach(([k, v]) => {
        if (Array.isArray(v)) v.forEach((i) => parts.push(`${k}=${encodeURIComponent(i)}`));
        else parts.push(`${k}=${encodeURIComponent(v)}`);
      });
      return parts.join('&');
    },
    headers: authHeaders(),
  });
  return data;
};

export const getGoogleCampaignTemplate = async (id) => {
  const { data } = await axios.get(`${BASE_URL}/adsgpt/google-ads/templates/${id}`, {
    headers: authHeaders(),
  });
  return data;
};

export const saveGoogleCampaignTemplate = async ({ name, payload, objective, destination }) => {
  const { data } = await axios.post(
    `${BASE_URL}/adsgpt/google-ads/templates`,
    { name, payload, objective, conversionLocation: destination },
    { headers: authHeaders() },
  );
  return data;
};

export const deleteGoogleCampaignTemplate = async (id) => {
  const { data } = await axios.delete(`${BASE_URL}/adsgpt/google-ads/templates/${id}`, {
    headers: authHeaders(),
  });
  return data;
};
