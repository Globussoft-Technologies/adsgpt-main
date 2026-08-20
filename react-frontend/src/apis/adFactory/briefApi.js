import axios from 'axios';
import getCookies from '@/utils/getCookies';

// ----------------------------------------------------------------------------
// Ad Factory Quick setup — brief endpoints.
//
// The whole front door is `createBrief({ url })`: one field in, a fully
// inferred brief out. Everything Full control asks for across six modals is
// resolved behind that call.
//
// `POST /briefs` answers 202, not 200 — reading a page takes ~35s cold, and
// holding an HTTP connection open that long turns every slow page into a
// browser timeout. The brief id comes back immediately; completion arrives on
// the `adFactoryBriefReady` socket event, with a slow poll as the safety net.
// ----------------------------------------------------------------------------

const BASE_URL = import.meta.env.VITE_SOCKET_URL;
// MainRouter is mounted at /adsgpt (nodejs-backend/index.js), and briefs at
// /ad-factory/briefs within it.
const BRIEFS = `${BASE_URL}/adsgpt/ad-factory/briefs`;

const authHeaders = () => ({
  Authorization: `Bearer ${getCookies()}`,
  'Content-Type': 'application/json',
});

// The one fact the server cannot infer and the browser already knows.
//
// `delivery.frequency.timezone` defaulted to "UTC" and nothing ever set it, so
// every schedule ran on UTC — pick 9:00 AM in India and the ads went out at
// 2:30 PM. Sent at creation so the very first schedule is already right.
const browserTimezone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    return '';
  }
};

// Start inference from a pasted URL. Resolves as soon as the brief exists.
export const createBrief = async ({ url, forceRefresh = false }) => {
  const { data } = await axios.post(
    BRIEFS,
    { url, forceRefresh, timezone: browserTimezone() },
    { headers: authHeaders() },
  );
  return data;
};

// The zero-typing path. A brand with a saved website also runs inference, so
// the response says whether to show the wait screen.
export const createBriefFromBrand = async (brandId) => {
  const { data } = await axios.post(
    `${BRIEFS}/from-brand/${encodeURIComponent(brandId)}`,
    { timezone: browserTimezone() },
    { headers: authHeaders() },
  );
  return data;
};

// Open a Full control campaign in Quick setup. Idempotent — the same campaign
// always resolves to the same brief.
export const adoptCampaign = async (campaignId, url = '') => {
  const { data } = await axios.post(
    `${BRIEFS}/adopt/${encodeURIComponent(campaignId)}`,
    { url },
    { headers: authHeaders() },
  );
  return data;
};

// Carries `run` alongside the brief: the creatives generated so far, already
// filtered to the latest cycle and paired image-to-copy.
export const getBrief = async (briefId) => {
  const { data } = await axios.get(`${BRIEFS}/${briefId}`, { headers: authHeaders() });
  return data;
};

export const listBriefs = async () => {
  const { data } = await axios.get(BRIEFS, { headers: authHeaders() });
  return data;
};

// Partial. Only the sections being changed need sending; the server merges per
// section so siblings aren't wiped.
export const updateBrief = async (briefId, patch) => {
  const { data } = await axios.patch(`${BRIEFS}/${briefId}`, patch, { headers: authHeaders() });
  return data;
};

export const deleteBrief = async (briefId) => {
  const { data } = await axios.delete(`${BRIEFS}/${briefId}`, { headers: authHeaders() });
  return data;
};

// 202 — Python generates over a couple of minutes and results arrive on the
// campaign, surfaced through `getBrief().run`.
export const generateFromBrief = async (briefId) => {
  const { data } = await axios.post(
    `${BRIEFS}/${briefId}/generate`,
    {},
    { headers: authHeaders() },
  );
  return data;
};

// Creates the AdsFactoryJob. No saved Meta template needed — one is synthesised
// from the objective and budget.
export const activateBrief = async (briefId, connection) => {
  const { data } = await axios.post(
    `${BRIEFS}/${briefId}/activate`,
    { connection },
    { headers: authHeaders() },
  );
  return data;
};

// The MANUAL half — v1's "Post Ad". Ships the ads from the run being viewed,
// once, and creates no job.
//
//   mode 'auto'      we build the campaign + ad set from the brief
//   mode 'existing'  they go into ones the user already runs, and inherit that
//                    ad set's budget and targeting
export const publishBrief = async (briefId, { connection, mode = 'auto', campaignId, adSetId }) => {
  const { data } = await axios.post(
    `${BRIEFS}/${briefId}/publish`,
    {
      connection,
      mode,
      ...(mode === 'existing' ? { campaignId, adSetId } : {}),
    },
    { headers: authHeaders() },
  );
  return data;
};

// The live Meta wizard schema, so the objective / conversion-location / button
// pickers can never offer a combination Meta would reject. Served by the Ads
// Manager surface (`/meta-ads/wizard-schema`) — one schema, both products.
export const getWizardSchema = async () => {
  const { data } = await axios.get(`${BASE_URL}/adsgpt/meta-ads/wizard-schema`, {
    headers: authHeaders(),
  });
  return data?.schema || data?.data || data;
};

// Pause / resume go to the AUTOPILOT job routes, not a brief route. The job is
// the same document either front door creates, so Quick setup controls it with
// the same endpoints Full control does rather than growing a parallel pair.
const AUTOPILOT = `${BASE_URL}/adsgpt/ads-factory/autopilot`;

export const pauseJob = async (jobId) => {
  const { data } = await axios.post(
    `${AUTOPILOT}/jobs/${jobId}/pause`,
    {},
    { headers: authHeaders() },
  );
  return data;
};

export const resumeJob = async (jobId) => {
  const { data } = await axios.post(
    `${AUTOPILOT}/jobs/${jobId}/resume`,
    {},
    { headers: authHeaders() },
  );
  return data;
};

// Stop is a brief route rather than the job's DELETE, because the brief has to
// change state alongside it. Archives the job and cancels its queue entry; run
// history survives, so the deliveries timeline keeps showing what was already
// delivered.
export const stopBrief = async (briefId) => {
  const { data } = await axios.post(
    `${BRIEFS}/${briefId}/stop`,
    {},
    { headers: authHeaders() },
  );
  return data;
};

// One extra cycle, right now. The schedule is untouched — this is an additional
// run, not a reschedule. Refuses if a cycle is already in flight.
export const runBriefNow = async (briefId) => {
  const { data } = await axios.post(
    `${BRIEFS}/${briefId}/run-now`,
    {},
    { headers: authHeaders() },
  );
  return data;
};

export const getBriefTimeline = async (briefId) => {
  const { data } = await axios.get(`${BRIEFS}/${briefId}/timeline`, {
    headers: authHeaders(),
  });
  return data;
};
