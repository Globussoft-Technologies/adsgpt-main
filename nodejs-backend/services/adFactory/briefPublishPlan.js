/**
 * briefPublishPlan — turn a brief plus the creatives already on screen into the
 * Meta calls that put them live ONCE, with no schedule.
 *
 * Why this exists
 * ---------------
 * Quick setup could only ever commit you to a recurring job. v1 has had two
 * paths since day one — "Manual Fabrication" (post these ads, now) and
 * "Auto-Forge" (keep making them) — and v2 shipped only the second, so the
 * user looking at three finished ads had no way to ship those three ads. Their
 * only option was to subscribe.
 *
 * Two destinations, because both are legitimate:
 *
 *   auto      We build the campaign and ad set from the brief's own objective
 *             and daily budget, the same way activation does. Nothing to pick
 *             beyond the ad account and Page. This is Quick setup's thesis.
 *   existing  The ads go into a campaign and ad set the user already runs, and
 *             inherit its budget and targeting. This is exactly what v1's
 *             Post Ad does, and it is what someone with a live campaign wants.
 *
 * Pure — no DB, no SDK, no network, no `process.env`. Fixtures in, payloads
 * out, so the budget arithmetic below is testable without touching Meta.
 *
 * ─── The ×100 ───────────────────────────────────────────────────────────────
 *
 * Meta takes money in MINOR units. Everything upstream of the Meta boundary in
 * this codebase — the brief, the synthesized template, the UI — carries MAJOR
 * units, and the conversion happens once, here, at the boundary.
 *
 * `synthesizeTemplate` deliberately expresses the budget as an AD SET budget
 * (`cbo: false` + `adSetBudget` + `adSetBudgetType`) and never sets a root
 * `dailyBudget`, because a root `dailyBudget` is copied to the campaign
 * verbatim — ₹800 would reach Meta as 800 paise, i.e. ₹8. This module honours
 * that: the campaign payload carries NO budget at all and the ad set carries
 * `dailyBudget = adSetBudget × 100`.
 *
 * `adsFactoryAutoOrchestrator` does the same conversion for the scheduled path
 * (search `adSetBudgetType` there). The two are deliberately separate: the
 * orchestrator handles arbitrary SAVED Ads-Manager templates and needs field
 * whitelists to survive them, whereas everything here comes out of
 * `synthesizeTemplate`, whose shape we control. If the synthesizer's payload
 * contract changes, both must change — `test/adFactory/briefPublishPlan.test.js`
 * pins this side of it.
 */

const {
  synthesizeTemplate,
  TemplateSynthesisError,
} = require("../adsFactoryAuto/templateSynthesizer");
const { getCell, isCellImplemented } = require("../../config/wizardSchema");

// ─── Errors ──────────────────────────────────────────────────────────────────

// Named so the controller can answer 400-with-a-field rather than 500.
class BriefPublishError extends Error {
  constructor(message, field = null) {
    super(message);
    this.name = "BriefPublishError";
    this.field = field;
  }
}

const PUBLISH_MODES = Object.freeze(["auto", "existing"]);

// Meta's own limits. Copy that overruns is rejected at the boundary, so it is
// cut here where the number is visible rather than deep inside the SDK call.
const MAX_HEADLINE = 40;
const MAX_PRIMARY_TEXT = 125;
const MAX_DESCRIPTION = 30;

const plain = (v) => (v && typeof v.toObject === "function" ? v.toObject() : v || {});
const str = (v) => String(v ?? "").trim();

/**
 * An image reference from generation is either an absolute URL or an S3 key.
 * `adControllerV2.createAdV2` validates `imageUrl` with Joi `.uri()`, so a bare
 * key is rejected before it ever reaches the uploader.
 */
function absoluteImageUrl(value, s3Base) {
  const v = str(value);
  if (!v) return "";
  if (/^https?:\/\//i.test(v)) return v;
  const base = String(s3Base || "").replace(/\/$/, "");
  if (!base) return v;
  return `${base}${v.startsWith("/") ? "" : "/"}${v}`;
}

/**
 * A CTA the brief carries is only legal inside its own (objective ×
 * conversionLocation) cell. The brief's objective is editable after inference,
 * so a button chosen under a previous objective can be stranded — same guard
 * `briefToJobPatch` applies. Returns null when it can't be used.
 */
function ctaValidForCell(button, objective, conversionLocation) {
  const b = str(button);
  if (!b || !objective || !conversionLocation) return null;
  try {
    if (!isCellImplemented(objective, conversionLocation)) return null;
    const cell = getCell(objective, conversionLocation);
    return (cell?.ctas?.allowed || []).includes(b) ? b : null;
  } catch {
    return null;
  }
}

/**
 * Build the `ads[]` batch for `adControllerV2.createAdV2`.
 *
 * Pairs come from `briefGenerationView`, which has already resolved which
 * creatives belong to the run being looked at. This does not re-slice them —
 * the rules about which array entries belong to a run are subtle and live in
 * one tested place.
 */
function buildAds(pairs, { linkUrl, callToAction, s3Base }) {
  const list = Array.isArray(pairs) ? pairs : [];
  const ads = [];

  for (const pair of list) {
    const imageUrl = absoluteImageUrl(pair?.imageUrl, s3Base);
    // A pair with no image is a slot that never landed. Skipping is right:
    // posting three of four ads is a better answer than refusing all four.
    if (!imageUrl) continue;

    const copy = pair?.copy || {};
    ads.push({
      imageUrl,
      headline: str(copy.headline).slice(0, MAX_HEADLINE),
      message: str(copy.primaryText).slice(0, MAX_PRIMARY_TEXT),
      description: str(copy.description).slice(0, MAX_DESCRIPTION),
      ...(linkUrl ? { linkUrl } : {}),
      ...(callToAction ? { callToAction } : {}),
      ...(pair?.creativeId ? { adFactoryCreativeId: String(pair.creativeId) } : {}),
    });
  }

  return ads;
}

/**
 * @param {object} brief              the AdFactoryBrief document (or a plain object)
 * @param {object} connection         facebookId, connectionId, adAccountId, pageId, …
 * @param {object} opts
 * @param {string} opts.mode          "auto" | "existing"
 * @param {Array}  opts.pairs         `briefGenerationView(...).pairs`
 * @param {string} [opts.campaignId]  existing mode: the Meta campaign to post into
 * @param {string} [opts.adSetId]     existing mode: the Meta ad set to post into
 * @param {string} [opts.s3Base]      base for relative image keys (AWS_IMAGE_VIEW_URL)
 *
 * @returns {{mode, ads, adsBody, template?, campaignPayload?, adSetPayload?}}
 *   `adsBody` is the createAdV2 body WITHOUT campaignDetails/adSetDetails —
 *   in auto mode those ids do not exist until the two calls have been made.
 */
function briefPublishPlan(brief = {}, connection = {}, opts = {}) {
  const b = plain(brief);
  const offer = plain(b.offer);
  const delivery = plain(b.delivery);

  const mode = str(opts.mode) || "auto";
  if (!PUBLISH_MODES.includes(mode)) {
    throw new BriefPublishError(`Unknown publish mode "${mode}"`, "mode");
  }

  // ── The connection. Same four ids activation needs. ───────────────────────
  if (!str(connection.facebookId)) {
    throw new BriefPublishError("Connect a Meta account first", "facebookId");
  }
  if (!str(connection.connectionId)) {
    throw new BriefPublishError("Connect a Meta account first", "connectionId");
  }
  if (!str(connection.adAccountId)) {
    throw new BriefPublishError("Select an ad account", "adAccountId");
  }
  // Required by createAdV2 unconditionally — every Meta ad runs under a Page.
  if (!str(connection.pageId)) {
    throw new BriefPublishError("Select a Facebook Page", "pageId");
  }

  // ── The creatives. ────────────────────────────────────────────────────────
  const objective = str(offer.primaryObjective);
  const conversionLocation = str(offer.conversionLocation);
  const linkUrl = str(offer.cta?.url);
  const callToAction = ctaValidForCell(offer.cta?.button, objective, conversionLocation);

  const ads = buildAds(opts.pairs, { linkUrl, callToAction, s3Base: opts.s3Base });
  if (ads.length === 0) {
    throw new BriefPublishError(
      "There are no finished ads to post yet — generate some first",
      "ads",
    );
  }

  const adsBody = {
    accountId: str(connection.connectionId),
    facebookId: str(connection.facebookId),
    adAccountId: str(connection.adAccountId),
    pageId: str(connection.pageId),
    ...(b._id ? { adFactoryCampaignId: str(b.campaignId || "") || undefined } : {}),
    ...(str(connection.leadFormId) ? { leadFormId: str(connection.leadFormId) } : {}),
    ads,
  };
  if (!adsBody.adFactoryCampaignId) delete adsBody.adFactoryCampaignId;

  // ── existing: the user picked a campaign and ad set. Nothing to build. ────
  if (mode === "existing") {
    if (!str(opts.campaignId)) {
      throw new BriefPublishError("Choose a campaign to post into", "campaignId");
    }
    if (!str(opts.adSetId)) {
      throw new BriefPublishError("Choose an ad set to post into", "adSetId");
    }
    return {
      mode,
      ads,
      adsBody,
      campaignId: str(opts.campaignId),
      adSetId: str(opts.adSetId),
    };
  }

  // ── auto: build the campaign and ad set from the brief. ───────────────────
  if (!objective || !conversionLocation) {
    throw new BriefPublishError(
      "This brief has no advertising objective resolved yet",
      "primaryObjective",
    );
  }

  const daily = Number(delivery.budget?.daily);
  if (!Number.isFinite(daily) || daily <= 0) {
    throw new BriefPublishError("Set a daily budget first", "budget");
  }

  const advertiserName = str(connection.pageName || b.brand?.name);

  let template;
  try {
    template = synthesizeTemplate({
      objective,
      conversionLocation,
      adAccountId: str(connection.adAccountId),
      budget: daily,
      pageId: str(connection.pageId),
      ...(linkUrl ? { linkUrl } : {}),
      ...(callToAction ? { callToAction } : {}),
      ...(str(connection.instagramUserId)
        ? { instagramUserId: str(connection.instagramUserId) }
        : {}),
      ...(str(connection.leadFormId) ? { leadFormId: str(connection.leadFormId) } : {}),
      ...(str(b.brand?.name) ? { campaignName: str(b.brand.name).slice(0, 120) } : {}),
      ...(advertiserName ? { dsaBeneficiary: advertiserName, dsaPayor: advertiserName } : {}),
    });
  } catch (err) {
    if (err instanceof TemplateSynthesisError) {
      throw new BriefPublishError(err.message, err.field);
    }
    throw err;
  }

  const p = template.payload;

  // The campaign carries NO budget: `cbo` is false, so the money lives on the
  // ad set. See the ×100 note at the top — a root dailyBudget here would be
  // sent to Meta unconverted.
  const campaignPayload = {
    adAccountId: p.adAccountId,
    name: template.name,
    objective: template.objective,
    specialAdCategories: [],
    specialAdCategoryCountries: [],
    ...(p.bidStrategy ? { bidStrategy: p.bidStrategy } : {}),
    // Posted on purpose, so it goes live. The synthesizer's own default is
    // PAUSED because a saved template is a draft; this is a launch.
    status: "ACTIVE",
  };

  // One ad set, named for the day it was shipped, so a second manual post on
  // the same brief is distinguishable in Ads Manager rather than colliding.
  const adSetPayload = {
    adAccountId: p.adAccountId,
    name: `${template.name} - ${new Date().toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    })}`,
    objective: template.objective,
    conversionLocation: template.conversionLocation,
    pageId: p.pageId,
    targeting: p.targeting,
    dailyBudget: Math.round(Number(p.adSetBudget) * 100),
    ...(p.optimizationGoal ? { optimizationGoal: p.optimizationGoal } : {}),
    ...(p.billingEvent ? { billingEvent: p.billingEvent } : {}),
    ...(p.bidStrategy ? { bidStrategy: p.bidStrategy } : {}),
    ...(p.instagramUserId ? { instagramUserId: p.instagramUserId } : {}),
    ...(p.leadFormId ? { leadFormId: p.leadFormId } : {}),
    ...(p.applicationId ? { applicationId: p.applicationId } : {}),
    ...(p.objectStoreUrl ? { objectStoreUrl: p.objectStoreUrl } : {}),
    ...(p.dsaBeneficiary ? { dsaBeneficiary: p.dsaBeneficiary } : {}),
    ...(p.dsaPayor ? { dsaPayor: p.dsaPayor } : {}),
    status: "ACTIVE",
    // No startTime/endTime. Meta reads an absent start_time as "now" and an
    // absent end_time as open-ended, which is what a one-off post wants. The
    // scheduled path has to normalise both because a SAVED template carries
    // fixed calendar dates that go stale; nothing here carries one.
  };

  return { mode, ads, adsBody, template, campaignPayload, adSetPayload };
}

module.exports = {
  briefPublishPlan,
  BriefPublishError,
  PUBLISH_MODES,
  _internals: { buildAds, absoluteImageUrl, ctaValidForCell },
};
