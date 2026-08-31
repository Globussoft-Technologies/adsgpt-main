// ----------------------------------------------------------------------------
// Quick setup's visual system — "Refined", the approved dark direction.
//
// Every class string the v2 surface uses for a surface, a control or a piece of
// type lives here, so the whole flow moves together and cannot drift the way it
// did when each component carried its own hex codes.
//
// What changed from the Autopilot-derived pass, and why:
//
//   TYPE DOES THE HIERARCHY.  There is a real four-step ramp — page title 21px
//   semibold, section 14px semibold, value 14px medium, label 13px regular
//   grey. Before, almost everything was 10–13px and the only thing separating a
//   label from a value was weight, so nothing on the screen was ever the
//   biggest thing. That is what "nothing stands out" meant.
//
//   NO UPPERCASE MICRO-LABELS.  `text-10 font-bold uppercase tracking-wider`
//   sat above all twenty fields. Letterspaced all-caps on every label is the
//   single strongest "admin template" tell there is; labels are sentence case
//   now and recede instead of shouting in unison.
//
//   AUTOPILOT'S SURFACES.  This one went the other way and came back.
//
//   The first pass moved to pure neutral greys, on the argument that blue-
//   tinted greys read as plastic. Against the real app that was wrong, for a
//   reason the design board could not show: the app's dark page is #0f0f0f, so
//   a #161616 card and a #1C1C1C control are three values within six points of
//   each other and the whole screen reads as one flat black sheet. The theory
//   was about hue; the actual problem was CONTRAST.
//
//   The ramp is Autopilot's now — the surface vocabulary the rest of this
//   product already uses — resolved to hex so it stays predictable:
//
//     page    #0f0f0f   (the app's own, index.css .dark --background)
//     card    #14181D   Autopilot's card, verbatim
//     control #1E232A   ≈ Autopilot's white/6 over that card
//     hairline#252B33   ≈ white/10
//     border  #2E353E   ≈ white/12
//
//   The step from card to control is the part that was missing, and it is what
//   makes a dark screen legible: every box you can type into is visibly lifted
//   off the one it sits on. Type is on the same cool axis and brighter than
//   before, because a label that was legible on #161616 is not automatically
//   legible on #14181D with a lighter control beside it.
//
//   ONE ACCENT, USED TWICE.  Cyan (#15DCFF), indigo (#6b72f8), a cyan-to-indigo
//   gradient AND amber were all competing. ONE of them now marks selection and
//   pays for the single primary button. Amber is reserved for low-confidence
//   guesses and nothing else, so "worth a look" stays unambiguous.
//
//   The one is CYAN, not indigo. Indigo was tried first, on the reasoning that
//   it was half the old gradient and so kept some continuity. That was wrong
//   about the product: across react-frontend/src #15DCFF has 484 uses, #02C8C4
//   167, and #6b72f8 147 — of which essentially all are the SECOND stop of a
//   gradient starting at #15DCFF. Indigo was never a standalone brand colour
//   here, so using it alone made this the only purple screen in the app.
//
//   SMALLER RADII, SINGLE HAIRLINES.  Cards go 16px to 10px, controls to 8px,
//   and a box gets a border or a fill, not both.
//
//   (This bullet used to also say "solid primary", on the theory that a
//   gradient button is the biggest "cheap" signal on a page. That was right in
//   general and wrong about this app — see BTN_PRIMARY.)
//
// Light mode is the same system with the values inverted (white surfaces on a
// tinted page, one-pixel shadow instead of a lift in value), so both themes
// stay in step.
// ----------------------------------------------------------------------------

// ─── Accent ──────────────────────────────────────────────────────────────────

// Cyan is a LIGHT colour, and that forces one split indigo did not need: it
// carries near-black text on a filled button (exactly what Autopilot's own
// PrimaryButton does) and it cannot be used as text on white.
// TWO accents, one per theme, and every token below pairs them:
//
//   dark   #15DCFF   the app's cyan — selection, focus, links, primary fill
//   light  #5867EB   indigo — the app's accessible accent on the light surface
//
// These three used to name the teal ramp (#02C8C4 / #0B7A78) the light theme
// was built on before the amber repaint. Nothing read them, so nothing broke —
// but a constant called ACCENT_LIGHT holding the colour light mode no longer
// uses is a trap for whoever reaches for it next.
export const ACCENT = '#15DCFF'; // fills, borders, and text on dark
export const ACCENT_LIGHT = '#5867EB'; // accessible Light Mode accent text and focus
export const ACCENT_INK = '#4654D4'; // stronger accent ink for Light Mode copy
// What sits ON an accent fill. Never white — cyan at full strength is brighter
// than most page backgrounds.
export const ON_ACCENT = 'text-[#062024]';

// ─── Surfaces ────────────────────────────────────────────────────────────────

// The card. 10px, one hairline, and in light mode a single 1px shadow rather
// than a second border.
export const CARD =
  'rounded-lg border border-[var(--ws-border)] bg-[var(--ws-surface)] shadow-[var(--ws-shadow-sm)] dark:border-[#2A2A2A] dark:bg-[#171717] dark:shadow-none';

// A hairline between two sections of the same card — a 1px rule, never a gap
// plus a border.
export const RULE = 'h-px w-full bg-[var(--ws-border)] dark:bg-[#2A2A2A]';
export const RULE_BORDER = 'border-[var(--ws-border)] dark:border-[#2A2A2A]';

// Padding inside a card section. One value, everywhere.
export const SECTION_PAD = 'px-4 py-4 2xl:px-5';

// ─── Type ────────────────────────────────────────────────────────────────────

// The page anchor — the brand name, and the only 21px thing on screen.
export const TITLE = 'text-[18px] font-semibold leading-[1.2] text-[var(--ws-text-primary)] dark:text-[#F4F4F5]';

// A section heading inside a card.
export const SECTION = 'text-[14px] font-semibold text-[var(--ws-text-primary)] dark:text-[#F4F4F5]';

// A field label. Sentence case, 13px, regular weight, grey — it names the
// field and then gets out of the way.
export const LABEL = 'text-[12px] font-medium text-[var(--ws-text-secondary)] dark:text-[#AFAFAF]';

// The value inside a control.
export const VALUE = 'text-[13px] font-medium text-[var(--ws-text-primary)] dark:text-[#F4F4F5]';

// Secondary prose — hints, counts, the sentence under a heading.
export const MUTED = 'text-[12px] text-[var(--ws-text-secondary)] dark:text-[#AFAFAF]';

// Tertiary — placeholders, "None yet", a disabled count.
export const FAINT = 'text-[11px] text-[var(--ws-text-muted)] dark:text-[#777777]';

export const NUM = 'tabular-nums';

// ─── Controls ────────────────────────────────────────────────────────────────

// The shell every input, select and stepper shares. 8px, one border, one fill.
export const CONTROL =
  'rounded-md border border-[var(--ws-border)] bg-[var(--ws-surface-control)] text-[var(--ws-text-primary)] shadow-none dark:border-[#2A2A2A] dark:bg-[#202020] dark:text-[#F4F4F5]';

// 36px is the control height across the system — tall enough to hit, short
// enough that four in a row don't dominate a section.
//
// It said 36px and was set to h-8 (32px), which is where the "everything is
// tiny" feeling in the right rail came from: 32px boxes holding 12px text, four
// of them stacked in a 340px column. The comment was right; the value wasn't.
export const CONTROL_H = 'h-9';

export const FOCUS = 'focus:border-[#5867EB] focus:outline-none dark:focus:border-[#15DCFF]';
export const FOCUS_WITHIN = 'focus-within:border-[#5867EB] dark:focus-within:border-[#15DCFF]';

export const PLACEHOLDER = 'placeholder:text-[var(--ws-text-muted)] dark:placeholder:text-[#777777]';

// A full single-line text control.
export const INPUT = `w-full ${CONTROL_H} ${CONTROL} ${FOCUS} ${PLACEHOLDER} px-3 text-[13px] font-medium disabled:opacity-50`;

// The same, for a textarea — no fixed height, comfortable leading.
export const TEXTAREA = `w-full resize-y ${CONTROL} ${FOCUS} ${PLACEHOLDER} px-3 py-2 text-[13px] leading-[1.45]`;

// ─── Pills and chips ─────────────────────────────────────────────────────────

// A selectable pill. `on` is the one place indigo appears outside the primary
// button.
export const PILL =
  'rounded-md border border-[var(--ws-border)] bg-[var(--ws-surface)] px-2 py-1 text-[12px] text-[var(--ws-text-secondary)] transition-colors hover:border-[var(--ws-border-strong)] hover:text-[var(--ws-text-primary)] dark:border-[#2A2A2A] dark:bg-transparent dark:text-[#AFAFAF] dark:hover:border-[#3A3A3A] dark:hover:text-[#F4F4F5]';
export const PILL_ON =
  'rounded-md border border-[#5867EB]/30 bg-[#5867EB]/10 px-2 py-1 text-[12px] font-medium text-[#4654D4] dark:border-[#15DCFF]/35 dark:bg-[#15DCFF]/10 dark:text-[#15DCFF]';

// A read-only value chip — a listed item, not a choice.
export const CHIP =
  'rounded-md border border-[var(--ws-border)] bg-[var(--ws-surface-hover)] px-2 py-1 text-[12px] text-[var(--ws-text-primary)] dark:border-[#2A2A2A] dark:bg-[#202020] dark:text-[#F4F4F5]';

// ─── Buttons ─────────────────────────────────────────────────────────────────

// The one saturated element on the page. Solid, never a gradient.
// The app's primary treatment, verbatim: the same cyan-to-indigo gradient,
// white label and cyan glow the ACTIVE sidebar tile wears
// (components/layout/sidebar/AppSidebar.jsx), which is the most recognisable
// accent surface in the product.
//
// The refined pass made this a flat solid on the argument that gradient
// primaries read as a template. True in the abstract, wrong here: this
// gradient is not decoration, it is the brand mark. Flattening it to one stop
// took the indigo tail out of context and left the only purple button in the
// app; using the gradient whole reads as AdsGPT.
//
// Selection stays SOLID cyan (see PILL_ON) rather than gradient. That split is
// the app's too — the sidebar tile and Autopilot's PrimaryButton are gradient,
// Autopilot's CheckboxBox and active filters are flat #15DCFF. Gradient means
// "this is the action"; flat cyan means "this one is on".
// LIGHT amber, DARK cyan — the same pair every other accent token here wears.
//
// This was the one token that didn't. It painted amber in both themes, so on
// the dark surface — where selected pills, focus rings, links, the progress bar
// and the "Add" button are all #15DCFF — the single most prominent control on
// the page was the only orange thing on screen. Not a second accent by design;
// just the one token the amber repaint reached without its dark half.
//
// Cyan is a LIGHT colour, so the label flips to near-black on the dark fill
// rather than staying white. That is not a special case for this button: it is
// exactly what ImageStrip's "Add" (briefFields.jsx) and Autopilot's own
// PrimaryButton already do with the same fill.
export const BTN_PRIMARY =
  'adfactory-btn-primary inline-flex h-9 items-center justify-center gap-2 rounded-md px-5 text-[13px] font-semibold text-white shadow-[0_3px_10px_rgba(88,103,235,0.22)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-45 dark:shadow-[0_3px_12px_rgba(21,220,255,0.16)]';

// Everything else. A hairline and a label — no fill in dark, white in light.
export const BTN_GHOST =
  'inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-[var(--ws-border)] bg-[var(--ws-surface)] px-3 text-[12px] font-medium text-[var(--ws-text-secondary)] shadow-[var(--ws-shadow-sm)] transition-colors hover:border-[var(--ws-border-strong)] hover:text-[var(--ws-text-primary)] disabled:cursor-not-allowed disabled:opacity-45 dark:border-[#2A2A2A] dark:bg-transparent dark:text-[#AFAFAF] dark:shadow-none dark:hover:border-[#3A3A3A] dark:hover:text-[#F4F4F5]';

// A text-only action inside prose.
// #02C8C4 as TEXT on white is about 2.4:1 — the darker step of the same hue is
// what makes an accent link readable in light mode.
export const BTN_LINK =
  'text-[12px] font-medium text-[#4654D4] underline-offset-2 hover:underline dark:text-[#15DCFF]';

// ─── Amber — low-confidence guesses, and nothing else ────────────────────────

export const FLAG_BORDER = '!border-[#F59E0B]/45 dark:!border-[#F59E0B]/35';
export const FLAG_BADGE =
  'inline-flex items-center gap-1.5 rounded-md border border-[#D8942E]/35 bg-[#F7E8CD] px-2 py-0.5 text-[11px] font-medium text-[#8A4E0D] dark:text-[#E8A33D]';

// ─── Menus ───────────────────────────────────────────────────────────────────

// Popover surfaces sit one step ABOVE the card so they read as floating, which
// is the one place the neutral ramp goes lighter rather than darker.
export const MENU =
  'adfactory-v2-menu rounded-lg border border-[#E5E7EB] bg-white text-[#111827] shadow-[0_10px_25px_-5px_rgba(0,0,0,0.08),0_8px_10px_-6px_rgba(0,0,0,0.04)] p-1 dark:border-[#2A2A2A] dark:bg-[#1C1C1C] dark:text-[#F4F4F5] dark:shadow-[0_8px_24px_rgba(0,0,0,0.55)]';
export const MENU_ITEM =
  'adfactory-v2-menu-item text-[13px] font-medium text-[#374151] rounded-md transition-colors hover:bg-[#F3F4F6] hover:text-[#111827] focus:bg-[#F3F4F6] focus:text-[#111827] data-[highlighted]:bg-[#F3F4F6] data-[highlighted]:text-[#111827] data-[state=checked]:bg-[#F3F4F6] data-[state=checked]:text-[#111827] dark:text-[#E4E4E7] dark:hover:bg-[#262626] dark:hover:text-[#F4F4F5] dark:focus:bg-[#262626] dark:focus:text-[#F4F4F5] dark:data-[highlighted]:bg-[#262626] dark:data-[highlighted]:text-[#F4F4F5] dark:data-[state=checked]:bg-[#262626] dark:data-[state=checked]:text-white cursor-pointer py-1.5 px-2.5';

// ─── Thumbnails ──────────────────────────────────────────────────────────────

export const THUMB =
  'rounded-md border border-[var(--ws-border)] bg-[var(--ws-surface-hover)] object-cover dark:border-[#2A2A2A] dark:bg-[#242424]';
export const THUMB_ADD =
  'rounded-md border border-dashed border-[var(--ws-border-strong)] text-[var(--ws-text-muted)] transition-colors hover:border-[#5867EB]/60 hover:text-[#4654D4] dark:border-[#3A3A3A] dark:text-[#777777] dark:hover:border-[#15DCFF]/50 dark:hover:text-[#15DCFF]';
