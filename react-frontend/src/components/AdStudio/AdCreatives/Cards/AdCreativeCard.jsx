import React, { useState, memo, useEffect } from 'react';
import { Swiper, SwiperSlide } from 'swiper/react';
import { Navigation, Autoplay, Mousewheel, Pagination, Scrollbar } from 'swiper/modules';
import { IoIosArrowBack, IoIosArrowForward } from 'react-icons/io';
import { FaPlay } from 'react-icons/fa';
import { Instagram, TrendingUp } from 'lucide-react';
import recreateAdsLogo from '@/assets/layouts/adstudio/recreate-ads.svg';
import AdPreviewDialogMain from '../AdPreview/layout/AdPreviewDialogMain';
import { nanoid } from 'nanoid';
import { useDispatch, useSelector } from 'react-redux';
import { addImage } from '@/store/reducers/adStudio/promptSlice';
import { formatUrl } from '@/utils/formatUrl';
import { FaFacebookF, FaPinterest, FaYoutube, FaLinkedin, FaReddit } from 'react-icons/fa';
import { SiGoogleads } from 'react-icons/si';
import { ShadcnTooltip } from '@/components/layout/ShadcnTooltip';
import { motion } from 'framer-motion';
import { FADE_UP_ANIMATION_VARIANT } from '@/utils/ui/framerMotionVariants';
import AdPreviewInstaMain from '../AdPreview/layout/AdPreviewInstaMain';
import AdPreviewPintMain from '../AdPreview/layout/AdPreviewPintMain';
import { BarChart2, MoreHorizontal } from 'lucide-react';
import FlameIcon from '@/assets/layouts/adstudio/adcard/flame.svg';
import MoreOptionsIcon from '@/assets/layouts/adstudio/adcard/more-options.svg';
import { startGlobalInteractionTracking } from '@/utils/userInteractionTracker';
import { ClippingGroup } from 'three/src/objects/ClippingGroup';
import { useLocation } from 'react-router-dom';
import RecreateAdModal from '@/components/AdLibrary/RecreateAdModal';

const networks = {
  instagram: <Instagram className="h-4 w-4" />,
  facebook: <FaFacebookF className="h-4 w-4" />,
  gdn: <SiGoogleads className="h-4 w-4" />,
  pinterest: <FaPinterest className="h-4 w-4" />,
  youtube: <FaYoutube className="h-4 w-4" />,
  linkedin: <FaLinkedin className="h-4 w-4" />,
  reddit: <FaReddit className="h-4 w-4" />,
};

const networkLabels = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  gdn: 'Google Display Network',
  pinterest: 'Pinterest',
  youtube: 'YouTube',
  linkedin: 'LinkedIn',
  reddit: 'Reddit',
};

const AdCreativesCard = ({
  userName,
  userAvatar,
  image,
  title,
  description,
  otherMedia,
  ad,
  setLightboxOpen,
}) => {
  const [isTitleExpanded, setIsTitleExpanded] = useState(false);
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);
  const [swiperInstance, setSwiperInstance] = useState(null);
  const [isBeginning, setIsBeginning] = useState(true);
  const [isEnd, setIsEnd] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [images, setImages] = useState([]);
  const [titles, setTitles] = useState([]);
  const [isAvatarError, setIsAvatarError] = useState(false);
  const dispatch = useDispatch();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedNetwork, setSelectedNetwork] = useState(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [isRecreateModalOpen, setIsRecreateModalOpen] = useState(false);
  const { userData } = useSelector((state) => state.socket);
  const { currentSessionId } = useSelector((state) => state.userInteractions);
  const location = useLocation();
  const isAdLibraryRoute = location.pathname === '/ad-library';

  const gotoNextSlide = () => {
    if (swiperInstance) swiperInstance.slideNext();
  };

  const gotoPrevSlide = () => {
    if (swiperInstance) swiperInstance.slidePrev();
  };

  const handleSlideChange = (swiper) => {
    setIsBeginning(swiper.isBeginning);
    setIsEnd(swiper.isEnd);
    setActiveIndex(swiper.activeIndex);
  };

  const truncateText = (text, limit) =>
    text?.length > limit ? `${text.slice(0, limit)}...` : text;

  useEffect(() => {
    let imgs = [];

    if (Array.isArray(image)) {
      imgs = [...image]; // already array
    } else if (image) {
      imgs = [image]; // wrap single string in array
    }

    const other = Array.isArray(otherMedia) ? otherMedia : [];
    other.forEach((o) => {
      imgs.push(formatUrl(o));
    });

    setImages(imgs);
  }, [image, otherMedia]);

  useEffect(() => {
    if (typeof title === 'string' && title.includes('||,')) {
      setTitles(title.split('||,').map((t) => t.trim()));
    } else if (typeof title === 'string') {
      setTitles([title]);
    } else {
      setTitles([]);
    }
  }, [title]);

  const handleSimilarClick = () => {
    const url = images[activeIndex];
    if (url) {
      const newImage = {
        id: nanoid(),
        url,
        type: 'ad',
        title,
        description,
        ad: ad ? { ...ad, activeIndex } : {},
      };
      dispatch(addImage(newImage));
    }
  };

  const handleButtonClick = (network) => {
    setIsDialogOpen(true);
    setSelectedNetwork(network);
  };

  const getTitleForActiveIndex = () => {
    if (titles.length === 0) return '';
    if (titles.length === 1) return titles[0];
    return titles[activeIndex] || titles[0];
  };
  return (
    <motion.div
      variants={FADE_UP_ANIMATION_VARIANT}
      initial="initial"
      whileInView="whileInView"
      viewport={{ once: true }}
      onClick={(e) =>
        startGlobalInteractionTracking(e, ad, 'adCopyCard', userData, currentSessionId)
      }
      onCopy={(e) => {
        e.preventDefault();
        e.stopPropagation();
        startGlobalInteractionTracking(e, ad, 'adCopyCard', userData, currentSessionId);
      }}
      className="group relative box-border w-full overflow-hidden rounded-xl border-none shadow-lg transition-all duration-300 ease-out hover:scale-[1.015]"
    >
      {/* Header */}
      <div className="card_header backdrop-blur-xs dark:backdrop-blur-none absolute top-0 left-0 z-20 flex h-10 w-full items-center justify-between rounded-none bg-white/80 px-3 opacity-100 transition-opacity duration-300 group-hover:opacity-100 lg:opacity-0 2xl:h-12 dark:bg-[#0F0F0F]/80">
        <div className="flex items-center gap-2 text-sm font-medium text-zinc-900 dark:text-white">
          {isAvatarError || !userAvatar ? (
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-400 text-xs leading-none font-bold text-white uppercase dark:bg-gray-600">
              {userName?.slice(0, 2)}
            </div>
          ) : (
            <img
              src={userAvatar}
              alt="avatar"
              className="h-7 w-7 rounded-full"
              loading="lazy"
              onError={() => setIsAvatarError(true)}
            />
          )}
          <span className="w-full max-w-[92px] truncate text-xs 2xl:max-w-[150px] 2xl:text-sm">
            {userName}
          </span>
        </div>
        <div className="right_header flex items-center gap-2 2xl:gap-2.5">
          {/* <button className="flex h-5 w-5 cursor-pointer items-center justify-center rounded-full bg-black/10 text-gray-700 transition-all duration-200 hover:scale-110 2xl:h-6 2xl:w-6 dark:bg-[#3B3B3B] dark:text-white dark:hover:opacity-80">
            <FaPlay className="relative h-2 w-2 2xl:left-[1px] 2xl:h-2.5 2xl:w-2.5" />
          </button> */}

          {/* more options on hover */}
          {(() => {
            try {
              const popularity = JSON.parse(ad?.popularity || '{}');
              return popularity.max > 0 || ad?.impression > 0 ? (
                <div className="relative inline-flex">
                  <div className="relative inline-flex">
                    <button className="peer flex h-[22px] w-[22px] cursor-pointer items-center justify-center rounded-full bg-black/10 text-gray-700 transition-all duration-200 hover:scale-110 2xl:h-6 2xl:w-6 dark:bg-[#3B3B3B] dark:text-white dark:hover:opacity-80">
                      <img
                        src={MoreOptionsIcon}
                        className="relative top-[0.5px] invert dark:invert-0"
                        alt="More Options"
                      />
                    </button>

                    <div className="absolute top-[100%] left-1/2 z-50 hidden -translate-x-1/2 opacity-0 peer-hover:flex peer-hover:opacity-100 hover:flex hover:opacity-100">
                      <div className="mt-1.5 flex flex-col overflow-hidden rounded-lg border border-black/10 bg-white p-0 shadow-lg backdrop-blur-[50px] transition-all duration-150 dark:border-white/10 dark:bg-[#0D0D0D]/50">
                        {/* Trends */}
                        <button className="backdrop-blur-80 text-10 flex items-center justify-start gap-1.5 p-1.5 px-3 whitespace-nowrap text-gray-600 hover:bg-black/5 hover:text-black dark:text-[#C2C0C0] dark:hover:bg-[#0D0D0D]/50 dark:hover:text-white 2xl:p-2 2xl:text-xs">
                          <TrendingUp className="h-3 w-3 2xl:h-4 2xl:w-4" />
                          Popularity : {popularity.max ?? 'N/A'} %
                        </button>

                        <div className="mx-auto h-[0.2px] w-full max-w-[80%] bg-black/10 dark:bg-white/20"></div>

                        {/* Impression */}
                        {ad?.impression > 0 && (
                          <button className="backdrop-blur-80 text-10 flex items-center justify-start gap-1.5 p-1.5 px-3 pr-7 whitespace-nowrap text-gray-600 hover:bg-black/5 hover:text-black dark:text-[#C2C0C0] dark:hover:bg-[#0D0D0D]/50 dark:hover:text-white 2xl:p-2 2xl:pr-6 2xl:text-xs">
                            <img
                              src={FlameIcon}
                              alt="Flame"
                              className="relative left-[1px] mr-1 h-3 w-3 object-contain 2xl:h-4 2xl:w-4 invert dark:invert-0"
                            />
                            Impression: {ad?.impression}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ) : null;
            } catch {
              return null;
            }
          })()}

          {['facebook', 'instagram', 'pinterest'].includes(ad?.network) && (
            <ShadcnTooltip label={'Ad Preview'}>
              <button
                onClick={() => handleButtonClick(ad?.network)}
                className="flex h-5 w-5 cursor-pointer items-center justify-center rounded-full bg-black/10 text-gray-700 transition-all duration-200 hover:scale-110 2xl:h-6 2xl:w-6 dark:bg-[#3B3B3B] dark:text-white dark:hover:opacity-80"
              >
                <FaPlay className="relative h-2 w-2 2xl:left-[1px] 2xl:h-2.5 2xl:w-2.5" />
              </button>
            </ShadcnTooltip>
          )}
          <ShadcnTooltip label={networkLabels[ad?.network]}>
            <button className="flex cursor-pointer items-center justify-center gap-1 rounded-full text-center text-gray-500 transition-all duration-200 hover:scale-110 dark:text-white/70 dark:hover:opacity-80">
              {networks[ad?.network]}
            </button>
          </ShadcnTooltip>
          {ad?.popularityIndex > 0 && (
            <ShadcnTooltip label={`Popularity: ${ad?.popularityIndex} %`}>
              <button className="flex cursor-pointer items-center justify-center gap-1 rounded-full text-center text-gray-500 transition-all duration-200 hover:scale-110 dark:text-white/70 dark:hover:opacity-80">
                <TrendingUp className="h-4 w-4" />
              </button>
            </ShadcnTooltip>
          )}
          {/* AdLibrary surfaces Recreate via the slide-up action bar below
              the media instead — keep the inline icon only for the Ad
              Studio "find similar" flow. */}
          {!isAdLibraryRoute && (
            <ShadcnTooltip label="Recreate successful ad">
              <button
                className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-full bg-black/10 p-0.5 transition-all duration-200 hover:scale-110 2xl:h-7 2xl:w-7 dark:bg-[#3B3B3B]"
                onClick={() => handleSimilarClick()}
              >
                <img
                  className="relative -top-[2px] right-[1px] w-[90%] 2xl:-top-[2px] 2xl:w-full"
                  src={recreateAdsLogo}
                  alt="recreate"
                />
              </button>
            </ShadcnTooltip>
          )}
        </div>
      </div>

      {/* Swiper (Carousel) */}
      <div className="relative overflow-hidden">
        <Swiper
          key={images.join(',')}
          modules={[Navigation, Pagination, Scrollbar, Mousewheel, Autoplay]}
          autoHeight={true}
          mousewheel={false}
          spaceBetween={10}
          slidesPerView={'auto'}
          onSlideChange={handleSlideChange}
          onSwiper={setSwiperInstance}
          className="h-auto w-full"
        >
          {images?.map((url, idx) => (
            <SwiperSlide key={idx} className="flex items-center justify-center">
              <div className="relative w-full">
                <img
                  src={url}
                  onClick={() =>
                    setLightboxOpen &&
                    setLightboxOpen({
                      activeImage: url,
                      images,
                    })
                  }
                  alt={`slide-${idx}`}
                  className={`h-auto w-full cursor-pointer rounded-t-xl bg-gradient-to-r from-gray-600 via-gray-700 to-gray-600 object-cover shadow-lg ${
                    imageLoaded ? '' : 'animate-pulse'
                  }`}
                  style={{ minHeight: '250px' }}
                  loading="lazy"
                  onLoad={() => setImageLoaded(true)}
                />
                <div className="absolute bottom-0 max-h-[30%] w-full overflow-y-auto bg-gradient-to-b from-black/0 to-black p-3 leading-[1px] opacity-100 transition-opacity duration-300 group-hover:opacity-100 lg:opacity-0">
                  <span className="text-xs font-extrabold break-words text-white">
                    {isTitleExpanded
                      ? getTitleForActiveIndex()
                      : truncateText(getTitleForActiveIndex(), 50)}
                    {getTitleForActiveIndex()?.length > 50 && (
                      <button
                        className="ml-2 cursor-pointer text-blue-400 underline"
                        onClick={() => setIsTitleExpanded(!isTitleExpanded)}
                      >
                        {isTitleExpanded ? 'Read Less' : 'Read More'}
                      </button>
                    )}
                  </span>
                  <p className="mt-1 text-xs break-words text-white">
                    {isDescriptionExpanded ? description : truncateText(description, 100)}
                    {description?.length > 100 && (
                      <button
                        className="ml-1 cursor-pointer text-blue-400"
                        onClick={() => setIsDescriptionExpanded(!isDescriptionExpanded)}
                      >
                        {isDescriptionExpanded ? 'Read Less' : 'Read More'}
                      </button>
                    )}
                  </p>
                </div>
              </div>
            </SwiperSlide>
          ))}
        </Swiper>

        {/* Arrows - Only show when needed and when there are multiple images */}
        {!isBeginning && images?.length > 1 && (
          <button
            onClick={gotoPrevSlide}
            className="absolute top-1/2 left-1 z-10 -translate-y-1/2 cursor-pointer rounded-full bg-black/50 p-0.5 2xl:p-1"
          >
            <IoIosArrowBack className="text-lg text-white 2xl:text-xl" />
          </button>
        )}
        {!isEnd && images?.length > 1 && (
          <button
            onClick={gotoNextSlide}
            className="absolute top-1/2 right-1 z-10 -translate-y-1/2 cursor-pointer rounded-full bg-black/50 p-0.5 2xl:p-1"
          >
            <IoIosArrowForward className="text-lg text-white 2xl:text-xl" />
          </button>
        )}

        {/* AdLibrary-only: gradient bridge sitting at the bottom of the
            media. Fades the image into the action-bar background so the
            seam between media and bar is invisible. Hidden until hover. */}
        {isAdLibraryRoute && (
          <div
            aria-hidden
            className="pointer-events-none absolute bottom-0 left-0 z-5 h-8 w-full opacity-0 transition-opacity duration-300 group-hover:opacity-100"
            style={{
              background: 'linear-gradient(to bottom, transparent 0%, #2A2A2A 100%)',
            }}
          />
        )}
      </div>

      {/* AdLibrary-only: hover-revealed action bar — Creatify pattern.
          Collapsed by default (max-h-0); on group-hover the bar expands
          to its full 56 px height, pushing the card taller. The bar
          background (#2A2A2A) matches the bridge's gradient stop so the
          two read as one continuous surface. */}
      {isAdLibraryRoute && (
        <div
          className="pointer-events-none max-h-0 overflow-hidden opacity-0 transition-[max-height,opacity] duration-300 ease-out group-hover:pointer-events-auto group-hover:max-h-14 group-hover:opacity-100"
        >
          <div
            className="flex h-14 w-full items-center px-3"
            style={{ backgroundColor: '#2A2A2A' }}
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIsRecreateModalOpen(true);
              }}
              className="w-full rounded-full bg-white px-4 py-2 text-sm font-bold tracking-tight text-black shadow-md transition-colors duration-150 hover:bg-[#F2F2F2] active:bg-[#E5E5E5] 2xl:py-2.5 2xl:text-15"
            >
              Recreate
            </button>
          </div>
        </div>
      )}
      {isDialogOpen &&
        (selectedNetwork == 'facebook' ? (
          <AdPreviewDialogMain
            isDialogOpen={isDialogOpen}
            setIsDialogOpen={setIsDialogOpen}
            postOwner={userName}
            postOwnerImage={userAvatar}
            title={getTitleForActiveIndex()}
            description={description}
            image={images[activeIndex]}
          />
        ) : selectedNetwork == 'pinterest' ? (
          <AdPreviewPintMain
            isDialogOpen={isDialogOpen}
            setIsDialogOpen={setIsDialogOpen}
            postOwner={userName}
            postOwnerImage={userAvatar}
            title={getTitleForActiveIndex()}
            description={description}
            image={images[activeIndex]}
          />
        ) : selectedNetwork == 'instagram' ? (
          <AdPreviewInstaMain
            isDialogOpen={isDialogOpen}
            setIsDialogOpen={setIsDialogOpen}
            postOwner={userName}
            postOwnerImage={userAvatar}
            title={getTitleForActiveIndex()}
            description={description}
            image={images[activeIndex]}
          />
        ) : (
          ''
        ))}
      {isAdLibraryRoute && (
        <RecreateAdModal
          open={isRecreateModalOpen}
          onOpenChange={setIsRecreateModalOpen}
          image={images[activeIndex]}
          ad={ad}
        />
      )}
    </motion.div>
  );
};

export default memo(AdCreativesCard);
