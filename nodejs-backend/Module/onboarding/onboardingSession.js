/**
 * OnboardingSession — Node's mirror of a Python-owned onboarding run.
 *
 * Python (`ONBOARDING_INIT_API_CONTRACT.md`) is the system of record for the
 * brand context: it runs the research, merges it, embeds it, and serves it back
 * from `GET /api/v1/context/{session_id}`. This collection deliberately does
 * NOT try to replace that. It exists for the three things Python cannot answer,
 * because Python has no idea who an AdsGPT user is:
 *
 *   1. "Has this user onboarded, and what were their sessions?" Python keys
 *      everything on a `user_id` string we hand it; it has no user table and no
 *      way to enumerate ours. `GET /users/{user_id}/contexts` gets us close,
 *      but it can't survive us changing how user ids are shaped.
 *
 *   2. Resume after the browser loses `localStorage`. The contract tells the
 *      client to keep `session_id` + `job_id` itself. That's fine until someone
 *      clears storage, switches device, or opens the app on mobile mid-run —
 *      at which point the run is unreachable and they pay for a second one.
 *
 *   3. A join point for the next three modules. Templates, storyboarding and
 *      video generation all hang off "the brand this user onboarded with", and
 *      each of them needs a local id to reference, not a remote session string.
 *
 * The context snapshot below is a CACHE, not the truth. It is written
 * opportunistically when a terminal job result passes through Node, and it is
 * safe for it to be stale or empty — every read path can backfill from Python.
 * Treat a disagreement between this and `GET /context/{session_id}` as Python
 * being right.
 */

const mongoose = require("mongoose");
const { randomUUID } = require("node:crypto");

// Mirrors the contract's job status enum exactly. Node never invents a status;
// it copies whatever Python reported, so a new state added upstream shows up
// here as a validation error rather than being silently coerced to something
// wrong.
const JOB_STATUSES = ["queued", "running", "succeeded", "failed", "cancelled"];

// What the user attached, not the bytes themselves. We stream uploads straight
// through to Python and keep nothing (see the file-handling decision in the
// onboarding controller), so all we can honestly record is what was sent.
// Enough to render "you uploaded logo.png and a 4MB deck" on a resumed run.
const attachmentSchema = new mongoose.Schema(
  {
    fieldName: { type: String, default: "" },
    filename: { type: String, default: "" },
    mimeType: { type: String, default: "" },
    sizeBytes: { type: Number, default: 0 },
  },
  { _id: false }
);

const citationSchema = new mongoose.Schema(
  {
    title: { type: String, default: "" },
    uri: { type: String, default: "" },
  },
  { _id: false }
);

// ── Module sections ────────────────────────────────────────────────────────
//
// A session runs through four modules, and each of them succeeds or fails on
// its own: the brand can be researched while a storyboard is still rendering,
// and a failed storyboard says nothing about the brand. A single top-level
// `status`/`jobId` pair cannot express that — it was only ever correct while
// module 1 was the whole product. So each module gets its own section, all of
// them the same shape.
//
// `result` is Mixed for the same reason `context` always was: these payloads
// belong to Python's contracts, not ours. Typing them here would mean a schema
// migration every time DS adds a field, in exchange for validating data we do
// not own. The frontend reads their contract's shape.
const SECTION_STATUSES = ["idle", ...JOB_STATUSES];

const moduleSectionSchema = new mongoose.Schema(
  {
    // `idle` = never started. Distinct from `queued`, which means work exists.
    status: { type: String, enum: SECTION_STATUSES, default: "idle" },
    // The CURRENT job for this module. Overwritten on re-run, deliberately: an
    // old job id points at a superseded result.
    jobId: { type: String, default: "" },
    result: { type: mongoose.Schema.Types.Mixed, default: null },
    // Plain string: the upstream error envelope is `{"error": "..."}` with no
    // code to branch on, so inventing one here would be fiction.
    error: { type: String, default: "" },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    // When Python last told us something about THIS module. Distinct from the
    // document's `updatedAt`, which also moves for local bookkeeping.
    lastSyncedAt: { type: Date, default: null },
    // ── Paging, for the modules that have more than one page of result ──────
    //
    // Only `templates` uses this today. Upstream returns five recommendations
    // per call and takes `skip`, so "show me more" is another call with the
    // cursor moved along — and something has to remember where the cursor got
    // to across a reload, since the section is the only copy once upstream's
    // ten-minute cache expires.
    //
    // It lives on the section rather than inside `result` because `result` is
    // Mixed and belongs to Python's contract; this is our bookkeeping about
    // their contract, and mixing the two makes it impossible to tell which
    // fields we are allowed to change.
    pagination: {
      type: new mongoose.Schema(
        {
          // The `skip` and `limit` of the most recent page REQUESTED.
          skip: { type: Number, default: 0 },
          limit: { type: Number, default: 0 },
          // How many items are actually stored, after de-duplication. This is
          // the cursor: the next page starts here.
          loaded: { type: Number, default: 0 },
          // Upstream returned fewer than we asked for, or the contract's own
          // `skip` ceiling has been reached. Either way there is no next page.
          exhausted: { type: Boolean, default: false },
        },
        { _id: false }
      ),
      default: () => ({}),
    },

    // -- Per-board bookkeeping, for the module whose work is per-board -------
    //
    // Only `videos` uses this. A person renders concepts one at a time, so the
    // section holds MANY jobs' worth of work at once and the single `jobId` and
    // `status` above can only ever describe the most recent one. This is the
    // real per-item state:
    //
    //   { "<board_id>": { jobId, status, error, version, updatedAt } }
    //
    // It is what tells a reloaded page which tile is still rendering, which
    // failed and why, and which was never asked for at all -- none of which is
    // recoverable from `result.videos`, since that only lists clips that got
    // far enough to be produced.
    //
    // Mixed, keyed by an id we do not mint: a typed sub-schema would need a
    // migration for a shape whose keys are data.
    boards: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },

    // -- One retry for a template match that ERRORED --------------------
    //
    // Only `templates` uses this. A template run that fails is worth exactly
    // one more attempt, and that attempt cannot be a plain re-hit: upstream
    // caches on `(user, session, kind, limit, skip, threshold)`, so identical
    // params return the identical cached failure however fresh the
    // idempotency key is. The retry lowers the threshold, which both misses
    // the cache and widens the match.
    //
    // `attempted` is what stops a loop: the retry's own callback lands here
    // too, and without a flag a permanently failing match would retry for
    // ever. Stored on the session rather than in memory because the callback
    // may reach a different instance than the one that started the run.
    //
    // NOT used for an EMPTY result. A match that ran and found nothing has
    // answered the question, and asking again is how you retry for ever on a
    // brand that genuinely has no templates.
    retry: {
      type: new mongoose.Schema(
        {
          attempted: { type: Boolean, default: false },
          at: { type: Date, default: null },
          // What the retry asked for, so a surprising result set can be traced
          // back to the threshold that produced it.
          threshold: { type: Number, default: 0 },
        },
        { _id: false }
      ),
      default: () => ({}),
    },

    // ── Keyframe recovery, for `storyboards` ────────────────────────────────
    //
    // Keyframe rendering is best-effort upstream: a run finishes `succeeded`
    // with frames still `failed` (a transient model refusal, a timeout, a media
    // upload that did not land). Those are recoverable — `POST
    // /storyboards/retry-images` re-renders exactly the not-ready ones — so a
    // half-drawn storyboard is a reason to retry, not a reason to show the user
    // a broken card.
    //
    // While `attempts` is under the cap the section stays `running` and the
    // client keeps its placeholders. `exhausted` is what finally lets a failure
    // through: it means we tried, and this is as good as it gets.
    imageRetry: {
      type: new mongoose.Schema(
        {
          attempts: { type: Number, default: 0 },
          exhausted: { type: Boolean, default: false },
          lastAt: { type: Date, default: null },
          // The job we started for the most recent retry, so a callback can be
          // traced back to the attempt that asked for it.
          jobId: { type: String, default: "" },
        },
        { _id: false }
      ),
      default: () => ({}),
    },
  },
  { _id: false }
);

// The map that makes one webhook handler possible: a callback arrives carrying
// a `kind`, and this says which section its result belongs in. Adding a module
// means adding a line here — not a new branch in the handler.
const SECTION_BY_KIND = Object.freeze({
  "onboarding.init": "brand",
  "template.recommend": "templates",
  "storyboard.generate": "storyboards",
  "storyboard.regenerate": "storyboards",
  "storyboard.images.generate": "storyboards",
  "video.generate": "videos",
});

const MODULE_SECTIONS = Object.freeze(["brand", "templates", "storyboards", "videos"]);

const onboardingSessionSchema = new mongoose.Schema(
  {
    // `_id` is left alone — an ordinary ObjectId, like every other collection in
    // this codebase. It is OUR primary key and never leaves the building.
    //
    // ── sessionId: the id the outside world uses ─────────────────────────
    //
    // Node mints it, then hands it to the onboarding service as `session_id`.
    // Generated before the upstream call, which is what makes a lost or
    // timed-out `/init` response survivable: the run still completes upstream,
    // and we can still find it with `GET /context/{sessionId}` rather than
    // losing it entirely.
    //
    // A UUID v4 rather than the ObjectId, for two reasons that both matter:
    // the upstream schema declares `session_id` as `format: uuid`, and
    // ObjectIds embed a timestamp plus a counter, which makes them
    // semi-sequential. `GET /api/v1/context/{session_id}` upstream requires no
    // authentication at all, so a guessable id there is a way to read other
    // people's brand profiles.
    //
    // Keeping the two separate means the id we expose can be rotated, reissued
    // or re-scoped without touching the key every other document references.
    //
    // NOTE FOR ANY MIGRATION: a `sessionId_1` unique index already existed on
    // this collection once, left over from an earlier schema, and it broke
    // every insert after the first — a missing field indexes as `null`, and a
    // non-sparse unique index permits exactly one `null`. Safe here only
    // because `default` guarantees every document has a value. Never make this
    // field optional without making the index sparse in the same change.
    sessionId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      default: () => randomUUID(),
    },

    // From the JWT, never from the request body. Indexed because "list my
    // onboarding sessions" is the main query this collection exists to serve.
    userId: { type: String, required: true, index: true },

    // ── What the user gave us ────────────────────────────────────────────
    // Session-level, not module-level: this is what started the whole run, and
    // every later module reads from the brand context it produced rather than
    // from the raw prompt again.
    prompt: { type: String, default: "" },
    // URLs we extracted from the prompt and cleared through utils/safeUrl.
    // Stored post-validation, so anything in here has already been judged safe
    // to fetch — useful when a later module wants to re-scrape without
    // re-running the SSRF check on user-controlled text.
    sourceUrls: { type: [String], default: [] },
    attachments: { type: [attachmentSchema], default: [] },

    // ── The four modules ─────────────────────────────────────────────────
    // Every section is a CACHE of Python's result, never the source of truth.
    // Python serves `GET /context/{session_id}` and `GET /storyboards/?session_id=`
    // and owns edits to both. Treat a disagreement as Python being right.
    //
    // The exception is `templates`: Python caches recommendations for ten
    // minutes and nothing longer, so after that window this copy is the ONLY
    // copy. That section is a store, not a cache.
    brand: { type: moduleSectionSchema, default: () => ({}) },
    templates: { type: moduleSectionSchema, default: () => ({}) },
    storyboards: { type: moduleSectionSchema, default: () => ({}) },
    videos: { type: moduleSectionSchema, default: () => ({}) },

    // ── Denormalised for the list view ───────────────────────────────────
    // Copied out of `brand.result` when it lands. "Show me my sessions" must
    // not have to pull four Mixed blobs per row just to print a name, and these
    // two fields are the only ones a list ever shows.
    brandName: { type: String, default: "" },
    summary: { type: String, default: "" },

    // Provenance for the brand research. Kept at the top level rather than
    // inside `brand.result` because they describe how the SESSION was built —
    // which pages were read, what was searched — and stay meaningful after the
    // brand itself is re-run.
    citations: { type: [citationSchema], default: [] },
    searchQueries: { type: [String], default: [] },
    scraped: { type: Boolean, default: false },

    // ── Idempotency ──────────────────────────────────────────────────────
    // The client's `Idempotency-Key`. Recorded rather than enforced: Python
    // already honours the key and returns the ORIGINAL job on a retry, so the
    // expensive AI run is protected at the layer that pays for it. Storing it
    // lets us recognise a replay and avoid writing a duplicate mirror row.
    idempotencyKey: { type: String, default: "", index: true },

    // ── How this run ended ───────────────────────────────────────────────
    //
    // Set when the user leaves onboarding deliberately, by either door. The
    // per-user consequences (never offer onboarding again; is the free render
    // still unspent) live on UserProfile — this is the per-RUN record, and it
    // is what `GET /eligibility` reads to decide whether there is a session
    // worth resuming and which one.
    //
    // A session with no `exitReason` was not finished OR skipped: the user
    // simply closed the tab, and it is still the session to resume.
    exitedAt: { type: Date, default: null },
    // "completed" retires the banner; "skipped" keeps it, and keeps this
    // session as the resume target. See ONBOARDING_ENTRY_EXIT_CREDITS.md §5.
    exitReason: {
      type: String,
      enum: ["", "completed", "skipped"],
      default: "",
    },

  },
  { timestamps: true }
);

// The replay lookup: same user + same idempotency key = same run. Sparse so the
// many rows with no key (the header is "recommended", not required) don't all
// collide on empty string.
onboardingSessionSchema.index(
  { userId: 1, idempotencyKey: 1 },
  { sparse: true }
);

// "Show me this user's onboarding history, newest first" — the list view.
onboardingSessionSchema.index({ userId: 1, createdAt: -1 });

// One per section, so a callback carrying only a job id can find its session
// without a collection scan. Sparse: most sections are `idle` with an empty
// jobId, and those rows have no business in the index.
MODULE_SECTIONS.forEach((section) => {
  onboardingSessionSchema.index({ [`${section}.jobId`]: 1 }, { sparse: true });
});

// Any section that is mid-flight. This is the query the reconciler runs to find
// runs that were abandoned when a stream dropped or Node restarted.
MODULE_SECTIONS.forEach((section) => {
  onboardingSessionSchema.index({ [`${section}.status`]: 1, updatedAt: -1 });
});

/**
 * Finds the session a job belongs to, whichever module it came from.
 *
 * The webhook payload carries `session_id`, so the fast path is a plain `_id`
 * lookup. This exists for the paths that only have a job id — the client
 * polling `/onboarding/jobs/:jobId`, and any callback that arrives without a
 * session. `$or` across four sparse indexes is cheap and keeps the caller from
 * having to know which module a job belonged to.
 */
onboardingSessionSchema.statics.findByJobId = function findByJobId(jobId, userId) {
  const filter = { $or: MODULE_SECTIONS.map((s) => ({ [`${s}.jobId`]: jobId })) };
  if (userId) filter.userId = userId;
  return this.findOne(filter);
};

/** Which section a job's result belongs in. `null` for an unmapped kind. */
onboardingSessionSchema.statics.sectionForKind = function sectionForKind(kind) {
  return SECTION_BY_KIND[kind] || null;
};

const OnboardingSession = mongoose.model(
  "OnboardingSession",
  onboardingSessionSchema
);

module.exports = OnboardingSession;
module.exports.JOB_STATUSES = JOB_STATUSES;
module.exports.SECTION_STATUSES = SECTION_STATUSES;
module.exports.SECTION_BY_KIND = SECTION_BY_KIND;
module.exports.MODULE_SECTIONS = MODULE_SECTIONS;
