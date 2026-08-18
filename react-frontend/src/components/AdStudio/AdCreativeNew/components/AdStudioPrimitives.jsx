/**
 * AdStudio — Shared Design Tokens & Primitive Class Strings
 *
 * Every AdStudio surface (Custom Ads, Lifestyle, Product Shots, App/SaaS,
 * Brand Awareness) imports these constants so inputs, cards, upload rows,
 * dropdowns, labels, etc. render with identical styling.
 *
 * RULES
 * ─────
 * • NEVER override these values with one-off Tailwind classes in a consumer.
 *   If a genuine new variant is needed, add it HERE so it stays in sync.
 * • Dark-mode classes use the existing `dark:…` convention.
 * • Focus / error / hover states are included in the base strings.
 */

// ── Inputs ──────────────────────────────────────────────────────────────────

/** Single-line text / URL input (standalone, not inside a composed field). */
export const INPUT_BASE =
  'h-[46px] w-full rounded-full bg-[var(--ws-surface-control)]! dark:bg-[#909294]/10! border! border-[var(--ws-border)]! dark:border-white/5! px-5 text-[13px] font-medium text-[#24211D] dark:text-white outline-none placeholder:text-[#948C80] dark:placeholder:text-[#afafaf]/70 focus-visible:ring-2 focus-visible:ring-[#02C8C4]/20 focus-visible:border-[#02C8C4]! dark:focus-visible:ring-white/20 transition-all';

/** Error ring override — append when the field is invalid. */
export const INPUT_ERROR_RING = 'border-red-500! ring-2 !ring-red-500/60';

/** Inner input inside a composed field (upload row, brand-voice row). No
 *  height / ring / bg — the outer wrapper owns those. */
export const INPUT_INNER =
  'min-w-0 flex-1 bg-transparent text-[13px] font-medium text-[#24211D] dark:text-white outline-none placeholder:text-[#948C80] dark:placeholder:text-[#afafaf]/70';

/** Multi-line textarea (prompt box inner). No ring / bg — the wrapping card
 *  owns the visual boundary. */
export const TEXTAREA_INNER =
  'min-h-0 flex-1 resize-none bg-transparent px-6 pt-5 pb-2 text-[15px] font-normal text-[#24211D] dark:text-white outline-none placeholder:text-[#948C80] dark:placeholder:text-[#afafaf]/70';

// ── Composed upload field (URL input + link icon + Upload Image button) ─────

/** Outer wrapper of the upload/URL composed field. */
export const UPLOAD_FIELD_WRAPPER =
  'flex h-[46px] items-center gap-2 rounded-full bg-[var(--ws-surface-control)]! dark:bg-[#909294]/10! border! border-[var(--ws-border)]! dark:border-white/5! pl-5 pr-1.5 transition-all';

/** The "Upload Image" pill button inside the upload row. */
export const UPLOAD_BUTTON =
  'flex h-[36px] shrink-0 items-center gap-1.5 rounded-full bg-[var(--ws-surface-header)] dark:bg-[#909294]/20 px-4 text-[12px] font-semibold text-[#24211D] dark:text-white border border-[var(--ws-border)] dark:border-white/5 hover:bg-[var(--ws-surface)] dark:hover:bg-[#33333a] transition-all';

// ── Labels & errors ─────────────────────────────────────────────────────────

export const FIELD_LABEL =
  'text-[13px] font-bold text-[#24211D] dark:text-white/90';

export const FIELD_ERROR =
  'mt-1.5 text-[12px] text-red-500';

/** Gap between a label and its field. Applied as a Tailwind `mt-` class on
 *  the field element, NOT on the label. */
export const LABEL_FIELD_GAP = 'mt-2';

// ── Cards ───────────────────────────────────────────────────────────────────

/** Main form shell card (the outermost white/dark rounded container). */
export const CARD_SHELL =
  'rounded-[28px] bg-[var(--ws-surface)] dark:bg-[#1b1c1e] border border-[var(--ws-border)] dark:border-white/10 shadow-[0_4px_20px_-2px_rgba(80,70,58,0.05),0_2px_6px_-1px_rgba(80,70,58,0.03)] backdrop-blur-md';

/** Inner section card (prompt box, model description box, reference panel). */
export const SECTION_CARD =
  'rounded-[24px] bg-[var(--ws-surface-control)] dark:bg-[#1a1b1e] border border-[var(--ws-border)] dark:border-white/10 p-5 shadow-xs';

/** Reference / right-column card (inside custom ads). */
export const REFERENCE_CARD =
  'rounded-[24px] bg-[var(--ws-surface)] dark:bg-[#202124] border border-[var(--ws-border)] dark:border-white/10';

// ── Picker pills (quality, model, aspect ratio) ────────────────────────────

export const PICKER_PILL =
  'flex items-center gap-1.5 rounded-full bg-[var(--ws-surface-control)] dark:bg-[#2b2a2a]/60 px-3 py-2.5 text-[12px] font-medium text-[#24211D] dark:text-white/80 border border-[var(--ws-border)] dark:border-white/10 transition-colors hover:bg-[var(--ws-surface-header)] dark:hover:bg-[#33333a]';

/** Dropdown panel that appears above/below a picker pill. */
export const PICKER_DROPDOWN =
  'overflow-hidden rounded-[16px] bg-[var(--ws-surface-control)] dark:bg-[#1f1f1f] shadow-2xl border border-[var(--ws-border)] dark:border-white/10';

/** Individual item inside a picker dropdown. */
export const PICKER_ITEM_BASE =
  'flex w-full items-center px-3 py-2.5 text-left text-[13px] transition-colors';

export const PICKER_ITEM_ACTIVE =
  'bg-[#E5DFD5] text-[#24211D] dark:bg-[#373839] dark:text-white';

export const PICKER_ITEM_INACTIVE =
  'text-[#7A7369] dark:text-white/80 hover:bg-[#EDE7DF] hover:text-[#24211D] dark:hover:bg-white/5 dark:hover:text-white';

// ── Brand voice row ─────────────────────────────────────────────────────────

export const BRAND_VOICE_ROW =
  'flex min-w-0 items-center gap-2 rounded-full bg-[var(--ws-surface-control)] dark:bg-[#909294]/10 border border-[var(--ws-border)] dark:border-white/5 p-1';

// ── Image chip / thumbnail ──────────────────────────────────────────────────

export const CHIP_SELECTED =
  'border-2 border-[#02C8C4] ring-1 ring-[#02C8C4]/40';

export const CHIP_UNSELECTED =
  'border border-[var(--ws-border)] dark:border-white/10 hover:border-[#C8C1B4] dark:hover:border-white/30';

// ── Spacing ─────────────────────────────────────────────────────────────────

/** Vertical gap between sibling form sections (e.g. between brand-voice and
 *  Product Name, between Product Name and Product Description, etc.). */
export const SECTION_GAP = 'space-y-5';

// ── Generate button ─────────────────────────────────────────────────────────

export const GENERATE_BUTTON =
  'flex items-center justify-center gap-2 rounded-full bg-gray-900 text-white dark:bg-white dark:text-black px-8 py-2.5 text-base font-semibold transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40';

export const CREDITS_BADGE =
  'rounded-full bg-[var(--ws-surface-control)] dark:bg-[#909294]/15 px-4 py-2 text-[13px] font-medium text-[#24211D] dark:text-white/70 border border-[var(--ws-border)] dark:border-white/10';
