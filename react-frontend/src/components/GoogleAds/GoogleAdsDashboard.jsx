import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { SiGoogleads } from 'react-icons/si';
import {
  ChevronDown,
  TrendingUp,
  RefreshCw,
  Loader2,
  Layers,
  Radio,
  Calendar,
  ClipboardList,
  LogOut,
  Info,
  Plus,
  AlertCircle,
  Search,
} from 'lucide-react';
import { useSelector } from 'react-redux';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  getGoogleAdAccounts,
  getGoogleCampaigns,
  parseGoogleCampaignsResponse,
  getGoogleAnalyticsData,
  disconnectGoogleAccount,
  getGoogleAdGroupAds,
  getGoogleAdGroups,
} from '@/apis/googleAds/googleAdsApi';
import { globalToast } from '@/utils/globalToast';
import { DATE_PRESETS } from '@/components/MetaAds/metaAdsUtils';
import { Dropdown, StatusBadge } from '@/components/MetaAds/MetaAdsAtoms';
import GoogleAdsAnalyticsPanel from './GoogleAdsAnalyticsPanel';
import GoogleAdsCampaignsTable from './GoogleAdsCampaignsTable';
import GoogleAdsAuditTab from './GoogleAdsAuditTab';
import CreateCampaignWizard from './CreateCampaignWizard';
import { fetchSchemaOnce } from './googleAdsUtils';
import AdsManagerModeSwitcher from '@/components/AdsManager/AdsManagerModeSwitcher';
import WorkspaceSwitcher from '@/components/workspace/WorkspaceSwitcher';
import ThemeToggle from '@/components/layout/header/ThemeToggle';

const GOOGLE_BLUE = '#4285F4';

// Meta/TikTok-style pill dropdown (button + menu, closes on backdrop click)
const PillDropdown = ({ icon: Icon, iconClass = 'text-emerald-500', label, open, setOpen, children }) => (
  <div className="relative">
    <button
      onClick={() => setOpen(!open)}
      className="flex items-center gap-2 rounded-xl border border-[#DDD7CD] bg-[#FCFAF7] px-3 py-2 text-xs font-medium text-[#24211D] shadow-xs backdrop-blur-xl transition-all hover:border-[#DDD7CD] hover:bg-[#EAE5DC] dark:border-white/[0.06] dark:bg-[#171717] dark:text-white dark:hover:border-white/10"
    >
      {Icon && <Icon className={`h-3 w-3 ${iconClass}`} />}
      <span className="max-w-44 truncate">{label}</span>
      <ChevronDown className="h-3 w-3 text-[#7A7369] dark:text-[#BEBEBE]" />
    </button>
    {open && (
      <>
        <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
        <div className="absolute right-0 z-50 mt-1 max-h-72 min-w-52 overflow-auto rounded-xl border border-[#DDD7CD] bg-white p-1 shadow-xl dark:border-white/10 dark:bg-[#161616]">
          {children}
        </div>
      </>
    )}
  </div>
);

export default function GoogleAdsDashboard() {
  const { userData } = useSelector((state) => state.socket);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [adAccounts, setAdAccounts]       = useState([]);
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [campaigns, setCampaigns]         = useState([]);
  const [campaignSearch, setCampaignSearch] = useState('');
  const [campaignsLevel, setCampaignsLevel] = useState('campaigns');
  const [analyticsData, setAnalyticsData] = useState(null);
  const [datePreset, setDatePreset]       = useState('last_14d');
  const [analyticsError, setAnalyticsError] = useState('');
  const [activeTab, setActiveTab]         = useState('analytics');

  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);
  const [schemaLoading, setSchemaLoading] = useState(false);
  const [loadingInsights, setLoadingInsights]   = useState(false);

  const [accountOpen, setAccountOpen]         = useState(false);
  const [dateOpen, setDateOpen]               = useState(false);
  const [disconnecting, setDisconnecting]     = useState(false);
  const [showDisconnectModal, setShowDisconnectModal] = useState(false);
  const [isGoogleDisconnected, setIsGoogleDisconnected] = useState(false);

  // ── wizard state ──────────────────────────────────────────────────────────
  const [wizard, setWizard]         = useState({ open: false, mode: 'create-full', context: null });
  const [manageNonce, setManageNonce] = useState(0);

  const openWizard  = async (mode, context = null) => {
    if (mode === 'edit-campaign' && context?.campaignId) {
      setWizard({ open: true, mode, context: { ...context, _loadingAssets: true } });
      try {
        const agRes = await getGoogleAdGroups({
          adAccountId: context.adAccountId || selectedAccount?.id,
          campaignId: context.campaignId || context.id,
          channelType: context.channelType || context.objective,
          refresh: true,
        });
        const adGroups = agRes?.adGroups || [];
        let fetchedFinalUrl = context.finalUrl || context.websiteUrl || '';
        let fetchedWebsiteUrl = context.websiteUrl || context.finalUrl || '';
        let fetchedBusinessName = context.businessName || '';

        if (adGroups.length > 0) {
          const agId = adGroups[0].adGroupId || adGroups[0].id;
          const adsRes = await getGoogleAdGroupAds({
            adAccountId: context.adAccountId || selectedAccount?.id,
            adGroupId: agId,
            refresh: true,
          });
          const firstAd = (adsRes?.ads || [])[0] || null;
          if (firstAd) {
            const url = firstAd.finalUrls?.[0] || firstAd.finalUrl || firstAd.websiteUrl || firstAd.url || '';
            if (url) {
              fetchedFinalUrl = url;
              fetchedWebsiteUrl = url;
            }
            if (firstAd.businessName || firstAd.pmaxBusinessName) {
              fetchedBusinessName = firstAd.businessName || firstAd.pmaxBusinessName;
            }
          }
        }
        setWizard({
          open: true,
          mode,
          context: {
            ...context,
            websiteUrl: fetchedWebsiteUrl,
            finalUrl: fetchedFinalUrl,
            pmaxFinalUrl: fetchedFinalUrl,
            businessName: fetchedBusinessName,
            pmaxBusinessName: fetchedBusinessName,
            countries: context.countries || context.targetCountries || context.targeting?.countries || [],
            _loadingAssets: false,
          },
        });
      } catch (e) {
        setWizard({ open: true, mode, context: { ...context, _loadingAssets: false } });
      }
      return;
    }
    if (mode === 'edit-adgroup' && context?.isPmax) {
      setWizard({ open: true, mode, context: { ...context, _loadingAssets: true } });
      try {
        const r = await getGoogleAdGroupAds({ adAccountId: context.adAccountId || selectedAccount?.id, adGroupId: context.adGroupId, refresh: true });
        const item = (r.ads || [])[0] || null;
        const originalAssets = {
          headlines: item?.headlines || [],
          descriptions: item?.descriptions || [],
          longHeadline: item?.longHeadline || null,
          images: item?.images || [],
          logos: item?.logos || [],
        };
        const marketingImage = item?.images?.find((i) => i.fieldType === 'MARKETING_IMAGE');
        const squareImage = item?.images?.find((i) => i.fieldType === 'SQUARE_MARKETING_IMAGE');
        const logo = item?.logos?.[0];
        setWizard({
          open: true,
          mode,
          context: {
            ...context,
            assetGroupName: item?.name || context.adGroupName,
            pmaxFinalUrl: item?.finalUrls?.[0] || '',
            pmaxHeadlines: (item?.headlines || []).map((h) => h.text || h).filter(Boolean),
            pmaxLongHeadline: item?.longHeadline?.text || '',
            pmaxDescriptions: (item?.descriptions || []).map((d) => d.text || d).filter(Boolean),
            pmaxImageUrl: marketingImage?.url || '',
            pmaxImageAssetRN: marketingImage?.assetRN || '',
            pmaxSquareImageAssetRN: squareImage?.assetRN || '',
            pmaxLogoUrl: logo?.url || '',
            pmaxLogoAssetRN: logo?.assetRN || '',
            _originalPmaxAssets: originalAssets,
          },
        });
      } catch (e) {
        globalToast.error('Failed to load asset group data');
        setWizard({ open: true, mode, context });
      }
      return;
    }
    setWizard({ open: true, mode, context });
  };
  const closeWizard = () => setWizard((w) => ({ ...w, open: false }));

  // Deep-link entry: callers (e.g. the TemplatePicker empty-state in
  // AdFactory Automation) navigate here with `?openWizard=create-full` to
  // jump straight into the New Campaign flow. Switch to the Campaigns tab
  // so the wizard's "Campaigns refreshed" outcome lands on the right view,
  // open the wizard, then strip the query param so a refresh / back-nav
  // doesn't keep re-opening it. Mirrors the same flow on MetaAdsDashboard.
  const autoOpenWizardMode = searchParams.get('openWizard');
  useEffect(() => {
    if (!autoOpenWizardMode) return;
    setActiveTab('campaigns');
    openWizard(autoOpenWizardMode);
    const next = new URLSearchParams(searchParams);
    next.delete('openWizard');
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpenWizardMode]);

  const [noAccountReason, setNoAccountReason] = useState(null);

  // ── load accounts on mount ────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const res = await getGoogleAdAccounts();
        const accounts = res.adAccounts || [];
        setAdAccounts(accounts);
        if (accounts.length) {
          setSelectedAccount(accounts[0]);
        } else {
          // Stay on this page — show a "no accounts" state with disconnect option
          setNoAccountReason(res.noAccountReason || 'no_google_ads_account');
        }
      } catch {
        navigate('/ads-manager');
      } finally {
        setLoadingAccounts(false);
      }
    })();
  }, [navigate]);

  // ── reload campaigns ──────────────────────────────────────────────────────
  const reloadCampaigns = useCallback(async ({ refresh = true } = {}) => {
    if (!selectedAccount) return;
    setLoadingCampaigns(true);
    try {
      const res = await getGoogleCampaigns(selectedAccount.id, { refresh });
      const list = parseGoogleCampaignsResponse(res);
      setCampaigns(list);
      setIsGoogleDisconnected(false);
      if (!list.length) {
        const accountError = res?.data?.find?.((d) => d.error)?.error;
        if (accountError) globalToast.error(accountError);
      }
    } catch (e) {
      setCampaigns([]);
      const details = e?.response?.data?.details || '';
      const isDisconnected = details.toLowerCase().includes('not connected') || details.toLowerCase().includes('reconnect') || e?.response?.status === 404 || e?.response?.status === 401;
      setIsGoogleDisconnected(isDisconnected);
      if (!isDisconnected) globalToast.error(e?.response?.data?.error || details || 'Failed to load campaigns');
    } finally {
      setLoadingCampaigns(false);
    }
  }, [selectedAccount]);

  useEffect(() => {
    if (!selectedAccount) return;
    setCampaigns([]);
    setAnalyticsData(null);
    reloadCampaigns();
  }, [selectedAccount]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── analytics ─────────────────────────────────────────────────────────────
  const loadAnalytics = useCallback(async ({ refresh = false } = {}) => {
    if (!selectedAccount) return;
    setLoadingInsights(true);
    setAnalyticsData(null);
    setAnalyticsError('');
    try {
      const res = await getGoogleAnalyticsData({ adAccountId: selectedAccount.id, datePreset, refresh });
      setAnalyticsData(res);
    } catch (error) {
      setAnalyticsError(error?.response?.data?.details || error?.response?.data?.error || 'Unable to load Google Ads analytics');
    } finally {
      setLoadingInsights(false);
    }
  }, [selectedAccount, datePreset]);

  useEffect(() => {
    if (activeTab === 'analytics') loadAnalytics();
  }, [activeTab, loadAnalytics]);

  // ── wizard created callback ───────────────────────────────────────────────
  const handleWizardCreated = useCallback(() => {
    if (wizard.mode === 'create-full' || wizard.mode === 'edit-campaign') {
      if (wizard.mode === 'create-full') setActiveTab('campaigns');
      reloadCampaigns();
    } else {
      setManageNonce((n) => n + 1);
    }
  }, [wizard.mode, reloadCampaigns]);

  // ── disconnect ────────────────────────────────────────────────────────────
  const handleDisconnect = async () => {
    const userId = userData?.user_id;
    if (!userId) return;
    setDisconnecting(true);
    try {
      await disconnectGoogleAccount(userId);
      globalToast.success('Google Ads account disconnected');
      navigate('/ads-manager');
    } catch {
      globalToast.error('Failed to disconnect');
      setDisconnecting(false);
    }
  };

  const activeCampaigns = campaigns.filter((c) => c.status === 'ENABLED').length;

  const TABS = [
    { id: 'analytics', label: 'Analytics', icon: TrendingUp },
    { id: 'campaigns', label: 'Campaigns', icon: Layers },
    
    // { id: 'audit',     label: 'Audit',     icon: ClipboardList },
  ];

  // ── no accounts state ─────────────────────────────────────────────────────
  if (!loadingAccounts && noAccountReason) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-6 p-8">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl workspace-card dark:border-white/10 dark:bg-[#171717]">
          <SiGoogleads className="h-7 w-7" style={{ color: GOOGLE_BLUE }} />
        </div>
        <div className="text-center">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">No Google Ads Accounts Found</h2>
          <p className="mt-1.5 max-w-sm text-sm text-gray-500 dark:text-[#BEBEBE]">
            {noAccountReason === 'google_ads_developer_token_restricted'
              ? 'Google Ads is connected but your developer token is restricted. Please contact support.'
              : 'Your connected Google account is not linked to any active Google Ads account. Create one at ads.google.com or connect a different Google account.'}
          </p>
        </div>
        <div className="flex flex-col items-center gap-3 sm:flex-row">
          <a
            href="https://ads.google.com/home/"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-900 transition-all hover:border-gray-300 dark:border-white/10 dark:bg-[#1a1a1a] dark:text-white dark:hover:border-white/20"
          >
            <Plus className="h-4 w-4" />
            Create Ads Account
          </a>
          <button
            onClick={() => setShowDisconnectModal(true)}
            disabled={disconnecting}
            className="flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-2 text-sm font-semibold text-red-600 transition-all hover:border-red-500/40 hover:bg-red-500/10 disabled:opacity-50 dark:text-red-400"
          >
            {disconnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
            {disconnecting ? 'Disconnecting…' : 'Disconnect Google'}
          </button>
        </div>

        {/* Disconnect confirm modal */}
        <AnimatePresence>
          {showDisconnectModal &&
            typeof document !== 'undefined' &&
            createPortal(
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-4 backdrop-blur-md"
                onClick={() => setShowDisconnectModal(false)}
              >
                <motion.div
                  initial={{ scale: 0.95, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.95, opacity: 0 }}
                  onClick={(e) => e.stopPropagation()}
                  className="w-full max-w-sm rounded-2xl border border-gray-200/80 bg-white p-6 shadow-2xl backdrop-blur-xl dark:border-white/10 dark:bg-[#1a1a1a]"
                >
                  <h3 className="text-base font-bold text-gray-900 dark:text-white">Disconnect Google Ads?</h3>
                  <p className="mt-2 text-sm text-gray-500 dark:text-[#BEBEBE]">
                    Your Google account will be disconnected. You can reconnect anytime from Profile settings.
                  </p>
                  <div className="mt-5 flex justify-end gap-2">
                    <button
                      onClick={() => setShowDisconnectModal(false)}
                      className="rounded-xl px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-100 dark:text-[#BEBEBE] dark:hover:bg-white/5"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={async () => {
                        setShowDisconnectModal(false);
                        await handleDisconnect();
                      }}
                      disabled={disconnecting}
                      className="rounded-xl bg-red-500 px-4 py-2 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-50"
                    >
                      {disconnecting ? 'Disconnecting…' : 'Disconnect'}
                    </button>
                  </div>
                </motion.div>
              </motion.div>,
              document.body
            )}
        </AnimatePresence>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col overflow-auto pl-12 pr-5 sm:pl-14 lg:px-5 pt-3 pb-6 2xl:px-7 2xl:pt-4 text-gray-900 dark:text-white">
      {/* Header — title left, account + date pickers and theme toggle top-right (TikTok-style) */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#DDD7CD] pb-2.5 dark:border-white/10">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-[#DDD7CD] bg-[#FCFAF7] shadow-xs 2xl:h-12 2xl:w-12 dark:border-white/10 dark:bg-white">
              <SiGoogleads className="h-6.5 w-6.5 2xl:h-7.5 2xl:w-7.5" style={{ color: GOOGLE_BLUE }} />
            </div>
            <AdsManagerModeSwitcher activeMode="manager" platform="Google" />
          </div>
          <p className="px-1 text-xs font-medium text-[#7A7369] dark:text-[#BEBEBE]">
            Manage · Analyse · Optimise
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <WorkspaceSwitcher />
          {adAccounts.length > 0 && (
            <>
              <PillDropdown
                icon={Radio}
                iconClass="text-emerald-500"
                label={selectedAccount?.name || 'Select Account'}
                open={accountOpen}
                setOpen={setAccountOpen}
              >
                {adAccounts.map((acc) => (
                  <button
                    key={acc.id}
                    onClick={() => {
                      setSelectedAccount(acc);
                      setAccountOpen(false);
                      setActiveTab('analytics');
                    }}
                    className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-xs transition hover:bg-gray-100 dark:hover:bg-white/5 ${
                      selectedAccount?.id === acc.id ? 'text-[#4285F4]' : 'text-gray-900 dark:text-white'
                    }`}
                  >
                    <div>
                      <p className={`font-medium ${selectedAccount?.id === acc.id ? 'text-[#4285F4]' : 'text-gray-900 dark:text-white'}`}>
                        {acc.name}
                      </p>
                      <p className="text-[10px] text-[#7A7369] dark:text-[#BEBEBE]">{acc.currency} · {acc.timezone}</p>
                    </div>
                    <StatusBadge status={acc.status === 'ENABLED' ? 'ACTIVE' : 'PAUSED'} />
                  </button>
                ))}
              </PillDropdown>

              <PillDropdown
                icon={Calendar}
                iconClass="text-gray-400"
                label={DATE_PRESETS.find((d) => d.value === datePreset)?.label || 'Date range'}
                open={dateOpen}
                setOpen={setDateOpen}
              >
                {DATE_PRESETS.map((preset) => (
                  <button
                    key={preset.value}
                    onClick={() => {
                      setDatePreset(preset.value);
                      setDateOpen(false);
                    }}
                    className={`block w-full rounded-lg px-3 py-2 text-left text-xs transition hover:bg-gray-100 dark:hover:bg-white/5 ${
                      datePreset === preset.value ? 'text-[#4285F4]' : 'text-gray-900 dark:text-white'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </PillDropdown>
            </>
          )}

          <div className="ml-1 2xl:ml-2">
            <ThemeToggle />
          </div>
        </div>
      </div>

      {/* ── account summary strip ──────────────────────────────────────────── */}
      {selectedAccount && !loadingAccounts && (
        <div className="mb-2 flex flex-wrap items-center justify-between gap-5 border-b border-[#DDD7CD] px-1 py-2 dark:border-white/10">
          <div className="flex flex-wrap items-center gap-5">
            {[
              { label: 'Account', value: selectedAccount.name },
              {
                label: 'Campaigns',
                value: (
                  <>
                    {campaigns.length}
                    {activeCampaigns > 0 && (
                      <span className="ml-1 text-emerald-600 dark:text-emerald-400">({activeCampaigns} active)</span>
                    )}
                  </>
                ),
              },
              { label: 'Currency', value: selectedAccount.currency },
              { label: 'Timezone', value: selectedAccount.timezone },
            ].map((item, i) => (
              <React.Fragment key={item.label}>
                {i > 0 && <div className="h-3.5 w-px self-center bg-gray-300 dark:bg-white/20" />}
                <div className="flex items-center gap-2 text-sm leading-none">
                  <span className="text-xs font-medium uppercase tracking-wider text-[#7A7369] dark:text-white/40">
                    {item.label}
                  </span>
                  <span className="font-semibold text-gray-900 dark:text-white">{item.value}</span>
                </div>
              </React.Fragment>
            ))}
          </div>

          <button
            onClick={() => setShowDisconnectModal(true)}
            disabled={disconnecting}
            className="flex items-center gap-1.5 rounded-xl border border-red-500/20 bg-red-500/5 px-3 py-1.5 text-xs font-bold text-red-600 transition-all hover:border-red-500/40 hover:bg-red-500/10 disabled:opacity-50 dark:text-red-400"
          >
            {disconnecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogOut className="h-3.5 w-3.5" />}
            Disconnect
          </button>
        </div>
      )}

      {/* ── tabs ──────────────────────────────────────────────────────────── */}
      <div className="mb-3 flex items-center justify-between border-b border-[#DDD7CD] dark:border-white/10">
        <div className="flex items-center gap-1">
          {TABS.map((tab) => {
            const TabIcon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`relative flex items-center gap-1.5 px-3.5 py-2.5 text-sm font-semibold transition-all duration-200 ${
                  activeTab === tab.id
                    ? 'text-gray-900 dark:text-white'
                    : 'text-gray-500 hover:text-gray-900 dark:text-[#BEBEBE] dark:hover:text-white/70'
                }`}
              >
                <TabIcon className="h-3.5 w-3.5" />
                {tab.label}
                {activeTab === tab.id && (
                  <motion.div
                    layoutId="googleActiveTab"
                    className="absolute right-0 bottom-0 left-0 h-0.5 rounded-full bg-gray-900 dark:bg-white"
                    transition={{ type: 'spring', bounce: 0.2, duration: 0.35 }}
                  />
                )}
              </button>
            );
          })}
        </div>
        {activeTab === 'audit' && (
          <div className="flex items-center gap-1.5 pr-2">
            <Info className="h-3.5 w-3.5 shrink-0 text-gray-400 dark:text-white/30" />
            <p className="text-xs text-gray-400 dark:text-white/40">
              Audit data reflects the <span className="font-semibold text-gray-500 dark:text-white/60">last 14 days</span> of campaign activity.
            </p>
          </div>
        )}
      </div>

      {/* ── body ──────────────────────────────────────────────────────────── */}
      <div className="relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden px-4 py-4 2xl:px-5 2xl:py-5">
        <AnimatePresence mode="wait">

          {activeTab === 'analytics' && (
            <motion.div
              key="analytics"
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              className="scrollbar-thin flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-base font-bold text-gray-900 2xl:text-xl dark:text-white">Account Analytics</p>
                <button
                  onClick={() => loadAnalytics({ refresh: true })}
                  disabled={loadingInsights}
                  className="flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-10 font-medium text-gray-500 backdrop-blur-xl transition-all hover:border-gray-300 hover:text-gray-900 disabled:opacity-50 dark:border-white/6 dark:bg-[#171717] dark:text-[#BEBEBE] dark:hover:border-white/10 dark:hover:text-white"
                >
                  <RefreshCw className={`h-3 w-3 ${loadingInsights ? 'animate-spin' : ''}`} />
                  Refresh
                </button>
              </div>
              <GoogleAdsAnalyticsPanel analyticsData={analyticsData} loading={loadingInsights} error={analyticsError} currencyCode={selectedAccount?.currency} />
            </motion.div>
          )}

          {activeTab === 'campaigns' && (
            <motion.div
              key="campaigns"
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              className="flex min-h-0 flex-1 flex-col gap-4"
            >
              <div className="flex shrink-0 items-center justify-between gap-2">
                <div>
                  <p className="text-base font-bold text-gray-900 2xl:text-xl dark:text-white">Campaigns</p>
                  <p className="text-xs text-gray-500 2xl:text-sm dark:text-[#BEBEBE]">Manage your Google Ads campaigns</p>
                </div>
              </div>
              {isGoogleDisconnected && (
                <div className="flex items-center justify-between gap-3 rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 dark:bg-red-500/8">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 shrink-0 text-red-500" />
                    <p className="text-xs text-red-600 dark:text-red-400">
                      Your Google Ads account is disconnected. Please reconnect to manage campaigns.
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      const userId = userData?.user_id;
                      const feUrl = window.location.href;
                      window.location.href = `${import.meta.env.VITE_SOCKET_URL}/api/auth/google?userId=${userId}&feUrl=${encodeURIComponent(feUrl)}`;
                    }}
                    className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition-all hover:opacity-90"
                    style={{ background: GOOGLE_BLUE }}
                  >
                    Reconnect Google
                  </button>
                </div>
              )}
              <GoogleAdsCampaignsTable
                campaigns={campaigns}
                loading={loadingCampaigns}
                adAccountId={selectedAccount?.id}
                onRefresh={reloadCampaigns}
                onLaunchWizard={openWizard}
                manageNonce={manageNonce}
                campaignSearch={campaignSearch}
                onLevelChange={setCampaignsLevel}
              />
            </motion.div>
          )}

          {activeTab === 'audit' && (
            <motion.div
              key="audit"
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              className="scrollbar-thin flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto"
            >
              <GoogleAdsAuditTab adAccountId={selectedAccount?.id} />
            </motion.div>
          )}

        </AnimatePresence>
      </div>

      {/* ── wizard ────────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {wizard.open && (
          <CreateCampaignWizard
            open={wizard.open}
            mode={wizard.mode}
            context={wizard.context}
            onClose={closeWizard}
            adAccountId={selectedAccount?.id}
            account={selectedAccount}
            onCreated={handleWizardCreated}
          />
        )}
      </AnimatePresence>

      {/* ── disconnect modal ───────────────────────────────────────────────── */}
      <AnimatePresence>
        {showDisconnectModal &&
          typeof document !== 'undefined' &&
          createPortal(
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-4 backdrop-blur-md"
              onClick={() => setShowDisconnectModal(false)}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 8 }}
                transition={{ duration: 0.18 }}
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-sm rounded-2xl border border-gray-200/80 bg-white p-6 shadow-2xl backdrop-blur-xl dark:border-white/10 dark:bg-[#161616]"
              >
                <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-red-500/10">
                  <LogOut className="h-5 w-5 text-red-600 dark:text-red-400" />
                </div>
                <h2 className="mb-1 text-sm font-bold text-gray-900 dark:text-white">Disconnect Google Ads Account?</h2>
                <p className="mb-6 text-xs text-gray-500 dark:text-[#BEBEBE]">
                  This will remove the connection to your Google Ads account. You can reconnect at any time from the Ads Manager.
                </p>
                <div className="flex items-center justify-end gap-2">
                  <button
                    onClick={() => setShowDisconnectModal(false)}
                    className="rounded-xl border border-gray-200 bg-gray-100 px-4 py-2 text-xs font-medium text-gray-900 transition-all hover:bg-gray-200 dark:border-white/8 dark:bg-white/5 dark:text-white dark:hover:bg-white/10"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      setShowDisconnectModal(false);
                      handleDisconnect();
                    }}
                    disabled={disconnecting}
                    className="flex items-center gap-1.5 rounded-xl bg-red-500/80 px-4 py-2 text-xs font-bold text-white transition-all hover:bg-red-500 disabled:opacity-50"
                  >
                    {disconnecting && <Loader2 className="h-3 w-3 animate-spin" />}
                    Disconnect
                  </button>
                </div>
              </motion.div>
            </motion.div>,
            document.body
          )}
      </AnimatePresence>
    </div>
  );
}
