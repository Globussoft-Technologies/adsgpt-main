import { formMediaUrl } from '@/utils/formatUrl';
import axios from 'axios';

const INSTAGRAM_API = import.meta.env.VITE_INSTAGRAM_ANALYTICS_API;
const INSTAGRAM_SECRET_KEY = import.meta.env.VITE_INSTAGRAM_SECRET_KEY;
const INSTAGRAM_USER_ID = import.meta.env.VITE_INSTAGRAM_USER_ID;
const MEDIA_URL = import.meta.env.VITE_NAS_BASE_URL;

const instagramAdDetails = async (ad_id) => {
  const payload = {
    ad_id,
    user_id: INSTAGRAM_USER_ID,
    language: 'en',
    secret_key: INSTAGRAM_SECRET_KEY,
  };

  try {
    const { status, data } = await axios.post(`${INSTAGRAM_API}/getAdDetails`, payload);
    if (status === 200) {
      const payload = data?.data?.[0];
      const popularity = payload?.popularity ? JSON.parse(payload?.popularity) : '';
      const postImage = formMediaUrl(payload?.image_video_url);
      const adType =
        payload?.type === 'STORIES'
          ? postImage.includes('pasvideos')
            ? 'VIDEO'
            : 'IMAGE'
          : payload?.type;
      return {
        id: payload?.id || '',
        network: 'instagram',
        postOwner: payload?.post_owner || '',
        postOwnerImage: payload?.post_owner_image || '',
        postImage,
        description: payload?.ad_text || '',
        newsfeedDescription: payload?.news_feed_description || '',
        adUrl: payload?.ad_url || '',
        category: '',
        adTitle: payload?.ad_title || '',
        adType,
        open_in_pas: '',
        popularityIndex: popularity || '',
        othermedia: payload?.ad_image_video || '',
        lastSeen: payload?.last_seen || '',
        onPlan: true,
        media_original: payload?.image_url_original || '',
        cta: payload?.call_to_action || '',
      };
    }
  } catch (error) {
    console.error('Error fetching Instagram ad details:', error);
  }
};

export default instagramAdDetails;
