import { motion } from 'framer-motion';
import useOnboarding from '@/hooks/useOnboarding';

/**
 * SkipButton
 *
 * Always-visible ghost button that lets the user dismiss onboarding instantly.
 * Positioned in the bottom-right corner during the tour phase.
 * Never shown on the welcome modal (the modal has its own skip).
 */
const SkipButton = () => {
  const { isWelcomeStep, skip } = useOnboarding();

  if (isWelcomeStep) return null;

  return (
    <motion.button
      id="onboarding-skip-btn"
      type="button"
      aria-label="Skip onboarding tour"
      onClick={skip}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className="
        fixed bottom-6 right-6 z-[10010]
        flex items-center gap-1.5
        rounded-full border border-white/10
        bg-black/40 px-4 py-2
        text-sm font-medium text-white/60
        backdrop-blur-md
        transition-colors duration-200
        hover:border-white/20 hover:text-white/90
        focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40
      "
    >
      Skip tour
    </motion.button>
  );
};

export default SkipButton;
