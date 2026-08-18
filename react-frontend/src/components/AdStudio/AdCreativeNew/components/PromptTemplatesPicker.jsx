import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion as Motion } from 'framer-motion';
import {
  Check,
  ChevronDown,
  Loader2,
  Search,
  Sparkles,
  AlertCircle,
  LayoutGrid,
  Megaphone,
  Tag,
  Percent,
  Gift,
  Star,
  Rocket,
  TrendingUp,
  ShoppingBag,
  CalendarDays,
  MessageSquareQuote,
  Scale,
  Crown,
  Home,
  LayoutDashboard,
  Video,
  Dumbbell,
  Utensils,
  Plane,
  GraduationCap,
  Shirt,
  PenTool,
  FileText,
  Users,
} from 'lucide-react';
import { IS_PROMPT_CATEGORIES_ENABLED } from '@/utils/featureFlags';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

// Templates carry no icon field, so infer a meaningful one from the title +
// category. Rules are checked in order, first match wins — so the glyph
// actually signals what the template is for (a "Sale promo" gets a %, a
// "Testimonial" gets a quote bubble) instead of a random shape. When nothing
// matches we fall back to a small hashed set so rows still look distinct.
// The category heading uses LayoutGrid, which is never a row icon.
const ICON_RULES = [
  { re: /(sale|discount|promo|clearance|deal|%)/, Icon: Percent, color: 'text-rose-400' },
  { re: /(price|pricing|cost|budget|offer)/, Icon: Tag, color: 'text-amber-500' },
  { re: /(season|holiday|festive|christmas|diwali|black ?friday|new ?year|summer|winter|event|webinar)/, Icon: CalendarDays, color: 'text-orange-400' },
  { re: /(testimonial|review|social proof|quote|rating|feedback)/, Icon: MessageSquareQuote, color: 'text-sky-400' },
  { re: /(compare|comparison|\bvs\b|versus|usp|advantage|why choose)/, Icon: Scale, color: 'text-violet-400' },
  { re: /(luxury|premium|elite|exclusive|\bvip\b|high[- ]?end)/, Icon: Crown, color: 'text-amber-400' },
  { re: /(home|house|property|real ?estate|apartment|rental|listing|estate|amenity)/, Icon: Home, color: 'text-emerald-400' },
  { re: /(enterprise|software|\bapp\b|saas|tech|dashboard|platform|digital|\bai\b)/, Icon: LayoutDashboard, color: 'text-indigo-400' },
  { re: /(launch|hero|announce|reveal|introduc|\bnew\b)/, Icon: Rocket, color: 'text-sky-400' },
  { re: /(gift|giveaway|reward|bonus|\bfree\b)/, Icon: Gift, color: 'text-pink-400' },
  { re: /(growth|performance|result|roi|convert|scale|boost|traffic)/, Icon: TrendingUp, color: 'text-teal-400' },
  { re: /(video|reel|clip|motion|story)/, Icon: Video, color: 'text-fuchsia-400' },
  { re: /(shop|product|store|ecommerce|purchase|cart|retail|\bbuy\b)/, Icon: ShoppingBag, color: 'text-violet-400' },
  { re: /(health|fitness|wellness|\bgym\b|workout)/, Icon: Dumbbell, color: 'text-lime-500' },
  { re: /(food|restaurant|menu|meal|dish|cafe|dining)/, Icon: Utensils, color: 'text-orange-400' },
  { re: /(travel|trip|vacation|flight|tour|destination|hotel)/, Icon: Plane, color: 'text-sky-400' },
  { re: /(education|course|learn|class|training|academy|school)/, Icon: GraduationCap, color: 'text-indigo-400' },
  { re: /(fashion|apparel|clothing|\bwear\b|outfit|style)/, Icon: Shirt, color: 'text-pink-400' },
  { re: /(spotlight|feature|showcase|highlight|benefit)/, Icon: Star, color: 'text-yellow-400' },
  { re: /(campaign|marketing|announcement|awareness)/, Icon: Megaphone, color: 'text-rose-400' },
  { re: /(team|audience|people|customer|community|\buser)/, Icon: Users, color: 'text-teal-400' },
  { re: /(brand|custom|brief|identity)/, Icon: PenTool, color: 'text-cyan-400' },
];

// Hashed fallbacks — still deterministic per template, so a row's icon never
// flickers between renders.
const FALLBACK_ICONS = [
  { Icon: Sparkles, color: 'text-cyan-400' },
  { Icon: Star, color: 'text-amber-400' },
  { Icon: Tag, color: 'text-violet-400' },
  { Icon: FileText, color: 'text-sky-400' },
];

function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i += 1) {
    h = (h * 31 + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function iconForTemplate(t) {
  const haystack = `${t?.title || ''} ${t?._category || t?.category || ''}`.toLowerCase();
  const rule = ICON_RULES.find((r) => r.re.test(haystack));
  if (rule) return rule;
  const key = t?._id || t?.title || t?.prompt || '';
  return FALLBACK_ICONS[hashString(key) % FALLBACK_ICONS.length];
}

// Reveals a scrollbar only while the container is actively scrolling, then
// hides it again after a short idle. Returns [isScrolling, onScroll] — pair
// the flag with the `.scrollbar-auto-hide is-scrolling` classes.
function useScrollActivity(idleMs = 700) {
  const [scrolling, setScrolling] = useState(false);
  const timerRef = useRef(null);
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );
  const onScroll = () => {
    setScrolling(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setScrolling(false), idleMs);
  };
  return [scrolling, onScroll];
}

// Inject the glow keyframes once on first TokenInput mount. Keeping this
// inline (instead of a global CSS file) so the picker stays self-contained
// and portable — same pattern as the reference PlaceholderToken.
const GLOW_STYLE_ID = 'prompt-templates-glow-styles';
const GLOW_RGB = '58, 208, 200'; // #3ad0c8 — cyan/teal per reference

function injectGlowStyles() {
  if (typeof document === 'undefined') return;
  // Upsert rather than bail-if-present: if an older version of this style
  // block was injected earlier (e.g. before hot-reload), skipping would
  // leave the newer .pt-token rules — including the empty-token placeholder
  // — permanently missing. Re-setting textContent is idempotent and cheap.
  let el = document.getElementById(GLOW_STYLE_ID);
  if (!el) {
    el = document.createElement('style');
    el.id = GLOW_STYLE_ID;
    document.head.appendChild(el);
  }
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
    /* The inline editable token flows and wraps WITH the surrounding
       sentence instead of forcing its own full-width line. box-decoration
       -break: clone keeps the rounded highlight + padding intact on every
       wrapped fragment. */
    .pt-token {
      display: inline;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      cursor: text;
      -webkit-box-decoration-break: clone;
      box-decoration-break: clone;
    }
    /* Empty placeholders are always short and never wrap, so render them as
       an inline-block pill (matching the original input chip). Filled tokens
       stay inline above so a long value flows and wraps with the sentence. */
    .pt-token-empty {
      display: inline-block;
    }
    /* A contentEditable element can't use the placeholder attribute, so an
       empty token renders its {label} via ::before. */
    .pt-token-empty::before {
      content: attr(data-ph);
      opacity: 0.85;
    }
  `;
}

const TOKEN_REGEX = /\{([^}]+)\}/g;

// Walks a template prompt and renders every {placeholder} slot as an inline
// editable TokenInput. Surrounding text, punctuation, spaces and line breaks
// are preserved as plain spans. Empty tokens show the cyan glow-chip; filled
// tokens flow and wrap inline with a calmer highlight.
function renderPromptTokens(prompt, values, onTokenChange) {
  if (!prompt) return null;

  const elements = [];
  let lastIndex = 0;
  let match;

  while ((match = TOKEN_REGEX.exec(prompt)) !== null) {
    const [fullMatch, key] = match;

    if (match.index > lastIndex) {
      elements.push(
        <span key={`text-${lastIndex}`}>{prompt.slice(lastIndex, match.index)}</span>,
      );
    }

    elements.push(
      <TokenInput
        key={`token-${match.index}`}
        name={key}
        value={values[key] || ''}
        onChange={(v) => onTokenChange(key, v)}
      />,
    );

    lastIndex = match.index + fullMatch.length;
  }

  if (lastIndex < prompt.length) {
    elements.push(<span key={`text-${lastIndex}`}>{prompt.slice(lastIndex)}</span>);
  }

  return elements;
}

const MAX_TOKEN_LENGTH = 60;

// Renders a {placeholder} slot as an inline, editable token. It's a
// contentEditable span (not an <input>) on purpose: that's what lets a long
// value — e.g. a full target-audience phrase — flow and WRAP with the
// sentence, instead of an <input> forcing itself onto its own full-width
// line and scroll-clipping the text. Empty tokens show the glowing cyan
// chip; filled tokens get a calmer highlight so they read as done.
function TokenInput({ name, value, onChange }) {
  useEffect(injectGlowStyles, []);
  const ref = useRef(null);
  // Whitespace-only counts as empty — mirrors the resolveTemplate gate so
  // the visual state matches whether the token contributes to the prompt.
  const empty = value.trim() === '';

  // Push text into the DOM only when `value` changes from the OUTSIDE
  // (brand-chip seeding, resets, variant switch). We deliberately don't
  // echo the user's own keystrokes back into the node — doing so would
  // collapse the caret to the start on every character typed.
  useEffect(() => {
    const el = ref.current;
    if (el && el.textContent !== value) el.textContent = value;
  }, [value]);

  const moveCaretToEnd = (el) => {
    const range = document.createRange();
    const sel = window.getSelection();
    range.selectNodeContents(el);
    range.collapse(false);
    sel?.removeAllRanges();
    sel?.addRange(range);
  };

  const handleInput = (e) => {
    const el = e.currentTarget;
    let text = el.textContent || '';
    // Enforce the ceiling for both typing and paste. Trimming the node
    // (rather than blocking keystrokes) is what also caps pasted text.
    if (text.length > MAX_TOKEN_LENGTH) {
      text = text.slice(0, MAX_TOKEN_LENGTH);
      el.textContent = text;
      moveCaretToEnd(el);
    }
    onChange(text);
  };

  const handleKeyDown = (e) => {
    // Tokens are single-line in intent — Enter would inject a <br>.
    if (e.key === 'Enter') e.preventDefault();
  };

  return (
    <span
      ref={ref}
      role="textbox"
      aria-label={name}
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      onInput={handleInput}
      onKeyDown={handleKeyDown}
      data-ph={`{${name}}`}
      title={`Up to ${MAX_TOKEN_LENGTH} characters`}
      className={`pt-token mx-0.5 rounded-md border px-1.5 text-[12px] outline-none transition-colors ${
        empty
          ? 'pt-token-empty pt-token-glow border-transparent py-0.5 bg-cyan-200/50 font-medium text-cyan-900 focus:border-cyan-400/60 dark:bg-cyan-300/15 dark:text-cyan-100'
          : 'border-transparent bg-cyan-500/10 font-semibold text-cyan-800 dark:bg-cyan-300/10 dark:text-cyan-100'
      }`}
    />
  );
}

// Pill button in the Prompt label row that toggles the panel.
export function TemplatesTrigger({ controller }) {
  const { open, setOpen } = controller;
  return (
    <button
      type="button"
      onClick={() => setOpen((v) => !v)}
      className="flex shrink-0 items-center gap-2 rounded-full bg-[#e2e7ec] px-4 py-2 text-[12px] font-medium text-[#0f172a] border border-black/10 transition-colors hover:bg-[#d8dee5] dark:bg-[#909294]/10 dark:text-[#f0f0f0] dark:border-white/5 dark:hover:bg-[#33333a]"
    >
      <Sparkles size={14} className="text-[#0f172a]/70 dark:text-white/60" />
      Templates
      <ChevronDown
        size={16}
        strokeWidth={2}
        className={`text-[#0f172a]/70 transition-transform dark:text-white/40 ${open ? 'rotate-180' : ''}`}
      />
    </button>
  );
}

// How far the panel can shrink / grow when dragged. The floor keeps the
// filter bar + a couple of rows visible; the ceiling stops it from ballooning
// into a mostly-empty box and shoving the prompt below the fold.
const MIN_PANEL_HEIGHT = 180;
const MAX_PANEL_HEIGHT = 420;

// Drag handle rendered between the panel and the prompt box. Dragging DOWN
// grows the templates picker (and shrinks the prompt box); dragging UP does
// the reverse. Uses pointer capture so the drag keeps tracking even when the
// cursor leaves the thin handle. Only renders while the panel is open.
export function TemplatesResizer({ controller }) {
  const { open, panelHeight, setPanelHeight } = controller;
  const dragRef = useRef(null);

  if (!open) return null;

  const onPointerDown = (e) => {
    dragRef.current = { startY: e.clientY, startH: panelHeight };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  const onPointerMove = (e) => {
    if (!dragRef.current) return;
    const delta = e.clientY - dragRef.current.startY;
    const next = Math.min(
      MAX_PANEL_HEIGHT,
      Math.max(MIN_PANEL_HEIGHT, dragRef.current.startH + delta),
    );
    setPanelHeight(next);
  };

  const endDrag = (e) => {
    dragRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* pointer already released */
    }
  };

  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize templates panel"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      /* -mt-3 cancels the panel's own mb-3 so the handle sits INSIDE the
         existing gap instead of adding a second one; mb-1 leaves just a
         small space above the prompt box. */
      className="group -mt-3 mb-1 flex h-3 shrink-0 cursor-row-resize touch-none items-center justify-center"
    >
      <div className="h-1 w-10 rounded-full bg-black/15 transition-colors group-hover:bg-black/30 dark:bg-white/20 dark:group-hover:bg-white/40" />
    </div>
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
    filteredTemplates,
    selectedCategory,
    searchQuery,
    panelHeight,
    setSearchQuery,
    previewedTemplate,
    activeTemplate,
    previewTemplate,
    useTemplate,
    brandName,
    categoryResolving,
    manualValues,
    updateManualValue,
  } = controller;

  const [railScrolling, onRailScroll] = useScrollActivity();
  const [previewScrolling, onPreviewScroll] = useScrollActivity();

  // Live list of empty placeholders in the currently previewed template.
  // This updates as the user types, so the notice is always current.
  const skippedPlaceholders = useMemo(() => {
    if (!previewedTemplate?.prompt) return [];
    const matches = previewedTemplate.prompt.match(/\{([^}]+)\}/g) || [];
    const skipped = new Set();
    matches.forEach((match) => {
      const key = match.slice(1, -1);
      if (!(manualValues[key] ?? '').trim()) {
        skipped.add(key);
      }
    });
    return Array.from(skipped);
  }, [previewedTemplate, manualValues]);

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
          <div className="rounded-[20px] mb-3 overflow-hidden bg-[#e2e7ec] border border-black/10 dark:bg-[#1a1c20] dark:border-white/10 shadow-lg">
            {state !== 'loaded' && (
              <div className="px-4 py-3">
                {state === 'loading' && (
                  <div className="flex items-center gap-2 text-[12px] text-gray-700 dark:text-white/60">
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
                  <div className="text-[12px] text-gray-600 dark:text-white/50">Preparing…</div>
                )}
              </div>
            )}

            {state === 'loaded' && templates.length === 0 && (
              <div className="px-4 py-3 text-[12px] text-gray-600 dark:text-white/50">
                No templates available.
              </div>
            )}

            {state === 'loaded' && templates.length > 0 && (
              <div className="flex flex-col" style={{ height: panelHeight }}>
                {/* Filter bar — single full-width search. The category is no
                    longer picked here: it's auto-selected from the chosen
                    brand (or defaults to General) and shown as the rail
                    heading below. Searching spans every loaded category.
                    (hidden until VITE_FEATURE_PROMPT_CATEGORIES=true) */}
                {IS_PROMPT_CATEGORIES_ENABLED && (
                <div className="flex shrink-0 items-center px-3 py-2.5">
                  <div className="relative min-w-0 flex-1">
                    <Search
                      size={15}
                      className="absolute top-1/2 left-3 -translate-y-1/2 text-gray-500 dark:text-white/40"
                    />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search all templates…"
                      className="templates-search-input h-9 w-full min-w-0 rounded-full bg-[#d8dee5]! pr-3 pl-9 text-[12.5px] font-medium text-[#0f172a]! outline-none border border-black/10 placeholder:text-gray-500 focus:border-black/20 dark:bg-[#1f1f23]! dark:text-white/90! dark:border-white/10 dark:placeholder:text-white/40 dark:focus:border-white/20"
                    />
                  </div>
                </div>
                )}

                {/* Two-column content area — fills remaining height */}
                <div className="min-h-0 flex-1 flex">
                  {/* Left rail — template list (scrollable) */}
                  <div className="flex w-43 flex-col border-r border-black/10 p-2 sm:w-47 dark:border-white/10">
                    {/* Heading reflects what the list is showing:
                        • searching → the result count for the query
                        • classifying a brand → a "finding" spinner
                        • otherwise → the active category (brand-derived or
                          the General default). */}
                    {(() => {
                      const searching = Boolean(searchQuery?.trim());
                      const base =
                        'flex items-center gap-1.5 px-2 pt-1 pb-2 text-[11px] font-semibold tracking-wide uppercase';
                      if (searching) {
                        return (
                          <div className={`${base} text-gray-700 dark:text-white/60`}>
                            <Search size={11} className="shrink-0" />
                            <span className="truncate">
                              {filteredTemplates.length} result
                              {filteredTemplates.length === 1 ? '' : 's'}
                            </span>
                          </div>
                        );
                      }
                      if (categoryResolving) {
                        return (
                          <div className={`${base} text-cyan-700 dark:text-cyan-300`}>
                            <Loader2 size={11} className="shrink-0 animate-spin" />
                            <span className="truncate">Finding category…</span>
                          </div>
                        );
                      }
                      return (
                        <div
                          className={`${base} text-gray-700 dark:text-white/60`}
                          title={selectedCategory}
                        >
                          <LayoutGrid size={11} className="shrink-0 text-cyan-600 dark:text-cyan-300" />
                          <span className="truncate">{selectedCategory || 'General'}</span>
                        </div>
                      );
                    })()}
                    <div
                      onScroll={onRailScroll}
                      className={`min-h-0 flex-1 space-y-0.5 overflow-y-auto pr-1 scrollbar-auto-hide ${
                        railScrolling ? 'is-scrolling' : ''
                      }`}
                    >
                      {filteredTemplates.length === 0 && (
                        <div className="px-2 py-3 text-[11px] text-gray-600 dark:text-white/50">
                          No matching templates.
                        </div>
                      )}
                      {filteredTemplates.map((t) => {
                        const isPreviewed = previewedTemplate?._id === t._id;
                        const isActive = activeTemplate?._id === t._id;
                        const label = t.title || t.prompt;
                        const { Icon: RowIcon, color: rowColor } = iconForTemplate(t);
                        return (
                          <Tooltip key={t._id}>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                onClick={() => previewTemplate(t)}
                                className={`flex w-full items-center gap-2 rounded-[10px] px-2.5 py-2 text-left text-[12.5px] font-medium transition-colors ${
                                  isPreviewed
                                    ? 'bg-gray-900 text-white dark:bg-white/20 dark:text-white'
                                    : 'text-gray-900 hover:bg-black/10 dark:text-white/90 dark:hover:bg-white/10'
                                }`}
                              >
                                <RowIcon
                                  size={13}
                                  className={`shrink-0 ${isPreviewed ? 'text-white/90' : rowColor}`}
                                />
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate">{label}</span>
                                  {/* During a global search, show which category
                                      each result came from. */}
                                  {searchQuery?.trim() && t._category && (
                                    <span
                                      className={`block truncate text-[10px] ${
                                        isPreviewed
                                          ? 'text-white/60'
                                          : 'text-gray-600 dark:text-white/40'
                                      }`}
                                    >
                                      {t._category}
                                    </span>
                                  )}
                                </span>
                                {isActive && <Check size={14} className="shrink-0 text-emerald-400" />}
                              </button>
                            </TooltipTrigger>
                            <TooltipContent
                              side="right"
                              sideOffset={8}
                              className="max-w-[220px] border-0 bg-gray-900 px-2.5 py-1.5 text-[11px] text-white shadow-lg dark:bg-white dark:text-gray-900"
                            >
                              {label}
                            </TooltipContent>
                          </Tooltip>
                        );
                      })}                      
                    </div>
                  </div>

                  {/* Right detail — fixed-height preview column */}
                  <div className="flex min-h-0 min-w-0 flex-1 flex-col p-4">
                    {!previewedTemplate ? (
                      <div className="flex flex-1 items-center justify-center text-center text-[12px] text-gray-600 dark:text-white/50">
                        Pick a template on the left to preview it.
                      </div>
                    ) : (
                      <>
                        <div className="mb-2 shrink-0">
                          <div className="flex items-center gap-2">
                            <span className="text-[13.5px] font-semibold text-gray-900 dark:text-white">
                              {previewedTemplate.title || 'Template'}
                            </span>
                            {(previewedTemplate._category || previewedTemplate.category) && (
                              <span className="flex shrink-0 items-center gap-1 text-[10.5px] text-gray-500 dark:text-white/40">
                                <LayoutGrid size={10} className="shrink-0" />
                                {previewedTemplate._category || previewedTemplate.category}
                              </span>
                            )}
                          </div>
                        </div>
                        <div
                          onScroll={onPreviewScroll}
                          className={`min-h-0 flex-1 overflow-y-auto px-1 py-2 text-[12.5px] leading-relaxed text-gray-900 scrollbar-auto-hide dark:text-white/80 ${
                            previewScrolling ? 'is-scrolling' : ''
                          }`}
                        >
                          {renderPromptTokens(
                            previewedTemplate.prompt,
                            manualValues,
                            updateManualValue
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
                          const skippedLabel = skippedPlaceholders
                            .map((p) => p.replace(/_/g, ' '))
                            .join(', ');

                          return (
                            <div className="mt-2 flex shrink-0 items-center justify-between gap-2">
                              {IS_PROMPT_CATEGORIES_ENABLED && skippedPlaceholders.length > 0 ? (
                                <span
                                  title={`Fill in the highlighted field${skippedPlaceholders.length > 1 ? 's' : ''}: ${skippedLabel}`}
                                  className="flex min-w-0 items-center gap-1 text-[10.5px] text-amber-600 dark:text-amber-300/90"
                                >
                                  <AlertCircle size={11} className="shrink-0" />
                                  <span className="truncate">
                                    {skippedPlaceholders.length} field
                                    {skippedPlaceholders.length > 1 ? 's' : ''} to fill
                                  </span>
                                </span>
                              ) : (
                                <span className="min-w-0" />
                              )}
                              <button
                                type="button"
                                onClick={useTemplate}
                                // disabled={!canUse}
                                title={canUse ? undefined : `Add a ${missing.join(' and ')} first`}
                                className="shrink-0 rounded-full bg-gray-900 px-4 py-1.5 text-[12px] font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:opacity-40 dark:bg-white dark:text-gray-900"
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
              </div>
            )}
          </div>
        </Motion.div>
      )}
    </AnimatePresence>
  );
}
