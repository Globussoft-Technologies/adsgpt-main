import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';
import { Provider } from 'react-redux';
import store from '@/store/store';
import axios from 'axios';
import { initGA4 } from '@/utils/ga4';
import { configureHttpCredentials } from '@/utils/configureHttpCredentials';

initGA4();
configureHttpCredentials(axios);

let sessionValidation;

async function hasValidAdsGptSession() {
  if (!sessionValidation) {
    sessionValidation = fetch(
      `${import.meta.env.VITE_SOCKET_URL}/adsgpt/auth/amember/session`,
      { credentials: 'include' }
    )
      // Only an explicit unauthenticated response should destroy the local
      // session. A temporary backend/network failure must not log the user out.
      .then((response) => response.status !== 401)
      .catch(() => true)
      .finally(() => {
        sessionValidation = null;
      });
  }
  return sessionValidation;
}

// Add a global response interceptor for all Axios calls
axios.interceptors.response.use(
  (response) => response,
  async (error) => {
    const status = error?.response?.status;
    const requestUrl = error?.config?.url || '';
    const isProviderAdsApi =
      requestUrl.includes('meta-ads') ||
      requestUrl.includes('tiktok-ads');

    // A feature service may return 403 because the user lacks permission for
    // that feature. Only log out when the central AdsGPT session is also
    // invalid; otherwise preserve the valid login and surface the API error.
    if (
      (status === 401 || status === 403) &&
      !isProviderAdsApi &&
      !(await hasValidAdsGptSession())
    ) {
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
