// videoClient — renders ONE storyboard concept into a clip.
//
// The same shape as `storyboardClient`: `POST /api/v1/videos/` answers
// `202 {job_id, session_id}`, so the id comes from Python and the single
// webhook reports the outcome. The bridge is started for the same reason it is
// started there — a render takes 40-60s and the stream is the only thing that
// can say anything during it.
//
// What is different, and why this is not just another copy:
//
//   ONE BOARD PER JOB. The contract accepts a `board_ids` array and will render
//   every storyboard in the session when it is omitted. We always send exactly
//   one. The product renders concepts on individual "Generate" clicks, and a
//   batch job could not report per-tile progress — every tile would move
//   together, and one concept failing would be indistinguishable from all of
//   them failing.
//
//   That means MANY jobs land on ONE session section, and can finish within the
//   same second — upstream renders two clips at a time. `sessionMirror` stores
//   each clip under its own `videos.boards.<id>` key for exactly that reason.
//
// Regeneration is deliberately refused here (see `alreadyRendered`). When the
// product wants it, this guard is the only thing to remove: the write path
// already honours upstream's `version`, and the schema already stores per-board
// state.

const axios = require("axios");
const { randomUUID } = require("node:crypto");
const AiJob = require("../../Module/ai/aiJob");
const OnboardingSession = require("../../Module/onboarding/onboardingSession");
const { startJobStreamBridge } = require("./jobStreamBridge");
const { markBoardStarted } = require("./sessionMirror");
const { securePayment, trueUp, refund } = require("./renderBilling");
const { createFlowLog } = require("../../utils/flowLog");

// The POST only queues the render, so this covers the insert and nothing else.
// The 40-60s of actual work happens on the stream, not on this connection.
const CREATE_TIMEOUT_MS = 30_000;

function resolveBaseUrl() {
  return String(process.env.ONBOARDING_PYTHON_BASE_URL || "").replace(/\/+$/, "");
}

/**
 * Whether this board already has a clip worth keeping.
 *
 * Read from the SESSION, not from the client: a browser that asks twice — a
 * double click, a retried request — must not be able to buy a second render by
 * saying so.
 */
function alreadyRendered(section, boardId) {
  // From `videos.boards`, not from a stored result array — there isn't one. The
  // clips live one per board key so that simultaneous renders cannot overwrite
  // each other; see `sessionMirror.videoBoardWrites`.
  return section?.boards?.[boardId]?.video?.video?.status === "ready";
}

/** Whether a render for this board is already in flight. */
function alreadyRunning(section, boardId) {
  return section?.boards?.[boardId]?.status === "running";
}

/**
 * Starts a video render for one board.
 *
 * Returns `{ ok, jobId }` on acceptance, or `{ ok: false, reason }` — the
 * caller turns a reason into a status code. Never throws: a failed render must
 * surface as a message on one tile, not as a 500 on the page.
 */
async function startVideoRun({ userId, sessionId, boardId }) {
  const baseUrl = resolveBaseUrl();
  if (!baseUrl) return { ok: false, reason: "not_configured" };
  if (!userId || !sessionId || !boardId) return { ok: false, reason: "bad_request" };

  const log = createFlowLog("videos", { session: sessionId, user: userId });

  // Ownership and eligibility come from our own record. Python does not verify
  // the `user_id` it is handed — the contract says so outright — so every check
  // that matters has to happen before the call, not after it.
  const session = await OnboardingSession.findOne({ sessionId, userId })
    .select("storyboards.result videos.boards")
    .lean();
  if (!session) return { ok: false, reason: "not_found" };

  // A storyboard's own id field is `id`. `board_id` is what the VIDEO and IMAGE
  // payloads call the same value when they point back at it — the two contracts
  // name it differently, and matching on the wrong one silently finds nothing.
  const boards = session.storyboards?.result?.storyboards || [];
  const board = boards.find((b) => b?.id === boardId);
  if (!board) return { ok: false, reason: "unknown_board" };

  const videosSection = session.videos || {};
  if (alreadyRunning(videosSection, boardId)) {
    return { ok: false, reason: "already_running", jobId: videosSection.boards[boardId].jobId };
  }
  // No regeneration yet. Deleting this block is the whole of enabling it.
  if (alreadyRendered(videosSection, boardId)) {
    return { ok: false, reason: "already_rendered" };
  }

  // ── Payment, before the call that spends money ─────────────────────────
  //
  // Deliberately after every eligibility check above and before the POST: a
  // request that was going to be refused anyway must not claim the user's free
  // render or freeze their credits on the way to being refused.
  //
  // `renderId` is minted here because the hold needs a name and Python's job id
  // does not exist yet. It goes onto the board beside the job id, which is how
  // the webhook gets from a job id back to this reservation.
  const renderId = randomUUID();

  // This attempt's number, counted from what is already stored. Server-side
  // because it has to survive the reload that would reset any client tally —
  // the UI allows exactly one retry, and a per-tab counter would hand out a
  // fresh one on every refresh for a concept that is never going to render.
  const attempts = (Number(videosSection.boards?.[boardId]?.attempts) || 0) + 1;

  const payment = await securePayment({ userId, sessionId, boardId, renderId });
  if (!payment.ok) {
    log.info("payment.refused", { board: boardId, reason: payment.reason });
    return { ok: false, reason: payment.reason };
  }

  log.ds("out", "videos", { board: boardId, attempt: attempts });

  try {
    const { data } = await axios.post(
      `${baseUrl}/api/v1/videos/`,
      // Always exactly one. Omitting `board_ids` renders the entire session,
      // which is both expensive and untrackable per tile.
      { user_id: userId, session_id: sessionId, board_ids: [boardId] },
      {
        headers: {
          "Content-Type": "application/json",
          // A fresh key per attempt, as with storyboards. Reusing one would
          // replay the previous render instead of starting this one.
          "Idempotency-Key": randomUUID(),
        },
        timeout: CREATE_TIMEOUT_MS,
      }
    );

    const jobId = data?.job_id;
    if (!jobId) {
      log.error("accept.no_job_id");
      // Nothing is rendering, so nothing is owed.
      await refund({ free: payment.free, userId, sessionId, renderId });
      return { ok: false, reason: "upstream_error" };
    }

    // What Python actually chose, which we could not know until now. Trueing up
    // here rather than at settlement means the user sees the unused part of the
    // hold come back in seconds, not in a minute.
    const chargedAmount = await trueUp({
      free: payment.free,
      renderId,
      frozenAmount: payment.amount,
      meta: data?.meta,
    });
    log.bind({ job: jobId }).info("accepted", { board: boardId, upstreamStatus: data.status });

    // Before anything else: the webhook rejects a callback for a job it has
    // never seen, and Python can call back faster than the rest of this
    // function runs.
    await AiJob.updateOne(
      { jobId },
      {
        $set: { kind: "video.generate", userId, sessionId },
        $setOnInsert: { status: data.status || "queued", seq: 0 },
      },
      { upsert: true }
    );

    // Per-board, NOT `markSectionStarted` — that would reset the whole section
    // and erase what the other boards have already done.
    await markBoardStarted(sessionId, boardId, jobId, {
      renderId: payment.free ? "" : renderId,
      free: payment.free,
      amount: chargedAmount,
      model: data?.meta?.model || "",
    }, attempts);

    // An idempotent replay comes back already finished; there is no stream left.
    if (data.status !== "succeeded" && data.status !== "failed") {
      startJobStreamBridge({ jobId, userId, sessionId });
    }

    return { ok: true, jobId };
  } catch (error) {
    const status = error?.response?.status;
    // The POST threw, so no render exists to pay for. Give back whichever form
    // of payment was taken — the freeze, or the free render itself.
    await refund({ free: payment.free, userId, sessionId, renderId }).catch((e) =>
      log.error("refund.failed", { board: boardId, message: e.message })
    );
    log.error("create.failed", {
      status,
      board: boardId,
      message: error?.response?.data?.error || error.message,
    });
    return { ok: false, reason: status === 501 ? "not_configured" : "upstream_error" };
  }
}

module.exports = { startVideoRun, _internals: { alreadyRendered, alreadyRunning } };
