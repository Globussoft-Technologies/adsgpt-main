import { useReducedMotion } from 'framer-motion';

// ----------------------------------------------------------------------------
// Motion for Quick setup, in one place.
//
// Three rules, and everything here follows from them:
//
//  1. Animate what CHANGES LAYOUT. An expansion that snaps open reads as a
//     bug — the eye loses the thing it was looking at. Everything else can
//     usually appear without ceremony.
//
//  2. Animate what ARRIVES ON ITS OWN. Creatives land over a couple of minutes
//     without the user doing anything; a card that fades in is the difference
//     between "it's working" and "did that just change?". A card the user
//     summoned needs no such reassurance.
//
//  3. Never animate the same thing twice. Stagger a list once, on entry, and
//     leave it alone afterwards — a grid that re-choreographs itself on every
//     poll is noise, and this page polls.
//
// Timings are shared so the surface reads as one product rather than six
// components with six opinions. Anything longer than ~240ms on a control the
// user just clicked feels like lag rather than polish.
// ----------------------------------------------------------------------------

// A gentle deceleration — fast off the mark, settles without bouncing. Matches
// the curve already used on the SourceInput hero.
export const EASE = [0.22, 1, 0.36, 1];

export const DURATION = {
  fast: 0.16, // hover, colour, small state flips
  base: 0.24, // most things
  expand: 0.28, // height changes, which need a beat longer to be readable
};

/**
 * Motion presets that collapse to nothing when the user has asked for reduced
 * motion.
 *
 * `prefers-reduced-motion` is honoured by zeroing DURATION rather than removing
 * the animation, so layout and mount/unmount behaviour stay identical — the
 * transitions simply happen instantly. Stripping the components apart into
 * animated and non-animated branches would be two code paths to keep in step.
 */
export function useMotionPresets() {
  const reduce = useReducedMotion();
  const d = (seconds) => (reduce ? 0 : seconds);

  return {
    reduce,

    // Height 0 → auto. The overflow clip is what makes it read as a reveal
    // rather than a fade of already-placed content.
    expand: {
      initial: { height: 0, opacity: 0 },
      animate: { height: 'auto', opacity: 1 },
      exit: { height: 0, opacity: 0 },
      transition: {
        height: { duration: d(DURATION.expand), ease: EASE },
        opacity: { duration: d(DURATION.fast), ease: 'linear' },
      },
      style: { overflow: 'hidden' },
    },

    // A single item appearing in place.
    fadeUp: {
      initial: { opacity: 0, y: 8 },
      animate: { opacity: 1, y: 0 },
      transition: { duration: d(DURATION.base), ease: EASE },
    },

    // Parent of a list. Children inherit the stagger; `staggerChildren: 0` under
    // reduced motion means they all land together rather than not at all.
    stagger: (step = 0.04) => ({
      initial: 'hidden',
      animate: 'shown',
      variants: {
        hidden: {},
        shown: { transition: { staggerChildren: d(step) } },
      },
    }),

    // Child of the above.
    staggerItem: {
      variants: {
        hidden: { opacity: 0, y: 8 },
        shown: { opacity: 1, y: 0 },
      },
      transition: { duration: d(DURATION.base), ease: EASE },
    },
  };
}
