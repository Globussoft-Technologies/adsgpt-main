#!/usr/bin/env node
/**
 * Tests for pure helpers added in Phases 5/6/7a/8. No SDK, no Mongo, no
 * network. Run: node test/autopilot/phase3-8.test.js
 */

const assert = require("node:assert/strict");

// Phase 2
const {
  autoPauseForAccount,
} = require("../../services/autopilot/autoPauseService");
// Phase 5
const {
  countFlaps,
  detectManualIntervention,
  autoResumeForAccount,
} = require("../../services/autopilot/autoResumeService");
// Phase 6
const {
  computeStep,
  withinAccountCap,
  isScaleFinding,
  resolveCap7dPct,
  resolveCapAccountPctPerRun,
  autoScaleForAccount,
} = require("../../services/autopilot/autoScaleService");
// Phase 7a
const {
  extractHook,
  proposeName,
} = require("../../services/autopilot/adRenameService");
// Phase 8
const {
  buildSlackPayload,
  buildPlainTextSummary,
  metaAdsManagerUrl,
} = require("../../services/autopilot/alertService");

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

group("autoResumeService.countFlaps", () => {
  test("0 rows → 0 flaps", () => {
    assert.equal(countFlaps([]), 0);
  });
  test("1 row → 0 flaps", () => {
    assert.equal(countFlaps([{ action: "pause", runAt: new Date() }]), 0);
  });
  test("two pauses in a row → 0 flaps (same action)", () => {
    assert.equal(
      countFlaps([
        { action: "pause", runAt: new Date("2026-04-20") },
        { action: "pause", runAt: new Date("2026-04-21") },
      ]),
      0,
    );
  });
  test("pause→resume → 1 flap", () => {
    assert.equal(
      countFlaps([
        { action: "pause", runAt: new Date("2026-04-20") },
        { action: "resume", runAt: new Date("2026-04-21") },
      ]),
      1,
    );
  });
  test("pause→resume→pause→resume → 3 flaps", () => {
    assert.equal(
      countFlaps([
        { action: "pause", runAt: new Date("2026-04-20") },
        { action: "resume", runAt: new Date("2026-04-21") },
        { action: "pause", runAt: new Date("2026-04-22") },
        { action: "resume", runAt: new Date("2026-04-23") },
      ]),
      3,
    );
  });
  test("unsorted input is sorted before counting", () => {
    assert.equal(
      countFlaps([
        { action: "resume", runAt: new Date("2026-04-23") },
        { action: "pause", runAt: new Date("2026-04-20") },
        { action: "pause", runAt: new Date("2026-04-22") },
        { action: "resume", runAt: new Date("2026-04-21") },
      ]),
      3,
    );
  });
});

group("autoResumeService.detectManualIntervention", () => {
  test("null updated_time → no intervention (trust the log)", () => {
    const r = detectManualIntervention(null, new Date("2026-04-26T10:00:00Z"));
    assert.equal(r.intervened, false);
  });

  test("updated_time within grace window of pause → no intervention", () => {
    // Autopilot's own pause write itself updates updated_time; allow 60s grace.
    const pausedAt = "2026-04-26T10:00:00Z";
    const updatedAt = "2026-04-26T10:00:30Z"; // 30s later
    const r = detectManualIntervention(updatedAt, pausedAt);
    assert.equal(r.intervened, false);
  });

  test("updated_time well after pause → intervention", () => {
    const pausedAt = "2026-04-26T10:00:00Z";
    const updatedAt = "2026-04-26T11:00:00Z"; // 1h later
    const r = detectManualIntervention(updatedAt, pausedAt);
    assert.equal(r.intervened, true);
    assert.ok(r.reason && r.reason.includes("later than autopilot pause"));
  });

  test("custom grace window respected", () => {
    const pausedAt = "2026-04-26T10:00:00Z";
    const updatedAt = "2026-04-26T10:05:00Z"; // 5min later
    // With default 60s grace, this is intervention.
    assert.equal(detectManualIntervention(updatedAt, pausedAt).intervened, true);
    // With 10min grace, it's not.
    assert.equal(
      detectManualIntervention(updatedAt, pausedAt, 10 * 60 * 1000).intervened,
      false,
    );
  });

  test("invalid date strings → no intervention (fail-safe)", () => {
    assert.equal(
      detectManualIntervention("not-a-date", "also-not-a-date").intervened,
      false,
    );
  });

  test("Date objects work (not just strings)", () => {
    const pausedAt = new Date("2026-04-26T10:00:00Z");
    const updatedAt = new Date("2026-04-26T11:00:00Z");
    assert.equal(detectManualIntervention(updatedAt, pausedAt).intervened, true);
  });
});

group("autoScaleService.computeStep", () => {
  test("no prior → full step allowed", () => {
    assert.deepEqual(
      computeStep({ priorCumulativePct: 0, stepPct: 20, cap7dPct: 100 }),
      { allowed: true, pctStep: 20 },
    );
  });
  test("prior 80% under 100 cap → only 20% headroom available", () => {
    assert.deepEqual(
      computeStep({ priorCumulativePct: 80, stepPct: 30, cap7dPct: 100 }),
      { allowed: true, pctStep: 20 },
    );
  });
  test("at cap → not allowed", () => {
    assert.deepEqual(
      computeStep({ priorCumulativePct: 100, stepPct: 20, cap7dPct: 100 }),
      { allowed: false, pctStep: 0 },
    );
  });
  test("over cap → not allowed (negative headroom)", () => {
    assert.deepEqual(
      computeStep({ priorCumulativePct: 120, stepPct: 20, cap7dPct: 100 }),
      { allowed: false, pctStep: 0 },
    );
  });
});

group("autoScaleService.isScaleFinding", () => {
  test("AUD-32 is a scale finding", () => {
    assert.equal(isScaleFinding({ rule_id: "AUD-32" }), true);
  });
  test("AUD-33 is a scale finding", () => {
    assert.equal(isScaleFinding({ rule_id: "AUD-33" }), true);
  });
  test("AUD-34 is a scale finding", () => {
    assert.equal(isScaleFinding({ rule_id: "AUD-34" }), true);
  });
  test("AUD-01 is NOT a scale finding", () => {
    assert.equal(isScaleFinding({ rule_id: "AUD-01" }), false);
  });
  test("AUD-06 (opportunity but not action=scale) is NOT a scale finding", () => {
    assert.equal(isScaleFinding({ rule_id: "AUD-06" }), false);
  });
  test("AUD-35 (action=scale_cap policy rule) is NOT a scale finding", () => {
    assert.equal(isScaleFinding({ rule_id: "AUD-35" }), false);
  });
  test("AUD-36 (action=rotate_creative) is NOT a scale finding", () => {
    assert.equal(isScaleFinding({ rule_id: "AUD-36" }), false);
  });
});

group("autoScaleService.resolveCap7dPct (AUD-35 policy)", () => {
  const orig = process.env.AUTOPILOT_SCALE_PCT_CAP_7D;
  function withEnv(value, fn) {
    if (value === undefined) delete process.env.AUTOPILOT_SCALE_PCT_CAP_7D;
    else process.env.AUTOPILOT_SCALE_PCT_CAP_7D = value;
    try {
      fn();
    } finally {
      if (orig === undefined) delete process.env.AUTOPILOT_SCALE_PCT_CAP_7D;
      else process.env.AUTOPILOT_SCALE_PCT_CAP_7D = orig;
    }
  }

  test("falls back to AUD-35.defaults.cap_7d_pct (100) when env unset", () => {
    withEnv(undefined, () => {
      assert.equal(resolveCap7dPct("act_unknown"), 100);
    });
  });

  test("env wins for back compat (env=50 → 50, even if rule default is 100)", () => {
    withEnv("50", () => {
      assert.equal(resolveCap7dPct("act_unknown"), 50);
    });
  });

  test("empty-string env is treated as unset, falls back to defaults", () => {
    withEnv("", () => {
      assert.equal(resolveCap7dPct("act_unknown"), 100);
    });
  });

  test("invalid env value (NaN) ignored, falls back to defaults", () => {
    withEnv("not-a-number", () => {
      assert.equal(resolveCap7dPct("act_unknown"), 100);
    });
  });
});

group("autoScaleService.resolveCapAccountPctPerRun (AUD-37 policy)", () => {
  const orig = process.env.AUTOPILOT_SCALE_PCT_CAP_ACCOUNT_PER_RUN;
  function withEnv(value, fn) {
    if (value === undefined)
      delete process.env.AUTOPILOT_SCALE_PCT_CAP_ACCOUNT_PER_RUN;
    else process.env.AUTOPILOT_SCALE_PCT_CAP_ACCOUNT_PER_RUN = value;
    try {
      fn();
    } finally {
      if (orig === undefined)
        delete process.env.AUTOPILOT_SCALE_PCT_CAP_ACCOUNT_PER_RUN;
      else process.env.AUTOPILOT_SCALE_PCT_CAP_ACCOUNT_PER_RUN = orig;
    }
  }

  test("env unset → falls back to AUD-37.defaults.cap_pct_per_run (10)", () => {
    withEnv(undefined, () => {
      assert.equal(resolveCapAccountPctPerRun("act_unknown"), 10);
    });
  });

  test("env wins (env=5 → 5)", () => {
    withEnv("5", () => {
      assert.equal(resolveCapAccountPctPerRun("act_unknown"), 5);
    });
  });

  test("empty-string env treated as unset", () => {
    withEnv("", () => {
      assert.equal(resolveCapAccountPctPerRun("act_unknown"), 10);
    });
  });

  test("invalid env value falls back to defaults", () => {
    withEnv("nope", () => {
      assert.equal(resolveCapAccountPctPerRun("act_unknown"), 10);
    });
  });
});

group("autoScaleService.withinAccountCap", () => {
  test("under cap → allowed with positive headroom", () => {
    const r = withinAccountCap({
      accumulatedDelta: 1000,
      pendingDelta: 500,
      accountCapAbsolute: 5000,
    });
    assert.equal(r.allowed, true);
    assert.equal(r.headroomDelta, 5000 - 1500);
  });

  test("exactly at cap (boundary) → allowed with 0 headroom", () => {
    const r = withinAccountCap({
      accumulatedDelta: 4500,
      pendingDelta: 500,
      accountCapAbsolute: 5000,
    });
    assert.equal(r.allowed, true);
    assert.equal(r.headroomDelta, 0);
  });

  test("would exceed cap → not allowed; headroom is current free slack", () => {
    const r = withinAccountCap({
      accumulatedDelta: 4500,
      pendingDelta: 1000,
      accountCapAbsolute: 5000,
    });
    assert.equal(r.allowed, false);
    assert.equal(r.headroomDelta, 5000 - 4500);
  });

  test("zero/negative cap (lifetime-only account) → degenerate, allow infinity", () => {
    const r = withinAccountCap({
      accumulatedDelta: 0,
      pendingDelta: 999_999_999,
      accountCapAbsolute: 0,
    });
    assert.equal(r.allowed, true);
    assert.equal(r.headroomDelta, Number.POSITIVE_INFINITY);
  });

  test("first scale into a fresh cycle → allowed, full delta consumed from cap", () => {
    const r = withinAccountCap({
      accumulatedDelta: 0,
      pendingDelta: 2500,
      accountCapAbsolute: 10000,
    });
    assert.equal(r.allowed, true);
    assert.equal(r.headroomDelta, 7500);
  });
});

group("adRenameService.extractHook", () => {
  test("empty / null input → ''", () => {
    assert.equal(extractHook(""), "");
    assert.equal(extractHook(null), "");
    assert.equal(extractHook(undefined), "");
  });
  test("short single-line body returns whole line", () => {
    assert.equal(extractHook("Buy fresh mangoes today!"), "Buy fresh mangoes today!");
  });
  test("multi-line body returns first line", () => {
    assert.equal(
      extractHook("Buy fresh mangoes today!\nLimited stock available."),
      "Buy fresh mangoes today!",
    );
  });
  test("long first line → first sentence preferred if within limit", () => {
    const body =
      "Short hook! Then a much longer follow-up sentence that goes on and on and on with more text.";
    const hook = extractHook(body, 50);
    assert.equal(hook, "Short hook!");
  });
  test("no punctuation → word-boundary truncate + ellipsis", () => {
    const body =
      "This is a really really really really really really long sentence without any punctuation at all indeed";
    const hook = extractHook(body, 40);
    assert.ok(hook.endsWith("…"), `expected ellipsis, got: ${hook}`);
    assert.ok(hook.length <= 41, `expected ≤41 chars, got: ${hook.length}`);
  });
});

group("adRenameService.proposeName", () => {
  test("empty hook → empty proposal", () => {
    assert.equal(proposeName(""), "");
  });
  test("default prefix is [Hook]", () => {
    assert.equal(proposeName("Buy now"), "[Hook] Buy now");
  });
  test("custom prefix", () => {
    assert.equal(proposeName("Buy now", { prefix: "🎯" }), "🎯 Buy now");
  });
  test("exceeds maxTotal → truncated + ellipsis", () => {
    const long = "a".repeat(200);
    const out = proposeName(long, { maxTotal: 20 });
    assert.ok(out.length <= 20, `len=${out.length}`);
    assert.ok(out.endsWith("…"));
  });
});

group("alertService.buildSlackPayload", () => {
  test("dry-run cycle: header says dry-run", () => {
    const p = buildSlackPayload({
      runId: "r1",
      dryRun: true,
      durationMs: 100,
      accounts: [],
    });
    assert.ok(p.text.includes("dry-run"));
    assert.ok(Array.isArray(p.blocks));
  });
  test("live cycle: header says cycle complete", () => {
    const p = buildSlackPayload({
      runId: "r1",
      dryRun: false,
      durationMs: 100,
      accounts: [],
    });
    assert.ok(p.text.includes("cycle complete"));
  });
  test("empty cycle (no rows) shows the 'no actions' fallback", () => {
    // The redesigned Slack message dropped the rollup + totals block in
    // favour of per-account/per-action detail. When no rows match the
    // user's chips, there's no detail to show — the message says so.
    const p = buildSlackPayload({
      runId: "r1",
      dryRun: false,
      durationMs: 100,
      accounts: [
        {
          adAccountId: "act_1",
          name: "A",
          ok: true,
          pause: { findings_count: 10, actionable_count: 3, paused: 3 },
          resume: { resumed: 1 },
        },
      ],
    });
    const fallback = p.blocks.find(
      (b) =>
        b.text &&
        b.text.text &&
        b.text.text.includes("No actions taken or proposed"),
    );
    assert.ok(fallback, "expected 'no actions' fallback block when rows is empty");
  });
  test("failed-account error appears in a footer Errors section", () => {
    const p = buildSlackPayload({
      runId: "r1",
      dryRun: true,
      durationMs: 100,
      accounts: [{ adAccountId: "act_x", name: "X", ok: false, error: "boom" }],
    });
    const errorsBlock = p.blocks.find(
      (b) =>
        b.text &&
        b.text.text &&
        b.text.text.startsWith("*Errors*"),
    );
    assert.ok(errorsBlock, "expected Errors footer block for failed account");
    assert.ok(errorsBlock.text.text.includes("X"));
    assert.ok(errorsBlock.text.text.includes("boom"));
  });
  test(
    "account name is wrapped in a Slack <url|*name*> deep link in per-action detail",
    () => {
      // Need at least one row so the per-account detail block renders;
      // that's where the deep link lives in the redesigned format.
      const p = buildSlackPayload(
        {
          runId: "r1",
          dryRun: true,
          durationMs: 100,
          accounts: [
            {
              adAccountId: "act_999",
              name: "TestCo",
              ok: true,
              pause: { findings_count: 1, actionable_count: 1 },
              resume: {},
            },
          ],
        },
        [
          {
            runId: "r1",
            adAccountId: "act_999",
            entityId: "c1",
            entityName: "Camp 1",
            level: "campaign",
            action: "pause",
            ruleId: "AUD-01",
            ruleSeverity: "critical",
            ruleMessage: "zero conversions",
            outcome: "success",
            dryRun: true,
          },
        ],
      );
      const allText = p.blocks
        .map((b) => (b.text && b.text.text) || "")
        .join("\n");
      assert.ok(allText.includes("business.facebook.com"));
      assert.ok(allText.includes("act=999"));
      assert.ok(allText.includes("|*TestCo*>"));
    },
  );
});

group("alertService.buildPlainTextSummary", () => {
  test("includes runId, durationMs, account names, deep links", () => {
    const out = buildPlainTextSummary({
      runId: "r1",
      dryRun: false,
      durationMs: 50,
      accounts: [
        {
          adAccountId: "act_1",
          name: "A",
          ok: true,
          pause: { findings_count: 3, paused: 1 },
          resume: { resumed: 0 },
        },
      ],
    });
    assert.ok(out.includes("runId: r1"));
    assert.ok(out.includes("duration: 50ms"));
    assert.ok(out.includes("A (act_1)"));
    assert.ok(out.includes("paused=1"));
    assert.ok(out.includes("business.facebook.com"));
  });
  test("dry-run mode uses 'would-' counts", () => {
    const out = buildPlainTextSummary({
      runId: "r1",
      dryRun: true,
      durationMs: 5,
      accounts: [
        {
          adAccountId: "act_1",
          name: "A",
          ok: true,
          pause: { would_pause: 3 },
          resume: { would_resume: 1 },
        },
      ],
    });
    assert.ok(out.includes("DRY RUN"));
    assert.ok(out.includes("would-pause=3"));
    assert.ok(out.includes("would-resume=1"));
  });
});

group("alertService.metaAdsManagerUrl", () => {
  test("returns null when adAccountId missing", () => {
    assert.equal(metaAdsManagerUrl({}), null);
    assert.equal(metaAdsManagerUrl(), null);
  });
  test("strips act_ prefix when building URL", () => {
    const u = metaAdsManagerUrl({ adAccountId: "act_123" });
    assert.ok(u.includes("act=123"));
    assert.ok(!u.includes("act_123"));
  });
  test("accepts raw numeric id too", () => {
    const u = metaAdsManagerUrl({ adAccountId: "123" });
    assert.ok(u.includes("act=123"));
  });
  test("campaign deep link has selected_campaign_ids", () => {
    const u = metaAdsManagerUrl({
      adAccountId: "act_1",
      level: "campaign",
      entityId: "c1",
    });
    assert.ok(u.includes("manage/campaigns"));
    assert.ok(u.includes("selected_campaign_ids=c1"));
  });
  test("adset deep link has selected_adset_ids", () => {
    const u = metaAdsManagerUrl({
      adAccountId: "act_1",
      level: "adset",
      entityId: "as1",
    });
    assert.ok(u.includes("manage/adsets"));
    assert.ok(u.includes("selected_adset_ids=as1"));
  });
  test("ad deep link has selected_ad_ids", () => {
    const u = metaAdsManagerUrl({
      adAccountId: "act_1",
      level: "ad",
      entityId: "a1",
    });
    assert.ok(u.includes("manage/ads"));
    assert.ok(u.includes("selected_ad_ids=a1"));
  });
  test("unknown level falls back to account view", () => {
    const u = metaAdsManagerUrl({ adAccountId: "act_1", level: "weird" });
    assert.ok(u.includes("manage/accounts"));
  });
});

group("Priority C — accessToken / audit arg validation", () => {
  // Each *ForAccount service now accepts an optional pre-fetched `audit`
  // result. When the orchestrator passes `audit`, services skip their
  // internal Meta fetch — that's the within-run cache. The contract is:
  //   - With neither accessToken nor audit → reject with a clear error.
  //   - With `audit` (any object truthy) → pass the entry-point validation;
  //     downstream Mongo / SDK calls may still fail, but not with the
  //     "accessToken is required" message.

  test("autoPauseForAccount throws when neither accessToken nor audit given", async () => {
    await assert.rejects(
      autoPauseForAccount({ userId: "u", adAccountId: "act_1" }),
      /accessToken is required when no pre-fetched audit/,
    );
  });

  test("autoResumeForAccount throws when neither accessToken nor audit given", async () => {
    await assert.rejects(
      autoResumeForAccount({ userId: "u", adAccountId: "act_1" }),
      /accessToken is required when no pre-fetched audit/,
    );
  });

  test("autoScaleForAccount throws when neither accessToken nor audit given", async () => {
    await assert.rejects(
      autoScaleForAccount({ userId: "u", adAccountId: "act_1" }),
      /accessToken is required when no pre-fetched audit/,
    );
  });

  test("autoPauseForAccount with audit passes entry validation (does not throw 'accessToken required')", async () => {
    // We expect SOME error downstream (Mongo connect, SDK, etc.) but NOT
    // the "accessToken is required" message — proves the audit-only branch
    // gets past the entry guard.
    let err;
    try {
      await autoPauseForAccount({
        userId: "u",
        adAccountId: "act_1",
        audit: { findings: [], account_name: "X" },
      });
    } catch (e) {
      err = e;
    }
    if (err) {
      assert.doesNotMatch(err.message, /accessToken is required/);
    }
    // If no error at all, that's also fine — empty findings → no work.
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
