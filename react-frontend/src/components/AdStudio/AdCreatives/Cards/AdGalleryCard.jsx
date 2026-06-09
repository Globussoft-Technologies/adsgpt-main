import React, { useState, memo, useEffect } from 'react';
import { Swiper, SwiperSlide } from 'swiper/react';
import { Navigation, Autoplay, Mousewheel, Pagination, Scrollbar } from 'swiper/modules';
import { IoIosArrowBack, IoIosArrowForward } from 'react-icons/io';
import { FaPlay, FaDownload, FaExpand } from 'react-icons/fa';
import {
  Instagram,
  Pencil,
  TrendingUp,
  Maximize2,
  ArrowLeft,
  RotateCw,
  History as HistoryIcon,
  Download,
} from 'lucide-react';
import recreateAdsLogo from '@/assets/layouts/adstudio/recreate-ads.svg';
import AdPreviewDialogMain from '../AdPreview/layout/AdPreviewDialogMain';
import { nanoid } from 'nanoid';
import { useDispatch, useSelector } from 'react-redux';
import { formatUrl } from '@/utils/formatUrl';
import { FaFacebookF, FaGoogle, FaPinterest } from 'react-icons/fa';
import { ShadcnTooltip } from '@/components/layout/ShadcnTooltip';
import { motion, AnimatePresence } from 'framer-motion';
import { FADE_UP_ANIMATION_VARIANT } from '@/utils/ui/framerMotionVariants';
import AdPreviewInstaMain from '../AdPreview/layout/AdPreviewInstaMain';
import AdPreviewPintMain from '../AdPreview/layout/AdPreviewPintMain';
import { BarChart2, MoreHorizontal } from 'lucide-react';
import FlameIcon from '@/assets/layouts/adstudio/adcard/flame.svg';
import MoreOptionsIcon from '@/assets/layouts/adstudio/adcard/more-options.svg';
import { handleDownload } from '@/utils/download';
import { addImage } from '@/store/reducers/adStudio/promptSlice';
import { setActiveAdStudioTab } from '@/store/reducers/adStudio/adStudioTabsSlice';
import { useLocation, useNavigate } from 'react-router-dom';
import { createNewSession, setAdCreativeSessionId } from '@/store/reducers/adStudio/adHistorySlice';
import { resetAdCreativeSlice } from '@/store/reducers/adStudio/adCreativeSlice';
import { setEditorFields } from '@/store/reducers/adStudio/editorSlice';
import { fetchSessionOfSavedItems } from '@/store/actions/brandIQ/myBrandActions';
import rotateGradientIcon from '@/assets/layouts/appsidebar/rotate-gradient.svg';
import { toast } from 'react-hot-toast';
import { useSidebar } from '@/components/ui/sidebar';
import { useDownloadWithFormat } from '@/hooks/useDownloadWithFormat';
import ImageFormatDialog from '@/components/BrandIQ/ImageFormating/ImageFormatDialog';
const EXPIRED_URL = import.meta.env.VITE_EXPIRED_URL;
const S3_BASE_URL = import.meta.env.VITE_S3_BASE_URL;

// Intentionally-hidden hover overlay, kept for quick re-enable. Named flag
// avoids a literal `false &&` (no-constant-binary-expression).
const SHOW_HOVER_OVERLAY = false;

const networks = {
  instagram: <Instagram className="h-4 w-4" />,
  facebook: <FaFacebookF className="h-4 w-4" />,
  google: <FaGoogle className="h-4 w-4" />,
  pinterest: <FaPinterest className="h-4 w-4" />,
};

const networkLabels = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  google: 'Google',
  pinterest: 'Pinterest',
};

const AdGalleryCard = ({ image, editimg, setLightboxOpen, onClick }) => {
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
  const [imageError, setImageError] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [cardSize, setCardSize] = useState('medium'); // small, medium, large
  const navigate = useNavigate();
  const { userData } = useSelector((state) => state.socket);
  const { isMobile } = useSidebar();
  const location = useLocation();
  const currentRoute = location.pathname;
  // Detect card size based on image dimensions or container
  useEffect(() => {
    const detectCardSize = () => {
      // You can adjust these breakpoints based on your design
      const width = window.innerWidth;
      if (width < 640) {
        setCardSize('small');
      } else if (width < 1024) {
        setCardSize('medium');
      } else {
        setCardSize('large');
      }
    };

    detectCardSize();
    window.addEventListener('resize', detectCardSize);
    return () => window.removeEventListener('resize', detectCardSize);
  }, []);

  // Responsive icon sizes based on card size
  const getIconSizes = () => {
    switch (cardSize) {
      case 'small':
        return {
          container: 'gap-2',
          icon: 'h-8 w-8',
          iconInner: 'h-4 w-4',
          tooltip: 'text-xs',
        };
      case 'medium':
        return {
          container: 'gap-3',
          icon: 'h-10 w-10',
          iconInner: 'h-4.5 w-4.5',
          tooltip: 'text-sm',
        };
      case 'large':
        return {
          container: 'gap-4',
          icon: 'h-12 w-12',
          iconInner: 'h-5 w-5',
          tooltip: 'text-base',
        };
      default:
        return {
          container: 'gap-3',
          icon: 'h-10 w-10',
          iconInner: 'h-4.5 w-4.5',
          tooltip: 'text-sm',
        };
    }
  };

  const iconSizes = getIconSizes();

  const openLightbox = (baseImage, logoImage, baseWithLogoImage, botId, adIndex, editorType) => {
    if (baseWithLogoImage == EXPIRED_URL) {
      window.open(import.meta.env.VITE_SIGNUP_URL, '_blank');
      return;
    }
    dispatch(
      setEditorFields({
        baseImage,
        logoImage,
        baseWithLogoImage,
        botId,
        adIndex,
        isEditorOpen: true,
        isOldEditorOpen: editorType === 'old' ? true : false,
      })
    );
  };

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
    setImageLoaded(false);
    setImageError(false);
  };

  const truncateText = (text, limit) =>
    text?.length > limit ? `${text.slice(0, limit)}...` : text;

  useEffect(() => {
    let imgs = [];
    if (Array.isArray(image)) {
      imgs = [...image];
    } else if (image) {
      imgs = [image];
    }
    setImages(imgs);
  }, [image]);

  const handleSimilarClick = () => {
    const url = images[activeIndex];
    if (url) {
      const newImage = {
        id: nanoid(),
        url,
        type: 'ad',
        title: '',
        description: '',
        ad: {},
      };
      dispatch(addImage(newImage));
      dispatch(setActiveAdStudioTab('adCreativeNew'));
      dispatch(createNewSession({ tab: 'adCreative' }));
      dispatch(resetAdCreativeSlice());
      navigate('/adstudio');
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

  const handleImageLoad = () => {
    setImageLoaded(true);
    setImageError(false);
  };

  const handleImageError = () => {
    setImageError(true);
    setImageLoaded(true);
  };
  const handleBackClick = async (args) => {
    await dispatch(fetchSessionOfSavedItems(args)).then((result) => {
      if (result?.payload?.data?.data[0]) {
        dispatch(resetAdCreativeSlice());
        dispatch(setAdCreativeSessionId(result?.payload?.data?.data[0]));
        dispatch(setActiveAdStudioTab('adCreative'));
        navigate('/adstudio');
      } else {
        toast.error('No Chat History Found for this image');
      }
    });
  };

  // Handle full view click
  const handleFullViewClick = () => {
    if (onClick) {
      onClick();
      return;
    }

    if (setLightboxOpen) {
      const currentImage = images[activeIndex];
      if (currentImage) {
        setLightboxOpen(currentImage);
      }
    }
  };
  const { handleDownloadWithFormat, formatDialog, setFormatDialog } = useDownloadWithFormat();

  // Update the download buttons to use the new handler
  const renderDownloadButton = () => (
    <ShadcnTooltip label="Download image (with formatting options)">
      <motion.button
        onClick={() => handleDownloadWithFormat(images[activeIndex])}
        className={`flex ${iconSizes.icon} items-center justify-center rounded-full bg-white/20 text-white shadow-2xl backdrop-blur-sm transition-all duration-200 hover:scale-110 hover:bg-white/30 active:scale-95`}
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.95 }}
      >
        <FaDownload className={iconSizes.iconInner} />
      </motion.button>
    </ShadcnTooltip>
  );

  const renderHeaderDownloadButton = (arg) => (
    <ShadcnTooltip label="Download image (with formatting options)">
      <motion.button
        onClick={() => handleDownloadWithFormat(arg)}
        className="flex h-6 w-6 items-center justify-center rounded-full bg-[#3B3B3B] text-white transition-all duration-300 hover:scale-110 hover:bg-[#4A4A4A] active:scale-95 2xl:h-8 2xl:w-8"
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.9 }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
      >
        <Download className="h-3 w-3 2xl:h-4 2xl:w-4" />
      </motion.button>
    </ShadcnTooltip>
  );

  return (
    <>
      <motion.div
        variants={FADE_UP_ANIMATION_VARIANT}
        initial="initial"
        whileInView="whileInView"
        viewport={{ once: true }}
        className="group relative box-border w-full overflow-hidden rounded-xl border border-gray-200 shadow-lg transition-all duration-300 hover:scale-[1.02] hover:shadow-xl dark:border-gray-700 dark:hover:shadow-2xl"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {/* Advanced Hover Overlay with Icons - Responsive */}
        <AnimatePresence>
          {SHOW_HOVER_OVERLAY && (
            <motion.div
              className="absolute inset-0 z-40 flex items-center justify-center rounded-xl bg-black/60 backdrop-blur-md"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
            >
              {/* Responsive Action Icons Container */}
              <motion.div
                className={`flex flex-wrap items-center justify-center ${iconSizes.container}`}
                initial={{ scale: 0.8, y: 20 }}
                animate={{ scale: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.1 }}
              >
                {/* Full View Icon */}
                <ShadcnTooltip label="Full view">
                  <motion.button
                    onClick={handleFullViewClick}
                    className={`flex ${iconSizes.icon} items-center justify-center rounded-full bg-white/20 text-white shadow-2xl backdrop-blur-sm transition-all duration-200 hover:scale-110 hover:bg-white/30 active:scale-95`}
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.95 }}
                  >
                    <Maximize2 className={iconSizes.iconInner} />
                  </motion.button>
                </ShadcnTooltip>

                {/* Download Icon */}
                <ShadcnTooltip label="Download image">
                  <motion.button
                    onClick={() => handleDownload(images[activeIndex])}
                    className={`flex ${iconSizes.icon} items-center justify-center rounded-full bg-white/20 text-white shadow-2xl backdrop-blur-sm transition-all duration-200 hover:scale-110 hover:bg-white/30 active:scale-95`}
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.95 }}
                  >
                    <FaDownload className={iconSizes.iconInner} />
                  </motion.button>
                </ShadcnTooltip>

                {/* Edit/Pencil Icon */}
                <ShadcnTooltip label="Edit">
                  <motion.button
                    onClick={() => openLightbox(editimg, '', '', '', '', 'new')}
                    className={`flex ${iconSizes.icon} items-center justify-center rounded-full bg-white/20 text-white shadow-2xl backdrop-blur-sm transition-all duration-200 hover:scale-110 hover:bg-white/30 active:scale-95`}
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.95 }}
                  >
                    <Pencil className={iconSizes.iconInner} />
                  </motion.button>
                </ShadcnTooltip>

                {/* Recreate Ad Icon */}
                <ShadcnTooltip label="Recreate successful ad">
                  <motion.button
                    onClick={handleSimilarClick}
                    className={`flex ${iconSizes.icon} items-center justify-center rounded-full bg-white/20 text-white shadow-2xl backdrop-blur-sm transition-all duration-200 hover:scale-110 hover:bg-white/30 active:scale-95`}
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.95 }}
                  >
                    <img className={iconSizes.iconInner} src={recreateAdsLogo} alt="recreate" />
                  </motion.button>
                </ShadcnTooltip>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
        {/* Header - Always Visible */}
        {(isHovered || isMobile) && currentRoute !== '/adfactory-demo' && (
          <div className="card_header absolute top-0 left-0 z-30 flex h-10 w-full items-center justify-between rounded-none px-3 opacity-100 backdrop-blur-xl transition-opacity duration-300 group-hover:opacity-100 lg:opacity-100 2xl:h-12 dark:bg-[#0F0F0F]/80">
            <div className="flex items-center gap-2 text-sm font-medium text-white">
              {/* User avatar section can be added here */}
            </div>
            <div className="right_header flex items-center gap-2 2xl:gap-2.5">
              {/* Static Icons - Only show when not hovered */}
              <AnimatePresence>
                <>
                  {/* Edit Icon */}
                  <ShadcnTooltip label="Edit">
                    <motion.button
                      onClick={() => openLightbox(editimg, '', '', '', '', 'new')}
                      className="flex h-6 w-6 items-center justify-center rounded-full bg-[#3B3B3B] text-white transition-all duration-300 hover:scale-110 hover:bg-[#4A4A4A] active:scale-95 2xl:h-8 2xl:w-8"
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      transition={{ duration: 0.25, ease: 'easeOut' }}
                    >
                      <Pencil className="h-3 w-3 2xl:h-4 2xl:w-4" />
                    </motion.button>
                  </ShadcnTooltip>

                  {/* Download Icon */}
                  {/* <ShadcnTooltip label="Download image">
                  <motion.button
                    onClick={() => handleDownload(images[activeIndex])}
                    className="flex h-6 w-6 items-center justify-center rounded-full bg-[#3B3B3B] text-white transition-all duration-300 hover:scale-110 hover:bg-[#4A4A4A] active:scale-95 2xl:h-8 2xl:w-8"
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    transition={{ duration: 0.25, ease: 'easeOut' }}
                  >
                    <Download className="h-3 w-3 2xl:h-4 2xl:w-4" />
                  </motion.button>
                </ShadcnTooltip> */}

                  {renderHeaderDownloadButton(images[activeIndex])}
                  {/* Back Icon */}
                  <ShadcnTooltip label="Check in Chat History">
                    <motion.button
                      onClick={() =>
                        handleBackClick({
                          userId: userData?.user_id,
                          imageUrl: editimg,
                        })
                      }
                      className="flex h-6 w-6 items-center justify-center rounded-full bg-[#3B3B3B] text-white transition-all duration-300 hover:scale-110 hover:bg-[#4A4A4A] active:scale-95 2xl:h-8 2xl:w-8"
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      transition={{ duration: 0.25, ease: 'easeOut' }}
                    >
                      <HistoryIcon className="h-3 w-3 2xl:h-4 2xl:w-4" />
                    </motion.button>
                  </ShadcnTooltip>

                  {/* Recreate Ad Icon */}
                  <ShadcnTooltip label="Recreate successful ad">
                    <motion.button
                      onClick={handleSimilarClick}
                      className="flex h-6 w-6 items-center justify-center rounded-full bg-[#3B3B3B] text-white transition-all duration-300 hover:scale-110 hover:bg-[#4A4A4A] active:scale-95 2xl:h-8 2xl:w-8"
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      transition={{ duration: 0.25, ease: 'easeOut' }}
                    >
                      <img
                        className="relative -top-0.5 h-5 w-5 object-contain 2xl:h-6 2xl:w-6"
                        src={recreateAdsLogo}
                        alt="recreate"
                      />
                    </motion.button>
                  </ShadcnTooltip>
                </>
              </AnimatePresence>
            </div>
          </div>
        )}
        {/* Swiper (Carousel) */}
        <div className="relative overflow-hidden rounded-t-xl">
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
                  {/* Loading Skeleton */}
                  {!imageLoaded && !imageError && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center">
                      <div className="h-full w-full animate-pulse rounded-t-xl bg-gradient-to-r from-gray-900 via-gray-800 to-gray-900">
                        <div className="flex h-full items-center justify-center">
                          <div className="h-12 w-12 animate-spin rounded-full border-4 border-gray-400 border-t-transparent"></div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Error State */}
                  {imageError && (
                    <div className="flex min-h-[250px] w-full items-center justify-center rounded-t-xl bg-gradient-to-r from-gray-100 to-gray-200">
                      <div className="text-center text-gray-400">
                        <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-gray-300">
                          <span className="text-lg">⚠️</span>
                        </div>
                        <p className="text-sm">Failed to load image</p>
                      </div>
                    </div>
                  )}

                  {/* Actual Image */}
                  <motion.img
                    src={url}
                    onClick={handleFullViewClick}
                    alt={`slide-${idx}`}
                    className={`w-full cursor-pointer rounded-t-xl object-cover transition-all duration-500 ${
                      imageLoaded ? 'scale-100 opacity-100' : 'scale-105 opacity-0'
                    } ${imageError ? 'hidden' : ''}`}
                    style={{
                      minHeight: '250px',
                      maxHeight: '400px',
                      width: '100%',
                      height: 'auto',
                    }}
                    loading="lazy"
                    onLoad={handleImageLoad}
                    onError={handleImageError}
                    initial={{ opacity: 0, scale: 1.05 }}
                    animate={{
                      opacity: imageLoaded ? 1 : 0,
                      scale: imageLoaded ? 1 : 1.05,
                    }}
                    transition={{ duration: 1.5, ease: 'easeOut' }}
                  />

                  {/* Gradient Overlay */}
                  <div className="pointer-events-none absolute right-0 bottom-0 left-0 h-20 bg-gradient-to-t from-black/60 via-black/20 to-transparent"></div>
                </div>
              </SwiperSlide>
            ))}
          </Swiper>

          {/* Responsive Navigation Arrows */}
          {!isBeginning && images?.length > 1 && (
            <motion.button
              onClick={gotoPrevSlide}
              className={`absolute top-1/2 left-2 z-20 -translate-y-1/2 cursor-pointer rounded-full bg-black/60 backdrop-blur-sm transition-all duration-200 hover:scale-110 hover:bg-black/80 ${
                cardSize === 'small' ? 'p-1.5' : cardSize === 'medium' ? 'p-2' : 'p-2.5'
              }`}
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.95 }}
            >
              <IoIosArrowBack
                className={`text-white ${
                  cardSize === 'small' ? 'text-base' : cardSize === 'medium' ? 'text-lg' : 'text-xl'
                }`}
              />
            </motion.button>
          )}
          {!isEnd && images?.length > 1 && (
            <motion.button
              onClick={gotoNextSlide}
              className={`absolute top-1/2 right-2 z-20 -translate-y-1/2 cursor-pointer rounded-full bg-black/60 backdrop-blur-sm transition-all duration-200 hover:scale-110 hover:bg-black/80 ${
                cardSize === 'small' ? 'p-1.5' : cardSize === 'medium' ? 'p-2' : 'p-2.5'
              }`}
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.95 }}
            >
              <IoIosArrowForward
                className={`text-white ${
                  cardSize === 'small' ? 'text-base' : cardSize === 'medium' ? 'text-lg' : 'text-xl'
                }`}
              />
            </motion.button>
          )}

          {/* Responsive Slide Indicators */}
          {images?.length > 1 && (
            <div
              className={`absolute bottom-2 left-1/2 z-20 flex -translate-x-1/2 transform space-x-1 ${
                cardSize === 'small' ? 'space-x-0.5' : 'space-x-1'
              }`}
            >
              {images.map((_, index) => (
                <motion.div
                  key={index}
                  className={`rounded-full transition-all duration-300 ${
                    index === activeIndex
                      ? cardSize === 'small'
                        ? 'h-1.5 w-1.5 scale-125 bg-white'
                        : cardSize === 'medium'
                          ? 'h-2 w-2 scale-125 bg-white'
                          : 'h-2.5 w-2.5 scale-125 bg-white'
                      : cardSize === 'small'
                        ? 'h-1.5 w-1.5 scale-100 bg-white/50'
                        : cardSize === 'medium'
                          ? 'h-2 w-2 scale-100 bg-white/50'
                          : 'h-2.5 w-2.5 scale-100 bg-white/50'
                  }`}
                  whileHover={{ scale: 1.2 }}
                />
              ))}
            </div>
          )}
        </div>

        {/* Dialog Components */}
        {isDialogOpen && (
          <>
            {selectedNetwork === 'instagram' && (
              <AdPreviewInstaMain
                isOpen={isDialogOpen}
                setIsOpen={setIsDialogOpen}
                adData={{ image: images[activeIndex] }}
              />
            )}
            {selectedNetwork === 'pinterest' && (
              <AdPreviewPintMain
                isOpen={isDialogOpen}
                setIsOpen={setIsDialogOpen}
                adData={{ image: images[activeIndex] }}
              />
            )}
            {selectedNetwork &&
              selectedNetwork !== 'instagram' &&
              selectedNetwork !== 'pinterest' && (
                <AdPreviewDialogMain
                  isOpen={isDialogOpen}
                  setIsOpen={setIsDialogOpen}
                  adData={{ image: images[activeIndex], network: selectedNetwork }}
                />
              )}
          </>
        )}
      </motion.div>
      <ImageFormatDialog
        isOpen={formatDialog.isOpen}
        onClose={() => setFormatDialog({ isOpen: false, imageUrl: null })}
        imageUrl={formatDialog.imageUrl}
        // onDownload={async (formatOptions) => {
        //   // Handle the download with format options
        //   console.log('Download with options:', formatOptions);
        // }}
      />
    </>
  );
};

export default memo(AdGalleryCard);
