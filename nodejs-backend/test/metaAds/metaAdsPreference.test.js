const assert = require("assert");
const MetaAdsPreference = require("../../Module/metaAds/metaAdsPreference");
const {
  TABLE_LEVELS,
  defaultPreference,
  normalizePreference,
} = MetaAdsPreference;
const { getDefaultVisibleKeys } = require("../../config/metricsCatalog");
const {
  updatePreferenceSchema,
  TABLE_METRIC_CAP,
} = require("../../Validations/metaAdsPreference.validator");

// ── The data-safety invariant ──────────────────────────────────────────────
// This model was renamed from "AnalyticsMetricsPreference", whose pluralized
// collection holds every already-saved preference. The `collection` pin in
// the schema is what keeps reads pointed at that data. Drop the pin and the
// model resolves to `metaadspreferences` instead — every user silently looks
// brand-new, with no error anywhere. Assert it so nobody "tidies" it away.
assert.strictEqual(
  MetaAdsPreference.collection.name,
  "analyticsmetricspreferences",
  "collection pin removed — this would orphan every saved preference",
);

// ── normalizePreference ────────────────────────────────────────────────────
// Reads use .lean(), which does NOT apply Mongoose defaults, so every read
// path must be able to fill out a partial/absent document itself.
const DEFAULTS = getDefaultVisibleKeys();

// no document at all -> full default shape
const fresh = normalizePreference(null, "u1");
assert.deepStrictEqual(fresh.analytics.visibleMetricKeys, DEFAULTS);
assert.strictEqual(fresh.userId, "u1");
for (const level of TABLE_LEVELS) {
  assert.deepStrictEqual(fresh.tables[level], [], `${level} columns default to opt-in empty`);
}

// empty document (lean doc with nothing set) -> same as fresh
assert.deepStrictEqual(
  normalizePreference({}, "u1").analytics.visibleMetricKeys,
  DEFAULTS,
);

// LEGACY shape: a doc written before namespacing carried a top-level
// visibleMetricKeys. It must keep working identically after the rename —
// this is the "existing user's saved selection still loads" guarantee.
const legacy = normalizePreference(
  { userId: "u1", visibleMetricKeys: ["spend", "ctr"] },
  "u1",
);
assert.deepStrictEqual(legacy.analytics.visibleMetricKeys, ["spend", "ctr"]);

// Namespaced value wins over the legacy field when both exist (a user who
// saved once under the new shape shouldn't see the stale legacy list).
const both = normalizePreference(
  { userId: "u1", visibleMetricKeys: ["spend"], analytics: { visibleMetricKeys: ["cpc"] } },
  "u1",
);
assert.deepStrictEqual(both.analytics.visibleMetricKeys, ["cpc"]);

// An EXPLICITLY empty table list must survive — it means "user cleared every
// column", which is different from "unset" and must not be re-filled.
const cleared = normalizePreference(
  { userId: "u1", tables: { campaign: [] } },
  "u1",
);
assert.deepStrictEqual(cleared.tables.campaign, []);

// A saved table selection round-trips.
const withCols = normalizePreference(
  { userId: "u1", tables: { adset: ["spend", "actions.purchase"] } },
  "u1",
);
assert.deepStrictEqual(withCols.tables.adset, ["spend", "actions.purchase"]);
assert.deepStrictEqual(withCols.tables.campaign, []);

// defaultPreference returns independent arrays (no shared mutable state
// leaking between users across requests).
const d1 = defaultPreference("a");
const d2 = defaultPreference("b");
d1.tables.campaign.push("spend");
assert.deepStrictEqual(d2.tables.campaign, [], "defaults must not share array refs");

// ── validator ──────────────────────────────────────────────────────────────
const ok = (body, why) =>
  assert.strictEqual(updatePreferenceSchema.validate(body).error, undefined, why);
const bad = (body, why) =>
  assert.ok(updatePreferenceSchema.validate(body).error, why);

ok({ analytics: { visibleMetricKeys: ["spend"] } }, "analytics-only patch");
ok({ tables: { campaign: ["spend", "ctr"] } }, "tables-only patch");
ok({ tables: { ad: [] } }, "clearing a table's columns is valid");
ok(
  { analytics: { visibleMetricKeys: ["spend"] }, tables: { adset: ["cpc"] } },
  "both namespaces at once",
);

bad({}, "empty patch names no namespace");
bad({ analytics: { visibleMetricKeys: [] } }, "an empty KPI dashboard is not valid");
bad({ analytics: { visibleMetricKeys: ["not_a_real_metric"] } }, "unknown catalog key");
bad({ tables: { campaign: ["nope"] } }, "unknown catalog key in tables");
bad({ tables: { notALevel: ["spend"] } }, "unknown table level");
bad({ tables: {} }, "tables present but empty names no level");
bad(
  { tables: { campaign: ["spend", "spend"] } },
  "duplicate keys would render duplicate columns",
);
bad(
  { tables: { campaign: Array.from({ length: TABLE_METRIC_CAP + 1 }, (_, i) => `k${i}`) } },
  "beyond the per-table column cap",
);

console.log("metaAdsPreference tests passed");
