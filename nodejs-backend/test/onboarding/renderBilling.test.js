#!/usr/bin/env node
/**
 * Tests for who pays for an onboarding render.
 *
 * The rule this file pins down is the one that is easy to get subtly wrong and
 * expensive to get wrong in production: a FREE-PLAN user is SHOWN a free first
 * render and is CHARGED for it anyway, out of the 35 credits we granted them.
 * Every other plan keeps a genuinely free first render.
 *
 * That splits one old boolean into two, and the split is the whole point:
 *
 *   freeClaimed — the one lifetime free render was spent (everyone, all plans).
 *                 Retires the banner; read by `/eligibility`.
 *   free        — the render truly cost nothing (paid plans only).
 *
 * The cases that cost real money are the undo paths, where a render never
 * happens: the claim has to come back AND the hold has to be released, and
 * before the split those were the same branch.
 *
 * No DB and no credit controller — both are stubbed through `require.cache`
 * below, because the logic under test is the branching, not Mongo.
 *
 * Run:  node test/onboarding/renderBilling.test.js
 */

const assert = require("node:assert/strict");

// ── Stubs, installed BEFORE renderBilling is required ───────────────────────
// renderBilling grabs both of these at module load, so they have to be in the
// cache first. `calls` is what each test asserts against.
const calls = { freeze: [], release: [], settle: [], partial: [] };
let creditState = { freezeOk: true, freezeReason: "", rate: 4 };
let profileState = { claimable: true, planId: "", unclaimCount: 0 };

const stub = (relPath, exports) => {
  const full = require.resolve(relPath);
  require.cache[full] = { id: full, filename: full, loaded: true, exports };
};

stub("../../controllers/UnifiedCreditController", {
  getModelDeduction: () => creditState.rate,
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

stub("../../Module/user/userProfileModel", {
  // The atomic claim: succeeds once, then the flag is set and it stops.
  findOneAndUpdate: () => ({
    select: () => ({
      lean: async () => {
        if (!profileState.claimable) return null;
        profileState.claimable = false;
        return { user_id: "u1" };
      },
    }),
  }),
  findOne: () => ({
    lean: async () => ({ subscription_plan_id: profileState.planId }),
  }),
  updateOne: async () => {
    profileState.unclaimCount += 1;
    profileState.claimable = true;
    return { modifiedCount: 1 };
  },
});

stub("../../utils/logger", { info: () => {}, warn: () => {}, error: () => {} });

const billing = require("../../services/onboarding/renderBilling");

const FREE_PLAN_ID = "8";

function reset(opts) {
  const {
    planId = "99",
    claimable = true,
    freezeOk = true,
    freezeReason = "",
  } = opts || {};
  calls.freeze.length = 0;
  calls.release.length = 0;
  calls.settle.length = 0;
  calls.partial.length = 0;
  creditState = { freezeOk, freezeReason, rate: 4 };
  profileState = { claimable, planId, unclaimCount: 0 };
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

const secure = () =>
  billing.securePayment({
    userId: "u1",
    sessionId: "s1",
    boardId: "b1",
    renderId: "r1",
  });

(async () => {
  console.log("renderBilling - free-plan users are shown free and charged\n");

  // ── The ceiling ───────────────────────────────────────────────────────────
  await test("ceiling is 32, not 40 - it has to fit inside a 35-credit grant", () => {
    reset();
    // rate 4 (veo-3.1-fast) x 8s. The old ceiling took the dearest model in the
    // map (veo, 5/s = 40), which no free user could ever afford.
    assert.equal(billing.ceilingAmount(), 32);
  });

  // ── Paid plans keep the genuine freebie ──────────────────────────────────
  await test("paid plan: first render is free and freezes nothing", async () => {
    reset({ planId: "99" });
    const p = await secure();
    assert.equal(p.ok, true);
    assert.equal(p.free, true);
    assert.equal(p.freeClaimed, true);
    assert.equal(p.amount, 0);
    assert.equal(calls.freeze.length, 0, "a free render must not freeze credits");
  });

  // ── Free plan: shown free, charged anyway ────────────────────────────────
  await test("free plan: first render claims the freebie AND freezes 32", async () => {
    reset({ planId: FREE_PLAN_ID });
    const p = await secure();
    assert.equal(p.ok, true);
    assert.equal(p.free, false, "free-plan first render is not billing-free");
    assert.equal(p.freeClaimed, true, "the lifetime claim is still spent");
    assert.equal(p.amount, 32);
    assert.equal(calls.freeze.length, 1);
    assert.equal(calls.freeze[0].amount, 32);
  });

  await test("free plan: the claim is lifetime, not per render", async () => {
    reset({ planId: FREE_PLAN_ID });
    await secure();
    const second = await secure();
    assert.equal(second.freeClaimed, false);
    assert.equal(second.free, false);
  });

  // ── FREE_PLAN_ID missing: fail towards free, never towards charging ──────
  await test("FREE_PLAN_ID unset: nobody is a free user, render stays free", async () => {
    reset({ planId: FREE_PLAN_ID });
    delete process.env.FREE_PLAN_ID;
    const p = await secure();
    assert.equal(p.free, true);
    assert.equal(calls.freeze.length, 0);
  });

  // ── The undo paths - where the split actually earns its keep ────────────
  await test("free plan: a failed freeze hands the claim back", async () => {
    reset({ planId: FREE_PLAN_ID, freezeOk: false, freezeReason: "INSUFFICIENT" });
    const p = await secure();
    assert.equal(p.ok, false);
    assert.equal(p.reason, "INSUFFICIENT");
    assert.equal(
      profileState.unclaimCount,
      1,
      "a freeze that refused must not burn the free render",
    );
  });

  await test("refund on a charged free-plan render returns claim AND releases", async () => {
    reset({ planId: FREE_PLAN_ID });
    await billing.refund({
      free: false,
      freeClaimed: true,
      userId: "u1",
      sessionId: "s1",
      renderId: "r1",
    });
    assert.equal(profileState.unclaimCount, 1, "claim returned");
    assert.deepEqual(calls.release, ["r1"], "hold released");
  });

  await test("refund on a genuinely free render releases no credits", async () => {
    reset({ planId: "99" });
    await billing.refund({
      free: true,
      freeClaimed: true,
      userId: "u1",
      sessionId: "s1",
      renderId: "r1",
    });
    assert.equal(profileState.unclaimCount, 1);
    assert.equal(calls.release.length, 0, "there was never a hold to release");
  });

  // ── settleBoard, reached from the webhook ───────────────────────────────
  await test("settleBoard: charged free-plan render succeeded -> settle", async () => {
    reset({ planId: FREE_PLAN_ID });
    await billing.settleBoard({
      sessionId: "s1",
      userId: "u1",
      boardId: "b1",
      entry: {
        status: "succeeded",
        billing: { free: false, freeClaimed: true, renderId: "r1", amount: 32 },
      },
    });
    assert.deepEqual(calls.settle, ["r1"]);
    assert.equal(profileState.unclaimCount, 0, "a delivered clip keeps the claim spent");
  });

  await test("settleBoard: charged free-plan render failed -> release AND return claim", async () => {
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
    assert.equal(profileState.unclaimCount, 1, "no clip means the freebie is not spent");
  });

  await test("settleBoard: a pre-split board (no freeClaimed) behaves as before", async () => {
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
