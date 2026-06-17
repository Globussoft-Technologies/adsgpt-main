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
const { waitForVideoThumbnail } = require("../../utils/videoThumbnail");
const { inferCellForMetaCampaign } = require("./cellInference");

// V1 controller exposes initApiForUser + invalidateAfterCreate +
// formatMetaError + logMetaError as named exports on its module object.
// Importing here keeps the SDK / Redis / logging plumbing single-sourced.
const v1Controller = require("./metaAdLauncher");
const { initApiForUser, invalidateAfterCreate, logMetaError, getPagePhone } = v1Controller;
const logger = require("../../utils/logger");

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

// Format a Meta SDK error into the project's standard error envelope.
// Identical shape to V1 so the frontend handler works for both.
function metaErrorResponse(err, action) {
  const m = logMetaError(`${action} error`, err);
  return {
    status: false,
    error: m.title || `Failed to ${action}`,
    details: m.message,
    meta: {
      code: m.code,
      subcode: m.subcode,
      fbtraceId: m.fbtraceId,
      data: m.data,
    },
  };
}

// Build Meta's targeting spec from our normalised targeting model. Shared
// by create-adset + edit-adset so the geo grouping / overlap handling never
// drifts. Does NOT apply app-cell `user_os` — the caller adds that from the
// app store (create) or preserves the existing value (edit).
function buildExplicitTargeting(t) {
  // Group normalised location entries into Meta's per-type sub-objects.
  const groupLocationsByType = (items) => {
    const out = {};
    for (const l of items) {
      if (l.type === "country") {
        out.countries = out.countries || [];
        out.countries.push(l.key);
      } else if (l.type === "city") {
        out.cities = out.cities || [];
        const city = { key: l.key };
        if (l.radius != null) {
          city.radius = l.radius;
          city.distance_unit = l.distanceUnit || "kilometer";
        }
        out.cities.push(city);
      } else if (l.type === "region") {
        out.regions = out.regions || [];
        out.regions.push({ key: l.key });
      } else if (l.type === "country_group") {
        out.country_groups = out.country_groups || [];
        out.country_groups.push(l.key);
      } else if (l.type === "custom") {
        out.custom_locations = out.custom_locations || [];
        out.custom_locations.push({
          latitude: l.latitude,
          longitude: l.longitude,
          radius: l.radius,
          distance_unit: l.distanceUnit || "kilometer",
        });
      }
    }
    return out;
  };

  // Meta rejects overlapping *included* locations (subcode 1487756). A
  // city/region inside an included country is redundant — drop it (the
  // country already covers it). Only applies to includes.
  const dropOverlappingIncludes = (items) => {
    const includedCountryCodes = new Set(
      items
        .filter((l) => l.type === "country")
        .map((l) => String(l.key).toUpperCase()),
    );
    if (!includedCountryCodes.size) return items;
    return items.filter((l) => {
      if (l.type === "city" || l.type === "region") {
        const cc = String(l.countryCode || "").toUpperCase();
        if (cc && includedCountryCodes.has(cc)) return false;
      }
      return true;
    });
  };

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
    await initApiForUser(userId);
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
    return res.status(500).json(metaErrorResponse(err, "create campaign"));
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
    await initApiForUser(userId);
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
      targetingSpec = buildExplicitTargeting(value.targeting);
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
    // pixelId + pixelEventType for the `pixel` shape.
    const promotedObject = buildPromotedObject(cell.adSet.promotedObjectShape, {
      pageId: value.pageId,
      applicationId: value.applicationId,
      objectStoreUrl: value.objectStoreUrl,
      pixelId: value.pixelId,
      pixelEventType: value.pixelEventType,
    });
    if (promotedObject) adSetParams.promoted_object = promotedObject;

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
    return res.status(500).json(metaErrorResponse(err, "create ad set"));
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
  if (value.urlTags) creativeParams.url_tags = value.urlTags.replace(/^\?/, "");

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
    await initApiForUser(userId);
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
    return res.status(500).json(metaErrorResponse(err, "create ad"));
  }
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
    await initApiForUser(userId);

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
      return res.status(400).json(metaErrorResponse(err, "load ad set"));
    }

    const cellInfo = inferCellForMetaCampaign(campaignData, adSetData);
    if (cellInfo.error) {
      return res.status(422).json({ status: false, error: cellInfo.error });
    }

    // Resolve the ad set's Facebook Page so the Add-Ad flow inherits it
    // (the Lead Form step needs it, and the ad creative is page-scoped).
    // 1) promoted_object.page_id — Leads / Messenger / WhatsApp / Calls.
    // 2) fall back to an existing ad's creative page (covers cells whose
    //    promoted_object has no page_id, e.g. the "Multiple" Leads cells).
    let pageId = adSetData.promoted_object?.page_id || null;
    if (!pageId) {
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
          pageId =
            String(adData.creative.effective_object_story_id).split("_")[0] ||
            null;
        }
      } catch {
        /* no readable ad — leave null; the Add-Ad step shows a page picker */
      }
    }

    return res.status(200).json({
      status: true,
      objective: cellInfo.objective,
      conversionLocation: cellInfo.conversionLocation,
      campaignId: campaignData.id,
      adSetId: adSetData.id,
      pageId,
    });
  } catch (err) {
    return res.status(500).json(metaErrorResponse(err, "resolve cell"));
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
    await initApiForUser(userId);

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
      return res.status(400).json(metaErrorResponse(err, "load campaign"));
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
    });
  } catch (err) {
    return res.status(500).json(metaErrorResponse(err, "resolve campaign"));
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
    await initApiForUser(userId);

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
    return res.status(500).json(metaErrorResponse(err, "update campaign"));
  }
}

// ─── Ad set edit: reverse-map helpers ─────────────────────────────────────────

// Inverse of buildExplicitTargeting's grouping: turn Meta's
// geo_locations / excluded_geo_locations sub-objects back into our flat
// `locations[]` model (names filled in later via resolveLocationNames).
function reverseGeoToLocations(geo, mode) {
  const out = [];
  if (!geo) return out;
  for (const c of geo.countries || []) {
    out.push({ type: "country", key: String(c), countryCode: String(c).toUpperCase(), mode });
  }
  for (const c of geo.cities || []) {
    out.push({
      type: "city",
      key: String(c.key),
      radius: c.radius,
      distanceUnit: c.distance_unit || "kilometer",
      mode,
    });
  }
  for (const r of geo.regions || []) {
    out.push({ type: "region", key: String(r.key), mode });
  }
  for (const g of geo.country_groups || []) {
    if (g !== "worldwide") out.push({ type: "country_group", key: String(g), mode });
  }
  for (const cl of geo.custom_locations || []) {
    const lat = Number(cl.latitude);
    const lng = Number(cl.longitude);
    out.push({
      type: "custom",
      key: `custom:${lat},${lng}`,
      latitude: lat,
      longitude: lng,
      radius: cl.radius,
      distanceUnit: cl.distance_unit || "kilometer",
      name: `Pin @ ${lat.toFixed(3)}, ${lng.toFixed(3)}`,
      mode,
    });
  }
  return out;
}

// Meta's targeting read returns geo KEYS, not names. Resolve friendly names
// (and city/region country codes) via the adgeolocationmeta lookup so the
// edit UI shows "India" not "IN", "Bengaluru" not "2295414". Best-effort:
// any failure leaves the key as the display name. Mutates `locations`.
async function resolveLocationNames(api, locations) {
  const byType = { countries: [], cities: [], regions: [], country_groups: [] };
  for (const l of locations) {
    if (l.type === "country") byType.countries.push(l.key);
    else if (l.type === "city") byType.cities.push(l.key);
    else if (l.type === "region") byType.regions.push(l.key);
    else if (l.type === "country_group") byType.country_groups.push(l.key);
  }
  const params = { type: "adgeolocationmeta" };
  if (byType.countries.length) params.countries = JSON.stringify(byType.countries);
  if (byType.cities.length) params.cities = JSON.stringify(byType.cities);
  if (byType.regions.length) params.regions = JSON.stringify(byType.regions);
  if (byType.country_groups.length) {
    params.country_groups = JSON.stringify(byType.country_groups);
  }
  let data = null;
  if (params.countries || params.cities || params.regions || params.country_groups) {
    try {
      const raw = await api.call("GET", ["search"], params);
      data = raw?.data || raw?._data?.data || raw?._data || raw || null;
    } catch {
      data = null; // best-effort
    }
  }
  for (const l of locations) {
    if (l.type === "custom") continue; // already has a coordinate label
    const bucket =
      l.type === "country"
        ? data?.countries
        : l.type === "city"
        ? data?.cities
        : l.type === "region"
        ? data?.regions
        : l.type === "country_group"
        ? data?.country_groups
        : null;
    const hit = bucket && (bucket[l.key] || bucket[String(l.key)]);
    if (hit) {
      if (hit.name) l.name = hit.name;
      if (hit.country_code && (l.type === "city" || l.type === "region")) {
        l.countryCode = hit.country_code;
      }
    }
    if (!l.name) l.name = l.key; // fallback to the key
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
    await initApiForUser(userId);
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
      return res.status(400).json(metaErrorResponse(err, "load ad set"));
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
      pageId: adSetData.promoted_object?.page_id || null,
      pixelId: adSetData.promoted_object?.pixel_id || null,
      pixelEventType: adSetData.promoted_object?.custom_event_type || null,
      applicationId: adSetData.promoted_object?.application_id || null,
      objectStoreUrl: adSetData.promoted_object?.object_store_url || null,
      productSetId: adSetData.promoted_object?.product_set_id || null,
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
      },
    });
  } catch (err) {
    return res.status(500).json(metaErrorResponse(err, "resolve ad set"));
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
    await initApiForUser(userId);

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
    if (existing.campaign_id) {
      try {
        const c = await new bizSdk.Campaign(existing.campaign_id).get([
          "daily_budget",
          "lifetime_budget",
        ]);
        const cd = c?._data || c || {};
        campaignIsCbo =
          Number(cd.daily_budget) > 0 || Number(cd.lifetime_budget) > 0;
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
      const spec = buildExplicitTargeting(value.targeting);
      // Preserve app-cell OS targeting — the form doesn't edit user_os, and
      // dropping it triggers Meta's Mobile Targeting Mismatch (subcode 1487678).
      const existingUserOs = existing.targeting?.user_os;
      if (existingUserOs) spec.user_os = existingUserOs;
      params.targeting = spec;
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
    return res.status(500).json(metaErrorResponse(err, "update ad set"));
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
    await initApiForUser(userId);

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
      ]);
      adSetData = adSet?._data || adSet || {};
      const campaign = await new bizSdk.Campaign(adSetData.campaign_id).get([
        "id",
        "objective",
      ]);
      campaignData = campaign?._data || campaign || {};
    } catch (err) {
      return res.status(400).json(metaErrorResponse(err, "load ad"));
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

    return res.status(200).json({
      status: true,
      adId: adData.id,
      adSetId: adData.adset_id,
      campaignId: campaignData.id,
      objective: cellInfo.objective,
      conversionLocation: cellInfo.conversionLocation,
      pageId: oss.page_id || adSetData.promoted_object?.page_id || null,
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
      objectStoreUrl: link.link || "",
      applicationId: adSetData.promoted_object?.application_id || "",
      // Existing media — reused on save (v1 doesn't swap media).
      mediaType: isVideo ? "video" : "image",
      imageHash: link.image_hash || null,
      videoId: video.video_id || null,
      videoThumbnailUrl: video.image_url || null,
      // Display-only preview of the current media.
      previewUrl: isVideo ? video.image_url || null : link.picture || null,
    });
  } catch (err) {
    return res.status(500).json(metaErrorResponse(err, "resolve ad"));
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
    await initApiForUser(userId);
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
    return res.status(500).json(metaErrorResponse(err, "update ad"));
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
};
