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
import {
  applyRefreshedWorkspaceToken,
  clearWorkspaceToken,
  isWorkspaceMember,
} from '@/utils/workspaceSession';

initGA4();
configureHttpCredentials(axios);

// Add a global response interceptor for all Axios calls
let workspaceRedirectStarted = false;
axios.interceptors.response.use(
  (response) => {
    const refreshedWorkspaceToken = response?.headers?.['x-workspace-token'];
    if (refreshedWorkspaceToken) {
      applyRefreshedWorkspaceToken(refreshedWorkspaceToken);
    }
    return response;
  },
  (error) => {
    if (error?.response?.status === 403 && workspaceRedirectStarted) {
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
