import { FilerobotEditorShimmer } from '@/components/AdStudio/AdCreatives/CreativeChat/Loader/CreativeGeneratingLoader';
import { FilerobotEditor } from '@/pages/Editor/ImageEditor/FilerobotEditor';
import { useDispatch, useSelector } from 'react-redux';
import useImage from 'use-image';

import AdPrompt from '@/components/common/AdPrompt/AdPromptComponent';
import AppSidebar from '@/components/layout/sidebar/AppSidebar';
import TopHeader from '@/components/layout/header/TopHeader';
import { Outlet, useLocation } from 'react-router-dom';
import { SidebarProvider } from '@/components/ui/sidebar';
import TourGuide from '@/components/layout/TourGuide';
import AdBlockerModal from '@/components/layout/AdBlockerModal';
import OnboardingProvider from '@/onboarding';
import toast, { Toaster } from 'react-hot-toast';
import { startGlobalInteractionTracking } from '@/utils/userInteractionTracker';
import { useEffect, useRef } from 'react';
import { trackEvent } from '@/apis/analytics/analyticsApi';
import { trackGA4PageView, GA4Events } from '@/utils/ga4';
import { setCurrentSeesionId } from '@/store/reducers/userInteraction/userInteraction';

const HOST = import.meta.env.VITE_SOCKET_URL;
const S3_BASE_URL = import.meta.env.VITE_S3_BASE_URL;
const ENABLE_NEW_LAYOUT = import.meta.env.VITE_ENABLE_NEW_EDITOR_LAYOUT === 'true';

const Layout = () => {
  const { baseImage, isEditorOpen, adIndex, isOldEditorOpen } = useSelector(
    (state) => state.editor
  );
  const location = useLocation();
  const { userData } = useSelector((state) => state.socket);
  const dispatch = useDispatch();
  const activeAdStudioTabId = useSelector((state) => state.adStudioTabs.activeAdStudioTabId);
  const isDarkMode = useSelector((state) => state.theme.isDarkMode);

  useEffect(() => {
    const root = document.documentElement;
    if (isDarkMode) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    localStorage.setItem('isDarkMode', JSON.stringify(isDarkMode));
  }, [isDarkMode]);

  // Track time spent on each page
  const pageEnterTime = useRef(Date.now());
  const prevPage = useRef(location.pathname);

  useEffect(() => {
    let sessionId;

    if (location.pathname === '/adinsights') {
      sessionId = sessionStorage.getItem('em1');
      dispatch(setCurrentSeesionId(sessionId));
    } else if (location.pathname === '/adstudio' && activeAdStudioTabId === 'adCopy') {
      sessionId = sessionStorage.getItem('acs1');
      dispatch(setCurrentSeesionId(sessionId));
    } else if (location.pathname === '/adstudio' && activeAdStudioTabId === 'adCreative') {
      sessionId = sessionStorage.getItem('acs2');
      dispatch(setCurrentSeesionId(sessionId));
    } else if (location.pathname === '/adstudio' && activeAdStudioTabId === 'adVideo') {
      sessionId = sessionStorage.getItem('avs3');
      dispatch(setCurrentSeesionId(sessionId));
    }
    startGlobalInteractionTracking(location, null, 'pageRedirect', userData, sessionId);
    GA4Events.sessionStarted();

    const targetTab = (activeAdStudioTabId || '').replace('New', '');
    const targetPath = location.pathname === '/adstudio' && targetTab
      ? `/adstudio/${targetTab}`
      : location.pathname;

    trackGA4PageView(targetPath);
    GA4Events.featureVisitedByRoute(location.pathname);

    // Save time spent on previous page then record new page entry
    const now = Date.now();
    const timeSpent = Math.round((now - pageEnterTime.current) / 1000);
    if (prevPage.current && userData?.user_id) {
      trackEvent({ type: 'page_view', page: prevPage.current, time_spent: timeSpent });
    }
    const normalizedPath = location.pathname.replace(/^\/landing-page-analyzer\/[^/]+/, '/landing-page-analyzer');
    prevPage.current = normalizedPath;
    pageEnterTime.current = now;
  }, [location, userData, activeAdStudioTabId]);
  const [baseImg, baseImgStatus] = useImage(
    baseImage ? `${HOST}/adsgpt/img/preview?url=${S3_BASE_URL}${baseImage}` : null,
    'Anonymous'
  );
  if (isOldEditorOpen) {
    // ------------------ OLD LAYOUT ------------------
    return (
      <div className="layout_container relative flex">
        <div className="fixed -top-[25%] right-[20vw] z-[-1] h-[15vw] w-[15vw] rounded-full bg-[linear-gradient(0deg,_#15DCFF_0%,_#5E66F5_100%)] opacity-100 blur-[100px] 2xl:blur-[160px]"></div>

        <SidebarProvider>
          <AppSidebar />
          <main className="relative flex h-svh w-full flex-col overflow-hidden">
            <TopHeader />
            <div className="flex dark:bg-inherit bg-[#F7F4EE] min-h-0 flex-1 flex-col overflow-y-auto p-4 pb-0!">
              <Outlet />
            </div>
            <TourGuide />
            <OnboardingProvider />
            {/* <AdBlockerModal /> */}
          </main>
        </SidebarProvider>

        <div className="fixed top-[85%] left-1/2 z-[-1] h-[100vw] w-[100vw] -translate-x-1/2 rounded-full bg-[linear-gradient(0deg,_#15DCFF_0%,_#5E66F5_100%)] opacity-100 blur-[100px] 2xl:top-[90%] 2xl:h-[130vw] 2xl:w-[130vw] 2xl:blur-[150px]"></div>
      </div>
    );
  }

  // ------------------ NEW LAYOUT ------------------
  // const { baseImage, isEditorOpen, adIndex } = useSelector((state) => state.editor);
  // const [baseImg, baseImgStatus] = useImage(
  //   baseImage ? `${HOST}/adsgpt/img/preview?url=${S3_BASE_URL}${baseImage}` : null,
  //   'Anonymous'
  // );

  const usesAdsOperationsAmbient = [
    '/ads-manager',
    '/meta-ads',
    '/google-ads',
    '/tiktok-ads',
    '/autopilot',
    '/autopilot/meta',
  ].includes(location.pathname);

  const lightAmbientClassName =
    usesAdsOperationsAmbient
      ? 'light-ambient-ui-layer ads-manager-ui-layer'
      : location.pathname === '/brandiq'
        ? 'light-ambient-ui-layer brandiq-ui-layer'
        : location.pathname === '/adstudio'
          ? 'light-ambient-ui-layer adstudio-ui-layer'
          : location.pathname === '/workspace/members'
            ? 'light-ambient-ui-layer workspace-ui-layer'
            : location.pathname === '/my-space'
              ? 'light-ambient-ui-layer my-space-ui-layer'
              : location.pathname === '/profile'
                ? 'light-ambient-ui-layer account-ui-layer'
                : undefined;

  return (
    <div className="layout_container text-foreground relative flex bg-[#F7F4EE] dark:bg-transparent">
      {location.pathname !== '/adfactory' && location.pathname !== '/assistant' && (
        <div className="pointer-events-none fixed -top-[25%] right-[20vw] z-[-1] h-[15vw] w-[15vw] rounded-full bg-[linear-gradient(0deg,_#15DCFF_0%,_#5E66F5_100%)] opacity-0 blur-[100px] 2xl:blur-[160px] dark:opacity-100"></div>
      )}

      <Toaster position="top-center" reverseOrder={false} />
      {/* <AdBlockerModal /> */}

      <SidebarProvider className={lightAmbientClassName}>
        {!isEditorOpen && (
          <>
            <AppSidebar />
            <main className="relative flex h-svh w-full flex-col overflow-hidden bg-transparent dark:bg-inherit">
              <TopHeader />
              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4 pb-0! bg-transparent dark:bg-inherit">
                <Outlet />
              </div>
              <TourGuide />
              <OnboardingProvider />
            </main>
          </>
        )}

        {isEditorOpen && (
          <>
            {baseImgStatus === 'loaded' && baseImg ? (
              <FilerobotEditor
                toast={toast}
                adIndex={adIndex}
                source={baseImg}
                isImgEditorShown={isEditorOpen}
              />
            ) : (
              <FilerobotEditorShimmer />
            )}
          </>
        )}
      </SidebarProvider>
      {location.pathname !== '/adfactory' && location.pathname !== '/assistant' && (
        <div className="pointer-events-none fixed top-[85%] left-1/2 z-[-1] h-[100vw] w-[100vw] -translate-x-1/2 rounded-full bg-[linear-gradient(0deg,_#15DCFF_0%,_#5E66F5_100%)] opacity-0 blur-[100px] 2xl:top-[90%] 2xl:h-[130vw] 2xl:w-[130vw] 2xl:blur-[150px] dark:opacity-100"></div>
      )}
    </div>
  );
};

export default Layout;
