import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Swiper, SwiperSlide } from 'swiper/react';
import { Navigation, Mousewheel } from 'swiper/modules';
import 'swiper/css';
import 'swiper/css/navigation';
import React, { useEffect, useRef, useState } from 'react';

const ImageCarousel = ({ slides }) => {
  const [isBeginning, setIsBeginning] = useState(true);
  const [isEnd, setIsEnd] = useState(false);
  const prevRef = useRef(null);
  const nextRef = useRef(null);
  const swiperRef = useRef(null);

  return (
    <div className="relative mt-5">
      <Swiper
        modules={[Navigation, Mousewheel]}
        mousewheel={true}
        slidesPerView={2}
        spaceBetween={10}
        className="mt-2 rounded-lg"
        navigation={{
          prevEl: prevRef.current,
          nextEl: nextRef.current,
        }}
        breakpoints={{
          320: { slidesPerView: 1.5 },
          420: { slidesPerView: 2 },
          640: { slidesPerView: 3 },
          1280: { slidesPerView: 2 },
        }}
        onSwiper={(swiper) => {
          swiperRef.current = swiper;
          setIsBeginning(swiper.isBeginning);
          setIsEnd(swiper.isEnd || slides.length <= 1);

          swiper.on('slideChange', () => {
            setIsBeginning(swiper.isBeginning);
            setIsEnd(swiper.isEnd);
          });

          setTimeout(() => {
            setIsBeginning(swiper.isBeginning);
            setIsEnd(swiper.isEnd);
          }, 100);
        }}
        onBeforeInit={(swiper) => {
          // Attach refs before swiper initializes
          swiper.params.navigation.prevEl = prevRef.current;
          swiper.params.navigation.nextEl = nextRef.current;
        }}
      >
        {slides.map((slide, idx) => (
          <SwiperSlide key={idx}>
            <>
              <div className="w-full rounded-lg bg-[#202126]">
                <div className="flex items-center gap-2 p-2.5">
                  <slide
                    src="https://content-dev.poweradspy.com//PowerAdspy-Dev/fb/adImage/2025/90616.webp"
                    alt=""
                    className="h-6 w-6 rounded-full"
                  />
                  <h6 className="text-xs font-medium">Stitch Monkey</h6>
                </div>

                {slide.type === 'image' ? (
                  <div className="aspect-[4/5] overflow-hidden">
                    <img
                      src={slide.url}
                      alt={`Ad ${idx + 1}`}
                      className="h-full w-full object-cover"
                    />
                  </div>
                ) : (
                  <div className="aspect-[4/5] h-full w-full">
                    <iframe
                      src={slide.url}
                      title={`Ad Video ${idx + 1}`}
                      frameBorder="0"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                      className="h-full w-full object-cover"
                      onMouseEnter={(e) => (e.currentTarget.style.pointerEvents = 'auto')}
                      onMouseLeave={(e) => (e.currentTarget.style.pointerEvents = 'none')}
                    ></iframe>
                  </div>
                )}

                <div className="py-2 pr-1 pl-4">
                  <p className="line-clamp-1 text-sm font-medium text-[#AFAFAF]">
                    Lorem ipsum dolor sit amet consectetur, adipisicing elit. Id, distinctio ut
                    sequi voluptate quae cum excepturi! Voluptate laborum, deserunt labore obcaecati
                    eaque est architecto vero, mollitia nisi impedit, accusantium magnam.
                  </p>
                </div>
              </div>
            </>
          </SwiperSlide>
        ))}
      </Swiper>

      {slides.length > 1 && (
        <>
          <button
            aria-label="Previous image"
            ref={prevRef}
            className={`absolute top-1/2 left-2 z-20 -translate-y-1/2 rounded-full border border-white/20 bg-[#474545] p-1 text-white backdrop-blur-sm hover:opacity-70 ${isBeginning ? 'hidden' : ''}`}
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            aria-label="Next image"
            ref={nextRef}
            className={`absolute top-1/2 right-2 z-20 -translate-y-1/2 rounded-full border border-white/20 bg-[#474545] p-1 text-white backdrop-blur-sm hover:opacity-70 ${isEnd ? 'hidden' : ''}`}
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </>
      )}
    </div>
  );
};

export default ImageCarousel;
