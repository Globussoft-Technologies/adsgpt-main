import { Separator } from '@/components/ui/separator';
import { TrendingUp } from 'lucide-react';
import React, { useState } from 'react';
import recreateAdsLogo from '@/assets/layouts/ad-insights/recreate-ads-yellow.svg';
import { ShadcnTooltip } from '@/components/layout/ShadcnTooltip';
import ImageAdCardCarousel from './ImageAdCardCarousel';
import { USER_AVTAR_INITIALS } from '@/components/Avatars';
import { Link } from 'react-router-dom';
import { addImage } from '@/store/reducers/adStudio/promptSlice';
import { nanoid } from 'nanoid';
import { useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import OpenAdDropdown from '../OpenAdDropdown';
import { setActiveAdStudioTab } from '@/store/reducers/adStudio/adStudioTabsSlice';
import { createNewSession } from '@/store/reducers/adStudio/adHistorySlice';
import { resetAdCreativeSlice } from '@/store/reducers/adStudio/adCreativeSlice';
import { startGlobalInteractionTracking } from '@/utils/userInteractionTracker';
const MEDIA_URL = import.meta.env.VITE_NAS_BASE_URL;

const ImageAdCard = ({
  key,
  image,
  description,
  popularity,
  network,
  postOwner,
  adTitle,
  adUrl,
  adType,
  othermedia,
  postImage,
  postOwnerImage,
  thumbnail_url,
  ad,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isTitleExpanded, setIsTitleExpanded] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [open, setOpen] = useState(false);
  const { userData } = useSelector((state) => state.socket);
  const { currentSessionId } = useSelector((state) => state.userInteractions);
  const navigate = useNavigate();
  const dispatch = useDispatch();
  // Description length threshold - adjust as needed
  const MAX_DESCRIPTION_LENGTH = 100;
  const MAX_TITLE_LENGTH = 50;

  const toggleDescription = () => {
    setIsExpanded(!isExpanded);
  };
  const toggleTitleReadMore = () => {
    setIsTitleExpanded(!isTitleExpanded);
  };
  const handleSimilarClick = () => {
    const url = othermedia?.[activeIndex];
    if (url || image) {
      const newImage = {
        id: nanoid(),
        url: url ? `${MEDIA_URL}/${url}` : image,
        type: 'ad',
        title: adTitle,
        description: description,
        ad: ad ? { ...ad, activeIndex } : {},
      };
      dispatch(setActiveAdStudioTab('adCreative'));
      dispatch(addImage(newImage));
      dispatch(createNewSession({ tab: 'adCreative' }));
      dispatch(resetAdCreativeSlice());
      // Navigate to home page
      navigate('/adstudio');
    }
  };

  const displayDescription = isExpanded
    ? description
    : description?.length > MAX_DESCRIPTION_LENGTH
      ? `${description?.substring(0, MAX_DESCRIPTION_LENGTH)}...`
      : description;

  const displayTitle = isTitleExpanded
    ? adType === 'IMAGE'
      ? adTitle
      : adTitle?.split('||,')?.map((item) => item?.trim())[activeIndex]
    : (adType === 'IMAGE'
          ? adTitle
          : adTitle?.split('||,')?.map((item) => item?.trim())[activeIndex]
        )?.length > MAX_TITLE_LENGTH
      ? `${(adType === 'IMAGE' ? adTitle : adTitle?.split('||,')?.map((item) => item?.trim())[activeIndex])?.substring(0, MAX_TITLE_LENGTH)}...`
      : adType === 'IMAGE'
        ? adTitle
        : adTitle?.split('||,')?.map((item) => item?.trim())[activeIndex];

  return (
    <div
      id="tour_image_adcard"
      className="rounded-10 group relative w-full overflow-hidden border border-white/10 bg-[#0D0D0D] text-white"
      onClick={(e) => startGlobalInteractionTracking(e, ad, 'adCard', userData, currentSessionId)}
      onCopy={(e) => {
        e.preventDefault();
        e.stopPropagation();
        startGlobalInteractionTracking(e, ad, 'adCard', userData, currentSessionId);
      }}
    >
      {/* top header */}

      <div
        className={`card_header absolute top-0 left-0 z-20 flex h-10 w-full items-center justify-between rounded-none bg-transparent px-2 transition-opacity duration-300 group-hover:opacity-100 2xl:h-12 2xl:px-3 ${open ? 'opacity-100' : 'lg:opacity-0'}`}
      >
        <div className="flex items-center gap-2 text-sm font-medium text-white">
          <img
            src={
              postOwnerImage?.includes('PowerAdspy/n2') && postOwnerImage !== '/DefaultImage.jpg'
                ? postOwnerImage
                : USER_AVTAR_INITIALS + postOwner?.split(' ')[0]
            }
            alt="avatar"
            onError={(e) => {
              e.target.src = USER_AVTAR_INITIALS + postOwner?.split(' ')[0];
            }}
            className="h-6 w-6 rounded-full 2xl:h-7 2xl:w-7"
            loading="lazy"
          />
          <span className="text-10 w-full max-w-[130px] truncate font-medium 2xl:max-w-[180px] 2xl:text-xs">
            {postOwner}
          </span>
        </div>
        <div className="right_header flex items-center gap-1 2xl:gap-2">
          <ShadcnTooltip label="Recreate successful ad">
            <button className="flex h-5 w-5 cursor-pointer items-center justify-center rounded-full border border-white/20 bg-[#0D0D0D]/50 p-[3px] backdrop-blur-[38px] transition-all duration-200 hover:scale-110 2xl:h-7 2xl:w-7">
              <img
                className="relative -top-[1px] w-[90%] 2xl:-top-[2px] 2xl:w-full"
                src={recreateAdsLogo}
                alt="recreate"
                onClick={handleSimilarClick}
              />
            </button>
          </ShadcnTooltip>
          {adUrl?.includes('https') && (
            <OpenAdDropdown open={open} setOpen={setOpen} adUrl={adUrl} />
          )}
        </div>
      </div>

      <div
        className={`overlay_top_header absolute top-0 right-0 left-0 z-10 h-20 bg-gradient-to-b from-[#0F0F0F]/80 to-[#0F0F0F]/0 group-hover:opacity-100 ${open ? 'opacity-100' : 'lg:opacity-0'}`}
      ></div>

      {/* Top Media */}
      <div className="w-full">
        {Array.isArray(othermedia) && othermedia?.length > 0 ? (
          <ImageAdCardCarousel
            images={othermedia}
            activeIndex={activeIndex}
            setActiveIndex={setActiveIndex}
          />
        ) : (
          <img src={image} alt="Ad" className="h-full w-full object-cover" />
        )}
      </div>

      {/* Content */}
      <div className="flex flex-col gap-3.5">
        <div className="p-3 pb-0 2xl:p-4 2xl:pb-0">
          <div className="description-container">
            <p className="text-xs text-[#AFAFAF] 2xl:text-sm">{displayTitle}</p>
            {(adType === 'IMAGE'
              ? adTitle
              : adTitle?.split('||,')?.map((item) => item?.trim())[activeIndex]
            )?.length > MAX_TITLE_LENGTH && (
              <button
                onClick={toggleTitleReadMore}
                className="mt-1 text-xs font-medium text-blue-400 transition-colors duration-200 hover:text-blue-300"
              >
                {isTitleExpanded ? 'Read Less' : 'Read More'}
              </button>
            )}
          </div>
          {displayDescription !== '' && (
            <div className="description-container">
              <p className="text-xs text-[#AFAFAF] 2xl:text-sm">{displayDescription}</p>
              {description?.length > MAX_DESCRIPTION_LENGTH && (
                <button
                  onClick={toggleDescription}
                  className="mt-1 text-xs font-medium text-blue-400 transition-colors duration-200 hover:text-blue-300"
                >
                  {isExpanded ? 'Read Less' : 'Read More'}
                </button>
              )}
            </div>
          )}
        </div>

        <div className="px-4">
          <Separator />
        </div>

        <div className="button_ flex flex-col flex-wrap items-center justify-center gap-x-4 gap-y-3 2xl:justify-between">
          <button
            id="tour_show_analytics_button"
            className="prompt_selection_button text-10 relative z-10 w-fit rounded-full bg-[#1E1E1E] px-4 py-1.5 text-center !text-[#AFAFAF] hover:bg-[#2A2A2A] hover:!text-white 2xl:py-2 2xl:text-xs"
          >
            Show Analytics
          </button>
          <div
            id="tour_adpopularity"
            className="backdrop-blur-100 flex w-full items-center justify-center bg-[#333333]/50 p-1.5 2xl:p-2.5"
          >
            <div className="text-10 flex items-center justify-center gap-1 text-[#AFAFAF] 2xl:text-xs">
              <TrendingUp className="h-4 w-4" />
              <span>Popularity: {popularity}%</span>
            </div>
          </div>
        </div>
      </div>

      {/* Popularity */}
    </div>
  );
};

export default ImageAdCard;
