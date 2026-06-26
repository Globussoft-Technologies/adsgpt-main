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

/**
 * Extracts the root domain (eTLD+1) from a URL hostname.
 * shop.example.com → example.com
 * www.example.com  → example.com
 * example.com      → example.com
 */
const MULTI_LEVEL_TLDS = new Set([
  'co.uk','co.in','co.jp','co.nz','co.za','co.kr','co.au',
  'com.au','com.br','com.mx','com.ar','com.tr','com.sg','com.my','com.ph',
  'org.uk','net.au','gov.au','gov.uk',
]);

function extractRootDomain(url) {
  try {
    const { hostname } = new URL(String(url).trim());
    const parts = hostname.toLowerCase().split('.');
    if (parts.length >= 3) {
      const candidate = parts.slice(-2).join('.');
      if (MULTI_LEVEL_TLDS.has(candidate)) return parts.slice(-3).join('.');
    }
    return parts.slice(-2).join('.');
  } catch {
    return null;
  }
}

/**
 * Campaign domain policy: every ad's Final URL must share the same root domain
 * as the campaign website URL.
 *
 * ✅ example.com, www.example.com, shop.example.com  → root = example.com
 * ❌ example2.com, otherdomain.com                   → different root → blocked
 *
 * Returns an error string or null if valid / not checkable.
 */
function validateFinalUrlDomain(finalUrl, websiteUrl) {
  if (!finalUrl || !websiteUrl) return null;
  const adRoot   = extractRootDomain(finalUrl);
  const siteRoot = extractRootDomain(websiteUrl);
  if (!adRoot || !siteRoot) return null;
  if (adRoot !== siteRoot) {
    return `Final URL domain (${adRoot}) does not match the campaign domain (${siteRoot}). Subdomains like shop.${siteRoot} are allowed, but ${adRoot} is a different domain and will be rejected by Google.`;
  }
  return null;
}

const isPositive = (v) => {
  const n = toNumber(v);
  return Number.isFinite(n) && n > 0;
};

function isHttpUrl(v) {
  try {
    const s = String(v).trim();
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    // Reject "https:foo.com" — must have "//" after protocol
    return s.slice(u.protocol.length).startsWith('//');
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
    if (isBlank(form.pmaxFinalUrl))
      e.pmaxFinalUrl = 'Landing page URL is required.';
    else if (!isHttpUrl(form.pmaxFinalUrl))
      e.pmaxFinalUrl = 'Enter a valid URL (https://…).';
    else {
      const domainErr = validateFinalUrlDomain(form.pmaxFinalUrl, form.websiteUrl);
      if (domainErr) e.pmaxFinalUrl = domainErr;
    }
  }

  return e;
}

function validateAssets(form) {
  const e = {};
  if (isBlank(form.assetGroupName))
    e.assetGroupName = 'Asset group name is required.';
  // pmaxBusinessName is optional — backend auto-fetches from Google account if omitted
  const heads = (form.pmaxHeadlines || []).filter((h) => h && h.trim());
  const allSlotsFilled = (form.pmaxHeadlines || []).every((h) => h && h.trim());
  if (heads.length < 3)
    e.pmaxHeadlines = `Fill in all ${form.pmaxHeadlines?.length || 3} headline fields (${heads.length}/${form.pmaxHeadlines?.length || 3} filled).`;
  else if (!allSlotsFilled)
    e.pmaxHeadlines = 'All headline fields must be filled in.';
  else if ([...new Set(heads.map((h) => h.toLowerCase()))].length < heads.length)
    e.pmaxHeadlines = 'Headlines must be unique.';
  if (isBlank(form.pmaxLongHeadline))
    e.pmaxLongHeadline = 'Long headline is required by Google (min 1, max 90 chars).';
  else if (String(form.pmaxLongHeadline).trim().length > 90)
    e.pmaxLongHeadline = 'Long headline must be 90 characters or fewer.';
  const descs = (form.pmaxDescriptions || []).filter((d) => d && d.trim());
  if (descs.length < 2)
    e.pmaxDescriptions = `Fill in both description fields (${descs.length}/2 filled).`;
  // At least one media asset required: image (URL or uploaded) or YouTube video
  // blob: means video upload is in progress — treat as valid (YouTube URL will replace it)
  const pmaxVideoUploading = form.pmaxVideoUrl?.startsWith('blob:');
  if (isBlank(form.pmaxImageUrl) && isBlank(form.pmaxImageAssetRN) && isBlank(form.pmaxVideoUrl) && !pmaxVideoUploading)
    e.pmaxMedia = 'Add at least one media asset — an image or a YouTube video.';
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

  // ── Objective-specific ad group fields ────────────────────────────────────
  const SEARCH_OBJECTIVES = new Set(['SALES', 'LEADS', 'WEBSITE_TRAFFIC', 'SEARCH', 'LOCAL_STORE']);
  if (SEARCH_OBJECTIVES.has(channel)) {
    const hasKeyword = form.keywords?.some((k) => !isBlank(k.text));
    if (!hasKeyword) e.keywords = 'Add at least one keyword.';
  }

  if (channel === 'DISPLAY') {
    if (!isBlank(form.frequencyCap) && toNumber(form.frequencyCap) < 1)
      e.frequencyCap = 'Frequency cap must be at least 1.';
  }

  const BIDDING_CHANNELS = new Set(['SALES', 'LEADS', 'WEBSITE_TRAFFIC', 'SEARCH', 'LOCAL_STORE', 'DISPLAY']);
  if (BIDDING_CHANNELS.has(channel)) {
    if (form.biddingGoal === 'TARGET_CPA') {
      if (isBlank(form.targetCpa) || !isPositive(form.targetCpa))
        e.targetCpa = 'Target CPA amount is required and must be positive.';
    }
    if (form.biddingGoal === 'TARGET_ROAS') {
      if (isBlank(form.targetRoas) || !isPositive(form.targetRoas))
        e.targetRoas = 'Target ROAS % is required and must be positive.';
    }
  }

  return e;
}

// ── Ad ─────────────────────────────────────────────────────────────────────────
function validateAd(form, adType) {
  const e = {};

  if (adType === 'SEARCH') {
    const heads = (form.headlines || []).filter((h) => h && h.trim());
    const uniqueHeads = [...new Set(heads.map((h) => h.trim().toLowerCase()))];
    if (heads.length < 3) {
      e.headlines = 'At least 3 headlines are required.';
    } else if (heads.length > 15) {
      e.headlines = 'At most 15 headlines are allowed.';
    } else if (uniqueHeads.length < heads.length) {
      e.headlines = 'Headlines must be unique — remove duplicate entries.';
    } else {
      const long = heads.find((h) => h.length > 30);
      if (long) e.headlines = `Headline "${long.slice(0, 20)}…" exceeds 30 characters.`;
    }

    const descs = (form.descriptions || []).filter((d) => d && d.trim());
    const uniqueDescs = [...new Set(descs.map((d) => d.trim().toLowerCase()))];
    if (descs.length < 2) {
      e.descriptions = 'At least 2 descriptions are required.';
    } else if (descs.length > 4) {
      e.descriptions = 'At most 4 descriptions are allowed.';
    } else if (uniqueDescs.length < descs.length) {
      e.descriptions = 'Descriptions must be unique — remove duplicate entries.';
    } else {
      const long = descs.find((d) => d.length > 90);
      if (long) e.descriptions = `Description "${long.slice(0, 20)}…" exceeds 90 characters.`;
    }

    if (isBlank(form.finalUrl)) {
      e.finalUrl = 'Landing page URL is required.';
    } else if (!isHttpUrl(form.finalUrl)) {
      e.finalUrl = 'Enter a valid URL (https://…).';
    } else {
      const domainErr = validateFinalUrlDomain(form.finalUrl, form.websiteUrl);
      if (domainErr) e.finalUrl = domainErr;
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
    } else {
      const domainErr = validateFinalUrlDomain(form.finalUrl, form.websiteUrl);
      if (domainErr) e.finalUrl = domainErr;
    }
  }

  if (adType === 'DEMAND_GEN') {
    const effectiveVideoUrl = form.videoUrl?.startsWith('blob:') ? '' : (form.videoUrl || '');
    const videoUploading = form.videoUrl?.startsWith('blob:'); // upload in progress — YouTube URL coming
    if (!videoUploading && isBlank(effectiveVideoUrl) && isBlank(form.youtubeVideoId)) {
      e.videoUrl = 'A YouTube URL or video ID is required.';
    }

    if (isBlank(form.finalUrl)) {
      e.finalUrl = 'Landing page URL is required.';
    } else if (!isHttpUrl(form.finalUrl)) {
      e.finalUrl = 'Enter a valid URL (https://…).';
    } else {
      const domainErr = validateFinalUrlDomain(form.finalUrl, form.websiteUrl);
      if (domainErr) e.finalUrl = domainErr;
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

// ── Goal ───────────────────────────────────────────────────────────────────────
function validateGoal(form, schema) {
  const goals = schema?.objectiveGoals?.[form.objective] || [];
  if (!goals.length) return {};
  if (isBlank(form.goal)) return { goal: 'Select a conversion goal to continue.' };
  return {};
}

// ── Audience ───────────────────────────────────────────────────────────────────
function validateAudience(form) {
  const e = {};
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
  return e;
}

// ── Budget ─────────────────────────────────────────────────────────────────────
function validateBudget(form) {
  const e = {};
  if (form.budgetType === 'CAMPAIGN_TOTAL') {
    if (isBlank(form.lifetimeBudget)) {
      e.lifetimeBudget = 'Campaign total budget is required.';
    } else if (!isPositive(form.lifetimeBudget)) {
      e.lifetimeBudget = 'Campaign total budget must be a positive amount.';
    }
    if (isBlank(form.startDate)) {
      e.startDate = 'A start date is required for campaign total budget.';
    }
    if (isBlank(form.endDate)) {
      e.endDate = 'An end date is required for campaign total budget.';
    }
  } else {
    if (isBlank(form.dailyBudget)) {
      e.dailyBudget = 'Daily budget is required.';
    } else if (!isPositive(form.dailyBudget)) {
      e.dailyBudget = 'Daily budget must be a positive amount.';
    } else if (toNumber(form.dailyBudget) * 1_000_000 < 10_000) {
      e.dailyBudget = 'Daily budget must be at least ₹0.01 per day.';
    }
  }

  return e;
}

/**
 * Validate one wizard step.
 * @param {string} stepId   'objective' | 'destination' | 'goal' | 'campaign' | 'audience' | 'budget' | 'adGroup' | 'ad' | 'review'
 * @param {object} form     current form state
 * @param {string} adType   'SEARCH' | 'DISPLAY' | 'DEMAND_GEN' (required for ad step)
 * @param {object} schema   wizard schema from server
 */
export function validateStep(stepId, form, adType, schema) {
  switch (stepId) {
    case 'objective':    return { ...validateObjective(form), ...validateGoal(form, schema) };
    case 'destination':  return validateDestination(form, schema);
    case 'campaign':     return {
      ...validateObjective(form),
      ...validateDestination(form, schema),
      ...validateGoal(form, schema),
      ...validateCampaign(form),
      ...validateBudget(form),
    };
    case 'assets':       return validateAssets(form);
    case 'adGroup':      return { ...validateAdGroup(form), ...validateAudience(form) };
    case 'ad':           return effectiveChannel(form) === 'SHOPPING' ? {} : validateAd(form, adType || deriveAdType(effectiveChannel(form)));
    case 'review':       return {};
    default:             return {};
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
