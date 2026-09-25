// templateAdResult — what happens to a finished recreate.
//
// Two jobs, in this order:
//
//   1. SHAPE IT LIKE A CLIP. An image result is normalised into the same shape
//      a video board carries, so the socket pipeline, the session mirror and
//      the clip view all handle it with no branch of their own. The browser
//      keeps reading the one shape it has always read — the same principle as
//      `similarTemplates.flattenResult`.
//   2. FILE IT. Into the session (so a reload finds it), into `generatedMedia`
//      (so the admin ledger sees the render), and into My Space (so the user
//      finds their ad where they find everything else).
//
// ── Nothing is re-hosted here (decision, 2026-09-23) ────────────────────────
// An earlier version downloaded the generated image and re-uploaded it, because
// the contract documents the image result as a TEMPORARY link
// (`/api/v1/images/files/{id}`, `expires_at` +10 min) and a user who walked away
// would have come back to a dead link.
//
// DS now returns a durable `contents.adsgpt.io` url instead, so that round trip
// was doing nothing and has been removed. `assertDurable` is what is left of it:
// it does not fetch anything, it only NOTICES if a temporary-looking link ever
// arrives again — because the failure that would cause is an ad that quietly
// stops existing ten minutes later, which nothing else here would catch.

const OnboardingSession = require("../../Module/onboarding/onboardingSession");
const GeneratedMedia = require("../../Module/generatedMedia/generated.media");
const ImageGeneration = require("../../Module/imageGeneration/imageModel");
const { createFlowLog } = require("../../utils/flowLog");

// Renders being filed right now, by `userId|url`. The terminal payload arrives
// from BOTH the SSE bridge and the webhook, within milliseconds of each other,
// and each dedupe below is a read followed by a write — two deliveries racing
// through them could both find nothing and both insert. Same guard, same reason,
// as `mySpaceClip.inFlight`.
const inFlight = new Set();

/**
 * Notices a link that will not outlive the day.
 *
 * DS serves durable media from its own CDN. Anything RELATIVE, or served off
 * DS's own API origin, is its short-lived store — the shape the contract still
 * documents for this route. We no longer re-host those, so all this can do is
 * say so loudly: the alternative is an ad that works when the user looks at it
 * and is gone by the time they come back.
 */
function assertDurable(url, log) {
  const raw = String(url || "").trim();
  if (!raw) return false;

  const temporary =
    !/^https?:\/\//i.test(raw) ||
    (() => {
      const dsBase = (process.env.ONBOARDING_PYTHON_BASE_URL || "").replace(/\/+$/, "");
      return Boolean(dsBase) && raw.startsWith(dsBase);
    })();

  if (temporary) {
    log.error(
      "result.link_not_durable — DS returned a temporary image url and nothing re-hosts it " +
        "any more; this ad will stop resolving when it expires. " +
        `url=${raw.slice(0, 120)}`,
    );
  }
  return !temporary;
}

/**
 * The image result, wearing a video board's clothes.
 *
 * Deliberately the `videos[]` shape and not a new one. `applyVideoEvent` in the
 * browser already knows how to turn this into a board that is `ready` with
 * something to show, and `videos.boards.<id>.video` is already what the clip
 * view reads. Teaching both of them a second shape would buy nothing except two
 * places to keep in step.
 *
 * `mime_type` is what tells the view to render an `<img>` rather than a
 * `<video>` — the one thing it genuinely has to know.
 */
function asBoardVideo({ boardId, url, mime, model }) {
  return {
    board_id: boardId,
    video: {
      status: "ready",
      url,
      // Already absolute, so `src` and `url` are the same thing here. Both are
      // set because different readers reach for different ones.
      src: url,
      mime_type: mime || "image/png",
      model: model || "",
    },
  };
}

/**
 * One `result.videos[]` entry, in the shape the rest of onboarding reads.
 *
 * The two video routes disagree about what lives in that array, and the
 * disagreement is silent:
 *
 *   storyboard  `{ board_id, title, angle, duration_s, video: { url, … } }`
 *   recreate    `{ id, board_id, status, url, mime_type, … }`  ← the clip ITSELF
 *
 * Everything downstream was written against the first shape, so the second one
 * simply read as empty: the session stored the clip one level too shallow (so a
 * reload found no video) and `mySpaceClip.fileClip` looked for `board.video`,
 * got `undefined`, and filed nothing at all.
 *
 * Detected by shape rather than by kind, because both consumers already have
 * the item in hand and neither should have to be told which route produced it.
 * An entry that carries its own `url` IS the clip and gets wrapped; one that
 * already nests a `video` is passed through untouched.
 */
function asClipBoard(item) {
  if (!item || typeof item !== "object") return item;
  if (item.video) return item;
  if (!item.url && !item.status) return item;
  return {
    board_id: item.board_id || "",
    duration_s: item.duration_s,
    // Carried, not dropped: `mySpaceClip.recordUsage` finds a recreate's credit
    // hold through `recreate:<template_id>`, and a wrapper that loses it looks
    // up a board key that cannot exist.
    template_id: item.template_id || "",
    video: item,
  };
}

/**
 * Records the ad as usage, which is what the admin panel reads.
 *
 * `free` says only what billing decided. A flag rather than an inference from a
 * zero charge, because "the allowance paid" and "nobody recorded a charge" both
 * read as zero and only one of them is free.
 */
async function recordUsage({ userId, url, model, templateId, billing, log }) {
  // URL alone — see the note on the clip's dedupe in `mySpaceClip`.
  const existing = await GeneratedMedia.findOne({ userId, "image.url": url })
    .select("_id")
    .lean();
  if (existing) return existing._id;

  const row = await GeneratedMedia.create({
    userId,
    type: "image",
    model: model || "gemini-3.1-flash-image",
    // One source for all of onboarding — what this render WAS is recorded by
    // the My Space row's `inputs.type`, not by splitting the ledger in two.
    source: "onboarding",
    // Both halves of the price, so the admin sees "31 given away, 1 charged"
    // rather than a 32-credit render that appears to have cost 1.
    credit_deduction: Number(billing?.amount) || 0,
    allowance_deduction: Number(billing?.allowanceSpent) || 0,
    cost: Number(billing?.amount) || 0,
    free: Boolean(billing?.free),
    image: { url, templateId },
  });
  log.info("usage.recorded", { media: String(row._id).slice(0, 8) });
  return row._id;
}

/**
 * Files the ad into My Space's image library.
 *
 * My Space reads IMAGES from `ImageGeneration` — not from `generatedMedia`,
 * which is the admin ledger and invisible to the user. So an ad that is only
 * recorded there is an ad the user cannot find.
 *
 * `inputs.type` is `template_recreate`, NOT `recreate_ads`. The latter is
 * AdLibrary's own recreate — an ad rebuilt from a competitor ad — and it has its
 * own re-open behaviour in My Space. Sharing the type would send someone who
 * pressed Recreate on a template ad into the AdLibrary modal with nothing to
 * fill it.
 *
 * It lists under the AdCreative source, because `mySpaceImagesService` maps
 * everything in this collection that way; a source of its own would mean
 * touching that service and the tab bar, which is a bigger change than "the user
 * can find their ad".
 *
 * Deduped on the image url, the same way the ledger row is: the webhook and the
 * SSE bridge deliver the same terminal payload as a matter of course.
 */
async function fileIntoMySpace({ userId, url, prompt, model, quality, log }) {
  const existing = await ImageGeneration.findOne({
    userId,
    "results.generatedImageUrl": url,
  })
    .select("_id")
    .lean();
  if (existing) return existing._id;

  const row = await ImageGeneration.create({
    userId,
    status: "completed",
    completedAt: new Date(),
    inputs: {
      // All three are `required` on the schema. A missing one throws inside a
      // best-effort catch, which is how a library stays empty while the screen
      // shows the image perfectly — it happened to the clip filing once already.
      type: "template_recreate",
      model: model || "gemini-3.1-flash-image",
      numberOfImages: 1,
      quality: quality || "low",
      userPrompt: prompt || "Recreated from a reference template",
    },
    results: [
      {
        generatedImageUrl: url,
        status: "completed",
        prompt: prompt || "",
      },
    ],
  });
  log.info("myspace.filed", { image: String(row._id).slice(0, 8) });
  return row._id;
}

/**
 * Writes the finished ad onto the session, so a reload finds it.
 *
 * THE MEDIA ONLY — deliberately NOT the board's status.
 *
 * Status belongs to `mirrorJobResult`, and it has to belong to exactly one
 * writer, because that is also the thing that settles the credit hold: it
 * settles a board it sees leave `running`, and only that board. When this
 * function also wrote "succeeded" there were two writers and the money came out
 * wrong whichever won the race —
 *
 *   · this one first  → the mirror finds the board already terminal, skips it,
 *                       and the hold is never settled (released an hour later
 *                       by the sweeper, so a successful render was free);
 *   · the mirror first → it marked the board failed, because an image result
 *                       carries no `videos[]`, and REFUNDED a render that had
 *                       in fact succeeded.
 *
 * Writing only the media leaves one owner for the transition, so the settle
 * happens exactly once and says the right thing. The order the two arrive in no
 * longer matters: whichever lands second fills in what the first did not write.
 */
async function mirrorRecreate({ sessionId, boardId, board, log }) {
  if (!sessionId || !boardId) return false;
  await OnboardingSession.updateOne(
    { sessionId },
    {
      $set: {
        // `recreates`, not `videos` — see `templateAdClient.recreateBoardKey`.
        [`recreates.boards.${boardId}.video`]: board,
        [`recreates.boards.${boardId}.updatedAt`]: new Date(),
      },
    },
  );
  log.info("mirrored", { board: boardId });
  return true;
}

/**
 * Everything that happens when a recreate finishes.
 *
 * Returns the board payloads that were produced, so the caller can emit them on
 * the socket. Deduped, so the webhook and the stream both delivering the same
 * terminal result is a no-op.
 */
async function storeTemplateAdResult({
  userId,
  sessionId,
  boardId,
  templateId,
  result,
  billing,
  instruction = "",
}) {
  const log = createFlowLog("recreate", { session: sessionId, user: userId });

  // `images` and not `image`: the second is a subset of the first, and reading
  // the subset would silently drop takes the moment variations > 1.
  const takes = Array.isArray(result?.images)
    ? result.images
    : result?.image
      ? [result.image]
      : [];
  if (!takes.length) return [];

  const boards = [];
  for (const take of takes) {
    const files = Array.isArray(take?.images) ? take.images : [];
    for (const file of files) {
      const url = String(file?.url || "").trim();
      if (!url) continue;

      const lockKey = `${userId}|${url}`;
      if (inFlight.has(lockKey)) continue;
      inFlight.add(lockKey);
      try {
        // Stored as DS gave it. `assertDurable` only warns — a link we cannot
        // vouch for is still the user's ad, and refusing to file it would lose
        // them something that works today for a risk that may never land.
        assertDurable(url, log);
        const durable = url;

        const board = asBoardVideo({
          boardId,
          url: durable,
          mime: file?.mime_type,
          model: take?.model || result?.model,
        });
        boards.push(board);

        // Best effort, both of them: an ad that is stored and playable must not
        // be lost because a ledger row or a session write failed.
        await mirrorRecreate({ sessionId, boardId, board, log }).catch((e) =>
          log.error("mirror.failed", { message: e.message }),
        );
        await recordUsage({
          userId,
          url: durable,
          model: take?.model || result?.model,
          templateId: templateId || result?.template_id || "",
          billing,
          log,
        }).catch((e) => log.error("usage.failed", { message: e.message }));

        await fileIntoMySpace({
          userId,
          url: durable,
          prompt: instruction,
          model: take?.model || result?.model,
          quality: billing?.quality,
          log,
        }).catch((e) => log.error("myspace.failed", { message: e.message }));
      } finally {
        inFlight.delete(lockKey);
      }
    }
  }

  if (boards.length) log.info("result.stored", { count: boards.length });
  return boards;
}

module.exports = {
  storeTemplateAdResult,
  asClipBoard,
  _internals: { assertDurable, asBoardVideo },
};
