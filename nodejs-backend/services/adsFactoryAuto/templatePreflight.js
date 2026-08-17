/**
 * templatePreflight — validate a campaign template against its wizardSchema
 * cell BEFORE any Meta API call.
 *
 * Two reasons this runs separately from `templateSynthesizer`:
 *
 *   1. It also guards SAVED templates. A template built in Ads Manager months
 *      ago can drift out of validity (a Page is unlinked, a CTA is retired,
 *      an objective's allowed goals change). Both paths into `createJob`
 *      should get the same check.
 *
 *   2. Failing here produces a message naming the field. Failing at Meta
 *      produces `error_user_title` / `error_user_msg` at best, and a bare
 *      "Invalid parameter" at worst.
 *
 * Pure — no DB, no SDK, no network. Returns a report; never throws for a
 * validation failure (only for a malformed call).
 *
 * IMPORTANT — the fix for a rejected template is the payload or the creative
 * shape. It is never to pause the ad. Automation ads launch ACTIVE by design;
 * see docs/AD_FACTORY_2.md §5.
 */

const {
  getCell,
  isCellImplemented,
  getAllowedBillingEvents,
  getAllowedBidStrategies,
} = require("../../config/wizardSchema");

// Ad-level fields the orchestrator fills per creative at launch time rather
// than reading from the template: the image comes from the generated
// creative, and headline/primaryText/description come from the generated
// copy. Requiring them on the template would reject every valid automation
// template, so they are excluded from the required-field sweep.
const CREATIVE_SUPPLIED_AD_FIELDS = new Set([
  "imageHash",
  "headline",
  "primaryText",
  "description",
  "videoId",
  "imageUrl",
]);

// Cell `ad.requiredFields` entries that map to a template payload key of a
// different name. Everything else is looked up under its own name.
const AD_FIELD_TO_PAYLOAD_KEY = {
  linkUrl: "linkUrl",
  leadFormId: "leadFormId",
  applicationId: "applicationId",
  objectStoreUrl: "objectStoreUrl",
};

/**
 * @param {object} template  { objective, conversionLocation, pageId?, payload }
 * @returns {{ ok: boolean, errors: Array<{field: string, message: string}> }}
 */
function preflightTemplate(template) {
  if (!template || typeof template !== "object") {
    throw new TypeError("preflightTemplate: template object is required");
  }

  const errors = [];
  const push = (field, message) => errors.push({ field, message });

  const { objective, conversionLocation } = template;
  const payload = template.payload || {};

  if (!objective) push("objective", "objective is required");
  if (!conversionLocation) {
    push("conversionLocation", "conversionLocation is required");
  }
  // Without a cell there is nothing further to check against.
  if (!objective || !conversionLocation) return { ok: false, errors };

  let cell;
  try {
    cell = getCell(objective, conversionLocation);
  } catch (err) {
    push("conversionLocation", err.message);
    return { ok: false, errors };
  }

  if (!isCellImplemented(objective, conversionLocation)) {
    push(
      "conversionLocation",
      `(${objective}, ${conversionLocation}) is not implemented yet`,
    );
    return { ok: false, errors };
  }

  // ── Account + budget ──────────────────────────────────────────────────────

  if (!payload.adAccountId) {
    push("payload.adAccountId", "adAccountId is required");
  }

  // Mirrors the synthesizer's budget model. A template carrying only a root
  // `dailyBudget` is accepted (saved wizard templates do this and the
  // orchestrator converts it at ad-set level) but a zero or negative budget
  // never is, from either source.
  const budgetCandidates = [
    ["payload.adSetBudget", payload.adSetBudget],
    ["payload.campaignBudget", payload.campaignBudget],
    ["payload.dailyBudget", payload.dailyBudget],
    ["payload.lifetimeBudget", payload.lifetimeBudget],
  ].filter(([, v]) => v !== undefined && v !== null && v !== "");

  if (budgetCandidates.length === 0) {
    push("payload.budget", "a budget is required (adSetBudget or dailyBudget)");
  } else {
    for (const [field, value] of budgetCandidates) {
      const n = Number(value);
      if (!Number.isFinite(n) || n <= 0) {
        push(field, `${field.split(".").pop()} must be a positive number`);
      }
    }
  }

  // ── Identity ──────────────────────────────────────────────────────────────

  // Only identity requirements that are answerable FROM THE TEMPLATE are
  // checked here. `pagePhoneNumber` (TRAFFIC/CALLS, SALES/PHONE_CALL) is a
  // property of the Facebook Page, not of the template, so confirming it
  // needs a live Graph lookup — out of scope for a pure validator. Meta
  // rejects the ad at launch with a clear message if the Page has no phone
  // number, so the failure is at least legible. Worth adding to the connect
  // flow as a Page-readiness check rather than faking it here.
  const requiredIdentity = cell.identity?.required || [];
  if (requiredIdentity.includes("page")) {
    // The orchestrator accepts the Page from either location, so accept both.
    const hasPage = Boolean(template.pageId || payload.pageId);
    if (!hasPage) {
      push(
        "pageId",
        "this objective runs ads under a Facebook Page — pageId is required",
      );
    }
  }
  if (requiredIdentity.includes("linkedApp") && !payload.applicationId) {
    push(
      "payload.applicationId",
      "this objective requires a linked app — applicationId is required",
    );
  }

  // ── Ad-level required fields ──────────────────────────────────────────────

  for (const field of cell.ad?.requiredFields || []) {
    if (CREATIVE_SUPPLIED_AD_FIELDS.has(field)) continue;
    const key = AD_FIELD_TO_PAYLOAD_KEY[field] || field;
    if (!payload[key]) {
      push(`payload.${key}`, `${key} is required for this objective`);
    }
  }

  // Instant-form cells need a lead form to post into. The cell declares this
  // through additionalSteps rather than requiredFields.
  if ((cell.additionalSteps || []).includes("leadForm") && !payload.leadFormId) {
    push(
      "payload.leadFormId",
      "this objective posts into an instant form — leadFormId is required",
    );
  }

  // ── Ad set enums ──────────────────────────────────────────────────────────

  const goal = payload.optimizationGoal;
  if (goal && !cell.adSet.optimizationGoals.includes(goal)) {
    push(
      "payload.optimizationGoal",
      `optimizationGoal "${goal}" is not valid for this objective — allowed: ${cell.adSet.optimizationGoals.join(", ")}`,
    );
  }

  // Only cross-check billing against the goal when the goal itself is valid;
  // otherwise the message would blame the wrong field.
  const goalIsValid = goal && cell.adSet.optimizationGoals.includes(goal);
  if (payload.billingEvent && goalIsValid) {
    const allowed = getAllowedBillingEvents(cell, goal);
    if (!allowed.includes(payload.billingEvent)) {
      push(
        "payload.billingEvent",
        `billingEvent "${payload.billingEvent}" cannot be paired with optimizationGoal "${goal}" — allowed: ${allowed.join(", ")}`,
      );
    }
  }

  if (payload.bidStrategy && goalIsValid) {
    const allowed = getAllowedBidStrategies(cell, goal);
    if (!allowed.includes(payload.bidStrategy)) {
      push(
        "payload.bidStrategy",
        `bidStrategy "${payload.bidStrategy}" is not valid for optimizationGoal "${goal}" — allowed: ${allowed.join(", ")}`,
      );
    }
  }

  // A capped bid strategy without a bid amount is rejected by Meta.
  const cappedStrategies = ["LOWEST_COST_WITH_BID_CAP", "COST_CAP"];
  if (cappedStrategies.includes(payload.bidStrategy)) {
    const bid = Number(payload.bidAmount);
    if (!Number.isFinite(bid) || bid <= 0) {
      push(
        "payload.bidAmount",
        `bidStrategy "${payload.bidStrategy}" requires a positive bidAmount`,
      );
    }
  }

  // ── CTA ───────────────────────────────────────────────────────────────────

  if (payload.callToAction && !cell.ctas.allowed.includes(payload.callToAction)) {
    push(
      "payload.callToAction",
      `callToAction "${payload.callToAction}" is not valid for this objective — allowed: ${cell.ctas.allowed.join(", ")}`,
    );
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Convenience wrapper for call sites that want to fail fast. Throws an Error
 * carrying the full `errors` array so an HTTP layer can surface every problem
 * at once instead of one per round trip.
 */
function assertTemplateValid(template) {
  const report = preflightTemplate(template);
  if (!report.ok) {
    const err = new Error(
      `Template failed pre-flight validation: ${report.errors
        .map((e) => e.message)
        .join("; ")}`,
    );
    err.name = "TemplatePreflightError";
    err.code = "TEMPLATE_PREFLIGHT_FAILED";
    err.errors = report.errors;
    throw err;
  }
  return true;
}

module.exports = {
  preflightTemplate,
  assertTemplateValid,
  _internals: { CREATIVE_SUPPLIED_AD_FIELDS, AD_FIELD_TO_PAYLOAD_KEY },
};
