#!/usr/bin/env node
/**
 * Tests for services/autopilot/actionBudget.js — C4 in
 * docs/AUTOPILOT_SCALING_PLAN.md.
 *
 * THE POINT OF THIS FILE IS TO PIN A DECISION, not just exercise arithmetic.
 * On 2026-09-08 pause and resume were deliberately made UNCAPPED: a ceiling
 * does not prevent a mis-tuned rule's damage, it paces it, while costing real
 * money in the meantime because a half-actioned account keeps spending on ads
 * the rule already called losers. Scale stays capped because budget moves
 * compound across ticks.
 *
 * That is a judgement call someone will reasonably want to revisit, so the
 * defaults are asserted explicitly here rather than left implicit. A future
 * change that re-caps pause or resume should have to edit a test that says
 * why, not discover the behaviour by accident in production.
 *
 * Note what was NOT covered before this file existed: nothing asserted
 * resume's old default of 5. Removing it broke no test, which is exactly how
 * a safety default disappears without anyone noticing.
 */

const assert = require("node:assert/strict");

let pass = 0;
let fail = 0;
const FAILURES = [];

function record(name, err) {
  if (err) {
    fail += 1;
    FAILURES.push({ name, err });
    console.log(`  ✗ ${name}`);
    console.log(`      ${err.stack || err.message}`);
  } else {
    pass += 1;
    console.log(`  ✓ ${name}`);
  }
}
function test(name, fn) {
  try {
    const out = fn();
    if (out && typeof out.then === "function") {
      throw new Error(`"${name}" returned a promise — this file has no async runner`);
    }
    record(name);
  } catch (err) {
    record(name, err);
  }
}
function group(label, fn) {
  console.log(`\n${label}`);
  return fn();
}

// Dependency-free by design: requiring userRuleOrchestrator would connect
// Mongo and Redis at load time and this process would never exit.
const {
  createActionBudget,
  limitFor,
  DEFAULTS,
  ENV_BY_KIND,
  UNLIMITED,
} = require("../../services/autopilot/actionBudget");

const ENV_KEYS = Object.values(ENV_BY_KIND);

/** Run `fn` with the budget env vars set exactly as given, then restore. */
function withEnv(overrides, fn) {
  const saved = {};
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  try {
    for (const k of ENV_KEYS) delete process.env[k];
    for (const [k, v] of Object.entries(overrides)) process.env[k] = v;
    return fn();
  } finally {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

group("defaults — the decision being pinned", () => {
  test("pause is uncapped by default", () => {
    assert.equal(DEFAULTS.pause, UNLIMITED);
    withEnv({}, () => assert.equal(limitFor("pause"), Infinity));
  });

  test("resume is uncapped by default", () => {
    // Was 5 until 2026-09-08. See the module header for the cold-start risk
    // this accepts; if you are re-capping it, update that header too.
    assert.equal(DEFAULTS.resume, UNLIMITED);
    withEnv({}, () => assert.equal(limitFor("resume"), Infinity));
  });

  test("scale is still capped — budget moves compound", () => {
    assert.equal(DEFAULTS.scale, 10);
    withEnv({}, () => assert.equal(limitFor("scale"), 10));
  });

  test("every kind has an env name in the same family", () => {
    assert.equal(ENV_BY_KIND.scale, "AUTOPILOT_MAX_SCALE_ACTIONS_PER_RUN");
    assert.equal(ENV_BY_KIND.pause, "AUTOPILOT_MAX_PAUSE_ACTIONS_PER_RUN");
    assert.equal(ENV_BY_KIND.resume, "AUTOPILOT_MAX_RESUME_ACTIONS_PER_RUN");
  });

  test("an unknown kind throws rather than silently allowing everything", () => {
    assert.throws(() => limitFor("delete_everything"), /unknown action kind/);
  });
});

group("uncapped behaviour", () => {
  test("canSpend never refuses when uncapped", () => {
    withEnv({}, () => {
      const b = createActionBudget();
      for (let i = 0; i < 1000; i += 1) {
        assert.equal(b.spend("pause"), true, `refused at ${i}`);
      }
      assert.equal(b.canSpend("pause"), true);
      assert.equal(b.remaining("pause"), Infinity);
    });
  });

  test("uncapped still COUNTS what it did", () => {
    // `used` feeds the run summary. "How many did we pause" is worth knowing
    // whether or not there was a ceiling.
    withEnv({}, () => {
      const b = createActionBudget();
      b.spend("pause");
      b.spend("pause");
      b.spend("resume");
      const s = b.snapshot();
      assert.equal(s.pause.used, 2);
      assert.equal(s.resume.used, 1);
    });
  });

  test("snapshot reports an uncapped limit as null, not Infinity", () => {
    // These rows reach Mongo and JSON payloads, where Infinity serialises to
    // null anyway. Say it deliberately rather than letting stringify decide.
    withEnv({}, () => {
      const s = createActionBudget().snapshot();
      assert.equal(s.pause.limit, null);
      assert.equal(s.resume.limit, null);
      assert.equal(s.scale.limit, 10);
      assert.equal(JSON.parse(JSON.stringify(s)).pause.limit, null);
    });
  });
});

group("env ceilings — the operator escape hatch", () => {
  test("a positive value imposes a ceiling on pause", () => {
    withEnv({ AUTOPILOT_MAX_PAUSE_ACTIONS_PER_RUN: "2" }, () => {
      const b = createActionBudget();
      assert.equal(b.limits.pause, 2);
      assert.equal(b.spend("pause"), true);
      assert.equal(b.spend("pause"), true);
      assert.equal(b.canSpend("pause"), false);
      assert.equal(b.spend("pause"), false, "must not exceed the ceiling");
      assert.equal(b.remaining("pause"), 0);
    });
  });

  test("a ceiling on one kind does not touch the others", () => {
    withEnv({ AUTOPILOT_MAX_PAUSE_ACTIONS_PER_RUN: "1" }, () => {
      const b = createActionBudget();
      b.spend("pause");
      assert.equal(b.canSpend("pause"), false);
      assert.equal(b.canSpend("resume"), true);
      assert.equal(b.canSpend("scale"), true);
    });
  });

  test("0 in the environment clears a ceiling", () => {
    withEnv({ AUTOPILOT_MAX_SCALE_ACTIONS_PER_RUN: "0" }, () => {
      assert.equal(limitFor("scale"), Infinity);
    });
  });

  test("a negative value is treated as uncapped, not as zero", () => {
    // The dangerous misreading: -1 clamping to 0 would silently disable the
    // action entirely rather than removing its ceiling.
    withEnv({ AUTOPILOT_MAX_PAUSE_ACTIONS_PER_RUN: "-1" }, () => {
      assert.equal(limitFor("pause"), Infinity);
      assert.equal(createActionBudget().canSpend("pause"), true);
    });
  });

  test("a non-numeric value falls back to the default", () => {
    withEnv({ AUTOPILOT_MAX_SCALE_ACTIONS_PER_RUN: "banana" }, () => {
      assert.equal(limitFor("scale"), 10);
    });
  });

  test("an empty string falls back to the default", () => {
    withEnv({ AUTOPILOT_MAX_SCALE_ACTIONS_PER_RUN: "" }, () => {
      assert.equal(limitFor("scale"), 10);
    });
  });
});

group("claimExhaustionLog", () => {
  test("fires once per kind, not once per call", () => {
    // This is what keeps an exhausted ceiling from writing a log row per
    // skipped entity. The caller loops rule-by-rule and entity-by-entity, so
    // the flag has to live on the budget — one per account per cycle — to mean
    // anything at all.
    const b = createActionBudget();
    assert.equal(b.claimExhaustionLog("pause"), false, "first call = not yet logged");
    assert.equal(b.claimExhaustionLog("pause"), true);
    assert.equal(b.claimExhaustionLog("pause"), true);
  });

  test("does not bleed across kinds", () => {
    const b = createActionBudget();
    b.claimExhaustionLog("pause");
    assert.equal(b.claimExhaustionLog("resume"), false);
    assert.equal(b.claimExhaustionLog("scale"), false);
  });

  test("each account gets a fresh budget and a fresh flag", () => {
    // Budgets are per (account × cycle); sharing one would let the first
    // account both starve and silence every account after it.
    const a = createActionBudget();
    const c = createActionBudget();
    a.spend("scale");
    a.claimExhaustionLog("scale");
    assert.equal(c.remaining("scale"), 10);
    assert.equal(c.claimExhaustionLog("scale"), false);
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
