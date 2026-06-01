import { createAsyncThunk } from '@reduxjs/toolkit';
import { fetchModelCredits as fetchModelCreditsRaw } from '@/utils/fetchModelCredits';

// ----------------------------------------------------------------------------
// Model credit configuration — shared cache.
//
// GET /adsgpt/usage/model-credit-value (via the existing utils/fetchModelCredits
// helper) returns:
//   { data: { imageModels: [{label, value: "7 CREDITS/IMAGE"}, ...],
//             videoModels: [{label, value: "3 CREDITS/SECOND"}, ...] } }
//
// `value` is a free-form string with a leading number — we parse the number
// out and build label→credits maps so consumers can look up cost by the
// model's display label. Duplicate labels in the response (a known backend
// quirk) collapse naturally via the object map.
//
// Cache-aware: the thunk no-ops when the slice already holds a successful
// snapshot, so any number of mount-time dispatches across the app cost
// exactly one network call per session.
// ----------------------------------------------------------------------------

const parseLeadingNumber = (raw) => {
  if (raw == null) return null;
  const match = String(raw).match(/^\s*([\d.]+)/);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : null;
};

const buildCreditsByLabel = (entries) => {
  if (!Array.isArray(entries)) return {};
  return entries.reduce((acc, entry) => {
    const credits = parseLeadingNumber(entry?.value);
    if (entry?.label && credits != null) acc[entry.label] = credits;
    return acc;
  }, {});
};

export const fetchModelCredits = createAsyncThunk(
  'modelCredits/fetch',
  async (_arg, { getState, rejectWithValue }) => {
    // Cache hit — skip the network and let the reducer no-op.
    if (getState().modelCredits?.status === 'ok') {
      return { cached: true };
    }

    try {
      const { imageModels, videoModels } = await fetchModelCreditsRaw();
      return {
        cached: false,
        imageModelsByLabel: buildCreditsByLabel(imageModels),
        videoModelsByLabel: buildCreditsByLabel(videoModels),
      };
    } catch (err) {
      return rejectWithValue({
        message: err?.message || 'Failed to load model credit configuration',
      });
    }
  }
);
