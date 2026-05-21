import React, { useState } from 'react';
import { Swiper, SwiperSlide } from 'swiper/react';
import { Navigation } from 'swiper/modules';
import { MoreHorizontal, X } from 'lucide-react';

import 'swiper/css';
import 'swiper/css/navigation';
import { useDispatch, useSelector } from 'react-redux';
import { removePostNodeCreative } from '@/store/reducers/adFactoryNew/adFactoryNewSlice';

const GoogleAdCard = ({ creative }) => {
  const { brandInfo } = useSelector((state) => state.adFactoryNew);
  const dispatch = useDispatch();

  return (
    <div className="mx-auto w-full max-w-[400px] overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-md">
      {/* Google Search Ad style */}
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-white text-xs">
            <img
              src={brandInfo?.brandLogo?.[0]}
              alt="brand"
              className="h-full w-full rounded-full object-cover"
              onError={(e) => { e.target.style.display = 'none'; }}
            />
          </div>
          <div className="flex flex-col">
            <span className="text-xs font-medium text-gray-900">{brandInfo?.brandName}</span>
            <span className="text-[10px] text-green-600">{creative.linkUrl || 'adsgpt.io'}</span>
          </div>
        </div>
        <div className="flex items-center gap-1 text-gray-400">
          <span className="rounded border border-gray-300 px-1 py-0.5 text-[9px]">Ad</span>
          <X
            className="h-4 w-4 cursor-pointer rounded-full hover:text-gray-700"
            onClick={() => dispatch(removePostNodeCreative(creative.creativeId))}
          />
        </div>
      </div>

      {/* Headline */}
      <div className="px-4 pb-2">
        <p className="text-base font-semibold leading-snug text-[#1a0dab] hover:underline cursor-pointer">
          {creative.headline}
        </p>
      </div>

      {/* Image */}
      {creative.imageUrl && (
        <div className="mx-4 mb-3 overflow-hidden rounded-xl">
          <img
            src={creative.imageUrl}
            alt="Ad Visual"
            className="h-70 w-full object-cover"
          />
        </div>
      )}

      {/* Description */}
      <div className="px-4 pb-4">
        <p className="text-xs leading-relaxed text-gray-600">
          {creative.description || creative.message}
        </p>
      </div>

      {/* CTA */}
      <div className="flex items-center justify-between border-t border-gray-100 px-4 py-3">
        <span className="text-xs text-gray-400">Sponsored</span>
        <button className="rounded-full bg-[#1a73e8] px-4 py-1.5 text-xs font-semibold text-white hover:opacity-90">
          {creative.callToAction?.replace(/_/g, ' ')}
        </button>
      </div>
    </div>
  );
};

const GoogleAdCarousel = () => {
  const { postnodecreatives: allCreatives } = useSelector((state) => state.adFactoryNew);
  const postnodecreatives = allCreatives.filter((c) => c.platform === 'google');

  return (
    <div className="relative w-full overflow-hidden py-6">
      <Swiper
        modules={[Navigation]}
        spaceBetween={24}
        slidesPerView={1}
        navigation={{
          nextEl: '.google-swiper-btn-next',
          prevEl: '.google-swiper-btn-prev',
        }}
        breakpoints={{
          640: { slidesPerView: 1.5 },
          768: { slidesPerView: 2.2 },
          1024: { slidesPerView: 3 },
        }}
        className="google-ad-swiper pb-4!"
      >
        {postnodecreatives.map((creative) => (
          <SwiperSlide key={creative.creativeId}>
            <GoogleAdCard creative={creative} />
          </SwiperSlide>
        ))}
      </Swiper>

      <button className="google-swiper-btn-prev absolute top-1/2 left-0 z-10 -translate-y-12 rounded-full border border-gray-200 bg-white p-3 text-gray-700 shadow transition hover:bg-gray-100 active:scale-95 disabled:hidden">
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M15 19l-7-7 7-7" />
        </svg>
      </button>
      <button className="google-swiper-btn-next absolute top-1/2 right-0 z-10 -translate-y-12 rounded-full border border-gray-200 bg-white p-3 text-gray-700 shadow transition hover:bg-gray-100 active:scale-95 disabled:hidden">
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M9 5l7 7-7 7" />
        </svg>
      </button>
    </div>
  );
};

export default GoogleAdCarousel;
