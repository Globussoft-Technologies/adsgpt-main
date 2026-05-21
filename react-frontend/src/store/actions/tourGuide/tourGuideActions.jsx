import getCookies from '@/utils/getCookies';
import { createAsyncThunk } from '@reduxjs/toolkit';
import axios from 'axios';
const BACKEND_HOST = import.meta.env.VITE_SOCKET_URL;

export const checkUserExists = createAsyncThunk(
  'tourGuide/checkUserExists',
  async (userId, { rejectWithValue }) => {
    const token = getCookies();
    try {
      const response = await axios.post(
        `${BACKEND_HOST}/adsgpt/adcopy/check-user/${userId}`,
        {},
        {
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        }
      );
      return response?.data?.exists || false;
    } catch (error) {
      return rejectWithValue(error.message);
    }
  }
);
