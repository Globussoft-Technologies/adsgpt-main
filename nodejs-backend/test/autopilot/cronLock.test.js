#!/usr/bin/env node
/**
 * Tests for utils/cronLock.js — the guard that makes C1's process split safe.
 *
 * THE HAZARD THIS REPLACES. Splitting Autopilot into its own worker means two
 * processes boot the same cron registry. Autopilot was already safe (it takes
 * `autopilot:lock` first), but billing reconciliation, the credit sweeper, the
 * newsletter drip and chat cleanup were not — and their double-run failures
 * are the expensive kind: a month's credits granted twice, every subscriber
 * mailed twice.
 *
 * The plan proposed managing this with an ownership table saying which process
 * runs which job. That is a documentation fix for a correctness problem: it
 * holds until someone adds a job to the wrong column, or one of two deploys
 * misses an env var. These tests pin the structural fix instead.
 *
 * Two design decisions are asserted here because both are easy to "simplify"
 * into a bug:
 *
 *   - The key includes the TICK, not just the job name. A job-name-only lock
 *     leaked by a crashed process blocks every future tick forever.
 *   - It FAILS OPEN. Redis being down must not silently stop scheduled work;
 *     for these jobs a missed run is worse than a double run, and a Redis
 *     outage means everything else is broken anyway.
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

// A tiny in-memory Redis standing in for the real one: SET NX is the only
// command under test, and its semantics are exactly what the guard relies on.
const store = new Map();
let redisThrows = null;
const setCalls = [];

const originalLoad = Module._load;
Module._load = function patched(request, parent, isMain) {
  if (request.endsWith("db/redis")) {
    return {
      redisClient: {
        set: async (key, val, ex, ttl, nx) => {
          if (redisThrows) throw new Error(redisThrows);
          setCalls.push({ key, val, ex, ttl, nx });
          if (nx === "NX" && store.has(key)) return null;
          store.set(key, val);
          return "OK";
        },
      },
    };
  }
  return originalLoad(request, parent, isMain);
};

const { runExclusively, exclusive, _internals } = require("../../utils/cronLock");
const { tickId } = _internals;

function reset() {
  store.clear();
  setCalls.length = 0;
  redisThrows = null;
}

(async () => {
  await group("tickId", () => {
    test("is stable within a minute", () => {
      // Two processes whose clocks differ by a few hundred ms must compute the
      // same tick, or both would win and both would run.
      const a = tickId(new Date("2026-09-08T14:23:45.123Z"));
      const b = tickId(new Date("2026-09-08T14:23:45.999Z"));
      assert.equal(a, b);
    });

    test("changes with the minute", () => {
      const a = tickId(new Date("2026-09-08T14:23:00.000Z"));
      const b = tickId(new Date("2026-09-08T14:24:00.000Z"));
      assert.notEqual(a, b);
    });
  });

  await group("runExclusively", async () => {
    await testAsync("the first caller runs the job", async () => {
      reset();
      let ran = 0;
      const won = await runExclusively("job-a", 60, async () => {
        ran += 1;
      });
      assert.equal(won, true);
      assert.equal(ran, 1);
    });

    await testAsync("a second process in the same tick does NOT run it", async () => {
      // The whole point: two processes, one tick, one execution.
      reset();
      let ran = 0;
      const inc = async () => {
        ran += 1;
      };
      const first = await runExclusively("job-b", 60, inc);
      const second = await runExclusively("job-b", 60, inc);
      assert.equal(first, true);
      assert.equal(second, false, "second process must skip");
      assert.equal(ran, 1, "job must have executed exactly once");
    });

    await testAsync("concurrent callers still produce exactly one run", async () => {
      reset();
      let ran = 0;
      const inc = async () => {
        ran += 1;
      };
      const results = await Promise.all([
        runExclusively("job-c", 60, inc),
        runExclusively("job-c", 60, inc),
        runExclusively("job-c", 60, inc),
      ]);
      assert.equal(results.filter(Boolean).length, 1);
      assert.equal(ran, 1);
    });

    await testAsync("different jobs do not block each other", async () => {
      reset();
      const a = await runExclusively("job-d", 60, async () => {});
      const b = await runExclusively("job-e", 60, async () => {});
      assert.equal(a, true);
      assert.equal(b, true);
    });

    await testAsync("the key is scoped to the tick, not just the job", async () => {
      // A job-name-only key leaked by a crashed process would block that job
      // forever. Scoping to the tick bounds the damage to one interval.
      reset();
      await runExclusively("job-f", 60, async () => {});
      const key = setCalls[0].key;
      assert.match(key, /^cron:job-f:\d{12}$/, `unexpected key shape: ${key}`);
      assert.ok(key.includes(tickId()), "key must carry the current tick");
    });

    await testAsync("SET is issued with NX and a TTL", async () => {
      // Without NX the guard is a no-op; without a TTL a crash blocks forever.
      reset();
      await runExclusively("job-g", 42, async () => {});
      assert.equal(setCalls[0].nx, "NX");
      assert.equal(setCalls[0].ex, "EX");
      assert.equal(setCalls[0].ttl, 42);
    });

    await testAsync("FAILS OPEN when redis is unreachable", async () => {
      // A missed scheduled run is worse than a double run for these jobs, and
      // a Redis outage means the rest of the system is broken anyway.
      reset();
      redisThrows = "connection refused";
      let ran = 0;
      const won = await runExclusively("job-h", 60, async () => {
        ran += 1;
      });
      assert.equal(won, true);
      assert.equal(ran, 1, "job must still run when the lock is unavailable");
    });

    await testAsync("a throwing job propagates to the caller", async () => {
      // runExclusively itself does not swallow — `exclusive()` is the wrapper
      // that does, and only because node-cron callbacks cannot reject safely.
      reset();
      await assert.rejects(
        () => runExclusively("job-i", 60, async () => {
          throw new Error("job blew up");
        }),
        /job blew up/,
      );
    });
  });

  await group("exclusive()", async () => {
    await testAsync("returns a callback node-cron can schedule", async () => {
      reset();
      let ran = 0;
      const cb = exclusive("job-j", 60, async () => {
        ran += 1;
      });
      assert.equal(typeof cb, "function");
      await cb();
      assert.equal(ran, 1);
    });

    await testAsync("swallows a throwing job", async () => {
      // An unhandled rejection out of a node-cron callback takes the process
      // down — and this process now runs every scheduled job in the system.
      reset();
      const cb = exclusive("job-k", 60, async () => {
        throw new Error("boom");
      });
      await cb(); // must not reject
    });

    await testAsync("still only runs once per tick", async () => {
      reset();
      let ran = 0;
      const fn = async () => {
        ran += 1;
      };
      await exclusive("job-l", 60, fn)();
      await exclusive("job-l", 60, fn)();
      assert.equal(ran, 1);
    });
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
