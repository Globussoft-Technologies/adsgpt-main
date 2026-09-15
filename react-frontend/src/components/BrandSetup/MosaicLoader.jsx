/**
 * The "this frame is being drawn" animation.
 *
 * A grid of small tiles, each breathing at its own rate, in the panel greys.
 * It replaces a sweeping shimmer, which is the wrong metaphor here: a band
 * travelling across a box says "content is loading over the wire", and nothing
 * is loading — an image is being COMPOSED, a piece at a time, somewhere else.
 * Tiles resolving at different speeds says that.
 *
 * ── Why the randomness is fake ──────────────────────────────────────────────
 * Every tile's brightness, delay and speed come from a hash of its index, not
 * from `Math.random()`. Real randomness would re-roll on every re-render — and
 * this sits inside a card that re-renders on every socket frame — so the whole
 * grid would visibly reshuffle several times a second. Hashed, the pattern is
 * fixed for a given position and only the animation moves.
 *
 * `offset` shifts that hash, so two placeholders side by side get different
 * patterns instead of reading as one image duplicated.
 *
 * Pure CSS once mounted: no timers, no state, no work on the main thread while
 * a render the user is actually waiting for is in flight.
 */

const COLS = 7;
const ROWS = 12;

/**
 * The tile palette, darkest first.
 *
 * Five steps, spaced unevenly and leaning slightly blue as they lighten — the
 * same direction the panel's own surfaces travel. Evenly spaced greys read as a
 * generated gradient; these read as a surface.
 */
const GREYS = [
  'rgba(255,255,255,0.03)',
  'rgba(232,236,248,0.055)',
  'rgba(232,236,248,0.09)',
  'rgba(238,242,255,0.135)',
  'rgba(244,247,255,0.185)',
];

/**
 * How far the tiles bleed into one another.
 *
 * Hard-edged squares read as a solid block with a pattern stamped on it. Blurred
 * to roughly a third of a tile they read as light pooling — still legible as a
 * grid, but with nothing in it you could cut yourself on.
 */
const BLUR_PX = 1;

/**
 * The AdsGPT ramp — the fallback palette for callers that want colour but have
 * no brand palette (a prompt-only run scrapes no colours).
 */
// Cyan + violet (user decision 2026-09-15). The earlier `#15DCFF`/`#5E66F5` pair
// read green: a faint cyan over near-black looks teal, and the indigo was too
// dark to register as violet.
export const ADSGPT_MOSAIC_PALETTE = ['#38E1FF', '#A06BFF'];

/**
 * Keeps only strings the browser accepts as a colour. The palette comes from
 * DS and is shown verbatim elsewhere; an invalid entry here would silently make
 * a tile transparent rather than tinted.
 */
export function usableColors(colors) {
  if (!Array.isArray(colors)) return [];
  return colors.filter(
    (c) =>
      typeof c === 'string' &&
      c.trim() &&
      (typeof CSS === 'undefined' || CSS.supports?.('color', c.trim()))
  );
}

// ── Colour, when a palette is given ─────────────────────────────────────────
// User decisions 2026-09-15: the brand's own colours, as a SOFT tint on every
// tile, with a slow diagonal wave. The tint strength is picked per tile from
// this range so neighbouring tiles differ without any of them going vivid.
// Raised from 15–25: at that strength the hue washed out into teal/grey.
const TINT_MIN = 22; // percent of the palette colour mixed over transparent
const TINT_MAX = 34;
// One pass of the wave across the grid, top-left to bottom-right.
const WAVE_SECONDS = 4;

/**
 * A small deterministic hash → [0, 1).
 *
 * Not cryptographic and does not need to be. It only has to look unpatterned
 * to the eye and give the same answer every time for the same input.
 */
function noise(n) {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * @param offset  shifts the pattern, so two loaders side by side differ
 * @param cols/rows/blur/speed  overridable for the tuning harness at
 *   `/mosaic-preview`; every default is the value the product actually ships,
 *   so a number that looks right in the lab is the number to paste up here.
 */
export default function MosaicLoader({
  offset = 0,
  className = '',
  cols = COLS,
  rows = ROWS,
  blur = BLUR_PX,
  speed = 1,
  // CSS colour strings. Omitted → the original greys, unchanged, which is what
  // the whole-card skeletons still use.
  palette,
}) {
  const cells = [];
  const colors = usableColors(palette);
  const tinted = colors.length > 0;

  for (let i = 0; i < cols * rows; i += 1) {
    const seed = i + offset * 97;
    const a = noise(seed);
    const b = noise(seed + 1.7);
    const c = noise(seed + 3.1);

    // Actual greys, not one white at three opacities. Opacity alone against a
    // near-black panel gives three shades of the same flat wash; separate tones
    // leaning slightly blue as they lighten read as material, which is what
    // stops the grid looking like a solid block with holes punched in it.
    let tone = GREYS[Math.min(GREYS.length - 1, Math.floor(a * GREYS.length))];
    if (tinted) {
      // A brand colour per tile (hashed, so it never reshuffles on re-render),
      // mixed at a soft strength over transparent so the dark panel shows
      // through. `color-mix` keeps any valid CSS colour usable as-is.
      const color = colors[Math.floor(c * colors.length) % colors.length];
      const strength = Math.round(TINT_MIN + a * (TINT_MAX - TINT_MIN));
      tone = `color-mix(in srgb, ${color} ${strength}%, transparent)`;
    }

    const breatheDelay = ((b * 2.8) / speed).toFixed(2);
    const breatheDuration = ((2.2 + a * 1.8) / speed).toFixed(2);

    // The wave: a brightness lift that travels diagonally. Each tile's delay is
    // its position along the diagonal, so the grid lights in a sweep rather than
    // flickering at random — an image being assembled. A separate property
    // (`filter`) from the breathing (`opacity`), so the two layer instead of
    // fighting over one value.
    const col = i % cols;
    const row = Math.floor(i / cols);
    const diagonal = (col + row) / Math.max(1, cols + rows - 2);
    const waveDelay = ((diagonal * WAVE_SECONDS) / speed).toFixed(2);

    cells.push(
      <span
        key={i}
        style={{
          background: tone,
          // Spread over the full cycle so the grid never pulses in unison,
          // which would read as the whole box flashing.
          animation: tinted
            ? `mosaicBreathe ${breatheDuration}s ease-in-out ${breatheDelay}s infinite, mosaicWave ${(WAVE_SECONDS / speed).toFixed(2)}s ease-in-out ${waveDelay}s infinite`
            : `mosaicBreathe ${breatheDuration}s ease-in-out ${breatheDelay}s infinite`,
        }}
      />
    );
  }

  return (
    <div
      className={`grid h-full w-full gap-px ${className}`}
      style={{
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gridTemplateRows: `repeat(${rows}, 1fr)`,
        filter: `blur(${blur}px)`,
        // Blur softens the OUTER edge too, which would leave a pale halo just
        // inside the frame's border. Scaling past the box pushes that halo
        // under the crop.
        transform: 'scale(1.1)',
      }}
      aria-hidden
    >
      {cells}
      <style>{`
        @keyframes mosaicBreathe {
          0%, 100% { opacity: 0.3 }
          50%      { opacity: 1 }
        }
        @keyframes mosaicWave {
          0%, 70%, 100% { filter: brightness(1) }
          20%           { filter: brightness(2.1) saturate(1.25) }
        }
      `}</style>
    </div>
  );
}
