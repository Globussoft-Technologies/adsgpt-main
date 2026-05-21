import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Swiper, SwiperSlide } from 'swiper/react';
import { Navigation } from 'swiper/modules';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import 'swiper/css';
import 'swiper/css/navigation';
import { useDynamicBackground } from '@/hooks/useDynamicBackground';

const BrandCardCarousel = ({ from = '', images, onImagesLoaded }) => {
  const prevRef = useRef(null);
  const nextRef = useRef(null);
  const swiperRef = useRef(null);
  const [isBeginning, setIsBeginning] = useState(true);
  const [isEnd, setIsEnd] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [loadedCount, setLoadedCount] = useState(0);

  useEffect(() => {
    if (loadedCount === images?.length && images?.length > 0) {
      onImagesLoaded?.();
    }
  }, [loadedCount, images?.length, onImagesLoaded]);

  const slides = useMemo(() => {
    if (!images || images?.length === 0) return [];
    return images;
  }, [images]);

  const navImages = useMemo(() => {
    if (!slides || slides?.length === 0) return [];
    return [{ id: 'current', url: slides[activeIndex] }];
  }, [slides, activeIndex]);

  const bgColors = useDynamicBackground(navImages, '#2a2a2a', '#474545');

  useEffect(() => {
    const swiper = swiperRef.current;
    if (!swiper || !prevRef.current || !nextRef.current) return;

    // Wire up navigation after refs exist
    swiper.params.navigation = {
      ...(swiper.params.navigation || {}),
      prevEl: prevRef.current,
      nextEl: nextRef.current,
    };
    if (swiper.navigation && typeof swiper.navigation.destroy === 'function') {
      swiper.navigation.destroy();
    }
    swiper.navigation.init();
    swiper.navigation.update();
    setIsBeginning(swiper.isBeginning);
    setIsEnd(swiper.isEnd || slides?.length <= 1);
  }, [slides.length]);

  return (
    <div className="relative">
      <Swiper
        modules={[Navigation]}
        slidesPerView={1}
        spaceBetween={0}
        onSwiper={(swiper) => {
          swiperRef.current = swiper;
          setIsBeginning(swiper.isBeginning);
          setIsEnd(swiper.isEnd || slides?.length <= 1);
          setActiveIndex(swiper.activeIndex);

          swiper.on('slideChange', () => {
            setIsBeginning(swiper.isBeginning);
            setIsEnd(swiper.isEnd);
            setActiveIndex(swiper.activeIndex);
          });
        }}
        key={`images-${slides?.length}`}
        className="rounded-b-10"
      >
        {slides?.map((src, idx) => (
          <SwiperSlide key={idx}>
            <>
              {from === 'BrandCard' ? (
                <div className="image_container flex h-64 w-full items-center justify-center p-2 2xl:h-72">
                  <img
                    src={src}
                    alt={`Ad ${idx + 1}`}
                    className="max-h-full max-w-full object-contain"
                    onLoad={() => setLoadedCount((prev) => prev + 1)}
                    onError={() => setLoadedCount((prev) => prev + 1)}
                  />
                </div>
              ) : (
                <div className="h-full w-full">
                  <img src={src} alt={`Ad ${idx + 1}`} className="h-full w-full object-cover" />
                </div>
              )}
            </>
          </SwiperSlide>
        ))}
      </Swiper>

      {slides?.length > 1 && (
        <>
          <button
            ref={prevRef}
            aria-label="Previous image"
            className={`absolute top-1/2 left-2 z-20 -translate-y-1/2 rounded-full border border-white/20 bg-white/20 p-1 text-white backdrop-blur-sm hover:bg-white/10 hover:backdrop-blur-md ${isBeginning ? 'invisible' : ''} `}
            style={{ backgroundColor: bgColors?.current || 'rgba(255,255,255,0.2)' }}
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            ref={nextRef}
            aria-label="Next image"
            className={`absolute top-1/2 right-2 z-20 -translate-y-1/2 rounded-full border border-white/20 bg-white/20 p-1 text-white backdrop-blur-sm hover:bg-white/10 hover:backdrop-blur-md ${isEnd ? 'invisible' : ''}`}
            style={{ backgroundColor: bgColors?.current || 'rgba(255,255,255,0.2)' }}
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </>
      )}
    </div>
  );
};

export default BrandCardCarousel;
