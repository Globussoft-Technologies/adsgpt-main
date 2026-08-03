import Cookies from 'js-cookie';
import { IS_AI_ASSISTANT_ENABLED } from '@/utils/featureFlags';

const googleManagerAvailable = import.meta.env.VITE_ENABLE_GOOGLE_POSTING === 'true';
const tiktokManagerAvailable = import.meta.env.VITE_TIKTOK_COMING_SOON === 'true';

export const WORKSPACE_FEATURE_GROUPS = Object.freeze([
  {
    id: 'adFactory',
    label: 'Ad Factory',
    description: 'Campaign creation',
    features: [{ id: 'adFactory', label: 'Ad Factory', path: '/adfactory', available: true }],
  },
  {
    id: 'assistant',
    label: 'AI Assistant',
    description: 'AI chat assistant',
    features: [
      {
        id: 'assistant',
        label: 'AI Assistant',
        path: '/assistant',
        available: IS_AI_ASSISTANT_ENABLED,
      },
    ],
  },
  {
    id: 'adStudio',
    label: 'Ad Studio',
    description: 'Choose individual studio tools',
    features: [
      { id: 'adStudio.adCopy', label: 'Ad Copy', path: '/adstudio', available: true },
      {
        id: ['adStudio.adCreative', 'adStudio.adLibrary'],
        label: 'Ad Creative & Library',
        path: '/adstudio',
        available: true,
      },
      { id: 'adStudio.adVideo', label: 'Ad Video', path: '/adstudio', available: true },
    ],
  },
  {
    id: 'brandIq',
    label: 'BrandIQ',
    description: 'Choose individual BrandIQ areas',
    features: [
      { id: 'brandIq.myBrands', label: 'My Brands', path: '/brandiq', available: true },
      { id: 'brandIq.competitors', label: 'Competitors', path: '/brandiq', available: true },
    ],
  },
  {
    id: 'adsManager',
    label: 'Ads Manager',
    description: 'Assign each platform and mode separately',
    matrix: true,
    features: [
      {
        id: 'adsManager.meta.manager',
        label: 'Meta - Ads Manager',
        platform: 'Meta',
        mode: 'manager',
        path: '/meta-ads',
        available: true,
      },
      {
        id: 'adsManager.meta.autopilot',
        label: 'Meta - Autopilot',
        platform: 'Meta',
        mode: 'autopilot',
        path: '/autopilot/meta',
        available: true,
      },
      {
        id: 'adsManager.google.manager',
        label: 'Google - Ads Manager',
        platform: 'Google',
        mode: 'manager',
        path: '/google-ads',
        available: googleManagerAvailable,
      },
      {
        id: 'adsManager.google.autopilot',
        label: 'Google - Autopilot',
        platform: 'Google',
        mode: 'autopilot',
        path: '/autopilot',
        available: false,
      },
      {
        id: 'adsManager.tiktok.manager',
        label: 'TikTok - Ads Manager',
        platform: 'TikTok',
        mode: 'manager',
        path: '/tiktok-ads',
        available: tiktokManagerAvailable,
      },
      {
        id: 'adsManager.tiktok.autopilot',
        label: 'TikTok - Autopilot',
        platform: 'TikTok',
        mode: 'autopilot',
        path: '/autopilot',
        available: false,
      },
    ],
  },
  {
    id: 'profile',
    label: 'Profile',
    description: 'Workspace member profile',
    features: [{ id: 'profile', label: 'Profile', path: '/profile', available: true }],
  },
]);

export const WORKSPACE_FEATURES = Object.freeze(
  WORKSPACE_FEATURE_GROUPS.flatMap((group) => group.features)
);

export const ASSIGNABLE_WORKSPACE_FEATURES = Object.freeze(
  WORKSPACE_FEATURES.filter((feature) => feature.available)
);

// Most feature entries store a single leaf id, but a picker entry can bundle
// several leaf ids under one toggle (e.g. Ad Creative & Library) so an owner
// grants/revokes them together. Every place that reads or writes `feature.id`
// must go through this instead of assuming it's always a plain string.
export function featureIdsOf(feature) {
  return Array.isArray(feature.id) ? feature.id : [feature.id];
}

const WORKSPACE_LEAF_FEATURE_IDS = Object.freeze(WORKSPACE_FEATURES.flatMap(featureIdsOf));
const ASSIGNABLE_LEAF_FEATURE_IDS = Object.freeze(
  ASSIGNABLE_WORKSPACE_FEATURES.flatMap(featureIdsOf)
);

const LEGACY_FEATURE_EXPANSIONS = Object.freeze({
  adStudio: ['adStudio.adCopy', 'adStudio.adCreative', 'adStudio.adVideo', 'adStudio.adLibrary'],
  brandIq: ['brandIq.myBrands', 'brandIq.competitors'],
  analyzer: [],
  adsManager: ['adsManager.meta.manager', 'adsManager.google.manager', 'adsManager.tiktok.manager'],
  autopilot: ['adsManager.meta.autopilot'],
});

export function normalizeWorkspaceFeatures(features) {
  const selected = new Set();
  (Array.isArray(features) ? features : []).forEach((featureId) => {
    if (WORKSPACE_LEAF_FEATURE_IDS.includes(featureId)) selected.add(featureId);
    (LEGACY_FEATURE_EXPANSIONS[featureId] || []).forEach((leaf) => selected.add(leaf));
  });
  return WORKSPACE_LEAF_FEATURE_IDS.filter((id) => selected.has(id));
}

export function sessionPayload() {
  try {
    const encoded = Cookies.get('access-token')?.split('.')[1];
    if (!encoded) return {};
    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    return JSON.parse(window.atob(padded));
  } catch {
    return {};
  }
}

export function isWorkspaceMember(payload = sessionPayload()) {
  return payload.session_scope === 'workspace_member' && payload.delegated === true;
}

export function allowedWorkspaceFeatures(payload = sessionPayload()) {
  if (!isWorkspaceMember(payload)) return ASSIGNABLE_LEAF_FEATURE_IDS;
  return normalizeWorkspaceFeatures(payload.workspace_features);
}

export function canUseWorkspaceFeature(featureId, payload = sessionPayload()) {
  if (!featureId) return !isWorkspaceMember(payload);
  if (!isWorkspaceMember(payload)) return true;
  const allowed = allowedWorkspaceFeatures(payload);
  return allowed.some(
    (allowedId) => allowedId === featureId || allowedId.startsWith(`${featureId}.`)
  );
}

export function canUseWorkspaceFeatureList(featureId, features) {
  const allowed = normalizeWorkspaceFeatures(features);
  return allowed.some(
    (allowedId) => allowedId === featureId || allowedId.startsWith(`${featureId}.`)
  );
}

export function canUseAnyWorkspaceFeature(featureIds, payload = sessionPayload()) {
  return featureIds.some((featureId) => canUseWorkspaceFeature(featureId, payload));
}

export function canUseMySpace(payload = sessionPayload()) {
  return canUseAnyWorkspaceFeature(['adFactory', 'assistant', 'adStudio'], payload);
}

export function isWorkspacePathAllowed(pathname, features) {
  const path = String(pathname || '/');
  const allows = (featureId) => canUseWorkspaceFeatureList(featureId, features);
  if (path.startsWith('/adfactory')) return allows('adFactory');
  if (path.startsWith('/assistant')) return allows('assistant');
  if (path.startsWith('/ad-library')) return allows('adStudio.adLibrary');
  if (path.startsWith('/adstudio')) return allows('adStudio');
  if (path.startsWith('/brandiq')) return allows('brandIq');
  if (path.startsWith('/meta-ads')) return allows('adsManager.meta.manager');
  if (path.startsWith('/google-ads')) return allows('adsManager.google.manager');
  if (path.startsWith('/tiktok-ads')) return allows('adsManager.tiktok.manager');
  if (path.startsWith('/autopilot/meta')) return allows('adsManager.meta.autopilot');
  if (path.startsWith('/autopilot')) {
    return ['meta', 'google', 'tiktok'].some((platform) =>
      allows(`adsManager.${platform}.autopilot`)
    );
  }
  if (path.startsWith('/ads-manager')) {
    return ['meta', 'google', 'tiktok'].some((platform) =>
      allows(`adsManager.${platform}.manager`)
    );
  }
  if (path.startsWith('/my-space')) {
    return ['adFactory', 'assistant', 'adStudio'].some(allows);
  }
  if (path.startsWith('/profile')) return allows('profile');
  return false;
}

export function firstAllowedPath(features = allowedWorkspaceFeatures()) {
  const selected = new Set(normalizeWorkspaceFeatures(features));
  return (
    WORKSPACE_FEATURES.find(
      (feature) => feature.available && featureIdsOf(feature).some((id) => selected.has(id))
    )?.path || '/workspace-login'
  );
}

export function setWorkspaceToken(token) {
  Cookies.remove('access-token', { path: '/' });
  Cookies.set('access-token', token, {
    expires: 1 / 24,
    path: '/',
    secure: window.location.protocol === 'https:',
    sameSite: 'lax',
  });
}

let workspaceTokenRefreshApplied = false;

// A permission change makes every in-flight request from the stale cookie
// come back carrying a fresh token (the backend re-issues it on every request
// until the client updates its cookie). A dashboard fires several requests
// concurrently, so without this guard each of their responses independently
// calls window.location.reload() — multiple near-simultaneous reloads instead
// of one. Only the first one needs to act; the reload it triggers picks up
// the now-current token for everyone.
export function applyRefreshedWorkspaceToken(token) {
  if (!token || workspaceTokenRefreshApplied) return;
  workspaceTokenRefreshApplied = true;
  setWorkspaceToken(token);
  window.location.reload();
}

export function clearWorkspaceToken() {
  Cookies.remove('access-token', { path: '/' });
}
