import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, X, Plus } from 'lucide-react';
import { useSelector } from 'react-redux';

// Native horizontal scroller for the image tiles. The "Add image" card is a
// fixed sibling pinned to the right (OUTSIDE the scroller) so it's always
// visible and the tiles can never slide underneath it. Same tile dimensions
// for images and the add card so the row reads as one strip.
const TILE = 'h-38 w-44 2xl:h-45 2xl:w-52';

const ImageSlider = ({ mockImages, onSelect, selectedImage, onRemoveImage, onAddImage }) => {
  const scrollRef = useRef(null);
  const isDarkMode = useSelector((state) => state.theme?.isDarkMode);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const updateArrows = () => {
    const el = scrollRef.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 4);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  };

  // Recompute arrow visibility when the set of images changes or the viewport
  // resizes (the scroller width shifts with the layout).
  useEffect(() => {
    updateArrows();
    window.addEventListener('resize', updateArrows);
    return () => window.removeEventListener('resize', updateArrows);
  }, [mockImages]);

  // Auto-select first image when none is selected.
  useEffect(() => {
    if (mockImages?.length > 0 && !selectedImage && onSelect) {
      onSelect(mockImages[0].src);
    }
  }, [mockImages, selectedImage, onSelect]);

  // Bring the selected tile into horizontal view WITHIN this scroller only.
  // NB: don't use scrollIntoView — it walks up and scrolls the page/<main>
  // vertical scroller too, which yanked the whole preview back to the top on
  // any re-render. scrollBy on `el` affects only this container. Depend on
  // `selectedImage` alone; `mockImages` is a fresh array each render, so
  // including it would re-fire (and re-scroll) on every parent update.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !selectedImage) return;
    const idx = mockImages.findIndex((img) => img.src === selectedImage);
    const node = idx >= 0 ? el.querySelector(`[data-idx="${idx}"]`) : null;
    if (!node) return;
    const elRect = el.getBoundingClientRect();
    const nodeRect = node.getBoundingClientRect();
    const delta = nodeRect.left - elRect.left - (el.clientWidth - node.clientWidth) / 2;
    el.scrollBy({ left: delta, behavior: 'smooth' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedImage]);

  const scrollByDir = (dir) => {
    const el = scrollRef.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: 'smooth' });
  };

  return (
    <div className="flex items-start gap-3">
      {/* Scroller — images only. flex-1 + min-w-0 so it takes the space left
          of the add card and can shrink to allow horizontal scrolling. */}
      <div className="relative min-w-0 flex-1">
        <button
          type="button"
          onClick={() => scrollByDir(-1)}
          disabled={!canLeft}
          className={`absolute top-1/2 left-1 z-30 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white shadow-lg backdrop-blur-lg transition-all 2xl:h-10 2xl:w-10 ${
            canLeft ? 'opacity-100 hover:bg-black/65' : 'pointer-events-none invisible opacity-0'
          }`}
        >
          <ChevronLeft className="h-6 w-6 2xl:h-7 2xl:w-7" />
        </button>

        <button
          type="button"
          onClick={() => scrollByDir(1)}
          disabled={!canRight}
          className={`absolute top-1/2 right-1 z-30 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white shadow-lg backdrop-blur-lg transition-all 2xl:h-10 2xl:w-10 ${
            canRight ? 'opacity-100 hover:bg-black/65' : 'pointer-events-none invisible opacity-0'
          }`}
        >
          <ChevronRight className="h-6 w-6 2xl:h-7 2xl:w-7" />
        </button>

        <div
          ref={scrollRef}
          onScroll={updateArrows}
          className={`${isDarkMode ? 'scrollbar-white' : ''} flex gap-3 overflow-x-auto pb-2`}
        >
          {mockImages.map(({ src, id, isUser, source }, index) => (
            <div
              key={id}
              data-idx={index}
              onClick={() => onSelect(src)}
              className={`group relative ${TILE} shrink-0 cursor-pointer overflow-hidden rounded-xl bg-gray-100 hover:opacity-80 dark:bg-white/5 ${
                selectedImage === src ? 'border-3 border-[#2364B8]' : ''
              }`}
            >
              <img
                src={src}
                alt="Ad creative"
                className="transition-scale h-full w-full scale-100 object-cover duration-300 hover:scale-105"
              />

              {isUser && (
                <span className="absolute bottom-1.5 left-1.5 rounded-full bg-black/60 px-2 py-0.5 text-[10px] leading-none font-medium capitalize text-white backdrop-blur-sm">
                  {source === 'link' ? 'Linked' : source === 'app' ? 'Library' : 'Uploaded'}
                </span>
              )}

              {isUser && onRemoveImage && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveImage(id, src);
                  }}
                  className="absolute top-1.5 right-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white opacity-0 backdrop-blur-sm transition-opacity hover:bg-red-500 group-hover:opacity-100"
                  aria-label="Remove image"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Add card — fixed on the right, always visible, never overlapped. */}
      {onAddImage && (
        <button
          type="button"
          onClick={onAddImage}
          className={`group ${TILE} flex shrink-0 flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-black/15 bg-gray-100 text-gray-500 transition-colors hover:border-[#2364B8] hover:text-[#2364B8] dark:border-white/15 dark:bg-white/5 dark:text-white/60 dark:hover:border-[#2364B8] dark:hover:text-white`}
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-black/5 transition-colors group-hover:bg-[#2364B8]/10 dark:bg-white/10 2xl:h-11 2xl:w-11">
            <Plus className="h-5 w-5 2xl:h-6 2xl:w-6" />
          </span>
          <span className="text-xs font-medium 2xl:text-sm">Add image</span>
        </button>
      )}
    </div>
  );
};

export default ImageSlider;
