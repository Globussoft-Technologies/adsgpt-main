#!/usr/bin/env node
/**
 * Tests for utils/urlKey.js.
 *
 * The property under test is the one that costs money when it fails: every
 * spelling of the same page must produce ONE key, so a second read of a page we
 * already understand reuses the brief instead of paying for another ~35s scrape.
 *
 * The opposite property matters just as much — two genuinely different pages
 * must never collide, or a user reading /laptops would silently get the brief
 * they made for /monitors.
 *
 * Run:  node test/adFactory/urlKey.test.js
 */

const assert = require("node:assert/strict");

const { canonicalUrlKey } = require("../../utils/urlKey");

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

const sameKey = (label, inputs) =>
  test(label, () => {
    const keys = inputs.map(canonicalUrlKey);
    const [first] = keys;
    assert.ok(first, `expected a non-empty key, got ${JSON.stringify(first)}`);
    for (let i = 1; i < keys.length; i += 1) {
      assert.equal(
        keys[i],
        first,
        `${JSON.stringify(inputs[i])} -> ${JSON.stringify(keys[i])}, expected ${JSON.stringify(first)}`,
      );
    }
  });

// ─── Collapsing ──────────────────────────────────────────────────────────────

group("every spelling of one page produces one key", () => {
  // These six are exactly the shapes that produced six briefs for one site.
  sameKey("scheme, www, and trailing slash", [
    "dell.com",
    "https://dell.com",
    "http://dell.com",
    "https://www.dell.com",
    "https://www.dell.com/",
    "HTTPS://WWW.DELL.COM/",
  ]);

  sameKey("a fragment is not part of the page", [
    "https://dell.com/laptops",
    "https://dell.com/laptops#specs",
    "https://dell.com/laptops/#reviews",
  ]);

  sameKey("tracking params are noise", [
    "https://dell.com/laptops",
    "https://dell.com/laptops?utm_source=newsletter&utm_medium=email",
    "https://dell.com/laptops?fbclid=abc123",
    "https://dell.com/laptops?gclid=xyz&utm_campaign=diwali",
  ]);

  sameKey("real params survive, in a stable order", [
    "https://shop.com/p?colour=red&size=l",
    "https://shop.com/p?size=l&colour=red",
    "https://www.shop.com/p/?size=l&colour=red&utm_source=ig",
  ]);

  sameKey("default ports are not identity", [
    "https://dell.com/x",
    "https://dell.com:443/x",
  ]);

  test("whitespace around a pasted URL doesn't fork the key", () => {
    assert.equal(canonicalUrlKey("  https://dell.com  "), canonicalUrlKey("dell.com"));
  });
});

// ─── Not collapsing ──────────────────────────────────────────────────────────

group("genuinely different pages never collide", () => {
  const distinct = [
    "dell.com",
    "dell.com/laptops",
    "dell.com/monitors",
    "dell.com/laptops/xps",
    "shop.dell.com",
    "dell.co.uk",
    "dell.com/p?colour=red",
    "dell.com/p?colour=blue",
    "dell.com:8443/x",
  ];

  test("each is its own key", () => {
    const keys = distinct.map(canonicalUrlKey);
    assert.equal(new Set(keys).size, keys.length, `collision in ${JSON.stringify(keys)}`);
  });

  test("a subdomain is a different site", () => {
    assert.notEqual(canonicalUrlKey("shop.dell.com"), canonicalUrlKey("dell.com"));
  });

  test("only ONE trailing slash is trimmed — deeper paths are pages", () => {
    assert.equal(canonicalUrlKey("dell.com/a/b/"), "dell.com/a/b");
    assert.notEqual(canonicalUrlKey("dell.com/a/b"), canonicalUrlKey("dell.com/a"));
  });

  test("a non-default port is part of the identity", () => {
    assert.notEqual(canonicalUrlKey("dell.com:8443/x"), canonicalUrlKey("dell.com/x"));
  });
});

// ─── Shape ───────────────────────────────────────────────────────────────────

group("the key is a matching key, not a URL", () => {
  test("no scheme, so http and https agree", () => {
    const k = canonicalUrlKey("https://dell.com/laptops");
    assert.equal(k, "dell.com/laptops");
    assert.ok(!k.includes("://"));
  });

  test("www is stripped from the host only, not from a path", () => {
    assert.equal(canonicalUrlKey("https://www.dell.com/www.thing"), "dell.com/www.thing");
  });
});

// ─── Refusals ────────────────────────────────────────────────────────────────

group("unusable input yields an empty key, never a colliding one", () => {
  // Empty is the signal "do not store this" — if unparseable inputs all mapped
  // to some shared placeholder, every one of them would dedupe against the
  // others and hand a user someone else's brief.
  for (const bad of ["", "   ", null, undefined, 42, {}, "not a url", "http://", "///"]) {
    test(`${JSON.stringify(bad)} -> ""`, () => {
      assert.equal(canonicalUrlKey(bad), "");
    });
  }

  test("non-http schemes are refused, matching the SSRF guard", () => {
    for (const bad of ["file:///etc/passwd", "ftp://x.com", "javascript:alert(1)", "data:text/html,x"]) {
      assert.equal(canonicalUrlKey(bad), "", bad);
    }
  });
});

// ─── Purity ──────────────────────────────────────────────────────────────────

group("purity", () => {
  test("repeated calls agree", () => {
    const u = "https://www.dell.com/laptops/?utm_source=x#a";
    assert.equal(canonicalUrlKey(u), canonicalUrlKey(u));
  });
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log("\nFailures:");
  for (const f of FAILURES) console.log(`\n  ${f.name}\n  ${f.err.stack}`);
  process.exit(1);
}
