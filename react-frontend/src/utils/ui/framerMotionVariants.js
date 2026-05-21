// Sidebar navigation section
export const FRAMER_NAVIGATION_CONTAINER_VARIANTS = {
  hidden: {
    opacity: 0,
  },
  visible: {
    opacity: 1,
    transition: {
      delay: 0.1,
      duration: 0.1,
      staggerChildren: 0.1,
    },
  },
  exit: {
    opacity: 0,
    transition: {
      duration: 0,
    },
  },
};
export const FRAMER_NAVIGATION_ITEM_VARIANTS = {
  hidden: {
    opacity: 0,
  },
  visible: (index) => ({
    opacity: 1,
    transition: {
      delay: 0.2 + index * 0.05,
      duration: 0.2,
    },
  }),
  exit: {
    opacity: 0,
    transition: {
      duration: 0,
    },
  },
};

// Used in history section
export const FRAMER_CONTAINER_FADE_RIGHT_VARIANTS = {
  hidden: {
    opacity: 0,
    x: -20,
  },
  visible: {
    opacity: 1,
    x: 0,
    transition: {
      duration: 0.2,
      when: 'beforeChildren',
      staggerChildren: 0.03,
    },
  },
  exit: {
    opacity: 0,
    x: -20,
    transition: {
      duration: 0.1,
    },
  },
};
export const FRAMER_ITEM_FADE_RIGHT_VARIANTS = {
  hidden: {
    opacity: 0,
    x: -10,
  },
  visible: {
    opacity: 1,
    x: 0,
    transition: {
      duration: 0.1,
    },
  },
  exit: {
    opacity: 0,
    x: -10,
    transition: {
      duration: 0.05,
    },
  },
};

// Common fadeup
export const FADE_UP_ANIMATION_VARIANT = {
  initial: { opacity: 0, y: 30 },
  whileInView: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.3,
    },
  },
};

// Layout transition for smooth width/height changes
export const layoutTransitionVariants = {
  initial: {},
  animate: {},
  transition: {
    type: 'spring',
    stiffness: 300,
    damping: 30,
    duration: 0.3,
  },
};

export const fadeUpVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.5,
      ease: 'easeOut',
    },
  },
};

// Container variants for staggered children animations
export const containerFadeUpVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.2,
    },
  },
};
