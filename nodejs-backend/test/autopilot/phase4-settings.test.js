#!/usr/bin/env node
/**
 * Plain-Node tests for AutopilotSettings (Phase 4 backfill).
 *
 * Covers only the pure pieces — Joi validator + defaults helper. The
 * controller's Mongo interaction (findOneAndUpdate upsert, $set merge of
 * alerts subdoc) needs an integration test against a real Mongo and is out
 * of scope for this unit suite.
 *
 * Run:  node test/autopilot/phase4-settings.test.js
 */

const assert = require("node:assert/strict");

const {
  updateSettingsSchema,
} = require("../../Validations/autopilotSettings.validator");
const {
  defaultSettings,
  DEFAULTS,
} = require("../../Module/autopilot/autopilotSettings");
const {
  pickMetricsSnapshot,
} = require("../../services/autopilot/metricsSnapshot");
const {
  resolveRunOptions,
} = require("../../services/autopilot/runOptions");

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

function assertValid(body) {
  const { error } = updateSettingsSchema.validate(body, {
    abortEarly: false,
    stripUnknown: true,
  });
  assert.equal(
    error,
    undefined,
    `expected valid, got: ${error && error.message}`,
  );
}

function assertInvalid(body, messageContains) {
  const { error } = updateSettingsSchema.validate(body, {
    abortEarly: false,
    stripUnknown: true,
  });
  assert.ok(error, `expected validation error for ${JSON.stringify(body)}`);
  if (messageContains) {
    const all = error.details.map((d) => d.message).join(" | ");
    assert.ok(
      all.includes(messageContains),
      `expected error to mention "${messageContains}", got: ${all}`,
    );
  }
}

// ---------------------------------------------------------------------------

group("defaultSettings()", () => {
  test("returns a shape with all required keys", () => {
    const s = defaultSettings("user-42");
    assert.equal(s.userId, "user-42");
    assert.equal(s.enabled, DEFAULTS.enabled);
    assert.equal(s.dryRunGlobal, DEFAULTS.dryRunGlobal);
    assert.equal(s.severityFloor, DEFAULTS.severityFloor);
    assert.equal(s.autoResumeEnabled, DEFAULTS.autoResumeEnabled);
    assert.equal(s.scaleWinnersEnabled, DEFAULTS.scaleWinnersEnabled);
    assert.equal(s.creativeRotationEnabled, DEFAULTS.creativeRotationEnabled);
    assert.equal(
      s.creativeAutoGenerateEnabled,
      DEFAULTS.creativeAutoGenerateEnabled,
    );
    assert.equal(
      s.creativeAutoApproveGenerated,
      DEFAULTS.creativeAutoApproveGenerated,
    );
    // Telegram chat-id is the only Telegram user-config — the bot is
    // owned by AdsGPT (token in AUTOPILOT_TELEGRAM_BOT_TOKEN env), so
    // the schema doesn't carry per-user bot tokens.
    assert.deepEqual(s.alerts, {
      slackWebhookUrl: "",
      emailTo: "",
      telegramChatId: "",
      alertOn: ["high"],
    });
    assert.deepEqual(s.perAccountOverrides, {});
  });

  test("safer-default posture: enabled off, dryRun on", () => {
    const s = defaultSettings("u");
    assert.equal(s.enabled, false);
    assert.equal(s.dryRunGlobal, true);
  });

  test("returns a fresh object each call (no shared references)", () => {
    const a = defaultSettings("u1");
    const b = defaultSettings("u2");
    a.alerts.slackWebhookUrl = "https://hooks.slack.com/a";
    a.perAccountOverrides["act_1"] = { "AUD-01": { min_spend: 1 } };
    assert.equal(b.alerts.slackWebhookUrl, "");
    assert.deepEqual(b.perAccountOverrides, {});
  });
});

group("updateSettingsSchema — valid inputs", () => {
  test("single boolean toggle is valid", () => {
    assertValid({ enabled: true });
  });

  test("severityFloor accepts all three levels", () => {
    assertValid({ severityFloor: "critical" });
    assertValid({ severityFloor: "warning" });
    assertValid({ severityFloor: "opportunity" });
  });

  test("alerts with slack webhook URL + email", () => {
    assertValid({
      alerts: {
        slackWebhookUrl: "https://hooks.slack.com/services/T0/B1/XYZ",
        emailTo: "ops@adsgpt.io",
        alertOn: ["high", "medium"],
      },
    });
  });

  test("alerts with empty strings (user clearing fields) is valid", () => {
    assertValid({ alerts: { slackWebhookUrl: "", emailTo: "" } });
  });

  test("perAccountOverrides with act_-prefixed keys", () => {
    assertValid({
      perAccountOverrides: {
        act_475821441756869: { "AUD-01": { min_spend: 100000 } },
      },
    });
  });

  test("selectedAdAccountIds accepts an empty array (the safe default)", () => {
    assertValid({ selectedAdAccountIds: [] });
  });

  test("selectedAdAccountIds accepts bare numeric ids", () => {
    assertValid({ selectedAdAccountIds: ["475821441756869", "162086793500612"] });
  });

  test("combined patch with multiple top-level fields", () => {
    assertValid({
      enabled: true,
      dryRunGlobal: false,
      severityFloor: "warning",
      autoResumeEnabled: true,
      alerts: { alertOn: ["high", "low"] },
      selectedAdAccountIds: ["475821441756869"],
    });
  });
});

group("updateSettingsSchema — invalid inputs", () => {
  test("empty body is rejected", () => {
    assertInvalid({}, "at least one field");
  });

  test("severityFloor with unknown value is rejected", () => {
    assertInvalid({ severityFloor: "meh" });
  });

  test("non-boolean enabled is rejected", () => {
    assertInvalid({ enabled: "yes" });
  });

  test("invalid slack webhook URL is rejected", () => {
    assertInvalid(
      { alerts: { slackWebhookUrl: "not-a-url" } },
      "valid URL",
    );
  });

  test("invalid email is rejected", () => {
    assertInvalid(
      { alerts: { emailTo: "not-an-email" } },
      "valid email",
    );
  });

  test("alerts.alertOn with unknown enum value is rejected", () => {
    assertInvalid({ alerts: { alertOn: ["high", "banana"] } });
  });

  test("perAccountOverrides with non-act_ key is rejected", () => {
    assertInvalid({
      perAccountOverrides: {
        NotAnActId: { "AUD-01": { min_spend: 1 } },
      },
    });
  });

  test("perAccountOverrides with unknown rule id is rejected", () => {
    assertInvalid(
      {
        perAccountOverrides: {
          act_475821441756869: { "AUD-999": { min_spend: 1 } },
        },
      },
      "Unknown rule",
    );
  });

  test("perAccountOverrides with unknown threshold key is rejected", () => {
    assertInvalid(
      {
        perAccountOverrides: {
          // AUD-01 only declares `min_spend`. `bogus_key` is not a known
          // threshold for that rule, so the validator should refuse it.
          act_475821441756869: { "AUD-01": { bogus_key: 1 } },
        },
      },
      "no threshold called",
    );
  });

  test("perAccountOverrides with non-numeric threshold value is rejected", () => {
    assertInvalid(
      {
        perAccountOverrides: {
          act_475821441756869: { "AUD-01": { min_spend: "abc" } },
        },
      },
      "non-negative number",
    );
  });

  test("perAccountOverrides with negative threshold value is rejected", () => {
    assertInvalid(
      {
        perAccountOverrides: {
          act_475821441756869: { "AUD-01": { min_spend: -5 } },
        },
      },
      "non-negative number",
    );
  });

  test("perAccountOverrides with NaN/Infinity threshold value is rejected", () => {
    assertInvalid({
      perAccountOverrides: {
        act_475821441756869: { "AUD-01": { min_spend: Number.POSITIVE_INFINITY } },
      },
    });
  });

  test("perAccountOverrides accepts multiple rules + multiple thresholds in one account", () => {
    assertValid({
      perAccountOverrides: {
        act_475821441756869: {
          "AUD-01": { min_spend: 50000 },
          "AUD-04": { drop_ratio: 0.5 },
          "AUD-32": { min_roas_multiple: 3, min_spend: 1000000 },
        },
      },
    });
  });

  test("alerts subdoc must have at least one key", () => {
    assertInvalid({ alerts: {} });
  });

  test("selectedAdAccountIds rejects act_-prefixed entries", () => {
    assertInvalid(
      { selectedAdAccountIds: ["act_475821441756869"] },
      "bare numeric",
    );
  });

  test("selectedAdAccountIds rejects non-numeric entries", () => {
    assertInvalid(
      { selectedAdAccountIds: ["not-a-number"] },
      "bare numeric",
    );
  });

  test("selectedAdAccountIds rejects duplicate ids", () => {
    assertInvalid({
      selectedAdAccountIds: ["475821441756869", "475821441756869"],
    });
  });
});

group("updateSettingsSchema — stripUnknown + sanity", () => {
  test("unknown top-level keys are stripped (not rejected) with stripUnknown", () => {
    const { error, value } = updateSettingsSchema.validate(
      { enabled: true, somethingElse: "x" },
      { abortEarly: false, stripUnknown: true },
    );
    assert.equal(error, undefined);
    assert.equal(value.somethingElse, undefined);
    assert.equal(value.enabled, true);
  });

  test("value is a new object (validator does not mutate input)", () => {
    const input = { enabled: true };
    const { value } = updateSettingsSchema.validate(input, {
      abortEarly: false,
      stripUnknown: true,
    });
    value.enabled = false;
    assert.equal(input.enabled, true);
  });
});

// ---------------------------------------------------------------------------

group("pickMetricsSnapshot()", () => {
  test("returns null for null/undefined/non-object", () => {
    assert.equal(pickMetricsSnapshot(null), null);
    assert.equal(pickMetricsSnapshot(undefined), null);
    assert.equal(pickMetricsSnapshot("string"), null);
    assert.equal(pickMetricsSnapshot(42), null);
  });

  test("strips underscore-prefixed internals", () => {
    const out = pickMetricsSnapshot({
      spend: 5000,
      _created_time: "2026-04-01",
      _age_gate_failed: false,
      _below_spend_floor: false,
      ctr: 1.2,
    });
    assert.deepEqual(out, { spend: 5000, ctr: 1.2 });
  });

  test("strips id and name fields (already on log row)", () => {
    const out = pickMetricsSnapshot({
      campaign_id: "123",
      campaign_name: "Test",
      adset_id: "456",
      adset_name: "AS",
      ad_id: "789",
      ad_name: "AD",
      spend: 100,
      cpa: 50,
    });
    assert.deepEqual(out, { spend: 100, cpa: 50 });
  });

  test("strips entity discriminator", () => {
    const out = pickMetricsSnapshot({ spend: 1, entity: "campaign" });
    assert.deepEqual(out, { spend: 1 });
  });

  test("keeps prev_* deltas + status + currency", () => {
    const out = pickMetricsSnapshot({
      spend: 100,
      currency: "INR",
      status: "ACTIVE",
      prev_spend: 80,
      prev_ctr: 1.5,
    });
    assert.deepEqual(out, {
      spend: 100,
      currency: "INR",
      status: "ACTIVE",
      prev_spend: 80,
      prev_ctr: 1.5,
    });
  });

  test("returns a new object (does not mutate input)", () => {
    const input = { spend: 10, _foo: "bar" };
    const out = pickMetricsSnapshot(input);
    out.spend = 999;
    assert.equal(input.spend, 10);
    assert.equal(input._foo, "bar"); // not stripped from original
  });

  test("works on a realistic campaign row", () => {
    const data = {
      campaign_id: "act_x_c1",
      campaign_name: "Black Friday",
      spend: 50000,
      currency: "INR",
      impressions: 100000,
      clicks: 500,
      ctr: 0.5,
      cpc: 100,
      cpm: 500,
      roas: 0.3,
      cpa: 0,
      conversions: 0,
      purchases: 0,
      add_to_cart: 0,
      conversion_rate: 0,
      engagement_rate: 0.2,
      budget_pacing: 1.1,
      pacing_date: "2026-04-30",
      status: "ACTIVE",
      account_avg_cpa: 200,
      prev_spend: 45000,
      prev_conversions: 5,
      prev_ctr: 0.6,
      prev_cpc: 90,
      prev_cpm: 480,
      prev_roas: 1.5,
      prev_conversion_rate: 1.0,
      _created_time: "2026-03-01",
      _age_gate_failed: false,
      _below_spend_floor: false,
      entity: "campaign",
    };
    const out = pickMetricsSnapshot(data);
    assert.equal(out.spend, 50000);
    assert.equal(out.status, "ACTIVE");
    assert.equal(out.prev_roas, 1.5);
    assert.equal(out.entity, undefined);
    assert.equal(out._created_time, undefined);
    assert.equal(out.campaign_id, undefined);
    assert.equal(out.campaign_name, undefined);
  });
});

group("resolveRunOptions() — settings precedence", () => {
  const settings = (over = {}) => ({
    enabled: true,
    dryRunGlobal: true,
    severityFloor: "critical",
    ...over,
  });

  test("explicit caller dryRun wins over settings (true → true)", () => {
    const out = resolveRunOptions(
      { dryRun: "true" },
      settings({ dryRunGlobal: false }),
    );
    assert.equal(out.dryRun, true);
    assert.equal(out.settingsApplied.dryRunFromSettings, false);
  });

  test("explicit caller dryRun wins over settings (false → false)", () => {
    const out = resolveRunOptions(
      { dryRun: "false" },
      settings({ dryRunGlobal: true }),
    );
    assert.equal(out.dryRun, false);
  });

  test("absent dryRun falls back to settings.dryRunGlobal=true", () => {
    const out = resolveRunOptions({}, settings({ dryRunGlobal: true }));
    assert.equal(out.dryRun, true);
    assert.equal(out.settingsApplied.dryRunFromSettings, true);
  });

  test("absent dryRun falls back to settings.dryRunGlobal=false", () => {
    const out = resolveRunOptions({}, settings({ dryRunGlobal: false }));
    assert.equal(out.dryRun, false);
  });

  test("empty-string dryRun is treated as absent", () => {
    const out = resolveRunOptions(
      { dryRun: "" },
      settings({ dryRunGlobal: false }),
    );
    assert.equal(out.dryRun, false);
    assert.equal(out.settingsApplied.dryRunFromSettings, true);
  });

  test("explicit severityFloor wins over settings", () => {
    const out = resolveRunOptions(
      { severityFloor: "warning" },
      settings({ severityFloor: "critical" }),
    );
    assert.equal(out.severityFloor, "warning");
    assert.equal(out.settingsApplied.severityFloorFromSettings, false);
  });

  test("absent severityFloor falls back to settings", () => {
    const out = resolveRunOptions({}, settings({ severityFloor: "warning" }));
    assert.equal(out.severityFloor, "warning");
    assert.equal(out.settingsApplied.severityFloorFromSettings, true);
  });

  test("falls back to 'critical' when both source and settings are absent", () => {
    const out = resolveRunOptions({}, { enabled: true });
    assert.equal(out.severityFloor, "critical");
  });

  test("works with empty settings (brand new user)", () => {
    const out = resolveRunOptions({}, {});
    assert.equal(out.severityFloor, "critical");
    assert.equal(out.dryRun, true); // default safe posture
  });
});

group("resolveRunOptions() — refusedDisabled gate", () => {
  test("refused when settings.enabled=false AND live run requested", () => {
    const out = resolveRunOptions(
      { dryRun: "false" },
      { enabled: false, dryRunGlobal: false, severityFloor: "critical" },
    );
    assert.equal(out.dryRun, false);
    assert.equal(out.refusedDisabled, true);
  });

  test("NOT refused for dry-run preview when disabled (lets users preview)", () => {
    const out = resolveRunOptions(
      { dryRun: "true" },
      { enabled: false, dryRunGlobal: false, severityFloor: "critical" },
    );
    assert.equal(out.refusedDisabled, false);
  });

  test("NOT refused when settings.enabled=true and live run", () => {
    const out = resolveRunOptions(
      { dryRun: "false" },
      { enabled: true, dryRunGlobal: false, severityFloor: "critical" },
    );
    assert.equal(out.refusedDisabled, false);
  });

  test("NOT refused when settings.enabled is undefined (legacy users)", () => {
    // Brand-new user with no settings doc — defaults push enabled to false,
    // but we already set dryRun=true via dryRunGlobal default, so the gate
    // shouldn't fire. Verifying that path separately.
    const out = resolveRunOptions(
      {}, // no explicit dryRun → falls back to settings.dryRunGlobal
      { enabled: false, dryRunGlobal: true, severityFloor: "critical" },
    );
    assert.equal(out.dryRun, true);
    assert.equal(out.refusedDisabled, false);
  });
});

// ---------------------------------------------------------------------------

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  process.exit(1);
}
