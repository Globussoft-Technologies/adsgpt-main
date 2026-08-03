import { useEffect } from 'react';
import { toast } from 'react-toastify';

// Facebook OAuth is a full-page redirect initiated from several unrelated
// surfaces (Meta Ads, AdFactory, Profile, Platform Picker) that all send the
// user back to their own current page with `?error=<code>` on failure. None
// of those pages read it, so failures — including "this Facebook account is
// already connected to another AdsGPT user" — redirected silently with no
// feedback. Handling it once here, mounted at the app root, covers every
// entry point without duplicating the check per-surface.
const OAUTH_ERROR_MESSAGES = {
  facebook_account_taken:
    'This Facebook account is already connected to another AdsGPT account. Please use a different Facebook account.',
  auth_failed: 'Facebook sign-in was cancelled or failed. Please try again.',
  token_exchange_failed:
    "We couldn't connect your Facebook account. Please try again.",
};

export default function useFacebookOAuthErrorToast() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const errorCode = params.get('error');
    if (!errorCode || !OAUTH_ERROR_MESSAGES[errorCode]) return;

    toast.error(OAUTH_ERROR_MESSAGES[errorCode]);

    params.delete('error');
    const next =
      window.location.pathname +
      (params.toString() ? `?${params.toString()}` : '') +
      window.location.hash;
    window.history.replaceState({}, '', next);
  }, []);
}
