#!/usr/bin/env node
/**
 * Tests for services/autopilot/userRuleEvaluator.js — the pure boolean
 * engine that powers the v4 cron's per-entity rule matching.
 *
 * No DB, no SDK, no stubs. Every test is a fixture in / boolean out.
 *
 * Run:  node test/autopilot/userRuleEvaluator.test.js
 */

const assert = require("node:assert/strict");

const {
  evaluateRule,
  evaluateRuleAgainstMany,
  _internals,
} = require("../../services/autopilot/userRuleEvaluator");
const { evaluateCondition } = _internals;

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
  return fn();
}

const ruleWith = (rules, operator = "AND") => ({
  conditions: { operator, rules },
});

// ─── evaluateCondition — numeric ops ────────────────────────────────────────
group("evaluateCondition — numeric ops", () => {
  test(">  matches when LHS strictly greater", () => {
    assert.equal(
      evaluateCondition({ field: "spend", op: ">", value: 100 }, { spend: 200 }),
      true,
    );
    assert.equal(
      evaluateCondition({ field: "spend", op: ">", value: 200 }, { spend: 200 }),
      false,
    );
  });
  test("<  matches when LHS strictly less", () => {
    assert.equal(
      evaluateCondition({ field: "ctr", op: "<", value: 1 }, { ctr: 0.5 }),
      true,
    );
    assert.equal(
      evaluateCondition({ field: "ctr", op: "<", value: 0.5 }, { ctr: 0.5 }),
      false,
    );
  });
  test(">= and <= are inclusive", () => {
    assert.equal(
      evaluateCondition({ field: "spend", op: ">=", value: 100 }, { spend: 100 }),
      true,
    );
    assert.equal(
      evaluateCondition({ field: "spend", op: "<=", value: 100 }, { spend: 100 }),
      true,
    );
  });
  test("==  numeric equality", () => {
    assert.equal(
      evaluateCondition({ field: "purchases", op: "==", value: 0 }, { purchases: 0 }),
      true,
    );
    assert.equal(
      evaluateCondition({ field: "purchases", op: "==", value: 0 }, { purchases: 1 }),
      false,
    );
  });
  test("!=  numeric inequality", () => {
    assert.equal(
      evaluateCondition({ field: "purchases", op: "!=", value: 0 }, { purchases: 1 }),
      true,
    );
    assert.equal(
      evaluateCondition({ field: "purchases", op: "!=", value: 0 }, { purchases: 0 }),
      false,
    );
  });
});

// ─── evaluateCondition — string ops ─────────────────────────────────────────
group("evaluateCondition — string ops", () => {
  test("==  string equality", () => {
    assert.equal(
      evaluateCondition({ field: "status", op: "==", value: "ACTIVE" }, { status: "ACTIVE" }),
      true,
    );
    assert.equal(
      evaluateCondition({ field: "status", op: "==", value: "ACTIVE" }, { status: "PAUSED" }),
      false,
    );
  });
  test("!=  string inequality", () => {
    assert.equal(
      evaluateCondition({ field: "status", op: "!=", value: "PAUSED" }, { status: "ACTIVE" }),
      true,
    );
  });
  test(">  on string fields fails (no comparable order)", () => {
    assert.equal(
      evaluateCondition({ field: "status", op: ">", value: "ACTIVE" }, { status: "PAUSED" }),
      false,
    );
  });
});

// ─── evaluateCondition — defensive ──────────────────────────────────────────
group("evaluateCondition — defensive (never throws)", () => {
  test("missing field on entity → false", () => {
    assert.equal(
      evaluateCondition({ field: "spend", op: ">", value: 1 }, {}),
      false,
    );
  });
  test("null entity → false", () => {
    assert.equal(
      evaluateCondition({ field: "spend", op: ">", value: 1 }, null),
      false,
    );
  });
  test("null condition → false", () => {
    assert.equal(evaluateCondition(null, { spend: 100 }), false);
  });
  test("type mismatch (string LHS, number value) → false", () => {
    assert.equal(
      evaluateCondition({ field: "status", op: "==", value: 1 }, { status: "ACTIVE" }),
      false,
    );
  });
  test("type mismatch (number LHS, string value) → false", () => {
    assert.equal(
      evaluateCondition({ field: "spend", op: ">", value: "high" }, { spend: 100 }),
      false,
    );
  });
  test("unknown op → false (never throws)", () => {
    assert.equal(
      evaluateCondition({ field: "spend", op: "BETWEEN", value: 10 }, { spend: 100 }),
      false,
    );
  });
  test("boolean LHS → false (not in the user-rule surface)", () => {
    assert.equal(
      evaluateCondition({ field: "is_top", op: "==", value: true }, { is_top: true }),
      false,
    );
  });
});

// ─── evaluateRule — AND semantics ───────────────────────────────────────────
group("evaluateRule — AND semantics", () => {
  test("all conditions match → true", () => {
    const rule = ruleWith([
      { field: "status", op: "==", value: "ACTIVE" },
      { field: "spend", op: ">", value: 50000 },
      { field: "purchases", op: "==", value: 0 },
    ]);
    const entity = { status: "ACTIVE", spend: 60000, purchases: 0 };
    assert.equal(evaluateRule(rule, entity), true);
  });
  test("one condition fails → false", () => {
    const rule = ruleWith([
      { field: "status", op: "==", value: "ACTIVE" },
      { field: "spend", op: ">", value: 50000 },
    ]);
    const entity = { status: "PAUSED", spend: 60000 };
    assert.equal(evaluateRule(rule, entity), false);
  });
  test("missing field on entity fails the whole rule (AND)", () => {
    const rule = ruleWith([
      { field: "status", op: "==", value: "ACTIVE" },
      { field: "prev_cpa", op: ">", value: 0 },
    ]);
    const entity = { status: "ACTIVE" }; // no prev_cpa
    assert.equal(evaluateRule(rule, entity), false);
  });
});

// ─── evaluateRule — defensive ───────────────────────────────────────────────
group("evaluateRule — defensive", () => {
  test("null rule → false", () => {
    assert.equal(evaluateRule(null, { spend: 100 }), false);
  });
  test("null entity → false", () => {
    assert.equal(evaluateRule(ruleWith([{ field: "spend", op: ">", value: 1 }]), null), false);
  });
  test("empty conditions.rules → false", () => {
    assert.equal(evaluateRule(ruleWith([]), { spend: 100 }), false);
  });
  test("missing conditions block → false", () => {
    assert.equal(evaluateRule({}, { spend: 100 }), false);
  });
  test("unsupported operator (e.g., OR) fails closed", () => {
    const rule = ruleWith(
      [{ field: "spend", op: ">", value: 1 }],
      "OR",
    );
    assert.equal(
      evaluateRule(rule, { spend: 100 }),
      false,
      "evaluator must reject any combinator other than AND",
    );
  });
});

// ─── evaluateRuleAgainstMany ────────────────────────────────────────────────
group("evaluateRuleAgainstMany", () => {
  test("filters to matching entities", () => {
    const rule = ruleWith([
      { field: "status", op: "==", value: "ACTIVE" },
      { field: "spend", op: ">", value: 100 },
    ]);
    const entities = [
      { id: 1, status: "ACTIVE", spend: 200 },
      { id: 2, status: "PAUSED", spend: 200 },
      { id: 3, status: "ACTIVE", spend: 50 },
      { id: 4, status: "ACTIVE", spend: 500 },
    ];
    const out = evaluateRuleAgainstMany(rule, entities);
    assert.deepEqual(
      out.map((e) => e.id),
      [1, 4],
    );
  });
  test("non-array → []", () => {
    assert.deepEqual(evaluateRuleAgainstMany({}, "not-an-array"), []);
    assert.deepEqual(evaluateRuleAgainstMany({}, null), []);
  });
  test("preserves order", () => {
    const rule = ruleWith([{ field: "spend", op: ">", value: 0 }]);
    const entities = [
      { id: "a", spend: 1 },
      { id: "b", spend: 2 },
      { id: "c", spend: 3 },
    ];
    assert.deepEqual(
      evaluateRuleAgainstMany(rule, entities).map((e) => e.id),
      ["a", "b", "c"],
    );
  });
});

// ─── parity with audit-rule semantics ───────────────────────────────────────
// Spot-check that a user-rule mirroring an AUD-* rule produces the same
// match decision the original audit's `check()` function would on the
// same entity. Verifies the surface is rich enough to express the
// existing rule library.
group("parity with audit rules", () => {
  test("AUD-01 equivalent (zero conv after spend)", () => {
    const rule = ruleWith([
      { field: "status", op: "==", value: "ACTIVE" },
      { field: "spend", op: ">", value: 5000 },
      { field: "purchases", op: "==", value: 0 },
    ]);
    // AUD-01.check: status === ACTIVE && purchases === 0 && spend > 5000
    assert.equal(
      evaluateRule(rule, { status: "ACTIVE", spend: 6000, purchases: 0 }),
      true,
    );
    assert.equal(
      evaluateRule(rule, { status: "PAUSED", spend: 6000, purchases: 0 }),
      false,
    );
    assert.equal(
      evaluateRule(rule, { status: "ACTIVE", spend: 4000, purchases: 0 }),
      false,
    );
  });
  test("AUD-12 equivalent (high frequency adset)", () => {
    const rule = ruleWith([{ field: "frequency", op: ">", value: 6 }]);
    assert.equal(evaluateRule(rule, { frequency: 7 }), true);
    assert.equal(evaluateRule(rule, { frequency: 6 }), false);
  });
  test("AUD-13 equivalent (disapproved ad)", () => {
    const rule = ruleWith([
      { field: "review_status", op: "==", value: "DISAPPROVED" },
    ]);
    assert.equal(evaluateRule(rule, { review_status: "DISAPPROVED" }), true);
    assert.equal(evaluateRule(rule, { review_status: "APPROVED" }), false);
  });
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) {
  console.log("\nFailures:");
  for (const f of FAILURES) {
    console.log(`  - ${f.name}: ${f.err.stack || f.err.message}`);
  }
  process.exit(1);
}
