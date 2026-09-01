#!/usr/bin/env node
/**
 * verify-meta-usage — exercise the real recorder against a real database.
 *
 * WHY THIS EXISTS: the unit tests mock the Mongoose model, and a mock happily
 * accepts an update the real server would reject. Three things can only fail
 * against Mongo itself, and all three fail SILENTLY rather than loudly:
 *
 *   - `$inc` and `$max` in one update. Legal, but if a field were ever named
 *     in both operators the server rejects the whole write — and the recorder
 *     swallows its own errors by design, so the row simply never appears.
 *   - The unique compound index. If it does not match the upsert filter
 *     exactly, concurrent workers create DUPLICATE rows per hour instead of
 *     composing into one, and every number the admin page shows is then a
 *     fraction of the truth.
 *   - `$max` on a nested `peak.*` path against a subdocument default. If this
 *     misbehaves, peaks read 0 forever and a throttle looks like an idle hour.
 *
 * SAFETY: every fixture is written under a synthetic user + ad-account id
 * unique to this run (`musage_<random>`), so it cannot collide with, read, or
 * delete real data. Cleanup deletes only rows carrying that id, and runs even
 * when an assertion fails.
 *
 * Usage:  node scripts/verify-meta-usage.js
 * Needs:  MONGO_CONNECTION_STRING
 */

require("dotenv").config();
const mongoose = require("mongoose");
const { randomUUID } = require("node:crypto");

const MetaApiUsage = require("../Module/metaUsage/metaApiUsage");
const { MetaUsageRecorder } = require("../services/meta/metaUsageRecorder");

const TAG = `musage_${randomUUID().slice(0, 8)}`;
const USER = `${TAG}_user`;
const ACCT = `${TAG}_acct`;

let pass = 0;
let fail = 0;
const FAILURES = [];

function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      pass += 1;
      console.log(`  ✓ ${name}`);
    })
    .catch((err) => {
      fail += 1;
      FAILURES.push({ name, err });
      console.log(`  ✗ ${name}`);
      console.log(`      ${err.stack || err.message}`);
    });
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
function assertEq(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg}: expected ${expected}, got ${actual}`);
  }
}

/** A recorder with no background timer — this script flushes explicitly. */
function newRecorder() {
  const r = new MetaUsageRecorder();
  r.start = () => {};
  return r;
}

const ctx = (over = {}) => ({
  userId: USER,
  adAccountId: ACCT,
  source: "verify",
  ...over,
});

/** The single row this run should be producing. */
function row(source = "verify") {
  return MetaApiUsage.findOne({ userId: USER, adAccountId: ACCT, source }).lean();
}

(async () => {
  const uri = process.env.MONGO_CONNECTION_STRING;
  if (!uri) {
    console.error("MONGO_CONNECTION_STRING is not set — cannot verify.");
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log(`connected: ${mongoose.connection.name}`);
  console.log(`fixtures under user=${USER} acct=${ACCT}\n`);

  try {
    // The indexes are what make concurrent writes compose. Building them
    // explicitly means a broken definition fails HERE rather than silently
    // never being applied.
    await MetaApiUsage.init();

    console.log("upsert shape");

    await check("a first flush inserts one row with counters and peaks", async () => {
      const r = newRecorder();
      r.recordCall(ctx());
      r.recordCall(ctx());
      r.recordFailure(ctx(), { throttled: true });
      r.recordHeaders(ctx(), [
        { kind: "app", key: "app:t", usage: 12, tier: "standard_access" },
        { kind: "insights", key: "insights:t:acc:1", usage: 44 },
      ]);
      await r.flush();

      const doc = await row();
      assert(doc, "no row was written");
      assertEq(doc.calls, 2, "calls");
      assertEq(doc.failures, 1, "failures");
      assertEq(doc.throttles, 1, "throttles");
      assertEq(doc.peak.app, 12, "peak.app");
      assertEq(doc.peak.insightsAcc, 44, "peak.insightsAcc");
      assertEq(doc.tier, "standard_access", "tier");
    });

    await check("$inc and $max coexist in one update", async () => {
      // The combination the mock cannot validate. If Mongo rejected it the
      // recorder would swallow the error and the counters below would be
      // stuck at their first-flush values.
      const r = newRecorder();
      r.recordCall(ctx());
      r.recordHeaders(ctx(), [{ kind: "app", key: "app:t", usage: 5 }]);
      await r.flush();

      const doc = await row();
      assertEq(doc.calls, 3, "calls should have incremented");
      assertEq(doc.peak.app, 12, "peak must NOT drop to the lower reading");
    });

    await check("a higher peak raises the stored value", async () => {
      const r = newRecorder();
      r.recordHeaders(ctx(), [{ kind: "app", key: "app:t", usage: 97 }]);
      await r.flush();
      assertEq((await row()).peak.app, 97, "peak.app should rise");
    });

    await check("repeated flushes compose into ONE row, not many", async () => {
      // The unique index doing its job. Duplicates here would make every
      // admin-page total a fraction of the truth.
      const count = await MetaApiUsage.countDocuments({
        userId: USER,
        adAccountId: ACCT,
        source: "verify",
      });
      assertEq(count, 1, "row count for this hour");
    });

    await check("tier is not overwritten by a later flush", async () => {
      const r = newRecorder();
      r.recordHeaders(ctx(), [
        { kind: "app", key: "app:t", usage: 1, tier: "development_access" },
      ]);
      await r.flush();
      assertEq(
        (await row()).tier,
        "standard_access",
        "$setOnInsert must not rewrite tier",
      );
    });

    console.log("\nseparation");

    await check("a different source gets its own row", async () => {
      const r = newRecorder();
      r.recordCall(ctx({ source: "ads-manager" }));
      await r.flush();

      const other = await row("ads-manager");
      assert(other, "no row for the second source");
      assertEq(other.calls, 1, "second source calls");
      assertEq((await row()).calls, 3, "first source must be untouched");
    });

    await check("concurrent flushes of the same bucket compose", async () => {
      // Two recorders standing in for two PM2 instances writing the same
      // hour. `$inc` must add, not overwrite.
      const before = (await row()).calls;
      const a = newRecorder();
      const b = newRecorder();
      a.recordCall(ctx());
      a.recordCall(ctx());
      b.recordCall(ctx());
      await Promise.all([a.flush(), b.flush()]);
      assertEq((await row()).calls, before + 3, "calls after concurrent flush");
    });

    console.log("\nresilience");

    await check("the unique index is actually present on the collection", async () => {
      const idx = await MetaApiUsage.collection.indexes();
      const unique = idx.find(
        (i) =>
          i.unique &&
          i.key.userId === 1 &&
          i.key.adAccountId === 1 &&
          i.key.source === 1 &&
          i.key.hourStart === 1,
      );
      assert(unique, `no unique compound index found; have ${JSON.stringify(idx.map((i) => i.name))}`);
    });

    await check("the TTL index is present", async () => {
      const idx = await MetaApiUsage.collection.indexes();
      const ttl = idx.find((i) => i.expireAfterSeconds !== undefined);
      assert(ttl, "no TTL index — the collection would grow unbounded");
      assertEq(
        ttl.expireAfterSeconds,
        MetaApiUsage.RETENTION_DAYS * 24 * 60 * 60,
        "TTL seconds",
      );
    });

    await check("a null userId still records (unattributed, not dropped)", async () => {
      const r = newRecorder();
      r.recordCall({ userId: null, adAccountId: ACCT, source: "verify" });
      await r.flush();
      const doc = await MetaApiUsage.findOne({
        userId: null,
        adAccountId: ACCT,
      }).lean();
      assert(doc, "an unattributed call must still be counted");
      assertEq(doc.calls, 1, "unattributed calls");
    });
  } finally {
    const removed = await MetaApiUsage.deleteMany({ adAccountId: ACCT });
    console.log(`\ncleanup: removed ${removed.deletedCount} fixture rows`);
    await mongoose.disconnect();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) {
    for (const f of FAILURES) {
      console.log(`\n FAIL: ${f.name}`);
      console.log(f.err.stack || f.err.message);
    }
    process.exit(1);
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
