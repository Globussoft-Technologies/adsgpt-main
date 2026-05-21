import { fetchAdHistory } from '@/store/actions/adStudio/adHistoryActions';
import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  conversations: [],
  isLoading: false,
  botTimeouts: {},
  isSending: false,
};

const adVideoSlice = createSlice({
  name: 'adVideo',
  initialState,
  reducers: {
    addConversation: (state, action) => {
      state.conversations.push(action.payload);
    },
    updateAdVideoBotConversation: (state, action) => {
      const data = action.payload;
      const botMsg = [...state.conversations]
        .reverse()
        .find((c) => c?.type === 'bot' && !c?.complete && c?.id === data?.session?.chatId);

      if (botMsg) {
        if (data?.queryResult?.type === 'video') {
          let ads = [...botMsg.ads];
          let videos = data?.queryResult?.videoUrl;
          let num = data?.queryResult?.numVideos || 1;
          const failedValue = videos?.find((video) => video == 'failed' || video == '400');

          if (failedValue) {
            videos = Array(num).fill(failedValue);
          }
          videos?.forEach((video, index) => {
            if (ads[index]) {
              ads[index] = {
                ...ads[index],
                video_ad: video,
                video_complete: true,
              };
            }
          });

          // Update completion flags
          const allVideoComplete = ads?.every((ad) => ad?.video_complete);

          botMsg.ads = ads;
          botMsg.complete = allVideoComplete;
        }
      }
    },
    registerVideoTimeout: (state, action) => {
      const { botId, timeoutId } = action.payload;
      state.botTimeouts[botId] = timeoutId;
    },
    markVideoBotMessageFailed: (state, action) => {
      const botId = action.payload;
      const botMsg = state.conversations.find((c) => c.type === 'bot' && c.id === botId);

      if (botMsg && !botMsg.complete) {
        let ads = [...botMsg.ads];
        ads?.map((ad) => {
          ad.video_ad = 'failed';
          ad.video_complete = true;
          return ad;
        });
        botMsg.ads = ads;
        botMsg.complete = true;

        delete state.botTimeouts[botId];
      }
    },
    clearVideoBotTimeout: (state, action) => {
      const botId = action.payload;
      if (state.botTimeouts?.[botId]) {
        clearTimeout(state.botTimeouts[botId]);
        delete state.botTimeouts[botId];
      }
    },
    clearConversations: (state) => {
      state.conversations = [];
    },
    setIsSending: (state, action) => {
      state.isSending = action.payload;
    },
    setLoading: (state, action) => {
      state.isLoading = action.payload;
    },
    resetAdVideoSlice: () => ({ ...initialState }),
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
        if (Array.isArray(conversations) && conversations.length > 0 && type === 'adVideo') {
          state.conversations = conversations;
        }
      })
      .addCase(fetchAdHistory.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      });
  },
});

export const {
  addConversation,
  clearConversations,
  markVideoBotMessageFailed,
  clearVideoBotTimeout,
  registerVideoTimeout,
  setLoading,
  resetAdVideoSlice,
  updateAdVideoBotConversation,
  setIsSending,
} = adVideoSlice.actions;

export default adVideoSlice.reducer;
