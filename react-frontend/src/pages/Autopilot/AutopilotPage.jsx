import React, { useEffect, useState, useCallback } from 'react';
import { useSelector } from 'react-redux';
import { Navigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { FaFacebook } from 'react-icons/fa6';
import {
  Compass,
  TrendingUp,
  ClipboardList,
  Sparkles,
  Settings,
  LogOut,
  Loader2,
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
import { getAdAccounts, metaDisconnect } from '@/apis/metaAds/metaAdsApi';
import {
  getAutopilotConfig,
  getAutopilotSettings,
} from '@/apis/autopilot/autopilotApi';
import { globalToast } from '@/utils/globalToast';

const BASE_URL = import.meta.env.VITE_SOCKET_URL;

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
  const [disconnecting, setDisconnecting] = useState(false);
  const [showDisconnectModal, setShowDisconnectModal] = useState(false);

  const handleMetaConnect = useCallback(() => {
    if (!userId) return;
    const feUrl = window.location.href;
    window.location.href = `${BASE_URL}/api/auth/facebook?userId=${userId}&feUrl=${encodeURIComponent(feUrl)}`;
  }, [userId]);

  // Disconnect — same flow as Ads Manager. After success we wipe the local
  // account list so the page falls through to its "Connect your Meta
  // account" empty state without a navigation hop.
  const handleDisconnect = async () => {
    if (!userId) return;
    setDisconnecting(true);
    try {
      const res = await metaDisconnect(userId);
      globalToast.success(res?.message || 'Disconnected successfully');
      setAdAccounts([]);
      setConnectError('not-connected');
    } catch {
      globalToast.error('Failed to disconnect Meta account');
    } finally {
      setDisconnecting(false);
    }
  };

  const ConnectFacebookButton = ({ label }) => (
    <button
      type="button"
      onClick={handleMetaConnect}
      disabled={!userId}
      className="flex items-center gap-1.5 rounded-xl bg-[#1877F2] px-3 py-1.5 text-xs font-bold text-white transition-all hover:bg-[#1465d4] disabled:opacity-50"
    >
      <FaFacebook className="h-3.5 w-3.5" />
      {label}
    </button>
  );

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

  // Hydrate the ad-account list from the user's own FB OAuth token.
  // `refresh: true` is an in-place reload (driven by the post-OAuth
  // callback today; previously also by a Refresh button) — it must NOT
  // flip `loading`, because that triggers the early-return that
  // remounts the entire tab tree and wipes the Overview's dry-run
  // results.
  const loadAccounts = useCallback(
    async ({ refresh = false } = {}) => {
      if (!userId) return;
      if (!refresh) setLoading(true);
      setConnectError(null);
      try {
        const res = await getAdAccounts({ refresh });
        const accounts = res?.adAccounts || [];
        setAdAccounts(accounts);
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
        <div className="mt-3">
          <ConnectFacebookButton label="Connect Facebook" />
        </div>
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
  if (connectError === 'not-connected' || adAccounts.length === 0) {
    return <Navigate to="/autopilot" replace />;
  }

  if (connectError) {
    return (
      <FullCenter>
        <p className="text-sm text-red-600 dark:text-red-400">Failed to load ad accounts: {connectError}</p>
        <div className="mt-3">
          <ConnectFacebookButton label="Connect Facebook" />
        </div>
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
      <div className="relative z-50 shrink-0">
        <div className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5 lg:px-6 2xl:py-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200 bg-linear-to-br from-[#15DCFF]/15 to-[#6b72f8]/15 dark:border-white/10 2xl:h-11 2xl:w-11">
            <Compass className="h-5 w-5 text-[#15DCFF] 2xl:h-5.5 2xl:w-5.5" />
          </div>
          <div>
            <h1 className="text-[20px] font-bold text-gray-900 dark:text-white 2xl:text-[22px]">Autopilot</h1>
            <p className="text-13 text-gray-500 dark:text-white/70 2xl:text-sm">
              Set budget. Set objective. Walk away.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Resolved mode badge — reflects the USER's effective state,
              not the server env flag in isolation. "Live" only when
              autopilot is enabled AND dryRunGlobal is off AND the
              server permits live actions; otherwise "Dry-run" or
              "Autopilot off". Previously this always read the env
              flag, which surfaced "Live mode" even when the user had
              toggled autopilot off on their account — confusing. */}
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

          {/* Refresh button hidden — narrow purpose (only refreshes the
              cached ad-account list, not summary/log data) and the
              account list reliably refreshes via OAuth callback or
              2-hour TTL. `loadAccounts({ refresh: true })` and the
              `refreshing` state stay wired up in case we want to
              re-expose this later or repurpose it as a page-wide
              refresh. */}
          <button
            type="button"
            onClick={() => setShowDisconnectModal(true)}
            disabled={disconnecting}
            className="flex items-center gap-1.5 rounded-xl border border-red-500/30 bg-red-500/5 px-3 py-1.5 text-xs font-bold text-red-600 transition-all hover:border-red-500/40 hover:bg-red-500/10 disabled:opacity-50 dark:border-red-500/20 dark:text-red-400 2xl:px-3.5 2xl:py-2 2xl:text-13"
          >
            {disconnecting ? (
              <Loader2 className="h-3 w-3 animate-spin 2xl:h-3.5 2xl:w-3.5" />
            ) : (
              <LogOut className="h-3 w-3 2xl:h-3.5 2xl:w-3.5" />
            )}
            {disconnecting ? 'Disconnecting…' : 'Disconnect'}
          </button>
        </div>
        </div>
      </div>

      {/* ── tabs ──────────────────────────────────────────────────────────── */}
      <div className="relative z-40 shrink-0 border-b border-gray-200 dark:border-white/8">
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
                className={`relative flex shrink-0 snap-start items-center gap-1.5 px-3 py-3 text-sm font-semibold transition-all duration-200 2xl:gap-2 2xl:px-4 2xl:py-3.5 2xl:text-15 ${
                  isActive
                    ? 'text-gray-900 dark:text-white'
                    : 'text-gray-500 hover:text-gray-700 dark:text-white/65 dark:hover:text-white/85'
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
                adAccounts={adAccounts}
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
                <AutopilotLLMAudit adAccounts={adAccounts} />
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
              <AutopilotActionLog selectedAdAccountId={logAccountFilter} />
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

      {/* ── disconnect confirmation modal ─────────────────────────────────── */}
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
              <h2 className="mb-1 text-sm font-bold text-gray-900 dark:text-white">
                Disconnect Meta Account?
              </h2>
              <p className="mb-6 text-xs text-gray-500 dark:text-[#BEBEBE]">
                Autopilot will stop running for this account and all per-account
                settings will be hidden. You can reconnect any time from the
                Ads Manager.
              </p>
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowDisconnectModal(false)}
                  className="rounded-xl border border-gray-200 bg-gray-100 px-4 py-2 text-xs font-medium text-gray-700 transition-all hover:bg-gray-200 dark:border-white/8 dark:bg-white/5 dark:text-white dark:hover:bg-white/10"
                >
                  Cancel
                </button>
                <button
                  type="button"
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
          </motion.div>
        )}
      </AnimatePresence>
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
