import axios from 'axios';
import getCookies from '@/utils/getCookies';

// ----------------------------------------------------------------------------
// fetchAdCreativeConfig — GET /adsgpt/usage/model-credit-value?media=ad_creative&type=image
//
// Returns the AdCreative image models the backend exposes for the `ad_creative`
// surface, each enriched with aspectRatios, icon, qualities, and per-quality
// credit tiers. We normalise the raw surface rows into a flat, picker-friendly
// shape so consumers don't have to know the endpoint's wire format.
//
// Throws on failure — the thunk that calls this rejects, and the hook applies
// its hardcoded FALLBACK so the UI always renders.
// ----------------------------------------------------------------------------

const BACKEND_HOST = import.meta.env.VITE_SOCKET_URL;

const normalizeModels = (rows) =>
  (Array.isArray(rows) ? rows : []).map((r) => ({
    apiId: r.canonical,
    label: r.label,
    icon: r.icon || null,
    aspectRatios: Array.isArray(r.aspectRatios) ? r.aspectRatios : [],
    qualities: Array.isArray(r.qualities) ? r.qualities : [],
    // { low: 1, medium: 2, high: 3, ... } — credits only (no USD).
    creditsByQuality: (r.qualityTiers || []).reduce((acc, t) => {
      acc[t.quality] = t.creditsPerImage;
      return acc;
    }, {}),
    creditsPerImage: r.creditsPerImage,
  }));

export const fetchAdCreativeConfig = async () => {
  const token = getCookies();
  const res = await axios.get(`${BACKEND_HOST}/adsgpt/usage/model-credit-value`, {
    params: { media: 'ad_creative', type: 'image' },
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.data?.success) throw new Error('Ad creative config request failed');
  return normalizeModels(res.data.data?.imageModels || []);
};
