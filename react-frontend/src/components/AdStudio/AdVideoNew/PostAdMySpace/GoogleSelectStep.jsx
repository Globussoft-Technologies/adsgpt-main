import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { useDispatch, useSelector } from 'react-redux';
import {
  fetchGoogleAdAccounts,
  fetchGoogleAdGroups,
  fetchGoogleCampaigns,
} from '@/store/actions/adFactoryNew/adFactoryActions';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// Channel types we can post a MySpace asset into. SEARCH has no asset
// slot; PERFORMANCE_MAX / SHOPPING / MULTI_CHANNEL aren't supported by
// the create-ad API.
//
// Videos accept BOTH `VIDEO` and `DEMAND_GEN` — the Google Ads API no
// longer allows creating ads on raw VIDEO campaigns, so newer campaigns
// arrive as DEMAND_GEN. Older ones may still report VIDEO. Treat both
// as the same target.
const compatibleChannelsFor = (isVideo) =>
  isVideo ? ['VIDEO', 'DEMAND_GEN'] : ['DISPLAY'];

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

// Generic dropdown for Ad Account / Ad Group — value/label only, no
// per-item disabled (those lists are always fully usable). The campaign
// picker below uses a richer variant that handles per-row disabled +
// tooltip for channel-type gating.
function PlainDropdown({ value, onChange, options, placeholder, disabled }) {
  const selected = options.find((o) => o.value === value);
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger
        className={`group relative flex h-10! w-full items-center gap-0 rounded-full bg-[#383838]/50 px-4! py-2.5 text-base text-white shadow-none backdrop-blur-md transition duration-200 ease-in outline-none placeholder:text-base placeholder:text-[#AFAFAF] hover:bg-slate-100/10 md:text-[11px] 2xl:h-[49px]! 2xl:py-[18px] dark:border-none dark:text-[#AFAFAF] ${
          disabled ? 'cursor-not-allowed opacity-50' : ''
        }`}
        disabled={disabled}
      >
        <SelectValue placeholder={placeholder}>
          {selected?.label ?? placeholder}
        </SelectValue>
      </SelectTrigger>
      <SelectContent className="backdrop-blur-100 z-9999 min-w-[300px] border dark:border-white/20 dark:bg-[#0D0D0D]/50 dark:text-white">
        {options.length === 0 ? (
          <div className="m-3 h-8 w-full text-center text-sm text-gray-300">No options found</div>
        ) : (
          options.map((opt) => (
            <SelectItem
              key={opt.value}
              value={opt.value}
              className="cursor-pointer pr-4! text-base dark:font-normal dark:text-[#AFAFAF] dark:hover:bg-[#0D0D0D]/30 dark:hover:text-white"
            >
              {opt.label}
            </SelectItem>
          ))
        )}
      </SelectContent>
    </Select>
  );
}

// Campaign-specific dropdown — supports per-row `disabled` (with a
// `disabledReason` rendered as a native browser tooltip so the user
// understands why they can't pick it). Selecting a disabled row is
// blocked by Radix's SelectItem disabled prop.
function CampaignDropdown({ value, onChange, options, placeholder, disabled }) {
  const selected = options.find((o) => o.value === value);
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger
        className={`group relative flex h-10! w-full items-center gap-0 rounded-full bg-[#383838]/50 px-4! py-2.5 text-base text-white shadow-none backdrop-blur-md transition duration-200 ease-in outline-none placeholder:text-base placeholder:text-[#AFAFAF] hover:bg-slate-100/10 md:text-[11px] 2xl:h-[49px]! 2xl:py-[18px] dark:border-none dark:text-[#AFAFAF] ${
          disabled ? 'cursor-not-allowed opacity-50' : ''
        }`}
        disabled={disabled}
      >
        <SelectValue placeholder={placeholder}>
          {selected?.label ?? placeholder}
        </SelectValue>
      </SelectTrigger>
      <SelectContent className="backdrop-blur-100 z-9999 min-w-[360px] border dark:border-white/20 dark:bg-[#0D0D0D]/50 dark:text-white">
        {options.length === 0 ? (
          <div className="m-3 h-8 w-full text-center text-sm text-gray-300">No options found</div>
        ) : (
          options.map((opt) => (
            <SelectItem
              key={opt.value}
              value={opt.value}
              disabled={opt.disabled}
              // Native browser tooltip — keeps the implementation light
              // and accessible by default. Hover the row to see why an
              // incompatible campaign is greyed out.
              title={opt.disabled ? opt.disabledReason : undefined}
              className={`cursor-pointer pr-4! text-base dark:font-normal dark:text-[#AFAFAF] dark:hover:bg-[#0D0D0D]/30 dark:hover:text-white ${
                opt.disabled ? 'cursor-not-allowed opacity-40' : ''
              }`}
            >
              <div className="flex w-full items-center justify-between gap-3">
                <span className="truncate">{opt.label}</span>
                <span className="shrink-0 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-wider text-white/55">
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

// Mirrors MySpaceSelectStep — 3 dropdowns (Ad Account → Campaign → Ad
// Group), with channel-type gating on the campaign picker driven by
// `payload.isVideo`. Next enables only when all three are picked AND
// the campaign is compatible.
export default function GoogleSelectStep({ payload, onBack, onNext }) {
  const dispatch = useDispatch();
  const { googleUser, googleAdAccounts = [], googleCampaigns = [], googleAdGroups = [] } =
    useSelector((state) => state.adFactoryNew || {});

  const isVideo = Boolean(payload?.isVideo);
  const neededChannels = useMemo(() => compatibleChannelsFor(isVideo), [isVideo]);
  // Human-readable list of accepted channels for use in copy ("Video or
  // Demand Gen" / "Display"). useMemo so the dep array on the campaign
  // options stays stable.
  const neededHuman = useMemo(
    () => neededChannels.map(channelHumanName).join(' or '),
    [neededChannels],
  );

  const [selectedAccount, setSelectedAccount] = useState('');
  const [selectedCampaign, setSelectedCampaign] = useState('');
  const [selectedAdGroup, setSelectedAdGroup] = useState('');

  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);
  const [loadingAdGroups, setLoadingAdGroups] = useState(false);

  // Hydrate the ad-account list if Redux hasn't seen it yet. The modal
  // also fires this on open, but we self-protect for direct mounts.
  useEffect(() => {
    if (googleUser?._id && googleAdAccounts.length === 0) {
      setLoadingAccounts(true);
      dispatch(fetchGoogleAdAccounts(googleUser._id)).finally(() =>
        setLoadingAccounts(false),
      );
    }
  }, [dispatch, googleUser?._id, googleAdAccounts.length]);

  const accountOptions = useMemo(
    () => googleAdAccounts.map((a) => ({ value: a.id, label: a.name })),
    [googleAdAccounts],
  );

  // Campaign rows carry `channelType` (added by getCampaignsByCustomer
  // on the backend). We always show every campaign but disable the
  // ones that don't fit this asset, with a tooltip explaining why.
  const campaignOptions = useMemo(
    () =>
      googleCampaigns.map((c) => {
        const channelType = c.channelType || c.advertisingChannelType || null;
        const compatible = neededChannels.includes(channelType);
        return {
          value: c.id,
          label: c.name,
          channelLabel: channelHumanName(channelType),
          channelType,
          disabled: !compatible,
          disabledReason: compatible
            ? undefined
            : channelType
              ? `Not compatible — ${channelHumanName(channelType)} campaigns can't post a ${isVideo ? 'video' : 'image'} asset. Pick a ${neededHuman} campaign instead.`
              : `Missing campaign type — can't determine compatibility. Refresh the list or pick a ${neededHuman} campaign.`,
        };
      }),
    [googleCampaigns, neededChannels, neededHuman, isVideo],
  );

  const adGroupOptions = useMemo(
    () => googleAdGroups.map((g) => ({ value: g.id, label: g.name })),
    [googleAdGroups],
  );

  // The selected campaign's compatibility — derived so the Next-button
  // gate and the inline warning banner stay in sync.
  const selectedCampaignRow = useMemo(
    () => campaignOptions.find((c) => c.value === selectedCampaign) || null,
    [campaignOptions, selectedCampaign],
  );
  const selectedIsIncompatible = Boolean(
    selectedCampaign && selectedCampaignRow?.disabled,
  );

  const onAccountChange = useCallback(
    (accountId) => {
      setSelectedAccount(accountId);
      setSelectedCampaign('');
      setSelectedAdGroup('');
      if (accountId) {
        setLoadingCampaigns(true);
        dispatch(fetchGoogleCampaigns({ adAccountId: accountId })).finally(() =>
          setLoadingCampaigns(false),
        );
      }
    },
    [dispatch],
  );

  const onCampaignChange = useCallback(
    (campaignId) => {
      setSelectedCampaign(campaignId);
      setSelectedAdGroup('');
      if (campaignId && selectedAccount) {
        setLoadingAdGroups(true);
        dispatch(
          fetchGoogleAdGroups({ adAccountId: selectedAccount, campaignId }),
        ).finally(() => setLoadingAdGroups(false));
      }
    },
    [dispatch, selectedAccount],
  );

  const canNext =
    Boolean(selectedAccount) &&
    Boolean(selectedCampaign) &&
    Boolean(selectedAdGroup) &&
    !selectedIsIncompatible;

  return (
    <div className="flex h-full w-full flex-col gap-6">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="flex w-fit items-center gap-1.5 text-sm text-gray-400 transition-colors hover:text-white"
        >
          <ChevronLeft className="h-4 w-4" />
          Back to platforms
        </button>
      )}

      <div>
        <h2 className="text-lg font-semibold text-white 2xl:text-xl">
          Google Ads Account
        </h2>
        <p className="mt-0.5 text-xs text-gray-400 2xl:mt-1 2xl:text-sm">
          Select your Google Ads customer account, campaign, and ad group.
          Only <span className="text-white/75">{neededHuman}</span> campaigns can post a {isVideo ? 'video' : 'image'} asset.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3 2xl:gap-8">
        <div className="flex flex-col gap-2">
          <label className="text-sm text-[#AFAFAF] 2xl:text-[18px]">
            Select Ad Account *
          </label>
          <PlainDropdown
            value={selectedAccount}
            onChange={onAccountChange}
            options={accountOptions}
            placeholder={
              loadingAccounts
                ? 'Loading ad accounts…'
                : accountOptions.length === 0
                  ? 'No ad accounts'
                  : 'Choose Ad Account'
            }
            disabled={loadingAccounts || accountOptions.length === 0}
          />
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm text-[#AFAFAF] 2xl:text-[18px]">
            Select Campaign *
          </label>
          <CampaignDropdown
            value={selectedCampaign}
            onChange={onCampaignChange}
            options={campaignOptions}
            placeholder={
              !selectedAccount
                ? 'Pick an ad account first'
                : loadingCampaigns
                  ? 'Loading campaigns…'
                  : campaignOptions.length === 0
                    ? 'No campaigns on this account'
                    : 'Choose Campaign'
            }
            disabled={!selectedAccount || loadingCampaigns}
          />
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm text-[#AFAFAF] 2xl:text-[18px]">
            Select Ad Group *
          </label>
          <PlainDropdown
            value={selectedAdGroup}
            onChange={setSelectedAdGroup}
            options={adGroupOptions}
            placeholder={
              !selectedCampaign
                ? 'Pick a campaign first'
                : loadingAdGroups
                  ? 'Loading ad groups…'
                  : adGroupOptions.length === 0
                    ? 'No ad groups on this campaign'
                    : 'Choose Ad Group'
            }
            disabled={!selectedCampaign || loadingAdGroups}
          />
        </div>
      </div>

      {/* Inline warning if the user managed to pick an incompatible
          campaign (e.g. Radix race, or the list updated mid-flow). The
          dropdown already disables those rows so this rarely fires,
          but it's a belt-and-suspenders gate matching `canNext`. */}
      {selectedIsIncompatible && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
          <div>
            <p className="font-semibold text-amber-100">
              This campaign can&apos;t post a {isVideo ? 'video' : 'image'} asset
            </p>
            <p className="mt-1 text-xs text-amber-100/80">
              {selectedCampaignRow?.disabledReason}
            </p>
          </div>
        </div>
      )}

      <div className="mt-2 flex justify-end">
        <button
          type="button"
          disabled={!canNext}
          onClick={() =>
            onNext({
              adAccountId: selectedAccount,
              campaignId: selectedCampaign,
              adGroupId: selectedAdGroup,
              // Pass the raw channel type from the campaign row — used
              // by the compose step (and backend) to know whether this
              // is DEMAND_GEN, VIDEO, DISPLAY, etc. without re-deriving.
              channelType: selectedCampaignRow?.channelType || neededChannels[0],
            })
          }
          className={`flex items-center gap-2 rounded-lg px-6 py-2.5 text-sm font-semibold transition 2xl:px-10 2xl:py-3 2xl:text-base ${
            canNext
              ? 'bg-white text-black hover:opacity-90'
              : 'cursor-not-allowed bg-gray-400/30 text-gray-400'
          }`}
        >
          Next
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* The dispatch helpers don't expose `loading` from Redux, so the
          local state above is the source of truth — surface it via a
          tiny inline spinner when any of the three is in flight. */}
      {(loadingAccounts || loadingCampaigns || loadingAdGroups) && (
        <span className="sr-only" aria-live="polite">
          <Loader2 className="inline h-3 w-3 animate-spin" /> Loading…
        </span>
      )}
    </div>
  );
}
