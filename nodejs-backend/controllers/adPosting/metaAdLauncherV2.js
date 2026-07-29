/**
 * Meta Ads — V2 Wizard create endpoints.
 *
 * Three thin handlers (`createCampaignV2`, `createAdSetV2`, `createAdV2`)
 * that consume the `wizardSchema` cell matrix via the V2 Joi factories
 * and the payload builders. The V1 controller in `metaAdLauncher.js`
 * is untouched — V1 endpoints keep serving Awareness / Engagement /
 * Sales until those objectives migrate to V2 in later phases.
 *
 * Why a separate file: `metaAdLauncher.js` is ~1800 lines and grows
 * with every Meta API surface we add. Keeping V2 here means the V1
 * surface area can be deleted wholesale at Phase 6 cutover without
 * touching mixed-purpose files.
 *
 * Helpers are imported from the V1 controller (which exposes them as
 * named exports on the singleton instance). No SDK boilerplate is
 * duplicated between V1 and V2.
 */

const bizSdk = require("facebook-nodejs-business-sdk");
const AdAccount = bizSdk.AdAccount;

const {
  createCampaignSchemaV2,
  updateCampaignSchemaV2,
  buildAdSetSchemaV2,
  updateAdSetSchemaV2,
  buildAdSchemaV2,
} = require("../../Validations/meta.v2.validator");
const {
  getCell,
  isCellImplemented,
  getMetaDestinationType,
} = require("../../config/wizardSchema");
const { buildPromotedObject } = require("../../utils/promotedObject");
const { buildObjectStorySpec } = require("../../utils/objectStorySpec");
const {
  groupLocationsByType,
  dropOverlappingIncludes,
  reverseGeoToLocations,
  TYPE_TO_META_BUCKET,
  COUNTRY_CODE_CARRYING_TYPES,
} = require("../../utils/targetingGeo");
const {
  formToFlexibleSpec,
  flexibleSpecToForm,
} = require("../../utils/detailedTargeting");
const { waitForVideoThumbnail } = require("../../utils/videoThumbnail");
const { inferCellForMetaCampaign } = require("./cellInference");
const crypto = require("crypto");
const MetaLaunchTrace = require("../../Module/adPosting/metaLaunchTrace");

// V1 controller exposes initApiForUser + invalidateAfterCreate +
// formatMetaError + logMetaError as named exports on its module object.
// Importing here keeps the SDK / Redis / logging plumbing single-sourced.
const v1Controller = require("./metaAdLauncher");
const { initApiForUser, invalidateAfterCreate, logMetaError, formatMetaError, getPagePhone, reverseGeocodeLatLng, pickAppStoreUrl, rawErrorDump } = v1Controller;
const logger = require("../../utils/logger");
const {
  getFacebookIdFromRequest,
} = require("../../utils/metaConnection");

const CAPPED_BID_STRATEGIES = new Set([
  "LOWEST_COST_WITH_BID_CAP",
  "COST_CAP",
]);

// Countries excluded from "Worldwide" targeting. Each has its own
// per-country ad-transparency regulation that Meta enforces on any ad
// set that CAN deliver there — and each needs declaration infrastructure
// we don't have:
//   • TW — Taiwan universal ads: needs `regional_regulation_identities`
//     with pre-registered numeric identity ids.
//   • SG — Singapore universal ads: needs `regional_regulated_categories`
//     = SINGAPORE_UNIVERSAL (subcode 3858550).
// Excluding them from Worldwide means the ad set can't reach them, so
// the declarations aren't required. Specific-country targeting never
// selects these (not in the wizard's country list), so this only
// affects the Worldwide toggle. When a country's declaration is
// properly implemented, remove it from this list. See
// CAMPAIGN_CREATION_STATUS.md polish #3.
const WORLDWIDE_EXCLUDED_COUNTRIES = ["TW", "SG"];

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Look up the wizard cell + throw a 400-shaped controller response if the
 * (objective, conversionLocation) tuple isn't a known cell. Used by
 * createAdSetV2 + createAdV2 before they call their respective factory.
 *
 * Returns { ok: true, cell } or { ok: false, status, body } — the caller
 * spreads the body into `res.status(status).json(...)`.
 */
function resolveCellOr400(req) {
  const { objective, conversionLocation } = req.body || {};
  if (!objective || !conversionLocation) {
    return {
      ok: false,
      status: 400,
      body: {
        status: false,
        error: "objective + conversionLocation are required for V2 wizard endpoints",
      },
    };
  }
  if (!isCellImplemented(objective, conversionLocation)) {
    return {
      ok: false,
      status: 400,
      body: {
        status: false,
        error: `(${objective}, ${conversionLocation}) is not a supported wizard cell. Use V1 endpoints for other objectives until they migrate.`,
      },
    };
  }
  return { ok: true, cell: getCell(objective, conversionLocation) };
}

// Short, human-shareable reference code — the kind a user can read off an
// error banner and paste into a support message. 8 hex chars keeps it
// short without a charset-exclusion library; collision odds are
// irrelevant at our volume (Mongo's unique index catches the freak case
// and the write just fails silently, same as any other trace-persist
// failure — see the .catch() below).
function generateTraceId() {
  return `LX-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

// Format a Meta SDK error into the project's standard error envelope.
// Identical shape to V1 so the frontend handler works for both, PLUS a
// `traceId` — every failure gets a MetaLaunchTrace record (best-effort,
// fire-and-forget) capturing the exact request body + Meta's full error,
// so a user-reported issue can be reproduced from the trace ID alone
// instead of asking them to describe what they clicked. See
// Module/adPosting/metaLaunchTrace.js.
function metaErrorResponse(err, action, req) {
  const m = logMetaError(`${action} error`, err);
  const traceId = generateTraceId();

  // Fire-and-forget — a Mongo hiccup must never compound the original
  // Meta error by making the response itself fail or hang.
  MetaLaunchTrace.create({
    traceId,
    userId: req?.user?.user_id,
    adAccountId: req?.body?.adAccountId,
    action,
    requestBody: req?.body,
    metaError: {
      code: m.code,
      subcode: m.subcode,
      message: m.message,
      title: m.title,
      fbtraceId: m.fbtraceId,
      data: m.data,
    },
    rawErrorDump: rawErrorDump(err),
  }).catch((traceErr) => {
    logger.warn(`metaErrorResponse: failed to persist launch trace ${traceId}: ${traceErr.message}`);
  });

  return {
    status: false,
    error: m.title || `Failed to ${action}`,
    details: m.message,
    meta: {
      code: m.code,
      subcode: m.subcode,
      fbtraceId: m.fbtraceId,
      data: m.data,
      traceId,
    },
  };
}

// Build Meta's targeting spec from our normalised targeting model. Shared
// by create-adset + edit-adset so the geo grouping / overlap handling never
// drifts. Does NOT apply app-cell `user_os` — the caller adds that from the
// app store (create) or preserves the existing value (edit).
// Special Ad Categories that block Detailed Targeting entirely. Meta UI
// hides the picker under these; we mirror by stripping any detailedTargeting
// payload from the spec at build time (defense-in-depth alongside the
// frontend hide). Hits subcode 2446007 if we let it through to Meta.
const SAC_BLOCKING_DETAILED_TARGETING = new Set([
  "FINANCIAL_PRODUCTS_SERVICES",
  "CREDIT",
  "EMPLOYMENT",
  "HOUSING",
  "ISSUES_ELECTIONS_POLITICS",
]);

function buildExplicitTargeting(t, opts = {}) {
  // groupLocationsByType + dropOverlappingIncludes live in
  // utils/targetingGeo.js (pure module — kept out of this controller's
  // require chain so the targeting transforms are unit-testable without
  // pulling Redis / SDK / DB connections at module load).
  // Same pattern for formToFlexibleSpec (utils/detailedTargeting.js).

  let geoLocations;
  let excludedGeo;
  if (t.worldwide) {
    geoLocations = { country_groups: ["worldwide"] };
    excludedGeo = { countries: WORLDWIDE_EXCLUDED_COUNTRIES };
  } else {
    const locations = t.locations || [];
    geoLocations = groupLocationsByType(
      dropOverlappingIncludes(locations.filter((l) => l.mode === "include")),
    );
    const excluded = groupLocationsByType(
      locations.filter((l) => l.mode === "exclude"),
    );
    if (Object.keys(excluded).length) excludedGeo = excluded;
  }

  const spec = {
    geo_locations: geoLocations,
    age_min: t.ageMin,
    age_max: t.ageMax,
    ...(t.genders?.length ? { genders: t.genders } : {}),
    ...(t.locales?.length ? { locales: t.locales } : {}),
    targeting_automation: {
      advantage_audience: t.advantageAudience ? 1 : 0,
    },
  };
  if (excludedGeo) spec.excluded_geo_locations = excludedGeo;
  if (t.placementMode === "manual" && t.publisherPlatforms?.length) {
    spec.publisher_platforms = t.publisherPlatforms;
  }
  if (t.devicePlatforms?.length) spec.device_platforms = t.devicePlatforms;

  // Detailed Targeting — Demographics / Interests / Behaviours. Stripped
  // entirely when the campaign has a regulated SAC (matches Meta UI's
  // hide-the-section behaviour). The caller passes the campaign's
  // specialAdCategories via opts for this check.
  const sacs = Array.isArray(opts.specialAdCategories) ? opts.specialAdCategories : [];
  const sacBlocks = sacs.some((c) => SAC_BLOCKING_DETAILED_TARGETING.has(c));
  if (!sacBlocks && t.detailedTargeting) {
    const { flexible_spec, exclusions, topLevel } = formToFlexibleSpec(t.detailedTargeting);
    if (flexible_spec) spec.flexible_spec = flexible_spec;
    if (exclusions) {
      // Merge into any existing geo-based exclusions Meta supports on the
      // same `exclusions` field. Geo excludes go on `excluded_geo_locations`
      // (set above); the `exclusions` field holds detailed-targeting only.
      spec.exclusions = exclusions;
    }
    // Top-level integer-array classes (education_statuses / relationship_statuses
    // / interested_in) — Meta wants these at the root of targeting, not
    // inside flexible_spec. Subcode 1885097 fires if sent the wrong way.
    if (topLevel) Object.assign(spec, topLevel);
  }

  return spec;
}

// ─── createCampaignV2 ───────────────────────────────────────────────────────

async function createCampaignV2(req, res) {
  /* #swagger.tags = ['Meta Ads Launcher V2']
     #swagger.description = 'V2 wizard — create a Meta campaign (Traffic / Leads / App Promotion only)'
  */
  const { error, value } = createCampaignSchemaV2.validate(req.body);
  if (error) {
    return res.status(400).json({
      status: false,
      error: error.details[0].context?.message || error.details[0].message,
    });
  }

  const userId = req.user.user_id;
  const {
    adAccountId,
    name,
    objective,
    specialAdCategories,
    specialAdCategoryCountries,
    dailyBudget,
    lifetimeBudget,
    bidStrategy,
    spendCap,
    iosOptimised,
    applicationId,
    objectStoreUrl,
    status,
  } = value;

  try {
    await initApiForUser(userId, getFacebookIdFromRequest(req));
    const account = new AdAccount(`act_${adAccountId}`);

    const params = {
      name,
      objective,
      status,
      special_ad_categories: specialAdCategories,
    };
    // Required by Meta whenever `special_ad_categories` is non-empty —
    // pins the campaign to a specific country set and constrains every
    // ad set's location targeting. Without it, Meta picks a default
    // (often the account region) and rejects ad sets whose locations
    // fall outside, with subcode 2909034 "Special Ad Category errors".
    if (
      specialAdCategories?.length &&
      specialAdCategoryCountries?.length
    ) {
      params.special_ad_category_country = specialAdCategoryCountries;
    }
    // CBO: when a campaign-level budget is set, Meta requires bid strategy
    // on the campaign and forbids ad-set-level budgets later. The
    // `is_adset_budget_sharing_enabled` flag defaults false unless explicit
    // sharing is configured (see gotchas.md for the historical context).
    if (dailyBudget) params.daily_budget = dailyBudget;
    if (lifetimeBudget) params.lifetime_budget = lifetimeBudget;
    if (dailyBudget || lifetimeBudget) {
      if (bidStrategy) params.bid_strategy = bidStrategy;
    } else {
      params.is_adset_budget_sharing_enabled = false;
    }
    // Optional cap on total campaign spend (auto-pause when reached).
    if (spendCap) params.spend_cap = spendCap;
    // iOS 14+ / SKAdNetwork attribution — App Promotion only. Must be
    // sent EXPLICITLY (true or false) for OUTCOME_APP_PROMOTION because
    // Meta v24 defaults non-iOS14+ App Promotion campaigns to AEM
    // attribution automatically, then rejects ad-set creation with
    // subcode 3955009 ("Invalid campaign attribution for non-iOS14+
    // campaign") unless the campaign is flagged iOS14+. Opting out
    // explicitly tells Meta to use standard attribution (Android +
    // pre-14.5 iOS delivery).
    if (objective === "OUTCOME_APP_PROMOTION") {
      params.is_skadnetwork_attribution = !!iosOptimised;
      // iOS 14+ campaigns also bind the app at the CAMPAIGN level via
      // promoted_object. Meta uses this for SKAdNetwork attribution;
      // without it the ad-set creation fails. The validator already
      // requires applicationId + objectStoreUrl when iosOptimised is
      // true, and rejects non-Apple stores at the API boundary.
      if (iosOptimised && applicationId && objectStoreUrl) {
        params.promoted_object = {
          application_id: applicationId,
          object_store_url: objectStoreUrl,
        };
      }
    }

    const campaign = await account.createCampaign([], params);

    // V2 reuses V1's surgical cache bust — same Redis keys.
    await invalidateAfterCreate(userId, { adAccountId });

    return res.status(201).json({
      status: true,
      message: "Campaign created",
      campaign: {
        id: campaign.id,
        name,
        objective,
        status,
        dailyBudget: dailyBudget || null,
        lifetimeBudget: lifetimeBudget || null,
        cbo: !!(dailyBudget || lifetimeBudget),
      },
    });
  } catch (err) {
    return res.status(500).json(metaErrorResponse(err, "create campaign", req));
  }
}

// ─── createAdSetV2 ──────────────────────────────────────────────────────────

async function createAdSetV2(req, res) {
  /* #swagger.tags = ['Meta Ads Launcher V2']
     #swagger.description = 'V2 wizard — create a Meta ad set under a campaign'
  */
  // Resolve the cell before validating — Joi factory needs the cell key.
  const resolved = resolveCellOr400(req);
  if (!resolved.ok) return res.status(resolved.status).json(resolved.body);

  const { objective, conversionLocation } = req.body;
  const cell = resolved.cell;

  const schema = buildAdSetSchemaV2(objective, conversionLocation);
  const { error, value } = schema.validate(req.body);
  if (error) {
    return res.status(400).json({
      status: false,
      error: error.details[0].context?.message || error.details[0].message,
    });
  }

  const userId = req.user.user_id;

  if (value.targeting.ageMin > value.targeting.ageMax) {
    return res.status(400).json({
      status: false,
      error: "targeting.ageMin must be less than or equal to targeting.ageMax",
    });
  }

  try {
    await initApiForUser(userId, getFacebookIdFromRequest(req));
    const account = new AdAccount(`act_${value.adAccountId}`);

    // Read the parent campaign — the ad set INHERITS the campaign's bid
    // strategy when the campaign uses Campaign Budget Optimization (CBO).
    // We can't trust the client to know this (the campaign list is cached),
    // so the backend is authoritative: a CBO campaign owns the bid strategy
    // (its ad sets must not send a conflicting one), and a *capped* strategy
    // (LOWEST_COST_WITH_BID_CAP / COST_CAP) requires a bid_amount on every
    // ad set (Meta subcode 1815857 otherwise).
    let campaignData = {};
    try {
      const campaign = await new bizSdk.Campaign(value.campaignId).get([
        "id",
        "bid_strategy",
        "daily_budget",
        "lifetime_budget",
        // Needed by buildExplicitTargeting's SAC-detailedTargeting guard —
        // regulated SACs (Financial / Employment / Housing / Credit /
        // Issues) require the detailed-targeting block to be stripped from
        // the spec at launch (Meta UI hides the picker; API rejects with
        // subcode 2446007 if we send it).
        "special_ad_categories",
      ]);
      campaignData = campaign?._data || campaign || {};
    } catch (err) {
      // Non-fatal: if we can't read the campaign, fall back to the ad set's
      // own bid strategy (the pre-existing behaviour). Meta will still
      // surface any bid issue at create time.
      logger.warn(
        `createAdSetV2: couldn't read campaign ${value.campaignId} for bid context: ${err?.message || err}`,
      );
    }
    const campaignIsCbo =
      Number(campaignData.daily_budget) > 0 ||
      Number(campaignData.lifetime_budget) > 0;
    // Effective strategy: the campaign's when CBO (inherited), else the
    // ad set's own (ABO campaigns set bid strategy per ad set).
    const effectiveBidStrategy = campaignIsCbo
      ? campaignData.bid_strategy
      : value.bidStrategy;
    if (CAPPED_BID_STRATEGIES.has(effectiveBidStrategy) && !value.bidAmount) {
      return res.status(400).json({
        status: false,
        error: campaignIsCbo
          ? `This campaign uses a ${effectiveBidStrategy} bid strategy — enter a bid cap (bid amount) for the ad set.`
          : `A bid amount is required when the bid strategy is ${effectiveBidStrategy}.`,
      });
    }

    // Targeting — same resolution as V1: a saved-audience id replaces the
    // explicit spec when provided; otherwise build from the explicit fields.
    let targetingSpec;
    if (value.savedAudienceId) {
      try {
        const audience = new bizSdk.SavedAudience(value.savedAudienceId);
        const fetched = await audience.get(["targeting"]);
        targetingSpec = fetched.targeting || fetched._data?.targeting;
        if (!targetingSpec) throw new Error("Saved audience has no targeting payload");
      } catch (saErr) {
        return res.status(400).json({
          status: false,
          error: "Could not load the chosen saved audience",
          details: saErr.message,
        });
      }
    } else {
      // Backfill any missing countryCode on sub-country picks before the
      // drop runs. Meta's adgeolocation search omits country_code on some
      // smaller subcity / neighborhood rows (e.g. Varthur, a Bangalore
      // suburb) — without it, `dropOverlappingIncludes` can't tell whether
      // a granular pick is redundant with an included country and Meta
      // rejects at launch with subcode 1487756. Best-effort; mutates the
      // form-model locations in place.
      if (Array.isArray(value.targeting?.locations) && value.targeting.locations.length) {
        const api = bizSdk.FacebookAdsApi.getDefaultApi();
        await backfillLocationCountryCodes(api, value.targeting.locations);
      }
      targetingSpec = buildExplicitTargeting(value.targeting, {
        specialAdCategories: campaignData.special_ad_categories || [],
      });
    }

    // App-cell OS targeting — Meta rejects every App-promoting ad set with
    // subcode 1487678 ("Mobile Targeting Mismatch") when targeting.user_os
    // doesn't match the app's store. We derive it from the store the user
    // already picked rather than asking again. Also force device_platforms
    // to mobile-only since app campaigns can't deliver to desktop. This
    // covers all 3 app-promoting cells: App Promotion/App, Traffic/App,
    // Leads/App (every cell whose promoted_object shape is "app").
    if (cell.adSet.promotedObjectShape === "app") {
      if (value.mobileAppStore === "GOOGLE_PLAY") {
        targetingSpec.user_os = ["Android"];
      } else if (value.mobileAppStore === "APPLE_APP_STORE") {
        targetingSpec.user_os = ["iOS"];
      }
      targetingSpec.device_platforms = ["mobile"];
    }

    const adSetParams = {
      name: value.name,
      campaign_id: value.campaignId,
      billing_event: value.billingEvent,
      optimization_goal: value.optimizationGoal,
      status: value.status,
      targeting: targetingSpec,
    };
    // CBO campaigns own the bid strategy — the ad set inherits it. Sending
    // one here risks a campaign/ad-set conflict, so only ABO ad sets carry
    // their own. (bid_amount is still sent below when present — a CBO capped
    // campaign needs the per-ad-set cap.)
    if (!campaignIsCbo) adSetParams.bid_strategy = value.bidStrategy;

    // promoted_object — built from the cell's shape key. Null shape ⇒
    // field omitted. Pixel-using cells (Leads/Website + Multiple) pass
    // pixelId + pixelEventType for the `pixel` shape. Sales/CATALOG's
    // `product_set` shape additionally needs productSetId — omitting it
    // here (real hit 2026-07-07) throws "pixelId + productSetId are both
    // required" even when value.productSetId passed Joi validation fine,
    // since buildPromotedObject only sees whatever this params object
    // hands it, not the full `value`.
    const promotedObject = buildPromotedObject(cell.adSet.promotedObjectShape, {
      pageId: value.pageId,
      applicationId: value.applicationId,
      objectStoreUrl: value.objectStoreUrl,
      pixelId: value.pixelId,
      pixelEventType: value.pixelEventType,
      productSetId: value.productSetId,
    });
    if (promotedObject) adSetParams.promoted_object = promotedObject;

    // ─── DIAGNOSTIC LOGGING (subcode 2446759 investigation) ──────────────
    // Logs the exact resolved values + final ad set payload Meta receives.
    // Read alongside the Meta error response to diff against a successful
    // Meta UI launch's network capture.
    // logger.info(
    //   `[2446759-DIAG] Pre-create snapshot: ` +
    //     JSON.stringify({
    //       campaignId: value.campaignId,
    //       objective,
    //       conversionLocation,
    //       // Compute inline — the local `metaDestinationType` const is
    //       // declared further down (the original control flow); referencing
    //       // it here would be a temporal-dead-zone error.
    //       destinationType: getMetaDestinationType(objective, conversionLocation),
    //       optimizationGoal: value.optimizationGoal,
    //       billingEvent: value.billingEvent,
    //       promotedObjectShape: cell.adSet.promotedObjectShape,
    //       formPixelId: value.pixelId || null,
    //       formPixelEventType: value.pixelEventType || null,
    //       formApplicationId: value.applicationId || null,
    //       formObjectStoreUrl: value.objectStoreUrl || null,
    //       builtPromotedObject: promotedObject || null,
    //     }),
    // );

    // For Conversions-family objectives (Leads / Sales) with App
    // destination, attempt to set campaign.promoted_object with
    // pixel + event before creating the ad set. Errors are surfaced in
    // the log (no swallowing) so we can diagnose what Meta rejects on
    // the campaign-update path.
    //
    // SKIP for OUTCOME_LEADS — Meta confirmed subcode 1815023 ("Promoted
    // object is not valid for the objective") on this path 2026-06-24.
    // The Leads/APP fix is at the adset.promoted_object level via the
    // `app` shape returning custom_event_type alongside the app fields
    // (see promotedObject.js). Leaving the branch reachable for other
    // objectives in case the constraint differs.
    if (
      cell.adSet.promotedObjectShape === "app" &&
      objective === "OUTCOME_SALES" &&
      value.pixelId &&
      value.pixelEventType
    ) {
      const campaignPromotedObject = {
        pixel_id: value.pixelId,
        custom_event_type: value.pixelEventType,
      };
      logger.info(
        `[2446759-DIAG] Attempting campaign.update on ${value.campaignId} with promoted_object=` +
          JSON.stringify(campaignPromotedObject),
      );
      try {
        const updateResult = await new bizSdk.Campaign(value.campaignId).update(
          [],
          { promoted_object: campaignPromotedObject },
        );
        logger.info(
          `[2446759-DIAG] campaign.update SUCCEEDED on ${value.campaignId}, result=` +
            JSON.stringify(updateResult?._data || updateResult || {}),
        );
        // Verify by reading the campaign back.
        try {
          const c = await new bizSdk.Campaign(value.campaignId).get([
            "id",
            "objective",
            "promoted_object",
          ]);
          const cd = c?._data || c || {};
          logger.info(
            `[2446759-DIAG] campaign read-back after update: ` +
              JSON.stringify({
                id: cd.id,
                objective: cd.objective,
                promoted_object: cd.promoted_object,
              }),
          );
        } catch (readErr) {
          logger.warn(
            `[2446759-DIAG] campaign read-back FAILED: ${readErr.message}`,
          );
        }
      } catch (e) {
        // DO NOT swallow — log the full Meta error so we know what's
        // actually being rejected on the campaign-update path.
        const m = formatMetaError(e);
        logger.warn(
          `[2446759-DIAG] campaign.update FAILED on ${value.campaignId}: ` +
            JSON.stringify({
              message: m.message,
              code: m.code,
              subcode: m.subcode,
              fbtraceId: m.fbtraceId,
              data: m.data,
              raw: e?.response,
            }),
        );
      }
    }

    // Sales/CATALOG (Dynamic Product Ads) needs the CAMPAIGN itself bound
    // to a Product Catalog via `promoted_object.product_catalog_id` — a
    // SEPARATE requirement from the ad set's own `promoted_object.
    // product_set_id` built below. Real hit (2026-07-07, subcode 1885032
    // "The 'promoted_object' field is required for the specified
    // objective"): the ad set's own promoted_object was correctly shaped
    // (`{product_set_id, custom_event_type}`, per the product_set fix
    // above), but Meta still rejected ad-set creation because the parent
    // CAMPAIGN never declared a catalog — confirmed against Meta's own
    // Dynamic Ads / Catalog Sales reference doc: the campaign needs
    // `promoted_object: {product_catalog_id}`, distinct from the ad set's
    // `product_set_id`. Unlike the diagnostic app-shape block above, this
    // is NOT best-effort — without it every ad set under this campaign
    // fails identically, so a failure here is surfaced as a real error
    // rather than logged-and-continued.
    //
    // CORRECTED 2026-07-08 (subcode 1885090 "Invalid promoted object
    // update... immutable for most cases", blame_field_specs:
    // ["ProductCatalogID"]): the original fix called `Campaign.update()`
    // unconditionally on EVERY ad-set creation, on the assumption this was
    // idempotent like the campaign-budget retry-sync fix elsewhere in this
    // file. It ISN'T — Meta rejects ANY update attempt on promoted_object
    // once it's already set, even resending the identical value. This
    // worked for a campaign's FIRST ad set (nothing set yet) and broke
    // every SUBSEQUENT ad set added to the same campaign (real hit:
    // launching a Sales/CATALOG campaign succeeded, then adding a second
    // ad set to it failed here). Fixed by reading the campaign's current
    // promoted_object first and only calling update when it's genuinely
    // unset — matching Meta's real "settable once" semantics instead of
    // assuming "settable repeatedly with the same value."
    if (cell.adSet.promotedObjectShape === "product_set" && value.catalogId) {
      try {
        const campaignData = await new bizSdk.Campaign(value.campaignId).get([
          "promoted_object",
        ]);
        const existingCatalogId =
          (campaignData?._data || campaignData || {}).promoted_object
            ?.product_catalog_id || null;
        if (!existingCatalogId) {
          await new bizSdk.Campaign(value.campaignId).update([], {
            promoted_object: { product_catalog_id: value.catalogId },
          });
        } else if (existingCatalogId !== value.catalogId) {
          // Meta locks the campaign to whichever catalog its FIRST ad set
          // bound it to — a later ad set can't switch it. Surface this
          // clearly instead of letting Meta's generic "immutable" error
          // through with no explanation of which catalog actually won.
          return res.status(400).json({
            status: false,
            error: "This campaign is already bound to a different Product Catalog",
            details:
              "Every ad set in a Sales/Catalog campaign must use the catalog Meta locked in when the campaign's first ad set was created. Create a new campaign to use a different catalog.",
          });
        }
        // else: already bound to this exact catalog — nothing to do.
      } catch (e) {
        return res
          .status(500)
          .json(metaErrorResponse(e, "bind campaign to product catalog", req));
      }
    }

    // (FINAL adSetParams logging moved to immediately before
    //  account.createAdSet() — see below — so the snapshot includes
    //  every field that gets set after this point: destination_type,
    //  budget, attribution, schedule, frequency_control_specs, DSA, etc.)

    // destination_type — resolved per (objective, conversionLocation).
    // Some conversion-location keys (WEBSITE_AND_CALLS) need a different
    // value depending on objective, so both args matter. `null` ⇒ omit
    // the field (Meta infers — e.g. the Leads "Multiple" cells).
    const metaDestinationType = getMetaDestinationType(objective, conversionLocation);
    if (metaDestinationType) adSetParams.destination_type = metaDestinationType;

    if (value.dailyBudget) adSetParams.daily_budget = value.dailyBudget;
    if (value.lifetimeBudget) adSetParams.lifetime_budget = value.lifetimeBudget;
    if (value.bidAmount) adSetParams.bid_amount = value.bidAmount;
    if (value.dynamicCreative) adSetParams.is_dynamic_creative = true;

    // frequency_control_specs — Awareness/STANDARD (REACH goal only). Meta's
    // shape is an array of {event, interval_days, max_frequency}; the wizard
    // exposes ONE cap (single-spec model). Event is hard-coded to IMPRESSIONS
    // (the only event Awareness frequency caps run against). Multi-spec
    // entries deferred per AWARENESS_CELLS_SPEC.md §6b.
    if (value.frequencyControl) {
      adSetParams.frequency_control_specs = [
        {
          event: "IMPRESSIONS",
          interval_days: value.frequencyControl.capPeriodDays,
          max_frequency: value.frequencyControl.capFrequency,
        },
      ];
    }
    // attribution_spec — Meta expects an array of {event_type, window_days}.
    // The wizard's compact enum maps to the full array here.
    //
    // Different (objective, optimization_goal) cells accept VERY different
    // window combinations (Meta error subcode 1885501 fires on any mismatch
    // with `error_user_msg` listing the allowed pairs). Rather than build a
    // (cell → allowed pairs) table and risk drift with Meta's rules, we
    // skip attribution_spec entirely for the cells with the strictest
    // constraints (Leads — only (1, 0) is accepted for LEAD_GENERATION) and
    // let Meta server-side apply its known-correct default for that cell.
    //
    // For other objectives (Traffic / App Promotion / Sales etc) we honour
    // the user's explicit choice when set; empty leaves Meta to default.
    const ATTRIBUTION_SPEC_MAP = {
      "1d_click": [{ event_type: "CLICK_THROUGH", window_days: 1 }],
      "7d_click": [{ event_type: "CLICK_THROUGH", window_days: 7 }],
      "1d_click_1d_view": [
        { event_type: "CLICK_THROUGH", window_days: 1 },
        { event_type: "VIEW_THROUGH", window_days: 1 },
      ],
      "7d_click_1d_view": [
        { event_type: "CLICK_THROUGH", window_days: 7 },
        { event_type: "VIEW_THROUGH", window_days: 1 },
      ],
    };
    const skipAttributionSpec = value.objective === "OUTCOME_LEADS";
    if (
      !skipAttributionSpec &&
      value.attributionWindow &&
      ATTRIBUTION_SPEC_MAP[value.attributionWindow]
    ) {
      adSetParams.attribution_spec = ATTRIBUTION_SPEC_MAP[value.attributionWindow];
    }
    if (value.startTime) adSetParams.start_time = new Date(value.startTime).toISOString();
    if (value.endTime) adSetParams.end_time = new Date(value.endTime).toISOString();

    // DSA (EU Digital Services Act) compliance — Meta requires
    // `dsa_beneficiary` on every ad set (validated at create time, all
    // geos). `dsa_payor` defaults to the beneficiary. Both are free-text
    // strings, auto-filled from the Page name on the wizard.
    // Missing → code 100 / subcode 3858081 "No advertiser indicated".
    if (value.dsaBeneficiary) {
      adSetParams.dsa_beneficiary = value.dsaBeneficiary;
      adSetParams.dsa_payor = value.dsaPayor || value.dsaBeneficiary;
    }

    // NOTE — Taiwan universal ads declaration is intentionally NOT sent
    // here. Unlike DSA's free-text strings, Meta's
    // `regional_regulation_identities.taiwan_universal_beneficiary`
    // expects a NUMERIC ID referencing a pre-registered regulation
    // identity record (Meta error: "must be a number"). The SDK exposes
    // no create/list method for these records and the registration
    // flow is undocumented. Sending a name string broke ad-set creation
    // for every cell. If a customer's ad account is genuinely subject
    // to Taiwan regulation, the identity must be registered in Meta
    // Business Settings first and its id wired through here. Tracked in
    // CAMPAIGN_CREATION_STATUS.md.

    // ─── DIAGNOSTIC LOG (subcode 2446759 investigation) ─────────────────
    // This logs the COMPLETE adSetParams object Meta is about to receive —
    // includes everything set above (destination_type, budget, attribution,
    // schedule, frequency_control_specs, DSA, etc.). Used to diff against
    // a successful Meta UI launch's network capture.
    // logger.info(
    //   `[2446759-DIAG] FINAL adSetParams sent to Meta create-adset: ` +
    //     JSON.stringify(adSetParams, null, 2),
    // );

    const adSet = await account.createAdSet([], adSetParams);

    await invalidateAfterCreate(userId, {
      adAccountId: value.adAccountId,
      campaignId: value.campaignId,
    });

    return res.status(201).json({
      status: true,
      message: "Ad set created",
      adSet: {
        id: adSet.id,
        name: value.name,
        campaignId: value.campaignId,
        status: value.status,
      },
    });
  } catch (err) {
    return res.status(500).json(metaErrorResponse(err, "create ad set", req));
  }
}

// Build an AdCreative from the validated ad `value` for a cell. Shared by
// createAdV2 (new ad) + updateAdV2 (creative swap — Meta won't edit a
// creative in place, so editing rebuilds + re-points). Returns
// { ok: true, creative } or { ok: false, status, body } for the controller
// to forward (clean 400s for missing phone / still-encoding video).
async function buildAdCreativeOr400(account, cell, value) {
  // phoneNumber for Click-to-Call ads — resolved from the Page (not a
  // wizard form field). If the page has no phone configured, surface a
  // clean 400 with what the user needs to do.
  let phoneNumber;
  if (cell.ad.objectStorySpecShape === "click_to_call") {
    phoneNumber = await getPagePhone(value.pageId);
    if (!phoneNumber) {
      return {
        ok: false,
        status: 400,
        body: {
          status: false,
          error: "Page has no phone number configured",
          details:
            "Click-to-Call ads use the phone number on the Facebook Page's About → Contact info. Add a number on the Page and retry.",
        },
      };
    }
  }

  // Video thumbnail — last-chance auto-fetch via the shared waiter
  // (24s ceiling, retries with delays). Longer clips don't always have
  // thumbnails ready immediately after upload; the waiter gives Meta
  // time to finish encoding. Returns a clean 400 if still missing.
  if (value.videoId && !value.videoThumbnailUrl) {
    value.videoThumbnailUrl = await waitForVideoThumbnail(value.videoId);
    if (!value.videoThumbnailUrl) {
      return {
        ok: false,
        status: 400,
        body: {
          status: false,
          error: "Video is still encoding",
          details:
            "Meta hasn't generated a thumbnail for this video yet. Wait ~30 seconds and retry, or paste a custom Thumbnail URL on the Ad step.",
        },
      };
    }
  }

  // Sales/CATALOG (Dynamic Product Ads) — the AdCreative itself needs a
  // TOP-LEVEL `product_set_id` field, separate from and in addition to
  // `object_story_spec.template_data`. Real hit (2026-07-07, subcode
  // 1487891 "Invalid creative for objective"): the creative built fine
  // (template_data shape was correct) but Meta rejected the AD anyway,
  // because the creative object itself never declared which product set
  // it draws from — confirmed against Meta's own `ad-creative` reference
  // doc. The wizard's Ad step never collects productSetId (it was already
  // picked on the earlier Ad Set step's Catalog sub-step and isn't part
  // of `buildAdSchemaV2`), so we re-derive it from the ad set's own
  // `promoted_object.product_set_id` — same "resolve from the ad set"
  // pattern already used for pageId (see resolvePageIdForAdSet above).
  let productSetId;
  if (cell.ad.objectStorySpecShape === "template_data") {
    try {
      const adSetData = await new bizSdk.AdSet(value.adSetId).get(["promoted_object"]);
      const data = adSetData?._data || adSetData || {};
      productSetId = data.promoted_object?.product_set_id || null;
    } catch {
      productSetId = null;
    }
    if (!productSetId) {
      return {
        ok: false,
        status: 400,
        body: {
          status: false,
          error: "Could not resolve the Product Set for this ad set",
          details:
            "This ad set's promoted_object has no product_set_id on Meta's side — it may not have been created through the Catalog wizard step.",
        },
      };
    }
  }

  // object_story_spec — driven by the cell's shape key.
  const objectStorySpec = buildObjectStorySpec(cell.ad.objectStorySpecShape, {
    pageId: value.pageId,
    instagramUserId: value.instagramUserId,
    imageHash: value.imageHash || undefined,
    videoId: value.videoId || undefined,
    videoThumbnailUrl: value.videoThumbnailUrl || undefined,
    headline: value.headline,
    primaryText: value.primaryText,
    description: value.description,
    callToAction: value.callToAction,
    linkUrl: value.linkUrl,
    leadFormId: value.leadFormId,
    objectStoreUrl: value.objectStoreUrl,
    applicationId: value.applicationId,
    deepLink: value.deferredDeepLink || undefined,
    customProductPage: value.customProductPage || undefined,
    autoTranslate: value.autoTranslate || false,
    phoneNumber,
  });

  const creativeParams = {
    name: `${value.name} — creative`,
    object_story_spec: objectStorySpec,
  };
  if (productSetId) creativeParams.product_set_id = productSetId;
  if (value.urlTags) creativeParams.url_tags = value.urlTags.replace(/^\?/, "");

  // Auto-translate ad copy across viewers' locales. Meta moved the setting
  // out of object_story_spec.link_data in v24 (now triggers subcode 1443050
  // there) and into the AdCreative's degrees_of_freedom_spec under
  // creative_features_spec. The valid key per Meta's API is
  // `TEXT_OVERLAY_TRANSLATION` (uppercase enum, not the lowercase
  // `translate_text` Meta hints at in some older docs). Meta's full
  // accepted set: IG_VIDEO_NATIVE_SUBTITLE, IMAGE_ANIMATION,
  // PRODUCT_BROWSING, PRODUCT_METADATA_AUTOMATION, PROFILE_CARD,
  // STANDARD_ENHANCEMENTS_CATALOG, TEXT_OVERLAY_TRANSLATION.
  if (value.autoTranslate) {
    creativeParams.degrees_of_freedom_spec = {
      creative_features_spec: {
        TEXT_OVERLAY_TRANSLATION: { enroll_status: "OPT_IN" },
      },
    };
  }

  if (cell.ad.objectStorySpecShape === "click_to_call") {
    const ctaValue =
      objectStorySpec?.link_data?.call_to_action?.value ||
      objectStorySpec?.video_data?.call_to_action?.value;
    logger.info(
      `buildAdCreative click_to_call: resolved phoneNumber=${JSON.stringify(phoneNumber)} ` +
        `→ CTA value=${JSON.stringify(ctaValue)}`,
    );
  }

  const creative = await account.createAdCreative([], creativeParams);
  return { ok: true, creative };
}

// ─── createAdV2 ─────────────────────────────────────────────────────────────

async function createAdV2(req, res) {
  /* #swagger.tags = ['Meta Ads Launcher V2']
     #swagger.description = 'V2 wizard — create an ad creative + ad under an ad set'
  */
  const resolved = resolveCellOr400(req);
  if (!resolved.ok) return res.status(resolved.status).json(resolved.body);

  const { objective, conversionLocation } = req.body;
  const cell = resolved.cell;

  const schema = buildAdSchemaV2(objective, conversionLocation);
  const { error, value } = schema.validate(req.body);
  if (error) {
    return res.status(400).json({
      status: false,
      error: error.details[0].context?.message || error.details[0].message,
    });
  }

  const userId = req.user.user_id;

  try {
    await initApiForUser(userId, getFacebookIdFromRequest(req));
    const account = new AdAccount(`act_${value.adAccountId}`);

    const built = await buildAdCreativeOr400(account, cell, value);
    if (!built.ok) return res.status(built.status).json(built.body);
    const creative = built.creative;

    const ad = await account.createAd([], {
      name: value.name,
      adset_id: value.adSetId,
      creative: { creative_id: creative.id },
      status: value.status,
    });

    await invalidateAfterCreate(userId, {
      adAccountId: value.adAccountId,
      adSetId: value.adSetId,
    });

    return res.status(201).json({
      status: true,
      message: "Ad created",
      ad: { id: ad.id, name: value.name, status: value.status },
      creative: { id: creative.id },
    });
  } catch (err) {
    return res.status(500).json(metaErrorResponse(err, "create ad", req));
  }
}

// Resolve an ad set's Facebook Page. `promoted_object.page_id` only exists
// for the "page" promotedObjectShape (Traffic/Leads-style cells) — cells
// shaped "pixel" (Leads/Sales Website, Multiple cells) never carry page_id
// there at all, since Page association for those lives on the ad's
// CREATIVE (`object_story_spec.page_id` — every objectStorySpecShape sets
// this, see utils/objectStorySpec.js's `base = {page_id: ...}`), not the
// ad set. Falls back to reading an existing ad's creative when the
// promoted_object comes up empty. Used by both resolveCellForAdSet (Add Ad)
// and resolveAdSetForEdit (Edit Ad Set) — extracted 2026-07-06 after the
// Edit Ad Set flow shipped WITHOUT this fallback (only resolveCellForAdSet
// had it), silently blanking the Facebook Page field — required, but with
// nothing to select — for every ad set under a "pixel"-shape cell.
async function resolvePageIdForAdSet(adSetId, promotedObject) {
  let pageId = promotedObject?.page_id || null;
  if (pageId) return pageId;
  try {
    const ads = await new bizSdk.AdSet(adSetId).getAds(
      ["creative{object_story_spec,effective_object_story_id}"],
      { limit: 1 },
    );
    const firstAd = (ads || [])[0];
    const adData = firstAd?._data || firstAd || {};
    const oss = adData.creative?.object_story_spec;
    pageId = oss?.page_id || null;
    if (!pageId && adData.creative?.effective_object_story_id) {
      // Format: "<pageId>_<postId>".
      pageId = String(adData.creative.effective_object_story_id).split("_")[0] || null;
    }
  } catch {
    /* no readable ad — leave null; caller's page picker stays empty/required */
  }
  return pageId;
}

// Resolve pageId + instagramUserId together for the Add-Ad flow specifically
// (resolveCellForAdSet). Real gap (2026-07-07, found during a proactive
// audit of Edit Ad Set / Edit Ad / Add Ad / Add Ad Set — not a user report):
// `instagramUserId` is ONLY ever set via the Page picker's `onPickPage`
// handler on the Ad Set step (auto-derived from the Page's linked
// instagram_business_account — see CreateCampaignWizardV2.jsx). Add Ad
// skips the Ad Set step entirely (the ad set already exists) and there's no
// other UI control for this field ("the wizard no longer surfaces a
// (read-only) IG field for it"), so every ad added via Add Ad silently lost
// its Instagram identity even when the Page has one linked and the ad
// set's OTHER ads already carry it — not a hard Meta rejection (IG is
// optional; Meta falls back to a shadow account), but a silent behavior
// regression the user never asked for.
//
// `instagram_user_id` is never on `promoted_object` (same shape gap as
// `page_id` for non-"page" cells) — it only lives on an ad's creative
// object_story_spec, set by `buildObjectStorySpec`'s
// `if (params.instagramUserId) base.instagram_user_id = ...`. Reuses the
// SAME existing-ad-creative fetch `resolvePageIdForAdSet` already makes for
// its own fallback, just also reads instagram_user_id off the same
// response — kept as a separate function (not merged into
// resolvePageIdForAdSet) so `resolveAdSetForEdit` — which doesn't need
// instagramUserId at all — doesn't pay for an extra fetch when
// promoted_object.page_id is already present.
async function resolveIdentityForAddAd(adSetId, promotedObject) {
  let pageId = promotedObject?.page_id || null;
  let instagramUserId = null;
  try {
    const ads = await new bizSdk.AdSet(adSetId).getAds(
      ["creative{object_story_spec,effective_object_story_id}"],
      { limit: 1 },
    );
    const firstAd = (ads || [])[0];
    const adData = firstAd?._data || firstAd || {};
    const oss = adData.creative?.object_story_spec;
    if (!pageId) {
      pageId = oss?.page_id || null;
      if (!pageId && adData.creative?.effective_object_story_id) {
        pageId = String(adData.creative.effective_object_story_id).split("_")[0] || null;
      }
    }
    instagramUserId = oss?.instagram_user_id || null;
  } catch {
    /* no readable ad — leave both null; caller's pickers stay empty/optional */
  }
  return { pageId, instagramUserId };
}

// Re-derive a trustworthy objectStoreUrl for an app-shape cell instead of
// blindly trusting a stored value (subcode 1885270 "Should load matching
// digital store object" — the app ID and link must resolve to the SAME
// Meta digital store object). Real trigger (2026-07-07): Add Ad on an
// existing App Promotion ad set failed with this subcode even though
// applicationId + objectStoreUrl were both non-empty — audited every
// interactive picker (AppLinkagePicker keeps both atomic at pick time, no
// bug found there), so the mismatch most likely originates from an ad set
// created outside our own wizard flow (this account's userId pattern,
// e.g. "GPT-435", suggests API/agent-driven creation exists alongside it).
//
// Pass 1 (shipped, deployed, re-tested — NO CHANGE): inferred platform from
// `targeting.user_os`. Didn't help: `user_os` almost certainly isn't set
// the way `createAdSetV2` sets it on an externally-created ad set, so
// platform inference silently returned null and the whole re-derivation
// was skipped with no signal that anything had gone wrong.
//
// Pass 2 (current): infers platform from the STORED url's own domain
// first (`itunes.apple.com`/`apps.apple.com` → ios, `play.google.com` →
// android) — a signal that exists regardless of how the ad set was
// created, since Meta already accepted SOME url on it. `userOs` is only a
// fallback for when the stored url is empty/unparseable. Logs at every
// branch so a recurrence gives real diagnostic data instead of another
// silent no-op — see the three log lines below.
//
// Used by BOTH `resolveCellForAdSet` (Add Ad — reads applicationId +
// objectStoreUrl from the ad set's promoted_object) and `resolveAdForEdit`
// (Edit Ad — mixes applicationId from the ad SET's promoted_object with
// objectStoreUrl from the AD's own creative link, an even more likely
// mismatch source since the two values come from genuinely different
// objects). Extracted as shared from the start this time, rather than
// waiting for a second endpoint to drift — see the `additionalFields`/
// resolvePageIdForAdSet gotchas for why that pattern recurred three times
// this session when NOT done proactively.
async function resolveObjectStoreUrlForApp(applicationId, storedUrl, userOs, callerLabel) {
  if (!applicationId) return storedUrl || null;
  let objectStoreUrl = storedUrl || null;
  try {
    const inferPlatformFromUrl = (url) => {
      if (!url) return null;
      const u = String(url).toLowerCase();
      if (u.includes("itunes.apple.com") || u.includes("apps.apple.com")) return "ios";
      if (u.includes("play.google.com")) return "android";
      return null;
    };
    const os = userOs || [];
    const platform =
      inferPlatformFromUrl(objectStoreUrl) ||
      (os.includes("Android") ? "android" : os.includes("iOS") ? "ios" : null);
    if (!platform) {
      logger.warn(
        `${callerLabel}: couldn't infer platform for application ${applicationId} ` +
          `(storedUrl=${objectStoreUrl}, user_os=${JSON.stringify(os)}) — keeping stored objectStoreUrl unchanged`,
      );
      return objectStoreUrl;
    }
    const api = bizSdk.FacebookAdsApi.getDefaultApi();
    const app = await api.call("GET", [applicationId], { fields: "object_store_urls" });
    const appData = app?._data || app || {};
    const liveUrl = pickAppStoreUrl(appData.object_store_urls, platform);
    if (liveUrl && liveUrl !== objectStoreUrl) {
      logger.info(
        `${callerLabel}: objectStoreUrl mismatch for application ${applicationId} ` +
          `(platform=${platform}) — stored="${objectStoreUrl}", live="${liveUrl}". Using live value.`,
      );
      objectStoreUrl = liveUrl;
    } else if (!liveUrl) {
      logger.warn(
        `${callerLabel}: application ${applicationId} has NO live object_store_urls entry ` +
          `for platform=${platform} (object_store_urls=${JSON.stringify(appData.object_store_urls)}) — ` +
          `keeping stored objectStoreUrl="${objectStoreUrl}" unchanged, this will likely still fail with subcode 1885270`,
      );
    }
  } catch (err) {
    logger.warn(
      `${callerLabel}: failed to re-resolve objectStoreUrl for application ${applicationId}: ${err.message}`,
    );
  }
  return objectStoreUrl;
}

// ─── resolveCellForAdSet ──────────────────────────────────────────────────────

/**
 * GET /v2/resolve-cell — given an existing ad set, return the wizard cell
 * (objective × conversionLocation) plus the context the management "Add Ad"
 * flow needs to prefill. Reads the ad set + its campaign from Meta and runs
 * the shared cell inference. Returns 422 when the campaign's objective isn't
 * a V2-supported cell (so the UI can hide Add/Edit for legacy objectives).
 */
async function resolveCellForAdSet(req, res) {
  /* #swagger.tags = ['Meta Ads Launcher V2']
     #swagger.description = 'V2 — resolve the wizard cell for an existing ad set'
  */
  try {
    const adSetId = String(req.query.adSetId || "").trim();
    if (!adSetId) {
      return res
        .status(400)
        .json({ status: false, error: "adSetId is required" });
    }
    const userId = req.user.user_id;
    await initApiForUser(userId, getFacebookIdFromRequest(req));

    let adSetData;
    let campaignData;
    try {
      const adSet = await new bizSdk.AdSet(adSetId).get([
        "id",
        "name",
        "campaign_id",
        "destination_type",
        "promoted_object",
        "optimization_goal",
        "targeting",
      ]);
      adSetData = adSet?._data || adSet || {};
      const campaignId =
        String(req.query.campaignId || adSetData.campaign_id || "").trim();
      if (!campaignId) {
        return res.status(400).json({
          status: false,
          error: "Couldn't resolve the campaign for this ad set",
        });
      }
      const campaign = await new bizSdk.Campaign(campaignId).get([
        "id",
        "name",
        "objective",
        "status",
      ]);
      campaignData = campaign?._data || campaign || {};
    } catch (err) {
      return res.status(400).json(metaErrorResponse(err, "load ad set", req));
    }

    const cellInfo = inferCellForMetaCampaign(campaignData, adSetData);
    if (cellInfo.error) {
      return res.status(422).json({ status: false, error: cellInfo.error });
    }

    // Resolve the ad set's Facebook Page + Instagram identity so the
    // Add-Ad flow inherits both (the Lead Form step needs the page, the ad
    // creative is page-scoped, and instagramUserId — see
    // resolveIdentityForAddAd's docblock — has no other way to reach this
    // flow at all since Add Ad skips the Page-picker-bearing Ad Set step).
    const { pageId, instagramUserId } = await resolveIdentityForAddAd(
      adSetId,
      adSetData.promoted_object,
    );

    // Real trigger (2026-07-06, Sales/App — but the gap is generic to EVERY
    // "app" promotedObjectShape cell: App Promotion, Traffic/App, Leads/App,
    // Engagement/App, Sales/App, Sales/WEBSITE_AND_APP): Add Ad never
    // collected applicationId/objectStoreUrl at all — those are normally
    // gathered on the Ad SET step, which "Add Ad" skips entirely since the
    // ad set already exists. The Ad's creative still needs them to build
    // its app_link object_story_spec (`data.link = objectStoreUrl`,
    // `value.application = applicationId` on the CTA), so createAdV2
    // rejected with "objectStoreUrl is not allowed to be empty" — Joi
    // correctly caught a value that was never collected anywhere in this
    // flow. resolveAdSetForEdit and resolveAdForEdit already read these
    // same two fields off promoted_object for their own flows; this was the
    // one resolve endpoint of the three that hadn't inherited the fix.
    // objectStoreUrl re-derived live rather than trusted verbatim — subcode
    // 1885270 fix, see resolveObjectStoreUrlForApp's docblock above.
    const applicationId = adSetData.promoted_object?.application_id || null;
    const objectStoreUrl = await resolveObjectStoreUrlForApp(
      applicationId,
      adSetData.promoted_object?.object_store_url || null,
      adSetData.targeting?.user_os,
      "resolveCellForAdSet",
    );

    return res.status(200).json({
      status: true,
      objective: cellInfo.objective,
      conversionLocation: cellInfo.conversionLocation,
      campaignId: campaignData.id,
      adSetId: adSetData.id,
      pageId,
      instagramUserId,
      applicationId,
      objectStoreUrl,
    });
  } catch (err) {
    return res.status(500).json(metaErrorResponse(err, "resolve cell", req));
  }
}

// ─── resolveCampaignForAdd ────────────────────────────────────────────────────

/**
 * GET /v2/resolve-campaign — fresh campaign settings for the management
 * "Add Ad Set" AND "Edit campaign" flows. The campaign LIST is cached
 * (Redis), so a freshly read bid strategy / CBO state / budgets / spend cap
 * here ensures the wizard renders + prefills correctly (e.g. a bid cap for a
 * capped CBO campaign, raw minor-unit budgets for editing) instead of a
 * stale or lossy formatted value.
 */
async function resolveCampaignForAdd(req, res) {
  /* #swagger.tags = ['Meta Ads Launcher V2']
     #swagger.description = 'V2 — fresh campaign settings for Add Ad Set / Edit campaign'
  */
  try {
    const campaignId = String(req.query.campaignId || "").trim();
    if (!campaignId) {
      return res
        .status(400)
        .json({ status: false, error: "campaignId is required" });
    }
    const userId = req.user.user_id;
    await initApiForUser(userId, getFacebookIdFromRequest(req));

    let d = {};
    try {
      const campaign = await new bizSdk.Campaign(campaignId).get([
        "id",
        "name",
        "objective",
        "status",
        "bid_strategy",
        "daily_budget",
        "lifetime_budget",
        "spend_cap",
        "special_ad_categories",
      ]);
      d = campaign?._data || campaign || {};
    } catch (err) {
      return res.status(400).json(metaErrorResponse(err, "load campaign", req));
    }

    // Real trigger (2026-07-06, subcode 1885760 "Optimisation for ad
    // delivery selections must be the same"): Meta requires every ad set
    // in a campaign to share the SAME optimization_goal whenever the
    // effective bid strategy is a "lowest cost" (auto-bid) family — which
    // is BOTH bid strategies our wizard offers (LOWEST_COST_WITHOUT_CAP,
    // LOWEST_COST_WITH_BID_CAP), so this applies to every Add-Ad-Set onto
    // an existing, non-empty campaign, CBO or ABO. We had no visibility
    // into the existing ad set's goal at all, so a user could freely pick
    // a mismatched Performance goal and only find out at publish, with an
    // opaque error and no indication which field to fix. Best-effort: a
    // failure here degrades to `existingOptimizationGoal: null` (treated
    // as "no constraint known") rather than blocking campaign load.
    let existingOptimizationGoal = null;
    try {
      const adSets = await new bizSdk.Campaign(campaignId).getAdSets(
        ["optimization_goal"],
        { limit: 1 },
      );
      const first = Array.isArray(adSets) ? adSets[0] : null;
      existingOptimizationGoal = first?._data?.optimization_goal || first?.optimization_goal || null;
    } catch (err) {
      logger.warn(
        `resolveCampaignForAdd: failed to read existing ad sets for ${campaignId}: ${err.message}`,
      );
    }

    const dailyBudget = Number(d.daily_budget) || 0;
    const lifetimeBudget = Number(d.lifetime_budget) || 0;
    const spendCap = Number(d.spend_cap) || 0;
    const cbo = dailyBudget > 0 || lifetimeBudget > 0;
    return res.status(200).json({
      status: true,
      campaignId: d.id,
      name: d.name || "",
      status: d.status,
      objective: d.objective,
      cbo,
      campaignBudgetType: lifetimeBudget > 0 ? "lifetime" : "daily",
      bidStrategy: d.bid_strategy || null,
      specialAdCategories: d.special_ad_categories || [],
      // Raw minor-unit values for the Edit flow (the cached list only has
      // formatted "₹100.00" strings, useless for editing).
      dailyBudget,
      lifetimeBudget,
      spendCap,
      // null when the campaign has no ad sets yet (nothing to match) or
      // the read failed — frontend treats null as "no lock needed".
      existingOptimizationGoal,
    });
  } catch (err) {
    return res.status(500).json(metaErrorResponse(err, "resolve campaign", req));
  }
}

// ─── updateCampaignV2 ─────────────────────────────────────────────────────────

/**
 * PATCH /v2/update-campaign — edit an existing campaign's editable fields
 * (name, budget amount, spend cap). Objective + special ad categories are
 * immutable (rejected by the schema). bid_strategy is not editable in v1.
 * Sends only the fields present in the body, then busts the campaigns cache.
 */
async function updateCampaignV2(req, res) {
  /* #swagger.tags = ['Meta Ads Launcher V2']
     #swagger.description = 'V2 — edit an existing campaign (name / budget / spend cap)'
  */
  const { error, value } = updateCampaignSchemaV2.validate(req.body);
  if (error) {
    return res.status(400).json({
      status: false,
      error: error.details[0].context?.message || error.details[0].message,
    });
  }
  const userId = req.user.user_id;
  try {
    await initApiForUser(userId, getFacebookIdFromRequest(req));

    const params = {};
    if (value.name !== undefined) params.name = value.name;
    if (value.dailyBudget !== undefined) params.daily_budget = value.dailyBudget;
    if (value.lifetimeBudget !== undefined) {
      params.lifetime_budget = value.lifetimeBudget;
    }
    if (value.spendCap !== undefined) params.spend_cap = value.spendCap;
    if (Object.keys(params).length === 0) {
      return res
        .status(400)
        .json({ status: false, error: "No editable fields provided" });
    }

    await new bizSdk.Campaign(value.campaignId).update([], params);
    await invalidateAfterCreate(userId, {
      adAccountId: value.adAccountId,
      campaignId: value.campaignId,
    });

    return res.status(200).json({
      status: true,
      message: "Campaign updated",
      campaign: { id: value.campaignId },
    });
  } catch (err) {
    return res.status(500).json(metaErrorResponse(err, "update campaign", req));
  }
}

// ─── Ad set edit: reverse-map helpers ─────────────────────────────────────────

// reverseGeoToLocations lives in utils/targetingGeo.js — imported above
// alongside groupLocationsByType / dropOverlappingIncludes. Kept pure so
// it stays unit-testable without pulling the controller's full require
// chain (Redis / SDK / DB connections at module load).

// Batch-fetch adgeolocationmeta for a set of locations. Returns the raw
// response object keyed by Meta bucket (`{ subcities: {'S_1': {name, country_code}}, … }`)
// or `null` on any failure. `only` restricts to specific bucket types
// (used by the launch-time countryCode backfill — we only need buckets
// missing country_code).
async function fetchAdGeoLocationMeta(api, locations, { only } = {}) {
  const byBucket = {};
  for (const l of locations) {
    const bucket = TYPE_TO_META_BUCKET[l.type];
    if (!bucket) continue;
    if (only && !only.has(l.type)) continue;
    (byBucket[bucket] = byBucket[bucket] || []).push(l.key);
  }
  if (!Object.keys(byBucket).length) return null;
  const params = { type: "adgeolocationmeta" };
  for (const [bucket, keys] of Object.entries(byBucket)) {
    params[bucket] = JSON.stringify(keys);
  }
  try {
    const raw = await api.call("GET", ["search"], params);
    return raw?.data || raw?._data?.data || raw?._data || raw || null;
  } catch {
    return null; // best-effort
  }
}

// Meta's targeting read returns geo KEYS, not names. Resolve friendly names
// (and city/region country codes + region ids) via the adgeolocationmeta
// lookup so the edit UI shows "India" not "IN", "Bengaluru" not "2295414",
// and region-overlap detection (dropOverlappingIncludes) has what it needs
// on read-back too. Best-effort: any failure leaves the key as the display
// name. Mutates `locations`.
async function resolveLocationNames(api, locations) {
  const data = await fetchAdGeoLocationMeta(api, locations);
  // `custom` pins (real hit 2026-07-06): `reverseGeoToLocations` gives every
  // pin read back from Meta a `Pin @ lat, lng` PLACEHOLDER name — Meta's
  // `custom_locations` targeting field only ever stores lat/lng/radius, no
  // name, so whatever friendly name `addPin` resolved at drop-time is gone
  // by the time the ad set is saved and re-opened for editing. This used to
  // be skipped entirely here ("already has a coordinate label") on the
  // assumption nothing could improve on it — now that `reverseGeocodeLatLng`
  // tries Meta's own `adgeolocationmeta`/`custom_locations` reverse-geocode
  // first (see its docblock in metaAdLauncher.js), the exact same lookup
  // `addPin` uses is available here too. Sequential, not parallel — pins
  // are rare and this mirrors `backfillLocationCountryCodes`'s existing
  // rate-limit caution.
  for (const l of locations) {
    if (l.type !== "custom") continue;
    if (!Number.isFinite(l.latitude) || !Number.isFinite(l.longitude)) continue;
    const hit = await reverseGeocodeLatLng(l.latitude, l.longitude, api);
    if (hit?.displayName) l.name = hit.displayName;
    if (!l.countryCode && hit?.countryCode) l.countryCode = hit.countryCode;
    if (!l.regionId && hit?.regionId) l.regionId = hit.regionId;
  }
  for (const l of locations) {
    if (l.type === "custom") continue; // handled above
    const bucketName = TYPE_TO_META_BUCKET[l.type];
    const bucket = bucketName ? data?.[bucketName] : null;
    const hit = bucket && (bucket[l.key] || bucket[String(l.key)]);
    if (hit) {
      if (hit.name) l.name = hit.name;
      if (hit.country_code && COUNTRY_CODE_CARRYING_TYPES.has(l.type)) {
        l.countryCode = hit.country_code;
      }
      if (hit.region_id != null && COUNTRY_CODE_CARRYING_TYPES.has(l.type)) {
        l.regionId = String(hit.region_id);
      }
    }
    if (!l.name) l.name = l.key; // fallback to the key
  }
}

// Launch-time countryCode + regionId backfill. Three distinct gaps this
// closes, all producing Meta subcode 1487756 ("Some locations conflict
// with each other") when they slip through:
//
//   1. Meta's `adgeolocation` typeahead sometimes omits `country_code` /
//      `region_id` on smaller sub-city / neighborhood rows.
//   2. Meta's `adgeolocation` search surfaces some well-known areas (e.g.
//      "Whitefield", "Varthur" in Bangalore) as a `place` (POI) result
//      rather than a formal subcity/neighborhood entity. The picker turns
//      `place` picks into a `custom` lat/lng radius pin (see
//      LocationTargeting.jsx `add()`) — and Meta's `custom_locations`
//      read-back on EDIT never includes a country code (or region id) at
//      all, so an edited ad set with a pre-existing pin inside an
//      included country/region has no client-side signal to fix it.
//   3. Real-world hit (2026-07-06): a user included a REGION ("Karnataka")
//      plus several granular picks inside it with NO country entry at
//      all. The country-only check has nothing to match against in that
//      shape, so region-covers-granular-pick needs the exact same
//      backfill treatment as country-covers-granular-pick.
//
// All cases: patch in place, then let the normal `dropOverlappingIncludes`
// run. Best-effort — if a lookup fails, launch proceeds with the current
// payload (may still 1487756, which is the pre-fix behavior; not worse).
//
// Former "known residual gap," CLOSED 2026-07-06: a `custom` pin missing
// regionId used to get no backfill for it — Nominatim (the reverse-geocode
// fallback) has no concept of Meta's region-id ontology. Turns out Meta's
// OWN `adgeolocationmeta` endpoint reverse-geocodes a bare lat/lng pair via
// its `custom_locations` bucket and returns `region_id` directly (captured
// live from Meta Ads Manager's network traffic) — `reverseGeocodeLatLng`
// now tries that first, Nominatim only as fallback. See its docblock in
// metaAdLauncher.js for the full mechanism.
async function backfillLocationCountryCodes(api, locations) {
  if (!Array.isArray(locations) || !locations.length) return;

  // Case 1 — sub-country geo types via batch adgeolocationmeta lookup.
  const needsMeta = locations.filter(
    (l) =>
      (l.mode || "include") === "include" &&
      COUNTRY_CODE_CARRYING_TYPES.has(l.type) &&
      (!l.countryCode || !l.regionId),
  );
  if (needsMeta.length) {
    const data = await fetchAdGeoLocationMeta(api, needsMeta, {
      only: COUNTRY_CODE_CARRYING_TYPES,
    });
    if (data) {
      for (const l of needsMeta) {
        const bucketName = TYPE_TO_META_BUCKET[l.type];
        const bucket = bucketName ? data?.[bucketName] : null;
        const hit = bucket && (bucket[l.key] || bucket[String(l.key)]);
        if (!l.countryCode && hit?.country_code) l.countryCode = hit.country_code;
        if (!l.regionId && hit?.region_id != null) l.regionId = String(hit.region_id);
      }
    }
  }

  // Case 2 — custom (lat/lng) pins via reverse-geocode. Sequential, not
  // parallel: pins are rare (most locations are geo-search picks) and the
  // Nominatim fallback's usage policy expects modest request rates. Now
  // captures regionId too (Meta's own adgeolocationmeta path — see above).
  const needsReverseGeocode = locations.filter(
    (l) =>
      (l.mode || "include") === "include" &&
      l.type === "custom" &&
      (!l.countryCode || !l.regionId) &&
      Number.isFinite(l.latitude) &&
      Number.isFinite(l.longitude),
  );
  for (const l of needsReverseGeocode) {
    const hit = await reverseGeocodeLatLng(l.latitude, l.longitude, api);
    if (!l.countryCode && hit?.countryCode) l.countryCode = hit.countryCode;
    if (!l.regionId && hit?.regionId) l.regionId = hit.regionId;
  }
}

// ─── resolveAdSetForEdit ──────────────────────────────────────────────────────

/**
 * GET /v2/resolve-adset — full editable shape for the "Edit ad set" flow.
 * Reads the ad set (+ its campaign for objective/CBO), reverse-maps Meta's
 * targeting into our `locations[]` model, and resolves geo names. The
 * cached list is useless for editing (formatted strings, no targeting).
 */
async function resolveAdSetForEdit(req, res) {
  /* #swagger.tags = ['Meta Ads Launcher V2']
     #swagger.description = 'V2 — full editable shape for the Edit ad set flow'
  */
  try {
    const adSetId = String(req.query.adSetId || "").trim();
    if (!adSetId) {
      return res.status(400).json({ status: false, error: "adSetId is required" });
    }
    const userId = req.user.user_id;
    await initApiForUser(userId, getFacebookIdFromRequest(req));
    const api = bizSdk.FacebookAdsApi.getDefaultApi();

    let adSetData;
    let campaignData;
    try {
      const adSet = await new bizSdk.AdSet(adSetId).get([
        "id",
        "name",
        "status",
        "campaign_id",
        "daily_budget",
        "lifetime_budget",
        "bid_strategy",
        "bid_amount",
        "optimization_goal",
        "billing_event",
        "start_time",
        "end_time",
        "destination_type",
        "promoted_object",
        "targeting",
        "frequency_control_specs",
      ]);
      adSetData = adSet?._data || adSet || {};
      const campaign = await new bizSdk.Campaign(adSetData.campaign_id).get([
        "id",
        "objective",
        "daily_budget",
        "lifetime_budget",
      ]);
      campaignData = campaign?._data || campaign || {};
    } catch (err) {
      return res.status(400).json(metaErrorResponse(err, "load ad set", req));
    }

    const cellInfo = inferCellForMetaCampaign(campaignData, adSetData);
    if (cellInfo.error) {
      return res.status(422).json({ status: false, error: cellInfo.error });
    }

    const tg = adSetData.targeting || {};
    const geo = tg.geo_locations || {};
    const excludedGeo = tg.excluded_geo_locations || {};
    const worldwide =
      Array.isArray(geo.country_groups) && geo.country_groups.includes("worldwide");
    const locations = worldwide
      ? []
      : [
          ...reverseGeoToLocations(geo, "include"),
          ...reverseGeoToLocations(excludedGeo, "exclude"),
        ];
    await resolveLocationNames(api, locations);

    const cbo =
      Number(campaignData.daily_budget) > 0 ||
      Number(campaignData.lifetime_budget) > 0;

    // Real trigger (2026-07-06): Edit Ad Set showed a blank, still-required
    // Facebook Page field for every "pixel"-shape cell (Leads/Sales Website,
    // Multiple cells) — promoted_object.page_id only exists for "page"-shape
    // cells. Same fallback resolveCellForAdSet already used for the Add-Ad
    // flow, extracted into resolvePageIdForAdSet so both stay in sync.
    const pageId = await resolvePageIdForAdSet(adSetId, adSetData.promoted_object);

    return res.status(200).json({
      status: true,
      adSetId: adSetData.id,
      campaignId: campaignData.id,
      objective: cellInfo.objective,
      conversionLocation: cellInfo.conversionLocation,
      cbo,
      name: adSetData.name || "",
      adSetStatus: adSetData.status,
      dailyBudget: Number(adSetData.daily_budget) || 0,
      lifetimeBudget: Number(adSetData.lifetime_budget) || 0,
      bidStrategy: adSetData.bid_strategy || null,
      bidAmount: Number(adSetData.bid_amount) || 0,
      optimizationGoal: adSetData.optimization_goal || "",
      billingEvent: adSetData.billing_event || "",
      startTime: adSetData.start_time || "",
      endTime: adSetData.end_time || "",
      pageId,
      pixelId: adSetData.promoted_object?.pixel_id || null,
      pixelEventType: adSetData.promoted_object?.custom_event_type || null,
      applicationId: adSetData.promoted_object?.application_id || null,
      objectStoreUrl: adSetData.promoted_object?.object_store_url || null,
      productSetId: adSetData.promoted_object?.product_set_id || null,
      // Awareness frequency control — Meta returns frequency_control_specs
      // as an array; the wizard exposes ONE entry, so read [0]. null when
      // the ad set has no cap configured (Meta default = no cap).
      //
      // `mode` is a UI hint Meta doesn't preserve; we default to 'cap'
      // since cap is the stricter / safer interpretation of the same
      // max_frequency value. User can flip back to 'target' on edit if
      // their original intent was Target mode.
      frequencyControl: (() => {
        const spec = adSetData.frequency_control_specs?.[0];
        if (!spec) return null;
        return {
          mode: "cap",
          capFrequency: Number(spec.max_frequency) || 0,
          capPeriodDays: Number(spec.interval_days) || 0,
        };
      })(),
      targeting: {
        worldwide,
        locations,
        ageMin: Number(tg.age_min) || 18,
        ageMax: Number(tg.age_max) || 65,
        genders: tg.genders || [],
        locales: tg.locales || [],
        advantageAudience: tg.targeting_automation?.advantage_audience === 1,
        placementMode:
          Array.isArray(tg.publisher_platforms) && tg.publisher_platforms.length
            ? "manual"
            : "advantage_plus",
        publisherPlatforms: tg.publisher_platforms || [],
        devicePlatforms: tg.device_platforms || [],
        // Detailed Targeting — reverse-map Meta's flexible_spec + exclusions
        // back into our form's { include, narrow, exclude }. Also handles
        // legacy ad sets with flat interests/behaviors arrays (folds them
        // into Include). See utils/detailedTargeting.js.
        detailedTargeting: flexibleSpecToForm(tg),
      },
    });
  } catch (err) {
    return res.status(500).json(metaErrorResponse(err, "resolve ad set", req));
  }
}

// ─── updateAdSetV2 ────────────────────────────────────────────────────────────

/**
 * PATCH /v2/update-adset — edit an ad set's name / budget / bid cap /
 * targeting / schedule. Delivery fields (optimization_goal, billing_event,
 * bid_strategy) + identity (page, app, pixel) are immutable here (rejected
 * by the schema). Reads the parent campaign to skip budget on CBO, and
 * preserves the existing ad set's app-cell user_os when rewriting targeting.
 */
async function updateAdSetV2(req, res) {
  /* #swagger.tags = ['Meta Ads Launcher V2']
     #swagger.description = 'V2 — edit an existing ad set'
  */
  const { error, value } = updateAdSetSchemaV2.validate(req.body);
  if (error) {
    return res.status(400).json({
      status: false,
      error: error.details[0].context?.message || error.details[0].message,
    });
  }
  const userId = req.user.user_id;
  try {
    await initApiForUser(userId, getFacebookIdFromRequest(req));

    // Read existing context (campaign for CBO, targeting for user_os).
    let existing = {};
    try {
      const adSet = await new bizSdk.AdSet(value.adSetId).get([
        "id",
        "campaign_id",
        "targeting",
      ]);
      existing = adSet?._data || adSet || {};
    } catch {
      /* non-fatal — proceed without context */
    }
    let campaignIsCbo = false;
    let campaignSacs = [];
    if (existing.campaign_id) {
      try {
        const c = await new bizSdk.Campaign(existing.campaign_id).get([
          "daily_budget",
          "lifetime_budget",
          // Needed by buildExplicitTargeting's SAC-detailedTargeting guard
          // on the edit-adset path (same as create-adset).
          "special_ad_categories",
        ]);
        const cd = c?._data || c || {};
        campaignIsCbo =
          Number(cd.daily_budget) > 0 || Number(cd.lifetime_budget) > 0;
        campaignSacs = Array.isArray(cd.special_ad_categories)
          ? cd.special_ad_categories
          : [];
      } catch {
        /* non-fatal */
      }
    }

    const params = {};
    if (value.name !== undefined) params.name = value.name;
    // Budget lives on the ad set only for ABO campaigns.
    if (!campaignIsCbo) {
      if (value.dailyBudget !== undefined) params.daily_budget = value.dailyBudget;
      if (value.lifetimeBudget !== undefined) {
        params.lifetime_budget = value.lifetimeBudget;
      }
    }
    if (value.bidAmount !== undefined) params.bid_amount = value.bidAmount;
    if (value.startTime !== undefined) {
      params.start_time = new Date(value.startTime).toISOString();
    }
    if (value.endTime !== undefined) {
      params.end_time = new Date(value.endTime).toISOString();
    }
    if (value.targeting) {
      // Backfill missing countryCode on sub-country picks — same rationale
      // as createAdSetV2. Meta 1487756 fires on edit-save too if a subcity
      // is added alongside a country during edit.
      if (Array.isArray(value.targeting.locations) && value.targeting.locations.length) {
        const api = bizSdk.FacebookAdsApi.getDefaultApi();
        await backfillLocationCountryCodes(api, value.targeting.locations);
      }
      const spec = buildExplicitTargeting(value.targeting, {
        specialAdCategories: campaignSacs,
      });
      // Preserve app-cell OS targeting — the form doesn't edit user_os, and
      // dropping it triggers Meta's Mobile Targeting Mismatch (subcode 1487678).
      const existingUserOs = existing.targeting?.user_os;
      if (existingUserOs) spec.user_os = existingUserOs;
      // Found in the 2026-07-07 proactive audit, SAME bug as user_os above
      // but silent: createAdSetV2 force-sets `device_platforms: ["mobile"]`
      // for every "app" promotedObjectShape cell (App Promotion, Traffic/App,
      // Leads/App, Engagement/App, Sales/App) — the Edit Ad Set form never
      // collects devicePlatforms for these cells either, so
      // buildExplicitTargeting's output OMITS device_platforms entirely
      // (see its `if (t.devicePlatforms?.length) spec.device_platforms = ...`
      // guard). Meta's `targeting` field is a full replace, not a merge —
      // confirmed by user_os needing this exact preservation pattern
      // already — so editing ANY targeting field (locations, age, gender,
      // placements) on an app-shape ad set would silently DROP the
      // mobile-only restriction and let the campaign start delivering to
      // desktop too. Unlike user_os, Meta does NOT reject this — there's no
      // subcode to catch it, which is why it went unnoticed until a
      // deliberate audit compared this block against its create-time twin.
      const existingDevicePlatforms = existing.targeting?.device_platforms;
      if (existingDevicePlatforms) spec.device_platforms = existingDevicePlatforms;
      params.targeting = spec;
    }
    // Awareness/STANDARD frequency cap. Three states:
    //   undefined → don't touch the existing cap (no-op for any cell type)
    //   null      → clear the cap (Meta accepts `[]` to remove)
    //   { ... }   → set/update
    if (value.frequencyControl !== undefined) {
      params.frequency_control_specs =
        value.frequencyControl === null
          ? []
          : [
              {
                event: "IMPRESSIONS",
                interval_days: value.frequencyControl.capPeriodDays,
                max_frequency: value.frequencyControl.capFrequency,
              },
            ];
    }
    if (Object.keys(params).length === 0) {
      return res
        .status(400)
        .json({ status: false, error: "No editable fields provided" });
    }

    await new bizSdk.AdSet(value.adSetId).update([], params);
    await invalidateAfterCreate(userId, {
      adAccountId: value.adAccountId,
      campaignId: existing.campaign_id,
      adSetId: value.adSetId,
    });

    return res.status(200).json({
      status: true,
      message: "Ad set updated",
      adSet: { id: value.adSetId },
    });
  } catch (err) {
    return res.status(500).json(metaErrorResponse(err, "update ad set", req));
  }
}

// ─── resolveAdForEdit ─────────────────────────────────────────────────────────

/**
 * GET /v2/resolve-ad — editable shape for the "Edit ad" flow. Reads the ad's
 * creative (object_story_spec) + its ad set/campaign (for cell + page), and
 * returns the copy/CTA/link fields plus the existing media tokens. The media
 * is reused as-is on save (v1 doesn't re-upload); only copy/CTA/link change.
 */
async function resolveAdForEdit(req, res) {
  /* #swagger.tags = ['Meta Ads Launcher V2']
     #swagger.description = 'V2 — editable shape for the Edit ad flow'
  */
  try {
    const adId = String(req.query.adId || "").trim();
    if (!adId) {
      return res.status(400).json({ status: false, error: "adId is required" });
    }
    const userId = req.user.user_id;
    await initApiForUser(userId, getFacebookIdFromRequest(req));

    let adData;
    let adSetData;
    let campaignData;
    try {
      const ad = await new bizSdk.Ad(adId).get([
        "id",
        "name",
        "status",
        "adset_id",
        "creative{object_story_spec,url_tags}",
      ]);
      adData = ad?._data || ad || {};
      const adSet = await new bizSdk.AdSet(adData.adset_id).get([
        "id",
        "campaign_id",
        "destination_type",
        "promoted_object",
        "targeting",
      ]);
      adSetData = adSet?._data || adSet || {};
      const campaign = await new bizSdk.Campaign(adSetData.campaign_id).get([
        "id",
        "objective",
      ]);
      campaignData = campaign?._data || campaign || {};
    } catch (err) {
      return res.status(400).json(metaErrorResponse(err, "load ad", req));
    }

    const cellInfo = inferCellForMetaCampaign(campaignData, adSetData);
    if (cellInfo.error) {
      return res.status(422).json({ status: false, error: cellInfo.error });
    }

    const creative = adData.creative?._data || adData.creative || {};
    const oss = creative.object_story_spec || {};
    const link = oss.link_data || {};
    const video = oss.video_data || {};
    const cta = link.call_to_action || video.call_to_action || {};
    const isVideo = !!video.video_id;

    // Subcode 1885270 fix ("app ID and link should resolve to the same
    // digital store object") — same class of bug as resolveCellForAdSet's,
    // but this endpoint had an EXTRA way to get it wrong: it mixed
    // applicationId from the ad SET's promoted_object with objectStoreUrl
    // from the AD's OWN creative link — two genuinely different Meta
    // objects, not guaranteed consistent with each other. Prefer the ad's
    // OWN CTA `value.application` first — it was set atomically with
    // `link.link` by `buildAppLinkData` when THIS ad was created (same
    // atomicity guarantee as AppLinkagePicker), so the two are guaranteed
    // to match each other regardless of what the ad set's promoted_object
    // says. Only fall back to the ad-set level value for older ads / CTA
    // types that don't carry `value.application`. Then still re-derive
    // live as a backstop (resolveObjectStoreUrlForApp) in case even the
    // ad's own historical pairing has since gone stale.
    const editApplicationId = cta?.value?.application || adSetData.promoted_object?.application_id || null;
    const editObjectStoreUrl = await resolveObjectStoreUrlForApp(
      editApplicationId,
      link.link || null,
      adSetData.targeting?.user_os,
      "resolveAdForEdit",
    );

    return res.status(200).json({
      status: true,
      adId: adData.id,
      adSetId: adData.adset_id,
      campaignId: campaignData.id,
      objective: cellInfo.objective,
      conversionLocation: cellInfo.conversionLocation,
      pageId: oss.page_id || adSetData.promoted_object?.page_id || null,
      // Real gap (2026-07-07, found in the same proactive audit as
      // resolveIdentityForAddAd): instagramUserId was never returned here
      // at all, even though it's already sitting on `oss` from the SAME
      // fetch — every Edit Ad save would silently DROP an ad's existing
      // Instagram identity (buildObjectStorySpec only sets
      // instagram_user_id when the form explicitly carries one; an empty
      // form.instagramUserId means the rebuilt creative omits it). No
      // extra API call needed; the data was already in hand.
      instagramUserId: oss.instagram_user_id || null,
      name: adData.name || "",
      headline: link.name || video.title || "",
      primaryText: link.message || video.message || "",
      description: link.description || video.link_description || "",
      linkUrl: link.link || cta?.value?.link || "",
      callToAction: cta?.type || "",
      urlTags: creative.url_tags || "",
      leadFormId: cta?.value?.lead_gen_form_id || "",
      // App-cell creative inputs (App Promotion ads) — needed to rebuild the
      // app_link creative on save. Harmless for non-app cells.
      objectStoreUrl: editObjectStoreUrl || "",
      applicationId: editApplicationId || "",
      // Existing media — reused on save (v1 doesn't swap media).
      mediaType: isVideo ? "video" : "image",
      imageHash: link.image_hash || null,
      videoId: video.video_id || null,
      videoThumbnailUrl: video.image_url || null,
      // Display-only preview of the current media.
      previewUrl: isVideo ? video.image_url || null : link.picture || null,
    });
  } catch (err) {
    return res.status(500).json(metaErrorResponse(err, "resolve ad", req));
  }
}

// ─── updateAdV2 ───────────────────────────────────────────────────────────────

/**
 * PATCH /v2/update-ad — edit an ad's name + creative copy/CTA/link. Meta
 * won't edit a creative in place, so we rebuild it (reusing the existing
 * media token) and re-point the ad at the new creative_id. Validated with
 * the same cell ad factory as create (adId stripped first).
 */
async function updateAdV2(req, res) {
  /* #swagger.tags = ['Meta Ads Launcher V2']
     #swagger.description = 'V2 — edit an ad (name + creative copy/CTA/link)'
  */
  const adId = String(req.body?.adId || "").trim();
  if (!adId) {
    return res.status(400).json({ status: false, error: "adId is required" });
  }
  const resolved = resolveCellOr400(req);
  if (!resolved.ok) return res.status(resolved.status).json(resolved.body);
  const { objective, conversionLocation } = req.body;
  const cell = resolved.cell;

  // Reuse the create ad factory for validation — strip adId (edit-only) so
  // the schema (which forbids unknown keys) accepts the body.
  const createBody = { ...req.body };
  delete createBody.adId;
  const schema = buildAdSchemaV2(objective, conversionLocation);
  const { error, value } = schema.validate(createBody);
  if (error) {
    return res.status(400).json({
      status: false,
      error: error.details[0].context?.message || error.details[0].message,
    });
  }

  const userId = req.user.user_id;
  try {
    await initApiForUser(userId, getFacebookIdFromRequest(req));
    const account = new AdAccount(`act_${value.adAccountId}`);

    const built = await buildAdCreativeOr400(account, cell, value);
    if (!built.ok) return res.status(built.status).json(built.body);

    await new bizSdk.Ad(adId).update([], {
      name: value.name,
      creative: { creative_id: built.creative.id },
    });

    await invalidateAfterCreate(userId, {
      adAccountId: value.adAccountId,
      adSetId: value.adSetId,
    });

    return res.status(200).json({
      status: true,
      message: "Ad updated",
      ad: { id: adId, name: value.name },
      creative: { id: built.creative.id },
    });
  } catch (err) {
    return res.status(500).json(metaErrorResponse(err, "update ad", req));
  }
}

module.exports = {
  createCampaignV2,
  updateCampaignV2,
  createAdSetV2,
  updateAdSetV2,
  createAdV2,
  updateAdV2,
  resolveCellForAdSet,
  resolveCampaignForAdd,
  resolveAdSetForEdit,
  resolveAdForEdit,
  buildAdCreativeOr400,
  // Exposed so `metaAdLauncher.reachEstimateForTargeting` can transform
  // the wizard's form-shaped targeting into Meta's API shape before
  // calling /act_X/reachestimate. Lazy-required inside that method to
  // avoid circular import (metaAdLauncherV2 itself requires this file
  // for initApiForUser etc.).
  buildExplicitTargeting,
};
