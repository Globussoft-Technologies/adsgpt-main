#!/usr/bin/env node
/**
 * Plain-Node tests for services/autopilot/autoPauseService pure helpers.
 * Does NOT exercise the Meta SDK or Mongo — those paths need an integration
 * test against a real dry-run account.
 *
 * Run:  npm run test:autopilot-phase2
 */

const assert = require("node:assert/strict");

const {
  severityAtLeast,
  filterActionable,
  classifyFindingAction,
} = require("../../services/autopilot/autoPauseService");

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
  fn();
}

const critical = { rule_id: "AUD-01", severity: "critical" };
const warning = { rule_id: "AUD-03", severity: "warning" };
const opportunity = { rule_id: "AUD-25", severity: "opportunity" };

// ---------------------------------------------------------------------------

group("severityAtLeast", () => {
  test("critical >= critical", () => {
    assert.equal(severityAtLeast("critical", "critical"), true);
  });
  test("warning < critical", () => {
    assert.equal(severityAtLeast("warning", "critical"), false);
  });
  test("opportunity < warning", () => {
    assert.equal(severityAtLeast("opportunity", "warning"), false);
  });
  test("warning >= warning", () => {
    assert.equal(severityAtLeast("warning", "warning"), true);
  });
  test("critical >= warning", () => {
    assert.equal(severityAtLeast("critical", "warning"), true);
  });
  test("opportunity >= opportunity", () => {
    assert.equal(severityAtLeast("opportunity", "opportunity"), true);
  });
  test("unknown severity ranks 0, fails any floor", () => {
    assert.equal(severityAtLeast("unknown", "opportunity"), false);
  });
  test("unknown floor ranks 0, everything passes", () => {
    assert.equal(severityAtLeast("opportunity", "unknown"), true);
  });
});

group("filterActionable", () => {
  test("floor=critical keeps only critical", () => {
    const out = filterActionable([critical, warning, opportunity], "critical");
    assert.equal(out.length, 1);
    assert.equal(out[0].severity, "critical");
  });

  test("floor=warning keeps critical + warning", () => {
    const out = filterActionable([critical, warning, opportunity], "warning");
    assert.equal(out.length, 2);
    const severities = out.map((x) => x.severity).sort();
    assert.deepEqual(severities, ["critical", "warning"]);
  });

  test("floor=opportunity keeps all three", () => {
    const out = filterActionable(
      [critical, warning, opportunity],
      "opportunity",
    );
    assert.equal(out.length, 3);
  });

  test("empty input returns []", () => {
    assert.deepEqual(filterActionable([], "critical"), []);
  });

  test("null input returns [] (defensive)", () => {
    assert.deepEqual(filterActionable(null, "critical"), []);
  });

  test("non-array input returns [] (defensive)", () => {
    assert.deepEqual(filterActionable("nope", "critical"), []);
  });

  test("preserves finding order within the filtered set", () => {
    const one = { rule_id: "AUD-01", severity: "critical" };
    const two = { rule_id: "AUD-08", severity: "critical" };
    const three = { rule_id: "AUD-12", severity: "critical" };
    const out = filterActionable([one, two, three], "critical");
    assert.deepEqual(
      out.map((x) => x.rule_id),
      ["AUD-01", "AUD-08", "AUD-12"],
    );
  });

  test("does not mutate input", () => {
    const input = [critical, warning, opportunity];
    const snapshot = JSON.stringify(input);
    filterActionable(input, "critical");
    assert.equal(JSON.stringify(input), snapshot);
  });
});

group("classifyFindingAction", () => {
  test("critical issues are tagged 'pause'", () => {
    assert.equal(
      classifyFindingAction({ rule_id: "AUD-01", severity: "critical" }),
      "pause",
    );
  });

  test("warning issues are tagged 'pause'", () => {
    assert.equal(
      classifyFindingAction({ rule_id: "AUD-03", severity: "warning" }),
      "pause",
    );
  });

  test("opportunity findings are 'alert_only' (never paused)", () => {
    assert.equal(
      classifyFindingAction({ rule_id: "AUD-25", severity: "opportunity" }),
      "alert_only",
    );
    assert.equal(
      classifyFindingAction({ rule_id: "AUD-28", severity: "opportunity" }),
      "alert_only",
    );
  });

  test("rules with action='scale' are 'alert_only' even if severity is non-opportunity", () => {
    // AUD-32 is opportunity-severity + scale action — autoScaleService owns
    // this. autoPauseService must not flip it to PAUSED.
    assert.equal(
      classifyFindingAction({ rule_id: "AUD-32", severity: "opportunity" }),
      "alert_only",
    );
  });

  test("rules with action='rotate_creative' are 'alert_only' (rotation owns them)", () => {
    // AUD-36 is severity 'warning' — would have escaped a pure severity check.
    // The action-field guard catches it.
    assert.equal(
      classifyFindingAction({ rule_id: "AUD-36", severity: "warning" }),
      "alert_only",
    );
  });

  test("missing finding or missing severity is 'alert_only' (defensive)", () => {
    assert.equal(classifyFindingAction(null), "alert_only");
    assert.equal(classifyFindingAction({}), "alert_only");
    assert.equal(
      classifyFindingAction({ rule_id: "AUD-01" }),
      "alert_only",
    );
  });
});

// ---------------------------------------------------------------------------
console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log("\nFailures:");
  for (const { name, err } of FAILURES) {
    console.log(`  - ${name}: ${err.stack || err.message}`);
  }
  process.exit(1);
}
