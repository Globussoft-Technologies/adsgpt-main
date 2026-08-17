#!/usr/bin/env node
/**
 * Tests for services/adFactory/autofillClient.js — the transport wrapper over
 * the Python autofill endpoint.
 *
 * No network: both DNS and the HTTP POST are injected. What's under test is
 * the error taxonomy and the retry rule, because those decide what the user
 * sees when a scrape goes wrong — and whether we burn another 60 seconds of
 * their patience retrying something that can never succeed.
 *
 * Run:  node test/adFactory/autofillClient.test.js
 */

const assert = require("node:assert/strict");

const {
  fetchAutofill,
  AutofillError,
  AUTOFILL_ERROR_CODES: CODES,
} = require("../../services/adFactory/autofillClient");
const { UnsafeUrlError } = require("../../utils/safeUrl");

let pass = 0;
let fail = 0;
const FAILURES = [];

function test(name, fn) {
  const record = (err) => {
    if (err) {
      fail += 1;
      FAILURES.push({ name, err });
      console.log(`  ✗ ${name}`);
      console.log(`      ${err.message}`);
    } else {
      pass += 1;
      console.log(`  ✓ ${name}`);
    }
  };
  try {
    const r = fn();
    if (r && typeof r.then === "function") {
      return r.then(() => record(null), record);
    }
    record(null);
  } catch (err) {
    record(err);
  }
  return undefined;
}
function group(label, fn) {
  console.log(`\n${label}`);
  return fn();
}

// ─── Harness ─────────────────────────────────────────────────────────────────

const BASE = "https://python.internal.test/adfactory/autofill";
const URL_OK = "https://tulsiandco.in/refill-kit";

// Always resolves public so the guard passes and we reach the transport.
const publicDns = async () => [{ address: "93.184.216.34", family: 4 }];

const goodBody = {
  brandInfo: { brandName: "Tulsi & Co.", brandDescription: "Ayurvedic skincare." },
  objectives: { primaryObjective: "Sell refill kits" },
};

// Builds a `post` stub plus a call log.
const stubPost = (impl) => {
  const calls = [];
  const post = async (url, body, cfg) => {
    calls.push({ url, body, cfg });
    return impl(calls.length, { url, body, cfg });
  };
  post.calls = calls;
  return post;
};

const httpError = (status) => {
  const err = new Error(`Request failed with status code ${status}`);
  err.response = { status };
  return err;
};

const timeoutError = () => {
  const err = new Error("timeout of 60000ms exceeded");
  err.code = "ECONNABORTED";
  return err;
};

const run = (post, url = URL_OK, extra = {}) =>
  fetchAutofill(url, { baseUrl: BASE, lookup: publicDns, post, ...extra });

const isAutofill = (code) => (err) =>
  err instanceof AutofillError && err.code === code;

// ─── Happy path ──────────────────────────────────────────────────────────────

group("happy path", () => {
  test("returns brandInfo, objectives and the resolved URL", async () => {
    const post = stubPost(() => ({ data: goodBody }));
    const res = await run(post);
    assert.equal(res.brandInfo.brandName, "Tulsi & Co.");
    assert.equal(res.objectives.primaryObjective, "Sell refill kits");
    assert.equal(res.sourceUrl, URL_OK);
  });

  test("posts { website_url } — the contract Python expects", async () => {
    const post = stubPost(() => ({ data: goodBody }));
    await run(post);
    assert.equal(post.calls.length, 1);
    assert.deepEqual(post.calls[0].body, { website_url: URL_OK });
    assert.equal(post.calls[0].url, BASE);
  });

  test("sends the normalised URL, not the raw input", async () => {
    const post = stubPost(() => ({ data: goodBody }));
    await run(post, "tulsiandco.in/refill-kit");
    assert.equal(post.calls[0].body.website_url, "https://tulsiandco.in/refill-kit");
  });

  test("a response with only one of the two keys is still accepted", async () => {
    const post = stubPost(() => ({ data: { brandInfo: { brandName: "X" } } }));
    const res = await run(post);
    assert.equal(res.brandInfo.brandName, "X");
    assert.deepEqual(res.objectives, {});
  });

  test("passes a timeout through to the transport", async () => {
    const post = stubPost(() => ({ data: goodBody }));
    await run(post, URL_OK, { timeout: 1234 });
    assert.equal(post.calls[0].cfg.timeout, 1234);
  });

  test("defaults to a 50s timeout — 35s measured cold read plus headroom", async () => {
    const post = stubPost(() => ({ data: goodBody }));
    await run(post);
    assert.equal(post.calls[0].cfg.timeout, 50_000);
  });
});

// ─── URL safety happens first ────────────────────────────────────────────────

group("the SSRF guard runs before any call goes out", () => {
  test("a private address is rejected and never reaches Python", async () => {
    const post = stubPost(() => ({ data: goodBody }));
    await assert.rejects(
      run(post, "http://169.254.169.254/latest/meta-data/"),
      (err) => err instanceof UnsafeUrlError,
    );
    assert.equal(post.calls.length, 0, "must not call out for a blocked URL");
  });

  test("a non-http scheme is rejected before the call", async () => {
    const post = stubPost(() => ({ data: goodBody }));
    await assert.rejects(run(post, "file:///etc/passwd"), UnsafeUrlError);
    assert.equal(post.calls.length, 0);
  });

  test("a host that resolves private is rejected before the call", async () => {
    const post = stubPost(() => ({ data: goodBody }));
    await assert.rejects(
      fetchAutofill("https://sneaky.test", {
        baseUrl: BASE,
        post,
        lookup: async () => [{ address: "10.0.0.1", family: 4 }],
      }),
      UnsafeUrlError,
    );
    assert.equal(post.calls.length, 0);
  });
});

// ─── Error taxonomy ──────────────────────────────────────────────────────────

group("error taxonomy", () => {
  test("400 → UNUSABLE_URL (the URL is the problem)", async () => {
    // Python returns 400 both for an unreachable page and for an N/A result.
    const post = stubPost(() => {
      throw httpError(400);
    });
    await assert.rejects(run(post), isAutofill(CODES.UNUSABLE_URL));
  });

  test("404 and 422 are also UNUSABLE_URL", async () => {
    for (const status of [404, 422]) {
      const post = stubPost(() => {
        throw httpError(status);
      });
      await assert.rejects(run(post), isAutofill(CODES.UNUSABLE_URL));
    }
  });

  test("500 → UNAVAILABLE", async () => {
    const post = stubPost(() => {
      throw httpError(500);
    });
    await assert.rejects(run(post), isAutofill(CODES.UNAVAILABLE));
  });

  test("a network error → UNAVAILABLE", async () => {
    const post = stubPost(() => {
      throw new Error("ECONNREFUSED");
    });
    await assert.rejects(run(post), isAutofill(CODES.UNAVAILABLE));
  });

  test("a timeout → TIMEOUT, not a generic failure", async () => {
    const post = stubPost(() => {
      throw timeoutError();
    });
    await assert.rejects(run(post), isAutofill(CODES.TIMEOUT));
  });

  test("a 200 with the wrong shape → BAD_RESPONSE", async () => {
    for (const body of [null, undefined, "nope", 42, {}, { unexpected: true }]) {
      const post = stubPost(() => ({ data: body }));
      await assert.rejects(run(post), isAutofill(CODES.BAD_RESPONSE));
    }
  });

  test("malformed JSON does not escape as a raw throw", async () => {
    const post = stubPost(() => ({ data: "<html>gateway error</html>" }));
    await assert.rejects(run(post), (err) => err instanceof AutofillError);
  });

  test("no configured base URL → NOT_CONFIGURED, before any DNS work", async () => {
    let looked = false;
    await assert.rejects(
      fetchAutofill(URL_OK, {
        baseUrl: "",
        lookup: async () => {
          looked = true;
          return [];
        },
      }),
      isAutofill(CODES.NOT_CONFIGURED),
    );
    assert.equal(looked, false);
  });

  test("every error carries a user-safe message", async () => {
    const post = stubPost(() => {
      throw httpError(500);
    });
    try {
      await run(post);
      assert.fail("should have thrown");
    } catch (err) {
      assert.ok(err.message.length > 0);
      // No stack traces or internal hostnames leaking to the user.
      assert.doesNotMatch(err.message, /python\.internal/);
      assert.doesNotMatch(err.message, /status code/i);
    }
  });
});

// ─── Retry rule ──────────────────────────────────────────────────────────────

group("retry — once, and only for transient failures", () => {
  test("does NOT retry a timeout — the user already waited the full 50s", async () => {
    // Measured cold-read latency is ~35s and the timeout is 50s. A silent
    // retry would make the user wait 100s for the same likely outcome, so
    // timeouts surface immediately and let them decide.
    const post = stubPost(() => {
      throw timeoutError();
    });
    await assert.rejects(run(post), isAutofill(CODES.TIMEOUT));
    assert.equal(post.calls.length, 1);
  });

  test("retries a 500 exactly once", async () => {
    const post = stubPost((n) => {
      if (n === 1) throw httpError(500);
      return { data: goodBody };
    });
    await run(post);
    assert.equal(post.calls.length, 2);
  });

  test("gives up after the single retry — never a third attempt", async () => {
    const post = stubPost(() => {
      throw httpError(500);
    });
    await assert.rejects(run(post), isAutofill(CODES.UNAVAILABLE));
    assert.equal(post.calls.length, 2);
  });

  test("does NOT retry a 400 — the URL will not become valid", async () => {
    const post = stubPost(() => {
      throw httpError(400);
    });
    await assert.rejects(run(post), isAutofill(CODES.UNUSABLE_URL));
    assert.equal(post.calls.length, 1, "a rejected URL must not cost a second wait");
  });

  test("does NOT retry a bad-shape 200", async () => {
    const post = stubPost(() => ({ data: { unexpected: true } }));
    await assert.rejects(run(post), isAutofill(CODES.BAD_RESPONSE));
    assert.equal(post.calls.length, 1);
  });
});

// ─── Summary ─────────────────────────────────────────────────────────────────

process.on("beforeExit", () => {
  if (process.exitCode) return;
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log("\nFailures:");
    for (const f of FAILURES) console.log(`  ✗ ${f.name}\n    ${f.err.stack}`);
    process.exitCode = 1;
  }
});
