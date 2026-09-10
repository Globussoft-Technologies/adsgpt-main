/**
 * AI job webhook — Python's callback, and the browser's read of what it wrote.
 *
 * One endpoint receives state changes for every module. Which module a job
 * belongs to is something WE recorded when we started it — the callback does
 * not tell us, and could not be trusted to. Nothing else about the handling
 * differs per module, which is the entire reason there is one callback URL and
 * not five.
 *
 * Delivery is assumed to be AT-LEAST-ONCE. Python retries on a non-2xx, so the
 * same event will sometimes arrive twice and a retried event can land after a
 * newer one. Both are handled by a single rule:
 *
 *     a write only applies if it carries a HIGHER `seq` than the stored one
 *
 * Enforced in the query filter, not in JavaScript, so two simultaneous
 * deliveries cannot both read "seq 4" and both decide to write. Whoever loses
 * the race matches zero documents and becomes a no-op.
 *
 * Terminal events are the exception worth stating plainly: they are the only
 * ones that carry `result`, they are the only ones that can fire the chain,
 * and losing one is unrecoverable through this path. That is why `x-secret-key`
 * failures and unknown job ids are logged loudly rather than quietly 404'd.
 */

const AiJob = require("../../Module/ai/aiJob");
const { TERMINAL_STATUSES } = AiJob;
const { mirrorJobResult, readSection } = require("../../services/onboarding/sessionMirror");

// How many templates the automatic first pass asks for: the contract's maximum.
//
// ── Why the maximum, rather than a page ─────────────────────────────────────
// Because there is nothing behind it. Upstream's candidate pool is TWENTY, and
// that is a hard wall rather than a property of any one brand — realme, Nike
// and ROG all stop at exactly 20. Asking for ten and paging for the rest meant
// three round trips (skip 0, 10, then 15) that between them discovered the same
// twenty rows the first call could have returned on its own; the third came
// back with five and set `exhausted`.
//
// The paging machinery below stays exactly as it is. It costs nothing when the
// first answer is already complete — `nextPage` reports `exhausted` immediately
// — and it is what will pick up the extra rows the day DS raises the pool.
//
// ⚠ This value is part of upstream's cache key `(user, session, kind, limit,
// skip, threshold)`, and `POST /api/v1/storyboards/` pulls its inspiration
// through that same cache. At the shared default the two calls converged on one
// corpus match; naming a limit here means the storyboard's own pull can miss
// this entry and compute its own. Worth confirming with DS — the cost is a
// second match per session, not a wrong result.
const FIRST_TEMPLATE_PAGE = 20;
const OnboardingSession = require("../../Module/onboarding/onboardingSession");
const logger = require("../../utils/logger");
const { createFlowLog } = require("../../utils/flowLog");
const { startTemplateRun, RETRY_THRESHOLD } = require("../../services/onboarding/templateBridge");
const { startStoryboardRun } = require("../../services/onboarding/storyboardClient");
const { handleStoryboardResult } = require("../../services/onboarding/keyframeRecovery");
const { fileSessionClips } = require("../../services/onboarding/mySpaceClip");
const { fileBrandToBrandIQ } = require("../../services/onboarding/brandIQEntry");

/**
 * Kinds whose callbacks FOLD into a section instead of replacing it.
 *
 * Both of them break the same assumption — that one job owns one section — and
 * they break it in the same two places, which is why they share a predicate
 * rather than each being spelled out:
 *
 *   template.recommend  one callback = one PAGE of recommendations
 *   video.generate      one callback = one BOARD's clip
 *
 * Two consequences follow for anything on this list. A callback arriving at a
 * section that is already `succeeded` is NORMAL, not a duplicate, so the
 * terminal guard must not refuse it — idempotency comes from the mirror's
 * de-duplicating merge instead. And the value worth emitting is the MERGED
 * collection, not the fragment that just landed, so the emit waits for the
 * mirror to run.
 */
const FOLDED_KINDS = new Set(["template.recommend", "video.generate"]);
const isFoldedKind = (kind) => FOLDED_KINDS.has(String(kind || ""));
const { resolveResultMedia } = require("../../services/onboarding/mediaUrls");

// The socket event every client already listens on. Emitting here means a job
// updated by webhook looks identical to one updated by the live SSE bridge —
// the frontend cannot tell which path delivered it, and does not need to.
const JOB_EVENT = "aiJobUpdate";

function emitToUser(userId, payload) {
  try {
    if (!global.io || !userId) return;
    global.io.to(userId).emit(JOB_EVENT, payload);
  } catch (error) {
    // A socket failure must never fail the webhook. Python would retry a 500,
    // and we would re-run this handler for an update we had already stored.
    logger.error("[jobWebhook] emit failed", { message: error.message });
  }
}

/**
 * A one-line census of a terminal payload.
 *
 * Logged on every finished job because "hasResult=true" answered the wrong
 * question. What matters when a brand renders badly is which fields upstream
 * actually filled: `logo_urls` is null on a prompt-only run and populated on a
 * scraped one, `citations` is 18 or 0, `industry_major` exists on new runs and
 * not on old ones. This line is what makes that visible without reproducing.
 */
function describeResult(result) {
  if (!result || typeof result !== "object") return { result: "none" };
  const ctx = result.context || {};
  const len = (v) => (Array.isArray(v) ? v.length : v == null ? "null" : "?");

  return {
    brand: ctx.brand_name || "-",
    category: ctx.category || "-",
    scraped: result.scraped,
    // Field census: array lengths, or the literal `null` upstream sent. The
    // difference between 0 and null is the difference between "looked and found
    // nothing" and "never looked".
    ctxKeys: Object.keys(ctx).length,
    logos: len(ctx.logo_urls),
    images: len(ctx.image_urls),
    colors: len(ctx.color_palette),
    audience: len(ctx.target_audience),
    products: len(ctx.key_products),
    voice: len(ctx.brand_voice),
    dos: len(ctx.dos),
    donts: len(ctx.donts),
    diffs: len(ctx.differentiators),
    sources: len(result.source_urls),
    citations: len(result.citations),
    queries: len(result.search_queries),
    related: len(result.related_sessions),
    industry: ctx.industry_major ? "yes" : "absent",
    objective: ctx.primary_objective ? "yes" : "empty",
    bytes: JSON.stringify(result).length,
  };
}

/**
 * Follow-on work, started the moment onboarding succeeds.
 *
 * Two runs, fired together and independently:
 *
 *   templates    GET /onboarding/recommend-templates — not a job at all. Node
 *                triggers it and hangs up; upstream calls back with
 *                session_id + kind and no job_id.
 *   storyboards  POST /storyboards/ — a real job that reports back the same way
 *                onboarding does.
 *
 * SERVER-SIDE ON PURPOSE. The browser is not asked to kick these off, so they
 * happen whether or not the user is still looking at the tab — close it mid-run
 * and the workspace is warm when they come back.
 *
 * Called AT MOST ONCE per job: `chainedAt` is written in the same atomic update
 * that marks the job succeeded, so a duplicate terminal callback (which is
 * normal, delivery being at-least-once) cannot fire a second pair and bill the
 * user twice.
 *
 * Neither failure is allowed to matter here. The brand profile is already saved
 * and correct; a rail that will not start is a retry button, not an invalidated
 * onboarding.
 */
async function runChain(job) {
  const log = createFlowLog("jobs.chain", { job: job.jobId, session: job.sessionId, user: job.userId });

  if (job.kind !== "onboarding.init") return;
  if (!job.sessionId) {
    log.warn("skipped", { reason: "no_session" });
    return;
  }

  log.info("firing");

  // Deliberately not awaited together with Promise.all: one rejecting must not
  // prevent the other from starting.
  startTemplateRun({ userId: job.userId, sessionId: job.sessionId, limit: FIRST_TEMPLATE_PAGE })
    .then((ok) => log.info("templates.started", { accepted: ok }))
    .catch((e) => log.error("templates.failed", { message: e.message }));

  startStoryboardRun({ userId: job.userId, sessionId: job.sessionId, parentJobId: job.jobId })
    .then((id) => log.info("storyboards.started", { child: id ? String(id).slice(0, 8) : "skipped" }))
    .catch((e) => log.error("storyboards.failed", { message: e.message }));
}

/**
 * One retry for a template match that ERRORED.
 *
 * Two failures wear the same status here and only one of them is worth
 * retrying:
 *
 *   failed / error        the match never ran        -> retry
 *   succeeded, zero items the match ran, found none  -> that IS the answer
 *
 * Retrying the second is how a brand that genuinely has no matching templates
 * gets asked about for ever. So the empty case is left alone entirely, and the
 * rail simply does not render (see ONBOARDING_FAILURE_HANDLING.md §1.3).
 *
 * The retry cannot be a plain re-hit. Upstream caches on
 * `(user, session, kind, limit, skip, threshold)` — a fresh idempotency key
 * does not enter into it — so identical params return the identical cached
 * failure. Lowering the threshold both misses that cache and widens the match,
 * which is the right direction for a run that produced nothing.
 *
 * `templates.retry.attempted` is what bounds it: the retry's own callback
 * arrives here too, and without the flag a permanently failing match would
 * retry for ever. It lives on the session because that callback may reach a
 * different instance than the one that started the run.
 */
async function retryTemplatesOnce({ sessionId, userId, log }) {
  // Claim the one retry atomically. Two callbacks for the same session — a
  // redelivery, or two pages failing together — must not both fire one.
  const claimed = await OnboardingSession.findOneAndUpdate(
    { sessionId, "templates.retry.attempted": { $ne: true } },
    {
      $set: {
        "templates.retry.attempted": true,
        "templates.retry.at": new Date(),
        "templates.retry.threshold": RETRY_THRESHOLD,
      },
    },
    { new: true }
  )
    .select("sessionId")
    .lean();

  if (!claimed) {
    log.info("templates.retry.skipped", { reason: "already_attempted" });
    return;
  }

  log.info("templates.retry.firing", { threshold: RETRY_THRESHOLD });

  // Fire-and-forget, like the first run: the result comes back on the webhook,
  // and this handler owes Python a fast answer.
  startTemplateRun({
    userId,
    sessionId,
    limit: FIRST_TEMPLATE_PAGE,
    threshold: RETRY_THRESHOLD,
  })
    .then((ok) => log.info("templates.retry.started", { accepted: ok }))
    .catch((e) => log.error("templates.retry.failed", { message: e.message }));
}

/**
 * Copies a finished job's result into its module's section on the session.
 *
 * Deliberately kind-agnostic: `sessionMirror` maps kind → section, so a new
 * module is a line in that map rather than a branch here. This is what lets one
 * callback URL serve every module.
 */
async function mirrorToSession(job, result) {
  if (!job.sessionId) return;
  await mirrorJobResult(job.sessionId, job.kind, {
    status: job.status,
    jobId: job.jobId,
    result,
    error: job.error,
    completedAt: job.completedAt,
  });
}

/**
 * Creates the job row for work upstream started on its own.
 *
 * Two kinds arrive this way — `template.recommend` and
 * `storyboard.images.generate`. Node triggers both without receiving an id, so
 * upstream mints one and the first callback is where we learn it. `session_id`
 * is what makes that safe: it resolves to a session we created, which is where
 * the owner comes from.
 *
 * Returns the new row, or `null` when there is nothing to attach it to — an
 * unknown session, a missing one, or a `kind` we have no section for. In every
 * one of those cases the right answer is to reject rather than invent an
 * ownerless row that no authorization check could ever apply to.
 */
async function adoptForeignJob({ jobId, body, log }) {
  const sessionId = body.session_id;
  const kind = body.kind;

  if (!sessionId || !kind) return null;
  if (!AiJob.JOB_KINDS.includes(kind)) {
    log.error("adopt.unknown_kind", { kind });
    return null;
  }

  const session = await OnboardingSession.findOne({ sessionId }).select("userId").lean();
  if (!session) {
    log.error("adopt.unknown_session", { session: sessionId });
    return null;
  }

  // Upsert rather than create: two callbacks for the same new job can land
  // together, and both would otherwise try to insert the same unique jobId.
  await AiJob.updateOne(
    { jobId },
    {
      $set: { kind, userId: session.userId, sessionId },
      $setOnInsert: { status: "queued", seq: 0 },
    },
    { upsert: true }
  );

  log.info("adopted", { kind, session: sessionId, user: session.userId });
  return AiJob.findOne({ jobId });
}

/**
 * Callback for work with no job id at all.
 *
 * Kept as a tolerant path rather than a documented one: upstream sends a
 * `job_id` on every callback today. If one ever arrives without, `session_id` +
 * `kind` is still enough to route it, and dropping a terminal result on a
 * technicality would be the worse failure.
 */
async function receiveSessionless(res, body, log) {
  const { session_id: sessionId, kind, status, result, error } = body;

  if (!sessionId || !kind) {
    log.done(400, { reason: "no_job_no_session" });
    return res.status(400).json({
      error: "job_id is required, or session_id + kind for work that has no job",
    });
  }

  const section = OnboardingSession.sectionForKind(kind);
  if (!section) {
    log.done(400, { reason: "unknown_kind", kind });
    return res.status(400).json({ error: `unknown kind: ${kind}` });
  }

  const finalStatus = status || (error ? "failed" : "succeeded");

  // There is no `seq` on this shape, so the section's own state is what makes a
  // redelivery safe. A run that has already finished is not re-applied: without
  // this, two deliveries of the same callback would both write, and a retry
  // carrying an older body would silently replace a newer one.
  const current = await OnboardingSession.findOne({ sessionId })
    .select(`userId ${section}.status`)
    .lean();
  if (!current) {
    log.done(404, { reason: "unknown_session", session: sessionId });
    return res.status(404).json({ error: `no session with id ${sessionId}` });
  }
  // Some sections can legitimately be written again after they have finished —
  // see FOLDED_KINDS. A template "load more" page, and each concept a user
  // renders into a clip, both land on a section that is already `succeeded`.
  // Refusing those here is what made paging impossible, and would make
  // per-board video renders impossible in exactly the same way.
  //
  // Redeliveries stay safe without this guard because the mirror de-duplicates:
  // pages by `template_id`, clips by `board_id`. A replayed payload is one whose
  // ids are all already stored, and merging it changes nothing.
  const isPaged = isFoldedKind(kind);
  if (!isPaged && TERMINAL_STATUSES.has(current[section]?.status)) {
    log.info("sessionless.duplicate", { session: sessionId, kind, stored: current[section].status });
    log.done(200, { duplicate: true });
    return res.status(200).json({ ok: true, duplicate: true });
  }

  // DS calling US. One line, the session, and which kind of work it is about —
  // the payload itself goes to the tape, not here.
  log.ds("in", kind, { session: sessionId, status: finalStatus });
  log.info("sessionless", { session: sessionId, kind, status: finalStatus, ...describeResult(result) });

  const written = await mirrorJobResult(sessionId, kind, {
    status: finalStatus,
    result,
    error,
    completedAt: new Date(),
  });

  // The client gets the WHOLE list, not the page that just landed. Emitting the
  // raw page would replace a merged list of fifteen with the five that arrived.
  const merged = isPaged ? (await readSection(sessionId, kind))?.result : undefined;

  // Same event name and shape the job path emits, so the client cannot tell —
  // and does not need to tell — which kind of callback delivered this.
  emitToUser(current.userId, {
    session_id: sessionId,
    kind,
    event: "done",
    status: finalStatus,
    // Resolved, not raw. `GET /sessions/:id` absolutises every image path
    // before it answers; an emit that skipped that step delivered frames with
    // no `src`, which the workspace renders as empty boxes — and the only cure
    // was a reload, i.e. one more read through the path that DOES resolve.
    result: resolveResultMedia(kind, merged !== undefined ? merged : result),
    error: error || undefined,
  });

  // A template match that ERRORED gets exactly one more go, at a lower
  // threshold. Deliberately after the write and after the emit: the client has
  // already been told this attempt failed, and the retry's own callback will
  // repaint the rail if it lands anything. An empty-but-successful result is
  // NOT retried — see `retryTemplatesOnce`.
  if (kind === "template.recommend" && finalStatus === "failed") {
    await retryTemplatesOnce({ sessionId, userId: current.userId, log }).catch((e) =>
      log.error("templates.retry.error", { message: e.message })
    );
  }

  log.done(200, { written });
  return res.status(200).json({ ok: true, duplicate: !written });
}

/**
 * POST /adsgpt/internal/jobs/callback
 *
 * Guarded by `verifySecretKey` at the route. Always answers quickly: Python is
 * holding a connection open and will retry anything that is not a 2xx, so slow
 * work here turns into duplicate deliveries.
 */
exports.receive = async (req, res) => {
  const body = req.body || {};
  const { job_id: jobId, seq, status, progress, result, error } = body;
  const log = createFlowLog("jobs.callback", { job: jobId });

  // ── Sessionless callbacks ────────────────────────────────────────────────
  //
  // Not every piece of upstream work is a job. Template recommendations are a
  // cached READ keyed on the session — upstream issues no job id for them, and
  // inventing one locally bought nothing, because the callback could never
  // carry an id we had minted on our own side.
  //
  // For that shape `session_id` + `kind` is the whole address: the session is
  // the owner, and `kind` says which section the result belongs in. There is no
  // `seq` either, and none is needed — one terminal callback per run, and a
  // duplicate delivery is absorbed by the mirror's terminal guard rather than
  // by sequence numbers.
  if (!jobId) {
    return receiveSessionless(res, body, log);
  }
  if (typeof jobId !== "string") {
    log.done(400, { reason: "bad_job_id" });
    return res.status(400).json({ error: "job_id must be a string" });
  }
  const seqNum = Number(seq);
  if (!Number.isFinite(seqNum)) {
    // Logged at error, not warn: this is the single most likely integration
    // bug, and a terminal callback arriving without a seq means a finished job
    // hangs in the UI forever. It should be impossible to miss in the logs.
    log.error("rejected.no_seq", { status, seq: String(seq) });
    log.done(400, { reason: "no_seq" });
    // Without a seq we cannot order or deduplicate, and a terminal event with
    // no seq would be invisible to `?since=`. Rejecting is louder than
    // guessing, and this is the single most important thing to catch early.
    return res.status(400).json({ error: "seq is required and must be a number" });
  }
  if (status && !AiJob.JOB_STATUSES.includes(status)) {
    log.done(400, { reason: "unknown_status", status });
    return res.status(400).json({ error: `unknown status: ${status}` });
  }

  // DS calling US, on the job-shaped callback. The kind is not known here —
  // it is read from our own AiJob row further down — and looking it up early
  // just to decorate a log line would add a query to every progress frame.
  // `job` is enough: the job id is already on every line of this scope.
  log.ds("in", "job", { status });
  log.info("received", { seq: seqNum, status, stage: progress?.stage, hasResult: Boolean(result) });

  try {
    let job = await AiJob.findOne({ jobId });
    if (!job) {
      // Not every job is one we started. Upstream mints its own ids for
      // `template.recommend` and `storyboard.images.generate` — we trigger that
      // work without being handed an id — so for those the FIRST callback is
      // what creates the row, and it carries `session_id` so we can.
      //
      // `user_id` is on the payload too, and we deliberately do not use it. The
      // session already knows its owner, and an owner read from an inbound body
      // is an authorization decision made by the caller. Same id in practice,
      // but ours comes from a record we wrote.
      job = await adoptForeignJob({ jobId, body, log });

      if (!job) {
        // No session to attach it to. Now it really is an id from nowhere.
        log.done(404, { reason: "unknown_job" });
        return res.status(404).json({
          error: `no job with id ${jobId}, and no session_id on the callback to create one from. `
            + `Jobs we start are recorded before the id is handed out; for jobs you mint, `
            + `send session_id on the first callback.`,
        });
      }
    }

    // `kind` in the body is NOT how we learn what this job is — we set that
    // when we started it, and ours is authoritative. It is accepted purely as a
    // checksum: if upstream thinks this job_id is a storyboard and we recorded
    // an onboarding, one of us is confused about which job this is, and writing
    // the payload anyway would put a storyboard result on a brand profile.
    // Cheaper to reject and find out. Optional, because a caller that omits it
    // is not wrong — it just gets no cross-check.
    if (body.kind && body.kind !== job.kind) {
      log.error("kind.mismatch", { stored: job.kind, received: body.kind });
      log.done(400, { reason: "kind_mismatch" });
      return res.status(400).json({
        error: `kind mismatch: this job is ${job.kind}, callback said ${body.kind}`,
      });
    }

    const isTerminal = TERMINAL_STATUSES.has(status);

    const update = { seq: seqNum };
    if (status) update.status = status;
    if (progress && typeof progress === "object") {
      if (progress.stage) update.stage = String(progress.stage);
      if (progress.message) update.message = String(progress.message);
      if (typeof progress.percent === "number") {
        // Never let a late-arriving event drag the bar backwards.
        update.percent = Math.max(job.percent || 0, progress.percent);
      }
    }
    if (result !== undefined && result !== null) update.result = result;
    if (error) update.error = String(error);
    if (isTerminal) {
      update.completedAt = new Date();
      // The terminal callback carries no `progress`, so without this the bar
      // keeps whatever the last progress event set — a succeeded job was
      // reading 80%.
      if (status === "succeeded") update.percent = 100;
      // Set together with the status, in one update, so a concurrent duplicate
      // cannot also see chainedAt unset. This is the whole double-fire guard.
      if (status === "succeeded" && !job.chainedAt) update.chainedAt = new Date();
    }

    // The conditional write. `seq: { $lt: seqNum }` is what makes duplicate and
    // out-of-order delivery free: a stale event matches nothing.
    const applied = await AiJob.findOneAndUpdate(
      { jobId, seq: { $lt: seqNum } },
      { $set: update },
      { new: true }
    );

    if (!applied) {
      // Already seen this or something newer. Still a success as far as Python
      // is concerned — a 4xx or 5xx here would make it retry forever.
      log.info("duplicate", { incoming: seqNum, stored: job.seq });
      log.done(200, { duplicate: true });
      return res.status(200).json({ ok: true, duplicate: true, seq: job.seq });
    }

    log.info("applied", { seq: applied.seq, status: applied.status, percent: applied.percent });

    // Built once, sent at one of two moments. A paged kind — templates — has to
    // wait for the mirror, because the value worth sending is the FOLDED list
    // and that does not exist until the page has been folded in. Everything
    // else emits immediately, as it always has: the sooner the client hears
    // about a storyboard, the sooner it paints.
    const emitDone = (payloadResult) =>
      emitToUser(applied.userId, {
        job_id: applied.jobId,
        session_id: applied.sessionId,
        kind: applied.kind,
        event: isTerminal ? "done" : "progress",
        seq: applied.seq,
        status: applied.status,
        data: isTerminal
          ? undefined
          : { stage: applied.stage, message: applied.message, percent: applied.percent },
        // Same resolution the session read performs — see the note on the
        // sessionless emit above. Without it a live storyboard result arrives
        // with root-relative image paths and paints nothing.
        result: isTerminal ? resolveResultMedia(applied.kind, payloadResult) : undefined,
        error: applied.error || undefined,
      });

    const isPagedKind = isFoldedKind(applied.kind);
    // A keyframe result that is missing frames is HELD — see `keyframeRecovery`.
    // The decision needs the payload, so this one terminal event waits for the
    // block below rather than emitting here.
    //
    // `storyboard.images.generate` ONLY. The scripts job reports every concept
    // with `images: []` — it runs before any frame exists — so treating it the
    // same way would read as "every frame failed" and fire a retry for work
    // that has not been attempted yet.
    const isKeyframeTerminal = isTerminal && applied.kind === "storyboard.images.generate";
    if (!(isTerminal && (isPagedKind || isKeyframeTerminal))) emitDone(applied.result);

    if (isTerminal) {
      log.info("terminal", { status, ...describeResult(result) });

      // The payload itself, once, in full. It is the only complete record of
      // what upstream produced for a run — the AiJob row keeps it too, but a
      // log line survives the document being overwritten by a re-run.
      //
      // Capped: a result with many citations runs to tens of KB, and a log file
      // rotated daily should not be dominated by one job.
      // Through `log`, NOT `logger`: written straight to the daily log this
      // was tens of KB per run, which is precisely the noise the boundary-only
      // filter exists to remove. It still reaches the flow tape in full.
      try {
        const full = JSON.stringify(result);
        log.info("payload", {
          bytes: full.length,
          body:
            full.length > 64000
              ? `${full.slice(0, 64000)}…[truncated ${full.length} bytes]`
              : full,
        });
      } catch {
        log.warn("payload.unserialisable");
      }

      await mirrorToSession(applied, result);

      // Now the fold has happened, so the client can be told about all of it.
      if (isPagedKind) {
        const merged = (await readSection(applied.sessionId, applied.kind))?.result;
        emitDone(merged !== undefined && merged !== null ? merged : applied.result);
      }

      // A finished clip is also a library entry. My Space is where a user goes
      // to find their work, and a video only on the onboarding session cannot
      // be found, filtered, downloaded or posted from there.
      //
      // Fire-and-forget: the library copy is a convenience, and failing it must
      // not fail this callback — a 500 here makes upstream retry a render that
      // actually succeeded.
      if (applied.kind === "video.generate" && status === "succeeded") {
        fileSessionClips({ userId: applied.userId, sessionId: applied.sessionId, result })
          .then((filed) => filed && log.info("myspace.filed", { count: filed }))
          .catch((e) => log.error("myspace.file_failed", { message: e.message }));
      }

      // The brand goes to BrandIQ on the same terms and for the same reason:
      // it is researched here and used everywhere else, and a brand that never
      // reaches the library cannot be picked in AdCreative or targeted by
      // AdFactory. Fire-and-forget, so a library write can never fail the
      // callback that reports the research.
      if (applied.kind === "onboarding.init" && status === "succeeded") {
        fileBrandToBrandIQ({ userId: applied.userId, sessionId: applied.sessionId, result })
          .then((id) => id && log.info("brandiq.filed", { brand: String(id).slice(0, 8) }))
          .catch((e) => log.error("brandiq.file_failed", { message: e.message }));
      }

      // ── Keyframes: complete, or say nothing yet ─────────────────────────
      // Upstream calls a run `succeeded` with frames still failed. Forwarding
      // that paints a permanent hole on a card for a gap that one more call
      // usually fills. So the terminal event is held while a retry runs, and
      // the client keeps the placeholders it already has — which is honest,
      // because work really is still going on.
      //
      // `exhausted` is the other way out: three attempts spent, and the gap is
      // now something the user should be told about rather than waited through.
      if (isKeyframeTerminal) {
        const recovery = await handleStoryboardResult({
          userId: applied.userId,
          sessionId: applied.sessionId,
          result,
        }).catch((e) => {
          // A recovery that cannot run must never swallow the result: fall
          // through and forward what upstream gave us.
          log.error("keyframes.recovery_failed", { message: e.message });
          return { hold: false, exhausted: false };
        });

        if (recovery.hold) {
          log.info("keyframes.held", { gaps: recovery.gaps?.length });
        } else {
          if (recovery.exhausted) log.warn("keyframes.exhausted");
          emitDone(applied.result);
        }
      }

      // Fires only when THIS delivery is the one that set chainedAt — i.e.
      // exactly once, on the first terminal success.
      // No log line here: `runChain` refuses every kind but `onboarding.init`,
      // and announcing a chain before that check made a finished VIDEO render
      // read as if it had kicked off a fresh storyboard run. The chain logs its
      // own "firing" once it has decided to.
      if (status === "succeeded" && update.chainedAt) {
        runChain(applied).catch((e) =>
          log.error("chain.failed", { message: e.message })
        );
      }
    }

    log.done(200, { terminal: isTerminal });
    return res.status(200).json({ ok: true, seq: applied.seq });
  } catch (err) {
    // 500 is what makes Python retry, so this line is the record of why we
    // asked for one — without it, a retry storm has no explanation.
    log.error("exception", { message: err.message });
    log.done(500);
    // 500 so Python retries — losing an update is worse than handling it twice.
    return res.status(500).json({ error: "internal error" });
  }
};

/**
 * GET /adsgpt/jobs/:jobId?since=N
 *
 * The recovery read: after a refresh, after a dropped socket, or for a client
 * that cannot hold one. `204` when nothing has happened since `since`, which
 * keeps it cheap enough to call on a timer if a client ever needs to.
 */
exports.getJob = async (req, res) => {
  try {
    const userId = req.user?.user_id;
    const { jobId } = req.params;
    const since = Number(req.query.since);

    // Ownership by query, so someone else's job is indistinguishable from one
    // that does not exist.
    const job = await AiJob.findOne({ jobId, userId }).lean();
    if (!job) return res.status(404).json({ error: "not found" });

    if (Number.isFinite(since) && job.seq <= since) return res.status(204).end();

    return res.status(200).json({
      job_id: job.jobId,
      kind: job.kind,
      session_id: job.sessionId,
      parent_job_id: job.parentJobId || undefined,
      status: job.status,
      seq: job.seq,
      progress: { stage: job.stage, message: job.message, percent: job.percent },
      result: job.result || null,
      error: job.error || undefined,
      created_at: job.createdAt,
      completed_at: job.completedAt || undefined,
    });
  } catch (error) {
    logger.error("[jobWebhook] getJob failed", error);
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  }
};

/**
 * GET /adsgpt/jobs?status=running
 *
 * "What is still in flight for me" — what lets a user close their laptop, come
 * back, and find their work still going.
 */
exports.listJobs = async (req, res) => {
  try {
    const userId = req.user?.user_id;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const filter = { userId };
    if (req.query.status) filter.status = req.query.status;
    if (req.query.kind) filter.kind = req.query.kind;

    const jobs = await AiJob.find(filter)
      .select("jobId kind sessionId parentJobId status seq stage message percent createdAt completedAt")
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    return res.status(200).json({ items: jobs });
  } catch (error) {
    logger.error("[jobWebhook] listJobs failed", error);
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  }
};

exports._internals = { runChain, mirrorToSession };
