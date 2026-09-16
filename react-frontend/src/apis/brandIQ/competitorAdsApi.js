import axios from 'axios';
import getCookies from '@/utils/getCookies';

const BACKEND_HOST = import.meta.env.VITE_SOCKET_URL;

/**
 * Fetch competitor ads for a brand
 * @param {string} brandId - Brand ID
 * @param {Object} params - Query params
 * @param {string} [params.platform] - Comma-separated platform filters
 * @param {string} [params.category] - Category filter
 * @param {string} [params.dateFrom] - Date from (ISO)
 * @param {string} [params.dateTo] - Date to (ISO)
 * @param {number} [params.page=1] - Page number
 * @param {number} [params.pageSize=24] - Page size
 * @param {string} [params.sort='newest'] - Sort order
 * @param {string} [params.search] - Competitor or keyword search
 * @param {'competitor'|'keyword'} [params.searchType] - Search mode
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
 * Search competitor ads without using the selected Ad Studio brand as scope.
 * Uses the same filters and response shape as the brand competitor feed.
 */
export const searchCompetitorAds = async (params) => {
  const { data } = await axios.get(`${BACKEND_HOST}/adsgpt/brand/competitor-ads/search`, {
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
 */
export const refreshCompetitorAds = async (brandId) => {
  const { data } = await axios.post(
    `${BACKEND_HOST}/adsgpt/brand/${brandId}/competitor-ads/refresh`,
    {},
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getCookies()}`,
      },
    }
  );
  return data;
};
