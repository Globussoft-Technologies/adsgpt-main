#!/usr/bin/env node
/**
 * Tests for services/autopilot/userRuleOrchestrator.js — the v4 cron
 * entry point.
 *
 * Pure helpers tested directly. The full cycle is exercised through the
 * same Module._load monkey-patch pattern used elsewhere — stubbing
 * Mongoose models, redis, the Meta SDK + token decryption, and the
 * existing metaAuditService so we can drive deterministic fixtures
 * through the orchestrator without touching the network or DB.
 *
 * Run:  node test/autopilot/userRuleOrchestrator.test.js
 */

const assert = require("node:assert/strict");
const Module = require("node:module");

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
function testAsync(name, fn) {
  return (async () => {
    try {
      await fn();
      pass += 1;
      console.log(`  ✓ ${name}`);
    } catch (err) {
      fail += 1;
      FAILURES.push({ name, err });
      console.log(`  ✗ ${name}`);
      console.log(`      ${err.stack || err.message}`);
    }
  })();
}
function group(label, fn) {
  console.log(`\n${label}`);
  return fn();
}

// ─── stub layer ─────────────────────────────────────────────────────────────
const stubs = {
  rules: [],          // AutopilotUserRule docs
  ruleUpdateLog: [],  // markAttachmentOrphan calls
  fbUsers: [],        // FacebookUsers docs
  settingsByUser: {}, // userId → autopilotSettings doc | null
  redisStore: new Map(),
  auditByAccount: new Map(),  // acctKey → return shape for runAuditForAccount
  // Optional per-(acctKey,lookbackDays) fixture override, used by lookback
  // dedupe tests. Falls back to auditByAccount when no specific entry.
  auditByAccountAndLookback: new Map(),
  auditCalls: [],     // every runAuditForAccount invocation, in order
  pauseCalls: [],     // pauseEntity invocations
  pauseFailNext: null,
  actionLogWrites: [],
  alertCalls: [],
};

function resetStubs() {
  stubs.rules = [];
  stubs.ruleUpdateLog = [];
  stubs.fbUsers = [];
  stubs.settingsByUser = {};
  stubs.redisStore = new Map();
  stubs.auditByAccount = new Map();
  stubs.auditByAccountAndLookback = new Map();
  stubs.auditCalls = [];
  stubs.pauseCalls = [];
  stubs.pauseFailNext = null;
  stubs.actionLogWrites = [];
  stubs.alertCalls = [];
  // Default to live-actions ON so tests don't accidentally hit the
  // dry-run gate. Tests that need it off override per-case.
  process.env.AUTOPILOT_LIVE_ACTIONS_ALLOWED = "true";
}

const originalLoad = Module._load;
Module._load = function patched(request, parent, isMain) {
  if (request.endsWith("Module/autopilot/autopilotUserRule")) {
    return {
      find: (q) => ({
        lean: async () =>
          stubs.rules.filter((r) => {
            if (q.enabled !== undefined && r.enabled !== q.enabled) return false;
            if (q.userId && q.userId.$in && !q.userId.$in.includes(r.userId)) return false;
            return true;
          }),
      }),
      updateOne: async (q, update, opts) => {
        stubs.ruleUpdateLog.push({ q, update, opts });
        return { acknowledged: true, modifiedCount: 1 };
      },
    };
  }
  if (request.endsWith("Module/adPosting/facebookUsers")) {
    return {
      findOne: (q) => ({
        lean: async () =>
          stubs.fbUsers.find((u) => u.userId === q.userId) || null,
      }),
    };
  }
  if (request.endsWith("Module/autopilot/autopilotSettings")) {
    // Mock supports the orchestrator's per-user enabled/dryRunGlobal gate.
    // Tests that don't set settingsByUser[uid] get a null doc — orchestrator
    // treats that as "legacy user, proceed with defaults."
    return {
      findOne: (q, _projection) => ({
        lean: async () => {
          const uid = q && q.userId;
          return stubs.settingsByUser[uid] === undefined
            ? null
            : stubs.settingsByUser[uid];
        },
      }),
    };
  }
  if (request.endsWith("Module/autopilot/autopilotActionLog")) {
    return {
      create: async (doc) => {
        stubs.actionLogWrites.push(doc);
        return doc;
      },
    };
  }
  if (request.endsWith("db/redis")) {
    return {
      redisClient: {
        set: async (k, v, _ex, _ttl, nx) => {
          if (nx === "NX" && stubs.redisStore.has(k)) return null;
          stubs.redisStore.set(k, v);
          return "OK";
        },
        get: async (k) => stubs.redisStore.get(k) || null,
        del: async (k) => {
          stubs.redisStore.delete(k);
          return 1;
        },
      },
    };
  }
  if (request.endsWith("utils/crypto")) {
    return { decrypt: (s) => `decrypted:${s}` };
  }
  if (request.endsWith("services/metaAuditService") || request.endsWith("../metaAuditService")) {
    return {
      runAuditForAccount: async ({ adAccountId, options = {} } = {}) => {
        // Record every call so tests can assert dedupe + per-lookback fetch.
        stubs.auditCalls.push({
          adAccountId,
          lookbackDays: options.lookbackDays,
          prevLookbackDays: options.prevLookbackDays,
        });
        // Lookup precedence: (acct, lookback) → (acct) → throw.
        const lbKey = `${adAccountId}:${options.lookbackDays}`;
        const fixture =
          stubs.auditByAccountAndLookback.get(lbKey) ||
          stubs.auditByAccount.get(adAccountId);
        if (!fixture) {
          throw new Error(`no audit fixture for ${adAccountId}`);
        }
        return fixture;
      },
    };
  }
  if (request === "facebook-nodejs-business-sdk") {
    const SDKLevel = (level) =>
      class {
        constructor(id) {
          this.id = id;
          this._level = level;
        }
        async update(_fields, payload) {
          if (stubs.pauseFailNext) {
            const err = stubs.pauseFailNext;
            stubs.pauseFailNext = null;
            throw err;
          }
          stubs.pauseCalls.push({
            level: this._level,
            entityId: this.id,
            payload,
          });
        }
      };
    return {
      Campaign: Object.assign(SDKLevel("campaign"), {
        Fields: { status: "status" },
      }),
      AdSet: Object.assign(SDKLevel("adset"), {
        Fields: { status: "status" },
      }),
      Ad: Object.assign(SDKLevel("ad"), {
        Fields: { status: "status" },
      }),
    };
  }
  if (request.endsWith("services/autopilot/alertService") || request.endsWith("./alertService")) {
    return {
      notifyAutopilotCycle: async (summary) => {
        stubs.alertCalls.push(summary);
        return { slacks: [], emails: [] };
      },
    };
  }
  if (request.endsWith("config/autopilotConfig")) {
    return {
      effectiveDryRun: ({ requestedDryRun }) => {
        if (requestedDryRun) return { dryRun: true, forced: false };
        if (
          String(process.env.AUTOPILOT_LIVE_ACTIONS_ALLOWED || "false")
            .toLowerCase() !== "true"
        ) {
          return { dryRun: true, forced: true, reason: "live disabled" };
        }
        return { dryRun: false, forced: false };
      },
      normalizeAdAccountId: (id) =>
        !id
          ? id
          : String(id).startsWith("act_")
            ? String(id)
            : `act_${id}`,
    };
  }
  if (request.endsWith("services/autopilot/metricsSnapshot") || request.endsWith("./metricsSnapshot")) {
    return { pickMetricsSnapshot: (d) => ({ spend: d?.spend }) };
  }
  if (request.endsWith("utils/logger")) {
    return { info: () => {}, warn: () => {}, error: () => {} };
  }
  return originalLoad.apply(this, arguments);
};

const orchestrator = require("../../services/autopilot/userRuleOrchestrator");
const {
  groupRulesByUserAndAccount,
  collectTargetsForRule,
} = orchestrator._internals;

// ─── pure helpers ───────────────────────────────────────────────────────────
group("groupRulesByUserAndAccount", () => {
  test("groups one rule across multiple attached accounts", () => {
    const out = groupRulesByUserAndAccount([
      {
        userId: "u1",
        attachments: [
          { adAccountId: "act_1", campaignId: "c1" },
          { adAccountId: "act_2", campaignId: "c2" },
        ],
      },
    ]);
    assert.equal(out.size, 1);
    const byAcct = out.get("u1");
    assert.deepEqual(Array.from(byAcct.keys()).sort(), ["act_1", "act_2"]);
  });
  test("groups multiple rules for same account into one bucket", () => {
    const out = groupRulesByUserAndAccount([
      { userId: "u1", attachments: [{ adAccountId: "act_1", campaignId: "c1" }] },
      { userId: "u1", attachments: [{ adAccountId: "act_1", campaignId: "c2" }] },
    ]);
    assert.equal(out.get("u1").get("act_1").length, 2);
  });
  test("normalizes bare-numeric adAccountId to act_-prefix", () => {
    const out = groupRulesByUserAndAccount([
      {
        userId: "u1",
        attachments: [{ adAccountId: "123", campaignId: "c1" }],
      },
    ]);
    assert.ok(out.get("u1").has("act_123"));
  });
  test("rule attached twice to same account in attachments[] is grouped once", () => {
    const out = groupRulesByUserAndAccount([
      {
        _id: "r1",
        userId: "u1",
        attachments: [
          { adAccountId: "act_1", campaignId: "c1" },
          { adAccountId: "act_1", campaignId: "c2" }, // same account, different campaign
        ],
      },
    ]);
    // Rule should appear once under act_1, not twice.
    assert.equal(out.get("u1").get("act_1").length, 1);
  });
  test("non-array attachments → ignored, no crash", () => {
    const out = groupRulesByUserAndAccount([
      { userId: "u1", attachments: null },
      { userId: "u1" },
    ]);
    assert.equal(out.size, 0);
  });
});

group("collectTargetsForRule", () => {
  const entities = {
    campaigns: [
      { campaign_id: "c1", name: "C1" },
      { campaign_id: "c2", name: "C2" },
    ],
    adsets: [
      { adset_id: "s1", campaign_id: "c1" },
      { adset_id: "s2", campaign_id: "c1" },
      { adset_id: "s3", campaign_id: "c2" },
    ],
    ads: [
      { ad_id: "a1", campaign_id: "c1" },
      { ad_id: "a2", campaign_id: "c2" },
    ],
  };
  test("evaluateOn=campaign → returns the matched campaign only", () => {
    const out = collectTargetsForRule(
      { evaluateOn: "campaign" },
      entities,
      "c1",
    );
    assert.deepEqual(out.map((c) => c.campaign_id), ["c1"]);
  });
  test("evaluateOn=adset → all adsets under the campaign", () => {
    const out = collectTargetsForRule(
      { evaluateOn: "adset" },
      entities,
      "c1",
    );
    assert.deepEqual(out.map((s) => s.adset_id), ["s1", "s2"]);
  });
  test("evaluateOn=ad → all ads under the campaign", () => {
    const out = collectTargetsForRule({ evaluateOn: "ad" }, entities, "c1");
    assert.deepEqual(out.map((a) => a.ad_id), ["a1"]);
  });
  test("missing campaign → empty", () => {
    assert.deepEqual(
      collectTargetsForRule({ evaluateOn: "campaign" }, entities, "GHOST"),
      [],
    );
  });
  test("unknown evaluateOn → empty", () => {
    assert.deepEqual(
      collectTargetsForRule({ evaluateOn: "MOON" }, entities, "c1"),
      [],
    );
  });
});

// ─── full runUserRuleCycle integration ──────────────────────────────────────

const auditFixture = ({ name = "TestAcct", overrides = {} } = {}) => ({
  status: true,
  account_name: name,
  summary: { critical: 0, warning: 0, opportunity: 0 },
  findings: [],
  accountDailyBudget: 0,
  entities: {
    campaigns: [
      {
        campaign_id: "camp_1",
        campaign_name: "Camp 1",
        status: "ACTIVE",
        spend: 60000,
        purchases: 0,
        ctr: 0.4,
      },
    ],
    adsets: [
      {
        adset_id: "as_1",
        campaign_id: "camp_1",
        status: "ACTIVE",
        spend: 30000,
      },
    ],
    ads: [
      {
        ad_id: "ad_1",
        campaign_id: "camp_1",
        status: "ACTIVE",
        spend: 10000,
        review_status: "DISAPPROVED",
      },
    ],
    // Authoritative campaign roster — independent of which campaigns
    // had insights in the lookback window. The orchestrator's orphan
    // check consults this so freshly-created or non-delivering
    // campaigns aren't false-positive flagged.
    allCampaignIds: ["camp_1"],
    ...overrides,
  },
});

const { runUserRuleCycle } = orchestrator;

(async () => {
  await group("runUserRuleCycle — happy paths", async () => {
    await testAsync(
      "matching pause rule triggers pauseEntity + writes log row",
      async () => {
        resetStubs();
        stubs.rules = [
          {
            _id: "r1",
            userId: "u1",
            enabled: true,
            name: "Zero conv",
            severity: "high",
            evaluateOn: "campaign",
            conditions: {
              operator: "AND",
              rules: [
                { field: "status", op: "==", value: "ACTIVE" },
                { field: "spend", op: ">", value: 50000 },
                { field: "purchases", op: "==", value: 0 },
              ],
            },
            action: { type: "pause" },
            attachments: [{ adAccountId: "act_42", campaignId: "camp_1" }],
          },
        ];
        stubs.fbUsers = [{ userId: "u1", accessToken: "tok-u1" }];
        stubs.auditByAccount.set("act_42", auditFixture());

        const result = await runUserRuleCycle({ dryRun: false });

        assert.equal(stubs.pauseCalls.length, 1, "pauseEntity should fire once");
        assert.equal(stubs.pauseCalls[0].level, "campaign");
        assert.equal(stubs.pauseCalls[0].entityId, "camp_1");
        assert.equal(stubs.actionLogWrites.length, 1);
        const row = stubs.actionLogWrites[0];
        assert.equal(row.ruleId, "r1");
        assert.equal(row.ruleSeverity, "high");
        assert.equal(row.action, "pause");
        assert.equal(row.outcome, "success");
        assert.equal(row.dryRun, false);
        assert.equal(result.accounts.length, 1);
        assert.equal(result.accounts[0].pause.paused, 1);
      },
    );

    await testAsync(
      "alert rule writes alert_only row, never calls pauseEntity",
      async () => {
        resetStubs();
        stubs.rules = [
          {
            _id: "r2",
            userId: "u1",
            enabled: true,
            name: "Alert me",
            severity: "medium",
            evaluateOn: "campaign",
            conditions: {
              operator: "AND",
              rules: [{ field: "status", op: "==", value: "ACTIVE" }],
            },
            action: { type: "alert" },
            attachments: [{ adAccountId: "act_42", campaignId: "camp_1" }],
          },
        ];
        stubs.fbUsers = [{ userId: "u1", accessToken: "tok-u1" }];
        stubs.auditByAccount.set("act_42", auditFixture());

        await runUserRuleCycle({ dryRun: false });
        assert.equal(stubs.pauseCalls.length, 0);
        assert.equal(stubs.actionLogWrites.length, 1);
        assert.equal(stubs.actionLogWrites[0].action, "alert_only");
      },
    );

    await testAsync(
      "non-matching rule produces zero log rows",
      async () => {
        resetStubs();
        stubs.rules = [
          {
            _id: "r3",
            userId: "u1",
            enabled: true,
            name: "Never matches",
            severity: "low",
            evaluateOn: "campaign",
            conditions: {
              operator: "AND",
              rules: [{ field: "spend", op: ">", value: 9999999 }],
            },
            action: { type: "pause" },
            attachments: [{ adAccountId: "act_42", campaignId: "camp_1" }],
          },
        ];
        stubs.fbUsers = [{ userId: "u1", accessToken: "tok-u1" }];
        stubs.auditByAccount.set("act_42", auditFixture());

        await runUserRuleCycle({ dryRun: false });
        assert.equal(stubs.actionLogWrites.length, 0);
        assert.equal(stubs.pauseCalls.length, 0);
      },
    );

    await testAsync(
      "evaluateOn='ad' walks ads under the attached campaign",
      async () => {
        resetStubs();
        stubs.rules = [
          {
            _id: "r4",
            userId: "u1",
            enabled: true,
            name: "Disapproved",
            severity: "high",
            evaluateOn: "ad",
            conditions: {
              operator: "AND",
              rules: [
                { field: "review_status", op: "==", value: "DISAPPROVED" },
              ],
            },
            action: { type: "pause" },
            attachments: [{ adAccountId: "act_42", campaignId: "camp_1" }],
          },
        ];
        stubs.fbUsers = [{ userId: "u1", accessToken: "tok-u1" }];
        stubs.auditByAccount.set("act_42", auditFixture());

        await runUserRuleCycle({ dryRun: false });
        assert.equal(stubs.pauseCalls.length, 1);
        assert.equal(stubs.pauseCalls[0].level, "ad");
        assert.equal(stubs.pauseCalls[0].entityId, "ad_1");
      },
    );
  });

  await group("runUserRuleCycle — guards", async () => {
    await testAsync(
      "already-PAUSED entity is silently skipped — no pauseEntity, no log row",
      async () => {
        // Hourly cron + a long-paused campaign that still matches the rule
        // would otherwise spam the action log with a fresh "already-paused"
        // row every tick. v4 treats already-paused as a no-op: zero Meta
        // calls AND zero log rows.
        resetStubs();
        stubs.rules = [
          {
            _id: "r5",
            userId: "u1",
            enabled: true,
            name: "Pause active",
            severity: "high",
            evaluateOn: "campaign",
            conditions: {
              operator: "AND",
              rules: [{ field: "spend", op: ">", value: 1 }],
            },
            action: { type: "pause" },
            attachments: [{ adAccountId: "act_42", campaignId: "camp_1" }],
          },
        ];
        stubs.fbUsers = [{ userId: "u1", accessToken: "tok-u1" }];
        const fx = auditFixture();
        fx.entities.campaigns[0].status = "PAUSED";
        stubs.auditByAccount.set("act_42", fx);

        await runUserRuleCycle({ dryRun: false });
        assert.equal(stubs.pauseCalls.length, 0, "must not re-pause");
        assert.equal(
          stubs.actionLogWrites.length,
          0,
          "no log row for already-paused entities",
        );
      },
    );

    await testAsync(
      "AUTOPILOT_LIVE_ACTIONS_ALLOWED=false forces dryRun on pause attempts",
      async () => {
        resetStubs();
        process.env.AUTOPILOT_LIVE_ACTIONS_ALLOWED = "false";
        stubs.rules = [
          {
            _id: "r6",
            userId: "u1",
            enabled: true,
            name: "Pause spam",
            severity: "high",
            evaluateOn: "campaign",
            conditions: {
              operator: "AND",
              rules: [{ field: "spend", op: ">", value: 1 }],
            },
            action: { type: "pause" },
            attachments: [{ adAccountId: "act_42", campaignId: "camp_1" }],
          },
        ];
        stubs.fbUsers = [{ userId: "u1", accessToken: "tok-u1" }];
        stubs.auditByAccount.set("act_42", auditFixture());

        await runUserRuleCycle({ dryRun: false });
        assert.equal(
          stubs.pauseCalls.length,
          0,
          "live disabled — no Meta call",
        );
        assert.equal(stubs.actionLogWrites.length, 1);
        assert.equal(stubs.actionLogWrites[0].dryRun, true);
        assert.equal(stubs.actionLogWrites[0].outcome, "success");
      },
    );

    await testAsync(
      "pauseEntity failure is logged with outcome=failed, doesn't crash cycle",
      async () => {
        resetStubs();
        stubs.rules = [
          {
            _id: "r7",
            userId: "u1",
            enabled: true,
            name: "Pause spam",
            severity: "high",
            evaluateOn: "campaign",
            conditions: {
              operator: "AND",
              rules: [{ field: "spend", op: ">", value: 1 }],
            },
            action: { type: "pause" },
            attachments: [{ adAccountId: "act_42", campaignId: "camp_1" }],
          },
        ];
        stubs.fbUsers = [{ userId: "u1", accessToken: "tok-u1" }];
        stubs.auditByAccount.set("act_42", auditFixture());
        stubs.pauseFailNext = new Error("Meta API down");

        const result = await runUserRuleCycle({ dryRun: false });
        assert.equal(stubs.actionLogWrites.length, 1);
        assert.equal(stubs.actionLogWrites[0].outcome, "failed");
        assert.match(stubs.actionLogWrites[0].error, /Meta API down/);
        assert.equal(result.accounts[0].pause.failed, 1);
      },
    );
  });

  await group("runUserRuleCycle — orphan attachments", async () => {
    await testAsync(
      "campaign no longer in /me/campaigns marks attachment orphan",
      async () => {
        resetStubs();
        stubs.rules = [
          {
            _id: "r8",
            userId: "u1",
            enabled: true,
            name: "Pause stuff",
            severity: "high",
            evaluateOn: "campaign",
            conditions: {
              operator: "AND",
              rules: [{ field: "spend", op: ">", value: 1 }],
            },
            action: { type: "pause" },
            attachments: [
              { adAccountId: "act_42", campaignId: "GHOST_CAMP", orphan: false },
            ],
          },
        ];
        stubs.fbUsers = [{ userId: "u1", accessToken: "tok-u1" }];
        stubs.auditByAccount.set("act_42", auditFixture()); // only camp_1

        await runUserRuleCycle({ dryRun: false });
        assert.equal(stubs.actionLogWrites.length, 0);
        assert.equal(stubs.pauseCalls.length, 0);
        assert.equal(
          stubs.ruleUpdateLog.length,
          1,
          "orphan flag should be persisted",
        );
        const updateCall = stubs.ruleUpdateLog[0];
        assert.equal(
          updateCall.update.$set["attachments.$[a].orphan"],
          true,
        );
      },
    );
    await testAsync(
      "already-orphan attachment doesn't trigger a duplicate Mongo update",
      async () => {
        resetStubs();
        stubs.rules = [
          {
            _id: "r9",
            userId: "u1",
            enabled: true,
            name: "Pause",
            severity: "high",
            evaluateOn: "campaign",
            conditions: {
              operator: "AND",
              rules: [{ field: "spend", op: ">", value: 1 }],
            },
            action: { type: "pause" },
            attachments: [
              {
                adAccountId: "act_42",
                campaignId: "GHOST_CAMP",
                orphan: true,
              },
            ],
          },
        ];
        stubs.fbUsers = [{ userId: "u1", accessToken: "tok-u1" }];
        stubs.auditByAccount.set("act_42", auditFixture());

        await runUserRuleCycle({ dryRun: false });
        assert.equal(
          stubs.ruleUpdateLog.length,
          0,
          "no orphan-mark update needed when already flagged",
        );
      },
    );

    await testAsync(
      "campaign exists on Meta but has no insights → NOT marked orphan",
      async () => {
        // Regression for the false-positive orphan reported by the
        // tester: every brand-new rule was getting "1 orphan" on its
        // attachments because the orphan check was looking at the
        // insight-bearing campaigns list, which excludes campaigns
        // that haven't delivered in the lookback window.
        resetStubs();
        stubs.rules = [
          {
            _id: "r-fresh",
            userId: "u1",
            enabled: true,
            name: "Watch silent campaign",
            severity: "low",
            evaluateOn: "campaign",
            conditions: {
              operator: "AND",
              rules: [{ field: "spend", op: ">", value: 1 }],
            },
            action: { type: "alert" },
            attachments: [
              { adAccountId: "act_42", campaignId: "silent_camp", orphan: false },
            ],
          },
        ];
        stubs.fbUsers = [{ userId: "u1", accessToken: "tok-u1" }];
        // Campaign is on Meta (allCampaignIds) but has no insights row
        // (entities.campaigns is empty) — e.g. brand new, paused, or
        // simply hasn't delivered yet.
        const fx = auditFixture({
          overrides: {
            campaigns: [],
            adsets: [],
            ads: [],
            allCampaignIds: ['silent_camp'],
          },
        });
        stubs.auditByAccount.set('act_42', fx);

        await runUserRuleCycle({ dryRun: false });
        // No orphan-mark write — the campaign is alive on Meta even
        // though it has zero insight rows in the window.
        assert.equal(stubs.ruleUpdateLog.length, 0);
      },
    );

    await testAsync(
      "previously-orphan attachment self-heals when campaign reappears",
      async () => {
        resetStubs();
        stubs.rules = [
          {
            _id: "r-heal",
            userId: "u1",
            enabled: true,
            name: "Pause",
            severity: "high",
            evaluateOn: "campaign",
            conditions: {
              operator: "AND",
              rules: [{ field: "spend", op: ">", value: 1 }],
            },
            action: { type: "pause" },
            attachments: [
              { adAccountId: "act_42", campaignId: "camp_1", orphan: true },
            ],
          },
        ];
        stubs.fbUsers = [{ userId: "u1", accessToken: "tok-u1" }];
        // Campaign is alive again — auditFixture's allCampaignIds
        // contains 'camp_1' and the attachment was previously flagged.
        stubs.auditByAccount.set('act_42', auditFixture());

        await runUserRuleCycle({ dryRun: false });
        assert.equal(stubs.ruleUpdateLog.length, 1, 'orphan flag should be cleared');
        const updateCall = stubs.ruleUpdateLog[0];
        assert.equal(
          updateCall.update.$set['attachments.$[a].orphan'],
          false,
          'orphan flag should be set to false (self-heal)',
        );
      },
    );
  });

  await group("runUserRuleCycle — discovery & alerts", async () => {
    await testAsync(
      "no enabled rules → no audits, no pauses, alert dispatcher still called with empty summary",
      async () => {
        resetStubs();
        stubs.rules = [
          {
            _id: "r10",
            userId: "u1",
            enabled: false,
            attachments: [
              { adAccountId: "act_42", campaignId: "camp_1" },
            ],
          },
        ];
        const result = await runUserRuleCycle({ dryRun: false });
        assert.equal(result.accounts.length, 0);
        assert.equal(stubs.actionLogWrites.length, 0);
        assert.equal(
          stubs.alertCalls.length,
          1,
          "alert dispatcher always invoked (handles empty cycle)",
        );
      },
    );
    await testAsync(
      "userIds filter restricts which rules run",
      async () => {
        resetStubs();
        stubs.rules = [
          {
            _id: "rA",
            userId: "u1",
            enabled: true,
            name: "x",
            severity: "high",
            evaluateOn: "campaign",
            conditions: {
              operator: "AND",
              rules: [{ field: "spend", op: ">", value: 1 }],
            },
            action: { type: "pause" },
            attachments: [{ adAccountId: "act_42", campaignId: "camp_1" }],
          },
          {
            _id: "rB",
            userId: "u2",
            enabled: true,
            name: "y",
            severity: "high",
            evaluateOn: "campaign",
            conditions: {
              operator: "AND",
              rules: [{ field: "spend", op: ">", value: 1 }],
            },
            action: { type: "pause" },
            attachments: [{ adAccountId: "act_99", campaignId: "camp_1" }],
          },
        ];
        stubs.fbUsers = [
          { userId: "u1", accessToken: "tok-u1" },
          { userId: "u2", accessToken: "tok-u2" },
        ];
        stubs.auditByAccount.set("act_42", auditFixture());
        stubs.auditByAccount.set("act_99", auditFixture());

        await runUserRuleCycle({
          dryRun: false,
          userIds: ["u1"],
        });
        // Only u1's rule should have fired, so only one log row.
        assert.equal(stubs.actionLogWrites.length, 1);
        assert.equal(stubs.actionLogWrites[0].userId, "u1");
      },
    );
    await testAsync(
      "user with expired token is skipped",
      async () => {
        resetStubs();
        stubs.rules = [
          {
            _id: "rExp",
            userId: "u1",
            enabled: true,
            name: "x",
            severity: "high",
            evaluateOn: "campaign",
            conditions: {
              operator: "AND",
              rules: [{ field: "spend", op: ">", value: 1 }],
            },
            action: { type: "pause" },
            attachments: [{ adAccountId: "act_42", campaignId: "camp_1" }],
          },
        ];
        stubs.fbUsers = [
          {
            userId: "u1",
            accessToken: "tok",
            tokenExpiresAt: new Date(Date.now() - 60_000),
          },
        ];
        await runUserRuleCycle({ dryRun: false });
        assert.equal(stubs.actionLogWrites.length, 0);
        assert.equal(stubs.pauseCalls.length, 0);
      },
    );
  });

  await group("runUserRuleCycle — per-user settings gates", async () => {
    await testAsync(
      "settings.enabled=false skips the user (no pauses, no log rows)",
      async () => {
        resetStubs();
        stubs.rules = [
          {
            _id: "r1",
            userId: "u1",
            enabled: true,
            name: "Zero conv",
            severity: "high",
            evaluateOn: "campaign",
            conditions: {
              operator: "AND",
              rules: [{ field: "spend", op: ">", value: 1 }],
            },
            action: { type: "pause" },
            attachments: [{ adAccountId: "act_42", campaignId: "camp_1" }],
          },
        ];
        stubs.fbUsers = [{ userId: "u1", accessToken: "tok-u1" }];
        stubs.auditByAccount.set("act_42", auditFixture());
        // Master toggle is OFF for u1.
        stubs.settingsByUser["u1"] = { enabled: false };

        await runUserRuleCycle({ dryRun: false });
        assert.equal(stubs.pauseCalls.length, 0);
        assert.equal(stubs.actionLogWrites.length, 0);
      },
    );

    await testAsync(
      "settings.dryRunGlobal=true forces dry-run even with cron live=true",
      async () => {
        resetStubs();
        stubs.rules = [
          {
            _id: "r1",
            userId: "u1",
            enabled: true,
            name: "Zero conv",
            severity: "high",
            evaluateOn: "campaign",
            conditions: {
              operator: "AND",
              rules: [{ field: "spend", op: ">", value: 1 }],
            },
            action: { type: "pause" },
            attachments: [{ adAccountId: "act_42", campaignId: "camp_1" }],
          },
        ];
        stubs.fbUsers = [{ userId: "u1", accessToken: "tok-u1" }];
        stubs.auditByAccount.set("act_42", auditFixture());
        // User wants dry-run only; cron asks for live writes.
        stubs.settingsByUser["u1"] = { enabled: true, dryRunGlobal: true };

        await runUserRuleCycle({ dryRun: false });
        // No live pause should fire — dry-run gate honored.
        assert.equal(stubs.pauseCalls.length, 0);
        // But the row IS written so the user can see what would have happened.
        assert.equal(stubs.actionLogWrites.length, 1);
        assert.equal(stubs.actionLogWrites[0].dryRun, true);
      },
    );

    await testAsync(
      "missing settings doc treated as legacy user (proceeds with defaults)",
      async () => {
        resetStubs();
        stubs.rules = [
          {
            _id: "r1",
            userId: "u1",
            enabled: true,
            name: "Zero conv",
            severity: "high",
            evaluateOn: "campaign",
            conditions: {
              operator: "AND",
              rules: [{ field: "spend", op: ">", value: 1 }],
            },
            action: { type: "pause" },
            attachments: [{ adAccountId: "act_42", campaignId: "camp_1" }],
          },
        ];
        stubs.fbUsers = [{ userId: "u1", accessToken: "tok-u1" }];
        stubs.auditByAccount.set("act_42", auditFixture());
        // Deliberately no entry in settingsByUser → null doc returned.

        await runUserRuleCycle({ dryRun: false });
        // Live write succeeds — the orchestrator does NOT lock out users
        // who never visited the Settings tab.
        assert.equal(stubs.pauseCalls.length, 1);
        assert.equal(stubs.actionLogWrites.length, 1);
      },
    );
  });

  await group("runUserRuleCycle — per-rule lookbackDays", async () => {
    const baseRule = (overrides) => ({
      _id: 'r-lb',
      userId: 'u1',
      enabled: true,
      name: 'rule',
      severity: 'high',
      evaluateOn: 'campaign',
      conditions: {
        operator: 'AND',
        rules: [{ field: 'spend', op: '>', value: 1 }],
      },
      action: { type: 'pause' },
      attachments: [{ adAccountId: 'act_42', campaignId: 'camp_1' }],
      ...overrides,
    });

    await testAsync(
      'rule with lookbackDays passes value through to runAuditForAccount',
      async () => {
        resetStubs();
        stubs.rules = [baseRule({ _id: 'r-7d', lookbackDays: 7 })];
        stubs.fbUsers = [{ userId: 'u1', accessToken: 'tok' }];
        stubs.auditByAccount.set('act_42', auditFixture());

        await runUserRuleCycle({ dryRun: false });
        assert.equal(stubs.auditCalls.length, 1);
        assert.equal(stubs.auditCalls[0].lookbackDays, 7);
        // prev window mirrors current so prev_* is comparable apples-to-apples.
        assert.equal(stubs.auditCalls[0].prevLookbackDays, 7);
      },
    );

    await testAsync(
      'two rules sharing same lookbackDays trigger one Meta fetch (dedupe)',
      async () => {
        resetStubs();
        stubs.rules = [
          baseRule({ _id: 'r-a', lookbackDays: 7 }),
          baseRule({ _id: 'r-b', lookbackDays: 7, name: 'rule b' }),
        ];
        stubs.fbUsers = [{ userId: 'u1', accessToken: 'tok' }];
        stubs.auditByAccount.set('act_42', auditFixture());

        await runUserRuleCycle({ dryRun: false });
        // Both rules share the 7-day window → one fetch, both evaluated.
        assert.equal(stubs.auditCalls.length, 1);
        assert.equal(stubs.auditCalls[0].lookbackDays, 7);
        // Both should have produced a log row (separate matches).
        assert.equal(stubs.actionLogWrites.length, 2);
      },
    );

    await testAsync(
      'rules with distinct lookbackDays trigger one Meta fetch each',
      async () => {
        resetStubs();
        stubs.rules = [
          baseRule({ _id: 'r-7d', lookbackDays: 7 }),
          baseRule({ _id: 'r-30d', lookbackDays: 30, name: 'rule 30' }),
        ];
        stubs.fbUsers = [{ userId: 'u1', accessToken: 'tok' }];
        stubs.auditByAccount.set('act_42', auditFixture());

        await runUserRuleCycle({ dryRun: false });
        assert.equal(stubs.auditCalls.length, 2);
        const windows = stubs.auditCalls
          .map((c) => c.lookbackDays)
          .sort((a, b) => a - b);
        assert.deepEqual(windows, [7, 30]);
      },
    );

    await testAsync(
      'rule without explicit lookbackDays defaults to 14',
      async () => {
        resetStubs();
        const r = baseRule({ _id: 'r-default' });
        delete r.lookbackDays;
        stubs.rules = [r];
        stubs.fbUsers = [{ userId: 'u1', accessToken: 'tok' }];
        stubs.auditByAccount.set('act_42', auditFixture());

        await runUserRuleCycle({ dryRun: false });
        assert.equal(stubs.auditCalls.length, 1);
        assert.equal(stubs.auditCalls[0].lookbackDays, 14);
      },
    );
  });

  // restore + report
  Module._load = originalLoad;
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) {
    console.log("\nFailures:");
    for (const f of FAILURES) {
      console.log(`  - ${f.name}: ${f.err.stack || f.err.message}`);
    }
    process.exit(1);
  }
})();
