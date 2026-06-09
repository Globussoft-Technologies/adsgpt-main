import { createSlice } from '@reduxjs/toolkit';
import {
  AUTOMATION_STATUS,
  isAutomationVisibleStatus,
} from '@/store/reducers/adFactoryAutomation/constants';
import {
  fetchAutomation,
  saveAutomation,
  updateAutomation,
  pauseAutomation,
  resumeAutomation,
  deleteAutomation,
  fetchCtaOptions,
  fetchActivity,
  fetchAutomationStats,
  fetchAutomationSummary,
} from '@/store/actions/adFactoryAutomation/adFactoryAutomationActions';

export { AUTOMATION_STATUS };

// After this long without a socket completion, an in-flight pending placeholder
// flips to `failed` so the modal doesn't spin forever when the worker silently
// drops a job. Mirrors MyImagesPage's stale-pending convention.
const STALE_PENDING_MS = 10 * 60 * 1000;

// Canonical shape for a per-job activity bucket. Used as the default when a
// new bucket is being created (or partially mutated by .pending / .rejected)
// so downstream selectors can always assume `runs` is an array, `total` is a
// number, etc. — instead of every consumer having to defend against a half-
// initialised bucket. Centralised here so adding a new field is one place.
const emptyActivityBucket = () => ({
  loading: false,
  error: null,
  runs: [],
  total: 0,
  generationHealth: null,
  campaign: null,
});

// ----------------------------------------------------------------------------
// AdFactory Automation slice
//
// Tracks per-campaign automation configuration + runtime stats. Keyed by
// campaignId because a workspace can have many AdFactory campaigns open over
// its lifetime and we don't want them to bleed into each other.
// ----------------------------------------------------------------------------

const emptyEntry = () => ({
  status: AUTOMATION_STATUS.IDLE,
  // wizard form values (mirrors the AutomationWizard schema)
  config: {
    frequency: null,           // { preset, startDate, endDate, timezone, custom }
    pairsPerCycle: 1,          // default 1, max 50
    imageModelProvider: 'google', // 'google' (Nano Banana Pro) | 'openai' (OpenAI 1.5)
    callToAction: {            // Meta ad's Call-to-Action button + destination
      button: null,            // e.g. 'LEARN_MORE'
      url: '',
    },
    target: {                  // AdAcct → Campaign → AdSet → FB Page
      adAccountId: null,
      campaignId: null,        // Meta campaign id (not AdsGPT campaignId)
      campaignObjective: null, // e.g. 'OUTCOME_TRAFFIC' — drives /cta-options
      adSetId: null,
      pageId: null,
    },
  },
  // runtime stats (derived server-side from job.totalRuns / failedRuns)
  stats: {
    generated: 0,
    posted: 0,
    lastRunAt: null,           // ISO string
    nextRunAt: null,           // ISO string
  },
  history: [],                 // [{ runAt, generated, posted, status }]
  createdAt: null,
  updatedAt: null,
});

const initialState = {
  // Persisted configs, keyed by AdsGPT campaignId
  configsByCampaign: {},
  // Async flags
  loading: false,
  saving: false,
  error: null,
  // UI coordination — which campaign currently has the history / stop
  // overlay open. campaignId | null. (The setup form is inline inside the
  // Services modal, so it doesn't need a flag.)
  historyOpenFor: null,
  stopConfirmFor: null,
  // Which campaign's Published Ads modal is open (campaignId | null).
  publishedAdsOpenFor: null,
  // Per-job activity trace cache, keyed by jobId. Populated by fetchActivity.
  //   { [jobId]: { loading, error, runs, total, generationHealth } }
  activityByJob: {},
  // CTA option cache, keyed by Meta campaign objective enum.
  //   { OUTCOME_TRAFFIC: { status: 'ok', options: [{value,label}, ...] },
  //     OUTCOME_SALES:   { status: 'unsupported' } }
  // Missing key = not fetched yet.
  ctaOptionsByObjective: {},
  ctaOptionsLoading: false,
  ctaOptionsError: null,
  // Live summary panel data — POST /jobs/summary response. Keyed by
  // campaignId so multiple campaign tabs don't stomp each other. Only
  // populated once the form is valid enough to be Activate-able.
  //   { [campaignId]: { data, loading, error } }
  summaryByCampaign: {},
};

const adFactoryAutomationSlice = createSlice({
  name: 'adFactoryAutomation',
  initialState,
  reducers: {
    clearError(state) {
      state.error = null;
    },
    // ----- UI coordination ---------------------------------------------------
    openAutomationHistory(state, action) {
      state.historyOpenFor = action.payload || null;
    },
    closeAutomationHistory(state) {
      state.historyOpenFor = null;
    },
    openAutomationStopConfirm(state, action) {
      state.stopConfirmFor = action.payload || null;
    },
    closeAutomationStopConfirm(state) {
      state.stopConfirmFor = null;
    },
    openPublishedAds(state, action) {
      state.publishedAdsOpenFor = action.payload || null;
    },
    closePublishedAds(state) {
      state.publishedAdsOpenFor = null;
    },

    // Merge a socket-delivered runComplete payload into the activity cache.
    //
    //   action.payload = { jobId, payload: <socket-event-body> }
    //
    // The live `adsFactory:runComplete` payload (see AUTOPILOT_SOCKET_EVENTS.md
    // for the doc shape, which differs) ships ONE run per event under
    // `payload.run`. We also tolerate `payload.data` (the doc shape — an
    // array of runs) in case the server starts emitting that variant.
    //
    // Dedupes incoming runs by runId (incoming always wins), prepends new
    // ones at the top. generationHealth + campaign blobs aren't present on
    // the live event so existing values are preserved — they only get
    // refreshed on a full GET /activity.
    mergeActivityFromSocket(state, action) {
      const { jobId, payload } = action.payload || {};
      if (!jobId || !payload) return;

      const existing = {
        ...emptyActivityBucket(),
        ...(state.activityByJob[jobId] || {}),
      };

      // Live payload uses `payload.run` (single object). Doc payload uses
      // `payload.data` (array). Accept both so we're future-proof against
      // server shape drift.
      const incomingRuns = Array.isArray(payload.data)
        ? payload.data
        : payload.run
          ? [payload.run]
          : [];
      if (incomingRuns.length === 0) return; // nothing to merge — bail.

      const incomingIds = new Set(
        incomingRuns.map((r) => r?.runId).filter(Boolean),
      );

      // Real backend runIds never collide with the selector's synthesized
      // `pending-*` ids, so virtual placeholders are never accidentally
      // persisted into state — only real runs flow through this path.
      const preserved = existing.runs.filter(
        (r) => r?.runId && !incomingIds.has(r.runId),
      );

      state.activityByJob[jobId] = {
        ...existing,
        loading: false,
        error: null,
        runs: [...incomingRuns, ...preserved],
        total:
          typeof payload.total === 'number'
            ? payload.total
            : Math.max(existing.total, incomingRuns.length + preserved.length),
        generationHealth: payload.generationHealth ?? existing.generationHealth,
        campaign: payload.campaign ?? existing.campaign,
      };
    },

    // Patch entry.stats from a socket-delivered jobSummary. Used by the
    // runComplete listener to reset the countdown instantly (the socket's
    // jobSummary.nextRunAt is authoritative; we don't need to wait on the
    // HTTP roundtrip from fetchAutomationStats).
    applyAutomationStatsPatch(state, action) {
      const { campaignId, stats } = action.payload || {};
      if (!campaignId || !stats) return;
      const entry = state.configsByCampaign[campaignId];
      if (!entry) return;
      state.configsByCampaign[campaignId] = {
        ...entry,
        stats: { ...entry.stats, ...stats },
      };
    },
  },
  extraReducers: (builder) => {
    builder
      // -- fetch --
      .addCase(fetchAutomation.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchAutomation.fulfilled, (state, action) => {
        state.loading = false;
        const { campaignId, entry } = action.payload || {};
        if (!campaignId) return;
        if (entry) {
          state.configsByCampaign[campaignId] = entry;
        } else {
          // No server-side job — clear any stale Redux entry so the canvas
          // doesn't keep showing an automation that's been deleted elsewhere.
          delete state.configsByCampaign[campaignId];
        }
      })
      .addCase(fetchAutomation.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error?.message || 'Failed to load automation';
      })

      // -- save / activate --
      .addCase(saveAutomation.pending, (state) => {
        state.saving = true;
        state.error = null;
      })
      .addCase(saveAutomation.fulfilled, (state, action) => {
        state.saving = false;
        const { campaignId, entry } = action.payload || {};
        if (!campaignId || !entry) return;
        state.configsByCampaign[campaignId] = entry;
      })
      .addCase(saveAutomation.rejected, (state, action) => {
        state.saving = false;
        // rejectWithValue puts the structured payload on action.payload;
        // a thrown error lands on action.error instead. Read both.
        state.error =
          action.payload?.message ||
          action.error?.message ||
          'Failed to save automation';
      })

      // -- update (edit-mode PATCH /jobs/:id) --
      // Payload shape is identical to saveAutomation, so the handlers mirror.
      .addCase(updateAutomation.pending, (state) => {
        state.saving = true;
        state.error = null;
      })
      .addCase(updateAutomation.fulfilled, (state, action) => {
        state.saving = false;
        const { campaignId, entry } = action.payload || {};
        if (!campaignId || !entry) return;
        state.configsByCampaign[campaignId] = entry;
      })
      .addCase(updateAutomation.rejected, (state, action) => {
        state.saving = false;
        state.error =
          action.payload?.message ||
          action.error?.message ||
          'Failed to update automation';
      })

      // -- pause / resume / stop --
      .addCase(pauseAutomation.fulfilled, (state, action) => {
        const { campaignId, entry } = action.payload || {};
        if (campaignId && entry) state.configsByCampaign[campaignId] = entry;
      })
      .addCase(resumeAutomation.fulfilled, (state, action) => {
        const { campaignId, entry } = action.payload || {};
        if (campaignId && entry) state.configsByCampaign[campaignId] = entry;
      })
      .addCase(deleteAutomation.fulfilled, (state, action) => {
        const campaignId = action.payload;
        if (!campaignId) return;
        delete state.configsByCampaign[campaignId];
      })

      // -- stats refresh (real counts from /jobs/:id/stats) --
      // Merges into the existing entry so we keep status/config/jobId intact.
      // No-op if the entry has been deleted between fetch and resolve.
      .addCase(fetchAutomationStats.fulfilled, (state, action) => {
        const { campaignId, stats } = action.payload || {};
        if (!campaignId || !stats) return;
        const entry = state.configsByCampaign[campaignId];
        if (!entry) return;
        state.configsByCampaign[campaignId] = {
          ...entry,
          stats: { ...entry.stats, ...stats },
        };
      })

      // -- activity (per-job run trace) --
      // Loading/error are tracked per jobId so two campaigns' modals can't
      // clobber each other if the user pops between them.
      .addCase(fetchActivity.pending, (state, action) => {
        const jobId = action.meta?.arg?.jobId;
        if (!jobId) return;
        // Spread defaults first so `runs`/`total`/etc. are always present
        // even on the first fetch (when no prior bucket exists). Existing
        // values then win, and the loading flag is set last.
        state.activityByJob[jobId] = {
          ...emptyActivityBucket(),
          ...(state.activityByJob[jobId] || {}),
          loading: true,
          error: null,
        };
      })
      .addCase(fetchActivity.fulfilled, (state, action) => {
        const { jobId, runs, total, generationHealth, campaign } = action.payload || {};
        if (!jobId) return;
        state.activityByJob[jobId] = {
          ...emptyActivityBucket(),
          loading: false,
          error: null,
          runs: runs || [],
          total: total || 0,
          generationHealth: generationHealth || null,
          campaign: campaign || null,
        };
      })
      .addCase(fetchActivity.rejected, (state, action) => {
        const jobId = action.meta?.arg?.jobId;
        if (!jobId) return;
        state.activityByJob[jobId] = {
          ...emptyActivityBucket(),
          ...(state.activityByJob[jobId] || {}),
          loading: false,
          error: action.payload?.message || action.error?.message || 'Failed to load activity',
        };
      })

      // -- CTA options (real backend) --
      .addCase(fetchCtaOptions.pending, (state) => {
        state.ctaOptionsLoading = true;
        state.ctaOptionsError = null;
      })
      .addCase(fetchCtaOptions.fulfilled, (state, action) => {
        state.ctaOptionsLoading = false;
        const { objective, payload, cached } = action.payload || {};
        if (!objective || cached) return; // no-op for cache hits / missing objective
        state.ctaOptionsByObjective[objective] = payload;
      })
      .addCase(fetchCtaOptions.rejected, (state, action) => {
        state.ctaOptionsLoading = false;
        state.ctaOptionsError = action.payload?.message || 'Failed to load CTA options';
      })

      // -- Summary panel (POST /jobs/summary) --
      // Per-campaign bucket so switching campaigns doesn't show stale numbers
      // from another campaign's last fetch.
      .addCase(fetchAutomationSummary.pending, (state, action) => {
        const campaignId = action.meta?.arg?.campaignId;
        if (!campaignId) return;
        const previous = state.summaryByCampaign[campaignId] || {};
        state.summaryByCampaign[campaignId] = {
          data: previous.data || null, // keep previous numbers visible while refetching
          loading: true,
          error: null,
        };
      })
      .addCase(fetchAutomationSummary.fulfilled, (state, action) => {
        const { campaignId, data } = action.payload || {};
        if (!campaignId) return;
        state.summaryByCampaign[campaignId] = {
          data: data || null,
          loading: false,
          error: null,
        };
      })
      .addCase(fetchAutomationSummary.rejected, (state, action) => {
        const campaignId = action.meta?.arg?.campaignId;
        if (!campaignId) return;
        const previous = state.summaryByCampaign[campaignId] || {};
        state.summaryByCampaign[campaignId] = {
          data: previous.data || null, // keep last good numbers on error
          loading: false,
          error: action.payload?.message || 'Failed to load summary',
        };
      });
  },
});

export const {
  clearError,
  openAutomationHistory,
  closeAutomationHistory,
  openAutomationStopConfirm,
  closeAutomationStopConfirm,
  openPublishedAds,
  closePublishedAds,
  mergeActivityFromSocket,
  applyAutomationStatsPatch,
} = adFactoryAutomationSlice.actions;

// ----------------------------------------------------------------------------
// Selectors
// ----------------------------------------------------------------------------

const empty = emptyEntry();

export const selectAutomationEntry = (state, campaignId) =>
  (campaignId && state.adFactoryAutomation.configsByCampaign[campaignId]) || empty;

export const selectAutomationStatus = (state, campaignId) =>
  selectAutomationEntry(state, campaignId).status;

export const selectAutomationStats = (state, campaignId) =>
  selectAutomationEntry(state, campaignId).stats;

export const selectAutomationConfig = (state, campaignId) =>
  selectAutomationEntry(state, campaignId).config;

// Convenience: "is the canvas in automation mode for this campaign?"
// Drives the node-swap on the React Flow canvas in chunk 5.
// True when the Automation Active node should occupy the canvas (vs the
// manual cluster). Includes terminal states (completed / failed) so the user
// sees what happened rather than the canvas silently flipping back.
export const selectIsAutomationActive = (state, campaignId) =>
  isAutomationVisibleStatus(selectAutomationStatus(state, campaignId));

export const selectAutomationSaving = (state) => state.adFactoryAutomation.saving;
export const selectAutomationLoading = (state) => state.adFactoryAutomation.loading;
export const selectAutomationError = (state) => state.adFactoryAutomation.error;

// UI coordination selectors
export const selectHistoryOpenFor = (state) => state.adFactoryAutomation.historyOpenFor;
export const selectStopConfirmFor = (state) => state.adFactoryAutomation.stopConfirmFor;
export const selectPublishedAdsOpenFor = (state) => state.adFactoryAutomation.publishedAdsOpenFor;

// Per-job activity selector. Returns:
//   undefined → never fetched
//   { loading, error, runs, total, generationHealth } otherwise
export const selectActivityForJob = (state, jobId) =>
  jobId ? state.adFactoryAutomation.activityByJob[jobId] : undefined;

// Derive virtual `pending` placeholder runs for the History modal to show
// while a cycle is mid-run but the `adsFactory:runComplete` socket hasn't
// fired yet. Inputs:
//   - entry : selectAutomationEntry(state, campaignId)
//   - runs  : real runs already in state (used to detect "real run arrived
//             for the current cycle → no placeholders needed")
//   - now   : Date.now() at call time (a hook in the modal will tick it)
//
// Emits N=pairsPerCycle placeholder runs when:
//   - Automation is ACTIVE
//   - nextRunAt has passed (now >= nextRunAt)
//   - No real run with startedAt >= nextRunAt exists yet
//
// After STALE_PENDING_MS the placeholders flip from `pending` to `failed`
// with a "did not complete in time" error so the loader doesn't spin
// forever if the worker silently drops a job.
function derivePendingPlaceholders(entry, runs, now) {
  if (!entry || entry.status !== AUTOMATION_STATUS.ACTIVE) return [];
  const nextRunAt = entry.stats?.nextRunAt;
  if (!nextRunAt) return [];
  const nextRunMs = new Date(nextRunAt).getTime();
  if (Number.isNaN(nextRunMs) || nextRunMs > now) return [];

  const hasRealRunSince = (Array.isArray(runs) ? runs : []).some((r) => {
    const startedMs = r?.startedAt ? new Date(r.startedAt).getTime() : 0;
    return startedMs >= nextRunMs;
  });
  if (hasRealRunSince) return [];

  const isStale = now - nextRunMs > STALE_PENDING_MS;
  const status = isStale ? 'failed' : 'pending';
  const error = isStale ? 'Run did not complete in time' : null;
  const n = Math.max(1, Number(entry.config?.pairsPerCycle) || 1);

  return Array.from({ length: n }, (_, i) => ({
    runId: `pending-${nextRunMs}-${i}`,
    status,
    startedAt: nextRunAt,
    completedAt: null,
    durationMs: 0,
    error,
    creatives: [],
    // Marker so PublishedAdsModal/PublishedAdCard can branch on a
    // placeholder vs. a real failed run (chunk 4 wiring).
    _isPending: !isStale,
  }));
}

// Activity selector with virtual pending-placeholder runs prepended when
// the active cycle is overdue. Modal binds to this instead of
// selectActivityForJob so the placeholders show without any extra
// dispatching — they're derived purely from the existing entry + runs.
//
// Args object: { jobId, campaignId, now }
//   - jobId      : keys into activityByJob
//   - campaignId : keys into configsByCampaign for status + nextRunAt + pairs
//   - now        : Date.now() at render time (caller ticks for the
//                  overdue/stale checks to recompute)
export const selectActivityWithPending = (state, { jobId, campaignId, now }) => {
  const activity = selectActivityForJob(state, jobId);
  const entry =
    campaignId && state.adFactoryAutomation.configsByCampaign[campaignId];
  const placeholders = derivePendingPlaceholders(
    entry || null,
    activity?.runs,
    now,
  );

  if (placeholders.length === 0) return activity;

  // Cycle is overdue + no real run yet. Spread the canonical empty bucket
  // first so the synth always has the full shape — `activity` may be
  // undefined (never fetched) or a partial bucket from an in-flight
  // .pending. fetchActivity.fulfilled will overwrite this on resolve.
  const base = { ...emptyActivityBucket(), ...(activity || {}) };
  return { ...base, runs: [...placeholders, ...base.runs] };
};

// CTA option cache selectors. Returns:
//   undefined      → never fetched for this objective
//   { status: 'ok', options }       → fetched + supported
//   { status: 'unsupported' }       → 404'd — objective doesn't support CTAs
export const selectCtaOptionsForObjective = (state, objective) =>
  objective ? state.adFactoryAutomation.ctaOptionsByObjective[objective] : undefined;

// Summary panel — API-driven numbers for the Activate/Update preview box.
// Returns the per-campaign bucket: { data, loading, error }. The data field
// is null until the first successful fetch, so SummarySection can fall back
// to its local helper while the user is still filling the form.
const emptySummaryBucket = { data: null, loading: false, error: null };
export const selectAutomationSummary = (state, campaignId) =>
  (campaignId && state.adFactoryAutomation.summaryByCampaign[campaignId]) ||
  emptySummaryBucket;
export const selectCtaOptionsLoading = (state) => state.adFactoryAutomation.ctaOptionsLoading;
export const selectCtaOptionsError = (state) => state.adFactoryAutomation.ctaOptionsError;

export default adFactoryAutomationSlice.reducer;
