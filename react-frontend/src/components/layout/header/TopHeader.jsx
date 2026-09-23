import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart3,
  FileText,
  Image,
  Images,
  ListFilter,
  MessageCirclePlus,
  MessageSquarePlus,
  Plus,
  RefreshCcw,
  Search,
  Users,
  Video,
  Zap,
  Globe,
  Facebook,
  Instagram,
  Linkedin,
  Twitter,
  Music,
  Camera,
  Pin,
  NotebookPen,
  List,
  PanelLeft,
  MenuIcon,
  Save,
  X,
  SquarePen,
  SlidersHorizontal,
} from 'lucide-react';
import { useDispatch, useSelector } from 'react-redux';
import { setActiveAdStudioTab } from '@/store/reducers/adStudio/adStudioTabsSlice';
import { useLocation, useNavigate } from 'react-router-dom';
import { getHeaderName } from '@/utils/getHeaderName';
import HeaderTabs from './HeaderTabs';
import {
  setActiveBrandIQTab,
  setSelectedCompetitorBrand,
  setSelectedCompetitorPlatform,
  setAdLibraryFilters,
  setMyBrandsSearch,
} from '@/store/reducers/brandIQ/brandIQTabsSlice';
import AdLibraryFilterDropdown from './AdStudio/AdLibrary/AdLibraryFilterDropdown';
import { Button } from '@/components/ui/button';
import { resetAdCopySlice } from '@/store/reducers/adStudio/adCopySlice';
import { resetPromptSlice, setField } from '@/store/reducers/adStudio/promptSlice';
import { fetchSuggestions } from '@/store/actions/adStudio/adCopyActions';
import { createNewSession } from '@/store/reducers/adStudio/adHistorySlice';
import { Input } from '@/components/ui/input';
import AddNewBrandDialog from '@/components/BrandIQ/Actions/AddNewBrandDialog';
import BrandsDropdown, { getBrandColor } from './BrandIQ/Competitors/BrandsDropdown';
import AllPlateformDropdown from './BrandIQ/Competitors/AllPlateformDropdown';
import {
  resetAdCreativeSlice,
  setExploreCompetitor,
  setExplorePlatform,
  setExploreSearchTerm,
  setSkip,
} from '@/store/reducers/adStudio/adCreativeSlice';
import { fetchExploreAds } from '@/store/actions/adStudio/adCreativeActions';
import CreativeFilterDropdown from './AdStudio/AdCreative/CreativeFilterDropdown';
import SparkleDark from '@/assets/layouts/prompt/sparkle-dark.svg';
import { FaMeta } from 'react-icons/fa6';
import { FaGoogle, FaPinterest, FaReddit, FaYoutube } from 'react-icons/fa';
import { SiGoogleads } from 'react-icons/si';
import { AiFillLinkedin } from 'react-icons/ai';
import { RiTwitterXLine } from 'react-icons/ri';
import AdCreativeAction from '@/components/AdStudio/AdCreatives/Actions/AdCreativeAction';
import { resetAdVideoSlice } from '@/store/reducers/adStudio/adVideoSlice';
import { debounce } from 'lodash';
import { SidebarTrigger, useSidebar } from '@/components/ui/sidebar';
import { createNewSessionAddie } from '@/store/reducers/adInsights/Addie/addieHistorySlice';
import {
  resetAddieStates,
  setAddieConversation,
  setIsFreshUser,
  setShowWelcomePage,
  setScrollSkip,
} from '@/store/reducers/adInsights/Addie/AddieChatBotSlice';
import { getFaqData } from '@/store/actions/adInsights/addieActions';
import { resetAddiePromptSlice } from '@/store/reducers/adInsights/Addie/addiePromptSlice';
import WorkspaceSwitcher from '@/components/workspace/WorkspaceSwitcher';
import { canUseWorkspaceFeature } from '@/utils/workspaceSession';
const ENABLE_NEW_LAYOUT = import.meta.env.VITE_AUTO_GENERATED_PLAN_ID;
const AUTO_GENERATED_PLAN_ID = import.meta.env.VITE_AUTO_GENERATED_PLAN_ID;
const SELECTED_BRAND_STORAGE_PREFIX = 'adsgpt:selectedBrand';

// HIDE-MARK — intentionally-hidden header UI (Templates / Refresh buttons and
// the global theme toggle). Named flag avoids a literal `false &&`
// (no-constant-binary-expression); flip to re-enable.
const SHOW_HIDDEN_HEADER_UI = false;

import AddNewBrand from '@/components/BrandIQ/Actions/AddNewBrand';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import ThemeToggle from './ThemeToggle';
import AIAssistantHeaderActions from '@/components/AIAssistant/AIAssistantHeaderActions';
import ModeSwitch from '@/components/AdFactory/ModeSwitch';
import { IS_AD_FACTORY_V2 } from '@/utils/featureFlags';
import {
  selectUiMode as selectAdFactoryUiMode,
  setUiMode,
} from '@/store/reducers/adFactoryBrief/adFactoryBriefSlice';
const adStudioTabs = [
  { id: 'adCopy', label: 'Ad Copy', icon: SquarePen },
  { id: 'adCreativeNew', label: 'Ad Creative', icon: Image },
  { id: 'adVideoNew', label: 'Ad Video', icon: Video },
  { id: 'adLibrary', label: 'Ad Library', icon: Images },
];
const brandIQTabs = [
  { id: 'myBrands', label: 'My Brands', icon: Zap },
  { id: 'competitors', label: 'Competitors', icon: Users },
  // { id: 'Gallery', label: 'Gallery', icon: Images },
  // { id: 'analytics', label: 'Analytics', icon: BarChart3 },
];

const adStudioTabFeatures = {
  adCopy: 'adStudio.adCopy',
  adCreative: 'adStudio.adCreative',
  adCreativeNew: 'adStudio.adCreative',
  adVideo: 'adStudio.adVideo',
  adVideoNew: 'adStudio.adVideo',
  adLibrary: 'adStudio.adLibrary',
};

const brandIqTabFeatures = {
  myBrands: 'brandIq.myBrands',
  competitors: 'brandIq.competitors',
};

const brandOptions = [
  { value: 'all-brands', label: 'All Brands' },
  { value: 'zomato', label: 'Zomato' },
  { value: 'swiggy', label: 'Swiggy' },
  { value: 'ubereats', label: 'Uber Eats' },
  { value: 'dominos', label: 'Domino’s' },
  { value: 'pizza-hut', label: 'Pizza Hut' },
  { value: 'kfc', label: 'KFC' },
  { value: 'mcdonalds', label: 'McDonald’s' },
  { value: 'starbucks', label: 'Starbucks' },
];

const adPlatformOptions = [
  { value: 'all-platforms', label: 'All Platforms', icon: Globe },
  { value: 'google-ads', label: 'Google Ads', icon: Search },
  { value: 'facebook-ads', label: 'Facebook Ads', icon: Facebook },
  { value: 'instagram-ads', label: 'Instagram Ads', icon: Instagram },
  { value: 'youtube-ads', label: 'YouTube Ads', icon: FaYoutube },
  // { value: 'linkedin-ads', label: 'LinkedIn Ads', icon: Linkedin },
  // { value: 'twitter-ads', label: 'Twitter Ads', icon: Twitter },
  // { value: 'tiktok-ads', label: 'TikTok Ads', icon: Music },
  // { value: 'snapchat-ads', label: 'Snapchat Ads', icon: Camera },
  // { value: 'pinterest-ads', label: 'Pinterest Ads', icon: Pin },
];

const selectPlateformsOptions = [
  {
    value: 'meta',
    Icon: (
      <FaMeta className="!h-3 !w-3 text-zinc-700 transition-colors group-hover:text-zinc-950 2xl:!h-4 2xl:!w-4 dark:text-[#AFAFAF] dark:group-hover:text-white" />
    ),
    label: 'Meta Ads',
  },
  {
    value: 'youtube',
    Icon: (
      <FaYoutube className="!h-3 !w-3 text-zinc-700 transition-colors group-hover:text-zinc-950 2xl:!h-4 2xl:!w-4 dark:text-[#AFAFAF] dark:group-hover:text-white" />
    ),
    label: 'Youtube Ads',
  },
  // {
  //   value: 'google',
  //   Icon: <Search className="!h-3 !w-3 text-zinc-700 transition-colors group-hover:text-zinc-950 2xl:!h-4 2xl:!w-4 dark:text-[#AFAFAF] dark:group-hover:text-white" />,
  //   label: 'Google Search Ads',
  // },
  // {
  //   value: 'google_performance_max_ads',
  //   Icon: <FaGoogle className="!h-3 !w-3 text-zinc-700 transition-colors group-hover:text-zinc-950 2xl:!h-4 2xl:!w-4 dark:text-[#AFAFAF] dark:group-hover:text-white" />,
  //   label: 'Google Performance Max Ads',
  // },
  {
    value: 'google_display_ads',
    Icon: (
      <SiGoogleads className="!h-3 !w-3 text-zinc-700 transition-colors group-hover:text-zinc-950 2xl:!h-4 2xl:!w-4 dark:text-[#AFAFAF] dark:group-hover:text-white" />
    ),
    label: 'Google Display Ads',
  },

  {
    value: 'linkedin',
    Icon: (
      <AiFillLinkedin className="!h-3 !w-3 text-zinc-700 transition-colors group-hover:text-zinc-950 2xl:!h-4 2xl:!w-4 dark:text-[#AFAFAF] dark:group-hover:text-white" />
    ),
    label: 'LinkedIn Ads',
  },
  // {
  //   value: 'twitter',
  //   Icon: <RiTwitterXLine className="!h-3 !w-3 text-zinc-700 transition-colors group-hover:text-zinc-950 2xl:!h-4 2xl:!w-4 dark:text-[#AFAFAF] dark:group-hover:text-white" />,
  //   label: 'Twitter Ads',
  // },
  {
    value: 'pinterest',
    Icon: (
      <FaPinterest className="!h-3 !w-3 text-zinc-700 transition-colors group-hover:text-zinc-950 2xl:!h-4 2xl:!w-4 dark:text-[#AFAFAF] dark:group-hover:text-white" />
    ),
    label: 'Pinterest Ads',
  },
  {
    value: 'reddit',
    Icon: (
      <FaReddit className="!h-3 !w-3 text-zinc-700 transition-colors group-hover:text-zinc-950 2xl:!h-4 2xl:!w-4 dark:text-[#AFAFAF] dark:group-hover:text-white" />
    ),
    label: 'Reddit Ads',
  },
  // {
  //   value: 'google_video_ads',
  //   Icon: <Video className="!h-3 !w-3 text-zinc-700 transition-colors group-hover:text-zinc-950 2xl:!h-4 2xl:!w-4 dark:text-[#AFAFAF] dark:group-hover:text-white" />,
  //   label: 'Google Video Ads',
  // },
];

export default function TopHeader() {
  const location = useLocation();
  const navigate = useNavigate();
  const currentRoute = location.pathname;

  const [selectedBrand, setSelectedBrand] = useState(brandOptions[0]);
  const [selectedPlateform, setSelectedPlateform] = useState(adPlatformOptions[0]);

  const { isMobile, openMobile } = useSidebar();

  const headerName = useMemo(
    () => getHeaderName(location.pathname),
    [location.pathname] // re-runs every time pathname changes
  );
  const { userData } = useSelector((state) => state.socket);
  const adFactoryUiMode = useSelector(selectAdFactoryUiMode);
  // HIDE-MARK — adStudioTabs is defined statically above
  const activeAdStudioTabId = useSelector((state) => state.adStudioTabs.activeAdStudioTabId);
  const {
    myBrands,
    myBrandsSearch,
    activeBrandIQTabId,
    selectedCompetitorBrand,
    selectedCompetitorPlatform,
  } = useSelector((state) => state.brandIQTabs);
  const dispatch = useDispatch();
  const [cachedBrandSnapshot, setCachedBrandSnapshot] = useState(() => {
    try {
      const raw = localStorage.getItem('adsgpt:last_active_brand_snapshot');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });
  const visibleAdStudioTabs = useMemo(
    () => adStudioTabs.filter((tab) => canUseWorkspaceFeature(adStudioTabFeatures[tab.id])),
    []
  );
  const visibleBrandIqTabs = useMemo(
    () => brandIQTabs.filter((tab) => canUseWorkspaceFeature(brandIqTabFeatures[tab.id])),
    []
  );
  const {
    conversations: creativeConversations,
    exploreCompetitor,
    explorePlatform,
    exploreSearchTerm,
  } = useSelector((state) => state.adCreative);

  const { activePage } = useSelector((state) => state.adVideoNew);
  const adCreativeNewActivePage = useSelector(
    (state) => state.adStudioTabs.adCreativeNewActivePage
  );
  const adLibraryFilters = useSelector((state) => state.brandIQTabs.adLibraryFilters);
  const [adLibrarySearch, setAdLibrarySearch] = useState(adLibraryFilters?.searchQuery || '');

  useEffect(() => {
    setAdLibrarySearch(adLibraryFilters?.searchQuery || '');
  }, [adLibraryFilters?.searchQuery]);

  const submitAdLibrarySearch = () => {
    dispatch(setAdLibraryFilters({ searchQuery: adLibrarySearch.trim() }));
  };

  useEffect(() => {
    if (
      currentRoute === '/adstudio' &&
      visibleAdStudioTabs.length &&
      !visibleAdStudioTabs.some(({ id }) => id === activeAdStudioTabId)
    ) {
      dispatch(setActiveAdStudioTab(visibleAdStudioTabs[0].id));
    }
  }, [activeAdStudioTabId, currentRoute, dispatch, visibleAdStudioTabs]);

  useEffect(() => {
    if (
      currentRoute === '/brandiq' &&
      visibleBrandIqTabs.length &&
      !visibleBrandIqTabs.some(({ id }) => id === activeBrandIQTabId)
    ) {
      dispatch(setActiveBrandIQTab(visibleBrandIqTabs[0].id));
    }
  }, [activeBrandIQTabId, currentRoute, dispatch, visibleBrandIqTabs]);

  const hideHeader =
    currentRoute === '/meta-ads' ||
    currentRoute === '/google-ads' ||
    currentRoute === '/tiktok-ads' ||
    currentRoute === '/autopilot/meta' ||
    currentRoute === '/my-space' ||
    (currentRoute === '/adstudio' &&
      activeAdStudioTabId === 'adVideoNew' &&
      activePage !== 'home') ||
    (currentRoute === '/adstudio' &&
      activeAdStudioTabId === 'adCreativeNew' &&
      adCreativeNewActivePage !== 'home');

  const renderMobileSidebarTrigger = (className = '') => (
    <SidebarTrigger
      aria-label="Open navigation"
      aria-controls="app-sidebar-navigation"
      aria-expanded={openMobile}
      className={`close_open_ flex h-9 w-9 cursor-pointer items-center justify-center rounded-full p-1 hover:bg-[#EAE5DC] lg:hidden ${className}`}
    >
      <PanelLeft className="h-5" aria-hidden="true" />
    </SidebarTrigger>
  );

  const resetMap = {
    adCopy: resetAdCopySlice,
    adCreative: resetAdCreativeSlice,
    adVideo: resetAdVideoSlice,
  };

  const handleNewChatClick = () => {
    dispatch(createNewSession({ tab: activeAdStudioTabId }));
    dispatch(resetMap[activeAdStudioTabId]());
    dispatch(resetPromptSlice());
    dispatch(fetchSuggestions());
    dispatch(fetchExploreAds());
  };

  // Store the full selected option object for platform
  const handlePlatformChange = (selectedValue) => {
    dispatch(setExplorePlatform(selectedValue));
  };

  const isFirstRender = useRef(true);

  useEffect(() => {
    const esNetworks = {
      google: ['google'],
      google_performance_max_ads: ['google'],
      google_display_ads: ['google_display_ads'],
      google_video_ads: ['google'],
      meta: ['facebook', 'instagram'],
      youtube: ['youtube'],
      pinterest: ['pinterest'],
      linkedin: ['linkedin'],
      reddit: ['reddit'],
    };

    const fetchAds = () => {
      dispatch(setSkip(0));
      dispatch(fetchExploreAds());
    };

    const debouncedFetch = debounce(fetchAds, 1000);

    // Case 1: platform change → immediate fetch
    if (explorePlatform && esNetworks[explorePlatform]) {
      // fetchAds();
      debouncedFetch();
    }
    // Case 2: competitor length ≥ 3 → debounce 500ms
    else if (exploreCompetitor && exploreCompetitor.length >= 3) {
      debouncedFetch();
    }
    // Case 3: competitor empty → debounce 1000ms
    else if (exploreCompetitor.length === 0) {
      if (!isFirstRender.current) {
        debouncedFetch();
      }
    }

    isFirstRender.current = false;

    return () => {
      debouncedFetch.cancel();
    };
  }, [explorePlatform, exploreCompetitor, dispatch]);

  const [isShowHeadersTabs, setIsShowHeadersTabs] = useState(true);
  const mobileTabsOpenRef = useRef(null);

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 1024) {
        setIsShowHeadersTabs(true);
      } else {
        setIsShowHeadersTabs(false);
      }
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [mobileTabsOpenRef]);

  // Restore the user's last selected brand after the current brand list loads.
  // Persist only the stable ID; the full, current brand object always comes
  // from myBrands so deleted or updated brands cannot leave stale Redux data.
  useEffect(() => {
    if (!Array.isArray(myBrands) || myBrands.length === 0) return;

    const selectedBrandIsAvailable = myBrands.some(
      (brand) => brand.id === selectedCompetitorBrand?.id
    );
    if (selectedBrandIsAvailable) return;

    let storedBrandId = '';
    try {
      if (userData?.user_id) {
        storedBrandId =
          localStorage.getItem(`${SELECTED_BRAND_STORAGE_PREFIX}:${userData.user_id}`) || '';
      }
      if (!storedBrandId) {
        storedBrandId = localStorage.getItem('adsgpt:selectedBrandId') || '';
      }
      if (!storedBrandId) {
        const raw = localStorage.getItem('adsgpt:last_active_brand_snapshot');
        if (raw) {
          const parsed = JSON.parse(raw);
          storedBrandId = parsed?.value || '';
        }
      }
    } catch {
      // Storage may be unavailable in restricted browsing contexts.
    }

    const restoredBrand = myBrands.find((brand) => brand.id === storedBrandId);
    dispatch(setSelectedCompetitorBrand(restoredBrand || myBrands[0]));
  }, [dispatch, myBrands, selectedCompetitorBrand?.id, userData?.user_id]);

  // Keep the selection refresh-safe for this user. Brand existence is checked
  // first so an obsolete/deleted ID is never written back to storage.
  useEffect(() => {
    if (!selectedCompetitorBrand?.id || !Array.isArray(myBrands) || myBrands.length === 0) return;
    if (!myBrands.some((brand) => brand.id === selectedCompetitorBrand.id)) return;

    try {
      if (userData?.user_id) {
        localStorage.setItem(
          `${SELECTED_BRAND_STORAGE_PREFIX}:${userData.user_id}`,
          selectedCompetitorBrand.id
        );
      }
      localStorage.setItem('adsgpt:selectedBrandId', selectedCompetitorBrand.id);

      const brandName = selectedCompetitorBrand.name || 'Unnamed';
      const resolvedColor = getBrandColor(
        brandName,
        selectedCompetitorBrand.color ||
          selectedCompetitorBrand.brandColors?.[0] ||
          selectedCompetitorBrand.colors?.[0] ||
          selectedCompetitorBrand.brandGuidelines?.colorPalette?.[0] ||
          ''
      );

      const snapshot = {
        value: selectedCompetitorBrand.id,
        label: brandName,
        logoUrl:
          selectedCompetitorBrand.logoUrls?.[0] ||
          selectedCompetitorBrand.iconUrl ||
          selectedCompetitorBrand.logoUrl ||
          selectedCompetitorBrand.logo ||
          '',
        color: resolvedColor,
      };
      localStorage.setItem('adsgpt:last_active_brand_snapshot', JSON.stringify(snapshot));
      setCachedBrandSnapshot(snapshot);
    } catch {
      // Redux selection still works when browser storage is unavailable.
    }
  }, [myBrands, selectedCompetitorBrand, userData?.user_id]);

  const isMySpaceView =
    currentRoute === '/my-space' ||
    (currentRoute === '/adstudio' &&
      activeAdStudioTabId === 'adVideoNew' &&
      activePage === 'myVideos');

  if (currentRoute !== '/adfactory-demo' && hideHeader) {
    const mobileNavigationControl = (
      <div className="fixed top-3 left-3 z-[60] lg:hidden">
        {renderMobileSidebarTrigger()}
      </div>
    );

    // Meta, Google, and TikTok Ads Manager include controls in their own row so they
    // participate in layout instead of floating over provider controls.
    if (
      currentRoute === '/meta-ads' ||
      currentRoute === '/autopilot/meta' ||
      currentRoute === '/tiktok-ads' ||
      currentRoute === '/google-ads' ||
      currentRoute === '/autopilot/google'
    )
      return mobileNavigationControl;

    return (
      <>
        {mobileNavigationControl}
        <div className="pointer-events-none fixed top-4 right-5 z-[60] flex items-center gap-2">
          <div className="pointer-events-auto flex items-center gap-2">
            {/* My Space renders its own toolbar in this same top-right corner
                (AdVideoLayout.jsx), so the switcher is placed inline there
                instead — same reason ThemeToggle is already skipped here. */}
            {!isMySpaceView && <WorkspaceSwitcher />}
            {SHOW_HIDDEN_HEADER_UI && !isMySpaceView && currentRoute !== '/autopilot/meta' && <ThemeToggle />}
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      {currentRoute !== '/adfactory-demo' && !hideHeader && (
        <div
          className="app-global-header app-top-header lm-header-surface sticky top-0 z-50 flex w-full items-center justify-between dark:bg-transparent dark:backdrop-blur-none"
        >
          <div className="left_header_container flex min-w-0 items-center gap-1 sm:gap-2">
            {renderMobileSidebarTrigger('mr-0 sm:mr-1.5')}
            {/* Left Title */}
            {currentRoute !== '/adfactory-demo' && (
              <div className="flex shrink-0 items-center">
                <h1
                  className="app-global-header-title"
                >
                  {headerName}
                </h1>
                {(currentRoute === '/adstudio' ||
                  currentRoute === '/adfactory' ||
                  (currentRoute === '/brandiq' && visibleBrandIqTabs?.length > 0)) && (
                  <div className="mx-2 sm:mx-3 md:mx-4 h-5 sm:h-6 w-[1.5px] shrink-0 bg-zinc-300 dark:bg-zinc-700" />
                )}
              </div>
            )}
            {currentRoute === '/adfactory' && IS_AD_FACTORY_V2 && (
              <div>
                <ModeSwitch
                  mode={adFactoryUiMode}
                  onChange={(next) => {
                    if (next === adFactoryUiMode) return;
                    dispatch(setUiMode({ uiMode: next }));
                    const params = new URLSearchParams(location.search);
                    params.delete('campaignId');
                    params.delete('briefId');
                    const search = params.toString();
                    navigate(
                      { pathname: '/adfactory', search: search ? `?${search}` : '' },
                      { replace: true },
                    );
                  }}
                />
              </div>
            )}
            {currentRoute === '/adstudio' && (
              <HeaderTabs
                isShowHeadersTabs={isShowHeadersTabs}
                setIsShowHeadersTabs={setIsShowHeadersTabs}
                tabs={visibleAdStudioTabs}
                mobileTabsOpenRef={mobileTabsOpenRef}
                activeTabId={activeAdStudioTabId}
                onTabChange={(id) => dispatch(setActiveAdStudioTab(id))}
              />
            )}
            {currentRoute === '/brandiq' && (
              <HeaderTabs
                isShowHeadersTabs={isShowHeadersTabs}
                setIsShowHeadersTabs={setIsShowHeadersTabs}
                tabs={visibleBrandIqTabs}
                mobileTabsOpenRef={mobileTabsOpenRef}
                activeTabId={activeBrandIQTabId}
                onTabChange={(id) => dispatch(setActiveBrandIQTab(id))}
              />
            )}
          </div>

          <div
            id="tour_filter_adcreatives_prompt"
            className="right_header_mybrands relative flex shrink-0 items-center gap-1.5 sm:gap-2"
          >
            <WorkspaceSwitcher />
            {/* AI Assistant — History + New Chat */}
            {currentRoute === '/assistant' && <AIAssistantHeaderActions />}

            {/* for AdStudio */}
            {currentRoute === '/adstudio' && activeAdStudioTabId === 'adCopy' && (
              <>
                <Button
                  variant="ghost"
                  onClick={handleNewChatClick}
                  className="backdrop-blur-100 relative flex h-8 items-center gap-2 rounded-full border border-black/10 bg-white/70 text-xs text-zinc-700 transition-colors hover:text-black has-[>svg]:px-4 2xl:h-9 2xl:px-5 2xl:text-sm dark:border-white/20 dark:bg-[#0D0D0D]/50 dark:text-[#AFAFAF] dark:hover:text-white"
                >
                  <MessageCirclePlus className="h-4 w-4 2xl:h-5 2xl:w-5" />
                  <span>New Chat</span>
                </Button>
                <div className="mx-1.5 h-5 w-[1px] shrink-0 bg-black/15 dark:bg-white/20" />
              </>
            )}
            {currentRoute === '/adstudio' &&
              activeAdStudioTabId === 'adCreative' &&
              Array.isArray(creativeConversations) &&
              creativeConversations.length > 0 && (
                <>
                  <Button
                    variant="ghost"
                    onClick={handleNewChatClick}
                    className="backdrop-blur-100 relative flex h-8 items-center gap-2 rounded-full border border-black/10 bg-white/70 text-xs text-zinc-700 transition-colors hover:text-black has-[>svg]:px-4 2xl:h-9 2xl:px-5 2xl:text-sm dark:border-white/20 dark:bg-[#0D0D0D]/50 dark:text-[#AFAFAF] dark:hover:text-white"
                  >
                    <MessageCirclePlus className="h-4 w-4 2xl:h-5 2xl:w-5" />
                    <span>New Chat</span>
                  </Button>
                  <div className="mx-1.5 h-5 w-[1px] shrink-0 bg-black/15 dark:bg-white/20" />
                </>
              )}
            {currentRoute === '/adstudio' &&
              activeAdStudioTabId === 'adCreative' &&
              Array.isArray(creativeConversations) &&
              creativeConversations.length === 0 && (
                <>
                  {/* <div className="backdrop-blur-100 relative flex min-w-[150px] items-center gap-2 rounded-full border border-white/20 bg-[#0D0D0D]/50 px-3 py-2 text-[#AFAFAF] transition-colors 2xl:px-5 2xl:pr-3 2xl:text-sm">
              <Input
                type="text"
                placeholder={'Search your competitors'}
                className="h-full w-14 flex-1 border-none !bg-transparent px-0 py-[2px] !text-[9px] text-[#969696] placeholder:!text-[9px] placeholder:text-[#969696] focus-visible:ring-0 focus-visible:ring-offset-0 lg:w-auto 2xl:!text-sm 2xl:placeholder:!text-sm"
                onChange={(e) => {
                  dispatch(setExploreCompetitor(e.target.value));
                }}
                value={exploreCompetitor}
                // onKeyDown={(event) => {
                //   if (event.key === 'Enter' && !event.shiftKey && exploreCompetitor) {
                //     event.preventDefault();
                //     dispatch(setSkip(0));
                //     dispatch(fetchExploreAds());
                //   }
                // }}
              />
              <Search
                className="h-3 w-3 cursor-pointer hover:text-white 2xl:h-4 2xl:w-4"
                onClick={() => {
                  dispatch(setSkip(0));
                  dispatch(fetchExploreAds());
                }}
              />
            </div> */}

                  {/* ! search field */}
                  <div className="ad-library-search relative flex min-w-[150px] items-center gap-2 rounded-full px-3 py-1.5 text-zinc-600 transition-colors sm:py-2 md:left-8 md:scale-[0.8] 2xl:inset-0 2xl:scale-100 2xl:px-5 2xl:pr-3 2xl:text-sm dark:text-[#AFAFAF]">
                    <div className="flex flex-shrink-0 items-center">
                      <Search
                        className="h-4 w-4 cursor-pointer hover:text-white 2xl:h-4 2xl:w-4"
                        onClick={() => {
                          dispatch(setSkip(0));
                          dispatch(fetchExploreAds());
                        }}
                      />
                    </div>
                    <input
                      type="text"
                      placeholder="Search.."
                      className="ad-library-search-input w-full border-none bg-transparent text-sm text-zinc-800 placeholder:text-zinc-500 focus:outline-none dark:text-[#D1D1D1] dark:placeholder:text-[#777777]"
                      value={exploreCompetitor}
                      onChange={(e) => dispatch(setExploreCompetitor(e.target.value))}
                    />
                    <div className="flex shrink-0 items-center gap-1">
                      {!isMobile ? (
                        <>
                          {['competitor', 'keyword'].map((type) => {
                            const isActive = (exploreSearchTerm || 'competitor') === type;
                            return (
                              <button
                                key={type}
                                className={`rounded-full px-3 py-1 text-xs capitalize transition-colors duration-150 cursor-pointer ${
                                  isActive
                                    ? 'bg-[#E4E4E7] font-semibold text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100'
                                    : 'text-zinc-500 hover:text-zinc-800 dark:text-[#888888] dark:hover:text-zinc-200 font-normal'
                                }`}
                                onClick={() => {
                                  dispatch(setExploreSearchTerm(type));
                                  dispatch(setSkip(0));
                                  dispatch(fetchExploreAds());
                                }}
                              >
                                {type === 'competitor' ? 'Competitor' : 'Keyword'}
                              </button>
                            );
                          })}
                        </>
                      ) : (
                        <Popover>
                          <PopoverTrigger asChild>
                            <MenuIcon className="h-4 w-4 cursor-pointer hover:text-white 2xl:h-4 2xl:w-4" />
                          </PopoverTrigger>
                          <PopoverContent className="flex w-fit flex-col gap-2 overflow-hidden rounded-lg border border-white/10 bg-[#0D0D0D]/50 p-2 shadow-lg backdrop-blur-[50px] transition-all duration-150">
                            {['competitor', 'keyword'].map((type) => {
                              const isActive = (exploreSearchTerm || 'competitor') === type;
                              return (
                                <button
                                  key={type}
                                  className={`rounded-full px-3 py-1 text-xs capitalize transition-colors duration-150 ${
                                    isActive
                                      ? 'bg-[#262626] text-white'
                                      : 'text-[#888888] hover:text-white'
                                  }`}
                                  onClick={() => {
                                    dispatch(setExploreSearchTerm(type));
                                    dispatch(setSkip(0));
                                    dispatch(fetchExploreAds());
                                  }}
                                >
                                  {type === 'competitor' ? 'Competitor' : 'Keyword'}
                                </button>
                              );
                            })}
                          </PopoverContent>
                        </Popover>
                      )}
                    </div>
                  </div>

                  {/* Platform select */}
                  <CreativeFilterDropdown
                    options={selectPlateformsOptions}
                    label="Platform"
                    value={selectPlateformsOptions.find((p) => p.value === explorePlatform)}
                    onChange={handlePlatformChange}
                  />
                </>
              )}

            {/* for AdStudio Ad Library */}
            {currentRoute === '/adstudio' && activeAdStudioTabId === 'adLibrary' && (
              <>
                {/* Search field with Competitor and Keyword selector */}
                <div className="ad-library-search relative flex h-9 min-w-0 flex-1 sm:flex-initial sm:min-w-[190px] md:min-w-[240px] lg:min-w-[300px] 2xl:min-w-[380px] max-w-[420px] items-center gap-1.5 sm:gap-2 rounded-full px-2.5 sm:px-3 py-1 text-zinc-700 backdrop-blur-md transition-all duration-200 dark:text-zinc-200">
                  <button
                    type="button"
                    aria-label="Search Ad Library"
                    onClick={submitAdLibrarySearch}
                    className="flex shrink-0 items-center justify-center text-zinc-400 transition-colors hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-white"
                  >
                    <Search className="h-4 w-4" />
                  </button>
                  <input
                    type="text"
                    placeholder="Search.."
                    aria-label="Search ads"
                    className="ad-library-search-input min-w-0 flex-1 border-none bg-transparent text-xs text-zinc-800 placeholder:text-zinc-400 focus:outline-none 2xl:text-sm dark:text-zinc-100 dark:placeholder:text-zinc-500"
                    value={adLibrarySearch}
                    maxLength={120}
                    onChange={(e) => setAdLibrarySearch(e.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') submitAdLibrarySearch();
                      if (event.key === 'Escape') {
                        setAdLibrarySearch('');
                        dispatch(setAdLibraryFilters({ searchQuery: '' }));
                      }
                    }}
                  />
                  {adLibrarySearch && (
                    <button
                      type="button"
                      aria-label="Clear Ad Library search"
                      onClick={() => {
                        setAdLibrarySearch('');
                        dispatch(setAdLibraryFilters({ searchQuery: '' }));
                      }}
                      className="flex shrink-0 items-center justify-center text-zinc-400 transition-colors hover:text-zinc-700 dark:hover:text-white"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <div className="flex shrink-0 items-center gap-1">
                    {!isMobile ? (
                      <>
                        {['competitor', 'keyword'].map((type) => {
                          const isActive = (adLibraryFilters?.searchType || 'competitor') === type;
                          return (
                            <button
                              key={type}
                              type="button"
                              className={`rounded-full px-2 sm:px-3 py-0.5 sm:py-1 text-[11px] sm:text-xs capitalize transition-colors duration-150 cursor-pointer ${
                                isActive
                                  ? 'bg-[#E4E4E7] font-semibold text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100'
                                  : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-white font-normal'
                              }`}
                              onClick={() => {
                                dispatch(
                                  setAdLibraryFilters({
                                    searchType: type,
                                    searchQuery: adLibrarySearch.trim(),
                                  })
                                );
                              }}
                            >
                              {type === 'competitor' ? 'Competitor' : 'Keyword'}
                            </button>
                          );
                        })}
                      </>
                    ) : (
                      <Popover>
                        <PopoverTrigger asChild>
                          <MenuIcon className="h-4 w-4 cursor-pointer hover:text-white 2xl:h-4 2xl:w-4" />
                        </PopoverTrigger>
                        <PopoverContent className="flex w-fit flex-col gap-2 overflow-hidden rounded-lg border border-white/10 bg-[#0D0D0D]/50 p-2 shadow-lg backdrop-blur-[50px] transition-all duration-150">
                          {['competitor', 'keyword'].map((type) => {
                            const isActive = (adLibraryFilters?.searchType || 'competitor') === type;
                            return (
                              <button
                                key={type}
                                type="button"
                                className={`rounded-full px-3 py-1 text-xs capitalize transition-colors duration-150 ${
                                  isActive
                                    ? 'bg-[#262626] text-white'
                                    : 'text-[#888888] hover:text-white'
                                }`}
                                onClick={() => {
                                  dispatch(
                                    setAdLibraryFilters({
                                      searchType: type,
                                      searchQuery: adLibrarySearch.trim(),
                                    })
                                  );
                                }}
                              >
                                {type === 'competitor' ? 'Competitor' : 'Keyword'}
                              </button>
                            );
                          })}
                        </PopoverContent>
                      </Popover>
                    )}
                  </div>
                </div>

                {/* Modern Platform Filter Dropdown */}
                <AdLibraryFilterDropdown iconOnly />

                {/* Vertical separator between filter button and brand switcher */}
                <div className="mx-1.5 h-5 w-[1px] shrink-0 bg-black/15 dark:bg-white/20" />
              </>
            )}

            {/* Brand Switcher for all AdStudio sections (Ad Copy, Ad Creative, Ad Video, Ad Library) */}
            {currentRoute === '/adstudio' && (
              <BrandsDropdown
                compact
                singleAvatar
                subtle
                options={
                  Array.isArray(myBrands) && myBrands.length > 0
                    ? myBrands.map((b) => ({
                        value: b.id,
                        label: b.name || 'Unnamed',
                        logoUrl: b.logoUrls?.[0] || b.iconUrl || b.logoUrl || b.logo || '',
                        color:
                          b.color ||
                          b.brandColors?.[0] ||
                          b.colors?.[0] ||
                          b.brandGuidelines?.colorPalette?.[0] ||
                          '',
                      }))
                    : cachedBrandSnapshot
                      ? [cachedBrandSnapshot]
                      : []
                }
                value={
                  selectedCompetitorBrand
                    ? {
                        value: selectedCompetitorBrand.id,
                        label: selectedCompetitorBrand.name || 'Unnamed',
                        logoUrl:
                          selectedCompetitorBrand.logoUrls?.[0] ||
                          selectedCompetitorBrand.iconUrl ||
                          selectedCompetitorBrand.logoUrl ||
                          selectedCompetitorBrand.logo ||
                          '',
                        color:
                          selectedCompetitorBrand.color ||
                          selectedCompetitorBrand.brandColors?.[0] ||
                          selectedCompetitorBrand.colors?.[0] ||
                          selectedCompetitorBrand.brandGuidelines?.colorPalette?.[0] ||
                          '',
                      }
                    : Array.isArray(myBrands) && myBrands[0]
                      ? {
                          value: myBrands[0].id,
                          label: myBrands[0].name || 'Unnamed',
                          logoUrl:
                            myBrands[0].logoUrls?.[0] ||
                            myBrands[0].iconUrl ||
                            myBrands[0].logoUrl ||
                            myBrands[0].logo ||
                            '',
                          color:
                            myBrands[0].color ||
                            myBrands[0].brandColors?.[0] ||
                            myBrands[0].colors?.[0] ||
                            myBrands[0].brandGuidelines?.colorPalette?.[0] ||
                            '',
                        }
                      : cachedBrandSnapshot || null
                }
                label="Select brand"
                onChange={(brandId) => {
                  const brand = Array.isArray(myBrands)
                    ? myBrands.find((candidate) => candidate.id === brandId)
                    : null;
                  if (brand) dispatch(setSelectedCompetitorBrand(brand));
                }}
                onManageBrands={() => {
                  dispatch(setActiveBrandIQTab('myBrands'));
                  navigate('/brandiq');
                }}
              />
            )}

            {/* for BrandIQ */}
            {currentRoute === '/brandiq' && activeBrandIQTabId === 'myBrands' && (
              <>
                {Array.isArray(myBrands) && myBrands?.length > 0 && (
                  <>
                    <div className="ad-library-search relative flex h-9 w-[150px] items-center gap-2 rounded-full px-3 text-zinc-700 backdrop-blur-md transition-all duration-200 sm:w-[190px] md:w-[240px] lg:w-[300px] 2xl:w-[340px] dark:text-zinc-200">
                      <Search className="h-4 w-4 shrink-0 text-zinc-400" aria-hidden="true" />
                      <input
                        type="text"
                        inputMode="search"
                        value={myBrandsSearch}
                        maxLength={80}
                        placeholder="Search your brands..."
                        aria-label="Search your brands"
                        className="ad-library-search-input min-w-0 flex-1 border-none bg-transparent text-xs text-zinc-800 placeholder:text-zinc-400 focus:outline-none 2xl:text-sm dark:text-zinc-100 dark:placeholder:text-zinc-500"
                        onChange={(event) => dispatch(setMyBrandsSearch(event.target.value))}
                        onKeyDown={(event) => {
                          if (event.key === 'Escape') dispatch(setMyBrandsSearch(''));
                        }}
                      />
                      {myBrandsSearch && (
                        <button
                          type="button"
                          aria-label="Clear brand search"
                          onClick={() => dispatch(setMyBrandsSearch(''))}
                          className="flex shrink-0 items-center justify-center text-zinc-400 transition-colors hover:text-zinc-700 dark:hover:text-white"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                    <AddNewBrand fromComponent="topheader" />
                  </>
                )}
                {/* HIDE-MARK: BrandIQ Refresh button hidden because it has no action wired. */}
                {/*
                  {SHOW_HIDDEN_HEADER_UI && (
                    <button
                      variant="ghost"
                      className="backdrop-blur-100 text-10 relative hidden items-center justify-center gap-2 rounded-full border border-black/10 bg-white/70 p-[0.5px] px-4 py-1.5 text-gray-700 hover:text-gray-900 sm:flex 2xl:py-2 2xl:text-sm dark:border-white/20 dark:bg-[#0D0D0D]/50 dark:text-[#AFAFAF] dark:hover:text-white"
                    >
                      <span className="flex items-center gap-2 rounded-full">
                        Refresh
                        <RefreshCcw className="!h-3.5 !w-3.5 2xl:h-5 2xl:w-5" />
                      </span>
                    </button>
                  )}
                */}
              </>
            )}
            {currentRoute === '/brandiq' && activeBrandIQTabId === 'competitors' && (
              <div className="flex items-center gap-2">
                <BrandsDropdown
                  compact
                  singleAvatar
                  subtle
                  options={
                    Array.isArray(myBrands) && myBrands.length > 0
                      ? myBrands.map((b) => ({
                          value: b.id,
                          label: b.name || 'Unnamed',
                          logoUrl: b.logoUrls?.[0] || b.iconUrl || b.logoUrl || b.logo || '',
                          color:
                            b.color ||
                            b.brandColors?.[0] ||
                            b.colors?.[0] ||
                            b.brandGuidelines?.colorPalette?.[0] ||
                            '',
                        }))
                      : cachedBrandSnapshot
                        ? [cachedBrandSnapshot]
                        : []
                  }
                  value={
                    selectedCompetitorBrand
                      ? {
                          value: selectedCompetitorBrand.id,
                          label: selectedCompetitorBrand.name || 'Unnamed',
                          logoUrl:
                            selectedCompetitorBrand.logoUrls?.[0] ||
                            selectedCompetitorBrand.iconUrl ||
                            selectedCompetitorBrand.logoUrl ||
                            selectedCompetitorBrand.logo ||
                            '',
                          color:
                            selectedCompetitorBrand.color ||
                            selectedCompetitorBrand.brandColors?.[0] ||
                            selectedCompetitorBrand.colors?.[0] ||
                            selectedCompetitorBrand.brandGuidelines?.colorPalette?.[0] ||
                            '',
                        }
                      : Array.isArray(myBrands) && myBrands[0]
                        ? {
                            value: myBrands[0].id,
                            label: myBrands[0].name || 'Unnamed',
                            logoUrl:
                              myBrands[0].logoUrls?.[0] ||
                              myBrands[0].iconUrl ||
                              myBrands[0].logoUrl ||
                              myBrands[0].logo ||
                              '',
                            color:
                              myBrands[0].color ||
                              myBrands[0].brandColors?.[0] ||
                              myBrands[0].colors?.[0] ||
                              myBrands[0].brandGuidelines?.colorPalette?.[0] ||
                              '',
                          }
                        : cachedBrandSnapshot || null
                  }
                  onChange={(val) => {
                    const brand = Array.isArray(myBrands)
                      ? myBrands.find((b) => b.id === val)
                      : null;
                    if (brand) {
                      dispatch(setSelectedCompetitorBrand(brand));
                    }
                  }}
                  onManageBrands={() => dispatch(setActiveBrandIQTab('myBrands'))}
                />
              </div>
            )}

            {(currentRoute === '/brandiq' || currentRoute === '/adstudio') && (
              <div className="responsive_options flex lg:hidden">
                <button
                  id="tour_mobile_tabs_open"
                  ref={mobileTabsOpenRef}
                  onClick={() => setIsShowHeadersTabs(!isShowHeadersTabs)}
                  className={`show_top_header cursor-pointer rounded-full border p-2 text-xs transition-all duration-200 ease-out hover:scale-105 ${
                    isShowHeadersTabs
                      ? 'border-black/30 text-black dark:border-white/60 dark:text-white'
                      : 'border-black/10 text-zinc-600 dark:border-white/20 dark:text-[#AFAFAF]'
                  } bg-white/70 hover:border-black/20 hover:text-black dark:bg-[#0D0D0D]/50 dark:hover:border-white/40 dark:hover:text-white`}
                >
                  <List className="h-4 w-4" />
                </button>
              </div>
            )}

            {/* Theme toggle — inline header (hidden in Ad Studio to match clean reference header) */}
            {SHOW_HIDDEN_HEADER_UI && currentRoute !== '/adstudio' && <ThemeToggle />}
          </div>
        </div>
      )}

      {/* Floating fallback — keeps workspace switching reachable when the inline
          header is hidden on provider and Ad Studio sub-pages. */}
      {(currentRoute === '/adfactory-demo' ||
        (hideHeader &&
          !currentRoute.startsWith('/meta-ads') &&
          !currentRoute.startsWith('/google-ads') &&
          !currentRoute.startsWith('/tiktok-ads') &&
          !currentRoute.startsWith('/autopilot'))) && (
        <div
          className={`fixed top-4 right-5 z-[60] 2xl:right-6 ${currentRoute === '/meta-ads' ? 'md:top-9 2xl:top-10' : 'md:top-8 2xl:top-8.5'}`}
        >
          {/* Theme toggle — floating fallback */}
          <WorkspaceSwitcher />
          {SHOW_HIDDEN_HEADER_UI && !isMySpaceView && <ThemeToggle />}
        </div>
      )}
    </>
  );
}
