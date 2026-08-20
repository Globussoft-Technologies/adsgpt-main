import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Loader2, Minus, Plus, Search, X } from 'lucide-react';
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
//
// These used to be built on Autopilot's atoms. They are built on `_tokens.js`
// now — the "Refined" system — for one reason: Autopilot's field vocabulary is
// a 10px bold uppercase letterspaced label above every control, and repeated
// across twenty fields that is what made this screen read as a settings dump
// rather than a brief. Autopilot is a monitoring surface where every row is
// equally weighted and that treatment is right; this is a document you read.
//
// What is shared with Autopilot is only `InfoTip`, because a portalled tooltip
// that measures itself against the viewport is behaviour, not styling, and
// there is no reason for two of them.
//
// The ramp every atom below sits on:
//
//   section   14px / 600   what part of the brief this is
//   value     14px / 500   what the brief says
//   label     13px / 400   grey, sentence case — what this field is called
//   hint      13px / 400   grey, only when the label alone isn't enough
// ----------------------------------------------------------------------------

// Low confidence gets an amber border. It is the only place amber appears on a
// field, so "worth a look" stays unambiguous.
const flaggedBorder = (flagged) => (flagged ? FLAG_BORDER : '');

// ─── Section ─────────────────────────────────────────────────────────────────

// One band of a card, divided from its neighbours by a hairline rather than
// being a card of its own. Nested cards were how the brief ended up looking
// like six stacked panels; a brief is one document with parts.
export function Section({ title, badge, children, className = '' }) {
  return (
    <section className={`${SECTION_PAD} ${className}`}>
      {(title || badge) && (
        <div className="mb-4 flex flex-wrap items-center gap-2.5">
          {title && <h3 className={SECTION}>{title}</h3>}
          {badge}
        </div>
      )}
      {children}
    </section>
  );
}

// The rule between two sections.
export function SectionRule() {
  return <div className={`border-t ${RULE_BORDER}`} />;
}

// The grid a section's fields sit on. Four columns at the widest so a row of
// short values doesn't stretch to the full page width.
export function FieldGrid({ cols = 4, children }) {
  const at = {
    2: 'sm:grid-cols-2',
    3: 'sm:grid-cols-2 xl:grid-cols-3',
    4: 'sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4',
  }[cols];
  return <div className={`grid grid-cols-1 gap-x-5 gap-y-4 ${at}`}>{children}</div>;
}

// ─── Field shell ─────────────────────────────────────────────────────────────

export function FieldBlock({ label, hint, tooltip, wide, full, children }) {
  const span = full ? 'sm:col-span-2 xl:col-span-3 2xl:col-span-4' : wide ? 'sm:col-span-2' : '';
  return (
    <div className={`flex min-w-0 flex-col gap-2 ${span}`}>
      {/* Label, tip and hint on ONE line. The hint used to sit BELOW the
          control, which put a third piece of type under every field and pushed
          the next row down by a line it did not need. Beside the label it reads
          as part of the field's name, which is what a hint is. */}
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

  // Re-seed when the server sends a newer value — but never mid-edit, which
  // would yank half-typed text out from under the user.
  useEffect(() => {
    if (!dirty.current) setDraft(value ?? '');
  }, [value]);

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
        value={draft}
        rows={rows}
        placeholder={placeholder}
        onChange={onChange}
        onBlur={commit}
        className={`${TEXTAREA} ${flaggedBorder(flagged)}`}
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
              className={`inline-flex max-w-full items-center gap-1.5 py-1 pr-1.5 pl-2.5 ${CHIP} ${
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
  // The project's shadcn Select, the same primitive Full control's
  // InputCommonDropdown and the shared CommonDropdown are built on. A native
  // <select> was wrong here for reasons that are not cosmetic: it cannot be
  // styled to match the surrounding controls on either theme, its option list
  // is drawn by the OS so it ignores the app's dark palette entirely, and it
  // has no empty state — an objective list that failed to load rendered as a
  // silently empty box.
  const empty = !options || options.length === 0;

  return (
    <Select value={value || ''} onValueChange={(v) => onChange?.(v)} disabled={disabled || empty}>
      <SelectTrigger
        className={`${CONTROL_H}! w-full ${CONTROL} px-3 shadow-none ${VALUE} ${flaggedBorder(
          flagged,
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

// Selected is indigo — the same indigo as the primary button, and the only
// other place it appears. On this surface indigo means "this one is on".
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

// One segmented control rather than three floating parts — minus, the number,
// plus, inside a single 36px shell with internal hairlines.
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

// Swatches only. The hex string isn't information anyone needs while reviewing
// a brief — they're picking a colour, and a colour is what a swatch shows. The
// value is still available on hover and inside the picker.
//
// Editing is direct: click a swatch to change it in place, × to drop it, + to
// add. No text field, so there's no way to type an invalid value at all.
export function PaletteEditor({ colors, onChange, max = 12 }) {
  const list = Array.isArray(colors) ? colors : [];
  const commitTimer = useRef(null);

  // <input type="color"> fires continuously while the user drags through the
  // picker; committing per event would write a trail of intermediate colours.
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
    <div className="flex flex-wrap items-center gap-1.5">
      {list.map((hex, i) => (
        <span key={`${hex}-${i}`} className="group relative">
          <input
            type="color"
            value={/^#[0-9a-f]{6}$/i.test(hex) ? hex : '#000000'}
            onChange={(e) => replaceAt(i, e.target.value)}
            title={hex}
            aria-label={`Brand colour ${hex}`}
            className={`h-7 w-7 cursor-pointer bg-transparent p-0 ${THUMB}`}
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

      {list.length < max && (
        <label title="Add a colour" className={`grid h-7 w-7 cursor-pointer place-items-center ${THUMB_ADD}`}>
          <Plus className="h-3.5 w-3.5" />
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

      <span className={`ml-1 ${FAINT} ${NUM}`}>
        {list.length}/{max}
      </span>
    </div>
  );
}

// ─── Disclosure ──────────────────────────────────────────────────────────────

// Kept for the surfaces that still want a card that folds. Inside Adjust the
// sections no longer fold at all — the user asked for everything open — so
// this is now only used where a genuinely optional block hangs off a screen.
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

// ImageStrip — a real asset editor, not a read-only strip.
//
// This was thumbnails plus a remove button and nothing else: no way to add a
// logo the scrape missed, no upload, no URL, no competitor visuals. v1's "Key
// visuals" node has all three, and key visuals are one of the strongest inputs
// to what the generator actually draws — "review and prune what we found" was
// too thin a job for it.
//
// `max` was also only a DISPLAY cap — `slice(0, max)` hid the overflow while
// still sending it. Hiding assets that remain in the payload is worse than no
// limit, so the cap is enforced on the way IN and the count is stated on
// screen, the way v1 states "4 / 5 assets".
const IMAGE_TYPES = 'image/jpeg,image/png,image/webp,image/gif,image/svg+xml';

export function ImageStrip({
  urls,
  onChange,
  max = 5,
  emptyLabel = 'None found',
  onAddCompetitors,
  uploadFile,
  formatHint = 'JPG, PNG, WebP, GIF, SVG',
}) {
  const list = Array.isArray(urls) ? urls.filter(Boolean) : [];
  const [busy, setBusy] = useState(false);
  const [urlDraft, setUrlDraft] = useState('');
  const [showUrl, setShowUrl] = useState(false);
  const [error, setError] = useState('');

  const full = list.length >= max;
  const room = max - list.length;

  // Adds are capped and de-duplicated here rather than at each call site —
  // uploading four files with two slots left must add two, not overflow.
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
      <div className="flex flex-wrap items-center gap-1.5">
        {list.map((url, i) => (
          <span key={`${url}-${i}`} className="group relative">
            <img
              src={url}
              alt=""
              loading="lazy"
              className={`h-11 w-11 ${THUMB}`}
              onError={(e) => {
                e.currentTarget.style.opacity = '0.25';
              }}
            />
            <button
              type="button"
              onClick={() => onChange?.(list.filter((_, idx) => idx !== i))}
              aria-label="Remove image"
              className="absolute -top-1.5 -right-1.5 hidden h-5 w-5 place-items-center rounded-full bg-[#111827] text-white group-hover:grid dark:bg-[#ECEFF3] dark:text-[#0A0A0A]"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}

        {/* Only while there is room. A tile that stays put and silently does
            nothing once you hit the cap is how a limit gets read as a bug. */}
        {!full && uploadFile && (
          <label
            title="Upload from device"
            className={`grid h-11 w-11 cursor-pointer place-items-center ${THUMB_ADD}`}
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Plus className="h-3.5 w-3.5" />
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
            className="inline-flex h-11 items-center gap-2 rounded-[7px] border border-[#02C8C4]/30 bg-[#02C8C4]/8 px-2 text-13 font-medium text-[#0B7A78] transition-colors hover:border-[#02C8C4]/55 hover:bg-[#02C8C4]/12 dark:border-[#15DCFF]/25 dark:bg-[#15DCFF]/8 dark:text-[#15DCFF] dark:hover:border-[#15DCFF]/45 dark:hover:bg-[#15DCFF]/12"
          >
            <Search className="h-3.5 w-3.5" />
            <span>Competitor visuals</span>
          </button>
        )}

        {list.length === 0 && !uploadFile && <p className={FAINT}>{emptyLabel}</p>}

        <span className={`ml-1 ${FAINT} ${NUM}`}>
          {list.length}/{max}
        </span>
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
            className={`shrink-0 ${CONTROL_H} rounded-lg bg-[#02C8C4] px-3.5 text-13 font-semibold text-[#062024] dark:bg-[#15DCFF]`}
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
    </div>
  );
}
