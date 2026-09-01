/**
 * CreateCampaignWizard — Google Ads V2 campaign creation wizard.
 *
 * Fully dynamic — objectives, CTAs, ad-type mapping all come from
 * GET /google-ads/wizard-schema fetched on mount. Nothing is
 * hardcoded in this component. Same pattern as Meta's CreateCampaignWizardV2.
 *
 * Step flow:
 *   0. Objective   — driven by schema.objectives from server
 *   1. Campaign    — name, daily budget, schedule, geo-targeting
 *   2. Ad Group    — name, CPC bid, age/gender targeting
 *   3. Ad          — SEARCH / DISPLAY / DEMAND_GEN (adType from schema)
 *   4. Review      — summary + Launch
 *
 * Idempotent retry: created = { campaignId, adGroupId } — completed
 * steps are skipped on re-launch after a partial failure.
 *
 * Modes: create-full | create-adgroup | create-ad |
 *        edit-campaign | edit-adgroup | edit-ad
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { SiGoogleads } from 'react-icons/si';
import {
  Check, ChevronLeft, ChevronRight, Eye, Image as ImageIcon,
  Layers, Loader2, Target, X, AlertCircle, Plus, Trash2,
  Youtube, Search, Monitor, Zap, ShoppingBag, MapPin, TrendingUp,
  RefreshCw, Smartphone, Store, Key, MapPinned, Bookmark, BookmarkPlus, Users,
  Info, Rocket,
} from 'lucide-react';
import {
  createGoogleCampaign,
  updateGoogleCampaign,
  createGoogleAdGroup,
  updateGoogleAdGroup,
  createGoogleAd,
  updateGoogleAd,
  uploadGoogleImage,
  uploadGoogleVideo,
  addAssetToAssetGroup,
  removeAssetFromAssetGroup,
  getGoogleWizardSchema,
  listGoogleCampaignTemplates,
  getGoogleCampaignTemplate,
  saveGoogleCampaignTemplate,
  deleteGoogleCampaignTemplate,
} from '@/apis/googleAds/googleAdsApi';
import { globalToast } from '@/utils/globalToast';
import { getClipboardImageFiles } from '@/utils/clipboardImages';
import { validateStep, validateAllSteps, deriveAdType, resolveCampaignObjective, effectiveChannel } from './wizardValidation';
import {
  getDestinationsForObjective,
  getDestinationsForGoal,
  normalizeWizardContext,
  destinationLabel,
  objectiveLabel,
} from './googleWizardDestinations';

// ─── static icon map (client-side only — server never sends icons) ────────────

const OBJECTIVE_ICONS = {
  SALES:           ShoppingBag,
  LEADS:           Target,
  WEBSITE_TRAFFIC: TrendingUp,
  DISPLAY:         Monitor,
  YOUTUBE_REACH:   Youtube,
  APP_PROMOTION:   Zap,
  LOCAL_STORE:     MapPin,
  PERFORMANCE_MAX: Search,
  SEARCH:          Search,
  SHOPPING:        ShoppingBag,
  VIDEO:           Youtube,
  DEMAND_GEN:      TrendingUp,
  MULTI_CHANNEL:   Smartphone,
};

import { fetchSchemaOnce, getSchemaCache } from './googleAdsUtils';

// ─── step definitions ─────────────────────────────────────────────────────────

const BASE_STEPS = [
  { id: 'campaign',    label: 'Campaign',  icon: Eye },
  { id: 'adGroup',     label: 'Ad Group',  icon: Layers },
  { id: 'ad',          label: 'Ad',        icon: ImageIcon },
  { id: 'review',      label: 'Review',    icon: Check },
];

const PMAX_STEPS = [
  { id: 'campaign',    label: 'Campaign',    icon: Eye },
  { id: 'assetGroup',  label: 'Asset Group', icon: Layers },
  { id: 'assets',      label: 'Assets',      icon: ImageIcon },
  { id: 'review',      label: 'Review',      icon: Check },
];

const DESTINATION_ICONS = {
  SEARCH: Search,
  DISPLAY: Monitor,
  YOUTUBE_REACH: Youtube,
  PERFORMANCE_MAX: Zap,
  SHOPPING: ShoppingBag,
  APP_PROMOTION: Smartphone,
};

const WIZARD_MODE_META = {
  'create-full':    { title: 'New Campaign',  toast: 'Campaign launched. Google will review before delivery.' },
  'create-adgroup': { title: 'New Ad Group',  toast: 'Ad group created successfully.' },
  'create-ad':      { title: 'New Ad',        toast: 'Ad created. Google will review before delivery.' },
  'edit-campaign':  { title: 'Edit Campaign', toast: 'Campaign updated.' },
  'edit-adgroup':   { title: 'Edit Ad Group', toast: 'Ad group updated.' },
  'edit-ad':        { title: 'Edit Ad',       toast: 'Ad updated.' },
};

const GOOGLE_BLUE = '#4285F4';

function hasGoals(objective, schema) {
  if (!objective) return false;
  const map = schema?.objectiveGoals;
  if (map) return (map[objective] || []).length > 0;
  // fallback: objectives that have goals in our 2026 flow
  return ['SALES', 'LEADS', 'WEBSITE_TRAFFIC', 'APP_PROMOTION', 'YOUTUBE_REACH'].includes(objective);
}

function buildSteps(mode, form = {}, schema = null) {
  if (mode === 'create-adgroup') return BASE_STEPS.filter((s) => ['adGroup', 'review'].includes(s.id));
  if (mode === 'create-ad')      return BASE_STEPS.filter((s) => ['ad', 'review'].includes(s.id));
  if (mode === 'edit-campaign')  return BASE_STEPS.filter((s) => ['campaign', 'review'].includes(s.id));
  if (mode === 'edit-adgroup') {
    return form.isPmax
      ? PMAX_STEPS.filter((s) => ['assets', 'review'].includes(s.id))
      : BASE_STEPS.filter((s) => ['adGroup', 'review'].includes(s.id));
  }
  if (mode === 'edit-ad')        return BASE_STEPS.filter((s) => ['ad', 'review'].includes(s.id));

  const channel = effectiveChannel(form);

  // PMAX gets its own step list: Campaign (settings+budget only) + Assets (all creative)
  let steps = channel === 'PERFORMANCE_MAX' ? PMAX_STEPS : BASE_STEPS;

  // Shopping has no ad step
  if (channel === 'SHOPPING') {
    steps = steps.filter((s) => s.id !== 'ad');
  }

  // Always show the destination step — user should confirm their campaign type even if only one option

  return steps;
}

function seedCreated(mode, context) {
  if (mode === 'create-adgroup') return { campaignId: context?.campaignId };
  if (mode === 'create-ad')      return { campaignId: context?.campaignId, adGroupId: context?.adGroupId };
  if (mode === 'edit-campaign')  return { campaignId: context?.campaignId };
  if (mode === 'edit-adgroup')   return { campaignId: context?.campaignId, adGroupId: context?.adGroupId };
  if (mode === 'edit-ad')        return { campaignId: context?.campaignId, adGroupId: context?.adGroupId };
  return {};
}

const toMicros = (n) => Math.round(Number(n) * 1_000_000);

function buildInitialForm(context) {
  const ctx = normalizeWizardContext(context);
  return {
    objective:       ctx?.objective    || '',
    destination:     ctx?.destination  || '',
    goal:            ctx?.goal         || '',
    // website info
    websiteUrl:      context?.websiteUrl    || '',
    businessName:    context?.businessName  || '',
    campaignName:    context?.campaignName || '',
    dailyBudget:     context?.dailyBudget != null ? String(context.dailyBudget) : '',
    budgetType:      context?.budgetType      || 'DAILY',
    lifetimeBudget:  context?.lifetimeBudget != null ? String(context.lifetimeBudget) : '',
    status:          context?.status       || 'PAUSED',
    adStatus:        context?.adStatus     || 'ENABLED',
    startDate:       context?.startDate    || '',
    endDate:         context?.endDate      || '',
    countries:       context?.countries    || [],
    adGroupName:     context?.adGroupName  || '',
    cpcBid:          context?.cpcBid != null ? String(context.cpcBid) : '',
    // Audience step fields
    ageMin:          context?.ageMin       || '',
    ageMax:          context?.ageMax       || '',
    genders:         context?.genders      || [],
    targetCountries: context?.targetCountries || [],
    headlines:       context?.headlines    || ['', '', ''],
    descriptions:    context?.descriptions || ['', ''],
    headline:        context?.headline     || '',
    longHeadline:    context?.longHeadline || '',
    description:     context?.description  || '',
    finalUrl:        context?.finalUrl     || '',
    callToAction:    context?.callToAction || '',
    imageUrl:        context?.imageUrl     || '',
    imageFile:       null,
    assetResourceName: context?.assetResourceName || '',
    squareAssetResourceName: context?.squareAssetResourceName || '',
    videoUrl:        context?.videoUrl     || '',
    youtubeVideoId:  context?.youtubeVideoId || '',
    // SEARCH / LEADS / SALES extras
    keywords:           context?.keywords    || [{ text: '', matchType: 'BROAD' }],
    biddingGoal:        context?.biddingGoal || 'MAXIMIZE_CLICKS',
    targetCpa:          context?.targetCpa   || '',
    targetRoas:         context?.targetRoas  || '',
    // Audience targeting (Display / Video / PMax)
    audienceSegments:      context?.audienceSegments      || [],
    customerMatchUrl:      context?.customerMatchUrl      || '',
    customSegmentKeywords: context?.customSegmentKeywords || '',
    pmaxSearchThemes:      context?.pmaxSearchThemes      || '',
    // DISPLAY extras
    frequencyCap:       context?.frequencyCap || '',
    // VIDEO extras
    videoFormat:        context?.videoFormat  || 'SKIPPABLE_IN_STREAM',
    // SHOPPING extras
    merchantCenterId:   context?.merchantCenterId  || '',
    productCategory:    context?.productCategory   || '',
    // APP_PROMOTION extras
    appStoreUrl:        context?.appStoreUrl  || '',
    appPlatform:        context?.appPlatform  || 'ANDROID',
    appId:              context?.appId        || '',
    // LOCAL_STORE extras
    storeAddress:       context?.storeAddress   || '',
    locationRadius:     context?.locationRadius || '',
    // PERFORMANCE_MAX extras
    isPmax:             !!context?.isPmax,
    _originalPmaxAssets: context?._originalPmaxAssets || null,
    assetGroupName:     context?.assetGroupName      || '',
    businessDescription:context?.businessDescription || '',
    finalUrlSuffix:     context?.finalUrlSuffix      || '',
    pmaxFinalUrl:       context?.pmaxFinalUrl        || '',
    pmaxBusinessName:   context?.pmaxBusinessName    || '',
    pmaxHeadlines:      context?.pmaxHeadlines       || ['', '', ''],
    pmaxLongHeadline:   context?.pmaxLongHeadline    || '',
    pmaxDescriptions:   context?.pmaxDescriptions    || ['', ''],
    pmaxImageUrl:       context?.pmaxImageUrl        || '',
    pmaxImageAssetRN:       context?.pmaxImageAssetRN       || '',
    pmaxSquareImageAssetRN: context?.pmaxSquareImageAssetRN || '',
    pmaxLogoUrl:            context?.pmaxLogoUrl            || '',
    pmaxLogoAssetRN:        context?.pmaxLogoAssetRN        || '',
    pmaxVideoUrl:       context?.pmaxVideoUrl        || '',
    pmaxVideoFile:      null,
    videoFile:          null,
    // APP_PROMOTION subtype
    appSubtype:         context?.appSubtype          || 'APP_INSTALLS',
    // VIDEO / YOUTUBE_REACH extras
    videoGoal:          context?.videoGoal           || 'VIDEO_VIEWS',
    videoSubtype:       context?.videoSubtype        || 'VIDEO_VIEWS',
  };
}

// ─── small shared field components ───────────────────────────────────────────

function FieldError({ msg }) {
  if (!msg) return null;
  return (
    <p className="mt-1 flex items-center gap-1 text-[11px] text-red-600 dark:text-[#ff7e7e]">
      <AlertCircle className="h-3 w-3 shrink-0" /> {msg}
    </p>
  );
}

function Label({ children, required }) {
  return (
    <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-white/55">
      {children}{required && <span className="ml-0.5 text-red-400">*</span>}
    </label>
  );
}

function Input({ value, onChange, placeholder, type = 'text', maxLength, min, max, step, className = '' }) {
  return (
    <input
      type={type}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      maxLength={maxLength}
      min={min}
      max={max}
      step={step}
      className={`w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-13 text-gray-900 outline-none transition-colors placeholder:text-gray-400 hover:border-gray-300 focus:border-[#4285F4]/50 focus:ring-1 focus:ring-[#4285F4]/15 dark:border-white/10 dark:bg-white/8 dark:text-white dark:placeholder:text-white/30 dark:hover:border-white/20 dark:focus:border-[#4285F4]/50 ${className}`}
    />
  );
}

function Select({ value, onChange, children, className = '' }) {
  return (
    <select
      value={value}
      onChange={onChange}
      className={`w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-13 text-gray-900 outline-none transition-colors hover:border-gray-300 focus:border-[#4285F4]/50 focus:ring-1 focus:ring-[#4285F4]/15 dark:border-white/8 dark:bg-[#1e1e1e] dark:text-white dark:hover:border-white/15 dark:focus:border-[#4285F4]/40 [&>option]:bg-white [&>option]:text-gray-900 dark:[&>option]:bg-[#1e1e1e] dark:[&>option]:text-white ${className}`}
    >
      {children}
    </select>
  );
}

function CharCount({ val, max }) {
  const len = String(val || '').length;
  return (
    <span className={`text-10 ${len > max ? 'text-red-400' : 'text-gray-400 dark:text-white/30'}`}>
      {len}/{max}
    </span>
  );
}

// ─── RadioCard — small selectable row with gradient-border when active ────────

function RadioCard({ active, onClick, label, desc }) {
  return (
    <div className={`rounded-xl transition-all ${active ? 'ring-2 ring-[#4285F4]' : 'ring-1 ring-gray-200 hover:ring-gray-300 dark:ring-white/8 dark:hover:ring-white/15'}`}>
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-start gap-2.5 rounded-xl bg-white p-2.5 text-left transition-all hover:bg-gray-50 dark:bg-white/4 dark:hover:bg-white/6"
      >
        <div className={`mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border-2 ${active ? 'border-[#4285F4] bg-[#4285F4]' : 'border-gray-300 dark:border-white/20'}`} />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-gray-800 dark:text-white">{label}</p>
          {desc && <p className="mt-0.5 text-10 leading-snug text-gray-500 dark:text-white/50">{desc}</p>}
        </div>
      </button>
    </div>
  );
}

// ─── Launch error banner ──────────────────────────────────────────────────────

function LaunchErrorBanner({ error, onDismiss }) {
  if (!error) return null;
  const title = typeof error === 'string' ? error : error.title;
  const details = typeof error === 'string' ? null : error.details;
  return (
    <div className="shrink-0 border-t border-red-200/60 bg-red-50/90 px-5 py-3 dark:border-red-500/20 dark:bg-red-500/8">
      <div className="flex items-start gap-2">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-red-600 dark:text-red-400">{title}</p>
          {details && details !== title && (
            <p className="mt-1 text-11 leading-snug text-red-500/90 dark:text-red-300/80">{details}</p>
          )}
        </div>
        {onDismiss && (
          <button onClick={onDismiss} className="text-10 text-red-400 underline">Dismiss</button>
        )}
      </div>
    </div>
  );
}

// ─── Step Rail (header-inline, matches Meta's StepRail style) ────────────────

function StepRail({ steps, currentIndex, onJumpToStep }) {
  return (
    <div className="flex items-center gap-1 overflow-x-auto">
      {steps.map((s, i) => {
        const Icon = s.icon;
        const done   = i < currentIndex;
        const active = i === currentIndex;
        const clickable = i < currentIndex;
        return (
          <React.Fragment key={s.id}>
            <div
              onClick={() => clickable && onJumpToStep?.(i)}
              className={`flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium transition-all ${
                active
                  ? 'bg-[#4285F4] text-white'
                  : done
                  ? 'cursor-pointer border border-[#4285F4]/25 bg-[#4285F4]/8 text-[#4285F4] hover:bg-[#4285F4]/15 dark:bg-[#4285F4]/10 dark:text-[#4285F4] dark:hover:bg-[#4285F4]/20'
                  : 'border border-gray-200 bg-gray-50 text-gray-400 dark:border-white/8 dark:bg-white/3 dark:text-white/30'
              }`}
            >
              {done ? <Check className="h-3 w-3" /> : <Icon className="h-3 w-3" />}
              <span className="hidden sm:inline">{s.label}</span>
            </div>
            {i < steps.length - 1 && (
              <div className={`h-0.5 w-2 shrink-0 ${i < currentIndex ? 'bg-[#4285F4]/25' : 'bg-gray-200 dark:bg-white/15'}`} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ─── Wizard side rail (Meta-style checklist) ──────────────────────────────────

function WizardSideRail({ steps, stepIndex, stepErrors, rawStepErrors, allStepErrors, attemptedStepIds, onJumpToStep }) {
  const currentMessages = Object.values(stepErrors || {});
  const isActuallyComplete = Object.keys(rawStepErrors || {}).length === 0;
  const hasVisibleErrors = currentMessages.length > 0;

  return (
    <aside className="scrollbar-thin hidden w-52 shrink-0 flex-col gap-4 overflow-y-auto border-l border-gray-100 bg-gray-50/60 px-3 py-4 dark:border-white/6 dark:bg-white/[0.02] md:flex">
      <div>
        <p className="mb-2 text-10 font-bold uppercase tracking-wider text-gray-400 dark:text-white/35">Setup progress</p>
        <ul className="flex flex-col gap-0.5">
          {steps.map((s, i) => {
            const isCurrent = i === stepIndex;
            const wasAttempted = attemptedStepIds?.has(s.id);
            const hasErr = !!allStepErrors[s.id] && wasAttempted;
            const done = i < stepIndex && !hasErr;
            return (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => done && onJumpToStep?.(i)}
                  className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors ${
                    isCurrent
                      ? 'bg-white font-semibold text-gray-900 shadow-sm dark:bg-white/8 dark:text-white'
                      : done
                      ? 'cursor-pointer text-gray-500 hover:bg-white dark:text-white/50 dark:hover:bg-white/5'
                      : 'text-gray-400 dark:text-white/30'
                  }`}
                >
                  <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold ${
                    done
                      ? 'bg-[#4285F4] text-white'
                      : hasErr
                      ? 'bg-red-500 text-white'
                      : isCurrent
                      ? 'bg-[#4285F4] text-white'
                      : 'border border-gray-200 text-gray-400 dark:border-white/10'
                  }`}>
                    {done ? <Check className="h-2.5 w-2.5" /> : hasErr ? '!' : i + 1}
                  </span>
                  {s.label}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      <div className={`rounded-xl px-3 py-2 ${
        isActuallyComplete
          ? 'bg-[#4285F4]/15 ring-1 ring-[#4285F4]/40'
          : hasVisibleErrors
          ? 'bg-red-500/10 ring-1 ring-red-500/40'
          : 'bg-gray-100 dark:bg-white/5 ring-1 ring-gray-200 dark:ring-white/10'
      }`}>
        <div className="flex items-center gap-1.5">
          {isActuallyComplete ? (
            <Check className="h-3 w-3 shrink-0 text-[#4285F4]" />
          ) : hasVisibleErrors ? (
            <AlertCircle className="h-3 w-3 shrink-0 text-red-400" />
          ) : (
            <Info className="h-3 w-3 shrink-0 text-gray-400 dark:text-white/40" />
          )}
          <p className={`text-10 font-semibold leading-snug ${
            isActuallyComplete
              ? 'text-[#4285F4]'
              : hasVisibleErrors
              ? 'text-red-400'
              : 'text-gray-500 dark:text-white/50'
          }`}>
            {isActuallyComplete
              ? 'This step is complete'
              : hasVisibleErrors
              ? (currentMessages.length > 1 ? `${currentMessages.length} fields need attention` : currentMessages[0])
              : 'Fill in required fields'}
          </p>
        </div>
      </div>
    </aside>
  );
}

// ─── Step: Goal (conditional — shown when objective has conversion goals) ─────

// Goal → recommended biddingGoal mapping
const GOAL_TO_BIDDING = {
  PURCHASE:       'MAXIMIZE_CONVERSIONS',
  SUBSCRIPTION:   'MAXIMIZE_CONVERSIONS',
  ADD_TO_CART:    'MAXIMIZE_CONVERSIONS',
  CHECKOUT:       'MAXIMIZE_CONVERSIONS',
  LEAD_FORM:      'MAXIMIZE_CONVERSIONS',
  PHONE_CALL:     'MAXIMIZE_CONVERSIONS',
  BOOK_DEMO:      'TARGET_CPA',
  CONTACT_FORM:   'MAXIMIZE_CONVERSIONS',
  PAGE_VIEW:      'MAXIMIZE_CLICKS',
  LANDING_PAGE_VIEW: 'MAXIMIZE_CLICKS',
  WEBSITE_VISIT:  'MAXIMIZE_CLICKS',
  INSTALL:        'MAXIMIZE_CONVERSIONS',
  REGISTRATION:   'MAXIMIZE_CONVERSIONS',
  IN_APP_ACTION:  'TARGET_CPA',
  REACH:          'MAXIMIZE_CLICKS',
  IMPRESSIONS:    'MAXIMIZE_CLICKS',
  BRAND_AWARENESS:'MAXIMIZE_CLICKS',
};

// ─── EU Consent detection (module-scope — used by Campaign and Audience steps) ─

const EU_CONSENT_COUNTRY_CODES = new Set([
  'AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT',
  'LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE', // EU
  'IS','LI','NO', // EEA non-EU
  'GB',           // UK
  'CH',           // Switzerland
]);

function isEuTargeted(countries = []) {
  if (countries.includes('WW')) return true;
  return countries.some((c) => EU_CONSENT_COUNTRY_CODES.has(c));
}


// ─── Sub-component: KeywordsSection ──────────────────────────────────────────

function KeywordsSection({ form, setField, matchTypes }) {
  const keywords = form.keywords || [{ text: '', matchType: 'BROAD' }];
  const defaultMatchType = matchTypes?.[0]?.value || 'BROAD';
  const setKw = (i, field, val) => {
    const n = keywords.map((k, j) => j === i ? { ...k, [field]: val } : k);
    setField('keywords', n);
  };
  const addKw = () => setField('keywords', [...keywords, { text: '', matchType: defaultMatchType }]);
  const removeKw = (i) => { if (keywords.length > 1) setField('keywords', keywords.filter((_, j) => j !== i)); };

  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-white/12 dark:bg-white/4">
      <p className="mb-2 text-10 font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40">Keywords <span className="text-red-400">*</span></p>
      <div className="flex flex-col gap-1.5">
        {keywords.map((kw, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <Input value={kw.text} onChange={(e) => setKw(i, 'text', e.target.value)} placeholder={`Keyword ${i + 1}`} className="flex-1" />
            <select
              value={kw.matchType}
              onChange={(e) => setKw(i, 'matchType', e.target.value)}
              className="rounded-xl border border-gray-200 bg-white px-2 py-2 text-xs text-gray-700 outline-none dark:border-white/8 dark:bg-[#1A1A1A] dark:text-white"
            >
              {matchTypes.map(({ value, label }) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            {keywords.length > 1 && (
              <button onClick={() => removeKw(i)} className="shrink-0 rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10">
                <Trash2 className="h-3 w-3" />
              </button>
            )}
          </div>
        ))}
        <button onClick={addKw} className="flex items-center gap-1 rounded-xl border border-dashed border-gray-300 px-3 py-2 text-xs text-gray-400 transition-all hover:border-[#4285F4]/40 hover:text-[#4285F4] dark:border-white/10">
          <Plus className="h-3 w-3" /> Add keyword
        </button>
      </div>
    </div>
  );
}

const INTEREST_SEGMENTS = [
  { value: 'IN_MARKET_SHOPPERS',     label: 'In-market shoppers' },
  { value: 'TECHNOLOGY',             label: 'Technology' },
  { value: 'TRAVEL',                 label: 'Travel' },
  { value: 'FITNESS',                label: 'Health & Fitness' },
  { value: 'FINANCE',                label: 'Finance' },
  { value: 'AUTOMOTIVE',             label: 'Automotive' },
  { value: 'REAL_ESTATE',            label: 'Real estate' },
  { value: 'EDUCATION',              label: 'Education' },
  { value: 'FOOD_AND_DINING',        label: 'Food & Dining' },
  { value: 'SPORTS',                 label: 'Sports' },
];

// ─── Step: Asset Group (PMAX — name, business info + audience signals) ───────

function AssetGroupStep({ form, setField, errors, genderOptions }) {
  const toggleGender  = (g)   => { const cur = form.genders || []; setField('genders', cur.includes(g) ? cur.filter((x) => x !== g) : [...cur, g]); };
  const toggleSegment = (seg) => { const cur = form.audienceSegments || []; setField('audienceSegments', cur.includes(seg) ? cur.filter((x) => x !== seg) : [...cur, seg]); };
  return (
    <div className="flex flex-col gap-4">

      {/* Asset group info */}
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-white/12 dark:bg-white/4">
        <p className="mb-2 text-10 font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40">Asset group</p>
        <div className="flex flex-col gap-3">
          <div>
            <Label required>Asset group name</Label>
            <Input value={form.assetGroupName} onChange={(e) => setField('assetGroupName', e.target.value)} placeholder="e.g. Summer Sale Assets" />
            <FieldError msg={errors.assetGroupName} />
          </div>
          <div>
            <Label>Business name <span className="text-gray-400 dark:text-white/30">(optional)</span></Label>
            <Input value={form.pmaxBusinessName} onChange={(e) => setField('pmaxBusinessName', e.target.value)} placeholder="Your brand or company name" maxLength={25} />
            <p className="mt-1 text-10 text-gray-400 dark:text-white/30">Auto-filled from your Google account if left blank — max 25 chars</p>
          </div>
          <div>
            <Label>Business description</Label>
            <Input value={form.businessDescription} onChange={(e) => setField('businessDescription', e.target.value.slice(0, 90))} placeholder="Short description of your business or offer" maxLength={90} />
            <p className="mt-1 text-10 text-gray-400 dark:text-white/30">Optional — used by Google AI to generate additional assets</p>
          </div>
        </div>
      </div>

      {/* Audience signals banner */}
      <div className="flex items-start gap-2.5 rounded-xl border border-blue-200 bg-blue-50 p-3 dark:border-[#4285F4]/25 dark:bg-[#4285F4]/10">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#4285F4]" />
        <div>
          <p className="text-xs font-semibold text-[#4285F4]">Audience Signals — not strict targeting</p>
          <p className="mt-0.5 text-10 text-blue-600 dark:text-white/50">Google AI uses these as starting signals and may expand beyond them to find conversions.</p>
        </div>
      </div>

      {/* Demographics */}
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-white/12 dark:bg-white/4">
        <p className="mb-4 text-10 font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40">Audience signals — demographics</p>
        <div className="mb-4 grid grid-cols-2 gap-3">
          <div>
            <Label>Min age</Label>
            <Input type="number" value={form.ageMin} onChange={(e) => setField('ageMin', e.target.value)} placeholder="18" min="18" max="65" />
          </div>
          <div>
            <Label>Max age</Label>
            <Input type="number" value={form.ageMax} onChange={(e) => setField('ageMax', e.target.value)} placeholder="65" min="18" max="65" />
          </div>
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium text-gray-500 dark:text-[#afafaf]">Gender</span>
            <span className="text-[11px] text-gray-400 dark:text-white/40">Empty = all genders</span>
          </div>
          <div className="flex gap-2">
            {(genderOptions || []).map(({ value, label }) => {
              const active = (form.genders || []).includes(value);
              return (
                <div key={value} className={`flex-1 rounded-full p-[1px] transition-all ${active ? 'bg-[#4285F4]' : 'bg-gray-200 hover:bg-gray-300 dark:bg-white/8 dark:hover:bg-white/15'}`}>
                  <button type="button" onClick={() => toggleGender(value)} className="flex w-full items-center justify-center gap-1.5 rounded-full bg-gray-100 py-2 text-13 font-medium transition-all dark:bg-[#1d1d1d] text-gray-700 dark:text-white">
                    {active && <Check className="h-3 w-3 text-[#4285F4]" />}{label}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Interests */}
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-white/12 dark:bg-white/4">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-10 font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40">Audience signals — interests</p>
          <span className="text-[11px] text-gray-400 dark:text-white/40">Signals only — AI may expand</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {INTEREST_SEGMENTS.map(({ value, label }) => {
            const active = (form.audienceSegments || []).includes(value);
            return (
              <div key={value} className={`rounded-full transition-all ${active ? 'ring-2 ring-[#4285F4]' : 'ring-1 ring-gray-200 hover:ring-gray-300 dark:ring-white/8 dark:hover:ring-white/15'}`}>
                <button type="button" onClick={() => toggleSegment(value)} className="flex items-center gap-0.5 rounded-full bg-white px-2 py-0.5 text-10 font-medium transition-all dark:bg-white/8 text-gray-700 dark:text-white/80">
                  {active && <Check className="h-3 w-3 text-[#4285F4]" />}{label}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Custom segments & remarketing */}
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-white/12 dark:bg-white/4">
        <p className="mb-2 text-10 font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40">Audience signals — custom & remarketing</p>
        <div className="flex flex-col gap-3">
          <div>
            <Label>Customer match list URL <span className="font-normal text-gray-400 dark:text-white/30">(optional)</span></Label>
            <Input value={form.customerMatchUrl || ''} onChange={(e) => setField('customerMatchUrl', e.target.value)} placeholder="Website URL your customers visited" />
            <p className="mt-1 text-10 text-gray-400 dark:text-white/30">Google will match visitors to your customer list</p>
          </div>
          <div>
            <Label>Custom segment keywords <span className="font-normal text-gray-400 dark:text-white/30">(optional)</span></Label>
            <Input value={form.customSegmentKeywords || ''} onChange={(e) => setField('customSegmentKeywords', e.target.value)} placeholder="e.g. buy running shoes, best gym equipment" />
            <p className="mt-1 text-10 text-gray-400 dark:text-white/30">Comma-separated — targets people who search these terms</p>
          </div>
        </div>
      </div>

      {/* Search themes */}
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-white/12 dark:bg-white/4">
        <p className="mb-1 text-10 font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40">Search themes</p>
        <p className="mb-3 text-10 text-gray-400 dark:text-white/30">Tell Google what your customers search for — up to 25 themes, comma-separated</p>
        <Input value={form.pmaxSearchThemes || ''} onChange={(e) => setField('pmaxSearchThemes', e.target.value)} placeholder="e.g. buy shoes online, running gear, sports footwear" />
      </div>
    </div>
  );
}

function PmaxAdPreview({ form }) {
  const headlines    = (form.pmaxHeadlines || []).filter(Boolean);
  const descriptions = (form.pmaxDescriptions || []).filter(Boolean);
  const isBlobPmaxVideo = form.pmaxVideoUrl?.startsWith('blob:');
  const youtubeId    = !isBlobPmaxVideo && (form.pmaxVideoUrl?.match(/(?:v=|youtu\.be\/)([A-Za-z0-9_-]{11})/)?.[1] || (form.pmaxVideoUrl?.length === 11 ? form.pmaxVideoUrl : null));
  const imageUrl     = form.pmaxImageUrl;
  const businessName = form.pmaxBusinessName || 'Your Brand';
  const domain       = businessName.toLowerCase().replace(/\s+/g, '') + '.com';
  const h1 = headlines[0] || 'Headline 1';
  const h2 = headlines[1] || 'Headline 2';
  const h3 = headlines[2] || '';
  const titleLine = [h1, h2, h3].filter(Boolean).join(' | ');

  return (
    <div className="sticky top-0 flex flex-col gap-3">
      <p className="text-10 font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40">Live Preview</p>

      {/* Search preview */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm dark:border-white/10 dark:bg-[#202124]">
        <p className="px-3 pt-2.5 pb-1.5 text-10 font-semibold uppercase tracking-widest text-gray-400 dark:text-white/35">Search</p>
        <div className="border-t border-gray-100 dark:border-white/8 p-4 rounded-b-xl">
          <div className="mb-3 flex items-center gap-2 rounded-full border border-gray-300 bg-white px-3 py-1.5 shadow-sm dark:border-white/15 dark:bg-[#303134]">
            <GoogleLogoSvg />
            <span className="flex-1 text-10 text-gray-400 dark:text-white/40">Search preview</span>
          </div>
          <div className="rounded-2xl border border-gray-200 bg-white p-3 shadow-sm dark:border-white/10 dark:bg-[#303134]">
            <div className="mb-1.5 flex items-center gap-2">
              <GoogleFavicon domain={domain} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[11px] font-medium text-gray-800 dark:text-[#e8eaed]">{domain}</p>
                <p className="truncate text-[10px] text-gray-500 dark:text-[#bdc1c6]">{domain}</p>
              </div>
              <span className="shrink-0 rounded border border-gray-500 px-1 py-px text-[9px] font-medium text-gray-500 dark:border-[#bdc1c6] dark:text-[#bdc1c6]">Ad</span>
            </div>
            <p className="mb-1 text-[16px] font-normal leading-snug text-[#1558d6] hover:underline dark:text-[#8ab4f8]">{titleLine}</p>
            <p className="text-[12px] leading-relaxed text-gray-600 dark:text-[#bdc1c6]">
              {descriptions[0] || <span className="text-gray-300 dark:text-white/20">Description will appear here.</span>}
            </p>
          </div>
        </div>
      </div>

      {/* Display preview */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm dark:border-white/10 dark:bg-[#181818]">
        <p className="px-3 pt-2.5 pb-1.5 text-10 font-semibold uppercase tracking-widest text-gray-400 dark:text-white/35">Display</p>
        <div className="border-t border-gray-100 dark:border-white/8 rounded-b-xl overflow-hidden">
          <div className="flex items-center gap-2.5 border-b border-gray-100 px-3 py-2 dark:border-white/5">
            <div className="h-5 w-5 rounded-full bg-gray-200 dark:bg-white/10" />
            <p className="text-10 font-semibold text-gray-900 dark:text-white">Sponsored</p>
            <p className="text-10 text-gray-400 dark:text-[#444]">· Display</p>
          </div>
          {imageUrl ? (
            <div className="relative aspect-video w-full">
              <img src={imageUrl} alt="Ad" className="h-full w-full object-cover" />
            </div>
          ) : isBlobPmaxVideo ? (
            <video src={form.pmaxVideoUrl} className="aspect-video w-full bg-black object-contain" controls />
          ) : youtubeId ? (
            <div className="relative aspect-video w-full bg-black">
              <iframe title="Ad video" src={`https://www.youtube.com/embed/${youtubeId}`} className="h-full w-full" allowFullScreen />
            </div>
          ) : (
            <div className="flex aspect-video w-full items-center justify-center bg-gray-100 dark:bg-white/5">
              <ImageIcon className="h-8 w-8 text-gray-300 dark:text-white/15" />
            </div>
          )}
          <div className="space-y-0.5 border-t border-gray-100 p-3 dark:border-white/8 bg-white dark:bg-[#181818]">
            <p className="text-[13px] font-semibold text-gray-900 dark:text-white">{headlines[0] || 'Headline'}</p>
            <p className="text-10 text-gray-400 dark:text-white/40">{domain}</p>
            <p className="mt-2">
              <span className="rounded-lg border border-gray-200 bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-900 dark:border-white/10 dark:bg-white/6 dark:text-white">Learn More</span>
            </p>
          </div>
        </div>
      </div>

      {/* Discovery / Gmail */}
      {(form.pmaxLongHeadline || descriptions[0]) && (
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm dark:border-white/10 dark:bg-[#181818]">
          <p className="px-3 pt-2.5 pb-1.5 text-10 font-semibold uppercase tracking-widest text-gray-400 dark:text-white/35">Discovery / Gmail</p>
          <div className="border-t border-gray-100 dark:border-white/8 p-3 rounded-b-xl">
            {imageUrl && <img src={imageUrl} alt="Ad" className="w-full h-24 object-cover rounded-lg mb-2" />}
            <p className="text-[13px] font-semibold text-gray-900 dark:text-[#e8eaed] line-clamp-2">{form.pmaxLongHeadline || headlines[0] || 'Long Headline'}</p>
            <p className="mt-0.5 text-xs text-gray-500 dark:text-white/50 line-clamp-2">{descriptions[0] || ''}</p>
            <p className="mt-1.5 text-10 font-semibold text-[#1a73e8]">{domain}</p>
          </div>
        </div>
      )}
    </div>
  );
}

function AssetsStep({ form, setField, errors, uploadingPmaxImage, onPmaxImageUpload, uploadingPmaxVideo, onPmaxVideoUpload }) {
  const handlePmaxImagePaste = (e) => {
    const file = getClipboardImageFiles(e.clipboardData, 1)[0] || null;
    if (!file) return;
    e.preventDefault();
    onPmaxImageUpload(file, 'image');
  };
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div className="flex flex-col gap-4">

      {/* Headlines */}
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-white/12 dark:bg-white/4">
        <p className="mb-1 text-10 font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40">Headlines</p>
        <p className="mb-3 text-10 text-gray-400 dark:text-white/30">3–5 required · max 30 chars each · must be unique</p>
        <div className="flex flex-col gap-1.5">
          {(form.pmaxHeadlines || ['', '', '']).map((h, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <div className="relative flex-1">
                <Input value={h} onChange={(e) => { const n = [...(form.pmaxHeadlines || ['','',''])]; n[i] = e.target.value.slice(0, 30); setField('pmaxHeadlines', n); }} placeholder={`Headline ${i + 1}`} className="pr-12" />
                <span className="pointer-events-none select-none absolute right-2.5 top-1/2 -translate-y-1/2 text-10 text-gray-400 dark:text-white/30">{h.length}/30</span>
              </div>
              {(form.pmaxHeadlines || []).length > 3 && (
                <button onClick={() => setField('pmaxHeadlines', (form.pmaxHeadlines || []).filter((_, j) => j !== i))} className="shrink-0 rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
          {(form.pmaxHeadlines || []).length < 5 && (
            <button onClick={() => setField('pmaxHeadlines', [...(form.pmaxHeadlines || []), ''])} className="flex items-center gap-1 rounded-xl border border-dashed border-gray-300 px-3 py-2 text-xs text-gray-400 hover:border-[#4285F4]/40 hover:text-[#4285F4] dark:border-white/10">
              <Plus className="h-3 w-3" /> Add headline
            </button>
          )}
          <FieldError msg={errors.pmaxHeadlines} />
        </div>
        <div className="mt-3">
          <Label required>Long headline <span className="text-gray-400 dark:text-white/30">(max 90 chars)</span></Label>
          <div className="relative">
            <Input value={form.pmaxLongHeadline} onChange={(e) => setField('pmaxLongHeadline', e.target.value.slice(0, 90))} placeholder="Longer headline shown in some placements" className="pr-14" />
            <span className="pointer-events-none select-none absolute right-2.5 top-1/2 -translate-y-1/2 text-10 text-gray-400 dark:text-white/30">{(form.pmaxLongHeadline || '').length}/90</span>
          </div>
          <FieldError msg={errors.pmaxLongHeadline} />
        </div>
      </div>

      {/* Descriptions */}
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-white/12 dark:bg-white/4">
        <p className="mb-1 text-10 font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40">Descriptions</p>
        <p className="mb-3 text-10 text-gray-400 dark:text-white/30">2–4 required · max 90 chars each</p>
        <div className="flex flex-col gap-1.5">
          {(form.pmaxDescriptions || ['', '']).map((d, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <div className="relative flex-1">
                <Input value={d} onChange={(e) => { const n = [...(form.pmaxDescriptions || ['',''])]; n[i] = e.target.value.slice(0, 90); setField('pmaxDescriptions', n); }} placeholder={`Description ${i + 1}`} className="pr-14" />
                <span className="pointer-events-none select-none absolute right-2.5 top-1/2 -translate-y-1/2 text-10 text-gray-400 dark:text-white/30">{d.length}/90</span>
              </div>
              {(form.pmaxDescriptions || []).length > 2 && (
                <button onClick={() => setField('pmaxDescriptions', (form.pmaxDescriptions || []).filter((_, j) => j !== i))} className="shrink-0 rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
          {(form.pmaxDescriptions || []).length < 4 && (
            <button onClick={() => setField('pmaxDescriptions', [...(form.pmaxDescriptions || []), ''])} className="flex items-center gap-1 rounded-xl border border-dashed border-gray-300 px-3 py-2 text-xs text-gray-400 hover:border-[#4285F4]/40 hover:text-[#4285F4] dark:border-white/10">
              <Plus className="h-3 w-3" /> Add description
            </button>
          )}
          <FieldError msg={errors.pmaxDescriptions} />
        </div>
      </div>

      {/* Media assets — at least one required */}
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-white/12 dark:bg-white/4">
        <p className="mb-1 text-10 font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40">Media assets</p>
        <p className="mb-3 text-10 text-gray-400 dark:text-white/30">Add an image <strong>or</strong> a YouTube video — at least one is required</p>
        <div className="flex flex-col gap-4">

          {/* Image */}
          <div>
            <Label>Image <span className="text-gray-400 dark:text-white/30">(landscape 1200×628)</span></Label>
            <Input value={form.pmaxImageUrl} onChange={(e) => setField('pmaxImageUrl', e.target.value)} placeholder="https://example.com/image.jpg" />
            <div className="mt-1.5 flex items-center gap-2" onPaste={handlePmaxImagePaste} tabIndex={0}>
              <span className="text-xs text-gray-400 dark:text-white/30">or upload</span>
              <label className="flex cursor-pointer items-center gap-1.5 rounded-xl border border-dashed border-gray-300 px-3 py-1.5 text-xs text-gray-500 transition-all hover:border-[#4285F4]/50 hover:text-[#4285F4] dark:border-white/10 dark:text-[#BEBEBE]">
                <input type="file" accept="image/jpeg,image/png,image/gif" className="hidden" onChange={(e) => { if (e.target.files[0]) { onPmaxImageUpload(e.target.files[0], 'image'); e.target.value = ''; } }} />
                {uploadingPmaxImage ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                {uploadingPmaxImage ? 'Uploading…' : 'Upload image'}
              </label>
              {(form.pmaxImageUrl || form.pmaxImageAssetRN) && <span className="rounded-full bg-[#4285F4]/10 px-2 py-0.5 text-10 font-semibold text-[#4285F4]">✓ Set</span>}
            </div>
          </div>

          <FieldError msg={errors.pmaxMedia} />
        </div>
      </div>
      </div>{/* end form column */}

      {/* Preview column */}
      <div className="hidden lg:block">
        <PmaxAdPreview form={form} />
      </div>
    </div>
  );
}

// ─── Step: Campaign (includes Budget & Bidding) ───────────────────────────────

function CampaignStep({ form, setField, setFields, errors, countryOptions, statusOptions, appPlatformOptions, appSubtypeOptions, videoGoalOptions, videoSubtypeOptions, objectives, goalOptions, schema, filteredDestinations, applyTemplate, schemaLoading }) {
  const channel = effectiveChannel(form);

  const handleGoalSelect = (value) => {
    const goalObj = (goalOptions || []).find((g) => g.value === value);
    const suggestedBidding = goalObj?.recommendedBidding || GOAL_TO_BIDDING[value] || 'MAXIMIZE_CONVERSIONS';
    const allowedDests = getDestinationsForGoal(value, schema);
    // Clear destination if it's no longer valid for the new goal
    const currentDest = form.destination;
    const destStillValid = !allowedDests || allowedDests.includes(currentDest);
    setFields({
      goal: value,
      biddingGoal: suggestedBidding,
      ...(!destStillValid ? { destination: '' } : {}),
    });
  };

  return (
    <div className="flex flex-col gap-4">

      {/* ── Basic info ── */}
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-white/12 dark:bg-white/4">
        <p className="mb-2 text-10 font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40">Basic info</p>
        <div className="flex flex-col gap-3">
          <div>
            <Label required>Campaign name</Label>
            <Input value={form.campaignName} onChange={(e) => setField('campaignName', e.target.value)} placeholder="e.g. Summer Sale 2025" maxLength={120} />
            <FieldError msg={errors.campaignName} />
          </div>
          <div>
            <Label>Website URL</Label>
            <Input value={form.websiteUrl} onChange={(e) => setField('websiteUrl', e.target.value)} placeholder="https://example.com" />
          </div>
          <div>
            <Label>Business name</Label>
            <Input value={form.businessName} onChange={(e) => setField('businessName', e.target.value)} placeholder="Your Brand or Company" maxLength={25} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Status</Label>
              <div className="flex items-center gap-3 h-9 px-3 rounded-lg border border-gray-200 bg-white dark:border-white/10 dark:bg-white/4">
                <span className={`text-xs font-medium ${form.status === 'ENABLED' ? 'text-green-600 dark:text-green-400' : 'text-gray-400 dark:text-white/40'}`}>
                  {form.status === 'ENABLED' ? 'Enabled' : 'Paused'}
                </span>
                <button
                  type="button"
                  onClick={() => setField('status', form.status === 'ENABLED' ? 'PAUSED' : 'ENABLED')}
                  className={`relative ml-auto inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${form.status === 'ENABLED' ? 'bg-green-500' : 'bg-gray-300 dark:bg-white/15'}`}
                >
                  <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 ease-in-out ${form.status === 'ENABLED' ? 'translate-x-4' : 'translate-x-0'}`} />
                </button>
              </div>
            </div>
            <div>
              <Label>Start date</Label>
              <Input type="date" value={form.startDate} onChange={(e) => setField('startDate', e.target.value)} />
            </div>
            <div>
              <Label>End date</Label>
              <Input type="date" value={form.endDate} onChange={(e) => setField('endDate', e.target.value)} />
              <FieldError msg={errors.endDate} />
            </div>
          </div>
        </div>
      </div>

      {/* ── Budget ── */}
      {(() => {
        const isVideoChannel = ['VIDEO', 'YOUTUBE_REACH', 'DEMAND_GEN'].includes(channel);
        if (!isVideoChannel && form.budgetType === 'CAMPAIGN_TOTAL') setField('budgetType', 'DAILY');

        return (
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-white/12 dark:bg-white/4">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-10 font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40">Budget</p>
              {isVideoChannel && (
                <div className="flex rounded-lg border border-gray-200 bg-white p-0.5 dark:border-white/10 dark:bg-white/5">
                  <button
                    type="button"
                    onClick={() => setField('budgetType', 'DAILY')}
                    className={`rounded-md px-2 py-0.5 text-10 font-semibold transition-all ${form.budgetType !== 'CAMPAIGN_TOTAL' ? 'bg-[#4285F4] text-white' : 'text-gray-500 hover:text-gray-900 dark:text-white/60 dark:hover:text-white'}`}
                  >
                    Daily
                  </button>
                  <button
                    type="button"
                    onClick={() => setField('budgetType', 'CAMPAIGN_TOTAL')}
                    className={`rounded-md px-2 py-0.5 text-10 font-semibold transition-all ${form.budgetType === 'CAMPAIGN_TOTAL' ? 'bg-[#4285F4] text-white' : 'text-gray-500 hover:text-gray-900 dark:text-white/60 dark:hover:text-white'}`}
                  >
                    Lifetime
                  </button>
                </div>
              )}
            </div>

            {form.budgetType === 'CAMPAIGN_TOTAL' ? (
              <div>
                <Label required>Lifetime budget</Label>
                <div className="relative">
                  <span className="absolute top-1/2 left-3 -translate-y-1/2 text-xs font-semibold text-gray-400 dark:text-white/40">₹</span>
                  <Input type="number" value={form.lifetimeBudget} onChange={(e) => setField('lifetimeBudget', e.target.value)} placeholder="500" className="pl-6" min="1" step="1" />
                </div>
                <p className="mt-1 text-10 text-gray-400 dark:text-white/40">Total spend for the campaign — start and end date required</p>
                <FieldError msg={errors.lifetimeBudget} />
              </div>
            ) : (
              <div>
                <Label required>Daily budget</Label>
                <div className="relative">
                  <span className="absolute top-1/2 left-3 -translate-y-1/2 text-xs font-semibold text-gray-400 dark:text-white/40">₹</span>
                  <Input type="number" value={form.dailyBudget} onChange={(e) => setField('dailyBudget', e.target.value)} placeholder="50" className="pl-6" min="0.01" step="1" />
                </div>
                <p className="mt-1 text-10 text-gray-400 dark:text-white/40">Minimum ₹0.01/day — Google spends up to 2× on high-traffic days</p>
                <FieldError msg={errors.dailyBudget} />
              </div>
            )}
          </div>
        );
      })()}

      {/* ── Objective selection ── */}
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-white/12 dark:bg-white/4">
        <p className="mb-2 text-10 font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40">Objective <span className="text-red-400">*</span></p>
        {schemaLoading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-400 dark:text-white/40">
            <Loader2 className="mr-2 h-4 w-4 animate-spin text-[#4285F4]" />
            Loading campaign objectives…
          </div>
        ) : objectives.length === 0 ? (
          <div className="py-4 text-center text-xs text-gray-400 dark:text-white/40">
            No objectives found. Please refresh or reopen the wizard.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {objectives.map(({ value, label, description }) => {
              const Icon = OBJECTIVE_ICONS[value] || Target;
              const active = form.objective === value;
              return (
                <div key={value} className={`rounded-xl transition-all ${active ? 'ring-2 ring-[#4285F4]' : 'ring-1 ring-gray-200 hover:ring-gray-300 dark:ring-white/8 dark:hover:ring-white/15'}`}>
                  <button
                    type="button"
                    onClick={() => setFields({ objective: value, destination: '', goal: '', biddingGoal: 'MAXIMIZE_CLICKS' })}
                    className="flex h-full w-full items-start gap-2.5 rounded-xl bg-white p-2.5 text-left transition-all hover:bg-gray-50 dark:bg-white/4 dark:hover:bg-white/6"
                  >
                    <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${active ? 'bg-[#4285F4] text-white' : 'bg-gray-100 text-gray-500 dark:bg-white/5 dark:text-white/55'}`}>
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold leading-tight text-gray-900 dark:text-white">{label}</p>
                      {description && <p className="mt-0.5 text-10 leading-snug text-gray-500 dark:text-white/55">{description}</p>}
                    </div>
                  </button>
                </div>
              );
            })}
          </div>
        )}
        <FieldError msg={errors.objective} />
        {/* Goal selection — shown when objective has conversion goals */}
      </div>

      {/* ── Conversion goal — shown when objective has goals ── */}
      {form.objective && goalOptions?.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-white/12 dark:bg-white/4">
          <p className="mb-0.5 text-10 font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40">Conversion goal <span className="text-red-400">*</span></p>
          <p className="mb-2 text-10 text-gray-400 dark:text-white/40">Google will optimise your bidding toward this goal.</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {goalOptions.map(({ value, label, description, recommendedBidding }) => {
              const active = form.goal === value;
              const bidding = recommendedBidding || GOAL_TO_BIDDING[value];
              return (
                <div key={value} className={`rounded-xl transition-all ${active ? 'ring-2 ring-[#4285F4]' : 'ring-1 ring-gray-200 hover:ring-gray-300 dark:ring-white/8 dark:hover:ring-white/15'}`}>
                  <button
                    type="button"
                    onClick={() => handleGoalSelect(value)}
                    className="flex h-full w-full flex-col items-start gap-1 rounded-xl bg-white p-2.5 text-left transition-all hover:bg-gray-50 dark:bg-white/4 dark:hover:bg-white/6"
                  >
                    <p className="text-xs font-semibold text-gray-900 dark:text-white">{label}</p>
                    {description && <p className="text-10 leading-snug text-gray-500 dark:text-white/55">{description}</p>}
                  </button>
                </div>
              );
            })}
          </div>
          <FieldError msg={errors.goal} />
        </div>
      )}

      {/* ── Campaign Type (destination) ── */}
      {form.objective && filteredDestinations?.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-white/12 dark:bg-white/4">
          <p className="mb-2 text-10 font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40">Campaign type <span className="text-red-400">*</span></p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {filteredDestinations.map(({ value, label, description }) => {
              const Icon = DESTINATION_ICONS[value] || MapPinned;
              const active = form.destination === value;
              return (
                <div key={value} className={`rounded-xl transition-all ${active ? 'ring-2 ring-[#4285F4]' : 'ring-1 ring-gray-200 hover:ring-gray-300 dark:ring-white/8 dark:hover:ring-white/15'}`}>
                  <button
                    type="button"
                    onClick={() => setField('destination', value)}
                    className="flex h-full w-full items-start gap-2.5 rounded-xl bg-white p-2.5 text-left transition-all hover:bg-gray-50 dark:bg-white/4 dark:hover:bg-white/6"
                  >
                    <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${active ? 'bg-[#4285F4] text-white' : 'bg-gray-100 text-gray-500 dark:bg-white/5 dark:text-white/55'}`}>
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-gray-900 dark:text-white">{label}</p>
                      {description && <p className="mt-0.5 text-10 leading-snug text-gray-600 dark:text-white/60">{description}</p>}
                    </div>
                  </button>
                </div>
              );
            })}
          </div>
          <FieldError msg={errors.destination} />
        </div>
      )}

      {/* ── Geo targeting (broad) ── */}
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-white/12 dark:bg-white/4">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-10 font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40">Campaign locations</p>
          <span className="text-10 text-gray-400 dark:text-white/40">Empty = Worldwide</span>
        </div>
        <div className="flex flex-wrap gap-1">
          {countryOptions.map(({ code, label }) => {
            const cur = form.countries || [];
            const active = cur.includes(code);
            return (
              <div key={code} className={`rounded-full transition-all ${active ? 'ring-2 ring-[#4285F4]' : 'ring-1 ring-gray-200 hover:ring-gray-300 dark:ring-white/8 dark:hover:ring-white/15'}`}>
                <button
                  type="button"
                  onClick={() => {
                    if (code === 'WW') {
                      // Clicking Worldwide clears all other specific countries
                      setField('countries', active ? [] : ['WW']);
                    } else {
                      // Clicking a specific country clears Worldwide and toggles this country
                      const withoutWw = cur.filter((c) => c !== 'WW');
                      setField(
                        'countries',
                        active ? withoutWw.filter((c) => c !== code) : [...withoutWw, code]
                      );
                    }
                  }}
                  className="flex items-center gap-0.5 rounded-full bg-white px-2 py-0.5 text-10 font-medium transition-all dark:bg-white/8 text-gray-700 dark:text-white/80"
                >
                  {active && <Check className="h-2.5 w-2.5 text-[#4285F4]" />}
                  {label}
                </button>
              </div>
            );
          })}
        </div>
        <FieldError msg={errors.countries} />
      </div>

      {/* ── EU Compliance notice — shown when EU/EEA/UK/CH is targeted ── */}
      {isEuTargeted(form.countries || []) && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 dark:border-amber-400/20 dark:bg-amber-400/5">
          <div className="mb-2 flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <p className="text-xs font-semibold text-amber-700 dark:text-amber-300">EU / EEA / UK / Switzerland — Consent Mode v2 required</p>
          </div>
          <p className="mb-3 text-xs leading-relaxed text-amber-700 dark:text-amber-200/80">
            Google requires <strong>Consent Mode v2</strong> for campaigns targeting these regions. Make sure the following are already configured on your website before launching. Without them Google will apply <strong>Limited Ad Serving</strong> and <strong>Reduced Measurement</strong>.
          </p>
          <ul className="flex flex-col gap-1.5">
            {[
              'Consent Mode v2 tag deployed on your site',
              'A CMP (Consent Management Platform) connected to Google',
              'ad_storage signal passed to Google',
              'analytics_storage signal passed to Google',
              'ad_user_data signal passed to Google',
              'ad_personalization signal passed to Google',
            ].map((item) => (
              <li key={item} className="flex items-center gap-2 text-xs text-amber-800 dark:text-amber-200">
                <span className="mt-px h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500 dark:bg-amber-400" />
                {item}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-10 text-amber-600 dark:text-amber-300/80">
            These settings must be configured in Google Tag Manager / your website — they cannot be set from here.
          </p>
        </div>
      )}

      {/* ── SHOPPING: Merchant Center ── */}
      {channel === 'SHOPPING' && (
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-white/12 dark:bg-white/4">
          <p className="mb-2 text-10 font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40">Shopping settings</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label required>Merchant Center ID</Label>
              <Input value={form.merchantCenterId} onChange={(e) => setField('merchantCenterId', e.target.value)} placeholder="123456789" />
            </div>
            <div>
              <Label>Product category</Label>
              <Input value={form.productCategory} onChange={(e) => setField('productCategory', e.target.value)} placeholder="e.g. Apparel & Accessories" />
            </div>
          </div>
        </div>
      )}

      {/* ── APP_PROMOTION ── */}
      {channel === 'APP_PROMOTION' && (
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-white/12 dark:bg-white/4">
          <p className="mb-2 text-10 font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40">App details</p>
          <div className="flex flex-col gap-3">
            {/* Campaign subtype — App installs / engagement / pre-registration */}
            <div>
              <Label>Campaign subtype</Label>
              <div className="flex flex-col gap-1.5">
                {(appSubtypeOptions || []).map(({ value, label, desc }) => (
                  <RadioCard key={value} active={form.appSubtype === value} onClick={() => setField('appSubtype', value)} label={label} desc={desc} />
                ))}
              </div>
            </div>
            <div>
              <Label required>App store URL</Label>
              <Input value={form.appStoreUrl} onChange={(e) => setField('appStoreUrl', e.target.value)} placeholder="https://play.google.com/store/apps/details?id=…" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Platform</Label>
                <Select value={form.appPlatform} onChange={(e) => setField('appPlatform', e.target.value)}>
                  {appPlatformOptions.map(({ value, label }) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </Select>
              </div>
              <div>
                <Label>App ID</Label>
                <Input value={form.appId} onChange={(e) => setField('appId', e.target.value)} placeholder="com.example.app" />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── YOUTUBE_REACH: campaign goal ── */}
      {channel === 'YOUTUBE_REACH' && (
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-white/12 dark:bg-white/4">
          <p className="mb-2 text-10 font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40">Campaign goal</p>
          <div className="flex flex-col gap-1.5">
            {(videoGoalOptions || []).map(({ value, label, desc }) => (
              <RadioCard key={value} active={form.videoGoal === value} onClick={() => setField('videoGoal', value)} label={label} desc={desc} />
            ))}
          </div>
        </div>
      )}

      {/* ── VIDEO / DEMAND_GEN: campaign subtype ── */}
      {['VIDEO', 'DEMAND_GEN'].includes(channel) && (
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-white/12 dark:bg-white/4">
          <p className="mb-2 text-10 font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40">Campaign subtype</p>
          <div className="flex flex-col gap-1.5">
            {(videoSubtypeOptions || []).map(({ value, label, desc }) => (
              <RadioCard key={value} active={form.videoSubtype === value} onClick={() => setField('videoSubtype', value)} label={label} desc={desc} />
            ))}
          </div>
        </div>
      )}

      {/* ── LOCAL_STORE ── */}
      {form.objective === 'LOCAL_STORE' && (
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-white/12 dark:bg-white/4">
          <p className="mb-2 text-10 font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40">Store location</p>
          <div className="flex flex-col gap-3">
            <div>
              <Label required>Store address</Label>
              <textarea
                value={form.storeAddress}
                onChange={(e) => setField('storeAddress', e.target.value)}
                placeholder="123 Main St, City, State, Country"
                rows={2}
                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs text-gray-900 outline-none transition-all placeholder:text-gray-400 focus:border-[#4285F4]/60 focus:ring-1 focus:ring-[#4285F4]/20 dark:border-white/8 dark:bg-[#1A1A1A] dark:text-white dark:placeholder:text-white/30 dark:focus:border-[#4285F4]/50 resize-none"
              />
            </div>
            <div>
              <Label>Location radius (km)</Label>
              <Input type="number" value={form.locationRadius} onChange={(e) => setField('locationRadius', e.target.value)} placeholder="10" />
              <p className="mt-1 text-10 text-gray-400 dark:text-white/30">Ads shown to users within this distance from the store</p>
            </div>
          </div>
        </div>
      )}

      {/* PMAX: only landing page URL + final URL suffix in Campaign step */}
      {channel === 'PERFORMANCE_MAX' && (
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-white/12 dark:bg-white/4">
          <p className="mb-2 text-10 font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40">Campaign settings</p>
          <div className="flex flex-col gap-3">
            <div>
              <Label required>Landing page URL</Label>
              <Input value={form.pmaxFinalUrl} onChange={(e) => setField('pmaxFinalUrl', e.target.value)} placeholder="https://example.com" />
              <FieldError msg={errors.pmaxFinalUrl} />
            </div>
            <div>
              <Label>Final URL suffix</Label>
              <Input value={form.finalUrlSuffix} onChange={(e) => setField('finalUrlSuffix', e.target.value)} placeholder="utm_source=google&utm_medium=pmax" />
            </div>
          </div>
        </div>
      )}

      {/* YouTube Reach — CPM note */}
      {channel === 'YOUTUBE_REACH' && (
        <div className="rounded-xl border border-blue-200/60 bg-blue-50/50 px-3 py-2 dark:border-[#4285F4]/20 dark:bg-[#4285F4]/5">
          <p className="text-10 text-blue-600 dark:text-[#4285F4]/80">
            YouTube Reach campaigns use CPM / vCPM bidding. Google optimises automatically toward your reach goal.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Step: Ad Group (includes Audience / Demographics) ───────────────────────

function AdGroupStep({ form, setField, errors, keywordMatchTypes, videoFormatOptions, genderOptions, countryOptions, biddingGoalOptions }) {
  const channel = effectiveChannel(form);
  const isPmax    = channel === 'PERFORMANCE_MAX';
  const isSearch  = ['SALES', 'LEADS', 'WEBSITE_TRAFFIC', 'SEARCH', 'LOCAL_STORE'].includes(channel);
  const isDisplay = channel === 'DISPLAY';
  const isVideo   = ['VIDEO', 'YOUTUBE_REACH', 'DEMAND_GEN', 'MULTI_CHANNEL', 'APP_PROMOTION'].includes(channel);

  const toggleGender = (g) => {
    const cur = form.genders || [];
    setField('genders', cur.includes(g) ? cur.filter((x) => x !== g) : [...cur, g]);
  };
  const toggleSegment = (seg) => {
    const cur = form.audienceSegments || [];
    setField('audienceSegments', cur.includes(seg) ? cur.filter((x) => x !== seg) : [...cur, seg]);
  };


  return (
    <div className="flex flex-col gap-4">

      {/* ── Ad group name + CPC ── */}
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-white/12 dark:bg-white/4">
        <p className="mb-2 text-10 font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40">Ad group</p>
        <div className="flex flex-col gap-3">
          <div>
            <Label required>Ad group name</Label>
            <Input value={form.adGroupName} onChange={(e) => setField('adGroupName', e.target.value)} placeholder="e.g. Summer Sale — Branded" maxLength={120} />
            <FieldError msg={errors.adGroupName} />
          </div>
          {isSearch && (
            <div>
              <Label>Max CPC bid</Label>
              <div className="relative">
                <span className="absolute top-1/2 left-3 -translate-y-1/2 text-xs font-semibold text-gray-400 dark:text-white/30">₹</span>
                <Input type="number" value={form.cpcBid} onChange={(e) => setField('cpcBid', e.target.value)} placeholder="1" className="pl-6" />
              </div>
              <p className="mt-1 text-10 text-gray-400 dark:text-white/30">Optional — leave blank for Smart Bidding to control</p>
              <FieldError msg={errors.cpcBid} />
            </div>
          )}
        </div>
      </div>

      {/* ── PMAX: Audience Signals banner ── */}
      {isPmax && (
        <div className="flex items-start gap-2.5 rounded-xl border border-blue-200 bg-blue-50 p-3 dark:border-[#4285F4]/25 dark:bg-[#4285F4]/10">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#4285F4]" />
          <div>
            <p className="text-xs font-semibold text-[#4285F4]">Audience Signals — not strict targeting</p>
            <p className="mt-0.5 text-10 text-blue-600 dark:text-white/50">Google AI uses these as starting signals and may expand beyond them to find conversions.</p>
          </div>
        </div>
      )}

      {/* ── Audience / Demographics ── */}
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-white/12 dark:bg-white/4">
        <p className="mb-4 text-10 font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40">
          {isPmax ? 'Audience signals' : 'Audience'}
        </p>

        {/* Age row */}
        <div className="mb-4 grid grid-cols-2 gap-3">
          <div>
            <Label>Min age</Label>
            <Input type="number" value={form.ageMin} onChange={(e) => setField('ageMin', e.target.value)} placeholder="18" min="18" max="65" />
            <FieldError msg={errors.ageMin} />
          </div>
          <div>
            <Label>Max age</Label>
            <Input type="number" value={form.ageMax} onChange={(e) => setField('ageMax', e.target.value)} placeholder="65" min="18" max="65" />
            <FieldError msg={errors.ageMax} />
          </div>
        </div>

        {/* Gender row */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium text-gray-500 dark:text-[#afafaf]">Gender</span>
            <span className="text-[11px] text-gray-400 dark:text-white/40">Empty = all genders</span>
          </div>
          <div className="flex gap-2">
            {(genderOptions || []).map(({ value, label }) => {
              const active = (form.genders || []).includes(value);
              return (
                <div key={value} className={`flex-1 rounded-full p-[1px] transition-all ${active ? 'bg-[#4285F4]' : 'bg-gray-200 hover:bg-gray-300 dark:bg-white/8 dark:hover:bg-white/15'}`}>
                  <button type="button" onClick={() => toggleGender(value)}
                    className="flex w-full items-center justify-center gap-1.5 rounded-full bg-gray-100 py-2 text-13 font-medium transition-all dark:bg-[#1d1d1d] text-gray-700 dark:text-white"
                  >
                    {active && <Check className="h-3 w-3 text-[#4285F4]" />}
                    {label}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Search keywords ── */}
      {isSearch && (
        <KeywordsSection form={form} setField={setField} matchTypes={keywordMatchTypes} />
      )}

      {/* ── Display / Video / PMAX: Interests & Segments ── */}
      {(isDisplay || isVideo || isPmax) && (
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-white/12 dark:bg-white/4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-10 font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40">
              {isPmax ? 'Audience signals — interests' : 'Interests & audience segments'}
            </p>
            <span className="text-[11px] text-gray-400 dark:text-white/40">
              {isPmax ? 'Signals only — AI may expand' : 'Optional · empty = let Google optimize'}
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {INTEREST_SEGMENTS.map(({ value, label }) => {
              const active = (form.audienceSegments || []).includes(value);
              return (
                <div key={value} className={`rounded-full transition-all ${active ? 'ring-2 ring-[#4285F4]' : 'ring-1 ring-gray-200 hover:ring-gray-300 dark:ring-white/8 dark:hover:ring-white/15'}`}>
                  <button type="button" onClick={() => toggleSegment(value)}
                    className="flex items-center gap-0.5 rounded-full bg-white px-2 py-0.5 text-10 font-medium transition-all dark:bg-white/8 text-gray-700 dark:text-white/80"
                  >
                    {active && <Check className="h-3 w-3 text-[#4285F4]" />}
                    {label}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Display / Video / PMAX: Custom segments & remarketing ── */}
      {(isDisplay || isVideo || isPmax) && (
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-white/12 dark:bg-white/4">
          <p className="mb-2 text-10 font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40">
            {isPmax ? 'Audience signals — custom & remarketing' : 'Custom segments & remarketing'}
          </p>
          <div className="flex flex-col gap-3">
            <div>
              <Label>Customer match list URL <span className="font-normal text-gray-400 dark:text-white/30">(optional)</span></Label>
              <Input value={form.customerMatchUrl || ''} onChange={(e) => setField('customerMatchUrl', e.target.value)} placeholder="Website URL your customers visited" />
              <p className="mt-1 text-10 text-gray-400 dark:text-white/30">Google will match visitors to your customer list</p>
            </div>
            <div>
              <Label>Custom segment keywords <span className="font-normal text-gray-400 dark:text-white/30">(optional)</span></Label>
              <Input value={form.customSegmentKeywords || ''} onChange={(e) => setField('customSegmentKeywords', e.target.value)} placeholder="e.g. buy running shoes, best gym equipment" />
              <p className="mt-1 text-10 text-gray-400 dark:text-white/30">Comma-separated — targets people who search these terms</p>
            </div>
          </div>
        </div>
      )}

      {/* ── PMAX: Search themes ── */}
      {isPmax && (
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-white/12 dark:bg-white/4">
          <p className="mb-1 text-10 font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40">Search themes <span className="font-normal normal-case tracking-normal text-gray-400 dark:text-white/30">— PMax only</span></p>
          <p className="mb-3 text-10 text-gray-400 dark:text-white/30">Tell Google what your customers search for — up to 25 themes</p>
          <Input value={form.pmaxSearchThemes || ''} onChange={(e) => setField('pmaxSearchThemes', e.target.value)} placeholder="e.g. buy shoes online, running gear, sports footwear" />
          <p className="mt-1 text-10 text-gray-400 dark:text-white/30">Comma-separated search themes</p>
        </div>
      )}

      {/* ── Display: frequency cap ── */}
      {isDisplay && (
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-white/12 dark:bg-white/4">
          <p className="mb-2 text-10 font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40">Frequency cap</p>
          <div>
            <Label>Max impressions per user per day</Label>
            <Input type="number" value={form.frequencyCap} onChange={(e) => setField('frequencyCap', e.target.value)} placeholder="3" />
            <p className="mt-1 text-10 text-gray-400 dark:text-white/30">Leave blank for Google to optimize automatically</p>
          </div>
        </div>
      )}

      {/* ── Bidding strategy (Search / Display ad group level) ── */}
      {(isSearch || isDisplay) && (
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-white/12 dark:bg-white/4">
          <p className="mb-2 text-10 font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40">Bidding strategy</p>
          <div>
            <Label>Bidding goal</Label>
            <Select value={form.biddingGoal} onChange={(e) => setField('biddingGoal', e.target.value)}>
              {(biddingGoalOptions || []).map(({ value, label }) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </Select>
          </div>
          {form.biddingGoal === 'TARGET_CPA' && (
            <div className="mt-3">
              <Label required>Target CPA (₹)</Label>
              <Input type="number" value={form.targetCpa} onChange={(e) => setField('targetCpa', e.target.value)} placeholder="500" />
              <FieldError msg={errors.targetCpa} />
            </div>
          )}
          {form.biddingGoal === 'TARGET_ROAS' && (
            <div className="mt-3">
              <Label required>Target ROAS (%)</Label>
              <Input type="number" value={form.targetRoas} onChange={(e) => setField('targetRoas', e.target.value)} placeholder="300" />
              <p className="mt-1 text-10 text-gray-400 dark:text-white/30">300% = ₹3 revenue per ₹1 spent</p>
              <FieldError msg={errors.targetRoas} />
            </div>
          )}
        </div>
      )}

      {/* ── Video format ── */}
      {isVideo && (
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-white/12 dark:bg-white/4">
          <p className="mb-2 text-10 font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40">Video format</p>
          <div className="flex flex-col gap-1.5">
            {videoFormatOptions.map(({ value, label, desc }) => (
              <RadioCard key={value} active={form.videoFormat === value} onClick={() => setField('videoFormat', value)} label={label} desc={desc} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Step: Ad (SEARCH) ────────────────────────────────────────────────────────

function SearchAdFields({ form, setField, errors }) {
  const headlines    = form.headlines    || ['', '', ''];
  const descriptions = form.descriptions || ['', ''];

  const setHeadline = (i, v) => { const n = [...headlines]; n[i] = v; setField('headlines', n); };
  const addHeadline = () => { if (headlines.length < 15) setField('headlines', [...headlines, '']); };
  const removeHeadline = (i) => { if (headlines.length > 3) setField('headlines', headlines.filter((_, j) => j !== i)); };

  const setDesc = (i, v) => { const n = [...descriptions]; n[i] = v; setField('descriptions', n); };
  const addDesc = () => { if (descriptions.length < 4) setField('descriptions', [...descriptions, '']); };
  const removeDesc = (i) => { if (descriptions.length > 2) setField('descriptions', descriptions.filter((_, j) => j !== i)); };

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-white/12 dark:bg-white/4">
        <p className="mb-2 text-10 font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40">Headlines (3–15, max 30 chars each)</p>
        <div className="flex flex-col gap-1.5">
          {headlines.map((h, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <div className="relative flex-1">
                <Input value={h} onChange={(e) => setHeadline(i, e.target.value)} placeholder={`Headline ${i + 1}`} maxLength={30} className="pr-12" />
                <span className="pointer-events-none select-none absolute top-1/2 right-2.5 -translate-y-1/2 text-10 text-gray-400 dark:text-white/30">{h.length}/30</span>
              </div>
              {headlines.length > 3 && (
                <button type="button" onClick={() => removeHeadline(i)} className="shrink-0 rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10">
                  <Trash2 className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}
          {headlines.length < 15 && (
            <button type="button" onClick={addHeadline} className="flex items-center gap-1 rounded-xl border border-dashed border-gray-300 px-3 py-2 text-xs text-gray-400 transition-all hover:border-[#4285F4]/40 hover:text-[#4285F4] dark:border-white/10">
              <Plus className="h-3 w-3" /> Add headline
            </button>
          )}
        </div>
        <FieldError msg={errors.headlines} />
      </div>

      <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-white/12 dark:bg-white/4">
        <p className="mb-2 text-10 font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40">Descriptions (2–4, max 90 chars each)</p>
        <div className="flex flex-col gap-1.5">
          {descriptions.map((d, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <div className="relative flex-1">
                <Input value={d} onChange={(e) => setDesc(i, e.target.value)} placeholder={`Description ${i + 1}`} maxLength={90} className="pr-14" />
                <span className="pointer-events-none select-none absolute top-1/2 right-2.5 -translate-y-1/2 text-10 text-gray-400 dark:text-white/30">{d.length}/90</span>
              </div>
              {descriptions.length > 2 && (
                <button type="button" onClick={() => removeDesc(i)} className="shrink-0 rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10">
                  <Trash2 className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}
          {descriptions.length < 4 && (
            <button type="button" onClick={addDesc} className="flex items-center gap-1 rounded-xl border border-dashed border-gray-300 px-3 py-2 text-xs text-gray-400 transition-all hover:border-[#4285F4]/40 hover:text-[#4285F4] dark:border-white/10">
              <Plus className="h-3 w-3" /> Add description
            </button>
          )}
        </div>
        <FieldError msg={errors.descriptions} />
      </div>

      <div>
        <Label required>Landing page URL</Label>
        <Input value={form.finalUrl} onChange={(e) => setField('finalUrl', e.target.value)} placeholder="https://example.com" />
        <FieldError msg={errors.finalUrl} />
      </div>

      <div className="rounded-xl border border-blue-200/60 bg-blue-50/50 px-3 py-2 dark:border-[#4285F4]/20 dark:bg-[#4285F4]/5">
        <p className="text-10 text-blue-600 dark:text-[#4285F4]/80">
          SEARCH ads show headlines + descriptions only. No CTA button — Google renders the display URL automatically.
        </p>
      </div>
    </div>
  );
}

// ─── Step: Ad (DISPLAY) ───────────────────────────────────────────────────────

function DisplayAdFields({ form, setField, errors, ctaOptions, uploadingImage, onImageUpload }) {
  const handleImagePaste = (e) => {
    const file = getClipboardImageFiles(e.clipboardData, 1)[0] || null;
    if (!file) return;
    e.preventDefault();
    onImageUpload(file);
  };
  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="flex items-center justify-between mb-1"><Label required>Headline</Label><CharCount val={form.headline} max={30} /></div>
        <Input value={form.headline} onChange={(e) => setField('headline', e.target.value)} placeholder="Best Deals Online" maxLength={30} />
        <FieldError msg={errors.headline} />
      </div>
      <div>
        <div className="flex items-center justify-between mb-1"><Label required>Description</Label><CharCount val={form.description} max={90} /></div>
        <Input value={form.description} onChange={(e) => setField('description', e.target.value)} placeholder="Find the best products at unbeatable prices." maxLength={90} />
        <FieldError msg={errors.description} />
      </div>
      <div>
        <Label required>Image</Label>
        <Input value={form.imageUrl} onChange={(e) => setField('imageUrl', e.target.value)} placeholder="https://example.com/banner.jpg" />
        <div className="mt-2 flex items-center gap-2" onPaste={handleImagePaste} tabIndex={0}>
          <span className="text-xs text-gray-400 dark:text-white/30">or</span>
          <label className="flex cursor-pointer items-center gap-1.5 rounded-xl border border-dashed border-gray-300 px-3 py-1.5 text-xs text-gray-500 transition-all hover:border-[#4285F4]/50 hover:text-[#4285F4] dark:border-white/10 dark:text-[#BEBEBE]">
            <input type="file" accept="image/jpeg,image/png,image/gif,.jpg,.jpeg,.png,.gif" className="hidden" onChange={(e) => { if (e.target.files[0]) onImageUpload(e.target.files[0]); }} />
            {uploadingImage ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
            {uploadingImage ? 'Uploading…' : 'Upload image'}
          </label>
          {form.assetResourceName && (
            <span className="rounded-full bg-[#4285F4]/10 px-2 py-0.5 text-10 font-semibold text-[#4285F4]">Uploaded ✓</span>
          )}
        </div>
        <p className="mt-1.5 text-10 text-gray-400 dark:text-white/25">JPEG, PNG, GIF only. 1200×628 recommended.</p>
        <FieldError msg={errors.imageUrl} />
      </div>
      <div>
        <Label required>Landing page URL</Label>
        <Input value={form.finalUrl} onChange={(e) => setField('finalUrl', e.target.value)} placeholder="https://example.com" />
        <FieldError msg={errors.finalUrl} />
      </div>
      <div>
        <Label>Call to action</Label>
        <Select value={form.callToAction} onChange={(e) => setField('callToAction', e.target.value)}>
          <option value="">None</option>
          {ctaOptions.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </Select>
      </div>
    </div>
  );
}

// ─── Step: Ad (DEMAND_GEN / Video) ────────────────────────────────────────────

function VideoAdFields({ form, setField, errors, ctaOptions, uploadingVideo, onVideoUpload }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-white/12 dark:bg-white/4">
        <p className="mb-2 text-10 font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40">Video source (one required)</p>
        <div className="flex flex-col gap-2">
          {/* YouTube URL input */}
          <div>
            <Label>YouTube URL or video ID</Label>
            <Input
              value={form.videoUrl?.startsWith('blob:') ? '' : (form.videoUrl || '')}
              onChange={(e) => { setField('videoUrl', e.target.value); if (form.videoFile) { setField('videoFile', null); } }}
              placeholder="https://www.youtube.com/watch?v=… or 11-char ID"
            />
          </div>
          {/* Upload row */}
          <div className="flex items-center gap-2">
            <span className="text-10 text-gray-400 dark:text-white/30">or upload a video file</span>
            <label className="flex cursor-pointer items-center gap-1.5 rounded-xl border border-dashed border-gray-300 px-2.5 py-1 text-xs text-gray-500 transition-all hover:border-[#4285F4]/50 hover:text-[#4285F4] dark:border-white/10 dark:text-[#BEBEBE]">
              <input type="file" accept="video/mp4,video/webm,video/ogg,video/quicktime,video/x-msvideo,.mp4,.webm,.mov,.avi" className="hidden" onChange={(e) => { if (e.target.files[0]) onVideoUpload(e.target.files[0]); }} />
              {uploadingVideo ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
              {uploadingVideo ? 'Uploading to YouTube…' : 'Upload video'}
            </label>
            {form.videoFile && (
              <span className="max-w-[110px] truncate rounded-full bg-[#4285F4]/10 px-2 py-0.5 text-10 font-semibold text-[#4285F4]">
                ✓ {form.videoFile.name}
              </span>
            )}
          </div>
          {form.videoFile && uploadingVideo && (
            <p className="text-10 text-blue-400">Uploading to YouTube, please wait…</p>
          )}
        </div>
        <FieldError msg={errors.videoUrl} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <div className="flex items-center justify-between"><Label>Headline</Label><CharCount val={form.headline} max={30} /></div>
          <Input value={form.headline} onChange={(e) => setField('headline', e.target.value)} placeholder="Watch Our Story" maxLength={30} />
          <FieldError msg={errors.headline} />
        </div>
        <div>
          <div className="flex items-center justify-between"><Label>Long headline</Label><CharCount val={form.longHeadline} max={90} /></div>
          <Input value={form.longHeadline} onChange={(e) => setField('longHeadline', e.target.value)} placeholder="Watch Our Story – Discover More Today" maxLength={90} />
          <FieldError msg={errors.longHeadline} />
        </div>
        <div className="sm:col-span-2">
          <div className="flex items-center justify-between"><Label>Description</Label><CharCount val={form.description} max={90} /></div>
          <Input value={form.description} onChange={(e) => setField('description', e.target.value)} placeholder="Check out our latest offer." maxLength={90} />
          <FieldError msg={errors.description} />
        </div>
        <div>
          <Label required>Landing page URL</Label>
          <Input value={form.finalUrl} onChange={(e) => setField('finalUrl', e.target.value)} placeholder="https://example.com" />
          <FieldError msg={errors.finalUrl} />
        </div>
        <div>
          <Label>Call to action</Label>
          <Select value={form.callToAction} onChange={(e) => setField('callToAction', e.target.value)}>
            <option value="">None</option>
            {ctaOptions.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </Select>
        </div>
      </div>

      <div className="rounded-xl border border-amber-200/60 bg-amber-50/50 px-3 py-2 dark:border-amber-400/20 dark:bg-amber-400/5">
        <p className="text-10 text-amber-700 dark:text-amber-400/80">
          <strong>businessName</strong> and <strong>logoUrl</strong> are handled internally — auto-fetched from the Google Ads account name and YouTube thumbnail.
        </p>
      </div>
    </div>
  );
}

// ─── Step: Ad (dispatcher) ────────────────────────────────────────────────────

// ─── Ad Preview ───────────────────────────────────────────────────────────────

function GoogleLogoSvg() {
  return (
    <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
    </svg>
  );
}

function GoogleFavicon({ domain }) {
  const letter = (domain || 'A').replace('www.', '')[0].toUpperCase();
  return (
    <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gray-100 dark:bg-white/10">
      <span className="text-[8px] font-bold text-gray-500 dark:text-white/50">{letter}</span>
    </div>
  );
}

function isValidUrl(str) {
  try { return Boolean(str && new URL(str)); } catch { return false; }
}

function SkeletonLine({ w = 'w-full', h = 'h-2.5' }) {
  return <div className={`${w} ${h} rounded-full bg-gray-200 dark:bg-white/10`} />;
}

function SearchAdPreview({ form }) {
  const headlines    = (form.headlines    || []).filter(Boolean);
  const descriptions = (form.descriptions || []).filter(Boolean);
  const rawUrl       = form.finalUrl || '';
  let domainDisplay  = 'www.example.com';
  let breadcrumb     = '';
  if (isValidUrl(rawUrl)) {
    try {
      const u = new URL(rawUrl);
      domainDisplay = u.hostname;
      const parts = [u.hostname.replace('www.', '')];
      if (form.path1) parts.push(form.path1);
      if (form.path2) parts.push(form.path2);
      breadcrumb = parts.join('/');
    } catch { /* ignore */ }
  }
  const titleLine = headlines.slice(0, 3).join(' - ') || 'Your Headline Here';
  const desc      = descriptions.slice(0, 2).join(' ') || '';
  const ctaPills  = headlines.slice(3, 6).filter(Boolean);

  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-md dark:border-white/10 dark:bg-[#1c1c1e] overflow-hidden">
      <p className="px-4 pt-3 pb-2 text-10 font-semibold uppercase tracking-widest text-gray-400 dark:text-white/35">Ad Preview · Search</p>
      {/* Phone frame */}
      <div className="mx-3 mb-3 overflow-hidden rounded-[22px] border-2 border-gray-300 bg-white dark:border-white/15 dark:bg-[#f8f9fa] shadow-lg">
        {/* Phone top bar */}
        <div className="flex items-center justify-between bg-white px-4 py-2.5 dark:bg-[#f8f9fa]">
          {/* Hamburger */}
          <div className="flex flex-col gap-1">
            <div className="h-0.5 w-4 rounded bg-gray-600" />
            <div className="h-0.5 w-4 rounded bg-gray-600" />
            <div className="h-0.5 w-4 rounded bg-gray-600" />
          </div>
          {/* Google logo */}
          {/* Google wordmark */}
          <span className="text-[22px] font-normal tracking-tight" style={{fontFamily:'arial,sans-serif'}}>
            <span style={{color:'#4285F4'}}>G</span>
            <span style={{color:'#EA4335'}}>o</span>
            <span style={{color:'#FBBC05'}}>o</span>
            <span style={{color:'#4285F4'}}>g</span>
            <span style={{color:'#34A853'}}>l</span>
            <span style={{color:'#EA4335'}}>e</span>
          </span>
          {/* Avatar circle */}
          <div className="h-7 w-7 rounded-full bg-gray-300" />
        </div>

        {/* Search bar */}
        <div className="mx-3 mb-2 flex items-center gap-2 rounded-full border border-gray-300 bg-white px-3 py-1.5 shadow-sm">
          <svg className="h-3.5 w-3.5 text-gray-400" viewBox="0 0 24 24" fill="currentColor">
            <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
          </svg>
          <span className="flex-1 text-[11px] text-gray-400">Search</span>
        </div>

        {/* Nav tabs skeleton */}
        <div className="flex gap-3 border-b border-gray-200 px-3 pb-1.5">
          {['w-8','w-10','w-8','w-12','w-8'].map((w,i) => (
            <div key={i} className={`${w} h-1.5 rounded-full ${i===0 ? 'bg-[#4285F4]' : 'bg-gray-200'}`} />
          ))}
        </div>

        {/* Ad result */}
        <div className="px-3 pt-3 pb-2">
          <div className="rounded-xl border border-gray-100 bg-white p-3 shadow-sm">
            {/* URL row */}
            <div className="mb-1.5 flex items-center gap-1.5">
              <div className="flex h-4 w-4 items-center justify-center rounded-full bg-gray-100">
                <svg className="h-2.5 w-2.5 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20M12 2a14.5 14.5 0 0 1 0 20M2 12h20"/>
                </svg>
              </div>
              <div>
                <p className="text-[11px] font-medium text-gray-800">{domainDisplay}</p>
                <p className="text-[10px] text-gray-500">{breadcrumb || domainDisplay}</p>
              </div>
              <span className="ml-auto rounded border border-gray-400 px-1 py-px text-[9px] text-gray-500">Ad</span>
            </div>
            {/* Headline */}
            <p className="mb-1 text-[15px] font-normal leading-snug text-[#1558d6] hover:underline cursor-pointer">
              {titleLine}
            </p>
            {/* Description */}
            <p className="text-[12px] leading-relaxed text-gray-600">
              {desc || <span className="text-gray-300">Your description appears here.</span>}
            </p>
            {/* CTA pills */}
            {ctaPills.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {ctaPills.map((pill, i) => (
                  <span key={i} className="rounded-full border border-gray-300 px-2.5 py-1 text-[11px] text-gray-700">{pill}</span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Organic skeleton results */}
        <div className="space-y-3 px-3 pb-4">
          {[0,1].map(i => (
            <div key={i} className="flex gap-2">
              <div className="mt-1 h-6 w-6 shrink-0 rounded-full bg-gray-200" />
              <div className="flex-1 space-y-1.5">
                <SkeletonLine w="w-3/4" h="h-2" />
                <SkeletonLine w="w-full" h="h-2" />
                <SkeletonLine w="w-5/6" h="h-2" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AdImageSlot({ url, height = 'h-36', placeholder = 'Image preview' }) {
  const valid = isValidUrl(url);
  if (valid) return <img src={url} alt="preview" className={`w-full ${height} object-cover`} />;
  return (
    <div className={`flex ${height} w-full items-center justify-center bg-gray-100 dark:bg-white/5`}>
      <span className="text-xs text-gray-400 dark:text-white/30">{placeholder}</span>
    </div>
  );
}

function DisplayAdPreview({ form }) {
  const ctaLabel      = form.callToAction ? form.callToAction.replace(/_/g, ' ') : 'Learn More';
  const rawUrl        = form.finalUrl || '';
  const domainDisplay = isValidUrl(rawUrl) ? new URL(rawUrl).hostname.replace('www.', '') : (rawUrl || 'your-website.com');
  const headline      = form.headline || '';
  const description   = form.description || '';
  const hasImage      = isValidUrl(form.imageUrl);
  const adEnabled     = form.adStatus !== 'PAUSED';

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-white/10 dark:bg-[#181818]">
      {/* Header — matches GoogleAdDrawer exactly */}
      <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3 dark:border-white/12">
        <p className="text-sm font-bold text-gray-900 dark:text-white">Ad Preview</p>
        <span className="rounded-full border border-gray-200 bg-gray-100 px-2 py-0.5 text-10 font-semibold text-gray-500 dark:border-white/10 dark:bg-white/5 dark:text-white/50">Display</span>
      </div>

      {/* Sponsored row */}
      <div className="flex items-center gap-2.5 border-b border-gray-200 px-4 py-2.5 dark:border-white/5">
        <div className="h-7 w-7 rounded-full bg-gray-200 dark:bg-white/10" />
        <div>
          <p className="text-xs font-semibold text-gray-900 dark:text-white">Sponsored</p>
          <p className="text-10 text-gray-400 dark:text-[#555]">Google · Display</p>
        </div>
      </div>

      {/* Image — aspect-video, same as drawer */}
      {hasImage ? (
        <div className="relative aspect-video w-full">
          <img src={form.imageUrl} alt={headline || 'Ad preview'} className="h-full w-full object-cover" />
        </div>
      ) : (
        <div className="flex aspect-video w-full items-center justify-center bg-gray-100 dark:bg-white/5">
          <div className="text-center">
            <ImageIcon className="mx-auto h-10 w-10 text-gray-300 dark:text-white/15" />
            <p className="mt-2 text-xs text-gray-400 dark:text-white/30">Upload an image to preview</p>
          </div>
        </div>
      )}

      {/* Brand + copy + CTA — matches drawer */}
      <div className="space-y-2 border-t border-gray-200 p-4 dark:border-white/8">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-white/40">{domainDisplay}</p>
        <p className="text-sm font-semibold text-gray-900 dark:text-white">
          {headline || <span className="text-gray-300 dark:text-white/20">—</span>}
        </p>
        {description && <p className="text-xs leading-relaxed text-gray-500 dark:text-white/60">{description}</p>}
        <div className="mt-3 flex items-center justify-between">
          <span className="rounded-lg border border-gray-200 bg-gray-100 px-3 py-1.5 text-xs font-semibold text-gray-900 dark:border-white/10 dark:bg-white/6 dark:text-white">
            {ctaLabel}
          </span>
          <span className="text-[11px] text-gray-400 dark:text-white/30">{rawUrl || domainDisplay}</span>
        </div>
      </div>

      {/* Details section — same as drawer */}
      <div className="space-y-3 border-t border-gray-200 p-4 dark:border-white/8">
        <p className="text-10 font-bold uppercase tracking-wider text-gray-400 dark:text-white/40">Details</p>
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-400 dark:text-white/40">Status</span>
          <span className={`flex items-center gap-1.5 text-xs font-semibold ${adEnabled ? 'text-green-500' : 'text-orange-400'}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${adEnabled ? 'bg-green-500' : 'bg-orange-400'}`} />
            {adEnabled ? 'Enabled' : 'Paused'}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-400 dark:text-white/40">Format</span>
          <span className="text-xs font-medium text-gray-700 dark:text-white/70">Responsive Display Ad</span>
        </div>
        {rawUrl && (
          <div>
            <p className="mb-0.5 text-xs text-gray-400 dark:text-white/40">Final URL</p>
            <p className="break-all text-xs text-gray-600 dark:text-white/70">{rawUrl}</p>
          </div>
        )}
        {form.callToAction && (
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-400 dark:text-white/40">Call to action</span>
            <span className="text-xs font-medium text-gray-700 dark:text-white/70">{ctaLabel}</span>
          </div>
        )}
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-400 dark:text-white/40">Image</span>
          <span className={`text-xs font-medium ${hasImage ? 'text-green-500' : 'text-gray-400 dark:text-white/30'}`}>
            {hasImage ? '✓ Ready' : 'Not uploaded'}
          </span>
        </div>
      </div>
    </div>
  );
}

function VideoAdPreview({ form }) {
  const videoUrl  = form.videoUrl || form.youtubeVideoId || '';
  const isBlobVideo = videoUrl.startsWith('blob:');
  const youtubeId = !isBlobVideo && (form.youtubeVideoId || videoUrl.match(/(?:v=|youtu\.be\/)([A-Za-z0-9_-]{11})/)?.[1] || (videoUrl.length === 11 ? videoUrl : null));
  const embedSrc  = youtubeId ? `https://www.youtube.com/embed/${youtubeId}` : null;
  const ctaLabel  = form.callToAction ? form.callToAction.replace(/_/g, ' ') : 'Learn More';
  const rawUrl    = form.finalUrl || '';
  const domainDisplay = isValidUrl(rawUrl) ? new URL(rawUrl).hostname.replace('www.', '') : 'your-website.com';
  const headline  = form.headline || '';
  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm dark:border-white/10 dark:bg-[#181818]">
      <p className="px-3 pt-2.5 pb-2 text-10 font-semibold uppercase tracking-widest text-gray-400 dark:text-white/35">Ad Preview · Video</p>
      <div className="border-t border-gray-100 dark:border-white/8 rounded-b-xl overflow-hidden">
        {/* Sponsored header */}
        <div className="flex items-center gap-2.5 border-b border-gray-200 px-4 py-2.5 dark:border-white/5 bg-white dark:bg-[#181818]">
          <div className="h-7 w-7 rounded-full bg-gray-200 dark:bg-white/10" />
          <div>
            <p className="text-xs font-semibold text-gray-900 dark:text-white">Sponsored</p>
            <p className="text-10 text-gray-400 dark:text-[#444]">Google · Video</p>
          </div>
        </div>
        {/* Video — blob upload, YouTube embed, or placeholder */}
        {isBlobVideo ? (
          <video src={videoUrl} className="aspect-video w-full bg-black object-contain" controls />
        ) : embedSrc ? (
          <div className="relative aspect-video w-full bg-black">
            <iframe
              title="Ad video"
              src={embedSrc}
              className="h-full w-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        ) : (
          <div className="flex aspect-video w-full items-center justify-center bg-black">
            <div className="text-center">
              <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full border-2 border-white/20">
                <div className="ml-1 h-0 w-0 border-y-[8px] border-l-[16px] border-y-transparent border-l-white/40" />
              </div>
              <span className="text-10 text-white/30">Upload a video or paste YouTube URL</span>
            </div>
          </div>
        )}
        {/* Brand + CTA footer */}
        <div className="space-y-1 border-t border-gray-200 p-4 dark:border-white/8 bg-white dark:bg-[#181818]">
          <p className="text-sm font-semibold text-gray-900 dark:text-white">{headline || <span className="text-gray-300 dark:text-white/20">Headline</span>}</p>
          <p className="text-10 text-gray-400 dark:text-white/40">{domainDisplay}</p>
          {form.description && <p className="text-xs leading-relaxed text-gray-500 dark:text-white/60">{form.description}</p>}
          <div className="mt-3">
            <span className="rounded-lg border border-gray-200 bg-gray-100 px-3 py-1.5 text-xs font-semibold text-gray-900 dark:border-white/10 dark:bg-white/6 dark:text-white">
              {ctaLabel}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function AdStatusToggle({ form, setField }) {
  const adEnabled = form.adStatus !== 'PAUSED';
  return (
    <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 dark:border-white/10 dark:bg-white/4">
      <div>
        <p className="text-xs font-semibold text-gray-700 dark:text-white/80">Ad status</p>
        <p className="text-10 text-gray-400 dark:text-white/40">Control whether this ad runs after launch</p>
      </div>
      <div className="flex items-center gap-2.5">
        <span className={`text-xs font-semibold ${adEnabled ? 'text-green-500' : 'text-orange-400'}`}>
          {adEnabled ? 'Enabled' : 'Paused'}
        </span>
        <button
          type="button"
          onClick={() => setField('adStatus', adEnabled ? 'PAUSED' : 'ENABLED')}
          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${adEnabled ? 'bg-green-500' : 'bg-orange-400'}`}
        >
          <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 ease-in-out ${adEnabled ? 'translate-x-4' : 'translate-x-0'}`} />
        </button>
      </div>
    </div>
  );
}

function AdStep({ form, setField, errors, ctaOptions, uploadingImage, onImageUpload, adType, uploadingVideo, onVideoUpload }) {
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-5">
      <div className="min-w-0 flex-1 self-start flex flex-col gap-4">
        {/* Ad type badge */}
        <div className="flex items-center gap-2">
          <span className="shrink-0 whitespace-nowrap rounded-full border border-gray-200 bg-gray-100 px-2.5 py-0.5 text-10 font-semibold uppercase tracking-wider text-gray-500 dark:border-white/8 dark:bg-white/5 dark:text-[#BEBEBE]">
            {adType} ad
          </span>
          <p className="text-xs text-gray-500 dark:text-[#BEBEBE]">
            {adType === 'SEARCH'     && 'Responsive search ad'}
            {adType === 'DISPLAY'    && 'Single image + headline'}
            {adType === 'DEMAND_GEN' && 'YouTube / Discover / Gmail'}
          </p>
        </div>
        {/* Fields */}
        {adType === 'SEARCH'     && <SearchAdFields form={form} setField={setField} errors={errors} />}
        {adType === 'DISPLAY'    && <DisplayAdFields form={form} setField={setField} errors={errors} ctaOptions={ctaOptions} uploadingImage={uploadingImage} onImageUpload={onImageUpload} />}
        {adType === 'DEMAND_GEN' && <VideoAdFields form={form} setField={setField} errors={errors} ctaOptions={ctaOptions} uploadingVideo={uploadingVideo} onVideoUpload={onVideoUpload} />}
        {/* Status toggle — bottom of form */}
        <AdStatusToggle form={form} setField={setField} />
      </div>
      <div className="w-full self-start lg:w-[340px] lg:shrink-0 lg:sticky lg:top-4">
        {adType === 'SEARCH'     && <SearchAdPreview form={form} />}
        {adType === 'DISPLAY'    && <DisplayAdPreview form={form} />}
        {adType === 'DEMAND_GEN' && <VideoAdPreview form={form} />}
      </div>
    </div>
  );
}

// ─── Campaign Templates ────────────────────────────────────────────────────────

// Strip imageFile before serialising — not JSON-safe and not reusable.
// Also drop keywords with no text — they're a SEARCH-only concept and the
// wizard seeds a blank placeholder row by default for every destination.
function stripUnsavable(form) {
  const { imageFile: _i, keywords, ...rest } = form;
  const validKeywords = (keywords || []).filter((k) => k?.text?.trim());
  return validKeywords.length ? { ...rest, keywords: validKeywords } : rest;
}

// "Save as template" — shown on Review step in create-full mode.
function SaveAsTemplateChip({ form, adAccountId }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      await saveGoogleCampaignTemplate({
        name: trimmed,
        payload: { ...stripUnsavable(form), adAccountId },
        objective: form.objective,
        destination: form.destination,
      });
      globalToast.success(`Template "${trimmed}" saved.`);
      setOpen(false);
      setName('');
    } catch (e) {
      globalToast.error(e?.response?.data?.error || 'Failed to save template.');
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-semibold text-gray-600 transition-colors hover:border-gray-300 hover:text-gray-900 dark:border-white/12 dark:bg-white/4 dark:text-white/75 dark:hover:border-white/25 dark:hover:text-white"
      >
        <BookmarkPlus className="h-3.5 w-3.5" /> Save as template
      </button>
    );
  }
  return (
    <div className="flex items-center gap-1.5 rounded-full border border-gray-300 bg-gray-50 px-1 py-1 dark:border-white/15 dark:bg-white/4">
      <input
        type="text"
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleSave();
          if (e.key === 'Escape') { setOpen(false); setName(''); }
        }}
        placeholder="Template name…"
        maxLength={120}
        className="w-48 rounded-full bg-transparent px-3 py-1 text-xs text-gray-900 placeholder:text-gray-400 focus:outline-none dark:text-white dark:placeholder:text-white/40"
      />
      <button
        type="button"
        onClick={handleSave}
        disabled={!name.trim() || saving}
        className="flex items-center gap-1 rounded-full bg-[#4285F4] px-3 py-1 text-xs font-bold text-white shadow-sm transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
        Save
      </button>
      <button
        type="button"
        onClick={() => { setOpen(false); setName(''); }}
        disabled={saving}
        className="flex h-6 w-6 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-white/45 dark:hover:bg-white/8 dark:hover:text-white"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// "Start from template" — shown on Objective step.
function TemplatePicker({ onApply }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [applyingId, setApplyingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // Lazy-load when dropdown opens — avoids a network call on every wizard mount.
  useEffect(() => {
    if (!open || items.length) return undefined;
    let cancelled = false;
    setLoading(true);
    listGoogleCampaignTemplates()
      .then((r) => { if (!cancelled) setItems(r?.templates || []); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, items.length]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return undefined;
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const handlePick = async (t) => {
    setApplyingId(t.id);
    try {
      const r = await getGoogleCampaignTemplate(t.id);
      if (r?.template?.payload) {
        await onApply?.(r.template);
        globalToast.success(`Applied template "${t.name}".`);
        setOpen(false);
      }
    } catch (e) {
      globalToast.error(e?.response?.data?.error || 'Failed to load template.');
    } finally {
      setApplyingId(null);
    }
  };

  const handleDelete = async (e, t) => {
    e.stopPropagation();
    setDeletingId(t.id);
    try {
      await deleteGoogleCampaignTemplate(t.id);
      setItems((prev) => prev.filter((x) => x.id !== t.id));
      globalToast.success(`Deleted "${t.name}".`);
    } catch (err) {
      globalToast.error(err?.response?.data?.error || 'Failed to delete template.');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-semibold text-gray-600 transition-colors hover:border-gray-300 hover:text-gray-900 dark:border-white/12 dark:bg-white/4 dark:text-white/80 dark:hover:border-white/25 dark:hover:text-white"
      >
        <Bookmark className="h-3.5 w-3.5" />
        Start from template
        <ChevronRight className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1.5 max-h-80 w-80 overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-xl dark:border-white/12 dark:bg-[#1A1A1A]">
          {loading && (
            <div className="flex items-center justify-center gap-2 px-3 py-4 text-xs text-gray-500 dark:text-white/55">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
            </div>
          )}
          {!loading && items.length === 0 && (
            <div className="px-3 py-4 text-xs text-gray-500 dark:text-white/50">
              No saved templates yet. Build a campaign and save it as a template on the Review step.
            </div>
          )}
          {!loading && items.map((t) => (
            <button
              type="button"
              key={t.id}
              disabled={!!applyingId}
              onClick={() => handlePick(t)}
              className="flex w-full items-center gap-2 border-b border-gray-100 px-3 py-2.5 text-left transition-colors last:border-b-0 hover:bg-gray-50 disabled:opacity-50 dark:border-white/5 dark:hover:bg-white/5"
            >
              {applyingId === t.id
                ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[#4285F4]" />
                : <Bookmark className="h-3.5 w-3.5 shrink-0 text-gray-400 dark:text-white/35" />
              }
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-gray-900 dark:text-white">{t.name}</p>
                {(t.objective || t.conversionLocation) && (
                  <p className="truncate text-10 text-gray-400 dark:text-white/40">
                    {[t.objective, t.conversionLocation].filter(Boolean).join(' · ')}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={(e) => handleDelete(e, t)}
                disabled={!!deletingId}
                className="ml-1 shrink-0 rounded-lg p-1 text-gray-300 transition-colors hover:bg-red-50 hover:text-red-500 dark:text-white/20 dark:hover:bg-red-500/10 dark:hover:text-red-400"
              >
                {deletingId === t.id
                  ? <Loader2 className="h-3 w-3 animate-spin" />
                  : <X className="h-3 w-3" />
                }
              </button>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Step: Review ─────────────────────────────────────────────────────────────

function ReviewRow({ label, value, placeholder = '—' }) {
  if (!value && value !== 0 && !placeholder) return null;
  const display = (value !== undefined && value !== null && value !== '') ? value : placeholder;
  if (display === '—' && !value && value !== 0) return null;
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <span className="shrink-0 text-10 font-medium text-gray-400 dark:text-white/40">{label}</span>
      <span className="min-w-0 max-w-[60%] wrap-break-word text-right text-xs font-semibold text-gray-900 dark:text-white">{display}</span>
    </div>
  );
}

function ReviewSection({ title, icon: Icon, children }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-white/12 dark:bg-white/4">
      <div className="mb-2 flex items-center gap-1.5">
        {Icon && <Icon className="h-3 w-3 text-[#4285F4]" />}
        <p className="text-10 font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40">{title}</p>
      </div>
      <div className="divide-y divide-gray-200 dark:divide-white/8">{children}</div>
    </div>
  );
}

function ReviewStep({ form, mode, stepErrors, adType, schema, objectives, adAccountId, account }) {
  const hasErrors = Object.keys(stepErrors || {}).length > 0;
  const channel = effectiveChannel(form);
  return (
    <div className="flex flex-col gap-2">

{mode === 'create-full' && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 dark:border-white/12 dark:bg-white/4">
          <div className="flex items-center gap-2">
            <Bookmark className="h-3.5 w-3.5 text-gray-400 dark:text-white/30" />
            <p className="text-10 text-gray-500 dark:text-white/40">Save as template for future campaigns</p>
          </div>
          <SaveAsTemplateChip form={form} adAccountId={adAccountId} />
        </div>
      )}

      {hasErrors && (
        <div className="rounded-xl bg-red-500/10 px-4 py-3 ring-1 ring-red-500/30">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-400" />
            <p className="text-xs font-semibold text-red-400">Fix these before launching</p>
          </div>
          <ul className="mt-1.5 flex flex-col gap-0.5">
            {Object.entries(stepErrors).flatMap(([sid, errs]) =>
              Object.values(errs).map((msg, i) => (
                <li key={`${sid}-${i}`} className="text-10 text-red-400/80">· {msg}</li>
              ))
            )}
          </ul>
        </div>
      )}

      <div className="flex flex-col gap-2">
        {/* Campaign */}
        {['create-full', 'edit-campaign'].includes(mode) && (
          <ReviewSection title="Campaign" icon={Eye}>
            <ReviewRow label="Name"          value={form.campaignName} />
            <ReviewRow label="Objective"     value={objectiveLabel(form.objective, objectives)} />
            <ReviewRow label="Campaign Type" value={destinationLabel(form.destination, schema, objectives)} />
            {form.goal && <ReviewRow label="Goal" value={form.goal.replace(/_/g, ' ')} />}
            {form.budgetType === 'CAMPAIGN_TOTAL'
              ? <ReviewRow label="Budget" value={form.lifetimeBudget ? `₹${form.lifetimeBudget} total` : null} />
              : <ReviewRow label="Budget" value={form.dailyBudget ? `₹${form.dailyBudget}/day` : null} />
            }
            {form.biddingGoal && <ReviewRow label="Bidding" value={form.biddingGoal.replace(/_/g, ' ')} />}
            <ReviewRow label="Status" value={form.status} />
            {form.startDate && <ReviewRow label="Start" value={form.startDate} />}
            {form.endDate   && <ReviewRow label="End"   value={form.endDate} />}
            {form.websiteUrl   && <ReviewRow label="Website"  value={form.websiteUrl} />}
            {form.businessName && <ReviewRow label="Business" value={form.businessName} />}
            {form.countries?.length > 0 && <ReviewRow label="Locations" value={form.countries.length === 1 ? form.countries[0] : `${form.countries.length} countries`} />}
            {channel === 'SHOPPING' && form.merchantCenterId && <ReviewRow label="Merchant ID" value={form.merchantCenterId} />}
            {channel === 'APP_PROMOTION' && form.appStoreUrl && <ReviewRow label="App URL"  value={form.appStoreUrl} />}
            {channel === 'APP_PROMOTION' && form.appPlatform && <ReviewRow label="Platform" value={form.appPlatform} />}
            {form.objective === 'LOCAL_STORE' && form.storeAddress && <ReviewRow label="Store" value={form.storeAddress} />}
            {channel === 'PERFORMANCE_MAX' && form.pmaxFinalUrl && <ReviewRow label="Landing URL" value={form.pmaxFinalUrl} />}
          </ReviewSection>
        )}

        {/* Ad Group */}
        {['create-full', 'create-adgroup', 'edit-adgroup'].includes(mode) && channel !== 'PERFORMANCE_MAX' && channel !== 'SHOPPING' && (
          <ReviewSection title="Ad Group" icon={Layers}>
            <ReviewRow label="Name"    value={form.adGroupName} />
            <ReviewRow label="Max CPC" value={form.cpcBid ? `₹${form.cpcBid}` : null} />
            {form.biddingGoal && <ReviewRow label="Bidding" value={form.biddingGoal.replace(/_/g, ' ')} />}
            {form.ageMin && <ReviewRow label="Age" value={`${form.ageMin}–${form.ageMax || '65'}`} />}
            {form.genders?.length > 0 && <ReviewRow label="Genders" value={form.genders.join(', ')} />}
            {form.keywords?.filter(k => k.text).map((k, i) => (
              <ReviewRow key={i} label={i === 0 ? 'Keywords' : ''} value={`${k.text} [${k.matchType || 'BROAD'}]`} />
            ))}
            {form.videoFormat && <ReviewRow label="Video format" value={form.videoFormat.replace(/_/g, ' ')} />}
          </ReviewSection>
        )}

        {/* Asset Group (PMax) */}
        {channel === 'PERFORMANCE_MAX' && (
          <ReviewSection title="Asset Group" icon={ImageIcon}>
            <ReviewRow label="Name"          value={form.assetGroupName} />
            <ReviewRow label="Business name" value={form.pmaxBusinessName} />
            <ReviewRow label="Headlines"     value={form.pmaxHeadlines?.filter(Boolean).length ? `${form.pmaxHeadlines.filter(Boolean).length} added` : null} />
            <ReviewRow label="Descriptions"  value={form.pmaxDescriptions?.filter(Boolean).length ? `${form.pmaxDescriptions.filter(Boolean).length} added` : null} />
            {form.pmaxLongHeadline && <ReviewRow label="Long headline" value={form.pmaxLongHeadline} />}
            {(form.pmaxImageUrl || form.pmaxImageAssetRN) && <ReviewRow label="Image" value="✓ Uploaded" />}
            {form.pmaxVideoUrl && <ReviewRow label="Video" value="✓ Set" />}
          </ReviewSection>
        )}

        {/* Ad */}
        {channel !== 'PERFORMANCE_MAX' && channel !== 'SHOPPING' && (
          <ReviewSection title={`Ad · ${adType}`} icon={ImageIcon}>
            {adType === 'SEARCH' && (
              <>
                {(form.headlines || []).filter(Boolean).map((h, i) => (
                  <ReviewRow key={i} label={`Headline ${i + 1}`} value={h} />
                ))}
                {(form.descriptions || []).filter(Boolean).map((d, i) => (
                  <ReviewRow key={i} label={`Description ${i + 1}`} value={d} />
                ))}
              </>
            )}
            {adType === 'DISPLAY' && (
              <>
                <ReviewRow label="Headline"    value={form.headline} />
                <ReviewRow label="Description" value={form.description} />
                <ReviewRow label="Image"       value={form.assetResourceName ? 'Uploaded ✓' : form.imageUrl || null} />
              </>
            )}
            {adType === 'DEMAND_GEN' && (
              <ReviewRow label="Video" value={form.youtubeVideoId || (form.videoUrl?.startsWith('blob:') ? `⚠ Local file — add YouTube URL before submitting` : form.videoUrl) || null} />
            )}
            <ReviewRow label="Landing URL" value={form.finalUrl} />
            {form.callToAction && <ReviewRow label="CTA" value={form.callToAction} />}
          </ReviewSection>
        )}
      </div>

    </div>
  );
}

// ─── Main Wizard ──────────────────────────────────────────────────────────────

export default function CreateCampaignWizard({
  open, mode = 'create-full', context = null,
  onClose, adAccountId, account, onCreated,
  onChangeAccount,
}) {
  const [form, setFormState]        = useState(() => buildInitialForm(context));

  // ── schema (fetched once, cached at module level) ─────────────────────────
  const [schema, setSchema] = useState(() => getSchemaCache());
  const [schemaLoading, setSchemaLoading] = useState(() => !getSchemaCache());
  const [schemaError, setSchemaError] = useState(null);

  // Fetch or sync schema when modal opens
  useEffect(() => {
    if (!open) return;
    const cached = getSchemaCache();
    if (cached) {
      setSchema(cached);
      setSchemaLoading(false);
      return;
    }
    setSchemaLoading(true);
    setSchemaError(null);
    fetchSchemaOnce()
      .then((s) => {
        setSchema(s);
      })
      .catch((err) => {
        setSchemaError(err?.response?.data?.error || err?.message || 'Failed to load campaign settings');
      })
      .finally(() => {
        setSchemaLoading(false);
      });
  }, [open]);


  // ── form state ────────────────────────────────────────────────────────────
  const [stepIndex, setStepIndex]   = useState(0);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [touched, setTouched]       = useState({});

  const handleClose = () => setShowDiscardConfirm(true);
  const confirmDiscard = () => { setShowDiscardConfirm(false); onClose?.(); };
  const [errors, setErrors]         = useState({});
  const [launched, setLaunched]     = useState({ loading: false, error: null });
  const [created, setCreated]       = useState(() => seedCreated(mode, context));
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadingPmaxImage, setUploadingPmaxImage] = useState(false);
  const [uploadingPmaxVideo, setUploadingPmaxVideo] = useState(false);
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const [attemptedStepIds, setAttemptedStepIds] = useState(() => new Set());

  // ── derive from schema ────────────────────────────────────────────────────
  // Objectives list from server (schema.objectives is an array)
  const objectives = useMemo(() => schema?.objectives || [], [schema]);
  const destinations = useMemo(() => schema?.destinations || [], [schema]);
  const steps = useMemo(() => buildSteps(mode, form, schema), [mode, form, schema]);

  const currentStep = steps[stepIndex];

  const filteredDestinations = useMemo(() => {
    const all = getDestinationsForObjective(form.objective, schema, destinations)
      .filter((d) => d.value !== 'SHOPPING');
    if (!form.goal) return all;
    const allowed = getDestinationsForGoal(form.goal, schema);
    if (!allowed) return all;
    return all.filter((d) => allowed.includes(d.value));
  }, [form.objective, form.goal, schema, destinations]);

  // CTA options follow the selected destination (channel), not the business objective
  const ctaOptions = useMemo(() => {
    const channel = effectiveChannel(form);
    if (!channel || !schema?.ctaMap) return [];
    return schema.ctaMap[channel] || [];
  }, [form.objective, form.destination, schema]);

  const channel = effectiveChannel(form);

  const adType = useMemo(() => {
    if (schema?.adTypeMap && channel) {
      return schema.adTypeMap[channel] || deriveAdType(channel);
    }
    return deriveAdType(channel);
  }, [channel, schema]);

  // Goal options for the selected objective
  const goalOptions = useMemo(() => {
    if (!form.objective || !schema?.objectiveGoals) return [];
    return schema.objectiveGoals[form.objective] || [];
  }, [form.objective, schema]);

  // All option lists — from schema, minimal fallbacks matching backend exactly
  const countryOptions      = useMemo(() => schema?.countryOptions      || [], [schema]);
  const genderOptions       = useMemo(() => schema?.genderOptions       || [], [schema]);
  const statusOptions       = useMemo(() => schema?.statusOptions       || [], [schema]);
  const biddingGoalOptions  = useMemo(() => schema?.biddingGoalOptions  || [], [schema]);
  const keywordMatchTypes   = useMemo(() => schema?.keywordMatchTypes   || [], [schema]);
  const videoFormatOptions  = useMemo(() => schema?.videoFormatOptions  || [], [schema]);
  const appPlatformOptions  = useMemo(() => schema?.appPlatformOptions  || [], [schema]);
  const appSubtypeOptions   = useMemo(() => schema?.appSubtypeOptions   || [], [schema]);
  const videoGoalOptions    = useMemo(() => schema?.videoGoalOptions    || [], [schema]);
  const videoSubtypeOptions = useMemo(() => schema?.videoSubtypeOptions || [], [schema]);


  // ── reset when wizard opens ───────────────────────────────────────────────
  // Also re-run when a PMax asset-group edit finishes its async pre-fetch
  // (context flips from a `_loadingAssets` placeholder to the real payload)
  // so the form actually picks up the loaded headlines/descriptions/media.
  useEffect(() => {
    if (open && !context?._loadingAssets) {
      setFormState(buildInitialForm(context));
      setStepIndex(0);
      setTouched({});
      setErrors({});
      setLaunched({ loading: false, error: null });
      setCreated(seedCreated(mode, context));
      setAttemptedStepIds(new Set());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, context?._loadingAssets]);

  const setField = useCallback((name, value) => {
    setFormState((f) => ({ ...f, [name]: value }));
    setTouched((t) => ({ ...t, [name]: true }));
  }, []);

  const setFields = useCallback((patch) => {
    setFormState((f) => ({ ...f, ...patch }));
    setTouched((t) => ({ ...t, ...Object.fromEntries(Object.keys(patch).map((k) => [k, true])) }));
  }, []);

  // Clear uploaded asset RNs when the account changes mid-session —
  // asset resource names are account-scoped and become invalid under a different customer ID.
  const prevAdAccountIdRef = useRef(adAccountId);
  useEffect(() => {
    if (!open) return;
    const prev = prevAdAccountIdRef.current;
    prevAdAccountIdRef.current = adAccountId;
    if (prev && adAccountId && prev !== adAccountId) {
      setFormState((f) => ({
        ...f,
        pmaxImageAssetRN: '',
        pmaxSquareImageAssetRN: '',
        pmaxLogoAssetRN: '',
        pmaxImageUrl: '',
        pmaxLogoUrl: '',
      }));
    }
  }, [adAccountId, open]);

  const applyTemplate = useCallback((template) => {
    const payload = template?.payload || {};
    const templateAccount = payload.adAccountId || null;
    const needsAccountSwitch = templateAccount && templateAccount !== adAccountId;
    // Clear account-scoped asset RNs — they are tied to the original account and will fail
    // if applied to a different account. URLs are kept so previews still show and re-upload happens.
    setFormState((f) => ({
      ...f,
      ...payload,
      adAccountId: undefined,
      pmaxImageAssetRN: '',
      pmaxSquareImageAssetRN: '',
      pmaxLogoAssetRN: '',
      assetResourceName: '',
    }));
    setTouched({});
    setErrors({});
    setStepIndex(0);
    if (needsAccountSwitch) onChangeAccount?.(templateAccount);
  }, [adAccountId, onChangeAccount]);

  // Auto-select when objective has only one valid destination
  useEffect(() => {
    if (!form.objective || form.destination) return;
    if (filteredDestinations.length === 1) {
      setFormState((f) => ({ ...f, destination: filteredDestinations[0].value }));
    }
  }, [form.objective, form.destination, filteredDestinations]);

  // re-validate current step on form change
  useEffect(() => {
    setErrors(validateStep(currentStep?.id, form, adType, schema, mode));
  }, [form, currentStep?.id, adType, schema, mode]);

  const stepErrors   = validateAllSteps(steps, form, schema, mode);
  const canLaunch    = Object.keys(stepErrors).length === 0;

  const launchLabel = (() => {
    if (launched.loading) return null; // handled separately
    if (['edit-campaign', 'edit-adgroup', 'edit-ad'].includes(mode)) return 'Save Changes';
    return 'Launch';
  })();

  const launchIcon = (() => {
    if (['edit-campaign', 'edit-adgroup', 'edit-ad'].includes(mode)) return Check;
    return Rocket;
  })();
  const rawStepErrors = useMemo(() => validateStep(currentStep?.id, form, adType, schema, mode), [currentStep?.id, form, adType, schema, mode]);
  const visibleStepErrors = useMemo(() => {
    const showAll = attemptedStepIds.has(currentStep?.id);
    if (showAll) return rawStepErrors;

    return Object.fromEntries(
      Object.entries(rawStepErrors).filter(([field, msg]) => {
        if (!touched[field]) return false;

        // For count-based minimum requirements (e.g. "At least 2 descriptions...", "At least 3 headlines...", "Add at least one..."),
        // do not surface premature error before user clicks Continue / attempts step progression
        const isCountError = /at least|required\s*\(/i.test(msg);
        if (isCountError) return false;

        return true;
      })
    );
  }, [rawStepErrors, touched, attemptedStepIds, currentStep?.id]);

  const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif'];
  const ALLOWED_IMAGE_EXTS  = ['.jpg', '.jpeg', '.png', '.gif'];

  const handleImageUpload = async (file) => {
    // Validate format before uploading — Google Ads only accepts JPEG, PNG, GIF
    const ext = '.' + file.name.split('.').pop().toLowerCase();
    if (!ALLOWED_IMAGE_TYPES.includes(file.type) && !ALLOWED_IMAGE_EXTS.includes(ext)) {
      globalToast.error(
        `"${file.name}" is not supported. Google Ads only accepts JPEG, PNG, or GIF images. Please convert your file and try again.`
      );
      return;
    }
    setUploadingImage(true);
    try {
      const res = await uploadGoogleImage({ adAccountId, imageFile: file });
      setField('assetResourceName', res.assetResourceName || '');
      setField('squareAssetResourceName', res.squareAssetResourceName || '');
      setField('imageUrl', URL.createObjectURL(file));
    } catch (e) {
      globalToast.error(e?.response?.data?.error || 'Image upload failed');
    } finally {
      setUploadingImage(false);
    }
  };

  const handlePmaxImageUpload = async (file, type) => {
    const ext = '.' + file.name.split('.').pop().toLowerCase();
    const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif'];
    const ALLOWED_EXTS  = ['.jpg', '.jpeg', '.png', '.gif'];
    if (!ALLOWED_TYPES.includes(file.type) && !ALLOWED_EXTS.includes(ext)) {
      globalToast.error(`"${file.name}" is not supported. Google Ads only accepts JPEG, PNG, or GIF images.`);
      return;
    }
    if (!adAccountId) {
      globalToast.error('No ad account selected. Please select an account first.');
      return;
    }
    const urlField = type === 'logo' ? 'pmaxLogoUrl' : 'pmaxImageUrl';
    setUploadingPmaxImage(true);
    try {
      const res = await uploadGoogleImage({ adAccountId, imageFile: file });
      const rnField = type === 'logo' ? 'pmaxLogoAssetRN' : 'pmaxImageAssetRN';
      if (res.assetResourceName) {
        setField(rnField, res.assetResourceName);
        if (type !== 'logo' && res.squareAssetResourceName) {
          setField('pmaxSquareImageAssetRN', res.squareAssetResourceName);
        }
      }
      setField(urlField, URL.createObjectURL(file));
    } catch (e) {
      globalToast.error(e?.response?.data?.error || 'Image upload failed');
    } finally {
      setUploadingPmaxImage(false);
    }
  };

  const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime', 'video/x-msvideo'];
  const ALLOWED_VIDEO_EXTS  = ['.mp4', '.webm', '.ogg', '.mov', '.avi'];

  const _validateVideoFile = (file) => {
    const ext = '.' + file.name.split('.').pop().toLowerCase();
    if (!ALLOWED_VIDEO_TYPES.includes(file.type) && !ALLOWED_VIDEO_EXTS.includes(ext)) {
      globalToast.error(`"${file.name}" is not a supported video format. Please use MP4, WebM, MOV, or AVI.`);
      return false;
    }
    return true;
  };

  const handlePmaxVideoUpload = async (file) => {
    if (!_validateVideoFile(file)) return;
    // Show local preview immediately while uploading
    const blobUrl = URL.createObjectURL(file);
    setField('pmaxVideoUrl', blobUrl);
    setField('pmaxVideoFile', file);
    setUploadingPmaxVideo(true);
    try {
      const res = await uploadGoogleVideo({ adAccountId, videoFile: file });
      // Replace blob with real YouTube URL so it's ready for submission
      setField('pmaxVideoUrl', res.youtubeUrl);
      setField('pmaxVideoFile', null);
      globalToast.success('Video uploaded to YouTube ✓');
    } catch (e) {
      globalToast.error(e?.response?.data?.error || 'Video upload to YouTube failed');
      // Keep blob for preview but user will see validation error on submit
    } finally {
      setUploadingPmaxVideo(false);
    }
  };

  const handleVideoUpload = async (file) => {
    if (!_validateVideoFile(file)) return;
    const blobUrl = URL.createObjectURL(file);
    setField('videoUrl', blobUrl);
    setField('videoFile', file);
    setUploadingVideo(true);
    try {
      console.log('[VideoUpload] starting upload, adAccountId=', adAccountId, 'file=', file.name);
      const res = await uploadGoogleVideo({ adAccountId, videoFile: file });
      console.log('[VideoUpload] response=', res);
      setField('videoUrl', res.youtubeUrl);
      setField('videoFile', null);
      globalToast.success('Video uploaded to YouTube ✓');
    } catch (e) {
      console.error('[VideoUpload] error=', e);
      globalToast.error(e?.response?.data?.error || e?.message || 'Video upload to YouTube failed');
    } finally {
      setUploadingVideo(false);
    }
  };

  const goNext = () => {
    const errs = validateStep(currentStep.id, form, adType, schema, mode);
    setErrors(errs);
    setAttemptedStepIds((prev) => new Set([...prev, currentStep.id]));
    if (Object.keys(errs).length) return;
    setStepIndex((i) => Math.min(i + 1, steps.length - 1));
  };

  const goBack = () => {
    setLaunched({ loading: false, error: null });
    setStepIndex((i) => {
      const next = Math.max(i - 1, 0);
      // Going back to assets step — clear stale asset RNs and blob URLs so
      // the ✓ Set badge doesn't mislead the user into thinking they don't need to re-upload
      if (steps[next]?.id === 'assets') {
        setFormState((f) => ({
          ...f,
          pmaxImageAssetRN: '',
          pmaxSquareImageAssetRN: '',
          pmaxLogoAssetRN: '',
          pmaxImageUrl: f.pmaxImageUrl?.startsWith('blob:') ? '' : f.pmaxImageUrl,
          pmaxLogoUrl:  f.pmaxLogoUrl?.startsWith('blob:')  ? '' : f.pmaxLogoUrl,
        }));
      }
      return next;
    });
  };

  const handleLaunch = async () => {
    if (!canLaunch) return;
    setLaunched({ loading: true, error: null });
    try {
      let campaignId = created.campaignId;
      let adGroupId  = created.adGroupId;

      // Step 1 — Campaign
      if (mode === 'edit-campaign') {
        const nameChanged = form.campaignName !== context?.campaignName;
        await updateGoogleCampaign({
          adAccountId,
          campaignId,
          name:              nameChanged ? form.campaignName : undefined,
          dailyBudgetMicros: form.budgetType !== 'CAMPAIGN_TOTAL' ? toMicros(form.dailyBudget) : undefined,
          lifetimeBudgetMicros: form.budgetType === 'CAMPAIGN_TOTAL' ? toMicros(form.lifetimeBudget) : undefined,
          budgetType:        form.budgetType || 'DAILY',
          status:            form.status || undefined,
          startTime:         form.startDate || undefined,
          endTime:           form.endDate   || undefined,
        });
      } else if (!campaignId && mode === 'create-full') {
        const res = await createGoogleCampaign({
          adAccountId,
          name:              form.campaignName,
          objective:         resolveCampaignObjective(form),
          dailyBudgetMicros: form.budgetType !== 'CAMPAIGN_TOTAL' ? toMicros(form.dailyBudget) : undefined,
          lifetimeBudgetMicros: form.budgetType === 'CAMPAIGN_TOTAL' ? toMicros(form.lifetimeBudget) : undefined,
          budgetType:        form.budgetType || 'DAILY',
          status:            form.status || 'PAUSED',
          startTime:         form.startDate || undefined,
          endTime:           form.endDate   || undefined,
          targeting:         form.countries?.filter((c) => c !== 'WW').length ? { countries: form.countries.filter((c) => c !== 'WW') } : undefined,
          objectiveExtras: {
            merchantCenterId:    form.merchantCenterId    || undefined,
            productCategory:     form.productCategory     || undefined,
            appStoreUrl:         form.appStoreUrl         || undefined,
            appPlatform:         form.appPlatform         || undefined,
            appId:               form.appId               || undefined,
            appSubtype:          form.appSubtype          || undefined,
            storeAddress:        form.storeAddress        || undefined,
            locationRadius:      form.locationRadius ? Number(form.locationRadius) : undefined,
            assetGroupName:      form.assetGroupName      || undefined,
            pmaxSearchThemes:    form.pmaxSearchThemes    || undefined,
            businessDescription: form.businessDescription || undefined,
            finalUrlSuffix:      form.finalUrlSuffix      || undefined,
            finalUrl:            form.pmaxFinalUrl        || undefined,
            pmaxBusinessName:    form.pmaxBusinessName    || undefined,
            pmaxHeadlines:       form.pmaxHeadlines?.filter(Boolean).length ? form.pmaxHeadlines.filter(Boolean) : undefined,
            pmaxLongHeadline:    form.pmaxLongHeadline    || undefined,
            pmaxDescriptions:    form.pmaxDescriptions?.filter(Boolean).length ? form.pmaxDescriptions.filter(Boolean) : undefined,
            pmaxImageUrl:        form.pmaxImageUrl        || undefined,
            pmaxImageAssetRN:       form.pmaxImageAssetRN       || undefined,
            pmaxSquareImageAssetRN: form.pmaxSquareImageAssetRN || undefined,
            pmaxLogoUrl:         form.pmaxLogoUrl         || undefined,
            pmaxLogoAssetRN:     form.pmaxLogoAssetRN     || undefined,
            pmaxVideoUrl:        (form.pmaxVideoUrl && !form.pmaxVideoUrl.startsWith('blob:')) ? form.pmaxVideoUrl : undefined,
            videoGoal:           form.videoGoal           || undefined,
            videoSubtype:        form.videoSubtype        || undefined,
          },
        });
        campaignId = res.campaign?.campaignId;
        setCreated((c) => ({ ...c, campaignId }));
      }

      // Step 2 — Ad Group
      const isPmax = effectiveChannel(form) === 'PERFORMANCE_MAX';
      const isShopping = effectiveChannel(form) === 'SHOPPING';
      if (mode === 'edit-adgroup' && isPmax) {
        // No bulk-update endpoint for asset group assets — diff against what
        // was loaded when the wizard opened and add/remove only what changed.
        const original = form._originalPmaxAssets || { headlines: [], descriptions: [], images: [], logos: [] };
        const newHeadlines = (form.pmaxHeadlines || []).map((h) => h.trim()).filter(Boolean);
        const newDescriptions = (form.pmaxDescriptions || []).map((d) => d.trim()).filter(Boolean);

        const origHeadlineTexts = original.headlines.map((h) => (h.text || h || '').trim());
        const origDescriptionTexts = original.descriptions.map((d) => (d.text || d || '').trim());

        const headlinesToRemove = original.headlines.filter((h) => !newHeadlines.includes((h.text || h || '').trim()));
        const headlinesToAdd = newHeadlines.filter((t) => !origHeadlineTexts.includes(t));
        const descriptionsToRemove = original.descriptions.filter((d) => !newDescriptions.includes((d.text || d || '').trim()));
        const descriptionsToAdd = newDescriptions.filter((t) => !origDescriptionTexts.includes(t));

        const imageChanged = form.pmaxImageUrl && form.pmaxImageUrl !== (original.images.find((i) => i.fieldType === 'MARKETING_IMAGE')?.url || '');
        const logoChanged = form.pmaxLogoUrl && form.pmaxLogoUrl !== (original.logos?.[0]?.url || '');

        for (const h of headlinesToRemove) {
          if (h.assetRN) await removeAssetFromAssetGroup({ adAccountId, assetGroupId: adGroupId, assetResourceName: h.assetRN, fieldType: 'HEADLINE' });
        }
        for (const text of headlinesToAdd) {
          await addAssetToAssetGroup({ adAccountId, assetGroupId: adGroupId, fieldType: 'HEADLINE', text });
        }
        for (const d of descriptionsToRemove) {
          if (d.assetRN) await removeAssetFromAssetGroup({ adAccountId, assetGroupId: adGroupId, assetResourceName: d.assetRN, fieldType: 'DESCRIPTION' });
        }
        for (const text of descriptionsToAdd) {
          await addAssetToAssetGroup({ adAccountId, assetGroupId: adGroupId, fieldType: 'DESCRIPTION', text });
        }
        if (imageChanged && form.pmaxImageAssetRN) {
          const oldImage = original.images.find((i) => i.fieldType === 'MARKETING_IMAGE');
          if (oldImage?.assetRN) await removeAssetFromAssetGroup({ adAccountId, assetGroupId: adGroupId, assetResourceName: oldImage.assetRN, fieldType: 'MARKETING_IMAGE' });
          await addAssetToAssetGroup({ adAccountId, assetGroupId: adGroupId, fieldType: 'MARKETING_IMAGE', imageAssetRN: form.pmaxImageAssetRN });
        }
        if (logoChanged && form.pmaxLogoAssetRN) {
          const oldLogo = original.logos?.[0];
          if (oldLogo?.assetRN) await removeAssetFromAssetGroup({ adAccountId, assetGroupId: adGroupId, assetResourceName: oldLogo.assetRN, fieldType: 'LOGO' });
          await addAssetToAssetGroup({ adAccountId, assetGroupId: adGroupId, fieldType: 'LOGO', imageAssetRN: form.pmaxLogoAssetRN });
        }
      } else if (mode === 'edit-adgroup') {
        await updateGoogleAdGroup({
          adAccountId,
          adGroupId,
          campaignId,
          name:         form.adGroupName,
          cpcBidMicros: form.cpcBid ? toMicros(form.cpcBid) : undefined,
          status:       form.status || undefined,
        });
      } else if (!adGroupId && isPmax && ['create-full', 'create-adgroup'].includes(mode)) {
        const res = await createGoogleAdGroup({
          adAccountId,
          campaignId,
          name:                   form.adGroupName || form.assetGroupName,
          status:                 'PAUSED',
          assetGroupName:         form.assetGroupName      || undefined,
          finalUrl:               form.pmaxFinalUrl        || undefined,
          businessDescription:    form.businessDescription || undefined,
          pmaxBusinessName:       form.pmaxBusinessName    || undefined,
          pmaxHeadlines:          form.pmaxHeadlines?.filter(Boolean).length ? form.pmaxHeadlines.filter(Boolean) : undefined,
          pmaxLongHeadline:       form.pmaxLongHeadline    || undefined,
          pmaxDescriptions:       form.pmaxDescriptions?.filter(Boolean).length ? form.pmaxDescriptions.filter(Boolean) : undefined,
          pmaxImageUrl:           (form.pmaxImageUrl && !form.pmaxImageUrl.startsWith('blob:')) ? form.pmaxImageUrl : undefined,
          pmaxImageAssetRN:       form.pmaxImageAssetRN    || undefined,
          pmaxSquareImageAssetRN: form.pmaxSquareImageAssetRN || undefined,
          pmaxLogoUrl:            (form.pmaxLogoUrl && !form.pmaxLogoUrl.startsWith('blob:')) ? form.pmaxLogoUrl : undefined,
          pmaxLogoAssetRN:        form.pmaxLogoAssetRN     || undefined,
          pmaxVideoUrl:           (form.pmaxVideoUrl && !form.pmaxVideoUrl.startsWith('blob:')) ? form.pmaxVideoUrl : undefined,
        });
        adGroupId = res.adGroup?.adGroupId;
        setCreated((c) => ({ ...c, adGroupId }));
      } else if (!adGroupId && !isPmax && ['create-full', 'create-adgroup'].includes(mode)) {
        const targeting = {};
        if (form.ageMin) targeting.ageMin = Number(form.ageMin);
        if (form.ageMax) targeting.ageMax = Number(form.ageMax);
        if (form.genders?.length) targeting.genders = form.genders;
        if (form.targetCountries?.length) targeting.countries = form.targetCountries;
        if (form.audienceSegments?.length) targeting.audienceSegments = form.audienceSegments;
        if (form.customerMatchUrl) targeting.customerMatchUrl = form.customerMatchUrl;
        if (form.customSegmentKeywords) targeting.customSegmentKeywords = form.customSegmentKeywords;

        const res = await createGoogleAdGroup({
          adAccountId,
          campaignId,
          name:         form.adGroupName,
          cpcBidMicros: form.cpcBid ? toMicros(form.cpcBid) : undefined,
          status:       'PAUSED',
          targeting:    Object.keys(targeting).length ? targeting : undefined,
          biddingGoal:      form.biddingGoal || undefined,
          targetCpaMicros:  form.targetCpa  ? toMicros(form.targetCpa) : undefined,
          targetRoas:       form.targetRoas ? Number(form.targetRoas)  : undefined,
          keywords:         form.keywords?.filter(k => k.text).length ? form.keywords.filter(k => k.text) : undefined,
          videoFormat:      form.videoFormat || undefined,
          frequencyCap:     form.frequencyCap ? Number(form.frequencyCap) : undefined,
        });
        adGroupId = res.adGroup?.adGroupId;
        setCreated((c) => ({ ...c, adGroupId }));
      }

      // Step 3 — Ad (skipped for Performance Max — asset groups only)
      if (!isPmax && !isShopping && !['edit-campaign', 'edit-adgroup'].includes(mode)) {
        let adItem;
        const adStatus = form.adStatus || 'ENABLED';
        if (adType === 'SEARCH') {
          adItem = { headlines: form.headlines.filter(Boolean), descriptions: form.descriptions.filter(Boolean), finalUrl: form.finalUrl, status: adStatus };
        } else if (adType === 'DISPLAY') {
          adItem = { headline: form.headline, description: form.description, businessName: form.businessName || undefined, imageUrl: (form.imageUrl && !form.imageUrl.startsWith('blob:')) ? form.imageUrl : undefined, assetResourceName: form.assetResourceName || undefined, squareAssetResourceName: form.squareAssetResourceName || undefined, finalUrl: form.finalUrl, callToAction: form.callToAction || undefined, status: adStatus };
        } else {
          adItem = { videoUrl: (form.videoUrl && !form.videoUrl.startsWith('blob:')) ? form.videoUrl : undefined, youtubeVideoId: form.youtubeVideoId || undefined, headline: form.headline || undefined, longHeadline: form.longHeadline || undefined, description: form.description || undefined, finalUrl: form.finalUrl, callToAction: form.callToAction || undefined, status: adStatus };
        }
        if (mode === 'edit-ad') {
          await updateGoogleAd({ adAccountId, adGroupId, campaignId, adId: context?.adId, ...adItem });
        } else {
          await createGoogleAd({ adAccountId, adGroupId, campaignId, ads: [adItem] });
        }
      }

      globalToast.success(WIZARD_MODE_META[mode]?.toast || 'Done');
      onCreated?.();
      onClose?.();
    } catch (e) {
      const data = e?.response?.data || {};

      // data.error is now always a plain-English message from parseGoogleError() on the backend.
      // data.validations is an optional array of field-level hints (also plain text).
      const title = data.error || e?.message || 'Something went wrong. Please retry.';

      // Show field-level validation hints as supplementary detail only when they add new info
      const fieldHints = (data.validations || [])
        .map((v) => v.message)
        .filter(Boolean)
        .filter((m) => m !== title);
      const details = fieldHints.length ? fieldHints.join(' ') : '';

      // If the error is about image assets (cross-account mismatch), clear stale RNs
      // so the user can re-upload immediately on the assets step without closing the wizard
      if (title.toLowerCase().includes('image assets could not be resolved') || title.toLowerCase().includes('re-upload your images')) {
        setFormState((f) => ({
          ...f,
          pmaxImageAssetRN: '',
          pmaxSquareImageAssetRN: '',
          pmaxLogoAssetRN: '',
          pmaxImageUrl: f.pmaxImageUrl?.startsWith('blob:') ? '' : f.pmaxImageUrl,
          pmaxLogoUrl:  f.pmaxLogoUrl?.startsWith('blob:')  ? '' : f.pmaxLogoUrl,
        }));
        // Go back to assets step so user can re-upload
        const assetsIdx = steps.findIndex((s) => s.id === 'assets');
        if (assetsIdx >= 0) setStepIndex(assetsIdx);
      }
      setLaunched({ loading: false, error: { title, details } });
    }
  };

  if (!open) return null;

  if (context?._loadingAssets) {
    return (
      <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 px-4 backdrop-blur-sm">
        <div className="flex h-40 w-full max-w-sm flex-col items-center justify-center gap-3 rounded-2xl bg-white shadow-2xl dark:bg-[#141414]">
          <Loader2 className="h-6 w-6 animate-spin text-[#4285F4]" />
          <p className="text-xs text-gray-500 dark:text-white/50">Loading asset group…</p>
        </div>
      </div>
    );
  }

  const modeMeta = WIZARD_MODE_META[mode] || WIZARD_MODE_META['create-full'];

  return (
    <>
      <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 px-4 backdrop-blur-sm">
        <div
          className="relative flex h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-white/10 dark:bg-[#141414]"
          onClick={(e) => e.stopPropagation()}
        >
        {/* close button — pinned top-right */}
        <button
          type="button"
          onClick={handleClose}
          aria-label="Close"
          className="absolute right-2.5 top-2.5 z-20 flex h-6 w-6 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-white/40 dark:hover:bg-white/8 dark:hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>

        {/* header */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-gray-100 bg-white px-4 py-2.5 pr-11 dark:border-white/8 dark:bg-[#141414]">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#4285F4]">
              <SiGoogleads className="h-4 w-4 text-white" />
            </div>
            <div>
              <p className="text-xs font-bold text-gray-900 dark:text-white leading-tight">{modeMeta.title}</p>
              <div className="flex items-center gap-1 mt-0.5">
                <span className="text-10 text-gray-400 dark:text-white/40">Posting to</span>
                <span className="inline-flex rounded-md bg-[#4285F4] p-px">
                  <span className="rounded-[5px] bg-white px-1.5 py-0.5 text-10 font-bold text-gray-900 dark:bg-[#141414] dark:text-white leading-tight">
                    {account?.name || `Account ${adAccountId || '—'}`}
                  </span>
                </span>
                {account?.currency && (
                  <span className="font-mono text-10 text-gray-400 dark:text-white/40">· {account.currency}</span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {applyTemplate && stepIndex === 0 && <TemplatePicker onApply={applyTemplate} />}
            {steps.length > 1 && <StepRail steps={steps} currentIndex={stepIndex} onJumpToStep={setStepIndex} />}
          </div>
        </div>

        <div className="flex min-h-0 flex-1">
          <div className="scrollbar-thin min-h-0 flex-1 overflow-y-scroll px-5 pt-3.5 pb-4 sm:px-6">
            {schemaLoading ? (
              <div className="flex flex-col gap-3 pt-2">
                {[80, 120, 160, 100, 140].map((w, i) => (
                  <div key={i} className="flex flex-col gap-2">
                    <div className="h-3 w-20 animate-pulse rounded-md bg-gray-200 dark:bg-white/8" />
                    <div className={`h-10 w-full animate-pulse rounded-xl bg-gray-100 dark:bg-white/5`} style={{ animationDelay: `${i * 80}ms` }} />
                  </div>
                ))}
              </div>
            ) : schemaError ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                <AlertCircle className="h-8 w-8 text-red-400" />
                <p className="text-sm font-semibold text-gray-700 dark:text-white/70">Failed to load wizard</p>
                <p className="text-10 text-gray-400 dark:text-white/30">{schemaError}</p>
                <button
                  onClick={() => { fetchSchemaOnce().then((s) => setSchema(s)).catch(() => {}); }}
                  className="flex items-center gap-1.5 rounded-lg bg-[#4285F4] px-3 py-1.5 text-xs font-bold text-white"
                >
                  <RefreshCw className="h-3 w-3" /> Retry
                </button>
              </div>
            ) : (
            <AnimatePresence mode="wait">
              <motion.div key={currentStep?.id} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: 0.18 }}>
                {currentStep?.id === 'campaign' && (
                  <CampaignStep form={form} setField={setField} setFields={setFields} errors={visibleStepErrors} countryOptions={countryOptions} statusOptions={statusOptions} appPlatformOptions={appPlatformOptions} appSubtypeOptions={appSubtypeOptions} videoGoalOptions={videoGoalOptions} videoSubtypeOptions={videoSubtypeOptions} objectives={objectives} goalOptions={goalOptions} schema={schema} filteredDestinations={filteredDestinations} applyTemplate={applyTemplate} schemaLoading={schemaLoading} />
                )}
                {currentStep?.id === 'assetGroup' && (
                  <AssetGroupStep form={form} setField={setField} errors={visibleStepErrors} genderOptions={genderOptions} />
                )}
                {currentStep?.id === 'assets' && (
                  <AssetsStep form={form} setField={setField} errors={visibleStepErrors} uploadingPmaxImage={uploadingPmaxImage} onPmaxImageUpload={handlePmaxImageUpload} uploadingPmaxVideo={uploadingPmaxVideo} onPmaxVideoUpload={handlePmaxVideoUpload} />
                )}
                {currentStep?.id === 'adGroup' && (
                  <AdGroupStep form={form} setField={setField} errors={visibleStepErrors} keywordMatchTypes={keywordMatchTypes} videoFormatOptions={videoFormatOptions} genderOptions={genderOptions} countryOptions={countryOptions} biddingGoalOptions={biddingGoalOptions} />
                )}
                {currentStep?.id === 'ad' && (
                  <AdStep form={form} setField={setField} errors={visibleStepErrors} ctaOptions={ctaOptions} adType={adType} uploadingImage={uploadingImage} onImageUpload={handleImageUpload} uploadingVideo={uploadingVideo} onVideoUpload={handleVideoUpload} />
                )}
                {currentStep?.id === 'review' && (
                  <ReviewStep form={form} mode={mode} stepErrors={stepErrors} adType={adType} schema={schema} objectives={objectives} adAccountId={adAccountId} account={account} />
                )}
              </motion.div>
            </AnimatePresence>
            )}
          </div>
          {steps.length > 1 && (
            <WizardSideRail
              steps={steps}
              stepIndex={stepIndex}
              stepErrors={visibleStepErrors}
              rawStepErrors={rawStepErrors}
              allStepErrors={stepErrors}
              attemptedStepIds={attemptedStepIds}
              onJumpToStep={setStepIndex}
            />
          )}
        </div>

        <LaunchErrorBanner error={launched.error} onDismiss={() => setLaunched({ loading: false, error: null })} />

        {/* footer */}
        <div className="flex shrink-0 items-center justify-between border-t border-gray-100 bg-gray-50/50 px-4 py-2.5 dark:border-white/8 dark:bg-white/[0.02] sm:px-5">
          {stepIndex > 0 ? (
            <button
              onClick={goBack}
              className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-gray-600 transition-all hover:border-gray-300 hover:text-gray-900 dark:border-white/8 dark:bg-white/4 dark:text-white/60 dark:hover:border-white/15 dark:hover:text-white"
            >
              <ChevronLeft className="h-3.5 w-3.5" /> Back
            </button>
          ) : <div />}

          <span className="text-10 text-gray-400 dark:text-white/25">{stepIndex + 1} / {steps.length}</span>

          {stepIndex < steps.length - 1 ? (
            <button
              onClick={goNext}
              disabled={schemaLoading || uploadingVideo || uploadingPmaxVideo}
              title={uploadingVideo || uploadingPmaxVideo ? 'Please wait for the video to finish uploading before continuing' : undefined}
              className="flex items-center gap-1.5 rounded-lg bg-[#4285F4] px-4 py-1.5 text-xs font-bold text-white transition-all hover:bg-[#3574e2] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {uploadingVideo || uploadingPmaxVideo ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Uploading…</> : <>Continue <ChevronRight className="h-3.5 w-3.5" /></>}
            </button>
          ) : (
            <button
              onClick={handleLaunch}
              disabled={launched.loading || !canLaunch}
              className="flex items-center gap-1.5 rounded-lg bg-[#4285F4] px-5 py-1.5 text-xs font-bold text-white transition-all hover:bg-[#3574e2] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {launched.loading
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> {['edit-campaign','edit-adgroup','edit-ad'].includes(mode) ? 'Saving…' : 'Launching…'}</>
                : (() => { const Icon = launchIcon; return <><Icon className="h-3.5 w-3.5" /> {launchLabel}</>; })()
              }
            </button>
          )}
        </div>
      </div>
    </div>

      {/* Discard confirmation overlay — full-screen fixed overlay so no nested card borders or inner boxes show underneath */}
      <AnimatePresence>
        {showDiscardConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[220] flex items-center justify-center bg-black/60 p-4 backdrop-blur-md"
            onClick={() => setShowDiscardConfirm(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 0 }}
              transition={{ duration: 0.16 }}
              className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-5 shadow-2xl dark:border-white/12 dark:bg-[#161616]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-red-50 dark:bg-red-500/10">
                <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-300" />
              </div>
              <h3 className="text-sm font-bold text-gray-900 dark:text-white">Discard this campaign?</h3>
              <p className="mt-1.5 text-xs leading-relaxed text-gray-500 dark:text-white/55">
                Everything you've entered in the wizard will be cleared. Your existing campaigns in Google Ads aren't affected.
              </p>
              <div className="mt-5 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowDiscardConfirm(false)}
                  className="rounded-full border border-gray-200 bg-gray-100 px-4 py-2 text-xs font-semibold text-gray-900 transition-all hover:bg-gray-200 dark:border-white/10 dark:bg-white/5 dark:text-white dark:hover:bg-white/10"
                >
                  Keep editing
                </button>
                <button
                  type="button"
                  onClick={confirmDiscard}
                  className="rounded-full bg-red-600 px-4 py-2 text-xs font-bold text-white transition-all hover:bg-red-700 shadow-sm"
                >
                  Discard
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
