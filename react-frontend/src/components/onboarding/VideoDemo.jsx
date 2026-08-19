import { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Play, Maximize2, X, VideoOff } from 'lucide-react';

/**
 * VideoDemo
 *
 * Premium in-card YouTube video showcase for onboarding tour steps.
 *
 * Preview area (embedded in the card top):
 *  - Shows the YouTube video thumbnail (maxresdefault → hqdefault fallback)
 *  - Hover: translucent overlay + animated Play circle + "Watch Full Demo" text
 *  - Top-right Maximize2 icon always accessible
 *  - Error / placeholder state: local poster image + "Demo unavailable" badge
 *  - Fade-in / scale animation via Framer Motion when card becomes active
 *
 * Fullscreen modal (React Portal):
 *  - Dark blurred backdrop, spring scale-in animation
 *  - Embeds YouTube iframe with autoplay, controls, rel=0, modestbranding
 *  - Escape key or backdrop click closes; close button top-right
 *
 * @param {{
 *   title: string,
 *   videoUrl: string,   // YouTube URL — youtu.be short link or full watch link
 *   poster: string,     // Local fallback image path
 *   isActive: boolean,
 * }} props
 */

// ─── YouTube URL helpers ──────────────────────────────────────────────────────

/**
 * Extracts the YouTube video ID from any valid YouTube URL format:
 *   https://youtu.be/VIDEO_ID?si=...
 *   https://www.youtube.com/watch?v=VIDEO_ID&...
 *   https://www.youtube.com/embed/VIDEO_ID
 *
 * Returns null if the URL is not a recognisable YouTube link or is a placeholder.
 */
function extractYouTubeId(url) {
  if (!url || typeof url !== 'string') return null;

  // Reject obvious placeholder values
  if (url.includes('xxxxxxxx')) return null;

  try {
    const parsed = new URL(url);

    // youtu.be/ID
    if (parsed.hostname === 'youtu.be') {
      const id = parsed.pathname.slice(1).split('/')[0];
      return id || null;
    }

    // youtube.com/watch?v=ID
    // Exact host or a subdomain of it — includes() would also accept
    // youtube.com.evil.tld and evil.tld/?q=youtube.com.
    if (
      parsed.hostname === 'youtube.com' ||
      parsed.hostname.endsWith('.youtube.com')
    ) {
      if (parsed.pathname === '/watch') {
        return parsed.searchParams.get('v') || null;
      }
      // youtube.com/embed/ID
      if (parsed.pathname.startsWith('/embed/')) {
        return parsed.pathname.split('/embed/')[1].split('/')[0] || null;
      }
    }
  } catch {
    // Invalid URL — fall through
  }

  return null;
}



/**
 * Returns the YouTube embed URL for the in-card muted autoplay preview.
 * Controls are hidden; the iframe scales slightly to hide YouTube chrome.
 */
function getYouTubePreviewUrl(videoId) {
  return (
    `https://www.youtube.com/embed/${videoId}` +
    `?autoplay=1&mute=1&loop=1&playlist=${videoId}` +
    `&controls=0&rel=0&showinfo=0&modestbranding=1&playsinline=1`
  );
}

/**
 * Returns the YouTube embed URL for the fullscreen modal (with controls).
 */
function getYouTubeEmbedUrl(videoId) {
  return (
    `https://www.youtube.com/embed/${videoId}` +
    `?autoplay=1&rel=0&modestbranding=1&playsinline=1`
  );
}

// ─── Framer Motion variants ───────────────────────────────────────────────────

const previewVariants = {
  hidden:  { opacity: 0, scale: 0.97 },
  visible: { opacity: 1, scale: 1, transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] } },
  exit:    { opacity: 0, scale: 0.97, transition: { duration: 0.22, ease: 'easeIn' } },
};

const overlayVariants = {
  hidden:  { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.2 } },
  exit:    { opacity: 0, transition: { duration: 0.18 } },
};

const backdropVariants = {
  hidden:  { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.3 } },
  exit:    { opacity: 0, transition: { duration: 0.22 } },
};

const modalVariants = {
  hidden:  { opacity: 0, scale: 0.85, y: 24 },
  visible: {
    opacity: 1, scale: 1, y: 0,
    transition: { type: 'spring', stiffness: 340, damping: 28, mass: 0.8 },
  },
  exit:    { opacity: 0, scale: 0.9, y: 16, transition: { duration: 0.22, ease: 'easeIn' } },
};

// ─── FullscreenModal ──────────────────────────────────────────────────────────

/**
 * Premium fullscreen modal that embeds the YouTube player via iframe.
 * Rendered via React Portal to escape all z-index stacking contexts.
 */
const FullscreenModal = ({ videoId, title, onClose }) => {
  // Escape key to close
  useEffect(() => {
    const handleKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  // Lock body scroll while open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  return createPortal(
    <AnimatePresence>
      {/* ── Backdrop — click outside to close ── */}
      <motion.div
        key="yt-modal-backdrop"
        variants={backdropVariants}
        initial="hidden"
        animate="visible"
        exit="exit"
        onClick={onClose}
        className="fixed inset-0 z-[10020] flex items-center justify-center p-4"
        style={{
          background: 'rgba(0,0,0,0.92)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
        }}
        aria-modal="true"
        role="dialog"
        aria-label={`${title} full demo`}
      >
        {/* ── Modal card ── */}
        <motion.div
          key="yt-modal-card"
          variants={modalVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
          onClick={(e) => e.stopPropagation()}
          className="relative w-full overflow-hidden rounded-2xl border border-white/10"
          style={{
            maxWidth: 'min(860px, 92vw)',
            background: 'rgba(8,8,16,0.98)',
            boxShadow: '0 40px 100px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.06)',
          }}
        >
          {/* Close button */}
          <motion.button
            type="button"
            aria-label="Close demo video"
            id="video-demo-modal-close"
            onClick={onClose}
            whileHover={{ scale: 1.1, rotate: 90 }}
            whileTap={{ scale: 0.9 }}
            transition={{ type: 'spring', stiffness: 300, damping: 18 }}
            className="absolute right-3 top-3 z-20 flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-black/55 text-white/60 backdrop-blur-md transition-colors duration-200 hover:border-red-500/50 hover:bg-red-500/15 hover:text-white"
          >
            <X className="h-4 w-4" />
          </motion.button>

          {/* Title bar */}
          <div className="flex items-center gap-3 border-b border-white/8 px-5 py-3">
            <span className="h-2 w-2 rounded-full bg-[#FF0000] animate-pulse" />
            <span className="text-sm font-semibold text-white/75">{title}</span>
            <span className="ml-auto flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-widest text-white/30">
              {/* YouTube wordmark hint */}
              <svg width="14" height="10" viewBox="0 0 24 17" fill="currentColor" className="opacity-50">
                <path d="M23.498 2.686A3.003 3.003 0 0 0 21.393.557C19.505 0 12 0 12 0S4.495 0 2.607.557A3.003 3.003 0 0 0 .502 2.686C0 4.6 0 8.5 0 8.5s0 3.9.502 5.814a3.003 3.003 0 0 0 2.105 2.129C4.495 17 12 17 12 17s7.505 0 9.393-.557a3.003 3.003 0 0 0 2.105-2.13C24 12.4 24 8.5 24 8.5s0-3.9-.502-5.814zM9.545 12.07V4.93L15.818 8.5l-6.273 3.57z"/>
              </svg>
              Full Demo
            </span>
          </div>

          {/* YouTube embed */}
          <div className="relative bg-black" style={{ aspectRatio: '16/9' }}>
            <iframe
              src={getYouTubeEmbedUrl(videoId)}
              title={`${title} demo video`}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              className="h-full w-full border-0"
              style={{ display: 'block', width: '100%', aspectRatio: '16/9' }}
            />
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
};

// ─── VideoDemo ────────────────────────────────────────────────────────────────

import { useIsMobile } from '@/hooks/use-mobile';

const VideoDemo = ({ title, videoUrl, poster }) => {
  const videoId = extractYouTubeId(videoUrl);
  const isAvailable = Boolean(videoId);
  const isMobile = useIsMobile();

  const [isHovered, setIsHovered] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [shouldLoadIframe, setShouldLoadIframe] = useState(false);

  useEffect(() => {
    if (!isAvailable) return;
    setShouldLoadIframe(false);
    const timer = setTimeout(() => {
      setShouldLoadIframe(true);
    }, 160);
    return () => clearTimeout(timer);
  }, [videoId, isAvailable]);

  const openModal  = useCallback(() => { if (isAvailable) setIsModalOpen(true); }, [isAvailable]);
  const closeModal = useCallback(() => setIsModalOpen(false), []);

  const showUnavailable = !isAvailable;
  const thumbnailUrl = videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : poster;
  // Adaptive preview height — shorter on mobile to leave room for content
  const previewHeight = isMobile ? 130 : 175;

  return (
    <>
      {/* ── Preview container ── */}
      <motion.div
        className="relative overflow-hidden bg-black/40"
        style={{ height: previewHeight, cursor: isAvailable ? 'pointer' : 'default' }}
        variants={previewVariants}
        initial="hidden"
        animate="visible"
        exit="exit"
        onHoverStart={() => isAvailable && setIsHovered(true)}
        onHoverEnd={() => setIsHovered(false)}
        onClick={openModal}
        role={isAvailable ? 'button' : undefined}
        aria-label={isAvailable ? `Watch ${title} full demo on YouTube` : `${title} demo unavailable`}
        tabIndex={isAvailable ? 0 : -1}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') openModal(); }}
      >
        {/* ── Autoplay muted preview: YouTube iframe or fallback poster ── */}
        {isAvailable ? (
          <motion.div
            className="absolute inset-0 overflow-hidden"
            animate={{ scale: isHovered ? 1.04 : 1 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            aria-hidden="true"
          >
            {/* Always render lightweight thumbnail image first for 60 FPS transitions */}
            <img
              src={thumbnailUrl}
              alt={`${title} preview thumbnail`}
              className="absolute inset-0 h-full w-full object-cover"
            />
            {/* Mount iframe smoothly after card transition completes */}
            {shouldLoadIframe && (
              <iframe
                src={getYouTubePreviewUrl(videoId)}
                title={`${title} preview`}
                allow="autoplay; encrypted-media"
                className="absolute border-0"
                style={{
                  top: '-10%',
                  left: '-10%',
                  width: '120%',
                  height: '120%',
                  pointerEvents: 'none',
                }}
              />
            )}
          </motion.div>
        ) : (
          /* Fallback poster when no valid videoId */
          <motion.img
            src={poster}
            alt={`${title} preview`}
            animate={{ scale: isHovered ? 1.04 : 1 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            className="h-full w-full"
            style={{ objectFit: 'cover', display: 'block' }}
            aria-hidden="true"
          />
        )}

        {/* ── Transparent click-capture layer (sits above iframe, below overlays) ── */}
        <div className="absolute inset-0" style={{ zIndex: 1 }} />

        {/* ── Subtle dark scrim ── */}
        <div className="absolute inset-0 bg-black/15 pointer-events-none" style={{ zIndex: 2 }} />

        {/* ── "Demo unavailable" badge (placeholder URL or no videoId) ── */}
        {showUnavailable && (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5 rounded-full border border-white/15 bg-black/60 px-3 py-1 backdrop-blur-md">
            <VideoOff className="h-3 w-3 text-white/50" />
            <span className="text-[10px] font-medium text-white/50 whitespace-nowrap">Demo unavailable</span>
          </div>
        )}

        {/* ── Hover overlay (only when video is available) ── */}
        {isAvailable && (
          <AnimatePresence>
            {isHovered && (
              <motion.div
                key="yt-hover-overlay"
                variants={overlayVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
                className="absolute inset-0 flex flex-col items-center justify-center gap-2"
                style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(2px)' }}
              >
                {/* Play circle */}
                <motion.div
                  initial={{ scale: 0.7, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.7, opacity: 0 }}
                  transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                  className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-white/70 bg-white/15 shadow-2xl backdrop-blur-md"
                >
                  <Play className="h-6 w-6 fill-white text-white translate-x-0.5" />
                </motion.div>

                {/* Label */}
                <motion.span
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 5 }}
                  transition={{ duration: 0.2, delay: 0.06 }}
                  className="text-xs font-semibold tracking-wide text-white/90"
                >
                  Watch Full Demo
                </motion.span>
              </motion.div>
            )}
          </AnimatePresence>
        )}

        {/* ── Feature Preview badge — bottom-left corner ── */}
        <div className="absolute left-2.5 bottom-2.5 z-10 flex items-center gap-1.5 rounded-full border border-white/15 bg-black/60 px-2.5 py-1 backdrop-blur-md">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#15DCFF]" />
          <span className="text-[10px] font-semibold text-white/80">Feature Preview</span>
        </div>

        {/* ── Maximize icon — bottom-right corner ── */}
        {isAvailable && (
          <motion.button
            type="button"
            aria-label={`Open ${title} demo in fullscreen`}
            id={`video-demo-fullscreen-${title.toLowerCase().replace(/\s+/g, '-')}`}
            onClick={(e) => { e.stopPropagation(); openModal(); }}
            animate={{ opacity: isHovered ? 1 : 0.6 }}
            transition={{ duration: 0.2 }}
            className="absolute right-2.5 bottom-2.5 z-10 flex h-7 w-7 items-center justify-center rounded-lg border border-white/20 bg-black/60 text-white backdrop-blur-md hover:border-white/40 hover:bg-black/80 transition-colors duration-200"
            tabIndex={-1}
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </motion.button>
        )}

        {/* ── Bottom gradient fade into card body ── */}
        <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[#0e0e13] to-transparent pointer-events-none" />


      </motion.div>

      {/* ── Fullscreen YouTube modal ── */}
      {isModalOpen && isAvailable && (
        <FullscreenModal videoId={videoId} title={title} onClose={closeModal} />
      )}
    </>
  );
};

export default VideoDemo;
