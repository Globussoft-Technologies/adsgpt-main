import { AnimatePresence, motion } from 'framer-motion';
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
    <AnimatePresence>
      {isShowHeadersTabs && (
        <motion.div
          ref={tabsRef}
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0, opacity: 0 }}
          transition={{ duration: 0.1, ease: 'easeOut' }}
          className="brand-iq-tabs fixed top-18 right-4 z-50 flex flex-col gap-2 rounded-full border border-black/10 bg-white/80 p-1 shadow-[0_2px_10px_rgba(0,0,0,0.04)] backdrop-blur-md lg:relative lg:inset-0 lg:flex-row lg:items-center lg:gap-0 dark:border-transparent dark:bg-[#0D0D0D]"
        >
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTabId === tab.id;

            return (
              <button
                key={tab.id}
                onClick={() => {
                  const planType = Object.keys(userData?.userSubscriptionType || {})[0];
                  const isPlan = planType == AUTO_GENERATED_PLAN_ID;
                  if (tab.id === 'adVideo' && isPlan) {
                    window.location.href = import.meta.env.VITE_GUEST_USER_SIGNUP_URL;
                  } else {
                    onTabChange(tab.id);
                  }
                }}
                className={`2xl:text-13 relative flex items-center rounded-full px-3 py-1.5 text-[11px] font-semibold whitespace-nowrap transition-all duration-200 2xl:px-4.5 2xl:py-2 ${
                  isActive
                    ? 'font-bold text-zinc-900 dark:text-white'
                    : 'text-zinc-600 hover:text-zinc-900 dark:text-[#AFAFAF] dark:hover:text-white'
                }`}
              >
                <div
                  id={`tour_header_${tab.label.replace(/\s+/g, '-').toLocaleLowerCase()}_tabs`}
                  className="flex items-center gap-1.5 2xl:gap-2"
                >
                  {Icon && <Icon className={`h-3.5 w-3.5 2xl:h-4.5 2xl:w-4.5 ${isActive ? 'text-zinc-900 dark:text-white' : 'text-zinc-500 dark:text-[#AFAFAF]'}`} />}
                  <span>{tab.label}</span>
                  {tab?.id === 'adVideo' && (
                    <span className="h-fit rounded-[4px] bg-gradient-to-r from-[#15DCFF] to-[#5E66F5] px-1.5 py-[1px] text-[8px] font-semibold text-white uppercase">
                      Beta
                    </span>
                  )}

                  {isActive && (
                    <motion.div
                      layoutId="headerTabBg"
                      className="absolute inset-0 -z-10 rounded-full border border-black/5 bg-white shadow-[0_2px_8px_rgba(0,0,0,0.08),0_1px_2px_rgba(0,0,0,0.04)] dark:border-none dark:bg-gradient-to-br dark:from-[#3C3C3C] dark:to-[#3C3C3C] dark:shadow-none"
                      transition={{ type: 'spring', duration: 0.4 }}
                    />
                  )}
                </div>
              </button>
            );
          })}
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default HeaderTabs;
