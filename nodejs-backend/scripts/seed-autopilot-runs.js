#!/usr/bin/env node
/**
 * seed-autopilot-runs — synthetic AutopilotRun rows for exercising C6's read
 * side without running a cycle.
 *
 * WHY NOT JUST RUN A CYCLE. A real cycle makes live Meta audit reads (dry-run
 * suppresses writes, not fetches), takes `autopilot:lock`, and takes minutes.
 * None of that is needed to answer the question this script exists for: does
 * the model persist, do the admin endpoints aggregate correctly, and does the
 * page render every state it claims to handle.
 *
 * EVERY ROW IT WRITES IS MARKED. runIds are prefixed `seed-`, so `--clean`
 * can remove exactly what this created and nothing else — it will never touch
 * a real run, even when pointed at a shared database.
 *
 * The fixtures deliberately cover the states that are easy to get wrong and
 * invisible in a happy-path check:
 *
 *   - a RUNNING run with a live heartbeat        → progress bar, 3s polling
 *   - a RUNNING run with a STALE heartbeat       → the "stalled" banner, which
 *     is the case `status` alone cannot detect: a crashed cycle never gets to
 *     write status=failed and would otherwise show as healthy forever
 *   - accounts in all four outcomes              → ok / failed / timeout /
 *     rate-limited, which the page colours differently on purpose
 *   - a SKIPPED (lock-held) run                  → the two-schedulers signal
 *   - several COMPLETE runs of varied duration   → the history stats, which
 *     average over completed runs only
 *
 * Usage:
 *   node scripts/seed-autopilot-runs.js            # insert
 *   node scripts/seed-autopilot-runs.js --clean    # remove only seeded rows
 *   node scripts/seed-autopilot-runs.js --stalled  # make the live run stale
 */

require("dotenv").config();
const mongoose = require("mongoose");
const AutopilotRun = require("../Module/autopilot/autopilotRun");

const PREFIX = "seed-";
const clean = process.argv.includes("--clean");
const stalled = process.argv.includes("--stalled");

const MIN = 60 * 1000;
const now = Date.now();

const acct = (i, overrides = {}) => ({
  adAccountId: `act_9${String(i).padStart(11, "0")}`,
  adAccountName: [
    "AstroLive - Main AC",
    "Bhilai Ads Act 02",
    "Biswa T4B AC 2",
    "GBS Blr 05 - Running",
    "Chingari App Install",
  ][i % 5],
  ownerUserId: `GPT-4${30 + (i % 3)}`,
  ok: true,
  durationMs: 3000 + i * 1700,
  auditCount: 1 + (i % 3),
  paused: i % 4 === 0 ? 2 : 0,
  resumed: i % 5 === 0 ? 1 : 0,
  scaled: 0,
  failed: 0,
  outcome: "ok",
  ...overrides,
});

/** A finished run, `minutesAgo` in the past. */
function completeRun(minutesAgo, accountCount, durationMs, extra = {}) {
  const startedAt = new Date(now - minutesAgo * MIN);
  const accounts = Array.from({ length: accountCount }, (_, i) => acct(i));
  return {
    runId: `${PREFIX}${startedAt.toISOString().slice(11, 16).replace(":", "")}-complete`,
    startedAt,
    finishedAt: new Date(startedAt.getTime() + durationMs),
    heartbeatAt: new Date(startedAt.getTime() + durationMs),
    durationMs,
    status: "complete",
    dryRun: false,
    host: "seed-host",
    pid: 12345,
    totalUsers: 2,
    totalAccounts: accountCount,
    totalRules: 10,
    accountsDone: accountCount,
    accountsOk: accounts.filter((a) => a.outcome === "ok").length,
    accountsFailed: 0,
    accountsTimedOut: 0,
    accountsRateLimited: 0,
    totalPaused: accounts.reduce((s, a) => s + a.paused, 0),
    totalResumed: accounts.reduce((s, a) => s + a.resumed, 0),
    totalScaled: 0,
    accounts,
    ...extra,
  };
}

async function main() {
  await mongoose.connect(process.env.MONGO_CONNECTION_STRING);
  console.log(`db: ${mongoose.connection.name}`);

  if (clean) {
    const res = await AutopilotRun.deleteMany({
      runId: { $regex: `^${PREFIX}` },
    });
    console.log(`removed ${res.deletedCount} seeded run(s)`);
    await mongoose.disconnect();
    return;
  }

  // Clear previous seeds first so re-running is idempotent.
  await AutopilotRun.deleteMany({ runId: { $regex: `^${PREFIX}` } });

  const liveStartedAt = new Date(now - 2 * MIN);
  const liveAccounts = [
    acct(0),
    acct(1),
    // The three non-ok outcomes the page colours separately. `timeout` is
    // C2's deadline; `rate-limited` is the pre-flight skip. Collapsing these
    // into "failed" is exactly the loss of detail C6 exists to prevent.
    acct(2, {
      ok: false,
      outcome: "timeout",
      durationMs: 120001,
      error: "account act_900000000002 exceeded 120000ms — abandoned",
    }),
    acct(3, {
      ok: false,
      outcome: "rate-limited",
      durationMs: 40,
      auditCount: 0,
      error: "Skipped — Meta rate limit, 12 min remaining",
    }),
    acct(4, {
      ok: false,
      outcome: "failed",
      error: "The request was made but no response was received",
    }),
  ];

  const docs = [
    // In flight. `heartbeatAt` decides whether the page shows progress or the
    // stalled banner — NOT `status`, which stays "running" either way.
    {
      runId: `${PREFIX}live`,
      startedAt: liveStartedAt,
      heartbeatAt: stalled
        ? new Date(now - 9 * MIN) // older than STALE_HEARTBEAT_MS (5 min)
        : new Date(now - 8 * 1000),
      status: "running",
      dryRun: false,
      host: "seed-host",
      pid: 12345,
      totalUsers: 3,
      totalAccounts: 12,
      totalRules: 18,
      accountsDone: liveAccounts.length,
      accounts: liveAccounts,
    },
    // A skipped tick: the signal that two schedulers are racing.
    {
      runId: `${PREFIX}skipped`,
      startedAt: new Date(now - 61 * MIN),
      finishedAt: new Date(now - 61 * MIN),
      durationMs: 0,
      status: "skipped",
      skipReason: "lock-held",
      dryRun: false,
      host: "seed-host",
      pid: 12346,
    },
    // History, varied so the stats row is not a single value repeated.
    completeRun(65, 12, 214068),
    completeRun(125, 12, 280633, {
      accountsFailed: 3,
      accountsOk: 9,
      error: undefined,
    }),
    completeRun(185, 11, 96500),
    completeRun(245, 12, 143200),
    completeRun(305, 10, 88400, { dryRun: true }),
  ];

  await AutopilotRun.insertMany(docs);
  console.log(`inserted ${docs.length} seeded run(s):`);
  for (const d of docs) {
    console.log(
      `  ${d.runId.padEnd(22)} ${d.status.padEnd(9)} ${
        d.durationMs != null ? `${d.durationMs}ms` : "in flight"
      }`,
    );
  }
  console.log(
    `\nLive run is ${stalled ? "STALLED (heartbeat 9 min old)" : "healthy (heartbeat 8s old)"}.`,
  );
  console.log("Open /autopilot-runs in react-admin. Remove with --clean.");

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("ERR:", err.message);
  process.exit(1);
});
