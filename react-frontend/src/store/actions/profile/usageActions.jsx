import axios from 'axios';
import { createAsyncThunk } from '@reduxjs/toolkit';
import getCookies from '@/utils/getCookies';

const BACKEND_HOST = import.meta.env.VITE_SOCKET_URL;

export const fetchGenerationStats = createAsyncThunk(
  'usage/fetchGenerationStats',
  async ({ userId, from, to }, { rejectWithValue }) => {
    try {
      const token = getCookies();
      await new Promise((resolve) => setTimeout(resolve, 500));
      const res = await axios.get(`${BACKEND_HOST}/adsgpt/usage/generation-stats/${userId}`, {
        params: {
          from, // yyyy-mm-dd (optional)
          to, // yyyy-mm-dd (optional)
        },
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      return res.data; // expect { data: [...] }
    } catch (err) {
      return rejectWithValue(err?.response?.data?.message || 'Failed to fetch generation stats');
    }
  }
);
