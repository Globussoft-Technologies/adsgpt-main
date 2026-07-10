// ----------------------------------------------------------------------------
// FALLBACK_AD_CREATIVE_MODELS — hardcoded mirror of the `ad_creative` image
// surface (GET /usage/model-credit-value?media=ad_creative&type=image).
//
// Used by useAdCreativeConfig whenever the live fetch hasn't resolved or fails,
// so the pickers always render. Keep in sync with modelRegistry.js /
// surfaceCatalog.js on the backend. Ordered cheapest-first (by high tier), to
// match the endpoint's sort.
// ----------------------------------------------------------------------------

const COMMON_RATIOS = ['1:1', '4:5', '9:16', '2:3', '3:4', '16:9', '21:9', '3:2', '4:3', '5:4'];

export const FALLBACK_AD_CREATIVE_MODELS = [
  {
    apiId: 'seedream-5.0-lite',
    label: 'Seedream 5.0 lite',
    icon: 'google',
    aspectRatios: COMMON_RATIOS,
    qualities: ['low', 'medium', 'high'],
    creditsByQuality: { low: 1, medium: 1, high: 1 },
    creditsPerImage: 1,
  },
  {
    apiId: 'gemini-3.1-flash-image-preview',
    label: 'Nano Banana 2',
    icon: 'google',
    aspectRatios: [...COMMON_RATIOS, '1:4', '4:1', '1:8', '8:1'],
    qualities: ['low', 'medium', 'high', 'ultra_high'],
    creditsByQuality: { low: 1, medium: 2, high: 3, ultra_high: 4 },
    creditsPerImage: 3,
  },
  {
    apiId: 'gpt-image-1.5',
    label: 'OpenAI 1.5',
    icon: 'google',
    aspectRatios: COMMON_RATIOS,
    qualities: ['low', 'medium', 'high'],
    creditsByQuality: { low: 1, medium: 1, high: 4 },
    creditsPerImage: 4,
  },
  {
    apiId: 'gemini-3-pro-image-preview',
    label: 'Nano Banana Pro',
    icon: 'google',
    aspectRatios: COMMON_RATIOS,
    qualities: ['low', 'medium', 'high'],
    creditsByQuality: { low: 4, medium: 4, high: 6 },
    creditsPerImage: 6,
  },
  {
    apiId: 'gpt-image-2',
    label: 'OpenAI 2.0',
    icon: 'google',
    aspectRatios: COMMON_RATIOS,
    qualities: ['low', 'medium', 'high'],
    creditsByQuality: { low: 1, medium: 2, high: 6 },
    creditsPerImage: 6,
  },
];
