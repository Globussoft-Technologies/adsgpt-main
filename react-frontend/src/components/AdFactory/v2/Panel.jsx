import React from 'react';
import { AlertCircle, AlertTriangle, Loader2 } from 'lucide-react';
import {
  BTN_GHOST,
  BTN_PRIMARY,
  CARD,
  MUTED,
  RULE_BORDER,
  SECTION,
  SECTION_PAD,
} from './_tokens';

// ----------------------------------------------------------------------------
// The Quick-setup panel shell, in the "Refined" vocabulary (`_tokens.js`).
//
// One shape, used by every screen in the flow so the brief, the previews and
// the automation toggle read as one product rather than three:
//
//   Panel        a 10px card — one hairline, one fill, no second border and no
//                shadow in dark
//   PanelHeader  title + subtitle, divided by a rule
//   PanelBody    the content
//   PanelFooter  the primary action, on the same surface — a recessed strip is
//                a fourth value step nobody needed
//
// The value ordering that matters: page (#0f0f0f) → card (#14181D) → control
// (#1E232A). Autopilot's own ramp, because a pure-neutral one tried here first
// put all three within a few points of each other and the screen read as one
// flat black sheet. Each step is a visible lift now, which is the thing that
// makes a dark UI legible — see the note in `_tokens.js`.
// ----------------------------------------------------------------------------

export function Panel({ className = '', children }) {
  return <div className={`overflow-hidden ${CARD} ${className}`}>{children}</div>;
}

export function PanelHeader({ title, subtitle, right }) {
  return (
    <div
      className={`flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4 ${RULE_BORDER} 2xl:px-6`}
    >
      <div className="min-w-0 flex-1">
        <h3 className={SECTION}>{title}</h3>
        {subtitle && <p className={`mt-1 ${MUTED}`}>{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

export function PanelBody({ className = '', children }) {
  return <div className={`${SECTION_PAD} ${className}`}>{children}</div>;
}

export function PanelFooter({ className = '', children }) {
  return (
    <div className={`border-t px-5 py-4 ${RULE_BORDER} 2xl:px-6 ${className}`}>{children}</div>
  );
}

// ─── Buttons ─────────────────────────────────────────────────────────────────

// The app's own gradient — the cyan-to-indigo the ACTIVE sidebar tile wears.
// This is the one saturated element the screen gets, so it has to be the thing
// you click and nothing else. See BTN_PRIMARY in `_tokens.js` for why it is a
// gradient here when a flat fill would be the general advice.
export function PrimaryBtn({ onClick, disabled, busy, icon: Icon, className = '', children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      className={`${BTN_PRIMARY} ${className}`}
    >
      {busy ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        Icon && <Icon className="h-3.5 w-3.5" />
      )}
      <span>{children}</span>
    </button>
  );
}

export function GhostBtn({ onClick, disabled, className = '', children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`${BTN_GHOST} ${className}`}
    >
      {children}
    </button>
  );
}

// ─── Notices ─────────────────────────────────────────────────────────────────

// Amber for "worth knowing", red only for a real failure — a partial result is
// information, not an error state for the whole screen. Both are a tinted
// hairline box, so a notice never out-shouts the primary action.
const TONES = {
  info: {
    box: 'border-[#E5E7EB] bg-[#F9FAFB] text-[#374151] dark:border-[#2E353E] dark:bg-[#1E232A] dark:text-[#AFB6C0]',
    icon: AlertCircle,
  },
  warn: {
    box: 'border-[#F59E0B]/30 bg-[#F59E0B]/8 text-[#92400E] dark:text-[#E8A33D]',
    icon: AlertTriangle,
  },
  error: {
    box: 'border-[#DC2626]/30 bg-[#DC2626]/8 text-[#991B1B] dark:text-[#F87171]',
    icon: AlertCircle,
  },
};

export function Notice({ tone = 'info', icon: Icon, children }) {
  const t = TONES[tone] || TONES.info;
  const Ico = Icon || t.icon;
  return (
    <div className={`flex items-start gap-2.5 rounded-lg border px-3.5 py-3 text-13 ${t.box}`}>
      {Ico && <Ico className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  );
}

export function InlineSpinner({ className = '' }) {
  return <Loader2 className={`h-3.5 w-3.5 animate-spin ${className}`} />;
}
