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
import LandingPageAnalyzerHome from '@/pages/LandingPageAnalyzer/LandingPageAnalyzerHome';
import LandingPageAnalyzerResultPage from '@/pages/LandingPageAnalyzer/LandingPageAnalyzerResultPage';
import MetaAdsPage from '@/pages/MetaAds/MetaAdsPage';
import GoogleAdsPage from '@/pages/GoogleAds/GoogleAdsPage';
import TikTokAdsPage from '@/pages/TikTokAds/TikTokAdsPage';
import AdsManagerPage from '@/pages/AdsManager/AdsManagerPage';
import AutopilotHomePage from '@/pages/Autopilot/AutopilotHomePage';
import AutopilotPage from '@/pages/Autopilot/AutopilotPage';
import BrandIQPage from '@/pages/BrandIQ/BrandIQPage';
import UserOnBoardPage from '@/pages/OnBoard/UserOnBoardPage';
import AuthWrapper from '@/utils/AuthWrapper';
import DevAuthPage from '@/pages/DevAuth/DevAuthPage';
import OAuthRelayPage from '@/pages/OAuthRelay/OAuthRelayPage';
import WorkspaceInvitationAcceptPage from '@/pages/Workspace/WorkspaceInvitationAcceptPage';
import WorkspaceMemberLoginPage from '@/pages/Workspace/WorkspaceMemberLoginPage';
import WorkspaceMembersPage from '@/pages/Workspace/WorkspaceMembersPage';
import WorkspaceProfilePage from '@/pages/Workspace/WorkspaceProfilePage';
import MySpacePage from '@/pages/MySpace/MySpacePage';
import WorkspaceFeatureRoute from '@/components/workspace/WorkspaceFeatureRoute';
import RunBackLog from '@/utils/RunBackLog';
import { IS_AI_ASSISTANT_ENABLED, IS_LANDING_ANALYZER_ENABLED } from '@/utils/featureFlags';
import { createBrowserRouter, Navigate } from 'react-router-dom';
const REDIRECT_TO_LOGOUT = import.meta.env.VITE_AMEMBER_URL;
const workspaceFeature = (feature, element) => (
  <WorkspaceFeatureRoute feature={feature}>{element}</WorkspaceFeatureRoute>
);

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
      { path: 'adstudio', element: workspaceFeature('adStudio', <AdStudioPage />) },
      {
        path: 'adinsights',
        element: (
          <WorkspaceFeatureRoute ownerOnly>
            <AdInsightsPage />
          </WorkspaceFeatureRoute>
        ),
      },
      {
        path: 'ad-library',
        element: workspaceFeature('adStudio.adLibrary', <AdLibraryPage />),
      },
      { path: 'brandiq', element: workspaceFeature('brandIq', <BrandIQPage />) },
      { path: 'adfactory', element: workspaceFeature('adFactory', <AdFactoryPage />) },
      {
        path: 'ads-manager',
        element: (
          <WorkspaceFeatureRoute
            anyOf={[
              'adsManager.meta.manager',
              'adsManager.google.manager',
              'adsManager.tiktok.manager',
            ]}
          >
            <AdsManagerPage />
          </WorkspaceFeatureRoute>
        ),
      },
      {
        path: 'meta-ads',
        element: workspaceFeature('adsManager.meta.manager', <MetaAdsPage />),
      },
      {
        path: 'autopilot/meta',
        element: workspaceFeature('adsManager.meta.autopilot', <AutopilotPage />),
      },
      {
        path: 'google-ads',
        element: workspaceFeature('adsManager.google.manager', <GoogleAdsPage />),
      },
      {
        path: 'tiktok-ads',
        element: workspaceFeature('adsManager.tiktok.manager', <TikTokAdsPage />),
      },

      // Landing Page Analyzer — URL-input home, then the result view by
      // sessionId. Gated by VITE_FEATURE_LANDING_ANALYZER (off in prod → routes
      // are not registered, so direct navigation 404s).
      ...(IS_LANDING_ANALYZER_ENABLED
        ? [
            {
              path: 'landing-page-analyzer',
              element: (
                <WorkspaceFeatureRoute ownerOnly>
                  <LandingPageAnalyzerHome />
                </WorkspaceFeatureRoute>
              ),
            },
            {
              path: 'landing-page-analyzer/:id',
              element: (
                <WorkspaceFeatureRoute ownerOnly>
                  <LandingPageAnalyzerResultPage />
                </WorkspaceFeatureRoute>
              ),
            },
          ]
        : []),
      // Autopilot has the same picker-then-dashboard structure as Ads
      // Manager: `/autopilot` is the platform picker home, `/autopilot/meta`
      // is the actual dashboard for Meta. Google/TikTok land on the picker
      // home once those integrations exist.
      {
        path: 'autopilot',
        element: (
          <WorkspaceFeatureRoute
            anyOf={[
              'adsManager.meta.autopilot',
              'adsManager.google.autopilot',
              'adsManager.tiktok.autopilot',
            ]}
          >
            <AutopilotHomePage />
          </WorkspaceFeatureRoute>
        ),
      },
      {
        path: 'my-space',
        element: (
          <WorkspaceFeatureRoute anyOf={['adFactory', 'assistant', 'adStudio']}>
            <MySpacePage />
          </WorkspaceFeatureRoute>
        ),
      },
      ...(IS_AI_ASSISTANT_ENABLED
        ? [{ path: 'assistant', element: workspaceFeature('assistant', <AIAssistantPage />) }]
        : []),
      {
        path: '/profile',
        element: workspaceFeature('profile', <WorkspaceProfilePage />),
      },
      {
        path: 'workspace/members',
        element: (
          <WorkspaceFeatureRoute ownerOnly>
            <WorkspaceMembersPage />
          </WorkspaceFeatureRoute>
        ),
      },
      {
        path: 'onboarding',
        element: (
          <WorkspaceFeatureRoute ownerOnly>
            <UserOnBoardPage />
          </WorkspaceFeatureRoute>
        ),
      },
      // { path: 'adfactory-demo', element: <AdFactoryWorkflowDarkReal2 /> },
    ],
  },
  {
    path: '/workspace-invite/:token',
    element: <WorkspaceInvitationAcceptPage />,
  },
  {
    path: '/workspace-invite',
    element: <WorkspaceInvitationAcceptPage />,
  },
  {
    path: '/workspace-login',
    element: <WorkspaceMemberLoginPage />,
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
    // OAuth 2.1 login bridge. The AS backend 302s here when it needs the
    // user signed into AdsGPT before rendering the consent screen.
    // This page trades aMember credentials for a JWT (mirroring RunBackLog's
    // logic) and then forwards to the returnTo URL. Mounted OUTSIDE
    // RunBackLog / AuthWrapper — it owns its own auth lifecycle. See
    // pages/OAuthRelay/OAuthRelayPage.jsx.
    path: '/oauth/relay',
    element: <OAuthRelayPage />,
  },
  {
    path: '/query-saver',
    element: <QuerySaverRedirector targetUrl={REDIRECT_TO_LOGOUT + '/login'} />,
  },
]);

export default router;
