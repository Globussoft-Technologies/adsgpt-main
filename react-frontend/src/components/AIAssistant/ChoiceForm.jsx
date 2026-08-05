import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
  Proportions,
  LayoutGrid,
  Upload,
  Link2,
  Images,
} from 'lucide-react';
import toast from 'react-hot-toast';
// The brief's ratio control IS the Ad Studio → Ad Creatives one — imported
// rather than reimplemented so the two surfaces can't drift apart.
import AspectRatioTiles from '@/components/AdStudio/AdCreativeNew/AspectRatioPicker';

import { submitAssistantChoiceForm } from '@/store/reducers/aiAssistant/aiAssistantSlice';
import { fetchBrands, analazeDomain } from '@/store/actions/brandIQ/myBrandActions';
import { useAdCreativeConfig } from '@/utils/hooks/useAdCreativeConfig';
import {
  applyBrandToPrompt,
  applyCreativeTypeToPrompt,
  buildCreditCostsByQuality,
  buildModelConfigs,
} from './briefCatalog';
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

// ─── Aspect ratios ⇄ per-ratio counts ───────────────────────────────────────
// The card now drives the Ad Studio tiles, whose value is a per-ratio counts
// map. The submitted contract still carries `aspect_ratios[]` + `num_images`
// (plus the exact `aspect_ratio_counts`), so briefs saved before this control
// existed still open correctly and the backend keeps a usable fallback.
const ratiosFromCounts = (counts) =>
  Object.keys(counts || {}).filter((key) => (counts[key] || 0) > 0);

// Legacy `num_images` means "this many for EVERY selected ratio", so the max is
// the only lossless single number; the explicit counts are what the backend
// actually generates from.
const numImagesFromCounts = (counts) => {
  const values = ratiosFromCounts(counts).map((key) => counts[key]);
  return values.length ? Math.max(...values) : 1;
};

// Rebuild the counts map from whatever a brief already holds — the tiles are
// the only editor now, so an older brief's ratios[] + num_images has to be
// projected onto it (each selected ratio gets num_images).
const countsFromValues = (values) => {
  const existing = values?.aspect_ratio_counts;
  if (existing && typeof existing === 'object' && !Array.isArray(existing)) return existing;
  const raw = values?.aspect_ratios;
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const per = Math.max(1, Number(values?.num_images) || 1);
  const out = {};
  list.forEach((ratio) => {
    out[String(ratio)] = per;
  });
  return out;
};

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

// ─── Dropdown shell ─────────────────────────────────────────────────────────
// Shared trigger + menu for the model and aspect-ratio pickers. These mirror
// Ad Studio → Ad Creatives: a rounded pill you click to open a floating panel,
// with the same fills, radii and shadow.
//
// One necessary deviation from Ad Studio: the menu is portalled to <body> and
// positioned `fixed` from the trigger's rect. Ad Studio's pills sit in a static
// bar and can use `absolute bottom-full`, but the brief's fields grid scrolls
// internally and the card is a backdrop-blurred glass panel — either would clip
// an absolutely positioned menu. This is exactly why Ad Studio's own
// AspectRatioTiles quantity menu is portalled too.
const DROPDOWN_MIN_W = 200;

const DropdownShell = ({
  trigger,
  disabled,
  ariaLabel,
  estHeight = 260,
  menuWidth,
  panel = false, // true → a padded panel (tiles) rather than a list of rows
  triggerClassName, // override the pill styling (e.g. the image "Add" tile)
  hideChevron = false,
  children,
}) => {
  // menu: { left, top?, bottom?, width, below } — null when fully closed.
  const [menu, setMenu] = useState(null);
  const [visible, setVisible] = useState(false); // drives the open/close animation
  const btnRef = useRef(null);
  const menuRef = useRef(null);
  const closeTimer = useRef(null);

  const close = () => {
    setVisible(false);
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setMenu(null), 160); // matches exit duration
  };

  const open = () => {
    const el = btnRef.current;
    if (!el) return;
    clearTimeout(closeTimer.current);
    const r = el.getBoundingClientRect();
    const width = menuWidth || Math.max(r.width, DROPDOWN_MIN_W);
    // Prefer opening downward; flip up when the viewport can't take the menu.
    const below = r.bottom + estHeight + 8 <= window.innerHeight;
    setMenu({
      width,
      left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)),
      top: below ? r.bottom + 6 : undefined,
      bottom: below ? undefined : window.innerHeight - r.top + 6,
      below,
    });
    // Double rAF so the closed state paints first — otherwise the enter
    // transition is skipped and the menu just pops in.
    requestAnimationFrame(() => requestAnimationFrame(() => setVisible(true)));
  };

  // Close on outside click, Escape, and scroll/resize (a fixed position would
  // otherwise go stale as the fields grid scrolls under it).
  useEffect(() => {
    if (!menu) return undefined;
    const onDown = (e) => {
      if (btnRef.current?.contains(e.target) || menuRef.current?.contains(e.target)) return;
      // AspectRatioTiles portals its per-ratio quantity menu to <body>, so it is
      // not a DOM descendant of ours — without this, choosing a quantity would
      // count as an outside click and shut the whole panel.
      if (e.target?.closest?.('[data-aspect-quantity-menu]')) return;
      close();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') close();
    };
    const onResize = () => close();
    // Closing on scroll keeps the fixed position from going stale — but the
    // tiles grid scrolls INSIDE the menu, and that must not close it.
    const onScroll = (e) => {
      if (menuRef.current?.contains(e.target)) return;
      close();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [menu]);

  useEffect(() => () => clearTimeout(closeTimer.current), []);

  const isOpen = !!menu;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => (isOpen ? close() : open())}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={ariaLabel}
        className={
          triggerClassName ||
          `flex h-9 w-full items-center justify-between gap-2 rounded-full bg-[#2b2a2a]/80 px-3.5 text-left ring-1 transition-colors hover:bg-[#33333a] disabled:cursor-not-allowed disabled:opacity-60 ${
            isOpen ? 'ring-white/25' : 'ring-white/5'
          }`
        }
      >
        {trigger}
        {!hideChevron && (
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-white/40 transition-transform ${
              isOpen ? 'rotate-180' : ''
            }`}
            strokeWidth={2}
          />
        )}
      </button>

      {menu &&
        createPortal(
          <div
            ref={menuRef}
            role="listbox"
            style={{
              position: 'fixed',
              left: menu.left,
              top: menu.top,
              bottom: menu.bottom,
              width: menu.width,
              maxHeight: estHeight,
            }}
            className={`subtle-scroll dark pointer-events-auto z-[80] overflow-y-auto bg-[#1f1f1f] shadow-2xl ring-1 ring-white/10 transition-all duration-150 ease-out will-change-transform ${
              // `dark` above: the Ad Studio panel we host is theme-aware, but the
              // assistant card is always dark — without this it renders its light
              // variant whenever the app is in light mode.
              panel ? 'rounded-[20px] p-4' : 'rounded-[18px] py-1'
            } ${menu.below ? 'origin-top' : 'origin-bottom'} ${
              visible
                ? 'translate-y-0 scale-100 opacity-100'
                : `${menu.below ? '-translate-y-1' : 'translate-y-1'} scale-95 opacity-0`
            }`}
          >
            {children({ close })}
          </div>,
          document.body,
        )}
    </>
  );
};

// Friendly model picker: a dropdown whose rows each show the model's per-image
// credit cost inline (a badge), so users can compare what each model costs
// before choosing. The cost also rides on the closed trigger.
// `creditCosts` is the form's { model: creditsPerImage, auto: … } map.
const ModelSelectField = ({ field, value, onChange, disabled, creditCosts }) => {
  const opts = normaliseOptions(field.options);
  const costFor = (v) => {
    if (!creditCosts) return null;
    if (Object.prototype.hasOwnProperty.call(creditCosts, v)) return creditCosts[v];
    return creditCosts.auto ?? null;
  };
  const selected = opts.find((o) => o.value === value);
  const selectedCost = selected ? costFor(selected.value) : null;

  return (
    <DropdownShell
      disabled={disabled}
      ariaLabel={`Model: ${selected?.label || 'none selected'}`}
      trigger={
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate text-[13px] text-white/90">
            {selected?.label || 'Select a model'}
          </span>
          {selectedCost != null && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-white/10 bg-white/[0.06] px-2 py-0.5 text-[10.5px] font-semibold text-white/75">
              <Sparkles className="h-2.5 w-2.5 text-[#15DCFF]" />
              {selectedCost} cr/img
            </span>
          )}
        </span>
      }
    >
      {({ close }) =>
        opts.map((o) => {
          const isOn = value === o.value;
          const cost = costFor(o.value);
          return (
            <button
              key={String(o.value)}
              type="button"
              role="option"
              aria-selected={isOn}
              title={
                cost != null
                  ? `${o.label}: ${cost} credit${cost === 1 ? '' : 's'} per image`
                  : o.label
              }
              onClick={() => {
                onChange(o.value);
                close();
              }}
              className={`flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-[13px] transition-colors ${
                isOn
                  ? 'bg-[#373839] text-white'
                  : 'text-white/80 hover:bg-white/5 hover:text-white'
              }`}
            >
              <span className="flex min-w-0 items-center gap-2">
                <span
                  className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border ${
                    isOn ? 'border-white' : 'border-white/30'
                  }`}
                >
                  {isOn && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                </span>
                <span className="truncate">{o.label}</span>
              </span>
              {cost != null && (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-white/10 bg-white/[0.06] px-2 py-0.5 text-[10.5px] font-semibold text-white/75">
                  <Sparkles className="h-2.5 w-2.5 text-[#15DCFF]" />
                  {cost} cr/img
                </span>
              )}
            </button>
          );
        })
      }
    </DropdownShell>
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

// Aspect ratios — the Ad Studio → Ad Creatives control, reused wholesale.
// `AspectRatioTiles` owns the visual ratio frames and the per-ratio quantity
// menu; the trigger below is the same "N Images" pill Ad Studio shows.
//
// Value is the per-ratio counts map ({ '1:1': 2, '9:16': 1 }). ChoiceForm keeps
// `aspect_ratios` / `num_images` in sync off it so the submitted contract is
// unchanged for briefs that predate this control.
const AspectRatioCountsField = ({ field, value, onChange, disabled, creditsPerImage }) => {
  const ratios = normaliseOptions(field.options).map((o) => String(o.value));
  const counts = value && typeof value === 'object' ? value : {};
  const total = ratios.reduce((sum, key) => sum + (counts[key] || 0), 0);

  return (
    <DropdownShell
      disabled={disabled}
      menuWidth={300}
      panel
      estHeight={380}
      ariaLabel={`Aspect ratios — ${total} image${total === 1 ? '' : 's'}`}
      trigger={
        <span className="flex min-w-0 flex-1 items-center gap-2 text-white/85">
          <Proportions className="h-4 w-4 shrink-0 text-white/70" strokeWidth={1.8} />
          <span className="h-3 w-px shrink-0 bg-white/20" />
          <LayoutGrid className="h-3 w-3 shrink-0 text-white/50" strokeWidth={1.8} />
          <span className="truncate text-[13px]">
            {total} Image{total === 1 ? '' : 's'}
          </span>
        </span>
      }
    >
      {() => (
        <AspectRatioTiles
          counts={counts}
          onChange={onChange}
          ratios={ratios}
          creditsPerImage={creditsPerImage ?? 0}
        />
      )}
    </DropdownShell>
  );
};

// Multi-select pills — the generic `checkbox` renderer. `aspect_ratios` no
// longer uses it (see AspectRatioCountsField); kept for any other multi-select
// field the agent emits.
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
// Images already saved on the user's brands, so a reference image or logo can be
// picked instead of re-uploaded. Field spellings vary by endpoint — same
// tolerance as the agent's brand normaliser (Agent/src/utils/brand.py).
const brandLogosOf = (b) =>
  [
    ...(Array.isArray(b?.logoUrls) ? b.logoUrls : []),
    b?.brandLogo,
    b?.logoUrl,
    b?.logo,
    b?.iconUrl,
  ].filter(Boolean);
const brandProductImagesOf = (b) =>
  [
    ...(Array.isArray(b?.imageUrl) ? b.imageUrl : b?.imageUrl ? [b.imageUrl] : []),
    ...(Array.isArray(b?.imageUrls) ? b.imageUrls : []),
    ...(Array.isArray(b?.brandImages) ? b.brandImages : []),
  ].filter(Boolean);

const ImageUploadField = ({ field, value, onChange, disabled, brandName }) => {
  // Drop empty/whitespace-URL items at render: an <img src=""> does NOT reliably
  // fire onError in Chromium, so a blank entry would show a permanent broken box
  // that the onError→removeAt path can never clear (BUG 8).
  const arr = (Array.isArray(value) ? value.map(asImgItem) : value ? [asImgItem(value)] : [])
    .filter((it) => it && it.url && String(it.url).trim());
  const [uploading, setUploading] = useState(false);
  // Full-screen preview (double-click / double-tap a thumbnail).
  const [preview, setPreview] = useState(null);
  // The "Add" tile offers three sources; these drive the two that need their
  // own inline UI (the third just opens the OS file picker).
  const [urlOpen, setUrlOpen] = useState(false);
  const [urlDraft, setUrlDraft] = useState('');
  const [brandOpen, setBrandOpen] = useState(false);
  const fileInputRef = useRef(null);
  const userId = useSelector((s) => s.socket?.userData?.user_id);
  const brands = useSelector((s) => s.brandIQTabs?.myBrands) || [];
  const maxFiles = field.maxFiles || 5;
  const selectedCount = arr.filter(isImgSelected).length;
  const isLogoField = field.key === 'brand_logo';

  // Offer the images of the brand the brief is actually about; fall back to
  // every saved brand's images when nothing is chosen yet, so the option is
  // never an empty panel.
  const brandImages = useMemo(() => {
    const wanted = (brandName || '').trim().toLowerCase();
    const matched = wanted
      ? brands.filter((b) => (b?.name || '').trim().toLowerCase() === wanted)
      : [];
    const pool = matched.length ? matched : brands;
    const urls = pool.flatMap((b) => (isLogoField ? brandLogosOf(b) : brandProductImagesOf(b)));
    return [...new Set(urls.map(String).filter((u) => u.trim()))];
  }, [brands, brandName, isLogoField]);

  const addImages = (urls) => {
    const existing = new Set(arr.map((it) => it.url));
    const fresh = urls
      .filter((u) => u && !existing.has(u))
      .map((u) => ({ url: u, filename: u.split('/').pop() || 'image', selected: true }));
    if (!fresh.length) return;
    onChange([...arr, ...fresh].slice(0, maxFiles));
  };

  const addByUrl = () => {
    const raw = urlDraft.trim();
    try {
      const parsed = new URL(raw);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
    } catch {
      toast.error('Enter a valid public http(s) image URL.');
      return;
    }
    addImages([raw]);
    setUrlDraft('');
    setUrlOpen(false);
  };
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
          <DropdownShell
            menuWidth={232}
            estHeight={160}
            ariaLabel="Add an image"
            hideChevron
            triggerClassName="flex h-16 w-16 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-white/15 text-white/45 hover:border-white/40 hover:text-white/70"
            trigger={
              <>
                {uploading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                <span className="text-[9px]">{uploading ? 'Uploading' : 'Add'}</span>
              </>
            }
          >
            {({ close }) => (
              <>
                <button
                  type="button"
                  onClick={() => {
                    close();
                    fileInputRef.current?.click();
                  }}
                  className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-[13px] text-white/80 transition-colors hover:bg-white/5 hover:text-white"
                >
                  <Upload className="h-3.5 w-3.5 shrink-0 text-white/50" />
                  Upload from your computer
                </button>
                <button
                  type="button"
                  onClick={() => {
                    close();
                    setBrandOpen(false);
                    setUrlOpen(true);
                  }}
                  className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-[13px] text-white/80 transition-colors hover:bg-white/5 hover:text-white"
                >
                  <Link2 className="h-3.5 w-3.5 shrink-0 text-white/50" />
                  Paste an image URL
                </button>
                <button
                  type="button"
                  onClick={() => {
                    close();
                    setUrlOpen(false);
                    setBrandOpen(true);
                  }}
                  className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-[13px] text-white/80 transition-colors hover:bg-white/5 hover:text-white"
                >
                  <Images className="h-3.5 w-3.5 shrink-0 text-white/50" />
                  <span className="flex-1">Choose brand image</span>
                  <span className="text-[11px] text-white/40">{brandImages.length}</span>
                </button>
              </>
            )}
          </DropdownShell>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple={maxFiles > 1}
          onChange={onPick}
          className="hidden"
        />
      </div>

      {urlOpen && !disabled && (
        <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/30 p-1.5">
          <Link2 className="ml-1 h-3.5 w-3.5 shrink-0 text-white/45" />
          <input
            type="url"
            value={urlDraft}
            autoFocus
            onChange={(e) => setUrlDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addByUrl();
              } else if (e.key === 'Escape') {
                setUrlOpen(false);
              }
            }}
            placeholder="https://example.com/image.png"
            className="min-w-0 flex-1 bg-transparent text-[12px] text-white outline-none placeholder:text-white/35"
          />
          <button
            type="button"
            onClick={addByUrl}
            disabled={!urlDraft.trim()}
            className="inline-flex h-6 items-center rounded-full bg-white px-2.5 text-[11px] font-semibold text-black hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Add
          </button>
          <button
            type="button"
            onClick={() => setUrlOpen(false)}
            aria-label="Close image URL input"
            className="flex h-6 w-6 items-center justify-center rounded-full text-white/45 hover:bg-white/10 hover:text-white"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {brandOpen && !disabled && (
        <div className="rounded-lg border border-white/10 bg-black/30 p-2">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[11px] font-medium text-white/70">
              {isLogoField ? 'Saved brand logos' : 'Saved brand images'}
            </span>
            <button
              type="button"
              onClick={() => setBrandOpen(false)}
              aria-label="Close brand images"
              className="flex h-5 w-5 items-center justify-center rounded-full text-white/45 hover:bg-white/10 hover:text-white"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
          {brandImages.length === 0 ? (
            <p className="px-0.5 py-1 text-[11px] text-white/40">
              No saved {isLogoField ? 'logos' : 'images'} on your brands yet.
            </p>
          ) : (
            <div className="flex max-h-[132px] flex-wrap gap-2 overflow-y-auto">
              {brandImages.map((url) => {
                const already = arr.some((it) => it.url === url);
                return (
                  <button
                    key={url}
                    type="button"
                    onClick={() => addImages([url])}
                    disabled={already}
                    title={already ? 'Already added' : 'Add this image'}
                    className={`h-14 w-14 overflow-hidden rounded-lg border-2 transition-all ${
                      already
                        ? 'cursor-not-allowed border-white/40 opacity-40'
                        : 'border-transparent hover:border-white/50'
                    }`}
                  >
                    <img
                      src={toDisplaySrc(url)}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
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

// Fields that always span both grid columns (their controls are wide). The
// model picker used to be a full-height list of rows and needed the full width;
// now that it's a dropdown it sits fine in one column beside Quality.
const FULL_WIDTH_TYPES = new Set(['textarea', 'image_upload', 'image_picker']);
const isFullWidth = (field) => !!field.fullWidth || FULL_WIDTH_TYPES.has(field.type);

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
// Every field a brand switch re-derives — brand-owned data plus the fields that
// describe the brand's product. Switching brands used to swap only the four
// BRAND_FIELD_KEYS, leaving the OLD brand's product images and its name inside
// the prompt, so the brief still generated the previous brand's creative.
const BRAND_DERIVED_KEYS = [
  'brand_name',
  'brand_description',
  'brand_logo',
  'brand_colors',
  'product',
  'reference_images',
  'prompt',
];

// Prompt retargeting (brand + creative type) lives in ./briefCatalog — pure,
// and exercised on its own. Deterministic by design: no model call, so the
// result is predictable and "restore previous" undoes it.
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
    BRAND_DERIVED_KEYS.forEach((k) => {
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
    const nextName = (b.name || '').trim();
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
    // The rest of the brief has to follow the brand too, or the card still
    // describes (and generates) the previous one.
    if (fieldKeys.has('product')) {
      // Only when Product was just the old brand's name — a real product
      // ("running shoes") is the user's own wording and must survive.
      const product = (values.product || '').trim();
      if (!product || product.toLowerCase() === currentName.toLowerCase()) {
        patch.product = nextName;
      }
    }
    if (fieldKeys.has('reference_images')) {
      // Replace, don't merge: the outgoing brand's product photos are exactly
      // what shouldn't feed the new brand's creative.
      const images = brandProductImagesOf(b);
      patch.reference_images = images.map((url, i) => ({
        url,
        filename: url.split('/').pop() || 'image',
        selected: i === 0,
      }));
    }
    if (fieldKeys.has('prompt')) {
      // Feed every name the outgoing brand might appear under: the card's
      // brand_name, and the saved record it matched (they can differ).
      patch.prompt = applyBrandToPrompt(
        values.prompt,
        [currentName, matched?.name || ''],
        nextName,
        values.creative_type,
      );
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
      // The scrape returns the site's imagery too, and we were throwing it away
      // — a brand added from a website ended up with empty Product Images and
      // Logo even though the response carried them. Same filtering BrandIQ's
      // onboarding applies: drop broken URLs and SVGs (icons, not product shots).
      const scraped = (Array.isArray(res?.images) ? res.images : []).filter(
        (u) => typeof u === 'string' && u && !u.includes('undefined') && !u.endsWith('.svg'),
      );
      if (fieldKeys.has('reference_images') && scraped.length) {
        patch.reference_images = scraped.slice(0, 5).map((url, i) => ({
          url,
          filename: url.split('/').pop() || 'image',
          selected: i === 0,
        }));
      }
      // Not every scrape identifies a logo; only set the field when it did.
      const scrapedLogo = res?.logo || res?.logoUrl || res?.meta?.logo || res?.favicon || '';
      if (fieldKeys.has('brand_logo') && scrapedLogo) {
        patch.brand_logo = [{ url: scrapedLogo, filename: 'logo', selected: true }];
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
  // Model / quality / aspect-ratio catalogue.
  //
  // Prefer the surface the BROWSER fetches (`useAdCreativeConfig` →
  // /usage/model-credit-value), which is the exact source Ad Studio and the
  // Profile credit table read. The agent also inlines this on the form, but
  // that path goes through the secret-gated /credits/models endpoint and
  // returns NOTHING on any failure — when that happened the card silently fell
  // back to the MCP's hardcoded options, so credits stopped varying by quality
  // and every model showed the same aspect ratios. That mismatch with Profile
  // is the bug; reading the same endpoint as Profile is the fix. The inlined
  // copy stays as the fallback for when the browser fetch is the one that fails.
  const { models: surfaceModels } = useAdCreativeConfig();
  const modelConfigs = useMemo(
    () => buildModelConfigs(surfaceModels, form.ad_creative_models),
    [surfaceModels, form.ad_creative_models],
  );
  const creditCostsByQuality = useMemo(
    () => buildCreditCostsByQuality(modelConfigs, surfaceModels, form.credit_costs_by_quality),
    [modelConfigs, surfaceModels, form.credit_costs_by_quality],
  );
  const modelConfigByValue = useMemo(
    () => new Map(modelConfigs.map((config) => [config.value, config])),
    [modelConfigs],
  );

  const isSubmitted = !!result;
  // After submitting, the card collapses to a summary — but the user can reopen
  // it ("Edit & regenerate"), tweak values, and fire a fresh generation. So the
  // lock only applies while collapsed (or disabled / mid-submit), not forever.
  const isLocked = (isSubmitted && !editing) || disabled || submitting;

  const setField = (key, val) =>
    setValues((prev) => {
      const next = { ...prev, [key]: val };
      // The tiles edit the counts map; keep the legacy pair derived from it so
      // validation, the summary and the submitted payload all stay consistent.
      if (key === 'aspect_ratio_counts') {
        next.aspect_ratios = ratiosFromCounts(val);
        next.num_images = numImagesFromCounts(val);
      }
      // Switching creative type has to be reflected in the brief itself, not
      // just in which tool ends up being called.
      if (key === 'creative_type' && prev.prompt) {
        next.prompt = applyCreativeTypeToPrompt(prev.prompt, val, prev.brand_name);
      }
      if (key === 'model') {
        const costs = creditCostsByQuality?.[val];
        const currentQuality = prev.quality === 'standard' ? 'medium' : prev.quality;
        if (costs && costs[currentQuality] == null) {
          next.quality =
            costs.high != null ? 'high' : Object.keys(costs)[0] || currentQuality || 'high';
        }
        const allowedRatios = modelConfigByValue.get(val)?.aspect_ratios;
        if (Array.isArray(allowedRatios) && allowedRatios.length) {
          // Models support different ratio sets — carry the per-ratio counts
          // the new model still supports, and fall back to one square image.
          const prevCounts = countsFromValues(prev);
          const kept = {};
          allowedRatios.forEach((ratio) => {
            if (prevCounts[ratio] > 0) kept[ratio] = prevCounts[ratio];
          });
          const counts = Object.keys(kept).length
            ? kept
            : { [allowedRatios.includes('1:1') ? '1:1' : allowedRatios[0]]: 1 };
          next.aspect_ratio_counts = counts;
          next.aspect_ratios = ratiosFromCounts(counts);
          next.num_images = numImagesFromCounts(counts);
        }
      }
      return next;
    });

  // Reconcile older/persisted briefs when the live Ad Creative catalog arrives:
  // a removed model, quality, or ratio must not remain hidden in state and still
  // influence the displayed total or submitted generation request.
  useEffect(() => {
    if (!modelConfigs.length) return;
    setValues((prev) => {
      const next = { ...prev };
      let changed = false;
      const model = modelConfigByValue.has(prev.model) ? prev.model : 'auto';
      if (model !== prev.model) {
        next.model = model;
        changed = true;
      }

      const qualityCosts = creditCostsByQuality?.[model];
      const quality = prev.quality === 'standard' ? 'medium' : prev.quality;
      if (qualityCosts && qualityCosts[quality] == null) {
        next.quality =
          qualityCosts.high != null ? 'high' : Object.keys(qualityCosts)[0] || 'high';
        changed = true;
      }

      const allowedRatios = modelConfigByValue.get(model)?.aspect_ratios;
      if (Array.isArray(allowedRatios) && allowedRatios.length) {
        const prevCounts = countsFromValues(prev);
        const kept = {};
        allowedRatios.forEach((ratio) => {
          if (prevCounts[ratio] > 0) kept[ratio] = prevCounts[ratio];
        });
        const counts = Object.keys(kept).length
          ? kept
          : { [allowedRatios.includes('1:1') ? '1:1' : allowedRatios[0]]: 1 };
        const sameAsBefore =
          prev.aspect_ratio_counts &&
          Object.keys(counts).length === Object.keys(prevCounts).length &&
          Object.keys(counts).every((ratio) => counts[ratio] === prevCounts[ratio]);
        if (!sameAsBefore) {
          next.aspect_ratio_counts = counts;
          next.aspect_ratios = ratiosFromCounts(counts);
          next.num_images = numImagesFromCounts(counts);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [creditCostsByQuality, modelConfigByValue, modelConfigs.length]);

  const creditCostsForQuality = useMemo(() => {
    const tiered = creditCostsByQuality;
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
  }, [form.credit_costs, creditCostsByQuality, values.quality]);

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
    // Per-ratio counts are authoritative — the tiles can ask for 2×1:1 and
    // 1×9:16, which a single "per ratio" number can't express.
    const counts = countsFromValues(values);
    const selected = ratiosFromCounts(counts);
    const ratios = Math.max(1, selected.length);
    const countTotal = selected.reduce((sum, key) => sum + counts[key], 0);
    const perRatio = isPack ? 3 : Math.max(1, Number(values.num_images) || 1);
    const totalImages = isPack ? perRatio * ratios : Math.max(1, countTotal);
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

  // No card chrome of its own (no border/rounded corners/separate fill) —
  // GenCanvas's own panel is already the glass surface; a second nested card
  // on top of it just reads as two stacked boxes. This is content sections
  // within that one panel, divided by thin border lines, not a card-in-card.
  //
  // Expanded, it fills GenCanvas's available height so the fields grid
  // (below) can scroll internally while this header and the footer (credits +
  // image count + Generate) stay pinned in view — no scrolling to find
  // Generate. Collapsed, it shrinks back to just the header row.
  return (
    <div
      className={`mt-3 flex w-full flex-col ${collapsed ? '' : 'h-full min-h-0'}`}
    >
      {/* Header — double-click to collapse/expand the brief. */}
      <div
        onDoubleClick={() => setCollapsed((c) => !c)}
        title={collapsed ? 'Double-click to expand' : 'Double-click to collapse'}
        className="flex shrink-0 cursor-pointer items-start justify-between gap-3 border-b border-white/[0.05] bg-gradient-to-b from-white/[0.03] to-transparent px-4 py-3 select-none"
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
      {/* Fields — two-column grid; wide controls span both columns. Scrolls
          internally (min-h-0 + flex-1 on a flex-col parent) so the footer
          below never needs a scroll to reach. */}
      <div className="subtle-scroll grid min-h-0 flex-1 grid-cols-1 gap-x-3 gap-y-3.5 overflow-y-auto px-4 py-4 sm:grid-cols-2">
        {formHasBrandFields(form) && (
          <BrandPicker
            form={form}
            values={values}
            disabled={isLocked}
            onPick={(patch) => setValues((prev) => ({ ...prev, ...patch }))}
          />
        )}
        {(form.fields || []).map((field) => {
          // The ratio tiles carry a per-ratio quantity, so the separate "how
          // many per ratio" stepper has nothing left to say — same as Ad Studio,
          // which has no such control. Its value is still derived and submitted.
          if (field.key === 'num_images') return null;
          const model = isModelField(field);
          const isRatios = field.key === 'aspect_ratios';
          const qualityCosts =
            field.key === 'quality'
              ? creditCostsByQuality?.[values.model || 'auto']
              : null;
          const selectedModelConfig = modelConfigByValue.get(values.model || 'auto');
          let renderedField = field;
          if (model && modelConfigs.length) {
            renderedField = {
              ...renderedField,
              options: modelConfigs.map(({ value, label }) => ({ value, label })),
            };
          } else if (
            field.key === 'aspect_ratios' &&
            Array.isArray(selectedModelConfig?.aspect_ratios) &&
            selectedModelConfig.aspect_ratios.length
          ) {
            renderedField = {
              ...renderedField,
              options: selectedModelConfig.aspect_ratios,
            };
          } else if (qualityCosts && Object.keys(qualityCosts).length > 0) {
            renderedField = {
              ...renderedField,
              options: normaliseOptions(renderedField.options).filter(
                (option) => qualityCosts[option.value] != null,
              ),
            };
          }
          const Renderer = model
            ? ModelSelectField
            : isRatios
              ? AspectRatioCountsField
              : FIELD_RENDERERS[field.type] || TextField;
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
                value={isRatios ? countsFromValues(values) : values[field.key]}
                onChange={(v) => setField(isRatios ? 'aspect_ratio_counts' : field.key, v)}
                disabled={isLocked}
                creditCosts={model ? creditCostsForQuality : undefined}
                creditsPerImage={isRatios ? creditInfo.perImage : undefined}
                // Lets the image fields offer THIS brand's saved images first.
                brandName={field.type === 'image_upload' ? values.brand_name : undefined}
              />
            </div>
          );
        })}
      </div>

      {/* Footer — submit OR submitted summary. Pinned outside the scrolling
          fields grid (shrink-0 on a flex-col parent) so credits, image count,
          and Generate are always visible without scrolling. */}
      <div className="shrink-0 border-t border-white/[0.05] bg-black/30 px-4 py-3">
        {/* Total-images notice — shown regardless of submitted state (unlike
            the credit badge/Generate row below), so it stays visible even
            after the brief collapses to its "Submitted with" summary. Red
            when >1 image so a multi-image spend isn't mistaken for the
            per-ratio count. */}
        <p
          className={`mb-2 flex items-center gap-1.5 text-[11.5px] font-medium ${
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
              {creditInfo.totalImages > 1 ? 's' : ''} in total across {creditInfo.ratios}{' '}
              ratio{creditInfo.ratios > 1 ? 's' : ''}.
            </span>
          )}
        </p>
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
              {/* Credit total lives here, pinned next to Generate, so the
                  user can confirm exactly what they'll spend right before
                  firing. Image count is the persistent notice above. */}
              {creditInfo.totalCredits != null && (
                // Exact, live figure — matches Ad Studio's confident credit
                // badge (no "~" hedge; it recomputes instantly from the same
                // live per-model/quality registry Ad Studio reads).
                <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-white/[0.08] px-3 py-1 text-[12px] font-semibold text-white/90">
                  <Sparkles className="h-3.5 w-3.5 text-[#15DCFF]" />
                  {creditInfo.totalCredits} credits
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
