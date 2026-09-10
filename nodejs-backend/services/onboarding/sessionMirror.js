/**
 * The one place a job result is written into a session.
 *
 * Three different things can be the first to learn that a job finished:
 *
 *   1. Python's callback      — controllers/Ai/jobWebhookController.js
 *   2. Node's own SSE bridge  — services/onboarding/jobStreamBridge.js
 *   3. A client read          — GET /onboarding/jobs/:jobId, which proxies
 *                               Python and heals whatever the other two missed
 *
 * Any of them can be the winner, in any order, more than once. That is the
 * point: no single path is trusted, because each one has a failure mode the
 * others survive. What that demands is a write that does not care who calls it
 * or how often — so all three funnel through `mirrorJobResult` rather than each
 * hand-rolling its own `$set`.
 *
 * Two rules keep concurrent writers honest:
 *
 *   • A terminal state is FINAL. Once a section is `succeeded` or `failed`, a
 *     later non-terminal write is ignored. Without this, a slow snapshot read
 *     that started before the webhook arrived can drag a finished session back
 *     to `running` when it lands.
 *
 *   • A result is never overwritten with nothing. A callback that reports
 *     `succeeded` with no body must not blank a result another path already
 *     stored.
 */
const OnboardingSession = require("../../Module/onboarding/onboardingSession");
const logger = require("../../utils/logger");
// The money half of a terminal video callback. Kept out of this file because
// what a render costs is not this file's business; what it stores is.
const { settleBoard } = require("./renderBilling");

const TERMINAL_STATUSES = new Set(["succeeded", "failed", "cancelled"]);

/**
 * Pulls the fields the session list needs out of a brand result.
 *
 * Only module 1 denormalises: a list row shows a brand name and a summary, and
 * nothing else in the document is worth reading four Mixed blobs for.
 */
function brandExtras(result) {
  const context = result?.context || null;
  const extras = {};
  if (context) {
    if (context.brand_name) extras.brandName = context.brand_name;
    if (context.summary) extras.summary = context.summary;
  }
  if (Array.isArray(result?.citations)) extras.citations = result.citations;
  if (Array.isArray(result?.search_queries)) extras.searchQueries = result.search_queries;
  if (typeof result?.scraped === "boolean") extras.scraped = result.scraped;
  return extras;
}

/**
 * Folds a page of template recommendations into the ones already stored.
 *
 * ── Why templates append and every other section replaces ────────────────────
 * Upstream returns five recommendations per call and takes a `skip`, so "show
 * me more" is the same endpoint with the cursor moved along. Each callback
 * therefore carries ONE PAGE, not the whole list — and a plain `$set` of
 * `templates.result`, which is what every other section wants, would throw away
 * every page but the last.
 *
 * De-duplicating on `template_id` is what makes this safe to run more than
 * once. The webhook can be redelivered, and upstream's own cache can replay a
 * page verbatim; both arrive here as a page whose ids are already present, and
 * both leave the stored list exactly as it was. That is also why the paging
 * path no longer needs the caller's terminal-state guard to stay idempotent.
 *
 * Returns the merged result plus the new cursor, or `null` when the incoming
 * page has nothing to fold in.
 */
function mergeTemplatePage(previous, incoming, requested = {}) {
  const incomingList = Array.isArray(incoming?.templates) ? incoming.templates : null;
  if (!incomingList) return null;

  const previousList = Array.isArray(previous?.templates) ? previous.templates : [];
  const seen = new Set(previousList.map((t) => t?.template_id).filter(Boolean));

  const added = incomingList.filter((t) => {
    const id = t?.template_id;
    // An item with no id cannot be de-duplicated, so it is kept: dropping it
    // would lose a real recommendation to protect against a duplicate we have
    // no way to detect anyway.
    if (!id) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  const templates = [...previousList, ...added];
  const limit = Number(requested.limit) || 0;

  return {
    result: {
      // The newest page's envelope wins for everything except the list itself —
      // `count`, `near_count` and `message` describe the most recent match, and
      // there is no meaningful way to add two of them together.
      ...(previous || {}),
      ...incoming,
      templates,
    },
    pagination: {
      skip: Number(requested.skip) || 0,
      limit,
      loaded: templates.length,
      // Fewer back than asked for means the corpus is out of candidates. The
      // `skip` ceiling is the contract's, and is enforced by the caller that
      // asks for the next page rather than here.
      exhausted: limit > 0 && incomingList.length < limit,
    },
  };
}

/**
 * The per-board writes one video callback produces.
 *
 * -- Why videos are stored per board, and not as one folded array ------------
 * A person renders concepts ONE AT A TIME, so each `video.generate` job covers
 * a single board and each callback carries a single clip -- while every one of
 * them lands on the same `videos` section. Replacing, which is what every other
 * section does, would mean the second concept a user renders erasing the first.
 *
 * The obvious fix is to read the stored list, fold the new clip in, and write
 * it back -- which is exactly what `templates` does. It is wrong here. That
 * read-then-write is not atomic, and templates get away with it only because a
 * person clicks "load more" one page at a time, so two pages never land
 * together. Videos do land together: the user can start three renders in a
 * breath, upstream renders two clips at a time, and two clips of the same
 * length finish within the same second. Both callbacks would read the same
 * snapshot, both would write their own merge, and one clip would vanish.
 *
 * So there is no list to fold. Each clip is written to its OWN key --
 * `videos.boards.<board_id>` -- which Mongo applies as an independent `$set`.
 * Two callbacks for two different boards cannot collide, however close together
 * they arrive. The array the client reads is DERIVED from those keys on the way
 * out (`videosResultFromBoards`), so nothing has to be kept in step.
 *
 * A redelivery is a no-op for the same reason: it rewrites one key with what is
 * already there. The only ordering rule left is per board, and it is upstream's
 * own: a HIGHER `version` wins. Nothing produces a collision today -- a board
 * renders once and `videoClient` refuses a second run -- but honouring it now
 * is what makes regeneration a matter of deleting that guard.
 *
 * Returns `{ "videos.boards.<id>": entry }`, empty when the payload carries no
 * clips.
 */
function videoBoardWrites(incomingResult, previousBoards = {}, meta = {}) {
  const incoming = Array.isArray(incomingResult?.videos) ? incomingResult.videos : [];
  const writes = {};

  for (const item of incoming) {
    const boardId = item?.board_id;
    // Nothing to key it by. A clip we cannot address is a clip we cannot show
    // against a tile, and inventing an id would only make it un-de-duplicable.
    if (!boardId) continue;

    const existing = previousBoards?.[boardId];
    const version = Number(item?.video?.version) || 1;
    if (existing?.video && (Number(existing.version) || 0) > version) continue;

    writes[`videos.boards.${boardId}`] = {
      jobId: meta.jobId || existing?.jobId || "",
      status: item?.video?.status === "failed" ? "failed" : "succeeded",
      error: item?.video?.error || "",
      version,
      // Carried forward, never re-derived: this key is written wholesale, and
      // the callback that lands here knows nothing about how the render was
      // paid for. Dropping it would strand the reservation — the settle would
      // have no key to settle, and the hold would sit until the sweeper
      // refunded work the user actually received.
      billing: existing?.billing || null,
      // Same reason as `billing`: this key is written wholesale, and losing
      // the count would reopen the retry the user has already spent.
      attempts: Number(existing?.attempts) || 1,
      // The clip itself lives here, beside its own bookkeeping. One key per
      // board is the whole point -- a separate `result` array would reintroduce
      // the shared value this design exists to remove.
      video: item,
      updatedAt: new Date(),
    };
  }

  return writes;
}

/**
 * Rebuilds the result shape the contract describes, out of the per-board keys.
 *
 * The client is owed `{ videos: [ … ] }` — that is what the video contract
 * specifies and what the workspace reads. Storing it that way is what we
 * cannot do; producing it on the way out costs nothing.
 *
 * Boards that were STARTED but produced nothing are left out: `videos` is the
 * list of clips, and a tile that is still rendering or failed is described by
 * `videos.boards`, which the client gets alongside it.
 */
function videosResultFromBoards(boards) {
  const entries = Object.values(boards || {})
    .filter((b) => b && b.video)
    // Oldest first, so tiles do not reshuffle as later clips land.
    .sort((a, b) => new Date(a.updatedAt || 0) - new Date(b.updatedAt || 0));
  return { videos: entries.map((b) => b.video) };
}

/**
 * The one-word summary for the section, derived from every board.
 *
 * Copying the finishing job's status would make the section lie whenever
 * renders overlap: board A finishing would flip it to `succeeded` while board B
 * is still rendering, and a list view would call the module done. The mirror
 * image is just as wrong — one board failing does not make the module failed
 * when another produced a clip.
 *
 * Advisory only. The per-tile truth is `videos.boards`, which is what the
 * workspace renders from; this is for the glance.
 */
function deriveVideoStatus(boards) {
  const states = Object.values(boards || {}).map((b) => b?.status);
  if (!states.length) return "idle";
  if (states.includes("running")) return "running";
  if (states.includes("succeeded")) return "succeeded";
  return "failed";
}

/**
 * Writes one job's state into its module's section.
 *
 * @param {string} sessionId  The session `_id`.
 * @param {string} kind       An `AiJob` kind — decides which section is written.
 * @param {object} patch      {status, jobId, result, error, completedAt, requested}, all optional.
 * @returns {Promise<boolean>} Whether anything was actually written.
 */
async function mirrorJobResult(sessionId, kind, patch = {}) {
  const section = OnboardingSession.sectionForKind(kind);
  if (!sessionId || !section) {
    // An unmapped kind is a contract drift, not a runtime error: some new job
    // type exists that this service has never been told about. Loud in the log,
    // harmless to the request.
    logger.error("[sessionMirror] no section for kind", { sessionId, kind });
    return false;
  }

  const { status, jobId, result, error, completedAt, requested } = patch;
  const isTerminal = TERMINAL_STATUSES.has(status);

  // Boards whose money is decided by this callback. Filled in the videos block
  // and acted on only once the write has actually landed.
  const settlements = [];

  const set = { [`${section}.lastSyncedAt`]: new Date() };
  if (status) set[`${section}.status`] = status;
  if (jobId) set[`${section}.jobId`] = jobId;
  if (error) set[`${section}.error`] = String(error);
  // `undefined` means "nothing to say"; `null` from upstream means the same.
  if (result !== undefined && result !== null) set[`${section}.result`] = result;
  if (isTerminal) set[`${section}.completedAt`] = completedAt || new Date();
  if (section === "brand" && result) Object.assign(set, brandExtras(result));

  // ── Templates fold, everything else replaces ─────────────────────────────
  // One extra read, and only for the section that needs it. The read-then-write
  // is not atomic, so two pages landing in the same instant could lose one —
  // acceptable because pages are requested one at a time by a person clicking a
  // button, and the cost of getting it wrong is a missing row, not a corrupt
  // one. `stored` is what the caller emits, so the client is sent the whole
  // list rather than the single page that just arrived.
  if (section === "templates" && result !== undefined && result !== null) {
    const previous = await OnboardingSession.findOne({ sessionId })
      .select("templates.result templates.pagination")
      .lean();
    // The callback echoes back neither `limit` nor `skip`, so what we asked for
    // is only knowable from what we recorded when we asked. The trigger writes
    // the pending page onto the section before the call — through the database
    // rather than a module-level Map, so it survives a restart and holds when
    // the callback lands on a different instance from the one that triggered.
    const page = requested || previous?.templates?.pagination || {};
    const merged = mergeTemplatePage(previous?.templates?.result, result, page);
    if (merged) {
      set[`${section}.result`] = merged.result;
      set[`${section}.pagination`] = merged.pagination;
    }
  }

  // ── Videos are written PER BOARD ────────────────────────────────────────
  // Not folded into a shared array — see `videoBoardWrites` for why that would
  // lose a clip whenever two renders finish together, which is the normal case
  // once a user starts more than one.
  if (section === "videos") {
    // `result` never becomes a stored field for this section. It is derived
    // from the per-board keys on the way out, so there is no shared value for
    // concurrent callbacks to fight over.
    delete set[`${section}.result`];

    const previous = await OnboardingSession.findOne({ sessionId })
      .select("videos.boards")
      .lean();
    const previousBoards = previous?.videos?.boards || {};

    // One independent `$set` per board. Two callbacks for two different boards
    // touch two different keys and cannot collide, however close together they
    // land.
    const writes = videoBoardWrites(result, previousBoards, { jobId });
    Object.assign(set, writes);

    // A job that ended with no clip at all — upstream failed before producing
    // one, so nothing in the payload names the board. Without this the tile
    // that job belongs to stays `running` for ever: the spinner never stops,
    // and a reload brings it back.
    //
    // The board is found through the index, because the index is where we
    // recorded which board we started this job FOR.
    if (isTerminal && !Object.keys(writes).length && jobId) {
      for (const [id, entry] of Object.entries(previousBoards)) {
        if (entry?.jobId !== jobId || entry?.status !== "running") continue;
        set[`${section}.boards.${id}`] = {
          ...entry,
          status: "failed",
          error: error ? String(error) : "The render did not complete",
          updatedAt: new Date(),
        };
      }
    }

    // Advisory, and computed from a snapshot that a simultaneous callback may
    // already have moved on from. That is tolerated: it is the glance value,
    // the next write corrects it, and every screen that matters reads
    // `videos.boards` instead. What it must never do is claim the module is
    // finished while a board is still rendering — which is precisely what
    // copying this job's status would have done.
    const merged = { ...previousBoards };
    for (const [path, entry] of Object.entries(set)) {
      if (path.startsWith(`${section}.boards.`)) merged[path.split(".").pop()] = entry;
    }
    set[`${section}.status`] = deriveVideoStatus(merged);
    if (set[`${section}.status`] === "running") set[`${section}.completedAt`] = null;

    // Every board this callback moved to a terminal state, with how it was
    // paid for. Settled AFTER the write lands, below — settling first would
    // mean charging for a result we then failed to store.
    for (const [path, entry] of Object.entries(set)) {
      if (!path.startsWith(`${section}.boards.`)) continue;
      if (entry?.status !== "succeeded" && entry?.status !== "failed") continue;
      // Only boards that were still open. A redelivery rewrites a board that
      // already settled, and settling it twice would refund or charge again.
      if (previousBoards[path.split(".").pop()]?.status !== "running") continue;
      settlements.push({ boardId: path.split(".").pop(), entry });
    }
  }

  // The guard: refuse to move a finished section backwards. A non-terminal
  // write only applies while the section is still unfinished.
  //
  // `videos` is exempt, for the reason templates are exempt at the caller: the
  // section is never actually "finished" — it is a growing set of per-board
  // renders, and one board succeeding must not silence the progress of the next
  // one the user starts. Its real per-item guard is `videos.boards`, and its
  // idempotency comes from the board-keyed fold above rather than from this
  // filter.
  const filter = { sessionId };
  if (!isTerminal && section !== "videos") {
    filter[`${section}.status`] = { $nin: [...TERMINAL_STATUSES] };
  }

  try {
    const res = await OnboardingSession.updateOne(filter, { $set: set });
    if (res.matchedCount === 0) {
      // Debug-level: a skipped write is the guard doing its job, not an event.
      logger.debug("[sessionMirror] skipped", { sessionId, section, status, reason: "already terminal or unknown session" });
      return false;
    }

    // Money last, and only once the result is safely stored. A settle before
    // the write could charge for a clip we then failed to record; a settle
    // after a write that did not match would charge for nothing at all.
    //
    // Never allowed to fail the mirror: the result IS written by this point,
    // and throwing here would turn a billing hiccup into a lost clip. A hold
    // left open by a failure here is caught by the reservation sweeper.
    if (settlements.length) {
      // One read for all of them; the free-render un-claim needs the owner, and
      // nothing above this point had to know it.
      const owner = await OnboardingSession.findOne({ sessionId })
        .select("userId")
        .lean();

      for (const { boardId, entry } of settlements) {
        await settleBoard({
          sessionId,
          userId: owner?.userId,
          boardId,
          entry,
        }).catch((err) =>
          logger.error("[sessionMirror] settle failed", {
            sessionId,
            boardId,
            message: err.message,
          })
        );
      }
    }

    return true;
  } catch (err) {
    logger.error("[sessionMirror] write failed", { sessionId, section, message: err.message });
    return false;
  }
}

/** Marks a module as started. Called when a job is accepted, before any result. */
async function markSectionStarted(sessionId, kind, jobId) {
  const section = OnboardingSession.sectionForKind(kind);
  if (!sessionId || !section) return false;
  await OnboardingSession.updateOne(
    { sessionId },
    {
      $set: {
        [`${section}.status`]: "queued",
        [`${section}.jobId`]: jobId || "",
        [`${section}.startedAt`]: new Date(),
        // A re-run must not show the previous attempt's failure alongside the
        // new attempt's spinner.
        [`${section}.error`]: "",
        [`${section}.completedAt`]: null,
      },
    }
  );
  return true;
}

/**
 * Marks ONE board as rendering, without touching the rest of the section.
 *
 * `markSectionStarted` is wrong for videos and dangerously so: it resets
 * `status`, blanks `error` and clears `completedAt` for the WHOLE section, so
 * starting a render for board B would wipe the record of board A having
 * finished. Per-board work needs a per-board write.
 *
 * The section-level fields are still moved forward, because they are what a
 * list view reads at a glance — but only in the direction that stays true:
 * `running` while anything is in flight. Nothing here can un-finish a board.
 */
async function markBoardStarted(sessionId, boardId, jobId, billing = null, attempts = 1) {
  if (!sessionId || !boardId) return false;
  await OnboardingSession.updateOne(
    { sessionId },
    {
      $set: {
        [`videos.boards.${boardId}`]: {
          jobId: jobId || "",
          status: "running",
          error: "",
          version: 0,
          // How this render was paid for. Written here, at the only moment we
          // know it, because the webhook arrives with a job id and nothing
          // else — without this there is no way back to the reservation that
          // has to be settled or released, and a hold with no route to a
          // settle is a hold that sits until the sweeper refunds it.
          //
          // `{ renderId, free, amount }`. A free render carries no renderId to
          // settle; `free: true` is what tells the webhook to leave credits
          // alone and, on failure, to hand the freebie back instead.
          billing: billing || null,
          // How many times a render has been STARTED for this board, this one
          // included. The UI allows exactly one retry, and it cannot count
          // that itself: a reload rebuilds client state from the server, and a
          // client-side tally would hand the user a fresh retry every refresh
          // for a concept that is never going to render.
          attempts,
          updatedAt: new Date(),
        },
        // A summary, not a truth: the section is "running" while ANY board is.
        // Which board, and whether the others finished, is `videos.boards`.
        "videos.status": "running",
        "videos.jobId": jobId || "",
        "videos.startedAt": new Date(),
      },
    }
  );
  return true;
}

/**
 * Reads back one section's stored result and paging cursor.
 *
 * Exists for the templates path, which folds pages together on write: the
 * callback carries a single page, so the value worth emitting to the client is
 * the merged list this read returns, not the page the webhook was handed.
 */
async function readSection(sessionId, kind) {
  const section = OnboardingSession.sectionForKind(kind);
  if (!sessionId || !section) return null;
  const doc = await OnboardingSession.findOne({ sessionId }).select(section).lean();
  const stored = doc?.[section];
  if (!stored) return null;
  // `videos` has no stored `result` — the clips live one per board key, so that
  // simultaneous renders cannot overwrite each other. The array the contract
  // describes is assembled here, on the way out.
  if (section === "videos") {
    return { ...stored, result: videosResultFromBoards(stored.boards) };
  }
  return stored;
}

module.exports = {
  mirrorJobResult,
  markSectionStarted,
  markBoardStarted,
  readSection,
  mergeTemplatePage,
  videoBoardWrites,
  videosResultFromBoards,
  deriveVideoStatus,
  TERMINAL_STATUSES,
};
