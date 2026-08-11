/**
 * Onboarding feature barrel export.
 *
 * All onboarding code lives under:
 *   react-frontend/src/components/onboarding/   — UI components
 *   react-frontend/src/store/reducers/onboarding/ — Redux slice
 *   react-frontend/src/hooks/useOnboarding.js    — hook
 *   react-frontend/src/data/tourSteps.js         — step data
 *
 * Import from '@/onboarding' to access any public API.
 */

// Default export — Provider component rendered in Layout.jsx
export { default } from '@/components/onboarding/OnboardingProvider';

// Redux slice actions
export {
  default as onboardingReducer,
  openOnboarding,
  startTour,
  nextStep,
  prevStep,
  goToStep,
  completeOnboarding,
  skipOnboarding,
} from '@/store/reducers/onboarding/onboardingSlice';

// Async thunks
export { checkUserExists, markUserOnboardingComplete, resetUserOnboarding } from '@/store/actions/tourGuide/tourGuideActions';
