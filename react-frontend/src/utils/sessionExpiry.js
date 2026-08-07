import { clearWorkspaceToken, wasWorkspaceMember } from '@/utils/workspaceSession';

/**
 * Single place that decides "the AdsGPT session is gone" and reacts to it.
 *
 * 401 alone is NOT that signal: provider endpoints answer 401 for their own
 * reasons (Meta/Google/TikTok "Access token is required", Canva "Not
 * authenticated"), and pages like Autopilot and the Google Ads dashboard read
 * those as "not connected yet". Only authenticateJWT's session codes — or the
 * bare `Unauthorized` body from an older `res.sendStatus(401)` backend — mean
 * the user has to sign in again.
 */
const SESSION_FAILURE_CODES = new Set(['SESSION_MISSING', 'SESSION_EXPIRED', 'SESSION_INVALID']);

let redirectStarted = false;

export function sessionRedirectStarted() {
  return redirectStarted;
}

export function isSessionFailure(status, data) {
  if (status !== 401) return false;
  // Backends still on `res.sendStatus(401)` send Express' bare status text.
  if (typeof data === 'string') return data.trim() === 'Unauthorized';
  return SESSION_FAILURE_CODES.has(data?.code);
}

/**
 * Tear down the session and send the user to the right sign-in surface.
 * Guarded so a screen firing ten parallel requests only navigates once.
 */
export function handleSessionExpired() {
  if (redirectStarted) return;
  redirectStarted = true;

  if (wasWorkspaceMember()) {
    clearWorkspaceToken();
    if (window.location.pathname !== '/workspace-login') {
      window.location.replace('/workspace-login?reason=session-expired');
    }
    return;
  }

  // /logout clears the server session and the legacy client cookies, then
  // hands off to amember.
  if (window.location.pathname !== '/logout') {
    window.location.replace('/logout');
  }
}
