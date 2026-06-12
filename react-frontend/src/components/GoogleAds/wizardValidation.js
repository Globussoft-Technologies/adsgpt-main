/**
 * wizardValidation.js — pure validation engine for CreateCampaignWizard (Google Ads).
 *
 * validateStep(stepId, form, adType) returns { fieldName: message }.
 * Empty map = step valid. validateAllSteps runs all pre-review steps.
 *
 * Rules mirror google.validator.js Joi schemas. Pure module — no React, no network.
 */

import { isAllowedDestination } from './googleWizardDestinations';

const isBlank = (v) => v == null || String(v).trim() === '';

const toNumber = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
};

const isPositive = (v) => {
  const n = toNumber(v);
  return Number.isFinite(n) && n > 0;
};

function isHttpUrl(v) {
  try {
    const u = new URL(String(v).trim());
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

const BUSINESS_GOALS = new Set(['SALES', 'LEADS', 'WEBSITE_TRAFFIC', 'LOCAL_STORE', 'APP_PROMOTION', 'YOUTUBE_REACH']);

/** Channel used for ad-type, conditional fields, and step flow. */
export function effectiveChannel(form) {
  return form?.destination || form?.objective;
}

/** Value sent to create-campaign API. */
export function resolveCampaignObjective(form) {
  const objective = String(form?.objective || '').toUpperCase().replace(/ /g, '_');
  const destination = String(form?.destination || '').toUpperCase().replace(/ /g, '_');
  if (!destination) return objective;
  if (BUSINESS_GOALS.has(objective) && destination === 'SEARCH') return objective;
  if (objective === 'LOCAL_STORE' && destination === 'SEARCH') return objective;
  return destination;
}

export function deriveAdType(objective) {
  const DEMAND_GEN = new Set(['YOUTUBE_REACH', 'APP_PROMOTION', 'VIDEO', 'DEMAND_GEN']);
  const DISPLAY    = new Set(['DISPLAY']);
  if (DEMAND_GEN.has(objective)) return 'DEMAND_GEN';
  if (DISPLAY.has(objective))    return 'DISPLAY';
  return 'SEARCH';
}

// ── Objective ──────────────────────────────────────────────────────────────────
function validateObjective(form) {
  return isBlank(form.objective) ? { objective: 'Choose an objective.' } : {};
}

function validateDestination(form, schema) {
  if (isBlank(form.destination)) {
    return { destination: 'Choose where your ads will run.' };
  }
  if (form.objective && schema && !isAllowedDestination(form.objective, form.destination, schema)) {
    return { destination: 'This destination is not available for the selected objective.' };
  }
  return {};
}

// ── Campaign ───────────────────────────────────────────────────────────────────
function validateCampaign(form) {
  const e = {};
  const channel = effectiveChannel(form);
  if (isBlank(form.campaignName)) {
    e.campaignName = 'Campaign name is required.';
  } else if (form.campaignName.trim().length < 2) {
    e.campaignName = 'Campaign name must be at least 2 characters.';
  } else if (form.campaignName.length > 120) {
    e.campaignName = 'Campaign name must be 120 characters or fewer.';
  }

  if (isBlank(form.dailyBudget)) {
    e.dailyBudget = 'Daily budget is required.';
  } else if (!isPositive(form.dailyBudget)) {
    e.dailyBudget = 'Daily budget must be a positive amount.';
  } else if (toNumber(form.dailyBudget) * 1_000_000 < 10_000) {
    e.dailyBudget = 'Daily budget must be at least ₹0.01 per day.';
  }

  if (!isBlank(form.endDate) && !isBlank(form.startDate)) {
    if (new Date(form.endDate) <= new Date(form.startDate)) {
      e.endDate = 'End date must be after the start date.';
    }
  }

  if (form.countries?.length) {
    for (const c of form.countries) {
      if (!/^[A-Z]{2}$/.test(c)) {
        e.countries = 'Country codes must be 2 uppercase letters (e.g. IN, US).';
        break;
      }
    }
  }

  // ── Channel-specific campaign fields ──────────────────────────────────────
  if (channel === 'SHOPPING') {
    if (isBlank(form.merchantCenterId))
      e.merchantCenterId = 'Merchant Center ID is required for Shopping campaigns.';
  }

  if (channel === 'APP_PROMOTION') {
    if (isBlank(form.appStoreUrl)) {
      e.appStoreUrl = 'App store URL is required.';
    } else if (!isHttpUrl(form.appStoreUrl)) {
      e.appStoreUrl = 'Enter a valid app store URL (https://…).';
    }
  }

  if (form.objective === 'LOCAL_STORE') {
    if (isBlank(form.storeAddress))
      e.storeAddress = 'Store address is required for Local Store campaigns.';
    if (!isBlank(form.locationRadius) && toNumber(form.locationRadius) < 1)
      e.locationRadius = 'Location radius must be at least 1 km.';
  }

  if (channel === 'PERFORMANCE_MAX') {
    if (isBlank(form.assetGroupName))
      e.assetGroupName = 'Asset group name is required for Performance Max campaigns.';
  }

  return e;
}

// ── Ad Group ───────────────────────────────────────────────────────────────────
function validateAdGroup(form) {
  const e = {};
  const channel = effectiveChannel(form);
  if (isBlank(form.adGroupName)) {
    e.adGroupName = 'Ad group name is required.';
  } else if (form.adGroupName.trim().length < 2) {
    e.adGroupName = 'Ad group name must be at least 2 characters.';
  } else if (form.adGroupName.length > 120) {
    e.adGroupName = 'Ad group name must be 120 characters or fewer.';
  }

  if (!isBlank(form.cpcBid) && !isPositive(form.cpcBid)) {
    e.cpcBid = 'CPC bid must be a positive amount.';
  }

  if (!isBlank(form.ageMin)) {
    const v = toNumber(form.ageMin);
    if (!Number.isFinite(v) || v < 18 || v > 65) e.ageMin = 'Age must be between 18 and 65.';
  }
  if (!isBlank(form.ageMax)) {
    const v = toNumber(form.ageMax);
    if (!Number.isFinite(v) || v < 18 || v > 65) e.ageMax = 'Age must be between 18 and 65.';
  }
  if (!isBlank(form.ageMin) && !isBlank(form.ageMax)) {
    if (toNumber(form.ageMax) < toNumber(form.ageMin)) {
      e.ageMax = 'Max age must be greater than or equal to min age.';
    }
  }

  // ── Objective-specific ad group fields ────────────────────────────────────
  const SEARCH_OBJECTIVES = new Set(['SALES', 'LEADS', 'WEBSITE_TRAFFIC', 'SEARCH', 'LOCAL_STORE']);
  if (SEARCH_OBJECTIVES.has(channel)) {
    // At least one non-empty keyword required
    const hasKeyword = form.keywords?.some((k) => !isBlank(k.text));
    if (!hasKeyword) e.keywords = 'Add at least one keyword.';

    if (form.biddingGoal === 'TARGET_CPA') {
      if (isBlank(form.targetCpa) || !isPositive(form.targetCpa))
        e.targetCpa = 'Target CPA amount is required and must be positive.';
    }
    if (form.biddingGoal === 'TARGET_ROAS') {
      if (isBlank(form.targetRoas) || !isPositive(form.targetRoas))
        e.targetRoas = 'Target ROAS % is required and must be positive.';
    }
  }

  if (channel === 'DISPLAY') {
    if (!isBlank(form.frequencyCap) && toNumber(form.frequencyCap) < 1)
      e.frequencyCap = 'Frequency cap must be at least 1.';
  }

  return e;
}

// ── Ad ─────────────────────────────────────────────────────────────────────────
function validateAd(form, adType) {
  const e = {};

  if (adType === 'SEARCH') {
    const heads = form.headlines || [];
    if (heads.length < 3) {
      e.headlines = 'At least 3 headlines are required.';
    } else if (heads.length > 15) {
      e.headlines = 'At most 15 headlines are allowed.';
    } else {
      const long = heads.find((h) => h.length > 30);
      if (long) e.headlines = `Headline "${long.slice(0, 20)}…" exceeds 30 characters.`;
      const empty = heads.find((h) => !h.trim());
      if (empty) e.headlines = 'Headlines must not be empty.';
    }

    const descs = form.descriptions || [];
    if (descs.length < 2) {
      e.descriptions = 'At least 2 descriptions are required.';
    } else if (descs.length > 4) {
      e.descriptions = 'At most 4 descriptions are allowed.';
    } else {
      const long = descs.find((d) => d.length > 90);
      if (long) e.descriptions = `Description "${long.slice(0, 20)}…" exceeds 90 characters.`;
      const empty = descs.find((d) => !d.trim());
      if (empty) e.descriptions = 'Descriptions must not be empty.';
    }

    if (isBlank(form.finalUrl)) {
      e.finalUrl = 'Landing page URL is required.';
    } else if (!isHttpUrl(form.finalUrl)) {
      e.finalUrl = 'Enter a valid URL (https://…).';
    }
  }

  if (adType === 'DISPLAY') {
    if (isBlank(form.headline)) {
      e.headline = 'Headline is required.';
    } else if (form.headline.length > 30) {
      e.headline = 'Headline must be 30 characters or fewer.';
    }

    if (isBlank(form.description)) {
      e.description = 'Description is required.';
    } else if (form.description.length > 90) {
      e.description = 'Description must be 90 characters or fewer.';
    }

    if (isBlank(form.imageUrl) && !form.imageFile && isBlank(form.assetResourceName)) {
      e.imageUrl = 'Upload an image or provide an image URL.';
    }

    if (isBlank(form.finalUrl)) {
      e.finalUrl = 'Landing page URL is required.';
    } else if (!isHttpUrl(form.finalUrl)) {
      e.finalUrl = 'Enter a valid URL (https://…).';
    }
  }

  if (adType === 'DEMAND_GEN') {
    if (isBlank(form.videoUrl) && isBlank(form.youtubeVideoId)) {
      e.videoUrl = 'A YouTube URL or video ID is required.';
    }

    if (isBlank(form.finalUrl)) {
      e.finalUrl = 'Landing page URL is required.';
    } else if (!isHttpUrl(form.finalUrl)) {
      e.finalUrl = 'Enter a valid URL (https://…).';
    }

    if (isBlank(form.headline)) {
      e.headline = 'Headline is required.';
    } else if (form.headline.length > 30) {
      e.headline = 'Headline must be 30 characters or fewer.';
    }

    if (!isBlank(form.longHeadline) && form.longHeadline.length > 90) {
      e.longHeadline = 'Long headline must be 90 characters or fewer.';
    }
    if (!isBlank(form.description) && form.description.length > 90) {
      e.description = 'Description must be 90 characters or fewer.';
    }
  }

  return e;
}

/**
 * Validate one wizard step.
 * @param {string} stepId   'objective' | 'campaign' | 'adGroup' | 'ad' | 'review'
 * @param {object} form     current form state
 * @param {string} adType   'SEARCH' | 'DISPLAY' | 'DEMAND_GEN' (required for ad step)
 */
export function validateStep(stepId, form, adType, schema) {
  switch (stepId) {
    case 'objective':  return validateObjective(form);
    case 'destination': return validateDestination(form, schema);
    case 'campaign':   return validateCampaign(form);
    case 'adGroup':    return validateAdGroup(form);
    case 'ad':         return validateAd(form, adType || deriveAdType(effectiveChannel(form)));
    case 'review':     return {};
    default:           return {};
  }
}

/** Validate all pre-review steps. Returns { stepId: { field: msg } } for steps with errors. */
export function validateAllSteps(steps, form, schema) {
  const adType = deriveAdType(effectiveChannel(form));
  const byStep = {};
  for (const s of steps || []) {
    if (!s || s.id === 'review') continue;
    const errs = validateStep(s.id, form, adType, schema);
    if (Object.keys(errs).length) byStep[s.id] = errs;
  }
  return byStep;
}
