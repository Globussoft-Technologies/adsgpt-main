import React, { useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Layers, ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react';
import { STATUS_MAP } from './metaAdsUtils';

// ─── chart tooltip ────────────────────────────────────────────────────────────

export function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-white/10 bg-[#1A1A1A]/95 px-3 py-2 shadow-xl backdrop-blur-xl">
      {label && <p className="mb-1 text-[10px] font-medium text-[#BEBEBE]">{label}</p>}
      {payload.map((p, i) => (
        <p key={i} className="text-xs font-semibold" style={{ color: p.color || '#15DCFF' }}>
          {p.name}: {typeof p.value === 'number' ? p.value.toLocaleString() : p.value}
        </p>
      ))}
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

// ─── spinner ──────────────────────────────────────────────────────────────────

export function Spinner() {
  return (
    <div className="flex items-center justify-center py-10">
      <div className="relative h-8 w-8">
        <div className="absolute inset-0 rounded-full border-2 border-white/10" />
        <div className="absolute inset-0 animate-spin rounded-full border-2 border-t-[#15DCFF]" />
      </div>
    </div>
  );
}

// ─── empty state ──────────────────────────────────────────────────────────────

export function EmptyState({ message }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-white/5 bg-[#0D0D0D]/50 py-12">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/5">
        <Layers className="h-5 w-5 text-[#BEBEBE]" />
      </div>
      <p className="text-sm text-[#BEBEBE]">{message}</p>
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
      className="group relative overflow-hidden rounded-2xl border border-white/[0.06] bg-[#0D0D0D]/60 p-4 backdrop-blur-xl transition-all duration-300 hover:border-white/10 2xl:p-5"
    >
      <div
        className={`pointer-events-none absolute -top-6 -right-6 h-20 w-20 rounded-full opacity-15 blur-2xl ${glowColor ?? 'bg-[#15DCFF]'}`}
      />
      <div className="relative flex flex-col gap-3">
        <div className="flex items-start justify-between">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-[#15DCFF]/15 to-[#6b72f8]/15">
            <Icon className="h-4 w-4 text-[#15DCFF]" />
          </div>
          {trend != null && !loading && (
            <span
              className={`flex items-center gap-0.5 text-[10px] font-semibold ${trend > 0 ? 'text-emerald-400' : trend < 0 ? 'text-red-400' : 'text-[#BEBEBE]'}`}
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
          <p className="text-[10px] font-medium tracking-widest text-[#BEBEBE] uppercase">
            {label}
          </p>
          {loading ? (
            <div className="mt-1.5 h-6 w-24 animate-pulse rounded-lg bg-white/5" />
          ) : (
            <p className="mt-0.5 text-xl font-bold text-white 2xl:text-2xl">{value}</p>
          )}
          {sub && !loading && <p className="mt-0.5 text-[10px] text-[#BEBEBE]">{sub}</p>}
        </div>
      </div>
    </motion.div>
  );
}

// ─── dropdown ─────────────────────────────────────────────────────────────────
// `anchor` controls which edge of the menu aligns with the trigger:
//   - 'right' (default): menu's right edge sticks to trigger's right edge,
//     menu extends LEFT. Use for triggers near the right of their container.
//   - 'left': menu's left edge sticks to trigger's left edge, menu extends
//     RIGHT. Use for triggers near the left of their container — otherwise
//     the menu gets clipped off the left side of the viewport.
// `direction` controls which side of the trigger the menu opens:
//   - 'down' (default): menu sits below the trigger.
//   - 'up': menu sits above the trigger. Use when the trigger is near the
//     bottom of the page — otherwise the menu spills past the viewport.

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
            className={`absolute ${horizontal} ${vertical} z-50 overflow-hidden rounded-2xl border border-white/12 bg-[#14181D]/95 shadow-2xl backdrop-blur-xl`}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
