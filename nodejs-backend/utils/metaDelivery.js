/**
 * metaDelivery — derived delivery state for the Ads Manager tables.
 *
 * Three separate Meta signals answer "is this actually running, and if not
 * why", and none of them is `status`:
 *
 *   - `status`            what the USER last set (ACTIVE / PAUSED). An ad
 *                         rejected by review still reports ACTIVE here, which
 *                         is why a rejected ad used to look identical to a
 *                         running one in our tables.
 *   - `effective_status`  what META computes, folding in the parent's state,
 *                         the schedule, review outcome and billing.
 *   - `learning_stage_info` / `ad_review_feedback`  the WHY behind the two
 *                         non-obvious effective statuses.
 *
 * Pure module by design — it must never require the controller back (see the
 * circular-import gotcha in the meta-ads-manager skill), so everything here
 * takes an already-fetched Meta object and returns plain JSON.
 */

// Meta's effective_status enum, grouped by what the user needs to DO about it.
// Anything not listed falls through to "unknown", which the UI renders as the
// raw value rather than inventing a label for it.
const DELIVERY_STATES = {
  ACTIVE: { label: "Active", tone: "good" },
  IN_PROCESS: { label: "In process", tone: "neutral" },
  PENDING_REVIEW: { label: "In review", tone: "neutral" },
  PREAPPROVED: { label: "Pre-approved", tone: "neutral" },
  PAUSED: { label: "Paused", tone: "muted" },
  CAMPAIGN_PAUSED: { label: "Campaign paused", tone: "muted" },
  ADSET_PAUSED: { label: "Ad set paused", tone: "muted" },
  ARCHIVED: { label: "Archived", tone: "muted" },
  DELETED: { label: "Deleted", tone: "muted" },
  DISAPPROVED: { label: "Rejected", tone: "bad" },
  WITH_ISSUES: { label: "With issues", tone: "bad" },
  PENDING_BILLING_INFO: { label: "Billing needed", tone: "bad" },
};

/**
 * Learning-phase mapping. Meta's enum is {LEARNING, SUCCESS, FAIL, WAIVING};
 * FAIL is what Meta's own UI labels "Learning limited" — the ad set left the
 * learning phase without accumulating enough optimisation events, so delivery
 * stays unstable. SUCCESS deliberately produces NO badge: "finished learning"
 * is the normal state and badging it would make every healthy row noisy.
 */
const LEARNING_STAGES = {
  LEARNING: { stage: "LEARNING", label: "Learning", tone: "neutral" },
  FAIL: { stage: "LEARNING_LIMITED", label: "Learning limited", tone: "warn" },
  WAIVING: { stage: "WAIVING", label: "Learning waived", tone: "neutral" },
  SUCCESS: null,
};

// Meta returns nested objects either plain or as SDK AbstractCrudObject
// instances whose payload hides in `_data` — same reason plainMetaList exists
// in metaHelpers.js. Read through both shapes.
function readField(entity, field) {
  if (!entity || typeof entity !== "object") return undefined;
  const raw = entity[field] !== undefined ? entity[field] : entity?._data?.[field];
  if (raw && typeof raw === "object" && raw._data) return raw._data;
  return raw;
}

/**
 * normalizeDeliveryStatus — the badge the table renders instead of `status`.
 * Falls back to `status` when effective_status is absent so a cached payload
 * written before this field was requested still renders something sane.
 */
function normalizeDeliveryStatus(entity) {
  const effective = readField(entity, "effective_status");
  const fallback = readField(entity, "status");
  const value = effective || fallback || null;
  if (!value) return null;

  const known = DELIVERY_STATES[value];
  return {
    value,
    label: known ? known.label : value,
    tone: known ? known.tone : "unknown",
    // True when Meta's computed state disagrees with what the user set —
    // i.e. the row needs an explanation, not just a colour.
    diverged: Boolean(effective && fallback && effective !== fallback),
  };
}

/**
 * normalizeLearningStage — null when there is nothing worth showing (no data,
 * or the ad set finished learning normally).
 */
function normalizeLearningStage(adSet) {
  const info = readField(adSet, "learning_stage_info");
  if (!info || typeof info !== "object") return null;

  const mapped = LEARNING_STAGES[info.status];
  if (!mapped) return null;

  return {
    ...mapped,
    // Conversions accumulated toward exiting the phase. Meta exits learning at
    // ~50 optimisation events per week; surfaced so the UI can say "12 of ~50"
    // rather than an opaque "Learning" pill.
    conversions:
      typeof info.conversions === "number" ? info.conversions : null,
    // A significant edit restarts learning. Users who edit repeatedly never
    // leave the phase and this is the only signal that explains why.
    lastSignificantEditTime: info.last_sig_edit_ts
      ? new Date(Number(info.last_sig_edit_ts) * 1000).toISOString()
      : null,
  };
}

/**
 * normalizeReviewFeedback — flattens Meta's nested policy map into a list the
 * UI can render directly.
 *
 * Shape from Meta:
 *   { global: { "AdultContent": "reason text" },
 *     placement_specific: { "facebook": { "Policy": "reason" } } }
 *
 * Both halves are optional and the policy keys are open-ended, so this walks
 * whatever is present rather than looking for known policy names.
 */
function normalizeReviewFeedback(ad) {
  const feedback = readField(ad, "ad_review_feedback");
  if (!feedback || typeof feedback !== "object") return null;

  const reasons = [];

  const pushAll = (map, placement) => {
    if (!map || typeof map !== "object") return;
    for (const [policy, reason] of Object.entries(map)) {
      if (typeof reason !== "string") continue;
      reasons.push({ policy, reason, placement: placement || null });
    }
  };

  pushAll(feedback.global, null);

  if (feedback.placement_specific && typeof feedback.placement_specific === "object") {
    for (const [placement, map] of Object.entries(feedback.placement_specific)) {
      pushAll(map, placement);
    }
  }

  if (reasons.length === 0) return null;
  return { reasons, count: reasons.length };
}

module.exports = {
  DELIVERY_STATES,
  normalizeDeliveryStatus,
  normalizeLearningStage,
  normalizeReviewFeedback,
};
