import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'react-toastify';

import {
  fetchAutomation,
  saveAutomation,
  updateAutomation,
  fetchCtaOptions,
  fetchAutomationSummary,
} from '@/store/actions/adFactoryAutomation/adFactoryAutomationActions';
import {
  selectAutomationEntry,
  selectAutomationSaving,
  selectCtaOptionsForObjective,
  selectCtaOptionsLoading,
  selectAutomationSummary,
} from '@/store/reducers/adFactoryAutomation/adFactoryAutomationSlice';
import {
  checkFbUser,
} from '@/store/actions/adFactoryNew/adFactoryActions';
import { useImageCreditsForModel } from '@/utils/hooks/useImageCreditsForModel';

import FrequencySection from './FrequencySection';
import { getBrowserTimezone } from './TimezoneSelect';
import PairsPerCycleSection from './PairsPerCycleSection';
import { MODEL_OPTIONS } from './imageModels';
import CallToActionSection, { isValidCtaUrl, isValidCtaButton } from './CallToActionSection';
import TargetSection from './TargetSection';
import SummarySection from './SummarySection';
import MetaStatusPill from './MetaStatusPill';

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
//   4. Target picker (Where to post)
//   5. Call-to-Action button — gated on the target being complete, since the
//      CTA only makes sense once a destination is known.
//   6. Live cycle / credit summary
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

const defaultFormValues = () => {
  const timezone = getBrowserTimezone();
  return {
    frequency: {
      preset: 'daily',
      startDate: todayISO(timezone),
      endDate: null,
      timezone,
      custom: { interval: 1, unit: 'week', daysOfWeek: [] },
    },
    pairsPerCycle: 1,
    // Image model provider — same enum + default as ServicesForm so the
    // backend can reuse the existing image-generation worker contract.
    imageModelProvider: 'google',
    callToAction: { button: null, url: '' },
    target: {
      adAccountId: null,
      campaignId: null,
      campaignObjective: null,
      // Ordered list of Meta ad set IDs. Backend rotates through them when
      // one hits the 50-ad limit. Stored as array even when only one is
      // picked so the payload shape is consistent.
      adSetId: [],
      pageId: null,
      // Optional — only collected when the picked campaign's objective is
      // OUTCOME_LEADS, in which case TargetSection surfaces a Lead Form picker.
      leadFormId: null,
    },
  };
};

// Deep-merge a persisted config over the defaults. Top-level scalars and
// `imageModelProvider` are taken from source; the nested `frequency`,
// `callToAction`, and `target` objects are merged field-by-field so partial
// saves don't blow away unspecified defaults.
function mergeConfig(target, source) {
  if (!source) return target;
  return {
    ...target,
    ...source,
    frequency: { ...target.frequency, ...(source.frequency || {}) },
    callToAction: { ...target.callToAction, ...(source.callToAction || {}) },
    target: { ...target.target, ...(source.target || {}) },
  };
}

const REOPEN_AFTER_FB_KEY = 'adsgpt:reopen-automation-for';

export default function AutomationForm({ onActivated, onActionsChange }) {
  const dispatch = useDispatch();
  const [searchParams] = useSearchParams();
  const campaignId = searchParams.get('campaignId');

  const { fbUser } = useSelector((state) => state.adFactoryNew);
  const { userData, credits } = useSelector((state) => state.socket);
  const saving = useSelector(selectAutomationSaving);
  const entry = useSelector((state) => selectAutomationEntry(state, campaignId));
  // CTA options cache keyed by the picked campaign's objective. Populated by
  // the dispatch effect below.
  const ctaOptionsLoading = useSelector(selectCtaOptionsLoading);

  const isMetaConnected = !!fbUser?.facebookId;

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
      return mergeConfig(initial, entry.config);
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
      setValues((prev) => mergeConfig(prev, entry.config));
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

  // After an OAuth redirect, AdFactoryPage sets this flag so we know to
  // reopen the Services modal in Schedule mode. The flag is consumed in
  // ServicesForm — here we just clean it up once the form has mounted.
  useEffect(() => {
    if (sessionStorage.getItem(REOPEN_AFTER_FB_KEY) === campaignId) {
      sessionStorage.removeItem(REOPEN_AFTER_FB_KEY);
    }
  }, [campaignId]);

  const updateValues = (patch) => setValues((prev) => ({ ...prev, ...patch }));

  // Gate the Call-to-Action section until all four "Where to post" fields are
  // picked. The CTA URL only makes sense once a target exists, and a wrongly
  // ordered click can otherwise lead the user to fill the CTA first.
  // adSetId is an array — at least one selection counts as "picked".
  const hasAdSet =
    Array.isArray(values?.target?.adSetId) && values.target.adSetId.length > 0;
  const isTargetComplete =
    !!values?.target?.adAccountId &&
    !!values?.target?.campaignId &&
    hasAdSet &&
    !!values?.target?.pageId;

  // Whatever objective the picked campaign carries. AutomationForm watches
  // this and (a) dispatches fetchCtaOptions, (b) clears the stale CTA button
  // on a real change (not on hydration).
  const campaignObjective = values?.target?.campaignObjective || null;
  const ctaCache = useSelector((state) =>
    selectCtaOptionsForObjective(state, campaignObjective)
  );
  const ctaOptions = ctaCache?.status === 'ok' ? ctaCache.options : null;
  const ctaUnsupported = ctaCache?.status === 'unsupported';

  // First-sighting guard so hydration ("Edit" path) doesn't trigger a clear.
  const objectiveInitialized = useRef(false);
  const lastSeenObjective = useRef(campaignObjective);

  useEffect(() => {
    // Always (re)fetch when we have an objective — the thunk is cache-aware,
    // so subsequent calls for the same objective are free.
    if (campaignObjective) {
      dispatch(fetchCtaOptions(campaignObjective));
    }

    if (!objectiveInitialized.current) {
      // Initial mount / hydration — record the seen objective without clearing.
      objectiveInitialized.current = true;
      lastSeenObjective.current = campaignObjective;
      return;
    }

    if (campaignObjective !== lastSeenObjective.current) {
      // Genuine user-driven campaign change → clear stale CTA button so the
      // user has to pick again from the new objective's option set.
      setValues((prev) => ({
        ...prev,
        callToAction: { ...prev.callToAction, button: null },
      }));
      lastSeenObjective.current = campaignObjective;
    }
  }, [campaignObjective, dispatch]);

  // Reactive objective backfill — when the form is hydrated from a fetched
  // job, target.campaignObjective is null (the API doesn't return the Meta
  // campaign's objective on the job document). TargetSection's own effect
  // fires fetchCampaign(adAccountId) which populates campaignsDropdown; once
  // it lands, we look up the saved campaignId and patch the objective into
  // the form values so the CTA section can resolve its option set.
  const campaignsDropdown = useSelector((state) => state.adFactoryNew?.campaignsDropdown);
  useEffect(() => {
    const tgt = values?.target;
    if (!tgt?.campaignId || tgt.campaignObjective) return;
    if (!Array.isArray(campaignsDropdown) || campaignsDropdown.length === 0) return;
    const match = campaignsDropdown.find((c) => c.id === tgt.campaignId);
    if (match?.objective) {
      setValues((prev) => ({
        ...prev,
        target: { ...prev.target, campaignObjective: match.objective },
      }));
    }
  }, [campaignsDropdown, values?.target?.campaignId, values?.target?.campaignObjective]);

  // ----- Activation validation ---------------------------------------------
  const validationErrors = useMemo(() => {
    const errs = [];
    if (!isMetaConnected) errs.push('Connect Meta first');
    if (!values.frequency?.preset) errs.push('Pick a frequency');
    if (!values.frequency?.startDate) errs.push('Pick a start date');
    const pairs = Number(values.pairsPerCycle) || 0;
    if (pairs < 1) errs.push('Pairs per cycle must be at least 1');
    if (!values.target?.adAccountId) errs.push('Pick an ad account');
    if (!values.target?.campaignId) errs.push('Pick a Meta campaign');
    if (!hasAdSet) errs.push('Pick at least one ad set');
    if (!values.target?.pageId) errs.push('Pick a Facebook page');
    // CTA validation depends on the live options (per objective). When the
    // objective is unsupported, no button choice is valid — bail with a clear
    // message instead of asking the user to "pick" from an empty list.
    if (ctaUnsupported) {
      errs.push("Selected campaign's objective doesn't support a Call-to-Action button");
    } else if (!isValidCtaButton(values.callToAction?.button, ctaOptions)) {
      errs.push('Pick a Call-to-Action button');
    }
    if (!isValidCtaUrl(values.callToAction?.url || '')) errs.push('Enter a valid destination URL');
    return errs;
  }, [isMetaConnected, values, hasAdSet, ctaUnsupported, ctaOptions]);
  const canActivate = validationErrors.length === 0;

  // Edit mode = we already have a backend job for this campaign. Drives the
  // footer button label (Update vs Activate), the dispatched thunk (PATCH vs
  // POST), and the locked-field set in TargetSection.
  const isEditMode = !!entry?.jobId;

  const handleActivateClick = async () => {
    if (!campaignId) return;
    const action = isEditMode ? updateAutomation : saveAutomation;
    const successMsg = isEditMode ? 'Automation updated' : 'Automation activated';
    const failureMsg = isEditMode ? 'Failed to update automation' : 'Failed to activate automation';
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
      <MetaStatusPill />

      <FrequencySection
        value={values.frequency}
        onChange={(frequency) => updateValues({ frequency })}
        disabled={!isMetaConnected}
      />

      <PairsPerCycleSection
        value={values.pairsPerCycle}
        onChange={(pairsPerCycle) => updateValues({ pairsPerCycle })}
        model={values.imageModelProvider}
        onModelChange={(imageModelProvider) => updateValues({ imageModelProvider })}
        creditsPerImage={creditsPerImage}
        disabled={!isMetaConnected}
      />

      <TargetSection
        value={values.target}
        onChange={(target) => updateValues({ target })}
        disabled={!isMetaConnected}
      />

      <CallToActionSection
        value={values.callToAction}
        onChange={(callToAction) => updateValues({ callToAction })}
        disabled={!isMetaConnected}
        locked={!isTargetComplete || ctaUnsupported}
        loading={!!campaignObjective && ctaOptionsLoading && !ctaCache}
        options={ctaOptions}
        onLockedInteraction={() => {
          if (!isTargetComplete) {
            toast.error('Where to Post section is required for Call to Action');
          } else if (ctaUnsupported) {
            toast.error(
              `Campaign objective "${campaignObjective}" doesn't support a Call-to-Action button`
            );
          }
        }}
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
