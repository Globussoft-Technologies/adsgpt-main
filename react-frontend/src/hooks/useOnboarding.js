import { useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import {
  openOnboarding,
  startTour,
  nextStep,
  prevStep,
  goToStep,
  completeOnboarding,
  skipOnboarding,
} from '@/store/reducers/onboarding/onboardingSlice';
import { markUserOnboardingComplete } from '@/store/actions/tourGuide/tourGuideActions';
import TOUR_STEPS from '@/data/tourSteps';
import { setActiveAdStudioTab } from '@/store/reducers/adStudio/adStudioTabsSlice';

import getUserIdFromToken from '@/utils/getUserIdFromToken';

/**
 * useOnboarding
 *
 * Manages onboarding tour state and saves completion status directly
 * to the MongoDB checkUserExists collection via backend API.
 */
const useOnboarding = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { isOpen, isWelcomeStep, currentStep, hasCompleted } = useSelector(
    (state) => state.onboarding
  );
  const socketUserId = useSelector((state) => state.socket?.userData?.user_id);
  const userId = socketUserId || getUserIdFromToken();

  const totalSteps = TOUR_STEPS.length;
  const step = TOUR_STEPS[currentStep] ?? null;
  const isFirstStep = currentStep === 0;
  const isLastStep = currentStep === totalSteps - 1;

  const open = useCallback(() => dispatch(openOnboarding()), [dispatch]);

  const begin = useCallback(() => dispatch(startTour()), [dispatch]);

  const handleCompleteOrSkip = useCallback(() => {
    const targetId = userId || getUserIdFromToken();
    try {
      localStorage.setItem('adsgpt_onboarding_completed', 'true');
      if (targetId) {
        localStorage.setItem(`onboarding_completed_${targetId}`, 'true');
      }
    } catch {
      // ignore
    }
    if (targetId) {
      dispatch(markUserOnboardingComplete(targetId));
    }
  }, [dispatch, userId]);

  const next = useCallback(() => {
    if (currentStep >= totalSteps - 1) {
      handleCompleteOrSkip();
      dispatch(completeOnboarding());
      dispatch(setActiveAdStudioTab('adCreativeNew'));
      navigate('/adstudio');
    } else {
      dispatch(nextStep(totalSteps));
    }
  }, [dispatch, currentStep, totalSteps, handleCompleteOrSkip, navigate]);

  const prev = useCallback(() => dispatch(prevStep()), [dispatch]);

  const jumpTo = useCallback((index) => dispatch(goToStep(index)), [dispatch]);

  const skip = useCallback(() => {
    handleCompleteOrSkip();
    dispatch(skipOnboarding());
  }, [dispatch, handleCompleteOrSkip]);

  const finish = useCallback(() => {
    handleCompleteOrSkip();
    dispatch(completeOnboarding());
    dispatch(setActiveAdStudioTab('adCreativeNew'));
    navigate('/adstudio');
  }, [dispatch, handleCompleteOrSkip, navigate]);

  return {
    isOpen,
    isWelcomeStep,
    currentStep,
    totalSteps,
    hasCompleted,
    step,
    isFirstStep,
    isLastStep,
    open,
    begin,
    next,
    prev,
    jumpTo,
    skip,
    finish,
  };
};

export default useOnboarding;
