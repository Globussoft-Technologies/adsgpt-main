import React, { useEffect, useRef, useState } from 'react';
import { Loader2, Minus, Plus, X } from 'lucide-react';
import {
  CollapsibleCard,
  DarkInput,
  Field,
  InfoTip,
} from '@/components/Autopilot/_atoms';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// ----------------------------------------------------------------------------
// Editable field primitives for the brief screen.
//
// Vocabulary is AUTOPILOT (components/Autopilot/_atoms.jsx), and wherever
// Autopilot already has the atom we import it rather than restyling a copy —
// `Field`, `DarkInput`, `CollapsibleCard` and `InfoTip` come straight from
// there, so the two surfaces cannot drift apart.
//
// Why Autopilot rather than the darker AI-Assistant treatment that was here
// before: Autopilot's surfaces are SOLID and clearly separated in value —
// page (#0f0f0f) → card (#14181D) → control (white/6). Every step is a visible
// lift. The previous pass had the card at `white/2` and the control at `#111`,
// a couple of percent apart against a near-black page: technically structured,
// visibly not.
//
// The atoms below are the ones Autopilot doesn't have — chips, swatches, toggle
// pills, a stepper and an image strip. Each is built from Autopilot's own
// sizes, radii and colours.
// ----------------------------------------------------------------------------

// Autopilot's control fill, for the atoms that aren't a plain <input>.
const CONTROL =
  'rounded-xl border border-gray-300 bg-gray-100 text-gray-900 dark:border-white/12 dark:bg-white/6 dark:text-white';

// Low confidence gets an amber border. It is the only place amber appears on a
// field, so "worth a look" stays unambiguous.
const flaggedBorder = (flagged) =>
  flagged ? '!border-amber-500/50 dark:!border-amber-500/40' : '';

// ─── Field shell ─────────────────────────────────────────────────────────────

// Autopilot's `Field` — uppercase micro-label above, optional hint below.
export function FieldBlock({ label, hint, tooltip, wide, children }) {
  return (
    <div className={wide ? 'min-w-0 sm:col-span-2' : 'min-w-0'}>
      <Field
        label={
          tooltip ? (
            <span className="inline-flex items-center gap-1">
              {label}
              <InfoTip text={tooltip} />
            </span>
          ) : (
            label
          )
        }
        hint={hint}
      >
        {children}
      </Field>
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
        className={`w-full resize-y rounded-xl border border-gray-300 bg-gray-100 px-3 py-2 text-xs leading-relaxed text-gray-900 placeholder:text-gray-400 focus:border-[#15DCFF]/40 focus:bg-gray-50 focus:outline-none dark:border-white/12 dark:bg-white/6 dark:text-white dark:placeholder:text-white/45 dark:focus:bg-white/8 2xl:px-3.5 2xl:text-13 ${flaggedBorder(flagged)}`}
      />
    );
  }

  return (
    <DarkInput
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
      className={flaggedBorder(flagged)}
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
              className={`inline-flex max-w-full items-center gap-1.5 rounded-lg border py-1 pr-1.5 pl-2.5 text-xs ${
                flagged
                  ? 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                  : 'border-gray-200 bg-gray-100 text-gray-700 dark:border-white/10 dark:bg-white/6 dark:text-white/85'
              }`}
            >
              <span className="min-w-0 truncate">{item}</span>
              <button
                type="button"
                onClick={() => onChange?.(list.filter((_, idx) => idx !== i))}
                aria-label={`Remove ${item}`}
                className="shrink-0 text-gray-400 transition-colors hover:text-gray-900 dark:text-white/45 dark:hover:text-white"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      {list.length < max && (
        <DarkInput
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
        />
      )}
    </div>
  );
}

// ─── Select ──────────────────────────────────────────────────────────────────

export function SelectField({ value, options, onChange, flagged, placeholder = 'Select…', disabled }) {
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
        className={`h-9! w-full rounded-xl border bg-gray-100 px-3 text-xs text-gray-900 shadow-none dark:bg-white/6 dark:text-white 2xl:h-10! 2xl:text-13 ${
          flagged
            ? 'border-amber-500/60 dark:border-amber-500/50'
            : 'border-gray-300 dark:border-white/12'
        } ${disabled || empty ? 'cursor-not-allowed opacity-60' : ''}`}
      >
        <SelectValue placeholder={empty ? 'Nothing to choose from' : placeholder} />
      </SelectTrigger>

      <SelectContent className="z-9999 max-h-72 border border-black/10 bg-white text-gray-900 dark:border-white/20 dark:bg-[#14181D] dark:text-white">
        {options.map((o) => (
          <SelectItem
            key={o.value}
            value={o.value}
            className="text-xs 2xl:text-13 dark:focus:bg-white/10"
          >
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ─── Toggle pills ────────────────────────────────────────────────────────────

// Selected uses Autopilot's cyan tint (the same treatment DateRangeFilter gives
// an active filter) — on this surface cyan consistently means "this one is on".
export function TogglePill({ on, onClick, disabled, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={on}
      className={`h-8 rounded-xl border px-3 text-xs font-medium transition-all disabled:opacity-50 2xl:text-13 ${
        on
          ? 'border-[#15DCFF]/30 bg-[#15DCFF]/10 text-[#15DCFF]'
          : 'border-gray-200 bg-gray-100 text-gray-600 hover:border-gray-300 hover:text-gray-900 dark:border-white/10 dark:bg-white/6 dark:text-white/70 dark:hover:border-white/20 dark:hover:text-white'
      }`}
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
  const btn = `flex h-9 w-9 items-center justify-center ${CONTROL} transition-colors hover:border-gray-400 disabled:opacity-40 dark:hover:border-white/25 2xl:h-10 2xl:w-10`;

  return (
    <div className="inline-flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => set(current - 1)}
        disabled={current <= min}
        aria-label="Decrease"
        className={btn}
      >
        <Minus className="h-3.5 w-3.5" />
      </button>
      <span className="min-w-9 text-center text-13 font-bold text-gray-900 tabular-nums dark:text-white">
        {current}
      </span>
      <button
        type="button"
        onClick={() => set(current + 1)}
        disabled={current >= max}
        aria-label="Increase"
        className={btn}
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
      {suffix && (
        <span className="ml-1 text-10 tracking-wider text-gray-500 uppercase dark:text-white/55 2xl:text-[11px]">
          {suffix}
        </span>
      )}
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
    <div className="flex flex-wrap items-center gap-2">
      {list.map((hex, i) => (
        <span key={`${hex}-${i}`} className="group relative">
          <input
            type="color"
            value={/^#[0-9a-f]{6}$/i.test(hex) ? hex : '#000000'}
            onChange={(e) => replaceAt(i, e.target.value)}
            title={hex}
            aria-label={`Brand colour ${hex}`}
            className="h-9 w-9 cursor-pointer rounded-xl border border-gray-300 bg-transparent p-0.5 dark:border-white/12 2xl:h-10 2xl:w-10"
          />
          <button
            type="button"
            onClick={() => onChange?.(list.filter((_, idx) => idx !== i))}
            aria-label={`Remove ${hex}`}
            className="absolute -top-1.5 -right-1.5 hidden h-4 w-4 place-items-center rounded-full bg-gray-900 text-white group-hover:grid dark:bg-white dark:text-black"
          >
            <X className="h-2.5 w-2.5" />
          </button>
        </span>
      ))}

      {list.length < max && (
        <label
          title="Add a colour"
          className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl border border-dashed border-gray-300 text-gray-400 transition-colors hover:border-[#15DCFF]/40 hover:text-[#15DCFF] dark:border-white/15 dark:text-white/45 2xl:h-10 2xl:w-10"
        >
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
    </div>
  );
}

// ─── Disclosure ──────────────────────────────────────────────────────────────

// Autopilot's CollapsibleCard. Progressive disclosure is what keeps this screen
// from turning back into v1's six-modal form: everything inside is already
// filled in, one click away, never a blocker.
export function Disclosure({ title, hint, children, defaultOpen = false }) {
  return (
    <CollapsibleCard title={title} preview={hint} defaultOpen={defaultOpen}>
      <div className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2 2xl:grid-cols-3">
        {children}
      </div>
    </CollapsibleCard>
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
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {list.map((url, i) => (
          <span key={`${url}-${i}`} className="group relative">
            <img
              src={url}
              alt=""
              loading="lazy"
              className="h-14 w-14 rounded-xl border border-gray-200 bg-gray-100 object-cover dark:border-white/10 dark:bg-white/6"
              onError={(e) => {
                e.currentTarget.style.opacity = '0.25';
              }}
            />
            <button
              type="button"
              onClick={() => onChange?.(list.filter((_, idx) => idx !== i))}
              aria-label="Remove image"
              className="absolute -top-1.5 -right-1.5 hidden h-5 w-5 place-items-center rounded-full bg-gray-900 text-white group-hover:grid dark:bg-white dark:text-black"
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
            className="flex h-14 w-14 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-xl border border-dashed border-gray-300 text-gray-400 transition-colors hover:border-[#15DCFF]/40 hover:text-[#15DCFF] dark:border-white/15 dark:text-white/45"
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <>
                <Plus className="h-3.5 w-3.5" />
                <span className="text-10">Upload</span>
              </>
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

        {list.length === 0 && !uploadFile && (
          <p className="rounded-xl border border-dashed border-gray-300 px-3 py-2.5 text-xs text-gray-400 dark:border-white/12 dark:text-white/45 2xl:text-13">
            {emptyLabel}
          </p>
        )}

        <span className="ml-auto shrink-0 text-10 text-gray-400 tabular-nums dark:text-white/40">
          {list.length} / {max}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {!full && (
          <button
            type="button"
            onClick={() => setShowUrl((v) => !v)}
            className="text-xs font-semibold text-[#6b72f8] underline underline-offset-2 dark:text-[#aeb6ff]"
          >
            Add from URL
          </button>
        )}
        {!full && onAddCompetitors && (
          <button
            type="button"
            onClick={onAddCompetitors}
            className="text-xs font-semibold text-[#6b72f8] underline underline-offset-2 dark:text-[#aeb6ff]"
          >
            Use a competitor&apos;s ad
          </button>
        )}
        {full && (
          <span className="text-xs text-gray-400 dark:text-white/45">
            {max} is the maximum — remove one to add another.
          </span>
        )}
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
            className="h-9 min-w-0 flex-1 rounded-xl border border-gray-300 bg-gray-100 px-3 text-13 text-gray-900 outline-none focus:border-[#15DCFF]/40 dark:border-white/12 dark:bg-white/6 dark:text-white"
          />
          <button
            type="button"
            onClick={addUrl}
            className="h-9 shrink-0 rounded-xl bg-gray-900 px-3 text-13 font-semibold text-white dark:bg-white dark:text-black"
          >
            Add
          </button>
        </div>
      )}

      {error ? (
        <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
      ) : (
        uploadFile && (
          <p className="text-xs text-gray-400 dark:text-white/45">Supported: {formatHint}</p>
        )
      )}
    </div>
  );
}
