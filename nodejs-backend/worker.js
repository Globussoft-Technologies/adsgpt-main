/**
 * worker.js — the scheduled-work process.
 *
 * Everything the cron registry schedules runs here: Autopilot's hourly cycle,
 * billing reconciliation, the credit-reservation sweeper, OAuth key rotation,
 * the newsletter drip, chat-session cleanup. No Express, no Socket.IO, no
 * routes — this process serves nothing and listens on no port.
 *
 * WHY IT EXISTS (C1 in docs/AUTOPILOT_SCALING_PLAN.md). Two reasons, and the
 * first is the urgent one:
 *
 *   1. DEPLOY AND RESTART ISOLATION. The gateway restarts often — 1,837 times
 *      by one count. Every restart landing mid-cycle killed an Autopilot run
 *      partway through its Meta writes AND left `autopilot:lock` held for its
 *      full 55-minute TTL, so the NEXT hour was lost too. A cycle that lives
 *      in its own process is not collateral damage of an API deploy.
 *
 *   2. EVENT-LOOP ISOLATION. Parsing six insights payloads per account and
 *      normalising thousands of entities is synchronous CPU. In the API
 *      process it surfaced as latency spikes on unrelated HTTP routes.
 *
 * ONE INSTANCE, FORK MODE. Never `cluster`, never `instances: > 1`. The Meta
 * rate limiter (`services/autopilot/metaRateLimiter.js`) is a singleton over
 * an in-memory Map: it coordinates nothing across processes. Two workers would
 * each see half of the true app-level usage, neither would throttle, and both
 * would be blocked together. Scaling out needs the limiter moved into Redis
 * first — that is C5, and it is not built.
 *
 * SAFE TO RUN ALONGSIDE AN UNCONVERTED GATEWAY. `CRON_ROLE` defaults to `all`,
 * so a gateway that has not yet been switched to `CRON_ROLE=api` keeps running
 * its crons and nothing silently stops. Both processes registering the same
 * job is harmless: every job is either behind its own Redis lock (Autopilot)
 * or wrapped in `exclusive()` from utils/cronLock.js, so one tick runs once.
 */
require("dotenv").config();

const mongoose = require("mongoose");
const connectMongoDB = require("./db/mongo");
const { runCronJobs } = require("./utils/cron");
const {
  abandonActiveRun,
} = require("./services/autopilot/userRuleOrchestrator");
const { redisClient } = require("./db/redis");

// This process IS the worker. Forced, not defaulted.
//
// Both entrypoints load the same .env, so `CRON_ROLE` there cannot mean
// different things to each of them — and the value you want in .env is `api`,
// because the gateway is the process that needs telling. An earlier version
// only set this when unset, which meant `CRON_ROLE=api` in .env was inherited
// here and the worker registered nothing at all: a process whose entire job is
// scheduled work, doing none of it, silently.
//
// So the roles are expressed where they actually differ:
//   .env / gateway env  →  CRON_ROLE=api   (the gateway is told what to skip)
//   worker.js           →  always "worker" (it cannot be anything else)
//   ecosystem.config.js →  sets both explicitly for PM2, which wins because
//                          dotenv does not overwrite an already-set variable
//
// utils/cron.js reads the role at CALL time so this assignment lands; it used
// to capture it at module load, before this line ran.
process.env.CRON_ROLE = "worker";

async function start() {
  console.log(
    `[worker] starting pid=${process.pid} role=${process.env.CRON_ROLE}`,
  );

  await connectMongoDB();

  // Autopilot's own scheduler reads AUTOPILOT_ENABLED and AUTOPILOT_CRON; the
  // registry logs what it registered, so a misconfigured worker is visible in
  // the first few lines of `pm2 logs adsgpt-worker` rather than by its silence
  // an hour later.
  runCronJobs();

  console.log("[worker] ready — scheduled work only, no HTTP listener");
}

/**
 * Shut down without abandoning an in-flight cycle's connections.
 *
 * Deliberately does NOT wait for a running Autopilot cycle to finish. A cycle
 * can legitimately take minutes, PM2's stop timeout is far shorter, and every
 * Meta write it makes is idempotent — so a killed cycle is re-done next tick
 * rather than half-applied. What matters here is closing Mongo and Redis
 * cleanly so the next process does not inherit a stuck pool.
 */
async function shutdown(signal) {
  console.log(`[worker] ${signal} received — shutting down`);

  // Release the run lock BEFORE anything else. PM2 sends SIGTERM on every
  // restart and every deploy; without this the orchestrator's `finally` never
  // runs, `autopilot:lock` stays held for its full 55-minute TTL, and the next
  // tick — and the one after it — is refused. A worker that costs an hour of
  // Autopilot every time it restarts is worse than one that never restarts,
  // which would defeat the point of giving it its own process.
  //
  // The abandoned cycle itself is not waited for: it can legitimately take
  // minutes, PM2's stop timeout is far shorter, and every Meta write is
  // idempotent, so a half-finished cycle is simply re-done next tick.
  try {
    const abandoned = await abandonActiveRun(`worker ${signal}`);
    if (abandoned) {
      console.log("[worker] released autopilot:lock and closed the run record");
    }
  } catch (err) {
    console.error("[worker] abandoning active run failed:", err.message);
  }

  try {
    await mongoose.connection.close(false);
  } catch (err) {
    console.error("[worker] mongo close failed:", err.message);
  }
  try {
    await redisClient.quit();
  } catch (err) {
    console.error("[worker] redis quit failed:", err.message);
  }
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// A worker that cannot reach its database has nothing useful to do, and a
// process that stays up while doing nothing is worse than one that exits —
// PM2 restarts it, and the failure is visible instead of silent.
start().catch((err) => {
  console.error("[worker] failed to start:", err);
  process.exit(1);
});
