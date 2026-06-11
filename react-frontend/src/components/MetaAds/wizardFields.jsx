/**
 * Reusable form-field primitives for CreateCampaignWizardV2.
 *
 * Each component owns no application state — the parent passes `value` and
 * gets `onChange(newValue)` back. Explicit, easy to wire.
 *
 * Visual language matches V1 (CreateCampaignWizard.jsx) exactly so the two
 * wizards feel like the same product:
 *   - Pill inputs (`rounded-full`), translucent `#909294/15` fill
 *   - Brand gradient `#02C8C4 → #5867EB` for primary/active surfaces
 *   - Portaled `SelectField` with framer-motion + rotating chevron + check
 *     on selected row (replaces native `<select>`)
 *   - Toggle uses the brand gradient when ON
 *   - `SegButton` (segmented control), `GradientCheckbox`, `DateTimePicker`
 *     lifted from V1 so V2 doesn't ship native-browser fallbacks
 *   - `LaunchErrorBanner` for consistent dismissible Meta-error display
 *
 * V1 keeps its inline copies for now; once V2 cutover ships, V1 can import
 * from here too (or be deleted entirely).
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSelector } from 'react-redux';
// eslint-disable-next-line no-unused-vars
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertCircle,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  X,
} from 'lucide-react';
import { Calendar } from 'react-date-range';
import 'react-date-range/dist/styles.css';
import 'react-date-range/dist/theme/default.css';
import { globalToast } from '@/utils/globalToast';

// ─── media validation ────────────────────────────────────────────────────────
// The HTML `accept` attribute is a UX hint — browsers still let the user
// pick "All files" and submit anything (we've seen .exe / .zip uploads).
// `validateMediaFile` is the real gate: it runs in onChange and rejects
// the file (with a toast) before it reaches state. The backend also
// validates, but UX should fail fast so users don't waste a click.

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;   // 10 MB — Meta's image cap
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;  // 100 MB — practical web-upload cap
const ALLOWED_IMAGE_MIME = new Set(['image/jpeg', 'image/png']);
const ALLOWED_VIDEO_MIME = new Set(['video/mp4', 'video/quicktime', 'video/webm']);

// Image-URL probe — does the URL actually serve a renderable image?
// Loads it into a hidden `new Image()` and resolves true on `load`, false
// on `error`. The browser does the MIME sniff for us. Used by the URL-
// paste path in ImageField to reject arbitrary URLs (an HTML page, a
// 404, a video) before they end up as the ad creative.
function probeImageUrl(url) {
  return new Promise((resolve) => {
    if (!url) { resolve(false); return; }
    const img = new window.Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;
  });
}

function validateMediaFile(file, kind) {
  if (!file) return false;
  const allowed = kind === 'video' ? ALLOWED_VIDEO_MIME : ALLOWED_IMAGE_MIME;
  const maxBytes = kind === 'video' ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
  // Trust the browser's sniffed MIME, not the extension — both can be
  // forged, but file.type at least uses the magic bytes on most browsers
  // for common formats. A .exe renamed to .jpg fails here because the
  // sniffed type is application/octet-stream.
  if (!allowed.has(file.type)) {
    globalToast.error(
      kind === 'video'
        ? 'Unsupported video format. Use MP4, MOV, or WEBM.'
        : 'Unsupported image format. Use JPG or PNG.',
    );
    return false;
  }
  if (file.size > maxBytes) {
    const maxMB = Math.round(maxBytes / (1024 * 1024));
    globalToast.error(
      `File is too large. Max ${maxMB} MB${kind === 'video' ? ' for videos' : ' for images'}.`,
    );
    return false;
  }
  return true;
}

// ─── tiny utils ──────────────────────────────────────────────────────────────

const labelize = (s) =>
  (s || '')
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const _currentYear = new Date().getFullYear();
const YEARS = Array.from({ length: 30 }, (_, i) => _currentYear - i);

// ─── Field shell ─────────────────────────────────────────────────────────────
// Wraps a label + optional hint + optional error below the control.

export function FieldShell({ label, hint, error, required, children, className = '' }) {
  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      {label && (
        <div className="flex items-center justify-between flex-wrap gap-x-2 gap-y-0.5">
          <label className="text-sm font-medium text-gray-500 dark:text-[#afafaf] 2xl:text-base">
            {label}
            {required && <span className="text-[#15DCFF] ml-0.5">*</span>}
          </label>
          {hint && (
            <span className="text-[11px] font-normal text-gray-400 dark:text-white/45 2xl:text-xs">{hint}</span>
          )}
        </div>
      )}
      {children}
      {error && <p className="text-[11px] text-red-600 dark:text-[#ff7e7e] 2xl:text-xs">{error}</p>}
    </div>
  );
}

// ─── TextField ────────────────────────────────────────────────────────────────

// Live "X/N" character counter, used when a field has a maxLength.
// Amber at 90%, red at 100% (which is also the typing cap since the
// underlying input has maxLength set — the red state is informational).
function CharCounter({ value, max }) {
  if (!Number.isFinite(max) || max <= 0) return null;
  const len = (value ?? '').length;
  const ratio = len / max;
  const color =
    ratio >= 1 ? 'text-[#ff7e7e]' : ratio >= 0.9 ? 'text-amber-300' : 'text-white/40';
  return (
    <div className={`text-[11px] text-right tabular-nums 2xl:text-xs ${color}`}>
      {len}/{max}
    </div>
  );
}

export function TextField({
  label,
  hint,
  error,
  required,
  value,
  onChange,
  placeholder,
  maxLength,
  type = 'text',
  className = '',
  inputClassName = '',
}) {
  return (
    <FieldShell label={label} hint={hint} error={error} required={required} className={className}>
      <input
        type={type}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        className={`w-full rounded-full border border-gray-300 bg-gray-100 px-4 py-2.5 text-13 placeholder:text-13 2xl:py-3 2xl:text-base 2xl:placeholder:text-15 text-gray-900 placeholder:text-gray-400 transition-colors hover:border-gray-400 focus:border-gray-400 focus:outline-none dark:border-white/5 dark:bg-[#909294]/15 dark:text-white dark:placeholder:text-[#AFAFAF] dark:hover:border-white/15 dark:focus:border-white/20 ${inputClassName}`}
      />
      <CharCounter value={value} max={maxLength} />
    </FieldShell>
  );
}

// ─── TextAreaField ────────────────────────────────────────────────────────────
// For longer copy: primary text on the Ad step, etc.

export function TextAreaField({
  label,
  hint,
  error,
  required,
  value,
  onChange,
  placeholder,
  maxLength,
  rows = 3,
  className = '',
}) {
  return (
    <FieldShell label={label} hint={hint} error={error} required={required} className={className}>
      <textarea
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        rows={rows}
        className="w-full resize-none rounded-2xl border border-gray-300 bg-gray-100 px-4 py-2.5 text-13 placeholder:text-13 2xl:py-3 2xl:text-base 2xl:placeholder:text-15 text-gray-900 placeholder:text-gray-400 transition-colors hover:border-gray-400 focus:border-gray-400 focus:outline-none dark:border-white/5 dark:bg-[#909294]/15 dark:text-white dark:placeholder:text-[#AFAFAF] dark:hover:border-white/15 dark:focus:border-white/20"
      />
      <CharCounter value={value} max={maxLength} />
    </FieldShell>
  );
}

// ─── NumberField ─────────────────────────────────────────────────────────────

// Shared sanitiser for `<input type="number">` onChange. The browser accepts
// scientific notation (`5e119`) as a valid number — without this, a stray
// `e` keystroke or a paste turns the budget field into "4.59e+119" and the
// user has no idea why. We reject any string containing `e/E` and any
// non-finite parse. Combined with `onKeyDown` below (blocks the keystroke
// itself), paste-based attacks are also stopped.
const EXPONENT_RE = /[eE]/;
function handleNumericInput(raw, onChange) {
  if (raw === '') { onChange(''); return; }
  if (EXPONENT_RE.test(raw)) return; // reject scientific notation entirely
  const n = Number(raw);
  if (!Number.isFinite(n)) return;
  onChange(n);
}
function blockExponentKey(e) {
  // `+` is meaningless for our budget/age inputs (min ≥ 0 enforced by Joi);
  // blocking it removes one more way to slip scientific notation in.
  if (e.key === 'e' || e.key === 'E' || e.key === '+') e.preventDefault();
}

export function NumberField({
  label,
  hint,
  error,
  required,
  value,
  onChange,
  placeholder,
  min,
  max,
  step = 1,
  className = '',
}) {
  return (
    <FieldShell label={label} hint={hint} error={error} required={required} className={className}>
      <input
        type="number"
        value={value ?? ''}
        onChange={(e) => handleNumericInput(e.target.value, onChange)}
        onKeyDown={blockExponentKey}
        placeholder={placeholder}
        min={min}
        max={max}
        step={step}
        className="w-full rounded-full border border-gray-300 bg-gray-100 px-4 py-2.5 text-13 placeholder:text-13 2xl:py-3 2xl:text-base text-gray-900 placeholder:text-gray-400 transition-colors hover:border-gray-400 focus:border-gray-400 focus:outline-none dark:border-white/5 dark:bg-[#909294]/15 dark:text-white dark:placeholder:text-[#AFAFAF] dark:hover:border-white/15 dark:focus:border-white/20"
      />
    </FieldShell>
  );
}

// ─── CurrencyField ───────────────────────────────────────────────────────────
// Number input with a currency-symbol prefix. We send minor units to the
// backend (so 100 INR becomes 10000 paise) — that conversion happens at
// submit, not here. This component shows major units.

export function CurrencyField({
  label,
  hint,
  error,
  required,
  value,
  onChange,
  placeholder,
  symbol = '₹',
  className = '',
}) {
  return (
    <FieldShell label={label} hint={hint} error={error} required={required} className={className}>
      <div className="relative">
        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-13 text-gray-400 dark:text-[#AFAFAF] pointer-events-none 2xl:text-base">
          {symbol}
        </span>
        <input
          type="number"
          value={value ?? ''}
          onChange={(e) => handleNumericInput(e.target.value, onChange)}
          onKeyDown={blockExponentKey}
          placeholder={placeholder}
          min={0}
          step={1}
          className="w-full rounded-full border border-gray-300 bg-gray-100 pl-9 pr-4 py-2.5 text-13 placeholder:text-13 2xl:py-3 2xl:text-base text-gray-900 placeholder:text-gray-400 transition-colors hover:border-gray-400 focus:border-gray-400 focus:outline-none dark:border-white/5 dark:bg-[#909294]/15 dark:text-white dark:placeholder:text-[#AFAFAF] dark:hover:border-white/15 dark:focus:border-white/20"
        />
      </div>
    </FieldShell>
  );
}

// ─── SelectField ─────────────────────────────────────────────────────────────
// Custom portaled dropdown (ported from V1). The trigger pills the rest of
// the wizard's inputs; the menu is a glass panel rendered into <body> via
// createPortal so it never gets clipped by an overflow:hidden ancestor and
// the modal's own scroll. Drop-in for any caller that previously used a
// native <select> — same `value` / `onChange` / `options` API.

export function SelectField({
  label,
  hint,
  error,
  required,
  value,
  onChange,
  options,
  placeholder = 'Select…',
  disabled = false,
  className = '',
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const updatePos = () => {
      const el = triggerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
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
    // Close on outside scroll (modal body, window). Ignore scroll inside the
    // menu's own options list so the user scrolling items doesn't dismiss it.
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

  const items = useMemo(
    () =>
      (options || []).map((o) =>
        typeof o === 'string' ? { value: o, label: labelize(o) } : o,
      ),
    [options],
  );
  const selected = items.find((o) => o.value === value);

  return (
    <FieldShell label={label} hint={hint} error={error} required={required} className={className}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((p) => !p)}
        className={`flex w-full items-center justify-between gap-2 rounded-full border bg-gray-100 px-4 py-2.5 text-left text-13 font-medium transition-colors hover:border-gray-400 focus:outline-none dark:bg-[#909294]/15 dark:hover:border-white/15 2xl:py-3 2xl:text-base ${
          open ? 'border-gray-400 dark:border-white/20' : 'border-gray-300 dark:border-white/5'
        } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
      >
        <span className={`min-w-0 truncate ${selected ? 'text-gray-900 dark:text-white' : 'text-gray-400 dark:text-[#AFAFAF]'}`}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-gray-400 dark:text-white/55 transition-transform duration-150 ${
            open ? 'rotate-180 text-gray-600 dark:text-white/85' : ''
          }`}
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
              style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width }}
              className="z-[200] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl backdrop-blur-xl dark:border-white/12 dark:bg-[#0F0F0F]/98"
            >
              <div className="scrollbar-thin max-h-60 overflow-y-auto p-1.5">
                {items.length === 0 && (
                  <div className="px-3 py-2 text-[11px] text-gray-400 dark:text-white/45 2xl:text-xs">
                    No options
                  </div>
                )}
                {items.map((o) => {
                  const isSelected = o.value === value;
                  return (
                    <button
                      key={o.value}
                      type="button"
                      onClick={() => {
                        onChange(o.value);
                        setOpen(false);
                      }}
                      className={`flex w-full items-center justify-between gap-2 rounded-md px-3 py-[7px] text-left text-[12px] font-medium transition-all 2xl:py-2 2xl:text-sm ${
                        isSelected
                          ? 'bg-gray-100 text-gray-900 dark:bg-white/10 dark:text-white'
                          : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-white/85 dark:hover:bg-white/5 dark:hover:text-white'
                      }`}
                    >
                      <span className="min-w-0 truncate">{o.label}</span>
                      {isSelected && <Check className="h-3.5 w-3.5 shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </FieldShell>
  );
}

// ─── MultiSelectField ────────────────────────────────────────────────────────
// Pill toggles. Active state uses the brand gradient ring (matches V1's
// special-ad-categories chips) instead of the flat `#15DCFF` tint.

export function MultiSelectField({
  label,
  hint,
  error,
  required,
  values,
  onChange,
  options,
  disabled = false,
  className = '',
}) {
  const set = new Set(values || []);
  const toggle = (v) => {
    if (disabled) return;
    const next = new Set(set);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    onChange(Array.from(next));
  };
  return (
    <FieldShell label={label} hint={hint} error={error} required={required} className={className}>
      <div className={`flex flex-wrap gap-2 ${disabled ? 'opacity-40 pointer-events-none' : ''}`}>
        {options.map((opt) => {
          const v = typeof opt === 'string' ? opt : opt.value;
          const lbl = typeof opt === 'string' ? opt : opt.label;
          const active = set.has(v);
          return (
            <div
              key={v}
              className={`rounded-full p-[1px] transition-all ${
                active
                  ? 'bg-gradient-to-r from-[#02C8C4] to-[#5867EB]'
                  : 'bg-gray-200 hover:bg-gray-300 dark:bg-white/8 dark:hover:bg-white/15'
              }`}
            >
              <button
                type="button"
                onClick={() => toggle(v)}
                disabled={disabled}
                className={`flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1 text-13 font-medium transition-all dark:bg-[#1d1d1d] 2xl:px-4 2xl:py-1.5 2xl:text-sm ${
                  active ? 'text-gray-900 dark:text-white' : 'text-gray-500 hover:text-gray-700 dark:text-white/55 dark:hover:text-white/80'
                }`}
              >
                {active && <Check className="h-3 w-3" />}
                {lbl}
              </button>
            </div>
          );
        })}
      </div>
    </FieldShell>
  );
}

// ─── ToggleField ─────────────────────────────────────────────────────────────
// V1's Toggle visual — brand gradient on the ON state, white thumb with
// shadow, disabled opacity ramp. Wraps the label + description on the left
// and the switch on the right, matching V1's settings rows.

export function ToggleField({
  label,
  hint,
  value,
  onChange,
  description,
  disabled = false,
  className = '',
}) {
  return (
    <div className={`flex items-start justify-between gap-4 ${className}`}>
      <div className="flex-1 flex flex-col gap-0.5">
        <label className="text-sm font-medium text-gray-500 dark:text-[#afafaf] 2xl:text-base">{label}</label>
        {(description || hint) && (
          <span className="text-[11px] text-gray-400 dark:text-white/45 2xl:text-xs">{description || hint}</span>
        )}
      </div>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(!value)}
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors duration-200 2xl:h-6 2xl:w-11 ${
          value ? 'bg-gradient-to-r from-[#02C8C4] to-[#5867EB]' : 'bg-gray-300 dark:bg-white/15'
        } ${disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'}`}
        aria-pressed={value}
      >
        <span
          className={`absolute top-1 left-1 h-3 w-3 rounded-full bg-white shadow transition-transform duration-200 2xl:h-4 2xl:w-4 ${
            value ? 'translate-x-4 2xl:translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  );
}

// ─── RangeField ──────────────────────────────────────────────────────────────
// Min/max paired number inputs. Used for age targeting (13–65).

export function RangeField({
  label,
  hint,
  error,
  required,
  minValue,
  maxValue,
  onChange,
  min,
  max,
  className = '',
}) {
  return (
    <FieldShell label={label} hint={hint} error={error} required={required} className={className}>
      <div className="grid grid-cols-2 gap-3">
        <input
          type="number"
          value={minValue ?? ''}
          onChange={(e) => onChange({ min: Number(e.target.value), max: maxValue })}
          min={min}
          max={max}
          placeholder="Min"
          className="w-full rounded-full border border-gray-300 bg-gray-100 px-4 py-2.5 text-13 2xl:py-3 2xl:text-base text-gray-900 transition-colors hover:border-gray-400 focus:border-gray-400 focus:outline-none dark:border-white/5 dark:bg-[#909294]/15 dark:text-white dark:hover:border-white/15 dark:focus:border-white/20"
        />
        <input
          type="number"
          value={maxValue ?? ''}
          onChange={(e) => onChange({ min: minValue, max: Number(e.target.value) })}
          min={min}
          max={max}
          placeholder="Max"
          className="w-full rounded-full border border-gray-300 bg-gray-100 px-4 py-2.5 text-13 2xl:py-3 2xl:text-base text-gray-900 transition-colors hover:border-gray-400 focus:border-gray-400 focus:outline-none dark:border-white/5 dark:bg-[#909294]/15 dark:text-white dark:hover:border-white/15 dark:focus:border-white/20"
        />
      </div>
    </FieldShell>
  );
}

// ─── ImageField ──────────────────────────────────────────────────────────────
// Three paths: upload a File, paste a URL, or pick from the user's
// generated-media library (V1 uses LibraryPicker for this). Returns the
// active path via two separate props (imageFile / imageUrl) — never both.

export function ImageField({
  label,
  hint,
  error,
  required,
  imageFile,
  imageUrl,
  onChangeFile,
  onChangeUrl,
  onOpenLibrary, // optional — when provided, surfaces a "Library" button
  className = '',
}) {
  // Blob URL must be memoised on the file reference — calling
  // URL.createObjectURL on every render produces a fresh blob: URL each
  // keystroke, which makes the <img> reload + flicker. Cleanup revokes
  // the previous blob URL when the file changes or the component
  // unmounts, so we don't leak blob refs.
  const previewSrc = useMemo(() => {
    if (imageFile) return URL.createObjectURL(imageFile);
    return imageUrl || null;
  }, [imageFile, imageUrl]);
  useEffect(() => {
    if (!previewSrc?.startsWith('blob:')) return undefined;
    return () => URL.revokeObjectURL(previewSrc);
  }, [previewSrc]);

  // Pending URL buffer — `imageUrl` is only committed once probeImageUrl
  // confirms the URL actually serves a renderable image. Without this,
  // the preview area renders a broken-img icon for any non-image URL
  // (an HTML page, a 404, a video link) and the user proceeds to Launch
  // unaware. Local state keeps the input controlled while we probe.
  const [pendingUrl, setPendingUrl] = useState(imageUrl || '');
  useEffect(() => {
    setPendingUrl(imageUrl || '');
  }, [imageUrl]);
  const commitPendingUrl = async () => {
    const v = (pendingUrl || '').trim();
    if (!v) { onChangeUrl?.(null); return; }
    const ok = await probeImageUrl(v);
    if (ok) {
      onChangeUrl?.(v);
      onChangeFile?.(null);
    } else {
      globalToast.error(
        "That URL doesn't load as an image. Use a direct image link (https://…/photo.jpg).",
      );
      setPendingUrl('');
      onChangeUrl?.(null);
    }
  };

  return (
    <FieldShell label={label} hint={hint} error={error} required={required} className={className}>
      <div className="flex flex-col gap-3">
        {previewSrc && (
          <div className="relative w-40 h-40 rounded-xl overflow-hidden border border-gray-200 bg-gray-100 dark:border-white/10 dark:bg-black/30">
            <img src={previewSrc} alt="preview" className="w-full h-full object-cover" />
            <button
              type="button"
              onClick={() => {
                onChangeFile?.(null);
                onChangeUrl?.(null);
              }}
              className="absolute top-2 right-2 px-2 py-1 rounded-full bg-black/60 border border-white/15 text-[11px] text-white hover:bg-black/80"
            >
              Remove
            </button>
          </div>
        )}
        {!previewSrc && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-gray-900 px-4 py-1.5 text-[12px] font-bold text-white transition-all hover:opacity-90 dark:bg-white dark:text-black 2xl:text-sm">
                Upload image
                <input
                  type="file"
                  // Narrowed from `image/*` to the two formats Meta accepts.
                  // The validator below is the real gate — accept is a hint.
                  accept="image/jpeg,image/png"
                  onChange={(e) => {
                    const file = e.target.files?.[0] || null;
                    if (file && validateMediaFile(file, 'image')) {
                      onChangeFile?.(file);
                      onChangeUrl?.(null);
                    }
                    // Reset the input so re-selecting the same rejected
                    // file re-fires onChange (otherwise the second pick is
                    // silently ignored).
                    e.target.value = '';
                  }}
                  className="hidden"
                />
              </label>
              {onOpenLibrary && (
                <button
                  type="button"
                  onClick={onOpenLibrary}
                  className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-gray-100 px-4 py-1.5 text-[12px] font-semibold text-gray-600 transition-all hover:bg-gray-200 hover:text-gray-900 dark:border-white/10 dark:bg-white/5 dark:text-white/80 dark:hover:bg-white/10 dark:hover:text-white 2xl:text-sm"
                >
                  Pick from Library
                </button>
              )}
            </div>
            <div className="text-[11px] text-gray-400 dark:text-white/45">or paste an image URL</div>
            <input
              type="url"
              value={pendingUrl}
              onChange={(e) => setPendingUrl(e.target.value)}
              onBlur={commitPendingUrl}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); commitPendingUrl(); }
              }}
              placeholder="https://…"
              className="w-full rounded-full border border-gray-300 bg-gray-100 px-4 py-2.5 text-13 2xl:py-3 2xl:text-base text-gray-900 placeholder:text-gray-400 transition-colors hover:border-gray-400 focus:border-gray-400 focus:outline-none dark:border-white/5 dark:bg-[#909294]/15 dark:text-white dark:placeholder:text-[#AFAFAF] dark:hover:border-white/15 dark:focus:border-white/20"
            />
          </>
        )}
      </div>
    </FieldShell>
  );
}

// ─── VideoField ──────────────────────────────────────────────────────────────
// Upload a video File (MP4/MOV/WEBM) — that's it for the manual path.
// The library tab (handled by the parent SegGroup) covers reuse of a
// previously-generated video URL, so a manual paste-URL input here is
// redundant noise.
//
// Thumbnail (poster) is optional from the user's perspective: Meta
// auto-extracts thumbnails as soon as encoding starts. The backend's
// `uploadAdVideo` fetches the preferred auto-thumbnail and returns it
// alongside the videoId; the parent component populates
// `videoThumbnailUrl` from that response. Users can override with a
// custom URL if they prefer a specific frame.

export function VideoField({
  label,
  hint,
  error,
  required,
  videoFile,
  videoUrl,
  videoThumbnailUrl,
  onChangeFile,
  onChangeUrl,
  onChangeThumbnailUrl,
  className = '',
}) {
  // Memoise the blob URL on the file reference — otherwise every render
  // (e.g. on each keystroke in a sibling input) creates a fresh blob:
  // URL, which makes the <video> element reload + flicker. Cleanup
  // revokes the previous blob URL when the file changes or the
  // component unmounts so we don't leak blob refs.
  const previewSrc = useMemo(() => {
    if (videoFile) return URL.createObjectURL(videoFile);
    return videoUrl || null;
  }, [videoFile, videoUrl]);
  useEffect(() => {
    if (!previewSrc?.startsWith('blob:')) return undefined;
    return () => URL.revokeObjectURL(previewSrc);
  }, [previewSrc]);

  return (
    <FieldShell label={label} hint={hint} error={error} required={required} className={className}>
      <div className="flex flex-col gap-3">
        {previewSrc && (
          <div className="relative w-56 max-w-full rounded-xl overflow-hidden border border-gray-200 bg-gray-100 dark:border-white/10 dark:bg-black/30">
            {/* Browsers can preview File via blob URL; URL-pasted videos
                play directly. Either way, a <video> tag is the cheapest
                preview — no transcoding, no async load. */}
            <video
              src={previewSrc}
              controls
              muted
              playsInline
              className="w-full h-auto max-h-56 object-contain bg-black"
            />
            <button
              type="button"
              onClick={() => {
                onChangeFile?.(null);
                onChangeUrl?.(null);
              }}
              className="absolute top-2 right-2 px-2 py-1 rounded-full bg-black/60 border border-white/15 text-[11px] text-white hover:bg-black/80"
            >
              Remove
            </button>
          </div>
        )}
        {!previewSrc && (
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-gray-900 px-4 py-1.5 text-[12px] font-bold text-white transition-all hover:opacity-90 dark:bg-white dark:text-black 2xl:text-sm">
              Upload video
              <input
                type="file"
                accept="video/mp4,video/quicktime,video/webm"
                onChange={(e) => {
                  const file = e.target.files?.[0] || null;
                  if (file && validateMediaFile(file, 'video')) {
                    onChangeFile?.(file);
                    onChangeUrl?.(null);
                  }
                  // Reset so re-selecting the same rejected file re-fires
                  // onChange (otherwise the second pick is silently ignored).
                  e.target.value = '';
                }}
                className="hidden"
              />
            </label>
            <span className="text-[11px] text-gray-400 dark:text-white/45">MP4 / MOV / WEBM up to 100 MB</span>
          </div>
        )}
        {/* Thumbnail — Meta auto-extracts thumbnails from the uploaded
            video. Backend fetches the preferred auto-thumbnail and
            populates this field on upload. Users only see this if they
            want to override with a custom URL. */}
        {previewSrc && (
          <div className="flex flex-col gap-2">
            <label className="text-[11px] font-medium text-gray-500 dark:text-[#afafaf]">
              Thumbnail URL
              <span className="ml-2 font-normal text-gray-400 dark:text-white/45">
                {videoThumbnailUrl
                  ? 'auto-extracted from your video · override if you want a different frame'
                  : 'leave blank to let Meta pick one for you'}
              </span>
            </label>
            <input
              type="url"
              value={videoThumbnailUrl || ''}
              onChange={(e) => onChangeThumbnailUrl?.(e.target.value || null)}
              placeholder="https://…/poster.jpg (optional)"
              className="w-full rounded-full border border-gray-300 bg-gray-100 px-4 py-2.5 text-13 2xl:py-3 2xl:text-base text-gray-900 placeholder:text-gray-400 transition-colors hover:border-gray-400 focus:border-gray-400 focus:outline-none dark:border-white/5 dark:bg-[#909294]/15 dark:text-white dark:placeholder:text-[#AFAFAF] dark:hover:border-white/15 dark:focus:border-white/20"
            />
          </div>
        )}
      </div>
    </FieldShell>
  );
}

// ─── SegButton ───────────────────────────────────────────────────────────────
// Segmented control — gradient ring on the active segment. Use for
// 2–3 mutually exclusive choices (daily/lifetime, pick/build, etc.) where
// dropping into a SelectField would be too heavy.

export function SegButton({ active, onClick, children, className = '' }) {
  // `rounded-full` on the outer ring distorts into an oval when the content
  // is taller than wide (e.g. when a sibling wraps to two lines and
  // items-stretch forces equal heights). `rounded-2xl` keeps the corners
  // honest regardless of height. `whitespace-nowrap` on the label prevents
  // the wrap that triggers the height mismatch in the first place.
  return (
    <div
      className={`flex-1 rounded-2xl p-[1px] transition-all ${
        active
          ? 'bg-gradient-to-r from-[#02C8C4] to-[#5867EB]'
          : 'bg-gray-200 hover:bg-gray-300 dark:bg-white/8 dark:hover:bg-white/15'
      } ${className}`}
    >
      <button
        type="button"
        onClick={onClick}
        className={`w-full whitespace-nowrap rounded-2xl bg-gray-100 px-3 py-1.5 text-13 font-medium transition-all dark:bg-[#1d1d1d] 2xl:py-2.5 2xl:text-sm ${
          active ? 'text-gray-900 dark:text-white' : 'text-gray-500 hover:text-gray-700 dark:text-white/55 dark:hover:text-white/80'
        }`}
      >
        {children}
      </button>
    </div>
  );
}

// SegGroup — convenience wrapper around SegButton for the common case
// of a single-select choice in a row. Pass {value, label}[] options and
// the bound value + setter.
export function SegGroup({ value, onChange, options, className = '' }) {
  return (
    <div className={`flex items-stretch gap-2 ${className}`}>
      {options.map((opt) => {
        const v = typeof opt === 'string' ? opt : opt.value;
        const lbl = typeof opt === 'string' ? opt : opt.label;
        return (
          <SegButton key={v} active={value === v} onClick={() => onChange(v)}>
            {lbl}
          </SegButton>
        );
      })}
    </div>
  );
}

// ─── GradientCheckbox ────────────────────────────────────────────────────────
// White-fill-on-checked checkbox with bold black check icon. For inline
// boolean rows where a full ToggleField would be too heavy.

export function GradientCheckbox({ checked, onChange, size = 'sm' }) {
  const boxDim =
    size === 'md'
      ? 'h-4 w-4 2xl:h-5 2xl:w-5'
      : 'h-3.5 w-3.5 2xl:h-4.5 2xl:w-4.5';
  const iconDim =
    size === 'md'
      ? 'h-3 w-3 2xl:h-3.5 2xl:w-3.5'
      : 'h-2.5 w-2.5 2xl:h-3 2xl:w-3';
  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center rounded ${boxDim} ${
        checked ? 'bg-gray-900 dark:bg-white' : 'border border-gray-300 hover:border-gray-400 dark:border-white/50 dark:hover:border-white/70'
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="absolute inset-0 cursor-pointer opacity-0"
      />
      {checked && <Check className={`text-white dark:text-black ${iconDim}`} strokeWidth={3} />}
    </span>
  );
}

// ─── DateTimePicker ──────────────────────────────────────────────────────────
// V1's custom datetime picker — dark calendar + scroll columns for hour/min
// + Apply/Cancel footer. Replaces the browser-native `datetime-local` widget
// which looks broken against the rest of the dark UI. Emits the same
// "YYYY-MM-DDTHH:MM" string `datetime-local` would have produced.

function InlineDropdown({ value, options, onChange, renderLabel }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex min-w-[90px] items-center justify-between gap-1 rounded-sm px-3 py-1.5 text-sm font-semibold text-gray-900 hover:bg-gray-100 dark:text-white dark:hover:bg-[#464951]"
      >
        {renderLabel(value)}
        <ChevronDown size={14} className="opacity-70" />
      </button>
      {open && (
        <div className="scrollbar-thin absolute top-full left-0 z-[60] mt-1 max-h-[220px] w-max min-w-[110px] overflow-y-auto rounded-md border border-gray-200 bg-white py-1 shadow-lg dark:border-[#3a3c44] dark:bg-[#303030]">
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              disabled={opt.disabled}
              onClick={() => {
                if (opt.disabled) return;
                onChange(opt.value);
                setOpen(false);
              }}
              className={`mt-1 block w-full px-3 py-1.5 text-left text-sm ${
                opt.disabled
                  ? 'cursor-not-allowed text-gray-400 dark:text-white/30'
                  : opt.value === value
                  ? 'bg-gray-100 text-gray-900 dark:bg-[#464951] dark:text-white'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-white/80 dark:hover:bg-[#464951] dark:hover:text-white'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function TimeColumn({ values, selected, onChange, label }) {
  const ref = useRef(null);
  useEffect(() => {
    const node = ref.current?.querySelector('[data-selected="true"]');
    if (node) node.scrollIntoView({ block: 'center' });
  }, [selected]);
  return (
    <div className="flex flex-col items-center">
      <span className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-white/45">
        {label}
      </span>
      <div ref={ref} className="scrollbar-hide h-[200px] w-12 overflow-y-auto pr-0.5">
        {values.map((v) => {
          const isSel = v === selected;
          return (
            <button
              key={v}
              type="button"
              data-selected={isSel}
              onClick={() => onChange(v)}
              className={`my-0.5 block w-full rounded py-1.5 text-center text-xs transition-colors ${
                isSel ? 'bg-gray-200 text-gray-900 dark:bg-[#434343] dark:text-white' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-white/70 dark:hover:bg-[#3a3c44] dark:hover:text-white'
              }`}
            >
              {String(v).padStart(2, '0')}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function DateTimePicker({
  label,
  hint,
  error,
  required,
  value,
  onChange,
  disabled,
  minDate,
  className = '',
  // Which edge of the field the popup anchors to. 'left' opens rightward
  // (use for left-column fields); 'right' opens leftward (right column) —
  // keeps the calendar from overflowing the modal and getting clipped.
  align = 'left',
}) {
  const [open, setOpen] = useState(false);
  const [tempDate, setTempDate] = useState(null);
  const [tempTime, setTempTime] = useState('');
  const ref = useRef(null);
  const isDarkMode = useSelector((s) => s.theme?.isDarkMode);

  useEffect(() => {
    if (!open) return;
    if (value) {
      const d = new Date(value);
      setTempDate(d);
      // Snap minutes to the nearest 5 so the value lines up with the
      // 5-minute time column below.
      const snapMin = Math.min(55, Math.round(d.getMinutes() / 5) * 5);
      setTempTime(
        `${String(d.getHours()).padStart(2, '0')}:${String(snapMin).padStart(2, '0')}`,
      );
    } else {
      setTempDate(null);
      setTempTime('');
    }
  }, [open, value]);

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const display = useMemo(() => {
    if (!value) return 'dd-mm-yyyy --:--';
    const d = new Date(value);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, '0');
    const mins = String(d.getMinutes()).padStart(2, '0');
    return `${dd}-${mm}-${yyyy} ${hh}:${mins}`;
  }, [value]);

  const handleApply = () => {
    if (!tempDate) {
      onChange('');
      setOpen(false);
      return;
    }
    const [h, m] = (tempTime || '00:00').split(':');
    const result = new Date(tempDate);
    result.setHours(Number(h) || 0, Number(m) || 0, 0, 0);
    const yyyy = result.getFullYear();
    const mm = String(result.getMonth() + 1).padStart(2, '0');
    const dd = String(result.getDate()).padStart(2, '0');
    const hh = String(result.getHours()).padStart(2, '0');
    const mins = String(result.getMinutes()).padStart(2, '0');
    onChange(`${yyyy}-${mm}-${dd}T${hh}:${mins}`);
    setOpen(false);
  };

  const monthOptions = MONTHS.map((m, i) => ({ value: i, label: m }));
  const yearOptions = YEARS.map((y) => ({ value: y, label: y.toString() }));
  const [hh, mm] = (tempTime || '00:00').split(':');
  const tempHour = Number(hh) || 0;
  const tempMinute = Number(mm) || 0;
  const setHour = (h) =>
    setTempTime(`${String(h).padStart(2, '0')}:${String(tempMinute).padStart(2, '0')}`);
  const setMinute = (m) =>
    setTempTime(`${String(tempHour).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
  const HOURS = Array.from({ length: 24 }, (_, i) => i);
  // 5-minute steps — 12 rows instead of 60, far less scrolling and plenty
  // precise for ad scheduling.
  const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);

  // Quick-pick presets — common ad-scheduling choices so users rarely
  // need to spin the calendar + time columns at all.
  const presets = useMemo(() => {
    const pad = (n) => String(n).padStart(2, '0');
    const mk = (daysFromNow, h, m) => {
      const d = new Date();
      d.setDate(d.getDate() + daysFromNow);
      return { date: d, time: `${pad(h)}:${pad(m)}` };
    };
    const now = new Date();
    let rh = now.getHours();
    let rm = Math.ceil(now.getMinutes() / 5) * 5;
    if (rm >= 60) {
      rm = 0;
      rh = (rh + 1) % 24;
    }
    return [
      { label: 'Now', ...mk(0, rh, rm) },
      { label: 'Tomorrow 9 AM', ...mk(1, 9, 0) },
      { label: 'In 7 days', ...mk(7, 9, 0) },
    ];
  }, []);

  return (
    <FieldShell label={label} hint={hint} error={error} required={required} className={className}>
      <div ref={ref} className="relative">
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen((v) => !v)}
          className={`flex w-full items-center justify-between rounded-full border border-gray-300 bg-gray-100 px-4 py-2.5 text-13 transition-colors hover:border-gray-400 focus:border-gray-400 focus:outline-none dark:border-white/5 dark:bg-[#909294]/15 dark:hover:border-white/15 dark:focus:border-white/20 2xl:py-3 2xl:text-base ${
            disabled ? 'cursor-not-allowed opacity-40' : ''
          }`}
        >
          <span className={value ? 'text-gray-900 dark:text-white' : 'text-gray-400 dark:text-[#AFAFAF]'}>{display}</span>
          <CalendarDays className="h-4 w-4 text-gray-400 dark:text-white/55" />
        </button>
        {open && (
          <div
            className={`wiz-dt-pop absolute top-full z-50 mt-1 rounded-md border border-gray-200 bg-white shadow-lg dark:border-[#3a3c44] dark:bg-[#303030] ${
              align === 'right' ? 'right-0' : 'left-0'
            }`}
          >
            <style>{`
              .wiz-dt-pop .rdrCalendarWrapper { font-size: 10px !important; }
              .wiz-dt-pop .rdrDateDisplayWrapper { display: none !important; }
              .wiz-dt-pop .rdrMonth { padding: 0 0.5em !important; }
              .wiz-dt-pop .rdrDayNumber span { font-size: 12px !important; }
              .wiz-dt-pop .rdrWeekDay { font-size: 11px !important; }
            `}</style>
            {/* Quick presets — one click instead of spinning the calendar. */}
            <div className="flex flex-wrap gap-1.5 border-b border-gray-200 p-2 dark:border-[#3a3c44]">
              {presets.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => {
                    setTempDate(p.date);
                    setTempTime(p.time);
                  }}
                  className="rounded-md bg-gray-100 px-2.5 py-1 text-[11px] font-medium text-gray-600 transition-colors hover:bg-gray-200 hover:text-gray-900 dark:bg-[#3a3c44] dark:text-white/80 dark:hover:bg-[#464951] dark:hover:text-white"
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="flex">
              <Calendar
                date={tempDate || new Date()}
                onChange={setTempDate}
                color={isDarkMode ? '#434343' : '#e4e4e7'}
                minDate={minDate}
                maxDate={undefined}
                navigatorRenderer={(currentFocusedDate, changeShownDate) => {
                  const month = currentFocusedDate.getMonth();
                  const year = currentFocusedDate.getFullYear();
                  return (
                    <div className="flex items-center justify-between px-2 pt-3 pb-2">
                      <button
                        type="button"
                        className="flex size-7 items-center justify-center rounded-md bg-gray-100 text-gray-900 hover:bg-gray-200 dark:bg-[#464951] dark:text-white dark:hover:bg-[#5b5e67]"
                        onClick={() => {
                          const d = new Date(currentFocusedDate);
                          d.setMonth(d.getMonth() - 1);
                          changeShownDate(d);
                        }}
                      >
                        <ChevronLeft size={16} />
                      </button>
                      <div className="flex items-center gap-1">
                        <InlineDropdown
                          value={month}
                          options={monthOptions}
                          onChange={(val) => {
                            const d = new Date(currentFocusedDate);
                            d.setMonth(val);
                            changeShownDate(d);
                          }}
                          renderLabel={(v) => MONTHS[v]}
                        />
                        <InlineDropdown
                          value={year}
                          options={yearOptions}
                          onChange={(val) => {
                            const d = new Date(currentFocusedDate);
                            d.setFullYear(val);
                            changeShownDate(d);
                          }}
                          renderLabel={(v) => v}
                        />
                      </div>
                      <button
                        type="button"
                        className="flex size-7 items-center justify-center rounded-md bg-gray-100 text-gray-900 hover:bg-gray-200 dark:bg-[#464951] dark:text-white dark:hover:bg-[#5b5e67]"
                        onClick={() => {
                          const d = new Date(currentFocusedDate);
                          d.setMonth(d.getMonth() + 1);
                          changeShownDate(d);
                        }}
                      >
                        <ChevronRight size={16} />
                      </button>
                    </div>
                  );
                }}
              />
              <div className="flex items-start gap-1 border-l border-gray-200 px-2 pt-3 pb-2 dark:border-[#3a3c44]">
                <TimeColumn values={HOURS} selected={tempHour} onChange={setHour} label="Hr" />
                <TimeColumn values={MINUTES} selected={tempMinute} onChange={setMinute} label="Min" />
              </div>
            </div>
            <div className="flex items-center mt-3 justify-end gap-2 p-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-sm border border-gray-300 bg-transparent px-6 py-1 text-sm font-semibold text-gray-600 hover:opacity-70 dark:border-[#EFEFEF]/60 dark:text-[#E3E3E3]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleApply}
                className="rounded-sm bg-gray-900 px-8 py-1 text-sm font-bold text-white shadow-sm hover:bg-gray-800 dark:bg-white dark:text-[#151515] dark:hover:bg-white/70"
              >
                Apply
              </button>
            </div>
          </div>
        )}
      </div>
    </FieldShell>
  );
}

// ─── LaunchErrorBanner ───────────────────────────────────────────────────────
// V1's launch-error display — dismissible, fbtrace mono, Meta-help chip.
// Pass a `{title, details, helpUrl, fbtraceId, stage}` object as `error`.

export function LaunchErrorBanner({ error, onDismiss, className = '' }) {
  if (!error) return null;
  // Meta error URLs are noisy and unhelpful — surface them only via the
  // separate "Open Meta help" chip. Drop them from the inline message.
  const cleanedDetails = error.details
    ? error.details.replace(/https?:\/\/\S+/g, '').replace(/\s+\.?\s*$/, '').trim()
    : '';
  return (
    <div
      className={`rounded-2xl border border-red-300 bg-red-50 p-4 dark:border-red-400/30 dark:bg-red-400/8 2xl:p-5 ${className}`}
    >
      <div className="flex items-start gap-3">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-300 2xl:h-5 2xl:w-5" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-bold text-red-700 dark:text-red-100 2xl:text-base">
              {error.stage ? `${labelize(error.stage)} step failed` : 'Launch failed'}
            </p>
            {onDismiss && (
              <button
                type="button"
                onClick={onDismiss}
                className="-mr-1 -mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-red-500/70 transition-colors hover:bg-red-100 hover:text-red-700 dark:text-red-200/60 dark:hover:bg-red-400/10 dark:hover:text-red-100"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          {error.title && (
            <p className="mt-1 text-xs font-semibold text-red-700 dark:text-red-100 2xl:text-sm">{error.title}</p>
          )}
          {cleanedDetails && cleanedDetails !== error.title && (
            <p className="mt-1 text-xs leading-relaxed text-red-600 dark:text-red-200/85 2xl:text-sm">
              {cleanedDetails}
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {error.helpUrl && (
              <a
                href={error.helpUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded border border-red-300 bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700 transition-colors hover:bg-red-200 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-100 dark:hover:bg-red-400/20 2xl:text-xs"
              >
                Open Meta help ↗
              </a>
            )}
            {error.fbtraceId && (
              <span className="font-mono text-[11px] text-red-500/70 dark:text-red-200/55 2xl:text-xs">
                fbtrace {error.fbtraceId}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── WizardCard ──────────────────────────────────────────────────────────────
// Gradient-ring selectable card — for objective + conversion-location
// pickers. Selected gets the brand-gradient `p-[1px]` ring + gradient icon
// tile. Optional `beta` pill. Mirrors V1's objective-card pattern.

export function WizardCard({
  selected,
  onClick,
  icon: Icon,
  title,
  description,
  beta,
  className = '',
}) {
  return (
    <div
      className={`rounded-2xl p-[1px] transition-all ${
        selected
          ? 'bg-gradient-to-r from-[#02C8C4] to-[#5867EB]'
          : 'bg-gray-200 hover:bg-gray-300 dark:bg-white/8 dark:hover:bg-white/15'
      } ${className}`}
    >
      <button
        type="button"
        onClick={onClick}
        className="group flex h-full w-full items-start gap-3 rounded-2xl bg-white p-3 text-left transition-all hover:bg-gray-50 dark:bg-[#181818] dark:hover:bg-[#1d1d1d] 2xl:p-4"
      >
        {Icon && (
          <div
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg 2xl:h-10 2xl:w-10 ${
              selected
                ? 'bg-gradient-to-br from-[#02C8C4] to-[#5867EB] text-white'
                : 'bg-gray-100 text-gray-500 dark:bg-white/5 dark:text-white/55'
            }`}
          >
            <Icon className="h-4 w-4 2xl:h-5 2xl:w-5" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p
              className={`text-sm font-semibold 2xl:text-base ${
                selected ? 'text-gray-900 dark:text-white' : 'text-gray-900 dark:text-white/85'
              }`}
            >
              {title}
            </p>
            {beta && (
              <span className="shrink-0 rounded-full border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-300 2xl:text-[10px]">
                Beta
              </span>
            )}
          </div>
          {description && (
            <p className="mt-0.5 text-xs leading-snug text-gray-600 dark:text-white/60 2xl:text-sm">{description}</p>
          )}
        </div>
      </button>
    </div>
  );
}
