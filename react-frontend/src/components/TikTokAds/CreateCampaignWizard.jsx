import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ChevronLeft, ChevronRight, Loader2, Check, Rocket, AlertCircle, BookmarkPlus, Bookmark, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  getTiktokWizardSchema,
  getTiktokRegions,
  getTiktokIdentities,
  getTiktokInterestCategories,
  createTiktokCampaign,
  createTiktokAdGroup,
  createTiktokAd,
  updateTiktokCampaign,
  updateTiktokAdGroup,
  updateTiktokAd,
  uploadTiktokVideo,
  uploadTiktokImage,
  listTiktokCampaignTemplates,
  getTiktokCampaignTemplate,
  saveTiktokCampaignTemplate,
  deleteTiktokCampaignTemplate,
} from '@/apis/tikTokAds/tikTokAdsApi';
import {
  FieldShell,
  TextField,
  NumberField,
  SelectField,
  MultiSelectField,
  SegGroup,
} from '@/components/MetaAds/wizardFields';

function MediaPreview({ file, url, type, onRemove }) {
  const [src, setSrc] = useState(null);

  useEffect(() => {
    let objectUrl = null;
    if (file) {
      objectUrl = URL.createObjectURL(file);
      setSrc(objectUrl);
    } else if (url) {
      setSrc(url);
    } else {
      setSrc(null);
    }
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file, url]);

  if (!src) return null;

  return (
    <div className="relative mt-3 inline-block max-w-full overflow-hidden rounded-lg border border-gray-200 bg-black/5 p-1 dark:border-white/10 dark:bg-white/5">
      <button
        type="button"
        onClick={onRemove}
        className="absolute top-2 right-2 z-10 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-black dark:bg-white/20 dark:hover:bg-white/30"
      >
        Remove
      </button>
      {type === 'video' ? (
        <video src={src} controls className="max-h-52 w-auto rounded-md" preload="metadata" />
      ) : (
        <img src={src} alt="Media preview" className="max-h-52 w-auto rounded-md object-contain" />
      )}
      {file && (
        <p className="mt-1 truncate text-[11px] text-gray-500 dark:text-white/50" title={file.name}>
          {file.name}
        </p>
      )}
    </div>
  );
}

// TikTok-only multi-select with a scrollable chip list. We keep this local
// instead of extending the Meta Ads wizard field so the two wizards stay
// independent.
function ScrollableMultiSelectField({
  label,
  hint,
  required,
  error,
  values,
  onChange,
  options,
  disabled = false,
  className = '',
  maxHeight = 'max-h-72',
}) {
  const set = new Set(values || []);
  const toggle = (v) => {
    const next = new Set(set);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    onChange(Array.from(next));
  };

  return (
    <FieldShell label={label} hint={hint} error={error} required={required} className={className}>
      <div
        className={`${maxHeight} overflow-y-auto rounded-lg border border-gray-200 bg-gray-50/50 p-2 dark:border-white/10 dark:bg-white/5`}
      >
        <div className={`flex flex-wrap gap-2 ${disabled ? 'opacity-40 pointer-events-none' : ''}`}>
          {options.map((opt) => {
            const v = typeof opt === 'string' ? opt : opt.value;
            const lbl = typeof opt === 'string' ? opt : opt.label;
            const active = set.has(v);
            return (
              <div
                key={v}
                className={`rounded-full p-[1px] transition-all ${
                  active
                    ? 'bg-gradient-to-r from-[#02C8C4] to-[#5867EB]'
                    : 'bg-gray-200 hover:bg-gray-300 dark:bg-white/8 dark:hover:bg-white/15'
                }`}
              >
                <button
                  type="button"
                  onClick={() => toggle(v)}
                  disabled={disabled}
                  className={`flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1 text-13 font-medium transition-all dark:bg-[#1d1d1d] 2xl:px-4 2xl:py-1.5 2xl:text-sm ${
                    active
                      ? 'text-gray-900 dark:text-white'
                      : 'text-gray-500 hover:text-gray-700 dark:text-white/55 dark:hover:text-white/80'
                  }`}
                >
                  {active && <Check className="h-3 w-3" />}
                  {lbl}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </FieldShell>
  );
}

const STEPS = ['Objective', 'Campaign', 'Ad Group', 'Ad', 'Review'];

// Country-level location IDs (TikTok uses GeoNames IDs). Used as a fallback so
// the location picker is never empty when /tool/region/ fails to load — TikTok
// REQUIRES at least one location_id on every ad group.
const FALLBACK_REGIONS = [
  { id: '6252001', name: 'United States' },
  { id: '2635167', name: 'United Kingdom' },
  { id: '6251999', name: 'Canada' },
  { id: '2077456', name: 'Australia' },
  { id: '2921044', name: 'Germany' },
  { id: '3017382', name: 'France' },
  { id: '2802361', name: 'Belgium' },
  { id: '2750405', name: 'Netherlands' },
  { id: '3175395', name: 'Italy' },
  { id: '2510769', name: 'Spain' },
  { id: '1880251', name: 'Singapore' },
  { id: '1269750', name: 'India' },
  { id: '1643084', name: 'Indonesia' },
  { id: '1861060', name: 'Japan' },
  { id: '3469034', name: 'Brazil' },
];

const AGE_GROUPS = [
  { value: 'AGE_18_24', label: '18–24' },
  { value: 'AGE_25_34', label: '25–34' },
  { value: 'AGE_35_44', label: '35–44' },
  { value: 'AGE_45_54', label: '45–54' },
  { value: 'AGE_55_100', label: '55+' },
];

const GENDERS = [
  { value: 'GENDER_UNLIMITED', label: 'All' },
  { value: 'GENDER_MALE', label: 'Male' },
  { value: 'GENDER_FEMALE', label: 'Female' },
];

const BID_TYPES = [
  { value: 'BID_TYPE_NO_BID', label: 'No bid (lowest cost)' },
  { value: 'BID_TYPE_CUSTOM', label: 'Custom bid' },
];

const BUDGET_MODES = [
  { value: 'BUDGET_MODE_DAY', label: 'Daily budget' },
  { value: 'BUDGET_MODE_TOTAL', label: 'Lifetime budget' },
  { value: 'BUDGET_MODE_INFINITE', label: 'No limit' },
];

// TikTok requires the ad group's billing_event to match its optimization goal
// (e.g. REACH → CPM, video views → CPV, conversions → OCPM). Sending the wrong
// pairing is rejected with errors like "Only CPM is supported".
const billingEventForGoal = (goal) => {
  switch (goal) {
    case 'REACH':
      return 'CPM';
    case 'VIDEO_VIEW':
    case 'ENGAGED_VIEW':
      return 'CPV';
    case 'CONVERT':
    case 'VALUE':
    case 'INSTALL':
    case 'IN_APP_EVENT':
    case 'LEADS':
    case 'FOLLOWERS':
    case 'PROFILE_VIEWS':
      return 'OCPM';
    case 'CLICK':
    case 'TRAFFIC':
    case 'LANDING_PAGE':
    default:
      return 'CPC';
  }
};

// TikTok ad groups need a `promotion_type` describing the destination. Only
// objectives that drive to an external destination require it; pure
// awareness / on-TikTok engagement objectives omit it.
const promotionTypeForObjective = (objectiveKey) => {
  switch (objectiveKey) {
    case 'TRAFFIC':
    case 'LEAD_GENERATION':
    case 'PRODUCT_SALES':
      return 'WEBSITE';
    case 'APP_PROMOTION':
      return 'APP_ANDROID';
    default:
      return null; // REACH, VIDEO_VIEWS, ENGAGEMENT
  }
};

// Conversion-stage objectives can't launch until the ad account has a real
// asset set up in TikTok Ads Manager. We surface a heads-up rather than block
// them — they work in production once the asset exists.
const OBJECTIVE_ASSET_NOTE = {
  APP_PROMOTION:
    'Requires a registered app in TikTok (Assets → App) linked to the TikTok SDK or an MMP.',
  LEAD_GENERATION:
    'Requires a TikTok Instant Form, or a Pixel with a lead event for the website path.',
  PRODUCT_SALES: 'Requires a tracking Pixel with a configured conversion event.',
};

// Convert a TikTok "YYYY-MM-DD HH:MM:SS" account-time string into the
// "YYYY-MM-DDTHH:MM" value required by <input type="datetime-local">.
const toDatetimeLocal = (value) => {
  if (!value) return '';
  const s = String(value).trim();
  if (!s) return '';
  // Keep it naive: replace the space with a T and trim to minutes.
  return s.replace(' ', 'T').slice(0, 16);
};

const findObjectiveKeyByType = (objectiveType, objectives = []) => {
  if (!objectiveType) return '';
  const o = objectives.find(
    (obj) =>
      obj.objectiveType === objectiveType ||
      (obj.subTypes || []).some((st) => st.objectiveType === objectiveType)
  );
  return o?.key || '';
};

// Strip runtime/context-only state before serialising the wizard form — File
// handles are not JSON-safe and IDs (campaign/adgroup/ad/identity) are
// account-specific. Names and all other wizard inputs are kept so the template
// fully reproduces the Objective, Campaign, Ad Group and Ad steps.
function stripUnsavable(form) {
  const {
    videoFile,
    imageFile,
    selectedMedia,
    uploadedVideoId,
    uploadedImageId,
    campaignId,
    adgroupId,
    adId,
    identityId,
    ...rest
  } = form || {};
  return rest;
}

function StepRail({ currentIndex }) {
  return (
    <div className="flex items-center gap-1 overflow-x-auto 2xl:gap-1.5">
      {STEPS.map((s, i) => {
        const done = i < currentIndex;
        const active = i === currentIndex;
        return (
          <React.Fragment key={s}>
            <div
              className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium transition-all shrink-0 2xl:px-3 2xl:py-1.5 2xl:text-sm ${
                active
                  ? 'bg-gradient-to-r from-[#15DCFF] to-[#6b72f8] text-white'
                  : done
                  ? 'border border-emerald-400/30 bg-emerald-50 text-emerald-600 dark:bg-emerald-400/10 dark:text-emerald-300'
                  : 'border border-gray-200 bg-gray-50 text-gray-400 dark:border-white/8 dark:bg-white/3 dark:text-white/30'
              }`}
            >
              {done ? (
                <Check className="h-3 w-3 2xl:h-3.5 2xl:w-3.5" />
              ) : (
                <span className="flex h-3.5 w-3.5 items-center justify-center text-[10px] 2xl:h-4 2xl:w-4 2xl:text-[11px]">
                  {i + 1}
                </span>
              )}
              <span className="hidden sm:inline">{s}</span>
            </div>
            {i < STEPS.length - 1 && (
              <div
                className={`h-0.5 w-2 2xl:w-3 shrink-0 ${
                  i < currentIndex ? 'bg-emerald-400/30' : 'bg-gray-200 dark:bg-white/15'
                }`}
              />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function getStepIssues(step, form, selectedObjective) {
  const issues = [];
  switch (step) {
    case 0: // Objective
      if (!form.objectiveKey) issues.push('Select an objective');
      break;
    case 1: // Campaign
      if (!form.campaignName.trim()) issues.push('Campaign name is required');
      if (form.budgetMode !== 'BUDGET_MODE_INFINITE' && (!form.budget || Number(form.budget) <= 0)) {
        issues.push('Enter a valid budget');
      }
      break;
    case 2: // Ad Group
      if (!form.adgroupName.trim()) issues.push('Ad group name is required');
      if (!form.optimizationGoal) issues.push('Select an optimization goal');
      if (!form.adgroupBudget || Number(form.adgroupBudget) <= 0) issues.push('Enter a valid daily budget');
      if (!form.locationIds.length) issues.push('Select at least one location');
      if (form.bidType === 'BID_TYPE_CUSTOM' && (!form.bidPrice || Number(form.bidPrice) <= 0)) {
        issues.push('Enter a valid bid price');
      }
      break;
    case 3: // Ad
      if (!form.identityId) issues.push('Select a TikTok identity to publish the ad');
      if (form.mediaType === 'video' && !form.videoUrl && !form.videoFile) {
        issues.push('Provide a video URL or upload a video file');
      }
      if (form.mediaType === 'image' && !form.imageUrl && !form.imageFile) {
        issues.push('Provide an image URL or upload an image file');
      }
      if (!form.adText.trim()) issues.push('Ad text is recommended');
      if (!form.landingPageUrl.trim()) issues.push('Landing page URL is recommended');
      break;
    case 4: // Review
      break;
    default:
      break;
  }
  return issues;
}

function CampaignSetupSidebar({ currentStep, form, selectedObjective, onStepClick }) {
  const currentIssues = getStepIssues(currentStep, form, selectedObjective);

  return (
    <div className="hidden lg:flex w-72 shrink-0 flex-col gap-4 border-l border-gray-100 bg-gray-50/50 px-5 py-5 dark:border-white/5 dark:bg-white/[0.02]">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-white/40">
        Campaign Setup
      </h3>

      <div className="flex flex-col gap-1">
        {STEPS.map((s, i) => {
          const isActive = i === currentStep;
          const stepIssues = getStepIssues(i, form, selectedObjective);
          const isDone = i < currentStep && stepIssues.length === 0;
          const hasIssue = stepIssues.length > 0 && !isDone;
          const isInvalidPast = i < currentStep && stepIssues.length > 0;
          return (
            <button
              key={s}
              type="button"
              onClick={() => onStepClick?.(i)}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-all ${
                isActive
                  ? 'bg-[#15DCFF]/10 text-[#15DCFF] dark:bg-[#15DCFF]/10'
                  : isInvalidPast
                  ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                  : 'text-gray-500 hover:bg-gray-100 dark:text-white/50 dark:hover:bg-white/5'
              }`}
            >
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                  isDone
                    ? 'bg-emerald-500 text-white'
                    : hasIssue
                    ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400'
                    : isActive
                    ? 'bg-[#15DCFF] text-white'
                    : 'bg-gray-200 text-gray-500 dark:bg-white/10 dark:text-white/50'
                }`}
              >
                {isDone ? <Check className="h-3 w-3" /> : i + 1}
              </span>
              <span className="font-medium">{s}</span>
            </button>
          );
        })}
      </div>

      {currentIssues.length > 0 && currentStep < 4 && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-amber-700 dark:text-amber-400">
            <AlertCircle className="h-3.5 w-3.5" />
            {currentIssues.length} thing{currentIssues.length > 1 ? 's' : ''} left on this step
          </div>
          <ul className="flex list-disc flex-col gap-1 pl-4 text-[11px] text-amber-700/80 dark:text-amber-400/80">
            {currentIssues.map((issue, idx) => (
              <li key={idx}>{issue}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// "Save as template" — inline chip → name input → POST. Lives on the Review
// step. Only meaningful in create mode (the wizard has the whole form).
function SaveAsTemplateChip({ form, advertiserId }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      await saveTiktokCampaignTemplate({
        name: trimmed,
        payload: { ...stripUnsavable(form), advertiserId },
        objective: form.objectiveKey,
        conversionLocation: form.objectiveType,
      });
      toast.success(`Template "${trimmed}" saved.`);
      setOpen(false);
      setName('');
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Failed to save template.');
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        title="Save Objective, Campaign, Ad Group and Ad settings as a reusable template"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-semibold text-gray-600 transition-colors hover:border-gray-300 hover:text-gray-900 dark:border-white/12 dark:bg-white/4 dark:text-white/75 dark:hover:border-white/25 dark:hover:text-white"
      >
        <BookmarkPlus className="h-3.5 w-3.5" /> Save as template
      </button>
    );
  }
  return (
    <div className="inline-flex items-center gap-1.5 rounded-l-full rounded-r-full border border-r-0 border-gray-300 bg-gray-50 py-1 pl-1 pr-0 dark:border-white/15 dark:bg-white/4">
      <input
        type="text"
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleSave();
          if (e.key === 'Escape') {
            setOpen(false);
            setName('');
          }
        }}
        placeholder="Template name…"
        maxLength={120}
        className="w-36 rounded-full bg-transparent px-3 py-1 text-xs text-gray-900 placeholder:text-gray-400 focus:outline-none dark:text-white dark:placeholder:text-white/40"
      />
      <button
        type="button"
        onClick={handleSave}
        disabled={!name.trim() || saving}
        className="flex items-center gap-1 rounded-full bg-gradient-to-r from-[#15DCFF] to-[#6b72f8] px-3 py-1 text-xs font-bold text-white shadow-sm transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
        Save
      </button>
      <button
        type="button"
        onClick={() => { setOpen(false); setName(''); }}
        disabled={saving}
        className="flex h-6 w-6 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-white/45 dark:hover:bg-white/8 dark:hover:text-white"
        aria-label="Cancel"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// "Start from template" — Objective-step dropdown. Lists the user's saved
// templates, applies the selected one's payload to the form.
function TemplatePicker({ onApply }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [applyingId, setApplyingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // Lazy-load list when the dropdown opens.
  useEffect(() => {
    if (!open || items.length) return undefined;
    let cancelled = false;
    setLoading(true);
    listTiktokCampaignTemplates()
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
      const r = await getTiktokCampaignTemplate(t.id);
      if (r?.template?.payload) {
        await onApply?.(r.template);
        toast.success(`Applied template "${t.name}".`);
        setOpen(false);
      }
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Failed to load template.');
    } finally {
      setApplyingId(null);
    }
  };

  const handleDelete = async (e, t) => {
    e.stopPropagation();
    setDeletingId(t.id);
    try {
      await deleteTiktokCampaignTemplate(t.id);
      setItems((prev) => prev.filter((x) => x.id !== t.id));
      toast.success(`Deleted "${t.name}".`);
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to delete template.');
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
              No saved templates yet. Fill all 4 steps and save the campaign you&apos;re building on the Review step to reuse it later.
            </div>
          )}
          {!loading && items.map((t) => (
            <button
              type="button"
              key={t.id}
              disabled={!!applyingId}
              onClick={() => handlePick(t)}
              className="flex w-full items-center gap-2 border-b border-gray-200 px-3 py-2.5 text-left transition-colors last:border-b-0 hover:bg-gray-100 disabled:opacity-50 dark:border-white/5 dark:hover:bg-white/5"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-gray-900 dark:text-white">{t.name}</p>
                {(t.objective || t.conversionLocation) && (
                  <p className="truncate text-[11px] text-gray-500 dark:text-white/45">
                    {[t.objective, t.conversionLocation].filter(Boolean).join(' · ')}
                  </p>
                )}
              </div>
              {applyingId === t.id ? (
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-gray-400 dark:text-white/55" />
              ) : (
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => handleDelete(e, t)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') handleDelete(e, t);
                  }}
                  title="Delete template"
                  className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-red-600 dark:text-white/35 dark:hover:bg-white/8 dark:hover:text-red-300"
                >
                  {deletingId === t.id ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Trash2 className="h-3 w-3" />
                  )}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Review-step card + field helpers (mirrors Meta Ads Manager V2 review layout).
function ReviewSection({ title, children, wide = false }) {
  return (
    <div
      className={`overflow-hidden rounded-2xl border border-gray-200 bg-gray-50 dark:border-white/12 dark:bg-[#303030]/20 ${
        wide ? 'md:col-span-2' : ''
      }`}
    >
      <div className="border-b border-gray-200 bg-gray-100 px-4 py-2 dark:border-white/10 dark:bg-white/5 2xl:px-5 2xl:py-2.5">
        <p className="text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-white/85 2xl:text-sm">
          {title}
        </p>
      </div>
      <dl className="divide-y divide-gray-200 dark:divide-white/8">{children}</dl>
    </div>
  );
}

function ReviewField({ label, value }) {
  return (
    <div className="flex items-start gap-3 px-4 py-2 2xl:px-5 2xl:py-2.5">
      <dt className="w-28 shrink-0 text-xs font-semibold tracking-wider text-gray-500 dark:text-white/55 2xl:w-32 2xl:text-sm">
        {label}
      </dt>
      <dd className="min-w-0 flex-1 break-words text-xs font-medium text-gray-900 dark:text-white 2xl:text-sm">
        {value || <span className="text-gray-400 dark:text-white/30">—</span>}
      </dd>
    </div>
  );
}

const CreateCampaignWizard = ({
  advertiserId,
  currency = 'USD',
  mode = 'create',
  context = null,
  onClose,
  onCreated,
  onChangeAccount,
}) => {
  const isCreate = mode === 'create';
  const isEdit = !isCreate;
  const isEditCampaign = mode === 'edit-campaign';
  const isEditAdGroup = mode === 'edit-adgroup';
  const isEditAd = mode === 'edit-ad';

  // Build initial form from context when editing.
  const buildInitialForm = () => {
    if (!context) return {};
    if (isEditCampaign) {
      return {
        campaignName: context.name || '',
        budgetMode: context.budgetMode || 'BUDGET_MODE_DAY',
        budget: context.budget != null ? Number(context.budget) : 50,
      };
    }
    if (isEditAdGroup) {
      const raw = context.raw || {};
      return {
        objectiveType: raw.objective_type || '',
        optimizationGoal: raw.optimize_goal || context.optimizationGoal || '',
        adgroupName: context.name || '',
        locationIds: (raw.location_ids || []).map(String),
        ageGroups: (raw.age_groups || []).map(String),
        gender: raw.gender || 'GENDER_UNLIMITED',
        interestCategoryIds: (raw.interest_category_ids || []).map(String),
        adgroupBudget: context.budget != null ? Number(context.budget) : 20,
        budgetMode: context.budgetMode || raw.budget_mode || 'BUDGET_MODE_DAY',
        frequency: raw.frequency || 1,
        frequencySchedule: raw.frequency_schedule || 7,
        bidType: raw.bid_type || 'BID_TYPE_NO_BID',
        bidPrice: raw.bid != null ? String(raw.bid) : '',
        scheduleEndTime: toDatetimeLocal(raw.schedule_end_time),
      };
    }
    if (isEditAd) {
      const raw = context.raw || {};
      return {
        adName: context.name || '',
        adText: raw.ad_text || raw.creative?.ad_text || '',
        cta: raw.call_to_action || raw.creative?.call_to_action || 'LEARN_MORE',
        landingPageUrl: raw.landing_page_url || raw.creative?.landing_page_url || '',
        identityId: raw.identity_id || raw.creative?.identity_id || '',
        mediaType: raw.ad_format === 'SINGLE_IMAGE' ? 'image' : 'video',
      };
    }
    return {};
  };

  const initialStep = isEditCampaign ? 1 : isEditAdGroup ? 2 : isEditAd ? 3 : 0;

  const [step, setStep] = useState(initialStep);
  const [schema, setSchema] = useState(null);
  const [regions, setRegions] = useState([]);
  const [identities, setIdentities] = useState([]);
  const [interestCategories, setInterestCategories] = useState([]);
  const [launching, setLaunching] = useState(false);
  const [created, setCreated] = useState({}); // {campaignId, adgroupId, videoId, imageId, adId}
  const [error, setError] = useState(null);
  const [errors, setErrors] = useState({}); // field-level validation errors

  const [form, setForm] = useState({
    objectiveKey: '',
    objectiveType: '',
    optimizationGoal: '',
    campaignName: '',
    budgetMode: 'BUDGET_MODE_DAY',
    budget: 50,
    adgroupName: '',
    locationIds: [],
    ageGroups: [],
    gender: 'GENDER_UNLIMITED',
    interestCategoryIds: [],
    adgroupBudget: 20,
    frequency: 1,
    frequencySchedule: 7,
    bidType: 'BID_TYPE_NO_BID',
    bidPrice: '',
    scheduleEndTime: '',
    identityId: '',
    mediaType: 'video',
    videoUrl: '',
    videoFile: null,
    imageUrl: '',
    imageFile: null,
    adName: '',
    adText: '',
    cta: 'LEARN_MORE',
    landingPageUrl: '',
    ...buildInitialForm(),
  });

  const update = (patch) => setForm((f) => ({ ...f, ...patch }));

  // Apply a saved campaign template — merge its payload over the current form,
  // strip runtime-only state, and ask the dashboard to switch advertiser accounts
  // if the template was saved against a different one.
  const applyTemplate = (template) => {
    const payload = template?.payload || {};
    const templateAccount = payload.advertiserId || null;
    const patch = { ...payload };
    delete patch.advertiserId;
    delete patch.videoFile;
    delete patch.imageFile;
    // Make sure we don't replay stale IDs, media handles or account-specific
    // identity. Names and all step settings are intentionally preserved.
    patch.selectedMedia = null;
    patch.uploadedVideoId = null;
    patch.uploadedImageId = null;
    patch.campaignId = null;
    patch.adgroupId = null;
    patch.adId = null;
    patch.identityId = '';
    update(patch);
    setStep(0);
    if (templateAccount && templateAccount !== advertiserId) {
      onChangeAccount?.(templateAccount);
    }
  };

  useEffect(() => {
    getTiktokWizardSchema()
      .then(setSchema)
      .catch(() => toast.error('Failed to load wizard config'));
    getTiktokIdentities(advertiserId)
      .then((r) => setIdentities(r.identities || []))
      .catch(() => {});
  }, [advertiserId]);

  // TikTok's /tool/region/ and /tool/interest_category/ endpoints require an
  // objective_type. Re-fetch when the user picks/changes the objective so the
  // available locations/interests match the campaign goal.
  useEffect(() => {
    if (!advertiserId) return;
    const objectiveType = form.objectiveType || 'TRAFFIC';
    getTiktokRegions(advertiserId, undefined, objectiveType)
      .then((r) => setRegions(r.regions?.length ? r.regions : FALLBACK_REGIONS))
      .catch((e) => {
        // Region API failed — fall back to a country list so the user can still
        // pick a required location.
        setRegions(FALLBACK_REGIONS);
        toast.error(
          e.response?.data?.error || 'Could not load full region list — showing countries only'
        );
      });
    getTiktokInterestCategories(advertiserId, undefined, objectiveType)
      .then((r) => setInterestCategories(r.categories || []))
      .catch(() => setInterestCategories([]));
  }, [advertiserId, form.objectiveType]);

  const selectedObjective = useMemo(
    () => schema?.objectives?.find((o) => o.key === form.objectiveKey),
    [schema, form.objectiveKey]
  );

  // In edit mode the context only gives us the API `objective_type`. Once the
  // schema loads, derive the wizard `objectiveKey` so the ad-group step can
  // show the right optimization-goal options and Reach-only fields.
  useEffect(() => {
    if (!isEdit || !schema || form.objectiveKey) return;
    const key = findObjectiveKeyByType(form.objectiveType, schema.objectives || []);
    if (key) update({ objectiveKey: key });
  }, [isEdit, schema, form.objectiveType, form.objectiveKey]);

  // Objective used to drive ad-group fields. Prefer the explicit key; fall back
  // to a lookup by API objective_type so edits still populate correctly before
  // the schema effect fires.
  const currentObjective = useMemo(() => {
    if (!schema) return null;
    if (form.objectiveKey) return schema.objectives?.find((o) => o.key === form.objectiveKey) || null;
    if (form.objectiveType) {
      return (
        schema.objectives?.find(
          (o) =>
            o.objectiveType === form.objectiveType ||
            (o.subTypes || []).some((s) => s.objectiveType === form.objectiveType)
        ) || null
      );
    }
    return selectedObjective;
  }, [schema, form.objectiveKey, form.objectiveType, selectedObjective]);

  const pickObjective = (o) =>
    update({
      objectiveKey: o.key,
      objectiveType: o.objectiveType,
      optimizationGoal: o.optimizationGoals?.[0] || '',
    });

  // ── validation per step ──
  const validateStep = (targetStep = step) => {
    const errs = {};
    if (targetStep === 0) {
      if (!form.objectiveKey) errs.objectiveKey = 'Select an objective';
    }
    if (targetStep === 1) {
      if (!form.campaignName.trim()) errs.campaignName = 'Campaign name is required';
      if (form.budgetMode !== 'BUDGET_MODE_INFINITE' && (!form.budget || Number(form.budget) <= 0)) {
        errs.budget = 'Enter a valid budget';
      }
    }
    if (targetStep === 2) {
      if (!form.adgroupName.trim()) errs.adgroupName = 'Ad group name is required';
      if (!form.optimizationGoal) errs.optimizationGoal = 'Optimization goal is required';
      if (!form.adgroupBudget || Number(form.adgroupBudget) <= 0) {
        errs.adgroupBudget = 'Daily budget is required';
      }
      if (!form.locationIds.length) errs.locationIds = 'Select at least one location';
      if (form.bidType === 'BID_TYPE_CUSTOM' && (!form.bidPrice || Number(form.bidPrice) <= 0)) {
        errs.bidPrice = 'Bid price is required';
      }
    }
    if (targetStep === 3) {
      // Ad creation is optional, but if an identity is chosen we need media.
      if (form.identityId) {
        if (form.mediaType === 'video' && !form.videoUrl && !form.videoFile) {
          errs.video = 'Provide a video URL or upload a file';
        }
        if (form.mediaType === 'image' && !form.imageUrl && !form.imageFile) {
          errs.image = 'Provide an image URL or upload a file';
        }
      }
    }
    return errs;
  };

  const canNext = () => Object.keys(validateStep(step)).length === 0;

  const canLaunch = () =>
    STEPS.slice(0, -1).every((_, i) => Object.keys(validateStep(i)).length === 0);

  const handleNext = () => {
    const errs = validateStep(step);
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    setStep((s) => s + 1);
  };

  // Clear field errors when the user fixes them
  useEffect(() => {
    setErrors((prev) => {
      const current = validateStep(step);
      const next = {};
      Object.keys(prev).forEach((k) => {
        if (current[k]) next[k] = current[k];
      });
      return next;
    });
  }, [form, step]);

  const scheduleEndPayload = () => {
    if (!form.scheduleEndTime) return {};
    // TikTok expects "YYYY-MM-DD HH:MM:SS" in the account timezone.
    const d = new Date(form.scheduleEndTime);
    if (isNaN(d.getTime())) return {};
    const pad = (n) => String(n).padStart(2, '0');
    return {
      schedule_end_time: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
        d.getHours()
      )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`,
    };
  };

  // ── edit save ──
  const handleSave = async () => {
    setLaunching(true);
    setError(null);
    try {
      if (isEditCampaign) {
        await updateTiktokCampaign({
          advertiserId,
          campaignId: context.id,
          campaignName: form.campaignName,
          budget: Number(form.budget),
          budgetMode: form.budgetMode,
        });
      } else if (isEditAdGroup) {
        const payload = {
          advertiser_id: advertiserId,
          adgroup_id: context.id,
          adgroup_name: form.adgroupName,
          location_ids: form.locationIds,
          age_groups: form.ageGroups,
          gender: form.gender,
          interest_category_ids: form.interestCategoryIds,
          budget: Number(form.adgroupBudget),
          budget_mode: 'BUDGET_MODE_DAY',
          optimization_goal: form.optimizationGoal,
          bid_type: form.bidType,
          ...(form.bidType === 'BID_TYPE_CUSTOM' && form.bidPrice
            ? { bid: Number(form.bidPrice) }
            : {}),
          ...scheduleEndPayload(),
          ...(form.optimizationGoal === 'REACH'
            ? {
                frequency: Number(form.frequency) || 1,
                frequency_schedule: Number(form.frequencySchedule) || 7,
              }
            : {}),
        };
        await updateTiktokAdGroup({
          advertiserId,
          adgroupId: context.id,
          adgroupName: form.adgroupName,
          payload,
        });
      } else if (isEditAd) {
        await updateTiktokAd({
          advertiserId,
          creatives: [
            {
              ad_id: context.id,
              ad_name: form.adName,
              ad_text: form.adText,
              call_to_action: form.cta,
              landing_page_url: form.landingPageUrl,
            },
          ],
        });
      }
      toast.success('Saved successfully');
      onCreated?.();
      onClose();
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Failed to save';
      setError(msg);
      toast.error(msg);
    } finally {
      setLaunching(false);
    }
  };

  // ── idempotent sequential launch ──
  const handleLaunch = async () => {
    setLaunching(true);
    setError(null);
    try {
      let { campaignId, adgroupId, videoId, imageId, adId } = created;

      // 1. Campaign
      if (!campaignId) {
        const res = await createTiktokCampaign({
          advertiserId,
          campaignName: form.campaignName,
          objectiveType: form.objectiveType,
          budgetMode: form.budgetMode,
          budget: Number(form.budget),
        });
        campaignId = res.campaignId;
        setCreated((c) => ({ ...c, campaignId }));
        if (!campaignId) throw new Error('Campaign creation returned no id');
      }

      // 2. Ad Group
      if (!adgroupId) {
        const payload = {
          advertiser_id: advertiserId,
          campaign_id: campaignId,
          adgroup_name: form.adgroupName,
          placement_type: 'PLACEMENT_TYPE_NORMAL',
          placements: ['PLACEMENT_TIKTOK'],
          location_ids: form.locationIds,
          ...(form.ageGroups.length ? { age_groups: form.ageGroups } : {}),
          ...(form.gender && form.gender !== 'GENDER_UNLIMITED' ? { gender: form.gender } : {}),
          ...(form.interestCategoryIds.length
            ? { interest_category_ids: form.interestCategoryIds }
            : {}),
          ...(promotionTypeForObjective(form.objectiveKey)
            ? { promotion_type: promotionTypeForObjective(form.objectiveKey) }
            : {}),
          budget_mode: form.budgetMode,
          budget: Number(form.adgroupBudget),
          schedule_type: 'SCHEDULE_FROM_NOW',
          ...scheduleEndPayload(),
          optimization_goal: form.optimizationGoal,
          billing_event: billingEventForGoal(form.optimizationGoal),
          bid_type: form.bidType,
          ...(form.bidType === 'BID_TYPE_CUSTOM' && form.bidPrice
            ? { bid_price: Number(form.bidPrice) }
            : {}),
          pacing: 'PACING_MODE_SMOOTH',
          operation_status: 'ENABLE',
          // REACH requires a frequency cap: show the ad at most `frequency`
          // times every `frequency_schedule` days.
          ...(form.optimizationGoal === 'REACH'
            ? {
                frequency: Number(form.frequency) || 1,
                frequency_schedule: Number(form.frequencySchedule) || 7,
              }
            : {}),
        };

        const res = await createTiktokAdGroup({
          advertiserId,
          campaignId,
          adgroupName: form.adgroupName,
          payload,
        });
        adgroupId = res.adgroupId;
        setCreated((c) => ({ ...c, adgroupId }));
      }

      // 3. Media upload (only if we have an identity + a media source)
      if (form.identityId) {
        if (form.mediaType === 'video' && !videoId) {
          if (form.videoFile) {
            const res = await uploadTiktokVideo({ advertiserId, file: form.videoFile });
            videoId = res.videos?.[0]?.videoId;
          } else if (form.videoUrl) {
            const res = await uploadTiktokVideo({ advertiserId, videoUrl: form.videoUrl });
            videoId = res.videos?.[0]?.videoId;
          }
          if (videoId) setCreated((c) => ({ ...c, videoId }));
        }

        if (form.mediaType === 'image' && !imageId) {
          if (form.imageFile) {
            const res = await uploadTiktokImage({ advertiserId, file: form.imageFile });
            imageId = res.images?.[0]?.imageId;
          } else if (form.imageUrl) {
            const res = await uploadTiktokImage({ advertiserId, imageUrl: form.imageUrl });
            imageId = res.images?.[0]?.imageId;
          }
          if (imageId) setCreated((c) => ({ ...c, imageId }));
        }
      }

      // 4. Ad (only if we have an identity + a media asset)
      if (!adId && form.identityId && (videoId || imageId)) {
        const creative = {
          ad_name: form.adName || form.campaignName,
          identity_id: form.identityId,
          identity_type: 'CUSTOMIZED_USER',
          ad_text: form.adText,
          call_to_action: form.cta,
          landing_page_url: form.landingPageUrl,
        };

        if (form.mediaType === 'video' && videoId) {
          creative.ad_format = 'SINGLE_VIDEO';
          creative.video_id = videoId;
        } else if (form.mediaType === 'image' && imageId) {
          creative.ad_format = 'SINGLE_IMAGE';
          creative.image_ids = [imageId];
        }

        const res = await createTiktokAd({
          advertiserId,
          adgroupId,
          creatives: [creative],
        });
        adId = res.adIds?.[0];
        setCreated((c) => ({ ...c, adId }));
      }

      toast.success(adId ? 'Campaign, ad group & ad created!' : 'Campaign & ad group created!');
      onCreated?.();
      onClose();
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Failed to create';
      setError(msg);
      toast.error(msg);
    } finally {
      setLaunching(false);
    }
  };

  // ── step bodies ──
  const renderStep = () => {
    switch (step) {
      case 0: // Objective
        return (
          <div className="space-y-4">
            {isCreate && <TemplatePicker onApply={applyTemplate} />}
            {Object.entries(schema?.objectivesByGroup || {}).map(([group, objs]) => (
              <div key={group}>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">{group}</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {objs.map((o) => (
                    <button
                      key={o.key}
                      onClick={() => pickObjective(o)}
                      className={`rounded-xl border p-3 text-left transition ${
                        form.objectiveKey === o.key
                          ? 'border-[#15DCFF] bg-[#15DCFF]/10'
                          : 'border-gray-200 hover:border-gray-300 dark:border-gray-700 dark:hover:border-gray-500'
                      }`}
                    >
                      <p className="text-sm font-medium">{o.label}</p>
                      <p className="mt-0.5 text-xs text-gray-500">{o.description}</p>
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {errors.objectiveKey && (
              <p className="text-xs text-red-500">{errors.objectiveKey}</p>
            )}
            {OBJECTIVE_ASSET_NOTE[form.objectiveKey] && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-600 dark:text-amber-400">
                <span className="font-semibold">Heads up:</span>{' '}
                {OBJECTIVE_ASSET_NOTE[form.objectiveKey]} It won&apos;t create until that&apos;s set
                up in TikTok Ads Manager.
              </div>
            )}
          </div>
        );

      case 1: // Campaign
        return (
          <div className="space-y-4">
            <TextField
              label="Campaign name"
              value={form.campaignName}
              onChange={(v) => update({ campaignName: v })}
              placeholder="e.g. Summer Traffic Campaign"
              required
              error={errors.campaignName}
            />
            <SelectField
              label="Budget mode"
              value={form.budgetMode}
              onChange={(v) => update({ budgetMode: v })}
              options={BUDGET_MODES}
            />
            {form.budgetMode !== 'BUDGET_MODE_INFINITE' && (
              <NumberField
                label={`Budget (${currency})`}
                value={form.budget}
                onChange={(v) => update({ budget: v })}
                min={50}
                required
                error={errors.budget}
                hint="TikTok requires at least 50 USD/day at the campaign level."
              />
            )}
          </div>
        );

      case 2: // Ad Group
        return (
          <div className="space-y-4">
            <TextField
              label="Ad group name"
              value={form.adgroupName}
              onChange={(v) => update({ adgroupName: v })}
              placeholder="e.g. US - 18-34"
              required
              error={errors.adgroupName}
            />
            <SelectField
              label="Optimization goal"
              value={form.optimizationGoal}
              onChange={(v) => update({ optimizationGoal: v })}
              options={(currentObjective?.optimizationGoals || [form.optimizationGoal || 'CLICK']).map((g) => ({
                value: g,
                label: g,
              }))}
              required
              error={errors.optimizationGoal}
            />
            <SelectField
              label="Budget mode"
              value={form.budgetMode}
              onChange={(v) => update({ budgetMode: v })}
              options={BUDGET_MODES}
            />
            {form.budgetMode !== 'BUDGET_MODE_INFINITE' && (
              <NumberField
                label={`${form.budgetMode === 'BUDGET_MODE_TOTAL' ? 'Lifetime' : 'Daily'} budget (${currency})`}
                value={form.adgroupBudget}
                onChange={(v) => update({ adgroupBudget: v })}
                min={20}
                required
                error={errors.adgroupBudget}
                hint="TikTok requires at least 20 USD/day at the ad-group level."
              />
            )}
            {form.optimizationGoal === 'REACH' && (
              <FieldShell label="Frequency cap (required for Reach)">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">Show at most</span>
                  <input
                    type="number"
                    className="w-20 rounded-full border border-gray-300 bg-gray-100 px-3 py-2 text-sm text-gray-900 outline-none focus:border-gray-400 dark:border-white/5 dark:bg-[#909294]/15 dark:text-white"
                    value={form.frequency}
                    onChange={(e) => update({ frequency: e.target.value })}
                    min={1}
                  />
                  <span className="text-xs text-gray-500">times every</span>
                  <input
                    type="number"
                    className="w-20 rounded-full border border-gray-300 bg-gray-100 px-3 py-2 text-sm text-gray-900 outline-none focus:border-gray-400 dark:border-white/5 dark:bg-[#909294]/15 dark:text-white"
                    value={form.frequencySchedule}
                    onChange={(e) => update({ frequencySchedule: e.target.value })}
                    min={1}
                  />
                  <span className="text-xs text-gray-500">days</span>
                </div>
              </FieldShell>
            )}
            <ScrollableMultiSelectField
              label="Locations"
              values={form.locationIds}
              onChange={(v) => update({ locationIds: v })}
              options={regions.map((r) => ({ value: r.id, label: r.name }))}
              required
              error={errors.locationIds}
              maxHeight="max-h-72"
            />
            <MultiSelectField
              label="Age groups"
              values={form.ageGroups}
              onChange={(v) => update({ ageGroups: v })}
              options={AGE_GROUPS}
            />
            <SelectField
              label="Gender"
              value={form.gender}
              onChange={(v) => update({ gender: v })}
              options={GENDERS}
            />
            <ScrollableMultiSelectField
              label="Interest categories"
              values={form.interestCategoryIds}
              onChange={(v) => update({ interestCategoryIds: v })}
              options={interestCategories.map((c) => ({
                value: String(c.id),
                label: c.name || c.raw?.interest_category_name || String(c.id),
              }))}
              maxHeight="max-h-72"
            />
            <SelectField
              label="Bid type"
              value={form.bidType}
              onChange={(v) => update({ bidType: v })}
              options={BID_TYPES}
            />
            {form.bidType === 'BID_TYPE_CUSTOM' && (
              <NumberField
                label={`Bid price (${currency})`}
                value={form.bidPrice}
                onChange={(v) => update({ bidPrice: v })}
                min={0}
                step={0.01}
                required
                error={errors.bidPrice}
              />
            )}
            <FieldShell label="Schedule end time (optional)" hint="Leave empty to run indefinitely.">
              <input
                type="datetime-local"
                className="w-full rounded-full border border-gray-300 bg-gray-100 px-4 py-2.5 text-sm text-gray-900 outline-none focus:border-gray-400 dark:border-white/5 dark:bg-[#909294]/15 dark:text-white"
                value={form.scheduleEndTime}
                onChange={(e) => update({ scheduleEndTime: e.target.value })}
              />
            </FieldShell>
          </div>
        );

      case 3: // Ad
        return (
          <div className="space-y-4">
            {identities.length === 0 && (
              <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-600 dark:text-amber-400">
                No TikTok identity found. Link a TikTok account to your ad account to create ads. You
                can still create the campaign + ad group without this step.
              </div>
            )}
            <SelectField
              label="Identity (post as)"
              value={form.identityId}
              onChange={(v) => update({ identityId: v })}
              options={[
                { value: '', label: '— none —' },
                ...identities.map((i) => ({ value: i.identityId, label: i.displayName || i.identityId })),
              ]}
            />

            <FieldShell label="Media type">
              <SegGroup
                value={form.mediaType}
                onChange={(v) => update({ mediaType: v })}
                options={[
                  { value: 'video', label: 'Video' },
                  { value: 'image', label: 'Image' },
                ]}
              />
            </FieldShell>

            {form.mediaType === 'video' ? (
              <>
                {form.videoFile || form.videoUrl ? (
                  <FieldShell label="Selected video">
                    <MediaPreview
                      file={form.videoFile}
                      url={form.videoUrl}
                      type="video"
                      onRemove={() => update({ videoFile: null, videoUrl: '' })}
                    />
                    {errors.video && <p className="mt-1 text-xs text-red-500">{errors.video}</p>}
                  </FieldShell>
                ) : (
                  <>
                    <TextField
                      label="Video URL (mp4)"
                      value={form.videoUrl}
                      onChange={(v) => update({ videoUrl: v })}
                      placeholder="https://.../video.mp4"
                    />
                    <FieldShell label="Or upload video file">
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-gray-900 px-4 py-1.5 text-[12px] font-bold text-white transition-all hover:opacity-90 dark:bg-white dark:text-black 2xl:text-sm">
                          Upload video
                          <input
                            type="file"
                            accept="video/mp4,video/quicktime,video/webm"
                            onChange={(e) => update({ videoFile: e.target.files?.[0] || null })}
                            className="hidden"
                          />
                        </label>
                        <span className="text-[11px] text-gray-400 dark:text-white/45">MP4 / MOV / WEBM</span>
                      </div>
                      {errors.video && <p className="mt-1 text-xs text-red-500">{errors.video}</p>}
                    </FieldShell>
                  </>
                )}
              </>
            ) : (
              <>
                {form.imageFile || form.imageUrl ? (
                  <FieldShell label="Selected image">
                    <MediaPreview
                      file={form.imageFile}
                      url={form.imageUrl}
                      type="image"
                      onRemove={() => update({ imageFile: null, imageUrl: '' })}
                    />
                    {errors.image && <p className="mt-1 text-xs text-red-500">{errors.image}</p>}
                  </FieldShell>
                ) : (
                  <>
                    <TextField
                      label="Image URL"
                      value={form.imageUrl}
                      onChange={(v) => update({ imageUrl: v })}
                      placeholder="https://.../image.jpg"
                    />
                    <FieldShell label="Or upload image file">
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-gray-900 px-4 py-1.5 text-[12px] font-bold text-white transition-all hover:opacity-90 dark:bg-white dark:text-black 2xl:text-sm">
                          Upload image
                          <input
                            type="file"
                            accept="image/jpeg,image/png"
                            onChange={(e) => update({ imageFile: e.target.files?.[0] || null })}
                            className="hidden"
                          />
                        </label>
                        <span className="text-[11px] text-gray-400 dark:text-white/45">JPG / PNG</span>
                      </div>
                      {errors.image && <p className="mt-1 text-xs text-red-500">{errors.image}</p>}
                    </FieldShell>
                  </>
                )}
              </>
            )}

            <TextField
              label="Ad text"
              value={form.adText}
              onChange={(v) => update({ adText: v })}
              placeholder="Check out our product!"
            />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <SelectField
                label="Call to action"
                value={form.cta}
                onChange={(v) => update({ cta: v })}
                options={(schema?.ctas || ['LEARN_MORE']).map((c) => ({ value: c, label: c }))}
              />
              <TextField
                label="Landing page URL"
                value={form.landingPageUrl}
                onChange={(v) => update({ landingPageUrl: v })}
                placeholder="https://example.com"
              />
            </div>
          </div>
        );

      case 4: // Review
        {
          const budgetModeLabel =
            BUDGET_MODES.find((m) => m.value === form.budgetMode)?.label || form.budgetMode;
          const bidTypeLabel =
            BID_TYPES.find((b) => b.value === form.bidType)?.label || form.bidType;
          const genderLabel =
            GENDERS.find((g) => g.value === form.gender)?.label || form.gender;
          const ageGroupLabels = form.ageGroups.length
            ? form.ageGroups
                .map((ag) => AGE_GROUPS.find((a) => a.value === ag)?.label || ag)
                .join(', ')
            : 'All';
          const locationNames = form.locationIds.length
            ? form.locationIds
                .map(
                  (id) => regions.find((r) => String(r.id) === String(id))?.name || String(id)
                )
                .join(', ')
            : '—';
          const interestNames = form.interestCategoryIds.length
            ? form.interestCategoryIds
                .map(
                  (id) =>
                    interestCategories.find((c) => String(c.id) === String(id))?.name || String(id)
                )
                .join(', ')
            : 'None';
          const identityName =
            identities.find((i) => String(i.identityId) === String(form.identityId))?.displayName ||
            form.identityId;
          const hasMedia =
            form.videoFile || form.videoUrl || form.imageFile || form.imageUrl;
          const mediaSource = form.videoFile
            ? form.videoFile.name
            : form.imageFile
            ? form.imageFile.name
            : form.videoUrl || form.imageUrl
            ? 'From URL'
            : 'Not selected';

          const issueGroups = STEPS.slice(0, -1)
            .map((label, i) => ({ label, issues: getStepIssues(i, form, selectedObjective) }))
            .filter((g) => g.issues.length > 0);

          return (
            <div className="space-y-4">
              {isCreate && issueGroups.length > 0 && (
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
                  <div className="mb-2 flex items-center gap-2 font-semibold">
                    <AlertCircle className="h-4 w-4" />
                    Fix {issueGroups.length} step{issueGroups.length > 1 ? 's' : ''} before launching
                  </div>
                  <div className="space-y-2">
                    {issueGroups.map((g) => (
                      <div key={g.label}>
                        <p className="font-semibold">{g.label}</p>
                        <ul className="list-disc pl-4 text-amber-700/80 dark:text-amber-400/80">
                          {g.issues.map((issue, idx) => (
                            <li key={idx}>{issue}</li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {isCreate && (
                <div className="space-y-3">
                  <div className="rounded-xl border border-green-500/20 bg-green-500/10 p-3 text-xs text-green-700 dark:text-green-400">
                    Your campaign will be created as <span className="font-bold">ACTIVE</span>. TikTok starts
                    delivering after the ad passes review — you can pause or edit anytime from the Campaigns tab.
                  </div>
                  <p className="text-xs text-gray-500 dark:text-white/55">
                    Reuse this setup for future campaigns — budget, account and name stay editable.
                  </p>
                  <SaveAsTemplateChip form={form} advertiserId={advertiserId} />
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <ReviewSection title="Objective">
                  <ReviewField label="Objective" value={selectedObjective?.label} />
                  <ReviewField label="Conversion location" value={form.objectiveType} />
                  <ReviewField label="Optimization goal" value={form.optimizationGoal} />
                </ReviewSection>

                <ReviewSection title="Campaign">
                  <ReviewField label="Name" value={form.campaignName} />
                  <ReviewField label="Budget mode" value={budgetModeLabel} />
                  <ReviewField label="Budget" value={`${form.budget} ${currency}`} />
                </ReviewSection>

                <ReviewSection title="Ad Group">
                  <ReviewField label="Name" value={form.adgroupName} />
                  <ReviewField label="Locations" value={locationNames} />
                  <ReviewField label="Age groups" value={ageGroupLabels} />
                  <ReviewField label="Gender" value={genderLabel} />
                  <ReviewField label="Interests" value={interestNames} />
                  <ReviewField label="Budget mode" value={budgetModeLabel} />
                  <ReviewField label="Budget" value={`${form.adgroupBudget} ${currency}`} />
                  <ReviewField label="Bid type" value={bidTypeLabel} />
                  {form.bidType === 'BID_TYPE_CUSTOM' && form.bidPrice && (
                    <ReviewField label="Bid price" value={`${form.bidPrice} ${currency}`} />
                  )}
                  {form.scheduleEndTime && (
                    <ReviewField
                      label="Schedule end"
                      value={new Date(form.scheduleEndTime).toLocaleString()}
                    />
                  )}
                  {form.optimizationGoal === 'REACH' && (
                    <ReviewField
                      label="Frequency cap"
                      value={`${form.frequency} time(s) per ${form.frequencySchedule} day(s)`}
                    />
                  )}
                </ReviewSection>

                <ReviewSection title="Ad" wide>
                  {form.identityId && hasMedia ? (
                    <>
                      <ReviewField label="Name" value={form.adName} />
                      <ReviewField label="Identity" value={identityName} />
                      <ReviewField label="Media type" value={form.mediaType} />
                      <ReviewField label="Media" value={mediaSource} />
                      <ReviewField label="Ad text" value={form.adText} />
                      <ReviewField label="CTA" value={form.cta} />
                      <ReviewField label="Landing page URL" value={form.landingPageUrl} />
                    </>
                  ) : (
                    <div className="px-4 py-6 text-center text-sm text-gray-500 dark:text-white/50">
                      Ad skipped — select an identity and media to create an ad.
                    </div>
                  )}
                </ReviewSection>
              </div>

              {error && (
                <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-500">
                  {error}
                </div>
              )}
              {created.campaignId && (
                <div className="mt-3 rounded-lg border border-green-500/30 bg-green-500/10 p-3 text-xs text-green-600 dark:text-green-400">
                  Campaign created (id {created.campaignId}). {created.adgroupId ? 'Ad group created.' : ''}
                </div>
              )}
            </div>
          );
        }

      default:
        return null;
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-100 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 10 }}
          transition={{ duration: 0.18 }}
          onClick={(e) => e.stopPropagation()}
          className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white text-gray-900 shadow-2xl dark:border-white/8 dark:bg-[#161616] dark:text-white"
        >
          {/* header */}
          <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3 dark:border-white/8">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#15DCFF] to-[#6b72f8] text-white">
                <Rocket className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-base font-bold">
                  {isEditCampaign ? 'Edit Campaign' : isEditAdGroup ? 'Edit Ad Group' : isEditAd ? 'Edit Ad' : 'New TikTok Campaign'}
                </h2>
                <p className="text-xs text-gray-500 dark:text-white/40">Posting to {currency} account</p>
              </div>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-white">
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* step rail */}
          {isCreate && (
            <div className="border-b border-gray-100 px-5 py-3 dark:border-white/8">
              <StepRail currentIndex={step} />
            </div>
          )}

          {/* body: form + sidebar */}
          <div className="flex flex-1 overflow-hidden">
            <div className="flex-1 overflow-auto px-5 py-4">
              {schema ? renderStep() : <p className="text-sm text-gray-400">Loading…</p>}
            </div>
            {isCreate && (
              <CampaignSetupSidebar
                currentStep={step}
                form={form}
                selectedObjective={selectedObjective}
                onStepClick={setStep}
              />
            )}
          </div>

          {/* footer */}
          <div className="flex items-center justify-between border-t border-gray-100 px-5 py-3 dark:border-white/8">
            {isCreate ? (
              <button
                onClick={() => setStep((s) => Math.max(0, s - 1))}
                disabled={step === 0 || launching}
                className="flex items-center gap-1 rounded-full border border-gray-300 px-4 py-2 text-sm font-medium disabled:opacity-40 dark:border-gray-600"
              >
                <ChevronLeft className="h-4 w-4" /> Back
              </button>
            ) : (
              <div />
            )}
            {isCreate ? (
              step < STEPS.length - 1 ? (
                <button
                  onClick={handleNext}
                  className="flex items-center gap-1 rounded-full bg-gradient-to-r from-[#15DCFF] to-[#6b72f8] px-5 py-2 text-sm font-semibold text-white"
                >
                  Continue <ChevronRight className="h-4 w-4" />
                </button>
              ) : (
                <button
                  onClick={handleLaunch}
                  disabled={launching || !canLaunch()}
                  className="flex items-center gap-1.5 rounded-full bg-gradient-to-r from-[#15DCFF] to-[#6b72f8] px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {launching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
                  {launching ? 'Creating…' : 'Create Campaign'}
                </button>
              )
            ) : (
              <button
                onClick={handleSave}
                disabled={launching || !canNext()}
                className="flex items-center gap-1.5 rounded-full bg-gradient-to-r from-[#15DCFF] to-[#6b72f8] px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {launching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
                {launching ? 'Saving…' : 'Save Changes'}
              </button>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default CreateCampaignWizard;
