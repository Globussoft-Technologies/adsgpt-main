import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2 } from 'lucide-react';
// eslint-disable-next-line no-unused-vars
import { motion, AnimatePresence } from 'framer-motion';
import { getRuleTemplates } from '@/apis/autopilot/autopilotApi';
import { Banner } from '../_atoms';
import { SEVERITIES } from './ruleFieldsCatalog';

/**
 * Curated rule-template gallery. Click a template → calls `onPick(template)`
 * with the template's pre-filled rule body, which the parent feeds into
 * `<RuleFormModal>` as a `prefill` prop.
 *
 * Static catalog from /rule-templates — no per-user data, safe to fetch
 * once on open and cache for the modal's lifetime.
 *
 * Modal infra mirrors `RuleFormModal` and the campaign wizard:
 *   - rendered through `createPortal(..., document.body)` so the modal
 *     escapes the Autopilot Settings tab's sticky-header stacking context
 *     (otherwise the upper portion of the modal — including the X — sat
 *     under the page chrome and ignored clicks)
 *   - no backdrop click-to-close + no `stopPropagation` on the panel:
 *     that pair raced with input mousedown on `RuleFormModal` and
 *     swallowed clicks on the X button. Close = X / Escape only.
 */
const TemplatesModal = ({ open, onClose, onPick }) => {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!open) return undefined;
    let alive = true;
    setLoading(true);
    setErr(null);
    getRuleTemplates()
      .then((r) => alive && setTemplates(r?.templates || []))
      .catch((e) =>
        alive &&
        setErr(e?.response?.data?.error || e.message || 'Load failed'),
      )
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [open]);

  // Escape closes (no backdrop dismissal, so keyboard is the only
  // non-button exit).
  useEffect(() => {
    if (!open) return undefined;
    const handler = (e) => {
      if (e.key === 'Escape') onClose && onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // Group templates by category for the grid sections.
  const grouped = templates.reduce((acc, t) => {
    const cat = t.category || 'Other';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(t);
    return acc;
  }, {});

  if (!open) return null;
  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-100 flex items-center justify-center bg-black/65 p-3 backdrop-blur-sm sm:p-4"
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.97, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.97, y: 12 }}
          transition={{ duration: 0.18 }}
          className="relative flex max-h-[92vh] w-full max-w-4xl min-w-92.5 flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-white/12 dark:bg-[#131820]"
        >
          {/* header */}
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-gray-200 bg-gray-50 px-4 py-3 sm:px-5 sm:py-3.5 dark:border-white/12 dark:bg-white/[0.03]">
            <div>
              <h2 className="text-sm font-bold text-gray-900 2xl:text-base dark:text-white">
                Rule templates
              </h2>
              <p className="mt-0.5 text-[11px] text-gray-500 2xl:text-xs dark:text-white/55">
                Pick a starting point. Every field is editable before you
                save.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex h-7 w-7 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-white/55 dark:hover:bg-white/[0.08] dark:hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* body */}
          <div className="scrollbar-thin flex flex-1 min-h-0 flex-col gap-5 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
            {loading && (
              <div className="flex items-center gap-2 text-[12px] text-gray-500 dark:text-white/55">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
              </div>
            )}
            {err && <Banner variant="error">{err}</Banner>}
            {!loading && !err && templates.length === 0 && (
              <p className="text-[12px] text-gray-500 dark:text-white/55">
                No templates available.
              </p>
            )}
            {!loading &&
              !err &&
              Object.entries(grouped).map(([category, list]) => (
                <div key={category}>
                  <h3 className="mb-2 text-10 font-bold uppercase tracking-wider text-gray-400 dark:text-white/40">
                    {category}
                  </h3>
                  <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
                    {list.map((t) => (
                      <TemplateCard
                        key={t.id}
                        template={t}
                        onPick={() => {
                          onPick && onPick(t.template);
                          onClose && onClose();
                        }}
                      />
                    ))}
                  </div>
                </div>
              ))}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
};

const TemplateCard = ({ template, onPick }) => {
  const sev = SEVERITIES.find((s) => s.value === template.template?.severity);
  return (
    <button
      type="button"
      onClick={onPick}
      className="group flex flex-col gap-2 rounded-2xl border border-gray-200 bg-gray-50 p-3 text-left transition-all hover:border-[#15DCFF]/40 hover:bg-gray-100 dark:border-white/12 dark:bg-white/[0.04] dark:hover:bg-white/[0.07]"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1">
          <div className="text-13 font-bold text-gray-900 dark:text-white">
            {template.headline}
          </div>
          {template.blurb && (
            <p className="mt-1 text-[11px] 2xl:text-xs leading-relaxed text-gray-500 dark:text-white/55">
              {template.blurb}
            </p>
          )}
        </div>
        {sev && (
          <span
            className={`shrink-0 rounded-full border px-2 py-0.5 text-10 font-medium ${sev.tone}`}
          >
            {sev.label}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 border-t border-gray-200 pt-2 text-10 text-gray-500 dark:border-white/12 dark:text-white/55">
        <span className="rounded-md border border-gray-200 bg-gray-100 px-1.5 py-0.5 font-medium tracking-wider text-gray-600 uppercase dark:border-white/10 dark:bg-white/[0.05] dark:text-white/70">
          {template.template?.evaluateOn}
        </span>
        <span className="text-gray-400 dark:text-white/25">·</span>
        <span className="rounded-md border border-gray-200 bg-gray-100 px-1.5 py-0.5 font-medium tracking-wider text-gray-600 uppercase dark:border-white/10 dark:bg-white/[0.05] dark:text-white/70">
          {template.template?.action?.type === 'pause' ? 'Pause' : 'Alert'}
        </span>
        <span className="ml-auto text-[#15DCFF] opacity-0 transition-opacity group-hover:opacity-100">
          Use this →
        </span>
      </div>
    </button>
  );
};

export default TemplatesModal;
