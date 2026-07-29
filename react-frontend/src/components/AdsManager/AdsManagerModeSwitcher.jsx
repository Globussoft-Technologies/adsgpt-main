import React from 'react';
import { Lock } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const MODE_ROUTES = {
  manager: '/meta-ads',
  autopilot: '/autopilot/meta',
};

/**
 * Shared route-backed switcher for Ads Manager and Autopilot.
 *
 * Keeping the modes on separate routes preserves the dashboards' existing
 * mount/unmount, state, and data-fetching lifecycles.
 */
export default function AdsManagerModeSwitcher({
  activeMode = 'manager',
  platform = 'Meta',
  autopilotAvailable = false,
  appearance = 'segmented',
}) {
  const navigate = useNavigate();

  const selectMode = (mode) => {
    if (mode === activeMode) return;
    if (mode === 'autopilot' && !autopilotAvailable) return;
    navigate(MODE_ROUTES[mode]);
  };

  const managerActive = activeMode === 'manager';
  const autopilotActive = activeMode === 'autopilot';
  const comingSoonLabel = `Autopilot for ${platform} Ads is coming soon`;

  if (appearance === 'tabs') {
    const tabs = [
      { id: 'manager', label: 'Ads Manager', available: true },
      { id: 'autopilot', label: 'Autopilot', available: autopilotAvailable },
    ];

    return (
      <div
        role="tablist"
        aria-label={`${platform} ads workspace`}
        className="inline-flex items-center gap-5 border-b border-gray-200 dark:border-white/10"
      >
        {tabs.map((tab) => {
          const active = activeMode === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              aria-disabled={!tab.available}
              title={!tab.available ? comingSoonLabel : undefined}
              onClick={() => selectMode(tab.id)}
              className={`relative flex items-center gap-1.5 px-1 pt-1 pb-2.5 text-sm font-semibold whitespace-nowrap transition-colors duration-200 2xl:text-[15px] ${
                active
                  ? 'text-gray-900 dark:text-white'
                  : tab.available
                    ? 'text-gray-500 hover:text-gray-900 dark:text-white/50 dark:hover:text-white/85'
                    : 'cursor-not-allowed text-gray-400 dark:text-white/30'
              }`}
            >
              {!tab.available && <Lock className="h-3 w-3" aria-hidden="true" />}
              {tab.label}
              {active && (
                <span className="absolute right-0 bottom-0 left-0 h-0.5 rounded-full bg-gradient-to-r from-[#20CFF5] to-[#7567F8]" />
              )}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div
      role="tablist"
      aria-label={`${platform} ads workspace`}
      className="inline-flex items-center rounded-xl border border-gray-200 bg-gray-100/80 p-1 shadow-sm dark:border-white/10 dark:bg-white/[0.05]"
    >
      <button
        type="button"
        role="tab"
        aria-selected={managerActive}
        onClick={() => selectMode('manager')}
        className={`rounded-lg px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition-all duration-200 2xl:px-3.5 2xl:text-sm ${
          managerActive
            ? 'bg-white text-gray-900 shadow-sm dark:bg-white/12 dark:text-white'
            : 'text-gray-500 hover:text-gray-900 dark:text-white/55 dark:hover:text-white'
        }`}
      >
        Ads Manager
      </button>

      <button
        type="button"
        role="tab"
        aria-selected={autopilotActive}
        aria-disabled={!autopilotAvailable}
        title={!autopilotAvailable ? comingSoonLabel : undefined}
        onClick={() => selectMode('autopilot')}
        className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition-all duration-200 2xl:px-3.5 2xl:text-sm ${
          autopilotActive
            ? 'bg-white text-gray-900 shadow-sm dark:bg-white/12 dark:text-white'
            : autopilotAvailable
              ? 'text-gray-500 hover:text-gray-900 dark:text-white/55 dark:hover:text-white'
              : 'cursor-not-allowed text-gray-400 dark:text-white/30'
        }`}
      >
        {!autopilotAvailable && <Lock className="h-3 w-3" aria-hidden="true" />}
        <span>Autopilot</span>
        {!autopilotAvailable && (
          <span className="hidden rounded-full bg-gradient-to-r from-[#20CFF5] to-[#7567F8] px-2 py-0.5 text-[8px] leading-none font-bold tracking-[0.08em] text-white uppercase shadow-sm sm:inline 2xl:text-[9px]">
            soon
          </span>
        )}
      </button>
    </div>
  );
}
