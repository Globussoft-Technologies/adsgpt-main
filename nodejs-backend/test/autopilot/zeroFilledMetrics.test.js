#!/usr/bin/env node
/**
 * Tests for config/zeroFilledMetrics.js and the validator guard it backs.
 *
 * The two rules in the fixtures below are the real ones from production on
 * 2026-10-16, and they are here because they pull in OPPOSITE directions:
 *
 *   "ACTIVE Ads … | OCT 2206-MG"   cpi <= 50   wanted cheap installs,
 *                                              got 103 zero-install ads
 *   "… | ZERO PURCHASES"           roas < 3    WANTS the zero case
 *
 * Any fix that just makes a zero stop matching breaks the second one. The
 * guard has to make the author say which they mean, and these tests pin
 * that both answers remain expressible.
 */
const assert = require("node:assert/strict");

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
  }
}
function group(label, fn) {
  console.log(`\n${label}`);
  fn();
}

const {
  findUnguardedConditions,
  acceptableGuards,
  explain,
  DENOMINATOR_BY_METRIC,
} = require("../../config/zeroFilledMetrics");
const {
  createRuleSchema,
  updateRuleSchema,
} = require("../../Validations/autopilotUserRule.validator");

const rule = (conds, over = {}) => ({
  name: "R",
  description: "D",
  severity: "high",
  evaluateOn: "ad",
  lookbackDays: 14,
  conditions: { operator: "AND", rules: conds },
  action: { type: "pause" },
  attachments: [{ adAccountId: "act_1", campaignId: "2" }],
  ...over,
});
const validate = (body, schema = createRuleSchema) => schema.validate(body);

group("findUnguardedConditions", () => {
  test("flags the production rule that caused this: cpi <= 50", () => {
    const out = findUnguardedConditions([{ field: "cpi", op: "<=", value: 50 }]);
    assert.equal(out.length, 1);
    assert.equal(out[0].field, "cpi");
    assert.equal(out[0].denominator, "installs");
  });

  test("a volume guard on the matching denominator clears it", () => {
    const out = findUnguardedConditions([
      { field: "cpi", op: "<=", value: 50 },
      { field: "installs", op: ">", value: 0 },
    ]);
    assert.deepEqual(out, []);
  });

  test("an explicit zero guard also clears it — the ZERO PURCHASES case", () => {
    // This rule genuinely wants roas === 0 to match. Saying so with
    // `purchases == 0` is an answer, not a workaround.
    const out = findUnguardedConditions([
      { field: "roas", op: "<", value: 3 },
      { field: "purchases", op: "==", value: 0 },
    ]);
    assert.deepEqual(out, []);
  });

  test("a guard on the WRONG denominator does not count", () => {
    // `installs > 0` says nothing about whether this ad had purchases.
    const out = findUnguardedConditions([
      { field: "cpa", op: "<", value: 500 },
      { field: "installs", op: ">", value: 0 },
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0].denominator, "purchases");
  });

  test("`>` and `>=` are never flagged", () => {
    // A zero never satisfies them, which is why the normalisers chose 0
    // over Infinity. Only the `<` family inverts.
    for (const op of [">", ">=", "==", "!="]) {
      assert.deepEqual(findUnguardedConditions([{ field: "cpi", op, value: 50 }]), []);
    }
  });

  test("genuine counts are never flagged", () => {
    // 0 means 0 for these — there is nothing ambiguous to disambiguate.
    for (const field of ["spend", "impressions", "clicks", "installs", "purchases", "ctr"]) {
      assert.deepEqual(findUnguardedConditions([{ field, op: "<", value: 5 }]), []);
    }
  });

  test("every mapped metric is caught, and reports its own denominator", () => {
    for (const [metric, denom] of Object.entries(DENOMINATOR_BY_METRIC)) {
      const out = findUnguardedConditions([{ field: metric, op: "<", value: 1 }]);
      assert.equal(out.length, 1, `${metric} should be flagged`);
      assert.equal(out[0].denominator, denom, `${metric} → ${denom}`);
    }
  });

  test("a prev_ metric accepts the current-period denominator too", () => {
    assert.ok(acceptableGuards("prev_cpi").includes("installs"));
    assert.deepEqual(
      findUnguardedConditions([
        { field: "prev_cpi", op: "<", value: 40 },
        { field: "installs", op: ">", value: 0 },
      ]),
      [],
    );
  });

  test("several unguarded conditions are all reported", () => {
    const out = findUnguardedConditions([
      { field: "cpi", op: "<=", value: 50 },
      { field: "cpa", op: "<", value: 500 },
    ]);
    assert.equal(out.length, 2);
  });

  test("malformed input never throws", () => {
    for (const bad of [null, undefined, "x", 7, [null], [{}], [{ field: 1 }]]) {
      assert.deepEqual(findUnguardedConditions(bad), []);
    }
  });
});

group("the message tells the author what to do", () => {
  test("names the metric, the denominator and both ways out", () => {
    const msg = explain({ field: "cpi", op: "<=", value: 50, denominator: "installs" });
    assert.ok(msg.includes("cpi <= 50"));
    assert.ok(msg.includes("installs > 0"));
    assert.ok(msg.includes("installs == 0"));
  });
});

group("createRuleSchema", () => {
  test("rejects the rule that caused the incident", () => {
    const { error } = validate(rule([{ field: "cpi", op: "<=", value: 50 }], {
      action: { type: "resume" },
    }));
    assert.ok(error, "should be rejected");
    assert.ok(/installs/.test(error.message), error && error.message);
  });

  test("accepts it once the author says which they mean", () => {
    const { error } = validate(rule([
      { field: "cpi", op: "<=", value: 50 },
      { field: "installs", op: ">", value: 0 },
    ], { action: { type: "resume" } }));
    assert.equal(error, undefined, error && error.message);
  });

  test("still accepts ZERO PURCHASES, stated explicitly", () => {
    const { error } = validate(rule([
      { field: "roas", op: "<", value: 3 },
      { field: "purchases", op: "==", value: 0 },
    ]));
    assert.equal(error, undefined, error && error.message);
  });

  test("ordinary rules are untouched", () => {
    const { error } = validate(rule([
      { field: "spend", op: ">", value: 50000 },
      { field: "purchases", op: "==", value: 0 },
    ]));
    assert.equal(error, undefined, error && error.message);
  });
});

group("updateRuleSchema", () => {
  test("a PATCH cannot smuggle an unguarded condition past the guard", () => {
    const { error } = updateRuleSchema.validate({
      conditions: { operator: "AND", rules: [{ field: "cpi", op: "<=", value: 50 }] },
    });
    assert.ok(error, "PATCH should be rejected too");
    assert.ok(/installs/.test(error.message));
  });

  test("a PATCH that adds the guard is accepted", () => {
    const { error } = updateRuleSchema.validate({
      conditions: {
        operator: "AND",
        rules: [
          { field: "cpi", op: "<=", value: 50 },
          { field: "installs", op: ">", value: 0 },
        ],
      },
    });
    assert.equal(error, undefined, error && error.message);
  });

  test("a PATCH touching neither conditions nor level is unaffected", () => {
    const { error } = updateRuleSchema.validate({ enabled: false });
    assert.equal(error, undefined, error && error.message);
  });
});

group("runtime: evaluateRule fails closed on an unguarded zero", () => {
  const { evaluateRule } = require("../../services/autopilot/userRuleEvaluator");
  const resumeRule = {
    conditions: { operator: "AND", rules: [{ field: "cpi", op: "<=", value: 50 }] },
  };

  test("the 103 ads that should never have matched, do not", () => {
    // Real shape from production run 833887c0: spent, zero installs, cpi 0.
    const ad = { status: "PAUSED", spend: 135.96, installs: 0, cpi: 0, ctr: 1.38 };
    assert.equal(evaluateRule(resumeRule, ad), false);
  });

  test("the 50 that legitimately matched, still do", () => {
    const ad = { status: "PAUSED", spend: 300.77, installs: 10, cpi: 30.077 };
    assert.equal(evaluateRule(resumeRule, ad), true);
  });

  test("an expensive install is still correctly rejected", () => {
    const ad = { status: "PAUSED", spend: 300, installs: 2, cpi: 150 };
    assert.equal(evaluateRule(resumeRule, ad), false);
  });

  test("a missing denominator is as unproven as a zero", () => {
    assert.equal(evaluateRule(resumeRule, { spend: 100, cpi: 0 }), false);
  });

  test("a GUARDED rule is left completely alone", () => {
    // Author said they want the zero case. The runtime must not override an
    // intent that was stated explicitly.
    const wantsZero = {
      conditions: {
        operator: "AND",
        rules: [
          { field: "roas", op: "<", value: 3 },
          { field: "purchases", op: "==", value: 0 },
        ],
      },
    };
    assert.equal(evaluateRule(wantsZero, { roas: 0, purchases: 0 }), true);
  });

  test("a guarded `> 0` rule behaves exactly as written", () => {
    const guarded = {
      conditions: {
        operator: "AND",
        rules: [
          { field: "cpi", op: "<=", value: 50 },
          { field: "installs", op: ">", value: 0 },
        ],
      },
    };
    assert.equal(evaluateRule(guarded, { cpi: 30, installs: 10 }), true);
    assert.equal(evaluateRule(guarded, { cpi: 0, installs: 0 }), false);
  });

  test("rules with no zero-filled metric are untouched", () => {
    const plain = {
      conditions: {
        operator: "AND",
        rules: [
          { field: "spend", op: ">", value: 50000 },
          { field: "purchases", op: "==", value: 0 },
        ],
      },
    };
    assert.equal(evaluateRule(plain, { spend: 60000, purchases: 0 }), true);
  });

  test("`>` on a zero-filled metric is unaffected", () => {
    const high = {
      conditions: { operator: "AND", rules: [{ field: "cpa", op: ">", value: 500 }] },
    };
    assert.equal(evaluateRule(high, { cpa: 900, purchases: 3 }), true);
    // Already false by the comparison itself; no denominator check needed.
    assert.equal(evaluateRule(high, { cpa: 0, purchases: 0 }), false);
  });

  test("the live pause rule keeps working — cpa >= 177 already excludes zeros", () => {
    // 6ac0e8d1: spend >= 255 AND cpa >= 177 AND roas < 3. `roas < 3` is
    // unguarded, so the runtime check demands purchases > 0 — which this
    // rule's own cpa threshold already implied. Behaviour is unchanged.
    const live = {
      conditions: {
        operator: "AND",
        rules: [
          { field: "spend", op: ">=", value: 255 },
          { field: "cpa", op: ">=", value: 177 },
          { field: "roas", op: "<", value: 3 },
        ],
      },
    };
    assert.equal(
      evaluateRule(live, { spend: 900, cpa: 300, roas: 1.2, purchases: 3 }),
      true,
    );
    assert.equal(
      evaluateRule(live, { spend: 900, cpa: 0, roas: 0, purchases: 0 }),
      false,
    );
  });
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  for (const f of FAILURES) {
    console.log(`\n FAIL: ${f.name}`);
    console.log(f.err.stack || f.err.message);
  }
  process.exit(1);
}
