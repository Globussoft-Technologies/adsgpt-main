import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Eye,
  Loader2,
  Minus,
  Plus,
  Search,
  X,
} from 'lucide-react';
import { InfoTip } from '@/components/Autopilot/_atoms';
import { getClipboardImageFiles } from '@/utils/clipboardImages';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  BTN_LINK,
  CARD,
  CHIP,
  CONTROL,
  CONTROL_H,
  FAINT,
  FLAG_BORDER,
  INPUT,
  LABEL,
  MENU,
  MENU_ITEM,
  MUTED,
  NUM,
  PILL,
  PILL_ON,
  RULE,
  RULE_BORDER,
  SECTION,
  SECTION_PAD,
  TEXTAREA,
  THUMB,
  THUMB_ADD,
  VALUE,
} from './_tokens';

// ----------------------------------------------------------------------------
// Editable field primitives for the brief screen.
// ----------------------------------------------------------------------------

const flaggedBorder = (flagged) => (flagged ? FLAG_BORDER : '');

// ─── Section ─────────────────────────────────────────────────────────────────

export function Section({ title, badge, children, className = '', unstyled = false }) {
  const containerClass = unstyled
    ? `${SECTION_PAD} ${className}`
    : `${CARD} ${SECTION_PAD} ${className}`;
  return (
    <section className={containerClass}>
      {(title || badge) && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {title && <h3 className={SECTION}>{title}</h3>}
          {badge}
        </div>
      )}
      {children}
    </section>
  );
}

export function SectionRule({ className = '' }) {
  return <div className={`h-px w-full bg-[var(--ws-border)] dark:bg-[#2A2A2A] ${className}`} />;
}

export function FieldGrid({ cols = 4, children }) {
  const at = {
    2: 'sm:grid-cols-2',
    3: 'sm:grid-cols-2 xl:grid-cols-3',
    4: 'sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4',
  }[cols];
  return <div className={`grid grid-cols-1 gap-x-4 gap-y-3 ${at}`}>{children}</div>;
}

// ─── Field shell ─────────────────────────────────────────────────────────────

export function FieldBlock({ label, hint, tooltip, wide, full, children }) {
  const span = full ? 'sm:col-span-2 xl:col-span-3 2xl:col-span-4' : wide ? 'sm:col-span-2' : '';
  return (
    <div className={`flex min-w-0 flex-col gap-1.5 ${span}`}>
      <label className={`flex flex-wrap items-center gap-x-1.5 gap-y-0.5 ${LABEL}`}>
        <span>{label}</span>
        {tooltip && <InfoTip text={tooltip} />}
        {hint && <span className={FAINT}>{hint}</span>}
      </label>
      {children}
    </div>
  );
}

// ─── Text ────────────────────────────────────────────────────────────────────

// Live input — no click-to-reveal step. Local draft so typing doesn't fire a
// PATCH per keystroke; commits on blur, and on Enter for single-line.
export function EditableText({ value, placeholder, flagged, onSave, multiline, rows = 3 }) {
  const [draft, setDraft] = useState(value ?? '');
  const dirty = useRef(false);
  const area = useRef(null);

  useEffect(() => {
    if (!dirty.current) setDraft(value ?? '');
  }, [value]);

  useEffect(() => {
    const el = area.current;
    if (!multiline || !el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [draft, multiline]);

  const commit = () => {
    dirty.current = false;
    if ((draft ?? '') !== (value ?? '')) onSave?.(draft);
  };

  const onChange = (e) => {
    dirty.current = true;
    setDraft(e.target.value);
  };

  if (multiline) {
    return (
      <textarea
        ref={area}
        value={draft}
        rows={rows}
        placeholder={placeholder}
        onChange={onChange}
        onBlur={commit}
        className={`${TEXTAREA} resize-none overflow-hidden ${flaggedBorder(flagged)}`}
      />
    );
  }

  return (
    <input
      type="text"
      value={draft}
      placeholder={placeholder}
      onChange={onChange}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          dirty.current = false;
          setDraft(value ?? '');
        }
      }}
      className={`${INPUT} ${flaggedBorder(flagged)}`}
    />
  );
}

// ─── Chips ───────────────────────────────────────────────────────────────────

export function ChipList({ items, flagged, onChange, max = 10, placeholder = 'Add…' }) {
  const list = Array.isArray(items) ? items : [];
  const [draft, setDraft] = useState('');

  const add = () => {
    const v = draft.trim();
    if (!v || list.length >= max || list.includes(v)) {
      setDraft('');
      return;
    }
    onChange?.([...list, v]);
    setDraft('');
  };

  return (
    <div className="flex flex-col gap-2">
      {list.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {list.map((item, i) => (
            <span
              key={`${item}-${i}`}
              className={`adfactory-v2-tag-chip inline-flex max-w-full items-center gap-1.5 py-1 pr-1.5 pl-2.5 ${CHIP} ${
                flagged ? FLAG_BORDER : ''
              }`}
            >
              <span className="min-w-0 truncate">{item}</span>
              <button
                type="button"
                onClick={() => onChange?.(list.filter((_, idx) => idx !== i))}
                aria-label={`Remove ${item}`}
                className="shrink-0 text-[#9CA3AF] transition-colors hover:text-[#111827] dark:text-[#8B939E] dark:hover:text-[#ECEFF3]"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      {list.length < max && (
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          onBlur={add}
          placeholder={placeholder}
          className={`${INPUT} ${flaggedBorder(flagged)}`}
        />
      )}
    </div>
  );
}

// ─── Select ──────────────────────────────────────────────────────────────────

export function SelectField({
  value,
  options,
  onChange,
  flagged,
  placeholder = 'Select…',
  disabled,
}) {
  const empty = !options || options.length === 0;

  return (
    <Select value={value || ''} onValueChange={(v) => onChange?.(v)} disabled={disabled || empty}>
      <SelectTrigger
        className={`${CONTROL_H}! w-full ${CONTROL} px-3 shadow-none ${VALUE} ${flaggedBorder(
          flagged
        )} ${disabled || empty ? 'cursor-not-allowed opacity-60' : ''}`}
      >
        <SelectValue placeholder={empty ? 'Nothing to choose from' : placeholder} />
      </SelectTrigger>

      <SelectContent className={`z-9999 max-h-72 ${MENU}`}>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value} className={MENU_ITEM}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ─── Toggle pills ────────────────────────────────────────────────────────────

export function TogglePill({ on, onClick, disabled, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={on}
      className={`${on ? PILL_ON : PILL} disabled:cursor-not-allowed disabled:opacity-40`}
    >
      {children}
    </button>
  );
}

export function PillGroup({ children }) {
  return <div className="flex flex-wrap gap-1.5">{children}</div>;
}

// ─── Stepper ─────────────────────────────────────────────────────────────────

export function Stepper({ value, onChange, min = 1, max = 20, suffix }) {
  const current = Number.isFinite(Number(value)) ? Number(value) : min;
  const set = (n) => onChange?.(Math.min(max, Math.max(min, n)));
  const step =
    'grid w-9 place-items-center self-stretch text-[#6B7280] transition-colors hover:text-[#111827] disabled:cursor-not-allowed disabled:opacity-35 dark:text-[#AFB6C0] dark:hover:text-[#ECEFF3]';

  return (
    <div className="flex items-center gap-2.5">
      <div className={`inline-flex ${CONTROL_H} items-center overflow-hidden ${CONTROL}`}>
        <button
          type="button"
          onClick={() => set(current - 1)}
          disabled={current <= min}
          aria-label="Decrease"
          className={`${step} border-r ${RULE_BORDER}`}
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <span className={`min-w-11 px-1 text-center text-sm font-semibold ${NUM}`}>{current}</span>
        <button
          type="button"
          onClick={() => set(current + 1)}
          disabled={current >= max}
          aria-label="Increase"
          className={`${step} border-l ${RULE_BORDER}`}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      {suffix && <span className={MUTED}>{suffix}</span>}
    </div>
  );
}

// ─── Palette ─────────────────────────────────────────────────────────────────

export function PaletteEditor({ colors, onChange, max = null }) {
  const list = Array.isArray(colors) ? colors : [];
  const commitTimer = useRef(null);
  const capped = Number.isFinite(max);

  const debounced = (fn) => {
    clearTimeout(commitTimer.current);
    commitTimer.current = setTimeout(fn, 250);
  };
  useEffect(() => () => clearTimeout(commitTimer.current), []);

  const replaceAt = (i, hex) => {
    const next = [...list];
    next[i] = String(hex).toUpperCase();
    debounced(() => onChange?.(next));
  };

  return (
    <div className="flex flex-col items-start gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {list.map((hex, i) => (
          <span key={`${hex}-${i}`} className="group relative">
            <input
              type="color"
              value={/^#[0-9a-f]{6}$/i.test(hex) ? hex : '#000000'}
              onChange={(e) => replaceAt(i, e.target.value)}
              title={hex}
              aria-label={`Brand colour ${hex}`}
              className="h-9 w-9 cursor-pointer overflow-hidden rounded-md border border-[var(--ws-border)] bg-transparent p-0 dark:border-white/10"
            />
            <button
              type="button"
              onClick={() => onChange?.(list.filter((_, idx) => idx !== i))}
              aria-label={`Remove ${hex}`}
              className="absolute -top-1.5 -right-1.5 hidden h-4 w-4 place-items-center rounded-full bg-[#111827] text-white group-hover:grid dark:bg-[#ECEFF3] dark:text-[#0A0A0A]"
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </span>
        ))}

        {(!capped || list.length < max) && (
          <label
            title="Add a colour"
            className="grid h-9 w-9 cursor-pointer place-items-center rounded-md border border-dashed border-[var(--ws-border-strong)] bg-[var(--ws-surface-hover)] text-[var(--ws-text-muted)] transition-colors hover:border-[#5867EB]/60 hover:text-[#4654D4] dark:border-white/14 dark:bg-[#2A2A2A] dark:text-[#AFAFAF] dark:hover:border-white/25 dark:hover:text-white"
          >
            <Plus className="h-4 w-4" />
            <input
              type="color"
              defaultValue="#15DCFF"
              onChange={(e) => {
                const hex = e.target.value.toUpperCase();
                debounced(() => {
                  if (!list.includes(hex)) onChange?.([...list, hex]);
                });
              }}
              className="sr-only"
            />
          </label>
        )}
      </div>

      <span className={`${FAINT} ${NUM}`}>{list.length} colours</span>
    </div>
  );
}

// ─── Disclosure ──────────────────────────────────────────────────────────────

export function Disclosure({ title, hint, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`overflow-hidden ${CARD}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
      >
        <span className="flex min-w-0 items-baseline gap-2.5">
          <span className={SECTION}>{title}</span>
          {!open && hint && <span className={`min-w-0 truncate ${MUTED}`}>{hint}</span>}
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-[#9CA3AF] transition-transform dark:text-[#8B939E] ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>
      {open && (
        <div className={`border-t px-5 pt-4 pb-5 ${RULE_BORDER}`}>
          <FieldGrid cols={3}>{children}</FieldGrid>
        </div>
      )}
    </div>
  );
}

// ─── Images ──────────────────────────────────────────────────────────────────

const IMAGE_TYPES = 'image/jpeg,image/png,image/webp,image/gif,image/svg+xml';

export function ImageStrip({
  urls,
  onChange,
  max = 5,
  emptyLabel = 'None found',
  onAddCompetitors,
  uploadFile,
  formatHint = 'JPG, PNG, WebP, GIF, SVG',
  size = 'md',
  fit,
}) {
  const rawList = useMemo(() => (Array.isArray(urls) ? urls.filter(Boolean) : []), [urls]);
  const list = useMemo(() => rawList.slice(0, max), [rawList, max]);
  const [busy, setBusy] = useState(false);
  const [urlDraft, setUrlDraft] = useState('');
  const [showUrl, setShowUrl] = useState(false);
  const [error, setError] = useState('');
  const [previewIndex, setPreviewIndex] = useState(null);
  const [fitOverrides, setFitOverrides] = useState({});
  const [aspects, setAspects] = useState({});

  const isLg = size === 'lg';
  const defaultThumbSizeClass = isLg ? 'w-[116px] h-[72px]' : 'w-[48px] h-[48px]';
  const iconSizeClass = isLg ? 'h-4 w-4' : 'h-4 w-4';

  const handleImgLoad = (url, e) => {
    const { naturalWidth, naturalHeight } = e.currentTarget;
    if (naturalWidth && naturalHeight) {
      setAspects((prev) => ({ ...prev, [url]: naturalWidth / naturalHeight }));
    }
  };

  const getImgFit = (url) => {
    if (fitOverrides[url]) return fitOverrides[url];
    if (fit) return fit;
    if (!isLg) return 'contain';
    const ar = aspects[url];
    // Standard photos (1:1, 4:3, 3:2, 16:9) have ar <= 2.0 and will FILL edge-to-edge.
    // Ultra-wide badges/banners (App Store 3:1, Google Play 2.6:1, ar >= 2.2) will FIT so text is never cropped.
    if (ar && (ar >= 2.2 || ar < 0.6)) return 'contain';
    return 'cover';
  };

  const getThumbSizeClass = (url) => {
    const ar = aspects[url];
    if (!isLg) {
      // Horizontal wordmark logo (e.g. Speedtest, brand name lockup)
      if (ar && ar > 1.3) {
        return 'w-[96px] h-[48px]';
      }
      return 'w-[48px] h-[48px]';
    }
    const currentFit = getImgFit(url);
    if (currentFit === 'contain' && ar && ar >= 2.2) {
      return 'w-[148px] h-[72px]';
    }
    return 'w-[116px] h-[72px]';
  };

  const full = list.length >= max;
  const room = max - list.length;

  useEffect(() => {
    if (rawList.length > max) {
      onChange?.(list);
    }
  }, [rawList.length, max, list, onChange]);

  useEffect(() => {
    if (previewIndex === null) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setPreviewIndex(null);
      } else if (e.key === 'ArrowLeft') {
        setPreviewIndex((prev) => (prev !== null && prev > 0 ? prev - 1 : prev));
      } else if (e.key === 'ArrowRight') {
        setPreviewIndex((prev) => (prev !== null && prev < list.length - 1 ? prev + 1 : prev));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = originalOverflow;
    };
  }, [previewIndex, list.length]);

  const addMany = (incoming) => {
    const merged = [...list];
    for (const u of incoming) {
      if (merged.length >= max) break;
      if (u && !merged.includes(u)) merged.push(u);
    }
    onChange?.(merged);
  };

  const onFiles = async (files) => {
    const picked = Array.from(files || []).slice(0, room);
    if (!picked.length || !uploadFile) return;
    setBusy(true);
    setError('');
    try {
      const uploaded = await Promise.all(picked.map((f) => uploadFile(f)));
      addMany(uploaded.filter(Boolean));
    } catch {
      setError("That upload didn't work. Try again, or add the image by URL.");
    } finally {
      setBusy(false);
    }
  };
  const handlePaste = async (e) => {
    const files = getClipboardImageFiles(e.clipboardData, room);
    if (!files.length || !uploadFile) return;
    e.preventDefault();
    await onFiles(files);
  };

  const addUrl = () => {
    const u = urlDraft.trim();
    if (!u) return;
    if (!/^https?:\/\//i.test(u)) {
      setError('Paste a full image URL starting with http.');
      return;
    }
    addMany([u]);
    setUrlDraft('');
    setShowUrl(false);
    setError('');
  };

  return (
    <div className="flex flex-col gap-2" onPaste={handlePaste} tabIndex={0}>
      <div className="flex flex-wrap items-center gap-2">
        {list.map((url, i) => {
          const currentFit = getImgFit(url);
          const thumbClass = getThumbSizeClass(url);
          const isContain = currentFit === 'contain';

          return (
            <div
              key={`${url}-${i}`}
              className={`group relative flex items-center justify-center overflow-hidden ${thumbClass} cursor-pointer rounded-lg border border-[var(--ws-border)] ${
                !isLg
                  ? 'bg-white p-2 shadow-2xs dark:border-[#333] dark:bg-[#1C1C1C]'
                  : 'bg-[var(--ws-surface-hover)] dark:border-[#2A2A2A] dark:bg-[#1a1a1a]'
              } transition-all hover:border-[#5867EB]/60 hover:shadow-md dark:hover:border-[#15DCFF]/60`}
              onClick={() => setPreviewIndex(i)}
              title={!isLg && i === 0 ? 'Primary brand logo · Click to preview' : 'Click to preview'}
            >
              {/* If in contain mode on large visuals, render a soft blurred ambient fill so there are no empty gaps */}
              {isLg && isContain && (
                <img
                  src={url}
                  alt=""
                  aria-hidden="true"
                  className="absolute inset-0 h-full w-full object-cover blur-md scale-125 opacity-35 dark:opacity-45 pointer-events-none"
                />
              )}

              <img
                src={url}
                alt=""
                loading="lazy"
                onLoad={(e) => handleImgLoad(url, e)}
                className={`relative z-1 h-full w-full ${
                  !isLg ? 'object-contain' : isContain ? 'object-contain p-1.5' : 'object-cover'
                } transition-transform duration-200 group-hover:scale-105`}
                onError={(e) => {
                  e.currentTarget.style.opacity = '0.25';
                }}
              />

              {/* Primary logo badge */}
              {!isLg && i === 0 && list.length > 1 && (
                <span className="absolute bottom-0.5 left-1 rounded bg-[#5867EB]/10 px-1 py-0.2 text-[7.5px] font-bold tracking-tight text-[#4654D4] dark:bg-[#15DCFF]/15 dark:text-[#15DCFF] pointer-events-none">
                  Main
                </span>
              )}

              {/* Hover overlay with preview eye icon */}
              <div className="absolute inset-0 z-2 flex items-center justify-center bg-black/40 opacity-0 transition-opacity duration-150 group-hover:opacity-100 pointer-events-none rounded-lg">
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-xs">
                  <Eye className="h-3.5 w-3.5" />
                </div>
              </div>

              {/* Quick Fit / Fill toggle button on hover for Key visuals */}
              {isLg && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setFitOverrides((prev) => ({
                      ...prev,
                      [url]: isContain ? 'cover' : 'contain',
                    }));
                  }}
                  title={isContain ? 'Switch to Fill (cover frame)' : 'Switch to Fit (show full image)'}
                  className="absolute bottom-1 left-1 z-10 flex h-5 items-center gap-1 rounded bg-black/75 px-1.5 text-[9.5px] font-semibold text-white opacity-0 transition-all hover:bg-black group-hover:opacity-100 backdrop-blur-xs cursor-pointer shadow-xs"
                >
                  {isContain ? 'Fill' : 'Fit'}
                </button>
              )}

              {/* Remove button */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange?.(list.filter((_, idx) => idx !== i));
                }}
                aria-label="Remove image"
                title="Remove image"
                className="absolute top-1 right-1 z-10 flex h-4 w-4 items-center justify-center rounded-full bg-[#111827]/80 text-white opacity-0 transition-all hover:bg-[#111827] group-hover:opacity-100 dark:bg-[#ECEFF3]/90 dark:text-[#0A0A0A] dark:hover:bg-white cursor-pointer"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </div>
          );
        })}

        {!full && uploadFile && (
          <label
            title="Upload from device"
            className={`grid ${defaultThumbSizeClass} cursor-pointer place-items-center ${THUMB_ADD} transition-colors`}
          >
            {busy ? (
              <Loader2 className={`${iconSizeClass} animate-spin`} />
            ) : (
              <div className="flex flex-col items-center justify-center gap-0.5">
                <Plus className={iconSizeClass} />
                {isLg && <span className="text-[10px] font-medium opacity-70">Upload</span>}
              </div>
            )}
            <input
              type="file"
              accept={IMAGE_TYPES}
              multiple
              disabled={busy}
              onChange={(e) => {
                onFiles(e.target.files);
                e.target.value = '';
              }}
              className="sr-only"
            />
          </label>
        )}

        {!full && onAddCompetitors && (
          <button
            type="button"
            onClick={onAddCompetitors}
            className={
              isLg
                ? 'inline-flex h-[72px] items-center gap-2 rounded-lg border border-[#5867EB]/30 bg-[#5867EB]/10 px-3 text-xs font-medium text-[#4654D4] transition-colors hover:border-[#5867EB]/55 hover:bg-[#5867EB]/15 dark:border-[#15DCFF]/25 dark:bg-[#15DCFF]/8 dark:text-[#15DCFF] dark:hover:border-[#15DCFF]/45 dark:hover:bg-[#15DCFF]/12'
                : 'inline-flex h-10 items-center gap-2 rounded-md border border-[#5867EB]/30 bg-[#5867EB]/10 px-2 text-[11px] font-medium text-[#4654D4] transition-colors hover:border-[#5867EB]/55 hover:bg-[#5867EB]/15 dark:border-[#15DCFF]/25 dark:bg-[#15DCFF]/8 dark:text-[#15DCFF] dark:hover:border-[#15DCFF]/45 dark:hover:bg-[#15DCFF]/12'
            }
          >
            <Search className="h-3.5 w-3.5" />
            <span>Competitor visuals</span>
          </button>
        )}

        {list.length === 0 && !uploadFile && <p className={FAINT}>{emptyLabel}</p>}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {!full && (
          <button type="button" onClick={() => setShowUrl((v) => !v)} className={BTN_LINK}>
            Add from URL or paste image
          </button>
        )}
        {full && <span className={FAINT}>{max} is the maximum — remove one to add another.</span>}
      </div>

      {showUrl && !full && (
        <div className="flex items-center gap-2">
          <input
            type="url"
            value={urlDraft}
            placeholder="https://…/image.jpg"
            onChange={(e) => setUrlDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addUrl();
              }
            }}
            className={`min-w-0 flex-1 ${INPUT}`}
          />
          <button
            type="button"
            onClick={addUrl}
            className={`shrink-0 ${CONTROL_H} rounded-md bg-[#B87215] px-3.5 text-[11px] font-semibold text-white dark:bg-[#15DCFF] dark:text-[#062024]`}
          >
            Add
          </button>
        </div>
      )}

      {error ? (
        <p className="text-13 text-[#DC2626] dark:text-[#F87171]">{error}</p>
      ) : (
        uploadFile && <p className={FAINT}>Supported: {formatHint}</p>
      )}

      {/* Lightbox / Image Preview Modal */}
      {previewIndex !== null && list[previewIndex] && typeof document !== 'undefined' &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Image preview"
            onClick={() => setPreviewIndex(null)}
            className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-black/85 backdrop-blur-md p-4 sm:p-6 animate-in fade-in duration-200"
          >
            {/* Top Bar */}
            <div className="absolute top-4 inset-x-4 sm:top-6 sm:inset-x-6 z-20 flex items-center justify-between pointer-events-none">
              <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-white/15 bg-black/50 px-3.5 py-1.5 text-xs font-medium text-white/90 shadow-lg backdrop-blur-md">
                <span>{`Visual ${previewIndex + 1} of ${list.length}`}</span>
              </div>

              <div className="pointer-events-auto flex items-center gap-2">
                <a
                  href={list[previewIndex]}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  title="Open original in new tab"
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-black/50 text-white/90 shadow-lg backdrop-blur-md transition-all hover:bg-white/20 hover:text-white"
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setPreviewIndex(null);
                  }}
                  title="Close (Esc)"
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-black/50 text-white/90 shadow-lg backdrop-blur-md transition-all hover:bg-white/20 hover:text-white cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Centered Image with Nav Chevrons */}
            <div
              className="relative flex items-center justify-center max-h-[75vh] max-w-[90vw]"
              onClick={(e) => e.stopPropagation()}
            >
              {list.length > 1 && (
                <button
                  type="button"
                  disabled={previewIndex === 0}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (previewIndex > 0) setPreviewIndex(previewIndex - 1);
                  }}
                  title="Previous (Left arrow)"
                  className="absolute -left-4 sm:-left-14 z-20 flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-black/60 text-white/90 shadow-lg backdrop-blur-md transition-all hover:bg-white/20 hover:text-white disabled:opacity-20 disabled:pointer-events-none cursor-pointer"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
              )}

              <img
                src={list[previewIndex]}
                alt={`Visual ${previewIndex + 1}`}
                className="max-h-[75vh] max-w-[85vw] rounded-xl object-contain shadow-2xl ring-1 ring-white/10 select-none bg-black/20"
              />

              {list.length > 1 && (
                <button
                  type="button"
                  disabled={previewIndex === list.length - 1}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (previewIndex < list.length - 1) setPreviewIndex(previewIndex + 1);
                  }}
                  title="Next (Right arrow)"
                  className="absolute -right-4 sm:-right-14 z-20 flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-black/60 text-white/90 shadow-lg backdrop-blur-md transition-all hover:bg-white/20 hover:text-white disabled:opacity-20 disabled:pointer-events-none cursor-pointer"
                >
                  <ChevronRight className="h-5 w-5" />
                </button>
              )}
            </div>

            {/* Bottom thumbnail selector if multiple */}
            {list.length > 1 && (
              <div
                onClick={(e) => e.stopPropagation()}
                className="absolute bottom-4 sm:bottom-6 z-20 flex items-center gap-2 rounded-xl border border-white/15 bg-black/60 p-1.5 shadow-lg backdrop-blur-md max-w-[90vw] overflow-x-auto"
              >
                {list.map((u, idx) => (
                  <button
                    key={`preview-thumb-${idx}`}
                    type="button"
                    onClick={() => setPreviewIndex(idx)}
                    className={`h-11 w-11 shrink-0 rounded-md overflow-hidden border transition-all cursor-pointer ${
                      idx === previewIndex
                        ? 'border-[#15DCFF] ring-2 ring-[#15DCFF]/50 scale-105'
                        : 'border-white/20 opacity-60 hover:opacity-100'
                    }`}
                  >
                    <img src={u} alt="" className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>,
          document.body
        )}
    </div>
  );
}
