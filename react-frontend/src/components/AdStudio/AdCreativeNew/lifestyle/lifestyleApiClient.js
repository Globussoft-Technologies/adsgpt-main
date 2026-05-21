// Client for POST /lifestyle-ads/generate on the Go backend.
//
// Mirrors the AI Creatives client (see ../ai-creatives/apiClient.js).

import { getAuthToken, getUserId } from '../ai-creatives/apiClient';

const env = import.meta.env;
const GO_BACKEND_URL = env.VITE_GO_BACKEND_URL ?? 'http://localhost:8001';

export async function generateLifestyleAds(payload, signal) {
  const res = await fetch(`${GO_BACKEND_URL}/lifestyle-ads/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });
  if (!res.ok) {
    let detail = `Generate failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.detail) detail = body.detail;
    } catch {
      /* fall through */
    }
    throw new Error(detail);
  }
  const body = await res.json();
  if (body.status === 'failed') throw new Error(body.error ?? 'Generation failed');
  return body;
}

// ── Mapping helpers ────────────────────────────────────────────────────────

export function lifestyleBrandInfo(brand, data) {
  return {
    brand_name: brand.brandName || null,
    brand_description: brand.brandDescription || null,
    brand_logo: brand.brandLogoUrl || null,
    brand_voice: data.brandInfo.brandVoice ?? [],
    tone_of_voice: data.brandInfo.brandGuidelines?.toneOfVoice || null,
    color_palette: brand.brandColors ?? [],
    dos: data.brandInfo.brandGuidelines?.dos ?? [],
    donts: data.brandInfo.brandGuidelines?.donts ?? [],
  };
}

export const LIFESTYLE_OBJECTIVES = {
  core_idea: null,
  target_audience: [],
  call_to_action: null,
  additional_guidelines: null,
};

export function buildLifestylePayload({ brandInfo, data, adSetup, promotionalInfo }) {
  const objectives = promotionalInfo?.trim()
    ? { ...LIFESTYLE_OBJECTIVES, additional_guidelines: promotionalInfo.trim() }
    : LIFESTYLE_OBJECTIVES;

  return {
    product_description: adSetup.productDescription,
    scenario: adSetup.modelDescription,
    location: null,
    time_of_day: null,
    model: {
      age_range: null,
      gender: 'any',
      ethnicity: null,
      mood: null,
      wardrobe: null,
    },
    product_images: brandInfo.brandImages ?? [],
    model_reference_images: [],
    brand_info: lifestyleBrandInfo(brandInfo, data),
    objectives,
    aspect_ratio: adSetup.aspectRatio,
    variations: adSetup.variations,
    user_id: getUserId(),
    auth_token: getAuthToken(),
    upload_to_s3: true,
  };
}
