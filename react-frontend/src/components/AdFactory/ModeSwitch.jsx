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
      className="flex items-center gap-3 overflow-x-auto scroll-smooth pt-1 pb-2 select-none no-scrollbar sm:gap-4 md:gap-5 2xl:gap-6"
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
            className={`relative flex shrink-0 items-center justify-start py-1 text-xs font-medium whitespace-nowrap transition-colors select-none disabled:cursor-not-allowed sm:text-[13px] 2xl:text-[14.5px] ${
              active
                ? 'font-semibold text-zinc-950 dark:text-white'
                : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white disabled:opacity-45'
            }`}
          >
            <div className="flex items-center gap-1.5 sm:gap-2">
              {Icon && (
                <Icon
                  className={`h-3.5 w-3.5 shrink-0 transition-colors sm:h-4 sm:w-4 2xl:h-[18px] 2xl:w-[18px] ${
                    active
                      ? 'text-zinc-950 stroke-[2.2] dark:text-white'
                      : 'text-zinc-400 stroke-[1.8] dark:text-zinc-400'
                  }`}
                />
              )}
              <span>{opt.label}</span>
              {active && (
                <motion.div
                  layoutId="adFactoryModeSwitchUnderline"
                  className="absolute -bottom-1.5 right-0 left-0 h-[2px] rounded-full bg-zinc-950 dark:bg-white"
                  transition={{ type: 'spring', stiffness: 450, damping: 35 }}
                />
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
