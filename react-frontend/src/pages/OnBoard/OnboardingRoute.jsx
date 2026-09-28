/**
 * The guard on `/onboarding`.
 *
 * That route is deliberately top-level — outside `AuthWrapper`, `Layout` and
 * `RunBackLog` — because it is full-bleed and because AuthWrapper would bounce
 * a user off it mid-render. The cost of living out there is that it inherited
 * no protection at all: anyone could reach the brand-setup wizard by typing the
 * URL, signed in or not, onboarded or not. This is the protection it lost.
 *
 * ── Who is allowed in ───────────────────────────────────────────────────────
 *
 *   signed out            → the login page. The screen renders without a token
 *                           today and every call inside it 401s, which is a
 *                           broken page rather than a guarded one.
 *   not enrolled          → /adstudio. Accounts that predate onboarding were
 *                           never offered it; see the enrolment gate in
 *                           ONBOARDING_ENTRY_EXIT_CREDITS.md §4.0.
 *   completed, nothing
 *   left to spend         → /adstudio. They have had their run.
 *   completed, allowance
 *   still unspent         → ALLOWED. The allowance is onboarding-only budget
 *                           that expires with the offer, so refusing entry
 *                           destroys it rather than saving it. A free-plan
 *                           user is NOT in this case: their credits are a real
 *                           wallet that works everywhere, so nothing is lost by
 *                           taking Finish at its word.
 *   skipped, render owed  → ALLOWED. Skipping is not declining for ever: the
 *                           offer bar still shows, and clicking it comes back
 *                           here to the session they left.
 *   mid-run               → ALLOWED, and this is the case that must not be got
 *                           wrong. A reload during a run has no completion and
 *                           no skip recorded, and locking that user out would
 *                           strand a run they have already paid into.
 *
 * Redirects are silent, by decision — no toast. A user who lands here by URL
 * did not ask a question that needs answering.
 */

import { useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { Loader } from 'lucide-react';
import getCookies from '@/utils/getCookies';
import useOnboardingEligibility from '@/hooks/useOnboardingEligibility';

// Sign-in lives on aMember, not in this app — there is no in-app `/login` route
// to Navigate to, so this is a full page departure like the Logout route's.
const LOGIN_URL = import.meta.env.VITE_AMEMBER_URL
  ? `${import.meta.env.VITE_AMEMBER_URL}/login`
  : '';

// ── The way out ────────────────────────────────────────────────────────────
//
// `VITE_ONBOARDING_GUARD_OFF=true` turns every check below off and lets anyone
// open `/onboarding`. It exists so the screen can be worked on and demoed
// without a fresh signup each time — the guard's whole job is to make the
// wizard unreachable, which also makes it unreachable to whoever is building
// it.
//
// A build-time constant, so it cannot be flipped from a console at runtime, and
// a Vite env var, so a production build simply never has it set. Compared
// against the string because env values are always strings — `Boolean('false')`
// is true, which is the classic way a flag like this gets left on by accident.
const GUARD_DISABLED = String(import.meta.env.VITE_ONBOARDING_GUARD_OFF) === 'true';

export default function OnboardingRoute({ children }) {
  const token = getCookies();

  // Before the eligibility call, because there is no point asking the server
  // who this is when there is no token to ask with.
  const signedIn = Boolean(token);
  // Skipped entirely when the guard is off: the call is only ever made to
  // decide something this build has decided not to ask.
  const { eligibility, loading, canEnterOnboarding } = useOnboardingEligibility({
    enabled: signedIn && !GUARD_DISABLED,
  });

  // A full navigation, and one that must happen in an effect rather than
  // during render — assigning `location.href` while rendering is a side effect
  // React is entitled to run twice.
  useEffect(() => {
    if (GUARD_DISABLED) return;
    if (!signedIn && LOGIN_URL) window.location.href = LOGIN_URL;
  }, [signedIn]);

  // Before every check, including the sign-in one — a backdoor that still
  // demanded a token would not open the door.
  if (GUARD_DISABLED) return children;

  if (!signedIn) {
    // No aMember URL configured (a bare local build). Falling through to the
    // app is better than parking the user on a blank screen with no way out.
    if (!LOGIN_URL) return <Navigate to="/adstudio" replace />;
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[#0A0A0C]">
        <Loader className="h-8 w-8 animate-spin text-white/40" />
      </div>
    );
  }

  // Nothing is decided yet. Rendering the wizard here and pulling it away a
  // moment later is worse than a spinner: the user starts typing into a form
  // that is about to vanish.
  if (loading || !eligibility) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[#0A0A0C]">
        <Loader className="h-8 w-8 animate-spin text-white/40" />
      </div>
    );
  }

  // The rule itself lives in `useOnboardingEligibility` as `canEnterOnboarding`,
  // and it lives there rather than here for one reason: the OFFER BAR has to
  // ask the same question. When the two were written out separately they
  // drifted, and the bar spent a release offering a door this file then shut —
  // the URL changed to `/onboarding` for an instant and bounced back, with
  // nothing said about why.
  //
  // What it comes to:
  //
  //   not enrolled        refused. The account predates onboarding.
  //   finished            refused — UNLESS an onboarding allowance still has
  //                       credits in it. That budget buys nothing anywhere else
  //                       and expires with the offer, so locking them out does
  //                       not save it, it burns it.
  //   everything else     allowed. Mid-brand-run, mid-render, reloaded, skipped
  //                       with a render still owed — all of it falls through,
  //                       and the mid-run case is the one this must not get
  //                       wrong: a reload during a render has no completion and
  //                       no skip recorded, and refusing it would strand work
  //                       the user has already paid into.
  //
  // An earlier version also refused when `resumeSessionId` was null or the free
  // render was spent, and both were wrong. `resumeSessionId` is simply the
  // user's newest session and never goes null once one exists, so that clause
  // could not fire; and "free render spent" is the normal state of a user who
  // generated a clip and then reloaded.
  if (!canEnterOnboarding) return <Navigate to="/adstudio" replace />;

  return children;
}
