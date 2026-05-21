// adCopySlice.js
import { fetchSuggestions } from '@/store/actions/adStudio/adCopyActions';
import { fetchAdHistory } from '@/store/actions/adStudio/adHistoryActions';
import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  conversations: [],
  suggestions: [
    {
      id: 1,
      icon: 'Lightbulb',
      text: '',
    },
    {
      id: 2,
      icon: 'Calendar',
      text: '',
    },
    {
      id: 3,
      icon: 'Megaphone',
      text: '',
    },
  ],
  isLoading: false,
  isTyping: false,
  suggestionsLoading: false,
  loading: false,
  error: null,
  botTimeouts: {},
  isSending: false,
};

const adCopySlice = createSlice({
  name: 'adCopy',
  initialState,
  reducers: {
    addConversation: (state, action) => {
      state.conversations.push(action.payload);
    },
    updateAdcopyBotConversation: (state, action) => {
      const { result, isLastChunk, chatId } = action.payload;

      // Find the last incomplete bot message
      const botMsg = [...state.conversations]
        .reverse()
        .find((c) => c.type === 'bot' && !c.complete && c.id === chatId);

      if (botMsg) {
        // Append the chunk to existing message
        botMsg.message += result || '';

        // Mark as complete when last chunk arrives
        if (isLastChunk) {
          botMsg.complete = true;
        }
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
        botMsg.message = '⚠️ Could not generate ad copy. Please try again.';
        botMsg.complete = true;
        state.isLoading = false;
        state.isTyping = false;

        delete state.botTimeouts[botId];
      }
    },
    clearBotTimeout: (state, action) => {
      const botId = action.payload;
      if (state.botTimeouts?.[botId]) {
        clearTimeout(state.botTimeouts[botId]);
        delete state.botTimeouts[botId];
      }
    },
    clearConversations: (state) => {
      state.conversations = [];
    },
    setSuggestions: (state, action) => {
      state.suggestions = action.payload;
    },
    clearSuggestions: (state) => {
      state.suggestions = [];
    },
    setLoading: (state, action) => {
      state.isLoading = action.payload;
    },
    setTyping: (state, action) => {
      state.isTyping = action.payload;
    },
    setIsSending: (state, action) => {
      state.isSending = action.payload;
    },
    resetAdCopySlice: () => ({ ...initialState }),
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchSuggestions.pending, (state) => {
        state.suggestionsLoading = true;
      })
      .addCase(fetchSuggestions.fulfilled, (state, action) => {
        state.suggestionsLoading = false;

        const updatedSuggestions = state.suggestions.map((suggestion, index) => {
          return {
            ...suggestion,
            text: action.payload[index]?.topic || '',
            id: action.payload[index]?._id,
          };
        });

        state.suggestions = updatedSuggestions;
      })
      .addCase(fetchSuggestions.rejected, (state) => {
        state.suggestionsLoading = false;
      });

    builder
      .addCase(fetchAdHistory.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchAdHistory.fulfilled, (state, action) => {
        const conversations = action?.payload?.conversations || [];
        const type = action?.payload?.type;
        if (Array.isArray(conversations) && conversations.length > 0 && type === 'adCopy') {
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
  setSuggestions,
  clearSuggestions,
  setLoading,
  updateAdcopyBotConversation,
  setTyping,
  resetAdCopySlice,
  registerTimeout,
  markBotMessageFailed,
  clearBotTimeout,
  setIsSending,
} = adCopySlice.actions;

export default adCopySlice.reducer;
