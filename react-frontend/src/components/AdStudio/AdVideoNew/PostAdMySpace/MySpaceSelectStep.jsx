import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight } from 'lucide-react';
import { useDispatch, useSelector } from 'react-redux';
import { getLeadForms, getMetaPages } from '@/apis/metaAds/metaAdsApi';
import {
  fetchAdAccounts,
  fetchAdsets,
  fetchCampaign,
} from '@/store/actions/adFactoryNew/adFactoryActions';
import InputCommonDropdown from '@/components/AdFactory/NodeForms/InputCommonDropdown';
import FacebookAccountSelector from '@/components/MetaAds/FacebookAccountSelector';
import FbCustomDropdown from './FbCustomDropdown';

// Gates posting to Leads campaigns. Mirrors the env check in
// AdFactory/PostAd/FbAccountReady.jsx so the two flows can't disagree.
// When OFF: show a pending-approval banner and block Next. When ON:
// surface a Lead Form picker scoped to the chosen Page.
const LEADS_POSTING_ENABLED =
  import.meta.env.VITE_FEATURE_LEADS_POSTING === 'true';

// Mirrors the 4-dropdown flow in AdFactory/PostAd/FbAccountReady.jsx, minus
// the FbAdCarousel and Formik submit — MySpace's posting step is a separate
// compose form, so the bottom action is just "Next" lifting the selection
// to the parent. Adds a Leads-aware Lead Form picker / amber banner under
// the dropdown grid.
export default function MySpaceSelectStep({ onBack, onNext }) {
  const dispatch = useDispatch();
  const { userData } = useSelector((state) => state.socket);
  const { adAccDropdown = [], campaignsDropdown = [], adSetDropdown = [] } = useSelector(
    (state) => state.adFactoryNew || {},
  );

  // Multiple Facebook accounts may be connected for this AdsGPT user —
  // FacebookAccountSelector lets them pick which one to post through,
  // same as AdFactory/PostAd/FbAccountReady.jsx.
  const [selectedFacebookAccount, setSelectedFacebookAccount] = useState(null);
  const [facebookAccountsLoading, setFacebookAccountsLoading] = useState(true);
  const facebookAccountsRequestRef = useRef(null);
  const facebookId = selectedFacebookAccount?.facebookId || '';
  const facebookConnectionId = selectedFacebookAccount?._id || '';

  const [selectedAccount, setSelectedAccount] = useState('');
  const [selectedPage, setSelectedPage] = useState('');
  const [selectedCampaign, setSelectedCampaign] = useState('');
  const [selectedAdSet, setSelectedAdSet] = useState('');
  // Required when the picked campaign is Leads (Meta's Instant Forms).
  // Posted on the ad's creative as `lead_gen_form_id`.
  const [selectedLeadForm, setSelectedLeadForm] = useState('');

  const [pages, setPages] = useState([]);
  const [pagesLoading, setPagesLoading] = useState(false);
  const [campaignsLoading, setCampaignsLoading] = useState(false);
  const [adsetsLoading, setAdsetsLoading] = useState(false);
  // Lead Forms are page-scoped — re-fetched when the page changes.
  const [leadForms, setLeadForms] = useState([]);
  const [leadFormsLoading, setLeadFormsLoading] = useState(false);

  const handleFacebookAccountChange = useCallback(
    (account) => {
      if (account?.facebookId && account.facebookId === facebookId) return;
      setSelectedFacebookAccount(account);
      setSelectedAccount('');
      setSelectedPage('');
      setSelectedCampaign('');
      setSelectedAdSet('');
      setSelectedLeadForm('');
      setPages([]);
      setLeadForms([]);
      facebookAccountsRequestRef.current?.abort();
      if (!account?._id || !account?.facebookId) {
        setFacebookAccountsLoading(false);
        return;
      }
      setFacebookAccountsLoading(true);
      const request = dispatch(
        fetchAdAccounts({ accountId: account._id, facebookId: account.facebookId }),
      );
      facebookAccountsRequestRef.current = request;
      request.finally(() => {
        if (facebookAccountsRequestRef.current === request) {
          setFacebookAccountsLoading(false);
        }
      });
    },
    [dispatch, facebookId],
  );

  useEffect(
    () => () => {
      facebookAccountsRequestRef.current?.abort();
    },
    [],
  );

  const formatSpent = (amountMinor, currency) => {
    const major = Number(amountMinor || 0) / 100;
    const formatted = major.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return `${currency || ''} ${formatted}`.trim();
  };

  const accountOptions = useMemo(
    () =>
      adAccDropdown.map((account) => ({
        id: account.id,
        name: account.name,
        isActive: account.status === 1,
        currency: account.currency,
        spent: formatSpent(account.amountSpent, account.currency),
      })),
    [adAccDropdown],
  );

  const pageOptions = useMemo(
    () =>
      pages.map((page) => ({
        id: page.id,
        name: page.name,
        category: page.category,
        followers: page.fanCount,
        image: page.picture,
      })),
    [pages],
  );

  const campaignOptions = useMemo(
    () => campaignsDropdown.map((c) => ({ value: c.id, label: c.name })),
    [campaignsDropdown],
  );

  const adSetOptions = useMemo(
    () => adSetDropdown.map((a) => ({ value: a.id, label: a.name })),
    [adSetDropdown],
  );

  const leadFormOptions = useMemo(
    () => leadForms.map((f) => ({ value: f.id, label: f.name })),
    [leadForms],
  );

  // The getCampaigns endpoint stamps `objective` on each row, so no
  // extra fetch is needed to tell whether a picked campaign is Leads.
  const isLeadsCampaignId = useCallback(
    (campaignId) =>
      campaignsDropdown.some(
        (c) => c.id === campaignId && c.objective === 'OUTCOME_LEADS',
      ),
    [campaignsDropdown],
  );

  const fetchPagesForAccount = useCallback(async (adAccountId) => {
    if (!adAccountId) {
      setPages([]);
      return;
    }
    setPagesLoading(true);
    try {
      const r = await getMetaPages(adAccountId, { facebookId });
      setPages(r?.pages || []);
    } catch {
      setPages([]);
    } finally {
      setPagesLoading(false);
    }
  }, [facebookId]);

  const fetchLeadFormsForPage = useCallback(async (pageId) => {
    if (!pageId) {
      setLeadForms([]);
      return;
    }
    setLeadFormsLoading(true);
    try {
      const r = await getLeadForms(pageId, { facebookId });
      setLeadForms(r?.forms || []);
    } catch {
      setLeadForms([]);
    } finally {
      setLeadFormsLoading(false);
    }
  }, [facebookId]);

  const onAccountChange = (adAccountId) => {
    setSelectedAccount(adAccountId);
    // Everything downstream is scoped to the (now-changed) ad account.
    setSelectedPage('');
    setSelectedCampaign('');
    setSelectedAdSet('');
    setSelectedLeadForm('');
    setLeadForms([]);
    fetchPagesForAccount(adAccountId);
    if (facebookConnectionId && facebookId && adAccountId) {
      setCampaignsLoading(true);
      dispatch(
        fetchCampaign({ adAccountId, accountId: facebookConnectionId, facebookId }),
      ).finally(() => setCampaignsLoading(false));
    }
  };

  const onPageChange = (pageId) => {
    setSelectedPage(pageId);
    // Lead Forms are page-scoped — clear and re-fetch when the page
    // changes, but only if the currently-picked campaign is Leads.
    setSelectedLeadForm('');
    if (isLeadsCampaignId(selectedCampaign)) {
      fetchLeadFormsForPage(pageId);
    } else {
      setLeadForms([]);
    }
  };

  const onCampaignChange = (campaignId) => {
    setSelectedCampaign(campaignId);
    setSelectedAdSet('');
    setSelectedLeadForm('');
    if (campaignId && selectedAccount && facebookConnectionId && facebookId) {
      setAdsetsLoading(true);
      dispatch(
        fetchAdsets({
          adAccountId: selectedAccount,
          accountId: facebookConnectionId,
          facebookId,
          campaignId,
        }),
      ).finally(() => setAdsetsLoading(false));
    }
    // Pre-load lead forms when the user picks a Leads campaign AND
    // already has a Page selected — keeps the dropdown warm by the
    // time they scroll to it.
    if (isLeadsCampaignId(campaignId) && selectedPage) {
      fetchLeadFormsForPage(selectedPage);
    } else {
      setLeadForms([]);
    }
  };

  const isLeadsCampaign = isLeadsCampaignId(selectedCampaign);
  const isLeadsBlocked = isLeadsCampaign && !LEADS_POSTING_ENABLED;

  const canNext =
    Boolean(facebookConnectionId) &&
    Boolean(facebookId) &&
    Boolean(selectedAccount) &&
    Boolean(selectedPage) &&
    Boolean(selectedCampaign) &&
    Boolean(selectedAdSet) &&
    !isLeadsBlocked &&
    (!isLeadsCampaign || Boolean(selectedLeadForm));

  return (
    <div className="flex h-full w-full flex-col gap-6">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="flex w-fit items-center gap-1.5 text-sm text-gray-500 transition-colors hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
        >
          <ChevronLeft className="h-4 w-4" />
          Back to platforms
        </button>
      )}

      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white 2xl:text-xl">
          Account &amp; Page Selection
        </h2>
        <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400 2xl:mt-1 2xl:text-sm">
          Select your Facebook Ad Account and Page to proceed
        </p>
      </div>

      <div className="flex max-w-md flex-col gap-2">
        <label className="text-sm text-[#AFAFAF] 2xl:text-[18px]">
          Select Your Facebook Account *
        </label>
        <FacebookAccountSelector
          userId={userData?.user_id}
          onChange={handleFacebookAccountChange}
          className="w-full"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 2xl:gap-10">
        <div className="flex flex-col gap-2">
          <label className="text-sm text-[#AFAFAF] 2xl:text-[18px]">
            Select Your Ad Account *
          </label>
          <FbCustomDropdown
            value={selectedAccount}
            onChange={onAccountChange}
            options={accountOptions}
            label={
              !facebookId
                ? 'Pick a Facebook account first'
                : accountOptions.length === 0
                  ? 'Loading ad accounts…'
                  : 'Choose Ad Account'
            }
            type="account"
            disabled={!facebookId || facebookAccountsLoading}
          />
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm text-[#AFAFAF] 2xl:text-[18px]">
            Select Your Facebook Page *
          </label>
          <FbCustomDropdown
            value={selectedPage}
            onChange={onPageChange}
            options={pageOptions}
            label={
              !selectedAccount
                ? 'Pick an ad account first'
                : pagesLoading
                  ? 'Loading pages…'
                  : pageOptions.length === 0
                    ? 'No pages on this ad account'
                    : 'Choose Facebook Page'
            }
            type="page"
            disabled={!selectedAccount || pagesLoading}
          />
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm text-[#AFAFAF] 2xl:text-[18px]">Choose Campaign *</label>
          <InputCommonDropdown
            value={selectedCampaign}
            onChange={onCampaignChange}
            options={campaignOptions}
            label={
              !selectedAccount
                ? 'Pick an ad account first'
                : campaignsLoading
                  ? 'Loading campaigns…'
                  : campaignOptions.length === 0
                    ? 'No campaigns on this ad account'
                    : 'Choose Campaign'
            }
            disabled={!selectedAccount || campaignsLoading}
          />
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm text-[#AFAFAF] 2xl:text-[18px]">Choose Ad Set *</label>
          <InputCommonDropdown
            value={selectedAdSet}
            onChange={setSelectedAdSet}
            options={adSetOptions}
            label={
              !selectedCampaign
                ? 'Pick a campaign first'
                : adsetsLoading
                  ? 'Loading ad sets…'
                  : adSetOptions.length === 0
                    ? 'No ad sets on this campaign'
                    : 'Choose Ad Set'
            }
            disabled={!selectedCampaign || adsetsLoading}
          />
        </div>
      </div>

      {/* Leads — feature-flagged. Off in prod until Meta approves the
          pages_manage_ads permission for the AdsGPT app; backend mirrors
          this gate so the two paths can't disagree. */}
      {isLeadsCampaign && !LEADS_POSTING_ENABLED && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
          <div>
            <p className="font-semibold text-amber-100">
              Lead campaigns aren&apos;t available yet
            </p>
            <p className="mt-1 text-xs text-amber-100/80">
              We&apos;re getting Lead campaign support ready and it will be
              enabled soon. For now, please pick a Traffic or App Promotion
              campaign to post your ad.
            </p>
          </div>
        </div>
      )}
      {isLeadsCampaign && LEADS_POSTING_ENABLED && (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 2xl:gap-10">
          <div className="flex flex-col gap-2">
            <label className="text-sm text-gray-600 dark:text-[#AFAFAF] 2xl:text-[18px]">
              Choose Lead Form *
            </label>
            <InputCommonDropdown
              value={selectedLeadForm}
              onChange={setSelectedLeadForm}
              options={leadFormOptions}
              label={
                leadFormsLoading
                  ? 'Loading lead forms…'
                  : leadFormOptions.length
                    ? 'Choose Lead Form'
                    : selectedPage
                      ? 'No Lead Forms on this Page'
                      : 'Pick a Page first'
              }
              disabled={
                !selectedPage || leadFormsLoading || leadFormOptions.length === 0
              }
            />
            {!selectedLeadForm && (
              <p className="text-xs text-[#AFAFAF]">
                Required — Leads ads attach an Instant Form to the creative on Meta.
              </p>
            )}
          </div>
        </div>
      )}

      <div className="mt-2 flex justify-end">
        <button
          type="button"
          disabled={!canNext}
          onClick={() =>
            onNext({
              accountId: facebookConnectionId,
              facebookId,
              adAccountId: selectedAccount,
              pageId: selectedPage,
              campaignId: selectedCampaign,
              adSetId: selectedAdSet,
              ...(selectedLeadForm ? { leadFormId: selectedLeadForm } : {}),
            })
          }
          className={`flex items-center gap-2 rounded-lg px-6 py-2.5 text-sm font-semibold transition 2xl:px-10 2xl:py-3 2xl:text-base ${
            canNext
              ? 'bg-gray-900 text-white hover:opacity-90 dark:bg-white dark:text-black'
              : 'cursor-not-allowed bg-gray-200 text-gray-400 dark:bg-gray-400/30 dark:text-gray-400'
          }`}
        >
          Next
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
