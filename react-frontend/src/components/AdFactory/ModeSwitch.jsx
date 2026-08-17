import React from 'react';

// ----------------------------------------------------------------------------
// ModeSwitch — Quick setup ⇄ Full control.
//
// Naming matters here. We never show "v1" / "v2": version numbers make whichever
// side the user is on feel like a mistake, and Full control genuinely serves
// people who want per-field control — an agency running several client brands
// may reasonably prefer it. Framing it as a capability rather than legacy is
// both kinder and more accurate.
//
// Scope is PER CAMPAIGN, not a global preference, so the same user can run one
// client on Quick setup and another on Full control.
//
// Switching is a view change only. It never rewrites the campaign's content and
// never touches its automation job — a live automation keeps running straight
// across a switch.
// ----------------------------------------------------------------------------

export const UI_MODE = Object.freeze({ QUICK: 'quick', FULL: 'full' });

// Descriptive, not version-flavoured. "New" / "Old" was tried and reverted:
// naming one side "Old" tells everyone sitting on the default — which is Full
// control, a permanently supported mode — that they are on the deprecated
// thing. These labels say what each mode IS.
const OPTIONS = [
  { value: UI_MODE.QUICK, label: 'Quick setup' },
  { value: UI_MODE.FULL, label: 'Full control' },
];

export default function ModeSwitch({ mode, onChange, disabled = false, busy = false }) {
  const current = mode === UI_MODE.QUICK ? UI_MODE.QUICK : UI_MODE.FULL;

  return (
    <div
      role="group"
      aria-label="Setup mode"
      className="inline-flex gap-1 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-[#252525] p-1"
    >
      {OPTIONS.map((opt) => {
        const active = current === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={active}
            disabled={disabled || busy || active}
            onClick={() => onChange?.(opt.value)}
            className={`rounded-lg px-3.5 py-1.5 text-[12px] font-semibold whitespace-nowrap transition-colors disabled:cursor-not-allowed ${
              active
                ? 'bg-linear-to-br from-[#15DCFF]/15 to-[#6b72f8]/15 text-[#6b72f8] dark:text-[#8f95ff]'
                : 'text-gray-500 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-300 disabled:opacity-45'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
