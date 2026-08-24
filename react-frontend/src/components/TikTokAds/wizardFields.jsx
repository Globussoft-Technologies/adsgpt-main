import React, { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Check, AlertCircle, X } from 'lucide-react';
import globalToast from 'react-hot-toast';

// ─── media validation ────────────────────────────────────────────────────────
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;   // 10 MB
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;  // 100 MB
const ALLOWED_IMAGE_MIME = new Set(['image/jpeg', 'image/png']);
const ALLOWED_VIDEO_MIME = new Set(['video/mp4', 'video/quicktime', 'video/webm']);

export function validateMediaFile(file, kind) {
  if (!file) return false;
  const allowed = kind === 'video' ? ALLOWED_VIDEO_MIME : ALLOWED_IMAGE_MIME;
  const maxBytes = kind === 'video' ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
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
        className={`w-full rounded-full border bg-gray-100 px-4 py-2.5 text-13 placeholder:text-13 2xl:py-3 2xl:text-base 2xl:placeholder:text-15 text-gray-900 placeholder:text-gray-400 transition-colors hover:border-gray-400 focus:outline-none dark:bg-[#909294]/15 dark:text-white dark:placeholder:text-[#AFAFAF] dark:hover:border-white/15 ${
          error
            ? 'border-red-500 ring-1 ring-red-500/30 dark:border-red-500/80'
            : 'border-gray-300 focus:border-gray-400 dark:border-white/5 dark:focus:border-white/20'
        } ${inputClassName}`}
      />
      <CharCounter value={value} max={maxLength} />
    </FieldShell>
  );
}

// ─── TextAreaField ────────────────────────────────────────────────────────────
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
        className={`w-full resize-none rounded-2xl border bg-gray-100 px-4 py-2.5 text-13 placeholder:text-13 2xl:py-3 2xl:text-base 2xl:placeholder:text-15 text-gray-900 placeholder:text-gray-400 transition-colors hover:border-gray-400 focus:outline-none dark:bg-[#909294]/15 dark:text-white dark:placeholder:text-[#AFAFAF] dark:hover:border-white/15 ${
          error
            ? 'border-red-500 ring-1 ring-red-500/30 dark:border-red-500/80'
            : 'border-gray-300 focus:border-gray-400 dark:border-white/5 dark:focus:border-white/20'
        }`}
      />
      <CharCounter value={value} max={maxLength} />
    </FieldShell>
  );
}

// ─── NumberField ─────────────────────────────────────────────────────────────
const EXPONENT_RE = /[eE]/;
function handleNumericInput(raw, onChange) {
  if (raw === '') { onChange(''); return; }
  if (EXPONENT_RE.test(raw)) return;
  const n = Number(raw);
  if (!Number.isFinite(n)) return;
  onChange(n);
}
function blockExponentKey(e) {
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
        className={`w-full rounded-full border bg-gray-100 px-4 py-2.5 text-13 placeholder:text-13 2xl:py-3 2xl:text-base text-gray-900 placeholder:text-gray-400 transition-colors hover:border-gray-400 focus:outline-none dark:bg-[#909294]/15 dark:text-white dark:placeholder:text-[#AFAFAF] dark:hover:border-white/15 ${
          error
            ? 'border-red-500 ring-1 ring-red-500/30 dark:border-red-500/80'
            : 'border-gray-300 focus:border-gray-400 dark:border-white/5 dark:focus:border-white/20'
        }`}
      />
    </FieldShell>
  );
}

// ─── CurrencyField ───────────────────────────────────────────────────────────
export function CurrencyField({
  label,
  hint,
  error,
  required,
  value,
  onChange,
  placeholder,
  symbol = '$',
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
          className={`w-full rounded-full border bg-gray-100 pl-9 pr-4 py-2.5 text-13 placeholder:text-13 2xl:py-3 2xl:text-base text-gray-900 placeholder:text-gray-400 transition-colors hover:border-gray-400 focus:outline-none dark:bg-[#909294]/15 dark:text-white dark:placeholder:text-[#AFAFAF] dark:hover:border-white/15 ${
            error
              ? 'border-red-500 ring-1 ring-red-500/30 dark:border-red-500/80'
              : 'border-gray-300 focus:border-gray-400 dark:border-white/5 dark:focus:border-white/20'
          }`}
        />
      </div>
    </FieldShell>
  );
}

// ─── SelectField (with Auto-Flip & Adaptive Max-Height) ──────────────────────
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
  const [pos, setPos] = useState({ top: null, bottom: null, left: 0, width: 0, maxHeight: 240, flipUp: false });
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const updatePos = () => {
      if (!triggerRef.current) return;
      const rect = triggerRef.current.getBoundingClientRect();
      const GAP = 4;
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      const flipUp = spaceBelow < 240 && spaceAbove > spaceBelow;
      const availableSpace = flipUp ? spaceAbove - GAP - 12 : spaceBelow - GAP - 12;
      const maxHeight = Math.max(120, Math.min(240, availableSpace));

      setPos({
        top: flipUp ? null : rect.bottom + GAP,
        bottom: flipUp ? window.innerHeight - rect.top + GAP : null,
        left: rect.left,
        width: rect.width,
        maxHeight,
        flipUp,
      });
    };
    updatePos();

    const onDocClick = (e) => {
      if (
        triggerRef.current &&
        !triggerRef.current.contains(e.target) &&
        menuRef.current &&
        !menuRef.current.contains(e.target)
      ) {
        setOpen(false);
      }
    };
    const onEsc = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onScroll = () => updatePos();

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
          error
            ? 'border-red-500 ring-1 ring-red-500/30 dark:border-red-500/80'
            : open
            ? 'border-gray-400 dark:border-white/20'
            : 'border-gray-300 dark:border-white/5'
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
              initial={{ opacity: 0, y: pos.flipUp ? 4 : -4, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: pos.flipUp ? 4 : -4, scale: 0.98 }}
              transition={{ duration: 0.12, ease: 'easeOut' }}
              style={{
                position: 'fixed',
                ...(pos.top !== null ? { top: pos.top } : {}),
                ...(pos.bottom !== null ? { bottom: pos.bottom } : {}),
                left: pos.left,
                width: pos.width,
              }}
              className="z-[200] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl backdrop-blur-xl dark:border-white/12 dark:bg-[#0F0F0F]/98"
            >
              <div
                style={{ maxHeight: pos.maxHeight }}
                className="scrollbar-thin overflow-y-auto p-1.5"
              >
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

// ─── SegButton & SegGroup ────────────────────────────────────────────────────
export function SegButton({ active, onClick, children, className = '' }) {
  return (
    <div
      className={`inline-flex rounded-full p-[1px] transition-all ${
        active
          ? 'bg-gradient-to-r from-[#02C8C4] to-[#5867EB]'
          : 'bg-gray-200 hover:bg-gray-300 dark:bg-white/8 dark:hover:bg-white/15'
      } ${className}`}
    >
      <button
        type="button"
        onClick={onClick}
        className={`h-full rounded-full bg-gray-100 px-4 py-2 text-13 font-medium transition-all dark:bg-[#1d1d1d] 2xl:px-5 2xl:py-2.5 2xl:text-sm ${
          active
            ? 'text-gray-900 dark:text-white'
            : 'text-gray-500 hover:text-gray-700 dark:text-white/55 dark:hover:text-white/80'
        }`}
      >
        {children}
      </button>
    </div>
  );
}

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

// ─── LaunchErrorBanner ───────────────────────────────────────────────────────
export function LaunchErrorBanner({ error, onDismiss, className = '' }) {
  if (!error) return null;
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
        </div>
      </div>
    </div>
  );
}

// ─── WizardCard ──────────────────────────────────────────────────────────────
export function WizardCard({ selected, onClick, title, description, icon: Icon, badge, className = '' }) {
  return (
    <div
      onClick={onClick}
      className={`group relative flex cursor-pointer flex-col justify-between rounded-2xl p-[1px] transition-all ${
        selected
          ? 'bg-gradient-to-r from-[#02C8C4] to-[#5867EB] shadow-lg shadow-cyan-500/10'
          : 'bg-gray-200 hover:bg-gray-300 dark:bg-white/8 dark:hover:bg-white/15'
      } ${className}`}
    >
      <div className="flex h-full flex-col justify-between rounded-2xl bg-white p-4 dark:bg-[#151515] 2xl:p-5">
        <div>
          <div className="flex items-center justify-between mb-3">
            {Icon && (
              <div
                className={`flex h-10 w-10 items-center justify-center rounded-xl transition-all ${
                  selected
                    ? 'bg-gradient-to-r from-[#02C8C4] to-[#5867EB] text-white'
                    : 'bg-gray-100 text-gray-600 dark:bg-white/5 dark:text-white/70'
                }`}
              >
                <Icon className="h-5 w-5" />
              </div>
            )}
            {badge && (
              <span className="rounded-full bg-[#15DCFF]/10 px-2 py-0.5 text-[10px] font-bold text-[#15DCFF]">
                {badge}
              </span>
            )}
          </div>
          <p className="text-sm font-bold text-gray-900 dark:text-white 2xl:text-base">{title}</p>
          {description && (
            <p className="mt-1 text-xs leading-relaxed text-gray-500 dark:text-white/50 2xl:text-sm">
              {description}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
