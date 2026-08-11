import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import useOnboarding from '@/hooks/useOnboarding';
import { useIsMobile } from '@/hooks/use-mobile';
import TourStep from './TourStep';
import ProgressIndicator from './ProgressIndicator';

/**
 * TourController
 *
 * Orchestrates the interactive tour:
 *  1. Navigates to step routes
 *  2. Activates target element once per step
 *  3. Measures target position
 *  4. Glides spotlight box smoothly using spring animation
 *  5. Renders TourStep card
 */

const PADDING = 10;

/**
 * SpotlightBox
 * Single persistent spotlight element using framer-motion's spring physics.
 * Glides smoothly between targets without unmounting/re-mounting DOM nodes.
 */
const SpotlightBox = ({ rect }) => {
  if (!rect) return null;

  const top    = rect.top    - PADDING;
  const left   = rect.left   - PADDING;
  const width  = rect.width  + PADDING * 2;
  const height = rect.height + PADDING * 2;

  const isPill =
    rect.borderRadius?.includes('9999px') ||
    rect.borderRadius?.includes('50%') ||
    parseInt(rect.borderRadius, 10) >= 16;
  const borderRadius = isPill ? Math.round(height / 2) : (parseInt(rect.borderRadius, 10) || 12) + PADDING / 2;

  return (
    <motion.div
      aria-hidden="true"
      initial={false}
      animate={{ top, left, width, height, borderRadius, opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ type: 'spring', stiffness: 360, damping: 32, mass: 0.7 }}
      style={{
        position: 'fixed',
        boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.38), 0 0 16px rgba(21, 220, 255, 0.25)',
        border: '1.5px solid rgba(21, 220, 255, 0.45)',
        pointerEvents: 'none',
        willChange: 'top, left, width, height',
      }}
    />
  );
};

const TourController = () => {
  const { isOpen, isWelcomeStep, step, currentStep } = useOnboarding();
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const [targetRect, setTargetRect] = useState(null);
  const rafRef = useRef(null);
  const clickedStepRef = useRef(null);

  // Measure and activate target element once per step
  const measure = useCallback(() => {
    if (!step?.targetSelector) {
      setTargetRect(null);
      return;
    }
    try {
      const el = document.querySelector(step.targetSelector);
      if (el) {
        const targetEl = el.closest('button') || el.closest('a') || el;
        
        // Trigger click exactly ONCE per step change to avoid lag from redundant clicks
        if (clickedStepRef.current !== currentStep) {
          clickedStepRef.current = currentStep;
          if (typeof targetEl.click === 'function') {
            targetEl.click();
          }
          if (typeof targetEl.blur === 'function') {
            targetEl.blur();
          }
        }

        const rect = targetEl.getBoundingClientRect();
        const computedStyle = window.getComputedStyle(targetEl);
        const rawRadius = computedStyle.borderRadius || '14px';

        setTargetRect({
          ...rect.toJSON(),
          borderRadius: rawRadius,
        });
      } else {
        setTargetRect(null);
      }
    } catch {
      setTargetRect(null);
    }
  }, [step, currentStep]);

  useEffect(() => {
    if (!isOpen || isWelcomeStep) return;

    // Navigate to route if step requires a different page
    const needsNav = step?.route && window.location.pathname !== step.route;
    if (needsNav) {
      navigate(step.route);
      const t0 = setTimeout(measure, 120);
      const t1 = setTimeout(measure, 350);
      return () => { clearTimeout(t0); clearTimeout(t1); };
    }

    // Same page — measure position immediately & after layout frame
    measure();
    const t0 = setTimeout(measure, 80);

    const handleResize = () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(measure);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      clearTimeout(t0);
      cancelAnimationFrame(rafRef.current);
    };
  }, [isOpen, isWelcomeStep, step, currentStep, navigate, measure]);

  if (!isOpen || isWelcomeStep) return null;

  return (
    <>
      {/* ── Full-screen dimming base ── */}
      <motion.div
        className="pointer-events-none fixed inset-0 z-[10005]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
        aria-hidden="true"
      >
        {/* Base dark backdrop */}
        <div className="absolute inset-0 bg-black/20" />

        {/* Smooth gliding spotlight box */}
        {!isMobile && <SpotlightBox rect={targetRect} />}
      </motion.div>

      {/* ── Tour step card ── */}
      <AnimatePresence mode="popLayout">
        <TourStep key={`card-${currentStep}`} rect={targetRect} isMobile={isMobile} />
      </AnimatePresence>
    </>
  );
};

export default TourController;
