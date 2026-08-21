#!/usr/bin/env node
/**
 * Tests for services/billingReconciliation.js — the job that grants renewed
 * credits without waiting for a login.
 *
 * Focus is the selection logic (which aMember access row describes the cycle
 * the user is in now, and what anchor it implies) plus the guard rails that
 * decide who gets touched: same-plan-only, skip frozen, skip already-current.
 */

const assert = require("node:assert/strict");

const DAY = 24 * 60 * 60 * 1000;

// ── Stubs. The service pulls in Mongo models, the credit controller and a
// logger; none of that should be live in a unit test.
let profiles = [];
let reservationCount = 0;
let refreshCalls = [];
let profileUpdates = [];

const stubs = {
  "../../utils/logger": { info() {}, warn() {}, error() {} },
  "../../Module/user/userProfileModel": {
    find: () => ({ lean: async () => profiles }),
    updateOne: async (filter, update) => {
      profileUpdates.push({ filter, update });
      return { acknowledged: true };
    },
  },
  "../../Module/credit/creditReservationModel": {
    countDocuments: async () => reservationCount,
  },
  "../../controllers/UnifiedCreditController": {
    refreshBillingCycle: async (userId, planId, anchor) => {
      refreshCalls.push({ userId, planId, anchor });
    },
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

process.env.AMEMBER_BASE_API_URL ||= "https://example.invalid/api";
process.env.AMEMBER_API_KEY ||= "test-key";
process.env.topUpPlanID ||= "18";

const svc = require("../../services/billingReconciliation");

// The service reaches aMember through axios; intercept at that seam.
const axios = require("axios");
let accessRows = [];
axios.get = async () => {
  // One short page ends pagination.
  const payload = { _total: accessRows.length };
  accessRows.forEach((r, i) => {
    payload[i] = r;
  });
  return { data: payload };
};

let failures = 0;
async function test(name, fn) {
  try {
    profiles = [];
    accessRows = [];
    reservationCount = 0;
    refreshCalls = [];
    profileUpdates = [];
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures++;
    console.error(`  ✗ ${name}\n    ${err.message}`);
  }
}

const ymd = (d) => new Date(d).toISOString().slice(0, 10);

/** A STARTER subscriber whose local cycle started `staleDaysAgo` days ago. */
function profile(overrides = {}) {
  return {
    user_id: "GPT-2322",
    login: "evolvesa",
    amember_user_id: "2322",
    subscription_plan_id: "20",
    billing_cycle_start: new Date(Date.now() - 28 * DAY),
    plan_snapshot: { credits: 300, durationDays: 30 },
    is_deleted: false,
    ...overrides,
  };
}

function accessRow(overrides = {}) {
  const begin = new Date(Date.now() - 3 * DAY);
  return {
    access_id: 4614,
    user_id: 2322,
    product_id: 20,
    begin_date: ymd(begin),
    expire_date: ymd(new Date(begin.getTime() + 30 * DAY)),
    ...overrides,
  };
}

(async () => {
  console.log("billingReconciliation");

  // ── pickActiveBaseAccess ──────────────────────────────────────────────────
  await test("picks the newest non-expired access row", () => {
    const now = new Date();
    const rows = [
      { product_id: 20, begin_date: "2026-06-19", expire_date: "2026-07-19" },
      { product_id: 20, begin_date: "2026-08-18", expire_date: "2026-09-17" },
      { product_id: 20, begin_date: "2026-07-19", expire_date: "2026-08-18" },
    ];
    const picked = svc.pickActiveBaseAccess(rows, new Date("2026-08-21"));
    assert.equal(picked.begin_date, "2026-08-18");
    assert.ok(now instanceof Date);
  });

  await test("ignores top-up product rows", () => {
    const rows = [
      { product_id: 18, begin_date: "2026-08-20", expire_date: "2027-08-20" },
      { product_id: 20, begin_date: "2026-08-18", expire_date: "2026-09-17" },
    ];
    const picked = svc.pickActiveBaseAccess(rows, new Date("2026-08-21"));
    assert.equal(picked.product_id, 20);
  });

  await test("returns null when every row has expired", () => {
    const rows = [
      { product_id: 20, begin_date: "2026-06-19", expire_date: "2026-07-19" },
    ];
    assert.equal(svc.pickActiveBaseAccess(rows, new Date("2026-08-21")), null);
  });

  await test("access is valid through the end of the expiry day", () => {
    const rows = [
      { product_id: 20, begin_date: "2026-07-19", expire_date: "2026-08-18" },
    ];
    // Late on the expiry day itself — still active.
    assert.ok(
      svc.pickActiveBaseAccess(rows, new Date("2026-08-18T23:00:00Z")),
      "should still be active on the expiry date",
    );
    assert.equal(
      svc.pickActiveBaseAccess(rows, new Date("2026-08-19T01:00:00Z")),
      null,
      "should be expired the following day",
    );
  });

  // ── resolveAnchor ─────────────────────────────────────────────────────────
  await test("anchors to begin_date when present", () => {
    const a = svc.resolveAnchor(
      { begin_date: "2026-08-18", expire_date: "2026-09-17" },
      30,
    );
    assert.equal(a.toISOString(), "2026-08-18T00:00:00.000Z");
  });

  await test("falls back to expire - durationDays without a begin_date", () => {
    const a = svc.resolveAnchor({ expire_date: "2026-09-17" }, 30);
    assert.equal(a.toISOString(), "2026-08-18T00:00:00.000Z");
  });

  await test("returns null when neither is resolvable", () => {
    assert.equal(svc.resolveAnchor({ expire_date: "2026-09-17" }, null), null);
    assert.equal(svc.resolveAnchor({}, 30), null);
  });

  // ── reconcileBillingCycles ────────────────────────────────────────────────
  await test("refills a user whose aMember cycle has moved on", async () => {
    profiles = [profile()];
    accessRows = [accessRow()];

    const { stats } = await svc.reconcileBillingCycles({ dryRun: false });

    assert.equal(stats.refilled, 1);
    assert.equal(refreshCalls.length, 1);
    assert.equal(refreshCalls[0].userId, "GPT-2322");
    assert.equal(refreshCalls[0].planId, "20");
    assert.equal(
      refreshCalls[0].anchor.toISOString().slice(0, 10),
      accessRows[0].begin_date,
      "must pass aMember's cycle start as the anchor",
    );
    // The mirrored expiry is refreshed too, so the profile isn't left stale.
    assert.equal(profileUpdates.length, 1);
    assert.ok(profileUpdates[0].update.$set.subscription_expiry);
  });

  await test("dry run reports the refill but writes nothing", async () => {
    profiles = [profile()];
    accessRows = [accessRow()];

    const { stats, actions } = await svc.reconcileBillingCycles({
      dryRun: true,
    });

    assert.equal(stats.refilled, 1);
    assert.equal(actions[0].applied, false);
    assert.equal(refreshCalls.length, 0, "dry run must not refill");
    assert.equal(profileUpdates.length, 0, "dry run must not write");
  });

  await test("leaves a user whose cycle is already current", async () => {
    const begin = new Date(Date.now() - 3 * DAY);
    profiles = [profile({ billing_cycle_start: begin })];
    accessRows = [accessRow({ begin_date: ymd(begin) })];

    const { stats } = await svc.reconcileBillingCycles({ dryRun: false });
    assert.equal(stats.alreadyCurrent, 1);
    assert.equal(stats.refilled, 0);
    assert.equal(refreshCalls.length, 0);
  });

  // Plan changes carry rollover rules the login path resolves with more
  // context; a nightly sweep guessing here could grant the wrong allocation.
  await test("skips a user whose aMember plan differs from the stored one", async () => {
    profiles = [profile()];
    accessRows = [accessRow({ product_id: 21 })];

    const { stats } = await svc.reconcileBillingCycles({ dryRun: false });
    assert.equal(stats.planMismatch, 1);
    assert.equal(stats.refilled, 0);
    assert.equal(refreshCalls.length, 0);
  });

  await test("skips a lapsed user with no active access", async () => {
    profiles = [profile()];
    accessRows = [
      accessRow({ begin_date: "2026-01-01", expire_date: "2026-01-31" }),
    ];

    const { stats } = await svc.reconcileBillingCycles({ dryRun: false });
    assert.equal(stats.noActiveAccess, 1);
    assert.equal(refreshCalls.length, 0);
  });

  // Zeroing used_* under a live freeze would double-refund on release.
  await test("defers a user with in-flight credit reservations", async () => {
    profiles = [profile()];
    accessRows = [accessRow()];
    reservationCount = 2;

    const { stats } = await svc.reconcileBillingCycles({ dryRun: false });
    assert.equal(stats.skippedFrozen, 1);
    assert.equal(stats.refilled, 0);
    assert.equal(refreshCalls.length, 0);
  });

  await test("one user's failure does not abort the run", async () => {
    profiles = [
      profile({ user_id: "GPT-1", amember_user_id: "1" }),
      profile({ user_id: "GPT-2", amember_user_id: "2" }),
    ];
    accessRows = [accessRow({ user_id: 1 }), accessRow({ user_id: 2 })];

    let first = true;
    stubs["../../controllers/UnifiedCreditController"].refreshBillingCycle =
      async (userId, planId, anchor) => {
        if (first) {
          first = false;
          throw new Error("simulated failure");
        }
        refreshCalls.push({ userId, planId, anchor });
      };

    const { stats } = await svc.reconcileBillingCycles({ dryRun: false });
    assert.equal(stats.errors, 1);
    assert.equal(stats.refilled, 1, "the second user must still be processed");

    // restore
    stubs["../../controllers/UnifiedCreditController"].refreshBillingCycle =
      async (userId, planId, anchor) => {
        refreshCalls.push({ userId, planId, anchor });
      };
  });

  console.log(
    failures === 0
      ? "\nPASS — billingReconciliation"
      : `\nFAIL — ${failures} assertion(s) failed`,
  );
  process.exit(failures === 0 ? 0 : 1);
})();
