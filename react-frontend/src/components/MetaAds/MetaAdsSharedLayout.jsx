import React, { createContext, useContext, useState, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { FaMeta } from 'react-icons/fa6';
import AdsManagerModeSwitcher from '@/components/AdsManager/AdsManagerModeSwitcher';
import WorkspaceSwitcher from '@/components/workspace/WorkspaceSwitcher';
import ThemeToggle from '@/components/layout/header/ThemeToggle';
import FacebookAccountSelector from '@/components/MetaAds/FacebookAccountSelector';
import { getAutopilotConfig, getAutopilotSettings } from '@/apis/autopilot/autopilotApi';

export const MetaAdsLayoutContext = createContext(null);

export function useMetaAdsLayout() {
  return useContext(MetaAdsLayoutContext);
}

/**
 * Shared persistent layout for Meta Ads Manager (/meta-ads) and Autopilot (/autopilot/meta).
 * Keeps the top header bar permanently mounted across route switching so the top bar never flashes.
 */
export default function MetaAdsSharedLayout() {
  const location = useLocation();
  const userData = useSelector((state) => state.auth?.userData);
  const userId = userData?.user_id;

  const isAutopilot = location.pathname.startsWith('/autopilot');
  const activeMode = isAutopilot ? 'autopilot' : 'manager';

  // Shared Facebook account state
  const [selectedFacebookAccount, setSelectedFacebookAccount] = useState(null);

  // Autopilot status state
  const [autopilotEnabled, setAutopilotEnabled] = useState(false);
  const [autopilotConfig, setAutopilotConfig] = useState(null);

  useEffect(() => {
    if (!userId || !isAutopilot) return;
    Promise.all([
      getAutopilotConfig().catch(() => null),
      getAutopilotSettings().catch(() => null),
    ]).then(([c, s]) => {
      if (c) setAutopilotConfig(c);
      if (s) setAutopilotEnabled(!!s.enabled);
    });
  }, [userId, isAutopilot]);

  const autopilotStatus = !autopilotEnabled
    ? 'off'
    : autopilotConfig?.dryRunGlobal || !autopilotConfig?.liveAllowed
      ? 'dry-run'
      : 'live';

  const contextValue = {
    userId,
    userData,
    selectedFacebookAccount,
    setSelectedFacebookAccount,
    autopilotStatus,
    autopilotEnabled,
    setAutopilotEnabled,
  };

  return (
    <MetaAdsLayoutContext.Provider value={contextValue}>
      <div className="relative flex h-full w-full flex-col overflow-hidden">
        {/* ── Persistent Header Bar ── */}
        <div className="relative z-50 flex flex-shrink-0 flex-wrap items-center justify-between gap-3 border-b border-[#DDD7CD] pl-12 pr-5 py-3 sm:pl-14 lg:px-5 2xl:px-6 2xl:py-4 2xl:pr-8 dark:border-white/[0.06]">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-3">
              <div className="flex h-9.5 w-9.5 items-center justify-center rounded-xl border border-[#DDD7CD] bg-[#FCFAF7] shadow-xs 2xl:h-10.5 2xl:w-10.5 dark:border-white/10 dark:bg-[#1b1c1e]">
                <FaMeta className="h-5.5 w-5.5 text-[#0082FB] 2xl:h-6 2xl:w-6" />
              </div>
              <AdsManagerModeSwitcher
                activeMode={activeMode}
                platform="Meta"
                autopilotAvailable
              />
            </div>
            <p className="px-1 text-xs font-medium text-[#7A7369] dark:text-[#BEBEBE]">
              {isAutopilot ? 'Set budget. Set objective. Walk away.' : 'Manage · Analyse · Optimise'}
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <WorkspaceSwitcher />
            <FacebookAccountSelector
              userId={userId}
              onChange={setSelectedFacebookAccount}
            />

            {isAutopilot && (
              <>
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
              </>
            )}

            <div className="ml-1 2xl:ml-2">
              <ThemeToggle />
            </div>
          </div>
        </div>

        {/* ── Dashboard Content ── */}
        <div className="relative flex-1 overflow-y-auto">
          <Outlet context={contextValue} />
        </div>
      </div>
    </MetaAdsLayoutContext.Provider>
  );
}
