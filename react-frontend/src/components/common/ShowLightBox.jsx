import React, { useEffect } from 'react';
import { AnimatePresence, motion as Motion } from 'framer-motion';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';

const ShowLightBox = ({ images, currentIndex, setCurrentIndex, closeLightbox, lightboxImage }) => {
  // Use images array or single lightboxImage
  const imagesList = images || (lightboxImage ? [lightboxImage] : []);
  const index = currentIndex !== undefined && currentIndex !== null ? currentIndex : 0;

  const isValidState = imagesList && imagesList.length > 0 && index !== null;

  const hasPrev = isValidState && index > 0;
  const hasNext = isValidState && index < imagesList.length - 1;

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') closeLightbox();
      if (e.key === 'ArrowLeft' && hasPrev) {
        setCurrentIndex?.((i) => i - 1);
      }
      if (e.key === 'ArrowRight' && hasNext) {
        setCurrentIndex?.((i) => i + 1);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [closeLightbox, hasPrev, hasNext, setCurrentIndex]);

  if (!isValidState) return null;

  return (
    <AnimatePresence>
      <Motion.div
        onClick={closeLightbox}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-99999 flex items-center justify-center bg-black/80 backdrop-blur-xl"
      >
        <div
          className="relative flex items-center justify-center px-4"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Close */}
          <button
            onClick={closeLightbox}
            className="absolute -top-12 right-2 rounded-full bg-gray-700 p-2 transition-colors hover:bg-gray-600"
          >
            <X className="h-5 w-5 text-white" />
          </button>

          {/* Left Button (Only show if multiple images) */}
          {imagesList.length > 1 && (
            <button
              onClick={() => hasPrev && setCurrentIndex((i) => i - 1)}
              disabled={!hasPrev}
              className={`absolute left-4 rounded-full bg-gray-700 p-3 transition-all hover:bg-gray-600 md:left-6 ${
                hasPrev ? 'cursor-pointer opacity-100' : 'cursor-not-allowed opacity-40'
              }`}
            >
              <ChevronLeft className="h-6 w-6 text-white" />
            </button>
          )}

          {/* Right Button (Only show if multiple images) */}
          {imagesList.length > 1 && (
            <button
              onClick={() => hasNext && setCurrentIndex((i) => i + 1)}
              disabled={!hasNext}
              className={`absolute right-4 rounded-full bg-gray-700 p-3 transition-all hover:bg-gray-600 md:right-6 ${
                hasNext ? 'cursor-pointer opacity-100' : 'cursor-not-allowed opacity-40'
              }`}
            >
              <ChevronRight className="h-6 w-6 text-white" />
            </button>
          )}

          {/* Image */}
          <Motion.img
            key={imagesList[index]}
            src={imagesList[index]}
            className="h-[70vh] rounded-2xl object-contain shadow-2xl"
          />
        </div>
      </Motion.div>
    </AnimatePresence>
  );
};

export default ShowLightBox;
