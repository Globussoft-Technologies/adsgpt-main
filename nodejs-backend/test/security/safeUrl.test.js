#!/usr/bin/env node
/**
 * SSRF guard for user-supplied URLs. Run with:
 *
 *   node test/security/safeUrl.test.js
 *
 * Mirrors the project's plain-Node assertion style. Exits non-zero on failure.
 * No network: DNS is injected, so nothing here resolves or fetches anything.
 *
 * The cases that matter are the bypasses — alternate IP encodings, IPv4-mapped
 * IPv6, and a public host that redirects inward. A guard that only blocks
 * literal "127.0.0.1" is not a guard.
 */

const assert = require("node:assert/strict");

const {
  parseSafeUrl,
  assertSafeUrl,
  UnsafeUrlError,
  _internals,
} = require("../../utils/safeUrl");

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
      return r.then(
        () => record(null),
        (err) => record(err),
      );
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

// DNS stub: map hostname → addresses. Anything unlisted resolves public.
const stubLookup = (map) => async (host) => {
  if (Object.prototype.hasOwnProperty.call(map, host)) {
    const v = map[host];
    if (v === null) throw new Error("ENOTFOUND");
    return (Array.isArray(v) ? v : [v]).map((address) => ({ address, family: 4 }));
  }
  return [{ address: "93.184.216.34", family: 4 }];
};

const publicDns = stubLookup({});

const isUnsafe = (reason) => (err) =>
  err instanceof UnsafeUrlError && (!reason || err.reason === reason);

// ─── Parsing ─────────────────────────────────────────────────────────────────

group("parseSafeUrl — scheme and shape", () => {
  test("accepts https", () => {
    assert.equal(parseSafeUrl("https://tulsiandco.in/kit").protocol, "https:");
  });

  test("accepts http", () => {
    assert.equal(parseSafeUrl("http://tulsiandco.in").protocol, "http:");
  });

  test("assumes https for a bare domain", () => {
    const u = parseSafeUrl("tulsiandco.in/refill-kit");
    assert.equal(u.protocol, "https:");
    assert.equal(u.hostname, "tulsiandco.in");
  });

  for (const bad of [
    "file:///etc/passwd",
    "gopher://evil.test/",
    "ftp://files.test/",
    "data:text/html,<script>alert(1)</script>",
    "javascript:alert(1)",
  ]) {
    test(`rejects ${bad.split(":")[0]}: scheme`, () => {
      assert.throws(() => parseSafeUrl(bad), isUnsafe("protocol"));
    });
  }

  test("rejects embedded credentials", () => {
    assert.throws(
      () => parseSafeUrl("https://user:pass@tulsiandco.in"),
      isUnsafe("credentials"),
    );
  });

  test("rejects credentials used to disguise the real host", () => {
    // Reads as "tulsiandco.in" to a human; the real host is evil.test.
    assert.throws(
      () => parseSafeUrl("https://tulsiandco.in@evil.test/"),
      isUnsafe("credentials"),
    );
  });

  for (const empty of ["", "   ", null, undefined, 42, {}]) {
    test(`rejects ${JSON.stringify(empty)} as empty`, () => {
      assert.throws(() => parseSafeUrl(empty), isUnsafe());
    });
  }

  test("rejects a malformed URL", () => {
    assert.throws(() => parseSafeUrl("https://"), isUnsafe());
  });
});

// ─── Literal IPs, including alternate encodings ──────────────────────────────

group("parseSafeUrl — literal addresses and their encodings", () => {
  const blocked = [
    ["loopback", "http://127.0.0.1/"],
    ["loopback, high port", "http://127.0.0.1:6379/"],
    ["0.0.0.0", "http://0.0.0.0/"],
    ["private 10/8", "http://10.0.0.5/"],
    ["private 172.16/12", "http://172.16.4.4/"],
    ["private 192.168/16", "http://192.168.1.1/"],
    ["link-local", "http://169.254.1.1/"],
    ["cloud metadata", "http://169.254.169.254/latest/meta-data/"],
    ["CGNAT", "http://100.64.0.1/"],
    ["multicast", "http://224.0.0.1/"],
    ["decimal-encoded loopback", "http://2130706433/"],
    ["octal-encoded loopback", "http://0177.0.0.1/"],
    ["hex-encoded loopback", "http://0x7f000001/"],
    ["IPv6 loopback", "http://[::1]/"],
    ["IPv6 unspecified", "http://[::]/"],
    ["IPv6 link-local", "http://[fe80::1]/"],
    ["IPv6 unique-local", "http://[fd00::1]/"],
    ["IPv4-mapped IPv6 loopback", "http://[::ffff:127.0.0.1]/"],
    ["IPv4-mapped IPv6 loopback, hex form", "http://[::ffff:7f00:1]/"],
    ["IPv4-mapped IPv6 metadata", "http://[::ffff:169.254.169.254]/"],
  ];

  for (const [label, url] of blocked) {
    test(`blocks ${label}`, () => {
      assert.throws(() => parseSafeUrl(url), isUnsafe("blocked_ip"));
    });
  }

  test("allows a public literal IP", () => {
    assert.equal(parseSafeUrl("http://93.184.216.34/").hostname, "93.184.216.34");
  });

  test("allows a public IPv6 literal", () => {
    assert.doesNotThrow(() => parseSafeUrl("http://[2606:2800:220:1::]/"));
  });
});

// ─── Range helpers ───────────────────────────────────────────────────────────

group("isBlockedIp — boundaries", () => {
  const { isBlockedIp } = _internals;

  test("172.16/12 boundaries", () => {
    assert.equal(isBlockedIp("172.15.255.255"), false);
    assert.equal(isBlockedIp("172.16.0.0"), true);
    assert.equal(isBlockedIp("172.31.255.255"), true);
    assert.equal(isBlockedIp("172.32.0.0"), false);
  });

  test("100.64/10 boundaries", () => {
    assert.equal(isBlockedIp("100.63.255.255"), false);
    assert.equal(isBlockedIp("100.64.0.0"), true);
    assert.equal(isBlockedIp("100.127.255.255"), true);
    assert.equal(isBlockedIp("100.128.0.0"), false);
  });

  test("multicast and above", () => {
    assert.equal(isBlockedIp("223.255.255.255"), false);
    assert.equal(isBlockedIp("224.0.0.0"), true);
    assert.equal(isBlockedIp("255.255.255.255"), true);
  });

  test("anything that isn't an IP is refused", () => {
    assert.equal(isBlockedIp("not-an-ip"), true);
    assert.equal(isBlockedIp(""), true);
  });
});

// ─── DNS resolution ──────────────────────────────────────────────────────────

group("assertSafeUrl — checks the RESOLVED address, not the name", () => {
  test("allows a host that resolves public", async () => {
    const u = await assertSafeUrl("https://tulsiandco.in", { lookup: publicDns });
    assert.equal(u.hostname, "tulsiandco.in");
  });

  test("blocks an innocent-looking host that resolves to loopback", async () => {
    // The whole reason we resolve instead of string-matching.
    await assert.rejects(
      assertSafeUrl("https://totally-fine.test", {
        lookup: stubLookup({ "totally-fine.test": "127.0.0.1" }),
      }),
      isUnsafe("blocked_ip"),
    );
  });

  test("blocks a host that resolves to cloud metadata", async () => {
    await assert.rejects(
      assertSafeUrl("https://metadata.test", {
        lookup: stubLookup({ "metadata.test": "169.254.169.254" }),
      }),
      isUnsafe("blocked_ip"),
    );
  });

  test("blocks when ANY of several records is private", async () => {
    // We don't control which record the HTTP client picks, so one bad
    // address poisons the whole name.
    await assert.rejects(
      assertSafeUrl("https://mixed.test", {
        lookup: stubLookup({ "mixed.test": ["93.184.216.34", "10.0.0.1"] }),
      }),
      isUnsafe("blocked_ip"),
    );
  });

  test("reports a DNS failure as its own reason", async () => {
    await assert.rejects(
      assertSafeUrl("https://nope.test", { lookup: stubLookup({ "nope.test": null }) }),
      isUnsafe("dns_failed"),
    );
  });

  test("an empty answer is refused, not treated as public", async () => {
    await assert.rejects(
      assertSafeUrl("https://empty.test", { lookup: async () => [] }),
      isUnsafe("dns_empty"),
    );
  });

  test("a literal IP short-circuits DNS entirely", async () => {
    let called = false;
    await assertSafeUrl("http://93.184.216.34/", {
      lookup: async () => {
        called = true;
        return [];
      },
    });
    assert.equal(called, false, "must not resolve a literal address");
  });

  test("scheme rejection happens before any DNS work", async () => {
    let called = false;
    await assert.rejects(
      assertSafeUrl("file:///etc/passwd", {
        lookup: async () => {
          called = true;
          return [];
        },
      }),
      isUnsafe("protocol"),
    );
    assert.equal(called, false);
  });
});

// ─── Error surface ───────────────────────────────────────────────────────────

group("error surface", () => {
  test("every rejection is an UnsafeUrlError with code UNSAFE_URL", () => {
    try {
      parseSafeUrl("http://127.0.0.1/");
      assert.fail("should have thrown");
    } catch (err) {
      assert.equal(err.name, "UnsafeUrlError");
      assert.equal(err.code, "UNSAFE_URL");
      assert.equal(typeof err.reason, "string");
      assert.ok(err.reason.length > 0);
    }
  });

  test("messages don't leak the resolved internal address", async () => {
    // The user gets "private or reserved"; the address itself stays in logs.
    try {
      await assertSafeUrl("https://sneaky.test", {
        lookup: stubLookup({ "sneaky.test": "10.1.2.3" }),
      });
      assert.fail("should have thrown");
    } catch (err) {
      assert.doesNotMatch(err.message, /10\.1\.2\.3/);
    }
  });

  test("redirect cap is bounded and small", () => {
    assert.ok(_internals.MAX_REDIRECTS >= 1 && _internals.MAX_REDIRECTS <= 5);
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
