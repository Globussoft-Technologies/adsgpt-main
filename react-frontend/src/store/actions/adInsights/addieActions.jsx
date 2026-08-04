import { getSocket } from '@/store/reducers/socket/socketSlice';
import getCookies from '@/utils/getCookies';
import { createAsyncThunk } from '@reduxjs/toolkit';
import { nanoid } from 'nanoid';
import axios from 'axios';
import {
  markBotMessageFailed,
  registerTimeout,
  setAddieConversation,
  setAddieLoading,
  setAddieTyping,
} from '@/store/reducers/adInsights/Addie/AddieChatBotSlice';
import { fetchAdHistoryTitles, saveHistory } from '../adStudio/adHistoryActions';
import { useLocation } from 'react-router-dom';
import { setAddieField } from '@/store/reducers/adInsights/Addie/addiePromptSlice';
const BACKEND_HOST = import.meta.env.VITE_SOCKET_URL;
const FRESH_USER_HOST = import.meta.env.VITE_APP_FRESHUSER_API;

// 1. Thunk to fetch suggestions
export const freshUserData = createAsyncThunk(
  'ads/fetchfreshuserdata',
  async (args, { rejectWithValue, getState, dispatch }) => {
    try {
      const token = getCookies();

      // Wait for userData to be available
      let { socket, addieHistory } = getState();
      let attempts = 0;
      const maxAttempts = 10; // Wait up to 5 seconds (10 * 500ms)

      while ((!socket?.userData?.user_id || !socket?.userData?.token) && attempts < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        ({ socket, addieHistory } = getState());
        attempts++;
      }

      if (!socket?.userData?.user_id || !socket?.userData?.token) {
        throw new Error('User data not available after waiting');
      }

      const payload = {
        uid: socket.userData.user_id,
        token: socket.userData.token,
        chatId: '',
        sessionId: addieHistory?.em1,
        skip: 0,
        featureObject: socket.userData.featureObject,
      };

      const res = await fetch(`${FRESH_USER_HOST}/api/user/fresh-user`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error('Failed to fetch suggestions');
      const data = await res.json();
      return data || [];
    } catch (err) {
      return rejectWithValue(err.message);
    }
  }
);

export const getFaqData = createAsyncThunk('queries/faqData', async (_, { rejectWithValue }) => {
  try {
    const token = getCookies();

    const res = await fetch(`${BACKEND_HOST}/adsgpt/faq/getdata?count=4`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    });

    if (!res.ok) throw new Error('Failed to fetch FAQ data');

    const data = await res.json();
    return data || [];
  } catch (err) {
    return rejectWithValue(err.message);
  }
});

export const submitAddieRequest =
  (suggestion, isSidebarOpen, currentRoute) => async (dispatch, getState) => {
    const { addiePrompt, socket, addie, addieHistory, adStudioTabs } = getState();
    const sessionId = addieHistory?.em1;
    const { selectedBrands } = addie;
    // 1. Construct payload
    if (!addiePrompt?.prompt && !suggestion) return;
    const inputs = {
      isAdvertiserChat: selectedBrands?.length !== 0 ? true : false,
      advertiser: selectedBrands || [],
    };
    function formatDate(date) {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0'); // Months are 0-indexed
      const day = String(date.getDate()).padStart(2, '0');
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      const seconds = String(date.getSeconds()).padStart(2, '0');

      return `${year}-${month}-${day} ${hours}-${minutes}-${seconds}`;
    }
    const botId = nanoid();
    const userMessageId = nanoid(); // Generate user message ID immediately

    const payload = {
      ...inputs,
      username: socket?.userData?.user_name,
      uid: socket?.userData?.user_id,
      sessionId,
      chatId: botId,
      token: getCookies(),
      responseBy: 'user',
      message: suggestion || addiePrompt?.prompt || '',
      message_chain: addie?.conversations?.slice(-4),
      timestamp: formatDate(new Date()),
    };

    // 1. Create user message object immediately
    const userMessage = {
      type: 'user',
      message: suggestion || addiePrompt?.prompt || '',
      id: userMessageId, // Use the pre-generated ID
    };

    const botMessage = {
      type: 'bot',
      message: '',
      inputs,
      isFinalResponse: false,
      id: botId,
      feedback: null,
    };

    const socketio = getSocket();

    // 2. Dispatch user message IMMEDIATELY before any async operations
    dispatch(setAddieConversation(userMessage));

    // 3. Then proceed with async operations
    try {
      await saveHistory(sessionId, [userMessage, botMessage], 'emulator');

      if (currentRoute === '/adinsights' && isSidebarOpen) {
        dispatch(fetchAdHistoryTitles('emulator'));
      }

      // 4. Dispatch bot message and emit socket event
      dispatch(setAddieConversation(botMessage));
      socketio.emit('chat', payload);

      triggerTimeoutGuard(dispatch, botId, sessionId);
      dispatch(setAddieLoading(true));
      dispatch(setAddieTyping(true));
      dispatch(setAddieField({ key: 'prompt', value: '' }));
    } catch (error) {
      console.error('Error in submitAddieRequest:', error);
      // Even if async fails, user message is already shown
    }
  };

const updateAddieConversation = async ({ sessionId, chatId, adCopyText }) => {
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

const triggerTimeoutGuard = (dispatch, botId, sessionId) => {
  // Timeout guard (2 minutes = 120000ms)
  const timeoutId = setTimeout(async () => {
    // 1. Update frontend state
    dispatch(markBotMessageFailed(botId));

    // 2. Call backend API to persist "failed" state
    try {
      await updateAddieConversation({
        sessionId,
        chatId: botId,
        adCopyText: '⚠️ Could not generate Chat Response. Please try again.',
      });
    } catch (err) {
      console.error('Failed to update backend conversation:', err);
    }
  }, 60000);
  dispatch(registerTimeout({ botId, timeoutId }));
};

