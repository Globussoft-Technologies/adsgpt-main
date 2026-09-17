// templateTrigger — runs template matching upstream and stores the result.
//
// History: this once consumed the stream, then became "trigger and hang up,
// take the result from the webhook". Staging showed the webhook arriving with
// `result: null` for runs whose stream carried matches, so the stream is read
// to completion again and is the writer of record; the webhook is a backup,
// absorbed by the mirror's de-duplicating fold. See `startTemplateRun`.
//
// The callback arrives with `session_id` + `kind`; see `receiveSessionless` in
// controllers/Ai/jobWebhookController.js.

const axios = require("axios");
const OnboardingSession = require("../../Module/onboarding/onboardingSession");
const { markSectionStarted, mirrorJobResult, readSection } = require("./sessionMirror");
const { resolveResultMedia } = require("./mediaUrls");
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

// Per-PAGE size bound from the contract (TEMPLATE_RECOMMENDATIONS_API_CONTRACT
// (4)): query `limit` 1..100 — above that is a 400 before the stream opens.
// There is deliberately NO cap on `skip` or on the total: the rail pages for as
// long as upstream keeps returning full pages. The end is decided only by
// upstream sending a short page (`pagination.exhausted`, set in sessionMirror).
const MAX_LIMIT = 100;

/**
 * The window to ask for next: plain skip/limit.
 *
 * `skip` is how many are already stored, `limit` is the page size (clamped to
 * the contract's per-page bound). `exhausted` is always false here — only
 * upstream's answer can say the corpus has run out.
 */
function nextPage(loaded = 0, want = 10) {
  const skip = Math.max(Number(loaded) || 0, 0);
  const limit = Math.min(Math.max(Number(want) || 10, 1), MAX_LIMIT);
  return { skip, limit, exhausted: false };
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
 * Parses an SSE body into `{event, data}` frames as chunks arrive.
 * `data` is JSON-parsed when possible; a frame that is not JSON keeps the string.
 */
function createSseParser(onFrame) {
  let buffer = "";
  return (chunk) => {
    buffer += chunk.toString("utf8").replace(/\r\n/g, "\n");
    let cut;
    while ((cut = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      let event = "message";
      const data = [];
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
      }
      if (!data.length) continue;
      const raw = data.join("\n");
      let parsed = raw;
      try {
        parsed = JSON.parse(raw);
      } catch {
        /* keep the string */
      }
      onFrame(event, parsed);
    }
  };
}

// Ceiling on the whole match, not just the accept. A live run finishes in
// seconds; this only stops a hung upstream from holding a socket for ever.
const STREAM_TIMEOUT_MS = 120_000;

function emitTemplates(userId, sessionId, section) {
  try {
    if (!global.io || !userId) return;
    // Same event + shape the webhook emits, so the client has one code path.
    global.io.to(userId).emit("aiJobUpdate", {
      session_id: sessionId,
      kind: "template.recommend",
      event: "done",
      status: section?.status,
      result: resolveResultMedia("template.recommend", section?.result),
      error: section?.error || undefined,
    });
  } catch {
    /* a socket failure must never fail the run */
  }
}

/**
 * Runs template matching for a session and stores the result.
 *
 * ── Why the stream is now read to the end ────────────────────────────────────
 * This used to hang up as soon as upstream accepted and rely on the webhook for
 * the result. In staging that callback arrived `succeeded` with `result: null`
 * while the very same stream carried twenty templates — so the rail rendered
 * empty for sessions that had matches. The stream is now the writer of the
 * result; the webhook still lands and is absorbed by the mirror's de-duplicating
 * fold, so it remains a backup if this process dies mid-run.
 *
 * Both corpora are requested (`video=true&image=true`) and stored as ONE list,
 * each item tagged `media_type` — see `normalizeTemplateResult`.
 *
 * `refresh` adds upstream's `refresh=1` (bypass its 10-minute cache) and, on
 * the first page, REPLACES the stored list: media links rotate between runs.
 *
 * Fire-and-forget from request handlers. Resolves `true` when a result (or an
 * honest empty one) was stored, `false` otherwise.
 */
async function startTemplateRun({ userId, sessionId, limit = 5, skip = 0, kind = "", threshold, refresh = false }) {
  const baseUrl = resolveBaseUrl();
  if (!baseUrl || !userId || !sessionId) return false;

  const page = {
    limit: Math.min(Math.max(Number(limit) || 5, 1), MAX_LIMIT),
    skip: Math.max(Number(skip) || 0, 0),
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
    video: "true",
    image: "true",
  });
  if (kind) params.set("kind", kind);
  if (refresh) params.set("refresh", "1");
  const url = `${baseUrl}/api/v1/onboarding/recommend-templates?${params}`;

  // Mark the section in flight before the call, so a reader can tell "matching
  // now" from "never asked" even if the request itself is slow to accept.
  await markSectionStarted(sessionId, "template.recommend", "");

  // Record the page being asked for. The webhook carries neither `limit` nor
  // `skip`, so the backup path can only know the page from the document.
  await OnboardingSession.updateOne(
    { sessionId },
    { $set: { "templates.pagination.skip": page.skip, "templates.pagination.limit": page.limit } }
  );

  const controller = new AbortController();
  const overall = setTimeout(() => controller.abort(), STREAM_TIMEOUT_MS);

  try {
    log.ds("out", "recommend-templates", { ...page, threshold: score, refresh });

    const response = await axios.get(url, {
      headers: { Accept: "text/event-stream" },
      responseType: "stream",
      timeout: ACCEPT_TIMEOUT_MS,
      signal: controller.signal,
    });

    const videos = [];
    const images = [];
    let done = null;
    let streamError = null;

    await new Promise((resolve, reject) => {
      const feed = createSseParser((event, data) => {
        if (event === "template" && data && typeof data === "object") videos.push(data);
        else if (event === "image_template" && data && typeof data === "object") images.push(data);
        else if (event === "done") done = data && typeof data === "object" ? data : {};
        else if (event === "error") streamError = data?.error || String(data || "template matching failed");
      });
      response.data.on("data", feed);
      response.data.on("end", resolve);
      response.data.on("error", reject);
    });

    if (streamError || !done) {
      throw new Error(streamError || "template stream ended without a done event");
    }

    const { session_id: _s, ...envelope } = done;
    await mirrorJobResult(sessionId, "template.recommend", {
      status: "succeeded",
      result: { ...envelope, templates: videos, image_templates: images },
      completedAt: new Date(),
      requested: { ...page, replace: refresh && page.skip === 0 },
    });

    log.info("stored", { kind: kind || "any", ...page, videos: videos.length, images: images.length, refresh });
    emitTemplates(userId, sessionId, await readSection(sessionId, "template.recommend"));
    return true;
  } catch (error) {
    const message = error?.response?.status
      ? `template matching was rejected (${error.response.status})`
      : error?.message || "template matching could not be started";
    log.error("run.failed", { message });

    await mirrorJobResult(sessionId, "template.recommend", {
      status: "failed",
      error: message,
    });
    emitTemplates(userId, sessionId, await readSection(sessionId, "template.recommend"));
    return false;
  } finally {
    clearTimeout(overall);
    active.delete(key);
  }
}

module.exports = {
  RETRY_THRESHOLD,
  startTemplateRun,
  nextPage,
  MAX_LIMIT,
  _internals: { active, resolveBaseUrl, pageKey, createSseParser },
};
