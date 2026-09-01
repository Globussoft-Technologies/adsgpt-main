import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useSelector } from 'react-redux';
import { Navigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { FaMeta } from 'react-icons/fa6';
import {
  Compass,
  TrendingUp,
  ClipboardList,
  Sparkles,
  Settings,
  Radio,
  ChevronDown,
  // Repeat,  // ROTATION HIDDEN — re-add when uncommenting the rotation tab
} from 'lucide-react';
import AutopilotOverview from '@/components/Autopilot/AutopilotOverview';
import AutopilotActionLog from '@/components/Autopilot/AutopilotActionLog';
import AutopilotSettings from '@/components/Autopilot/AutopilotSettings';
// Rotation queue is hidden until the feature is functional end-to-end:
// no UI to populate drafts, env-gated cron path, Phase 10 auto-gen not built.
// Re-enable by uncommenting this import + the TABS entry + the render block
// below, in three places marked "ROTATION HIDDEN".
// import AutopilotRotationQueue from '@/components/Autopilot/AutopilotRotationQueue';
import AutopilotLLMAudit from '@/components/Autopilot/LLMAudit/AutopilotLLMAudit';
import AdsManagerModeSwitcher from '@/components/AdsManager/AdsManagerModeSwitcher';
import WorkspaceSwitcher from '@/components/workspace/WorkspaceSwitcher';
import ThemeToggle from '@/components/layout/header/ThemeToggle';
import FacebookAccountSelector from '@/components/MetaAds/FacebookAccountSelector';
import { Dropdown, StatusBadge } from '@/components/MetaAds/MetaAdsAtoms';
import { getAdAccounts, getFacebookAccounts } from '@/apis/metaAds/metaAdsApi';
import {
  getAutopilotConfig,
  getAutopilotSettings,
} from '@/apis/autopilot/autopilotApi';

/**
 * /autopilot page.
 *
 * Chrome matches the Meta Ads launcher (`MetaAdsDashboard`): dark theme,
 * grid-dot background, branded header, custom account dropdown, framer-motion
 * animated tabs. The AI Audit tab already matches; the rest of the tab
 * content is reskinned in their own components.
 *
 * Multi-tenant model unchanged: account list is the user's own
 * `/me/adaccounts`. Live writes are gated by the global
 * `AUTOPILOT_LIVE_ACTIONS_ALLOWED` env flag (read via `/autopilot/config`).
 */
const TABS = [
  { id: 'overview', label: 'Overview', icon: TrendingUp },
  { id: 'ai-audit', label: 'AI Audit', icon: Sparkles },
  { id: 'log', label: 'Action log', icon: ClipboardList },
  // { id: 'rotation', label: 'Rotation queue', icon: Repeat },  // ROTATION HIDDEN
  { id: 'settings', label: 'Settings', icon: Settings },
];

const AutopilotPage = () => {
  const { userData } = useSelector((state) => state.socket);
  const userId = userData?.user_id;

  const [adAccounts, setAdAccounts] = useState([]);
  const [facebookAccounts, setFacebookAccounts] = useState([]);
  const [adAccountsByFacebook, setAdAccountsByFacebook] = useState({});
  // `loading` is the first-mount spinner that takes over the whole page
  // chrome. The OAuth callback path triggers a silent in-place reload via
  // `loadAccounts({ refresh: true })` without flipping `loading` — that's
  // what keeps the Overview's dry-run results from being wiped when the
  // user reconnects mid-session.
  const [loading, setLoading] = useState(true);
  const [connectError, setConnectError] = useState(null);
  const [liveActionsAllowed, setLiveActionsAllowed] = useState(false);
  // User-level autopilot state. Drives the header status badge + the
  // Overview Status card. Three resolved states:
  //   - 'off'     : user toggled autopilot off in Settings
  //   - 'dry-run' : autopilot is on but dryRunGlobal=true OR the server-
  //                 level liveActionsAllowed flag is false (so even a
  //                 user opt-in still won't touch Meta)
  //   - 'live'    : user is on AND not dry-run AND env allows live
  // We track the raw flags so reactivity is clean; the resolver below
  // computes the badge state from them.
  const [autopilotEnabled, setAutopilotEnabled] = useState(false);
  const [dryRunGlobal, setDryRunGlobal] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');
  // Account id forwarded from Overview's per-account "View →" button. The
  // Action log tab seeds its account filter from this so a click on
  // "View" for "Tivra Jagatap" lands on the log already scoped to that
  // account instead of the unfiltered list.
  const [logAccountFilter, setLogAccountFilter] = useState('');

  // Page-level Facebook account — shared by every tab now. Overview /
  // Action log use it to scope a SET of accounts (`scopedAdAccounts`
  // below); AI Audit narrows further to one specific ad account, since an
  // audit run always targets a single account. `FacebookAccountSelector`
  // resolves its own default (persisted pick, else the first connected
  // identity) and reports it here on mount, so there's no separate
  // "nothing selected yet" state to handle.
  const [selectedFacebookAccount, setSelectedFacebookAccount] = useState(null);
  const activeFacebookId = selectedFacebookAccount?.facebookId || '';
  const scopedAdAccounts = activeFacebookId
    ? adAccountsByFacebook[activeFacebookId] || []
    : adAccounts;
  const scopedAdAccountIds = useMemo(
    () => scopedAdAccounts.map((account) => account.id),
    [scopedAdAccounts],
  );

  // AI Audit's single-account pick, scoped within `activeFacebookId`'s
  // account list. Lives in the header (next to the Facebook selector)
  // rather than inside AutopilotLLMAudit so the two controls sit together
  // visually instead of duplicating a Facebook picker in the tab body.
  const [aiAuditAdAccountId, setAiAuditAdAccountId] = useState('');
  const [aiAuditAccountOpen, setAiAuditAccountOpen] = useState(false);
  const aiAuditAdAccounts = activeFacebookId
    ? adAccountsByFacebook[activeFacebookId] || []
    : [];

  // Default to the first account whenever the Facebook identity (or its
  // account list) changes; keep a still-valid prior pick otherwise.
  useEffect(() => {
    setAiAuditAdAccountId((prev) =>
      prev && aiAuditAdAccounts.some((account) => account.id === prev)
        ? prev
        : aiAuditAdAccounts[0]?.id || '',
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFacebookId, adAccountsByFacebook]);

  // Hydrate the global live-actions flag AND the user's per-account
  // autopilot settings (enabled + dryRunGlobal). Both feed the resolved
  // header status badge; refresh whenever the user lands back on this
  // page so a toggle in Settings is reflected in the header without a
  // full reload.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [cfg, settingsRes] = await Promise.all([
          getAutopilotConfig().catch(() => null),
          getAutopilotSettings().catch(() => null),
        ]);
        if (cancelled) return;
        if (cfg) setLiveActionsAllowed(!!cfg.liveActionsAllowed);
        const s = settingsRes?.settings || settingsRes;
        if (s) {
          setAutopilotEnabled(!!s.enabled);
          // Default to dry-run when the field is absent — safer-by-default.
          setDryRunGlobal(s.dryRunGlobal !== false);
        }
      } catch {
        /* non-fatal */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeTab]); // re-fetch when user switches tabs (incl. away/back from Settings)

  // Resolve the three-state status. Render-time derivation rather than
  // a separate piece of state — keeps it impossible to get out of sync
  // with the underlying flags.
  const autopilotStatus = !autopilotEnabled
    ? 'off'
    : dryRunGlobal || !liveActionsAllowed
      ? 'dry-run'
      : 'live';

  // Auto Pilot itself is not scoped to one Facebook identity. Load every
  // connected identity silently and keep both a combined ad-account list
  // (Overview / Action log) and an identity-scoped map (AI Audit).
  const loadAccounts = useCallback(
    async ({ refresh = false } = {}) => {
      if (!userId) return;
      if (!refresh) setLoading(true);
      setConnectError(null);
      try {
        const identitiesResponse = await getFacebookAccounts(userId);
        const identities = (identitiesResponse?.accounts || []).filter(
          (identity) => identity.isUsable,
        );
        setFacebookAccounts(identities);

        if (identities.length === 0) {
          setAdAccounts([]);
          setAdAccountsByFacebook({});
          setConnectError('not-connected');
          return;
        }

        const results = await Promise.allSettled(
          identities.map((identity) =>
            getAdAccounts({
              refresh,
              facebookId: identity.facebookId,
            }),
          ),
        );

        const nextByFacebook = {};
        identities.forEach((identity, index) => {
          const result = results[index];
          nextByFacebook[identity.facebookId] =
            result.status === 'fulfilled' ? result.value?.adAccounts || [] : [];
        });
        setAdAccountsByFacebook(nextByFacebook);

        const uniqueAccounts = new Map();
        Object.values(nextByFacebook)
          .flat()
          .forEach((account) => {
            if (!uniqueAccounts.has(account.id)) uniqueAccounts.set(account.id, account);
          });
        setAdAccounts([...uniqueAccounts.values()]);
      } catch (err) {
        const status = err?.response?.status;
        if (status === 404 || status === 401) {
          setConnectError('not-connected');
        } else {
          setConnectError(
            err?.response?.data?.error || err.message || 'Failed to load ad accounts',
          );
        }
      } finally {
        if (!refresh) setLoading(false);
      }
    },
    [userId],
  );

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  // Auto-refresh after a successful OAuth round-trip.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('auth') === 'success') {
      params.delete('auth');
      const next =
        window.location.pathname +
        (params.toString() ? `?${params.toString()}` : '') +
        window.location.hash;
      window.history.replaceState({}, '', next);
      loadAccounts({ refresh: true });
    }
  }, [loadAccounts]);

  // ─── early states ─────────────────────────────────────────────────────────
  if (!userId) {
    return (
      <FullCenter>
        <p className="text-sm text-gray-500 dark:text-white/75 2xl:text-15">Sign in to access Autopilot.</p>
      </FullCenter>
    );
  }

  if (loading) {
    return (
      <FullCenter>
        <div className="relative h-10 w-10">
          <div className="absolute inset-0 rounded-full border-2 border-gray-200 dark:border-white/10" />
          <div className="absolute inset-0 animate-spin rounded-full border-2 border-t-[#15DCFF]" />
        </div>
        <p className="mt-3 text-sm text-gray-500 dark:text-white/75 2xl:text-15">Loading ad accounts…</p>
      </FullCenter>
    );
  }

  // Not connected (or no ad accounts available) → bounce back to the
  // Autopilot home picker. That's the entry point that already handles
  // the "Connect Facebook" affordance the same way Ads Manager does for
  // its `/meta-ads` route, so the deep-link `/autopilot/meta` shouldn't
  // have its own ad-hoc empty state. `replace` avoids leaving the
  // dashboard URL in the history stack, which would back-button-loop the
  // user back to this redirect.
  if (
    connectError === 'not-connected' ||
    facebookAccounts.length === 0
  ) {
    return <Navigate to="/autopilot" replace />;
  }

  if (adAccounts.length === 0) {
    return (
      <FullCenter>
        <p className="text-sm font-medium text-gray-700 dark:text-white">
          No Meta ad accounts are available for the connected Facebook accounts.
        </p>
        <p className="mt-1 text-xs text-gray-500 dark:text-white/60">
          Assign an ad account in Meta, then return here and refresh.
        </p>
      </FullCenter>
    );
  }

  if (connectError) {
    return (
      <FullCenter>
        <p className="text-sm text-red-600 dark:text-red-400">Failed to load ad accounts: {connectError}</p>
      </FullCenter>
    );
  }

  // ─── main render ──────────────────────────────────────────────────────────
  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden">
      {/* Background effects removed (grid-dot + cyan ambient glow + explicit
          page bg). The explicit `bg-[#0e1216]` was creating a hard seam
          against the parent layout's bg — visible as the darker rectangle
          patch in the upper-left. Page now inherits the parent surface
          for a continuous bg; cards still provide their own contrast. */}

      {/* ── header ────────────────────────────────────────────────────────── */}
      {/* Full-bleed: the header stretches edge-to-edge so it matches the
          padding rhythm of the rest of the app (MyBrandsHome, etc.) instead
          of capping mid-screen on wide displays. Horizontal padding scales
          with the viewport; Overview / Action log / Settings follow the
          same scale. */}
      <div className="ads-operations-divider relative z-50 flex flex-shrink-0 flex-wrap items-center justify-between gap-3 border-b border-gray-200 pl-12 pr-5 py-3 sm:pl-14 lg:px-5 2xl:px-6 2xl:py-4 2xl:pr-8 dark:border-white/[0.06]">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-gray-200 bg-white shadow-sm 2xl:h-12 2xl:w-12 dark:border-white/10">
              <FaMeta className="h-7 w-7 text-[#0082FB] 2xl:h-7.5 2xl:w-7.5" />
            </div>
            <AdsManagerModeSwitcher
              activeMode="autopilot"
              platform="Meta"
              autopilotAvailable
            />
          </div>
          <p className="px-1 text-xs font-semibold text-gray-700 dark:text-white/85">
            Set budget. Set objective. Walk away.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {activeTab === 'ai-audit' && (
            <Dropdown
              open={aiAuditAccountOpen}
              onClose={() => setAiAuditAccountOpen(false)}
              anchor="left"
              trigger={
                <button
                  type="button"
                  onClick={() => setAiAuditAccountOpen((p) => !p)}
                  disabled={aiAuditAdAccounts.length === 0}
                  className="flex items-center gap-2 rounded-xl border-0 bg-[#e2e6ed] px-3 py-2 text-xs font-semibold text-gray-900 backdrop-blur-xl transition-all hover:bg-[#d8dce4] disabled:opacity-50 dark:bg-[#171717] dark:text-white dark:hover:bg-white/10"
                >
                  <Radio className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                  <span className="max-w-45 truncate font-medium">
                    {aiAuditAdAccounts.find((account) => account.id === aiAuditAdAccountId)
                      ?.name ?? 'Pick an account'}
                  </span>
                  <ChevronDown className="h-3.5 w-3.5 text-gray-700 dark:text-[#BEBEBE]" />
                </button>
              }
            >
              <div className="w-72 p-1">
                <div className="max-h-64 overflow-y-auto pr-0.5 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-gray-300 [&::-webkit-scrollbar-track]:bg-transparent dark:[&::-webkit-scrollbar-thumb]:bg-white/20">
                  {aiAuditAdAccounts.map((account) => (
                    <button
                      key={account.id}
                      onClick={() => {
                        setAiAuditAdAccountId(account.id);
                        setAiAuditAccountOpen(false);
                      }}
                      className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left transition-all hover:bg-gray-100 dark:hover:bg-white/5 ${
                        aiAuditAdAccountId === account.id ? 'bg-gray-100 dark:bg-white/5' : ''
                      }`}
                    >
                      <div>
                        <p
                          className={`text-xs font-medium ${
                            aiAuditAdAccountId === account.id
                              ? 'text-[#15DCFF]'
                              : 'text-gray-900 dark:text-white'
                          }`}
                        >
                          {account.name}
                        </p>
                        <p className="text-10 text-gray-500 dark:text-white/50">act_{account.id}</p>
                      </div>
                      <StatusBadge status={account.status === 1 ? 'ACTIVE' : 'PAUSED'} />
                    </button>
                  ))}
                </div>
              </div>
            </Dropdown>
          )}
          <WorkspaceSwitcher />
          <FacebookAccountSelector
            userId={userId}
            onChange={setSelectedFacebookAccount}
          />
          {autopilotStatus === 'live' ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-10 font-bold tracking-wide uppercase text-emerald-600 dark:border-emerald-500/20 dark:text-emerald-400 2xl:px-3 2xl:py-1.5 2xl:text-[11px]">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400" />
              Live mode
            </span>
          ) : autopilotStatus === 'dry-run' ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-10 font-bold tracking-wide uppercase text-amber-600 dark:border-amber-500/20 dark:text-amber-400 2xl:px-3 2xl:py-1.5 2xl:text-[11px]">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500 dark:bg-amber-400" />
              Dry-run
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full border border-gray-300 bg-gray-100 px-2.5 py-1 text-10 font-bold tracking-wide uppercase text-gray-500 dark:border-white/15 dark:bg-white/[0.06] dark:text-white/70 2xl:px-3 2xl:py-1.5 2xl:text-[11px]">
              <span className="h-1.5 w-1.5 rounded-full bg-gray-400 dark:bg-white/50" />
              Autopilot off
            </span>
          )}
          <div className="ml-1 2xl:ml-2">
            <ThemeToggle />
          </div>

        </div>
      </div>

      {/* ── tabs ──────────────────────────────────────────────────────────── */}
      <div className="ads-operations-divider relative z-40 shrink-0 border-b border-gray-200 dark:border-white/8">
        <div className="w-full px-4 sm:px-5 lg:px-6">
          <div
            role="tablist"
            className="flex items-center gap-0.5 overflow-x-auto snap-x snap-mandatory [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
          {TABS.map(({ id, label, icon: TabIcon }) => {
            const isActive = activeTab === id;
            return (
              <button
                key={id}
                role="tab"
                aria-selected={isActive}
                onClick={() => setActiveTab(id)}
                className={`relative flex shrink-0 snap-start items-center gap-1.5 px-3 py-3 text-sm font-bold transition-all duration-200 2xl:gap-2 2xl:px-4 2xl:py-3.5 2xl:text-15 ${
                  isActive
                    ? 'text-gray-900 dark:text-white'
                    : 'text-gray-700 hover:text-gray-900 dark:text-white/80 dark:hover:text-white'
                }`}
              >
                <TabIcon className="h-3.5 w-3.5 2xl:h-4 2xl:w-4" />
                <span className={isActive ? 'inline' : 'hidden sm:inline'}>
                  {label}
                </span>
                {isActive && (
                  <motion.div
                    layoutId="autopilotActiveTab"
                    className="absolute right-0 bottom-0 left-0 h-0.5 rounded-full bg-gray-900 dark:bg-white/60"
                    transition={{ type: 'spring', bounce: 0.2, duration: 0.35 }}
                  />
                )}
              </button>
            );
          })}
          </div>
        </div>
      </div>

      {/* ── body ──────────────────────────────────────────────────────────── */}
      <div className="relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden">
        <AnimatePresence mode="wait">
          {activeTab === 'overview' && (
            <motion.div
              key="overview"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              className="scrollbar-thin flex min-h-0 flex-1 flex-col overflow-y-auto"
            >
              <AutopilotOverview
                adAccounts={scopedAdAccounts}
                adAccountIds={scopedAdAccountIds}
                liveActionsAllowed={liveActionsAllowed}
                autopilotStatus={autopilotStatus}
                onOpenActionLog={(adAccountId) => {
                  setLogAccountFilter(adAccountId || '');
                  setActiveTab('log');
                }}
              />
            </motion.div>
          )}

          {activeTab === 'ai-audit' && (
            <motion.div
              key="ai-audit"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              className="scrollbar-thin flex min-h-0 flex-1 flex-col overflow-y-auto"
            >
              <div className="flex w-full flex-col gap-4 px-4 py-5 sm:px-5 sm:py-6 lg:px-6 2xl:py-8">
                <AutopilotLLMAudit
                  facebookId={activeFacebookId}
                  adAccountId={aiAuditAdAccountId}
                  adAccountsByFacebook={adAccountsByFacebook}
                />
              </div>
            </motion.div>
          )}

          {activeTab === 'log' && (
            <motion.div
              key="log"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              className="scrollbar-thin flex min-h-0 flex-1 flex-col overflow-y-auto"
            >
              <AutopilotActionLog
                selectedAdAccountId={logAccountFilter}
                adAccounts={scopedAdAccounts}
                scopedAdAccountIds={scopedAdAccountIds}
              />
            </motion.div>
          )}

          {/* ROTATION HIDDEN — uncomment to re-enable the Rotation queue tab.
          {activeTab === 'rotation' && (
            <motion.div
              key="rotation"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              className="scrollbar-thin flex min-h-0 flex-1 flex-col overflow-y-auto"
            >
              <AutopilotRotationQueue selectedAdAccountId={selectedId} />
            </motion.div>
          )}
          */}

          {activeTab === 'settings' && (
            <motion.div
              key="settings"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              className="scrollbar-thin flex min-h-0 flex-1 flex-col overflow-y-auto"
            >
              <AutopilotSettings />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

    </div>
  );
};

// ─── small helpers ──────────────────────────────────────────────────────────
const FullCenter = ({ children }) => (
  <div className="relative flex h-full w-full flex-1 flex-col items-center justify-center overflow-hidden p-8">
    <div
      className="pointer-events-none absolute inset-0 opacity-[0.012]"
      style={{
        backgroundImage:
          'radial-gradient(circle at 1px 1px, white 1px, transparent 0)',
        backgroundSize: '24px 24px',
      }}
    />
    {children}
  </div>
);

export default AutopilotPage;
