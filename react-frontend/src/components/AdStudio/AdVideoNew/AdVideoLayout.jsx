import { useSelector, useDispatch } from 'react-redux';
import { ChevronLeft, PlayCircle, Library, Images, Video } from 'lucide-react';
import { motion } from 'framer-motion';
import { useNavigate, useSearchParams } from 'react-router-dom';

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
  setMySpaceImageSource,
  incrementSavedCount,
  showSavedFolder as showSavedFolderAction,
  setAvatarStep,
  setCloneStep,
  setAIAdsStep,
  setAiAdsSceneData,
  setImageAndScript,
  setRecreateInputs,
} from '@/store/reducers/adStudio/adVideoNewSlice';
import { setFields } from '@/store/reducers/adFactoryNew/adFactoryNewSlice';
import { useEffect, useMemo, useRef, useState } from 'react';
import genieMinimize, { captureModal } from '@/utils/ui/genieMinimize';
import MyVideosPage from './pages/MyVideosPage';
import MyImagesPage from './pages/MyImagesPage';
import MyAdFactoryImagesPage from './pages/MyAdFactoryImagesPage';
import MyAssistantImagesPage from './pages/MyAssistantImagesPage';
import MyClaudeImagesPage from './pages/MyClaudeImagesPage';
import CreativeFilterDropdown from '@/components/layout/header/AdStudio/AdCreative/CreativeFilterDropdown';
import ThemeToggle from '@/components/layout/header/ThemeToggle';
import { fetchProcessingCount } from '@/store/actions/adVideoNew/Advideoactions';
import { canUseWorkspaceFeature } from '@/utils/workspaceSession';

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

// MySpace → Images tab → which image source to browse.
const selectImageSource = [
  { value: 'adCreative', label: 'AdCreative' },
  { value: 'adFactory', label: 'AdFactory' },
  // { value: 'aiAssistant', label: 'AI Assistant' },
  // { value: 'claudeAI', label: 'Claude AI' },
];

const AdVideoLayout = ({ libraryOnly = false }) => {
  const [videoType, setVideoType] = useState('');
  const [imageType, setImageType] = useState('');
  // Image source lives in redux so the AI Assistant "View more" deep-link can
  // preselect this source before navigating here. (setImageSource is defined
  // below, once `dispatch` exists.)
  const imageSource = useSelector((state) => state.adVideoNew.mySpaceImageSource);
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
  const availableImageSources = useMemo(
    () =>
      selectImageSource.filter(({ value }) => {
        if (value === 'adFactory') return canUseWorkspaceFeature('adFactory');
        if (value === 'aiAssistant' || value === 'claudeAI') {
          return canUseWorkspaceFeature('assistant');
        }
        return canUseWorkspaceFeature('adStudio.adCreative');
      }),
    []
  );
  const videosAllowed = canUseWorkspaceFeature('adStudio.adVideo');
  const availableMySpaceTabs = [
    { id: 'images', label: 'Images', Icon: Images },
    videosAllowed && { id: 'videos', label: 'Videos', Icon: Video },
  ].filter(Boolean);
  const setImageSource = (value) => dispatch(setMySpaceImageSource(value));
  const modalRef = useRef();
  const pollingRef = useRef(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  // Recreate may clear its query parameters while the form is mounting, so
  // remember its origin rather than deciding later from the current URL.
  const [fromRecreate] = useState(() =>
    ['b-roll', 'ugc', 'avatar'].includes(searchParams.get('page'))
  );

  const exitRecreateToMySpace = () => {
    if (!fromRecreate) {
      dispatch(setActivePage('home'));
      return;
    }

    dispatch(setRecreateInputs(null));
    dispatch(setImageAndScript(null));
    dispatch(setAvatarStep('options'));
    dispatch(setMySpaceTab('videos'));
    dispatch(setActivePage('myVideos'));
    navigate('/my-space');
  };

  const displayedActivePage = libraryOnly ? 'myVideos' : activePage;
  const page = pageConfig[displayedActivePage];
  const PageComponent = page?.component;
  const pageVideo = page?.video;

  useEffect(() => {
    if (!libraryOnly) return;
    if (activePage !== 'myVideos') dispatch(setActivePage('myVideos'));
    if (!videosAllowed && mySpaceTab === 'videos') dispatch(setMySpaceTab('images'));
    if (
      availableImageSources.length &&
      !availableImageSources.some(({ value }) => value === imageSource)
    ) {
      dispatch(setMySpaceImageSource(availableImageSources[0].value));
    }
  }, [
    activePage,
    availableImageSources,
    dispatch,
    imageSource,
    libraryOnly,
    mySpaceTab,
    videosAllowed,
  ]);

  useEffect(() => {
    if (activePage) {
      sessionStorage.setItem('adVideoActivePage', activePage);
    }
  }, [activePage]);

  useEffect(() => {
    if (libraryOnly) return;
    const pageHint = searchParams.get('page');
    if (!pageHint || !pageConfig[pageHint]) return;
    if (pageHint === 'ai-ads' && searchParams.get('id')) {
      dispatch(setAIAdsStep('generation'));
    }
    if (activePage !== pageHint) dispatch(setActivePage(pageHint));
  }, [activePage, dispatch, libraryOnly, searchParams]);

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
    if (fromRecreate) {
      exitRecreateToMySpace();
      return;
    }

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
        toast.error('Image and script is generating, please wait');
        return;
      }
      if (generatedData?.generatedImage && generatedData?.generatedScript && !hasAnyError) {
        emitter.emit('clone:request-discard');
        return;
      }
      setSearchParams({}, { replace: true });
      dispatch(setImageAndScript(null));
      dispatch(setFields({ brand_name: '', brandInfo: {}, selectedBrand: {} }));
      dispatch(setRecreateInputs(null));
    }
    if (activePage === 'ai-ads') {
      // Block back navigation while scenes are not fully ready:
      //   - initial gen in flight (no scripts yet)
      //   - some images still loading or failed (not all images ready)
      //   - any per-scene regen in flight
      const aiAdsScenes = aiAdsSceneData?.scenes || aiAdsSceneData?.data?.scenes || [];
      const isInitiallyLoading =
        currentAIAdsStep === 'generation' && aiAdsSceneLoading && aiAdsScenes.length === 0;
      const isRegenerating =
        currentAIAdsStep === 'generation' && aiAdsSceneLoading && aiAdsScenes.length > 0;
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
    const targetEl = document.getElementById('sidebar-my-space-button') || mySpaceIconRef.current;

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
    <div className="advideo-ui-layer relative flex h-[95vh] w-full flex-col">
      {/* {activePage !== 'myVideos' && <SavedFolderIcon />} */}

      {displayedActivePage === 'home' ? (
        <AdVideoHomeNew />
      ) : displayedActivePage === 'myVideos' ? (
        <>
          {/* Header */}
          <div className="flex w-full items-center justify-between gap-2 p-4 pr-5 2xl:pr-8 text-gray-900 dark:text-white">
            <div className="flex items-center gap-3">
              {!libraryOnly && (
                <button
                  onClick={handleBackNavigation}
                  className="flex items-center gap-2 text-xl 2xl:text-3xl"
                >
                  <ChevronLeft className="h-6.5 w-6.5 2xl:h-9 2xl:w-9" />
                  {page?.title}
                </button>
              )}

              {/* Tabs — visual style + position mirror Brand IQ's HeaderTabs */}
              <div className="relative flex items-center gap-0 rounded-full border border-black/10 bg-white/80 p-1 shadow-[0_2px_10px_rgba(0,0,0,0.04)] backdrop-blur-md dark:border-transparent dark:bg-[#0D0D0D]">
                {availableMySpaceTabs.map(({ id, label, Icon }) => {
                  const isActive = mySpaceTab === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => dispatch(setMySpaceTab(id))}
                      className={`2xl:text-13 relative flex items-center rounded-full px-3 py-1.5 text-[11px] font-semibold whitespace-nowrap transition-all duration-200 2xl:px-4.5 2xl:py-2 ${
                        isActive
                          ? 'text-zinc-900 font-bold dark:text-white'
                          : 'text-zinc-600 hover:text-zinc-900 dark:text-[#AFAFAF] dark:hover:text-white'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 2xl:gap-2">
                        <Icon className={`h-3.5 w-3.5 2xl:h-4.5 2xl:w-4.5 ${isActive ? 'text-zinc-900 dark:text-white' : 'text-zinc-500 dark:text-[#AFAFAF]'}`} />
                        <span>{label}</span>
                      </div>
                      {isActive && (
                        <motion.div
                          layoutId="mySpaceTabBg"
                          className="absolute inset-0 -z-10 rounded-full border border-black/5 bg-white shadow-[0_2px_8px_rgba(0,0,0,0.08),0_1px_2px_rgba(0,0,0,0.04)] dark:border-none dark:bg-gradient-to-br dark:from-[#3C3C3C] dark:to-[#3C3C3C] dark:shadow-none"
                          transition={{ type: 'spring', duration: 0.4 }}
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* Images tab: choose between the existing AdCreative gallery and
                  the AdFactory images API. Shown only on the Images tab. */}
              {mySpaceTab === 'images' && availableImageSources.length > 0 && (
                <CreativeFilterDropdown
                  options={availableImageSources}
                  label="Source"
                  value={availableImageSources.find((p) => p.value === imageSource)}
                  onChange={(value) => setImageSource(value)}
                  triggerClassName="adstudio-media-toolbar-control"
                />
              )}
              <DateRangeFilter onDateChange={handleDateChange} onClear={handleClearDates} />
              {mySpaceTab === 'videos' ? (
                <CreativeFilterDropdown
                  options={selectVideoType}
                  label="Filter"
                  value={selectVideoType.find((p) => p.value === videoType)}
                  onChange={(value) => setVideoType(value)}
                  onClear={() => setVideoType('')}
                  triggerClassName="adstudio-media-toolbar-control"
                />
              ) : imageSource === 'adCreative' ? (
                // The image-type filter only applies to the AdCreative gallery;
                // the AdFactory API doesn't support it, so it's hidden there.
                <CreativeFilterDropdown
                  options={selectImageType}
                  label="Filter"
                  value={selectImageType.find((p) => p.value === imageType)}
                  onChange={(value) => setImageType(value)}
                  onClear={() => setImageType('')}
                  triggerClassName="adstudio-media-toolbar-control"
                />
              ) : null}
              <div className="ml-1.5 2xl:ml-3">
                <ThemeToggle />
              </div>
            </div>
          </div>

          {mySpaceTab === 'images' && !availableImageSources.length ? (
            <div className="flex flex-1 items-center justify-center px-6 text-center">
              <div>
                <Library className="mx-auto h-8 w-8 text-zinc-500" />
                <p className="mt-3 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  No media collection is available
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  Your assigned features do not currently produce reusable media.
                </p>
              </div>
            </div>
          ) : mySpaceTab === 'images' ? (
            imageSource === 'adFactory' ? (
              <MyAdFactoryImagesPage startDate={startDate} endDate={endDate} />
            ) : imageSource === 'aiAssistant' ? (
              <MyAssistantImagesPage />
            ) : imageSource === 'claudeAI' ? (
              <MyClaudeImagesPage />
            ) : (
              <MyImagesPage imageType={imageType} startDate={startDate} endDate={endDate} />
            )
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
            <span
              ref={mySpaceIconRef}
              className="pointer-events-none fixed top-[700px] right-4 h-0 w-0"
            />
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
                  ? 'rounded-[30px] border border-black/5 bg-white/70 shadow-[0_2px_12px_rgba(0,0,0,0.03)] backdrop-blur-md dark:border-white/10 dark:bg-[#303030]/50 dark:shadow-none'
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
                  onClose={exitRecreateToMySpace}
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
