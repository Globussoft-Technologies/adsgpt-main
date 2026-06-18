import Logout from '@/backLogs/Logout';
import QuerySaverRedirector from '@/backLogs/QuerySaverRedirector';
// import AdFactoryWorkflowDarkReal2 from '@/components/AdFactory2/AdFactoryWorkflow';
import AdFactoryWorkflowDarkReal from '@/components/AdFactory/AdFactoryWorkflow';
import Layout from '@/layout/Layout';
import AIAssistantPage from '@/pages/AIAssistant/AIAssistantPage';
import AdFactoryPage from '@/pages/AdFactory/AdFactoryPage';
import AdInsightsPage from '@/pages/AdInsights/AdInsightsPage';
import AdLibraryPage from '@/pages/AdLibrary/AdLibraryPage';
import AdStudioPage from '@/pages/AdStudio/AdStudioPage';
// HIDE-MARK — Landing Page Analyzer hidden (routes + imports).
// import LandingPageAnalyzerHome from '@/pages/LandingPageAnalyzer/LandingPageAnalyzerHome';
// import LandingPageAnalyzerResultPage from '@/pages/LandingPageAnalyzer/LandingPageAnalyzerResultPage';
import MetaAdsPage from '@/pages/MetaAds/MetaAdsPage';
import GoogleAdsPage from '@/pages/GoogleAds/GoogleAdsPage';
import AdsManagerPage from '@/pages/AdsManager/AdsManagerPage';
import AutopilotHomePage from '@/pages/Autopilot/AutopilotHomePage';
import AutopilotPage from '@/pages/Autopilot/AutopilotPage';
import BrandIQPage from '@/pages/BrandIQ/BrandIQPage';
import UserOnBoardPage from '@/pages/OnBoard/UserOnBoardPage';
import UserProfilePage from '@/pages/Profile/UserProfilePage';
import AuthWrapper from '@/utils/AuthWrapper';
import DevAuthPage from '@/pages/DevAuth/DevAuthPage';
import RunBackLog from '@/utils/RunBackLog';
import { createBrowserRouter, Navigate } from 'react-router-dom';
const REDIRECT_TO_LOGOUT = import.meta.env.VITE_AMEMBER_URL;

const router = createBrowserRouter([
  {
    path: '/',
    element: (
      <RunBackLog>
        <AuthWrapper>
          <Layout />
        </AuthWrapper>
      </RunBackLog>
    ),
    children: [
      {
        index: true,
        element: <Navigate to="adstudio" replace />,
      },
      { path: 'adstudio', element: <AdStudioPage /> },
      { path: 'adinsights', element: <AdInsightsPage /> },
      { path: 'ad-library', element: <AdLibraryPage /> },
      { path: 'brandiq', element: <BrandIQPage /> },
      { path: 'adfactory', element: <AdFactoryPage /> },
      { path: 'ads-manager', element: <AdsManagerPage /> },
      { path: 'meta-ads', element: <MetaAdsPage /> },
      { path: 'google-ads', element: <GoogleAdsPage /> },
      // HIDE-MARK — Landing Page Analyzer routes hidden.
      // Landing Page Analyzer — URL-input home, then the result view by sessionId.
      // { path: 'landing-page-analyzer', element: <LandingPageAnalyzerHome /> },
      // { path: 'landing-page-analyzer/:id', element: <LandingPageAnalyzerResultPage /> },
      // Autopilot has the same picker-then-dashboard structure as Ads
      // Manager: `/autopilot` is the platform picker home, `/autopilot/meta`
      // is the actual dashboard for Meta. Google/TikTok land on the picker
      // home once those integrations exist.
      { path: 'autopilot', element: <AutopilotHomePage /> },
      { path: 'autopilot/meta', element: <AutopilotPage /> },
      { path: 'assistant', element: <AIAssistantPage /> },
      { path: '/profile', element: <UserProfilePage /> },
      { path: 'onboarding', element: <UserOnBoardPage /> },
      // { path: 'adfactory-demo', element: <AdFactoryWorkflowDarkReal2 /> },
    ],
  },
  {
    path: '/logout',
    element: <Logout targetUrl={REDIRECT_TO_LOGOUT + '/logout'} />,
  },
  {
    // Dev-only cookie-setter. Mounted OUTSIDE the RunBackLog / AuthWrapper
    // so it can set the access-token cookie without being redirected to
    // aMember first. Usage: /dev-auth#t=<JWT>[&to=/autopilot]
    path: '/dev-auth',
    element: <DevAuthPage />,
  },
  {
    path: '/query-saver',
    element: <QuerySaverRedirector targetUrl={REDIRECT_TO_LOGOUT + '/login'} />,
  },
]);

export default router;
