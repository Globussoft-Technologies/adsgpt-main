import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ChevronLeft, ChevronRight, ChevronLeftCircle, ChevronRightCircle } from 'lucide-react';
import { createPortal } from 'react-dom';

const ShowLightBox = ({ lightboxImage, closeLightbox, images = [], variant = 'default' }) => {
  const isManualPosting = variant === 'manual-posting';
  // If images array is provided, use it, otherwise use single lightboxImage
  const imageList = images.length > 0 ? images : [lightboxImage];
  const [currentIndex, setCurrentIndex] = useState(0);
  const [thumbnailStartIndex, setThumbnailStartIndex] = useState(0);
  const thumbnailContainerRef = useRef(null);
  const selectedThumbnailRef = useRef(null);

  // Maximum thumbnails to show at once
  const MAX_THUMBNAILS = 3;

  // Calculate visible thumbnails
  const visibleThumbnails = imageList.slice(
    thumbnailStartIndex,
    thumbnailStartIndex + MAX_THUMBNAILS
  );

  // If lightboxImage is provided and not in images array, set it as current
  useEffect(() => {
    if (lightboxImage && images.length === 0) {
      setCurrentIndex(0);
    } else if (lightboxImage && images.length > 0) {
      const index = images.findIndex((img) => img === lightboxImage);
      if (index !== -1) {
        setCurrentIndex(index);
        // Ensure thumbnail carousel shows the current image
        if (index >= thumbnailStartIndex + MAX_THUMBNAILS || index < thumbnailStartIndex) {
          setThumbnailStartIndex(Math.max(0, index - Math.floor(MAX_THUMBNAILS / 2)));
        }
      }
    }
  }, [lightboxImage, images]);

  // Update thumbnail carousel when current image changes
  useEffect(() => {
    if (imageList.length > MAX_THUMBNAILS) {
      if (currentIndex >= thumbnailStartIndex + MAX_THUMBNAILS) {
        // Current image is beyond visible thumbnails, shift right
        setThumbnailStartIndex(currentIndex - MAX_THUMBNAILS + 1);
      } else if (currentIndex < thumbnailStartIndex) {
        // Current image is before visible thumbnails, shift left
        setThumbnailStartIndex(currentIndex);
      }
    }
  }, [currentIndex, imageList.length]);

  useEffect(() => {
    if (!isManualPosting) return;

    selectedThumbnailRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'center',
    });
  }, [currentIndex, isManualPosting]);

  const goToNext = (e) => {
    if (e) e.stopPropagation();
    setCurrentIndex((prevIndex) => (prevIndex + 1) % imageList.length);
  };

  const goToPrev = (e) => {
    if (e) e.stopPropagation();
    setCurrentIndex((prevIndex) => (prevIndex - 1 + imageList.length) % imageList.length);
  };

  const goToNextThumbnail = (e) => {
    e.stopPropagation();
    if (thumbnailStartIndex + MAX_THUMBNAILS < imageList.length) {
      setThumbnailStartIndex((prev) => prev + 1);
    }
  };

  const goToPrevThumbnail = (e) => {
    e.stopPropagation();
    if (thumbnailStartIndex > 0) {
      setThumbnailStartIndex((prev) => prev - 1);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowRight') goToNext(e);
    if (e.key === 'ArrowLeft') goToPrev(e);
    if (e.key === 'Escape') closeLightbox();
  };

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  return createPortal(
    <motion.div
      onPointerDown={(e) => e.stopPropagation()}
      // onClick={closeLightbox}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className={`pointer-events-auto fixed inset-0 z-[999] flex items-center justify-center bg-[#0D0D0D80] backdrop-blur-[100px] ${
        isManualPosting ? 'p-3 sm:p-5' : 'rounded-4xl'
      }`}
    >
      <div
        className={`relative flex w-full items-center justify-center ${
          isManualPosting ? 'h-full max-w-6xl' : 'max-w-2xl 2xl:max-w-4xl'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Lightbox Container */}

        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.8, opacity: 0 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className={`relative flex items-center justify-center ${
            isManualPosting
              ? 'h-full min-h-0 w-full flex-col gap-3 px-2 pt-12 pb-2 sm:px-14 sm:pt-14 sm:pb-3'
              : 'h-fit max-h-[55vh] w-fit max-w-4xl px-9 pb-10 2xl:max-h-[70vh]'
          }`}
        >
          <button
            onClick={closeLightbox}
            aria-label="Close image preview"
            className={`absolute z-20 cursor-pointer rounded-full bg-gray-700 text-white transition hover:bg-gray-600 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none ${
              isManualPosting
                ? 'top-1 right-2 p-2 sm:top-2 sm:right-4 sm:p-2.5'
                : '-top-10 right-6 p-1.5 2xl:-top-15 2xl:right-3 2xl:scale-125 2xl:p-2'
            }`}
          >
            <X className="h-4.5 w-4.5 text-white 2xl:h-5 2xl:w-5" />
          </button>

          <div
            className={
              isManualPosting
                ? 'relative flex min-h-0 w-full flex-1 items-center justify-center'
                : 'contents'
            }
          >
            {/* Previous Button - Only show if multiple images */}
            {imageList.length > 1 && currentIndex > 0 && (
              <button
                onClick={goToPrev}
                aria-label="Show previous image"
                className={`absolute z-10 cursor-pointer rounded-full bg-black/55 text-white transition hover:bg-black/75 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none ${
                  isManualPosting ? 'left-1 p-2.5 sm:left-3 sm:p-3' : 'left-4 p-2 2xl:p-3'
                }`}
              >
                <ChevronLeft className="h-5 w-5 text-white 2xl:h-6 2xl:w-6" />
              </button>
            )}

            {/* Image Container */}
            <AnimatePresence mode="wait">
              <motion.img
                key={currentIndex}
                src={imageList[currentIndex]}
                alt={`Lightbox view ${currentIndex + 1} of ${imageList.length}`}
                className={
                  isManualPosting
                    ? 'h-auto max-h-full w-auto max-w-full rounded-2xl object-contain shadow-2xl'
                    : 'mt-4 h-auto max-h-[50vh] w-full min-w-[300px] rounded-2xl object-contain 2xl:max-h-[70vh] 2xl:min-w-[450px]'
                }
              />
            </AnimatePresence>

            {/* Next Button - Only show if multiple images */}
            {imageList.length > 1 && currentIndex < imageList.length - 1 && (
              <button
                onClick={goToNext}
                aria-label="Show next image"
                className={`absolute z-10 cursor-pointer rounded-full bg-black/55 text-white transition hover:bg-black/75 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none ${
                  isManualPosting ? 'right-1 p-2.5 sm:right-3 sm:p-3' : 'right-4 p-2 2xl:p-3'
                }`}
              >
                <ChevronRight className="h-5 w-5 text-white 2xl:h-6 2xl:w-6" />
              </button>
            )}
          </div>

          {/* Thumbnail Container - Only show if multiple images */}
          {imageList.length > 1 && isManualPosting && (
            <div className="flex w-full shrink-0 flex-col items-center gap-2">
              <p className="text-xs font-medium text-white/80" aria-live="polite">
                Image {currentIndex + 1} of {imageList.length}
              </p>
              <div
                ref={thumbnailContainerRef}
                className="scrollbar-thin flex max-w-full gap-2 overflow-x-auto rounded-2xl bg-black/25 px-3 py-2.5 backdrop-blur-md sm:gap-3 sm:px-4"
                aria-label="All image previews"
              >
                {imageList.map((img, index) => (
                  <button
                    key={`${img}-${index}`}
                    ref={index === currentIndex ? selectedThumbnailRef : null}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setCurrentIndex(index);
                    }}
                    aria-label={`Show image ${index + 1} of ${imageList.length}`}
                    aria-current={index === currentIndex ? 'true' : undefined}
                    className={`h-14 w-14 shrink-0 overflow-hidden rounded-lg border-2 transition sm:h-16 sm:w-16 ${
                      index === currentIndex
                        ? 'scale-[1.04] border-[#02C8C4] shadow-[0_0_0_2px_rgba(2,200,196,0.2)]'
                        : 'border-white/20 opacity-80 hover:border-white/70 hover:opacity-100'
                    }`}
                  >
                    <img
                      src={img}
                      alt=""
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  </button>
                ))}
              </div>
            </div>
          )}

          {imageList.length > 1 && !isManualPosting && (
            <div className="absolute -bottom-20 left-1/2 flex -translate-x-1/2 items-center gap-2">
              {/* Previous Thumbnail Button - Only show if more than MAX_THUMBNAILS */}
              {imageList.length > MAX_THUMBNAILS && thumbnailStartIndex > 0 && (
                <button
                  onClick={goToPrevThumbnail}
                  className="z-10 cursor-pointer rounded-full bg-black/30 p-1 hover:bg-black/50"
                >
                  <ChevronLeftCircle className="h-5 w-5 text-white/70 hover:text-white" />
                </button>
              )}

              {/* Thumbnail Strip */}
              <div className="flex gap-2" ref={thumbnailContainerRef}>
                {visibleThumbnails.map((img, idx) => {
                  const actualIndex = thumbnailStartIndex + idx;
                  return (
                    <button
                      key={actualIndex}
                      onClick={(e) => {
                        e.stopPropagation();
                        setCurrentIndex(actualIndex);
                      }}
                      className={`h-12 w-12 overflow-hidden rounded-lg border-2 transition-all duration-200 ${
                        actualIndex === currentIndex
                          ? 'scale-110 border-[#02C8C4]'
                          : 'border-transparent hover:border-white/50'
                      }`}
                    >
                      <img
                        src={img}
                        alt={`Thumbnail ${actualIndex + 1}`}
                        className="h-full w-full object-cover"
                      />
                    </button>
                  );
                })}
              </div>

              {/* Next Thumbnail Button - Only show if more than MAX_THUMBNAILS */}
              {imageList.length > MAX_THUMBNAILS &&
                thumbnailStartIndex + MAX_THUMBNAILS < imageList.length && (
                  <button
                    onClick={goToNextThumbnail}
                    className="z-10 cursor-pointer rounded-full bg-black/30 p-1 hover:bg-black/50"
                  >
                    <ChevronRightCircle className="h-5 w-5 text-white/70 hover:text-white" />
                  </button>
                )}
            </div>
          )}
        </motion.div>
      </div>
    </motion.div>,
    document.body
  );
};

export default ShowLightBox;
