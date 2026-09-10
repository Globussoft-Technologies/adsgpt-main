// storyboardClient — starts a storyboard run and bridges its stream.
//
// Unlike templates, this endpoint is a REAL job: `POST /api/v1/storyboards/`
// answers `202 {job_id, session_id, status}`, so the id comes from Python and
// the same webhook that reports onboarding can report this too.
//
// The bridge is still started, for the same reason onboarding has one: the
// webhook only tells us the outcome, while the stream carries the concepts as
// they are written and the keyframes as they render. A run takes ~40s and emits
// a `storyboard` event per concept and a `board_image` per frame — none of which
// the terminal payload arrives in time to show.
//
// Reuses `jobStreamBridge` verbatim. Its parser does not care what kind of job
// it is reading: frames in, socket events out, terminal state persisted.

const axios = require("axios");
const { randomUUID } = require("node:crypto");
const AiJob = require("../../Module/ai/aiJob");
const { startJobStreamBridge } = require("./jobStreamBridge");
const { mirrorJobResult } = require("./sessionMirror");
const { createFlowLog } = require("../../utils/flowLog");

// Measured at ~40s for two concepts with four keyframes. The POST itself only
// queues the work, so this covers the insert and nothing more.
const CREATE_TIMEOUT_MS = 30_000;

// The endpoint's own default is 2. Three fills the workspace's three rows,
// which is what the design asks for.
const DEFAULT_COUNT = 3;

function resolveBaseUrl() {
  return String(process.env.ONBOARDING_PYTHON_BASE_URL || "").replace(/\/+$/, "");
}

/**
 * Starts a storyboard run for a session.
 *
 * Returns the job id, or null when it could not be started. Never throws at the
 * caller: the chain fires this alongside templates and one failing must not
 * take the other with it.
 */
async function startStoryboardRun({ userId, sessionId, parentJobId = "", count = DEFAULT_COUNT }) {
  const baseUrl = resolveBaseUrl();
  if (!baseUrl || !userId || !sessionId) return null;

  const log = createFlowLog("storyboards", { session: sessionId, user: userId });

  try {
    log.ds("out", "storyboards");

    const { data } = await axios.post(
      `${baseUrl}/api/v1/storyboards/`,
      { user_id: userId, session_id: sessionId, count },
      {
        headers: {
          "Content-Type": "application/json",
          // A fresh key per attempt. Reusing one would make upstream replay the
          // previous run instead of starting this one — and these are the
          // expensive jobs, so the guard matters more here than anywhere.
          "Idempotency-Key": randomUUID(),
        },
        timeout: CREATE_TIMEOUT_MS,
      }
    );

    const jobId = data?.job_id;
    if (!jobId) {
      log.error("accept.no_job_id");
      // Accepted, but with nothing to track. No job means no callback, so the
      // section would sit unstarted for ever.
      await markStoryboardsFailed(sessionId, "storyboards could not be started");
      return null;
    }
    log.bind({ job: jobId }).info("accepted", { count, upstreamStatus: data.status });

    // The row must exist before anything can report against it — the webhook
    // rejects a callback for a job it has never seen.
    await AiJob.updateOne(
      { jobId },
      {
        $set: { kind: "storyboard.generate", userId, sessionId, parentJobId },
        $setOnInsert: { status: data.status || "queued", seq: 0 },
      },
      { upsert: true }
    );

    // An idempotent replay comes back already finished; there is no stream left
    // to read for it.
    if (data.status !== "succeeded" && data.status !== "failed") {
      startJobStreamBridge({ jobId, userId, sessionId });
    }

    return jobId;
  } catch (error) {
    const message = error?.response?.status
      ? `storyboard generation was rejected (${error.response.status})`
      : error?.message || "storyboard generation could not be started";

    log.error("create.failed", {
      status: error?.response?.status,
      message: error?.response?.data?.error || error.message,
    });

    // Only the ACCEPT failed — nothing is running upstream, so nothing will
    // ever call back. Without this the section stays `idle` for ever and the
    // workspace shimmers three empty concept cards at the user with no way to
    // find out that the run is dead. `templateBridge` has always done this on
    // the same failure; storyboards simply never did.
    await markStoryboardsFailed(sessionId, message);
    return null;
  }
}

/**
 * Marks the storyboards section failed when the run never started.
 *
 * Distinct from a run that started and then failed: that one arrives on the
 * webhook and writes itself. This is for the window before any job exists,
 * which is the only case nothing else can report.
 */
async function markStoryboardsFailed(sessionId, message) {
  try {
    await mirrorJobResult(sessionId, "storyboard.generate", {
      status: "failed",
      error: message,
    });
  } catch {
    // A failed bookkeeping write must not become a second failure. The log
    // above already recorded what went wrong.
  }
}

module.exports = { startStoryboardRun, DEFAULT_COUNT };
