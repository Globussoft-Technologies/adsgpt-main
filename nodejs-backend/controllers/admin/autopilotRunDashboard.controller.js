/**
 * Admin dashboard for Autopilot runs — what the cron is doing right now, and
 * what it did on every previous tick.
 *
 * WHY THIS IS NOT BUILT ON THE ACTION LOG. `autopilotActionLog` is a record of
 * ACTIONS, so it is structurally blind to the two questions this page exists
 * to answer. A cycle that walks a hundred accounts and matches nothing writes
 * zero rows, making a healthy quiet run indistinguishable from a run that
 * never started; and account-level failures never reach it at all, because
 * they live on an in-memory summary that dies with the Telegram digest. Both
 * gaps were confirmed the hard way — see the header of Module/autopilot/
 * autopilotRun.js.
 *
 * LIVENESS COMES FROM TWO INDEPENDENT SIGNALS, and the difference matters.
 * `autopilot:lock` in Redis says a process believes it is running; the run
 * row's `heartbeatAt` says a process has recently finished an account. A run
 * that holds the lock with a stale heartbeat is the interesting case — a cycle
 * that died mid-flight and will keep the next hour out until the lock's TTL
 * expires. Reporting only `status` would show that as a permanently "running"
 * cycle, which is exactly the confusion this page is meant to remove.
 */
const AutopilotRun = require("../../Module/autopilot/autopilotRun");
const { redisClient } = require("../../db/redis");
const {
  _internals: { LOCK_KEY },
} = require("../../services/autopilot/userRuleOrchestrator");

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 200;
// A run whose last completed account is older than this is not making
// progress. Deliberately generous: it must exceed the per-account deadline
// (AUTOPILOT_ACCOUNT_TIMEOUT_MS, 120s) or a single slow-but-healthy account
// would be reported as a stall.
const STALE_HEARTBEAT_MS = 5 * 60 * 1000;

function clampLimit(raw) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

/**
 * Ask Redis whether a cycle currently holds the lock.
 *
 * Fails OPEN, returning null rather than throwing: Redis being unreachable is
 * a reason to show less on this page, never a reason to fail the request. The
 * caller renders "unknown" and the run history below is still useful.
 */
async function readLock() {
  try {
    const runId = await redisClient.get(LOCK_KEY);
    if (!runId) return { held: false, runId: null };
    let ttlSeconds = null;
    try {
      const ttl = await redisClient.ttl(LOCK_KEY);
      ttlSeconds = ttl >= 0 ? ttl : null;
    } catch {
      /* TTL is a nicety; the holder is the signal */
    }
    return { held: true, runId, ttlSeconds };
  } catch {
    return null;
  }
}

function decorateRun(run, now) {
  if (!run) return null;
  const { _id, accounts, ...rest } = run;
  const heartbeatAgeMs = run.heartbeatAt
    ? now - new Date(run.heartbeatAt).getTime()
    : null;
  return {
    ...rest,
    accounts: accounts || [],
    heartbeatAgeMs,
    // Only meaningful while `running`; a finished run's heartbeat is just its
    // finish time.
    stalled:
      run.status === "running" &&
      heartbeatAgeMs !== null &&
      heartbeatAgeMs > STALE_HEARTBEAT_MS,
    // accountsDone + skipped users' accounts should equal totalAccounts.
    // Anything left over is unaccounted for, and saying so beats a silently
    // wrong-looking "1 / 12".
    accountsSkippedByUser: (run.usersSkipped || []).reduce(
      (sum, u) => sum + (u.accounts || 0),
      0,
    ),
    usersSkipped: run.usersSkipped || [],
    progressPct:
      run.totalAccounts > 0
        ? Math.min(100, Math.round((run.accountsDone / run.totalAccounts) * 100))
        : null,
    elapsedMs:
      run.durationMs != null
        ? run.durationMs
        : now - new Date(run.startedAt).getTime(),
  };
}

/**
 * GET /admin/autopilot-runs/live
 *
 * The small, cheap payload the page polls on a short interval. Deliberately
 * excludes the per-account array of finished runs — only the in-flight run
 * carries its accounts, because that is the only one whose detail changes.
 */
exports.live = async (req, res, next) => {
  try {
    const now = Date.now();
    const lock = await readLock();

    // The in-flight run, if there is one. Matched on status rather than on the
    // lock's runId so a crashed cycle that never released the lock is still
    // found — and so a run is still shown when Redis is unreachable.
    const runningRaw = await AutopilotRun.findOne({ status: "running" })
      .sort({ startedAt: -1 })
      .lean();
    const running = decorateRun(runningRaw, now);

    const lastRaw = await AutopilotRun.findOne({
      status: { $in: ["complete", "failed"] },
    })
      .sort({ startedAt: -1 })
      .lean();
    const last = decorateRun(lastRaw, now);
    // The account array on a finished run is only wanted on the detail view.
    if (last) last.accounts = undefined;

    res.json({
      success: true,
      data: {
        lock,
        running,
        last,
        // How fast the client should come back. A cycle in flight is worth
        // watching closely; an idle hour is not, and polling a once-hourly job
        // every three seconds for fifty-seven minutes is pure waste.
        pollMs: running ? 3000 : 30000,
        staleHeartbeatMs: STALE_HEARTBEAT_MS,
        serverTime: new Date(now).toISOString(),
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /admin/autopilot-runs
 *
 * Run history, newest first. This is the table that answers "what does a cycle
 * actually cost us" — the measurement the scaling plan's capacity estimate is
 * waiting on.
 */
exports.list = async (req, res, next) => {
  try {
    const now = Date.now();
    const limit = clampLimit(req.query.limit);
    const match = {};
    // Date range, same shape the Meta usage dashboard uses. `to` arrives as a
    // date-only string from the picker; without the end-of-day push, "today"
    // would exclude every run that happened today -- the bug already fixed
    // once on the Meta usage endpoint, not worth repeating here.
    const { from, to } = req.query;
    if (from || to) {
      match.startedAt = {};
      if (from) match.startedAt.$gte = new Date(from);
      if (to) {
        const end = new Date(to);
        if (/^\d{4}-\d{2}-\d{2}$/.test(String(to))) {
          end.setUTCHours(23, 59, 59, 999);
        }
        match.startedAt.$lte = end;
      }
    }
    if (req.query.status) match.status = req.query.status;
    if (req.query.dryRun === "true") match.dryRun = true;
    if (req.query.dryRun === "false") match.dryRun = false;

    const runs = await AutopilotRun.find(match)
      .sort({ startedAt: -1 })
      .limit(limit)
      .lean();

    // Averages over COMPLETED runs only. A run still in flight has a partial
    // duration, and a skipped run has none — including either would drag the
    // number toward zero and quietly understate what a cycle costs.
    const finished = runs.filter(
      (r) => r.status === "complete" && r.durationMs != null,
    );
    const totalAudits = finished.reduce(
      (sum, r) => sum + (r.accounts || []).reduce((s, a) => s + (a.auditCount || 0), 0),
      0,
    );
    const totalAccountsDone = finished.reduce((s, r) => s + (r.accountsDone || 0), 0);
    const stats = finished.length
      ? {
          runs: finished.length,
          avgDurationMs: Math.round(
            finished.reduce((s, r) => s + r.durationMs, 0) / finished.length,
          ),
          maxDurationMs: Math.max(...finished.map((r) => r.durationMs)),
          avgAccountsPerRun: Math.round(totalAccountsDone / finished.length),
          // The number C3 should be sized against — per ACCOUNT, not per run,
          // because the account is the unit that parallelises.
          avgMsPerAccount: totalAccountsDone
            ? Math.round(
                finished.reduce((s, r) => s + r.durationMs, 0) / totalAccountsDone,
              )
            : null,
          avgAuditsPerAccount: totalAccountsDone
            ? Number((totalAudits / totalAccountsDone).toFixed(2))
            : null,
        }
      : null;

    res.json({
      success: true,
      data: {
        stats,
        runs: runs.map((r) => {
          const d = decorateRun(r, now);
          d.accounts = undefined; // detail view only — keeps the list small
          return d;
        }),
      },
    });
  } catch (err) {
    next(err);
  }
};

/** GET /admin/autopilot-runs/:runId — one run, with every account it touched. */
exports.detail = async (req, res, next) => {
  try {
    const run = await AutopilotRun.findOne({ runId: req.params.runId }).lean();
    if (!run) {
      return res
        .status(404)
        .json({ success: false, message: "Run not found" });
    }
    const decorated = decorateRun(run, Date.now());
    // Slowest first: on a page opened because a run was slow, the account
    // responsible should not have to be hunted for.
    decorated.accounts = [...decorated.accounts].sort(
      (a, b) => (b.durationMs || 0) - (a.durationMs || 0),
    );
    res.json({ success: true, data: decorated });
  } catch (err) {
    next(err);
  }
};

exports._internals = {
  decorateRun,
  clampLimit,
  readLock,
  STALE_HEARTBEAT_MS,
};
