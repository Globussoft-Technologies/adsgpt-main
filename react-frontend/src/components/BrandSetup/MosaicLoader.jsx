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
}) {
  const cells = [];

  for (let i = 0; i < cols * rows; i += 1) {
    const seed = i + offset * 97;
    const a = noise(seed);
    const b = noise(seed + 1.7);

    // Actual greys, not one white at three opacities. Opacity alone against a
    // near-black panel gives three shades of the same flat wash; separate tones
    // leaning slightly blue as they lighten read as material, which is what
    // stops the grid looking like a solid block with holes punched in it.
    const tone = GREYS[Math.min(GREYS.length - 1, Math.floor(a * GREYS.length))];

    cells.push(
      <span
        key={i}
        style={{
          background: tone,
          // Spread over the full cycle so the grid never pulses in unison,
          // which would read as the whole box flashing.
          animationDelay: `${((b * 2.8) / speed).toFixed(2)}s`,
          animationDuration: `${((2.2 + a * 1.8) / speed).toFixed(2)}s`,
        }}
        className="animate-[mosaicBreathe_3s_ease-in-out_infinite]"
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
      `}</style>
    </div>
  );
}
