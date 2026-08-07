const assert = require("assert");
const {
  KEY_PATTERN,
  PLAN_LIMIT_KEYS,
  listPlanLimits,
  getPlanLimitDef,
  isValidPlanLimitKey,
  serializePlanLimits,
  resolvePlanLimitValues,
  buildPlanLimitMessage,
} = require("../../config/planLimitsRegistry");

const DEFS = listPlanLimits();
assert.ok(DEFS.length > 0, "registry must declare at least one limit");

// ── key safety — the Mongo trap ─────────────────────────────────────────────
// Keys are persisted as field names inside the `limits` sub-object and used in
// dotted `$set` paths (`limits.<key>`). A dot in a key would be parsed as a
// path separator, writing a NESTED object instead of a literal field and
// silently breaking every read of that limit.
for (const def of DEFS) {
  assert.ok(
    KEY_PATTERN.test(def.key),
    `limit key "${def.key}" must match ${KEY_PATTERN} (namespaced, lowercase, NO DOTS)`,
  );
  assert.ok(!def.key.includes("."), `limit key "${def.key}" must not contain a dot`);
}

// ── uniqueness ──────────────────────────────────────────────────────────────
assert.strictEqual(
  new Set(PLAN_LIMIT_KEYS).size,
  PLAN_LIMIT_KEYS.length,
  "limit keys must be unique",
);
const legacyFields = DEFS.map((d) => d.legacyField).filter(Boolean);
assert.strictEqual(
  new Set(legacyFields).size,
  legacyFields.length,
  "legacyField mappings must be unique — two limits reading the same old column would alias",
);

// ── required shape ──────────────────────────────────────────────────────────
for (const def of DEFS) {
  for (const field of ["key", "label", "group", "unit", "description", "enforcement"]) {
    assert.ok(def[field], `limit "${def.key}" is missing required field "${field}"`);
  }
  assert.ok(
    ["hard", "advisory"].includes(def.enforcement),
    `limit "${def.key}" has invalid enforcement "${def.enforcement}"`,
  );
  // A "hard" limit promises a real gate, which needs something to count.
  assert.strictEqual(
    typeof def.counter,
    "function",
    `limit "${def.key}" must declare a counter thunk`,
  );
}

// ── lookups ─────────────────────────────────────────────────────────────────
assert.strictEqual(getPlanLimitDef(DEFS[0].key), DEFS[0]);
assert.strictEqual(getPlanLimitDef("nope:missing"), null);
assert.strictEqual(getPlanLimitDef(undefined), null);
assert.strictEqual(isValidPlanLimitKey(DEFS[0].key), true);
assert.strictEqual(isValidPlanLimitKey("nope:missing"), false);

// ── `enabled: false` means invisible AND unenforced ─────────────────────────
// A disabled limit must not resolve, so checkPlanLimit/requireManagedCampaign
// no-op on it and a value left in the DB from when it was enabled can't
// silently keep enforcing. `meta:ad_accounts` is disabled today (management
// wants campaigns capped, not ad accounts) — if it's ever re-enabled this
// assertion should be repointed at whatever is disabled then, not deleted.
assert.ok(
  DEFS.every((def) => def.enabled !== false),
  "listPlanLimits() must not expose disabled limits",
);
assert.strictEqual(
  getPlanLimitDef("meta:ad_accounts"),
  null,
  "meta:ad_accounts is disabled and must not resolve",
);
assert.ok(
  !PLAN_LIMIT_KEYS.includes("meta:ad_accounts"),
  "a disabled limit must not appear in PLAN_LIMIT_KEYS",
);
assert.ok(
  !("meta:ad_accounts" in resolvePlanLimitValues({ maxAdAccounts: 3 })),
  "a stored value for a disabled limit must be ignored, not resolved",
);
assert.ok(
  !serializePlanLimits().some((d) => d.key === "meta:ad_accounts"),
  "a disabled limit must not render an admin column",
);

// ── serialization drops the counter thunks (must be JSON-safe for the admin UI)
const serialized = serializePlanLimits();
assert.strictEqual(serialized.length, DEFS.length);
assert.ok(
  serialized.every((entry) => entry.counter === undefined),
  "serialized registry must not leak counter thunks",
);
assert.doesNotThrow(() => JSON.stringify(serialized));

// ── resolvePlanLimitValues ──────────────────────────────────────────────────
const [first] = DEFS;

// No document at all -> every key unlimited.
assert.deepStrictEqual(
  resolvePlanLimitValues(null),
  Object.fromEntries(PLAN_LIMIT_KEYS.map((k) => [k, null])),
);
assert.deepStrictEqual(
  resolvePlanLimitValues({}),
  Object.fromEntries(PLAN_LIMIT_KEYS.map((k) => [k, null])),
);

// Plain-object `limits` (what `.lean()` returns).
assert.strictEqual(resolvePlanLimitValues({ limits: { [first.key]: 7 } })[first.key], 7);

// Mongoose Map `limits` (what a hydrated doc returns).
assert.strictEqual(
  resolvePlanLimitValues({ limits: new Map([[first.key, 7]]) })[first.key],
  7,
);

// 0 is a REAL value (plan may manage nothing), not "unset" — a `||` fallback
// anywhere in the resolution chain would wrongly turn this into unlimited.
assert.strictEqual(resolvePlanLimitValues({ limits: { [first.key]: 0 } })[first.key], 0);

// Legacy column fallback: caps configured before limits became a keyed map
// must keep applying, or every already-configured plan silently reads as
// unlimited after the migration.
assert.strictEqual(
  resolvePlanLimitValues({ [first.legacyField]: 3 })[first.key],
  3,
  "legacy column must be read when the new map has no entry",
);

// The new map wins over the legacy column when both are present.
assert.strictEqual(
  resolvePlanLimitValues({ limits: { [first.key]: 9 }, [first.legacyField]: 3 })[first.key],
  9,
);

// Garbage in a stored value degrades to unlimited rather than NaN-comparing
// (`current < NaN` is false, which would block EVERY request).
assert.strictEqual(resolvePlanLimitValues({ limits: { [first.key]: "abc" } })[first.key], null);
assert.strictEqual(resolvePlanLimitValues({ limits: { [first.key]: null } })[first.key], null);

// ── message building ────────────────────────────────────────────────────────
const campaigns = getPlanLimitDef("meta:campaigns");
assert.ok(campaigns, "meta:campaigns must exist — it's the one hard-enforced limit today");
const msg = buildPlanLimitMessage(campaigns, { limit: 2, current: 2 });
assert.ok(msg.includes("2"), `message should state the allowance: ${msg}`);

// Must NOT print a "<current> of <limit>" pair. This message only fires when
// the limit is reached, so both numbers are equal and showing them is noise —
// and under the pre-slot-model counter, which could exceed the limit, it
// rendered live as "You're managing 366 of 10 campaigns allowed", which reads
// as a broken number rather than a plan message.
assert.ok(
  !/\d+\s+of\s+\d+/.test(msg),
  `message must not contain an "N of M" pair: ${msg}`,
);
// Defensive: even if a caller passes a nonsensical current > limit, the copy
// must stay coherent rather than echoing the bad number back at the user.
const drifted = buildPlanLimitMessage(campaigns, { limit: 10, current: 366 });
assert.ok(!drifted.includes("366"), `stale/oversized counts must not leak into copy: ${drifted}`);
assert.ok(!/\d+\s+of\s+\d+/.test(drifted), drifted);

// A plan with a limit of 0 can't be told to "release one" — it has nothing to
// release, so that case gets its own sentence.
const zero = buildPlanLimitMessage(campaigns, { limit: 0, current: 0 });
assert.ok(!/release/i.test(zero), `limit-0 copy must not suggest releasing: ${zero}`);
assert.ok(/upgrade/i.test(zero), `limit-0 copy should point at upgrading: ${zero}`);
// The limit counts CLAIMED SLOTS, not campaigns present in the Meta account,
// so the message must point at releasing one — telling a user to "delete a
// campaign" would be wrong advice under this model (they can keep the
// campaign in Meta and simply stop managing it here).
assert.ok(/releas/i.test(msg), `message must offer releasing a slot: ${msg}`);
assert.ok(msg.includes(campaigns.remedy), "message should tell the user how to resolve it");

// Singular vs plural on the unit — "1 campaigns" would look sloppy in a
// message users see on a failed launch.
const one = buildPlanLimitMessage(campaigns, { limit: 1, current: 1 });
assert.ok(one.includes("1 campaign,"), one);
assert.ok(!one.includes("1 campaigns"), one);
assert.ok(buildPlanLimitMessage(campaigns, { limit: 5, current: 5 }).includes("5 campaigns"));

// A limit with no custom remedy still produces a usable sentence.
const generic = buildPlanLimitMessage(
  { unit: "widget", scopeNote: "" },
  { limit: 4, current: 4 },
);
assert.ok(generic.includes("4 widgets"), generic);
assert.ok(!/\d+\s+of\s+\d+/.test(generic), generic);
assert.ok(/upgrade/i.test(generic), "fallback should still tell the user what to do");
assert.ok(generic.length > 20, "fallback message should still be actionable");

console.log("planLimits registry tests passed");
