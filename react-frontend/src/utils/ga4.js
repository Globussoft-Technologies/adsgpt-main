import ReactGA from 'react-ga4';
import Cookies from 'js-cookie';

const MEASUREMENT_ID = import.meta.env.VITE_GA4_MEASUREMENT_ID;

let initialized = false;

export const initGA4 = () => {
  if (!MEASUREMENT_ID || initialized) return;
  ReactGA.initialize(MEASUREMENT_ID);
  initialized = true;
};

export const trackGA4PageView = (path) => {
  if (!initialized) return;
  const appUserId = Cookies.get('user_id') || null;
  const appUserName = Cookies.get('user_name') || null;
  ReactGA.send({
    hitType: 'pageview',
    page: path,
    app_user_id: appUserId,
    app_user_name: appUserName,
  });
};

// Build the GA4 User-ID as "<id>-<name>" so the User Explorer list shows a
// human-readable identity (e.g. "GPT-165-Chethan") instead of just the id or a
// random device id. Falls back to the id alone if no name is available.
const buildUserIdentity = (userId, userName) => {
  if (!userId) return null;
  return userName ? `${userId}-${userName}` : String(userId);
};

// Tie the GA4 session to a known user as soon as we learn who they are (on
// socket connect / login), so User Explorer identifies them by this identity
// instead of a random device id — even if they never fire a custom event.
export const setGA4User = (userId, userName) => {
  const identity = buildUserIdentity(userId, userName);
  if (!initialized || !identity) return;
  ReactGA.set({ userId: identity });
};

// Every custom event carries who did it, so reports can be sliced by user
// without re-reading cookies at every call site.
//
// NOTE: the GA4-reserved `userId` (set above) feeds GA4's built-in User-ID
// identity and is hidden from event-parameter reports. So we ALSO expose the
// raw id/name as custom `app_user_id`/`user_name` params for reporting.
export const trackGA4Event = (name, params = {}) => {
  if (!initialized) return;
  const appUserId = Cookies.get('user_id') || null;
  const appUserName = Cookies.get('user_name') || null;
  const identity = buildUserIdentity(appUserId, appUserName);
  if (identity) ReactGA.set({ userId: identity });
  ReactGA.event(name, {
    app_user_id: appUserId,
    app_user_name: appUserName,
    ...params,
  });
};

// One human-readable label per tab, so GA4 reports read "Ad Copy" / "Competitors"
// directly instead of raw keys like "adCopy" — a single "feature" value the
// viewer instantly understands, no feature/section split. Keyed by tab id.
const TAB_LABELS = {
  // BrandIQ sub-tabs roll up into one "Brand IQ" feature (no sub-tab breakdown).
  myBrands: 'Brand IQ',
  competitors: 'Brand IQ',
  // AdStudio tabs stay detailed (ids match adStudioTabs in TopHeader.jsx).
  adCopy: 'Ad Copy',
  adCreativeNew: 'Ad Creative',
  adVideoNew: 'Ad Video',
};

// Readable label per route path for the page-based features (each is its own
// route, not a tab). `/adstudio` and `/brandiq` are intentionally excluded —
// their tabs already fire feature_visited, so mapping them here would
// double-count. Keyed by pathname (leading slash, no trailing slash).
// Note: /meta-ads, /google-ads, /tiktok-ads are intentionally excluded — those
// are reached from inside /ads-manager via provider OAuth (not yet live), so
// tracking them separately would be redundant. "Ads Manager" covers them.
const ROUTE_LABELS = {
  '/adfactory': 'Ad Factory',
  '/ad-library': 'Ad Library',
  '/ads-manager': 'Ads Manager',
  '/autopilot': 'Autopilot',
  '/assistant': 'AI Assistant',
};

// Central catalog of business events — add a new event here once, then
// import GA4Events wherever it needs to fire instead of hand-rolling names.
export const GA4Events = {
  // Fired when a user opens a feature (a Brand IQ / Ad Studio tab). Sends one
  // readable `feature` value, e.g. "Ad Copy" or "Competitors".
  featureVisited: ({ tab }) =>
    trackGA4Event('feature_visited', { feature: TAB_LABELS[tab] || tab || '(unknown)' }),

  // Fired on navigation to a page-based feature. No-op for unmapped routes so
  // we only record real features, not every path (login, profile, etc.).
  featureVisitedByRoute: (pathname) => {
    const label = ROUTE_LABELS[pathname];
    if (label) trackGA4Event('feature_visited', { feature: label });
  },
};
