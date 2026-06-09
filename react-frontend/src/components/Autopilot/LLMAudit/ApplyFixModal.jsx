import React, { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Loader2, AlertTriangle, Sparkles } from 'lucide-react';
import {
  ACTION_META,
  RISK_CONFIG,
  OPTIMIZATION_GOALS,
  toMajor,
  toMinor,
  fmtCurrency,
} from './constants';

// ─── per-action param editors ────────────────────────────────────────────────

const LabeledRow = ({ label, children, sub }) => (
  <div className="flex flex-col gap-1.5">
    <label className="text-[11px] font-semibold tracking-wider uppercase text-gray-500 dark:text-white/50">
      {label}
    </label>
    {children}
    {sub && <p className="text-[11px] text-gray-400 dark:text-white/40">{sub}</p>}
  </div>
);

const ReadOnlyField = ({ value }) => (
  <div className="rounded-xl border border-gray-200 bg-gray-100 px-3 py-2 font-mono text-xs text-gray-500 dark:border-white/12 dark:bg-white/[0.04] dark:text-white/70">
    {value}
  </div>
);

const NumberInput = ({ value, onChange, suffix }) => (
  <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-100 px-3 py-2 focus-within:border-[#15DCFF]/40 dark:border-white/12 dark:bg-white/[0.04]">
    <input
      type="number"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full bg-transparent text-sm font-semibold text-gray-900 outline-none dark:text-white"
    />
    {suffix && <span className="shrink-0 text-xs text-gray-400 dark:text-white/40">{suffix}</span>}
  </div>
);

const DateTimeInput = ({ value, onChange }) => (
  <input
    type="datetime-local"
    value={value}
    onChange={(e) => onChange(e.target.value)}
    className="w-full rounded-xl border border-gray-200 bg-gray-100 px-3 py-2 text-sm text-gray-900 outline-none focus:border-[#15DCFF]/40 dark:border-white/12 dark:bg-white/[0.04] dark:text-white"
  />
);

const SelectInput = ({ value, onChange, options }) => (
  <select
    value={value}
    onChange={(e) => onChange(e.target.value)}
    className="w-full rounded-xl border border-gray-200 bg-gray-100 px-3 py-2 text-sm text-gray-900 outline-none focus:border-[#15DCFF]/40 dark:border-white/12 dark:bg-white/[0.04] dark:text-white"
  >
    {options.map((o) => (
      <option key={o} value={o} className="bg-white dark:bg-[#1a1f28]">
        {o.replace(/_/g, ' ')}
      </option>
    ))}
  </select>
);

const JsonPreview = ({ obj, note }) => (
  <div className="flex flex-col gap-1.5">
    <pre className="scrollbar-thin max-h-48 overflow-auto rounded-xl border border-gray-200 bg-gray-100 p-3 text-[11px] leading-relaxed text-gray-500 dark:border-white/12 dark:bg-black/30 dark:text-[#BEBEBE]">
      {JSON.stringify(obj ?? {}, null, 2)}
    </pre>
    {note && <p className="text-[11px] text-gray-400 dark:text-white/40">{note}</p>}
  </div>
);

// toISO from an HTML datetime-local string (no TZ); treat as local time
const localInputToISO = (v) => {
  if (!v) return '';
  const d = new Date(v);
  return isNaN(d.getTime()) ? v : d.toISOString();
};
const isoToLocalInput = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  // YYYY-MM-DDTHH:mm
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

function ParamsEditor({ actionType, params, finding, currency, onChange }) {
  // Fallbacks — if params omit entity refs, use the finding's top-level fields
  const targetLevel = params.level || finding?.entity_type;
  const targetId = params.id || finding?.entity_id;
  const adsetId = params.adset_id || (finding?.entity_type === 'adset' ? finding?.entity_id : undefined);
  const adId = params.ad_id || (finding?.entity_type === 'ad' ? finding?.entity_id : undefined);
  const sourceLevel = params.source_level || finding?.entity_type;
  const sourceId = params.source_id || finding?.entity_id;
  const entityName = finding?.entity_name;
  const targetDisplay = (lvl, id) =>
    `${(lvl || '—').toUpperCase()} · ${id || '—'}${entityName ? `  (${entityName})` : ''}`;

  switch (actionType) {
    case 'PAUSE_ENTITY':
    case 'ACTIVATE_ENTITY':
      return (
        <div className="flex flex-col gap-3">
          <LabeledRow label="Target">
            <ReadOnlyField value={targetDisplay(targetLevel, targetId)} />
          </LabeledRow>
        </div>
      );

    case 'ADJUST_BUDGET': {
      const isDaily = params.new_daily_budget != null;
      const field = isDaily ? 'new_daily_budget' : 'new_lifetime_budget';
      const majorVal = toMajor(params[field]);
      return (
        <div className="flex flex-col gap-3">
          <LabeledRow label="Target">
            <ReadOnlyField value={targetDisplay(targetLevel, targetId)} />
          </LabeledRow>
          <LabeledRow
            label={isDaily ? 'New daily budget' : 'New lifetime budget'}
            sub={`Currency: ${currency}. The server will clamp this to between 0.3× and 3× the current value.`}
          >
            <NumberInput
              value={majorVal}
              onChange={(v) => onChange({ ...params, [field]: toMinor(v) })}
              suffix={currency}
            />
          </LabeledRow>
        </div>
      );
    }

    case 'ADJUST_BID': {
      const majorVal = toMajor(params.new_bid_amount);
      return (
        <div className="flex flex-col gap-3">
          <LabeledRow label="Ad Set">
            <ReadOnlyField value={targetDisplay('adset', adsetId)} />
          </LabeledRow>
          <LabeledRow label="New bid amount" sub={`Currency: ${currency}.`}>
            <NumberInput
              value={majorVal}
              onChange={(v) => onChange({ ...params, new_bid_amount: toMinor(v) })}
              suffix={currency}
            />
          </LabeledRow>
        </div>
      );
    }

    case 'NARROW_AUDIENCE':
    case 'BROADEN_AUDIENCE':
      return (
        <div className="flex flex-col gap-3">
          <LabeledRow label="Ad Set">
            <ReadOnlyField value={targetDisplay('adset', adsetId)} />
          </LabeledRow>
          <LabeledRow
            label="Targeting fragment to merge"
            sub="This fragment will be merged onto the ad set's current targeting spec."
          >
            <JsonPreview obj={params.targeting_patch} />
          </LabeledRow>
        </div>
      );

    case 'EXTEND_SCHEDULE':
    case 'END_EARLY':
      return (
        <div className="flex flex-col gap-3">
          <LabeledRow label="Target">
            <ReadOnlyField value={targetDisplay(targetLevel, targetId)} />
          </LabeledRow>
          <LabeledRow label="New end time">
            <DateTimeInput
              value={isoToLocalInput(params.new_stop_time)}
              onChange={(v) => onChange({ ...params, new_stop_time: localInputToISO(v) })}
            />
          </LabeledRow>
        </div>
      );

    case 'CHANGE_OPTIMIZATION_GOAL':
      return (
        <div className="flex flex-col gap-3">
          <LabeledRow label="Ad Set">
            <ReadOnlyField value={targetDisplay('adset', adsetId)} />
          </LabeledRow>
          <LabeledRow
            label="New optimization goal"
            sub="Changing the goal will reset the ad set's learning phase."
          >
            <SelectInput
              value={params.new_goal || OPTIMIZATION_GOALS[0]}
              onChange={(v) => onChange({ ...params, new_goal: v })}
              options={OPTIMIZATION_GOALS}
            />
          </LabeledRow>
        </div>
      );

    case 'DUPLICATE_AND_MODIFY':
      return (
        <div className="flex flex-col gap-3">
          <LabeledRow label="Source">
            <ReadOnlyField value={targetDisplay(sourceLevel, sourceId)} />
          </LabeledRow>
          <LabeledRow
            label="Overrides applied to the copy"
            sub="A new entity will be created with these field overrides."
          >
            <JsonPreview obj={params.overrides} />
          </LabeledRow>
        </div>
      );

    case 'SWAP_CREATIVE':
      return (
        <div className="flex flex-col gap-3">
          <LabeledRow label="Ad">
            <ReadOnlyField value={targetDisplay('ad', adId)} />
          </LabeledRow>
          <LabeledRow label="New creative ID" sub="Must exist in the same ad account.">
            <ReadOnlyField value={params.new_creative_id || '—'} />
          </LabeledRow>
        </div>
      );

    default:
      return <JsonPreview obj={params} />;
  }
}

// ─── modal ────────────────────────────────────────────────────────────────────

export default function ApplyFixModal({
  finding,
  currency = 'INR',
  onClose,
  onConfirm,
}) {
  const actionType = finding?.fix?.action_type;
  const meta = ACTION_META[actionType] ?? {};
  const risk = finding?.fix?.risk_level || 'low';
  const riskCfg = RISK_CONFIG[risk];
  const reversible = finding?.fix?.reversible !== false;
  const MetaIcon = meta.icon || Sparkles;

  const [params, setParams] = useState(finding?.fix?.params || {});
  const [ackRisk, setAckRisk] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const needsAck = risk === 'high';
  const canConfirm = useMemo(
    () => !submitting && (!needsAck || ackRisk),
    [submitting, needsAck, ackRisk],
  );

  // Build paramOverrides — only send keys that differ from the original LLM params
  const paramOverrides = useMemo(() => {
    const orig = finding?.fix?.params || {};
    const diff = {};
    Object.keys(params).forEach((k) => {
      if (JSON.stringify(params[k]) !== JSON.stringify(orig[k])) {
        diff[k] = params[k];
      }
    });
    return diff;
  }, [params, finding]);

  const handleConfirm = async () => {
    setSubmitting(true);
    try {
      await onConfirm({
        acknowledgeRisk: needsAck ? ackRisk : false,
        paramOverrides,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <AnimatePresence>
      {finding && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            transition={{ duration: 0.18 }}
            onClick={(e) => e.stopPropagation()}
            className="scrollbar-thin max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-white/12 dark:bg-[#14181D]"
          >
            {/* header */}
            <div className="flex items-start justify-between gap-3 border-b border-gray-200 p-5 dark:border-white/12">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-gradient-to-br from-[#15DCFF]/15 to-[#6b72f8]/15 dark:border-white/10">
                  <MetaIcon className="h-5 w-5 text-[#15DCFF]" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-gray-900 dark:text-white">{meta.verb || actionType}</h3>
                  <p className="mt-0.5 text-xs text-gray-500 dark:text-white/50">{meta.description}</p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-gray-400 transition-all hover:bg-gray-100 hover:text-gray-900 dark:text-white/40 dark:hover:bg-white/5 dark:hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* meta row */}
            <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 px-5 py-3 dark:border-white/12">
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${riskCfg?.color}`}
              >
                · {riskCfg?.label}
              </span>
              <span className="h-3 w-px bg-gray-200 dark:bg-white/10" />
              <span className="text-[10px] font-semibold text-gray-400 dark:text-white/40">
                {reversible ? 'Reversible for 1 hour' : 'Not reversible'}
              </span>
              <span className="h-3 w-px bg-gray-200 dark:bg-white/10" />
              <span className="text-[10px] font-semibold text-gray-400 dark:text-white/40">
                {finding.entity_type} · {finding.entity_name}
              </span>
            </div>

            {/* body */}
            <div className="p-5">
              <div className="mb-5 rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-white/12 dark:bg-white/[0.04]">
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40">
                  Why
                </p>
                <p className="text-xs leading-relaxed text-gray-600 dark:text-white/70">{finding.reasoning}</p>
              </div>

              <ParamsEditor
                actionType={actionType}
                params={params}
                finding={finding}
                currency={currency}
                onChange={setParams}
              />

              {needsAck && (
                <label className="mt-5 flex cursor-pointer items-start gap-2 rounded-xl border border-red-400/20 bg-red-400/5 p-3">
                  <input
                    type="checkbox"
                    checked={ackRisk}
                    onChange={(e) => setAckRisk(e.target.checked)}
                    className="mt-0.5 h-3.5 w-3.5 accent-red-400"
                  />
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-red-600 dark:text-red-400" />
                    <p className="text-[11px] leading-relaxed text-gray-600 dark:text-white/70">
                      I understand this is a <span className="font-semibold text-red-600 dark:text-red-400">high-risk</span> change
                      that may reset the learning phase or materially change delivery.
                    </p>
                  </div>
                </label>
              )}
            </div>

            {/* footer */}
            <div className="flex items-center justify-end gap-2 border-t border-gray-200 bg-gray-50 p-4 dark:border-white/12 dark:bg-black/20">
              <button
                onClick={onClose}
                disabled={submitting}
                className="rounded-xl border border-gray-200 bg-gray-100 px-4 py-2 text-xs font-medium text-gray-900 transition-all hover:bg-gray-50 disabled:opacity-50 dark:border-white/12 dark:bg-white/[0.05] dark:text-white dark:hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                disabled={!canConfirm}
                className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-[#15DCFF] to-[#6b72f8] px-4 py-2 text-xs font-bold text-black transition-all hover:brightness-110 disabled:opacity-50"
              >
                {submitting && <Loader2 className="h-3 w-3 animate-spin" />}
                Apply fix
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
