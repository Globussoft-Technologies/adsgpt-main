import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';
import { Provider } from 'react-redux';
import store from '@/store/store';
import axios from 'axios';
import { initGA4 } from '@/utils/ga4';

initGA4();

// Add a global response interceptor for all Axios calls
axios.interceptors.response.use(
  (response) => response,
  (error) => {
    const requestUrl = error?.config?.url || '';

    
    const isProviderAdsApi =
      requestUrl.includes('meta-ads') ||
      requestUrl.includes('tiktok-ads');

    if (error?.response?.status === 403 && !isProviderAdsApi) {
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
