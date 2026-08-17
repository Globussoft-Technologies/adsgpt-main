import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';

import {
  createBrief,
  createBriefFromBrand,
  getBrief,
  listBriefs,
  deleteBrief,
  updateBrief,
  generateFromBrief,
  activateBrief,
  getBriefTimeline,
  pauseJob,
  resumeJob,
} from '@/apis/adFactory/briefApi';

// ----------------------------------------------------------------------------
// One slice for the whole Quick setup flow, replacing the three that mirrored
// v1's modal state (`adFactory`, `adFactoryNew`, `adFactoryAutomation`).
//
// The screen you are on is DERIVED from the brief's own status, never stored.
// Two sources of truth for "where am I" is exactly how a wizard drifts out of
// step with its own data — you end up on the preview screen for a brief that
// failed, or back at the front door holding a live automation.
// ----------------------------------------------------------------------------

export const BRIEF_STATUS = {
  INFERRING: 'inferring',
  NEEDS_INPUT: 'needs_input',
  FAILED: 'failed',
  DRAFT: 'draft',
  PREVIEWING: 'previewing',
  LIVE: 'live',
  PAUSED: 'paused',
  ENDED: 'ended',
};

export const STEP = {
  SOURCE: 'source', // nothing started
  INFERRING: 'inferring', // reading the page, collecting budget
  FAILED: 'failed', // couldn't read it — offer a way out
  BRIEF: 'brief', // the working screen: summary + creatives
  DELIVERIES: 'deliveries', // live automation — deliveries are the page
};

const message = (err, fallback) =>
  err?.response?.data?.error || err?.message || fallback;

// ─── Thunks ──────────────────────────────────────────────────────────────────

export const startBriefFromUrl = createAsyncThunk(
  'adFactoryBrief/startFromUrl',
  async ({ url, forceRefresh = false }, { rejectWithValue }) => {
    try {
      return await createBrief({ url, forceRefresh });
    } catch (err) {
      return rejectWithValue(message(err, "We couldn't start reading that page."));
    }
  },
);

export const startBriefFromBrand = createAsyncThunk(
  'adFactoryBrief/startFromBrand',
  async (brandId, { rejectWithValue }) => {
    try {
      return await createBriefFromBrand(brandId);
    } catch (err) {
      return rejectWithValue(message(err, "We couldn't start from that brand."));
    }
  },
);

export const fetchBrief = createAsyncThunk(
  'adFactoryBrief/fetch',
  async (briefId, { rejectWithValue }) => {
    try {
      return await getBrief(briefId);
    } catch (err) {
      return rejectWithValue(message(err, "We couldn't load that brief."));
    }
  },
);

export const fetchBriefs = createAsyncThunk(
  'adFactoryBrief/list',
  async (_, { rejectWithValue }) => {
    try {
      return await listBriefs();
    } catch (err) {
      return rejectWithValue(message(err, "We couldn't load your briefs."));
    }
  },
);

export const removeBrief = createAsyncThunk(
  'adFactoryBrief/remove',
  async (briefId, { rejectWithValue }) => {
    try {
      await deleteBrief(briefId);
      return briefId;
    } catch (err) {
      // A brief with a live automation refuses deletion (409). That is a
      // instruction, not a failure — surface the server's own wording.
      return rejectWithValue({
        message: message(err, "We couldn't delete that brief."),
        code: err?.response?.data?.code || null,
      });
    }
  },
);

export const saveBriefEdits = createAsyncThunk(
  'adFactoryBrief/save',
  async ({ briefId, patch }, { rejectWithValue }) => {
    try {
      return await updateBrief(briefId, patch);
    } catch (err) {
      return rejectWithValue(message(err, "That change didn't save."));
    }
  },
);

export const generateAds = createAsyncThunk(
  'adFactoryBrief/generate',
  async (briefId, { rejectWithValue }) => {
    try {
      return await generateFromBrief(briefId);
    } catch (err) {
      // NO_BASE_PLAN is an upgrade prompt, not a failure — the UI needs the
      // code to tell the two apart. This is the trial user's first real moment.
      return rejectWithValue({
        message: message(err, "We couldn't start generating."),
        code: err?.response?.data?.code || null,
      });
    }
  },
);

export const activateAutomation = createAsyncThunk(
  'adFactoryBrief/activate',
  async ({ briefId, connection }, { rejectWithValue }) => {
    try {
      return await activateBrief(briefId, connection);
    } catch (err) {
      return rejectWithValue({
        message: message(err, "We couldn't start deliveries."),
        code: err?.response?.data?.code || null,
        field: err?.response?.data?.field || null,
      });
    }
  },
);

// Pause / resume act on the JOB, and the brief mirrors the result. Both refetch
// the timeline afterwards rather than patching status locally — the orchestrator
// also clears nextRunAt on pause, and guessing that client-side would show a
// next run for a job that has none.
export const setAutomationPaused = createAsyncThunk(
  'adFactoryBrief/setPaused',
  async ({ jobId, paused }, { rejectWithValue }) => {
    try {
      return paused ? await pauseJob(jobId) : await resumeJob(jobId);
    } catch (err) {
      return rejectWithValue(
        message(err, paused ? "We couldn't pause deliveries." : "We couldn't resume deliveries."),
      );
    }
  },
);

export const fetchTimeline = createAsyncThunk(
  'adFactoryBrief/timeline',
  async (briefId, { rejectWithValue }) => {
    try {
      return await getBriefTimeline(briefId);
    } catch (err) {
      return rejectWithValue(message(err, "We couldn't load your deliveries."));
    }
  },
);

// ─── Slice ───────────────────────────────────────────────────────────────────

const initialState = {
  brief: null,
  briefId: null,
  // What came back from the last generation run, served with the brief.
  run: { status: 'idle', pairs: [], pending: 0, failed: 0, requested: 0 },
  // What one run costs, priced server-side the same way the freeze is. Null
  // when unpriceable — the UI shows nothing rather than a misleading zero.
  estimate: null,
  // Previous generation batches, summarised server-side from CampaignHistory.
  history: [],
  timeline: { summary: null, rows: [], loading: false },
  // History. Loaded on the front door so a brief is reachable without its URL.
  briefs: [],
  briefsLoading: false,

  loading: false,
  saving: false,
  generating: false,
  activating: false,
  pausing: false,

  error: null,
  // Set when the failure has a code the UI acts on (NO_BASE_PLAN → upgrade).
  errorCode: null,

  // Client-side only: the budget typed on the wait screen, before a brief
  // exists to persist it onto.
  pendingBudget: '',
  inferStartedAt: null,
  // The socket event carries only a status, so a full read follows it.
  needsRefetch: false,

  // Which UI this session is using. Full control is the default for everyone —
  // nobody is moved into a different mode without asking for it.
  uiMode: 'full',
};

const adFactoryBriefSlice = createSlice({
  name: 'adFactoryBrief',
  initialState,
  reducers: {
    resetBrief: (state) => ({ ...initialState, uiMode: state.uiMode }),
    setUiMode: (state, { payload }) => {
      state.uiMode = payload?.uiMode === 'quick' ? 'quick' : 'full';
    },
    setPendingBudget: (state, { payload }) => {
      state.pendingBudget = payload;
    },
    clearBriefError: (state) => {
      state.error = null;
      state.errorCode = null;
    },
    clearNeedsRefetch: (state) => {
      state.needsRefetch = false;
    },
    // Optimistic local edit so a chip doesn't wait a round trip to look
    // changed. The PATCH that follows is the source of truth.
    applyLocalEdit: (state, { payload }) => {
      const { section, field, value } = payload || {};
      if (!state.brief || !section || !field) return;
      state.brief[section] = { ...(state.brief[section] || {}), [field]: value };
    },
    // `adFactoryBriefReady` — inference finished. Carries a status only.
    briefReady: (state, { payload }) => {
      if (!payload?.briefId || payload.briefId !== state.briefId) return;
      if (state.brief) {
        state.brief.status = payload.status;
        state.brief.failureReason = payload.failureReason || '';
      }
      state.needsRefetch = true;
    },
  },
  extraReducers: (builder) => {
    const started = (state) => {
      state.loading = true;
      state.error = null;
      state.errorCode = null;
    };
    const failed = (state, { payload }) => {
      state.loading = false;
      state.error = typeof payload === 'string' ? payload : payload?.message || 'Something went wrong.';
      state.errorCode = typeof payload === 'object' ? payload?.code || null : null;
    };

    const receiveNewBrief = (state, { payload }) => {
      state.loading = false;
      const brief = payload?.data;
      if (!brief) return;
      state.brief = brief;
      state.briefId = brief._id;
      state.run = brief.run || initialState.run;
      state.inferStartedAt = brief.status === BRIEF_STATUS.INFERRING ? Date.now() : null;
      // A reused brief may already be finished — pull the full document rather
      // than sitting on the wait screen for something that already landed.
      state.needsRefetch = brief.status !== BRIEF_STATUS.INFERRING;
    };

    builder
      .addCase(startBriefFromUrl.pending, started)
      .addCase(startBriefFromUrl.fulfilled, receiveNewBrief)
      .addCase(startBriefFromUrl.rejected, failed)

      .addCase(startBriefFromBrand.pending, started)
      .addCase(startBriefFromBrand.fulfilled, receiveNewBrief)
      .addCase(startBriefFromBrand.rejected, failed)

      .addCase(fetchBrief.pending, (state) => {
        state.error = null;
        // Deliberately not `loading`: the poll runs every few seconds behind
        // the wait screen, and flipping a global spinner on each tick makes a
        // settled screen flicker.
      })
      .addCase(fetchBrief.fulfilled, (state, { payload }) => {
        state.loading = false;
        const brief = payload?.data;
        if (!brief) return;
        state.brief = brief;
        state.briefId = brief._id;
        state.run = brief.run || initialState.run;
        state.estimate = brief.estimate ?? null;
        state.history = brief.history || [];
        if (brief.status === BRIEF_STATUS.INFERRING && !state.inferStartedAt) {
          state.inferStartedAt = Date.now();
        }
        // Generation is finished the moment the campaign says so.
        if (brief.run && brief.run.status !== 'running') state.generating = false;
      })
      .addCase(fetchBrief.rejected, failed)

      .addCase(fetchBriefs.pending, (state) => {
        state.briefsLoading = true;
      })
      .addCase(fetchBriefs.fulfilled, (state, { payload }) => {
        state.briefsLoading = false;
        state.briefs = payload?.data || [];
      })
      .addCase(fetchBriefs.rejected, (state) => {
        state.briefsLoading = false;
      })

      .addCase(removeBrief.fulfilled, (state, { payload }) => {
        state.briefs = state.briefs.filter((b) => b._id !== payload);
      })
      .addCase(removeBrief.rejected, (state, { payload }) => {
        state.error = payload?.message || "We couldn't delete that brief.";
        state.errorCode = payload?.code || null;
      })

      .addCase(saveBriefEdits.pending, (state) => {
        state.saving = true;
      })
      .addCase(saveBriefEdits.fulfilled, (state, { payload }) => {
        state.saving = false;
        // Keep the locally-edited brief; only refresh server-owned fields, or
        // an in-flight edit to another chip gets clobbered by the response.
        if (payload?.data && state.brief) {
          state.brief.provenance = payload.data.provenance;
          state.brief.status = payload.data.status;
        }
      })
      .addCase(saveBriefEdits.rejected, (state, { payload }) => {
        state.saving = false;
        state.error = typeof payload === 'string' ? payload : payload?.message;
      })

      .addCase(generateAds.pending, (state) => {
        state.generating = true;
        state.error = null;
        state.errorCode = null;
        // Show the run as started immediately. Pressing a button and seeing
        // nothing change for two minutes is the worst possible answer.
        state.run = { ...state.run, status: 'running' };
      })
      .addCase(generateAds.fulfilled, (state) => {
        state.run = { ...state.run, status: 'running' };
      })
      .addCase(generateAds.rejected, (state, { payload }) => {
        state.generating = false;
        state.run = { ...state.run, status: 'idle' };
        state.error = payload?.message || 'Generation could not be started.';
        state.errorCode = payload?.code || null;
      })

      .addCase(activateAutomation.pending, (state) => {
        state.activating = true;
        state.error = null;
        state.errorCode = null;
      })
      .addCase(activateAutomation.fulfilled, (state, { payload }) => {
        state.activating = false;
        if (state.brief) {
          state.brief.status = BRIEF_STATUS.LIVE;
          state.brief.jobId = payload?.data?._id || state.brief.jobId;
        }
      })
      .addCase(activateAutomation.rejected, (state, { payload }) => {
        state.activating = false;
        state.error = payload?.message || "We couldn't start deliveries.";
        state.errorCode = payload?.code || null;
      })

      .addCase(setAutomationPaused.pending, (state) => {
        state.pausing = true;
        state.error = null;
      })
      .addCase(setAutomationPaused.fulfilled, (state, { payload, meta }) => {
        state.pausing = false;
        const status = payload?.data?.status;
        if (state.brief) state.brief.status = meta.arg.paused ? 'paused' : 'live';
        if (state.timeline?.summary && status) state.timeline.summary.status = status;
      })
      .addCase(setAutomationPaused.rejected, (state, { payload }) => {
        state.pausing = false;
        state.error = typeof payload === 'string' ? payload : payload?.message;
      })

      .addCase(fetchTimeline.pending, (state) => {
        state.timeline.loading = true;
      })
      .addCase(fetchTimeline.fulfilled, (state, { payload }) => {
        state.timeline = { ...(payload?.data || { summary: null, rows: [] }), loading: false };
      })
      .addCase(fetchTimeline.rejected, (state) => {
        state.timeline.loading = false;
      });
  },
});

export const {
  resetBrief,
  setUiMode,
  setPendingBudget,
  clearBriefError,
  clearNeedsRefetch,
  applyLocalEdit,
  briefReady,
} = adFactoryBriefSlice.actions;

// ─── Selectors ───────────────────────────────────────────────────────────────

export const selectBrief = (s) => s.adFactoryBrief.brief;
export const selectBriefId = (s) => s.adFactoryBrief.briefId;
export const selectRun = (s) => s.adFactoryBrief.run;
export const selectEstimate = (s) => s.adFactoryBrief.estimate;
export const selectHistory = (s) => s.adFactoryBrief.history;
export const selectTimeline = (s) => s.adFactoryBrief.timeline;
export const selectBriefs = (s) => s.adFactoryBrief.briefs;
export const selectBriefsLoading = (s) => s.adFactoryBrief.briefsLoading;
export const selectIsPausing = (s) => s.adFactoryBrief.pausing;
export const selectBriefError = (s) => s.adFactoryBrief.error;
export const selectBriefErrorCode = (s) => s.adFactoryBrief.errorCode;
export const selectPendingBudget = (s) => s.adFactoryBrief.pendingBudget;
export const selectInferStartedAt = (s) => s.adFactoryBrief.inferStartedAt;
export const selectNeedsRefetch = (s) => s.adFactoryBrief.needsRefetch;
export const selectUiMode = (s) => s.adFactoryBrief.uiMode;
export const selectIsInferring = (s) =>
  s.adFactoryBrief.brief?.status === BRIEF_STATUS.INFERRING;
export const selectIsGenerating = (s) =>
  s.adFactoryBrief.generating || s.adFactoryBrief.run?.status === 'running';

/**
 * The one place the current screen is decided.
 *
 * Derived, never stored — see the note at the top. Order matters: a live brief
 * is on the deliveries screen whatever else is true of it.
 */
export const selectStep = (s) => {
  const brief = s.adFactoryBrief.brief;
  if (!brief) return STEP.SOURCE;
  if (brief.status === BRIEF_STATUS.INFERRING) return STEP.INFERRING;
  if (brief.status === BRIEF_STATUS.FAILED) return STEP.FAILED;
  if ([BRIEF_STATUS.LIVE, BRIEF_STATUS.PAUSED, BRIEF_STATUS.ENDED].includes(brief.status)) {
    return STEP.DELIVERIES;
  }
  return STEP.BRIEF;
};

export default adFactoryBriefSlice.reducer;
