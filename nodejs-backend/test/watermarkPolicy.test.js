#!/usr/bin/env node
/**
 * Tests for `shouldWatermark` — which renders carry the AdsGPT logo.
 *
 * The rule itself is one line (free plan yes, paid plan no). What is worth
 * testing is every way the inputs can be MISSING, because this policy
 * deliberately fails in the opposite direction to the billing helper it sits
 * beside: an unset `FREE_PLAN_ID`, an unreadable profile or a profile with no
 * plan all have to come back marked. Get that backwards and the entire free
 * tier silently ships unbranded media, which is the one failure nobody reports.
 *
 * No DB: UserProfile and the logger are stubbed in the require cache.
 *
 * Run:  node test/watermarkPolicy.test.js
 */

const assert = require("node:assert/strict");

const stub = (relPath, exports) => {
  const full = require.resolve(relPath);
  require.cache[full] = { id: full, filename: full, loaded: true, exports };
};

// What the next profile lookup answers. `throws` makes the lookup fail.
let profileState = { planId: "99", missing: false, throws: false };

stub("../Module/user/userProfileModel", {
  findOne: () => ({
    lean: async () => {
      if (profileState.throws) throw new Error("mongo is having a day");
      if (profileState.missing) return null;
      return { subscription_plan_id: profileState.planId };
    },
  }),
});

const warnings = [];
stub("../utils/logger", {
  info: () => {},
  warn: (msg) => warnings.push(msg),
  error: () => {},
});

const { shouldWatermark } = require("../utils/watermarkPolicy");

const FREE_PLAN_ID = "8";
const PAID_PLAN_ID = "99";

function reset(opts = {}) {
  const { planId = PAID_PLAN_ID, missing = false, throws = false } = opts;
  profileState = { planId, missing, throws };
  warnings.length = 0;
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

(async () => {
  console.log("shouldWatermark");

  // ── The rule ────────────────────────────────────────────────────────────
  await test("free plan is watermarked", async () => {
    reset({ planId: FREE_PLAN_ID });
    assert.equal(await shouldWatermark("u1"), true);
  });

  await test("paid plan is not watermarked", async () => {
    reset({ planId: PAID_PLAN_ID });
    assert.equal(await shouldWatermark("u1"), false);
  });

  await test("plan id is compared as a string, so a numeric id still matches", async () => {
    reset({ planId: 8 });
    assert.equal(await shouldWatermark("u1"), true);
  });

  // ── Every missing input marks the output ────────────────────────────────
  await test("FREE_PLAN_ID unset: everyone is watermarked, paid plans included", async () => {
    reset({ planId: PAID_PLAN_ID });
    delete process.env.FREE_PLAN_ID;
    assert.equal(await shouldWatermark("u1"), true);
    assert.ok(
      warnings.some((w) => String(w).includes("FREE_PLAN_ID is not set")),
      "an unset FREE_PLAN_ID must warn — it is marking paying customers",
    );
  });

  await test("FREE_PLAN_ID set to blank counts as unset", async () => {
    reset({ planId: PAID_PLAN_ID });
    process.env.FREE_PLAN_ID = "   ";
    assert.equal(await shouldWatermark("u1"), true);
  });

  await test("no profile at all is watermarked", async () => {
    reset({ missing: true });
    assert.equal(await shouldWatermark("u1"), true);
  });

  await test("a profile carrying no plan is watermarked", async () => {
    reset({ planId: "" });
    assert.equal(await shouldWatermark("u1"), true);
  });

  await test("a failed lookup is watermarked and never throws", async () => {
    reset({ throws: true });
    assert.equal(await shouldWatermark("u1"), true);
    assert.ok(
      warnings.some((w) => String(w).includes("plan lookup failed")),
      "a swallowed DB error must still be logged",
    );
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
})();
