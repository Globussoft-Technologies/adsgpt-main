import React, { useState, useRef } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useDispatch, useSelector } from 'react-redux';
import { setFields } from '@/store/reducers/adStudio/promptSlice';

const ShowBrandLogos = ({ logos = [] }) => {
  // const logos = [
  //   { id: 1, url: 'https://i.ibb.co/LXRjhj6q/swiggy-removebg-preview.png', name: 'Swiggy' },
  //   { id: 7, url: 'https://i.ibb.co/8DHnSpDJ/temp-logo.png', name: 'Temp Logo 1' },
  //   { id: 5, url: 'https://i.ibb.co/d0s087MK/empmonitor-logo.png', name: 'EmpMonitor' },
  //   { id: 2, url: 'https://i.ibb.co/LXRjhj6q/swiggy-removebg-preview.png', name: 'Swiggy 2' },
  //   { id: 3, url: 'https://i.ibb.co/8DHnSpDJ/temp-logo.png', name: 'Temp Logo 2' },
  //   { id: 4, url: 'https://i.ibb.co/d0s087MK/empmonitor-logo.png', name: 'EmpMonitor 2' },
  // ];

  const dispatch = useDispatch();
  const { brand_logo } = useSelector((state) => state.prompt);
  // const [selectedLogo, setSelectedLogo] = useState(logos[0]);
  const [currentSlide, setCurrentSlide] = useState(0);
  const [showPrev, setShowPrev] = useState(false);
  const [showNext, setShowNext] = useState(logos.length > 4);

  const swiperRef = useRef(null);
  const slidesPerView = 4; // Show 4 logos at a time

  const handleLogoSelect = (logo) => {
    dispatch(setFields({ brand_logo: logo, uploadedLogo: '' }));
  };

  const handlePrevious = () => {
    if (currentSlide > 0) {
      const newSlide = currentSlide - 1;
      setCurrentSlide(newSlide);
      updateButtonVisibility(newSlide);
    }
  };

  const handleNext = () => {
    const maxSlides = Math.max(0, logos.length - slidesPerView);
    if (currentSlide < maxSlides) {
      const newSlide = currentSlide + 1;
      setCurrentSlide(newSlide);
      updateButtonVisibility(newSlide);
    }
  };

  const updateButtonVisibility = (slide) => {
    setShowPrev(slide > 0);
    setShowNext(slide < Math.max(0, logos.length - slidesPerView));
  };

  React.useEffect(() => {
    const maxSlides = Math.max(0, logos.length - slidesPerView);
    if (currentSlide > maxSlides) {
      setCurrentSlide(0);
      updateButtonVisibility(0);
    } else {
      updateButtonVisibility(currentSlide);
    }
  }, [currentSlide, logos.length]);

  // Handle touch/swipe gestures
  const handleTouchStart = (e) => {
    const touchStartX = e.touches[0].clientX;
    swiperRef.current.touchStartX = touchStartX;
  };

  const handleTouchEnd = (e) => {
    if (!swiperRef.current.touchStartX) return;

    const touchEndX = e.changedTouches[0].clientX;
    const diff = swiperRef.current.touchStartX - touchEndX;

    if (Math.abs(diff) > 50) {
      // Minimum swipe distance
      if (diff > 0 && showNext) {
        handleNext();
      } else if (diff < 0 && showPrev) {
        handlePrevious();
      }
    }
  };

  function getPositionClasses() {
    if (showNext && showPrev) {
      return 'max-w-[230px] left-0 2xl:max-w-[276px]';
    }
    if (showNext) {
      return 'right-[16px] max-w-[230px] 2xl:max-w-[276px]';
    }
    if (showPrev) {
      return 'left-3.5 max-w-[230px] 2xl:max-w-[276px]';
    }
    return '';
  }

  return (
    <div className="w-full">
      <label className="mb-1 block text-[11px] font-normal text-[#afafaf] 2xl:text-sm">
        Select Brand Logo
      </label>

      <div className="relative">
        {/* Left Navigation Button - Absolute Positioned */}
        {showPrev && (
          <button
            onClick={handlePrevious}
            className="absolute top-1/2 left-0 z-10 -translate-y-1/2 rounded-full border border-white/40 bg-[#0D0D0D]/50 p-1 text-[#AFAFAF] backdrop-blur-[70px] transition-colors hover:text-white"
            aria-label="Previous logos"
          >
            <ChevronLeft size={20} />
          </button>
        )}

        {/* Swiper Container - Centered with 80% width */}
        <div className={`mx-auto ${getPositionClasses()} relative`}>
          <div
            ref={swiperRef}
            className={`scroller-hide scrollbar-hide ${logos.length > 4 ? 'ml-3' : 'ml-1.5'} overflow-hidden px-0 pt-2 pb-0.5 2xl:ml-0`}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
          >
            <div
              className="flex transition-transform duration-300 ease-in-out"
              style={{
                transform: `translateX(-${
                  logos.length > 0 ? currentSlide * (100 / Math.max(slidesPerView, logos.length)) : 0
                }%)`,
                width: `${Math.max(1, logos.length / slidesPerView) * 100}%`,
              }}
            >
              {logos.map((logo, index) => (
                <div
                  key={index}
                  className="pr-2 flex-shrink-0"
                  style={{ width: `${100 / Math.max(slidesPerView, logos.length)}%` }}
                >
                  <div
                    onClick={() => handleLogoSelect(logo)}
                    className={`relative h-12 w-full cursor-pointer rounded-lg border-2 border-white/10 bg-[#202020]/50 p-2.5 backdrop-blur-[80px] transition-all duration-200 ${
                      brand_logo === logo
                        ? 'border-2 border-white/40 shadow-blue-200'
                        : 'hover:border-2 hover:border-white/40 hover:shadow-md'
                    }`}
                    // title={logo.name}
                  >
                    <img
                      src={logo}
                      // alt={logo.name}
                      className="mx-auto h-full w-auto object-contain"
                      style={{ maxWidth: '100%' }}
                    />
                    {/* <button
                      className="absolute -top-2 -right-1.5 rounded-full border border-white/20 bg-[#0D0D0D]/50 p-0.5 text-[#AFAFAF] backdrop-blur-[60px] transition-colors hover:border-white/40 hover:text-white"
                      aria-label="Remove logo"
                      onClick={(e) => {
                        e.stopPropagation();
                        // Handle remove logic here
                      }}
                    >
                      <X size={12} />
                    </button> */}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Navigation Button - Absolute Positioned */}
        {showNext && (
          <button
            onClick={handleNext}
            className="absolute top-4 right-0 z-10 rounded-full border border-white/40 bg-[#0D0D0D]/50 p-1 text-[#AFAFAF] backdrop-blur-[70px] transition-colors hover:text-white"
            aria-label="Next logos"
          >
            <ChevronRight size={20} />
          </button>
        )}
      </div>
    </div>
  );
};

export default ShowBrandLogos;
