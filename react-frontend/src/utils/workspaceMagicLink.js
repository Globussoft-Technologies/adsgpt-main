const STORAGE_KEYS = Object.freeze({
  invitation: 'workspace:invitation-token',
  login: 'workspace:login-token',
});

const captured = {};

function remember(kind, token) {
  const value = String(token || '').trim();
  if (!value) return;
  captured[kind] = value;
  try {
    window.sessionStorage.setItem(STORAGE_KEYS[kind], value);
  } catch {
    // Module memory still keeps the token for this page load.
  }
}

function replaceUrl(url) {
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}

export function scrubWorkspaceMagicLink() {
  if (typeof window === 'undefined') return;

  const url = new URL(window.location.href);
  const invitationMatch = url.pathname.match(/^\/workspace-invite\/([^/]+)\/?$/);
  if (invitationMatch) {
    try {
      remember('invitation', decodeURIComponent(invitationMatch[1]));
    } catch {
      remember('invitation', invitationMatch[1]);
    }
    url.pathname = '/workspace-invite';
    replaceUrl(url);
    return;
  }

  if (url.pathname === '/workspace-login' && url.searchParams.has('token')) {
    remember('login', url.searchParams.get('token'));
    url.searchParams.delete('token');
    replaceUrl(url);
  }
}

export function takeWorkspaceMagicToken(kind, fallbackToken = '') {
  if (typeof window === 'undefined' || !STORAGE_KEYS[kind]) return '';

  const fallback = String(fallbackToken || '').trim();
  if (fallback) {
    remember(kind, fallback);
    scrubWorkspaceMagicLink();
  }

  let token = captured[kind] || '';
  if (!token) {
    try {
      token = window.sessionStorage.getItem(STORAGE_KEYS[kind]) || '';
    } catch {
      token = '';
    }
  }
  try {
    window.sessionStorage.removeItem(STORAGE_KEYS[kind]);
  } catch {
    // The token has already been copied into module memory.
  }
  if (token) captured[kind] = token;
  return token;
}

export function forgetWorkspaceMagicToken(kind) {
  if (!STORAGE_KEYS[kind]) return;
  delete captured[kind];
  try {
    window.sessionStorage.removeItem(STORAGE_KEYS[kind]);
  } catch {
    // Nothing else is required once the page has copied the token into state.
  }
}

// This module is imported before analytics and the router from main.jsx.
scrubWorkspaceMagicLink();
