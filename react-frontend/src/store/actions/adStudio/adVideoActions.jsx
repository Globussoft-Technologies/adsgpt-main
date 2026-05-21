import { getSocket } from '@/store/reducers/socket/socketSlice';
import getCookies from '@/utils/getCookies';
import { nanoid } from 'nanoid';
import {
  addConversation,
  markVideoBotMessageFailed,
  registerVideoTimeout,
  setIsSending,
  setLoading,
} from '@/store/reducers/adStudio/adVideoSlice';
import { removeImage, setField } from '@/store/reducers/adStudio/promptSlice';
import { fetchAdHistoryTitles, saveHistory } from './adHistoryActions';
import axios from 'axios';
import { emitWhenConnected } from '@/utils/socketEmitter';
const S3_BASE_URL = import.meta.env.VITE_S3_BASE_URL;
const BACKEND_HOST = import.meta.env.VITE_SOCKET_URL;

export const submitAdVideoRequest = (isSidebarOpen) => async (dispatch, getState) => {
  const { prompt, socket, adHistory, adVideo, adStudioTabs } = getState();
  if (adVideo?.isSending) return;
  dispatch(setIsSending(true));
  const sessionId = adHistory?.avs3;
  const activeTab = adStudioTabs?.activeAdStudioTabId;
  const botId = nanoid();

  // 1. Construct payload
  const inputs = {
    session: {
      chatId: botId,
      userId: socket?.userData?.user_id,
      sessionId: sessionId,
      token: getCookies(),
      timestamp: new Date().toISOString(),
    },
    query: {
      model: prompt?.video_model,
      productName: prompt?.product_name,
      persona: prompt?.persona,
      prompt: prompt?.prompt || '',
      negativePrompt: prompt?.negativePrompt || '',
      imageUrl: prompt?.user_image_url ? `${S3_BASE_URL}${prompt?.user_image_url}` : '',
      aspectRatio: prompt?.video_aspect_ratio,
      duration: prompt?.video_duration,
      numberOfVideos: prompt?.no_of_ads || 1,
      videoType: prompt?.video_type || '',
      videoPreference: prompt?.video_preference || '',
    },
  };

  const payload = {
    ...inputs,
  };

  // 2. Get socket instance
  const socketio = getSocket();

  // 3. Create user and bot message objects
  const userMessage = {
    type: 'user',
    message: prompt?.prompt || '',
    id: nanoid(),
    image: prompt?.user_image_url || '',
  };

  const botMessage = {
    type: 'bot',
    ads: [],
    inputs,
    complete: false,
    id: botId,
    feedback: null,
  };

  const num_videos = payload?.query?.numberOfVideos || 1;

  for (let i = 0; i < num_videos; i++) {
    botMessage.ads.push({
      video_ad: '',
      video_complete: false,
      aspect_ratio: payload?.query?.aspectRatio,
    });
  }

  // 4. Save to history
  const historyData = [userMessage, botMessage];
  await saveHistory(sessionId, historyData, 'adVideo');
  dispatch(fetchAdHistoryTitles(activeTab));

  // 5. Dispatch actions and emit socket event
  dispatch(addConversation(userMessage));
  dispatch(addConversation(botMessage));
  // socketio.emit('adCreativeVideoRequest', payload);
  emitWhenConnected('adCreativeVideoRequest', payload);

  // 6. Timeout guard (2 minutes = 120000ms)
  triggerTimeoutGuard(dispatch, botId, sessionId, getState);

  // 7. Set loading and clear prompt
  dispatch(setLoading(true));
  dispatch(setField({ key: 'prompt', value: '' }));

  const imageToRemove = prompt?.uploadedImages?.find((img) => img?.url === prompt?.user_image_url);
  if (imageToRemove) {
    dispatch(setField({ key: 'user_image_url', value: '' }));
    dispatch(removeImage(imageToRemove?.id));
  }
  dispatch(setIsSending(false));
};

const triggerTimeoutGuard = (dispatch, botId, sessionId, getState) => {
  // Timeout guard (10 minutes = 600,000ms)
  const timeoutId = setTimeout(async () => {
    // Check if the message is already complete before marking as failed
    const { adVideo } = getState();
    const botMsg = adVideo.conversations.find((c) => c.id === botId);
    if (botMsg && botMsg.complete) {
      return;
    }

    // 1. Update frontend state
    dispatch(markVideoBotMessageFailed(botId));
    // 2. Call backend API to persist "failed" state
    try {
      await updateVideoConversationMessage({
        sessionId,
        chatId: botId,
      });
    } catch (err) {
      console.error('Failed to update backend video conversation:', err);
    }
  }, 600000);
  dispatch(registerVideoTimeout({ botId, timeoutId }));
};

const updateVideoConversationMessage = async ({ sessionId, chatId }) => {
  const token = getCookies();

  return axios.post(
    `${BACKEND_HOST}/adsgpt/history/update-advideo-data`,
    {
      sessionId,
      chatId,
    },
    {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    }
  );
};
