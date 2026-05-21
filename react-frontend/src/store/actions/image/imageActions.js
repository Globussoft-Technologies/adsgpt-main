// Redux thunks for the Image Generation feature.
//
// Three public actions:
//   - generateImageAction(body)   submit + start polling
//   - pollImageAction(sessionId)  recursive setTimeout poll until done
//   - fetchImageHistoryAction()   paginated history loader

import { generateImage, getAllImages, getImageById } from '@/apis/image/imageApi';
import {
  submitStarted,
  submitSucceeded,
  submitFailed,
  pollUpdated,
  historyLoadStarted,
  historyLoadSucceeded,
  historyLoadFailed,
} from '@/store/reducers/image/imageSlice';

const POLL_INTERVAL_MS = 3000;

// The backend wraps every response as { success, message, data: {...record} }.
// This helper unwraps that and pulls the fields the slice cares about into a
// flat shape, regardless of which keys the backend ends up using for IDs/URLs.
function normalizeImageRecord(raw) {
  const record = raw?.data && typeof raw.data === 'object' && !Array.isArray(raw.data)
    ? raw.data
    : raw ?? {};
  const results = Array.isArray(record.results) ? record.results : [];
  const firstResult = results[0] || null;
  const url =
  firstResult?.generatedImageUrl ??  // Add this first
  firstResult?.url ?? 
  firstResult?.s3Url ?? 
  firstResult?.imageUrl ?? 
  firstResult?.s3_url ?? 
  null;
  // const url =
  //   firstResult?.url ?? firstResult?.s3Url ?? firstResult?.imageUrl ?? firstResult?.s3_url ?? null;
  return {
    sessionId: record._id ?? record.sessionId ?? record.imageId ?? record.id ?? null,
    status: record.status ?? null, // 'pending' | 'completed' | 'failed' | etc.
    url,
    results,
    error: record.error ?? record.errorMessage ?? null,
  };
}

// ── submit + auto-poll ──────────────────────────────────────────────────
//
// `body` is the full request body produced by buildImageInputs(). On success
// we read the sessionId out of the response (the backend may name it
// `sessionId`, `imageId`, or `id` — check all three) and kick off polling.
export const generateImageAction = (body) => async (dispatch) => {
  dispatch(submitStarted(body?.type ?? null));
  try {
    const data = await generateImage(body);
    const normalized = normalizeImageRecord(data);
    if (!normalized.sessionId) {
      throw new Error('Backend did not return a sessionId');
    }
    dispatch(submitSucceeded(normalized.sessionId));
    // If the backend already came back completed (sync mode), no polling needed.
    if (normalized.status === 'completed' || normalized.status === 'failed') {
      dispatch(pollUpdated(normalized));
    } else {
      // TODO: replace with a socket listener once the backend emits a completion event.
      dispatch(pollImageAction(normalized.sessionId));
    }
    return data;
  } catch (err) {
    // Backend can use either `error` (current image-generate contract) or
    // `message`. Prefer the backend's copy over the axios fallback so users
    // see "brandInfo.brandName is not allowed to be empty" instead of
    // "Request failed with status code 400".
    const msg =
      err.response?.data?.error ||
      err.response?.data?.message ||
      err.message ||
      'Generation failed';
    dispatch(submitFailed(msg));
    throw err;
  }
};

// ── recursive polling ───────────────────────────────────────────────────
//
// Self-cancelling: each tick checks that the session it was started for is
// still the active one. If the user navigated away (resetCurrent dispatched)
// or another tick already finished it, we exit and never schedule the next.
export const pollImageAction = (sessionId) => async (dispatch, getState) => {
  const tick = async () => {
    const cur = getState().image.current;
    if (cur.sessionId !== sessionId || cur.status !== 'pending') return;
    try {
      const raw = await getImageById(sessionId);
      dispatch(pollUpdated(normalizeImageRecord(raw)));
      const after = getState().image.current;
      if (after.status === 'pending') {
        setTimeout(tick, POLL_INTERVAL_MS);
      }
    } catch (err) {
      // Treat polling errors as a generation failure so the UI can recover.
      dispatch(pollUpdated({ status: 'failed', error: err.message }));
    }
  };
  tick();
};

// ── history list ────────────────────────────────────────────────────────
//
// `replace=true`  → fresh load (e.g. first mount or filter change)
// `replace=false` → "load more" (append next page)
export const fetchImageHistoryAction =
  (filters = {}, replace = true) =>
  async (dispatch, getState) => {
    dispatch(historyLoadStarted());
    try {
      const skip = replace ? 0 : getState().image.history.skip;
      const limit = filters.limit ?? 20;
      const data = await getAllImages({ ...filters, skip, limit });
      // Backend wraps responses as { success, message, data: [...] | { items: [...] } }.
      const payload = data?.data ?? data;
      const items = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.items)
          ? payload.items
          : [];
      dispatch(
        historyLoadSucceeded({
          items,
          skip: skip + items.length,
          hasMore: items.length === limit,
          replace,
        }),
      );
      return items;
    } catch (err) {
      const msg = err.response?.data?.message || err.message || 'Failed to load history';
      dispatch(historyLoadFailed(msg));
      return [];
    }
  };
