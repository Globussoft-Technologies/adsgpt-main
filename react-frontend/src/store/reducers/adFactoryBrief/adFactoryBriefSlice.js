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
  stopBrief,
  runBriefNow,
  publishBrief,
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

// Persist the chosen mode so a reload keeps the user where they were, the same
// way brandIQTabsSlice remembers its active tab. Wrapped because localStorage
// throws outright in private-mode Safari and with storage disabled — a browser
// setting must not take the page down.
const MODE_STORAGE_KEY = 'adFactoryUiMode';

const getPersistedMode = () => {
  try {
    // Anything other than the two known values falls back to Full control.
    // Nobody is placed into Quick setup by a stale or hand-edited key.
    return localStorage.getItem(MODE_STORAGE_KEY) === 'quick' ? 'quick' : 'full';
  } catch {
    return 'full';
  }
};

const persistMode = (mode) => {
  try {
    localStorage.setItem(MODE_STORAGE_KEY, mode);
  } catch {
    // Not being able to remember the choice is not worth an error; the mode
    // still applies for this session.
  }
};

const message = (err, fallback) =>
  err?.response?.data?.error || err?.message || fallback;

const patchBriefListStatus = (briefs, briefId, status) => {
  if (!Array.isArray(briefs) || !briefId || !status) return;
  const match = briefs.find((brief) => brief?._id === briefId);
  if (match) match.status = status;
};

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

// Stop is not a stronger pause — it archives the job and cancels the queue
// entry, and there is no un-stop. Restarting means activating again, which
// creates a new job. Past deliveries survive; the server keeps `runHistory`.
export const stopAutomation = createAsyncThunk(
  'adFactoryBrief/stop',
  async (briefId, { rejectWithValue }) => {
    try {
      return await stopBrief(briefId);
    } catch (err) {
      // 409 while a cycle is mid-run is the one the user can act on: wait for
      // it to finish. Relay the server's own wording rather than a generic
      // failure, because "try again in a few minutes" is the actual advice.
      return rejectWithValue(message(err, "We couldn't stop deliveries."));
    }
  },
);

// An extra cycle on demand. Deliberately NOT merged into `pausing`: this one
// spends credits and posts ads, so it gets its own busy flag and its own
// confirmation rather than sharing state with the lifecycle buttons.
export const runNow = createAsyncThunk(
  'adFactoryBrief/runNow',
  async (briefId, { rejectWithValue }) => {
    try {
      return await runBriefNow(briefId);
    } catch (err) {
      // Paused / completed / already-running all come back as advice the user
      // can act on, so the server's own wording is what gets shown.
      return rejectWithValue(message(err, "We couldn't start a run."));
    }
  },
);


// The MANUAL half of Ad Factory, which Quick setup shipped without. v1 has had
// two paths since day one — post these ads now, or keep making them — and v2
// only ever offered the second, so the user looking at three finished ads had
// to subscribe to a schedule to get any of them live.
//
// Separate from `activating` on purpose. Both spend, but they commit to
// completely different things: this posts N ads once and creates nothing,
// while activate creates a recurring job. Sharing a busy flag would let the
// UI show "starting deliveries…" over a one-off post.
export const publishNow = createAsyncThunk(
  'adFactoryBrief/publish',
  async ({ briefId, connection, mode, campaignId, adSetId }, { rejectWithValue }) => {
    try {
      return await publishBrief(briefId, { connection, mode, campaignId, adSetId });
    } catch (err) {
      // The server reports WHICH step failed (`step: 'campaign' | 'adset' |
      // 'ads'`) because a half-finished launch leaves real objects in the
      // user's ad account, and "it failed" is not enough to know what to clean
      // up. Carried through to the UI rather than flattened to a string.
      const body = err?.response?.data || {};
      return rejectWithValue({
        message: message(err, "We couldn't post your ads."),
        step: body.step || null,
        field: body.field || null,
        campaignId: body.campaignId || null,
        adSetId: body.adSetId || null,
      });
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
  // Whether the last edit reached the live job — see saveBriefEdits.fulfilled.
  // Null when there was nothing to sync, which is the usual case.
  jobSync: null,
  // History. Loaded on the front door so a brief is reachable without its URL.
  briefs: [],
  briefsLoading: false,

  loading: false,
  saving: false,
  generating: false,
  activating: false,
  pausing: false,
  runningNow: false,
  // A queued extra cycle. Cleared on the next timeline read, once the run it
  // refers to is actually visible there.
  runNowQueued: false,

  // The one-off post. `publishResult` holds what actually went live so the
  // screen can say so afterwards — a button that simply stops spinning gives
  // no evidence anything happened.
  publishing: false,
  publishResult: null,
  publishError: null,

  error: null,
  activationError: null,
  // Set when the failure has a code the UI acts on (NO_BASE_PLAN → upgrade).
  errorCode: null,

  // Client-side only: the budget typed on the wait screen, before a brief
  // exists to persist it onto.
  pendingBudget: '',
  inferStartedAt: null,
  // The socket event carries only a status, so a full read follows it.
  needsRefetch: false,

  // Which UI to render. Full control remains the default for anyone who has
  // never chosen — nobody is moved into a different mode without asking — but
  // once chosen, the choice survives a reload.
  uiMode: getPersistedMode(),
};

const adFactoryBriefSlice = createSlice({
  name: 'adFactoryBrief',
  initialState,
  reducers: {
    // Clears the brief being WORKED ON. `briefs` is the history list and is
    // deliberately carried over: it belongs to the front door, not to any one
    // brief, and wiping it emptied "Your briefs" on the way back.
    //
    // Refetching does not reliably cover for that. Both the reset and the
    // `fetchBriefs` dispatch are keyed on `urlBriefId` changing — so after a
    // pasted URL (which never put an id in the URL) Start over reset the list
    // without re-running the fetch, and the home page came back empty until a
    // reload.
    resetBrief: (state) => ({
      ...initialState,
      uiMode: state.uiMode,
      briefs: state.briefs,
      briefsLoading: state.briefsLoading,
    }),
    setUiMode: (state, { payload }) => {
      const next = payload?.uiMode === 'quick' ? 'quick' : 'full';
      state.uiMode = next;
      persistMode(next);
    },
    setPendingBudget: (state, { payload }) => {
      state.pendingBudget = payload;
    },
    clearBriefError: (state) => {
      state.error = null;
      state.errorCode = null;
      state.activationError = null;
    },
    clearNeedsRefetch: (state) => {
      state.needsRefetch = false;
    },
    // Closing the ship card forgets both the receipt and the failure. Keeping
    // either would mean reopening the card lands on a stale answer about a
    // post that already happened.
    clearPublishState: (state) => {
      state.publishResult = null;
      state.publishError = null;
    },
    // Optimistic local edit so a chip doesn't wait a round trip to look
    // changed. The PATCH that follows is the source of truth.
    applyLocalEdit: (state, { payload }) => {
      const { section, field, value } = payload || {};
      if (!state.brief || !field) return;
      // A root-level field (`alertEmails`) has no section. Without this branch
      // the edit was a silent no-op and the control showed stale values until a
      // refetch — removing a recipient would appear not to work.
      if (!section) {
        state.brief[field] = value;
        return;
      }
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

      // THE TWO FRONT DOORS RETURN DIFFERENT SHAPES, and this used to read only
      // one of them.
      //
      //   POST /briefs            202  data: { briefId, status, reused }
      //   POST /briefs/from-brand 201  data: <the whole brief document>
      //
      // The URL path returns 202 with just an id because inference runs
      // detached — so there IS no document to send yet. Reading `_id` left
      // `briefId` undefined for every pasted URL, and everything that moves the
      // user off the wait screen is guarded on it: the 3s poll
      // (`if (!inferring || !briefId) return`), the socket handler
      // (`payload.briefId !== state.briefId`), the needsRefetch effect, and the
      // ?briefId= URL sync. All four went silent, so the wait screen sat there
      // indefinitely while the brief had actually been ready for minutes.
      const id = brief._id || brief.briefId;
      state.briefId = id;
      // Normalised so nothing downstream has to know which door this came
      // through — the poll replaces this stub with the real document shortly.
      state.brief = brief._id ? brief : { ...brief, _id: id };
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
        // Switching briefs drops the in-flight budget keystrokes. The input
        // prefers `pendingBudget` over the saved value so it stays editable
        // after the first save; without this, opening a second brief would
        // show the first one's typed number over its own.
        if (state.briefId && String(state.briefId) !== String(brief._id)) {
          state.pendingBudget = '';
        }
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
        // Whether a cadence edit actually reached the running job.
        //
        // `null` for every edit that touches nothing the job owns, which is
        // almost all of them — the UI says nothing in that case. It is only
        // populated when the server TRIED, so `applied: false` means the
        // schedule on screen is not the schedule running, and the user has to
        // be told. Saying nothing here would rebuild the original bug in the
        // client.
        state.jobSync = payload?.jobSync || null;
        // The price follows the edit. "Ads per generate" is the number the
        // estimate is built from, so changing it changes the cost — but the
        // estimate only ever arrived with a full GET, so pressing + or - moved
        // the count and left the price frozen at its previous value.
        //
        // `undefined` means this response carried no estimate; `null` is a real
        // answer meaning "cannot be priced", so the two are not collapsed.
        if (payload?.estimate !== undefined) state.estimate = payload.estimate;
      })
      .addCase(saveBriefEdits.rejected, (state, { payload }) => {
        state.saving = false;
        state.error = typeof payload === 'string' ? payload : payload?.message;
      })

      .addCase(generateAds.pending, (state) => {
        state.generating = true;
        state.error = null;
        state.errorCode = null;
        // Clear the previous batch and show skeletons for the one being made.
        //
        // This used to keep `pairs` and only flip status, so a REGENERATE left
        // the old ads on screen with no loaders — nothing visibly happened
        // until the first poll came back, which reads as a dead button. The
        // first generate looked right only because there were no old ads to
        // leave behind. The previous batch is not lost: it moves into Earlier
        // runs the moment the snapshot is written.
        const want = Number(state.brief?.generation?.imageCount) || 3;
        state.run = { status: 'running', pairs: [], pending: want, failed: 0, requested: want };
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
        state.activationError = null;
      })
      .addCase(activateAutomation.fulfilled, (state, { payload }) => {
        state.activating = false;
        if (state.brief) {
          state.brief.status = BRIEF_STATUS.LIVE;
          state.brief.jobId = payload?.data?._id || state.brief.jobId;
          patchBriefListStatus(state.briefs, state.brief._id, BRIEF_STATUS.LIVE);
        }
      })
      .addCase(activateAutomation.rejected, (state, { payload }) => {
        state.activating = false;
        state.activationError = payload?.message || "We couldn't start deliveries.";
        state.errorCode = payload?.code || null;
      })

      .addCase(setAutomationPaused.pending, (state) => {
        state.pausing = true;
        state.error = null;
      })
      .addCase(setAutomationPaused.fulfilled, (state, { payload, meta }) => {
        state.pausing = false;
        const status = payload?.data?.status;
        if (state.brief) {
          state.brief.status = meta.arg.paused ? BRIEF_STATUS.PAUSED : BRIEF_STATUS.LIVE;
          patchBriefListStatus(state.briefs, state.brief._id, state.brief.status);
        }
        if (state.timeline?.summary && status) state.timeline.summary.status = status;
      })
      .addCase(setAutomationPaused.rejected, (state, { payload }) => {
        state.pausing = false;
        state.error = typeof payload === 'string' ? payload : payload?.message;
      })

      // Stop shares `pausing` with pause/resume on purpose: they are the same
      // three buttons in the same header, and one busy flag is what stops a
      // user firing Stop while a Pause is still in flight.
      .addCase(stopAutomation.pending, (state) => {
        state.pausing = true;
        state.error = null;
      })
      .addCase(stopAutomation.fulfilled, (state) => {
        state.pausing = false;
        if (state.brief) {
          state.brief.status = BRIEF_STATUS.ENDED;
          patchBriefListStatus(state.briefs, state.brief._id, BRIEF_STATUS.ENDED);
        }
        // The job is archived, not deleted — `selectStep` keeps `ended` on the
        // deliveries screen so the record of what already ran stays reachable.
        if (state.timeline?.summary) {
          state.timeline.summary.status = 'archived';
          state.timeline.summary.nextRunAt = null;
        }
      })
      .addCase(stopAutomation.rejected, (state, { payload }) => {
        state.pausing = false;
        state.error = typeof payload === 'string' ? payload : payload?.message;
      })

      .addCase(runNow.pending, (state) => {
        state.runningNow = true;
        state.error = null;
        state.runNowQueued = false;
      })
      .addCase(runNow.fulfilled, (state) => {
        state.runningNow = false;
        // The cycle is queued, not finished. Nothing in the timeline changes
        // until the orchestrator picks it up, so the UI acknowledges the queue
        // rather than pretending ads exist.
        state.runNowQueued = true;
      })
      .addCase(runNow.rejected, (state, { payload }) => {
        state.runningNow = false;
        state.error = typeof payload === 'string' ? payload : payload?.message;
      })

      .addCase(publishNow.pending, (state) => {
        state.publishing = true;
        state.publishError = null;
        state.publishResult = null;
      })
      .addCase(publishNow.fulfilled, (state, { payload }) => {
        state.publishing = false;
        state.publishResult = payload?.data || null;
      })
      .addCase(publishNow.rejected, (state, { payload }) => {
        state.publishing = false;
        state.publishError = payload || { message: "We couldn't post your ads." };
      })

      .addCase(fetchTimeline.pending, (state) => {
        state.timeline.loading = true;
      })
      .addCase(fetchTimeline.fulfilled, (state, { payload }) => {
        state.timeline = { ...(payload?.data || { summary: null, rows: [] }), loading: false };
        // The queued run is now either in the rows or still pending on the
        // orchestrator's side; either way the banner has served its purpose.
        state.runNowQueued = false;
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
  clearPublishState,
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
export const selectJobSync = (s) => s.adFactoryBrief.jobSync;
export const selectIsRunningNow = (s) => s.adFactoryBrief.runningNow;
export const selectRunNowQueued = (s) => s.adFactoryBrief.runNowQueued;
export const selectPublishing = (s) => s.adFactoryBrief.publishing;
export const selectPublishResult = (s) => s.adFactoryBrief.publishResult;
export const selectPublishError = (s) => s.adFactoryBrief.publishError;
export const selectBriefs = (s) => s.adFactoryBrief.briefs;
export const selectBriefsLoading = (s) => s.adFactoryBrief.briefsLoading;
export const selectIsPausing = (s) => s.adFactoryBrief.pausing;
export const selectBriefError = (s) => s.adFactoryBrief.error;
export const selectActivationError = (s) => s.adFactoryBrief.activationError;
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
