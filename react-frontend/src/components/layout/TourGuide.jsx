import { TourProvider, useTour } from '@reactour/tour';
import { useDispatch, useSelector } from 'react-redux';
import { setShowTour } from '@/store/reducers/tourGuide/tourGuideSlice';
import React, { useMemo, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import getRouteSteps from './routeSteps';
const TourGuide = () => {
  const dispatch = useDispatch();
  const isDarkMode = useSelector((state) => state.theme.isDarkMode);
  const showTour = useSelector((state) => state.tourGuide.showTour);
  const location = useLocation();
  const { activeAdStudioTabId } = useSelector((state) => state.adStudioTabs);
  const { activeBrandIQTabId } = useSelector((state) => state.brandIQTabs);
  const isAddieChatVisible = useSelector((state) => state.addie?.addieChatVisibility);

  const getStepsForCurrentRoute = useCallback(
    (pathname, activeAdStudioTabId, activeBrandIQTabId) => {
      const currentPath =
        pathname === '/adstudio'
          ? `${pathname}/${activeAdStudioTabId || ''}`
          : pathname === '/brandiq'
            ? `${pathname}/${activeBrandIQTabId || ''}`
            : pathname;

      return getRouteSteps(currentPath, isAddieChatVisible);
    },
    [isAddieChatVisible]
  );

  const steps = useMemo(() => {
    const pathname = location.pathname;
    return getStepsForCurrentRoute(pathname, activeAdStudioTabId, activeBrandIQTabId);
  }, [getStepsForCurrentRoute, location.pathname, activeAdStudioTabId, activeBrandIQTabId]);

  const styles = useMemo(
    () => ({
      popover: (base) => ({
        ...base,
        background: 'var(--popover)',
        color: 'var(--popover-foreground)',
        borderRadius: 12,
        marginLeft: 10,
        boxShadow: isDarkMode ? '0 10px 30px rgba(0,0,0,0.5)' : '0 10px 30px rgba(0,0,0,0.15)',
        padding: 16,
        maxWidth: 380,
      }),
      maskArea: (base) => ({
        ...base,
        rx: 10,
        ry: 10,
      }),
      badge: (base) => ({
        ...base,
        background: 'var(--primary)',
        color: 'var(--primary-foreground)',
        fontFamily: 'var(--font-public), ui-sans-serif, system-ui',
      }),
      controls: (base) => ({
        ...base,
        display: 'flex',
        gap: 8,
      }),
      close: (base) => ({
        ...base,
        color: 'var(--muted-foreground)',
      }),
      // We'll fully override navigation via components.Navigation for better UX
    }),
    [isDarkMode]
  );

  const handleClose = useCallback(() => dispatch(setShowTour(false)), [dispatch]);

  const isStepValid = useCallback(
    (index) => {
      const step = steps[index];
      const selector = step?.selector;
      if (!selector) return true;
      try {
        return Boolean(document.querySelector(selector));
      } catch (err) {
        return false;
      }
    },
    [steps]
  );

  const findNextValid = useCallback(
    (fromIndex) => {
      for (let i = fromIndex + 1; i < steps.length; i += 1) {
        if (isStepValid(i)) return i;
      }
      return -1;
    },
    [steps, isStepValid]
  );

  const findPrevValid = useCallback(
    (fromIndex) => {
      for (let i = fromIndex - 1; i >= 0; i -= 1) {
        if (isStepValid(i)) return i;
      }
      return -1;
    },
    [isStepValid]
  );

  const StepGuard = () => {
    const { currentStep, setCurrentStep } = useTour();
    React.useEffect(() => {
      if (!showTour) return;
      const total = steps.length;
      if (total === 0) return;

      if (isStepValid(currentStep)) return;

      const next = findNextValid(currentStep);
      if (next !== -1) {
        setCurrentStep(next);
        return;
      }

      const prev = findPrevValid(currentStep);
      if (prev !== -1) {
        setCurrentStep(prev);
        return;
      }

      handleClose();
    }, [
      currentStep,
      steps,
      showTour,
      handleClose,
      setCurrentStep,
      isStepValid,
      findNextValid,
      findPrevValid,
    ]);
    return null;
  };

  const Navigation = () => {
    const { currentStep, setCurrentStep } = useTour();
    const prevIdx = findPrevValid(currentStep);
    const nextIdx = findNextValid(currentStep);
    const isFirst = prevIdx === -1;
    const isLast = nextIdx === -1;

    return (
      <div className="mt-3.5 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => prevIdx !== -1 && setCurrentStep(prevIdx)}
          disabled={isFirst}
          className={[
            'rounded-full px-3.5 py-2 text-xs font-semibold transition-colors',
            isFirst
              ? 'bg-muted text-muted-foreground cursor-not-allowed opacity-60'
              : 'bg-[var(--primary)] text-[var(--primary-foreground)] hover:bg-white hover:text-black',
          ].join(' ')}
        >
          Prev
        </button>
        {isLast ? (
          <button
            type="button"
            onClick={() => handleClose()}
            className={[
              'rounded-full px-3.5 py-2 text-xs font-semibold transition-colors',
              'bg-[var(--primary)] text-[var(--primary-foreground)] hover:bg-white hover:text-black',
            ].join(' ')}
          >
            Finish
          </button>
        ) : (
          <button
            type="button"
            onClick={() => nextIdx !== -1 && setCurrentStep(nextIdx)}
            className={[
              'rounded-full px-3.5 py-2 text-xs font-semibold transition-colors',
              'bg-[var(--primary)] text-[var(--primary-foreground)] hover:bg-white hover:text-black',
            ].join(' ')}
          >
            Next
          </button>
        )}
      </div>
    );
  };

  const TourOpenSync = () => {
    const { setIsOpen, setCurrentStep } = useTour();
    React.useEffect(() => {
      if (showTour) {
        setIsOpen(true);
        // Jump to the first valid step immediately to avoid flicker
        const firstValid = (() => {
          for (let i = 0; i < steps.length; i += 1) if (isStepValid(i)) return i;
          return -1;
        })();
        if (firstValid !== -1) setCurrentStep(firstValid);
        else handleClose();
      } else {
        setIsOpen(false);
      }
    }, [setIsOpen, setCurrentStep]);
    return null;
  };

  const [isTourActive, setIsTourActive] = React.useState(false); // State to control tour activation

  React.useEffect(() => {
    setIsTourActive(false); // Deactivate the tour
    setTimeout(() => setIsTourActive(true), 0); // Reactivate the tour with updated steps
  }, [steps]);

  return (
    <>
      {isTourActive && (
        <TourProvider
          steps={steps}
          onClickClose={handleClose}
          onClickMask={handleClose}
          styles={styles}
          padding={6}
          scrollSmooth
          disableDotsNavigation={false}
          disableInteraction={false}
          components={{ Navigation }}
          showBadge={false}
        >
          <TourOpenSync />
          <StepGuard />
        </TourProvider>
      )}
    </>
  );
};

export default TourGuide;
