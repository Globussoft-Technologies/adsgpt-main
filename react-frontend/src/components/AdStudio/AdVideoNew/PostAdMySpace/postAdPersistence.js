// Survives the Facebook OAuth round-trip. The user clicks "Connect
// Facebook", the page redirects to Meta and back, and on the next mount
// we restore the modal with the same asset payload. sessionStorage is
// scoped per tab and survives a full-page navigation — exactly what we
// want; localStorage would leak across tabs.

export const POST_AD_PENDING_KEY = 'mySpacePostAd_pending';

// Restored entries older than this are dropped — protects against the
// user closing the tab mid-flow and returning hours later to a
// surprise modal.
const MAX_AGE_MS = 10 * 60 * 1000;

export const savePendingPostAd = (payload) => {
  try {
    sessionStorage.setItem(
      POST_AD_PENDING_KEY,
      JSON.stringify({ payload, ts: Date.now() }),
    );
  } catch {
    // Storage might be full or disabled; the worst case is the modal
    // doesn't auto-reopen after OAuth, which is recoverable.
  }
};

export const clearPendingPostAd = () => {
  try {
    sessionStorage.removeItem(POST_AD_PENDING_KEY);
  } catch {
    // ignore
  }
};

export const readPendingPostAd = () => {
  try {
    const raw = sessionStorage.getItem(POST_AD_PENDING_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.payload || !parsed?.ts) {
      sessionStorage.removeItem(POST_AD_PENDING_KEY);
      return null;
    }
    if (Date.now() - parsed.ts > MAX_AGE_MS) {
      sessionStorage.removeItem(POST_AD_PENDING_KEY);
      return null;
    }
    return parsed.payload;
  } catch {
    sessionStorage.removeItem(POST_AD_PENDING_KEY);
    return null;
  }
};
