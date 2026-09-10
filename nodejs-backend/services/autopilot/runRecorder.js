/**
 * runRecorder — persist what a cycle is doing, while it is doing it.
 *
 * EVERY FUNCTION HERE SWALLOWS ITS OWN ERRORS, on purpose. This is telemetry
 * about a job that moves real money; it must never be the reason that job
 * fails. A dropped run row costs us a line in a dashboard. A throw from a
 * dropped run row would cost an account its cycle. The same rule the Meta
 * usage recorder follows, for the same reason.
 *
 * The writes are deliberately small and incremental — `$inc` and `$push`
 * rather than read-modify-write — so a cycle updating its own row cannot
 * clobber a concurrent update, and so the cost per account stays flat as the
 * accounts array grows.
 */

const os = require("node:os");
const AutopilotRun = require("../../Module/autopilot/autopilotRun");

function getLogger() {
  try {
    return require("../../utils/logger");
  } catch {
    return console;
  }
}

/** Telemetry failures are logged once at debug volume, never rethrown. */
function swallow(what, err) {
  try {
    getLogger().warn(`[autopilot run-record] ${what} failed (ignored): ${err.message}`);
  } catch {
    /* logging about failed logging is where this stops */
  }
}

/**
 * Classify how an account ended, from the error text the orchestrator already
 * produces. Reading the message is unlovely, but the alternative is threading
 * a status through several layers that have no other reason to know — and
 * these three shapes are generated in exactly one place each.
 */
function classifyAccountOutcome(acct) {
  if (acct.ok !== false) return "ok";
  const msg = String(acct.error || "");
  // withDeadline's message. See services/autopilot/withDeadline.js.
  if (/exceeded \d+ms/.test(msg)) return "timeout";
  // The rate-limiter pre-flight skip in processAccount.
  if (/Meta rate limit/i.test(msg)) return "rate-limited";
  return "failed";
}

/** Open the row. Called once the lock is held and the run is really starting. */
async function startRun({ runId, dryRun, startedAt }) {
  try {
    await AutopilotRun.create({
      runId,
      startedAt: new Date(startedAt),
      status: "running",
      dryRun: !!dryRun,
      host: os.hostname(),
      pid: process.pid,
      heartbeatAt: new Date(),
    });
  } catch (err) {
    swallow("startRun", err);
  }
}

/**
 * Record what the cycle has decided to do, before it does any of it.
 *
 * Separate from `startRun` because the totals are only known after rules are
 * loaded and grouped — and writing them the moment they ARE known is what
 * makes progress a fraction (`accountsDone / totalAccounts`) instead of a
 * bare count that only means something once the run is over.
 */
async function recordPlan({ runId, totalUsers, totalAccounts, totalRules }) {
  try {
    await AutopilotRun.updateOne(
      { runId },
      { $set: { totalUsers, totalAccounts, totalRules, heartbeatAt: new Date() } },
    );
  } catch (err) {
    swallow("recordPlan", err);
  }
}

/**
 * One account finished — well or badly. Pushes its outcome and bumps progress.
 *
 * The heartbeat is refreshed here rather than on a timer: a cycle that stops
 * completing accounts has stopped doing anything useful, whether or not its
 * process is still alive, and that is the condition the live view needs to
 * surface.
 */
async function recordAccount({ runId, acctSummary, durationMs }) {
  try {
    const outcome = classifyAccountOutcome(acctSummary);
    const pause = acctSummary.pause || {};
    const resume = acctSummary.resume || {};
    const scale = acctSummary.scale || {};
    await AutopilotRun.updateOne(
      { runId },
      {
        $inc: { accountsDone: 1 },
        $set: { heartbeatAt: new Date() },
        $push: {
          accounts: {
            adAccountId: acctSummary.adAccountId,
            adAccountName: acctSummary.name || undefined,
            ownerUserId: acctSummary.ownerUserId,
            ok: acctSummary.ok !== false,
            durationMs,
            auditCount: acctSummary.auditCount || 0,
            paused: pause.paused || 0,
            resumed: resume.resumed || 0,
            scaled: scale.scaled || 0,
            // Dry-run counters live on separate fields. Without these a
            // rehearsal reports the same zeroes as an idle cycle, which is
            // the one thing a rehearsal must not do.
            wouldPause: pause.would_pause || 0,
            wouldResume: resume.would_resume || 0,
            wouldScale: scale.would_scale || 0,
            failed: (pause.failed || 0) + (resume.failed || 0) + (scale.failed || 0),
            error: acctSummary.error || undefined,
            outcome,
          },
        },
      },
    );
  } catch (err) {
    swallow("recordAccount", err);
  }
}

/**
 * A user skipped before any of their accounts was reached.
 *
 * Recorded because the alternative is a run that says `complete` and `clean`
 * while eleven of twelve accounts went untouched: `totalAccounts` counts the
 * skipped user's accounts, `accountsDone` does not, and without this there is
 * no row anywhere explaining the gap.
 */
async function recordSkippedUser({ runId, userId, reason, accounts = 0 }) {
  try {
    await AutopilotRun.updateOne(
      { runId },
      {
        $push: { usersSkipped: { userId, reason, accounts } },
        $set: { heartbeatAt: new Date() },
      },
    );
  } catch (err) {
    swallow("recordSkippedUser", err);
  }
}

/** Close the row out, with the rollups the history table renders from. */
async function finishRun({ runId, status, durationMs, summaries = [], error }) {
  try {
    const roll = {
      accountsOk: 0,
      accountsFailed: 0,
      accountsTimedOut: 0,
      accountsRateLimited: 0,
      totalPaused: 0,
      totalResumed: 0,
      totalScaled: 0,
      totalWouldPause: 0,
      totalWouldResume: 0,
      totalWouldScale: 0,
    };
    for (const s of summaries) {
      const outcome = classifyAccountOutcome(s);
      if (outcome === "ok") roll.accountsOk += 1;
      else if (outcome === "timeout") roll.accountsTimedOut += 1;
      else if (outcome === "rate-limited") roll.accountsRateLimited += 1;
      else roll.accountsFailed += 1;
      roll.totalPaused += (s.pause && s.pause.paused) || 0;
      roll.totalResumed += (s.resume && s.resume.resumed) || 0;
      roll.totalScaled += (s.scale && s.scale.scaled) || 0;
      roll.totalWouldPause += (s.pause && s.pause.would_pause) || 0;
      roll.totalWouldResume += (s.resume && s.resume.would_resume) || 0;
      roll.totalWouldScale += (s.scale && s.scale.would_scale) || 0;
    }
    await AutopilotRun.updateOne(
      { runId },
      {
        $set: {
          status,
          durationMs,
          finishedAt: new Date(),
          heartbeatAt: new Date(),
          error: error || undefined,
          ...roll,
        },
      },
    );
  } catch (err) {
    swallow("finishRun", err);
  }
}

/**
 * A tick that never ran because another holds the lock.
 *
 * Recorded rather than dropped: a steady drip of these is how you discover a
 * second scheduler racing the first — the exact condition behind the "ran
 * twice in an hour" pattern, where a developer's local backend shares the
 * production Redis.
 */
async function recordSkippedRun({ runId, reason, dryRun }) {
  try {
    await AutopilotRun.create({
      runId,
      startedAt: new Date(),
      finishedAt: new Date(),
      durationMs: 0,
      status: "skipped",
      skipReason: reason,
      dryRun: !!dryRun,
      host: os.hostname(),
      pid: process.pid,
    });
  } catch (err) {
    swallow("recordSkippedRun", err);
  }
}

module.exports = {
  startRun,
  recordPlan,
  recordAccount,
  recordSkippedUser,
  finishRun,
  recordSkippedRun,
  _internals: { classifyAccountOutcome },
};
