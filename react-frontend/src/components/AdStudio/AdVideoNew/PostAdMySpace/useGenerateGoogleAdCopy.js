import { useState, useCallback } from 'react';
import { generateAdCopy } from '@/apis/metaAds/metaAdsApi';
import { globalToast } from '@/utils/globalToast';
import GOOGLE_CTA_OPTIONS from './googleCtaOptions';

// Reuses the existing /adsgpt/meta-ads/generate-ad-copy endpoint —
// no separate Google generator. The Meta endpoint returns a
// generic ad-copy object; we just map the fields into Google's
// form shape:
//   primary_text → ignored (Google has no equivalent slot)
//   headline     → headline (truncated to 30c on submit by maxLength)
//   description  → description (truncated to 90c on submit by maxLength)
//   call_to_action → callToAction, IF it's in GOOGLE_CTA_OPTIONS;
//                    otherwise empty (user picks manually)
//   long_headline → not returned; left empty for the user to fill
//
// `isVideo` is accepted for API symmetry but isn't sent — the Meta
// endpoint doesn't read it.
export default function useGenerateGoogleAdCopy() {
  const [loading, setLoading] = useState(false);

  const generate = useCallback(async ({ prompt }, onSuccess) => {
    const trimmed = (prompt || '').trim();
    if (!trimmed) {
      globalToast.error('Enter a prompt to generate ad copy');
      return;
    }
    setLoading(true);
    try {
      const data = await generateAdCopy({ prompt: trimmed });
      const adCopy = data?.adCopy || {};
      const rawCta = (adCopy.call_to_action || '').toString().trim();
      // Only accept CTAs Google supports — Meta's `SHOP_NOW` /
      // `SIGN_UP` etc. would be rejected by the Google Ads API.
      // Drop unknowns to empty (= "No CTA") so the user can pick
      // a valid one from the dropdown.
      const cta = GOOGLE_CTA_OPTIONS.includes(rawCta) ? rawCta : '';
      if (rawCta && !cta) {
        console.warn(
          `generate-ad-copy returned CTA "${rawCta}" — not in Google's enum, dropped`,
        );
      }
      onSuccess?.({
        headline: adCopy.headline || '',
        longHeadline: '', // Meta endpoint doesn't return it
        description: adCopy.description || '',
        callToAction: cta,
      });
    } catch (err) {
      const msg =
        err?.response?.data?.error ||
        err?.response?.data?.message ||
        err?.message ||
        'Could not generate ad copy';
      globalToast.error(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  return { generate, loading };
}
