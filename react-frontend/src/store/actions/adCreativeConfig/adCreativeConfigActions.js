import { createAsyncThunk } from '@reduxjs/toolkit';
import { fetchAdCreativeConfig as fetchAdCreativeConfigRaw } from '@/utils/fetchAdCreativeConfig';

// ----------------------------------------------------------------------------
// AdCreative config — shared, single-session cache for the `ad_creative` image
// surface. Cache-aware: the thunk no-ops when the slice already holds a
// successful snapshot, so any number of mount-time dispatches across the
// AdCreative screens cost exactly one network call per session.
// ----------------------------------------------------------------------------

export const fetchAdCreativeConfig = createAsyncThunk(
  'adCreativeConfig/fetch',
  async (_arg, { getState, rejectWithValue }) => {
    if (getState().adCreativeConfig?.status === 'ok') {
      return { cached: true };
    }
    try {
      const models = await fetchAdCreativeConfigRaw();
      return { cached: false, models };
    } catch (err) {
      return rejectWithValue({
        message: err?.message || 'Failed to load ad creative configuration',
      });
    }
  }
);
