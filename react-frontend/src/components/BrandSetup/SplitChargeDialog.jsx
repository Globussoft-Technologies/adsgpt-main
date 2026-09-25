// SplitChargeDialog — the receipt a user sees before a render spends BOTH
// purses.
//
// It exists for one case, and only that case: the onboarding allowance has
// something left in it but not enough to cover the whole render, so the budget
// pays what it can and the wallet funds the rest.
//
// Before ONB-010 that case could not happen — the budget was all-or-nothing, so
// a user holding 25 against a 32-credit render kept the 25 for ever and paid 32
// in cash without being told. Splitting the charge fixes the waste but creates
// a new obligation: real credits now leave a wallet on a screen that has been
// saying "Free" up to this point. Nothing is taken until the number below is
// confirmed.
//
// NOT shown when the budget covers the whole render (nothing leaves the wallet,
// so there is nothing to agree to) and NOT shown when there is no budget left
// at all (an ordinary paid action, priced on the button like every other one).

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import creditIcon from '@/assets/layouts/profile/adcreative.svg';

const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

/**
 * `wallet` is the figure this dialog is asking permission for — and the same
 * figure the caller must send as `maxWalletCredits`, so the server can refuse
 * to charge more than what was shown here.
 */
export default function SplitChargeDialog({
  open,
  cost,
  allowance,
  wallet,
  busy = false,
  stale = false,
  onConfirm,
  onCancel,
}) {
  const confirmRef = useRef(null);

  // Focus the confirm button, and let Escape cancel. A money dialog that traps
  // someone with no way out but the mouse is worse than no dialog.
  useEffect(() => {
    if (!open) return undefined;
    confirmRef.current?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape' && !busy) onCancel?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4"
      style={{ background: 'rgba(6,6,8,0.88)' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="split-charge-title"
    >
      <div
        className="w-full max-w-[380px] rounded-2xl border border-white/10 bg-[#121216] p-5 shadow-2xl"
        style={{ animation: `split-rise 260ms ${EASE} both` }}
      >
        <h2 id="split-charge-title" className="text-[15px] font-semibold text-white">
          Confirm this render
        </h2>

        {/* The whole point of the dialog: the arithmetic, in the open. */}
        <dl className="mt-4 space-y-2 text-[13.5px]">
          <Row label="Render cost" value={cost} />
          <Row label="Onboarding credits" value={-allowance} tone="credit" />
          <div className="!mt-3 border-t border-white/10 pt-3">
            <Row label="Charged to your wallet" value={wallet} strong />
          </div>
        </dl>

        {stale ? (
          // The budget moved between the last screen and the server's answer —
          // another tab spent it. Nothing was charged; this is the new number.
          <p className="mt-3 rounded-lg bg-amber-400/10 px-3 py-2 text-[12.5px] text-amber-200/90">
            Your onboarding credits changed since you last looked. Nothing has been charged —
            this is the updated total.
          </p>
        ) : (
          <p className="mt-3 text-[12.5px] leading-relaxed text-white/60">
            Your remaining onboarding credits cover part of this. The rest comes from your
            wallet.
          </p>
        )}

        <div className="mt-5 flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="flex-1 rounded-xl border border-white/12 px-4 py-2.5 text-[13.5px] font-medium text-white/75 transition-colors hover:bg-white/5 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="flex-[1.6] rounded-xl bg-white px-4 py-2.5 text-[13.5px] font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {busy ? (
              'Starting…'
            ) : (
              <span className="inline-flex items-center justify-center gap-1.5">
                Generate for {wallet}
                <img src={creditIcon} alt="credits" className="h-3.5 w-3.5" />
              </span>
            )}
          </button>
        </div>
      </div>

      <style>{`
        @keyframes split-rise {
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
