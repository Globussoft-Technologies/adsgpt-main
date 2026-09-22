import { motion } from 'framer-motion';
import React, { useEffect, useRef } from 'react';
import { useSelector } from 'react-redux';
import { GA4Events, trackGA4PageView } from '@/utils/ga4';
const AUTO_GENERATED_PLAN_ID = import.meta.env.VITE_AUTO_GENERATED_PLAN_ID;

const HeaderTabs = ({
  isShowHeadersTabs,
  setIsShowHeadersTabs,
  mobileTabsOpenRef,
  tabs,
  activeTabId,
  onTabChange,
}) => {
  const tabsRef = useRef(null);
  const { userData, credits } = useSelector((state) => state.socket);

  useEffect(() => {
    const handleClickOutside = (event) => {
      // Check if click is outside both the tabs container and mobileTabsOpenRef
      if (window.innerWidth < 1024) {
        if (
          tabsRef.current &&
          !tabsRef.current.contains(event.target) &&
          (!mobileTabsOpenRef || !mobileTabsOpenRef.current.contains(event.target))
        ) {
          setIsShowHeadersTabs(false);
        }
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [setIsShowHeadersTabs, mobileTabsOpenRef]);

  return (
    <div
      ref={tabsRef}
      className="brand-iq-tabs flex items-center gap-3 overflow-x-auto scroll-smooth pt-1 pb-2 select-none no-scrollbar sm:gap-4 md:gap-5 2xl:gap-6"
    >
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeTabId === tab.id;

        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => {
              const planType = Object.keys(userData?.userSubscriptionType || {})[0];
              const isPlan = planType == AUTO_GENERATED_PLAN_ID;
              if (tab.id === 'adVideo' && isPlan) {
                window.location.href = import.meta.env.VITE_GUEST_USER_SIGNUP_URL;
              } else {
                onTabChange(tab.id);
              }
            }}
            className={`relative flex shrink-0 items-center justify-start py-1 text-xs font-medium whitespace-nowrap transition-colors select-none cursor-pointer sm:text-[13px] 2xl:text-[14.5px] ${
              isActive
                ? 'font-semibold text-zinc-950 dark:text-white'
                : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white'
            }`}
          >
            <div
              id={`tour_header_${tab.label.replace(/\s+/g, '-').toLocaleLowerCase()}_tabs`}
              className="flex items-center gap-1.5 sm:gap-2"
            >
              {Icon && (
                <Icon
                  className={`h-3.5 w-3.5 sm:h-4 sm:w-4 shrink-0 2xl:h-[18px] 2xl:w-[18px] transition-colors ${
                    isActive
                      ? 'text-zinc-950 dark:text-white stroke-[2.2]'
                      : 'text-zinc-400 dark:text-zinc-400 stroke-[1.8]'
                  }`}
                />
              )}
              <span>{tab.label}</span>

              {/* Active underline indicator */}
              {isActive && (
                <motion.div
                  layoutId="activeHeaderTabUnderline"
                  className="absolute -bottom-1.5 left-0 right-0 h-[2px] rounded-full bg-zinc-950 dark:bg-white"
                  transition={{ type: 'spring', stiffness: 450, damping: 35 }}
                />
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
};

export default HeaderTabs;
