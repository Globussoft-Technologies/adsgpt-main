import { createSlice } from '@reduxjs/toolkit';


const initialState = {
  /** Whether the onboarding overlay is currently mounted */
  isOpen: false,
  /** true  → Welcome modal is shown (pre-tour)
   *  false → Interactive tour steps are shown */
  isWelcomeStep: true,
  /** 0-based index into TOUR_STEPS */
  currentStep: 0,
  /** Persisted flag — true once user completes or skips */
  hasCompleted: false,
};

const onboardingSlice = createSlice({
  name: 'onboarding',
  initialState,
  reducers: {
    /**
     * Opens the onboarding overlay. Checks localStorage first so returning
     * users are never shown the overlay again without an explicit reset.
     */
    openOnboarding: (state) => {
      state.isOpen = true;
      state.isWelcomeStep = true;
      state.currentStep = 0;
      state.hasCompleted = false;
    },
    /**
     * Transitions from the welcome modal to the interactive tour.
     */
    startTour: (state) => {
      state.isWelcomeStep = false;
      state.currentStep = 0;
    },
    /**
     * Advances to the next tour step.
     * @param {object} action.payload - total number of steps (to guard bounds)
     */
    nextStep: (state, action) => {
      const total = action.payload ?? Infinity;
      if (state.currentStep < total - 1) {
        state.currentStep += 1;
      }
    },
    /**
     * Goes back to the previous tour step.
     */
    prevStep: (state) => {
      if (state.currentStep > 0) {
        state.currentStep -= 1;
      }
    },
    /**
     * Jumps to a specific step index.
     */
    goToStep: (state, action) => {
      state.currentStep = action.payload;
    },
    /**
     * Marks onboarding as complete and closes the overlay.
     * The caller is responsible for also calling markOnboardingComplete() from
     * onboardingStorage.js so the flag persists to localStorage.
     */
    completeOnboarding: (state) => {
      state.isOpen = false;
      state.hasCompleted = true;
    },
    /**
     * Skips the tour — equivalent to complete from a state perspective.
     */
    skipOnboarding: (state) => {
      state.isOpen = false;
      state.hasCompleted = true;
    },
  },
});

export const {
  openOnboarding,
  startTour,
  nextStep,
  prevStep,
  goToStep,
  completeOnboarding,
  skipOnboarding,
} = onboardingSlice.actions;

export default onboardingSlice.reducer;
