const assert = require("assert");
const {
  getMetricsCatalog,
  getDefaultVisibleKeys,
  extractMetricValue,
} = require("../../config/metricsCatalog");

// Rollout requirement: an existing user with no saved preference must see
// pixel-identical output to before this feature existed — the 8 metrics
// getAnalyticsData used to hardcode, in the same order.
assert.deepStrictEqual(
  getDefaultVisibleKeys(),
  ["spend", "impressions", "clicks", "reach", "ctr", "cpc", "cpm", "frequency"],
);

// Every catalog entry must have a unique key — getAnalyticsData/the Joi
// validator both key off this, a duplicate would silently shadow a metric.
const catalog = getMetricsCatalog();
const keys = catalog.map((m) => m.key);
assert.strictEqual(new Set(keys).size, keys.length, "catalog keys must be unique");

// Every entry declares the fields extractMetricValue/AnalyticsPanel rely on.
for (const entry of catalog) {
  assert.ok(entry.key && entry.label && entry.group && entry.format, `entry ${entry.key} missing a required field`);
  assert.ok(entry.kind === "scalar" || entry.kind === "action_list", `entry ${entry.key} has invalid kind`);
  if (entry.kind === "action_list") {
    assert.ok(
      Array.isArray(entry.actionTypes) && entry.actionTypes.length > 0,
      `action_list entry ${entry.key} missing actionTypes`,
    );
  }
}

// A metric and its cost/value/conversion siblings must dedup over the SAME
// action_types. The original bug was an asymmetry here: the count read one
// action_type while the cost read another, so an account showed 1,262 App
// Installs alongside ₹0 Cost per App Install.
const installCount = catalog.find((m) => m.key === "actions.mobile_app_install");
const installCost = catalog.find((m) => m.key === "cost_per_action_type.mobile_app_install");
assert.deepStrictEqual(
  installCount.actionTypes,
  installCost.actionTypes,
  "install count and cost must resolve over identical action_types",
);
assert.ok(
  installCount.actionTypes.includes("mobile_app_install") &&
    installCount.actionTypes.includes("omni_app_install"),
  "app-install metrics must consider both the legacy and omni action_types",
);

// extractMetricValue — scalar: direct field lookup, missing field -> 0.
assert.strictEqual(
  extractMetricValue({ kind: "scalar", metaField: "spend" }, { spend: "123.45" }),
  123.45,
);
assert.strictEqual(
  extractMetricValue({ kind: "scalar", metaField: "spend" }, {}),
  0,
);

// extractMetricValue — action_list: finds the matching action_type inside
// the array field; a present field with no matching action_type -> 0.
assert.strictEqual(
  extractMetricValue(
    { kind: "action_list", metaField: "actions", actionType: "purchase" },
    { actions: [{ action_type: "purchase", value: "7" }, { action_type: "lead", value: "3" }] },
  ),
  7,
);
assert.strictEqual(
  extractMetricValue(
    { kind: "action_list", metaField: "actions", actionType: "purchase" },
    { actions: [{ action_type: "lead", value: "3" }] },
  ),
  0,
);
assert.strictEqual(
  extractMetricValue(
    { kind: "action_list", metaField: "actions", actionType: "purchase" },
    {},
  ),
  0,
);

// extractMetricValue — missing row entirely -> 0, never throws.
assert.strictEqual(
  extractMetricValue({ kind: "scalar", metaField: "spend" }, null),
  0,
);

// extractMetricValue — MAX (not sum) across an entry's actionTypes. Meta
// reports the same conversions under both a legacy and an `omni_*`
// action_type; summing would double-count (halving cost-per metrics), and
// reading only the legacy one returns 0 whenever Meta populated only omni —
// the exact shape of the reported CPI bug.
const installEntry = {
  kind: "action_list",
  metaField: "cost_per_action_type",
  actionTypes: ["mobile_app_install", "omni_app_install"],
};
// only omni populated -> must still resolve (this is the ₹0 regression)
assert.strictEqual(
  extractMetricValue(installEntry, {
    cost_per_action_type: [{ action_type: "omni_app_install", value: "95.83" }],
  }),
  95.83,
);
// only legacy populated -> resolves
assert.strictEqual(
  extractMetricValue(installEntry, {
    cost_per_action_type: [{ action_type: "mobile_app_install", value: "95.83" }],
  }),
  95.83,
);
// both populated (same conversions reported twice) -> max, NOT 191.66
assert.strictEqual(
  extractMetricValue(installEntry, {
    cost_per_action_type: [
      { action_type: "mobile_app_install", value: "95.83" },
      { action_type: "omni_app_install", value: "95.83" },
    ],
  }),
  95.83,
);
// neither populated -> 0
assert.strictEqual(
  extractMetricValue(installEntry, { cost_per_action_type: [{ action_type: "purchase", value: "10" }] }),
  0,
);

// Regression coverage for the reported gap: searching "cpi" (Cost per
// Install) must find a real catalog entry — App Promotion metrics are a
// distinct group from Sales/Leads, easy to omit when curating by hand.
assert.ok(
  catalog.some((m) => m.key === "cost_per_action_type.mobile_app_install"),
  "catalog must include Cost per App Install (regression: reported as missing)",
);
assert.ok(
  catalog.some((m) => m.group === "app"),
  "catalog must have an app-install metrics group",
);

// Every action_list entry's metaField must be one Meta actually returns
// (i.e. one of the fields getInsightsFields() requests) — a typo here would
// silently extract nothing at runtime instead of failing loudly.
const VALID_ACTION_LIST_FIELDS = new Set([
  "actions",
  "action_values",
  "cost_per_action_type",
  "conversions",
  "conversion_values",
  "video_play_actions",
  "video_p25_watched_actions",
  "video_p50_watched_actions",
  "video_p75_watched_actions",
  "video_p95_watched_actions",
  "video_p100_watched_actions",
  "video_avg_time_watched_actions",
  "purchase_roas",
  "website_purchase_roas",
]);
for (const entry of catalog) {
  if (entry.kind === "action_list") {
    assert.ok(
      VALID_ACTION_LIST_FIELDS.has(entry.metaField),
      `entry ${entry.key} references unknown metaField ${entry.metaField}`,
    );
  }
}

console.log(`metricsCatalog tests passed (${catalog.length} catalog entries)`);
