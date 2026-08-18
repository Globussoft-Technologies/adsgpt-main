import React, { useEffect, useState } from 'react';
import {
  Bot,
  ChartNoAxesColumn,
  ChevronsLeft,
  HelpCircle,
  History,
  //  Image,
  Library,
  LogOut,
  ScanSearch,
  Users,
} from 'lucide-react';
import AdsGPTLogoDarkLogo from '@/assets/layouts/adsgpt-dark-mode-logo.svg';
import AdsGPTLightModeLogo from '@/assets/layouts/adsgpt-light-mode-logo.png';
import brandIQDarkLogo from '@/assets/layouts/appsidebar/brand-iq-dark.svg';
import brandIQDarkLogoActive from '@/assets/layouts/appsidebar/brand-iq-dark-active.svg';
import adStudioDarkLogo from '@/assets/layouts/appsidebar/ad-studio-dark.svg';
import adStudioDarkLogoActive from '@/assets/layouts/appsidebar/ad-studio-dark-active.svg';
import adInsightDarkLogo from '@/assets/layouts/appsidebar/ad-insights-dark.svg';
import adInsightDarkLogoActive from '@/assets/layouts/appsidebar/ad-insights-dark-active.svg';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import ChatHistorySection from '@/components/common/AdPrompt/ChatHistorySection';
import rotateGradientIcon from '@/assets/layouts/appsidebar/rotate-gradient.svg';
import { Sidebar, SidebarTrigger, useSidebar } from '@/components/ui/sidebar';
import {
  FRAMER_NAVIGATION_CONTAINER_VARIANTS,
  FRAMER_NAVIGATION_ITEM_VARIANTS,
} from '@/utils/ui/framerMotionVariants';
import { AnimatePresence, motion } from 'framer-motion';
import { ShadcnTooltip } from '../ShadcnTooltip';
import { checkUserExists } from '@/store/actions/tourGuide/tourGuideActions';
import { setShowTour } from '@/store/reducers/tourGuide/tourGuideSlice';
import { useIsMobile } from '@/hooks/use-mobile';
import { initNewChat } from '@/store/actions/adStudio/adCreativeActions';
import AdsGPTLogo from '@/assets/layouts/adsgpt-logo.webp';
import adFactoryDarkLogo from '@/assets/layouts/appsidebar/ad-factory-dark.svg';
import adFactoryDarkLogoActive from '@/assets/layouts/appsidebar/ad-factory-dark-active.svg';
import metaAdsDarkLogo from '@/assets/layouts/appsidebar/meta-icon.svg';
import metaAdsDarkLogoActive from '@/assets/layouts/appsidebar/meta-icon.svg';
import { setActiveAdStudioTab } from '@/store/reducers/adStudio/adStudioTabsSlice';
import { setActivePage } from '@/store/reducers/adStudio/adVideoNewSlice';
import { resetAdFactorNewSlice } from '@/store/reducers/adFactoryNew/adFactoryNewSlice';
import { setActiveBrandIQTab } from '@/store/reducers/brandIQ/brandIQTabsSlice';
import { fetchProcessingCount } from '@/store/actions/adVideoNew/Advideoactions';
import { IS_AI_ASSISTANT_ENABLED, IS_LANDING_ANALYZER_ENABLED } from '@/utils/featureFlags';
import {
  canUseWorkspaceFeature,
  canUseMySpace,
  clearWorkspaceToken,
  isWorkspaceMember,
  sessionPayload,
} from '@/utils/workspaceSession';

const navigationItems = [
  {
    id: 'adfactory',
    icon: adFactoryDarkLogo,
    activeIcon: adFactoryDarkLogoActive,
    label: 'Ad Factory',
    link: '/adfactory',
  },
  IS_AI_ASSISTANT_ENABLED && {
    id: 'ai',
    label: 'AI',
    link: '/assistant',
    lucideIcon: Bot,
  },
  {
    id: 'adstudio',
    icon: adStudioDarkLogo,
    activeIcon: adStudioDarkLogoActive,
    label: 'Ad Studio',
    link: '/adstudio',
  },
  // {
  //   id: 'adlibrary',
  //   icon: adStudioDarkLogo,
  //   activeIcon: adStudioDarkLogoActive,
  //   label: 'Ad Library',
  //   link: '/ad-library',
  //   lucideIcon: Image,
  // },
  {
    id: 'brandiq',
    icon: brandIQDarkLogo,
    activeIcon: brandIQDarkLogoActive,
    label: 'BrandIQ',
    link: '/brandiq',
  },
  // Landing Page Analyzer — gated by VITE_FEATURE_LANDING_ANALYZER (hidden in
  // prod). Falsy entry is filtered out below.
  IS_LANDING_ANALYZER_ENABLED && {
    id: 'landing-analyzer',
    label: 'Analyzer',
    link: '/landing-page-analyzer',
    lucideIcon: ScanSearch,
    badge: 'NEW',
  },
  {
    id: 'meta-ads',
    icon: metaAdsDarkLogo,
    activeIcon: metaAdsDarkLogoActive,
    label: 'Ads Manager',
    link: '/ads-manager',
    lucideIcon: ChartNoAxesColumn,
    badge: 'BETA',
  },
  // {
  //   id: 'insights',
  //   icon: adInsightDarkLogo,
  //   activeIcon: adInsightDarkLogoActive,
  //   label: 'Ad Insights',
  //   link: '/adinsights',
  // },
  // {
  //   id: 'adfactory',
  //   icon: adInsightDarkLogo,
  //   activeIcon: adInsightDarkLogoActive,
  //   label: 'Ad Factory',
  //   link: '/adfactory-demo',
  // },
].filter(Boolean);

const AppSidebar = () => {
  const {
    isMobile,
    open: isSidebarOpen,
    setOpen,
    state,
    openMobile,
    setOpenMobile,
    setOpenHistory,
    openHistory,
    toggleSidebar,
    toggleHistorySection,
  } = useSidebar();
  const location = useLocation();
  const currentRoute = location.pathname;
  const isDarkMode = useSelector((state) => state.theme.isDarkMode);

  const dispatch = useDispatch();
  const { userData } = useSelector((state) => state.socket);
  const workspacePayload = sessionPayload();
  const memberSession = isWorkspaceMember(workspacePayload);
  const profileDisplayName = memberSession
    ? workspacePayload.actorUserName || workspacePayload.actorUserEmail || 'Workspace member'
    : userData?.user_name || 'User';
  const profileImage = memberSession ? '' : userData?.profileImage;
  const navigationFeature = {
    adfactory: 'adFactory',
    ai: 'assistant',
    adstudio: 'adStudio',
    brandiq: 'brandIq',
    'landing-analyzer': 'analyzer',
    'meta-ads': 'adsManager',
  };
  const visibleNavigationItems = navigationItems.filter((item) =>
    canUseWorkspaceFeature(navigationFeature[item.id], workspacePayload)
  );
  const [compactLogo, setCompactLogo] = useState(true);
  const navigate = useNavigate();
  const activeAdStudioTabId = useSelector((state) => state.adStudioTabs.activeAdStudioTabId);
  const { activePage, savedCount } = useSelector((state) => state.adVideoNew);

  const isNavigationItemActive = (item) => {
    if (item.id === 'meta-ads') {
      return (
        currentRoute === '/ads-manager' ||
        currentRoute.startsWith('/meta-ads') ||
        currentRoute.startsWith('/google-ads') ||
        currentRoute.startsWith('/tiktok-ads') ||
        currentRoute.startsWith('/autopilot')
      );
    }
    return currentRoute === item.link || (item.link !== '/' && currentRoute.startsWith(item.link));
  };

  useEffect(() => {
    const fetchCount = () => {
      dispatch(fetchProcessingCount());
    };

    fetchCount();
    const interval = setInterval(fetchCount, 15000);
    return () => clearInterval(interval);
  }, [dispatch]);

  // const userId = userData?.user_id;

  // useEffect(() => {
  //   if (userId) dispatch(checkUserExists(userId));
  // }, [dispatch, userId]);

  const handleNewChatClick = (link) => {
    if (link && link === '/adstudio') {
      dispatch(initNewChat());
    } else if (link && link === '/adfactory') {
      if (currentRoute !== '/adfactory') {
        dispatch(resetAdFactorNewSlice());
      }
    } else if (link && link === '/brandiq') {
      dispatch(setActiveBrandIQTab('myBrands'));
    }
  };

  useEffect(() => {
    if (isSidebarOpen && openHistory) {
      setCompactLogo(false);
    } else {
      const timeout = setTimeout(() => setCompactLogo(true), 80);
      return () => clearTimeout(timeout);
    }
  }, [isSidebarOpen, openHistory]);

  return (
    <Sidebar
      collapsible="icon"
      className={
        currentRoute === '/assistant' ? '[&_[data-slot=sidebar-inner]]:bg-transparent' : undefined
      }
    >
      <motion.div
        // {/* <div
        //   className={`bg-sidebar fixed left-0 flex h-[100svh] flex-col justify-between text-white ${
        //     isSidebarOpen ? 'w-64 2xl:w-72' : 'w-20 2xl:w-24'
        //   }`}
        // > */}
        layout
        transition={{ duration: 0.35, ease: 'easeInOut' }}
        className="lm-sidebar-surface relative flex h-full w-full flex-col justify-between bg-[#F7F4EE] dark:bg-[#0F0F0F]"
      >
        {/* Logo */}
        <div className="logo_and_history flex w-full flex-col gap-0">
          <div className="logo_app relative flex cursor-pointer items-center justify-center p-3 2xl:p-4">
            <div className="relative flex h-13 w-full items-center justify-center">
              {/* Soft brand glow behind the logo — light mode only. */}
              <span className="pointer-events-none absolute h-11 w-11 rounded-full bg-[radial-gradient(circle,#15DCFF_0%,#6b72f8_55%,transparent_72%)] opacity-35 blur-xl 2xl:h-13 2xl:w-13 dark:hidden" />
              <AnimatePresence mode="wait">
                {(isMobile ? openHistory : isSidebarOpen && openHistory) ? (
                  <motion.img
                    onClick={() => {
                      navigate(`${currentRoute}`);
                    }}
                    key="expanded-logo"
                    src={AdsGPTLogo}
                    initial={{ opacity: 0, scale: 0.9, y: 5 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.9, y: -5 }}
                    transition={{ duration: 0.25, ease: 'easeInOut' }}
                    className="absolute h-auto w-28 2xl:w-32"
                  />
                ) : (
                  compactLogo && (
                    <motion.img
                      onClick={() => {
                        navigate(`${currentRoute}`);
                        if (isMobile) {
                          setTimeout(() => {
                            toggleSidebar();
                          }, 500);
                        }
                      }}
                      key="compact-logo"
                      src={AdsGPTLogoDarkLogo}
                      initial={{ opacity: 0, scale: 0.9, y: 5 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.9, y: -5 }}
                      transition={{ duration: 0.25, ease: 'backOut' }}
                      className="absolute h-[46px] w-[46px] object-contain 2xl:h-[54px] 2xl:w-[54px]"
                    />
                  )
                )}
              </AnimatePresence>
            </div>

            {isSidebarOpen && (
              <ShadcnTooltip label="Close Sidebar">
                <SidebarTrigger className="right_icon prompt_selection_button absolute top-0.5 -right-2 flex h-6 min-w-6 items-center justify-center rounded-full border border-transparent text-zinc-700 hover:border-black/20 hover:text-black 2xl:h-8 2xl:min-w-8 dark:text-[#AFAFAF] dark:hover:border-white/20 dark:hover:text-white">
                  <ChevronsLeft className="h-4 w-4 2xl:h-5 2xl:w-5" />
                </SidebarTrigger>
              </ShadcnTooltip>
            )}
          </div>

          {activeAdStudioTabId !== 'adVideoNew' && (
            <ChatHistorySection isSidebarOpen={openHistory} />
          )}
        </div>

        {/* Navigation Items */}
        <AnimatePresence mode="wait">
          {!isSidebarOpen && !openHistory && (
            <motion.div
              key="navigation"
              variants={FRAMER_NAVIGATION_CONTAINER_VARIANTS}
              initial="hidden"
              animate="visible"
              exit="exit"
              className="navigation_menu_container mx-auto flex w-full flex-col items-center space-y-2.5 2xl:space-y-3.5"
            >
              {visibleNavigationItems.map((item, index) => {
                const isMySpace =
                  currentRoute === '/adstudio' &&
                  activeAdStudioTabId === 'adVideoNew' &&
                  activePage === 'myVideos';

                const isActive =
                  isNavigationItemActive(item) && !(item.id === 'adstudio' && isMySpace);
                return (
                  <motion.div
                    key={item.id}
                    id={`tour_${item.label.replace(/\s+/g, '-').toLocaleLowerCase()}_navigation`}
                    custom={index}
                    variants={FRAMER_NAVIGATION_ITEM_VARIANTS}
                    initial="hidden"
                    animate="visible"
                    exit="exit"
                    onClick={() => handleNewChatClick(item.link)}
                  >
                    <NavLink
                      onClick={() => {
                        if (isMobile) {
                          setTimeout(() => {
                            toggleSidebar();
                          }, 500);
                        }
                      }}
                      to={item.link}
                      className={({ isActive: navActive }) => {
                        const trulyActive =
                          (navActive || isNavigationItemActive(item)) &&
                          !(item.id === 'adstudio' && isMySpace);
                        return `group flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl text-zinc-700 transition-all duration-200 hover:text-black 2xl:gap-1.5 dark:text-[#AFAFAF] dark:hover:text-white ${trulyActive ? 'active font-semibold text-zinc-900 dark:text-white' : ''}`;
                      }}
                    >
                      <div
                        className={`active_container relative flex h-10 w-10 items-center justify-center rounded-xl transition-all duration-200 2xl:h-11 2xl:w-11 group-[.active]:bg-gradient-to-r group-[.active]:from-[#15DCFF] group-[.active]:to-[#6b72f8] group-[.active]:text-white group-[.active]:shadow-[0_4px_14px_rgba(21,220,255,0.35)] group-[:not(.active)]:bg-[#FCFAF7] group-[:not(.active)]:border group-[:not(.active)]:border-[#DDD7CD] group-[:not(.active)]:shadow-[0_1px_3px_rgba(80,70,58,0.04)] group-[:not(.active)]:hover:bg-[#EAE5DC] group-[:not(.active)]:hover:border-[#DDD7CD] dark:group-[.active]:bg-gradient-to-r dark:group-[.active]:from-[#15DCFF] dark:group-[.active]:to-[#6b72f8] dark:group-[.active]:shadow-[0_4px_14px_rgba(21,220,255,0.35)] dark:group-[:not(.active)]:bg-transparent dark:group-[:not(.active)]:border-none dark:group-[:not(.active)]:shadow-none dark:group-[:not(.active)]:hover:bg-[#2A2A2A]/70`}
                      >
                        {item.badge && (
                          <span
                            className={`absolute -top-1.5 -right-2.5 z-10 h-fit w-fit rounded-[4px] px-1.5 py-[1px] text-[7.5px] font-bold text-white uppercase shadow-sm ${
                              item.badge === 'BETA'
                                ? 'bg-gradient-to-r from-[#F5A524] to-[#F31260]'
                                : 'bg-gradient-to-r from-[#15DCFF] to-[#5E66F5]'
                            }`}
                          >
                            {item.badge}
                          </span>
                        )}
                        {item.lucideIcon ? (
                          <item.lucideIcon className="w-5 text-zinc-700 opacity-80 group-hover:opacity-100 group-[.active]:hidden 2xl:w-6 dark:text-white dark:opacity-60" />
                        ) : (
                          <img
                            className="block w-5 opacity-80 brightness-0 group-hover:opacity-100 group-[.active]:hidden 2xl:w-6 dark:opacity-60 dark:invert"
                            src={item.icon}
                          />
                        )}
                        {item.lucideIcon ? (
                          <item.lucideIcon className="hidden w-5 text-white group-[.active]:block 2xl:w-6" />
                        ) : (
                          <img
                            className="hidden w-5 brightness-0 invert group-[.active]:block 2xl:w-6"
                            src={item.activeIcon}
                          />
                        )}
                      </div>
                      <span className="text-center text-[9.5px] font-medium leading-tight whitespace-nowrap 2xl:text-xs">
                        {item.label}
                      </span>
                    </NavLink>
                  </motion.div>
                );
              })}

              {/* My Space Item */}
              {/* <motion.div
                key="myspace"
                custom={visibleNavigationItems.length}
                variants={FRAMER_NAVIGATION_ITEM_VARIANTS}
                initial="hidden"
                animate="visible"
                exit="exit"
              >
                <ShadcnTooltip label="Your personal collection of AI-generated videos. Everything you create appears right here." side="right">
                  <button
                    onClick={() => {
                      dispatch(setActiveAdStudioTab('adVideoNew'));
                      dispatch(setActivePage('myVideos'));
                      navigate('/adstudio');
                      if (isMobile) {
                        toggleSidebar();
                      }
                    }}
                    className={`group flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl transition-all duration-200 2xl:gap-0 ${
                      currentRoute === '/adstudio' &&
                      activeAdStudioTabId === 'adVideoNew' &&
                      activePage === 'myVideos'
                        ? 'text-white'
                        : 'text-[#AFAFAF] hover:text-white'
                    }`}
                  >
                    <div
                      className={`relative flex h-7 w-7 items-center justify-center rounded-sm 2xl:h-10 2xl:w-10 ${
                        currentRoute === '/adstudio' &&
                        activeAdStudioTabId === 'adVideoNew' &&
                        activePage === 'myVideos'
                          ? 'bg-gradient-to-r from-[#15DCFF] to-[#6b72f8]'
                          : 'hover:bg-[#2A2A2A]/70'
                      }`}
                    >
                      <Library className="w-4 2xl:w-5" />
                    </div>
                    <span className="mt-1 text-[9px] leading-none whitespace-nowrap 2xl:mt-2 2xl:text-xs">
                      My Space
                    </span>
                  </button>
                </ShadcnTooltip>
              </motion.div> */}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Bottom Section */}
        <div
          className={`bottom_section_container flex min-h-35 flex-col justify-end py-2 pb-4 2xl:min-h-48 2xl:px-[18px] 2xl:pb-5 ${isSidebarOpen || openHistory ? 'items-start' : 'items-center'} px-3.5 2xl:px-5`}
        >
          {/* SLOT 1 — TOP SLOT  */}
          <div className="mb-1 flex h-8 w-8 items-center justify-center 2xl:mb-1.5 2xl:h-10 2xl:w-10">
            {/* {currentRoute === '/adstudio' &&
            activeAdStudioTabId !== 'adVideoNew' &&
            currentRoute !== '/profile' ? (
              <ShadcnTooltip label="Take a tour" side="right">
                <button
                  id="tour_start"
                  onClick={() => {
                    dispatch(setShowTour(true));
                    if (isMobile) toggleSidebar();
                  }}
                  className="flex h-8 w-8 items-center justify-center rounded-full text-[#AFAFAF] hover:text-white 2xl:h-10 2xl:w-10"
                >
                  <HelpCircle className="w-4 2xl:w-5" />
                </button>
              </ShadcnTooltip>
            ) : (
              <div className="h-8 w-8 2xl:h-10 2xl:w-10" />
            )} */}
            <div className="h-8 w-8 2xl:h-10 2xl:w-10" />
          </div>

          {/* SLOT 2 — MIDDLE SLOT (Chat History OR Take a tour) */}
          <div
            className={`${isSidebarOpen || openHistory ? 'w-full' : currentRoute === '/adstudio' ? 'h-9 w-9 justify-center 2xl:h-12.5 2xl:w-12.5' : 'h-9 w-9'} ${currentRoute === '/adstudio' ? 'mb-2 2xl:mb-3' : 'mb-1.5'} flex items-center`}
          >
            {/* {currentRoute === '/adstudio' && activeAdStudioTabId !== 'adVideoNew' ? (
              // Chat History button — unchanged
              <ShadcnTooltip label="Chat History" side="right">
                <button
                  onClick={() => {
                    if (isMobile) {
                      toggleHistorySection();
                    } else {
                      toggleHistorySection();
                      toggleSidebar();
                    }
                  }}
                  className={`flex ${isSidebarOpen || openHistory ? 'w-full p-2' : 'h-9 w-9 py-1 2xl:h-12.5 2xl:w-12.5'} items-center justify-center rounded-full border-2 border-black/10 text-zinc-600 hover:bg-zinc-100 hover:text-black dark:border-white/10 dark:text-[#AFAFAF] dark:hover:bg-gray-800/50 dark:hover:text-white`}
                >
                  {(!isMobile ? !isSidebarOpen : !openHistory) ? (
                    <History className="w-3.5 2xl:w-5" />
                  ) : (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.2, duration: 0.2 }}
                      className="flex w-full items-center gap-3.5 2xl:px-2 2xl:py-1"
                    >
                      <img src={rotateGradientIcon} className="h-3.5 2xl:h-5" />
                      <p className="text-[10px] whitespace-nowrap text-zinc-900 2xl:text-sm dark:text-white">
                        Chat History
                      </p>
                    </motion.div>
                  )}
                </button>
              </ShadcnTooltip>
            ) : currentRoute === '/adstudio' && activeAdStudioTabId === 'adVideoNew' ? (
              // ✅ NEW: Take a tour in slot 2 for Ad Video tab
              <ShadcnTooltip label="Take a tour" side="right">
                <button
                  id="tour_start"
                  onClick={() => {
                    dispatch(setShowTour(true));
                    if (isMobile) toggleSidebar();
                  }}
                  className="flex h-9 w-9 items-center justify-center rounded-full text-zinc-500 hover:text-black dark:text-[#AFAFAF] dark:hover:text-white 2xl:h-12.5 2xl:w-12.5"
                >
                  <HelpCircle className="w-4 2xl:w-5" />
                </button>
              </ShadcnTooltip>
            ) : currentRoute !== '/profile' && currentRoute !== '/adstudio' ? (
              <ShadcnTooltip label="Take a tour" side="right">
                <button
                  id="tour_start"
                  onClick={() => {
                    dispatch(setShowTour(true));
                    if (isMobile) toggleSidebar();
                  }}
                  className="flex h-9 w-9 items-center justify-center rounded-full text-zinc-500 hover:text-black dark:text-[#AFAFAF] dark:hover:text-white"
                >
                  <HelpCircle className="w-4 2xl:w-5" />
                </button>
              </ShadcnTooltip>
            ) : (
              <div className="h-9 w-9 2xl:h-12.5 2xl:w-12.5" />
            )} */}
            {currentRoute == '/adstudio' &&
            activeAdStudioTabId !== 'adVideoNew' &&
            activeAdStudioTabId !== 'adCreativeNew' ? (
              // Chat History button — only meaningful on the legacy chat-style
              // surfaces. The new AdCreativeNew (and AdVideoNew) flows are
              // form-based, not conversational, so the History affordance is
              // hidden there. The else-branch renders an empty spacer so the
              // slot keeps its size and nothing below shifts.
              <ShadcnTooltip label="Chat History" side="right">
                <button
                  onClick={() => {
                    if (isMobile) {
                      toggleHistorySection();
                    } else {
                      toggleHistorySection();
                      toggleSidebar();
                    }
                  }}
                  className={`flex ${isSidebarOpen || openHistory ? 'w-full p-2' : 'h-9 w-9 py-1 2xl:h-12.5 2xl:w-12.5'} items-center justify-center rounded-full border-2 border-black/10 text-zinc-600 hover:bg-zinc-100 hover:text-black dark:border-white/10 dark:text-[#AFAFAF] dark:hover:bg-gray-800/50 dark:hover:text-white`}
                >
                  {(!isMobile ? !isSidebarOpen : !openHistory) ? (
                    <History className="w-3.5 2xl:w-5" />
                  ) : (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.2, duration: 0.2 }}
                      className="flex w-full items-center gap-3.5 2xl:px-2 2xl:py-1"
                    >
                      <img src={rotateGradientIcon} className="h-3.5 2xl:h-5" />
                      <p className="text-[10px] whitespace-nowrap text-zinc-900 2xl:text-sm dark:text-white">
                        Chat History
                      </p>
                    </motion.div>
                  )}
                </button>
              </ShadcnTooltip>
            ) : (
              <div className="h-9 w-9 2xl:h-12.5 2xl:w-12.5" />
            )}
          </div>
          {!memberSession && (
            <motion.div
              className="mb-2"
              variants={FRAMER_NAVIGATION_ITEM_VARIANTS}
              initial="hidden"
              animate="visible"
            >
              <ShadcnTooltip label="Manage workspace members" side="right">
                <button
                  type="button"
                  onClick={() => {
                    navigate('/workspace/members');
                    setOpen(false);
                    setOpenHistory(false);
                    if (isMobile) setOpenMobile(false);
                  }}
                  className={`group flex cursor-pointer items-center justify-center gap-1 rounded-xl transition-all duration-200 2xl:gap-1.5 ${
                    currentRoute === '/workspace/members'
                      ? 'active font-semibold text-zinc-900 dark:text-white'
                      : 'text-zinc-700 hover:text-black dark:text-[#AFAFAF] dark:hover:text-white'
                  } ${isSidebarOpen || openHistory ? 'flex-row' : 'flex-col'}`}
                >
                  <div
                    className="active_container relative flex h-10 w-10 items-center justify-center rounded-xl transition-all duration-200 2xl:h-11 2xl:w-11 group-[.active]:bg-[#24211D] group-[.active]:text-[#FAF8F5] group-[.active]:shadow-[0_2px_8px_rgba(36,33,29,0.18)] group-[:not(.active)]:border group-[:not(.active)]:border-[#DDD7CD] group-[:not(.active)]:bg-[#FCFAF7] group-[:not(.active)]:shadow-[0_1px_3px_rgba(80,70,58,0.04)] group-[:not(.active)]:hover:bg-[#EAE5DC] group-[:not(.active)]:hover:border-[#DDD7CD] dark:group-[.active]:bg-gradient-to-r dark:group-[.active]:from-[#15DCFF] dark:group-[.active]:to-[#6b72f8] dark:group-[.active]:shadow-[0_4px_14px_rgba(21,220,255,0.35)] dark:group-[:not(.active)]:border-none dark:group-[:not(.active)]:bg-transparent dark:group-[:not(.active)]:shadow-none dark:group-[:not(.active)]:hover:bg-[#2A2A2A]/70"
                  >
                    <Users className={`w-5 2xl:w-6 ${currentRoute === '/workspace/members' ? 'text-white' : 'text-[#3D3831] dark:text-white dark:opacity-60'}`} />
                  </div>
                  <span className="text-[9.5px] font-medium leading-tight whitespace-nowrap 2xl:text-xs">
                    Workspace
                  </span>
                </button>
              </ShadcnTooltip>
            </motion.div>
          )}
          {memberSession && (
            <motion.div
              className="mb-2"
              variants={FRAMER_NAVIGATION_ITEM_VARIANTS}
              initial="hidden"
              animate="visible"
            >
              <ShadcnTooltip label="Sign out of workspace access" side="right">
                <button
                  type="button"
                  onClick={() => {
                    clearWorkspaceToken();
                    window.location.assign('/workspace-login');
                  }}
                  className={`group flex cursor-pointer items-center justify-center gap-1 rounded-xl text-zinc-700 hover:text-zinc-900 dark:text-[#AFAFAF] dark:hover:text-white ${
                    isSidebarOpen || openHistory ? 'flex-row' : 'flex-col'
                  }`}
                >
                  <div className="flex h-7 w-7 items-center justify-center rounded-sm hover:bg-black/5 dark:hover:bg-white/10 2xl:h-10 2xl:w-10">
                    <LogOut className="w-4 2xl:w-5" />
                  </div>
                  <span className="text-[9px] leading-none whitespace-nowrap 2xl:text-xs">
                    Sign out
                  </span>
                </button>
              </ShadcnTooltip>
            </motion.div>
          )}
          {canUseMySpace(workspacePayload) && (
            <motion.div
              key="myspace"
              custom={visibleNavigationItems.length}
              variants={FRAMER_NAVIGATION_ITEM_VARIANTS}
              initial="hidden"
              animate="visible"
              exit="exit"
            >
              <ShadcnTooltip
                label="Your personal collection of AI-generated videos. Everything you create appears right here."
                side="right"
              >
                <button
                  id="sidebar-my-space-button"
                  onClick={() => {
                    dispatch(setActivePage('myVideos'));
                    navigate('/my-space');
                    setOpen(false);
                    setOpenHistory(false);
                    if (isMobile) {
                      setOpenMobile(false);
                    }
                  }}
                  className={`group flex cursor-pointer items-center justify-center gap-1 rounded-xl transition-all duration-200 2xl:gap-1.5 ${
                    currentRoute === '/my-space'
                      ? 'active font-semibold text-zinc-900 dark:text-white'
                      : 'text-zinc-700 hover:text-black dark:text-[#AFAFAF] dark:hover:text-white'
                  } ${isSidebarOpen || openHistory ? 'flex-row' : 'flex-col'}`}
                >
                  <div
                    className="active_container relative flex h-10 w-10 items-center justify-center rounded-xl transition-all duration-200 2xl:h-11 2xl:w-11 group-[.active]:bg-gradient-to-r group-[.active]:from-[#15DCFF] group-[.active]:to-[#6b72f8] group-[.active]:text-white group-[.active]:shadow-[0_4px_14px_rgba(21,220,255,0.35)] group-[:not(.active)]:border group-[:not(.active)]:border-[#DDD7CD] group-[:not(.active)]:bg-[#FCFAF7] group-[:not(.active)]:shadow-[0_1px_3px_rgba(80,70,58,0.04)] group-[:not(.active)]:hover:bg-[#EAE5DC] dark:group-[.active]:bg-gradient-to-r dark:group-[.active]:from-[#15DCFF] dark:group-[.active]:to-[#6b72f8] dark:group-[.active]:shadow-[0_4px_14px_rgba(21,220,255,0.35)] dark:group-[:not(.active)]:border-none dark:group-[:not(.active)]:bg-transparent dark:group-[:not(.active)]:shadow-none dark:group-[:not(.active)]:hover:bg-[#2A2A2A]/70"
                  >
                    <Library className="w-5 2xl:w-6" />
                    {savedCount > 0 && (
                      <div className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-gradient-to-r from-[#15DCFF] to-[#6b72f8] text-[8px] font-bold text-black shadow-lg 2xl:h-5 2xl:w-5 2xl:text-[10px]">
                        <div className="absolute inset-0 animate-spin rounded-full border border-white/30 border-t-white"></div>
                        <span className="relative z-10">{savedCount}</span>
                      </div>
                    )}
                  </div>
                  <span className="text-[9.5px] font-medium leading-tight whitespace-nowrap 2xl:text-xs">
                    My Space
                  </span>
                </button>
              </ShadcnTooltip>
            </motion.div>
          )}
          {/* SLOT 3 — BOTTOM SLOT (User Profile ALWAYS) */}
          <div
            className={`${memberSession && !canUseWorkspaceFeature('profile', workspacePayload) ? 'hidden' : ''} ${isSidebarOpen || openHistory ? 'mt-1 w-full py-1' : 'mt-4 h-9 w-9 2xl:mt-5 2xl:h-12.5 2xl:w-12.5'} `}
          >
            <Link
              onClick={() => {
                setOpen(false);
                setOpenHistory(false);
                if (isMobile) {
                  toggleSidebar();
                }
              }}
              to="/profile"
              className="flex w-full items-center gap-2"
            >
              <ShadcnTooltip label="User Profile" side="right">
                <>
                  <button
                    className={`sidebar-profile-button ${currentRoute === '/profile' ? 'sidebar-profile-button-active' : ''} relative inline-flex h-9 w-9 items-center justify-center rounded-full p-0.5 transition-all duration-200 2xl:h-12.5 2xl:w-12.5 bg-[#FCFAF7] border border-[#DDD7CD] shadow-[0_1px_3px_rgba(80,70,58,0.04)] hover:bg-[#EAE5DC] dark:border-white/10 dark:bg-[#1A1A1A] dark:shadow-none dark:hover:bg-[#2A2A2A]`}
                  >
                    {profileImage ? (
                      <img
                        src={profileImage}
                        alt="User Avatar"
                        className="sidebar-profile-avatar h-[30px] w-[30px] rounded-full object-cover"
                      />
                    ) : (
                      <div className="sidebar-profile-avatar flex h-9 w-9 items-center justify-center rounded-full bg-[#EAE5DC] text-[10px] font-bold text-[#24211D] 2xl:text-sm dark:bg-[#222222] dark:text-white">
                        {(() => {
                          if (memberSession) {
                            return profileDisplayName.slice(0, 2).toUpperCase();
                          }
                          const firstName = userData?.name_f || '';
                          const lastName = userData?.name_l || '';
                          const userName = userData?.user_name || 'U';
                          const login = userData?.login || 'AG';
                          if (userData?.autoGenerated) {
                            return login?.slice(0, 2).toUpperCase();
                          }
                          if (firstName && lastName) {
                            return `${firstName[0]}${lastName[0]}`.toUpperCase();
                          } else if (firstName) {
                            return firstName.slice(0, 2).toUpperCase(); // First 2 letters of first name
                          } else if (lastName) {
                            return lastName.slice(0, 2).toUpperCase(); // First 2 letters of last name
                          } else {
                            return userName.slice(0, 2).toUpperCase(); // First 2 letters of username
                          }
                        })()}
                      </div>
                    )}
                  </button>
                  {isSidebarOpen && !isMobile && (
                    <span className="ml-1 truncate text-[10px] whitespace-nowrap 2xl:text-sm">
                      {profileDisplayName}
                    </span>
                  )}
                </>
              </ShadcnTooltip>
            </Link>
          </div>
        </div>

        <div className="absolute right-0 top-0 h-full w-px bg-gradient-to-b from-transparent via-black/30 to-transparent opacity-100 dark:from-transparent dark:via-white/30 dark:to-transparent"></div>
      </motion.div>
    </Sidebar>
  );
};

export default AppSidebar;
