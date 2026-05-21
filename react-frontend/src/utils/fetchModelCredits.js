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
