// ----------------------------------------------------------------------------
// adPlatforms — which platforms Ad Factory can make creatives for, and the
// aspect ratios each one actually accepts.
//
// ONE source for both front doors. This list lived only inside v1's
// ValidateForm, and Quick setup grew its own shorter copy: two platforms
// (Meta, Google) against v1's nine, and a ratio list that had drifted in both
// directions — it offered `1.91:1`, which no platform here accepts, and was
// missing `2:3`, which Pinterest needs. A user could tick a ratio nothing
// would ever render at, and could not pick one that was genuinely supported.
//
// Ratios are per-platform on purpose. "16:9 on TikTok" is not a thing, and a
// flat global list is what let that be selectable.
//
// `isLaunchable` marks the platforms we can also POST to, not just generate
// for. Only Meta today — the rest produce creatives you download and upload
// yourself, and the UI has to say so rather than implying a launch that will
// never happen.
// ----------------------------------------------------------------------------

export const AD_PLATFORMS = [
  { id: 'meta', label: 'Meta', isLaunchable: true, ratios: ['1:1', '4:5', '9:16', '16:9'] },
  { id: 'google', label: 'Google', isLaunchable: false, ratios: ['1:1', '16:9'] },
  { id: 'tiktok', label: 'TikTok', isLaunchable: false, ratios: ['9:16'] },
  { id: 'snapchat', label: 'Snapchat', isLaunchable: false, ratios: ['9:16', '1:1'] },
  { id: 'linkedin', label: 'LinkedIn', isLaunchable: false, ratios: ['1:1', '16:9'] },
  { id: 'twitter', label: 'X', isLaunchable: false, ratios: ['1:1', '16:9'] },
  { id: 'pinterest', label: 'Pinterest', isLaunchable: false, ratios: ['1:1', '2:3', '9:16'] },
  { id: 'reddit', label: 'Reddit', isLaunchable: false, ratios: ['1:1', '16:9', '4:5'] },
  { id: 'whatsapp', label: 'WhatsApp', isLaunchable: false, ratios: ['1:1', '16:9'] },
];

export const PLATFORM_IDS = AD_PLATFORMS.map((p) => p.id);

/** Every ratio any platform accepts, in a stable order for rendering. */
export const ALL_RATIOS = ['1:1', '4:5', '2:3', '9:16', '16:9'];

const byId = new Map(AD_PLATFORMS.map((p) => [p.id, p]));

export const platform = (id) => byId.get(id) || null;

/**
 * The ratios valid for a SELECTION of platforms — the union, because a
 * creative set spanning Meta and TikTok legitimately needs both 4:5 and 9:16.
 * Falls back to Meta's when nothing is selected, since Meta is the default and
 * an empty ratio picker is worse than a sensible one.
 */
export function ratiosFor(platformIds = []) {
  const ids = (Array.isArray(platformIds) ? platformIds : []).filter((id) => byId.has(id));
  const source = ids.length ? ids : ['meta'];
  const allowed = new Set(source.flatMap((id) => byId.get(id).ratios));
  return ALL_RATIOS.filter((r) => allowed.has(r));
}

/** Drop ratios the current platform selection cannot render. */
export const pruneRatios = (ratios = [], platformIds = []) => {
  const allowed = new Set(ratiosFor(platformIds));
  return (Array.isArray(ratios) ? ratios : []).filter((r) => allowed.has(r));
};

// v1 caps: at least one platform, at most 10; at least one ratio each, at most
// 5. Mirrored here so both doors refuse the same things.
export const MAX_PLATFORMS = 10;
export const MAX_RATIOS = 5;
