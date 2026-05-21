import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';
import { Provider } from 'react-redux';
import store from '@/store/store';
import axios from 'axios';

// Add a global response interceptor for all Axios calls
axios.interceptors.response.use(
  (response) => response,
  (error) => {
    const requestUrl = error?.config?.url || '';

    // Don't logout if the 403 is from Meta's API
    const isMetaApi = requestUrl.includes('meta-ads');

    if (error?.response?.status === 403 && !isMetaApi) {
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
