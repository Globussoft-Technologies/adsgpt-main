import { createSlice } from '@reduxjs/toolkit';
import { fetchGenerationStats } from '@/store/actions/profile/usageActions';

const initialState = {
  loading: false,
  error: null,

  // Graph-ready data
  generationStats: [],
  totalImages: 0,
  totalVideos: 0,
};

const usageSlice = createSlice({
  name: 'usage',
  initialState,
  reducers: {
    resetGenerationStats(state) {
      state.generationStats = [];
      state.totalImages = 0;
      state.totalVideos = 0;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchGenerationStats.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchGenerationStats.fulfilled, (state, action) => {
        state.loading = false;

        state.generationStats = action.payload?.data || [];
        state.totalImages = action.payload?.total_images || 0;
        state.totalVideos = action.payload?.total_videos || 0;
      })
      .addCase(fetchGenerationStats.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      });
  },
});

export const { resetGenerationStats } = usageSlice.actions;
export default usageSlice.reducer;
