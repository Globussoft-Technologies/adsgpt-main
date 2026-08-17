import React from 'react';
import { Loader2 } from 'lucide-react';
import {
  Banner,
  InlineSpinner,
  PrimaryButton,
  SecondaryButton,
} from '@/components/Autopilot/_atoms';

// ----------------------------------------------------------------------------
// The Quick-setup panel shell, in Autopilot's vocabulary.
//
// One shape, used by every screen in the flow so the brief, the previews and
// the automation toggle read as one product rather than three:
//
//   Panel        Autopilot's Section surface — a SOLID #14181D card, clearly
//                lifted off the page rather than a few percent of white
//   PanelHeader  title + subtitle, divided by a rule
//   PanelBody    the content
//   PanelFooter  the primary action, on a slightly recessed strip
//
// The value ordering is the part that matters: page → card (#14181D) →
// control (white/6). Each step is a visible lift, which is what makes a dark
// screen legible. Earlier passes had every layer within a couple of percent of
// the page and read as one black sheet.
// ----------------------------------------------------------------------------

export function Panel({ className = '', children }) {
  return (
    <div
      className={`overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-white/10 dark:bg-[#14181D] ${className}`}
    >
      {children}
    </div>
  );
}

export function PanelHeader({ title, subtitle, right }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-200 px-4 py-3.5 dark:border-white/10 2xl:px-5 2xl:py-4">
      <div className="min-w-0 flex-1">
        <h3 className="text-base font-bold text-gray-900 dark:text-white 2xl:text-lg">{title}</h3>
        {subtitle && (
          <p className="mt-1 text-13 text-gray-500 dark:text-white/70 2xl:text-sm">{subtitle}</p>
        )}
      </div>
      {right}
    </div>
  );
}

export function PanelBody({ className = '', children }) {
  return <div className={`px-4 py-4 2xl:px-5 2xl:py-5 ${className}`}>{children}</div>;
}

export function PanelFooter({ className = '', children }) {
  return (
    <div
      className={`border-t border-gray-200 bg-gray-50 px-4 py-3.5 dark:border-white/10 dark:bg-white/2 2xl:px-5 2xl:py-4 ${className}`}
    >
      {children}
    </div>
  );
}

// ─── Buttons ─────────────────────────────────────────────────────────────────

// Autopilot's gradient primary — cyan → indigo, black text. Its `disabled`
// state is a plain opacity drop, so busy/disabled need no separate styling.
export function PrimaryBtn({ onClick, disabled, busy, icon: Icon, className = '', children }) {
  return (
    <PrimaryButton onClick={onClick} disabled={disabled || busy} className={className}>
      {busy ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        Icon && <Icon className="h-3.5 w-3.5" />
      )}
      <span>{children}</span>
    </PrimaryButton>
  );
}

export function GhostBtn({ onClick, disabled, className = '', children }) {
  return (
    <SecondaryButton onClick={onClick} disabled={disabled} className={className}>
      {children}
    </SecondaryButton>
  );
}

// ─── Notices ─────────────────────────────────────────────────────────────────

// Autopilot's Banner. Amber for "worth knowing", red only for a real failure —
// a partial result is information, not an error state for the whole screen.
export function Notice({ tone = 'info', icon: Icon, children }) {
  const variant = tone === 'warn' ? 'warn' : tone === 'error' ? 'error' : 'info';
  return (
    <Banner variant={variant}>
      <span className="flex items-start gap-2">
        {Icon && <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
        <span className="min-w-0">{children}</span>
      </span>
    </Banner>
  );
}

export { InlineSpinner };
