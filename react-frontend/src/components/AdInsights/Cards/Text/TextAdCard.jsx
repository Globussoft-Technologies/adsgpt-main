import { Separator } from '@/components/ui/separator';
import { EllipsisVertical, TrendingUp } from 'lucide-react';
import React, { useState } from 'react';
import recreateAdsLogo from '@/assets/layouts/ad-insights/recreate-ads-yellow.svg';
import { ShadcnTooltip } from '@/components/layout/ShadcnTooltip';
import { USER_AVTAR_INITIALS } from '@/components/Avatars';
import OpenAdDropdown from '../OpenAdDropdown';
import { startGlobalInteractionTracking } from '@/utils/userInteractionTracker';
import { useSelector } from 'react-redux';

const TextAdCard = ({
  id,
  image,
  description,
  popularity,
  network,
  postOwner,
  adTitle,
  postImage,
  adUrl,
  open_in_pas,
  newsfeedDescription,
  adType,
  othermedia,
  postOwnerImage,
  thumbnail_url,
  ad,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isTitleExpanded, setIsTitleExpanded] = useState(false);
  const [open, setOpen] = useState(false);
  const { userData } = useSelector((state) => state.socket);
  const { currentSessionId } = useSelector((state) => state.userInteractions);
  // Description length threshold - adjust as needed
  const MAX_DESCRIPTION_LENGTH = 100;
  const MAX_TITLE_LENGTH = 50;

  const toggleDescription = () => {
    setIsExpanded(!isExpanded);
  };
  const toggleTitleReadMore = () => {
    setIsTitleExpanded(!isTitleExpanded);
  };

  const displayDescription = isExpanded
    ? description
    : description?.length > MAX_DESCRIPTION_LENGTH
      ? `${description?.substring(0, MAX_DESCRIPTION_LENGTH)}...`
      : description;

  const displayTitle = isTitleExpanded
    ? adTitle
    : adTitle?.length > MAX_TITLE_LENGTH
      ? `${adTitle?.substring(0, MAX_TITLE_LENGTH)}...`
      : adTitle;

  return (
    <div
      className="rounded-10 relative w-full overflow-hidden border border-white/10 bg-[#0D0D0D] text-white"
      onClick={(e) => startGlobalInteractionTracking(e, ad, 'adCard', userData, currentSessionId)}
      onCopy={(e) => {
        e.preventDefault();
        e.stopPropagation();
        startGlobalInteractionTracking(e, ad, 'adCard', userData, currentSessionId);
      }}
    >
      {/* top header */}
      <div className="card_header z-20 mb-1 flex h-10 w-full items-center justify-between rounded-none bg-transparent px-2 opacity-100 transition-opacity duration-300 group-hover:opacity-100 lg:opacity-100 2xl:h-12 2xl:px-3">
        <div className="flex items-center gap-2 text-sm font-medium text-white">
          <img
            src={
              postOwnerImage?.includes?.('PowerAdspy/n2') && postOwnerImage !== '/DefaultImage.jpg'
                ? postOwnerImage
                : USER_AVTAR_INITIALS + postOwner?.split?.(' ')?.[0]
            }
            alt="avatar"
            onError={(e) => {
              e.target.src = USER_AVTAR_INITIALS + postOwner?.split?.(' ')?.[0];
            }}
            className="h-6 w-6 rounded-full 2xl:h-7 2xl:w-7"
            loading="lazy"
          />
          <span className="text-10 w-full max-w-[130px] truncate font-medium 2xl:max-w-[180px] 2xl:text-xs">
            {postOwner}
          </span>
        </div>
        <div className="right_header flex items-center gap-1 2xl:gap-2">
          {/* <ShadcnTooltip label="Recreate successful ad">
            <button className="flex h-5 w-5 cursor-pointer items-center justify-center rounded-full border border-white/20 bg-[#0D0D0D]/50 p-[3px] backdrop-blur-[38px] transition-all duration-200 hover:scale-110 2xl:h-7 2xl:w-7">
              <img
                className="relative -top-[1px] w-[90%] 2xl:-top-[1px] 2xl:w-full"
                src={recreateAdsLogo}
                alt="recreate"
              />
            </button>
          <ShadcnTooltip label="More Options">
            <button>
              <EllipsisVertical className="h-3 w-3 2xl:h-4 2xl:w-4" />
            </button>
          </ShadcnTooltip>
          </ShadcnTooltip> */}
          {adUrl?.includes('https') && (
            <OpenAdDropdown open={open} setOpen={setOpen} adUrl={adUrl} />
          )}
        </div>
      </div>
      {/* <div className="overlay_top_header absolute top-0 right-0 left-0 h-20 bg-gradient-to-b from-[#0F0F0F]/80 to-[#0F0F0F]/0"></div> */}

      {/* Top Media */}

      {/* Content */}
      <div className="flex flex-col gap-3.5 p-3 pt-0 2xl:p-3 2xl:pt-0">
        <div className="flex flex-col gap-2">
          {/* Heading */}
          <h2 className="text-[14px] font-normal text-white">{adTitle}</h2>
          {/* URL */}
          <a href={open_in_pas} className="text-[12px] font-normal text-white underline">
            {open_in_pas}
          </a>
          <div className="p-3 pb-0 2xl:p-4 2xl:pb-0">
            {/* Description with Read More/Less */}
            <div className="description-container">
              <p className="text-[14px] font-normal text-[#AFAFAF]">{displayTitle}</p>
              {adTitle?.length > MAX_TITLE_LENGTH && (
                <button
                  onClick={toggleTitleReadMore}
                  className="mt-1 text-xs font-medium text-blue-400 transition-colors duration-200 hover:text-blue-300"
                >
                  {isTitleExpanded ? 'Read Less' : 'Read More'}
                </button>
              )}
            </div>
            <div className="description-container">
              <p className="text-[14px] font-normal text-[#AFAFAF]">{displayDescription}</p>
              {description?.length > MAX_DESCRIPTION_LENGTH && (
                <button
                  onClick={toggleDescription}
                  className="mt-1 text-xs font-medium text-blue-400 transition-colors duration-200 hover:text-blue-300"
                >
                  {isExpanded ? 'Read Less' : 'Read More'}
                </button>
              )}
            </div>
          </div>

          {/* Hashtag */}
          {/* <span className="text-[12px] font-normal text-[#A2E3FF]">{hashtag}</span> */}
        </div>
        <div className="px-4">
          <Separator />
        </div>
        <div className="button_ flex flex-col flex-wrap items-center justify-center gap-x-4 gap-y-3 2xl:justify-between">
          <button className="prompt_selection_button text-10 relative z-10 w-fit rounded-full bg-[#1E1E1E] px-4 py-1.5 text-center !text-[#AFAFAF] hover:bg-[#2A2A2A] hover:!text-white 2xl:py-2 2xl:text-xs">
            Show Analytics
          </button>
          <div className="backdrop-blur-100 flex w-full items-center justify-center bg-[#333333]/50 p-1.5 2xl:p-2.5">
            <div className="text-10 flex items-center justify-center gap-1 text-[#AFAFAF] 2xl:text-xs">
              <TrendingUp className="h-4 w-4" />
              <span>Popularity: {popularity}%</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TextAdCard;
