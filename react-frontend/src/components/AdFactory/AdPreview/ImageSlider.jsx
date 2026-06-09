import { Swiper, SwiperSlide } from 'swiper/react';
import 'swiper/css';
import 'swiper/css/navigation';
import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const ImageSlider = ({ mockImages, onSelect, selectedImage }) => {
  const [swiper, setSwiper] = useState(null);
  const [isBeginning, setIsBeginning] = useState(true);
  const [isEnd, setIsEnd] = useState(false);
  const swiperRef = useRef(null);

  // Auto-select first image when images are loaded and none is selected
  useEffect(() => {
    if (mockImages?.length > 0 && !selectedImage && onSelect) {
      onSelect(mockImages[0].src);
    }
  }, [mockImages, selectedImage, onSelect]);

  useEffect(() => {
    if (swiper) {
      swiper.update();
      setIsBeginning(swiper.isBeginning);
      setIsEnd(swiper.isEnd);
    }
  }, [mockImages, swiper]);

  useEffect(() => {
    if (!swiper) return;

    if (!selectedImage) {
      swiper.slideTo(0);
      return;
    }

    const index = mockImages.findIndex((img) => img.src === selectedImage);
    if (index !== -1) {
      swiper.slideTo(index);
    }
  }, [selectedImage, swiper, mockImages]);

  return (
    <div className="relative overflow-visible pb-2">
      <button
        onClick={() => swiper?.slidePrev()}
        disabled={isBeginning}
        className={`absolute top-1/2 -left-3 z-10 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/5 dark:bg-white/10 shadow-lg backdrop-blur-lg transition-all md:left-[-22px] 2xl:h-10 2xl:w-10 ${
          isBeginning ? 'pointer-events-none opacity-0 invisible' : 'opacity-100 hover:bg-black/5 dark:hover:bg-white/20'
        }`}
      >
        <ChevronLeft className="h-6 w-6 text-gray-900 dark:text-white 2xl:h-7 2xl:w-7" />
      </button>

      <button
        onClick={() => swiper?.slideNext()}
        disabled={isEnd}
        className={`absolute top-1/2 -right-3 z-10 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/5 dark:bg-white/10 shadow-lg backdrop-blur-lg transition-all md:right-[-22px] 2xl:h-10 2xl:w-10 ${
          isEnd ? 'pointer-events-none opacity-0 invisible' : 'opacity-100 hover:bg-black/5 dark:hover:bg-white/20'
        }`}
      >
        <ChevronRight className="h-6 w-6 text-gray-900 dark:text-white 2xl:h-7 2xl:w-7" />
      </button>

      <Swiper
        onSwiper={(s) => {
          setSwiper(s);
          setIsBeginning(s.isBeginning);
          setIsEnd(s.isEnd);
        }}
        onSlideChange={(s) => {
          setIsBeginning(s.isBeginning);
          setIsEnd(s.isEnd);
        }}
        spaceBetween={12}
        breakpoints={{
          420: {
            slidesPerView: 2.2,
            spaceBetween: 12,
          },
          640: {
            slidesPerView: 3,
            spaceBetween: 14,
          },
          768: {
            slidesPerView: 4,
            spaceBetween: 14,
          },
          1200: {
            slidesPerView: 5,
            spaceBetween: 16,
          },
        }}
        className="ad-image-swiper"
      >
        {mockImages.map(({ src, id }, index) => (
          <SwiperSlide key={id}>
            <div
              className={`group relative h-38 cursor-pointer overflow-hidden rounded-xl bg-gray-100 dark:bg-white/5 hover:opacity-80 2xl:h-45 ${
                selectedImage === src ? 'border-3 border-[#2364B8]' : ''
              }`}
              onClick={() => onSelect(src)}
            >
              <img
                src={src}
                alt="Ad creative"
                className="transition-scale h-full w-full scale-100 object-cover duration-300 hover:scale-105"
              />
            </div>
          </SwiperSlide>
        ))}
      </Swiper>
    </div>
  );
};

export default ImageSlider;
