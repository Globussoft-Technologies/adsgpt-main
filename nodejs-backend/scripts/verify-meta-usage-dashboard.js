#!/usr/bin/env node
/**
 * verify-meta-usage-dashboard — run the admin controller's REAL aggregations
 * against a REAL database, over fixtures whose correct answers are known.
 *
 * WHY THIS EXISTS: every failure mode here returns a NUMBER, not an error.
 * A `$sum` where a `$max` belongs turns two quiet hours at 50% into "100%
 * utilisation" and sends someone hunting an outage that never happened. A
 * `$max` where a `$sum` belongs reports 3 calls when 300 were made. Both
 * render perfectly on the page.
 *
 * The fixtures are built so that summing and maxing give DIFFERENT answers
 * for every field — otherwise the test passes under either mistake.
 *
 * SAFETY: fixtures live under a synthetic user + ad-account id unique to this
 * run (`mudash_<random>`); cleanup deletes only those and runs even when an
 * assertion fails.
 *
 * Usage:  node scripts/verify-meta-usage-dashboard.js
 * Needs:  MONGO_CONNECTION_STRING
 */

require("dotenv").config();
const mongoose = require("mongoose");
const { randomUUID } = require("node:crypto");

const MetaApiUsage = require("../Module/metaUsage/metaApiUsage");
const MetaAdAccountName = require("../Module/metaUsage/metaAdAccountName");
const controller = require("../controllers/admin/metaUsageDashboard.controller");

const TAG = `mudash_${randomUUID().slice(0, 8)}`;
const USER = `${TAG}_user`;
const ACCT_A = `${TAG}_a`;
const ACCT_B = `${TAG}_b`;

const HOUR = 60 * 60 * 1000;
const BASE = new Date(Math.floor(Date.now() / HOUR) * HOUR - 3 * HOUR);
const hour = (n) => new Date(BASE.getTime() + n * HOUR);

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
function assertEq(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg}: expected ${expected}, got ${actual}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

/** Collect what the controller would have sent, without an HTTP server. */
function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

async function callOverview(query = {}) {
  const res = fakeRes();
  await controller.overview({ query }, res);
  assertEq(res.statusCode, 200, `overview status (${JSON.stringify(res.body)})`);
  return res.body;
}
async function callFilterOptions(query = {}) {
  const res = fakeRes();
  await controller.filterOptions({ query }, res);
  assertEq(res.statusCode, 200, `filterOptions status (${JSON.stringify(res.body)})`);
  return res.body;
}
async function callUserDetail(userId, query = {}) {
  const res = fakeRes();
  await controller.userDetail({ params: { userId }, query }, res);
  assertEq(res.statusCode, 200, `userDetail status (${JSON.stringify(res.body)})`);
  return res.body;
}

(async () => {
  const uri = process.env.MONGO_CONNECTION_STRING;
  if (!uri) {
    console.error("MONGO_CONNECTION_STRING is not set — cannot verify.");
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log(`connected: ${mongoose.connection.name}`);
  console.log(`fixtures under user=${USER}\n`);

  try {
    // Deliberately chosen so sum ≠ max everywhere:
    //   calls   10 + 20 + 5  = 35   (max would be 20)
    //   peak.app 80, 10, 40  → 80   (sum would be 130, an impossible %)
    await MetaApiUsage.insertMany([
      {
        userId: USER,
        adAccountId: ACCT_A,
        source: "audit",
        hourStart: hour(0),
        calls: 10,
        failures: 2,
        throttles: 1,
        peak: { app: 80, insightsAcc: 30 },
        maxBlockedMs: 60000,
        tier: "standard_access",
      },
      {
        userId: USER,
        adAccountId: ACCT_A,
        source: "ads-manager",
        hourStart: hour(1),
        calls: 20,
        failures: 0,
        throttles: 0,
        peak: { app: 10, insightsAcc: 70 },
        maxBlockedMs: 0,
      },
      {
        userId: USER,
        adAccountId: ACCT_B,
        source: "ads-manager",
        hourStart: hour(1),
        calls: 5,
        failures: 1,
        throttles: 0,
        peak: { app: 40, insightsAcc: 5 },
        maxBlockedMs: 0,
      },
    ]);

    console.log("counters vs meters");

    await check("counts are SUMMED across rows", async () => {
      const body = await callUserDetail(USER);
      assertEq(body.totals.calls, 35, "calls");
      assertEq(body.totals.failures, 3, "failures");
      assertEq(body.totals.throttles, 1, "throttles");
    });

    await check("percentages are MAXED, never summed", async () => {
      // 80 + 10 + 40 = 130, which is not a possible utilisation. If this
      // reads 130 the aggregation is summing a percentage.
      const body = await callUserDetail(USER);
      assertEq(body.totals.peakApp, 80, "peakApp");
      assertEq(body.totals.peakInsightsAcc, 70, "peakInsightsAcc");
    });

    await check("maxBlockedMs takes the worst, not the total", async () => {
      const body = await callUserDetail(USER);
      assertEq(body.totals.maxBlockedMs, 60000, "maxBlockedMs");
    });

    console.log("\nbreakdowns");

    await check("per-account rollup splits the two accounts correctly", async () => {
      const body = await callUserDetail(USER);
      const a = body.byAccount.find((r) => r.adAccountId === ACCT_A);
      const b = body.byAccount.find((r) => r.adAccountId === ACCT_B);
      assert(a && b, "both accounts should appear");
      assertEq(a.calls, 30, "account A calls");
      assertEq(a.peakApp, 80, "account A peakApp");
      assertEq(b.calls, 5, "account B calls");
    });

    await check("per-source rollup separates scheduled from interactive", async () => {
      // The split the whole exercise is for: a steady cron draw versus a
      // person clicking around.
      const body = await callUserDetail(USER);
      const audit = body.bySource.find((r) => r.source === "audit");
      const manager = body.bySource.find((r) => r.source === "ads-manager");
      assertEq(audit.calls, 10, "audit calls");
      assertEq(manager.calls, 25, "ads-manager calls");
    });

    await check("hourly series is ordered oldest first", async () => {
      const body = await callUserDetail(USER);
      const mine = body.hourly.filter((r) =>
        [ACCT_A, ACCT_B].includes(r.adAccountId),
      );
      assert(mine.length >= 3, `expected 3 hourly rows, got ${mine.length}`);
      const times = mine.map((r) => new Date(r.hour).getTime());
      const sorted = [...times].sort((x, y) => x - y);
      assert(JSON.stringify(times) === JSON.stringify(sorted), "hourly must be ascending");
    });

    console.log("\nfilters");

    await check("source filter narrows the result", async () => {
      const body = await callUserDetail(USER, { source: "audit" });
      assertEq(body.totals.calls, 10, "calls with source=audit");
    });

    await check("adAccountId filter accepts the act_ prefix", async () => {
      const body = await callUserDetail(USER, { adAccountId: `act_${ACCT_A}` });
      assertEq(body.totals.calls, 30, "calls for account A via act_ form");
    });

    await check("a range excluding the fixtures returns zeroed totals", async () => {
      const from = new Date(BASE.getTime() - 40 * HOUR);
      const to = new Date(BASE.getTime() - 30 * HOUR);
      const body = await callUserDetail(USER, {
        from: from.toISOString(),
        to: to.toISOString(),
      });
      assertEq(body.totals.calls, 0, "calls outside the range");
      assertEq(body.totals.peakApp, 0, "peakApp outside the range");
    });

    await check("a date-only `to` covers the WHOLE of that day", async () => {
      // The admin picker sends `YYYY-MM-DD`. Parsed as an instant that is
      // midnight, so `hourStart <= to` excluded everything recorded during
      // the day the user selected — the page rendered empty while the rows
      // sat in the collection. This is that bug, pinned.
      const day = BASE.toISOString().slice(0, 10);
      const body = await callUserDetail(USER, { from: day, to: day });
      assert(
        body.totals.calls > 0,
        `a same-day range must include that day's rows, got ${body.totals.calls}`,
      );
    });

    await check("a date-only `from` starts at midnight, not now", async () => {
      const day = BASE.toISOString().slice(0, 10);
      const { from } = controller._internals.resolveRange({ from: day, to: day });
      assertEq(from.toISOString(), `${day}T00:00:00.000Z`, "from");
    });

    await check("an unknown user returns zeros rather than an error", async () => {
      const body = await callUserDetail(`${TAG}_nobody`);
      assertEq(body.totals.calls, 0, "calls");
      assert(Array.isArray(body.byAccount), "byAccount should be an array");
    });

    console.log("\nnames and filters");

    await check("an account with a known name gets it attached", async () => {
      await MetaAdAccountName.updateOne(
        { adAccountId: ACCT_A },
        { $set: { name: "Fixture Account A" } },
        { upsert: true },
      );
      const body = await callUserDetail(USER);
      const a = body.byAccount.find((r) => r.adAccountId === ACCT_A);
      assertEq(a.adAccountName, "Fixture Account A", "adAccountName");
    });

    await check("an unnamed account gets an empty string, not its id", async () => {
      // The UI decides how to fall back; presenting an id as a name would be
      // a lie the page has no way to detect.
      const body = await callUserDetail(USER);
      const b = body.byAccount.find((r) => r.adAccountId === ACCT_B);
      assertEq(b.adAccountName, "", "adAccountName for an unnamed account");
    });

    await check("search matches an account NAME, not just its id", async () => {
      const body = await callUserDetail(USER, { search: "Fixture Account" });
      assertEq(body.byAccount.length, 1, "rows matching the name");
      assertEq(body.byAccount[0].adAccountId, ACCT_A, "matched account");
    });

    await check("search matches an id with or without the act_ prefix", async () => {
      const withPrefix = await callUserDetail(USER, { search: "act_" + ACCT_B });
      const without = await callUserDetail(USER, { search: ACCT_B });
      assertEq(withPrefix.byAccount.length, 1, "act_ form");
      assertEq(without.byAccount.length, 1, "bare form");
    });

    await check("a search matching nothing returns nothing, not everything", async () => {
      const body = await callUserDetail(USER, { search: "zzz-no-such-thing" });
      assertEq(body.byAccount.length, 0, "rows");
    });

    await check("onlyThrottled keeps just the rows Meta refused", async () => {
      const body = await callUserDetail(USER, { onlyThrottled: "true" });
      assertEq(body.totals.throttles, 1, "throttles");
      assertEq(body.totals.calls, 10, "only the refused hour's calls");
    });

    await check("sort is whitelisted — an unknown field falls back to calls", async () => {
      // `$sort` takes a field path; passing the query string straight through
      // would let a caller sort by anything in the document.
      const spec = controller._internals.buildSort({ sort: "$where; drop", order: "desc" });
      assertEq(Object.keys(spec)[0], "calls", "sort field");
    });

    await check("sort order can be reversed", async () => {
      const body = await callOverview({ sort: "calls", order: "asc" });
      const mine = body.topAccounts.filter((r) => r.userId === USER).map((r) => r.calls);
      const sorted = [...mine].sort((x, y) => x - y);
      assert(
        JSON.stringify(mine) === JSON.stringify(sorted),
        "ascending sort expected, got " + JSON.stringify(mine),
      );
    });

    await check("an `all` filter value means no filter", async () => {
      // The UI sends "all" for an unset dropdown; treating it as a literal
      // source name would return an empty page.
      const body = await callUserDetail(USER, { source: "all", adAccountId: "all" });
      assertEq(body.totals.calls, 35, "calls");
    });

    await check("filter options are derived from the data", async () => {
      const body = await callFilterOptions();
      assert(body.sources.includes("audit"), "sources should include audit");
      assert(body.sources.includes("ads-manager"), "sources should include ads-manager");
      const acct = body.accounts.find((o) => o.value === ACCT_A);
      assert(acct, "account A should be offered");
      assert(
        acct.label.includes("Fixture Account A"),
        "account label should carry the name, got " + acct.label,
      );
    });

    await check("filter options are NOT narrowed by the filters they set", async () => {
      // A source dropdown that only offers the source already chosen is a
      // dropdown you can never leave.
      const body = await callFilterOptions({ source: "audit" });
      assert(
        body.sources.length >= 2,
        "expected every source, got " + JSON.stringify(body.sources),
      );
    });

    console.log("\noverview");

    await check("overview includes this user's accounts in topAccounts", async () => {
      const body = await callOverview();
      const mine = body.topAccounts.filter((r) => r.userId === USER);
      assert(mine.length >= 1, "expected our fixture accounts in topAccounts");
      const a = mine.find((r) => r.adAccountId === ACCT_A);
      assertEq(a.calls, 30, "account A calls in overview");
    });

    await check("an account touched by several users is ONE row, not several", async () => {
      // Grouping topAccounts by (account, user) split an account into a row
      // per user — and since pre-attribution traffic carries a null user, any
      // account with history appeared twice and read as a duplicate.
      await MetaApiUsage.create({
        userId: null,
        adAccountId: ACCT_A,
        source: "http",
        hourStart: hour(2),
        calls: 7,
      });
      const body = await callOverview();
      const rows = body.topAccounts.filter((r) => r.adAccountId === ACCT_A);
      assertEq(rows.length, 1, "rows for account A");
      assertEq(rows[0].calls, 37, "calls should include the unattributed hour");
      assertEq(rows[0].userId, USER, "should still link to the known user");
      assertEq(rows[0].hasUnattributed, true, "unattributed traffic should be flagged");
    });

    await check("overview reports recorder health so gaps are visible", async () => {
      const body = await callOverview();
      assert(body.recorder, "recorder health must be present");
      assert("droppedBatches" in body.recorder, "droppedBatches must be reported");
    });

    await check("overview echoes the resolved range", async () => {
      const body = await callOverview();
      assert(body.range.from instanceof Date || body.range.from, "range.from");
      assert(body.range.to instanceof Date || body.range.to, "range.to");
    });

    await check("an absurd range is clamped rather than scanning everything", async () => {
      const { from, to } = controller._internals.resolveRange({
        from: "1999-01-01T00:00:00Z",
      });
      const days = (to - from) / (24 * HOUR);
      assert(days <= 31.01, `range should clamp to ~31 days, got ${days}`);
    });
  } finally {
    await MetaAdAccountName.deleteMany({ adAccountId: { $in: [ACCT_A, ACCT_B] } });
    const removed = await MetaApiUsage.deleteMany({
      // Not just `userId: USER` — some fixtures are deliberately
      // unattributed, and those would survive a user-scoped delete.
      $or: [{ userId: USER }, { adAccountId: { $in: [ACCT_A, ACCT_B] } }],
    });
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
