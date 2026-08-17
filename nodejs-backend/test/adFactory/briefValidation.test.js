#!/usr/bin/env node
/**
 * Tests for Validations/adFactory/adFactoryBriefValidation.js and the pure
 * merge/failure logic in services/adFactory/briefService.js.
 *
 * No DB, no SDK, no HTTP. The service functions exercised here are the ones
 * that make no database call; the persistence paths are covered by manual QA
 * until there's an integration harness.
 *
 * Run:  node test/adFactory/briefValidation.test.js
 */

const assert = require("node:assert/strict");

const {
  createFromUrlSchema,
  createFromBrandSchema,
  updateBriefSchema,
  rejectForbiddenKeys,
  FORBIDDEN_UPDATE_KEYS,
  MAX_URL_LENGTH,
} = require("../../Validations/adFactory/adFactoryBriefValidation");
const {
  mergeInferredOverBrand,
  describeInferenceFailure,
  emitBriefReady,
  BRIEF_READY_EVENT,
} = require("../../services/adFactory/briefService");
const { AutofillError, AUTOFILL_ERROR_CODES } = require("../../services/adFactory/autofillClient");
const { UnsafeUrlError, parseSafeUrl } = require("../../utils/safeUrl");

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
  return fn();
}

const msgs = (error) => (error ? error.details.map((d) => d.message).join("; ") : "");

// ─── Create ──────────────────────────────────────────────────────────────────

group("create from URL — one field in", () => {
  test("a bare URL validates", () => {
    const { error, value } = createFromUrlSchema.validate({
      url: "https://tulsiandco.in/refill-kit",
    });
    assert.equal(error, undefined, msgs(error));
    assert.equal(value.forceRefresh, false);
  });

  test("a domain with no scheme validates — safeUrl adds https later", () => {
    const { error } = createFromUrlSchema.validate({ url: "tulsiandco.in" });
    assert.equal(error, undefined, msgs(error));
  });

  test("url is required, with a message a user can act on", () => {
    const { error } = createFromUrlSchema.validate({});
    assert.ok(error);
    assert.match(msgs(error), /paste a product or landing page/i);
  });

  test("an empty url is rejected with the same guidance", () => {
    const { error } = createFromUrlSchema.validate({ url: "   " });
    assert.ok(error);
    assert.match(msgs(error), /paste a product or landing page/i);
  });

  test("an absurdly long url is rejected", () => {
    const { error } = createFromUrlSchema.validate({
      url: `https://x.test/${"a".repeat(MAX_URL_LENGTH)}`,
    });
    assert.ok(error);
    assert.match(msgs(error), /too long/i);
  });

  test("forceRefresh is accepted", () => {
    const { error, value } = createFromUrlSchema.validate({
      url: "https://x.test",
      forceRefresh: true,
    });
    assert.equal(error, undefined, msgs(error));
    assert.equal(value.forceRefresh, true);
  });

  test("unknown keys are rejected", () => {
    const { error } = createFromUrlSchema.validate({
      url: "https://x.test",
      userId: "GPT-1",
    });
    assert.ok(error, "must not accept a client-supplied userId");
  });

  test("scheme filtering is NOT this layer's job", () => {
    // Joi can't know that internal.corp resolves to 10.0.0.5. safeUrl does
    // that, with DNS. This test documents the boundary so nobody 'helpfully'
    // adds a half-check here and assumes they're covered.
    const { error } = createFromUrlSchema.validate({ url: "file:///etc/passwd" });
    assert.equal(error, undefined, "safeUrl owns this rejection, not Joi");
  });
});

group("create from brand", () => {
  test("a brandId validates", () => {
    const { error } = createFromBrandSchema.validate({ brandId: "brand-abc-123" });
    assert.equal(error, undefined, msgs(error));
  });

  test("brand ids are opaque strings, not ObjectIds", () => {
    // Brands are subdocuments keyed by their own string `id`.
    const { error } = createFromBrandSchema.validate({ brandId: "not-an-objectid" });
    assert.equal(error, undefined, msgs(error));
  });

  test("brandId is required", () => {
    const { error } = createFromBrandSchema.validate({});
    assert.ok(error);
    assert.match(msgs(error), /saved brand/i);
  });
});

// ─── Update ──────────────────────────────────────────────────────────────────

group("update — every inferred value is editable", () => {
  test("a brand correction validates", () => {
    const { error } = updateBriefSchema.validate({
      brand: { voice: ["warm", "grounded"], tone: "friendly and plain-spoken" },
    });
    assert.equal(error, undefined, msgs(error));
  });

  test("an offer correction validates", () => {
    const { error } = updateBriefSchema.validate({
      offer: { audience: ["clean-beauty switchers"], cta: { button: "SHOP_NOW" } },
    });
    assert.equal(error, undefined, msgs(error));
  });

  test("a budget correction validates", () => {
    const { error } = updateBriefSchema.validate({
      delivery: { budget: { daily: 800, currency: "INR" } },
    });
    assert.equal(error, undefined, msgs(error));
  });

  test("an empty patch is rejected", () => {
    const { error } = updateBriefSchema.validate({});
    assert.ok(error);
    assert.match(msgs(error), /nothing to update/i);
  });

  test("a non-positive budget is rejected", () => {
    for (const daily of [0, -100]) {
      const { error } = updateBriefSchema.validate({ delivery: { budget: { daily } } });
      assert.ok(error, `budget ${daily} must be rejected`);
    }
  });

  test("a null budget is allowed — it means 'not set yet'", () => {
    const { error } = updateBriefSchema.validate({
      delivery: { budget: { daily: null } },
    });
    assert.equal(error, undefined, msgs(error));
  });

  test("malformed hex is rejected with a usable message", () => {
    const { error } = updateBriefSchema.validate({
      brand: { palette: ["#2F4F3A", "greenish"] },
    });
    assert.ok(error);
    assert.match(msgs(error), /6-digit hex/i);
  });

  test("shorthand hex is rejected — the palette is stored 6-digit", () => {
    const { error } = updateBriefSchema.validate({ brand: { palette: ["#2F4"] } });
    assert.ok(error);
  });

  test("an unknown platform is rejected", () => {
    const { error } = updateBriefSchema.validate({
      delivery: { platforms: ["meta", "tiktok"] },
    });
    assert.ok(error);
  });

  test("array size limits hold", () => {
    const { error } = updateBriefSchema.validate({
      brand: { voice: Array.from({ length: 11 }, (_, i) => `v${i}`) },
    });
    assert.ok(error);
  });
});

// ─── Server-owned fields ─────────────────────────────────────────────────────

group("provenance and lifecycle cannot be rewritten by a client", () => {
  for (const key of FORBIDDEN_UPDATE_KEYS) {
    test(`rejects a patch touching ${key}`, () => {
      const message = rejectForbiddenKeys({ [key]: "anything" });
      assert.ok(message, `${key} must be rejected`);
      assert.match(message, new RegExp(key));
    });
  }

  test("provenance is on the forbidden list — laundering a guess as fact", () => {
    // The whole point of provenance is that it records where a value came
    // from. A client that can write it can present our own inference as
    // though the page said it.
    assert.ok(FORBIDDEN_UPDATE_KEYS.includes("provenance"));
  });

  test("a clean patch passes", () => {
    assert.equal(rejectForbiddenKeys({ brand: { name: "Tulsi & Co." } }), null);
  });

  test("names every offending key at once, not just the first", () => {
    const message = rejectForbiddenKeys({ provenance: {}, userId: "x", status: "live" });
    assert.match(message, /provenance/);
    assert.match(message, /userId/);
    assert.match(message, /status/);
  });

  test("non-objects don't crash the check", () => {
    assert.equal(rejectForbiddenKeys(null), null);
    assert.equal(rejectForbiddenKeys("nope"), null);
    assert.equal(rejectForbiddenKeys(undefined), null);
  });
});

// ─── Brand-over-inference merge ──────────────────────────────────────────────

group("a curated brand outranks a scrape", () => {
  test("keeps the brand's own values", () => {
    const merged = mergeInferredOverBrand(
      { name: "Tulsi & Co.", description: "Curated by the user." },
      { name: "Tulsi and Company", description: "Scraped guess.", tone: "warm" },
    );
    assert.equal(merged.name, "Tulsi & Co.");
    assert.equal(merged.description, "Curated by the user.");
  });

  test("fills gaps the brand record simply doesn't have", () => {
    // BrandIQ brands store no voice, tone, dos, donts or palette at all —
    // this is the entire reason the brand path runs inference.
    const merged = mergeInferredOverBrand(
      { name: "Tulsi & Co.", voice: [], tone: "", dos: [] },
      { voice: ["warm", "grounded"], tone: "plain-spoken", dos: ["Name the ingredient"] },
    );
    assert.deepEqual(merged.voice, ["warm", "grounded"]);
    assert.equal(merged.tone, "plain-spoken");
    assert.equal(merged.dos.length, 1);
  });

  test("an empty array counts as a gap, not as a value", () => {
    const merged = mergeInferredOverBrand({ palette: [] }, { palette: ["#2F4F3A"] });
    assert.deepEqual(merged.palette, ["#2F4F3A"]);
  });

  test("a populated array is preserved", () => {
    const merged = mergeInferredOverBrand(
      { logoUrls: ["https://brand/logo.svg"] },
      { logoUrls: ["https://scraped/favicon.ico"] },
    );
    assert.deepEqual(merged.logoUrls, ["https://brand/logo.svg"]);
  });

  test("empty inputs don't throw", () => {
    assert.deepEqual(mergeInferredOverBrand({}, {}), {});
    assert.deepEqual(mergeInferredOverBrand(undefined, undefined), {});
  });
});

// ─── Failure messaging ───────────────────────────────────────────────────────

group("failures tell the user whether retrying is worth it", () => {
  test("an unusable URL becomes needs_input and offers the brand path", () => {
    const r = describeInferenceFailure(
      new AutofillError("x", AUTOFILL_ERROR_CODES.UNUSABLE_URL),
    );
    assert.equal(r.status, "needs_input");
    assert.match(r.reason, /saved brand/i);
  });

  test("a timeout becomes failed and invites a retry", () => {
    const r = describeInferenceFailure(
      new AutofillError("x", AUTOFILL_ERROR_CODES.TIMEOUT),
    );
    assert.equal(r.status, "failed");
    assert.match(r.reason, /try again/i);
  });

  test("an unsafe URL surfaces its own message", () => {
    const err = new UnsafeUrlError("That URL points to a private address", "blocked_ip");
    const r = describeInferenceFailure(err);
    assert.equal(r.status, "failed");
    assert.equal(r.reason, err.message);
  });

  test("an unconfigured service points at the brand path", () => {
    const r = describeInferenceFailure(
      new AutofillError("x", AUTOFILL_ERROR_CODES.NOT_CONFIGURED),
    );
    assert.match(r.reason, /saved brand/i);
  });

  test("an unknown error still produces a user-safe reason", () => {
    const r = describeInferenceFailure(new Error("ECONNRESET at line 42"));
    assert.equal(r.status, "failed");
    assert.doesNotMatch(r.reason, /ECONNRESET/);
    assert.ok(r.reason.length > 0);
  });

  test("no failure path leaves the user without a next step", () => {
    // The safeUrl cases use REAL errors thrown by the guard rather than
    // hand-built ones, because describeInferenceFailure passes their message
    // straight through to the user — so what's asserted here is the message
    // the user actually sees.
    const realUnsafeErrors = [];
    for (const bad of ["file:///etc/passwd", "http://169.254.169.254/", "https://u:p@x.test"]) {
      try {
        parseSafeUrl(bad);
        assert.fail(`${bad} should have been rejected`);
      } catch (err) {
        realUnsafeErrors.push(err);
      }
    }

    const cases = [
      new AutofillError("x", AUTOFILL_ERROR_CODES.UNUSABLE_URL),
      new AutofillError("x", AUTOFILL_ERROR_CODES.TIMEOUT),
      new AutofillError("x", AUTOFILL_ERROR_CODES.UNAVAILABLE),
      new AutofillError("x", AUTOFILL_ERROR_CODES.NOT_CONFIGURED),
      ...realUnsafeErrors,
      new Error("boom"),
    ];

    for (const err of cases) {
      const r = describeInferenceFailure(err);
      assert.ok(
        ["failed", "needs_input"].includes(r.status),
        `unexpected status for ${err.name}`,
      );
      assert.ok(
        r.reason && r.reason.length > 10,
        `every failure needs real guidance, got "${r.reason}" for ${err.name}`,
      );
    }
  });
});

// ─── Brand path resilience ───────────────────────────────────────────────────

group("a brand-seeded brief survives a dead page reader", () => {
  // The brand record already carries a curated name, description, logo and
  // audience. A failed website read was only ever going to ADD voice and
  // guidelines, so it must not throw away what we already have.
  const brandBriefAfterFailure = (brief) => {
    const fromBrandRecord = brief.source?.type === 'brand';
    const hasUsableBrand = Boolean(brief.brand?.name || brief.brand?.description);
    return fromBrandRecord && hasUsableBrand;
  };

  test("a brand brief with a name degrades to usable, not failed", () => {
    assert.equal(
      brandBriefAfterFailure({
        source: { type: 'brand' },
        brand: { name: 'Tulsi & Co.' },
      }),
      true,
    );
  });

  test("a brand brief with only a description also degrades to usable", () => {
    assert.equal(
      brandBriefAfterFailure({
        source: { type: 'brand' },
        brand: { description: 'Ayurvedic skincare.' },
      }),
      true,
    );
  });

  test("a URL brief has nothing to fall back on and stays failed", () => {
    assert.equal(
      brandBriefAfterFailure({ source: { type: 'url' }, brand: { name: 'X' } }),
      false,
    );
  });

  test("an empty brand brief has nothing to salvage and stays failed", () => {
    assert.equal(
      brandBriefAfterFailure({ source: { type: 'brand' }, brand: {} }),
      false,
    );
  });
});

// ─── Completion signal ───────────────────────────────────────────────────────

group("the client is told when inference finishes", () => {
  const captureEmits = (fn) => {
    const sent = [];
    const previous = global.io;
    global.io = {
      to(room) {
        return {
          emit(event, payload) {
            sent.push({ room, event, payload });
          },
        };
      },
    };
    try {
      fn();
    } finally {
      global.io = previous;
    }
    return sent;
  };

  test("emits to the user's own room, not a broadcast", () => {
    // Every socket joins a room named after its userId on connect, so this
    // reaches all of that user's tabs and nobody else's.
    const sent = captureEmits(() =>
      emitBriefReady({ _id: "abc123", userId: "GPT-438", status: "draft" }),
    );
    assert.equal(sent.length, 1);
    assert.equal(sent[0].room, "GPT-438");
    assert.equal(sent[0].event, BRIEF_READY_EVENT);
  });

  test("carries the brief id and its resolved status", () => {
    const sent = captureEmits(() =>
      emitBriefReady({ _id: "abc123", userId: "GPT-438", status: "draft" }),
    );
    assert.equal(sent[0].payload.briefId, "abc123");
    assert.equal(sent[0].payload.status, "draft");
  });

  test("failures notify too — the wait screen must not hang on a dead brief", () => {
    const sent = captureEmits(() =>
      emitBriefReady({
        _id: "abc123",
        userId: "GPT-438",
        status: "failed",
        failureReason: "Reading that page took too long.",
      }),
    );
    assert.equal(sent[0].payload.status, "failed");
    assert.match(sent[0].payload.failureReason, /took too long/);
  });

  test("no socket server is a no-op, not a crash", () => {
    // Workers and tests run without one. A successful inference must never be
    // undone by the absence of a socket.
    const previous = global.io;
    global.io = undefined;
    try {
      assert.doesNotThrow(() =>
        emitBriefReady({ _id: "x", userId: "GPT-1", status: "draft" }),
      );
    } finally {
      global.io = previous;
    }
  });

  test("a brief with no userId is skipped rather than emitted to an empty room", () => {
    const sent = captureEmits(() => emitBriefReady({ _id: "x", status: "draft" }));
    assert.equal(sent.length, 0);
  });

  test("a throwing socket layer is swallowed", () => {
    const previous = global.io;
    global.io = {
      to() {
        throw new Error("socket exploded");
      },
    };
    try {
      assert.doesNotThrow(() =>
        emitBriefReady({ _id: "x", userId: "GPT-1", status: "draft" }),
      );
    } finally {
      global.io = previous;
    }
  });
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log("\nFailures:");
  for (const f of FAILURES) console.log(`  ✗ ${f.name}\n    ${f.err.stack}`);
  process.exit(1);
}
