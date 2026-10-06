import { createSlice } from '@reduxjs/toolkit';
import { fetchStudioTemplates, studioTemplatesKey } from '@/store/actions/adStudio/studioTemplatesActions';

// byKey['<brandId>:<image|video>:<contextSig>'] = {
//   status: 'loading' | 'ok' | 'error',       — the first page / a refresh
//   items: [{ template_id, kind, url, tags, rank }],
//   fetchedAt: number (ms),                    — of the first page (drives the 10-min TTL)
//   error: { code, message } | null,
//   hasMore: boolean, nextSkip: number|null,   — infinite scroll (image + video)
//   loadingMore: boolean, loadMoreError: { code, message } | null,
// }
// Entries are keyed so a slow response for a brand the user already switched
// away from lands in its own slot and never overwrites the current brand's list.
//
// Paging (meta.arg.skip > 0) only ever APPENDS and never touches `status`, so a
// failed next page leaves the grid as it is and just offers a retry.
const initialState = { byKey: {} };

const keyOf = (meta) => studioTemplatesKey(meta.arg.brandId, meta.arg.media, meta.arg.contextSig);
const isNextPage = (meta) => (meta.arg.skip || 0) > 0;

const studioTemplatesSlice = createSlice({
  name: 'studioTemplates',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchStudioTemplates.pending, (state, { meta }) => {
        const key = keyOf(meta);
        const prev = state.byKey[key];
        if (isNextPage(meta)) {
          if (prev) Object.assign(prev, { loadingMore: true, loadMoreError: null });
          return;
        }
        // Keep the previous list during a refresh so the grid doesn't blank out.
        state.byKey[key] = {
          status: 'loading',
          items: prev?.items || [],
          fetchedAt: prev?.fetchedAt || 0,
          error: null,
          hasMore: prev?.hasMore || false,
          nextSkip: prev?.nextSkip ?? null,
          loadingMore: false,
          loadMoreError: null,
        };
      })
      .addCase(fetchStudioTemplates.fulfilled, (state, { meta, payload }) => {
        const key = keyOf(meta);
        if (isNextPage(meta)) {
          const prev = state.byKey[key];
          if (!prev) return;
          // DS pages are disjoint, but a repeat must never draw a card twice.
          const seen = new Set(prev.items.map((t) => t.template_id));
          prev.items.push(...payload.items.filter((t) => !seen.has(t.template_id)));
          Object.assign(prev, { hasMore: payload.hasMore, nextSkip: payload.nextSkip, loadingMore: false });
          return;
        }
        state.byKey[key] = {
          status: 'ok',
          items: payload.items,
          fetchedAt: payload.fetchedAt,
          error: null,
          hasMore: payload.hasMore,
          nextSkip: payload.nextSkip,
          loadingMore: false,
          loadMoreError: null,
        };
      })
      .addCase(fetchStudioTemplates.rejected, (state, { meta, payload, error }) => {
        const key = keyOf(meta);
        const prev = state.byKey[key];
        const failure = payload || { code: 'NETWORK', message: error?.message || 'Failed to load templates' };
        if (isNextPage(meta)) {
          if (prev) Object.assign(prev, { loadingMore: false, loadMoreError: failure });
          return;
        }
        state.byKey[key] = {
          status: 'error',
          items: prev?.items || [],
          fetchedAt: prev?.fetchedAt || 0,
          error: failure,
          hasMore: prev?.hasMore || false,
          nextSkip: prev?.nextSkip ?? null,
          loadingMore: false,
          loadMoreError: null,
        };
      });
  },
});

export default studioTemplatesSlice.reducer;
