import { useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import useOnboarding from '@/hooks/useOnboarding';
import OnboardingModal from './OnboardingModal';
import TourController from './TourController';

/**
 * OnboardingProvider
 *
 * The top-level mount point for the entire onboarding system.
 *
 * Responsibilities:
 *  - Keyboard navigation: ESC → skip, → / Tab → next, ← → prev
 *  - Focus trap while modal is open (welcome step)
 *  - Renders OnboardingModal (welcome) and TourController (tour steps)
 *  - Uses AnimatePresence for smooth mount/unmount transitions
 *
 * Place this once inside Layout.jsx alongside <TourGuide />.
 * It is completely independent from @reactour/tour.
 */
const OnboardingProvider = () => {
  const { isOpen, isWelcomeStep, begin, next, prev, skip, totalSteps, currentStep, open } =
    useOnboarding();
  const navigate = useNavigate();



  // Ensure background page is /adstudio while the welcome modal is active
  useEffect(() => {
    if (isOpen && isWelcomeStep) {
      if (window.location.pathname !== '/adstudio') {
        navigate('/adstudio', { replace: true });
      }
    }
  }, [isOpen, isWelcomeStep, navigate]);

  const handleKeyDown = useCallback(
    (e) => {
      if (!isOpen) return;

      switch (e.key) {
        case 'Escape':
          e.preventDefault();
          skip();
          break;
        case 'ArrowRight':
          if (!isWelcomeStep) {
            e.preventDefault();
            next();
          }
          break;
        case 'ArrowLeft':
          if (!isWelcomeStep) {
            e.preventDefault();
            prev();
          }
          break;
        // Tab key can be used for next during the tour (not the welcome modal,
        // where Tab should cycle through the focusable elements naturally)
        default:
          break;
      }
    },
    [isOpen, isWelcomeStep, skip, next, prev]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Lock body scroll when modal is open to prevent background scrolling
  useEffect(() => {
    if (isOpen && isWelcomeStep) {
      const originalStyle = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = originalStyle;
      };
    }
  }, [isOpen, isWelcomeStep]);

  return (
    <>
      {/* Welcome modal — shown first */}
      <AnimatePresence>
        {isOpen && isWelcomeStep && <OnboardingModal key="onboarding-modal" />}
      </AnimatePresence>

      {/* Interactive tour — shown after "Start Tour" */}
      <AnimatePresence>
        {isOpen && !isWelcomeStep && <TourController key="tour-controller" />}
      </AnimatePresence>
    </>
  );
};

export default OnboardingProvider;
