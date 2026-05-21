import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Swiper, SwiperSlide } from 'swiper/react';
import { Navigation } from 'swiper/modules';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import 'swiper/css';
import 'swiper/css/navigation';

const VideoAdCardCarousel = ({ videos }) => {
  const prevRef = useRef(null);
  const nextRef = useRef(null);
  const swiperRef = useRef(null);
  const [isBeginning, setIsBeginning] = useState(true);
  const [isEnd, setIsEnd] = useState(false);

  const slides = useMemo(() => {
    if (!videos || videos.length === 0) return [];
    return videos;
  }, [videos]);

  useEffect(() => {
    const swiper = swiperRef.current;
    if (!swiper || !prevRef.current || !nextRef.current) return;

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
    setIsEnd(swiper.isEnd || slides.length <= 1);
  }, [slides.length]);

  return (
    <div className="relative aspect-video w-full">
      <Swiper
        modules={[Navigation]}
        slidesPerView={1}
        spaceBetween={0}
        onSwiper={(swiper) => {
          swiperRef.current = swiper;
          setIsBeginning(swiper.isBeginning);
          setIsEnd(swiper.isEnd || slides.length <= 1);
          swiper.on('slideChange', () => {
            setIsBeginning(swiper.isBeginning);
            setIsEnd(swiper.isEnd);
          });
        }}
        key={`videos-${slides.length}`}
        className="rounded-b-10"
      >
        {slides.map((src, idx) => (
          <SwiperSlide key={idx}>
            <div className="aspect-video w-full">
              <iframe
                src={src}
                title={`Ad Video ${idx + 1}`}
                frameBorder="0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className="rounded-b-10 h-full w-full object-cover"
              ></iframe>
            </div>
          </SwiperSlide>
        ))}
      </Swiper>

      {slides.length > 1 && (
        <>
          <button
            ref={prevRef}
            aria-label="Previous video"
            className={`absolute top-1/2 left-2 z-20 -translate-y-1/2 rounded-full border border-white/20 bg-white/20 p-1 text-white backdrop-blur-sm hover:bg-white/10 hover:backdrop-blur-md ${isBeginning ? 'invisible' : ''}`}
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            ref={nextRef}
            aria-label="Next video"
            className={`absolute top-1/2 right-2 z-20 -translate-y-1/2 rounded-full border border-white/20 bg-white/20 p-1 text-white backdrop-blur-sm hover:bg-white/10 hover:backdrop-blur-md ${isEnd ? 'invisible' : ''}`}
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </>
      )}
    </div>
  );
};

export default VideoAdCardCarousel;
