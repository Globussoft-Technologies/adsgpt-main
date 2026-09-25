// useTourSeen — has this user already been through a given onboarding tour?
//
// Used by OnboardingTour (Workspace + ClipView). The answer lives on the user's
// profile (`onboarding_tours_seen` on UserProfile), so it follows them across
// devices:
//
//   GET  /onboarding/tours                 → { workspace: bool, clip: bool }
//   POST /onboarding/tours/:tourKey/seen   → marks one seen
//
// The GET is shared by every tour on the page and made at most once per page
// load (module-level promise). `markSeen` updates that cache immediately, so a
// second mount in the same load does not replay a tour the user just closed.

import { useCallback, useEffect, useState } from 'react';
import { getOnboardingTours, markOnboardingTourSeen } from '@/apis/onboarding/onboardingApi';

let toursPromise = null;
let toursCache = null;

/**
 * Fills `toursCache` once per page load. RESOLVES TO NOTHING on purpose.
 *
 * It used to resolve to `toursCache`, and that was the bug behind "the tour
 * comes back every time I switch screens": `markSeen` REPLACES the cache with a
 * new object, while the memoized promise keeps resolving to the object it
 * captured at fetch time. Every remount then read that stale snapshot and set
 * `seen` back to false, so the tour auto-started again — even though the flag
 * was already written and stored on the server.
 *
 * Callers read the module-level `toursCache` after awaiting, so they always see
 * the current value.
 */
function loadTours() {
  if (!toursPromise) {
    toursPromise = getOnboardingTours()
      .then((data) => {
        // Server values UNDER anything already marked in this tab: a tour
        // closed a second ago must not be reopened by a slower response.
        toursCache = { ...(data || {}), ...(toursCache || {}) };
      })
      .catch(() => {
        // Unreadable: treat every tour as seen rather than auto-starting on
        // every visit. The replay pill still lets the user open it. Cleared so
        // the next page load asks again.
        toursCache = { workspace: true, clip: true, ...(toursCache || {}) };
        toursPromise = null;
      });
  }
  return toursPromise;
}

/**
 * @param {string} tourKey  one of 'workspace' | 'clip'
 * @returns {{ seen: boolean, loading: boolean, markSeen: () => void }}
 */
export default function useTourSeen(tourKey, enabled = true) {
  const [state, setState] = useState(() =>
    toursCache ? { seen: Boolean(toursCache[tourKey]), loading: false } : { seen: false, loading: true }
  );

  useEffect(() => {
    // Tour disabled by env: no read. The tour does not auto-start anyway.
    if (!enabled) return undefined;
    let alive = true;
    loadTours().then(() => {
      if (!alive) return;
      // MONOTONIC. Once this tab knows a tour has been seen it can never
      // un-know it — not from a slow response, not from a remount. "Seen" only
      // ever travels one way, which is the whole point of the flag.
      setState((prev) =>
        prev.seen ? prev : { seen: Boolean(toursCache?.[tourKey]), loading: false },
      );
    });
    return () => {
      alive = false;
    };
  }, [tourKey, enabled]);

  const markSeen = useCallback(() => {
    // Disabled: a manual replay must not write the seen flag, or testing with
    // the env off would silently suppress the tour once it is turned on.
    if (!enabled) return;
    toursCache = { ...(toursCache || {}), [tourKey]: true };
    setState({ seen: true, loading: false });
    // Fire-and-forget: a failed write only means the tour may show again on a
    // later visit, which is not worth interrupting the user over.
    markOnboardingTourSeen(tourKey).catch(() => {});
  }, [tourKey, enabled]);

  return { ...state, markSeen };
}
