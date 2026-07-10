import { createSlice } from '@reduxjs/toolkit';
import { fetchAdCreativeConfig } from '@/store/actions/adCreativeConfig/adCreativeConfigActions';

// ----------------------------------------------------------------------------
// adCreativeConfig — single-session cache for the `ad_creative` image surface
// (models + aspectRatios + qualities + per-quality credits).
//
// Consumers read via useAdCreativeConfig, which falls back to
// FALLBACK_AD_CREATIVE_MODELS whenever status !== 'ok' or the list is empty, so
// the UI keeps working if the API hasn't returned yet or fails.
// ----------------------------------------------------------------------------

const initialState = {
  status: 'idle', // 'idle' | 'loading' | 'ok' | 'error'
  models: [],
  error: null,
};

const adCreativeConfigSlice = createSlice({
  name: 'adCreativeConfig',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchAdCreativeConfig.pending, (state) => {
        if (state.status !== 'ok') {
          state.status = 'loading';
          state.error = null;
        }
      })
      .addCase(fetchAdCreativeConfig.fulfilled, (state, action) => {
        const { cached, models } = action.payload || {};
        if (cached) return;
        state.status = 'ok';
        state.models = models || [];
        state.error = null;
      })
      .addCase(fetchAdCreativeConfig.rejected, (state, action) => {
        state.status = 'error';
        state.error = action.payload?.message || 'Failed to load ad creative configuration';
      });
  },
});

export const selectAdCreativeModels = (state) => state.adCreativeConfig.models;
export const selectAdCreativeConfigStatus = (state) => state.adCreativeConfig.status;

export default adCreativeConfigSlice.reducer;
