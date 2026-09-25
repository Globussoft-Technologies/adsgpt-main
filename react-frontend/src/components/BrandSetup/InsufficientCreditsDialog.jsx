// InsufficientCreditsDialog — the render that cannot be paid for, refused on
// the board instead of on the clip screen.
//
// What it replaces: the click used to move the user to the clip screen and only
// THERE discover it could not be paid for, so they watched a loading state
// resolve into "not enough credits" one screen away from everything they could
// do about it — and with nothing to go back to but the browser's back button.
//
// Nothing is charged, nothing is started, and nothing navigates. The board
// stays exactly where it was.

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import creditIcon from '@/assets/layouts/profile/adcreative.svg';

const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

/**
 * @param cost      What the render costs, in credits.
 * @param balance      Wallet credits the user actually has. `null` when
 *   unknown — better an unstated figure than an invented one on the one line
 *   whose whole job is to be exact.
 * @param allowance     Onboarding credits that WOULD have covered part of it.
 * @param walletNeeded  What the wallet was asked for after the allowance.
 *   Together these turn "you cannot afford this" into the sentence that
 *   actually helps: 25 of it was covered, 7 was wanted, you have 2.
 * @param plan       'free' or 'paid'. Only the WORDING depends on it — both go
 *   to the same place, because that one page is where every out-of-credits
 *   surface in the app sends people. But "Upgrade plan" is the wrong sentence
 *   to show someone who already has one and is five credits short; they need
 *   more credits, not a different subscription.
 * @param onUpgrade Opens that page. The one action that changes the outcome,
 *   so it is the only loud thing here.
 */
export default function InsufficientCreditsDialog({
  open,
  cost = 0,
  balance = null,
  allowance = 0,
  walletNeeded = null,
  plan = 'paid',
  onUpgrade,
  onClose,
}) {
  const closeRef = useRef(null);

  // Focus lands on the way OUT, not on Upgrade: this dialog is unwelcome news,
  // and a stray Enter should dismiss it rather than open a purchase page.
  useEffect(() => {
    if (!open) return undefined;
    closeRef.current?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  // What the wallet is actually short. Not `cost - balance`: when the
  // allowance covers most of the price, the gap is against the WALLET's share,
  // and quoting the whole render would overstate it by everything already
  // covered — 30 short instead of 5.
  const wanted = walletNeeded == null ? cost : walletNeeded;
  const short = balance == null ? null : Math.max(wanted - balance, 0);
  const splitPaid = allowance > 0 && walletNeeded != null;

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4"
      style={{ background: 'rgba(6,6,8,0.88)' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="insufficient-credits-title"
    >
      <div
        className="w-full max-w-[380px] rounded-2xl border border-white/10 bg-[#121216] p-5 shadow-2xl"
        style={{ animation: `insufficient-rise 260ms ${EASE} both` }}
      >
        <h2 id="insufficient-credits-title" className="text-[15px] font-semibold text-white">
          Not enough credits
        </h2>

        {balance == null ? (
          <p className="mt-3 text-[13.5px] leading-relaxed text-white/70">
            This render needs{' '}
            <span className="inline-flex items-center gap-1 font-semibold text-white">
              {cost}
              <img src={creditIcon} alt="credits" className="h-3.5 w-3.5" />
            </span>{' '}
            and your balance does not cover it.
          </p>
        ) : (
          // The arithmetic in the open, the same way the split confirmation
          // states it — the user should not have to work out the gap.
          <dl className="mt-4 space-y-2 text-[13.5px]">
            <Row label="This render" value={cost} />
            {/* Say what the budget already covers before saying what is
                missing. Without it the wallet figure below reads as the whole
                price and the user is told they are 30 short of something they
                are 5 short of. */}
            {splitPaid && <Row label="Onboarding credits" value={-allowance} tone="credit" />}
            {splitPaid && <Row label="Needed from wallet" value={wanted} />}
            <Row label="In your wallet" value={balance} />
            <div className="!mt-3 border-t border-white/10 pt-3">
              <Row label="Short by" value={short} strong />
            </div>
          </dl>
        )}

        <p className="mt-3 text-[12.5px] leading-relaxed text-white/60">
          Nothing has been charged. Your work on the board is exactly where you left it.
        </p>

        <div className="mt-5 flex items-center gap-2">
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl border border-white/12 px-4 py-2.5 text-[13.5px] font-medium text-white/75 transition-colors hover:bg-white/5"
          >
            Not now
          </button>
          <button
            type="button"
            onClick={onUpgrade}
            className="flex-[1.6] rounded-xl bg-white px-4 py-2.5 text-[13.5px] font-semibold text-black transition-opacity hover:opacity-90"
          >
            {plan === 'free' ? 'Upgrade plan' : 'Get more credits'}
          </button>
        </div>
      </div>

      <style>{`
        @keyframes insufficient-rise {
          from { opacity: 0; transform: translateY(8px) scale(0.985); }
          to   { opacity: 1; transform: none; }
        }
      `}</style>
    </div>,
    document.body
  );
}

function Row({ label, value, strong = false, tone }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className={strong ? 'text-white' : 'text-white/60'}>{label}</dt>
      <dd
        className={`inline-flex items-center gap-1 tabular-nums ${
          strong ? 'text-[15px] font-bold text-white' : 'font-medium text-white/80'
        } ${tone === 'credit' ? 'text-emerald-300/90' : ''}`}
      >
        {value < 0 ? `−${Math.abs(value)}` : value}
        <img src={creditIcon} alt="" className="h-3.5 w-3.5 opacity-80" aria-hidden />
      </dd>
    </div>
  );
}
