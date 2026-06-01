import { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { fetchModelCredits } from '@/store/actions/modelCredits/modelCreditsActions';
import { selectImageCreditsByLabel } from '@/store/reducers/modelCredits/modelCreditsSlice';

// ----------------------------------------------------------------------------
// useImageCreditsForModel — single-entry-point for "how many credits does
// one image cost for this model?" Consumes the shared modelCredits Redux
// cache and lazily fetches it on first mount (cache-aware, so multiple
// callers cost a single network call per session).
//
// Pass the model's *display label* (e.g. 'Nano Banana Pro', 'Imagen') — the
// same string the API returns. Consumers that store provider keys instead
// (e.g. AdFactory Automation's 'google' / 'openai') must map value → label
// themselves before calling this hook.
//
// Falls back to FALLBACK_CREDITS_PER_IMAGE while the API is loading or if
// it fails, so the UI always renders a sensible cost.
// ----------------------------------------------------------------------------

export const FALLBACK_CREDITS_PER_IMAGE = 7;

export function useImageCreditsForModel(modelLabel) {
  const dispatch = useDispatch();
  const byLabel = useSelector(selectImageCreditsByLabel);

  // Trigger the fetch on first consumer mount. The thunk no-ops if the
  // slice already holds a successful snapshot, so cost is one network call
  // per session no matter how many components mount this hook.
  useEffect(() => {
    dispatch(fetchModelCredits());
  }, [dispatch]);

  const credits = modelLabel ? byLabel?.[modelLabel] : null;
  return credits || FALLBACK_CREDITS_PER_IMAGE;
}
