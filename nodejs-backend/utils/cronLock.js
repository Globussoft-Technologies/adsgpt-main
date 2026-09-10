/**
 * cronLock — make a scheduled job run once per tick across every process that
 * has it registered.
 *
 * WHY THIS EXISTS. Splitting Autopilot into its own worker (C1 in
 * docs/AUTOPILOT_SCALING_PLAN.md) means two Node processes boot the same
 * codebase and the same cron registry. Autopilot itself was already safe — it
 * takes `autopilot:lock` before doing anything — but the other scheduled jobs
 * were not, and their double-run failure modes are the expensive kind:
 * billing reconciliation granting a month's credits twice, the newsletter
 * drip mailing every subscriber twice, the credit sweeper refunding a
 * reservation twice.
 *
 * The plan called cron double-registration C1's main risk and proposed
 * managing it with a careful ownership table. A table is a documentation fix
 * for a correctness problem: it works right up until someone adds a job and
 * puts it in the wrong column, or an env var is missed on one of two deploys.
 * This makes the hazard structurally impossible instead — with the guard in
 * place, registering a job in both processes is merely wasteful, not wrong.
 *
 * SEMANTICS. First process to claim `cron:<name>:<tick>` runs the job; every
 * other process for that tick returns immediately. The key is the JOB plus its
 * SCHEDULED MINUTE, not just the job, so a lock leaked by a crashed process
 * blocks at most the tick it belonged to — never every future tick, which is
 * the failure a plain job-name lock introduces.
 *
 * The lock is NOT released on completion, deliberately. Releasing it would let
 * a second process pick up the same tick moments later, which is exactly what
 * it exists to prevent; it expires on its TTL instead. Pick a TTL longer than
 * the job's worst run time and shorter than its interval.
 *
 * FAILS OPEN. If Redis is unreachable the job RUNS. For jobs whose whole
 * purpose is to happen on schedule, a Redis outage silently skipping them is
 * worse than the double-run this guards against — and a Redis outage means
 * everything else here is broken anyway.
 */

const { redisClient } = require("../db/redis");

/** The scheduled minute this invocation belongs to, as a stable string. */
function tickId(now = new Date()) {
  // Minute granularity: no cron in this codebase fires more than once a
  // minute, and truncating here means two processes whose clocks differ by a
  // few hundred milliseconds still compute the same tick.
  return new Date(now).toISOString().slice(0, 16).replace(/[-:T]/g, "");
}

/**
 * Run `fn` only if this process wins the tick.
 *
 * @param {string} name          job name, e.g. "billing-reconcile"
 * @param {number} ttlSeconds    how long to hold the tick. Longer than the
 *                               job's worst run, shorter than its interval.
 * @param {Function} fn          the job
 * @returns {Promise<boolean>}   true if this process ran it
 */
async function runExclusively(name, ttlSeconds, fn) {
  const key = `cron:${name}:${tickId()}`;
  let won = true;
  try {
    const res = await redisClient.set(key, String(process.pid), "EX", ttlSeconds, "NX");
    won = res === "OK";
  } catch (err) {
    // See FAILS OPEN above.
    console.warn(
      `[cron-lock] ${name}: redis unavailable (${err.message}) — running anyway`,
    );
    won = true;
  }
  if (!won) {
    console.log(`[cron-lock] ${name}: another process owns this tick — skipping`);
    return false;
  }
  await fn();
  return true;
}

/**
 * Wrap a job so it can be handed straight to `cron.schedule`.
 *
 * Swallows the job's own errors after logging, because an unhandled rejection
 * from a node-cron callback takes the process down — and this process is now
 * the one running every scheduled job.
 */
function exclusive(name, ttlSeconds, fn) {
  return async () => {
    try {
      await runExclusively(name, ttlSeconds, fn);
    } catch (err) {
      console.error(`[cron-lock] ${name} threw:`, err.message);
    }
  };
}

module.exports = { runExclusively, exclusive, _internals: { tickId } };
