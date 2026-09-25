// mySpaceClip — a finished onboarding clip, filed where the user's other ads live.
//
// The onboarding flow keeps its clip on the session, which is right for the
// workspace and wrong for everything after it: My Space is the library, and a
// video that is not in the library does not exist as far as the rest of the
// product is concerned — it cannot be found, filtered, downloaded or posted
// from the place a user goes to find their work.
//
// So a clip that reaches `ready` is also written as a `VideoGeneration` row
// whose `inputs.type` is what the My Space filter reads — `storyboard` for a
// clip rendered from a written concept, `template_recreate` for one rebuilt
// from a template the user picked. See `ORIGINS` below for everything that
// differs between the two.
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
const { asClipBoard } = require("./templateAdResult");

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
/* ── The two flows that land here ───────────────────────────────────────────
   Both produce a finished 9:16 clip on a durable DS link, both are filed by
   the code below without a branch — but they differ in four small facts, and
   every one of them was wrong for recreates before this table existed:

     · `videoType`     what the library calls it (and filters on)
     · `mediaSource`   which ledger bucket the admin panel reads it under
     · `section`       which OnboardingSession section holds its billing
     · `boardKey`      how that section is keyed — see `recordUsage`

   Keeping them in one table rather than as `isRecreate ? … : …` at four call
   sites is the point: adding a third flow later is one row, and a half-added
   one is visible rather than scattered.                                     */
const ORIGINS = Object.freeze({
  "video.generate": {
    videoType: "storyboard",
    mediaSource: "onboarding",
    section: "videos",
    fallbackPrompt: "",
    boardKey: (board) => board.board_id,
  },
  "video.from_template": {
    videoType: "template_recreate",
    // ONE ledger source for everything onboarding does. `onboarding_recreate`
    // used to be its own bucket, which split one user's onboarding spend across
    // two rows in the admin panel for no reason anyone reading it would guess.
    // What the render WAS is already recorded, in `videoType`.
    mediaSource: "onboarding",
    section: "recreates",
    fallbackPrompt: "Recreated from a reference template",
    // `recreate:<templateId>` — the key `templateAdClient` held the credits
    // under. DS's own `board_id` is a per-render uuid and means nothing here.
    boardKey: (board) => `recreate:${board.template_id || ""}`,
  },
});

// Clips being filed right now, by `userId|url`. The webhook and the SSE bridge
// deliver the same terminal result within milliseconds of each other, and the
// dedupe below is a read followed by a write — two deliveries racing through it
// could both find nothing and both insert. Both paths run in this process, so an
// in-flight set closes that window; a later redelivery is caught by the read.
const inFlight = new Set();

async function fileClip({ userId, sessionId, board: rawBoard, origin, log }) {
  // A recreate's `videos[]` entry IS the clip, not a wrapper around one — see
  // `asClipBoard`. Reading `board.video` on it returned undefined, so every
  // video recreate was silently skipped here and never reached the library.
  const board = asClipBoard(rawBoard);
  const clip = board?.video;
  if (!clip || clip.status !== "ready") return null;

  // Deliberately not `local_url` — see the note above. No durable path means
  // the upload has not landed, and this row would rot within a day.
  const url = String(clip.url || "").trim();
  if (!url) {
    log.warn("skipped.no_durable_url", { board: board.board_id });
    return null;
  }

  const lockKey = `${userId}|${url}`;
  if (inFlight.has(lockKey)) return null;
  inFlight.add(lockKey);
  try {
    return await fileClipOnce({ userId, board, clip, url, origin, log });
  } finally {
    inFlight.delete(lockKey);
  }
}

async function fileClipOnce({ userId, board, clip, url, origin, log }) {

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
      // Which onboarding flow produced this clip. Both arrive finished from the
      // same service and are filed by the same code, but they are different
      // things in the library — one is a concept the user wrote, the other is a
      // template they picked — and My Space filters on exactly this field.
      //
      // Must be a value the schema's enum allows, or the create throws inside
      // the best-effort catch below and the library silently stays empty.
      type: origin.videoType,
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
      // What the concept was, in the user's own words — a recreate has no
      // title of its own, so it falls back to something a library row can
      // actually be read as.
      userPrompt: board.title || board.angle || origin.fallbackPrompt,
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
async function recordUsage({ userId, sessionId, board: rawBoard, origin, log }) {
  // Same normalisation as `fileClip` — and for the same reason.
  const board = asClipBoard(rawBoard);
  const clip = board?.video;
  const url = String(clip?.url || "").trim();
  if (!userId || !url) return null;

  // Deduped on the URL alone. It was `source` + url, which stopped matching
  // the moment the source was unified — and a dedupe that misses writes a
  // second ledger row for one render.
  const existing = await GeneratedMedia.findOne({ userId, "video.url": url })
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
  // WHICH BOARD KEY. A storyboard clip is keyed by the board the user picked,
  // and DS echoes that id straight back, so `board.board_id` is the key. A
  // recreate is keyed by the TEMPLATE (`recreate:<templateId>` — see
  // `templateAdClient.recreateBoardKey`) while DS mints its own uuid for the
  // render, so `board_id` is not a key that exists on the session at all.
  // Looking in the wrong place does not error, it just finds nothing — and a
  // render with no billing record is reported to the admin panel as neither
  // free nor charged.
  const boardKey = origin.boardKey(board);
  const session = await OnboardingSession.findOne({ sessionId })
    .select(`${origin.section}.boards.${boardKey}.billing`)
    .lean();
  const billing = session?.[origin.section]?.boards?.[boardKey]?.billing;

  // No billing record at all means this clip predates billing, or was filed by
  // a path that never charged. Not free — "we did not give this away" is the
  // safe thing to assert about money we cannot account for, and the admin shows
  // it as "—" rather than claiming either way.
  const isFree = billing?.free === true;
  // The two halves of the price. `amount` is the wallet's share and
  // `allowanceSpent` the budget's; a split render has both.
  const fromAllowance = Number(billing?.allowanceSpent) || 0;
  const fromWallet = isFree ? 0 : Number(billing?.amount) || 0;

  const row = await GeneratedMedia.create({
    userId,
    type: "video",
    model: clip.model || "unknown",
    source: origin.mediaSource,
    free: isFree,
    // What the render actually cost the user, as settled by `renderBilling`.
    // Zero on a free render, and zero on one we have no billing record for —
    // which `free: false` is what keeps distinguishable.
    credit_deduction: fromWallet,
    allowance_deduction: fromAllowance,
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
async function fileSessionClips({ userId, sessionId, result, kind = "video.generate" }) {
  const videos = Array.isArray(result?.videos) ? result.videos : [];
  if (!userId || !videos.length) return 0;

  // An unknown kind files as a storyboard rather than not at all: a clip the
  // user paid for belongs in their library even if we mislabel it.
  const origin = ORIGINS[kind] || ORIGINS["video.generate"];

  const log = createFlowLog("myspace.clip", { session: sessionId, user: userId });

  let filed = 0;
  for (const board of videos) {
    try {
      // Sequential, not `Promise.all`: the dedupe is a read followed by a
      // write, and two clips racing through it could both find nothing and both
      // insert. One at a time costs milliseconds and removes the question.
      // eslint-disable-next-line no-await-in-loop
      // `template_id` rides on the result, not on each take, so it is folded
      // into the board here — `recordUsage` needs it to find the credit hold.
      const id = await fileClip({
        userId,
        sessionId,
        board: { ...board, template_id: board.template_id || result?.template_id || "" },
        origin,
        log,
      });
      if (id) filed += 1;
      // Separate try/catch would be noise: both writes are best-effort and the
      // caller already treats any throw here as "the library copy did not
      // happen", which is exactly what it means.
      // eslint-disable-next-line no-await-in-loop
      await recordUsage({
        userId,
        sessionId,
        board: { ...board, template_id: board.template_id || result?.template_id || "" },
        origin,
        log,
      });
    } catch (error) {
      log.error("file.failed", { board: board?.board_id, message: error.message });
    }
  }

  return filed;
}

module.exports = { fileSessionClips, _internals: { fileClip, recordUsage, ORIGINS } };
