import getCookies from '@/utils/getCookies';

let configured = false;

/**
 * Apply AdsGPT authentication consistently to explicitly trusted API origins.
 * Legacy sessions use the client-readable access-token header; Google SSO
 * sessions send their HttpOnly cookie only to the main Node backend.
 */
export function configureHttpCredentials(axios) {
  if (configured || typeof window === 'undefined' || typeof window.fetch !== 'function') return;

  const configuredServices = [
    import.meta.env.VITE_SOCKET_URL,
    ...(import.meta.env.VITE_AUTH_API_URLS || '').split(','),
  ];
  const trustedOrigins = new Set();
  for (const service of configuredServices) {
    const value = String(service || '').trim();
    if (!value) continue;
    try {
      trustedOrigins.add(new URL(value, window.location.origin).origin);
    } catch {
      // Ignore an invalid optional service URL; the request itself will still
      // fail normally if application code tries to use it.
    }
  }
  if (trustedOrigins.size === 0) return;

  let backendOrigin;
  try {
    backendOrigin = new URL(import.meta.env.VITE_SOCKET_URL, window.location.origin).origin;
  } catch {
    backendOrigin = '';
  }

  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    try {
      const rawUrl = typeof input === 'string' || input instanceof URL ? input : input?.url;
      const target = new URL(rawUrl, window.location.origin);
      if (trustedOrigins.has(target.origin)) {
        const token = getCookies();
        const headers = new Headers(init.headers || input?.headers);
        if (token && !headers.has('Authorization')) {
          headers.set('Authorization', `Bearer ${token}`);
        }
        const credentials =
          target.origin === backendOrigin && init.credentials === undefined
            ? 'include'
            : init.credentials;
        return nativeFetch(input, {
          ...init,
          headers,
          ...(credentials ? { credentials } : {}),
        });
      }
    } catch {
      // Preserve native fetch behavior for malformed/non-standard inputs.
    }
    return nativeFetch(input, init);
  };

  axios?.interceptors?.request?.use((config) => {
    try {
      const target = new URL(config?.url || '', window.location.origin);
      if (trustedOrigins.has(target.origin)) {
        const token = getCookies();
        const headers = { ...config.headers };
        if (token && !headers.Authorization && !headers.authorization) {
          headers.Authorization = `Bearer ${token}`;
        }
        return {
          ...config,
          headers,
          ...(target.origin === backendOrigin && config.withCredentials === undefined
            ? { withCredentials: true }
            : {}),
        };
      }
    } catch {
      // Let Axios report invalid URLs in its normal request path.
    }
    return config;
  });
  configured = true;
}
