// API client for the "AdFactory images" MySpace view.
//
// Endpoint:
//   GET /adsgpt/campaign/images/:userId — all successful AdFactory images
//     (manual + automatic), plus in-progress placeholders and errored
//     entries. Supports skip/limit pagination and an optional dd-MM-yyyy
//     date range.
//
// Auth follows the project convention: Bearer ${getCookies()} from the
// `access-token` cookie.

import axios from 'axios';
import getCookies from '@/utils/getCookies';

const BASE_URL = `${import.meta.env.VITE_SOCKET_URL}/adsgpt`;

const headers = () => ({
  Authorization: `Bearer ${getCookies()}`,
});

// undefined params are dropped from the query string by axios automatically.
export const getAdFactoryImages = async ({
  userId,
  skip = 0,
  limit = 10,
  startDate,
  endDate,
} = {}) => {
  const { data } = await axios.get(
    `${BASE_URL}/campaign/images/${encodeURIComponent(userId)}`,
    {
      params: { skip, limit, startDate, endDate },
      headers: headers(),
    },
  );
  return data;
};
