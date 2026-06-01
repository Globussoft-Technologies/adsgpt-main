import React from 'react';
import { motion } from 'framer-motion';
import { useDispatch, useSelector } from 'react-redux';
import { X, History, CheckCircle2, AlertCircle, Inbox, CalendarClock } from 'lucide-react';
import {
  closeAutomationHistory,
  openAutomationStopConfirm,
  selectAutomationEntry,
  selectHistoryOpenFor,
} from '@/store/reducers/adFactoryAutomation/adFactoryAutomationSlice';
import { describeFrequency } from '@/store/reducers/adFactoryAutomation/nextRun';

// ----------------------------------------------------------------------------
// AutomationHistoryPanel — slides in from the right with the run log for the
// current campaign's automation. Reads entry.history[] which is appended by
// the (still-mocked) cycle ticker.
//
// Each row: timestamp · generated count · posted count · status pill.
// Empty state when the automation has no runs yet.
// Footer destructive action delegates to the Stop confirm modal.
// ----------------------------------------------------------------------------

export default function AutomationHistoryPanel() {
  const dispatch = useDispatch();
  const campaignId = useSelector(selectHistoryOpenFor);
  const entry = useSelector((state) => selectAutomationEntry(state, campaignId));

  if (!campaignId) return null;

  const history = Array.isArray(entry?.history) ? entry.history : [];
  const totalGenerated = entry?.stats?.generated || 0;
  const totalPosted = entry?.stats?.posted || 0;

  const close = () => dispatch(closeAutomationHistory());

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      onClick={close}
      className="fixed inset-0 z-1001 flex justify-end bg-[#0D0D0D]/60 backdrop-blur-md"
    >
      <motion.aside
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', stiffness: 320, damping: 34 }}
        onClick={(e) => e.stopPropagation()}
        className="relative flex h-full w-full max-w-md flex-col border-l border-white/10 bg-[#141414] text-white shadow-2xl"
      >
        <div className="pointer-events-none absolute -top-32 -right-24 size-72 rounded-full bg-[#15DCFF]/10 blur-3xl" />

        {/* Header */}
        <header className="relative flex items-start justify-between border-b border-white/5 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-lg bg-linear-to-br from-[#15DCFF]/25 to-[#6b72f8]/25 ring-1 ring-white/10">
              <History className="size-4 text-white" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">Automation history</h2>
              <p className="text-xs text-[#AFAFAF]">
                {describeFrequency(entry?.config?.frequency) || '—'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={close}
            className="rounded-full p-1 text-[#AFAFAF] transition hover:bg-white/5 hover:text-white"
            aria-label="Close history"
          >
            <X className="size-5" />
          </button>
        </header>

        {/* Totals strip */}
        <div className="relative grid grid-cols-3 gap-2 border-b border-white/5 px-5 py-3">
          <Stat label="Runs" value={history.length} />
          <Stat label="Generated" value={totalGenerated.toLocaleString()} />
          <Stat label="Posted" value={totalPosted.toLocaleString()} />
        </div>

        {/* Run log */}
        <div className="relative flex-1 overflow-y-auto px-5 py-4">
          {history.length === 0 ? (
            <EmptyState />
          ) : (
            <ol className="space-y-2">
              {history.map((run, i) => (
                <li
                  key={`${run.runAt}-${i}`}
                  className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2.5"
                >
                  <div className="flex items-center gap-3">
                    <StatusBadge status={run.status} />
                    <div className="flex flex-col">
                      <span className="text-sm text-white">{formatRunDate(run.runAt)}</span>
                      <span className="text-[11px] text-[#AFAFAF]">
                        {run.generated || 0} generated · {run.posted || 0} posted
                      </span>
                    </div>
                  </div>
                  <span className="text-[11px] text-[#AFAFAF]">{relativeFromNow(run.runAt)}</span>
                </li>
              ))}
            </ol>
          )}
        </div>

        {/* Footer */}
        <footer className="relative flex items-center justify-between border-t border-white/5 bg-[#0D0D0D]/40 px-5 py-3">
          <span className="text-[11px] text-[#AFAFAF]">
            Past runs are kept locally on this device.
          </span>
          <button
            type="button"
            onClick={() => {
              dispatch(closeAutomationHistory());
              dispatch(openAutomationStopConfirm(campaignId));
            }}
            className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-1.5 text-xs font-medium text-red-300 transition hover:border-red-500/40 hover:bg-red-500/15 hover:text-red-200"
          >
            Stop automation
          </button>
        </footer>
      </motion.aside>
    </motion.div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-white/5 bg-[#0D0D0D]/40 px-3 py-2">
      <span className="text-10 tracking-wide text-[#AFAFAF] uppercase">{label}</span>
      <span className="text-sm font-semibold text-white">{value}</span>
    </div>
  );
}

function StatusBadge({ status }) {
  const ok = status === 'success';
  return (
    <span
      className={`flex size-7 items-center justify-center rounded-full ring-1 ${
        ok
          ? 'bg-emerald-500/10 text-emerald-400 ring-emerald-500/30'
          : 'bg-red-500/10 text-red-400 ring-red-500/30'
      }`}
    >
      {ok ? <CheckCircle2 className="size-4" /> : <AlertCircle className="size-4" />}
    </span>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-white/5 ring-1 ring-white/10">
        <Inbox className="size-5 text-[#AFAFAF]" />
      </div>
      <p className="text-sm text-white">No runs yet</p>
      <p className="max-w-[220px] text-xs text-[#AFAFAF]">
        Past cycles will appear here as the schedule fires.
      </p>
      <div className="mt-1 flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[11px] text-[#AFAFAF]">
        <CalendarClock className="size-3" />
        Watching for the next cycle…
      </div>
    </div>
  );
}

function formatRunDate(iso) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function relativeFromNow(iso) {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  } catch {
    return '';
  }
}
