import { createAsyncThunk } from '@reduxjs/toolkit';
import { getStudioTemplates } from '@/apis/adStudio/studioTemplatesApi';

// ----------------------------------------------------------------------------
// Brand-matched templates for the Ad Creative (image) and Ad Video (video)
// home galleries. Cached per `brandId:media` for 10 minutes, matching the
// server cache, so switching brands back and forth is instant. `refresh`
// (the ↻ button) skips both caches.
// ----------------------------------------------------------------------------

export const STUDIO_TEMPLATES_TTL_MS = 10 * 60 * 1000;

// `contextSig` changes when the brand's description or images are edited, so an
// edited brand misses the cache instead of showing templates for its old text.
export const studioTemplatesKey = (brandId, media, contextSig = '') =>
  `${brandId}:${media}:${contextSig}`;

const GENERIC_ERROR = "Couldn't load templates right now. Please try again in a moment.";

export const fetchStudioTemplates = createAsyncThunk(
  'studioTemplates/fetch',
  // `skip` > 0 = the next page (infinite scroll, image or video); the slice appends it.
  async ({ brandId, media, refresh = false, skip = 0 }, { rejectWithValue }) => {
    try {
      const data = await getStudioTemplates({ brandId, media, refresh, skip });
      return {
        items: Array.isArray(data?.items) ? data.items : [],
        fetchedAt: Date.now(),
        hasMore: Boolean(data?.hasMore),
        nextSkip: Number.isFinite(data?.nextSkip) ? data.nextSkip : null,
      };
    } catch (err) {
      const body = err?.response?.data || {};
      return rejectWithValue({
        code: body.code || (err?.code === 'ECONNABORTED' ? 'UPSTREAM_TIMEOUT' : 'NETWORK'),
        message: body.user_message || GENERIC_ERROR,
      });
    }
  },
  {
    // Skip the request when this brand+media is already loading, or was loaded
    // successfully less than 10 minutes ago. A refresh always goes through
    // unless one is already running.
    condition: ({ brandId, media, contextSig, refresh = false, skip = 0 }, { getState }) => {
      if (!brandId || !media) return false;
      const entry = getState().studioTemplates?.byKey?.[studioTemplatesKey(brandId, media, contextSig)];
      // Next page: only from a loaded list that says there is more, only the
      // page right after what we hold, and never two at once.
      if (skip > 0) {
        return Boolean(
          entry && entry.status === 'ok' && entry.hasMore && !entry.loadingMore && entry.nextSkip === skip
        );
      }
      if (!entry) return true;
      if (entry.status === 'loading') return false;
      if (refresh) return true;
      return !(entry.status === 'ok' && Date.now() - entry.fetchedAt < STUDIO_TEMPLATES_TTL_MS);
    },
  }
);
