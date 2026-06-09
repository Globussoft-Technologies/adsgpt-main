import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  deleteAdHistory,
  fetchAdHistory,
  fetchAdHistoryTitles,
} from '@/store/actions/adStudio/adHistoryActions';
import {
  FRAMER_CONTAINER_FADE_RIGHT_VARIANTS,
  FRAMER_ITEM_FADE_RIGHT_VARIANTS,
} from '@/utils/ui/framerMotionVariants';
import { AnimatePresence, motion } from 'framer-motion';
import { EllipsisVertical, Trash, Trash2 } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import DeleteChatHistoryDialog from './History/DeleteChatHistoryDialog';
import { setIsHistory } from '@/store/reducers/adStudio/adHistorySlice';
import {
  addtoggleAddieChatVisibility,
  resetAddieStates,
  resetScrollState,
  setAddieTyping,
  setIsEmulatorHistory,
  setIsFreshUser,
  setLoading,
  setScrollLoading,
  setScrollSkip,
  setShowWelcomePage,
} from '@/store/reducers/adInsights/Addie/AddieChatBotSlice';
import { useLocation } from 'react-router-dom';

const ChatHistorySection = ({ isSidebarOpen }) => {
  const dispatch = useDispatch();
  const location = useLocation();
  const currentRoute = location.pathname;
  const { todayTitles, yesterdayTitles, last7DaysTitles, olderTitles, activeSessionId } =
    useSelector((state) => state.adHistory);

  const { activeAdStudioTabId } = useSelector((state) => state.adStudioTabs);

  const noHistory =
    todayTitles.length === 0 &&
    yesterdayTitles.length === 0 &&
    last7DaysTitles.length === 0 &&
    olderTitles.length === 0;

  const handleHistoryClick = (sessionId) => {
    dispatch(setIsHistory(activeAdStudioTabId));
    dispatch(setIsEmulatorHistory(true));
    dispatch(fetchAdHistory(sessionId));
    dispatch(addtoggleAddieChatVisibility(true));
    dispatch(setIsFreshUser(false));
    dispatch(resetScrollState());
    dispatch(setAddieTyping(false));
  };

  useEffect(() => {
    if (activeAdStudioTabId && isSidebarOpen) {
      dispatch(fetchAdHistoryTitles(activeAdStudioTabId));
    }
  }, [activeAdStudioTabId, dispatch, isSidebarOpen]);
  // useEffect(() => {
  //   if (activeAdStudioTabId && isSidebarOpen) {
  //     dispatch(fetchAdHistoryTitles(activeAdStudioTabId));
  //   }
  // }, [activeAdStudioTabId, dispatch, isSidebarOpen]);

  const [open, setOpen] = useState({});
  const [openDeleteDialog, onOpenChangeDeleteDialog] = useState(false);

  // const handleCloseDeleteDialog = (isOpen) => {
  //   onOpenChangeDeleteDialog(isOpen);
  //   if (!isOpen) {
  //     setOpen(false);
  //   }
  // };
  const [deleteDialogSession, setDeleteDialogSession] = useState(null);

  // Open dialog for a specific session
  const handleOpenDeleteDialog = (sessionId) => {
    setDeleteDialogSession(sessionId);
    setOpen(false); // close popover
  };

  // Close dialog
  const handleCloseDeleteDialog = () => {
    setDeleteDialogSession(null);
  };

  const handleDelete = (id, type) => {
    if (id)
      dispatch(deleteAdHistory({ sessionId: id, type, activeAdStudioTabId, activeSessionId }));
    // Close the dialog after deleting
    setDeleteDialogSession(null);

    // Optionally close the popover as well
    setOpen((prev) => ({ ...prev, [id]: false }));

    if (isSidebarOpen) {
      dispatch(fetchAdHistoryTitles(activeAdStudioTabId));
    }
  };

  const [hoveredSession, setHoveredSession] = useState(null);

  return (
    <AnimatePresence mode="wait">
      {isSidebarOpen && (
        <motion.div
          key={`history-${activeAdStudioTabId}`}
          variants={FRAMER_CONTAINER_FADE_RIGHT_VARIANTS}
          initial="hidden"
          animate="visible"
          exit="exit"
          className="history_container scrollbar-thin max-h-[calc(100svh-240px)] space-y-3 overflow-y-auto p-2 xl:max-h-[calc(100svh-235px)] 2xl:max-h-[calc(100svh-310px)] 2xl:space-y-5 2xl:p-3"
        >
          {noHistory && (
            <div className="today">
              <motion.p
                variants={FRAMER_ITEM_FADE_RIGHT_VARIANTS}
                className="text-10 mb-1 px-2 font-semibold text-zinc-400 2xl:mb-2 2xl:px-3 2xl:text-sm dark:text-neutral-400"
              >
                No Chats
              </motion.p>
            </div>
          )}
          {Array.isArray(todayTitles) && todayTitles.length > 0 && (
            <div className="today">
              <motion.p
                variants={FRAMER_ITEM_FADE_RIGHT_VARIANTS}
                className="text-10 mb-1 px-2 font-semibold text-zinc-400 2xl:mb-2 2xl:px-3 2xl:text-sm dark:text-neutral-400"
              >
                Today
              </motion.p>
              <div className="flex flex-col gap-0.5">
                <AnimatePresence mode="popLayout">
                  {todayTitles.map(({ _id, title, sessionId }) => (
                    <motion.p
                      key={_id}
                      layout
                      variants={FRAMER_ITEM_FADE_RIGHT_VARIANTS}
                      initial="hidden"
                      animate="visible"
                      exit="exit"
                      className={`flex w-full cursor-pointer items-center rounded-sm p-2 py-[5px] pr-0.5 2xl:rounded-[10px] 2xl:py-2 2xl:pl-3 ${activeSessionId === sessionId ? 'bg-zinc-200 dark:bg-[#2A2A2A]' : 'hover:overflow-hidden hover:bg-zinc-100 dark:hover:bg-[#2A2A2A]'} `}
                      onClick={() => handleHistoryClick(sessionId)}
                      onMouseEnter={() => setHoveredSession(sessionId)}
                      onMouseLeave={() => setHoveredSession(null)}
                    >
                      <div
                        className={`history_text text-10 w-full truncate overflow-hidden font-medium whitespace-nowrap text-zinc-900 2xl:text-sm dark:text-white ${activeSessionId === sessionId ? 'max-w-[89%]' : ' '} hover:overflow-hidden`}
                      >
                        {title || ''}
                      </div>

                      <Popover
                        open={!!open[sessionId]}
                        onOpenChange={(isOpen) =>
                          setOpen((prev) => ({ ...prev, [sessionId]: isOpen }))
                        }
                      >
                        <PopoverTrigger asChild>
                          <button
                            className={`icon_container ml-1.5 rounded-lg text-zinc-700 hover:bg-black/10 dark:text-white dark:hover:bg-white/20 ${
                              hoveredSession === sessionId ? 'visible' : 'invisible'
                            }`}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <EllipsisVertical className="h-4 w-4 flex-1" />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent className="max-w-fit border border-black/10 bg-white p-2 backdrop-blur-[100px] dark:border-white/20 dark:bg-[#0D0D0D]/50">
                          <button
                            className="delete_option flex w-full items-center gap-1.5 rounded-sm p-2 text-xs text-zinc-800 hover:bg-zinc-100 2xl:text-sm dark:text-white dark:hover:bg-white/10"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenDeleteDialog(sessionId);
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                            Delete
                          </button>
                        </PopoverContent>
                      </Popover>

                      <DeleteChatHistoryDialog
                        open={deleteDialogSession === sessionId}
                        onOpenChange={handleCloseDeleteDialog}
                        onDelete={() => handleDelete(sessionId, 'today')} // or yesterday/older
                      />
                    </motion.p>
                  ))}
                </AnimatePresence>
              </div>
            </div>
          )}
          {Array.isArray(yesterdayTitles) && yesterdayTitles.length > 0 && (
            <div className="yesterday">
              <motion.p
                variants={FRAMER_ITEM_FADE_RIGHT_VARIANTS}
                className="text-10 mb-1 px-2 font-semibold text-zinc-400 2xl:mb-2 2xl:px-3 2xl:text-sm dark:text-neutral-400"
              >
                Yesterday
              </motion.p>
              <div className="flex flex-col gap-0.5 2xl:gap-1">
                <AnimatePresence mode="popLayout">
                  {yesterdayTitles.map(({ _id, title, sessionId }) => (
                    <motion.p
                      key={_id}
                      layout
                      variants={FRAMER_ITEM_FADE_RIGHT_VARIANTS}
                      initial="hidden"
                      animate="visible"
                      exit="exit"
                      className={`flex w-full cursor-pointer items-center rounded-[10px] p-2 py-[5px] pr-0.5 2xl:py-2 2xl:pl-3 ${activeSessionId === sessionId ? 'bg-zinc-200 dark:bg-[#2A2A2A]' : 'hover:overflow-hidden hover:bg-zinc-100 dark:hover:bg-[#2A2A2A]'} `}
                      onClick={() => handleHistoryClick(sessionId)}
                      onMouseEnter={() => setHoveredSession(sessionId)}
                      onMouseLeave={() => setHoveredSession(null)}
                    >
                      <div
                        className={`history_text text-10 w-full truncate overflow-hidden font-medium whitespace-nowrap text-zinc-900 2xl:text-sm dark:text-white ${activeSessionId === sessionId ? 'max-w-[89%]' : ' '} hover:overflow-hidden`}
                      >
                        {title || ''}
                      </div>

                      <Popover
                        open={!!open[sessionId]}
                        onOpenChange={(isOpen) =>
                          setOpen((prev) => ({ ...prev, [sessionId]: isOpen }))
                        }
                      >
                        <PopoverTrigger asChild>
                          <button
                            className={`icon_container ml-1.5 rounded-lg text-zinc-700 hover:bg-black/10 dark:text-white dark:hover:bg-white/20 ${
                              hoveredSession === sessionId ? 'visible' : 'invisible'
                            }`}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <EllipsisVertical className="h-4 w-4 flex-1" />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent className="max-w-fit border border-black/10 bg-white p-2 backdrop-blur-[100px] dark:border-white/20 dark:bg-[#0D0D0D]/50">
                          <button
                            className="delete_option flex w-full items-center gap-1.5 rounded-sm p-2 text-xs text-zinc-800 hover:bg-zinc-100 2xl:text-sm dark:text-white dark:hover:bg-white/10"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenDeleteDialog(sessionId);
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                            Delete
                          </button>
                        </PopoverContent>
                      </Popover>

                      <DeleteChatHistoryDialog
                        open={deleteDialogSession === sessionId}
                        onOpenChange={handleCloseDeleteDialog}
                        onDelete={() => handleDelete(sessionId, 'yesterday')}
                      />
                    </motion.p>
                  ))}
                </AnimatePresence>
              </div>
            </div>
          )}
          {Array.isArray(last7DaysTitles) && last7DaysTitles.length > 0 && (
            <div className="previous_7_days">
              <motion.p
                variants={FRAMER_ITEM_FADE_RIGHT_VARIANTS}
                className="text-10 mb-1 px-2 font-semibold text-zinc-400 2xl:mb-2 2xl:px-3 2xl:text-sm dark:text-neutral-400"
              >
                Previous 7 Days
              </motion.p>
              <div className="flex flex-col gap-1">
                <AnimatePresence mode="popLayout">
                  {last7DaysTitles.map(({ _id, title, sessionId }) => (
                    <motion.p
                      key={_id}
                      layout
                      variants={FRAMER_ITEM_FADE_RIGHT_VARIANTS}
                      initial="hidden"
                      animate="visible"
                      exit="exit"
                      className={`flex w-full cursor-pointer items-center rounded-[10px] p-2 py-[5px] pr-0.5 2xl:py-2 2xl:pl-3 ${activeSessionId === sessionId ? 'bg-zinc-200 dark:bg-[#2A2A2A]' : 'hover:overflow-hidden hover:bg-zinc-100 dark:hover:bg-[#2A2A2A]'} `}
                      onClick={() => handleHistoryClick(sessionId)}
                      onMouseEnter={() => setHoveredSession(sessionId)}
                      onMouseLeave={() => setHoveredSession(null)}
                    >
                      <div
                        className={`history_text text-10 w-full truncate overflow-hidden font-medium whitespace-nowrap text-zinc-900 2xl:text-sm dark:text-white ${activeSessionId === sessionId ? 'max-w-[89%]' : ' '} hover:overflow-hidden`}
                      >
                        {title || ''}
                      </div>

                      <Popover
                        open={!!open[sessionId]}
                        onOpenChange={(isOpen) =>
                          setOpen((prev) => ({ ...prev, [sessionId]: isOpen }))
                        }
                      >
                        <PopoverTrigger asChild>
                          <button
                            className={`icon_container ml-1.5 rounded-lg text-zinc-700 hover:bg-black/10 dark:text-white dark:hover:bg-white/20 ${
                              hoveredSession === sessionId ? 'visible' : 'invisible'
                            }`}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <EllipsisVertical className="h-4 w-4 flex-1" />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent className="max-w-fit border border-black/10 bg-white p-2 backdrop-blur-[100px] dark:border-white/20 dark:bg-[#0D0D0D]/50">
                          <button
                            className="delete_option flex w-full items-center gap-1.5 rounded-sm p-2 text-xs text-zinc-800 hover:bg-zinc-100 2xl:text-sm dark:text-white dark:hover:bg-white/10"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenDeleteDialog(sessionId);
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                            Delete
                          </button>
                        </PopoverContent>
                      </Popover>

                      <DeleteChatHistoryDialog
                        open={deleteDialogSession === sessionId}
                        onOpenChange={handleCloseDeleteDialog}
                        onDelete={() => handleDelete(sessionId, '7days')}
                      />
                    </motion.p>
                  ))}
                </AnimatePresence>
              </div>
            </div>
          )}
          {Array.isArray(olderTitles) && olderTitles.length > 0 && (
            <div className="older">
              <motion.p
                variants={FRAMER_ITEM_FADE_RIGHT_VARIANTS}
                className="text-10 mb-2 px-4 font-semibold text-zinc-400 2xl:text-sm dark:text-neutral-400"
              >
                Older
              </motion.p>
              <div className="flex flex-col gap-1">
                <AnimatePresence mode="popLayout">
                  {olderTitles.map(({ _id, title, sessionId }) => (
                    <motion.p
                      key={_id}
                      layout
                      variants={FRAMER_ITEM_FADE_RIGHT_VARIANTS}
                      initial="hidden"
                      animate="visible"
                      exit="exit"
                      className={`flex w-full cursor-pointer items-center rounded-[10px] p-2 py-[5px] pr-0.5 2xl:py-2 2xl:pl-3 ${activeSessionId === sessionId ? 'bg-zinc-200 dark:bg-[#2A2A2A]' : 'hover:overflow-hidden hover:bg-zinc-100 dark:hover:bg-[#2A2A2A]'} `}
                      onClick={() => handleHistoryClick(sessionId)}
                      onMouseEnter={() => setHoveredSession(sessionId)}
                      onMouseLeave={() => setHoveredSession(null)}
                    >
                      <div
                        className={`history_text text-10 w-full truncate overflow-hidden font-medium whitespace-nowrap text-zinc-900 2xl:text-sm dark:text-white ${activeSessionId === sessionId ? 'max-w-[89%]' : ' '} hover:overflow-hidden`}
                      >
                        {title || ''}
                      </div>

                      <Popover
                        open={!!open[sessionId]}
                        onOpenChange={(isOpen) =>
                          setOpen((prev) => ({ ...prev, [sessionId]: isOpen }))
                        }
                      >
                        <PopoverTrigger asChild>
                          <button
                            className={`icon_container ml-1.5 rounded-lg text-zinc-700 hover:bg-black/10 dark:text-white dark:hover:bg-white/20 ${
                              hoveredSession === sessionId ? 'visible' : 'invisible'
                            }`}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <EllipsisVertical className="h-4 w-4 flex-1" />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent className="max-w-fit border border-black/10 bg-white p-2 backdrop-blur-[100px] dark:border-white/20 dark:bg-[#0D0D0D]/50">
                          <button
                            className="delete_option flex w-full items-center gap-1.5 rounded-sm p-2 text-xs text-zinc-800 hover:bg-zinc-100 2xl:text-sm dark:text-white dark:hover:bg-white/10"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenDeleteDialog(sessionId);
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                            Delete
                          </button>
                        </PopoverContent>
                      </Popover>

                      <DeleteChatHistoryDialog
                        open={deleteDialogSession === sessionId}
                        onOpenChange={handleCloseDeleteDialog}
                        onDelete={() => handleDelete(sessionId, 'older')}
                      />
                    </motion.p>
                  ))}
                </AnimatePresence>
              </div>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default ChatHistorySection;
