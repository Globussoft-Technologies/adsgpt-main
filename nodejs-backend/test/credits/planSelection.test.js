#!/usr/bin/env node
/**
 * Tests for pickBasePlanId in controllers/auth/authController.js.
 *
 * Regression: aMember's check-access returns every ACTIVE subscription, and a
 * user mid-upgrade legitimately holds two. The old selection was
 * `Object.keys(subscriptions).find(id => id !== topUpPlanID)`, and JS orders
 * integer-like keys ascending — so a user who upgraded from the 7-day trial
 * (product 8) to STARTER (product 20) had the TRIAL chosen. They paid $24 and
 * were given the trial's 35 credits, with their billing cycle pinned to the
 * trial's dates. Seen in production on aMember user 4331.
 */

const assert = require("node:assert/strict");

// ── Stub the module graph authController drags in. Only the pure plan-picking
// helper is under test; nothing here should touch Mongo, Redis or aMember.
const stubs = {
  "../../services/authService": { generateToken: () => "" },
  "../../Module/user/userProfileModel": {},
  "../../controllers/newsletter.controller": { scheduleFreePlanDrip: () => {} },
  "../../controllers/UnifiedCreditController": {
    getEnvironment: () => "production",
  },
  "../../config/creditConfig": { development: {}, production: {} },
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

process.env.topUpPlanID = "18";

const { pickBasePlanId } = require("../../controllers/auth/authController");

// Shapes match what enrichUserDataWithProducts builds.
const TRIAL = { productId: "8", title: "FREE - 7 DAYS", credits: 35, durationDays: 7 };
const STARTER = { productId: "20", title: "STARTER", credits: 300, durationDays: 30 };
const PRO = { productId: "21", title: "PRO", credits: 6000, durationDays: 365 };

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures++;
    console.error(`  ✗ ${name}\n    ${err.message}`);
  }
}

console.log("pickBasePlanId");

// The production case. Note the object literal deliberately lists 20 first —
// Object.keys still yields ['8','20'], which is what made the old code wrong.
test("prefers the paid upgrade over a still-active trial", () => {
  const subs = { 20: "2026-09-04", 8: "2026-08-12" };
  assert.equal(Object.keys(subs)[0], "8", "precondition: key order is ascending");
  assert.equal(pickBasePlanId(subs, [TRIAL, STARTER], "production"), "20");
});

test("returns the only base plan when there is just one", () => {
  assert.equal(pickBasePlanId({ 20: "2026-09-17" }, [STARTER], "production"), "20");
});

test("returns empty string when the user has no base plan", () => {
  assert.equal(pickBasePlanId({}, [], "production"), "");
  assert.equal(pickBasePlanId(null, [], "production"), "");
});

// Top-ups are not a base plan — holding one must never grant plan access.
test("ignores the top-up product entirely", () => {
  assert.equal(pickBasePlanId({ 18: "2027-01-01" }, [], "production"), "");
  assert.equal(
    pickBasePlanId({ 18: "2027-01-01", 20: "2026-09-17" }, [STARTER], "production"),
    "20",
  );
});

// During a downgrade the new, smaller plan starts when the current term ends,
// so it has the LATER expiry. Ranking by expiry would hand the user the lower
// allocation while they are still paying for the higher tier.
test("prefers the richer plan over a scheduled downgrade with a later expiry", () => {
  const subs = { 21: "2026-09-30", 20: "2026-10-30" };
  assert.equal(pickBasePlanId(subs, [STARTER, PRO], "production"), "21");
});

test("falls back to expiry when allocations tie", () => {
  const a = { productId: "30", title: "A", credits: 300, durationDays: 30 };
  const b = { productId: "31", title: "B", credits: 300, durationDays: 30 };
  assert.equal(
    pickBasePlanId({ 30: "2026-09-01", 31: "2026-10-01" }, [a, b], "production"),
    "31",
  );
});

// A product whose meta failed to fetch resolves to 0 credits via the config
// fallback; it must not outrank a plan with a known allocation.
test("a plan with unresolvable credits loses to one with known credits", () => {
  const subs = { 20: "2026-09-17", 99: "2026-12-31" };
  assert.equal(pickBasePlanId(subs, [STARTER], "production"), "20");
});

test("is deterministic when credits and expiry both tie", () => {
  const a = { productId: "30", title: "A", credits: 300, durationDays: 30 };
  const b = { productId: "31", title: "B", credits: 300, durationDays: 30 };
  const subs = { 31: "2026-09-01", 30: "2026-09-01" };
  const first = pickBasePlanId(subs, [a, b], "production");
  assert.equal(first, pickBasePlanId(subs, [a, b], "production"));
  assert.equal(first, "30", "lowest product id breaks a total tie");
});

console.log(
  failures === 0
    ? "\nPASS — pickBasePlanId"
    : `\nFAIL — ${failures} assertion(s) failed`,
);
process.exit(failures === 0 ? 0 : 1);
