/**
 * Cache invalidation — do the SCAN patterns actually match the keys we write?
 *
 * This file exists because the answer was "no" for three weeks and nothing
 * caught it. CACHE_SHAPE landed on the entity-list keys on 2026-08-20, putting
 * a `v3` segment BEFORE the userId; every invalidator still matched
 * `<prefix>:<userId>:*`, so Redis found nothing to delete and pausing a
 * campaign left the stale status on screen for the full 2-hour TTL.
 *
 * Asserting the pattern STRINGS would not have caught it — they looked
 * perfectly reasonable. So these tests build a key exactly as the controller
 * builds it, build the pattern exactly as the invalidator builds it, and
 * check they match under Redis glob semantics.
 */

const assert = require("assert");

const {
  CACHE_SHAPE,
  cacheInvalidationPatterns,
} = require("../../utils/metaCacheKeys");

let failures = 0;
function check(label, fn) {
  try {
    fn();
    console.log(`  PASS  ${label}`);
  } catch (err) {
    failures += 1;
    console.error(`  FAIL  ${label}\n        ${err.message}`);
  }
}

// Redis glob, restricted to the one metacharacter our patterns use: `*`
// matches any sequence, INCLUDING `:`. Everything else is literal.
//
// No regex-escaping: cache patterns are built from ids and fixed prefixes, so
// they only ever contain [A-Za-z0-9_:*-]. Asserted rather than assumed — a
// pattern with a regex metacharacter in it would make this helper lie about
// what Redis does, and a lying test harness is worse than no test.
//
// `.*` for `*` is exact here because cache keys never contain newlines.
const SAFE_PATTERN = /^[A-Za-z0-9_:*-]+$/;
function globMatches(pattern, key) {
  assert.ok(SAFE_PATTERN.test(pattern), `unescapable pattern: ${pattern}`);
  const rx = pattern.split("*").join(".*");
  return new RegExp(`^${rx}$`).test(key);
}

const matchesAny = (patterns, key) => patterns.some((p) => globMatches(p, key));

// Real-ish ids: a 24-hex Mongo ObjectId and a numeric Facebook id.
const USER = "68b1f0c2a4d3e5f60718293a";
const OTHER_USER = "5f0e1d2c3b4a59687706152e";
const FB = "10223344556677889";
const ACCT = "act_1234567890";

// metaCacheScope(userId, facebookId)
const scope = (u = USER, f = FB) => `${u}:${f}`;

console.log("\nglob helper");

check("the helper models Redis semantics: * crosses ':'", () => {
  assert.ok(globMatches("a:*", "a:b:c:d"));
  assert.ok(globMatches("a:*:c", "a:b:x:y:c"));
  assert.ok(!globMatches("a:b", "a:bc"));
});

console.log("\nshape-versioned keys (the regression)");

// This is THE assertion. Written the old way — a single
// `${prefix}:${userId}:*` — it fails.
check("a versioned entity-list key is matched", () => {
  const key = `metaCampaigns:${CACHE_SHAPE}:${scope()}:${ACCT}`;
  const patterns = cacheInvalidationPatterns("metaCampaigns", `${USER}:*`);
  assert.ok(matchesAny(patterns, key), `no pattern matched ${key}`);
});

check("the OLD single pattern would NOT have matched it", () => {
  // Kept as a regression witness: this is precisely the bug.
  const key = `metaCampaigns:${CACHE_SHAPE}:${scope()}:${ACCT}`;
  assert.ok(!globMatches(`metaCampaigns:${USER}:*`, key));
});

check("every versioned prefix the controller writes is matched", () => {
  const versioned = [
    ["metaCampaigns", `${ACCT}`],
    ["metaAdsets", `${ACCT}:all`],
    ["metaCampaignAds", "120210000000000000"],
    ["metaAdSetAds", "120220000000000000"],
    ["metaRecommendations", `${ACCT}`],
    ["metaAdPreview", "120230000000000000"],
    ["metaCustomAudiences", `${ACCT}`],
  ];
  for (const [prefix, tail] of versioned) {
    const key = `${prefix}:${CACHE_SHAPE}:${scope()}:${tail}`;
    const patterns = cacheInvalidationPatterns(prefix, `${USER}:*`);
    assert.ok(matchesAny(patterns, key), `${prefix} not matched: ${key}`);
  }
});

console.log("\nunversioned keys still work");

// The fix must not regress the keys that never carried a shape segment —
// metaDashboard is the one that kept working through the bug, which is why it
// read as a flaky table rather than a broken cache.
check("an unversioned key is still matched", () => {
  const key = `metaDashboard:${scope()}:${ACCT}:last_30d`;
  const patterns = cacheInvalidationPatterns("metaDashboard", `${USER}:*`);
  assert.ok(matchesAny(patterns, key));
});

check("both conventions are emitted, unversioned first", () => {
  const patterns = cacheInvalidationPatterns("metaLeads", `${USER}:*`);
  assert.deepStrictEqual(patterns, [
    `metaLeads:${USER}:*`,
    `metaLeads:${CACHE_SHAPE}:${USER}:*`,
  ]);
});

console.log("\nblast radius");

// A pattern that swept up a neighbouring user's keys would be far worse than
// one that swept up none.
check("another user's keys are never matched", () => {
  const patterns = cacheInvalidationPatterns("metaCampaigns", `${USER}:*`);
  for (const key of [
    `metaCampaigns:${CACHE_SHAPE}:${scope(OTHER_USER)}:${ACCT}`,
    `metaCampaigns:${scope(OTHER_USER)}:${ACCT}`,
  ]) {
    assert.ok(!matchesAny(patterns, key), `leaked into ${key}`);
  }
});

// `metaCampaigns` is a strict prefix of nothing, but `metaAdSet`/`metaAdSetAds`
// and `metaDT*` share leading text — the ':' after the prefix is what keeps
// them apart, so guard it.
check("a prefix never matches a longer sibling prefix", () => {
  const patterns = cacheInvalidationPatterns("metaAdsets", `${USER}:*`);
  assert.ok(
    !matchesAny(patterns, `metaAdsetsExtra:${CACHE_SHAPE}:${scope()}:${ACCT}`),
  );
  const dt = cacheInvalidationPatterns("metaDTSearch", `${USER}:*`);
  assert.ok(!matchesAny(dt, `metaDTSearchAll:${scope()}:${ACCT}`));
});

console.log("\ntargeted invalidators");

// invalidateAfterCreate + bustAccountCaches narrow by entity id. Both had the
// facebookId position wrong at some point, so pin the real key layouts.
check("invalidateAfterCreate tails match the keys they target", () => {
  const cases = [
    ["metaCampaigns", `${USER}:*:${ACCT}`, `metaCampaigns:${CACHE_SHAPE}:${scope()}:${ACCT}`],
    ["metaDashboard", `${USER}:*:${ACCT}:*`, `metaDashboard:${scope()}:${ACCT}:last_7d`],
    ["metaAdsets", `${USER}:*:*:c1`, `metaAdsets:${CACHE_SHAPE}:${scope()}:${ACCT}:c1`],
    ["metaCampaignAds", `${USER}:*:c1`, `metaCampaignAds:${CACHE_SHAPE}:${scope()}:c1`],
    ["metaAdSetAds", `${USER}:*:s1`, `metaAdSetAds:${CACHE_SHAPE}:${scope()}:s1`],
  ];
  for (const [prefix, tail, key] of cases) {
    assert.ok(
      matchesAny(cacheInvalidationPatterns(prefix, tail), key),
      `${prefix} tail "${tail}" missed ${key}`,
    );
  }
});

// bustAccountCaches (the audit apply-fix path) has no facebookId to hand, so
// it wildcards that segment. Verify that still lands.
check("bustAccountCaches' facebookId wildcard lands", () => {
  const cases = [
    ["metaAudit", `${USER}:*:${ACCT}`, `metaAudit:${scope()}:${ACCT}`],
    ["metaInsights", `${USER}:*:${ACCT}:*`, `metaInsights:${scope()}:${ACCT}:last_30d:account:none:none:none`],
    ["metaAnalytics", `${USER}:*:${ACCT}:*`, `metaAnalytics:${scope()}:${ACCT}:p:last_30d:abc123`],
    ["metaCampaigns", `${USER}:*:${ACCT}`, `metaCampaigns:${CACHE_SHAPE}:${scope()}:${ACCT}`],
  ];
  for (const [prefix, tail, key] of cases) {
    assert.ok(
      matchesAny(cacheInvalidationPatterns(prefix, tail), key),
      `${prefix} tail "${tail}" missed ${key}`,
    );
  }
});

console.log(
  failures === 0
    ? "\ncacheInvalidation: all checks passed\n"
    : `\ncacheInvalidation: ${failures} check(s) failed\n`,
);
process.exit(failures === 0 ? 0 : 1);
