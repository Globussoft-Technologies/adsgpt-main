import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, Rocket, Loader2 } from 'lucide-react';
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

      <SelectContent className="backdrop-blur-100 z-9999 min-w-[400px] border dark:border-white/20 dark:bg-[#0D0D0D]/50 dark:text-white">
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
      googleAdAccounts.map((a) => ({
        value: a.id,
        label: a.name,
      })),
    [googleAdAccounts]
  );

  const campaignOptions = useMemo(
    () => googleCampaigns.map((c) => ({ value: c.id, label: c.name })),
    [googleCampaigns]
  );

  const adGroupOptions = useMemo(
    () => googleAdGroups.map((g) => ({ value: g.id, label: g.name })),
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
  const postnodecreatives = allCreatives.filter((c) => c.platform === 'google');

  const canLaunch =
    Boolean(selectedAccount) &&
    Boolean(selectedCampaign) &&
    Boolean(selectedAdGroup) &&
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
          subtitle="Select your Google Ads customer account, campaign, and ad group"
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
              <GoogleDropdown
                label="Choose Campaign"
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
                label="Choose Ad Group"
                options={adGroupOptions}
                value={selectedAdGroup}
                onChange={setSelectedAdGroup}
                disabled={!selectedCampaign}
                loading={loadingAdGroups}
              />
            </div>
          </div>
        </SectionContainer>

        {/* Google Ad Carousel */}
        <GoogleAdCarousel />
      </div>

      <div className="flex justify-end gap-4">
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
