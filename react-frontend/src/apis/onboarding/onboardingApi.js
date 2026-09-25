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
 * Reference templates ranked against ONE template — the recreate sheet's rail.
 *
 * Not a session call: the anchor id IS the query, so this works for any template
 * the user can see. Node flattens upstream's ranked shape into the same tile
 * shape the dock already renders, so the caller has one shape to know about.
 *
 * Throws on a real failure (the caller falls back to the session's own
 * templates); an empty `templates` array is a legitimate answer, not an error.
 */
export const getSimilarTemplates = async (
  templateId,
  { limit = 8, skip = 0, searchId = '', kind = '' } = {}
) => {
  const { data } = await axios.get(
    `${BASE_URL}/onboarding/templates/${encodeURIComponent(templateId)}/similar`,
    {
      // `search_id` freezes upstream's ranking across pages, so page 2 is the
      // next eight rather than a fresh re-rank that mostly repeats page 1.
      params: {
        limit,
        skip,
        // The template's own media_type. Without it the server has to infer the
        // corpus from how the id LOOKS, which is a guess about a format nobody
        // promised us.
        ...(kind ? { kind } : {}),
        ...(searchId ? { search_id: searchId } : {}),
      },
      headers: { Authorization: `Bearer ${getCookies()}` },
    }
  );
  return {
    templates: Array.isArray(data?.templates) ? data.templates : [],
    // `has_more` is upstream's own end-of-list answer. Guessing from a short
    // page is wrong here: a page can be short because a filter dropped rows.
    hasMore: Boolean(data?.has_more),
    nextSkip: Number.isFinite(Number(data?.next_skip)) ? Number(data.next_skip) : null,
    searchId: data?.search_id || '',
  };
};

/**
 * Recreate — generate a new ad from a chosen reference template.
 *
 * Multipart, because the product image is a `File` and the upstream contract
 * needs it as a URL: Node stores it and sends the link. The image is REQUIRED —
 * the template lends composition and style, and the upload is what the ad is
 * actually OF.
 *
 * Answers `202 { jobId, credits }`. The render itself is a job; watch it on the
 * socket the workspace already listens to.
 *
 * Throws with the server's status intact, so the caller can tell 402 (not
 * enough credits) from 403 (no plan) from 404 (this deployment has never been
 * shown that template) — three different things to say to a user.
 */
export const recreateFromTemplate = async (
  sessionId,
  templateId,
  { file, instruction, kind, maxWalletCredits }
) => {
  const form = new FormData();
  form.append('product', file);
  if (instruction) form.append('instruction', instruction);
  form.append('kind', kind === 'image' ? 'image' : 'video');
  // See `generateVideo` — the wallet figure the split confirmation quoted.
  if (maxWalletCredits != null) form.append('maxWalletCredits', String(maxWalletCredits));

  const { data } = await axios.post(
    `${BASE_URL}/onboarding/sessions/${encodeURIComponent(sessionId)}/templates/${encodeURIComponent(templateId)}/recreate`,
    form,
    {
      headers: { Authorization: `Bearer ${getCookies()}` },
    }
  );
  return data;
};

/** Which coachmark tours this user has seen: `{ workspace: bool, clip: bool }`. */
export const getOnboardingTours = async () => {
  const { data } = await axios.get(`${BASE_URL}/onboarding/tours`, {
    headers: { Authorization: `Bearer ${getCookies()}` },
  });
  return data;
};

/** Marks one coachmark tour ('workspace' | 'clip') as seen for this user. */
export const markOnboardingTourSeen = async (tourKey) => {
  const { data } = await axios.post(
    `${BASE_URL}/onboarding/tours/${encodeURIComponent(tourKey)}/seen`,
    {},
    { headers: { Authorization: `Bearer ${getCookies()}` } }
  );
  return data;
};

/**
 * Re-runs template matching for a session (video + image creatives).
 *
 * Called every time the workspace opens: upstream's media links rotate between
 * runs, so a stored list goes stale. Answers `202 {accepted}`; the fresh list
 * replaces the old one over the `aiJobUpdate` socket event.
 */
export const refreshTemplates = async (sessionId) => {
  const { data } = await axios.post(
    `${BASE_URL}/onboarding/sessions/${encodeURIComponent(sessionId)}/templates/refresh`,
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
export const generateVideo = async (sessionId, boardId, { maxWalletCredits } = {}) => {
  const { data } = await axios.post(
    `${BASE_URL}/onboarding/sessions/${encodeURIComponent(sessionId)}/videos`,
    {
      boardId,
      // The wallet figure the user was shown and agreed to, when a split
      // confirmation was involved. Billing refuses (409) rather than charging
      // more than this if the onboarding budget moved in the meantime — see
      // SplitChargeDialog. Omitted when nothing was quoted, which is also how
      // an older client behaves, and the server then skips the check.
      ...(maxWalletCredits == null ? {} : { maxWalletCredits }),
    },
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
 * `{ allowanceRemaining, allowanceTotal, onboardingCompleted, onboardingSkipped,
 *    resumeSessionId, resumeJobId, resumePhase, resumeBoardId, lastExitReason }`
 *
 * `allowanceRemaining` is a NUMBER of credits, not a boolean — it replaced
 * `freeRenderAvailable` on 2026-09-23. Onboarding now carries a budget rather
 * than one free render, so the UI has to be able to say "this costs 3" the
 * moment the budget can no longer cover a render.
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
      // Zero, not the full 35. The old fallback claimed a free render was
      // owed, which was safe when the worst case was showing an offer twice.
      // Claiming BUDGET we cannot confirm is different: the screen would
      // promise free renders the server will charge for. Unknown must read as
      // "no budget", and the cost shown will simply be the real one.
      allowanceRemaining: 0,
      allowanceTotal: 0,
      // Same reasoning: an unknown balance must not put an offer on screen.
      generationLeft: 0,
      generationKind: 'none',
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
 * Skip from the brand-setup form, before any session exists.
 *
 * `exitOnboarding` needs a session id, which that screen does not have yet.
 * This records the per-user "skipped" flag so the first-run redirect does not
 * bring the user back on the next login. Fire-and-forget, like the above.
 */
export const skipOnboardingWithoutSession = async () => {
  try {
    const { data } = await axios.post(
      `${BASE_URL}/onboarding/skip`,
      {},
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
