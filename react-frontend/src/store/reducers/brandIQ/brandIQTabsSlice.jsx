import {
  createBrandList,
  deleteBrand,
  fetchAudienceSuggestions,
  fetchBrands,
  fetchSavedItems,
  fetchSessionOfSavedItems,
  removeBrandImage,
  updateBrandList,
} from '@/store/actions/brandIQ/myBrandActions';
import { createSlice } from '@reduxjs/toolkit';

// Persist the active BrandIQ tab so a page reload keeps the user where they were
// (e.g. on "Competitors") instead of snapping back to "My Brands".
const TAB_STORAGE_KEY = 'brandIQActiveTab';
const getPersistedTab = () => {
  try {
    return localStorage.getItem(TAB_STORAGE_KEY) || 'myBrands';
  } catch {
    return 'myBrands';
  }
};

const initialState = {
  activeBrandIQTabId: getPersistedTab(),
  myBrands: [],
  myGallery: [],
  getSession: [],
  getSessionLoading: false,
  galleryloading: false,
  loading: false,
  getSessionError: null,
  error: null,
  deleteLoading: false,
  updateLoading: false,
  audienceSuggestions: {}, // keyed by brandId
  audienceSuggestionsLoading: {},
  // Competitor Ads state
  competitorAds: [],
  competitorAdsLoading: false,
  competitorAdsError: null,
  selectedCompetitorBrand: null,
  selectedCompetitorPlatform: null,
};

const brandIQTabsSlice = createSlice({
  name: 'brandIQTabs',
  initialState,
  reducers: {
    setActiveBrandIQTab: (state, action) => {
      state.activeBrandIQTabId = action.payload; // payload = "myBrands" | "competitors" | "analytics"
      try {
        localStorage.setItem(TAB_STORAGE_KEY, action.payload);
      } catch {
        /* ignore storage errors */
      }
    },
    setBrandIQLoading: (state, action) => {
      state.loading = action.payload;
    },
    setBrandIQError: (state, action) => {
      state.error = action.payload;
      state.deleteLoading = false;
    },
    setGetSessionError: (state, action) => {
      state.getSessionError = action.payload;
      state.getSessionLoading = false;
    },
    setCompetitorAds: (state, action) => {
      state.competitorAds = action.payload;
    },
    setCompetitorAdsLoading: (state, action) => {
      state.competitorAdsLoading = action.payload;
    },
    setCompetitorAdsError: (state, action) => {
      state.competitorAdsError = action.payload;
      state.competitorAdsLoading = false;
    },
    setSelectedCompetitorBrand: (state, action) => {
      state.selectedCompetitorBrand = action.payload;
    },
    setSelectedCompetitorPlatform: (state, action) => {
      state.selectedCompetitorPlatform = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchBrands.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchBrands.fulfilled, (state, action) => {
        state.myBrands = action?.payload;
        state.loading = false;
      })
      .addCase(fetchBrands.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      });
    builder
      .addCase(fetchSavedItems.pending, (state) => {
        state.galleryloading = true;
        state.error = null;
      })
      .addCase(fetchSavedItems.fulfilled, (state, action) => {
        const { data, skip } = action.payload;
        const newItems = data?.data || [];

        if (skip === 0) {
          // First load - replace data
          state.myGallery = data;
        } else {
          // Subsequent loads - append data
          state.myGallery = {
            ...data,
            data: [...(state.myGallery?.data || []), ...newItems],
          };
        }

        state.galleryloading = false;
      })
      .addCase(fetchSavedItems.rejected, (state, action) => {
        state.galleryloading = false;
        state.error = action.payload;
      });
    builder
      .addCase(fetchSessionOfSavedItems.pending, (state) => {
        state.getSessionLoading = true;
        state.getSessionError = null;
      })
      .addCase(fetchSessionOfSavedItems.fulfilled, (state, action) => {
        state.getSession = action.payload;
        state.getSessionLoading = false;
      })
      .addCase(fetchSessionOfSavedItems.rejected, (state, action) => {
        state.getSessionLoading = false;
        state.getSessionError = action.payload;
      });
    builder
      .addCase(createBrandList.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(createBrandList.fulfilled, (state) => {
        state.loading = false;
      })
      .addCase(createBrandList.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      });
    builder
      .addCase(deleteBrand.pending, (state) => {
        state.deleteLoading = true;
        state.error = null;
      })
      .addCase(deleteBrand.fulfilled, (state) => {
        state.deleteLoading = false;
      })
      .addCase(deleteBrand.rejected, (state, action) => {
        state.deleteLoading = false;
        state.error = action.payload;
      });
    builder
      .addCase(updateBrandList.pending, (state) => {
        state.updateLoading = true;
        state.error = null;
      })
      .addCase(updateBrandList.fulfilled, (state) => {
        state.updateLoading = false;
      })
      .addCase(updateBrandList.rejected, (state, action) => {
        state.updateLoading = false;
        state.error = action.payload;
      });
    builder
      .addCase(removeBrandImage.pending, (state) => {
        state.updateLoading = true;
        state.error = null;
      })
      .addCase(removeBrandImage.rejected, (state, action) => {
        state.updateLoading = false;
        state.error = action.payload;
      });
    builder
      .addCase(fetchAudienceSuggestions.pending, (state, action) => {
        const brandId = action.meta.arg.brandId;
        state.audienceSuggestionsLoading[brandId] = true;
      })
      .addCase(fetchAudienceSuggestions.fulfilled, (state, action) => {
        const { brandId, suggestions } = action.payload;
        state.audienceSuggestions[brandId] = suggestions;
        state.audienceSuggestionsLoading[brandId] = false;
      })
      .addCase(fetchAudienceSuggestions.rejected, (state, action) => {
        const brandId = action.meta.arg.brandId;
        state.audienceSuggestionsLoading[brandId] = false;
      });
  },
});

export const { setActiveBrandIQTab, setBrandIQLoading, setBrandIQError, setGetSessionError, setCompetitorAds, setCompetitorAdsLoading, setCompetitorAdsError, setSelectedCompetitorBrand, setSelectedCompetitorPlatform } =
  brandIQTabsSlice.actions;
export default brandIQTabsSlice.reducer;
