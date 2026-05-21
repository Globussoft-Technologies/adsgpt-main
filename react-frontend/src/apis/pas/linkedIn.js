import { formMediaUrl } from '@/utils/formatUrl';
import axios from 'axios';

const LINKEDIN_API = import.meta.env.VITE_LINKEDIN_ANALYTICS_API;
const LINKEDIN_SECRET_KEY = import.meta.env.VITE_LINKEDIN_SECRET_KEY;
const LINKEDIN_USER_ID = import.meta.env.VITE_LINKEDIN_USER_ID;
const MEDIA_URL = import.meta.env.VITE_NAS_BASE_URL;
const linkedInAdDetails = async (ad_id) => {
  const payload = {
    ad_id,
    user_id: LINKEDIN_USER_ID,
    language: 'en',
    secret_key: LINKEDIN_SECRET_KEY,
  };

  try {
    const { status, data } = await axios.post(`${LINKEDIN_API}/getAdDetails`, payload);
    if (status === 200) {
      const payload = data?.data?.[0];
      const popularity = payload?.popularity ? JSON.parse(payload?.popularity) : '';
      return {
        id: payload?.ad_id || '',
        network: 'linkedin',
        postOwner: payload?.post_owner || '',
        postOwnerImage: payload?.post_owner_image || '',
        postImage: formMediaUrl(payload?.image_video_url),
        description: payload?.ad_text || '',
        newsfeedDescription: payload?.news_feed_description || '',
        adUrl: payload?.ad_url || '',
        category: '',
        adTitle: payload?.ad_title || '',
        adType: payload?.type || '',
        open_in_pas: '',
        popularityIndex: popularity?.max || '',
        othermedia: payload?.ad_image_video || '',
        lastSeen: payload?.last_seen || '',
        onPlan: true,
        media_original: payload?.image_url_original || '',
        cta: payload?.call_to_action || '',
      };
    }
  } catch (error) {
    console.error('Error fetching linkedin ad details:', error);
  }
};

export default linkedInAdDetails;
