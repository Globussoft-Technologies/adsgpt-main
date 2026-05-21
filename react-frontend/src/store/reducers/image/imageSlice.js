// Redux state for the Image Generation feature.
//
// Two top-level keys, kept independent on purpose:
//   - current : the in-flight (or just-finished) generation
//   - history : paginated past generations from GET /image/all
//
// `current.status` is a state machine:
//   idle ─submit→ submitting ─POST 200→ pending ─poll 200→ completed
//                              └POST err→ failed                ▲
//                                                               │
//                                  pending ─poll non-200→ failed ┘

import { createSlice } from '@reduxjs/toolkit';

const S3_BASE_URL = import.meta.env.VITE_S3_BASE_URL || '';

// Resolve a single result-URL candidate against S3. Absolute URLs pass
// through; relative paths get the S3 base prepended.
function resolveOne(candidate) {
  if (!candidate) return null;
  if (/^https?:\/\//i.test(candidate)) return candidate;
  return `${S3_BASE_URL}${candidate.startsWith('/') ? '' : '/'}${candidate}`;
}

// Walk a record and populate `results[i].url` plus a top-level `url` so all
// downstream consumers (MyImagesPage, ImageCard, generation flow) can read
// the same shape regardless of whether the source was a socket payload, a
// poll response, or the GET /image/all history endpoint.
function withResolvedUrls(record) {
  if (!record || typeof record !== 'object') return record;
  const results = Array.isArray(record.results)
    ? record.results.map((r) => {
        const candidate =
          r?.generatedImageUrl ||
          r?.url ||
          r?.s3Url ||
          r?.imageUrl ||
          r?.s3_url ||
          null;
        const url = resolveOne(candidate);
        return url ? { ...r, url } : r;
      })
    : [];
  const topUrl = results[0]?.url || resolveOne(record.url) || null;
  return { ...record, results, url: topUrl };
}

const initialState = {
  current: {
    sessionId: null,
    type: null,                // 'ai_ads' | 'lifestyle' | 'product_shot' | 'apps_saas' | 'brand_awareness'
    status: 'idle',            // 'idle' | 'submitting' | 'pending' | 'completed' | 'failed'
    result: null,              // { url, results } once completed
    error: null,
  },
  history: {
    items: [],
    status: 'idle',            // 'idle' | 'loading' | 'loaded' | 'error'
    error: null,
    skip: 0,
    limit: 20,
    hasMore: true,
  },
  // Inputs stashed by MySpace > Images > Recreate. The matching form reads
  // this on mount, prefills, and clears it. Mirrors adVideoNew.recreateInputs.
  recreateInputs: null,
};

const imageSlice = createSlice({
  name: 'image',
  initialState,
  reducers: {
    // ── current generation lifecycle ─────────────────────────────────
    submitStarted: (s, a) => {
      // Reset everything before a new submit so leftovers from a prior
      // failed attempt don't leak into the UI.
      s.current = { ...initialState.current, status: 'submitting', type: a.payload };
    },
    submitSucceeded: (s, a) => {
      s.current.sessionId = a.payload;
      s.current.status = 'pending';
    },
    submitFailed: (s, a) => {
      s.current.status = 'failed';
      s.current.error = a.payload;
    },
    pollUpdated: (s, a) => {
      // Payload comes pre-normalized from the action layer:
      //   { status: 'pending'|'completed'|'failed', url, results, error }
      const { status, url, results, error } = a.payload || {};
      if (status === 'completed') {
        s.current.status = 'completed';
        s.current.result = { url, results };
      } else if (status === 'failed') {
        s.current.status = 'failed';
        s.current.error = error || 'Generation failed';
      }
      // 'pending' / unknown ⇒ leave state alone, polling will tick again.
    },
    resetCurrent: (s) => {
      s.current = initialState.current;
    },

    // Socket-driven update for `imageCreated` events. The payload mirrors
    // the videoCreated shape: { _id, image: { _doc, url, ... }, userId }.
    // We unwrap the inner record, normalise the URL with S3_BASE_URL, and
    //   1. mark `current` completed/failed if it was the in-flight session
    //   2. upsert the record into `history.items` so MySpace shows it live
    updateImage: (s, a) => {
      const payload = a.payload || {};
      const inner = payload.image?._doc || payload.image || payload;
      const id = inner?._id || payload?._id;
      if (!id) return;

      // Carry the socket's top-level `image.url` onto the record so the
      // resolver below sees it (poll responses already have it on results[0]).
      const baseRecord = { ...inner, url: payload?.image?.url ?? inner?.url };
      const normalized = withResolvedUrls(baseRecord);
      const url = normalized.url;
      const status = inner?.status || (url ? 'completed' : 'failed');

      // Reflect into `current` if this is the session the form is tracking.
      if (s.current.sessionId === id) {
        if (status === 'completed' && url) {
          s.current.status = 'completed';
          s.current.result = { url, results: normalized.results };
        } else if (status === 'failed') {
          s.current.status = 'failed';
          s.current.error = inner?.error || 'Generation failed';
        }
      }

      // Upsert into history so MySpace > Images surfaces the new record
      // without waiting for a full refetch.
      const next = { ...normalized, status };
      const idx = s.history.items.findIndex((it) => it?._id === id);
      if (idx !== -1) {
        s.history.items[idx] = { ...s.history.items[idx], ...next };
      } else {
        s.history.items.unshift(next);
      }
    },

    // ── history list ─────────────────────────────────────────────────
    historyLoadStarted: (s) => {
      s.history.status = 'loading';
    },
    historyLoadSucceeded: (s, a) => {
      const { items, skip, hasMore, replace } = a.payload;
      // Normalise every record so MyImagesPage/ImageCard can read
      // `results[0].url` regardless of whether the backend used
      // `generatedImageUrl` (the new contract) or `url` (legacy).
      const normalized = (items || []).map(withResolvedUrls);
      s.history.status = 'loaded';
      s.history.items = replace ? normalized : [...s.history.items, ...normalized];
      s.history.skip = skip;
      s.history.hasMore = hasMore;
    },
    historyLoadFailed: (s, a) => {
      s.history.status = 'error';
      s.history.error = a.payload;
    },

    // Recreate flow: stash the inputs object the user picked from MySpace.
    setImageRecreateInputs: (s, a) => {
      s.recreateInputs = a.payload;
    },
    clearImageRecreateInputs: (s) => {
      s.recreateInputs = null;
    },
  },
});

export const {
  submitStarted,
  submitSucceeded,
  submitFailed,
  pollUpdated,
  resetCurrent,
  updateImage,
  historyLoadStarted,
  historyLoadSucceeded,
  historyLoadFailed,
  setImageRecreateInputs,
  clearImageRecreateInputs,
} = imageSlice.actions;

export default imageSlice.reducer;
