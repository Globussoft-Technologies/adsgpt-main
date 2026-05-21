import React, { useEffect } from 'react';
import { Swiper, SwiperSlide } from 'swiper/react';
import { Navigation, Pagination } from 'swiper/modules';
import { MoreHorizontal, X, MessageSquare, Share2, ThumbsUp } from 'lucide-react';

import 'swiper/css';
import 'swiper/css/navigation';
import 'swiper/css/pagination';
import { useDispatch, useSelector } from 'react-redux';
import { useState } from 'react';
import { removePostNodeCreative } from '@/store/reducers/adFactoryNew/adFactoryNewSlice';

const FbAdCard = ({ creative }) => {
  const [showMore, setShowMore] = useState(false);
  const { brandInfo } = useSelector((state) => state.adFactoryNew);
  const dispatch = useDispatch();
  // console.log("postad",postnodecreatives)
  // console.log("brandInfo",brandInfo)
  return (
    <div className="mx-auto w-full max-w-[400px] overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm transition-shadow hover:shadow-md">
      {/* Header */}
      <div className="flex items-center justify-between p-3">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#f3a36d] text-lg font-bold text-white shadow-inner">
            <img src={brandInfo.brandLogo[0]} alt="brand-logo" />
          </div>
          <div className="flex flex-col">
            <span className="cursor-pointer text-[14px] leading-tight font-bold text-[#1c1e21] hover:underline">
              {brandInfo.brandName}
            </span>
            <div className="flex items-center gap-0.75 text-xs text-[#65676b] 2xl:gap-1">
              <span className="text-[10px] 2xl:text-xs">Sponsored</span>
              <span className="text-10">•</span>
              <svg className="h-2 w-2 fill-current 2xl:h-3 2xl:w-3" viewBox="0 0 16 16">
                <path d="M8 0a8 8 0 100 16A8 8 0 008 0zM2.04 8a5.94 5.94 0 015.65-5.94v11.88A5.94 5.94 0 012.04 8zm11.92 0a5.94 5.94 0 01-5.65 5.94V2.06A5.94 5.94 0 0113.96 8z" />
              </svg>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 text-[#65676b]">
          <MoreHorizontal className="h-5 w-5 cursor-pointer rounded-full p-0.5 hover:bg-gray-100" />
          <X
            className="h-5 w-5 cursor-pointer rounded-full p-0.5 hover:bg-gray-100"
            onClick={() => dispatch(removePostNodeCreative(creative.creativeId))}
          />
        </div>
      </div>

      <div className="px-3 pb-3 text-xs text-[#1c1e21] 2xl:text-sm">
        {/* Small businesses: Achieve instant marketing results. Adsgpt uses powerful AI to generate
        high-converting ads that{' '}
        <span className="cursor-pointer font-medium text-[#65676b] hover:underline">
          ...see more
        </span> */}
        {creative.description}
        {creative.message && (
          <>
            <span
              onClick={() => setShowMore(!showMore)}
              className="cursor-pointer font-medium text-[#65676b] hover:underline"
            >
              {showMore ? ' Read less' : ' Read more'}
            </span>
          </>
        )}
      </div>

      <div className="relative aspect-square w-full overflow-hidden border-y border-gray-100 bg-[#f0f2f5]">
        <img
          src={creative.imageUrl}
          alt="Ad Visual"
          className="h-full w-full object-contain transition-transform duration-700 hover:scale-105"
        />
      </div>

      <div className="flex items-center justify-between gap-1 bg-[#f0f2f5] px-3 py-3 md:px-2 2xl:p-3">
        <div className="flex max-w-[55%] flex-col gap-0.5">
          <span className="line-clamp-2 text-[10px] font-medium tracking-tight break-all text-[#65676b] 2xl:text-[11px]">
            {creative.linkUrl}
          </span>
          <span className="line-clamp-2 text-xs leading-snug font-bold text-[#1c1e21] 2xl:text-[14px]">
            {creative.headline}
          </span>
        </div>
        <button className="rounded-[6px] bg-[#e4e6eb] px-2 py-1.5 text-[10px] font-semibold whitespace-nowrap text-[#1c1e21] shadow-sm transition hover:bg-[#d8dadf] active:scale-95 2xl:px-4 2xl:text-[12px]">
          {creative.callToAction.replace(/_/g, ' ')}
        </button>
      </div>

      <div className="text-13 flex items-center justify-between border-b border-gray-100 px-3 py-2 text-[#65676b]">
        <div className="flex cursor-pointer items-center gap-1.5 hover:underline">
          <div className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-[#1877f2] shadow-sm">
            <ThumbsUp className="h-2.5 w-2.5 fill-current text-white" />
          </div>
          <span className="font-medium">4</span>
        </div>
      </div>

      <div className="flex items-center justify-around px-1 py-1">
        <button className="flex items-center justify-center gap-1.5 rounded-[6px] py-1.5 text-xs font-semibold text-[#65676b] transition hover:bg-gray-100 active:bg-gray-200 2xl:gap-2">
          <ThumbsUp className="h-3 w-3 2xl:h-3.5 2xl:w-3.5" />
          <span>Like</span>
        </button>
        <button className="flex items-center justify-center gap-1.5 rounded-[6px] py-1.5 text-xs font-semibold text-[#65676b] transition hover:bg-gray-100 active:bg-gray-200 2xl:gap-2">
          <MessageSquare className="h-3 w-3 2xl:h-3.5 2xl:w-3.5" />
          <span>Comment</span>
        </button>
        <button className="flex items-center justify-center gap-1.5 rounded-[6px] py-1.5 text-xs font-semibold text-[#65676b] transition hover:bg-gray-100 active:bg-gray-200 2xl:gap-2">
          <Share2 className="h-3 w-3 2xl:h-3.5 2xl:w-3.5" />
          <span>Share</span>
        </button>
      </div>
    </div>
  );
};

const FbAdCarousel = () => {
  const { postnodecreatives: allCreatives } = useSelector(
    (state) => state.adFactoryNew,
  );
  // Meta-only — match FbAccountReady's launch filter so the carousel
  // can't show creatives the user isn't actually able to post here. A
  // creative with no platform tag is treated as Meta (legacy default).
  const postnodecreatives = (allCreatives || []).filter(
    (c) => !c.platform || c.platform === 'meta',
  );

  if (postnodecreatives.length === 0) {
    return (
      <div className="flex w-full items-center justify-center rounded-xl border border-white/10 bg-white/2 px-4 py-10 text-center">
        <div className="max-w-md">
          <p className="text-sm font-semibold text-white">
            No Meta creatives ready to post
          </p>
          <p className="mt-1.5 text-xs text-gray-400">
            Go back to the Ad Studio and generate creatives on the{' '}
            <span className="font-medium text-gray-200">Meta</span> platform
            tab. Google-tagged creatives only appear on the Google posting
            screen.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full overflow-hidden py-6">
      <Swiper
        modules={[Navigation]}
        spaceBetween={24}
        slidesPerView={1}
        navigation={{
          nextEl: '.swiper-btn-next',
          prevEl: '.swiper-btn-prev',
        }}
        pagination={{
          clickable: true,
          dynamicBullets: true,
          el: '.custom-pagination',
        }}
        breakpoints={{
          640: { slidesPerView: 1.5 },
          768: { slidesPerView: 2.2 },
          1024: { slidesPerView: 3 },
          1440: { slidesPerView: 3 },
        }}
        className="fb-ad-swiper pb-12!"
      >
        {postnodecreatives.map((creative) => (
          <SwiperSlide key={creative.creativeId}>
            <FbAdCard creative={creative} />
          </SwiperSlide>
        ))}
      </Swiper>

      <button className="swiper-btn-prev absolute top-1/2 left-0 z-10 -translate-y-12 rounded-full border border-white/20 bg-black/40 p-3 text-white backdrop-blur-md transition hover:bg-black/60 active:scale-95 disabled:hidden">
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M15 19l-7-7 7-7" />
        </svg>
      </button>
      <button className="swiper-btn-next absolute top-1/2 right-0 z-10 -translate-y-12 rounded-full border border-white/20 bg-black/40 p-3 text-white backdrop-blur-md transition hover:bg-black/60 active:scale-95 disabled:hidden">
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M9 5l7 7-7 7" />
        </svg>
      </button>

      <div className="custom-pagination absolute bottom-0 left-1/2 flex -translate-x-1/2 items-center gap-1.5" />

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .fb-ad-swiper .swiper-pagination-bullet {
          background: #555555 !important;
          width: 8px;
          height: 8px;
          opacity: 0.5;
          transition: all 0.3s ease;
        }
        .fb-ad-swiper .swiper-pagination-bullet-active {
          background: #6366f1 !important;
          width: 24px !important;
          border-radius: 4px;
          opacity: 1;
        }
      `,
        }}
      />
    </div>
  );
};

export default FbAdCarousel;
