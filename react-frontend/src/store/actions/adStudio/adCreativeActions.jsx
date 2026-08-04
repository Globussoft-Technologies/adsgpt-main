import { getSocket } from '@/store/reducers/socket/socketSlice';
import getCookies from '@/utils/getCookies';
import { nanoid } from 'nanoid';
import { fetchAdHistoryTitles, saveHistory } from './adHistoryActions';
import {
  addConversation,
  markBotMessageFailed,
  registerTimeout,
  resetAdCreativeSlice,
  setIsSending,
  setTimer,
} from '@/store/reducers/adStudio/adCreativeSlice';
import { resetAdCopySlice, setLoading } from '@/store/reducers/adStudio/adCopySlice';
import { removeImage, resetPromptSlice, setField } from '@/store/reducers/adStudio/promptSlice';
import axios from 'axios';
import { createAsyncThunk } from '@reduxjs/toolkit';
import { resetEditorSlice } from '@/store/reducers/adStudio/editorSlice';
import { createNewSession } from '@/store/reducers/adStudio/adHistorySlice';
import { resetAdVideoSlice } from '@/store/reducers/adStudio/adVideoSlice';
import { fetchSuggestions } from './adCopyActions';
import { emitWhenConnected } from '@/utils/socketEmitter';
import { startGlobalInteractionTracking } from '@/utils/userInteractionTracker';
import { resetAdVideoNewSlice } from '@/store/reducers/adStudio/adVideoNewSlice';
import { setActiveAdStudioTab } from '@/store/reducers/adStudio/adStudioTabsSlice';
const BACKEND_HOST = import.meta.env.VITE_SOCKET_URL;
const S3_BASE_URL = import.meta.env.VITE_S3_BASE_URL;
const INTERNAL_EMAIL = import.meta.env.VITE_INTERNAL_EMAIL_DOMAINS?.split(',') || [];
const INTERNAL_EMAIL_EXCLUDE = import.meta.env.VITE_INTERNAL_EMAIL_EXCLUDE?.split(',') || [];
const LOW_QUALITY_EMAILS = import.meta.env.VITE_LOW_QUALITY_EMAILS?.split(',') || [];

export const submitAdCreativeRequest = (isSidebarOpen) => async (dispatch, getState) => {
  const { prompt, socket, adCreative, adHistory, adStudioTabs, editor } = getState();
  if (adCreative?.isSending) return;
  dispatch(setIsSending(true));
  const sessionId = adHistory?.acs2;
  const activeTab = adStudioTabs?.activeAdStudioTabId;
  const ad = prompt?.ad || {};
  const explorePlatform = adCreative?.explorePlatform || '';
  const networks = {
    facebook: 'meta',
    youtube: 'youtube',
    instagram: 'meta',
    google: 'google',
    pinterest: 'pinterest',
    linkedin: 'linkedin',
    reddit: 'reddit',
  };
  const isEditMode = editor?.isEditorOpen || false;

  // 1. Construct payload
  const inputs = {
    prompt: prompt?.prompt || '',
    num_images: prompt?.no_of_ads || 1,
    platform: ad?.network ? networks[ad?.network] : explorePlatform ? explorePlatform : '',
    brand_name: prompt?.brand_name || '',
    brand_description: prompt?.brand_description || '',
    cta: prompt?.cta || '',
    aspect_ratio: prompt?.aspect_ratio,
    ad_image_url: prompt?.ad_image_url || '',
    user_image_url: prompt?.user_image_url || '',
    style_type: prompt?.style_type || 'AUTO',
    color_palette: prompt?.color_palette || '',
    ad_title: prompt?.ad_title || '',
    ad_description: prompt?.ad_description || '',
    brand_logo: prompt?.uploadedLogo || prompt?.brand_logo || '',
    model: prompt?.model || 'ADSGPT-2.0',
    quality: 'LOW',
  };

  const botId = nanoid();

  const payload = {
    ...inputs,
    user_image_url: prompt?.user_image_url ? `${S3_BASE_URL}${prompt?.user_image_url}` : '',
    edit_image_url: isEditMode && editor?.editorImage ? `${S3_BASE_URL}${editor?.editorImage}` : '',
    brand_logo: isEditMode && editor?.editorLogo ? editor?.editorLogo : inputs.brand_logo,
    user_id: socket?.userData?.user_id,
    token: getCookies(),
    isRegenerate: false,
    message_chain: adCreative?.conversations.slice(-4),
    cta_link: '',
    chatId: botId,
    sessionId,
  };

  // 2. Get socket instance
  const socketio = getSocket();

  // 3. Create user and bot message objects
  const userMessage = {
    type: 'user',
    message: prompt?.prompt || '',
    id: nanoid(),
    image: prompt?.user_image_url || '',
    edit_image:
      isEditMode && editor?.editorImage
        ? { image: editor?.editorImage, adIndex: editor?.adIndex, botId: editor?.botId }
        : {},
  };

  const botMessage = {
    type: 'bot',
    start_message: '',
    ads: [],
    end_message: '',
    inputs,
    complete: false,
    id: botId,
  };

  const num_images = payload?.num_images || 0;

  for (let i = 0; i < num_images; i++) {
    botMessage.ads.push({
      text_ad: '',
      image_ad: '',
      text_complete: false,
      image_complete: false,
      aspect_ratio: payload?.aspect_ratio,
      feedback: null,
    });
    dispatch(
      setTimer({
        adId: `${botId}-${i}`,
        startTime: Date.now(),
        duration: calculateGenerationTime(inputs?.model),
      })
    );
  }

  // 4. Save to history
  const historyData = [userMessage, botMessage];
  await saveHistory(sessionId, historyData, 'adCreative', ad);
  startGlobalInteractionTracking(null, payload, 'adCreativeSidebar', socket?.userData, sessionId);
  dispatch(fetchAdHistoryTitles(activeTab));

  // 5. Dispatch actions and emit socket event
  dispatch(addConversation(userMessage));
  dispatch(addConversation(botMessage));
  if (payload?.model === 'ADSGPT-3.0' || payload?.model === 'ADSGPT-3.1') {
    const userEmail = socket?.userData?.user_email;
    if (LOW_QUALITY_EMAILS?.includes(userEmail)) {
      payload['quality'] = 'LOW';
    } else {
      const isInternalUser = INTERNAL_EMAIL?.some(
        (domain) => userEmail?.includes(domain) && !INTERNAL_EMAIL_EXCLUDE?.includes(userEmail)
      );
      payload['quality'] = isInternalUser ? 'MEDIUM' : 'HIGH';
    }
  }
  // socketio.emit('adCreativeRequest', payload);
  emitWhenConnected('adCreativeRequest', payload);

  // 6. Timeout guard (2 minutes = 120000ms)
  triggerTimeoutGuard(dispatch, botId, sessionId, getState);

  // 7. Set loading and clear prompt
  dispatch(setLoading(true));
  dispatch(setField({ key: 'prompt', value: '' }));

  const imageToRemove = prompt?.uploadedImages.find((img) => img.url === prompt.user_image_url);
  if (imageToRemove) {
    dispatch(setField({ key: 'user_image_url', value: '' }));
    dispatch(removeImage(imageToRemove.id));
  }
  if (isEditMode) {
    dispatch(resetEditorSlice());
  }
  dispatch(setIsSending(false));
};

export const handleCreativeRegenerateClick =
  (inputs, isSidebarOpen) => async (dispatch, getState) => {
    const { socket, adCreative, adHistory, adStudioTabs, prompt } = getState();
    if (adCreative?.isSending) return;
    dispatch(setIsSending(true));
    const sessionId = adHistory?.acs2;
    const activeTab = adStudioTabs?.activeAdStudioTabId;

    // 1. Construct payload
    const botId = nanoid();

    const payload = {
      ...inputs,
      user_image_url: inputs?.user_image_url ? `${S3_BASE_URL}${inputs?.user_image_url}` : '',
      user_id: socket?.userData?.user_id,
      token: getCookies(),
      isRegenerate: true,
      message_chain: adCreative?.conversations.slice(-4),
      cta_link: '',
      chatId: botId,
      sessionId,
    };

    // 2. Get socket instance
    const socketio = getSocket();

    // 3. Create user and bot message objects
    const userMessage = {
      type: 'user',
      message: inputs?.prompt || '',
      id: nanoid(),
      image: inputs?.user_image_url || '',
      edit_image: '',
    };

    const botMessage = {
      type: 'bot',
      start_message: '',
      ads: [],
      end_message: '',
      inputs,
      complete: false,
      id: botId,
    };

    const num_images = 1;

    for (let i = 0; i < num_images; i++) {
      botMessage.ads.push({
        text_ad: '',
        image_ad: '',
        text_complete: false,
        image_complete: false,
        aspect_ratio: inputs?.aspect_ratio,
        feedback: null,
      });
      dispatch(
        setTimer({
          adId: `${botId}-${i}`,
          startTime: Date.now(),
          duration: calculateGenerationTime(inputs?.model),
        })
      );
    }

    // 4. Save to history
    const historyData = [userMessage, botMessage];
    await saveHistory(sessionId, historyData, 'adCreative');
    startGlobalInteractionTracking(null, payload, 'adCreativeSidebar', socket?.userData, sessionId);
    dispatch(fetchAdHistoryTitles(activeTab));

    // 5. Dispatch actions and emit socket event
    dispatch(addConversation(userMessage));
    dispatch(addConversation(botMessage));
    if (payload?.model === 'ADSGPT-3.0' || payload?.model === 'ADSGPT-3.1') {
      const userEmail = socket?.userData?.user_email;
      if (LOW_QUALITY_EMAILS?.includes(userEmail)) {
        payload['quality'] = 'LOW';
      } else {
        const isInternalUser = INTERNAL_EMAIL?.some(
          (domain) => userEmail?.includes(domain) && !INTERNAL_EMAIL_EXCLUDE?.includes(userEmail)
        );
        payload['quality'] = isInternalUser ? 'MEDIUM' : 'HIGH';
      }
    }
    // socketio.emit('adCreativeRequest', payload);
    emitWhenConnected('adCreativeRequest', payload);

    // 6. Timeout guard (2 minutes = 120000ms)
    triggerTimeoutGuard(dispatch, botId, sessionId, getState);

    // 7. Set loading and clear prompt
    dispatch(setLoading(true));
    dispatch(setField({ key: 'prompt', value: '' }));

    const imageToRemove = prompt?.uploadedImages.find((img) => img.url === prompt.user_image_url);
    if (imageToRemove) {
      dispatch(setField({ key: 'user_image_url', value: '' }));
      dispatch(removeImage(imageToRemove.id));
    }
    dispatch(setIsSending(false));
  };

const triggerTimeoutGuard = (dispatch, botId, sessionId, getState) => {
  // Timeout guard (3 minutes = 180000ms)
  const timeoutId = setTimeout(
    async () => {
      // Check if the message is already complete before marking as failed
      const { adCreative } = getState();
      const botMsg = adCreative.conversations.find((c) => c.id === botId);
      if (botMsg && botMsg.complete) {
        return;
      }

      // 1. Update frontend state
      dispatch(markBotMessageFailed(botId));
      // 2. Call backend API to persist "failed" state
      try {
        await updateConversationMessage({
          sessionId,
          chatId: botId,
        });
      } catch (err) {
        console.error('Failed to update backend conversation:', err);
      }
    },
    3 * 60 * 1000
  );
  dispatch(registerTimeout({ botId, timeoutId }));
};

export const deleteImage = async (image_url) => {
  try {
    if (!image_url) return;
    await axios.delete(`${BACKEND_HOST}/adsgpt/history/delete-image`, {
      headers: {
        Authorization: `Bearer ${getCookies()}`,
        'Content-Type': 'application/json',
      },
      data: { image_url },
    });
  } catch (error) {
    console.error('Error deleting image:', error);
  }
};

const updateConversationMessage = async ({ sessionId, chatId }) => {
  const token = getCookies();

  return axios.post(
    `${BACKEND_HOST}/adsgpt/history/update-adcreative-data`,
    {
      sessionId,
      chatId,
    },
    {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    }
  );
};

export const fetchExploreAds = createAsyncThunk(
  'adCreative/fetchExploreAds',
  async (_, { rejectWithValue, getState }) => {
    try {
      const { adCreative, socket } = getState();

      const token = getCookies();

      const esNetworks = {
        google: ['google'],
        google_performance_max_ads: ['google'],
        google_display_ads: ['google_display_ads'],
        google_video_ads: ['google'],
        meta: ['facebook', 'instagram'],
        youtube: ['youtube'],
        pinterest: ['pinterest'],
        linkedin: ['linkedin'],
        reddit: ['reddit'],
      };
      if (adCreative?.explorePlatform && !esNetworks[adCreative?.explorePlatform]) return [];

      const res = await axios.post(
        `${BACKEND_HOST}/adsgpt/ads/explore-ads`,
        {
          from: adCreative?.exploreSkip,
          size: 10,
          networks: socket?.userData?.featureObject?.Networks || [],
          popularity: socket?.userData?.featureObject?.['Popularity Index'],
          type: 'IMAGE',
          user_id: socket?.userData?.user_id,
          competitor: adCreative?.exploreCompetitor ? [adCreative?.exploreCompetitor] : [],
          platform: adCreative?.explorePlatform ? esNetworks[adCreative?.explorePlatform] : [],
          categories: [],
          searchType: adCreative?.exploreSearchTerm || 'competitor',
        },
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
        }
      );

      const data = res.data;
      const ads = data?.ads?.filter((ad) => ad !== null) || [];
      return ads;
    } catch (err) {
      return rejectWithValue(err.message);
    }
  }
);

export const updateFields = createAsyncThunk(
  'adCreative/updateFields',
  async ({ botId, index, field, value }, { rejectWithValue, getState }) => {
    const { adHistory } = getState();
    const sessionId = adHistory?.acs2;
    const token = getCookies();
    try {
      axios.post(
        `${BACKEND_HOST}/adsgpt/history/update-creative-fields`,
        {
          sessionId,
          chatId: botId,
          index,
          field,
          value,
        },
        {
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        }
      );
    } catch (error) {
      return rejectWithValue(error.message);
    }
  }
);

const calculateGenerationTime = (model) => {
  if (model === 'ADSGPT-1.0' || model === 'ADSGPT-2.0') {
    return 30;
  } else if (model === 'ADSGPT-3.0' || model === 'ADSGPT-3.1') {
    return 100;
  }
};

// in your slice or actions file
export const initNewChat = () => async (dispatch, getState) => {
  // If the user is on MySpace, route the AdStudio click to the tab that
  // matches what they were just viewing — Images → AdCreative, Videos →
  // AdVideo. Otherwise leave the active tab as-is.
  const { activePage, mySpaceTab } = getState().adVideoNew || {};
  if (activePage === 'myVideos') {
    dispatch(
      setActiveAdStudioTab(mySpaceTab === 'images' ? 'adCreativeNew' : 'adVideoNew'),
    );
  }

  // synchronous updates
  dispatch(createNewSession({ tab: 'adCopy' }));
  dispatch(createNewSession({ tab: 'adCreative' }));
  dispatch(createNewSession({ tab: 'adVideo' }));

  dispatch(resetAdCopySlice());
  dispatch(resetAdCreativeSlice());
  dispatch(resetAdVideoSlice());
  dispatch(resetPromptSlice());
  dispatch(resetAdVideoNewSlice());

  // async updates in parallel
  dispatch(fetchSuggestions());
  dispatch(fetchExploreAds());
};
