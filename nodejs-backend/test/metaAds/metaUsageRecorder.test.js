#!/usr/bin/env node
/**
 * Tests for services/meta/metaUsageRecorder.js — the in-memory accumulator
 * that turns Meta's usage headers into hourly per-account rows.
 *
 * The properties worth protecting are the ones that are easy to regress and
 * expensive to notice: peaks must be a MAX (not a last-write), a flush must
 * not lose calls that arrive while it is awaiting Mongo, and nothing in here
 * may ever throw into the Meta call path it wraps.
 *
 * Mocks the Mongoose model via `Module._load` monkey-patch — same pattern as
 * test/autopilot/alertService.test.js.
 */

const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");

// ───────────────────────────────────────────────────────────────────────────
// test harness
// ───────────────────────────────────────────────────────────────────────────
let pass = 0;
let fail = 0;
const FAILURES = [];

function test(name, fn) {
  try {
    fn();
    pass += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    fail += 1;
    FAILURES.push({ name, err });
    console.log(`  ✗ ${name}`);
    console.log(`      ${err.stack || err.message}`);
  }
}
async function testAsync(name, fn) {
  try {
    await fn();
    pass += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    fail += 1;
    FAILURES.push({ name, err });
    console.log(`  ✗ ${name}`);
    console.log(`      ${err.stack || err.message}`);
  }
}
function group(label, fn) {
  console.log(`\n${label}`);
  return fn();
}

// ───────────────────────────────────────────────────────────────────────────
// model mock
// ───────────────────────────────────────────────────────────────────────────
const MODEL_PATH = path.join(
  __dirname,
  "..",
  "..",
  "Module",
  "metaUsage",
  "metaApiUsage.js",
);

const modelMock = {
  writes: [],
  // Set to an Error to make the next bulkWrite reject; cleared after use.
  failWith: null,
  // Resolves only when released, to test what happens to calls arriving
  // mid-flush.
  gate: null,
  async bulkWrite(ops) {
    if (this.gate) await this.gate;
    if (this.failWith) {
      const err = this.failWith;
      this.failWith = null;
      throw err;
    }
    this.writes.push(ops);
    return { ok: 1 };
  },
  reset() {
    this.writes = [];
    this.failWith = null;
    this.gate = null;
  },
};

const loggerMock = { warn() {}, info() {}, error() {} };

const originalLoad = Module._load;
Module._load = function patched(request, parent, isMain) {
  const resolved = (() => {
    try {
      return Module._resolveFilename(request, parent, isMain);
    } catch {
      return null;
    }
  })();
  if (resolved === MODEL_PATH) return modelMock;
  if (request.endsWith("utils/logger") || request.endsWith("/logger")) {
    return loggerMock;
  }
  return originalLoad.apply(this, arguments);
};

const {
  MetaUsageRecorder,
  _internals,
} = require("../../services/meta/metaUsageRecorder");

const CTX = { userId: "GPT-435", adAccountId: "act_1001", source: "audit" };

/** A fresh recorder with its flush timer disabled — tests flush explicitly. */
function newRecorder() {
  const r = new MetaUsageRecorder();
  r.start = () => {}; // no timer in tests
  return r;
}

(async () => {
  group("pure helpers", () => {
    test("hourStart truncates to the top of the UTC hour", () => {
      const h = _internals.hourStart(new Date("2026-09-01T14:37:22.913Z"));
      assert.equal(h.toISOString(), "2026-09-01T14:00:00.000Z");
    });

    test("hourStart does not mutate its argument", () => {
      const d = new Date("2026-09-01T14:37:22.913Z");
      _internals.hourStart(d);
      assert.equal(d.toISOString(), "2026-09-01T14:37:22.913Z");
    });

    test("normalizeAccountId strips the act_ prefix", () => {
      assert.equal(_internals.normalizeAccountId("act_9988"), "9988");
      assert.equal(_internals.normalizeAccountId("9988"), "9988");
      assert.equal(_internals.normalizeAccountId(null), null);
    });

    test("peakFieldFor maps each limiter bucket kind", () => {
      const f = _internals.peakFieldFor;
      assert.equal(f({ kind: "app", key: "app:t" }), "app");
      assert.equal(f({ kind: "buc", key: "buc:t:b:ads" }), "buc");
      assert.equal(f({ kind: "acc", key: "acc:t:1" }), "acc");
      assert.equal(f({ kind: "reach", key: "reach:t:1" }), "reach");
    });

    test("peakFieldFor splits the two insights percentages apart", () => {
      // One header carries an app-wide and an account-scoped meter. Merging
      // them would hide which of the two is actually filling.
      const f = _internals.peakFieldFor;
      assert.equal(f({ kind: "insights", key: "insights:t:app" }), "insightsApp");
      assert.equal(
        f({ kind: "insights", key: "insights:t:acc:1001" }),
        "insightsAcc",
      );
    });

    test("peakFieldFor returns null for non-percentage buckets", () => {
      assert.equal(
        _internals.peakFieldFor({ kind: "local_retry", key: "x" }),
        null,
      );
      assert.equal(_internals.peakFieldFor({ kind: "future", key: "x" }), null);
    });
  });

  group("accumulation", () => {
    test("calls accumulate into one bucket per (user, account, source)", () => {
      const r = newRecorder();
      r.recordCall(CTX);
      r.recordCall(CTX);
      r.recordCall({ ...CTX, source: "ads-manager" });
      r.recordCall({ ...CTX, adAccountId: "act_2002" });
      assert.equal(r.pending.size, 3);
      const same = [...r.pending.values()].find(
        (b) => b.source === "audit" && b.adAccountId === "1001",
      );
      assert.equal(same.calls, 2);
    });

    test("act_ prefixed and bare account ids share one bucket", () => {
      const r = newRecorder();
      r.recordCall({ ...CTX, adAccountId: "act_1001" });
      r.recordCall({ ...CTX, adAccountId: "1001" });
      assert.equal(r.pending.size, 1);
      assert.equal([...r.pending.values()][0].calls, 2);
    });

    test("recordFailure counts throttles as a subset of failures", () => {
      const r = newRecorder();
      r.recordFailure(CTX, { throttled: true });
      r.recordFailure(CTX, { throttled: false });
      const b = [...r.pending.values()][0];
      assert.equal(b.failures, 2);
      assert.equal(b.throttles, 1);
    });

    test("peaks keep the MAX, not the most recent reading", () => {
      // The whole point of the collection: an average or a last-write would
      // erase the minute we were actually refused.
      const r = newRecorder();
      r.recordHeaders(CTX, [{ kind: "app", key: "app:t", usage: 91 }]);
      r.recordHeaders(CTX, [{ kind: "app", key: "app:t", usage: 4 }]);
      assert.equal([...r.pending.values()][0].peak.app, 91);
    });

    test("maxBlockedMs keeps the worst regain time seen", () => {
      const r = newRecorder();
      r.recordHeaders(CTX, [{ kind: "buc", key: "b", usage: 1, blockedMs: 60000 }]);
      r.recordHeaders(CTX, [{ kind: "buc", key: "b", usage: 1, blockedMs: 500 }]);
      assert.equal([...r.pending.values()][0].maxBlockedMs, 60000);
    });

    test("idle meters are still recorded", () => {
      // "Every meter read 1% when the app-level call failed" is a finding,
      // and only available if idle readings were kept.
      const r = newRecorder();
      r.recordHeaders(CTX, [
        { kind: "app", key: "app:t", usage: 1 },
        { kind: "insights", key: "insights:t:acc:1001", usage: 2 },
      ]);
      const b = [...r.pending.values()][0];
      assert.equal(b.peak.app, 1);
      assert.equal(b.peak.insightsAcc, 2);
    });

    test("tier is captured from the first bucket that reports one", () => {
      const r = newRecorder();
      r.recordHeaders(CTX, [
        { kind: "app", key: "app:t", usage: 1 },
        { kind: "buc", key: "b", usage: 1, tier: "standard_access" },
      ]);
      assert.equal([...r.pending.values()][0].tier, "standard_access");
    });
  });

  await group("flush", async () => {
    await testAsync("emits $inc and $max with the bucket as the filter", async () => {
      modelMock.reset();
      const r = newRecorder();
      r.recordCall(CTX);
      r.recordCall(CTX);
      r.recordFailure(CTX, { throttled: true });
      r.recordHeaders(CTX, [
        { kind: "app", key: "app:t", usage: 12, tier: "standard_access" },
      ]);
      await r.flush();

      assert.equal(modelMock.writes.length, 1);
      const [op] = modelMock.writes[0];
      assert.equal(op.updateOne.upsert, true);
      assert.deepEqual(op.updateOne.filter.userId, "GPT-435");
      assert.equal(op.updateOne.filter.adAccountId, "1001");
      assert.equal(op.updateOne.filter.source, "audit");
      assert.ok(op.updateOne.filter.hourStart instanceof Date);
      assert.deepEqual(op.updateOne.update.$inc, {
        calls: 2,
        failures: 1,
        throttles: 1,
      });
      assert.deepEqual(op.updateOne.update.$max, { "peak.app": 12 });
      assert.deepEqual(op.updateOne.update.$setOnInsert, {
        tier: "standard_access",
      });
    });

    await testAsync("clears pending so the next flush does not double-count", async () => {
      modelMock.reset();
      const r = newRecorder();
      r.recordCall(CTX);
      await r.flush();
      await r.flush();
      assert.equal(modelMock.writes.length, 1, "second flush should be a no-op");
      assert.equal(r.pending.size, 0);
    });

    await testAsync("calls arriving mid-flush are kept, not swallowed", async () => {
      // The map is swapped before the await. If it were cleared after, every
      // call made during the Mongo round-trip would vanish.
      modelMock.reset();
      let release;
      modelMock.gate = new Promise((res) => {
        release = res;
      });

      const r = newRecorder();
      r.recordCall(CTX);
      const flushing = r.flush();

      r.recordCall(CTX); // arrives while the write is in flight
      r.recordCall(CTX);

      release();
      await flushing;

      assert.equal(modelMock.writes[0][0].updateOne.update.$inc.calls, 1);
      assert.equal(r.pending.size, 1, "mid-flush calls must survive");
      assert.equal([...r.pending.values()][0].calls, 2);

      modelMock.gate = null;
      await r.flush();
      assert.equal(modelMock.writes[1][0].updateOne.update.$inc.calls, 2);
    });

    await testAsync("a failing write drops the batch instead of throwing", async () => {
      modelMock.reset();
      modelMock.failWith = new Error("Mongo is down");
      const r = newRecorder();
      r.recordCall(CTX);
      await r.flush(); // must resolve, not reject
      assert.equal(r.stats.droppedBatches, 1);
      assert.equal(r.pending.size, 0, "a dropped batch must not be re-queued");
    });

    await testAsync("a bucket with nothing to write emits no op", async () => {
      modelMock.reset();
      const r = newRecorder();
      // Headers whose every meter reads 0 and which block nothing.
      r.recordHeaders(CTX, [{ kind: "app", key: "app:t", usage: 0 }]);
      await r.flush();
      assert.equal(modelMock.writes.length, 0);
    });
  });

  await group("safety", async () => {
    test("recording never throws, whatever it is handed", () => {
      const r = newRecorder();
      // The wrapper sits inside the Meta call path — a throw here would turn
      // a working request into a failed one.
      assert.doesNotThrow(() => r.recordCall(undefined));
      assert.doesNotThrow(() => r.recordCall({ userId: {}, adAccountId: [] }));
      assert.doesNotThrow(() => r.recordHeaders(CTX, null));
      assert.doesNotThrow(() => r.recordHeaders(CTX, [null]));
      assert.doesNotThrow(() => r.recordHeaders(CTX, "not an array"));
      assert.doesNotThrow(() => r.recordFailure(CTX, undefined));
    });

    await testAsync("META_USAGE_TRACKING=off records nothing", async () => {
      modelMock.reset();
      const prev = process.env.META_USAGE_TRACKING;
      process.env.META_USAGE_TRACKING = "off";
      try {
        const r = newRecorder();
        r.recordCall(CTX);
        r.recordHeaders(CTX, [{ kind: "app", key: "a", usage: 99 }]);
        assert.equal(r.pending.size, 0);
        await r.flush();
        assert.equal(modelMock.writes.length, 0);
      } finally {
        if (prev === undefined) delete process.env.META_USAGE_TRACKING;
        else process.env.META_USAGE_TRACKING = prev;
      }
    });

    test("snapshot reports enough to know the numbers are trustworthy", () => {
      const r = newRecorder();
      r.recordCall(CTX);
      const s = r.snapshot();
      assert.equal(s.pending, 1);
      assert.equal(s.enabled, true);
      assert.equal(s.droppedBatches, 0);
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
