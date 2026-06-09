import { useEffect, useState } from 'react';
import { AnimatePresence, motion as Motion } from 'framer-motion';
import { Check, ChevronDown, Loader2, Sparkles } from 'lucide-react';

// Inject the glow keyframes once on first TokenInput mount. Keeping this
// inline (instead of a global CSS file) so the picker stays self-contained
// and portable — same pattern as the reference PlaceholderToken.
const GLOW_STYLE_ID = 'prompt-templates-glow-styles';
const GLOW_RGB = '58, 208, 200'; // #3ad0c8 — cyan/teal per reference

function injectGlowStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(GLOW_STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = GLOW_STYLE_ID;
  el.textContent = `
    @keyframes ptGlow {
      0%, 100% {
        box-shadow: 0 0 0 0 rgba(${GLOW_RGB}, 0);
      }
      50% {
        box-shadow:
          0 0 0 2px rgba(${GLOW_RGB}, 0.45),
          0 0 14px 0 rgba(${GLOW_RGB}, 0.45);
      }
    }
    .pt-token-glow { animation: ptGlow 2.4s ease-in-out infinite; }
    /* Pause the pulse while the user is actively editing the token. The
       glow class stays applied so the animation resumes on blur if the
       token is still empty. */
    .pt-token-glow:focus { animation-play-state: paused; }
    @media (prefers-reduced-motion: reduce) {
      .pt-token-glow {
        animation: none;
        box-shadow: 0 0 0 2px rgba(${GLOW_RGB}, 0.4);
      }
    }
  `;
  document.head.appendChild(el);
}

const TOKEN_REGEX = /(\{brand\}|\{target_audience\})/g;

// Splits a template prompt into a [text, token, text, …] sequence and
// renders each {brand} / {target_audience} slot as an inline editable
// input. Empty inputs show yellow-chip styling (matches the old read-only
// TokenChip look); typed values render as plain bold text.
function renderPromptTokens(prompt, manualBrand, manualTargetAudience, onTokenChange) {
  if (!prompt) return null;
  const parts = prompt.split(TOKEN_REGEX);
  return parts.map((part, i) => {
    if (part === '{brand}') {
      return (
        <TokenInput
          key={i}
          name="brand"
          value={manualBrand}
          onChange={(v) => onTokenChange('brand', v)}
        />
      );
    }
    if (part === '{target_audience}') {
      return (
        <TokenInput
          key={i}
          name="target_audience"
          value={manualTargetAudience}
          onChange={(v) => onTokenChange('targetAudience', v)}
        />
      );
    }
    return <span key={i}>{part}</span>;
  });
}

// Hard ceiling so a long paste can't push the input past its column.
// Combined with `max-w-full` in the className, this guarantees the input
// never overflows the right detail panel — values longer than 28ch scroll
// inside the input instead.
const MAX_TOKEN_INPUT_CH = 28;

const MAX_TOKEN_LENGTH = 20;

function TokenInput({ name, value, onChange }) {
  useEffect(injectGlowStyles, []);
  const placeholder = `{${name}}`;
  // Auto-grow width up to the ceiling: bigger of the placeholder length
  // (so the chip stays visible when empty) or the current value length.
  // `+ 1` buys a sliver of breathing room so the caret never sits flush
  // against the edge.
  const widthCh = Math.min(
    MAX_TOKEN_INPUT_CH,
    Math.max(placeholder.length, value.length) + 1,
  );
  // Glow + cyan chip only when the value is genuinely empty (after trim
  // — matches the resolveTemplate gate so the visual signal stays in
  // lockstep with whether the token actually contributes to the final
  // resolved prompt). Whitespace-only counts as empty.
  const empty = value.trim() === '';

  // `maxLength` silently blocks keystrokes past the limit (no onChange
  // fires), so the only way to surface "you tried to type more" is by
  // catching the keystroke at onKeyDown and inspecting the resulting
  // value. Same for paste — clipboard text gets truncated.
  const [overLimit, setOverLimit] = useState(false);
  useEffect(() => {
    if (!overLimit) return undefined;
    const t = setTimeout(() => setOverLimit(false), 2000);
    return () => clearTimeout(t);
  }, [overLimit]);

  const handleKeyDown = (e) => {
    if (
      value.length >= MAX_TOKEN_LENGTH
      && e.key.length === 1
      && !e.ctrlKey
      && !e.metaKey
      && !e.altKey
    ) {
      setOverLimit(true);
    }
  };

  const handlePaste = (e) => {
    const pasted = e.clipboardData?.getData('text') ?? '';
    const target = e.target;
    const selStart = target.selectionStart ?? value.length;
    const selEnd = target.selectionEnd ?? value.length;
    const futureLength = value.length - (selEnd - selStart) + pasted.length;
    if (futureLength > MAX_TOKEN_LENGTH) setOverLimit(true);
  };

  return (
    <span className="relative inline-block max-w-full">
      <input
        type="text"
        value={value}
        onChange={(e) => {
          // Any valid input clears the over-limit indicator — the user
          // either deleted a char or kept editing successfully.
          if (overLimit) setOverLimit(false);
          onChange(e.target.value);
        }}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        placeholder={placeholder}
        maxLength={MAX_TOKEN_LENGTH}
        title="Up to 20 characters"
        className={`mx-0.5 inline-block max-w-full rounded-md border px-1.5 py-0.5 text-[12px] outline-none transition-colors focus:border-cyan-400/60 ${
          overLimit ? 'border-red-500/70!' : 'border-transparent'
        } ${
          empty
            ? 'pt-token-glow bg-cyan-200/50 font-medium text-cyan-900 placeholder:text-cyan-900 dark:bg-cyan-300/15 dark:text-cyan-100 dark:placeholder:text-cyan-100'
            : 'bg-transparent font-medium text-gray-900 dark:text-white'
        }`}
        style={{ width: `${widthCh}ch` }}
      />
      {overLimit && (
        <span
          role="alert"
          className="pointer-events-none absolute left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded-md bg-red-500 px-2 py-0.5 text-10 font-medium text-white shadow-lg"
          style={{ bottom: 'calc(100% + 4px)' }}
        >
          Max 20 characters
        </span>
      )}
    </span>
  );
}

// Pill button in the Prompt label row that toggles the panel.
export function TemplatesTrigger({ controller }) {
  const { open, setOpen } = controller;
  return (
    <button
      type="button"
      onClick={() => setOpen((v) => !v)}
      className="flex shrink-0 items-center gap-2 rounded-full bg-gray-100 px-4 py-2 text-[12px] font-light text-gray-600 ring-1 ring-black/10 transition-colors hover:bg-black/5 dark:bg-[#909294]/10 dark:text-[#f0f0f0] dark:ring-white/5 dark:hover:bg-[#33333a]"
    >
      <Sparkles size={14} className="text-gray-500 dark:text-white/60" />
      Templates
      <ChevronDown
        size={16}
        strokeWidth={2}
        className={`text-gray-500 dark:text-white/40 transition-transform ${open ? 'rotate-180' : ''}`}
      />
    </button>
  );
}

// Inline panel rendered between the Prompt label row and the textarea.
// Left rail = template titles; right detail = previewed prompt body + Use
// button. Active (in-textarea) template gets a tick in the rail.
//
// The component renders unconditionally so its enter/exit animation can be
// driven by AnimatePresence — the consumers don't need to gate it any more
// (they still read `controller.open` for the sibling textarea's min-height
// transition, but the panel itself owns its mount lifecycle now).
export function TemplatesPanel({ controller }) {
  const {
    open,
    state,
    error,
    templates,
    previewedTemplate,
    activeTemplate,
    previewTemplate,
    useTemplate,
    brandName,
    manualBrand,
    manualTargetAudience,
    updateManualValue,
  } = controller;

  return (
    <AnimatePresence initial={false}>
      {open && (
        <Motion.div
          key="templates-panel"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.25, ease: [0.22, 0.61, 0.36, 1] }}
          className="overflow-hidden"
        >
          {/* mb-3 sits INSIDE the overflow-hidden parent so the 12 px gap
              is reserved when open (it's part of the measured natural
              height that framer animates to) and clipped when collapsed
              — instead of being a separately-animated marginBottom on the
              Motion.div, which can finish a frame off from the height
              animation and produce a tiny "settle" at the end. */}
          <div className="mb-3 overflow-hidden rounded-20 bg-gray-100 ring-1 ring-black/10 dark:bg-[#909294]/10 dark:ring-white/10">
      {state !== 'loaded' && (
        <div className="px-4 py-3">
          {state === 'loading' && (
            <div className="flex items-center gap-2 text-[12px] text-gray-500 dark:text-white/60">
              <Loader2 size={12} className="animate-spin" />
              Loading templates…
            </div>
          )}
          {state === 'error' && (
            <div className="text-[12px] text-red-600 dark:text-red-300">
              {error || 'Failed to load templates.'}
            </div>
          )}
          {state === 'idle' && (
            <div className="text-[12px] text-gray-500 dark:text-white/50">Preparing…</div>
          )}
        </div>
      )}

      {state === 'loaded' && templates.length === 0 && (
        <div className="px-4 py-3 text-[12px] text-gray-500 dark:text-white/50">
          No templates available.
        </div>
      )}

      {state === 'loaded' && templates.length > 0 && (
        <div className="grid grid-cols-[140px_1fr] gap-0 sm:grid-cols-[160px_1fr]">
          {/* Left rail — template list */}
          <div className="border-r border-black/10 p-2 dark:border-white/10">
            <div className="px-2 pt-1 pb-2 text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:text-white/50">
              Templates
            </div>
            <div className="max-h-[280px] space-y-0.5 overflow-y-auto pr-1 [scrollbar-color:rgba(255,255,255,0.15)_transparent] [scrollbar-width:thin]">
              {templates.map((t) => {
                const isPreviewed = previewedTemplate?._id === t._id;
                const isActive = activeTemplate?._id === t._id;
                return (
                  <button
                    key={t._id}
                    type="button"
                    onClick={() => previewTemplate(t)}
                    title={t.prompt}
                    className={`flex w-full items-center gap-2 rounded-[10px] px-2.5 py-2 text-left text-[12.5px] transition-colors ${
                      isPreviewed
                        ? 'bg-gray-900 text-white dark:bg-white/15 dark:text-white'
                        : 'text-gray-700 hover:bg-black/5 dark:text-white/80 dark:hover:bg-white/5'
                    }`}
                  >
                    <Sparkles
                      size={12}
                      className={`shrink-0 ${
                        isPreviewed ? 'text-white/80' : 'text-gray-400 dark:text-white/40'
                      }`}
                    />
                    <span className="flex-1 truncate">{t.title || t.prompt}</span>
                    {isActive && (
                      <Check size={14} className="shrink-0 text-emerald-400" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right detail — full prompt preview + Use button */}
          <div className="flex max-h-[280px] flex-col p-4">
            {!previewedTemplate ? (
              <div className="flex flex-1 items-center justify-center text-center text-[12px] text-gray-500 dark:text-white/50">
                Pick a template on the left to preview it.
              </div>
            ) : (
              <>
                <div className="mb-2 text-[14px] font-semibold text-gray-900 dark:text-white">
                  {previewedTemplate.title || 'Template'}
                </div>
                <div className="flex-1 overflow-y-auto px-1 py-2 text-[12.5px] leading-relaxed text-gray-700 dark:text-white/80 [scrollbar-color:rgba(255,255,255,0.15)_transparent] [scrollbar-width:thin]">
                  {renderPromptTokens(
                    previewedTemplate.prompt,
                    manualBrand,
                    manualTargetAudience,
                    updateManualValue,
                  )}
                </div>
                {(() => {
                  // Button is gated until the brand picker has surfaced a
                  // brand name. Target audience is optional — its token
                  // stays as a yellow chip if missing.
                  const canUse = true;
                  // const canUse = Boolean(brandName);
                  const missing = [];
                  if (!brandName) missing.push('brand');
                  return (
                    <div className="mt-3 flex items-center justify-end gap-3">
                      {!canUse && (
                        <span className="text-[11px] text-gray-500 dark:text-white/50">
                          Add a {missing.join(' and ')} to use this prompt
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={useTemplate}
                        // disabled={!canUse}
                        title={
                          canUse
                            ? undefined
                            : `Add a ${missing.join(' and ')} first`
                        }
                        className="rounded-full bg-gray-900 px-4 py-1.5 text-[12px] font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:opacity-40 dark:bg-white dark:text-gray-900"
                      >
                        Use this prompt →
                      </button>
                    </div>
                  );
                })()}
              </>
            )}
          </div>
        </div>
      )}
          </div>
        </Motion.div>
      )}
    </AnimatePresence>
  );
}
