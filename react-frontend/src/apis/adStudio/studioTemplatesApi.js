import axios from 'axios';
import getCookies from '@/utils/getCookies';

const BACKEND_HOST = import.meta.env.VITE_SOCKET_URL;

// DS video matching often takes the full 30s upstream and Node allows 45s, so
// give the browser a little more than that before giving up.
const REQUEST_TIMEOUT_MS = 50_000;

/**
 * Brand-matched DS templates for the Ad Creative / Ad Video home galleries.
 * Backend: GET /adsgpt/ad-studio/templates (services/adStudio/studioTemplates.js).
 *
 * @param {Object} params
 * @param {string} params.brandId
 * @param {'image'|'video'} params.media
 * @param {boolean} [params.refresh] - bypass the server's 10-minute cache
 * @param {number} [params.skip] - video infinite scroll: how many are already loaded
 * @returns {Promise<{items: Array<{template_id, kind, url, tags, rank}>, cached: boolean, fetchedAt: number, hasMore: boolean, nextSkip: number|null}>}
 */
export const getStudioTemplates = async ({ brandId, media, refresh = false, skip = 0 }) => {
  const { data } = await axios.get(`${BACKEND_HOST}/adsgpt/ad-studio/templates`, {
    params: { brandId, media, ...(refresh ? { refresh: 1 } : {}), ...(skip ? { skip } : {}) },
    headers: { Authorization: `Bearer ${getCookies()}` },
    timeout: REQUEST_TIMEOUT_MS,
  });
  return data;
};

/**
 * "Recreate this ad" from an image template (ImageTemplateModal → Generate).
 * Backend: POST /adsgpt/ad-studio/templates/generate (services/adStudio/studioImageRender.js),
 * which renders like onboarding's Recreate — no model/ratio sent — and charges
 * Nano Banana 2 at the medium tier.
 *
 * @param {Object} body
 * @param {string} body.brandId - header-selected brand; its description is sent to DS
 * @param {string} body.templateId - the DS image template id (sha256)
 * @param {string} body.templateUrl - the template's image URL (kept on the My Space record)
 * @param {string[]} body.productImageUrls - 1..3 public URLs (upload files to S3 first)
 * @param {string} [body.prompt]
 * @returns {Promise<{success: boolean, data: object}>} data = the pending ImageGeneration record
 */
export const generateStudioTemplateImage = async (body) => {
  const { data } = await axios.post(`${BACKEND_HOST}/adsgpt/ad-studio/templates/generate`, body, {
    headers: { Authorization: `Bearer ${getCookies()}` },
    timeout: 60_000,
  });
  return data;
};

/**
 * What one template render costs, in credits — the same number the server
 * charges (studioImageRender.renderPrice: Nano Banana 2 at the medium tier,
 * from the model config). Shown on the modal's Generate button.
 * Backend: GET /adsgpt/ad-studio/templates/render-price → { credits }
 * @returns {Promise<number|null>}
 */
export const getStudioRenderPrice = async () => {
  const { data } = await axios.get(`${BACKEND_HOST}/adsgpt/ad-studio/templates/render-price`, {
    headers: { Authorization: `Bearer ${getCookies()}` },
    timeout: 15_000,
  });
  const credits = Number(data?.credits);
  return Number.isFinite(credits) && credits > 0 ? credits : null;
};
