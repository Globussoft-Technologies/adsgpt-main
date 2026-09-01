#!/usr/bin/env node
/**
 * Tests for services/meta/attachUsageTracking.js and metaUsageContext.js —
 * the global wrap that makes every Meta SDK instance report what it cost.
 *
 * The failures worth catching here are the silent ones. A double-wrap
 * inflates every number and looks like a traffic spike. A missing opt-out
 * lets the global wrapper eat `response.headers` before the audit's own
 * wrapper reads them, which switches off self-throttling without any error.
 * A context that leaks between requests misattributes traffic to whoever
 * happened to be first. None of these throw.
 */

const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");

// ───────────────────────────────────────────────────────────────────────────
// test harness
// ───────────────────────────────────────────────────────────────────────────
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
async function testAsync(name, fn) {
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
}
function group(label, fn) {
  console.log(`\n${label}`);
  return fn();
}

// ───────────────────────────────────────────────────────────────────────────
// mocks — the recorder is replaced so we can read what was attributed
// ───────────────────────────────────────────────────────────────────────────
const RECORDER_PATH = path.join(
  __dirname,
  "..",
  "..",
  "services",
  "meta",
  "metaUsageRecorder.js",
);

const recorderMock = {
  calls: [],
  failures: [],
  headers: [],
  recordCall(ctx) {
    this.calls.push({ ...ctx });
  },
  recordFailure(ctx, opts) {
    this.failures.push({ ...ctx, ...opts });
  },
  recordHeaders(ctx, buckets) {
    this.headers.push({ ctx: { ...ctx }, buckets });
  },
  reset() {
    this.calls = [];
    this.failures = [];
    this.headers = [];
  },
};

const loggerMock = { warn() {}, info() {}, error() {} };

const originalLoad = Module._load;
Module._load = function patched(request, parent, isMain) {
  const resolved = (() => {
    try {
      return Module._resolveFilename(request, parent, isMain);
    } catch {
      return null;
    }
  })();
  if (resolved === RECORDER_PATH) {
    return { sharedUsageRecorder: recorderMock, MetaUsageRecorder: class {} };
  }
  if (request.endsWith("utils/logger") || request.endsWith("/logger")) {
    return loggerMock;
  }
  return originalLoad.apply(this, arguments);
};

const {
  attachUsageTracking,
  installGlobalUsageTracking,
  optOutOfGlobalTracking,
  _internals,
} = require("../../services/meta/attachUsageTracking");
const {
  runWithUsageContext,
  currentUsageContext,
  metaUsageContextMiddleware,
  _internals: ctxInternals,
} = require("../../services/meta/metaUsageContext");

/**
 * A stand-in for a FacebookAdsApi instance: records the calls it received and
 * returns whatever the test queued, including the `headers` key the real SDK
 * bolts onto the body when `setShowHeader(true)` is on.
 */
function fakeApi({ response = {}, throws = null } = {}) {
  return {
    received: [],
    showHeader: false,
    setShowHeader(v) {
      this.showHeader = v;
    },
    async call(...args) {
      this.received.push(args);
      if (throws) throw throws;
      return response;
    },
  };
}

(async () => {
  group("account extraction", () => {
    const ex = _internals.extractAccountId;

    test("finds act_<id> in an SDK path array", () => {
      assert.equal(ex(["act_1234", "insights"]), "1234");
    });

    test("finds act_<id> in a full paging URL", () => {
      // The SDK hands back an absolute URL when following `paging.next`, so
      // an extractor that only understood arrays would lose every page
      // after the first — i.e. exactly the expensive calls.
      assert.equal(
        ex("https://graph.facebook.com/v23.0/act_5678/ads?after=XYZ"),
        "5678",
      );
    });

    test("returns null for calls that are not account-scoped", () => {
      assert.equal(ex(["me", "accounts"]), null);
      assert.equal(ex(null), null);
      assert.equal(ex(undefined), null);
    });
  });

  group("source resolution", () => {
    const src = ctxInternals.sourceForPath;

    test("maps product surfaces to their names", () => {
      assert.equal(src("/meta-ads/campaigns"), "ads-manager");
      assert.equal(src("/ad-posting/launch"), "ad-posting");
      assert.equal(src("/admin/users"), "admin");
    });

    test("a longer prefix wins over a shorter one that also matches", () => {
      // `/partner-api/v1/meta-ads` must not be read as `/meta-ads`, and
      // `/meta-ads/autopilot` must not be read as plain Ads Manager — those
      // are the two splits the whole exercise is about.
      assert.equal(src("/partner-api/v1/meta-ads/campaigns"), "partner-api");
      assert.equal(src("/meta-ads/autopilot/rules"), "autopilot");
    });

    test("an unmapped route is labelled, not dropped", () => {
      assert.equal(src("/something-new"), "http");
      assert.equal(src(""), "http");
    });

    test("a prefix only matches on a segment boundary", () => {
      assert.equal(src("/meta-ads-something-else"), "http");
    });
  });

  await group("wrapping one instance", async () => {
    await testAsync("records a call with the account from the path", async () => {
      recorderMock.reset();
      const api = fakeApi();
      attachUsageTracking(api, { accessToken: "tok" });
      await runWithUsageContext({ userId: "u1", source: "ads-manager" }, () =>
        api.call("GET", ["act_777", "campaigns"]),
      );
      assert.equal(recorderMock.calls.length, 1);
      assert.deepEqual(recorderMock.calls[0], {
        userId: "u1",
        adAccountId: "777",
        source: "ads-manager",
      });
    });

    await testAsync("turns on setShowHeader so meters are readable", async () => {
      const api = fakeApi();
      attachUsageTracking(api, { accessToken: "tok" });
      assert.equal(api.showHeader, true);
    });

    await testAsync("strips the headers key back off the response", async () => {
      // Downstream callers must see the shape they saw before this file
      // existed — `setShowHeader(true)` bolts `headers` onto the BODY.
      recorderMock.reset();
      const response = { data: [1, 2], headers: { "x-app-usage": "{}" } };
      const api = fakeApi({ response });
      attachUsageTracking(api, { accessToken: "tok" });
      const out = await api.call("GET", ["act_1", "ads"]);
      assert.equal("headers" in out, false, "headers must be removed");
      assert.deepEqual(out.data, [1, 2]);
    });

    await testAsync("wrapping twice does not double-count", async () => {
      recorderMock.reset();
      const api = fakeApi();
      attachUsageTracking(api, { accessToken: "tok" });
      attachUsageTracking(api, { accessToken: "tok" });
      await api.call("GET", ["act_1", "ads"]);
      assert.equal(recorderMock.calls.length, 1);
    });

    await testAsync("a failed call is counted and rethrown unchanged", async () => {
      recorderMock.reset();
      const boom = new Error("nope");
      const api = fakeApi({ throws: boom });
      attachUsageTracking(api, { accessToken: "tok" });
      await assert.rejects(() => api.call("GET", ["act_2", "ads"]), /nope/);
      assert.equal(recorderMock.failures.length, 1);
      assert.equal(recorderMock.failures[0].adAccountId, "2");
    });

    await testAsync("a rate-limit failure is flagged as throttled", async () => {
      recorderMock.reset();
      const err = new Error("limit");
      err.response = { code: 4 }; // application request limit reached
      const api = fakeApi({ throws: err });
      attachUsageTracking(api, { accessToken: "tok" });
      await assert.rejects(() => api.call("GET", ["act_3", "ads"]));
      assert.equal(recorderMock.failures[0].throttled, true);
    });

    await testAsync("an ordinary error is NOT flagged as throttled", async () => {
      // A bad parameter says nothing about remaining quota; counting it as a
      // throttle would make the capacity signal meaningless.
      recorderMock.reset();
      const err = new Error("bad param");
      err.response = { code: 100 };
      const api = fakeApi({ throws: err });
      attachUsageTracking(api, { accessToken: "tok" });
      await assert.rejects(() => api.call("GET", ["act_3", "ads"]));
      assert.equal(recorderMock.failures[0].throttled, false);
    });

    await testAsync("without a context, traffic is unattributed but counted", async () => {
      recorderMock.reset();
      const api = fakeApi();
      attachUsageTracking(api, { accessToken: "tok" });
      await api.call("GET", ["act_9", "ads"]);
      assert.equal(recorderMock.calls[0].userId, null);
      assert.equal(recorderMock.calls[0].source, "unknown");
      assert.equal(recorderMock.calls[0].adAccountId, "9");
    });

    await testAsync("identity is resolved per call, not captured at wrap time", async () => {
      // One api instance is reused across requests. Binding the first
      // caller's identity would misattribute everyone after them.
      recorderMock.reset();
      const api = fakeApi();
      attachUsageTracking(api, { accessToken: "tok" });
      await runWithUsageContext({ userId: "first", source: "ads-manager" }, () =>
        api.call("GET", ["act_1", "ads"]),
      );
      await runWithUsageContext({ userId: "second", source: "autopilot" }, () =>
        api.call("GET", ["act_1", "ads"]),
      );
      assert.equal(recorderMock.calls[0].userId, "first");
      assert.equal(recorderMock.calls[1].userId, "second");
      assert.equal(recorderMock.calls[1].source, "autopilot");
    });
  });

  await group("opt-out", async () => {
    await testAsync("an opted-out instance records nothing", async () => {
      recorderMock.reset();
      const api = fakeApi();
      attachUsageTracking(api, { accessToken: "tok" });
      optOutOfGlobalTracking(api);
      await api.call("GET", ["act_1", "ads"]);
      assert.equal(recorderMock.calls.length, 0);
      assert.equal(recorderMock.headers.length, 0);
    });

    await testAsync("an opted-out instance keeps its response headers", async () => {
      // The audit's own wrapper reads these to self-throttle. If the global
      // wrapper consumed them first, throttling would silently stop working
      // and nothing would report an error.
      const response = { data: 1, headers: { "x-app-usage": "{}" } };
      const api = fakeApi({ response });
      attachUsageTracking(api, { accessToken: "tok" });
      optOutOfGlobalTracking(api);
      const out = await api.call("GET", ["act_1", "ads"]);
      assert.ok(out.headers, "headers must survive for the owning wrapper");
    });

    await testAsync("opting out still forwards arguments untouched", async () => {
      const api = fakeApi();
      attachUsageTracking(api, { accessToken: "tok" });
      optOutOfGlobalTracking(api);
      await api.call("POST", ["act_1", "ads"], { name: "x" });
      assert.deepEqual(api.received[0], ["POST", ["act_1", "ads"], { name: "x" }]);
    });
  });

  await group("global install", async () => {
    await testAsync("patches init so every instance is born tracked", async () => {
      recorderMock.reset();
      const made = [];
      const sdk = {
        FacebookAdsApi: {
          init(token) {
            const api = fakeApi();
            api.token = token;
            made.push(api);
            return api;
          },
        },
      };
      assert.equal(installGlobalUsageTracking(sdk, {}), true);

      const api = sdk.FacebookAdsApi.init("tok");
      await runWithUsageContext({ userId: "u9", source: "ad-posting" }, () =>
        api.call("GET", ["act_42", "insights"]),
      );
      assert.equal(recorderMock.calls.length, 1);
      assert.equal(recorderMock.calls[0].adAccountId, "42");
      assert.equal(recorderMock.calls[0].source, "ad-posting");
    });

    await testAsync("init still returns a working api and its token", async () => {
      const sdk = {
        FacebookAdsApi: {
          init(token) {
            const api = fakeApi({ response: { ok: true } });
            api.token = token;
            return api;
          },
        },
      };
      installGlobalUsageTracking(sdk, {});
      const api = sdk.FacebookAdsApi.init("secret");
      assert.equal(api.token, "secret");
      assert.deepEqual(await api.call("GET", ["me"]), { ok: true });
    });

    test("installing twice is a no-op", () => {
      const sdk = { FacebookAdsApi: { init: () => fakeApi() } };
      assert.equal(installGlobalUsageTracking(sdk, {}), true);
      assert.equal(installGlobalUsageTracking(sdk, {}), false);
    });

    test("tolerates an sdk without the expected shape", () => {
      assert.equal(installGlobalUsageTracking(null, {}), false);
      assert.equal(installGlobalUsageTracking({}, {}), false);
      assert.equal(installGlobalUsageTracking({ FacebookAdsApi: {} }, {}), false);
    });

    test("META_USAGE_TRACKING=off installs nothing at all", () => {
      // With the flag off nothing is wrapped, so setShowHeader is never
      // turned on and the SDK behaves exactly as it did before.
      const prev = process.env.META_USAGE_TRACKING;
      process.env.META_USAGE_TRACKING = "off";
      try {
        const sdk = { FacebookAdsApi: { init: () => fakeApi() } };
        assert.equal(installGlobalUsageTracking(sdk, {}), false);
        const api = sdk.FacebookAdsApi.init("tok");
        assert.equal(api.showHeader, false);
      } finally {
        if (prev === undefined) delete process.env.META_USAGE_TRACKING;
        else process.env.META_USAGE_TRACKING = prev;
      }
    });
  });

  await group("request context", async () => {
    await testAsync("middleware labels a request from req.user and the path", async () => {
      let seen = null;
      const req = { user: { user_id: "GPT-435" }, originalUrl: "/meta-ads/campaigns" };
      await new Promise((resolve) => {
        metaUsageContextMiddleware(req, {}, () => {
          seen = currentUsageContext();
          resolve();
        });
      });
      assert.equal(seen.userId, "GPT-435");
      assert.equal(seen.source, "ads-manager");
      assert.equal(seen.throttle, false, "interactive requests must not wait");
    });

    await testAsync("an unauthenticated request is still labelled", async () => {
      let seen = null;
      const req = { originalUrl: "/partner-api/v1/meta-ads/x" };
      await new Promise((resolve) => {
        metaUsageContextMiddleware(req, {}, () => {
          seen = currentUsageContext();
          resolve();
        });
      });
      assert.equal(seen.userId, null);
      assert.equal(seen.source, "partner-api");
    });

    await testAsync("context does not leak between concurrent operations", async () => {
      // Two overlapping requests must not see each other's identity.
      const seen = [];
      await Promise.all([
        runWithUsageContext({ userId: "a", source: "ads-manager" }, async () => {
          await new Promise((r) => setTimeout(r, 10));
          seen.push(currentUsageContext().userId);
        }),
        runWithUsageContext({ userId: "b", source: "autopilot" }, async () => {
          seen.push(currentUsageContext().userId);
        }),
      ]);
      assert.deepEqual(seen.sort(), ["a", "b"]);
    });

    test("context outside any run() is empty, not undefined", () => {
      assert.deepEqual(currentUsageContext(), {});
    });
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
