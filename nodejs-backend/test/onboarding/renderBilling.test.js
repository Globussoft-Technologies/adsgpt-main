#!/usr/bin/env node
/**
 * Tests for who pays for an onboarding render.
 *
 * The rule this file pins down, as of 2026-09-23
 * (`docs/ai/modules/onboarding/ONBOARDING_ALLOWANCE.md`):
 *
 *   PAID plans hold an ALLOWANCE — 35 credits' worth of generation that only
 *   onboarding can spend. Not credits: nothing enters the wallet, and none of
 *   it is spendable anywhere else in the product.
 *
 *   FREE plans hold no allowance at all. They already have 35 real credits from
 *   their signup grant and spend those normally, here and everywhere else.
 *   Granting them an allowance on top would hand out the same 35 twice.
 *
 * Two things here are expensive to get subtly wrong, so both are pinned:
 *
 *   THE SPLIT (ONB-010). When the remaining allowance cannot cover the whole
 *   ceiling it pays what it can and the wallet funds the rest — and the wallet
 *   is never charged more than the figure the user was quoted. The rule this
 *   replaces was all-or-nothing, which protected the user from being told
 *   "free" and then charged a remainder; that job now belongs to the quote.
 *
 *   THE UNDO PATHS. A render that never happened has to give back exactly what
 *   it took — the allowance, or the hold, never both and never the wrong one.
 *
 * The legacy cases are kept deliberately: boards written under the old
 * free-render claim (ONB-001/006) are still in the database and their webhooks
 * still arrive, so `settleBoard` has to keep settling them the way they were
 * made.
 *
 * No DB and no credit controller — both are stubbed through `require.cache`,
 * because what is under test is the branching, not Mongo.
 *
 * Run:  node test/onboarding/renderBilling.test.js
 */

const assert = require("node:assert/strict");

// ── Stubs, installed BEFORE renderBilling is required ───────────────────────
const calls = { freeze: [], release: [], settle: [], partial: [] };
let creditState = { freezeOk: true, freezeReason: "", rate: 4 };
let profileState = {
  planId: "",
  // The allowance, as the profile holds it. `total: undefined` is how an
  // account that predates the field looks — and that absence is the migration.
  allowanceTotal: 35,
  allowanceUsed: 0,
  // Legacy free-render claim, still exercised by the settleBoard cases.
  claimable: true,
  unclaimCount: 0,
};

const stub = (relPath, exports) => {
  const full = require.resolve(relPath);
  require.cache[full] = { id: full, filename: full, loaded: true, exports };
};

stub("../../controllers/UnifiedCreditController", {
  getModelDeduction: () => creditState.rate,
  getModelDeductionByQuality: () => 1,
  freezeCredits: async (args) => {
    calls.freeze.push(args);
    return creditState.freezeOk
      ? { ok: true }
      : { ok: false, reason: creditState.freezeReason };
  },
  releaseCredits: async (key) => calls.release.push(key),
  settleCredits: async (key) => calls.settle.push(key),
  releasePartial: async (key, amount) => calls.partial.push({ key, amount }),
});

const remaining = () =>
  Math.max((Number(profileState.allowanceTotal) || 0) - (profileState.allowanceUsed || 0), 0);

stub("../../Module/user/userProfileModel", {
  // Serves two callers with different chains:
  //   · spendAllowance   → findOneAndUpdate(...).lean()
  //   · claimFreeRender  → findOneAndUpdate(...).select().lean()
  findOneAndUpdate: (_query, update) => {
    const inc = update?.$inc?.onboarding_allowance_used;

    const allowanceSpend = async () => {
      // The real query guards with $expr; this is the same rule in JS.
      if (remaining() < inc) return null;
      profileState.allowanceUsed += inc;
      return {
        onboarding_allowance_total: profileState.allowanceTotal,
        onboarding_allowance_used: profileState.allowanceUsed,
      };
    };

    const claim = async () => {
      if (!profileState.claimable) return null;
      profileState.claimable = false;
      return { user_id: "u1" };
    };

    return {
      lean: inc ? allowanceSpend : claim,
      select: () => ({ lean: claim }),
    };
  },
  findOne: () => ({
    lean: async () => ({
      subscription_plan_id: profileState.planId,
      onboarding_allowance_total: profileState.allowanceTotal,
      onboarding_allowance_used: profileState.allowanceUsed,
    }),
  }),
  updateOne: async (_query, update) => {
    const back = update?.$inc?.onboarding_allowance_used;
    if (back < 0) {
      profileState.allowanceUsed = Math.max(profileState.allowanceUsed + back, 0);
      return { modifiedCount: 1 };
    }
    profileState.unclaimCount += 1;
    profileState.claimable = true;
    return { modifiedCount: 1 };
  },
});

stub("../../utils/logger", { info: () => {}, warn: () => {}, error: () => {} });

const billing = require("../../services/onboarding/renderBilling");

const FREE_PLAN_ID = "8";
const PAID_PLAN_ID = "99";

function reset(opts) {
  const {
    planId = PAID_PLAN_ID,
    allowanceTotal = 35,
    allowanceUsed = 0,
    freezeOk = true,
    freezeReason = "",
  } = opts || {};
  calls.freeze.length = 0;
  calls.release.length = 0;
  calls.settle.length = 0;
  calls.partial.length = 0;
  creditState = { freezeOk, freezeReason, rate: 4 };
  profileState = { planId, allowanceTotal, allowanceUsed, claimable: true, unclaimCount: 0 };
  process.env.FREE_PLAN_ID = FREE_PLAN_ID;
}

let passed = 0;
let failed = 0;
const test = async (name, fn) => {
  try {
    await fn();
    passed += 1;
    console.log("  PASS " + name);
  } catch (err) {
    failed += 1;
    console.error("  FAIL " + name + "\n    " + err.message);
  }
};

const secure = (extra = {}) =>
  billing.securePayment({
    userId: "u1",
    sessionId: "s1",
    boardId: "b1",
    renderId: "r1",
    ...extra,
  });

(async () => {
  console.log("renderBilling - the onboarding allowance\n");

  // ── The ceiling ───────────────────────────────────────────────────────────
  await test("ceiling is 32 - rate 4 (veo-3.1-fast) x 8s", () => {
    reset();
    assert.equal(billing.ceilingAmount(), 32);
  });

  // ── Paid plans: the allowance pays ───────────────────────────────────────
  await test("paid plan: the allowance covers the render and freezes nothing", async () => {
    reset({ planId: PAID_PLAN_ID });
    const p = await secure();
    assert.equal(p.ok, true);
    assert.equal(p.free, true, "nothing left the user's wallet");
    assert.equal(p.allowanceSpent, 32);
    assert.equal(p.amount, 0);
    assert.equal(calls.freeze.length, 0, "an allowance-covered render must not freeze");
    assert.equal(remaining(), 3, "35 - 32");
  });

  // ── The split (ONB-010) ──────────────────────────────────────────────────
  await test("SPLIT: 3 left, 32 render -> budget pays 3, wallet freezes 29", async () => {
    reset({ planId: PAID_PLAN_ID, allowanceUsed: 32 });
    const p = await secure();
    assert.equal(p.ok, true);
    assert.equal(p.free, false, "a wallet hold exists, so this is not free");
    assert.equal(p.allowanceSpent, 3, "the leftover is used, not stranded");
    assert.equal(p.amount, 29, "the wallet funds only the remainder");
    assert.equal(calls.freeze[0].amount, 29, "the FREEZE is the remainder, not the ceiling");
    assert.equal(remaining(), 0, "the budget is spent out");
  });

  await test("SPLIT: the quote holds — a wallet share within the quote is charged", async () => {
    reset({ planId: PAID_PLAN_ID, allowanceUsed: 32 });
    const p = await secure({ maxWalletCredits: 29 });
    assert.equal(p.ok, true);
    assert.equal(p.amount, 29);
  });

  await test("SPLIT: a STALE quote is refused and takes nothing", async () => {
    reset({ planId: PAID_PLAN_ID, allowanceUsed: 32 });
    // The user was quoted 7 from their wallet; by now only 3 budget is left, so
    // the real share is 29. Charging that silently is the failure being pinned.
    const p = await secure({ maxWalletCredits: 7 });
    assert.equal(p.ok, false);
    assert.equal(p.reason, "price_changed");
    assert.equal(p.walletAmount, 29, "the caller is told the real number");
    assert.equal(calls.freeze.length, 0, "nothing may be frozen");
    assert.equal(remaining(), 3, "and the budget must be handed straight back");
  });

  await test("SPLIT: a failed freeze returns the budget it had already drawn", async () => {
    reset({ planId: PAID_PLAN_ID, allowanceUsed: 32 });
    creditState.freezeOk = false;
    creditState.freezeReason = "INSUFFICIENT";
    const p = await secure();
    assert.equal(p.ok, false);
    assert.equal(p.reason, "INSUFFICIENT");
    assert.equal(remaining(), 3, "a user who cannot pay must not lose their budget too");
  });

  await test("SPLIT: a failed render gives BOTH purses back", async () => {
    reset({ planId: PAID_PLAN_ID, allowanceUsed: 32 });
    const p = await secure();
    await billing.settleBoard({
      sessionId: "s1",
      userId: "u1",
      boardId: "b1",
      entry: {
        status: "failed",
        billing: { free: false, renderId: "r1", amount: p.amount, allowanceSpent: p.allowanceSpent },
      },
    });
    assert.equal(remaining(), 3, "the budget half came back");
    assert.equal(calls.release.length, 1, "and so did the wallet half");
  });

  await test("SPLIT true-up: the refund comes off the WALLET first", async () => {
    reset({ planId: PAID_PLAN_ID, allowanceUsed: 32 });
    // Held 3 budget + 29 wallet = 32. DS reports a 28-credit render, so 4 goes
    // back — all of it from the wallet, none from the budget.
    const charged = await billing.trueUp({
      free: false,
      renderId: "r1",
      frozenAmount: 29,
      allowanceSpent: 3,
      meta: { model: "veo-3.1-fast", duration_s: 7 },
    });
    assert.equal(charged, 25, "29 - 4");
    assert.equal(calls.partial[0].amount, 25);
  });

  await test("SPLIT true-up: an actual equal to the TOTAL is not an overrun", async () => {
    reset({ planId: PAID_PLAN_ID });
    // The bug this pins: comparing DS's 32 against the wallet's 29 alone would
    // read as "actual EXCEEDS ceiling" on every split render ever made.
    const charged = await billing.trueUp({
      free: false,
      renderId: "r1",
      frozenAmount: 29,
      allowanceSpent: 3,
      meta: { model: "veo-3.1-fast", duration_s: 8 },
    });
    assert.equal(charged, 29, "nothing is released");
    assert.equal(calls.partial.length, 0);
  });

  await test("the allowance is a budget, not one render: 35 buys 32 then stops", async () => {
    reset({ planId: PAID_PLAN_ID });
    const first = await secure();
    const second = await secure();
    assert.equal(first.free, true);
    assert.equal(second.free, false, "the second render is charged");
    assert.equal(calls.freeze.length, 1);
  });

  // ── Free plans hold no allowance ─────────────────────────────────────────
  await test("free plan: no allowance at all — they already hold 35 real credits", async () => {
    reset({ planId: FREE_PLAN_ID });
    const p = await secure();
    assert.equal(p.free, false);
    assert.equal(p.allowanceSpent, 0);
    assert.equal(calls.freeze.length, 1);
    assert.equal(remaining(), 35, "nothing was taken from a budget they do not hold");
  });

  // ── The gate: absence of the field is the migration ──────────────────────
  await test("an account predating the field (no total) gets no allowance", async () => {
    // `null`, not `undefined` — `reset`'s own destructuring default would swap
    // `undefined` back to 35 and the test would silently assert nothing. The
    // code reads both through `Number(x) || 0`, so they are the same 0 to it.
    reset({ planId: PAID_PLAN_ID, allowanceTotal: null });
    const p = await secure();
    assert.equal(p.free, false, "an existing account was never promised this");
    assert.equal(calls.freeze.length, 1);
  });

  // ── FREE_PLAN_ID unset: fail towards charging, never towards giving away ─
  await test("FREE_PLAN_ID unset: nobody gets an allowance", async () => {
    reset({ planId: PAID_PLAN_ID });
    delete process.env.FREE_PLAN_ID;
    const p = await secure();
    // The opposite of the old free-render rule, deliberately: there the safe
    // direction was to give a render away; here that would hand every free-plan
    // user 35 on top of the 35 they already have.
    assert.equal(p.free, false);
    assert.equal(calls.freeze.length, 1);
    assert.equal(remaining(), 35);
  });

  // ── Reading it back ──────────────────────────────────────────────────────
  await test("allowanceRemaining reports what is left; 0 for a free plan", async () => {
    reset({ planId: PAID_PLAN_ID, allowanceUsed: 10 });
    assert.equal(await billing.allowanceRemaining("u1"), 25);
    reset({ planId: FREE_PLAN_ID });
    assert.equal(await billing.allowanceRemaining("u1"), 0);
  });

  // ── The undo paths ───────────────────────────────────────────────────────
  await test("refund of an allowance render gives the budget back, releases nothing", async () => {
    reset({ planId: PAID_PLAN_ID, allowanceUsed: 32 });
    await billing.refund({
      free: true,
      allowanceSpent: 32,
      userId: "u1",
      sessionId: "s1",
      renderId: "r1",
    });
    assert.equal(remaining(), 35, "the budget is whole again");
    assert.equal(calls.release.length, 0, "there was never a hold to release");
  });

  await test("refund of a charged render releases the hold and touches no budget", async () => {
    reset({ planId: PAID_PLAN_ID, allowanceUsed: 32 });
    await billing.refund({
      free: false,
      allowanceSpent: 0,
      userId: "u1",
      sessionId: "s1",
      renderId: "r1",
    });
    assert.deepEqual(calls.release, ["r1"]);
    assert.equal(remaining(), 3, "unchanged");
  });

  await test("returnAllowance cannot mint budget by being called twice", async () => {
    reset({ planId: PAID_PLAN_ID, allowanceUsed: 32 });
    await billing.returnAllowance("u1", 32);
    await billing.returnAllowance("u1", 32);
    assert.equal(remaining(), 35, "floored, never above the total");
  });

  // ── settleBoard, reached from the webhook ───────────────────────────────
  await test("settleBoard: an allowance render that succeeded keeps the spend", async () => {
    reset({ planId: PAID_PLAN_ID, allowanceUsed: 32 });
    await billing.settleBoard({
      sessionId: "s1",
      userId: "u1",
      boardId: "b1",
      entry: { status: "succeeded", billing: { free: true, allowanceSpent: 32 } },
    });
    assert.equal(remaining(), 3, "a delivered clip is paid for");
    assert.equal(calls.settle.length, 0, "nothing was held, so nothing settles");
  });

  await test("settleBoard: an allowance render that FAILED gives the budget back", async () => {
    reset({ planId: PAID_PLAN_ID, allowanceUsed: 32 });
    await billing.settleBoard({
      sessionId: "s1",
      userId: "u1",
      boardId: "b1",
      entry: { status: "failed", billing: { free: true, allowanceSpent: 32 } },
    });
    assert.equal(remaining(), 35);
  });

  await test("settleBoard: a charged render succeeded -> settle the hold", async () => {
    reset({ planId: PAID_PLAN_ID });
    await billing.settleBoard({
      sessionId: "s1",
      userId: "u1",
      boardId: "b1",
      entry: {
        status: "succeeded",
        billing: { free: false, renderId: "r1", amount: 32 },
      },
    });
    assert.deepEqual(calls.settle, ["r1"]);
  });

  await test("settleBoard: a charged render failed -> release the hold", async () => {
    reset({ planId: PAID_PLAN_ID });
    await billing.settleBoard({
      sessionId: "s1",
      userId: "u1",
      boardId: "b1",
      entry: { status: "failed", billing: { free: false, renderId: "r1", amount: 32 } },
    });
    assert.deepEqual(calls.release, ["r1"]);
  });

  // ── Legacy rows, still in the database ──────────────────────────────────
  await test("LEGACY: an old free-render board (no allowanceSpent) un-claims on failure", async () => {
    reset({ planId: PAID_PLAN_ID });
    await billing.settleBoard({
      sessionId: "s1",
      userId: "u1",
      boardId: "b1",
      // Written under ONB-001: genuinely free, no allowance involved.
      entry: { status: "failed", billing: { free: true } },
    });
    assert.equal(profileState.unclaimCount, 1, "the lifetime claim comes back");
  });

  await test("LEGACY: an ONB-006 board (freeClaimed + hold) releases AND un-claims", async () => {
    reset({ planId: FREE_PLAN_ID });
    await billing.settleBoard({
      sessionId: "s1",
      userId: "u1",
      boardId: "b1",
      entry: {
        status: "failed",
        billing: { free: false, freeClaimed: true, renderId: "r1", amount: 32 },
      },
    });
    assert.deepEqual(calls.release, ["r1"]);
    assert.equal(profileState.unclaimCount, 1);
  });

  await test("LEGACY: a pre-split board (no freeClaimed) must not un-claim", async () => {
    reset({ planId: FREE_PLAN_ID });
    await billing.settleBoard({
      sessionId: "s1",
      userId: "u1",
      boardId: "b1",
      entry: { status: "failed", billing: { free: false, renderId: "r1", amount: 40 } },
    });
    assert.deepEqual(calls.release, ["r1"]);
    assert.equal(profileState.unclaimCount, 0, "undefined freeClaimed must not un-claim");
  });

  console.log("\n" + passed + " passed, " + failed + " failed");
  process.exit(failed ? 1 : 0);
})();
