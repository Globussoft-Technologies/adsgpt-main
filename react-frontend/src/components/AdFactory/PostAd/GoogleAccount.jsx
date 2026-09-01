import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronLeft, Rocket, Loader2 } from 'lucide-react';
import { useDispatch, useSelector } from 'react-redux';
import {
  fetchGoogleAdAccounts,
  fetchGoogleCampaigns,
  fetchGoogleAdGroups,
  launchGoogleAd,
} from '@/store/actions/adFactoryNew/adFactoryActions';
import InputCommonDropdown from '../NodeForms/InputCommonDropdown';
import GoogleAdCarousel from './GoogleAdCarousel';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';

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

const GoogleDropdown = ({ label, options = [], value, onChange, disabled = false, loading = false }) => {
  const selected = options.find((o) => o.value === value);

  return (
    <Select value={value} onValueChange={onChange} disabled={disabled || loading}>
      <SelectTrigger
        className={`group relative flex h-10! w-full items-center gap-0 rounded-full bg-gray-100 px-4! py-2.5 text-base text-gray-900 shadow-none backdrop-blur-md transition duration-200 ease-in outline-none hover:bg-black/5 md:text-[11px] 2xl:h-12.25! 2xl:py-4.5 dark:bg-[#383838]/50 dark:border-none dark:text-[#AFAFAF] dark:hover:bg-slate-100/10 ${disabled || loading ? 'cursor-not-allowed opacity-50' : ''}`}
        disabled={disabled || loading}
      >
        {loading ? (
          <span className="flex items-center gap-2 text-sm font-light dark:text-[#afafaf]">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading...
          </span>
        ) : (
          <span className="text-sm font-light dark:text-[#afafaf] dark:group-data-[state=open]:text-white">
            {selected?.label || label}
          </span>
        )}
      </SelectTrigger>

      <SelectContent className="backdrop-blur-100 z-9999 min-w-[400px] border border-gray-200 bg-white text-gray-800 shadow-xl dark:border-white/20 dark:bg-[#0D0D0D]/90 dark:text-white">
        <div className="flex flex-col 2xl:gap-1">
          {options.length === 0 ? (
            <div className="m-3 h-8 w-full text-center text-sm text-gray-500 dark:text-gray-300">No options found</div>
          ) : (
            options.map((option) => {
              const isSelected = value === option.value;
              return (
                <SelectItem
                  key={option.value}
                  value={option.value}
                  className={`cursor-pointer pr-4! text-base hover:bg-[#DFDFDF] dark:font-normal dark:text-[#AFAFAF] dark:hover:bg-[#0D0D0D]/30 dark:hover:text-white ${isSelected ? 'dark:bg-[#0D0D0D]/50' : 'bg-transparent'} focus:bg-transparent focus:text-inherit`}
                >
                  <div className="flex w-full items-center py-1">
                    <div className="flex flex-col">
                      <span className={`text-base font-semibold group-hover:text-white ${isSelected ? 'text-gray-900 dark:text-white' : 'dark:text-inherit'}`}>
                        {option.label}
                      </span>
                      {option.sub && (
                        <span className="text-xs text-gray-400">{option.sub}</span>
                      )}
                    </div>
                    <div className="absolute right-2 ml-auto flex items-center pr-1">
                      <span className={`flex h-4 w-4 items-center justify-center rounded-full border ${isSelected ? 'border-[#575757] dark:bg-[#575757]' : 'border-[#AFAFAF]'}`}>
                        {isSelected && <div className="h-1.5 w-1.5 rounded-full dark:bg-white" />}
                      </span>
                    </div>
                  </div>
                </SelectItem>
              );
            })
          )}
        </div>
      </SelectContent>
    </Select>
  );
};

const GoogleCampaignDropdown = ({ label, options = [], value, onChange, disabled = false, loading = false }) => {
  const selected = options.find((o) => o.value === value);

  return (
    <Select value={value} onValueChange={onChange} disabled={disabled || loading}>
      <SelectTrigger
        className={`group relative flex h-10! w-full items-center gap-0 rounded-full bg-gray-100 px-4! py-2.5 text-base text-gray-900 shadow-none backdrop-blur-md transition duration-200 ease-in outline-none hover:bg-black/5 md:text-[11px] 2xl:h-12.25! 2xl:py-4.5 dark:bg-[#383838]/50 dark:border-none dark:text-[#AFAFAF] dark:hover:bg-slate-100/10 ${disabled || loading ? 'cursor-not-allowed opacity-50' : ''}`}
        disabled={disabled || loading}
      >
        {loading ? (
          <span className="flex items-center gap-2 text-sm font-light dark:text-[#afafaf]">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading campaigns…
          </span>
        ) : (
          <span className="text-sm font-light dark:text-[#afafaf] dark:group-data-[state=open]:text-white">
            {selected?.label || label}
          </span>
        )}
      </SelectTrigger>

      <SelectContent className="backdrop-blur-100 z-9999 min-w-[400px] border border-gray-200 bg-white text-gray-800 shadow-xl dark:border-white/20 dark:bg-[#0D0D0D]/90 dark:text-white">
        <div className="flex flex-col 2xl:gap-1">
          {options.length === 0 ? (
            <div className="m-3 h-8 w-full text-center text-sm text-gray-500 dark:text-gray-300">No options found</div>
          ) : (
            options.map((option) => {
              const isSelected = value === option.value;
              return (
                <SelectItem
                  key={option.value}
                  value={option.value}
                  disabled={option.disabled}
                  title={option.disabled ? option.disabledReason : undefined}
                  className={`cursor-pointer pr-4! text-base hover:bg-[#DFDFDF] dark:font-normal dark:text-[#AFAFAF] dark:hover:bg-[#0D0D0D]/30 dark:hover:text-white ${
                    option.disabled ? 'cursor-not-allowed opacity-40' : isSelected ? 'dark:bg-[#0D0D0D]/50' : 'bg-transparent'
                  } focus:bg-transparent focus:text-inherit`}
                >
                  <div className="flex w-full items-center justify-between gap-3 py-1">
                    <span className={`truncate text-sm font-medium ${option.disabled ? 'text-gray-400 dark:text-gray-500' : 'text-gray-900 dark:text-white'}`}>
                      {option.label}
                    </span>
                    <span
                      className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                        option.channelType === 'DISPLAY'
                          ? 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-400/30 dark:bg-blue-400/10 dark:text-blue-300'
                          : 'border-gray-200 bg-gray-100 text-gray-500 dark:border-white/10 dark:bg-white/5 dark:text-white/55'
                      }`}
                    >
                      {option.channelLabel}
                    </span>
                  </div>
                </SelectItem>
              );
            })
          )}
        </div>
      </SelectContent>
    </Select>
  );
};

const SectionContainer = ({ children, title, subtitle }) => (
  <div className="relative w-full">
    <div className="pointer-events-none absolute -inset-px rounded-2xl border border-black/10 opacity-50 dark:border-white/5" />
    <div className="mb-6">
      <h2 className="text-lg font-semibold text-gray-900 2xl:text-xl dark:text-white">{title}</h2>
      {subtitle && <p className="mt-0.5 text-xs text-gray-400 2xl:mt-1 2xl:text-sm">{subtitle}</p>}
    </div>
    {children}
  </div>
);

const GoogleAccount = ({ onBack }) => {
  const dispatch = useDispatch();
  const { googleUser, googleAdAccounts, googleCampaigns, googleAdGroups } = useSelector(
    (state) => state.adFactoryNew
  );

  const [selectedAccount, setSelectedAccount] = useState('');
  const [selectedCampaign, setSelectedCampaign] = useState('');
  const [selectedAdGroup, setSelectedAdGroup] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);
  const [loadingAdGroups, setLoadingAdGroups] = useState(false);

  useEffect(() => {
    if (googleUser?._id) {
      setLoadingAccounts(true);
      dispatch(fetchGoogleAdAccounts(googleUser._id)).finally(() => setLoadingAccounts(false));
    }
  }, [dispatch, googleUser]);

  const accountOptions = useMemo(
    () =>
      (googleAdAccounts || []).map((a) => ({
        value: a.id,
        label: a.name,
      })),
    [googleAdAccounts]
  );

  const campaignOptions = useMemo(
    () =>
      (googleCampaigns || []).map((c) => {
        const channelType = c.channelType || c.advertisingChannelType || null;
        const compatible = channelType === 'DISPLAY';
        return {
          value: c.id || c.campaignId,
          label: c.name || c.campaignName,
          channelLabel: channelHumanName(channelType),
          channelType,
          disabled: !compatible,
          disabledReason: compatible
            ? undefined
            : channelType
              ? `Not compatible — ${channelHumanName(channelType)} campaigns can't post an image asset. Pick a Display campaign instead.`
              : `Missing campaign type — can't determine compatibility. Refresh the list or pick a Display campaign.`,
        };
      }),
    [googleCampaigns]
  );

  const selectedCampaignRow = useMemo(
    () => campaignOptions.find((c) => c.value === selectedCampaign) || null,
    [campaignOptions, selectedCampaign]
  );
  const selectedIsIncompatible = Boolean(
    selectedCampaign && selectedCampaignRow?.disabled
  );

  const adGroupOptions = useMemo(
    () =>
      (googleAdGroups || []).map((g) => ({
        value: String(g.id || g.adGroupId),
        label: g.name || g.adGroupName || String(g.id || g.adGroupId),
      })),
    [googleAdGroups]
  );

  const handleAccountChange = (accountId) => {
    setSelectedAccount(accountId);
    setSelectedCampaign('');
    setSelectedAdGroup('');
    if (accountId) {
      setLoadingCampaigns(true);
      dispatch(fetchGoogleCampaigns({ adAccountId: accountId })).finally(() => setLoadingCampaigns(false));
    }
  };

  const handleCampaignChange = (campaignId) => {
    setSelectedCampaign(campaignId);
    setSelectedAdGroup('');
    if (campaignId && selectedAccount) {
      setLoadingAdGroups(true);
      dispatch(fetchGoogleAdGroups({ adAccountId: selectedAccount, campaignId })).finally(() => setLoadingAdGroups(false));
    }
  };

  const { postnodecreatives: allCreatives } = useSelector((state) => state.adFactoryNew);
  const postnodecreatives = (allCreatives || []).filter((c) => c.platform === 'google');

  const canLaunch =
    Boolean(selectedAccount) &&
    Boolean(selectedCampaign) &&
    Boolean(selectedAdGroup) &&
    !selectedIsIncompatible &&
    postnodecreatives.length > 0;

  const handleLaunch = async () => {
    if (!canLaunch) return;
    setIsLoading(true);
    try {
      const payload = {
        adAccountId: selectedAccount,
        adGroupId: selectedAdGroup,
        campaignId: selectedCampaign,
        ads: postnodecreatives.map((c) => ({
          headline: c.headline,
          description: c.message || c.description || '',
          finalUrl: c.linkUrl,
          imageUrl: c.imageUrl || '',
          callToAction: c.callToAction || '',
        })),
      };
      await dispatch(launchGoogleAd(payload)).unwrap();
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="h-full w-full">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="mb-4 flex items-center gap-1.5 text-sm text-gray-400 transition-colors hover:text-black dark:hover:text-white"
        >
          <ChevronLeft className="h-4 w-4" />
          Back to platforms
        </button>
      )}

      <div className="scrollbar_contents flex w-full flex-col gap-6">
        <SectionContainer
          title="Google Ads Account"
          subtitle="Select your Google Ads customer account, campaign, and ad group. Only Display campaigns can post an image asset."
        >
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <div className="flex flex-col gap-2">
              <label className="text-sm text-gray-500 2xl:text-[18px] dark:text-[#AFAFAF]">
                Select Ad Account *
              </label>
              <GoogleDropdown
                label="Choose Ad Account"
                options={accountOptions}
                value={selectedAccount}
                onChange={handleAccountChange}
                loading={loadingAccounts}
              />
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-sm text-gray-500 2xl:text-[18px] dark:text-[#AFAFAF]">
                Select Campaign *
              </label>
              <GoogleCampaignDropdown
                label={!selectedAccount ? 'Pick an ad account first' : 'Choose Campaign'}
                options={campaignOptions}
                value={selectedCampaign}
                onChange={handleCampaignChange}
                disabled={!selectedAccount}
                loading={loadingCampaigns}
              />
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-sm text-gray-500 2xl:text-[18px] dark:text-[#AFAFAF]">
                Select Ad Group *
              </label>
              <GoogleDropdown
                label={
                  !selectedCampaign
                    ? 'Pick a campaign first'
                    : loadingAdGroups
                      ? 'Loading ad groups…'
                      : adGroupOptions.length === 0
                        ? 'No ad groups found'
                        : 'Choose Ad Group'
                }
                options={adGroupOptions}
                value={selectedAdGroup}
                onChange={setSelectedAdGroup}
                disabled={!selectedCampaign || selectedIsIncompatible || loadingAdGroups}
                loading={loadingAdGroups}
              />
            </div>
          </div>

          {selectedIsIncompatible && (
            <div className="mt-4 flex items-start gap-3 rounded-lg border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-100">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-300" />
              <div>
                <p className="font-semibold text-amber-900 dark:text-amber-100">
                  This campaign cannot post an image asset
                </p>
                <p className="mt-1 text-xs text-amber-800 dark:text-amber-100/80">
                  {selectedCampaignRow?.disabledReason || 'Only Display campaigns can post an image asset. Please select a Display campaign.'}
                </p>
              </div>
            </div>
          )}
        </SectionContainer>

        {/* Google Ad Carousel */}
        <GoogleAdCarousel />
      </div>

      <div className="mt-6 flex justify-end gap-4">
        <button
          onClick={handleLaunch}
          disabled={!canLaunch || isLoading}
          className={`flex items-center justify-center gap-2 rounded-lg px-6 py-3 text-sm font-semibold transition 2xl:px-12 2xl:text-base ${
            canLaunch && !isLoading
              ? 'bg-gray-900 text-white hover:opacity-90 dark:bg-white dark:text-black'
              : 'cursor-not-allowed bg-gray-400 text-gray-700'
          }`}
        >
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <>
              <Rocket className="h-4 w-4" />
              Launch Ads
            </>
          )}
        </button>
      </div>
    </div>
  );
};

export default GoogleAccount;
