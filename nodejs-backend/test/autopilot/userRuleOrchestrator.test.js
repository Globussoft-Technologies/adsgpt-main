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
  visibleAccountsByFacebookId: {},
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
  // ── resume-path stubs ──
  pausedLogRows: [],  // what the resume aggregate returns (prior autopilot pauses)
  flapHistory: [],    // pause/resume rows the flap counter reads
  entityMetaById: {}, // entityId → { updated_time, status, effective_status }
  metaReadFailNext: null,
  resumeFailNext: null,
};

function resetStubs() {
  stubs.rules = [];
  stubs.ruleUpdateLog = [];
  stubs.fbUsers = [];
  stubs.visibleAccountsByFacebookId = {};
  stubs.settingsByUser = {};
  stubs.redisStore = new Map();
  stubs.auditByAccount = new Map();
  stubs.auditByAccountAndLookback = new Map();
  stubs.auditCalls = [];
  stubs.pauseCalls = [];
  stubs.pauseFailNext = null;
  stubs.actionLogWrites = [];
  stubs.alertCalls = [];
  stubs.pausedLogRows = [];
  stubs.flapHistory = [];
  stubs.entityMetaById = {};
  stubs.metaReadFailNext = null;
  stubs.resumeFailNext = null;
  // Default to live-actions ON so tests don't accidentally hit the
  // dry-run gate. Tests that need it off override per-case.
  process.env.AUTOPILOT_LIVE_ACTIONS_ALLOWED = "true";
  delete process.env.AUTOPILOT_FLAP_COOLDOWN_STRIKES;
  delete process.env.AUTOPILOT_FLAP_COOLDOWN_DAYS;
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
      find: (q) => ({
        lean: async () =>
          stubs.fbUsers.filter((u) => u.userId === q.userId),
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
      // Resume path: "which entities did these rules really pause?" The
      // orchestrator's $match/$group is exercised for shape only — the
      // fixture stands in for the grouped result.
      aggregate: async (_pipeline) => stubs.pausedLogRows,
      // Resume path: flap history. Chainable to mirror
      // `.find(q, proj).sort().lean()`.
      find: (_q, _proj) => ({
        sort: () => ({
          lean: async () => stubs.flapHistory,
        }),
      }),
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
      runAuditForAccount: async ({
        adAccountId,
        accessToken,
        options = {},
      } = {}) => {
        // Record every call so tests can assert dedupe + per-lookback fetch.
        stubs.auditCalls.push({
          adAccountId,
          accessToken,
          lookbackDays: options.lookbackDays,
          prevLookbackDays: options.prevLookbackDays,
          lookbackPreset: options.lookbackPreset,
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
  if (
    request.endsWith("services/autopilot/targetDiscovery") ||
    request === "./targetDiscovery"
  ) {
    return {
      _internals: {
        listUserAdAccounts: async ({ facebookId }) =>
          stubs.visibleAccountsByFacebookId[facebookId] || [],
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
          const failer =
            payload && payload.status === "ACTIVE"
              ? "resumeFailNext"
              : "pauseFailNext";
          if (stubs[failer]) {
            const err = stubs[failer];
            stubs[failer] = null;
            throw err;
          }
          stubs.pauseCalls.push({
            level: this._level,
            entityId: this.id,
            payload,
          });
        }
        // Used by the resume path's manual-intervention guard
        // (autoResumeService.getEntityMeta).
        async read(_fields) {
          if (stubs.metaReadFailNext) {
            const err = stubs.metaReadFailNext;
            stubs.metaReadFailNext = null;
            throw err;
          }
          return { _data: stubs.entityMetaById[this.id] || {} };
        }
      };
    const FIELDS = {
      status: "status",
      updated_time: "updated_time",
      effective_status: "effective_status",
    };
    return {
      Campaign: Object.assign(SDKLevel("campaign"), { Fields: FIELDS }),
      AdSet: Object.assign(SDKLevel("adset"), { Fields: FIELDS }),
      Ad: Object.assign(SDKLevel("ad"), { Fields: FIELDS }),
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
  resolveEffectiveLookback,
} = orchestrator._internals;

// ─── pure helpers ───────────────────────────────────────────────────────────
group("resolveEffectiveLookback", () => {
  test("numeric lookbackDays passes through", () => {
    assert.equal(resolveEffectiveLookback({ lookbackDays: 7 }), 7);
    assert.equal(resolveEffectiveLookback({ lookbackDays: 30 }), 30);
  });

  test("missing lookbackDays defaults to 14", () => {
    assert.equal(resolveEffectiveLookback({}), 14);
    assert.equal(resolveEffectiveLookback(null), 14);
  });

  test("lookbackPreset='this_month' resolves to day-of-month from `now`", () => {
    // Pin `now` so the test isn't time-of-run dependent.
    const may18 = new Date(2026, 4, 18); // May 18, 2026 (month index 4)
    assert.equal(
      resolveEffectiveLookback({ lookbackPreset: "this_month" }, may18),
      18,
    );
    const jun1 = new Date(2026, 5, 1);
    assert.equal(
      resolveEffectiveLookback({ lookbackPreset: "this_month" }, jun1),
      1,
    );
  });

  test("this_month overrides a numeric lookbackDays on the same rule", () => {
    const may18 = new Date(2026, 4, 18);
    assert.equal(
      resolveEffectiveLookback(
        { lookbackDays: 7, lookbackPreset: "this_month" },
        may18,
      ),
      18,
    );
  });

  test("lookbackPreset='maximum' resolves to the lifetime fetch token", () => {
    assert.equal(
      resolveEffectiveLookback({
        lookbackDays: 7,
        lookbackPreset: "maximum",
      }),
      "maximum",
    );
  });

  test("unknown preset falls back to numeric lookbackDays", () => {
    assert.equal(
      resolveEffectiveLookback({
        lookbackDays: 7,
        lookbackPreset: "this_week",
      }),
      7,
    );
  });
});

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
    await testAsync(
      "newest expired connection falls back to an older valid identity",
      async () => {
        resetStubs();
        stubs.rules = [
          {
            _id: "rFallback",
            userId: "u1",
            enabled: true,
            name: "fallback",
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
            facebookId: "fb-new",
            accessToken: "tok-new",
            tokenExpiresAt: new Date(Date.now() - 60_000),
            updatedAt: new Date("2026-02-01"),
          },
          {
            userId: "u1",
            facebookId: "fb-old",
            accessToken: "tok-old",
            tokenExpiresAt: new Date(Date.now() + 60_000),
            updatedAt: new Date("2026-01-01"),
          },
        ];
        stubs.visibleAccountsByFacebookId = {
          "fb-old": [{ id: "42" }],
        };
        stubs.auditByAccount.set("act_42", auditFixture());

        const result = await runUserRuleCycle({ dryRun: false });
        assert.equal(result.accounts[0].ok, true);
        assert.equal(stubs.auditCalls.length, 1);
        assert.equal(
          stubs.auditCalls[0].accessToken,
          "decrypted:tok-old",
        );
        assert.equal(stubs.actionLogWrites.length, 1);
      },
    );
    await testAsync(
      "does not use another identity's token for an inaccessible account",
      async () => {
        resetStubs();
        stubs.rules = [
          {
            _id: "rInvisible",
            userId: "u1",
            enabled: true,
            name: "invisible",
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
          {
            userId: "u1",
            facebookId: "fb-one",
            accessToken: "tok-one",
            updatedAt: new Date("2026-02-01"),
          },
          {
            userId: "u1",
            facebookId: "fb-two",
            accessToken: "tok-two",
            updatedAt: new Date("2026-01-01"),
          },
        ];
        stubs.visibleAccountsByFacebookId = {
          "fb-one": [{ id: "42" }],
          "fb-two": [{ id: "43" }],
        };
        stubs.auditByAccount.set("act_99", auditFixture());

        const result = await runUserRuleCycle({ dryRun: false });
        assert.equal(stubs.auditCalls.length, 0);
        assert.equal(result.accounts.length, 1);
        assert.equal(result.accounts[0].ok, false);
        assert.match(
          result.accounts[0].error,
          /No connected Facebook account can access act_99/,
        );
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

    await testAsync(
      'maximum preset requests lifetime insights without a previous window',
      async () => {
        resetStubs();
        stubs.rules = [
          baseRule({
            _id: 'r-maximum',
            lookbackDays: 14,
            lookbackPreset: 'maximum',
          }),
        ];
        stubs.fbUsers = [{ userId: 'u1', accessToken: 'tok' }];
        stubs.auditByAccount.set('act_42', auditFixture());

        await runUserRuleCycle({ dryRun: false });
        assert.equal(stubs.auditCalls.length, 1);
        assert.equal(stubs.auditCalls[0].lookbackPreset, 'maximum');
        assert.equal(stubs.auditCalls[0].lookbackDays, undefined);
        assert.equal(stubs.auditCalls[0].prevLookbackDays, undefined);
      },
    );
  });

  // ── resume ────────────────────────────────────────────────────────────
  //
  // Shared setup: one rule that paused camp_1, and a fixture where camp_1 is
  // now PAUSED and no longer matches (spend below the rule's threshold), so
  // the default expectation is "resume fires".
  const resumeRule = (overrides = {}) => ({
    _id: "r1",
    userId: "u1",
    enabled: true,
    name: "Runaway spend",
    severity: "high",
    evaluateOn: "campaign",
    conditions: {
      operator: "AND",
      rules: [{ field: "spend", op: ">", value: 50000 }],
    },
    action: { type: "pause" },
    attachments: [{ adAccountId: "act_42", campaignId: "camp_1" }],
    ...overrides,
  });

  const recoveredFixture = (campaignOverrides = {}) => ({
    account_name: "Acct 42",
    entities: {
      campaigns: [
        {
          campaign_id: "camp_1",
          campaign_name: "Camp One",
          status: "PAUSED",
          spend: 1000, // under the rule's 50000 → no longer matches
          purchases: 3,
          ...campaignOverrides,
        },
      ],
      adsets: [],
      ads: [],
      allCampaignIds: ["camp_1"],
    },
  });

  const priorPause = (overrides = {}) => ({
    _id: { level: "campaign", entityId: "camp_1" },
    entityName: "Camp One",
    campaignId: "camp_1",
    lastPausedAt: new Date(Date.now() - 6 * 60 * 60 * 1000), // 6h ago
    ruleId: "r1",
    ...overrides,
  });

  // Default: Meta says the entity hasn't been touched since we paused it.
  const untouched = () => ({
    camp_1: {
      updated_time: new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString(),
      status: "PAUSED",
      effective_status: "PAUSED",
    },
  });

  async function arrangeResume({ rule, fixture, pausedRows, meta } = {}) {
    resetStubs();
    stubs.rules = [rule || resumeRule()];
    stubs.fbUsers = [{ userId: "u1", accessToken: "tok-u1" }];
    stubs.auditByAccount.set("act_42", fixture || recoveredFixture());
    stubs.pausedLogRows = pausedRows || [priorPause()];
    stubs.entityMetaById = meta || untouched();
  }

  const resumeCalls = () =>
    stubs.pauseCalls.filter((c) => c.payload && c.payload.status === "ACTIVE");
  const resumeRows = () =>
    stubs.actionLogWrites.filter((r) => r.action === "resume");

  await group("runUserRuleCycle — resume", async () => {
    await testAsync(
      "rule no longer matches → entity resumed, row written, counter bumped",
      async () => {
        await arrangeResume();

        const result = await runUserRuleCycle({ dryRun: false });

        assert.equal(resumeCalls().length, 1, "should resume exactly once");
        assert.equal(resumeCalls()[0].entityId, "camp_1");
        assert.equal(resumeCalls()[0].payload.status, "ACTIVE");

        assert.equal(resumeRows().length, 1);
        const row = resumeRows()[0];
        assert.equal(row.action, "resume");
        assert.equal(row.outcome, "success");
        assert.equal(row.dryRun, false);
        assert.equal(row.ruleId, "r1", "carries the rule that caused the pause");
        assert.equal(row.ruleSeverity, "high");
        assert.equal(row.pausedBy, "autopilot");
        assert.ok(row.actionPayload.priorPausedAt, "records the original pause");

        assert.equal(result.accounts[0].resume.resumed, 1);
      },
    );

    await testAsync(
      "rule still matches → stays paused, no Meta call, no log row",
      async () => {
        // spend back above the threshold: the rule fires again.
        await arrangeResume({ fixture: recoveredFixture({ spend: 90000 }) });

        const result = await runUserRuleCycle({ dryRun: false });

        assert.equal(resumeCalls().length, 0);
        assert.equal(resumeRows().length, 0, "unchanged verdict is not logged");
        assert.equal(result.accounts[0].resume.skipped, 1);
      },
    );

    await testAsync(
      "entity already ACTIVE → silently skipped (human got there first)",
      async () => {
        await arrangeResume({ fixture: recoveredFixture({ status: "ACTIVE" }) });

        const result = await runUserRuleCycle({ dryRun: false });

        assert.equal(resumeCalls().length, 0);
        assert.equal(resumeRows().length, 0);
        assert.equal(result.accounts[0].resume.skipped, 0, "not even counted");
      },
    );

    await testAsync(
      "manual intervention since the pause → stands down, logs the skip",
      async () => {
        await arrangeResume({
          meta: {
            camp_1: {
              // Touched AFTER we paused it — a human has been in here.
              updated_time: new Date(Date.now() - 60 * 1000).toISOString(),
              status: "PAUSED",
              effective_status: "PAUSED",
            },
          },
        });

        const result = await runUserRuleCycle({ dryRun: false });

        assert.equal(resumeCalls().length, 0, "must not fight a human");
        assert.equal(resumeRows().length, 1);
        assert.equal(resumeRows()[0].outcome, "skipped");
        assert.equal(resumeRows()[0].skipReason, "manual-intervention");
        assert.equal(result.accounts[0].resume.skipped, 1);
      },
    );

    await testAsync(
      "flap cooldown: 3 transitions in the window blocks the resume",
      async () => {
        await arrangeResume();
        // pause → resume → pause = 2 transitions … plus one more to hit 3.
        stubs.flapHistory = [
          { action: "pause", runAt: new Date(Date.now() - 96 * 3600e3) },
          { action: "resume", runAt: new Date(Date.now() - 72 * 3600e3) },
          { action: "pause", runAt: new Date(Date.now() - 48 * 3600e3) },
          { action: "resume", runAt: new Date(Date.now() - 24 * 3600e3) },
        ];

        const result = await runUserRuleCycle({ dryRun: false });

        assert.equal(resumeCalls().length, 0, "cooldown must hold it down");
        assert.equal(resumeRows().length, 0);
        assert.equal(result.accounts[0].resume.skipped, 1);
      },
    );

    await testAsync(
      "flap cooldown below the strike limit still resumes",
      async () => {
        await arrangeResume();
        stubs.flapHistory = [
          { action: "pause", runAt: new Date(Date.now() - 48 * 3600e3) },
          { action: "resume", runAt: new Date(Date.now() - 24 * 3600e3) },
        ]; // 1 transition — under the default 3

        await runUserRuleCycle({ dryRun: false });
        assert.equal(resumeCalls().length, 1);
      },
    );

    await testAsync(
      "AUTOPILOT_FLAP_COOLDOWN_STRIKES tunes the limit",
      async () => {
        await arrangeResume();
        process.env.AUTOPILOT_FLAP_COOLDOWN_STRIKES = "1";
        stubs.flapHistory = [
          { action: "pause", runAt: new Date(Date.now() - 48 * 3600e3) },
          { action: "resume", runAt: new Date(Date.now() - 24 * 3600e3) },
        ]; // 1 transition — now at the limit

        await runUserRuleCycle({ dryRun: false });
        assert.equal(resumeCalls().length, 0);
        delete process.env.AUTOPILOT_FLAP_COOLDOWN_STRIKES;
      },
    );

    await testAsync(
      "dry run logs the intent without calling Meta",
      async () => {
        await arrangeResume();

        const result = await runUserRuleCycle({ dryRun: true });

        assert.equal(resumeCalls().length, 0);
        assert.equal(resumeRows().length, 1);
        assert.equal(resumeRows()[0].dryRun, true);
        assert.equal(resumeRows()[0].outcome, "success");
        assert.equal(result.accounts[0].resume.would_resume, 1);
        assert.equal(result.accounts[0].resume.resumed, 0);
      },
    );

    await testAsync(
      "AUTOPILOT_LIVE_ACTIONS_ALLOWED=false forces resume to dry-run",
      async () => {
        await arrangeResume();
        process.env.AUTOPILOT_LIVE_ACTIONS_ALLOWED = "false";

        const result = await runUserRuleCycle({ dryRun: false });

        assert.equal(resumeCalls().length, 0);
        assert.equal(resumeRows()[0].dryRun, true);
        assert.equal(result.accounts[0].resume.would_resume, 1);
      },
    );

    await testAsync(
      "settings.autoResumeEnabled=false suppresses the pass entirely",
      async () => {
        await arrangeResume();
        stubs.settingsByUser.u1 = { autoResumeEnabled: false };

        const result = await runUserRuleCycle({ dryRun: false });

        assert.equal(resumeCalls().length, 0);
        assert.equal(resumeRows().length, 0);
        assert.equal(result.accounts[0].resume.resumed, 0);
      },
    );

    await testAsync(
      "missing settings doc still resumes (default is on)",
      async () => {
        await arrangeResume();
        stubs.settingsByUser.u1 = null;

        await runUserRuleCycle({ dryRun: false });
        assert.equal(resumeCalls().length, 1);
      },
    );

    await testAsync(
      "pause from a rule that's since been deleted or disabled → left alone",
      async () => {
        // A deleted/disabled rule never reaches the cycle, so its id simply
        // won't be in the run's rule set — the entity stays paused for a
        // human rather than being resumed by a rule that no longer exists.
        await arrangeResume({
          pausedRows: [priorPause({ ruleId: "r-deleted" })],
        });

        await runUserRuleCycle({ dryRun: false });
        assert.equal(resumeCalls().length, 0, "unknown rule id must not resume");
        assert.equal(resumeRows().length, 0);
      },
    );

    await testAsync(
      "entity absent from this window → no resume on a technicality",
      async () => {
        await arrangeResume();
        stubs.pausedLogRows = [
          priorPause({ _id: { level: "campaign", entityId: "camp_gone" } }),
        ];

        await runUserRuleCycle({ dryRun: false });
        assert.equal(resumeCalls().length, 0);
        assert.equal(resumeRows().length, 0);
      },
    );

    await testAsync(
      "Meta resume failure is logged as failed, cycle survives",
      async () => {
        await arrangeResume();
        stubs.resumeFailNext = new Error("Meta API down");

        const result = await runUserRuleCycle({ dryRun: false });

        assert.equal(resumeRows().length, 1);
        assert.equal(resumeRows()[0].outcome, "failed");
        assert.match(resumeRows()[0].error, /Meta API down/);
        assert.equal(result.accounts[0].resume.failed, 1);
        assert.equal(result.accounts[0].ok, true, "cycle must not abort");
      },
    );

    await testAsync(
      "updated_time read failure does not block the resume",
      async () => {
        await arrangeResume();
        stubs.metaReadFailNext = new Error("read blew up");

        await runUserRuleCycle({ dryRun: false });
        // No signal means no evidence of intervention — the log is trusted.
        assert.equal(resumeCalls().length, 1);
      },
    );

    await testAsync(
      "ad-level pause resumes at ad level with parent ids on the row",
      async () => {
        await arrangeResume({
          rule: resumeRule({ evaluateOn: "ad" }),
          fixture: {
            account_name: "Acct 42",
            entities: {
              campaigns: [
                { campaign_id: "camp_1", campaign_name: "Camp One", status: "ACTIVE" },
              ],
              adsets: [],
              ads: [
                {
                  ad_id: "ad_9",
                  ad_name: "Ad Nine",
                  campaign_id: "camp_1",
                  campaign_name: "Camp One",
                  adset_id: "as_3",
                  adset_name: "Set Three",
                  status: "PAUSED",
                  spend: 1000,
                },
              ],
              allCampaignIds: ["camp_1"],
            },
          },
          pausedRows: [
            priorPause({
              _id: { level: "ad", entityId: "ad_9" },
              entityName: "Ad Nine",
            }),
          ],
          meta: {
            ad_9: {
              updated_time: new Date(Date.now() - 7 * 3600e3).toISOString(),
              status: "PAUSED",
              effective_status: "PAUSED",
            },
          },
        });

        await runUserRuleCycle({ dryRun: false });

        assert.equal(resumeCalls().length, 1);
        assert.equal(resumeCalls()[0].level, "ad");
        assert.equal(resumeCalls()[0].entityId, "ad_9");
        const row = resumeRows()[0];
        assert.equal(row.level, "ad");
        assert.equal(row.entityId, "ad_9");
        assert.equal(row.campaignId, "camp_1");
        assert.equal(row.adsetId, "as_3");
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
