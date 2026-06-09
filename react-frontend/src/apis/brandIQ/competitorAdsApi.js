import axios from 'axios';
import getCookies from '@/utils/getCookies';

const BACKEND_HOST = import.meta.env.VITE_SOCKET_URL;

/**
 * Fetch competitor ads for a brand
 * @param {string} brandId - Brand ID
 * @param {Object} params - Query params
 * @param {string} params.userId - User ID
 * @param {string} [params.platform] - Platform filter
 * @param {string} [params.category] - Category filter
 * @param {string} [params.dateFrom] - Date from (ISO)
 * @param {string} [params.dateTo] - Date to (ISO)
 * @param {number} [params.page=1] - Page number
 * @param {number} [params.pageSize=24] - Page size
 * @param {string} [params.sort='newest'] - Sort order
 */
export const getCompetitorAds = async (brandId, params) => {
  const { data } = await axios.get(`${BACKEND_HOST}/adsgpt/brand/${brandId}/competitor-ads`, {
    params,
    headers: {
      Authorization: `Bearer ${getCookies()}`,
    },
  });
  return data;
};

/**
 * Refresh competitor ads discovery
 * @param {string} brandId - Brand ID
 * @param {string} userId - User ID
 */
export const refreshCompetitorAds = async (brandId, userId) => {
  const { data } = await axios.post(
    `${BACKEND_HOST}/adsgpt/brand/${brandId}/competitor-ads/refresh`,
    { userId },
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getCookies()}`,
      },
    }
  );
  return data;
};
