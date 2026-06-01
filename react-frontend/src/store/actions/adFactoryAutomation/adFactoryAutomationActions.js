import { createAsyncThunk } from '@reduxjs/toolkit';
import axios from 'axios';
import getCookies from '@/utils/getCookies';
import {
  AUTOMATION_STATUS,
  mapApiStatusToLocal,
} from '@/store/reducers/adFactoryAutomation/constants';
import { computeNextRunAt } from '@/store/reducers/adFactoryAutomation/nextRun';

const BACKEND_HOST = import.meta.env.VITE_SOCKET_URL;
const AUTOPILOT_BASE = `${BACKEND_HOST}/adsgpt/ads-factory/autopilot`;
// const AUTOPILOT_BASE = `https://h9pxq91j-7000.inc1.devtunnels.ms/adsgpt/ads-factory/autopilot`;

// ----------------------------------------------------------------------------
// Form ↔ API payload mapping
//
// Frequency presets: the form uses short keys, the API uses snake-case strings.
// Two presets (`weekday` / `weekend`) get an `every_` prefix; the rest are 1:1.
// ----------------------------------------------------------------------------
const FREQUENCY_FORM_TO_API = Object.freeze({
  does_not_repeat: 'does_not_repeat',
  daily: 'daily',
  weekday: 'every_weekday',
  weekend: 'every_weekend',
  custom: 'custom',
});

// Days-of-week stored on the form as ints (0=Sun..6=Sat) but the API wants
// lowercase names. Out-of-range values are dropped via filter.
const DAY_OF_WEEK_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function dayOfWeekNumberToName(n) {
  const idx = Number(n);
  return Number.isInteger(idx) ? DAY_OF_WEEK_NAMES[idx] : null;
}

// Builds the POST /jobs request body from the form's values.
function buildJobPayload(adsgptCampaignId, config) {
  if (!config) return null;
  const {
    frequency = {},
    pairsPerCycle = 1,
    imageModelProvider,
    callToAction = {},
    target = {},
  } = config;

  const schedule = {
    frequency: FREQUENCY_FORM_TO_API[frequency.preset] || 'daily',
    timezone: frequency.timezone || 'UTC',
  };
  if (frequency.startDate) schedule.startDate = frequency.startDate;
  if (frequency.endDate) schedule.endDate = frequency.endDate;

  // Custom frequency: only attach the customFrequency block when actually
  // using a custom recurrence; the backend rejects it for other presets.
  if (frequency.preset === 'custom') {
    const custom = frequency.custom || {};
    const repeatOnDays = Array.isArray(custom.daysOfWeek)
      ? custom.daysOfWeek.map(dayOfWeekNumberToName).filter(Boolean)
      : [];
    schedule.customFrequency = {
      repeatEvery: Math.max(1, Number(custom.interval) || 1),
      repeatUnit: custom.unit === 'day' ? 'day' : 'week',
      repeatOnDays,
    };
  }

  // Only attach platform keys when their required fields are present. The
  // backend silently skips a platform with missing requireds anyway, but we
  // keep the payload tidy.
  const meta = {};
  if (target.adAccountId) meta.adAccountId = target.adAccountId;
  if (target.adSetId) meta.adSetId = target.adSetId;
  if (target.pageId) meta.pageId = target.pageId;
  if (target.campaignId) meta.campaignId = target.campaignId;
  if (target.leadFormId) meta.leadFormId = target.leadFormId;

  const payload = {
    campaignId: adsgptCampaignId,
    schedule,
    pairsPerCycle: Math.max(1, Number(pairsPerCycle) || 1),
    // NOTE: `maxRuns` is in the API doc but the backend Joi schema currently
    // rejects it ("maxRuns is not allowed"). Omitting until the backend
    // either accepts it or defaults it internally.
  };
  if (imageModelProvider) payload.model = imageModelProvider;
  if (callToAction.button) payload.callToAction = [callToAction.button];
  if (callToAction.url) payload.destinationUrl = callToAction.url;
  if (Object.keys(meta).length > 0) payload.targets = { meta };

  return payload;
}

// ----------------------------------------------------------------------------
// PATCH /jobs/:id payload — all fields are editable in edit mode, so we send
// whatever the form has. Backend will accept or reject the diff. Matches
// buildJobPayload's meta-targets handling for consistency.
// ----------------------------------------------------------------------------
function buildJobUpdatePayload(config) {
  if (!config) return null;
  const {
    frequency = {},
    pairsPerCycle = 1,
    imageModelProvider,
    callToAction = {},
    target = {},
  } = config;

  const schedule = {
    frequency: FREQUENCY_FORM_TO_API[frequency.preset] || 'daily',
    timezone: frequency.timezone || 'UTC',
  };
  if (frequency.startDate) schedule.startDate = frequency.startDate;
  if (frequency.endDate) schedule.endDate = frequency.endDate;
  if (frequency.preset === 'custom') {
    const custom = frequency.custom || {};
    const repeatOnDays = Array.isArray(custom.daysOfWeek)
      ? custom.daysOfWeek.map(dayOfWeekNumberToName).filter(Boolean)
      : [];
    schedule.customFrequency = {
      repeatEvery: Math.max(1, Number(custom.interval) || 1),
      repeatUnit: custom.unit === 'day' ? 'day' : 'week',
      repeatOnDays,
    };
  }

  // Mirror buildJobPayload — append every meta field that has a value.
  const meta = {};
  if (target.adAccountId) meta.adAccountId = target.adAccountId;
  if (target.adSetId) meta.adSetId = target.adSetId;
  if (target.pageId) meta.pageId = target.pageId;
  if (target.campaignId) meta.campaignId = target.campaignId;
  if (target.leadFormId) meta.leadFormId = target.leadFormId;

  const payload = {
    schedule,
    pairsPerCycle: Math.max(1, Number(pairsPerCycle) || 1),
  };
  if (imageModelProvider) payload.model = imageModelProvider;
  if (callToAction.button) payload.callToAction = [callToAction.button];
  if (callToAction.url) payload.destinationUrl = callToAction.url;
  if (Object.keys(meta).length > 0) payload.targets = { meta };

  return payload;
}

// ----------------------------------------------------------------------------
// API → form mappers (used by mapJobToEntry to translate fetched jobs back
// into the form's config shape so Edit pre-fills correctly).
// ----------------------------------------------------------------------------
const FREQUENCY_API_TO_FORM = Object.freeze({
  does_not_repeat: 'does_not_repeat',
  daily: 'daily',
  every_weekday: 'weekday',
  every_weekend: 'weekend',
  custom: 'custom',
});

function mapApiFrequencyToFormPreset(apiFrequency) {
  return FREQUENCY_API_TO_FORM[apiFrequency] || 'daily';
}

function dayNameToDayOfWeekNumber(name) {
  const idx = DAY_OF_WEEK_NAMES.indexOf(String(name).toLowerCase());
  return idx >= 0 ? idx : null;
}

// The API returns dates as full ISO timestamps ("2026-05-30T00:00:00.000Z"),
// but the form's <input type="date"> only accepts YYYY-MM-DD. Slicing the
// first 10 chars works regardless of timezone offset because the backend
// stores dates with a consistent intent (midnight of the chosen day).
function toDateInputValue(input) {
  if (!input) return null;
  if (typeof input === 'string') {
    return input.length >= 10 ? input.slice(0, 10) : null;
  }
  if (input instanceof Date && !Number.isNaN(input.getTime())) {
    return input.toISOString().slice(0, 10);
  }
  return null;
}

// ----------------------------------------------------------------------------
// mapJobToEntry — converts an API job document into our entry shape.
//
// The form is the canonical shape client-side; the API's response shape is
// flatter and uses snake-case for some fields. Stats are derived from the
// job's totalRuns / failedRuns / runHistory. Falls back to `previous` (the
// existing Redux entry passed in by the caller) for fields the API doesn't
// return.
// ----------------------------------------------------------------------------
function mapJobToEntry(job, previous) {
  if (!job) return null;
  const meta = job?.targets?.meta || {};
  const schedule = job?.schedule || {};
  const pairsPerCycle = Number(job?.pairsPerCycle) || 1;
  const totalRuns = Number(job?.totalRuns) || 0;
  const failedRuns = Number(job?.failedRuns) || 0;
  const successfulRuns = Math.max(0, totalRuns - failedRuns);

  return {
    status: mapApiStatusToLocal(job?.status),
    jobId: job?._id || previous?.jobId || null,
    config: {
      frequency: {
        preset: mapApiFrequencyToFormPreset(schedule.frequency),
        // API returns full ISO timestamps; <input type="date"> needs YYYY-MM-DD,
        // otherwise the browser silently shows the field as empty.
        startDate:
          toDateInputValue(schedule.startDate) ||
          previous?.config?.frequency?.startDate ||
          null,
        endDate: toDateInputValue(schedule.endDate) || null,
        timezone: schedule.timezone || previous?.config?.frequency?.timezone || 'UTC',
        custom: {
          interval: Number(schedule.repeatEvery) || 1,
          unit: schedule.repeatUnit === 'day' ? 'day' : 'week',
          daysOfWeek: Array.isArray(schedule.repeatOnDays)
            ? schedule.repeatOnDays.map(dayNameToDayOfWeekNumber).filter((n) => n !== null)
            : [],
        },
      },
      pairsPerCycle,
      imageModelProvider: job?.model || previous?.config?.imageModelProvider || 'google',
      callToAction: {
        button: Array.isArray(job?.callToAction) ? job.callToAction[0] || null : null,
        url: job?.destinationUrl || '',
      },
      target: {
        adAccountId: meta.adAccountId || previous?.config?.target?.adAccountId || null,
        campaignId: meta.campaignId || previous?.config?.target?.campaignId || null,
        // API doesn't expose Meta campaign's objective — keep whatever's
        // cached. AutomationForm has a reactive lookup that fills this in
        // from campaignsDropdown once it loads.
        campaignObjective: previous?.config?.target?.campaignObjective || null,
        adSetId: meta.adSetId || null,
        pageId: meta.pageId || null,
        leadFormId: meta.leadFormId || previous?.config?.target?.leadFormId || null,
      },
    },
    stats: {
      generated: totalRuns * pairsPerCycle,
      posted: successfulRuns * pairsPerCycle,
      lastRunAt: schedule.lastRunAt || null,
      nextRunAt: schedule.nextRunAt || null,
    },
    history: Array.isArray(job?.runHistory) ? job.runHistory : previous?.history || [],
    createdAt: job?.createdAt || previous?.createdAt || null,
    updatedAt: job?.updatedAt || new Date().toISOString(),
  };
}

// ----------------------------------------------------------------------------
// Thunks
// ----------------------------------------------------------------------------

// fetchAutomation — GET /ads-factory/autopilot/jobs?campaignId=<id>
//
// Loads the active/paused/completed/failed job for an AdsGPT campaign so the
// canvas + edit form can render real backend state on every mount.
//
// Strategy:
//   1. Request /jobs filtered by campaignId. Backend may filter server-side
//      or return everything — we filter client-side either way.
//   2. Pick the first matching job (one automation per campaign for now).
//      Prefer non-terminal status if multiple exist.
//   3. Map the API job → our entry shape via mapJobToEntry, blending in
//      the live Redux entry for fields the API doesn't expose (the Meta
//      campaign objective in particular — AutomationForm refills it from
//      campaignsDropdown on next render either way).
//
// Network errors propagate to .rejected; the slice surfaces them via
// state.error. The previous Redux entry (if any) is preserved — we don't
// clear it on a transient failure.
export const fetchAutomation = createAsyncThunk(
  'adFactoryAutomation/fetch',
  async (campaignId, { getState }) => {
    if (!campaignId) return { campaignId: null };

    const res = await axios.get(`${AUTOPILOT_BASE}/jobs`, {
      params: { campaignId, limit: 50 },
      headers: {
        Authorization: `Bearer ${getCookies()}`,
        'Content-Type': 'application/json',
      },
    });
    const jobs = Array.isArray(res?.data?.data) ? res.data.data : [];

    // The list view populates campaignId as a nested object; the detail view
    // returns it as a raw id string. Handle both.
    const matchesCampaign = (j) => {
      const c = j?.campaignId;
      if (!c) return false;
      if (typeof c === 'string') return c === campaignId;
      return c?._id === campaignId;
    };

    // Prefer non-terminal states if the backend returned multiple jobs for
    // this campaign (active > paused > completed > failed > others).
    const STATUS_PRIORITY = ['active', 'paused', 'completed', 'failed'];
    const matching = jobs.filter(matchesCampaign);
    matching.sort((a, b) => {
      const ai = STATUS_PRIORITY.indexOf(a?.status);
      const bi = STATUS_PRIORITY.indexOf(b?.status);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });

    const job = matching[0] || null;
    const previous = getState().adFactoryAutomation?.configsByCampaign?.[campaignId];
    const entry = job ? mapJobToEntry(job, previous) : null;

    return { campaignId, entry };
  }
);

// Activate the automation — POST /ads-factory/autopilot/jobs.
//
// Sends the form values transformed via buildJobPayload, then merges the
// backend response onto our entry shape. We keep the form's original `config`
// object as entry.config (the API echoes it in a different shape; preserving
// the form shape avoids back-translating frequency enums on Edit). The API's
// _id is captured as `jobId` for the lifecycle endpoints (pause/resume/delete)
// to use via Redux state.
export const saveAutomation = createAsyncThunk(
  'adFactoryAutomation/save',
  async ({ campaignId, config }, { getState, rejectWithValue }) => {
    if (!campaignId) throw new Error('campaignId is required');

    const payload = buildJobPayload(campaignId, config);
    const token = getCookies();

    let job = null;
    try {
      const res = await axios.post(`${AUTOPILOT_BASE}/jobs`, payload, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      job = res?.data?.data || {};
    } catch (err) {
      return rejectWithValue({
        message:
          err?.response?.data?.error ||
          err?.response?.data?.message ||
          err?.message ||
          'Failed to activate automation',
      });
    }

    const now = new Date();
    const previous = getState().adFactoryAutomation?.configsByCampaign?.[campaignId];
    // Fall back to a client-computed next-run if the API didn't return one.
    const fallbackNextRunAt = computeNextRunAt(config?.frequency, now);

    const entry = {
      status: AUTOMATION_STATUS.ACTIVE,
      jobId: job?._id || previous?.jobId || null,
      config,
      stats: {
        generated: previous?.stats?.generated || 0,
        posted: previous?.stats?.posted || 0,
        lastRunAt: job?.schedule?.lastRunAt || previous?.stats?.lastRunAt || null,
        nextRunAt:
          job?.schedule?.nextRunAt ||
          (fallbackNextRunAt ? fallbackNextRunAt.toISOString() : null),
      },
      history: Array.isArray(job?.runHistory) ? job.runHistory : previous?.history || [],
      createdAt: job?.createdAt || previous?.createdAt || now.toISOString(),
      updatedAt: job?.updatedAt || now.toISOString(),
    };

    return { campaignId, entry };
  }
);

// ----------------------------------------------------------------------------
// updateAutomation — PATCH /ads-factory/autopilot/jobs/:jobId
//
// Edit-mode counterpart of saveAutomation. Sends only the fields the backend
// allows updating (see buildJobUpdatePayload). The slice shape is unchanged —
// we re-derive the entry from the API response so status / nextRunAt /
// updatedAt reflect the backend's view, and overlay the form's `config` for
// fields the response truncates.
// ----------------------------------------------------------------------------
export const updateAutomation = createAsyncThunk(
  'adFactoryAutomation/update',
  async ({ campaignId, config }, { getState, rejectWithValue }) => {
    if (!campaignId) throw new Error('campaignId is required');
    const previous = getState().adFactoryAutomation?.configsByCampaign?.[campaignId];
    const jobId = previous?.jobId;
    if (!jobId) {
      return rejectWithValue({
        message: 'No active job to update — re-activate first',
      });
    }

    const payload = buildJobUpdatePayload(config);

    let job = null;
    try {
      const res = await axios.patch(`${AUTOPILOT_BASE}/jobs/${jobId}`, payload, {
        headers: {
          Authorization: `Bearer ${getCookies()}`,
          'Content-Type': 'application/json',
        },
      });
      job = res?.data?.data || {};
    } catch (err) {
      return rejectWithValue({
        message:
          err?.response?.data?.error ||
          err?.response?.data?.message ||
          err?.message ||
          'Failed to update automation',
      });
    }

    // PATCH response is partial — overlay onto previous entry. Keep the
    // form's config (which is the canonical client shape and includes
    // fields the API doesn't echo on update, like campaignObjective).
    const now = new Date();
    const fallbackNextRunAt = computeNextRunAt(config?.frequency, now);
    const entry = {
      ...previous,
      status: mapApiStatusToLocal(job?.status) || previous.status || AUTOMATION_STATUS.ACTIVE,
      jobId: job?._id || previous.jobId,
      config,
      stats: {
        ...previous.stats,
        nextRunAt:
          job?.schedule?.nextRunAt ||
          (fallbackNextRunAt ? fallbackNextRunAt.toISOString() : previous.stats?.nextRunAt || null),
      },
      updatedAt: job?.updatedAt || now.toISOString(),
    };

    return { campaignId, entry };
  }
);

// Pause — POST /ads-factory/autopilot/jobs/:jobId/pause
// Removes the job from BullMQ but keeps it in Mongo. Resumable.
export const pauseAutomation = createAsyncThunk(
  'adFactoryAutomation/pause',
  async (campaignId, { getState, rejectWithValue }) => {
    if (!campaignId) throw new Error('campaignId is required');
    const previous = getState().adFactoryAutomation?.configsByCampaign?.[campaignId];
    const jobId = previous?.jobId;
    if (!previous) {
      return rejectWithValue({ message: 'No automation to pause' });
    }
    if (!jobId) {
      return rejectWithValue({ message: 'Missing jobId — re-activate to refresh' });
    }

    try {
      const token = getCookies();
      await axios.post(`${AUTOPILOT_BASE}/jobs/${jobId}/pause`,{}, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
    } catch (err) {
      return rejectWithValue({
        message:
          err?.response?.data?.error ||
          err?.response?.data?.message ||
          err?.message ||
          'Failed to pause automation',
      });
    }

    const entry = {
      ...previous,
      status: AUTOMATION_STATUS.PAUSED,
      updatedAt: new Date().toISOString(),
    };
    return { campaignId, entry };
  }
);

// Resume — POST /ads-factory/autopilot/jobs/:jobId/resume
// Re-registers the BullMQ schedule. May reject with
// "Cannot resume a completed job" if the job has already ended.
export const resumeAutomation = createAsyncThunk(
  'adFactoryAutomation/resume',
  async (campaignId, { getState, rejectWithValue }) => {
    if (!campaignId) throw new Error('campaignId is required');
    const previous = getState().adFactoryAutomation?.configsByCampaign?.[campaignId];
    const jobId = previous?.jobId;
    if (!previous) {
      return rejectWithValue({ message: 'No automation to resume' });
    }
    if (!jobId) {
      return rejectWithValue({ message: 'Missing jobId — re-activate to refresh' });
    }

    let job = null;
    try {
      const res = await axios.post(`${AUTOPILOT_BASE}/jobs/${jobId}/resume`,{}, {
        headers: {
          Authorization: `Bearer ${getCookies()}`,
          'Content-Type': 'application/json',
        },
      });
      job = res?.data?.data || {};
    } catch (err) {
      return rejectWithValue({
        message:
          err?.response?.data?.error ||
          err?.response?.data?.message ||
          err?.message ||
          'Failed to resume automation',
      });
    }

    const now = new Date();
    // Prefer the backend's recomputed next-run if returned; otherwise recompute
    // client-side from the saved frequency.
    const fallbackNextRunAt = computeNextRunAt(previous.config?.frequency, now);
    const entry = {
      ...previous,
      status: AUTOMATION_STATUS.ACTIVE,
      stats: {
        ...previous.stats,
        nextRunAt:
          job?.schedule?.nextRunAt ||
          (fallbackNextRunAt ? fallbackNextRunAt.toISOString() : previous.stats?.nextRunAt || null),
      },
      updatedAt: now.toISOString(),
    };
    return { campaignId, entry };
  }
);

// Hard-delete — DELETE /ads-factory/autopilot/jobs/:jobId
//
// Cancels the BullMQ schedule + removes the job from Mongo. Returns the
// canvas to manual mode and clears history. Permanent. If the Redux entry
// has no jobId (defensive), we still clear local state so the user has an
// escape hatch back to manual mode without a server round-trip.
export const deleteAutomation = createAsyncThunk(
  'adFactoryAutomation/delete',
  async (campaignId, { getState, rejectWithValue }) => {
    if (!campaignId) throw new Error('campaignId is required');
    const previous = getState().adFactoryAutomation?.configsByCampaign?.[campaignId];
    const jobId = previous?.jobId;

    if (jobId) {
      try {
        await axios.delete(`${AUTOPILOT_BASE}/jobs/${jobId}`, {
          headers: {
            Authorization: `Bearer ${getCookies()}`,
          },
        });
      } catch (err) {
        return rejectWithValue({
          message:
            err?.response?.data?.error ||
            err?.response?.data?.message ||
            err?.message ||
            'Failed to delete automation',
        });
      }
    }

    return campaignId;
  }
);

// ----------------------------------------------------------------------------
// fetchAutomationStats — GET /ads-factory/autopilot/jobs/:jobId/stats
//
// Returns the authoritative per-job creative counts + schedule timestamps:
//   { totalCreativesAssembled, totalCreativesPosted, nextRunAt, lastRunAt }
// The AutomationActiveNode reads these via entry.stats. mapJobToEntry's
// placeholders (totalRuns * pairsPerCycle) are overwritten when this resolves.
// ----------------------------------------------------------------------------
export const fetchAutomationStats = createAsyncThunk(
  'adFactoryAutomation/fetchStats',
  async (campaignId, { getState, rejectWithValue }) => {
    if (!campaignId) throw new Error('campaignId is required');
    const previous = getState().adFactoryAutomation?.configsByCampaign?.[campaignId];
    const jobId = previous?.jobId;
    if (!jobId) {
      return rejectWithValue({ message: 'No active job for stats' });
    }

    try {
      const token = getCookies();
      const res = await axios.get(`${AUTOPILOT_BASE}/jobs/${jobId}/stats`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      // Endpoint shape varies across the autopilot surface — handle both
      // wrapped ({ data: {...} }) and flat responses.
      const data = res?.data?.data || res?.data || {};
      // The /stats endpoint nests creative counts under `generationHealth`
      // and run timestamps under `schedule`. Fall back to top-level keys
      // for older response shapes so the polling stays compatible.
      const gh = data.generationHealth || {};
      const schedule = data.schedule || {};
      return {
        campaignId,
        stats: {
          generated:
            Number(gh.totalCreativesAssembled ?? data.totalCreativesAssembled) || 0,
          posted:
            Number(gh.totalCreativesPosted ?? data.totalCreativesPosted) || 0,
          lastRunAt: schedule.lastRunAt || data.lastRunAt || null,
          nextRunAt: schedule.nextRunAt || data.nextRunAt || null,
          schedule,
        },
      };
    } catch (err) {
      return rejectWithValue({
        message:
          err?.response?.data?.error ||
          err?.response?.data?.message ||
          err?.message ||
          'Failed to fetch automation stats',
      });
    }
  }
);

// ----------------------------------------------------------------------------
// fetchActivity — GET /ads-factory/autopilot/jobs/:jobId/activity
//
// Returns the full per-run activity trace for a job: every run with its
// generated images, generated texts, and assembled `creatives[]` (each carrying
// an `ad` block + `posting` block). The PublishedAdsModal flattens this into
// individual ad cards and renders posted / failed states from `posting.posted`.
// ----------------------------------------------------------------------------
export const fetchActivity = createAsyncThunk(
  'adFactoryAutomation/fetchActivity',
  async ({ jobId, skip = 0, limit = 50 } = {}, { rejectWithValue }) => {
    if (!jobId) {
      return rejectWithValue({ jobId: null, message: 'Missing jobId' });
    }
    try {
      const token = getCookies();
      const res = await axios.get(`${AUTOPILOT_BASE}/jobs/${jobId}/activity`, {
        params: { skip, limit },
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      const payload = res?.data || {};
      return {
        jobId,
        runs: Array.isArray(payload.data) ? payload.data : [],
        total: Number(payload.total) || 0,
        generationHealth: payload.generationHealth || null,
        campaign: payload.campaign || null,
      };
    } catch (err) {
      return rejectWithValue({
        jobId,
        message:
          err?.response?.data?.error ||
          err?.response?.data?.message ||
          err?.message ||
          'Failed to load activity',
      });
    }
  }
);

// ----------------------------------------------------------------------------
// fetchCtaOptions — real backend call (NOT mocked).
//
// GET /ads-factory/autopilot/cta-options?objective=<OUTCOME_*>
//
// The backend only supports three objectives (OUTCOME_TRAFFIC / OUTCOME_LEADS /
// OUTCOME_APP_PROMOTION). Any other objective returns 404, which we cache as
// { status: 'unsupported' } so we don't keep hitting the API for an objective
// that won't ever resolve. Cache lives in the slice keyed by objective string.
// ----------------------------------------------------------------------------
export const fetchCtaOptions = createAsyncThunk(
  'adFactoryAutomation/fetchCtaOptions',
  async (objective, { getState, rejectWithValue }) => {
    if (!objective) {
      return { objective: null, cached: true };
    }

    // Cache hit — skip the network and let the reducer no-op.
    const cached = getState().adFactoryAutomation?.ctaOptionsByObjective?.[objective];
    if (cached) {
      return { objective, cached: true, payload: cached };
    }

    try {
      const token = getCookies();
      const res = await axios.get(`${AUTOPILOT_BASE}/cta-options`, {
        params: { objective },
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      const options = Array.isArray(res?.data?.data) ? res.data.data : [];
      return {
        objective,
        cached: false,
        payload: { status: 'ok', options },
      };
    } catch (err) {
      const code = err?.response?.status;
      if (code === 404) {
        // Permanent for this objective — cache the sentinel so we stop asking.
        return {
          objective,
          cached: false,
          payload: { status: 'unsupported' },
        };
      }
      return rejectWithValue({
        objective,
        message: err?.response?.data?.error || err?.message || 'Failed to load CTA options',
      });
    }
  }
);
