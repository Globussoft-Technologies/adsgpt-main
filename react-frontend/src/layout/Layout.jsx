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
import toast, { Toaster } from 'react-hot-toast';
import { startGlobalInteractionTracking } from '@/utils/userInteractionTracker';
import { useEffect } from 'react';
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
            <div className="flex dark:bg-inherit bg-[#f6f7fb] min-h-0 flex-1 flex-col overflow-y-auto p-4 pb-0!">
              <Outlet />
            </div>
            <TourGuide />
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

  return (
    <div className="layout_container text-foreground relative flex dark:bg-transparent">
      {location.pathname !== '/adfactory' && location.pathname !== '/assistant' && (
        <div className="fixed -top-[25%] right-[20vw] z-[-1] h-[15vw] w-[15vw] rounded-full bg-[linear-gradient(0deg,_#15DCFF_0%,_#5E66F5_100%)] opacity-70 blur-[100px] 2xl:blur-[160px] dark:opacity-100"></div>
      )}
      {location.pathname === '/assistant' && <div className="fixed inset-0 z-[-1] bg-black"></div>}

      <Toaster position="top-center" reverseOrder={false} />
      {/* <AdBlockerModal /> */}

      <SidebarProvider>
        {!isEditorOpen && (
          <>
            <AppSidebar />
            <main className="relative flex h-svh w-full flex-col overflow-hidden">
              <TopHeader />
              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4 pb-0! dark:bg-inherit">
                <Outlet />
              </div>
              <TourGuide />
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
        <div className="fixed top-[85%] left-1/2 z-[-1] h-[100vw] w-[100vw] -translate-x-1/2 rounded-full bg-[linear-gradient(0deg,_#15DCFF_0%,_#5E66F5_100%)] opacity-30 blur-[100px] 2xl:top-[90%] 2xl:h-[130vw] 2xl:w-[130vw] 2xl:blur-[150px] dark:opacity-100"></div>
      )}
    </div>
  );
};

export default Layout;
