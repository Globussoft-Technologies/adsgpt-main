import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'react-toastify';

import {
  fetchAutomation,
  saveAutomation,
  updateAutomation,
  fetchAutomationSummary,
  testAutomationEmail,
} from '@/store/actions/adFactoryAutomation/adFactoryAutomationActions';
import {
  selectAutomationEntry,
  selectAutomationSaving,
  selectAutomationSummary,
} from '@/store/reducers/adFactoryAutomation/adFactoryAutomationSlice';
import { AUTOMATION_STATUS } from '@/store/reducers/adFactoryAutomation/constants';
import {
  checkFbUser,
  checkGoogleUser,
} from '@/store/actions/adFactoryNew/adFactoryActions';
import { useImageCreditsForModel } from '@/utils/hooks/useImageCreditsForModel';
import { IS_GOOGLE_AUTOMATION_ENABLED } from '@/utils/featureFlags';

import FrequencySection from './FrequencySection';
import { getBrowserTimezone } from './TimezoneSelect';
import PairsPerCycleSection from './PairsPerCycleSection';
import { MODEL_OPTIONS } from './imageModels';
import { isValidCtaUrl } from './CallToActionSection';
import TemplatePicker from './TemplatePicker';
import SummarySection from './SummarySection';
import AlertEmailsSection, { validateEmailList } from './AlertEmailsSection';
import MetaStatusPill from './MetaStatusPill';
import GoogleStatusPill from './GoogleStatusPill';
import { Info } from 'lucide-react';
import { FaFacebookF } from 'react-icons/fa6';
import { FcGoogle } from 'react-icons/fc';

// ----------------------------------------------------------------------------
// AutomationForm — INLINE form rendered inside ServicesForm when the user
// flips to Run on Schedule. Owns its own state, validation, and the Activate
// footer action. The parent only needs to mount it.
//
// `onActivated` fires after a successful save so the parent can close the
// Services modal. It's optional — the form is fully usable without it.
//
// Sections rendered in order:
//   1. Meta connection banner
//   2. Frequency
//   3. Pairs per cycle
//   4. Target picker (Where to post) — each platform card now contains its own
//      Call-to-Action section, so there is no shared CTA below the cards.
//   5. Live cycle / credit summary
// ----------------------------------------------------------------------------

// Today's date as YYYY-MM-DD in the given IANA timezone. Falls back to the
// browser's local zone when omitted. Avoids the toISOString() trap where
// local midnight in any UTC+N zone rolls back to the previous day's UTC.
const todayISO = (timezone) => {
  const now = new Date();
  try {
    const parts = new Intl.DateTimeFormat('en', {
      timeZone: timezone || undefined,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);
    const yyyy = parts.find((p) => p.type === 'year').value;
    const mm = parts.find((p) => p.type === 'month').value;
    const dd = parts.find((p) => p.type === 'day').value;
    return `${yyyy}-${mm}-${dd}`;
  } catch {
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
};

// Current hour (0–23) in the given IANA timezone. Same helper used by
// FrequencySection — duplicated here to keep AutomationForm self-contained
// for its validation check. Falls back to local zone on Intl errors.
const currentHourLocal = (timezone) => {
  try {
    const parts = new Intl.DateTimeFormat('en', {
      timeZone: timezone || undefined,
      hour: 'numeric',
      hour12: false,
    }).formatToParts(new Date());
    const h = Number(parts.find((p) => p.type === 'hour')?.value);
    if (!Number.isInteger(h)) return 0;
    return h % 24;
  } catch {
    return new Date().getHours();
  }
};

const defaultFormValues = () => {
  const timezone = getBrowserTimezone();
  return {
    frequency: {
      preset: 'daily',
      startDate: todayISO(timezone),
      endDate: null,
      // 0–23. Default midnight matches the backend's default behaviour.
      hour: 0,
      timezone,
      custom: { interval: 1, unit: 'week', daysOfWeek: [] },
    },
    pairsPerCycle: 1,
    // Image model provider — same enum + default as ServicesForm so the
    // backend can reuse the existing image-generation worker contract.
    imageModelProvider: 'google',
    // Meta Ads V2 template the autopilot job will attach to. id = picked,
    // dailyBudgetOverride / campaignName / callToAction = inline edits,
    // objective = mirrored from the resolved template.
    template: {
      id: null,
      dailyBudgetOverride: null,
      campaignName: null,
      objective: null,
      callToAction: { button: null, url: '' },
      // `enabled` drives the per-platform toggle in TemplatePicker. Defaults
      // to true so both platforms light up on form open (matching today's
      // behaviour where both pickers were always visible). The user flips it
      // off to skip that platform for this activation.
      enabled: true,
    },
    // Google Ads template — same shape as Meta, lives alongside it so a
    // single job can target both platforms simultaneously
    // (targets.meta + targets.google). Only populated when Google is one of
    // the selected platforms; otherwise the payload builder skips it.
    googleTemplate: {
      id: null,
      dailyBudgetOverride: null,
      campaignName: null,
      objective: null,
      callToAction: { button: null, url: '' },
      enabled: true,
    },
    // Cycle-complete alert emails. `emailTo` is a comma-separated list (up to
    // 5) sent as-is to the backend (targets.job.alerts.emailTo). Empty = no
    // alert emails. Optional — never blocks activation.
    alerts: {
      emailTo: '',
    },
  };
};

// Deep-merge a persisted config over the defaults. Top-level scalars and
// `imageModelProvider` are taken from source; the nested `frequency`,
// `callToAction`, and platform template objects are merged field-by-field so
// partial saves don't blow away unspecified defaults.
function mergeConfig(target, source) {
  if (!source) return target;
  const mergeCta = (base, override) => ({
    button: override?.button ?? base.button,
    url: override?.url ?? base.url,
  });
  const mergeTemplate = (base, override) => ({
    ...base,
    ...override,
    callToAction: mergeCta(base.callToAction, override?.callToAction),
  });
  return {
    ...target,
    ...source,
    frequency: { ...target.frequency, ...(source.frequency || {}) },
    // Legacy top-level callToAction is migrated into platform CTAs below.
    template: mergeTemplate(target.template, source.template || {}),
    googleTemplate: mergeTemplate(target.googleTemplate, source.googleTemplate || {}),
    alerts: { ...target.alerts, ...(source.alerts || {}) },
  };
}

const REOPEN_AFTER_FB_KEY = 'adsgpt:reopen-automation-for';

// Backward compatibility: older saved configs stored a single shared CTA at
// the top level. When a platform's own callToAction is missing, seed it from
// that legacy value so the user doesn't lose their button + URL on edit.
function migrateLegacyCallToAction(config) {
  const legacy = config?.callToAction;
  if (!legacy || (legacy.button == null && !legacy.url)) return config;

  const patchPlatform = (platformCta) => {
    if (!platformCta) return legacy;
    const hasButton = platformCta.button != null;
    const hasUrl = typeof platformCta.url === 'string' && platformCta.url.length > 0;
    if (hasButton || hasUrl) return platformCta;
    return legacy;
  };

  return {
    ...config,
    template: {
      ...config.template,
      callToAction: patchPlatform(config.template?.callToAction),
    },
    googleTemplate: {
      ...config.googleTemplate,
      callToAction: patchPlatform(config.googleTemplate?.callToAction),
    },
  };
}

export default function AutomationForm({ onActivated, onActionsChange }) {
  const dispatch = useDispatch();
  const [searchParams] = useSearchParams();
  const campaignId = searchParams.get('campaignId');

  const { fbUser, googleUser, distribution } = useSelector((state) => state.adFactoryNew);
  const { userData, credits } = useSelector((state) => state.socket);
  const saving = useSelector(selectAutomationSaving);
  const entry = useSelector((state) => selectAutomationEntry(state, campaignId));

  const isMetaConnected = !!fbUser?.facebookId;
  const isGoogleConnected =
    !!(googleUser?.email || googleUser?.googleId || googleUser?.sub);

  // Which providers does this campaign target? Drives which template pickers
  // render, which status pills show, and which connection gates the activate
  // button. Reads from distribution.platforms — the same source that gates
  // the parent ServicesForm's "Run on Schedule" tab.
  const hasMetaSelected = React.useMemo(
    () =>
      Array.isArray(distribution?.platforms) &&
      distribution.platforms.some(
        (p) => String(p?.platformName || '').toLowerCase() === 'meta',
      ),
    [distribution?.platforms],
  );
  const googleSelectedInDistribution = React.useMemo(
    () =>
      Array.isArray(distribution?.platforms) &&
      distribution.platforms.some(
        (p) => String(p?.platformName || '').toLowerCase() === 'google',
      ),
    [distribution?.platforms],
  );
  // Env gate for Google automation. When VITE_FEATURE_GOOGLE_AUTOMATION is off
  // we force "not selected", which single-handedly collapses every Google
  // branch in this form: the GoogleStatusPill, the Google TemplatePicker, the
  // checkGoogleUser poll, googleReady, and all Google validation/CTA/budget
  // checks. The useMemo above stays unconditional to respect the rules of hooks.
  const hasGoogleSelected = IS_GOOGLE_AUTOMATION_ENABLED && googleSelectedInDistribution;

  // Connection gating — split into two distinct concepts so the form can be
  // useful before the user has finished connecting both providers.
  //
  //   anyPlatformConnected → at least one SELECTED platform is OAuth'd in.
  //     Drives the shared sections (Schedule / Pairs / CTA / Summary). The
  //     idea: if you're connected to even one provider, you should be able
  //     to fill out the form details. The picker for the un-connected
  //     provider stays individually locked (see TemplatePicker disabled
  //     props in the JSX below).
  //
  // Per-platform `isXxxConnected` flags still gate that platform's own
  // TemplatePicker. So the user can browse the templates of providers they
  // actually have access to, while the schedule/CTA stays editable.
  const anyPlatformConnected =
    (hasMetaSelected && isMetaConnected) ||
    (hasGoogleSelected && isGoogleConnected);

  // Synchronous hydration on first render — if the slice already has the
  // saved entry (typically true because AdFactoryWorkflow's mount effect
  // already dispatched fetchAutomation), the form initialises with the real
  // values instead of flashing defaults. mergeConfig deep-merges nested
  // objects so partial saves don't clobber unspecified fields.
  const entryHydrated = useRef(false);
  const [values, setValues] = useState(() => {
    const initial = defaultFormValues();
    if (entry?.config?.frequency) {
      entryHydrated.current = true;
      return migrateLegacyCallToAction(mergeConfig(initial, entry.config));
    }
    return initial;
  });

  // Re-fetch in case anything changed since the slice was first hydrated.
  useEffect(() => {
    if (!campaignId) return;
    dispatch(fetchAutomation(campaignId));
  }, [campaignId, dispatch]);

  // Fallback hydration for the case where the entry arrives AFTER mount
  // (slice was empty when useState's initializer ran).
  useEffect(() => {
    if (entryHydrated.current) return;
    if (entry?.config?.frequency) {
      setValues((prev) => migrateLegacyCallToAction(mergeConfig(prev, entry.config)));
      entryHydrated.current = true;
    }
  }, [entry]);

  // Re-poll Meta connection state when the form mounts (the user may have
  // OAuth'd in another tab).
  useEffect(() => {
    if (userData?.user_id) {
      dispatch(checkFbUser(userData.user_id));
    }
  }, [dispatch, userData?.user_id]);

  // Mirror for Google. Only kicks when Google is one of the platforms — no
  // sense pinging the Google /users endpoint for a Meta-only campaign.
  useEffect(() => {
    if (!hasGoogleSelected) return;
    if (userData?.user_id) {
      dispatch(checkGoogleUser(userData.user_id));
    }
  }, [dispatch, userData?.user_id, hasGoogleSelected]);

  // Resolve the credit cost for the currently picked image model. The form
  // stores the backend's provider key (e.g. 'google'); the shared hook
  // wants the API's display label (e.g. 'Nano Banana Pro'), so we map
  // value → label via MODEL_OPTIONS first. The hook handles the fetch +
  // cache + fallback internally.
  const selectedModelLabel = useMemo(
    () =>
      MODEL_OPTIONS.find((m) => m.value === values.imageModelProvider)?.label,
    [values.imageModelProvider]
  );
  const creditsPerImage = useImageCreditsForModel(selectedModelLabel);

  // Per-platform CTA validators. Each platform is validated independently and
  // only when it is actually ready to post, because the CTA section lives
  // inside each platform card and an unready platform is skipped by the payload
  // builder.
  const validatePlatformCta = (cta, label) => {
    const errs = [];
    // The dropdown only emits valid platform-specific enum values, so we only
    // need to confirm the user actually picked one. Requiring a hardcoded list
    // here breaks Google CTAs like BOOK_NOW that aren't in Meta's fallback set.
    if (!cta?.button) {
      errs.push(`${label} CTA button is required`);
    }
    if (!isValidCtaUrl(cta?.url || '')) {
      errs.push(`${label} destination URL is required`);
    }
    return errs;
  };

  // After an OAuth redirect, AdFactoryPage sets this flag so we know to
  // reopen the Services modal in Schedule mode. The flag is consumed in
  // ServicesForm — here we just clean it up once the form has mounted.
  useEffect(() => {
    if (sessionStorage.getItem(REOPEN_AFTER_FB_KEY) === campaignId) {
      sessionStorage.removeItem(REOPEN_AFTER_FB_KEY);
    }
  }, [campaignId]);

  const updateValues = (patch) => setValues((prev) => ({ ...prev, ...patch }));

  // Target readiness: each platform card carries its own CTA section that
  // overrides the template's callToAction + linkUrl/finalUrl, so a platform
  // still requires a template to be picked first. With Google support, the
  // gate is "at least ONE platform is fully ready" — connected AND template
  // picked. Activation submits with only the ready platform's targets
  // populated; the other selected-but-not-ready platform is skipped this
  // round (user can edit later to add it).
  const metaTemplatePicked = !!values?.template?.id;
  const googleTemplatePicked = !!values?.googleTemplate?.id;
  // `enabled` is the toggle inside each TemplatePicker. Defaults to true on
  // open; user flips it off to skip that platform without un-picking the
  // template. A platform that's off is excluded from "ready" so the
  // payload builder skips it AND the "Posting to" pill hides it.
  const metaEnabled = values?.template?.enabled !== false;
  const googleEnabled = values?.googleTemplate?.enabled !== false;
  const metaReady =
    hasMetaSelected && isMetaConnected && metaEnabled && metaTemplatePicked;
  const googleReady =
    hasGoogleSelected && isGoogleConnected && googleEnabled && googleTemplatePicked;
  const anyPlatformReady = metaReady || googleReady;

  // Template-resolved objective patches into the form value from inside
  // TemplatePicker once GET /templates/:id resolves — no longer derived from
  // the old AdAccount → Campaign → adFactoryNew.campaignsDropdown cascade.

  // ----- Activation validation ---------------------------------------------
  const validationErrors = useMemo(() => {
    const errs = [];
    // Need SOMETHING selected on the Platforms node.
    if (!hasMetaSelected && !hasGoogleSelected) {
      errs.push('Select Meta or Google in the Platforms node first');
    }
    // At least one selected provider has to be OAuth'd in. We don't push
    // separate "Connect Meta" / "Connect Google" errors — those are surfaced
    // by the connection pills above the form. The single rollup message
    // below is cleaner than two parallel errors.
    if (
      (hasMetaSelected || hasGoogleSelected) &&
      !isMetaConnected &&
      !isGoogleConnected
    ) {
      errs.push('Connect Meta or Google to activate');
    }
    if (!values.frequency?.preset) errs.push('Pick a frequency');
    if (!values.frequency?.startDate) errs.push('Pick a start date');
    const pairs = Number(values.pairsPerCycle) || 0;
    if (pairs < 1) errs.push('Pairs per cycle must be at least 1');
    // At least one platform must be "fully ready" = its OAuth in + its
    // template picked. The payload builders only emit targets.<platform>
    // for the platforms whose template is set, so an unfilled side is
    // automatically skipped this activation.
    if (!anyPlatformReady) errs.push('Pick a template for Meta or Google');
    // Per-platform CTA validation. A platform that is not ready is skipped by
    // the payload builder, so we don't block activation on its CTA fields.
    if (metaReady) errs.push(...validatePlatformCta(values.template?.callToAction, 'Meta'));
    if (googleReady) errs.push(...validatePlatformCta(values.googleTemplate?.callToAction, 'Google'));
    // Daily-budget override bounds — empty (null) means "use template
    // default" and is fine. Otherwise must be a positive integer in
    // [100, 1_000_000]. Same bounds apply to both platforms; for Google the
    // value here is whole rupees (TemplatePicker stores units, not micros).
    const checkBudget = (dbo, who) => {
      if (dbo == null) return;
      if (!Number.isInteger(dbo) || dbo < 100) {
        errs.push(`${who} daily budget minimum is 100`);
      } else if (dbo > 1_000_000) {
        errs.push(`${who} daily budget maximum is 10 lakhs`);
      }
    };
    if (hasMetaSelected) checkBudget(values.template?.dailyBudgetOverride, 'Meta');
    if (hasGoogleSelected) checkBudget(values.googleTemplate?.dailyBudgetOverride, 'Google');
    // Campaign-name override — null means "use template default" (fine).
    // Otherwise must be 2–120 chars after trim.
    const checkName = (raw, who) => {
      if (raw == null) return;
      const trimmed = String(raw).trim();
      if (trimmed.length > 0 && trimmed.length < 2) {
        errs.push(`${who} campaign name must be at least 2 characters`);
      } else if (trimmed.length > 120) {
        errs.push(`${who} campaign name must be 120 characters or fewer`);
      }
    };
    if (hasMetaSelected) checkName(values.template?.campaignName, 'Meta');
    if (hasGoogleSelected) checkName(values.googleTemplate?.campaignName, 'Google');
    // Alert emails are optional, but if the user typed something it must be a
    // valid comma-separated list (≤5 valid addresses). Empty is fine.
    const alertErr = validateEmailList(values.alerts?.emailTo);
    if (alertErr) errs.push(alertErr);
    // Block activation if the user has picked today as start date but the
    // hour they last selected has slipped into the past while the form was
    // open. FrequencySection auto-bumps as long as a future hour exists; if
    // all 24 hours are exhausted (it's a few minutes before midnight) the
    // user has to pick tomorrow.
    const todayStr = todayISO(values.frequency?.timezone);
    if (
      values.frequency?.startDate === todayStr &&
      Number.isInteger(values.frequency?.hour)
    ) {
      const nowHour = currentHourLocal(values.frequency?.timezone);
      if (values.frequency.hour <= nowHour) {
        errs.push("Pick a future hour — today's selected time has passed");
      }
    }
    return errs;
  }, [
    isMetaConnected,
    isGoogleConnected,
    hasMetaSelected,
    hasGoogleSelected,
    anyPlatformReady,
    values,
  ]);
  const canActivate = validationErrors.length === 0;

  // Edit mode = we already have an active backend job for this campaign.
  // Drives the footer button label (Update vs Activate) and which thunk gets
  // dispatched (PATCH vs POST). A COMPLETED job is intentionally NOT edit-
  // mode: the backend job is done and PATCHing it would either no-op or
  // reject. Hitting "Activate" with the saved config creates a fresh job
  // instead — matches the user's mental model of "this finished, restart it
  // with my latest tweaks".
  const isCompleted = entry?.status === AUTOMATION_STATUS.COMPLETED;
  const isEditMode = !!entry?.jobId && !isCompleted;

  // Per-platform edit-lock. The backend only forbids changing the template /
  // campaign name / removing a platform that ALREADY has a saved template on
  // the job (adsFactoryAutoController.updateJob field-diff). A platform being
  // added fresh in this same edit accepts a full new template, so it stays
  // fully editable. `entry.config.<platform>.enabled` is set to
  // hasApi<Platform>Template during normalize, so it's the exact "this
  // platform is already on the saved job" signal.
  const metaLocked = isEditMode && !!entry?.config?.template?.enabled;
  const googleLocked = isEditMode && !!entry?.config?.googleTemplate?.enabled;

  const handleActivateClick = async () => {
    if (!campaignId) return;
    const action = isEditMode ? updateAutomation : saveAutomation;
    const successMsg = isEditMode
      ? 'Automation updated'
      : isCompleted
        ? 'Automation re-activated'
        : 'Automation activated';
    const failureMsg = isEditMode
      ? 'Failed to update automation'
      : isCompleted
        ? 'Failed to re-activate automation'
        : 'Failed to activate automation';
    const res = await dispatch(action({ campaignId, config: values }));
    if (action.fulfilled.match(res)) {
      toast.success(successMsg);
      onActivated?.();
    } else {
      // Both thunks rejectWithValue a structured payload; thrown errors land
      // on res.error.message. Surface whichever is present so the user sees
      // the backend's actual rejection reason.
      const msg = res?.payload?.message || res?.error?.message || failureMsg;
      toast.error(msg);
    }
  };

  // Send-test-email — only meaningful in edit mode (needs a saved job the
  // backend can look up). `testingEmail` drives the button's spinner.
  const [testingEmail, setTestingEmail] = useState(false);
  const handleSendTestEmail = async () => {
    if (testingEmail) return;
    setTestingEmail(true);
    try {
      const res = await dispatch(
        testAutomationEmail({ to: values.alerts?.emailTo }),
      );
      if (testAutomationEmail.fulfilled.match(res)) {
        const to = res.payload?.to;
        const where = Array.isArray(to) && to.length ? ` to ${to.join(', ')}` : '';
        toast.success(`Test email sent${where}`);
      } else {
        toast.error(
          res?.payload?.message || res?.error?.message || 'Failed to send test email',
        );
      }
    } finally {
      setTestingEmail(false);
    }
  };

  const availableCredits = useMemo(
    () => Math.max(0, (credits?.totalCredits || 0) - (credits?.creditsUsed || 0)),
    [credits]
  );

  // ----- Live summary fetch ------------------------------------------------
  // Only call POST /jobs/summary once the form is valid enough to be
  // Activate-able (matches the spec: "as soon as the Create/Update button is
  // active"). Re-call on every change to the summary-relevant fields, with a
  // 300ms debounce so a rapid edit doesn't fire N requests. Before validity,
  // SummarySection falls back to the local summarizeCycles helper.
  const summary = useSelector((state) => selectAutomationSummary(state, campaignId));
  const summaryDeps = useMemo(
    () => ({
      pairsPerCycle: values.pairsPerCycle,
      model: values.imageModelProvider,
      preset: values.frequency?.preset,
      startDate: values.frequency?.startDate,
      endDate: values.frequency?.endDate,
      timezone: values.frequency?.timezone,
      custom: values.frequency?.custom,
    }),
    [values.pairsPerCycle, values.imageModelProvider, values.frequency]
  );
  useEffect(() => {
    if (!campaignId || !canActivate) return undefined;
    const handle = setTimeout(() => {
      dispatch(fetchAutomationSummary({ campaignId, config: values }));
    }, 300);
    return () => clearTimeout(handle);
    // values is intentionally not in deps — only the summary-relevant slice
    // is. The thunk reads the full `values` snapshot at fire time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId, canActivate, summaryDeps, dispatch]);

  // Expose form actions + state to the parent (ServicesForm) so it can
  // render the Activate button in its fixed footer.
  useEffect(() => {
    onActionsChange?.({
      activate: handleActivateClick,
      canActivate,
      saving,
      validationError: validationErrors[0] || '',
      availableCredits,
      isEditMode,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canActivate, saving, validationErrors, availableCredits, isEditMode]);

  return (
    <div className="flex flex-col gap-2.5 2xl:gap-3">
      {/* Connection pills — render only for platforms that are actually
          selected on the campaign's Platforms node. A Meta-only campaign
          sees just the Meta pill; a Google-only one sees just Google; both
          selected → both pills stack. */}
      {(hasMetaSelected || hasGoogleSelected) && (
        <div className="flex flex-wrap gap-2">
          {hasMetaSelected && <MetaStatusPill />}
          {hasGoogleSelected && <GoogleStatusPill />}
        </div>
      )}

      <FrequencySection
        value={values.frequency}
        onChange={(frequency) => updateValues({ frequency })}
        disabled={!anyPlatformConnected}
      />

      <PairsPerCycleSection
        value={values.pairsPerCycle}
        onChange={(pairsPerCycle) => updateValues({ pairsPerCycle })}
        model={values.imageModelProvider}
        onModelChange={(imageModelProvider) => updateValues({ imageModelProvider })}
        creditsPerImage={creditsPerImage}
        disabled={!anyPlatformConnected}
      />

      {/* Where to post — per-platform toggle cards inside a labelled
          wrapper. The wrapper owns the heading, the helper line, and the
          live "Posting to" summary. Each TemplatePicker renders its own
          toggle so the user can flip a platform off without un-picking the
          template (the id stays in state, just isn't shipped on activate). */}
      <WhereToPostSection
        metaActive={metaReady}
        googleActive={googleReady}
        hasMetaSelected={hasMetaSelected}
        hasGoogleSelected={hasGoogleSelected}
      >
        {hasMetaSelected && (
          <TemplatePicker
            platform="meta"
            value={values.template}
            onChange={(template) => updateValues({ template })}
            enabled={values.template?.enabled !== false}
            onToggleEnabled={(next) =>
              updateValues({ template: { ...values.template, enabled: next } })
            }
            disabled={!isMetaConnected}
            locked={metaLocked}
          />
        )}
        {hasGoogleSelected && (
          <TemplatePicker
            platform="google"
            value={values.googleTemplate}
            onChange={(googleTemplate) => updateValues({ googleTemplate })}
            enabled={values.googleTemplate?.enabled !== false}
            onToggleEnabled={(next) =>
              updateValues({
                googleTemplate: { ...values.googleTemplate, enabled: next },
              })
            }
            disabled={!isGoogleConnected}
            locked={googleLocked}
          />
        )}
      </WhereToPostSection>

      <AlertEmailsSection
        value={values.alerts?.emailTo}
        onChange={(emailTo) =>
          updateValues({ alerts: { ...values.alerts, emailTo } })
        }
        disabled={!anyPlatformConnected}
        canTest
        testing={testingEmail}
        onSendTest={handleSendTestEmail}
      />

      <SummarySection
        frequency={values.frequency}
        pairsPerCycle={values.pairsPerCycle}
        creditsPerImage={creditsPerImage}
        availableCredits={availableCredits}
        apiSummary={summary?.data}
        apiLoading={summary?.loading}
        disabled={!canActivate}
      />
    </div>
  );
}

// ----------------------------------------------------------------------------
// WhereToPostSection — labelled wrapper around the per-platform
// TemplatePicker cards. Owns the heading, the helper line, and the live
// "Posting to:" pill summary. The pickers themselves render their own
// toggles; this section just frames them.
//
// Receives metaActive / googleActive booleans (= toggled-on AND template
// picked) so the summary stays in sync without re-deriving the readiness
// rules a second time.
// ----------------------------------------------------------------------------
function WhereToPostSection({
  children,
  metaActive,
  googleActive,
  hasMetaSelected,
  hasGoogleSelected,
}) {
  const anyActive = metaActive || googleActive;
  // No platforms selected on the Platforms node = nothing to show in this
  // section. The parent already validates against this state; the empty
  // render keeps the form quiet rather than displaying a hollow heading.
  if (!hasMetaSelected && !hasGoogleSelected) return null;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2.5">
        <span
          className={`flex size-6 items-center justify-center rounded-full text-xs font-bold transition-colors ${
            anyActive ? 'bg-emerald-400/20 text-emerald-400' : 'bg-white/10 text-[#cfcfd4]'
          }`}
        >
          {anyActive ? '✓' : '4'}
        </span>
        <h2 className="text-[15px] font-semibold text-white">Where to post</h2>
      </div>

      <div className="flex items-start gap-2.5 rounded-xl border border-[#15DCFF]/15 bg-[#15DCFF]/5 px-3 py-2.5">
        <Info className="mt-px size-3.5 shrink-0 text-[#15DCFF]" />
        <p className="text-[12.5px] leading-relaxed text-[#b9d9e0]">
          Turn on <b className="text-white">at least one</b> platform and choose its template.
          Your ad runs <b className="text-white">only</b> on the platforms you turn on.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-[#8a8a90]">
        <span className="font-medium">Posting to:</span>
        {metaActive && <DestPill platform="meta" />}
        {googleActive && <DestPill platform="google" />}
        {!anyActive && (
          <span className="text-xs italic text-[#6a6a70]">
            nothing yet — turn on a platform below
          </span>
        )}
      </div>

      {children}
    </section>
  );
}

function DestPill({ platform }) {
  const Icon = platform === 'google' ? FcGoogle : FaFacebookF;
  const label = platform === 'google' ? 'Google' : 'Meta';
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1 text-xs font-semibold text-emerald-400">
      <Icon className={platform === 'meta' ? 'size-3 text-[#1877F2]' : 'size-3.5'} />
      {label}
    </span>
  );
}
