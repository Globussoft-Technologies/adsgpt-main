import { AnimatePresence, motion } from 'framer-motion';
import React, { useEffect, useRef } from 'react';
import { useSelector } from 'react-redux';
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
          className="backdrop-blur-80 rounded-10 fixed top-18 right-4 flex flex-col gap-2 border border-slate-600/40 bg-[#0D0D0D] p-4 lg:relative lg:inset-0 lg:flex-row lg:items-center lg:gap-0 lg:border-none lg:bg-transparent lg:p-1"
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
                className={`2xl:text-13 relative flex items-center rounded-full px-[11px] py-[5px] text-[10px] font-medium whitespace-nowrap transition 2xl:px-4 2xl:py-[7px] ${
                  isActive ? '' : 'text-[#AFAFAF] hover:text-white'
                }`}
              >
                <div
                  id={`tour_header_${tab.label.replace(/\s+/g, '-').toLocaleLowerCase()}_tabs`}
                  className="flex gap-1 2xl:gap-2"
                >
                  {Icon && <Icon className="h-[13px] w-[13px] 2xl:h-5 2xl:w-5" />}
                  {tab.label}
                  {tab?.id === 'adVideo' && (
                    <span className="h-fit rounded-[4px] bg-gradient-to-r from-[#15DCFF] to-[#5E66F5] px-1.5 py-[1px] text-[8px] font-semibold text-white uppercase">
                      Beta
                    </span>
                  )}

                  {isActive && (
                    <motion.div
                      layoutId="activeTabBg"
                      className="absolute inset-0 -z-10 rounded-full from-[#3C3C3C] to-[#3C3C3C] dark:bg-gradient-to-br"
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
