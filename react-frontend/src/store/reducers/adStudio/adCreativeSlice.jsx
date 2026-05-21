// adCopySlice.js
import { fetchExploreAds } from '@/store/actions/adStudio/adCreativeActions';
import { fetchAdHistory } from '@/store/actions/adStudio/adHistoryActions';
import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  conversations: [],
  exploreAds: [],
  exploreAdsLoading: false,
  onScrollLoading: false,
  exploreSkip: 0,
  exploreCompetitor: '',
  explorePlatform: '',
  exploreSearchTerm: 'competitor',
  exploreHasMore: true,
  isLoading: false,
  botTimeouts: {},
  timers: {},
  isSending: false,
};

const adCreativeSlice = createSlice({
  name: 'adCreative',
  initialState,
  reducers: {
    setExploreCompetitor: (state, action) => {
      state.exploreCompetitor = action.payload;
    },
    setExplorePlatform: (state, action) => {
      state.explorePlatform = action.payload;
    },
    setExploreSearchTerm: (state, action) => {
      state.exploreSearchTerm = action.payload;
    },
    setFeedBack: (state, action) => {
      const { botId, index, feedback } = action.payload;
      const botMsg = state.conversations.find((c) => c?.type === 'bot' && c?.id === botId);
      if (botMsg && botMsg.ads[index]) {
        botMsg.ads = botMsg.ads.map((ad, i) => (i === index ? { ...ad, feedback } : ad));
      }
    },
    addConversation: (state, action) => {
      state.conversations.push(action.payload);
    },
    setIsSending: (state, action) => {
      state.isSending = action.payload;
    },
    updateAdCreativeBotConversation: (state, action) => {
      const data = action.payload;

      // Find the last incomplete bot message for this chatId
      const botMsg = [...state.conversations]
        .reverse()
        .find((c) => c?.type === 'bot' && !c?.complete && c?.id === data?.chatId);

      if (botMsg) {
        if (data?.type === 'text') {
          let ads = [...botMsg.ads];

          // Add start/end acknowledgements
          if (data?.starting_acknowledgement) {
            botMsg.start_message = data.starting_acknowledgement;
          }
          if (data?.end_acknowledgement) {
            botMsg.end_message = data.end_acknowledgement;
          }

          // Handle ad copies
          if (data?.ad_copies && Object.keys(data.ad_copies).length > 0) {
            Object.values(data.ad_copies).forEach((ad, index) => {
              if (ads[index]) {
                ads[index] = {
                  ...ads[index],
                  text_ad: ad,
                  text_complete: true,
                };
              }
            });
          } else {
            // Handle empty/error ad copies
            ads = ads.map((ad) => ({
              ...ad,
              text_ad: "Couldn't generate Ad Copy for this. Please try again...",
              text_complete: true,
            }));
          }

          // Update completion flags
          const allTextComplete = ads.every((ad) => ad?.text_complete);
          const allImageComplete = ads.every((ad) => ad?.image_complete);

          botMsg.ads = ads;
          botMsg.complete = allTextComplete && allImageComplete;
        }

        if (data?.type === 'image') {
          let ads = [...botMsg.ads];
          let images = data?.images;
          let num = data?.num_images || 1;
          const failedValue = images?.find((img) => img == 'failed' || img == '400');

          if (failedValue) {
            images = Array(num).fill(failedValue);
          }
          images.forEach((image, index) => {
            if (ads[index]) {
              ads[index] = {
                ...ads[index],
                image_ad: image?.base_image_with_logo || image,
                logo: image?.logo || '',
                base_image: image?.base_image || '',
                image_complete: true,
              };
            }
          });

          // Update completion flags
          const allTextComplete = ads.every((ad) => ad.text_complete);
          const allImageComplete = ads.every((ad) => ad.image_complete);

          botMsg.ads = ads;
          botMsg.complete = allTextComplete && allImageComplete;
        }
      }
    },
    updateAdCreativeEditorFields: (state, action) => {
      const { botId, index, field, value } = action.payload;
      const botMsg = state.conversations.find((c) => c?.type === 'bot' && c?.id === botId);
      if (botMsg && botMsg.ads[index]) {
        botMsg.ads[index][field] = value; // mutate safely
      }
    },
    registerTimeout: (state, action) => {
      const { botId, timeoutId } = action.payload;
      state.botTimeouts[botId] = timeoutId;
    },
    markBotMessageFailed: (state, action) => {
      const botId = action.payload;
      const botMsg = state.conversations.find((c) => c.type === 'bot' && c.id === botId);

      if (botMsg && !botMsg.complete) {
        let ads = [...botMsg.ads];
        botMsg.start_message = 'Hey there! Here’s an ad creative for you.';
        ads.map((ad) => {
          ad.text_ad = '⚠️ Could not generate ad copy. Please try again.';
          ad.text_complete = true;
          ad.image_ad = 'failed';
          ad.image_complete = true;
          return ad;
        });
        botMsg.ads = ads;
        botMsg.complete = true;

        delete state.botTimeouts[botId];
      }
    },
    clearCreativeBotTimeout: (state, action) => {
      const botId = action.payload;
      if (state.botTimeouts?.[botId]) {
        clearTimeout(state.botTimeouts[botId]);
        delete state.botTimeouts[botId];
      }
    },
    clearConversations: (state) => {
      state.conversations = [];
    },

    setLoading: (state, action) => {
      state.isLoading = action.payload;
    },
    setSkip: (state, action) => {
      state.exploreSkip = action.payload;
    },
    setTimer: (state, action) => {
      const { adId, startTime, duration } = action.payload;
      state.timers[adId] = { startTime, duration };
    },
    clearTimer: (state, action) => {
      delete state.timers[action.payload];
    },
    resetAdCreativeSlice: () => ({ ...initialState }),
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchAdHistory.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchAdHistory.fulfilled, (state, action) => {
        const conversations = action?.payload?.conversations || [];
        const type = action?.payload?.type;
        if (Array.isArray(conversations) && conversations.length > 0 && type === 'adCreative') {
          state.conversations = conversations;
        }
      })
      .addCase(fetchAdHistory.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      });
    builder
      .addCase(fetchExploreAds.pending, (state) => {
        const skip = state.exploreSkip || 0;
        if (skip > 0) {
          state.onScrollLoading = true;
        } else {
          state.exploreAdsLoading = true;
        }
      })
      .addCase(fetchExploreAds.fulfilled, (state, action) => {
        const ads = action?.payload;
        const skip = state.exploreSkip || 0;
        if (Array.isArray(ads) && ads.length > 0) {
          if (skip === 0) {
            state.exploreAds = ads;
          } else {
            state.exploreAds = [...state.exploreAds, ...ads];
          }
          state.exploreSkip = skip + 10;
          state.exploreHasMore = true;
        } else {
          state.exploreHasMore = false;
          if (skip === 0) state.exploreAds = [];
        }
        state.exploreAdsLoading = false;
        state.onScrollLoading = false;
      })
      .addCase(fetchExploreAds.rejected, (state) => {
        state.exploreAdsLoading = false;
        state.onScrollLoading = false;
      });
  },
});

export const {
  addConversation,
  clearCreativeBotTimeout,
  clearConversations,
  markBotMessageFailed,
  registerTimeout,
  setLoading,
  resetAdCreativeSlice,
  updateAdCreativeBotConversation,
  setExploreCompetitor,
  setExploreSearchTerm,
  setSkip,
  setFeedBack,
  setExplorePlatform,
  updateAdCreativeEditorFields,
  setTimer,
  clearTimer,
  setIsSending,
} = adCreativeSlice.actions;

export default adCreativeSlice.reducer;
