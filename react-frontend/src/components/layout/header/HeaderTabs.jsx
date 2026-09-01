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
          initial={{ scale: 0.95, opacity: 0, y: -6 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: -6 }}
          transition={{ duration: 0.15, ease: 'easeOut' }}
          className="brand-iq-tabs fixed top-16 right-3 z-50 flex min-w-[170px] flex-col gap-1 rounded-2xl border border-black/10 bg-white/80 p-1.5 shadow-[0_8px_32px_rgba(0,0,0,0.12)] backdrop-blur-md sm:right-6 lg:relative lg:top-0 lg:right-0 lg:flex lg:min-w-0 lg:flex-row lg:items-center lg:gap-0 lg:rounded-full lg:border-black/10 lg:bg-white/80 lg:p-1 lg:shadow-[0_2px_10px_rgba(0,0,0,0.04)] dark:border-white/10 dark:bg-[#0D0D0D]/90 dark:lg:border-transparent dark:lg:bg-[#0D0D0D]"
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
                  if (window.innerWidth < 1024) {
                    setIsShowHeadersTabs(false);
                  }
                }}
                className={`2xl:text-13 relative flex w-full items-center justify-start rounded-xl px-3 py-2 text-xs font-semibold whitespace-nowrap transition-all duration-200 lg:w-auto lg:rounded-full lg:py-1.5 lg:text-[11px] 2xl:px-4.5 2xl:py-2 ${
                  isActive
                    ? 'font-bold text-zinc-900 dark:text-white'
                    : 'text-zinc-600 hover:text-zinc-900 dark:text-[#AFAFAF] dark:hover:text-white'
                }`}
              >
                <div
                  id={`tour_header_${tab.label.replace(/\s+/g, '-').toLocaleLowerCase()}_tabs`}
                  className="flex w-full items-center gap-2 lg:w-auto 2xl:gap-2"
                >
                  {Icon && (
                    <Icon
                      className={`h-4 w-4 shrink-0 2xl:h-4.5 2xl:w-4.5 ${
                        isActive ? 'text-zinc-900 dark:text-white' : 'text-zinc-500 dark:text-[#AFAFAF]'
                      }`}
                    />
                  )}
                  <span className="flex-1 text-left">{tab.label}</span>
                  {tab?.id === 'adVideo' && (
                    <span className="ml-auto h-fit rounded-[4px] bg-gradient-to-r from-[#15DCFF] to-[#5E66F5] px-1.5 py-[1px] text-[8px] font-bold text-white uppercase shadow-xs lg:ml-0">
                      Beta
                    </span>
                  )}

                  {isActive && (
                    <motion.div
                      layoutId="headerTabBg"
                      className="absolute inset-0 -z-10 rounded-xl border border-black/5 bg-white shadow-[0_2px_8px_rgba(0,0,0,0.08),0_1px_2px_rgba(0,0,0,0.04)] lg:rounded-full dark:border-none dark:bg-gradient-to-br dark:from-[#3C3C3C] dark:to-[#3C3C3C] dark:shadow-none"
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
