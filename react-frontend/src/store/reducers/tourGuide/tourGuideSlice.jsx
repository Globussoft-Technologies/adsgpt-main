import { checkUserExists, markUserOnboardingComplete } from '@/store/actions/tourGuide/tourGuideActions';
import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  /** true = user document exists in checkUserExists collection (already onboarded) */
  userExists: false,
  showTour: false,
  loading: false,
  /** true once the checkUserExists API call has settled (fulfilled or rejected) */
  hasChecked: false,
  tourStep: 0,
};

const tourGuideSlice = createSlice({
  name: 'tourGuide',
  initialState,
  reducers: {
    setShowTour: (state, action) => {
      state.showTour = action.payload;
    },
    setTourStep: (state, action) => {
      state.tourStep = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder
      // ── checkUserExists ──────────────────────────────────────────────────────
      .addCase(checkUserExists.pending, (state) => {
        state.loading = true;
      })
      .addCase(checkUserExists.fulfilled, (state, action) => {
        state.userExists = Boolean(action.payload);
        state.loading = false;
        state.hasChecked = true;
      })
      .addCase(checkUserExists.rejected, (state) => {
        // On error or failed API check, set hasChecked = true and userExists = false
        // so the onboarding feature is triggered safely.
        state.loading = false;
        state.hasChecked = true;
        state.userExists = false;
      })

      // ── markUserOnboardingComplete ───────────────────────────────────────────
      .addCase(markUserOnboardingComplete.fulfilled, (state) => {
        // User has just completed/skipped — mark as onboarded in local state
        // so they are never shown the tour again this session.
        state.userExists = true;
        state.hasChecked = true;
      });
  },
});

export const { setShowTour, setTourStep } = tourGuideSlice.actions;
export default tourGuideSlice.reducer;
