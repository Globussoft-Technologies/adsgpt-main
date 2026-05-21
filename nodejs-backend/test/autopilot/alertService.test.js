#!/usr/bin/env node
/**
 * Tests for services/autopilot/alertService.js — the v3 multi-tenant
 * dispatcher. Covers the per-user email fan-out, the slice helper, the
 * alertOn chip filter (the sole trigger gate), throttling, and the
 * SendGrid error surface.
 *
 * Mocks `@sendgrid/mail`, `AutopilotSettings`, `redisClient`, and `axios`
 * via `Module._load` monkey-patch — same pattern as targetDiscovery.test.js.
 */

const assert = require("node:assert/strict");
const Module = require("node:module");

// ───────────────────────────────────────────────────────────────────────────
// test harness
// ───────────────────────────────────────────────────────────────────────────
let pass = 0;
let fail = 0;
const FAILURES = [];

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

// ───────────────────────────────────────────────────────────────────────────
// stubs
// ───────────────────────────────────────────────────────────────────────────
const stubs = {
  settingsByUser: {}, // { userId: { alerts: { emailTo, ... } } | null }
  actionLogRows: [], // [{ runId, userId, adAccountId, action, ... }]
  sgSends: [],
  sgFailNext: null, // when set, next send rejects with this
  axiosPosts: [],
  axiosFailNext: null,
  redisStore: new Map(),
  redisFailSet: false,
  apiKeySetCalls: [],
};

const originalLoad = Module._load;
Module._load = function patched(request, parent, isMain) {
  if (request === "@sendgrid/mail") {
    return {
      setApiKey: (k) => stubs.apiKeySetCalls.push(k),
      send: async (msg) => {
        if (stubs.sgFailNext) {
          const err = stubs.sgFailNext;
          stubs.sgFailNext = null;
          throw err;
        }
        stubs.sgSends.push(msg);
        return [{ statusCode: 202 }];
      },
    };
  }
  if (request.endsWith("Module/autopilot/autopilotSettings")) {
    return {
      find: () => ({ lean: async () => [] }),
      findOne: (q, _projection) => ({
        lean: async () => {
          const u = q && q.userId;
          return stubs.settingsByUser[u] === undefined
            ? null
            : stubs.settingsByUser[u];
        },
      }),
    };
  }
  if (request.endsWith("Module/autopilot/autopilotActionLog")) {
    return {
      // Mock the .find({runId, userId: {$in: [u, "SYSTEM"]}}).sort().lean() chain.
      find: (q) => ({
        sort: () => ({
          lean: async () => {
            const wantRunId = q && q.runId;
            const idIn = q && q.userId && q.userId.$in;
            return (stubs.actionLogRows || []).filter((row) => {
              if (wantRunId && row.runId !== wantRunId) return false;
              if (idIn && !idIn.includes(row.userId)) return false;
              return true;
            });
          },
        }),
      }),
    };
  }
  if (request.endsWith("db/redis")) {
    return {
      redisClient: {
        set: async (k, _v, _ex, _ttl, _nx) => {
          if (stubs.redisFailSet) throw new Error("redis-down");
          if (stubs.redisStore.has(k)) return null; // NX failure
          stubs.redisStore.set(k, true);
          return "OK";
        },
        get: async (k) => stubs.redisStore.get(k) || null,
        del: async (k) => stubs.redisStore.delete(k),
      },
    };
  }
  if (request === "axios") {
    return {
      post: async (url, body, opts) => {
        if (stubs.axiosFailNext) {
          const err = stubs.axiosFailNext;
          stubs.axiosFailNext = null;
          throw err;
        }
        stubs.axiosPosts.push({ url, body, opts });
        return { status: 200, data: "ok" };
      },
    };
  }
  if (request.endsWith("utils/logger")) {
    return { info: () => {}, warn: () => {}, error: () => {} };
  }
  return originalLoad.apply(this, arguments);
};

const alertService = require("../../services/autopilot/alertService");
const {
  notifyAutopilotCycle,
  sliceSummaryByUser,
  groupAccountsByUser,
  buildSlackPayload,
  buildPlainTextSummary,
  buildEmailHtml,
  groupActionsByAccountAndType,
  topFiringRules,
  formatKeyMetrics,
  parseEmailRecipients,
  MAX_EMAIL_RECIPIENTS,
} = alertService;

// ───────────────────────────────────────────────────────────────────────────
// helpers
// ───────────────────────────────────────────────────────────────────────────
function reset() {
  stubs.settingsByUser = {};
  stubs.actionLogRows = [];
  stubs.sgSends = [];
  stubs.sgFailNext = null;
  stubs.axiosPosts = [];
  stubs.axiosFailNext = null;
  stubs.redisStore = new Map();
  stubs.redisFailSet = false;
  stubs.apiKeySetCalls = [];
  // Reset memoized SendGrid client + AutopilotSettings cache by clearing
  // require cache on the alertService — we'd lose the helper exports though,
  // so instead toggle env vars.
  delete process.env.AUTOPILOT_ALERT_DRY_RUN_TOO;
  delete process.env.AUTOPILOT_SLACK_WEBHOOK_URL;
  delete process.env.AUTOPILOT_ALERT_THROTTLE_MINUTES;
  delete process.env.SENDGRID_API_KEY;
  delete process.env.AUTOPILOT_EMAIL_FROM;
}

function fakeAccount({ userId, adAccountId, name = 'A', ok = true } = {}) {
  return {
    adAccountId,
    name,
    ownerUserId: userId,
    ok,
    pause: { findings_count: 1, paused: 0, would_pause: 1, failed: 0 },
    resume: { resumed: 0, would_resume: 0, skipped: 0, failed: 0 },
  };
}

function fakeSummary(accounts, { dryRun = false } = {}) {
  return {
    runId: 'r-1',
    dryRun,
    durationMs: 1234,
    accounts,
  };
}

// SendGrid messages now use the explicit personalizations form (one
// personalization, every recipient inside its `to`). This helper hides
// that shape from the assertions so tests describe intent ("the email
// went to these addresses") rather than transport details.
function recipientsOf(msg) {
  if (!msg) return [];
  const toArr = msg.personalizations?.[0]?.to || [];
  return toArr.map((t) => (typeof t === "string" ? t : t.email));
}

// Seed one high-severity action-log row per (userId, adAccountId). The
// alertOn chip filter is the sole trigger; tests that assert "alert was
// sent" need at least one row matching the user's chips. Default user
// chips are ['high'], so a single high row unblocks the gate.
function seedHighRow({ userId, adAccountId, runId = 'r-1' } = {}) {
  stubs.actionLogRows.push({
    runId,
    userId,
    adAccountId,
    entityId: `e-${adAccountId}`,
    entityName: `entity-${adAccountId}`,
    level: 'ad',
    action: 'pause',
    ruleId: 'rule-seed',
    ruleSeverity: 'high',
    ruleMessage: 'seeded high-severity row for test',
    metricsSnapshot: { spend: 1000 },
    outcome: 'success',
    dryRun: false,
  });
}

// ───────────────────────────────────────────────────────────────────────────
// tests
// ───────────────────────────────────────────────────────────────────────────
(async () => {
  await group("sliceSummaryByUser", async () => {
    await testAsync("filters accounts to one userId", () => {
      const summary = fakeSummary([
        fakeAccount({ userId: "u1", adAccountId: "act_1" }),
        fakeAccount({ userId: "u2", adAccountId: "act_2" }),
        fakeAccount({ userId: "u1", adAccountId: "act_3" }),
      ]);
      const out = sliceSummaryByUser(summary, "u1");
      assert.equal(out.accounts.length, 2);
      assert.deepEqual(
        out.accounts.map((a) => a.adAccountId).sort(),
        ["act_1", "act_3"],
      );
      assert.equal(out.runId, "r-1"); // top-level fields preserved
      assert.equal(out.dryRun, false);
    });

    await testAsync("returns empty accounts for unknown userId", () => {
      const out = sliceSummaryByUser(fakeSummary([]), "ghost");
      assert.deepEqual(out.accounts, []);
    });
  });

  await group("groupAccountsByUser", async () => {
    await testAsync("groups accounts into a Map by ownerUserId", () => {
      const summary = fakeSummary([
        fakeAccount({ userId: "u1", adAccountId: "act_1" }),
        fakeAccount({ userId: "u2", adAccountId: "act_2" }),
        fakeAccount({ userId: "u1", adAccountId: "act_3" }),
      ]);
      const groups = groupAccountsByUser(summary);
      assert.equal(groups.size, 2);
      assert.equal(groups.get("u1").length, 2);
      assert.equal(groups.get("u2").length, 1);
    });

    await testAsync("drops accounts with no ownerUserId", () => {
      const summary = fakeSummary([
        { adAccountId: "act_1", ownerUserId: null }, // dropped
        fakeAccount({ userId: "u1", adAccountId: "act_2" }),
      ]);
      const groups = groupAccountsByUser(summary);
      assert.equal(groups.size, 1);
      assert.ok(groups.has("u1"));
    });
  });

  await group("notifyAutopilotCycle — alertOn chip filter", async () => {
    await testAsync(
      "dry-run cycles still alert (no dry-run gate) when chips match",
      async () => {
        reset();
        process.env.SENDGRID_API_KEY = "SG.test";
        stubs.settingsByUser["u1"] = {
          alerts: {
            slackWebhookUrl: "https://hooks.slack.com/x",
            emailTo: "u1@x.com",
            alertOn: ["high"],
          },
        };
        seedHighRow({ userId: "u1", adAccountId: "act_1" });
        const out = await notifyAutopilotCycle(
          fakeSummary([fakeAccount({ userId: "u1", adAccountId: "act_1" })], {
            dryRun: true,
          }),
        );
        assert.equal(stubs.axiosPosts.length, 1);
        assert.equal(stubs.sgSends.length, 1);
        const slack = out.slacks.find((s) => s.userId === "u1");
        const email = out.emails.find((e) => e.userId === "u1");
        assert.equal(slack.sent, true);
        assert.equal(email.sent, true);
      },
    );

    await testAsync(
      "alertOn=['high'] but only medium rows → skipped",
      async () => {
        reset();
        process.env.SENDGRID_API_KEY = "SG.test";
        stubs.settingsByUser["u1"] = {
          alerts: {
            slackWebhookUrl: "https://hooks.slack.com/x",
            emailTo: "u1@x.com",
            alertOn: ["high"],
          },
        };
        // Only a medium row — user's chips don't include medium.
        stubs.actionLogRows.push({
          runId: "r-1",
          userId: "u1",
          adAccountId: "act_1",
          entityId: "e1",
          level: "campaign",
          action: "alert_only",
          ruleId: "rule-medium",
          ruleSeverity: "medium",
          ruleMessage: "CTR fell",
          outcome: "success",
        });
        const out = await notifyAutopilotCycle(
          fakeSummary([fakeAccount({ userId: "u1", adAccountId: "act_1" })]),
        );
        assert.equal(stubs.axiosPosts.length, 0);
        assert.equal(stubs.sgSends.length, 0);
        assert.equal(out.slacks[0].reason, "no-matching-activity");
        assert.equal(out.emails[0].reason, "no-matching-activity");
      },
    );

    await testAsync("empty alertOn array → user opted out → skipped", async () => {
      reset();
      process.env.SENDGRID_API_KEY = "SG.test";
      stubs.settingsByUser["u1"] = {
        alerts: {
          slackWebhookUrl: "https://hooks.slack.com/x",
          emailTo: "u1@x.com",
          alertOn: [],
        },
      };
      seedHighRow({ userId: "u1", adAccountId: "act_1" });
      const out = await notifyAutopilotCycle(
        fakeSummary([fakeAccount({ userId: "u1", adAccountId: "act_1" })]),
      );
      assert.equal(stubs.axiosPosts.length, 0);
      assert.equal(stubs.sgSends.length, 0);
      assert.equal(out.slacks[0].reason, "no-matching-activity");
      assert.equal(out.emails[0].reason, "no-matching-activity");
    });

    await testAsync(
      "missing alertOn falls back to schema default ['high']",
      async () => {
        reset();
        process.env.SENDGRID_API_KEY = "SG.test";
        stubs.settingsByUser["u1"] = {
          alerts: {
            slackWebhookUrl: "https://hooks.slack.com/x",
            emailTo: "u1@x.com",
            // no alertOn key
          },
        };
        seedHighRow({ userId: "u1", adAccountId: "act_1" });
        const out = await notifyAutopilotCycle(
          fakeSummary([fakeAccount({ userId: "u1", adAccountId: "act_1" })]),
        );
        const slack = out.slacks.find((s) => s.userId === "u1");
        const email = out.emails.find((e) => e.userId === "u1");
        assert.equal(slack.sent, true);
        assert.equal(email.sent, true);
      },
    );

    await testAsync(
      "alertOn=['low','medium','high'] matches all severities",
      async () => {
        reset();
        stubs.settingsByUser["u1"] = {
          alerts: {
            slackWebhookUrl: "https://hooks.slack.com/x",
            alertOn: ["low", "medium", "high"],
          },
        };
        // A low-severity row would have been skipped under the old default
        // of ['critical']; here it should pass the chip filter.
        stubs.actionLogRows.push({
          runId: "r-1",
          userId: "u1",
          adAccountId: "act_1",
          entityId: "c1",
          level: "campaign",
          action: "alert_only",
          ruleId: "rule-low",
          ruleSeverity: "low",
          ruleMessage: "small audience",
          outcome: "success",
        });
        const out = await notifyAutopilotCycle(
          fakeSummary([fakeAccount({ userId: "u1", adAccountId: "act_1" })]),
        );
        assert.equal(stubs.axiosPosts.length, 1);
        assert.equal(out.slacks.find((s) => s.userId === "u1").sent, true);
      },
    );
  });

  await group("notifyAutopilotCycle — Slack per-user fan-out", async () => {
    await testAsync(
      "user with no slackWebhookUrl in settings → skipped (no-webhook)",
      async () => {
        reset();
        stubs.settingsByUser["u1"] = { alerts: { emailTo: "u1@x.com" } };
        seedHighRow({ userId: "u1", adAccountId: "act_1" });
        const out = await notifyAutopilotCycle(
          fakeSummary([fakeAccount({ userId: "u1", adAccountId: "act_1" })]),
        );
        assert.equal(stubs.axiosPosts.length, 0);
        assert.equal(out.slacks[0].reason, "no-webhook");
      },
    );

    await testAsync(
      "two users, both with webhooks → two Slack posts to different URLs",
      async () => {
        reset();
        stubs.settingsByUser["u1"] = {
          alerts: { slackWebhookUrl: "https://hooks.slack.com/u1" },
        };
        stubs.settingsByUser["u2"] = {
          alerts: { slackWebhookUrl: "https://hooks.slack.com/u2" },
        };
        seedHighRow({ userId: "u1", adAccountId: "act_1" });
        seedHighRow({ userId: "u2", adAccountId: "act_2" });
        await notifyAutopilotCycle(
          fakeSummary([
            fakeAccount({ userId: "u1", adAccountId: "act_1" }),
            fakeAccount({ userId: "u2", adAccountId: "act_2" }),
          ]),
        );
        assert.equal(stubs.axiosPosts.length, 2);
        const urls = stubs.axiosPosts.map((p) => p.url).sort();
        assert.deepEqual(urls, [
          "https://hooks.slack.com/u1",
          "https://hooks.slack.com/u2",
        ]);
      },
    );

    await testAsync(
      "each user's Slack payload contains only their own accounts (privacy)",
      async () => {
        reset();
        stubs.settingsByUser["u1"] = {
          alerts: { slackWebhookUrl: "https://hooks.slack.com/u1" },
        };
        stubs.settingsByUser["u2"] = {
          alerts: { slackWebhookUrl: "https://hooks.slack.com/u2" },
        };
        seedHighRow({ userId: "u1", adAccountId: "act_1" });
        seedHighRow({ userId: "u2", adAccountId: "act_2" });
        await notifyAutopilotCycle(
          fakeSummary([
            fakeAccount({
              userId: "u1",
              adAccountId: "act_1",
              name: "u1-acct",
            }),
            fakeAccount({
              userId: "u2",
              adAccountId: "act_2",
              name: "u2-acct",
            }),
          ]),
        );
        const u1Post = stubs.axiosPosts.find(
          (p) => p.url === "https://hooks.slack.com/u1",
        );
        const u2Post = stubs.axiosPosts.find(
          (p) => p.url === "https://hooks.slack.com/u2",
        );
        const u1Body = JSON.stringify(u1Post.body);
        const u2Body = JSON.stringify(u2Post.body);
        assert.match(u1Body, /u1-acct/);
        assert.doesNotMatch(u1Body, /u2-acct/);
        assert.match(u2Body, /u2-acct/);
        assert.doesNotMatch(u2Body, /u1-acct/);
      },
    );

    await testAsync("Slack throttle key is per-user", async () => {
      reset();
      stubs.settingsByUser["u1"] = {
        alerts: { slackWebhookUrl: "https://hooks.slack.com/u1" },
      };
      stubs.settingsByUser["u2"] = {
        alerts: { slackWebhookUrl: "https://hooks.slack.com/u2" },
      };
      // Pre-populate u1's slack throttle slot
      stubs.redisStore.set("autopilot:alert:user:u1:slack", true);
      seedHighRow({ userId: "u1", adAccountId: "act_1" });
      seedHighRow({ userId: "u2", adAccountId: "act_2" });
      const out = await notifyAutopilotCycle(
        fakeSummary([
          fakeAccount({ userId: "u1", adAccountId: "act_1" }),
          fakeAccount({ userId: "u2", adAccountId: "act_2" }),
        ]),
      );
      const u1 = out.slacks.find((s) => s.userId === "u1");
      const u2 = out.slacks.find((s) => s.userId === "u2");
      assert.equal(u1.throttled, true);
      assert.equal(u2.sent, true);
      assert.equal(stubs.axiosPosts.length, 1);
      // Verify the per-user throttle key shape.
      assert.ok(stubs.redisStore.has("autopilot:alert:user:u1:slack"));
      assert.ok(stubs.redisStore.has("autopilot:alert:user:u2:slack"));
    });

    await testAsync(
      "Slack post failure is captured per-user, doesn't block siblings",
      async () => {
        reset();
        stubs.settingsByUser["u1"] = {
          alerts: { slackWebhookUrl: "https://hooks.slack.com/u1" },
        };
        stubs.settingsByUser["u2"] = {
          alerts: { slackWebhookUrl: "https://hooks.slack.com/u2" },
        };
        stubs.axiosFailNext = new Error("network down");
        seedHighRow({ userId: "u1", adAccountId: "act_1" });
        seedHighRow({ userId: "u2", adAccountId: "act_2" });
        const out = await notifyAutopilotCycle(
          fakeSummary([
            fakeAccount({ userId: "u1", adAccountId: "act_1" }),
            fakeAccount({ userId: "u2", adAccountId: "act_2" }),
          ]),
        );
        const u1 = out.slacks.find((s) => s.userId === "u1");
        const u2 = out.slacks.find((s) => s.userId === "u2");
        assert.equal(u1.sent, false);
        assert.equal(u1.reason, "post-failed");
        assert.match(u1.error, /network down/);
        assert.equal(u2.sent, true);
      },
    );

    await testAsync(
      "Slack and email failures are independent for the same user",
      async () => {
        reset();
        process.env.SENDGRID_API_KEY = "SG.test";
        stubs.settingsByUser["u1"] = {
          alerts: {
            slackWebhookUrl: "https://hooks.slack.com/u1",
            emailTo: "u1@x.com",
          },
        };
        stubs.axiosFailNext = new Error("slack-down");
        seedHighRow({ userId: "u1", adAccountId: "act_1" });
        const out = await notifyAutopilotCycle(
          fakeSummary([fakeAccount({ userId: "u1", adAccountId: "act_1" })]),
        );
        const slack = out.slacks.find((s) => s.userId === "u1");
        const email = out.emails.find((e) => e.userId === "u1");
        assert.equal(slack.sent, false);
        assert.equal(email.sent, true); // email goes through despite Slack failure
      },
    );
  });

  await group("notifyAutopilotCycle — email per-user fan-out", async () => {
    await testAsync(
      "two opted-in users, both with emailTo → two SendGrid sends",
      async () => {
        reset();
        process.env.SENDGRID_API_KEY = "SG.test";
        stubs.settingsByUser["u1"] = { alerts: { emailTo: "u1@x.com" } };
        stubs.settingsByUser["u2"] = { alerts: { emailTo: "u2@y.com" } };
        seedHighRow({ userId: "u1", adAccountId: "act_1" });
        seedHighRow({ userId: "u2", adAccountId: "act_2" });
        const out = await notifyAutopilotCycle(
          fakeSummary([
            fakeAccount({ userId: "u1", adAccountId: "act_1" }),
            fakeAccount({ userId: "u2", adAccountId: "act_2" }),
          ]),
        );
        assert.equal(stubs.sgSends.length, 2);
        // Each SendGrid send has one personalization with the user's
        // recipient(s). For users with a single configured address it's
        // a single-element list.
        const tos = stubs.sgSends.map((m) => recipientsOf(m)[0]).sort();
        assert.deepEqual(tos, ["u1@x.com", "u2@y.com"]);
        // Both delivery records present
        assert.equal(out.emails.filter((e) => e.sent).length, 2);
      },
    );

    await testAsync(
      "user with no emailTo in settings → skipped (no-recipient)",
      async () => {
        reset();
        process.env.SENDGRID_API_KEY = "SG.test";
        stubs.settingsByUser["u1"] = { alerts: { emailTo: "" } };
        stubs.settingsByUser["u2"] = { alerts: { emailTo: "u2@y.com" } };
        seedHighRow({ userId: "u1", adAccountId: "act_1" });
        seedHighRow({ userId: "u2", adAccountId: "act_2" });
        const out = await notifyAutopilotCycle(
          fakeSummary([
            fakeAccount({ userId: "u1", adAccountId: "act_1" }),
            fakeAccount({ userId: "u2", adAccountId: "act_2" }),
          ]),
        );
        assert.equal(stubs.sgSends.length, 1);
        assert.deepEqual(recipientsOf(stubs.sgSends[0]), ["u2@y.com"]);
        const u1 = out.emails.find((e) => e.userId === "u1");
        assert.equal(u1.reason, "no-recipient");
      },
    );

    await testAsync(
      "user with no autopilotSettings doc → skipped (no-recipient)",
      async () => {
        reset();
        process.env.SENDGRID_API_KEY = "SG.test";
        // No settings for u1 — alertOn falls back to ['high'], so seed
        // a matching row to exercise the recipient-lookup path (otherwise
        // the chip filter trips first and reports no-matching-activity).
        seedHighRow({ userId: "u1", adAccountId: "act_1" });
        const out = await notifyAutopilotCycle(
          fakeSummary([
            fakeAccount({ userId: "u1", adAccountId: "act_1" }),
          ]),
        );
        assert.equal(stubs.sgSends.length, 0);
        assert.equal(out.emails[0].reason, "no-recipient");
      },
    );

    await testAsync(
      "each user gets a slice of the summary — not the whole thing",
      async () => {
        reset();
        process.env.SENDGRID_API_KEY = "SG.test";
        stubs.settingsByUser["u1"] = { alerts: { emailTo: "u1@x.com" } };
        stubs.settingsByUser["u2"] = { alerts: { emailTo: "u2@y.com" } };
        seedHighRow({ userId: "u1", adAccountId: "act_1" });
        seedHighRow({ userId: "u2", adAccountId: "act_2" });
        await notifyAutopilotCycle(
          fakeSummary([
            fakeAccount({
              userId: "u1",
              adAccountId: "act_1",
              name: "u1-acct",
            }),
            fakeAccount({
              userId: "u2",
              adAccountId: "act_2",
              name: "u2-acct",
            }),
          ]),
        );
        const sentToU1 = stubs.sgSends.find(
          (m) => recipientsOf(m)[0] === "u1@x.com",
        );
        const sentToU2 = stubs.sgSends.find(
          (m) => recipientsOf(m)[0] === "u2@y.com",
        );
        // Each tenant only sees their own account name in the body — privacy
        // boundary that the per-user slice is enforcing.
        assert.match(sentToU1.text, /u1-acct/);
        assert.doesNotMatch(sentToU1.text, /u2-acct/);
        assert.match(sentToU2.text, /u2-acct/);
        assert.doesNotMatch(sentToU2.text, /u1-acct/);
      },
    );

    await testAsync(
      "throttle key is per-user (one user's flood doesn't silence another)",
      async () => {
        reset();
        process.env.SENDGRID_API_KEY = "SG.test";
        stubs.settingsByUser["u1"] = { alerts: { emailTo: "u1@x.com" } };
        stubs.settingsByUser["u2"] = { alerts: { emailTo: "u2@y.com" } };
        // Pre-populate u1's throttle slot
        stubs.redisStore.set("autopilot:alert:user:u1:email", true);
        seedHighRow({ userId: "u1", adAccountId: "act_1" });
        seedHighRow({ userId: "u2", adAccountId: "act_2" });
        const out = await notifyAutopilotCycle(
          fakeSummary([
            fakeAccount({ userId: "u1", adAccountId: "act_1" }),
            fakeAccount({ userId: "u2", adAccountId: "act_2" }),
          ]),
        );
        // u1 throttled, u2 sent
        const u1 = out.emails.find((e) => e.userId === "u1");
        const u2 = out.emails.find((e) => e.userId === "u2");
        assert.equal(u1.throttled, true);
        assert.equal(u2.sent, true);
      },
    );

    // Note: "no SENDGRID_API_KEY → email-not-configured" is a startup-time
    // memoization path inside alertService that's hard to exercise once any
    // other test in this file has primed the cache. The behavior is implicit
    // in `sendEmail()`'s contract and exercised by integration testing.

    await testAsync(
      "SendGrid send failure is captured per-user, doesn't block siblings",
      async () => {
        reset();
        process.env.SENDGRID_API_KEY = "SG.test";
        stubs.settingsByUser["u1"] = { alerts: { emailTo: "u1@x.com" } };
        stubs.settingsByUser["u2"] = { alerts: { emailTo: "u2@y.com" } };
        // First send (u1) will fail, second (u2) succeeds.
        const sgErr = new Error("sg-fail");
        sgErr.response = {
          body: { errors: [{ message: "Invalid recipient" }] },
        };
        stubs.sgFailNext = sgErr;
        seedHighRow({ userId: "u1", adAccountId: "act_1" });
        seedHighRow({ userId: "u2", adAccountId: "act_2" });
        const out = await notifyAutopilotCycle(
          fakeSummary([
            fakeAccount({ userId: "u1", adAccountId: "act_1" }),
            fakeAccount({ userId: "u2", adAccountId: "act_2" }),
          ]),
        );
        const u1 = out.emails.find((e) => e.userId === "u1");
        const u2 = out.emails.find((e) => e.userId === "u2");
        assert.equal(u1.sent, false);
        assert.equal(u1.reason, "send-failed");
        assert.match(u1.error, /Invalid recipient/);
        assert.equal(u2.sent, true);
      },
    );

    await testAsync(
      "from-address comes from AUTOPILOT_EMAIL_FROM env, falls back to default",
      async () => {
        reset();
        process.env.SENDGRID_API_KEY = "SG.test";
        process.env.AUTOPILOT_EMAIL_FROM = "ops@adsgpt.io";
        stubs.settingsByUser["u1"] = { alerts: { emailTo: "u1@x.com" } };
        seedHighRow({ userId: "u1", adAccountId: "act_1" });
        await notifyAutopilotCycle(
          fakeSummary([fakeAccount({ userId: "u1", adAccountId: "act_1" })]),
        );
        assert.equal(stubs.sgSends[0].from, "ops@adsgpt.io");
      },
    );
  });

  await group("notifyAutopilotCycle — empty cycle", async () => {
    await testAsync(
      "no accounts at all → slacks/emails: [no-accounts]",
      async () => {
        reset();
        process.env.SENDGRID_API_KEY = "SG.test";
        const out = await notifyAutopilotCycle(fakeSummary([]));
        assert.equal(out.slacks.length, 1);
        assert.equal(out.slacks[0].reason, "no-accounts");
        assert.equal(out.emails.length, 1);
        assert.equal(out.emails[0].reason, "no-accounts");
      },
    );
  });

  // ───────────────────────────────────────────────────────────────────────
  // Enrichment helpers — pure functions on action-log rows
  // ───────────────────────────────────────────────────────────────────────
  await group("groupActionsByAccountAndType", async () => {
    await testAsync("buckets rows by account → action", () => {
      const rows = [
        { adAccountId: "act_1", action: "pause", entityId: "e1" },
        { adAccountId: "act_1", action: "pause", entityId: "e2" },
        { adAccountId: "act_1", action: "resume", entityId: "e3" },
        { adAccountId: "act_2", action: "pause", entityId: "e4" },
      ];
      const out = groupActionsByAccountAndType(rows);
      assert.equal(out.size, 2);
      assert.equal(out.get("act_1").get("pause").length, 2);
      assert.equal(out.get("act_1").get("resume").length, 1);
      assert.equal(out.get("act_2").get("pause").length, 1);
    });
    await testAsync("ignores rows missing adAccountId or action", () => {
      const out = groupActionsByAccountAndType([
        { adAccountId: "act_1", action: "pause", entityId: "e1" },
        { adAccountId: null, action: "pause", entityId: "e2" },
        { adAccountId: "act_1", action: null, entityId: "e3" },
      ]);
      assert.equal(out.size, 1);
      assert.equal(out.get("act_1").get("pause").length, 1);
    });
  });

  await group("topFiringRules", async () => {
    await testAsync("counts and sorts by frequency desc", () => {
      const rows = [
        { ruleId: "rule-A", ruleMessage: "zero conv", ruleSeverity: "high" },
        { ruleId: "rule-A", ruleMessage: "zero conv", ruleSeverity: "high" },
        { ruleId: "rule-B", ruleMessage: "high freq", ruleSeverity: "medium" },
      ];
      const top = topFiringRules(rows);
      assert.equal(top[0].ruleId, "rule-A");
      assert.equal(top[0].count, 2);
      assert.equal(top[1].ruleId, "rule-B");
      assert.equal(top[1].count, 1);
    });
    await testAsync("respects the limit param", () => {
      const rows = [
        { ruleId: "rule-A" },
        { ruleId: "rule-B" },
        { ruleId: "rule-C" },
      ];
      assert.equal(topFiringRules(rows, 2).length, 2);
    });
  });

  await group("parseEmailRecipients", async () => {
    await testAsync("empty / null → empty array", () => {
      assert.deepEqual(parseEmailRecipients(""), []);
      assert.deepEqual(parseEmailRecipients(null), []);
      assert.deepEqual(parseEmailRecipients(undefined), []);
    });
    await testAsync("single address passes through", () => {
      assert.deepEqual(parseEmailRecipients("alice@x.com"), ["alice@x.com"]);
    });
    await testAsync("splits on comma, trims whitespace, drops empties", () => {
      assert.deepEqual(
        parseEmailRecipients("alice@x.com, bob@x.com ,, charlie@x.com"),
        ["alice@x.com", "bob@x.com", "charlie@x.com"],
      );
    });
    await testAsync("dedupes case-insensitively, keeps first-seen casing", () => {
      // Stable first-seen order makes the email logs predictable, but
      // the lookup is lowercased so "Alice@X.com" + "alice@x.com" only
      // get one copy of the alert.
      assert.deepEqual(
        parseEmailRecipients("Alice@X.com, bob@x.com, alice@x.com"),
        ["Alice@X.com", "bob@x.com"],
      );
    });
    await testAsync(
      "clamps to MAX_EMAIL_RECIPIENTS (defense in depth vs. the validator cap)",
      () => {
        // The Joi validator at save-time enforces the 5 cap, but a doc
        // saved before the cap existed (or a buggy admin tool) might
        // still land 6+ addresses on a row. Parser clamps at the same
        // limit so we never send more than agreed.
        const six = [
          "a@x.com",
          "b@x.com",
          "c@x.com",
          "d@x.com",
          "e@x.com",
          "f@x.com",
        ].join(", ");
        const out = parseEmailRecipients(six);
        assert.equal(out.length, MAX_EMAIL_RECIPIENTS);
        assert.deepEqual(out.slice(0, 3), ["a@x.com", "b@x.com", "c@x.com"]);
      },
    );
  });

  await group("notifyAutopilotCycle — multi-email fan-out", async () => {
    await testAsync(
      "comma-separated emailTo sends a single email with array recipients",
      async () => {
        // The team-alerts story: a user types
        // "alice@x.com, bob@x.com, charlie@x.com" into the field. The
        // cycle should produce ONE SendGrid call per user with the
        // array — not three calls, and not a string SendGrid would
        // interpret as one address.
        reset();
        process.env.SENDGRID_API_KEY = "SG.test";
        stubs.settingsByUser["u1"] = {
          alerts: { emailTo: "alice@x.com, bob@x.com, charlie@x.com" },
        };
        seedHighRow({ userId: "u1", adAccountId: "act_1" });
        const out = await notifyAutopilotCycle(
          fakeSummary([fakeAccount({ userId: "u1", adAccountId: "act_1" })]),
        );
        assert.equal(stubs.sgSends.length, 1);
        assert.deepEqual(recipientsOf(stubs.sgSends[0]), [
          "alice@x.com",
          "bob@x.com",
          "charlie@x.com",
        ]);
        // Response echoes the resolved recipients so the test-email
        // controller (and Slack-style introspection) can show them.
        assert.deepEqual(out.emails[0].recipients, [
          "alice@x.com",
          "bob@x.com",
          "charlie@x.com",
        ]);
      },
    );

    await testAsync(
      "trimmed + deduped before send; whitespace / case duplicates collapse",
      async () => {
        reset();
        process.env.SENDGRID_API_KEY = "SG.test";
        stubs.settingsByUser["u1"] = {
          alerts: { emailTo: "  alice@x.com ,, bob@x.com, ALICE@X.com" },
        };
        seedHighRow({ userId: "u1", adAccountId: "act_1" });
        await notifyAutopilotCycle(
          fakeSummary([fakeAccount({ userId: "u1", adAccountId: "act_1" })]),
        );
        assert.equal(stubs.sgSends.length, 1);
        assert.deepEqual(recipientsOf(stubs.sgSends[0]), [
          "alice@x.com",
          "bob@x.com",
        ]);
      },
    );

    await testAsync(
      "emailTo of only whitespace/commas → no-recipient, no send",
      async () => {
        reset();
        process.env.SENDGRID_API_KEY = "SG.test";
        stubs.settingsByUser["u1"] = { alerts: { emailTo: "  , , , " } };
        seedHighRow({ userId: "u1", adAccountId: "act_1" });
        const out = await notifyAutopilotCycle(
          fakeSummary([fakeAccount({ userId: "u1", adAccountId: "act_1" })]),
        );
        assert.equal(stubs.sgSends.length, 0);
        assert.equal(out.emails[0].reason, "no-recipient");
      },
    );
  });

  await group("formatKeyMetrics", async () => {
    await testAsync("renders only non-null fields with friendly labels", () => {
      // Meta returns CTR already as a percentage value (e.g. 1.23 → 1.23%),
      // so the formatter must NOT multiply by ×100. Earlier behavior did
      // and produced absurdly high CTRs in alert emails (e.g. 38.70% from
      // a real-world 0.387% ad).
      const out = formatKeyMetrics({
        spend: 3200,
        ctr: 1.23,
        roas: 1.43,
        purchases: null,
      });
      assert.match(out, /spend.*3,?200/);
      assert.match(out, /ctr 1\.23%/);
      assert.match(out, /roas 1\.43/);
      assert.doesNotMatch(out, /purchases/);
    });
    await testAsync("includes cpi + installs when non-zero", () => {
      // App-promotion rules need CPI front-and-center; the previous
      // formatter omitted it entirely so the email rendered the rule
      // criterion's value nowhere.
      const out = formatKeyMetrics({
        spend: 3117.16,
        cpi: 49.81,
        installs: 11,
        ctr: 1.34,
        currency: "INR",
      });
      assert.match(out, /spend ₹3,117/);
      assert.match(out, /cpi ₹49\.81/);
      assert.match(out, /installs 11/);
    });
    await testAsync("skips zero values to avoid 'cpi 0' noise", () => {
      // Non-app campaigns have cpi=0 + installs=0 baked into the
      // snapshot. Rendering them as "cpi 0 · installs 0" is misleading
      // (looks like an app campaign with no installs).
      const out = formatKeyMetrics({
        spend: 500,
        cpi: 0,
        installs: 0,
        purchases: 2,
        cpa: 250,
        currency: "INR",
      });
      assert.doesNotMatch(out, /cpi/);
      assert.doesNotMatch(out, /installs/);
      assert.match(out, /purchases 2/);
      assert.match(out, /cpa ₹250/);
    });
    await testAsync("returns '' when snapshot is missing", () => {
      assert.equal(formatKeyMetrics(null), "");
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // Detailed payload contents
  // ───────────────────────────────────────────────────────────────────────
  await group("detailed alert payloads", async () => {
    await testAsync(
      "email HTML contains entity name, rule id, why, and metrics",
      async () => {
        reset();
        process.env.SENDGRID_API_KEY = "SG.test";
        stubs.settingsByUser["u1"] = { alerts: { emailTo: "u1@x.com" } };
        stubs.actionLogRows = [
          {
            runId: "r-1",
            userId: "u1",
            adAccountId: "act_1",
            entityId: "e1",
            entityName: "Hot offer ad",
            level: "ad",
            action: "pause",
            ruleId: "AUD-01",
            ruleMessage: "Zero purchases despite ₹3,200 spend",
            ruleSeverity: "high",
            metricsSnapshot: { spend: 3200, ctr: 0.012 },
            outcome: "success",
            dryRun: true,
          },
        ];
        await notifyAutopilotCycle(
          fakeSummary(
            [fakeAccount({ userId: "u1", adAccountId: "act_1", name: "A1" })],
            { dryRun: true },
          ),
        );
        const sent = stubs.sgSends[0];
        assert.ok(sent, "no email send was captured");
        assert.ok(sent.html, "html part missing");
        assert.match(sent.html, /Hot offer ad/);
        assert.match(sent.html, /AUD-01/);
        assert.match(sent.html, /Zero purchases/);
        assert.match(sent.html, /spend 3,?200/);
        // Plain-text fallback included.
        assert.ok(sent.text);
        assert.match(sent.text, /Hot offer ad/);
        assert.match(sent.text, /AUD-01/);
      },
    );

    await testAsync(
      "Slack payload contains per-action section with entity link",
      async () => {
        reset();
        stubs.settingsByUser["u1"] = {
          alerts: { slackWebhookUrl: "https://hooks.slack.com/u1" },
        };
        stubs.actionLogRows = [
          {
            runId: "r-1",
            userId: "u1",
            adAccountId: "act_1",
            entityId: "e1",
            entityName: "Hot offer ad",
            level: "ad",
            action: "pause",
            ruleId: "AUD-01",
            ruleMessage: "Zero purchases",
            ruleSeverity: "high",
            metricsSnapshot: { spend: 3200 },
            outcome: "success",
            dryRun: true,
          },
        ];
        await notifyAutopilotCycle(
          fakeSummary(
            [fakeAccount({ userId: "u1", adAccountId: "act_1" })],
            { dryRun: true },
          ),
        );
        const post = stubs.axiosPosts[0];
        assert.ok(post, "no slack post was captured");
        const body = JSON.stringify(post.body);
        assert.match(body, /Hot offer ad/);
        assert.match(body, /Top firing rules/);
        assert.match(body, /AUD-01/);
        assert.match(body, /Zero purchases/);
      },
    );
  });

  Module._load = originalLoad;
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) {
    for (const f of FAILURES) {
      console.log(`\n FAIL: ${f.name}`);
      console.log(f.err.stack || f.err.message);
    }
    process.exit(1);
  }
})();
