#!/usr/bin/env node
/**
 * Unit tests for the reserve-then-settle credit contract.
 *
 * The controller only needs Mongoose-shaped seams here, so an in-memory stub
 * keeps the tests deterministic and avoids requiring a Mongo connection.
 */

const assert = require("node:assert/strict");

let user;
const reservations = new Map();

const logger = { info() {}, warn() {}, error() {} };

function applyInc(update) {
  for (const [field, amount] of Object.entries(update.$inc || {})) {
    user[field] = (user[field] || 0) + amount;
  }
}

const UserProfile = {
  findOne: async () => user,
  findOneAndUpdate: async (_filter, update) => {
    applyInc(update);
    return user;
  },
  updateOne: async (_filter, update) => {
    applyInc(update);
    return { acknowledged: true };
  },
};

const CreditReservation = {
  findOne: async ({ reservation_key: key }) => reservations.get(key) || null,
  create: async (row) => {
    if (reservations.has(row.reservation_key)) {
      const error = new Error("duplicate reservation key");
      error.code = 11000;
      throw error;
    }
    reservations.set(row.reservation_key, row);
    return row;
  },
  findOneAndDelete: async ({ reservation_key: key }) => {
    const row = reservations.get(key) || null;
    if (row) reservations.delete(key);
    return row;
  },
};

const modelConfigurationService = {
  getRuntimeModel: () => null,
  getRuntimeCredit: () => 0,
  getRuntimeExtra: () => null,
  getCachedModelsForSurface: () => [],
};

const stubs = {
  "../../utils/logger": logger,
  "../../Module/user/userProfileModel": UserProfile,
  "../../Module/credit/creditReservationModel": CreditReservation,
  "../../services/modelConfigurationService": modelConfigurationService,
};

for (const [modulePath, exports] of Object.entries(stubs)) {
  const resolved = require.resolve(modulePath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

const UnifiedCreditController = require("../../controllers/UnifiedCreditController");

function reset() {
  reservations.clear();
  user = {
    subscription_plan_id: "20",
    rolledover_credits: 10,
    used_rolledover_credits: 0,
    base_subscription_credits: 50,
    used_subscription_credits: 0,
    topup_credits_purchased: 100,
    topup_credits_used: 0,
  };
}

let passed = 0;
let failed = 0;

async function test(name, fn) {
  reset();
  try {
    await fn();
    passed += 1;
    console.log(`  PASS ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  FAIL ${name}\n    ${error.message}`);
  }
}

(async () => {
  console.log("unifiedCreditReservation");

  await test("freezes one reservation using the configured pool order", async () => {
    const result = await UnifiedCreditController.freezeCredits({
      userId: "user-1",
      reservationKey: "campaign:1",
      amount: 70,
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.split, { fromRollover: 10, fromSub: 50, fromTopup: 10 });
    assert.equal(user.used_rolledover_credits, 10);
    assert.equal(user.used_subscription_credits, 50);
    assert.equal(user.topup_credits_used, 10);
    assert.equal(reservations.size, 1);
  });

  await test("retries with the same key without double-charging", async () => {
    const request = { userId: "user-1", reservationKey: "campaign:1", amount: 20 };
    await UnifiedCreditController.freezeCredits(request);
    const retry = await UnifiedCreditController.freezeCredits(request);

    assert.equal(retry.idempotent, true);
    assert.equal(user.used_rolledover_credits, 10);
    assert.equal(user.used_subscription_credits, 10);
    assert.equal(user.topup_credits_used, 0);
  });

  await test("partial settlement keeps actual usage and refunds the unused hold", async () => {
    await UnifiedCreditController.freezeCredits({
      userId: "user-1",
      reservationKey: "campaign:1",
      amount: 70,
    });

    const result = await UnifiedCreditController.releasePartial("campaign:1", 50);

    assert.deepEqual(result, {
      ok: true,
      refunded: 20,
      charged: 50,
      refundSplit: { fromTopup: 10, fromSub: 10, fromRollover: 0 },
    });
    assert.equal(user.used_rolledover_credits, 10);
    assert.equal(user.used_subscription_credits, 40);
    assert.equal(user.topup_credits_used, 0);
    assert.equal(reservations.size, 0);
  });

  await test("full failure releases the entire hold", async () => {
    await UnifiedCreditController.freezeCredits({
      userId: "user-1",
      reservationKey: "campaign:1",
      amount: 70,
    });

    const result = await UnifiedCreditController.releaseCredits("campaign:1");

    assert.equal(result.ok, true);
    assert.equal(result.refunded, 70);
    assert.equal(user.used_rolledover_credits, 0);
    assert.equal(user.used_subscription_credits, 0);
    assert.equal(user.topup_credits_used, 0);
    assert.equal(reservations.size, 0);
  });

  await test("successful settlement retains the frozen debit", async () => {
    await UnifiedCreditController.freezeCredits({
      userId: "user-1",
      reservationKey: "campaign:1",
      amount: 20,
    });

    const result = await UnifiedCreditController.settleCredits("campaign:1");

    assert.equal(result.ok, true);
    assert.equal(user.used_rolledover_credits, 10);
    assert.equal(user.used_subscription_credits, 10);
    assert.equal(reservations.size, 0);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
