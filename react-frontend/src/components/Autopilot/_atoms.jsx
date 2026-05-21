import React, { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Info } from 'lucide-react';

/**
 * Autopilot-local dark atoms. Lifted from the original `#0D0D0D/60` shell
 * to `#14181D` / `border-white/10` so cards read clearly against the page
 * background. Cross-feature primitives (Dropdown, KpiCard, StatusBadge)
 * come from `components/MetaAds/MetaAdsAtoms`.
 */

// ─── containers ────────────────────────────────────────────────────────────
export const Section = ({ children, className = '' }) => (
  <section
    className={`rounded-2xl border border-white/10 bg-[#14181D] p-4 backdrop-blur-xl 2xl:p-5 ${className}`}
  >
    {children}
  </section>
);

export const SectionHeader = ({ title, subtitle, right }) => (
  <div className="mb-3 flex items-start justify-between gap-3">
    <div className="flex-1">
      <h3 className="text-base font-bold text-white 2xl:text-lg">{title}</h3>
      {subtitle && <p className="mt-1 text-13 text-white/70 2xl:text-sm">{subtitle}</p>}
    </div>
    {right}
  </div>
);

// ─── buttons ───────────────────────────────────────────────────────────────
export const PrimaryButton = ({
  children,
  onClick,
  disabled,
  type = 'button',
  className = '',
}) => (
  <button
    type={type}
    onClick={onClick}
    disabled={disabled}
    className={`flex shrink-0 items-center gap-1.5 rounded-xl bg-linear-to-r from-[#15DCFF] to-[#6b72f8] px-3 py-1.5 text-xs font-bold text-black transition-all hover:opacity-90 disabled:opacity-50 2xl:px-3.5 2xl:py-2 2xl:text-13 ${className}`}
  >
    {children}
  </button>
);

export const SecondaryButton = ({
  children,
  onClick,
  disabled,
  className = '',
  title,
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    title={title}
    className={`flex shrink-0 items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.06] px-3 py-1.5 text-xs font-medium text-white/80 backdrop-blur-xl transition-all hover:border-white/20 hover:text-white disabled:opacity-50 2xl:px-3.5 2xl:py-2 2xl:text-13 ${className}`}
  >
    {children}
  </button>
);

// ─── form atoms ────────────────────────────────────────────────────────────
export const DarkInput = (props) => (
  <input
    {...props}
    className={`h-9 w-full rounded-xl border border-white/12 bg-white/[0.06] px-3 text-xs text-white placeholder:text-white/45 focus:border-[#15DCFF]/40 focus:bg-white/[0.08] focus:outline-none disabled:opacity-50 2xl:h-10 2xl:px-3.5 2xl:text-13 ${props.className || ''}`}
  />
);

export const Field = ({ label, hint, children }) => (
  <div className="flex flex-col gap-1.5">
    <label className="text-10 font-medium uppercase tracking-wider text-white/60 2xl:text-[11px]">
      {label}
    </label>
    {children}
    {hint && <p className="text-10 leading-relaxed text-white/60 2xl:text-[11px]">{hint}</p>}
  </div>
);

export const CheckboxBox = ({ checked, disabled }) => (
  <span
    className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-all ${
      checked
        ? 'border-[#15DCFF] bg-[#15DCFF]'
        : 'border-white/20 bg-transparent'
    } ${disabled ? 'opacity-50' : ''}`}
  >
    {checked && <Check className="h-3 w-3 text-black" strokeWidth={3} />}
  </span>
);

// ─── feedback ──────────────────────────────────────────────────────────────
export const Banner = ({ variant = 'info', children, className = '' }) => {
  const cls =
    variant === 'success'
      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
      : variant === 'warn'
        ? 'border-amber-500/30 bg-amber-500/10 text-amber-400'
        : variant === 'error'
          ? 'border-red-500/30 bg-red-500/10 text-red-400'
          : 'border-white/6 bg-white/2 text-white/70';
  return (
    <div className={`rounded-xl border p-2.5 text-xs 2xl:p-3 2xl:text-13 ${cls} ${className}`}>
      {children}
    </div>
  );
};

// Severity badge — handles both v4 user-rule severities (low/medium/high)
// and the legacy v3 audit severities (critical/warning/opportunity), since
// the LLM audit feature still emits the latter set.
export const SeverityBadge = ({ severity }) => {
  // Severity palette: HIGH = red, MEDIUM = amber/yellow, LOW = sky (light
  // blue). Low used to be emerald which read as "good/success" — wrong
  // semantic; low-severity is informational, not positive.
  const cls =
    severity === 'high' || severity === 'critical'
      ? 'border-red-500/30 bg-red-500/10 text-red-400'
      : severity === 'medium' || severity === 'warning'
        ? 'border-amber-500/30 bg-amber-500/10 text-amber-400'
        : 'border-sky-500/30 bg-sky-500/10 text-sky-400';
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-10 font-bold uppercase tracking-wide ${cls}`}
    >
      {severity}
    </span>
  );
};

// ─── code span (for env vars / collection names in copy) ───────────────────
export const CodeSpan = ({ children }) => (
  <code className="rounded bg-white/5 px-1 text-[11px] text-white/70">
    {children}
  </code>
);

// ─── tiny inline spinner ───────────────────────────────────────────────────
export const InlineSpinner = ({ className = '' }) => (
  <div className={`relative h-4 w-4 ${className}`}>
    <div className="absolute inset-0 rounded-full border-2 border-white/10" />
    <div className="absolute inset-0 animate-spin rounded-full border-2 border-t-[#15DCFF]" />
  </div>
);

// ─── Switch ────────────────────────────────────────────────────────────────
// Pill-style on/off switch matching the new Autopilot Settings design.
// Larger than a checkbox, smaller than a button; labels live alongside it.
export const Switch = ({ checked, onChange, disabled, size = 'md', ariaLabel }) => {
  const dims =
    size === 'sm'
      ? { w: 'w-8', h: 'h-4', knob: 'h-3 w-3', tx: 'translate-x-4' }
      : { w: 'w-9', h: 'h-5', knob: 'h-3.5 w-3.5', tx: 'translate-x-4' };
  return (
    <button
      type="button"
      role="switch"
      aria-checked={!!checked}
      aria-label={ariaLabel}
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onChange?.(!checked);
      }}
      disabled={disabled}
      className={`relative inline-flex shrink-0 items-center rounded-full transition-colors ${dims.w} ${dims.h} ${
        checked ? 'bg-[#15DCFF]' : 'bg-white/15'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <span
        className={`inline-block transform rounded-full bg-white shadow transition-transform ${dims.knob} ${
          checked ? dims.tx : 'translate-x-0.5'
        }`}
      />
    </button>
  );
};

// ─── CollapsibleCard ───────────────────────────────────────────────────────
// Click the header row to expand/collapse. Preview text shows on the right
// while collapsed so users can scan settings without opening every card.
//
// Stacking strategy:
//   - All cards: `relative` (so z-index applies).
//   - Open cards: z-30 — sit above closed cards so their content/borders
//     paint above sibling cards in DOM order.
//   - The card currently being INTERACTED WITH (focus inside, i.e. an
//     open Dropdown trigger or input has focus): z-50 via focus-within —
//     wins over other open cards so its dropdown isn't clipped behind a
//     sibling that also happens to be expanded.
// `backdrop-blur` is intentionally NOT used here; it'd create a per-card
// stacking context that fights with these rules.
export const CollapsibleCard = ({
  title,
  subtitle,
  preview,
  defaultOpen = false,
  warn = false,
  children,
}) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div
      className={`relative rounded-2xl border bg-[#14181D] transition-colors focus-within:z-50 ${
        open ? 'z-30' : ''
      } ${
        warn
          ? 'border-amber-500/30'
          : open
            ? 'border-white/14'
            : 'border-white/10'
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-all hover:bg-white/4 2xl:px-5 2xl:py-3.5"
      >
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <span className="min-w-0 truncate text-sm font-bold text-white 2xl:text-15">{title}</span>
          {subtitle && (
            <span className="hidden text-10 uppercase tracking-wider text-white/55 sm:inline 2xl:text-[11px]">
              {subtitle}
            </span>
          )}
        </div>
        <div className="flex min-w-0 items-center gap-2">
          {!open && preview && (
            <span
              className={`hidden min-w-0 truncate text-xs sm:inline-block 2xl:text-13 ${
                warn ? 'text-amber-400' : 'text-white/70'
              }`}
            >
              {preview}
            </span>
          )}
          <ChevronDown
            className={`h-3.5 w-3.5 shrink-0 text-white/70 transition-transform 2xl:h-4 2xl:w-4 ${
              open ? 'rotate-180' : ''
            }`}
          />
        </div>
      </button>
      {open && (
        <div className="border-t border-white/10 p-4 2xl:p-5">{children}</div>
      )}
    </div>
  );
};

// ─── InfoTip ────────────────────────────────────────────────────────────────
// Hover/focus tooltip — small info icon that reveals a help bubble. Used
// inline beside section titles / field labels.
//
// Rendering model: the bubble is portaled to `document.body` because the
// page-level AutopilotPage wrapper has `overflow-hidden`, which would clip
// any bubble that overflowed the page chrome (e.g. above the visible
// scroll area). Position is measured against the icon's bounding rect on
// every open + whenever the viewport scrolls/resizes, then auto-flipped
// to keep the bubble inside the viewport on both axes.
//
// Click on the icon is stopped so opening the tip doesn't bubble up to a
// parent toggle (e.g. CollapsibleCard header) and accidentally expand it.
export const InfoTip = ({ text, className = '' }) => {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const triggerRef = useRef(null);

  // Measure the icon's viewport position whenever the tip opens. Width is
  // fixed (240px); the placement logic flips horizontally if the icon is
  // too close to the right edge, and vertically if too close to the bottom.
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return undefined;
    const measure = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const tipWidth = 220;
      const margin = 8;
      // Default: anchor tip's left edge to icon's left edge.
      let left = rect.left;
      if (left + tipWidth + margin > window.innerWidth) {
        // Flip — anchor tip's right edge to icon's right edge.
        left = rect.right - tipWidth;
      }
      left = Math.max(margin, left);
      let top = rect.bottom + 6;
      // If bubble would overflow viewport bottom, place above the icon.
      const tipMaxHeight = 180;
      if (top + tipMaxHeight > window.innerHeight) {
        top = rect.top - 6 - tipMaxHeight;
        if (top < margin) top = margin;
      }
      setPos({ top, left });
    };
    measure();
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, [open]);

  return (
    <span
      ref={triggerRef}
      className={`relative inline-flex ${className}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onClick={(e) => e.stopPropagation()}
    >
      <Info className="h-3.5 w-3.5 cursor-help text-white/55 hover:text-white/85 2xl:h-4 2xl:w-4" />
      {open && pos
        ? createPortal(
            <span
              role="tooltip"
              style={{
                position: 'fixed',
                top: pos.top,
                left: pos.left,
                width: 220,
              }}
              className="pointer-events-none z-[9999] rounded-md border border-white/12 bg-[#161B22] px-2 py-1.5 text-[10px] leading-snug font-normal whitespace-normal text-white/80 shadow-xl"
            >
              {text}
            </span>,
            document.body,
          )
        : null}
    </span>
  );
};
