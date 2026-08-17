/**
 * templateSynthesizer — build a valid Meta campaign template from an
 * objective + budget, with no saved template required.
 *
 * Why this exists
 * ---------------
 * Scheduling an Ad Factory automation currently dead-ends for any user who
 * has not first built and saved a template in Meta Ads Manager
 * (`TemplatePicker.jsx`: "No saved Meta templates yet. Build one in Meta Ads
 * Manager, then come back to schedule it."). A user who came here to make ads
 * is sent to finish a different product first, and nothing downstream
 * recovers from it.
 *
 * Every default needed to avoid that already lives in `config/wizardSchema.js`
 * — the same source of truth the V2 wizard renderer and its Joi validator
 * factory read. This module reads those defaults and emits the template shape
 * `adsFactoryAutoOrchestrator` already consumes. It invents nothing: every
 * enum it emits is either supplied by the caller and checked against the cell,
 * or taken from the cell's own declared default.
 *
 * Pure — no DB, no SDK, no network, no `process.env`. Fixture in, template
 * out. Validate the result with `templatePreflight.js` before any Meta call.
 *
 * See docs/AD_FACTORY_2.md §5.
 */

const {
  getCell,
  isCellImplemented,
  getAllowedBillingEvents,
  getAllowedBidStrategies,
  getMetaDestinationType,
} = require("../../config/wizardSchema");

// ─── Errors ──────────────────────────────────────────────────────────────────

// Named error so callers can distinguish "this input was wrong" (a 400 to the
// user) from an unexpected throw (a 500). `field` is the offending input.
class TemplateSynthesisError extends Error {
  constructor(message, field = null) {
    super(message);
    this.name = "TemplateSynthesisError";
    this.code = "TEMPLATE_SYNTHESIS_FAILED";
    this.field = field;
  }
}

// ─── Defaults ────────────────────────────────────────────────────────────────

// Targeting when the caller supplies none. `worldwide: true` mirrors the
// orchestrator's own fallback (`p.worldwide ?? true`) so a synthesized
// template behaves identically to a saved one that omitted targeting.
// Callers with real audience data (the Ad Factory brief) should pass their
// own `targeting` rather than relying on this.
const DEFAULT_TARGETING = Object.freeze({ worldwide: true });

// Templates are SAVED as PAUSED — the same convention the V2 wizard uses, so
// a synthesized template opened in Ads Manager behaves like any other and
// does not start spending the moment it is created.
//
// This is the template's stored default, NOT the launch status. The
// orchestrator explicitly overrides campaign, ad set and ad to ACTIVE on every
// automation run (see adsFactoryAutoOrchestrator: `status: "ACTIVE"` on each
// of the three payloads). Automation-created ads still go live.
const TEMPLATE_SAVED_STATUS = "PAUSED";

// ─── Helpers ─────────────────────────────────────────────────────────────────

// The orchestrator reads identity/location requirements straight off the cell.
// Mirror its accessors here so a schema change flows through to synthesis
// without a second list to maintain.
const cellRequiresPage = (cell) =>
  (cell?.identity?.required || []).includes("page");

const cellRequiresField = (cell, field) =>
  (cell?.ad?.requiredFields || []).includes(field);

/**
 * Pick a value from an allow-list.
 *
 * Returns the requested value when the list permits it, the supplied fallback
 * when nothing was requested, and throws when the caller asked for something
 * the cell forbids. Silently correcting a rejected value would hide a real
 * mismatch until Meta rejected the launch, so this is deliberately loud.
 */
function pickAllowed({ requested, allowed, fallback, field }) {
  if (requested == null || requested === "") {
    if (fallback == null) {
      throw new TemplateSynthesisError(
        `Cannot resolve ${field} — the cell declares no default and none was supplied`,
        field,
      );
    }
    return fallback;
  }
  if (!allowed.includes(requested)) {
    throw new TemplateSynthesisError(
      `${field} "${requested}" is not valid for this objective — allowed: ${allowed.join(", ")}`,
      field,
    );
  }
  return requested;
}

// ─── synthesizeTemplate ──────────────────────────────────────────────────────

/**
 * Build a campaign template for one (objective, conversionLocation) cell.
 *
 * @param {object}  input
 * @param {string}  input.objective           Meta objective, e.g. "OUTCOME_TRAFFIC"
 * @param {string}  input.conversionLocation  Cell key, e.g. "WEBSITE"
 * @param {string}  input.adAccountId         Bare ad-account id, no `act_` prefix
 * @param {number}  input.budget              DAILY budget in MAJOR currency units (₹800 → 800)
 * @param {string}  [input.pageId]            Required when the cell requires Page identity
 * @param {string}  [input.linkUrl]           Required when the cell requires `linkUrl`
 * @param {string}  [input.callToAction]      Must be in the cell's CTA list; defaults to the cell's
 * @param {string}  [input.campaignName]      Defaults to a name derived from the objective
 * @param {string}  [input.instagramUserId]   Optional IG identity (v22+ name)
 * @param {object}  [input.targeting]         Defaults to DEFAULT_TARGETING
 * @param {string}  [input.optimizationGoal]  Defaults to the cell's
 * @param {string}  [input.billingEvent]      Defaults to the cell's, narrowed by goal
 * @param {string}  [input.leadFormId]        Required by preflight for instant-form cells
 * @param {string}  [input.applicationId]     App cells only
 * @param {string}  [input.objectStoreUrl]    App cells only
 *
 * @returns {{name, objective, conversionLocation, pageId, source, payload}}
 * @throws  {TemplateSynthesisError}
 */
function synthesizeTemplate(input = {}) {
  const {
    objective,
    conversionLocation,
    adAccountId,
    budget,
    pageId = "",
    linkUrl = "",
    callToAction,
    campaignName,
    instagramUserId,
    targeting,
    optimizationGoal,
    billingEvent,
    leadFormId,
    applicationId,
    objectStoreUrl,
  } = input;

  if (!objective) {
    throw new TemplateSynthesisError("objective is required", "objective");
  }
  if (!conversionLocation) {
    throw new TemplateSynthesisError(
      "conversionLocation is required",
      "conversionLocation",
    );
  }

  // getCell throws for an unknown pair; translate to our named error so the
  // caller has one error type to catch.
  let cell;
  try {
    cell = getCell(objective, conversionLocation);
  } catch (err) {
    throw new TemplateSynthesisError(err.message, "conversionLocation");
  }

  // Placeholder cells (App Promotion pending Meta UI reference) must never
  // produce a half-built payload — the wizard throws for these too.
  if (!isCellImplemented(objective, conversionLocation)) {
    throw new TemplateSynthesisError(
      `(${objective}, ${conversionLocation}) is not implemented yet — pick another conversion location`,
      "conversionLocation",
    );
  }

  if (!adAccountId) {
    throw new TemplateSynthesisError("adAccountId is required", "adAccountId");
  }

  // Budget must be a positive finite number. A missing budget silently
  // becoming 0 would create a campaign that never delivers, so this throws
  // rather than defaulting.
  const dailyBudget = Number(budget);
  if (!Number.isFinite(dailyBudget) || dailyBudget <= 0) {
    throw new TemplateSynthesisError(
      "budget must be a positive number in major currency units",
      "budget",
    );
  }

  if (cellRequiresPage(cell) && !pageId) {
    throw new TemplateSynthesisError(
      "pageId is required — this objective runs ads under a Facebook Page",
      "pageId",
    );
  }

  if (cellRequiresField(cell, "linkUrl") && !linkUrl) {
    throw new TemplateSynthesisError(
      "linkUrl is required for this objective",
      "linkUrl",
    );
  }

  // ── Ad set enums, all resolved from the cell ──────────────────────────────

  const resolvedGoal = pickAllowed({
    requested: optimizationGoal,
    allowed: cell.adSet.optimizationGoals,
    fallback: cell.adSet.defaultOptimizationGoal,
    field: "optimizationGoal",
  });

  // Billing events narrow by goal: LINK_CLICKS is only accepted alongside the
  // LINK_CLICKS goal, otherwise Meta throws subcode 1815117. The cell's own
  // default can therefore be invalid for a non-default goal — fall back to the
  // first still-allowed event in that case rather than emitting a bad pair.
  const allowedBilling = getAllowedBillingEvents(cell, resolvedGoal);
  const billingFallback = allowedBilling.includes(cell.adSet.defaultBillingEvent)
    ? cell.adSet.defaultBillingEvent
    : allowedBilling[0];

  const resolvedBilling = pickAllowed({
    requested: billingEvent,
    allowed: allowedBilling,
    fallback: billingFallback,
    field: "billingEvent",
  });

  // Autobid is the only strategy valid for every goal, and the only one that
  // needs no bid amount — the right default for a template the user never
  // asked to configure. getAllowedBidStrategies returns autobid-only for the
  // goals where Meta enforces it (subcode 1885204).
  const allowedBidStrategies = getAllowedBidStrategies(cell, resolvedGoal);
  const resolvedBidStrategy = allowedBidStrategies.includes(
    "LOWEST_COST_WITHOUT_CAP",
  )
    ? "LOWEST_COST_WITHOUT_CAP"
    : allowedBidStrategies[0];

  const resolvedCta = pickAllowed({
    requested: callToAction,
    allowed: cell.ctas.allowed,
    fallback: cell.ctas.default,
    field: "callToAction",
  });

  const name = (campaignName || "").trim() || defaultCampaignName(objective);

  // ── Payload ───────────────────────────────────────────────────────────────
  //
  // Budget note — this is the subtle one. The orchestrator applies the ×100
  // minor-unit conversion in exactly two places:
  //
  //   • campaign level, only when `cbo && campaignBudget`
  //   • ad set level,   when `!cbo && adSetBudget`
  //
  // A bare `payload.dailyBudget` is copied to the campaign through the
  // CAMPAIGN_FIELDS whitelist WITHOUT that conversion, which would send ₹800
  // to Meta as 800 minor units (₹8). So we deliberately express the budget as
  // an ad-set budget (`cbo: false` + `adSetBudget` + `adSetBudgetType`) and
  // never set a root `dailyBudget`. `adSetBudget` is also in
  // EDITABLE_META_PAYLOAD_FIELDS, so the user can change it after creation.
  const payload = {
    adAccountId: String(adAccountId),
    name,
    objective,
    conversionLocation,

    cbo: false,
    adSetBudget: dailyBudget,
    adSetBudgetType: "daily",

    optimizationGoal: resolvedGoal,
    billingEvent: resolvedBilling,
    bidStrategy: resolvedBidStrategy,

    targeting: targeting || { ...DEFAULT_TARGETING },

    // No Special Ad Category by default. The wizard saves [] for the same
    // case, and the orchestrator only derives country lists when non-empty.
    specialAdCategories: [],

    status: TEMPLATE_SAVED_STATUS,

    callToAction: resolvedCta,
    ...(pageId ? { pageId: String(pageId) } : {}),
    ...(linkUrl ? { linkUrl } : {}),
    ...(instagramUserId ? { instagramUserId: String(instagramUserId) } : {}),
    ...(leadFormId ? { leadFormId: String(leadFormId) } : {}),
    ...(applicationId ? { applicationId: String(applicationId) } : {}),
    ...(objectStoreUrl ? { objectStoreUrl } : {}),
  };

  return {
    name,
    objective,
    conversionLocation,
    pageId: pageId ? String(pageId) : "",
    // Marks this template as machine-built. Persisted to campaignTemplate so
    // the user can find and edit it in Ads Manager afterwards — Ads Manager
    // becomes a forward destination instead of a backward prerequisite.
    source: "synthesized",
    payload,
  };
}

// Readable default so an auto-created campaign is identifiable in Ads Manager
// rather than appearing as "Auto". Callers should pass a real name where they
// have one (the Ad Factory brief passes the brand/page name).
function defaultCampaignName(objective) {
  const label = String(objective || "")
    .replace(/^OUTCOME_/, "")
    .toLowerCase()
    .replace(/(^|_)([a-z])/g, (_, sep, ch) => (sep ? " " : "") + ch.toUpperCase());
  return `AdsGPT ${label || "Campaign"}`;
}

module.exports = {
  synthesizeTemplate,
  TemplateSynthesisError,
  // Exported for tests and for preflight's shared expectations.
  _internals: {
    DEFAULT_TARGETING,
    TEMPLATE_SAVED_STATUS,
    defaultCampaignName,
    pickAllowed,
    cellRequiresPage,
    cellRequiresField,
  },
};
