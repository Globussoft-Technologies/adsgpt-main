import React, { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  ArrowLeft,
  Sparkles,
  ShieldAlert,
  AlertTriangle,
  Lightbulb,
} from 'lucide-react';
import FindingCard from './FindingCard';

// ─── small helpers ───────────────────────────────────────────────────────────

function SummaryPill({ icon: Icon, color, barColor, label, value }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="relative overflow-hidden rounded-2xl border border-white/12 bg-[#14181D] p-4"
    >
      <div className="absolute top-0 left-0 h-full w-0.5" style={{ background: barColor }} />
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className={`h-3.5 w-3.5 ${color}`} />
          <span className={`text-[11px] font-semibold uppercase tracking-wider ${color}`}>
            {label}
          </span>
        </div>
        <span className="text-xl font-bold text-white 2xl:text-2xl">{value}</span>
      </div>
    </motion.div>
  );
}

// Disabled state matters — zero-count chips render as a dead-end if
// users can still click them ("No findings match the current filter"
// after clicking `Applied (0)`). When `disabled`, the pill is dimmed,
// gets a `not-allowed` cursor, and its onClick is gated.
function FilterPill({ label, active, onClick, disabled = false }) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={`rounded-full border px-3 py-1 text-[11px] font-semibold capitalize transition-all ${
        active
          ? 'border-[#15DCFF]/40 bg-[#15DCFF]/10 text-[#15DCFF]'
          : disabled
            ? 'cursor-not-allowed border-white/4 bg-transparent text-white/25'
            : 'border-white/12 bg-transparent text-[#BEBEBE] hover:text-white/80'
      }`}
    >
      {label}
    </button>
  );
}

// ─── findings view ───────────────────────────────────────────────────────────

export default function AuditFindings({
  audit,
  busyFindingId,
  onBack,
  onOpenFix,
  onDismiss,
  onUndo,
}) {
  const [severityFilter, setSeverityFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('pending');

  // Memoize the `audit?.findings || []` fallback so it has a stable
  // reference when audit.findings is undefined; otherwise the inline
  // `|| []` produces a fresh empty array each render, invalidating the
  // dependent counts/filtered memos every time the parent re-renders.
  const findings = useMemo(() => audit?.findings || [], [audit?.findings]);

  const counts = useMemo(() => {
    return {
      all: findings.length,
      critical: findings.filter((f) => f.severity === 'critical').length,
      warning: findings.filter((f) => f.severity === 'warning').length,
      opportunity: findings.filter((f) => f.severity === 'opportunity').length,
      pending: findings.filter((f) => f.status === 'pending').length,
      applied: findings.filter((f) => f.status === 'applied').length,
      dismissed: findings.filter((f) => f.status === 'dismissed').length,
      stale: findings.filter((f) => f.status === 'stale').length,
      failed: findings.filter((f) => f.status === 'failed').length,
    };
  }, [findings]);

  const filtered = useMemo(
    () =>
      findings.filter((f) => {
        if (severityFilter !== 'all' && f.severity !== severityFilter) return false;
        if (statusFilter !== 'all' && f.status !== statusFilter) return false;
        return true;
      }),
    [findings, severityFilter, statusFilter],
  );

  return (
    <div className="flex flex-col gap-4">
      {/* header row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/12 bg-white/[0.05] text-white/60 transition-all hover:bg-white/10 hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#15DCFF]/20 bg-gradient-to-br from-[#15DCFF]/15 to-[#6b72f8]/15">
            <Sparkles className="h-5 w-5 text-[#15DCFF]" />
          </div>
          <div>
            <p className="text-base font-bold text-white 2xl:text-lg">Audit findings</p>
            <div className="mt-0.5 flex items-center gap-2 text-[11px] text-white/40">
              <span className="font-mono">{audit?.auditId?.slice(0, 8)}</span>
            </div>
          </div>
        </div>
        {/* Activity drawer removed — every apply / revert now writes to
            the unified Autopilot Action Log, so the per-audit drawer was
            duplicating the same data the user already sees in the
            Action log tab. */}
        <div className="flex items-center gap-2">
        </div>
      </div>
     
      {/* filter rows — stacked vertically with one row per dimension so
          the Severity and Status groups don't read as one big set of
          chips. Each row also has its own card so the visual grouping
          is unambiguous. Zero-count chips render disabled to stop users
          clicking into a "No findings match" dead-end. */}
      <div className="flex flex-col gap-2 rounded-2xl border border-white/12 bg-white/[0.04] p-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="w-16 text-[11px] font-bold uppercase tracking-wider text-white/55">
            Severity
          </span>
          {['all', 'critical', 'warning', 'opportunity'].map((f) => {
            const count = counts[f] ?? 0;
            // 'all' always stays clickable; others disable when their
            // bucket is empty (no point clicking a zero filter).
            const disabled = f !== 'all' && count === 0;
            return (
              <FilterPill
                key={f}
                label={f === 'all' ? `All (${counts.all})` : `${f} (${count})`}
                active={severityFilter === f}
                disabled={disabled}
                onClick={() => setSeverityFilter(f)}
              />
            );
          })}
        </div>
        <div className="h-px w-full bg-white/6" />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="w-16 text-[11px] font-bold uppercase tracking-wider text-white/55">
            Status
          </span>
          {['all', 'pending', 'applied', 'dismissed', 'failed'].map((f) => {
            const count = counts[f] ?? 0;
            const disabled = f !== 'all' && count === 0;
            return (
              <FilterPill
                key={f}
                label={f === 'all' ? `All (${counts.all})` : `${f} (${count})`}
                active={statusFilter === f}
                disabled={disabled}
                onClick={() => setStatusFilter(f)}
              />
            );
          })}
        </div>
      </div>

      {/* findings grid */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-white/12 bg-white/[0.04] py-12">
          <Sparkles className="h-5 w-5 text-white/20" />
          <p className="text-sm text-white/40">
            No findings match{' '}
            {severityFilter !== 'all' && (
              <span className="font-semibold capitalize text-white/70">
                {severityFilter}
              </span>
            )}
            {severityFilter !== 'all' && statusFilter !== 'all' && ' · '}
            {statusFilter !== 'all' && (
              <span className="font-semibold capitalize text-white/70">
                {statusFilter}
              </span>
            )}
            {severityFilter === 'all' && statusFilter === 'all' && 'the current filter'}
            .
          </p>
          {(severityFilter !== 'all' || statusFilter !== 'all') && (
            <button
              type="button"
              onClick={() => {
                setSeverityFilter('all');
                setStatusFilter('all');
              }}
              className="rounded-full border border-[#15DCFF]/30 bg-[#15DCFF]/10 px-3 py-1 text-[11px] font-semibold text-[#15DCFF] transition-all hover:bg-[#15DCFF]/15"
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
          {filtered.map((f) => (
            <FindingCard
              key={f._id}
              finding={f}
              busy={busyFindingId === f._id}
              onOpenFix={onOpenFix}
              onDismiss={onDismiss}
              onUndo={onUndo}
            />
          ))}
        </div>
      )}

      {/* rejected (debug, only on fresh audits) */}
      {audit?.rejected?.length > 0 && (
        <details className="mt-2 rounded-xl border border-white/12 bg-white/[0.04] px-3 py-2 text-[11px] text-white/40">
          <summary className="cursor-pointer font-semibold">
            {audit.rejected.length} suggestions were rejected by validation
          </summary>
          <ul className="mt-2 space-y-1">
            {audit.rejected.map((r, i) => (
              <li key={i} className="font-mono">
                · {r.title}: {r.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
