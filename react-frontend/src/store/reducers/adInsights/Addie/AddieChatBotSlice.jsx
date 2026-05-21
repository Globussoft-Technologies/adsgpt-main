import {
  getFaqData,
  freshUserData,
  fetchAdsOnScroll,
} from '@/store/actions/adInsights/addieActions';
import { fetchAdHistory } from '@/store/actions/adStudio/adHistoryActions';
import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  conversations: [],
  addiemessageLoader: false,
  addieChatVisibility: false,
  showAddieHistory: false,
  showWelcomePage: true,
  showAdvertiserSearch: false,
  selectedBrands: [],
  brandInput: '',
  adData: [],
  analyticsData: [],
  engagementData: [],
  postOwnerData: [],
  ctaData: [],
  geoData: [],
  faqData: [],
  faqLoading: false,
  isLoading: false,
  isTyping: false,
  isFreshUser: true,
  botTimeouts: {},
  currentContext: {
    errorMessage: '',
    currentContext: [],
    contextId: 3,
    network: [],
    postOnwer: [],
  },
  suggestionAds: [],
  loading: true,
  historyError: null,
  error: null,
  // Add infinite scrolling states
  hasMore: true,
  totalCount: 0,
  skip: 0,
  scrollSkip: 0,
  isEmulatorHistory: false,
  scrollLoading: false, // Separate loading state for scroll to avoid UI flickering
};

const addieSlice = createSlice({
  name: 'addie',
  initialState,
  reducers: {
    setAddieChatVisibility: (state, action) => {
      state.addieChatVisibility = action.payload;
    },
    setAddiemessageLoader: (state, action) => {
      state.addiemessageLoader = action.payload;
    },
    toggleAddieChatVisibility: (state) => {
      state.addieChatVisibility = !state.addieChatVisibility;
    },
    toggleAddieHistory: (state) => {
      state.showAddieHistory = !state.showAddieHistory;
    },
    addtoggleAddieChatVisibility: (state, action) => {
      state.addieChatVisibility = action.payload;
    },
    setShowWelcomePage: (state, action) => {
      state.showWelcomePage = action.payload;
    },
    setAddieConversation: (state, action) => {
      state.conversations.push(action.payload);
    },
    setSuggestionAds: (state, action) => {
      state.suggestionAds = action.payload;
    },
    updateAddieConversation: (state, action) => {
      const { message, isFinalResponse, chatId } = action.payload;

      // Find the last incomplete bot message
      const botMsg = [...state.conversations]
        .reverse()
        .find((c) => c?.type === 'bot' && !c?.isFinalResponse && c?.id === chatId);

      if (botMsg) {
        // Append the chunk to existing message
        botMsg.message += message || '';

        // Mark as complete when last chunk arrives
        if (isFinalResponse) {
          botMsg.isFinalResponse = true;
        }
      }
    },
    registerTimeout: (state, action) => {
      const { botId, timeoutId } = action.payload;
      state.botTimeouts[botId] = timeoutId;
    },
    markBotMessageFailed: (state, action) => {
      const botId = action.payload;
      const botMsg = state.conversations.find((c) => c?.type === 'bot' && c?.id === botId);

      if (botMsg && !botMsg?.complete) {
        botMsg.message = '⚠️ Could not generate Chat Response. Please try again.';
        botMsg.isFinalResponse = true;
        state.isLoading = false;
        state.isTyping = false;

        delete state.botTimeouts[botId];
      }
    },
    clearAddieBotTimeout: (state, action) => {
      const botId = action.payload;
      if (state.botTimeouts?.[botId]) {
        clearTimeout(state.botTimeouts[botId]);
        delete state.botTimeouts[botId];
      }
    },
    adAdsData: (state, action) => {
      state.adData = action.payload;
    },
    adAnalyticsData: (state, action) => {
      state.analyticsData = action.payload;
    },
    adEngagementData: (state, action) => {
      state.engagementData = action.payload;
    },
    adPostOwnerData: (state, action) => {
      state.postOwnerData = action.payload;
    },
    adCtaData: (state, action) => {
      state.ctaData = action.payload;
    },
    adGeoData: (state, action) => {
      state.geoData = action.payload;
    },
    adFaqData: (state, action) => {
      state.faqData = action.payload;
    },
    setAddieLoading: (state, action) => {
      state.isLoading = action.payload;
    },
    setAddieTyping: (state, action) => {
      state.isTyping = action.payload;
    },
    setCurrentContext: (state, action) => {
      state.currentContext = action.payload;
    },
    setIsFreshUser: (state, action) => {
      state.isFreshUser = action.payload;
    },
    setScrollSkip: (state, action) => {
      state.scrollSkip = action.payload;
    },
    // Advertiser search reducers
    setShowAdvertiserSearch: (state, action) => {
      state.showAdvertiserSearch = action.payload;
    },

    setSelectedBrands: (state, action) => {
      state.selectedBrands = action.payload;
    },

    setBrandInput: (state, action) => {
      state.brandInput = action.payload;
    },

    addBrand: (state, action) => {
      const brand = action.payload;

      // Clean and split the input brand
      const cleanedBrand = brand
        ?.split(',')
        ?.map((b) => b?.trim())
        ?.filter((b) => b?.length > 0);

      if (cleanedBrand?.length === 0) return;

      // Clean existing brands (remove leading/trailing commas and trim)
      const cleanExistingBrands = (state.selectedBrands || [])
        ?.map((b) => b?.replace(/^,+|,+$/g, '')?.trim())
        ?.filter((b) => b?.length > 0);

      // Combine and remove duplicates
      const allBrands = [...cleanExistingBrands, ...cleanedBrand];
      const uniqueBrands = [...new Set(allBrands)]?.filter((brand) => brand?.length > 0);

      state.selectedBrands = uniqueBrands;
      state.brandInput = '';
    },

    removeBrand: (state, action) => {
      const brandToRemove = action.payload;
      state.selectedBrands = state.selectedBrands?.filter((brand) => brand !== brandToRemove);
    },

    clearBrands: (state) => {
      state.selectedBrands = [];
      state.brandInput = '';
    },

    // New reducers for infinite scrolling
    resetScrollState: (state) => {
      state.hasMore = true;
      state.totalCount = 0;
      state.scrollSkip = 0;
      state.scrollLoading = false;
    },
    setLoading: (state, action) => {
      state.loading = action.payload;
    },
    setScrollLoading: (state, action) => {
      state.scrollLoading = action.payload;
    },
    setHasMore: (state, action) => {
      state.hasMore = action.payload;
    },
    setIsEmulatorHistory: (state, action) => {
      state.isEmulatorHistory = action.payload;
    },
    // 3. Reset all fields back to initial state
    resetAddieStates: (state) => {
      // Define which states to preserve
      const statesToPreserve = {
        addieChatVisibility: state.addieChatVisibility,
      };

      return {
        ...initialState,
        ...statesToPreserve,
      };
    },
  },

  extraReducers: (builder) => {
    builder
      .addCase(freshUserData.pending, (state) => {
        state.loading = true;
        state.error = null;
        // Reset scroll state when fresh data is loaded
        state.hasMore = true;
        state.skip = 0;
      })
      .addCase(freshUserData.fulfilled, (state, action) => {
        const adsData = action?.payload || [];

        // Extract data from API response
        const adData = adsData?.length > 0 && adsData[0]?.adsData ? adsData[0]?.adsData : [];
        const analyticsData = adsData?.length > 1 ? adsData[1] : {};
        const bottomAnalytics = adsData?.length > 2 ? adsData[2]?.analyticsChart : [];

        // Extract specific charts from the bottom analytics
        const engagementData =
          bottomAnalytics?.find(
            (chart) => chart?.title === 'Engagement Comparison Across Ad Formats'
          ) || {};
        const postOwnerData =
          bottomAnalytics?.find((chart) => chart?.title === 'Ad Count by Post Owner') || {};
        const ctaData =
          bottomAnalytics?.find((chart) => chart?.title === 'Distribution of Call to Actions') ||
          {};
        const geoData =
          bottomAnalytics?.find((chart) => chart?.title === 'Geographical Distribution of Ads') ||
          {};

        state.adData = adData;
        state.analyticsData = analyticsData;
        state.engagementData = engagementData;
        state.postOwnerData = postOwnerData;
        state.ctaData = ctaData;
        state.geoData = geoData;
        state.loading = false;

        // Set scroll state for fresh data
        state.hasMore = adData?.length >= 20; // Assuming 20 is your limit
        state.totalCount = adData?.length;
        state.skip = adData?.length;
      })
      .addCase(freshUserData.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      });

    builder
      .addCase(getFaqData.pending, (state) => {
        state.faqLoading = true;
        state.error = null;
      })
      .addCase(getFaqData.fulfilled, (state, action) => {
        state.faqData = action?.payload || [];
        state.faqLoading = false;
      })
      .addCase(getFaqData.rejected, (state, action) => {
        state.faqLoading = false;
        state.error = action.payload;
      });

    builder
      .addCase(fetchAdHistory.pending, (state) => {
        state.loading = true;
        state.historyError = null;
        // state.hasMore = true;
        // state.skip = 0;
      })
      .addCase(fetchAdHistory.fulfilled, (state, action) => {
        const type = action?.payload?.type;
        const conversations = action?.payload?.conversations || [];

        // Extract data from API response
        const adsData = action?.payload?.emulatorData?.adsData?.adsData || [];
        const analyticsData = action?.payload?.emulatorData?.analyticsChartTop || {};
        const bottomAnalytics = action?.payload?.emulatorData?.analyticsChart || [];
        const currentContext = action?.payload?.emulatorData?.currentContext || {};
        // Extract specific charts from the bottom analytics
        const engagementData =
          bottomAnalytics?.find(
            (chart) => chart?.title === 'Engagement Comparison Across Ad Formats'
          ) || {};
        const postOwnerData =
          bottomAnalytics?.find((chart) => chart?.title === 'Ad Count by Post Owner') || {};
        const ctaData =
          bottomAnalytics?.find((chart) => chart?.title === 'Distribution of Call to Actions') ||
          {};
        const geoData =
          bottomAnalytics?.find((chart) => chart?.title === 'Geographical Distribution of Ads') ||
          {};

        if (Array.isArray(conversations) && conversations?.length > 0 && type === 'emulator') {
          state.conversations = conversations;
          state.engagementData = engagementData;
          state.postOwnerData = postOwnerData;
          state.ctaData = ctaData;
          state.geoData = geoData;
          state.adData = adsData;
          state.analyticsData = analyticsData;
          state.currentContext = currentContext;

          // Set scroll state for history data
          // state.hasMore = adsData.length >= 20;
          // state.totalCount = adsData.length;
          // state.skip = adsData.length;
        }

        state.loading = false;
      })
      .addCase(fetchAdHistory.rejected, (state, action) => {
        state.historyError = action.payload;
        // state.scrollLoading = false;
      });

    builder
      .addCase(fetchAdsOnScroll.pending, (state) => {
        state.scrollLoading = true;
        state.error = null;
      })
      .addCase(fetchAdsOnScroll.fulfilled, (state, action) => {
        const responseData = action?.payload || {};
        const newAdsData = responseData?.adsData?.adsData || [];
        const currentSkip = action?.meta?.arg?.skip || 0;

        if (currentSkip === 0) {
          // Initial load - replace existing data
          state.adData = newAdsData;
        } else {
          // Append new data for infinite scroll
          state.adData = [...state.adData, ...newAdsData];
        }

        // Update scroll state
        state.hasMore = newAdsData?.length >= 20; // Assuming 20 is your limit
        state.totalCount = state.adData?.length;
        state.scrollSkip = currentSkip;
        state.scrollLoading = false;
      })
      .addCase(fetchAdsOnScroll.rejected, (state, action) => {
        state.scrollLoading = false;
        state.error = action.payload;
        state.hasMore = false; // Stop trying to load more on error
      });
  },
});

export const {
  setAddieChatVisibility,
  setAddiemessageLoader,
  toggleAddieChatVisibility,
  toggleAddieHistory,
  addtoggleAddieChatVisibility,
  setShowWelcomePage,
  adAdsData,
  adAnalyticsData,
  adEngagementData,
  adPostOwnerData,
  adCtaData,
  adGeoData,
  adFaqData,
  setAddieConversation,
  updateAddieConversation,
  setAddieTyping,
  setAddieLoading,
  resetAddieStates,
  registerTimeout,
  markBotMessageFailed,
  clearAddieBotTimeout,
  setCurrentContext,
  resetScrollState,
  setScrollLoading,
  setIsFreshUser,
  setScrollSkip,
  setHasMore,
  setShowAdvertiserSearch,
  setSelectedBrands,
  setBrandInput,
  addBrand,
  removeBrand,
  clearBrands,
  setLoading,
  setIsEmulatorHistory,
  setSuggestionAds,
} = addieSlice.actions;

export default addieSlice.reducer;
