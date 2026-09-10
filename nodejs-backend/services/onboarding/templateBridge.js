// templateTrigger — starts template matching upstream, then lets go.
//
// ── Why this is a trigger and not a bridge ───────────────────────────────────
// Template recommendations are not a job. `GET /api/v1/onboarding/recommend-
// templates` opens an SSE stream keyed only on `session_id` and issues no job
// id at all, and the frames carry none either — `start` is `{session_id, kind}`
// and nothing downstream of it has an id.
//
// An earlier version of this file consumed that stream, minting a local AiJob
// row so the run was trackable. That bought very little and cost a lot: the
// stream had to stay open for the whole match, it died with every deploy, and
// it made templates the one module whose result was written from a stream
// instead of from the callback.
//
// So we do the simple thing. Open the request, confirm upstream accepted it,
// and hang up. Upstream continues the work after the client disconnects
// (confirmed with DS) and calls the webhook when it finishes. The result lands
// in `session.templates` through exactly the same path every other module uses.
//
// Nothing is lost by not reading the frames. The stream's per-candidate events
// were never rendered live — the workspace shows the finished list — so the
// only thing they provided was a progress bar for a step the user is not
// waiting on, since this runs behind the brand profile they are already reading.
//
// The callback arrives with `session_id` + `kind` and no `job_id`; see
// `receiveSessionless` in controllers/Ai/jobWebhookController.js.

const axios = require("axios");
const OnboardingSession = require("../../Module/onboarding/onboardingSession");
const { markSectionStarted, mirrorJobResult } = require("./sessionMirror");
const { createFlowLog } = require("../../utils/flowLog");

// How long to wait for upstream to accept the request. Not how long the match
// takes — we are gone long before that. If headers have not arrived in this
// window, the request never landed and there is no run to wait for.
const ACCEPT_TIMEOUT_MS = 15_000;

// One trigger per PAGE in flight, not per session. Upstream caches per (user,
// session, kind, limit, skip, threshold), so two calls for the same page would
// resolve to the same result — but would also produce a second callback, and a
// second `queued` on a section that is already running. Two calls for DIFFERENT
// pages are the whole point of paging, and keying this on the session alone is
// what used to block them.
const active = new Set();

const pageKey = ({ sessionId, kind, limit, skip }) => `${sessionId}:${kind}:${limit}:${skip}`;

// The contract's own bounds: `limit` 1..20, `skip` 0..15. Sending anything
// outside them is a 400 before the stream even opens, so the ceiling on how far
// paging can go is upstream's, not ours.
// Verified against TEMPLATE_RECOMMENDATIONS_API_CONTRACT: out-of-range is a
// 400 BEFORE the stream opens, so these are hard ceilings, not preferences.
//
// They were 30 and 35, which contradicted the comment directly above them and
// was live-reachable: `nextPage` widens `limit` by the overlap it cannot skip
// past, so a session holding 30 templates asked for `limit=25` — outside the
// contract, and a 400 rather than a page. Nothing had hit it yet only because
// the first page asks for 20 and few sessions ever paged that far.
const MAX_LIMIT = 20;
const MAX_SKIP = 15;

/**
 * The window to ask for next, given how many are already stored.
 *
 * ── Why this is not just `skip = loaded` ─────────────────────────────────────
 * The contract allows `skip` 0..15 and `limit` 1..20, so the furthest item
 * anyone can address is the 35th — not the 20th, which is where the obvious
 * cursor stops dead: at twenty stored it would ask for `skip=20` and be
 * rejected with a 400 before the stream even opened.
 *
 * Past the ceiling the window is pinned to its highest legal start and WIDENED
 * instead, so it still reaches ground we have not covered. That re-requests
 * rows we already hold, which costs nothing — the mirror folds pages on
 * `template_id`, so the overlap is dropped on arrival and only the new tail is
 * kept.
 *
 * `exhausted` is the window having nowhere left to go: pinned at 15 and widened
 * to 20, it ends at 35, and once 35 are stored there is no legal request that
 * returns anything new.
 */
function nextPage(loaded = 0, want = 10) {
  const held = Math.max(Number(loaded) || 0, 0);
  const skip = Math.min(held, MAX_SKIP);
  const overlap = held - skip;
  const limit = Math.min(Math.max(Number(want) || 10, 1) + overlap, MAX_LIMIT);
  return { skip, limit, exhausted: skip + limit <= held };
}

// The score a candidate must clear to come back as `recommended: true`.
//
// Sent explicitly rather than left to upstream's default, because this is the
// one knob that decides whether a user sees five templates or none: the
// reference corpus is small and a lot of brands miss the 0.75 floor, which
// arrives as a `no_match` with near-misses attached. Naming it here means
// loosening it is an env change rather than a DS request.
//
// Upstream's own default is 0.75; keep that unless there is a reason.
const DEFAULT_THRESHOLD = 0.25;

// What the single retry asks for instead.
//
// It has to differ from DEFAULT_THRESHOLD, and that is the whole point rather
// than a tuning choice: upstream caches on
// `(user, session, kind, limit, skip, threshold)`, so a retry with identical
// params gets the identical cached failure back however fresh the
// idempotency key is. Threshold is the one field in that key we can move
// without asking for a DIFFERENT page of results, which `skip`/`limit` would.
//
// Lower, not higher, because the retry is for a run that produced nothing: a
// looser bar is the direction that can actually turn up matches.
const RETRY_THRESHOLD = 0.1;

function resolveThreshold(explicit) {
  const raw = explicit ?? process.env.TEMPLATE_MATCH_THRESHOLD;
  const value = Number(raw);
  // A typo in the env must not silently send `NaN` and get the whole request
  // rejected with a 400 before the stream even opens.
  if (!Number.isFinite(value) || value < 0 || value > 1) return DEFAULT_THRESHOLD;
  return value;
}

function resolveBaseUrl() {
  return String(process.env.ONBOARDING_PYTHON_BASE_URL || "").replace(/\/+$/, "");
}

/**
 * Starts template matching for a session.
 *
 * Fire-and-forget by contract: never await this from a request handler. Resolves
 * to `true` when upstream accepted the request, `false` when it did not — there
 * is no id to return, because none exists.
 */
async function startTemplateRun({ userId, sessionId, limit = 5, skip = 0, kind = "", threshold }) {
  const baseUrl = resolveBaseUrl();
  if (!baseUrl || !userId || !sessionId) return false;

  const page = {
    limit: Math.min(Math.max(Number(limit) || 5, 1), MAX_LIMIT),
    skip: Math.min(Math.max(Number(skip) || 0, 0), MAX_SKIP),
  };

  const key = pageKey({ sessionId, kind, ...page });
  if (active.has(key)) {
    createFlowLog("templates", { session: sessionId }).warn("duplicate.start_ignored", page);
    return false;
  }
  active.add(key);

  const log = createFlowLog("templates", { session: sessionId, user: userId });

  const score = resolveThreshold(threshold);
  const params = new URLSearchParams({
    session_id: sessionId,
    limit: String(page.limit),
    skip: String(page.skip),
    threshold: String(score),
  });
  if (kind) params.set("kind", kind);
  const url = `${baseUrl}/api/v1/onboarding/recommend-templates?${params}`;

  // Mark the section in flight before the call, so a reader can tell "matching
  // now" from "never asked" even if the request itself is slow to accept.
  await markSectionStarted(sessionId, "template.recommend", "");

  // Record the page being asked for, in the same breath. The callback carries
  // neither `limit` nor `skip`, so this is the only way the mirror can know
  // which page it is folding in — and putting it on the document rather than in
  // a Map means it survives a restart and works when the callback lands on a
  // different instance.
  await OnboardingSession.updateOne(
    { sessionId },
    { $set: { "templates.pagination.skip": page.skip, "templates.pagination.limit": page.limit } }
  );

  try {
    log.ds("out", "recommend-templates", { ...page, threshold: score });

    const response = await axios.get(url, {
      headers: { Accept: "text/event-stream" },
      responseType: "stream",
      timeout: ACCEPT_TIMEOUT_MS,
    });

    // Accepted. Drop the connection without reading a byte of the body — the
    // work continues upstream and reports back through the webhook.
    response.data.destroy();
    log.info("triggered", { kind: kind || "any", ...page, threshold: score });
    return true;
  } catch (error) {
    // Only the ACCEPT failed. Nothing is running upstream, so nothing will call
    // back, and the section would sit at `queued` forever if we left it.
    const message = error?.response?.status
      ? `template matching was rejected (${error.response.status})`
      : error?.message || "template matching could not be started";
    log.error("trigger.failed", { message });

    await mirrorJobResult(sessionId, "template.recommend", {
      status: "failed",
      error: message,
    });
    return false;
  } finally {
    active.delete(key);
  }
}

module.exports = {
  RETRY_THRESHOLD,
  startTemplateRun,
  nextPage,
  MAX_LIMIT,
  MAX_SKIP,
  _internals: { active, resolveBaseUrl, pageKey },
};
