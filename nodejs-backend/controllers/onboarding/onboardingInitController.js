/**
 * Onboarding init — the browser-facing half of module 1.
 *
 * The expensive work (grounded research, scraping, context merge, embedding)
 * belongs to the DS team's service and is described by
 * `ONBOARDING_INIT_API_CONTRACT.md`. This controller is what stands between it
 * and a browser, and it exists for four reasons the upstream service cannot
 * cover on its own:
 *
 *   1. IDENTITY. Upstream takes `user_id` as a plain body field and trusts it.
 *      Node reads it from a verified JWT and injects it, so a client cannot
 *      onboard as somebody else — and cannot read somebody else's job either.
 *
 *   2. SSRF. The prompt is free text that causes a server-side fetch
 *      downstream. Every URL in it clears `utils/safeUrl` here, with DNS, before
 *      we forward anything. Node is the first hop and must not delegate that
 *      check — the same rule adFactoryBriefController states.
 *
 *   3. OWNERSHIP. Upstream job and context ids are UUIDs with no owner. The
 *      session mirror is what lets us answer "is this yours?" before proxying.
 *
 *   4. A LOCAL RECORD, so the next three modules (templates, storyboarding,
 *      video gen) have something to hang off, and so a user who loses
 *      localStorage can still find their run.
 *
 * On idempotency: we do NOT short-circuit a retried `Idempotency-Key` locally.
 * Upstream honours the key and returns the original job, and it is the layer
 * that pays for the AI run, so it stays the authority. Our stored key only
 * stops us writing a duplicate mirror row, and we mirror upstream's own status
 * code (200 on replay, 202 on a fresh run) rather than deciding for it.
 */

const { randomUUID } = require("node:crypto");
const OnboardingSession = require("../../Module/onboarding/onboardingSession");
const UserProfile = require("../../Module/user/userProfileModel");
const AiJob = require("../../Module/ai/aiJob");
const onboardingClient = require("../../services/onboarding/onboardingClient");
const { startJobStreamBridge } = require("../../services/onboarding/jobStreamBridge");
const {
  mirrorJobResult,
  videosResultFromBoards,
} = require("../../services/onboarding/sessionMirror");
const { startTemplateRun, nextPage } = require("../../services/onboarding/templateBridge");
const { startVideoRun } = require("../../services/onboarding/videoClient");
const { buildBoardLoader } = require("../../services/onboarding/loaderClient");
const {
  absolutise,
  resolveStoryboardMedia,
  resolveTemplateMedia,
  resolveVideoMedia,
} = require("../../services/onboarding/mediaUrls");
const { OnboardingUpstreamError, ONBOARDING_ERROR_CODES } = onboardingClient;
const { assertSafeUrl, UnsafeUrlError } = require("../../utils/safeUrl");
const {
  initSchema,
  rejectForbiddenFields,
  extractUrls,
  totalUploadBytes,
  MAX_TOTAL_UPLOAD_BYTES,
} = require("../../Validations/onboarding/onboardingInit.validation");
const logger = require("../../utils/logger");
const { createFlowLog, newReqId } = require("../../utils/flowLog");

// Terminal job states. Once a job reports one of these, the mirror can be
// written and never needs syncing again.
const TERMINAL_STATUSES = new Set(["succeeded", "failed", "cancelled"]);

// One "load more" is one more page of the same size the automatic first pass
// asks for, so the row grows by a predictable amount rather than in jumps.
// Mirrors FIRST_TEMPLATE_PAGE in controllers/Ai/jobWebhookController.js.
const DEFAULT_TEMPLATE_PAGE = 10;

// Ownership is enforced by querying with BOTH the upstream id and userId, so
// another user's session is indistinguishable from one that doesn't exist. A
// 403 would confirm the id is real; a 404 tells an attacker nothing.
// A job id belongs to exactly one module of one session, but the caller does
// not know which module — so this searches every section rather than assuming
// module 1. See `findByJobId` on the model.
const findOwnedByJob = (jobId, userId) =>
  OnboardingSession.findByJobId(jobId, userId);
const findOwnedBySession = (sessionId, userId) =>
  OnboardingSession.findOne({ sessionId, userId });

/**
 * Turns an upstream failure into a client response.
 *
 * Deliberately narrow: only a rejection (4xx) carries upstream's own message
 * through, because the contract writes those for humans. Everything else gets
 * our wording — leaking "connect ECONNREFUSED 10.0.3.7:8080" to a browser tells
 * the user nothing and tells an attacker something.
 */
function respondUpstreamError(res, error, context) {
  if (!(error instanceof OnboardingUpstreamError)) {
    logger.error(`[onboarding] ${context} failed`, error);
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  }

  switch (error.code) {
    case ONBOARDING_ERROR_CODES.NOT_FOUND:
      return res.status(404).json({ error: "Not found" });
    case ONBOARDING_ERROR_CODES.REJECTED:
      return res.status(400).json({ error: error.message });
    case ONBOARDING_ERROR_CODES.TIMEOUT:
      return res.status(504).json({
        error: "The onboarding service took too long. Please try again.",
      });
    case ONBOARDING_ERROR_CODES.NOT_CONFIGURED:
      // A deployment problem wearing a user's clothes. Logged loudly because
      // nothing the user does will fix it.
      logger.error("[onboarding] ONBOARDING_PYTHON_BASE_URL is not set");
      return res.status(503).json({ error: "Onboarding is temporarily unavailable." });
    default:
      return res.status(502).json({ error: "Onboarding is temporarily unavailable." });
  }
}

/**
 * Writes an upstream job snapshot into the mirror.
 *
 * Opportunistic by design: this runs whenever a terminal result happens to pass
 * through Node, on the way to a browser that was going to receive it anyway. If
 * the user closes the tab mid-run nothing calls this, the mirror stays
 * `queued`, and the next read backfills from upstream instead. That is the
 * accepted trade — the context is never lost, because upstream persists it
 * regardless of what our mirror says.
 *
 * Never throws. A failed mirror write must not break a response the user is
 * waiting on, because the mirror is a cache and upstream is the truth.
 */
async function syncMirrorFromSnapshot(sessionDoc, snapshot, kindHint = "") {
  if (!sessionDoc || !snapshot) return;

  try {
    const status = snapshot.status;
    if (!status) return;

    const jobId = snapshot.job_id || snapshot.id || "";

    // Which module this result belongs to is OURS to know, not the payload's.
    // Upstream's SSE frames carry no `kind` at all, and where a snapshot does
    // include one it is still their word for it — so the AiJob row we wrote
    // when we started the job is the authority, in the same way the webhook
    // trusts its stored kind over `body.kind`.
    //
    // Order: our row → the caller's hint → the snapshot's own claim. Without a
    // lookup this defaulted to `onboarding.init`, which quietly wrote a
    // storyboard result into the brand section the first time this read path
    // served anything but module 1.
    let kind = kindHint;
    if (!kind && jobId) {
      const row = await AiJob.findOne({ jobId }).select("kind").lean();
      kind = row?.kind || "";
    }
    if (!kind) kind = snapshot.kind || "onboarding.init";

    const result = snapshot.result || {};
    await mirrorJobResult(sessionDoc.sessionId, kind, {
      status,
      jobId,
      result,
      error: status === "failed" ? snapshot.error || result.error || "Onboarding failed" : "",
      completedAt: snapshot.completed_at ? new Date(snapshot.completed_at) : undefined,
    });
  } catch (error) {
    logger.error("[onboarding] mirror sync failed", error);
  }
}

/**
 * POST /adsgpt/onboarding/init
 *
 * Accepts JSON or multipart. Returns upstream's acceptance payload verbatim —
 * `{session_id, job_id, status}` — which the client must store before doing
 * anything else, so a refresh resumes the run instead of starting a second one.
 */
exports.init = async (req, res) => {
  /*
    #swagger.tags = ['Onboarding']
    #swagger.summary = 'Start brand onboarding'
    #swagger.description = 'Takes a prompt (optionally containing a website URL) and/or uploaded files, and starts grounded research + scraping. Returns 202 immediately; subscribe to the job events stream for progress.'
    #swagger.security = [{ "BearerAuth": [] }]
  */
  const log = createFlowLog("onboarding.init", { req: newReqId() });

  try {
    const userId = req.user?.user_id;
    if (!userId) {
      log.done(401, { reason: "no_user" });
      return res.status(401).json({ error: "Unauthorized" });
    }
    log.bind({ user: userId });

    const forbidden = rejectForbiddenFields(req.body);
    if (forbidden) {
      log.done(400, { reason: "forbidden_field" });
      return res.status(400).json({ error: forbidden });
    }

    const { error: validationError, value } = initSchema.validate(req.body || {}, {
      abortEarly: false,
    });
    if (validationError) {
      log.done(400, { reason: "validation", fields: validationError.details.length });
      return res.status(400).json({
        error: validationError.details.map((d) => d.message).join(", "),
      });
    }

    const prompt = (value.prompt || "").trim();
    const files = Array.isArray(req.files) ? req.files : [];

    // The contract's real precondition, checkable only now that multer has run.
    // Sizes and counts only — never the prompt text. It is user content and
    // can carry personal data, and these logs live for ten days.
    log.info("received", { promptLen: prompt.length, files: files.length });

    if (!prompt && files.length === 0) {
      log.done(400, { reason: "empty_request" });
      return res
        .status(400)
        .json({ error: "a prompt or at least one attachment is required" });
    }

    const attachmentMeta = files.map((file) => ({
      fieldName: file.fieldname || "",
      filename: file.originalname || "",
      mimeType: file.mimetype || "",
      sizeBytes: file.size || 0,
    }));

    const uploadBytes = totalUploadBytes(files);
    if (uploadBytes > MAX_TOTAL_UPLOAD_BYTES) {
      log.done(400, { reason: "upload_too_large", bytes: uploadBytes });
      return res.status(400).json({
        error: `Attachments are too large (max ${Math.floor(
          MAX_TOTAL_UPLOAD_BYTES / (1024 * 1024)
        )} MB in total)`,
      });
    }

    // ── SSRF gate ────────────────────────────────────────────────────────
    // Checked in parallel: a prompt with several links shouldn't cost several
    // sequential DNS round-trips before the user sees a 202. One unsafe URL
    // fails the whole request rather than being stripped — silently dropping
    // the link the user pasted would produce brand context for the wrong page
    // and no explanation of why.
    const candidateUrls = extractUrls(prompt);
    let safeUrls = [];
    try {
      const checked = await Promise.all(candidateUrls.map((url) => assertSafeUrl(url)));
      safeUrls = checked.map((url) => url.href);
      if (candidateUrls.length) log.info("urls.checked", { urls: safeUrls.length });
    } catch (urlError) {
      if (urlError instanceof UnsafeUrlError) {
        // The reason code, not the URL: an attacker's probe target is exactly
        // the sort of thing not to persist, and the code is what we act on.
        log.done(400, { reason: "unsafe_url", code: urlError.code });
        return res.status(400).json({ error: urlError.message });
      }
      throw urlError;
    }

    // Continuing an existing session? It has to be yours. Without this, a user
    // could pass someone else's session_id and overwrite their brand context —
    // upstream would happily accept it, since re-running with the same id is a
    // legitimate update.
    // Continuing an existing session? Ownership is enforced by the update
    // below, which filters on { _id, userId } — a session that is not yours
    // matches nothing and 404s, exactly as a missing one would.
    const requestedSessionId = value.session_id || "";

    const idempotencyKey = String(req.headers["idempotency-key"] || "").trim();

    // ── The session document comes FIRST ─────────────────────────────────
    //
    // Its `_id` IS the session id. We create it before calling upstream and
    // send that id as `session_id`, so there is exactly one identifier for a
    // brand and we own it.
    //
    // The order is the point. If the upstream call times out or its response is
    // lost, the run still completes over there — researched, merged, stored —
    // and with an id we generated we can still reach it via
    // `GET /context/{_id}`. Let upstream mint the id instead and that same
    // failure loses the brand permanently: the work is paid for and we have no
    // handle on it.
    //
    // It also means a crashed or rejected init leaves a visible `failed` row
    // rather than nothing at all.
    let sessionDoc;
    if (requestedSessionId) {
      // Re-run of an existing session. Ownership was checked above.
      sessionDoc = await OnboardingSession.findOneAndUpdate(
        { sessionId: requestedSessionId, userId },
        {
          $set: {
            prompt,
            sourceUrls: safeUrls,
            attachments: attachmentMeta,
            idempotencyKey,
            // A re-run supersedes the previous outcome. Clearing these stops
            // the UI showing a stale failure, or the previous run's brand,
            // while the new job is still queued.
            //
            // Only the BRAND section is reset. Templates and storyboards from
            // the previous run stay until their own re-run replaces them —
            // they are separate work with separate lifecycles, and wiping them
            // here would throw away results the user can still see.
            "brand.status": "queued",
            "brand.error": "",
            "brand.completedAt": null,
            "brand.jobId": "",
            "brand.startedAt": new Date(),
          },
        },
        { new: true }
      );
      if (!sessionDoc) {
        log.done(404, { reason: "session_not_owned", session: requestedSessionId });
        return res.status(404).json({ error: "Not found" });
      }
      log.bind({ session: sessionDoc.sessionId }).info("session.reused");
    } else {
      sessionDoc = await OnboardingSession.create({
        userId,
        brand: { status: "queued", startedAt: new Date() },
        prompt,
        sourceUrls: safeUrls,
        attachments: attachmentMeta,
        idempotencyKey,
      });
      log.bind({ session: sessionDoc.sessionId }).info("session.created");
    }

    const sessionId = sessionDoc.sessionId;

    let acceptance;
    const upstreamStart = Date.now();
    try {
      log.ds("out", "onboarding/init");
      acceptance = await onboardingClient.initOnboarding({
        userId,
        sessionId,
        prompt,
        files,
        idempotencyKey,
      });
      log.bind({ job: acceptance.job_id }).info("upstream.accepted", {
        upstreamStatus: acceptance.status,
        ms: Date.now() - upstreamStart,
      });
    } catch (upstreamError) {
      log.error("upstream.failed", {
        code: upstreamError.code,
        ms: Date.now() - upstreamStart,
      });
      // The row already exists, so record why it went nowhere instead of
      // leaving it stuck on `queued` forever.
      await OnboardingSession.updateOne(
        { sessionId },
        { $set: { "brand.status": "failed", "brand.error": upstreamError.message || "init failed" } }
      ).catch(() => {});
      throw upstreamError;
    }

    // Upstream's answer stays authoritative. It should echo the id we sent; if
    // it mints its own instead, ours is wrong for every downstream call
    // (storyboards, templates, context reads) and the mismatch has to be
    // visible rather than silently wrong.
    if (acceptance.session_id && acceptance.session_id !== sessionId) {
      logger.error("[onboarding] upstream overrode our session_id", {
        sent: sessionId,
        received: acceptance.session_id,
      });
    }

    await OnboardingSession.updateOne(
      { sessionId },
      {
        $set: {
          "brand.jobId": acceptance.job_id,
          "brand.status": acceptance.status || "queued",
          "brand.lastSyncedAt": new Date(),
        },
      }
    );

    // The job row, written BEFORE anything else can reference this job_id.
    //
    // Order matters: Python's webhook rejects a callback for a job it cannot
    // find, so this row has to exist before the job could possibly report
    // progress. Awaited for that reason — a few milliseconds here buys the
    // guarantee that no callback ever arrives for an unknown id.
    //
    // Upsert because an idempotent replay returns the SAME job_id, and a second
    // insert would collide on the unique index.
    await AiJob.updateOne(
      { jobId: acceptance.job_id },
      {
        $set: {
          kind: "onboarding.init",
          userId,
          sessionId,
          idempotencyKey,
        },
        // Only on insert: a replay must not reset progress already recorded for
        // a job that has been running, or reported, since the first attempt.
        $setOnInsert: { status: acceptance.status || "queued", seq: 0 },
      },
      { upsert: true }
    );

    // Start the live channel: Python's SSE in, socket.io out to this user's
    // room. Deliberately NOT awaited — the stream runs for the length of the
    // job (~27s) and the user must have their ids immediately. The `.catch`
    // inside the bridge is what stops a detached failure from reaching the
    // process as an unhandled rejection.
    //
    // Skipped when the job is already finished: an idempotent replay returns a
    // terminal status, and there is nothing left to stream.
    if (acceptance.status !== "succeeded" && acceptance.status !== "failed") {
      startJobStreamBridge({
        jobId: acceptance.job_id,
        userId,
        sessionId,
      });
      log.info("bridge.started");
    } else {
      log.info("bridge.skipped", { reason: "already_terminal" });
    }

    // 202 for a fresh run. Upstream returns 200 when it replays an idempotent
    // retry, and that distinction is the client's cue that no new work started.
    const code = acceptance.status === "queued" ? 202 : 200;
    log.done(code, { replay: code === 200 });
    return res.status(code).json(acceptance);
  } catch (error) {
    const status = respondUpstreamError(res, error, "init");
    log.done(res.statusCode || 500, { reason: "exception" });
    return status;
  }
};

/**
 * GET /adsgpt/onboarding/jobs/:jobId
 *
 * The poll fallback and the refresh-recovery path. Not the primary progress
 * channel — that's the event stream below. Polling this on a timer alongside an
 * open stream just gives the UI two sources of truth that disagree.
 */
exports.getJob = async (req, res) => {
  /*
    #swagger.tags = ['Onboarding']
    #swagger.summary = 'Read an onboarding job snapshot'
    #swagger.security = [{ "BearerAuth": [] }]
  */
  try {
    const userId = req.user?.user_id;
    const { jobId } = req.params;

    const sessionDoc = await findOwnedByJob(jobId, userId);
    if (!sessionDoc) return res.status(404).json({ error: "Not found" });

    // Scoped here rather than at the top of the handler: the ids that make the
    // line worth reading are only known once ownership has been resolved.
    createFlowLog("jobs.read", { user: userId, job: jobId, session: sessionDoc.sessionId })
      .ds("out", "jobs");
    const snapshot = await onboardingClient.getJob(jobId);
    await syncMirrorFromSnapshot(sessionDoc, snapshot);

    return res.status(200).json(snapshot);
  } catch (error) {
    return respondUpstreamError(res, error, "job snapshot");
  }
};

/**
 * GET /adsgpt/onboarding/jobs/:jobId/events
 *
 * Proxies upstream's SSE stream byte-for-byte. The frames are not re-encoded:
 * event ids, retry hints and `Last-Event-ID` replay are protocol the browser
 * already understands, and re-emitting them by hand would only introduce ways
 * to get them wrong.
 *
 * Node does read the bytes as they pass, but only to notice the terminal
 * `done` frame and update the mirror. That observation cannot alter, delay or
 * drop what the browser receives.
 *
 * NOTE for the frontend: `EventSource` cannot send an Authorization header, and
 * this route is JWT-guarded. Use the fetch + ReadableStream approach already
 * used by `apis/aiAssistant/aiAssistantApi.js#streamChat`, which sets the
 * header and parses SSE by hand.
 */
exports.streamJobEvents = async (req, res) => {
  const userId = req.user?.user_id;
  const { jobId } = req.params;

  let sessionDoc;
  try {
    sessionDoc = await findOwnedByJob(jobId, userId);
    if (!sessionDoc) return res.status(404).json({ error: "Not found" });
  } catch (error) {
    logger.error("[onboarding] event stream ownership check failed", error);
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  }

  // A browser reconnecting sends the last id it saw; forwarding it is what
  // makes the stream resumable instead of replaying from the beginning.
  const lastEventId = String(req.headers["last-event-id"] || "").trim();

  let upstream;
  try {
    createFlowLog("jobs.stream", {
      user: userId,
      job: jobId,
      session: sessionDoc.sessionId,
    }).ds("out", "jobs/events");
    upstream = await onboardingClient.openJobEventStream(jobId, { lastEventId });
  } catch (error) {
    return respondUpstreamError(res, error, "job events");
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    // Without this nginx buffers the whole stream and delivers it at the end,
    // which turns live progress into a single burst after the job is over.
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders?.();

  // Rolling buffer, kept only long enough to spot a complete frame. Capped so a
  // stream that never emits a blank-line separator can't grow without bound.
  const MAX_BUFFER_BYTES = 1024 * 1024;
  let buffer = "";
  let synced = false;

  const observe = (chunk) => {
    if (synced) return;
    buffer += chunk.toString("utf8");
    if (buffer.length > MAX_BUFFER_BYTES) {
      buffer = buffer.slice(-MAX_BUFFER_BYTES);
    }

    // SSE frames are separated by a blank line. Keep the trailing partial.
    const frames = buffer.split(/\n\n/);
    buffer = frames.pop() || "";

    for (const frame of frames) {
      if (!/^event:\s*done\s*$/m.test(frame)) continue;
      const dataLine = frame.match(/^data:\s*(.*)$/m);
      if (!dataLine) continue;
      try {
        const snapshot = JSON.parse(dataLine[1]);
        synced = true;
        // Fire and forget: the browser's stream must not wait on our write.
        syncMirrorFromSnapshot(sessionDoc, snapshot);
      } catch {
        // A `done` frame we can't parse is upstream's problem to fix; the
        // browser still receives it untouched, and the next read backfills.
      }
    }
  };

  upstream.on("data", observe);
  upstream.on("error", (error) => {
    logger.error("[onboarding] upstream event stream errored", error);
    // The browser is mid-stream, so a status code is no longer available. An
    // SSE error frame is the only way left to say what happened.
    if (!res.writableEnded) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: "stream_interrupted" })}\n\n`);
      res.end();
    }
  });
  upstream.on("end", () => {
    if (!res.writableEnded) res.end();
  });

  // The leak this prevents: `timeout: 0` keeps the upstream connection open on
  // purpose, so a closed tab would otherwise hold a socket against upstream for
  // the life of the job.
  const closeUpstream = () => {
    upstream.off("data", observe);
    upstream.destroy?.();
  };
  req.on("close", closeUpstream);
  res.on("close", closeUpstream);

  upstream.pipe(res);
};

/**
 * GET /adsgpt/onboarding/context/:sessionId
 *
 * The persisted brand context — the source of truth after a refresh. Reads
 * through to upstream every time rather than serving the mirror, because the
 * mirror is a cache that is allowed to be stale and this is the screen where
 * being stale would show the user the wrong brand.
 */
exports.getContext = async (req, res) => {
  /*
    #swagger.tags = ['Onboarding']
    #swagger.summary = 'Read a session brand context'
    #swagger.security = [{ "BearerAuth": [] }]
  */
  try {
    const userId = req.user?.user_id;
    const { sessionId } = req.params;

    const sessionDoc = await findOwnedBySession(sessionId, userId);
    if (!sessionDoc) return res.status(404).json({ error: "Not found" });

    createFlowLog("context", { user: userId, session: sessionId }).ds("out", "context");
    const context = await onboardingClient.getContext(sessionId);

    // The lazy half of the sync strategy: if the tab was closed mid-run nothing
    // ever observed the `done` frame, and this read is the first chance to
    // learn the run finished.
    if (!TERMINAL_STATUSES.has(sessionDoc.brand?.status) && context?.context) {
      // Explicit hint: this snapshot is synthesised from the brand-context read
      // and carries no job id, so there is nothing for the lookup to resolve.
      await syncMirrorFromSnapshot(
        sessionDoc,
        { status: "succeeded", result: context },
        "onboarding.init"
      );
    }

    return res.status(200).json(context);
  } catch (error) {
    return respondUpstreamError(res, error, "context");
  }
};

/**
 * GET /adsgpt/onboarding/sessions
 *
 * Served entirely from the mirror — this is the one question upstream cannot
 * answer, since it has no idea what an AdsGPT user is. Returns the summary
 * fields a list view needs, not full contexts.
 */
exports.listSessions = async (req, res) => {
  /*
    #swagger.tags = ['Onboarding']
    #swagger.summary = 'List my onboarding sessions'
    #swagger.security = [{ "BearerAuth": [] }]
  */
  try {
    const userId = req.user?.user_id;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);

    const sessions = await OnboardingSession.find({ userId })
      .select(
        "sessionId brand.status brand.jobId brand.completedAt templates.status " +
          // `videos.status` answers the one question a list is actually asked
          // about module 4 — does this session have a clip to look at — without
          // paying for the boards map, which is per-tile detail no row shows.
          "storyboards.status videos.status brandName summary sourceUrls scraped createdAt"
      )
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    return res.status(200).json({
      // `_id` is how it is stored; `session_id` is what every other endpoint
      // and the upstream service call it. Renamed at the edge so storage
      // choices stay out of the API.
      // `_id` is our internal key and never leaves the building; `sessionId`
      // is the id the client and DS both speak.
      items: sessions.map(({ _id, sessionId, ...rest }) => ({ session_id: sessionId, ...rest })),
    });
  } catch (error) {
    logger.error("[onboarding] list sessions failed", error);
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  }
};

/**
 * Which screen a resumed session should open on.
 *
 * Derived from the session's own sections rather than remembered by the client,
 * because the client is exactly what we cannot rely on — a cleared browser, a
 * second device or a phone picked up mid-run all arrive with nothing, and the
 * whole point of `GET /eligibility` is that the server can still answer.
 *
 * Read in order of how far the run actually got, deepest first: a session with
 * a clip is past the workspace, and a session whose brand is still running is
 * not yet at one.
 */
function resumePhaseFor(session) {
  if (!session) return { phase: "setup" };

  // A clip that is rendering or rendered is the deepest screen, and the board
  // it belongs to is what the clip view needs to open at all.
  const boards = session.videos?.boards || {};
  for (const [boardId, entry] of Object.entries(boards)) {
    if (entry?.status === "running" || entry?.status === "succeeded") {
      return { phase: "clip", boardId };
    }
  }

  // Brand landed: the workspace can render, whatever the other rails are doing.
  if (session.brand?.status === "succeeded") return { phase: "workspace" };

  // Brand still in flight — the thinking screen owns the wait, and it needs the
  // job id to attach its stream to.
  if (session.brand?.status === "queued" || session.brand?.status === "running") {
    return { phase: "thinking" };
  }

  // Started and failed, or never started. Either way the form is the answer.
  return { phase: "setup" };
}

/**
 * GET /adsgpt/onboarding/eligibility
 *
 * The one call the app boot makes to decide three things at once: does this
 * user still have their free render, is onboarding finished with, and is there
 * a session they should be dropped back into.
 *
 * It exists because all three used to be answered from `localStorage`, which
 * cannot survive a cleared browser, a second device, or a phone opened
 * mid-run — precisely the cases `OnboardingSession` was built to cover (see
 * that module's header, reasons 2 and 3). The browser now remembers only
 * whether the banner was dismissed in this tab; every fact below is the
 * server's. See ONBOARDING_ENTRY_EXIT_CREDITS.md §4.
 */
exports.getEligibility = async (req, res) => {
  /*
    #swagger.tags = ['Onboarding']
    #swagger.summary = 'Free-render eligibility and where to resume'
    #swagger.security = [{ "BearerAuth": [] }]
  */
  try {
    const userId = req.user?.user_id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    // `.lean()` deliberately: a hydrated document would have Mongoose fill in
    // the schema default for `onboarding_offer_enrolled_at`, making every
    // profile that predates the field look enrolled. The raw shape is the only
    // one that can tell an old row from a new one.
    const profile = await UserProfile.findOne({ user_id: userId })
      .select(
        "onboarding_offer_enrolled_at onboarding_free_render_used_at " +
          "onboarding_completed_at onboarding_skipped_at"
      )
      .lean();

    // ── The enrolment gate ──────────────────────────────────────────────
    //
    // No enrolment stamp means this account predates onboarding. It gets
    // nothing: no offer bar, no first-run redirect, no free render — none of
    // which it was ever promised. This is what makes a backfill unnecessary;
    // absence of the field IS the answer for every existing user.
    //
    // A missing profile row lands here too, and should: we cannot claim a free
    // render against a document that does not exist, so promising one in the
    // response would be a promise the render path could not keep.
    if (!profile?.onboarding_offer_enrolled_at) {
      return res.status(200).json({
        freeRenderAvailable: false,
        onboardingCompleted: false,
        onboardingSkipped: false,
        resumeSessionId: null,
        resumeJobId: null,
        resumePhase: "setup",
        resumeBoardId: null,
        lastExitReason: "",
        // The one field that says WHY everything above is off. Without it the
        // client cannot tell "not eligible" from "already used it up".
        enrolled: false,
      });
    }

    const freeRenderAvailable = !profile?.onboarding_free_render_used_at;
    const onboardingCompleted = Boolean(profile?.onboarding_completed_at);
    // Distinct from completed, and the first-run redirect needs both: a user
    // who walked out of onboarding deliberately has answered the question, and
    // sending them back in on the next login would be the app arguing with
    // them. The banner is how they return, on their terms.
    const onboardingSkipped = Boolean(profile?.onboarding_skipped_at);

    // The newest session is the resume target. Not the newest UNFINISHED one:
    // a completed run is still the right thing to reopen if the user comes
    // back, and `onboardingCompleted` above is what stops us pushing them
    // there uninvited.
    const session = await OnboardingSession.findOne({ userId })
      .select("sessionId brand.status brand.jobId videos.boards exitReason")
      .sort({ createdAt: -1 })
      .lean();

    const resume = resumePhaseFor(session);

    return res.status(200).json({
      enrolled: true,
      freeRenderAvailable,
      onboardingCompleted,
      onboardingSkipped,
      resumeSessionId: session?.sessionId || null,
      // Only meaningful while the brand job is still in flight; the thinking
      // screen attaches its stream to this.
      resumeJobId: session?.brand?.jobId || null,
      resumePhase: resume.phase,
      // Present only for `clip`, which cannot render without knowing which
      // concept it is showing.
      resumeBoardId: resume.boardId || null,
      // How the last run ended, if it ended deliberately. "skipped" is what
      // tells the client this is a resume rather than a fresh start.
      lastExitReason: session?.exitReason || "",
    });
  } catch (error) {
    logger.error("[onboarding] eligibility failed", { message: error.message });
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  }
};

/**
 * PATCH /adsgpt/onboarding/sessions/:sessionId   { exit: "completed" | "skipped" }
 *
 * Records that the user left onboarding on purpose, by either door.
 *
 * The two doors differ in exactly one consequence: "completed" retires the
 * banner permanently, "skipped" leaves it up so an unspent free render is still
 * reachable — and clicking it comes back to THIS session rather than starting a
 * new one. Neither ever forces the user through onboarding again.
 *
 * No credit work happens here. Skip is only reachable before a generate, and a
 * generate is the only thing that opens a reservation; a user who leaves with a
 * render in flight keeps it, because the clip still lands and the webhook still
 * settles. See ONBOARDING_ENTRY_EXIT_CREDITS.md §5.3.
 */
exports.exitSession = async (req, res) => {
  /*
    #swagger.tags = ['Onboarding']
    #swagger.summary = 'Record that the user finished or skipped onboarding'
    #swagger.security = [{ "BearerAuth": [] }]
  */
  try {
    const userId = req.user?.user_id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const { sessionId } = req.params;
    const exit = String(req.body?.exit || "").trim();
    if (exit !== "completed" && exit !== "skipped") {
      return res.status(400).json({ error: "exit must be 'completed' or 'skipped'" });
    }

    // Scoped by userId, like every other read in this controller: the session
    // id is the only thing the client sends, and it must never be enough on its
    // own to write to someone else's run.
    const updated = await OnboardingSession.findOneAndUpdate(
      { sessionId, userId },
      { $set: { exitedAt: new Date(), exitReason: exit } },
      { new: true }
    )
      .select("sessionId exitReason")
      .lean();

    if (!updated) return res.status(404).json({ error: "Session not found" });

    // The per-user half. `completed` is sticky — once a user has finished
    // onboarding, a later skip of some other run must not un-finish it — so it
    // is only ever set, never cleared here.
    const profileSet =
      exit === "completed"
        ? { onboarding_completed_at: new Date() }
        : { onboarding_skipped_at: new Date() };

    await UserProfile.updateOne({ user_id: userId }, { $set: profileSet });

    return res.status(200).json({ ok: true, exitReason: updated.exitReason });
  } catch (error) {
    logger.error("[onboarding] exitSession failed", { message: error.message });
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  }
};

// Media URL resolution moved to services/onboarding/mediaUrls.js so the socket
// emit in the job webhook can produce the exact same shape this read does.
/**
 * GET /adsgpt/onboarding/sessions/:sessionId
 *
 * The whole session in one read: brand, templates, storyboards, videos, each
 * with its own status and result. This is what the workspace renders from.
 *
 * Existing reads could not serve it — `/context/:sessionId` proxies upstream and
 * returns the brand context ALONE, so templates and storyboards were invisible
 * to the client even though both had completed and been stored.
 *
 * Served from our own document, not proxied: every section was already written
 * by the webhook, and a workspace that repaints on every tab focus should not
 * cost an upstream round trip.
 */
exports.getSession = async (req, res) => {
  /*
    #swagger.tags = ['Onboarding']
    #swagger.summary = 'Read one onboarding session with every module section'
    #swagger.security = [{ "BearerAuth": [] }]
  */
  try {
    const userId = req.user?.user_id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const { sessionId } = req.params;
    const doc = await findOwnedBySession(sessionId, userId);
    // Ownership is enforced by querying with userId, so another user's session
    // is indistinguishable from one that does not exist.
    if (!doc) return res.status(404).json({ error: "Not found" });

    const session = doc.toObject ? doc.toObject() : doc;

    return res.status(200).json({
      session_id: session.sessionId,
      created_at: session.createdAt,
      updated_at: session.updatedAt,
      prompt: session.prompt,
      source_urls: session.sourceUrls || [],
      brand_name: session.brandName || "",
      summary: session.summary || "",
      citations: session.citations || [],
      scraped: session.scraped,
      brand: session.brand || {},
      templates: {
        ...(session.templates || {}),
        result: resolveTemplateMedia(session.templates?.result),
      },
      storyboards: {
        ...(session.storyboards || {}),
        result: resolveStoryboardMedia(session.storyboards?.result),
      },
      // Clips carry the same root-relative links keyframes do, and the socket
      // emit already resolves them — a read that did not would hand the player
      // a `src` of "/creatives/…mp4" against OUR origin, which is nothing.
      // `videos` stores one key per board rather than a shared array, so the
      // clips two simultaneous renders produce cannot overwrite each other.
      // The list the contract describes is assembled here, and resolved the
      // same way the socket emit resolves it — a read that skipped that would
      // hand the player a `src` of "/creatives/…mp4" against OUR origin, which
      // is nothing.
      videos: {
        ...(session.videos || {}),
        result: resolveVideoMedia(videosResultFromBoards(session.videos?.boards)),
      },
    });
  } catch (error) {
    logger.error("[onboarding] getSession failed", error);
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  }
};

/**
 * POST /onboarding/sessions/:sessionId/templates
 *
 * The next page of template recommendations.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 * Template matching is triggered exactly once, automatically, when the brand
 * context lands — five results, `skip=0`, and no way to ask for a sixth. This
 * is that way: it moves the cursor along and fires the same trigger again. The
 * page lands through the normal webhook and is FOLDED into the stored list, so
 * the client ends up with fifteen templates rather than the last five.
 *
 * Fire-and-forget, like the automatic trigger it reuses: upstream issues no job
 * id for this work, so there is nothing to poll and nothing to return except
 * "accepted". The result arrives over the socket the workspace already listens
 * on.
 */
exports.loadMoreTemplates = async (req, res) => {
  /*
    #swagger.tags = ['Onboarding']
    #swagger.summary = 'Request the next page of template recommendations'
    #swagger.security = [{ "BearerAuth": [] }]
  */
  try {
    const userId = req.user?.user_id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const { sessionId } = req.params;
    const session = await findOwnedBySession(sessionId, userId);
    // Ownership is enforced by querying with userId, so another user's session
    // is indistinguishable from one that does not exist.
    if (!session) return res.status(404).json({ error: "Not found" });

    const templates = session.templates || {};
    const pagination = templates.pagination || {};
    const loaded = Number(pagination.loaded) || 0;

    // A page already in flight. Answering 202 again would put a second `queued`
    // on a section that is already running and leave the client waiting on two
    // callbacks for one page.
    if (["queued", "running"].includes(templates.status)) {
      return res.status(202).json({ accepted: false, reason: "already_loading", loaded });
    }

    if (pagination.exhausted) {
      return res.status(200).json({ accepted: false, reason: "exhausted", loaded });
    }

    // The cursor, and the contract's reach — see `nextPage`. It answers
    // `exhausted` when the widest legal window is entirely inside what we
    // already hold, which is cheaper than calling upstream to be handed a page
    // of pure duplicates.
    const { skip, limit, exhausted } = nextPage(loaded, req.body?.limit || DEFAULT_TEMPLATE_PAGE);
    if (exhausted) {
      return res.status(200).json({ accepted: false, reason: "exhausted", loaded });
    }

    // Never awaited: upstream holds the connection until it has accepted, and
    // the caller only needs to know we started.
    startTemplateRun({ userId, sessionId, limit, skip })
      .then((ok) =>
        logger.debug("[onboarding] templates.page requested", { sessionId, skip, limit, accepted: ok })
      )
      .catch((e) => logger.error("[onboarding] templates.page failed", { sessionId, message: e.message }));

    return res.status(202).json({ accepted: true, skip, limit, loaded });
  } catch (error) {
    logger.error("[onboarding] loadMoreTemplates failed", { message: error.message });
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  }
};

/**
 * POST /adsgpt/onboarding/sessions/:sessionId/videos   { boardId }
 *
 * Renders ONE storyboard concept into a clip. Answers as soon as upstream has
 * accepted; everything after that arrives on the socket, and is recoverable
 * from `GET /sessions/:sessionId` if the socket is not there to carry it.
 *
 * Every refusal is a 200/202 with a `reason` rather than an error status. The
 * caller is one tile on a page of tiles: "this one is already rendering" is
 * information for that tile, not a failed request.
 */
exports.generateVideo = async (req, res) => {
  /*
    #swagger.tags = ['Onboarding']
    #swagger.summary = 'Render one storyboard concept into a video clip'
    #swagger.security = [{ "BearerAuth": [] }]
  */
  try {
    const userId = req.user?.user_id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const { sessionId } = req.params;
    const boardId = String(req.body?.boardId || "").trim();
    if (!boardId) return res.status(400).json({ error: "boardId is required" });

    // Ownership is enforced inside `startVideoRun`, by querying the session
    // with this userId — the same rule the rest of this controller follows, and
    // the reason Python's unverified `user_id` never becomes an authorization
    // decision.
    const result = await startVideoRun({ userId, sessionId, boardId });

    if (!result.ok) {
      // Payment refusals are their own answers, not generic failures: the
      // client shows a plan prompt for one and a top-up prompt for the other,
      // and both need a status it can branch on without parsing prose.
      if (result.reason === "NO_BASE_PLAN") {
        return res.status(403).json({
          accepted: false,
          reason: result.reason,
          error: "An active subscription plan is required to generate video.",
        });
      }
      if (result.reason === "INSUFFICIENT") {
        return res.status(402).json({
          accepted: false,
          reason: result.reason,
          error: "You don't have enough credits for this render.",
        });
      }

      const status =
        result.reason === "not_found" || result.reason === "unknown_board"
          ? 404
          : result.reason === "bad_request"
            ? 400
            : result.reason === "not_configured"
              ? 501
              : result.reason === "upstream_error"
                ? 502
                : 200;
      return res.status(status).json({ accepted: false, reason: result.reason, jobId: result.jobId });
    }

    return res.status(202).json({ accepted: true, jobId: result.jobId, boardId });
  } catch (error) {
    logger.error("[onboarding] generateVideo failed", { message: error.message });
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  }
};

/**
 * POST /adsgpt/onboarding/sessions/:sessionId/loader   { boardId }
 *
 * Builds the blurred placeholder GIF for one board's render. Separate from the
 * render itself on purpose: it is optional decoration with a ten-minute life,
 * and a failure here must never stop or delay a clip.
 *
 * The client sends only a `boardId`. The images fed to the generator are the
 * keyframes we already stored for that board — see the note in `loaderClient`
 * on why a caller must not get to choose URLs a server will fetch.
 */
exports.buildLoader = async (req, res) => {
  /*
    #swagger.tags = ['Onboarding']
    #swagger.summary = 'Build the placeholder loader GIF for one concept'
    #swagger.security = [{ "BearerAuth": [] }]
  */
  try {
    const userId = req.user?.user_id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const { sessionId } = req.params;
    const boardId = String(req.body?.boardId || "").trim();
    if (!boardId) return res.status(400).json({ error: "boardId is required" });

    const result = await buildBoardLoader({ userId, sessionId, boardId });

    // `no_images` and every upstream failure answer 200 with `ok: false`. The
    // client's response to all of them is identical — keep its own shimmer —
    // and an error status would put a red line in the console for a screen that
    // is working exactly as designed.
    if (!result.ok) return res.status(200).json({ ok: false, reason: result.reason });

    return res.status(200).json({ ok: true, loader: result.loader });
  } catch (error) {
    logger.error("[onboarding] buildLoader failed", { message: error.message });
    return res.status(200).json({ ok: false, reason: "error" });
  }
};

exports._internals = { syncMirrorFromSnapshot, TERMINAL_STATUSES, absolutise };
