import axios from 'axios';
import getCookies from '@/utils/getCookies';
import Cookies from 'js-cookie';

const BASE_URL = `${import.meta.env.VITE_SOCKET_URL}/adsgpt/analytics`;

const headers = () => ({ Authorization: `Bearer ${getCookies()}` });

export const trackEvent = async (payload) => {
  try {
    const enriched = {
      ...payload,
      user_name: Cookies.get('user_name') || null,
      user_email: Cookies.get('user_email') || null,
    };
    await axios.post(`${BASE_URL}/event`, enriched, { headers: headers() });
  } catch {
    // silently fail — tracking must never break the app
  }
};
