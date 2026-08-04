import React, { useEffect, useState, useMemo } from 'react';
import AdCardContainer from './Cards/AdCardContainer';
import AdMarketAnalyticsTopPlateform from './Graphs/AdMarketAnalyticsTopPlateform';
import AdCountByPostOwner from './Graphs/AdCountByPostOwner';
import GeographicalAdDistribution from './Graphs/GeographicalAdDistribution';
import AdMarketAnalysisLineChart from './Graphs/AdMarketAnalysisLineChart';
import ChatBot from './Addie/ChatBotButton';
import AddieChatBotInterface from './Addie/AddieChatBotHome';
import { motion, AnimatePresence } from 'framer-motion';
import { layoutTransitionVariants } from '@/utils/ui/framerMotionVariants';
import { useDispatch, useSelector } from 'react-redux';
import { freshUserData } from '@/store/actions/adInsights/addieActions';
import { fetchAdHistory } from '@/store/actions/adStudio/adHistoryActions';
import { setActiveSessionId } from '@/store/reducers/adStudio/adHistorySlice';

// Memoize child components to prevent unnecessary re-renders
const MemoAdCardContainer = React.memo(AdCardContainer);
const MemoAdMarketAnalysisLineChart = React.memo(AdMarketAnalysisLineChart);
const MemoAdMarketAnalyticsTopPlateform = React.memo(AdMarketAnalyticsTopPlateform);
const MemoAdCountByPostOwner = React.memo(AdCountByPostOwner);
const MemoGeographicalAdDistribution = React.memo(GeographicalAdDistribution);
const MemoAddieChatBotInterface = React.memo(AddieChatBotInterface);
const MemoChatBot = React.memo(ChatBot);

const AdInsightsHome = () => {
  const dispatch = useDispatch();

  // Use more specific selectors to avoid unnecessary re-renders
  const isAddieChatVisible = useSelector((state) => state.addie?.addieChatVisibility);

  // Select only needed data to prevent re-renders when unrelated state changes
  const adData = useSelector((state) => state.addie?.adData);
  const scrollLoading = useSelector((state) => state.addie?.scrollLoading);
  const hasMore = useSelector((state) => state.addie?.hasMore);
  const currentContext = useSelector((state) => state.addie?.currentContext);
  const historyError = useSelector((state) => state.addie?.historyError);
  const isEmulatorHistory = useSelector((state) => state.addie?.isEmulatorHistory);
  const em1 = useSelector((state) => state.addieHistory?.em1);

  // Memoize ad card props
  const adCardProps = useMemo(
    () => ({
      adsData: adData,
      scrollLoading: scrollLoading,
      hasMore: hasMore,
    }),
    [adData, scrollLoading, hasMore]
  );

  // Memoize layout transition variants
  const transitionVariants = useMemo(() => layoutTransitionVariants, []);

  // Fetch ad history when em1 changes
  useEffect(() => {
    if (em1 && !isEmulatorHistory) {
      dispatch(fetchAdHistory(em1))
        .then((result) => {
          if (fetchAdHistory.fulfilled.match(result)) {
            // Status 200 - success
            dispatch(setActiveSessionId(em1));
          } else {
            // Status not 200 - call freshUserData
            dispatch(freshUserData());
          }
        })
        .catch((error) => {
          // Network errors or other exceptions
          console.error('Fetch error:', error);
          dispatch(freshUserData());
        });
    }
  }, [em1, isEmulatorHistory, dispatch]);

  // Reset scroll position when currentContext changes (new history loaded)
  useEffect(() => {
    const scrollContainer = document.querySelector('.adinsight_adcard_left_container');
    if (scrollContainer) {
      scrollContainer.scrollTop = 0;
    }
  }, [currentContext]);

  // Memoize container classes to prevent re-calculation on every render
  const leftContainerClass = useMemo(
    () =>
      `adinsight_adcard_left_container scrollbar-hide ${isAddieChatVisible ? 'col-span-10 sm:col-span-4 xl:col-span-2' : 'col-span-10 sm:col-span-4'} max-h-full overflow-auto overflow-y-auto sm:max-h-[calc(100svh-80px)] 2xl:max-h-[calc(100svh-112px)]`,
    [isAddieChatVisible]
  );

  const rightContainerClass = useMemo(
    () =>
      `adinsight_graphs_right_container [scrollbar-gutter:stable_both-edges] ${isAddieChatVisible ? 'col-span-10 sm:col-span-6 xl:col-span-5' : 'col-span-10 sm:col-span-6'} flex max-h-[calc(100svh-80px)] flex-col gap-6 sm:overflow-auto sm:overflow-y-auto 2xl:max-h-[calc(100svh-112px)]`,
    [isAddieChatVisible]
  );

  useEffect(() => {
    if (isAddieChatVisible) {
      document.body.style.overflow = 'hidden'; // disable scroll
    } else {
      document.body.style.overflow = 'auto'; // restore scroll
    }

    // cleanup in case component unmounts
    return () => {
      document.body.style.overflow = 'auto';
    };
  }, [isAddieChatVisible]);

  return (
    <div className="adinsights_container_ col-span-10 grid w-full grid-cols-10 gap-3 lg:px-6 2xl:gap-5 2xl:px-8">
      <motion.div
        layout
        layoutId="adcard-container"
        transition={transitionVariants?.transition}
        className={leftContainerClass}
      >
        <MemoAdCardContainer {...adCardProps} />
      </motion.div>

      <motion.div
        layout
        layoutId="graphs-container"
        transition={transitionVariants?.transition}
        className={rightContainerClass}
      >
        <MemoAdMarketAnalysisLineChart />
        <MemoAdMarketAnalyticsTopPlateform />
        <MemoAdCountByPostOwner />
        <MemoGeographicalAdDistribution />
      </motion.div>

      <AnimatePresence>
        {isAddieChatVisible && (
          <motion.div
            initial={{ opacity: 0, scaleX: 0 }}
            animate={{ opacity: 1, scaleX: 1 }}
            exit={{ opacity: 0, scaleX: 0 }}
            transition={{ duration: 0.3 }}
            className="addie_chat_container fixed top-[calc(50%-8px)] left-1/2 z-55 col-span-3 flex h-full max-h-[calc(100svh-92px)] w-[95%] -translate-x-1/2 -translate-y-1/2 flex-col gap-6 overflow-auto overflow-y-auto sm:w-auto xl:relative 2xl:top-[calc(50%-10px)] 2xl:max-h-[calc(100svh-130px)]"
          >
            <MemoAddieChatBotInterface />
          </motion.div>
        )}
        {isAddieChatVisible && (
          <div className="overlay fixed inset-0 z-[54] block bg-black/10 backdrop-blur xl:hidden"></div>
        )}
      </AnimatePresence>

      {/* Addie Open/Close button here */}
      {!isAddieChatVisible && <MemoChatBot />}
    </div>
  );
};

export default React.memo(AdInsightsHome);
