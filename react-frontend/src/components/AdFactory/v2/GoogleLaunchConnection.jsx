import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { FcGoogle } from 'react-icons/fc';
import { toast } from 'react-toastify';

import DestinationFields from './destinationFields';
import {
  fetchGoogleAdsTemplates,
  fetchGoogleAdsTemplateById,
} from '@/store/actions/adFactoryAutomation/adFactoryAutomationActions';
import {
  selectGoogleAdsTemplates,
  selectGoogleAdsTemplatesLoading,
  selectGoogleAdsTemplatesError,
  selectGoogleAdsTemplateById,
} from '@/store/reducers/adFactoryAutomation/adFactoryAutomationSlice';
import { INPUT, LABEL as LBL, MUTED } from './_tokens';
import { CONTROL, CONTROL_H, FAINT, LABEL, VALUE } from './_tokens';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import getCookies from '@/utils/getCookies';
import {
  fetchGoogleAdAccounts,
  fetchGoogleCampaignsMySpace,
  fetchGoogleAdGroups,
  checkGoogleUser,
} from '@/store/actions/adFactoryNew/adFactoryActions';

const BACKEND_HOST = import.meta.env.VITE_SOCKET_URL;

// Only newlines are stripped, not every run of whitespace: collapsing spaces
// on each keystroke rewrites what the user is still typing.
const stripNewlines = (v) => String(v).replace(/[\r\n]+/g, ' ');


const channelHumanName = (t) => {
  switch (t) {
    case 'SEARCH': return 'Search';
    case 'DISPLAY': return 'Display';
    case 'VIDEO': return 'Video';
    case 'PERFORMANCE_MAX': return 'Performance Max';
    case 'SHOPPING': return 'Shopping';
    case 'MULTI_CHANNEL': return 'Multi-channel';
    case 'DEMAND_GEN': return 'Demand Gen';
    default: return t || 'Unknown';
  }
};

export const emptyGoogleConnection = () => ({
  adAccountId: '',
  adAccountName: '',
  campaignId: '',
  campaignName: '',
  channelType: '',
  adGroupId: '',
  adGroupName: '',
  templateId: null,
  templateName: '',
  objective: null,
  conversionLocation: null,
  customerId: null,
  payload: null,
  // Per-platform destination — Google's own button and landing page, kept
  // separate from Meta's rather than shared through the brief. See
  // destinationFields.jsx for why.
  ctaButton: '',
  ctaUrl: '',
  // ── Schedule-only, and the whole reason `templateMode` exists ────────────
  // A saved Google Ads template, plus the one field Full control lets you
  // override on it. Only the schedule collects these; the manual post panel
  // keeps using the account/campaign/ad-group ids below, because posting into
  // an EXISTING ad group is what that flow does and a template cannot express
  // it.
  template: null,          // { id, name, objective, conversionLocation, payload }
  // NOT `campaignName` — that key already holds the NAME OF THE PICKED GOOGLE
  // CAMPAIGN in id mode, and reusing it would make one field mean two things
  // in a single object.
  templateCampaignName: '',
});

export const isGoogleAccountConnected = (googleUser) =>
  !!(googleUser?.email || googleUser?.googleId || googleUser?.sub || googleUser?._id);

// Ready to publish = OAuth connected, and all 3 required Google Ads fields are selected.
export const isGoogleConnectionComplete = (g, connected) => {
  if (!connected) return false;
  return Boolean(g?.adAccountId && g?.campaignId && g?.adGroupId);
};

// A SCHEDULE is ready on a different signal: the template, not the three ids.
// Deliberately a separate function rather than an `||` inside the one above —
// both panels share ONE googleConnection object, so a template picked for the
// schedule must not make the manual post panel believe it has an ad group to
// post into. It would sail past its own check and fail at the server, which
// requires all three ids.
export const isGoogleScheduleComplete = (g, connected) => {
  if (!connected) return false;
  return Boolean(g?.template?.id && g?.template?.payload);
};

// What `targets.google` on the job should be.
//
// TWO shapes, because there are two ways to describe a Google destination and
// the backend already accepts both:
//
//   template  →  passed through verbatim (briefToJobPayload takes the
//                `opts.google.template` branch). This is byte-for-byte what
//                Full control's own automation sends — see
//                buildGoogleTemplateForJob in adFactoryAutomationActions.js —
//                so the scheduled run behaves identically in both modes.
//   three ids →  the older shape, which the backend turns into a synthetic
//                template. Still what the manual post panel produces.
//
// No backend change is needed for either; the template branch has been sitting
// in briefToJobPayload unused by Quick setup until now.
export const buildGoogleTarget = (g, { dailyBudget, ctaUrl } = {}) => {
  // ── Template mode (the schedule) ─────────────────────────────────────────
  const basePayload = g?.template?.payload;
  if (g?.template?.id && basePayload) {
    const overlay = {};
    const name = (g.templateCampaignName || '').trim();
    if (name) {
      // The Google wizard writes the campaign label under BOTH keys, and the
      // backend reads `name || campaignName`. Set both so neither goes stale.
      overlay.name = name;
      overlay.campaignName = name;
    }
    if (g.ctaButton) overlay.callToAction = g.ctaButton;
    const url = g.ctaUrl || ctaUrl;
    if (url) {
      // `finalUrl` is the wizard's field; some saved payloads carry `linkUrl`
      // as an alias. Write both.
      overlay.finalUrl = url;
      overlay.linkUrl = url;
    }
    // The schedule's own daily budget is the number the card prices the run
    // with, so it is the one that should run. Whole currency → micros.
    if (Number.isFinite(Number(dailyBudget)) && Number(dailyBudget) > 0) {
      overlay.dailyBudgetMicros = Math.round(Number(dailyBudget) * 1_000_000);
    }

    return {
      template: {
        name: g.template.name,
        objective: g.template.objective,
        conversionLocation: g.template.conversionLocation,
        customerId: basePayload.customerId || basePayload.adAccountId || null,
        // The id rides inside the payload so a later edit can re-select the
        // saved template in the dropdown. The backend echoes payload as-is.
        payload: { ...basePayload, templateId: g.template.id, ...overlay },
      },
    };
  }

  // ── Id mode (manual posting) ─────────────────────────────────────────────
  if (!g?.adAccountId || !g?.campaignId || !g?.adGroupId) return null;

  return {
    adAccountId: g.adAccountId,
    campaignId: g.campaignId,
    adGroupId: g.adGroupId,
    customerId: g.customerId || g.adAccountId,
    // Google's own pair when the tab collected one; the caller's `ctaUrl` (the
    // brief's) is the fallback so existing schedules keep the URL they had.
    ...(g.ctaButton ? { ctaButton: g.ctaButton } : {}),
    ...(g.ctaUrl || ctaUrl ? { ctaUrl: g.ctaUrl || ctaUrl } : {}),
  };
};

function PlainDropdown({ value, onChange, options, placeholder, disabled }) {
  const selected = options.find((o) => o.value === value);
  return (
    <Select value={value || ''} onValueChange={(v) => onChange?.(v)} disabled={disabled}>
      <SelectTrigger
        className={`${CONTROL_H}! w-full ${CONTROL} px-3 shadow-none ${VALUE} ${
          disabled ? 'cursor-not-allowed opacity-60' : ''
        }`}
        disabled={disabled}
      >
        <SelectValue placeholder={placeholder}>
          {selected?.label ?? placeholder}
        </SelectValue>
      </SelectTrigger>
      <SelectContent className="z-9999 max-h-72 min-w-[340px] border border-gray-200 bg-white text-gray-800 shadow-xl dark:border-white/20 dark:bg-[#1A1A1A] dark:text-white dark:backdrop-blur-md">
        {options.length === 0 ? (
          <div className="m-3 h-8 w-full text-center text-sm text-gray-400 dark:text-gray-300">
            No options found
          </div>
        ) : (
          options.map((opt) => (
            <SelectItem
              key={opt.value}
              value={opt.value}
              className="cursor-pointer pr-4! text-sm text-gray-700 hover:bg-gray-100 hover:text-gray-900 dark:font-normal dark:text-[#AFAFAF] dark:hover:bg-[#0D0D0D]/30 dark:hover:text-white"
            >
              {opt.label}
            </SelectItem>
          ))
        )}
      </SelectContent>
    </Select>
  );
}

function CampaignDropdown({ value, onChange, options, placeholder, disabled }) {
  const selected = options.find((o) => o.value === value);
  return (
    <Select value={value || ''} onValueChange={(v) => onChange?.(v)} disabled={disabled}>
      <SelectTrigger
        className={`${CONTROL_H}! w-full ${CONTROL} px-3 shadow-none ${VALUE} ${
          disabled ? 'cursor-not-allowed opacity-60' : ''
        }`}
        disabled={disabled}
      >
        <SelectValue placeholder={placeholder}>
          {selected?.label ?? placeholder}
        </SelectValue>
      </SelectTrigger>
      <SelectContent className="z-9999 max-h-72 min-w-[340px] border border-gray-200 bg-white text-gray-800 shadow-xl dark:border-white/20 dark:bg-[#1A1A1A] dark:text-white dark:backdrop-blur-md">
        {options.length === 0 ? (
          <div className="m-3 h-8 w-full text-center text-sm text-gray-400 dark:text-gray-300">
            No campaigns found
          </div>
        ) : (
          options.map((opt) => (
            <SelectItem
              key={opt.value}
              value={opt.value}
              disabled={opt.disabled}
              title={opt.disabled ? opt.disabledReason : undefined}
              className={`cursor-pointer pr-4! text-sm text-gray-700 hover:bg-gray-100 hover:text-gray-900 dark:font-normal dark:text-[#AFAFAF] dark:hover:bg-[#0D0D0D]/30 dark:hover:text-white ${
                opt.disabled ? 'cursor-not-allowed opacity-40' : ''
              }`}
            >
              <div className="flex w-full items-center justify-between gap-3">
                <span className={`truncate ${opt.disabled ? 'text-gray-400 dark:text-gray-500' : 'font-medium text-gray-900 dark:text-white'}`}>
                  {opt.label}
                </span>
                <span
                  className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                    opt.channelType === 'DISPLAY'
                      ? 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-400/30 dark:bg-blue-400/10 dark:text-blue-300'
                      : 'border-gray-200 bg-gray-100 text-gray-500 dark:border-white/10 dark:bg-white/5 dark:text-white/55'
                  }`}
                >
                  {opt.channelLabel}
                </span>
              </div>
            </SelectItem>
          ))
        )}
      </SelectContent>
    </Select>
  );
}

export default function GoogleLaunchConnection({
  value,
  onChange,
  disabled = false,
  // The schedule collects a saved template instead of the three ids — the same
  // thing Full control's automation asks for. Off everywhere else, so manual
  // posting keeps the picker that matches what IT does.
  templateMode = false,
}) {
  const dispatch = useDispatch();
  const g = value || emptyGoogleConnection();

  const { userData } = useSelector((state) => state.socket) || {};
  const {
    googleUser,
    googleAdAccounts = [],
    googleCampaigns = [],
    googleAdGroups = [],
  } = useSelector((state) => state.adFactoryNew || {});
  const connected = isGoogleAccountConnected(googleUser);

  // ── Saved Google templates (schedule only) ───────────────────────────────
  const templates = useSelector(selectGoogleAdsTemplates);
  const templatesLoading = useSelector(selectGoogleAdsTemplatesLoading);
  const templatesError = useSelector(selectGoogleAdsTemplatesError);
  const pickedBucket = useSelector((state) =>
    selectGoogleAdsTemplateById(state, g.template?.id),
  );
  const pickedTemplate = pickedBucket?.template;

  useEffect(() => {
    if (!templateMode || !connected) return;
    dispatch(fetchGoogleAdsTemplates());
  }, [dispatch, templateMode, connected]);

  // The list carries names; the PAYLOAD only arrives with the full record, and
  // the payload is the entire point — it is what the job runs on.
  useEffect(() => {
    if (!templateMode || !g.template?.id || pickedTemplate) return;
    dispatch(fetchGoogleAdsTemplateById(g.template.id));
  }, [dispatch, templateMode, g.template?.id, pickedTemplate]);

  // Mirror the resolved payload back into state once it lands.
  useEffect(() => {
    if (!templateMode || !pickedTemplate || !g.template?.id) return;
    if (g.template.payload) return; // already mirrored — guards a render loop
    onChange?.({
      ...g,
      template: {
        ...g.template,
        name: pickedTemplate.name,
        objective: pickedTemplate.objective,
        conversionLocation: pickedTemplate.conversionLocation,
        payload: pickedTemplate.payload,
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickedTemplate, templateMode]);

  const templateOptions = useMemo(
    () =>
      (templates || []).map((t) => ({
        value: t._id || t.id,
        label: t.name || t._id || 'Template',
      })),
    [templates],
  );

  const pickTemplate = useCallback(
    (templateId) => {
      if (!templateId) {
        onChange?.({ ...g, template: null });
        return;
      }
      const item = (templates || []).find((t) => (t._id || t.id) === templateId);
      onChange?.({
        ...g,
        template: {
          id: templateId,
          name: item?.name || '',
          objective: item?.objective || null,
          conversionLocation: item?.conversionLocation || null,
          payload: null, // filled once fetchGoogleAdsTemplateById resolves
        },
      });
    },
    [g, onChange, templates],
  );

  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);
  const [loadingAdGroups, setLoadingAdGroups] = useState(false);

  const [accountsError, setAccountsError] = useState('');
  const [campaignsError, setCampaignsError] = useState('');
  const [adGroupsError, setAdGroupsError] = useState('');

  // ── Fetches ──────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!userData?.user_id) return;
    dispatch(checkGoogleUser(userData.user_id));
  }, [dispatch, userData?.user_id]);

  useEffect(() => {
    if (!connected || !googleUser?._id) return;
    if (googleAdAccounts.length === 0) {
      setLoadingAccounts(true);
      setAccountsError('');
      dispatch(fetchGoogleAdAccounts(googleUser._id))
        .unwrap()
        .catch((err) => setAccountsError(err || "We couldn't load your Google ad accounts."))
        .finally(() => setLoadingAccounts(false));
    }
  }, [connected, googleUser?._id, googleAdAccounts.length, dispatch]);

  // Load campaigns when ad account is chosen
  useEffect(() => {
    if (!g.adAccountId) return;
    let cancelled = false;
    setLoadingCampaigns(true);
    setCampaignsError('');
    dispatch(fetchGoogleCampaignsMySpace({ adAccountId: g.adAccountId }))
      .unwrap()
      .catch((err) => {
        if (!cancelled) setCampaignsError(err || "We couldn't load your Google campaigns.");
      })
      .finally(() => {
        if (!cancelled) setLoadingCampaigns(false);
      });
    return () => {
      cancelled = true;
    };
  }, [g.adAccountId, dispatch]);

  // Load ad groups when campaign is chosen
  useEffect(() => {
    if (!g.campaignId || !g.adAccountId) return;
    let cancelled = false;
    setLoadingAdGroups(true);
    setAdGroupsError('');
    dispatch(fetchGoogleAdGroups({ adAccountId: g.adAccountId, campaignId: g.campaignId }))
      .unwrap()
      .catch((err) => {
        if (!cancelled) setAdGroupsError(err || "We couldn't load your Google ad groups.");
      })
      .finally(() => {
        if (!cancelled) setLoadingAdGroups(false);
      });
    return () => {
      cancelled = true;
    };
  }, [g.campaignId, g.adAccountId, dispatch]);

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleConnect = useCallback(() => {
    if (!userData?.user_id) {
      toast.error('Please sign in to connect Google.');
      return;
    }
    const feUrl = window.location.href;
    window.location.href = `${BACKEND_HOST}/api/auth/google?userId=${userData.user_id}&token=${getCookies()}&feUrl=${encodeURIComponent(feUrl)}`;
  }, [userData?.user_id]);

  const patch = useCallback((next) => onChange?.({ ...g, ...next }), [g, onChange]);

  const adAccountOptions = useMemo(
    () =>
      (googleAdAccounts || []).map((a) => ({
        value: String(a.id || a.customerId),
        label: a.name ? `${a.name} (${a.id})` : String(a.id || 'Ad account'),
      })),
    [googleAdAccounts],
  );

  const campaignOptions = useMemo(
    () =>
      (googleCampaigns || []).map((c) => {
        const channelType = c.channelType || c.advertisingChannelType || null;
        const compatible = channelType === 'DISPLAY';
        return {
          value: String(c.id || c.campaignId),
          label: c.name || c.campaignName || String(c.id || c.campaignId),
          channelLabel: channelHumanName(channelType),
          channelType,
          disabled: !compatible,
          disabledReason: compatible
            ? undefined
            : channelType
              ? `Not compatible — ${channelHumanName(channelType)} campaigns can't post an image asset. Pick a Display campaign instead.`
              : `Missing campaign type — can't determine compatibility. Pick a Display campaign.`,
        };
      }),
    [googleCampaigns],
  );

  const selectedCampaignRow = useMemo(
    () => campaignOptions.find((c) => c.value === g.campaignId) || null,
    [campaignOptions, g.campaignId],
  );
  const selectedIsIncompatible = Boolean(
    g.campaignId && selectedCampaignRow?.disabled,
  );

  const adGroupOptions = useMemo(
    () =>
      (googleAdGroups || []).map((a) => ({
        value: String(a.id || a.adGroupId),
        label: a.name || a.adGroupName || String(a.id || a.adGroupId),
      })),
    [googleAdGroups],
  );

  const handleAdAccount = useCallback(
    (adAccountId) => {
      const item = (adAccountOptions || []).find((a) => String(a.value) === String(adAccountId));
      patch({
        adAccountId,
        adAccountName: item?.label || '',
        customerId: adAccountId,
        campaignId: '',
        campaignName: '',
        channelType: '',
        adGroupId: '',
        adGroupName: '',
      });
    },
    [adAccountOptions, patch],
  );

  const handleCampaign = useCallback(
    (campaignId) => {
      const item = (campaignOptions || []).find((c) => String(c.value) === String(campaignId));
      patch({
        campaignId,
        campaignName: item?.label || '',
        channelType: item?.channelType || 'DISPLAY',
        adGroupId: '',
        adGroupName: '',
      });
    },
    [campaignOptions, patch],
  );

  const handleAdGroup = useCallback(
    (adGroupId) => {
      const item = (adGroupOptions || []).find((a) => String(a.value) === String(adGroupId));
      patch({
        adGroupId,
        adGroupName: item?.label || '',
      });
    },
    [adGroupOptions, patch],
  );

  // ── Render ───────────────────────────────────────────────────────────────

  if (!connected) {
    return (
      <div className="flex flex-col gap-2">
        <span className={LABEL}>Google account</span>
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
          <span className="text-xs font-medium">
            Google not connected — required to publish here
          </span>
          <button
            type="button"
            onClick={handleConnect}
            disabled={disabled}
            className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-semibold text-gray-800 shadow-xs transition hover:bg-gray-50 dark:border-white/15 dark:bg-white/10 dark:text-white dark:hover:bg-white/15 disabled:opacity-50"
          >
            <FcGoogle className="h-3.5 w-3.5" />
            Connect
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <span className={LABEL}>Google account</span>
        <div
          className={`flex ${CONTROL_H} items-center gap-2 self-start rounded-md border border-gray-200 bg-gray-50 px-3 text-gray-800 dark:border-white/10 dark:bg-white/5 dark:text-gray-100`}
        >
          <FcGoogle className="h-4 w-4 shrink-0" />
          <span className="text-xs font-medium">{googleUser?.name || googleUser?.email || 'Connected'}</span>
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
        </div>
      </div>

      {/* ── Schedule: a saved template IS the destination ────────────────
          Full control's Google automation asks for exactly this and nothing
          else — the template already carries the customer, campaign, ad group
          and budget, so re-asking for them here would be three ways to say the
          same thing and two of them could disagree. The manual post panel
          keeps the id pickers below, because posting into an ad group the user
          picks by hand is a different job. */}
      {templateMode ? (
        <>
          <div className="flex flex-col gap-2">
            <span className={LABEL}>Ad template *</span>
            {templatesLoading ? (
              <div className={`flex h-9 items-center gap-2 rounded-xl px-3 text-sm ${CONTROL} ${MUTED}`}>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Loading templates…
              </div>
            ) : (
              <PlainDropdown
                value={g.template?.id || ''}
                options={templateOptions}
                onChange={pickTemplate}
                placeholder={
                  !connected
                    ? 'Connect Google first'
                    : templateOptions.length === 0
                      ? 'No saved Google templates'
                      : 'Select a Google template'
                }
                disabled={disabled || !connected || templateOptions.length === 0}
              />
            )}
            {templatesError && (
              <span className="text-[11px] text-[#B45309] dark:text-[#E8A33D]">{templatesError}</span>
            )}
            {!templatesLoading && !templatesError && templateOptions.length === 0 && connected && (
              <span className={FAINT}>
                Build one in Google Ads Manager, then come back to schedule it.
              </span>
            )}
            {g.template?.id && !g.template?.payload && !templatesError && (
              <span className={FAINT}>Loading template details…</span>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <span className={LABEL}>Campaign name</span>
            <input
              type="text"
              className={INPUT}
              value={g.templateCampaignName || ''}
              placeholder={g.template?.payload?.campaignName || g.template?.payload?.name || 'Template default'}
              disabled={disabled || !g.template?.id}
              maxLength={120}
              onChange={(e) => onChange?.({ ...g, templateCampaignName: stripNewlines(e.target.value) })}
            />
            <span className={FAINT}>Leave empty to keep the template&apos;s own name.</span>
          </div>
        </>
      ) : (
        <>
      <div className="flex flex-col gap-2">
        <span className={LABEL}>Select Ad Account *</span>
        <PlainDropdown
          value={g.adAccountId || ''}
          options={adAccountOptions}
          onChange={handleAdAccount}
          placeholder={
            loadingAccounts
              ? 'Loading ad accounts…'
              : adAccountOptions.length === 0
                ? 'No Google ad accounts found'
                : 'Choose Ad Account'
          }
          disabled={disabled || loadingAccounts || adAccountOptions.length === 0}
        />
        {accountsError && (
          <span className="text-[11px] text-[#B45309] dark:text-[#E8A33D]">{accountsError}</span>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <span className={LABEL}>Select Campaign *</span>
        <CampaignDropdown
          value={g.campaignId || ''}
          options={campaignOptions}
          onChange={handleCampaign}
          placeholder={
            !g.adAccountId
              ? 'Pick an ad account first'
              : loadingCampaigns
                ? 'Loading campaigns…'
                : campaignOptions.length === 0
                  ? 'No campaigns found'
                  : 'Choose Campaign'
          }
          disabled={disabled || loadingCampaigns || !g.adAccountId || campaignOptions.length === 0}
        />
        {campaignsError && (
          <span className="text-[11px] text-[#B45309] dark:text-[#E8A33D]">{campaignsError}</span>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <span className={LABEL}>Select Ad Group *</span>
        <PlainDropdown
          value={g.adGroupId || ''}
          options={adGroupOptions}
          onChange={handleAdGroup}
          placeholder={
            !g.campaignId
              ? 'Pick a campaign first'
              : loadingAdGroups
                ? 'Loading ad groups…'
                : adGroupOptions.length === 0
                  ? 'No ad groups found on this campaign'
                  : 'Choose Ad Group'
          }
          disabled={disabled || loadingAdGroups || !g.campaignId || selectedIsIncompatible || adGroupOptions.length === 0}
        />
        {adGroupsError && (
          <span className="text-[11px] text-[#B45309] dark:text-[#E8A33D]">{adGroupsError}</span>
        )}
      </div>

      {selectedIsIncompatible && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-300" />
          <div>
            <p className="font-semibold text-amber-900 dark:text-amber-100">
              This campaign cannot post an image asset
            </p>
            <p className="mt-1 text-xs text-amber-800 dark:text-amber-100/80">
              {selectedCampaignRow?.disabledReason || "Only Display campaigns can post an image asset. Please select a Display campaign."}
            </p>
          </div>
        </div>
      )}

        </>
      )}

      {/* Google's own button + landing page. Same two fields the Meta tab
          asks for, answered separately per platform. Shown in BOTH modes —
          a template carries a destination, but this is the one the user just
          typed for this brief, so it overlays the template's. */}
      <DestinationFields
        ctaButton={g.ctaButton}
        ctaUrl={g.ctaUrl}
        onChange={(patch) => onChange?.({ ...g, ...patch })}
        disabled={disabled}
        urlLabel="Destination URL"
      />

      <p className={FAINT}>
        Select your Google Ads customer account, campaign, and ad group. Only <span className="font-semibold text-gray-700 dark:text-white/80">Display</span> campaigns can post an image asset.
      </p>
    </div>
  );
}
