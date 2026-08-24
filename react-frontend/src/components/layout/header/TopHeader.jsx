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
} from 'lucide-react';
import { LuLayoutTemplate } from 'react-icons/lu';
import { useDispatch, useSelector } from 'react-redux';
import { setActiveAdStudioTab } from '@/store/reducers/adStudio/adStudioTabsSlice';
import { useLocation, useNavigate } from 'react-router-dom';
import { getHeaderName } from '@/utils/getHeaderName';
import HeaderTabs from './HeaderTabs';
import {
  setActiveBrandIQTab,
  setSelectedCompetitorBrand,
  setSelectedCompetitorPlatform,
} from '@/store/reducers/brandIQ/brandIQTabsSlice';
import { Button } from '@/components/ui/button';
import { resetAdCopySlice } from '@/store/reducers/adStudio/adCopySlice';
import { resetPromptSlice, setField } from '@/store/reducers/adStudio/promptSlice';
import { fetchSuggestions } from '@/store/actions/adStudio/adCopyActions';
import { createNewSession } from '@/store/reducers/adStudio/adHistorySlice';
import { Input } from '@/components/ui/input';
import AddNewBrandDialog from '@/components/BrandIQ/Actions/AddNewBrandDialog';
import BrandsDropdown from './BrandIQ/Competitors/BrandsDropdown';
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

// HIDE-MARK — intentionally-hidden header UI (Templates / Refresh buttons and
// the global theme toggle). Named flag avoids a literal `false &&`
// (no-constant-binary-expression); flip to re-enable.
const SHOW_HIDDEN_HEADER_UI = true;

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
  { id: 'adCopy', label: 'Ad Copy', icon: NotebookPen },
  // HIDE-MARK — legacy Ad Creative tab. The new generator (id
  // 'adCreativeNew') now takes this slot under the same "Ad Creative"
  // label so users land in the new experience by default. Restore by
  // un-commenting this entry and dropping the renamed entry below.
  // { id: 'adCreative', label: 'Ad Creative', icon: Image },
  { id: 'adCreativeNew', label: 'Ad Creative', icon: Images },
];
const adVideoTab = { id: 'adVideo', label: 'Ad Video', icon: Video };
const adVideoNewTab = {
  id: 'adVideoNew',
  label: 'Ad Video',
  icon: Video,
};
const adLibraryTab = {
  id: 'adLibrary',
  label: 'Ad Library',
  icon: Image,
};
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
    Icon: <FaMeta className="!h-3 !w-3 group-hover:text-white 2xl:!h-4 2xl:!w-4" />,
    label: 'Meta Ads',
  },
  {
    value: 'youtube',
    Icon: <FaYoutube className="!h-3 !w-3 group-hover:text-white 2xl:!h-4 2xl:!w-4" />,
    label: 'Youtube Ads',
  },
  // {
  //   value: 'google',
  //   Icon: <Search className="!h-3 !w-3 group-hover:text-white 2xl:!h-4 2xl:!w-4" />,
  //   label: 'Google Search Ads',
  // },
  // {
  //   value: 'google_performance_max_ads',
  //   Icon: <FaGoogle className="!h-3 !w-3 group-hover:text-white 2xl:!h-4 2xl:!w-4" />,
  //   label: 'Google Performance Max Ads',
  // },
  {
    value: 'google_display_ads',
    Icon: <SiGoogleads className="!h-3 !w-3 group-hover:text-white 2xl:!h-4 2xl:!w-4" />,
    label: 'Google Display Ads',
  },

  {
    value: 'linkedin',
    Icon: <AiFillLinkedin className="!h-3 !w-3 group-hover:text-white 2xl:!h-4 2xl:!w-4" />,
    label: 'LinkedIn Ads',
  },
  // {
  //   value: 'twitter',
  //   Icon: <RiTwitterXLine className="!h-3 !w-3 group-hover:text-white 2xl:!h-4 2xl:!w-4" />,
  //   label: 'Twitter Ads',
  // },
  {
    value: 'pinterest',
    Icon: <FaPinterest className="!h-3 !w-3 group-hover:text-white 2xl:!h-4 2xl:!w-4" />,
    label: 'Pinterest Ads',
  },
  {
    value: 'reddit',
    Icon: <FaReddit className="!h-3 !w-3 group-hover:text-white 2xl:!h-4 2xl:!w-4" />,
    label: 'Reddit Ads',
  },
  // {
  //   value: 'google_video_ads',
  //   Icon: <Video className="!h-3 !w-3 group-hover:text-white 2xl:!h-4 2xl:!w-4" />,
  //   label: 'Google Video Ads',
  // },
];

export default function TopHeader() {
  const location = useLocation();
  const navigate = useNavigate();
  const currentRoute = location.pathname;

  const [selectedBrand, setSelectedBrand] = useState(brandOptions[0]);
  const [selectedPlateform, setSelectedPlateform] = useState(adPlatformOptions[0]);

  const { isMobile } = useSidebar();

  const headerName = useMemo(
    () => getHeaderName(location.pathname),
    [location.pathname] // re-runs every time pathname changes
  );
  const { userData } = useSelector((state) => state.socket);
  const adFactoryUiMode = useSelector(selectAdFactoryUiMode);
  // if (
  //   userData?.featureObject?.['Ad Creative Video'] > 0 ||
  //   Object.keys(userData?.userSubscriptionType || {})[0] === AUTO_GENERATED_PLAN_ID
  // ) {
  // adStudioTabs[2] = adVideoTab;
  adStudioTabs[2] = adVideoNewTab;
  adStudioTabs[3] = adLibraryTab;
  // HIDE-MARK — the new Ad Creative tab is now defined inline in the
  // static adStudioTabs array above (slot 1), so no runtime append is
  // needed here. Restore alongside the legacy entry if reverting.
  // adStudioTabs[3] = adCreativeNewTab;
  // }
  const activeAdStudioTabId = useSelector((state) => state.adStudioTabs.activeAdStudioTabId);
  const { myBrands, activeBrandIQTabId, selectedCompetitorBrand, selectedCompetitorPlatform } =
    useSelector((state) => state.brandIQTabs);
  const dispatch = useDispatch();
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

  // Initialize selectedCompetitorBrand from myBrands if not set
  useEffect(() => {
    if (Array.isArray(myBrands) && myBrands.length > 0 && !selectedCompetitorBrand) {
      dispatch(setSelectedCompetitorBrand(myBrands[0]));
    }
  }, [myBrands, selectedCompetitorBrand, dispatch]);

  const isMySpaceView =
    currentRoute === '/my-space' ||
    (currentRoute === '/adstudio' &&
      activeAdStudioTabId === 'adVideoNew' &&
      activePage === 'myVideos');

  if (currentRoute !== '/adfactory-demo' && hideHeader) {
    // Meta and TikTok Ads Manager include controls in their own row so they
    // participate in layout instead of floating over provider controls.
    if (
      currentRoute === '/meta-ads' ||
      currentRoute === '/autopilot/meta' ||
      currentRoute === '/tiktok-ads'
    )
      return null;

    return (
      <div className="pointer-events-none fixed top-4 right-5 z-[60] flex items-center gap-2">
        <div className="pointer-events-auto flex items-center gap-2">
          <WorkspaceSwitcher />
          {SHOW_HIDDEN_HEADER_UI && !isMySpaceView && currentRoute !== '/autopilot/meta' && <ThemeToggle />}
        </div>
      </div>
    );
  }

  return (
    <>
      {currentRoute !== '/adfactory-demo' && !hideHeader && (
        <div
          className={`lm-header-surface sticky top-0 z-50 flex h-16 w-full items-center justify-between gap-1 bg-transparent px-2 py-3 md:px-5 2xl:h-24 2xl:px-8 2xl:py-6 dark:bg-transparent dark:backdrop-blur-none ${activeAdStudioTabId === 'adCreative' && location.pathname === '/adstudio' && ''} `}
        >
          <div className="left_header_container flex items-center">
            <SidebarTrigger>
              <button className="close_open_ mr-0 flex h-9 w-9 cursor-pointer items-center justify-center rounded-full p-1 hover:bg-[#EAE5DC] sm:mr-1.5 lg:hidden">
                <PanelLeft className="h-5" />
              </button>
            </SidebarTrigger>
            {/* Left Title */}
            {currentRoute !== '/adfactory-demo' && (
              <h1
                className={`mr-4 ${headerName === 'Ad Studio' ? 'text-sm' : 'text-lg'} font-semibold whitespace-nowrap text-[#24211D] md:text-xl lg:mr-4 2xl:mr-6 2xl:text-[30px] dark:text-white`}
              >
                {headerName}
              </h1>
            )}
            {/* Ad Factory's mode switch sits beside the title, the same slot
                /adstudio and /brandiq put their tabs in. It was in the page
                body before, which floated it above the content with nothing to
                align to. */}
            {currentRoute === '/adfactory' && IS_AD_FACTORY_V2 && (
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
            className="right_header_mybrands relative flex scale-[0.9] items-center gap-2 sm:static sm:scale-100"
          >
            <WorkspaceSwitcher />
            {/* AI Assistant — History + New Chat */}
            {currentRoute === '/assistant' && <AIAssistantHeaderActions />}

            {/* for AdStudio */}
            {currentRoute === '/adstudio' && activeAdStudioTabId === 'adCopy' && (
              <Button
                variant="ghost"
                onClick={handleNewChatClick}
                className="backdrop-blur-100 relative flex h-8 items-center gap-2 rounded-full border border-black/10 bg-white/70 text-xs text-zinc-700 transition-colors hover:text-black has-[>svg]:px-4 2xl:h-9 2xl:px-5 2xl:text-sm dark:border-white/20 dark:bg-[#0D0D0D]/50 dark:text-[#AFAFAF] dark:hover:text-white"
              >
                <MessageCirclePlus className="h-4 w-4 2xl:h-5 2xl:w-5" />
                <span>New Chat</span>
              </Button>
            )}
            {currentRoute === '/adstudio' &&
              activeAdStudioTabId === 'adCreative' &&
              Array.isArray(creativeConversations) &&
              creativeConversations.length > 0 && (
                <Button
                  variant="ghost"
                  onClick={handleNewChatClick}
                  className="backdrop-blur-100 relative flex h-8 items-center gap-2 rounded-full border border-black/10 bg-white/70 text-xs text-zinc-700 transition-colors hover:text-black has-[>svg]:px-4 2xl:h-9 2xl:px-5 2xl:text-sm dark:border-white/20 dark:bg-[#0D0D0D]/50 dark:text-[#AFAFAF] dark:hover:text-white"
                >
                  <MessageCirclePlus className="h-4 w-4 2xl:h-5 2xl:w-5" />
                  <span>New Chat</span>
                </Button>
              )}
            {currentRoute === '/adstudio' &&
              ((activeAdStudioTabId === 'adCreative' &&
                Array.isArray(creativeConversations) &&
                creativeConversations.length === 0) ||
                activeAdStudioTabId === 'adLibrary') && (
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
                  <div className="ad-library-search backdrop-blur-100 relative flex min-w-[150px] items-center gap-2 rounded-full border border-black/10 bg-white/70 px-3 py-1.5 text-zinc-600 transition-colors sm:py-2 md:left-8 md:scale-[0.8] 2xl:inset-0 2xl:scale-100 2xl:px-5 2xl:pr-3 2xl:text-sm dark:border-white/20 dark:bg-[#0D0D0D]/50 dark:text-[#AFAFAF]">
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
                    <div className="ml-2 flex space-x-1">
                      {!isMobile ? (
                        <>
                          {['competitor', 'keyword'].map((type) => (
                            <button
                              key={type}
                              className={`rounded-full px-2.5 py-0.5 text-xs transition-colors duration-200 ${
                                exploreSearchTerm === type
                                  ? 'bg-zinc-200 text-zinc-900 dark:bg-[#2A2A2A] dark:text-white'
                                  : 'text-zinc-500 dark:text-[#777777]'
                              }`}
                              onClick={() => {
                                dispatch(setExploreSearchTerm(type));
                                dispatch(setSkip(0));
                                dispatch(fetchExploreAds());
                              }}
                            >
                              {type === 'competitor' ? 'Competitor' : 'Keyword'}
                            </button>
                          ))}
                        </>
                      ) : (
                        <Popover>
                          <PopoverTrigger asChild>
                            <MenuIcon className="h-4 w-4 cursor-pointer hover:text-white 2xl:h-4 2xl:w-4" />
                          </PopoverTrigger>
                          <PopoverContent className="flex w-fit flex-col gap-2 overflow-hidden rounded-lg border border-white/10 bg-[#0D0D0D]/50 p-2 shadow-lg backdrop-blur-[50px] transition-all duration-150">
                            {['competitor', 'keyword'].map((type) => (
                              <button
                                key={type}
                                className={`rounded-full px-2.5 py-0.5 text-xs transition-colors duration-200 ${
                                  exploreSearchTerm === type
                                    ? 'bg-[#2A2A2A] text-white'
                                    : 'text-[#777777]'
                                }`}
                                onClick={() => {
                                  dispatch(setExploreSearchTerm(type));
                                  dispatch(setSkip(0));
                                  dispatch(fetchExploreAds());
                                }}
                              >
                                {type === 'competitor' ? 'Competitor' : 'Keyword'}
                              </button>
                            ))}
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

            {currentRoute === '/adstudio' && activeAdStudioTabId === 'adVideo' && (
              <>
                <Button
                  variant="ghost"
                  onClick={handleNewChatClick}
                  className="backdrop-blur-100 relative flex h-8 items-center gap-1.5 rounded-full border border-black/10 bg-white/70 text-xs text-zinc-700 transition-colors hover:bg-zinc-200 hover:text-black has-[>svg]:px-4 2xl:h-9 2xl:gap-2 2xl:px-5 2xl:text-sm dark:border-white/20 dark:bg-[#0D0D0D]/50 dark:text-[#AFAFAF] dark:hover:bg-[#2A2A2A]/70 dark:hover:text-white"
                >
                  <MessageCirclePlus className="h-4 w-4 2xl:h-5 2xl:w-5" />
                  <span>New Chat </span>
                </Button>
                {SHOW_HIDDEN_HEADER_UI && (
                  <Button
                    variant="ghost"
                    onClick={handleNewChatClick}
                    className="backdrop-blur-100 relative flex h-8 items-center gap-1.5 rounded-full border border-black/10 bg-white/70 text-xs text-zinc-700 transition-colors hover:bg-zinc-200 hover:text-black has-[>svg]:px-4 2xl:h-9 2xl:gap-2 2xl:px-5 2xl:text-sm dark:border-white/20 dark:bg-[#0D0D0D]/50 dark:text-[#AFAFAF] dark:hover:bg-[#2A2A2A]/70 dark:hover:text-white"
                  >
                    <LuLayoutTemplate className="h-4 w-4 2xl:h-5 2xl:w-5" />
                    <span>Templates </span>
                  </Button>
                )}
              </>
            )}

            {/* for BrandIQ */}
            {currentRoute === '/brandiq' && activeBrandIQTabId === 'myBrands' && (
              <>
                {Array.isArray(myBrands) && myBrands?.length > 0 && (
                  <AddNewBrand fromComponent="topheader" />
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
                  options={
                    Array.isArray(myBrands)
                      ? myBrands.map((b) => ({ value: b.id, label: b.name || 'Unnamed' }))
                      : []
                  }
                  value={
                    selectedCompetitorBrand
                      ? {
                          value: selectedCompetitorBrand.id,
                          label: selectedCompetitorBrand.name || 'Unnamed',
                        }
                      : Array.isArray(myBrands) && myBrands[0]
                        ? { value: myBrands[0].id, label: myBrands[0].name }
                        : null
                  }
                  onChange={(val) => {
                    const brand = Array.isArray(myBrands)
                      ? myBrands.find((b) => b.id === val)
                      : null;
                    if (brand) {
                      dispatch(setSelectedCompetitorBrand(brand));
                    }
                  }}
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

            {/* Theme toggle — inline header */}
            {SHOW_HIDDEN_HEADER_UI && <ThemeToggle />}
          </div>
        </div>
      )}

      {/* Floating fallback — keeps workspace switching reachable when the inline
          header is hidden on provider and Ad Studio sub-pages. */}
      {(currentRoute === '/adfactory-demo' || hideHeader) && (
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
