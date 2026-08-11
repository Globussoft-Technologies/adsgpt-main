import { useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, ArrowRight, Sparkles, X } from 'lucide-react';
import useOnboarding from '@/hooks/useOnboarding';
import VideoDemo from './VideoDemo';

/**
 * TourStep — Single rich card for each onboarding tour step.
 *
 * Layout (top → bottom):
 *   ┌─────────────────────────────────┐
 *   │  VIDEO DEMO (autoplay preview)  │  ← VideoDemo component
 *   ├─────────────────────────────────┤
 *   │  Step X of N  •  Feature chips  │
 *   │  Title                          │
 *   │  Tagline (gradient)             │
 *   │  Description                    │
 *   │  [← Prev]              [Next →] │
 *   └─────────────────────────────────┘
 *
 * NO separate FloatingPreview — everything lives in this one card.
 * Positioned centrally on screen (not beside the sidebar) to avoid overlap.
 */

const cardVariants = {
  hidden:  { opacity: 0, scale: 0.96, y: 10 },
  visible: { opacity: 1, scale: 1,    y: 0,  transition: { duration: 0.22, ease: [0.16, 1, 0.3, 1] } },
  exit:    { opacity: 0, scale: 0.96, y: -6, transition: { duration: 0.14, ease: 'easeIn' } },
};

const TourStep = ({ rect, isMobile = false }) => {
  const { currentStep, totalSteps, step, isFirstStep, isLastStep, next, prev, finish, skip } =
    useOnboarding();

  const cardRef = useRef(null);
  const [mousePos, setMousePos] = useState({ x: -1000, y: -1000 });
  const [isHovered, setIsHovered] = useState(false);

  const handleMouseMove = (e) => {
    if (!cardRef.current) return;
    const r = cardRef.current.getBoundingClientRect();
    setMousePos({
      x: e.clientX - r.left,
      y: e.clientY - r.top,
    });
  };

  const handleMouseEnter = (e) => {
    setIsHovered(true);
    handleMouseMove(e);
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
  };

  if (!step) return null;

  // Smart positioning:
  // - Top header tabs (rect.top < 120 & rect.left >= 100): position underneath top tab
  // - Left sidebar (rect.left < 100): position to the right of sidebar button
  // - Fallback: center card
  const isTopHeader = rect && rect.top < 120 && rect.left >= 100;
  const isLeftSidebar = rect && rect.left < 100;

  const cardStyle = isMobile
    ? {
        bottom: 0,
        left: 0,
        right: 0,
        width: '100%',
        maxWidth: '100%',
        borderRadius: '20px 20px 0 0',
      }
    : isTopHeader
      ? {
          top: rect.bottom + 16,
          left: Math.max(Math.min(rect.left + rect.width / 2 - 190, window.innerWidth - 400), 20),
          width: 380,
        }
      : isLeftSidebar
        ? {
            top: Math.max(65, Math.min(rect.top + rect.height / 2 - 250, window.innerHeight - 530)),
            left: rect.right + 28,
            width: 380,
          }
        : {
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: 380,
          };

  return (
    <motion.div
      ref={cardRef}
      onMouseMove={handleMouseMove}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      key={`step-${currentStep}`}
      role="dialog"
      aria-modal="false"
      aria-label={`Tour step ${currentStep + 1}: ${step.title}`}
      variants={cardVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
      style={{
        position: 'fixed',
        ...cardStyle,
        background: 'linear-gradient(160deg, #141418 0%, #0e0e13 100%)',
        maxHeight: isMobile ? '72vh' : '96vh',
        overflowY: 'auto',
        overflowX: 'hidden',
        willChange: 'transform, opacity, top, left',
        transition: 'top 0.25s cubic-bezier(0.16, 1, 0.3, 1), left 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
      }}
      className="relative z-[10009] rounded-3xl border border-white/12 shadow-2xl shadow-black/70"
    >
      {/* ── TOP HEADER ROW (Clean, non-overlapping header) ── */}
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5 bg-black/30">
        <div className="flex items-center gap-1.5">
          <span className="flex items-center gap-1.5 rounded-full border border-white/12 bg-white/8 px-2.5 py-0.5 text-[11px] font-semibold text-white/80">
            <Sparkles className="h-3 w-3 text-[#15DCFF]" />
            Step {currentStep + 1} of {totalSteps}
          </span>
        </div>
        {!isLastStep && (
          <button
            type="button"
            id="onboarding-skip-btn"
            onClick={skip}
            aria-label="Skip onboarding tour"
            title="Skip tour"
            className="flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-medium text-white/60 transition-all duration-200 hover:border-white/20 hover:text-white active:scale-95"
          >
            <X className="h-3 w-3" />
            Skip
          </button>
        )}
      </div>

      {/* ── Cursor-following Golden Line Edge Beam ── */}
      <div
        className="pointer-events-none absolute inset-0 rounded-3xl transition-opacity duration-300"
        style={{
          opacity: isHovered ? 1 : 0,
          padding: '2px',
          background: `radial-gradient(220px circle at ${mousePos.x}px ${mousePos.y}px, #FFD700 0%, #F5A524 45%, rgba(245, 165, 36, 0) 80%)`,
          WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
          WebkitMaskComposite: 'xor',
          maskComposite: 'exclude',
          zIndex: 15,
        }}
      />



      {/* ── VIDEO DEMO ── */}
      <AnimatePresence mode="wait">
        <VideoDemo
          key={`video-${currentStep}`}
          title={step.title}
          videoUrl={step.videoUrl}
          poster={step.poster || step.previewGifs?.[0] || step.previewImages?.[0]}
          isActive={true}
        />
      </AnimatePresence>

      {/* ── CONTENT ── */}
      <div className={isMobile ? 'px-4 pb-4 pt-3' : 'px-5 pb-4 pt-3'}>
        {/* Title */}
        <h2 className={`mb-0.5 font-extrabold leading-tight tracking-tight text-white ${isMobile ? 'text-[17px]' : 'text-[19px]'}`}>
          {step.title}
        </h2>

        {/* Tagline */}
        <p
          className={`mb-2 font-semibold ${isMobile ? 'text-xs' : 'text-sm'}`}
          style={{ background: `linear-gradient(90deg, ${getAccentColors(step.accent)})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}
        >
          {step.tagline}
        </p>

        {/* Description */}
        <p className={`mb-3 leading-relaxed text-white/60 ${isMobile ? 'text-[11.5px]' : 'text-[12.5px]'}`}>
          {step.description}
        </p>

        {/* Feature chips row */}
        {step.features?.length > 0 && (
          <div className="mb-3.5 flex flex-nowrap items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-none">
            {step.features.map((f) => (
              <span
                key={f}
                className="shrink-0 rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-[10px] font-medium text-white/60"
              >
                {f}
              </span>
            ))}
          </div>
        )}

        {/* Navigation */}
        <div className="flex items-center gap-2.5 pb-safe">
          <button
            type="button"
            id="onboarding-prev-btn"
            onClick={prev}
            disabled={isFirstStep}
            aria-label="Previous step"
            className="flex h-10 items-center justify-center gap-1.5 rounded-xl border border-white/15 bg-white/5 px-4 text-xs font-semibold text-white/70 transition-all duration-200 hover:border-white/30 hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-30 active:scale-95"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Prev</span>
          </button>

          {isLastStep ? (
            <button
              type="button"
              id="onboarding-finish-btn"
              onClick={finish}
              aria-label="Finish tour"
              className="flex flex-1 items-center justify-center gap-2 rounded-xl h-10 px-5 text-xs font-bold uppercase tracking-wider text-white transition-all duration-200 hover:opacity-95 active:scale-95 shadow-lg"
              style={{
                background: `linear-gradient(90deg, ${getAccentColors(step.accent)})`,
                boxShadow: `0 4px 20px rgba(94,102,245,0.35)`,
              }}
            >
              Finish Tour ✓
            </button>
          ) : (
            <button
              type="button"
              id="onboarding-next-btn"
              onClick={next}
              aria-label="Next step"
              className="group flex flex-1 items-center justify-center gap-2 rounded-xl h-10 px-5 text-xs font-bold uppercase tracking-wider text-white transition-all duration-200 hover:opacity-95 active:scale-95 shadow-lg"
              style={{
                background: `linear-gradient(90deg, ${getAccentColors(step.accent)})`,
                boxShadow: `0 4px 20px rgba(94,102,245,0.35)`,
              }}
            >
              <span>Next</span>
              <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
            </button>
          )}
        </div>

      </div>
    </motion.div>
  );
};

/**
 * Converts Tailwind gradient class names like "from-[#15DCFF] to-[#5E66F5]"
 * into a CSS gradient color string for inline style use.
 */
function getAccentColors(accent = '') {
  const fromMatch = accent.match(/from-\[([^\]]+)\]/);
  const toMatch   = accent.match(/to-\[([^\]]+)\]/);
  const from = fromMatch?.[1] || '#15DCFF';
  const to   = toMatch?.[1]   || '#5E66F5';
  return `${from}, ${to}`;
}

export default TourStep;
