#!/usr/bin/env node
/**
 * Plain-Node assertion-style tests for the rule evaluator + autopilotConfig
 * overrides. Run with:
 *
 *   node test/autopilot/auditRules.test.js
 *
 * or  `npm run test:autopilot` from nodejs-backend/.
 *
 * No test framework is used — this codebase does not have jest/mocha wired
 * up, and Phase 1 is intentionally light on infrastructure. The script
 * exits non-zero on failure and prints a PASS/FAIL summary.
 */

const assert = require("node:assert/strict");

const {
  evaluateRules,
} = require("../../services/autopilot/ruleEvaluator");
const autopilotConfig = require("../../config/autopilotConfig");
const {
  getEffectiveThresholds,
  getAccountConfig,
  isLiveActionsAllowed,
  effectiveDryRun,
} = autopilotConfig;
const rules = require("../../config/auditRulesConfig");

// In v3 the `accounts` map is empty by default. Tests that exercise the
// per-account threshold-override mechanism inject their own entry into the
// shared exported map before asserting and remove it after, so they test the
// override mechanism without depending on any production fixture.
const TEST_OVERRIDE_ACCT = "act_test_override_999";
function withTestOverride(entry, fn) {
  autopilotConfig.accounts[TEST_OVERRIDE_ACCT] = entry;
  try {
    return fn();
  } finally {
    delete autopilotConfig.accounts[TEST_OVERRIDE_ACCT];
  }
}

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

// ---------------------------------------------------------------------------
// Fixtures — minimal normalised rows matching what buildNormalisers produces.
// ---------------------------------------------------------------------------

function campaignRow(overrides = {}) {
  return {
    campaign_id: "c1",
    campaign_name: "Test Campaign",
    spend: 0,
    currency: "INR",
    impressions: 0,
    clicks: 0,
    ctr: 0,
    cpc: 0,
    cpm: 0,
    roas: 0,
    cpa: 0,
    conversions: 0,
    purchases: 0,
    add_to_cart: 0,
    conversion_rate: 0,
    engagement_rate: 0,
    budget_pacing: 0,
    pacing_date: "unknown",
    status: "ACTIVE",
    account_avg_cpa: 0,
    prev_spend: null,
    prev_conversions: null,
    prev_ctr: null,
    prev_cpc: null,
    prev_cpm: null,
    prev_roas: null,
    prev_conversion_rate: null,
    entity: "campaign",
    ...overrides,
  };
}

function adsetRow(overrides = {}) {
  return {
    campaign_id: "c1",
    campaign_name: "Test Campaign",
    adset_id: "as1",
    adset_name: "Test AdSet",
    spend: 0,
    currency: "INR",
    clicks: 0,
    purchases: 0,
    cpa: 0,
    frequency: 0,
    status: "ACTIVE",
    historical_roas: 0,
    learning_status: null,
    audience_size: null,
    prev_cpa: null,
    entity: "adset",
    ...overrides,
  };
}

function adRow(overrides = {}) {
  return {
    campaign_id: "c1",
    campaign_name: "Test Campaign",
    adset_id: "as1",
    adset_name: "Test AdSet",
    ad_id: "a1",
    ad_name: "Test Ad",
    spend: 0,
    currency: "INR",
    ctr: 0,
    impressions: 0,
    engagement_rate: 0,
    ad_spend_share: null,
    is_top_performer: false,
    status: "ACTIVE",
    review_status: null,
    relevance_score: null,
    prev_spend: null,
    prev_ctr: null,
    prev_impressions: null,
    entity: "ad",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

group("Rule config — shape invariants", () => {
  test("every rule has id / severity / entity / check / message / defaults", () => {
    for (const r of rules) {
      assert.ok(typeof r.id === "string" && r.id.length > 0, `id: ${r.id}`);
      assert.ok(
        ["critical", "warning", "opportunity"].includes(r.severity),
        `severity: ${r.id}`,
      );
      assert.ok(
        ["campaign", "adset", "ad"].includes(r.entity),
        `entity: ${r.id}`,
      );
      assert.equal(typeof r.check, "function", `check fn: ${r.id}`);
      assert.equal(typeof r.message, "function", `message fn: ${r.id}`);
      assert.ok(
        r.defaults && typeof r.defaults === "object",
        `defaults obj: ${r.id}`,
      );
    }
  });

  test("rule ids are unique (AUD-01 through AUD-37 incl. AUD-35/AUD-37 policy + AUD-36 fatigue)", () => {
    const ids = rules.map((r) => r.id);
    assert.equal(ids.length, new Set(ids).size, "duplicate ids exist");
    assert.equal(ids.length, 37, `expected 37 rules, got ${ids.length}`);
    assert.ok(ids.includes("AUD-35"), "AUD-35 (scale 7d cap policy) missing");
    assert.ok(ids.includes("AUD-36"), "AUD-36 (CTR fatigue) missing");
    assert.ok(ids.includes("AUD-37"), "AUD-37 (account-level scale cap) missing");
  });

  test("AUD-37 is a no-op policy rule with cap_pct_per_run default", () => {
    const r = rules.find((x) => x.id === "AUD-37");
    assert.ok(r, "AUD-37 not found");
    assert.equal(r.severity, "opportunity");
    assert.equal(r.action, "scale_account_cap");
    assert.equal(typeof r.defaults.cap_pct_per_run, "number");
    assert.ok(r.defaults.cap_pct_per_run > 0);
    // Policy rule never fires from the audit engine
    assert.equal(r.check({}, r.defaults), false);
  });

  test("AUD-35 is a no-op policy rule with cap_7d_pct default", () => {
    const r = rules.find((x) => x.id === "AUD-35");
    assert.ok(r, "AUD-35 not found");
    assert.equal(r.severity, "opportunity");
    assert.equal(r.action, "scale_cap");
    assert.equal(typeof r.defaults.cap_7d_pct, "number");
    assert.ok(r.defaults.cap_7d_pct > 0);
    // Policy rule never fires from the audit engine
    assert.equal(r.check({}, r.defaults), false);
  });

  test("AUD-36 is a warning fatigue rule with rotate_creative action", () => {
    const r = rules.find((x) => x.id === "AUD-36");
    assert.ok(r, "AUD-36 not found");
    assert.equal(r.severity, "warning");
    assert.equal(r.entity, "ad");
    assert.equal(r.action, "rotate_creative");
    assert.equal(typeof r.defaults.ctr_drop_ratio, "number");
    assert.equal(typeof r.defaults.min_spend, "number");
  });
});

group("autopilotConfig — live-actions safety gate (global env flag)", () => {
  // The flag is global and read at call time, so we toggle process.env
  // around each assertion. afterEach is implicit because each test restores
  // the var it touched.
  const ENV_KEY = "AUTOPILOT_LIVE_ACTIONS_ALLOWED";

  test("isLiveActionsAllowed is false when env flag is unset", () => {
    const prev = process.env[ENV_KEY];
    delete process.env[ENV_KEY];
    try {
      assert.equal(isLiveActionsAllowed("act_475821441756869"), false);
      assert.equal(isLiveActionsAllowed("act_99999999999"), false);
    } finally {
      if (prev !== undefined) process.env[ENV_KEY] = prev;
    }
  });

  test("isLiveActionsAllowed is false when env flag is 'false'", () => {
    const prev = process.env[ENV_KEY];
    process.env[ENV_KEY] = "false";
    try {
      assert.equal(isLiveActionsAllowed("act_475821441756869"), false);
    } finally {
      if (prev === undefined) delete process.env[ENV_KEY];
      else process.env[ENV_KEY] = prev;
    }
  });

  test("isLiveActionsAllowed is true when env flag is 'true' (case-insensitive)", () => {
    const prev = process.env[ENV_KEY];
    for (const v of ["true", "TRUE", " True "]) {
      process.env[ENV_KEY] = v;
      assert.equal(
        isLiveActionsAllowed("act_475821441756869"),
        true,
        `flag value ${JSON.stringify(v)} should enable live writes`,
      );
    }
    if (prev === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = prev;
  });

  test("effectiveDryRun: requestedDryRun=true passes through unchanged", () => {
    const r = effectiveDryRun({
      adAccountId: "act_475821441756869",
      requestedDryRun: true,
    });
    assert.equal(r.dryRun, true);
    assert.equal(r.forced, false);
  });

  test("effectiveDryRun: requestedDryRun=false with env flag off is FORCED to dry-run", () => {
    const prev = process.env[ENV_KEY];
    delete process.env[ENV_KEY];
    try {
      const r = effectiveDryRun({
        adAccountId: "act_475821441756869",
        requestedDryRun: false,
      });
      assert.equal(r.dryRun, true);
      assert.equal(r.forced, true);
      assert.ok(
        r.reason && r.reason.includes("AUTOPILOT_LIVE_ACTIONS_ALLOWED"),
      );
    } finally {
      if (prev !== undefined) process.env[ENV_KEY] = prev;
    }
  });

  test("effectiveDryRun: requestedDryRun=false with env flag on returns live", () => {
    const prev = process.env[ENV_KEY];
    process.env[ENV_KEY] = "true";
    try {
      const r = effectiveDryRun({
        adAccountId: "act_475821441756869",
        requestedDryRun: false,
      });
      assert.equal(r.dryRun, false);
      assert.equal(r.forced, false);
    } finally {
      if (prev === undefined) delete process.env[ENV_KEY];
      else process.env[ENV_KEY] = prev;
    }
  });

  test("effectiveDryRun: unknown account + requestedDryRun=false with env off is FORCED", () => {
    const prev = process.env[ENV_KEY];
    delete process.env[ENV_KEY];
    try {
      const r = effectiveDryRun({
        adAccountId: "act_99999999999",
        requestedDryRun: false,
      });
      assert.equal(r.dryRun, true);
      assert.equal(r.forced, true);
    } finally {
      if (prev !== undefined) process.env[ENV_KEY] = prev;
    }
  });
});

group("autopilotConfig — threshold merge", () => {
  test("getEffectiveThresholds returns rule defaults when no overrides", () => {
    const t = getEffectiveThresholds(
      { min_spend: 50 },
      "AUD-01",
      "act_999",
      undefined,
    );
    assert.deepEqual(t, { min_spend: 50 });
  });

  test("per-account override replaces default (₹1000 floor)", () => {
    withTestOverride(
      { overrides: { "AUD-01": { min_spend: 100000 } } },
      () => {
        const t = getEffectiveThresholds(
          { min_spend: 5000 }, // rule default
          "AUD-01",
          TEST_OVERRIDE_ACCT,
          undefined,
        );
        assert.deepEqual(t, { min_spend: 100000 });
      },
    );
  });

  test("caller override wins over per-account", () => {
    withTestOverride(
      { overrides: { "AUD-01": { min_spend: 100000 } } },
      () => {
        const t = getEffectiveThresholds(
          { min_spend: 50 },
          "AUD-01",
          TEST_OVERRIDE_ACCT,
          { "AUD-01": { min_spend: 5000 } },
        );
        assert.deepEqual(t, { min_spend: 5000 });
      },
    );
  });

  test("partial override only replaces named keys", () => {
    withTestOverride(
      { overrides: { "AUD-08": { min_spend: 500 } } },
      () => {
        const t = getEffectiveThresholds(
          { min_spend: 200, max_roas: 0.5 },
          "AUD-08",
          TEST_OVERRIDE_ACCT,
          { "AUD-08": { min_spend: 500 } },
        );
        assert.deepEqual(t, { min_spend: 500, max_roas: 0.5 });
      },
    );
  });

  test("getAccountConfig accepts both act_xxx and raw id", () => {
    withTestOverride({ overrides: {} }, () => {
      assert.ok(getAccountConfig(TEST_OVERRIDE_ACCT));
      assert.ok(getAccountConfig(TEST_OVERRIDE_ACCT.replace("act_", "")));
    });
    assert.equal(getAccountConfig("act_999999"), null);
  });

  test("default `accounts` map is empty (no hardcoded production fixtures)", () => {
    assert.deepEqual(autopilotConfig.accounts, {});
  });
});

group("evaluateRules — byte-identical behavior with defaults", () => {
  // Reminder: spend is in smallest currency unit (paise/cents). default=5000 (₹50)
  test("AUD-01 fires when spend > 5000 (₹50) AND purchases === 0 AND status ACTIVE", () => {
    const findings = evaluateRules(
      [campaignRow({ spend: 5001, purchases: 0, status: "ACTIVE" })],
      "campaign",
    );
    assert.ok(
      findings.some((f) => f.rule_id === "AUD-01"),
      "expected AUD-01 to fire",
    );
  });

  test("AUD-01 does NOT fire at exactly spend 5000 (boundary)", () => {
    const findings = evaluateRules(
      [campaignRow({ spend: 5000, purchases: 0, status: "ACTIVE" })],
      "campaign",
    );
    assert.ok(
      !findings.some((f) => f.rule_id === "AUD-01"),
      "expected AUD-01 not to fire at boundary",
    );
  });

  test("AUD-12 (frequency > 6) fires on adset", () => {
    const findings = evaluateRules(
      [adsetRow({ frequency: 6.1 })],
      "adset",
    );
    assert.ok(findings.some((f) => f.rule_id === "AUD-12"));
  });

  test("AUD-13 (DISAPPROVED) fires on ad", () => {
    const findings = evaluateRules(
      [adRow({ review_status: "DISAPPROVED" })],
      "ad",
    );
    assert.ok(findings.some((f) => f.rule_id === "AUD-13"));
  });
});

group("evaluateRules — per-account override flows through", () => {
  // Units: spend in smallest currency unit. Default=5000 (₹50). The test
  // override below raises the AUD-01 floor to 100000 (₹1000) for
  // TEST_OVERRIDE_ACCT only. Tests reflect those values.
  test("AUD-01 at spend=50000 (₹500) fires with defaults (act_999, unknown)", () => {
    const findings = evaluateRules(
      [campaignRow({ spend: 50000, purchases: 0, status: "ACTIVE" })],
      "campaign",
      { adAccountId: "act_999" },
    );
    assert.ok(findings.some((f) => f.rule_id === "AUD-01"));
  });

  test("AUD-01 at spend=50000 (₹500) does NOT fire when override raises floor to ₹1000", () => {
    withTestOverride(
      { overrides: { "AUD-01": { min_spend: 100000 } } },
      () => {
        const findings = evaluateRules(
          [campaignRow({ spend: 50000, purchases: 0, status: "ACTIVE" })],
          "campaign",
          { adAccountId: TEST_OVERRIDE_ACCT },
        );
        assert.ok(
          !findings.some((f) => f.rule_id === "AUD-01"),
          "override should prevent AUD-01 firing below ₹1000",
        );
      },
    );
  });

  test("AUD-01 at spend=150000 (₹1500) DOES fire with the ₹1000 override floor", () => {
    withTestOverride(
      { overrides: { "AUD-01": { min_spend: 100000 } } },
      () => {
        const findings = evaluateRules(
          [campaignRow({ spend: 150000, purchases: 0, status: "ACTIVE" })],
          "campaign",
          { adAccountId: TEST_OVERRIDE_ACCT },
        );
        assert.ok(
          findings.some((f) => f.rule_id === "AUD-01"),
          "override with ₹1000 floor should fire at ₹1500",
        );
      },
    );
  });

  test("caller thresholdOverrides wins (account override + caller ₹5000 floor)", () => {
    withTestOverride(
      { overrides: { "AUD-01": { min_spend: 100000 } } },
      () => {
        const findings = evaluateRules(
          [campaignRow({ spend: 150000, purchases: 0, status: "ACTIVE" })],
          "campaign",
          {
            adAccountId: TEST_OVERRIDE_ACCT,
            thresholdOverrides: { "AUD-01": { min_spend: 500000 } },
          },
        );
        assert.ok(
          !findings.some((f) => f.rule_id === "AUD-01"),
          "caller ₹5000 floor should suppress firing at ₹1500",
        );
      },
    );
  });
});

group("AUD-36 — ad CTR fatigue WoW", () => {
  // Defaults: ctr_drop_ratio: 0.3 (30% drop), min_spend: 5000 (₹50)
  test("fires when CTR drops >30% WoW with spend > ₹50 and status ACTIVE", () => {
    const findings = evaluateRules(
      [adRow({ ctr: 0.5, prev_ctr: 1.0, spend: 6000, status: "ACTIVE" })],
      "ad",
    );
    assert.ok(
      findings.some((f) => f.rule_id === "AUD-36"),
      "expected AUD-36 to fire (50% drop, ₹60 spend)",
    );
  });

  test("does NOT fire at 25% drop (below threshold)", () => {
    // prev=1.0, ctr=0.75 → drop=0.25; cleanly under the 0.3 threshold.
    // (Avoiding 30% exactly because 1.0 - 0.7 = 0.30000000000000004 in IEEE
    // float, which would flip a strictly-greater check to fire.)
    const findings = evaluateRules(
      [adRow({ ctr: 0.75, prev_ctr: 1.0, spend: 6000, status: "ACTIVE" })],
      "ad",
    );
    assert.ok(
      !findings.some((f) => f.rule_id === "AUD-36"),
      "expected AUD-36 NOT to fire at 25% drop",
    );
  });

  test("does NOT fire when spend below floor", () => {
    const findings = evaluateRules(
      [adRow({ ctr: 0.1, prev_ctr: 1.0, spend: 4999, status: "ACTIVE" })],
      "ad",
    );
    assert.ok(!findings.some((f) => f.rule_id === "AUD-36"));
  });

  test("does NOT fire when prev_ctr is null (no prior data)", () => {
    const findings = evaluateRules(
      [adRow({ ctr: 0.1, prev_ctr: null, spend: 100000, status: "ACTIVE" })],
      "ad",
    );
    assert.ok(!findings.some((f) => f.rule_id === "AUD-36"));
  });

  test("does NOT fire when prev_ctr is 0 (avoids divide-by-zero)", () => {
    const findings = evaluateRules(
      [adRow({ ctr: 0.1, prev_ctr: 0, spend: 100000, status: "ACTIVE" })],
      "ad",
    );
    assert.ok(!findings.some((f) => f.rule_id === "AUD-36"));
  });

  test("does NOT fire on PAUSED ad even if CTR dropped", () => {
    const findings = evaluateRules(
      [adRow({ ctr: 0.1, prev_ctr: 1.0, spend: 100000, status: "PAUSED" })],
      "ad",
    );
    assert.ok(!findings.some((f) => f.rule_id === "AUD-36"));
  });

  test("fires when status is null (legacy rows without configured status)", () => {
    // Don't penalise older rows / mocks; AUD-36 only blocks on EXPLICIT non-ACTIVE
    const findings = evaluateRules(
      [adRow({ ctr: 0.5, prev_ctr: 1.0, spend: 6000, status: null })],
      "ad",
    );
    assert.ok(findings.some((f) => f.rule_id === "AUD-36"));
  });

  test("message reports prev → current CTR + drop %", () => {
    const findings = evaluateRules(
      [adRow({ ctr: 0.5, prev_ctr: 1.0, spend: 6000, status: "ACTIVE" })],
      "ad",
    );
    const f = findings.find((x) => x.rule_id === "AUD-36");
    assert.ok(f, "AUD-36 finding missing");
    assert.match(f.message, /1\.00%/);
    assert.match(f.message, /0\.50%/);
    assert.match(f.message, /50%/); // drop pct
  });
});

group("evaluateRules — finding includes data for metricsSnapshot", () => {
  test("each finding carries `data` (the normalised entity row)", () => {
    const row = campaignRow({ spend: 5001, purchases: 0, status: "ACTIVE" });
    const findings = evaluateRules([row], "campaign");
    assert.ok(findings.length > 0);
    assert.equal(findings[0].data, row);
    assert.equal(findings[0].data.spend, 5001);
  });
});

group("evaluateRules — sorting / shape of findings", () => {
  test("findings have rule_id, severity, entity_type, entity_id, entity_name, message", () => {
    const findings = evaluateRules(
      [campaignRow({ spend: 100, purchases: 0, status: "ACTIVE" })],
      "campaign",
    );
    assert.ok(findings.length > 0, "expected at least one finding");
    const f = findings[0];
    for (const key of [
      "rule_id",
      "severity",
      "entity_type",
      "entity_id",
      "entity_name",
      "message",
    ]) {
      assert.ok(key in f, `missing key: ${key}`);
    }
    assert.equal(f.entity_type, "campaign");
    assert.equal(f.entity_id, "c1");
    assert.equal(f.entity_name, "Test Campaign");
    assert.equal(typeof f.message, "string");
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
