import { FilerobotEditorShimmer } from '@/components/AdStudio/AdCreatives/CreativeChat/Loader/CreativeGeneratingLoader';
import { FilerobotEditor } from '@/pages/Editor/ImageEditor/FilerobotEditor';
import { useDispatch, useSelector } from 'react-redux';
import useImage from 'use-image';

import AdPrompt from '@/components/common/AdPrompt/AdPromptComponent';
import AppSidebar from '@/components/layout/sidebar/AppSidebar';
import TopHeader from '@/components/layout/header/TopHeader';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import FreeAdBanner from '@/components/BrandSetup/FreeAdBanner';
import useOnboardingEligibility from '@/hooks/useOnboardingEligibility';
import { SidebarProvider } from '@/components/ui/sidebar';
// import TourGuide from '@/components/layout/TourGuide';
import AdBlockerModal from '@/components/layout/AdBlockerModal';
// import OnboardingProvider from '@/onboarding';
import toast, { Toaster } from 'react-hot-toast';
import { startGlobalInteractionTracking } from '@/utils/userInteractionTracker';
import { useEffect, useRef } from 'react';
import { trackEvent } from '@/apis/analytics/analyticsApi';
import { trackGA4PageView, GA4Events } from '@/utils/ga4';
import { setCurrentSeesionId } from '@/store/reducers/userInteraction/userInteraction';

const HOST = import.meta.env.VITE_SOCKET_URL;
const S3_BASE_URL = import.meta.env.VITE_S3_BASE_URL;
const ENABLE_NEW_LAYOUT = import.meta.env.VITE_ENABLE_NEW_EDITOR_LAYOUT === 'true';

// Per-tab marker for the first-run redirect. See the effect that uses it.
const ONBOARDING_OFFERED_KEY = 'adsgpt.onboarding.offered';

const Layout = () => {
  // Whether the free render is still owed, and which session the offer bar owes
  // it in. One call per app load, shared with OnBoardHome's resume.
  const { freeRenderAvailable, resumeSessionId, shouldStartOnboarding } =
    useOnboardingEligibility();
  const { baseImage, isEditorOpen, adIndex, isOldEditorOpen } = useSelector(
    (state) => state.editor
  );
  const location = useLocation();
  const navigate = useNavigate();

  // ── First run: show onboarding once, then never unasked again ────────────
  //
  // A brand-new user lands here, not on the brand-setup screen, because every
  // authenticated route renders inside this Layout. Without this they would
  // only ever find onboarding by noticing the offer bar.
  //
  // "Once" needs two guards, not one. The server side is
  // `shouldStartOnboarding`, which goes false the moment the user finishes,
  // skips, or spends the free render. The tab side is the marker below, and it
  // covers the gap in between: a user who is redirected and then presses BACK
  // has not skipped anything yet, so the server still says yes. A component ref
  // cannot hold that — `/onboarding` renders OUTSIDE this Layout, so coming
  // back remounts it and resets any ref — which would bounce them forward
  // again, a trap with no way out but the URL bar. `sessionStorage` survives
  // the remount and is scoped to this tab, so a genuinely new session on
  // another day still gets the offer.
  useEffect(() => {
    if (!shouldStartOnboarding) return;
    if (location.pathname.startsWith('/onboarding')) return;

    try {
      if (sessionStorage.getItem(ONBOARDING_OFFERED_KEY) === '1') return;
      sessionStorage.setItem(ONBOARDING_OFFERED_KEY, '1');
    } catch {
      // Storage blocked. Redirecting once per mount is still better than never
      // offering onboarding at all, and the server guard stops it repeating
      // the moment the user skips or finishes.
    }

    // `replace`, so Back returns to wherever they actually came from rather
    // than to the route we bounced them off.
    navigate('/onboarding', { replace: true });
  }, [shouldStartOnboarding, location.pathname, navigate]);

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
  const lastTrackedGa4Path = useRef(null);

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

    if (lastTrackedGa4Path.current !== targetPath) {
      trackGA4PageView(targetPath);
      lastTrackedGa4Path.current = targetPath;
    }

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
          <main className="relative flex h-svh min-w-0 flex-1 flex-col overflow-hidden">
            <TopHeader />
            <div
              className={`flex dark:bg-inherit bg-[#F7F4EE] min-h-0 flex-1 flex-col ${
                location.pathname === '/adfactory' ? 'overflow-hidden' : 'overflow-y-auto'
              } p-4 pb-0!`}
            >
              <Outlet />
            </div>
            {/* <TourGuide /> */}
            {/* <OnboardingProvider /> */}
            {/* <AdBlockerModal /> */}
          </main>
        </SidebarProvider>

        <div className="fixed top-[85%] left-1/2 z-[-1] h-[100vw] w-[100vw] -translate-x-1/2 rounded-full bg-[linear-gradient(0deg,_#15DCFF_0%,_#5E66F5_100%)] opacity-100 blur-[100px] 2xl:top-[90%] 2xl:h-[130vw] 2xl:w-[130vw] 2xl:blur-[150px]"></div>
      </div>
    );
  }

  // ------------------ NEW LAYOUT ------------------
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

      <SidebarProvider className={lightAmbientClassName}>
        {!isEditorOpen && (
          <>
            <AppSidebar />
            <main className="relative flex h-svh min-w-0 flex-1 flex-col overflow-hidden bg-transparent dark:bg-inherit">
              {/* Above the header, full width: it is an offer about the product,
                  not a control belonging to whatever page is open.
                  `available` is the server's answer now, not a hardcoded true —
                  it goes false the moment the free render is claimed, on every
                  device at once. */}
              {/* `/onboarding`, not `/` — the root redirects to /adstudio, which
                  is where the user already is. The storyboard workspace lives
                  on its own full-screen route outside this Layout.
                  `?session=` when the user skipped a run with the render still
                  unspent: the bar owes them THAT session, not a fresh start. */}
              <FreeAdBanner
                available={freeRenderAvailable}
                onCreate={() =>
                  navigate(
                    resumeSessionId
                      ? `/onboarding?session=${encodeURIComponent(resumeSessionId)}`
                      : '/onboarding'
                  )
                }
              />
              <TopHeader />
              <div
                className={`flex min-h-0 flex-1 flex-col ${
                  location.pathname === '/adfactory' ? 'overflow-hidden' : 'overflow-y-auto'
                } p-4 pb-0! bg-transparent dark:bg-inherit`}
              >
                <Outlet />
              </div>
              {/* <TourGuide /> */}
              {/* <OnboardingProvider /> */}
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
