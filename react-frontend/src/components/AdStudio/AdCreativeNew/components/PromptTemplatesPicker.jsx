import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion as Motion } from 'framer-motion';
import {
  Check,
  ChevronDown,
  Loader2,
  Search,
  Sparkles,
  AlertCircle,
  Grid2X2Plus,
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
      className={`inline mx-0.5 px-1.5 py-0.5 rounded-[6px] text-[12px] outline-none transition-colors whitespace-pre-wrap ${
        empty
          ? 'bg-[#FFFBEB] border border-dashed border-[#F59E0B] text-[#B45309] pt-token-empty'
          : 'bg-[#CFFAFE] text-[#0E7490] border border-transparent focus:border-[#22D3EE] focus:bg-[#ECFEFF]'
      }`}
    />
  );
}

// Compact labelled button in the Prompt row that toggles the templates panel.
export function TemplatesTrigger({ controller }) {
  const { open, setOpen } = controller;
  return (
    <button
      type="button"
      onClick={() => setOpen((v) => !v)}
      aria-expanded={open}
      className={`flex h-9 items-center justify-center gap-1.5 rounded-[11px] border py-1 pr-2.5 pl-1.5 text-[12px] font-medium shadow-[0_1px_2px_rgba(31,29,41,0.05)] transition-[background-color,border-color,color] ${
        open
          ? 'border-[#C9C4DF] bg-[#F3F2F8] text-[#675BCC] dark:border-indigo-300/30 dark:bg-indigo-950/40 dark:text-indigo-300'
          : 'border-[#D9D6E3] bg-white/75 text-[#675BCC] hover:border-[#CBC6DE] hover:bg-[#F7F6FA] dark:border-white/12 dark:bg-white/[0.04] dark:text-indigo-300 dark:hover:border-indigo-300/25 dark:hover:bg-indigo-950/30'
      }`}
      title="Templates"
    >
      <span
        aria-hidden="true"
        className={`grid size-7 shrink-0 place-items-center rounded-[9px] transition-[background-color,color,box-shadow] duration-200 ${
          open
            ? 'bg-[#E8E5F6] text-[#5B50BE] shadow-[inset_0_1px_1px_rgba(255,255,255,0.8),0_2px_5px_rgba(70,60,130,0.14)] dark:bg-indigo-400/18 dark:text-indigo-200 dark:shadow-none'
            : 'bg-[#F0EEF8] text-[#6B5ED1] shadow-[inset_0_1px_1px_rgba(255,255,255,0.86),0_2px_4px_rgba(70,60,130,0.1)] dark:bg-indigo-400/10 dark:text-indigo-300 dark:shadow-none'
        }`}
      >
        <Grid2X2Plus size={16} strokeWidth={2.35} />
      </span>
      <span>Templates</span>
      <ChevronDown
        aria-hidden="true"
        size={12}
        strokeWidth={2}
        className={`shrink-0 text-[#8C85AD] transition-transform duration-200 dark:text-indigo-300/70 ${
          open ? 'rotate-180' : ''
        }`}
      />
    </button>
  );
}

// How far the panel can shrink / grow when dragged. The floor keeps the
// filter bar + a couple of rows visible; the ceiling stops it from ballooning
// into a mostly-empty box and shoving the prompt below the fold.
const MIN_PANEL_HEIGHT = 150;
const MAX_PANEL_HEIGHT = 360;

// Drag handle rendered between the panel and the prompt box. Dragging DOWN
// grows the templates picker (and shrinks the prompt box); dragging UP does
// the reverse. Uses pointer capture so the drag keeps tracking even when the
// cursor leaves the thin handle. Only renders while the panel is open.
export function TemplatesResizer({ controller }) {
  const { open, panelHeight, setPanelHeight } = controller;
  const dragRef = useRef(null);

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
    <AnimatePresence>
      {open && (
        <Motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 12 }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.2 }}
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
          className="group -mt-3 mb-1 flex shrink-0 cursor-row-resize touch-none items-center justify-center overflow-hidden"
        >
          <div className="h-1 w-10 rounded-full bg-black/15 transition-colors group-hover:bg-black/30 dark:bg-white/20 dark:group-hover:bg-white/40" />
        </Motion.div>
      )}
    </AnimatePresence>
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
          <div
            className="mb-3 overflow-hidden rounded-[20px] border border-[#CFCDD9] bg-[#F3F3F6] dark:border-white/10 dark:bg-[#1a1a1f]"
            style={{ height: panelHeight }}
          >
            {state !== 'loaded' && (
              <div className="flex h-full items-center justify-center px-4 py-3">
                {state === 'loading' && (
                  <div className="flex items-center gap-2 text-[12px] text-gray-500 dark:text-white/60">
                    <Loader2 size={16} className="animate-spin text-[#5867EB]" />
                    Loading templates…
                  </div>
                )}
                {state === 'error' && (
                  <div className="text-[12px] text-red-600 dark:text-red-300">
                    {error || 'Failed to load templates.'}
                  </div>
                )}
                {state === 'idle' && (
                  <div className="flex items-center gap-2 text-[12px] text-gray-500 dark:text-white/60">
                    <Loader2 size={16} className="animate-spin text-[#5867EB]" />
                    Preparing…
                  </div>
                )}
              </div>
            )}

            {state === 'loaded' && templates.length === 0 && (
              <div className="flex h-full items-center justify-center px-4 py-3 text-[12px] text-gray-500 dark:text-white/50">
                No templates available.
              </div>
            )}

            {state === 'loaded' && templates.length > 0 && (
              <div className="flex flex-col h-full">
                {/* Filter bar — single full-width search. */}
                <div className="p-[7px_12px] shrink-0 relative">
                  <Search
                    size={14}
                    className="absolute top-1/2 left-6 -translate-y-1/2 text-[#9CA3AF]"
                  />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search all templates…"
                    className="templates-search-input adcreative-white-input h-[32px] w-full rounded-full border border-[#E2E1E8] !bg-white pl-8 pr-3 text-[12px] text-[#1F1D29] placeholder:text-[#85829A] outline-none transition-all focus:border-[#5867EB] focus:ring-[3px] focus:ring-[#5867EB]/16 dark:border-white/10 dark:!bg-[#1a1a1f] dark:text-white"
                  />
                </div>

                {/* Two-column content area — fills remaining height */}
                <div className="min-h-0 flex flex-1">
                  {/* Left rail — template list (scrollable) */}
                  <div className="w-[176px] shrink-0 border-r border-[#E2E1E8] p-2 flex flex-col dark:border-white/10">
                    {/* Heading reflects what the list is showing */}
                    {(() => {
                      const searching = Boolean(searchQuery?.trim());
                      const base =
                        'flex items-center gap-1.5 px-2 pt-0.5 pb-1.5 text-[10.5px] font-semibold tracking-wider uppercase';
                      if (searching) {
                        return (
                          <div className={`${base} text-gray-400 dark:text-white/50`}>
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
                          <div className={`${base} text-indigo-600 dark:text-indigo-400`}>
                            <Loader2 size={11} className="shrink-0 animate-spin" />
                            <span className="truncate">Finding category…</span>
                          </div>
                        );
                      }
                      return (
                        <div
                          className={`${base} text-gray-400 dark:text-white/50`}
                          title={selectedCategory}
                        >
                          <LayoutGrid size={13} className="shrink-0 text-[#06B6D4]" />
                          <span className="truncate">{selectedCategory || 'GENERAL'}</span>
                        </div>
                      );
                    })()}
                    <div
                      onScroll={onRailScroll}
                      className={`min-h-0 flex-1 space-y-1 overflow-y-auto pr-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${
                        railScrolling ? 'is-scrolling' : ''
                      }`}
                    >
                      {filteredTemplates.length === 0 && (
                        <div className="px-2 py-3 text-[11px] text-gray-400 dark:text-white/50">
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
                                className={`flex w-full items-center gap-2 rounded-[8px] p-[6px_8px] text-left text-[12px] mb-0.5 transition-colors ${
                                  isPreviewed
                                    ? 'bg-[#111827] text-white'
                                    : 'text-[#1F2937] hover:bg-black/5 dark:text-white/80 dark:hover:bg-white/10'
                                }`}
                              >
                                <RowIcon
                                  size={12}
                                  className={`shrink-0 ${isPreviewed ? 'text-white' : rowColor}`}
                                />
                                <span className="min-w-0 flex-1 truncate">{label}</span>
                                {isPreviewed && <Check size={12} className="shrink-0 text-white" />}
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
                  <div className="flex min-h-0 min-w-0 flex-1 flex-col p-[10px_14px]">
                    {!previewedTemplate ? (
                      <div className="flex flex-1 items-center justify-center text-center text-[12px] text-gray-400 dark:text-white/50">
                        Pick a template on the left to preview it.
                      </div>
                    ) : (
                      <>
                        <div className="mb-1.5 shrink-0">
                          <h4 className="text-[13px] font-semibold text-[#111827] dark:text-white mb-1 shrink-0">
                            {previewedTemplate.title || 'Template'}
                          </h4>
                        </div>
                        <div
                          onScroll={onPreviewScroll}
                          className={`min-h-0 flex-1 overflow-y-auto p-[2px_4px_6px] text-[12px] leading-[1.65] text-[#374151] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden dark:text-white/80 ${
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
                          const canUse = true;
                          const missing = [];
                          if (!brandName) missing.push('brand');
                          const skippedLabel = skippedPlaceholders
                            .map((p) => p.replace(/_/g, ' '))
                            .join(', ');

                          return (
                            <div className="mt-2 flex shrink-0 items-center justify-between gap-2 pt-1 border-t border-gray-100 dark:border-white/10">
                              {skippedPlaceholders.length > 0 ? (
                                <span
                                  title={`Fill in the highlighted field${skippedPlaceholders.length > 1 ? 's' : ''}: ${skippedLabel}`}
                                  className="flex min-w-0 items-center gap-1 text-[11px] font-medium text-amber-600 dark:text-amber-400"
                                >
                                  <AlertCircle size={12} className="shrink-0 text-amber-500" />
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
                                className="shrink-0 rounded-full bg-black px-4 py-1.5 text-[12px] font-semibold text-white transition-opacity hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-black dark:hover:bg-gray-200"
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
