import axios from 'axios';
import getCookies from '@/utils/getCookies';

const BASE_URL = import.meta.env.VITE_SOCKET_URL;

const getAuthHeaders = () => ({
  Authorization: `Bearer ${getCookies()}`,
});

export const checkTiktokAccount = async () => {
  const { data } = await axios.get(`${BASE_URL}/adsgpt/tiktok-ads/check-account`, {
    headers: getAuthHeaders(),
  });
  return data;
};

export const getTiktokAdAccounts = async ({ refresh = false } = {}) => {
  const { data } = await axios.get(`${BASE_URL}/adsgpt/tiktok-ads/get-ad-accounts`, {
    params: refresh ? { refresh: 'true' } : undefined,
    headers: getAuthHeaders(),
  });
  return data;
};

export const getTiktokCampaigns = async (advertiserId) => {
  const { data } = await axios.get(`${BASE_URL}/adsgpt/tiktok-ads/get-campaigns`, {
    params: { advertiserId },
    headers: getAuthHeaders(),
  });
  return data;
};

export const getTiktokAdGroups = async (advertiserId, campaignId) => {
  const { data } = await axios.get(`${BASE_URL}/adsgpt/tiktok-ads/get-ad-groups`, {
    params: { advertiserId, campaignId },
    headers: getAuthHeaders(),
  });
  return data;
};

export const getTiktokAds = async (advertiserId, adgroupId) => {
  const { data } = await axios.get(`${BASE_URL}/adsgpt/tiktok-ads/get-ads`, {
    params: { advertiserId, adgroupId },
    headers: getAuthHeaders(),
  });
  return data;
};

export const getTiktokAdGroupReviewInfo = async (advertiserId, adgroupIds) => {
  const { data } = await axios.get(`${BASE_URL}/adsgpt/tiktok-ads/adgroup-review-info`, {
    params: { advertiserId, adgroupIds: Array.isArray(adgroupIds) ? adgroupIds.join(',') : adgroupIds },
    headers: getAuthHeaders(),
  });
  return data;
};

export const getTiktokAdReviewInfo = async (advertiserId, adIds) => {
  const { data } = await axios.get(`${BASE_URL}/adsgpt/tiktok-ads/ad-review-info`, {
    params: { advertiserId, adIds: Array.isArray(adIds) ? adIds.join(',') : adIds },
    headers: getAuthHeaders(),
  });
  return data;
};

export const appealTiktokAdGroup = async ({ advertiserId, adgroupId, adId, appealReason, attachmentList }) => {
  const { data } = await axios.post(
    `${BASE_URL}/adsgpt/tiktok-ads/adgroup-appeal`,
    { advertiserId, adgroupId, adId, appealReason, attachmentList },
    { headers: getAuthHeaders() }
  );
  return data;
};

export const disconnectTiktokUser = async (userId) => {
  const { data } = await axios.delete(`${BASE_URL}/adsgpt/tiktok-ads/users/${userId}`, {
    headers: getAuthHeaders(),
  });
  return data;
};

// ─── Reporting ────────────────────────────────────────────────────────────────

export const getTiktokInsights = async ({
  advertiserId,
  level = 'campaign',
  startDate,
  endDate,
  lifetime,
  page,
  pageSize,
} = {}) => {
  const { data } = await axios.get(`${BASE_URL}/adsgpt/tiktok-ads/get-insights`, {
    params: { advertiserId, level, startDate, endDate, lifetime, page, pageSize },
    headers: getAuthHeaders(),
  });
  return data;
};

export const getTiktokDashboardData = async ({ advertiserId, startDate, endDate, lifetime } = {}) => {
  const { data } = await axios.get(`${BASE_URL}/adsgpt/tiktok-ads/get-dashboard-data`, {
    params: { advertiserId, startDate, endDate, lifetime },
    headers: getAuthHeaders(),
  });
  return data;
};

// ─── Wizard config + pickers ────────────────────────────────────────────────────

export const getTiktokWizardSchema = async () => {
  const { data } = await axios.get(`${BASE_URL}/adsgpt/tiktok-ads/wizard-schema`, {
    headers: getAuthHeaders(),
  });
  return data;
};

export const getTiktokIdentities = async (advertiserId) => {
  const { data } = await axios.get(`${BASE_URL}/adsgpt/tiktok-ads/get-identities`, {
    params: { advertiserId },
    headers: getAuthHeaders(),
  });
  return data;
};

export const getTiktokRegions = async (advertiserId, placement, objectiveType = 'TRAFFIC') => {
  const { data } = await axios.get(`${BASE_URL}/adsgpt/tiktok-ads/get-regions`, {
    params: { advertiserId, placement, objectiveType },
    headers: getAuthHeaders(),
  });
  return data;
};

export const getTiktokInterestCategories = async (advertiserId, placement, objectiveType = 'TRAFFIC') => {
  const { data } = await axios.get(`${BASE_URL}/adsgpt/tiktok-ads/get-interest-categories`, {
    params: { advertiserId, placement, objectiveType },
    headers: getAuthHeaders(),
  });
  return data;
};

export const getTiktokVideoInfo = async (advertiserId, videoIds) => {
  const { data } = await axios.get(`${BASE_URL}/adsgpt/tiktok-ads/get-video-info`, {
    params: {
      advertiserId,
      videoIds: Array.isArray(videoIds) ? videoIds.join(',') : videoIds,
    },
    headers: getAuthHeaders(),
  });
  return data;
};

// ─── Pixel (conversion tracking) ────────────────────────────────────────────────

export const getTiktokPixels = async (advertiserId) => {
  const { data } = await axios.get(`${BASE_URL}/adsgpt/tiktok-ads/pixels`, {
    params: { advertiserId },
    headers: getAuthHeaders(),
  });
  return data;
};

export const createTiktokPixel = async ({ advertiserId, name, pixelType = 'TT_WEB_PIXEL' }) => {
  const { data } = await axios.post(
    `${BASE_URL}/adsgpt/tiktok-ads/pixels`,
    { advertiserId, name, pixelType },
    { headers: getAuthHeaders() },
  );
  return data;
};

// ─── Lead Generation ────────────────────────────────────────────────────────────

export const getTiktokLeadForms = async (advertiserId, pageId) => {
  const { data } = await axios.get(`${BASE_URL}/adsgpt/tiktok-ads/lead-forms`, {
    params: { advertiserId, ...(pageId ? { pageId } : {}) },
    headers: getAuthHeaders(),
  });
  return data;
};

export const getTiktokLeads = async ({
  advertiserId,
  pageId,
  leadSource = 'INSTANT_FORM',
  startTime,
  endTime,
  page = 1,
  pageSize = 100,
} = {}) => {
  const { data } = await axios.get(`${BASE_URL}/adsgpt/tiktok-ads/leads`, {
    params: { advertiserId, pageId, leadSource, startTime, endTime, page, pageSize },
    headers: getAuthHeaders(),
  });
  return data;
};

// ─── Mutations ──────────────────────────────────────────────────────────────────

export const updateTiktokStatus = async ({ advertiserId, level, ids, status }) => {
  const { data } = await axios.post(
    `${BASE_URL}/adsgpt/tiktok-ads/update-status`,
    { advertiserId, level, ids, status },
    { headers: getAuthHeaders() },
  );
  return data;
};

export const createTiktokCampaign = async (payload) => {
  const { data } = await axios.post(
    `${BASE_URL}/adsgpt/tiktok-ads/create-campaign`,
    payload,
    { headers: getAuthHeaders() },
  );
  return data;
};

export const createTiktokAdGroup = async (payload) => {
  const { data } = await axios.post(
    `${BASE_URL}/adsgpt/tiktok-ads/create-ad-group`,
    payload,
    { headers: getAuthHeaders() },
  );
  return data;
};

export const createTiktokAd = async (payload) => {
  const { data } = await axios.post(
    `${BASE_URL}/adsgpt/tiktok-ads/create-ad`,
    payload,
    { headers: getAuthHeaders() },
  );
  return data;
};

export const updateTiktokCampaign = async (payload) => {
  const { data } = await axios.post(
    `${BASE_URL}/adsgpt/tiktok-ads/update-campaign`,
    payload,
    { headers: getAuthHeaders() },
  );
  return data;
};

export const updateTiktokAdGroup = async (payload) => {
  const { data } = await axios.post(
    `${BASE_URL}/adsgpt/tiktok-ads/update-ad-group`,
    payload,
    { headers: getAuthHeaders() },
  );
  return data;
};

export const updateTiktokAd = async (payload) => {
  const { data } = await axios.post(
    `${BASE_URL}/adsgpt/tiktok-ads/update-ad`,
    payload,
    { headers: getAuthHeaders() },
  );
  return data;
};

/**
 * Upload an image creative (cover / carousel). Pass either a File (`file`)
 * or an `imageUrl`. Returns { images: [{ imageId, ... }] }.
 */
export const uploadTiktokImage = async ({ advertiserId, file, imageUrl }) => {
  const formData = new FormData();
  formData.append('advertiserId', advertiserId);
  if (file) formData.append('image', file);
  if (imageUrl) formData.append('imageUrl', imageUrl);

  const { data } = await axios.post(
    `${BASE_URL}/adsgpt/tiktok-ads/upload-image`,
    formData,
    { headers: { ...getAuthHeaders(), 'Content-Type': 'multipart/form-data' } },
  );
  return data;
};

/**
 * Upload a video creative. Pass either a File (`file`) for a direct upload,
 * or a `videoUrl` for an upload-by-URL. Returns { videos: [{ videoId, ... }] }.
 */
export const uploadTiktokVideo = async ({ advertiserId, file, videoUrl }) => {
  const formData = new FormData();
  formData.append('advertiserId', advertiserId);
  if (file) formData.append('video', file);
  if (videoUrl) formData.append('videoUrl', videoUrl);

  const { data } = await axios.post(
    `${BASE_URL}/adsgpt/tiktok-ads/upload-video`,
    formData,
    { headers: { ...getAuthHeaders(), 'Content-Type': 'multipart/form-data' } },
  );
  return data;
};

// ─── Campaign Templates ─────────────────────────────────────────────────────
// Saved snapshots of the wizard `form` state. Per-user. Used to stamp out new
// campaigns from a known-good setup (budget / account / name editable on apply).

export const listTiktokCampaignTemplates = async () => {
  const { data } = await axios.get(`${BASE_URL}/adsgpt/tiktok-ads/templates`, {
    headers: getAuthHeaders(),
  });
  return data;
};

export const getTiktokCampaignTemplate = async (id) => {
  const { data } = await axios.get(`${BASE_URL}/adsgpt/tiktok-ads/templates/${id}`, {
    headers: getAuthHeaders(),
  });
  return data;
};

export const saveTiktokCampaignTemplate = async ({ name, payload, objective, conversionLocation } = {}) => {
  const { data } = await axios.post(
    `${BASE_URL}/adsgpt/tiktok-ads/templates`,
    { name, payload, objective, conversionLocation },
    { headers: getAuthHeaders() },
  );
  return data;
};

export const deleteTiktokCampaignTemplate = async (id) => {
  const { data } = await axios.delete(`${BASE_URL}/adsgpt/tiktok-ads/templates/${id}`, {
    headers: getAuthHeaders(),
  });
  return data;
};
