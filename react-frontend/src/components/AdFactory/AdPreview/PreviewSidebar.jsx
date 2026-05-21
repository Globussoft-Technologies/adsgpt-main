import { ChevronDown, ChevronUp, Image, Plus, Save, X } from 'lucide-react'; // Added X icon
import { Swiper, SwiperSlide } from 'swiper/react';
import 'swiper/css';
import 'swiper/css/navigation';
import React, { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  deleteAdFactoryAdcreative,
  fetchCampaignById,
} from '@/store/actions/adFactoryNew/adFactoryActions';
import { useSearchParams } from 'react-router-dom';
import { setEnableId } from '@/store/reducers/adFactoryNew/adFactoryNewSlice';

const PreviewSidebar = ({
  creatives,
  activeCreativeId,
  onAddCreative,
  onOpenSaved,
  onOpenCreative,
  activeView,
  adCreatives,
  onDeleteCreative, // Add this prop
}) => {
  const activeIndex = creatives.findIndex((c) => c.id === activeCreativeId);
  const swiperRef = useRef(null);
  const [isBeginning, setIsBeginning] = useState(true);
  const { enableId, postnodecreatives } = useSelector((state) => state?.adFactoryNew);
  const [isEnd, setIsEnd] = useState(false);
  const { userData } = useSelector((state) => state?.socket) || {};
  const [searchParams] = useSearchParams();
  const campaignId = searchParams.get('campaignId');
  const savedCount = postnodecreatives?.length || 0;
  const dispatch = useDispatch();
  useEffect(() => {
    if (!swiperRef.current || activeIndex < 0) return;

    const swiper = swiperRef.current;
    const { activeIndex: current, slidesPerView } = swiper;
    const slides = Number(slidesPerView) || 2;
    const maxVisibleIndex = current + slides - 1;

    if (activeIndex < current || activeIndex > maxVisibleIndex) {
      swiper.slideTo(activeIndex, 550);
    }
  }, [activeIndex]);

  const handleDelete = async (e, creativeId) => {
    e.stopPropagation(); // Important: prevent opening the creative

    // Call parent's delete handler first to update local state
    if (onDeleteCreative) {
      onDeleteCreative(creativeId);
    }

    // Then call Redux action
    const result = await dispatch(
      deleteAdFactoryAdcreative({
        campaignId,
        creativeId,
      })
    );
    if (deleteAdFactoryAdcreative.fulfilled.match(result)) {
      const campaignPayload = {
        campaignId,
        userId: userData?.user_id,
      };
      dispatch(fetchCampaignById(campaignPayload));
    }
  };
  return (
    <>
      <aside className="flex h-full w-22 flex-col border-r border-white/10 bg-[#0f0f0f] py-4 sm:w-[102px]">
        <div className="flex flex-1 flex-col items-center justify-center">
          <button
            onClick={() => swiperRef.current?.slidePrev()}
            disabled={isBeginning}
            className={`mb-2.5 rounded-md transition ${
              isBeginning ? 'hidden' : 'block hover:bg-white/10'
            }`}
          >
            <ChevronUp className="h-7 w-7 text-white 2xl:h-8 2xl:w-8" />
          </button>

          <div className="h-fit max-h-35 min-h-17 2xl:max-h-40 2xl:min-h-20">
            <Swiper
              direction="vertical"
              slidesPerView={2}
              spaceBetween={4}
              speed={550}
              resistanceRatio={0.85}
              onSwiper={(swiper) => {
                swiperRef.current = swiper;
                setIsBeginning(swiper.isBeginning);
                setIsEnd(swiper.isEnd);
              }}
              onSlideChange={(swiper) => {
                setIsBeginning(swiper.isBeginning);
                setIsEnd(swiper.isEnd);
              }}
              className="h-full"
            >
              {creatives.map((c) => {
                const isActive = activeCreativeId === c.id && activeView === 'preview';

                return (
                  <SwiperSlide key={c.id} className="flex justify-center p-1">
                    <button
                      onClick={() => onOpenCreative(c.id)}
                      className="group relative flex w-full flex-col items-center gap-2"
                    >
                      {/* Delete Button */}
                      <button
                        onClick={(e) => handleDelete(e, c.id)}
                        className="absolute -top-1 right-0 z-10 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 opacity-0 transition-opacity duration-200 group-hover:opacity-100 hover:bg-red-600"
                        title="Delete creative"
                      >
                        <X className="h-3 w-3 text-white" />
                      </button>

                      <div
                        className={`flex h-8 w-8 items-center justify-center rounded-sm bg-[#2a2a2a] group-hover:bg-white/20 ${isActive ? 'border border-white/60 text-white' : 'text-white/70'} 2xl:h-10.5 2xl:w-10.5`}
                      >
                        <Image className="h-5 w-5 group-hover:text-white 2xl:h-6 2xl:w-6" />
                      </div>

                      <span
                        className={`line-clamp-1 text-[10px] ${
                          isActive ? 'text-white' : 'text-white/70'
                        } group-hover:text-white`}
                      >
                        {c.name}
                      </span>
                    </button>
                  </SwiperSlide>
                );
              })}
            </Swiper>
          </div>

          <button
            onClick={() => swiperRef.current?.slideNext()}
            disabled={isEnd}
            className={`-mt-1 mb-1 rounded-md transition ${isEnd ? 'hidden' : 'block hover:bg-white/10'}`}
          >
            <ChevronDown className="h-7 w-7 text-white 2xl:h-8 2xl:w-8" />
          </button>

          {/* Add More */}
          <button
            className={`group mt-2 flex flex-col items-center gap-2 ${enableId ? '' : 'cursor-not-allowed opacity-50'}`}
            onClick={enableId ? onAddCreative : undefined}
            disabled={!enableId}
          >
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-full bg-[#2a2a2a] 2xl:h-10 2xl:w-10 ${enableId ? 'group-hover:bg-white/20' : ''}`}
            >
              <Plus className="h-5 w-5 2xl:h-6 2xl:w-6" />
            </div>
            <span className="text-[10px] text-white/80">Add More</span>
          </button>
        </div>

        {/* Bottom section */}
        <button className="group flex flex-col items-center gap-2" onClick={onOpenSaved}>
          <div
            className={`relative flex h-8 w-8 items-center justify-center rounded-sm bg-[#2a2a2a] group-hover:bg-white/20 2xl:h-10 2xl:w-10 ${activeView === 'saved' ? 'border border-white/60 text-white' : 'text-white/70'}`}
          >
            <Save className="h-5 w-5 2xl:h-6 2xl:w-6" />
            {savedCount > 0 && (
              <span className="absolute -top-2.5 -right-2.5 flex h-5 w-5 items-center justify-center rounded-full bg-white text-xs font-bold text-black">
                {savedCount}
              </span>
            )}
          </div>
          <span
            className={`text-[10px] group-hover:text-white ${activeView === 'saved' ? 'text-white' : 'text-white/70'}`}
          >
            Saved Folder
          </span>
        </button>
      </aside>
    </>
  );
};

export default PreviewSidebar;
