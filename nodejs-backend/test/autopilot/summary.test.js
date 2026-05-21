#!/usr/bin/env node
/**
 * Tests for services/autopilot/summaryService — pure aggregation helpers
 * over autopilotActionLog rows. No DB, no SDK, no HTTP.
 *
 * Run: node test/autopilot/summary.test.js
 */

const assert = require("node:assert/strict");

const {
  buildSummary,
  buildRunDetail,
  ACTION_TYPES,
} = require("../../services/autopilot/summaryService");

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
    console.log(`      ${err.message}`);
  }
}
function group(label, fn) {
  console.log(`\n${label}`);
  fn();
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function row(overrides = {}) {
  return {
    runId: "r1",
    userId: "GPT-414",
    adAccountId: "act_1",
    adAccountName: "AdsGPT",
    level: "campaign",
    entityId: "c1",
    entityName: "C1",
    ruleId: "AUD-01",
    ruleSeverity: "critical",
    action: "pause",
    dryRun: true,
    outcome: "success",
    runAt: new Date("2026-04-26T10:00:00Z"),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------

group("buildSummary — shape", () => {
  test("empty input returns zeroed shape", () => {
    const s = buildSummary([]);
    assert.equal(s.total, 0);
    for (const a of ACTION_TYPES) {
      assert.deepEqual(s.by_action[a], {
        success: 0,
        failed: 0,
        skipped: 0,
        total: 0,
      });
    }
    assert.deepEqual(s.by_severity, {
      // v3 legacy
      critical: 0,
      warning: 0,
      opportunity: 0,
      // v4
      high: 0,
      medium: 0,
      low: 0,
    });
    assert.deepEqual(s.by_dryRun, { true: 0, false: 0 });
    assert.deepEqual(s.by_account, []);
    assert.deepEqual(s.top_rules, []);
    assert.equal(s.first_run_at, null);
    assert.equal(s.last_run_at, null);
  });

  test("null / non-array input is defensively coerced to empty", () => {
    assert.equal(buildSummary(null).total, 0);
    assert.equal(buildSummary(undefined).total, 0);
    assert.equal(buildSummary("oops").total, 0);
  });
});

group("buildSummary — by_action / by_outcome counts", () => {
  test("3 successful pauses, 1 failed pause, 1 skipped resume", () => {
    const rows = [
      row({ action: "pause", outcome: "success" }),
      row({ action: "pause", outcome: "success" }),
      row({ action: "pause", outcome: "success" }),
      row({ action: "pause", outcome: "failed" }),
      row({ action: "resume", outcome: "skipped" }),
    ];
    const s = buildSummary(rows);
    assert.equal(s.total, 5);
    assert.deepEqual(s.by_action.pause, {
      success: 3,
      failed: 1,
      skipped: 0,
      total: 4,
    });
    assert.deepEqual(s.by_action.resume, {
      success: 0,
      failed: 0,
      skipped: 1,
      total: 1,
    });
    assert.equal(s.by_action.scale_budget.total, 0);
  });

  test("unknown action type is added dynamically (defensive)", () => {
    const s = buildSummary([row({ action: "future_action" })]);
    assert.equal(s.by_action.future_action.total, 1);
    assert.equal(s.by_action.future_action.success, 1);
  });
});

group("buildSummary — by_severity / by_dryRun / top_rules", () => {
  test("severity counts roll up across v3 + v4 buckets", () => {
    const s = buildSummary([
      row({ ruleSeverity: "critical" }),
      row({ ruleSeverity: "critical" }),
      row({ ruleSeverity: "warning" }),
      row({ ruleSeverity: "opportunity" }),
      row({ ruleSeverity: "high" }),
      row({ ruleSeverity: "medium" }),
      row({ ruleSeverity: "low" }),
      row({ ruleSeverity: undefined }), // ignored
    ]);
    assert.deepEqual(s.by_severity, {
      // v3 (legacy)
      critical: 2,
      warning: 1,
      opportunity: 1,
      // v4
      high: 1,
      medium: 1,
      low: 1,
    });
  });

  test("dryRun split", () => {
    const s = buildSummary([
      row({ dryRun: true }),
      row({ dryRun: true }),
      row({ dryRun: false }),
    ]);
    assert.deepEqual(s.by_dryRun, { true: 2, false: 1 });
  });

  test("top_rules sorted desc, capped at 5", () => {
    const rows = [];
    for (let i = 0; i < 8; i += 1) {
      // 8 distinct rules with descending counts: AUD-X with X+1 occurrences
      for (let j = 0; j <= i; j += 1) {
        rows.push(row({ ruleId: `AUD-${10 - i}` }));
      }
    }
    const s = buildSummary(rows);
    assert.equal(s.top_rules.length, 5);
    // Rule with 8 hits should top, 4 next, descending.
    assert.equal(s.top_rules[0].count >= s.top_rules[1].count, true);
  });
});

group("buildSummary — by_account", () => {
  test("groups by adAccountId, sorted by total desc", () => {
    const s = buildSummary([
      row({ adAccountId: "act_1", adAccountName: "AdsGPT" }),
      row({ adAccountId: "act_2", adAccountName: "Globussoft AI" }),
      row({ adAccountId: "act_2", adAccountName: "Globussoft AI" }),
      row({ adAccountId: "act_2", adAccountName: "Globussoft AI" }),
      row({ adAccountId: "act_3", adAccountName: "Test", outcome: "failed" }),
    ]);
    assert.equal(s.by_account.length, 3);
    assert.equal(s.by_account[0].adAccountId, "act_2"); // highest total
    assert.equal(s.by_account[0].total, 3);
    assert.equal(s.by_account[2].adAccountId, "act_3");
    assert.equal(s.by_account[2].failed, 1);
  });

  test("missing adAccountName is filled in from a later row", () => {
    const s = buildSummary([
      row({ adAccountId: "act_x", adAccountName: undefined }),
      row({ adAccountId: "act_x", adAccountName: "X" }),
    ]);
    const acct = s.by_account.find((a) => a.adAccountId === "act_x");
    assert.equal(acct.adAccountName, "X");
  });
});

group("buildSummary — first/last run timestamps", () => {
  test("computes ISO min and max of runAt", () => {
    const s = buildSummary([
      row({ runAt: new Date("2026-04-25T10:00:00Z") }),
      row({ runAt: new Date("2026-04-26T11:00:00Z") }),
      row({ runAt: new Date("2026-04-26T09:00:00Z") }),
    ]);
    assert.equal(s.first_run_at, "2026-04-25T10:00:00.000Z");
    assert.equal(s.last_run_at, "2026-04-26T11:00:00.000Z");
  });
});

group("buildSummary — by_day", () => {
  test("buckets rows by UTC calendar day, counting per action", () => {
    const s = buildSummary([
      row({ runAt: new Date("2026-04-25T10:00:00Z"), action: "pause" }),
      row({ runAt: new Date("2026-04-25T23:30:00Z"), action: "alert_only" }),
      row({ runAt: new Date("2026-04-26T09:00:00Z"), action: "pause" }),
      row({ runAt: new Date("2026-04-26T09:05:00Z"), action: "scale_budget" }),
    ]);
    assert.equal(s.by_day.length, 2);
    // sorted ascending by date
    assert.equal(s.by_day[0].date, "2026-04-25");
    assert.equal(s.by_day[1].date, "2026-04-26");
    assert.equal(s.by_day[0].total, 2);
    assert.deepEqual(s.by_day[0].by_action, { pause: 1, alert_only: 1 });
    assert.equal(s.by_day[1].total, 2);
    assert.deepEqual(s.by_day[1].by_action, { pause: 1, scale_budget: 1 });
  });

  test("rows past UTC midnight land on the next UTC day", () => {
    // 2026-04-26T23:30Z and 2026-04-27T00:30Z are 1h apart but different
    // UTC days — the chart must not collapse them into one bar.
    const s = buildSummary([
      row({ runAt: new Date("2026-04-26T23:30:00Z") }),
      row({ runAt: new Date("2026-04-27T00:30:00Z") }),
    ]);
    assert.equal(s.by_day.length, 2);
    assert.deepEqual(
      s.by_day.map((d) => d.date),
      ["2026-04-26", "2026-04-27"],
    );
  });

  test("empty input yields an empty by_day array", () => {
    assert.deepEqual(buildSummary([]).by_day, []);
  });
});

group("buildRunDetail", () => {
  test("returns rollup + sorted rows for a single runId", () => {
    const r1 = row({
      runId: "abc",
      runAt: new Date("2026-04-26T10:30:00Z"),
    });
    const r2 = row({
      runId: "abc",
      runAt: new Date("2026-04-26T10:00:00Z"),
    });
    const r3 = row({
      runId: "abc",
      runAt: new Date("2026-04-26T10:15:00Z"),
    });

    const detail = buildRunDetail({ runId: "abc", rows: [r1, r2, r3] });
    assert.equal(detail.runId, "abc");
    assert.equal(detail.total, 3);
    // sorted oldest → newest
    assert.equal(
      detail.rows[0].runAt.toISOString(),
      "2026-04-26T10:00:00.000Z",
    );
    assert.equal(
      detail.rows[2].runAt.toISOString(),
      "2026-04-26T10:30:00.000Z",
    );
    assert.ok(detail.by_account);
    assert.ok(detail.by_action);
  });

  test("missing runId returns degenerate empty result", () => {
    const detail = buildRunDetail({ runId: null, rows: [] });
    assert.equal(detail.total, 0);
    assert.deepEqual(detail.rows, []);
  });
});

// ---------------------------------------------------------------------------
console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log("\nFailures:");
  for (const { name, err } of FAILURES) {
    console.log(`  - ${name}: ${err.stack || err.message}`);
  }
  process.exit(1);
}
