/**
 * Custom audiences — the targeting-spec slice.
 *
 * These live in a pure util specifically so they can be tested:
 * buildExplicitTargeting sits inside metaAdLauncherV2.js, which opens DB and
 * Redis connections at require time, so nothing in that file is reachable from
 * a unit test.
 *
 * The two invariants worth guarding hardest are both SILENT failures:
 * dropping audiences on an edit widens an ad set's targeting with no error,
 * and sending them under a regulated special ad category is a policy problem
 * Meta rejects with a message that doesn't name the cause.
 */

const assert = require("assert");

const {
  buildCustomAudienceTargeting,
  readCustomAudienceTargeting,
} = require("../../utils/customAudiences");

const {
  buildAdSetSchemaV2,
} = require("../../Validations/meta.v2.validator");

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

const audiences = [
  { id: "111", name: "Purchasers", subtype: "CUSTOM", size: 4200 },
  { id: "222", name: "Cart abandoners", subtype: "WEBSITE" },
];

console.log("\ntargeting spec");

check("included audiences become bare {id} refs", () => {
  const spec = buildCustomAudienceTargeting({ customAudiences: audiences });
  assert.deepStrictEqual(spec.custom_audiences, [{ id: "111" }, { id: "222" }]);
});

// Display metadata exists only so the wizard can render chips without a
// lookup per audience; Meta must never see it.
check("display metadata is stripped", () => {
  const spec = buildCustomAudienceTargeting({ customAudiences: audiences });
  for (const ref of spec.custom_audiences) {
    assert.deepStrictEqual(Object.keys(ref), ["id"]);
  }
});

check("exclusions map to excluded_custom_audiences", () => {
  const spec = buildCustomAudienceTargeting({
    excludedCustomAudiences: [{ id: "333", name: "Existing customers" }],
  });
  assert.deepStrictEqual(spec.excluded_custom_audiences, [{ id: "333" }]);
  assert.strictEqual(spec.custom_audiences, undefined);
});

// Meta rejects the whole ad set when an audience appears twice, and a user can
// easily add the same one from search and again from a suggestion.
check("duplicate ids are collapsed", () => {
  const spec = buildCustomAudienceTargeting({
    customAudiences: [{ id: "111" }, { id: "111" }, { id: "222" }],
  });
  assert.deepStrictEqual(spec.custom_audiences, [{ id: "111" }, { id: "222" }]);
});

check("blank and missing ids are dropped, not sent empty", () => {
  const spec = buildCustomAudienceTargeting({
    customAudiences: [{ id: "" }, { name: "no id" }, { id: "  " }, { id: "9" }],
  });
  assert.deepStrictEqual(spec.custom_audiences, [{ id: "9" }]);
});

// An empty array is NOT the same as an absent field: sending
// `custom_audiences: []` on an ad set that had audiences is how an edit
// silently widens its targeting.
check("no audiences emits no keys at all", () => {
  assert.deepStrictEqual(buildCustomAudienceTargeting({}), {});
  assert.deepStrictEqual(
    buildCustomAudienceTargeting({ customAudiences: [], excludedCustomAudiences: [] }),
    {},
  );
  assert.deepStrictEqual(buildCustomAudienceTargeting(null), {});
});

console.log("\nspecial ad category gate");

// Regulated categories restrict audience targeting for the same
// anti-discrimination reason they restrict interests. We take the restrictive
// path deliberately — see the util's docblock.
check("a regulated campaign emits nothing, even with audiences picked", () => {
  const spec = buildCustomAudienceTargeting(
    { customAudiences: audiences, excludedCustomAudiences: [{ id: "333" }] },
    { blocked: true },
  );
  assert.deepStrictEqual(spec, {});
});

check("blocked:false behaves exactly like no options", () => {
  const withFlag = buildCustomAudienceTargeting(
    { customAudiences: audiences },
    { blocked: false },
  );
  const without = buildCustomAudienceTargeting({ customAudiences: audiences });
  assert.deepStrictEqual(withFlag, without);
});

console.log("\nedit read-back");

// THE silent failure: updateAdSetV2 rebuilds targeting from scratch, so an
// audience not read back here is dropped on the next save and the ad set
// widens to everyone it was excluding — with no error anywhere.
check("Meta's targeting reads back into form shape", () => {
  const form = readCustomAudienceTargeting({
    custom_audiences: [{ id: "111", name: "Purchasers" }],
    excluded_custom_audiences: [{ id: "333", name: "Existing customers" }],
  });
  assert.deepStrictEqual(form.customAudiences, [{ id: "111", name: "Purchasers" }]);
  assert.deepStrictEqual(form.excludedCustomAudiences, [
    { id: "333", name: "Existing customers" },
  ]);
});

check("an audience with no name still round-trips", () => {
  // Dropping it would silently widen the ad set; showing the bare id is worse
  // UI but correct behaviour.
  const form = readCustomAudienceTargeting({ custom_audiences: [{ id: "111" }] });
  assert.deepStrictEqual(form.customAudiences, [{ id: "111", name: "" }]);
});

check("reads through the SDK's _data wrapper", () => {
  const form = readCustomAudienceTargeting({
    custom_audiences: [{ _data: { id: "111", name: "Wrapped" } }],
  });
  assert.deepStrictEqual(form.customAudiences, [{ id: "111", name: "Wrapped" }]);
});

check("an ad set with no audiences reads back as empty arrays", () => {
  const form = readCustomAudienceTargeting({});
  assert.deepStrictEqual(form.customAudiences, []);
  assert.deepStrictEqual(form.excludedCustomAudiences, []);
  assert.deepStrictEqual(readCustomAudienceTargeting(null).customAudiences, []);
});

// Round-trip: what we send must survive a read and rebuild unchanged, or an
// edit-then-save quietly changes the targeting.
check("build → read → build is stable", () => {
  const sent = buildCustomAudienceTargeting({
    customAudiences: audiences,
    excludedCustomAudiences: [{ id: "333" }],
  });
  // Meta enriches the ids it received with names on read.
  const readBack = readCustomAudienceTargeting({
    custom_audiences: sent.custom_audiences.map((r) => ({ ...r, name: "n" })),
    excluded_custom_audiences: sent.excluded_custom_audiences.map((r) => ({ ...r })),
  });
  const rebuilt = buildCustomAudienceTargeting(readBack);
  assert.deepStrictEqual(rebuilt, sent);
});

console.log("\nvalidator");

const geo = { locations: [{ type: "country", key: "IN", name: "India" }] };
const adSetBase = {
  adAccountId: "1",
  campaignId: "2",
  name: "Ad set",
  objective: "OUTCOME_TRAFFIC",
  conversionLocation: "WEBSITE",
  pageId: "p",
  optimizationGoal: "LINK_CLICKS",
  billingEvent: "IMPRESSIONS",
  bidStrategy: "LOWEST_COST_WITHOUT_CAP",
  dailyBudget: 10000,
  startTime: new Date(Date.now() + 86400000).toISOString(),
};
const schema = buildAdSetSchemaV2("OUTCOME_TRAFFIC", "WEBSITE");
const validateTargeting = (targeting) =>
  schema.validate({ ...adSetBase, targeting });

check("the ad-set schema accepts audience references", () => {
  const r = validateTargeting({ ...geo, customAudiences: audiences });
  assert.ok(!r.error, r.error && r.error.message);
  assert.strictEqual(r.value.targeting.customAudiences.length, 2);
});

check("an audience without an id is rejected", () => {
  const r = validateTargeting({ ...geo, customAudiences: [{ name: "no id" }] });
  assert.ok(r.error);
  assert.match(r.error.details[0].message, /id.*required/i);
});

// Absent must normalise to [] so downstream code never branches on undefined.
check("both fields default to empty arrays", () => {
  const r = validateTargeting(geo);
  assert.ok(!r.error, r.error && r.error.message);
  assert.deepStrictEqual(r.value.targeting.customAudiences, []);
  assert.deepStrictEqual(r.value.targeting.excludedCustomAudiences, []);
});

// Meta rejects the whole ad set when an audience is on both lists, with a
// message naming neither the audience nor the list — and the picker's Include
// and Exclude buttons sit on the same row, so it takes one misclick to reach.
// Mirrored in the frontend engine (wizardValidation.js validateAdSet).
check("an audience on both lists is rejected", () => {
  const r = validateTargeting({
    ...geo,
    customAudiences: [{ id: "111", name: "Purchasers" }],
    excludedCustomAudiences: [{ id: "111", name: "Purchasers" }],
  });
  assert.ok(r.error);
  // The message must name the audience — "invalid targeting" would leave the
  // user hunting through two lists.
  assert.match(r.error.message, /Purchasers.*included and excluded/);
});

check("the clash message falls back to the id when the name is missing", () => {
  const r = validateTargeting({
    ...geo,
    customAudiences: [{ id: "111" }],
    excludedCustomAudiences: [{ id: "111" }],
  });
  assert.ok(r.error);
  assert.match(r.error.message, /"111"/);
});

check("different audiences on each list are fine", () => {
  const r = validateTargeting({
    ...geo,
    customAudiences: [{ id: "111", name: "Purchasers" }],
    excludedCustomAudiences: [{ id: "222", name: "Cart abandoners" }],
  });
  assert.ok(!r.error, r.error && r.error.message);
});

console.log(
  failures === 0
    ? "\ncustomAudiences: all checks passed\n"
    : `\ncustomAudiences: ${failures} check(s) failed\n`,
);
process.exit(failures === 0 ? 0 : 1);
