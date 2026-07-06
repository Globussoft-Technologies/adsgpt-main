import { useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Sparkles, Check, Loader2, Plus, Minus, X, Pencil, Info } from 'lucide-react';
import toast from 'react-hot-toast';

import { submitAssistantChoiceForm } from '@/store/reducers/aiAssistant/aiAssistantSlice';
import { uploadToS3 } from '@/utils/imageUpload';
import toMediaUrl from '@/utils/mediaUrl';

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

// ─── image_upload item helpers ──────────────────────────────────────────────
// image_upload values are [{ url, filename, selected }]. Only `selected` items
// feed generation; the first image is selected by default. Items may arrive as
// bare URL strings or {url} objects (server backfill), so normalise on the way in.
const asImgItem = (x) => (typeof x === 'string' ? { url: x } : { ...(x || {}) });
const isImgSelected = (x) => !!(x && typeof x === 'object' && x.selected);
// Normalise a raw image list → [{...item, selected}], defaulting the first to
// selected when nothing is explicitly selected yet (preserves an existing
// selection when re-seeding an edited form).
const withImgSelection = (arr) => {
  const items = (Array.isArray(arr) ? arr : arr ? [arr] : []).map(asImgItem).filter((it) => it.url);
  if (!items.length) return items;
  // Single-select: exactly ONE image feeds generation. Keep the first
  // explicitly-selected image, else default to the first image.
  let sel = items.findIndex(isImgSelected);
  if (sel < 0) sel = 0;
  return items.map((it, i) => ({ ...it, selected: i === sel }));
};

const initialValueForField = (field) => {
  if (field.default !== undefined && field.default !== null) {
    // image_upload: normalise + default the first image to selected.
    if (field.type === 'image_upload') return withImgSelection(field.default);
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
    const n = Array.isArray(value) ? value.filter(isImgSelected).length : 0;
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
    className="subtle-scroll w-full resize-y rounded-lg border border-white/10 bg-[#111] px-3 py-2 text-[13px] leading-relaxed text-white outline-none transition-colors placeholder:text-white/35 hover:border-white/25 focus:border-white/40 disabled:cursor-not-allowed disabled:opacity-60"
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

// Numeric stepper (− N +). Used for "how many per ratio" (1–5). Clamps to
// [min, max] and never lets the value leave the allowed range.
const StepperField = ({ field, value, onChange, disabled }) => {
  const min = field.min ?? 1;
  const max = field.max ?? 5;
  const step = field.step || 1;
  const current = Number.isFinite(Number(value)) ? Number(value) : min;
  const clamp = (n) => Math.min(max, Math.max(min, n));
  const set = (n) => onChange(clamp(n));
  return (
    <div className="inline-flex items-center gap-1">
      <button
        type="button"
        onClick={() => set(current - step)}
        disabled={disabled || current <= min}
        aria-label="Decrease"
        className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 text-white/70 transition-colors hover:border-white/25 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Minus className="h-3.5 w-3.5" />
      </button>
      <span className="min-w-[2.25rem] text-center text-[14px] font-semibold tabular-nums text-white">
        {current}
      </span>
      <button
        type="button"
        onClick={() => set(current + step)}
        disabled={disabled || current >= max}
        aria-label="Increase"
        className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 text-white/70 transition-colors hover:border-white/25 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
};

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
// stores [{url, filename, selected}] — the user clicks to pick which images
// actually feed generation (selected = bordered); the first is selected by
// default. Broken/unreachable images are dropped so only good ones show or ship.
const ImageUploadField = ({ field, value, onChange, disabled }) => {
  const arr = Array.isArray(value) ? value.map(asImgItem) : value ? [asImgItem(value)] : [];
  const [uploading, setUploading] = useState(false);
  const userId = useSelector((s) => s.socket?.userData?.user_id);
  const maxFiles = field.maxFiles || 5;
  const selectedCount = arr.filter(isImgSelected).length;
  // Upload straight to S3 via the shared helper (returns a stored PATH) — same
  // fast path the rest of the app uses; the domain is prefixed for display.
  const onPick = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    setUploading(true);
    try {
      const up = await Promise.all(
        files.map(async (f) => {
          const url = await uploadToS3(f, userId, true);
          if (!url) throw new Error('Upload failed');
          return { url, filename: f.name };
        }),
      );
      // A freshly uploaded image becomes THE selected one (the user added it to
      // use it) — single-select, so clear any prior selection.
      const next = [...arr, ...up].slice(0, maxFiles);
      const firstNew = next.findIndex((it) => up.some((u) => u.url === it.url));
      onChange(next.map((it, idx) => ({ ...it, selected: idx === firstNew })));
    } catch (err) {
      toast.error(err?.response?.data?.detail || err?.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const toggle = (i) => {
    if (disabled) return;
    // Single-select: choosing an image selects only it; clicking the currently
    // selected image clears it (generate with no reference).
    onChange(arr.map((it, idx) => ({ ...it, selected: idx === i ? !it.selected : false })));
  };

  const removeAt = (i, wasSelected) => {
    let next = arr.filter((_, idx) => idx !== i);
    // If we dropped the only selected image, promote the first remaining one so
    // there's still a default in play (matches "keep the first on default").
    if (wasSelected && next.length && !next.some(isImgSelected)) {
      next = next.map((it, idx) => (idx === 0 ? { ...it, selected: true } : it));
    }
    onChange(next);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {arr.map((img, i) => {
          const url = img.url;
          const on = !!img.selected;
          return (
            <div key={`${url}-${i}`} className="relative h-16 w-16">
              <button
                type="button"
                onClick={() => toggle(i)}
                disabled={disabled}
                title={on ? 'Selected — click to deselect' : 'Click to use this image'}
                className={`group h-full w-full overflow-hidden rounded-lg border-2 transition-all disabled:cursor-not-allowed ${
                  on ? 'border-white' : 'border-transparent hover:border-white/30'
                }`}
              >
                <img
                  src={toMediaUrl(url)}
                  alt=""
                  loading="lazy"
                  // Broken/unreachable image → drop it entirely (never shown, never sent).
                  onError={() => removeAt(i, on)}
                  className={`h-full w-full object-cover transition-opacity ${on ? '' : 'opacity-60 group-hover:opacity-90'}`}
                />
                {on && (
                  <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-white text-black shadow">
                    <Check className="h-3 w-3" />
                  </span>
                )}
              </button>
              {!disabled && (
                <button
                  type="button"
                  onClick={() => removeAt(i, on)}
                  title="Remove"
                  className="absolute -top-1.5 -right-1.5 z-10 flex h-4 w-4 items-center justify-center rounded-full bg-black/80 text-white/80 ring-1 ring-white/20 hover:bg-black hover:text-white"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              )}
            </div>
          );
        })}
        {!disabled && arr.length < maxFiles && (
          <label className="flex h-16 w-16 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-white/15 text-white/45 hover:border-white/40 hover:text-white/70">
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            <span className="text-[9px]">{uploading ? 'Uploading' : 'Add'}</span>
            <input type="file" accept="image/*" multiple={maxFiles > 1} onChange={onPick} className="hidden" />
          </label>
        )}
      </div>
      {arr.length > 0 && (
        <span
          className={`text-[11px] font-medium ${selectedCount ? 'text-emerald-400/90' : 'text-amber-400/90'}`}
        >
          {selectedCount
            ? 'Using the highlighted image — click another to switch'
            : 'Click an image to use it in generation'}
        </span>
      )}
    </div>
  );
};

// Multi-select grid of website-scraped images (autofill). Value is the array of
// picked URLs; on submit these are merged into reference_images. Nothing is
// preselected so the user explicitly chooses which images to feed generation.
const ImagePickerField = ({ field, value, onChange, disabled }) => {
  const candidates = Array.isArray(field.candidates) ? field.candidates : [];
  const selected = Array.isArray(value) ? value : [];
  if (!candidates.length) return null;
  const toggle = (url) => {
    if (disabled) return;
    onChange(selected.includes(url) ? selected.filter((u) => u !== url) : [...selected, url]);
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
        {candidates.map((url) => {
          const on = selected.includes(url);
          return (
            <button
              type="button"
              key={url}
              onClick={() => toggle(url)}
              disabled={disabled}
              className={`group relative aspect-square overflow-hidden rounded-lg border-2 transition-all disabled:cursor-not-allowed ${
                on ? 'border-white' : 'border-transparent hover:border-white/30'
              }`}
            >
              <img
                src={toMediaUrl(url)}
                alt=""
                loading="lazy"
                className={`h-full w-full object-cover transition-opacity ${on ? '' : 'opacity-75 group-hover:opacity-100'}`}
              />
              {on && (
                <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-white text-black shadow">
                  <Check className="h-3 w-3" />
                </span>
              )}
            </button>
          );
        })}
      </div>
      <span
        className={`text-[11.5px] font-medium ${selected.length ? 'text-emerald-400/90' : 'text-amber-400/90'}`}
      >
        {selected.length
          ? `${selected.length} image${selected.length > 1 ? 's' : ''} selected`
          : 'Pick the images you want to use (none selected yet)'}
      </span>
    </div>
  );
};

const FIELD_RENDERERS = {
  segmented: SegmentedField,
  select: SelectField,
  text: TextField,
  textarea: TextareaField,
  number: NumberField,
  stepper: StepperField,
  checkbox: CheckboxField,
  color_chips: ColorChipsField,
  image_upload: ImageUploadField,
  image_picker: ImagePickerField,
};

// Fields that always span both grid columns (their controls are wide).
const FULL_WIDTH_TYPES = new Set(['textarea', 'image_upload', 'image_picker']);
const isFullWidth = (field) => !!field.fullWidth || FULL_WIDTH_TYPES.has(field.type);

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
      // A required image field needs at least one SELECTED image (having images
      // present but none picked would silently generate without a reference).
      if (f.type === 'image_upload') {
        if (!(Array.isArray(v) && v.some(isImgSelected))) return `${f.label || f.key} is required`;
        continue;
      }
      const isEmpty =
        v == null ||
        (typeof v === 'string' && v.trim() === '') ||
        (typeof v === 'number' && Number.isNaN(v)) ||
        (Array.isArray(v) && v.length === 0);
      if (isEmpty) return `${f.label || f.key} is required`;
    }
    return null;
  }, [form, values]);

  // ── Live credit + image-count math ────────────────────────────────────────
  // The agent inlines `form.credit_costs` ({model: creditPerImage, plus "auto"}).
  // Real cost = perImage × (images per ratio) × (#ratios). An ad pack is fixed
  // at 3 variants regardless of the stepper. Falls back to the server's static
  // `estimated_credits` only when the live cost map is unavailable.
  const creditInfo = useMemo(() => {
    const costs = form.credit_costs || null;
    const isPack = values.creative_type === 'ad_pack';
    const ratiosRaw = values.aspect_ratios;
    const ratios = Math.max(
      1,
      Array.isArray(ratiosRaw) ? ratiosRaw.length : ratiosRaw ? 1 : 1,
    );
    const perRatio = isPack ? 3 : Math.max(1, Number(values.num_images) || 1);
    const totalImages = perRatio * ratios;
    let perImage = null;
    if (costs) {
      const model = values.model || 'auto';
      perImage = costs[model] != null ? costs[model] : costs.auto ?? null;
    }
    const totalCredits =
      perImage != null ? perImage * totalImages : form.estimated_credits ?? null;
    return { isPack, ratios, perRatio, totalImages, perImage, totalCredits };
  }, [values, form.credit_costs, form.estimated_credits]);

  const handleSubmit = async () => {
    if (isLocked || validationError) return;
    setSubmitting(true);
    try {
      // Fold any picked website_images into reference_images (the field the
      // agent maps to product_images), then drop the UI-only picker key. Picked
      // website images are marked selected so they survive the selected-only
      // filter below.
      const submitValues = { ...values };
      const picked = Array.isArray(submitValues.website_images) ? submitValues.website_images : [];
      if (picked.length) {
        const existing = Array.isArray(submitValues.reference_images)
          ? submitValues.reference_images
          : [];
        const seen = new Set(existing.map((x) => (typeof x === 'string' ? x : x?.url)));
        submitValues.reference_images = [
          ...existing,
          ...picked.filter((u) => !seen.has(u)).map((u) => ({ url: u, selected: true })),
        ];
      }
      delete submitValues.website_images;

      // The card keeps the FULL image list (with selection flags) so the summary
      // and a later "Edit & regenerate" still show every candidate. Generation,
      // however, only gets the SELECTED images (flag stripped) — nothing the user
      // didn't pick is ever sent.
      const agentValues = { ...submitValues };
      for (const f of form.fields || []) {
        if (f.type !== 'image_upload') continue;
        const items = Array.isArray(agentValues[f.key]) ? agentValues[f.key] : [];
        agentValues[f.key] = items.filter(isImgSelected).map((it) => {
          const copy = { ...it };
          delete copy.selected;
          return copy;
        });
      }

      dispatch(submitAssistantChoiceForm({ messageId, values: submitValues }));
      // Hand the selected-only values back to the parent (ChatInterface) which
      // decides whether to fire a real streamChat turn or a mocked one.
      await onSubmit?.({ formId: form.form_id, values: agentValues });
      setEditing(false); // collapse back to the summary after a (re)generation
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mt-3 w-full overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0F0F0F]">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 border-b border-white/[0.05] bg-gradient-to-b from-white/[0.03] to-transparent px-4 py-3">
        <div className="min-w-0">
          <div className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-[#15DCFF]/15 to-[#5E66F5]/15 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-white/80 uppercase">
            <Sparkles className="h-2.5 w-2.5" />
            <span>Creative brief</span>
          </div>
          {form.title && (
            <h4 className="mt-1.5 text-[15px] leading-snug font-semibold text-white">
              {form.title}
            </h4>
          )}
          {form.subtitle && (
            <p className="mt-0.5 text-[12px] leading-relaxed text-white/55">
              {form.subtitle}
            </p>
          )}
        </div>
        {creditInfo.totalCredits != null && (
          <span
            className="inline-flex shrink-0 items-center gap-1 rounded-full border border-white/10 bg-white/[0.06] px-2.5 py-1 text-[11px] font-semibold text-white/85"
            title={
              creditInfo.perImage != null
                ? `${creditInfo.perImage} credits/image × ${creditInfo.totalImages} image${creditInfo.totalImages > 1 ? 's' : ''}`
                : 'Estimated credit cost'
            }
          >
            <Sparkles className="h-3 w-3 text-[#15DCFF]" />
            ~{creditInfo.totalCredits}
          </span>
        )}
      </div>

      {/* Fields — two-column grid; wide controls span both columns. */}
      <div className="grid grid-cols-1 gap-x-3 gap-y-3.5 px-4 py-4 sm:grid-cols-2">
        {(form.fields || []).map((field) => {
          const Renderer = FIELD_RENDERERS[field.type] || TextField;
          const full = isFullWidth(field);
          return (
            <div
              key={field.key}
              className={`flex flex-col gap-1.5 ${full ? 'sm:col-span-2' : ''}`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <label className="flex items-center gap-1 text-[12px] font-medium text-white/80">
                  <span>
                    {field.label || field.key}
                    {field.required && <span className="ml-0.5 text-white/50">*</span>}
                  </span>
                  {field.tooltip && (
                    <span title={field.tooltip} className="cursor-help text-white/35 hover:text-white/70">
                      <Info className="h-3 w-3" />
                    </span>
                  )}
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

        {/* Total-images notice — clarifies per-ratio vs total so the count isn't
            mistaken for the grand total. Shown in red whenever >1 image. */}
        {creditInfo.totalImages > 1 && (
          <p className="sm:col-span-2 -mt-1 flex items-center gap-1.5 text-[11.5px] font-medium text-red-400/90">
            <Info className="h-3.5 w-3.5 shrink-0" />
            {creditInfo.isPack ? (
              <span>
                Ad pack: generating {creditInfo.totalImages} image
                {creditInfo.totalImages > 1 ? 's' : ''} total (3 variants ×{' '}
                {creditInfo.ratios} ratio{creditInfo.ratios > 1 ? 's' : ''}).
              </span>
            ) : (
              <span>
                Generating {creditInfo.totalImages} images total — {creditInfo.perRatio} per
                ratio × {creditInfo.ratios} ratio{creditInfo.ratios > 1 ? 's' : ''}.
              </span>
            )}
          </p>
        )}
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
