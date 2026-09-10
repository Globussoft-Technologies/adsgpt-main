/**
 * useOnboardingEligibility — the one place the app asks "where does onboarding
 * stand for this user".
 *
 * Two screens need the answer and they must not disagree: the offer bar in the
 * Layout (does this user still have a free render, and which session does the
 * bar go back to) and OnBoardHome (which phase should resume). Both read it
 * here so there is a single request and a single shape.
 *
 * It replaces `localStorage` as the source of truth. Storage cannot survive a
 * cleared browser, a second device, or a phone picked up mid-run — and in every
 * one of those cases a session the user had already paid into became
 * unreachable while the server knew about it all along.
 *
 * `loading` matters to the caller: "not yet known" is not the same as "no free
 * render", and rendering the bar before the answer arrives makes it flash on
 * and vanish for exactly the users who already spent theirs.
 */

import { useCallback, useEffect, useState } from 'react';
import { getOnboardingEligibility } from '@/apis/onboarding/onboardingApi';

export default function useOnboardingEligibility({ enabled = true } = {}) {
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(enabled);

  const refresh = useCallback(async () => {
    setLoading(true);
    // The API client already swallows failures and answers with the
    // brand-new-user shape, so there is no error branch to handle here.
    const data = await getOnboardingEligibility();
    setState(data);
    setLoading(false);
    return data;
  }, []);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      const data = await getOnboardingEligibility();
      if (cancelled) return;
      setState(data);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return {
    eligibility: state,
    loading,
    refresh,
    // Convenience reads, so callers do not each re-derive the same booleans.
    // Both false while loading: "unknown" must never render as "available".
    freeRenderAvailable: Boolean(state?.freeRenderAvailable) && !loading,
    resumeSessionId: state?.resumeSessionId || '',
    /**
     * A user who has never engaged with onboarding at all, and still has the
     * free render owed to them. The first-run redirect's whole condition.
     *
     * All four parts matter. `completed` and `skipped` are both "they have
     * answered the question" — sending either back in is the app arguing with
     * a decision the user already made. `freeRenderAvailable` false means they
     * spent it, so there is nothing left to offer. And a `resumeSessionId`
     * means they have a run in progress, which the banner handles: pushing
     * them into it unasked is a different, pushier product.
     *
     * False while loading, so a slow eligibility call cannot bounce someone
     * who turns out to be an existing user.
     */
    shouldStartOnboarding:
      !loading &&
      Boolean(state) &&
      Boolean(state.freeRenderAvailable) &&
      !state.onboardingCompleted &&
      !state.onboardingSkipped &&
      !state.resumeSessionId,
  };
}
