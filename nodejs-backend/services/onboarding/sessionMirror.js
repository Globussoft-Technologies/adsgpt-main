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
const { asClipBoard } = require("./templateAdResult");

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
function mergeTemplatePage(previous, rawIncoming, requested = {}) {
  const incoming = normalizeTemplateResult(rawIncoming);
  const incomingList = Array.isArray(incoming?.templates) ? incoming.templates : null;
  if (!incomingList) return null;

  // A refresh asks for a NEW match, and upstream's media links rotate between
  // runs — folding would keep the stale link for every id already stored.
  // So a refresh replaces the list outright; only "load more" pages fold.
  const replace = Boolean(requested.replace);
  const previousList =
    !replace && Array.isArray(previous?.templates) ? previous.templates : [];
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

  // One call pages BOTH corpora with the same `skip`/`limit`, so each is counted
  // on its own. The cursor follows the deeper one, and the rail is exhausted
  // only when NEITHER filled the page — a brand with no video matches must
  // still be able to page through its images.
  const isImage = (t) => t?.media_type === "image";
  const countBy = (list) => {
    const images = list.filter(isImage).length;
    return { images, videos: list.length - images };
  };
  const held = countBy(templates);
  const got = countBy(incomingList);

  return {
    // How many items this page actually contributed after de-duplication.
    added: added.length,
    result: {
      // The newest page's envelope wins for everything except the list itself —
      // `count`, `near_count` and `message` describe the most recent match, and
      // there is no meaningful way to add two of them together.
      ...(replace ? {} : previous || {}),
      ...incoming,
      templates,
    },
    pagination: {
      skip: Number(requested.skip) || 0,
      limit,
      loaded: Math.max(held.videos, held.images),
      // Fewer back than asked for means the corpus is out of candidates. The
      // `skip` ceiling is the contract's, and is enforced by the caller that
      // asks for the next page rather than here.
      //
      // Also exhausted when a "load more" page added NOTHING new. Upstream
      // ignores `skip` for images (verified 2026-09-17: skip=20 returns the
      // same images as skip=0), so a full-looking page can be all duplicates —
      // and without this the rail kept asking forever, showing a loader that
      // never produced a tile.
      exhausted:
        (limit > 0 && got.videos < limit && got.images < limit) ||
        (!replace && previousList.length > 0 && added.length === 0),
    },
  };
}

/**
 * One list for both corpora, each item tagged with `media_type`.
 *
 * Upstream reports video matches as `templates` and image creatives as
 * `image_templates` (separate SSE events, separate keys on the callback). The
 * workspace renders them in one rail, so they are stored together. Upstream
 * does not send a type key today; if it ever does (`media_type` / `type`), that
 * wins over the one inferred from which array the item came from.
 *
 * Image creatives have no `template_id`; `sha256` (else `image_url`) stands in,
 * so de-duplication and React keys keep working.
 */
function normalizeTemplateResult(result) {
  if (!result || typeof result !== "object") return result;
  const hasVideos = Array.isArray(result.templates);
  const hasImages = Array.isArray(result.image_templates);
  if (!hasImages && !hasVideos) return result;

  const tag = (t, fallback) => ({
    ...t,
    media_type: t?.media_type || (["image", "video"].includes(t?.type) ? t.type : fallback),
  });

  const videos = (result.templates || []).map((t) => tag(t, "video"));
  const images = (result.image_templates || []).map((t) =>
    tag({ ...t, template_id: t?.template_id || t?.sha256 || t?.image_url }, "image")
  );

  const { image_templates: _drop, ...rest } = result;
  const merged = [...videos, ...images];
  // Only a raw page (still carrying `image_templates`) is re-ranked. A stored,
  // already-normalized result is several pages folded together, and the latest
  // page's `results` would reshuffle tiles that earlier pages placed.
  return { ...rest, templates: hasImages ? orderByRank(merged, result.results) : merged };
}

/**
 * Orders the page by upstream's `results[]` rank so videos and images
 * interleave as the reranker scored them, instead of all videos then all images.
 *
 * `results[]` items are `{rank, kind, score, video|image}` and name the same
 * templates the SSE events delivered. Matched by `template_id`, falling back to
 * the media URL (image creatives may lack an id upstream). Anything in the list
 * that `results` does not mention keeps its place after the ranked ones; with no
 * usable `results`, the list is returned unchanged.
 */
function orderByRank(list, results) {
  if (!Array.isArray(results) || results.length === 0) return list;

  const keysOf = (t) =>
    [t?.template_id, t?.sha256, t?.image_url, t?.video_url].filter(Boolean);
  const byKey = new Map();
  list.forEach((t) => keysOf(t).forEach((k) => byKey.has(k) || byKey.set(k, t)));

  const placed = new Set();
  const ranked = [];
  [...results]
    .sort((a, b) => (Number(a?.rank) || Infinity) - (Number(b?.rank) || Infinity))
    .forEach((r) => {
      const payload = r?.[r?.kind] || r?.video || r?.image;
      const hit = keysOf(payload).map((k) => byKey.get(k)).find(Boolean);
      if (hit && !placed.has(hit)) {
        placed.add(hit);
        ranked.push(hit);
      }
    });

  return [...ranked, ...list.filter((t) => !placed.has(t))];
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

  for (const raw of incoming) {
    // The two video routes put different things in `videos[]` — a board wrapper
    // for a storyboard, the bare clip for a recreate. Normalised to the wrapper
    // so everything below (and every reader of the stored board) sees one shape.
    const item = asClipBoard(raw);
    // `meta.boardId` OVERRIDES the id in the payload, and a recreate needs it to.
    //
    // A storyboard render is keyed by the board the user picked and upstream
    // echoes that same id straight back, so the payload's `board_id` IS the key.
    // A recreate is keyed by the TEMPLATE (`recreate:<templateId>`) while DS
    // mints its own uuid per render — so keying on the payload wrote a SECOND,
    // orphan board under that uuid: no billing (the lookup below found nothing
    // to carry forward), while the real board sat at `running` for ever and its
    // hold was never settled, only swept an hour later.
    const boardId = meta.boardId || item?.board_id;
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
    if (merged && !requested && merged.added === 0) {
      // The webhook backup replaying what the stream already stored. Nothing
      // to add, and it must not recompute paging — it would read as "a page of
      // duplicates" and end paging after the very first page.
      delete set[`${section}.result`];
    } else if (merged) {
      set[`${section}.result`] = merged.result;
      set[`${section}.pagination`] = merged.pagination;
    } else {
      // Not a recognisable page (e.g. a shape upstream added later). Writing
      // it raw would REPLACE the stored list and blank the rail — which is
      // exactly how an image-only callback used to erase the video templates.
      delete set[`${section}.result`];
    }
  }

  // ── Board-keyed sections are written PER BOARD ──────────────────────────
  // Not folded into a shared array — see `videoBoardWrites` for why that would
  // lose a clip whenever two renders finish together, which is the normal case
  // once a user starts more than one.
  //
  // `recreates` takes the same path, and MUST: this block is where a terminal
  // callback is turned into a settle. Left out of it, a recreate would freeze
  // credits and never release them — the hold would sit until a sweeper that is
  // not scheduled anywhere eventually caught it.
  //
  // Its per-board WRITES come from `templateAdResult` instead (an image result
  // is not shaped like a clip, so `videoBoardWrites` finds nothing in it). What
  // this block still does for it is the failure path and the money.
  if (section === "videos" || section === "recreates") {
    // `result` never becomes a stored field for this section. It is derived
    // from the per-board keys on the way out, so there is no shared value for
    // concurrent callbacks to fight over.
    delete set[`${section}.result`];

    const previous = await OnboardingSession.findOne({ sessionId })
      .select(`${section}.boards`)
      .lean();
    const previousBoards = previous?.[section]?.boards || {};

    // One independent `$set` per board. Two callbacks for two different boards
    // touch two different keys and cannot collide, however close together they
    // land.
    // `videoBoardWrites` keys on `videos.boards.…`; a recreate's entries live
    // under its own section. Rewritten rather than parameterised, because the
    // helper is shared with a path that has no section to be told about.
    //
    // WHICH BOARD THIS JOB IS FOR. Only `recreates` needs telling: its keys are
    // ours and the payload's are DS's (see `videoBoardWrites`). Found through
    // the job index, which is where we recorded what we started this job FOR —
    // the same handle the terminal-with-no-board fallback below uses. One
    // render per recreate job (`VARIATIONS` is 1), so one board to find.
    const ourBoardId =
      section === "recreates"
        ? Object.keys(previousBoards).find((id) => previousBoards[id]?.jobId === jobId)
        : undefined;
    if (section === "recreates" && jobId && !ourBoardId) {
      // Falling back to DS's id is what produced the orphan board this exists to
      // prevent, so say so — the clip is still stored rather than dropped, but
      // its money will need looking at.
      logger.error("[sessionMirror] recreate board not found for job", { sessionId, jobId });
    }
    const writes = videoBoardWrites(result, previousBoards, { jobId, boardId: ourBoardId });
    for (const [path, entry] of Object.entries(writes)) {
      set[path.replace(/^videos\./, `${section}.`)] = entry;
    }

    // A terminal job whose payload names no board. Without this the tile that
    // job belongs to stays `running` for ever: the spinner never stops, and a
    // reload brings it back.
    //
    // The board is found through the index, because the index is where we
    // recorded which board we started this job FOR.
    //
    // THE OUTCOME COMES FROM THE JOB, not from the empty payload. This used to
    // write "failed" unconditionally, on the assumption that no clip in the
    // result meant no clip was rendered. That holds for a storyboard and is
    // simply untrue for an image recreate: an image result has no `videos[]`
    // and never will, so `videoBoardWrites` finds nothing for a render that
    // succeeded perfectly. Every successful image recreate was therefore marked
    // failed here and REFUNDED — the user was handed a finished ad, told it had
    // failed, and not charged for it.
    if (isTerminal && !Object.keys(writes).length && jobId) {
      const jobSucceeded = status === "succeeded";
      for (const [id, entry] of Object.entries(previousBoards)) {
        if (entry?.jobId !== jobId || entry?.status !== "running") continue;
        set[`${section}.boards.${id}`] = {
          ...entry,
          status: jobSucceeded ? "succeeded" : "failed",
          // A board that succeeded carries no error, even if the section does
          // (a previous attempt's message can still be sitting there).
          error: jobSucceeded ? "" : error ? String(error) : "The render did not complete",
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
  if (!isTerminal && section !== "videos" && section !== "recreates") {
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
async function markBoardStarted(
  sessionId,
  boardId,
  jobId,
  billing = null,
  attempts = 1,
  // Which section this render belongs to. `videos` is the storyboard clips;
  // `recreates` is ads built from a reference template. They are kept apart
  // because both sections derive a status and a result list from
  // `Object.values(boards)` — sharing one map would make a running recreate
  // report the storyboard module as running, and put an image into the
  // session's list of clips.
  section = "videos",
) {
  if (!sessionId || !boardId) return false;
  await OnboardingSession.updateOne(
    { sessionId },
    {
      $set: {
        [`${section}.boards.${boardId}`]: {
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
          // WHEN THIS RENDER WAS STARTED, and never written again.
          // `updatedAt` moves every time the board is touched, so ordering a
          // list on it makes a card jump position the moment its render
          // finishes. The clip strip orders on this instead, and nothing under
          // the user's cursor moves.
          //
          // A retry legitimately resets it: that IS a new render.
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        // A summary, not a truth: the section is "running" while ANY board is.
        // Which board, and whether the others finished, is `<section>.boards`.
        [`${section}.status`]: "running",
        [`${section}.jobId`]: jobId || "",
        [`${section}.startedAt`]: new Date(),
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
  // Both board-keyed sections assemble their result the same way: the entries
  // live one per board key so simultaneous renders cannot overwrite each other,
  // and the array the contract describes is built here, on the way out.
  if (section === "videos" || section === "recreates") {
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
  normalizeTemplateResult,
  videoBoardWrites,
  videosResultFromBoards,
  deriveVideoStatus,
  TERMINAL_STATUSES,
};
