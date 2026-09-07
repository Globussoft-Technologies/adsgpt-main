import React, { useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Layers, ArrowUpRight, ArrowDownRight, Minus, GraduationCap, ShieldAlert } from 'lucide-react';
import { STATUS_MAP, deliveryTone } from './metaAdsUtils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

// ─── chart tooltip ────────────────────────────────────────────────────────────

export function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-2xl border border-[#DDD7CD] bg-[#FCFAF7]/95 px-3.5 py-2.5 shadow-[0_12px_32px_rgba(80,70,58,0.12)] backdrop-blur-xl dark:border-white/10 dark:bg-[#161616]/95 dark:shadow-[0_12px_32px_rgba(0,0,0,0.5)]">
      {label && <p className="mb-1.5 text-[11px] font-semibold text-[#7A7369] dark:text-[#A0A0A0]">{label}</p>}
      {payload.map((p, i) => {
        const isSpend = String(p.name).toLowerCase().includes('spend');
        const color = isSpend ? '#00C2FF' : '#818CF8';
        return (
          <div key={i} className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color, boxShadow: `0 0 8px ${color}` }} />
            <p className="text-xs font-bold text-[#24211D] dark:text-white">
              <span className="text-[#7A7369] dark:text-white/60 font-medium">{p.name}: </span>
              {typeof p.value === 'number' ? p.value.toLocaleString() : p.value}
            </p>
          </div>
        );
      })}
    </div>
  );
}

// ─── status badge ─────────────────────────────────────────────────────────────

export function StatusBadge({ status }) {
  const s = STATUS_MAP[status] ?? STATUS_MAP.ARCHIVED;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-semibold tracking-wide uppercase ${s.bg} ${s.text}`}
    >
      <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${s.dot}`} />
      {status}
    </span>
  );
}

// ─── delivery badge ───────────────────────────────────────────────────────────
// What Meta is ACTUALLY doing with the entity, as opposed to what the user last
// set. Rendered next to StatusBadge only when the two disagree — showing
// "Active / Active" on every healthy row would be pure noise, while a rejected
// ad reading "Active" was the bug this exists to fix.

export function DeliveryBadge({ delivery, issues }) {
  if (!delivery) return null;

  // Nothing to add when Meta agrees with the user's setting and there are no
  // issues attached.
  const issueList = Array.isArray(issues) ? issues.filter(Boolean) : [];
  if (!delivery.diverged && issueList.length === 0) return null;

  const t = deliveryTone(delivery.tone);

  const badge = (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-semibold tracking-wide uppercase ${t.bg} ${t.text}`}
    >
      <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${t.dot}`} />
      {delivery.label}
    </span>
  );

  // Meta's issues_info carries the human-readable "why", which is the whole
  // point of surfacing this — a badge alone still leaves the user guessing.
  if (issueList.length === 0) return badge;

  return (
    <Tooltip delayDuration={150}>
      <TooltipTrigger asChild>
        <span className="inline-flex cursor-help">{badge}</span>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6} className="max-w-80">
        <div className="space-y-1.5">
          {issueList.slice(0, 3).map((issue, i) => (
            <p key={i} className="text-xs leading-relaxed">
              {issue.error_summary || issue.error_message || issue.error_type}
            </p>
          ))}
          {issueList.length > 3 && (
            <p className="text-[11px] opacity-70">+{issueList.length - 3} more</p>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

// ─── learning phase badge ─────────────────────────────────────────────────────
// Only rendered for ad sets still learning or stuck learning-limited; an ad set
// that finished learning normally gets nothing (the backend returns null).

export function LearningBadge({ learning }) {
  if (!learning) return null;
  const t = deliveryTone(learning.tone);

  const limited = learning.stage === 'LEARNING_LIMITED';

  return (
    <Tooltip delayDuration={150}>
      <TooltipTrigger asChild>
        <span
          className={`inline-flex cursor-help items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-semibold tracking-wide uppercase ${t.bg} ${t.text}`}
        >
          <GraduationCap className="h-2.5 w-2.5 shrink-0" />
          {learning.label}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6} className="max-w-80">
        <p className="text-xs leading-relaxed">
          {limited
            ? "This ad set left the learning phase without enough optimisation events, so delivery stays unstable and costs more. Widening the audience, raising the budget, or consolidating it with a similar ad set usually fixes it."
            : "Meta is still learning who responds best. Performance is unreliable and costs fluctuate until it exits — roughly 50 optimisation events."}
          {typeof learning.conversions === 'number' && (
            <> {' '}<span className="font-semibold">{learning.conversions}</span> events so far.</>
          )}
        </p>
        {learning.lastSignificantEditTime && (
          <p className="mt-1.5 text-[11px] opacity-70">
            Learning restarted on {new Date(learning.lastSignificantEditTime).toLocaleDateString()} — significant
            edits reset it.
          </p>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

// ─── ad review / rejection badge ──────────────────────────────────────────────
// A rejected ad is otherwise visually identical to a running one, because its
// `status` stays ACTIVE — the user never paused it, Meta stopped it.

export function ReviewBadge({ review }) {
  if (!review?.reasons?.length) return null;

  return (
    <Tooltip delayDuration={150}>
      <TooltipTrigger asChild>
        <span className="inline-flex cursor-help items-center gap-1 rounded-full border border-red-400/30 bg-red-400/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-red-600 dark:border-red-400/20 dark:text-red-400">
          <ShieldAlert className="h-2.5 w-2.5 shrink-0" />
          {review.count === 1 ? 'Policy issue' : `${review.count} policy issues`}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6} className="max-w-80">
        <div className="space-y-2">
          {review.reasons.slice(0, 3).map((r, i) => (
            <div key={i}>
              <p className="text-xs font-semibold">
                {r.policy}
                {r.placement && (
                  <span className="ml-1 font-normal opacity-70">({r.placement})</span>
                )}
              </p>
              <p className="text-xs leading-relaxed opacity-90">{r.reason}</p>
            </div>
          ))}
          {review.reasons.length > 3 && (
            <p className="text-[11px] opacity-70">+{review.reasons.length - 3} more</p>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

// ─── spinner ──────────────────────────────────────────────────────────────────

export function Spinner() {
  return (
    <div className="flex items-center justify-center py-10">
      <div className="relative h-8 w-8">
        <div className="absolute inset-0 rounded-full border-2 border-[#DDD7CD] dark:border-white/10" />
        <div className="absolute inset-0 animate-spin rounded-full border-2 border-t-[#0082FB]" />
      </div>
    </div>
  );
}

// ─── empty state ──────────────────────────────────────────────────────────────

export function EmptyState({ message }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-[#DDD7CD] bg-[#FCFAF7] py-12 dark:border-white/5 dark:bg-[#0D0D0D]/50">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#EAE5DC] text-[#7A7369] ring-1 ring-[#DDD7CD] dark:bg-white/5 dark:text-[#BEBEBE] dark:ring-0">
        <Layers className="h-5 w-5 text-[#7A7369] dark:text-[#BEBEBE]" />
      </div>
      <p className="text-sm text-[#7A7369] dark:text-[#BEBEBE]">{message}</p>
    </div>
  );
}

// ─── gradient text ────────────────────────────────────────────────────────────

export function GradientText({ children, className = '' }) {
  return (
    <span
      className={`bg-gradient-to-r from-[#15DCFF] to-[#6b72f8] bg-clip-text text-transparent ${className}`}
    >
      {children}
    </span>
  );
}

// ─── KPI card ─────────────────────────────────────────────────────────────────

export function KpiCard({ icon: Icon, label, value, sub, glowColor, trend, loading }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="group relative overflow-hidden rounded-2xl border border-[#DDD7CD] bg-[#FCFAF7] p-4 shadow-[0_4px_20px_-2px_rgba(80,70,58,0.05),0_2px_6px_-1px_rgba(80,70,58,0.03)] backdrop-blur-xl transition-all duration-300 dark:border-white/10 dark:bg-[#14181D] 2xl:p-5"
    >
      <div
        className={`pointer-events-none absolute -top-6 -right-6 h-20 w-20 rounded-full opacity-20 blur-2xl ${glowColor ?? 'bg-[#15DCFF]'}`}
      />
      <div className="relative flex flex-col gap-3">
        <div className="flex items-start justify-between">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#FCFAF7] shadow-xs ring-1 ring-[#DDD7CD] dark:bg-gradient-to-br dark:from-[#15DCFF]/20 dark:to-[#6b72f8]/20 dark:ring-0">
            <Icon className="h-4 w-4 text-[#0082FB] dark:text-[#15DCFF]" />
          </div>
          {trend != null && !loading && (
            <span
              className={`flex items-center gap-0.5 text-[10px] font-bold ${trend > 0 ? 'text-emerald-600 dark:text-emerald-400' : trend < 0 ? 'text-red-600 dark:text-red-400' : 'text-[#7A7369] dark:text-white/80'}`}
            >
              {trend > 0 ? (
                <ArrowUpRight className="h-3 w-3" />
              ) : trend < 0 ? (
                <ArrowDownRight className="h-3 w-3" />
              ) : (
                <Minus className="h-3 w-3" />
              )}
              {Math.abs(trend)}%
            </span>
          )}
        </div>
        <div>
          <p className="text-[11px] font-bold tracking-wider text-[#7A7369] uppercase dark:text-white/90">
            {label}
          </p>
          {loading ? (
            <div className="mt-1.5 h-6 w-24 animate-pulse rounded-lg bg-[#E5DFD5] dark:bg-white/5" />
          ) : (
            <p className="mt-0.5 text-xl font-bold text-[#24211D] dark:text-white 2xl:text-2xl">{value}</p>
          )}
          {sub && !loading && <p className="mt-0.5 text-[11px] font-medium text-[#7A7369] dark:text-white/85">{sub}</p>}
        </div>
      </div>
    </motion.div>
  );
}

// ─── dropdown ─────────────────────────────────────────────────────────────────

export function Dropdown({
  trigger,
  children,
  open,
  onClose,
  anchor = 'right',
  direction = 'down',
}) {
  const ref = useRef(null);
  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, onClose]);

  const horizontal = anchor === 'left' ? 'left-0' : 'right-0';
  const vertical = direction === 'up' ? 'bottom-full mb-2' : 'top-full mt-2';
  // Flip the enter animation so an upward menu still slides toward the trigger.
  const yIn = direction === 'up' ? 6 : -6;

  return (
    <div className="relative" ref={ref}>
      {trigger}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: yIn, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: yIn, scale: 0.97 }}
            transition={{ duration: 0.14, ease: 'easeOut' }}
            className={`absolute ${horizontal} ${vertical} z-50 overflow-hidden rounded-2xl border border-[#DDD7CD] bg-[#FCFAF7] shadow-2xl backdrop-blur-xl dark:border-white/12 dark:bg-[#14181D]/95`}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
