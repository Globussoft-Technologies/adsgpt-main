#!/usr/bin/env node
/**
 * verify-autopilot-queries — run the cron's REAL autopilotActionLog reads
 * against a REAL database.
 *
 * WHY THIS EXISTS: the orchestrator's unit tests stub the Mongoose model and
 * the stubs ignore the query object, so a wrong field name or a `$match` that
 * can never match passes every test. And the resulting failures are silent,
 * not loud:
 *
 *   - `scaleHistoryFor` returning nothing means every entity reads as "no
 *     budget movement yet", gets FULL 7-day headroom every hour, and the
 *     ceiling is effectively switched off. No error anywhere.
 *   - `autopilotPausesFor` matching nothing means resume never fires and
 *     looks exactly like an engine that has correctly decided not to act.
 *
 * Neither shows up in logs. This script is how you find out.
 *
 * SAFETY: every fixture is written under a synthetic ad-account id unique to
 * this run (`act_qverify_<random>`), so it cannot collide with, read, or
 * delete real data. Cleanup deletes only rows carrying that id, and runs even
 * when an assertion fails.
 *
 * Usage:  node scripts/verify-autopilot-queries.js
 * Needs:  MONGO_CONNECTION_STRING
 */

require("dotenv").config();
const mongoose = require("mongoose");
const { randomUUID } = require("node:crypto");

const AutopilotActionLog = require("../Module/autopilot/autopilotActionLog");
const {
  autopilotPausesFor,
  flapHistoryFor,
  retirementRecorded,
  scaleHistoryFor,
} = require("../services/autopilot/actionLogQueries");

const ACCT = `act_qverify_${randomUUID().slice(0, 8)}`;
const USER = `qverify_${randomUUID().slice(0, 8)}`;
const RULE_A = "qverify_rule_a";
const RULE_B = "qverify_rule_b";
const RETIRED = "retired-out-of-retries";

const DAY = 24 * 60 * 60 * 1000;
const ago = (d) => new Date(Date.now() - d * DAY);

let pass = 0;
let fail = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) {
    pass += 1;
    console.log(`  ✓ ${name}`);
  } else {
    fail += 1;
    failures.push({ name, detail });
    console.log(`  ✗ ${name}`);
    if (detail) console.log(`      ${detail}`);
  }
}

// A minimal valid action-log row. Every required field must be present or
// Mongoose refuses the insert — which would itself be a finding.
function row(over = {}) {
  return {
    runId: randomUUID(),
    userId: USER,
    adAccountId: ACCT,
    level: "ad",
    entityId: "ent_1",
    entityName: "Entity One",
    ruleId: RULE_A,
    ruleSeverity: "high",
    ruleMessage: "verify",
    action: "pause",
    outcome: "success",
    dryRun: false,
    pausedBy: "autopilot",
    runAt: ago(1),
    ...over,
  };
}

async function seed() {
  await AutopilotActionLog.insertMany([
    // ── resume candidates ──
    row({ entityId: "ent_1", runAt: ago(9) }), // older pause, same entity
    row({ entityId: "ent_1", runAt: ago(2) }), // newest — should win $first
    row({ entityId: "ent_2", level: "adset", runAt: ago(3) }),
    // Must NOT be picked up as candidates:
    row({ entityId: "ent_dry", dryRun: true }), // never touched Meta
    row({ entityId: "ent_failed", outcome: "failed" }), // never landed
    row({ entityId: "ent_human", pausedBy: "human" }), // not ours to undo
    row({ entityId: "ent_old", runAt: ago(60) }), // outside the window
    row({ entityId: "ent_otherrule", ruleId: "qverify_rule_z" }),

    // ── flap history for ent_1 ──
    row({ entityId: "ent_1", action: "resume", runAt: ago(7) }),
    row({ entityId: "ent_1", action: "resume", runAt: ago(4) }),

    // ── retirement marker, written AFTER ent_2's last pause ──
    row({
      entityId: "ent_2",
      level: "adset",
      ruleId: RULE_A,
      action: "resume",
      outcome: "skipped",
      skipReason: RETIRED,
      runAt: ago(1),
    }),

    // ── scale history for ent_scale ──
    row({
      entityId: "ent_scale",
      level: "adset",
      action: "scale_budget",
      runAt: ago(5),
      actionPayload: { prev_budget: 25000, new_budget: 30000, pct_change: 20 },
    }),
    row({
      entityId: "ent_scale",
      level: "adset",
      action: "scale_budget",
      runAt: ago(2),
      actionPayload: { prev_budget: 30000, new_budget: 36000, pct_change: 20 },
    }),
    // Must NOT count toward the baseline:
    row({
      entityId: "ent_scale",
      level: "adset",
      action: "scale_budget",
      dryRun: true,
      runAt: ago(6),
      actionPayload: { prev_budget: 999, new_budget: 1, pct_change: 20 },
    }),
    row({
      entityId: "ent_scale",
      level: "adset",
      action: "scale_budget",
      runAt: ago(30),
      actionPayload: { prev_budget: 111, new_budget: 1, pct_change: 20 },
    }),
  ]);
}

async function main() {
  if (!process.env.MONGO_CONNECTION_STRING) {
    console.error("MONGO_CONNECTION_STRING is not set — nothing to verify.");
    process.exit(2);
  }

  await mongoose.connect(process.env.MONGO_CONNECTION_STRING, {
    serverSelectionTimeoutMS: 10000,
  });
  console.log(`Connected. Fixtures under ${ACCT}\n`);

  try {
    await seed();

    console.log("autopilotPausesFor — resume candidate lookup");
    const pauses = await autopilotPausesFor({
      userId: USER,
      adAccountId: ACCT,
      ruleIds: [RULE_A, RULE_B],
      sinceDays: 30,
    });
    const ids = pauses.map((p) => p._id.entityId).sort();
    check(
      "returns exactly the real, autopilot-made, in-window pauses",
      JSON.stringify(ids) === JSON.stringify(["ent_1", "ent_2"]),
      `got ${JSON.stringify(ids)} — expected ["ent_1","ent_2"]`,
    );
    const ent1 = pauses.find((p) => p._id.entityId === "ent_1");
    check(
      "groups to the MOST RECENT pause per entity",
      ent1 && Math.abs(new Date(ent1.lastPausedAt) - ago(2)) < 60000,
      `lastPausedAt=${ent1 && ent1.lastPausedAt} — expected ~${ago(2).toISOString()}`,
    );
    check(
      "carries level through the grouping",
      pauses.find((p) => p._id.entityId === "ent_2")?._id.level === "adset",
      "level missing or wrong on the grouped row",
    );
    check(
      "carries ruleId forward (resume needs it to re-evaluate)",
      ent1 && ent1.ruleId === RULE_A,
      `ruleId=${ent1 && ent1.ruleId}`,
    );

    console.log("\nflapHistoryFor — trial counter");
    const flaps = await flapHistoryFor({
      adAccountId: ACCT,
      entityId: "ent_1",
      sinceDays: 28,
    });
    check(
      "returns this entity's pause/resume rows",
      flaps.length === 4,
      `got ${flaps.length} rows — expected 4 (2 pause + 2 resume in window)`,
    );
    check(
      "is sorted oldest-first (countFlaps depends on order)",
      flaps.every(
        (r, i) => i === 0 || new Date(flaps[i - 1].runAt) <= new Date(r.runAt),
      ),
      "rows are not in ascending runAt order",
    );
    check(
      "projects the fields countFlaps reads",
      flaps.every((r) => r.action !== undefined && r.runAt !== undefined),
      "action/runAt missing from projection",
    );
    const narrow = await flapHistoryFor({
      adAccountId: ACCT,
      entityId: "ent_1",
      sinceDays: 3,
    });
    check(
      "window actually narrows the result",
      narrow.length < flaps.length,
      `3d window returned ${narrow.length}, 28d returned ${flaps.length}`,
    );

    console.log("\nretirementRecorded — idempotency check");
    check(
      "finds a retirement written after the pause",
      (await retirementRecorded({
        adAccountId: ACCT,
        entityId: "ent_2",
        ruleId: RULE_A,
        skipReason: RETIRED,
        since: ago(3),
      })) === true,
      "existing retirement row was not found",
    );
    check(
      "ignores a retirement older than the pause it is scoped to",
      (await retirementRecorded({
        adAccountId: ACCT,
        entityId: "ent_2",
        ruleId: RULE_A,
        skipReason: RETIRED,
        since: new Date(),
      })) === false,
      "a fresh pause must start a fresh trial budget",
    );
    check(
      "does not match a different entity",
      (await retirementRecorded({
        adAccountId: ACCT,
        entityId: "ent_1",
        ruleId: RULE_A,
        skipReason: RETIRED,
        since: ago(30),
      })) === false,
      "matched the wrong entity",
    );

    console.log("\nscaleHistoryFor — 7-day cumulative baseline");
    const hist = await scaleHistoryFor({
      adAccountId: ACCT,
      entityId: "ent_scale",
      sinceDays: 7,
    });
    check(
      "excludes dry-run and out-of-window rows",
      hist.length === 2,
      `got ${hist.length} rows — expected 2`,
    );
    check(
      "OLDEST row is first — this is the ceiling's baseline",
      hist[0] && hist[0].actionPayload.prev_budget === 25000,
      `baseline prev_budget=${hist[0] && hist[0].actionPayload?.prev_budget} — expected 25000`,
    );
    check(
      "actionPayload survives the projection",
      hist.every((r) => r.actionPayload && r.actionPayload.prev_budget),
      "actionPayload missing — the ceiling would read as 'no movement'",
    );
    check(
      "returns nothing for an entity with no history",
      (
        await scaleHistoryFor({
          adAccountId: ACCT,
          entityId: "ent_never_scaled",
          sinceDays: 7,
        })
      ).length === 0,
      "unexpected rows for an unscaled entity",
    );
  } finally {
    const { deletedCount } = await AutopilotActionLog.deleteMany({
      adAccountId: ACCT,
    });
    console.log(`\nCleaned up ${deletedCount} fixture rows.`);
    await mongoose.disconnect();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  - ${f.name}${f.detail ? `: ${f.detail}` : ""}`);
    process.exit(1);
  }
}

main().catch(async (err) => {
  console.error("\nVerification aborted:", err.message);
  try {
    await AutopilotActionLog.deleteMany({ adAccountId: ACCT });
    await mongoose.disconnect();
  } catch {
    /* best effort */
  }
  process.exit(1);
});
