import React, { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  ExternalLink,
  Coins,
  Loader2,
  Inbox,
  AlertCircle,
  Check,
  Lock,
} from 'lucide-react';
import { FaFacebookF } from 'react-icons/fa6';
import { FcGoogle } from 'react-icons/fc';
import InputCommonDropdown from '@/components/AdFactory/NodeForms/InputCommonDropdown';
import { globalToast } from '@/utils/globalToast';
import {
  fetchMetaAdsTemplates,
  fetchMetaAdsTemplateById,
  fetchGoogleAdsTemplates,
  fetchGoogleAdsTemplateById,
  fetchCtaOptions,
  fetchGoogleCtaOptions,
} from '@/store/actions/adFactoryAutomation/adFactoryAutomationActions';
import {
  selectMetaAdsTemplates,
  selectMetaAdsTemplatesLoading,
  selectMetaAdsTemplatesError,
  selectMetaAdsTemplateById,
  selectGoogleAdsTemplates,
  selectGoogleAdsTemplatesLoading,
  selectGoogleAdsTemplatesError,
  selectGoogleAdsTemplateById,
  selectCtaOptionsForObjective,
  selectCtaOptionsLoading,
  selectGoogleCtaOptionsForObjective,
  selectGoogleCtaOptionsLoading,
} from '@/store/reducers/adFactoryAutomation/adFactoryAutomationSlice';
import CallToActionSection from './CallToActionSection';

// ----------------------------------------------------------------------------
// TemplatePicker — "Where to post" per-platform toggle card.
//
// Each connected platform is rendered as a card with an on/off Switch in the
// header. When ON, the card reveals a template dropdown + optional overrides
// for that platform. When ON but the user has no saved templates, it shows
// an amber redirect prompt that deep-links to the Ads wizard.
//
// A platform publishes ONLY when ALL of these are true:
//   - the user toggled it ON (`value.enabled !== false`)
//   - the user picked a template (`value.id` set)
//   - the platform is connected (gated externally via `disabled` prop)
//
// Toggling OFF collapses the body, hides the picker, and clears the
// platform from the "Posting to" summary in the parent section. The picked
// template id stays in form state so re-toggling ON restores it instantly,
// but the payload builder still skips the platform unless enabled is true.
//
// `value` shape (per platform):
//   {
//     id: string|null,
//     dailyBudgetOverride: number|null,
//     campaignName: string|null,
//     objective: string|null,
//     callToAction: { button: string|null, url: string },
//     enabled: boolean (default true),
//   }
// ----------------------------------------------------------------------------

const PLATFORM_CONFIG = {
  meta: {
    displayName: 'Meta',
    channels: 'Facebook & Instagram',
    selectLabel: 'Select a Meta template',
    emptyTitle: 'No saved Meta templates yet.',
    emptyHint: 'Build one in Meta Ads Manager, then come back to schedule it.',
    deepLinkHref: '/meta-ads?openWizard=create-full',
    deepLinkLabel: 'Create a Meta template',
    fetchListThunk: fetchMetaAdsTemplates,
    fetchByIdThunk: fetchMetaAdsTemplateById,
    selectList: selectMetaAdsTemplates,
    selectListLoading: selectMetaAdsTemplatesLoading,
    selectListError: selectMetaAdsTemplatesError,
    selectById: selectMetaAdsTemplateById,
    // Meta budget ships to backend in whole currency, no conversion.
    budgetUnitsToBackend: (n) => n,
    budgetBackendToUnits: (n) => n,
    // CTA options come from the Meta autopilot endpoint.
    fetchCtaOptionsThunk: fetchCtaOptions,
    selectCtaOptions: selectCtaOptionsForObjective,
    selectCtaOptionsLoading: selectCtaOptionsLoading,
  },
  google: {
    displayName: 'Google',
    channels: 'Search, Display & PMax',
    selectLabel: 'Select a Google template',
    emptyTitle: 'No saved Google templates yet.',
    emptyHint: 'Build one in Google Ads Manager, then come back to schedule it.',
    deepLinkHref: '/google-ads?openWizard=create-full',
    deepLinkLabel: 'Create a Google template',
    fetchListThunk: fetchGoogleAdsTemplates,
    fetchByIdThunk: fetchGoogleAdsTemplateById,
    selectList: selectGoogleAdsTemplates,
    selectListLoading: selectGoogleAdsTemplatesLoading,
    selectListError: selectGoogleAdsTemplatesError,
    selectById: selectGoogleAdsTemplateById,
    // Google budget is `dailyBudgetMicros` (1_000_000 = ₹1). User enters
    // whole currency; we multiply on the way out, divide on the way back in.
    budgetUnitsToBackend: (n) => Number(n) * 1_000_000,
    budgetBackendToUnits: (n) => Number(n) / 1_000_000,
    // CTA options come from the Google Ads endpoint.
    fetchCtaOptionsThunk: fetchGoogleCtaOptions,
    selectCtaOptions: selectGoogleCtaOptionsForObjective,
    selectCtaOptionsLoading: selectGoogleCtaOptionsLoading,
  },
};

// Validation bounds — same for both platforms.
const CAMPAIGN_NAME_MIN = 2;
const CAMPAIGN_NAME_MAX = 120;
const BUDGET_MIN = 100;
const BUDGET_MAX = 1_000_000;
const DIGITS_RE = /^\d+$/;

// `locked` = this platform already has a saved template on an existing job, so
// the backend forbids swapping the template, renaming the campaign, or removing
// the platform (see adsFactoryAutoController.updateJob field-diff). Only budget
// and CTA remain editable — those are the backend's EDITABLE_*_PAYLOAD_FIELDS.
export default function TemplatePicker({
  value,
  onChange,
  disabled,
  platform = 'meta',
  enabled = true,
  onToggleEnabled,
  locked = false,
}) {
  const cfg = PLATFORM_CONFIG[platform] || PLATFORM_CONFIG.meta;
  const dispatch = useDispatch();
  const templates = useSelector(cfg.selectList);
  const loadingList = useSelector(cfg.selectListLoading);
  const listError = useSelector(cfg.selectListError);

  const picked = value || {};
  const pickedBucket = useSelector((state) => cfg.selectById(state, picked.id));
  const pickedTemplate = pickedBucket?.template;
  const pickedLoading = pickedBucket?.loading;

  // Live CTA options for the picked template's objective. Each platform hits
  // its own endpoint (Meta vs Google), so the options are platform-specific.
  const ctaObjective = pickedTemplate?.objective || null;
  const ctaCache = useSelector((state) => cfg.selectCtaOptions(state, ctaObjective));
  const ctaOptionsLoading = useSelector(cfg.selectCtaOptionsLoading);
  const ctaOptions = ctaCache?.status === 'ok' ? ctaCache.options : null;
  const ctaUnsupported = ctaCache?.status === 'unsupported';

  useEffect(() => {
    dispatch(cfg.fetchListThunk());
  }, [dispatch, cfg.fetchListThunk]);

  // Re-fetch on tab focus so a template the user just created in the wizard
  // (which opens in a new tab) shows up without forcing a manual refresh.
  useEffect(() => {
    const onFocus = () => dispatch(cfg.fetchListThunk());
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [dispatch, cfg.fetchListThunk]);

  // When the user picks an id, fetch the full template if we don't have it
  // cached. Mirror the resolved objective onto `value` so the CTA section
  // upstream can react without a second slice round-trip.
  useEffect(() => {
    if (!picked.id) return;
    dispatch(cfg.fetchByIdThunk(picked.id));
  }, [picked.id, dispatch, cfg.fetchByIdThunk]);

  useEffect(() => {
    if (!pickedTemplate) return;
    if (picked.objective !== pickedTemplate.objective) {
      onChange?.({ ...picked, objective: pickedTemplate.objective || null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickedTemplate?.id]);

  // Fallback for jobs saved before we started storing the template id inside
  // the payload. If the API response has template data (name/objective/
  // conversionLocation) but no id, try to find a matching saved template in
  // the list and pre-select it. Prefer exact name + objective + conversionLocation.
  useEffect(() => {
    if (picked.id) return;
    if (!templates?.length) return;
    if (!picked.name && !picked.objective) return;
    const match = templates.find((t) => {
      const normalizedApiName = String(picked.name || '').trim().toLowerCase();
      const normalizedListName = String(t.name || '').trim().toLowerCase();
      const apiObjective = String(picked.objective || '').toUpperCase();
      const listObjective = String(t.objective || '').toUpperCase();
      const apiLocation = String(picked.conversionLocation || '').toUpperCase();
      const listLocation = String(t.conversionLocation || '').toUpperCase();
      return (
        normalizedApiName === normalizedListName &&
        apiObjective === listObjective &&
        apiLocation === listLocation
      );
    });
    if (match) {
      onChange?.({
        ...picked,
        id: match.id,
        objective: match.objective || picked.objective || null,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templates, picked.name, picked.objective, picked.conversionLocation]);

  // Fetch platform-specific CTA options whenever the resolved objective changes.
  useEffect(() => {
    if (ctaObjective) {
      dispatch(cfg.fetchCtaOptionsThunk(ctaObjective));
    }
  }, [ctaObjective, dispatch, cfg.fetchCtaOptionsThunk]);

  // When the template (hence objective) changes, clear the chosen CTA button
  // so the user picks one that is valid for the new objective. Keep the URL
  // because the landing page usually stays the same.
  useEffect(() => {
    if (!picked.id || !pickedTemplate) return;
    const currentButton = picked.callToAction?.button;
    const currentUrl = picked.callToAction?.url ?? '';
    const validOptions = Array.isArray(ctaOptions) ? ctaOptions : [];
    const stillValid = validOptions.some((o) => o.value === currentButton);
    if (currentButton && !stillValid) {
      onChange?.({
        ...picked,
        callToAction: { button: null, url: currentUrl },
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctaObjective, ctaOptions]);

  const templateOptions = (templates || []).map((t) => ({
    value: t.id,
    label: t.name,
  }));
  const noTemplates = !loadingList && templateOptions.length === 0;

  const handlePick = (id) => {
    // Picking a new template clears all overrides + objective. enabled stays
    // — the toggle is independent of which template is picked. Preserve the
    // URL because the landing page usually doesn't change; the button will be
    // cleared once the new template's objective resolves.
    onChange?.({
      id: id || null,
      dailyBudgetOverride: null,
      campaignName: null,
      objective: null,
      callToAction: { button: null, url: picked.callToAction?.url || '' },
      enabled,
    });
  };

  // Block paste-newlines + cap at MAX so it can't escape the field.
  const handleCampaignNameChange = (raw) => {
    onChange?.({ ...picked, campaignName: raw.replace(/[\r\n]+/g, ' ') });
  };

  const handleCallToActionChange = (callToAction) => {
    onChange?.({ ...picked, callToAction });
  };

  // Digit-only state. Browser-level type=number lets `-`, `+`, `.`, `e`
  // through, so we keep type=text + numeric inputMode + a hard regex filter.
  const handleBudgetChange = (raw) => {
    if (raw === '') {
      onChange?.({ ...picked, dailyBudgetOverride: null });
      return;
    }
    if (!DIGITS_RE.test(raw)) return;
    const n = Number(raw);
    if (Number.isNaN(n)) return;
    onChange?.({ ...picked, dailyBudgetOverride: n });
  };

  const budgetOverride = picked.dailyBudgetOverride;
  const budgetError =
    budgetOverride == null
      ? null
      : budgetOverride < BUDGET_MIN
        ? `Minimum daily budget is ${BUDGET_MIN.toLocaleString()}.`
        : budgetOverride > BUDGET_MAX
          ? `Maximum daily budget is ${BUDGET_MAX.toLocaleString()} (10 lakhs).`
          : null;

  const trimmedName = (picked.campaignName ?? '').trim();
  const campaignNameError =
    trimmedName.length === 0
      ? null
      : trimmedName.length < CAMPAIGN_NAME_MIN
        ? `Campaign name must be at least ${CAMPAIGN_NAME_MIN} characters.`
        : trimmedName.length > CAMPAIGN_NAME_MAX
          ? `Campaign name must be ${CAMPAIGN_NAME_MAX} characters or fewer.`
          : null;

  const templatePayload = pickedTemplate?.payload || {};
  // Google stores budget as dailyBudgetMicros; the form holds whole currency
  // for both platforms, so we divide back here for the "Template default" hint.
  const rawTemplateBudget =
    platform === 'google'
      ? templatePayload.dailyBudgetMicros
      : templatePayload.dailyBudget;
  const templateDailyBudget =
    rawTemplateBudget != null ? cfg.budgetBackendToUnits(rawTemplateBudget) : null;
  const templateCampaignName = templatePayload.campaignName || templatePayload.name || '';

  // Active = toggled on AND template picked. Used for the green border + the
  // "Publishing" tag. The card itself stays rendered when OFF (so the user
  // can see the toggle); only the body collapses.
  const isActive = enabled && !!picked.id;
  const showPickerBody = enabled && !noTemplates;
  const showEmptyState = enabled && noTemplates;

  return (
    <section
      className={`flex flex-col gap-3 rounded-2xl border p-4 transition-colors ${
        isActive
          ? 'border-emerald-400/35 bg-emerald-400/6'
          : 'border-white/10 bg-white/2'
      } ${disabled ? 'pointer-events-none opacity-50' : ''}`}
    >
      {/* Header — icon tile + name + sublabel + Publishing tag + Switch.
          Always visible so the user can flip the toggle even when OFF. */}
      <div className="flex items-center gap-3">
        <PlatformGlyph platform={platform} />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm font-semibold text-white">{cfg.displayName}</span>
          <span className="text-[11.5px] text-[#8a8a90]">{cfg.channels}</span>
        </div>

        {loadingList && <Loader2 className="size-3.5 animate-spin text-[#AFAFAF]" />}

        {isActive && (
          <span className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-emerald-400">
            <Check className="size-3.5" strokeWidth={2.5} />
            Publishing
          </span>
        )}

        <Switch
          enabled={enabled}
          disabled={disabled || locked}
          onToggle={() => onToggleEnabled?.(!enabled)}
          label={`Publish to ${cfg.displayName}`}
        />
      </div>

      {/* Body — visible only when toggle is ON AND saved templates exist. */}
      {showPickerBody && (
        <div className="flex flex-col gap-3">
          {locked && (
            <div className="flex items-start gap-2.5 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5">
              <Lock className="mt-px size-3.5 shrink-0 text-[#AFAFAF]" />
              <p className="text-[12px] leading-relaxed text-[#b0b0b6]">
                Template and campaign name are locked while this automation
                exists — you can still update budget and call-to-action. To
                change them, create a new automation.
              </p>
            </div>
          )}
          <Field
            label="Ad template"
            empty={
              listError ||
              (pickedTemplate?.objective ? humanizeObjective(pickedTemplate.objective) : null)
            }
          >
            <InputCommonDropdown
              label={cfg.selectLabel}
              options={templateOptions}
              value={picked.id || ''}
              onChange={handlePick}
              disabled={disabled || loadingList || locked}
            />
          </Field>

          {picked.id && (
            <div className="grid grid-cols-1 gap-x-3 gap-y-2 sm:grid-cols-2 sm:items-start">
              <Field
                label={
                  <>
                    Daily budget <span className="text-[#6a6a70]">· optional</span>
                  </>
                }
                empty={
                  pickedLoading
                    ? 'Loading template…'
                    : templateDailyBudget != null
                      ? `Template default: ${formatBudget(templateDailyBudget)}`
                      : null
                }
              >
                <div className="relative">
                  <Coins className="absolute top-1/2 left-4 size-4 -translate-y-1/2 text-[#AFAFAF]" />
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={7}
                    placeholder={
                      templateDailyBudget != null ? String(templateDailyBudget) : 'Template default'
                    }
                    value={
                      picked.dailyBudgetOverride != null
                        ? String(picked.dailyBudgetOverride)
                        : ''
                    }
                    onKeyDown={(e) => {
                      if (
                        e.key === 'Backspace' ||
                        e.key === 'Delete' ||
                        e.key === 'Tab' ||
                        e.key === 'ArrowLeft' ||
                        e.key === 'ArrowRight' ||
                        e.key === 'Home' ||
                        e.key === 'End' ||
                        e.ctrlKey ||
                        e.metaKey
                      )
                        return;
                      if (!/^\d$/.test(e.key)) e.preventDefault();
                    }}
                    onChange={(e) => handleBudgetChange(e.target.value)}
                    disabled={disabled || pickedLoading}
                    className={`h-10 w-full rounded-full bg-[#383838]/50 pr-5 pl-11 text-sm text-white outline-none transition placeholder:text-[#AFAFAF] focus:bg-[#383838]/70 disabled:cursor-not-allowed disabled:opacity-50 ${
                      budgetError ? 'ring-1 ring-red-500/60' : ''
                    }`}
                  />
                </div>
                {budgetError && (
                  <div className="flex items-center gap-1.5 text-[11px] text-red-400">
                    <AlertCircle className="size-3" />
                    {budgetError}
                  </div>
                )}
              </Field>

              <Field
                label={
                  <>
                    Campaign name <span className="text-[#6a6a70]">· optional</span>
                  </>
                }
                empty={
                  pickedLoading
                    ? 'Loading template…'
                    : templateCampaignName
                      ? `Template default: ${templateCampaignName}`
                      : null
                }
              >
                <input
                  type="text"
                  maxLength={CAMPAIGN_NAME_MAX}
                  placeholder={templateCampaignName || 'Template default'}
                  value={picked.campaignName ?? ''}
                  onChange={(e) => handleCampaignNameChange(e.target.value)}
                  disabled={disabled || pickedLoading || locked}
                  className={`h-10 w-full rounded-full bg-[#383838]/50 px-4 text-sm text-white outline-none transition placeholder:text-[#AFAFAF] focus:bg-[#383838]/70 disabled:cursor-not-allowed disabled:opacity-50 ${
                    campaignNameError ? 'ring-1 ring-red-500/60' : ''
                  }`}
                />
                {campaignNameError && (
                  <div className="flex items-center gap-1.5 text-[11px] text-red-400">
                    <AlertCircle className="size-3" />
                    {campaignNameError}
                  </div>
                )}
              </Field>
            </div>
          )}

          {picked.id && pickedTemplate && (
            <CallToActionSection
              value={picked.callToAction || { button: null, url: '' }}
              onChange={handleCallToActionChange}
              options={ctaOptions}
              loading={ctaOptionsLoading && !ctaCache}
              disabled={disabled || pickedLoading}
              locked={ctaUnsupported}
              onLockedInteraction={() => {
                if (ctaUnsupported) {
                  // Generic toast — the exact objective is visible in the card
                  // sublabel right above the CTA section.
                  globalToast.error(
                    "This campaign objective doesn't support a Call-to-Action button",
                  );
                }
              }}
            />
          )}
        </div>
      )}

      {/* No saved templates + toggle ON → deep-link to the wizard. */}
      {showEmptyState && <EmptyState cfg={cfg} />}
    </section>
  );
}

// ----------------------------------------------------------------------------
// Switch — on/off toggle. 42×24 track, 18px knob. WAI-ARIA role="switch".
// ----------------------------------------------------------------------------
function Switch({ enabled, onToggle, disabled, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={label}
      disabled={disabled}
      onClick={onToggle}
      className={`relative h-6 w-10.5 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed ${
        enabled ? 'bg-emerald-400' : 'bg-white/20'
      }`}
    >
      <span
        className={`absolute top-0.75 size-4.5 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.3)] transition-all ${
          enabled ? 'left-5.25' : 'left-0.75'
        }`}
      />
    </button>
  );
}

// ----------------------------------------------------------------------------
// PlatformGlyph — brand icon tile, 32×32 rounded square. Uses the same
// icons (FaFacebookF + FcGoogle) as the existing connection pills.
// ----------------------------------------------------------------------------
function PlatformGlyph({ platform }) {
  if (platform === 'google') {
    return (
      <span className="flex size-8 shrink-0 items-center justify-center rounded-[9px] bg-white">
        <FcGoogle className="size-5" />
      </span>
    );
  }
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-[9px] bg-[#1877F2]">
      <FaFacebookF className="size-4 text-white" />
    </span>
  );
}

// ----------------------------------------------------------------------------
// EmptyState — shown when the platform is ON but has no saved templates.
// Deep-links to the wizard in a new tab so the user doesn't lose the
// half-filled schedule they're configuring here.
// ----------------------------------------------------------------------------
function EmptyState({ cfg }) {
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/22 bg-amber-500/6 p-3">
      <Inbox className="mt-0.5 size-4 shrink-0 text-amber-400" />
      <div className="flex flex-col gap-2 text-xs">
        <p className="leading-relaxed text-amber-200/90">
          {cfg.emptyTitle} {cfg.emptyHint}
        </p>
        <a
          href={cfg.deepLinkHref}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-amber-400/40 bg-amber-400/15 px-3 py-1.5 text-xs font-semibold text-amber-100 hover:bg-amber-400/25"
        >
          {cfg.deepLinkLabel}
          <ExternalLink className="size-3" />
        </a>
      </div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span>{label}</span>
      <span className="truncate text-[#E3E3E3]">{value}</span>
    </div>
  );
}

function Field({ label, children, empty }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[11.5px] font-medium text-[#8a8a90]">{label}</label>
      {children}
      {empty && <span className="text-[11px] text-[#AFAFAF] italic">{empty}</span>}
    </div>
  );
}

function formatBudget(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return Number(n).toLocaleString();
}

function humanizeObjective(o) {
  if (!o) return '';
  return o
    .replace(/^OUTCOME_/, '')
    .toLowerCase()
    .replace(/\b\w/g, (m) => m.toUpperCase());
}
