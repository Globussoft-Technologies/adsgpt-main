// utils/getHeaderName.js
//
// Maps the current route to the page-chrome title in TopHeader. Matches
// by prefix (longest first) so subroutes inherit the same header — e.g.
// `/autopilot/meta`, `/adfactory/something/123` resolve to their parent
// section's title instead of falling through to the default.
const PREFIX_MAP = [
  ['/autopilot', 'Autopilot'],
  ['/brandiq', 'Brand IQ'],
  ['/adstudio', 'Ad Studio'],
  ['/ad-library', 'Ad Library'],
  ['/adinsights', 'Ad Insights'],
  ['/adfactory', 'Ad Factory'],
  ['/profile', 'Account'],
  // ['/assistant', 'AI Assistant'],
  // `/meta-ads` is the post-connect Ads Manager dashboard, `/ads-manager`
  // is the platform picker. Both should read "Ads Manager".
  ['/meta-ads', 'Ads Manager'],
  ['/ads-manager', 'Ads Manager'],
];

export function getHeaderName(pathname) {
  const path = (pathname || '').toLowerCase();
  for (const [prefix, name] of PREFIX_MAP) {
    if (path === prefix || path.startsWith(`${prefix}/`)) return name;
  }
  return 'Ads Manager';
}
