import React from 'react';
import { motion } from 'framer-motion';
import {
  CheckCircle2,
  XCircle,
  Undo2,
  Loader2,
  Sparkles,
  Clock,
  X as XIcon,
} from 'lucide-react';
import {
  SEVERITY_CONFIG,
  STATUS_CONFIG,
  ENTITY_LABELS,
  ACTION_META,
} from './constants';

export default function FindingCard({
  finding,
  onOpenFix,
  onDismiss,
  onUndo,
  busy,
}) {
  const sevCfg = SEVERITY_CONFIG[finding.severity] ?? SEVERITY_CONFIG.opportunity;
  const statusCfg = STATUS_CONFIG[finding.status] ?? STATUS_CONFIG.pending;
  const SevIcon = sevCfg.icon;
  const actionMeta = ACTION_META[finding.fix?.action_type] ?? {};
  const ActionIcon = actionMeta.icon || Sparkles;

  const appliedAt = finding.appliedAt ? new Date(finding.appliedAt).getTime() : null;
  const isReversible = finding.fix?.reversible !== false;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="relative flex flex-col gap-3 overflow-hidden rounded-2xl border border-gray-200 bg-white p-4 pl-5 transition-all hover:border-gray-300 dark:border-white/12 dark:bg-white/[0.04] dark:hover:border-white/15"
    >
      {/* left accent bar */}
      <div
        className="absolute top-0 left-0 bottom-0 w-0.5 rounded-l-2xl"
        style={{
          background: `linear-gradient(to bottom, transparent 0%, ${sevCfg.barColor} 40%, ${sevCfg.barColor} 60%, transparent 100%)`,
        }}
      />

      {/* header: severity + status */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <SevIcon className={`h-3.5 w-3.5 shrink-0 ${sevCfg.color}`} />
          <span className={`text-[11px] font-semibold uppercase tracking-wider ${sevCfg.color}`}>
            {sevCfg.label}
          </span>
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusCfg.bg} ${statusCfg.color}`}
        >
          {statusCfg.label}
        </span>
      </div>

      {/* title */}
      <p className="text-sm font-bold leading-tight text-gray-900 dark:text-white">{finding.title}</p>

      {/* reasoning */}
      <p className="text-xs leading-relaxed text-gray-600 dark:text-white/60">{finding.reasoning}</p>

      {/* fix action chip */}
      <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 dark:border-white/12 dark:bg-white/[0.05]">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#15DCFF]/15 to-[#6b72f8]/15">
          <ActionIcon className="h-3.5 w-3.5 text-[#15DCFF]" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold text-gray-900 dark:text-white">
            {actionMeta.label || finding.fix?.action_type}
          </p>
          <p className="text-[10px] text-gray-400 dark:text-white/40 truncate">{actionMeta.description}</p>
        </div>
      </div>

      {/* entity footer */}
      <div className="flex items-center gap-1.5 border-t border-gray-200 pt-3 dark:border-white/12">
        <span className="rounded border border-gray-200 bg-gray-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-gray-500 dark:border-white/12 dark:bg-white/[0.06] dark:text-white/50">
          {ENTITY_LABELS[finding.entity_type] ?? finding.entity_type}
        </span>
        <span className="truncate text-[11px] text-gray-500 dark:text-white/50">{finding.entity_name}</span>
      </div>

      {/* action buttons based on status */}
      <div className="flex items-center gap-2">
        {finding.status === 'pending' && (
          <>
            <button
              onClick={() => onOpenFix(finding)}
              disabled={busy}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-[#15DCFF] to-[#6b72f8] px-3 py-2 text-xs font-bold text-black transition-all hover:brightness-110 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
              Apply fix
            </button>
            <button
              onClick={() => onDismiss(finding)}
              disabled={busy}
              className="flex items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-gray-100 px-3 py-2 text-xs font-medium text-gray-500 transition-all hover:bg-gray-50 disabled:opacity-50 dark:border-white/12 dark:bg-white/[0.05] dark:text-white/70 dark:hover:bg-white/10"
            >
              <XIcon className="h-3 w-3" />
              Dismiss
            </button>
          </>
        )}

        {finding.status === 'applied' && (
          <>
            <div className="flex flex-1 items-center gap-1.5 rounded-xl border border-emerald-400/20 bg-emerald-400/5 px-3 py-2 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-3 w-3" />
              Applied
              {appliedAt && (
                <span className="text-[10px] font-medium text-emerald-600/70 dark:text-emerald-400/70">
                  · {new Date(appliedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
            </div>
            {isReversible && (
              <button
                onClick={() => onUndo(finding)}
                disabled={busy}
                className="flex items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-gray-100 px-3 py-2 text-xs font-medium text-gray-500 transition-all hover:bg-gray-50 disabled:opacity-50 dark:border-white/12 dark:bg-white/[0.05] dark:text-white/70 dark:hover:bg-white/10"
              >
                {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Undo2 className="h-3 w-3" />}
                Undo
              </button>
            )}
          </>
        )}

        {finding.status === 'dismissed' && (
          <div className="flex flex-1 items-center gap-1.5 rounded-xl border border-gray-200 bg-gray-100 px-3 py-2 text-xs font-medium text-gray-400 dark:border-white/12 dark:bg-white/[0.05] dark:text-white/40">
            <XCircle className="h-3 w-3" />
            Dismissed
          </div>
        )}

        {finding.status === 'stale' && (
          <div className="flex flex-1 items-center gap-1.5 rounded-xl border border-amber-400/20 bg-amber-400/5 px-3 py-2 text-xs font-medium text-amber-600 dark:text-amber-400">
            <Clock className="h-3 w-3" />
            Expired — re-run audit
          </div>
        )}

        {finding.status === 'failed' && (
          <div className="flex flex-1 flex-col gap-0.5 rounded-xl border border-red-400/20 bg-red-400/5 px-3 py-2 text-xs font-medium text-red-600 dark:text-red-400">
            <div className="flex items-center gap-1.5">
              <XCircle className="h-3 w-3" />
              Failed to apply
            </div>
            {finding.lastError && (
              <span className="line-clamp-2 text-[10px] text-red-600/70 dark:text-red-400/70">{finding.lastError}</span>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}
