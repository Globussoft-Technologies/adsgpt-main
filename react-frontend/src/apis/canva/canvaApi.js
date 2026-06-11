import axios from 'axios';
import getCookies from '@/utils/getCookies';

const BASE_URL = `${import.meta.env.VITE_SOCKET_URL}/adsgpt`;

const headers = () => ({
  Authorization: `Bearer ${getCookies()}`,
});

// POST /canva/v2/check-auth
// Returns { status: true } if already authed, or { status: false, state, codeChallenge } for new OAuth.
export const checkCanvaAuth = async (image_url) => {
  const { data } = await axios.post(
    `${BASE_URL}/canva/v2/check-auth`,
    { image_url },
    { headers: headers() },
  );
  return data;
};

// GET /canva/v2/status
// Returns { connected: true, display_name, email, avatar_url, connected_at } or { connected: false }
export const getCanvaStatus = async () => {
  const { data } = await axios.get(`${BASE_URL}/canva/v2/status`, { headers: headers() });
  return data;
};

// DELETE /canva/v2/disconnect
// Returns { success: true } on success
export const disconnectCanva = async () => {
  const { data } = await axios.delete(`${BASE_URL}/canva/v2/disconnect`, { headers: headers() });
  return data;
};
