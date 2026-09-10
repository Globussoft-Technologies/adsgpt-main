#!/usr/bin/env node
/**
 * Tests for C6's write side — services/autopilot/runRecorder.js and the
 * outcome classification the admin view renders from.
 *
 * TWO PROPERTIES MATTER MORE THAN THE ARITHMETIC.
 *
 * First, every function here must SWALLOW its own errors. This is telemetry
 * about a job that moves real money; a dropped run row costs a line in a
 * dashboard, but a throw from a dropped run row would cost an account its
 * cycle. Each function is therefore tested against a model that throws.
 *
 * Second, the writes must be incremental — `$inc` and `$push`, never
 * read-modify-write. A cycle updating its own row while accounts complete
 * cannot be allowed to clobber a concurrent update, and the per-account cost
 * has to stay flat as the accounts array grows.
 */

const assert = require("node:assert/strict");
const Module = require("node:module");

let pass = 0;
let fail = 0;
const FAILURES = [];

function record(name, err) {
  if (err) {
    fail += 1;
    FAILURES.push({ name, err });
    console.log(`  ✗ ${name}`);
    console.log(`      ${err.stack || err.message}`);
  } else {
    pass += 1;
    console.log(`  ✓ ${name}`);
  }
}
async function testAsync(name, fn) {
  try {
    await fn();
    record(name);
  } catch (err) {
    record(name, err);
  }
}
function test(name, fn) {
  try {
    const out = fn();
    if (out && typeof out.then === "function") {
      throw new Error(`"${name}" returned a promise — use testAsync`);
    }
    record(name);
  } catch (err) {
    record(name, err);
  }
}
async function group(label, fn) {
  console.log(`\n${label}`);
  return fn();
}

// Stub the Mongoose model before requiring the recorder — the real one would
// try to reach a database this suite does not have.
const calls = { create: [], updateOne: [] };
let throwNext = null;

const ModelStub = {
  create: async (doc) => {
    if (throwNext) throw new Error(throwNext);
    calls.create.push(doc);
    return doc;
  },
  updateOne: async (q, update) => {
    if (throwNext) throw new Error(throwNext);
    calls.updateOne.push({ q, update });
    return { acknowledged: true };
  },
};

const originalLoad = Module._load;
Module._load = function patched(request, parent, isMain) {
  if (request.endsWith("Module/autopilot/autopilotRun")) return ModelStub;
  // Keep the logger quiet — the swallow path deliberately warns.
  if (request.endsWith("utils/logger")) {
    return { warn() {}, info() {}, error() {} };
  }
  return originalLoad(request, parent, isMain);
};

const runRecorder = require("../../services/autopilot/runRecorder");
const { classifyAccountOutcome } = runRecorder._internals;

function reset() {
  calls.create = [];
  calls.updateOne = [];
  throwNext = null;
}

(async () => {
  await group("classifyAccountOutcome", () => {
    test("a clean account is ok", () => {
      assert.equal(classifyAccountOutcome({ ok: true }), "ok");
      assert.equal(classifyAccountOutcome({}), "ok");
    });

    test("a deadline breach is a timeout, not a generic failure", () => {
      // Must match the message withDeadline actually produces, or a timed-out
      // account is miscounted as a plain failure and the distinction the run
      // row exists to make is lost.
      const acct = {
        ok: false,
        error: "account act_123 exceeded 120000ms — abandoned",
      };
      assert.equal(classifyAccountOutcome(acct), "timeout");
    });

    test("a pre-flight rate-limit skip is its own outcome", () => {
      const acct = {
        ok: false,
        error: "Skipped — Meta rate limit, 12 min remaining",
      };
      assert.equal(classifyAccountOutcome(acct), "rate-limited");
    });

    test("anything else is a failure", () => {
      assert.equal(
        classifyAccountOutcome({ ok: false, error: "boom" }),
        "failed",
      );
      assert.equal(classifyAccountOutcome({ ok: false }), "failed");
    });
  });

  await group("writes are incremental, never read-modify-write", async () => {
    await testAsync("recordAccount uses $inc and $push", async () => {
      reset();
      await runRecorder.recordAccount({
        runId: "r1",
        durationMs: 4200,
        acctSummary: {
          adAccountId: "act_1",
          ownerUserId: "GPT-1",
          name: "Acme",
          ok: true,
          auditCount: 3,
          pause: { paused: 2, failed: 0 },
          resume: { resumed: 1, failed: 0 },
        },
      });
      assert.equal(calls.updateOne.length, 1);
      const { update } = calls.updateOne[0];
      assert.deepEqual(update.$inc, { accountsDone: 1 });
      assert.ok(update.$push.accounts, "account must be pushed, not assigned");
      assert.ok(!update.$set.accounts, "never overwrite the whole array");
      const pushed = update.$push.accounts;
      assert.equal(pushed.adAccountId, "act_1");
      assert.equal(pushed.durationMs, 4200);
      assert.equal(pushed.auditCount, 3);
      assert.equal(pushed.paused, 2);
      assert.equal(pushed.resumed, 1);
      assert.equal(pushed.outcome, "ok");
    });

    await testAsync("recordAccount refreshes the heartbeat", async () => {
      // Staleness here — not `status` — is how the live view tells "working"
      // from "died holding the lock". A crashed cycle never writes a status.
      reset();
      await runRecorder.recordAccount({
        runId: "r1",
        durationMs: 1,
        acctSummary: { adAccountId: "a", ownerUserId: "u", pause: {}, resume: {} },
      });
      assert.ok(calls.updateOne[0].update.$set.heartbeatAt instanceof Date);
    });

    await testAsync("a DRY RUN records what it would have done", async () => {
      // The gap this closes: the orchestrator increments `would_pause` on a
      // dry run, not `paused`. Reading only `paused` made every rehearsal
      // report the same zeroes as an idle cycle -- which is precisely the
      // question a rehearsal exists to answer.
      reset();
      await runRecorder.recordAccount({
        runId: "r1",
        durationMs: 1000,
        acctSummary: {
          adAccountId: "act_dry",
          ownerUserId: "GPT-1",
          pause: { paused: 0, would_pause: 7 },
          resume: { resumed: 0, would_resume: 2 },
          scale: { scaled: 0, would_scale: 1 },
        },
      });
      const pushed = calls.updateOne[0].update.$push.accounts;
      assert.equal(pushed.wouldPause, 7);
      assert.equal(pushed.wouldResume, 2);
      assert.equal(pushed.wouldScale, 1);
      assert.equal(pushed.paused, 0, "a dry run lands nothing");
    });

    await testAsync("finishRun rolls up would-counts separately", async () => {
      reset();
      await runRecorder.finishRun({
        runId: "r1",
        status: "complete",
        durationMs: 1,
        summaries: [
          { ok: true, pause: { paused: 3 } },
          { ok: true, pause: { would_pause: 5 }, resume: { would_resume: 1 } },
        ],
      });
      const set = calls.updateOne[0].update.$set;
      assert.equal(set.totalPaused, 3, "live and dry must not be conflated");
      assert.equal(set.totalWouldPause, 5);
      assert.equal(set.totalWouldResume, 1);
    });

    await testAsync("a failed account carries its error and outcome", async () => {
      reset();
      await runRecorder.recordAccount({
        runId: "r1",
        durationMs: 120001,
        acctSummary: {
          adAccountId: "act_2",
          ownerUserId: "GPT-1",
          ok: false,
          error: "account act_2 exceeded 120000ms — abandoned",
          pause: {},
          resume: {},
        },
      });
      const pushed = calls.updateOne[0].update.$push.accounts;
      assert.equal(pushed.ok, false);
      assert.equal(pushed.outcome, "timeout");
      assert.match(pushed.error, /exceeded/);
    });
  });

  await group("run lifecycle", async () => {
    await testAsync("startRun opens the row as running", async () => {
      reset();
      await runRecorder.startRun({ runId: "r2", dryRun: true, startedAt: Date.now() });
      assert.equal(calls.create.length, 1);
      assert.equal(calls.create[0].status, "running");
      assert.equal(calls.create[0].dryRun, true);
      assert.ok(calls.create[0].host, "host identifies which process ran it");
      assert.ok(calls.create[0].pid);
    });

    await testAsync("recordPlan sets the denominator progress needs", async () => {
      reset();
      await runRecorder.recordPlan({
        runId: "r2",
        totalUsers: 3,
        totalAccounts: 17,
        totalRules: 40,
      });
      assert.equal(calls.updateOne[0].update.$set.totalAccounts, 17);
      assert.equal(calls.updateOne[0].update.$set.totalUsers, 3);
    });

    await testAsync("finishRun rolls up outcomes across accounts", async () => {
      reset();
      await runRecorder.finishRun({
        runId: "r2",
        status: "complete",
        durationMs: 90000,
        summaries: [
          { ok: true, pause: { paused: 3 }, resume: { resumed: 1 } },
          { ok: false, error: "account x exceeded 120000ms — abandoned" },
          { ok: false, error: "Skipped — Meta rate limit, 5 min remaining" },
          { ok: false, error: "something else" },
          { ok: true, scale: { scaled: 2 } },
        ],
      });
      const s = calls.updateOne[0].update.$set;
      assert.equal(s.status, "complete");
      assert.equal(s.accountsOk, 2);
      assert.equal(s.accountsTimedOut, 1);
      assert.equal(s.accountsRateLimited, 1);
      assert.equal(s.accountsFailed, 1);
      assert.equal(s.totalPaused, 3);
      assert.equal(s.totalResumed, 1);
      assert.equal(s.totalScaled, 2);
    });

    await testAsync("a user skipped whole is recorded, with its account count", async () => {
      // The gap this closes: three paths in the orchestrator `continue` past a
      // user BEFORE touching any of their accounts -- disabled in settings, no
      // Facebook connection, no usable token. `totalAccounts` counted those
      // accounts, `accountsDone` did not, and nothing was written anywhere. A
      // run that touched 1 of 12 accounts reported itself complete and clean.
      reset();
      await runRecorder.recordSkippedUser({
        runId: "r4",
        userId: "GPT-1331",
        reason: "no-usable-token",
        accounts: 11,
      });
      const { update } = calls.updateOne[0];
      assert.equal(update.$push.usersSkipped.userId, "GPT-1331");
      assert.equal(update.$push.usersSkipped.reason, "no-usable-token");
      assert.equal(
        update.$push.usersSkipped.accounts,
        11,
        "the count is what reconciles accountsDone against totalAccounts",
      );
      assert.ok(update.$set.heartbeatAt instanceof Date);
      assert.ok(!update.$inc, "a skipped user completed no accounts");
    });

    await testAsync("skipped users accumulate rather than overwrite", async () => {
      reset();
      await runRecorder.recordSkippedUser({ runId: "r4", userId: "a", reason: "x" });
      await runRecorder.recordSkippedUser({ runId: "r4", userId: "b", reason: "y" });
      assert.equal(calls.updateOne.length, 2);
      for (const c of calls.updateOne) {
        assert.ok(c.update.$push.usersSkipped, "must $push, never $set the array");
      }
    });

    await testAsync("a skipped tick is recorded, not dropped", async () => {
      // A steady drip of these is how a second scheduler racing the first
      // becomes visible — the "ran twice in an hour" pattern.
      reset();
      await runRecorder.recordSkippedRun({ runId: "r3", reason: "lock-held" });
      assert.equal(calls.create.length, 1);
      assert.equal(calls.create[0].status, "skipped");
      assert.equal(calls.create[0].skipReason, "lock-held");
      assert.equal(calls.create[0].durationMs, 0);
    });
  });

  await group("telemetry never breaks the cycle", async () => {
    const each = [
      ["startRun", () => runRecorder.startRun({ runId: "x", startedAt: Date.now() })],
      ["recordPlan", () => runRecorder.recordPlan({ runId: "x", totalAccounts: 1 })],
      [
        "recordAccount",
        () =>
          runRecorder.recordAccount({
            runId: "x",
            durationMs: 1,
            acctSummary: { adAccountId: "a", ownerUserId: "u", pause: {}, resume: {} },
          }),
      ],
      [
        "recordSkippedUser",
        () =>
          runRecorder.recordSkippedUser({
            runId: "x",
            userId: "u",
            reason: "r",
          }),
      ],
      ["finishRun", () => runRecorder.finishRun({ runId: "x", status: "complete" })],
      ["recordSkippedRun", () => runRecorder.recordSkippedRun({ runId: "x", reason: "r" })],
    ];
    for (const [name, fn] of each) {
      await testAsync(`${name} swallows a database failure`, async () => {
        reset();
        throwNext = "mongo is down";
        // Must resolve, not reject. If any of these can throw, a database
        // blip becomes a lost cycle.
        await fn();
      });
    }
  });

  Module._load = originalLoad;

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) {
    for (const f of FAILURES) {
      console.log(`\n FAIL: ${f.name}`);
      console.log(f.err.stack || f.err.message);
    }
    process.exit(1);
  }
})();
