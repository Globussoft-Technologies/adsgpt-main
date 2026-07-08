// Silent background save: persist an autofill result into the user's BrandIQ
// list without any UI feedback. Used by every "Attach your Brand Voice" surface
// (AI Creatives Custom, Lifestyle/Apps-SaaS/Brand-Awareness/Product-Shot,
// Recreate). Errors — including duplicate-brand 409s — are intentionally
// swallowed; the autofill UX must never appear to "fail" because of this side
// effect.

import axios from 'axios';
import getCookies from '@/utils/getCookies';
import store from '@/store/store';
import { urlToBase64 } from '@/utils/MyBrand/FileHandle';
import { fetchBrands } from '@/store/actions/brandIQ/myBrandActions';

const BACKEND_HOST = import.meta.env.VITE_SOCKET_URL;
// Matches the BrandIQ form's per-section cap (see AddNewBrand.jsx rulesConfig).
const MAX_PER_SECTION = 5;

async function urlsToBase64(urls) {
  if (!Array.isArray(urls) || urls.length === 0) return [];
  const settled = await Promise.allSettled(
    urls.filter(Boolean).slice(0, MAX_PER_SECTION).map((u) => urlToBase64(u))
  );
  return settled
    .filter((s) => s.status === 'fulfilled' && s.value)
    .map((s) => s.value);
}

export async function silentSaveBrandFromAutofill({
  userId,
  userName,
  websiteUrl,
  autofillData,
}) {
  try {
    const bi = autofillData?.brandInfo || {};
    const obj = autofillData?.objectives || {};

    const logoUrls = Array.isArray(bi.brandLogo)
      ? bi.brandLogo
      : bi.brandLogo
        ? [bi.brandLogo]
        : [];

    const [logoBase64s, imageBase64] = await Promise.all([
      urlsToBase64(logoUrls),
      urlsToBase64(bi.brandImages),
    ]);

    // BE rejects brands without a name or any logo, so don't bother calling.
    if (!bi.brandName || logoBase64s.length === 0) return;

    await axios.post(
      `${BACKEND_HOST}/adsgpt/brand/create-lists`,
      {
        userId,
        userName: userName || '',
        brandName: bi.brandName,
        brandDescription: bi.brandDescription || '',
        logoBase64s,
        iconBase64: '',
        imageBase64,
        websiteUrl: websiteUrl || '',
        instagramUrl: '',
        facebookUrl: '',
        linkedinUrl: '',
        region: '',
        targetAudiences: Array.isArray(obj.targetAudience) ? obj.targetAudience : [],
        // DS's industry category (one of the 45). BE validates it; anything
        // not in the list is ignored and the brand is lazy-classified instead.
        category: bi.category || '',
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getCookies()}`,
        },
      }
    );

    // Refresh the cached brand list so the new brand appears in the BrandIQ
    // dropdown without requiring a page reload.
    if (userId) store.dispatch(fetchBrands(userId));
  } catch {
    // Silent by design.
  }
}
