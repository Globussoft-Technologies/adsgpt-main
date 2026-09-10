/**
 * flowLog — structured, greppable logging for the onboarding / AI-job flow.
 *
 * Why this exists rather than calling `logger` directly:
 *
 * `utils/logger.js` formats with
 *     printf(({ level, message, timestamp, stack }) => ...)
 * which reads ONLY `message`. Winston merges a metadata object into `info`, but
 * that formatter never prints it — so `logger.info("saved", { jobId })` writes
 * "saved" and throws the jobId away. Every call site that passes an object is
 * quietly logging nothing useful.
 *
 * Rather than change the global formatter (which would suddenly widen every log
 * line in the app, including places that pass large objects), this flattens the
 * context INTO the message. The output is one line per event, in a shape that
 * greps and reads well:
 *
 *     [onboarding.init] upstream.accepted user=GPT-1042 session=052a9fa0 job=567ed222 ms=412
 *
 * Conventions, so the logs stay useful at volume:
 *
 *   • `scope.event` is stable and lowercase — you can grep one stage across a day
 *   • ids are truncated to 8 chars; full ids are recoverable from the row
 *   • durations are always `ms=`
 *   • NEVER log prompt text, file contents, tokens or secrets. Log sizes and
 *     counts instead — a prompt can carry personal data and a token is a
 *     credential that would then sit in a file for 10 days.
 */

const fs = require("fs");
const path = require("path");
const logger = require("./logger");

/* ── the flow tape ────────────────────────────────────────────────────────────
   Every flow event is ALSO appended here as one JSON object per line.

   The daily log is the whole application — autopilot ticks, HTTP noise, every
   other module — and an onboarding run is maybe thirty lines scattered through
   thousands. Grepping `[onboarding.init]` gets you the lines but not the shape:
   you still cannot see which session they belong to, what order the stages ran
   in, or where the seconds went.

   So the same events go to a second file that contains nothing else, in a form
   a program can group. `scripts/flowReport.js` turns it into an HTML timeline —
   one block per session, stages in order, with the gaps between them.

   Best effort by design: a logging sink must never be able to fail a request,
   so every error here is swallowed. Nothing reads this file at runtime.       */
const TAPE = path.join(__dirname, "../logs/onboarding-flow.jsonl");

// Rotated by size rather than by date. A flow tape is a debugging aid you read
// within minutes of the run; keeping ten days of it would just make the report
// slow to open. One previous file is enough to survive a rollover mid-session.
const TAPE_MAX_BYTES = 5 * 1024 * 1024;

function appendTape(record) {
  try {
    const dir = path.dirname(TAPE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(TAPE) && fs.statSync(TAPE).size > TAPE_MAX_BYTES) {
      fs.renameSync(TAPE, `${TAPE}.1`);
    }
    fs.appendFileSync(TAPE, JSON.stringify(record) + "\n");
  } catch {
    // Never let logging break the caller.
  }
}

// Long enough to identify a record in a day's logs, short enough to keep lines
// readable. The full value is always in Mongo if it is needed.
const SHORT = 8;

function short(value) {
  const s = String(value ?? "");
  return s.length > SHORT ? s.slice(0, SHORT) : s;
}

/**
 * Flattens context into `key=value` pairs.
 *
 * Empty, null and undefined values are dropped so absent fields do not clutter
 * the line. Strings with spaces are quoted so a message field cannot be
 * mistaken for more key=value pairs when read back.
 */
function fmt(fields = {}) {
  return Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => {
      const s = typeof v === "object" ? JSON.stringify(v) : String(v);
      return s.includes(" ") ? `${k}="${s}"` : `${k}=${s}`;
    })
    .join(" ");
}

/* ── What actually reaches the log file ─────────────────────────────────
   An onboarding run used to write ~30 lines: every stage, every bridge, every
   fold. Useful while the flow was being built, noise now that it works — the
   question a running system gets asked is only ever "did we call DS, and did DS
   call us", and that answer was buried.

   So the LOG keeps two kinds of line:

     • the DS boundary, both directions (`log.ds`)
     • anything that failed

   Everything else still goes to the flow tape, which is a separate file nobody
   reads at runtime and which `scripts/flowReport.js` turns into a timeline. So
   nothing is lost — the detail moved to where detail belongs, and the log now
   reads as a list of API hits.

   Flip this to false and every stage comes back.                              */
const BOUNDARY_ONLY = true;

// The two events `log.ds` emits. Named here so the filter cannot drift from
// the emitter.
const DS_OUT = "ds.call";
const DS_IN = "ds.callback";

function line(scope, event, fields) {
  const tail = fmt(fields);
  return `[${scope}] ${event}${tail ? " " + tail : ""}`;
}

/**
 * A logger bound to one scope and a set of ids carried on every line.
 *
 * Created once per request or per background task, so the ids do not have to be
 * repeated at every call site — which is what makes people stop including them.
 */
function createFlowLog(scope, base = {}) {
  const ctx = {
    ...(base.user ? { user: base.user } : {}),
    ...(base.session ? { session: short(base.session) } : {}),
    ...(base.job ? { job: short(base.job) } : {}),
    ...(base.req ? { req: base.req } : {}),
  };
  // Full, untruncated ids for the tape. `ctx` deliberately holds the 8-char
  // form because that is what keeps a log LINE readable — but a report that
  // groups by session needs the real thing, and `bind()` can supply it later.
  const full = { session: base.session || "", job: base.job || "" };
  const startedAt = Date.now();

  const emit = (level, event, fields) => {
    const merged = { ...ctx, ...fields };

    // The tape gets everything, always (below). The log gets the boundary and
    // failures only — see BOUNDARY_ONLY.
    const isBoundary = event === DS_OUT || event === DS_IN;
    // Errors survive the filter and warnings do not, deliberately. A warning
    // here is almost always a normal outcome with an unhappy name — a duplicate
    // callback, a skipped bridge, a 4xx from a client — and printing those puts
    // the noise straight back. An error is something that actually broke.
    if (!BOUNDARY_ONLY || isBoundary || level === "error") {
      logger[level](line(scope, event, merged));
    }
    // The tape keeps the FULL session id, not the 8-char one. Grouping is the
    // report's entire job, and a truncated id would collide across days.
    // `merged` is spread FIRST so the full ids below overwrite the truncated
    // ones it carries — the other way round and the tape stores 8 characters,
    // which is exactly what it exists not to do.
    appendTape({
      t: new Date().toISOString(),
      level,
      scope,
      event,
      ...merged,
      session: full.session || merged.session || "",
      job: full.job || merged.job || "",
    });
  };

  return {
    /**
     * The DS boundary — the one thing the log is for.
     *
     *   log.ds("out", "videos")   →  [videos] ds.call dir=out api=videos session=de8156cd
     *   log.ds("in",  "video.generate")
     *
     * `dir` rather than two method names so a single grep (`ds.call|ds.callback`,
     * or just `ds.`) shows both halves of a run interleaved in time order,
     * which is how you actually read "we asked, they answered".
     *
     * Deliberately takes no response body and no result. What went over the
     * wire is the tape's job; this line answers "was it hit, and for which
     * session".
     */
    ds: (direction, api, fields = {}) =>
      emit("info", direction === "in" ? DS_IN : DS_OUT, { dir: direction, api, ...fields }),

    info: (event, fields) => emit("info", event, fields),
    warn: (event, fields) => emit("warn", event, fields),
    error: (event, fields) => emit("error", event, fields),

    /** Milliseconds since this flow log was created. */
    elapsed: () => Date.now() - startedAt,

    /** Adds ids that were not known when the flow started (job/session ids). */
    bind(extra = {}) {
      if (extra.session) {
        ctx.session = short(extra.session);
        full.session = extra.session;
      }
      if (extra.job) {
        ctx.job = short(extra.job);
        full.job = extra.job;
      }
      if (extra.user) ctx.user = extra.user;
      return this;
    },

    /**
     * The closing line for a request. `ok` for 2xx, `warn` for 4xx, `error` for
     * 5xx — so a level filter alone separates "the user did something wrong"
     * from "we did".
     */
    done(status, fields = {}) {
      const level = status >= 500 ? "error" : status >= 400 ? "warn" : "info";
      emit(level, "done", { status, ms: Date.now() - startedAt, ...fields });
      return status;
    },
  };
}

/** A short correlation id, for the window before a job id exists. */
function newReqId() {
  return Math.random().toString(36).slice(2, 8);
}

module.exports = {
  createFlowLog,
  newReqId,
  short,
  _internals: { fmt, line, BOUNDARY_ONLY, DS_OUT, DS_IN },
};
