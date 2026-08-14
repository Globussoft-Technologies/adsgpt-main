import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
// eslint-disable-next-line no-unused-vars -- motion is used as <motion.div> below; the project's lint rule doesn't track JSX dotted access.
import { motion, AnimatePresence } from 'framer-motion';
import { FaMeta } from 'react-icons/fa6';
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
  Inbox,
  SlidersHorizontal,
} from 'lucide-react';
import {
  getAdAccounts,
  getCampaigns,
  getAnalyticsData,
  getUserAdPostingInfo,
  metaDisconnect,
  getAnalyticsMetricsCatalog,
  getMetaAdsPreference,
} from '@/apis/metaAds/metaAdsApi';
import { globalToast } from '@/utils/globalToast';
import { DateRange } from 'react-date-range';
import { format } from 'date-fns';
// Calendar base styles. The light/dark theming on top of these lives in
// App.css under `.date-range-picker-dark` / `.rdr*`, shared with Autopilot's
// date pill and AdStudio's DateRangeFilter.
import 'react-date-range/dist/styles.css';
import 'react-date-range/dist/theme/default.css';
import {
  DATE_PRESETS,
  STATUS_MAP,
  formatDateRangeLabel,
  PLAN_LIMITS,
  readPlanLimit,
  readManagedCampaignIds,
} from './metaAdsUtils';
import { AnalyticsPanel, AuditTab } from './MetaAdsPanels';
import MetricsPicker from './MetricsPicker';
import { TableViewCampaigns } from './MetaAdsTableView';
import { StatusBadge, Dropdown } from './MetaAdsAtoms';
import CreateCampaignWizard from './CreateCampaignWizard';
import CreateCampaignWizardV2 from './CreateCampaignWizardV2';
import LeadsTab from './LeadsTab';
import MetaAdsChatWidget from './Chatbot/MetaAdsChatWidget';
import FacebookAccountSelector from './FacebookAccountSelector';
import WorkspaceSwitcher from '@/components/workspace/WorkspaceSwitcher';
import AdsManagerModeSwitcher from '@/components/AdsManager/AdsManagerModeSwitcher';
import { IS_META_ADS_CHAT_ENABLED, isAdsChatAllowedForEmail } from '@/utils/featureFlags';
import { GA4Events } from '@/utils/ga4';
import Cookies from 'js-cookie';
import { clearSelectedFacebookId, setSelectedFacebookId } from '@/utils/metaFacebookAccount';

// V2 wizard is gated on a build-time env var so V1 keeps running by
// default. When V2 is ready for the migrated objectives we flip this
// to true in the relevant env file. See docs/CAMPAIGN_CREATION_PARITY_PLAN.md.
const FEATURE_WIZARD_V2 = import.meta.env.VITE_FEATURE_WIZARD_V2 === 'true';
import { useSelector } from 'react-redux';
import { useNavigate, useSearchParams } from 'react-router-dom';

export default function MetaAdsDashboard() {
  const { userData } = useSelector((state) => state.socket);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [adAccounts, setAdAccounts] = useState([]);
  // { allowed, managed } when the user's plan caps managed ad accounts
  // (admin Plans page), null when unlimited/unknown. Visibility only — the
  // account list itself is never filtered by this, see getAdAccountsList's
  // comment on why a hard per-account block isn't implemented.
  const [adAccountUsage, setAdAccountUsage] = useState(null);
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [campaigns, setCampaigns] = useState([]);
  // { allowed, managed } when the user's plan caps managed campaigns (admin
  // Plans page), null when unlimited/unknown. Drives the proactive "New
  // Campaign" disabled state — createCampaignV2 is the real enforcement
  // point (see its plan-limit check), this is just avoiding a wasted trip
  // through the whole wizard when the cap is already known to be hit.
  const [campaignUsage, setCampaignUsage] = useState(null);
  // Campaign ids holding a plan slot. `null` = the plan is uncapped and the
  // backend sent no managed-slot state, so NOTHING is locked — distinct from
  // an empty Set, which means "capped, and the user manages none yet".
  const [managedCampaignIds, setManagedCampaignIds] = useState(null);
  const [analyticsData, setAnalyticsData] = useState(null);
  // Date window for every metric on the page. Seeded from the URL so a
  // refresh or a shared link restores the same window — which matters more
  // now that table metric columns depend on it too: losing it silently
  // changes every number on screen back to the default.
  const [dateRange, setDateRange] = useState(() => {
    const raw = searchParams.get('date');
    if (raw === 'custom') {
      const since = searchParams.get('since');
      const until = searchParams.get('until');
      if (since && until) return { preset: 'custom', since, until };
      return { preset: 'last_14d', since: null, until: null };
    }
    const known = DATE_PRESETS.some((p) => p.value === raw && p.value !== 'custom');
    return { preset: known ? raw : 'last_14d', since: null, until: null };
  });

  // The single shape every metrics call takes, so no call site has to know
  // about the 'custom' sentinel.
  const dateParams = useMemo(
    () =>
      dateRange.preset === 'custom'
        ? { since: dateRange.since, until: dateRange.until }
        : { datePreset: dateRange.preset },
    [dateRange],
  );

  // Mirror the window into the URL (replace, not push — changing the date
  // shouldn't stack up back-button entries).
  useEffect(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (dateRange.preset === 'custom' && dateRange.since && dateRange.until) {
          next.set('date', 'custom');
          next.set('since', dateRange.since);
          next.set('until', dateRange.until);
        } else {
          next.set('date', dateRange.preset);
          next.delete('since');
          next.delete('until');
        }
        return next;
      },
      { replace: true },
    );
    // setSearchParams identity is stable; only the window should retrigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateRange]);
  // A refresh with a drilled-down campaign/ad set/ad still in the URL should
  // land back on the Campaigns tab (where TableViewCampaigns restores the
  // drill-down itself) instead of bouncing to Analytics.
  const [activeTab, setActiveTab] = useState(() =>
    searchParams.get('campaignId') ? 'campaigns' : 'analytics',
  );

  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);
  const [loadingInsights, setLoadingInsights] = useState(false);

  const [accountOpen, setAccountOpen] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [showDisconnectModal, setShowDisconnectModal] = useState(false);

  // Selectable Analytics metrics — catalog is static (fetched once), the
  // preference is the user's saved selection (global, not per ad account).
  // See MetricsPicker.jsx for the picker UI and config/metricsCatalog.js for
  // the backend catalog this mirrors.
  const [metricsCatalog, setMetricsCatalog] = useState([]);
  const [visibleMetricKeys, setVisibleMetricKeys] = useState([]);
  // Metric COLUMNS per entity table, keyed by level. Empty until the user
  // opts in, so the tables render exactly as they did before this feature
  // and make no metrics request at all.
  const [tableMetricKeys, setTableMetricKeys] = useState({
    campaign: [],
    adset: [],
    ad: [],
  });
  const [metricsPickerOpen, setMetricsPickerOpen] = useState(false);
  // Set when the picker actually persists a change, so closing it can
  // refetch analytics ONCE. `stats` only contains the keys that were
  // selected at fetch time, so without a refetch a newly-picked metric
  // renders as an empty "—" card against the previous payload. Batched on
  // close rather than fired per debounced save — toggling ten metrics
  // should cost one Meta round-trip, not ten.
  const metricsSelectionDirtyRef = useRef(false);
  useEffect(() => {
    let alive = true;
    Promise.all([getAnalyticsMetricsCatalog(), getMetaAdsPreference()])
      .then(([catalogRes, prefRes]) => {
        if (!alive) return;
        setMetricsCatalog(catalogRes?.catalog || []);
        const pref = prefRes?.preference;
        setVisibleMetricKeys(pref?.analytics?.visibleMetricKeys || []);
        setTableMetricKeys({
          campaign: pref?.tables?.campaign || [],
          adset: pref?.tables?.adset || [],
          ad: pref?.tables?.ad || [],
        });
      })
      .catch(() => {
        /* AnalyticsPanel falls back to rendering whatever keys `stats`
           already has if the catalog/preference fetch fails. */
      });
    return () => {
      alive = false;
    };
  }, []);
  const [selectedFacebookAccount, setSelectedFacebookAccount] = useState(null);
  // Both sides have to actually exist before the comparison means anything.
  // `selectedFacebookAccount` starts as null and `userData` starts as `{}`
  // (socketSlice's initial state — it is NOT persisted), so on the first
  // render after a hard refresh both `null?.userId` and `userData?.user_id`
  // evaluate to undefined. A bare `===` then reports a match and the true
  // branch dereferences the null account:
  //   "Cannot read properties of null (reading 'facebookId')".
  const activeFacebookId =
    selectedFacebookAccount?.facebookId &&
    userData?.user_id &&
    selectedFacebookAccount.userId === userData.user_id
      ? selectedFacebookAccount.facebookId
      : '';
  const [facebookSelectorKey, setFacebookSelectorKey] = useState(0);
  const accountsRequestRef = useRef(0);
  const campaignsRequestRef = useRef(0);
  const analyticsRequestRef = useRef(0);
  // Set when "Start from template" needs to land on a specific ad account
  // AFTER switching Facebook connections (the template's account belongs to
  // a different connection than the one currently active). Consumed by the
  // ad-accounts-loading effect once the new connection's list arrives.
  const pendingTemplateAccountRef = useRef(null);
  // Wizard launcher — one modal serves create (full), add-ad-set, and
  // add-ad flows. `mode` + `context` drive which steps render.
  const [wizard, setWizard] = useState({ open: false, mode: 'create-full', context: null });
  // Bumped after an add succeeds so the drilled-down Ad Set / Ads tables
  // refetch and show the new row.
  const [manageNonce, setManageNonce] = useState(0);
  const openWizard = useCallback(
    (mode, context = null) => setWizard({ open: true, mode, context }),
    [],
  );
  const closeWizard = useCallback(
    () => setWizard((w) => ({ ...w, open: false })),
    [],
  );

  // Deep-link entry: callers (e.g. the TemplatePicker empty-state in
  // AdFactory Automation) navigate here with `?openWizard=create-full` to
  // jump straight into the New Campaign flow. Switch to the Campaigns tab
  // so the wizard's "Campaigns refreshed" outcome lands on the right view,
  // open the wizard, then strip the query param so a refresh / back-nav
  // doesn't keep re-opening it.
  const autoOpenWizardMode = searchParams.get('openWizard');
  useEffect(() => {
    if (searchParams.get('auth') === 'success') {
      GA4Events.adsManagerConnectedWithMeta({ source: 'meta_oauth', success: true });
      const next = new URLSearchParams(searchParams);
      next.delete('auth');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (!autoOpenWizardMode) return;
    setActiveTab('campaigns');
    openWizard(autoOpenWizardMode);
    const next = new URLSearchParams(searchParams);
    next.delete('openWizard');
    setSearchParams(next, { replace: true });
    // Intentionally only watches the param value — setSearchParams identity
    // is stable but listing it keeps the lint rule happy.
  }, [autoOpenWizardMode, openWizard, searchParams, setSearchParams]);

  const reloadCampaigns = useCallback(async () => {
    const facebookId = activeFacebookId;
    if (!selectedAccount || !facebookId) return;
    const requestId = ++campaignsRequestRef.current;
    setLoadingCampaigns(true);
    try {
      const r = await getCampaigns(selectedAccount.id, {
        refresh: true,
        facebookId,
      });
      if (requestId === campaignsRequestRef.current) {
        setCampaigns(r.campaigns || []);
        setCampaignUsage(readPlanLimit(r, PLAN_LIMITS.metaCampaigns));
        setManagedCampaignIds(readManagedCampaignIds(r));
      }
    } catch { /* noop */ } finally {
      if (requestId === campaignsRequestRef.current) {
        setLoadingCampaigns(false);
      }
    }
  }, [selectedAccount, activeFacebookId]);

  // verify user token on mount — redirect to /ads-manager on 404
  useEffect(() => {
    const userId = userData?.user_id;
    const facebookId = activeFacebookId;
    if (!userId || !facebookId) return;
    let cancelled = false;
    (async () => {
      try {
        await getUserAdPostingInfo(userId, { facebookId });
      } catch (err) {
        if (!cancelled && err?.response?.status === 404) {
          navigate('/ads-manager');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userData?.user_id, activeFacebookId, navigate]);

  // Switch the active ad account — updates the URL (`adAccountId`) so a
  // refresh restores the same account instead of falling back to the first
  // one, and drops any campaign/ad set/ad drill-down param since those IDs
  // belong to the account being left.
  const selectAccount = useCallback(
    (acc) => {
      setSelectedAccount(acc);
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (acc?.id) next.set('adAccountId', acc.id);
        else next.delete('adAccountId');
        next.delete('campaignId');
        next.delete('adSetId');
        next.delete('adId');
        return next;
      });
    },
    [setSearchParams],
  );

  // load ad accounts — restore the one named in the URL (if any/still valid),
  // otherwise fall back to the first account. This reruns for Facebook
  // identity changes; searchParams itself stays out of the dependency list
  // because selecting an ad account rewrites the URL.
  useEffect(() => {
    const facebookId = activeFacebookId;
    const requestId = ++accountsRequestRef.current;
    if (!facebookId) {
      setAdAccounts([]);
      setAdAccountUsage(null);
      setSelectedAccount(null);
      setLoadingAccounts(false);
      return;
    }
    setLoadingAccounts(true);
    (async () => {
      try {
        const res = await getAdAccounts({ facebookId });
        if (requestId !== accountsRequestRef.current) return;
        const accounts = res.adAccounts || [];
        setAdAccounts(accounts);
        setAdAccountUsage(readPlanLimit(res, PLAN_LIMITS.metaAdAccounts));
        if (accounts.length) {
          // A cross-connection template apply is waiting to land on a
          // specific account now that this (new) connection's list has
          // loaded — takes priority over URL restoration / first-account
          // fallback. Falls through to that normal logic if the account
          // isn't actually visible under this connection (stale template,
          // revoked access, etc.) rather than leaving the account blank.
          const pending = pendingTemplateAccountRef.current;
          if (pending && pending.facebookId === facebookId) {
            pendingTemplateAccountRef.current = null;
            const target = accounts.find((a) => a.id === pending.adAccountId);
            if (target) {
              selectAccount(target);
              return;
            }
            globalToast.error(
              "This template's ad account isn't visible under that Facebook connection.",
            );
          }
          // eslint-disable-next-line react-hooks/exhaustive-deps
          const urlAccountId = searchParams.get('adAccountId');
          const restored = urlAccountId && accounts.find((a) => a.id === urlAccountId);
          if (restored) {
            // Already the right account per the URL — set it directly rather
            // than through selectAccount(), which also strips
            // campaignId/adSetId/adId (correct for an explicit account
            // switch, wrong here: we're restoring the SAME account a
            // refresh just navigated away from and back to).
            setSelectedAccount(restored);
          } else {
            // No valid account in the URL yet (fresh visit, or a stale/
            // unknown id) — fall back to the first account. selectAccount()
            // writes adAccountId and clears any drill-down params, which is
            // correct here since they can't be trusted to belong to this
            // account.
            selectAccount(accounts[0]);
          }
        }
      } catch {
        /* noop */
      } finally {
        if (requestId === accountsRequestRef.current) {
          setLoadingAccounts(false);
        }
      }
    })();
    return () => {
      if (requestId === accountsRequestRef.current) {
        accountsRequestRef.current += 1;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFacebookId]);

  // load campaigns when account changes
  useEffect(() => {
    const facebookId = activeFacebookId;
    if (!selectedAccount || !facebookId) return;
    const requestId = ++campaignsRequestRef.current;
    (async () => {
      setLoadingCampaigns(true);
      setCampaigns([]);
      setAnalyticsData(null);
      try {
        const res = await getCampaigns(selectedAccount.id, { facebookId });
        if (requestId === campaignsRequestRef.current) {
          setCampaigns(res.campaigns || []);
          setCampaignUsage(readPlanLimit(res, PLAN_LIMITS.metaCampaigns));
          setManagedCampaignIds(readManagedCampaignIds(res));
        }
      } catch {
        /* noop */
      } finally {
        if (requestId === campaignsRequestRef.current) {
          setLoadingCampaigns(false);
        }
      }
    })();
    return () => {
      if (requestId === campaignsRequestRef.current) {
        campaignsRequestRef.current += 1;
      }
    };
  }, [selectedAccount, activeFacebookId]);

  // load analytics. `refresh` (from the Refresh button) skips the server's
  // 5-min cache — without it the button just re-served the same cached
  // payload, so a user seeing stale/incomplete data had no way to recover
  // except waiting out the TTL.
  const loadAnalytics = useCallback(async ({ refresh = false } = {}) => {
    const facebookId = activeFacebookId;
    if (!selectedAccount || !facebookId) return;
    const requestId = ++analyticsRequestRef.current;
    setLoadingInsights(true);
    setAnalyticsData(null);
    try {
      const res = await getAnalyticsData({
        adAccountId: selectedAccount.id,
        ...dateParams,
        facebookId,
        refresh,
      });
      if (requestId === analyticsRequestRef.current) {
        setAnalyticsData(res);
      }
    } catch {
      /* noop */
    } finally {
      if (requestId === analyticsRequestRef.current) {
        setLoadingInsights(false);
      }
    }
  }, [selectedAccount, dateParams, activeFacebookId]);

  useEffect(() => {
    if (activeTab !== 'analytics') return undefined;
    loadAnalytics();
    return () => {
      analyticsRequestRef.current += 1;
    };
  }, [activeTab, loadAnalytics]);

  const handleDisconnect = async () => {
    const userId = userData?.user_id;
    if (!userId || !activeFacebookId) return;
    setDisconnecting(true);
    try {
      const facebookId = activeFacebookId;
      const res = await metaDisconnect(userId, facebookId);
      globalToast.success(res?.message || 'Disconnected successfully');
      clearSelectedFacebookId(userId, facebookId);
      setSelectedFacebookAccount(null);
      setAdAccounts([]);
      setAdAccountUsage(null);
      setSelectedAccount(null);
      setCampaigns([]);
      setCampaignUsage(null);
      setManagedCampaignIds(null);
      setFacebookSelectorKey((value) => value + 1);
      setShowDisconnectModal(false);
    } catch {
      globalToast.error('Failed to disconnect Meta account');
    } finally {
      setDisconnecting(false);
    }
  };

  const activeCampaigns = campaigns.filter((c) => c.status === 'ACTIVE').length;

  const TABS = [
    { id: 'analytics', label: 'Analytics', icon: TrendingUp },
   
    // { id: 'audit', label: 'Audit', icon: ClipboardList },
    { id: 'campaigns', label: 'Campaigns', icon: Layers },
    { id: 'leads', label: 'Leads', icon: Inbox },
  ];

  return (
    // Row layout: the main dashboard column (flex-1) sits beside the docked
    // Ads Chat sidebar, so opening the chat shrinks the content instead of
    // covering it.
    <div className="flex h-full w-full overflow-hidden">
      <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
      {/* grid dot bg */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.012]"
        style={{
          backgroundImage: 'radial-gradient(circle at 1px 1px, white 1px, transparent 0)',
          backgroundSize: '24px 24px',
        }}
      />
      {/* ambient glow */}
      <div className="pointer-events-none absolute -top-32 left-1/2 h-64 w-96 -translate-x-1/2 rounded-full bg-gray-200 blur-3xl dark:bg-white/3" />

      {/* ── header ─────────────────────────────────────────────────────────── */}
      <div className="relative z-50 flex flex-shrink-0 flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-5 py-3 pr-14 2xl:px-6 2xl:py-4 2xl:pr-16 dark:border-white/[0.06]">
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200 bg-white dark:border-white/20">
            <FaMeta className="h-5 w-5 text-[#0082FB]" />
          </div>
          <div className="flex flex-col gap-3">
            <AdsManagerModeSwitcher
              activeMode="manager"
              platform="Meta"
              autopilotAvailable
              appearance="tabs"
            />
            <p className="text-[15px] text-gray-500 dark:text-[#BEBEBE]">Manage · Analyse · Optimise</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <WorkspaceSwitcher />
          <FacebookAccountSelector
            key={facebookSelectorKey}
            userId={userData?.user_id}
            onChange={(account) => {
              const nextId = account?.facebookId || '';
              if (
                nextId === activeFacebookId &&
                selectedFacebookAccount?.userId === userData?.user_id
              ) return;
              setSelectedFacebookAccount(account);
              setAdAccounts([]);
              setAdAccountUsage(null);
              setSelectedAccount(null);
              setCampaigns([]);
              setCampaignUsage(null);
              setManagedCampaignIds(null);
              setAnalyticsData(null);
            }}
          />
          {/* account picker */}
          <Dropdown
            open={accountOpen}
            onClose={() => setAccountOpen(false)}
            trigger={
              <button
                onClick={() => setAccountOpen((p) => !p)}
                className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs text-gray-900 backdrop-blur-xl transition-all hover:border-gray-300 dark:border-white/[0.06] dark:bg-[#171717] dark:text-white dark:hover:border-white/10"
              >
                {loadingAccounts ? (
                  <Loader2 className="h-3 w-3 animate-spin text-gray-500 dark:text-[#BEBEBE]" />
                ) : (
                  <>
                    <Radio className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                    <span className="max-w-[150px] truncate font-medium">
                      {selectedAccount?.name ?? 'Select Account'}
                    </span>
                    <ChevronDown className="h-3 w-3 text-gray-500 dark:text-[#BEBEBE]" />
                  </>
                )}
              </button>
            }
          >
            <div className="w-72 p-1">
              {/* Visibility only — no account below is actually blocked from
                  selection. See getAdAccountsList's comment on why a hard
                  per-account cutoff isn't implemented (accounts arrive in
                  bulk per Facebook connection, not one at a time). */}
              {adAccountUsage && adAccountUsage.managed > adAccountUsage.allowed && (
                <div className="mb-1 flex items-center gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-10 font-medium text-amber-700 dark:bg-amber-400/10 dark:text-amber-300">
                  <Info className="h-3 w-3 shrink-0" />
                  <span className="truncate">
                    {adAccountUsage.managed} of {adAccountUsage.allowed} ad accounts used — plan limit reached
                  </span>
                </div>
              )}
              <div className="max-h-55 overflow-y-auto pr-0.5 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-gray-300 [&::-webkit-scrollbar-track]:bg-transparent dark:[&::-webkit-scrollbar-thumb]:bg-white/20">
                {loadingAccounts ? (
                  <div className="flex items-center justify-center py-6">
                    <Loader2 className="h-4 w-4 animate-spin text-gray-500 dark:text-[#BEBEBE]" />
                  </div>
                ) : adAccounts.length === 0 ? (
                  <p className="px-3 py-4 text-center text-xs text-gray-500 dark:text-[#BEBEBE]">
                    No ad accounts found
                  </p>
                ) : (
                  adAccounts.map((acc) => (
                    <button
                      key={acc.id}
                      onClick={() => {
                        selectAccount(acc);
                        setAccountOpen(false);
                        setActiveTab('analytics');
                      }}
                      className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left transition-all hover:bg-gray-100 dark:hover:bg-white/5 ${selectedAccount?.id === acc.id ? 'bg-gray-100 dark:bg-white/5' : ''}`}
                    >
                      <div>
                        <p
                          className={`text-xs font-medium ${selectedAccount?.id === acc.id ? 'text-[#15DCFF]' : 'text-gray-900 dark:text-white'}`}
                        >
                          {acc.name}
                        </p>
                        <p className="text-10 text-gray-900 dark:text-white">Spent: {acc.amountSpent}</p>
                      </div>
                      <StatusBadge status={acc.status === 1 ? 'ACTIVE' : 'PAUSED'} />
                    </button>
                  ))
                )}
              </div>
            </div>
          </Dropdown>

          {/* Date window. Shown on Analytics AND Campaigns — the tables'
              metric columns are scoped by it too, so hiding it there would
              leave those numbers unexplained. */}
          {(activeTab === 'analytics' || activeTab === 'campaigns') && (
            <Dropdown
              open={dateOpen}
              onClose={() => setDateOpen(false)}
              trigger={
                <button
                  onClick={() => setDateOpen((p) => !p)}
                  className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs text-gray-900 backdrop-blur-xl transition-all hover:border-gray-300 dark:border-white/[0.06] dark:bg-[#171717] dark:text-white dark:hover:border-white/10"
                >
                  <Calendar className="h-3 w-3 text-gray-900 dark:text-white" />
                  <span className="font-medium">{formatDateRangeLabel(dateRange)}</span>
                  <ChevronDown className="h-3 w-3 text-gray-500 dark:text-[#BEBEBE]" />
                </button>
              }
            >
              {/* Presets on the left, calendar on the right — the layout
                  Ads Manager itself uses, and it avoids a mode-switch
                  between "pick a preset" and "pick a range". */}
              <div className="flex items-stretch">
                <div className="w-44 shrink-0 border-r border-gray-200 p-1 dark:border-white/10">
                  <div className="max-h-[360px] overflow-y-auto pr-0.5">
                    {DATE_PRESETS.filter((p) => p.value !== 'custom').map((preset) => (
                      <button
                        key={preset.value}
                        onClick={() => {
                          setDateRange({ preset: preset.value, since: null, until: null });
                          setDateOpen(false);
                        }}
                        className={`w-full rounded-xl px-3 py-2 text-left text-xs transition-all hover:bg-gray-100 dark:hover:bg-white/5 ${dateRange.preset === preset.value ? 'bg-gray-100 text-[#15DCFF] dark:bg-white/5' : 'text-gray-900 dark:text-white'}`}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>
                <CustomRangeFields
                  since={dateRange.since}
                  until={dateRange.until}
                  onApply={(since, until) => {
                    setDateRange({ preset: 'custom', since, until });
                    setDateOpen(false);
                  }}
                />
              </div>
            </Dropdown>
          )}
        </div>
      </div>

      {/* ── account summary strip ──────────────────────────────────────────── */}
      {selectedAccount && !loadingAccounts && (
        <div className="relative z-30 flex flex-shrink-0 flex-wrap items-center justify-between gap-5 border-b border-gray-200 px-5 py-2 2xl:px-6 dark:border-white/[0.04]">
          {[
            {
              label: 'Account',
              value: <span className="font-semibold text-gray-900 dark:text-white">{selectedAccount.name}</span>,
            },
            {
              label: 'Lifetime Spent',
              value: <span className="font-semibold text-gray-900 dark:text-white">{selectedAccount.amountSpent}</span>,
            },
            {
              label: 'Campaigns',
              value: (
                <span className="font-semibold text-gray-900 dark:text-white">
                  {campaigns.length}
                  {activeCampaigns > 0 && (
                    <span className="ml-1 text-emerald-600 dark:text-emerald-400">({activeCampaigns} active)</span>
                  )}
                </span>
              ),
            },
            {
              label: 'Currency',
              value: <span className="font-semibold text-gray-900 dark:text-white">{selectedAccount.currency}</span>,
            },
          ].map(({ label, value }, i) => (
            <React.Fragment key={label}>
              {i > 0 && <div className="h-4 w-px bg-gray-200 dark:bg-white/[0.06]" />}
              <div className="flex items-center gap-2 text-sm 2xl:text-15">
                <span className="text-xs font-medium uppercase tracking-wider text-gray-400 dark:text-white/40">{label}</span>
                {value}
              </div>
            </React.Fragment>
          ))}
          <button
            onClick={() => setShowDisconnectModal(true)}
            disabled={disconnecting}
            className="ml-auto flex items-center gap-1.5 rounded-xl border border-red-500/20 bg-red-500/5 px-3 py-1.5 text-xs  text-red-600 font-bold transition-all hover:border-red-500/40  hover:bg-red-500/10 disabled:opacity-50 dark:text-red-400"
          >
            {disconnecting ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <LogOut className="h-3 w-3" />
            )}
            {disconnecting ? 'Removing…' : 'Remove account'}
          </button>
        </div>
      )}

      {/* ── tabs ──────────────────────────────────────────────────────────── */}
      <div className="relative z-40 flex flex-shrink-0 items-center justify-between border-b border-gray-200 px-5 2xl:px-6 dark:border-white/6">
        <div className="flex items-center gap-0.5">
          {TABS.map((tab) => {
            const { id, label } = tab;
            // Capitalized so the lint rule's varsIgnorePattern (^[A-Z_]) covers it —
            // the project's ESLint doesn't track JSX usage of component vars.
            const TabIcon = tab.icon;
            return (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`relative flex items-center gap-1.5 px-3 py-3 text-sm font-semibold transition-all duration-200 ${activeTab === id ? 'text-gray-900 dark:text-white' : 'text-gray-500 hover:text-gray-900 dark:text-[#BEBEBE] dark:hover:text-white/70'}`}
            >
              <TabIcon className="h-3.5 w-3.5" />
              {label}
              {activeTab === id && (
                <motion.div
                  layoutId="activeTab"
                  className="absolute right-0 bottom-0 left-0 h-0.5 rounded-full bg-gray-900 dark:bg-white/60"
                  transition={{ type: 'spring', bounce: 0.2, duration: 0.35 }}
                />
              )}
            </button>
            );
          })}
        </div>
        {activeTab === 'audit' && (
          <div className="flex items-center gap-1.5">
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
          {/* campaigns tab — table view */}
          {activeTab === 'campaigns' && (
            <motion.div
              key="campaigns"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              className="flex min-h-0 flex-1 flex-col gap-6"
            >
              <div className="shrink-0">
                <p className="text-base font-bold text-gray-900 2xl:text-xl dark:text-white">Campaigns</p>
                <p className="text-xs 2xl:text-sm text-gray-500 dark:text-[#BEBEBE]">Build and manage Meta Ads Manager campaigns end-to-end</p>
              </div>
              <TableViewCampaigns
                campaigns={campaigns}
                loadingCampaigns={loadingCampaigns}
                adAccountId={selectedAccount?.id}
                onRefresh={reloadCampaigns}
                onNewCampaign={() => openWizard('create-full')}
                campaignUsage={campaignUsage}
                managedCampaignIds={managedCampaignIds}
                onManagedCampaignsChanged={reloadCampaigns}
                facebookId={activeFacebookId}
                // Add-Ad-Set / Add-Ad / Edit buttons all open the V2 wizard
                // with mode/context — only expose them when V2 is enabled.
                // (V1 wizard doesn't understand these modes.)
                onLaunchWizard={FEATURE_WIZARD_V2 ? openWizard : null}
                manageNonce={manageNonce}
                metricsCatalog={metricsCatalog}
                tableMetricKeys={tableMetricKeys}
                onTableMetricsSaved={(level, keys) =>
                  setTableMetricKeys((prev) => ({ ...prev, [level]: keys }))
                }
                dateParams={dateParams}
                dateLabel={formatDateRangeLabel(dateRange)}
              />
            </motion.div>
          )}

          {/* analytics tab */}
          {activeTab === 'analytics' && (
            <motion.div
              key="analytics"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              className="scrollbar-thin flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-base 2xl:text-xl font-bold text-gray-900 dark:text-white">Account Analytics</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setMetricsPickerOpen(true)}
                    className="flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-10 font-medium text-gray-500 backdrop-blur-xl transition-all hover:border-gray-300 hover:text-gray-900 dark:border-white/[0.06] dark:bg-[#171717] dark:text-[#BEBEBE] dark:hover:border-white/10 dark:hover:text-white"
                  >
                    <SlidersHorizontal className="h-3 w-3" />
                    Customize metrics
                  </button>
                  <button
                    onClick={() => loadAnalytics({ refresh: true })}
                    disabled={loadingInsights}
                    className="flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-10 font-medium text-gray-500 backdrop-blur-xl transition-all hover:border-gray-300 hover:text-gray-900 disabled:opacity-50 dark:border-white/[0.06] dark:bg-[#171717] dark:text-[#BEBEBE] dark:hover:border-white/10 dark:hover:text-white"
                  >
                    <RefreshCw className={`h-3 w-3 ${loadingInsights ? 'animate-spin' : ''}`} />
                    Refresh
                  </button>
                </div>
              </div>
              <AnalyticsPanel
                analyticsData={analyticsData}
                loading={loadingInsights}
                metricsCatalog={metricsCatalog}
                visibleMetricKeys={visibleMetricKeys}
              />
            </motion.div>
          )}

          {/* audit tab */}
          {activeTab === 'audit' && (
            <motion.div
              key="audit"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              className="scrollbar-thin flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto"
            >
              <AuditTab adAccountId={selectedAccount?.id} />
            </motion.div>
          )}

          {/* leads tab — view + download captured Instant-Form leads. */}
          {activeTab === 'leads' && (
            <motion.div
              key="leads"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              className="flex min-h-0 flex-1 flex-col"
            >
              <LeadsTab
                adAccountId={selectedAccount?.id}
                facebookId={activeFacebookId}
              />
            </motion.div>
          )}

        </AnimatePresence>
      </div>

      {/* ── create / add-to-existing wizard ────────────────────────────────── */}
      {FEATURE_WIZARD_V2 ? (
        <CreateCampaignWizardV2
          open={wizard.open}
          mode={wizard.mode}
          context={wizard.context}
          onClose={closeWizard}
          adAccountId={selectedAccount?.id}
          activeFacebookId={activeFacebookId}
          account={selectedAccount}
          // Lets "Start from template" swap the active ad account on the
          // dashboard when the template was saved against a different one —
          // and, when the template's `facebookId` differs from the connection
          // currently active, switch Facebook connections first. We can't
          // select an ad account that isn't in the OTHER connection's list, so
          // stash the target and let the connection switch land it once that
          // connection's accounts have loaded (see pendingTemplateAccountRef
          // + the ad-accounts-loading effect above).
          onChangeAccount={(nextId, templateFacebookId) => {
            if (templateFacebookId && templateFacebookId !== activeFacebookId) {
              pendingTemplateAccountRef.current = {
                facebookId: templateFacebookId,
                adAccountId: nextId,
              };
              setSelectedFacebookId(userData?.user_id, templateFacebookId);
              setFacebookSelectorKey((k) => k + 1);
              return;
            }
            const next = adAccounts.find((a) => a.id === nextId);
            if (next) {
              selectAccount(next);
            } else {
              globalToast.error(
                "This template's ad account isn't visible under the current Facebook connection.",
              );
            }
          }}
          onCreated={() => {
            // Campaign-level changes (new campaign or edited campaign) reload
            // the Campaigns list; an added ad set / ad refreshes the
            // drilled-down table in place.
            if (wizard.mode === 'create-full' || wizard.mode === 'edit-campaign') {
              if (wizard.mode === 'create-full') setActiveTab('campaigns');
              reloadCampaigns();
            } else {
              setManageNonce((n) => n + 1);
            }
          }}
        />
      ) : (
        <CreateCampaignWizard
          open={wizard.open}
          onClose={closeWizard}
          account={selectedAccount}
          onCreated={() => {
            setActiveTab('campaigns');
            reloadCampaigns();
          }}
        />
      )}

      {/* ── disconnect confirmation modal ──────────────────────────────────── */}
      <AnimatePresence>
        {showDisconnectModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-100 flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={() => setShowDisconnectModal(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 8 }}
              transition={{ duration: 0.18 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-6 shadow-2xl dark:border-white/8 dark:bg-[#161616]"
            >
              <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-red-500/10">
                <LogOut className="h-5 w-5 text-red-600 dark:text-red-400" />
              </div>
              <h2 className="mb-1 text-sm font-bold text-gray-900 dark:text-white">Remove Facebook Account?</h2>
              <p className="mb-6 text-xs text-gray-500 dark:text-[#BEBEBE]">
                This removes {selectedFacebookAccount?.name || 'the selected Facebook account'} from
                AdsGPT. Your other connected Facebook accounts are not affected.
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
                  className="flex items-center gap-1.5 rounded-xl font-bold bg-red-500/80 px-4 py-2 text-xs  text-white transition-all hover:bg-red-500 disabled:opacity-50"
                >
                  {disconnecting && <Loader2 className="h-3 w-3 animate-spin" />}
                  Remove account
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      </div>

      {/* ── customize-metrics modal ─────────────────────────────────────────── */}
      <MetricsPicker
        open={metricsPickerOpen}
        onClose={() => {
          setMetricsPickerOpen(false);
          // Refetch so `stats` includes the newly-selected metrics —
          // otherwise their cards render "—" against the pre-change payload.
          // `refresh: true` is required: the server response is cached and,
          // although the cache key is fingerprinted by selection, a
          // previously-cached entry for this exact new selection would still
          // be served stale-but-shaped-right.
          if (metricsSelectionDirtyRef.current) {
            metricsSelectionDirtyRef.current = false;
            loadAnalytics({ refresh: true });
          }
        }}
        catalog={metricsCatalog}
        visibleKeys={visibleMetricKeys}
        onSaved={(keys) => {
          setVisibleMetricKeys(keys);
          metricsSelectionDirtyRef.current = true;
        }}
        maxSelected={80}
      />

      {/* ── docked Ads Chat sidebar (pushes the content when open) ─────────── */}
      {/* Still in active development — double-gated: VITE_FEATURE_META_ADS_CHAT
          is the build-wide switch, and on top of that only emails listed in
          VITE_META_ADS_CHAT_ALLOWED_EMAILS actually see the launcher icon.
          campaignId/adSetId/adId read straight from the URL — the same params
          TableViewCampaigns drills into — so the chat always knows what's
          currently open, even after a refresh.
          Hidden while the create/edit wizard is open — its floating launcher
          button (fixed bottom-right, z-60) sits on top of the wizard's own
          footer controls otherwise. */}
      {!wizard.open && (
        <MetaAdsChatWidget
          adAccountId={selectedAccount?.id}
          adAccountName={selectedAccount?.name}
          adAccountCurrency={selectedAccount?.currency}
          campaignId={searchParams.get('campaignId')}
          adSetId={searchParams.get('adSetId')}
          adId={searchParams.get('adId')}
        />
      )}

    </div>
  );
}

// ─── custom date range fields ────────────────────────────────────────────────
// Two native date inputs rather than a calendar widget: no popover nesting
// inside the already-portaled Dropdown, no extra CSS import, and the
// commit-when-both-valid behaviour is the important part anyway.
//
// The draft state matters — picking a From date must NOT fire a request while
// To is still empty (or still the previous value), otherwise every custom
// selection costs a wasted Meta call for a range the user never asked for.
// Same guard as BrandIQ/Competitors.
// Uses `react-date-range`'s DateRange — the same calendar Autopilot's date
// pill and AdStudio's DateRangeFilter already use, including the shared
// `date-range-picker-dark` wrapper whose light/dark theming lives in
// App.css. Rendered INLINE inside the existing preset dropdown rather than
// in a nested Popover: the dropdown is already an absolutely-positioned
// animated panel, and nesting a portaled popover inside it is exactly the
// stacking/containing-block trap that broke the columns modal.
function CustomRangeFields({ since, until, onApply }) {
  const today = new Date();
  const parse = (iso) => {
    if (!iso) return null;
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d);
  };

  // Draft range — react-date-range fires onChange on EVERY click (start, then
  // end), so committing directly would fetch a half-selected range. The user
  // confirms with Apply. Seeded from the applied custom range when there is
  // one, otherwise a sensible last-14-days starting point.
  const seed = () => ({
    startDate: parse(since) || new Date(today.getFullYear(), today.getMonth(), today.getDate() - 13),
    endDate: parse(until) || today,
    key: 'selection',
  });
  const [draft, setDraft] = useState(seed);

  // Re-seed when the applied range changes underneath us (restored from the
  // URL, or the user picked a preset and came back).
  useEffect(() => {
    setDraft(seed());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [since, until]);

  const iso = (d) => format(d, 'yyyy-MM-dd');
  const valid = draft.startDate && draft.endDate && draft.startDate <= draft.endDate;

  return (
    <div className="flex flex-col p-2">
      <div className="date-range-picker-dark">
        <DateRange
          editableDateInputs
          onChange={(item) => setDraft(item.selection)}
          moveRangeOnFirstSelection={false}
          ranges={[draft]}
          months={1}
          direction="horizontal"
          rangeColors={['#15DCFF']}
          color="#15DCFF"
          className="bg-transparent text-gray-900 dark:text-white"
          maxDate={today}
        />
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <span className="text-10 text-gray-500 dark:text-white/45">
          {valid ? `${iso(draft.startDate)} → ${iso(draft.endDate)}` : 'Pick a start and end date'}
        </span>
        <button
          type="button"
          disabled={!valid}
          onClick={() => valid && onApply(iso(draft.startDate), iso(draft.endDate))}
          className="shrink-0 rounded-lg bg-gradient-to-r from-[#02C8C4] to-[#5867EB] px-2.5 py-1 text-10 font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Apply
        </button>
      </div>
    </div>
  );
}
