import {
  addConversation,
  markBotMessageFailed,
  registerTimeout,
  setIsSending,
  setLoading,
  setTyping,
} from '@/store/reducers/adStudio/adCopySlice';
import { setField } from '@/store/reducers/adStudio/promptSlice';
import { getSocket } from '@/store/reducers/socket/socketSlice';
import getCookies from '@/utils/getCookies';
import { createAsyncThunk } from '@reduxjs/toolkit';
import { nanoid } from 'nanoid';
import { fetchAdHistoryTitles, saveHistory } from './adHistoryActions';
import axios from 'axios';
import { emitWhenConnected } from '@/utils/socketEmitter';
import { startGlobalInteractionTracking } from '@/utils/userInteractionTracker';
const BACKEND_HOST = import.meta.env.VITE_SOCKET_URL;

// 1. Thunk to fetch suggestions
export const fetchSuggestions = createAsyncThunk(
  'adCopy/fetchSuggestions',
  async (_, { rejectWithValue }) => {
    try {
      const token = getCookies();

      const res = await fetch(`${BACKEND_HOST}/adsgpt/trending`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) throw new Error('Failed to fetch suggestions');

      const data = await res.json();
      return data?.data || [];
    } catch (err) {
      return rejectWithValue(err.message);
    }
  }
);

export const submitAdCopyRequest = (suggestion, isSidebarOpen) => async (dispatch, getState) => {
  const { prompt, socket, adCopy, adHistory, adStudioTabs } = getState();
  if (adCopy?.isSending) return;
  dispatch(setIsSending(true));
  const sessionId = adHistory?.acs1;
  const activeTab = adStudioTabs?.activeAdStudioTabId;

  // 1. Construct payload
  const inputs = {
    platform: prompt?.platform || '',
    brand_name: prompt?.brand_name || '',
    brand_description: prompt?.brand_description || '',
    ad_title: prompt?.ad_title || '',
    ad_description: prompt?.ad_description || '',
    user_query: suggestion || prompt?.prompt || '',
    no_of_ad_copies: prompt?.no_of_ads || 1,
    cta: prompt?.cta || '',
  };

  const botId = nanoid();

  const payload = {
    ...inputs,
    user_id: socket?.userData?.user_id,
    token: getCookies(),
    isRegenerate: false,
    message_chain: adCopy?.conversations.slice(-4),
    cta_link: '',
    chatId: botId,
    sessionId,
  };

  // 2. Get socket instance
  const socketio = getSocket();

  // 3. Create user and bot message objects
  const userMessage = {
    type: 'user',
    message: suggestion || prompt?.prompt || '',
    id: nanoid(),
  };

  const botMessage = {
    type: 'bot',
    message: '',
    inputs,
    complete: false,
    id: botId,
    feedback: null,
  };

  // 4. Save to history
  const historyData = [userMessage, botMessage];
  await saveHistory(sessionId, historyData, 'adCopy');
  startGlobalInteractionTracking(null, payload, 'adCopySidebar', socket?.userData, sessionId);
  if (isSidebarOpen) dispatch(fetchAdHistoryTitles(activeTab));

  // 5. Dispatch actions and emit socket event
  dispatch(addConversation(userMessage));
  dispatch(addConversation(botMessage));
  // socketio.emit('adCopyRequest', payload);
  emitWhenConnected('adCopyRequest', payload);
  // 6. Timeout guard (2 minutes = 120000ms)
  triggerTimeoutGuard(dispatch, botId, sessionId, getState);

  // 7. Set loading and clear prompt
  dispatch(setLoading(true));
  dispatch(setTyping(true));
  dispatch(setField({ key: 'prompt', value: '' }));
  dispatch(setIsSending(false));
};

export const regenerateAdCopy =
  (inputs = {}) =>
  async (dispatch, getState) => {
    const { socket, adCopy, adHistory } = getState();
    if (adCopy?.isSending) return;
    dispatch(setIsSending(true));

    const sessionId = adHistory?.acs1;
    const botId = nanoid();

    // 1. Construct payload
    const payload = {
      ...inputs,
      user_id: socket?.userData?.user_id,
      token: getCookies(),
      isRegenerate: true,
      message_chain: adCopy?.conversations.slice(-4),
      cta_link: '',
      chatId: botId,
      sessionId,
    };

    // 2. Get socket instance
    const socketio = getSocket();

    // 3. Create user and bot message object
    const userMessage = {
      type: 'user',
      message: inputs?.user_query || '',
      id: nanoid(),
    };

    const botMessage = {
      type: 'bot',
      message: '',
      inputs,
      complete: false,
      id: botId,
      feedback: null,
    };

    // 4. Save to history
    const historyData = [userMessage, botMessage];
    await saveHistory(sessionId, historyData, 'adCopy');

    // 5. Dispatch actions and emit socket event
    dispatch(addConversation(userMessage));
    dispatch(addConversation(botMessage));
    // socketio.emit('adCopyRequest', payload);
    emitWhenConnected('adCopyRequest', payload);

    // 6. Timeout guard (2 minutes = 120000ms)
    triggerTimeoutGuard(dispatch, botId, sessionId, getState);

    // t. Set loading
    dispatch(setLoading(true));
    dispatch(setTyping(true));
    dispatch(setIsSending(false));
  };

const updateConversationMessage = async ({ sessionId, chatId, adCopyText }) => {
  const token = getCookies();

  return axios.post(
    `${BACKEND_HOST}/adsgpt/history/update-adcopy-data`,
    {
      sessionId,
      chatId,
      adCopyText,
    },
    {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    }
  );
};

const triggerTimeoutGuard = (dispatch, botId, sessionId, getState) => {
  // Timeout guard (1 minute = 60000ms)
  const timeoutId = setTimeout(async () => {
    // Check if the message is already complete before marking as failed
    const { adCopy } = getState();
    const botMsg = adCopy.conversations.find((c) => c.id === botId);
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
        adCopyText: '⚠️ Could not generate ad copy. Please try again.',
      });
    } catch (err) {
      console.error('Failed to update backend conversation:', err);
    }
  }, 60000);
  dispatch(registerTimeout({ botId, timeoutId }));
};
