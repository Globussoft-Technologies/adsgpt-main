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
//   light  #C17A1C   amber — the same roles on the warm light surface
//
// These three used to name the teal ramp (#02C8C4 / #0B7A78) the light theme
// was built on before the amber repaint. Nothing read them, so nothing broke —
// but a constant called ACCENT_LIGHT holding the colour light mode no longer
// uses is a trap for whoever reaches for it next.
export const ACCENT = '#15DCFF'; // fills, borders, and text on dark
export const ACCENT_LIGHT = '#C17A1C'; // fills, borders and focus on light
export const ACCENT_INK = '#8A4E0D'; // the same hue, dark enough to read on white
// What sits ON an accent fill. Never white — cyan at full strength is brighter
// than most page backgrounds.
export const ON_ACCENT = 'text-[#062024]';

// ─── Surfaces ────────────────────────────────────────────────────────────────

// The card. 10px, one hairline, and in light mode a single 1px shadow rather
// than a second border.
export const CARD =
  'rounded-lg border border-[#DED2BD] bg-[#FFFDF8] shadow-none dark:border-[#2E353E] dark:bg-[#14181D]';

// A hairline between two sections of the same card — a 1px rule, never a gap
// plus a border.
export const RULE = 'h-px w-full bg-[#E7DCC9] dark:bg-[#252B33]';
export const RULE_BORDER = 'border-[#E7DCC9] dark:border-[#252B33]';

// Padding inside a card section. One value, everywhere.
export const SECTION_PAD = 'px-4 py-4 2xl:px-5';

// ─── Type ────────────────────────────────────────────────────────────────────

// The page anchor — the brand name, and the only 21px thing on screen.
export const TITLE = 'text-[18px] font-semibold leading-[1.2] text-[#211A12] dark:text-[#ECEFF3]';

// A section heading inside a card.
export const SECTION = 'text-[14px] font-semibold text-[#211A12] dark:text-[#ECEFF3]';

// A field label. Sentence case, 13px, regular weight, grey — it names the
// field and then gets out of the way.
export const LABEL = 'text-[12px] font-medium text-[#6D6255] dark:text-[#8B939E]';

// The value inside a control.
export const VALUE = 'text-[13px] font-medium text-[#2C241B] dark:text-[#ECEFF3]';

// Secondary prose — hints, counts, the sentence under a heading.
export const MUTED = 'text-[12px] text-[#7A6F62] dark:text-[#AFB6C0]';

// Tertiary — placeholders, "None yet", a disabled count.
export const FAINT = 'text-[11px] text-[#9C8F7D] dark:text-[#6C7480]';

export const NUM = 'tabular-nums';

// ─── Controls ────────────────────────────────────────────────────────────────

// The shell every input, select and stepper shares. 8px, one border, one fill.
export const CONTROL =
  'rounded-md border border-[#D9CCB6] bg-[#FFFDF8] text-[#2C241B] shadow-none dark:border-[#2E353E] dark:bg-[#1E232A] dark:text-[#ECEFF3]';

// 36px is the control height across the system — tall enough to hit, short
// enough that four in a row don't dominate a section.
//
// It said 36px and was set to h-8 (32px), which is where the "everything is
// tiny" feeling in the right rail came from: 32px boxes holding 12px text, four
// of them stacked in a 340px column. The comment was right; the value wasn't.
export const CONTROL_H = 'h-9';

export const FOCUS = 'focus:border-[#C17A1C] focus:outline-none dark:focus:border-[#15DCFF]';
export const FOCUS_WITHIN = 'focus-within:border-[#C17A1C] dark:focus-within:border-[#15DCFF]';

export const PLACEHOLDER = 'placeholder:text-[#A99B88] dark:placeholder:text-[#6C7480]';

// A full single-line text control.
export const INPUT = `w-full ${CONTROL_H} ${CONTROL} ${FOCUS} ${PLACEHOLDER} px-3 text-[13px] font-medium disabled:opacity-50`;

// The same, for a textarea — no fixed height, comfortable leading.
export const TEXTAREA = `w-full resize-y ${CONTROL} ${FOCUS} ${PLACEHOLDER} px-3 py-2 text-[13px] leading-[1.45]`;

// ─── Pills and chips ─────────────────────────────────────────────────────────

// A selectable pill. `on` is the one place indigo appears outside the primary
// button.
export const PILL =
  'rounded-md border border-[#DED2BD] bg-[#FFFDF8] px-2 py-1 text-[12px] text-[#6D6255] transition-colors hover:border-[#CDBB9E] hover:text-[#2C241B] dark:border-[#2E353E] dark:bg-transparent dark:text-[#AFB6C0] dark:hover:border-[#3D4650] dark:hover:text-[#ECEFF3]';
export const PILL_ON =
  'rounded-md border border-[#C17A1C]/45 bg-[#F7E8CD] px-2 py-1 text-[12px] font-medium text-[#8A4E0D] dark:border-[#15DCFF]/35 dark:bg-[#15DCFF]/10 dark:text-[#15DCFF]';

// A read-only value chip — a listed item, not a choice.
export const CHIP =
  'rounded-md border border-[#DED2BD] bg-[#F7F1E8] px-2 py-1 text-[12px] text-[#2C241B] dark:border-[#2E353E] dark:bg-[#1E232A] dark:text-[#ECEFF3]';

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
  'inline-flex h-9 items-center justify-center gap-2 rounded-md S px-5 text-[13px] font-semibold text-white shadow-none transition-colors hover:bg-[#9D5F11] disabled:cursor-not-allowed disabled:opacity-45 dark:bg-[#15DCFF] dark:text-[#062024] dark:hover:bg-[#5FE8FF]';

// Everything else. A hairline and a label — no fill in dark, white in light.
export const BTN_GHOST =
  'inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-[#DED2BD] bg-[#FFFDF8] px-3 text-[12px] font-medium text-[#5D5144] shadow-none transition-colors hover:border-[#CDBB9E] hover:text-[#2C241B] disabled:cursor-not-allowed disabled:opacity-45 dark:border-[#2E353E] dark:bg-transparent dark:text-[#AFB6C0] dark:hover:border-[#3D4650] dark:hover:text-[#ECEFF3]';

// A text-only action inside prose.
// #02C8C4 as TEXT on white is about 2.4:1 — the darker step of the same hue is
// what makes an accent link readable in light mode.
export const BTN_LINK =
  'text-[12px] font-medium text-[#8A4E0D] underline-offset-2 hover:underline dark:text-[#15DCFF]';

// ─── Amber — low-confidence guesses, and nothing else ────────────────────────

export const FLAG_BORDER = '!border-[#F59E0B]/45 dark:!border-[#F59E0B]/35';
export const FLAG_BADGE =
  'inline-flex items-center gap-1.5 rounded-md border border-[#D8942E]/35 bg-[#F7E8CD] px-2 py-0.5 text-[11px] font-medium text-[#8A4E0D] dark:text-[#E8A33D]';

// ─── Menus ───────────────────────────────────────────────────────────────────

// Popover surfaces sit one step ABOVE the card so they read as floating, which
// is the one place the neutral ramp goes lighter rather than darker.
export const MENU =
  'border border-[#DED2BD] bg-[#FFFDF8] text-[#2C241B] shadow-[0_8px_24px_rgba(84,62,32,0.10)] dark:border-[#2E353E] dark:bg-[#1A1F26] dark:text-[#ECEFF3] dark:shadow-[0_8px_24px_rgba(0,0,0,0.55)]';
export const MENU_ITEM = 'text-[13px] focus:bg-[#F7F1E8] dark:focus:bg-[#272D35]';

// ─── Thumbnails ──────────────────────────────────────────────────────────────

export const THUMB =
  'rounded-md border border-[#DED2BD] bg-[#F7F1E8] object-cover dark:border-[#2E353E] dark:bg-[#22272F]';
export const THUMB_ADD =
  'rounded-md border border-dashed border-[#CDBB9E] text-[#9C8F7D] transition-colors hover:border-[#C17A1C]/60 hover:text-[#8A4E0D] dark:border-[#3D4650] dark:text-[#8B939E] dark:hover:border-[#15DCFF]/50 dark:hover:text-[#15DCFF]';
