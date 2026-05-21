import { createSlice } from '@reduxjs/toolkit';
import { fetchCompetitorAds } from '@/store/actions/feature/competitorSearchActions';

const initialState = {
  ads: [],
  skip: 0, // mirrors adCreativeSlice.exploreSkip
  hasMore: true,
  loading: false,
  error: null,
  searchTerm: '',
  searchType: 'competitor',
  onScrollLoading: false,
};

const competitorSearchSlice = createSlice({
  name: 'competitorSearch',
  initialState,
  reducers: {
    resetCompetitorSearch: (state) => {
      // Preserve searchTerm and searchType so scroll fetches keep reading
      // the right values. Only reset pagination and results.
      state.ads = [];
      state.skip = 0;
      state.hasMore = true;
      state.loading = true;
      state.onScrollLoading = false;
      state.error = null;
    },
    setSearchTerm: (state, action) => {
      state.searchTerm = action.payload;
    },
    setSearchType: (state, action) => {
      state.searchType = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder
      // ── pending: check skip (same as adCreativeSlice checking exploreSkip) ──
      .addCase(fetchCompetitorAds.pending, (state) => {
        const skip = state.skip || 0;
        if (skip > 0) {
          state.onScrollLoading = true;
        } else {
          state.loading = true;
        }
        state.error = null;
      })

      // ── fulfilled: exact same logic as adCreativeSlice.fetchExploreAds ──
      .addCase(fetchCompetitorAds.fulfilled, (state, action) => {
        const ads = action.payload?.ads || [];
        const skip = state.skip || 0; // read BEFORE mutating, same as adCreativeSlice

        if (Array.isArray(ads) && ads.length > 0) {
          if (skip === 0) {
            state.ads = ads; // fresh search — replace
          } else {
            state.ads = [...state.ads, ...ads]; // scroll — append
          }
          state.skip = skip + 10;
          state.hasMore = true; // ← match adCreativeSlice: true whenever results > 0
        } else {
          state.hasMore = false; // ← only false when 0 results returned
          if (skip === 0) state.ads = [];
        }

        state.loading = false;
        state.onScrollLoading = false;
      })

      .addCase(fetchCompetitorAds.rejected, (state, action) => {
        state.loading = false;
        state.onScrollLoading = false;
        state.error = action.payload;
      });
  },
});

export const { resetCompetitorSearch, setSearchTerm, setSearchType } =
  competitorSearchSlice.actions;

export default competitorSearchSlice.reducer;
