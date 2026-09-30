import React, { useEffect } from 'react';
import {
  Bot,
  ChartNoAxesColumn,
  ChevronLeft,
  ChevronsLeft,
  ChevronsRight,
  History,
  Library,
  LogOut,
  ScanSearch,
  Sparkles,
  Users,
  Zap,
} from 'lucide-react';
import AdsGPTLogoDarkLogo from '@/assets/layouts/adsgpt-dark-mode-logo.svg';
import AdsGPTLogo from '@/assets/layouts/adsgpt-logo.webp';
import brandIQDarkLogo from '@/assets/layouts/appsidebar/brand-iq-dark.svg';
import adFactoryDarkLogo from '@/assets/layouts/appsidebar/ad-factory-dark.svg';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import ChatHistorySection from '@/components/common/AdPrompt/ChatHistorySection';
import { Sidebar, useSidebar } from '@/components/ui/sidebar';
import { ShadcnTooltip } from '../ShadcnTooltip';
import { initNewChat } from '@/store/actions/adStudio/adCreativeActions';
import { resetAdFactorNewSlice } from '@/store/reducers/adFactoryNew/adFactoryNewSlice';
import { setActiveBrandIQTab } from '@/store/reducers/brandIQ/brandIQTabsSlice';
import { fetchProcessingCount } from '@/store/actions/adVideoNew/Advideoactions';
import { setActivePage } from '@/store/reducers/adStudio/adVideoNewSlice';
import {
  setActiveAdStudioTab,
  setAdCreativeNewActivePage,
} from '@/store/reducers/adStudio/adStudioTabsSlice';
import { IS_AI_ASSISTANT_ENABLED, IS_LANDING_ANALYZER_ENABLED } from '@/utils/featureFlags';
import {
  canUseWorkspaceFeature,
  canUseMySpace,
  clearWorkspaceToken,
  isWorkspaceMember,
  sessionPayload,
} from '@/utils/workspaceSession';

// ── Static navigation group definitions ────────────────────────────────────
// Items defined here; permission filtering happens inside the component.
const NAV_GROUPS_STATIC = [
  {
    id: 'create',
    label: 'CREATE',
    items: [
      {
        id: 'adfactory',
        label: 'Ad Factory',
        compactLabel: 'AdFactory',
        link: '/adfactory',
        icon: adFactoryDarkLogo,
        featureKey: 'adFactory',
      },
      IS_AI_ASSISTANT_ENABLED && {
        id: 'ai',
        label: 'AI Assistant',
        compactLabel: 'AI',
        link: '/assistant',
        lucideIcon: Bot,
        featureKey: 'assistant',
      },
      {
        id: 'adstudio',
        label: 'Ad Studio',
        compactLabel: 'AdStudio',
        link: '/adstudio',
        lucideIcon: Sparkles,
        featureKey: 'adStudio',
      },
      IS_LANDING_ANALYZER_ENABLED && {
        id: 'landing-analyzer',
        label: 'Analyzer',
        compactLabel: 'Analyzer',
        link: '/landing-page-analyzer',
        lucideIcon: ScanSearch,
        badge: 'NEW',
        featureKey: 'analyzer',
      },
    ].filter(Boolean),
  },
  {
    id: 'measure',
    label: 'MEASURE',
    items: [
      {
        id: 'brandiq',
        label: 'BrandIQ',
        compactLabel: 'BrandIQ',
        link: '/brandiq',
        icon: brandIQDarkLogo,
        lightIcon: Zap,
        featureKey: 'brandIq',
      },
      {
        id: 'meta-ads',
        label: 'Ads Manager',
        compactLabel: 'Ads Manager',
        link: '/ads-manager',
        lucideIcon: ChartNoAxesColumn,
        badge: 'BETA',
        featureKey: 'adsManager',
      },
    ],
  },
];

const AppSidebar = () => {
  const {
    isMobile,
    openMobile,
    setOpenMobile,
    setOpenHistory,
    openHistory,
    isNavExpanded,
    toggleNavExpanded,
  } = useSidebar();

  const location = useLocation();
  const currentRoute = location.pathname;
  const dispatch = useDispatch();
  const { userData, credits } = useSelector((state) => state.socket);

  const workspacePayload = sessionPayload();
  const memberSession = isWorkspaceMember(workspacePayload);

  // ── Profile info ────────────────────────────────────────────────────────
  const profileDisplayName = memberSession
    ? workspacePayload.actorUserName || workspacePayload.actorUserEmail || 'Workspace member'
    : userData?.user_name || 'User';
  const formattedProfileDisplayName = profileDisplayName
    ? `${profileDisplayName.charAt(0).toUpperCase()}${profileDisplayName.slice(1)}`
    : 'User';
  const profileFooterLabel = memberSession ? 'Workspace account' : 'Account';
  const profileImage = memberSession ? '' : userData?.profileImage;
  const planName = userData?.featureObject?.planDetails?.name;
  const totalCredits = Number(credits?.totalCredits);
  const creditsUsed = Number(credits?.creditsUsed);
  const hasCreditSummary = Number.isFinite(totalCredits) && totalCredits > 0;
  const remainingCredits = hasCreditSummary
    ? Math.max(0, totalCredits - (Number.isFinite(creditsUsed) ? creditsUsed : 0))
    : null;
  const creditUsagePercentage = hasCreditSummary
    ? Math.min(100, Math.max(0, ((totalCredits - remainingCredits) / totalCredits) * 100))
    : 0;

  const profileInitials = (() => {
    if (memberSession) return profileDisplayName.slice(0, 2).toUpperCase();
    const firstName = userData?.name_f || '';
    const lastName = userData?.name_l || '';
    const userName = userData?.user_name || 'U';
    const login = userData?.login || 'AG';
    if (userData?.autoGenerated) return login?.slice(0, 2).toUpperCase();
    if (firstName && lastName) return `${firstName[0]}${lastName[0]}`.toUpperCase();
    if (firstName) return firstName.slice(0, 2).toUpperCase();
    if (lastName) return lastName.slice(0, 2).toUpperCase();
    return userName.slice(0, 2).toUpperCase();
  })();

  const activeAdStudioTabId = useSelector((state) => state.adStudioTabs.activeAdStudioTabId);
  const { activePage, savedCount } = useSelector((state) => state.adVideoNew);

  // Poll for processing count
  useEffect(() => {
    const fetchCount = () => dispatch(fetchProcessingCount());
    fetchCount();
    const interval = setInterval(fetchCount, 15000);
    return () => clearInterval(interval);
  }, [dispatch]);

  // ── Close history when leaving adCopy tab ─────────────────────────────
  useEffect(() => {
    if (!(currentRoute === '/adstudio' && activeAdStudioTabId === 'adCopy')) {
      setOpenHistory(false);
    }
  }, [activeAdStudioTabId, currentRoute, setOpenHistory]);

  // ── Active route detection ──────────────────────────────────────────────
  const isItemActive = (item) => {
    if (item.id === 'meta-ads') {
      return (
        currentRoute === '/ads-manager' ||
        currentRoute.startsWith('/meta-ads') ||
        currentRoute.startsWith('/google-ads') ||
        currentRoute.startsWith('/tiktok-ads') ||
        currentRoute.startsWith('/autopilot')
      );
    }
    if (item.id === 'adstudio') {
      // Don't mark adstudio active on myVideos my-space page
      const isMySpace =
        currentRoute === '/adstudio' &&
        activeAdStudioTabId === 'adVideoNew' &&
        activePage === 'myVideos';
      return (
        !isMySpace &&
        (currentRoute === item.link || (item.link !== '/' && currentRoute.startsWith(item.link)))
      );
    }
    return currentRoute === item.link || (item.link !== '/' && currentRoute.startsWith(item.link));
  };

  // ── Nav click side-effects (dispatch + mobile close) ───────────────────
  const handleNavClick = (link) => {
    if (link === '/adstudio') dispatch(initNewChat());
    else if (link === '/adfactory' && currentRoute !== '/adfactory')
      dispatch(resetAdFactorNewSlice());
    else if (link === '/brandiq') dispatch(setActiveBrandIQTab('myBrands'));
    if (isMobile) setOpenMobile(false);
  };

  const handleLogoClick = () => {
    dispatch(setActiveAdStudioTab('adCreativeNew'));
    dispatch(setAdCreativeNewActivePage('home'));
    setOpenHistory(false);
    if (isMobile) setOpenMobile(false);
  };

  // ── Permission-filtered navigation groups ──────────────────────────────
  const visibleNavGroups = NAV_GROUPS_STATIC.map((group) => ({
    ...group,
    items: group.items.filter((item) =>
      canUseWorkspaceFeature(item.featureKey, workspacePayload)
    ),
  })).filter((g) => g.items.length > 0);

  // ── LIBRARY group items (permission gated) ─────────────────────────────
  const showWorkspace = !memberSession;
  const showMySpace = canUseMySpace(workspacePayload);
  const showLibraryGroup = showWorkspace || showMySpace;

  // ── Layout mode: showExpanded = wide nav with labels ───────────────────
  const showExpanded = isNavExpanded;

  // ── Badge renderer ─────────────────────────────────────────────────────
  const renderBadge = (badge) => {
    if (!badge) return null;
    const isNumeric = typeof badge === 'number';
    return (
      <span
        className={`sidebar-badge inline-flex flex-shrink-0 items-center justify-center font-bold leading-none ${
          isNumeric
            ? showExpanded
              ? 'sidebar-badge--numeric h-[20px] min-w-[20px] rounded-full px-1.5 text-[9px] text-white dark:bg-[#5E66F5]'
              : 'sidebar-badge--numeric h-[18px] w-[18px] rounded-full text-[7px] 2xl:text-[9px] text-white dark:bg-[#5E66F5]'
            : showExpanded
              ? 'sidebar-badge--label rounded-full px-[8px] py-[2.5px] text-[8px] uppercase tracking-[0.06em] dark:bg-[#2A2A2A] dark:text-[#AFAFAF]'
              : 'sidebar-badge--label rounded-[4px] px-[5px] py-[2px] text-[6px] 2xl:text-[8.5px] uppercase tracking-wide dark:bg-[#2A2A2A] dark:text-[#AFAFAF]'
        }`}
      >
        {badge}
      </span>
    );
  };

  // ── Icon renderer (Lucide vs SVG image) ──────────────────────────────────
  const renderIcon = (item, expanded = false) => {
    if (item.lucideIcon) {
      const LucideIcon = item.lucideIcon;
      return (
        <LucideIcon
          className={`sidebar-nav-icon ${
            expanded
              ? 'h-[26px] w-[26px] flex-shrink-0'
              : 'h-[24px] w-[24px]'
          }`}
          aria-hidden="true"
        />
      );
    }
    if (item.lightIcon) {
      const LightIcon = item.lightIcon;
      return (
        <>
          <img
            src={item.icon}
            alt=""
            aria-hidden="true"
            className={`sidebar-nav-icon hidden dark:block ${
              expanded
                ? 'h-[26px] w-[26px] flex-shrink-0 object-contain'
                : 'h-[24px] w-[24px] object-contain'
            }`}
          />
          <LightIcon
            className={`sidebar-nav-icon dark:hidden ${
              expanded
                ? 'h-[26px] w-[26px] flex-shrink-0'
                : 'h-[24px] w-[24px]'
            }`}
            aria-hidden="true"
          />
        </>
      );
    }
    return (
      <img
        src={item.icon}
        alt=""
        aria-hidden="true"
        className={`sidebar-nav-icon ${
          item.id === 'adfactory' ? 'sidebar-adfactory-icon' : ''
        } ${
          expanded
            ? 'h-[26px] w-[26px] flex-shrink-0 object-contain'
            : 'h-[24px] w-[24px] object-contain'
        }`}
      />
    );
  };

  // ── Collapsed (icon-only rail) item ─────────────────────────────────────
  const CollapsedNavItem = ({ item, isActive, onClick }) => (
    <ShadcnTooltip label={item.label} side="right">
      <NavLink
        to={item.link}
        onClick={onClick}
        aria-label={item.label}
        aria-current={isActive ? 'page' : undefined}
        className={`sidebar-nav-item sidebar-nav-item--compact${
          isActive ? ' sidebar-nav-item--active' : ' sidebar-nav-item--inactive'
        } relative flex w-full flex-col items-center justify-center gap-1.5 rounded-[14px] py-2 h-[76px]`}
      >
        {isActive && (
          <span
            aria-hidden="true"
            className="nav-accent-bar absolute -left-2 top-3.5 bottom-3.5 w-[3px] rounded-r-full"
          />
        )}
        <div className="flex h-7 w-7 items-center justify-center">
          {renderIcon(item, false)}
        </div>
        <span className="sidebar-nav-label sidebar-nav-label--compact whitespace-nowrap dark:text-[#AFAFAF]">
          {item.compactLabel || item.label}
        </span>
        {item.badge && (
          <div className="sidebar-nav-badge--compact absolute right-1.5 2xl:right-5 -top-2">
            {renderBadge(item.badge)}
          </div>
        )}
      </NavLink>
    </ShadcnTooltip>
  );

  // ── Expanded (icon + label) item ─────────────────────────────────────────
  const ExpandedNavItem = ({ item, isActive, onClick }) => (
    <NavLink
      to={item.link}
      onClick={onClick}
      aria-current={isActive ? 'page' : undefined}
      className={`sidebar-nav-item sidebar-nav-item--expanded${
        isActive ? ' sidebar-nav-item--active' : ' sidebar-nav-item--inactive'
      } relative flex w-full items-center gap-2.5 rounded-[12px] px-3 py-2`}
    >
      {isActive && (
        <span
          aria-hidden="true"
          className="nav-accent-bar absolute left-0 top-[10px] bottom-[10px] w-[2.5px] rounded-r-full"
        />
      )}
      <div className="flex w-6 flex-shrink-0 items-center justify-center">
        {renderIcon(item, true)}
      </div>
      {item.badge ? (
        <>
          <div className="flex min-w-0 flex-none items-center">
            <span className="sidebar-nav-label sidebar-nav-label--expanded min-w-0 flex-none whitespace-nowrap">
              {item.label}
            </span>
            <span className="inline-flex flex-none items-center" style={{ marginLeft: '12px' }}>
              {renderBadge(item.badge)}
            </span>
            <span
              className={`sidebar-nav-active-dot ml-[2px] flex-shrink-0 ${
                isActive
                  ? 'sidebar-nav-active-dot--visible'
                  : 'sidebar-nav-active-dot--hidden'
              }`}
              aria-hidden="true"
            />
          </div>
        </>
      ) : (
        <>
          <span className="sidebar-nav-label sidebar-nav-label--expanded min-w-0 flex-1 whitespace-nowrap">
            {item.label}
          </span>
          {isActive && <span className="sidebar-nav-active-dot flex-shrink-0" aria-hidden="true" />}
        </>
      )}
    </NavLink>
  );

  // ── Section group header ────────────────────────────────────────────────────────────
  const SectionHeader = ({ label, first = false }) => {
    if (!showExpanded) {
      return isMobile || first ? null : (
        <div className="flex items-center justify-center py-1.5">
          <div className="sidebar-collapsed-group-divider h-[1px] w-5" />
        </div>
      );
    }

    return (
      <div className={`flex items-center gap-2.5 px-3 pb-1.5 ${first ? 'pt-2' : 'pt-3.5'}`}>
        <span className="sidebar-section-label uppercase dark:leading-normal dark:text-[#999]">
          {label}
        </span>
        <span className="sidebar-section-label-divider h-px min-w-0 flex-1" aria-hidden="true" />
      </div>
    );
  };

  // ── Logo box (dark rounded square with icon) ───────────────────────────
  const SidebarLogoMark = ({ className = '' }) => (
    <img
      src={AdsGPTLogoDarkLogo}
      className={`${className} object-contain`}
      alt=""
      aria-hidden="true"
    />
  );

  return (
    <Sidebar
      collapsible="icon"
      className={
        currentRoute === '/assistant' ? '[&_[data-slot=sidebar-inner]]:bg-transparent' : undefined
      }
    >
      <div className="lm-sidebar-surface relative flex h-full w-full flex-col bg-sidebar dark:bg-[#0F0F0F]">

        {/* ── BRAND HEADER ────────────────────────────────────────────────── */}
        <div className="flex-shrink-0">
          {openHistory ? (
            /* History open — full brand logo covering the space + close history button */
            <div className="flex h-[60px] 2xl:h-[68px] items-center justify-between gap-3 pl-3 pr-3.5">
              <Link
                to="/adstudio"
                onClick={handleLogoClick}
                aria-label="Home - Ad Studio Ad Creative"
                className="flex min-w-0 flex-1 items-center gap-3 rounded-md focus:outline-none"
              >
                <img
                  src={AdsGPTLogo}
                  alt="AdsGPT"
                  className="h-8 w-auto max-w-[132px] object-contain object-left"
                />
              </Link>
              <ShadcnTooltip label="Close chat history" side="right">
                <button
                  type="button"
                  onClick={() => setOpenHistory(false)}
                  aria-label="Close history"
                  className="sidebar-header-control flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full transition-all dark:text-[#5A5A5A] dark:hover:text-[#AFAFAF]"
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                </button>
              </ShadcnTooltip>
            </div>
          ) : showExpanded ? (
            <div className="sidebar-header-expanded flex h-[56px] items-center justify-between pl-2 pr-[17px]">
              <Link
                to="/adstudio"
                onClick={handleLogoClick}
                aria-label="Home - Ad Studio Ad Creative"
                className="flex min-w-0 flex-1 items-center justify-start gap-[9px] rounded-md focus:outline-none"
              >
                <SidebarLogoMark className="sidebar-expanded-logo-mark h-9 w-9 flex-shrink-0" />
                <span className="sidebar-expanded-brand-name truncate text-[20px] font-bold leading-none text-[#1F1D29] dark:text-white">
                  AdsGPT
                </span>
              </Link>
              <ShadcnTooltip label="Collapse sidebar" side="right">
                <button
                  type="button"
                  onClick={toggleNavExpanded}
                  aria-label="Collapse sidebar"
                  className="sidebar-header-control sidebar-collapse-handle flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md transition-colors"
                >
                  <ChevronsLeft className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </ShadcnTooltip>
            </div>
          ) : (
            <div
              className={`sidebar-header-compact relative flex items-center justify-center ${
                isMobile ? 'h-[48px]' : 'h-[60px] pt-[10px] pb-[10px]'
              }`}
            >
              <Link
                to="/adstudio"
                onClick={handleLogoClick}
                aria-label="Home - Ad Studio Ad Creative"
                className={`flex items-center justify-center rounded-lg focus:outline-none ${isMobile ? 'h-8 w-8' : 'h-11 w-11'}`}
              >
                <SidebarLogoMark
                  className={`sidebar-compact-logo-mark object-contain ${isMobile ? 'h-6 w-6' : 'h-10 w-10'}`}
                />
              </Link>
              <ShadcnTooltip label="Expand sidebar" side="right">
                <button
                  type="button"
                  onClick={toggleNavExpanded}
                  aria-label="Expand sidebar"
                  className={`sidebar-header-control absolute top-1/2 z-20 flex -translate-y-1/2 items-center justify-center transition-colors ${
                    isMobile
                      ? 'right-0 h-6 w-4 rounded-l-md'
                      : 'sidebar-expand-hitarea -right-5 h-10 w-10 rounded-md'
                  }`}
                >
                  {isMobile ? (
                    <ChevronsRight className="h-3.5 w-3.5" aria-hidden="true" />
                  ) : (
                    <span className="sidebar-expand-handle flex h-[26px] w-[22px] items-center justify-center rounded-md">
                      <ChevronsRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </span>
                  )}
                </button>
              </ShadcnTooltip>
            </div>
          )}
        </div>

        {/* ── DIVIDER ────────────────────────────────────────────────────────── */}
        {!openHistory && !showExpanded && (
          <div className="sidebar-section-divider sidebar-collapsed-header-divider mx-auto h-[1px] w-5 flex-shrink-0" />
        )}

        {/* ── CHAT HISTORY SECTION (only when open) ─────────────────────────── */}
        {openHistory && activeAdStudioTabId === 'adCopy' && (
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            <ChatHistorySection isSidebarOpen={openHistory} />
          </div>
        )}

        {/* ── NAVIGATION ────────────────────────────────────────────────────── */}
        {!openHistory && (
          <nav
            id="app-sidebar-navigation"
            aria-label="Primary navigation"
            className={`flex min-h-0 flex-1 flex-col overflow-y-auto scrollbar-hide pb-2 ${
              !showExpanded && !isMobile ? 'pt-1' : ''
            }`}
          >

            {/* Main nav groups: CREATE, MEASURE */}
            {visibleNavGroups.map((group, index) => (
              <div key={group.id} className={!showExpanded && index > 0 ? 'mt-1' : undefined}>
                <SectionHeader label={group.label} first={index === 0} />
                <div className={showExpanded ? 'space-y-1.5 px-3' : 'space-y-1 px-2'}>
                  {group.items.map((item) => {
                    const active = isItemActive(item);
                    const onClick = () => handleNavClick(item.link);
                    return showExpanded ? (
                      <ExpandedNavItem key={item.id} item={item} isActive={active} onClick={onClick} />
                    ) : (
                      <CollapsedNavItem key={item.id} item={item} isActive={active} onClick={onClick} />
                    );
                  })}
                </div>
              </div>
            ))}

            {/* LIBRARY group */}
            <div className="mt-1">

              {/* Logout (members only) — placed top of the library dividing line */}
              {memberSession && (
                <div className={showExpanded ? 'px-2.5 pb-1' : 'px-2 pb-1'}>
                  {showExpanded ? (
                    <button
                      type="button"
                      onClick={() => {
                        clearWorkspaceToken();
                        window.location.href = '/workspace-login';
                      }}
                      aria-label="Log out"
                      className="sidebar-nav-item sidebar-nav-item--expanded sidebar-nav-item--inactive relative flex w-full items-center gap-4 rounded-[15px] px-4 py-2.5"
                    >
                      <div className="flex w-6.5 flex-shrink-0 items-center justify-center">
                        <LogOut className="sidebar-nav-icon h-[26px] w-[26px] flex-shrink-0" aria-hidden="true" />
                      </div>
                      <span className="sidebar-nav-label sidebar-nav-label--expanded flex-1 text-left">
                        Log out
                      </span>
                    </button>
                  ) : (
                    <ShadcnTooltip label="Log out" side="right">
                      <button
                        type="button"
                        onClick={() => {
                          clearWorkspaceToken();
                          window.location.href = '/workspace-login';
                        }}
                        aria-label="Log out"
                        className="sidebar-nav-item sidebar-nav-item--compact sidebar-nav-item--inactive relative flex w-full flex-col items-center justify-center gap-1.5 rounded-[14px] py-2 h-[76px]"
                      >
                        <div className="flex h-7 w-7 items-center justify-center">
                          <LogOut className="sidebar-nav-icon h-[24px] w-[24px]" aria-hidden="true" />
                        </div>
                        <span className="sidebar-nav-label sidebar-nav-label--compact whitespace-nowrap dark:text-[#AFAFAF]">
                          Log out
                        </span>
                      </button>
                    </ShadcnTooltip>
                  )}
                </div>
              )}

              {showLibraryGroup && (
                <div>
                  <SectionHeader label="LIBRARY" />
                  <div className={showExpanded ? 'space-y-1.5 px-3' : 'space-y-1 px-2'}>

                    {/* Workspace (owner only) */}
                    {showWorkspace && (() => {
                      const active = currentRoute === '/workspace/members';
                      const doNav = () => {
                        setOpenHistory(false);
                        if (isMobile) setOpenMobile(false);
                      };
                      if (showExpanded) {
                        return (
                          <Link
                            key="workspace"
                            to="/workspace/members"
                            onClick={doNav}
                            aria-current={active ? 'page' : undefined}
                            className={`sidebar-nav-item sidebar-nav-item--expanded${active ? ' sidebar-nav-item--active' : ' sidebar-nav-item--inactive'} relative flex w-full items-center gap-2.5 rounded-[12px] px-3 py-2`}
                          >
                            {active && (
                              <span
                                aria-hidden="true"
                                className="nav-accent-bar absolute left-0 top-[10px] bottom-[10px] w-[2.5px] rounded-r-full"
                              />
                            )}
                            <div className="flex w-6 flex-shrink-0 items-center justify-center">
                              <Users className="sidebar-nav-icon h-[26px] w-[26px] flex-shrink-0" />
                            </div>
                            <span className="sidebar-nav-label sidebar-nav-label--expanded min-w-0 flex-1 whitespace-nowrap">Workspace</span>
                            {active && <span className="sidebar-nav-active-dot ml-auto flex-shrink-0" aria-hidden="true" />}
                          </Link>
                        );
                      }
                      return (
                        <ShadcnTooltip key="workspace" label="Workspace" side="right">
                          <Link
                            to="/workspace/members"
                            onClick={doNav}
                            aria-label="Workspace"
                            aria-current={active ? 'page' : undefined}
                            className={`sidebar-nav-item sidebar-nav-item--compact${active ? ' sidebar-nav-item--active' : ' sidebar-nav-item--inactive'} relative flex w-full flex-col items-center justify-center gap-1.5 rounded-[14px] py-2 h-[76px]`}
                          >
                            {active && (
                              <span
                                aria-hidden="true"
                                className="nav-accent-bar absolute -left-2 top-3.5 bottom-3.5 w-[3px] rounded-r-full"
                              />
                            )}
                            <div className="flex h-7 w-7 items-center justify-center">
                              <Users className="sidebar-nav-icon h-[24px] w-[24px]" />
                            </div>
                            <span className="sidebar-nav-label sidebar-nav-label--compact whitespace-nowrap dark:text-[#AFAFAF]">
                              Workspace
                            </span>
                          </Link>
                        </ShadcnTooltip>
                      );
                    })()}

                    {/* My Space (gated by canUseMySpace) */}
                    {showMySpace && (() => {
                      const active = currentRoute === '/my-space';
                      const doNav = () => {
                        setOpenHistory(false);
                        dispatch(setActivePage('myVideos'));
                        if (isMobile) setOpenMobile(false);
                      };
                      if (showExpanded) {
                        return (
                          <Link
                            key="myspace"
                            id="sidebar-my-space-button"
                            to="/my-space"
                            onClick={doNav}
                            aria-current={active ? 'page' : undefined}
                            className={`sidebar-nav-item sidebar-nav-item--expanded${active ? ' sidebar-nav-item--active' : ' sidebar-nav-item--inactive'} relative flex w-full items-center gap-2.5 rounded-[12px] px-3 py-2`}
                          >
                            {active && (
                              <span
                                aria-hidden="true"
                                className="nav-accent-bar absolute left-0 top-[10px] bottom-[10px] w-[2.5px] rounded-r-full"
                              />
                            )}
                            <div className="flex w-6 flex-shrink-0 items-center justify-center">
                              <Library className="sidebar-nav-icon h-[26px] w-[26px] flex-shrink-0" />
                            </div>
                            <span className="sidebar-nav-label sidebar-nav-label--expanded min-w-0 flex-1 text-left whitespace-nowrap">My Space</span>
                            <div className="flex flex-shrink-0 items-center gap-2 ml-auto">
                              {savedCount > 0 && renderBadge(savedCount)}
                              {active && <span className="sidebar-nav-active-dot" aria-hidden="true" />}
                            </div>
                          </Link>
                        );
                      }
                      return (
                        <ShadcnTooltip key="myspace" label="My Space" side="right">
                          <Link
                            key="myspace"
                            id="sidebar-my-space-button"
                            to="/my-space"
                            onClick={doNav}
                            aria-label="My Space"
                            aria-current={active ? 'page' : undefined}
                            className={`sidebar-nav-item sidebar-nav-item--compact${active ? ' sidebar-nav-item--active' : ' sidebar-nav-item--inactive'} relative flex w-full flex-col items-center justify-center gap-1.5 rounded-[14px] py-2 ${
                              savedCount > 0 ? 'h-[90px]' : 'h-[76px]'
                            }`}
                          >
                            {active && (
                              <span
                                aria-hidden="true"
                                className="nav-accent-bar absolute -left-2 top-3.5 bottom-3.5 w-[3px] rounded-r-full"
                              />
                            )}
                            <div className="flex h-7 w-7 items-center justify-center">
                              <Library className="sidebar-nav-icon h-[24px] w-[24px]" />
                            </div>
                            <span className="sidebar-nav-label sidebar-nav-label--compact whitespace-nowrap dark:text-[#AFAFAF]">
                              My Space
                            </span>
                            {savedCount > 0 && (
                              <div className="sidebar-nav-badge--compact absolute right-1.5 2xl:right-5 -top-2">
                                {renderBadge(savedCount)}
                              </div>
                            )}
                          </Link>
                        </ShadcnTooltip>
                      );
                    })()}
                  </div>
                </div>
              )}
            </div>

          </nav>
        )}

        {/* Ad Copy — Chat History button placed directly above account/profile tab */}
        {currentRoute === '/adstudio' && activeAdStudioTabId === 'adCopy' && (
          <div className={showExpanded || openHistory ? 'px-3 pb-1 pt-1 flex-shrink-0' : 'px-2 pb-1 pt-1 flex-shrink-0'}>
            {showExpanded || openHistory ? (
              <button
                type="button"
                onClick={() => setOpenHistory(!openHistory)}
                aria-label="Chat History"
                className={`sidebar-nav-item sidebar-nav-item--expanded${
                  openHistory ? ' sidebar-nav-item--active' : ' sidebar-nav-item--inactive'
                } relative flex w-full items-center gap-2.5 rounded-[12px] px-3 py-2`}
              >
                {openHistory && (
                  <span
                    aria-hidden="true"
                    className="nav-accent-bar absolute left-0 top-[10px] bottom-[10px] w-[2.5px] rounded-r-full"
                  />
                )}
                <div className="flex w-6 flex-shrink-0 items-center justify-center">
                  <History className="sidebar-nav-icon h-[26px] w-[26px] flex-shrink-0" aria-hidden="true" />
                </div>
                <span className="sidebar-nav-label sidebar-nav-label--expanded min-w-0 flex-1 text-left whitespace-nowrap">
                  Chat History
                </span>
                {openHistory && <span className="sidebar-nav-active-dot flex-shrink-0" aria-hidden="true" />}
              </button>
            ) : (
              <ShadcnTooltip label="Chat History" side="right">
                <button
                  type="button"
                  onClick={() => setOpenHistory(!openHistory)}
                  aria-label="Chat History"
                  className={`sidebar-nav-item sidebar-nav-item--compact${
                    openHistory ? ' sidebar-nav-item--active' : ' sidebar-nav-item--inactive'
                  } relative flex w-full flex-col items-center justify-center gap-1.5 rounded-[14px] py-2 h-[76px]`}
                >
                  {openHistory && (
                    <span
                      aria-hidden="true"
                      className="nav-accent-bar absolute -left-2 top-3.5 bottom-3.5 w-[3px] rounded-r-full"
                    />
                  )}
                  <div className="flex h-7 w-7 items-center justify-center">
                    <History className="sidebar-nav-icon h-[24px] w-[24px]" aria-hidden="true" />
                  </div>
                  <span className="sidebar-nav-label sidebar-nav-label--compact whitespace-nowrap dark:text-[#AFAFAF]">
                    History
                  </span>
                </button>
              </ShadcnTooltip>
            )}
          </div>
        )}

        {/* ── PROFILE FOOTER (anchored at bottom) ───────────────────────────── */}
        {(!memberSession || (memberSession && canUseWorkspaceFeature('profile', workspacePayload))) ? (
          <div
            className={`sidebar-profile-footer relative flex flex-shrink-0 items-center justify-center ${
              showExpanded
                ? 'h-[88px] px-2.5 pb-2.5 pt-1'
                : openHistory
                  ? 'h-[58px] px-2 pb-2 pt-1'
                  : isMobile
                    ? 'h-[54px] pb-2 pt-1'
                    : 'h-[64px] pb-4 pt-1'
            }`}
          >
            {currentRoute === '/profile' && !openHistory && !showExpanded && (
              <span
                aria-hidden="true"
                className="nav-accent-bar absolute left-0 top-1/2 -translate-y-1/2 h-7 w-[3px] rounded-r-full"
              />
            )}
            <ShadcnTooltip label={openHistory || showExpanded ? undefined : 'User Profile'} side="right">
              <Link
                to="/profile"
                onClick={() => {
                  setOpenHistory(false);
                  if (isMobile) setOpenMobile(false);
                }}
                aria-label={openHistory || showExpanded ? undefined : 'User Profile'}
                aria-current={currentRoute === '/profile' ? 'page' : undefined}
                className={
                  openHistory || showExpanded
                    ? `sidebar-nav-item sidebar-nav-item--expanded${
                        currentRoute === '/profile'
                          ? ' sidebar-nav-item--active'
                          : ' sidebar-nav-item--inactive'
                      } ${showExpanded ? 'sidebar-account-card' : ''} relative flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2.5 transition-all`
                    : 'group relative flex items-center justify-center rounded-full focus:outline-none cursor-pointer'
                }
              >
                {currentRoute === '/profile' && (openHistory || showExpanded) && (
                  <span
                    aria-hidden="true"
                    className="nav-accent-bar absolute left-0 top-[11px] bottom-[11px] w-[2px] rounded-r-full"
                  />
                )}
                {/* Avatar */}
                <div className="sidebar-profile-avatar-shell relative flex-shrink-0">
                  <div
                    className={`sidebar-profile-button ${
                      currentRoute === '/profile' ? 'sidebar-profile-button-active' : ''
                    } relative flex ${showExpanded ? 'h-10 w-10' : openHistory ? 'h-8 w-8' : isMobile ? 'h-9 w-9' : 'h-10 w-10'} items-center justify-center overflow-hidden rounded-full shadow-xs transition-transform duration-200 group-hover:scale-105 active:scale-95`}
                  >
                    {profileImage ? (
                      <img
                        src={profileImage}
                        alt=""
                        aria-hidden="true"
                        className="sidebar-profile-avatar h-full w-full rounded-full object-cover"
                      />
                    ) : (
                      <span className="sidebar-profile-avatar flex h-full w-full items-center justify-center text-center text-xs 2xl:text-[13px] font-bold">
                        {profileInitials}
                      </span>
                    )}
                  </div>
                  <span className="sidebar-profile-status" aria-hidden="true" />
                </div>

                {/* Name + role */}
                {(openHistory || showExpanded) && (
                  <div className="flex min-w-0 flex-1 flex-col justify-center gap-1">
                    <div className="flex min-w-0 items-center gap-1">
                      <span
                        className="sidebar-profile-name min-w-0 flex-1 truncate dark:text-white"
                        title={formattedProfileDisplayName}
                      >
                        {formattedProfileDisplayName}
                      </span>
                      {showExpanded && planName && (
                        <span className="sidebar-account-plan flex-shrink-0 truncate" title={planName}>
                          {planName}
                        </span>
                      )}
                    </div>
                    {showExpanded && hasCreditSummary ? (
                      <>
                        <div className="sidebar-account-progress h-[2px] w-full overflow-hidden rounded-full">
                          <span
                            className="block h-full rounded-full"
                            style={{ width: `${creditUsagePercentage}%` }}
                          />
                        </div>
                        <div className="sidebar-account-credits">
                          <span title={`${totalCredits.toLocaleString()} total credits`}>
                            {totalCredits.toLocaleString('en', {
                              notation: 'compact',
                              maximumFractionDigits: 1,
                            })}{' '}
                            total
                          </span>
                          <span
                            className="text-right"
                            title={`${remainingCredits.toLocaleString()} credits left`}
                          >
                            {remainingCredits.toLocaleString('en', {
                              notation: 'compact',
                              maximumFractionDigits: 1,
                            })}{' '}
                            left
                          </span>
                        </div>
                      </>
                    ) : (
                      <span className="sidebar-profile-role truncate dark:text-[#5A5A5A]">
                        {showExpanded ? profileFooterLabel : memberSession ? 'Member' : 'Owner'}
                      </span>
                    )}
                  </div>
                )}
              </Link>
            </ShadcnTooltip>
          </div>
        ) : null}

        <div className="sidebar-edge-divider absolute top-0 right-0 h-full w-[1px]" />
      </div>
    </Sidebar>
  );
};

export default AppSidebar;
