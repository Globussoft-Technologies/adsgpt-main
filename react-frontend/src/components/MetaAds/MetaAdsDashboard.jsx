import React, { useState, useEffect, useCallback } from 'react';
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
  Plus,
} from 'lucide-react';
import {
  getAdAccounts,
  getCampaigns,
  getAnalyticsData,
  getUserAdPostingInfo,
  metaDisconnect,
} from '@/apis/metaAds/metaAdsApi';
import { globalToast } from '@/utils/globalToast';
import { DATE_PRESETS, STATUS_MAP } from './metaAdsUtils';
import { AnalyticsPanel, AuditTab } from './MetaAdsPanels';
import { TableViewCampaigns } from './MetaAdsTableView';
import { StatusBadge, Dropdown } from './MetaAdsAtoms';
import CreateCampaignWizard from './CreateCampaignWizard';
import CreateCampaignWizardV2 from './CreateCampaignWizardV2';
import LeadsTab from './LeadsTab';

// V2 wizard is gated on a build-time env var so V1 keeps running by
// default. When V2 is ready for the migrated objectives we flip this
// to true in the relevant env file. See docs/CAMPAIGN_CREATION_PARITY_PLAN.md.
const FEATURE_WIZARD_V2 = import.meta.env.VITE_FEATURE_WIZARD_V2 === 'true';
import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
const FEATURE_LEADS_TAB = import.meta.env.VITE_FEATURE_LEADS_TAB === 'true';

export default function MetaAdsDashboard() {
  const { userData } = useSelector((state) => state.socket);
  const navigate = useNavigate();
  const [adAccounts, setAdAccounts] = useState([]);
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [campaigns, setCampaigns] = useState([]);
  const [analyticsData, setAnalyticsData] = useState(null);
  const [datePreset, setDatePreset] = useState('last_14d');
  const [activeTab, setActiveTab] = useState('analytics');

  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);
  const [loadingInsights, setLoadingInsights] = useState(false);

  const [accountOpen, setAccountOpen] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [showDisconnectModal, setShowDisconnectModal] = useState(false);
  const [showCreateWizard, setShowCreateWizard] = useState(false);

  const reloadCampaigns = useCallback(async () => {
    if (!selectedAccount) return;
    setLoadingCampaigns(true);
    try {
      const r = await getCampaigns(selectedAccount.id);
      setCampaigns(r.campaigns || []);
    } catch { /* noop */ } finally {
      setLoadingCampaigns(false);
    }
  }, [selectedAccount]);

  // verify user token on mount — redirect to /ads-manager on 404
  useEffect(() => {
    const userId = userData?.user_id;
    if (!userId) return;
    (async () => {
      try {
        await getUserAdPostingInfo(userId);
      } catch (err) {
        if (err?.response?.status === 404) {
          navigate('/ads-manager');
        }
      }
    })();
  }, [userData?.user_id, navigate]);

  // load ad accounts
  useEffect(() => {
    (async () => {
      try {
        const res = await getAdAccounts();
        setAdAccounts(res.adAccounts || []);
        if (res.adAccounts?.length) setSelectedAccount(res.adAccounts[0]);
      } catch {
        /* noop */
      } finally {
        setLoadingAccounts(false);
      }
    })();
  }, []);

  // load campaigns when account changes
  useEffect(() => {
    if (!selectedAccount) return;
    (async () => {
      setLoadingCampaigns(true);
      setCampaigns([]);
      setAnalyticsData(null);
      try {
        const res = await getCampaigns(selectedAccount.id);
        setCampaigns(res.campaigns || []);
      } catch {
        /* noop */
      } finally {
        setLoadingCampaigns(false);
      }
    })();
  }, [selectedAccount]);

  // load analytics
  const loadAnalytics = useCallback(async () => {
    if (!selectedAccount) return;
    setLoadingInsights(true);
    setAnalyticsData(null);
    try {
      const res = await getAnalyticsData({ adAccountId: selectedAccount.id, datePreset });
      setAnalyticsData(res);
    } catch {
      /* noop */
    } finally {
      setLoadingInsights(false);
    }
  }, [selectedAccount, datePreset]);

  useEffect(() => {
    if (activeTab === 'analytics') loadAnalytics();
  }, [activeTab, loadAnalytics]);

  const handleDisconnect = async () => {
    const userId = userData?.user_id;
    if (!userId) return;
    setDisconnecting(true);
    try {
      const res = await metaDisconnect(userId);
      globalToast.success(res?.message || 'Disconnected successfully');
      navigate('/ads-manager');
    } catch {
      globalToast.error('Failed to disconnect Meta account');
      setDisconnecting(false);
    }
  };

  const activeCampaigns = campaigns.filter((c) => c.status === 'ACTIVE').length;

  const TABS = [
    { id: 'analytics', label: 'Analytics', icon: TrendingUp },
    { id: 'audit', label: 'Audit', icon: ClipboardList },
    { id: 'campaigns', label: 'Campaigns', icon: Layers },
    // Leads tab ships alongside the V2 wizard's Instant-Form features —
    // gated on the same FEATURE_LEADS_TAB flag so it only appears
    // where V2 is enabled.
    ...(FEATURE_LEADS_TAB ? [{ id: 'leads', label: 'Leads', icon: Inbox }] : []),
  ];

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden">
      {/* grid dot bg */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.012]"
        style={{
          backgroundImage: 'radial-gradient(circle at 1px 1px, white 1px, transparent 0)',
          backgroundSize: '24px 24px',
        }}
      />
      {/* ambient glow */}
      <div className="pointer-events-none absolute -top-32 left-1/2 h-64 w-96 -translate-x-1/2 rounded-full bg-white/3 blur-3xl" />

      {/* ── header ─────────────────────────────────────────────────────────── */}
      <div className="relative z-50 flex flex-shrink-0 flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] px-5 py-3 2xl:px-6 2xl:py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/20 bg-white">
            <FaMeta className="h-5 w-5 text-[#0082FB]" />
          </div>
          <div>
            <h1 className="text-[20px] font-bold text-white">Meta Ads Manager</h1>
            <p className="text-[15px] text-[#BEBEBE]">Manage · Analyse · Optimise</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* account picker */}
          <Dropdown
            open={accountOpen}
            onClose={() => setAccountOpen(false)}
            trigger={
              <button
                onClick={() => setAccountOpen((p) => !p)}
                className="flex items-center gap-2 rounded-xl border border-white/[0.06] bg-[#171717] px-3 py-2 text-xs text-white backdrop-blur-xl transition-all hover:border-white/10"
              >
                {loadingAccounts ? (
                  <Loader2 className="h-3 w-3 animate-spin text-[#BEBEBE]" />
                ) : (
                  <>
                    <Radio className="h-3 w-3 text-emerald-400" />
                    <span className="max-w-[150px] truncate font-medium">
                      {selectedAccount?.name ?? 'Select Account'}
                    </span>
                    <ChevronDown className="h-3 w-3 text-[#BEBEBE]" />
                  </>
                )}
              </button>
            }
          >
            <div className="w-72 p-1">
              <div className="max-h-55 overflow-y-auto pr-0.5 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/20 [&::-webkit-scrollbar-track]:bg-transparent">
                {adAccounts.map((acc) => (
                  <button
                    key={acc.id}
                    onClick={() => {
                      setSelectedAccount(acc);
                      setAccountOpen(false);
                      setActiveTab('analytics');
                    }}
                    className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left transition-all hover:bg-white/5 ${selectedAccount?.id === acc.id ? 'bg-white/5' : ''}`}
                  >
                    <div>
                      <p
                        className={`text-xs font-medium ${selectedAccount?.id === acc.id ? 'text-[#15DCFF]' : 'text-white'}`}
                      >
                        {acc.name}
                      </p>
                      <p className="text-10 text-white">Spent: {acc.amountSpent}</p>
                    </div>
                    <StatusBadge status={acc.status === 1 ? 'ACTIVE' : 'PAUSED'} />
                  </button>
                ))}
              </div>
            </div>
          </Dropdown>

          {/* date preset — analytics tab only */}
          {activeTab === 'analytics' && (
            <Dropdown
              open={dateOpen}
              onClose={() => setDateOpen(false)}
              trigger={
                <button
                  onClick={() => setDateOpen((p) => !p)}
                  className="flex items-center gap-2 rounded-xl border border-white/[0.06] bg-[#171717] px-3 py-2 text-xs text-white backdrop-blur-xl transition-all hover:border-white/10"
                >
                  <Calendar className="h-3 w-3 text-white" />
                  <span className="font-medium">
                    {DATE_PRESETS.find((d) => d.value === datePreset)?.label}
                  </span>
                  <ChevronDown className="h-3 w-3 text-[#BEBEBE]" />
                </button>
              }
            >
              <div className="w-44 p-1">
                {DATE_PRESETS.map((preset) => (
                  <button
                    key={preset.value}
                    onClick={() => {
                      setDatePreset(preset.value);
                      setDateOpen(false);
                    }}
                    className={`w-full rounded-xl px-3 py-2 text-left text-xs transition-all hover:bg-white/5 ${datePreset === preset.value ? 'bg-white/5 text-[#15DCFF]' : 'text-white'}`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </Dropdown>
          )}
        </div>
      </div>

      {/* ── account summary strip ──────────────────────────────────────────── */}
      {selectedAccount && !loadingAccounts && (
        <div className="relative z-30 flex flex-shrink-0 flex-wrap items-center justify-between gap-5 border-b border-white/[0.04] px-5 py-2 2xl:px-6">
          {[
            {
              label: 'Account',
              value: <span className="font-semibold text-white">{selectedAccount.name}</span>,
            },
            {
              label: 'Lifetime Spent',
              value: <span className="font-semibold text-white">{selectedAccount.amountSpent}</span>,
            },
            {
              label: 'Campaigns',
              value: (
                <span className="font-semibold text-white">
                  {campaigns.length}
                  {activeCampaigns > 0 && (
                    <span className="ml-1 text-emerald-400">({activeCampaigns} active)</span>
                  )}
                </span>
              ),
            },
            {
              label: 'Currency',
              value: <span className="font-semibold text-white">{selectedAccount.currency}</span>,
            },
          ].map(({ label, value }, i) => (
            <React.Fragment key={label}>
              {i > 0 && <div className="h-4 w-px bg-white/[0.06]" />}
              <div className="flex items-center gap-2 text-sm 2xl:text-15">
                <span className="text-xs font-medium uppercase tracking-wider text-white/40">{label}</span>
                {value}
              </div>
            </React.Fragment>
          ))}
          <button
            onClick={() => setShowDisconnectModal(true)}
            disabled={disconnecting}
            className="ml-auto flex items-center gap-1.5 rounded-xl border border-red-500/20 bg-red-500/5 px-3 py-1.5 text-xs  text-red-400 font-bold transition-all hover:border-red-500/40  hover:bg-red-500/10 disabled:opacity-50"
          >
            {disconnecting ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <LogOut className="h-3 w-3" />
            )}
            {disconnecting ? 'Disconnecting…' : 'Disconnect'}
          </button>
        </div>
      )}

      {/* ── tabs ──────────────────────────────────────────────────────────── */}
      <div className="relative z-40 flex flex-shrink-0 items-center justify-between border-b border-white/6 px-5 2xl:px-6">
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
              className={`relative flex items-center gap-1.5 px-3 py-3 text-sm font-semibold transition-all duration-200 ${activeTab === id ? 'text-white' : 'text-[#BEBEBE] hover:text-white/70'}`}
            >
              <TabIcon className="h-3.5 w-3.5" />
              {label}
              {activeTab === id && (
                <motion.div
                  layoutId="activeTab"
                  className="absolute right-0 bottom-0 left-0 h-0.5 rounded-full bg-white/60"
                  transition={{ type: 'spring', bounce: 0.2, duration: 0.35 }}
                />
              )}
            </button>
            );
          })}
        </div>
        {activeTab === 'audit' && (
          <div className="flex items-center gap-1.5">
            <Info className="h-3.5 w-3.5 shrink-0 text-white/30" />
            <p className="text-xs text-white/40">
              Audit data reflects the <span className="font-semibold text-white/60">last 14 days</span> of campaign activity.
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
              <div className="flex shrink-0 items-center justify-between gap-2">
                <div>
                  <p className="text-base font-bold text-white 2xl:text-xl">Campaigns</p>
                  <p className="text-xs 2xl:text-sm text-[#BEBEBE]">Build and manage Meta Ads Manager campaigns end-to-end</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={reloadCampaigns}
                    disabled={loadingCampaigns}
                    className="flex items-center gap-1.5 rounded-xl border border-white/6 bg-[#171717] px-3 py-1.5 text-10 2xl:text-xs font-medium text-[#BEBEBE] backdrop-blur-xl transition-all hover:border-white/10 hover:text-white disabled:opacity-50"
                  >
                    <RefreshCw className={`h-3 w-3 ${loadingCampaigns ? 'animate-spin' : ''}`} />
                    Refresh
                  </button>
                  <button
                    onClick={() => setShowCreateWizard(true)}
                    disabled={!selectedAccount}
                    className="flex items-center gap-1.5 rounded-xl bg-white px-3 py-1.5 text-10 2xl:text-xs font-semibold text-black transition-all hover:opacity-90 disabled:opacity-50"
                  >
                    <Plus className="h-3 w-3" />
                    New Campaign
                  </button>
                </div>
              </div>
              <TableViewCampaigns
                campaigns={campaigns}
                loadingCampaigns={loadingCampaigns}
                adAccountId={selectedAccount?.id}
                onRefresh={reloadCampaigns}
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
                  <p className="text-base 2xl:text-xl font-bold text-white">Account Analytics</p>
                </div>
                <button
                  onClick={loadAnalytics}
                  disabled={loadingInsights}
                  className="flex items-center gap-1.5 rounded-xl border border-white/[0.06] bg-[#171717] px-3 py-1.5 text-10 font-medium text-[#BEBEBE] backdrop-blur-xl transition-all hover:border-white/10 hover:text-white disabled:opacity-50"
                >
                  <RefreshCw className={`h-3 w-3 ${loadingInsights ? 'animate-spin' : ''}`} />
                  Refresh
                </button>
              </div>
              <AnalyticsPanel analyticsData={analyticsData} loading={loadingInsights} />
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

          {/* leads tab — view + download captured Instant-Form leads.
              Gated on FEATURE_LEADS_TAB, same as the tab button. */}
          {FEATURE_LEADS_TAB && activeTab === 'leads' && (
            <motion.div
              key="leads"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              className="flex min-h-0 flex-1 flex-col"
            >
              <LeadsTab adAccountId={selectedAccount?.id} />
            </motion.div>
          )}

        </AnimatePresence>
      </div>

      {/* ── create campaign wizard ─────────────────────────────────────────── */}
      {FEATURE_WIZARD_V2 ? (
        <CreateCampaignWizardV2
          open={showCreateWizard}
          onClose={() => setShowCreateWizard(false)}
          adAccountId={selectedAccount?.id}
          account={selectedAccount}
          onCreated={() => {
            setActiveTab('campaigns');
            reloadCampaigns();
          }}
        />
      ) : (
        <CreateCampaignWizard
          open={showCreateWizard}
          onClose={() => setShowCreateWizard(false)}
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
              className="w-full max-w-sm rounded-2xl border border-white/8 bg-[#161616] p-6 shadow-2xl"
            >
              <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-red-500/10">
                <LogOut className="h-5 w-5 text-red-400" />
              </div>
              <h2 className="mb-1 text-sm font-bold text-white">Disconnect Meta Account?</h2>
              <p className="mb-6 text-xs text-[#BEBEBE]">
                This will remove the connection to your Meta Ads account. You can reconnect at any
                time from the Ads Manager.
              </p>
              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={() => setShowDisconnectModal(false)}
                  className="rounded-xl border border-white/8 bg-white/5 px-4 py-2 text-xs font-medium text-white transition-all hover:bg-white/10"
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
                  Disconnect
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
