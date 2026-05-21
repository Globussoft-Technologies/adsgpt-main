import { fetchAdHistory, fetchAdHistoryTitles } from '@/store/actions/adStudio/adHistoryActions';
import { createSlice } from '@reduxjs/toolkit';
import { v4 as uuidv4 } from 'uuid';

// Load existing sessionId or create a new one
let em1 = sessionStorage.getItem('em1');

if (!em1) {
  em1 = uuidv4();
  sessionStorage.setItem('em1', em1);
}

const initialState = {
  em1,
  todayTitles: [],
  yesterdayTitles: [],
  last7DaysTitles: [],
  olderTitles: [],
  loading: false,
  error: null,
  activeSessionId: '',
};

const adInsitesTabsSlice = createSlice({
  name: 'addieHistory',
  initialState,
  reducers: {
    createNewSessionAddie: (state, action) => {
      state.em1 = uuidv4();
      state.activeSessionId = state.em1;
      sessionStorage.setItem('em1', state.em1);
    },
    setActiveSessionId: (state, action) => {
      state.activeSessionId = action.payload;
    },
    // In your adHistorySlice.js
    removeHistoryItem: (state, action) => {
      const { sessionId, type } = action.payload;

      switch (type) {
        case 'today':
          state.todayTitles = state.todayTitles.filter((item) => item.sessionId !== sessionId);
          break;
        case 'yesterday':
          state.yesterdayTitles = state.yesterdayTitles.filter(
            (item) => item.sessionId !== sessionId
          );
          break;
        case 'last7Days':
          state.last7DaysTitles = state.last7DaysTitles.filter(
            (item) => item.sessionId !== sessionId
          );
          break;
        case 'older':
          state.olderTitles = state.olderTitles.filter((item) => item.sessionId !== sessionId);
          break;
        default:
          break;
      }
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchAdHistoryTitles.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchAdHistoryTitles.fulfilled, (state, action) => {
        const titles = action.payload;
        state.todayTitles = titles?.today || [];
        state.yesterdayTitles = titles?.yesterday || [];
        state.last7DaysTitles = titles?.last7Days || [];
        state.olderTitles = titles?.older || [];
        state.loading = false;
      })
      .addCase(fetchAdHistoryTitles.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      });

    builder
      .addCase(fetchAdHistory.pending, (state) => {
        // state.loading = true;
        state.error = null;
      })
      .addCase(fetchAdHistory.fulfilled, (state, action) => {
        const conversations = action?.payload?.conversations || [];
        const type = action?.payload?.type;
        const sessionId = action?.payload?.sessionId;
        if (Array.isArray(conversations) && conversations.length > 0 && type === 'emulator') {
          state.em1 = sessionId;
          state.activeSessionId = sessionId;
          sessionStorage.setItem('em1', state.em1);
        }
      })
      .addCase(fetchAdHistory.rejected, (state, action) => {
        state.error = action.payload;
      });
  },
});

export const { createNewSessionAddie, setActiveSessionId, removeHistoryItem } =
  adInsitesTabsSlice.actions;
export default adInsitesTabsSlice.reducer;
