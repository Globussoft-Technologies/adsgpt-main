// Background-less logo validation.
//
// A brand logo composited onto generated creatives has to be cut out — a logo
// carrying its own white/solid card shows up as a visible box on the ad. The
// only way to tell from the browser is to decode the file and read its alpha
// channel.
//
// One condition, deliberately: an image with no transparent pixels anywhere
// has a background. No format rules, no edge rules — those only ever produced
// false rejections. Anything we cannot decode is accepted, so an undecidable
// file never blocks the user.

// Alpha below this counts as "see-through" — leaves room for the fringe pixels
// anti-aliasing leaves behind around a cut-out edge.
const TRANSPARENT_ALPHA = 16;

// Downscale before reading pixels: a logo's background is a large flat region,
// so 256px is plenty and keeps the read off the main thread's critical path.
const SAMPLE_SIZE = 256;

// Below this the image is treated as having no transparency at all. A cut-out
// logo clears it by a wide margin (typically 30–70% of the frame is empty),
// while a logo on a solid card sits at a flat zero.
const MIN_TRANSPARENT_RATIO = 0.005;

export const LOGO_BACKGROUND_ERROR =
  'This logo has a background. Please upload a logo with a transparent background (PNG or SVG).';

const loadImage = (file) =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('decode failed'));
    };
    img.src = url;
  });

/**
 * Measure the transparency of an image file.
 *
 * Returns `{ transparent, reason, ...stats }`. `transparent: true` covers both
 * "verified cut-out" and "could not tell" — see `reason` to distinguish them.
 * Exported so the numbers can be inspected when a file is misjudged.
 */
export async function analyzeLogoTransparency(file) {
  if (!file) return { transparent: true, reason: 'no-file' };

  let img;
  try {
    img = await loadImage(file);
  } catch {
    return { transparent: true, reason: 'decode-failed' };
  }

  // SVGs without an intrinsic size report 0 here; render them at the sample
  // size rather than giving up on the file.
  const width = img.naturalWidth || img.width || SAMPLE_SIZE;
  const height = img.naturalHeight || img.height || SAMPLE_SIZE;

  const scale = Math.min(1, SAMPLE_SIZE / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));

  let data;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return { transparent: true, reason: 'no-canvas' };
    ctx.drawImage(img, 0, 0, w, h);
    data = ctx.getImageData(0, 0, w, h).data;
  } catch {
    // A canvas tainted by an SVG referencing external resources lands here.
    return { transparent: true, reason: 'read-failed' };
  }

  let transparentPixels = 0;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < TRANSPARENT_ALPHA) transparentPixels += 1;
  }
  const transparentRatio = transparentPixels / (w * h);

  return {
    transparent: transparentRatio >= MIN_TRANSPARENT_RATIO,
    reason: transparentRatio >= MIN_TRANSPARENT_RATIO ? 'cut-out' : 'no-alpha',
    transparentRatio,
    width,
    height,
    sampled: `${w}x${h}`,
  };
}

/**
 * Does this image file have a transparent background?
 *
 * Thin boolean wrapper over `analyzeLogoTransparency`. In dev the measured
 * stats are logged so a misjudged file can be diagnosed from the console.
 */
export async function hasTransparentBackground(file) {
  const result = await analyzeLogoTransparency(file);
  if (import.meta.env?.DEV) {
    console.debug('[logoTransparency]', file?.name, result);
  }
  return result.transparent;
}
