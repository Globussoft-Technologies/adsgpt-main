import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, CheckCircle2, XCircle, Undo2, Loader2, History } from 'lucide-react';
import { getFixLog } from '@/apis/autopilot/llmAuditApi';
import { ACTION_META, ENTITY_LABELS } from './constants';

const STATUS_STYLE = {
  success:  { icon: CheckCircle2, color: 'text-emerald-400', label: 'Applied' },
  failed:   { icon: XCircle,      color: 'text-red-400',     label: 'Failed' },
  reverted: { icon: Undo2,        color: 'text-amber-400',   label: 'Reverted' },
};

export default function FixLogDrawer({ open, onClose, auditId }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await getFixLog({ auditId, limit: 100 });
        if (!cancelled) setLogs(res.logs || []);
      } catch {
        /* noop */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, auditId]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm"
          />
          <motion.aside
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', bounce: 0.15, duration: 0.35 }}
            className="fixed top-0 right-0 z-[210] flex h-screen w-full max-w-md flex-col border-l border-white/12 bg-[#14181D] shadow-2xl"
          >
            <div className="flex items-center justify-between gap-3 border-b border-white/12 p-5">
              <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/5">
                  <History className="h-4 w-4 text-white/60" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Activity</h3>
                  <p className="text-[10px] text-white/40">
                    {auditId ? 'Changes from this audit' : 'All recent changes'}
                  </p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-white/40 transition-all hover:bg-white/5 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="scrollbar-thin flex-1 overflow-y-auto p-4">
              {loading ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 className="h-5 w-5 animate-spin text-white/40" />
                </div>
              ) : logs.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
                  <History className="h-6 w-6 text-white/20" />
                  <p className="text-xs text-white/40">No changes yet</p>
                </div>
              ) : (
                <ol className="flex flex-col gap-2">
                  {logs.map((log) => {
                    const style = STATUS_STYLE[log.status] ?? STATUS_STYLE.success;
                    const StatusIcon = style.icon;
                    const actionMeta = ACTION_META[log.action_type.replace('UNDO_', '')] ?? {};
                    const isUndo = log.action_type.startsWith('UNDO_');
                    return (
                      <li
                        key={log._id}
                        className="flex flex-col gap-2 rounded-xl border border-white/12 bg-white/[0.04] p-3"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5">
                            <StatusIcon className={`h-3 w-3 shrink-0 ${style.color}`} />
                            <span className={`text-[10px] font-semibold uppercase tracking-wider ${style.color}`}>
                              {style.label}
                            </span>
                          </div>
                          <span className="text-[10px] text-white/40">
                            {new Date(log.createdAt).toLocaleString([], {
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        </div>
                        <p className="text-xs font-semibold text-white">
                          {isUndo ? 'Reverted ' : ''}
                          {actionMeta.label || log.action_type}
                          <span className="ml-1 text-[10px] font-medium text-white/40">
                            on {ENTITY_LABELS[log.entity_type]} {log.entity_id}
                          </span>
                        </p>
                        {log.error && (
                          <p className="rounded-lg bg-red-400/5 p-2 text-[10px] leading-relaxed text-red-400/80">
                            {log.error}
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}
