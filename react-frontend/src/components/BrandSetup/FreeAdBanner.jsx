/**
 * The offer bar: onboarding's credit allowance, offered.
 *
 * A full-bleed strip above everything, in the accent green the product uses for
 * "this is free" — the one colour on the page that is not competing with the
 * brand's own. It is the entry point to onboarding for a user who is anywhere
 * else in the app and has not spent their first render yet.
 *
 * ── Who decides whether it shows ────────────────────────────────────────────
 * The server, via `GET /onboarding/eligibility`. `allowanceRemaining` is one
 * fact per user across every device, and it falls as renders are made — so when
 * the budget runs out the bar disappears everywhere at once, whether or not it
 * was ever dismissed here.
 *
 * ── Why the copy is driven by a number ──────────────────────────────────────
 * The bar used to promise "your first ad is free", which was true exactly once.
 * An allowance is not one render, and it can run part-way out: a user with 3
 * credits left cannot make a 32-credit video, and telling them it is free while
 * the wallet is charged is the single outcome this must not produce
 * (ONBOARDING_ALLOWANCE.md D2). So the wording follows what is actually left,
 * and the bar stops offering anything when nothing is.
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
 * @param available  Whether there is any allowance left at all, from
 *   `GET /onboarding/eligibility`. False while that call is in flight — the bar
 *   stays hidden until the answer is known, so a user with no budget never sees
 *   it flash on and vanish.
 * @param remaining  Credits of allowance left. Drives the wording: the full
 *   budget reads as an offer, a partial one states the number, because at that
 *   point what is left may not cover the next render.
 * @param total      What the allowance started at. Only used to tell "untouched"
 *   from "partly spent" — the two deserve different sentences.
 * @param kind       'allowance' (onboarding-only budget, genuinely free) or
 *   'wallet' (a free-plan user's own credits). Only the copy differs, and it
 *   has to: calling someone's own balance "free" is a lie they will notice the
 *   moment it goes down.
 * @param showCount  Whether to state the number. TRUE inside onboarding, where
 *   the figure is about to matter — the next render either is covered or is
 *   not. FALSE on the dashboard: out here it is an invitation, and a running
 *   total of someone's balance on every screen reads as a meter, not an offer.
 * @param onCreate   Takes the user into onboarding — resuming the session they
 *   skipped, when there is one. Omit it to render the bar with no button: on
 *   the onboarding screen itself the offer is still worth stating, but there is
 *   nowhere to send someone who is already standing in it, and a button that
 *   only scrolls reads as the same promise made twice.
 */
export default function FreeAdBanner({
  available = false,
  remaining = 0,
  total = 0,
  showCount = true,
  kind = 'allowance',
  onCreate,
}) {
  const [hidden, setHidden] = useState(wasDismissed);

  if (!available || hidden) return null;

  // Untouched budget reads as an offer; a partly-spent one has to state the
  // number, because from here on it may not cover the next render.
  const untouched = total > 0 && remaining >= total;

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
      // Medium weight (user decision 2026-09-15): ~40px tall, tint doubled and a
      // 2px cyan bottom edge — the 28px strip with a faint tint was easy to miss.
      className="relative flex w-full shrink-0 items-center justify-center gap-3 px-10 py-2.5 text-white"
      style={{
        background:
          'linear-gradient(90deg, rgba(21,220,255,0.20) 0%, rgba(94,102,245,0.28) 50%, rgba(21,220,255,0.20) 100%), #131317',
        boxShadow: 'inset 0 -2px 0 rgba(21,220,255,0.55)',
      }}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="currentColor"
        className="hidden shrink-0 text-[#15DCFF] sm:block"
        aria-hidden
      >
        <path d="M20.6 12.6 12 21.2a2.5 2.5 0 0 1-3.5 0l-5.7-5.7a2.5 2.5 0 0 1 0-3.5l8.6-8.6A2 2 0 0 1 12.8 3H19a2 2 0 0 1 2 2v6.2a2 2 0 0 1-.4 1.4ZM16.5 8.5a1.2 1.2 0 1 0 0-2.4 1.2 1.2 0 0 0 0 2.4Z" />
      </svg>

      {/* NEVER a bare credit count. "31 credits left" reads as a wallet
          balance — the thing the user buys and spends everywhere — and this is
          not that: it is generation that costs them nothing, usable only here.
          So the unit is always "credits worth of generation", and the word
          "free" sits on the generation rather than on the credits.

          Deliberately never "a free ad" either: what is left may no longer
          cover one, and the concept cards show the real price when it does
          not. A bar that keeps promising an ad it cannot pay for is how a user
          ends up surprised by a deduction. */}
      <p className="min-w-0 truncate text-center text-[14px] font-semibold text-white">
        {!showCount ? (
          <>
            {kind === 'wallet'
              ? 'You have credits waiting for onboarding.'
              : 'You still have free generation waiting.'}{' '}
            <span className="font-medium text-white/75">Pick up where you left off.</span>
          </>
        ) : kind === 'wallet' ? (
          // Their own credits. Stated, never dressed up as a gift.
          <>
            {remaining} credits worth of generation available.{' '}
            <span className="font-medium text-white/75">Use it in onboarding.</span>
          </>
        ) : untouched ? (
          <>
            Make your first impression free.{' '}
            <span className="font-medium text-white/75">
              {total} credits worth of generation, on us.
            </span>
          </>
        ) : (
          <>
            {remaining} credits worth of generation left.{' '}
            <span className="font-medium text-white/75">Free, inside onboarding.</span>
          </>
        )}
      </p>

      {onCreate && (
        <button
          type="button"
          onClick={onCreate}
          // The same raised build as Generate on the concept cards — it is the
          // same action, one screen earlier.
          className="shrink-0 rounded-[6px] bg-[linear-gradient(180deg,#9176ff_0%,#7c5cff_46%,#6148c7_100%)] px-2.5 py-1 text-[12px] font-bold whitespace-nowrap text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.4),inset_0_-1px_0_rgba(0,0,0,0.28)] transition hover:brightness-110 active:translate-y-px"
        >
          {untouched && showCount && kind === 'allowance' ? 'Create My Free Ad' : 'Continue'}
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
