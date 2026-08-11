import { motion } from 'framer-motion';

/**
 * FloatingPreview
 *
 * A floating glass card that appears beside the highlighted sidebar element
 * during a tour step. Shows the feature name, a set of capability chips, and
 * a preview image from the existing public/adcreative/ assets.
 *
 * Props:
 *  - step {object}       The current TOUR_STEPS entry
 *  - rect {DOMRect|null} Bounding rect of the targeted element
 */

const containerVariants = {
  hidden: { opacity: 0, x: -12, scale: 0.97 },
  visible: {
    opacity: 1,
    x: 0,
    scale: 1,
    transition: {
      duration: 0.32,
      ease: [0.22, 1, 0.36, 1],
      staggerChildren: 0.07,
      delayChildren: 0.08,
    },
  },
  exit: {
    opacity: 0,
    x: -8,
    scale: 0.97,
    transition: { duration: 0.2, ease: 'easeIn' },
  },
};

const chipVariants = {
  hidden: { opacity: 0, y: 6 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.25, ease: 'easeOut' } },
};

const FloatingPreview = ({ step, rect }) => {
  if (!step || !rect) return null;

  // Position the card to the right of the sidebar icon (with a gap)
  const top = Math.max(rect.top + rect.height / 2 - 120, 16);
  const left = rect.right + 24;

  const previewSrc = step.previewGifs?.[0] || step.previewImages?.[0] || null;

  return (
    <motion.div
      key={step.id}
      role="complementary"
      aria-label={`${step.title} feature preview`}
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
      style={{ top, left }}
      className="
        pointer-events-none
        fixed z-[10008]
        w-64
        rounded-2xl
        border border-white/10
        bg-white/5
        backdrop-blur-2xl
        shadow-2xl
        overflow-hidden
      "
    >
      {/* Preview image */}
      {previewSrc && (
        <div className="relative h-32 w-full overflow-hidden">
          <img
            src={previewSrc}
            alt={`${step.title} preview`}
            className="h-full w-full object-cover"
            style={{ filter: 'brightness(0.85) saturate(1.1)' }}
            loading="lazy"
          />
          {/* Gradient fade at bottom */}
          <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-black/60 to-transparent" />

          {/* Accent gradient bar */}
          <div className={`absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r ${step.accent}`} />
        </div>
      )}

      {/* Content */}
      <div className="p-3.5">
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-white/40">
          Features
        </p>

        <div className="flex flex-wrap gap-1.5">
          {step.features?.map((feature) => (
            <motion.span
              key={feature}
              variants={chipVariants}
              className={`
                inline-flex items-center
                rounded-full
                border border-white/10
                bg-white/8
                px-2.5 py-1
                text-[11px] font-medium text-white/80
              `}
            >
              {feature}
            </motion.span>
          ))}
        </div>
      </div>
    </motion.div>
  );
};

export default FloatingPreview;
