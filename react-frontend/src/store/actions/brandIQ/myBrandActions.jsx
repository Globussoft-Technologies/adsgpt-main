import getCookies from '@/utils/getCookies';
import { createAsyncThunk } from '@reduxjs/toolkit';
import axios from 'axios';
import { toast } from 'react-toastify';
const BACKEND_HOST = import.meta.env.VITE_SOCKET_URL;
const AMEMBER_HOST = import.meta.env.VITE_AMEMBER_URL;
const REDIRECT_LOGIN = AMEMBER_HOST + '/login';

const urlsKeyMap = {
  'Brand Logos*': 'logo',
  'Brand Icon*': 'iconUrl',
  'Product Image*': 'image',
  'Product Image': 'image',
};

export const createBrandList = createAsyncThunk(
  'brandIQTabs/createBrandList',
  async (payload, { rejectWithValue }) => {
    try {
      const res = await axios.post(`${BACKEND_HOST}/adsgpt/brand/create-lists`, payload, {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getCookies()}`,
        },
      });
      return res?.data;
    } catch (err) {
      // console.log("error message",err.message);
      // console.log("err",err)
      if (err?.response?.status === 403) {
        window.location.href = REDIRECT_LOGIN;
      }
      if (err?.response?.status === 409) {
        return rejectWithValue(toast.error(err?.response?.data?.message));
      }
       toast.error('Invalid image, please upload a valid image');
      return rejectWithValue(
        err?.response?.data?.error || err?.message || 'Failed to fetch barnd list'
      );
    }
  }
);

export const fetchBrands = createAsyncThunk(
  'brandIQTabs/fetchBrands',
  async (userId, { rejectWithValue }) => {
    try {
      const token = getCookies();
      const res = await axios.get(
        `${BACKEND_HOST}/adsgpt/brand/get-lists?userId=${userId}&skip=${0}&limit=${100}`,
        {
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        }
      );
      return res?.data || [];
    } catch (err) {
      if (err?.response?.status === 403) {
        window.location.href = REDIRECT_LOGIN;
      }
      return rejectWithValue(
        err?.response?.data?.message || err.message || 'Failed to fetch barnd list'
      );
    }
  }
);
export const fetchSavedItems = createAsyncThunk(
  'brandIQTabs/fetchSavedItems',
  async ({ userId, skip = 0, limit = 20 }, { rejectWithValue, getState }) => {
    try {
      const token = getCookies();
      const res = await axios.get(
        `${BACKEND_HOST}/adsgpt/gallery?user_id=${userId}&skip=${skip}&limit=${limit}`,
        {
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        }
      );

      // Return both the data and the skip parameter to handle in reducer
      return {
        data: res?.data || {},
        skip,
        limit,
      };
    } catch (err) {
      if (err?.response?.status === 403) {
        window.location.href = REDIRECT_LOGIN;
      }
      return rejectWithValue(
        err?.response?.data?.message || err.message || 'Failed to fetch gallery items'
      );
    }
  }
);
export const fetchSessionOfSavedItems = createAsyncThunk(
  'brandIQTabs/fetchSessionOfSavedItems',
  async (arg, { rejectWithValue, getState }) => {
    try {
      const token = getCookies();
      const res = await axios.post(`${BACKEND_HOST}/adsgpt/gallery/getchatforimage`, arg, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      });

      // Return both the data and the skip parameter to handle in reducer
      return {
        data: res?.data || {},
      };
    } catch (err) {
      if (err?.response?.status === 403) {
        window.location.href = REDIRECT_LOGIN;
      }
      return rejectWithValue(
        err?.response?.data?.message || err.message || 'Failed to fetch gallery items'
      );
    }
  }
);
export const updateBrandList = createAsyncThunk(
  'brandIQTabs/updateBrands',
  async (payload, { rejectWithValue }) => {
    try {
      const res = await axios.patch(`${BACKEND_HOST}/adsgpt/brand/update-lists`, payload, {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getCookies()}`,
        },
      });
      return res?.data || [];
    } catch (err) {
      if (err?.response?.status === 403) {
        window.location.href = REDIRECT_LOGIN;
      }
      return rejectWithValue(
        err?.response?.data?.message || err.message || 'Error in updating brands'
      );
    }
  }
);

export const deleteBrand = createAsyncThunk(
  'brandIQTabs/deleteBrand',
  async (payload, { rejectWithValue }) => {
    try {
      const response = await axios.delete(`${BACKEND_HOST}/adsgpt/brand/delete-lists`, {
        headers: {
          Authorization: `Bearer ${getCookies()}`,
        },
        data: payload,
      });
      return response;
    } catch (err) {
      if (err?.response?.status === 403) {
        window.location.href = REDIRECT_LOGIN;
      }
      return rejectWithValue(
        err?.response?.data?.message || err.message || 'Failed to fetch barnd list'
      );
    }
  }
);

export const removeBrandImage = createAsyncThunk(
  'brandIQTabs/removeBrandImage',
  async (payload, { rejectWithValue }) => {
    try {
      const payload1 = {
        brandId: payload?.id,
        userId: payload?.userId,
        type: urlsKeyMap[payload.labelName],
        fileUrl: payload.imageUrl,
      };
      const res = await axios.post(`${BACKEND_HOST}/adsgpt/brand/remove-brand-logo`, payload1, {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getCookies()}`,
        },
      });
      return res?.data;
    } catch (err) {
      console.log(err);
      if (err?.response?.status === 403) {
        window.location.href = REDIRECT_LOGIN;
      }
      return rejectWithValue(
        err?.response?.data?.error || err.message || 'Error in updating brands'
      );
    }
  }
);

export const fetchAudienceSuggestions = createAsyncThunk(
  'brandIQTabs/fetchAudienceSuggestions',
  async ({ userId, brandId, force = false }, { rejectWithValue }) => {
    try {
      const res = await axios.post(
        `${BACKEND_HOST}/adsgpt/brand/audience-suggestions`,
        { userId, brandId, force },
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${getCookies()}`,
          },
        }
      );
      return { brandId, suggestions: res.data.suggestions };
    } catch (err) {
      if (err?.response?.status === 403) {
        window.location.href = REDIRECT_LOGIN;
      }
      return rejectWithValue(
        err?.response?.data?.message || err.message || 'Failed to fetch audience suggestions'
      );
    }
  }
);

export const analazeDomain = async (domain_url) => {
  try {
    if (!domain_url) return;
    let response = await axios.get(`${BACKEND_HOST}/adsgpt/adVideo/analyze-url?url=${domain_url}`, {
      headers: {
        Authorization: `Bearer ${getCookies()}`,
        'Content-Type': 'application/json',
      },
    });
    return response?.data;
  } catch (error) {
    const status = error?.response?.status;
    const backendMessage = error?.response?.data?.message;

    //  BUSINESS CONFLICTS
    if (status === 409) {
      toast.error(backendMessage || 'Brand already exists');
      throw error;
    }
    if (error?.response?.status === 403) {
      window.location.href = REDIRECT_LOGIN;
    }
    console.error('Error in analyzing domain:', error);
    throw error;
  }
};
