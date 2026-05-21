import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Menu, X, EllipsisVertical, Trash2 } from 'lucide-react';
import adsgptLogo from '@/assets/layouts/adsgpt-dark-mode-logo.svg';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FRAMER_CONTAINER_FADE_RIGHT_VARIANTS,
  FRAMER_ITEM_FADE_RIGHT_VARIANTS,
} from '@/utils/ui/framerMotionVariants';
import { ShadcnTooltip } from '@/components/layout/ShadcnTooltip';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useDispatch, useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';
import {
  deleteAdHistory,
  fetchAdHistory,
  fetchAdHistoryTitles,
} from '@/store/actions/adStudio/adHistoryActions';
import { setIsHistory } from '@/store/reducers/adStudio/adHistorySlice';
import {
  addtoggleAddieChatVisibility,
  resetScrollState,
  setAddieTyping,
  setIsEmulatorHistory,
  setIsFreshUser,
  toggleAddieHistory,
} from '@/store/reducers/adInsights/Addie/AddieChatBotSlice';
import DeleteChatHistoryDialog from '@/components/common/AdPrompt/History/DeleteChatHistoryDialog';

// Skeleton Loader Components
const HistorySectionSkeleton = ({ title }) => (
  <div className="mb-4">
    <div className="text-10 mb-1 px-2 font-semibold text-neutral-400 2xl:mb-2 2xl:px-3 2xl:text-sm">
      {title}
    </div>
    <div className="flex flex-col gap-0.5">
      {[1, 2, 3].map((item) => (
        <div
          key={item}
          className="flex w-full items-center rounded-sm p-2 py-[5px] pr-0.5 2xl:rounded-[10px] 2xl:py-2 2xl:pl-3"
        >
          <div className="history_text text-10 w-full truncate overflow-hidden font-medium whitespace-nowrap 2xl:text-sm">
            <div className="h-4 w-full max-w-full animate-pulse rounded bg-[#2A2A2A]"></div>
          </div>
          <div className="icon_container ml-1.5 rounded-lg">
            <div className="h-4 w-4 animate-pulse rounded bg-[#2A2A2A]"></div>
          </div>
        </div>
      ))}
    </div>
  </div>
);

const ExploreSectionSkeleton = () => (
  <motion.div
    className="explore_adsgpt flex w-full items-center gap-3 px-5 pt-3 pb-8"
    variants={FRAMER_CONTAINER_FADE_RIGHT_VARIANTS}
    initial="hidden"
    animate="visible"
    exit="exit"
  >
    <motion.div
      className="icon flex h-10 w-10 animate-pulse items-center justify-center rounded-full bg-[#2A2A2A] p-1"
      variants={FRAMER_ITEM_FADE_RIGHT_VARIANTS}
    >
      <div className="h-6 w-6 rounded bg-[#3A3A3A]"></div>
    </motion.div>
    <motion.div className="flex-1" variants={FRAMER_ITEM_FADE_RIGHT_VARIANTS}>
      <div className="h-5 w-40 animate-pulse rounded bg-[#2A2A2A]"></div>
    </motion.div>
  </motion.div>
);

const AddieHistory = () => {
  const dispatch = useDispatch();
  const location = useLocation();
  const currentRoute = location.pathname;
  const {
    todayTitles,
    yesterdayTitles,
    last7DaysTitles,
    olderTitles,
    activeSessionId,
    loading: historyLoading,
  } = useSelector((state) => state.adHistory);

  const { activeAdStudioTabId } = useSelector((state) => state.adStudioTabs);
  const { showAddieHistory } = useSelector((state) => state.addie);

  const [openPopovers, setOpenPopovers] = useState({});
  const [deleteDialogData, setDeleteDialogData] = useState(null); // { sessionId, type }
  const [hoveredSession, setHoveredSession] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  const noHistory = useMemo(
    () =>
      todayTitles.length === 0 &&
      yesterdayTitles.length === 0 &&
      last7DaysTitles.length === 0 &&
      olderTitles.length === 0,
    [todayTitles, yesterdayTitles, last7DaysTitles, olderTitles]
  );

  const handleHistoryClick = useCallback(
    (sessionId) => {
      dispatch(setIsHistory(activeAdStudioTabId));
      dispatch(setIsEmulatorHistory(true));
      dispatch(fetchAdHistory(sessionId));
      dispatch(addtoggleAddieChatVisibility(true));
      dispatch(setIsFreshUser(false));
      dispatch(resetScrollState());
      dispatch(setAddieTyping(false));
    },
    [dispatch, activeAdStudioTabId]
  );

  useEffect(() => {
    if (currentRoute === '/adinsights' && showAddieHistory) {
      setIsLoading(true);
      dispatch(fetchAdHistoryTitles('emulator')).finally(() => {
        setIsLoading(false);
      });
    }
  }, [dispatch, showAddieHistory, currentRoute]);

  // Optimized popover handlers
  const handlePopoverOpenChange = useCallback((sessionId, isOpen) => {
    setOpenPopovers((prev) => ({ ...prev, [sessionId]: isOpen }));
  }, []);

  const handleOpenDeleteDialog = useCallback((sessionId, type) => {
    setDeleteDialogData({ sessionId, type });
    setOpenPopovers((prev) => ({ ...prev, [sessionId]: false }));
  }, []);

  const handleCloseDeleteDialog = useCallback(() => {
    setDeleteDialogData(null);
  }, []);

  const handleDelete = useCallback(
    async (sessionId, type) => {
      if (!sessionId) return;

      try {
        // Force immediate UI update by manually filtering the titles
        const updatedTitles = {
          today: todayTitles.filter((item) => item.sessionId !== sessionId),
          yesterday: yesterdayTitles.filter((item) => item.sessionId !== sessionId),
          last7Days: last7DaysTitles.filter((item) => item.sessionId !== sessionId),
          older: olderTitles.filter((item) => item.sessionId !== sessionId),
        };

        // Update Redux store manually (you'll need to dispatch an action for this)
        // Or rely on the refetch below

        await dispatch(
          deleteAdHistory({
            sessionId,
            type,
            activeAdStudioTabId,
            activeSessionId,
          })
        ).unwrap();

        // Force refetch to sync with server
        if (currentRoute === '/adinsights' && showAddieHistory) {
          await dispatch(fetchAdHistoryTitles('emulator'));
        }
      } catch (error) {
        console.error('Failed to delete history:', error);
        // Refetch on error to restore correct state
        if (currentRoute === '/adinsights' && showAddieHistory) {
          dispatch(fetchAdHistoryTitles('emulator'));
        }
      } finally {
        setDeleteDialogData(null);
        setOpenPopovers((prev) => ({ ...prev, [sessionId]: false }));
      }
    },
    [
      dispatch,
      activeAdStudioTabId,
      activeSessionId,
      currentRoute,
      showAddieHistory,
      todayTitles,
      yesterdayTitles,
      last7DaysTitles,
      olderTitles,
    ]
  );

  // Function to find session type
  const getSessionType = useCallback(
    (sessionId) => {
      if (todayTitles.find((item) => item.sessionId === sessionId)) return 'today';
      if (yesterdayTitles.find((item) => item.sessionId === sessionId)) return 'yesterday';
      if (last7DaysTitles.find((item) => item.sessionId === sessionId)) return '7days';
      if (olderTitles.find((item) => item.sessionId === sessionId)) return 'older';
      return 'today'; // fallback
    },
    [todayTitles, yesterdayTitles, last7DaysTitles, olderTitles]
  );

  // Optimized History Item Component
  const HistoryItem = React.memo(({ title, sessionId, type, isActive }) => {
    const isHovered = hoveredSession === sessionId;
    const isPopoverOpen = openPopovers[sessionId];

    const handleMouseEnter = useCallback(() => {
      setHoveredSession(sessionId);
    }, [sessionId]);

    const handleMouseLeave = useCallback(() => {
      setHoveredSession(null);
    }, []);

    const handleClick = useCallback(() => {
      handleHistoryClick(sessionId);
      dispatch(toggleAddieHistory());
    }, [handleHistoryClick, sessionId]);

    const handleDeleteClick = useCallback(
      (e) => {
        e.stopPropagation();
        handleOpenDeleteDialog(sessionId, type);
      },
      [handleOpenDeleteDialog, sessionId, type]
    );

    return (
      <motion.div
        variants={FRAMER_ITEM_FADE_RIGHT_VARIANTS}
        className={`group flex w-full cursor-pointer items-center rounded-sm p-2 py-[5px] pr-0.5 2xl:rounded-[10px] 2xl:py-2 2xl:pl-3 ${
          isActive ? 'bg-[#2A2A2A]' : 'hover:overflow-hidden hover:bg-[#2A2A2A]'
        }`}
        onClick={handleClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <div
          className={`history_text text-10 w-full truncate overflow-hidden font-medium whitespace-nowrap text-white hover:overflow-hidden 2xl:text-sm`}
        >
          {title || ''}
        </div>

        <div className="h-5 p-0" onClick={(e) => e.stopPropagation()}>
          <Popover
            open={isPopoverOpen}
            onOpenChange={(isOpen) => handlePopoverOpenChange(sessionId, isOpen)}
          >
            <PopoverTrigger asChild>
              <button
                className={`icon_container mx-1.5 rounded-lg transition-opacity duration-200 group-hover:opacity-100 hover:bg-white/20 lg:opacity-0 ${
                  isPopoverOpen ? 'bg-white/20 opacity-100' : ''
                }`}
                onClick={(e) => {
                  e.stopPropagation();
                  handlePopoverOpenChange(sessionId, !isPopoverOpen);
                }}
              >
                <EllipsisVertical className="h-5 w-5 flex-1 py-0.5 text-white" />
              </button>
            </PopoverTrigger>
            <PopoverContent
              className="max-w-fit border-white/20 p-2 backdrop-blur-[100px] dark:bg-[#0D0D0D]/50"
              align="end"
            >
              <button
                className="delete_option flex w-full items-center gap-1.5 rounded-sm p-2 text-xs hover:bg-white/10 2xl:text-sm"
                onClick={handleDeleteClick}
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </button>
            </PopoverContent>
          </Popover>
        </div>
      </motion.div>
    );
  });

  HistoryItem.displayName = 'HistoryItem';

  // Memoized section components with proper type passing
  const TodaySection = useMemo(() => {
    if (!Array.isArray(todayTitles) || todayTitles.length === 0) return null;

    return (
      <motion.div
        variants={FRAMER_CONTAINER_FADE_RIGHT_VARIANTS}
        initial="hidden"
        animate="visible"
        exit="exit"
      >
        <p className="text-10 mb-1 px-2 font-semibold text-neutral-400 2xl:mb-2 2xl:px-3 2xl:text-sm">
          Today
        </p>
        <div className="flex flex-col gap-0.5">
          {todayTitles.map(({ _id, title, sessionId }) => (
            <HistoryItem
              key={_id}
              title={title}
              sessionId={sessionId}
              type="today"
              isActive={activeSessionId === sessionId}
            />
          ))}
        </div>
      </motion.div>
    );
  }, [todayTitles, activeSessionId]);

  const YesterdaySection = useMemo(() => {
    if (!Array.isArray(yesterdayTitles) || yesterdayTitles.length === 0) return null;

    return (
      <motion.div
        variants={FRAMER_CONTAINER_FADE_RIGHT_VARIANTS}
        initial="hidden"
        animate="visible"
        exit="exit"
      >
        <p className="text-10 mb-1 px-2 font-semibold text-neutral-400 2xl:mb-2 2xl:px-3 2xl:text-sm">
          Yesterday
        </p>
        <div className="flex flex-col gap-0.5 2xl:gap-1">
          {yesterdayTitles.map(({ _id, title, sessionId }) => (
            <HistoryItem
              key={_id}
              title={title}
              sessionId={sessionId}
              type="yesterday"
              isActive={activeSessionId === sessionId}
            />
          ))}
        </div>
      </motion.div>
    );
  }, [yesterdayTitles, activeSessionId]);

  const Last7DaysSection = useMemo(() => {
    if (!Array.isArray(last7DaysTitles) || last7DaysTitles.length === 0) return null;

    return (
      <motion.div
        variants={FRAMER_CONTAINER_FADE_RIGHT_VARIANTS}
        initial="hidden"
        animate="visible"
        exit="exit"
      >
        <p className="text-10 mb-1 px-2 font-semibold text-neutral-400 2xl:mb-2 2xl:px-3 2xl:text-sm">
          Previous 7 Days
        </p>
        <div className="flex flex-col gap-1">
          {last7DaysTitles.map(({ _id, title, sessionId }) => (
            <HistoryItem
              key={_id}
              title={title}
              sessionId={sessionId}
              type="7days"
              isActive={activeSessionId === sessionId}
            />
          ))}
        </div>
      </motion.div>
    );
  }, [last7DaysTitles, activeSessionId]);

  const OlderSection = useMemo(() => {
    if (!Array.isArray(olderTitles) || olderTitles.length === 0) return null;

    return (
      <motion.div
        variants={FRAMER_CONTAINER_FADE_RIGHT_VARIANTS}
        initial="hidden"
        animate="visible"
        exit="exit"
      >
        <p className="text-10 mb-2 px-4 font-semibold text-neutral-400 2xl:text-sm">Older</p>
        <div className="flex flex-col gap-1">
          {olderTitles.map(({ _id, title, sessionId }) => (
            <HistoryItem
              key={_id}
              title={title}
              sessionId={sessionId}
              type="older"
              isActive={activeSessionId === sessionId}
            />
          ))}
        </div>
      </motion.div>
    );
  }, [olderTitles, activeSessionId]);

  // Loading State
  if (isLoading) {
    return (
      <motion.aside
        className="fixed top-0 bottom-0 left-0 z-50 flex w-full max-w-[95%] flex-col bg-[#161616]"
        initial={{ x: '-100%' }}
        animate={{ x: 0 }}
        exit={{ x: '-100%' }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
      >
        {/* Header - Same as actual component */}
        <div className="flex items-center justify-between bg-[#202020]/50 p-3.5 backdrop-blur-[80px] 2xl:p-5">
          <div className="flex items-center gap-2 pl-1">
            <h2 className="text-base font-medium text-[#AFAFAF] 2xl:text-xl">Chat History</h2>
          </div>
          <ShadcnTooltip label="Close Addie">
            <button
              className="rounded-full p-2 hover:bg-[#3f3d3d]/80"
              onClick={() => dispatch(toggleAddieHistory())}
            >
              <X className="h-5 w-5 text-white" />
            </button>
          </ShadcnTooltip>
        </div>

        {/* Body - Loading State with exact same structure */}
        <div className="flex-1 overflow-y-auto backdrop-blur-[100px] 2xl:py-4">
          <ExploreSectionSkeleton />

          {/* Loading sections with exact same spacing and structure */}
          <div className="space-y-3 p-2 2xl:space-y-5 2xl:p-3">
            <HistorySectionSkeleton title="Today" />
            <HistorySectionSkeleton title="Yesterday" />
            <HistorySectionSkeleton title="Previous 7 Days" />
            <HistorySectionSkeleton title="Older" />
          </div>

          <div className="div px-5">
            <div className="my-3 h-[0.8px] w-full bg-white/10"></div>
          </div>
        </div>
      </motion.aside>
    );
  }

  return (
    <>
      <motion.aside
        className="fixed top-0 bottom-0 left-0 z-50 flex max-w-[95%] min-w-[95%] flex-col bg-[#161616]"
        initial={{ x: '-100%' }}
        animate={{ x: 0 }}
        exit={{ x: '-100%' }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between bg-[#202020]/50 p-3.5 backdrop-blur-[80px] 2xl:p-5">
          <div className="flex items-center gap-2 pl-1">
            <h2 className="text-sm font-medium text-[#AFAFAF] 2xl:text-xl">Chat History</h2>
          </div>
          <ShadcnTooltip label="Close Addie">
            <button
              className="rounded-full p-2 hover:bg-[#3f3d3d]/80"
              onClick={() => dispatch(toggleAddieHistory())}
            >
              <X className="h-5 w-5 text-white" />
            </button>
          </ShadcnTooltip>
        </div>

        {/*Body */}
        <div className="flex-1 overflow-y-auto backdrop-blur-[100px] 2xl:py-4">
          <motion.div
            className="explore_adsgpt flex w-full cursor-pointer items-center gap-2 px-3 pt-3 pb-2 2xl:gap-3 2xl:px-5 2xl:pb-4"
            variants={FRAMER_CONTAINER_FADE_RIGHT_VARIANTS}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
            <motion.div
              className="icon flex h-7 w-7 items-center justify-center rounded-full bg-[#2A2A2A] p-1 2xl:h-10 2xl:w-10"
              variants={FRAMER_ITEM_FADE_RIGHT_VARIANTS}
            >
              <img src={adsgptLogo} alt="AdsGPT Logo" />
            </motion.div>
            <motion.p
              className="text-xs font-semibold text-[#AFAFAF] hover:text-white 2xl:text-[16px]"
              variants={FRAMER_ITEM_FADE_RIGHT_VARIANTS}
            >
              Explore AdsGPT
            </motion.p>
          </motion.div>

          {/* No History State */}
          {noHistory && (
            <motion.div
              variants={FRAMER_CONTAINER_FADE_RIGHT_VARIANTS}
              initial="hidden"
              animate="visible"
              exit="exit"
            >
              <p className="text-10 mb-1 px-2 font-semibold text-neutral-400 2xl:mb-2 2xl:px-3 2xl:text-sm">
                No Chats
              </p>
            </motion.div>
          )}

          {/* History Sections */}
          <div className="space-y-3 p-2 2xl:space-y-5 2xl:p-3">
            <div className="mx-auto h-[1px] max-w-[95%] bg-white/10"></div>
            {TodaySection}
            <div className="mx-auto h-[1px] max-w-[95%] bg-white/10"></div>
            {YesterdaySection}
            {Last7DaysSection}
            {OlderSection}
          </div>

          <div className="div px-5">
            <div className="my-3 h-[0.8px] w-full bg-white/10"></div>
          </div>
        </div>
      </motion.aside>

      {/* Delete Dialog - Render once at the root level */}
      <DeleteChatHistoryDialog
        open={!!deleteDialogData}
        onOpenChange={(isOpen) => {
          if (!isOpen) handleCloseDeleteDialog();
        }}
        onDelete={() => {
          if (deleteDialogData) {
            handleDelete(deleteDialogData.sessionId, deleteDialogData.type);
          }
        }}
      />
    </>
  );
};

export default React.memo(AddieHistory);
