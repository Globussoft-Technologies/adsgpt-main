const assert = require("assert");
const {
  buildMetricsMap,
  ID_FIELD_BY_LEVEL,
} = require("../../utils/metaTableMetrics");
const { getMetricsCatalog } = require("../../config/metricsCatalog");

const pick = (...keys) => getMetricsCatalog().filter((m) => keys.includes(m.key));

// ── keys by the right id field per level ───────────────────────────────────
assert.deepStrictEqual(ID_FIELD_BY_LEVEL, {
  campaign: "campaign_id",
  adset: "adset_id",
  ad: "ad_id",
});

const entries = pick("spend", "ctr");

assert.deepStrictEqual(
  buildMetricsMap(
    [{ campaign_id: "c1", spend: "100.5", ctr: "1.25" }],
    entries,
    "campaign",
  ),
  { c1: { spend: 100.5, ctr: 1.25 } },
);

// Same rows at adset level key off adset_id, not campaign_id.
assert.deepStrictEqual(
  buildMetricsMap(
    [{ campaign_id: "c1", adset_id: "as1", spend: "10" }],
    pick("spend"),
    "adset",
  ),
  { as1: { spend: 10 } },
);

// Rows lacking the level's id field are skipped rather than keyed under
// "undefined" (which would collide every such row into one bogus entry).
assert.deepStrictEqual(
  buildMetricsMap([{ spend: "10" }], pick("spend"), "ad"),
  {},
);

// The SDK hands back objects with the payload under `_data`; raw objects are
// also accepted so fixtures stay readable.
assert.deepStrictEqual(
  buildMetricsMap([{ _data: { ad_id: "a1", spend: "7" } }], pick("spend"), "ad"),
  { a1: { spend: 7 } },
);

// Empty/absent input is safe.
assert.deepStrictEqual(buildMetricsMap([], entries, "campaign"), {});
assert.deepStrictEqual(buildMetricsMap(null, entries, "campaign"), {});

// ── the regression this endpoint must not reintroduce ──────────────────────
// Meta reports app installs under BOTH `mobile_app_install` and
// `omni_app_install` and populates them inconsistently. Reading only the
// legacy name produced an account showing "1,262 App Installs" beside
// "₹0 Cost per App Install". buildMetricsMap must resolve BOTH the count and
// the cost off the same action-type list, so a row carrying ONLY the omni
// variant still yields both numbers.
const installEntries = pick(
  "actions.mobile_app_install",
  "cost_per_action_type.mobile_app_install",
);
assert.strictEqual(installEntries.length, 2, "install count + cost must both exist in the catalog");

const omniOnlyRow = {
  campaign_id: "c1",
  actions: [{ action_type: "omni_app_install", value: "1262" }],
  cost_per_action_type: [{ action_type: "omni_app_install", value: "43.69" }],
};
assert.deepStrictEqual(buildMetricsMap([omniOnlyRow], installEntries, "campaign"), {
  c1: {
    "actions.mobile_app_install": 1262,
    "cost_per_action_type.mobile_app_install": 43.69,
  },
});

// Both variants present (the same installs reported twice) -> max, not sum.
const bothRow = {
  campaign_id: "c1",
  actions: [
    { action_type: "mobile_app_install", value: "1262" },
    { action_type: "omni_app_install", value: "1262" },
  ],
};
assert.strictEqual(
  buildMetricsMap([bothRow], pick("actions.mobile_app_install"), "campaign").c1[
    "actions.mobile_app_install"
  ],
  1262,
  "duplicate reporting must not double-count",
);

// A metric the row has no data for resolves to 0, not undefined — the
// frontend distinguishes "entity absent from the response" (renders —) from
// "present with a zero" (renders 0).
assert.strictEqual(
  buildMetricsMap([{ campaign_id: "c1", spend: "5" }], entries, "campaign").c1.ctr,
  0,
);

console.log("tableMetrics tests passed");
