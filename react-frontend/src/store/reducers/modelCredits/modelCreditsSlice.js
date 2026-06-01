import { createSlice } from '@reduxjs/toolkit';
import { fetchModelCredits } from '@/store/actions/modelCredits/modelCreditsActions';

// ----------------------------------------------------------------------------
// modelCredits — single-session cache for /adsgpt/usage/model-credit-value.
//
// Keyed by the human display label returned by the API ("Nano Banana Pro",
// "OpenAI 1.5", ...). Consumers that store provider keys instead must
// map value → label themselves before reading credits.
//
// Falls back to a per-consumer hardcoded default when status !== 'ok' so
// the UI keeps working if the API hasn't returned yet or fails.
// ----------------------------------------------------------------------------

const initialState = {
  status: 'idle', // 'idle' | 'loading' | 'ok' | 'error'
  imageModelsByLabel: {},
  videoModelsByLabel: {},
  error: null,
};

const modelCreditsSlice = createSlice({
  name: 'modelCredits',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchModelCredits.pending, (state) => {
        if (state.status !== 'ok') {
          state.status = 'loading';
          state.error = null;
        }
      })
      .addCase(fetchModelCredits.fulfilled, (state, action) => {
        const { cached, imageModelsByLabel, videoModelsByLabel } = action.payload || {};
        if (cached) return;
        state.status = 'ok';
        state.imageModelsByLabel = imageModelsByLabel || {};
        state.videoModelsByLabel = videoModelsByLabel || {};
        state.error = null;
      })
      .addCase(fetchModelCredits.rejected, (state, action) => {
        state.status = 'error';
        state.error = action.payload?.message || 'Failed to load model credit configuration';
      });
  },
});

// Returns the `{ [label]: credits }` map for image models. Consumers look
// up by the API's display label (e.g. 'Nano Banana Pro'). Returns an empty
// object until the fetch resolves.
export const selectImageCreditsByLabel = (state) =>
  state.modelCredits.imageModelsByLabel;
export const selectVideoCreditsByLabel = (state) =>
  state.modelCredits.videoModelsByLabel;
export const selectModelCreditsStatus = (state) => state.modelCredits.status;

export default modelCreditsSlice.reducer;
