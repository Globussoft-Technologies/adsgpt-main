#!/usr/bin/env node
/**
 * Tests for services/autopilot/withDeadline.js — C2 in
 * docs/AUTOPILOT_SCALING_PLAN.md.
 *
 * A `Promise.race` timeout is easy to write in a way that passes a happy-path
 * test and still leaks. The three failure modes worth pinning:
 *
 *   1. The timer keeps the event loop alive after a fast run, so a finished
 *      cycle idles for the length of the deadline (two minutes per account at
 *      the configured default).
 *   2. The abandoned work rejects later with no handler attached, Node reports
 *      an unhandled rejection, and on a modern default the process exits —
 *      turning one slow account into a dead cron.
 *   3. A genuine error gets reported as a timeout, sending someone hunting a
 *      hang that never happened.
 *
 * Deliberately does NOT import userRuleOrchestrator: that module connects
 * Mongo and Redis at require time, which would make this file a process that
 * never exits. The default it configures is checked by reading the source.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

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
async function testAsync(name, fn) {
  try {
    await fn();
    record(name);
  } catch (err) {
    record(name, err);
  }
}
async function group(label, fn) {
  console.log(`\n${label}`);
  return fn();
}

const { withDeadline } = require("../../services/autopilot/withDeadline");

const sleep = (ms, value) =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms));

(async () => {
  await group("withDeadline", async () => {
    await testAsync("resolves through when the work finishes in time", async () => {
      assert.equal(await withDeadline(sleep(5, "done"), 500, "fast"), "done");
    });

    await testAsync("rejects, naming the label and the bound", async () => {
      await assert.rejects(
        () => withDeadline(sleep(500), 20, "account act_1"),
        /account act_1 exceeded 20ms/,
      );
    });

    await testAsync("propagates a real error rather than reporting a timeout", async () => {
      await assert.rejects(
        () => withDeadline(Promise.reject(new Error("meta said no")), 500, "x"),
        /meta said no/,
      );
    });

    await testAsync("an already-settled promise passes straight through", async () => {
      assert.equal(await withDeadline(Promise.resolve(7), 1, "instant"), 7);
    });

    await testAsync("abandoned work that fails later does not crash the process", async () => {
      // Why this holds: Promise.race subscribes to EVERY input, so the loser
      // already carries a rejection handler by the time it settles. That is a
      // property of race, not something withDeadline does — this test exists
      // to catch a future refactor to a hand-rolled timeout that loses it.
      let unhandled = null;
      const onUnhandled = (err) => {
        unhandled = err;
      };
      process.on("unhandledRejection", onUnhandled);
      try {
        const slowFailure = sleep(15).then(() => {
          throw new Error("late boom");
        });
        await assert.rejects(
          () => withDeadline(slowFailure, 5, "slow"),
          /exceeded 5ms/,
        );
        await sleep(40);
      } finally {
        process.off("unhandledRejection", onUnhandled);
      }
      assert.equal(
        unhandled,
        null,
        `abandoned work's late rejection escaped as unhandled: ${unhandled && unhandled.message}`,
      );
    });

    await testAsync("does not hold the event loop open after settling", async () => {
      // .unref() plus the clearTimeout in .finally(). Without them a completed
      // cycle idles until the last deadline expires.
      const handles = () =>
        typeof process._getActiveHandles === "function"
          ? process._getActiveHandles().length
          : null;
      const before = handles();
      await withDeadline(sleep(1, "ok"), 60_000, "unref check");
      await sleep(5);
      const after = handles();
      if (before !== null && after !== null) {
        assert.ok(after <= before, `timer handle leaked: ${before} -> ${after}`);
      }
    });
  });

  await group("the orchestrator's configured bound", () => {
    test("defaults to 120s and stays under the run lock", () => {
      // Read from source rather than importing (see the file header). A
      // deadline at or above LOCK_TTL_SECONDS would bound nothing — the lock
      // would expire first and a second cycle could start atop the stuck one.
      const src = fs.readFileSync(
        path.join(
          __dirname,
          "..",
          "..",
          "services",
          "autopilot",
          "userRuleOrchestrator.js",
        ),
        "utf8",
      );
      const timeout = src.match(/AUTOPILOT_ACCOUNT_TIMEOUT_MS \|\| "(\d+)"/);
      assert.ok(timeout, "ACCOUNT_TIMEOUT_MS default not found — renamed?");
      assert.equal(Number(timeout[1]), 120000);

      const lock = src.match(/LOCK_TTL_SECONDS = (\d+) \* 60/);
      assert.ok(lock, "LOCK_TTL_SECONDS not found — renamed?");
      const lockMs = Number(lock[1]) * 60 * 1000;
      assert.ok(
        Number(timeout[1]) < lockMs,
        `deadline ${timeout[1]}ms must be under the lock TTL ${lockMs}ms`,
      );
    });

    test("the account loop actually applies it", () => {
      // Cheap guard against the bound being configured but never wired in —
      // the whole change is one call site, and losing it is silent.
      const src = fs.readFileSync(
        path.join(
          __dirname,
          "..",
          "..",
          "services",
          "autopilot",
          "userRuleOrchestrator.js",
        ),
        "utf8",
      );
      assert.match(
        src,
        /await withDeadline\(\s*\n\s*processAccount\(/,
        "processAccount is no longer wrapped in withDeadline",
      );
      assert.match(src, /ACCOUNT_TIMEOUT_MS,/, "the bound is not passed");
    });
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) {
    for (const f of FAILURES) {
      console.log(`\n FAIL: ${f.name}`);
      console.log(f.err.stack || f.err.message);
    }
    process.exit(1);
  }
})();
