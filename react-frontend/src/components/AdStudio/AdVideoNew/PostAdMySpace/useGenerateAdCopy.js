import { useState, useCallback } from 'react';
import { generateAdCopy } from '@/apis/metaAds/metaAdsApi';
import { globalToast } from '@/utils/globalToast';
import CTA_OPTIONS from './ctaOptions';

const CTA_FALLBACK = 'LEARN_MORE';

export default function useGenerateAdCopy() {
  const [loading, setLoading] = useState(false);

  const generate = useCallback(async (prompt, onSuccess) => {
    const trimmed = (prompt || '').trim();
    if (!trimmed) {
      globalToast.error('Enter a prompt to generate ad copy');
      return;
    }

    setLoading(true);
    try {
      const data = await generateAdCopy({ prompt: trimmed });
      const adCopy = data?.adCopy || {};
      // Trust the API. CTA_OPTIONS is just a hint — if a stale build
      // doesn't yet list a CTA the backend returns (e.g. backend added
      // CALL_NOW before we did), we still want the field populated.
      // Only fall back when the API returns nothing at all.
      const rawCta = (adCopy.call_to_action || '').toString().trim();
      const cta = rawCta || CTA_FALLBACK;
      if (rawCta && !CTA_OPTIONS.includes(cta)) {
        console.warn(
          `generate-ad-copy returned CTA "${cta}" not in CTA_OPTIONS — passing through anyway`,
        );
      }
      onSuccess?.({
        primaryText: adCopy.primary_text || '',
        headline: adCopy.headline || '',
        description: adCopy.description || '',
        callToAction: cta,
      });
    } catch (err) {
      const msg = err?.response?.data?.message || 'Could not generate ad copy';
      globalToast.error(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  return { generate, loading };
}
