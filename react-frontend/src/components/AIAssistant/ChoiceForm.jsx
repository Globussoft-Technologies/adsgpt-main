import { useMemo, useState } from 'react';
import { useDispatch } from 'react-redux';
import { Sparkles, Check, Loader2 } from 'lucide-react';

import { submitAssistantChoiceForm } from '@/store/reducers/aiAssistant/aiAssistantSlice';

// ─── Normalisation helpers ─────────────────────────────────────────────────
// The agent emits options as either ["a","b","c"], [1,3], or
// [{value, label}]. Internally we always operate on [{value, label}] so the
// rendering paths stay simple.
const normaliseOptions = (options) => {
  if (!Array.isArray(options)) return [];
  return options.map((o) => {
    if (o && typeof o === 'object' && 'value' in o) {
      return { value: o.value, label: o.label != null ? String(o.label) : String(o.value) };
    }
    return { value: o, label: String(o) };
  });
};

const initialValueForField = (field) => {
  if (field.default !== undefined && field.default !== null) return field.default;
  if (field.type === 'segmented' || field.type === 'select') {
    const opts = normaliseOptions(field.options);
    return opts.length ? opts[0].value : '';
  }
  if (field.type === 'number') return field.min ?? 0;
  return '';
};

const formatValueLabel = (field, value) => {
  if (field.type === 'segmented' || field.type === 'select') {
    const match = normaliseOptions(field.options).find((o) => o.value === value);
    return match ? match.label : String(value ?? '');
  }
  if (value == null || value === '') return '—';
  const str = String(value);
  return str.length > 60 ? `${str.slice(0, 57)}…` : str;
};

// ─── Field renderers ───────────────────────────────────────────────────────
const SegmentedField = ({ field, value, onChange, disabled }) => {
  const opts = normaliseOptions(field.options);
  return (
    <div className="flex flex-wrap gap-1.5">
      {opts.map((o) => {
        const isOn = value === o.value;
        return (
          <button
            key={String(o.value)}
            type="button"
            onClick={() => onChange(o.value)}
            disabled={disabled}
            className={`h-8 rounded-full border px-3 text-[12px] font-medium transition-all ${
              isOn
                ? 'border-[#15DCFF] bg-[#15DCFF]/15 text-white shadow-[0_0_0_1px_#15DCFF55,0_0_10px_#15DCFF33]'
                : 'border-white/10 bg-transparent text-white/65 hover:border-white/25 hover:text-white'
            } disabled:cursor-not-allowed disabled:opacity-60`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
};

const SelectField = ({ field, value, onChange, disabled }) => {
  const opts = normaliseOptions(field.options);
  return (
    <select
      value={value ?? ''}
      onChange={(e) => {
        // Coerce numeric option values back to numbers if the original was numeric.
        const raw = e.target.value;
        const match = opts.find((o) => String(o.value) === raw);
        onChange(match ? match.value : raw);
      }}
      disabled={disabled}
      className="h-9 w-full rounded-lg border border-white/10 bg-[#111] px-3 text-[13px] text-white outline-none transition-colors hover:border-white/25 focus:border-[#15DCFF] disabled:cursor-not-allowed disabled:opacity-60"
    >
      {opts.map((o) => (
        <option key={String(o.value)} value={String(o.value)} className="bg-[#111]">
          {o.label}
        </option>
      ))}
    </select>
  );
};

const TextField = ({ field, value, onChange, disabled }) => (
  <input
    type="text"
    value={value ?? ''}
    placeholder={field.placeholder || ''}
    onChange={(e) => onChange(e.target.value)}
    disabled={disabled}
    className="h-9 w-full rounded-lg border border-white/10 bg-[#111] px-3 text-[13px] text-white outline-none transition-colors placeholder:text-white/35 hover:border-white/25 focus:border-[#15DCFF] disabled:cursor-not-allowed disabled:opacity-60"
  />
);

const TextareaField = ({ field, value, onChange, disabled }) => (
  <textarea
    value={value ?? ''}
    placeholder={field.placeholder || ''}
    onChange={(e) => onChange(e.target.value)}
    disabled={disabled}
    rows={field.rows || 3}
    className="w-full resize-y rounded-lg border border-white/10 bg-[#111] px-3 py-2 text-[13px] leading-relaxed text-white outline-none transition-colors placeholder:text-white/35 hover:border-white/25 focus:border-[#15DCFF] disabled:cursor-not-allowed disabled:opacity-60"
  />
);

const NumberField = ({ field, value, onChange, disabled }) => (
  <input
    type="number"
    value={value ?? ''}
    min={field.min}
    max={field.max}
    step={field.step || 1}
    onChange={(e) => {
      const raw = e.target.value;
      onChange(raw === '' ? '' : Number(raw));
    }}
    disabled={disabled}
    className="h-9 w-full rounded-lg border border-white/10 bg-[#111] px-3 text-[13px] text-white outline-none transition-colors hover:border-white/25 focus:border-[#15DCFF] disabled:cursor-not-allowed disabled:opacity-60"
  />
);

const FIELD_RENDERERS = {
  segmented: SegmentedField,
  select: SelectField,
  text: TextField,
  textarea: TextareaField,
  number: NumberField,
};

// ─── Top-level form ────────────────────────────────────────────────────────
const ChoiceForm = ({ form, messageId, result, onSubmit, disabled }) => {
  const dispatch = useDispatch();

  // Seed from the form spec; once the user starts editing this is the
  // authoritative state. After submission `result.values` is the truth.
  const initialValues = useMemo(() => {
    if (result?.values) return result.values;
    const out = {};
    for (const f of form.fields || []) out[f.key] = initialValueForField(f);
    return out;
  }, [form, result]);

  const [values, setValues] = useState(initialValues);
  const [submitting, setSubmitting] = useState(false);

  const isSubmitted = !!result;
  const isLocked = isSubmitted || disabled || submitting;

  const setField = (key, val) => setValues((prev) => ({ ...prev, [key]: val }));

  const validationError = useMemo(() => {
    for (const f of form.fields || []) {
      if (!f.required) continue;
      const v = values[f.key];
      const isEmpty =
        v == null ||
        (typeof v === 'string' && v.trim() === '') ||
        (typeof v === 'number' && Number.isNaN(v));
      if (isEmpty) return `${f.label || f.key} is required`;
    }
    return null;
  }, [form, values]);

  const handleSubmit = async () => {
    if (isLocked || validationError) return;
    setSubmitting(true);
    try {
      dispatch(submitAssistantChoiceForm({ messageId, values }));
      // Hand the values back to the parent (ChatInterface) which decides
      // whether to fire a real streamChat turn or a mocked one.
      await onSubmit?.({ formId: form.form_id, values });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mt-3 w-full overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0F0F0F]">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 border-b border-white/[0.05] px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-[#15DCFF] uppercase">
            <Sparkles className="h-3 w-3" />
            <span>Quick setup</span>
          </div>
          {form.title && (
            <h4 className="mt-1 text-[15px] leading-snug font-semibold text-white">
              {form.title}
            </h4>
          )}
          {form.subtitle && (
            <p className="mt-0.5 text-[12px] leading-relaxed text-white/55">
              {form.subtitle}
            </p>
          )}
        </div>
        {form.estimated_credits != null && (
          <span
            className="shrink-0 rounded-full bg-white/[0.06] px-2.5 py-1 text-[10.5px] font-medium text-white/70"
            title="Estimated credit cost"
          >
            ~{form.estimated_credits} credits
          </span>
        )}
      </div>

      {/* Fields */}
      <div className="flex flex-col gap-3.5 px-4 py-4">
        {(form.fields || []).map((field) => {
          const Renderer = FIELD_RENDERERS[field.type] || TextField;
          return (
            <div key={field.key} className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <label className="text-[12px] font-medium text-white/80">
                  {field.label || field.key}
                  {field.required && <span className="ml-0.5 text-[#EC4899]">*</span>}
                </label>
                {field.description && (
                  <span className="text-[11px] text-white/40">{field.description}</span>
                )}
              </div>
              <Renderer
                field={field}
                value={values[field.key]}
                onChange={(v) => setField(field.key, v)}
                disabled={isLocked}
              />
            </div>
          );
        })}
      </div>

      {/* Footer — submit OR submitted summary */}
      <div className="border-t border-white/[0.05] bg-black/30 px-4 py-3">
        {isSubmitted ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <Check className="h-3.5 w-3.5 text-emerald-400" />
            <span className="text-[11.5px] text-white/55">Submitted with</span>
            {form.fields.map((f) => (
              <span
                key={f.key}
                className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10.5px] text-white/80"
              >
                {f.label || f.key}: {formatValueLabel(f, result.values?.[f.key])}
              </span>
            ))}
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <span className="text-[11px] text-white/40">
              {validationError ? validationError : 'You can change anything before submitting.'}
            </span>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isLocked || !!validationError}
              className={`inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-[12.5px] font-medium transition-all ${
                isLocked || validationError
                  ? 'cursor-not-allowed bg-white/[0.06] text-white/35'
                  : 'bg-white text-black hover:bg-white/90 shadow-[0_2px_10px_rgba(255,255,255,0.12)]'
              }`}
            >
              {submitting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              <span>{form.submit_label || 'Generate'}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default ChoiceForm;
