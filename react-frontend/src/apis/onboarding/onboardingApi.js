// API client for onboarding module 1 — brand setup.
//
// Endpoint:
//   POST /adsgpt/onboarding/init — starts grounded research + scraping from a
//     prompt and/or uploaded files. Returns 202 with {job_id, session_id,
//     status}; the work happens in the background and progress is read from the
//     job, never inferred from this response.
//
// Two things about the request shape are easy to get wrong:
//
//   • There is ONE text field, `prompt`. The backend runs `extractUrls` over it
//     and does its own SSRF check on whatever it finds, so a pasted link goes
//     in the prompt like any other text — there is no separate url field.
//   • `user_id` is never sent. The backend derives it from the JWT and rejects
//     a request that tries to supply one.
//
// Auth follows the project convention: Bearer ${getCookies()} from the
// `access-token` cookie.

import axios from 'axios';
import getCookies from '@/utils/getCookies';

const BASE_URL = `${import.meta.env.VITE_SOCKET_URL}/adsgpt`;

/**
 * Starts an onboarding run.
 *
 * @param {string}   prompt          Free text; may contain the brand's URL.
 * @param {File[]}   files           Logo / product shots / brand deck.
 * @param {string}   sessionId       Re-runs an EXISTING session instead of
 *                                   creating one. Omit on a first run.
 * @param {string}   idempotencyKey  Sent as `Idempotency-Key`. A retry of the
 *                                   same attempt must reuse the same key so the
 *                                   upstream replays rather than re-runs.
 * @returns {Promise<{job_id: string, session_id: string, status: string}>}
 */
export const initOnboarding = async ({
  prompt = '',
  files = [],
  sessionId = '',
  idempotencyKey = '',
} = {}) => {
  const headers = { Authorization: `Bearer ${getCookies()}` };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

  // The route accepts either form. Multipart only when there is actually a file
  // to send — a JSON body keeps the common case simple and readable in logs.
  let body;
  if (files.length > 0) {
    body = new FormData();
    if (prompt) body.append('prompt', prompt);
    if (sessionId) body.append('session_id', sessionId);
    // Field name is not significant; the backend reads `req.files` as a flat
    // list via multer's `.any()`.
    files.forEach((file) => body.append('files', file));
  } else {
    body = { ...(prompt && { prompt }), ...(sessionId && { session_id: sessionId }) };
  }

  const { data } = await axios.post(`${BASE_URL}/onboarding/init`, body, { headers });
  return data;
};

/**
 * Reads a job's current state. The durable source of truth for progress — a
 * refresh, a dropped connection or a closed tab all recover from here.
 *
 * Returns the upstream snapshot unchanged; this route proxies rather than
 * serving Node's own mirror, so there is no `since` cursor to pass.
 */
export const getOnboardingJob = async (jobId) => {
  const { data } = await axios.get(`${BASE_URL}/onboarding/jobs/${encodeURIComponent(jobId)}`, {
    headers: { Authorization: `Bearer ${getCookies()}` },
  });
  return data;
};

/**
 * The whole session — brand, templates, storyboards, videos — each with its own
 * status and result.
 *
 * This is what the workspace renders from. `getOnboardingContext` below returns
 * the brand context ALONE, so a workspace built on it could never show the other
 * rails no matter how well they had completed.
 *
 * Image links come back already absolute: every storyboard frame carries a `src`
 * the browser can use directly, and templates carry `preview_url`. Upstream
 * returns those paths root-relative, so resolving them client-side would have
 * meant hardcoding upstream's hostname into the bundle.
 */
export const getOnboardingSession = async (sessionId) => {
  const { data } = await axios.get(
    `${BASE_URL}/onboarding/sessions/${encodeURIComponent(sessionId)}`,
    { headers: { Authorization: `Bearer ${getCookies()}` } }
  );
  return data;
};

/**
 * Asks for the next page of template recommendations.
 *
 * Upstream returns five per call and takes a cursor, so this is the same match
 * again with `skip` moved along. It answers `202 {accepted}` and nothing else:
 * there is no job id for this work, and the page itself arrives later on the
 * socket the workspace is already listening to, folded into the list it is
 * already showing.
 *
 * `accepted: false` is a normal answer, not an error — `already_loading` when a
 * page is in flight, `exhausted` when the corpus has no more to give.
 */
export const loadMoreTemplates = async (sessionId) => {
  const { data } = await axios.post(
    `${BASE_URL}/onboarding/sessions/${encodeURIComponent(sessionId)}/templates`,
    {},
    { headers: { Authorization: `Bearer ${getCookies()}` } }
  );
  return data;
};

/**
 * Renders ONE storyboard concept into a video clip.
 *
 * One board per call, deliberately: the contract will render a whole session if
 * you let it, but the product asks per concept and a batch job could not report
 * which tile is where.
 *
 * Answers `202 { accepted: true, jobId }` and nothing else — the render takes
 * the better part of a minute and everything after this arrives on the socket
 * the workspace is already listening to. `accepted: false` is a normal answer:
 * `already_running` when this board is mid-render, `already_rendered` when it
 * has a clip already.
 */
export const generateVideo = async (sessionId, boardId) => {
  const { data } = await axios.post(
    `${BASE_URL}/onboarding/sessions/${encodeURIComponent(sessionId)}/videos`,
    { boardId },
    { headers: { Authorization: `Bearer ${getCookies()}` } }
  );
  return data;
};

/**
 * The blurred placeholder GIF shown partway through a render.
 *
 * Built from that board's own keyframes, so the placeholder is made of the
 * scene it is standing in for. Only a `boardId` is sent — the images are chosen
 * server-side, because the generator FETCHES whatever URLs it is given and a
 * client must never get to pick those.
 *
 * Always answers 200. `{ ok: false, reason }` is routine — the deployment may
 * not have loader generation configured, or the keyframes may never have
 * rendered — and the caller's response to all of it is the same: keep the
 * shimmer. It must never block or delay the render itself.
 */
export const buildVideoLoader = async (sessionId, boardId) => {
  const { data } = await axios.post(
    `${BASE_URL}/onboarding/sessions/${encodeURIComponent(sessionId)}/loader`,
    { boardId },
    { headers: { Authorization: `Bearer ${getCookies()}` } }
  );
  return data;
};

/**
 * Every onboarding session this user has run, newest first.
 *
 * Summary rows only — brand name, per-module status, dates — not full contexts.
 * Served from Node's own mirror, since upstream has no idea what an AdsGPT user
 * is and so cannot answer "which of these are mine".
 *
 * Used by the dev session switcher, which is the only caller today: reopening a
 * finished run costs one read here plus one context read, instead of paying for
 * a whole analysis again.
 */
export const listOnboardingSessions = async (limit = 20) => {
  const { data } = await axios.get(`${BASE_URL}/onboarding/sessions`, {
    headers: { Authorization: `Bearer ${getCookies()}` },
    params: { limit },
  });
  return data?.items || [];
};

/**
 * Everything the app needs to decide where onboarding stands, in one call.
 *
 * `{ freeRenderAvailable, onboardingCompleted, resumeSessionId, resumeJobId,
 *    resumePhase, resumeBoardId, lastExitReason }`
 *
 * This replaces what `localStorage` used to be trusted for. Storage cannot
 * survive a cleared browser, a second device or a phone opened mid-run, and in
 * all three cases the user's paid-for session became unreachable while the
 * server knew about it the whole time. The browser now remembers only whether
 * the offer bar was dismissed in this tab.
 *
 * Never throws for the caller's purposes — an app boot must not fail because
 * this did. On any error it answers as if the user were brand new, which is the
 * safe shape: the banner shows (an offer seen twice beats one never seen), and
 * nothing is auto-resumed.
 */
export const getOnboardingEligibility = async () => {
  try {
    const { data } = await axios.get(`${BASE_URL}/onboarding/eligibility`, {
      headers: { Authorization: `Bearer ${getCookies()}` },
    });
    return data;
  } catch {
    return {
      freeRenderAvailable: true,
      onboardingCompleted: false,
      resumeSessionId: null,
      resumeJobId: null,
      resumePhase: 'setup',
      resumeBoardId: null,
      lastExitReason: '',
    };
  }
};

/**
 * Records how the user left onboarding.
 *
 * `completed` retires the offer bar for good. `skipped` leaves it up — an
 * unspent free render is still owed — and keeps this session as the one the
 * bar comes back to, rather than starting a fresh run.
 *
 * Fire-and-forget by design: the user is already navigating away, and a failed
 * bookkeeping call must not hold them on a screen they have finished with.
 */
export const exitOnboarding = async (sessionId, exit) => {
  try {
    const { data } = await axios.patch(
      `${BASE_URL}/onboarding/sessions/${encodeURIComponent(sessionId)}`,
      { exit },
      { headers: { Authorization: `Bearer ${getCookies()}` } }
    );
    return data;
  } catch {
    return null;
  }
};

/**
 * The persisted brand context for a finished session. Authoritative once a job
 * has succeeded; safe to call after a refresh with only the session id.
 */
export const getOnboardingContext = async (sessionId) => {
  const { data } = await axios.get(
    `${BASE_URL}/onboarding/context/${encodeURIComponent(sessionId)}`,
    { headers: { Authorization: `Bearer ${getCookies()}` } }
  );
  return data;
};

/**
 * Node's OWN job record — the recovery read.
 *
 * Different endpoint from `getOnboardingJob` above, and the difference matters:
 * that one proxies Python, whose snapshot carries `{id, kind, status, result}`
 * and NOTHING about progress. This one reads the `AiJob` row Node maintains,
 * which the SSE bridge updates as the stream arrives, so it also carries
 * `{stage, message, percent}`.
 *
 * Use this after a reload. Python's snapshot can say whether a run finished;
 * only this can say where an unfinished one has got to.
 *
 * `since` is the last `seq` already seen. When nothing is newer the endpoint
 * answers `204 No Content`, which axios surfaces as an empty body — cheap
 * enough to call on a timer.
 */
export const getJobStatus = async (jobId, since) => {
  const { data, status } = await axios.get(`${BASE_URL}/jobs/${encodeURIComponent(jobId)}`, {
    headers: { Authorization: `Bearer ${getCookies()}` },
    params: Number.isFinite(since) ? { since } : undefined,
    // 204 is a normal answer here, not a failure.
    validateStatus: (code) => code === 200 || code === 204,
  });
  return status === 204 ? null : data;
};
