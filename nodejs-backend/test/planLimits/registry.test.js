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
assert.ok(msg.includes("2 of 2"), `message should state usage: ${msg}`);
assert.ok(
  msg.includes("across all your ad accounts"),
  `message must convey the cross-account scope, or an under-cap-looking account reads as a bug: ${msg}`,
);
assert.ok(msg.includes(campaigns.remedy), "message should tell the user how to resolve it");

// Singular vs plural on the unit.
assert.ok(buildPlanLimitMessage(campaigns, { limit: 1, current: 1 }).includes("1 campaign "));
assert.ok(buildPlanLimitMessage(campaigns, { limit: 5, current: 5 }).includes("5 campaigns "));

// A limit with no custom remedy still produces a usable sentence.
const generic = buildPlanLimitMessage(
  { unit: "widget", scopeNote: "" },
  { limit: 4, current: 4 },
);
assert.ok(generic.includes("4 of 4 widgets"), generic);
assert.ok(generic.length > 20, "fallback message should still be actionable");

console.log("planLimits registry tests passed");
