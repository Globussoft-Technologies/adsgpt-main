import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Plus, Trash2, Loader2, ChevronDown, Search, Check } from 'lucide-react';
// eslint-disable-next-line no-unused-vars
import { motion, AnimatePresence } from 'framer-motion';
import { PrimaryButton, SecondaryButton, Banner } from '../_atoms';
import {
  NUMERIC_FIELDS,
  STRING_FIELDS,
  SEVERITIES,
  ACTION_TYPES,
  EVALUATE_ON,
  opsForField,
  fieldMeta,
  isNumericField,
  isStringField,
} from './ruleFieldsCatalog';
import {
  createUserRule,
  updateUserRule,
  testUserRule,
} from '@/apis/autopilot/autopilotApi';
import { getAdAccounts, getCampaigns } from '@/apis/metaAds/metaAdsApi';
import { globalToast } from '@/utils/globalToast';

/**
 * Form modal for creating + editing a user-defined Autopilot rule.
 *
 * Visual language mirrors `CreateCampaignWizard` (Meta Ads Manager-style
 * campaign builder): rounded translucent inputs, brighter `#afafaf` labels,
 * nested `bg-white/4` group panels. Two structural choices borrowed from
 * that wizard, both intentional:
 *
 *   1. No backdrop click-to-close. The previous version dismissed on any
 *      click outside the panel, which raced with input mousedown events
 *      and ended up swallowing focus/click on fields near the panel edges
 *      ("name not editable, X not clickable"). Close is X-button + Cancel
 *      + Escape only.
 *   2. No `stopPropagation` on the panel. Without backdrop dismissal there's
 *      nothing to defend against, and stopPropagation has been a source of
 *      subtle bugs with focus management on nested controls.
 *
 * Mode:
 *   - prop `rule` is null → CREATE
 *   - prop `rule` is a saved rule → EDIT (form pre-fills, save calls PATCH)
 */
const RuleFormModal = ({ open, onClose, rule, prefill, onSaved }) => {
  const isEdit = !!(rule && rule._id);

  // Pure, no React deps. We compute the seed lazily — once on initial
  // mount, then on every false→true `open` transition. Crucially, this
  // function is NOT a useMemo dependency anywhere; that pattern was
  // resetting form state on every keystroke when React decided to give
  // the memo a fresh reference.
  const buildSeed = () => {
    if (rule) {
      return {
        name: rule.name || '',
        description: rule.description || '',
        severity: rule.severity || 'medium',
        evaluateOn: rule.evaluateOn || 'campaign',
        lookbackDays: rule.lookbackDays || 14,
        conditions: rule.conditions || {
          operator: 'AND',
          rules: [{ field: '', op: '', value: '' }],
        },
        action: rule.action || { type: 'pause' },
        attachments: rule.attachments || [],
        enabled: rule.enabled !== false,
      };
    }
    if (prefill) {
      return {
        name: prefill.name || '',
        description: prefill.description || '',
        severity: prefill.severity || 'medium',
        evaluateOn: prefill.evaluateOn || 'campaign',
        lookbackDays: prefill.lookbackDays || 14,
        conditions: prefill.conditions || {
          operator: 'AND',
          rules: [{ field: '', op: '', value: '' }],
        },
        action: prefill.action || { type: 'pause' },
        attachments: prefill.attachments || [],
        enabled: true,
      };
    }
    return {
      name: '',
      description: '',
      severity: 'medium',
      evaluateOn: 'campaign',
      lookbackDays: 14,
      conditions: { operator: 'AND', rules: [{ field: '', op: '', value: '' }] },
      action: { type: 'pause' },
      attachments: [],
      enabled: true,
    };
  };

  // Lazy initializer so the seed is built exactly once on mount.
  const [form, setForm] = useState(buildSeed);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  // Stays false until the user clicks Save once. Suppresses "this field is
  // required" red borders on the empty initial state — the form would
  // light up like a Christmas tree the moment you open it otherwise. Once
  // a save is attempted, errors render and update live until valid.
  const [submitAttempted, setSubmitAttempted] = useState(false);

  // Seed only on the closed→open transition. A ref-based latch beats the
  // [open, initial] dep list because it cannot accidentally re-fire when
  // a parent re-render hands us a new `initial` object reference — that
  // was wiping typed input on every keystroke.
  const prevOpen = useRef(open);
  useEffect(() => {
    if (open && !prevOpen.current) {
      setForm(buildSeed());
      setSaveError(null);
      setTestResult(null);
      setSubmitAttempted(false);
    }
    prevOpen.current = open;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Escape closes — keyboard-only since the backdrop no longer dismisses.
  useEffect(() => {
    if (!open) return undefined;
    const handler = (e) => {
      if (e.key === 'Escape') onClose && onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // ─── form mutators ─────────────────────────────────────────────────────
  const set = (patch) => setForm((prev) => ({ ...prev, ...patch }));
  const setCondition = (idx, patch) =>
    setForm((prev) => {
      const next = [...prev.conditions.rules];
      next[idx] = { ...next[idx], ...patch };
      return {
        ...prev,
        conditions: { ...prev.conditions, rules: next },
      };
    });
  const addCondition = () =>
    setForm((prev) => ({
      ...prev,
      conditions: {
        ...prev.conditions,
        rules: [...prev.conditions.rules, { field: '', op: '', value: '' }],
      },
    }));
  const removeCondition = (idx) =>
    setForm((prev) => ({
      ...prev,
      conditions: {
        ...prev.conditions,
        rules: prev.conditions.rules.filter((_, i) => i !== idx),
      },
    }));
  const setAttachments = (next) => set({ attachments: next });

  // ─── client-side validity ──────────────────────────────────────────────
  // Field-keyed error map. Inputs read `fieldErrors.<key>` to render their
  // red border + inline message. Conditions get a per-row sub-map keyed by
  // index. `ok` rolls up everything for the Save button's disabled state.
  //
  // Numeric condition values reject negatives because every numeric field
  // in the catalog (spend, ctr, clicks, frequency, ...) is non-negative
  // by definition — `spend > -100` is a vacuous rule that always matches.
  const validity = useMemo(() => {
    const fieldErrors = { conditions: {} };
    if (!form.name || !form.name.trim()) {
      fieldErrors.name = 'Name is required.';
    }
    if (!form.description || !form.description.trim()) {
      fieldErrors.description = 'Description is required.';
    }
    if (!form.severity) fieldErrors.severity = 'Severity is required.';
    if (!form.evaluateOn) fieldErrors.evaluateOn = 'Pick an evaluation level.';
    if (!form.action?.type) fieldErrors.action = 'Pick an action.';

    // Lookback window: integer in [1, 90]. Decimal is rejected client-side
    // because the backend Joi schema requires an integer.
    const lbRaw = form.lookbackDays;
    const lbNum = Number(lbRaw);
    if (
      lbRaw === '' ||
      lbRaw === null ||
      lbRaw === undefined ||
      !Number.isFinite(lbNum) ||
      !Number.isInteger(lbNum) ||
      lbNum < 1 ||
      lbNum > 90
    ) {
      fieldErrors.lookbackDays = 'Enter a whole number between 1 and 90.';
    }

    const conds = form.conditions?.rules || [];
    if (conds.length === 0) {
      fieldErrors.conditionsTop = 'Add at least one condition.';
    }
    conds.forEach((c, i) => {
      const rowErr = {};
      if (!c.field) rowErr.field = 'Pick a field.';
      if (!c.op) rowErr.op = 'Pick an operator.';
      if (c.value === '' || c.value === null || c.value === undefined) {
        rowErr.value = 'Enter a value.';
      } else if (isNumericField(c.field)) {
        const n = Number(c.value);
        if (!Number.isFinite(n)) {
          rowErr.value = 'Value must be a number.';
        } else if (n < 0) {
          rowErr.value = 'Value cannot be negative.';
        }
      }
      if (Object.keys(rowErr).length > 0) {
        fieldErrors.conditions[i] = rowErr;
      }
    });

    if (!form.attachments || form.attachments.length === 0) {
      fieldErrors.attachments =
        'Attach the rule to at least one campaign.';
    }

    const flatList = [];
    for (const k of Object.keys(fieldErrors)) {
      if (k === 'conditions') {
        for (const idx of Object.keys(fieldErrors.conditions)) {
          for (const rk of Object.keys(fieldErrors.conditions[idx])) {
            flatList.push(
              `Condition #${Number(idx) + 1}: ${fieldErrors.conditions[idx][rk]}`,
            );
          }
        }
      } else {
        flatList.push(fieldErrors[k]);
      }
    }
    return {
      ok: flatList.length === 0,
      fieldErrors,
      errors: flatList,
    };
  }, [form]);

  // Helper — should this field show its error right now? Errors are
  // suppressed until the first save attempt OR the field has been touched
  // (typed in / changed). After that, they update live as the user types.
  const showError = (key) => {
    if (!submitAttempted) return false;
    if (key.startsWith('conditions.')) {
      const [, idx, sub] = key.split('.');
      return !!validity.fieldErrors.conditions?.[idx]?.[sub];
    }
    return !!validity.fieldErrors[key];
  };
  const errorFor = (key) => {
    if (key.startsWith('conditions.')) {
      const [, idx, sub] = key.split('.');
      return validity.fieldErrors.conditions?.[idx]?.[sub] || '';
    }
    return validity.fieldErrors[key] || '';
  };

  // ─── save ──────────────────────────────────────────────────────────────
  const onSave = async () => {
    // First-attempt latch: even if the form is invalid we mark the attempt
    // so per-field errors light up. Without this the button can sit
    // disabled while the user has no idea why.
    setSubmitAttempted(true);
    if (!validity.ok || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const payload = {
        ...form,
        lookbackDays: Number(form.lookbackDays) || 14,
        conditions: {
          ...form.conditions,
          rules: form.conditions.rules.map((c) => ({
            field: c.field,
            op: c.op,
            value: isNumericField(c.field) ? Number(c.value) : c.value,
          })),
        },
      };
      const res = isEdit
        ? await updateUserRule(rule._id, payload)
        : await createUserRule(payload);
      if (res.status && res.rule) {
        globalToast.success(isEdit ? 'Rule updated.' : 'Rule created.');
        onSaved && onSaved(res.rule);
        onClose && onClose();
      } else {
        setSaveError(res.error || 'Save failed.');
      }
    } catch (e) {
      setSaveError(
        e?.response?.data?.details?.join?.('; ') ||
          e?.response?.data?.error ||
          e.message ||
          'Save failed',
      );
    } finally {
      setSaving(false);
    }
  };

  const onTest = async () => {
    if (!isEdit) {
      setTestResult({
        notSaved: true,
        message: 'Save the rule first, then test against current Meta state.',
      });
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const res = await testUserRule(rule._id);
      setTestResult(res);
    } catch (e) {
      setTestResult({
        error: e?.response?.data?.error || e.message,
      });
    } finally {
      setTesting(false);
    }
  };

  if (!open) return null;
  // Render through a portal so the modal escapes every parent stacking
  // context (the Autopilot Settings tab has a sticky header at z-20 and
  // backdrop-blur containers above it that were silently sitting on top
  // of the upper portion of this modal — that's what made the X button
  // and the Name field unclickable while inputs further down still worked).
  return createPortal(
    <AnimatePresence>
      {/* Right-side drawer. Backdrop dimmer is independent of the panel so
          the slide-in animation can run without dragging the backdrop with
          it. Backdrop stays non-dismissive (X / Cancel / Esc only) — the
          original modal version chose this to avoid focus races with
          inputs near the panel edges, and the same hazard applies to a
          drawer that snaps wide enough to reach the viewport edge on
          smaller screens. */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-100 bg-black/55 backdrop-blur-sm"
      />
      <motion.div
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', stiffness: 320, damping: 32 }}
        className="fixed top-0 right-0 bottom-0 z-100 flex w-full max-w-[680px] flex-col overflow-hidden border-l border-white/10 bg-[#14181D] shadow-[-12px_0_40px_rgba(0,0,0,0.5)] sm:w-[680px]"
      >
          {/* header */}
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/12 bg-white/3 px-4 py-3 sm:px-5 sm:py-3.5">
            <div>
              <h2 className="text-sm font-bold text-white 2xl:text-base">
                {isEdit ? 'Edit rule' : 'New rule'}
              </h2>
              <p className="mt-0.5 text-[11px] text-white/55 2xl:text-xs">
                Pause campaigns or get alerts when conditions you define
                match.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex h-7 w-7 items-center justify-center rounded-md text-white/55 transition-colors hover:bg-white/8 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* body */}
          <div className="scrollbar-thin flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
            <div className="flex flex-col gap-5 lg:gap-6">
              {/* Basics */}
              <div>
                <FieldLabel>Name</FieldLabel>
                <TextInput
                  value={form.name}
                  onChange={(v) => set({ name: v })}
                  placeholder="e.g. Pause if no conversions"
                  maxLength={80}
                  invalid={showError('name')}
                />
                {showError('name') && <FieldError>{errorFor('name')}</FieldError>}
              </div>

              <div>
                <FieldLabel>Description</FieldLabel>
                <TextArea
                  value={form.description}
                  onChange={(v) => set({ description: v })}
                  placeholder="Why is this rule here? What problem does it solve?"
                  maxLength={500}
                  invalid={showError('description')}
                />
                {showError('description') && (
                  <FieldError>{errorFor('description')}</FieldError>
                )}
              </div>

              <div>
                <FieldLabel>Severity</FieldLabel>
                <div className="grid grid-cols-3 gap-2">
                  {SEVERITIES.map((s) => (
                    <button
                      key={s.value}
                      type="button"
                      onClick={() => set({ severity: s.value })}
                      className={`flex items-center justify-center gap-1.5 rounded-full border py-2 text-xs font-medium transition-all 2xl:text-sm ${
                        form.severity === s.value
                          ? s.tone
                          : 'border-white/8 bg-white/4 text-white/65 hover:border-white/15 hover:text-white'
                      }`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
                      {s.label}
                    </button>
                  ))}
                </div>
                {showError('severity') && (
                  <FieldError>{errorFor('severity')}</FieldError>
                )}
              </div>

              {/* Evaluation level */}
              <div>
                <FieldLabel hint="Where the rule walks once it matches">
                  When to evaluate
                </FieldLabel>
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                  {EVALUATE_ON.map((opt) => (
                    <ChoiceCard
                      key={opt.value}
                      selected={form.evaluateOn === opt.value}
                      label={opt.label}
                      hint={opt.hint}
                      onClick={() => set({ evaluateOn: opt.value })}
                    />
                  ))}
                </div>
              </div>

              {/* Lookback window — controls how many days of Meta insights
                  are rolled up before evaluating this rule. Rules sharing
                  the same window dedupe their Meta fetch on the cron side. */}
              <div>
                <FieldLabel hint="Window of Meta insights the rule's metrics roll up over">
                  Evaluate over
                </FieldLabel>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                  {[1, 3, 7, 14, 30].map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => set({ lookbackDays: d })}
                      className={`rounded-full border py-2 text-13 font-medium transition-all ${
                        Number(form.lookbackDays) === d
                          ? 'border-[#15DCFF]/50 bg-[#15DCFF]/8 text-white'
                          : 'border-white/10 bg-[#262626] text-white/65 hover:border-white/20 hover:text-white'
                      }`}
                    >
                      {d}d
                    </button>
                  ))}
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-[11px] text-white/45">Custom:</span>
                  <input
                    type="number"
                    min={1}
                    max={90}
                    step={1}
                    value={form.lookbackDays}
                    onChange={(e) => set({ lookbackDays: e.target.value })}
                    onBlur={(e) => {
                      // Clamp + integer-ize on blur so the field always
                      // settles to a valid value. Empty stays empty so the
                      // error message can fire; otherwise: floor → clamp.
                      const raw = e.target.value;
                      if (raw === '' || raw === null) return;
                      const n = Math.floor(Number(raw));
                      if (!Number.isFinite(n)) {
                        set({ lookbackDays: 14 });
                        return;
                      }
                      set({ lookbackDays: Math.min(90, Math.max(1, n)) });
                    }}
                    className={`h-8 w-24 rounded-full border bg-[#909294]/15 px-3 text-13 text-white placeholder:text-[#AFAFAF] transition-colors focus:outline-none ${
                      showError('lookbackDays')
                        ? 'border-red-400/60 focus:border-red-400'
                        : 'border-white/5 hover:border-white/15 focus:border-white/20'
                    }`}
                  />
                  <span className="text-[11px] text-white/45">
                    days (1–90, whole numbers)
                  </span>
                </div>
                {showError('lookbackDays') && (
                  <FieldError>{errorFor('lookbackDays')}</FieldError>
                )}
              </div>

              {/* Conditions */}
              <div className="rounded-2xl border border-white/12 bg-white/4 p-4 2xl:p-5">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-white 2xl:text-base">
                      Conditions
                    </p>
                    <p className="mt-0.5 text-[11px] text-white/55 2xl:text-xs">
                      ALL must match (AND). Up to 8.
                    </p>
                  </div>
                  <span className="rounded-full bg-white/8 px-2 py-0.5 text-10 font-medium uppercase tracking-wider text-white/60">
                    {form.conditions.rules.length} of 8
                  </span>
                </div>
                <div className="flex flex-col gap-2.5">
                  {form.conditions.rules.map((c, i) => (
                    <ConditionRow
                      key={i}
                      index={i}
                      condition={c}
                      onChange={(patch) => setCondition(i, patch)}
                      onRemove={
                        form.conditions.rules.length > 1
                          ? () => removeCondition(i)
                          : null
                      }
                      errors={
                        submitAttempted
                          ? validity.fieldErrors.conditions?.[i] || null
                          : null
                      }
                    />
                  ))}
                </div>
                <button
                  type="button"
                  onClick={addCondition}
                  disabled={form.conditions.rules.length >= 8}
                  className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-full border border-dashed border-white/15 bg-transparent px-3 py-2 text-xs font-medium text-white/65 transition-all hover:border-white/30 hover:text-white disabled:opacity-40"
                >
                  <Plus className="h-3.5 w-3.5" /> Add condition
                </button>
                {showError('conditionsTop') && (
                  <FieldError>{errorFor('conditionsTop')}</FieldError>
                )}
              </div>

              {/* Action */}
              <div>
                <FieldLabel>Action when matched</FieldLabel>
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  {ACTION_TYPES.map((opt) => (
                    <ChoiceCard
                      key={opt.value}
                      selected={form.action.type === opt.value}
                      label={opt.label}
                      hint={opt.hint}
                      onClick={() => set({ action: { type: opt.value } })}
                    />
                  ))}
                </div>
                {showError('action') && (
                  <FieldError>{errorFor('action')}</FieldError>
                )}
              </div>

              {/* Attached campaigns */}
              <div>
                <FieldLabel hint={`${form.attachments.length} attached`}>
                  Attached campaigns
                </FieldLabel>
                <AttachmentPicker
                  attachments={form.attachments}
                  onChange={setAttachments}
                />
                {showError('attachments') && (
                  <FieldError>{errorFor('attachments')}</FieldError>
                )}
              </div>

              {/* Save error */}
              {saveError && <Banner variant="error">{saveError}</Banner>}

              {/* Test result */}
              {testResult && (
                <div className="rounded-2xl border border-white/10 bg-white/4 p-3 text-xs">
                  {testResult.notSaved && (
                    <p className="text-white/70">{testResult.message}</p>
                  )}
                  {testResult.error && (
                    <p className="text-red-300">{testResult.error}</p>
                  )}
                  {testResult.notImplemented && (
                    <p className="text-white/55">
                      Live preview is on the way — wiring is in place but the
                      preview hits aren't connected to the cron's fetch
                      helpers yet. Save and watch the Action log on the next
                      cron tick.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* footer */}
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-white/12 bg-white/3 px-4 py-3 sm:px-5">
            {/* Test button is always clickable while not loading — onTest
                handles the "must save first" case in create mode by
                surfacing an inline message. Disabled-only-on-loading
                avoids the dead-button feedback gap testers hit. */}
            <SecondaryButton
              onClick={onTest}
              disabled={testing}
              title={
                !isEdit
                  ? 'Save the rule first, then test against current Meta state.'
                  : 'Run this rule against current Meta data without saving any changes.'
              }
            >
              {testing ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" /> Testing…
                </>
              ) : (
                'Test rule'
              )}
            </SecondaryButton>
            <div className="flex items-center gap-2">
              <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
              {/* Button stays clickable while invalid so a click can mark
                  the form as submit-attempted; the onSave handler does the
                  real gating and short-circuits if the form isn't valid. */}
              <PrimaryButton onClick={onSave} disabled={saving}>
                {saving ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" /> Saving…
                  </>
                ) : isEdit ? (
                  'Save changes'
                ) : (
                  'Create rule'
                )}
              </PrimaryButton>
            </div>
          </div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
};

// ─── shared form atoms (mirrored from CreateCampaignWizard) ─────────────────

function FieldLabel({ children, hint }) {
  return (
    <label className="mb-2 flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-sm font-medium text-[#afafaf]">
      <span>{children}</span>
      {hint && <span className="text-[11px] font-normal text-white/45">{hint}</span>}
    </label>
  );
}

function TextInput({
  value,
  onChange,
  placeholder,
  type = 'text',
  maxLength,
  invalid = false,
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      maxLength={maxLength}
      aria-invalid={invalid || undefined}
      className={`w-full rounded-full border bg-[#909294]/15 px-4 py-2.5 text-13 text-white placeholder:text-13 placeholder:text-[#AFAFAF] transition-colors focus:outline-none ${
        invalid
          ? 'border-red-400/60 focus:border-red-400'
          : 'border-white/5 hover:border-white/15 focus:border-white/20'
      }`}
    />
  );
}

function TextArea({
  value,
  onChange,
  placeholder,
  rows = 3,
  maxLength,
  invalid = false,
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      maxLength={maxLength}
      aria-invalid={invalid || undefined}
      className={`w-full resize-none rounded-2xl border bg-[#909294]/15 px-4 py-3 text-13 text-white placeholder:text-[#AFAFAF] transition-colors focus:outline-none ${
        invalid
          ? 'border-red-400/60 focus:border-red-400'
          : 'border-white/5 hover:border-white/15 focus:border-white/20'
      }`}
    />
  );
}

// Inline field-level error message — sits directly under the offending
// input. Color matches the red border on `invalid` state for consistency.
function FieldError({ children }) {
  return (
    <p className="mt-1.5 text-[11px] leading-snug text-red-300">{children}</p>
  );
}

// Big tappable choice card used for evaluation level + action type. Same
// "rounded-2xl + gradient border on selected" pattern as the wizard's
// objective tiles, scaled down to fit the rule form's tighter rhythm.
function ChoiceCard({ selected, label, hint, onClick }) {
  return (
    <div
      className={`rounded-2xl p-px transition-all ${
        selected
          ? 'bg-linear-to-r from-[#02C8C4] to-[#5867EB]'
          : 'bg-white/8 hover:bg-white/15'
      }`}
    >
      <button
        type="button"
        onClick={onClick}
        className={`flex h-full w-full flex-col gap-1 rounded-2xl px-3 py-2.5 text-left transition-colors ${
          selected ? 'bg-[#1d1d1d]' : 'bg-[#181818] hover:bg-[#1d1d1d]'
        }`}
      >
        <span
          className={`text-13 font-semibold ${
            selected ? 'text-white' : 'text-white/85'
          }`}
        >
          {label}
        </span>
        {hint && (
          <span className="text-[11px] leading-snug text-white/55">{hint}</span>
        )}
      </button>
    </div>
  );
}

// Portal-based custom select — same UX as the campaign wizard's account
// picker: rounded-full pill trigger, floating dark menu with hover +
// "selected" check on the active row. Coords are pinned to the trigger's
// bounding rect via `position: fixed`, and the menu is portaled to
// `document.body`, so the modal's overflow-y-auto / sticky parents can't
// clip it.
//
//   options accepts either:
//     - flat:    [{ value, label, hint? }, ...]
//     - grouped: [{ groupLabel, items: [{ value, label, hint? }, ...] }, ...]
//
// `onChange(value)` receives the bare value (not an event).
function SelectInput({
  value,
  onChange,
  options,
  disabled,
  invalid = false,
  placeholder = 'Select…',
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  // Track the trigger's coords whenever the menu is open: re-measure on
  // open, on any scroll inside the modal body or window, and on resize.
  // Capture-phase scroll is essential — the modal body has its own
  // overflow-y-auto and bubbles scroll events that we'd otherwise miss.
  useEffect(() => {
    if (!open) return undefined;
    const updatePos = () => {
      const el = triggerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      // Flip up if there isn't room below — keeps long lists onscreen
      // when a Condition row sits near the bottom of the modal.
      const spaceBelow = window.innerHeight - rect.bottom;
      const top =
        spaceBelow < 240 && rect.top > 240
          ? rect.top - 4 - Math.min(280, rect.top - 16)
          : rect.bottom + 4;
      setPos({ top, left: rect.left, width: rect.width });
    };
    updatePos();
    const onDocClick = (e) => {
      const inTrigger = triggerRef.current?.contains(e.target);
      const inMenu = menuRef.current?.contains(e.target);
      if (!inTrigger && !inMenu) setOpen(false);
    };
    const onEsc = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onScroll = (e) => {
      if (menuRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', updatePos);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', updatePos);
    };
  }, [open]);

  // Normalize input to a flat list for label lookup + grouped rendering.
  const isGrouped =
    Array.isArray(options) && options.length > 0 && 'items' in options[0];
  const flatItems = isGrouped
    ? options.flatMap((g) => g.items)
    : options || [];
  const selected = flatItems.find((o) => o.value === value);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-invalid={invalid || undefined}
        onClick={() => setOpen((p) => !p)}
        className={`flex w-full items-center justify-between gap-2 rounded-full border bg-[#909294]/15 px-4 py-2.5 text-left text-13 font-medium transition-colors focus:outline-none disabled:cursor-not-allowed disabled:border-white/3 disabled:bg-white/3 disabled:text-white/30 ${
          invalid
            ? 'border-red-400/60'
            : open
              ? 'border-white/20'
              : 'border-white/5 hover:border-white/15'
        }`}
      >
        <span
          className={`min-w-0 truncate ${
            selected ? 'text-white' : 'text-[#AFAFAF]'
          }`}
        >
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 transition-transform duration-150 ${
            open ? 'rotate-180 text-white/85' : 'text-white/55'
          } ${disabled ? 'text-white/20' : ''}`}
        />
      </button>

      {createPortal(
        <AnimatePresence>
          {open && (
            <motion.div
              ref={menuRef}
              initial={{ opacity: 0, y: -4, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.98 }}
              transition={{ duration: 0.12, ease: 'easeOut' }}
              style={{
                position: 'fixed',
                top: pos.top,
                left: pos.left,
                minWidth: pos.width,
              }}
              className="z-200 overflow-hidden rounded-xl border border-white/12 bg-[#0F0F0F]/98 shadow-xl backdrop-blur-xl"
            >
              <div className="scrollbar-thin max-h-72 overflow-y-auto p-1.5">
                {isGrouped
                  ? options.map((group) => (
                      <div key={group.groupLabel}>
                        <div className="px-3 py-1.5 text-10 font-bold uppercase tracking-wider text-white/40">
                          {group.groupLabel}
                        </div>
                        {group.items.map((o) => (
                          <SelectMenuItem
                            key={o.value}
                            option={o}
                            isSelected={o.value === value}
                            onPick={() => {
                              onChange(o.value);
                              setOpen(false);
                            }}
                          />
                        ))}
                      </div>
                    ))
                  : flatItems.map((o) => (
                      <SelectMenuItem
                        key={o.value}
                        option={o}
                        isSelected={o.value === value}
                        onPick={() => {
                          onChange(o.value);
                          setOpen(false);
                        }}
                      />
                    ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}

function SelectMenuItem({ option, isSelected, onPick }) {
  return (
    <button
      type="button"
      onClick={onPick}
      className={`flex w-full items-start justify-between gap-2 rounded-md px-3 py-2 text-left transition-colors ${
        isSelected
          ? 'bg-white/10 text-white'
          : 'text-white/85 hover:bg-white/5 hover:text-white'
      }`}
    >
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-[12px] font-medium">
          {option.label}
        </span>
        {option.hint && (
          <span className="truncate text-10 text-white/45">
            {option.hint}
          </span>
        )}
      </span>
      {isSelected && (
        <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#15DCFF]" />
      )}
    </button>
  );
}

// ─── condition row ─────────────────────────────────────────────────────────
function ConditionRow({ index, condition, onChange, onRemove, errors }) {
  const ops = opsForField(condition.field);
  const meta = fieldMeta(condition.field);
  const isString = isStringField(condition.field);
  const fieldErr = errors?.field;
  const opErr = errors?.op;
  const valueErr = errors?.value;
  const numericValueInvalid = !!valueErr;

  return (
    <div className="rounded-2xl border border-white/8 bg-[#181818] p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wider text-white/45">
          Condition #{index + 1}
        </span>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            aria-label="Remove condition"
            className="flex h-6 w-6 items-center justify-center rounded-md text-white/40 transition-colors hover:bg-white/8 hover:text-red-300"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        )}
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 sm:items-center">
        <SelectInput
          value={condition.field}
          onChange={(v) => onChange({ field: v, op: '', value: '' })}
          invalid={!!fieldErr}
          placeholder="Pick a field…"
          options={[
            {
              groupLabel: 'Numeric',
              items: NUMERIC_FIELDS.map((f) => ({
                value: f.value,
                label: f.label,
                hint: f.hint,
              })),
            },
            {
              groupLabel: 'Status / enum',
              items: STRING_FIELDS.map((f) => ({
                value: f.value,
                label: f.label,
              })),
            },
          ]}
        />

        <SelectInput
          value={condition.op}
          onChange={(v) => onChange({ op: v })}
          disabled={!condition.field}
          invalid={!!opErr}
          placeholder="Operator"
          options={ops.map((o) => ({ value: o.value, label: o.label }))}
        />

        {isString && meta?.options ? (
          <SelectInput
            value={condition.value}
            onChange={(v) => onChange({ value: v })}
            disabled={!condition.field}
            invalid={!!valueErr}
            placeholder="Pick a value…"
            options={meta.options.map((opt) => ({
              value: opt,
              label: opt,
            }))}
          />
        ) : (
          <input
            type={isString ? 'text' : 'number'}
            step="any"
            min={isString ? undefined : 0}
            value={condition.value}
            onChange={(e) => onChange({ value: e.target.value })}
            disabled={!condition.field}
            aria-invalid={numericValueInvalid || undefined}
            placeholder={
              !condition.field
                ? 'pick a field first'
                : isNumericField(condition.field)
                  ? 'numeric value'
                  : 'value'
            }
            className={`h-9 w-full rounded-full border bg-[#909294]/15 px-4 text-13 text-white placeholder:text-[#AFAFAF] transition-colors focus:outline-none disabled:cursor-not-allowed disabled:border-white/3 disabled:bg-white/3 disabled:text-white/30 disabled:placeholder:text-white/25 ${
              numericValueInvalid
                ? 'border-red-400/60 focus:border-red-400'
                : 'border-white/5 hover:border-white/15 focus:border-white/20'
            }`}
          />
        )}
      </div>
      {/* Per-sub-field error messages — shown beneath the row in priority
          order (field → op → value) so the user fixes the upstream issue
          first. */}
      {fieldErr && <FieldError>{fieldErr}</FieldError>}
      {!fieldErr && opErr && <FieldError>{opErr}</FieldError>}
      {!fieldErr && !opErr && valueErr && <FieldError>{valueErr}</FieldError>}
      {!fieldErr && !opErr && !valueErr && meta?.hint && (
        <p className="mt-2 text-[11px] text-white/45">{meta.hint}</p>
      )}
    </div>
  );
}

// ─── attachment picker ─────────────────────────────────────────────────────
//
// Inline accordion (no floating dropdown). Same pattern as the wizard's
// in-form group panels — never clipped by the modal scroll container.
function AttachmentPicker({ attachments, onChange }) {
  const [accounts, setAccounts] = useState([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [campaignsByAccount, setCampaignsByAccount] = useState({});
  const [loadingAccount, setLoadingAccount] = useState(null);
  const [openAccount, setOpenAccount] = useState(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await getAdAccounts();
        if (alive) setAccounts(r?.adAccounts || []);
      } catch {
        // non-fatal
      } finally {
        if (alive) setAccountsLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const ensureCampaigns = async (acctKey) => {
    if (campaignsByAccount[acctKey]) return;
    setLoadingAccount(acctKey);
    try {
      const bareId = acctKey.replace(/^act_/, '');
      const r = await getCampaigns(bareId);
      const list = r?.campaigns || r?.data || [];
      setCampaignsByAccount((prev) => ({ ...prev, [acctKey]: list }));
    } catch {
      setCampaignsByAccount((prev) => ({ ...prev, [acctKey]: [] }));
    } finally {
      setLoadingAccount(null);
    }
  };

  const toggleAccount = (acctKey) => {
    if (openAccount === acctKey) {
      setOpenAccount(null);
    } else {
      setOpenAccount(acctKey);
      ensureCampaigns(acctKey);
    }
  };

  const toggle = (acctKey, campaignId) => {
    const exists = attachments.some(
      (a) => a.adAccountId === acctKey && a.campaignId === campaignId,
    );
    if (exists) {
      onChange(
        attachments.filter(
          (a) =>
            !(a.adAccountId === acctKey && a.campaignId === campaignId),
        ),
      );
    } else {
      onChange([...attachments, { adAccountId: acctKey, campaignId }]);
    }
  };

  const removeAttachment = (idx) => {
    onChange(attachments.filter((_, i) => i !== idx));
  };

  // Eagerly load campaigns for all accounts the moment the user starts
  // typing in the search box. Without this the search can only match
  // account names + the campaigns of accounts the user has already
  // manually expanded — typing a campaign name on a fresh form would
  // hide every account. `ensureCampaigns` no-ops accounts that are
  // already loaded, so repeated calls are cheap. Debounced 250ms so
  // we don't fire N requests per keystroke.
  useEffect(() => {
    if (!search.trim() || accounts.length === 0) return undefined;
    const t = setTimeout(() => {
      accounts.forEach((acct) => {
        const acctKey = `act_${acct.id}`;
        if (!campaignsByAccount[acctKey]) {
          ensureCampaigns(acctKey);
        }
      });
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, accounts]);

  return (
    <div className="flex flex-col gap-3">
      {/* Selected list — display of already-attached campaigns. Commented
          out per product decision. The search + account picker below
          stays active, and `attachments` state still tracks selections;
          users just can't see the list of what's already attached or
          remove items via the X button. Re-enable by uncommenting this
          block. */}
      {/*
      {attachments.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-white/15 bg-white/3 px-4 py-3 text-[12px] text-white/55">
          No campaigns attached yet. Pick at least one below.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {attachments.map((a, i) => (
            <div
              key={`${a.adAccountId}-${a.campaignId}-${i}`}
              className={`flex items-center justify-between gap-2 rounded-2xl border px-3 py-2 ${
                a.orphan
                  ? 'border-amber-400/30 bg-amber-400/8'
                  : 'border-white/10 bg-white/4'
              }`}
            >
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-13 font-medium text-white">
                  campaign {a.campaignId}
                </span>
                <span className="truncate text-[11px] font-mono text-white/45">
                  {a.adAccountId}
                </span>
                {a.orphan && (
                  <span className="mt-0.5 text-[11px] text-amber-200/90">
                    Campaign was deleted on Meta — rule won't fire here.
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => removeAttachment(i)}
                aria-label="Remove attachment"
                className="shrink-0 rounded-md p-1.5 text-white/45 transition-colors hover:bg-white/8 hover:text-red-300"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
      */}

      {/* Inline picker */}
      <div className="rounded-2xl border border-white/10 bg-white/3">
        <div className="border-b border-white/10 p-2.5">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-white/45" />
            <input
              type="text"
              placeholder="Search campaigns…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 w-full rounded-full border border-white/5 bg-[#909294]/15 pl-9 pr-3 text-13 text-white placeholder:text-[#AFAFAF] transition-colors hover:border-white/15 focus:border-white/20 focus:outline-none"
            />
          </div>
        </div>
        <div className="max-h-72 overflow-y-auto">
          {accountsLoading && (
            <p className="px-3 py-3 text-[12px] text-white/55">
              Loading ad accounts…
            </p>
          )}
          {!accountsLoading && accounts.length === 0 && (
            <p className="px-3 py-3 text-[12px] text-white/55">
              No connected ad accounts.
            </p>
          )}
          {(() => {
            // When the user types a search query, hide accounts that
            // can't match. We can match on either:
            //   1. account name match, OR
            //   2. a loaded campaign whose name matches.
            // The previous version also kept accounts whose campaigns
            // weren't loaded yet — that defeated the filter on a fresh
            // form (every account is unloaded, so every account stayed
            // visible). Now: unloaded + no-name-match = hidden, with a
            // hint at the bottom telling the user to expand an account
            // to search inside its campaigns.
            const q = search.trim().toLowerCase();
            const visibleAccounts = q
              ? accounts.filter((acct) => {
                  if ((acct.name || '').toLowerCase().includes(q)) {
                    return true;
                  }
                  const campaigns =
                    campaignsByAccount[`act_${acct.id}`];
                  if (!campaigns) return false;
                  return campaigns.some((c) =>
                    (c.name || '').toLowerCase().includes(q),
                  );
                })
              : accounts;
            if (
              !accountsLoading &&
              accounts.length > 0 &&
              visibleAccounts.length === 0
            ) {
              return (
                <p className="px-3 py-3 text-[12px] text-white/55">
                  No accounts or campaigns match{' '}
                  <span className="font-mono text-white/70">
                    "{search}"
                  </span>
                  .
                </p>
              );
            }
            return visibleAccounts.map((acct) => {
            const acctKey = `act_${acct.id}`;
            const campaigns = campaignsByAccount[acctKey];
            const isOpen = openAccount === acctKey;
            const filtered = (campaigns || []).filter((c) =>
              (c.name || '').toLowerCase().includes(search.toLowerCase()),
            );
            const attachedHere = attachments.filter(
              (a) => a.adAccountId === acctKey,
            ).length;
            return (
              <div
                key={acct.id}
                className="border-b border-white/10 last:border-b-0"
              >
                <button
                  type="button"
                  onClick={() => toggleAccount(acctKey)}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left transition-colors hover:bg-white/5"
                >
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-13 font-medium text-white">
                      {acct.name}
                    </span>
                    <span className="text-[11px] font-mono text-white/45">
                      {acctKey}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 text-[11px] text-white/55">
                    {attachedHere > 0 && (
                      <span className="rounded-full bg-linear-to-r from-[#02C8C4] to-[#5867EB] px-2 py-0.5 text-white">
                        {attachedHere}
                      </span>
                    )}
                    <ChevronDown
                      className={`h-3.5 w-3.5 transition-transform ${
                        isOpen ? 'rotate-180' : ''
                      }`}
                    />
                  </div>
                </button>
                {isOpen && (
                  <div className="border-t border-white/10 bg-[#181818]">
                    {loadingAccount === acctKey || !campaigns ? (
                      <p className="px-3 py-2.5 text-[12px] text-white/55">
                        Loading campaigns…
                      </p>
                    ) : filtered.length === 0 ? (
                      <p className="px-3 py-2.5 text-[12px] text-white/55">
                        {search
                          ? 'No campaigns match your search.'
                          : 'No campaigns in this account.'}
                      </p>
                    ) : (
                      filtered.map((c) => {
                        const checked = attachments.some(
                          (a) =>
                            a.adAccountId === acctKey &&
                            a.campaignId === String(c.id),
                        );
                        return (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => toggle(acctKey, String(c.id))}
                            className={`flex w-full items-center justify-between gap-2 px-4 py-2 text-left transition-colors hover:bg-white/5 ${
                              checked ? 'bg-white/5' : ''
                            }`}
                          >
                            <div className="flex min-w-0 items-center gap-2.5">
                              <span
                                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full transition-colors ${
                                  checked
                                    ? 'bg-linear-to-r from-[#02C8C4] to-[#5867EB]'
                                    : 'border border-white/20'
                                }`}
                              >
                                {checked && (
                                  <Check className="h-3 w-3 text-white" strokeWidth={3} />
                                )}
                              </span>
                              <div className="min-w-0">
                                <div
                                  className={`truncate text-13 ${
                                    checked
                                      ? 'font-medium text-white'
                                      : 'text-white/85'
                                  }`}
                                >
                                  {c.name || `(unnamed)`}
                                </div>
                                <div className="truncate text-[11px] font-mono text-white/45">
                                  {c.id}
                                </div>
                              </div>
                            </div>
                            {c.status && (
                              <span className="shrink-0 text-10 uppercase tracking-wider text-white/45">
                                {c.status}
                              </span>
                            )}
                          </button>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            );
          });
          })()}
        </div>
      </div>
    </div>
  );
}

export default RuleFormModal;
