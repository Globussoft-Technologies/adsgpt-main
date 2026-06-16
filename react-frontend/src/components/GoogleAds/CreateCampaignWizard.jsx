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

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { SiGoogleads } from 'react-icons/si';
import {
  Check, ChevronLeft, ChevronRight, Eye, Image as ImageIcon,
  Layers, Loader2, Target, X, AlertCircle, Plus, Trash2,
  Youtube, Search, Monitor, Zap, ShoppingBag, MapPin, TrendingUp,
  RefreshCw, Smartphone, Store, Key, MapPinned,
} from 'lucide-react';
import {
  createGoogleCampaign,
  updateGoogleCampaign,
  createGoogleAdGroup,
  updateGoogleAdGroup,
  createGoogleAd,
  updateGoogleAd,
  uploadGoogleImage,
  getGoogleWizardSchema,
} from '@/apis/googleAds/googleAdsApi';
import { globalToast } from '@/utils/globalToast';
import { validateStep, validateAllSteps, deriveAdType, resolveCampaignObjective, effectiveChannel } from './wizardValidation';
import {
  getDestinationsForObjective,
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

// ─── step definitions ─────────────────────────────────────────────────────────

const BASE_STEPS = [
  { id: 'objective', label: 'Objective', icon: Target },
  { id: 'destination', label: 'Destination', icon: MapPinned },
  { id: 'campaign',  label: 'Campaign',  icon: Eye },
  { id: 'adGroup',   label: 'Ad Group',  icon: Layers },
  { id: 'ad',        label: 'Ad',        icon: ImageIcon },
  { id: 'review',    label: 'Review',    icon: Check },
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

function buildSteps(mode, form = {}, schema = null) {
  if (mode === 'create-adgroup') return BASE_STEPS.filter((s) => ['adGroup', 'review'].includes(s.id));
  if (mode === 'create-ad')      return BASE_STEPS.filter((s) => ['ad', 'review'].includes(s.id));
  if (mode === 'edit-campaign')  return BASE_STEPS.filter((s) => ['campaign', 'review'].includes(s.id));
  if (mode === 'edit-adgroup')   return BASE_STEPS.filter((s) => ['adGroup', 'review'].includes(s.id));
  if (mode === 'edit-ad')        return BASE_STEPS.filter((s) => ['ad', 'review'].includes(s.id));

  let steps = BASE_STEPS;
  const channel = effectiveChannel(form);
  if (channel === 'PERFORMANCE_MAX') {
    steps = steps.filter((s) => !['adGroup', 'ad'].includes(s.id));
  }
  if (channel === 'SHOPPING') {
    steps = steps.filter((s) => s.id !== 'ad');
  }
  const allowedDests = getDestinationsForObjective(form.objective, schema, schema?.destinations || []);
  if (mode === 'create-full' && allowedDests.length <= 1) {
    steps = steps.filter((s) => s.id !== 'destination');
  }
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
    campaignName:    context?.campaignName || '',
    dailyBudget:     context?.dailyBudget != null ? String(context.dailyBudget) : '',
    status:          context?.status       || 'PAUSED',
    startDate:       context?.startDate    || '',
    endDate:         context?.endDate      || '',
    countries:       context?.countries    || [],
    adGroupName:     context?.adGroupName  || '',
    cpcBid:          context?.cpcBid != null ? String(context.cpcBid) : '',
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
    videoUrl:        context?.videoUrl     || '',
    youtubeVideoId:  context?.youtubeVideoId || '',
    // SEARCH / LEADS / SALES extras
    keywords:           context?.keywords    || [{ text: '', matchType: 'BROAD' }],
    biddingGoal:        context?.biddingGoal || 'MAXIMIZE_CLICKS',
    targetCpa:          context?.targetCpa   || '',
    targetRoas:         context?.targetRoas  || '',
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
    assetGroupName:     context?.assetGroupName      || '',
    businessDescription:context?.businessDescription || '',
    finalUrlSuffix:     context?.finalUrlSuffix      || '',
    pmaxFinalUrl:       context?.pmaxFinalUrl        || '',
    pmaxBusinessName:   context?.pmaxBusinessName    || '',
    pmaxHeadlines:      context?.pmaxHeadlines       || ['', '', ''],
    pmaxLongHeadline:   context?.pmaxLongHeadline    || '',
    pmaxDescriptions:   context?.pmaxDescriptions    || ['', ''],
    pmaxImageUrl:       context?.pmaxImageUrl        || '',
    pmaxLogoUrl:        context?.pmaxLogoUrl         || '',
    pmaxVideoUrl:       context?.pmaxVideoUrl        || '',
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
    <p className="mt-1 flex items-center gap-1 text-xs text-red-500 dark:text-red-400">
      <AlertCircle className="h-3 w-3 shrink-0" /> {msg}
    </p>
  );
}

function Label({ children, required }) {
  return (
    <label className="mb-1 block text-xs font-semibold text-gray-700 dark:text-white/70">
      {children} {required && <span className="text-red-400">*</span>}
    </label>
  );
}

function Input({ value, onChange, placeholder, type = 'text', maxLength, className = '' }) {
  return (
    <input
      type={type}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      maxLength={maxLength}
      className={`w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs text-gray-900 outline-none transition-all placeholder:text-gray-400 focus:border-[#4285F4]/60 focus:ring-1 focus:ring-[#4285F4]/20 dark:border-white/8 dark:bg-[#1A1A1A] dark:text-white dark:placeholder:text-white/30 dark:focus:border-[#4285F4]/50 ${className}`}
    />
  );
}

function Select({ value, onChange, children, className = '' }) {
  return (
    <select
      value={value}
      onChange={onChange}
      className={`w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs text-gray-900 outline-none transition-all focus:border-[#4285F4]/60 focus:ring-1 focus:ring-[#4285F4]/20 dark:border-white/8 dark:bg-[#1A1A1A] dark:text-white ${className}`}
    >
      {children}
    </select>
  );
}

function CharCount({ val, max }) {
  const len = String(val || '').length;
  return (
    <span className={`text-[10px] ${len > max ? 'text-red-400' : 'text-gray-400 dark:text-white/30'}`}>
      {len}/{max}
    </span>
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

// ─── Wizard side rail (Meta-style checklist) ──────────────────────────────────

function WizardSideRail({ steps, stepIndex, stepErrors, rawStepErrors, allStepErrors, onJumpToStep }) {
  const currentMessages = Object.values(stepErrors || {});
  const isActuallyComplete = Object.keys(rawStepErrors || {}).length === 0;
  return (
    <aside className="scrollbar-thin hidden w-60 shrink-0 flex-col gap-4 overflow-y-auto border-l border-gray-200 bg-gray-50 px-4 py-5 dark:border-white/8 dark:bg-white/2 md:flex">
      <div>
        <p className="text-10 font-bold uppercase tracking-wider text-gray-400 dark:text-white/40">Campaign setup</p>
        <ul className="mt-2.5 flex flex-col gap-0.5">
          {steps.map((s, i) => {
            const isCurrent = i === stepIndex;
            const hasErr = !!allStepErrors[s.id];
            const done = i < stepIndex && !hasErr;
            return (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => done && onJumpToStep?.(i)}
                  className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors ${
                    isCurrent ? 'bg-gray-100 font-semibold text-gray-900 dark:bg-white/8 dark:text-white'
                      : 'text-gray-500 hover:bg-gray-100 dark:text-white/55 dark:hover:bg-white/5'
                  }`}
                >
                  <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold ${
                    done ? 'bg-emerald-400/10 text-emerald-600' : hasErr ? 'bg-amber-400/10 text-amber-600' : 'border border-gray-300 text-gray-400 dark:border-white/8'
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
      {!isActuallyComplete ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-2.5 dark:border-amber-400/20 dark:bg-amber-400/5">
          <div className="flex items-start gap-1.5">
            <AlertCircle className="mt-0.5 h-3 w-3 shrink-0 text-amber-600" />
            <div className="min-w-0 text-11 leading-snug text-amber-700 dark:text-amber-100">
              {currentMessages.length === 1
                ? currentMessages[0]
                : currentMessages.length > 1
                  ? `${currentMessages.length} things left on this step`
                  : 'Fill in the required fields to continue'}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-2.5 py-2 text-11 text-emerald-600 dark:border-emerald-400/20 dark:bg-emerald-400/5 dark:text-emerald-200">
          <Check className="h-3 w-3 shrink-0" /> Step is complete.
        </div>
      )}
    </aside>
  );
}

// ─── Step: Destination ────────────────────────────────────────────────────────

function DestinationStep({ destinations, form, setField, errors, schema }) {
  const available = getDestinationsForObjective(form.objective, schema, destinations);

  if (!form.objective) {
    return (
      <p className="text-sm text-gray-500 dark:text-[#BEBEBE]">
        Select a campaign objective on the previous step first.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="text-base font-semibold text-gray-900 dark:text-white">Where should your ads appear?</p>
        <p className="mt-1 text-sm text-gray-500 dark:text-[#BEBEBE]">
          Destinations available for <span className="font-medium text-gray-700 dark:text-white/80">{objectiveLabel(form.objective, schema?.objectives || [])}</span> — fields on the next steps adapt to your choice.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {available.map(({ value, label, description }) => {
          const Icon = DESTINATION_ICONS[value] || MapPinned;
          const active = form.destination === value;
          return (
            <button
              key={value}
              type="button"
              onClick={() => setField('destination', value)}
              className={`flex flex-col items-start gap-3 rounded-xl border-2 p-4 text-left transition-all ${
                active ? 'border-[#4285F4] bg-[#4285F4]/5 dark:bg-[#4285F4]/10' : 'border-gray-200 dark:border-white/10'
              }`}
            >
              <Icon className={`h-5 w-5 ${active ? 'text-[#4285F4]' : 'text-gray-400'}`} />
              <div>
                <p className={`text-sm font-semibold ${active ? 'text-[#4285F4]' : 'text-gray-900 dark:text-white'}`}>{label}</p>
                {description && <p className="mt-1 text-xs text-gray-500 dark:text-[#BEBEBE]">{description}</p>}
              </div>
            </button>
          );
        })}
      </div>
      <FieldError msg={errors.destination} />
    </div>
  );
}

// ─── Step: Objective (fully dynamic from schema) ──────────────────────────────

function ObjectiveStep({ objectives, form, setFields, errors, schemaLoading, schemaError }) {
  if (schemaLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        <span className="ml-2 text-xs text-gray-500 dark:text-[#BEBEBE]">Loading objectives…</span>
      </div>
    );
  }
  if (schemaError) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-500/20 dark:bg-red-500/8">
        <AlertCircle className="h-4 w-4 text-red-500" />
        <p className="text-xs text-red-600 dark:text-red-400">{schemaError}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="text-base font-semibold text-gray-900 dark:text-white">What's your campaign objective?</p>
        <p className="mt-1 text-sm text-[#4285F4]">
          Select an objective to tailor your experience to the goals and settings that will work best for your campaign
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {objectives.map(({ value, label, description }) => {
          const Icon = OBJECTIVE_ICONS[value] || Target;
          const active = form.objective === value;
          return (
            <button
              key={value}
              onClick={() => setFields({ objective: value, destination: '' })}
              className={`flex flex-col items-start gap-3 rounded-xl border-2 p-5 text-left transition-all duration-150 ${
                active
                  ? 'border-[#4285F4] bg-[#4285F4]/5 dark:bg-[#4285F4]/10'
                  : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50 dark:border-white/10 dark:bg-[#1A1A1A] dark:hover:border-white/20 dark:hover:bg-white/4'
              }`}
            >
              <Icon className={`h-6 w-6 ${active ? 'text-[#4285F4]' : 'text-gray-500 dark:text-[#BEBEBE]'}`} />
              <div>
                <p className={`text-sm font-semibold ${active ? 'text-[#4285F4]' : 'text-gray-900 dark:text-white'}`}>{label}</p>
                {description && (
                  <p className="mt-1 text-xs leading-snug text-gray-500 dark:text-[#BEBEBE]">{description}</p>
                )}
              </div>
            </button>
          );
        })}
      </div>
      <FieldError msg={errors.objective} />
    </div>
  );
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
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-white/6 dark:bg-white/2">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-white/30">Keywords <span className="text-red-400">*</span></p>
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

// ─── Step: Campaign ───────────────────────────────────────────────────────────

function CampaignStep({ form, setField, errors, countryOptions, statusOptions, appPlatformOptions, appSubtypeOptions, videoGoalOptions, videoSubtypeOptions }) {
  const channel = form.destination || form.objective;
  const toggleCountry = (code) => {
    const cur = form.countries || [];
    setField('countries', cur.includes(code) ? cur.filter((c) => c !== code) : [...cur, code]);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label required>Campaign name</Label>
          <Input value={form.campaignName} onChange={(e) => setField('campaignName', e.target.value)} placeholder="e.g. Summer Sale 2025" maxLength={120} />
          <FieldError msg={errors.campaignName} />
        </div>

        <div>
          <Label required>Daily budget</Label>
          <div className="relative">
            <span className="absolute top-1/2 left-3 -translate-y-1/2 text-xs font-semibold text-gray-400 dark:text-white/30">₹</span>
            <Input type="number" value={form.dailyBudget} onChange={(e) => setField('dailyBudget', e.target.value)} placeholder="50" className="pl-6" min="0.01" step="1" />
          </div>
          <p className="mt-1 text-[10px] text-gray-400 dark:text-white/30">Enter amount in ₹ — minimum ₹0.01/day</p>
          <FieldError msg={errors.dailyBudget} />
        </div>

        <div>
          <Label>Status</Label>
          <Select value={form.status} onChange={(e) => setField('status', e.target.value)}>
            {statusOptions.map(({ value, label }) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </Select>
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

      <div>
        <Label>Target countries</Label>
        <div className="flex flex-wrap gap-1.5">
          {countryOptions.map(({ code, label }) => {
            const active = (form.countries || []).includes(code);
            return (
              <button
                key={code}
                onClick={() => toggleCountry(code)}
                className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold transition-all ${
                  active
                    ? 'border-[#4285F4]/50 bg-[#4285F4]/10 text-[#4285F4] dark:border-[#4285F4]/40 dark:bg-[#4285F4]/15'
                    : 'border-gray-200 bg-transparent text-gray-500 hover:border-gray-300 dark:border-white/8 dark:text-[#BEBEBE] dark:hover:border-white/20'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
        <FieldError msg={errors.countries} />
      </div>

      {/* ── SHOPPING: Merchant Center ── */}
      {channel === 'SHOPPING' && (
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-white/6 dark:bg-white/2">
          <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-white/30">Shopping settings</p>
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
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-white/6 dark:bg-white/2">
          <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-white/30">App details</p>
          <div className="flex flex-col gap-3">
            {/* Campaign subtype — App installs / engagement / pre-registration */}
            <div>
              <Label>Campaign subtype</Label>
              <div className="flex flex-col gap-1.5">
                {(appSubtypeOptions || []).map(({ value, label, desc }) => {
                  const active = form.appSubtype === value;
                  return (
                    <button key={value} onClick={() => setField('appSubtype', value)}
                      className={`flex items-start gap-2.5 rounded-xl border p-2.5 text-left transition-all ${active ? 'border-[#4285F4]/50 bg-[#4285F4]/8 dark:bg-[#4285F4]/10' : 'border-gray-200 bg-white hover:border-gray-300 dark:border-white/8 dark:bg-[#1A1A1A]'}`}
                    >
                      <div className={`mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border-2 ${active ? 'border-[#4285F4] bg-[#4285F4]' : 'border-gray-300 dark:border-white/20'}`} />
                      <div>
                        <p className={`text-xs font-semibold ${active ? 'text-[#4285F4]' : 'text-gray-800 dark:text-white'}`}>{label}</p>
                        <p className="text-[10px] text-gray-500 dark:text-[#BEBEBE]">{desc}</p>
                      </div>
                    </button>
                  );
                })}
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
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-white/6 dark:bg-white/2">
          <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-white/30">Campaign goal</p>
          <div className="flex flex-col gap-1.5">
            {(videoGoalOptions || []).map(({ value, label, desc }) => {
              const active = form.videoGoal === value;
              return (
                <button key={value} onClick={() => setField('videoGoal', value)}
                  className={`flex items-start gap-2.5 rounded-xl border p-2.5 text-left transition-all ${active ? 'border-[#4285F4]/50 bg-[#4285F4]/8 dark:bg-[#4285F4]/10' : 'border-gray-200 bg-white hover:border-gray-300 dark:border-white/8 dark:bg-[#1A1A1A]'}`}
                >
                  <div className={`mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border-2 ${active ? 'border-[#4285F4] bg-[#4285F4]' : 'border-gray-300 dark:border-white/20'}`} />
                  <div>
                    <p className={`text-xs font-semibold ${active ? 'text-[#4285F4]' : 'text-gray-800 dark:text-white'}`}>{label}</p>
                    {desc && <p className="text-[10px] text-gray-500 dark:text-[#BEBEBE]">{desc}</p>}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── VIDEO / DEMAND_GEN: campaign subtype ── */}
      {['VIDEO', 'DEMAND_GEN'].includes(channel) && (
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-white/6 dark:bg-white/2">
          <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-white/30">Campaign subtype</p>
          <div className="flex flex-col gap-1.5">
            {(videoSubtypeOptions || []).map(({ value, label, desc }) => {
              const active = form.videoSubtype === value;
              return (
                <button key={value} onClick={() => setField('videoSubtype', value)}
                  className={`flex items-start gap-2.5 rounded-xl border p-2.5 text-left transition-all ${active ? 'border-[#4285F4]/50 bg-[#4285F4]/8 dark:bg-[#4285F4]/10' : 'border-gray-200 bg-white hover:border-gray-300 dark:border-white/8 dark:bg-[#1A1A1A]'}`}
                >
                  <div className={`mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border-2 ${active ? 'border-[#4285F4] bg-[#4285F4]' : 'border-gray-300 dark:border-white/20'}`} />
                  <div>
                    <p className={`text-xs font-semibold ${active ? 'text-[#4285F4]' : 'text-gray-800 dark:text-white'}`}>{label}</p>
                    {desc && <p className="text-[10px] text-gray-500 dark:text-[#BEBEBE]">{desc}</p>}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── LOCAL_STORE ── */}
      {form.objective === 'LOCAL_STORE' && (
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-white/6 dark:bg-white/2">
          <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-white/30">Store location</p>
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
              <p className="mt-1 text-[10px] text-gray-400 dark:text-white/30">Ads shown to users within this distance from the store</p>
            </div>
          </div>
        </div>
      )}

      {/* ── PERFORMANCE_MAX ── */}
      {channel === 'PERFORMANCE_MAX' && (
        <div className="flex flex-col gap-3">
          {/* Campaign settings */}
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-white/6 dark:bg-white/2">
            <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-white/30">Campaign settings</p>
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

          {/* Asset Group */}
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-white/6 dark:bg-white/2">
            <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-white/30">Asset group</p>
            <div className="flex flex-col gap-3">
              <div>
                <Label required>Asset group name</Label>
                <Input value={form.assetGroupName} onChange={(e) => setField('assetGroupName', e.target.value)} placeholder="e.g. Summer Sale Assets" />
                <FieldError msg={errors.assetGroupName} />
              </div>
              <div>
                <Label required>Business name</Label>
                <Input value={form.pmaxBusinessName} onChange={(e) => setField('pmaxBusinessName', e.target.value)} placeholder="Your brand or company name" />
                <FieldError msg={errors.pmaxBusinessName} />
              </div>
            </div>
          </div>

          {/* Headlines */}
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-white/6 dark:bg-white/2">
            <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-white/30">Headlines (3–5, max 30 chars each)</p>
            <div className="flex flex-col gap-1.5">
              {(form.pmaxHeadlines || ['', '', '']).map((h, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <div className="relative flex-1">
                    <Input
                      value={h}
                      onChange={(e) => {
                        const n = [...(form.pmaxHeadlines || ['', '', ''])];
                        n[i] = e.target.value.slice(0, 30);
                        setField('pmaxHeadlines', n);
                      }}
                      placeholder={`Headline ${i + 1}`}
                    />
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-gray-400">{h.length}/30</span>
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
              <Label>Long headline (max 90 chars)</Label>
              <div className="relative">
                <Input value={form.pmaxLongHeadline} onChange={(e) => setField('pmaxLongHeadline', e.target.value.slice(0, 90))} placeholder="Longer headline shown in some placements" />
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-gray-400">{(form.pmaxLongHeadline || '').length}/90</span>
              </div>
            </div>
          </div>

          {/* Descriptions */}
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-white/6 dark:bg-white/2">
            <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-white/30">Descriptions (2–4, max 90 chars each)</p>
            <div className="flex flex-col gap-1.5">
              {(form.pmaxDescriptions || ['', '']).map((d, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <div className="relative flex-1">
                    <Input
                      value={d}
                      onChange={(e) => {
                        const n = [...(form.pmaxDescriptions || ['', ''])];
                        n[i] = e.target.value.slice(0, 90);
                        setField('pmaxDescriptions', n);
                      }}
                      placeholder={`Description ${i + 1}`}
                    />
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-gray-400">{d.length}/90</span>
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

          {/* Media assets */}
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-white/6 dark:bg-white/2">
            <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-white/30">Media assets</p>
            <div className="flex flex-col gap-3">
              <div>
                <Label>Image URL <span className="text-gray-400 dark:text-white/30">(landscape 1200×628)</span></Label>
                <Input value={form.pmaxImageUrl} onChange={(e) => setField('pmaxImageUrl', e.target.value)} placeholder="https://example.com/image.jpg" />
              </div>
              <div>
                <Label>Logo URL <span className="text-gray-400 dark:text-white/30">(square, min 128×128)</span></Label>
                <Input value={form.pmaxLogoUrl} onChange={(e) => setField('pmaxLogoUrl', e.target.value)} placeholder="https://example.com/logo.png" />
              </div>
              <div>
                <Label>YouTube video URL or ID</Label>
                <Input value={form.pmaxVideoUrl} onChange={(e) => setField('pmaxVideoUrl', e.target.value)} placeholder="https://youtube.com/watch?v=... or video ID" />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Step: Ad Group ───────────────────────────────────────────────────────────

function AdGroupStep({ form, setField, errors, genderOptions, biddingGoalOptions, keywordMatchTypes, videoFormatOptions }) {
  const channel = form.destination || form.objective;
  const toggleGender = (g) => {
    const cur = form.genders || [];
    setField('genders', cur.includes(g) ? cur.filter((x) => x !== g) : [...cur, g]);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label required>Ad group name</Label>
          <Input value={form.adGroupName} onChange={(e) => setField('adGroupName', e.target.value)} placeholder="e.g. Summer Sale — Branded" maxLength={120} />
          <FieldError msg={errors.adGroupName} />
        </div>

        <div>
          <Label>Max CPC bid</Label>
          <div className="relative">
            <span className="absolute top-1/2 left-3 -translate-y-1/2 text-xs font-semibold text-gray-400 dark:text-white/30">₹</span>
            <Input type="number" value={form.cpcBid} onChange={(e) => setField('cpcBid', e.target.value)} placeholder="1" className="pl-6" />
          </div>
          <p className="mt-1 text-[10px] text-gray-400 dark:text-white/30">Optional — defaults to ₹1 if empty</p>
          <FieldError msg={errors.cpcBid} />
        </div>

        <div>
          <Label>Genders</Label>
          <div className="flex gap-2">
            {genderOptions.map(({ value, label }) => {
              const active = (form.genders || []).includes(value);
              return (
                <button key={value} onClick={() => toggleGender(value)}
                  className={`flex-1 rounded-xl border py-2 text-xs font-semibold transition-all ${
                    active
                      ? 'border-[#4285F4]/50 bg-[#4285F4]/10 text-[#4285F4]'
                      : 'border-gray-200 bg-transparent text-gray-500 hover:border-gray-300 dark:border-white/8 dark:text-[#BEBEBE]'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <Label>Age min</Label>
          <Input type="number" value={form.ageMin} onChange={(e) => setField('ageMin', e.target.value)} placeholder="18" />
          <FieldError msg={errors.ageMin} />
        </div>

        <div>
          <Label>Age max</Label>
          <Input type="number" value={form.ageMax} onChange={(e) => setField('ageMax', e.target.value)} placeholder="65" />
          <FieldError msg={errors.ageMax} />
        </div>
      </div>

      {/* ── SEARCH type: keywords + bidding ── */}
      {['SALES', 'LEADS', 'WEBSITE_TRAFFIC', 'SEARCH', 'LOCAL_STORE'].includes(channel) && (
        <>
          <KeywordsSection form={form} setField={setField} matchTypes={keywordMatchTypes} />
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-white/6 dark:bg-white/2">
            <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-white/30">Bidding goal <span className="text-red-400">*</span></p>
            <Select value={form.biddingGoal} onChange={(e) => setField('biddingGoal', e.target.value)}>
              {biddingGoalOptions.map(({ value, label }) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </Select>
            {form.biddingGoal === 'TARGET_CPA' && (
              <div className="mt-3">
                <Label required>Target CPA (₹)</Label>
                <Input type="number" value={form.targetCpa} onChange={(e) => setField('targetCpa', e.target.value)} placeholder="500" />
              </div>
            )}
            {form.biddingGoal === 'TARGET_ROAS' && (
              <div className="mt-3">
                <Label required>Target ROAS (%)</Label>
                <Input type="number" value={form.targetRoas} onChange={(e) => setField('targetRoas', e.target.value)} placeholder="300" />
                <p className="mt-1 text-[10px] text-gray-400 dark:text-white/30">300% = ₹3 revenue per ₹1 spent</p>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── DISPLAY: frequency cap ── */}
      {channel === 'DISPLAY' && (
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-white/6 dark:bg-white/2">
          <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-white/30">Frequency cap</p>
          <div>
            <Label>Max impressions per user per day</Label>
            <Input type="number" value={form.frequencyCap} onChange={(e) => setField('frequencyCap', e.target.value)} placeholder="3" />
            <p className="mt-1 text-[10px] text-gray-400 dark:text-white/30">Leave blank for Google to optimize automatically</p>
          </div>
        </div>
      )}

      {/* ── VIDEO / DEMAND_GEN: video format ── */}
      {['DEMAND_GEN', 'VIDEO', 'YOUTUBE_REACH', 'MULTI_CHANNEL', 'APP_PROMOTION'].includes(channel) && (
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-white/6 dark:bg-white/2">
          <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-white/30">Video format</p>
          <div className="flex flex-col gap-1.5">
            {videoFormatOptions.map(({ value, label, desc }) => {
              const active = form.videoFormat === value;
              return (
                <button key={value} onClick={() => setField('videoFormat', value)}
                  className={`flex items-start gap-2.5 rounded-xl border p-2.5 text-left transition-all ${active ? 'border-[#4285F4]/50 bg-[#4285F4]/8 dark:bg-[#4285F4]/10' : 'border-gray-200 bg-white hover:border-gray-300 dark:border-white/8 dark:bg-[#1A1A1A]'}`}
                >
                  <div className={`mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border-2 ${active ? 'border-[#4285F4] bg-[#4285F4]' : 'border-gray-300 dark:border-white/20'}`} />
                  <div>
                    <p className={`text-xs font-semibold ${active ? 'text-[#4285F4]' : 'text-gray-800 dark:text-white'}`}>{label}</p>
                    <p className="text-[10px] text-gray-500 dark:text-[#BEBEBE]">{desc}</p>
                  </div>
                </button>
              );
            })}
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
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-white/6 dark:bg-white/2">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-white/30">Headlines (3–15, max 30 chars each)</p>
        <div className="flex flex-col gap-1.5">
          {headlines.map((h, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <div className="relative flex-1">
                <Input value={h} onChange={(e) => setHeadline(i, e.target.value)} placeholder={`Headline ${i + 1}`} maxLength={30} />
                <span className="absolute top-1/2 right-2 -translate-y-1/2 text-[10px] text-gray-400 dark:text-white/30">{h.length}/30</span>
              </div>
              {headlines.length > 3 && (
                <button onClick={() => removeHeadline(i)} className="shrink-0 rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10">
                  <Trash2 className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}
          {headlines.length < 15 && (
            <button onClick={addHeadline} className="flex items-center gap-1 rounded-xl border border-dashed border-gray-300 px-3 py-2 text-xs text-gray-400 transition-all hover:border-[#4285F4]/40 hover:text-[#4285F4] dark:border-white/10">
              <Plus className="h-3 w-3" /> Add headline
            </button>
          )}
        </div>
        <FieldError msg={errors.headlines} />
      </div>

      <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-white/6 dark:bg-white/2">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-white/30">Descriptions (2–4, max 90 chars each)</p>
        <div className="flex flex-col gap-1.5">
          {descriptions.map((d, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <div className="relative flex-1">
                <Input value={d} onChange={(e) => setDesc(i, e.target.value)} placeholder={`Description ${i + 1}`} maxLength={90} />
                <span className="absolute top-1/2 right-2 -translate-y-1/2 text-[10px] text-gray-400 dark:text-white/30">{d.length}/90</span>
              </div>
              {descriptions.length > 2 && (
                <button onClick={() => removeDesc(i)} className="shrink-0 rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10">
                  <Trash2 className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}
          {descriptions.length < 4 && (
            <button onClick={addDesc} className="flex items-center gap-1 rounded-xl border border-dashed border-gray-300 px-3 py-2 text-xs text-gray-400 transition-all hover:border-[#4285F4]/40 hover:text-[#4285F4] dark:border-white/10">
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
        <p className="text-[10px] text-blue-600 dark:text-[#4285F4]/80">
          SEARCH ads show headlines + descriptions only. No CTA button — Google renders the display URL automatically.
        </p>
      </div>
    </div>
  );
}

// ─── Step: Ad (DISPLAY) ───────────────────────────────────────────────────────

function DisplayAdFields({ form, setField, errors, ctaOptions, uploadingImage, onImageUpload }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <div className="flex items-center justify-between"><Label required>Headline</Label><CharCount val={form.headline} max={30} /></div>
          <Input value={form.headline} onChange={(e) => setField('headline', e.target.value)} placeholder="Best Deals Online" maxLength={30} />
          <FieldError msg={errors.headline} />
        </div>

        <div>
          <div className="flex items-center justify-between"><Label required>Description</Label><CharCount val={form.description} max={90} /></div>
          <Input value={form.description} onChange={(e) => setField('description', e.target.value)} placeholder="Find the best products at unbeatable prices." maxLength={90} />
          <FieldError msg={errors.description} />
        </div>

        <div className="sm:col-span-2">
          <Label required>Image</Label>
          <div className="flex flex-col gap-2">
            <Input value={form.imageUrl} onChange={(e) => setField('imageUrl', e.target.value)} placeholder="https://example.com/banner.jpg (1200×628 recommended)" />
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400 dark:text-white/30">or</span>
              <label className="flex cursor-pointer items-center gap-1.5 rounded-xl border border-dashed border-gray-300 px-3 py-2 text-xs text-gray-500 transition-all hover:border-[#4285F4]/50 hover:text-[#4285F4] dark:border-white/10 dark:text-[#BEBEBE]">
                <input type="file" accept="image/jpeg,image/png,image/gif,.jpg,.jpeg,.png,.gif" className="hidden" onChange={(e) => { if (e.target.files[0]) onImageUpload(e.target.files[0]); }} />
                {uploadingImage ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                {uploadingImage ? 'Uploading…' : 'Upload image'}
              </label>
              {form.assetResourceName && (
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400">
                  Uploaded ✓
                </span>
              )}
            </div>
            <p className="text-[10px] text-gray-400 dark:text-white/25">Accepted formats: JPEG, PNG, GIF only. WebP, TIFF, BMP, SVG are not supported.</p>
          </div>
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
    </div>
  );
}

// ─── Step: Ad (DEMAND_GEN / Video) ────────────────────────────────────────────

function VideoAdFields({ form, setField, errors, ctaOptions }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-white/6 dark:bg-white/2">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-white/30">Video source (one required)</p>
        <div className="flex flex-col gap-2">
          <div>
            <Label>YouTube URL or direct MP4 URL</Label>
            <Input value={form.videoUrl} onChange={(e) => setField('videoUrl', e.target.value)} placeholder="https://www.youtube.com/watch?v=… or https://cdn.example.com/video.mp4" />
            <p className="mt-1 text-[10px] text-gray-400 dark:text-white/30">YouTube URL → ID extracted. MP4 URL → auto-uploaded to YouTube by backend.</p>
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-400 dark:text-white/30">
            <div className="h-px flex-1 bg-gray-200 dark:bg-white/8" /> or <div className="h-px flex-1 bg-gray-200 dark:bg-white/8" />
          </div>
          <div>
            <Label>YouTube video ID (11 chars)</Label>
            <Input value={form.youtubeVideoId} onChange={(e) => setField('youtubeVideoId', e.target.value)} placeholder="dQw4w9WgXcQ" maxLength={11} />
          </div>
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
        <p className="text-[10px] text-amber-700 dark:text-amber-400/80">
          <strong>businessName</strong> and <strong>logoUrl</strong> are handled internally — auto-fetched from the Google Ads account name and YouTube thumbnail.
        </p>
      </div>
    </div>
  );
}

// ─── Step: Ad (dispatcher) ────────────────────────────────────────────────────

function AdStep({ form, setField, errors, ctaOptions, uploadingImage, onImageUpload, adType }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="rounded-full border border-gray-200 bg-gray-100 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:border-white/8 dark:bg-white/5 dark:text-[#BEBEBE]">
          {adType} ad
        </span>
        <p className="text-xs text-gray-500 dark:text-[#BEBEBE]">
          {adType === 'SEARCH'     && 'Responsive search ad — headlines + descriptions'}
          {adType === 'DISPLAY'    && 'Display banner ad — single image + headline'}
          {adType === 'DEMAND_GEN' && 'Demand Gen video ad — YouTube / Discover / Gmail'}
        </p>
      </div>
      {adType === 'SEARCH'     && <SearchAdFields form={form} setField={setField} errors={errors} />}
      {adType === 'DISPLAY'    && <DisplayAdFields form={form} setField={setField} errors={errors} ctaOptions={ctaOptions} uploadingImage={uploadingImage} onImageUpload={onImageUpload} />}
      {adType === 'DEMAND_GEN' && <VideoAdFields form={form} setField={setField} errors={errors} ctaOptions={ctaOptions} />}
    </div>
  );
}

// ─── Step: Review ─────────────────────────────────────────────────────────────

function ReviewRow({ label, value }) {
  if (!value && value !== 0) return null;
  return (
    <div className="flex items-start justify-between gap-4 border-b border-gray-100 py-2 last:border-0 dark:border-white/5">
      <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-white/30">{label}</span>
      <span className="text-right text-xs font-medium text-gray-900 dark:text-white">{value}</span>
    </div>
  );
}

function ReviewStep({ form, mode, stepErrors, adType, schema, objectives }) {
  const hasErrors = Object.keys(stepErrors || {}).length > 0;
  const channel = effectiveChannel(form);
  return (
    <div className="flex flex-col gap-4">
      {hasErrors && (
        <div className="flex items-start gap-2 rounded-xl border border-red-300/50 bg-red-50/80 p-3 dark:border-red-500/20 dark:bg-red-500/8">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
          <div>
            <p className="text-xs font-semibold text-red-600 dark:text-red-400">Fix these before launching:</p>
            <ul className="mt-1 list-inside list-disc text-xs text-red-500 dark:text-red-400/80">
              {Object.entries(stepErrors).flatMap(([sid, errs]) =>
                Object.values(errs).map((msg, i) => <li key={`${sid}-${i}`}>{msg}</li>)
              )}
            </ul>
          </div>
        </div>
      )}

      {['create-full', 'edit-campaign'].includes(mode) && (
        <div className="rounded-2xl border border-gray-200 bg-white p-3 dark:border-white/8 dark:bg-[#161616]">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-white/30">Campaign</p>
          <ReviewRow label="Name"      value={form.campaignName} />
          <ReviewRow label="Objective"   value={objectiveLabel(form.objective, objectives)} />
          <ReviewRow label="Destination" value={destinationLabel(form.destination, schema, objectives)} />
          <ReviewRow label="Budget"    value={form.dailyBudget ? `₹${form.dailyBudget}/day` : null} />
          <ReviewRow label="Status"    value={form.status} />
          {form.startDate  && <ReviewRow label="Start"     value={form.startDate} />}
          {form.endDate    && <ReviewRow label="End"       value={form.endDate} />}
          {form.countries?.length > 0 && <ReviewRow label="Countries" value={form.countries.join(', ')} />}
          {channel === 'SHOPPING' && form.merchantCenterId && <ReviewRow label="Merchant Center" value={form.merchantCenterId} />}
          {channel === 'SHOPPING' && form.productCategory && <ReviewRow label="Product Category" value={form.productCategory} />}
          {channel === 'APP_PROMOTION' && form.appSubtype && <ReviewRow label="App Subtype" value={form.appSubtype.replace(/_/g, ' ')} />}
          {channel === 'APP_PROMOTION' && form.appStoreUrl && <ReviewRow label="App URL" value={form.appStoreUrl} />}
          {channel === 'APP_PROMOTION' && <ReviewRow label="Platform" value={form.appPlatform} />}
          {channel === 'YOUTUBE_REACH' && form.videoGoal && <ReviewRow label="Campaign Goal" value={form.videoGoal.replace(/_/g, ' ')} />}
          {['VIDEO', 'DEMAND_GEN'].includes(channel) && form.videoSubtype && <ReviewRow label="Campaign Subtype" value={form.videoSubtype.replace(/_/g, ' ')} />}
          {form.objective === 'LOCAL_STORE' && form.storeAddress && <ReviewRow label="Store Address" value={form.storeAddress} />}
          {form.objective === 'LOCAL_STORE' && form.locationRadius && <ReviewRow label="Location Radius" value={`${form.locationRadius} km`} />}
          {channel === 'PERFORMANCE_MAX' && form.pmaxFinalUrl && <ReviewRow label="Landing URL" value={form.pmaxFinalUrl} />}
          {channel === 'PERFORMANCE_MAX' && form.assetGroupName && <ReviewRow label="Asset Group" value={form.assetGroupName} />}
        </div>
      )}

      {['create-full', 'create-adgroup', 'edit-adgroup'].includes(mode) && channel !== 'PERFORMANCE_MAX' && channel !== 'SHOPPING' && (
        <div className="rounded-2xl border border-gray-200 bg-white p-3 dark:border-white/8 dark:bg-[#161616]">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-white/30">Ad Group</p>
          <ReviewRow label="Name"    value={form.adGroupName} />
          <ReviewRow label="Max CPC" value={form.cpcBid ? `₹${form.cpcBid}` : null} />
          {form.ageMin && <ReviewRow label="Age"     value={`${form.ageMin}–${form.ageMax || '65'}`} />}
          {form.genders?.length > 0 && <ReviewRow label="Genders" value={form.genders.join(', ')} />}
          {['SALES','LEADS','WEBSITE_TRAFFIC','SEARCH','LOCAL_STORE'].includes(channel) && form.keywords?.some(k=>k.text) && (
            <ReviewRow label="Keywords" value={`${form.keywords.filter(k=>k.text).length} keyword${form.keywords.filter(k=>k.text).length !== 1 ? 's' : ''}`} />
          )}
          {form.biddingGoal && form.biddingGoal !== 'MAXIMIZE_CLICKS' && <ReviewRow label="Bidding" value={form.biddingGoal.replace(/_/g,' ')} />}
          {form.videoFormat && ['DEMAND_GEN','VIDEO','YOUTUBE_REACH','MULTI_CHANNEL','APP_PROMOTION'].includes(channel) && <ReviewRow label="Video Format" value={form.videoFormat.replace(/_/g,' ')} />}
        </div>
      )}

      {channel === 'PERFORMANCE_MAX' && (
        <div className="rounded-2xl border border-gray-200 bg-white p-3 dark:border-white/8 dark:bg-[#161616]">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-white/30">Asset Group</p>
          <ReviewRow label="Name"          value={form.assetGroupName} />
          <ReviewRow label="Business Name" value={form.pmaxBusinessName} />
          <ReviewRow label="Headlines"     value={form.pmaxHeadlines?.filter(Boolean).length ? `${form.pmaxHeadlines.filter(Boolean).length} added` : null} />
          <ReviewRow label="Descriptions"  value={form.pmaxDescriptions?.filter(Boolean).length ? `${form.pmaxDescriptions.filter(Boolean).length} added` : null} />
          {form.pmaxLongHeadline && <ReviewRow label="Long Headline" value={form.pmaxLongHeadline} />}
          {form.pmaxImageUrl && <ReviewRow label="Image" value="URL provided ✓" />}
          {form.pmaxLogoUrl  && <ReviewRow label="Logo"  value="URL provided ✓" />}
          {form.pmaxVideoUrl && <ReviewRow label="Video" value={form.pmaxVideoUrl} />}
        </div>
      )}

      {channel !== 'PERFORMANCE_MAX' && channel !== 'SHOPPING' && (
        <div className="rounded-2xl border border-gray-200 bg-white p-3 dark:border-white/8 dark:bg-[#161616]">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-white/30">Ad — {adType}</p>
          {adType === 'SEARCH' && (
            <>
              <ReviewRow label="Headlines"    value={`${(form.headlines || []).filter(Boolean).length} added`} />
              <ReviewRow label="Descriptions" value={`${(form.descriptions || []).filter(Boolean).length} added`} />
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
            <ReviewRow label="Video" value={form.youtubeVideoId || form.videoUrl} />
          )}
          <ReviewRow label="Landing URL" value={form.finalUrl} />
          {form.callToAction && <ReviewRow label="CTA" value={form.callToAction} />}
        </div>
      )}
    </div>
  );
}

// ─── Main Wizard ──────────────────────────────────────────────────────────────

export default function CreateCampaignWizard({
  open, mode = 'create-full', context = null,
  onClose, adAccountId, account, onCreated,
}) {
  const [form, setFormState]        = useState(() => buildInitialForm(context));

  // ── schema (fetched from server on mount) ────────────────────────────────
  const [schema, setSchema]           = useState(null);
  const [schemaLoading, setSchemaLoading] = useState(true);
  const [schemaError, setSchemaError] = useState(null);

  // ── form state ────────────────────────────────────────────────────────────
  const [stepIndex, setStepIndex]   = useState(0);
  const [touched, setTouched]       = useState({});
  const [errors, setErrors]         = useState({});
  const [launched, setLaunched]     = useState({ loading: false, error: null });
  const [created, setCreated]       = useState(() => seedCreated(mode, context));
  const [uploadingImage, setUploadingImage] = useState(false);
  const [attemptedStepIds, setAttemptedStepIds] = useState(() => new Set());

  // ── derive from schema ────────────────────────────────────────────────────
  // Objectives list from server (schema.objectives is an array)
  const objectives = useMemo(() => schema?.objectives || [], [schema]);
  const destinations = useMemo(() => schema?.destinations || [], [schema]);
  const steps = useMemo(() => buildSteps(mode, form, schema), [mode, form, schema]);

  const currentStep = steps[stepIndex];

  const filteredDestinations = useMemo(
    () => getDestinationsForObjective(form.objective, schema, destinations),
    [form.objective, schema, destinations],
  );

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

  // ── fetch schema on open ──────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    setSchemaLoading(true);
    setSchemaError(null);
    getGoogleWizardSchema()
      .then((r) => setSchema(r?.schema || null))
      .catch((e) => setSchemaError(e?.response?.data?.error || e.message || 'Failed to load wizard schema'))
      .finally(() => setSchemaLoading(false));
  }, [open]);

  // ── reset when wizard opens ───────────────────────────────────────────────
  useEffect(() => {
    if (open) {
      setFormState(buildInitialForm(context));
      setStepIndex(0);
      setTouched({});
      setErrors({});
      setLaunched({ loading: false, error: null });
      setCreated(seedCreated(mode, context));
      setAttemptedStepIds(new Set());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const setField = useCallback((name, value) => {
    setFormState((f) => ({ ...f, [name]: value }));
    setTouched((t) => ({ ...t, [name]: true }));
  }, []);

  const setFields = useCallback((patch) => {
    setFormState((f) => ({ ...f, ...patch }));
    setTouched((t) => ({ ...t, ...Object.fromEntries(Object.keys(patch).map((k) => [k, true])) }));
  }, []);

  // Auto-select when objective has only one valid destination
  useEffect(() => {
    if (!form.objective || form.destination) return;
    if (filteredDestinations.length === 1) {
      setFormState((f) => ({ ...f, destination: filteredDestinations[0].value }));
    }
  }, [form.objective, form.destination, filteredDestinations]);

  // re-validate current step on form change
  useEffect(() => {
    setErrors(validateStep(currentStep?.id, form, adType, schema));
  }, [form, currentStep?.id, adType, schema]);

  const stepErrors   = validateAllSteps(steps, form, schema);
  const canLaunch    = Object.keys(stepErrors).length === 0;

  const launchLabel = (() => {
    if (launched.loading) return null; // handled separately
    if (['edit-campaign', 'edit-adgroup', 'edit-ad'].includes(mode)) return 'Save Changes';
    return 'Launch';
  })();

  const launchIcon = (() => {
    if (['edit-campaign', 'edit-adgroup', 'edit-ad'].includes(mode)) return Check;
    return RefreshCw;
  })();
  const rawStepErrors = useMemo(() => validateStep(currentStep?.id, form, adType, schema), [currentStep?.id, form, adType, schema]);
  const visibleStepErrors = useMemo(() => {
    const showAll = attemptedStepIds.has(currentStep?.id);
    return Object.fromEntries(Object.entries(rawStepErrors).filter(([k]) => touched[k] || showAll));
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
      setField('imageUrl', form.imageUrl || URL.createObjectURL(file));
    } catch (e) {
      globalToast.error(e?.response?.data?.error || 'Image upload failed');
    } finally {
      setUploadingImage(false);
    }
  };

  const goNext = () => {
    const errs = validateStep(currentStep.id, form, adType, schema);
    setErrors(errs);
    setAttemptedStepIds((prev) => new Set([...prev, currentStep.id]));
    if (Object.keys(errs).length) return;
    setStepIndex((i) => Math.min(i + 1, steps.length - 1));
  };

  const goBack = () => setStepIndex((i) => Math.max(i - 1, 0));

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
          dailyBudgetMicros: toMicros(form.dailyBudget),
          status:            form.status || undefined,
          startTime:         form.startDate || undefined,
          endTime:           form.endDate   || undefined,
        });
      } else if (!campaignId && mode === 'create-full') {
        const res = await createGoogleCampaign({
          adAccountId,
          name:              form.campaignName,
          objective:         resolveCampaignObjective(form),
          dailyBudgetMicros: toMicros(form.dailyBudget),
          status:            form.status || 'PAUSED',
          startTime:         form.startDate || undefined,
          endTime:           form.endDate   || undefined,
          targeting:         form.countries?.length ? { countries: form.countries } : undefined,
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
            businessDescription: form.businessDescription || undefined,
            finalUrlSuffix:      form.finalUrlSuffix      || undefined,
            finalUrl:            form.pmaxFinalUrl        || undefined,
            pmaxBusinessName:    form.pmaxBusinessName    || undefined,
            pmaxHeadlines:       form.pmaxHeadlines?.filter(Boolean).length ? form.pmaxHeadlines.filter(Boolean) : undefined,
            pmaxLongHeadline:    form.pmaxLongHeadline    || undefined,
            pmaxDescriptions:    form.pmaxDescriptions?.filter(Boolean).length ? form.pmaxDescriptions.filter(Boolean) : undefined,
            pmaxImageUrl:        form.pmaxImageUrl        || undefined,
            pmaxLogoUrl:         form.pmaxLogoUrl         || undefined,
            pmaxVideoUrl:        form.pmaxVideoUrl        || undefined,
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
      if (mode === 'edit-adgroup') {
        await updateGoogleAdGroup({
          adAccountId,
          adGroupId,
          campaignId,
          name:         form.adGroupName,
          cpcBidMicros: form.cpcBid ? toMicros(form.cpcBid) : undefined,
          status:       form.status || undefined,
        });
      } else if (!adGroupId && !isPmax && ['create-full', 'create-adgroup'].includes(mode)) {
        const targeting = {};
        if (form.ageMin) targeting.ageMin = Number(form.ageMin);
        if (form.ageMax) targeting.ageMax = Number(form.ageMax);
        if (form.genders?.length) targeting.genders = form.genders;
        if (form.targetCountries?.length) targeting.countries = form.targetCountries;

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
        if (adType === 'SEARCH') {
          adItem = { headlines: form.headlines.filter(Boolean), descriptions: form.descriptions.filter(Boolean), finalUrl: form.finalUrl };
        } else if (adType === 'DISPLAY') {
          adItem = { headline: form.headline, description: form.description, imageUrl: (form.imageUrl && !form.imageUrl.startsWith('blob:')) ? form.imageUrl : undefined, assetResourceName: form.assetResourceName || undefined, finalUrl: form.finalUrl, callToAction: form.callToAction || undefined };
        } else {
          adItem = { videoUrl: form.videoUrl || undefined, youtubeVideoId: form.youtubeVideoId || undefined, headline: form.headline || undefined, longHeadline: form.longHeadline || undefined, description: form.description || undefined, finalUrl: form.finalUrl, callToAction: form.callToAction || undefined };
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

      // Pull the most specific message available from the Google Ads error response
      const googleValidations = data.validations || [];
      const googleErrors = data.details?.error?.details || [];

      // fieldViolations come from google.rpc.BadRequest (REST JSON envelope)
      const fieldViolations = googleErrors
        .flatMap((d) => d.fieldViolations || d.errors || [])
        .map((v) => v.description || v.message)
        .filter(Boolean);

      const firstValidation = googleValidations[0]?.message;
      const firstViolation  = fieldViolations[0];
      const apiMessage      = data.details?.error?.message;

      const title   = data.error || e?.message || 'Something went wrong. Please retry.';
      const details = firstValidation || firstViolation || apiMessage || '';

      setLaunched({ loading: false, error: { title, details } });
    }
  };

  if (!open) return null;

  const modeMeta = WIZARD_MODE_META[mode] || WIZARD_MODE_META['create-full'];

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 12 }}
        transition={{ duration: 0.2 }}
        className="relative flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-white/8 dark:bg-[#161616]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-5 py-4 dark:border-white/8">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl border border-gray-200 bg-white dark:border-white/10 dark:bg-white/5">
              <SiGoogleads className="h-4 w-4" style={{ color: GOOGLE_BLUE }} />
            </div>
            <div>
              <h2 className="text-sm font-bold text-gray-900 dark:text-white">{modeMeta.title}</h2>
              {account?.name && <p className="text-[10px] text-gray-500 dark:text-[#BEBEBE]">{account.name}</p>}
            </div>
          </div>
          <button onClick={onClose} className="rounded-xl p-1.5 text-gray-400 transition-all hover:bg-gray-100 hover:text-gray-900 dark:hover:bg-white/8 dark:hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* step pills */}
        {steps.length > 1 && (
          <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-gray-200 px-5 py-2.5 dark:border-white/6">
            {steps.map((s, i) => {
              const StepIcon = s.icon;
              const done   = i < stepIndex;
              const active = i === stepIndex;
              return (
                <React.Fragment key={s.id}>
                  <button
                    onClick={() => i < stepIndex && setStepIndex(i)}
                    disabled={i > stepIndex}
                    className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold transition-all ${
                      active  ? 'bg-[#4285F4]/10 text-[#4285F4]'
                      : done  ? 'cursor-pointer text-gray-400 hover:text-gray-600 dark:text-white/40 dark:hover:text-white/60'
                      : 'text-gray-300 dark:text-white/20'
                    }`}
                  >
                    {done ? <Check className="h-3 w-3 text-emerald-500" /> : <StepIcon className="h-3 w-3" />}
                    {s.label}
                  </button>
                  {i < steps.length - 1 && <ChevronRight className="h-3 w-3 shrink-0 text-gray-300 dark:text-white/15" />}
                </React.Fragment>
              );
            })}
          </div>
        )}

        <div className="flex min-h-0 flex-1">
          <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <AnimatePresence mode="wait">
              <motion.div key={currentStep?.id} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: 0.18 }}>
                {currentStep?.id === 'objective' && (
                  <ObjectiveStep objectives={objectives} form={form} setFields={setFields} errors={visibleStepErrors} schemaLoading={schemaLoading} schemaError={schemaError} />
                )}
                {currentStep?.id === 'destination' && (
                  <DestinationStep destinations={destinations} form={form} setField={setField} errors={visibleStepErrors} schema={schema} />
                )}
                {currentStep?.id === 'campaign' && <CampaignStep form={form} setField={setField} errors={visibleStepErrors} countryOptions={countryOptions} statusOptions={statusOptions} appPlatformOptions={appPlatformOptions} appSubtypeOptions={appSubtypeOptions} videoGoalOptions={videoGoalOptions} videoSubtypeOptions={videoSubtypeOptions} />}
                {currentStep?.id === 'adGroup'  && <AdGroupStep  form={form} setField={setField} errors={visibleStepErrors} genderOptions={genderOptions} biddingGoalOptions={biddingGoalOptions} keywordMatchTypes={keywordMatchTypes} videoFormatOptions={videoFormatOptions} />}
                {currentStep?.id === 'ad' && (
                  <AdStep form={form} setField={setField} errors={visibleStepErrors} ctaOptions={ctaOptions} adType={adType} uploadingImage={uploadingImage} onImageUpload={handleImageUpload} />
                )}
                {currentStep?.id === 'review' && (
                  <ReviewStep form={form} mode={mode} stepErrors={stepErrors} adType={adType} schema={schema} objectives={objectives} />
                )}
              </motion.div>
            </AnimatePresence>
          </div>
          {steps.length > 1 && (
            <WizardSideRail
              steps={steps}
              stepIndex={stepIndex}
              stepErrors={visibleStepErrors}
              rawStepErrors={rawStepErrors}
              allStepErrors={stepErrors}
              onJumpToStep={setStepIndex}
            />
          )}
        </div>

        <LaunchErrorBanner error={launched.error} onDismiss={() => setLaunched({ loading: false, error: null })} />

        {/* footer */}
        <div className="flex shrink-0 items-center justify-between border-t border-gray-200 px-5 py-3 dark:border-white/8">
          <button
            onClick={stepIndex === 0 ? onClose : goBack}
            className="flex items-center gap-1.5 rounded-xl border border-gray-200 px-4 py-2 text-xs font-medium text-gray-700 transition-all hover:bg-gray-50 dark:border-white/8 dark:text-white/70 dark:hover:bg-white/5"
          >
            {stepIndex === 0 ? <><X className="h-3 w-3" /> Cancel</> : <><ChevronLeft className="h-3 w-3" /> Back</>}
          </button>

          <div className="flex items-center gap-2">
            <span className="text-[10px] text-gray-400 dark:text-white/30">{stepIndex + 1} / {steps.length}</span>
            {stepIndex < steps.length - 1 ? (
              <button
                onClick={goNext}
                disabled={schemaLoading}
                className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold text-white transition-all hover:opacity-90 disabled:opacity-40"
                style={{ background: GOOGLE_BLUE }}
              >
                Continue <ChevronRight className="h-3 w-3" />
              </button>
            ) : (
              <button
                onClick={handleLaunch}
                disabled={launched.loading || !canLaunch}
                className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold text-white transition-all hover:opacity-90 disabled:opacity-40"
                style={{ background: GOOGLE_BLUE }}
              >
                {launched.loading
                  ? <><Loader2 className="h-3 w-3 animate-spin" /> {['edit-campaign','edit-adgroup','edit-ad'].includes(mode) ? 'Saving…' : 'Launching…'}</>
                  : (() => { const Icon = launchIcon; return <><Icon className="h-3 w-3" /> {launchLabel}</>; })()
                }
              </button>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
