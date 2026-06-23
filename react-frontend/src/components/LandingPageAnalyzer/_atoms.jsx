// Landing Page Analyzer atoms — ported from the report.jsx reference, scaled up
// for readability. Dual-theme: light surfaces + dark gradient via dark: variants.
import { prioBand } from './helpers';

// ─── containers ──────────────────────────────────────────────────────────────
export const Card = ({ children, className = '', style }) => (
  <div
    style={style}
    className={`rounded-[20px] border border-gray-200 bg-white dark:border-white/10 dark:bg-gradient-to-b dark:from-[#16181f] dark:to-[#111217] ${className}`}
  >
    {children}
  </div>
);

// Section header — bold white title (matches the "Page Overview" hero heading)
// + subtitle, with an optional right slot. `icon` is still accepted for
// backwards-compat with callers but is intentionally not rendered.
export const SectionTitle = ({ children, hint, right }) => (
  <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
    <div className="min-w-0">
      <h2 className="text-xl font-bold tracking-tight text-gray-900 dark:text-white">
        {children}
      </h2>
      {hint && <p className="2xl:mt-1.5 text-sm text-gray-400 dark:text-white/45">{hint}</p>}
    </div>
    {right}
  </div>
);

// In-card header — same caption + subtitle treatment, sized for use inside a
// Card's padded body (Page Overview / Top Priority Issues panels). Optional
// `right` slot for a trailing action (e.g. "View all issues →").
export const CardCaption = ({ children, hint, right, className = '' }) => (
  <div className={`flex items-start justify-between gap-3 ${className}`}>
    <div className="min-w-0">
      <h3 className="text-13 font-extrabold uppercase tracking-[0.14em] text-gray-500 dark:text-white/55">
        {children}
      </h3>
      {hint && <p className="mt-1.5 text-sm text-gray-400 dark:text-white/45">{hint}</p>}
    </div>
    {right}
  </div>
);

// ─── pills / badges ──────────────────────────────────────────────────────────
export const Pill = ({ band, children, dot = false, className = '' }) => (
  <span
    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[10px] 2xl:text-[11px] font-extrabold uppercase tracking-wide ${band.bg} ${band.ring} ${band.text} ${className}`}
  >
    {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
    {children}
  </span>
);

export const PriorityBadge = ({ priority }) => <Pill band={prioBand(priority)}>{priority}</Pill>;

export const RatingPill = ({ rating, band }) => <Pill band={band}>{rating}</Pill>;

// Numeric score delta: +N green, -N red, ±0 faint. Null renders nothing.
export const Delta = ({ value }) => {
  if (value === null || value === undefined) return null;
  if (value === 0)
    return <span className="text-xs font-bold text-gray-400 dark:text-white/35">±0</span>;
  const up = value > 0;
  return (
    <span
      className={`text-xs font-bold tabular-nums ${up ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}
    >
      {up ? '+' : ''}
      {value}
    </span>
  );
};

// Plain accent number (improvement rows) — no chip background/border.
export const NumberBadge = ({ children, className = '' }) => (
  <span
    className={`grid h-8 w-8 shrink-0 place-items-center text-base font-extrabold text-white ${className}`}
  >
    {children}
  </span>
);

// ─── buttons ─────────────────────────────────────────────────────────────────
export const GradBtn = ({ children, onClick, disabled, icon: Icon, spinning, className = '' }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className={`flex shrink-0 items-center gap-2 rounded-xl bg-linear-to-r from-[#15DCFF] to-[#6b72f8] px-4 py-2.5 text-sm font-bold text-black transition-all enabled:hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
  >
    {Icon && <Icon className={`h-4 w-4 ${spinning ? 'animate-spin' : ''}`} />}
    {children}
  </button>
);

export const GhostBtn = ({ children, onClick, disabled, icon: Icon, className = '' }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className={`flex shrink-0 items-center gap-2 rounded-xl border border-gray-200 bg-gray-100 px-4 py-2.5 text-sm font-medium text-gray-600 transition-all hover:border-gray-300 hover:text-gray-900 disabled:opacity-50 dark:border-white/10 dark:bg-white/[0.06] dark:text-white/80 dark:hover:border-white/20 dark:hover:text-white ${className}`}
  >
    {Icon && <Icon className="h-4 w-4" />}
    {children}
  </button>
);
