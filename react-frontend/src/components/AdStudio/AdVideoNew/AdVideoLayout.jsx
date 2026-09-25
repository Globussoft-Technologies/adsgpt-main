import { useSelector, useDispatch } from 'react-redux';
import { ChevronLeft, PlayCircle, Library, Images, Video, PanelLeft, Loader } from 'lucide-react';
import { SidebarTrigger } from '@/components/ui/sidebar';
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
import CloneYourAdPage from './pages/CloneYourAdPage';
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
import MyAllImagesPage from './pages/MyAllImagesPage';
import MyAdFactoryImagesPage from './pages/MyAdFactoryImagesPage';
import MyAssistantImagesPage from './pages/MyAssistantImagesPage';
import MyClaudeImagesPage from './pages/MyClaudeImagesPage';
import CreativeFilterDropdown from '@/components/layout/header/AdStudio/AdCreative/CreativeFilterDropdown';
import ThemeToggle from '@/components/layout/header/ThemeToggle';
import WorkspaceSwitcher from '@/components/workspace/WorkspaceSwitcher';
import { fetchProcessingCount } from '@/store/actions/adVideoNew/Advideoactions';
import { canUseWorkspaceFeature } from '@/utils/workspaceSession';
import { getMySpaceImages } from '@/apis/image/imageApi';

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
  'clone-ad': {
    title: 'Re Create Ad',
    component: CloneYourAdPage,
  },
  myVideos: {
    title: 'My Space',
    component: MyVideosPage,
  },
};

// Stands in for "no type filter" inside the Select; '' is reserved by Radix.
const ALL_VIDEO_TYPES = 'all';

const selectVideoType = [
  {
    // ALL_VIDEO_TYPES rather than '' because Radix reserves the empty string for
    // "no selection" and throws if a SelectItem carries it. The backend still
    // wants '' for "no type filter" (`if (type) filter[...]`), so the sentinel
    // is translated back at the dropdown's edge. It is first and it is the
    // default: the page opened with `videoType: ''` all along, which meant every
    // video was listed while the control showed no selection at all — a filter
    // that looked broken rather than one that was off.
    value: ALL_VIDEO_TYPES,
    label: 'All',
  },
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
  {
    value: 'clone_ad',
    label: 'Re Create Ad',
  },
  {
    // Clips rendered from an onboarding storyboard concept. They are produced by
    // the storyboard service rather than this app's own pipeline, and filed into
    // the library when they finish — see services/onboarding/mySpaceClip.js.
    value: 'storyboard',
    label: 'Storyboard',
  },
  {
    // Clips rebuilt from a template the user picked during onboarding. Filed
    // by the same code as Storyboard above, under its own type so the two stay
    // tellable apart in the library — see services/onboarding/mySpaceClip.js.
    value: 'template_recreate',
    label: 'Template Recreate',
  },
];

const selectImageType = [
  { value: 'ai_ads', label: 'AI Creatives' },
  // Images rebuilt from an onboarding template. They list under the AdCreative
  // SOURCE (that is where `mySpaceImagesService` puts everything in the
  // ImageGeneration collection), so the type filter is the only way to pick
  // them out. Deliberately not `recreate_ads`, which is AdLibrary's own.
  { value: 'template_recreate', label: 'Template Recreate' },
  { value: 'lifestyle', label: 'Lifestyle' },
  { value: 'product_shot', label: 'Product Shot' },
  { value: 'apps_saas', label: 'Apps & SaaS' },
  { value: 'brand_awareness', label: 'Brand Awareness' },
];

// MySpace → Images tab → which image source to browse.
const selectImageSource = [
  { value: 'all', label: 'All' },
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
        if (value === 'all') {
          return canUseWorkspaceFeature('adStudio.adCreative') || canUseWorkspaceFeature('adFactory');
        }
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
    ['b-roll', 'ugc', 'avatar', 'clone', 'clone-ad', 'ai-ads'].includes(searchParams.get('page'))
  );

  // Broader than `fromRecreate`, and used ONLY for the post-generate landing.
  // VideoCard's Recreate sends the user to one of these pages, so arriving on
  // one with a `?page=` hint means "this session started from a My Space card"
  // and the user expects to be put back on /my-space to watch it render.
  // `clone-ad` is deliberately excluded — its completion arrives on its own
  // socket event (cloneAdGenerateReady), which does not refresh the My Space
  // grid, so landing there would show a card that never updates.
  //
  // Kept separate from `fromRecreate` on purpose: `fromRecreate` also drives
  // the BACK button, and widening it would let clone/avatar skip their
  // "still generating, please wait" discard guards in handleBackNavigation.
  const [fromRecreateForLanding] = useState(() =>
    ['b-roll', 'ugc', 'avatar', 'clone', 'ai-ads'].includes(searchParams.get('page'))
  );

  const exitRecreateToMySpace = () => {
    setSearchParams({}, { replace: true });
    dispatch(setRecreateInputs(null));
    dispatch(setImageAndScript(null));
    dispatch(setAvatarStep('options'));
    dispatch(setCloneStep('upload'));
    dispatch(setMySpaceTab('videos'));
    dispatch(setActivePage('myVideos'));
    navigate('/my-space');
  };

  const exitToAdVideoHome = () => {
    setSearchParams({}, { replace: true });
    dispatch(setRecreateInputs(null));
    dispatch(setImageAndScript(null));
    dispatch(setAvatarStep('options'));
    dispatch(setCloneStep('upload'));
    dispatch(setActivePage('home'));
    navigate('/adstudio');
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

  // Bharath 2026-09-16: My Space always opened on Images, which is an empty
  // grid for anyone who has only ever made videos. The tab is now chosen from
  // whether the account has any images at all.
  //
  // The check has to finish BEFORE either grid mounts, because the ask was
  // explicitly "don't show any flashes of image tab" — deciding after
  // MyAllImagesPage has already rendered its empty state is exactly the flash
  // we are avoiding. So the tabs area holds a loader until `tabDecided`.
  //
  // Deliberately unfiltered — `source: 'all'`, no dates, no type: the question
  // is "does this account own a single image", not "does anything match the
  // filters sitting in the toolbar". `limit: 1` keeps it to one cheap row.
  //
  // Runs once per mount (the cached promise), so any tab the user picks
  // afterwards — or that `exitRecreateToMySpace` picks — is never
  // second-guessed. Caching the promise also lets React Strict Mode's second
  // effect subscribe to the in-flight probe after the first effect is cleaned
  // up, instead of leaving `tabDecided` false forever.
  const [tabDecided, setTabDecided] = useState(false);
  const tabProbePromise = useRef(null);

  useEffect(() => {
    if (displayedActivePage !== 'myVideos') return;

    // Nothing to switch TO (videos not licensed), or nothing to switch FROM
    // (no image source at all — that case already renders its own message).
    if (!videosAllowed || !availableImageSources.length) {
      setTabDecided(true);
      return;
    }

    let alive = true;
    if (!tabProbePromise.current) {
      tabProbePromise.current = getMySpaceImages({ source: 'all', limit: 1 });
    }

    tabProbePromise.current
      .then((res) => {
        if (!alive) return;
        const rows = Array.isArray(res?.data) ? res.data : [];
        if (!rows.length) dispatch(setMySpaceTab('videos'));
      })
      // A failed probe must not strand the user on a loader — fall through to
      // the existing default (Images) rather than blocking the page on it.
      .catch(() => {})
      .finally(() => {
        if (alive) setTabDecided(true);
      });

    return () => {
      // The re-run (dep change or StrictMode) re-subscribes to the cached
      // promise above, so it still reaches setTabDecided.
      alive = false;
    };
  }, [availableImageSources.length, dispatch, displayedActivePage, videosAllowed]);

  useEffect(() => {
    if (activePage) {
      sessionStorage.setItem('adVideoActivePage', activePage);
    }
  }, [activePage]);

  // `?page=` is a one-shot deep-link instruction, NOT a standing clamp.
  //
  // It used to depend on `activePage` and re-assert the hint whenever the two
  // drifted apart. That broke recreate-then-generate: `handleGenerate` clears
  // the query params (router state) and sets activePage to 'myVideos' (redux)
  // in the same tick. Those are two different external stores, so if the redux
  // update rendered before the URL change landed, this effect saw
  // activePage='myVideos' with pageHint still 'b-roll' and shoved the user
  // straight back onto the creation form. Recreate is the only entry point
  // that sets `?page=`, which is why a plain AdStudio generate never hit it.
  //
  // Honouring each hint exactly once removes the tug-of-war: a deep link still
  // opens its page, and nothing re-opens it behind a later navigation.
  const honouredPageHintRef = useRef(null);
  useEffect(() => {
    if (libraryOnly) return;
    const pageHint = searchParams.get('page');
    if (!pageHint || !pageConfig[pageHint]) {
      // Params cleared — let a future link to the same page be honoured again.
      honouredPageHintRef.current = null;
      return;
    }
    if (honouredPageHintRef.current === pageHint) return;
    honouredPageHintRef.current = pageHint;
    if (pageHint === 'ai-ads' && searchParams.get('id')) {
      dispatch(setAIAdsStep('generation'));
    }
    dispatch(setActivePage(pageHint));
  }, [dispatch, libraryOnly, searchParams]);

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
    if (activePage === 'clone-ad') {
      exitToAdVideoHome();
      return;
    }

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
    setSearchParams({}, { replace: true });
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

    // Recreate started on /my-space, so finish there rather than leaving the
    // user on /adstudio showing a My Space-shaped view under the wrong URL and
    // the wrong sidebar highlight. Plain AdStudio generations are unaffected —
    // they never carry a `?page=` hint, so this flag is false for them.
    if (fromRecreateForLanding) {
      dispatch(setRecreateInputs(null));
      navigate('/my-space');
    }
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
    <div className="advideo-ui-layer relative flex h-full w-full flex-col">
      {/* {activePage !== 'myVideos' && <SavedFolderIcon />} */}

      {displayedActivePage === 'home' ? (
        <AdVideoHomeNew />
      ) : displayedActivePage === 'myVideos' ? (
        <>
          {/* Header */}
          <div className="app-global-header my-space-header -mt-4 -mx-4 flex w-[calc(100%+2rem)] items-center justify-between text-gray-900 dark:text-white">
            <div className="left_header_container flex items-center">
              <SidebarTrigger
                aria-label="Open navigation"
                aria-controls="app-sidebar-navigation"
                className="close_open_ flex h-9 w-9 cursor-pointer items-center justify-center rounded-full p-1 hover:bg-[#EAE5DC] lg:hidden mr-0 sm:mr-1.5"
              >
                <PanelLeft className="h-5" aria-hidden="true" />
              </SidebarTrigger>
              <h1 className="app-global-header-title">
                My Space
              </h1>
              <div className="mx-2 h-5 w-[1.5px] shrink-0 bg-zinc-300 sm:mx-3 sm:h-6 md:mx-4 dark:bg-zinc-700" />

              {/* Tabs — visual style + position mirror Brand IQ's HeaderTabs.
                  Kept in the layout but invisible until the probe has answered,
                  so the selected pill cannot be seen jumping from Images to
                  Videos; `invisible` rather than unmounting keeps the header
                  from reflowing when it appears. */}
              <div
                className={`flex items-center gap-3 overflow-x-auto scroll-smooth pt-1 pb-2 select-none no-scrollbar sm:gap-4 md:gap-5 2xl:gap-6 ${
                  tabDecided ? '' : 'invisible'
                }`}
              >
                {availableMySpaceTabs.map(({ id, label, Icon }) => {
                  const isActive = mySpaceTab === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => dispatch(setMySpaceTab(id))}
                      className={`relative flex shrink-0 items-center justify-start py-1 text-xs font-medium whitespace-nowrap transition-colors select-none cursor-pointer sm:text-[13px] 2xl:text-[14.5px] ${
                        isActive
                          ? 'font-semibold text-zinc-950 dark:text-white'
                          : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 sm:gap-2">
                        <Icon className={`h-3.5 w-3.5 shrink-0 transition-colors sm:h-4 sm:w-4 2xl:h-[18px] 2xl:w-[18px] ${isActive ? 'text-zinc-950 stroke-[2.2] dark:text-white' : 'text-zinc-400 stroke-[1.8] dark:text-zinc-400'}`} />
                        <span>{label}</span>
                        {isActive && (
                          <motion.div
                            layoutId="mySpaceTabUnderline"
                            className="absolute -bottom-1.5 right-0 left-0 h-[2px] rounded-full bg-zinc-950 dark:bg-white"
                            transition={{ type: 'spring', stiffness: 450, damping: 35 }}
                          />
                        )}
                      </div>
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
              {mySpaceTab === 'videos' ? (
                <CreativeFilterDropdown
                  options={selectVideoType}
                  label="Filter"
                  value={selectVideoType.find(
                    (p) => p.value === (videoType || ALL_VIDEO_TYPES),
                  )}
                  onChange={(value) =>
                    setVideoType(value === ALL_VIDEO_TYPES ? '' : value)
                  }
                  onClear={() => setVideoType('')}
                  triggerClassName="adstudio-media-toolbar-control"
                />
              ) : null}
              <DateRangeFilter onDateChange={handleDateChange} onClear={handleClearDates} />
              {mySpaceTab === 'images' && imageSource === 'adCreative' ? (
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
              {/* TopHeader's floating switcher is suppressed on this view (it
                  would sit in the same top-right corner as this toolbar), so
                  a workspace member gets it here instead. No-ops for owners. */}
              <WorkspaceSwitcher />
              <ThemeToggle className="ml-1.5 2xl:ml-3" />
            </div>
          </div>

          {/* Holds the grid area until the image probe above has decided which
              tab to open, so neither grid can flash before the answer. Uses the
              grids' own spinner in the same spot (not a flex-1 centred box), so
              the hand-off to the grid's loader is seamless and nothing reflows. */}
          {/* The grids are `h-full` scrollers; without this bounded box they
              take 100% of the layout height *plus* the 64px header, the outer
              container overflows and scrolls, and the My Space header slides up. */}
          <div className="relative min-h-0 w-full flex-1">
          {!tabDecided ? (
            <div className="mt-6 flex w-full items-center justify-center">
              <Loader className="h-8 w-8 animate-spin opacity-60" />
            </div>
          ) : mySpaceTab === 'images' && !availableImageSources.length ? (
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
            imageSource === 'all' ? (
              <MyAllImagesPage startDate={startDate} endDate={endDate} />
            ) : imageSource === 'adFactory' ? (
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
          </div>
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
              className={`min-w-112.5 rounded-3xl transition-all duration-300 max-lg:max-h-[88vh] max-lg:overflow-y-auto 2xl:max-h-[85vh] ${
                activePage === 'ai-ads' && currentAIAdsStep === 'details'
                  ? 'scale-75 2xl:scale-100'
                  : 'h-fit scale-75 2xl:scale-100'
              } ${
                activePage !== 'ugc' && activePage !== 'clone-ad'
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
                (activePage === 'ai-ads' && currentAIAdsStep === 'generation') || activePage === 'clone-ad'
                  ? ''
                  : 'overflow-hidden max-lg:overflow-y-auto'
              }`}
            >
              {PageComponent && (
                <PageComponent
                  pageVideo={pageVideo}
                  handleGenerate={handleGenerate}
                  onClose={
                    activePage === 'clone-ad'
                      ? exitToAdVideoHome
                      : fromRecreate
                        ? exitRecreateToMySpace
                        : exitToAdVideoHome
                  }
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
