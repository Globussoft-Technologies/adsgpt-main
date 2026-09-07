/**
 * Management operations — delete (ad set / ad), duplicate, and the derived
 * delivery signals that back the table's status column.
 *
 * These endpoints all mutate live Meta objects, so the invariants worth
 * pinning here are the ones that decide whether a mutation is even attempted:
 * what the validators accept, and how an entity's real delivery state is
 * derived from the three separate Meta fields that describe it.
 */

const assert = require("assert");

const {
  deleteAdSetSchema,
  deleteAdSchema,
  duplicateEntitySchema,
} = require("../../Validations/meta.validator");

const {
  normalizeDeliveryStatus,
  normalizeLearningStage,
  normalizeReviewFeedback,
} = require("../../utils/metaDelivery");

const {
  getAdFields,
  getAdSetFields,
  getCampaignFields,
} = require("../../utils/metaHelpers");

const {
  composeHeadline,
  labelRecommendationEnum,
} = require("../../utils/metaRecommendations");

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

console.log("\ndelete validators");

check("deleteAdSetSchema requires adSetId", () => {
  const { error } = deleteAdSetSchema.validate({ adAccountId: "act_1" });
  assert.ok(error, "expected a validation error");
  assert.match(error.details[0].message, /adSetId is required/);
});

check("deleteAdSchema requires adId", () => {
  const { error } = deleteAdSchema.validate({ adAccountId: "act_1" });
  assert.ok(error, "expected a validation error");
  assert.match(error.details[0].message, /adId is required/);
});

// The managed-campaign plan gate reads campaignId off the request. It stays
// OPTIONAL by design (absent = allowed, per updateAdStatusSchema's convention)
// — if this ever becomes required, every caller has to be updated in lockstep.
check("delete schemas keep campaignId optional", () => {
  assert.ok(!deleteAdSetSchema.validate({ adAccountId: "1", adSetId: "2" }).error);
  assert.ok(!deleteAdSchema.validate({ adAccountId: "1", adId: "2" }).error);
});

check("delete schemas reject unknown keys", () => {
  const { error } = deleteAdSetSchema.validate({
    adAccountId: "1",
    adSetId: "2",
    cascade: true,
  });
  assert.ok(error, "unknown keys must not be silently accepted");
});

console.log("\nduplicate validator");

// The single most important default in this batch: a duplicate that inherits
// ACTIVE starts spending immediately.
check("duplicate defaults to PAUSED", () => {
  const { error, value } = duplicateEntitySchema.validate({
    adAccountId: "1",
    level: "campaign",
    id: "2",
  });
  assert.ok(!error, error && error.message);
  assert.strictEqual(value.statusOption, "PAUSED");
});

check("duplicate defaults to a deep copy", () => {
  const { value } = duplicateEntitySchema.validate({
    adAccountId: "1",
    level: "campaign",
    id: "2",
  });
  assert.strictEqual(value.deepCopy, true);
});

check("deepCopy is rejected on ads, not silently ignored", () => {
  const { error } = duplicateEntitySchema.validate({
    adAccountId: "1",
    level: "ad",
    id: "2",
    deepCopy: true,
  });
  assert.ok(error, "expected deepCopy on an ad to be rejected");
  assert.match(error.details[0].message, /not applicable when duplicating an ad/);
});

check("ad duplication still accepts an explicit deepCopy:false", () => {
  const { error } = duplicateEntitySchema.validate({
    adAccountId: "1",
    level: "ad",
    id: "2",
    deepCopy: false,
  });
  assert.ok(!error, error && error.message);
});

check("duplicate rejects an unknown level", () => {
  const { error } = duplicateEntitySchema.validate({
    adAccountId: "1",
    level: "creative",
    id: "2",
  });
  assert.ok(error);
  assert.match(error.details[0].message, /level must be one of/);
});

check("duplicate accepts a cross-parent destination", () => {
  const { error, value } = duplicateEntitySchema.validate({
    adAccountId: "1",
    level: "adset",
    id: "2",
    targetCampaignId: "9",
  });
  assert.ok(!error, error && error.message);
  assert.strictEqual(value.targetCampaignId, "9");
});

console.log("\ndelivery status derivation");

// The bug this whole signal exists for: `status` says ACTIVE on a rejected ad
// because the user never paused it. Only effective_status tells the truth.
check("rejected ad reports Rejected, not Active", () => {
  const d = normalizeDeliveryStatus({
    status: "ACTIVE",
    effective_status: "DISAPPROVED",
  });
  assert.strictEqual(d.label, "Rejected");
  assert.strictEqual(d.tone, "bad");
  assert.strictEqual(d.diverged, true, "user status and Meta status disagree");
});

check("a genuinely active entity is not flagged as diverged", () => {
  const d = normalizeDeliveryStatus({
    status: "ACTIVE",
    effective_status: "ACTIVE",
  });
  assert.strictEqual(d.tone, "good");
  assert.strictEqual(d.diverged, false);
});

// Cached payloads written before effective_status was requested must still
// render — this is what stops the column going blank for up to REDIS_TTL
// after deploy.
check("falls back to status when effective_status is absent", () => {
  const d = normalizeDeliveryStatus({ status: "PAUSED" });
  assert.strictEqual(d.value, "PAUSED");
  assert.strictEqual(d.label, "Paused");
  assert.strictEqual(d.diverged, false);
});

check("an unrecognised Meta status renders raw rather than being dropped", () => {
  const d = normalizeDeliveryStatus({ effective_status: "SOME_NEW_ENUM" });
  assert.strictEqual(d.label, "SOME_NEW_ENUM");
  assert.strictEqual(d.tone, "unknown");
});

check("no status at all yields null", () => {
  assert.strictEqual(normalizeDeliveryStatus({}), null);
  assert.strictEqual(normalizeDeliveryStatus(null), null);
});

check("reads through the SDK's _data wrapper", () => {
  const d = normalizeDeliveryStatus({ _data: { effective_status: "PAUSED" } });
  assert.strictEqual(d.value, "PAUSED");
});

console.log("\nlearning phase");

// Meta's FAIL is what its own UI calls "Learning limited".
check("FAIL maps to Learning limited", () => {
  const l = normalizeLearningStage({
    learning_stage_info: { status: "FAIL", conversions: 12 },
  });
  assert.strictEqual(l.stage, "LEARNING_LIMITED");
  assert.strictEqual(l.label, "Learning limited");
  assert.strictEqual(l.conversions, 12);
});

check("LEARNING maps to Learning", () => {
  const l = normalizeLearningStage({ learning_stage_info: { status: "LEARNING" } });
  assert.strictEqual(l.stage, "LEARNING");
});

// Badging the healthy majority would make every row noisy.
check("SUCCESS produces no badge", () => {
  assert.strictEqual(
    normalizeLearningStage({ learning_stage_info: { status: "SUCCESS" } }),
    null,
  );
});

check("missing learning info yields null", () => {
  assert.strictEqual(normalizeLearningStage({}), null);
  assert.strictEqual(normalizeLearningStage({ learning_stage_info: null }), null);
});

check("last significant edit converts from unix seconds to ISO", () => {
  const l = normalizeLearningStage({
    learning_stage_info: { status: "LEARNING", last_sig_edit_ts: 1750000000 },
  });
  assert.strictEqual(l.lastSignificantEditTime, new Date(1750000000000).toISOString());
});

console.log("\nreview feedback");

check("flattens global and placement-specific rejections", () => {
  const r = normalizeReviewFeedback({
    ad_review_feedback: {
      global: { AdultContent: "Contains adult content" },
      placement_specific: { facebook: { Circumvention: "Misleading claim" } },
    },
  });
  assert.strictEqual(r.count, 2);
  assert.deepStrictEqual(r.reasons[0], {
    policy: "AdultContent",
    reason: "Contains adult content",
    placement: null,
  });
  assert.strictEqual(r.reasons[1].placement, "facebook");
});

// Null for every never-rejected ad, so the UI can branch on truthiness alone.
check("an ad that was never rejected yields null", () => {
  assert.strictEqual(normalizeReviewFeedback({}), null);
  assert.strictEqual(normalizeReviewFeedback({ ad_review_feedback: {} }), null);
});

check("ignores non-string reason values instead of rendering [object Object]", () => {
  const r = normalizeReviewFeedback({
    ad_review_feedback: { global: { Policy: { nested: "unexpected" } } },
  });
  assert.strictEqual(r, null);
});

console.log("\nrecommendation headline");

// Meta ships no title on the account edge — its own popover composes the
// benefit-led headline from lift_estimate, and so do we.
check("a phrase lift becomes a benefit-led headline", () => {
  assert.strictEqual(
    composeHeadline("8% lower cost per result", "Reels format"),
    "You could get 8% lower cost per result",
  );
});

// "You could get 8%" would read as nonsense — fall back rather than emit it.
check("a bare value or empty lift falls back to the enum label", () => {
  assert.strictEqual(composeHeadline("8%", "Reels format"), "Reels format");
  assert.strictEqual(composeHeadline("", "Reels format"), "Reels format");
  assert.strictEqual(composeHeadline(null, "Reels format"), "Reels format");
  assert.strictEqual(composeHeadline(undefined, "Reels format"), "Reels format");
});

// Meta adds recommendation types on its own schedule; an unseen one must still
// render readably rather than leaking a SCREAMING_SNAKE enum or a blank.
check("unknown recommendation types still render readably", () => {
  assert.strictEqual(
    labelRecommendationEnum("SOME_BRAND_NEW_TYPE"),
    "Some brand new type",
  );
  assert.strictEqual(labelRecommendationEnum("", "fallback"), "fallback");
});


console.log("\nfield lists");

// If these fall out of the requested field list the derived signals above all
// silently degrade to the `status` fallback — no error, just wrong badges.
check("effective_status is requested at all three levels", () => {
  assert.ok(getCampaignFields().includes("effective_status"), "campaign");
  assert.ok(getAdSetFields().includes("effective_status"), "ad set");
  assert.ok(getAdFields().includes("effective_status"), "ad");
});

check("learning_stage_info is requested on ad sets", () => {
  assert.ok(getAdSetFields().includes("learning_stage_info"));
});

check("ad_review_feedback is requested on ads", () => {
  assert.ok(getAdFields().includes("ad_review_feedback"));
});

console.log(
  failures === 0
    ? "\nmanagementOps: all checks passed\n"
    : `\nmanagementOps: ${failures} check(s) failed\n`,
);
process.exit(failures === 0 ? 0 : 1);
