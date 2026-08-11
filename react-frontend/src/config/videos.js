/**
 * videos.js
 * Central configuration for all YouTube demo video links used in the
 * onboarding tour. Update URLs here — no other file needs to change.
 *
 * Format: YouTube short links (youtu.be) or full watch links both work.
 * Each feature / sub-tab now has its own dedicated key so you can set
 * a unique video per step without touching tourSteps.js.
 */

export const VIDEO_LINKS = {
  // ── Top-level features ────────────────────────────────────────────────
  adFactory: 'https://youtu.be/7aIIF5R1uY4?si=MLopFyLZOzkm4-QR',
  ai: 'https://youtu.be/cD8VnFKWuJc?si=4suQbtc_4o7k5iu_',
  adsManager: 'https://youtu.be/JNi9shpbejY?si=FBdGRBfb1zlNNBWa',

  // ── Ad Studio sub-tabs ────────────────────────────────────────────────
  adStudio: 'https://youtu.be/4eoqeKHP4pA?si=HQ3WkfzTRG5BglJ2', // overview / fallback
  adCopy: 'https://youtu.be/BNfEhHtZ820?si=rdqZ5nQfNX6_q3W0',
  adCreative: 'https://youtu.be/L0O0U5og4kE?si=oQLej5vJpmZuUNe7',
  adVideo: 'https://youtu.be/gW2cBH_xfNY?si=S2Af1omEYImY0xGT',
  adLibrary: 'https://www.youtube.com/watch?v=xxxxxxxx',

  // ── BrandIQ sub-tabs ──────────────────────────────────────────────────
  brandIQ: 'https://youtu.be/DzWptjSz70U?si=xJgvkblCxixxZExH',          // overview / fallback
  myBrands: 'https://youtu.be/V2cSjSixx-E?si=VXSHVdmycQ8EpFzw',
  competitors: 'https://youtu.be/Lg3SFyOaDBM?si=wRUqw-eCqn8eo8K9',
};

export default VIDEO_LINKS;
