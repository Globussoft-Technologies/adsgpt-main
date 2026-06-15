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

// Section header with a soft-accent icon chip, title, and optional hint + right slot.
export const SectionTitle = ({ icon: Icon, children, hint, right }) => (
  <div className="mb-5 flex items-center gap-4">
    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-[#6b72f8]/30 bg-[#6b72f8]/10 text-[#7c93ff]">
      {Icon && <Icon className="h-[22px] w-[22px]" />}
    </span>
    <div className="min-w-0 flex-1">
      <h2 className="text-[26px] font-extrabold tracking-tight text-gray-900 dark:text-white">
        {children}
      </h2>
      {hint && <p className="mt-1 text-sm text-gray-500 dark:text-white/55">{hint}</p>}
    </div>
    {right}
  </div>
);

// ─── pills / badges ──────────────────────────────────────────────────────────
export const Pill = ({ band, children, dot = false, className = '' }) => (
  <span
    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-extrabold uppercase tracking-wide ${band.bg} ${band.ring} ${band.text} ${className}`}
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

// Soft-accent numbered chip (improvement rows).
export const NumberBadge = ({ children, className = '' }) => (
  <span
    className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-[#6b72f8]/30 bg-[#6b72f8]/10 text-base font-extrabold text-[#7c93ff] ${className}`}
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
    className={`flex shrink-0 items-center gap-2 rounded-xl bg-linear-to-r from-[#15DCFF] to-[#6b72f8] px-4 py-2.5 text-sm font-bold text-black transition-all hover:opacity-90 disabled:opacity-50 ${className}`}
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
