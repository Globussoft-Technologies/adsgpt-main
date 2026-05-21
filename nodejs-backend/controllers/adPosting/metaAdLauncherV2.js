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
  buildAdSetSchemaV2,
  buildAdSchemaV2,
} = require("../../Validations/meta.v2.validator");
const {
  getCell,
  isCellImplemented,
  getMetaDestinationType,
} = require("../../config/wizardSchema");
const { buildPromotedObject } = require("../../utils/promotedObject");
const { buildObjectStorySpec } = require("../../utils/objectStorySpec");

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

  // Capped bid strategies require a bid_amount. Catching here surfaces a
  // clean 400 instead of Meta's generic "Invalid parameter".
  if (CAPPED_BID_STRATEGIES.has(value.bidStrategy) && !value.bidAmount) {
    return res.status(400).json({
      status: false,
      error: `bidAmount is required when bidStrategy is ${value.bidStrategy}`,
    });
  }
  if (value.targeting.ageMin > value.targeting.ageMax) {
    return res.status(400).json({
      status: false,
      error: "targeting.ageMin must be less than or equal to targeting.ageMax",
    });
  }

  try {
    await initApiForUser(userId);
    const account = new AdAccount(`act_${value.adAccountId}`);

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
      const t = value.targeting;
      // Group a list of normalised location entries (`{ type, key, mode,
      // radius?, distanceUnit? }`) into the per-type sub-objects Meta
      // expects under `geo_locations` / `excluded_geo_locations`.
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
          }
        }
        return out;
      };

      let geoLocations;
      let excludedGeo;
      if (t.worldwide) {
        geoLocations = { country_groups: ["worldwide"] };
        // Exclude the per-country-regulated markets from worldwide reach
        // (see WORLDWIDE_EXCLUDED_COUNTRIES above). With these countries
        // excluded, the ad set can't deliver there, so their universal-
        // ads declarations aren't required; worldwide still reaches
        // every other country.
        excludedGeo = { countries: WORLDWIDE_EXCLUDED_COUNTRIES };
      } else {
        const locations = t.locations || [];
        geoLocations = groupLocationsByType(
          locations.filter((l) => l.mode === "include"),
        );
        const excluded = groupLocationsByType(
          locations.filter((l) => l.mode === "exclude"),
        );
        if (Object.keys(excluded).length) excludedGeo = excluded;
      }

      targetingSpec = {
        geo_locations: geoLocations,
        age_min: t.ageMin,
        age_max: t.ageMax,
        ...(t.genders.length ? { genders: t.genders } : {}),
        ...(t.locales.length ? { locales: t.locales } : {}),
        targeting_automation: {
          advantage_audience: t.advantageAudience ? 1 : 0,
        },
      };
      if (excludedGeo) targetingSpec.excluded_geo_locations = excludedGeo;
      // Manual placements: include `publisher_platforms` only when set.
      // When omitted, Meta uses Advantage+ Placements (all surfaces).
      // We don't set per-position fields (facebook_positions, etc.) —
      // Meta defaults to all positions on each enabled platform, which
      // matches our "manual = pick platforms, not positions" UX.
      if (t.placementMode === "manual" && t.publisherPlatforms?.length) {
        targetingSpec.publisher_platforms = t.publisherPlatforms;
      }
      if (t.devicePlatforms?.length) {
        targetingSpec.device_platforms = t.devicePlatforms;
      }
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
      bid_strategy: value.bidStrategy,
      status: value.status,
      targeting: targetingSpec,
    };

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

    // phoneNumber for Click-to-Call ads — resolved from the Page (not a
    // wizard form field). If the page has no phone configured, surface
    // a clean 400 with what the user needs to do.
    let phoneNumber;
    if (cell.ad.objectStorySpecShape === "click_to_call") {
      phoneNumber = await getPagePhone(value.pageId);
      if (!phoneNumber) {
        return res.status(400).json({
          status: false,
          error: "Page has no phone number configured",
          details:
            "Click-to-Call ads use the phone number on the Facebook Page's About → Contact info. Add a number on the Page and retry.",
        });
      }
    }

    // Video thumbnail — last-chance auto-fetch. uploadAdVideo tries to
    // pull this immediately after upload, but for longer clips Meta's
    // encoder may not have a thumbnail ready yet by the time we respond.
    // Try one more time here when the user clicks Launch (by which point
    // the video has typically had 30+ s to encode while the user filled
    // the rest of the form). Returns a clear actionable error if still
    // nothing — the user retries in ~30 s and it'll succeed.
    if (value.videoId && !value.videoThumbnailUrl) {
      try {
        const api = bizSdk.FacebookAdsApi.getDefaultApi();
        const r = await api.call("GET", [value.videoId, "thumbnails"], {
          fields: "uri,is_preferred",
        });
        const thumbs = r?.data || r?._data?.data || [];
        const preferred = thumbs.find((t) => t.is_preferred) || thumbs[0];
        if (preferred?.uri) value.videoThumbnailUrl = preferred.uri;
      } catch (_) { /* swallow — surface clean 400 below */ }

      if (!value.videoThumbnailUrl) {
        return res.status(400).json({
          status: false,
          error: "Video is still encoding",
          details:
            "Meta hasn't generated a thumbnail for this video yet. Wait ~30 seconds and click Launch again, or paste a custom Thumbnail URL on the Ad step.",
        });
      }
    }

    // object_story_spec — driven by the cell's shape key. The builder
    // owns the per-shape Meta API payload construction; the controller
    // only forwards the form values it has.
    const objectStorySpec = buildObjectStorySpec(cell.ad.objectStorySpecShape, {
      pageId: value.pageId,
      instagramUserId: value.instagramUserId,
      // Media — pass through whichever was provided. The Ad validator
      // already enforced xor (image-or-video) and required thumbnail
      // alongside video, so the builder gets a well-formed pair.
      imageHash: value.imageHash || undefined,
      videoId: value.videoId || undefined,
      videoThumbnailUrl: value.videoThumbnailUrl || undefined,
      headline: value.headline,
      primaryText: value.primaryText,
      description: value.description,
      callToAction: value.callToAction,
      // Shape-specific fields — each shape uses only the ones it needs.
      linkUrl: value.linkUrl,
      leadFormId: value.leadFormId,
      objectStoreUrl: value.objectStoreUrl,
      applicationId: value.applicationId,
      deepLink: value.deferredDeepLink || undefined,
      customProductPage: value.customProductPage || undefined,
      autoTranslate: value.autoTranslate || false,
      phoneNumber, // populated above for click_to_call shape
    });

    const creativeParams = {
      name: `${value.name} — creative`,
      object_story_spec: objectStorySpec,
    };
    if (value.urlTags) creativeParams.url_tags = value.urlTags.replace(/^\?/, "");

    // Verbose debug for click-to-call — Meta's "Invalid phone number"
    // (subcode 2061044) blames call_to_action[value][link]. Log the
    // exact CTA value the builder produced so we can see the tel: URL
    // that Meta is rejecting.
    if (cell.ad.objectStorySpecShape === "click_to_call") {
      const ctaValue =
        objectStorySpec?.link_data?.call_to_action?.value ||
        objectStorySpec?.video_data?.call_to_action?.value;
      logger.info(
        `createAdV2 click_to_call: resolved phoneNumber=${JSON.stringify(phoneNumber)} ` +
          `→ CTA value=${JSON.stringify(ctaValue)}`,
      );
    }

    const creative = await account.createAdCreative([], creativeParams);

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

module.exports = {
  createCampaignV2,
  createAdSetV2,
  createAdV2,
};
