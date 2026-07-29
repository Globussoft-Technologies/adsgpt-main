#!/usr/bin/env node
/**
 * Tests for services/autopilot/targetDiscovery.js — the v3 multi-tenant
 * replacement for the old hardcoded `accounts` whitelist. Covers:
 *
 *   1. Returns [] when no users have AutopilotSettings.enabled=true.
 *   2. Skips opted-in users with no FacebookUsers row.
 *   3. Skips users whose token has expired.
 *   4. Skips users with empty stored token.
 *   5. Returns one tuple per (user, ad-account) pair on the happy path.
 *   6. Per-user failures don't block discovery for other users.
 *
 * Uses Mongoose's in-memory model proxying via a tiny manual stub: we
 * monkey-patch the module exports so we don't need a live Mongo or the
 * mongodb-memory-server dependency. The test file restores the originals
 * in a finally block.
 */

const assert = require("node:assert/strict");
const Module = require("node:module");

// ---------------------------------------------------------------------------
// Test harness — minimal pass/fail counter + group/test helpers.
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Stubs — monkey-patch require() so requiring the modules under test gives
// us back our test doubles. This must run BEFORE we require targetDiscovery.
// ---------------------------------------------------------------------------

// Stub state — each test resets these.
const stubs = {
  enabledSettings: [], // [{userId}]
  fbUsers: [], // [{userId, accessToken, tokenExpiresAt?}]
  adAccountsByUser: {}, // {userId: [{id, name, currency, timezone}]} — Meta API result
  adAccountsByToken: {}, // {decryptedToken: [{id, name, currency, timezone}]}
  activeAccessToken: null,
  redisCache: {}, // {key: stringValue}
  meCallLog: [], // record [{accessToken}]
  decryptCallLog: [],
  redisGetLog: [],
  redisSetLog: [],
};

// Mocks — register fake modules before requiring SUT.
const FAKE_FB_USERS = "../../Module/adPosting/facebookUsers";
const FAKE_AUTOPILOT_SETTINGS = "../../Module/autopilot/autopilotSettings";
const FAKE_REDIS = "../../db/redis";
const FAKE_CRYPTO = "../../utils/crypto";
const FAKE_BIZSDK = "facebook-nodejs-business-sdk";

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  // Reroute the SUT's deps to in-memory fakes. Match by suffix because
  // request paths are relative to the calling file.
  if (request.endsWith("Module/adPosting/facebookUsers")) {
    return {
      // SUT calls `FBUsers.find(q).lean()` — return a chainable.
      find: (q) => ({
        lean: async () => {
          const ids = (q && q.userId && q.userId.$in) || [];
          return stubs.fbUsers.filter((u) => ids.includes(u.userId));
        },
      }),
    };
  }
  if (request.endsWith("Module/autopilot/autopilotSettings")) {
    return {
      // SUT calls `find({enabled: true}, {...})` for cron path or
      // `find({userId: {$in: [...]}}, {...})` for the `opts.userIds` path.
      // Honour both shapes against the same stub.enabledSettings list.
      find: (q, _projection) => ({
        lean: async () => {
          if (q && q.userId && q.userId.$in) {
            const ids = q.userId.$in;
            return stubs.enabledSettings.filter((s) =>
              ids.includes(s.userId),
            );
          }
          if (q && q.enabled === true) {
            return stubs.enabledSettings.filter((s) => s.enabled !== false);
          }
          return stubs.enabledSettings;
        },
      }),
    };
  }
  if (request.endsWith("db/redis")) {
    return {
      redisClient: {
        get: async (k) => {
          stubs.redisGetLog.push(k);
          return stubs.redisCache[k] || null;
        },
        set: async (k, v) => {
          stubs.redisSetLog.push({ k, v });
          stubs.redisCache[k] = v;
          return "OK";
        },
      },
    };
  }
  if (request.endsWith("utils/crypto")) {
    return {
      decrypt: (s) => {
        stubs.decryptCallLog.push(s);
        // Identity decrypt for the test; real decrypt is AES-GCM.
        return s ? `decrypted:${s}` : s;
      },
    };
  }
  if (request === FAKE_BIZSDK) {
    return {
      FacebookAdsApi: {
        init: (accessToken) => {
          stubs.activeAccessToken = accessToken;
          return {};
        },
        setDefaultApi: () => {},
      },
      User: class {
        constructor(_id) {}
        async getAdAccounts(_fields) {
          // Find the most recent decrypt() call to figure out which user
          // we're answering for. Cheap but works for sequential calls.
          const last =
            stubs.decryptCallLog[stubs.decryptCallLog.length - 1] || "";
          const userId = Object.keys(stubs.adAccountsByUser).find(
            (uid) => last === stubs.fbUsers.find((u) => u.userId === uid)?.accessToken,
          );
          stubs.meCallLog.push({ userId });
          if (userId === "ERR_USER") {
            throw new Error("simulated meta /me/adaccounts failure");
          }
          const accs =
            stubs.adAccountsByToken[stubs.activeAccessToken] ||
            stubs.adAccountsByUser[userId] ||
            [];
          return accs.map((a) => ({
            id: a.id.startsWith("act_") ? a.id : `act_${a.id}`,
            name: a.name,
            account_status: 1,
            currency: a.currency || "INR",
            timezone_name: a.timezone || "Asia/Kolkata",
          }));
        }
      },
    };
  }
  // Silence the optional logger (real logger pulls in winston etc.).
  if (request.endsWith("utils/logger")) {
    return { info: () => {}, warn: () => {}, error: () => {} };
  }
  return originalLoad.apply(this, arguments);
};

// Now require the SUT — its `require()` calls hit our stubs.
const { discoverAutopilotTargets, _internals } = require("../../services/autopilot/targetDiscovery");

// Helper to reset stub state between tests.
function resetStubs() {
  stubs.enabledSettings = [];
  stubs.fbUsers = [];
  stubs.adAccountsByUser = {};
  stubs.adAccountsByToken = {};
  stubs.activeAccessToken = null;
  stubs.redisCache = {};
  stubs.meCallLog = [];
  stubs.decryptCallLog = [];
  stubs.redisGetLog = [];
  stubs.redisSetLog = [];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
(async () => {
  await group("discoverAutopilotTargets — opt-in & token gating", async () => {
    await testAsync("returns [] when no users have enabled=true", async () => {
      resetStubs();
      const out = await discoverAutopilotTargets();
      assert.deepEqual(out, []);
      assert.equal(stubs.meCallLog.length, 0);
    });

    await testAsync("skips opted-in users with no FacebookUsers row", async () => {
      resetStubs();
      stubs.enabledSettings = [{ userId: "u1", selectedAdAccountIds: ["111"] }];
      // No fbUsers row for u1.
      const out = await discoverAutopilotTargets();
      assert.deepEqual(out, []);
      assert.equal(stubs.meCallLog.length, 0);
    });

    await testAsync("skips users whose token has expired", async () => {
      resetStubs();
      stubs.enabledSettings = [{ userId: "u1", selectedAdAccountIds: ["111"] }];
      stubs.fbUsers = [
        {
          userId: "u1",
          accessToken: "tok-u1",
          tokenExpiresAt: new Date(Date.now() - 24 * 3600 * 1000), // yesterday
        },
      ];
      stubs.adAccountsByUser = { u1: [{ id: "111", name: "acct A" }] };
      const out = await discoverAutopilotTargets();
      assert.deepEqual(out, []);
      assert.equal(stubs.meCallLog.length, 0);
    });

    await testAsync("skips users with empty stored token", async () => {
      resetStubs();
      stubs.enabledSettings = [{ userId: "u1", selectedAdAccountIds: ["111"] }];
      stubs.fbUsers = [{ userId: "u1", accessToken: "" }];
      const out = await discoverAutopilotTargets();
      assert.deepEqual(out, []);
    });

    await testAsync(
      "skips opted-in users whose selectedAdAccountIds is empty (per-account opt-in default)",
      async () => {
        resetStubs();
        stubs.enabledSettings = [{ userId: "u1", selectedAdAccountIds: [] }];
        stubs.fbUsers = [{ userId: "u1", accessToken: "tok-u1" }];
        stubs.adAccountsByUser = {
          u1: [{ id: "111", name: "alpha" }, { id: "222", name: "beta" }],
        };
        const out = await discoverAutopilotTargets();
        assert.deepEqual(out, []);
        // Importantly: we should NOT have wasted a Meta call on a user who
        // hasn't picked any accounts.
        assert.equal(stubs.meCallLog.length, 0);
      },
    );

    await testAsync(
      "skips opted-in users whose settings doc lacks selectedAdAccountIds entirely",
      async () => {
        // Defensive — pre-existing rows from before this field was added
        // should be treated as "no accounts selected", never "all accounts."
        resetStubs();
        stubs.enabledSettings = [{ userId: "u1" }]; // no selectedAdAccountIds field
        stubs.fbUsers = [{ userId: "u1", accessToken: "tok-u1" }];
        stubs.adAccountsByUser = { u1: [{ id: "111", name: "alpha" }] };
        const out = await discoverAutopilotTargets();
        assert.deepEqual(out, []);
        assert.equal(stubs.meCallLog.length, 0);
      },
    );
  });

  await group("discoverAutopilotTargets — happy path & isolation", async () => {
    await testAsync(
      "returns one tuple per (user, ad-account) on happy path",
      async () => {
        resetStubs();
        stubs.enabledSettings = [
          { userId: "u1", selectedAdAccountIds: ["111", "222"] },
        ];
        stubs.fbUsers = [{ userId: "u1", accessToken: "tok-u1" }];
        stubs.adAccountsByUser = {
          u1: [
            { id: "111", name: "alpha" },
            { id: "222", name: "beta" },
          ],
        };
        const out = await discoverAutopilotTargets();
        assert.equal(out.length, 2);
        assert.equal(out[0].userId, "u1");
        assert.equal(out[0].adAccountId, "act_111");
        assert.equal(out[0].name, "alpha");
        assert.equal(out[0].accessToken, "decrypted:tok-u1");
        assert.equal(out[1].adAccountId, "act_222");
      },
    );

    await testAsync(
      "filters to ONLY the user's selectedAdAccountIds when /me/adaccounts returns more",
      async () => {
        resetStubs();
        stubs.enabledSettings = [
          { userId: "u1", selectedAdAccountIds: ["111"] }, // only one selected
        ];
        stubs.fbUsers = [{ userId: "u1", accessToken: "tok-u1" }];
        stubs.adAccountsByUser = {
          u1: [
            { id: "111", name: "alpha" },
            { id: "222", name: "beta" }, // user has access but didn't pick
            { id: "333", name: "gamma" },
          ],
        };
        const out = await discoverAutopilotTargets();
        assert.equal(out.length, 1);
        assert.equal(out[0].adAccountId, "act_111");
      },
    );

    await testAsync(
      "tolerates `act_`-prefixed entries in selectedAdAccountIds (legacy / paranoid clients)",
      async () => {
        resetStubs();
        stubs.enabledSettings = [
          { userId: "u1", selectedAdAccountIds: ["act_111", "222"] },
        ];
        stubs.fbUsers = [{ userId: "u1", accessToken: "tok-u1" }];
        stubs.adAccountsByUser = {
          u1: [
            { id: "111", name: "alpha" },
            { id: "222", name: "beta" },
          ],
        };
        const out = await discoverAutopilotTargets();
        assert.equal(out.length, 2);
      },
    );

    await testAsync(
      "target tuple carries severityFloor from per-user settings",
      async () => {
        resetStubs();
        stubs.enabledSettings = [
          {
            userId: "u1",
            selectedAdAccountIds: ["111"],
            severityFloor: "warning",
          },
          {
            userId: "u2",
            selectedAdAccountIds: ["222"],
            severityFloor: "opportunity",
          },
        ];
        stubs.fbUsers = [
          { userId: "u1", accessToken: "tok-u1" },
          { userId: "u2", accessToken: "tok-u2" },
        ];
        stubs.adAccountsByUser = {
          u1: [{ id: "111", name: "alpha" }],
          u2: [{ id: "222", name: "beta" }],
        };
        const out = await discoverAutopilotTargets();
        const t1 = out.find((t) => t.userId === "u1");
        const t2 = out.find((t) => t.userId === "u2");
        assert.equal(t1.severityFloor, "warning");
        assert.equal(t2.severityFloor, "opportunity");
      },
    );

    await testAsync(
      "target tuple carries thresholdOverrides for the matched account only",
      async () => {
        resetStubs();
        stubs.enabledSettings = [
          {
            userId: "u1",
            selectedAdAccountIds: ["111", "222"],
            perAccountOverrides: {
              act_111: { "AUD-01": { min_spend: 50000 } },
              // act_222 has no override — should get an empty {} on its target
            },
          },
        ];
        stubs.fbUsers = [{ userId: "u1", accessToken: "tok-u1" }];
        stubs.adAccountsByUser = {
          u1: [
            { id: "111", name: "alpha" },
            { id: "222", name: "beta" },
          ],
        };
        const out = await discoverAutopilotTargets();
        const t111 = out.find((t) => t.adAccountId === "act_111");
        const t222 = out.find((t) => t.adAccountId === "act_222");
        assert.deepEqual(t111.thresholdOverrides, {
          "AUD-01": { min_spend: 50000 },
        });
        // No override for 222 → empty map (matches the threshold pass-through
        // contract — empty {} is a no-op for getEffectiveThresholds).
        assert.deepEqual(t222.thresholdOverrides, {});
      },
    );

    await testAsync(
      "thresholdOverrides defaults to {} when settings doc has no perAccountOverrides field",
      async () => {
        resetStubs();
        stubs.enabledSettings = [
          { userId: "u1", selectedAdAccountIds: ["111"] },
        ];
        stubs.fbUsers = [{ userId: "u1", accessToken: "tok-u1" }];
        stubs.adAccountsByUser = { u1: [{ id: "111", name: "alpha" }] };
        const out = await discoverAutopilotTargets();
        assert.deepEqual(out[0].thresholdOverrides, {});
      },
    );

    await testAsync(
      "missing severityFloor in settings defaults to 'critical' on the target",
      async () => {
        resetStubs();
        stubs.enabledSettings = [
          {
            userId: "u1",
            selectedAdAccountIds: ["111"],
            // no severityFloor field
          },
        ];
        stubs.fbUsers = [{ userId: "u1", accessToken: "tok-u1" }];
        stubs.adAccountsByUser = { u1: [{ id: "111", name: "alpha" }] };
        const out = await discoverAutopilotTargets();
        assert.equal(out[0].severityFloor, "critical");
      },
    );

    await testAsync(
      "selected account that's no longer visible from /me/adaccounts is silently dropped",
      async () => {
        // User picked accounts X and Y, but Y was revoked / archived since.
        // The cron must NOT try to act on Y — only X comes back.
        resetStubs();
        stubs.enabledSettings = [
          { userId: "u1", selectedAdAccountIds: ["111", "999"] },
        ];
        stubs.fbUsers = [{ userId: "u1", accessToken: "tok-u1" }];
        stubs.adAccountsByUser = {
          u1: [{ id: "111", name: "alpha" }], // 999 is gone
        };
        const out = await discoverAutopilotTargets();
        assert.equal(out.length, 1);
        assert.equal(out[0].adAccountId, "act_111");
      },
    );

    await testAsync(
      "fans out across multiple users; per-user Meta-call failure isolates",
      async () => {
        resetStubs();
        stubs.enabledSettings = [
          { userId: "u_ok", selectedAdAccountIds: ["1"] },
          { userId: "ERR_USER", selectedAdAccountIds: ["2"] },
          { userId: "u_ok2", selectedAdAccountIds: ["3"] },
        ];
        stubs.fbUsers = [
          { userId: "u_ok", accessToken: "tok-u_ok" },
          { userId: "ERR_USER", accessToken: "tok-ERR_USER" },
          { userId: "u_ok2", accessToken: "tok-u_ok2" },
        ];
        stubs.adAccountsByUser = {
          u_ok: [{ id: "1", name: "ok-A" }],
          ERR_USER: [{ id: "2", name: "should-not-appear" }],
          u_ok2: [{ id: "3", name: "ok-B" }],
        };
        const out = await discoverAutopilotTargets();
        // Two tuples: ERR_USER's Meta call threw and was skipped.
        assert.equal(out.length, 2);
        assert.deepEqual(
          out.map((t) => `${t.userId}:${t.adAccountId}`).sort(),
          ["u_ok2:act_3", "u_ok:act_1"].sort(),
        );
      },
    );

    await testAsync("respects opts.userIds restriction", async () => {
      resetStubs();
      // u_settings_only would normally be picked by `enabled: true`. We
      // restrict to u_explicit; that user must ALSO have selected accounts.
      stubs.enabledSettings = [
        { userId: "u_settings_only", selectedAdAccountIds: ["5"] },
        { userId: "u_explicit", selectedAdAccountIds: ["9"] },
      ];
      stubs.fbUsers = [
        { userId: "u_explicit", accessToken: "tok-u_explicit" },
        { userId: "u_settings_only", accessToken: "tok-u_settings_only" },
      ];
      stubs.adAccountsByUser = {
        u_explicit: [{ id: "9", name: "explicit-pick" }],
        u_settings_only: [{ id: "5", name: "should-not-appear" }],
      };
      const out = await discoverAutopilotTargets({ userIds: ["u_explicit"] });
      assert.equal(out.length, 1);
      assert.equal(out[0].userId, "u_explicit");
    });

    await testAsync(
      "cron always fetches FRESH from Meta — ignores any cached entry",
      async () => {
        // Discovery used to short-circuit on a Redis cache hit, which
        // masked newly granted (or revoked) accounts and stale entity
        // status from rule evaluation for up to 2 hours. Cron + manual
        // cycles now skip the cache read; the cached value is irrelevant
        // for action decisions.
        resetStubs();
        stubs.enabledSettings = [
          { userId: "u1", selectedAdAccountIds: ["999"] },
        ];
        stubs.fbUsers = [{ userId: "u1", accessToken: "tok-u1" }];
        // Stale cache entry — different name + a phantom account that
        // doesn't exist on Meta anymore.
        stubs.redisCache["metaAdAccounts:u1"] = JSON.stringify({
          status: true,
          adAccounts: [
            { id: "999", name: "stale-cache-name" },
            { id: "888", name: "deleted-account" },
          ],
          count: 2,
        });
        // Fresh truth from Meta.
        stubs.adAccountsByUser = {
          u1: [{ id: "999", name: "fresh-from-meta" }],
        };
        const out = await discoverAutopilotTargets();
        assert.equal(out.length, 1);
        assert.equal(out[0].adAccountId, "act_999");
        // The Meta-returned name wins, not the cached name.
        assert.equal(out[0].name, "fresh-from-meta");
        // /me/adaccounts WAS called, despite the cache being populated.
        assert.equal(stubs.meCallLog.length, 1);
      },
    );

    await testAsync(
      "writes Meta result back to Redis with the same shape the HTTP endpoint stores",
      async () => {
        resetStubs();
        stubs.enabledSettings = [
          { userId: "u1", selectedAdAccountIds: ["1"] },
        ];
        stubs.fbUsers = [{ userId: "u1", accessToken: "tok-u1" }];
        stubs.adAccountsByUser = { u1: [{ id: "1", name: "alpha" }] };
        await discoverAutopilotTargets();
        const cached = stubs.redisCache["metaAdAccounts:u1"];
        assert.ok(cached, "redis cache key was not written");
        const parsed = JSON.parse(cached);
        assert.equal(parsed.status, true);
        assert.equal(parsed.count, 1);
        assert.equal(parsed.adAccounts[0].id, "1");
      },
    );

    await testAsync(
      "multiple Facebook identities resolve selected accounts with the newest visible token",
      async () => {
        resetStubs();
        stubs.enabledSettings = [
          { userId: "u1", selectedAdAccountIds: ["1", "2", "3"] },
        ];
        stubs.fbUsers = [
          {
            userId: "u1",
            facebookId: "fb-old",
            accessToken: "tok-old",
            updatedAt: new Date("2026-01-01"),
          },
          {
            userId: "u1",
            facebookId: "fb-new",
            accessToken: "tok-new",
            updatedAt: new Date("2026-02-01"),
          },
        ];
        stubs.adAccountsByToken = {
          "decrypted:tok-new": [
            { id: "1", name: "shared-new" },
            { id: "2", name: "new-only" },
          ],
          "decrypted:tok-old": [
            { id: "1", name: "shared-old" },
            { id: "3", name: "old-only" },
          ],
        };

        const out = await discoverAutopilotTargets();
        assert.equal(out.length, 3);
        const byId = new Map(out.map((row) => [row.adAccountId, row]));
        assert.equal(byId.get("act_1").facebookId, "fb-new");
        assert.equal(byId.get("act_1").accessToken, "decrypted:tok-new");
        assert.equal(byId.get("act_1").name, "shared-new");
        assert.equal(byId.get("act_2").facebookId, "fb-new");
        assert.equal(byId.get("act_3").facebookId, "fb-old");
      },
    );
  });

  await group("internals", async () => {
    await testAsync("ACCOUNTS_CACHE_TTL_SECONDS is 2 hours", () => {
      assert.equal(_internals.ACCOUNTS_CACHE_TTL_SECONDS, 7200);
    });
  });

  // ─── Restore Module._load and report ──────────────────────────────────
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
