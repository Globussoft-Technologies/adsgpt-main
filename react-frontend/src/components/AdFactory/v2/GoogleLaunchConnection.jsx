import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { FcGoogle } from 'react-icons/fc';
import { toast } from 'react-toastify';

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
});

export const isGoogleAccountConnected = (googleUser) =>
  !!(googleUser?.email || googleUser?.googleId || googleUser?.sub || googleUser?._id);

// Ready to publish = OAuth connected, and all 3 required Google Ads fields are selected.
export const isGoogleConnectionComplete = (g, connected) => {
  if (!connected) return false;
  return Boolean(g?.adAccountId && g?.campaignId && g?.adGroupId);
};

export const buildGoogleTarget = (g, { dailyBudget, ctaUrl } = {}) => {
  if (!g?.adAccountId || !g?.campaignId || !g?.adGroupId) return null;

  return {
    adAccountId: g.adAccountId,
    campaignId: g.campaignId,
    adGroupId: g.adGroupId,
    customerId: g.customerId || g.adAccountId,
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

export default function GoogleLaunchConnection({ value, onChange, disabled = false }) {
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

      <p className={FAINT}>
        Select your Google Ads customer account, campaign, and ad group. Only <span className="font-semibold text-gray-700 dark:text-white/80">Display</span> campaigns can post an image asset.
      </p>
    </div>
  );
}
