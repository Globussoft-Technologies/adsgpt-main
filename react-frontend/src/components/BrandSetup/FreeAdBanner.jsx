/**
 * The offer bar: one 8-second ad, on the house.
 *
 * A full-bleed strip above everything, in the accent green the product uses for
 * "this is free" — the one colour on the page that is not competing with the
 * brand's own. It is the entry point to onboarding for a user who is anywhere
 * else in the app and has not spent their first render yet.
 *
 * ── Who decides whether it shows ────────────────────────────────────────────
 * The server, via `GET /onboarding/eligibility`. `freeRenderAvailable` is one
 * fact per user across every device, and it flips false the moment the free
 * render is claimed — so the bar disappears everywhere at once, whether or not
 * it was ever dismissed here.
 *
 * Dismissal is therefore only ever able to hide the bar EARLIER than the server
 * would, never to keep it alive longer. It is scoped to this tab
 * (`sessionStorage`), deliberately: this is no longer a promo strip that a
 * permanent close is right for. It is the way back into a session the user
 * skipped with real unspent value in it, and one accidental click on the X
 * should not put that out of reach for good on this browser.
 */

import { useState } from 'react';
import { X } from 'lucide-react';

const DISMISS_KEY = 'adsgpt.freeAdBanner.dismissed';

const wasDismissed = () => {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    // Private mode, or storage disabled. Showing the banner is the safe
    // failure: an offer shown twice is better than an offer never shown.
    return false;
  }
};

const remember = () => {
  try {
    sessionStorage.setItem(DISMISS_KEY, '1');
  } catch {
    /* nothing to do */
  }
};

/**
 * @param available  Whether the free render is still unspent, from
 *   `GET /onboarding/eligibility`. Null/undefined while that call is in
 *   flight — the bar stays hidden until the answer is known, so a user who
 *   already spent their render never sees it flash on and vanish.
 * @param onCreate   Takes the user into onboarding — resuming the session they
 *   skipped, when there is one. Omit it to render the bar with no button: on
 *   the onboarding screen itself the offer is still worth stating, but there is
 *   nowhere to send someone who is already standing in it, and a button that
 *   only scrolls reads as the same promise made twice.
 */
export default function FreeAdBanner({ available = false, onCreate }) {
  const [hidden, setHidden] = useState(wasDismissed);

  if (!available || hidden) return null;

  const dismiss = () => {
    remember();
    setHidden(true);
  };

  return (
    // Dark, on the product's own cyan-to-indigo ramp, with a hairline of that
    // ramp along the bottom edge doing the work a solid fill used to. A block
    // of borrowed lime read as somebody else's promo strip pasted above the
    // app; this reads as part of it.
    <div
      className="relative flex w-full shrink-0 items-center justify-center gap-2.5 px-10 py-1.5 text-white"
      style={{
        background:
          'linear-gradient(90deg, rgba(21,220,255,0.10) 0%, rgba(94,102,245,0.14) 50%, rgba(21,220,255,0.10) 100%), #131317',
        boxShadow: 'inset 0 -1px 0 rgba(21,220,255,0.28)',
      }}
    >
      <svg
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="currentColor"
        className="hidden shrink-0 text-[#15DCFF] sm:block"
        aria-hidden
      >
        <path d="M20.6 12.6 12 21.2a2.5 2.5 0 0 1-3.5 0l-5.7-5.7a2.5 2.5 0 0 1 0-3.5l8.6-8.6A2 2 0 0 1 12.8 3H19a2 2 0 0 1 2 2v6.2a2 2 0 0 1-.4 1.4ZM16.5 8.5a1.2 1.2 0 1 0 0-2.4 1.2 1.2 0 0 0 0 2.4Z" />
      </svg>

      <p className="min-w-0 truncate text-center text-[12.5px] font-semibold text-white/90">
        Make your first impression free.{' '}
        <span className="font-medium text-white/45">Generate an 8-second ad on us.</span>
      </p>

      {onCreate && (
        <button
          type="button"
          onClick={onCreate}
          // The same raised build as Generate on the concept cards — it is the
          // same action, one screen earlier.
          className="shrink-0 rounded-[6px] bg-[linear-gradient(180deg,#9176ff_0%,#7c5cff_46%,#6148c7_100%)] px-2.5 py-1 text-[12px] font-bold whitespace-nowrap text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.4),inset_0_-1px_0_rgba(0,0,0,0.28)] transition hover:brightness-110 active:translate-y-px"
        >
          Create My Free Ad
        </button>
      )}

      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss this offer"
        // Pinned right rather than in the row: the message and its button are
        // centred, and a close control in that flow would push them off centre.
        className="absolute top-1/2 right-3 -translate-y-1/2 rounded p-0.5 text-white/35 transition hover:text-white/80"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/** Exported so a caller can tell whether the bar will render at all. */
export const freeAdBannerDismissed = wasDismissed;
