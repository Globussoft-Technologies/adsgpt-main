import { useEffect, useMemo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { fetchAdCreativeConfig } from '@/store/actions/adCreativeConfig/adCreativeConfigActions';
import {
  selectAdCreativeModels,
  selectAdCreativeConfigStatus,
} from '@/store/reducers/adCreativeConfig/adCreativeConfigSlice';
import { FALLBACK_AD_CREATIVE_MODELS } from '@/utils/adCreativeConfigFallback';

// ----------------------------------------------------------------------------
// useAdCreativeConfig — single entry point for the AdCreative model config
// (models + aspectRatios + qualities + per-quality credits) served by the
// `ad_creative` image surface.
//
// Consumes the shared adCreativeConfig Redux cache and lazily fetches it on
// first mount (cache-aware, so multiple callers cost one network call per
// session). Falls back to FALLBACK_AD_CREATIVE_MODELS while loading or on
// error, so pickers always render.
//
// Returned model shape:
//   { apiId, label, icon, aspectRatios[], qualities[], creditsByQuality{}, creditsPerImage }
// ----------------------------------------------------------------------------

export function useAdCreativeConfig() {
  const dispatch = useDispatch();
  const models = useSelector(selectAdCreativeModels);
  const status = useSelector(selectAdCreativeConfigStatus);

  useEffect(() => {
    dispatch(fetchAdCreativeConfig());
  }, [dispatch]);

  const resolved = status === 'ok' && models?.length ? models : FALLBACK_AD_CREATIVE_MODELS;
  const isFallback = resolved === FALLBACK_AD_CREATIVE_MODELS;

  // The surface (and fallback) come cheapest-first; the pickers show
  // most-expensive first. Memoised so the array identity stays stable and
  // doesn't retrigger the consumers' reconcile effects every render.
  const ordered = useMemo(() => [...resolved].reverse(), [resolved]);

  return { models: ordered, status, isFallback };
}
