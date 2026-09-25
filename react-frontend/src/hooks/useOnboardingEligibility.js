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
    // Convenience reads, so callers do not each re-derive the same thing.
    // Zero while loading: "unknown" must never render as "you have budget",
    // because that is the reading that puts the word "free" on a screen that
    // is about to charge someone.
    allowanceRemaining: loading ? 0 : Number(state?.allowanceRemaining) || 0,
    allowanceTotal: loading ? 0 : Number(state?.allowanceTotal) || 0,
    /* What the OFFER BAR counts down, which is not always the allowance.
       A paid user counts down their onboarding budget; a free-plan user holds
       none (they already have real credits from signup) and counts down their
       own balance instead. `generationKind` says which, because free
       generation and a user's own money cannot be described the same way.
       Everything that decides whether a render is FREE still reads
       `allowanceRemaining` — these two are for copy only. */
    generationLeft: loading ? 0 : Number(state?.generationLeft) || 0,
    generationKind: loading ? 'none' : state?.generationKind || 'none',
    resumeSessionId: state?.resumeSessionId || '',
    /**
     * A user who has never engaged with onboarding at all, and still has
     * something to spend there. The first-run redirect's whole condition.
     *
     * Every part matters. `enrolled === false` is an account that predates
     * onboarding and was never offered it. `completed` and `skipped` are both
     * "they have answered the question" — sending either back in is the app
     * arguing with a decision the user already made. Nothing left to spend
     * means nothing left to offer. And a `resumeSessionId` means they have a
     * run in progress, which the banner handles: pushing them into it unasked
     * is a different, pushier product.
     *
     * It reads `generationLeft`, NOT `allowanceRemaining`, and that is the
     * whole point of the field. `allowanceRemaining` is zero for every
     * free-plan user by design — they hold no onboarding budget because they
     * already got 35 real credits at signup — so keying the redirect on it
     * meant a brand-new free signup was never taken to onboarding at all and
     * landed on /adstudio, able to find the wizard only by noticing the offer
     * bar. `generationLeft` is the server's answer to "has this user got
     * anything to spend here", whichever purse it comes out of.
     *
     * Note the asymmetry this keeps: for a paid user `generationLeft` IS the
     * allowance, so an exhausted allowance still means no redirect, exactly as
     * before. Only the free-plan case changes.
     *
     * False while loading, so a slow eligibility call cannot bounce someone
     * who turns out to be an existing user.
     */
    shouldStartOnboarding:
      !loading &&
      Boolean(state) &&
      state.enrolled !== false &&
      Number(state.generationLeft) > 0 &&
      !state.onboardingCompleted &&
      !state.onboardingSkipped &&
      !state.resumeSessionId,
  };
}
