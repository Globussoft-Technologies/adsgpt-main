/**
 * wizardValidation.js — pure validation engine for CreateCampaignWizardV2.
 *
 * `validateStep(stepId, form, cell)` returns a map of { fieldName: message }
 * for one step; an empty map means the step is valid. `validateAllSteps`
 * runs every pre-Review step — used to gate the Launch button so a user
 * can never launch data Meta will reject.
 *
 * Rules mirror the backend Joi schemas (Validations/meta.v2.validator.js)
 * and the Meta API constraints hit in production (bid strategy ↔ bid
 * amount, budget XOR, media image-XOR-video, schedule order, …). Keep the
 * two in sync — test/metaAds/v2.test.js cross-checks them.
 *
 * Pure module: no React, no network. Safe to unit-test directly.
 */

// Bid strategies that REQUIRE a bid amount cap. The inverse — automatic
// bid strategies (e.g. LOWEST_COST_WITHOUT_CAP) — must NOT carry a bid
// amount; Meta rejects both mistakes. Exported so the wizard renders the
// bid-amount field on exactly these strategies.
export const CAPPED_BID_STRATEGIES = new Set([
  'LOWEST_COST_WITH_BID_CAP',
  'COST_CAP',
]);

// Minimum budget in MAJOR currency units. Meta's true floor is currency-
// specific; 1 major unit is a safe lower bound across supported currencies
// and matches the backend Joi `min(100)` (100 minor units = 1 major).
const MIN_BUDGET_MAJOR = 1;

// Meta requires an ad set's run window to span at least 24 hours — a
// shorter schedule is rejected at launch with "Campaign schedule is too
// short". Keep in sync with the same constant in meta.v2.validator.js.
const MIN_SCHEDULE_MS = 24 * 60 * 60 * 1000;

const isBlank = (v) => v == null || String(v).trim() === '';

const toNumber = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
};

// A money amount in major units that is present and strictly positive.
const isPositiveAmount = (v) => {
  const n = toNumber(v);
  return Number.isFinite(n) && n > 0;
};

// Accepts only absolute http(s) URLs — matches Meta's link validation.
function isHttpUrl(v) {
  try {
    const u = new URL(String(v).trim());
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

// "primaryText" → "Primary text", "headline" → "Headline" — for generic
// required-field messages so a newly added schema field never slips
// through unvalidated with an ugly label.
function prettifyFieldName(name) {
  const spaced = String(name || '').replace(/([A-Z])/g, ' $1').trim();
  return spaced ? spaced[0].toUpperCase() + spaced.slice(1).toLowerCase() : '';
}

// "5000" + "INR" → "INR 5,000" — for currency-aware minimum messages.
function formatMoney(amount, currency) {
  const n = Number(amount).toLocaleString();
  return currency ? `${currency} ${n}` : n;
}

// ── Step: Campaign ──────────────────────────────────────────────────────
function validateCampaign(form, ctx) {
  const e = {};
  // Meta's per-account daily-budget floor (major units); falls back to a
  // conservative 1-major minimum when the account didn't report one.
  const minDaily = ctx.minDailyBudget || MIN_BUDGET_MAJOR;

  if (isBlank(form.campaignName)) {
    e.campaignName = 'Campaign name is required.';
  } else if (form.campaignName.trim().length < 2) {
    e.campaignName = 'Campaign name must be at least 2 characters.';
  } else if (form.campaignName.length > 120) {
    e.campaignName = 'Campaign name must be 120 characters or fewer.';
  }

  if (form.cbo) {
    if (isBlank(form.campaignBudget)) {
      e.campaignBudget = 'Campaign budget is required when CBO is on.';
    } else if (!isPositiveAmount(form.campaignBudget)) {
      e.campaignBudget = 'Campaign budget must be a positive amount.';
    } else if (
      form.campaignBudgetType === 'daily' &&
      toNumber(form.campaignBudget) < minDaily
    ) {
      e.campaignBudget = `Daily budget must be at least ${formatMoney(minDaily, ctx.currency)}.`;
    } else if (toNumber(form.campaignBudget) < MIN_BUDGET_MAJOR) {
      e.campaignBudget = `Campaign budget must be at least ${formatMoney(MIN_BUDGET_MAJOR, ctx.currency)}.`;
    }
  }

  // Campaign spending limit. Meta enforces a per-currency MINIMUM (e.g.
  // ₹5,000 for an INR account — read live from the ad account), and the
  // cap must also sit above the budget it caps (a cap at/below the daily
  // budget is exhausted before a day of delivery finishes).
  if (!isBlank(form.spendCap)) {
    if (!isPositiveAmount(form.spendCap)) {
      e.spendCap = 'Spending limit must be a positive amount.';
    } else {
      const cap = toNumber(form.spendCap);
      const minCap = ctx.minSpendCap || 0;
      if (minCap > 0 && cap < minCap) {
        e.spendCap = `Campaign spending limit must be at least ${formatMoney(minCap, ctx.currency)} for this ad account.`;
      } else if (form.cbo && isPositiveAmount(form.campaignBudget)) {
        const budget = toNumber(form.campaignBudget);
        if (form.campaignBudgetType === 'daily' && cap <= budget) {
          e.spendCap = 'The spending limit must be greater than the daily budget.';
        } else if (form.campaignBudgetType === 'lifetime' && cap < budget) {
          e.spendCap = 'The spending limit must be at least the lifetime budget.';
        }
      } else if (!form.cbo && isPositiveAmount(form.adSetBudget)) {
        const budget = toNumber(form.adSetBudget);
        if (form.adSetBudgetType === 'daily' && cap <= budget) {
          e.spendCap = 'The spending limit must be greater than the ad set daily budget.';
        } else if (form.adSetBudgetType === 'lifetime' && cap < budget) {
          e.spendCap = 'The spending limit must be at least the ad set lifetime budget.';
        }
      }
    }
  }

  // iOS 14+ (App Promotion) binds the app at the campaign level.
  if (form.iosOptimised) {
    if (isBlank(form.applicationId)) {
      e.applicationId = 'Pick an app for the iOS 14+ campaign.';
    }
    if (isBlank(form.objectStoreUrl)) {
      e.objectStoreUrl = 'The app store URL is required for an iOS 14+ campaign.';
    } else if (!isHttpUrl(form.objectStoreUrl)) {
      e.objectStoreUrl = 'The app store URL must be a valid URL.';
    }
  }
  return e;
}

// ── Step: Ad Set ────────────────────────────────────────────────────────
function validateAdSet(form, cell, ctx) {
  const e = {};
  const minDaily = ctx.minDailyBudget || MIN_BUDGET_MAJOR;
  if (isBlank(form.adSetName)) {
    e.adSetName = 'Ad set name is required.';
  } else if (form.adSetName.trim().length < 2) {
    e.adSetName = 'Ad set name must be at least 2 characters.';
  }

  if (isBlank(form.pageId)) e.pageId = 'Select a Facebook Page.';
  if (isBlank(form.optimizationGoal)) e.optimizationGoal = 'Select a performance goal.';
  if (isBlank(form.billingEvent)) e.billingEvent = 'Select a billing event.';

  // Bid strategy ↔ bid amount — validated in BOTH directions.
  if (CAPPED_BID_STRATEGIES.has(form.bidStrategy)) {
    if (isBlank(form.bidAmount)) {
      e.bidAmount = 'A bid amount cap is required for this bid strategy.';
    } else if (!isPositiveAmount(form.bidAmount)) {
      e.bidAmount = 'Bid amount must be a positive number.';
    }
  } else if (!isBlank(form.bidAmount)) {
    e.bidAmount = 'Bid amount can’t be set for an automatic bid strategy.';
  }

  // Ad-set budget — only when the campaign isn't running CBO.
  if (!form.cbo) {
    if (isBlank(form.adSetBudget)) {
      e.adSetBudget = 'Ad set budget is required.';
    } else if (!isPositiveAmount(form.adSetBudget)) {
      e.adSetBudget = 'Ad set budget must be a positive amount.';
    } else if (
      form.adSetBudgetType === 'daily' &&
      toNumber(form.adSetBudget) < minDaily
    ) {
      e.adSetBudget = `Daily budget must be at least ${formatMoney(minDaily, ctx.currency)}.`;
    } else if (toNumber(form.adSetBudget) < MIN_BUDGET_MAJOR) {
      e.adSetBudget = `Ad set budget must be at least ${formatMoney(MIN_BUDGET_MAJOR, ctx.currency)}.`;
    }
  }

  // Audience — saved audience XOR Worldwide XOR ≥1 included location.
  if (form.useSavedAudience) {
    if (isBlank(form.savedAudienceId)) {
      e.savedAudienceId = 'Select a saved audience.';
    }
  } else if (!form.worldwide) {
    const locations = form.locations || [];
    const hasInclude = locations.some((l) => l && l.mode === 'include');
    if (!hasInclude) {
      e.locations =
        'Add at least one location (country, city, region, or area), or enable Worldwide.';
    } else {
      // City radius must stay inside Meta's accepted band — the
      // LocationTargeting input clamps it on edit, but a paste / preset
      // can land outside the bounds.
      for (const l of locations) {
        if (l && l.type === 'city' && l.radius != null) {
          const r = toNumber(l.radius);
          if (!Number.isFinite(r) || r < 1 || r > 80) {
            e.locations = 'City radius must be between 1 km and 80 km.';
            break;
          }
        }
      }
    }
  }

  // Special Ad Categories ↔ locations. Meta requires
  // `special_ad_category_country` to be derivable from the targeting,
  // and rejects ad sets whose locations fall outside that country set
  // (subcode 2909034). Catch the impossible cases here so the user
  // doesn't discover them at Launch.
  const hasSpecialCategory = (form.specialAdCategories || []).length > 0;
  if (hasSpecialCategory && !form.useSavedAudience) {
    if (form.worldwide) {
      e.locations =
        "Special Ad Categories can't be combined with Worldwide targeting — turn off Worldwide and pick specific countries.";
    } else {
      // The wizard derives `special_ad_category_country` from each
      // included location's country (country.key, or city/region/area's
      // `countryCode`). If nothing resolves, Meta will fall back to its
      // own default and reject — surface that here.
      const codes = new Set();
      for (const l of form.locations || []) {
        if (!l || l.mode !== 'include') continue;
        if (l.type === 'country' && l.key) codes.add(String(l.key).toUpperCase());
        else if (l.countryCode) codes.add(String(l.countryCode).toUpperCase());
      }
      if (codes.size === 0) {
        e.locations =
          'Special Ad Categories need at least one country-based location (free-trade areas alone don’t qualify) — add a country, city, or region.';
      }
    }
  }

  if (toNumber(form.ageMin) > toNumber(form.ageMax)) {
    e.ageMax = 'Maximum age must be greater than or equal to the minimum age.';
  }

  // Placements — manual mode needs at least one platform.
  if (
    form.placementMode === 'manual' &&
    (!form.publisherPlatforms || form.publisherPlatforms.length === 0)
  ) {
    e.publisherPlatforms = 'Pick at least one placement, or use Advantage+ placements.';
  }

  // Schedule — Meta requires the run window to be at least 24 hours
  // ("Campaign schedule is too short" otherwise). When no explicit start
  // time is set, Meta starts delivery "now", so that's the effective start.
  if (form.hasEndTime) {
    if (isBlank(form.endTime)) {
      e.endTime = 'Set an end time, or turn off the end-date toggle.';
    } else {
      const end = new Date(form.endTime).getTime();
      const start = isBlank(form.startTime)
        ? Date.now()
        : new Date(form.startTime).getTime();
      if (!Number.isFinite(end)) {
        e.endTime = 'Enter a valid end time.';
      } else if (Number.isFinite(start) && end <= start) {
        e.endTime = 'End time must be after the start time.';
      } else if (Number.isFinite(start) && end - start < MIN_SCHEDULE_MS) {
        e.endTime =
          'The schedule must run for at least 24 hours — Meta rejects shorter campaigns.';
      }
    }
  }

  // Cell-specific required fields (App Promotion + Pixel-using cells).
  const extra = cell?.adSet?.additionalFields || [];
  if (extra.includes('mobileAppStore') && isBlank(form.mobileAppStore)) {
    e.mobileAppStore = 'Choose a mobile app store.';
  }
  if (extra.includes('applicationId') && isBlank(form.applicationId)) {
    e.applicationId = 'Select an app to promote.';
  }
  if (extra.includes('objectStoreUrl')) {
    if (isBlank(form.objectStoreUrl)) {
      e.objectStoreUrl = 'The app store URL is required.';
    } else if (!isHttpUrl(form.objectStoreUrl)) {
      e.objectStoreUrl = 'The app store URL must be a valid URL.';
    }
  }
  if (extra.includes('pixelId') && isBlank(form.pixelId)) {
    e.pixelId = 'Select a pixel.';
  }
  if (extra.includes('pixelEventType') && isBlank(form.pixelEventType)) {
    e.pixelEventType = 'Select a conversion event.';
  }
  return e;
}

// ── Step: Ad ────────────────────────────────────────────────────────────
function validateAd(form, cell) {
  const e = {};
  if (isBlank(form.adName)) e.adName = 'Ad name is required.';

  // Media — exactly one of image / video must be provided.
  if (form.mediaType === 'video') {
    if (!form.videoFile && isBlank(form.videoUrl)) {
      e.media = 'Upload a video or pick one from the library.';
    }
  } else if (!form.imageFile && !form.imageUrl) {
    e.media = 'Upload an image or pick one from the library.';
  }

  // Every field the cell's schema marks required. Iterating the schema
  // list (rather than hard-coding each field) means a newly added
  // required field is validated automatically. `imageHash` / `videoId`
  // are satisfied by the media check above, so they're skipped here.
  const MEDIA_REQUIRED = new Set(['imageHash', 'videoId']);
  const req = cell?.ad?.requiredFields || [];
  for (const field of req) {
    if (MEDIA_REQUIRED.has(field)) continue;
    if (field === 'linkUrl') {
      if (isBlank(form.linkUrl)) {
        e.linkUrl = 'Destination URL is required.';
      } else if (!isHttpUrl(form.linkUrl)) {
        e.linkUrl = 'Enter a valid URL (https://…).';
      }
    } else if (field === 'leadFormId') {
      if (isBlank(form.leadFormId)) {
        e.leadFormId = 'A lead form must be attached.';
      }
    } else if (isBlank(form[field])) {
      // headline / primaryText / description / any future text field.
      e[field] = `${prettifyFieldName(field)} is required.`;
    }
  }
  if (cell?.ctas?.allowed?.length && isBlank(form.callToAction)) {
    e.callToAction = 'Pick a call-to-action button.';
  }
  return e;
}

/**
 * Validate one step. Returns { fieldName: message }; empty === valid.
 *
 * `ctx` carries account-derived limits (all amounts in MAJOR currency
 * units): { minSpendCap, minDailyBudget, currency }. Optional — when
 * absent the engine falls back to conservative generic minimums.
 */
export function validateStep(stepId, form, cell, ctx = {}) {
  switch (stepId) {
    case 'objective':
      return form.objective ? {} : { objective: 'Choose an objective.' };
    case 'conversionLocation':
      return form.conversionLocation && cell
        ? {}
        : { conversionLocation: 'Choose a destination.' };
    case 'campaign':
      return validateCampaign(form, ctx);
    case 'adSet':
      return validateAdSet(form, cell, ctx);
    case 'leadForm':
      return form.leadFormId
        ? {}
        : { leadFormId: 'Select an existing lead form or create a new one.' };
    case 'ad':
      return validateAd(form, cell);
    case 'review':
      return {};
    default:
      return {};
  }
}

/**
 * Validate every step before Review. Returns { stepId: {field: message} }
 * for steps that have errors — used to gate Launch and show a per-step
 * summary on the Review screen.
 */
export function validateAllSteps(steps, form, cell, ctx = {}) {
  const byStep = {};
  for (const s of steps || []) {
    if (!s || s.id === 'review') continue;
    const errs = validateStep(s.id, form, cell, ctx);
    if (Object.keys(errs).length) byStep[s.id] = errs;
  }
  return byStep;
}
