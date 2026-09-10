// keyframeRecovery — a storyboard is not finished until both its frames exist.
//
// ── The problem ─────────────────────────────────────────────────────────────
// Keyframe rendering upstream is best-effort. A generation run reports
// `succeeded` with frames still `status:"failed"` — a transient model refusal
// (`IMAGE_OTHER`), a timeout, a media-store upload that did not land. Forwarding
// that straight to the browser means a card with one picture and one hole, and
// the hole is permanent as far as the user can tell.
//
// It is not permanent. `POST /api/v1/storyboards/retry-images` re-renders
// exactly the not-ready frames across a session, leaves the `ready` ones and the
// concept text alone, and reports back through the same webhook the original run
// used. So the right response to a half-drawn storyboard is to ask again, not to
// paint the gap.
//
// ── What that changes about the terminal event ──────────────────────────────
// Node stops forwarding a storyboard result the moment upstream calls it done.
// It forwards when the storyboards are actually COMPLETE, or when we have tried
// MAX_ATTEMPTS times and this is as good as it gets. In between, the section
// stays `running` and the client keeps the placeholders it already has — which
// is the truth: work is still going on.
//
// The cap is what stops this being a loop. A concept whose `first_frame_prompt`
// the model will never accept fails identically every time; three attempts is
// enough to clear a transient failure and few enough that a permanent one costs
// three renders rather than an unbounded number. After that `exhausted` is set
// and the failure is shown, because a spinner that never resolves is worse than
// a card that admits it is missing a frame.

const axios = require("axios");
const { randomUUID } = require("node:crypto");
const AiJob = require("../../Module/ai/aiJob");
const OnboardingSession = require("../../Module/onboarding/onboardingSession");
const { startJobStreamBridge } = require("./jobStreamBridge");
const { createFlowLog } = require("../../utils/flowLog");

// Three, then the failure is shown. See the note above.
const MAX_ATTEMPTS = 3;

// The first retry goes out immediately: most keyframe failures are a one-off
// refusal and clear on the next call, and making the user wait five seconds for
// something that would have worked instantly is pure delay. The later ones back
// off, because by then the likely cause is upstream having a bad minute rather
// than this one frame being unlucky.
const BACKOFF_MS = [0, 5_000, 15_000];

// Only queues the job; the frames themselves are rendered on the job and
// reported by webhook.
const CREATE_TIMEOUT_MS = 30_000;

function resolveBaseUrl() {
  return String(process.env.ONBOARDING_PYTHON_BASE_URL || "").replace(/\/+$/, "");
}

/**
 * Which frames a concept is still missing.
 *
 * A concept needs a `first` and a `last`, both `ready`. Anything else counts as
 * missing — a frame that failed, a frame that was never produced at all, and a
 * frame that came back `ready` with no usable link (a durable upload that did
 * not land leaves exactly that).
 *
 * Kept as a list rather than a boolean so the log can say WHAT was missing,
 * which is the first question when a retry does not help.
 */
function missingKinds(board) {
  const images = Array.isArray(board?.images) ? board.images : [];
  return ["first", "last"].filter((kind) => {
    const frame = images.find((img) => img?.kind === kind);
    if (!frame) return true;
    if (frame.status !== "ready") return true;
    return !frame.url && !frame.local_url;
  });
}

/**
 * A census of what is still missing across a whole result.
 *
 * Returns `null` when the payload carries no storyboards at all — that is not
 * an incomplete result, it is a different kind of result (the scripts job
 * reports before any frame exists), and it must not trigger a recovery.
 */
function inspectFrames(result) {
  const boards = Array.isArray(result?.storyboards) ? result.storyboards : null;
  if (!boards || !boards.length) return null;

  const gaps = boards
    .map((board) => ({ boardId: board?.id, kinds: missingKinds(board) }))
    .filter((entry) => entry.kinds.length);

  return { total: boards.length, gaps, complete: gaps.length === 0 };
}

/**
 * Starts a session-wide keyframe retry.
 *
 * The session-wide job, not the per-concept route, and deliberately: the
 * synchronous routes render inline and can be cut by a proxy at ~60s even
 * though the work completes, and they would need one call per concept. This one
 * answers 202 immediately, recovers every not-ready frame in the session, and
 * reports through the same webhook the original run used — so nothing
 * downstream has to know a retry happened rather than a first attempt.
 *
 * Never throws: a failed retry leaves the session exactly where it was, which
 * the next attempt or the cap will resolve.
 */
async function startKeyframeRetry({ userId, sessionId, attempt }) {
  const baseUrl = resolveBaseUrl();
  if (!baseUrl || !userId || !sessionId) return null;

  const log = createFlowLog("storyboards.retry", { session: sessionId, user: userId });

  try {
    log.ds("out", "retry-images");

    const { data } = await axios.post(
      `${baseUrl}/api/v1/storyboards/retry-images`,
      { user_id: userId, session_id: sessionId },
      {
        headers: {
          "Content-Type": "application/json",
          // A fresh key per attempt. Reusing one would hand back the PREVIOUS
          // retry's job — the one we already know did not finish the frames —
          // and the recovery would spin without ever rendering anything.
          "Idempotency-Key": randomUUID(),
        },
        timeout: CREATE_TIMEOUT_MS,
      }
    );

    const jobId = data?.job_id;
    if (!jobId) {
      log.error("accept.no_job_id", { attempt });
      return null;
    }
    log.bind({ job: jobId }).info("accepted", { attempt });

    // The row first: the webhook rejects a callback for a job it has never
    // seen, and upstream can call back before this function returns.
    await AiJob.updateOne(
      { jobId },
      {
        $set: { kind: "storyboard.images.generate", userId, sessionId },
        $setOnInsert: { status: data.status || "queued", seq: 0 },
      },
      { upsert: true }
    );

    if (data.status !== "succeeded" && data.status !== "failed") {
      startJobStreamBridge({ jobId, userId, sessionId });
    }

    return jobId;
  } catch (error) {
    log.error("create.failed", {
      attempt,
      status: error?.response?.status,
      message: error?.response?.data?.error || error.message,
    });
    return null;
  }
}

/**
 * Decides what to do with a finished storyboard result, and does it.
 *
 * Returns `{ hold, exhausted, gaps }`:
 *
 *   hold: true   — frames are missing and a retry is now under way. The caller
 *                  must NOT forward the terminal event: as far as the client is
 *                  concerned this run has not finished, because the thing it was
 *                  waiting for has not arrived.
 *   hold: false  — either everything is present, or we are out of attempts. The
 *                  caller forwards, and `exhausted` tells the client whether a
 *                  gap it can see is going to be filled.
 *
 * The attempt counter lives on the session rather than in memory: a retry that
 * spans a deploy must not restart its count, and two Node instances must not
 * each get three attempts of their own.
 */
async function handleStoryboardResult({ userId, sessionId, result }) {
  const census = inspectFrames(result);
  // Not a frame-bearing result — the scripts job, or an empty one. Nothing to
  // recover and nothing to hold.
  if (!census) return { hold: false, exhausted: false, gaps: [] };

  const log = createFlowLog("storyboards.retry", { session: sessionId, user: userId });

  if (census.complete) {
    // Clear the counter. A session that recovered on its second attempt should
    // not carry a used-up budget into a later re-run of the same module.
    await OnboardingSession.updateOne(
      { sessionId },
      { $set: { "storyboards.imageRetry.attempts": 0, "storyboards.imageRetry.exhausted": false } }
    ).catch(() => {});
    return { hold: false, exhausted: false, gaps: [] };
  }

  const doc = await OnboardingSession.findOne({ sessionId })
    .select("storyboards.imageRetry")
    .lean();
  const attempts = Number(doc?.storyboards?.imageRetry?.attempts) || 0;

  if (attempts >= MAX_ATTEMPTS) {
    // Out of budget. The gap is real and the user is told — a card that admits
    // a missing frame beats a spinner that will never stop.
    log.warn("exhausted", { attempts, gaps: census.gaps.length, of: census.total });
    await OnboardingSession.updateOne(
      { sessionId },
      { $set: { "storyboards.imageRetry.exhausted": true } }
    ).catch(() => {});
    return { hold: false, exhausted: true, gaps: census.gaps };
  }

  const attempt = attempts + 1;
  const delay = BACKOFF_MS[attempts] ?? BACKOFF_MS[BACKOFF_MS.length - 1];

  log.info("retrying", { attempt, delayMs: delay, gaps: census.gaps.length, of: census.total });

  // Counted BEFORE the call, not after. A retry that is fired and then lost — a
  // crash, a restart, a callback that never arrives — must still cost an
  // attempt, or a permanently failing frame would retry for ever.
  await OnboardingSession.updateOne(
    { sessionId },
    {
      $set: {
        "storyboards.imageRetry.attempts": attempt,
        "storyboards.imageRetry.lastAt": new Date(),
        // The section goes back to `running`: work IS still happening, and the
        // client's poll and placeholders both key off this.
        "storyboards.status": "running",
        "storyboards.completedAt": null,
      },
    }
  ).catch(() => {});

  // Detached. The webhook handler that called this is answering upstream, and
  // it must not be held open for fifteen seconds of backoff.
  setTimeout(() => {
    startKeyframeRetry({ userId, sessionId, attempt })
      .then((jobId) => {
        if (!jobId) return;
        OnboardingSession.updateOne(
          { sessionId },
          { $set: { "storyboards.imageRetry.jobId": jobId } }
        ).catch(() => {});
      })
      .catch((e) => log.error("retry.crashed", { attempt, message: e.message }));
  }, delay).unref?.();

  return { hold: true, exhausted: false, gaps: census.gaps };
}

module.exports = {
  handleStoryboardResult,
  startKeyframeRetry,
  MAX_ATTEMPTS,
  _internals: { missingKinds, inspectFrames, BACKOFF_MS },
};
