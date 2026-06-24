import { useMemo, useState } from 'react';
import { useDispatch } from 'react-redux';
import { Sparkles, Check, Loader2, Plus, X, Pencil } from 'lucide-react';
import toast from 'react-hot-toast';

import { uploadFile } from '@/apis/aiAssistant/aiAssistantApi';
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

// Field types whose value is an array.
const ARRAY_TYPES = new Set(['checkbox', 'color_chips', 'image_upload']);

const initialValueForField = (field) => {
  if (field.default !== undefined && field.default !== null) {
    // Coerce array-type defaults that arrived as a single value / CSV string.
    if (ARRAY_TYPES.has(field.type)) {
      if (Array.isArray(field.default)) return field.default;
      if (typeof field.default === 'string') {
        return field.default.split(',').map((s) => s.trim()).filter(Boolean);
      }
      return field.default == null ? [] : [field.default];
    }
    return field.default;
  }
  if (ARRAY_TYPES.has(field.type)) return [];
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
  if (field.type === 'image_upload') {
    const n = Array.isArray(value) ? value.length : 0;
    return n ? `${n} image${n > 1 ? 's' : ''}` : '—';
  }
  if (Array.isArray(value)) return value.length ? value.join(', ') : '—';
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
                ? 'border-white/40 bg-white/15 text-white shadow-[0_0_0_1px_#ffffff40]'
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
      className="h-9 w-full rounded-lg border border-white/10 bg-[#111] px-3 text-[13px] text-white outline-none transition-colors hover:border-white/25 focus:border-white/40 disabled:cursor-not-allowed disabled:opacity-60"
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
    className="h-9 w-full rounded-lg border border-white/10 bg-[#111] px-3 text-[13px] text-white outline-none transition-colors placeholder:text-white/35 hover:border-white/25 focus:border-white/40 disabled:cursor-not-allowed disabled:opacity-60"
  />
);

const TextareaField = ({ field, value, onChange, disabled }) => (
  <textarea
    value={value ?? ''}
    placeholder={field.placeholder || ''}
    onChange={(e) => onChange(e.target.value)}
    disabled={disabled}
    rows={field.rows || 3}
    className="w-full resize-y rounded-lg border border-white/10 bg-[#111] px-3 py-2 text-[13px] leading-relaxed text-white outline-none transition-colors placeholder:text-white/35 hover:border-white/25 focus:border-white/40 disabled:cursor-not-allowed disabled:opacity-60"
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
    className="h-9 w-full rounded-lg border border-white/10 bg-[#111] px-3 text-[13px] text-white outline-none transition-colors hover:border-white/25 focus:border-white/40 disabled:cursor-not-allowed disabled:opacity-60"
  />
);

// Multi-select pills (e.g. several aspect ratios at once). Value is an array.
const CheckboxField = ({ field, value, onChange, disabled }) => {
  const opts = normaliseOptions(field.options);
  const arr = Array.isArray(value) ? value : value == null ? [] : [value];
  const toggle = (v) => {
    if (arr.includes(v)) onChange(arr.filter((x) => x !== v));
    else onChange([...arr, v]);
  };
  return (
    <div className="flex flex-wrap gap-1.5">
      {opts.map((o) => {
        const isOn = arr.includes(o.value);
        return (
          <button
            key={String(o.value)}
            type="button"
            onClick={() => toggle(o.value)}
            disabled={disabled}
            className={`h-8 rounded-full border px-3 text-[12px] font-medium transition-all ${
              isOn
                ? 'border-white/40 bg-white/15 text-white shadow-[0_0_0_1px_#ffffff40]'
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

// Brand-color swatches with add (hex text + native picker) and remove.
const ColorChipsField = ({ field, value, onChange, disabled }) => {
  const arr = Array.isArray(value)
    ? value
    : typeof value === 'string' && value
      ? value.split(',').map((s) => s.trim()).filter(Boolean)
      : [];
  const [draft, setDraft] = useState('');
  const add = (c) => {
    const color = (c || '').trim();
    if (color && !arr.includes(color)) onChange([...arr, color]);
    setDraft('');
  };
  const remove = (c) => onChange(arr.filter((x) => x !== c));
  return (
    <div className="flex flex-col gap-2">
      {arr.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {arr.map((c) => (
            <span
              key={c}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] py-0.5 pr-1 pl-1.5 text-[11px] text-white/80"
            >
              <span className="h-3.5 w-3.5 rounded-full border border-white/20" style={{ background: c }} />
              {c}
              {!disabled && (
                <button type="button" onClick={() => remove(c)} className="text-white/40 hover:text-white">
                  <X className="h-3 w-3" />
                </button>
              )}
            </span>
          ))}
        </div>
      )}
      {!disabled && (
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            value={draft}
            placeholder={field.placeholder || '#E4002B'}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add(draft);
              }
            }}
            className="h-8 w-28 rounded-lg border border-white/10 bg-[#111] px-2.5 text-[12px] text-white outline-none placeholder:text-white/35 focus:border-white/40"
          />
          <input
            type="color"
            onChange={(e) => add(e.target.value)}
            className="h-8 w-8 cursor-pointer rounded-lg border border-white/10 bg-[#111] p-0.5"
            title="Pick a color"
          />
          <button
            type="button"
            onClick={() => add(draft)}
            className="h-8 rounded-lg border border-white/10 px-2.5 text-[12px] text-white/70 hover:border-white/25 hover:text-white"
          >
            Add
          </button>
        </div>
      )}
    </div>
  );
};

// Reference-image / logo uploader. Reuses the existing /upload endpoint and
// stores [{url, filename}] so the agent can pass the URLs straight through.
const ImageUploadField = ({ field, value, onChange, disabled }) => {
  const arr = Array.isArray(value) ? value : value ? [value] : [];
  const [uploading, setUploading] = useState(false);
  const maxFiles = field.maxFiles || 5;
  const onPick = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    setUploading(true);
    try {
      const up = await Promise.all(
        files.map(async (f) => {
          const r = await uploadFile(f);
          return { url: r.url, filename: r.filename };
        }),
      );
      onChange([...arr, ...up].slice(0, maxFiles));
    } catch (err) {
      toast.error(err?.response?.data?.detail || err?.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };
  const remove = (i) => onChange(arr.filter((_, idx) => idx !== i));
  return (
    <div className="flex flex-wrap gap-2">
      {arr.map((img, i) => {
        const url = typeof img === 'string' ? img : img.url;
        return (
          <div key={`${url}-${i}`} className="group relative h-16 w-16 overflow-hidden rounded-lg border border-white/10">
            <img src={url} alt="" className="h-full w-full object-cover" />
            {!disabled && (
              <button
                type="button"
                onClick={() => remove(i)}
                className="absolute top-0.5 right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-black/70 text-white/80 hover:bg-black hover:text-white"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            )}
          </div>
        );
      })}
      {!disabled && arr.length < maxFiles && (
        <label className="flex h-16 w-16 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-white/15 text-white/45 hover:border-white/40/60 hover:text-white/70">
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          <span className="text-[9px]">{uploading ? 'Uploading' : 'Add'}</span>
          <input type="file" accept="image/*" multiple={maxFiles > 1} onChange={onPick} className="hidden" />
        </label>
      )}
    </div>
  );
};

const FIELD_RENDERERS = {
  segmented: SegmentedField,
  select: SelectField,
  text: TextField,
  textarea: TextareaField,
  number: NumberField,
  checkbox: CheckboxField,
  color_chips: ColorChipsField,
  image_upload: ImageUploadField,
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
  const [editing, setEditing] = useState(false);

  const isSubmitted = !!result;
  // After submitting, the card collapses to a summary — but the user can reopen
  // it ("Edit & regenerate"), tweak values, and fire a fresh generation. So the
  // lock only applies while collapsed (or disabled / mid-submit), not forever.
  const isLocked = (isSubmitted && !editing) || disabled || submitting;

  const setField = (key, val) => setValues((prev) => ({ ...prev, [key]: val }));

  const validationError = useMemo(() => {
    for (const f of form.fields || []) {
      if (!f.required) continue;
      const v = values[f.key];
      const isEmpty =
        v == null ||
        (typeof v === 'string' && v.trim() === '') ||
        (typeof v === 'number' && Number.isNaN(v)) ||
        (Array.isArray(v) && v.length === 0);
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
      setEditing(false); // collapse back to the summary after a (re)generation
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mt-3 w-full overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0F0F0F]">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 border-b border-white/[0.05] px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-white/70 uppercase">
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
                  {field.required && <span className="ml-0.5 text-white/50">*</span>}
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
        {isSubmitted && !editing ? (
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
            {!disabled && (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="ml-auto inline-flex h-7 items-center gap-1.5 rounded-full bg-white/[0.06] px-3 text-[11.5px] font-medium text-white/80 transition-colors hover:bg-white/[0.12]"
              >
                <Pencil className="h-3 w-3" />
                <span>Edit &amp; regenerate</span>
              </button>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <span className="text-[11px] text-white/40">
              {validationError
                ? validationError
                : isSubmitted
                  ? 'Tweak anything, then regenerate.'
                  : 'You can change anything before submitting.'}
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
              <span>{isSubmitted ? 'Regenerate' : form.submit_label || 'Generate'}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default ChoiceForm;
