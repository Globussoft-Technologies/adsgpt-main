import { formMediaUrl } from '@/utils/formatUrl';
import axios from 'axios';

const REDDIT_API = import.meta.env.VITE_REDDIT_ANALYTICS_API;
const REDDIT_SECRET_KEY = import.meta.env.VITE_REDDIT_SECRET_KEY;
const REDDIT_USER_ID = import.meta.env.VITE_REDDIT_USER_ID;
const MEDIA_URL = import.meta.env.VITE_NAS_BASE_URL;
const redditAdDetails = async (ad_id) => {
  console.log(ad_id, 'ad_id');
  const payload = {
    ad_id,
    user_id: REDDIT_USER_ID,
    language: 'en',
    secret_key: REDDIT_SECRET_KEY,
  };

  try {
    const { status, data } = await axios.post(`${REDDIT_API}/getAdDetails`, payload);
    console.log(data, 'data');
    if (status === 200) {
      const payload = data?.data?.[0];
      console.log(payload, 'payload');
      const popularity = payload?.popularity ? JSON.parse(payload?.popularity) : '';
      return {
        id: payload?.ad_id || '',
        network: 'reddit',
        postOwner: payload?.post_owner || '',
        postOwnerImage: payload?.post_owner_image || '',
        postImage: formMediaUrl(payload?.image_url),
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
    console.error('Error fetching REDDIT ad details:', error);
  }
};

export default redditAdDetails;
