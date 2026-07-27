import { useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  Sparkles,
  Check,
  Loader2,
  Plus,
  Minus,
  X,
  Pencil,
  Info,
  ChevronDown,
  RefreshCw,
  RotateCcw,
  Globe,
} from 'lucide-react';
import toast from 'react-hot-toast';

import { submitAssistantChoiceForm } from '@/store/reducers/aiAssistant/aiAssistantSlice';
import { fetchBrands, analazeDomain } from '@/store/actions/brandIQ/myBrandActions';
import { uploadToS3 } from '@/utils/imageUpload';
import toMediaUrl from '@/utils/mediaUrl';
import Tip from './Tip';
import ImageLightbox from './ImageLightbox';

// Reference / product / website images are often EXTERNAL URLs (scraped sites,
// ad-library images). Hotlinking them straight into <img> fails a lot of the
// time (hotlink/referer/CORS protection) → blank white thumbnails. Route
// absolute http(s) images through the app's image proxy (same one used by
// downloads and the Ad Studio editor) so they load reliably. Our own stored
// media (S3 paths / data:/blob:) is left to toMediaUrl untouched.
const IMG_PROXY_HOST = import.meta.env.VITE_SOCKET_URL;
const toDisplaySrc = (url) => {
  const m = toMediaUrl(url);
  if (typeof m === 'string' && /^https?:\/\//i.test(m)) {
    return `${IMG_PROXY_HOST}/adsgpt/img/preview?url=${encodeURIComponent(m)}`;
  }
  return m;
};

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
  // Multi-select: any number of images can feed generation. Preserve existing
  // selections; when nothing is selected yet, default the first image on.
  const anySelected = items.some(isImgSelected);
  return items.map((it, i) => ({ ...it, selected: it.selected === true || (!anySelected && i === 0) }));
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

// Friendly model picker: instead of a cramped native <select>, each model is a
// selectable row showing its per-image credit cost inline (a badge) AND on hover
// (a tooltip) — so users can compare what each model costs before choosing.
// `creditCosts` is the form's { model: creditsPerImage, auto: … } map.
const ModelSelectField = ({ field, value, onChange, disabled, creditCosts }) => {
  const opts = normaliseOptions(field.options);
  const costFor = (v) => {
    if (!creditCosts) return null;
    if (Object.prototype.hasOwnProperty.call(creditCosts, v)) return creditCosts[v];
    return creditCosts.auto ?? null;
  };
  return (
    <div className="flex flex-col gap-1.5">
      {opts.map((o) => {
        const isOn = value === o.value;
        const cost = costFor(o.value);
        const row = (
          <button
            type="button"
            onClick={() => onChange(o.value)}
            disabled={disabled}
            className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition-all ${
              isOn
                ? 'border-white/40 bg-white/[0.10] shadow-[0_0_0_1px_#ffffff30]'
                : 'border-white/10 bg-transparent hover:border-white/25'
            } disabled:cursor-not-allowed disabled:opacity-60`}
          >
            <span className="flex min-w-0 items-center gap-2">
              <span
                className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border ${
                  isOn ? 'border-white' : 'border-white/30'
                }`}
              >
                {isOn && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
              </span>
              <span className="truncate text-[13px] text-white/90">{o.label}</span>
            </span>
            {cost != null && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-white/10 bg-white/[0.06] px-2 py-0.5 text-[10.5px] font-semibold text-white/75">
                <Sparkles className="h-2.5 w-2.5 text-[#15DCFF]" />
                {cost} cr/img
              </span>
            )}
          </button>
        );
        return cost != null ? (
          <Tip
            key={String(o.value)}
            side="left"
            content={`${o.label}: ${cost} credit${cost === 1 ? '' : 's'} per image`}
          >
            {row}
          </Tip>
        ) : (
          <div key={String(o.value)}>{row}</div>
        );
      })}
    </div>
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
  // The native <input type="color"> fires onChange continuously while the user
  // drags through the picker, so committing on every change added a whole trail
  // of intermediate colors. We debounce instead: the picker only updates a live
  // draft, and we commit the single FINAL value ~300ms after the user settles.
  const commitTimer = useRef(null);
  const HEX6 = /^#[0-9a-fA-F]{6}$/;
  const add = (c) => {
    clearTimeout(commitTimer.current);
    const color = (c || '').trim();
    if (color && !arr.includes(color)) onChange([...arr, color]);
    setDraft('');
  };
  const pickColor = (val) => {
    setDraft(val);
    clearTimeout(commitTimer.current);
    commitTimer.current = setTimeout(() => add(val), 300);
  };
  useEffect(() => () => clearTimeout(commitTimer.current), []);
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
            value={HEX6.test(draft) ? draft : '#000000'}
            onChange={(e) => pickColor(e.target.value)}
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
  // Drop empty/whitespace-URL items at render: an <img src=""> does NOT reliably
  // fire onError in Chromium, so a blank entry would show a permanent broken box
  // that the onError→removeAt path can never clear (BUG 8).
  const arr = (Array.isArray(value) ? value.map(asImgItem) : value ? [asImgItem(value)] : [])
    .filter((it) => it && it.url && String(it.url).trim());
  const [uploading, setUploading] = useState(false);
  // Full-screen preview (double-click / double-tap a thumbnail).
  const [preview, setPreview] = useState(null);
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
          // A freshly uploaded image is selected — the user added it to use it.
          return { url, filename: f.name, selected: true };
        }),
      );
      onChange([...arr, ...up].slice(0, maxFiles));
    } catch (err) {
      toast.error(err?.response?.data?.detail || err?.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const toggle = (i) => {
    if (disabled) return;
    // Multi-select: toggle just this image; any number can be used together.
    onChange(arr.map((it, idx) => (idx === i ? { ...it, selected: !it.selected } : it)));
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
                onDoubleClick={() => setPreview(toDisplaySrc(url))}
                disabled={disabled}
                title={on ? 'Selected — double-click to preview' : 'Click to use · double-click to preview'}
                className={`group h-full w-full overflow-hidden rounded-lg border-2 transition-all disabled:cursor-not-allowed ${
                  on ? 'border-white' : 'border-transparent hover:border-white/30'
                }`}
              >
                <img
                  src={toDisplaySrc(url)}
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
            ? `${selectedCount} of ${arr.length} used in generation — click to add or remove`
            : 'Click the images you want to use in generation'}
        </span>
      )}
      <ImageLightbox src={preview} onClose={() => setPreview(null)} />
    </div>
  );
};

// Multi-select grid of website-scraped images (autofill). Value is the array of
// picked URLs; on submit these are merged into reference_images. Nothing is
// preselected so the user explicitly chooses which images to feed generation.
const ImagePickerField = ({ field, value, onChange, disabled }) => {
  const candidates = Array.isArray(field.candidates) ? field.candidates : [];
  const selected = Array.isArray(value) ? value : [];
  // Drop thumbnails that fail to load (dead/hotlink-blocked URLs) instead of
  // leaving blank white boxes — mirrors ImageUploadField's onError behavior,
  // which this grid previously lacked.
  const [broken, setBroken] = useState(() => new Set());
  // Full-screen preview (double-click / double-tap a thumbnail).
  const [preview, setPreview] = useState(null);
  const visible = candidates.filter((u) => !broken.has(u));
  if (!candidates.length || !visible.length) return null;
  const toggle = (url) => {
    if (disabled) return;
    onChange(selected.includes(url) ? selected.filter((u) => u !== url) : [...selected, url]);
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
        {visible.map((url) => {
          const on = selected.includes(url);
          return (
            <button
              type="button"
              key={url}
              onClick={() => toggle(url)}
              onDoubleClick={() => setPreview(toDisplaySrc(url))}
              disabled={disabled}
              title="Click to use · double-click to preview"
              className={`group relative aspect-square overflow-hidden rounded-lg border-2 transition-all disabled:cursor-not-allowed ${
                on ? 'border-white' : 'border-transparent hover:border-white/30'
              }`}
            >
              <img
                src={toDisplaySrc(url)}
                alt=""
                loading="lazy"
                onError={() =>
                  setBroken((prev) => {
                    const next = new Set(prev);
                    next.add(url);
                    return next;
                  })
                }
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
      <ImageLightbox src={preview} onClose={() => setPreview(null)} />
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

// The model/provider picker gets the richer ModelSelectField (credit-aware rows).
const isModelField = (field) =>
  field.type === 'select' && (field.key === 'model' || field.key === 'provider');

// Fields that always span both grid columns (their controls are wide). The model
// picker is a list of rows, so it reads better full-width too.
const FULL_WIDTH_TYPES = new Set(['textarea', 'image_upload', 'image_picker']);
const isFullWidth = (field) =>
  !!field.fullWidth || FULL_WIDTH_TYPES.has(field.type) || isModelField(field);

// ─── Brand picker ────────────────────────────────────────────────────────────
// The brief's brand fields (description / logo / colors) were pre-filled by the
// agent from the *newest* Brand IQ brand regardless of what the user is working
// on. This picker lets the user choose the correct brand; selecting it hydrates
// whichever brand fields the form actually contains from that brand's data.
const BRAND_FIELD_KEYS = new Set([
  'brand_name',
  'brand_description',
  'brand_logo',
  'brand_colors',
]);
const formHasBrandFields = (form) =>
  (form.fields || []).some((f) => BRAND_FIELD_KEYS.has(f.key));

const BrandPicker = ({ form, values, onPick, disabled }) => {
  const dispatch = useDispatch();
  const userId = useSelector((s) => s.socket?.userData?.user_id);
  const brands = useSelector((s) => s.brandIQTabs?.myBrands) || [];
  const [open, setOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // Snapshot of the brand fields as they were BEFORE the most recent change, so
  // a user who accidentally picks (or clears) the wrong brand can restore their
  // previous selection in one click instead of hunting for it again.
  const [prevBrand, setPrevBrand] = useState(null);
  // "Add from website" — analyze a typed domain and hydrate the brand fields
  // from it (for brands that aren't in the saved list).
  const [siteDraft, setSiteDraft] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const wrapRef = useRef(null);

  // Load the user's brands once if we don't have them yet — the assistant can
  // be opened without ever visiting Brand IQ (where they're normally fetched).
  useEffect(() => {
    if (userId && brands.length === 0) dispatch(fetchBrands(userId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // Close the dropdown on an outside click.
  useEffect(() => {
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const logoOf = (b) =>
    (Array.isArray(b?.logoUrls) && b.logoUrls[0]) || b?.logo || b?.iconUrl || '';
  const fieldKeys = new Set((form.fields || []).map((f) => f.key));
  const currentName = (values.brand_name || '').trim();
  const matched =
    brands.find((b) => (b?.name || '').trim().toLowerCase() === currentName.toLowerCase()) || null;

  // Capture the current brand fields so a subsequent change can be undone. Only
  // remembers a non-empty selection (nothing to restore from a blank state).
  const rememberCurrentBrand = () => {
    if (!currentName) return;
    const snap = {};
    ['brand_name', 'brand_description', 'brand_logo', 'brand_colors'].forEach((k) => {
      if (fieldKeys.has(k)) snap[k] = values[k];
    });
    setPrevBrand(snap);
  };

  const pick = (b) => {
    // Remember the outgoing selection before overwriting it (unless re-picking
    // the same brand, which isn't a change worth undoing).
    if (currentName.toLowerCase() !== (b.name || '').trim().toLowerCase()) {
      rememberCurrentBrand();
    }
    const patch = {};
    if (fieldKeys.has('brand_name')) patch.brand_name = b.name || '';
    if (fieldKeys.has('brand_description')) patch.brand_description = b.description || '';
    if (fieldKeys.has('brand_logo')) {
      const logo = logoOf(b);
      patch.brand_logo = logo ? [{ url: logo, filename: 'logo', selected: true }] : [];
    }
    if (fieldKeys.has('brand_colors')) {
      const colors = b.colors || b.brandColors || b.palette;
      if (Array.isArray(colors) && colors.length) patch.brand_colors = colors;
    }
    onPick(patch);
    setOpen(false);
  };

  // Clear a wrong selection — blanks every brand field the form has so the
  // user can re-pick (or leave brand-less) without restarting the workflow.
  const clear = () => {
    rememberCurrentBrand();
    const patch = {};
    if (fieldKeys.has('brand_name')) patch.brand_name = '';
    if (fieldKeys.has('brand_description')) patch.brand_description = '';
    if (fieldKeys.has('brand_logo')) patch.brand_logo = [];
    if (fieldKeys.has('brand_colors')) patch.brand_colors = [];
    onPick(patch);
  };

  // Restore the brand selection that was active before the last pick/clear.
  const restorePrevious = () => {
    if (!prevBrand) return;
    onPick(prevBrand);
    setPrevBrand(null);
  };

  // Only offer "restore" when the remembered brand actually differs from what's
  // currently selected (otherwise there's nothing to undo).
  const canRestore =
    !!prevBrand?.brand_name &&
    prevBrand.brand_name.trim().toLowerCase() !== currentName.toLowerCase();

  const refresh = () => {
    if (!userId || refreshing) return;
    setRefreshing(true);
    dispatch(fetchBrands(userId)).finally(() => setRefreshing(false));
  };

  const analyzeSite = async () => {
    const raw = siteDraft.trim();
    if (!raw || analyzing) return;
    const site = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    setAnalyzing(true);
    try {
      const res = await analazeDomain(site);
      const patch = {};
      if (fieldKeys.has('brand_name')) {
        patch.brand_name =
          res?.meta?.title || raw.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0];
      }
      if (fieldKeys.has('brand_description')) {
        patch.brand_description = res?.aiInsights?.aiSummary || res?.meta?.description || '';
      }
      onPick(patch);
      setSiteDraft('');
      setOpen(false);
      // Analyzing can save the brand server-side — refresh so it's listed next time.
      if (userId) dispatch(fetchBrands(userId));
    } catch (err) {
      // 409 = brand already saved — refresh the list so the user can pick it.
      if (err?.response?.status === 409) {
        refresh();
      } else {
        toast.error('Could not analyze that website — check the URL and try again.');
      }
    } finally {
      setAnalyzing(false);
    }
  };

  const triggerLogo = logoOf(matched);
  const hasList = brands.length > 0;

  return (
    <div ref={wrapRef} className="relative flex flex-col gap-1.5 sm:col-span-2">
      <label className="flex items-center gap-1 text-[12px] font-medium text-white/80">
        Brand
        <Tip content="Pick a saved brand to fill its description, logo and colors — or add one from its website. Use ✕ to clear a wrong selection.">
          <span className="cursor-help text-white/35 hover:text-white/70">
            <Info className="h-3 w-3" />
          </span>
        </Tip>
        <div className="ml-auto flex items-center gap-1">
          {canRestore && (
            <Tip content={`Restore previous brand (${prevBrand.brand_name})`}>
              <button
                type="button"
                onClick={restorePrevious}
                disabled={disabled}
                aria-label="Restore previous brand"
                className="rounded p-0.5 text-white/40 transition-colors hover:text-white disabled:cursor-not-allowed"
              >
                <RotateCcw className="h-3 w-3" />
              </button>
            </Tip>
          )}
          <Tip content="Refresh the brand list">
            <button
              type="button"
              onClick={refresh}
              disabled={disabled || refreshing}
              aria-label="Refresh brand list"
              className="rounded p-0.5 text-white/40 transition-colors hover:text-white disabled:cursor-not-allowed"
            >
              <RefreshCw className={`h-3 w-3 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
          </Tip>
        </div>
      </label>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className="flex h-10 w-full items-center justify-between gap-2 rounded-lg border border-white/10 bg-[#111] px-3 text-left transition-colors hover:border-white/25 focus:border-white/40 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span className="flex min-w-0 items-center gap-2">
          {currentName ? (
            <>
              {triggerLogo ? (
                <img src={toMediaUrl(triggerLogo)} alt="" className="h-5 w-5 shrink-0 rounded object-cover" />
              ) : (
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-white/10 text-[10px] font-semibold text-white/70">
                  {currentName.charAt(0).toUpperCase()}
                </span>
              )}
              <span className="truncate text-[13px] text-white/90">{currentName}</span>
              {!matched && (
                <span className="shrink-0 rounded-full bg-white/[0.06] px-1.5 py-0.5 text-[9.5px] whitespace-nowrap text-white/45">
                  from website
                </span>
              )}
            </>
          ) : (
            <span className="text-[13px] text-white/45">Select a brand…</span>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {currentName && !disabled && (
            // Not a <button> — nesting one inside the trigger button is invalid
            // HTML. stopPropagation keeps the clear click from toggling the list.
            <span
              role="button"
              tabIndex={0}
              title="Clear selected brand"
              onClick={(e) => {
                e.stopPropagation();
                clear();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.stopPropagation();
                  e.preventDefault();
                  clear();
                }
              }}
              className="rounded-full p-0.5 text-white/40 transition-colors hover:bg-white/10 hover:text-white"
            >
              <X className="h-3.5 w-3.5" />
            </span>
          )}
          <ChevronDown
            className={`h-4 w-4 text-white/50 transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </span>
      </button>
      {open && (
        <div className="absolute top-full left-0 z-30 mt-1 w-full rounded-lg border border-white/10 bg-[#141414] p-1 shadow-[0_12px_32px_rgba(0,0,0,0.55)]">
          <div className="subtle-scroll max-h-52 overflow-auto">
            {hasList ? (
              brands.map((b) => {
                const on = matched?.id === b?.id;
                const logo = logoOf(b);
                return (
                  <button
                    key={b?.id}
                    type="button"
                    onClick={() => pick(b)}
                    className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors ${
                      on ? 'bg-white/10' : 'hover:bg-white/[0.06]'
                    }`}
                  >
                    {logo ? (
                      <img
                        src={toMediaUrl(logo)}
                        alt=""
                        className="h-7 w-7 shrink-0 rounded object-cover ring-1 ring-white/10"
                      />
                    ) : (
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-white/10 text-[11px] font-semibold text-white/60">
                        {(b?.name || '?').charAt(0).toUpperCase()}
                      </span>
                    )}
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-[13px] text-white/90">{b?.name || 'Untitled brand'}</span>
                      {b?.description ? (
                        <span className="truncate text-[11px] text-white/45">{b.description}</span>
                      ) : null}
                    </span>
                    {on && <Check className="ml-auto h-3.5 w-3.5 shrink-0 text-emerald-400" />}
                  </button>
                );
              })
            ) : (
              <p className="px-2 py-1.5 text-[12px] text-white/45">
                No saved brands yet — add one from its website below.
              </p>
            )}
          </div>
          {/* Brand not in the list? Analyze its website and fill the fields. */}
          <div className="mt-1 flex flex-col gap-1.5 border-t border-white/10 p-1.5">
            <span className="flex items-center gap-1 text-[10.5px] font-medium text-white/45">
              <Globe className="h-3 w-3" />
              Brand not listed? Add it from its website
            </span>
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={siteDraft}
                placeholder="yourbrand.com"
                disabled={analyzing}
                onChange={(e) => setSiteDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    analyzeSite();
                  }
                }}
                className="h-8 min-w-0 flex-1 rounded-lg border border-white/10 bg-[#111] px-2.5 text-[12px] text-white outline-none placeholder:text-white/35 focus:border-white/40 disabled:opacity-60"
              />
              <button
                type="button"
                onClick={analyzeSite}
                disabled={analyzing || !siteDraft.trim()}
                className="inline-flex h-8 items-center gap-1 rounded-lg border border-white/10 px-2.5 text-[12px] text-white/70 transition-colors hover:border-white/25 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                {analyzing ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Add'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Top-level form ────────────────────────────────────────────────────────
const ChoiceForm = ({ form, messageId, result, onSubmit, disabled }) => {
  const dispatch = useDispatch();

  // Seed from the form spec; once the user starts editing this is the
  // authoritative state. After submission `result.values` is the truth.
  const initialValues = useMemo(() => {
    if (result?.values) {
      return {
        ...result.values,
        quality: result.values.quality === 'standard' ? 'medium' : result.values.quality,
      };
    }
    const out = {};
    for (const f of form.fields || []) out[f.key] = initialValueForField(f);
    return out;
  }, [form, result]);

  const [values, setValues] = useState(initialValues);
  const [submitting, setSubmitting] = useState(false);
  const [editing, setEditing] = useState(false);
  // Double-clicking the header collapses the brief to just its title bar.
  const [collapsed, setCollapsed] = useState(false);

  const isSubmitted = !!result;
  // After submitting, the card collapses to a summary — but the user can reopen
  // it ("Edit & regenerate"), tweak values, and fire a fresh generation. So the
  // lock only applies while collapsed (or disabled / mid-submit), not forever.
  const isLocked = (isSubmitted && !editing) || disabled || submitting;

  const setField = (key, val) =>
    setValues((prev) => {
      const next = { ...prev, [key]: val };
      if (key === 'model') {
        const costs = form.credit_costs_by_quality?.[val];
        const currentQuality = prev.quality === 'standard' ? 'medium' : prev.quality;
        if (costs && costs[currentQuality] == null) {
          next.quality =
            costs.high != null ? 'high' : Object.keys(costs)[0] || currentQuality || 'high';
        }
      }
      return next;
    });

  const creditCostsForQuality = useMemo(() => {
    const tiered = form.credit_costs_by_quality;
    if (!tiered) return form.credit_costs || null;
    const quality = values.quality === 'standard' ? 'medium' : values.quality || 'high';
    const modelKeys = new Set([
      ...Object.keys(form.credit_costs || {}),
      ...Object.keys(tiered),
    ]);
    const resolved = {};
    modelKeys.forEach((model) => {
      resolved[model] = tiered[model]?.[quality] ?? null;
    });
    return resolved;
  }, [form.credit_costs, form.credit_costs_by_quality, values.quality]);

  // What the "Submitted with" summary should show for a field. Prefer the
  // submitted `result.values`, but fall back to the card's live `values` when
  // that field came back empty — on a regenerate (esp. after a first attempt
  // failed and was retried) the submitted snapshot can lose optional fields
  // (logo, brand, reference images) even though the card still holds them,
  // which otherwise renders every optional row as "—".
  const summaryValue = (f) => {
    const rv = result?.values?.[f.key];
    const empty =
      rv == null ||
      (typeof rv === 'string' && rv.trim() === '') ||
      (Array.isArray(rv) && rv.length === 0);
    return empty ? values[f.key] : rv;
  };

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
    const costs = creditCostsForQuality;
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
  }, [values, creditCostsForQuality, form.estimated_credits]);

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
      // `regenerate` when the brief was already submitted once — tells the backend
      // to force a fresh generation instead of replying about the prior result.
      await onSubmit?.({ formId: form.form_id, values: agentValues, regenerate: isSubmitted });
      setEditing(false); // collapse back to the summary after a (re)generation
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mt-3 w-full overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0F0F0F]">
      {/* Header — double-click to collapse/expand the brief. */}
      <div
        onDoubleClick={() => setCollapsed((c) => !c)}
        title={collapsed ? 'Double-click to expand' : 'Double-click to collapse'}
        className="flex cursor-pointer items-start justify-between gap-3 border-b border-white/[0.05] bg-gradient-to-b from-white/[0.03] to-transparent px-4 py-3 select-none"
      >
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
          {form.subtitle && !collapsed && (
            <p className="mt-0.5 text-[12px] leading-relaxed text-white/55">
              {form.subtitle}
            </p>
          )}
        </div>
        {/* Single-click fallback for collapse — double-click on some devices /
            after text focus is easy to miss, so the chevron always toggles too. */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setCollapsed((c) => !c);
          }}
          aria-expanded={!collapsed}
          title={collapsed ? 'Expand' : 'Collapse'}
          className="mt-0.5 shrink-0 rounded-md p-1 text-white/45 transition-colors hover:bg-white/[0.07] hover:text-white"
        >
          <ChevronDown
            className={`h-4 w-4 transition-transform ${collapsed ? '-rotate-90' : ''}`}
          />
        </button>
      </div>

      {!collapsed && (
      <>
      {/* Fields — two-column grid; wide controls span both columns. */}
      <div className="grid grid-cols-1 gap-x-3 gap-y-3.5 px-4 py-4 sm:grid-cols-2">
        {formHasBrandFields(form) && (
          <BrandPicker
            form={form}
            values={values}
            disabled={isLocked}
            onPick={(patch) => setValues((prev) => ({ ...prev, ...patch }))}
          />
        )}
        {(form.fields || []).map((field) => {
          const model = isModelField(field);
          const qualityCosts =
            field.key === 'quality'
              ? form.credit_costs_by_quality?.[values.model || 'auto']
              : null;
          const renderedField =
            qualityCosts && Object.keys(qualityCosts).length > 0
              ? {
                  ...field,
                  options: normaliseOptions(field.options).filter(
                    (option) => qualityCosts[option.value] != null,
                  ),
                }
              : field;
          const Renderer = model ? ModelSelectField : FIELD_RENDERERS[field.type] || TextField;
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
                    <Tip content={field.tooltip}>
                      <span className="cursor-help text-white/35 hover:text-white/70">
                        <Info className="h-3 w-3" />
                      </span>
                    </Tip>
                  )}
                </label>
                {field.description && (
                  <span className="text-[11px] text-white/40">{field.description}</span>
                )}
              </div>
              <Renderer
                field={renderedField}
                value={values[field.key]}
                onChange={(v) => setField(field.key, v)}
                disabled={isLocked}
                creditCosts={model ? creditCostsForQuality : undefined}
              />
            </div>
          );
        })}

        {/* Total-images notice — always shown (even for a single image) so the
            user can confirm the output count before firing. Red when >1 image
            so a multi-image spend isn't mistaken for the per-ratio count. */}
        <p
          className={`sm:col-span-2 -mt-1 flex items-center gap-1.5 text-[11.5px] font-medium ${
            creditInfo.totalImages > 1 ? 'text-red-400/90' : 'text-white/55'
          }`}
        >
          <Info className="h-3.5 w-3.5 shrink-0" />
          {creditInfo.isPack ? (
            <span>
              Ad pack: generating {creditInfo.totalImages} image
              {creditInfo.totalImages > 1 ? 's' : ''} in total (3 variants ×{' '}
              {creditInfo.ratios} ratio{creditInfo.ratios > 1 ? 's' : ''}).
            </span>
          ) : (
            <span>
              Generating {creditInfo.totalImages} image
              {creditInfo.totalImages > 1 ? 's' : ''} in total — {creditInfo.perRatio} per
              ratio × {creditInfo.ratios} ratio{creditInfo.ratios > 1 ? 's' : ''}.
            </span>
          )}
        </p>
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
                {f.label || f.key}: {formatValueLabel(f, summaryValue(f))}
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
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <div className="flex min-w-0 flex-col gap-1">
              {/* Credit + image-count summary lives here (next to Generate) so the
                  user can confirm exactly what they'll spend — and on how many
                  images across how many ratios — right before firing. */}
              {creditInfo.totalCredits != null && (
                <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11.5px]">
                  <span className="inline-flex items-center gap-1 font-semibold text-white/90">
                    <Sparkles className="h-3.5 w-3.5 text-[#15DCFF]" />
                    ~{creditInfo.totalCredits} credits
                  </span>
                  {/* Image count intentionally NOT repeated here — it's already
                      shown in the "Generating N images" notice above the footer. */}
                </span>
              )}
              <span
                className={`text-[11px] ${validationError ? 'text-amber-400/90' : 'text-white/40'}`}
              >
                {validationError
                  ? validationError
                  : isSubmitted
                    ? 'Tweak anything, then regenerate.'
                    : 'You can change anything before submitting.'}
              </span>
            </div>
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
      </>
      )}
    </div>
  );
};

export default ChoiceForm;
