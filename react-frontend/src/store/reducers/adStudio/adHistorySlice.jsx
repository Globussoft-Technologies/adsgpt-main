import {
  deleteAdHistory,
  fetchAdHistory,
  fetchAdHistoryTitles,
} from '@/store/actions/adStudio/adHistoryActions';
import { createSlice } from '@reduxjs/toolkit';
import { v4 as uuidv4 } from 'uuid';

// Load existing sessionId or create a new one
let acs1 = sessionStorage.getItem('acs1');
let acs2 = sessionStorage.getItem('acs2');
let avs3 = sessionStorage.getItem('avs3');
if (!acs1) {
  acs1 = uuidv4();
  sessionStorage.setItem('acs1', acs1);
}
if (!acs2) {
  acs2 = uuidv4();
  sessionStorage.setItem('acs2', acs2);
}
if (!avs3) {
  avs3 = uuidv4();
  sessionStorage.setItem('avs3', avs3);
}

const initialState = {
  acs1,
  acs2,
  avs3,
  todayTitles: [],
  yesterdayTitles: [],
  last7DaysTitles: [],
  olderTitles: [],
  loading: false,
  error: null,
  activeSessionId: '',
  isCopyHistory: false,
  isCreativeHistory: false,
  isVideoHistory: false,
  historyLoading: false,
  titlesLoading: false,
};

const adStudioTabsSlice = createSlice({
  name: 'adHistory',
  initialState,
  reducers: {
    createNewSession: (state, action) => {
      if (action.payload.tab === 'adCopy') {
        state.acs1 = uuidv4();
        state.activeSessionId = state.acs1;
        sessionStorage.setItem('acs1', state.acs1);
      }
      if (action.payload.tab === 'adCreative') {
        state.acs2 = uuidv4();
        state.activeSessionId = state.acs2;
        sessionStorage.setItem('acs2', state.acs2);
      }
      if (action.payload.tab === 'adVideo') {
        state.avs3 = uuidv4();
        state.activeSessionId = state.avs3;
        sessionStorage.setItem('avs3', state.avs3);
      }
    },
    setActiveSessionId: (state, action) => {
      state.activeSessionId = action.payload;
    },
    setAdCreativeSessionId: (state, action) => {
      state.acs2 = action.payload;
      state.activeSessionId = action.payload;
      sessionStorage.setItem('acs2', action.payload);
    },
    setAdVideoSessionId: (state, action) => {
      state.avs3 = action.payload;
      state.activeSessionId = action.payload;
      sessionStorage.setItem('avs3', action.payload);
    },
    setIsHistory: (state, action) => {
      const type = action.payload;
      switch (type) {
        case 'adCopy':
          state.isCopyHistory = true;
          state.isCreativeHistory = false;
          state.isVideoHistory = false;
          break;
        case 'adCreative':
          state.isCopyHistory = false;
          state.isCreativeHistory = true;
          state.isVideoHistory = false;
          break;
        case 'adVideo':
          state.isCopyHistory = false;
          state.isCreativeHistory = false;
          state.isVideoHistory = true;
          break;
        default:
          break;
      }
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchAdHistoryTitles.pending, (state) => {
        state.titlesLoading = true;
        state.error = null;
      })
      .addCase(fetchAdHistoryTitles.fulfilled, (state, action) => {
        const titles = action.payload;
        state.todayTitles = titles?.today || [];
        state.yesterdayTitles = titles?.yesterday || [];
        state.last7DaysTitles = titles?.last7Days || [];
        state.olderTitles = titles?.older || [];
        state.titlesLoading = false;
      })
      .addCase(fetchAdHistoryTitles.rejected, (state, action) => {
        state.titlesLoading = false;
        state.error = action.payload;
      });

    builder
      .addCase(fetchAdHistory.pending, (state) => {
        state.historyLoading = true;
        state.error = null;
      })
      .addCase(fetchAdHistory.fulfilled, (state, action) => {
        const conversations = action?.payload?.conversations || [];
        const type = action?.payload?.type;
        const sessionId = action?.payload?.sessionId;
        if (Array.isArray(conversations) && conversations.length > 0) {
          switch (type) {
            case 'adCopy':
              state.acs1 = sessionId;
              state.activeSessionId = sessionId;
              sessionStorage.setItem('acs1', state.acs1);
              break;
            case 'adCreative':
              state.acs2 = sessionId;
              state.activeSessionId = sessionId;
              sessionStorage.setItem('acs2', state.acs2);
              break;
            case 'adVideo':
              state.avs3 = sessionId;
              state.activeSessionId = sessionId;
              sessionStorage.setItem('avs3', state.avs3);
              break;
            default:
              break;
          }
        }
        state.historyLoading = false;
      })
      .addCase(fetchAdHistory.rejected, (state, action) => {
        state.error = action.payload;
        state.historyLoading = false;
      });

    builder
      .addCase(deleteAdHistory.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(deleteAdHistory.fulfilled, (state, action) => {
        const { sessionId, type } = action.payload;
        switch (type) {
          case 'today':
            state.todayTitles = state.todayTitles.filter((t) => t?.sessionId !== sessionId);
            break;
          case 'yesterday':
            state.yesterdayTitles = state.yesterdayTitles.filter((t) => t?.sessionId !== sessionId);
            break;
          case '7days':
            state.last7DaysTitles = state.last7DaysTitles.filter((t) => t?.sessionId !== sessionId);
            break;
          case 'older':
            state.olderTitles = state.olderTitles.filter((t) => t?.sessionId !== sessionId);
            break;
          default:
            break;
        }
        state.loading = false;
      })
      .addCase(deleteAdHistory.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      });
  },
});

export const {
  createNewSession,
  setActiveSessionId,
  setAdCreativeSessionId,
  setAdVideoSessionId,
  setIsHistory,
} = adStudioTabsSlice.actions;
export default adStudioTabsSlice.reducer;
