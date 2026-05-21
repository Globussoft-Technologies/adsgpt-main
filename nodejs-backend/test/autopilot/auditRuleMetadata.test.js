#!/usr/bin/env node
/**
 * Tests for config/auditRuleMetadata.js — the catalog the GET /audit-rules
 * endpoint returns and the validator uses to gate per-account overrides.
 *
 * These exercise pure functions; no fixtures, no stubs.
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
    console.log(`      ${err.stack || err.message}`);
  }
}
function group(label, fn) {
  console.log(`\n${label}`);
  return fn();
}

const {
  listAuditRulesForUI,
  buildAllowedOverrides,
  THRESHOLD_META,
  RULE_DESCRIPTIONS,
} = require("../../config/auditRuleMetadata");
const rules = require("../../config/auditRulesConfig");

group("listAuditRulesForUI", () => {
  const list = listAuditRulesForUI();

  test("returns one entry per rule in auditRulesConfig", () => {
    assert.equal(list.length, rules.length);
  });

  test("each entry has id, severity, entity, description, defaults, tunable", () => {
    for (const r of list) {
      assert.ok(r.id, `missing id on ${JSON.stringify(r)}`);
      assert.ok(["critical", "warning", "opportunity"].includes(r.severity));
      assert.ok(r.entity, `missing entity on ${r.id}`);
      assert.equal(typeof r.description, "string");
      assert.equal(typeof r.defaults, "object");
      assert.ok(Array.isArray(r.tunable));
    }
  });

  test("AUD-01 surfaces min_spend as a tunable threshold", () => {
    const r = list.find((x) => x.id === "AUD-01");
    assert.ok(r);
    const minSpend = r.tunable.find((t) => t.key === "min_spend");
    assert.ok(minSpend, "AUD-01 should expose min_spend as tunable");
    assert.equal(minSpend.type, "currency");
    assert.equal(typeof minSpend.label, "string");
    assert.ok(minSpend.label.length > 0);
    assert.equal(minSpend.default, rules.find((x) => x.id === "AUD-01").defaults.min_spend);
  });

  test("policy rules (AUD-35, AUD-37) carry their cap thresholds", () => {
    const aud35 = list.find((x) => x.id === "AUD-35");
    const aud37 = list.find((x) => x.id === "AUD-37");
    assert.ok(aud35.tunable.find((t) => t.key === "cap_7d_pct"));
    assert.ok(aud37.tunable.find((t) => t.key === "cap_pct_per_run"));
  });

  test("rules with empty defaults still appear with empty tunable[]", () => {
    // AUD-13 (disapproved ad) and AUD-19 (spend-up no-conv) declare
    // defaults: {} — the catalog should still list them so the UI can
    // render their description, just with no editors.
    const r = list.find((x) => x.id === "AUD-13");
    assert.ok(r);
    assert.equal(r.tunable.length, 0);
  });

  test("every rule has a non-empty description", () => {
    for (const r of list) {
      assert.ok(
        r.description.length > 0,
        `RULE_DESCRIPTIONS missing entry for ${r.id}`,
      );
    }
  });
});

group("buildAllowedOverrides", () => {
  const allowed = buildAllowedOverrides();

  test("contains every rule id from auditRulesConfig", () => {
    for (const r of rules) {
      assert.ok(allowed.has(r.id), `missing ${r.id} in allowed map`);
    }
  });

  test("AUD-01's allowed threshold set matches its declared defaults keys", () => {
    const aud01 = rules.find((x) => x.id === "AUD-01");
    const set = allowed.get("AUD-01");
    for (const key of Object.keys(aud01.defaults)) {
      assert.ok(set.has(key), `AUD-01 should accept threshold ${key}`);
    }
  });

  test("rule with empty defaults has an empty allowed set", () => {
    // AUD-13 = disapproved ad; no thresholds.
    assert.equal(allowed.get("AUD-13").size, 0);
  });
});

group("THRESHOLD_META coverage", () => {
  test("every threshold key referenced by any rule has metadata", () => {
    const missing = [];
    for (const r of rules) {
      for (const k of Object.keys(r.defaults || {})) {
        if (!THRESHOLD_META[k]) missing.push(`${r.id}:${k}`);
      }
    }
    assert.deepEqual(
      missing,
      [],
      `THRESHOLD_META is missing entries for: ${missing.join(", ")}`,
    );
  });
});

group("RULE_DESCRIPTIONS coverage", () => {
  test("every rule id in auditRulesConfig has a description", () => {
    const missing = rules
      .map((r) => r.id)
      .filter((id) => !RULE_DESCRIPTIONS[id]);
    assert.deepEqual(
      missing,
      [],
      `RULE_DESCRIPTIONS is missing entries for: ${missing.join(", ")}`,
    );
  });
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) {
  console.log("\nFAIL details:");
  for (const f of FAILURES) {
    console.log(` - ${f.name}\n   ${f.err.stack || f.err.message}`);
  }
  process.exit(1);
}
