/**
 * jobStreamBridge — Python SSE in, socket.io out.
 *
 * The middle hop of `Python --SSE--> Node --WS--> browser`.
 *
 * Why this exists rather than the browser reading Python's stream directly:
 * Python's API is unauthenticated and knows nothing about AdsGPT users, so a
 * browser-facing stream would have no way to prove a job belongs to whoever is
 * watching it. Node already holds that fact. It also already holds a socket to
 * every logged-in tab (`middlewares/authMiddleware.js` joins each socket to a
 * room named after its userId), so pushing progress costs no new connection on
 * the browser side.
 *
 * What it does NOT do: decide anything, and — since the single-webhook contract
 * — write results. It reads frames, forwards them to the browser, and records
 * progress on the job row so a reload can rejoin. The RESULT is written by the
 * webhook alone (`controllers/Ai/jobWebhookController.js`), which is what makes
 * the session document have exactly one writer of record.
 *
 * Lifetime: one bridge per job, started after the 202 has already been sent,
 * and torn down on the `done` frame. It is deliberately fire-and-forget: the
 * user's request must never wait on it, and its failure must never fail theirs.
 *
 * KNOWN LIMIT — read before relying on this in production:
 * the bridge lives in the memory of the Node process that served `/init`. A
 * `pm2 restart gateway` (which every deploy does) kills every in-flight bridge
 * silently, and those jobs stop updating. Python still finishes the work and
 * still persists the context, so nothing is lost — but the live channel goes
 * quiet and the client has to fall back to reading job state. That fallback is
 * the reason the poll/read path exists and must keep existing.
 */

const onboardingClient = require("./onboardingClient");
const AiJob = require("../../Module/ai/aiJob");
const logger = require("../../utils/logger");
const { createFlowLog } = require("../../utils/flowLog");

// The single event name the client listens on. One name for every job kind, so
// a client subscribes once and switches on `kind` — the same shape the contract
// specifies for the eventual webhook, so swapping ingest later changes nothing
// the frontend can see.
const JOB_EVENT = "aiJobUpdate";

// Everything upstream sends is forwarded as-is. That is a deliberate change
// from an earlier version of this file, which summarised `research` and
// `recall` because both used to arrive as multi-KB blobs.
//
// The current contract streams them one small item at a time — a single search,
// a single source, a single matched session — and each already carries its own
// display `message`. There is nothing left to summarise, and re-deriving text
// here would put us in the business of writing UI copy in the transport layer.
//
// The events, and what the client does with each:
//
//   progress  → status line (rendered VERBATIM) and the progress bar
//   thinking  → the model's research answer, streamed as readable sentences.
//               This is what fills the long stall while `percent` sits at 15
//   research  → "how this was researched" trail: kind = search | site | source
//   recall    → a bare mention of an earlier session on the same brand
//   done      → THE ONLY terminal signal. There is no `stage: "done"`
//
// Every payload is small; the complete citation and search lists live on the
// final result, not on the stream.

/**
 * A one-line census of a terminal payload.
 *
 * Deliberately the same shape the webhook logs, so the two terminal paths can
 * be compared line for line when they disagree — which is exactly the bug worth
 * catching now that both are live at once.
 *
 * The difference between `0` and `null` matters and is preserved: one means
 * upstream looked and found nothing, the other that it never looked.
 */
function describeResult(result) {
  if (!result || typeof result !== "object") return { result: "none" };
  const ctx = result.context || {};
  const len = (v) => (Array.isArray(v) ? v.length : v == null ? "null" : "?");
  return {
    brand: ctx.brand_name || "-",
    scraped: result.scraped,
    ctxKeys: Object.keys(ctx).length,
    logos: len(ctx.logo_urls),
    images: len(ctx.image_urls),
    colors: len(ctx.color_palette),
    audience: len(ctx.target_audience),
    products: len(ctx.key_products),
    citations: len(result.citations),
    bytes: JSON.stringify(result).length,
  };
}

// A frame with no blank line after it can never be parsed, so a stream that
// stops emitting separators must not grow the buffer without bound.
const MAX_BUFFER_BYTES = 512 * 1024;

// One bridge per job. Without this, an idempotent retry — which returns the
// SAME job_id — would start a second consumer on the same stream, and the
// client would receive every event twice.
const active = new Map();

function emit(userId, payload) {
  if (!global.io || !userId) return;
  global.io.to(userId).emit(JOB_EVENT, payload);
}

/**
 * Splits an SSE buffer into complete frames, returning the leftover.
 *
 * Chunk boundaries land wherever TCP decides, so a frame routinely arrives in
 * two pieces and two frames routinely arrive in one. Everything before the last
 * blank line is complete; whatever follows it is a partial frame and goes back
 * in the buffer.
 */
function splitFrames(buffer) {
  const parts = buffer.split(/\r?\n\r?\n/);
  const rest = parts.pop() || "";
  return { frames: parts, rest };
}

function parseFrame(frame) {
  // ": heartbeat" — a comment, sent every 15s during quiet gaps. Not an event.
  if (!frame.trim() || frame.trimStart().startsWith(":")) return null;

  const id = (frame.match(/^id:\s*(.*)$/m) || [])[1];
  const event = ((frame.match(/^event:\s*(.*)$/m) || [, "message"])[1] || "").trim();

  // `data:` may legally span several lines; the spec joins them with newlines.
  const data = (frame.match(/^data:\s*(.*)$/gm) || [])
    .map((line) => line.replace(/^data:\s*/, ""))
    .join("\n");

  let parsed = data;
  try {
    parsed = JSON.parse(data);
  } catch {
    // Not JSON. Forward the raw string rather than dropping the frame — the
    // client can decide it is uninteresting, but silently losing an event
    // would be indistinguishable from the job stalling.
  }

  return { id: id ? id.trim() : "", event, data: parsed };
}

/**
 * Mirrors a progress frame onto the AiJob row.
 *
 * Without this the row only ever holds what Python's webhook put there, which
 * today is nothing — so `GET /adsgpt/jobs/:id` answered with an empty progress
 * and a client that reloaded mid-run had no way to learn where the job had got
 * to. The live channel was the ONLY place progress existed, and the live
 * channel is exactly what a refresh loses.
 *
 * Written with the same conditional guard the webhook uses (`seq` must exceed
 * what is stored), so the two ingest paths can coexist without one overwriting
 * the other's newer state.
 *
 * Never throws: this is a cache for recovery, and failing it must not tear down
 * a stream the user is watching.
 */
async function persistProgress(jobId, seq, data) {
  try {
    const update = { status: "running", seq };
    if (data.stage) update.stage = String(data.stage);
    if (data.message) update.message = String(data.message);
    if (typeof data.percent === "number") update.percent = data.percent;

    await AiJob.updateOne({ jobId, seq: { $lt: seq } }, { $set: update });
  } catch (error) {
    createFlowLog("onboarding.bridge", { job: jobId }).warn("progress.persist_failed", {
      message: error.message,
    });
  }
}

/**
 * Records the terminal outcome on the JOB row. Not on the session.
 *
 * This bridge is a DISPLAY channel. The webhook is the writer of record for
 * results — one writer, so there is no race to reason about and no question of
 * which copy is authoritative. The stream's `done` frame always arrives before
 * the callback, so if this also wrote the session it would win every race and
 * the webhook would be a permanent no-op: the durable path would be the one
 * that never actually ran, and we would only discover it was broken on the day
 * we needed it.
 *
 * What still lands here is everything a resumed tab needs — status, percent,
 * and the payload `GET /adsgpt/jobs/:id` serves — so a reload mid-run rejoins
 * exactly where it was.
 *
 * Never throws: this is recovery state for a background task nobody awaits.
 */
async function persistTerminal(jobId, job) {
  try {
    await AiJob.updateOne(
      { jobId },
      {
        $set: {
          status: job?.status || "succeeded",
          percent: 100,
          ...(job?.result ? { result: job.result } : {}),
          ...(job?.error ? { error: String(job.error) } : {}),
          completedAt: job?.completed_at ? new Date(job.completed_at) : new Date(),
        },
      }
    ).catch(() => {});
  } catch (error) {
    createFlowLog("onboarding.bridge", { job: jobId }).error("persist.failed", {
      message: error.message,
    });
  }
}

/**
 * Opens the stream and pumps it until a terminal frame or an unrecoverable error.
 *
 * Returns when the job is done. Reconnects at most once: a stream that drops
 * twice is a service problem, and retrying forever would hold a doomed loop
 * open for the life of the process.
 */
async function pump({ jobId, userId, sessionId }) {
  const log = createFlowLog("onboarding.bridge", { job: jobId, session: sessionId, user: userId });
  let lastEventId = "";
  let terminal = false;
  let seqCounter = 0;
  // Counted per event name rather than logged per event: a 27-second run emits
  // 30+ frames, and one line each would bury everything else in the file. One
  // summary line at the end answers "did they all arrive?" just as well.
  const counts = {};

  for (let attempt = 0; attempt < 2 && !terminal; attempt += 1) {
    let stream;
    try {
      log.ds("out", "jobs/events", { attempt });
      log.info("stream.open", { attempt, resumeFrom: lastEventId });
      stream = await onboardingClient.openJobEventStream(jobId, { lastEventId });
    } catch (error) {
      log.error("stream.unavailable", { attempt, code: error.code, message: error.message });
      // Tell the client rather than leaving it on a spinner forever.
      emit(userId, { job_id: jobId, session_id: sessionId, event: "error", data: { error: "stream_unavailable" } });
      return;
    }

    let buffer = "";

    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => {
      const finish = () => {
        stream.removeAllListeners();
        stream.destroy?.();
        resolve();
      };

      stream.on("data", (chunk) => {
        buffer += chunk.toString("utf8");
        if (buffer.length > MAX_BUFFER_BYTES) buffer = buffer.slice(-MAX_BUFFER_BYTES);

        const { frames, rest } = splitFrames(buffer);
        buffer = rest;

        for (const raw of frames) {
          const frame = parseFrame(raw);
          if (!frame) continue;
          if (frame.id) lastEventId = frame.id;
          counts[frame.event] = (counts[frame.event] || 0) + 1;

          if (frame.event === "done") {
            terminal = true;
            const doneResult = frame.data?.result;
            log.info("terminal", {
              status: frame.data?.status,
              ms: log.elapsed(),
              ...counts,
              ...describeResult(doneResult),
            });

            // The payload itself, once, in full. Both terminal paths record it
            // — the SSE `done` frame here and Python's webhook — because either
            // can be the one that actually arrives, and when a brand renders
            // wrongly the first question is always what upstream sent.
            //
            // Through `log`, NOT `logger`: this used to write the whole result
            // straight to the daily log, which is what made a single run bury
            // everything else in the file. `flowLog`'s BOUNDARY_ONLY keeps it
            // out of the log and still writes it to the flow tape, so the full
            // record survives exactly where the detail belongs.
            try {
              const full = JSON.stringify(doneResult);
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
            emit(userId, {
              job_id: jobId,
              session_id: sessionId,
              kind: frame.data?.kind || "onboarding.init",
              event: "done",
              status: frame.data?.status || "succeeded",
              seq: frame.id || "",
              result: frame.data?.result || null,
            });
            persistTerminal(jobId, frame.data);
            return finish();
          }

          if (frame.event === "error") {
            terminal = true;
            log.error("stream.error_frame", { message: frame.data?.message, ms: log.elapsed() });
            emit(userId, { job_id: jobId, session_id: sessionId, event: "error", status: "failed", data: frame.data });
            persistTerminal(jobId, { status: "failed", error: frame.data?.message || "failed" });
            return finish();
          }

          // The stream carries its own monotonic ids; where one is missing we
          // fall back to a local counter so the conditional write still has
          // something to compare against.
          seqCounter = frame.id ? Math.max(seqCounter, Number(frame.id) || 0) : seqCounter + 1;

          // Only `progress` changes job state worth recovering. thinking /
          // research / recall are live decoration and reappear in the final
          // result, so they are forwarded but not stored.
          if (frame.event === "progress" && frame.data && typeof frame.data === "object") {
            persistProgress(jobId, seqCounter, frame.data);
          }

          // progress · thinking · research · recall — all forwarded untouched.
          emit(userId, {
            job_id: jobId,
            session_id: sessionId,
            event: frame.event,
            seq: frame.id || "",
            data: frame.data,
          });
        }
      });

      stream.on("error", (error) => {
        log.error("stream.errored", { message: error.message, ms: log.elapsed() });
        finish();
      });

      // A stream ending WITHOUT a `done` frame is a dropped connection, not
      // success. Leave `terminal` false so the loop reconnects with
      // Last-Event-ID and replays only what was missed.
      stream.on("end", finish);
    });
  }

  if (!terminal) {
    // The job is very likely fine — upstream persists regardless. What is lost
    // is the LIVE channel, so this is the line that explains a screen that
    // stopped moving.
    log.warn("stream.ended_early", { ms: log.elapsed(), ...counts });
    emit(userId, { job_id: jobId, session_id: sessionId, event: "error", data: { error: "stream_ended_early" } });
  }
}

/**
 * Starts a bridge for a job. Safe to call twice — the second call is ignored.
 *
 * Fire-and-forget by contract: never await this from a request handler.
 */
function startJobStreamBridge({ jobId, userId, sessionId = "" }) {
  if (!jobId || !userId) return false;
  if (active.has(jobId)) {
    createFlowLog("onboarding.bridge", { job: jobId }).warn("duplicate.start_ignored");
    return false;
  }

  active.set(jobId, Date.now());

  pump({ jobId, userId, sessionId })
    .catch((error) => {
      // The last line of defence. An unhandled rejection from a detached task
      // can take the whole gateway down.
      createFlowLog("onboarding.bridge", { job: jobId }).error("crashed", {
        message: error?.message,
      });
    })
    .finally(() => active.delete(jobId));

  return true;
}

module.exports = {
  startJobStreamBridge,
  JOB_EVENT,
  _internals: { splitFrames, parseFrame, active },
};
