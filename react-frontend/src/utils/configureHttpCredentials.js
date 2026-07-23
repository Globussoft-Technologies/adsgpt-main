let configured = false;

/**
 * Include the HttpOnly AdsGPT session cookie only on requests to our Node
 * backend. Third-party requests retain the browser's default credential mode.
 */
export function configureHttpCredentials(axios) {
  if (configured || typeof window === 'undefined' || typeof window.fetch !== 'function') return;

  const backend = import.meta.env.VITE_SOCKET_URL;
  if (!backend) return;

  let backendOrigin;
  try {
    backendOrigin = new URL(backend, window.location.origin).origin;
  } catch {
    return;
  }

  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    try {
      const rawUrl = typeof input === 'string' || input instanceof URL ? input : input?.url;
      const target = new URL(rawUrl, window.location.origin);
      if (target.origin === backendOrigin && init.credentials === undefined) {
        return nativeFetch(input, { ...init, credentials: 'include' });
      }
    } catch {
      // Preserve native fetch behavior for malformed/non-standard inputs.
    }
    return nativeFetch(input, init);
  };

  axios?.interceptors?.request?.use((config) => {
    try {
      const target = new URL(config?.url || '', window.location.origin);
      if (target.origin === backendOrigin && config.withCredentials === undefined) {
        return { ...config, withCredentials: true };
      }
    } catch {
      // Let Axios report invalid URLs in its normal request path.
    }
    return config;
  });
  configured = true;
}
