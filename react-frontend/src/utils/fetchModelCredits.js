import axios from 'axios';
import getCookies from '@/utils/getCookies';

const BACKEND_HOST = import.meta.env.VITE_SOCKET_URL;

export const fetchModelCredits = async () => {
  try {
    const token = getCookies();

    const response = await axios.get(`${BACKEND_HOST}/adsgpt/usage/model-credit-value`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (response.data.success) {
      return {
        imageModels: response.data.data.imageModels || [],
        videoModels: response.data.data.videoModels || [],
      };
    }

    return { imageModels: [], videoModels: [] };
  } catch (error) {
    console.error('Error fetching model credits:', error);
    return { imageModels: [], videoModels: [] };
  }
};

/**
 * Fetches the AdCreative image surface, which enriches each image model with
 * per-quality credit tiers (`qualityTiers: [{ quality, creditsPerImage }]`).
 * Used by the Account credits card to show a tiered breakdown per image model
 * instead of a single flat credit value. Returns [] on failure so callers can
 * fall back to the flat `fetchModelCredits().imageModels`.
 */
export const fetchAdCreativeImageTiers = async () => {
  try {
    const token = getCookies();

    const response = await axios.get(`${BACKEND_HOST}/adsgpt/usage/model-credit-value`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      params: { media: 'ad_creative', type: 'image' },
    });

    if (response.data.success) {
      return response.data.data.imageModels || [];
    }

    return [];
  } catch (error) {
    console.error('Error fetching AdCreative image tiers:', error);
    return [];
  }
};

export const fetchAiAdsVideoModels = async () => {
  const token = getCookies();
  const response = await axios.get(`${BACKEND_HOST}/adsgpt/usage/model-credit-value`, {
    params: { media: 'ai_ads', type: 'video' },
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.data?.success) throw new Error('AI Ads model config request failed');
  return response.data.data?.videoModels || [];
};

// Clone pricing includes the model rate plus the DB extraCharges entry whose
// type is "clone".
export const fetchCloneVideoModels = async () => {
  const token = getCookies();
  const response = await axios.get(`${BACKEND_HOST}/adsgpt/usage/model-credit-value`, {
    params: { media: 'clone', type: 'video' },
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.data?.success) throw new Error('Clone model config request failed');
  return response.data.data?.videoModels || [];
};
