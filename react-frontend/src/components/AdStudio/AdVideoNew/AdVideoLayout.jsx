import { useSelector, useDispatch } from 'react-redux';
import { ChevronLeft, PlayCircle, Library, Images, Video } from 'lucide-react';
import { motion } from 'framer-motion';
import { useSearchParams } from 'react-router-dom';

import { Dialog, DialogContent } from '@/components/ui/dialog';
import { toast } from 'react-toastify';
import emitter from '@/utils/eventEmitter';

import AdVideoHomeNew from './AdVideoHomeNew';
import UGCAdsPage from './pages/UGCAdsPage';
import ProductBrollPage from './pages/ProductBrollPage';
import AvatarAdsPage from './pages/AvatarAdsPage';
import CloneYourselfPage from './pages/CloneYourselfPage';
import AIAdsPage from './pages/AI-ADS/AIAdsPage';

import {
  setActivePage,
  setMySpaceTab,
  incrementSavedCount,
  showSavedFolder as showSavedFolderAction,
  setAvatarStep,
  setCloneStep,
  setAIAdsStep,
  setAiAdsSceneData,
  setImageAndScript,
} from '@/store/reducers/adStudio/adVideoNewSlice';
import { setFields } from '@/store/reducers/adFactoryNew/adFactoryNewSlice';
import { useEffect, useRef, useState } from 'react';
import genieMinimize, { captureModal } from '@/utils/ui/genieMinimize';
import MyVideosPage from './pages/MyVideosPage';
import MyImagesPage from './pages/MyImagesPage';
import CreativeFilterDropdown from '@/components/layout/header/AdStudio/AdCreative/CreativeFilterDropdown';
import { fetchProcessingCount } from '@/store/actions/adVideoNew/Advideoactions';

import DateRangeFilter from './DateRangeFilter';

const pageConfig = {
  'ai-ads': {
    title: 'AI Ads',
    component: AIAdsPage,
  },
  ugc: {
    title: 'AI UGC Ads',
    component: UGCAdsPage,
  },
  'b-roll': {
    title: 'Product B-Rolls',
    component: ProductBrollPage,
    video: '/static/adVideo/b-rolls-gif-2.gif',
  },
  avatar: {
    title: 'AI Avatar Ads',
    component: AvatarAdsPage,
  },
  clone: {
    title: 'Clone Yourself',
    component: CloneYourselfPage,
  },
  myVideos: {
    title: 'My Space',
    component: MyVideosPage,
  },
};

const selectVideoType = [
  {
    value: 'ai_ads',
    label: 'AI Ads',
  },
  {
    value: 'ugc',
    label: 'UGC Ads',
  },
  {
    value: 'broll',
    label: 'Product B-rolls',
  },

  {
    value: 'avatar',
    label: 'AI Avatar Ads',
  },
  {
    value: 'clone',
    label: 'Clone Yourself',
  },
];

const selectImageType = [
  { value: 'ai_ads', label: 'AI Ads' },
  { value: 'lifestyle', label: 'Lifestyle' },
  { value: 'product_shot', label: 'Product Shot' },
  { value: 'apps_saas', label: 'Apps & SaaS' },
  { value: 'brand_awareness', label: 'Brand Awareness' },
];

const AdVideoLayout = () => {
  const [videoType, setVideoType] = useState('');
  const [imageType, setImageType] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const {
    activePage,
    mySpaceTab,
    savedCount,
    isLoading,
    imageAndScript,
    currentAvatarStep,
    currentCloneStep,
    currentAIAdsStep,
    aiAdsSceneData,
    aiAdsSceneLoading,
  } = useSelector((state) => state.adVideoNew);
  const dispatch = useDispatch();
  const modalRef = useRef();
  const pollingRef = useRef(null);
  const [searchParams, setSearchParams] = useSearchParams();

  const page = pageConfig[activePage];
  const PageComponent = page?.component;
  const pageVideo = page?.video;

  useEffect(() => {
    if (activePage) {
      sessionStorage.setItem('adVideoActivePage', activePage);
    }
  }, [activePage]);

  useEffect(() => {
    if (savedCount > 0 && activePage !== 'myVideos' && !pollingRef.current) {
      pollingRef.current = setInterval(() => {
        dispatch(fetchProcessingCount());
      }, 5000);
    }
    if ((savedCount === 0 || activePage === 'myVideos') && pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [savedCount, activePage, dispatch]);

  const handleBackNavigation = () => {
    if (activePage === 'avatar') {
      const generatedData = imageAndScript?.data || imageAndScript;
      const urlId = searchParams.get('id');
      const isMissingData =
        urlId && (!generatedData?.generatedImage || !generatedData?.generatedScript);

      // If both image and script are generated and not failed, ask for discard confirmation inside avatar page
      const hasAnyError =
        generatedData?.generatedImage === 'failed' || generatedData?.generatedScript === 'failed';

      if ((isLoading || isMissingData) && !hasAnyError) {
        toast.dismiss();
        toast.error('avatar and script is generating please wait');
        return;
      }

      if (generatedData?.generatedImage && generatedData?.generatedScript && !hasAnyError) {
        emitter.emit('avatar:request-discard');
        return;
      }
    }
    if (activePage === 'avatar') {
      setSearchParams({}, { replace: true });
      dispatch(setImageAndScript(null));
      dispatch(setFields({ brand_name: '', brandInfo: {}, selectedBrand: {} }));
    }
    if (activePage === 'clone') {
      const generatedData = imageAndScript?.data || imageAndScript;
      const urlId = searchParams.get('id');
      const isMissingData =
        urlId && (!generatedData?.generatedImage || !generatedData?.generatedScript);
      const hasAnyError =
        generatedData?.generatedImage === 'failed' || generatedData?.generatedScript === 'failed';

      if ((isLoading || isMissingData) && !hasAnyError) {
        toast.dismiss();
        toast.error('Clone video is generating, please wait');
        return;
      }
      if (generatedData?.generatedImage && generatedData?.generatedScript && !hasAnyError) {
        emitter.emit('clone:request-discard');
        return;
      }
      setSearchParams({}, { replace: true });
      dispatch(setImageAndScript(null));
      dispatch(setFields({ brand_name: '', brandInfo: {}, selectedBrand: {} }));
    }
    if (activePage === 'ai-ads') {
      // Block back navigation while scenes are not fully ready:
      //   - initial gen in flight (no scripts yet)
      //   - some images still loading or failed (not all images ready)
      //   - any per-scene regen in flight
      const aiAdsScenes =
        aiAdsSceneData?.scenes || aiAdsSceneData?.data?.scenes || [];
      const isInitiallyLoading =
        currentAIAdsStep === 'generation' &&
        aiAdsSceneLoading &&
        aiAdsScenes.length === 0;
      const isRegenerating =
        currentAIAdsStep === 'generation' &&
        aiAdsSceneLoading &&
        aiAdsScenes.length > 0;
      const hasIncompleteImages =
        currentAIAdsStep === 'generation' &&
        aiAdsScenes.length > 0 &&
        aiAdsScenes.some((s) => !s.frameImageUrl && !s.imageFailed);
      if (isInitiallyLoading || hasIncompleteImages) {
        toast.dismiss();
        toast.error('Scenes are generating, please wait');
        return;
      }
      if (isRegenerating) {
        toast.dismiss();
        toast.error('Regeneration in progress, please wait');
        return;
      }
      setSearchParams({}, { replace: true });
      dispatch(setAiAdsSceneData(null));
      dispatch(setAIAdsStep('selection'));
    }
    dispatch(setAvatarStep('options'));
    dispatch(setCloneStep('upload'));
    dispatch(setActivePage('home'));
  };

  const mySpaceIconRef = useRef(null);

  // `kind` ('video' | 'image') drives which MySpace tab opens after the genie
  // animation lands. Defaults to 'video' since every page in this layout
  // currently produces video — image-generating callers must pass 'image'.
  const handleGenerate = async (kind = 'video') => {
    const modal = modalRef.current;
    // Prefer the real sidebar My Space button (bottom-left) so the genie
    // flies toward it. Falls back to the legacy hidden span only if the
    // sidebar isn't mounted (e.g. mobile drawer closed).
    const targetEl =
      document.getElementById('sidebar-my-space-button') || mySpaceIconRef.current;

    if (modal && targetEl) {
      const snapshot = await captureModal(modal);
      modal.style.opacity = '0';
      await new Promise((resolve) => genieMinimize(snapshot, targetEl, resolve));
      modal.style.opacity = '';
    }

    setSearchParams({}, { replace: true });
    dispatch(setAiAdsSceneData(null));
    dispatch(setAIAdsStep('selection'));
    dispatch(setMySpaceTab(kind === 'image' ? 'images' : 'videos'));
    dispatch(showSavedFolderAction());
    dispatch(setActivePage('myVideos'));
    dispatch(incrementSavedCount());
    dispatch(fetchProcessingCount());
  };

  // useEffect(() => {
  //   dispatch(fetchProcessingCount());
  // }, [dispatch, savedCount]);

  const SavedFolderIcon = () => {
    return (
      <div className="fixed top-4 right-4 z-[9999] 2xl:top-6 2xl:right-8">
        <button
          className="group flex flex-col items-center gap-1.5 transition-all duration-300"
          onClick={() => dispatch(setActivePage('myVideos'))}
        >
          <div
            id="saved-folder-icon"
            className="relative flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 text-white backdrop-blur-md transition-all group-hover:bg-white/20 2xl:h-11 2xl:w-11"
          >
            <Library className="h-5 w-5 2xl:h-6 2xl:w-6" />
            {savedCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-gradient-to-tr from-[#15DCFF] to-[#6b72f8] text-[10px] font-bold text-white shadow-lg 2xl:h-5 2xl:w-5 2xl:text-xs">
                {savedCount}
              </span>
            )}
          </div>
          <span className="hidden text-[10px] font-medium text-white/70 group-hover:text-white sm:inline 2xl:text-xs">
            My Space
          </span>
        </button>
      </div>
    );
  };

  const handleDateChange = (start, end) => {
    setStartDate(start);
    setEndDate(end);
  };

  const handleClearDates = () => {
    setStartDate('');
    setEndDate('');
  };

  return (
    <div className="relative flex h-[95vh] w-full flex-col">
      {/* {activePage !== 'myVideos' && <SavedFolderIcon />} */}

      {activePage === 'home' ? (
        <AdVideoHomeNew />
      ) : activePage === 'myVideos' ? (
        <>
          {/* Header */}
          <div className="flex w-full items-center justify-between gap-2 p-4 pr-14 text-gray-900 2xl:pr-16 dark:text-white">
            <div className="flex items-center gap-3">
              <button
                onClick={handleBackNavigation}
                className="flex items-center gap-2 text-xl 2xl:text-3xl"
              >
                <ChevronLeft className="h-6.5 w-6.5 2xl:h-9 2xl:w-9" />
                {page?.title}
              </button>

              {/* Tabs — visual style + position mirror Brand IQ's HeaderTabs */}
              <div className="relative flex items-center gap-0 rounded-full border border-black/10 bg-gray-100 p-1 backdrop-blur-md dark:border-slate-600/40 dark:bg-[#0D0D0D]">
                {[
                  { id: 'images', label: 'Images', Icon: Images },
                  { id: 'videos', label: 'Videos', Icon: Video },
                ].map(({ id, label, Icon }) => {
                  const isActive = mySpaceTab === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => dispatch(setMySpaceTab(id))}
                      className={`2xl:text-13 relative flex items-center rounded-full px-[11px] py-[5px] text-[10px] font-medium whitespace-nowrap transition 2xl:px-4 2xl:py-[7px] ${
                        isActive ? 'text-gray-900 dark:text-white' : 'text-gray-500 hover:text-black dark:text-[#AFAFAF] dark:hover:text-white'
                      }`}
                    >
                      <div className="flex gap-1 2xl:gap-2">
                        <Icon className="h-[13px] w-[13px] 2xl:h-5 2xl:w-5" />
                        {label}
                      </div>
                      {isActive && (
                        <motion.div
                          layoutId="mySpaceTabBg"
                          className="absolute inset-0 -z-10 rounded-full bg-white shadow-sm dark:bg-gradient-to-br dark:from-[#3C3C3C] dark:to-[#3C3C3C] dark:shadow-none"
                          transition={{ type: 'spring', duration: 0.4 }}
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <DateRangeFilter onDateChange={handleDateChange} onClear={handleClearDates} />
              {mySpaceTab === 'videos' ? (
                <CreativeFilterDropdown
                  options={selectVideoType}
                  label="Filter"
                  value={selectVideoType.find((p) => p.value === videoType)}
                  onChange={(value) => setVideoType(value)}
                  onClear={() => setVideoType('')}
                />
              ) : (
                <CreativeFilterDropdown
                  options={selectImageType}
                  label="Filter"
                  value={selectImageType.find((p) => p.value === imageType)}
                  onChange={(value) => setImageType(value)}
                  onClear={() => setImageType('')}
                />
              )}
            </div>
          </div>

          {mySpaceTab === 'images' ? (
            <MyImagesPage imageType={imageType} startDate={startDate} endDate={endDate} />
          ) : (
            <MyVideosPage videoType={videoType} startDate={startDate} endDate={endDate} />
          )}
        </>
      ) : (
        <>
          {/* Header */}
          <div className="flex items-center gap-2 p-4 text-zinc-900 dark:text-white">
            <button
              onClick={handleBackNavigation}
              className="flex items-center gap-2 text-xl 2xl:text-3xl"
            >
              <ChevronLeft className="h-6.5 w-6.5 2xl:h-9 2xl:w-9" />
              {page.title}
            </button>
            {/* Hidden genie target — zero-size, positioned top-right to match My Space in sidebar */}
            <span ref={mySpaceIconRef} className="pointer-events-none fixed top-[700px] right-4 h-0 w-0" />
          </div>

          <div className="flex flex-1 items-center justify-center overflow-hidden px-4">
            <div
              ref={modalRef}
              className={`min-w-112.5 rounded-3xl transition-all duration-300 2xl:max-h-[85vh] ${
                activePage === 'ai-ads' && currentAIAdsStep === 'details'
                  ? 'scale-75 2xl:scale-100'
                  : 'h-fit scale-75 2xl:scale-100'
              } ${
                activePage !== 'ugc'
                  ? 'rounded-[30px] border border-black/10 bg-white shadow-[0_10px_30px_-10px_rgba(0,0,0,0.15)] backdrop-blur-xl dark:border-white/10 dark:bg-[#303030]/50 dark:shadow-none'
                  : ''
              } ${
                activePage === 'ai-ads' && currentAIAdsStep === 'details'
                  ? 'w-full max-w-[1480px]'
                  : activePage === 'ai-ads'
                  ? 'w-fit max-w-none'
                  : activePage === 'avatar' && currentAvatarStep === 'face-capture'
                  ? 'w-full max-w-4xl sm:min-w-[700px] 2xl:max-w-5xl'
                  : 'w-full max-w-2xl 2xl:max-w-4xl'
              } ${
                activePage === 'ai-ads' && currentAIAdsStep === 'generation'
                  ? ''
                  : 'overflow-hidden'
              }`}
            >
              {PageComponent && (
                <PageComponent
                  pageVideo={pageVideo}
                  handleGenerate={handleGenerate}
                  videoType={videoType}
                />
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default AdVideoLayout;
