/**
 * V2 Joi validator factories — one per wizard step that branches on the
 * (objective × conversionLocation) cell. The flat schemas in the sibling
 * `meta.validator.js` stay untouched for V1 endpoints; V2 endpoints
 * import from here.
 *
 * The factory consumes `config/wizardSchema.js` so adding a new cell or
 * field requires touching only the schema, not these factories.
 *
 * Naming: V2 endpoint payloads use camelCase (matching V1 + the rest of
 * the AdsGPT API). The factory translates to Meta API snake_case at the
 * SDK boundary inside the controllers.
 */

const Joi = require("joi");
const {
  getCell,
  isCellImplemented,
  listObjectives,
  getAllowedBillingEvents,
  getAllowedBidStrategies,
} = require("../config/wizardSchema");

// Bid strategies are objective-agnostic in MVP — V2 inherits the V1 list.
// Future phases (Sales/Catalogue) will introduce ROAS-floor strategies
// that need cell-aware validation.
const V2_BID_STRATEGIES = [
  "LOWEST_COST_WITHOUT_CAP",
  "LOWEST_COST_WITH_BID_CAP",
  "COST_CAP",
];

// Strategies that REQUIRE a bid amount cap. Their complement (automatic
// bidding) must NOT carry one — the ad-set custom validator enforces both
// directions. Mirrors CAPPED_BID_STRATEGIES in the frontend
// wizardValidation.js — keep the two lists in sync.
const CAPPED_BID_STRATEGIES = new Set([
  "LOWEST_COST_WITH_BID_CAP",
  "COST_CAP",
]);

// Meta's current Special Ad Categories — the 4 Meta now offers. "CREDIT"
// is folded into FINANCIAL_PRODUCTS_SERVICES; ONLINE_GAMBLING_AND_GAMING
// is no longer a special ad category. Keep in sync with the frontend
// SPECIAL_AD_CATEGORIES in CreateCampaignWizardV2.jsx.
const SPECIAL_AD_CATEGORIES = [
  "FINANCIAL_PRODUCTS_SERVICES",
  "EMPLOYMENT",
  "HOUSING",
  "ISSUES_ELECTIONS_POLITICS",
];

const MOBILE_APP_STORES = ["APPLE_APP_STORE", "GOOGLE_PLAY"];

// Sanity ceilings for money fields, in minor currency units. These are NOT
// Meta's hard limits (Meta varies by account / currency / cell and doesn't
// publish them cleanly) — they're typo-guards. A user fat-fingering
// 999,999,999,999 in the spend-cap box should fail at our layer with a
// clear message, not get a vague Meta rejection at launch.
//
// Values picked vs. INR (the dominant currency on this platform), but they
// work as a universal typo-floor in other currencies too — USD 10M daily
// or EUR 10M daily is also clearly a typo.
//
//   DAILY  = ₹1 crore   (1e9 paise)  — daily / per-bid ceiling
//   TOTAL  = ₹10 crore  (1e10 paise) — lifetime / spend-cap ceiling
const BUDGET_DAILY_MAX_MINOR = 1_000_000_000;
const BUDGET_TOTAL_MAX_MINOR = 10_000_000_000;

// ─── Campaign schema ─────────────────────────────────────────────────────────
// V2 campaigns accept only the 3 objectives currently implemented in
// the schema. Other objectives flow through V1.

const createCampaignSchemaV2 = Joi.object({
  adAccountId: Joi.string().required(),
  name: Joi.string().min(2).max(120).required(),
  objective: Joi.string()
    .valid(...listObjectives())
    .required()
    .messages({
      "any.only":
        "V2 only supports the migrated objectives. Use V1 for other objectives until they migrate.",
    }),
  specialAdCategories: Joi.array()
    .items(Joi.string().valid(...SPECIAL_AD_CATEGORIES))
    .default([]),
  // The countries this Special-Ad-Category campaign will run in. Meta
  // requires `special_ad_category_country` whenever `special_ad_categories`
  // is non-empty; otherwise it derives a default (often the account
  // region) and rejects ad sets whose locations fall outside it with
  // subcode 2909034 "Special Ad Category errors". The wizard derives
  // this list from the user's location picks at launch time.
  specialAdCategoryCountries: Joi.array()
    .items(Joi.string().length(2).uppercase())
    .default([]),
  // CBO (Campaign Budget Optimisation) — when set, AdSets cannot define
  // their own budget. Both values are in the account's minor currency
  // unit. Mutually exclusive (enforced below). Upper bound is a typo-
  // guard, not Meta's hard limit — see BUDGET_*_MAX_MINOR above.
  dailyBudget: Joi.number().integer().min(100).max(BUDGET_DAILY_MAX_MINOR).optional(),
  lifetimeBudget: Joi.number().integer().min(100).max(BUDGET_TOTAL_MAX_MINOR).optional(),
  bidStrategy: Joi.string()
    .valid(...V2_BID_STRATEGIES)
    .optional(),
  // Optional cap on TOTAL campaign spend in minor currency units. Maps
  // to Meta's `spend_cap` field. Once reached, campaign auto-pauses.
  spendCap: Joi.number().integer().min(100).max(BUDGET_TOTAL_MAX_MINOR).optional(),
  // iOS 14.5+ delivery flag — App Promotion only. Without this, Apple's
  // ATT framework blocks Meta from delivering to iOS 14.5+ users. When
  // true, the campaign uses SKAdNetwork-aware attribution and Meta's
  // backend maps it to `is_skadnetwork_attribution: true`.
  iosOptimised: Joi.boolean().default(false),
  // iOS 14+ campaigns bind the app at the CAMPAIGN level via
  // promoted_object, not on the ad set. These three fields are required
  // (and validated below) only when iosOptimised is true. The Ad Set
  // step still echoes them through to its own validator for the
  // ad-set-side targeting (user_os: iOS) — duplication is intentional.
  applicationId: Joi.string().optional().allow(""),
  objectStoreUrl: Joi.string().trim().uri().optional().allow(""),
  mobileAppStore: Joi.string()
    .valid("APPLE_APP_STORE", "GOOGLE_PLAY")
    .optional()
    .allow(""),
  status: Joi.string().valid("ACTIVE", "PAUSED").default("PAUSED"),
}).custom((value, helpers) => {
  if (value.dailyBudget && value.lifetimeBudget) {
    return helpers.error("any.invalid", {
      message: "Provide dailyBudget OR lifetimeBudget, not both",
    });
  }
  // Campaign spending limit must sit above the budget it caps. A spend
  // cap at or below the daily budget exhausts the campaign before a full
  // day of delivery — Meta rejects it.
  if (value.spendCap) {
    if (value.dailyBudget && value.spendCap <= value.dailyBudget) {
      return helpers.error("any.invalid", {
        message:
          "spendCap (campaign spending limit) must be greater than the daily budget",
      });
    }
    if (value.lifetimeBudget && value.spendCap < value.lifetimeBudget) {
      return helpers.error("any.invalid", {
        message:
          "spendCap (campaign spending limit) must be at least the lifetime budget",
      });
    }
  }
  // iOS 14+ only makes sense for App Promotion (the SKAdNetwork
  // framework is mobile-app-attribution-specific).
  if (value.iosOptimised && value.objective !== "OUTCOME_APP_PROMOTION") {
    return helpers.error("any.invalid", {
      message: "iosOptimised is only valid for App Promotion campaigns",
    });
  }
  // iOS 14+ campaigns require the app to be bound at the campaign
  // level. Without applicationId + objectStoreUrl, Meta has no
  // promoted_object to attach the SKAdNetwork attribution to, and the
  // ad set creation fails with a generic "Invalid parameter".
  if (value.iosOptimised) {
    if (!value.applicationId || !value.objectStoreUrl) {
      return helpers.error("any.invalid", {
        message:
          "applicationId and objectStoreUrl are required when iosOptimised is true (iOS 14+ campaigns bind the app at the campaign level)",
      });
    }
    // SKAdNetwork is Apple-only — block Google Play apps from being
    // paired with iOS 14+ at the API boundary. The frontend force-
    // resets mobileAppStore to APPLE_APP_STORE when the toggle flips,
    // but defence-in-depth catches direct API calls.
    if (value.mobileAppStore && value.mobileAppStore !== "APPLE_APP_STORE") {
      return helpers.error("any.invalid", {
        message:
          "iOS 14+ campaigns must use APPLE_APP_STORE — SKAdNetwork is Apple-only",
      });
    }
  }
  return value;
});

// ─── Campaign EDIT schema ─────────────────────────────────────────────────────
//
// Partial update for the management "Edit campaign" flow. All editable fields
// are optional-when-present; immutable fields (objective, special ad
// categories) are rejected outright. Budget values are in minor currency
// units, same as create. bid_strategy is intentionally NOT editable in v1 —
// changing it on a CBO campaign cascades to ad-set bid caps (deferred).
const updateCampaignSchemaV2 = Joi.object({
  adAccountId: Joi.string().required(),
  campaignId: Joi.string().required(),
  name: Joi.string().min(2).max(120).optional(),
  dailyBudget: Joi.number().integer().min(100).max(BUDGET_DAILY_MAX_MINOR).optional(),
  lifetimeBudget: Joi.number().integer().min(100).max(BUDGET_TOTAL_MAX_MINOR).optional(),
  spendCap: Joi.number().integer().min(100).max(BUDGET_TOTAL_MAX_MINOR).optional(),
  // Immutable post-creation — reject so a stale/edited client can't try.
  objective: Joi.any().forbidden().messages({
    "any.unknown": "A campaign's objective can't be changed after creation.",
  }),
  specialAdCategories: Joi.any().forbidden().messages({
    "any.unknown": "Special ad categories can't be changed after creation.",
  }),
}).custom((value, helpers) => {
  if (value.dailyBudget && value.lifetimeBudget) {
    return helpers.error("any.invalid", {
      message: "Provide dailyBudget OR lifetimeBudget, not both",
    });
  }
  if (value.spendCap) {
    if (value.dailyBudget && value.spendCap <= value.dailyBudget) {
      return helpers.error("any.invalid", {
        message:
          "spendCap (campaign spending limit) must be greater than the daily budget",
      });
    }
    if (value.lifetimeBudget && value.spendCap < value.lifetimeBudget) {
      return helpers.error("any.invalid", {
        message:
          "spendCap (campaign spending limit) must be at least the lifetime budget",
      });
    }
  }
  return value;
});

// ─── Shared targeting schema ──────────────────────────────────────────────────
//
// The audience/targeting object — identical between create-adset and
// edit-adset (parity rule: one source of truth). See LOCATION_TARGETING_PLAN.md
// for the `locations[]` model. Each entry maps to one of Meta's
// `geo_locations.{countries|cities|regions|country_groups|custom_locations}`
// (or `excluded_geo_locations.*` when mode === 'exclude').
const targetingSchemaV2 = Joi.object({
  locations: Joi.array()
    .items(
      Joi.object({
        type: Joi.string()
          .valid("country", "city", "region", "country_group", "custom")
          .required(),
        key: Joi.string().required(),
        name: Joi.string().allow("").optional(),
        mode: Joi.string().valid("include", "exclude").default("include"),
        radius: Joi.number()
          .integer()
          .min(1)
          .max(80)
          .when("type", { is: "custom", then: Joi.required() }),
        distanceUnit: Joi.string().valid("kilometer", "mile").default("kilometer"),
        countryCode: Joi.string().length(2).uppercase().optional(),
        latitude: Joi.number()
          .min(-90)
          .max(90)
          .when("type", { is: "custom", then: Joi.required() }),
        longitude: Joi.number()
          .min(-180)
          .max(180)
          .when("type", { is: "custom", then: Joi.required() }),
      }),
    )
    .default([]),
  worldwide: Joi.boolean().default(false),
  // Floor raised to 18 (was 13) — product decision to never target minors.
  // Meta's API accepts 13–65; the 18 floor is enforced at our layer.
  ageMin: Joi.number().integer().min(18).max(65).default(18),
  ageMax: Joi.number().integer().min(18).max(65).default(65),
  genders: Joi.array().items(Joi.number().valid(1, 2)).default([]),
  locales: Joi.array().items(Joi.number().integer()).default([]),
  advantageAudience: Joi.boolean().default(true),
  placementMode: Joi.string().valid("advantage_plus", "manual").default("advantage_plus"),
  publisherPlatforms: Joi.array()
    .items(Joi.string().valid("facebook", "instagram", "audience_network", "messenger"))
    .default([]),
  devicePlatforms: Joi.array()
    .items(Joi.string().valid("mobile", "desktop"))
    .default([]),
});

// ─── AdSet EDIT schema ────────────────────────────────────────────────────────
//
// Partial update for "Edit ad set". Editable: name, budget amount, bid cap,
// targeting/audience, schedule. NOT accepted (immutable / locked in v1):
// optimization_goal, billing_event, bid_strategy, page, app/pixel identity,
// destination, attribution. The controller has the campaign context to know
// whether budget belongs here (ABO) — Joi only enforces field shapes.
const updateAdSetSchemaV2 = Joi.object({
  adAccountId: Joi.string().required(),
  adSetId: Joi.string().required(),
  name: Joi.string().min(2).max(120).optional(),
  dailyBudget: Joi.number().integer().min(100).max(BUDGET_DAILY_MAX_MINOR).optional(),
  lifetimeBudget: Joi.number().integer().min(100).max(BUDGET_TOTAL_MAX_MINOR).optional(),
  bidAmount: Joi.number().integer().min(1).max(BUDGET_DAILY_MAX_MINOR).optional(),
  targeting: targetingSchemaV2.optional(),
  startTime: Joi.date().iso().optional(),
  endTime: Joi.date().iso().optional(),
  // Locked post-creation — reject so a stale/edited client can't try.
  optimizationGoal: Joi.any().forbidden().messages({
    "any.unknown": "The performance goal can't be changed after creation.",
  }),
  billingEvent: Joi.any().forbidden().messages({
    "any.unknown": "The billing event can't be changed after creation.",
  }),
  bidStrategy: Joi.any().forbidden().messages({
    "any.unknown": "The bid strategy can't be changed here.",
  }),
}).custom((value, helpers) => {
  if (value.dailyBudget && value.lifetimeBudget) {
    return helpers.error("any.invalid", {
      message: "Provide dailyBudget OR lifetimeBudget, not both",
    });
  }
  if (
    value.startTime &&
    value.endTime &&
    new Date(value.endTime).getTime() - new Date(value.startTime).getTime() <
      24 * 60 * 60 * 1000
  ) {
    return helpers.error("any.invalid", {
      message: "The schedule must run for at least 24 hours.",
    });
  }
  return value;
});

// ─── AdSet schema factory ────────────────────────────────────────────────────

/**
 * @param {string} objective         e.g. "OUTCOME_TRAFFIC"
 * @param {string} conversionLocation  e.g. "WEBSITE"
 * @returns {Joi.Schema} schema validating the V2 create-adset body for this cell
 * @throws if (objective, conversionLocation) is unknown or a placeholder cell
 */
function buildAdSetSchemaV2(objective, conversionLocation) {
  if (!isCellImplemented(objective, conversionLocation)) {
    throw new Error(
      `buildAdSetSchemaV2: (${objective}, ${conversionLocation}) is not an implemented cell`,
    );
  }
  const cell = getCell(objective, conversionLocation);

  // Base fields, present for every cell. Order roughly mirrors the V1
  // schema in meta.validator.js so reviewers can diff them.
  const baseShape = {
    adAccountId: Joi.string().required(),
    campaignId: Joi.string().required(),
    pageId: Joi.string().required(),
    instagramUserId: Joi.string().optional().allow(""),
    name: Joi.string().min(2).max(120).required(),

    // The objective + conversionLocation are echoed in the body so the
    // controller's validate() call self-checks they match the factory's
    // arguments. Defence in depth — the route wires the factory args
    // from these same body fields.
    objective: Joi.string().valid(objective).required(),
    conversionLocation: Joi.string().valid(conversionLocation).required(),

    // Budget — mutually exclusive AND only valid when the campaign is
    // NOT using CBO. Cross-field check at the controller level (V2 has
    // the campaign context); Joi here only enforces the mutual exclusion.
    // Upper bound is a typo-guard, see BUDGET_*_MAX_MINOR above.
    dailyBudget: Joi.number().integer().min(100).max(BUDGET_DAILY_MAX_MINOR).optional(),
    lifetimeBudget: Joi.number().integer().min(100).max(BUDGET_TOTAL_MAX_MINOR).optional(),
    // NOTE — ad-set min/max daily spend (`daily_min_spend_target` /
    // `daily_spend_cap`) is intentionally NOT accepted. It only does
    // something with MULTIPLE ad sets per campaign; the V2 wizard creates
    // exactly one, where Meta forces min ≤ budget ≤ max and the ad set
    // spends the whole budget regardless. Re-add when multi-ad-set
    // support lands.
    // Dynamic Creative — when true, Meta auto-generates variations from
    // the supplied creative inputs and optimises which combinations
    // perform best per viewer. Maps to `is_dynamic_creative: true` on
    // the AdSet. Single-image creative still works; Meta's value-add
    // grows with more variations supplied in Phase 3 (multi-image).
    dynamicCreative: Joi.boolean().default(false),
    // Attribution window — different objectives + optimisation goals
    // accept different combinations (Leads/LEAD_GENERATION accepts only
    // (1, 0); App Promo accepts (1, 1); Sales-Pixel accepts (7, 1)).
    // Default empty = let Meta server-side apply the correct default
    // for the cell; the controller skips `attribution_spec` when this
    // is empty. Users can explicitly override from the wizard, but
    // wrong combos get rejected by Meta with `error_subcode: 1885501`
    // and a clear error_user_msg listing the allowed pairs.
    attributionWindow: Joi.string()
      .valid("", "1d_click", "7d_click", "1d_click_1d_view", "7d_click_1d_view")
      .default(""),

    optimizationGoal: Joi.string()
      .valid(...cell.adSet.optimizationGoals)
      .default(cell.adSet.defaultOptimizationGoal),
    billingEvent: Joi.string()
      .valid(...cell.adSet.billingEvents)
      .default(cell.adSet.defaultBillingEvent),

    bidStrategy: Joi.string()
      .valid(...V2_BID_STRATEGIES)
      .default("LOWEST_COST_WITHOUT_CAP"),
    bidAmount: Joi.number().integer().min(1).max(BUDGET_DAILY_MAX_MINOR).optional(),

    startTime: Joi.date().iso().optional(),
    endTime: Joi.date().iso().optional(),

    // DSA compliance — Meta enforces these globally as of 2024 (initially
    // EU/EEA only). Without `dsa_beneficiary`, ad set creation fails with
    // error code 100 / subcode 3858081 "No advertiser indicated". The
    // beneficiary is the org being promoted; the payor is who's paying.
    // For most SaaS users both = the advertising entity (typically the
    // Page name). The frontend auto-fills from the selected Page, but we
    // accept manual override here for orgs whose legal name differs.
    dsaBeneficiary: Joi.string().min(1).max(200).optional().allow(""),
    dsaPayor: Joi.string().min(1).max(200).optional().allow(""),

    savedAudienceId: Joi.string().optional().allow(""),
    // Shared targeting schema (see targetingSchemaV2 above) — identical to
    // the edit-adset flow so the two never drift.
    targeting: targetingSchemaV2.required(),

    status: Joi.string().valid("ACTIVE", "PAUSED").default("PAUSED"),
  };

  // Cell-specific additional fields — currently only App Promotion uses
  // these. The schema's `additionalFields` array tells us which to add.
  const additional = cell.adSet.additionalFields || [];
  for (const field of additional) {
    switch (field) {
      case "mobileAppStore":
        baseShape.mobileAppStore = Joi.string()
          .valid(...MOBILE_APP_STORES)
          .required();
        break;
      case "applicationId":
        baseShape.applicationId = Joi.string().required();
        break;
      case "objectStoreUrl":
        baseShape.objectStoreUrl = Joi.string().trim().uri().required();
        break;
      case "pixelId":
        // Required for cells using OFFSITE_CONVERSIONS optimisation
        // (Leads Website / Multiple). The pixel must exist on the ad
        // account; we don't validate that here — Meta rejects at create
        // time with a clear error if not.
        baseShape.pixelId = Joi.string().required();
        break;
      case "pixelEventType":
        // The custom_event_type Meta optimises against — e.g. "Lead",
        // "CompleteRegistration". Free-form string because Meta accepts
        // standard events + customer-defined custom conversions.
        baseShape.pixelEventType = Joi.string().min(1).required();
        break;
      default:
        throw new Error(
          `buildAdSetSchemaV2: unknown additionalField "${field}" for ${objective}/${conversionLocation}`,
        );
    }
  }

  return Joi.object(baseShape).custom((value, helpers) => {
    if (value.dailyBudget && value.lifetimeBudget) {
      return helpers.error("any.invalid", {
        message: "Provide dailyBudget OR lifetimeBudget, not both",
      });
    }
    // Audience targeting must resolve to SOMETHING — at least one of:
    //   • a saved audience,
    //   • Worldwide on (Meta picks every country except TW/SG),
    //   • at least one "include"-mode entry in `locations`.
    if (
      !value.savedAudienceId &&
      !value.targeting.worldwide &&
      !(value.targeting.locations || []).some((l) => l.mode === "include")
    ) {
      return helpers.error("any.invalid", {
        message:
          "Add at least one location, enable Worldwide, or supply savedAudienceId",
      });
    }
    // Optimisation goal ↔ billing event compatibility — Meta rejects
    // mismatched pairs with subcode 1815117. The cell's `billingEvents`
    // array lists everything the cell COULD bill on, but only a subset
    // applies for each goal (e.g. LINK_CLICKS billing is valid only when
    // optimization_goal === LINK_CLICKS). Reject the mismatch here so
    // direct API callers + stale templates can't slip past.
    const allowedBillings = getAllowedBillingEvents(cell, value.optimizationGoal);
    if (allowedBillings.length && !allowedBillings.includes(value.billingEvent)) {
      return helpers.error("any.invalid", {
        message:
          `billingEvent '${value.billingEvent}' isn't valid for optimisation goal '${value.optimizationGoal}'. Allowed: ${allowedBillings.join(", ")}.`,
      });
    }
    // Optimisation goal ↔ bid strategy compatibility — some goals (e.g.
    // QUALITY_CALL, CONVERSATIONS, profile-visit goals) only accept
    // autobid; pairing them with a capped strategy triggers Meta subcode
    // 1885204 ("Optimisation goal only supports autobid"). Reject here.
    const allowedBids = getAllowedBidStrategies(cell, value.optimizationGoal);
    if (allowedBids.length && !allowedBids.includes(value.bidStrategy)) {
      return helpers.error("any.invalid", {
        message:
          `bidStrategy '${value.bidStrategy}' isn't valid for optimisation goal '${value.optimizationGoal}'. Allowed: ${allowedBids.join(", ")}.`,
      });
    }
    // Bid strategy ↔ bid amount — validated in BOTH directions, so the
    // mistake is caught here regardless of which way the user got it wrong:
    //   • capped strategies (bid cap / cost cap) MUST carry a bidAmount;
    //   • automatic strategies (LOWEST_COST_WITHOUT_CAP) must NOT — Meta
    //     rejects "Bid amount can't be set for <strategy> bid strategy".
    if (CAPPED_BID_STRATEGIES.has(value.bidStrategy)) {
      if (!value.bidAmount) {
        return helpers.error("any.invalid", {
          message: `bidAmount is required when bidStrategy is ${value.bidStrategy}`,
        });
      }
    } else if (value.bidAmount) {
      return helpers.error("any.invalid", {
        message: `bidAmount can't be set when bidStrategy is ${value.bidStrategy} (automatic bidding)`,
      });
    }
    // Schedule — Meta needs the run window to span at least 24 hours, else
    // it rejects with "Campaign schedule is too short". When no startTime
    // is given, Meta starts delivery "now", so that's the effective start.
    if (value.endTime) {
      const end = new Date(value.endTime).getTime();
      const start = value.startTime
        ? new Date(value.startTime).getTime()
        : Date.now();
      const MIN_SCHEDULE_MS = 24 * 60 * 60 * 1000;
      if (end <= start) {
        return helpers.error("any.invalid", {
          message: "endTime must be after startTime",
        });
      }
      if (end - start < MIN_SCHEDULE_MS) {
        return helpers.error("any.invalid", {
          message:
            "Campaign schedule is too short — the run window must be at least 24 hours",
        });
      }
    }
    return value;
  });
}

// ─── Ad schema factory ───────────────────────────────────────────────────────

/**
 * @param {string} objective
 * @param {string} conversionLocation
 * @returns {Joi.Schema} schema validating the V2 create-ad body for this cell
 */
function buildAdSchemaV2(objective, conversionLocation) {
  if (!isCellImplemented(objective, conversionLocation)) {
    throw new Error(
      `buildAdSchemaV2: (${objective}, ${conversionLocation}) is not an implemented cell`,
    );
  }
  const cell = getCell(objective, conversionLocation);

  // requiredFields drives which copy / destination fields are required.
  // Every cell requires imageHash; the rest vary.
  const req = new Set(cell.ad.requiredFields);

  const baseShape = {
    adAccountId: Joi.string().required(),
    adSetId: Joi.string().required(),
    pageId: Joi.string().required(),
    instagramUserId: Joi.string().optional().allow(""),
    name: Joi.string().min(2).max(120).required(),

    objective: Joi.string().valid(objective).required(),
    conversionLocation: Joi.string().valid(conversionLocation).required(),

    // Media — exactly one of (imageHash) OR (videoId + videoThumbnailUrl).
    // The xor is enforced below via .custom(). Meta needs the thumbnail
    // URL because the video doesn't have a usable poster frame until
    // encoding finishes — without one Meta rejects the creative call.
    imageHash: Joi.string().optional().allow(""),
    videoId: Joi.string().optional().allow(""),
    // `null` is allowed in addition to `""` because the wizard frontend
    // initialises this field to null when no thumbnail has been
    // explicitly entered (vs an empty string from a cleared input).
    // The controller treats both as "fetch from Meta" via
    // waitForVideoThumbnail.
    videoThumbnailUrl: Joi.string().trim().uri().optional().allow("", null),

    // Copy length caps — match Meta's display-without-truncation limits
    // for single-image / single-video ads (the only formats V2 produces
    // today). Carousel/Stories variants will need their own shorter caps
    // when those cells land. Mirror these in the wizard's TextField
    // maxLength props (CreateCampaignWizardV2.jsx Ad step).
    headline: req.has("headline")
      ? Joi.string().min(1).max(40).required()
      : Joi.string().allow("").max(40).default(""),
    primaryText: req.has("primaryText")
      ? Joi.string().min(1).max(125).required()
      : Joi.string().allow("").max(125).default(""),
    description: req.has("description")
      ? Joi.string().min(1).max(30).required()
      : Joi.string().allow("").max(30).default(""),

    // `.trim()` before `.uri()` so a stray space from a paste doesn't
     // sink launch with "must be a valid uri" — Joi rejects on
    // surrounding whitespace by default. Frontend's isHttpUrl already
    // trims; this keeps the two in sync.
    linkUrl: req.has("linkUrl")
      ? Joi.string().trim().uri().required()
      : Joi.string().trim().uri().optional().allow(""),
    urlTags: Joi.string().allow("").max(2000).default(""),

    // Cell-specific destination fields, present only on cells that
    // include them in requiredFields / optionalFields.
    leadFormId: req.has("leadFormId")
      ? Joi.string().required()
      : Joi.string().optional().allow(""),
    deferredDeepLink: cell.ad.optionalFields.includes("deferredDeepLink")
      ? Joi.string().trim().uri().optional().allow("")
      : Joi.forbidden(),
    customProductPage: cell.ad.optionalFields.includes("customProductPage")
      ? Joi.string().optional().allow("")
      : Joi.forbidden(),

    callToAction: Joi.string()
      .valid(...cell.ctas.allowed)
      .default(cell.ctas.default),

    // Auto-translate ad copy into viewers' languages. Maps to
    // `link_data.automatic_translation: true` on the creative.
    autoTranslate: Joi.boolean().default(false),

    status: Joi.string().valid("ACTIVE", "PAUSED").default("PAUSED"),
  };

  // Shape-derived fields the wizard resends from earlier steps (NOT user
  // inputs on the Ad step — those live in ad.requiredFields/optionalFields).
  // For App Promotion both `objectStoreUrl` AND `applicationId` are captured
  // at the AdSet step and resent here so the creative builder has both
  // without a second SDK round-trip. Meta's INSTALL_MOBILE_APP CTA needs
  // `value.application` (the Meta app id), so `applicationId` is required
  // here even though it's not user-visible on the Ad step.
  if (cell.ad.objectStorySpecShape === "app_link") {
    baseShape.objectStoreUrl = Joi.string().uri().required();
    baseShape.applicationId = Joi.string().required();
  } else {
    baseShape.objectStoreUrl = Joi.forbidden();
    baseShape.applicationId = Joi.forbidden();
  }

  return Joi.object(baseShape).custom((value, helpers) => {
    // Media xor — exactly one of imageHash OR videoId must be present.
    // The wizard surfaces a tabbed picker; we enforce here so direct API
    // callers can't slip past with both or neither.
    // `videoThumbnailUrl` is optional at the validator level — the V2
    // controller fetches Meta's auto-generated thumbnail when missing
    // (see createAdV2). This way users never have to think about
    // providing a poster image.
    const hasImage = !!value.imageHash;
    const hasVideo = !!value.videoId;
    if (hasImage === hasVideo) {
      return helpers.error("any.invalid", {
        message: "Provide exactly one of imageHash OR videoId (not both, not neither)",
      });
    }
    // Cell-level media-kind lock. Engagement/VIDEO_VIEWS sets
    // `cell.ad.mediaKind = 'video'` to force video creatives only — Meta
    // rejects image creatives on THRUPLAY-optimised ad sets. Tighten the
    // generic XOR above: image not allowed when the cell is video-only.
    // (mediaKind defaults to 'any' on cells that don't set it.)
    if (cell.ad.mediaKind === "video" && hasImage) {
      return helpers.error("any.invalid", {
        message:
          "This cell requires a video creative — pick or upload a video instead of an image.",
      });
    }
    if (cell.ad.mediaKind === "image" && hasVideo) {
      return helpers.error("any.invalid", {
        message:
          "This cell requires an image creative — pick or upload an image instead of a video.",
      });
    }
    return value;
  });
}

module.exports = {
  createCampaignSchemaV2,
  updateCampaignSchemaV2,
  buildAdSetSchemaV2,
  updateAdSetSchemaV2,
  buildAdSchemaV2,
  // Re-exported for the controller's use in error messages + UI hints.
  V2_BID_STRATEGIES,
  SPECIAL_AD_CATEGORIES,
  MOBILE_APP_STORES,
};
