// staleRenders — a render that upstream never finished, and never said so.
//
// Every terminal state onboarding knows about arrives from DS: the SSE stream
// or the webhook. When neither ever comes — DS crashed mid-render, a container
// restarted, a callback URL was wrong — the board simply stays `running`. The
// spinner never stops, a reload brings it straight back, and the user is left
// looking at work that finished or died minutes ago with no way to tell which.
//
// The credit hold behind it WAS already handled: `sweepStaleReservations`
// refunds any reservation older than an hour. But that is money only, and it is
// an hour. The tile stays broken for ever either way.
//
// So this is the other half: after a cap generous enough that no healthy render
// could reach it, the board is failed and its payment released. Failing it is
// what gives the user the Retry button — leaving it running offers them
// nothing at all.
//
// ── Why two caps ────────────────────────────────────────────────────────────
// An image comes back in well under a minute and a video in about two and a
// half. One shared cap would either declare images dead while they were still
// working, or leave them spinning for ten minutes for no reason. The caps are
// per KIND, taken from the board's own billing record.

const OnboardingSession = require("../../Module/onboarding/onboardingSession");
const { deriveVideoStatus } = require("./sessionMirror");
const { settleBoard } = require("./renderBilling");
const logger = require("../../utils/logger");

// Generous on purpose. These are not "how long a render takes" — they are "past
// this, nothing is coming". A cap that can fire on a slow-but-healthy render
// would cancel work the user paid for.
const IMAGE_MAX_MS = 2 * 60 * 1000;
const VIDEO_MAX_MS = 10 * 60 * 1000;

const SECTIONS = ["videos", "recreates"];

/** How long this board may run before we stop believing in it. */
function capFor(entry) {
  return entry?.billing?.kind === "image" ? IMAGE_MAX_MS : VIDEO_MAX_MS;
}

/**
 * Fails every onboarding render that has been `running` past its cap, and
 * releases what it was holding.
 *
 * Returns `{ scanned, failed }`. Never throws: it runs on a timer, and one bad
 * session must not stop the rest being swept.
 */
async function sweepStaleRenders({ imageMaxMs = IMAGE_MAX_MS, videoMaxMs = VIDEO_MAX_MS } = {}) {
  const now = Date.now();

  // Pre-filtered on the section summary, which `deriveVideoStatus` keeps in
  // step with the boards — so this reads only sessions that actually have
  // something running, rather than every session ever created.
  const sessions = await OnboardingSession.find({
    $or: SECTIONS.map((s) => ({ [`${s}.status`]: "running" })),
  })
    .select("sessionId userId videos.boards recreates.boards")
    .lean();

  let scanned = 0;
  let failed = 0;

  for (const session of sessions) {
    for (const section of SECTIONS) {
      const boards = session?.[section]?.boards || {};
      // Tracks what this sweep changed, so the section summary can be brought
      // back in step below.
      const swept = {};
      for (const [boardId, entry] of Object.entries(boards)) {
        if (entry?.status !== "running") continue;
        scanned += 1;

        const startedAt = new Date(entry.updatedAt || 0).getTime();
        // No timestamp at all: a board written before this field existed. Left
        // alone rather than failed on a guess — we cannot date it, and failing
        // a render that might be seconds old is worse than one spinner.
        if (!startedAt) continue;

        const cap = entry?.billing?.kind === "image" ? imageMaxMs : videoMaxMs;
        if (now - startedAt <= cap) continue;

        const minutes = Math.round((now - startedAt) / 60000);
        const error = "This render didn't finish in time. Please try again.";

        try {
          // eslint-disable-next-line no-await-in-loop
          await OnboardingSession.updateOne(
            // Guarded on the status we read: a callback that landed while this
            // was deciding has already finished the board properly, and must
            // not be overwritten with a failure.
            { sessionId: session.sessionId, [`${section}.boards.${boardId}.status`]: "running" },
            {
              $set: {
                [`${section}.boards.${boardId}.status`]: "failed",
                [`${section}.boards.${boardId}.error`]: error,
                [`${section}.boards.${boardId}.updatedAt`]: new Date(),
              },
            },
          );

          // The money. `settleBoard` on a failed entry releases the wallet hold
          // AND returns the allowance — both, because a split render took both.
          // eslint-disable-next-line no-await-in-loop
          await settleBoard({
            sessionId: session.sessionId,
            userId: session.userId,
            boardId,
            entry: { ...entry, status: "failed" },
          });

          swept[boardId] = { ...entry, status: "failed" };
          failed += 1;
          logger.warn(
            `[onboarding][stale] failed ${section}.${boardId} after ${minutes}min ` +
              `(session=${session.sessionId} kind=${entry?.billing?.kind || "video"})`,
          );
        } catch (err) {
          logger.error(
            `[onboarding][stale] could not fail ${section}.${boardId}: ${err.message}`,
          );
        }
      }

      /* Bring the section summary back in step.
         `<section>.status` is a glance value that only `mirrorJobResult`
         maintains — so a board failed here left it saying "running" for ever.
         Cosmetic on its own, but it is also THIS sweeper's pre-filter: left
         alone, those sessions would be re-read every two minutes for the life
         of the deployment, finding nothing each time. */
      if (Object.keys(swept).length) {
        const merged = { ...boards, ...swept };
        // eslint-disable-next-line no-await-in-loop
        await OnboardingSession.updateOne(
          { sessionId: session.sessionId },
          { $set: { [`${section}.status`]: deriveVideoStatus(merged) } },
        ).catch((err) =>
          logger.error(`[onboarding][stale] section status: ${err.message}`),
        );
      }
    }
  }

  return { scanned, failed };
}

module.exports = {
  sweepStaleRenders,
  _internals: { capFor, IMAGE_MAX_MS, VIDEO_MAX_MS },
};
