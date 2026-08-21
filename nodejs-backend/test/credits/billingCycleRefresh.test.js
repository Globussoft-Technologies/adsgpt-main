#!/usr/bin/env node
/**
 * Regression tests for UnifiedCreditController.refreshBillingCycle.
 *
 * Two bugs are covered here, both from the same root cause — the local billing
 * cycle used to be a free-running clock that never re-anchored to aMember:
 *
 *   1. A paid renewal was invisible. Credits refilled only when our own stored
 *      cycle start was `durationDays` old, so a user who had already paid for
 *      (and started) a new cycle in aMember sat at ~0 credits until our clock
 *      caught up.
 *   2. The refill stamped `now` (the login time) as the new cycle start, so any
 *      lateness became permanent and compounded every cycle.
 */

const assert = require("node:assert/strict");
const path = require("node:path");

const DAY = 24 * 60 * 60 * 1000;

// ── Stub every module UnifiedCreditController pulls in, so this stays a pure
// unit test with no Mongo/Redis/model-catalog dependency.
let updateCalls = [];
let currentUser = null;

const stubs = {
  "../../utils/logger": { info() {}, warn() {}, error() {} },
  "../../config/creditConfig": { development: {}, production: {} },
  "../../Module/user/userProfileModel": {
    async findOne() {
      return currentUser;
    },
    async findOneAndUpdate(filter, update) {
      updateCalls.push(update.$set);
      return { ...currentUser, ...update.$set };
    },
  },
  "../../Module/credit/creditReservationModel": {
    find: () => ({ lean: async () => [] }),
  },
  "../../services/modelConfigurationService": {
    getRuntimeModel: (m) => m,
    getRuntimeCredit: () => 0,
  },
};

for (const [modulePath, exports] of Object.entries(stubs)) {
  const resolved = require.resolve(modulePath);
  require.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports,
  };
}

const UnifiedCreditController = require("../../controllers/UnifiedCreditController");

/** A STARTER-plan user, mid-cycle, nearly out of credits. */
function makeUser(overrides = {}) {
  return {
    user_id: "GPT-TEST",
    subscription_plan_id: "20",
    base_subscription_credits: 300,
    used_subscription_credits: 294,
    rolledover_credits: 18,
    used_rolledover_credits: 18,
    topup_credits_purchased: 0,
    topup_credits_used: 0,
    plan_snapshot: { credits: 300, durationDays: 30 },
    ...overrides,
  };
}

async function run(user, anchor) {
  currentUser = user;
  updateCalls = [];
  await UnifiedCreditController.refreshBillingCycle("GPT-TEST", "20", anchor);
  return updateCalls;
}

let failures = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures++;
    console.error(`  ✗ ${name}\n    ${err.message}`);
  }
}

(async () => {
  console.log("refreshBillingCycle");

  // The production case (aMember user 2322): local cycle start 28.75 days old,
  // but aMember rebilled 3 days ago and started a fresh cycle. Before the fix
  // this returned early — 28.75 < 30 — leaving a paid-up user on 6 credits.
  await test("grants the new allocation when aMember has already renewed", async () => {
    const now = Date.now();
    const anchor = new Date(now - 3 * DAY);
    const sets = await run(
      makeUser({ billing_cycle_start: new Date(now - 28.75 * DAY) }),
      anchor,
    );

    assert.equal(sets.length, 1, "expected exactly one credit reset");
    const s = sets[0];
    assert.equal(s.base_subscription_credits, 300);
    assert.equal(s.used_subscription_credits, 0);
    // Leftover base (300 - 294) carries forward; stale rollover is forfeited.
    assert.equal(s.rolledover_credits, 6);
    assert.equal(s.used_rolledover_credits, 0);
    assert.equal(
      s.billing_cycle_start.getTime(),
      anchor.getTime(),
      "cycle start must be anchored to aMember, not the login time",
    );
    assert.equal(
      s.last_credit_reset_date.getTime(),
      anchor.getTime(),
    );
  });

  await test("does nothing mid-cycle when aMember has not renewed", async () => {
    const now = Date.now();
    const cycleStart = new Date(now - 10 * DAY);
    const sets = await run(
      makeUser({ billing_cycle_start: cycleStart }),
      cycleStart, // anchor unchanged — no rebill since last login
    );
    assert.equal(sets.length, 0, "must not refill an active cycle");
  });

  await test("is idempotent — a second login after renewal does not re-grant", async () => {
    const now = Date.now();
    const anchor = new Date(now - 3 * DAY);
    // State as left by the first (successful) refresh above.
    const sets = await run(
      makeUser({
        billing_cycle_start: anchor,
        base_subscription_credits: 300,
        used_subscription_credits: 0,
        rolledover_credits: 6,
        used_rolledover_credits: 0,
      }),
      anchor,
    );
    assert.equal(sets.length, 0, "must not grant twice for the same cycle");
  });

  // Without an anchor we fall back to elapsed time — but the new start must
  // preserve the cycle's phase instead of jumping to `now`, or lateness
  // compounds forever.
  await test("without an anchor, advances by whole periods rather than to now", async () => {
    const now = Date.now();
    const cycleStart = new Date(now - 31 * DAY);
    const sets = await run(makeUser({ billing_cycle_start: cycleStart }), null);

    assert.equal(sets.length, 1);
    const newStart = sets[0].billing_cycle_start.getTime();
    assert.equal(
      newStart,
      cycleStart.getTime() + 30 * DAY,
      "expected cycleStart + one period",
    );
    assert.ok(
      now - newStart > 0.5 * DAY,
      "new start must not be the login time (that is the drift bug)",
    );
  });

  await test("ignores an anchor that is behind the stored cycle start", async () => {
    const now = Date.now();
    const cycleStart = new Date(now - 10 * DAY);
    const sets = await run(
      makeUser({ billing_cycle_start: cycleStart }),
      new Date(cycleStart.getTime() - 5 * DAY),
    );
    assert.equal(sets.length, 0, "a stale anchor must not trigger a refill");
  });

  await test("ignores an unparseable anchor", async () => {
    const now = Date.now();
    const sets = await run(
      makeUser({ billing_cycle_start: new Date(now - 10 * DAY) }),
      new Date("not-a-date"),
    );
    assert.equal(sets.length, 0);
  });

  console.log(
    failures === 0
      ? "\nPASS — refreshBillingCycle"
      : `\nFAIL — ${failures} assertion(s) failed`,
  );
  process.exit(failures === 0 ? 0 : 1);
})();
