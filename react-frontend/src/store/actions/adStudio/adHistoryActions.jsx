import { resetAdCopySlice } from '@/store/reducers/adStudio/adCopySlice';
import { resetAdCreativeSlice } from '@/store/reducers/adStudio/adCreativeSlice';
import { createNewSession } from '@/store/reducers/adStudio/adHistorySlice';
import { resetAdVideoSlice } from '@/store/reducers/adStudio/adVideoSlice';
import { addImage, resetPromptSlice, setField } from '@/store/reducers/adStudio/promptSlice';
import { formatUrl } from '@/utils/formatUrl';
import getCookies from '@/utils/getCookies';
import { createAsyncThunk } from '@reduxjs/toolkit';
import axios from 'axios';
import { nanoid } from 'nanoid';
import { fetchExploreAds } from './adCreativeActions';
const BACKEND_HOST = import.meta.env.VITE_SOCKET_URL;
const AMEMBER_HOST = import.meta.env.VITE_AMEMBER_URL;
const REDIRECT_LOGIN = AMEMBER_HOST + '/login';

export const saveHistory = async (sessionId, data, type, ad) => {
  try {
    await axios.post(
      `${BACKEND_HOST}/adsgpt/history`,
      {
        sessionId,
        data,
        type,
        ad: ad ? ad : {},
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getCookies()}`,
        },
      }
    );
  } catch (error) {
    if (error?.response?.status === 403) {
      window.location.href = REDIRECT_LOGIN;
    }
    console.error('Error saving history:', error);
  }
};

export const fetchAdHistory = createAsyncThunk(
  'adHistory/fetchAdHistory',
  async (sessionId, { rejectWithValue, dispatch }) => {
    try {
      const token = getCookies();

      const res = await axios.get(`${BACKEND_HOST}/adsgpt/history/${sessionId}`, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
      const data = res?.data?.data || {};

      const conversations = data?.conversations || [];

      if (data?.type === 'adCreative' && Array.isArray(conversations) && conversations.length > 0) {
        const lastConversation = conversations.findLast((conv) => conv?.type === 'bot');
        const aspect_ratio = lastConversation?.inputs?.aspect_ratio;
        const model = lastConversation?.inputs?.model;
        if (aspect_ratio) {
          dispatch(setField({ key: 'aspect_ratio', value: aspect_ratio }));
        }

        if (model) {
          dispatch(setField({ key: 'model', value: model }));
        }
      }

      const ad = data?.ad;
      if (data?.type !== 'adCopy') handleAdPayload(ad, dispatch);

      return data;
    } catch (err) {
      if (err?.response?.status === 403) {
        window.location.href = REDIRECT_LOGIN;
      }
      return rejectWithValue(
        err.response?.data?.message || err.message || 'Failed to fetch adCopy history'
      );
    }
  }
);

export const fetchAdHistoryTitles = createAsyncThunk(
  'adHistory/fetchAdHistoryTitles',
  async (type, { rejectWithValue }) => {
    try {
      const token = getCookies();
      const currentDate = new Date().toISOString();

      const res = await axios.post(
        `${BACKEND_HOST}/adsgpt/history/get-titles`,
        { currentDate, type },
        {
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        }
      );
      return res?.data?.titles || {};
    } catch (err) {
      if (err?.response?.status === 403) {
        window.location.href = REDIRECT_LOGIN;
      }
      return rejectWithValue(
        err.response?.data?.message || err.message || 'Failed to fetch adCopy history'
      );
    }
  }
);

const handleAdPayload = (ad, dispatch) => {
  try {
    if (ad && Object.keys(ad).length > 0) {
      const activeIndex = ad?.activeIndex || 0;
      const title = ad?.title || '';
      const description = ad?.newsfeedDescription || ad?.description || '';
      const image = ad?.postImage || '';
      const otherMedia = ad?.otherMedia || [];
      let imgs = [];

      if (Array.isArray(image)) {
        imgs = [...image]; // already array
      } else if (image) {
        imgs = [image]; // wrap single string in array
      }

      const other = Array.isArray(otherMedia) ? otherMedia : [];
      other.forEach((o) => {
        imgs.push(formatUrl(o));
      });

      const newImage = {
        id: nanoid(),
        url: imgs[activeIndex],
        type: 'ad',
        title,
        description,
        ad: ad ? { ...ad, activeIndex } : {},
      };
      dispatch(addImage(newImage));
    } else {
      dispatch(setField({ key: 'uploadedImages', value: [] }));
    }
  } catch (error) {
    console.error(error);
  }
};

export const deleteAdHistory = createAsyncThunk(
  'adHistory/deleteAdHistory',
  async (
    { sessionId, type, activeAdStudioTabId, activeSessionId },
    { rejectWithValue, dispatch }
  ) => {
    try {
      const token = getCookies();
      const resetMap = {
        adCopy: resetAdCopySlice,
        adCreative: resetAdCreativeSlice,
        adVideo: resetAdVideoSlice,
      };

      const res = await axios.delete(`${BACKEND_HOST}/adsgpt/history/${sessionId}`, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
      if (res.status === 200 && activeSessionId === sessionId) {
        dispatch(createNewSession({ tab: activeAdStudioTabId }));
        dispatch(resetMap[activeAdStudioTabId]());
        dispatch(resetPromptSlice());
        dispatch(fetchExploreAds());
        return { sessionId, type };
      } else {
        return rejectWithValue('Failed to delete history');
      }
    } catch (err) {
      if (err?.response?.status === 403) {
        window.location.href = REDIRECT_LOGIN;
      }
      return rejectWithValue(
        err.response?.data?.message || err.message || 'Failed to delete history'
      );
    }
  }
);
