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
export const ACCENT = '#15DCFF'; // fills, borders, and text on dark
export const ACCENT_LIGHT = '#02C8C4'; // fills, borders and focus on light
export const ACCENT_INK = '#0B7A78'; // the same hue, dark enough to read on white
// What sits ON an accent fill. Never white — cyan at full strength is brighter
// than most page backgrounds.
export const ON_ACCENT = 'text-[#062024]';

// ─── Surfaces ────────────────────────────────────────────────────────────────

// The card. 10px, one hairline, and in light mode a single 1px shadow rather
// than a second border.
export const CARD =
  'rounded-[10px] border border-[#E5E7EB] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)] dark:border-[#252B33] dark:bg-[#14181D] dark:shadow-none';

// A hairline between two sections of the same card — a 1px rule, never a gap
// plus a border.
export const RULE = 'h-px w-full bg-[#E5E7EB] dark:bg-[#252B33]';
export const RULE_BORDER = 'border-[#E5E7EB] dark:border-[#252B33]';

// Padding inside a card section. One value, everywhere.
export const SECTION_PAD = 'px-5 py-5 2xl:px-6';

// ─── Type ────────────────────────────────────────────────────────────────────

// The page anchor — the brand name, and the only 21px thing on screen.
export const TITLE =
  'text-[21px] font-semibold leading-[1.2] tracking-[-0.021em] text-[#0A0A0A] dark:text-[#ECEFF3]';

// A section heading inside a card.
export const SECTION =
  'text-sm font-semibold tracking-[-0.011em] text-[#0A0A0A] dark:text-[#ECEFF3]';

// A field label. Sentence case, 13px, regular weight, grey — it names the
// field and then gets out of the way.
export const LABEL = 'text-13 font-normal text-[#6B7280] dark:text-[#8B939E]';

// The value inside a control.
export const VALUE =
  'text-sm font-medium tracking-[-0.006em] text-[#111827] dark:text-[#ECEFF3]';

// Secondary prose — hints, counts, the sentence under a heading.
export const MUTED = 'text-13 text-[#6B7280] dark:text-[#AFB6C0]';

// Tertiary — placeholders, "None yet", a disabled count.
export const FAINT = 'text-13 text-[#9CA3AF] dark:text-[#6C7480]';

export const NUM = 'tabular-nums';

// ─── Controls ────────────────────────────────────────────────────────────────

// The shell every input, select and stepper shares. 8px, one border, one fill.
export const CONTROL =
  'rounded-lg border border-[#E5E7EB] bg-white text-[#111827] shadow-[0_1px_2px_rgba(16,24,40,0.04)] dark:border-[#2E353E] dark:bg-[#1E232A] dark:text-[#ECEFF3] dark:shadow-none';

// 36px is the control height across the system — tall enough to hit, short
// enough that four in a row don't dominate a section.
export const CONTROL_H = 'h-9';

export const FOCUS = 'focus:border-[#02C8C4] focus:outline-none dark:focus:border-[#15DCFF]';
export const FOCUS_WITHIN =
  'focus-within:border-[#02C8C4] dark:focus-within:border-[#15DCFF]';

export const PLACEHOLDER = 'placeholder:text-[#9CA3AF] dark:placeholder:text-[#6C7480]';

// A full single-line text control.
export const INPUT = `w-full ${CONTROL_H} ${CONTROL} ${FOCUS} ${PLACEHOLDER} px-3 text-sm font-medium tracking-[-0.006em] disabled:opacity-50`;

// The same, for a textarea — no fixed height, comfortable leading.
export const TEXTAREA = `w-full resize-y ${CONTROL} ${FOCUS} ${PLACEHOLDER} px-3 py-2.5 text-sm leading-[1.55]`;

// ─── Pills and chips ─────────────────────────────────────────────────────────

// A selectable pill. `on` is the one place indigo appears outside the primary
// button.
export const PILL =
  'rounded-[7px] border border-[#E5E7EB] bg-white px-2.5 py-1.5 text-13 text-[#374151] transition-colors hover:border-[#D1D5DB] hover:text-[#111827] dark:border-[#2E353E] dark:bg-transparent dark:text-[#AFB6C0] dark:hover:border-[#3D4650] dark:hover:text-[#ECEFF3]';
export const PILL_ON =
  'rounded-[7px] border border-[#02C8C4]/45 bg-[#02C8C4]/12 px-2.5 py-1.5 text-13 font-medium text-[#0B7A78] dark:border-[#15DCFF]/35 dark:bg-[#15DCFF]/10 dark:text-[#15DCFF]';

// A read-only value chip — a listed item, not a choice.
export const CHIP =
  'rounded-[7px] border border-[#E5E7EB] bg-white px-2.5 py-1.5 text-13 text-[#111827] dark:border-[#2E353E] dark:bg-[#1E232A] dark:text-[#ECEFF3]';

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
export const BTN_PRIMARY =
  'inline-flex h-9.5 items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-[#15DCFF] to-[#6b72f8] px-5 text-sm font-semibold tracking-[-0.006em] text-white shadow-[0_4px_14px_rgba(21,220,255,0.35)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45';

// Everything else. A hairline and a label — no fill in dark, white in light.
export const BTN_GHOST =
  'inline-flex h-8.5 items-center justify-center gap-1.5 rounded-lg border border-[#E5E7EB] bg-white px-3.5 text-13 font-medium text-[#374151] shadow-[0_1px_2px_rgba(16,24,40,0.04)] transition-colors hover:border-[#D1D5DB] hover:text-[#111827] disabled:cursor-not-allowed disabled:opacity-45 dark:border-[#2E353E] dark:bg-transparent dark:text-[#AFB6C0] dark:shadow-none dark:hover:border-[#3D4650] dark:hover:text-[#ECEFF3]';

// A text-only action inside prose.
// #02C8C4 as TEXT on white is about 2.4:1 — the darker step of the same hue is
// what makes an accent link readable in light mode.
export const BTN_LINK =
  'text-13 font-medium text-[#0B7A78] underline-offset-2 hover:underline dark:text-[#15DCFF]';

// ─── Amber — low-confidence guesses, and nothing else ────────────────────────

export const FLAG_BORDER = '!border-[#F59E0B]/45 dark:!border-[#F59E0B]/35';
export const FLAG_BADGE =
  'inline-flex items-center gap-1.5 rounded-md border border-[#F59E0B]/30 bg-[#F59E0B]/8 px-2 py-0.5 text-13 font-medium text-[#B45309] dark:text-[#E8A33D]';

// ─── Menus ───────────────────────────────────────────────────────────────────

// Popover surfaces sit one step ABOVE the card so they read as floating, which
// is the one place the neutral ramp goes lighter rather than darker.
export const MENU =
  'border border-[#E5E7EB] bg-white text-[#111827] shadow-[0_8px_24px_rgba(16,24,40,0.10)] dark:border-[#2E353E] dark:bg-[#1A1F26] dark:text-[#ECEFF3] dark:shadow-[0_8px_24px_rgba(0,0,0,0.55)]';
export const MENU_ITEM = 'text-13 focus:bg-[#F3F4F6] dark:focus:bg-[#272D35]';

// ─── Thumbnails ──────────────────────────────────────────────────────────────

export const THUMB =
  'rounded-[7px] border border-[#E5E7EB] bg-[#F9FAFB] object-cover dark:border-[#2E353E] dark:bg-[#22272F]';
export const THUMB_ADD =
  'rounded-[7px] border border-dashed border-[#D1D5DB] text-[#9CA3AF] transition-colors hover:border-[#02C8C4]/50 hover:text-[#0B7A78] dark:border-[#3D4650] dark:text-[#8B939E] dark:hover:border-[#15DCFF]/50 dark:hover:text-[#15DCFF]';
