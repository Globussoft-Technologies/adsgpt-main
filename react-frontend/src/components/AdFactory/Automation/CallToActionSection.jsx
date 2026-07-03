import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MousePointerClick, Link as LinkIcon, AlertCircle, ChevronDown, Check } from 'lucide-react';

// ----------------------------------------------------------------------------
// CallToActionSection — the Meta ad's Call-to-Action button + destination URL.
//
// The presets match Meta's CTA enum values exactly so the backend can pass
// them through unchanged. Order mirrors Meta Ads Manager's default sort.
// ----------------------------------------------------------------------------

export const CTA_BUTTON_OPTIONS = [
  { value: 'LEARN_MORE', label: 'Learn More' },
  { value: 'SHOP_NOW', label: 'Shop Now' },
  { value: 'SIGN_UP', label: 'Sign Up' },
  { value: 'CONTACT_US', label: 'Contact Us' },
  { value: 'DOWNLOAD', label: 'Download' },
  { value: 'GET_QUOTE', label: 'Get Quote' },
  { value: 'BOOK_TRAVEL', label: 'Book Now' },
  { value: 'SUBSCRIBE', label: 'Subscribe' },
  { value: 'APPLY_NOW', label: 'Apply Now' },
  { value: 'GET_OFFER', label: 'Get Offer' },
];

// Strict URL pattern: requires http(s)://, then ONLY the ASCII characters
// allowed in URI syntax (RFC 3986 unreserved + reserved + percent-encoding).
// Rejects emoji, accented characters, zero-width joiners, and anything else
// outside printable ASCII URL-safe characters. Meta's ad endpoints choke on
// these too, so filtering client-side avoids a confusing backend rejection.
const URL_PATTERN =
  /^https?:\/\/[a-zA-Z0-9\-._~:/?#[\]@!$&'()*+,;=%]+$/;

// Cheap pre-check: if the string contains ANY non-ASCII codepoint, fail fast.
// The regex above does this implicitly but explicit catches emoji-in-path
// cases more reliably across engines (some flag-emoji sequences sneak through
// charset shortcuts in older runtimes). Uses the Unicode property escape so
// supplementary-plane codepoints (most emoji) match correctly without
// needing surrogate-pair handling — and avoids `\x00` which would trip the
// no-control-regex lint rule.
const NON_ASCII_RE = /[^\p{ASCII}]/u;

export function isValidCtaUrl(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (NON_ASCII_RE.test(trimmed)) return false;
  return URL_PATTERN.test(trimmed);
}

// Returns true only when `value` is one of the allowed CTA values for the
// caller's option list. Pass the live options (from /cta-options keyed by
// objective) to validate against the current backend rules; omit them to
// fall back to the full hardcoded set.
export function isValidCtaButton(value, options) {
  const source = Array.isArray(options) ? options : CTA_BUTTON_OPTIONS;
  return source.some((o) => o.value === value);
}

export default function CallToActionSection({
  value,
  onChange,
  disabled,
  locked = false,
  onLockedInteraction,
  // Live option list driven by the picked campaign's objective. When null we
  // render the full static list (no campaign picked yet) so the section's
  // visual shape is preserved while it's locked.
  options = null,
  // True while /cta-options is in flight for the current objective.
  loading = false,
}) {
  const button = value?.button || null;
  const url = value?.url || '';
  const urlTouched = url.length > 0;
  const urlValid = !urlTouched || isValidCtaUrl(url);

  // Effective option list — live options when available, static fallback
  // otherwise. The selected-label lookup uses the same list so it can still
  // resolve a previously-applied button after a refresh.
  const effectiveOptions = Array.isArray(options) ? options : CTA_BUTTON_OPTIONS;

  const patch = (partial) => onChange?.({ ...(value || {}), ...partial });

  // When `locked`, the section stays visually present (so the user sees what's
  // coming next) but every interaction is intercepted to surface the gate
  // reason. `disabled` is the harder "Meta not connected" state.
  const handleLockedClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    onLockedInteraction?.();
  };

  return (
    <section
      className={`flex flex-col gap-2.5 rounded-xl border border-white/10 bg-white/2 px-4 py-3 transition ${
        disabled ? 'pointer-events-none opacity-50' : ''
      } ${locked ? 'opacity-60' : ''}`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MousePointerClick className="size-4 text-[#15DCFF]" />
          <h3 className="text-sm font-semibold text-white 2xl:text-base">
            Call-to-Action
            <span className="ml-0.5 text-red-400">*</span>
          </h3>
        </div>
        {button && (
          <span className="rounded-full border border-[#15DCFF]/30 bg-[#15DCFF]/10 px-2.5 py-0.5 text-[11px] font-medium text-[#15DCFF]">
            {effectiveOptions.find((o) => o.value === button)?.label || button}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,11rem)_1fr]">
        <ToggleableCtaDropdown
          options={effectiveOptions}
          value={button}
          onChange={(next) => patch({ button: next })}
          disabled={disabled}
          locked={locked}
          loading={loading}
          onLockedInteraction={onLockedInteraction}
        />
        <div
          className={`flex items-center gap-2 rounded-lg border bg-[#0D0D0D]/40 px-3 transition focus-within:border-[#15DCFF]/60 ${
            urlValid ? 'border-white/10' : 'border-red-500/40'
          } ${locked ? 'cursor-not-allowed' : ''}`}
          onMouseDownCapture={locked ? handleLockedClick : undefined}
        >
          <LinkIcon className="size-4 shrink-0 text-[#AFAFAF]" />
          <input
            type="url"
            inputMode="url"
            value={url}
            onChange={(e) => patch({ url: e.target.value })}
            placeholder="https://your-landing-page.com"
            disabled={disabled}
            readOnly={locked}
            onFocus={locked ? (e) => { e.target.blur(); onLockedInteraction?.(); } : undefined}
            className={`h-10 w-full bg-transparent text-sm text-white outline-none placeholder:text-[#666] disabled:cursor-not-allowed disabled:opacity-50 ${
              locked ? 'cursor-not-allowed' : ''
            }`}
          />
        </div>
      </div>
      {!urlValid && (
        <div className="flex items-center gap-1.5 text-[11px] text-red-400">
          <AlertCircle className="size-3" />
          {NON_ASCII_RE.test(url)
            ? 'URL can only contain plain ASCII characters — no emojis or accents.'
            : 'Enter a full URL starting with http:// or https://'}
        </div>
      )}
    </section>
  );
}

// ============================================================================
// ToggleableCtaDropdown — small custom dropdown with click-to-deselect.
//
// Shadcn's Select doesn't fire onValueChange when you re-click the active
// option, so we own the click handling here. Clicking the currently selected
// option emits onChange(null) to clear the field.
// ============================================================================

// Dropdown menu's max-height (matches the `max-h-72` Tailwind class below).
// Used by the placement detector to decide whether the menu fits below the
// trigger or needs to flip up.
const MENU_MAX_HEIGHT_PX = 288;
const PLACEMENT_GAP_PX = 8;

// Find the nearest ancestor that clips or scrolls its overflow. The dropdown
// is absolutely positioned inside this tree, so its usable space is bounded
// by that ancestor's visible rectangle — not the full viewport.
function getClippingAncestor(node) {
  if (!node) return null;
  let el = node.parentElement;
  while (el && el !== document.body) {
    const style = window.getComputedStyle(el);
    const overflow = style.overflow + style.overflowY + style.overflowX;
    if (/auto|scroll|hidden|clip/.test(overflow)) return el;
    el = el.parentElement;
  }
  return null;
}

function ToggleableCtaDropdown({
  options,
  value,
  onChange,
  disabled,
  locked,
  loading,
  onLockedInteraction,
}) {
  const [open, setOpen] = useState(false);
  // 'bottom' = menu drops below the trigger (default), 'top' = flipped above.
  // Recomputed on open + on viewport resize so the menu never gets clipped by
  // the bottom of the modal / viewport.
  const [placement, setPlacement] = useState('bottom');
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const selectedLabel = options.find((o) => o.value === value)?.label;

  const computePlacement = () => {
    const node = triggerRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const clipper = getClippingAncestor(node);
    const clipRect = clipper ? clipper.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };

    // Usable space is the distance from the trigger to the clipping ancestor's
    // visible edges. This matters when the dropdown lives inside a modal with
    // overflow-y-auto: the window may have room, but the modal body doesn't.
    const spaceBelow = clipRect.bottom - rect.bottom;
    const spaceAbove = rect.top - clipRect.top;

    // Flip up only when below truly can't fit AND above has more room. This
    // avoids flipping in cases where both sides are tight (we'd rather scroll
    // the menu than render upside-down with nowhere to go).
    if (spaceBelow < MENU_MAX_HEIGHT_PX + PLACEMENT_GAP_PX && spaceAbove > spaceBelow) {
      setPlacement('top');
    } else {
      setPlacement('bottom');
    }
  };

  // Force-close if the parent gate flips on while the menu is open (e.g. user
  // clears their ad account after picking a CTA button).
  useEffect(() => {
    if (locked && open) setOpen(false);
  }, [locked, open]);

  // Recompute placement whenever the menu opens. Synchronous measurement is
  // fine because the trigger is already laid out by the time the click fires.
  useEffect(() => {
    if (open) computePlacement();
  }, [open]);

  // Keep placement honest while the menu is open: viewport resize or modal
  // body scroll can shrink the available space underneath.
  useEffect(() => {
    if (!open) return undefined;
    const handle = () => computePlacement();
    window.addEventListener('resize', handle);
    const clipper = triggerRef.current ? getClippingAncestor(triggerRef.current) : null;
    if (clipper) clipper.addEventListener('scroll', handle, { passive: true });
    return () => {
      window.removeEventListener('resize', handle);
      if (clipper) clipper.removeEventListener('scroll', handle);
    };
  }, [open]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return undefined;
    const handle = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return undefined;
    const handle = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handle);
    return () => document.removeEventListener('keydown', handle);
  }, [open]);

  const handleSelect = (optValue) => {
    onChange?.(optValue === value ? null : optValue);
    setOpen(false);
  };

  const flipUp = placement === 'top';

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => {
          if (locked) {
            onLockedInteraction?.();
            return;
          }
          setOpen((v) => !v);
        }}
        className={`flex h-10 w-full items-center justify-between gap-2 rounded-full bg-[#383838]/50 px-4 text-sm backdrop-blur-md transition outline-none disabled:cursor-not-allowed disabled:opacity-50 ${
          locked ? 'cursor-not-allowed' : ''
        } ${
          open ? 'text-white' : selectedLabel ? 'text-white' : 'text-[#AFAFAF]'
        }`}
      >
        <span className="truncate">
          {loading ? 'Loading options…' : selectedLabel || 'Choose a button'}
        </span>
        <ChevronDown
          className={`size-4 shrink-0 text-[#AFAFAF] transition-transform ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.ul
            initial={{ opacity: 0, y: flipUp ? 4 : -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: flipUp ? 4 : -4 }}
            transition={{ duration: 0.12 }}
            className={`absolute left-0 z-50 max-h-72 w-full min-w-fit overflow-y-auto rounded-lg border border-white/15 bg-[#0D0D0D]/95 py-1 shadow-2xl backdrop-blur-xl ${
              flipUp ? 'bottom-full mb-1' : 'top-full mt-1'
            }`}
          >
            {options.map((opt) => {
              const active = opt.value === value;
              return (
                <li key={opt.value}>
                  <button
                    type="button"
                    onClick={() => handleSelect(opt.value)}
                    className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition hover:bg-white/5 ${
                      active ? 'text-white' : 'text-[#AFAFAF] hover:text-white'
                    }`}
                  >
                    <span className="min-w-0 wrap-break-word">{opt.label}</span>
                    <span
                      className={`flex size-4 shrink-0 items-center justify-center rounded-full border ${
                        active
                          ? 'border-[#15DCFF] bg-[#15DCFF]/20'
                          : 'border-[#AFAFAF]'
                      }`}
                    >
                      {active && <Check className="size-2.5 text-[#15DCFF]" />}
                    </span>
                  </button>
                </li>
              );
            })}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
