// mySpaceClip — a finished onboarding clip, filed where the user's other ads live.
//
// The onboarding flow keeps its clip on the session, which is right for the
// workspace and wrong for everything after it: My Space is the library, and a
// video that is not in the library does not exist as far as the rest of the
// product is concerned — it cannot be found, filtered, downloaded or posted
// from the place a user goes to find their work.
//
// So a clip that reaches `ready` is also written as a `VideoGeneration` row with
// `inputs.type: "storyboard"`, which is what the new My Space filter reads.
//
// ── Why the durable URL and nothing else ────────────────────────────────────
// The contract gives two links. `local_url` is the storyboard service's own copy
// and dies in 24 hours; `url` is a path in the media store, and the media store
// IS our S3 — `ONBOARDING_MEDIA_BASE_URL` and the frontend's `VITE_S3_BASE_URL`
// are the same host. So the durable path can be stored exactly as every other My
// Space video stores one: root-relative, resolved against S3 at render time. No
// copy step, no second bucket, and no link that expires inside a library the
// user expects to be permanent.
//
// A clip whose durable upload has not landed yet is therefore NOT filed. It is
// still on the session and still plays in the workspace off the local copy; the
// library simply waits, because a row here has to outlive the day it was made.

const VideoGeneration = require("../../Module/videoGeneration/videoModel");
const GeneratedMedia = require("../../Module/generatedMedia/generated.media");
const OnboardingSession = require("../../Module/onboarding/onboardingSession");
const { createFlowLog } = require("../../utils/flowLog");

/**
 * Files one clip.
 *
 * `board` is a `result.videos[]` entry — `{ board_id, title, angle, duration_s,
 * video }`. Returns the row's id, or null when there was nothing to file.
 *
 * Never throws. The library copy is a convenience; failing it must not fail the
 * webhook that reports the render, or upstream will retry a render that
 * succeeded.
 */
async function fileClip({ userId, sessionId, board, log }) {
  const clip = board?.video;
  if (!clip || clip.status !== "ready") return null;

  // Deliberately not `local_url` — see the note above. No durable path means
  // the upload has not landed, and this row would rot within a day.
  const url = String(clip.url || "").trim();
  if (!url) {
    log.warn("skipped.no_durable_url", { board: board.board_id });
    return null;
  }

  // The dedupe key. The webhook is at-least-once and the same terminal payload
  // arrives from the SSE bridge as well, so this runs more than once per clip
  // as a matter of course. Matching on the URL is what makes that a no-op: the
  // storyboard service mints one media path per rendered clip, so the same
  // render can never produce two rows and a re-render (a new `version`, a new
  // path) correctly produces its own.
  const existing = await VideoGeneration.findOne({ userId, "results.0.url": url })
    .select("_id")
    .lean();
  if (existing) return existing._id;

  const seconds = Number(clip.duration_s ?? board.duration_s) || 0;

  const row = await VideoGeneration.create({
    userId,
    status: "completed",
    inputs: {
      type: "storyboard",
      // Both of these are `required` on the schema, and BOTH were getting past
      // review because nothing here validated until Mongoose did: every filing
      // threw "inputs.numberOfVideos is required", was caught as best-effort,
      // and the library stayed empty while the workspace showed the clip
      // playing perfectly. Mongoose also rejects "" for a required String, so
      // the model needs a real fallback rather than an empty one.
      model: clip.model || "storyboard",
      // One render, one clip. The storyboard service renders a single board per
      // job — see `videoClient`, which always sends exactly one `board_id`.
      numberOfVideos: 1,
      // Server-side defaults on the storyboard service; there are no knobs for
      // these on the request, so they are facts rather than choices.
      aspectRatio: "9:16",
      duration: seconds ? String(seconds) : "",
      // What the concept was, in the user's own words. My Space shows this when
      // it has nothing better, and "The Morning Radiance" is a great deal more
      // use in a library than a row with no label.
      userPrompt: board.title || board.angle || "",
    },
    results: [
      {
        model: clip.model || "",
        url,
        duration: seconds ? String(seconds) : "",
        videoStatus: 200,
      },
    ],
  });

  log.info("filed", { board: board.board_id, video: String(row._id).slice(0, 8) });
  return row._id;
}

/**
 * Records the clip as usage, which is what the admin panel reads.
 *
 * `generatedMedia` is the ledger behind Admin → User → Generations. A render
 * that never lands here is invisible to whoever has to answer "what has this
 * account actually produced" — and an onboarding clip is a real render with a
 * real cost upstream, whether or not the user was charged for it.
 *
 * `free` is a flag of its own rather than an inference from a zero deduction,
 * because those are different facts. A chargeable render can read zero — a
 * render nobody has a billing record for reads zero too — and labelling either
 * "Free" would be a lie about money. The flag says only what billing actually
 * decided.
 *
 * Deduped on the media path, the same way the library row is.
 */
async function recordUsage({ userId, sessionId, board, log }) {
  const clip = board?.video;
  const url = String(clip?.url || "").trim();
  if (!userId || !url) return null;

  const existing = await GeneratedMedia.findOne({ userId, source: "onboarding", "video.url": url })
    .select("_id")
    .lean();
  if (existing) return existing._id;

  // Whether this render was free is NOT decided here. `renderBilling` decided it
  // at request time, atomically, against `onboarding_free_render_used_at` on the
  // user's profile — which is what stops two tabs pressing Generate at the same
  // moment from both walking away with the freebie. That answer is stored on the
  // board as `billing.free`, and this reads it back.
  //
  // An earlier version of this counted onboarding rows in the ledger instead and
  // called the first one free. It agreed with billing almost always, and was
  // wrong in the case that matters: a free render whose durable upload never
  // landed writes no row here, so the NEXT render — genuinely paid, because the
  // profile flag was already claimed — would be counted as the first and
  // labelled Free in the admin panel. Two sources of truth about money, one of
  // them guessing.
  const session = await OnboardingSession.findOne({ sessionId })
    .select(`videos.boards.${board.board_id}.billing`)
    .lean();
  const billing = session?.videos?.boards?.[board.board_id]?.billing;

  // No billing record at all means this clip predates billing, or was filed by
  // a path that never charged. Not free — "we did not give this away" is the
  // safe thing to assert about money we cannot account for, and the admin shows
  // it as "—" rather than claiming either way.
  const isFree = billing?.free === true;

  const row = await GeneratedMedia.create({
    userId,
    type: "video",
    model: clip.model || "unknown",
    source: "onboarding",
    free: isFree,
    // What the render actually cost the user, as settled by `renderBilling`.
    // Zero on a free render, and zero on one we have no billing record for —
    // which `free: false` is what keeps distinguishable.
    credit_deduction: isFree ? 0 : Number(billing?.amount) || 0,
    // Upstream does not report what the render cost it, and inventing a number
    // here would put fiction into the one place the cost is supposed to be real.
    cost: 0,
    duration: Number(clip.duration_s ?? board.duration_s) || 0,
    aspect_ratio: "9:16",
    video: { url, board_id: board.board_id || "", title: board.title || "" },
  });

  log.info("usage.recorded", { board: board.board_id, free: isFree, media: String(row._id).slice(0, 8) });
  return row._id;
}

/**
 * Files every ready clip in a `video.generate` result.
 *
 * Called from the webhook once the render is terminal and successful. One clip
 * per job today — the product renders concepts individually — but the payload
 * is an array and a session-wide render would arrive the same way.
 */
async function fileSessionClips({ userId, sessionId, result }) {
  const videos = Array.isArray(result?.videos) ? result.videos : [];
  if (!userId || !videos.length) return 0;

  const log = createFlowLog("myspace.clip", { session: sessionId, user: userId });

  let filed = 0;
  for (const board of videos) {
    try {
      // Sequential, not `Promise.all`: the dedupe is a read followed by a
      // write, and two clips racing through it could both find nothing and both
      // insert. One at a time costs milliseconds and removes the question.
      // eslint-disable-next-line no-await-in-loop
      const id = await fileClip({ userId, sessionId, board, log });
      if (id) filed += 1;
      // Separate try/catch would be noise: both writes are best-effort and the
      // caller already treats any throw here as "the library copy did not
      // happen", which is exactly what it means.
      // eslint-disable-next-line no-await-in-loop
      await recordUsage({ userId, sessionId, board, log });
    } catch (error) {
      log.error("file.failed", { board: board?.board_id, message: error.message });
    }
  }

  return filed;
}

module.exports = { fileSessionClips, _internals: { fileClip, recordUsage } };
