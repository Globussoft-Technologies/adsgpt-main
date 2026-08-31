import React from 'react';
import { motion } from 'framer-motion';
import { Zap, SlidersHorizontal } from 'lucide-react';

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
  { value: UI_MODE.QUICK, label: 'Quick setup', Icon: Zap },
  { value: UI_MODE.FULL, label: 'Full control', Icon: SlidersHorizontal },
];

export default function ModeSwitch({ mode, onChange, disabled = false, busy = false }) {
  const current = mode === UI_MODE.QUICK ? UI_MODE.QUICK : UI_MODE.FULL;

  return (
    <div
      role="group"
      aria-label="Setup mode"
      className="relative flex items-center gap-0 rounded-full border border-black/10 bg-white/80 p-1 shadow-[0_2px_10px_rgba(0,0,0,0.04)] backdrop-blur-md dark:border-transparent dark:bg-[#0D0D0D]"
    >
      {OPTIONS.map((opt) => {
        const active = current === opt.value;
        const Icon = opt.Icon;
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={active}
            disabled={disabled || busy || active}
            onClick={() => onChange?.(opt.value)}
            className={`2xl:text-13 relative flex items-center rounded-full px-3 py-1.5 text-[11px] font-semibold whitespace-nowrap transition-all duration-200 2xl:px-4.5 2xl:py-2 disabled:cursor-not-allowed ${
              active
                ? 'font-bold text-zinc-900 dark:text-white'
                : 'text-zinc-600 hover:text-zinc-900 dark:text-[#AFAFAF] dark:hover:text-white disabled:opacity-45'
            }`}
          >
            <div className="flex items-center gap-1.5 2xl:gap-2">
              {Icon && (
                <Icon
                  className={`h-3.5 w-3.5 2xl:h-4.5 2xl:w-4.5 ${
                    active
                      ? 'text-zinc-900 dark:text-white'
                      : 'text-zinc-500 dark:text-[#AFAFAF]'
                  }`}
                />
              )}
              <span>{opt.label}</span>
            </div>
            {active && (
              <motion.div
                layoutId="adFactoryModeSwitchTabBg"
                className="absolute inset-0 -z-10 rounded-full border border-black/5 bg-white shadow-[0_2px_8px_rgba(0,0,0,0.08),0_1px_2px_rgba(0,0,0,0.04)] dark:border-none dark:bg-gradient-to-br dark:from-[#3C3C3C] dark:to-[#3C3C3C] dark:shadow-none"
                transition={{ type: 'spring', duration: 0.4 }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
