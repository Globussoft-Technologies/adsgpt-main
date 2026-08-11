import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, ArrowRight, X, Zap } from 'lucide-react';
import useOnboarding from '@/hooks/useOnboarding';
import { useIsMobile } from '@/hooks/use-mobile';
import AdsGPTLogo from '@/assets/layouts/adsgpt-logo.webp';

/**
 * OnboardingModal — Premium split-screen welcome experience.
 *
 * Layout:
 *  LEFT PANEL  — Animated grid of real ad creatives (the GIFs and images)
 *                cycling visibly so users instantly see what AdsGPT creates.
 *  RIGHT PANEL — Logo, headline, CTAs.
 *
 * On mobile: single-column, showcase images shown as a strip at the top.
 */

// Pairs: static thumbnail + animated GIF for each creative type
const SHOWCASE_PAIRS = [
  { static: '/adcreative/lifestyle.png', animated: '/adcreative/lifestyle-hover.gif', label: 'Lifestyle' },
  { static: '/adcreative/product.jpg',   animated: '/adcreative/product-hover.gif',   label: 'Product' },
  { static: '/adcreative/saas.png',      animated: '/adcreative/saas-hover.gif',       label: 'SaaS' },
  { static: '/adcreative/brand.jpg',     animated: '/adcreative/brand-hover.gif',       label: 'Brand' },
  { static: '/adcreative/ai.png',        animated: '/adcreative/ai-hover.png',          label: 'AI Ads' },
];

// Cycling hero image for the large left panel feature
const HERO_CYCLE_MS = 3000;

const backdropVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.35, ease: 'easeOut' } },
  exit:   { opacity: 0, transition: { duration: 0.25, ease: 'easeIn' } },
};

const leftVariants = {
  hidden: { opacity: 0, x: -30 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1], delay: 0.05 } },
};

const rightVariants = {
  hidden: { opacity: 0, x: 24 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1], delay: 0.15 } },
};

// Single animated showcase card that cycles through the GIF on hover
const ShowcaseCard = ({ pair, index }) => {
  const [hovered, setHovered] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.88, y: 16 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.2 + index * 0.08, ease: [0.22, 1, 0.36, 1] }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="relative overflow-hidden rounded-xl border border-white/10 shadow-lg"
      style={{ aspectRatio: '4/5' }}
    >
      {/* Static image */}
      <img
        src={pair.static}
        alt={pair.label}
        className="absolute inset-0 h-full w-full object-cover transition-opacity duration-500"
        style={{ opacity: hovered ? 0 : 1 }}
      />
      {/* Animated GIF — shown on hover */}
      <img
        src={pair.animated}
        alt={`${pair.label} animated`}
        className="absolute inset-0 h-full w-full object-cover transition-opacity duration-500"
        style={{ opacity: hovered ? 1 : 0 }}
      />
      {/* Bottom label */}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-white/70">
          {pair.label}
        </span>
      </div>
    </motion.div>
  );
};

// Auto-cycling large hero for the left panel
const HeroShowcase = () => {
  const [activeIdx, setActiveIdx] = useState(0);
  const timerRef = useRef(null);

  useEffect(() => {
    timerRef.current = setInterval(() => {
      setActiveIdx((prev) => (prev + 1) % SHOWCASE_PAIRS.length);
    }, HERO_CYCLE_MS);
    return () => clearInterval(timerRef.current);
  }, []);

  return (
    <div className="relative h-full w-full overflow-hidden">
      {SHOWCASE_PAIRS.map((pair, idx) => (
        <div
          key={pair.label}
          className="absolute inset-0 transition-opacity duration-[1000ms] ease-in-out"
          style={{ opacity: idx === activeIdx ? 1 : 0 }}
        >
          <img
            src={pair.animated}
            alt={pair.label}
            className="h-full w-full object-cover"
          />
        </div>
      ))}
      {/* Gradient overlays */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-r from-transparent to-black/30" />

      {/* Floating label */}
      <div className="absolute bottom-5 left-5 right-5">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeIdx}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.35 }}
            className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-black/40 px-3 py-1.5 backdrop-blur-md"
          >
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#15DCFF]" />
            <span className="text-xs font-semibold text-white/80">
              {SHOWCASE_PAIRS[activeIdx].label} Creative
            </span>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Dots */}
      <div className="absolute right-4 top-1/2 flex -translate-y-1/2 flex-col gap-1.5">
        {SHOWCASE_PAIRS.map((_, i) => (
          <button
            key={i}
            onClick={() => setActiveIdx(i)}
            className={`h-1.5 w-1.5 rounded-full transition-all duration-300 ${
              i === activeIdx ? 'bg-white scale-125' : 'bg-white/30'
            }`}
          />
        ))}
      </div>
    </div>
  );
};

const FULL_TEXT = "Create high-performing ads with AI.";
const PREFIX_LENGTH = "Create high-performing ads ".length;

const TypewriterHeadline = () => {
  const [displayedCount, setDisplayedCount] = useState(0);

  useEffect(() => {
    setDisplayedCount(0);
    const interval = setInterval(() => {
      setDisplayedCount((prev) => {
        if (prev >= FULL_TEXT.length) {
          clearInterval(interval);
          return prev;
        }
        return prev + 1;
      });
    }, 45);

    return () => clearInterval(interval);
  }, []);

  const typedText = FULL_TEXT.slice(0, displayedCount);
  const isTypingPrefix = displayedCount <= PREFIX_LENGTH;
  const prefixPart = isTypingPrefix ? typedText : FULL_TEXT.slice(0, PREFIX_LENGTH);
  const highlightPart = isTypingPrefix ? '' : typedText.slice(PREFIX_LENGTH);

  return (
    <>
      <span>{prefixPart}</span>
      {highlightPart && (
        <span
          className="italic bg-clip-text text-transparent"
          style={{ backgroundImage: 'linear-gradient(90deg, #FF5E36 0%, #C822D6 100%)' }}
        >
          {highlightPart}
        </span>
      )}
      <motion.span
        animate={{ opacity: [1, 0, 1] }}
        transition={{ repeat: Infinity, duration: 0.8, ease: 'easeInOut' }}
        className="inline-block ml-1 h-[20px] w-[2px] rounded-full align-middle bg-[#FF5E36]"
      />
    </>
  );
};

const OnboardingModal = () => {
  const { isOpen, isWelcomeStep, begin, skip } = useOnboarding();
  const isMobile = useIsMobile();

  const containerRef = useRef(null);
  const [mousePos, setMousePos] = useState({ x: -1000, y: -1000 });
  const [isHovered, setIsHovered] = useState(false);
  const [isCloseHovered, setIsCloseHovered] = useState(false);

  const handleMouseMove = (e) => {
    if (!containerRef.current) return;
    const r = containerRef.current.getBoundingClientRect();
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

  if (!isOpen || !isWelcomeStep) return null;

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to AdsGPT"
      id="onboarding-welcome-modal"
      variants={backdropVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
      className="fixed inset-0 z-[10006] flex items-end justify-center p-0 sm:items-center sm:p-4"
      style={{ backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', background: 'rgba(0,0,0,0.65)' }}
    >
      {/* ── Main dialog container ── */}
      <div
        ref={containerRef}
        onMouseMove={handleMouseMove}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className="relative flex w-full overflow-hidden shadow-2xl shadow-black/80"
        style={{
          maxWidth: isMobile ? '100%' : 880,
          maxHeight: isMobile ? '92vh' : 580,
          height: isMobile ? 'auto' : 580,
          borderRadius: isMobile ? '24px 24px 0 0' : 24,
          background: 'rgba(10, 10, 20, 0.45)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          border: '1px solid rgba(255,255,255,0.10)',
        }}
      >
        {/* ── Cursor-following Golden Line Edge Beam ── */}
        <div
          className="pointer-events-none absolute inset-0 rounded-3xl transition-opacity duration-300"
          style={{
            opacity: isHovered ? 1 : 0,
            padding: '2px',
            background: `radial-gradient(300px circle at ${mousePos.x}px ${mousePos.y}px, #FFD700 0%, #F5A524 45%, rgba(245, 165, 36, 0) 80%)`,
            WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
            WebkitMaskComposite: 'xor',
            maskComposite: 'exclude',
            zIndex: 30,
          }}
        />
        {/* ── LEFT: Visual showcase panel (desktop only) ── */}
        {!isMobile && (
          <motion.div
            variants={leftVariants}
            initial="hidden"
            animate="visible"
            className="relative flex-1 overflow-hidden"
            style={{ minWidth: 0 }}
          >
            <HeroShowcase />

            {/* Top-left branding watermark */}
            <div className="absolute left-4 top-4 flex items-center gap-2 rounded-full border border-white/10 bg-black/40 px-3 py-1.5 backdrop-blur-md">
              <img src={AdsGPTLogo} alt="AdsGPT" className="h-5 w-5 rounded-md object-contain" />
              <span className="text-xs font-bold text-white/70">AdsGPT</span>
            </div>

            {/* Gradient fade into right panel */}
            <div className="absolute inset-y-0 right-0 w-20 bg-gradient-to-r from-transparent to-[#0c0c12]" />
          </motion.div>
        )}

        {/* ── RIGHT: Content panel ── */}
        <motion.div
          variants={rightVariants}
          initial="hidden"
          animate="visible"
          className="relative flex flex-col justify-center overflow-y-auto"
          style={{
            width: isMobile ? '100%' : 380,
            flexShrink: 0,
            padding: isMobile ? '24px 20px 28px' : '40px 36px',
            background: 'rgba(12, 12, 18, 0.85)',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            borderLeft: isMobile ? 'none' : '1px solid rgba(255,255,255,0.08)',
          }}
        >
          {/* Close / skip X */}
          <motion.button
            type="button"
            id="onboarding-modal-skip"
            onClick={skip}
            aria-label="Skip onboarding"
            whileHover={{ scale: 1.15, rotate: 90 }}
            whileTap={{ scale: 0.9 }}
            transition={{ type: 'spring', stiffness: 300, damping: 18 }}
            onHoverStart={() => setIsCloseHovered(true)}
            onHoverEnd={() => setIsCloseHovered(false)}
            className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full"
            style={{
              border: isCloseHovered ? '1px solid rgba(239,68,68,0.55)' : '1px solid rgba(255,255,255,0.10)',
              background: isCloseHovered ? 'rgba(239,68,68,0.12)' : 'rgba(255,255,255,0.05)',
              color: isCloseHovered ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.40)',
              boxShadow: isCloseHovered ? '0 0 16px 4px rgba(239,68,68,0.40)' : 'none',
              transition: 'border 0.2s, background 0.2s, color 0.2s, box-shadow 0.2s',
            }}
          >
            <X className="h-3.5 w-3.5" />
          </motion.button>

          {/* Logo — mobile only (desktop shows it on the left panel) */}
          {isMobile && (
            <div className="mb-4 flex items-center gap-2">
              <img src={AdsGPTLogo} alt="AdsGPT" className="h-7 w-7 rounded-xl object-contain" />
              <span className="text-sm font-bold tracking-tight text-white">AdsGPT</span>
            </div>
          )}

          {/* Badge */}
          <div className="mb-4 inline-flex w-fit items-center gap-1.5 rounded-full border border-[#FF5E36]/25 bg-[#FF5E36]/10 px-3 py-1">
            <Zap className="h-2.5 w-2.5 text-[#FF5E36]" />
            <span className="text-[10px] font-semibold uppercase tracking-widest text-[#FF5E36]">
              AI-Powered Advertising
            </span>
          </div>

          {/* Headline */}
          <h1
            className="mb-2.5 font-extrabold leading-tight tracking-tight text-white"
            style={{ fontSize: isMobile ? 20 : 26, minHeight: isMobile ? 52 : 70 }}
          >
            <TypewriterHeadline />
          </h1>

          {/* Subline */}
          <p className="mb-4 text-xs leading-relaxed text-white/55" style={{ fontSize: isMobile ? 12 : 14 }}>
            AdsGPT turns your product into high-performing image ads, videos, and full campaigns — in minutes, not days.
          </p>

          {/* Feature list */}
          <div className="mb-5 space-y-2">
            {[
              { icon: '✦', text: 'AI creative generation in seconds' },
              { icon: '✦', text: 'Full campaign workflows, automated' },
              { icon: '✦', text: 'Brand-aware creatives every time' },
            ].map(({ icon, text }) => (
              <div key={text} className="flex items-center gap-2">
                <span className="text-[10px] text-[#FF5E36]">{icon}</span>
                <span className="text-xs font-medium text-white/75">{text}</span>
              </div>
            ))}
          </div>

          {/* CTAs */}
          <div className="flex flex-col gap-2.5">
            <button
              type="button"
              id="onboarding-start-tour-btn"
              onClick={begin}
              aria-label="Start the AdsGPT product tour"
              className="group relative flex w-full items-center justify-center gap-2 overflow-hidden rounded-2xl px-6 py-3.5 text-sm font-bold uppercase tracking-wider text-white shadow-lg transition-all duration-300 hover:opacity-95 hover:shadow-xl"
              style={{
                background: 'linear-gradient(90deg, #FF5E36 0%, #C822D6 100%)',
                boxShadow: '0 4px 24px rgba(255, 94, 54, 0.35)',
              }}
            >
              <Sparkles className="h-4 w-4" />
              Take a 90-sec Tour
              <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
            </button>

            <button
              type="button"
              id="onboarding-skip-welcome-btn"
              onClick={skip}
              aria-label="Skip and go to dashboard"
              className="flex w-full items-center justify-center rounded-2xl px-6 py-3 text-sm font-medium text-white/35 transition-all duration-200 hover:text-white/65"
            >
              Skip for now
            </button>
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
};

export default OnboardingModal;
