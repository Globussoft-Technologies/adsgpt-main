import '@/utils/workspaceMagicLink';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';
import { Provider } from 'react-redux';
import store from '@/store/store';
import axios from 'axios';
import { initGA4 } from '@/utils/ga4';
import { configureHttpCredentials } from '@/utils/configureHttpCredentials';
import { clearWorkspaceToken, isWorkspaceMember } from '@/utils/workspaceSession';
import {
  handleSessionExpired,
  isSessionFailure,
  sessionRedirectStarted,
} from '@/utils/sessionExpiry';

initGA4();
configureHttpCredentials(axios);

// Add a global response interceptor for all Axios calls
let workspaceRedirectStarted = false;
axios.interceptors.response.use(
  (response) => response,
  (error) => {
    // An expired or missing AdsGPT session. This has to run before the 403
    // branches — and without the provider-API exemption below, since an expired
    // session is an expired session no matter which screen surfaced it.
    if (isSessionFailure(error?.response?.status, error?.response?.data)) {
      handleSessionExpired();
      return Promise.reject(error);
    }
    if (error?.response?.status === 403 && (workspaceRedirectStarted || sessionRedirectStarted())) {
      return Promise.reject(error);
    }
    const requestUrl = error?.config?.url || '';
    const isProviderAdsApi =
      requestUrl.includes('meta-ads') ||
      requestUrl.includes('tiktok-ads');

    if (
      error?.response?.status === 403 &&
      isWorkspaceMember() &&
      !workspaceRedirectStarted
    ) {
      workspaceRedirectStarted = true;
      clearWorkspaceToken();
      if (window.location.pathname !== '/workspace-login') {
        window.location.replace('/workspace-login?reason=access-changed');
      }
    } else if (error?.response?.status === 403 && !isProviderAdsApi) {
      window.location.href = '/logout';
    }
    return Promise.reject(error);
  }
);
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Provider store={store}>
      <App />
    </Provider>
  </StrictMode>
);
