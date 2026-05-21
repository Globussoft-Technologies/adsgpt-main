/**
 * CreateCampaignWizardV2 — config-driven wizard for the 3 migrated objectives
 * (Traffic / Leads / App Promotion).
 *
 * The renderer fetches `/meta-ads/wizard-schema` once at mount and drives
 * EVERY decision from the response — optimisation goals, billing events,
 * CTAs, required fields, sandbox banners. No per-objective branching code
 * lives here; all branching is in `nodejs-backend/config/wizardSchema.js`.
 *
 * Step flow:
 *   0. Objective                  — pick from schema.objectives
 *   1. Conversion Location        — pick a cell within the objective
 *   2. Campaign                   — name, budget (CBO), categories, status
 *   3. Ad Set                     — name, page, optimisation, billing,
 *                                   targeting, schedule, budget (if not CBO),
 *                                   plus cell.additionalFields (App Promo)
 *   4. (cell.additionalSteps)     — Lead Form picker for Leads/Instant Form
 *                                   (Phase 3 stub for now)
 *   5. Ad                         — name, image, copy, CTA, optional
 *                                   destination/deep-link fields per cell
 *   6. Review                     — summary + Launch
 *
 * Idempotent retry via `created = { campaignId, adSetId, imageHash,
 * leadFormId }`. If a step fails mid-launch, retry re-runs only the
 * failing step.
 *
 * V1 (CreateCampaignWizard.jsx) is untouched — both wizards coexist
 * behind VITE_FEATURE_WIZARD_V2 until cutover. V1 keeps serving the
 * un-migrated objectives.
 */

import React, { useEffect, useMemo, useState, useCallback } from 'react';
// eslint-disable-next-line no-unused-vars -- motion is used as <motion.div> below; the project's lint rule doesn't track JSX dotted access.
import { motion, AnimatePresence } from 'framer-motion';
import { FaMeta } from 'react-icons/fa6';
import {
  AlertCircle,
  Check,
  ChevronLeft,
  ChevronRight,
  Eye,
  Globe2,
  Image as ImageIcon,
  Layers,
  Loader2,
  MapPin,
  Megaphone,
  MousePointerClick,
  Rocket,
  Smartphone,
  Target,
  UserPlus,
  X,
} from 'lucide-react';
import {
  getWizardSchemaV2,
  getMetaPages,
  getMetaSavedAudiences,
  getLeadForms,
  createLeadForm,
  getPixels,
  getPixelEvents,
  createPixel,
  getPromotableApps,
  uploadMetaAdImage,
  uploadMetaAdVideo,
  createMetaCampaignV2,
  createMetaAdSetV2,
  createMetaAdV2,
} from '@/apis/metaAds/metaAdsApi';
import { globalToast } from '@/utils/globalToast';
import LibraryPicker from './LibraryPicker';
import {
  FieldShell,
  TextField,
  TextAreaField,
  CurrencyField,
  SelectField,
  MultiSelectField,
  ToggleField,
  RangeField,
  ImageField,
  VideoField,
  SegButton,
  SegGroup,
  GradientCheckbox,
  DateTimePicker,
  LaunchErrorBanner,
  WizardCard,
} from './wizardFields';
import {
  validateStep,
  validateAllSteps,
  CAPPED_BID_STRATEGIES,
} from './wizardValidation';
import LocationTargeting from './LocationTargeting';

// ─── Constants ───────────────────────────────────────────────────────────────

// Country/city/region picking now lives in the LocationTargeting
// component, which calls the backend `/meta-ads/search-geo` endpoint
// (Meta's full adgeolocation catalogue). The legacy 10-country shortlist
// here was removed when that landed. Taiwan + Singapore are filtered out
// of the search-geo results server-side — they need per-country
// regulatory declarations the V2 wizard doesn't yet implement.

const COMMON_LOCALES = [
  { value: 6, label: 'English (US)' },
  { value: 24, label: 'English (UK)' },
  { value: 9, label: 'Spanish' },
  { value: 5, label: 'German' },
  { value: 8, label: 'French' },
  { value: 26, label: 'Portuguese' },
  { value: 22, label: 'Hindi' },
  { value: 7, label: 'Arabic' },
];

const GENDERS = [
  { value: 1, label: 'Men' },
  { value: 2, label: 'Women' },
];

// Meta's current Special Ad Categories — exactly the 4 Meta now offers,
// in Meta's wording and order. "Credit" is folded into "Financial
// products and services"; gambling/gaming is no longer a special ad
// category. Keep in sync with SPECIAL_AD_CATEGORIES in meta.v2.validator.js.
const SPECIAL_AD_CATEGORIES = [
  { value: 'FINANCIAL_PRODUCTS_SERVICES', label: 'Financial products and services' },
  { value: 'EMPLOYMENT', label: 'Employment' },
  { value: 'HOUSING', label: 'Housing' },
  { value: 'ISSUES_ELECTIONS_POLITICS', label: 'Social issues, elections or politics' },
];

const BID_STRATEGIES = [
  { value: 'LOWEST_COST_WITHOUT_CAP', label: 'Highest volume (lowest cost)' },
  { value: 'LOWEST_COST_WITH_BID_CAP', label: 'Bid cap' },
  { value: 'COST_CAP', label: 'Cost cap' },
];
// CAPPED_BID_STRATEGIES is imported from wizardValidation.js — single
// source of truth shared by the renderer and the validation engine.

const MOBILE_APP_STORES = [
  { value: 'APPLE_APP_STORE', label: 'Apple App Store' },
  { value: 'GOOGLE_PLAY', label: 'Google Play' },
];

const OBJECTIVE_ICONS = {
  OUTCOME_TRAFFIC: MousePointerClick,
  OUTCOME_LEADS: UserPlus,
  OUTCOME_APP_PROMOTION: Smartphone,
};

const CONVERSION_LOCATION_ICONS = {
  WEBSITE: Globe2,
  APP: Smartphone,
  MESSENGER: MousePointerClick,
  WHATSAPP: MousePointerClick,
  PHONE_CALL: MousePointerClick,
  INSTANT_FORM: UserPlus,
};

// Steps that are always present. `leadForm` is inserted between AdSet
// and Ad for cells whose schema lists it in additionalSteps.
const BASE_STEPS = [
  { id: 'objective', label: 'Objective', icon: Target },
  { id: 'conversionLocation', label: 'Destination', icon: MapPin },
  { id: 'campaign', label: 'Campaign', icon: Eye },
  { id: 'adSet', label: 'Ad Set', icon: Layers },
  { id: 'ad', label: 'Ad', icon: ImageIcon },
  { id: 'review', label: 'Review', icon: Check },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

// "COMPLETE_REGISTRATION" → "Complete Registration". Meta's
// promoted_object.custom_event_type uses SCREAMING_SNAKE values; the
// wizard prettifies for display while sending the raw enum.
function prettifyEventType(snake) {
  if (!snake) return '';
  return String(snake)
    .split('_')
    .map((w) => (w ? w[0] + w.slice(1).toLowerCase() : w))
    .join(' ');
}

// Meta budgets are minor currency units (paise/cents). Wizard inputs are
// major units; convert at submit time.
const majorToMinor = (n) => {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? Math.round(v * 100) : undefined;
};

// Pick the schema's cell for the current (objective, conversionLocation).
function pickCell(schema, objective, conversionLocation) {
  if (!schema || !objective || !conversionLocation) return null;
  return schema.objectives?.[objective]?.conversionLocations?.[conversionLocation] || null;
}

// Build the dynamic list of steps for the current cell. A cell's
// `additionalSteps` array (e.g. ["leadForm"]) inserts extra steps
// between AdSet and Ad.
function buildSteps(cell) {
  if (!cell) return BASE_STEPS;
  const extra = (cell.additionalSteps || []).map((id) => {
    if (id === 'leadForm') return { id: 'leadForm', label: 'Lead Form', icon: UserPlus };
    return { id, label: id, icon: Layers };
  });
  // Insert extras between adSet (index 3) and ad (index 4).
  return [
    ...BASE_STEPS.slice(0, 4),
    ...extra,
    ...BASE_STEPS.slice(4),
  ];
}

// Initial form state. Default values match the schema's defaults where
// derivable; cell-specific defaults (optimisationGoal, CTA) get filled
// in the effect that runs when conversionLocation changes.
function buildInitialForm() {
  return {
    // Step 0
    objective: '',
    // Step 1
    conversionLocation: '',
    // Step 2 — Campaign
    campaignName: '',
    specialAdCategories: [],
    cbo: false,
    campaignBudgetType: 'daily',
    campaignBudget: '',
    spendCap: '', // optional total campaign cap (auto-pause when reached)
    iosOptimised: false, // iOS 14+ / SKAdNetwork — App Promotion only
    // Step 3 — Ad Set
    adSetName: '',
    pageId: '',
    instagramUserId: '',
    // DSA disclosure — auto-filled from the selected Page's name when the
    // user picks a Page (so users in EU/EEA don't have to know this exists).
    // Override only if the legal advertising entity differs from the Page.
    dsaBeneficiary: '',
    dsaPayor: '',
    optimizationGoal: '',
    billingEvent: '',
    bidStrategy: 'LOWEST_COST_WITHOUT_CAP',
    bidAmount: '',
    adSetBudgetType: 'daily',
    adSetBudget: '',
    dynamicCreative: false, // Meta auto-mixes creative variations
    attributionWindow: '', // empty = Meta picks the right default for the cell
    startTime: '',
    endTime: '',
    hasEndTime: false,
    useSavedAudience: false,
    savedAudienceId: '',
    worldwide: false,
    // Locations replaces the legacy `countries: ['IN']` model. See the
    // LocationTargeting component + LOCATION_TARGETING_PLAN.md. Each
    // entry: { type, key, name, mode, radius?, distanceUnit? }.
    locations: [{ type: 'country', key: 'IN', name: 'India', mode: 'include' }],
    ageMin: 18,
    ageMax: 65,
    genders: [],
    locales: [],
    advantageAudience: true,
    // Placements
    placementMode: 'advantage_plus', // 'advantage_plus' | 'manual'
    publisherPlatforms: [], // active when placementMode === 'manual'
    devicePlatforms: [], // empty = all (Meta default)
    // App Promotion-only adset fields
    mobileAppStore: '',
    applicationId: '',
    objectStoreUrl: '',
    // Pixel-using cells (Leads/Website, Multiple) — picked at AdSet step
    pixelId: '',
    pixelEventType: '',
    // Step 4 (conditional) — Lead Form
    leadFormId: '',
    leadFormMode: 'pick', // 'pick' (use existing) | 'build' (create new)
    // Builder fields (used when leadFormMode === 'build')
    leadFormName: '',
    leadFormGreetingTitle: '',
    leadFormGreetingBody: '',
    leadFormQuestions: ['EMAIL', 'PHONE'], // sensible default — most common
    leadFormPrivacyUrl: '',
    leadFormPrivacyText: '',
    leadFormThankYouTitle: '',
    leadFormThankYouBody: '',
    leadFormThankYouLinkUrl: '',
    leadFormThankYouButtonText: '',
    // Step 5 — Ad
    adName: '',
    // Media — exactly one path is active at a time. mediaType drives the
    // SegGroup on the Ad step; the inactive set is sent as undefined on
    // handleLaunch so the backend's xor validator stays happy.
    mediaType: 'image', // 'image' | 'video'
    imageFile: null,
    imageUrl: null,
    videoFile: null,
    videoUrl: null,
    videoThumbnailUrl: null,
    headline: '',
    primaryText: '',
    description: '',
    linkUrl: '',
    urlTags: '',
    callToAction: '',
    deferredDeepLink: '',
    customProductPage: '',
    autoTranslate: false, // auto-translate ad copy into viewer language
  };
}

// ─── Step rail ───────────────────────────────────────────────────────────────

function StepRail({ steps, currentIndex }) {
  return (
    <div className="flex items-center gap-1 overflow-x-auto 2xl:gap-1.5">
      {steps.map((s, i) => {
        const Icon = s.icon;
        const done = i < currentIndex;
        const active = i === currentIndex;
        return (
          <React.Fragment key={s.id}>
            <div
              className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium transition-all shrink-0 2xl:px-3 2xl:py-1.5 2xl:text-sm ${
                active
                  ? 'bg-gradient-to-r from-[#02C8C4] to-[#5867EB] text-white'
                  : done
                  ? 'border border-emerald-400/30 bg-emerald-400/10 text-emerald-300'
                  : 'border border-white/8 bg-white/3 text-white/30'
              }`}
            >
              {done ? (
                <Check className="h-3 w-3 2xl:h-3.5 2xl:w-3.5" />
              ) : (
                <Icon className="h-3 w-3 2xl:h-3.5 2xl:w-3.5" />
              )}
              <span className="hidden sm:inline">{s.label}</span>
            </div>
            {i < steps.length - 1 && (
              <div
                className={`h-0.5 w-2 2xl:w-3 shrink-0 ${
                  i < currentIndex ? 'bg-emerald-400/30' : 'bg-white/15'
                }`}
              />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export default function CreateCampaignWizardV2({ open, onClose, adAccountId, account, onCreated }) {
  const [schema, setSchema] = useState(null);
  const [schemaDefaults, setSchemaDefaults] = useState({});
  const [schemaLoading, setSchemaLoading] = useState(true);
  const [schemaError, setSchemaError] = useState(null);

  const [form, setForm] = useState(buildInitialForm);
  const [stepIndex, setStepIndex] = useState(0);
  // Fields the user has interacted with — an inline error only shows once
  // a field is touched (Meta-style: don't scream errors before they type).
  // A failed "Continue" / "Launch" attempt marks every offending field
  // touched so the whole step's errors reveal at once.
  const [touched, setTouched] = useState({});

  // Step-cache for idempotent retry — see CreateCampaignWizard.jsx (V1).
  const [created, setCreated] = useState({});
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState(null);

  // Discard-confirm overlay state — prevents accidental data loss when the
  // user clicks the close button or backdrop on a dirty wizard.
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

  // Lookups populated from the existing /meta-ads endpoints.
  const [pages, setPages] = useState([]);
  const [savedAudiences, setSavedAudiences] = useState([]);

  // Reset everything when the modal opens (matches V1 behaviour).
  useEffect(() => {
    if (!open) return;
    setForm(buildInitialForm());
    setStepIndex(0);
    setTouched({});
    setCreated({});
    setLaunchError(null);
    setShowDiscardConfirm(false);
  }, [open]);

  // Fetch schema once on mount.
  useEffect(() => {
    if (!open) return;
    setSchemaLoading(true);
    setSchemaError(null);
    getWizardSchemaV2()
      .then((r) => {
        if (!r?.enabled) {
          setSchemaError('Wizard V2 is disabled on the server. Set FEATURE_WIZARD_V2=true on the backend.');
        }
        setSchema(r?.schema || null);
        setSchemaDefaults(r?.defaults || {});
      })
      .catch((e) => {
        setSchemaError(e?.response?.data?.error || e.message);
      })
      .finally(() => setSchemaLoading(false));
  }, [open]);

  // Load pages + saved audiences when the modal opens.
  useEffect(() => {
    if (!open || !adAccountId) return;
    getMetaPages(adAccountId)
      .then((r) => setPages(r?.pages || []))
      .catch(() => setPages([]));
    getMetaSavedAudiences(adAccountId)
      .then((r) => setSavedAudiences(r?.savedAudiences || []))
      .catch(() => setSavedAudiences([]));
  }, [open, adAccountId]);

  // Whenever conversionLocation changes, apply cell defaults to the form.
  const cell = useMemo(
    () => pickCell(schema, form.objective, form.conversionLocation),
    [schema, form.objective, form.conversionLocation],
  );

  useEffect(() => {
    if (!cell) return;
    setForm((prev) => {
      const next = {
        ...prev,
        optimizationGoal: cell.adSet?.defaultOptimizationGoal || '',
        billingEvent: cell.adSet?.defaultBillingEvent || '',
        callToAction: cell.ctas?.default || '',
      };
      // App Promotion: applicationId comes from server config (env var),
      // not from the user. Always overwrite — if config changes, the
      // wizard picks it up on next open.
      if (cell.adSet?.additionalFields?.includes('applicationId')) {
        next.applicationId = schemaDefaults?.appPromotion?.applicationId || '';
      }
      return next;
    });
  }, [cell, schemaDefaults]);

  const steps = useMemo(() => buildSteps(cell), [cell]);
  const currentStep = steps[stepIndex];

  // Account-derived validation limits — Meta's per-currency floors. Meta
  // reports them in minor units (see getAdAccountsList); /100 → major
  // units to match the wizard's budget inputs.
  const valCtx = useMemo(
    () => ({
      minSpendCap: (account?.minCampaignSpendCap || 0) / 100,
      minDailyBudget: (account?.minDailyBudget || 0) / 100,
      currency: account?.currency || '',
    }),
    [account],
  );

  // Errors for the current step ({ field: message }) and for every
  // pre-Review step ({ stepId: { field: message } }). The first gates
  // "Continue" + drives inline + summary errors; the second gates Launch.
  const stepErrors = useMemo(
    () => validateStep(currentStep?.id, form, cell, valCtx),
    [currentStep, form, cell, valCtx],
  );
  const allStepErrors = useMemo(
    () => validateAllSteps(steps, form, cell, valCtx),
    [steps, form, cell, valCtx],
  );
  const hasBlockingErrors = Object.keys(allStepErrors).length > 0;

  // Errors filtered to fields the user has already touched — what the
  // current step actually shows inline / in its summary.
  const visibleStepErrors = useMemo(() => {
    const out = {};
    for (const [field, msg] of Object.entries(stepErrors)) {
      if (touched[field]) out[field] = msg;
    }
    return out;
  }, [stepErrors, touched]);

  // Mark form fields as touched so their errors become visible.
  const touchFields = useCallback((fields) => {
    if (!fields || !fields.length) return;
    setTouched((t) => {
      const next = { ...t };
      for (const f of fields) next[f] = true;
      return next;
    });
  }, []);

  // Every patched field counts as touched — so editing a field (even
  // clearing it) reveals its validation state immediately.
  const update = useCallback((patch) => {
    setForm((p) => ({ ...p, ...patch }));
    setTouched((t) => {
      const next = { ...t };
      for (const k of Object.keys(patch)) next[k] = true;
      return next;
    });
  }, []);

  const goNext = () => {
    // Block advancing on an invalid step — reveal every error first.
    if (Object.keys(stepErrors).length > 0) {
      touchFields(Object.keys(stepErrors));
      return;
    }
    if (stepIndex < steps.length - 1) {
      setStepIndex(stepIndex + 1);
    }
  };
  const goBack = () => {
    if (stepIndex > 0) setStepIndex(stepIndex - 1);
  };

  const handleLaunch = async () => {
    setLaunching(true);
    setLaunchError(null);
    try {
      // ── Campaign ──
      let campaignId = created.campaignId;
      if (!campaignId) {
        const campPayload = {
          adAccountId,
          name: form.campaignName,
          objective: form.objective,
          specialAdCategories: form.specialAdCategories,
          status: 'PAUSED',
        };
        if (form.cbo) {
          const budget = majorToMinor(form.campaignBudget);
          if (form.campaignBudgetType === 'daily') campPayload.dailyBudget = budget;
          else campPayload.lifetimeBudget = budget;
          campPayload.bidStrategy = form.bidStrategy;
        }
        if (form.spendCap) campPayload.spendCap = majorToMinor(form.spendCap);
        // When a Special Ad Category is set, Meta requires
        // `special_ad_category_country` — derive from the user's chosen
        // locations so it's automatically consistent with the ad set's
        // geo targeting (avoids subcode 2909034). Each location entry
        // carries `countryCode` for cities/regions/areas; country
        // entries use `key` (which IS the 2-letter code).
        if (form.specialAdCategories?.length) {
          const codes = new Set();
          for (const l of form.locations || []) {
            if (l?.mode !== 'include') continue;
            if (l.type === 'country' && l.key) codes.add(l.key.toUpperCase());
            else if (l.countryCode) codes.add(l.countryCode.toUpperCase());
          }
          if (codes.size > 0) {
            campPayload.specialAdCategoryCountries = Array.from(codes);
          }
        }
        // iOS 14+ campaigns bind the app on the CAMPAIGN (not the ad set).
        // Meta uses this `promoted_object` for SKAdNetwork attribution
        // and requires the campaign-level binding before any ad set is
        // created. The Ad Set step still echoes mobileAppStore /
        // applicationId / objectStoreUrl back to the backend for the
        // ad-set-level validator + targeting (user_os: iOS), so we
        // keep that data on the ad set payload too.
        if (form.iosOptimised) {
          campPayload.iosOptimised = true;
          campPayload.applicationId = form.applicationId;
          campPayload.objectStoreUrl = form.objectStoreUrl;
        }
        const r = await createMetaCampaignV2(campPayload);
        campaignId = r.campaign.id;
        setCreated((p) => ({ ...p, campaignId }));
      }

      // ── Ad Set ──
      let adSetId = created.adSetId;
      if (!adSetId) {
        const adSetPayload = {
          adAccountId,
          campaignId,
          objective: form.objective,
          conversionLocation: form.conversionLocation,
          pageId: form.pageId,
          name: form.adSetName,
          optimizationGoal: form.optimizationGoal,
          billingEvent: form.billingEvent,
          bidStrategy: form.bidStrategy,
          targeting: {
            // Worldwide is a separate mode that overrides the locations
            // list; the backend treats it as "global minus TW/SG".
            locations: form.worldwide ? [] : form.locations,
            worldwide: form.worldwide,
            ageMin: form.ageMin,
            ageMax: form.ageMax,
            genders: form.genders,
            locales: form.locales,
            advantageAudience: form.advantageAudience,
            placementMode: form.placementMode,
            publisherPlatforms: form.placementMode === 'manual' ? form.publisherPlatforms : [],
            devicePlatforms: form.devicePlatforms,
          },
          status: 'PAUSED',
        };
        if (form.instagramUserId) adSetPayload.instagramUserId = form.instagramUserId;
        // DSA — Meta requires `dsa_beneficiary` on every ad set globally
        // as of 2024. Fall back to the page name if the user didn't touch
        // the field so launch never fails with subcode 3858081.
        const beneficiary =
          form.dsaBeneficiary?.trim() ||
          pages.find((p) => p.id === form.pageId)?.name ||
          '';
        if (beneficiary) {
          adSetPayload.dsaBeneficiary = beneficiary;
          if (form.dsaPayor?.trim()) adSetPayload.dsaPayor = form.dsaPayor.trim();
        }
        if (!form.cbo) {
          const budget = majorToMinor(form.adSetBudget);
          if (form.adSetBudgetType === 'daily') adSetPayload.dailyBudget = budget;
          else adSetPayload.lifetimeBudget = budget;
        }
        if (form.bidAmount) adSetPayload.bidAmount = majorToMinor(form.bidAmount);
        if (form.dynamicCreative) adSetPayload.dynamicCreative = true;
        // Only send when explicitly chosen — empty means "let Meta pick".
        // Different cells accept different windows (Meta error 1885501
        // tells us which); skipping the field is always safe.
        if (form.attributionWindow) adSetPayload.attributionWindow = form.attributionWindow;
        if (form.startTime) adSetPayload.startTime = new Date(form.startTime).toISOString();
        if (form.hasEndTime && form.endTime) {
          adSetPayload.endTime = new Date(form.endTime).toISOString();
        }
        if (form.useSavedAudience && form.savedAudienceId) {
          adSetPayload.savedAudienceId = form.savedAudienceId;
        }
        // App Promotion adset fields
        if (cell.adSet.additionalFields?.includes('mobileAppStore')) {
          adSetPayload.mobileAppStore = form.mobileAppStore;
        }
        if (cell.adSet.additionalFields?.includes('applicationId')) {
          adSetPayload.applicationId = form.applicationId;
        }
        if (cell.adSet.additionalFields?.includes('objectStoreUrl')) {
          adSetPayload.objectStoreUrl = form.objectStoreUrl;
        }
        // Pixel cells (Leads/Website + Multiple)
        if (cell.adSet.additionalFields?.includes('pixelId')) {
          adSetPayload.pixelId = form.pixelId;
        }
        if (cell.adSet.additionalFields?.includes('pixelEventType')) {
          adSetPayload.pixelEventType = form.pixelEventType;
        }

        const r = await createMetaAdSetV2(adSetPayload);
        adSetId = r.adSet.id;
        setCreated((p) => ({ ...p, adSetId }));
      }

      // ── Media upload (image OR video) ──
      // Idempotent retry: `created.imageHash` / `created.videoId` are
      // cached after a successful upload so a re-launch only re-runs the
      // failing step. Branches strictly on mediaType so we never upload
      // both.
      let imageHash = created.imageHash;
      let videoId = created.videoId;
      // Prefer the auto-thumbnail Meta extracted during upload over a
      // form value that's only set if the user manually overrode it.
      // Falls back to whatever the user typed.
      let videoThumb = form.videoThumbnailUrl || null;
      if (form.mediaType === 'video') {
        if (!videoId) {
          const r = await uploadMetaAdVideo({
            adAccountId,
            video: form.videoFile,
            videoUrl: form.videoUrl,
          });
          videoId = r.videoId;
          if (!videoId) {
            throw new Error("Video upload succeeded but no id was returned");
          }
          // If the backend got an auto-thumbnail from Meta on upload,
          // it's almost always what the user wants — surface it on the
          // form so the field shows the value, and use it as the
          // default for the launch payload. User overrides take
          // priority.
          if (!form.videoThumbnailUrl && r.thumbnailUrl) {
            update({ videoThumbnailUrl: r.thumbnailUrl });
            videoThumb = r.thumbnailUrl;
          }
          setCreated((p) => ({ ...p, videoId }));
        }
        // Clear any stale image hash so a user who flipped tabs mid-flow
        // doesn't accidentally send both.
        imageHash = undefined;
      } else {
        if (!imageHash) {
          const r = await uploadMetaAdImage({
            adAccountId,
            image: form.imageFile,
            imageUrl: form.imageUrl,
          });
          imageHash = r.imageHash;
          if (!imageHash) {
            throw new Error("Image upload succeeded but no hash was returned");
          }
          setCreated((p) => ({ ...p, imageHash }));
        }
        videoId = undefined;
      }

      // ── Ad creative + Ad ──
      const adPayload = {
        adAccountId,
        adSetId,
        objective: form.objective,
        conversionLocation: form.conversionLocation,
        pageId: form.pageId,
        name: form.adName,
        headline: form.headline,
        primaryText: form.primaryText,
        description: form.description,
        callToAction: form.callToAction,
        status: 'PAUSED',
      };
      if (form.mediaType === 'video') {
        adPayload.videoId = videoId;
        adPayload.videoThumbnailUrl = videoThumb;
      } else {
        adPayload.imageHash = imageHash;
      }
      if (form.instagramUserId) adPayload.instagramUserId = form.instagramUserId;
      if (cell.ad.requiredFields?.includes('linkUrl') || cell.ad.optionalFields?.includes('linkUrl')) {
        // Trim so a stray space from a paste doesn't get past frontend
        // validation (which trims) only to fail backend Joi (which
        // doesn't, by default).
        const trimmed = String(form.linkUrl || '').trim();
        if (trimmed) adPayload.linkUrl = trimmed;
      }
      if (form.urlTags) adPayload.urlTags = form.urlTags;
      if (form.autoTranslate) adPayload.autoTranslate = true;
      // Send leadFormId for any cell that requires it (Single Instant Form
      // AND Multiple cells that combine Instant Form with website/messenger).
      // Was previously only checking shape === 'lead_gen_form' — missed the
      // 'lead_gen_form_with_pixel' shape used by the Multiple cells.
      if (cell.ad.requiredFields?.includes('leadFormId')) {
        adPayload.leadFormId = form.leadFormId;
      }
      if (cell.ad.objectStorySpecShape === 'app_link') {
        // Both are resent from the AdSet step. The backend needs
        // applicationId for the CTA's `value.application` field (Meta
        // requirement for INSTALL_MOBILE_APP) and objectStoreUrl for
        // both link_data.link and the CTA's value.link.
        adPayload.objectStoreUrl = form.objectStoreUrl;
        adPayload.applicationId = form.applicationId;
        if (form.deferredDeepLink) adPayload.deferredDeepLink = form.deferredDeepLink;
        if (form.customProductPage) adPayload.customProductPage = form.customProductPage;
      }

      await createMetaAdV2(adPayload);

      globalToast.success('Campaign launched (PAUSED). Activate it from the Campaigns tab.');
      onCreated?.();
      onClose?.();
    } catch (e) {
      // Preserve the WHOLE backend payload (error, details, meta.code/
      // subcode/fbtraceId) so the banner can show diagnostic info. Falls
      // back to a plain string when the error wasn't a structured HTTP
      // response (network failure, etc.).
      const data = e?.response?.data;
      if (data && typeof data === 'object') {
        setLaunchError({
          title: data.error || 'Launch failed',
          details: data.details || data.error || '',
          code: data.meta?.code,
          subcode: data.meta?.subcode,
          fbtraceId: data.meta?.fbtraceId,
        });
      } else {
        setLaunchError({
          title: 'Launch failed',
          details: e?.message || 'Something went wrong',
        });
      }
    } finally {
      setLaunching(false);
    }
  };

  if (!open) return null;

  // Dirty check — used to decide whether closing the modal needs a confirm.
  // Anything the user might have typed counts; the objective/conversion-
  // location picks alone don't (one click to redo).
  const isDirty =
    form.campaignName?.trim() ||
    form.adSetName?.trim() ||
    form.adName?.trim() ||
    form.headline?.trim() ||
    form.primaryText?.trim() ||
    form.linkUrl?.trim() ||
    form.imageFile ||
    form.imageUrl ||
    form.pageId;
  const requestClose = () => {
    if (launching) return;
    if (isDirty && !Object.keys(created).length) {
      setShowDiscardConfirm(true);
    } else {
      onClose?.();
    }
  };
  const confirmDiscard = () => {
    setShowDiscardConfirm(false);
    onClose?.();
  };

  return (
    <AnimatePresence>
      <motion.div
        key="backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex items-center justify-center px-4"
      >
        <motion.div
          key="modal"
          initial={{ scale: 0.96, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.96, opacity: 0 }}
          transition={{ duration: 0.18 }}
          onClick={(e) => e.stopPropagation()}
          className="relative w-full max-w-5xl max-h-[90vh] rounded-2xl border border-white/10 bg-[#141414] shadow-2xl flex flex-col overflow-hidden"
        >
          {/* Close button — pinned to the top-right corner of the modal so
              it's always reachable regardless of the header content. */}
          <button
            type="button"
            onClick={requestClose}
            disabled={launching}
            aria-label="Close"
            className="absolute right-3 top-3 z-20 flex h-7 w-7 items-center justify-center rounded-md text-white/55 transition-colors hover:bg-white/8 hover:text-white disabled:opacity-30 2xl:h-8 2xl:w-8"
          >
            <X className="h-4 w-4 2xl:h-5 2xl:w-5" />
          </button>

          {/* Header — gradient icon tile + Posting-to pill + StepRail. */}
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-white/12 bg-white/3 px-3 py-2.5 pr-12 sm:gap-3 sm:px-5 sm:py-3 sm:pr-14 2xl:px-6 2xl:py-4 2xl:pr-16">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-r from-[#02C8C4] to-[#5867EB] ring-1 ring-white/10 2xl:h-12 2xl:w-12">
                <Megaphone className="h-[18px] w-[18px] text-white 2xl:h-6 2xl:w-6" />
              </div>
              <div>
                <p className="text-sm font-bold text-white 2xl:text-lg">
                  New Campaign
                  <span className="ml-2 inline-flex items-center rounded-full border border-[#15DCFF]/30 bg-[#15DCFF]/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-[#15DCFF] 2xl:text-[10px]">
                    V2
                  </span>
                </p>
                <div className="mt-0.5 flex items-center gap-1.5">
                  <span className="text-[11px] text-white/60 2xl:text-xs">Posting to</span>
                  <span className="inline-flex rounded-[6px] bg-gradient-to-r from-[#02C8C4] to-[#5867EB] p-px transition-all">
                    <span className="rounded-[5px] bg-[#141414] px-2 py-1 text-[11px] font-bold leading-tight text-white 2xl:text-xs">
                      {account?.name || `act_${adAccountId || '—'}`}
                    </span>
                  </span>
                  {account?.currency && (
                    <span className="font-mono text-[11px] text-white/45 2xl:text-xs">
                      · {account.currency}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <StepRail steps={steps} currentIndex={stepIndex} />
          </div>

          {/* Body — scrollable form on the left, validation rail on the right */}
          <div className="flex min-h-0 flex-1">
            <div className="scrollbar-thin flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5 2xl:px-8 2xl:py-8">
              {schemaLoading && (
                <div className="flex items-center justify-center py-12 gap-3 text-white/60">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading wizard schema…
                </div>
              )}
              {schemaError && (
                <LaunchErrorBanner
                  error={{ title: 'Could not load wizard schema', details: schemaError }}
                />
              )}
              {!schemaLoading && !schemaError && schema && (
                <AnimatePresence mode="wait">
                  <motion.div
                    key={currentStep?.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.16 }}
                  >
                    <StepBody
                      step={currentStep}
                      form={form}
                      update={update}
                      cell={cell}
                      schema={schema}
                      pages={pages}
                      savedAudiences={savedAudiences}
                      adAccountId={adAccountId}
                      account={account}
                      created={created}
                      launching={launching}
                      launchError={launchError}
                      onDismissError={() => setLaunchError(null)}
                      errors={visibleStepErrors}
                      allStepErrors={allStepErrors}
                      steps={steps}
                      onJumpToStep={(id) => {
                        const i = steps.findIndex((s) => s.id === id);
                        if (i >= 0) setStepIndex(i);
                      }}
                    />
                  </motion.div>
                </AnimatePresence>
              )}
            </div>
            {!schemaLoading && !schemaError && schema && (
              <WizardSideRail
                steps={steps}
                stepIndex={stepIndex}
                stepErrors={stepErrors}
                allStepErrors={allStepErrors}
                onJumpToStep={(id) => {
                  const i = steps.findIndex((s) => s.id === id);
                  if (i >= 0) setStepIndex(i);
                }}
              />
            )}
          </div>

          {/* Footer — unified brand gradient on both Continue and Launch.
              V1's white-pill is dropped in V2 because the gradient reads as
              more on-brand and modern. */}
          <div className="flex shrink-0 items-center justify-between border-t border-white/8 px-4 py-3 sm:px-6 2xl:px-8 2xl:py-4">
            <button
              type="button"
              onClick={goBack}
              disabled={stepIndex === 0 || launching}
              className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/3 px-4 py-2 text-xs font-semibold text-white/70 transition-all hover:border-white/15 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed 2xl:px-5 2xl:py-2.5 2xl:text-sm"
            >
              <ChevronLeft className="h-3.5 w-3.5 2xl:h-4 2xl:w-4" /> Back
            </button>
            {currentStep?.id !== 'review' ? (
              <button
                type="button"
                onClick={goNext}
                disabled={launching}
                className="flex items-center gap-1.5 rounded-full bg-gradient-to-r from-[#02C8C4] to-[#5867EB] px-5 py-2 text-xs font-bold text-white shadow-md transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 2xl:px-6 2xl:py-2.5 2xl:text-sm"
              >
                Continue <ChevronRight className="h-3.5 w-3.5 2xl:h-4 2xl:w-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleLaunch}
                disabled={launching || hasBlockingErrors}
                title={
                  hasBlockingErrors
                    ? 'Fix the highlighted errors before launching'
                    : undefined
                }
                className="flex items-center gap-1.5 rounded-full bg-gradient-to-r from-[#02C8C4] to-[#5867EB] px-6 py-2 text-xs font-bold text-white shadow-md transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 2xl:px-7 2xl:py-2.5 2xl:text-sm"
              >
                {launching ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin 2xl:h-4 2xl:w-4" />
                    Launching…
                  </>
                ) : (
                  <>
                    <Rocket className="h-3.5 w-3.5 2xl:h-4 2xl:w-4" />
                    Launch (PAUSED)
                  </>
                )}
              </button>
            )}
          </div>

          {/* Discard confirmation — overlays the whole modal so the user
              can't interact with the form behind it. */}
          <AnimatePresence>
            {showDiscardConfirm && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="absolute inset-0 z-10 flex items-center justify-center bg-black/65 backdrop-blur-sm"
              >
                <motion.div
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  transition={{ duration: 0.16 }}
                  className="w-full max-w-sm rounded-2xl border border-white/12 bg-[#161616] p-5 shadow-2xl 2xl:max-w-md 2xl:p-6"
                >
                  <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-red-500/10 2xl:h-11 2xl:w-11">
                    <AlertCircle className="h-5 w-5 text-red-300 2xl:h-6 2xl:w-6" />
                  </div>
                  <h3 className="text-sm font-bold text-white 2xl:text-base">
                    Discard this campaign?
                  </h3>
                  <p className="mt-1.5 text-xs leading-relaxed text-white/55 2xl:text-sm">
                    Everything you&apos;ve entered in the wizard will be cleared. Your existing
                    campaigns in Meta aren&apos;t affected.
                  </p>
                  <div className="mt-5 flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setShowDiscardConfirm(false)}
                      className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold text-white transition-all hover:bg-white/10 2xl:px-5 2xl:py-2.5 2xl:text-sm"
                    >
                      Keep editing
                    </button>
                    <button
                      type="button"
                      onClick={confirmDiscard}
                      className="rounded-full bg-red-500/85 px-4 py-2 text-xs font-bold text-white transition-all hover:bg-red-500 2xl:px-5 2xl:py-2.5 2xl:text-sm"
                    >
                      Discard
                    </button>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// ─── Validation ──────────────────────────────────────────────────────────────
// The validation engine lives in `wizardValidation.js` (pure, unit-tested).
// `validateStep` / `validateAllSteps` are imported at the top of this file.
// `StepErrorSummary` below renders an engine result as a live banner.

// Validation side rail — a dedicated right-hand panel (Meta Ads Manager
// style) showing the whole-wizard step checklist plus what's left to
// complete on the current step. A separate column, so it never overlaps
// or pushes the form content.
function WizardSideRail({ steps, stepIndex, stepErrors, allStepErrors, onJumpToStep }) {
  const currentMessages = Object.values(stepErrors || {});
  return (
    <aside className="scrollbar-thin hidden w-64 shrink-0 flex-col gap-5 overflow-y-auto border-l border-white/8 bg-white/2 px-4 py-5 md:flex">
      {/* Whole-wizard checklist */}
      <div>
        <p className="text-10 font-bold uppercase tracking-wider text-white/40">
          Campaign setup
        </p>
        <ul className="mt-2.5 flex flex-col gap-0.5">
          {steps.map((s, i) => {
            const isCurrent = i === stepIndex;
            const hasErr = !!allStepErrors[s.id];
            const done = i < stepIndex && !hasErr;
            return (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => onJumpToStep?.(s.id)}
                  className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-13 transition-colors ${
                    isCurrent
                      ? 'bg-white/8 font-semibold text-white'
                      : 'text-white/55 hover:bg-white/5 hover:text-white/80'
                  }`}
                >
                  <span
                    className={`flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full text-10 font-bold ${
                      done
                        ? 'bg-emerald-400/20 text-emerald-300'
                        : hasErr
                        ? 'bg-amber-400/20 text-amber-300'
                        : isCurrent
                        ? 'bg-[#15DCFF]/20 text-[#15DCFF]'
                        : 'bg-white/8 text-white/40'
                    }`}
                  >
                    {done ? (
                      <Check className="h-2.5 w-2.5" />
                    ) : hasErr ? (
                      '!'
                    ) : (
                      i + 1
                    )}
                  </span>
                  {s.label}
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Current-step status — tinted card. A single pending item renders
          as one line (no shouty heading + lone bullet); multiple items
          get a quiet count headline + a bulleted list. Text sized to
          match the step-checklist labels above so the card doesn't read
          louder than the list it sits under. */}
      {currentMessages.length > 0 ? (
        <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-2.5">
          <div className="flex items-start gap-1.5">
            <AlertCircle className="mt-0.5 h-3 w-3 shrink-0 text-amber-300" />
            <div className="min-w-0 flex-1">
              {currentMessages.length === 1 ? (
                <p className="text-11 leading-snug text-amber-100">
                  {currentMessages[0]}
                </p>
              ) : (
                <>
                  <p className="text-10 font-semibold text-amber-200">
                    {currentMessages.length} things left on this step
                  </p>
                  {/* Plain <div>s — not <ul>/<li> — so browser/global
                      list-style can't double-up the bullet next to our
                      manual one. */}
                  <div className="mt-1 flex flex-col gap-0.5">
                    {currentMessages.map((m) => (
                      <div
                        key={m}
                        className="text-10 leading-snug text-amber-100/85"
                      >
                        • {m}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-1.5 rounded-xl border border-emerald-400/20 bg-emerald-400/5 px-2.5 py-2 text-11 text-emerald-200">
          <Check className="h-3 w-3 shrink-0" />
          Step is complete.
        </div>
      )}
    </aside>
  );
}

// ─── Step bodies ─────────────────────────────────────────────────────────────

function StepBody({
  step,
  form,
  update,
  cell,
  schema,
  pages,
  savedAudiences,
  adAccountId,
  account,
  created,
  launching,
  launchError,
  onDismissError,
  errors,
  allStepErrors,
  steps,
  onJumpToStep,
}) {
  const body = (() => {
    switch (step?.id) {
      case 'objective':
        return <ObjectiveStep form={form} update={update} schema={schema} />;
      case 'conversionLocation':
        return <ConversionLocationStep form={form} update={update} schema={schema} />;
      case 'campaign':
        return (
          <CampaignStep
            form={form}
            update={update}
            adAccountId={adAccountId}
            errors={errors}
          />
        );
      case 'adSet':
        return (
          <AdSetStep
            form={form}
            update={update}
            cell={cell}
            schema={schema}
            pages={pages}
            savedAudiences={savedAudiences}
            adAccountId={adAccountId}
            errors={errors}
          />
        );
      case 'leadForm':
        return <LeadFormStep form={form} update={update} />;
      case 'ad':
        return (
          <AdStep
            form={form}
            update={update}
            cell={cell}
            schema={schema}
            errors={errors}
          />
        );
      case 'review':
        return (
          <ReviewStep
            form={form}
            schema={schema}
            account={account}
            adAccountId={adAccountId}
            created={created}
            launching={launching}
            launchError={launchError}
            onDismissError={onDismissError}
            allStepErrors={allStepErrors}
            steps={steps}
            onJumpToStep={onJumpToStep}
          />
        );
      default:
        return null;
    }
  })();

  // Per-field errors render inline on the form; the whole-wizard / current-
  // step validation summary lives in WizardSideRail (the right-hand panel).
  return body;
}

// ─── Step: Objective ────────────────────────────────────────────────────────

function ObjectiveStep({ form, update, schema }) {
  const objectives = Object.entries(schema.objectives || {});
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-15 font-semibold text-white">Choose an objective</h3>
        <p className="text-[12px] text-white/50 mt-1">
          Each objective has its own form. Pick what you want users to do.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 2xl:gap-3">
        {objectives.map(([key, obj]) => (
          <WizardCard
            key={key}
            selected={form.objective === key}
            onClick={() => update({ objective: key, conversionLocation: '' })}
            icon={OBJECTIVE_ICONS[key] || Target}
            title={obj.label}
            description={OBJECTIVE_DESCRIPTIONS[key]}
          />
        ))}
      </div>
    </div>
  );
}

const OBJECTIVE_DESCRIPTIONS = {
  OUTCOME_TRAFFIC: 'Send people to a destination — site, app, Messenger, profile, or calls.',
  OUTCOME_LEADS: 'Collect leads via Instant Forms, Messenger, calls, Instagram, WhatsApp, or your app.',
  OUTCOME_APP_PROMOTION: 'Drive installs to a single store — Apple App Store or Google Play.',
};

// ─── Step: Conversion Location ──────────────────────────────────────────────

function ConversionLocationStep({ form, update, schema }) {
  const objective = schema.objectives?.[form.objective];
  const locations = Object.entries(objective?.conversionLocations || {});

  // Group cells by their `group` field (set in wizardSchema.js).
  // Cells without a group land in "single" by default — matches the
  // previous behaviour for App Promotion / Traffic.
  const multipleCells = locations.filter(([, c]) => c.group === 'multiple');
  const singleCells = locations.filter(([, c]) => c.group !== 'multiple');

  const renderCard = ([locKey, locDef]) => {
    if (locDef.placeholder) return null;
    return (
      <WizardCard
        key={locKey}
        selected={form.conversionLocation === locKey}
        onClick={() => update({ conversionLocation: locKey })}
        icon={CONVERSION_LOCATION_ICONS[locKey] || Globe2}
        title={locDef.label}
        description={locDef.notes}
      />
    );
  };

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h3 className="text-15 font-semibold text-white">Where do you want people to go?</h3>
        <p className="text-[12px] text-white/50 mt-1">
          Choose the destination — fields on the next steps adapt to this.
        </p>
      </div>

      {multipleCells.length > 0 && (
        <div className="flex flex-col gap-3">
          <div>
            <div className="text-13 font-semibold text-white">Multiple</div>
            <p className="text-[11px] text-white/45 mt-0.5">
              Send people where they&apos;re most likely to convert. Meta routes per viewer.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {multipleCells.map(renderCard)}
          </div>
        </div>
      )}

      {multipleCells.length > 0 && singleCells.length > 0 && (
        <div className="h-px bg-white/5" />
      )}

      {singleCells.length > 0 && (
        <div className="flex flex-col gap-3">
          <div>
            <div className="text-13 font-semibold text-white">Single</div>
            <p className="text-[11px] text-white/45 mt-0.5">
              Send people to one location where you want them to convert.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {singleCells.map(renderCard)}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Step: Campaign ─────────────────────────────────────────────────────────

function CampaignStep({ form, update, adAccountId, errors = {} }) {
  const isAppPromo = form.objective === 'OUTCOME_APP_PROMOTION';
  return (
    <div className="flex flex-col gap-5">
      <TextField
        label="Campaign name"
        required
        value={form.campaignName}
        onChange={(v) => update({ campaignName: v })}
        placeholder="e.g. Spring promo — site visits"
        maxLength={120}
        error={errors.campaignName}
      />
      <ToggleField
        label="Campaign Budget Optimisation (CBO)"
        description="Set the budget on the campaign and let Meta distribute across ad sets. Otherwise each ad set has its own budget."
        value={form.cbo}
        onChange={(v) => update({ cbo: v })}
      />
      {form.cbo && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FieldShell label="Budget type" required>
            <SegGroup
              value={form.campaignBudgetType}
              onChange={(v) => update({ campaignBudgetType: v })}
              options={[
                { value: 'daily', label: 'Daily budget' },
                { value: 'lifetime', label: 'Lifetime budget' },
              ]}
            />
          </FieldShell>
          <CurrencyField
            label={form.campaignBudgetType === 'daily' ? 'Daily budget' : 'Lifetime budget'}
            required
            value={form.campaignBudget}
            onChange={(v) => update({ campaignBudget: v })}
            placeholder="100"
            error={errors.campaignBudget}
          />
        </div>
      )}
      <CurrencyField
        label="Campaign spending limit (optional)"
        hint="Once this total spend is reached, Meta auto-pauses the campaign."
        value={form.spendCap}
        onChange={(v) => update({ spendCap: v })}
        placeholder="e.g. 50000"
        error={errors.spendCap}
      />

      {/* iOS 14+ campaign — App Promotion only. Mirrors Meta Ads Manager:
          when ON, the app picker moves up to the campaign level (Apple
          App Store only — SKAdNetwork is iOS-only) and the Ad Set step
          shows the app as read-only. Backend sends
          is_skadnetwork_attribution + promoted_object on the campaign
          payload. When OFF (default), app picker stays on the Ad Set
          step and both stores are available. */}
      {isAppPromo && (
        <>
          <ToggleField
            label="iOS 14+ campaign"
            description="Reach iOS 14.5+ users with SKAdNetwork attribution. Apple App Store only. Limited to one ad set per campaign (Meta requirement). When off, App Promotion delivers to Android + pre-14.5 iOS."
            value={form.iosOptimised}
            onChange={(v) =>
              update({
                iosOptimised: v,
                // Toggling resets the app linkage so a previously-picked
                // Android app doesn't leak into an iOS 14+ campaign or
                // vice versa.
                mobileAppStore: v ? 'APPLE_APP_STORE' : '',
                applicationId: '',
                objectStoreUrl: '',
              })
            }
          />
          {form.iosOptimised && (
            <div className="rounded-2xl border border-white/12 bg-white/4 p-4 flex flex-col gap-4 2xl:p-5">
              <div className="text-13 font-semibold text-white">App promotion</div>
              <AppLinkagePicker
                form={form}
                update={update}
                adAccountId={adAccountId}
                errors={errors}
                iosOnly
              />
            </div>
          )}
        </>
      )}

      <MultiSelectField
        label="Special ad categories"
        hint="Required for ads about employment, housing, credit, politics or gambling."
        values={form.specialAdCategories}
        onChange={(v) => update({ specialAdCategories: v })}
        options={SPECIAL_AD_CATEGORIES}
      />
    </div>
  );
}

// ─── Step: Ad Set ───────────────────────────────────────────────────────────

function AdSetStep({ form, update, cell, pages, savedAudiences, adAccountId, schema, errors = {} }) {
  // Performance-goal labels — match Meta Ads Manager wording. Per-cell
  // overrides (e.g. Leads/App relabels OFFSITE_CONVERSIONS to "app events")
  // take precedence over the global `schema.labels.optimizationGoal` map.
  // Falls back to the raw enum so a missing label never crashes the picker.
  const cellLabels = cell?.adSet?.optimizationGoalLabels || {};
  const globalLabels = schema?.labels?.optimizationGoal || {};
  const optimisationOptions = cell?.adSet?.optimizationGoals?.map((g) => ({
    value: g,
    label: cellLabels[g] || globalLabels[g] || g,
  })) || [];
  const billingLabels = schema?.labels?.billingEvent || {};
  const billingOptions = cell?.adSet?.billingEvents?.map((b) => ({
    value: b,
    label: billingLabels[b] || b,
  })) || [];
  const additional = cell?.adSet?.additionalFields || [];

  // When the user picks a page, auto-fill the IG identity from the
  // page's linked instagram_business_account (returned by getMetaPages).
  // The wizard never asks the user to type a numeric IG id — if the page
  // doesn't have an IG linked, instagramUserId stays empty and Meta
  // falls back to a shadow account derived from the page.
  const onPickPage = (pageId) => {
    const picked = pages.find((p) => p.id === pageId);
    const igId = picked?.instagramAccount?.id || '';
    update({
      pageId,
      // IG identity is auto-derived from the Page and sent silently — the
      // wizard no longer surfaces a (read-only) IG field for it.
      instagramUserId: igId,
      // DSA beneficiary is auto-filled from the Page name and sent
      // silently. Meta requires `dsa_beneficiary` on every ad set
      // globally as of 2024 (without it launch fails, subcode 3858081);
      // the field is hidden from the user — they can't edit it.
      dsaBeneficiary: form.dsaBeneficiary || picked?.name || '',
      // Lead forms are page-scoped — a previously-picked form belongs to
      // the OLD page. Sending it with the new page produces Meta subcode
      // 1487390 ("Advert creative creation failed — Something went wrong")
      // at launch. Clear it so the Lead Form step forces a re-pick from
      // the newly fetched, page-scoped list.
      leadFormId: '',
    });
  };

  return (
    <div className="flex flex-col gap-5">
      <TextField
        label="Ad set name"
        required
        value={form.adSetName}
        onChange={(v) => update({ adSetName: v })}
        placeholder="e.g. India — 25–45 — interest in fitness"
        maxLength={120}
        error={errors.adSetName}
      />

      {/* Instagram identity + DSA beneficiary / Payor are intentionally
          NOT rendered. All three are auto-derived (IG + DSA beneficiary
          from the selected Page) and sent to Meta on launch, but the user
          can't edit them — so the form stays focused on real decisions.
          See onPickPage above + the DSA block in handleLaunch. */}
      <SelectField
        label="Facebook Page"
        required
        value={form.pageId}
        onChange={onPickPage}
        placeholder={pages.length ? 'Pick a page' : 'No pages found'}
        options={pages.map((p) => ({ value: p.id, label: p.name }))}
        error={errors.pageId}
      />

      {/* App linkage — Mobile app store + App picker (filtered by store).
          Apps come from the user's Business Manager (owned + client apps).
          No manual entry — matches Meta's UI exactly.
          For iOS 14+ campaigns (App Promotion only, toggle on Campaign
          step), the picker is at the Campaign level and this surface
          shows the picked app as read-only with a note pointing back —
          again mirroring Meta's Ads Manager. */}
      {additional.includes('applicationId') && (
        form.iosOptimised ? (
          <div className="rounded-2xl border border-white/12 bg-white/4 p-4 flex flex-col gap-3 2xl:p-5">
            <div className="text-13 font-semibold text-white">App promotion</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <FieldShell label="Mobile app store">
                <div className="w-full rounded-full border border-white/5 bg-[#909294]/15 px-4 py-2.5 text-13 2xl:py-3 2xl:text-base text-white/80 min-h-10.5 flex items-center">
                  Apple App Store
                </div>
              </FieldShell>
              <FieldShell label="App" hint={form.applicationId ? 'set at campaign level' : 'none selected'}>
                <div className="w-full rounded-full border border-white/5 bg-[#909294]/15 px-4 py-2.5 text-13 2xl:py-3 2xl:text-base text-white/80 min-h-10.5 flex items-center">
                  {form.applicationId ? (
                    <span className="truncate">{form.applicationId}</span>
                  ) : (
                    <span className="text-white/40">Pick the app on the Campaign step</span>
                  )}
                </div>
              </FieldShell>
            </div>
            <div className="text-[11px] text-white/45">
              To edit these settings, go to the <b>iOS 14+ campaign</b> toggle on the Campaign step.
            </div>
          </div>
        ) : (
          <AppLinkagePicker
            form={form}
            update={update}
            adAccountId={adAccountId}
            errors={errors}
          />
        )
      )}

      {/* Pixel + Event pickers — Leads/Website + Multiple cells use
          OFFSITE_CONVERSIONS optimisation, which needs a Pixel and a
          conversion event. */}
      {additional.includes('pixelId') && (
        <PixelEventPicker
          form={form}
          update={update}
          adAccountId={adAccountId}
          errors={errors}
        />
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <SelectField
          label="Performance goal"
          required
          value={form.optimizationGoal}
          onChange={(v) => update({ optimizationGoal: v })}
          options={optimisationOptions}
          error={errors.optimizationGoal}
        />
        <SelectField
          label="Billing event"
          required
          value={form.billingEvent}
          onChange={(v) => update({ billingEvent: v })}
          options={billingOptions}
          error={errors.billingEvent}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <SelectField
          label="Bid strategy"
          value={form.bidStrategy}
          onChange={(v) =>
            update({
              bidStrategy: v,
              // Switching to an automatic bid strategy must clear any bid
              // amount — Meta rejects an auto-bid ad set that carries one
              // ("Bid amount can't be set for LOWEST_COST_WITHOUT_CAP").
              ...(CAPPED_BID_STRATEGIES.has(v) ? {} : { bidAmount: '' }),
            })
          }
          options={BID_STRATEGIES}
        />
        {CAPPED_BID_STRATEGIES.has(form.bidStrategy) && (
          <CurrencyField
            label="Bid amount cap"
            required
            value={form.bidAmount}
            onChange={(v) => update({ bidAmount: v })}
            placeholder="50"
            error={errors.bidAmount}
          />
        )}
      </div>

      {!form.cbo && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FieldShell label="Budget type" required>
            <SegGroup
              value={form.adSetBudgetType}
              onChange={(v) => update({ adSetBudgetType: v })}
              options={[
                { value: 'daily', label: 'Daily budget' },
                { value: 'lifetime', label: 'Lifetime budget' },
              ]}
            />
          </FieldShell>
          <CurrencyField
            label={form.adSetBudgetType === 'daily' ? 'Daily budget' : 'Lifetime budget'}
            required
            value={form.adSetBudget}
            onChange={(v) => update({ adSetBudget: v })}
            placeholder="100"
            error={errors.adSetBudget}
          />
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <DateTimePicker
          label="Start (optional)"
          value={form.startTime}
          onChange={(v) => update({ startTime: v })}
        />
        <FieldShell
          label="End (optional)"
          hint={form.hasEndTime ? undefined : 'No end set'}
          error={errors.endTime}
        >
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <GradientCheckbox
                checked={form.hasEndTime}
                onChange={(v) => update({ hasEndTime: v })}
              />
              <span className="text-[11px] text-white/60 select-none">Set end</span>
            </label>
            <div className="flex-1 min-w-0">
              <DateTimePicker
                value={form.endTime}
                onChange={(v) => update({ endTime: v })}
                disabled={!form.hasEndTime}
                align="right"
              />
            </div>
          </div>
        </FieldShell>
      </div>

      {/* Audience */}
      <div className="rounded-2xl border border-white/12 bg-white/4 p-4 flex flex-col gap-4 2xl:p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="text-13 font-semibold text-white">Audience</div>
          <div className="flex items-stretch gap-2 min-w-[320px]">
            <SegButton
              active={!form.useSavedAudience}
              onClick={() => update({ useSavedAudience: false })}
            >
              Build new
            </SegButton>
            <SegButton
              active={form.useSavedAudience}
              onClick={() => update({ useSavedAudience: true })}
            >
              Saved audience
            </SegButton>
          </div>
        </div>

        {form.useSavedAudience ? (
          <SelectField
            label="Saved audience"
            required
            value={form.savedAudienceId}
            onChange={(v) => update({ savedAudienceId: v })}
            placeholder={savedAudiences.length ? 'Pick one' : 'No saved audiences found'}
            options={savedAudiences.map((a) => ({ value: a.id, label: a.name }))}
            error={errors.savedAudienceId}
          />
        ) : (
          <>
            <ToggleField
              label="Worldwide"
              description="Reach people in any country (overrides the Locations picker). Excludes Taiwan and Singapore — those markets need separate regulatory declarations that aren't supported yet."
              value={form.worldwide}
              onChange={(v) => update({ worldwide: v })}
            />
            {!form.worldwide && (
              <LocationTargeting
                value={form.locations}
                onChange={(next) => update({ locations: next })}
                error={errors.locations}
              />
            )}
            <RangeField
              label="Age range"
              minValue={form.ageMin}
              maxValue={form.ageMax}
              onChange={({ min, max }) =>
                update({ ageMin: Math.max(13, Math.min(65, min || 13)), ageMax: Math.max(13, Math.min(65, max || 65)) })
              }
              min={13}
              max={65}
              error={errors.ageMax}
            />
            <MultiSelectField
              label="Genders"
              hint="Leave empty to target all"
              values={form.genders}
              onChange={(v) => update({ genders: v })}
              options={GENDERS}
            />
            <MultiSelectField
              label="Languages"
              hint="Leave empty to target all"
              values={form.locales}
              onChange={(v) => update({ locales: v })}
              options={COMMON_LOCALES}
            />
            <ToggleField
              label="Advantage Audience"
              description="Let Meta expand beyond your settings to find more conversions."
              value={form.advantageAudience}
              onChange={(v) => update({ advantageAudience: v })}
            />
          </>
        )}
      </div>

      {/* Optimisation — adset-level options Meta exposes inline in its UI.
          The Dynamic Creative toggle is intentionally hidden: turning on
          `is_dynamic_creative` makes Meta require the AD to be built in
          the dynamic-creative format (`asset_feed_spec` with ARRAYS of
          images / headlines / texts / CTAs). The wizard only collects a
          single variant of each, so a dynamic-creative ad here would have
          nothing to mix — and creating a normal ad in a dynamic-creative
          ad set is rejected (subcode 1885702). Re-surface this toggle
          only once the Ad step collects multiple creative variations. */}
      <div className="rounded-2xl border border-white/12 bg-white/4 p-4 flex flex-col gap-4 2xl:p-5">
        <div className="text-13 font-semibold text-white">Optimisation</div>
        <SelectField
          label="Attribution window"
          hint="How long a click or view counts. Each (objective, optimisation goal) accepts a different subset — leave on Meta default unless you know what you need."
          value={form.attributionWindow}
          onChange={(v) => update({ attributionWindow: v })}
          options={[
            { value: '', label: 'Meta default (recommended)' },
            { value: '1d_click', label: '1-day click only' },
            { value: '1d_click_1d_view', label: '1-day click + 1-day view' },
            { value: '7d_click', label: '7-day click' },
            { value: '7d_click_1d_view', label: '7-day click + 1-day view' },
          ]}
        />
      </div>

      {/* Placements — Advantage+ default, manual reveals checkboxes */}
      <div className="rounded-2xl border border-white/12 bg-white/4 p-4 flex flex-col gap-4 2xl:p-5">
        <div className="text-13 font-semibold text-white">Placements</div>
        <ToggleField
          label="Advantage+ Placements (recommended)"
          description="Meta auto-picks the best surfaces across Facebook, Instagram, Messenger and Audience Network. Turn off to pick manually."
          value={form.placementMode === 'advantage_plus'}
          onChange={(v) =>
            update({
              placementMode: v ? 'advantage_plus' : 'manual',
              // When toggling ON Advantage+, clear manual selections so
              // they don't get sent ignored.
              publisherPlatforms: v ? [] : form.publisherPlatforms,
            })
          }
        />
        {form.placementMode === 'manual' && (
          <>
            <MultiSelectField
              label="Platforms"
              required
              values={form.publisherPlatforms}
              onChange={(v) => update({ publisherPlatforms: v })}
              options={[
                { value: 'facebook', label: 'Facebook' },
                { value: 'instagram', label: 'Instagram' },
                { value: 'messenger', label: 'Messenger' },
                { value: 'audience_network', label: 'Audience Network' },
              ]}
              error={errors.publisherPlatforms}
            />
            <MultiSelectField
              label="Devices"
              hint="Leave empty to target all devices"
              values={form.devicePlatforms}
              onChange={(v) => update({ devicePlatforms: v })}
              options={[
                { value: 'mobile', label: 'Mobile' },
                { value: 'desktop', label: 'Desktop' },
              ]}
            />
          </>
        )}
      </div>

    </div>
  );
}

// ─── Step: Lead Form (pick existing OR build new) ───────────────────────────

const STANDARD_QUESTIONS = [
  { value: 'EMAIL', label: 'Email' },
  { value: 'FULL_NAME', label: 'Full name' },
  { value: 'PHONE', label: 'Phone number' },
  { value: 'CITY', label: 'City' },
  { value: 'STATE', label: 'State / Region' },
  { value: 'ZIP', label: 'Zip / Postal code' },
  { value: 'COUNTRY', label: 'Country' },
  { value: 'COMPANY_NAME', label: 'Company name' },
  { value: 'JOB_TITLE', label: 'Job title' },
  { value: 'DOB', label: 'Date of birth' },
  { value: 'GENDER', label: 'Gender' },
];

// ─── PixelEventPicker (Leads/Website + Multiple cells) ──────────────────────
// Pixel-using cells optimise for OFFSITE_CONVERSIONS, which needs a
// pixel + a conversion event. Blocks the launch when no pixel exists
// on the ad account with a clear "set up at Events Manager" message.

// ─── AppLinkagePicker (App Promotion + Traffic/App + Leads/App) ────────────
// Mobile-app-store picker + App-name picker (filtered by store). Mirrors
// Meta Ads Manager's UI exactly — there is no manual app-id / store-URL
// entry. Apps come from the user's Business Manager (the ad account's
// owning business + every business the user belongs to). If no app is
// linked, the user adds one at Business Settings → Apps and retries.

function AppLinkagePicker({ form, update, adAccountId, iosOnly = false, errors = {} }) {
  const [apps, setApps] = useState([]);
  const [appsLoading, setAppsLoading] = useState(false);
  const [appsError, setAppsError] = useState(null);

  useEffect(() => {
    if (!adAccountId) return;
    setAppsLoading(true);
    setAppsError(null);
    getPromotableApps(adAccountId)
      .then((r) => setApps(r?.apps || []))
      .catch((e) => setAppsError(e?.response?.data?.error || e.message))
      .finally(() => setAppsLoading(false));
  }, [adAccountId]);

  // iOS 14+ campaigns force Apple App Store at the campaign level — no
  // store picker is shown, and the form's mobileAppStore is auto-set to
  // APPLE_APP_STORE on mount so downstream validation passes.
  useEffect(() => {
    if (iosOnly && form.mobileAppStore !== 'APPLE_APP_STORE') {
      update({ mobileAppStore: 'APPLE_APP_STORE' });
    }
  }, [iosOnly, form.mobileAppStore, update]);

  const effectiveStore = iosOnly ? 'APPLE_APP_STORE' : form.mobileAppStore;
  const storeUrlKey =
    effectiveStore === 'APPLE_APP_STORE'
      ? 'appleAppStoreUrl'
      : effectiveStore === 'GOOGLE_PLAY'
      ? 'googlePlayUrl'
      : null;
  const filteredApps = storeUrlKey
    ? (apps || []).filter((a) => a[storeUrlKey])
    : [];
  const noApps = !appsLoading && filteredApps.length === 0;

  const onPickApp = (appId) => {
    const picked = filteredApps.find((a) => a.id === appId);
    if (!picked) {
      update({ applicationId: '', objectStoreUrl: '' });
      return;
    }
    update({
      applicationId: picked.id,
      objectStoreUrl: picked[storeUrlKey] || '',
    });
  };

  return (
    <>
      {!iosOnly && (
        <SelectField
          label="Mobile app store"
          required
          value={form.mobileAppStore}
          onChange={(v) =>
            update({ mobileAppStore: v, applicationId: '', objectStoreUrl: '' })
          }
          placeholder="Pick a store"
          options={MOBILE_APP_STORES}
          error={errors.mobileAppStore}
        />
      )}

      {effectiveStore && (
        <>
          {appsError && (
            <LaunchErrorBanner
              error={{ title: "Couldn't load apps", details: appsError }}
            />
          )}
          {noApps && !appsError && (
            <div className="rounded-2xl border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-13 text-yellow-100">
              <div className="font-semibold text-yellow-200 mb-1">
                No {form.mobileAppStore === 'APPLE_APP_STORE' ? 'iOS' : 'Android'} apps linked to this Business Manager
              </div>
              Add the app at{' '}
              <a
                href="https://business.facebook.com/settings/apps"
                target="_blank"
                rel="noopener noreferrer"
                className="underline text-yellow-50"
              >
                Business Settings → Apps
              </a>
              , then come back. Meta requires the app to be a registered Meta app with the platform configured.
            </div>
          )}
          {!noApps && !appsError && (
            <>
              <FieldShell
                label="App"
                required
                error={errors.applicationId}
                hint={
                  appsLoading
                    ? 'Loading apps from your Business Manager…'
                    : `${filteredApps.length} app${filteredApps.length === 1 ? '' : 's'} available`
                }
              >
                <SelectField
                  value={form.applicationId}
                  onChange={onPickApp}
                  placeholder={appsLoading ? 'Loading…' : 'Pick an app'}
                  options={filteredApps.map((a) => ({
                    value: a.id,
                    label: `${a.name} · ${a.id}`,
                  }))}
                />
              </FieldShell>
              {form.applicationId && form.objectStoreUrl && (
                <div className="text-[11px] text-white/45 -mt-3 wrap-break-word">
                  → {form.objectStoreUrl}
                </div>
              )}
            </>
          )}
        </>
      )}
    </>
  );
}

function PixelEventPicker({ form, update, adAccountId, errors = {} }) {
  const [pixels, setPixels] = useState([]);
  const [pixelsLoading, setPixelsLoading] = useState(false);
  const [pixelsError, setPixelsError] = useState(null);
  const [events, setEvents] = useState([]);
  const [eventsLoading, setEventsLoading] = useState(false);

  // Inline creation state
  const [mode, setMode] = useState('pick'); // 'pick' | 'create'
  const [newPixelName, setNewPixelName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(null);
  const [snippetUrl, setSnippetUrl] = useState(null);

  useEffect(() => {
    if (!adAccountId) return;
    setPixelsLoading(true);
    setPixelsError(null);
    getPixels(adAccountId)
      .then((r) => setPixels(r?.pixels || []))
      .catch((e) => setPixelsError(e?.response?.data?.error || e.message))
      .finally(() => setPixelsLoading(false));
  }, [adAccountId]);

  useEffect(() => {
    if (!form.pixelId) {
      setEvents([]);
      return;
    }
    setEventsLoading(true);
    getPixelEvents(form.pixelId)
      .then((r) => setEvents(r?.events || []))
      .catch(() => setEvents([]))
      .finally(() => setEventsLoading(false));
  }, [form.pixelId]);

  const noPixels = !pixelsLoading && !pixelsError && pixels.length === 0;
  // When there are no pixels, default into create mode (no "pick"
  // dropdown to land on) so the user sees the form immediately.
  const effectiveMode = noPixels ? 'create' : mode;

  const handleCreatePixel = async () => {
    if (!newPixelName?.trim() || creating) return;
    setCreating(true);
    setCreateError(null);
    setSnippetUrl(null);
    try {
      const r = await createPixel({ adAccountId, name: newPixelName.trim() });
      const created = r?.pixel;
      if (!created?.id) throw new Error('Pixel id missing in response');
      // Auto-select the new pixel + drop it into the dropdown
      update({ pixelId: created.id, pixelEventType: '' });
      setPixels((prev) => [
        { id: created.id, name: created.name, lastFiredTime: null },
        ...prev,
      ]);
      setSnippetUrl(r.snippetSetupUrl || null);
      setMode('pick'); // switch back so the user sees their new pixel selected
      setNewPixelName('');
    } catch (e) {
      setCreateError(
        e?.response?.data?.details || e?.response?.data?.error || e.message || 'Failed to create pixel',
      );
    } finally {
      setCreating(false);
    }
  };

  if (pixelsError) {
    return (
      <LaunchErrorBanner error={{ title: "Couldn't load pixels", details: pixelsError }} />
    );
  }

  return (
    <div className="rounded-2xl border border-white/12 bg-white/4 p-4 flex flex-col gap-4 2xl:p-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-13 font-semibold text-white">Conversion tracking</div>
        {!noPixels && (
          <div className="flex items-stretch gap-2 min-w-[280px]">
            <SegButton active={effectiveMode === 'pick'} onClick={() => setMode('pick')}>
              Pick existing
            </SegButton>
            <SegButton active={effectiveMode === 'create'} onClick={() => setMode('create')}>
              Create new
            </SegButton>
          </div>
        )}
      </div>

      {noPixels && (
        <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-[12px] text-yellow-100">
          No Pixels on this ad account yet. Create one below — you&apos;ll get the snippet-install link after.
        </div>
      )}

      {snippetUrl && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[12px] text-emerald-100">
          ✓ Pixel created. Install the Meta JS snippet on your website to start firing events —{' '}
          <a
            href={snippetUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="underline text-emerald-50"
          >
            open install instructions in Events Manager
          </a>
          . The campaign will launch in PAUSED state and start delivering once the snippet fires its first event.
        </div>
      )}

      {effectiveMode === 'create' ? (
        <>
          {createError && (
            <LaunchErrorBanner
              error={{ title: "Couldn't create pixel", details: createError }}
              onDismiss={() => setCreateError(null)}
            />
          )}
          <TextField
            label="Pixel name"
            required
            hint="Just a name for you to recognise it later — e.g. your website or product"
            value={newPixelName}
            onChange={setNewPixelName}
            placeholder="e.g. Main website pixel"
            maxLength={120}
          />
          <button
            type="button"
            onClick={handleCreatePixel}
            disabled={!newPixelName.trim() || creating}
            className="self-start inline-flex items-center gap-2 px-5 py-2 rounded-full bg-gradient-to-r from-[#02C8C4] to-[#5867EB] text-13 font-semibold text-white shadow-md hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {creating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Creating pixel…
              </>
            ) : (
              'Create pixel'
            )}
          </button>
        </>
      ) : (
        <>
          <SelectField
            label="Pixel"
            required
            hint={pixelsLoading ? 'Loading pixels…' : `${pixels.length} available`}
            value={form.pixelId}
            onChange={(v) => update({ pixelId: v, pixelEventType: '' })}
            placeholder={pixelsLoading ? 'Loading…' : 'Pick a pixel'}
            options={pixels.map((p) => ({
              value: p.id,
              label: p.lastFiredTime ? `${p.name} · active` : `${p.name} · no recent events`,
            }))}
            error={errors.pixelId}
          />
          {form.pixelId && (
            <SelectField
              label="Conversion event"
              required
              hint={eventsLoading ? 'Loading events…' : 'Meta optimises for this event'}
              value={form.pixelEventType}
              onChange={(v) => update({ pixelEventType: v })}
              placeholder={eventsLoading ? 'Loading…' : 'Pick an event (e.g. Lead)'}
              error={errors.pixelEventType}
              options={events.map((e) => ({
                value: e.eventType,
                // Meta's enum is SCREAMING_SNAKE; show a friendly version
                // ("COMPLETE_REGISTRATION" → "Complete Registration") but
                // send the raw enum value to the API.
                label: e.lastFiredTime
                  ? `${prettifyEventType(e.eventType)} · last fired ${new Date(e.lastFiredTime * 1000 || e.lastFiredTime).toLocaleDateString()}`
                  : `${prettifyEventType(e.eventType)} · not yet fired`,
              }))}
            />
          )}
        </>
      )}
    </div>
  );
}

function LeadFormStep({ form, update }) {
  const [existingForms, setExistingForms] = useState([]);
  const [formsLoading, setFormsLoading] = useState(false);
  const [formsError, setFormsError] = useState(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(null);

  // Load existing forms whenever the page changes (or on mount).
  useEffect(() => {
    if (!form.pageId) {
      setExistingForms([]);
      return;
    }
    setFormsLoading(true);
    setFormsError(null);
    getLeadForms(form.pageId)
      .then((r) => setExistingForms(r?.forms || []))
      .catch((e) => setFormsError(e?.response?.data?.error || e.message))
      .finally(() => setFormsLoading(false));
  }, [form.pageId]);

  const handleCreateForm = async () => {
    setCreating(true);
    setCreateError(null);
    try {
      const r = await createLeadForm({
        pageId: form.pageId,
        name: form.leadFormName,
        greetingTitle: form.leadFormGreetingTitle || undefined,
        greetingBody: form.leadFormGreetingBody || undefined,
        questions: form.leadFormQuestions,
        privacyPolicyUrl: form.leadFormPrivacyUrl,
        privacyPolicyText: form.leadFormPrivacyText || undefined,
        thankYouTitle: form.leadFormThankYouTitle || undefined,
        thankYouBody: form.leadFormThankYouBody || undefined,
        thankYouLinkUrl: form.leadFormThankYouLinkUrl || undefined,
        thankYouButtonText: form.leadFormThankYouButtonText || undefined,
      });
      const created = r?.form;
      if (!created?.id) throw new Error('Form id missing in response');
      // Auto-select the newly created form and switch back to pick mode.
      update({ leadFormId: created.id, leadFormMode: 'pick' });
      // Optimistically add to the picker list so the user sees it immediately.
      setExistingForms((prev) => [
        { id: created.id, name: created.name, status: 'ACTIVE', leadsCount: 0 },
        ...prev,
      ]);
    } catch (e) {
      setCreateError(
        e?.response?.data?.details || e?.response?.data?.error || e.message || 'Failed to create form',
      );
    } finally {
      setCreating(false);
    }
  };

  // Builder validation — gates the "Create form" button.
  const builderValid =
    form.pageId &&
    form.leadFormName?.trim().length >= 2 &&
    form.leadFormPrivacyUrl?.trim() &&
    form.leadFormQuestions?.length > 0;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h3 className="text-15 font-semibold text-white">Instant Form</h3>
        <p className="text-[12px] text-white/50 mt-1">
          The form Meta shows after a click. Pick an existing form on your Page or build a new one.
        </p>
      </div>

      {!form.pageId && (
        <div className="rounded-2xl border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-13 text-yellow-100">
          Pick a Facebook Page on the previous step first — Lead Forms are scoped per Page.
        </div>
      )}

      {/* Tab selector */}
      <div className="flex items-stretch gap-2 max-w-md">
        <SegButton
          active={form.leadFormMode === 'pick'}
          onClick={() => update({ leadFormMode: 'pick' })}
        >
          Use existing form
        </SegButton>
        <SegButton
          active={form.leadFormMode === 'build'}
          onClick={() => update({ leadFormMode: 'build' })}
        >
          Build new form
        </SegButton>
      </div>

      {form.leadFormMode === 'pick' ? (
        <FieldShell
          label="Form"
          required
          hint={
            formsLoading
              ? 'Loading forms…'
              : existingForms.length === 0
              ? 'No active forms on this Page yet'
              : `${existingForms.length} form${existingForms.length === 1 ? '' : 's'} available`
          }
          error={formsError}
        >
          <SelectField
            value={form.leadFormId}
            onChange={(v) => update({ leadFormId: v })}
            placeholder={
              formsLoading
                ? 'Loading…'
                : existingForms.length === 0
                ? 'No forms — switch to "Build new form" or create one in Meta Business'
                : 'Pick a form'
            }
            options={existingForms.map((f) => ({
              value: f.id,
              label: `${f.name}${f.leadsCount > 0 ? ` · ${f.leadsCount} leads` : ''}`,
            }))}
          />
        </FieldShell>
      ) : (
        <div className="rounded-2xl border border-white/12 bg-white/4 p-4 flex flex-col gap-4 2xl:p-5">
          {createError && (
            <LaunchErrorBanner
              error={{ title: "Couldn't create form", details: createError }}
              onDismiss={() => setCreateError(null)}
            />
          )}
          <TextField
            label="Form name"
            required
            hint="Internal name — not shown to users"
            value={form.leadFormName}
            onChange={(v) => update({ leadFormName: v })}
            placeholder="e.g. Spring promo — lead form"
            maxLength={120}
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <TextField
              label="Greeting title (optional)"
              hint="Shown above the questions"
              value={form.leadFormGreetingTitle}
              onChange={(v) => update({ leadFormGreetingTitle: v })}
              placeholder="e.g. Get a quote in 60 seconds"
              maxLength={60}
            />
            <TextField
              label="Greeting body (optional)"
              hint="Optional pitch under the title"
              value={form.leadFormGreetingBody}
              onChange={(v) => update({ leadFormGreetingBody: v })}
              placeholder="A short pitch to set context"
              maxLength={500}
            />
          </div>
          <MultiSelectField
            label="Questions"
            required
            hint="Meta pre-fills these from the user's Facebook profile when possible"
            values={form.leadFormQuestions}
            onChange={(v) => update({ leadFormQuestions: v })}
            options={STANDARD_QUESTIONS}
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <TextField
              label="Privacy policy URL"
              required
              hint="Required by Meta on every Lead Form"
              type="url"
              value={form.leadFormPrivacyUrl}
              onChange={(v) => update({ leadFormPrivacyUrl: v })}
              placeholder="https://your-site.com/privacy"
            />
            <TextField
              label="Privacy link text (optional)"
              hint="Label for the link — defaults to “Privacy Policy”"
              value={form.leadFormPrivacyText}
              onChange={(v) => update({ leadFormPrivacyText: v })}
              placeholder="Privacy Policy"
              maxLength={60}
            />
          </div>
          <div className="text-[12px] text-white/55 -mb-2">Thank-you screen (optional)</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <TextField
              label="Thank-you title"
              value={form.leadFormThankYouTitle}
              onChange={(v) => update({ leadFormThankYouTitle: v })}
              placeholder="Thanks for your interest!"
              maxLength={60}
            />
            <TextField
              label="Thank-you body"
              value={form.leadFormThankYouBody}
              onChange={(v) => update({ leadFormThankYouBody: v })}
              placeholder="We'll be in touch soon."
              maxLength={300}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <TextField
              label="Thank-you link URL"
              hint="Optional CTA after completion (e.g. your website)"
              type="url"
              value={form.leadFormThankYouLinkUrl}
              onChange={(v) => update({ leadFormThankYouLinkUrl: v })}
              placeholder="https://your-site.com"
            />
            <TextField
              label="Thank-you button text"
              hint="Label for the CTA button"
              value={form.leadFormThankYouButtonText}
              onChange={(v) => update({ leadFormThankYouButtonText: v })}
              placeholder="Visit website"
              maxLength={30}
            />
          </div>
          <button
            type="button"
            onClick={handleCreateForm}
            disabled={!builderValid || creating}
            className="self-start inline-flex items-center gap-2 px-5 py-2 rounded-full bg-gradient-to-r from-[#02C8C4] to-[#5867EB] text-13 font-semibold text-white shadow-md hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {creating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Creating form…
              </>
            ) : (
              'Create form'
            )}
          </button>
          <div className="text-[11px] text-white/40">
            On submit, Meta creates the form on Page &ldquo;{form.pageId}&rdquo;, returns its id, and we
            auto-attach it to this ad.
          </div>
        </div>
      )}

      {form.leadFormId && (
        <div className="text-[11px] text-emerald-300/70">
          ✓ Lead Form id <span className="font-mono">{form.leadFormId}</span> will be attached to this ad.
        </div>
      )}
    </div>
  );
}

// ─── Step: Ad ───────────────────────────────────────────────────────────────

function AdStep({ form, update, cell, schema, errors = {} }) {
  const requiredFields = new Set(cell?.ad?.requiredFields || []);
  const optionalFields = new Set(cell?.ad?.optionalFields || []);
  // CTA options — show Meta's friendly label ("Learn more") in the
  // dropdown, send the raw enum (LEARN_MORE) to the backend. Labels come
  // from schema.labels.cta; falls back to the raw enum so a missing
  // label never crashes the picker.
  const ctaLabels = schema?.labels?.cta || {};
  const ctas = (cell?.ctas?.allowed || []).map((c) => ({
    value: c,
    label: ctaLabels[c] || c,
  }));
  const showLinkUrl = requiredFields.has('linkUrl') || optionalFields.has('linkUrl');
  const isAppLink = cell?.ad?.objectStorySpecShape === 'app_link';

  // Library picker — inline tab inside the Ad step (V1 uses the same
  // pattern). When ON, hides Upload/URL and shows the picker; selecting
  // an item flips back to OFF and stores the URL on the form.
  const [libraryMode, setLibraryMode] = useState(false);

  return (
    <div className="flex flex-col gap-5">
      <TextField
        label="Ad name"
        required
        value={form.adName}
        onChange={(v) => update({ adName: v })}
        placeholder="e.g. Hero creative — variant A"
        maxLength={120}
        error={errors.adName}
      />

      {/* Media — top-level Image / Video toggle. For each branch, an
          inner Upload-URL / From-library toggle gives access to the
          generated-media library. Switching media types resets all
          media state so the backend's xor (imageHash xor videoId) can
          never fire on a stale value. */}
      <FieldShell
        label="Media"
        required
        error={errors.media}
        hint={
          form.mediaType === 'video'
            ? 'MP4 / MOV / WEBM up to 100 MB · poster URL required'
            : libraryMode
            ? 'Pick from your generated-media library'
            : 'JPG or PNG, ≤10MB'
        }
      >
        <div className="flex flex-col gap-3">
          {/* Image / Video type selector */}
          <div className="flex items-stretch gap-2 max-w-xs">
            <SegButton
              active={form.mediaType === 'image'}
              onClick={() =>
                update({
                  mediaType: 'image',
                  videoFile: null,
                  videoUrl: null,
                  videoThumbnailUrl: null,
                })
              }
            >
              Image
            </SegButton>
            <SegButton
              active={form.mediaType === 'video'}
              onClick={() =>
                update({
                  mediaType: 'video',
                  imageFile: null,
                  imageUrl: null,
                })
              }
            >
              Video
            </SegButton>
          </div>

          {form.mediaType === 'image' ? (
            <>
              {/* Image: Upload / URL ⇄ From library inner toggle */}
              <div className="flex items-stretch gap-2 max-w-xs">
                <SegButton active={!libraryMode} onClick={() => setLibraryMode(false)}>
                  Upload / URL
                </SegButton>
                <SegButton active={libraryMode} onClick={() => setLibraryMode(true)}>
                  From library
                </SegButton>
              </div>
              {libraryMode ? (
                <div className="rounded-2xl border border-white/12 bg-white/4 p-3 2xl:p-4">
                  <LibraryPicker
                    type="image"
                    selectedUrl={form.imageUrl}
                    onPick={(absoluteUrl) => {
                      update({ imageFile: null, imageUrl: absoluteUrl });
                      setLibraryMode(false);
                    }}
                  />
                </div>
              ) : (
                <ImageField
                  imageFile={form.imageFile}
                  imageUrl={form.imageUrl}
                  onChangeFile={(f) => update({ imageFile: f })}
                  onChangeUrl={(u) => update({ imageUrl: u })}
                />
              )}
            </>
          ) : (
            <>
              {/* Video: Upload / URL ⇄ From library inner toggle */}
              <div className="flex items-stretch gap-2 max-w-xs">
                <SegButton active={!libraryMode} onClick={() => setLibraryMode(false)}>
                  Upload / URL
                </SegButton>
                <SegButton active={libraryMode} onClick={() => setLibraryMode(true)}>
                  From library
                </SegButton>
              </div>
              {libraryMode ? (
                <div className="rounded-2xl border border-white/12 bg-white/4 p-3 2xl:p-4">
                  <LibraryPicker
                    type="video"
                    selectedUrl={form.videoUrl}
                    onPick={(absoluteUrl) => {
                      update({ videoFile: null, videoUrl: absoluteUrl });
                      setLibraryMode(false);
                    }}
                  />
                </div>
              ) : (
                <VideoField
                  videoFile={form.videoFile}
                  videoUrl={form.videoUrl}
                  videoThumbnailUrl={form.videoThumbnailUrl}
                  onChangeFile={(f) => update({ videoFile: f })}
                  onChangeUrl={(u) => update({ videoUrl: u })}
                  onChangeThumbnailUrl={(u) => update({ videoThumbnailUrl: u })}
                />
              )}
            </>
          )}
        </div>
      </FieldShell>
      {requiredFields.has('headline') && (
        <TextField
          label="Headline"
          required
          value={form.headline}
          onChange={(v) => update({ headline: v })}
          maxLength={255}
          placeholder="Short, punchy"
          error={errors.headline}
        />
      )}
      {requiredFields.has('primaryText') && (
        <TextAreaField
          label="Primary text"
          required
          value={form.primaryText}
          onChange={(v) => update({ primaryText: v })}
          maxLength={2000}
          rows={3}
          placeholder="The main body copy"
          error={errors.primaryText}
        />
      )}
      <TextField
        label="Description"
        value={form.description}
        onChange={(v) => update({ description: v })}
        maxLength={255}
        placeholder="Optional secondary copy"
      />
      {showLinkUrl && (
        <TextField
          label="Destination URL"
          required={requiredFields.has('linkUrl')}
          type="url"
          value={form.linkUrl}
          onChange={(v) => update({ linkUrl: v })}
          placeholder="https://example.com/landing"
          error={errors.linkUrl}
        />
      )}
      <SelectField
        label="Call to action"
        value={form.callToAction}
        onChange={(v) => update({ callToAction: v })}
        options={ctas}
        error={errors.callToAction}
      />
      <TextField
        label="URL parameters"
        hint="e.g. utm_source=fb&utm_campaign=spring"
        value={form.urlTags}
        onChange={(v) => update({ urlTags: v })}
      />
      <ToggleField
        label="Auto-translate ad copy"
        description="Meta translates your headline and primary text into the viewer's language when possible. Source language remains as-typed."
        value={form.autoTranslate}
        onChange={(v) => update({ autoTranslate: v })}
      />
      {isAppLink && (
        <>
          <TextField
            label="Deferred deep link (optional)"
            hint="Opens a specific in-app surface after install"
            type="url"
            value={form.deferredDeepLink}
            onChange={(v) => update({ deferredDeepLink: v })}
            placeholder="myapp://path"
          />
          <TextField
            label="Custom product page ID (optional, iOS)"
            hint="Apple App Store Connect Custom Product Page id"
            value={form.customProductPage}
            onChange={(v) => update({ customProductPage: v })}
          />
        </>
      )}
    </div>
  );
}

// ─── Step: Review ───────────────────────────────────────────────────────────

function ReviewStep({
  form,
  schema,
  account,
  adAccountId,
  created,
  launching,
  launchError,
  onDismissError,
  allStepErrors = {},
  steps = [],
  onJumpToStep,
}) {
  const labels = schema?.labels || {};
  // launchError can be a plain string (legacy) OR a structured object
  // {title, details, code, subcode, fbtraceId}. Normalise for the banner.
  // Subcode-aware hints: Meta sometimes wraps a real cause in a generic
  // "Something went wrong" message; the subcode is the truth. When we
  // recognise one, replace `details` with an actionable hint so the user
  // knows where to fix it.
  const SUBCODE_HINTS = {
    // Lead form isn't compatible with the Page picked on the ad —
    // happens when the Page changes after the Lead Form was chosen.
    1487390:
      'The lead form belongs to a different Page than the one on this ad. Go back to the Lead Form step and pick a form from the current Page.',
  };
  const errorForBanner = !launchError
    ? null
    : typeof launchError === 'string'
    ? { title: 'Launch failed', details: launchError }
    : (() => {
        const hint = SUBCODE_HINTS[launchError.subcode];
        // Detail line — prefer the hint when we have one; otherwise show
        // Meta's message; append the subcode so the next debug is easier.
        const baseDetail = hint || launchError.details || launchError.title;
        const detail =
          launchError.subcode && !hint
            ? `${baseDetail} (Meta subcode ${launchError.subcode})`
            : baseDetail;
        return {
          title: launchError.title || 'Launch failed',
          details: detail,
          fbtraceId: launchError.fbtraceId,
        };
      })();

  // Pre-launch sweep — every step that still has validation errors. While
  // this is non-empty the Launch button is disabled, so the user can never
  // submit data Meta would reject; each row jumps back to the failing step.
  const failingSteps = (steps || []).filter((s) => allStepErrors[s.id]);

  return (
    <div className="flex flex-col gap-5 2xl:gap-6">
      {errorForBanner && <LaunchErrorBanner error={errorForBanner} onDismiss={onDismissError} />}

      {failingSteps.length > 0 && (
        <div className="rounded-2xl border border-amber-400/30 bg-amber-400/8 px-4 py-3 2xl:px-5">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 text-amber-300" />
            <p className="text-13 font-semibold text-amber-200">
              Fix {failingSteps.length} step{failingSteps.length === 1 ? '' : 's'} before launching
            </p>
          </div>
          <ul className="mt-2 flex flex-col gap-1.5">
            {failingSteps.map((s) => {
              const msgs = Object.values(allStepErrors[s.id] || {});
              return (
                <li key={s.id} className="flex flex-wrap items-baseline gap-x-2">
                  <button
                    type="button"
                    onClick={() => onJumpToStep?.(s.id)}
                    className="rounded-md text-[12px] font-semibold text-amber-100 underline decoration-amber-300/40 underline-offset-2 hover:decoration-amber-300"
                  >
                    {s.label} →
                  </button>
                  <span className="text-[11px] text-amber-100/70">
                    {msgs.join(' · ')}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Posting-to banner — surfaces the destination account up-front so
          users can't miss which Meta account a paused campaign just landed in. */}
      <div className="rounded-2xl bg-gradient-to-r from-[#02C8C4] to-[#5867EB] p-px">
        <div
          className="flex items-center gap-3 rounded-[15px] p-3.5 2xl:p-4"
          style={{
            background:
              'linear-gradient(to right, rgba(21,220,255,0.08), rgba(107,114,248,0.08)), #141414',
          }}
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/15 bg-white 2xl:h-10 2xl:w-10">
            <FaMeta className="h-4 w-4 text-[#0082FB] 2xl:h-5 2xl:w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold uppercase tracking-wider text-[#15DCFF] 2xl:text-xs">
              Posting to
            </p>
            <p className="truncate text-sm font-bold text-white 2xl:text-base">
              {account?.name || '—'}
            </p>
            <p className="font-mono text-xs text-white/55 2xl:text-sm">
              act_{adAccountId || account?.id || '—'}
              {account?.currency ? ` · ${account.currency}` : ''}
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-emerald-400/30 bg-emerald-400/8 px-4 py-3 2xl:px-5 2xl:py-3.5">
        <p className="text-xs leading-relaxed text-emerald-100 2xl:text-sm">
          Will be launched <b>PAUSED</b>. Activate from the Campaigns tab when you&apos;re ready;
          Meta starts delivering after the ad set passes review.
        </p>
      </div>

      {Object.keys(created).length > 0 && (
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 text-[12px] text-emerald-200">
          Partial progress saved — retry only re-runs the failing step:
          {created.campaignId && <div>· Campaign {created.campaignId}</div>}
          {created.adSetId && <div>· Ad Set {created.adSetId}</div>}
          {created.imageHash && <div>· Image uploaded</div>}
        </div>
      )}

      {/* 2-up grid on wider screens prevents the value column from stretching
          across the modal. Stacks on mobile. */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:gap-5">
        <Section title="Objective">
          <Field k="Objective" v={labels.objective?.[form.objective] || form.objective} />
          <Field k="Destination" v={labels.conversionLocation?.[form.conversionLocation] || form.conversionLocation} />
        </Section>
        <Section title="Campaign">
          <Field k="Name" v={form.campaignName} />
          <Field k="Budget" v={form.cbo ? `${form.campaignBudgetType} ₹${form.campaignBudget}` : 'Per ad set'} />
          <Field k="Categories" v={form.specialAdCategories.length ? form.specialAdCategories.join(', ') : 'None'} />
        </Section>
        <Section title="Ad Set">
          <Field k="Name" v={form.adSetName} />
          <Field k="Page" v={form.pageId} />
          <Field k="Optimisation" v={form.optimizationGoal} />
          <Field k="Billing" v={form.billingEvent} />
          <Field k="Bid strategy" v={form.bidStrategy + (form.bidAmount ? ` (cap ₹${form.bidAmount})` : '')} />
          {!form.cbo && <Field k="Budget" v={`${form.adSetBudgetType} ₹${form.adSetBudget}`} />}
          <Field
            k="Audience"
            v={
              form.useSavedAudience
                ? `Saved: ${form.savedAudienceId}`
                : form.worldwide
                ? 'Worldwide'
                : (form.locations || [])
                    .map(
                      (l) =>
                        `${l.mode === 'exclude' ? '–' : ''}${l.name || l.key}${
                          l.type === 'city' && l.radius
                            ? ` (${l.radius} km)`
                            : ''
                        }`,
                    )
                    .join(', ')
            }
          />
          <Field k="Age" v={`${form.ageMin}–${form.ageMax}`} />
          {form.mobileAppStore && <Field k="App store" v={form.mobileAppStore} />}
          {form.applicationId && <Field k="App ID" v={form.applicationId} />}
        </Section>
        <Section title="Ad" wide>
          <Field k="Name" v={form.adName} />
          <Field k="Headline" v={form.headline} />
          <Field k="Primary text" v={form.primaryText} />
          {form.linkUrl && <Field k="Link" v={form.linkUrl} />}
          <Field k="CTA" v={labels.cta?.[form.callToAction] || form.callToAction} />
        </Section>
      </div>

      {launching && (
        <div className="flex items-center gap-2 text-13 text-white/70">
          <Loader2 className="h-4 w-4 animate-spin" />
          Launching campaign…
        </div>
      )}
    </div>
  );
}

function Section({ title, children, wide = false }) {
  return (
    <div
      className={`overflow-hidden rounded-2xl border border-white/12 bg-[#303030]/20 ${
        wide ? 'md:col-span-2' : ''
      }`}
    >
      <div className="border-b border-white/10 bg-white/5 px-4 py-2 2xl:px-5 2xl:py-2.5">
        <p className="text-xs font-bold uppercase tracking-wider text-white/85 2xl:text-sm">
          {title}
        </p>
      </div>
      <dl className="divide-y divide-white/8">{children}</dl>
    </div>
  );
}

function Field({ k, v }) {
  return (
    <div className="flex items-start gap-3 px-4 py-2 2xl:px-5 2xl:py-2.5">
      <dt className="w-28 shrink-0 text-xs font-semibold tracking-wider text-white/55 2xl:w-32 2xl:text-sm">
        {k}
      </dt>
      <dd className="min-w-0 flex-1 wrap-break-word text-xs font-medium text-white 2xl:text-sm">
        {v || <span className="text-white/30">—</span>}
      </dd>
    </div>
  );
}
