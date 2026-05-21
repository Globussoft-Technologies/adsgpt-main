import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { getLeadForms, getMetaPages } from '@/apis/metaAds/metaAdsApi';
import { Wallet, Users, Check, AlertTriangle, Info, Rocket, Loader2, ChevronLeft } from 'lucide-react';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import InputCommonDropdown from '../NodeForms/InputCommonDropdown';

import FbAdCarousel from './FbAdCarousel';
import { useDispatch, useSelector } from 'react-redux';
import {
  fetchAdsets,
  fetchCampaign,
  fetchCampaignById,
  launchcampaign,
} from '@/store/actions/adFactoryNew/adFactoryActions';
import { Formik, Form } from 'formik';
import * as Yup from 'yup';
import { useSearchParams } from 'react-router-dom';
import {
  setCompletedNodes,
  updateNodeEnabledStatus,
} from '@/store/reducers/AdFactory/AdFactorySlice';

const validationSchema = Yup.object({
  selectedAccount: Yup.string().required('Ad Account is required'),
  selectedPage: Yup.string().required('Facebook Page is required'),
  selectedCampaign: Yup.string().required('Campaign is required'),
  selectedAdSet: Yup.string().required('Ad Set is required'),
});

// Gates posting ads to Leads campaigns. The Meta `pages_manage_ads`
// permission (required to attach a lead_gen_form_id to a creative + to
// read the leadgen_forms edge) is under review for the AdsGPT app —
// production stays OFF until Meta approves. The backend's
// adControllerV2.js mirrors this gate so the two paths can't disagree.
// Flip `VITE_FEATURE_LEADS_POSTING=true` in the env once Meta approves.
const LEADS_POSTING_ENABLED =
  import.meta.env.VITE_FEATURE_LEADS_POSTING === 'true';







const FbCustomDropdown = ({
  label = '',
  options = [],
  value,
  onChange,
  disabled = false,
  type = 'account', // 'account' | 'page'
}) => {
  const selectedValue = options?.find((option) => option.id === value) || null;

  return (
    <Select
      value={value}
      onValueChange={(val) => {
        if (onChange) {
          onChange(val);
        }
      }}
      disabled={disabled}
    >
      <SelectTrigger
        className={`group relative flex h-10! w-full items-center gap-0 rounded-full bg-[#383838]/50 px-4! py-2.5 text-base text-white shadow-none backdrop-blur-md transition duration-200 ease-in outline-none placeholder:text-base placeholder:text-[#AFAFAF] hover:bg-slate-100/10 md:text-[11px] 2xl:h-[49px]! 2xl:py-[18px] dark:border-none dark:text-[#AFAFAF] ${
          disabled ? 'cursor-not-allowed opacity-50' : ''
        }`}
        disabled={disabled}
      >
        <div className="flex items-center gap-2 pr-1 capitalize 2xl:gap-1.5">
          {type === 'page' && selectedValue?.image && (
            <img
              src={selectedValue.image}
              alt="selected page"
              className="h-6 w-6 rounded-full object-cover"
            />
          )}
          <span className="text-sm font-light 2xl:text-base dark:text-[#afafaf] dark:group-data-[state=open]:text-white">
            {selectedValue?.name || label}
          </span>
        </div>
      </SelectTrigger>

      <SelectContent className="backdrop-blur-100 z-9999 min-w-[300px] border dark:border-white/20 dark:bg-[#0D0D0D]/50 dark:text-white">
        <div className="fb_account_ready flex flex-col 2xl:gap-1">
          {options?.length === 0 ? (
            <div className="bg-black-500 2xl:text-15 m-3 h-8 w-full text-center text-sm text-gray-300">
              No options found
            </div>
          ) : (
            options?.map((option) => {
              const isSelected = value === option.id;

              return (
                <SelectItem
                  key={option.id}
                  value={option.id}
                  className={`group cursor-pointer pr-4! text-base hover:bg-[#DFDFDF] dark:font-normal dark:text-[#AFAFAF] dark:hover:bg-[#0D0D0D]/30 dark:hover:text-white ${
                    isSelected ? 'dark:bg-[#0D0D0D]/50' : 'bg-transparent'
                  } focus:bg-transparent focus:text-inherit`}
                  disabled={disabled}
                >
                  <div className="flex w-full items-center py-1">
                    {/* Left Column: All Meta Content */}
                    <div className="flex items-center gap-3">
                      {type === 'page' && (
                        <div className="h-10 w-10 shrink-0">
                          <img
                            src={option.image}
                            alt={option.name}
                            className="h-full w-full rounded-full object-cover ring-2 ring-white/10"
                          />
                        </div>
                      )}

                      <div className="flex flex-col gap-0">
                        <span
                          className={`text-base font-semibold group-hover:text-white ${isSelected ? 'text-white' : 'dark:text-inherit'}`}
                        >
                          {option.name}
                        </span>
                        {type === 'account' && (
                          <div className="mt-1 flex flex-col gap-0.5 text-xs">
                            {/* Line 1: Status + Currency */}
                            <div className="flex items-center gap-2">
                              <span
                                className={`h-1.5 w-1.5 rounded-full ${option.isActive ? 'bg-blue-500' : 'bg-gray-500'}`}
                              />
                              <span className={option.isActive ? 'text-blue-400' : 'text-gray-400'}>
                                {option.isActive ? 'Active' : 'Inactive'}
                              </span>
                              <span className="rounded bg-white/10 px-1.5 py-0.5 text-gray-300">
                                {option.currency}
                              </span>
                              <div className="text-red-400">Spent: {option.spent}</div>
                            </div>
                          </div>
                        )}
                        {type === 'page' && (
                          <span className="text-sm text-gray-400 group-hover:text-gray-300">
                            {option.category}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Right Column: Custom Selection Disc */}
                    <div className="absolute right-2 ml-auto flex items-center pr-1">
                      <span
                        className={`flex h-4 w-4 items-center justify-center rounded-full border ${
                          isSelected ? 'border-[#575757] dark:bg-[#575757]' : 'border-[#AFAFAF]'
                        }`}
                      >
                        {isSelected && (
                          <div className="h-[6px] w-[6px] rounded-full dark:bg-white" />
                        )}
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
    {/* Glow effect */}
    <div className="pointer-events-none absolute -inset-px rounded-2xl border border-white/5 opacity-50" />

    <div className="mb-6">
      <h2 className="text-lg font-semibold text-white 2xl:text-xl">{title}</h2>
      {subtitle && <p className="mt-0.5 text-xs text-gray-400 2xl:mt-1 2xl:text-sm">{subtitle}</p>}
    </div>
    {children}
  </div>
);

const TabButton = ({ isActive, onClick, children }) => (
  <button
    onClick={onClick}
    className={`flex-1 rounded-md py-2.5 text-base font-medium transition-all ${
      isActive
        ? 'bg-[#383838]/80 text-white shadow-sm'
        : 'text-gray-400 hover:bg-white/5 hover:text-white'
    }`}
  >
    {children}
  </button>
);

const InputField = ({
  label,
  placeholder,
  value,
  onChange,
  type = 'text',
  required = false,
  multiline = false,
  rows = 3,
}) => (
  <div className="flex flex-col gap-2">
    {label && (
      <label className="text-[18px] text-[#AFAFAF]">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
    )}
    <div
      className={`rounded-20 w-full bg-[#383838]/50 p-px backdrop-blur-md ${multiline ? '' : 'rounded-full'}`}
    >
      {multiline ? (
        <textarea
          className="w-full resize-none border border-white/10 bg-transparent px-5 py-3 text-base text-white outline-none placeholder:text-[#AFAFAF]"
          rows={rows}
          placeholder={placeholder}
          value={value}
          onChange={onChange}
        />
      ) : (
        <div className="input-gradient-border">
          <input
            type={type}
            className="h-[49px] w-full bg-transparent px-6 text-base text-white outline-none placeholder:text-[#AFAFAF]"
            placeholder={placeholder}
            value={value}
            onChange={onChange}
          />
        </div>
      )}
    </div>
  </div>
);

const FbAccountReady = ({ onBack }) => {
  // const [selectedAccount, setSelectedAccount] = useState('');
  // const [selectedPage, setSelectedPage] = useState('');
  // const [selectedCampaign, setSelectedCampaign] = useState('');
  // const [selectedAdSet, setSelectedAdSet] = useState('');
  // const {adAccDropdown,facebookPageDropDown}=useSelector((state)=>state.adFactoryNew)
  const [isloading, setisloading] = useState(false);
  // Lead Forms — only needed when the picked campaign is OUTCOME_LEADS.
  // Forms are scoped to a Facebook Page (Meta's `leadgen_forms` edge), so
  // we re-fetch whenever the picked Page changes for a Leads campaign.
  const [leadForms, setLeadForms] = useState([]);
  const [leadFormsLoading, setLeadFormsLoading] = useState(false);
  // Pages live in local state — fetched ad-account-scoped via the same
  // /meta-ads/get-pages endpoint the V2 wizard uses, so users only see
  // Pages assigned to the selected Ad Account (instead of all Pages they
  // have any access to, which the legacy /ad-posting/pages endpoint
  // returned).
  const [pages, setPages] = useState([]);
  const [pagesLoading, setPagesLoading] = useState(false);
  // Per-dropdown loading flags so each picker can show a spinner/label
  // while its list is being fetched.
  const [campaignsLoading, setCampaignsLoading] = useState(false);
  const [adsetsLoading, setAdsetsLoading] = useState(false);
  const dispatch = useDispatch();
  const { fbUser, postnodecreatives: allCreatives } = useSelector((state) => state.adFactoryNew);
  // Meta posts get Meta creatives only. A creative with no platform tag
  // is treated as Meta (legacy default); anything tagged 'google' belongs
  // on the Google posting screen, not here.
  const postnodecreatives = allCreatives.filter(
    (c) => !c.platform || c.platform === 'meta',
  );
  const [searchParams] = useSearchParams();
  const campaignId = searchParams.get('campaignId');
  // dispatch(fetchCampaignById)
  // console.log(fetchCampaignById)
  const {
    adAccDropdown = [],
    campaignsDropdown = [],
    adSetDropdown = [],
  } = useSelector((state) => state.adFactoryNew || {});

  // console.log("name:",adAccDropdown)

  // Meta returns amount_spent in MINOR currency units (paise / cents).
  // Display in major units with the account's currency code — e.g.
  // `INR 77,343.80` instead of the raw `7734380` that was showing.
  const formatSpent = (amountMinor, currency) => {
    const major = Number(amountMinor || 0) / 100;
    const formatted = major.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return `${currency || ''} ${formatted}`.trim();
  };

  const accountOptions = useMemo(() => {
    return adAccDropdown.map((account) => ({
      id: account.id,
      name: account.name,
      isActive: account.status === 1,
      currency: account.currency,
      spent: formatSpent(account.amountSpent, account.currency),
    }));
  }, [adAccDropdown]);

  // Pages now come from local state (ad-account-scoped fetch) instead of
  // the global Redux `facebookPageDropDown`, which was populated by the
  // legacy /ad-posting/pages endpoint and returned every Page the user
  // had access to.
  const facebookPageOptions = useMemo(() => {
    return pages.map((page) => ({
      id: page.id,
      name: page.name,
      category: page.category,
      followers: page.fanCount,
      image: page.picture,
    }));
  }, [pages]);

  // Fetch Pages assigned to the picked Ad Account. Uses the same
  // /meta-ads/get-pages endpoint the V2 wizard uses — it scopes results
  // to the ad account's owning business + falls back to /me/accounts for
  // personal ad accounts.
  const fetchPagesForAccount = useCallback(async (adAccountId) => {
    if (!adAccountId) {
      setPages([]);
      return;
    }
    setPagesLoading(true);
    try {
      const r = await getMetaPages(adAccountId);
      setPages(r?.pages || []);
    } catch {
      setPages([]);
    } finally {
      setPagesLoading(false);
    }
  }, []);

  const campaignOptions = useMemo(() => {
    return campaignsDropdown.map((c) => ({
      value: c.id,
      label: c.name,
    }));
  }, [campaignsDropdown]);

  const adSetOptions = useMemo(() => {
    return adSetDropdown.map((adset) => ({
      value: adset.id,
      label: adset.name,
    }));
  }, [adSetDropdown]);

  const leadFormOptions = useMemo(
    () => leadForms.map((f) => ({ value: f.id, label: f.name })),
    [leadForms],
  );

  // Pull lead forms for a Page. Used when a Leads campaign is picked and
  // again whenever the Page changes — the backend's /get-lead-forms scopes
  // results to a single Page (it uses a Page Access Token).
  const fetchLeadFormsForPage = useCallback(async (pageId) => {
    if (!pageId) {
      setLeadForms([]);
      return;
    }
    setLeadFormsLoading(true);
    try {
      const r = await getLeadForms(pageId);
      setLeadForms(r?.forms || []);
    } catch {
      setLeadForms([]);
    } finally {
      setLeadFormsLoading(false);
    }
  }, []);

  // Returns true iff the campaign with this id is a Leads campaign — the
  // backend's getCampaigns endpoint includes `objective` per campaign, so
  // no extra fetch is needed.
  const isLeadsCampaignId = useCallback(
    (campaignId) =>
      campaignsDropdown.some(
        (c) => c.id === campaignId && c.objective === 'OUTCOME_LEADS',
      ),
    [campaignsDropdown],
  );
  {
    /* Image Selection Section */
  }
  {
    /* <SectionContainer title="Choose Images" subtitle="Select one or more images for your ads">
        <div className="flex flex-col gap-6">
          <div className="grid grid-cols-2 gap-4 rounded-lg md:grid-cols-4">
            {mockSampleImages.map((img, idx) => (
              <div
                key={idx}
                onClick={() => toggleImageSelection(img)}
                className={`group relative aspect-video cursor-pointer overflow-hidden rounded-xl border transition-all duration-300 ${
                  selectedImages.includes(img)
                    ? 'border-[#6366f1] ring-2 ring-[#6366f1]/50'
                    : 'border-transparent hover:border-white/20'
                }`}
              >
                <img
                  src={img}
                  alt={`Sample ${idx}`}
                  className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
                />

                <div
                  className={`absolute inset-0 flex items-center justify-center bg-black/40 transition-opacity ${
                    selectedImages.includes(img) ? 'opacity-100' : 'opacity-0'
                  }`}
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#6366f1] text-white shadow-lg">
                    <Check className="h-5 w-5" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </SectionContainer> */
  }

  {
    /* Create Ad Form Section */
  }
  {
    /* <SectionContainer title="Create Facebook Ad">
        <div className="mb-8 flex flex-col gap-6">
          <h3 className="text-lg font-medium text-white">Campaign Settings</h3>
          <div className="flex w-full rounded-lg bg-[#1A1A1A]/80 p-1">
            <TabButton isActive={campaignTab === 'new'} onClick={() => setCampaignTab('new')}>
              Create New Campaign
            </TabButton>
            <TabButton
              isActive={campaignTab === 'existing'}
              onClick={() => setCampaignTab('existing')}
            >
              Select Existing Campaign
            </TabButton>
          </div>
          {campaignTab === 'new' ? (
            <div className="flex flex-col gap-6">
              <InputField
                label="Campaign Name"
                required
                placeholder="e.g., Summer Sale 2024"
                value={campaignName}
                onChange={(e) => setCampaignName(e.target.value)}
              />
              <div className="flex flex-col gap-2">
                <label className="text-[18px] text-[#AFAFAF]">
                  Campaign Objective <span className="text-red-500">*</span>
                </label>
                <div className="input-gradient-border">
                  <InputCommonDropdown
                    value={campaignObjective}
                    onChange={setCampaignObjective}
                    options={[
                      { value: 'traffic', label: 'Traffic' },
                      { value: 'sales', label: 'Sales' },
                      { value: 'leads', label: 'Leads' },
                    ]}
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <label className="text-[18px] text-[#AFAFAF]">Select Existing Campaign</label>
              <div className="input-gradient-border">
                <InputCommonDropdown
                  value={''}
                  onChange={() => {}}
                  options={[{ value: 'c1', label: 'Existing Campaign 1' }]}
                  label="Select Campaign"
                />
              </div>
            </div>
          )}
        </div>
        <div className="mb-8 flex flex-col gap-6">
          <h3 className="text-lg font-medium text-white">Ad Set Settings</h3>
          <div className="flex w-full rounded-lg bg-[#1A1A1A]/80 p-1">
            <TabButton isActive={adSetTab === 'new'} onClick={() => setAdSetTab('new')}>
              Create New Ad Set
            </TabButton>
            <TabButton isActive={adSetTab === 'existing'} onClick={() => setAdSetTab('existing')}>
              Select Existing Ad Set
            </TabButton>
          </div>
          {adSetTab === 'new' ? (
            <div className="flex flex-col gap-6">
              <InputField
                label="Ad Set Name"
                required
                placeholder="e.g., US Audience 18-65"
                value={adSetName}
                onChange={(e) => setAdSetName(e.target.value)}
              />

              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <label className="text-[18px] text-[#AFAFAF]">Country (Code)</label>
                  <div className="input-gradient-border">
                    <InputCommonDropdown
                      value={countryCode}
                      onChange={setCountryCode}
                      options={[
                        { value: 'US', label: 'US' },
                        { value: 'IN', label: 'IN' },
                        { value: 'UK', label: 'UK' },
                      ]}
                    />
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-[18px] text-[#AFAFAF]">Age Range</label>
                  <div className="flex items-center gap-3">
                    <div className="w-full rounded-full bg-[#383838]/50 p-px backdrop-blur-md">
                      <div className="input-gradient-border">
                        <input
                          className="h-[49px] w-full bg-transparent px-5 text-center text-white outline-none placeholder:text-[#AFAFAF]"
                          placeholder="18"
                          value={ageMin}
                          onChange={(e) => setAgeMin(e.target.value)}
                        />
                      </div>
                    </div>
                    <span className="text-gray-400">-</span>
                    <div className="w-full rounded-full bg-[#383838]/50 p-px backdrop-blur-md">
                      <div className="input-gradient-border">
                        <input
                          className="h-[49px] w-full bg-transparent px-5 text-center text-white outline-none placeholder:text-[#AFAFAF]"
                          placeholder="65"
                          value={ageMax}
                          onChange={(e) => setAgeMax(e.target.value)}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <label className="text-[18px] text-[#AFAFAF]">Optimization Goal</label>
                  <div className="input-gradient-border">
                    <InputCommonDropdown
                      value={optimizationGoal}
                      onChange={setOptimizationGoal}
                      options={[
                        { value: 'link_clicks', label: 'Link Clicks' },
                        { value: 'impressions', label: 'Impressions' },
                      ]}
                    />
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-[18px] text-[#AFAFAF]">Billing Event</label>
                  <div className="input-gradient-border">
                    <InputCommonDropdown
                      value={billingEvent}
                      onChange={setBillingEvent}
                      options={[{ value: 'impressions', label: 'Impressions' }]}
                    />
                  </div>
                </div>
              </div>

              <InputField
                label="Bid Amount (Cents)"
                placeholder="100"
                value={bidAmount}
                onChange={(e) => setBidAmount(e.target.value)}
                type="number"
              />
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <label className="text-[18px] text-[#AFAFAF]">Select Existing Ad Set</label>
              <div className="input-gradient-border">
                <InputCommonDropdown
                  value={''}
                  onChange={() => {}}
                  options={[{ value: 'as1', label: 'Existing Ad Set 1' }]}
                  label="Select Ad Set"
                />
              </div>
            </div>
          )}
        </div>

        <div className="mb-8 flex flex-col gap-6 border-t border-white/10 pt-8">
          <h3 className="text-lg font-medium text-white">Ad Creative</h3>

          <InputField
            label="Headline"
            required
            placeholder="Grab attention with a compelling headline"
            value={headline}
            onChange={(e) => setHeadline(e.target.value)}
          />

          <div className="flex flex-col gap-2">
            <label className="text-[18px] text-[#AFAFAF]">Ad Text (Optional)</label>
            <textarea
              className="rounded-20 w-full resize-none border border-white/10 bg-[#383838]/50 p-4 text-base text-white backdrop-blur-md outline-none placeholder:text-[#AFAFAF]"
              rows={4}
              placeholder="Tell people more about your offer..."
              value={adText}
              onChange={(e) => setAdText(e.target.value)}
            />
          </div>

          <InputField
            label="Destination URL"
            required
            placeholder="https://yourwebsite.com"
            value={destinationUrl}
            onChange={(e) => setDestinationUrl(e.target.value)}
          />

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div className="flex flex-col gap-2">
              <label className="text-[18px] text-[#AFAFAF]">Call to Action</label>
              <div className="input-gradient-border">
                <InputCommonDropdown
                  value={callToAction}
                  onChange={setCallToAction}
                  options={[
                    { value: 'LEARN_MORE', label: 'Learn More' },
                    { value: 'SHOP_NOW', label: 'Shop Now' },
                  ]}
                />
              </div>
            </div>
            <div className="container-daily-budget flex flex-col gap-2">
              <label className="text-[18px] text-[#AFAFAF]">Daily Budget (USD)</label>
              <div className="relative rounded-full bg-[#383838]/50 p-px backdrop-blur-md">
                <span className="absolute top-1/2 left-6 -translate-y-1/2 font-semibold text-blue-400">
                  $
                </span>
                <div className="input-gradient-border">
                  <input
                    className="h-[49px] w-full bg-transparent px-10 text-base text-white outline-none placeholder:text-[#AFAFAF]"
                    placeholder="10"
                    value={dailyBudget}
                    onChange={(e) => setDailyBudget(e.target.value)}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-8 flex flex-col gap-4">
          <button className="w-full rounded-lg bg-white py-3 text-base font-semibold text-black shadow-lg shadow-emerald-500/20 transition hover:opacity-90">
            Create Facebook Ad
          </button>

          <div className="flex flex-col items-center gap-2 text-sm">
            {!selectedAccount && (
              <div className="flex items-center gap-2 text-amber-500">
                <AlertTriangle className="h-4 w-4" />
                <span>Please select an Ad Account first</span>
              </div>
            )}
            {!selectedPage && (
              <div className="flex items-center gap-2 text-amber-500">
                <AlertTriangle className="h-4 w-4" />
                <span>Please select a Facebook Page first</span>
              </div>
            )}
            {selectedImages.length === 0 && (
              <div className="flex items-center gap-2 text-amber-500">
                <AlertTriangle className="h-4 w-4" />
                <span>Please select at least one image first</span>
              </div>
            )}
          </div>

          <div className="mt-4 flex gap-3 rounded-lg border border-blue-500/20 bg-blue-500/10 p-4 text-sm text-blue-200">
            <Info className="h-5 w-5 shrink-0 text-blue-400" />
            <p className="leading-relaxed">
              Note: Your ad will be created in PAUSED state. Review it in Facebook Ads Manager and
              activate when ready. Facebook will review your ad before showing it to users.
            </p>
          </div>
        </div>
      </SectionContainer> */
  }
  return (
    <Formik
      initialValues={{
        selectedAccount: '',
        selectedPage: '',
        selectedCampaign: '',
        selectedAdSet: '',
        // Required when the picked campaign is Leads (Meta's Instant Forms).
        // Posted on the ad's creative as `lead_gen_form_id`.
        selectedLeadForm: '',
      }}
      // validationSchema={validationSchema}
      validateOnChange={true}
      validateOnBlur={true}
      // validateOnMount
      onSubmit={async (values) => {
        // call launch campaign API here
        setisloading(true);
        const payload = {
          accountId: fbUser?._id,
          adAccountId: values.selectedAccount,
          pageId: values.selectedPage,
          adFactoryCampaignId: campaignId,
          campaignDetails: {
            campaignId: values.selectedCampaign,
          },
          adSetDetails: {
            adSetId: values.selectedAdSet,
          },
          // Only sent when picked — V2 backend requires it on Leads
          // campaigns and ignores it on Traffic / App Promotion.
          ...(values.selectedLeadForm
            ? { leadFormId: values.selectedLeadForm }
            : {}),
          ads: postnodecreatives.map((creative) => ({
            imageUrl: creative.imageUrl,
            headline: creative.headline,
            message: creative.message,
            linkUrl: creative.linkUrl,
            callToAction: creative.callToAction,
            description: creative.description || '',
            adFactoryCreativeId: creative.creativeId,
          })),
        };

        // console.log('launch campaign: ', payload);
        try {
          await dispatch(launchcampaign(payload)).unwrap();
          dispatch(setCompletedNodes('preview'));
          dispatch(setCompletedNodes('post-ad'));
          dispatch(updateNodeEnabledStatus());
        } catch (e) {
          console.error(e);
        } finally {
          setisloading(false);
        }
      }}
    >
      {({ values, setFieldValue, setFieldTouched, errors, touched, isValid }) => {
        const isLeadsCampaign = isLeadsCampaignId(values.selectedCampaign);
        // When the feature flag is OFF, Leads campaigns can't be posted
        // to at all (Meta perm pending). Block Launch BEFORE the user
        // attempts a request that would 400 server-side.
        const isLeadsBlocked = isLeadsCampaign && !LEADS_POSTING_ENABLED;
        const canLaunch =
          Boolean(values.selectedAccount) &&
          Boolean(values.selectedPage) &&
          Boolean(values.selectedCampaign) &&
          Boolean(values.selectedAdSet) &&
          !isLeadsBlocked &&
          // Leads campaigns must have a Lead Form picked — the V2 endpoint
          // requires it and would otherwise 400 "Lead Form is required".
          (!isLeadsCampaign || Boolean(values.selectedLeadForm)) &&
          postnodecreatives.length > 0;

        return (
          <Form className="h-full w-full">
            <div className="h-full w-full">
              {onBack && (
                <button
                  type="button"
                  onClick={onBack}
                  className="mb-4 flex items-center gap-1.5 text-sm text-gray-400 transition-colors hover:text-white"
                >
                  <ChevronLeft className="h-4 w-4" />
                  Back to platforms
                </button>
              )}
              <div className="scrollbar_contents flex w-full flex-col gap-6">
                {/* Account & Page Section */}
                <SectionContainer
                  title="Account & Page Selection"
                  subtitle="Select your Facebook Ad Account and Page to proceed"
                >
                  <div className="grid grid-cols-1 gap-10 md:grid-cols-2">
                    {/* Ad Account */}
                    <div className="flex flex-col gap-2">
                      <label className="text-sm text-[#AFAFAF] 2xl:text-[18px]">
                        Select Your Ad Account *
                      </label>

                      <FbCustomDropdown
                        value={values.selectedAccount}
                        onChange={(adAccountId) => {
                          setFieldValue('selectedAccount', adAccountId);
                          // Reset everything downstream — page, campaign,
                          // ad set, lead form — all are scoped to the
                          // (now-changed) ad account.
                          setFieldValue('selectedPage', '');
                          setFieldValue('selectedCampaign', '');
                          setFieldValue('selectedAdSet', '');
                          setFieldValue('selectedLeadForm', '');
                          setLeadForms([]);
                          // Ad-account-scoped page fetch (instead of the
                          // legacy /ad-posting/pages endpoint which
                          // returned every Page the user could access).
                          fetchPagesForAccount(adAccountId);

                          if (fbUser?._id && adAccountId) {
                            setCampaignsLoading(true);
                            dispatch(
                              fetchCampaign({
                                adAccountId,
                                accountId: fbUser._id,
                              })
                            ).finally(() => setCampaignsLoading(false));
                          }
                        }}
                        options={accountOptions}
                        label={
                          accountOptions.length === 0
                            ? 'Loading ad accounts…'
                            : 'Choose Ad Account'
                        }
                        type="account"
                      />
                    </div>

                    {/* Facebook Page */}
                    <div className="flex flex-col gap-2">
                      <label className="text-sm text-[#AFAFAF] 2xl:text-[18px]">
                        Select Your Facebook Page *
                      </label>

                      <FbCustomDropdown
                        value={values.selectedPage}
                        onChange={(val) => {
                          setFieldValue('selectedPage', val);
                          // Lead Forms are page-scoped — a new Page means
                          // re-fetching and clearing any prior selection.
                          setFieldValue('selectedLeadForm', '');
                          if (isLeadsCampaignId(values.selectedCampaign)) {
                            fetchLeadFormsForPage(val);
                          } else {
                            setLeadForms([]);
                          }
                        }}
                        options={facebookPageOptions}
                        label={
                          !values.selectedAccount
                            ? 'Pick an ad account first'
                            : pagesLoading
                            ? 'Loading pages…'
                            : facebookPageOptions.length === 0
                            ? 'No pages on this ad account'
                            : 'Choose Facebook Page'
                        }
                        type="page"
                        disabled={!values.selectedAccount || pagesLoading}
                      />
                    </div>
                  </div>
                </SectionContainer>

                {/* Campaign & AdSet */}
                <div className="grid grid-cols-1 gap-10 md:grid-cols-2">
                  {/* Campaign */}
                  <div className="flex flex-col gap-2">
                    <label className="text-sm text-[#AFAFAF] 2xl:text-[18px]">
                      Choose Campaign *
                    </label>

                    <InputCommonDropdown
                      value={values.selectedCampaign}
                      onChange={(campaignId) => {
                        setFieldValue('selectedCampaign', campaignId);
                        // setFieldTouched('selectedCampaign', true);
                        setFieldValue('selectedAdSet', '');
                        setFieldValue('selectedLeadForm', '');

                        if (campaignId && values.selectedAccount && fbUser?._id) {
                          setAdsetsLoading(true);
                          dispatch(
                            fetchAdsets({
                              adAccountId: values.selectedAccount,
                              accountId: fbUser._id,
                              campaignId,
                            })
                          ).finally(() => setAdsetsLoading(false));
                        }
                        // Pre-load lead forms when the user picks a Leads
                        // campaign + already has a Page selected — keeps
                        // the Lead Form dropdown ready by the time they
                        // scroll to it.
                        if (isLeadsCampaignId(campaignId) && values.selectedPage) {
                          fetchLeadFormsForPage(values.selectedPage);
                        } else {
                          setLeadForms([]);
                        }
                      }}
                      options={campaignOptions}
                      label={
                        !values.selectedAccount
                          ? 'Pick an ad account first'
                          : campaignsLoading
                          ? 'Loading campaigns…'
                          : campaignOptions.length === 0
                          ? 'No campaigns on this ad account'
                          : 'Choose Campaign'
                      }
                      disabled={!values.selectedAccount || campaignsLoading}
                    />
                  </div>

                  {/* Ad Set */}
                  <div className="flex flex-col gap-2">
                    <label className="text-sm text-[#AFAFAF] 2xl:text-[18px]">
                      Choose Ad Set *
                    </label>

                    <InputCommonDropdown
                      value={values.selectedAdSet}
                      onChange={(val) => {
                        setFieldValue('selectedAdSet', val);
                        // setFieldTouched('selectedAdSet', true, false);
                      }}
                      options={adSetOptions}
                      label={
                        !values.selectedCampaign
                          ? 'Pick a campaign first'
                          : adsetsLoading
                          ? 'Loading ad sets…'
                          : adSetOptions.length === 0
                          ? 'No ad sets on this campaign'
                          : 'Choose Ad Set'
                      }
                      disabled={!values.selectedCampaign || adsetsLoading}
                    />

                    {touched.selectedAdSet && errors.selectedAdSet && (
                      <p className="text-sm text-red-500">{errors.selectedAdSet}</p>
                    )}
                  </div>
                </div>

                {/* Leads support — gated by VITE_FEATURE_LEADS_POSTING.
                    When OFF (production today, while Meta reviews the
                    pages_manage_ads permission for our app): show a
                    pending-approval banner instead of the Lead Form
                    picker, and Launch is disabled by canLaunch above.
                    When ON: full Lead Form picker. The backend mirrors
                    this gate so the two paths can't disagree. */}
                {isLeadsCampaign && !LEADS_POSTING_ENABLED && (
                  <div className="flex items-start gap-3 rounded-lg border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                    <div>
                      <p className="font-semibold text-amber-100">
                        Lead campaigns aren&apos;t available yet
                      </p>
                      <p className="mt-1 text-xs text-amber-100/80">
                        We&apos;re getting Lead campaign support ready and it
                        will be enabled soon. For now, please pick a Traffic or
                        App Promotion campaign to post your ads.
                      </p>
                    </div>
                  </div>
                )}
                {isLeadsCampaign && LEADS_POSTING_ENABLED && (
                  <div className="grid grid-cols-1 gap-10 md:grid-cols-2">
                    <div className="flex flex-col gap-2">
                      <label className="text-sm text-[#AFAFAF] 2xl:text-[18px]">
                        Choose Lead Form *
                      </label>
                      <InputCommonDropdown
                        value={values.selectedLeadForm}
                        onChange={(formId) => setFieldValue('selectedLeadForm', formId)}
                        options={leadFormOptions}
                        label={
                          leadFormsLoading
                            ? 'Loading lead forms…'
                            : leadFormOptions.length
                            ? 'Choose Lead Form'
                            : values.selectedPage
                            ? 'No Lead Forms on this Page'
                            : 'Pick a Page first'
                        }
                        disabled={
                          !values.selectedPage ||
                          leadFormsLoading ||
                          leadFormOptions.length === 0
                        }
                      />
                      {!values.selectedLeadForm && (
                        <p className="text-xs text-[#AFAFAF]">
                          Required — Leads ads attach an Instant Form to the
                          creative on Meta.
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {/* this one called here that card   */}
                <FbAdCarousel />
              </div>

              {/* Launch Button */}
              <div className="flex justify-end gap-4">
                <button
                  type="submit"
                  disabled={!canLaunch || isloading}
                  className={`flex items-center justify-center gap-2 rounded-lg px-6 py-3 text-sm font-semibold transition 2xl:px-12 2xl:text-base ${
                    !isloading && canLaunch
                      ? 'bg-white text-black hover:opacity-90'
                      : 'cursor-not-allowed bg-gray-400 text-gray-700'
                  }`}
                >
                  {isloading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      <Rocket className="h-4 w-4" />
                      Launch Campaign
                    </>
                  )}
                </button>
              </div>
            </div>
          </Form>
        );
      }}
    </Formik>
  );
};
export default FbAccountReady;
