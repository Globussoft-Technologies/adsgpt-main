#!/usr/bin/env node
/**
 * Tests for services/autopilot/metaRetry.js — error classification.
 *
 * THE IMPORTANT TEST IS THE "no response" ONE. The SDK's axios `error.request`
 * branch (facebook-nodejs-business-sdk/src/exceptions.js) throws a
 * FacebookRequestError whose code, status AND headers are all null, because
 * FacebookRequestError never copies axios's own `code`. Every other branch in
 * classifyMetaError reads one of those three fields, so a request that got NO
 * ANSWER AT ALL — the single most retryable thing that can happen — used to
 * fall through to `permanent` and never retry.
 *
 * That shipped: on 2026-09-02 run adcc9da5, act_1424735519564081 was dropped
 * for an entire hourly cycle by exactly this path. The shape below is
 * reproduced from the SDK source, not invented, so it stays honest if the SDK
 * changes.
 */

const assert = require("node:assert/strict");

let pass = 0;
let fail = 0;
const FAILURES = [];

function record(name, err) {
  if (err) {
    fail += 1;
    FAILURES.push({ name, err });
    console.log(`  ✗ ${name}`);
    console.log(`      ${err.stack || err.message}`);
  } else {
    pass += 1;
    console.log(`  ✓ ${name}`);
  }
}
function test(name, fn) {
  try {
    const out = fn();
    if (out && typeof out.then === "function") {
      throw new Error(
        `"${name}" returned a promise — use testAsync, or it passes silently on failure`,
      );
    }
    record(name);
  } catch (err) {
    record(name, err);
  }
}
/** Async sibling of `test`. MUST be awaited, or a rejection is swallowed. */
async function testAsync(name, fn) {
  try {
    await fn();
    record(name);
  } catch (err) {
    record(name, err);
  }
}
async function group(label, fn) {
  console.log(`\n${label}`);
  return fn();
}

const {
  withRetry,
  classifyMetaError,
} = require("../../services/autopilot/metaRetry");

/**
 * Exactly what the SDK produces when axios reports `error.request` with no
 * `error.response`: message set, everything else null. See exceptions.js —
 * `constructErrorResponse` sets body/status/headers to null in that branch,
 * and the FacebookRequestError constructor assigns only
 * name/message/status/response/headers/method/url.
 */
function noResponseError() {
  const err = new Error("The request was made but no response was received");
  err.name = "FacebookRequestError";
  err.message = "The request was made but no response was received";
  err.status = null;
  err.response = null;
  err.headers = null;
  err.method = "GET";
  err.url = "https://graph.facebook.com/v23.0/act_1/insights";
  return err; // note: no `.code` — the axios code is discarded by the SDK
}

/** A real Meta refusal: always carries a response body. */
function metaError(code, extra = {}) {
  const err = new Error("meta says no");
  err.response = { code, ...extra };
  return err;
}

(async () => {
  await group("classifyMetaError — no response from Meta", () => {
    test("is transient, not permanent", () => {
      const c = classifyMetaError(noResponseError());
      assert.equal(c.kind, "transient");
      assert.equal(c.retryable, true);
    });

    test("carries a readable reason", () => {
      assert.equal(classifyMetaError(noResponseError()).reason, "no response from Meta");
    });

    test("does not ask for a wait — retry immediately", () => {
      assert.equal(classifyMetaError(noResponseError()).retryAfterMs, 0);
    });

    test("survives the null code/status/headers the SDK actually sets", () => {
      const err = noResponseError();
      assert.equal(err.code, undefined, "SDK does not set .code — fixture drifted");
      assert.equal(err.status, null);
      assert.equal(err.response, null);
      assert.equal(classifyMetaError(err).kind, "transient");
    });
  });

  await group("classifyMetaError — the branch must not over-reach", () => {
    test("a rate limit still classifies as rate-limit", () => {
      const c = classifyMetaError(metaError(4));
      assert.equal(c.kind, "rate-limit");
      assert.equal(c.retryable, false);
    });

    test("a BUC throttle still classifies as rate-limit", () => {
      assert.equal(classifyMetaError(metaError(80004)).kind, "rate-limit");
    });

    test("an invalid-parameter error is still permanent", () => {
      assert.equal(classifyMetaError(metaError(100)).kind, "permanent");
    });

    test("the SDK's OTHER null-everything message stays permanent", () => {
      // "Something happened in setting up the request" is a client-side bug,
      // not a network blip — retrying it is a guaranteed second failure.
      const err = new Error(
        "Something happened in setting up the request that triggered an Error",
      );
      err.status = null;
      err.response = null;
      assert.equal(classifyMetaError(err).kind, "permanent");
    });

    test("named network codes still classify via TRANSIENT_NETWORK", () => {
      const err = new Error("boom");
      err.code = "ECONNRESET";
      assert.equal(classifyMetaError(err).kind, "transient");
    });

    test("HTTP 5xx still transient", () => {
      const err = new Error("server error");
      err.status = 503;
      assert.equal(classifyMetaError(err).kind, "transient");
    });
  });

  await group("withRetry — a no-response failure gets a second attempt", async () => {
    await testAsync("retries once and succeeds", async () => {
      let calls = 0;
      const out = await withRetry(
        () => {
          calls += 1;
          if (calls === 1) throw noResponseError();
          return "ok";
        },
        { delayMs: 1 },
      );
      assert.equal(out, "ok");
      assert.equal(calls, 2, "should have made exactly two attempts");
    });

    await testAsync("gives up after the configured attempts", async () => {
      let calls = 0;
      await assert.rejects(
        () =>
          withRetry(
            () => {
              calls += 1;
              throw noResponseError();
            },
            { delayMs: 1 },
          ),
        /no response was received/,
      );
      assert.equal(calls, 2, "one retry, not an escalating ladder");
    });

    await testAsync("a rate limit is still never retried inline", async () => {
      let calls = 0;
      await assert.rejects(() =>
        withRetry(
          () => {
            calls += 1;
            throw metaError(4);
          },
          { delayMs: 1 },
        ),
      );
      assert.equal(calls, 1, "rate limits must not be retried inside a tick");
    });
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) {
    for (const f of FAILURES) {
      console.log(`\n FAIL: ${f.name}`);
      console.log(f.err.stack || f.err.message);
    }
    process.exit(1);
  }
})();
