import React from 'react';
import { Lock } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { canUseWorkspaceFeature } from '@/utils/workspaceSession';

const MODE_ROUTES = {
  manager: '/meta-ads',
  autopilot: '/autopilot/meta',
};

/**
 * Shared route-backed switcher for Ads Manager and Autopilot.
 * Uses unified pill capsule container design matching HeaderTabs.
 */
export default function AdsManagerModeSwitcher({
  activeMode = 'manager',
  platform = 'Meta',
  autopilotAvailable = false,
}) {
  const navigate = useNavigate();
  const platformId = platform.toLowerCase();
  const managerAvailable = canUseWorkspaceFeature(`adsManager.${platformId}.manager`);
  const workspaceAutopilotAvailable = canUseWorkspaceFeature(`adsManager.${platformId}.autopilot`);
  const canOpenAutopilot = autopilotAvailable && workspaceAutopilotAvailable;

  const selectMode = (mode) => {
    if (mode === activeMode) return;
    if (mode === 'manager' && !managerAvailable) return;
    if (mode === 'autopilot' && !canOpenAutopilot) return;
    navigate(MODE_ROUTES[mode]);
  };

  const comingSoonLabel = `Autopilot for ${platform} Ads is coming soon`;

  const tabs = [
    { id: 'manager', label: 'Ads Manager', available: managerAvailable },
    { id: 'autopilot', label: 'Autopilot', available: canOpenAutopilot },
  ].filter((tab) => tab.available || activeMode === tab.id);

  return (
    <div
      role="tablist"
      aria-label={`${platform} ads workspace`}
      className="relative flex items-center gap-0 rounded-full border border-black/10 bg-white/80 p-1 shadow-[0_2px_10px_rgba(0,0,0,0.04)] backdrop-blur-md dark:border-transparent dark:bg-[#0D0D0D]"
    >
      {tabs.map((tab) => {
        const isActive = activeMode === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-disabled={!tab.available}
            title={!tab.available ? comingSoonLabel : undefined}
            onClick={() => selectMode(tab.id)}
            className={`2xl:text-13 relative flex items-center rounded-full px-3 py-1.5 text-[11px] font-semibold whitespace-nowrap transition-all duration-200 2xl:px-4.5 2xl:py-2 ${
              isActive
                ? 'font-bold text-zinc-900 dark:text-white'
                : tab.available
                  ? 'text-zinc-600 hover:text-zinc-900 dark:text-[#AFAFAF] dark:hover:text-white'
                  : 'cursor-not-allowed text-zinc-400 dark:text-white/30'
            }`}
          >
            <div className="flex items-center gap-1.5 2xl:gap-2">
              {!tab.available && <Lock className="h-3 w-3" aria-hidden="true" />}
              <span>{tab.label}</span>
              {!tab.available && (
                <span className="rounded-full bg-gradient-to-r from-[#15DCFF] to-[#5E66F5] px-1.5 py-[1px] text-[8px] font-semibold text-white uppercase">
                  Soon
                </span>
              )}
              {isActive && (
                <motion.div
                  layoutId="adsManagerModeTabBg"
                  className="absolute inset-0 -z-10 rounded-full border border-black/5 bg-white shadow-[0_2px_8px_rgba(0,0,0,0.08),0_1px_2px_rgba(0,0,0,0.04)] dark:border-none dark:bg-gradient-to-br dark:from-[#3C3C3C] dark:to-[#3C3C3C] dark:shadow-none"
                  transition={{ type: 'spring', duration: 0.4 }}
                />
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
